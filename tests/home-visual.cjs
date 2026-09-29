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

// 페이지 안에서 실행: 요소의 유효 배경색(투명이면 조상으로 올라간다)과 주어진 글자색의 명암비(WCAG)를 계산한다
const inPageContrast = `(el, fg) => {
  const parse = c => c.match(/[\\d.]+/g).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let n = el, bg = null;
  while (n) { const c = getComputedStyle(n).backgroundColor; const a = parse(c); if (a.length === 3 || a[3] > 0.99) { bg = a; break; } n = n.parentElement; }
  const f = parse(fg), L1 = lum(f), L2 = lum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}`;

// 다크로 바꾸고 색 전환(transition)이 끝난 값을 바로 읽게 한다(전환 중에는 옛 배경색이 읽혀 명암비가 틀어진다)
const setDarkNow = async p => {
  await p.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await p.evaluate(() => document.body.classList.add('dark'));
  assert.notEqual(await p.evaluate(() => getComputedStyle(document.querySelector('.card')).backgroundColor), 'rgb(255, 255, 255)', '다크로 바뀌지 않았다');
};

test('달력 아래 링크 줄의 밑줄은 링크로 읽힐 만큼 보이되 글자보다 튀지 않는다 (라이트·다크)', 375, async p => {
  for (const dark of [false, true]) {
    if (dark) await setDarkNow(p);
    const got = await p.locator('.calendar-links button').evaluateAll((els, src) => {
      const ratio = eval(src);
      const probe = document.createElement('i'); probe.style.color = 'var(--ui-border)'; document.body.appendChild(probe);
      const border = getComputedStyle(probe).color; probe.remove();
      return els.map(e => { const cs = getComputedStyle(e); return { t: e.textContent.trim(), line: cs.textDecorationLine, deco: cs.textDecorationColor, color: cs.color, border, ratio: ratio(e, cs.textDecorationColor) }; });
    }, inPageContrast);
    assert.equal(got.length, 3);
    for (const g of got) {
      assert.equal(g.line, 'underline', JSON.stringify(g));
      assert.notEqual(g.deco, g.border, `${g.t} 밑줄이 테두리색이다(dark=${dark}): ${JSON.stringify(g)}`);
      assert.ok(g.ratio >= 3, `${g.t} 밑줄 명암비 ${g.ratio.toFixed(2)} < 3 (dark=${dark}): ${JSON.stringify(g)}`);
      assert.equal(g.deco, g.color, `${g.t} 밑줄이 글자색과 다르다(더 튄다)(dark=${dark}): ${JSON.stringify(g)}`);
    }
  }
});

test('일정 줄 메타 구분점(·)은 읽을 수 있고 중요 뒤에도 있다 (라이트·다크)', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => openDayDetail('2026-10-02'));
  for (const dark of [false, true]) {
    if (dark) await setDarkNow(p);
    const got = await p.evaluate(([normSrc, src]) => {
      const norm = eval(normSrc), ratio = eval(src);
      const row = document.querySelector('#dmBody .todo-item[data-id="p1"]');
      const flag = row.querySelector('.important-flag'), scope = row.querySelector('.scope-badge');
      const kids = [...row.querySelector('.todo-actions').children];
      const sep = flag.nextElementSibling;
      const info = (el, w) => { const cs = getComputedStyle(el, w); return { text: w ? cs.content : el.textContent, color: cs.color, ratio: ratio(el, cs.color) }; };
      return { border: norm('var(--ui-border)'), scope: info(scope, '::before'), sep: info(sep), sepClass: sep.className,
        // '중요' 다음이 구분점이고 그 다음이 카테고리 뱃지다(순서가 바뀌면 구분점이 엉뚱한 곳에 온다)
        after: kids[kids.indexOf(sep) + 1].className, hidden: sep.getAttribute('aria-hidden'),
        // '중요' 의 ::after 는 툴팁이 쓴다: 구분점이 그것을 가로채면 안 된다
        tip: getComputedStyle(flag, '::after').content };
    }, [inPageNorm, inPageContrast]);
    assert.equal(got.sepClass, 'meta-sep', JSON.stringify(got));
    assert.match(got.after, /tcat-badge/, JSON.stringify(got));
    assert.equal(got.hidden, 'true', '구분점은 스크린리더에 읽히면 안 된다');
    assert.equal(got.tip, '"중요 일정"', '중요 뱃지의 툴팁이 사라졌다: ' + got.tip);
    for (const [k, s, want] of [['범위 앞 구분점', got.scope, '"·"'], ['중요 뒤 구분점', got.sep, '·']]) {
      assert.equal(s.text, want, `${k} 내용(dark=${dark}): ${JSON.stringify(s)}`);
      assert.notEqual(s.color, got.border, `${k} 색이 테두리색이다(dark=${dark}): ${JSON.stringify(s)}`);
      assert.ok(s.ratio >= 3, `${k} 명암비 ${s.ratio.toFixed(2)} < 3 (dark=${dark}): ${JSON.stringify(s)}`);
    }
  }
});

test('기간 일정 칩에 📅 이모지가 없고 날짜는 그대로다', 375, async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-02'] = { todos: [
      { id: 'pp', text: '제주 출장', by: 'A', startDate: '2026-10-02', endDate: '2026-10-04', cat: 'wk', visibility: 'private' },
    ] };
    openDayDetail('2026-10-02');
  });
  const chips = await p.locator('#dmBody .todo-item[data-id="pp"] .todo-meta-chip').allInnerTexts();
  assert.deepEqual(chips.map(t => t.trim()), ['10/2~10/4']);
  assert.equal(EMOJI.test(chips.join('')), false, chips.join('|'));
});

test('앞으로 예정 제목: ❗ 대신 붉은 "중요" 글자이고, 중요하지 않으면 아무것도 없다', 375, async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-05'] = { todos: [
      { id: 'i1', text: '중요한 약속', by: 'A', time: '10:00', cat: 'wk', visibility: 'private', important: true },
      { id: 'i2', text: '평범한 약속', by: 'A', time: '11:00', cat: 'wk', visibility: 'private' },
    ] };
    renderUpcomingTodos();
  });
  const got = await p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const read = id => { const t = document.querySelector(`#upcomingTodoList .upcoming-todo[data-todo-id="${id}"] .upcoming-todo-title`); const f = t.querySelector('.important-flag'); return { text: t.textContent, flag: f && f.textContent, color: f && getComputedStyle(f).color }; };
    return { imp: read('i1'), plain: read('i2'), red: norm('var(--red)') };
  }, inPageNorm);
  assert.equal(got.imp.flag, '중요', JSON.stringify(got));
  assert.equal(got.imp.color, got.red, JSON.stringify(got));
  // 중요 표시와 제목 사이에 공백이 있어야 스크린 리더·복사에서 '중요중요한'으로 붙지 않는다
  assert.equal(got.imp.text, '중요 중요한 약속', '제목 글자: ' + got.imp.text);
  assert.equal(EMOJI.test(got.imp.text), false, got.imp.text);
  assert.equal(got.plain.flag, null, JSON.stringify(got));
  assert.equal(got.plain.text, '평범한 약속');
});

