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
// 안전장치: computed 스냅샷은 :hover/:focus/:active, 캡처한 두 폭 사이의 미디어쿼리, 필요할 때 생성되는 DOM 을 볼 수 없다.
// 그래서 stylesheets 항목에는 (1) 규칙 총합 totalRules 와 (2) 모든 시트의 모든 규칙 cssText 를 캐스케이드 순서로 이어 붙인
// sha256(cssHash) 도 저장한다. 단순 "이동"(인라인 <style> -> css/app.css, 같은 위치)은 시트 정체(id)만 바꾸고
// totalRules 와 cssHash 는 그대로 둔다. 따라서 MINB_WRITE_BASELINE=sheets 는 이 둘 중 하나라도 바뀌면
// 기준 파일을 쓰지 않고 오류로 종료한다(규칙 하나가 사라지거나 순서/내용이 바뀐 것을 조용히 받아들이지 않기 위해).
//
// MINB_ROOT 로 다른 소스 디렉터리를 대상으로 삼을 수 있다(recurrence.cjs 의 fixture 가 처리).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

// 페이지 안에서 실행: 스타일시트 순서와 (@media 등 중첩 포함) 규칙 수, 그리고 모든 규칙의 cssText(캐스케이드 순서)
function sheetsInPage() {
  const count = (rules) => { let n = 0; for (const r of rules) { n++; if (r.cssRules) n += count(r.cssRules); } return n; };
  const texts = [];
  for (const s of document.styleSheets) {
    try { for (const r of s.cssRules) texts.push(r.cssText); } catch (e) { /* 교차 출처: 읽을 수 없음 */ }
  }
  const sheets = [...document.styleSheets].map((s, i) => {
    let rules = -1; // -1: 읽을 수 없음(교차 출처 등)
    try { rules = count(s.cssRules); } catch (e) { /* 교차 출처 */ }
    return { id: s.href ? s.href.replace(location.origin + '/', '') : `inline#${i}`, rules };
  });
  return { sheets, totalRules: sheets.reduce((a, s) => a + Math.max(s.rules, 0), 0), texts };
}

const snapshot = (page) => page.evaluate(snapshotInPage, PROPS);
// 규칙 텍스트는 노드에서 해시한다(시트 경계·id 는 해시에 넣지 않는다: 인라인 -> 외부 파일 이동에 불변이어야 한다).
// 규칙마다 NUL 로 구분해 "ab"+"c" 와 "a"+"bc" 가 같은 해시가 되지 않게 한다.
const sheetInfo = async (page) => {
  const { texts, ...info } = await page.evaluate(sheetsInPage);
  return { ...info, cssHash: crypto.createHash('sha256').update(texts.join('\0')).digest('hex') };
};

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

test('검색과 테마는 헤더의 아이콘 버튼이다', 375, async p => {
  const header = p.locator('header .header-right');
  assert.equal(await header.locator('button[onclick="openSearchModal()"]').count(), 1);
  assert.equal(await p.locator('.calendar-tools button[onclick="openSearchModal()"]').count(), 0);
  assert.equal(await p.locator('#themeToggle svg').count(), 1);
  assert.equal((await p.locator('#themeToggle').textContent()).trim(), '');
  assert.equal(await p.locator('#themeToggle').getAttribute('aria-label'), '테마 바꾸기');
  const box = await p.locator('#themeToggle').boundingBox();
  assert.ok(box.height >= 44, `테마 버튼 높이 ${box.height}`);
});

test('헤더 UI에 장식 이모지가 없다', 375, async p => {
  const text = await p.locator('header').innerText();
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]/u.test(text), false, text);
});

test('달력 도구가 자리별로 나뉜다', 375, async p => {
  // 주/월 세그먼트는 달력 제목 옆에 남는다
  assert.equal(await p.locator('.calendar-heading .calendar-mode button').count(), 2);
  // 월 이동 화살표는 유지
  assert.equal(await p.locator('#calPrev').isVisible(), true);
  assert.equal(await p.locator('#calNext').isVisible(), true);
  // 필터는 밑줄 탭
  assert.equal(await p.locator('.filter-tabs button[data-schedule-filter]').count(), 3);
  assert.equal(await p.locator('.schedule-filter-bar .small-btn').count(), 0);
  // 리포트·금주·오늘은 달력 아래 링크 줄
  const links = p.locator('.calendar-links button');
  assert.equal(await links.count(), 3);
  assert.deepEqual((await links.allInnerTexts()).map(t => t.trim()), ['월 리포트', '금주 현황', '오늘로']);
  // 핸들러 보존
  assert.equal(await p.locator('.calendar-links button[onclick="openMonthReport()"]').count(), 1);
  assert.equal(await p.locator('.calendar-links button[onclick="openSobrietyModal()"]').count(), 1);
  assert.equal(await p.locator('.calendar-links button[onclick="goToday()"]').count(), 1);
  // 터치 목표 44px, 글꼴 속성이 실제로 적용됨(font 단축 속성이 무효면 기본 13.33px 로 떨어진다)
  for (const sel of ['.filter-tabs button', '.calendar-links button']) {
    const boxes = await p.locator(sel).evaluateAll(els => els.map(e => ({ h: e.getBoundingClientRect().height, fs: getComputedStyle(e).fontSize, ff: getComputedStyle(e).fontFamily, pf: getComputedStyle(e.parentElement).fontFamily })));
    for (const b of boxes) {
      assert.ok(b.h >= 43.99, `${sel} 높이 ${b.h}`); // 서브픽셀 반올림 허용
      assert.equal(b.fs, '14px', `${sel} 글자 크기 ${b.fs}`);
      assert.equal(b.ff, b.pf, `${sel} 글꼴이 부모를 따르지 않는다: ${b.ff} vs ${b.pf}`);
    }
  }
});

