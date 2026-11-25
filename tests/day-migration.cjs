// 일정을 월별 문서로 옮길 때(moveDaysToMonths) 옮기는 사이 예전 화면이 바꾼·지운 날이 빠지지 않고,
// 실패·재시작·동시 전환·표시 뒤의 새 월별 편집에서도 데이터가 사라지지 않는지 확인한다.
// js/diary-months.js · js/day-months.js · js/day-persistence.js 실제 코드를 메모리 Firestore로 돌린다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFirestore, FieldPath, FieldValue, clone } = require('./fake-firestore.cjs');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
const DayMonths = require(path.join(root, 'js', 'day-months.js'));
const source = ['diary-months.js', 'day-months.js', 'day-persistence.js'].map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');

const todo = (id, text = id) => ({ id, text, by: 'A' });
function world(days, monthly = {}) {
  const store = createFirestore();
  store.put('spaces/S', { members: ['A', 'B'], days: clone(days) });
  Object.entries(DayMonths.toStoredDays(monthly)).forEach(([key, day]) => {
    const p = `spaces/S/dayMonths/${key.slice(0, 7)}`;
    const doc = store.read(p) || { entries: {} };
    doc.entries[key] = day;
    store.put(p, doc);
  });
  return store;
}
function device(store) {
  const ctx = vm.createContext({ console: { error() {}, warn() {}, info() {}, log() {} }, db: store.db,
    firebase: { firestore: { FieldPath, FieldValue } }, setTimeout, clearTimeout, Promise,
    userData: null, spaceData: null, renderAll() {} });
  vm.runInContext(source, ctx);
  return ctx;
}
const move = store => vm.runInContext("moveDaysToMonths('shared', 'S')", device(store));
const monthly = store => clone(DayMonths.fromStoredDays(DayMonths.mergeMonths(
  [...store.docs.keys()].filter(p => p.startsWith('spaces/S/dayMonths/')).map(p => store.read(p)))));
const legacy = store => store.read('spaces/S').days || {};
const marked = store => (store.read('spaces/S').dayStorage || 0) >= 2;
const touchesMonths = writes => writes.some(w => w.path.startsWith('spaces/S/dayMonths/'));
// 옮기기 복사가 처음 끝난 직후, 예전 화면이 예전 위치를 고친 것처럼 만든다.
function gapEdit(store, edit) {
  let done = false;
  const prev = store.hooks.afterCommit;
  store.hooks.afterCommit = writes => {
    if (prev) prev(writes);
    if (!done && touchesMonths(writes)) { done = true; const d = store.read('spaces/S'); edit(d.days); store.put('spaces/S', d); }
  };
  return () => done;
}
const DAYS = { '2026-10-01': { todos: [todo('a')] }, '2026-11-02': { todos: [todo('b')] } };

test('옮기는 사이 예전 화면이 고치거나 지운 날도 월별에 반영된다', async () => {
  const store = world(DAYS);
  gapEdit(store, days => { days['2026-10-01'].todos.push(todo('c')); delete days['2026-11-02']; });
  assert.equal(await move(store), true);
  assert.equal(marked(store), true);
  assert.deepEqual(monthly(store), legacy(store));
});

test('표시와 마무리 중 저장이 실패해도 바뀐 날이 빠지지 않고, 다시 시도하면 끝난다', async () => {
  const store = world(DAYS);
  const gapped = gapEdit(store, days => { days['2026-10-01'].todos.push(todo('c')); delete days['2026-11-02']; });
  let failed = false;
  store.hooks.beforeCommit = writes => { if (gapped() && !failed && touchesMonths(writes)) { failed = true; return true; } return false; };
  const first = await move(store);
  assert.equal(failed, true);
  assert.equal(first, false);
  assert.equal(marked(store), false);
  assert.equal(await move(store), true);
  assert.equal(marked(store), true);
  assert.deepEqual(monthly(store), legacy(store));
});

test('예비 복사 중 다른 기기가 전환을 끝내고 월별에서 고치거나 지운 날을 덮지 않는다', async () => {
  const store = world(DAYS);
  let interfered = false;
  store.hooks.beforeCommit = writes => {
    if (!interfered && touchesMonths(writes)) {
      interfered = true;
      // 다른 기기 B: 전환을 마치고 10/01 을 고치고 11/02 를 지웠다.
      const owner = store.read('spaces/S'); owner.dayStorage = 2; store.put('spaces/S', owner);
      store.put('spaces/S/dayMonths/2026-10', { entries: { '2026-10-01': DayMonths.toStored({ todos: [todo('a'), todo('z', 'B의 편집')] }) } });
      store.put('spaces/S/dayMonths/2026-11', { entries: {} });
    }
    return false;
  };
  assert.equal(await move(store), true);
  assert.equal(interfered, true);
  assert.deepEqual(monthly(store)['2026-10-01'].todos.map(t => t.id), ['a', 'z']);
  assert.equal(monthly(store)['2026-11-02'], undefined);
});

