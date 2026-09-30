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
const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');
const { snapshot, sheetInfo, diffSnapshots, MAX_REPORT, DECOR_TEXT } = require('./home-visual.cjs');

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
  if (typeof PHRASES === 'undefined') throw new Error('pinRandom: PHRASES 가 없다 — study.html 의 이름이 바뀌었나?');
  for (const id of ['pod-es', 'pod-ko', 'pod-pron']) if (!document.getElementById(id)) throw new Error('pinRandom: #' + id + ' 가 없다');
  phraseIdx = 0;
  document.getElementById('pod-es').textContent = PHRASES[0].es;
  document.getElementById('pod-ko').textContent = PHRASES[0].ko;
  document.getElementById('pod-pron').textContent = PHRASES[0].pron;
});
const open = async (browser, page, width) => {
  const f = await fixture(browser, width, 'x', { page, now: FIXED_NOW });
  if (page === 'study.html') await pinRandom(f.page); // 다른 페이지에는 오늘의 표현이 없다
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

// ── Task 4: 테마 아이콘 공용화 ──
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
      if (dark) {
        await p.evaluate(() => { document.body.classList.add('dark'); window.renderThemeToggle(); });
        await p.waitForTimeout(700); // 버튼의 색 transition(0.22~0.3s)이 끝난 뒤 잰다. 페이지마다 --transition 이 달라 바로 재면 중간값이 나온다
      }
      const t = await themeState(p);
      shapes[page] = { w: t.w, h: t.h, bg: t.bg, border: t.border, radius: t.radius };
    }
    const ref = JSON.stringify(shapes['index.html']);
    for (const [page, s] of Object.entries(shapes)) assert.equal(JSON.stringify(s), ref, `${page}: ${JSON.stringify(s)} ≠ 홈 ${ref}`);
  });
}

