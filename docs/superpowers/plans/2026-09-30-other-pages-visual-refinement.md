# 나머지 네 페이지 시각 다듬기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스터디·일기장·교환일기·독서 네 페이지를 홈과 같은 "조용한 종이 노트" 모습으로 맞춘다 — 명조체 페이지 제목, 선으로 나눈 카드, 아이콘 테마 버튼, 장식 이모지 제거.

**Architecture:** 새 공용 스타일시트 `css/paper.css`를 다섯 페이지 모두의 맨 끝(`app-design.css` 뒤)에 로드하고, 홈의 공통 규칙을 `css/app.css`에서 그리로 옮긴다. 테마 버튼 그리기 코드 세 벌을 `js/app-shell.js` 한 곳으로 모은다. 그다음 페이지별로 장식 이모지를 걷어낸다. 기능·데이터·요소 ID는 바꾸지 않는다.

**Tech Stack:** 정적 HTML/CSS/바닐라 JS, Playwright 기반 `tests/*.cjs` 회귀 스위트, Vercel 자동 배포.

**Spec:** `docs/superpowers/specs/2026-09-30-other-pages-visual-refinement-design.md`

## Global Constraints

- 요소 ID, 함수 이름, `onclick` 핸들러 이름을 바꾸지 않는다. 특히 `updateThemeButton`, `toggleTheme`, `loadTheme`는 이름과 호출부를 유지한다
- 유지: `MOODS`(기분 이모지), 일기장 감정 태그(`{ id:'proud', icon:'✨', label:'뿌듯' }` 등 8개), 기분 자리표시 `|| '📝'`, 아바타 대체 `: '👤'`(사진이 없을 때), `cat.icon`, 스터디 문법 설명의 `➔` 화살표(학습 내용), 스터디 진도의 완료 표시 `✓`
- 스터디 8칸 탭 구조 유지. 학습 **내용**(단어·예문·활용표·발음 설명의 텍스트)은 바꾸지 않는다
- `reading.html`에 테마 버튼을 새로 만들지 않는다
- **`paper.css` 명시도 원칙:** 덮어쓸 `app-design.css` 규칙의 선택자를 **그대로 복사**해 쓴다. 덮어쓸 대상이 `app-design.css`에 없으면 `:is(body,body.dark) …` 접두사를 쓴다. 그보다 높이는 것(`:root :is(…)` 등)은 금지. 이기지 못하면 올리지 말고 원인 규칙을 찾아 보고한다
- **규칙이 적용됐는지는 브라우저의 computed 값으로 확인한다.** CSS를 읽고 판단하지 않는다
- 터치 타깃 최소 44px, 폼 컨트롤 글자 16px 이상
- 테스트 실행: `MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright`. 이 SMB 볼륨은 `page.goto`가 간헐적으로 실패하므로 **로컬 복사본에서 `MINB_ROOT`로 돌린다**: `SP=$(mktemp -d); git archive HEAD | tar -x -C "$SP"; MINB_ROOT="$SP" node tests/…` (커밋 전 작업 트리를 검사할 때는 `git archive` 대신 `rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP/"`)
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `.omo/`, `test-results/`, `.superpowers/`는 커밋하지 않는다. 푸시·병합하지 않는다 (배포는 컨트롤러가 한다)
- 작업 브랜치: `feat/other-pages-visual` (`main`에서 생성)
- **기준선 재생성 규칙:** 기준 픽스처를 다시 만들기 전에 반드시 실패 메시지의 요소·속성 차이를 읽고, **전부 그 태스크가 의도한 변경인지** 확인한다. 의도하지 않은 차이가 하나라도 있으면 재생성하지 말고 원인을 찾는다

## 현재 사실 (2026-09-30, `main` `20119ce` 기준)

| 페이지 | 인라인 `<style>` | 스타일시트 로드 순서 | 테마 버튼 | 테마 그리기 |
|---|---|---|---|---|
| `index.html` | 없음 | `app.css` → `ui.css` → `schedule-editor.css` → `home-settings.css` → `recurrence.css` → `app-design.css` | `#themeToggle.hbtn.icon-btn` | 인라인 `updateThemeButton()` (SVG) |
| `study.html` | 25~690행 | 인라인 → `ui.css` → `app-design.css` | `#themeToggle.theme-toggle-btn` `🌓 테마 변경` | 인라인 `updateThemeButton()` `🌙 다크 모드` |
| `diary.html` | 24~341행 | 인라인 → `ui.css` → `diary-sync.css` → `app-design.css` | `#themeToggle.hbtn` `🌓 테마` | `js/diary-common.js:42` `🌙 다크` |
| `shared-diary.html` | 24~233행 | 인라인 → `ui.css` → `diary-sync.css` → `app-design.css` | `#themeToggle.hbtn` `🌓 테마` | `js/diary-common.js:42` |
| `reading.html` | 18~71행 | `ui.css` → 인라인 → `app-design.css` | 없음 | 없음 |

- 다섯 페이지 모두 `js/app-shell.js`를 `<head>`에서 `defer`로 로드한다. 각 페이지 `<body>` 끝의 인라인 `loadTheme()`은 **`app-shell.js`보다 먼저** 실행된다
- 페이지 제목 요소: 스터디 `.hero h2`(나의 학습 기록), 일기장 `.streak-banner .big#streakTitle`(오늘의 기록), 교환일기 `.hero h2#heroDate`, 독서 `.reading-hero h1#pageTitle`(읽은 마음)과 로고 `.brand > span`
- `app-design.css` 20행 `:is(body,body.dark) :is(.hero h2,.streak-banner .big)`는 `:is()`가 목록 최댓값을 따르므로 명시도 (0,3,1)이다
- 테스트 하네스의 `fixture(browser, width, mode, {page, now})`(`tests/recurrence.cjs`)는 `page`가 주어지면 그 페이지를 열고 바로 돌려준다. 인증 콜백을 부르지 않으므로 페이지는 **로그인 전 상태**다. 로그인 화면·헤더·정적 본문은 그려지고, 로그인 후에만 채워지는 목록은 비어 있다

## File Structure

**생성**
- `css/paper.css` — 다섯 페이지 공용 마감 규칙. 모든 페이지에서 마지막에 로드
- `tests/page-visual.cjs` — 네 페이지의 computed 스냅샷 비교, 페이지별 행동 테스트, 이모지 스윕
- `tests/fixtures/pages-computed-baseline.json` — 네 페이지 기준 스냅샷 (생성물)

**수정**
- `tests/home-visual.cjs` — 공용 함수를 export하고 러너를 `require.main === module`로 감싼다
- `css/app.css` — 공통 규칙을 `paper.css`로 이관하며 삭제
- `css/ui.css` — `paper.css`와 중복이 되는 카드 hover 규칙 한 줄 삭제
- `js/app-shell.js` — `window.renderThemeToggle` 추가
- `js/diary-common.js` — `updateThemeButton()`이 공용 함수를 부르도록
- `index.html`, `study.html`, `diary.html`, `shared-diary.html`, `reading.html` — `paper.css` 링크, 폰트 요청, 테마 버튼 마크업, 이모지
- `tests/cross-page.cjs` — 카드 그림자 기대값 변경
- `tests/fixtures/home-computed-baseline.json` — stylesheets 항목만 갱신 (computed는 불변이어야 함)

---

### Task 1: 테스트 공용 함수 export

`tests/home-visual.cjs`의 스냅샷·비교·정적 검사 함수를 새 페이지 테스트가 재사용할 수 있게 한다. 함수를 다른 파일로 **옮기지 않는다** — 1,463줄 파일에서 150줄을 잘라 옮기는 것보다, 러너를 감싸고 export하는 쪽이 위험이 훨씬 작다.

**Files:**
- Modify: `tests/home-visual.cjs` (러너 `(async () => {` 부분과 파일 끝)

**Interfaces:**
- Produces: `require('./home-visual.cjs')` → `{ PROPS, snapshotInPage, snapshot, sheetInfo, diffSnapshots, findMessageSinks, DECOR_TEXT, MAX_REPORT }`. `require`만 해서는 브라우저를 띄우지 않고 홈 테스트도 실행하지 않는다

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Volumes/minb/Documents/MINB/Projects/minb-app
git checkout main && git checkout -b feat/other-pages-visual
```

- [ ] **Step 2: 실패하는 확인 스크립트 작성**

`require`가 부작용 없이 함수를 돌려주는지 확인한다. 아직 export가 없으므로 실패해야 한다.

```bash
MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node -e "
const t0=Date.now();
const lib=require('./tests/home-visual.cjs');
const need=['PROPS','snapshotInPage','snapshot','sheetInfo','diffSnapshots','findMessageSinks','DECOR_TEXT','MAX_REPORT'];
const missing=need.filter(k=>!(k in lib));
if(missing.length){console.error('없음:',missing.join(','));process.exit(1)}
console.log('OK', Date.now()-t0,'ms');"
```

Expected: `없음: PROPS,snapshotInPage,…` 로 실패하고, **브라우저가 떠서 홈 테스트가 돌기 시작한다**(지금은 파일이 require 시점에 러너를 실행하므로). 이 두 증상이 이 태스크가 고칠 대상이다.

- [ ] **Step 3: 러너를 감싸고 export 추가**

파일 끝의 러너는 지금 이렇게 시작한다.

```js
(async () => {
  const browser = await chromium.launch();
```

이것을 아래로 바꾼다. 러너 본문(`const browser = …`부터 `} finally { await browser.close(); }`까지)은 **한 글자도 바꾸지 않는다.**

```js
module.exports = { PROPS, snapshotInPage, snapshot, sheetInfo, diffSnapshots, findMessageSinks, DECOR_TEXT, MAX_REPORT };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
```

파일 마지막 줄 `})().catch(e => { console.error(e); process.exitCode = 1; });`는 그대로 둔다. `if (…) (async () => {…})().catch(…)`는 한 문장이라 괄호가 맞는다.

- [ ] **Step 4: 확인 스크립트 통과 확인**

Step 2의 명령을 다시 실행한다.

Expected: `OK <수십> ms`. 브라우저가 뜨지 않아야 하고, 1초 안에 끝나야 한다.

- [ ] **Step 5: 홈 테스트가 그대로인지 확인**

```bash
SP=$(mktemp -d); rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP/"
MINB_ROOT="$SP" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs 2>&1 | tail -1
git status --short tests/fixtures/
```

Expected: `56/56 passed`, 픽스처 변경 없음.

- [ ] **Step 6: 커밋**

```bash
git add tests/home-visual.cjs
git commit -m "test: home-visual 의 스냅샷·정적 검사 함수를 export

