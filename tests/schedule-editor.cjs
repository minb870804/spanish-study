const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, chromium } = require('./recurrence.cjs');
const evidence = process.env.MINB_EDITOR_EVIDENCE || path.join(__dirname, '../.omo/evidence/schedule-editor-20260928');
const cases = [];
const test = (name, run) => cases.push({ name, run });
async function open(page, extra = {}) {
  await page.evaluate(extra => {
    spaceData.members = ['A', 'B']; spaceData.memberProfiles.B = { name: '단비' };
    userData.personalDays = { '2030-10-02': { todos: [{ id: 'edit', text: '내성발톱 진료', by: 'A', time: '10:00', location: '레푸스', cat: 'etc', visibility: 'private', ...extra }] } };
    openDayDetail('2030-10-02'); openTodoDetail('2030-10-02', 'edit');
  }, extra);
}
test('editor opens without keyboard focus and reveals optional values on demand', async p => {
  await open(p, { notes: '예약 확인하기', reminderTime: '08:00' });
  assert.equal(await p.evaluate(() => document.activeElement.id), 'todoEditorTitle');
  await p.keyboard.press('Shift+Tab');
  assert.equal(await p.evaluate(() => document.activeElement.type), 'submit');
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), '일정 수정 닫기');
  assert.equal(await p.locator('.todo-editor-options').getAttribute('open'), null);
  assert.equal(await p.locator('[data-end-date]').isVisible(), false);
  assert.match(await p.locator('[data-location-summary]').textContent(), /레푸스/);
  assert.equal(await p.locator('.todo-editor-owner').isVisible(), false);
  await p.locator('input[name=visibility][value=shared]').check();
  assert.equal(await p.locator('.todo-editor-owner').isVisible(), true);
});
test('editor saves changed title and sharing without losing collapsed notes', async p => {
  await open(p, { notes: '예약 확인하기', important: true });
  await p.locator('[name=text]').fill('진료 예약 변경');
  await p.locator('[name=visibility][value=shared]').check();
  await p.locator('[name=ownerChoice][value=both]').check();
  await p.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.todo-editor-modal'));
  const todo = await p.evaluate(() => getDay('2030-10-02').todos[0]);
  assert.equal(todo.text, '진료 예약 변경'); assert.equal(todo.visibility, 'shared');
  assert.equal(todo.notes, '예약 확인하기'); assert.equal(todo.important, true);
});
test('multi-day and all-day switches control fields and saved values', async p => {
  await open(p, { startDate: '2030-10-02', endDate: '2030-10-05', endTime: '11:00' });
  assert.equal(await p.locator('[name=endDate]').isVisible(), true);
  await p.locator('[name=multiDay]').uncheck(); await p.locator('[name=allDay]').check();
  assert.equal(await p.locator('[name=time]').isVisible(), false);
  await p.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.todo-editor-modal'));
  const todo = await p.evaluate(() => getDay('2030-10-02').todos[0]);
  assert.equal(todo.endDate, undefined); assert.equal(todo.time, ''); assert.equal(todo.allDay, true);
});
test('failed save keeps edited values and allows retry', async p => {
  await open(p); await p.evaluate(() => { QA.fail = true; });
  await p.locator('[name=text]').fill('실패해도 남을 내용');
  await p.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await p.locator('.todo-editor-error').waitFor({ state: 'visible' });
  assert.equal(await p.locator('[name=text]').inputValue(), '실패해도 남을 내용');
  await p.evaluate(() => { QA.fail = false; });
  await p.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.todo-editor-modal'));
});
test('dirty close asks before discarding; Escape restores body scrolling', async p => {
  await open(p); await p.locator('[name=text]').fill('보존');
  p.once('dialog', d => d.dismiss()); await p.getByRole('button', { name: '일정 수정 닫기' }).click();
  assert.equal(await p.locator('.todo-editor-modal').count(), 1);
  p.once('dialog', d => d.accept()); await p.keyboard.press('Escape');
  assert.equal(await p.locator('.todo-editor-modal').count(), 0);
  assert.notEqual(await p.evaluate(() => document.body.style.overflow), 'hidden');
});
test('new schedule date and time stay visible while optional fields collapse', async p => {
  await p.evaluate(() => openDayDetail('2030-10-02'));
  assert.equal(await p.locator('#todoStartInput').isVisible(), true);
  assert.equal(await p.locator('#todoTimeInput').isVisible(), true);
  assert.equal(await p.locator('#todoLocationInput').isVisible(), false);
  await p.locator('#todoMultiDayInput').check(); await p.locator('#todoEndInput').fill('2030-10-05');
  await p.locator('#todoOptsToggle').click(); await p.locator('#todoLocationInput').fill('레푸스');
  await p.locator('#todoInput').fill('새 기간 일정');
  await p.locator('button[onclick="addTodo()"]').click();
  await p.waitForFunction(() => QA.writes.length === 1);
  const todo = await p.evaluate(() => getDay('2030-10-02').todos[0]);
  assert.equal(todo.endDate, '2030-10-05'); assert.equal(todo.location, '레푸스');
  assert.equal(await p.locator('#todoEndField').isVisible(), false);
});
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const t of cases) {
      const { page, context, errors } = await fixture(browser);
      try { await t.run(page); assert.deepEqual(errors, []); results.push({ name: t.name, pass: true }); }
      catch (e) { results.push({ name: t.name, pass: false, error: e.message }); }
      finally { await context.close(); }
    }
    for (const width of [375, 768, 1280]) {
      const { page, context } = await fixture(browser, width);
      try {
        await open(page, { reminderTime: '08:00', notes: '진료 전에 예약 확인하기' });
        await page.screenshot({ path: path.join(evidence, `editor-${width}.png`) });
        const geometry = await page.evaluate(() => {
          const body = document.querySelector('.todo-editor-body'), save = document.querySelector('.todo-editor-save');
          const b = save.getBoundingClientRect();
          return { fits: b.bottom <= innerHeight && b.top >= 0, overflow: body.scrollWidth > body.clientWidth, focus: document.activeElement.id };
        });
        assert.equal(geometry.fits, true); assert.equal(geometry.overflow, false);
        await page.locator('.todo-editor-options summary').click();
        await page.locator('[name=notes]').fill('아주 긴 일정 메모 '.repeat(80));
        await page.screenshot({ path: path.join(evidence, `editor-expanded-${width}.png`) });
        await page.evaluate(() => document.body.classList.add('dark'));
        await page.screenshot({ path: path.join(evidence, `editor-dark-${width}.png`) });
        results.push({ name: `layout ${width}`, pass: true, ...geometry });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results)); process.exitCode = results.every(r => r.pass) ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
