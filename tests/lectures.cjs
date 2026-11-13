// 강의 페이지(lectures.html) 회귀 테스트.
// 실행: MINB_PLAYWRIGHT=<playwright 경로> node tests/lectures.cjs
// 실제 Firebase 에 접속하지 않는다. 메모리(+localStorage) 가짜 Firestore 와 합성 강의 데이터를 쓴다.
// 실제 강의 내용은 공개 저장소에 넣지 않으므로 여기서도 만들어 쓴 가짜 문제만 쓴다.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.MINB_PLAYWRIGHT || 'playwright');
const X = require('../js/lecture-exam.js');
const root = process.env.MINB_ROOT || path.resolve(__dirname, '..');
const SHOTS = process.env.MINB_LECTURE_SHOTS || path.join(require('node:os').tmpdir(), 'minb-lecture-shots');

// ── 합성 강의: 4개 장, 객관식 40, 주관식 12 ──
function makeBank() {
  const mcq = [], subj = [];
  for (let i = 1; i <= 40; i++) mcq.push({ id: `T-M${i}`, ch: (i % 4) + 1, stem: `객관식 ${i}번 문제 <code>x</code>`, options: ['가', '나', '다', '라'].map(o => `${o}${i}`), answer: i % 4, explain: `정답은 ${X.CIRCLE[i % 4]}번이다.` });
  for (let i = 1; i <= 12; i++) subj.push({ id: `T-S${i}`, ch: (i % 4) + 1, stem: `주관식 ${i}번`, model: `모범답안 ${i}`, rubric: [{ text: '핵심 개념', pts: 3 }, { text: '이유 설명', pts: 2.5 }] });
  return { mcq, subj };
}
const STUDY = `<section class="cover"><h1>테스트 강의</h1></section>` +
  [1, 2, 3, 4].map(n => `<div class="unit"><div class="chap-head" id="ch-${n}"><div class="no">${n}</div><div><h2>${n}장 제목</h2></div></div><p style="height:600px">${n}장 본문</p></div>`).join('') +
  `<table><tr><td>☐</td><td>첫 번째 체크</td></tr><tr><td>☐</td><td>두 번째 체크</td></tr></table>`;
const SEED = {
  'users/U/lectureCourses/c1': { title: '테스트 강좌', sub: '테스트 채널', order: 1, css: 'body{font-family:serif}' },
  'users/U/lectures/c1-L1': { courseId: 'c1', no: 1, topic: '테스트', title: '테스트 강의', sub: '부제', chapters: [1, 2, 3, 4].map(n => ({ no: String(n), title: `${n}장 제목` })), selfCheckTotal: 2 },
  'users/U/lectureContent/c1-L1': { studyHtml: STUDY, bank: makeBank() }
};

// 페이지 안에 심는 가짜 Firebase. 저장 내용은 localStorage('__fakefs')에 남아 새로고침해도 유지된다.
function fakeFirebase(seed) {
  const load = () => { try { return JSON.parse(localStorage.getItem('__fakefs')) || null; } catch { return null; } };
  let store = load() || seed;
  const save = () => localStorage.setItem('__fakefs', JSON.stringify(store));
  save();
  const DEL = { __op: 'delete' };
  const merge = (base, patch) => {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v && v.__op === 'delete') delete out[k];
      else if (v && v.__op === 'inc') out[k] = (out[k] || 0) + v.n;
      else if (v && typeof v === 'object' && !Array.isArray(v) && !v.__op) out[k] = merge(out[k], v);
      else out[k] = v;
    }
    return out;
  };
  window.QA = { fail: false, writes: [], store: () => store };
  const doc = p => ({
    id: p.split('/').pop(),
    collection: n => col(`${p}/${n}`),
    get: async () => ({ exists: p in store, data: () => JSON.parse(JSON.stringify(store[p])) }),
    set: async (data, opt) => {
      if (window.QA.fail) throw new Error('test write failure');
      window.QA.writes.push({ path: p, data });
      store[p] = opt?.merge ? merge(store[p], data) : merge({}, data); save();
    }
  });
  const col = p => ({
    doc: id => doc(`${p}/${id}`),
    get: async () => ({ docs: Object.keys(store).filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(k => ({ id: k.split('/').pop(), data: () => JSON.parse(JSON.stringify(store[k])) })) })
  });
  const user = { uid: 'U', displayName: '테스트' };
  const auth = { onAuthStateChanged: cb => setTimeout(() => cb(user), 0), getRedirectResult: async () => null };
  const db = { collection: n => col(n) };
  window.firebase = {
    initializeApp() {}, auth: Object.assign(() => auth, { GoogleAuthProvider: function () {} }),
    firestore: Object.assign(() => db, { FieldValue: { delete: () => DEL, increment: n => ({ __op: 'inc', n }), serverTimestamp: () => Date.now() } })
  };
}