test('반복 일정 줄의 표시는 이모지 대신 "반복" 글자다 (날짜 팝업, 데스크톱)', 1280, async p => {
  await p.evaluate(() => {
    userData.personalRecurring = [{ id: 'r1', text: '금요일 운동', days: [5], cat: 'ex', by: 'A', visibility: 'private' }];
    openDayDetail('2026-10-02');
  });
  const by = p.locator('#dmBody .todo-item.recurring .by');
  assert.equal(await by.count(), 1, '반복 표시가 없다');
  assert.equal((await by.innerText()).trim(), '반복');
  assert.equal(await by.isVisible(), true);
  assert.equal(await by.getAttribute('data-tooltip'), '반복 할 일');
});

test('일정 줄 더보기 메뉴의 날짜 변경·복사 버튼은 이모지 없이 글자이고 동작 연결이 그대로다', 375, async p => {
  await p.evaluate(seedTwoMemberSchedules);
  await p.evaluate(() => openDayDetail('2026-10-02'));
  const btns = await p.locator('#dmBody .todo-item[data-id="p1"] .todo-btns button').evaluateAll(els => els.map(e => ({ text: e.textContent.trim(), label: e.getAttribute('aria-label'), on: e.getAttribute('onclick') })));
  const move = btns.find(b => b.label === '날짜 변경'), copy = btns.find(b => b.label === '다른 날짜에 한 번 복사');
  assert.ok(move && copy, JSON.stringify(btns));
  assert.equal(move.text, '날짜');
  assert.equal(copy.text, '복사');
  assert.match(move.on, /moveTodoToDateFromKey/);
  assert.match(copy.on, /copyTodoToDateFromKey/);
  assert.equal(EMOJI.test(move.text + copy.text), false, JSON.stringify([move, copy]));
});

// 모바일 행 메뉴 버튼의 터치 목표. 글자 버튼(날짜·복사)은 padding 만으로 키우면 44x35 에 그쳤다(회귀).
// 눌리는 칸은 44px 이상이어야 하고, 그렇다고 줄 높이(=행 높이)가 그만큼 늘어나면 안 된다.
for (const w of [320, 375]) {
  test(`행 메뉴 버튼(⋯·날짜·복사·✕·이동 손잡이)이 44px 터치 목표이고 행은 늘어나지 않는다 (${w}px)`, w, async p => {
    await p.evaluate(seedTwoMemberSchedules);
    await p.evaluate(() => openDayDetail('2026-10-02'));
    const closedH = await p.locator('#dmBody .todo-item[data-id="p2"]').evaluate(e => e.getBoundingClientRect().height);
    await p.locator('#dmBody .todo-item[data-id="p1"] .todo-menu-btn').click();
    const boxes = await p.evaluate(() => {
      const row = document.querySelector('#dmBody .todo-item[data-id="p1"]');
      const sel = { '⋯': '.todo-menu-btn', '날짜': '.todo-btns [aria-label="날짜 변경"]', '복사': '.todo-btns [aria-label="다른 날짜에 한 번 복사"]',
        '✕': '.todo-btns [aria-label="삭제"]', '↕': '.move-handle' };
      const out = {};
      for (const [k, q] of Object.entries(sel)) {
        const e = row.querySelector(q);
        if (!e) { out[k] = null; continue; }
        const r = e.getBoundingClientRect();
        out[k] = { w: r.width, h: r.height, visible: !!(r.width && r.height) };
      }
      return out;
    });
    for (const [k, b] of Object.entries(boxes)) {
      assert.ok(b && b.visible, `${k} 버튼이 보이지 않는다: ${JSON.stringify(boxes)}`);
      assert.ok(b.w >= 43.99 && b.h >= 43.99, `${k} 터치 목표 ${b.w}x${b.h} (44x44 미만)`); // 서브픽셀 반올림 허용
    }
    // 메뉴가 닫힌 행의 높이: 수정 전 99.3px, 음수 여백 없이 44px 칸만 키우면 약 112px 로 늘어난다(-6px 여백이 막는다).
    assert.ok(closedH <= 104, `닫힌 행 높이 ${closedH} (수정 전 99.3, 44px 칸이 줄을 밀면 112 안팎)`);
  });
}

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

