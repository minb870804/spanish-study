# 홈 화면 시각 다듬기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 민비앱 홈 화면의 알약 버튼 9개를 자리별로 재배치하고, 날짜 팝업에 남은 이모지·원색 뱃지를 정리하고, 명조체와 얇은 선으로 "조용한 종이 노트" 인상을 완성한다.

**Architecture:** 기능·데이터·요소 ID는 전혀 건드리지 않는 순수 표현 계층 변경이다. 먼저 `index.html`의 인라인 `<style>` 1,155줄을 `css/app.css`로 옮겨(보이는 변화 없음) 스타일이 살 집을 만들고, 그 다음 화면별로 마크업과 CSS를 고친다. 고치는 화면에 걸린 `css/app-design.css`의 덮어쓰기 규칙은 `app.css`로 흡수하고 원본에서 지운다. 손대지 않는 화면의 규칙은 그대로 둔다.

**Tech Stack:** 정적 HTML/CSS/바닐라 JS, Firebase compat SDK(변경 없음), Playwright 기반 `tests/*.cjs` 회귀 스위트, Vercel 자동 배포.

## Global Constraints

- 요소 ID, 함수 이름, `onclick` 핸들러 이름을 바꾸지 않는다. `js/*.js`가 ID로 DOM을 찾는다
- `cat.icon`(사용자가 고른 카테고리 아이콘), `MOODS`(교환일기 기분), `cat.color`·`MEMBER_SIGNATURES`(카테고리·소유자 색)는 유지한다. 모두 의미를 가진 데이터다
- 터치 타깃 최소 44px(`--ui-control`), 폼 컨트롤 글자 16px 이상(iOS 확대 방지)
- 스타일시트 로드 순서를 보존한다: 인라인 위치 → `ui.css` → `schedule-editor.css` → `home-settings.css` → `recurrence.css` → `app-design.css`
- 색은 `css/ui.css`의 `--ui-*` 토큰을 쓴다. 새 토큰 체계를 만들지 않는다
- 테스트 실행 시 `MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright` 를 지정한다
- `AGENTS.md` 규칙: 검증을 마친 변경은 커밋하고 작업 브랜치를 원격에 푸시한다. 생성된 검증 이미지(`.omo/evidence/**`, `test-results/`)와 임시 파일은 커밋하지 않는다
- 작업 브랜치: `feat/home-visual-refinement`
- 토스트 메시지의 이모지(`🗑 삭제했어요` 등)는 이번 범위가 아니다. 스펙이 다루지 않는다
- **줄 번호 주의:** Task 2가 `index.html`에서 1,155줄을 들어내므로 그 이후 모든 줄 번호가 약 1,154줄씩 당겨진다. Task 3부터는 줄 번호 대신 **찾을 코드 조각**으로 위치를 지정한다. `grep -n '<찾을 조각>' index.html` 으로 현재 줄을 확인하고 작업한다
- 인라인 `style="..."`은 스타일시트를 이긴다. 색을 CSS로 바꾸려면 렌더 코드의 인라인 속성부터 손봐야 한다 (Task 6)

## 기준값 (2026-09-29 측정, 375px)

Task 2의 "보이는 변화 없음"을 판정하는 근거다.

| 대상 | 속성 | 값 |
|---|---|---|
| `body` | backgroundColor | `rgb(245, 243, 238)` |
| `body` | color | `rgb(27, 29, 31)` |
| `header` | backgroundColor | `rgb(255, 255, 255)` |
| `header` | backgroundImage | `none` |
| `header` | borderBottomWidth | `1px` |
| `.card` | borderRadius | `14px` |
| `.card` | boxShadow | `rgba(62, 52, 40, 0.04) 0px 2px 8px 0px` |
| `.card` | backgroundColor | `rgb(255, 255, 255)` |
| `.app-nav` | position | `fixed` |
| `.app-nav` | height | `68px` |
| `.small-btn` | minHeight | `44px` |
| `.small-btn` | borderRadius | `8px` |

## File Structure

**생성**
- `css/app.css` — `index.html`에서 옮겨온 컴포넌트 스타일. Task 2 이후 이 파일이 홈 화면 스타일의 주된 집이 된다
- `tests/home-visual.cjs` — 홈·달력·날짜 팝업의 구조/스타일 회귀 테스트. 375/768/1280 폭

**수정**
- `index.html` — 인라인 `<style>` 제거(Task 2), 헤더·달력·날짜 팝업 마크업(Task 3~7)
- `css/app-design.css` — 손댄 화면의 덮어쓰기 규칙을 `app.css`로 옮기고 삭제
- `css/ui.css` — 부족한 토큰만 추가(Task 8)
- `tests/recurrence.cjs` — `fixture()`에 모드 인자 추가(Task 1). 기존 호출부 동작은 그대로

---

### Task 1: 시각 회귀 테스트 하네스

`tests/recurrence.cjs`의 `fixture()`는 항상 날짜 팝업과 반복 패널을 연다. 홈 화면을 그대로 보려면 그 단계를 건너뛸 수 있어야 한다. 기본값을 유지한 채 모드 인자를 추가하고, 새 테스트 파일을 만든다.

**Files:**
- Modify: `tests/recurrence.cjs:4-14` (`fixture` 함수)
- Create: `tests/home-visual.cjs`

**Interfaces:**
- Consumes: `tests/recurrence.cjs`의 `{ fixture, chromium }`
- Produces: `fixture(browser, width, mode)` — `mode` 기본 `'recur'`(기존 동작: 날짜 팝업+반복 패널 염), `'home'`(홈 화면만), `'day'`(날짜 팝업만). 반환은 기존과 동일한 `{page, context, errors}`

- [ ] **Step 1: `fixture()`에 모드 인자 추가**

