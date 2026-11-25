// 반복 일정 저장(saveRecurring)이 오래된 화면 상태로 다른 사람의 변경을 덮지 않는지 확인한다.
// js/day-persistence.js 와 index.html 의 실제 함수를 두 개의 독립 클라이언트(vm)에서 같은 메모리 Firestore로 돌린다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFirestore, FieldPath, FieldValue, clone } = require('./fake-firestore.cjs');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const persistence = fs.readFileSync(path.join(root, 'js', 'day-persistence.js'), 'utf8');
const extract = name => { const s = html.indexOf('function ' + name + '('); return html.slice(s, html.indexOf('\n}\n', s) + 2); };
const helpers = ['todoScope', 'scopedTodo', 'getAllRecurring'].map(extract).join('\n');

function world({ personalA = [], personalB = [], shared = [] } = {}) {
  const fs = createFirestore();
  fs.put('users/A', { spaceId: 'S', personalRecurring: personalA });
  fs.put('users/B', { spaceId: 'S', personalRecurring: personalB });
  fs.put('spaces/S', { members: ['A', 'B'], recurring: shared });
  const client = uid => {
    const toasts = [];
    const ctx = vm.createContext({
      console: { error() {}, warn() {}, info() {}, log() {} }, toasts, toast: m => toasts.push(m),
      db: fs.db, firebase: { firestore: { FieldPath, FieldValue } },
      currentUser: { uid }, spaceId: 'S', userData: null, spaceData: null
    });
    vm.runInContext(persistence + '\n' + helpers, ctx);
    // 스냅샷을 받은 것처럼 서버 상태를 화면으로 가져온다.
    ctx.sync = () => { ctx.userData = fs.read('users/' + uid); ctx.spaceData = fs.read('spaces/S'); };
    ctx.sync();
    return ctx;
  };
  return { fs, A: client('A'), B: client('B') };
}
const rule = (id, extra = {}) => ({ id, text: id, by: 'A', freq: 'yearly', month: 11, monthDay: 20, days: [], ...extra });
const ids = list => Array.from(list || [], r => r.id).sort(); // vm 안 배열도 이 realm 배열로 바꿔 비교
const save = (c, mutate) => vm.runInContext('saveRecurring', c)(mutate(clone(vm.runInContext('getAllRecurring()', c))));

test('두 사람이 오래된 화면에서 각자 공유 규칙을 추가해도 둘 다 남는다', async () => {
  const { fs, A, B } = world();
  assert.equal(await save(A, all => [...all, rule('a1', { visibility: 'shared' })]), true);
  assert.equal(await save(B, all => [...all, rule('b1', { by: 'B', visibility: 'shared' })]), true);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['a1', 'b1']);
});

test('오래된 화면의 삭제는 그 규칙만 지우고 상대가 새로 넣은 규칙은 남긴다', async () => {
  const { fs, A, B } = world({ shared: [rule('x', { visibility: 'shared' })] });
  await save(A, all => [...all, rule('y', { visibility: 'shared' })]);
  assert.equal(await save(B, all => all.filter(r => r.id !== 'x')), true);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['y']);
});

test('개인 규칙 변경이 오래된 공유 목록을 덮지 않는다', async () => {
  const { fs, A, B } = world({ personalB: [rule('p', { by: 'B', visibility: 'private' })] });
  await save(A, all => [...all, rule('a1', { visibility: 'shared' })]);
  assert.equal(await save(B, all => all.map(r => (r.id === 'p' ? { ...r, text: '바뀐 개인 일정' } : r))), true);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['a1']);
  assert.equal(fs.read('users/B').personalRecurring[0].text, '바뀐 개인 일정');
});

test('같은 규칙의 서로 다른 칸을 동시에 고치면 두 변경이 모두 남는다', async () => {
  const { fs, A, B } = world({ shared: [rule('x', { visibility: 'shared' })] });
  await save(A, all => all.map(r => (r.id === 'x' ? { ...r, text: '새 이름' } : r)));
  await save(B, all => all.map(r => (r.id === 'x' ? { ...r, remindDayBefore: true } : r)));
  const [x] = fs.read('spaces/S').recurring;
  assert.equal(x.text, '새 이름');
  assert.equal(x.remindDayBefore, true);
});

test('상대가 지운 규칙을 오래된 화면에서 고쳐도 되살아나지 않는다', async () => {
  const { fs, A, B } = world({ shared: [rule('x', { visibility: 'shared' })] });
  await save(A, all => all.filter(r => r.id !== 'x'));
  await save(B, all => all.map(r => (r.id === 'x' ? { ...r, text: '늦은 수정' } : r)));
  assert.deepEqual(ids(fs.read('spaces/S').recurring), []);
});