require 만으로는 러너가 돌지 않도록 require.main 으로 감싼다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 네 페이지 현재 모습 고정

바꾸기 전에 네 페이지의 현재 모습을 스냅샷으로 고정한다. 홈 작업의 첫 태스크와 같은 **특성화 테스트**다 — 처음부터 통과해야 하고, 이후 태스크는 이 기준에서 무엇이 바뀌는지로 검증된다.

**Files:**
- Create: `tests/page-visual.cjs`
- Create: `tests/fixtures/pages-computed-baseline.json` (생성물)

**Interfaces:**
- Consumes: Task 1의 `require('./home-visual.cjs')`, `tests/recurrence.cjs`의 `fixture(browser, width, mode, {page, now})`
- Produces:
  - `node tests/page-visual.cjs` — 네 페이지 × 375/1280 computed 비교 + 페이지별 stylesheets 비교 + 이후 태스크가 추가하는 행동 테스트
  - 환경변수 `MINB_WRITE_BASELINE=1` — 기준을 새로 쓰고 비교 없이 종료
  - 환경변수 `MINB_WRITE_PAGES=study.html,diary.html` — `MINB_WRITE_BASELINE=1`과 함께 쓰면 **나열한 페이지만** 다시 쓰고 나머지 페이지 기준은 그대로 둔다. 페이지별 태스크가 다른 페이지 기준을 실수로 덮지 않게 하는 장치다
  - `test(name, page, width, run)` — 이후 태스크가 행동 테스트를 등록하는 함수. `run(p, errors)`는 열린 페이지와 페이지 오류 배열을 받는다
  - `PAGES` 배열, `FIXED_NOW`

- [ ] **Step 1: 테스트 파일 작성**

```js
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
const open = (browser, page, width) => fixture(browser, width, 'x', { page, now: FIXED_NOW });
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
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 1) + '\n');
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
```

- [ ] **Step 2: 기준 생성**

```bash
SP=$(mktemp -d); rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP/"
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
ls -la tests/fixtures/pages-computed-baseline.json
```

`MINB_ROOT`는 테스트가 **읽는** 소스만 바꾼다. 기준 파일은 스크립트의 `__dirname` 기준으로 쓰이므로, 저장소에서 `node tests/page-visual.cjs`로 실행하면 저장소 쪽 `tests/fixtures/`에 바로 써진다. 복사본의 픽스처를 저장소로 되복사하지 않는다 — 복사본에 예전 픽스처가 남아 있으면 새 기준을 덮어쓴다.

Expected: 네 페이지 각각 `기준 기록: … (375: N개, 1280: M개 요소)`.

- [ ] **Step 3: 결정성 확인 — 두 번 떠서 같은지**

```bash
cp tests/fixtures/pages-computed-baseline.json /tmp/pv-a.json
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs >/dev/null
cmp /tmp/pv-a.json tests/fixtures/pages-computed-baseline.json && echo "결정적 (정상)"
```

Expected: `결정적 (정상)`. 다르면 시계·애니메이션·폰트 로딩 때문에 흔들리는 요소가 있는 것이다. 어떤 요소인지 `diff`로 찾아 원인을 보고한다(기다리는 시간을 늘리거나 해당 요소의 전환을 끄는 식으로 고친다).

- [ ] **Step 4: 테스트 실행 — 지금 통과해야 한다**

```bash
MINB_ROOT="$SP" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs 2>&1 | tail -1
```

Expected: `12/12 passed` (4페이지 × (computed 2 + stylesheets 1)).

- [ ] **Step 5: 기준이 실제로 무언가를 잡는지 확인**

특성화 테스트가 "이름만 테스트"가 아님을 증명한다(홈 작업 때 첫 기준값이 인라인 CSS를 전혀 보지 못했던 전례가 있다).

```bash
SP2=$(mktemp -d); rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP2/"
python3 - "$SP2" <<'PY'
import sys,re,io
p=sys.argv[1]+'/diary.html'
s=io.open(p,encoding='utf-8').read()
s=re.sub(r'<style>.*?</style>','<style></style>',s,count=1,flags=re.S)   # 일기장 인라인 CSS 전부 삭제
io.open(p,'w',encoding='utf-8').write(s)
PY
MINB_ROOT="$SP2" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs 2>&1 | grep -E "^FAIL|passed"
```

Expected: `diary.html`의 세 테스트가 FAIL, 나머지 9개 PASS. 다른 페이지가 FAIL하면 테스트가 페이지를 섞고 있는 것이다.

- [ ] **Step 6: 커밋**

```bash
git add tests/page-visual.cjs tests/fixtures/pages-computed-baseline.json
git commit -m "test: 네 페이지 현재 모습을 computed 스냅샷으로 고정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 공용 마감 스타일시트 `css/paper.css`

`paper.css`를 만들어 다섯 페이지의 맨 끝에 걸고, 홈의 공통 규칙을 옮기고, 네 페이지의 페이지 제목에 명조체를 준다.

이 태스크에는 **서로 반대인 검증 두 개**가 있다. 홈은 **아무것도 바뀌지 않아야** 하고(규칙이 옮겨가기만 했으므로), 네 페이지는 **제목·로고·카드가 바뀌어야** 한다.

**Files:**
- Create: `css/paper.css`
- Modify: `css/app.css` (아래 네 블록 삭제), `css/ui.css` (22행 한 줄 삭제)
- Modify: `index.html`, `study.html`, `diary.html`, `shared-diary.html`, `reading.html` (`<link>` 추가), 뒤의 네 개는 폰트 링크도
- Modify: `tests/page-visual.cjs`, `tests/cross-page.cjs`
- Modify: `tests/fixtures/home-computed-baseline.json`, `tests/fixtures/pages-computed-baseline.json` (재생성)

**Interfaces:**
- Consumes: Task 2의 `test`, `PAGES`
- Produces: `css/paper.css` — Task 4가 `.icon-btn`을, Task 5~8이 모든 공통 모양을 여기서 받는다

- [ ] **Step 1: 실패하는 행동 테스트 작성**

`tests/page-visual.cjs`의 `for (const page of PAGES) { … }` 반복문 **뒤**, `async function writeBaseline` **앞**에 넣는다.

```js
// ── Task 3: 공용 마감 스타일시트 ──
const TITLES = {
  'study.html': ['.logo-text h1', '.hero h2'],
  'diary.html': ['.logo-text h1', '.streak-banner .big'],
  'shared-diary.html': ['.logo-text h1', '.hero h2'],
  'reading.html': ['.brand > span', '.reading-hero h1'],
};
const cssOf = (p, sel, prop, pseudo = null) => p.evaluate(([s, pr, ps]) => {
  const el = document.querySelector(s);
  if (!el) throw new Error('없는 요소: ' + s);
  return getComputedStyle(el, ps)[pr];
}, [sel, prop, pseudo]);