`tests/recurrence.cjs`의 `async function fixture(browser,width=375){` 를 `async function fixture(browser,width=375,mode='recur'){` 로 바꾸고, 마지막 `await page.evaluate(...)` 호출을 아래로 교체한다. 기존 코드와 다른 곳은 `mode` 인자와 마지막 두 줄의 조건 분기뿐이다.

```js
await page.evaluate(mode=>{
 currentUser={uid:'A',displayName:'테스트'};
 userData={personalRecurring:[],personalDays:{}};
 spaceData={members:['A'],memberProfiles:{A:{name:'테스트'}},days:{},recurring:[]};
 spaceId='space';
 selectedDate=new Date(2026,9,2);
 document.getElementById('loginOverlay').style.display='none';
 if(mode==='recur'||mode==='day')openDayDetail('2026-10-02');
 if(mode==='recur')toggleRecurPanel();
 if(mode==='home')renderAll();
},mode);
```

- [ ] **Step 2: 기존 테스트가 그대로 통과하는지 확인 (기존 호출부는 인자를 안 넘기므로 `'recur'`)**

```bash
cd /Volumes/minb/Documents/MINB/Projects/minb-app
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/recurrence.cjs
```

Expected: 기존과 동일하게 전부 PASS. 실패하면 Step 1의 교체가 원본과 달라진 것이므로 되돌린다.

- [ ] **Step 3: 특성화 테스트 작성**

이것은 **현재 모습을 붙잡아두는 특성화 테스트**다. 실패를 먼저 보는 테스트가 아니라, 지금 통과해야 하고 Task 2(CSS 이전) 후에도 계속 통과해야 한다. `tests/home-visual.cjs`를 만든다.

```js
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
```

- [ ] **Step 4: 테스트 실행 — 지금 통과해야 한다**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `2/2 passed`. 실패하면 기준값이 아니라 하네스가 잘못된 것이다 — `errors` 배열을 출력해 원인을 본다.

- [ ] **Step 5: 커밋**

```bash
git checkout -b feat/home-visual-refinement
git add tests/recurrence.cjs tests/home-visual.cjs
git commit -m "test: 홈 화면 시각 회귀 하네스 추가

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 인라인 CSS를 css/app.css로 이전

보이는 변화가 없어야 한다. 규칙 내용·순서·선택자를 하나도 바꾸지 않는다.

**Files:**
- Create: `css/app.css`
- Modify: `index.html:34-1189` (인라인 `<style>` 제거), `index.html:1191` 앞에 `<link>` 추가

**Interfaces:**
- Consumes: Task 1의 `tests/home-visual.cjs`
- Produces: `css/app.css` — 홈 화면 컴포넌트 스타일의 주된 파일. Task 3~8이 이 파일을 고친다

- [ ] **Step 1: 인라인 스타일을 파일로 추출**

```bash
cd /Volumes/minb/Documents/MINB/Projects/minb-app
sed -n '35,1188p' index.html > css/app.css
head -3 css/app.css && echo '...' && tail -3 css/app.css
```

Expected: `<style>`/`</style>` 태그 없이 CSS 규칙만 담긴다. 첫 줄이 `<style>`이면 범위를 잘못 잡은 것이다.

- [ ] **Step 2: `index.html`에서 인라인 블록을 `<link>`로 교체**

34줄의 `<style>`부터 1189줄의 `</style>`까지를 지우고 그 자리에 아래 한 줄을 넣는다. **위치가 중요하다** — 뒤따르는 `ui.css` 등이 이 규칙을 덮어쓰는 데 의존한다.

```html
<link rel="stylesheet" href="css/app.css">
```

```bash
python3 - <<'PY'
import io
p='index.html'
lines=io.open(p,encoding='utf-8').read().split('\n')
assert lines[33].strip()=='<style>', lines[33]
assert lines[1188].strip()=='</style>', lines[1188]
lines[33:1189]=['<link rel="stylesheet" href="css/app.css">']
io.open(p,'w',encoding='utf-8').write('\n'.join(lines))
print('교체 완료')
PY
grep -n 'stylesheet' index.html | head -8
```

Expected: `css/app.css`가 `css/ui.css`보다 **먼저** 나온다.

- [ ] **Step 3: 특성화 테스트로 무변화 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `2/2 passed`. 실패하면 추출 범위가 한 줄 어긋난 것이다 — `css/app.css` 첫/마지막 줄을 확인한다.

- [ ] **Step 4: 전체 회귀 스위트 확인**

```bash
export MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright
node tests/minb-regression.cjs 2>&1 | tail -2
node tests/recurrence.cjs 2>&1 | tail -2
node tests/schedule-editor.cjs 2>&1 | tail -2
```

Expected: `minb-regression.cjs`는 `36/36 passed`. 나머지 둘도 실패 0.

- [ ] **Step 5: 커밋**

```bash
git add index.html css/app.css
git commit -m "refactor: 인라인 CSS를 css/app.css로 분리

보이는 변화 없음. 로드 순서 유지.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 헤더에 검색·테마 아이콘

`🔍 검색`을 달력 도구에서 헤더로 올리고, `🌓 테마`를 선 아이콘으로 바꾼다. 사용자 이름 앞 `👤`도 뺀다.

**Files:**
- Modify: `index.html` — `<div class="header-right">` 블록, `grep -n "userName').textContent" index.html` 로 찾는 한 줄, `function updateThemeButton()`, `grep -n '🔍 검색' index.html` 로 찾는 버튼
- Modify: `css/app.css` — `.icon-btn` 규칙 추가
- Modify: `tests/home-visual.cjs` — 테스트 추가

