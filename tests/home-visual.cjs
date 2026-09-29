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

test('일정 줄 뱃지에 이모지가 없다', 375, async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-02'] = { todos: [
      { id: 'a', text: '감사팀 면담', by: 'A', time: '14:00', cat: 'etc', visibility: 'private', important: true }
    ] };
    openDayDetail('2026-10-02');
  });
  // 날짜 팝업의 일정 줄은 .todo-item 이다(.dm-item 은 렌더되지 않는다)
  const row = await p.locator('#dmBody .todo-item').first().innerText();
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(row), false, row);
  assert.match(row, /중요/);
  assert.match(row, /14:00/);
});

test('카테고리 색은 바탕이 아니라 인라인 커스텀 속성으로 넘어온다', 375, async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-02'] = { todos: [
      { id: 'a', text: '감사팀 면담', by: 'A', time: '14:00', cat: 'etc', visibility: 'private' }
    ] };
    openDayDetail('2026-10-02');
  });
  const badge = p.locator('#dmBody .todo-item .tcat-badge').first();
  assert.equal(await badge.count(), 1);
  const style = await badge.getAttribute('style');
  assert.match(style, /--cat-color/, style);
  assert.equal(/background\s*:/.test(style), false, style);
});

// ── 일정 줄(메타 한 줄) 검증용 공용 도구 ──
// 홈 fixture 는 일정 행을 하나도 그리지 않으므로(computed 스냅샷이 이 변경을 전혀 보지 못한다) 아래 테스트들이 유일한 자동 보호다.
// 두 사람이 쓰는 공간을 만들어 '나만 · 공유하기' / '공유 중 · 변경' / 배우자 일정('공유' span) 분기를 모두 그린다.
// (page.evaluate 로 직렬화되므로 바깥 변수를 참조하면 안 된다)
const seedTwoMemberSchedules = () => {
  spaceData.members = ['A', 'B'];
  spaceData.memberProfiles = { A: { name: '테스트' }, B: { name: '배우자' } };
  userData.personalDays['2026-10-02'] = { todos: [
    { id: 'p1', text: '내 비공개 일정', by: 'A', time: '19:30', location: '서울역', cat: 'wk', visibility: 'private', important: true },
    { id: 'p2', text: '내 공유 일정', by: 'A', time: '20:00', cat: 'st', visibility: 'shared' },
  ] };
  spaceData.days['2026-10-02'] = { todos: [
    { id: 's1', text: '배우자 일정', by: 'B', time: '21:00', cat: 'ex', visibility: 'shared' },
  ] };
  // 홈의 '앞으로 예정' 목록용(오늘 이후)
  userData.personalDays['2026-10-05'] = { todos: [
    { id: 'u1', text: '다음 주 약속', by: 'A', time: '18:30', location: '강남역', cat: 'wk', visibility: 'private' },
  ] };
};
// 페이지 안에서 실행: CSS 색을 브라우저가 계산한 rgb 문자열로 바꾼다(hex 와 computed rgb 를 비교하기 위해)
const inPageNorm = `(c) => { const i = document.createElement('i'); i.style.color = c; document.body.appendChild(i); const v = getComputedStyle(i).color; i.remove(); return v; }`;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('일정 줄 카테고리 점의 색은 그 카테고리의 색이다 (날짜 팝업)', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const got = await p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const fallback = norm('var(--ui-muted)');
    const all = [...userData.personalDays['2026-10-02'].todos, ...spaceData.days['2026-10-02'].todos];
    return all.map(t => {
      const row = document.querySelector(`#dmBody .todo-item[data-id="${t.id}"]`);
      const badge = row && row.querySelector('.tcat-badge');
      return { id: t.id, tag: badge && badge.tagName, want: norm(todoCategory(t).color), fallback,
        dot: badge && getComputedStyle(badge, '::before').backgroundColor,
        inline: badge && badge.getAttribute('style') };
    });
  }, inPageNorm);
  assert.equal(got.length, 3);
  for (const g of got) {
    assert.ok(g.tag, g.id + ' 행/뱃지가 없다');
    // '--cat-color' 철자가 틀리면 var() 가 대체값(--ui-muted)으로 떨어진다. 그 회색과 구분되는 색인지부터 확인한다.
    assert.notEqual(g.want, g.fallback, g.id + ' 카테고리 색이 대체 회색과 같아 이 검사가 구분을 못 한다');
    assert.equal(g.dot, g.want, `${g.id} 점 색이 카테고리 색이 아니다: ${g.dot} (기대 ${g.want}, 대체 ${g.fallback}, style=${g.inline})`);
  }
  // 카테고리마다 점 색이 달라야 한다(모두 같은 값으로 그려지는 회귀를 잡는다)
  assert.equal(new Set(got.map(g => g.dot)).size, 3, JSON.stringify(got.map(g => g.dot)));
  // 내 일정은 <button>, 배우자 일정은 <span> 뱃지다 — 두 갈래 모두에서 점이 나온다
  assert.deepEqual(got.map(g => g.tag), ['BUTTON', 'BUTTON', 'SPAN']);
});

