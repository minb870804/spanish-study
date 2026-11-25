// 테스트용 메모리 Firestore. 실제 서버·계정에는 접속하지 않는다.
// batch·transaction(읽은 문서가 커밋 전에 바뀌면 다시 실행)·mergeFields·FieldPath·FieldValue를 흉내 낸다.
// hooks.beforeCommit(writes)가 true를 돌려주면 그 커밋은 실패하고, hooks.afterCommit(writes)는 커밋 직후 불린다.
const DELETE = { __op: 'delete' };
const TIMESTAMP = { __op: 'serverTimestamp' };
class FieldPath { constructor(...parts) { this.parts = parts; } }
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const partsOf = p => (p instanceof FieldPath ? p.parts : String(p).split('.'));
const getAt = (obj, parts) => parts.reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), obj);

function resolve(value, current) {
  if (value && value.__op === 'serverTimestamp') return Date.now();
  if (value && value.__op === 'arrayUnion') {
    const list = Array.isArray(current) ? clone(current) : [];
    value.values.forEach(v => { if (!list.some(x => JSON.stringify(x) === JSON.stringify(v))) list.push(clone(v)); });
    return list;
  }
  return clone(value);
}
function setAt(obj, parts, value) {
  let node = obj;
  parts.slice(0, -1).forEach(k => { if (!node[k] || typeof node[k] !== 'object') node[k] = {}; node = node[k]; });
  const last = parts[parts.length - 1];
  if (value && value.__op === 'delete') delete node[last]; else node[last] = resolve(value, node[last]);
}

function createFirestore() {
  const docs = new Map();
  const versions = new Map();
  const hooks = { beforeCommit: null, afterCommit: null, afterTransaction: null };
  const stats = { commits: 0, transactions: 0, retries: 0 };

  // staged: 이번 커밋에서 바뀔 문서들의 사본. 모든 쓰기가 성공해야 한꺼번에 반영한다(원자성).
  function apply(staged, write) {
    const cur = staged.has(write.path) ? staged.get(write.path) : docs.get(write.path);
    if (write.kind === 'update') {
      if (!cur) { const e = new Error('no document to update: ' + write.path); e.code = 'not-found'; throw e; }
      const next = clone(cur);
      write.pairs.forEach(([parts, value]) => setAt(next, parts, value));
      staged.set(write.path, next);
    } else if (write.options && write.options.mergeFields) {
      const next = clone(cur) || {};
      write.options.mergeFields.forEach(p => { const parts = partsOf(p); setAt(next, parts, getAt(write.data, parts)); });
      staged.set(write.path, next);
    } else if (write.options && write.options.merge) {
      const next = clone(cur) || {};
      const walk = (src, path) => Object.entries(src).forEach(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && !v.__op) walk(v, path.concat(k)); else setAt(next, path.concat(k), v);
      });
      walk(write.data, []);
      staged.set(write.path, next);
    } else {
      const next = {};
      Object.entries(write.data).forEach(([k, v]) => setAt(next, [k], v));
      staged.set(write.path, next);
    }
  }
  // read: transaction이 읽은 문서와 그때 버전. beforeCommit(다른 기기의 끼어들기 흉내) 뒤에 다시 비교한다.
  function commit(writes, read = null) {
    if (hooks.beforeCommit && hooks.beforeCommit(writes)) { const e = new Error('injected commit failure'); e.code = 'unavailable'; throw e; }
    if (read && [...read].some(([p, v]) => (versions.get(p) || 0) !== v)) return false;
    const staged = new Map();
    writes.forEach(w => apply(staged, w));
    staged.forEach((data, p) => { docs.set(p, data); versions.set(p, (versions.get(p) || 0) + 1); });
    stats.commits++;
    if (hooks.afterCommit) hooks.afterCommit(writes);
    return true;
  }
  const updatePairs = (dataOrPath, rest) => (dataOrPath instanceof FieldPath || typeof dataOrPath === 'string'
    ? [[partsOf(dataOrPath), rest[0]], ...Array.from({ length: (rest.length - 1) / 2 }, (_, i) => [partsOf(rest[1 + i * 2]), rest[2 + i * 2]])]
    : Object.entries(dataOrPath).map(([k, v]) => [k.split('.'), v]));

  function snapshot(path) {
    const data = docs.get(path);
    return { exists: data !== undefined, id: path.split('/').pop(), ref: doc(path), metadata: {},
      data: () => clone(data), get: field => clone(getAt(data, partsOf(field))) };
  }
  function doc(path) {
    return {
      path, id: path.split('/').pop(),
      collection: name => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data, options) => commit([{ kind: 'set', path, data, options }]),
      update: async (dataOrPath, ...rest) => commit([{ kind: 'update', path, pairs: updatePairs(dataOrPath, rest) }])
    };
  }
  function collection(path) {
    const list = () => [...docs.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).sort().map(snapshot);
    return { path, doc: id => doc(`${path}/${id}`), get: async () => ({ docs: list() }), select: () => ({ get: async () => ({ docs: list() }) }),
      onSnapshot: next => { next({ docs: list(), metadata: {} }); return () => {}; } };
  }
  function batch() {
    const writes = [];
    return {
      writes,
      set(ref, data, options) { writes.push({ kind: 'set', path: ref.path, data: clone(data), options }); return this; },
      update(ref, dataOrPath, ...rest) { writes.push({ kind: 'update', path: ref.path, pairs: updatePairs(dataOrPath, rest).map(([p, v]) => [p, v && v.__op ? v : clone(v)]) }); return this; },
      commit: async () => { commit(writes); }
    };
  }
  async function runTransaction(fn) {
    stats.transactions++;
    for (let attempt = 0; attempt < 5; attempt++) {
      const read = new Map();
      const tx = batch();
      tx.get = async ref => { if (!read.has(ref.path)) read.set(ref.path, versions.get(ref.path) || 0); return snapshot(ref.path); };
      const result = await fn(tx);
      if (!commit(tx.writes, read)) { stats.retries++; continue; }
      // 커밋은 끝났지만 호출한 쪽에 결과가 늦게 도착하는 상황(완료 순서 뒤집힘)을 흉내 낼 때 쓴다.
      if (hooks.afterTransaction) await hooks.afterTransaction(tx.writes);
      return result;
    }
    const e = new Error('transaction contention'); e.code = 'aborted'; throw e;
  }
  return {
    db: { collection, doc, batch, runTransaction },
    docs, hooks, stats,
    put: (path, data) => { docs.set(path, clone(data)); versions.set(path, (versions.get(path) || 0) + 1); },
    read: path => clone(docs.get(path))
  };
}

const FieldValue = { delete: () => DELETE, serverTimestamp: () => TIMESTAMP, arrayUnion: (...values) => ({ __op: 'arrayUnion', values }) };
module.exports = { createFirestore, FieldPath, FieldValue, DELETE, clone };