**Interfaces:**
- Consumes: Task 2의 `css/app.css`
- Produces: `.icon-btn` 클래스 — 44px 정사각 아이콘 버튼. Task 5가 재사용한다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/home-visual.cjs`의 `BASELINE` 아래에 추가한다.

```js
test('검색과 테마는 헤더의 아이콘 버튼이다', 'home', async p => {
  const header = p.locator('header .header-right');
  assert.equal(await header.locator('button[onclick="openSearchModal()"]').count(), 1);
  assert.equal(await p.locator('.calendar-tools button[onclick="openSearchModal()"]').count(), 0);
  assert.equal(await p.locator('#themeToggle svg').count(), 1);
  assert.equal((await p.locator('#themeToggle').textContent()).trim(), '');
  assert.equal(await p.locator('#themeToggle').getAttribute('aria-label'), '테마 바꾸기');
  const box = await p.locator('#themeToggle').boundingBox();
  assert.ok(box.height >= 44, `테마 버튼 높이 ${box.height}`);
});

test('헤더 UI에 장식 이모지가 없다', 'home', async p => {
  const text = await p.locator('header').innerText();
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]/u.test(text), false, text);
});
```

- [ ] **Step 2: 실행해서 실패 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: FAIL — `검색과 테마는 헤더의 아이콘 버튼이다` (헤더에 검색 버튼이 0개)

- [ ] **Step 3: 마크업 교체**

`index.html`의 `.header-right` 블록을 아래로 바꾼다.

```html
    <div class="header-right">
      <span id="userProfile" class="profile-badge" style="display: none;">
        <span id="userName">로딩중...</span>
        <button onclick="logout()" class="logout-btn">로그아웃</button>
      </span>
      <button type="button" class="hbtn icon-btn" onclick="openSearchModal()" aria-label="검색" title="검색">
        <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
      <button type="button" id="themeToggle" class="hbtn icon-btn" onclick="toggleTheme()" aria-label="테마 바꾸기" title="테마 바꾸기"></button>
    </div>
```

`grep -n '🔍 검색' index.html` 으로 찾은 달력 도구의 검색 버튼 한 줄을 삭제한다.

```html
          <button class="small-btn" onclick="openSearchModal()">🔍 검색</button>
```

사용자 이름(`grep -n "userName').textContent" index.html`)에서 `👤 `를 뺀다.

```js
  document.getElementById('userName').textContent = `${user.displayName || '사용자'}`;
```

- [ ] **Step 4: `updateThemeButton()`을 아이콘으로 교체**

```js
function updateThemeButton() {
  const btn = document.getElementById('themeToggle');
  const dark = document.body.classList.contains('dark');
  // 달 = 지금 밝음(누르면 어두워짐), 해 = 지금 어두움(누르면 밝아짐)
  btn.innerHTML = dark
    ? '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>'
    : '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';
  btn.setAttribute('aria-label', '테마 바꾸기');
}
```

- [ ] **Step 5: `.icon-btn` 스타일 추가**

`css/app.css` 맨 끝에 붙인다.

```css
/* 헤더 아이콘 버튼 — 글자 없이 아이콘만, 44px 터치 타깃 */
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ui-control); height: var(--ui-control); padding: 0;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  background: var(--ui-card); color: var(--ui-text); cursor: pointer;
}
.icon-btn .ui-icon { width: 20px; height: 20px; }
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `4/4 passed`

- [ ] **Step 7: 커밋**

```bash
git add index.html css/app.css tests/home-visual.cjs
git commit -m "feat: 검색·테마를 헤더 아이콘 버튼으로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 달력 도구 재배치

알약 버튼을 없애지 않고 자리만 옮긴다. `‹` `›` 화살표는 사용자 요청으로 유지한다.

**Files:**
- Modify: `index.html` — `.calendar-titlebar`, `.schedule-filter-bar`, 달력 아래 링크 줄 추가
- Modify: `css/app.css` — `.filter-tabs`, `.calendar-links` 규칙
- Modify: `tests/home-visual.cjs`

**Interfaces:**
- Consumes: Task 3의 `css/app.css`
- Produces: `.filter-tabs`(밑줄 탭), `.calendar-links`(작은 글씨 링크 줄) 클래스

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('달력 도구가 자리별로 나뉜다', 'home', async p => {
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
});

test('필터 선택 상태가 보인다', 'home', async p => {
  const on = p.locator('.filter-tabs button[aria-pressed="true"]');
  assert.equal(await on.count(), 1);
  assert.equal((await on.innerText()).trim(), '전체');
  await p.locator('.filter-tabs button[data-schedule-filter="mine"]').click();
  assert.equal((await p.locator('.filter-tabs button[aria-pressed="true"]').innerText()).trim(), '내 일정');
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Expected: FAIL — `.filter-tabs` 요소가 없다

- [ ] **Step 3: 달력 제목줄에서 도구 묶음 정리**

`<div class="calendar-tools">` 블록에서 `월 리포트`·`금주 현황`·`오늘` 세 버튼을 지운다. Task 3에서 검색은 이미 뺐으므로 `.calendar-tools` div 자체를 삭제한다. `.month-nav`(화살표 + `#calMonthLabel`)는 그대로 둔다.

주간/월간 레이블을 줄인다.

```html
<div class="calendar-mode" aria-label="달력 보기"><button class="ui-button" data-calendar-view="week" aria-pressed="false" onclick="setCalendarView('week')">주</button><button class="ui-button" data-calendar-view="month" aria-pressed="true" onclick="setCalendarView('month')">월</button></div>
```

- [ ] **Step 4: 필터를 밑줄 탭으로 교체**

`.schedule-filter-bar` 블록 전체를 아래로 바꾼다. `data-schedule-filter` 속성과 `setScheduleFilter()` 호출은 유지하고, `aria-pressed`를 추가한다.

```html
    <div class="filter-tabs" role="group" aria-label="일정 표시 범위">
      <button type="button" class="filter-tab" data-schedule-filter="all" aria-pressed="true" onclick="setScheduleFilter('all')">전체</button>
      <button type="button" class="filter-tab" data-schedule-filter="mine" aria-pressed="false" onclick="setScheduleFilter('mine')">내 일정</button>
      <button type="button" class="filter-tab" data-schedule-filter="shared" aria-pressed="false" onclick="setScheduleFilter('shared')">공유 일정</button>
    </div>
```