for (const page of PAGES) {
  for (const w of [375, 1280]) {
    test(`${page} 로고와 페이지 제목은 명조체 400, 자간 0 (${w}px)`, page, w, async p => {
      const serif = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-serif').trim());
      assert.match(serif, /Noto Serif KR/, '--ui-serif 토큰이 비어 있다');
      for (const sel of TITLES[page]) {
        assert.match(await cssOf(p, sel, 'fontFamily'), /Noto Serif KR/, `${sel} 글꼴`);
        assert.equal(await cssOf(p, sel, 'fontWeight'), '400', `${sel} 굵기`);
        assert.ok(['normal', '0px'].includes(await cssOf(p, sel, 'letterSpacing')), `${sel} 자간`);
      }
    });
  }
  test(`${page} 본문과 카드 제목은 고딕 그대로`, page, 1280, async p => {
    assert.equal(/Noto Serif KR/.test(await cssOf(p, 'body', 'fontFamily')), false, 'body');
    const hasCardTitle = await p.evaluate(() => !!document.querySelector('.card-title'));
    if (hasCardTitle) assert.equal(/Noto Serif KR/.test(await cssOf(p, '.card-title', 'fontFamily')), false, '.card-title');
  });
  test(`${page} Noto Serif KR 은 400 한 가지만 요청한다`, page, 1280, async p => {
    const hrefs = await p.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href));
    const font = hrefs.find(h => h.includes('fonts.googleapis.com'));
    assert.ok(font, '폰트 링크 없음');
    assert.match(decodeURIComponent(font), /family=Noto\+Serif\+KR:wght@400(&|$)/);
  });
  test(`${page} paper.css 가 맨 마지막 스타일시트다`, page, 1280, async p => {
    const hrefs = await p.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')));
    assert.equal(hrefs.at(-1), 'css/paper.css', hrefs.join(' | '));
  });
  for (const dark of [false, true]) {
    test(`${page} 카드는 그림자 없이 선으로 (${dark ? '다크' : '라이트'}, 평상시·호버)`, page, 1280, async p => {
      if (dark) await p.evaluate(() => document.body.classList.add('dark'));
      const sel = page === 'reading.html' ? '.reading-card' : '.card';
      const card = p.locator(sel).first();
      // 네 페이지 모두 정적 마크업에 카드가 있다 (study 52, diary 4, shared-diary 8, reading 6). 없으면 테스트가 헛돈 것이다.
      assert.ok(await card.count(), `${sel} 가 없다`);
      await card.scrollIntoViewIfNeeded();
      assert.equal(await card.evaluate(el => getComputedStyle(el).boxShadow), 'none', '평상시');
      assert.equal(await card.evaluate(el => getComputedStyle(el).borderTopWidth), '1px', '선');
      await card.hover({ force: true });
      await p.waitForTimeout(500); // transition 이 끝난 뒤 잰다 (tests/cross-page.cjs 와 같은 방식)
      // force 로 올리면 위에 덮인 요소가 hover 를 가져가 카드는 평상시 값인 채 헛통과할 수 있다. 정말 hover 인지 확인한다.
      assert.equal(await card.evaluate(el => el.matches(':hover')), true, '카드에 :hover 가 걸리지 않았다 (위에 덮인 요소가 있다)');
      assert.equal(await card.evaluate(el => getComputedStyle(el).boxShadow), 'none', '호버');
    });
  }
}
```

파일 맨 위 `require` 줄들 아래에 `const assert = require('node:assert/strict');`를 추가한다.

- [ ] **Step 2: 실패 확인**

```bash
SP=$(mktemp -d); rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP/"
MINB_ROOT="$SP" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs 2>&1 | grep -cE "^FAIL"
```

Expected: 명조체·폰트·paper.css·카드 테스트들이 FAIL. computed/stylesheets 12개는 PASS.

- [ ] **Step 3: `css/paper.css` 작성**

앞의 네 블록은 `css/app.css`에서 **글자 그대로** 옮겨 온 것이다(주석만 새로 씀). 마지막 두 블록이 새로 추가하는 규칙이다.

```css
/* ══════════════════════════════════════════════════════════════
   paper.css — 다섯 페이지 공용 마감 ("조용한 종이 노트")
   모든 페이지에서 맨 마지막(app-design.css 뒤)에 로드한다.

   명시도 원칙: 덮어쓸 app-design.css 규칙의 선택자를 그대로 복사해 쓴다.
   선택자가 같으면 명시도가 같고, 뒤에 로드되므로 이긴다. 그보다 높이지 않는다.
   덮어쓸 대상이 없으면 :is(body,body.dark) 접두사를 쓴다.
   ══════════════════════════════════════════════════════════════ */

/* 헤더 아이콘 버튼 — 글자 없이 아이콘만, 44px 터치 타깃 (app.css 에서 이관) */
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ui-control); height: var(--ui-control); padding: 0;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  background: var(--ui-card); color: var(--ui-text); cursor: pointer;
}
.icon-btn .ui-icon { width: 20px; height: 20px; }

/* 명조체 — 로고와 홈의 날짜·제목 (app.css 에서 이관).
   목록 안의 #homeView 때문에 이 규칙은 (1,2,2)다. 홈 전용 선택자는 다른 페이지에서 매치되지 않는다.
   .logo-text h1 이 목록에 있으므로 스터디·일기장·교환일기의 로고에도 적용된다. */