async function open(browser, width = 1280, hash = '#/') {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Seoul' });
  await context.addInitScript(fakeFirebase, SEED);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'minb.test') return route.fulfill({ body: '', contentType: 'application/javascript' });
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto('https://minb.test/lectures.html' + hash);
  return { page, context, errors };
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// ── 순수 함수 ──
test('장별 할당량은 합이 정확하고 문항 수를 넘지 않는다', async () => {
  const bank = makeBank();
  const q = X.chapterQuotas(bank.mcq, 20);
  assert.equal([...q.values()].reduce((a, b) => a + b, 0), 20);
  [...q.values()].forEach(v => assert.ok(v >= 4 && v <= 6));
});
test('덜 본 문제부터 뽑는다', async () => {
  const bank = makeBank();
  const first = X.draw(bank.mcq, 20, {});
  const seen = Object.fromEntries(first.map(q => [q.id, 1]));
  const second = X.draw(bank.mcq, 20, seen);
  assert.equal(second.filter(q => seen[q.id]).length, 0);
});
test('해설의 보기 번호를 섞인 순서로 바꾼다', async () => {
  assert.equal(X.remapCircles('③ 오답, ① 정답', [2, 0, 3, 1]), '① 오답, ② 정답');
});
test('점수: 객관식 2점, 주관식은 60점으로 환산', async () => {
  const bank = makeBank(), idx = Object.fromEntries([...bank.mcq, ...bank.subj].map(q => [q.id, q]));
  const sheet = X.newSheet(bank, {});
  sheet.mcq.slice(0, 10).forEach(m => { sheet.answers[m.id] = idx[m.id].answer; });
  sheet.subj.forEach(id => { sheet.checks[id] = [0]; });
  const s = X.score(sheet, idx);
  assert.equal(s.mcqScore, 20);
  assert.equal(s.subjScore, Math.round((3 / 5.5) * 60));
  assert.equal(s.wrong.length, 10);
});

