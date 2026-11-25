// UI/UX 개선 항목 동작 검증 (모바일 토스트 겹침, 에디터 우선 배치, 다크모드·theme-color 동기화,
// 모달 Escape/스크롤잠금, 공유 계정 인라인 편집, 스터디 탭 해시·퀴즈 단축키·시맨틱 버튼)
const assert = require('node:assert/strict');
const { fixture, chromium } = require('./recurrence.cjs');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('모바일(375px) 5개 페이지에서 토스트가 하단 내비게이션 바 위로 배치된다', async (browser) => {
  for (const page of ['index.html', 'study.html', 'reading.html', 'diary.html', 'shared-diary.html']) {
    const { page: p, context, errors } = await fixture(browser, 375, 'toast-' + page, { page });
    try {
      await p.evaluate(() => {
        const el = document.getElementById('toast');
        el.textContent = '테스트 안내';
        el.classList.add('show');
      });
      await p.waitForTimeout(260);
      const r = await p.evaluate(() => {
        const nav = document.querySelector('.app-nav').getBoundingClientRect();
        const toast = document.getElementById('toast').getBoundingClientRect();
        return { navTop: nav.top, toastBottom: toast.bottom, live: document.getElementById('toast').getAttribute('aria-live') };
      });
      assert.ok(r.toastBottom <= r.navTop + 1, `${page} 토스트(${r.toastBottom})가 하단 탭바(${r.navTop})와 겹침`);
      assert.equal(r.live, 'polite', `${page} #toast aria-live 누락`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('모바일(375px) 일기장·교환일기에서 에디터가 목록보다 위에 온다', async (browser) => {
  for (const [page, editorSel, listSel] of [
    ['diary.html', '#diaryEditorCard', '.diary-list-card'],
    ['shared-diary.html', '#sharedEditorCol', '.shared-list-card'],
  ]) {
    const { page: p, context, errors } = await fixture(browser, 375, 'order-' + page, { page });
    try {
      const r = await p.evaluate(([e, l]) => ({
        edTop: document.querySelector(e).getBoundingClientRect().top,
        listTop: document.querySelector(l).getBoundingClientRect().top,
      }), [editorSel, listSel]);
      assert.ok(r.edTop < r.listTop, `${page} 에디터(${r.edTop})가 목록(${r.listTop}) 아래에 있음`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('5개 페이지 모두 시스템 다크모드 추종 및 theme-color 동적 동기화', async (browser) => {
  for (const page of ['index.html', 'study.html', 'reading.html', 'diary.html', 'shared-diary.html']) {
    const { page: p, context, errors } = await fixture(browser, 375, 'theme-' + page, { page });
    try {
      await p.emulateMedia({ colorScheme: 'dark' });
      await p.evaluate(() => { localStorage.removeItem('theme'); window.applyAppTheme(); });
      const darkState = await p.evaluate(() => ({
        dark: document.body.classList.contains('dark'),
        tc: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
      }));
      assert.equal(darkState.dark, true, `${page} 시스템 다크모드 미적용`);
      assert.equal(darkState.tc, '#101112', `${page} 다크 theme-color 불일치: ${darkState.tc}`);

      await p.evaluate(() => toggleTheme());
      const lightState = await p.evaluate(() => ({
        dark: document.body.classList.contains('dark'),
        tc: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
      }));
      assert.equal(lightState.dark, false, `${page} 라이트 전환 실패`);
      assert.equal(lightState.tc, '#F5F3EE', `${page} 라이트 theme-color 불일치: ${lightState.tc}`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('홈 모달은 Escape로 닫히고 배경 스크롤을 잠그며 role=dialog를 가진다', async (browser) => {
  const { page: p, context, errors } = await fixture(browser, 375, 'modal-ux');
  try {
    await p.evaluate(() => openSearchModal());
    await p.waitForTimeout(100);
    const opened = await p.evaluate(() => ({
      open: document.getElementById('searchModal').classList.contains('open'),
      role: document.getElementById('searchModal').getAttribute('role'),
      modal: document.getElementById('searchModal').getAttribute('aria-modal'),
      overflow: document.body.style.overflow,
    }));
    assert.deepEqual(opened, { open: true, role: 'dialog', modal: 'true', overflow: 'hidden' });

    await p.keyboard.press('Escape');
    await p.waitForTimeout(80);
    const closed = await p.evaluate(() => ({
      open: document.getElementById('searchModal').classList.contains('open'),
      overflow: document.body.style.overflow,
    }));
    assert.deepEqual(closed, { open: false, overflow: '' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('공유 계정 금고는 비밀번호 마스킹·보기 토글 및 prompt 없는 인라인 수정을 제공한다', async (browser) => {
  const { page: p, context, errors } = await fixture(browser, 375, 'vault-ux');
  try {
    let dialogFired = false;
    p.on('dialog', d => { dialogFired = true; d.dismiss(); });
    await p.evaluate(() => {
      spaceData.sharedLogins = [{ id: 'v1', service: '넷플릭스', username: 'user@test.com', password: 'secret' }];
      openVaultModal();
    });
    assert.equal(await p.locator('#vaultPw').getAttribute('type'), 'password');
    await p.locator('#vaultPwToggle').click();
    assert.equal(await p.locator('#vaultPw').getAttribute('type'), 'text');

    await p.evaluate(() => editVaultEntry('v1'));
    assert.equal(dialogFired, false, '수정 시 prompt()가 호출됨');
    assert.equal(await p.locator('#vaultService').inputValue(), '넷플릭스');
    assert.equal(await p.locator('#vaultSubmitBtn').textContent(), '수정 저장');
    assert.equal(await p.locator('#vaultCancelEditBtn').isVisible(), true);

    await p.locator('#vaultService').fill('넷플릭스 프리미엄');
    await p.locator('#vaultSubmitBtn').click();
    assert.equal(await p.evaluate(() => spaceData.sharedLogins[0].service), '넷플릭스 프리미엄');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('스터디 탭 해시 유지, 퀴즈 단축키 탭 격리, 토스트 안내, 시맨틱 버튼', async (browser) => {
  const { page: p, context, errors } = await fixture(browser, 375, 'study-ux', { page: 'study.html' });
  try {
    let alertFired = false;
    p.on('dialog', d => { alertFired = true; d.dismiss(); });
    await p.evaluate(() => { document.getElementById('loginOverlay').style.display = 'none'; });

    // 탭 전환 시 해시와 aria-selected 동기화
    await p.evaluate(() => showTab('vocab'));
    assert.equal(await p.evaluate(() => location.hash), '#vocab');
    assert.equal(await p.locator('.study-tabs button[aria-controls="tab-vocab"]').getAttribute('aria-selected'), 'true');

    // 단어 추가 빈 값 검증은 alert 대신 toast
    await p.evaluate(() => { toggleCustomForm(); addCustomWord(); });
    assert.equal(alertFired, false, '단어 검증에 alert()가 호출됨');
    assert.equal(await p.locator('#toast').evaluate(e => e.classList.contains('show')), true);

    // 퀴즈 진행 중 다른 탭으로 이동하면 숫자키 1~4가 무시됨
    await p.evaluate(() => { showTab('quiz'); startQuiz(); showTab('grammar'); });
    await p.keyboard.press('1');
    assert.equal(await p.evaluate(() => selectedOptIdx), null, '비활성 퀴즈 탭에서 숫자키가 동작함');

    // 학습 계획 카드 헤더와 알파벳 카드가 <button> 요소
    const tags = await p.evaluate(() => ({
      dia: document.querySelector('.dia-card-header').tagName,
      alpha: document.querySelector('.alpha-card').tagName,
    }));
    assert.deepEqual(tags, { dia: 'BUTTON', alpha: 'BUTTON' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const c of cases) {
      try {
        await c.fn(browser);
        results.push({ name: c.name, pass: true });
        console.log('PASS ' + c.name);
      } catch (e) {
        results.push({ name: c.name, pass: false, error: e.message });
        console.log('FAIL ' + c.name + ' — ' + e.message);
      }
    }
  } finally { await browser.close(); }
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})();
