// 홈 화면 시각 회귀 하네스 (characterization test)
//
// 목적: index.html 의 인라인 <style> 을 css/app.css 로 옮기는 등의 "모습을 바꾸지 않는" 리팩터링이
// 실제로 아무것도 바꾸지 않았음을 증명한다.
//
// 방식: 렌더된 홈 DOM 의 모든 요소에 대해 getComputedStyle 을 고정 속성 목록으로 뽑아
// tests/fixtures/home-computed-baseline.json 과 비교한다. 폭 375 / 1280 두 곳에서(미디어쿼리 검증).
// 추가로 document.styleSheets 의 순서와 규칙 수를 비교해 누락/순서 변경을 직접 잡는다.
//
// 실행:      MINB_PLAYWRIGHT=<playwright 경로> node tests/home-visual.cjs
// 기준 재생성 (의도한 시각 변경이 있을 때만!):
//            MINB_WRITE_BASELINE=1      node tests/home-visual.cjs   # computed + stylesheets 전부 덮어씀
//            MINB_WRITE_BASELINE=sheets node tests/home-visual.cjs   # stylesheets 항목만 덮어쓰고 computed 는 유지
// MINB_WRITE_BASELINE 이 설정되면 이 스크립트는 "비교를 하지 않고" 기준 파일만 쓰고 종료한다.
// 기준 파일을 재생성하면 이 테스트는 그 순간의 트리를 정답으로 간주하므로, 커밋 전에 diff 를 반드시 검토할 것.
//
// CSS 를 새 파일로 이전(Task 2)하면 stylesheets 항목(시트 순서·시트별 규칙 수)은 "의도적으로" 바뀐다.
// 그때는 MINB_WRITE_BASELINE=sheets 로 그 항목만 갱신하고, computed 항목은 절대 재생성하지 말 것
// (computed 가 그대로여야 "모습이 안 변했다"는 증명이 된다). 규칙 총합(totalRules)은 이전 전후로 같아야 한다.
//
// MINB_ROOT 로 다른 소스 디렉터리를 대상으로 삼을 수 있다(recurrence.cjs 의 fixture 가 처리).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');

const BASELINE_FILE = path.join(__dirname, 'fixtures', 'home-computed-baseline.json');
const WRITE = process.env.MINB_WRITE_BASELINE || '';
const WIDTHS = [375, 1280];
// 오늘 날짜에 의존하는 표시(오늘 강조 등)가 날마다 달라지지 않도록 시계를 고정한다.
const FIXED_NOW = new Date('2026-10-02T12:00:00+09:00');
const PROPS = [
  'display', 'position', 'color', 'backgroundColor', 'backgroundImage', 'fontSize', 'fontWeight',
  'fontFamily', 'lineHeight', 'padding', 'margin', 'border', 'borderRadius', 'boxShadow', 'width',
  'height', 'gap', 'flexDirection', 'justifyContent', 'alignItems', 'textDecorationLine',
];
const MAX_REPORT = 20;

// 페이지 안에서 실행: 모든 요소(+ 내용이 있는 ::before/::after)의 computed style 스냅샷
function snapshotInPage(props) {
  const out = {};
  const pick = (cs) => { const o = {}; for (const p of props) o[p] = cs[p]; return o; };
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (n === document.documentElement) { parts.unshift(tag); break; }
      let i = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
      parts.unshift(`${tag}:nth-of-type(${i})`);
    }
    return parts.join('>');
  };
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
    + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const els = [document.documentElement, ...document.body.querySelectorAll('*')]
    .filter(e => !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(e.tagName));
  for (const el of els) {
    const key = pathOf(el);
    out[key] = { '@': label(el), ...pick(getComputedStyle(el)) };
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content && cs.content !== 'none' && cs.content !== 'normal') out[key + pseudo] = { '@': label(el) + pseudo, content: cs.content, ...pick(cs) };
    }
  }
  return out;
}

// 페이지 안에서 실행: 스타일시트 순서와 (@media 등 중첩 포함) 규칙 수
function sheetsInPage() {
  const count = (rules) => { let n = 0; for (const r of rules) { n++; if (r.cssRules) n += count(r.cssRules); } return n; };
  const sheets = [...document.styleSheets].map((s, i) => {
    let rules = -1; // -1: 읽을 수 없음(교차 출처 등)
    try { rules = count(s.cssRules); } catch (e) { /* 교차 출처 */ }
    return { id: s.href ? s.href.replace(location.origin + '/', '') : `inline#${i}`, rules };
  });
  return { sheets, totalRules: sheets.reduce((a, s) => a + Math.max(s.rules, 0), 0) };
}

const snapshot = (page) => page.evaluate(snapshotInPage, PROPS);
const sheetInfo = (page) => page.evaluate(sheetsInPage);