`renderAll()`은 현재 `btn.classList.toggle('sel', ...)`로 선택 상태를 칠한다. `aria-pressed`도 같이 맞추도록 그 줄을 바꾼다.

```js
  document.querySelectorAll('[data-schedule-filter]').forEach(btn => {
    const on = btn.dataset.scheduleFilter === scheduleFilter;
    btn.classList.toggle('sel', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
```

- [ ] **Step 5: 달력 아래 링크 줄 추가**

`<div id="monthCal"></div>` 바로 **뒤**, `.selected-agenda` 앞에 넣는다.

```html
    <div class="calendar-links">
      <button type="button" onclick="openMonthReport()">월 리포트</button>
      <button type="button" onclick="openSobrietyModal()">금주 현황</button>
      <button type="button" onclick="goToday()">오늘로</button>
    </div>
```

- [ ] **Step 6: 스타일 추가**

`css/app.css` 맨 끝에 붙인다.

```css
/* 일정 범위 필터 — 알약 대신 밑줄 탭 */
.filter-tabs { display: flex; gap: var(--ui-s5); margin: var(--ui-s4) 0 var(--ui-s3); }
.filter-tab {
  min-height: var(--ui-control); padding: 0 var(--ui-s1);
  border: 0; border-bottom: 2px solid transparent; background: none;
  color: var(--ui-muted); font: 500 var(--ui-small)/1.6 inherit; cursor: pointer;
}
.filter-tab[aria-pressed="true"] { color: var(--ui-text); border-bottom-color: var(--ui-text); font-weight: 700; }

/* 자주 쓰지 않는 달력 도구 — 달력 아래 조용한 링크 줄 */
.calendar-links { display: flex; gap: var(--ui-s5); margin-top: var(--ui-s4); flex-wrap: wrap; }
.calendar-links button {
  min-height: var(--ui-control); padding: 0; border: 0; background: none;
  color: var(--ui-muted); font: 500 var(--ui-small)/1.6 inherit; cursor: pointer;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--ui-border);
}
.calendar-links button:hover { color: var(--ui-text); }
```

- [ ] **Step 7: 쓰이지 않게 된 CSS 삭제**

마크업이 사라졌으므로 아래 규칙들은 죽은 코드다. `css/app.css`에서 지운다.

```css
  .schedule-filter-bar { ... }        /* 블록 전체 */
  .schedule-filter-label { ... }      /* 한 줄 */
  .calendar-tools { ... }             /* 기본 규칙 + 미디어쿼리 안 두 곳 */
```

`css/ui.css`의 `.calendar-tools { flex-wrap:wrap; }` 한 줄도 지운다.

```bash
grep -n "schedule-filter-bar\|schedule-filter-label\|calendar-tools" css/app.css css/ui.css index.html
```

Expected: 아무것도 안 나온다. 남아 있으면 그 줄을 지운다.

- [ ] **Step 8: 테스트 통과 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `6/6 passed`

- [ ] **Step 9: 커밋**

```bash
git add index.html css/app.css css/ui.css tests/home-visual.cjs
git commit -m "feat: 달력 도구를 자리별로 재배치

필터는 밑줄 탭, 리포트·금주·오늘은 달력 아래 링크 줄로.
월 이동 화살표는 유지.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 날짜 팝업 기록 버튼을 선 아이콘으로

**Files:**
- Modify: `index.html` — `<span class="dm-header-actions">` 블록(기록 버튼 4개와 닫기), `dmDate').textContent` 를 설정하는 `openDayDetail()` 안의 한 줄
- Modify: `css/app.css` — `.dm-drink-toggle` 계열 색 정리
- Modify: `tests/home-visual.cjs`

**Interfaces:**
- Consumes: `css/ui.css`의 `.ui-icon` (선 아이콘 공통 규칙)
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('날짜 팝업 기록 버튼은 선 아이콘이다', 'day', async p => {
  for (const id of ['dmExerciseBtn', 'dmDrinkToggle', 'dmPeriodToggle', 'dmLoveToggle']) {
    const btn = p.locator('#' + id);
    assert.equal(await btn.locator('svg').count(), 1, id + ' 아이콘 없음');
    const box = await btn.boundingBox();
    assert.ok(box.height >= 44, `${id} 높이 ${box.height}`);
  }
  assert.equal((await p.locator('#dmExerciseBtn').innerText()).trim(), '운동');
  assert.equal((await p.locator('#dmDrinkToggle').innerText()).trim(), '음주');
  assert.equal((await p.locator('#dmPeriodToggle').innerText()).trim(), '생리');
  assert.equal((await p.locator('#dmLoveToggle').innerText()).trim(), '기록');
});

test('날짜 팝업 제목과 닫기에 이모지가 없다', 'day', async p => {
  const head = await p.locator('.day-modal-card .card-title').innerText();
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2716}]/u.test(head), false, head);
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Expected: FAIL — `dmExerciseBtn 아이콘 없음`

- [ ] **Step 3: 마크업 교체**

`index.html`의 `.dm-header-actions` 블록을 아래로 바꾼다. **ID와 `onclick`·`aria-pressed`는 그대로다.**