// ── 화면 ──
test('목록 → 시험: 새 시험지는 객관식 20·주관식 8, 장 순서', async b => {
  const { page, context, errors } = await open(b);
  try {
    await page.getByText('테스트 강좌').waitFor();
    await page.screenshot({ path: path.join(SHOTS, 'list-1280.png'), fullPage: true });
    await page.locator('.lecture-item a', { hasText: '시험' }).click();
    await page.getByRole('button', { name: '새 시험지 뽑기' }).first().click();
    assert.equal(await page.locator('#examView .question:has(.options)').count(), 20);
    assert.equal(await page.locator('#examView textarea').count(), 8);
    const sheet = await page.evaluate(() => exam.sheet);
    const chs = sheet.mcq.map(m => Number(m.id.slice(3)) % 4 + 1);
    assert.deepEqual(chs, [...chs].sort((a, b) => a - b));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('푸는 중 새로고침해도 답이 남는다', async b => {
  const { page, context, errors } = await open(b, 1280, '#/c1-L1/exam');
  try {
    await page.getByRole('button', { name: '새 시험지 뽑기' }).click();
    await page.locator('.option').nth(1).click();
    await page.locator('textarea').first().fill('내 답안');
    await page.reload();
    await page.locator('textarea').first().waitFor();
    assert.equal(await page.locator('textarea').first().inputValue(), '내 답안');
    assert.equal(await page.locator('.option input:checked').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('정답 보기 → 채점표 체크 → 기록 저장, 다음 시험지는 안 본 문제', async b => {
  const { page, context, errors } = await open(b, 1280, '#/c1-L1/exam');
  try {
    await page.getByRole('button', { name: '새 시험지 뽑기' }).click();
    const first = await page.evaluate(() => exam.sheet.mcq.map(m => m.id));
    // 첫 문제는 정답, 둘째는 오답을 고른다
    const pick = await page.evaluate(() => { const m = exam.sheet.mcq; const idx = exam.content.bankIndex; return [m[0].order.indexOf(idx[m[0].id].answer), m[1].order.indexOf((idx[m[1].id].answer + 1) % 4)]; });
    await page.locator('.question').nth(0).locator('.option').nth(pick[0]).click();
    await page.locator('.question').nth(1).locator('.option').nth(pick[1]).click();
    await page.getByRole('button', { name: '정답 보기' }).click();
    assert.equal(await page.locator('.question.right').count(), 1);
    assert.equal(await page.locator('.option.is-answer').count(), 20);
    assert.match(await page.locator('.explain').first().textContent(), /복습: \d장/);
    // 해설 속 원래 번호가 화면 번호로 바뀌었는지: "정답 ○" 과 해설 문장의 번호가 같아야 한다
    const ex = await page.locator('.explain').first().textContent();
    assert.equal(ex.match(/정답 ([①②③④])/)[1], ex.match(/정답은 ([①②③④])번/)[1]);
    await page.locator('.rubric').first().locator('input').first().check();
    await page.screenshot({ path: path.join(SHOTS, 'graded-1280.png'), fullPage: false });
    await page.getByRole('button', { name: '채점 완료 · 기록 저장' }).click();
    await page.locator('.result-card').waitFor();
    const store = await page.evaluate(() => QA.store());
    const att = Object.entries(store).filter(([k]) => k.startsWith('users/U/lectureAttempts/'));
    assert.equal(att.length, 1);
    assert.equal(att[0][1].mcqScore, 2);
    assert.equal(att[0][1].subjScore, Math.round(3 / 44 * 60));
    assert.equal(store['users/U/lectureState/c1-L1'].current, undefined);
    assert.equal(Object.keys(store['users/U/lectureState/c1-L1'].seen).length, 28);
    await page.getByRole('button', { name: '새 시험지 뽑기' }).click();
    const second = await page.evaluate(() => exam.sheet.mcq.map(m => m.id));
    assert.equal(second.filter(id => first.includes(id)).length, 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('저장 실패 시 시험지를 지우지 않고 다시 누를 수 있다', async b => {
  const { page, context, errors } = await open(b, 1280, '#/c1-L1/exam');
  try {
    await page.getByRole('button', { name: '새 시험지 뽑기' }).click();
    await page.getByRole('button', { name: '정답 보기' }).click();
    await page.evaluate(() => { QA.fail = true; });
    await page.getByRole('button', { name: '채점 완료 · 기록 저장' }).click();
    await page.getByRole('button', { name: '채점 완료 · 기록 저장' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '채점 완료 · 기록 저장' }).isEnabled(), true);
    assert.ok(await page.evaluate(() => !!exam.sheet));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('교육자료: 목차, 셀프 체크 저장, 복습 링크로 장 이동', async b => {
  const { page, context, errors } = await open(b, 1280, '#/c1-L1/study');
  try {
    const frame = page.frameLocator('#studyFrame');
    await frame.locator('.selfcheck-box').first().check();
    await page.waitForTimeout(100);
    const store = await page.evaluate(() => QA.store());
    assert.equal(store['users/U/lectureState/c1-L1'].selfCheck['0'], true);
    await page.locator('#toc button', { hasText: '3장 제목' }).click();
    await page.waitForTimeout(600);
    assert.ok(await page.evaluate(() => window.scrollY) > 600);
    await page.screenshot({ path: path.join(SHOTS, 'study-1280.png') });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
for (const w of [375, 768]) test(`좁은 화면 ${w}px: 가로 넘침 없음, 목차는 선택 상자`, async b => {
  const { page, context, errors } = await open(b, w, '#/c1-L1/exam');
  try {
    await page.getByRole('button', { name: '새 시험지 뽑기' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(SHOTS, `exam-${w}.png`) });
    await page.goto('https://minb.test/lectures.html#/c1-L1/study');
    await page.locator('#tocSelect').waitFor();
    assert.equal(await page.locator('#toc').isVisible(), false);
    assert.equal(await page.locator('#tocSelect').isVisible(), true);
    await page.screenshot({ path: path.join(SHOTS, `study-${w}.png`) });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

if (require.main === module) (async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const t of cases) {
      try { await t.fn(browser); results.push({ name: t.name, pass: true }); console.log('PASS ' + t.name); }
      catch (e) { results.push({ name: t.name, pass: false }); console.log('FAIL ' + t.name + ' — ' + e.message.split('\n')[0]); }
    }
  } finally { await browser.close(); }
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed · 화면 캡처: ${SHOTS}`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})();
