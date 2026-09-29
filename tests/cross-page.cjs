// 홈 밖 페이지 회귀 — 공유 CSS(ui.css/app-design.css)를 바꿀 때 홈 스냅샷이 못 보는 부분을 지킨다.
// 실행: MINB_PLAYWRIGHT=<playwright 경로> node tests/cross-page.cjs
// 카드 호버는 다른 페이지에서도 조용해야 한다(그림자가 커지지 않는다). study.html 은 자체 .card:hover 로
// 더 큰 그림자를 정의하므로, 공유 CSS 의 호버 규칙이 그것을 눌러야 한다.
const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');

const QUIET = 'rgba(62, 52, 40, 0.04) 0px 2px 8px 0px'; // --ui-shadow
const PAGES = [
  ['study.html', '.card'],
  ['reading.html', '.reading-card'],
  ['diary.html', '.card'],
  ['shared-diary.html', '.card'],
];
let browser;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

for (const [page, sel] of PAGES) {
  for (const dark of [false, true]) {
    test(`${page} 카드 호버 그림자는 평상시와 같다 (${dark ? '다크' : '라이트'})`, async () => {
      const { page: p, context, errors } = await fixture(browser, 1280, 'x', { page });
      try {
        if (dark) await p.evaluate(() => document.body.classList.add('dark'));
        const el = p.locator(sel).first();
        await el.scrollIntoViewIfNeeded();
        const rest = await el.evaluate(e => getComputedStyle(e).boxShadow);
        assert.equal(rest, QUIET, '평상시 ' + rest);
        await el.hover({ force: true });
        await p.waitForTimeout(500); // transition 이 끝난 뒤 잰다
        const hover = await el.evaluate(e => getComputedStyle(e).boxShadow);
        assert.equal(hover, QUIET, '호버 ' + hover);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
}

if (require.main === module) (async () => {
  const b = browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const t of cases) {
      try { await t.fn(); results.push({ name: t.name, pass: true }); console.log('PASS ' + t.name); }
      catch (e) { results.push({ name: t.name, pass: false, error: e.message }); console.log('FAIL ' + t.name + ' — ' + e.message); }
    }
  } finally { await b.close(); }
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})();