```html
      <span class="dm-header-actions">
        <button type="button" class="dm-drink-toggle dm-ex-toggle" id="dmExerciseBtn" onclick="openExerciseModal()" aria-pressed="false">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/></svg>운동
        </button>
        <button type="button" class="dm-drink-toggle" id="dmDrinkToggle" onclick="toggleDrinkDay(modalKey)" aria-pressed="false">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10l-1 6a4 4 0 0 1-8 0zM12 13v7M8 21h8"/></svg>음주
        </button>
        <button type="button" class="dm-drink-toggle dm-period-toggle" id="dmPeriodToggle" onclick="togglePeriodDay(modalKey)" aria-pressed="false">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10z"/></svg>생리
        </button>
        <button type="button" class="dm-drink-toggle dm-love-toggle" id="dmLoveToggle" onclick="toggleLoveDay(modalKey)" aria-pressed="false">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8.5c0 4.5-8 11-8 11s-8-6.5-8-11a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8z"/></svg>기록
        </button>
        <button class="small-btn" onclick="closeDayModal()">닫기</button>
      </span>
```

`#dmDate`를 채우는 `openDayDetail()`의 `📅 `를 뺀다.

```js
  document.getElementById('dmDate').textContent = `${m}월 ${d}일 (${DAYS_KO[dateObj.getDay()]})`;
```

- [ ] **Step 4: 원색 테두리를 중립으로**

`css/app.css` 맨 끝에 붙인다. 켜진 상태(`aria-pressed="true"`)는 색 대신 톤 차이로 보인다.

```css
/* 하루 기록 버튼 — 원색 테두리 대신 중립 테두리와 톤 차이 */
.dm-header-actions .dm-drink-toggle {
  display: inline-flex; flex-direction: column; align-items: center; gap: var(--ui-s1);
  min-height: var(--ui-control); padding: var(--ui-s2) var(--ui-s3);
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  background: var(--ui-card); color: var(--ui-muted);
  font: 500 var(--ui-caption)/1.4 inherit; cursor: pointer;
}
.dm-header-actions .dm-drink-toggle .ui-icon { width: 18px; height: 18px; }
.dm-header-actions .dm-drink-toggle[aria-pressed="true"] {
  background: var(--ui-soft); border-color: var(--ui-accent); color: var(--ui-accent);
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `8/8 passed`

- [ ] **Step 6: 커밋**

```bash
git add index.html css/app.css tests/home-visual.cjs
git commit -m "feat: 날짜 팝업 기록 버튼을 선 아이콘으로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 일정 줄 뱃지를 회색 한 줄로

`scheduleScopeBadge()`가 만드는 `🔒 나만 · 공유하기` 등의 이모지를 빼고, 중요·시간·카테고리 뱃지를 한 줄 메타 텍스트로 낮춘다. "중요"만 색을 남긴다.

**카테고리 색 주의:** `.tcat-badge`는 네 곳에서 `style="background:${cat.color};"` 인라인으로 렌더된다. 인라인 속성은 스타일시트를 이기므로 CSS만 고치면 색 바탕이 그대로 남는다. 렌더 코드를 `--cat-color` 커스텀 속성으로 바꾸고, CSS가 그 값으로 **작은 점**을 그린다. 카테고리 색은 정보이므로 없애지 않고 점으로 남긴다(DESIGN.md §2: 의미색을 글자 라벨로 대체하지 않는다).

**Files:**
- Modify: `index.html` — `scheduleScopeBadge()`, `important-flag` 렌더, `.tcat-badge` 렌더 4곳
- Modify: `css/app.css` — `.scope-badge`, `.tcat-badge`, `.important-flag`
- Modify: `tests/home-visual.cjs`

**Interfaces:**
- Consumes: 없음
- Produces: `.tcat-badge`가 `--cat-color` 커스텀 속성을 받는다 (`style="--cat-color:${cat.color};"`)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('일정 줄 뱃지에 이모지가 없다', 'day', async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-02'] = { todos: [
      { id: 'a', text: '감사팀 면담', by: 'A', time: '14:00', cat: 'etc', visibility: 'private', important: true }
    ] };
    openDayDetail('2026-10-02');
  });
  const row = await p.locator('.dm-item').first().innerText();
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(row), false, row);
  assert.match(row, /중요/);
  assert.match(row, /14:00/);
});

test('카테고리 색은 바탕이 아니라 점으로 남는다', 'day', async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-02'] = { todos: [
      { id: 'a', text: '감사팀 면담', by: 'A', time: '14:00', cat: 'etc', visibility: 'private' }
    ] };
    openDayDetail('2026-10-02');
  });
  const badge = p.locator('.dm-item .tcat-badge').first();
  assert.equal(await badge.count(), 1);
  // 인라인 배경이 아니라 커스텀 속성으로 넘어와야 한다
  const style = await badge.getAttribute('style');
  assert.match(style, /--cat-color/, style);
  assert.equal(/background\s*:/.test(style), false, style);
  const bg = await badge.evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgba(0, 0, 0, 0)', '뱃지 바탕은 투명해야 한다');
  const dot = await badge.evaluate(el => getComputedStyle(el, '::before').backgroundColor);
  assert.notEqual(dot, 'rgba(0, 0, 0, 0)', '카테고리 색 점이 있어야 한다');
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Expected: FAIL — 행 텍스트에 `🔒` 또는 `❗`가 남아 있고, 뱃지 style에 `--cat-color`가 없다

- [ ] **Step 3: `scheduleScopeBadge()`에서 이모지 제거**

이모지만 빼고 나머지 동작(클릭 핸들러, 공유 상태 클래스)은 그대로 둔다.

```js
function scheduleScopeBadge(todo, key = '', kind = 'todo') {
  const shared = todoScope(todo, 'private') === 'shared';
  const mine = isTodoAuthor(todo);
  if (!mine) return `<span class="scope-badge shared">공유</span>`;
  // 배우자가 있는 할 일은 공유 여부와 주인(나·배우자·우리)을 한 번에 고른다.
  // '나만'은 상태처럼 보여 눌러볼 생각을 하기 어려웠던 터라 할 일을 라벨에 적는다.
  if (kind !== 'rec' && isShared()) {
    const pickLabel = shared ? '공유 중 · 변경' : '나만 · 공유하기';
    return `<button type="button" class="scope-badge scope-control ${shared ? 'shared' : ''}" onclick="openSharePicker(event, ${jsArg(key)}, ${jsArg(todo.id)})" title="공유 범위와 주인 고르기">${pickLabel}</button>`;
  }
  const action = kind === 'rec'
    ? `toggleRecurringSharing(${jsArg(todo.id)})`
    : `toggleTodoSharing(${jsArg(key)}, ${jsArg(todo.id)})`;
  const label = shared ? '공유 중 · 취소' : '나만';
  const title = shared ? '공유 취소 — 상대방 달력에서 숨기기' : '배우자와 공유';
  return `<button type="button" class="scope-badge scope-control ${shared ? 'shared' : ''}" onclick="${action}" title="${title}">${label}</button>`;
}
```

