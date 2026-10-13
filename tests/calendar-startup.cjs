const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(process.env.MINB_ROOT || path.join(__dirname, '..'), 'js/dashboard-ux.js'), 'utf8');
const results = [];
function fixture(width = 375, cached = {}) {
  const storage = new Map(Object.entries(cached));
  const writes = [];
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: width <= 767 }) },
    document: { addEventListener() {}, getElementById: () => null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    currentUser: null, userData: null, selectedDate: new Date(2026, 9, 13),
    toast() {}, db: { collection: name => ({ doc: uid => ({ update: async value => writes.push({ name, uid, value }) }) }) }
  });
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), storage, writes };
}
async function test(name, run) {
  try { await run(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); }
}
(async () => {
  for (const width of [375, 767, 768, 1280]) {
    await test(`first render defaults to month at ${width}px before authentication`, () => {
      const app = fixture(width);
      assert.equal(app.run('calendarView'), 'month');
      assert.equal(app.run('sanitizeUiPreferences(null).calendarView'), 'month');
      assert.equal(app.run('sanitizeUiPreferences({calendarView:"invalid"}).calendarView'), 'month');
    });
  }
  await test('delayed account month preference never changes initial month', () => {
    const app = fixture();
    const views = [app.run('calendarView')];
    app.run('currentUser={uid:"A"}; initializeUiPreferences("A")');
    views.push(app.run('calendarView'));
    app.run('userData={uiPreferences:{calendarView:"month"}}; syncUiPreferences()');
    views.push(app.run('calendarView'));
    assert.deepEqual(views, ['month', 'month', 'month']);
    assert.equal(app.writes.length, 0);
  });
  await test('explicit cached week is restored before the account snapshot', () => {
    const app = fixture(375, { 'minb-ui-preferences:A': JSON.stringify({ preferences: { calendarView: 'week' }, pending: false }) });
    app.run('currentUser={uid:"A"}; initializeUiPreferences("A")');
    assert.equal(app.run('calendarView'), 'week');
    app.run('userData={uiPreferences:{calendarView:"week"}}; syncUiPreferences()');
    assert.equal(app.run('calendarView'), 'week');
  });
  await test('week selection persists and restores for the same account', async () => {
    const app = fixture();
    app.run('currentUser={uid:"A"}; userData={}; syncUiPreferences(); setCalendarView("week")');
    await Promise.resolve();
    assert.equal(app.writes[0].value['uiPreferences.calendarView'], 'week');
    const restored = fixture(375, Object.fromEntries(app.storage));
    restored.run('initializeUiPreferences("A")');
    assert.equal(restored.run('calendarView'), 'week');
    restored.run('initializeUiPreferences("B")');
    assert.equal(restored.run('calendarView'), 'month');
  });
  await test('pending local week selection survives an older month snapshot', async () => {
    const app = fixture(375, { 'minb-ui-preferences:A': JSON.stringify({ preferences: { calendarView: 'week' }, pending: true }) });
    app.run('currentUser={uid:"A"}; userData={uiPreferences:{calendarView:"month"}}; syncUiPreferences()');
    await Promise.resolve();
    assert.equal(app.run('calendarView'), 'week');
    assert.equal(app.writes[0].value['uiPreferences.calendarView'], 'week');
  });
  const output = process.env.MINB_RESULTS || path.join(__dirname, '../.omo/evidence/calendar-startup/results.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.every(result => result.pass) ? 0 : 1;
})();
