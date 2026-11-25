// 실제 Firestore 에뮬레이터(127.0.0.1:8080, demo-minb)에서 실제 SDK 로 확인한다.
//  - 보안 규칙: 인증된 웹 클라이언트 SDK(mockUserToken)로 허용·거부를 함께 본다(서버 SDK 는 규칙을 건너뛰므로 규칙 판정에 쓰지 않는다).
//  - 반복 일정 저장·월별 전환: js/day-persistence.js 실제 함수를 두 개의 실제 웹 클라이언트 SDK 위에서 돌리고,
//    commit 직전에 상대 변경을 끼워 넣어 실제 transaction 충돌·재실행(callback 횟수)을 센다.
//  - 예전 방식 알림: functions/index.js 실제 핸들러를 실제 서버 SDK(@google-cloud/firestore)로 돌린다. 푸시 전송만 대역.
//    firebase-admin 은 에뮬레이터 전용 가짜 자격증명을 받지 않으므로(서비스 계정·ADC 만 허용), 같은 설치본의
//    @google-cloud/firestore 클라이언트를 돌려주는 얇은 대역으로 바꾼다.
// 실행: MINB_SDK=<firebase@10.8.0·firebase-admin@13.10.0 설치 폴더> node tests/emulator-integration.cjs
const guard = require('./emulator-guard.cjs'); // 어떤 SDK 보다 먼저
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test, before, beforeEach, afterEach, after } = require('node:test');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
if (!process.env.MINB_SDK) throw new Error('MINB_SDK(설치 폴더)를 지정하세요');
const sdkRequire = Module.createRequire(path.join(path.resolve(process.env.MINB_SDK), 'package.json'));
const DayMonths = require(path.join(root, 'js', 'day-months.js'));

let firebase, server, ServerFieldValue, ServerFieldPath;
const apps = [];
let appSeq = 0;