// ── 달력 날짜 칸 라벨 ──
// 홈 fixture 는 일정이 없어 computed 스냅샷이 달력 라벨을 전혀 보지 못한다. 그래서 실제 렌더러(renderAll)로 라벨을 그려 검증한다.
// 라벨의 색은 인라인 background/color 가 아니라 --tag-color 로 넘어오고, CSS 가 "바탕 없음 + 본문색 글자 + 왼쪽 막대"로 그린다.
// 기대값은 앱이 런타임에 계산하는 함수(todoOwnerSignature·todoCategory·IMPORTANT_COLOR)에서 읽는다(hex 하드코딩 없음).
const seedCalendarTags = () => {
  spaceData.members = ['A', 'B'];
  spaceData.memberProfiles = { A: { name: '테스트' }, B: { name: '배우자' } };
  const shared = (o) => ({ visibility: 'shared', ...o });
  userData.personalDays = {
    '2026-10-02': { todos: [{ id: 'cat1', text: '카테고리만 있는 일정', by: 'A', cat: 'wk', visibility: 'private' }] },
    '2026-10-03': { todos: [{ id: 'imp1', text: '중요한 개인 일정', by: 'A', cat: 'wk', visibility: 'private', important: true }] },
    '2026-10-05': { todos: [{ id: 'done1', text: '끝낸 개인 일정', by: 'A', cat: 'wk', visibility: 'private', done: true }] },
    '2026-10-09': { recDone: { rec1: true } },
    '2026-10-12': { todos: [1, 2, 3, 4, 5].map(i => ({ id: 'm' + i, text: '많은 일정 ' + i, by: 'A', cat: 'etc', visibility: 'private' })) },
    '2026-10-13': { notes: { etc: '메모 내용' } },
  };
  userData.personalRecurring = [{ id: 'rec1', text: '반복 일정', days: [5], startDate: '2026-10-09', endDate: '2026-10-09', cat: 'ex', visibility: 'private' }];
  spaceData.recurring = [{ id: 'rec2', text: '배우자 반복 일정', by: 'B', days: [5], startDate: '2026-10-16', endDate: '2026-10-16', cat: 'ex', visibility: 'shared' }];
  spaceData.days = {
    '2026-10-01': { todos: [shared({ id: 'own1', text: '배우자 공유 일정', by: 'B', cat: 'ex' })] },
    '2026-10-04': { todos: [shared({ id: 'ownimp', text: '중요한 배우자 일정', by: 'B', cat: 'ex', important: true })] },
    '2026-10-06': { todos: [shared({ id: 'owndone', text: '끝낸 배우자 일정', by: 'B', cat: 'ex', done: true })] },
    '2026-10-07': { todos: [shared({ id: 'mine1', text: '내 공유 일정', by: 'A', cat: 'st' })] },
  };
  calendarView = 'month'; calMonth = new Date(2026, 9, 1);
  renderAll();
};
// 페이지 안에서 실행: 각 라벨의 계산된 모양 + 앱이 계산해 주는 기대 막대 색
const readCalendarTags = (normSrc) => {
  const norm = eval(normSrc);
  const dayOf = (k) => document.querySelector(`#monthCal .mcal-day[data-date="${k}"]`);
  const look = (el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, cls: el.className, style: el.getAttribute('style') || '', title: el.getAttribute('title'), role: el.getAttribute('role'),
      bg: cs.backgroundColor, bgImage: cs.backgroundImage, color: cs.color, barW: cs.borderLeftWidth, barStyle: cs.borderLeftStyle, bar: cs.borderLeftColor,
      accent: cs.boxShadow, deco: cs.textDecorationLine, weight: cs.fontWeight, opacity: cs.opacity, ws: cs.whiteSpace, ov: cs.textOverflow, ovX: cs.overflowX, ovY: cs.overflowY, padL: cs.paddingLeft };
  };
  const tag = (k, i = 0) => { const el = dayOf(k) && dayOf(k).querySelectorAll('.mcal-tag')[i]; return el ? look(el) : null; };
  const todoOf = (k, id) => getDay(k).todos.find(t => t.id === id);
  // 막대 색 우선순위(사양): 주인 색 > (완료면 녹색) > (중요면 빨강) > 카테고리 색
  const barOf = (k, id) => {
    const t = todoOf(k, id); const o = todoOwnerSignature(t);
    if (o) return norm(o.color);
    if (t.done) return norm('var(--green)');
    return t.important ? norm(IMPORTANT_COLOR) : norm(todoCategory(t).color);
  };
  const rec = { id: 'rec1', cat: 'ex', visibility: 'private' };
  return {
    body: norm('var(--text)'), muted: norm('var(--ui-muted)'), green: norm('var(--green)'), blue: norm('var(--blue)'), important: norm(IMPORTANT_COLOR),
    ownerA: norm(todoOwnerSignature(todoOf('2026-10-07', 'mine1')).color), ownerB: norm(todoOwnerSignature(todoOf('2026-10-01', 'own1')).color),
    catWk: norm(todoCategory(todoOf('2026-10-02', 'cat1')).color), catEx: norm(todoCategory(rec).color),
    owner: { tag: tag('2026-10-01'), want: barOf('2026-10-01', 'own1') },
    mine: { tag: tag('2026-10-07'), want: barOf('2026-10-07', 'mine1') },
    cat: { tag: tag('2026-10-02'), want: barOf('2026-10-02', 'cat1') },
    imp: { tag: tag('2026-10-03'), want: barOf('2026-10-03', 'imp1') },
    ownImp: { tag: tag('2026-10-04'), want: barOf('2026-10-04', 'ownimp') },
    done: { tag: tag('2026-10-05'), want: barOf('2026-10-05', 'done1') },
    ownDone: { tag: tag('2026-10-06'), want: barOf('2026-10-06', 'owndone') },
    recDone: { tag: tag('2026-10-09') },
    recOwner: { tag: tag('2026-10-16'), want: (() => { const o = todoOwnerSignature(spaceData.recurring[0]); return o ? norm(o.color) : null; })() },
    many: [...dayOf('2026-10-12').querySelectorAll('.mcal-tag')].map(look),
    more: (dayOf('2026-10-12').querySelector('.mcal-more') || {}).textContent,
    note: tag('2026-10-13'),
  };
};

test('달력 라벨: 색 바탕이 아니라 본문색 글자 + 왼쪽 색 막대다 (주인·카테고리·중요·완료)', 375, async p => {
  await p.evaluate(seedCalendarTags);
  const g = await p.evaluate(readCalendarTags, inPageNorm);
  const rows = { owner: g.owner, mine: g.mine, cat: g.cat, imp: g.imp, ownImp: g.ownImp, done: g.done, ownDone: g.ownDone };
  for (const [k, { tag, want }] of Object.entries(rows)) {
    assert.ok(tag, k + ' 라벨이 그려지지 않았다');
    // 인라인에는 색 바탕·글자색이 없고 --tag-color 만 있다(인라인이 CSS 를 이기는 함정 방지)
    assert.equal(/background/.test(tag.style), false, `${k} 인라인 배경: ${tag.style}`);
    assert.equal(/(^|;)\s*color\s*:/.test(tag.style), false, `${k} 인라인 글자색: ${tag.style}`);
    if (k !== 'done') assert.match(tag.style, /--tag-color:/, `${k} --tag-color 없음: ${tag.style}`);
    // 배경 없음, 본문색 글자, 3px 실선 막대
    assert.equal(tag.bg, TRANSPARENT, `${k} 배경이 틴트다: ${tag.bg}`);
    assert.equal(tag.bgImage, 'none', `${k} 배경 이미지`);
    assert.equal(tag.color, g.body, `${k} 글자색이 본문색이 아니다: ${tag.color} (기대 ${g.body})`);
    assert.equal(tag.barW, '3px', `${k} 막대 두께 ${tag.barW}`);
    assert.equal(tag.barStyle, 'solid', `${k} 막대 모양 ${tag.barStyle}`);
    // 막대 색은 앱이 계산한 기대값과 같다. 대체 회색으로 떨어지면(커스텀 속성 철자 오류) 여기서 잡힌다.
    assert.equal(tag.bar, want, `${k} 막대 색 ${tag.bar} (기대 ${want}, 대체 회색 ${g.muted}, style=${tag.style})`);
  }
  // 기대값이 대체 회색과 같으면 위 비교가 오류를 못 잡는다
  for (const [k, { want }] of Object.entries(rows)) assert.notEqual(want, g.muted, k + ' 기대 색이 대체 회색과 같아 이 검사가 구분을 못 한다');
  // 소유자: 주인 색이 카테고리 색보다 우선하고, 사람마다 다르게 보인다
  assert.notEqual(g.ownerA, g.ownerB, '두 사람의 색이 같다');
  assert.equal(g.owner.tag.bar, g.ownerB);
  assert.equal(g.mine.tag.bar, g.ownerA);
  assert.notEqual(g.owner.tag.bar, g.catEx, '주인 색이 카테고리 색에 밀렸다');
  // 주인이 없으면 카테고리 색
  assert.equal(g.cat.tag.bar, g.catWk);
  // 중요: 굵은 글씨 + 빨강. 주인이 없으면 막대가 빨강, 있으면 주인 색 막대 + 빨간 안쪽 띠
  assert.equal(g.imp.tag.bar, g.important);
  assert.equal(g.imp.want, g.important);
  assert.ok(Number(g.imp.tag.weight) > Number(g.cat.tag.weight), `중요가 더 굵지 않다: ${g.imp.tag.weight} vs ${g.cat.tag.weight}`);
  assert.equal(g.imp.tag.title, '중요 일정');
  assert.equal(g.ownImp.tag.bar, g.ownerB);
  assert.ok(g.ownImp.tag.accent.includes(g.important), `주인+중요의 안쪽 띠가 빨강이 아니다: ${g.ownImp.tag.accent}`);
  assert.ok(Number(g.ownImp.tag.weight) > Number(g.cat.tag.weight));
  assert.ok(g.cat.tag.accent === 'none' || g.cat.tag.accent.startsWith(TRANSPARENT), '평범한 라벨에 보이는 안쪽 띠가 있다: ' + g.cat.tag.accent);
  // 완료: 취소선. 주인이 없으면 녹색 막대, 있으면 주인 색 막대 + 녹색 안쪽 띠
  assert.equal(g.done.tag.deco, 'line-through');
  assert.equal(g.done.tag.bar, g.green);
  assert.match(g.done.tag.cls, /t-done/);
  assert.equal(g.ownDone.tag.deco, 'line-through');
  assert.equal(g.ownDone.tag.bar, g.ownerB);
  assert.ok(g.ownDone.tag.accent.includes(g.green), `주인+완료의 안쪽 띠가 녹색이 아니다: ${g.ownDone.tag.accent}`);
  assert.equal(g.cat.tag.deco, 'none');
  // 드래그 속성 보존
  assert.equal(g.cat.tag.role, 'button');
  assert.equal(g.done.tag.role, 'button');
});