// ── 정적 이모지 검사 ── 소스 파일의 모든 줄에서 장식 이모지를 찾는다.
// 로그인 후에만 보이는 문구(빈 상태, 힌트)는 로그인 전 스냅샷에 나타나지 않으므로 소스 텍스트를 직접 본다.
// allow: 뜻이 있는 이모지가 든 부분을 지우는 정규식 목록. 좁게 쓸 것.
// 허용 패턴이 덮는 부분만 지우고 남은 글자를 다시 검사한다.
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
  /selectedMood = '\p{Extended_Pictographic}\uFE0F?'/gu,   // 기분 기본값 (이모지 딱 하나)
  /mood:\s*'\p{Extended_Pictographic}\uFE0F?'/gu,          // 기분 기본값 (sharedBaseline 등)
  /\.mood \|\| '📝'/g,                                     // 기분을 고르지 않은 일기의 자리표시
  /\.photo \? `[^`]*` : '👤'/g,                             // 사진이 없을 때의 아바타 대체 (photo 삼항 안에서만)
];
test('shared-diary.html 소스에 장식 이모지가 없다 (정적 검사)', 'shared-diary.html', 375, async () => {
  const hits = [...sourceSweep('shared-diary.html', DIARY_ALLOW),
    ...['js/app-shell.js', 'js/diary-common.js', 'js/diary-months.js', 'js/diary-storage.js'].flatMap(f => sourceSweep(f, []))];
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
    "x={mood:'🎉 축하 🏠'}",                                    // 잡아야 함 (이모지 둘 이상)
    "selectedMood = '🎉 축하'",                                 // 잡아야 함
    "t = ok ? 1 : '👤'",                                        // 잡아야 함 (photo 삼항이 아님)
    "a={icon: '👤'}",                                           // 잡아야 함
    "let selectedMood = '😊';",                                 // 허용
    "const e = {mood: '❤️'};",                                  // 허용 (변형 선택자)
  ].join('\n'));
  const rel = path.relative(ROOT, tmp);
  const hits = sourceSweep(rel, DIARY_ALLOW);
  fs.unlinkSync(tmp);
  assert.equal(hits.length, 6, hits.join('\n'));
});

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

// 스터디 학습 내용 — 문법 설명의 화살표와 진도의 완료 표시
const STUDY_ALLOW = [
  /➔/g,                          // 문법 설명 화살표 (학습 내용)
  /\$\{complete\?'✓':d\.num\}/g,  // 완료한 Día 번호 자리의 완료 표시 (유일한 신호)
];
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
test('study.html 달 이동 버튼은 ‹ › 와 이름을 가진다', 'study.html', 375, async p => {
  const r = await p.evaluate(() => ['prevMonth', 'nextMonth'].map(f => {
    const b = document.querySelector(`button[onclick="${f}()"]`);
    return b && { t: b.textContent.trim(), n: b.getAttribute('aria-label') };
  }));
  assert.deepEqual(r, [{ t: '‹', n: '이전 달' }, { t: '›', n: '다음 달' }]);
});
// 실제로 눌리는 영역을 검사한다. 상자 크기만 재면 음수 마진으로 이웃 버튼 위를 덮어도 모르므로,
// 각 컨트롤의 보이는 영역을 격자로 찍어 elementFromPoint 가 이웃 컨트롤을 가리키면 실패시킨다.
const INTERACTIVE = 'button,a[href],input,select,textarea,summary,[role="button"]';
// 런타임에 그려지는 화면(단어장 목록·퀴즈 문제·오답노트)을 먼저 그린 뒤 탭마다 훑는다.
const renderStudyRuntime = p => p.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  showTab('vocab');
  renderVocabList(getMergedVocab().slice(0, 6).concat([{ es: 'prueba', ko: '시험', pron: '', dia: 1, isCustom: true }]));
  window.speakSpanish = () => {};
});
const hitTestTab = (p, tab) => p.evaluate(({ tab, sel }) => {
  showTab(tab);
  const bad = [];
  const els = [...document.querySelectorAll(sel)].filter(e => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[style*="display: none"], [style*="display:none"]');
  });
  for (const el of els) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x0 = Math.max(r.left, 0) + 1, x1 = Math.min(r.right, innerWidth) - 1;
    const y0 = Math.max(r.top, 0) + 1, y1 = Math.min(r.bottom, innerHeight) - 1;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const x = x0 + (x1 - x0) * i / 5, y = y0 + (y1 - y0) * j / 5;
      const top = document.elementFromPoint(x, y);
      const owner = top && top.closest(sel);
      if (owner && owner !== el && (owner.contains(el) === false)) {
        bad.push(`${(el.id || el.className || el.tagName)}[${el.getAttribute('onclick') || el.type || ''}] (${x.toFixed(0)},${y.toFixed(0)}) -> ${owner.id || owner.className || owner.tagName}[${owner.getAttribute('onclick') || owner.type || ''}]`);
        break;
      }
    }
  }
  return { count: els.length, bad };
}, { tab, sel: INTERACTIVE });
for (const w of [320, 375, 1280]) {
  test(`study.html 컨트롤을 눌러도 이웃 컨트롤이 대신 눌리지 않는다 (${w}px)`, 'study.html', w, async p => {
    await renderStudyRuntime(p);
    const all = [];
    for (const tab of ['home', 'plan', 'vocab', 'grammar', 'alphabet']) all.push(...(await hitTestTab(p, tab)).bad.map(b => `${tab}: ${b}`));
    // 퀴즈: 문제 화면(스→한, 한→스 둘 다), 채점 뒤, 결과·오답노트
    for (const dir of ['es', 'ko']) {
      await p.evaluate(dir => { setQuizDir(dir, document.getElementById('qdir-' + dir)); startQuiz(); }, dir);
      const r = await hitTestTab(p, 'quiz'); assert.ok(r.count >= 4, '퀴즈 컨트롤이 그려지지 않았다');
      all.push(...r.bad.map(b => `quiz-${dir}: ${b}`));
    }
    await p.evaluate(() => { selectQuizOption((quizQuestions[quizIdx].correctIdx + 1) % 4); showQuizResult(); });
    all.push(...(await hitTestTab(p, 'quiz')).bad.map(b => `quiz-result: ${b}`));
    all.push(...(await hitTestTab(p, 'progress')).bad.map(b => `progress: ${b}`), ...(await hitTestTab(p, 'nexus')).bad.map(b => `nexus: ${b}`));
    assert.deepEqual(all, []);
  });
}
test('study.html 기능 버튼은 누르는 영역이 44×44 이상이다', 'study.html', 375, async p => {
  await renderStudyRuntime(p);
  const measure = (tab, sel) => p.evaluate(({ tab, sel }) => {
    showTab(tab);
    return [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return { sel, w: r.width, h: r.height }; }).filter(x => x.w > 0);
  }, { tab, sel });
  const groups = [
    ['home', '.speak-btn'], ['home', '.practice-actions .filter-btn'],
    ['vocab', '.speak-btn'], ['vocab', 'button[onclick^="deleteCustomWord"]'], ['vocab', '#autoSpeakBtn'],
    ['alphabet', '.speak-btn'],
    ['progress', 'button[onclick="prevMonth()"]'], ['progress', 'button[onclick="nextMonth()"]'],
  ];
  const small = [];
  for (const [tab, sel] of groups) {
    const m = await measure(tab, sel);
    assert.ok(m.length >= 1, `${tab} ${sel} 를 찾지 못했다`);
    small.push(...m.filter(x => x.w < 43.99 || x.h < 43.99).map(x => `${tab} ${x.sel} ${x.w.toFixed(1)}×${x.h.toFixed(1)}`));
  }
  for (const dir of ['mix', 'es', 'ko']) {
    const m = await measure('quiz', '#qdir-' + dir); assert.equal(m.length, 1);
    small.push(...m.filter(x => x.w < 43.99 || x.h < 43.99).map(x => `quiz ${x.sel} ${x.w.toFixed(1)}×${x.h.toFixed(1)}`));
  }
  await p.evaluate(() => { setQuizDir('es', document.getElementById('qdir-es')); startQuiz(); });
  const q = await measure('quiz', '.speak-btn'); assert.ok(q.length >= 1, '퀴즈 발음 버튼이 없다');
  small.push(...q.filter(x => x.w < 43.99 || x.h < 43.99).map(x => `quiz ${x.sel} ${x.w.toFixed(1)}×${x.h.toFixed(1)}`));
  await p.evaluate(() => { selectQuizOption((quizQuestions[quizIdx].correctIdx + 1) % 4); showQuizResult(); });
  const wn = await measure('quiz', '#quiz-wrong-list .speak-btn'); assert.ok(wn.length >= 1, '오답노트 발음 버튼이 없다');
  small.push(...wn.filter(x => x.w < 43.99 || x.h < 43.99).map(x => `wrong ${x.sel} ${x.w.toFixed(1)}×${x.h.toFixed(1)}`));
  assert.deepEqual(small, []);
});
test('study.html 문법 화살표 ➔ 는 그대로다', 'study.html', 375, async () => {
  const n = (fs.readFileSync(path.join(ROOT, 'study.html'), 'utf8').match(/➔/g) || []).length;
  assert.equal(n, 14, `➔ 가 ${n}개다 — 학습 내용이 바뀌었다`);
});

// ── 발음 버튼 대비 ── 아이콘은 currentColor 로 그려지므로 버튼 색이 바탕과 3:1 이상 떨어져야 보인다.
// 원은 ::before 의 --speak-bg 이고 반투명일 수 있어, 가장 가까운 불투명 조상 바탕 위에 겹쳐 계산한다.
const SPEAK_CONTEXTS = [
  { name: '오늘의 표현(홈)', tab: 'home', sel: '#tab-home .speak-btn' },
  { name: '플래시카드 앞', tab: 'vocab', sel: '.flashcard-front .speak-btn' },
  { name: '플래시카드 뒤', tab: 'vocab', sel: '.flashcard-back .speak-btn', optional: true }, // 뒷면에는 발음 버튼이 없다. 생기면 검사한다
  { name: '단어장 표', tab: 'vocab', sel: '#vocab-body .speak-btn' },
  { name: '발음 탭 표', tab: 'alphabet', sel: '#tab-alphabet .vocab-table .speak-btn' },
  { name: '알파벳 상세', tab: 'alphabet', sel: 'button[onclick="speakSelectedAlpha()"]' },
  { name: '퀴즈 문제', tab: 'quiz', sel: '#tab-quiz .speak-btn', before: 'quiz' },
  { name: '퀴즈 오답노트', tab: 'quiz', sel: '#quiz-wrong-list .speak-btn', before: 'result' },
];
const measureSpeak = (p, ctx) => p.evaluate(({ ctx }) => {
  const parse = c => { const sr = c.match(/^color\(srgb ([^)]+)\)/); if (sr) { const v = sr[1].split(/[ \/]+/).filter(Boolean).map(Number); return { r: v[0] * 255, g: v[1] * 255, b: v[2] * 255, a: v[3] === undefined ? 1 : v[3] }; } const m = c.match(/rgba?\(([^)]+)\)/); if (!m) throw new Error('색을 읽지 못했다: ' + c); const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] === undefined ? 1 : v[3] }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  showTab(ctx.tab);
  if (ctx.before === 'quiz') { setQuizDir('es', document.getElementById('qdir-es')); startQuiz(); }
  if (ctx.before === 'result') { setQuizDir('es', document.getElementById('qdir-es')); startQuiz(); selectQuizOption((quizQuestions[quizIdx].correctIdx + 1) % 4); showQuizResult(); }
  const out = [];
  for (const btn of document.querySelectorAll(ctx.sel)) {
    const svg = btn.querySelector('svg');
    const fg = parse(getComputedStyle(svg).stroke);
    // 아래에서 위로 쌓을 바탕 층: 버튼 원(::before) → 버튼 자신 → 조상들, 불투명한 층을 만나면 멈춘다
    const layers = [parse(getComputedStyle(btn, '::before').backgroundColor)];
    for (let el = btn; el && layers.at(-1).a < 1; el = el.parentElement) {
      layers.push(parse(getComputedStyle(el).backgroundColor));
    }
    if (layers.at(-1).a < 1) layers.push({ r: 255, g: 255, b: 255, a: 1 });
    let bg = layers.at(-1);
    for (let i = layers.length - 2; i >= 0; i--) bg = over(layers[i], bg);
    out.push({ ratio: ratio(fg, bg), fg: `${fg.r},${fg.g},${fg.b}`, bg: `${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}` });
  }
  return out;
}, { ctx });
for (const dark of [false, true]) {
  test(`study.html 발음 버튼 아이콘은 바탕과 3:1 이상 (${dark ? '다크' : '라이트'}, 모든 자리)`, 'study.html', 375, async p => {
    await renderStudyRuntime(p);
    if (dark) await p.evaluate(() => document.body.classList.add('dark'));
    await p.waitForTimeout(800); // 원 배경색 transition 이 끝난 뒤 잰다
    const bad = [], lines = [];
    for (const ctx of SPEAK_CONTEXTS) {
      const m = await measureSpeak(p, ctx);
      if (!m.length) { if (!ctx.optional) bad.push(`${ctx.name}: 버튼을 찾지 못했다`); continue; }
      const low = Math.min(...m.map(x => x.ratio));
      lines.push(`${ctx.name} ${low.toFixed(2)}`);
      if (process.env.MINB_SPEAK_LOG) console.log(`  [${dark ? 'dark' : 'light'}] ${ctx.name} n=${m.length} min=${low.toFixed(2)} ${m[0].fg} on ${m[0].bg}`);
      if (low < 3) bad.push(`${ctx.name}: ${low.toFixed(2)}:1 (${m.find(x => x.ratio === low).fg} on ${m.find(x => x.ratio === low).bg})`);
    }
    assert.deepEqual(bad, []);
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
  fs.writeFileSync(BASELINE_FILE, serialize(out));
}

// 가로 넘침 없음 — 세 폭 × 두 테마. .study-table-region 은 가로 스크롤이 허용된 영역이라 그 내부 요소는 제외.
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
            if (el.closest('.study-table-region')) return false;
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

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  try {
    if (WRITE) { await writeBaseline(browser); return; }
    const results = [];
    for (const c of cases) {
      const { page, context, errors } = await open(browser, c.page, c.width);
      try {
        await c.run(page, errors);
        assert.deepEqual(errors, [], '페이지 오류');
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
