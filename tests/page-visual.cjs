// 네 페이지(스터디·일기장·교환일기·독서) 시각 회귀 하네스
//
// 목적: 공용 스타일시트(css/paper.css)와 페이지별 이모지 정리가 "의도한 곳만" 바꾸었음을 증명한다.
// 방식: tests/home-visual.cjs 와 같다. 각 페이지 모든 요소의 getComputedStyle 을 375/1280 에서 떠서
// tests/fixtures/pages-computed-baseline.json 과 비교하고, 시트 순서·규칙 수·cssHash 도 비교한다.
//
// 페이지는 로그인 전 상태로 열린다(fixture 가 인증 콜백을 부르지 않는다). 헤더·로그인 화면·정적 본문은
// 그려지지만 로그인 후에만 채워지는 목록은 비어 있다. 그 부분은 스냅샷이 아니라 행동 테스트와 정적 검사로 지킨다.
//
// 실행:       MINB_PLAYWRIGHT=<playwright 경로> node tests/page-visual.cjs
// 기준 재생성: MINB_WRITE_BASELINE=1 node tests/page-visual.cjs                      # 네 페이지 전부
//             MINB_WRITE_BASELINE=1 MINB_WRITE_PAGES=diary.html node tests/page-visual.cjs   # 그 페이지만
//
// 스냅샷이 증명하지 못하는 것: 동적 목록 행(일기 항목, 교환일기 스레드, 독서 목록 항목), 모달, :hover/:focus 상태는
// 스냅샷에 들어 있지 않다(로그인 전이라 비어 있거나 열려 있지 않다). 스냅샷이 통과해도 이들에 대해서는 아무것도 증명되지 않으므로,
// 이후 태스크는 이 부분을 행동 테스트(test() 로 등록)나 정적 소스 검사로 따로 지켜야 한다.
// 재생성 전에 반드시 실패 메시지의 차이를 읽고 전부 의도한 변경인지 확인할 것.
const fs = require('node:fs');
const path = require('node:path');
const { fixture, chromium } = require('./recurrence.cjs');
const { snapshot, sheetInfo, diffSnapshots, MAX_REPORT } = require('./home-visual.cjs');

const BASELINE_FILE = path.join(__dirname, 'fixtures', 'pages-computed-baseline.json');
const WRITE = process.env.MINB_WRITE_BASELINE || '';
const WRITE_PAGES = (process.env.MINB_WRITE_PAGES || '').split(',').map(s => s.trim()).filter(Boolean);
const PAGES = ['study.html', 'diary.html', 'shared-diary.html', 'reading.html'];
const WIDTHS = [375, 1280];
const FIXED_NOW = new Date('2026-10-02T12:00:00+09:00');

const cases = [];
const test = (name, page, width, run) => cases.push({ name, page, width, run });
// study.html 은 로드 때 "오늘의 표현"을 Math.random 으로 고른다(initUI). 문구마다 글자 폭이 달라 span 의 width 가
// 실행마다 흔들리므로, 열자마자 0번 문구로 고정한다. 그 외에는 아무것도 건드리지 않는다.
const pinRandom = p => p.evaluate(() => {
  if (typeof PHRASES === 'undefined' || !document.getElementById('pod-es')) return;
  phraseIdx = 0;
  document.getElementById('pod-es').textContent = PHRASES[0].es;
  document.getElementById('pod-ko').textContent = PHRASES[0].ko;
  document.getElementById('pod-pron').textContent = PHRASES[0].pron;
});
const open = async (browser, page, width) => {
  const f = await fixture(browser, width, 'x', { page, now: FIXED_NOW });
  await pinRandom(f.page);
  return f;
};
const readBaseline = () => JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

