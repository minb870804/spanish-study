/* 일기를 월별 문서로 나눠 저장하기 위한 도구.
 *
 * 예전에는 일기가 문서 하나(개인: users/{uid}.diary, 교환: spaces/{id}.sharedDiary)에
 * 계속 쌓여서 Firestore 문서 한도(1MB)에 몇 달이면 닿을 상황이었다. 이제 달마다 문서를 둔다.
 *
 *   개인 일기  users/{uid}/diaryMonths/{YYYY-MM}   { entries: { 'YYYY-MM-DD': 글 } }
 *   교환일기   spaces/{id}/diaryMonths/{YYYY-MM}   { entries: { 'YYYY-MM-DD': { uid: 글 } } }
 *
 * 교환일기는 날짜 아래에 사람별로 한 단계 더 들어가서 depth=2, 개인 일기는 depth=1로 다룬다.
 *
 * 옮기기(migrate)는 옛 데이터를 지우지 않고 복사만 한 뒤, 서버에서 다시 읽어 원본과
 * 비교해 모두 맞을 때만 성공으로 친다. 실패하면 호출한 쪽은 옛 방식을 그대로 쓰면 된다.
 */
const DiaryMonths = (() => {
  const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const monthOf = key => String(key).slice(0, 7);
  const updatedAtOf = v => Number((v && v.updatedAt) || 0);

  // 날짜(와 사람) 경로로 끝까지 내려가 실제 글만 뽑는다. 날짜 형식이 아닌 키는 건너뛴다.
  function leaves(map, depth) {
    const out = [];
    const walk = (node, path) => {
      if (path.length === depth) { if (node != null) out.push([path, node]); return; }
      if (!node || typeof node !== 'object') return;
      Object.keys(node).forEach(k => {
        if (path.length === 0 && !DAY_KEY.test(k)) return;
        walk(node[k], path.concat(k));
      });
    };
    walk(map || {}, []);
    return out;
  }
  const getAt = (map, path) => path.reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), map);
  function setAt(map, path, value) {
    let node = map;
    path.slice(0, -1).forEach(k => { if (!node[k] || typeof node[k] !== 'object') node[k] = {}; node = node[k]; });
    node[path[path.length - 1]] = value;
    return map;
  }

  // Firestore는 필드 순서를 보장하지 않으므로 키를 정렬해서 비교한다.
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const same = (a, b) => stable(a) === stable(b);

  // 날짜별 맵 → { 'YYYY-MM': 그 달의 날짜별 맵 }
  function groupByMonth(dayMap) {
    const out = {};
    Object.keys(dayMap || {}).forEach(key => {
      if (!DAY_KEY.test(key) || dayMap[key] == null) return;
      const m = monthOf(key);
      if (!out[m]) out[m] = {};
      out[m][key] = dayMap[key];
    });
    return out;
  }

  // 월별 문서들의 data() 목록 → 날짜별 맵 하나로
  function mergeMonths(docs) {
    const out = {};
    (docs || []).forEach(doc => {
      const entries = (doc && doc.entries) || {};
      Object.keys(entries).forEach(key => {
        if (DAY_KEY.test(key) && entries[key] != null) out[key] = entries[key];
      });
    });
    return out;
  }

  // 옮길 글: 새 위치에 없거나, 옛 위치 쪽이 더 최신인 것만.
  // 다른 기기가 먼저 옮기고 새로 쓴 글을 옛것으로 덮지 않기 위해서다.
  function pickNewer(legacy, current, depth) {
    const out = {};
    leaves(legacy, depth).forEach(([path, value]) => {
      const cur = getAt(current, path);
      if (cur == null || updatedAtOf(value) > updatedAtOf(cur)) setAt(out, path, value);
    });
    return out;
  }

  // 옛 위치의 모든 글이 새 위치에 그대로(또는 더 최신 글로) 있는지 확인한다.
  function verify(legacy, merged, depth) {
    const problems = [];
    leaves(legacy, depth).forEach(([path, value]) => {
      const cur = getAt(merged, path);
      if (cur == null) problems.push({ path: path.join('/'), reason: 'missing' });
      else if (!same(cur, value) && updatedAtOf(cur) <= updatedAtOf(value)) problems.push({ path: path.join('/'), reason: 'different' });
    });
    return { ok: problems.length === 0, checked: leaves(legacy, depth).length, problems };
  }

  const count = (map, depth) => leaves(map, depth).length;

  // ── 여기부터 Firestore 호출. deps로 받아서 테스트에서는 가짜 Firestore를 넣는다. ──

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 시간 초과`)), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  async function readServer(col) {
    const snap = await col.get({ source: 'server' });
    return mergeMonths(snap.docs.map(d => d.data()));
  }

  // 글 하나(=경로 하나)만 정확히 바꾼다. set+merge는 글 안의 필드까지 섞어 버려서
  // 옛 필드가 남을 수 있으므로, mergeFields로 그 경로의 값을 통째로 갈아 끼운다.
  async function writeExact({ db, col, FieldPath, dayMap, depth }) {
    const items = leaves(dayMap, depth);
    for (let i = 0; i < items.length; i += 400) {
      const batch = db.batch();
      items.slice(i, i + 400).forEach(([path, value]) => {
        const data = { entries: setAt({}, path, value) };
        batch.set(col.doc(monthOf(path[0])), data, { mergeFields: [new FieldPath('entries', ...path)] });
      });
      await batch.commit();
    }
    return items.length;
  }

  // 옛 위치 → 월별 문서. { ok, copied, checked, problems } 를 돌려준다. 옛 데이터는 건드리지 않는다.
  async function migrate({ db, col, FieldPath, legacy, depth, timeoutMs = 20000 }) {
    const run = async () => {
      const existing = await readServer(col);
      const toWrite = pickNewer(legacy, existing, depth);
      const copied = await writeExact({ db, col, FieldPath, dayMap: toWrite, depth });
      const merged = await readServer(col);
      return { ...verify(legacy, merged, depth), copied, merged };
    };
    return withTimeout(run(), timeoutMs, '일기 옮기기');
  }

  // 전환 표시를 한 뒤 딱 한 번: 옮기는 사이 옛 화면이 옛 위치에 새로 쓴 글을 마저 옮긴다.
  // 표시 이후에는 보안 규칙이 옛 위치 쓰기를 막으므로 이걸로 틈이 닫힌다.
  // since 이전 글은 보지 않는다 — 안 그러면 새 방식에서 지운 일기가 옛 위치에서 되살아난다.
  async function catchUp({ db, col, FieldPath, legacy, depth, since }) {
    const recent = {};
    leaves(legacy, depth).forEach(([path, value]) => { if (updatedAtOf(value) >= since) setAt(recent, path, value); });
    if (!leaves(recent, depth).length) return 0;
    const merged = await readServer(col);
    return writeExact({ db, col, FieldPath, dayMap: pickNewer(recent, merged, depth), depth });
  }

  return { DAY_KEY, monthOf, groupByMonth, mergeMonths, leaves, pickNewer, verify, same, count, writeExact, migrate, catchUp, withTimeout };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DiaryMonths;