before(async () => {
  console.log(JSON.stringify({ selfCheck: await guard.selfCheck() }));
  firebase = sdkRequire('firebase/compat/app');
  firebase = firebase.default || firebase;
  sdkRequire('firebase/compat/firestore');
  assert.equal(firebase.SDK_VERSION, '10.8.0');
  const gcf = sdkRequire('@google-cloud/firestore');
  ServerFieldValue = gcf.FieldValue; ServerFieldPath = gcf.FieldPath;
  server = new gcf.Firestore({ projectId: guard.PROJECT, host: guard.HOST, port: guard.PORT, ssl: false, customHeaders: { Authorization: 'Bearer owner' } });
});
beforeEach(async () => {
  const res = await fetch(`http://${guard.EMULATOR}/emulator/v1/projects/${guard.PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(res.status, 200);
});
// 앱 하나를 지우다 실패해도 나머지는 모두 지운다. 실패는 그 뒤에 드러낸다.
afterEach(async () => {
  const results = await Promise.allSettled(apps.splice(0).map(app => app.delete()));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) throw new Error(`클라이언트 앱 정리 실패 ${failed.length}건: ${failed[0].reason}`);
});
after(async () => {
  try { await Promise.allSettled(apps.splice(0).map(app => app.delete())); }
  finally { if (server) await server.terminate(); }
});

// 인증된(uid) 또는 비로그인(uid=null) 웹 클라이언트. 프로젝트와 주소를 고정하고 어긋나면 멈춘다.
function clientDb(uid) {
  const app = firebase.initializeApp({ projectId: guard.PROJECT, apiKey: 'demo-key', appId: 'demo-app' }, `c${++appSeq}`);
  if (app.options.projectId !== guard.PROJECT || !/^demo-/.test(app.options.projectId)) throw new Error('demo 프로젝트가 아닙니다');
  apps.push(app);
  const db = app.firestore();
  db.useEmulator(guard.HOST, guard.PORT, uid ? { mockUserToken: { sub: uid } } : undefined);
  return db;
}

// vm 안 제품 코드가 만든 객체를 SDK 가 일반 객체로 받도록 이 realm 의 객체·배열로 바꿔 넘긴다(값은 그대로).
const isPlain = v => { if (!v || typeof v !== 'object') return false; const p = Object.getPrototypeOf(v); return p === null || (Object.getPrototypeOf(p) === null && typeof p.constructor === 'function' && p.constructor.name === 'Object'); };
const realm = v => Array.isArray(v) ? Array.from(v, realm) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, realm(x)])) : v;
const unwrap = r => (r && r.__real) || r;
// 실제 웹 클라이언트 db 를 감싸, transaction callback 횟수를 세고 commit 직전(beforeCommit)·끝난 뒤(afterTransaction)에 끼어든다.
function bridge(db, hooks) {
  const docRef = ref => ({ __real: ref, id: ref.id, get: (...a) => ref.get(...a.map(realm)), set: (...a) => ref.set(...a.map(realm)),
    update: (...a) => ref.update(...a.map(realm)), onSnapshot: (...a) => ref.onSnapshot(...a), collection: c => colRef(ref.collection(c)) });
  const colRef = col => ({ __real: col, doc: id => docRef(col.doc(id)), get: (...a) => col.get(...a.map(realm)), onSnapshot: (...a) => col.onSnapshot(...a) });
  return {
    collection: c => colRef(db.collection(c)),
    batch: () => { const b = db.batch(); const w = { set: (r, ...a) => (b.set(unwrap(r), ...a.map(realm)), w), update: (r, ...a) => (b.update(unwrap(r), ...a.map(realm)), w), commit: () => b.commit() }; return w; },
    runTransaction: async fn => {
      const out = await db.runTransaction(async tx => {
        const n = ++hooks.attempts;
        const w = { get: r => tx.get(unwrap(r)), set: (r, ...a) => (tx.set(unwrap(r), ...a.map(realm)), w), update: (r, ...a) => (tx.update(unwrap(r), ...a.map(realm)), w) };
        const result = await fn(w);
        if (hooks.beforeCommit) await hooks.beforeCommit(n);
        return result;
      });
      hooks.transactions++;
      if (hooks.afterTransaction) await hooks.afterTransaction(hooks.transactions);
      return out;
    }
  };
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const extract = name => { const s = html.indexOf('function ' + name + '('); return html.slice(s, html.indexOf('\n}\n', s) + 2); };
const productSource = ['diary-months.js', 'day-months.js', 'day-persistence.js'].map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n')
  + '\n' + ['todoScope', 'scopedTodo', 'getAllRecurring'].map(extract).join('\n');
// 실제 제품 함수를 가진 한 사용자의 화면(기기).
function device(uid, space = 'S') {
  const hooks = { attempts: 0, transactions: 0 };
  const real = clientDb(uid);
  const ctx = vm.createContext({
    console: { error() {}, warn() {}, info() {}, log() {} }, toast() {}, setTimeout, clearTimeout, Promise, renderAll() {},
    db: bridge(real, hooks), firebase: { firestore: { FieldPath: firebase.firestore.FieldPath, FieldValue: firebase.firestore.FieldValue } },
    currentUser: { uid }, spaceId: space, userData: null, spaceData: null
  });
  vm.runInContext(productSource, ctx);
  const sync = async () => { ctx.userData = (await server.doc(`users/${uid}`).get()).data(); ctx.spaceData = (await server.doc(`spaces/${space}`).get()).data(); };
  return { ctx, real, hooks, sync };
}
const read = async p => (await server.doc(p).get()).data();
const ids = list => Array.from(list || [], r => r.id).sort();
const rule = (id, extra = {}) => ({ id, text: id, by: 'A', freq: 'yearly', month: 11, monthDay: 20, days: [], ...extra });
const save = (d, mutate) => vm.runInContext('saveRecurring', d.ctx)(mutate(JSON.parse(JSON.stringify(vm.runInContext('getAllRecurring()', d.ctx)))));
const denied = p => assert.rejects(p, e => e && e.code === 'permission-denied');

// ── 보안 규칙(인증된 웹 클라이언트) ──
test('규칙: 멤버만 공간을 읽고 고치며, 비멤버·비로그인·남의 사용자 문서·멤버 명단 변경은 거부된다', async () => {
  await server.doc('spaces/S').set({ members: ['A', 'B'], recurring: [] });
  await server.doc('users/B').set({ spaceId: 'S' });
  const A = clientDb('A'), C = clientDb('C'), anon = clientDb(null);
  assert.equal((await A.doc('spaces/S').get()).exists, true);           // 허용 대조
  await A.doc('spaces/S').update({ note: '멤버 수정' });                 // 허용 대조
  await denied(C.doc('spaces/S').get());
  await denied(C.doc('spaces/S').update({ note: '비멤버' }));
  await denied(anon.doc('spaces/S').get());
  await denied(A.doc('users/B').update({ spaceId: 'X' }));
  await denied(A.doc('spaces/S').update({ members: ['A'] }));
  assert.equal((await read('spaces/S')).note, '멤버 수정');
});

test('규칙: 월별 전환 표시 뒤에는 예전 일정 필드 쓰기만 거부되고, 다른 필드와 월별 문서 쓰기는 허용된다', async () => {
  await server.doc('spaces/S').set({ members: ['A', 'B'], days: { '2026-11-02': { todos: [] } }, dayStorage: 2 });
  const A = clientDb('A');
  await denied(A.doc('spaces/S').update({ 'days.2026-11-03': { todos: [] } }));
  await A.doc('spaces/S').update({ recurring: [] });                              // 허용 대조
  await A.doc('spaces/S/dayMonths/2026-11').set({ entries: {} });                  // 허용 대조
  await denied(A.doc('spaces/S/dayMonths/bad-key').set({ entries: {} }));
  await denied(clientDb('C').doc('spaces/S/dayMonths/2026-11').set({ entries: {} }));
});

// ── 반복 일정 저장: 실제 transaction 충돌과 재실행 ──
async function recurringWorld({ shared = [], personalA = [] } = {}) {
  await server.doc('spaces/S').set({ members: ['A', 'B'], recurring: shared });
  await server.doc('users/A').set({ spaceId: 'S', personalRecurring: personalA });
  await server.doc('users/B').set({ spaceId: 'S', personalRecurring: [] });
  const A = device('A'), B = device('B');
  await A.sync(); await B.sync();
  return { A, B };
}
// A 의 첫 commit 직전에 B 의 실제 저장을 끝낸다 → A 의 commit 이 실패하고 callback 이 다시 돈다.
const interleave = (A, fn) => { A.hooks.beforeCommit = async n => { if (n === 1) await fn(); }; };

test('반복: A 저장 도중 B 가 공유 규칙을 추가하면 A transaction 이 다시 돌고 둘 다 남는다', async () => {
  const { A, B } = await recurringWorld();
  interleave(A, async () => assert.equal(await save(B, all => [...all, rule('b1', { by: 'B', visibility: 'shared' })]), true));
  assert.equal(await save(A, all => [...all, rule('a1', { visibility: 'shared' })]), true);
  assert.ok(A.hooks.attempts >= 2, `callback 횟수 ${A.hooks.attempts}`);
  assert.deepEqual(ids((await read('spaces/S')).recurring), ['a1', 'b1']);
});

test('반복: A 가 고치는 사이 B 가 지운 규칙은 A 의 재실행 뒤에도 되살아나지 않는다', async () => {
  const { A, B } = await recurringWorld({ shared: [rule('x', { visibility: 'shared' })] });
  interleave(A, async () => assert.equal(await save(B, all => all.filter(r => r.id !== 'x')), true));
  assert.equal(await save(A, all => all.map(r => (r.id === 'x' ? { ...r, text: '늦은 수정' } : r))), true);
  assert.ok(A.hooks.attempts >= 2, `callback 횟수 ${A.hooks.attempts}`);
  assert.deepEqual(ids((await read('spaces/S')).recurring), []);
});

test('반복: 공유→개인 이동 도중 B 가 추가한 공유 규칙도 남고 두 문서가 함께 바뀐다', async () => {
  const { A, B } = await recurringWorld({ shared: [rule('s', { visibility: 'shared' })] });
  interleave(A, async () => assert.equal(await save(B, all => [...all, rule('b1', { by: 'B', visibility: 'shared' })]), true));
  assert.equal(await save(A, all => all.map(r => (r.id === 's' ? { ...r, visibility: 'private' } : r))), true);
  assert.ok(A.hooks.attempts >= 2, `callback 횟수 ${A.hooks.attempts}`);
  assert.deepEqual(ids((await read('users/A')).personalRecurring), ['s']);
  assert.deepEqual(ids((await read('spaces/S')).recurring), ['b1']);
});

// ── 월별 전환(moveDaysToMonths) ──
const todo = (id, text = id) => ({ id, text, by: 'A' });
const DAYS = { '2026-10-01': { todos: [todo('a')] }, '2026-11-02': { todos: [todo('b')] } };
async function monthly() {
  const snap = await server.collection('spaces/S/dayMonths').get();
  return JSON.parse(JSON.stringify(DayMonths.fromStoredDays(DayMonths.mergeMonths(snap.docs.map(d => d.data())))));
}
const move = d => vm.runInContext("moveDaysToMonths('shared', 'S')", d.ctx);

test('전환: 예비 복사 뒤 예전 화면이 고치고 지운 날이 월별에 그대로 반영되고 지운 날은 남지 않는다', async () => {
  await server.doc('spaces/S').set({ members: ['A', 'B'], days: DAYS });
  const A = device('A');
  A.hooks.afterTransaction = async n => {
    if (n !== 1) return;
    await server.doc('spaces/S').update({ 'days.2026-10-01': { todos: [todo('a'), todo('c')] }, 'days.2026-11-02': ServerFieldValue.delete() });
  };
  assert.equal(await move(A), true);
  const owner = await read('spaces/S');
  assert.equal(owner.dayStorage, 2);
  assert.deepEqual(await monthly(), JSON.parse(JSON.stringify(owner.days)));
  assert.equal((await monthly())['2026-11-02'], undefined);
});

test('전환: 끝난 뒤 월별에서 지운 날은 다시 옮겨도 되살아나지 않고, 예전 위치 쓰기는 규칙이 막는다', async () => {
  await server.doc('spaces/S').set({ members: ['A', 'B'], days: DAYS });
  const A = device('A');
  assert.equal(await move(A), true);
  const B = clientDb('B');
  await B.doc('spaces/S/dayMonths/2026-11').update(new firebase.firestore.FieldPath('entries', '2026-11-02'), firebase.firestore.FieldValue.delete());
  assert.equal(await move(A), true);
  assert.equal((await monthly())['2026-11-02'], undefined);
  // 기존과 같은 값을 쓰면 바뀐 필드가 없어 규칙이 허용하므로(실제로 바뀌지 않음), 다른 내용으로 쓴다.
  await denied(A.real.doc('spaces/S').update({ 'days.2026-11-02': { todos: [todo('b', '되살리기 시도')] } }));
});

test('전환: 예비 복사 commit 직전에 다른 기기가 전환을 끝내고 월별을 고치면 A 는 다시 돌고 덮지 않는다', async () => {
  await server.doc('spaces/S').set({ members: ['A', 'B'], days: DAYS });
  const A = device('A');
  A.hooks.beforeCommit = async n => {
    if (n !== 1) return;
    await server.doc('spaces/S/dayMonths/2026-10').set({ entries: { '2026-10-01': DayMonths.toStored({ todos: [todo('a'), todo('z', 'B의 편집')] }) } });
    await server.doc('spaces/S/dayMonths/2026-11').set({ entries: {} });
    await server.doc('spaces/S').update({ dayStorage: 2 });
  };
  assert.equal(await move(A), true);
  assert.ok(A.hooks.attempts >= 2, `callback 횟수 ${A.hooks.attempts}`);
  const m = await monthly();
  assert.deepEqual(m['2026-10-01'].todos.map(t => t.id), ['a', 'z']);
  assert.equal(m['2026-11-02'], undefined);
});

test('전환: 처음 목록에 없던 달을 다른 기기가 예비 복사한 뒤 원본에서 지우면 마지막 단계가 그 달도 지운다', async () => {
  await server.doc('spaces/S').set({ members: ['A', 'B'], days: DAYS });
  const A = device('A'), B = device('B');
  // B 기기(실제 웹 클라이언트, 규칙 적용)가 실제 syncMonths 로 12월만 예비 복사한다(표시는 달지 않음).
  const bCopiesDecember = () => vm.runInContext(`db.runTransaction(tx => DayMonths.syncMonths({ tx,
    ref: dayOwnerRef('shared', 'S'), col: dayMonthsCol('shared', 'S'), FieldPath: firebase.firestore.FieldPath,
    deleteValue: firebase.firestore.FieldValue.delete(), arrayUnion: firebase.firestore.FieldValue.arrayUnion,
    field: 'days', version: DAY_STORAGE_VERSION, months: ['2026-12'], mark: false }))`, B.ctx);
  A.hooks.afterTransaction = async n => {
    if (n !== 1) return; // A 가 처음 달 목록(10·11월)을 모으고 첫 예비 복사를 끝낸 뒤
    await server.doc('spaces/S').update({ 'days.2026-12-05': { todos: [todo('x')] } }); // 예전 화면이 12월 추가
    await bCopiesDecember();                                                                // B 가 12월 예비 복사
    await server.doc('spaces/S').update({ 'days.2026-12-05': ServerFieldValue.delete() }); // 예전 화면이 12월 삭제
  };
  assert.equal(await move(A), true);
  const owner = await read('spaces/S');
  assert.equal(owner.dayStorage, 2);
  assert.ok(owner.dayMonthsCopied.includes('2026-12'), 'B 의 예비 복사가 달 목록에 기록돼야 한다');
  assert.ok((await read('spaces/S/dayMonths/2026-12')), 'B 의 12월 예비 복사가 실제로 일어나야 한다');
  assert.equal((await monthly())['2026-12-05'], undefined);
  assert.deepEqual(await monthly(), JSON.parse(JSON.stringify(owner.days)));
});

// ── 예전 방식 알림 핸들러(functions/index.js) ──
function loadFunctions(onSend) {
  const sends = [];
  const srvHooks = { attempts: 0 };
  const db = new Proxy(server, { get(t, k) {
    if (k === 'runTransaction') return (fn, opts) => t.runTransaction(async tx => {
      const n = ++srvHooks.attempts; const r = await fn(tx);
      if (srvHooks.beforeCommit) await srvHooks.beforeCommit(n);
      return r;
    }, opts);
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  const fakes = {
    'firebase-functions/v2/scheduler': { onSchedule: (opts, fn) => fn },
    'firebase-functions/v2/https': { onCall: (opts, fn) => fn, HttpsError: class extends Error {} },
    'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
    'firebase-admin': { initializeApp() {}, firestore: Object.assign(() => db, { FieldValue: ServerFieldValue, FieldPath: ServerFieldPath }) },
    'web-push': { setVapidDetails() {}, sendNotification: async (sub, payload) => { sends.push(JSON.parse(payload)); if (onSend) await onSend(); } }
  };
  const file = require.resolve(path.join(root, 'functions', 'index.js'));
  const original = Module._load;
  process.env.VAPID_PUBLIC_KEY = 'test-public'; process.env.VAPID_PRIVATE_KEY = 'test-private';
  Module._load = function (request, ...rest) {
    if (fakes[request]) return fakes[request];
    if (!request.startsWith('node:') && !request.startsWith('.') && !path.isAbsolute(request)) throw new Error(`대역 없는 패키지 로드를 막았습니다: ${request}`);
    return original.call(this, request, ...rest);
  };
  try { delete require.cache[file]; return { fn: require(file), sends, srvHooks }; } finally { Module._load = original; }
}
const KEY = '2026-11-07';
async function reminderWorld(todos) {
  await server.doc('users/A').set({ spaceId: 'S', pushSubscriptions: { s1: { endpoint: 'https://push.test/1', keys: {} } } });
  await server.doc('spaces/S').set({ members: ['A'], days: { [KEY]: { todos } } });
  return clientDb('A');
}
const due = (id, extra = {}) => ({ id, text: id, by: 'A', remindAtMs: Date.now() - 60000, ...extra });
const legacyTodos = async () => (await read('spaces/S')).days[KEY].todos;
// A 화면이 그날 목록을 바꿔 저장(실제 웹 클라이언트, 규칙 적용).
const clientEdit = async (A, fn) => { const list = await legacyTodos(); fn(list); await A.doc('spaces/S').update({ [`days.${KEY}`]: { todos: list } }); };

test('알림: 푸시 사이 추가·수정된 할 일이 남고 보낸 할 일만 표시된다', async () => {
  const A = await reminderWorld([due('t1'), due('t2', { remindAtMs: Date.now() + 3600000 })]);
  const start = Date.now();
  const { fn, sends } = loadFunctions(() => clientEdit(A, list => { list[1].text = '바뀐 할 일'; list.push({ id: 't3', text: '새 할 일', by: 'A' }); }));
  await fn.sendTodoReminders();
  const list = await legacyTodos();
  assert.deepEqual(list.map(t => t.id), ['t1', 't2', 't3']);
  assert.equal(list[1].text, '바뀐 할 일');
  assert.ok(list[0].reminderSentAt >= start);
  assert.equal(list[1].reminderSentAt, undefined);
  assert.equal(sends.length, 1);
});

test('알림: 푸시 사이 지운 할 일은 되살아나지 않는다', async () => {
  const A = await reminderWorld([due('t1'), { id: 't2', text: '남길 일', by: 'A' }]);
  const { fn } = loadFunctions(() => clientEdit(A, list => list.splice(0, 1)));
  await fn.sendTodoReminders();
  assert.deepEqual((await legacyTodos()).map(t => t.id), ['t2']);
});

test('알림: 푸시 사이 알림 시간을 바꾸면 보낸 것으로 표시하지 않는다', async () => {
  const A = await reminderWorld([due('t1')]);
  const later = Date.now() + 7200000;
  const { fn } = loadFunctions(() => clientEdit(A, list => { list[0].remindAtMs = later; }));
  await fn.sendTodoReminders();
  const [t1] = await legacyTodos();
  assert.equal(t1.remindAtMs, later);
  assert.equal(t1.reminderSentAt, undefined);
});

test('알림: 푸시 사이 담당자가 바뀌면 이전 담당자에게 보낸 결과를 표시하지 않는다', async () => {
  const A = await reminderWorld([due('t1')]);
  const { fn } = loadFunctions(() => clientEdit(A, list => { list[0].by = 'B'; }));
  await fn.sendTodoReminders();
  const [t1] = await legacyTodos();
  assert.equal(t1.by, 'B');
  assert.equal(t1.reminderSentAt, undefined);
});

test('알림: 개인 일정 경로도 푸시 사이 추가된 할 일을 지우지 않고 보낸 할 일만 표시한다', async () => {
  await server.doc('users/A').set({ spaceId: 'S', pushSubscriptions: { s1: { endpoint: 'https://push.test/1', keys: {} } }, personalDays: { [KEY]: { todos: [due('t1')] } } });
  await server.doc('spaces/S').set({ members: ['A'] });
  const A = clientDb('A');
  const personal = async () => (await read('users/A')).personalDays[KEY].todos;
  const { fn, sends } = loadFunctions(async () => {
    const list = await personal(); list.push({ id: 't3', text: '새 개인 일정', by: 'A' });
    await A.doc('users/A').update({ [`personalDays.${KEY}`]: { todos: list } }); // 본인 문서 쓰기(규칙 적용)
  });
  await fn.sendTodoReminders();
  const list = await personal();
  assert.deepEqual(list.map(t => t.id), ['t1', 't3']);
  assert.ok(list[0].reminderSentAt > 0);
  assert.equal(sends.length, 1);
});

test('알림: 푸시 사이 월별로 전환됐으면 잠긴 예전 위치를 고치지 않는다', async () => {
  await reminderWorld([due('t1')]);
  const { fn } = loadFunctions(() => server.doc('spaces/S').update({ dayStorage: 2 }));
  await fn.sendTodoReminders();
  assert.equal((await legacyTodos())[0].reminderSentAt, undefined);
});

// 서버 SDK transaction 은 읽은 문서를 잠근다(에뮬레이터에서 확인: 끼어든 쓰기는 ABORTED lock timeout 으로 기다린다).
// 그래서 서버 쪽은 낙관적 충돌·재실행이 아니라 '끼어든 쓰기가 commit 뒤로 밀린다'를 확인한다.
test('알림: 표시 transaction 이 열린 동안 끼어든 쓰기는 잠금으로 대기하고, callback·푸시는 한 번이다', async () => {
  const A = await reminderWorld([due('t1')]);
  const { fn, sends, srvHooks } = loadFunctions();
  let edit, pendingDuringTx;
  srvHooks.beforeCommit = async n => {
    if (n !== 1) return;
    let settled = false;
    edit = clientEdit(A, list => list.push({ id: 't3', text: '끼어든 할 일', by: 'A' })).finally(() => { settled = true; });
    await new Promise(r => setTimeout(r, 500));
    pendingDuringTx = !settled;
  };
  await fn.sendTodoReminders();
  await edit;
  assert.equal(pendingDuringTx, true, '열린 transaction 동안 끼어든 쓰기가 끝나면 안 된다');
  assert.equal(srvHooks.attempts, 1);
  assert.equal(sends.length, 1);
  const list = await legacyTodos();
  assert.deepEqual(list.map(t => t.id), ['t1', 't3']);
  // 관찰값: 끼어든 쪽이 표시 전 목록으로 그날 전체를 썼으므로 표시 칸이 남는지는 그 쓰기 내용에 달렸다.
  console.log(JSON.stringify({ observed: 'legacy-whole-day-write-after-lock', t1ReminderSentAt: list[0].reminderSentAt ?? null }));
});