test('일정 줄 뱃지는 조용한 회색 글자다: 새 CSS 가 없으면 실패한다', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const got = await p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const probe = document.createElement('i'); probe.style.fontSize = 'var(--ui-caption)'; document.body.appendChild(probe);
    const caption = getComputedStyle(probe).fontSize; probe.remove();
    const read = (el) => { const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, border: cs.borderTopWidth, fs: cs.fontSize, weight: cs.fontWeight }; };
    const row = id => document.querySelector(`#dmBody .todo-item[data-id="${id}"]`);
    return { muted: norm('var(--ui-muted)'), red: norm('var(--red)'), caption,
      spanCat: read(row('s1').querySelector('.tcat-badge')),     // <span> 뱃지(배우자 일정): 버튼용 규칙이 섞이지 않는다
      spanScope: read(row('s1').querySelector('.scope-badge')),
      btnCat: read(row('p1').querySelector('.tcat-badge')),      // <button> 뱃지(내 일정)
      important: read(row('p1').querySelector('.important-flag')),
      chip: read(row('p1').querySelector('.todo-meta-chip')),
      scopeBefore: getComputedStyle(row('s1').querySelector('.scope-badge'), '::before').content,
      btnH: row('p1').querySelector('button.tcat-badge').getBoundingClientRect().height };
  }, inPageNorm);
  // 예전 원색 뱃지는 흰 글자·둥근 모서리·안쪽 여백이 있었다. 그중 하나라도 남으면 새 CSS 가 적용되지 않은 것이다.
  for (const [k, s] of [['span 카테고리', got.spanCat], ['span 범위', got.spanScope], ['시간·장소 칩', got.chip]]) {
    assert.equal(s.color, got.muted, `${k} 글자색이 회색이 아니다: ${JSON.stringify(s)}`);
    assert.equal(s.fs, got.caption, `${k} 글자 크기: ${JSON.stringify(s)}`);
    assert.equal(s.radius, '0px', `${k} 모서리: ${JSON.stringify(s)}`);
    assert.equal(s.pad, '0px', `${k} 여백: ${JSON.stringify(s)}`);
    assert.equal(s.border, '0px', `${k} 테두리: ${JSON.stringify(s)}`);
    assert.equal(s.bg, TRANSPARENT, `${k} 바탕: ${JSON.stringify(s)}`);
  }
  // 버튼 뱃지도 같은 회색·모서리 없음이고, 대신 세로 터치 영역을 44px 이상으로 넓힌다
  assert.equal(got.btnCat.color, got.muted, JSON.stringify(got.btnCat));
  assert.equal(got.btnCat.radius, '0px', JSON.stringify(got.btnCat));
  assert.equal(got.btnCat.pad, '13px 4px', JSON.stringify(got.btnCat));
  assert.ok(got.btnH >= 43.99, `버튼 뱃지 높이 ${got.btnH}`);
  // '중요'만 붉은 글자로 남는다
  assert.equal(got.important.color, got.red, JSON.stringify(got.important));
  assert.equal(got.important.bg, TRANSPARENT, JSON.stringify(got.important));
  // 범위 뱃지 앞의 구분점(·)
  assert.equal(got.scopeBefore, '"·"');
});

