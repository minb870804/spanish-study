const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('new schedule saves even while notification permission is unresolved', async page => {
  await page.evaluate(() => { requestPushPermission = () => new Promise(resolve => { window.releasePermission = resolve; }); });
  await page.locator('#todoInput').fill('알림과 별개로 저장할 일정');
  await page.locator('button[onclick="addTodo()"]').click();
  await page.waitForFunction(() => QA.writes.length === 1, null, { timeout: 1500 });
  assert.equal(await page.locator('#todoInput').inputValue(), '');
  assert.equal(await page.evaluate(() => getDay('2030-01-01').todos[0].text), '알림과 별개로 저장할 일정');
  await page.evaluate(() => window.releasePermission?.(false));
});

test('new schedule with failed storage retains its draft and does not request notifications', async page => {
  await page.evaluate(() => { QA.fail = true; QA.permissionCalls = 0; requestPushPermission = async () => { QA.permissionCalls++; return false; }; });
  await page.locator('#todoInput').fill('실패 후 다시 저장할 일정');
  await page.locator('button[onclick="addTodo()"]').click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('저장에 실패'));
  assert.equal(await page.locator('#todoInput').inputValue(), '실패 후 다시 저장할 일정');
  assert.equal(await page.evaluate(() => getDay('2030-01-01').todos.length), 0);
  assert.equal(await page.evaluate(() => QA.permissionCalls), 0);
  await page.evaluate(() => { QA.fail = false; });
  await page.locator('button[onclick="addTodo()"]').click();
  await page.waitForFunction(() => QA.writes.length === 1);
  assert.equal(await page.evaluate(() => getDay('2030-01-01').todos.length), 1);
});

test('copy failure does not leave a phantom schedule or announce success', async page => {
  await page.evaluate(() => {
    userData.personalDays = { '2030-01-01': { todos: [{ id: 'source', text: '원본', by: 'A' }] }, '2030-01-02': { todos: [{ id: 'existing', text: '기존 대상 일정', by: 'A' }] } };
    QA.fail = true;
    return copyCalendarTodo('2030-01-01', '2030-01-02', 'source');
  });
  assert.deepEqual(await page.evaluate(() => getDay('2030-01-02').todos.map(t => t.id)), ['existing']);
  assert.match(await page.locator('#toast').textContent(), /저장에 실패/);
});

test('copy date picker preserves original and carries schedule details to another date', async page => {
  await page.evaluate(() => {
    userData.personalDays = { '2030-01-01': { todos: [{ id: 'source', text: '복사할 일정', by: 'A', time: '10:00', location: '도서관', done: true, startDate: '2030-01-01', endDate: '2030-01-03' }] } };
    renderAll();
  });
  const row = page.locator('#dayModal .todo-item[data-id="source"]');
  await row.getByRole('button', { name: '더보기', exact: true }).click();
  await row.getByRole('button', { name: '다른 날짜에 한 번 복사', exact: true }).click();
  await page.locator('#moveDateInput').fill('2030-01-05');
  await page.locator('#moveDateConfirmBtn').click();
  await page.waitForFunction(() => QA.writes.length === 1);
  const data = await page.evaluate(() => ({ original: getDay('2030-01-01').todos[0], copy: getDay('2030-01-05').todos[0] }));
  assert.equal(data.original.id, 'source');
  assert.equal(data.original.done, true);
  assert.notEqual(data.copy.id, 'source');
  assert.equal(data.copy.done, false);
  assert.equal(data.copy.time, '10:00');
  assert.equal(data.copy.location, '도서관');
  assert.equal(data.copy.startDate, '2030-01-05');
  assert.equal(data.copy.endDate, '2030-01-07');
});

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  let failures = 0;
  try {
    for (const { name, run } of cases) {
      const { page, context, errors } = await fixture(browser, 390);
      try {
        await page.evaluate(() => openDayDetail('2030-01-01'));
        await run(page);
        assert.deepEqual(errors, []);
        console.log('PASS', name);
      } catch (error) { failures++; console.log('FAIL', name, error.message); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
