const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');

const cases = [];
const test = (name, mode, run) => cases.push({ name, mode, run });
const css = (page, sel, prop) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  if (!el) throw new Error('없는 요소: ' + s);
  return getComputedStyle(el)[p];
}, [sel, prop]);

// ── 기준값: 2026-09-29 측정. Task 2(CSS 이전)가 모습을 바꾸지 않았음을 증명한다 ──
const BASELINE = [
  ['body', 'backgroundColor', 'rgb(245, 243, 238)'],
  ['body', 'color', 'rgb(27, 29, 31)'],
  ['header', 'backgroundColor', 'rgb(255, 255, 255)'],
  ['header', 'backgroundImage', 'none'],
  ['header', 'borderBottomWidth', '1px'],
  ['.card', 'backgroundColor', 'rgb(255, 255, 255)'],
  ['.app-nav', 'position', 'fixed'],
  ['.app-nav', 'height', '68px'],
  ['.small-btn', 'minHeight', '44px'],
];

test('홈 기준 스타일이 유지된다', 'home', async p => {
  for (const [sel, prop, expected] of BASELINE) {
    assert.equal(await css(p, sel, prop), expected, `${sel} ${prop}`);
  }
});

test('콘솔 오류 없이 홈이 뜬다', 'home', async (p, errors) => {
  assert.deepEqual(errors, []);
  assert.equal(await p.locator('#monthCal').isVisible(), true);
});

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const c of cases) {
      const { page, context, errors } = await fixture(browser, 375, c.mode);
      try {
        await c.run(page, errors);
        results.push({ name: c.name, pass: true });
        console.log('PASS ' + c.name);
      } catch (e) {
        results.push({ name: c.name, pass: false, error: e.message });
        console.log('FAIL ' + c.name + ' — ' + e.message);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