test('달력 라벨: 반복 일정(완료는 흐리게)·메모·+N·한 줄 자르기', 375, async p => {
  await p.evaluate(seedCalendarTags);
  const g = await p.evaluate(readCalendarTags, inPageNorm);
  const r = g.recDone.tag;
  assert.ok(r, '반복 일정 라벨이 없다');
  assert.equal(r.title, '반복 할 일');
  assert.equal(r.opacity, '0.55', '완료한 반복 일정이 흐리지 않다');
  assert.equal(r.bg, TRANSPARENT);
  assert.equal(r.color, g.body);
  assert.equal(r.bar, g.catEx, '반복 일정 막대는 카테고리 색이다');
  assert.notEqual(g.catEx, g.muted);
  assert.equal(/background/.test(r.style), false, r.style);
  assert.equal(r.role, null, '반복 일정은 드래그할 수 없다');
  // 공유 공간의 반복 일정: 막대는 주인 색이다(카테고리 색이 아니다)
  const ro = g.recOwner;
  assert.ok(ro.tag, '공유 반복 일정 라벨이 없다');
  assert.equal(ro.tag.title, '반복 할 일');
  assert.ok(ro.want, '공유 반복 일정의 주인 색을 앱에서 읽지 못했다');
  assert.notEqual(ro.want, g.muted);
  assert.notEqual(ro.want, g.catEx, '이 검사가 주인 색과 카테고리 색을 구분하지 못한다');
  assert.equal(ro.want, g.ownerB);
  assert.equal(ro.tag.bar, ro.want, `공유 반복 일정 막대 ${ro.tag.bar} (기대 주인 색 ${ro.want}, 카테고리 색 ${g.catEx}, style=${ro.tag.style})`);
  assert.equal(ro.tag.bg, TRANSPARENT);
  assert.equal(ro.tag.color, g.body);
  assert.equal(/background/.test(ro.tag.style), false, ro.tag.style);
  // 메모 라벨은 파란 막대
  assert.ok(g.note, '메모 라벨이 없다');
  assert.equal(g.note.bg, TRANSPARENT);
  assert.equal(g.note.color, g.body);
  assert.equal(g.note.bar, g.blue);
  assert.equal(g.note.role, 'button');
  // 미리보기는 3개 + '+2'
  assert.equal(g.many.length, 3);
  assert.equal(g.more, '+2');
  // 한 줄에서 말줄임표 없이 잘린다(사용자가 명시적으로 요청한 동작)
  // overflow: hidden 이 없으면 긴 제목이 칸 밖으로 넘친다(자르기 요구의 일부)
  for (const t of [...g.many, g.recDone.tag, g.recOwner.tag, g.note]) { assert.equal(t.ws, 'nowrap'); assert.equal(t.ov, 'clip'); assert.equal(t.ovX, 'hidden'); assert.equal(t.ovY, 'hidden'); }
  // 실제로 긴 제목이 셀 폭 안에서 잘리는지(넘치지 않는지)도 확인한다
  const clip = await p.evaluate(() => {
    userData.personalDays['2026-10-14'] = { todos: [{ id: 'long', text: '아주아주아주아주아주아주아주아주아주 긴 일정 제목입니다 끝까지 보이면 안 된다', by: 'A', cat: 'etc', visibility: 'private' }] };
    renderAll();
    const day = document.querySelector('#monthCal .mcal-day[data-date="2026-10-14"]');
    const el = day.querySelector('.mcal-tag');
    const d = day.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { tagRight: r.right, dayRight: d.right, scrollW: el.scrollWidth, clientW: el.clientWidth, height: r.height };
  });
  assert.ok(clip.tagRight <= clip.dayRight + 0.5, `라벨이 칸 밖으로 넘친다: ${JSON.stringify(clip)}`);
  assert.ok(clip.scrollW > clip.clientW, `긴 제목이 잘리지 않았다(테스트 전제): ${JSON.stringify(clip)}`);
  assert.ok(clip.height < 30, `라벨이 여러 줄이다: ${JSON.stringify(clip)}`);
  // 주 보기도 같은 라벨을 쓴다
  await p.evaluate(() => { calendarView = 'week'; renderAll(); });
  const w = await p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const el = document.querySelector('#monthCal .mcal-day[data-date="2026-10-03"] .mcal-tag');
    const cs = getComputedStyle(el);
    return { week: document.getElementById('monthCal').classList.contains('calendar-week'), bg: cs.backgroundColor, bar: cs.borderLeftColor, want: norm(IMPORTANT_COLOR), color: cs.color, body: norm('var(--text)') };
  }, inPageNorm);
  assert.equal(w.week, true);
  assert.equal(w.bg, TRANSPARENT);
  assert.equal(w.bar, w.want);
  assert.equal(w.color, w.body);
});

