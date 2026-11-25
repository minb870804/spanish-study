// 서버 알림(sendTodoReminders)의 예전 저장 방식 경로가, 푸시를 보내는 사이 사용자가 바꾼 할 일을
// 오래된 배열로 덮지 않는지 확인한다. functions/index.js 의 실제 핸들러를 메모리 Firestore·가짜 web-push로 돌린다.
// firebase-admin·firebase-functions·web-push 는 require 단계에서 대역으로 바꿔 실제 서비스에 접속하지 않는다.
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFirestore, FieldPath, FieldValue } = require('./fake-firestore.cjs');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
const KEY = '2026-11-07';
const NOW = Date.parse('2026-11-07T09:00:00+09:00');

function load(fs, onSend) {
  const sends = [];
  const fakes = {
    'firebase-functions/v2/scheduler': { onSchedule: (opts, fn) => fn },
    'firebase-functions/v2/https': { onCall: (opts, fn) => fn, HttpsError: class extends Error {} },
    'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
    'firebase-admin': { initializeApp() {}, firestore: Object.assign(() => fs.db, { FieldValue, FieldPath }) },
    'web-push': { setVapidDetails() {}, sendNotification: async (sub, payload) => { sends.push(JSON.parse(payload)); if (onSend) onSend(JSON.parse(payload)); } }
  };
  const original = Module._load;
  const file = require.resolve(path.join(root, 'functions', 'index.js'));
  process.env.VAPID_PUBLIC_KEY = 'test-public'; process.env.VAPID_PRIVATE_KEY = 'test-private';
  Module._load = function (request, ...rest) { return fakes[request] || original.call(this, request, ...rest); };
  try { delete require.cache[file]; return { fn: require(file), sends }; } finally { Module._load = original; }
}
function world(todos, owner = 'space') {
  const fs = createFirestore();
  fs.put('users/A', { spaceId: 'S', pushSubscriptions: { s1: { endpoint: 'https://push.test/1', keys: {} } }, ...(owner === 'user' ? { personalDays: { [KEY]: { todos } } } : {}) });
  fs.put('spaces/S', { members: ['A'], ...(owner === 'space' ? { days: { [KEY]: { todos } } } : {}) });
  return fs;
}
const todo = (id, extra = {}) => ({ id, text: id, by: 'A', remindAtMs: NOW - 60000, ...extra });
const legacyTodos = (fs, owner = 'space') => owner === 'space' ? fs.read('spaces/S').days[KEY].todos : fs.read('users/A').personalDays[KEY].todos;
const edit = (fs, fn, owner = 'space') => { const p = owner === 'space' ? 'spaces/S' : 'users/A'; const d = fs.read(p); fn(d[owner === 'space' ? 'days' : 'personalDays'][KEY].todos, d); fs.put(p, d); };
async function run(fn) { const realNow = Date.now; Date.now = () => NOW; try { await fn.sendTodoReminders(); } finally { Date.now = realNow; } }

test('푸시를 보내는 사이 추가·수정된 할 일이 남고, 보낸 할 일만 표시된다', async () => {
  const fs = world([todo('t1'), todo('t2', { remindAtMs: NOW + 3600000 })]);
  const { fn, sends } = load(fs, () => edit(fs, list => { list[1].text = '바뀐 할 일'; list.push({ id: 't3', text: '새 할 일', by: 'A' }); }));
  await run(fn);
  const list = legacyTodos(fs);
  assert.deepEqual(list.map(t => t.id), ['t1', 't2', 't3']);
  assert.equal(list[1].text, '바뀐 할 일');
  assert.equal(list[0].reminderSentAt, NOW);
  assert.equal(list[1].reminderSentAt, undefined);
  assert.equal(sends.length, 1);
});

test('푸시를 보내는 사이 지운 할 일은 되살아나지 않는다', async () => {
  const fs = world([todo('t1'), { id: 't2', text: '남길 일', by: 'A' }]);
  const { fn } = load(fs, () => edit(fs, list => list.splice(0, 1)));
  await run(fn);
  assert.deepEqual(legacyTodos(fs).map(t => t.id), ['t2']);
});

test('푸시를 보내는 사이 알림 시간을 바꾸면 새 알림을 보낸 것으로 표시하지 않는다', async () => {
  const fs = world([todo('t1')]);
  const later = NOW + 7200000;
  const { fn } = load(fs, () => edit(fs, list => { list[0].remindAtMs = later; }));
  await run(fn);
  const [t1] = legacyTodos(fs);
  assert.equal(t1.remindAtMs, later);
  assert.equal(t1.reminderSentAt, undefined);
});

test('푸시를 보내는 사이 담당자가 바뀌면 이전 담당자에게 보낸 결과를 새 담당 할 일에 표시하지 않는다', async () => {
  const fs = world([todo('t1')]);
  const { fn } = load(fs, () => edit(fs, list => { list[0].by = 'B'; }));
  await run(fn);
  const [t1] = legacyTodos(fs);
  assert.equal(t1.by, 'B');
  assert.equal(t1.reminderSentAt, undefined);
});

test('하루 넘게 지난 알림 건너뛰기 표시도 동시에 추가된 할 일을 지우지 않는다', async () => {
  const fs = world([todo('old', { remindAtMs: NOW - 2 * 86400000 }), todo('t1')]);
  const { fn } = load(fs, () => edit(fs, list => list.push({ id: 't3', text: '새 할 일', by: 'A' })));
  await run(fn);
  const list = legacyTodos(fs);
  assert.deepEqual(list.map(t => t.id), ['old', 't1', 't3']);
  assert.equal(list[0].reminderSkippedAt, NOW);
  assert.equal(list[1].reminderSentAt, NOW);
});

test('푸시를 보내는 사이 월별 저장으로 옮겨졌으면 잠긴 예전 위치를 고치지 않는다', async () => {
  const fs = world([todo('t1')]);
  const { fn } = load(fs, () => { const d = fs.read('spaces/S'); d.dayStorage = 2; fs.put('spaces/S', d); });
  await run(fn);
  assert.equal(legacyTodos(fs)[0].reminderSentAt, undefined);
});

test('개인 일정 경로도 푸시 사이 추가된 할 일을 지우지 않는다', async () => {
  const fs = world([todo('t1')], 'user');
  const { fn } = load(fs, () => edit(fs, list => list.push({ id: 't3', text: '새 개인 일정', by: 'A' }), 'user'));
  await run(fn);
  const list = legacyTodos(fs, 'user');
  assert.deepEqual(list.map(t => t.id), ['t1', 't3']);
  assert.equal(list[0].reminderSentAt, NOW);
});

test('저장 transaction이 다시 실행돼도 푸시는 한 번만 보낸다', async () => {
  const fs = world([todo('t1')]);
  let interfered = false;
  fs.hooks.beforeCommit = writes => {
    if (!interfered && writes.some(w => w.path === 'spaces/S')) { interfered = true; edit(fs, list => list.push({ id: 't3', text: '끼어든 할 일', by: 'A' })); }
    return false;
  };
  const { fn, sends } = load(fs);
  await run(fn);
  assert.ok(fs.stats.retries > 0, 'transaction이 실제로 다시 실행돼야 한다');
  assert.equal(sends.length, 1);
  assert.deepEqual(legacyTodos(fs).map(t => t.id), ['t1', 't3']);
  assert.equal(legacyTodos(fs)[0].reminderSentAt, NOW);
});