test('개인→공유 이동은 두 문서에 함께 반영되고 상대의 새 공유 규칙을 지우지 않는다', async () => {
  const { fs, A, B } = world({ personalA: [rule('p', { visibility: 'private' })] });
  await save(B, all => [...all, rule('b1', { by: 'B', visibility: 'shared' })]);
  assert.equal(await save(A, all => all.map(r => (r.id === 'p' ? { ...r, visibility: 'shared' } : r))), true);
  assert.deepEqual(ids(fs.read('users/A').personalRecurring), []);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['b1', 'p']);
});

test('저장이 실패하면 서버·화면 모두 그대로이고 다시 시도하면 반영된다', async () => {
  const { fs, A } = world({ personalA: [rule('p', { visibility: 'private' })] });
  const before = { user: fs.read('users/A'), space: fs.read('spaces/S') };
  fs.hooks.beforeCommit = () => true;
  assert.equal(await save(A, all => all.map(r => (r.id === 'p' ? { ...r, visibility: 'shared' } : r))), false);
  assert.deepEqual(fs.read('users/A'), before.user);
  assert.deepEqual(fs.read('spaces/S'), before.space);
  assert.deepEqual(ids(A.userData.personalRecurring), ['p']);
  assert.deepEqual(ids(A.spaceData.recurring), []);
  fs.hooks.beforeCommit = null;
  assert.equal(await save(A, all => all.map(r => (r.id === 'p' ? { ...r, visibility: 'shared' } : r))), true);
  assert.deepEqual(ids(fs.read('users/A').personalRecurring), []);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['p']);
});

test('공유→개인 이동도 두 문서에 함께 반영된다', async () => {
  const { fs, A, B } = world({ shared: [rule('s', { visibility: 'shared' })] });
  await save(B, all => [...all, rule('b1', { by: 'B', visibility: 'shared' })]);
  assert.equal(await save(A, all => all.map(r => (r.id === 's' ? { ...r, visibility: 'private' } : r))), true);
  assert.deepEqual(ids(fs.read('users/A').personalRecurring), ['s']);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['b1']);
});

test('저장이 끝나기 전에 더 최신 스냅샷을 받았으면 늦은 완료가 화면을 되돌리지 않는다', async () => {
  const { fs, A } = world();
  fs.hooks.afterTransaction = async () => {
    fs.hooks.afterTransaction = null;
    const s = fs.read('spaces/S'); s.recurring.push(rule('b2', { by: 'B', visibility: 'shared' })); fs.put('spaces/S', s);
    A.sync();
  };
  assert.equal(await save(A, all => [...all, rule('a1', { visibility: 'shared' })]), true);
  assert.deepEqual(ids(A.spaceData.recurring), ['a1', 'b2']);
});

test('먼저 시작한 저장이 나중에 끝나도 더 최신 저장의 화면 결과를 되돌리지 않는다', async () => {
  const { fs, A } = world();
  let release;
  fs.hooks.afterTransaction = async () => { fs.hooks.afterTransaction = null; await new Promise(r => { release = r; }); };
  const first = save(A, all => [...all, rule('a1', { visibility: 'shared' })]);
  const second = save(A, all => [...all, rule('a2', { visibility: 'shared' })]);
  assert.equal(await second, true);
  release();
  assert.equal(await first, true);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['a1', 'a2']);
  assert.deepEqual(ids(A.spaceData.recurring), ['a1', 'a2']);
});

test('저장 중 다른 공간으로 바뀌면 새 공간 화면에 예전 공간 결과를 넣지 않는다', async () => {
  const { fs, A } = world();
  fs.put('spaces/S2', { members: ['A'], recurring: [rule('n', { visibility: 'shared' })] });
  fs.hooks.afterTransaction = async () => { fs.hooks.afterTransaction = null; A.spaceId = 'S2'; A.spaceData = fs.read('spaces/S2'); };
  assert.equal(await save(A, all => [...all, rule('a1', { visibility: 'shared' })]), true);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['a1']);
  assert.deepEqual(ids(A.spaceData.recurring), ['n']);
});

test('저장 직전에 끼어든 상대 변경도 남고, 화면은 서버 결과로 맞춰진다', async () => {
  const { fs, A } = world();
  let once = true;
  fs.hooks.beforeCommit = () => {
    if (once) { once = false; const s = fs.read('spaces/S'); s.recurring.push(rule('b1', { by: 'B', visibility: 'shared' })); fs.put('spaces/S', s); }
    return false;
  };
  assert.equal(await save(A, all => [...all, rule('a1', { visibility: 'shared' })]), true);
  assert.deepEqual(ids(fs.read('spaces/S').recurring), ['a1', 'b1']);
  assert.deepEqual(ids(A.spaceData.recurring), ['a1', 'b1']);
});