function diffSnapshots(expected, actual) {
  const diffs = [];
  for (const key of Object.keys(expected)) {
    const a = actual[key];
    if (!a) { diffs.push(`- 사라진 요소: ${key}  (${expected[key]['@']})`); continue; }
    for (const p of Object.keys(expected[key])) {
      if (p === '@') continue;
      if (expected[key][p] !== a[p]) diffs.push(`~ ${key}  (${expected[key]['@']})  ${p}: ${JSON.stringify(expected[key][p])} -> ${JSON.stringify(a[p])}`);
    }
  }
  for (const key of Object.keys(actual)) if (!expected[key]) diffs.push(`+ 새 요소: ${key}  (${actual[key]['@']})`);
  return diffs;
}

const cases = [];
const test = (name, width, run) => cases.push({ name, width, run });
const readBaseline = () => {
  if (!fs.existsSync(BASELINE_FILE)) throw new Error(`기준 파일이 없다: ${BASELINE_FILE}  (MINB_WRITE_BASELINE=1 로 생성)`);
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
};

for (const w of WIDTHS) {
  test(`홈 computed style 이 기준과 같다 (${w}px)`, w, async (p) => {
    const expected = readBaseline().computed[w];
    assert.ok(expected, `기준에 ${w}px 항목이 없다`);
    const actual = await snapshot(p);
    const diffs = diffSnapshots(expected, actual);
    const changedEls = new Set(diffs.map(d => d.split('  ')[0])).size;
    assert.equal(diffs.length, 0,
      `${diffs.length}개 차이 / ${changedEls}개 요소 (기준 ${Object.keys(expected).length}개 요소)\n`
      + diffs.slice(0, MAX_REPORT).join('\n') + (diffs.length > MAX_REPORT ? `\n... 외 ${diffs.length - MAX_REPORT}개` : ''));
  });
}

test('스타일시트 순서와 규칙 수가 기준과 같다', 1280, async (p) => {
  const expected = readBaseline().stylesheets;
  const actual = await sheetInfo(p);
  assert.deepEqual(actual.sheets.map(s => s.id), expected.sheets.map(s => s.id), '스타일시트 순서/목록');
  const perSheet = actual.sheets.map((s, i) => [s.id, expected.sheets[i].rules, s.rules]).filter(([, e, a]) => e !== a);
  assert.equal(perSheet.length, 0, '시트별 규칙 수 차이: ' + perSheet.map(([id, e, a]) => `${id} ${e}->${a}`).join(', '));
  assert.equal(actual.totalRules, expected.totalRules, '전체 CSS 규칙 수');
});

test('콘솔 오류 없이 홈이 뜬다', 375, async (p, errors) => {
  assert.deepEqual(errors, []);
  assert.equal(await p.locator('#monthCal').isVisible(), true);
});

async function writeBaseline(browser) {
  const prev = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : null;
  const computed = {};
  let stylesheets;
  for (const w of WIDTHS) {
    const { page, context } = await fixture(browser, w, 'home', { now: FIXED_NOW });
    try {
      if (WRITE === 'sheets') { if (!prev) throw new Error('sheets 모드는 기존 기준 파일이 필요하다'); }
      else computed[w] = await snapshot(page);
      if (w === 1280) stylesheets = await sheetInfo(page);
    } finally { await context.close(); }
  }
  const data = { computed: WRITE === 'sheets' ? prev.computed : computed, stylesheets };
  // 요소당 한 줄: git diff 로 어느 요소가 바뀌었는지 읽을 수 있게 한다
  const lines = ['{', '"_": "생성물: MINB_WRITE_BASELINE=1 node tests/home-visual.cjs 로 재생성. 손으로 고치지 말 것. 자세한 내용은 tests/home-visual.cjs 머리말 참고",',
    '"computed": {'];
  const widths = Object.keys(data.computed);
  widths.forEach((w, wi) => {
    lines.push(`${JSON.stringify(w)}: {`);
    const keys = Object.keys(data.computed[w]);
    keys.forEach((k, ki) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(data.computed[w][k])}${ki < keys.length - 1 ? ',' : ''}`));
    lines.push('}' + (wi < widths.length - 1 ? ',' : ''));
  });
  lines.push('},', `"stylesheets": ${JSON.stringify(data.stylesheets)}`, '}');
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, lines.join('\n') + '\n');
  const n = Object.values(data.computed).map(c => Object.keys(c).length);
  console.log(`기준 파일 작성(${WRITE}): ${BASELINE_FILE}\n  요소 수 ${WIDTHS.map((w, i) => `${w}px=${n[i]}`).join(' ')}, 시트 ${data.stylesheets.sheets.length}개, 규칙 ${data.stylesheets.totalRules}개`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (WRITE) { await writeBaseline(browser); return; }
    const results = [];
    for (const c of cases) {
      const { page, context, errors } = await fixture(browser, c.width, 'home', { now: FIXED_NOW });
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