test('달력 라벨 글자색은 다크 테마에서 다크 본문색을 따른다', 375, async p => {
  await p.evaluate(seedCalendarTags);
  const read = () => p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const tags = [...document.querySelectorAll('#monthCal .mcal-tag')];
    return { dark: document.body.classList.contains('dark'), body: norm('var(--text)'), colors: [...new Set(tags.map(el => getComputedStyle(el).color))], n: tags.length,
      done: getComputedStyle(document.querySelector('#monthCal .mcal-tag.t-done')).color };
  }, inPageNorm);
  const light = await read();
  assert.equal(light.dark, false);
  assert.ok(light.n >= 8, '라벨이 충분히 그려지지 않았다: ' + light.n);
  assert.deepEqual(light.colors, [light.body]);
  await p.evaluate(() => { document.body.classList.add('dark'); renderAll(); });
  const dark = await read();
  assert.equal(dark.dark, true);
  // 다크 본문색은 라이트와 달라야 한다(값이 고정돼 있으면 여기서 구분된다)
  assert.notEqual(dark.body, light.body, '다크/라이트 본문색이 같아 이 검사가 구분을 못 한다');
  assert.deepEqual(dark.colors, [dark.body], `다크 테마 라벨 글자색이 본문색이 아니다: ${JSON.stringify(dark.colors)} (기대 ${dark.body})`);
  assert.equal(dark.done, dark.body);
});

test('달력 범례가 실제 라벨과 같은 모양이다 (공유 공간: 주인·중요·카테고리·완료·메모)', 1280, async p => {
  await p.evaluate(seedCalendarTags);
  const g = await p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const items = [...document.querySelectorAll('.calendar-legend .mcal-tag')].map(el => {
      const cs = getComputedStyle(el);
      return { text: el.textContent.trim(), cls: el.className, style: el.getAttribute('style') || '', bg: cs.backgroundColor, color: cs.color, barW: cs.borderLeftWidth, bar: cs.borderLeftColor, deco: cs.textDecorationLine, weight: cs.fontWeight };
    });
    return { items, body: norm('var(--text)'), green: norm('var(--green)'), blue: norm('var(--blue)'), important: norm(IMPORTANT_COLOR),
      cats: getCategories().map(c => ({ name: c.name, want: norm(c.color) })),
      owners: partyOptions().map(o => ({ label: o.label, want: norm(ownerColorFor(o.key)) })),
      badges: document.querySelectorAll('.calendar-legend .owner-badge').length,
      visible: getComputedStyle(document.querySelector('.calendar-legend')).display };
  }, inPageNorm);
  assert.notEqual(g.visible, 'none');
  const byText = (t) => g.items.find(i => i.text === t);
  for (const i of g.items) {
    assert.equal(/background/.test(i.style), false, `${i.text} 인라인 배경: ${i.style}`);
    assert.equal(i.bg, TRANSPARENT, `${i.text} 범례가 색 바탕이다`);
    assert.equal(i.color, g.body, `${i.text} 범례 글자색 ${i.color}`);
    assert.equal(i.barW, '3px', `${i.text} 범례 막대 ${i.barW}`);
  }
  assert.equal(g.badges, 0, '범례에 예전 색 바탕 주인 뱃지가 남았다');
  for (const c of g.cats) assert.equal(byText(c.name).bar, c.want, `카테고리 ${c.name} 범례 막대`);
  for (const o of g.owners) assert.equal(byText(o.label).bar, o.want, `주인 ${o.label} 범례 막대`);
  assert.equal(byText('중요').bar, g.important);
  assert.ok(Number(byText('중요').weight) >= 700);
  assert.equal(byText('완료').bar, g.green);
  assert.equal(byText('완료').deco, 'line-through');
  assert.equal(byText('메모').bar, g.blue);
  // 정적 범례 뼈대(렌더 전 상태)도 같은 언어: 한 일은 녹색 + 취소선, 메모는 파랑
  const base = await p.evaluate((normSrc) => {
    const norm = eval(normSrc);
    const probe = (cls) => { const el = document.createElement('span'); el.className = 'mcal-tag ' + cls; el.textContent = 'x'; document.body.appendChild(el); const cs = getComputedStyle(el); const o = { bg: cs.backgroundColor, bar: cs.borderLeftColor, deco: cs.textDecorationLine }; el.remove(); return o; };
    return { todo: probe('t-todo'), done: probe('t-done'), note: probe('t-note'), green: norm('var(--green)'), blue: norm('var(--blue)') };
  }, inPageNorm);
  for (const k of ['todo', 'done', 'note']) assert.equal(base[k].bg, TRANSPARENT, k);
  assert.equal(base.done.bar, base.green);
  assert.equal(base.done.deco, 'line-through');
  assert.equal(base.note.bar, base.blue);
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

// ── Task 8: 조용한 종이 노트 (명조 제목 + 선 카드) ──
// 아래 검증은 캐스케이드를 직접 읽는다. css/app-design.css 가 :is(body,body.dark) 접두로 나중에 로드되어
// 굵기·자간·그림자를 덮어쓸 수 있으므로 "규칙이 있다"가 아니라 "계산된 값이 그렇다"를 확인한다.
// 테스트 하네스는 외부 요청을 막아 Google Fonts 가 실제로 로드되지 않는다. 그래서 그려진 글자 폭이 아니라
// 선언된 글꼴 체인(--ui-serif 가 풀린 값)과 index.html 의 폰트 링크를 확인한다.
const SERIF_TARGETS = [
  ['로고', '.logo-text h1'],
  ['홈 날짜', '#homeView .hero h2'],
  ['오늘 할 일 제목', '.today-card .ui-section-head h2'],
  ['달력 제목', '.calendar-heading > span'],
];
const serifChain = (p) => p.evaluate(() => {
  const i = document.createElement('i'); i.style.fontFamily = 'var(--ui-serif)'; document.body.appendChild(i);
  const v = getComputedStyle(i).fontFamily; i.remove(); return v;
});
const fontOf = (p, sel) => p.locator(sel).first().evaluate(e => {
  const cs = getComputedStyle(e); return { ff: cs.fontFamily, fw: cs.fontWeight, ls: cs.letterSpacing, fs: cs.fontSize };
});