test('처음 목록에 없던 달을 다른 기기가 예비 복사한 뒤 원본에서 지우면 마지막 단계가 그 달도 지운다', async () => {
  const store = world(DAYS);
  const B = device(store);
  // B 기기가 실제 syncMonths 로 12월만 예비 복사하는 단계(표시는 달지 않음).
  const bCopiesDecember = () => vm.runInContext(`db.runTransaction(tx => DayMonths.syncMonths({ tx,
    ref: dayOwnerRef('shared', 'S'), col: dayMonthsCol('shared', 'S'), FieldPath: firebase.firestore.FieldPath,
    deleteValue: firebase.firestore.FieldValue.delete(), arrayUnion: firebase.firestore.FieldValue.arrayUnion,
    field: 'days', version: DAY_STORAGE_VERSION,
    months: ['2026-12'], mark: false }))`, B);
  store.hooks.afterTransaction = async () => {
    store.hooks.afterTransaction = null;
    // A가 처음 달 목록(10·11월)을 모으고 첫 예비 복사를 끝낸 뒤:
    let d = store.read('spaces/S'); d.days['2026-12-05'] = { todos: [todo('x')] }; store.put('spaces/S', d); // 예전 화면이 12월 추가
    await bCopiesDecember();                                                                                 // B가 12월 예비 복사
    d = store.read('spaces/S'); delete d.days['2026-12-05']; store.put('spaces/S', d);                       // 예전 화면이 12월 삭제
  };
  assert.equal(await move(store), true);
  assert.equal(marked(store), true);
  assert.ok(store.read('spaces/S/dayMonths/2026-12'), 'B의 12월 예비 복사가 실제로 일어나야 한다');
  assert.equal(monthly(store)['2026-12-05'], undefined);
  assert.deepEqual(monthly(store), legacy(store));
});

test('전환이 끝난 뒤 월별에서 지운 날은 다시 불러도 되살아나지 않는다', async () => {
  const store = world(DAYS);
  assert.equal(await move(store), true);
  const doc = store.read('spaces/S/dayMonths/2026-11'); delete doc.entries['2026-11-02']; store.put('spaces/S/dayMonths/2026-11', doc);
  assert.equal(await move(store), true);
  assert.equal(monthly(store)['2026-11-02'], undefined);
});

test('같은 화면에서 옮기기가 실패하면 실제 구독 경로(ensureDayStorage)가 잠시 뒤 다시 시도한다', async () => {
  const store = world(DAYS);
  let failed = false;
  store.hooks.beforeCommit = writes => { if (!failed && touchesMonths(writes)) { failed = true; return true; } return false; };
  const ctx = device(store);
  const settle = async () => { for (let i = 0; i < 100 && vm.runInContext('dayStore.shared.migrating', ctx); i++) await new Promise(r => setImmediate(r)); };
  vm.runInContext("ensureDayStorage('shared', 'S', " + JSON.stringify(store.read('spaces/S')) + ')', ctx);
  await settle();
  assert.equal(failed, true);
  assert.equal(marked(store), false);
  assert.equal(vm.runInContext('dayStore.shared.mode', ctx), 'legacy');
  const later = Date.now() + 10 * 60 * 1000;
  vm.runInContext(`Date.now = () => ${later}`, ctx);
  vm.runInContext("ensureDayStorage('shared', 'S', " + JSON.stringify(store.read('spaces/S')) + ')', ctx);
  await settle();
  assert.equal(marked(store), true);
  assert.equal(vm.runInContext('dayStore.shared.mode', ctx), 'months');
  assert.deepEqual(monthly(store), legacy(store));
});

test('표시 뒤 다른 기기가 월별에서 고친 날을 예전 내용으로 덮지 않는다', async () => {
  const store = world(DAYS);
  gapEdit(store, days => { days['2026-10-01'].todos.push(todo('c')); });
  let edited = false;
  const prev = store.hooks.afterCommit;
  store.hooks.afterCommit = writes => {
    prev(writes);
    if (!edited && marked(store)) {
      edited = true;
      const doc = store.read('spaces/S/dayMonths/2026-10');
      doc.entries['2026-10-01'] = DayMonths.toStored({ todos: [todo('a'), todo('c'), todo('z', '새 월별 편집')] });
      store.put('spaces/S/dayMonths/2026-10', doc);
    }
  };
  assert.equal(await move(store), true);
  assert.equal(edited, true);
  assert.deepEqual(monthly(store)['2026-10-01'].todos.map(t => t.id), ['a', 'c', 'z']);
});

test('예전 시도가 남긴 오래된 월별 복사본이 있어도 원본대로 맞추고 끝난다', async () => {
  const store = world(DAYS, { '2026-10-01': { todos: [todo('a', '예전 복사본')] }, '2026-09-09': { todos: [todo('gone')] } });
  assert.equal(await move(store), true);
  assert.equal(marked(store), true);
  assert.deepEqual(monthly(store), legacy(store));
});

test('두 기기가 동시에 옮겨도 결과가 원본과 같고, 끝난 뒤 다시 불러도 바꾸지 않는다', async () => {
  const store = world(DAYS);
  gapEdit(store, days => { days['2026-10-01'].todos.push(todo('c')); delete days['2026-11-02']; });
  const results = await Promise.all([move(store), move(store)]);
  assert.deepEqual(results, [true, true]);
  assert.equal(marked(store), true);
  assert.deepEqual(monthly(store), legacy(store));
  const commits = store.stats.commits;
  assert.equal(await move(store), true);
  assert.equal(store.stats.commits, commits);
});
