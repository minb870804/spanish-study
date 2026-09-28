const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { page, context, errors } = await fixture(browser);
    try {
      await page.evaluate(() => {
        firebase.firestore.FieldPath = class { constructor(...parts) { this.parts = parts; } };
        firebase.firestore.FieldValue.delete = () => ({ delete: true });
        const collection = path => ({
          doc: id => ({ path: `${path}/${id}`, collection: child => collection(`${path}/${id}/${child}`) }),
          onSnapshot: cb => { cb({ docs: [] }); return () => {}; }
        });
        db.collection = collection;
        db.batch = () => {
          const writes = [];
          return {
            set: (ref, data, options) => writes.push({ path: ref.path, data, options }),
            update: () => { throw Error('Migrated schedules must not write legacy documents'); },
            commit: async () => { if (QA.fail) throw Error('test write failure'); QA.writes.push(writes); }
          };
        };
        userData.dayStorage = spaceData.dayStorage = 2;
        ensureDayStorage('personal', 'A', userData);
        ensureDayStorage('shared', 'space', spaceData);
        requestPushPermission = async () => false;
        openDayDetail('2030-01-01');
      });
      await page.locator('#todoInput').fill('월별 공유 일정');
      await page.locator('#todoShareInput').check();
      await page.locator('button[onclick="addTodo()"]').click();
      await page.waitForFunction(() => QA.writes.length === 1);
      const state = await page.evaluate(() => ({ writes: QA.writes.flat(), shared: sharedDaysMap()['2030-01-01'], legacy: spaceData.days }));
      assert(state.writes.some(w => w.path === 'spaces/space/dayMonths/2030-01'));
      assert(state.writes.every(w => w.path.includes('/dayMonths/')));
      assert.equal(state.shared.todos[0].text, '월별 공유 일정');
      assert.deepEqual(state.legacy, {});
      console.log('PASS migrated account creates schedule only in monthly documents');
      await page.evaluate(async () => { QA.fail = true; await copyCalendarTodo('2030-01-01', '2030-02-02', getDay('2030-01-01').todos[0].id); });
      assert.equal(await page.evaluate(() => getDay('2030-02-02').todos.length), 0);
      assert.match(await page.locator('#toast').textContent(), /저장에 실패/);
      console.log('PASS failed monthly copy rolls back destination');
      await page.evaluate(async () => { QA.fail = false; await copyCalendarTodo('2030-01-01', '2030-02-02', getDay('2030-01-01').todos[0].id); });
      assert(await page.evaluate(() => QA.writes.flat().some(w => w.path === 'spaces/space/dayMonths/2030-02')));
      assert.equal(await page.evaluate(() => getDay('2030-01-01').todos.length), 1);
      assert.equal(await page.evaluate(() => getDay('2030-02-02').todos.length), 1);
      assert.deepEqual(errors, []);
      console.log('PASS copy preserves original and writes destination month');
    } finally { await context.close(); }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