같은 파일에서 `🕐 ${esc(todo.time)}`, `📍 ${esc(todo.location)}` 두 곳의 이모지도 뺀다. 문자열만 바꾸고 조건은 그대로 둔다.

중요 표시(`grep -n '❗중요</span>' index.html`)에서도 이모지를 뺀다.

```js
  return isImportantTodo(t) ? '<span class="important-flag" title="중요 일정">중요</span>' : '';
```

- [ ] **Step 4: 카테고리 뱃지를 커스텀 속성으로 바꾸기**

`grep -n 'tcat-badge" style="background:' index.html` 으로 네 곳을 찾아, 각각 `style="background:${cat.color};"` 를 `style="--cat-color:${cat.color};"` 로 바꾼다. 커서 지정이 붙은 곳(`cursor:default`)은 그 선언을 남긴다.

```js
// 바꾸기 전 → 후 (네 곳 모두 같은 형태)
style="background:${cat.color};"            →  style="--cat-color:${cat.color};"
style="background:${cat.color}; cursor:default;"  →  style="--cat-color:${cat.color}; cursor:default;"
```

```bash
python3 - <<'PY'
import io
p='index.html'
s=io.open(p,encoding='utf-8').read()
before=s.count('tcat-badge" style="background:${cat.color}')
s=s.replace('style="background:${cat.color};"','style="--cat-color:${cat.color};"')
s=s.replace('style="background:${cat.color}; cursor:default;"','style="--cat-color:${cat.color}; cursor:default;"')
io.open(p,'w',encoding='utf-8').write(s)
print('바꾼 tcat-badge 수:',before)
PY
grep -c 'cat-color' index.html
```

Expected: `바꾼 tcat-badge 수: 4`, `grep -c` 결과 4.

- [ ] **Step 5: 메타 줄 스타일**

`css/app.css` 맨 끝에 붙인다.

```css
/* 일정 메타 — 원색 뱃지 대신 조용한 한 줄. 카테고리 색은 점으로, '중요'만 글자 색으로 남긴다 */
:is(.todo-item, .dm-item, .upcoming-todo) :is(.scope-badge, .tcat-badge) {
  padding: 0; border: 0; background: none; border-radius: 0; box-shadow: none;
  color: var(--ui-muted); font: 500 var(--ui-caption)/1.6 inherit;
}
:is(.todo-item, .dm-item, .upcoming-todo) :is(.scope-badge, .tcat-badge):hover {
  transform: none; box-shadow: none; color: var(--ui-text);
}
:is(.todo-item, .dm-item, .upcoming-todo) .tcat-badge::before {
  content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  margin-right: var(--ui-s1); vertical-align: 1px;
  background: var(--cat-color, var(--ui-muted));
}
:is(.todo-item, .dm-item, .upcoming-todo) .scope-badge::before {
  content: '·'; margin: 0 var(--ui-s2); color: var(--ui-border);
}
:is(.todo-item, .dm-item, .upcoming-todo) .important-flag {
  background: none; padding: 0; color: var(--red); font-weight: 700; font-size: var(--ui-caption);
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `10/10 passed`

- [ ] **Step 7: 카테고리 편집 화면이 깨지지 않았는지 확인**

`.tcat-badge`는 메모 카테고리 선택(`openMemoCatPicker`)에도 쓰인다. 거기서는 색 바탕이 선택지 구분 역할을 하므로, 위 CSS가 `.todo-item`/`.dm-item`/`.upcoming-todo` 안에서만 적용되는지 확인한다.

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node -e "
const {fixture,chromium}=require('./tests/recurrence.cjs');
(async()=>{const b=await chromium.launch();const {page,context}=await fixture(b,375,'day');
const bg=await page.evaluate(()=>{const el=document.querySelector('.note-card .tcat-badge, #memoCatRow .tcat-badge');
 return el?getComputedStyle(el).backgroundColor:'요소 없음';});
console.log('메모 카테고리 뱃지 배경:',bg,'(투명이면 안 됨)');
await context.close();await b.close();})()"
```

Expected: 투명(`rgba(0, 0, 0, 0)`)이 아니거나 `요소 없음`. 투명으로 나오면 위 선택자 범위를 좁힌다.

- [ ] **Step 8: 커밋**

```bash
git add index.html css/app.css tests/home-visual.cjs
git commit -m "feat: 일정 줄 뱃지를 조용한 한 줄 메타로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 달력 날짜 칸 라벨

원색 바탕 대신 왼쪽 색 막대 + 본문색 글씨. 카테고리·소유자 색은 막대에 남으므로 구분 기능은 유지된다.

**Files:**
- Modify: `css/app.css` — `.mcal-tag` 계열 (원본은 `app.css` 446~454줄 부근으로 이전됨)
- Modify: `tests/home-visual.cjs`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('달력 라벨은 색 바탕 대신 왼쪽 막대를 쓴다', 'home', async p => {
  await p.evaluate(() => {
    userData.personalDays['2026-10-02'] = { todos: [{ id: 'c', text: '감사팀 면담', by: 'A', cat: 'etc' }] };
    renderAll();
  });
  const tag = p.locator('.mcal-tag').first();
  assert.equal(await tag.count(), 1);
  const s = await tag.evaluate(el => {
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, left: c.borderLeftWidth, color: c.color };
  });
  assert.equal(s.bg, 'rgba(0, 0, 0, 0)', '배경은 투명해야 한다');
  assert.ok(parseFloat(s.left) >= 2, `왼쪽 막대 ${s.left}`);
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Expected: FAIL — `배경은 투명해야 한다`

- [ ] **Step 3: `.mcal-tag` 규칙 교체**

`css/app.css`에서 아래 세 줄을 찾아 교체한다.

```css
  .mcal-tag.t-todo { background: var(--red-light); color: var(--red); }
  .mcal-tag.t-done { background: var(--green-light); color: var(--green); }
  .mcal-tag.t-note { background: var(--blue-light); color: var(--blue); }