:is(body, body.dark) :is(.logo-text h1,
#homeView .hero h2,
.today-card .ui-section-head h2,
.calendar-heading > span,
#dmDate) { font-family: var(--ui-serif); font-weight: 400; letter-spacing: 0; }

/* 카드 경계를 그림자에서 선으로 — 평상시와 호버 모두 (app.css 에서 이관) */
:is(body, body.dark) :is(.card, .section-card, .reading-card) { box-shadow: none; border: 1px solid var(--ui-border); }
:is(body, body.dark) :is(.card, .section-card, .reading-card):hover { box-shadow: none; }

/* 섹션 라벨은 낮추고 내용이 먼저 읽히게 (app.css 에서 이관) */
:is(body, body.dark) .ui-eyebrow { font-size: var(--ui-caption); letter-spacing: .14em; color: var(--ui-muted); }

/* 스터디·교환일기의 히어로 제목, 일기장의 연속 기록 제목 — 페이지 단위 제목이므로 명조.
   app-design.css 20행 :is(body,body.dark) :is(.hero h2,.streak-banner .big) 를 그대로 복사했다.
   :is() 는 목록 최댓값을 따라 (0,3,1) 이 되므로, 선택자를 줄이면 진다. */
:is(body,body.dark) :is(.hero h2,.streak-banner .big) { font-family: var(--ui-serif); font-weight: 400; letter-spacing: 0; }

/* 독서 페이지 — 로고 구조가 다르고(.brand > span) 페이지 제목이 h1 이다.
   app-design.css 에 덮어쓸 대상이 없으므로 :is(body,body.dark) 접두사를 쓴다. */
:is(body,body.dark) :is(.brand > span, .reading-hero h1) { font-family: var(--ui-serif); font-weight: 400; letter-spacing: 0; }
```

- [ ] **Step 4: `css/app.css`에서 이관한 블록 삭제**

아래 네 블록을 지운다. **`#homeView .hero h2 { font-size…; color… }` 한 줄은 남긴다** — 홈 전용이고 `paper.css`로 가지 않는다.

```bash
python3 - <<'PY'
import io
p='css/app.css'
s=io.open(p,encoding='utf-8').read()
blocks=[
"""/* 헤더 아이콘 버튼 — 글자 없이 아이콘만, 44px 터치 타깃 */
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ui-control); height: var(--ui-control); padding: 0;
  border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
  background: var(--ui-card); color: var(--ui-text); cursor: pointer;
}
.icon-btn .ui-icon { width: 20px; height: 20px; }
""",
""":is(body, body.dark) :is(.logo-text h1,
#homeView .hero h2,
.today-card .ui-section-head h2,
.calendar-heading > span,
#dmDate) { font-family: var(--ui-serif); font-weight: 400; letter-spacing: 0; }
""",
""":is(body, body.dark) :is(.card, .section-card, .reading-card) { box-shadow: none; border: 1px solid var(--ui-border); }
:is(body, body.dark) :is(.card, .section-card, .reading-card):hover { box-shadow: none; }
""",
""":is(body, body.dark) .ui-eyebrow { font-size: var(--ui-caption); letter-spacing: .14em; color: var(--ui-muted); }
""",
]
for b in blocks:
    assert s.count(b)==1, '블록을 정확히 한 번 찾지 못함:\n'+b[:80]
    s=s.replace(b,'')
io.open(p,'w',encoding='utf-8').write(s)
print('4개 블록 삭제')
PY
grep -n "icon-btn {\|ui-serif\|reading-card) {\|ui-eyebrow {" css/app.css || echo "남은 것 없음 (정상)"
```

블록 위에 붙어 있던 설명 주석(`/* 조용한 종이 노트 — …*/`, `/* 카드 경계를 …*/`, `/* 섹션 제목은 …*/`)은 이제 설명할 규칙이 없으므로 함께 지운다. 단, `#homeView .hero h2` 줄 바로 위의 주석은 남긴다.

- [ ] **Step 5: `css/ui.css`의 중복 hover 규칙 삭제**

22행 `:is(.card,.section-card,.reading-card):hover { box-shadow:var(--ui-shadow); }`는 Task 8b에서 스터디의 무거운 hover 그림자를 누르려고 넣은 것이다. 이제 `paper.css`가 모든 페이지에서 `none`으로 누르므로 중복이다. 지운다.

```bash
python3 - <<'PY'
import io
p='css/ui.css'
s=io.open(p,encoding='utf-8').read()
line=':is(.card,.section-card,.reading-card):hover { box-shadow:var(--ui-shadow); }\n'
assert s.count(line)==1
io.open(p,'w',encoding='utf-8').write(s.replace(line,''))
print('삭제')
PY
```

- [ ] **Step 6: 다섯 페이지에 `paper.css` 링크 추가**

각 페이지에서 `<link rel="stylesheet" href="css/app-design.css">` **바로 다음 줄**에 넣는다.

```html
<link rel="stylesheet" href="css/paper.css">
```

```bash
python3 - <<'PY'
import io
tag='<link rel="stylesheet" href="css/app-design.css">'
for f in ['index.html','study.html','diary.html','shared-diary.html','reading.html']:
    s=io.open(f,encoding='utf-8').read()
    assert s.count(tag)==1, f
    s=s.replace(tag, tag+'\n<link rel="stylesheet" href="css/paper.css">')
    io.open(f,'w',encoding='utf-8').write(s)
    print('링크 추가:',f)
PY
```

- [ ] **Step 7: 네 페이지 폰트 요청에 Noto Serif KR 400 추가**

`index.html`은 이미 요청하므로 건드리지 않는다.

```bash
python3 - <<'PY'
import io,re
for f in ['study.html','diary.html','shared-diary.html','reading.html']:
    s=io.open(f,encoding='utf-8').read()
    m=re.search(r'href="(https://fonts\.googleapis\.com/css2\?family=Noto\+Sans\+KR:[^"&]+)&',s)
    assert m, f
    s=s.replace(m.group(0), m.group(1)+'&family=Noto+Serif+KR:wght@400&',1)
    io.open(f,'w',encoding='utf-8').write(s)
    print('폰트 추가:',f)
PY
grep -h "fonts.googleapis.com/css2" study.html diary.html shared-diary.html reading.html | cut -c1-140
```

Expected: 네 줄 모두 `…Noto+Sans+KR:wght@…&family=Noto+Serif+KR:wght@400&family=Outfit…`.

- [ ] **Step 8: `tests/cross-page.cjs` 기대값 변경**

이 테스트는 "호버 그림자가 평상시의 차분한 그림자와 같다"를 단언한다. 이제 두 경우 모두 그림자가 없으므로 기대값을 바꾼다.

```js
const QUIET = 'rgba(62, 52, 40, 0.04) 0px 2px 8px 0px'; // --ui-shadow
```

를

```js
// 카드는 평상시·호버 모두 그림자 없이 선으로 나뉜다 (css/paper.css)
const QUIET = 'none';
```

로 바꾼다. 파일 머리말 주석의 "그림자가 커지지 않는다" 설명도 "그림자가 생기지 않는다"로 맞춘다.

- [ ] **Step 9: 홈이 바뀌지 않았는지 확인 — 가장 중요한 단계**

```bash
SP=$(mktemp -d); rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP/"
MINB_ROOT="$SP" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs 2>&1 | grep -E "^FAIL|passed"
```

Expected: **computed 두 테스트(375, 1280)는 PASS**, `스타일시트 순서와 규칙 수가 기준과 같다` 하나만 FAIL(새 시트 `paper.css`가 생겼으므로). 그 외 테스트는 전부 PASS.

computed 테스트가 FAIL하면 **멈춘다.** 규칙이 캐스케이드 위치를 옮기면서 무언가를 바꾼 것이다. 가장 의심스러운 곳은 `.icon-btn`이다 — 예전에는 `app.css`(맨 앞)에 있어서 `ui.css`의 `:is(.small-btn,.hbtn,…)`(같은 명시도)에 순서로 졌지만, 이제 `paper.css`(맨 뒤)에서 이긴다. 차이 목록에서 어떤 속성이 바뀌었는지 보고, 그 속성을 `.icon-btn`에서 빼거나 값을 맞춰 홈이 그대로가 되게 한다. **홈 기준의 computed를 재생성해서 통과시키지 않는다.**

- [ ] **Step 10: 홈 기준의 stylesheets 항목만 갱신**

computed가 통과한 것을 확인한 뒤에만 한다.

```bash
cp tests/fixtures/home-computed-baseline.json /tmp/home-before.json
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/home-visual.cjs
python3 - <<'PY'
import json
a=json.load(open('/tmp/home-before.json')); b=json.load(open('tests/fixtures/home-computed-baseline.json'))
assert a['computed']==b['computed'], 'computed 가 바뀌었다 — Step 9 로 돌아갈 것'
print('computed 동일, stylesheets 만 갱신됨 (정상)')
PY
```

`MINB_WRITE_BASELINE=sheets`는 규칙 수나 `cssHash`가 바뀌면 거부하도록 만들어져 있다. 이번엔 규칙이 옮겨가고 새로 추가되므로 둘 다 바뀐다. 그래서 `=1`로 전부 쓰되, 위 스크립트로 **computed가 한 바이트도 안 바뀌었음을 확인**한다.

- [ ] **Step 11: 네 페이지 차이 검토 후 기준 갱신**

```bash
MINB_ROOT="$SP" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs 2>&1 | grep -A 25 "computed style 이 기준과 같다" | head -120
```

차이를 읽는다. 이 태스크가 의도한 변경은 다음뿐이다.
- 로고(`.logo-text h1`, `.brand > span`)와 페이지 제목(`.hero h2`, `.streak-banner .big`, `.reading-hero h1`)의 `fontFamily`·`fontWeight`, 그로 인한 그 요소들의 `width`·`height` 변화와 부모의 크기 변화
- 카드(`.card`, `.reading-card`)의 `boxShadow` → `none`, `border`
- `.ui-eyebrow`(독서 페이지에 있다)의 `fontSize`·`color`
- 로그인 화면 등에 있는 같은 클래스의 요소

그 밖의 차이가 있으면 재생성하지 말고 원인을 찾는다. 모두 의도한 것이면:

```bash
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
```

- [ ] **Step 12: 전체 확인**

```bash
SP=$(mktemp -d); rsync -a --exclude .git --exclude .omo --exclude .superpowers ./ "$SP/"
export MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright
for t in home-visual page-visual cross-page minb-regression; do echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1)"; done
```

Expected: 전부 `N/N passed`. `minb-regression`은 36/36.

- [ ] **Step 13: 커밋**

```bash
git add css/paper.css css/app.css css/ui.css index.html study.html diary.html shared-diary.html reading.html \
  tests/page-visual.cjs tests/cross-page.cjs tests/fixtures/home-computed-baseline.json tests/fixtures/pages-computed-baseline.json
git commit -m "feat: 공용 마감 스타일시트 paper.css 로 다섯 페이지 제목·카드를 맞춤

홈의 공통 규칙을 app.css 에서 옮겼다(홈 computed 는 바이트 단위로 동일).
네 페이지의 로고와 페이지 제목에 명조체, 카드는 그림자 없이 선으로.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 테마 아이콘 공용화

테마 버튼 그리기 코드 세 벌을 `js/app-shell.js` 한 곳으로 모으고, 네 페이지 버튼을 홈과 같은 아이콘 버튼으로 바꾼다.

**실행 순서가 핵심 제약이다.** 각 페이지 `<body>` 끝의 인라인 `loadTheme()` → `updateThemeButton()`은 `defer`로 로드되는 `app-shell.js`보다 **먼저** 실행된다. 그래서:
- `app-shell.js`는 초기화할 때 한 번 아이콘을 그린다 (그 전에 페이지가 뭘 써 놨든 덮는다)
- 페이지의 `updateThemeButton()`은 `window.renderThemeToggle`이 있을 때만 부른다 (첫 로드에는 아직 없으므로 아무것도 안 하고, 이후 사용자가 누를 때는 있다)

**Files:**
- Modify: `js/app-shell.js`
- Modify: `index.html` (`function updateThemeButton()`)
- Modify: `js/diary-common.js` (`function updateThemeButton()`)
- Modify: `study.html` (`function updateThemeButton()`, `#themeToggle` 마크업)
- Modify: `diary.html`, `shared-diary.html` (`#themeToggle` 마크업)
- Modify: `tests/page-visual.cjs`, `tests/fixtures/pages-computed-baseline.json`

**Interfaces:**
- Consumes: Task 3의 `.icon-btn` (`css/paper.css`)
- Produces: `window.renderThemeToggle()` — `#themeToggle`이 있으면 `body.dark`에 맞는 달/해 SVG를 그리고 `aria-label`·`title`을 `테마 바꾸기`로 둔다. 없으면 아무것도 하지 않는다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/page-visual.cjs`의 Task 3 블록 뒤에 넣는다. 홈은 `tests/home-visual.cjs`가 이미 지키므로 여기서는 네 페이지만 본다. 독서 페이지는 버튼이 없어야 한다.

```js
// ── Task 4: 테마 아이콘 공용화 ──
const MOON = 'M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9z';
const themeState = p => p.evaluate(() => {
  const b = document.getElementById('themeToggle');
  if (!b) return null;
  const r = b.getBoundingClientRect(), s = getComputedStyle(b);
  return {
    text: b.textContent.trim(), svgs: b.querySelectorAll('svg').length,
    moon: !!b.querySelector('path[d^="M12 3a6.5"]'), sun: !!b.querySelector('circle[r="4.5"]'),
    label: b.getAttribute('aria-label'), w: r.width, h: r.height,
    bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius,
  };
});
for (const page of ['study.html', 'diary.html', 'shared-diary.html']) {
  test(`${page} 테마 버튼은 글자 없는 44px 아이콘 버튼`, page, 375, async p => {
    const t = await themeState(p);
    assert.ok(t, '#themeToggle 없음');
    assert.equal(t.text, '', `글자가 남아 있다: "${t.text}"`);
    assert.equal(t.svgs, 1);
    assert.equal(t.label, '테마 바꾸기');
    assert.ok(t.w >= 44 && t.h >= 44, `${t.w}x${t.h}`);
  });
  test(`${page} 테마를 바꿔도 아이콘 버튼으로 남고 달↔해가 바뀐다`, page, 375, async p => {
    const before = await themeState(p);
    await p.evaluate(() => toggleTheme());
    const after = await themeState(p);
    assert.equal(after.text, '');
    assert.equal(after.svgs, 1);
    assert.notEqual(before.moon, after.moon, '아이콘이 바뀌지 않았다');
    await p.evaluate(() => toggleTheme());
  });
  test(`${page} 실행 순서와 무관하게 아이콘 — 페이지 코드가 먼저 이모지를 써도 공용 함수가 덮는다`, page, 375, async p => {
    await p.evaluate(() => { document.getElementById('themeToggle').innerHTML = '🌙 다크'; window.renderThemeToggle(); });
    assert.equal((await themeState(p)).text, '');
    await p.evaluate(() => updateThemeButton()); // 공용 함수가 로드된 뒤의 페이지 코드
    assert.equal((await themeState(p)).svgs, 1);
  });
}
test('reading.html 에는 테마 버튼이 없고 공용 함수도 오류 없이 넘어간다', 'reading.html', 375, async (p, errors) => {
  assert.equal(await themeState(p), null);
  await p.evaluate(() => window.renderThemeToggle());
  assert.deepEqual(errors, []);
});
for (const dark of [false, true]) {
  test(`테마 버튼 모양이 네 페이지와 홈에서 같다 (${dark ? '다크' : '라이트'})`, 'study.html', 375, async (p, _e) => {
    // 이 테스트는 study.html 에서 시작해 나머지 페이지를 같은 컨텍스트에서 차례로 연다
    const shapes = {};
    for (const page of ['index.html', 'study.html', 'diary.html', 'shared-diary.html']) {
      await p.goto('https://minb.test/' + page);
      await p.waitForTimeout(400);
      if (dark) await p.evaluate(() => { document.body.classList.add('dark'); window.renderThemeToggle(); });
      const t = await themeState(p);
      shapes[page] = { w: t.w, h: t.h, bg: t.bg, border: t.border, radius: t.radius };
    }
    const ref = JSON.stringify(shapes['index.html']);
    for (const [page, s] of Object.entries(shapes)) assert.equal(JSON.stringify(s), ref, `${page}: ${JSON.stringify(s)} ≠ 홈 ${ref}`);
  });
}
```

`MOON` 상수는 가독성을 위한 것이다(테스트는 `path[d^="M12 3a6.5"]`로 찾는다).

- [ ] **Step 2: 실패 확인**

Expected: 새 테스트들이 FAIL (`글자가 남아 있다: "🌓 테마"` 등, `window.renderThemeToggle is not a function`).

- [ ] **Step 3: `js/app-shell.js`에 공용 함수 추가**

`const icons = {` 블록 **바로 위**, 즉 `(() => {` 다음 줄에 넣는다.

```js
  // 테마 버튼 아이콘 — 다섯 페이지가 이 함수 하나로 그린다.
  // 페이지 끝의 인라인 loadTheme() 은 이 파일(defer)보다 먼저 실행되므로, 여기서 초기화 때 한 번 더 그려 덮는다.
  // 달 = 지금 밝음(누르면 어두워짐), 해 = 지금 어두움(누르면 밝아짐)
  const THEME_SUN = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>';
  const THEME_MOON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';
  window.renderThemeToggle = function renderThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.innerHTML = document.body.classList.contains('dark') ? THEME_SUN : THEME_MOON;
    btn.setAttribute('aria-label', '테마 바꾸기');
    btn.setAttribute('title', '테마 바꾸기');
  };
```

그리고 `init()` 함수 안, `update(); window.addEventListener('hashchange',update);` 줄 **다음**에 한 줄을 넣는다.

```js
    window.renderThemeToggle();
```

- [ ] **Step 4: 세 곳의 `updateThemeButton()`을 공용 함수 호출로**

이름은 그대로 두고 본문만 바꾼다. 세 곳 모두 같은 본문이 된다.

`index.html` (`function updateThemeButton() {`로 시작해 SVG 문자열 두 개와 `setAttribute('aria-label'…)`로 끝나는 블록 전체):

```js
function updateThemeButton() {
  // 아이콘은 js/app-shell.js 가 그린다. 첫 로드에는 아직 없으므로 app-shell 이 초기화 때 그린다.
  if (window.renderThemeToggle) window.renderThemeToggle();
}
```

`js/diary-common.js` 41~43행:

```js
function updateThemeButton() {
  document.getElementById('themeToggle').innerHTML = document.body.classList.contains('dark') ? '☀️ 라이트' : '🌙 다크';
}
```

를

```js
function updateThemeButton() {
  // 아이콘은 js/app-shell.js 가 그린다. 첫 로드에는 아직 없으므로 app-shell 이 초기화 때 그린다.
  if (window.renderThemeToggle) window.renderThemeToggle();
}
```

`study.html` (`function updateThemeButton() {` 블록, `btn.innerHTML = isDark ? '☀️ 라이트 모드' : '🌙 다크 모드';`로 끝나는 것)도 같은 본문으로 바꾼다.

- [ ] **Step 5: 네 페이지 버튼 마크업 — 홈과 같은 클래스로**

`diary.html`, `shared-diary.html`:

```html
      <button id="themeToggle" class="hbtn" onclick="toggleTheme()">🌓 테마</button>
```

→

```html
      <button type="button" id="themeToggle" class="hbtn icon-btn" onclick="toggleTheme()" aria-label="테마 바꾸기" title="테마 바꾸기"></button>
```

`study.html`:

```html
      <button id="themeToggle" class="theme-toggle-btn" onclick="toggleTheme()">🌓 테마 변경</button>
```

→

```html
      <button type="button" id="themeToggle" class="hbtn icon-btn" onclick="toggleTheme()" aria-label="테마 바꾸기" title="테마 바꾸기"></button>
```

스터디는 클래스를 `theme-toggle-btn`에서 **`hbtn icon-btn`으로 바꾼다.** `study.html` 인라인 CSS의 `body.dark .theme-toggle-btn`(0,2,1)이 다크 모드에서 배경을 `rgba(255,255,255,0.08)`로 칠해 홈과 달라지기 때문이다. 바꾸기 전에 `theme-toggle-btn`을 읽는 코드가 있는지 확인한다.

```bash
grep -n "theme-toggle-btn" study.html js/*.js | grep -v "^study.html:[0-9]*:\s*\." 
```

Expected: 마크업 한 줄만 나온다(CSS 규칙은 제외됨). JS가 이 클래스를 쓰면 멈추고 보고한다.

- [ ] **Step 6: 테스트 통과 확인**

Expected: Task 4 테스트 전부 PASS. 특히 "테마 버튼 모양이 네 페이지와 홈에서 같다" 두 개(라이트·다크). 다크에서 실패하면 차이 난 속성을 보고 원인 규칙을 브라우저에서 찾는다.

- [ ] **Step 7: 기준 갱신**

네 페이지 computed 차이를 읽는다. 의도한 변경은 `#themeToggle`과 그 자식 SVG, 그리고 버튼 폭이 바뀐 데 따른 `.header-right`의 폭·배치뿐이다. 확인했으면:

```bash
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_WRITE_PAGES=study.html,diary.html,shared-diary.html MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
```

`reading.html`은 버튼이 없으므로 기준을 다시 쓰지 않는다. 홈 기준은 `home-visual.cjs`를 돌려 확인한다 — 홈 버튼 모양은 바뀌지 않아야 하고, `index.html`의 `updateThemeButton` 본문이 바뀌었을 뿐 CSS는 그대로이므로 `home-visual`은 그대로 통과해야 한다.

- [ ] **Step 8: 전체 확인과 커밋**

```bash
for t in home-visual page-visual cross-page minb-regression; do echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1)"; done
git add js/app-shell.js js/diary-common.js index.html study.html diary.html shared-diary.html tests/page-visual.cjs tests/fixtures/pages-computed-baseline.json
git commit -m "feat: 테마 버튼 아이콘을 app-shell.js 한 곳에서 그림

홈·스터디·일기장·교환일기의 테마 버튼이 같은 44px 아이콘 버튼이 된다.
페이지 스크립트와 app-shell.js(defer)의 실행 순서와 무관하게 아이콘이 남는다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 교환일기 장식 이모지

**Files:**
- Modify: `shared-diary.html`
- Modify: `tests/page-visual.cjs`, `tests/fixtures/pages-computed-baseline.json`

**Interfaces:**
- Consumes: Task 1의 `DECOR_TEXT`
- Produces: `sourceSweep(file, allow)` — Task 6~8이 재사용하는 정적 이모지 검사 (아래 Step 1에서 정의)

- [ ] **Step 1: 정적 이모지 검사 함수와 교환일기 테스트 작성**

로그인 후에만 보이는 문구(빈 상태, 힌트)는 로그인 전 상태의 스냅샷에 나타나지 않는다. 홈 작업에서 이 사각지대를 두 번 겪었으므로, 소스 텍스트를 직접 검사한다.

`tests/page-visual.cjs`의 Task 4 블록 뒤에 넣는다.

```js
// ── 정적 이모지 검사 ── 소스 파일의 모든 줄에서 장식 이모지를 찾는다.
// allow: 그 줄을 통째로 허용하는 정규식 목록(뜻이 있는 이모지가 든 줄). 좁게 쓸 것.
// 허용된 줄 안에서도 허용 패턴이 덮는 부분만 지우고 남은 글자를 다시 검사한다.
const { DECOR_TEXT } = require('./home-visual.cjs');
const ROOT = process.env.MINB_ROOT || path.join(__dirname, '..');
function sourceSweep(file, allow) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    let rest = line;
    for (const re of allow) rest = rest.replace(re, '');
    if (DECOR_TEXT.test(rest)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return hits;
}
// 두 일기 페이지 공통으로 뜻이 있는 이모지
const DIARY_ALLOW = [
  /const MOODS = \[[^\]]*\];/g,                  // 기분 이모지 목록
  /selectedMood = '[^']*'/g,                     // 기분 기본값
  /mood:\s*'[^']*'/g,                            // 기분 기본값 (sharedBaseline 등)
  /\|\| '📝'/g,                                  // 기분을 고르지 않은 일기의 자리표시
  /: '👤'/g,                                     // 사진이 없을 때의 아바타 대체
];
test('shared-diary.html 소스에 장식 이모지가 없다 (정적 검사)', 'shared-diary.html', 375, async () => {
  const hits = [...sourceSweep('shared-diary.html', DIARY_ALLOW), ...sourceSweep('js/diary-common.js', [])];
  assert.deepEqual(hits, []);
});
test('정적 검사기 자체 확인: 뜻 있는 이모지는 통과, 장식은 잡는다', 'shared-diary.html', 375, async () => {
  const tmp = path.join(require('node:os').tmpdir(), `sweep-${process.pid}.html`);
  fs.writeFileSync(tmp, [
    "const MOODS = ['😊','😆'];",                               // 허용
    "const moods = uids.map(u => entries[u].mood || '📝');",   // 허용
    "const img = p.photo ? `<img>` : '👤';",                   // 허용
    "box.innerHTML = '첫 일기를 남겨보세요 💌';",                  // 잡아야 함
    "<span id=\"userName\">👤 로딩중...</span>",                // 잡아야 함 (아바타 대체가 아님)
  ].join('\n'));
  const rel = path.relative(ROOT, tmp);
  const hits = sourceSweep(rel, DIARY_ALLOW);
  fs.unlinkSync(tmp);
  assert.equal(hits.length, 2, hits.join('\n'));
});
```

`sourceSweep`는 `MINB_ROOT` 기준으로 읽는다. 로컬 복사본에서 돌릴 때 복사본을 검사한다.

- [ ] **Step 2: 실패 확인**

Expected: `shared-diary.html 소스에 장식 이모지가 없다` FAIL, 아래 줄들이 목록에 나온다(줄 번호는 Task 3~4 이후 달라져 있을 수 있다).

```
shared-diary.html: <div style="font-size: 60px; margin-bottom: 20px;">💌</div>
shared-diary.html: <a href="./" class="hbtn">🏠 Minb</a>
shared-diary.html: <a href="diary.html" class="hbtn">📔 내 일기장</a>
shared-diary.html: <span id="userName">👤 로딩중...</span>
shared-diary.html: document.getElementById('userName').textContent = `👤 ${user.displayName || '사용자'}`;
shared-diary.html: box.innerHTML = `<div class="empty-msg">${esc(label)}의 일기가 아직 없어요 🕊</div>`;
shared-diary.html: box.innerHTML = '<div class="empty-msg">이 달에는 아직 교환일기가 없어요.<br>첫 일기를 남겨보세요 💌</div>';
```

검사기 자체 확인 테스트는 PASS해야 한다. FAIL하면 검사기가 틀린 것이다.

- [ ] **Step 3: 이모지 제거**

각 줄을 `grep -n`으로 찾아 바꾼다.

| 찾을 조각 | 바꾼 뒤 |
|---|---|
| `<div style="font-size: 60px; margin-bottom: 20px;">💌</div>` | 이 줄 삭제 (로그인 화면의 큰 장식) |
| `<a href="./" class="hbtn">🏠 Minb</a>` | `<a href="./" class="hbtn">Minb</a>` |
| `<a href="diary.html" class="hbtn">📔 내 일기장</a>` | `<a href="diary.html" class="hbtn">내 일기장</a>` |
| `<span id="userName">👤 로딩중...</span>` | `<span id="userName">로딩중...</span>` |
| `` .textContent = `👤 ${user.displayName || '사용자'}`; `` | `` .textContent = `${user.displayName || '사용자'}`; `` |
| `의 일기가 아직 없어요 🕊</div>` | `의 일기가 아직 없어요.</div>` |
| `첫 일기를 남겨보세요 💌</div>` | `첫 일기를 남겨보세요.</div>` |

빈 상태 두 문구는 이모지가 문장 끝의 마침 역할을 하고 있었으므로 마침표를 붙인다.

유지(바꾸지 않음): `MOODS`, `selectedMood = '😊'`, `sharedBaseline = {text:'', mood:'😊'}`, `: '👤'` 아바타 대체 두 곳, `${e.mood || '📝'}`, `entries[u].mood || '📝'`.

- [ ] **Step 4: 테스트 통과 확인**

Expected: 정적 검사 PASS.

- [ ] **Step 5: 기준 갱신**

computed 차이를 읽는다. 로그인 전 상태이므로 **로그인 화면의 💌 장식 div가 사라진 것**과 그에 따른 로그인 카드의 높이 변화, 숨겨진 헤더 링크의 글자 폭 변화만 나와야 한다. 빈 상태 문구는 로그인 후에만 그려지므로 스냅샷에 안 나오는 게 정상이다.

```bash
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_WRITE_PAGES=shared-diary.html MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
```

- [ ] **Step 6: 교환일기 동작 회귀 확인과 커밋**

```bash
for t in page-visual minb-regression diary-storage; do echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1)"; done
git add shared-diary.html tests/page-visual.cjs tests/fixtures/pages-computed-baseline.json
git commit -m "feat: 교환일기 장식 이모지 정리

기분 이모지, 기분 자리표시, 사진 없는 아바타 대체는 유지.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`minb-regression`의 교환일기 항목(초안·동기화·삭제)이 전부 PASS해야 한다.

---

### Task 6: 일기장 장식 이모지

**Files:**
- Modify: `diary.html`
- Modify: `tests/page-visual.cjs`, `tests/fixtures/pages-computed-baseline.json`

**Interfaces:**
- Consumes: Task 5의 `sourceSweep`, `DIARY_ALLOW`

- [ ] **Step 1: 실패하는 테스트 작성**

일기장의 감정 태그는 사용자가 고르는 내용이라 유지한다(사용자 결정). 그 배열 줄만 허용 목록에 더한다.

```js
// 일기장 감정 태그 — 일기를 쓸 때 고르는 내용이므로 유지 (사용자 결정 2026-09-30)
const EMOTION_TAG = /\{ id:'[a-z]+', icon:'[^']+', label:'[^']+' \}/g;
test('diary.html 소스에 장식 이모지가 없다 (정적 검사)', 'diary.html', 375, async () => {
  assert.deepEqual(sourceSweep('diary.html', [...DIARY_ALLOW, EMOTION_TAG]), []);
});
test('diary.html 감정 태그 8개는 이모지를 그대로 가진다', 'diary.html', 375, async () => {
  const src = fs.readFileSync(path.join(ROOT, 'diary.html'), 'utf8');
  const tags = src.match(EMOTION_TAG) || [];
  assert.equal(tags.length, 8, tags.join('\n'));
  for (const t of tags) assert.ok(DECOR_TEXT.test(t), `이모지가 빠졌다: ${t}`);
});
```

- [ ] **Step 2: 실패 확인**

Expected: 정적 검사 FAIL, 아래 줄들이 나온다. 감정 태그 테스트는 PASS.

```
diary.html: <a href="./" class="hbtn">🏠 Minb</a>
diary.html: <a href="shared-diary.html" class="hbtn">💌 교환일기</a>
diary.html: <a href="study.html" class="hbtn">🇪🇸 스터디</a>
diary.html: <span id="userName">👤 로딩중...</span>
diary.html: document.getElementById('userName').textContent = `👤 ${user.displayName || '사용자'}`;
diary.html: hint.textContent = '📝 임시 저장본 복원됨';
diary.html: box.innerHTML = `<div class="empty-msg">"${esc(diarySearchQuery)}"가 들어간 일기가 없어요 🔍</div>`;
diary.html: box.innerHTML = '<div class="empty-msg">이 달에는 아직 일기가 없어요.<br>첫 일기를 써보세요 🌱</div>';
```

- [ ] **Step 3: 이모지 제거**

| 찾을 조각 | 바꾼 뒤 |
|---|---|
| `class="hbtn">🏠 Minb</a>` | `class="hbtn">Minb</a>` |
| `class="hbtn">💌 교환일기</a>` | `class="hbtn">교환일기</a>` |
| `class="hbtn">🇪🇸 스터디</a>` | `class="hbtn">스터디</a>` |
| `<span id="userName">👤 로딩중...</span>` | `<span id="userName">로딩중...</span>` |
| `` .textContent = `👤 ${user.displayName || '사용자'}`; `` | `` .textContent = `${user.displayName || '사용자'}`; `` |
| `'📝 임시 저장본 복원됨'` | `'임시 저장본 복원됨'` |
| `가 들어간 일기가 없어요 🔍</div>` | `가 들어간 일기가 없어요.</div>` |
| `첫 일기를 써보세요 🌱</div>` | `첫 일기를 써보세요.</div>` |

유지: `MOODS`, 감정 태그 8개, `${e.mood || '📝'}`.

`hint.textContent = '임시 저장본 복원됨'`을 기대하는 기존 테스트가 있는지 확인한다.

```bash
grep -n "임시 저장본 복원됨" tests/*.cjs
```

있으면 그 기대값에서도 `📝 `를 뺀다.

- [ ] **Step 4: 테스트 통과, 기준 갱신, 회귀 확인**

computed 차이는 숨겨진 헤더 링크 세 개의 글자 폭 변화뿐이어야 한다.

```bash
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_WRITE_PAGES=diary.html MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
for t in page-visual minb-regression diary-storage; do echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1)"; done
```

Expected: 전부 통과. `minb-regression`의 일기장 초안 복원 테스트(`diary failed save preserves recoverable draft` 등)가 PASS해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add diary.html tests/page-visual.cjs tests/fixtures/pages-computed-baseline.json
git commit -m "feat: 일기장 장식 이모지 정리

기분 이모지와 감정 태그 8개는 일기 내용이므로 유지.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`tests/minb-regression.cjs` 등 기대값을 고쳤다면 함께 `git add`한다.)

---

### Task 7: 스터디 화면 장식 이모지 (헤더·제목·팁·자료·상태)

스터디는 이모지가 가장 많고 학습 내용과 섞여 있다. 두 태스크로 나눈다. 이 태스크는 **화면 장식**을, Task 8은 **이모지가 유일한 신호인 기능 버튼**(발음 듣기 등)을 맡는다.

**Files:**
- Modify: `study.html`
- Modify: `tests/page-visual.cjs`, `tests/fixtures/pages-computed-baseline.json`

**Interfaces:**
- Consumes: Task 5의 `sourceSweep`
- Produces: `STUDY_ALLOW` — Task 8이 이어서 쓴다

- [ ] **Step 1: 학습 내용 허용 목록과 부분 테스트 작성**

스터디의 뜻 있는 표시는 두 가지다.
- `➔` — 문법 설명의 화살표(`-o로 끝나는 명사 ➔ 남성`). 학습 내용이다. 홈의 `DECOR_TEXT`(`\p{Extended_Pictographic}`)는 이 글자를 이모지로 잡으므로 반드시 허용해야 한다
- `✓` — 진도 화면에서 완료한 Día 번호 자리에 들어가는 완료 표시(`${complete?'✓':d.num}`). 번호 대신 이것만 보이므로 유일한 신호다

```js
// 스터디 학습 내용 — 문법 설명의 화살표와 진도의 완료 표시
const STUDY_ALLOW = [
  /➔/g,                          // 문법 설명 화살표 (학습 내용)
  /\$\{complete\?'✓':d\.num\}/g,  // 완료한 Día 번호 자리의 완료 표시 (유일한 신호)
];
// Task 8 이 맡는 기능 버튼만 좁게 뺀다. 🔊 를 통째로 빼면 팁 박스·자료 목록의 🔊(Task 7 몫)까지 가려진다.
const TASK8_LATER = [
  /speak-btn[^>]*>🔊/g,                                           // 발음 듣기 버튼 (정적·템플릿 모두 이 형태)
  />🔊 듣기</g,                                                    // 연습 답 듣기 버튼
  />🔊 자동 발음: ON</g, /'🔊 자동 발음: ON' : '🔇 자동 발음: OFF'/g, // 자동 발음 토글
  /feedbackIcon\.innerHTML = '[✅❌]'/g,                            // 퀴즈 채점
  /🔀 랜덤 방향|🇪🇸 스→한|🇰🇷 한→스/g,                               // 퀴즈 방향
];
test('study.html 화면 장식 이모지가 없다 (Task 7 범위)', 'study.html', 375, async () => {
  assert.deepEqual(sourceSweep('study.html', [...STUDY_ALLOW, ...TASK8_LATER]), []);
});
test('study.html 문법 화살표 ➔ 는 그대로다', 'study.html', 375, async () => {
  const n = (fs.readFileSync(path.join(ROOT, 'study.html'), 'utf8').match(/➔/g) || []).length;
  assert.ok(n >= 10, `➔ 가 ${n}개뿐이다 — 학습 내용이 지워졌다`);
});
```

`➔`의 현재 개수를 먼저 세어 두고, 그 수를 기준으로 `>=` 값을 정한다.

```bash
grep -o "➔" study.html | wc -l
```

위 테스트의 `10`을 이 개수로 바꾼다(정확히 같아야 한다 — `assert.equal`로 바꿔도 좋다).

- [ ] **Step 2: 실패 확인**

Expected: 첫 테스트 FAIL. 목록을 저장해 둔다 — Step 3의 표와 대조한다.

```bash
MINB_ROOT="$SP" MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs 2>&1 | grep -A 80 "화면 장식 이모지가 없다" | head -80 > /tmp/study-hits.txt; wc -l /tmp/study-hits.txt
```

- [ ] **Step 3: 이모지 제거 — 규칙과 목록**

**규칙:** 뜻은 남기고 장식만 뺀다. 이모지가 그 자리의 유일한 신호면 단어나 선 아이콘으로 바꾼다. 판단이 모호하면 **지우지 말고** 보고서에 목록으로 남긴다.

| 찾을 조각 | 바꾼 뒤 | 이유 |
|---|---|---|
| `.hero::after { content: '🇪🇸';` 로 시작하는 CSS 규칙 한 줄 | 줄 삭제 | `app-design.css`가 이미 `content:none`으로 숨기는 장식 |
| `class="nexus-link">🏠 Minb</a>` | `class="nexus-link">Minb</a>` | 숨겨진 중복 링크 |
| `<span id="userName">👤 로딩중...</span>` | `<span id="userName">로딩중...</span>` | |
| `` .textContent = `👤 ${user.displayName || '학습자'}`; `` | `` .textContent = `${user.displayName || '학습자'}`; `` | |
| 헤더의 넥서스 부록 링크 `📚 넥서스 부록` | `넥서스 부록` | 외부 링크 속성(`target="_blank"`)은 유지 |
| `<h3>📌 1. 명사의 성 — Día 02</h3>` 등 `<h3>📌 ` 8곳 | `<h3>1. 명사의 성 — Día 02</h3>` | 번호가 이미 있다 |
| 팁 박스 `<span>🔊</span>`, `<span>🔄</span>`, `<span>📅</span>` (822~825행 부근 3곳, 1986행 부근 1곳) | 선 아이콘 `<svg class="ui-icon" …>` (아래) | 박스 왼쪽 표지가 이것뿐이다 |
| `<span>✅</span>` (835행 부근), `<span>📌</span>` (1230행 부근) | 같은 방식으로 선 아이콘 | 같은 이유 |
| 문법 팁 `💡 ` (963행, 1041행 부근) | 빼고 `<strong>팁</strong> ` | 이미 "꿀팁:"이 있는 곳은 `💡 `만 뺀다 |
| `<strong>⚠️ 대표적인 불규칙 명사:</strong>` | `<strong>주의 — 대표적인 불규칙 명사:</strong>` | 경고 표지를 글자로 |
| `placeholder="🔍 단어 검색..."` | `placeholder="단어 검색"` | |
| 자료 목록 `📹 ` `🔊 ` `🔄 ` `📱 ` `🎬 ` `🗣️ ` `📻 ` (1319~1335행 부근, 목록 머리) | 빼기 | 설명이 이미 있다 |
| `<span>📅 ${WEEK_LABELS[dia.week]…}</span>` | `<span>${WEEK_LABELS[dia.week]…}</span>` | |
| `${complete?'✅ 완료':'📖 학습중'}` (두 곳: 렌더와 갱신) | `${complete?'완료':'학습중'}` | 상태 색(`.dia-status.done/.todo`)은 그대로 |
| 퀴즈 결과 `<div style="font-size: 48px; …">🏆</div>` | 줄 삭제 | |
| `📝 오답노트 — 이번에 틀린 단어` | `오답노트 — 이번에 틀린 단어` | |
| `한 번 더 풀기 🔄` | `한 번 더 풀기` | |
| 칭찬 문구 끝의 ` 👑` ` 🌟` ` 👍` ` 🔥` (2485~2488행 부근) | 빼기 | |
| 빈 상태 `<div class="icon">📚</div>` | `<div class="icon">` 요소째 삭제 | |
| `confirm('⚠️ 정말로 모든 학습 기록을 …')` | `confirm('정말로 모든 학습 기록을 …')` | |
| 2063행 부근 `el.innerHTML = …`에 이모지가 있으면 | 뜻을 보고 같은 규칙으로 | 목록에 없는 것은 보고서에 기록 |

팁 박스와 표지용 선 아이콘 (stroke 기반, `.ui-icon` 규칙을 따른다):

```html
<!-- 🔊 → 스피커 -->
<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>
<!-- 🔄 → 순환 -->
<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/></svg>
<!-- 📅 → 달력 -->
<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>
<!-- ✅ → 체크 원 -->
<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
<!-- 📌 → 핀 -->
<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3ZM12 13v7"/></svg>
```

`.tip-box > span`에 SVG가 들어가면 크기가 달라질 수 있다. 브라우저에서 팁 박스를 열어 아이콘이 글자와 같은 줄 높이로 보이는지 확인하고, 필요하면 `css/paper.css`가 아니라 **`study.html` 인라인 CSS**에 `.tip-box > span .ui-icon { width: 18px; height: 18px; }` 한 줄을 더한다(스터디 전용이므로).

- [ ] **Step 4: 테스트 통과, `➔` 개수 불변 확인**

Expected: 두 테스트 PASS.

- [ ] **Step 5: 기준 갱신**

computed 차이를 읽는다. 스터디는 정적 본문이 많아 로그인 전 상태에서도 문법·팁·자료 화면이 DOM에 있다. 의도한 변경은 위 표의 요소들(제목 글자 폭, 팁 박스 아이콘, 자료 목록 줄, 퀴즈 결과 영역)과 그에 따른 부모 크기 변화뿐이다.

```bash
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_WRITE_PAGES=study.html MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
```

- [ ] **Step 6: 확인과 커밋**

```bash
for t in page-visual cross-page minb-regression; do echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1)"; done
git add study.html tests/page-visual.cjs tests/fixtures/pages-computed-baseline.json
git commit -m "feat: 스터디 화면 장식 이모지 정리

문법 설명의 ➔ 와 진도 완료 표시 ✓ 는 학습 정보이므로 유지.
팁 박스 표지는 선 아이콘으로.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

보고서에 **판단이 모호해 남긴 이모지 목록**을 반드시 적는다.

---

### Task 8: 스터디 기능 버튼 아이콘 (발음 듣기·퀴즈)

이모지가 **유일한 신호**인 기능 버튼들이다. 지우면 기능을 알아볼 수 없으므로 선 아이콘이나 단어로 바꾼다.

**Files:**
- Modify: `study.html`
- Modify: `tests/page-visual.cjs`, `tests/fixtures/pages-computed-baseline.json`

**Interfaces:**
- Consumes: Task 7의 `STUDY_ALLOW`
- Produces: `study.html` 전역 상수 `SPEAK_ICON` (스피커 SVG 문자열) — 템플릿이 쓴다

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('study.html 소스에 장식 이모지가 없다 (정적 검사, 전체)', 'study.html', 375, async () => {
  assert.deepEqual(sourceSweep('study.html', STUDY_ALLOW), []);
});
test('study.html 발음 듣기 버튼은 스피커 아이콘과 이름을 가진다', 'study.html', 375, async p => {
  const btns = await p.evaluate(() => [...document.querySelectorAll('.speak-btn')].map(b => ({
    svg: b.querySelectorAll('svg').length, text: b.textContent.trim(),
    name: b.getAttribute('aria-label') || b.getAttribute('title') || '',
  })));
  assert.ok(btns.length >= 1, '정적 발음 버튼이 없다');
  for (const b of btns) {
    assert.equal(b.svg, 1, JSON.stringify(b));
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(b.text), false, JSON.stringify(b));
    assert.match(b.name, /발음/, JSON.stringify(b));
  }
});
test('study.html 발음 버튼 클릭이 여전히 speakSpanish 를 부른다', 'study.html', 375, async p => {
  await p.evaluate(() => { window.__spoke = []; window.speakSpanish = t => window.__spoke.push(t); });
  const n = await p.locator('.speak-btn').count();
  for (let i = 0; i < n; i++) {
    const b = p.locator('.speak-btn').nth(i);
    if (await b.isVisible()) { await b.click(); break; }
  }
  // 보이는 버튼이 하나도 없는 탭 구성이면 첫 버튼을 직접 누른다
  if (!(await p.evaluate(() => window.__spoke.length))) await p.locator('.speak-btn').first().dispatchEvent('click');
  assert.ok(await p.evaluate(() => window.__spoke.length) >= 1);
});
test('study.html 퀴즈 채점 표시는 글자로 읽힌다', 'study.html', 375, async () => {
  const src = fs.readFileSync(path.join(ROOT, 'study.html'), 'utf8');
  assert.equal(/feedbackIcon\.innerHTML = '[✅❌]'/.test(src), false, '채점 표시에 이모지가 남아 있다');
});
```

- [ ] **Step 2: 실패 확인**

Expected: 전체 정적 검사 FAIL (🔊 🔇 ✅ ❌ 🔀 🇪🇸 🇰🇷 목록), 발음 버튼 테스트 FAIL.

- [ ] **Step 3: 스피커 아이콘 상수 정의**

`study.html`의 `function speakSpanish` 정의 **바로 위**에 넣는다.

```js
// 발음 듣기 버튼 아이콘 — 버튼 뜻이 이것뿐이므로 이모지 대신 선 아이콘. 템플릿과 정적 마크업이 같이 쓴다.
const SPEAK_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
```

- [ ] **Step 4: 발음 버튼 교체**

**정적 마크업**의 `class="speak-btn"` 버튼 안의 `🔊`는 위 SVG를 그대로 붙여 넣는다(정적 HTML은 상수를 못 쓴다). 각 버튼에 `aria-label="발음 듣기"`가 없으면 추가한다. `title`이 있으면 그대로 둔다. 대상: 780행 부근(`pod-es`), 895행 부근(`fc-es`), 1110행 부근(`speakSelectedAlpha`), 1140~1151행 부근의 인사말 표 12줄.

**템플릿 문자열** 안의 `🔊`는 `${SPEAK_ICON}`으로 바꾼다. 대상: 2185행 부근(단어장), 2425행 부근(퀴즈), 2498행 부근(오답노트). 여기에도 `aria-label="발음 듣기"`를 넣는다.

`style="… font-size: 20px …"`처럼 이모지 크기를 맞추던 인라인 스타일은 SVG에 영향이 없으므로 그대로 둔다. 버튼 크기(`width: 44px; height: 44px`)는 유지한다.

- [ ] **Step 5: 나머지 기능 표시 교체**

| 찾을 조각 | 바꾼 뒤 |
|---|---|
| `>🔊 듣기</button>` (802행 부근, 정적 마크업) | `>` + 스피커 SVG(Step 3의 문자열을 그대로 붙여 넣음) + ` 듣기</button>` |
| `>🔊 자동 발음: ON</button>` (913행 부근, 초깃값) | `>자동 발음 켬</button>` |
| `btn.textContent = autoSpeak ? '🔊 자동 발음: ON' : '🔇 자동 발음: OFF';` | `btn.textContent = autoSpeak ? '자동 발음 켬' : '자동 발음 끔';` |
| `>🔀 랜덤 방향</button>` | `>랜덤 방향</button>` |
| `>🇪🇸 스→한</button>` | `>스→한</button>` |
| `>🇰🇷 한→스</button>` | `>한→스</button>` |
| `feedbackIcon.innerHTML = '✅';` | `feedbackIcon.textContent = '정답';` |
| `feedbackIcon.innerHTML = '❌';` | `feedbackIcon.textContent = '오답';` |

채점 표시가 큰 이모지 크기로 스타일돼 있을 수 있다. `feedbackIcon`의 CSS를 확인해, 글자 `정답`/`오답`이 넘치거나 과하게 크면 **`study.html` 인라인 CSS**에서 그 요소의 `font-size`를 `var(--ui-body)` 정도로 낮춘다. 정답·오답 색 구분(초록·빨강)이 있으면 유지한다.

자동 발음 버튼 문구를 기대하는 기존 테스트가 있는지 확인한다.

```bash
grep -n "자동 발음" tests/*.cjs
```

- [ ] **Step 6: 테스트 통과, 기준 갱신, 확인**

computed 차이는 발음 버튼 내부(SVG 추가), 퀴즈 방향 버튼·자동 발음 버튼의 글자 폭뿐이어야 한다.

```bash
MINB_ROOT="$SP" MINB_WRITE_BASELINE=1 MINB_WRITE_PAGES=study.html MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright node tests/page-visual.cjs
for t in page-visual cross-page minb-regression; do echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1)"; done
```

- [ ] **Step 7: 커밋**

```bash
git add study.html tests/page-visual.cjs tests/fixtures/pages-computed-baseline.json
git commit -m "feat: 스터디 발음 듣기·퀴즈 버튼을 선 아이콘과 글자로

발음 버튼은 스피커 선 아이콘과 aria-label, 채점은 정답/오답 글자로.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 폭·테마 확인

배포 전 최종 확인이다. **배포(병합·푸시)는 이 태스크에 포함하지 않는다** — 컨트롤러가 한다.

**Files:**
- Modify: `tests/page-visual.cjs`

- [ ] **Step 1: 가로 넘침 테스트 추가**

```js
for (const page of PAGES) {
  for (const w of [375, 768, 1280]) {
    for (const dark of [false, true]) {
      test(`${page} 가로 넘침 없음 (${w}px ${dark ? '다크' : '라이트'})`, page, w, async p => {
        if (dark) await p.evaluate(() => { document.body.classList.add('dark'); window.renderThemeToggle && window.renderThemeToggle(); });
        await p.waitForTimeout(200);
        const o = await p.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
          out: [...document.querySelectorAll('body *')].filter(el => {
            const s = getComputedStyle(el);
            if (s.position === 'fixed' || s.display === 'none' || s.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > innerWidth + 1;
          }).slice(0, 5).map(el => el.tagName + '.' + el.className),
        }));
        assert.ok(o.doc <= 1 && o.body <= 1, `넘침 doc=${o.doc} body=${o.body}`);
        assert.deepEqual(o.out, []);
      });
    }
  }
}
```

가로 스크롤이 원래 허용된 영역(스터디의 표를 감싼 `.study-table-region`)은 그 **내부** 요소가 뷰포트를 넘을 수 있다. 실패하면 그 요소가 스크롤 영역 안에 있는지 확인하고, 안에 있으면 `out` 필터에서 `el.closest('.study-table-region')`인 것을 제외한다. 스크롤 영역 밖이면 진짜 넘침이다.

- [ ] **Step 2: 넘침 테스트가 실제로 잡는지 확인**

로컬 복사본의 `reading.html` 본문에 `<div style="width:2000px">x</div>`를 넣고 돌려, 독서 페이지 6개 경우가 전부 FAIL하는지 본다. 그다음 복사본을 버린다.

- [ ] **Step 3: 전체 스위트**

```bash
SP=$(mktemp -d); git archive HEAD | tar -x -C "$SP"
export MINB_PLAYWRIGHT=/Volumes/minb/.hermes/hermes-agent/node_modules/playwright
for t in home-visual page-visual cross-page minb-regression recurrence schedule-editor schedule-save monthly-save diary-storage; do
  echo "$t: $(MINB_ROOT="$SP" node tests/$t.cjs 2>&1 | tail -1 | cut -c1-80)"
done
```

Expected: 전부 실패 0. `minb-regression` 36/36. (JSON을 출력하는 스위트는 `"pass":false`가 없어야 한다.)

- [ ] **Step 4: 화면 캡처 (사용자 확인용)**

네 페이지를 375에서 라이트·다크로, 로그인 화면을 숨긴 상태로 찍어 `.superpowers/` 아래(커밋 안 됨)에 둔다. 컨트롤러가 사용자에게 보낸다.

- [ ] **Step 5: 커밋**

```bash
git add tests/page-visual.cjs
git commit -m "test: 네 페이지 폭·테마별 가로 넘침 확인

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 완료 기준

- `tests/page-visual.cjs` 전부 통과, `tests/home-visual.cjs` 56/56 이상, `tests/minb-regression.cjs` 36/36, 나머지 스위트 실패 0
- 홈 computed 스냅샷이 Task 3 전후 바이트 단위로 같음
- 다섯 페이지의 테마 버튼이 라이트·다크 모두 같은 모양의 44px 아이콘 버튼
- 네 페이지 소스에 장식 이모지 없음. `MOODS`·감정 태그·기분 자리표시·아바타 대체·`➔`·`✓`는 유지
- 375/768/1280 × 라이트·다크 가로 넘침 없음