test('공유 공간의 범위 뱃지: 나만·공유 중·배우자 일정', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const badge = id => p.locator(`#dmBody .todo-item[data-id="${id}"] .scope-badge`);
  // 내 비공개 일정: 눌러서 공유하는 버튼
  assert.equal((await badge('p1').innerText()).trim(), '나만 · 공유하기');
  assert.equal(await badge('p1').evaluate(e => e.tagName), 'BUTTON');
  assert.equal(await badge('p1').evaluate(e => e.classList.contains('shared')), false);
  // 내 공유 일정: 공유 범위·주인을 바꾸는 버튼
  assert.equal((await badge('p2').innerText()).trim(), '공유 중 · 변경');
  assert.equal(await badge('p2').evaluate(e => e.tagName), 'BUTTON');
  assert.equal(await badge('p2').evaluate(e => e.classList.contains('shared')), true);
  // 배우자 일정: 누를 수 없는 '공유' 글자
  assert.equal((await badge('s1').innerText()).trim(), '공유');
  assert.equal(await badge('s1').evaluate(e => e.tagName), 'SPAN');
  assert.equal(await badge('s1').evaluate(e => e.classList.contains('shared')), true);
  // 세 갈래 모두 이모지가 없다
  for (const id of ['p1', 'p2', 's1']) {
    const t = await p.locator(`#dmBody .todo-item[data-id="${id}"] .todo-actions`).evaluate(e => [...e.querySelectorAll('.scope-badge, .tcat-badge, .important-flag')].map(x => x.textContent).join(' '));
    assert.equal(EMOJI.test(t), false, id + ': ' + t);
  }
});

test('장소·시간 칩에 📍·🕐 이모지가 없다', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const chips = await p.locator('#dmBody .todo-item[data-id="p1"] .todo-meta-chip').allInnerTexts();
  assert.deepEqual(chips.map(t => t.trim()), ['19:30', '서울역']);
  assert.equal(await p.locator('#dmBody .todo-item[data-id="p1"] .todo-meta-chip.location').innerText(), '서울역');
  assert.equal(EMOJI.test(chips.join('')), false, chips.join('|'));
});

test('홈 "앞으로 예정" 줄도 같은 조용한 뱃지와 카테고리 점을 쓴다', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => renderUpcomingTodos());
  const row = p.locator('#upcomingTodoList .upcoming-todo[data-todo-id="u1"]');
  assert.equal(await row.count(), 1, '앞으로 예정 줄이 그려지지 않았다');
  const got = await row.evaluate((r, normSrc) => {
    const norm = eval(normSrc);
    const badge = r.querySelector('.tcat-badge');
    const cs = getComputedStyle(badge);
    return { want: norm(todoCategory(userData.personalDays['2026-10-05'].todos[0]).color), fallback: norm('var(--ui-muted)'), muted: norm('var(--ui-muted)'),
      dot: getComputedStyle(badge, '::before').backgroundColor, inline: badge.getAttribute('style'),
      color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, meta: r.querySelector('.upcoming-todo-meta').textContent };
  }, inPageNorm);
  assert.match(got.inline, /--cat-color/, got.inline);
  assert.equal(/background\s*:/.test(got.inline), false, got.inline);
  assert.notEqual(got.want, got.fallback);
  assert.equal(got.dot, got.want, `점 색 ${got.dot} (기대 ${got.want}, 대체 ${got.fallback})`);
  assert.equal(got.color, got.muted, JSON.stringify(got));
  assert.equal(got.bg, TRANSPARENT, JSON.stringify(got));
  assert.equal(got.radius, '0px', JSON.stringify(got));
  assert.equal(got.pad, '0px', JSON.stringify(got));
  // 시간·장소에 이모지가 없다
  assert.equal(got.meta, '18:30 · 강남역');
  assert.equal(EMOJI.test(got.meta), false, got.meta);
});

test('메모 카테고리 선택 뱃지는 색 바탕 뱃지 모양을 그대로 유지한다', 375, async p => {
  // .tcat-badge 는 메모 카테고리 선택에도 쓰이며 거기서는 색 바탕이 선택지 구분이다. 일정 줄용 조용한 스타일이 새면 안 된다.
  const got = await p.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'memo-entry-item';
    host.innerHTML = '<button class="tcat-badge" style="background:rgb(10, 20, 30);">메모</button>';
    document.body.appendChild(host);
    const cs = getComputedStyle(host.firstChild);
    const o = { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, pad: cs.padding, dot: getComputedStyle(host.firstChild, '::before').content };
    host.remove();
    return o;
  });
  assert.equal(got.bg, 'rgb(10, 20, 30)');
  assert.equal(got.color, 'rgb(255, 255, 255)', '글자색이 흰색이 아니다: ' + JSON.stringify(got));
  assert.equal(got.radius, '10px', JSON.stringify(got));
  assert.notEqual(got.pad, '0px', JSON.stringify(got));
  assert.ok(got.dot === 'none' || got.dot === 'normal', '메모 뱃지에 점이 생겼다: ' + JSON.stringify(got));
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