for (const w of WIDTHS) {
  test(`날짜와 제목은 명조체, 본문은 고딕이다 (${w}px)`, w, async p => {
    const chain = await serifChain(p);
    // 토큰이 풀렸고, 첫째가 웹폰트, 마지막이 일반 serif 다(macOS 전용 글꼴로 끝나지 않는다)
    assert.match(chain, /^"?Noto Serif KR"?, /, chain);
    const parts = chain.split(',').map(s => s.trim().replace(/"/g, ''));
    assert.deepEqual(parts, ['Noto Serif KR', 'AppleMyungjo', 'serif']);
    await p.evaluate(() => openDayDetail('2026-10-02'));
    for (const [label, sel] of [...SERIF_TARGETS, ['날짜 팝업 날짜', '#dmDate']]) {
      const f = await fontOf(p, sel);
      assert.equal(f.ff, chain, `${label}(${sel}) 글꼴 ${f.ff}`);
      assert.equal(f.fw, '400', `${label} 굵기 ${f.fw} (app-design.css 의 700/500 이 이겨 있다)`);
      assert.ok(f.ls === 'normal' || f.ls === '0px', `${label} 자간 ${f.ls} (app-design.css 의 -.03em 이 이겨 있다)`); // letter-spacing:0 은 normal 로 계산된다
    }
    // 본문과 그 밖의 글자는 고딕 그대로
    for (const sel of ['body', '#todayCount', '.filter-tabs button', '.calendar-mode button', '.card-title:not(.calendar-titlebar)', '#calMonthLabel']) {
      const loc = p.locator(sel).first();
      if (!await loc.count()) continue;
      const ff = await loc.evaluate(e => getComputedStyle(e).fontFamily);
      assert.equal(/Noto Serif KR|AppleMyungjo/.test(ff), false, `${sel} 는 고딕이어야 한다: ${ff}`);
      assert.match(ff, /Noto Sans KR/, sel + ' ' + ff);
    }
  });
}

test('명조체는 다크 테마에서도 같다', 375, async p => {
  await p.evaluate(() => document.body.classList.add('dark'));
  const chain = await serifChain(p);
  for (const [label, sel] of SERIF_TARGETS) {
    const f = await fontOf(p, sel);
    assert.equal(f.ff, chain, label + ' ' + f.ff);
    assert.equal(f.fw, '400', label + ' 굵기 ' + f.fw);
    assert.ok(f.ls === 'normal' || f.ls === '0px', label + ' 자간 ' + f.ls);
  }
});

test('폰트 링크는 명조 400 만 더하고 기존 가족을 지킨다', 375, async () => {
  const html = fs.readFileSync(path.join(process.env.MINB_ROOT || path.join(__dirname, '..'), 'index.html'), 'utf8');
  const link = (html.match(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1];
  assert.ok(link, '구글 폰트 링크가 없다');
  // 명조는 400 만 쓴다. 600 은 렌더 차단 폰트 요청만 키우므로 다시 넣지 않는다.
  assert.ok(/family=Noto\+Serif\+KR:wght@400(&|$)/.test(link), link);
  assert.ok(link.includes('family=Noto+Sans+KR:wght@300;400;500;700;900'), link);
  assert.ok(link.includes('family=Outfit:wght@300;400;600;800'), link);
  assert.ok(link.includes('display=swap'), link);
});

test('카드는 그림자 대신 선으로 나뉜다 (평상시·호버·다크)', 375, async p => {
  await p.addStyleTag({ content: '*{transition:none!important}' });
  const read = (sel) => p.locator(sel).first().evaluate(e => {
    const cs = getComputedStyle(e);
    return { shadow: cs.boxShadow, w: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
      style: cs.borderTopStyle, color: cs.borderTopColor };
  });
  for (const dark of [false, true]) {
    if (dark) await p.evaluate(() => document.body.classList.add('dark'));
    const wantColor = await p.evaluate((src) => eval(src)(getComputedStyle(document.body).getPropertyValue('--ui-border').trim()), inPageNorm);
    for (const sel of ['.today-card', '.calendar-card']) {
      const rest = await read(sel);
      assert.equal(rest.shadow, 'none', `${sel} 그림자 ${rest.shadow} (dark=${dark})`);
      assert.deepEqual(rest.w, ['1px', '1px', '1px', '1px'], `${sel} 테두리 ${rest.w} (dark=${dark})`);
      assert.equal(rest.style, 'solid');
      assert.equal(rest.color, wantColor, `${sel} 테두리색 ${rest.color} (dark=${dark})`);
      await p.locator(sel).first().hover();
      const hov = await read(sel);
      assert.equal(hov.shadow, 'none', `${sel} 호버 그림자 ${hov.shadow} (dark=${dark})`);
    }
  }
});

test('.section-card 와 .reading-card 도 같은 선 카드다', 375, async p => {
  await p.addStyleTag({ content: '*{transition:none!important}' });
  await p.evaluate(() => {
    for (const c of ['section-card', 'reading-card']) {
      const d = document.createElement('div'); d.className = c; d.id = 'probe-' + c; d.style.cssText = 'position:relative;height:40px;margin:8px';
      document.body.prepend(d);
    }
  });
  for (const c of ['section-card', 'reading-card']) {
    const loc = p.locator('#probe-' + c);
    const read = () => loc.evaluate(e => { const cs = getComputedStyle(e); return { s: cs.boxShadow, w: cs.borderTopWidth }; });
    assert.deepEqual(await read(), { s: 'none', w: '1px' }, c);
    await loc.hover();
    assert.deepEqual(await read(), { s: 'none', w: '1px' }, c + ' hover');
  }
});

test('날짜 팝업 안의 카드는 선 없이 본문에 녹아 있다(#dmBody > .card 예외가 선 카드 규칙에 지지 않는다)', 375, async p => {
  await p.evaluate(() => {
    openDayDetail('2026-10-02');
    const d = document.createElement('div'); d.className = 'card'; d.id = 'probe-dm-card'; d.textContent = 'x';
    document.getElementById('dmBody').append(d);
  });
  const got = await p.locator('#probe-dm-card').evaluate(e => { const cs = getComputedStyle(e); return { s: cs.boxShadow, r: cs.borderRightWidth, b: cs.borderBottomWidth, l: cs.borderLeftWidth }; });
  // 윗선은 '.card + .card' 구분선이라 카드 앞 형제 여부에 따라 있을 수 있다. 좌·우·아래 테두리와 그림자만 본다.
  assert.deepEqual(got, { s: 'none', r: '0px', b: '0px', l: '0px' });
});

test('오늘 카드 윗선은 3px 강조선이 아니라 1px 헤어라인이다', 375, async p => {
  const top = await p.locator('.today-card').evaluate(e => getComputedStyle(e).borderTopWidth);
  assert.equal(top, '1px');
});

test('섹션 눈썹 글씨는 작고 조용하다', 375, async p => {
  const got = await p.locator('#settingsView .ui-eyebrow').first().evaluate(e => {
    const cs = getComputedStyle(e); return { fs: cs.fontSize, ls: cs.letterSpacing, c: cs.color };
  });
  assert.equal(got.fs, '12px', '눈썹 글자 크기(ui.css 14px 가 이기고 있다)');
  assert.equal(got.ls, '1.68px', '자간 .14em');
  const muted = await p.evaluate((src) => eval(src)('var(--ui-muted)'), inPageNorm);
  assert.equal(got.c, muted);
});

// 44px 칸이 이웃의 눌리는 자리를 훔치지 않는다. 위 테스트는 상자 크기만 재므로 구조적으로 이것을 못 본다:
// 음수 여백으로 넘친 44px 칸이 옆 요소(공유 뱃지 글자 오른쪽 끝, 체크박스 왼쪽 끝)를 덮으면 그 자리의 클릭이 엉뚱한 버튼으로 간다.
// 행의 눌리는 요소마다 '눈에 보이는 자리'(글자 범위, 체크박스는 상자)를 안쪽 가장자리까지 훑어 elementFromPoint 가 자기 자신을 돌려주는지 본다.
for (const w of [320, 375]) {
  for (const open of [false, true]) {
    test(`행의 눌리는 요소는 눈에 보이는 자리에서 자기 자신이 눌린다: 44px 칸이 이웃을 덮지 않는다 (${w}px, 메뉴 ${open ? '열림' : '닫힘'})`, w, async p => {
      await p.evaluate(seedTwoMemberSchedules);
      await p.evaluate(() => openDayDetail('2026-10-02'));
      if (open) await p.locator('#dmBody .todo-item[data-id="p1"] .todo-menu-btn').click();
      const got = await p.evaluate(() => {
        const out = { checked: 0, stolen: [] };
        for (const id of ['p1', 'p2']) {
          const row = document.querySelector(`#dmBody .todo-item[data-id="${id}"]`);
          row.scrollIntoView({ block: 'center' });
          for (const el of row.querySelectorAll('button, input, a')) {
            let r;
            if (el.tagName === 'INPUT') r = el.getBoundingClientRect();
            else { const g = document.createRange(); g.selectNodeContents(el); r = g.getBoundingClientRect(); }
            if (!r.width || !r.height) continue; // 숨겨진 요소(모바일에서 display:none 인 빠른 이동 등)
            const name = `${id} ${el.tagName.toLowerCase()}.${(el.className || '').toString().split(/\s+/)[0] || el.type} '${(el.textContent || '').trim().slice(0, 8)}'`;
            for (const fx of [0, 0.5, 1]) for (const fy of [0.15, 0.5, 0.85]) {
              // 안쪽 1px: 넘친 칸이 훔치는 자리는 2~5px 다.
              const x = r.left + Math.min(Math.max(r.width * fx, 1), r.width - 1), y = r.top + r.height * fy;
              const hit = document.elementFromPoint(x, y);
              out.checked++;
              // 알려진 예외(이 작업 이전부터, 5ba3a92 에서도 3px): 공유 뱃지의 ·앞 여백이 카테고리 뱃지 글자 오른쪽 끝을 덮는다. 따로 고칠 일.
              if (el.classList.contains('tcat-badge') && hit && hit.closest('.scope-badge')) continue;
              if (!(hit && el.contains(hit))) out.stolen.push(`${name} @fx=${fx},fy=${fy} -> ${hit && ((hit.className || hit.tagName).toString().split(/\s+/)[0])}`);
            }
          }
        }
        return out;
      });
      assert.ok(got.checked > 40, `훑은 점이 너무 적다: ${got.checked}`);
      assert.deepEqual(got.stolen, [], '이웃이 가로챈 자리:\n' + got.stolen.join('\n'));
    });
  }
}

// 이모지를 글자(수정·삭제·닫기)로 바꾼 버튼도 모바일에서 44px 터치 목표여야 한다. 메모 줄·금고·카테고리 편집·모달 닫기.
for (const w of [320, 375]) {
  test(`이모지를 뗀 글자 버튼(메모 수정·금고 수정·카테고리 삭제·모달 닫기)이 44px 터치 목표다 (${w}px)`, w, async p => {
    await p.evaluate(() => {
      spaceData.sharedLogins = [{ id: 'v1', service: '넷플릭스', username: 'a', password: 'b' }];
      userData.personalDays['2026-10-02'] = { todos: [], notes: { st: '스페인어 단어' } };
      openDayDetail('2026-10-02'); openVaultModal(); openCatEditor(); openDashboardCategoryEditor();
    });
    const sel = { '메모 수정': '#homeMemoEntries .memo-entry-actions button', '금고 수정': '.vault-actions button',
      '카테고리 삭제': '#catEditBody .cat-edit-del', '홈 카테고리 삭제': '#dashCatEditBody .cat-edit-del', '모달 닫기': '#catEditModal .card-title .small-btn' };
    const got = await p.evaluate((sel) => Object.fromEntries(Object.entries(sel).map(([k, q]) => {
      const e = document.querySelector(q); if (!e) return [k, null];
      const r = e.getBoundingClientRect(); return [k, { w: r.width, h: r.height, text: e.textContent.trim() }];
    })), sel);
    for (const [k, b] of Object.entries(got)) {
      assert.ok(b && b.w && b.h, `${k} 버튼이 없다/보이지 않는다`);
      assert.ok(b.w >= 43.99 && b.h >= 43.99, `${k} '${b.text}' 터치 목표 ${b.w}x${b.h} (44x44 미만)`);
    }
    assert.equal(got['메모 수정'].text, '수정');
    assert.equal(got['카테고리 삭제'].text, '삭제');
    assert.equal(got['모달 닫기'].text, '닫기');
  });
}

// ── 장식 이모지 스윕 ──
// 홈 화면의 UI 글자(홈·날짜 팝업·설정·홈에서 여는 모달)에 장식 이모지가 없어야 한다. 새 화면·새 버튼이 이모지를 되들여오면 여기서 걸린다.
// 페이지 안에서 실행: 화면에 그려진 모든 글자 노드, 접근성 이름 속성, ::before/::after 내용을 훑는다.
// 허용 목록은 '의미를 지닌' 것뿐이며, 요소 범위로 좁혀 둔다(같은 이모지가 다른 곳에 나오면 걸린다).
function sweepDecorInPage(memoIcons) {
  // ✕ 는 '닫기' 앞에 붙던 장식이라 잡는다. 행의 삭제 버튼(글자 ✕ + 제목)만 아래에서 허용한다.
  const DECOR = /\p{Extended_Pictographic}|\uFE0F|[\u2713\u2714\u2715\u2716\u2726\u2727]/u;
  const ALLOW = [
    ['.mcal-drink-mark, .mcal-ex-mark, .mcal-love-mark', '달력 날짜 칸의 음주·운동·함께 표시: 기능 표식'],
    ['.cat-card .icon', '홈 바로가기 카드 icon 필드(🇪🇸 📚 📔 💌): 사용자 데이터'],
    ['.move-handle', '드래그로 날짜 옮기기 손잡이 ↕: 기능 표식'],
    ['.member-chip', '프로필 사진이 없는 멤버의 자리표시 👤(보류: 보고서 참고)'],
    ['#toast', '토스트 메시지 이모지'],
  ].map(a => a[0]).join(', ');
  const MEMO_CHIP = '#memoCatRow .tcat-chip, .memo-entry-item .tcat-badge, #catPicker .tcat-chip';
  const stripUserIcon = (el, text) => {
    // 카테고리·공유 팝오버의 '현재 선택' 표시 ✓ 는 선택 상태를 전하는 유일한 글자라 남긴다(보류: 보고서 참고)
    if (el.closest('#catPicker .sel')) text = text.replace(/^\u2713 /, '');
    if (!el.closest(MEMO_CHIP)) return text;
    for (const ic of memoIcons) if (text.startsWith(ic)) return text.slice(ic.length);
    return text; // 사용자가 고른 메모 카테고리 icon 은 앞머리 한 번만 허용
  };
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/)[0] : ''));
    }
    return parts.slice(-4).join('>');
  };
  const hits = [];
  // 행의 삭제 버튼은 글자가 ✕ 하나뿐이다(title·aria-label 로 이름이 있다). 정확히 '✕' 인 글자만, 그런 버튼 안에서만 허용한다.
  const DELETE_X = '.todo-btns button, #recurList button.del';
  const check = (el, kind, text) => {
    if (!text || el.closest(ALLOW)) return;
    if (kind === 'text' && text.trim() === '\u2715' && el.closest(DELETE_X)) return;
    const t = kind === 'text' ? stripUserIcon(el, text) : text;
    if (DECOR.test(t)) hits.push(`${pathOf(el)} [${kind}] ${JSON.stringify(text.trim().slice(0, 60))}`);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    check(el, 'text', n.nodeValue);
  }
  for (const el of document.body.querySelectorAll('*')) {
    for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-tooltip']) check(el, a, el.getAttribute(a));
    for (const ps of ['::before', '::after']) {
      const c = getComputedStyle(el, ps).content;
      if (c && c !== 'none' && c !== 'normal' && !/^attr\(/.test(c)) check(el, ps, c);
    }
  }
  return hits;
}

