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
test('study.html 문법 화살표 ➔ 는 그대로다', 'study.html', 375, async () => {
  const n = (fs.readFileSync(path.join(ROOT, 'study.html'), 'utf8').match(/➔/g) || []).length;
  assert.equal(n, 14, `➔ 가 ${n}개다 — 학습 내용이 바뀌었다`);
});

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