for (const page of PAGES) {
  for (const w of WIDTHS) {
    test(`${page} computed style 이 기준과 같다 (${w}px)`, page, w, async p => {
      await p.waitForTimeout(400);
      const expected = readBaseline()[page].computed[w];
      const actual = await snapshot(p);
      const diffs = diffSnapshots(expected, actual);
      if (diffs.length) {
        const shown = diffs.slice(0, MAX_REPORT).join('\n');
        throw new Error(`${diffs.length}건 다름\n${shown}${diffs.length > MAX_REPORT ? `\n… 외 ${diffs.length - MAX_REPORT}건` : ''}`);
      }
    });
  }
  test(`${page} 스타일시트 순서와 규칙 수가 기준과 같다`, page, 1280, async p => {
    await p.waitForTimeout(400);
    const expected = readBaseline()[page].stylesheets;
    const actual = await sheetInfo(p);
    const problems = [];
    const ids = s => s.sheets.map(x => x.id);
    if (JSON.stringify(ids(expected)) !== JSON.stringify(ids(actual))) {
      problems.push(`시트 목록이 다르다\n  기준: ${ids(expected).join(' | ')}\n  실제: ${ids(actual).join(' | ')}`);
    }
    if (expected.totalRules !== actual.totalRules) problems.push(`규칙 수: 기준 ${expected.totalRules}, 실제 ${actual.totalRules}`);
    if (expected.cssHash !== actual.cssHash) problems.push(`cssHash 가 다르다 (규칙 텍스트나 순서가 바뀌었다)`);
    if (problems.length) throw new Error(problems.join('\n'));
  });
}

// 요소당 한 줄로 쓴다(tests/home-visual.cjs 와 같은 배치): git diff 한 줄 = 요소 하나
function serialize(data) {
  const lines = ['{', '"_": "생성물: MINB_WRITE_BASELINE=1 node tests/page-visual.cjs 로 재생성(MINB_WRITE_PAGES 로 페이지 지정). 손으로 고치지 말 것. 자세한 내용은 tests/page-visual.cjs 머리말 참고",'];
  const pages = PAGES.filter(pg => data[pg]);
  pages.forEach((pg, pi) => {
    lines.push(`${JSON.stringify(pg)}: {`, '"computed": {');
    const widths = Object.keys(data[pg].computed);
    widths.forEach((w, wi) => {
      lines.push(`${JSON.stringify(w)}: {`);
      const keys = Object.keys(data[pg].computed[w]);
      keys.forEach((k, ki) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(data[pg].computed[w][k])}${ki < keys.length - 1 ? ',' : ''}`));
      lines.push('}' + (wi < widths.length - 1 ? ',' : ''));
    });
    lines.push('},', `"stylesheets": ${JSON.stringify(data[pg].stylesheets)}`, '}' + (pi < pages.length - 1 ? ',' : ''));
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

async function writeBaseline(browser) {
  const prev = fs.existsSync(BASELINE_FILE) ? readBaseline() : {};
  const targets = WRITE_PAGES.length ? WRITE_PAGES : PAGES;
  for (const t of targets) if (!PAGES.includes(t)) throw new Error(`모르는 페이지: ${t}`);
  const out = { ...prev };
  for (const page of targets) {
    const entry = { computed: {} };
    for (const w of WIDTHS) {
      const { page: p, context } = await open(browser, page, w);
      try {
        await p.waitForTimeout(400);
        entry.computed[w] = await snapshot(p);
        if (w === 1280) entry.stylesheets = await sheetInfo(p);
      } finally { await context.close(); }
    }
    out[page] = entry;
    console.log(`기준 기록: ${page} (375: ${Object.keys(entry.computed[375]).length}개, 1280: ${Object.keys(entry.computed[1280]).length}개 요소)`);
  }
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, serialize(out));
}

module.exports = { test, PAGES, FIXED_NOW };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  try {
    if (WRITE) { await writeBaseline(browser); return; }
    const results = [];
    for (const c of cases) {
      const { page, context, errors } = await open(browser, c.page, c.width);
      try {
        await c.run(page, errors);
        results.push({ name: c.name, pass: true });
        console.log('PASS ' + c.name);
      } catch (e) {
        results.push({ name: c.name, pass: false, error: e.message });
        console.log('FAIL ' + c.name + ' — ' + e.message);
      } finally { await context.close(); }
    }
    console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
    process.exitCode = results.every(r => r.pass) ? 0 : 1;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