test('필터 선택 상태가 보인다', 375, async p => {
  const on = p.locator('.filter-tabs button[aria-pressed="true"]');
  assert.equal(await on.count(), 1);
  assert.equal((await on.innerText()).trim(), '전체');
  await p.locator('.filter-tabs button[data-schedule-filter="mine"]').click();
  assert.equal((await p.locator('.filter-tabs button[aria-pressed="true"]').innerText()).trim(), '내 일정');
  // 기존 .sel 상태도 같이 맞춰진다
  assert.equal((await p.locator('.filter-tabs button.sel').innerText()).trim(), '내 일정');
});

const REC_BUTTONS = [['dmExerciseBtn', '운동'], ['dmDrinkToggle', '음주'], ['dmPeriodToggle', '생리'], ['dmLoveToggle', '기록']];

test('날짜 팝업 기록 버튼은 선 아이콘이다', 375, async p => {
  await p.evaluate(() => openDayDetail('2026-10-02'));
  for (const [id, label] of REC_BUTTONS) {
    const btn = p.locator('#' + id);
    assert.equal(await btn.locator('svg').count(), 1, id + ' 아이콘 없음');
    const box = await btn.boundingBox();
    assert.ok(box.height >= 43.99, `${id} 높이 ${box.height}`); // 서브픽셀 반올림 허용
    assert.equal((await btn.innerText()).trim(), label);
  }
  // 글꼴 속성이 실제로 적용됨(font 단축 속성이 무효면 기본 13.33px 로 떨어진다)
  const fs = await p.locator('.dm-header-actions .dm-drink-toggle').evaluateAll(els => els.map(e => getComputedStyle(e).fontSize));
  assert.deepEqual(fs, ['12px', '12px', '12px', '12px']);
});

test('날짜 팝업 제목과 닫기에 이모지가 없다', 375, async p => {
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const head = await p.locator('.day-modal-card > .card-title').innerText();
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2716}]/u.test(head), false, head);
  assert.equal((await p.locator('.dm-header-actions .small-btn').innerText()).trim(), '닫기');
  assert.equal((await p.locator('#dmDate').innerText()).trim(), '10월 2일 (금)');
});

test('기록을 켜도 아이콘과 글자가 그대로고 켜진 상태가 눈에 띈다', 375, async p => {
  await p.addStyleTag({ content: '*{transition:none!important}' }); // 전환 중간값을 읽지 않도록
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const readBtn = (id) => p.locator('#' + id).evaluate(e => {
    const cs = getComputedStyle(e);
    return { pressed: e.getAttribute('aria-pressed'), label: e.getAttribute('aria-label'), sel: e.classList.contains('sel'),
      bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color, shadow: cs.boxShadow, svg: e.querySelectorAll('svg').length, text: e.innerText.trim() };
  });
  const off = {};
  for (const [id] of REC_BUTTONS) off[id] = await readBtn(id);
  await p.evaluate(() => {
    userData.personalDrinkDays = { '2026-10-02': true };
    userData.personalDays = { '2026-10-02': { notes: { [EXERCISE_CAT_ID]: '[유산소] 러닝 30분' } } };
    spaceData.periodDays = { '2026-10-02': true };
    spaceData.loveDays = { '2026-10-02': true };
    renderDayDrinkToggle();
  });
  for (const [id, label] of REC_BUTTONS) {
    const on = await readBtn(id);
    assert.equal(on.svg, 1, id + ' 켠 뒤 아이콘이 사라졌다');
    assert.equal(on.text, label, id + ' 켠 뒤 글자가 바뀌었다: ' + on.text);
    assert.equal(off[id].pressed, 'false');
    assert.equal(on.pressed, 'true', id + ' aria-pressed 가 켜지지 않았다');
    assert.equal(on.sel, true, id + ' .sel 클래스를 더는 토글하지 않는다');
    assert.notEqual(on.bg, off[id].bg, id + ' 켜진 배경이 같다');
    assert.notEqual(on.border, off[id].border, id + ' 켜진 테두리가 같다');
    assert.notEqual(on.color, off[id].color, id + ' 켜진 글자색이 같다');
    assert.equal(on.shadow, 'none', id + ' 예전 그림자가 남아 있다: ' + on.shadow);
    assert.ok(on.label && on.label !== off[id].label, id + ' aria-label 이 상태를 담지 않는다: ' + on.label);
  }
  // 켜진 상태는 네 버튼이 모두 같은 톤이다(원색 변형 없음)
  const tones = new Set();
  for (const [id] of REC_BUTTONS) { const b = await readBtn(id); tones.add(b.bg + '|' + b.border + '|' + b.color); }
  assert.equal(tones.size, 1, [...tones].join(' / '));
});

