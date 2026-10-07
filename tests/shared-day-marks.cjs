const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(process.env.MINB_ROOT || path.join(__dirname, '..'), 'index.html'), 'utf8');
const extract = name => html.slice(html.indexOf('function ' + name + '('), html.indexOf('\n}', html.indexOf('function ' + name + '(')) + 2);
const markSource = html.slice(html.indexOf('function getPeriodDays()'), html.indexOf('function renderDayPeriodToggle()'));
const clone = data => JSON.parse(JSON.stringify(data));
function fixture() {
  const docs = { shared: { members: ['A', 'B'], loveDays: {} }, old: { members: ['A'], loveDays: {} } };
  const listeners = [];
  const pending = [];
  const state = { fail: false, hold: false, writes: 0 };
  const emit = id => listeners.filter(l => l.active && l.collection === 'spaces' && l.id === id).forEach(l => l.cb({ exists: true, data: () => clone(docs[id]) }));
  function client(uid, id = 'shared') {
    const context = vm.createContext({
      console: { error() {} }, currentUser: { uid }, spaceId: id, spaceData: clone(docs[id]), userData: { spaceId: id }, unsubSpace: null, unsubUser: null,
      renderAll() {}, syncUiPreferences() {}, renderStudyStats() {}, ensureDayStorage() {}, resetDayStorage() {}, toast() {},
      firebase: { firestore: { FieldValue: { serverTimestamp: () => 1, delete: () => '__DELETE__' } } },
      db: { collection: collection => ({ doc: id => ({
        onSnapshot(cb) { const item = { collection, id, cb, active: true }; listeners.push(item); return () => { item.active = false; }; },
        async update(data) {
          state.writes++;
          if (state.hold) await new Promise(resolve => pending.push(resolve));
          if (state.fail) throw Error('write rejected');
          for (const [key, value] of Object.entries(data)) {
            const [field, date] = key.split('.');
            if (date) { docs[id][field] ||= {}; if (value === '__DELETE__') delete docs[id][field][date]; else docs[id][field][date] = value; }
            else docs[id][field] = clone(value);
          }
          emit(id);
        }
      }) }) }
    });
    vm.runInContext(markSource + '\n' + extract('subscribeSpace') + '\n' + extract('subscribeUser'), context);
    context.subscribeSpace();
    return context;
  }
  return { client, docs, state, pending, emitUser(uid, data) { listeners.filter(l => l.active && l.collection === 'users' && l.id === uid).forEach(l => l.cb({ exists: true, data: () => clone(data) })); } };
}
test('one spouse marks and the other sees and removes the shared day', async () => {
  const f = fixture(), a = f.client('A'), b = f.client('B');
  await a.toggleLoveDay('2026-10-07');
  assert.equal(b.isLoveDay('2026-10-07'), true);
  await b.toggleLoveDay('2026-10-07');
  assert.equal(a.isLoveDay('2026-10-07'), false);
});
test('stale spouse snapshot must not erase another date', async () => {
  const f = fixture(), a = f.client('A'), b = f.client('B');
  const stale = clone(b.spaceData);
  await a.toggleLoveDay('2026-10-07');
  b.spaceData = stale;
  await b.toggleLoveDay('2026-10-08');
  assert.deepEqual(f.docs.shared.loveDays, { '2026-10-07': true, '2026-10-08': true });
});
test('failed save does not leave a mark visible only to its author', async () => {
  const f = fixture(), a = f.client('A'), b = f.client('B'); f.state.fail = true;
  await a.toggleLoveDay('2026-10-07');
  assert.equal(a.isLoveDay('2026-10-07'), false);
  assert.equal(b.isLoveDay('2026-10-07'), false);
});
test('repeated click during saving writes once', async () => {
  const f = fixture(), a = f.client('A'); f.state.hold = true;
  const first = a.toggleLoveDay('2026-10-07'), second = a.toggleLoveDay('2026-10-07');
  const writes = f.state.writes;
  f.pending.forEach(resolve => resolve()); await Promise.all([first, second]);
  assert.equal(writes, 1);
  assert.equal(a.isLoveDay('2026-10-07'), true);
});
test('authoritative user space change reconnects a stale cached account', async () => {
  const f = fixture(), a = f.client('A', 'old'), b = f.client('B');
  a.subscribeUser(); f.emitUser('A', { spaceId: 'shared' });
  await b.toggleLoveDay('2026-10-07');
  assert.equal(a.spaceId, 'shared');
  assert.equal(a.isLoveDay('2026-10-07'), true);
});
test('shared period marker preserves other dates too', async () => {
  const f = fixture(), a = f.client('A'); f.docs.shared.periodDays = { '2026-10-06': true };
  await a.togglePeriodDay('2026-10-07');
  assert.deepEqual(f.docs.shared.periodDays, { '2026-10-06': true, '2026-10-07': true });
});
test('failed removal keeps the previously shared record', async () => {
  const f = fixture(), a = f.client('A'), b = f.client('B');
  await a.toggleLoveDay('2026-10-07'); f.state.fail = true;
  await b.toggleLoveDay('2026-10-07');
  assert.equal(a.isLoveDay('2026-10-07'), true);
  assert.equal(b.isLoveDay('2026-10-07'), true);
});
test('late save from previous space never marks the new space', async () => {
  const f = fixture(), a = f.client('A', 'old');
  a.subscribeUser(); f.state.hold = true;
  const save = a.toggleLoveDay('2026-10-07');
  f.emitUser('A', { spaceId: 'shared' });
  f.pending.forEach(resolve => resolve()); await save;
  assert.equal(a.spaceId, 'shared');
  assert.equal(a.isLoveDay('2026-10-07'), false);
  assert.deepEqual(f.docs.shared.loveDays, {});
});