```

교체 후:

```css
  /* 일정 라벨 — 원색 바탕 대신 왼쪽 색 막대. 색은 종류 구분으로만 남긴다 */
  .mcal-tag.t-todo { background: none; color: var(--ui-text); border-left: 3px solid var(--red); padding-left: 4px; }
  .mcal-tag.t-done { background: none; color: var(--ui-muted); border-left: 3px solid var(--green); padding-left: 4px; text-decoration: line-through; }
  .mcal-tag.t-note { background: none; color: var(--ui-text); border-left: 3px solid var(--blue); padding-left: 4px; }
```

한 줄 자르기(말줄임표 없음)는 기존 `.mcal-tag` 규칙에 있으므로 건드리지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `11/11 passed`

- [ ] **Step 5: 일정이 많은 날 넘침 확인**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node -e "
const {fixture,chromium}=require('./tests/recurrence.cjs');
(async()=>{const b=await chromium.launch();const {page,context}=await fixture(b,375,'home');
await page.evaluate(()=>{userData.personalDays['2026-10-02']={todos:[1,2,3,4,5].map(i=>({id:'x'+i,text:'긴 제목의 일정 '+i,by:'A',cat:'etc'}))};renderAll();});
const cell=await page.locator('.mcal-day').filter({hasText:'2'}).first().boundingBox();
console.log('칸 높이', cell.height);
await context.close();await b.close();})()"
```

Expected: 칸 높이가 폭보다 과도하게 커지지 않는다(대략 120px 이하). 넘치면 `.mcal-day`의 최대 표시 개수를 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add css/app.css tests/home-visual.cjs
git commit -m "feat: 달력 라벨을 색 막대 방식으로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 명조체와 여백 정리

**Files:**
- Modify: `index.html:29` (폰트 링크)
- Modify: `css/ui.css` (`--ui-serif` 토큰 추가)
- Modify: `css/app.css` (제목 글꼴, 카드 그림자·테두리)
- Modify: `css/app-design.css` (홈 관련 덮어쓰기 흡수 후 삭제)
- Modify: `tests/home-visual.cjs`

**Interfaces:**
- Consumes: Task 2~7의 `css/app.css`
- Produces: `--ui-serif` 토큰

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('날짜와 제목에 명조체를 쓴다', 'home', async p => {
  const hero = await css(p, '#homeView .hero h2', 'fontFamily');
  assert.match(hero, /Noto Serif KR/);
  const body = await css(p, 'body', 'fontFamily');
  assert.equal(/Noto Serif KR/.test(body), false, '본문은 고딕 유지');
});