test('홈 UI 글자에 장식 이모지가 없다 (홈·날짜 팝업·설정·홈에서 여는 모달; 의미 있는 것만 허용)', 375, async p => {
  const hits = await p.evaluate(async ([fnSrc]) => {
    const sweep = eval('(' + fnSrc + ')');
    const memoIcons = getMemoCats().map(c => c.icon).filter(Boolean);
    const all = [], seen = new Set();
    // 같은 자리는 한 번만 적는다(모달을 여는 단계마다 body 전체를 다시 훑기 때문)
    const run = (label) => { for (const h of sweep(memoIcons)) if (!seen.has(h)) { seen.add(h); all.push(label + ' :: ' + h); } };
    const KEY = '2026-10-02';
    // ── 시드: 화면의 모든 갈래(중요·알림·알림 발송됨·배우자 완료·반복·메모·기간 일정·생리 예측·금고 계정·스터디 요약)가 그려지게 ──
    spaceData.members = ['A', 'B'];
    spaceData.memberProfiles = { A: { name: '테스트' }, B: { name: '배우자' } };
    const at = (h, m) => new Date(2026, 9, 2, h, m).getTime();
    userData.personalDays[KEY] = {
      todos: [
        { id: 'p1', text: '내 비공개 일정', by: 'A', time: '19:30', location: '서울역', cat: 'wk', visibility: 'private', important: true, remindAtMs: at(18, 0) },
        { id: 'p2', text: '알림 나간 일정', by: 'A', time: '20:00', cat: 'st', visibility: 'shared', remindAtMs: at(7, 0), reminderSentAt: at(7, 1) },
        { id: 'p3', text: '기간 일정', by: 'A', cat: 'etc', visibility: 'private', startDate: KEY, endDate: '2026-10-04', done: true },
      ],
      notes: { st: '스페인어 단어 10개', [EXERCISE_CAT_ID]: '[유산소] 러닝 30분\n[근육운동] 스쿼트' },
      recDone: { rc1: 'B' },
    };
    spaceData.days[KEY] = { todos: [{ id: 's1', text: '배우자 일정', by: 'B', time: '21:00', cat: 'ex', visibility: 'shared', done: true, doneBy: 'A' }] };
    userData.personalRecurring = [{ id: 'rc1', text: '금요일 운동', days: [5], cat: 'ex', by: 'A', visibility: 'shared' }];
    spaceData.recurring = [];
    userData.personalDays['2026-10-05'] = { todos: [
      { id: 'u1', text: '다음 주 약속', by: 'A', time: '18:30', location: '강남역', cat: 'wk', visibility: 'private', important: true },
    ] };
    spaceData.periodDays = { '2026-08-01': true, '2026-08-02': true, '2026-08-29': true, '2026-08-30': true };
    spaceData.sharedLogins = [{ id: 'v1', service: '넷플릭스', username: 'me@example.com', password: 'pw' }];
    userData.personalDrinkDays = { '2026-09-25': true };
    renderAll();
    renderStudyStats({ stats: { days: 3, words: 20, dias: 4, diasTotal: 16, streak: 5 } });
    renderStudyStats({ studiedDates: ['2026-10-01'], words: { a: true } });
    run('홈');
    // 금주 줄: 기록 없음 / 오늘 음주 / 이어지는 중
    for (const [label, drink] of [['음주 기록 없음', {}], ['오늘 음주', { [KEY]: true }], ['금주 이어지는 중', { '2026-09-25': true }]]) {
      userData.personalDrinkDays = drink; renderAll(); renderSobriety(); run('금주 줄 ' + label);
    }
    // 날짜 팝업: 행 메뉴를 열고, 반복 패널·모든 할 일 완료(진행 알약)·빈 날까지
    openDayDetail(KEY);
    toggleRecurPanel();
    document.querySelector('#dmBody .todo-item[data-id="p1"] .todo-menu-btn').click();
    run('날짜 팝업');
    userData.personalDays[KEY].todos.forEach(t => { t.done = true; });
    renderAll(); openDayDetail(KEY); run('날짜 팝업(모두 완료)');
    openDayDetail('2026-10-03'); run('날짜 팝업(빈 날)');
    // 팝오버: 카테고리·메모 카테고리·공유 범위
    const ev = { stopPropagation() {}, clientX: 40, clientY: 40 };
    openCatPicker(ev, KEY, 'todo', 'p1'); run('카테고리 팝오버');
    openMemoCatPicker(ev, 'st', 0); run('메모 카테고리 팝오버');
    openSharePicker(ev, KEY, 'p1'); run('공유 범위 팝오버');
    closeCatPicker();
    // 홈에서 여는 모달
    openSearchModal(); document.getElementById('searchInput').value = '일정'; runSearch(); run('검색 모달');
    openMonthReport(); run('월 리포트');
    openSobrietyModal(); run('금주 현황');
    openExerciseModal(KEY); run('운동 기록');
    openRecurSetup(KEY, 'p1'); run('반복 설정');
    openCatEditor(); run('카테고리 편집');
    openDashboardCategoryEditor(); run('홈 카테고리 편집');
    openVaultModal(); run('공유 계정');
    moveTodoToDateFromKey(KEY, 'p1'); run('날짜 변경');
    openTodoDetail(KEY, 'p1'); run('일정 수정'); document.querySelector('.todo-editor-modal').remove();
    void confirmScheduleDeletion('운동', true); run('삭제 확인');
    return all;
  }, [sweepDecorInPage.toString()]);
  assert.deepEqual(hits, [], `장식 이모지 ${hits.length}곳:\n` + hits.join('\n'));
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