test('스타일시트 순서와 규칙 수가 기준과 같다', 1280, async (p) => {
  const expected = readBaseline().stylesheets;
  const actual = await sheetInfo(p);
  const problems = [];
  const ids = (x) => x.sheets.map(s => s.id);
  if (JSON.stringify(ids(actual)) !== JSON.stringify(ids(expected))) {
    problems.push('스타일시트 순서/목록이 다르다\n  기준: ' + JSON.stringify(ids(expected), null, 2).replace(/\n/g, '\n  ')
      + '\n  실제: ' + JSON.stringify(ids(actual), null, 2).replace(/\n/g, '\n  '));
  } else {
    const perSheet = actual.sheets.map((s, i) => [s.id, expected.sheets[i].rules, s.rules]).filter(([, e, a]) => e !== a);
    if (perSheet.length) problems.push('시트별 규칙 수 차이(기준->실제): ' + perSheet.map(([id, e, a]) => `${id} ${e}->${a}`).join(', '));
  }
  if (actual.totalRules !== expected.totalRules) {
    problems.push(`전체 CSS 규칙 수가 다르다: 기준 ${expected.totalRules}, 실제 ${actual.totalRules} (규칙이 ${actual.totalRules < expected.totalRules ? '사라졌' : '늘었'}다)`);
  }
  if (!expected.cssHash) {
    problems.push('기준에 cssHash 가 없다. 수정하지 않은 트리에서 MINB_WRITE_BASELINE=1 로 기준을 재생성해야 한다');
  } else if (actual.cssHash !== expected.cssHash) {
    problems.push(`CSS 규칙 텍스트/순서가 바뀌었다(cssHash 불일치): 기준 ${expected.cssHash}, 실제 ${actual.cssHash}\n`
      + '  렌더된 스타일(computed)은 같아도 어떤 규칙의 텍스트가 바뀌었거나 사라졌거나 순서가 바뀐 것이다'
      + '(:hover/:focus, 캡처하지 않은 폭의 미디어쿼리, 동적 DOM 용 규칙일 수 있다).');
  }
  if (problems.length) throw new Error('\n' + problems.join('\n'));
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
  if (WRITE === 'sheets') {
    // 단순 이동은 시트 정체만 바꾼다. 규칙 수나 규칙 텍스트가 바뀌었다면 이동이 아니므로 기준을 덮어쓰지 않는다.
    const old = prev.stylesheets || {};
    const refuse = [];
    if (old.totalRules !== stylesheets.totalRules) {
      refuse.push(`전체 규칙 수가 다르다: 기준 ${old.totalRules}, 새로 측정 ${stylesheets.totalRules}`);
    }
    if (!old.cssHash) {
      refuse.push('기준에 cssHash 가 없다(구버전 기준). 수정하지 않은 트리에서 MINB_WRITE_BASELINE=1 로 먼저 재생성할 것');
    } else if (old.cssHash !== stylesheets.cssHash) {
      refuse.push(`cssHash 가 다르다: 기준 ${old.cssHash}, 새로 측정 ${stylesheets.cssHash}\n`
        + '  렌더된 스타일은 같아도 어떤 규칙의 텍스트가 바뀌었거나 사라졌거나 순서가 바뀌었다');
    }
    if (refuse.length) {
      console.error('MINB_WRITE_BASELINE=sheets 거부: 이것은 "순수 이동"이 아니다. 기준 파일을 쓰지 않았다.\n- ' + refuse.join('\n- ')
        + '\n이동 중 규칙을 잃었거나 바꾼 것이 아닌지 확인하라(computed 스냅샷은 :hover 등을 볼 수 없다).');
      process.exitCode = 1;
      return;
    }
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
  console.log(`기준 파일 작성(${WRITE}): ${BASELINE_FILE}\n  요소 수 ${WIDTHS.map((w, i) => `${w}px=${n[i]}`).join(' ')}, 시트 ${data.stylesheets.sheets.length}개, 규칙 ${data.stylesheets.totalRules}개, cssHash ${data.stylesheets.cssHash.slice(0, 12)}`);
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