test('카드는 그림자 대신 선으로 나뉜다', 'home', async p => {
  assert.equal(await css(p, '.card', 'boxShadow'), 'none');
  assert.equal(await css(p, '.card', 'borderTopWidth'), '1px');
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Expected: FAIL — `hero` 글꼴에 `Noto Serif KR`이 없다

- [ ] **Step 3: 폰트 추가**

`index.html:29`의 링크를 바꾼다. 기존 가족(`Noto Sans KR`, `Outfit`)은 그대로 두고 `Noto Serif KR` 400/600만 더한다.

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&family=Noto+Serif+KR:wght@400;600&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
```

- [ ] **Step 4: 토큰 추가**

`css/ui.css`의 `:root` 블록 안에 한 줄 더한다.

```css
  --ui-serif:'Noto Serif KR','AppleMyungjo',serif;
```

- [ ] **Step 5: 제목 글꼴과 카드 정리**

`css/app.css` 맨 끝에 붙인다.

```css
/* 조용한 종이 노트 — 날짜와 제목만 명조, 본문은 고딕 */
.logo-text h1,
#homeView .hero h2,
.today-card .ui-section-head h2,
.calendar-heading > span,
#dmDate { font-family: var(--ui-serif); font-weight: 400; letter-spacing: 0; }

/* 카드 경계를 그림자에서 선으로 */
:is(body, body.dark) :is(.card, .section-card) { box-shadow: none; border: 1px solid var(--ui-border); }
:is(body, body.dark) :is(.card, .section-card):hover { box-shadow: none; }

/* 섹션 제목은 낮추고 내용이 먼저 읽히게 */
.ui-eyebrow { font-size: var(--ui-caption); letter-spacing: .14em; color: var(--ui-muted); }
```

- [ ] **Step 6: `app-design.css`에서 홈 관련 덮어쓰기 흡수**

`css/app-design.css`에서 아래 두 줄을 지운다. 방금 `app.css`가 같은 역할을 더 구체적으로 하고 있어 중복이다.

```css
:is(body,body.dark) :is(.card,.reading-card,.section-card):hover { box-shadow:var(--ui-shadow); }
:is(body,body.dark) .today-card { border-top:1px solid var(--ui-border); }
```

`.reading-card`는 독서 페이지에서 쓰므로 `app.css`의 규칙에 함께 넣는다. 위 Step 5의 카드 규칙 선택자를 아래로 바꾼다.

```css
:is(body, body.dark) :is(.card, .section-card, .reading-card) { box-shadow: none; border: 1px solid var(--ui-border); }
:is(body, body.dark) :is(.card, .section-card, .reading-card):hover { box-shadow: none; }
```

- [ ] **Step 7: 테스트 통과 확인**

Expected: `13/13 passed`

- [ ] **Step 8: 커밋**

```bash
git add index.html css/ui.css css/app.css css/app-design.css tests/home-visual.cjs
git commit -m "feat: 명조체 제목과 선 중심 카드 경계

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 폭·테마별 확인과 배포

**Files:**
- Modify: `tests/home-visual.cjs` (폭·테마 순회 추가)
- 배포: 커밋·병합·푸시

**Interfaces:**
- Consumes: Task 1~8 전부
- Produces: 없음

- [ ] **Step 1: 폭·테마 순회 테스트 추가**

`tests/home-visual.cjs`의 러너 `for (const c of cases)` 바로 앞에 넣는다.

```js
  // 375/768/1280 × 밝음/어두움에서 가로 넘침과 겹침이 없는지
  for (const width of [375, 768, 1280]) {
    for (const dark of [false, true]) {
      const { page, context } = await fixture(browser, width, 'home');
      try {
        if (dark) await page.evaluate(() => document.body.classList.add('dark'));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const name = `레이아웃 ${width} ${dark ? '어두움' : '밝음'}`;
        if (overflow > 1) { results.push({ name, pass: false, error: `가로 넘침 ${overflow}px` }); console.log('FAIL ' + name); }
        else { results.push({ name, pass: true }); console.log('PASS ' + name); }
      } finally { await context.close(); }
    }
  }
```

- [ ] **Step 2: 실행**

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
```

Expected: `19/19 passed` (기존 13 + 폭·테마 6)

- [ ] **Step 3: 전체 회귀 스위트**

```bash
export MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright
node tests/minb-regression.cjs 2>&1 | tail -2
node tests/recurrence.cjs 2>&1 | tail -2
node tests/schedule-editor.cjs 2>&1 | tail -2
node tests/monthly-save.cjs 2>&1 | tail -2
node tests/schedule-save.cjs 2>&1 | tail -2
node tests/diary-storage.cjs 2>&1 | tail -2
```

Expected: `minb-regression.cjs` `36/36 passed`, 나머지 실패 0. 실패하면 해당 Task로 돌아간다.

- [ ] **Step 4: 가족 요청 동작 직접 확인**

스펙 §7의 세 항목이다. 브라우저에서 실제로 눌러본다.

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node -e "
const {fixture,chromium}=require('./tests/recurrence.cjs');
(async()=>{const b=await chromium.launch();const {page,context}=await fixture(b,375,'home');
await page.evaluate(()=>{selectedDate=new Date(2026,9,21);renderAll();openSelectedDayQuickAdd();});
console.log('① FAB 날짜:', await page.evaluate(()=>document.getElementById('todoStartInput').value), '(기대 2026-10-21)');
await page.evaluate(()=>{closeDayModal();openTodayQuickAdd();});
console.log('   오늘 카드 버튼:', await page.evaluate(()=>document.getElementById('todoStartInput').value), '(기대 오늘)');
await page.evaluate(()=>{closeDayModal();userData.personalDays['2026-10-02']={todos:[{id:'d',text:'삭제 확인',by:'A',cat:'etc'}]};openDayDetail('2026-10-02');openTodoDetail('2026-10-02','d');});
console.log('② 수정 창 삭제 버튼:', await page.locator('.todo-editor-modal [data-delete]').count(), '(기대 1)');
await context.close();await b.close();})()"
```

Expected: ① `2026-10-21`과 오늘 날짜, ② `1`.

③ 교환일기는 별도로 확인한다.

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/minb-regression.cjs 2>&1 | grep -i shared | tail -3
```

Expected: shared 관련 항목 전부 PASS.

- [ ] **Step 5: 커밋과 푸시**

```bash
git add tests/home-visual.cjs
git commit -m "test: 폭·테마별 레이아웃 확인 추가

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin feat/home-visual-refinement
```

- [ ] **Step 6: main 병합과 배포**

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff feat/home-visual-refinement -m "Merge 홈 화면 시각 다듬기

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 7: 배포 확인**

```bash
sleep 60
gh api repos/minb870804/spanish-study/deployments --jq '.[0] | {sha: .sha[0:7], created: .created_at}'
ID=$(gh api repos/minb870804/spanish-study/deployments --jq '.[0].id')
gh api repos/minb870804/spanish-study/deployments/$ID/statuses --jq '.[0].state'
curl -s https://minb87.vercel.app/css/app.css -o /dev/null -w "app.css %{http_code}\n"
curl -s https://minb87.vercel.app/ | grep -c 'calendar-links'
```

Expected: 배포 `success`, `app.css` `200`, `calendar-links` 1 이상. Cloud Functions 변경이 없으므로 함수 배포는 하지 않는다.

- [ ] **Step 8: 실기기 확인 요청**

로컬 확인은 가짜 데이터라 실제 밀도를 못 본다. 사용자에게 폰에서 아래를 봐 달라고 전한다.

- 일정이 많은 날의 달력 칸에서 라벨이 넘치지 않는지
- 명조체가 아이폰에서 제대로 나오는지, 첫 로딩이 느려지지 않았는지
- 달력 아래로 내려간 월 리포트·금주 현황이 찾기 불편하지 않은지

---

## 완료 기준

- `tests/home-visual.cjs` 19/19 통과
- 기존 6개 스위트 실패 0 (`minb-regression.cjs` 36/36)
- 헤더·날짜 팝업 UI에 장식 이모지 없음. `cat.icon`·`MOODS`·의미색은 유지
- 375/768/1280 × 밝음/어두움에서 가로 넘침 없음
- `main` 푸시 후 Vercel 프로덕션 배포 `success`
