// 실제 Chrome DOM에서 교환일기 화면이 상대방이 저장한 photo·mood·회원 사진·날짜 키를 실행하지 않는지 확인한다.
// shared-diary.html 의 실제 스크립트(renderMembers·renderPartners·renderList·esc)를 격리된 새 Chrome 프로필에서 돌린다.
// 모든 요청을 가로채 로컬 소스만 응답하고(gstatic 은 메모리 Firebase 대역), 그 밖의 요청은 모두 막고 기록한다.
// 서비스워커는 막는다. 결과 JSON·스크린샷은 MINB_EVIDENCE 를 준 경우에만 그 폴더(저장소 밖)에 쓴다.
// 실행: MINB_PLAYWRIGHT=<playwright 모듈 경로> node tests/shared-diary-browser.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { chromium } = require(process.env.MINB_PLAYWRIGHT || 'playwright');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
// 증거 폴더는 실제 경로(심볼릭 링크 해석) 기준으로 저장소 밖이어야 한다. 아니면 시작하지 않는다.
const evidence = (() => {
  if (!process.env.MINB_EVIDENCE) return '';
  const target = path.resolve(process.env.MINB_EVIDENCE);
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = path.join(fs.realpathSync(probe), path.relative(probe, target));
  const repo = fs.realpathSync(root);
  if (real === repo || real.startsWith(repo + path.sep)) throw new Error(`MINB_EVIDENCE 는 저장소 밖이어야 합니다: ${real}`);
  return real;
})();

// 페이지가 부르는 Firebase 를 대신한다. 로그인 사용자 A, 실제 서버에는 접속하지 않는다.
function mockFirebase() {
  const user = { uid: 'A', displayName: 'A', getIdToken: async () => 'test-token' };
  const snap = data => ({ exists: true, data: () => structuredClone(data), metadata: {} });
  const docs = { users: { A: { spaceId: 'space' } }, spaces: { space: { members: ['A', 'B'], memberProfiles: {}, sharedDiary: {} } } };
  const ref = (collection, id) => ({
    get: async () => snap(docs[collection][id] || {}),
    onSnapshot(...args) { const cb = typeof args[0] === 'function' ? args[0] : args[1]; queueMicrotask(() => cb(snap(docs[collection][id] || {}))); return () => {}; },
    set: async () => {}, update: async () => {},
    collection: () => ({ doc: () => ref(collection, id), get: async () => ({ docs: [] }), onSnapshot: (...a) => { const cb = typeof a[0] === 'function' ? a[0] : a[1]; queueMicrotask(() => cb({ docs: [], metadata: {} })); return () => {}; } })
  });
  const db = { enablePersistence: async () => {}, batch: () => ({ set() {}, update() {}, commit: async () => {} }), collection: c => ({ doc: id => ref(c, id) }) };
  const auth = { onAuthStateChanged(cb) { setTimeout(() => cb(user), 0); }, getRedirectResult: async () => null, signOut: async () => {} };
  window.firebase = {
    initializeApp() {},
    auth: Object.assign(() => auth, { GoogleAuthProvider: function () {} }),
    firestore: Object.assign(() => db, { FieldValue: { delete: () => ({}), serverTimestamp: () => 1 }, FieldPath: class {} })
  };
}

let browser, context, page;
// local = 저장소 파일로 응답, stubbed = 외부 CDN 주소를 메모리 대역으로 응답(외부 접속 아님), blocked = 막음
const local = [], stubbed = [], blocked = [], sockets = [], pageErrors = [];
before(async () => {
  // page.route 는 페이지 요청만 가로챈다. 브라우저 자체 통신(업데이트·동기화 등)까지 막기 위해
  // 백그라운드 통신을 끄고, 모든 통신을 응답하지 않는 loopback 프록시(127.0.0.1:9)로 보낸다.
  browser = await chromium.launch({
    channel: 'chrome', headless: true,
    proxy: { server: 'http://127.0.0.1:9' },
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
      '--disable-domain-reliability', '--no-first-run', '--no-default-browser-check', '--disable-features=OptimizationHints,MediaRouter,Translate']
  });
  context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  await context.addInitScript(mockFirebase);
  // 웹소켓은 연결 전에 닫는다(시도만 기록).
  await context.routeWebSocket(/.*/, ws => { sockets.push(ws.url()); ws.close(); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'minb.test') {
      local.push(url.pathname);
      const file = path.join(root, decodeURIComponent(url.pathname));
      if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] || 'text/plain';
        return route.fulfill({ body: fs.readFileSync(file), contentType: type });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.hostname === 'www.gstatic.com') { stubbed.push(url.origin + url.pathname); return route.fulfill({ body: '', contentType: 'application/javascript' }); }
    blocked.push(url.origin + url.pathname);
    return route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.goto('https://minb.test/shared-diary.html');
  await page.waitForTimeout(300);
});
after(async () => {
  try {
    if (evidence && page) {
      fs.mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, 'shared-diary-xss.png'), fullPage: true });
      fs.writeFileSync(path.join(evidence, 'shared-diary-browser.json'), JSON.stringify({ local, stubbed, blocked, sockets, pageErrors }, null, 2));
    }
  } finally {
    if (browser) await browser.close();
  }
});

const KEY = '2026-11-07';
// 실제 렌더 함수로 실제 DOM에 그린다. 네트워크 결과에 기대지 않도록, 그려진 모든 요소에 error·load 이벤트를
// 직접 일으켜 끼어든 on* 속성이 있다면 반드시 sentinel 이 바뀌게 한다(이 방식이 유효한지는 아래 대조 검사로 확인).
const fire = () => page.evaluate(() => {
  for (const id of ['memberChips', 'partnerEntries', 'entryList']) {
    for (const el of document.getElementById(id).querySelectorAll('*')) {
      for (const type of ['error', 'load']) el.dispatchEvent(new Event(type));
    }
  }
});
async function render(state) {
  const errorsBefore = pageErrors.length;
  await page.evaluate(({ state, KEY }) => {
    window.__xss = 0;
    currentUser = { uid: 'A' };
    spaceData = state;
    editingKey = KEY;
    viewMonth = new Date(2026, 10, 1);
    renderMembers(); renderPartners(); renderList();
  }, { state, KEY });
  await fire();
  await page.waitForTimeout(200);
  assert.deepEqual(pageErrors.slice(errorsBefore), [], '렌더 중 페이지 오류');
  return page.evaluate(() => {
    const boxes = ['memberChips', 'partnerEntries', 'entryList'].map(id => document.getElementById(id));
    const inner = boxes.flatMap(b => [...b.querySelectorAll('*')]); // 컨테이너 안의 모든 자손
    return {
      sentinel: window.__xss,
      handlers: [...boxes, ...inner].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name) && !(a.name === 'onclick' && /^goDate\('\d{4}-\d{2}-\d{2}'\)$/.test(a.value))).map(a => `${el.tagName}.${a.name}=${a.value}`)),
      tags: [...new Set(inner.map(el => el.tagName))],
      imgs: boxes.flatMap(b => [...b.querySelectorAll('img')].map(i => i.getAttribute('src'))),
      text: Object.fromEntries(boxes.map(b => [b.id, b.textContent])),
      entryClicks: [...document.querySelectorAll('#entryList .entry-item')].map(el => el.getAttribute('onclick'))
    };
  });
}
const base = entries => ({ members: ['A', 'B'], memberProfiles: { A: { name: '나' }, B: { name: '배우자' } }, sharedDiary: { [KEY]: entries } });

test('photo 속성 탈출과 javascript: 사진은 실제 Chrome 에서 실행되지 않는다', async () => {
  const r = await render(base({ B: { text: '안녕', name: '배우자', mood: '😊', photo: 'https://img.test/a.png" onerror="window.__xss=1" x="' } }));
  assert.equal(r.sentinel, 0);
  assert.deepEqual(r.handlers, []);
  const r2 = await render(base({ B: { text: '안녕', name: '배우자', mood: '😊', photo: 'javascript:window.__xss=2' } }));
  assert.equal(r2.sentinel, 0);
  assert.ok(r2.imgs.every(src => /^https:\/\//.test(src)), JSON.stringify(r2.imgs));
});

test('mood 에 넣은 태그는 카드와 목록 모두 글자로만 보인다', async () => {
  const payload = '<img src=x onerror="window.__xss=3"><svg onload="window.__xss=4">';
  const r = await render(base({ B: { text: '안녕', name: '배우자', mood: payload } }));
  assert.equal(r.sentinel, 0);
  assert.deepEqual(r.handlers, []);
  assert.ok(!r.tags.includes('SVG') && !r.tags.includes('svg'), JSON.stringify(r.tags));
  assert.ok(r.text.partnerEntries.includes(payload));
  assert.ok(r.text.entryList.includes(payload));
});

test('회원 칩 사진의 속성 탈출과 javascript: 주소를 막는다', async () => {
  const state = base({ B: { text: '안녕', name: '배우자', mood: '😊' } });
  state.memberProfiles = { A: { name: '나', photo: 'javascript:window.__xss=5' }, B: { name: '배우자', photo: 'https://img.test/p.png" onerror="window.__xss=6' } };
  const r = await render(state);
  assert.equal(r.sentinel, 0);
  assert.deepEqual(r.handlers, []);
  assert.ok(r.imgs.every(src => /^https:\/\//.test(src)), JSON.stringify(r.imgs));
});

test('날짜 키로 위장한 문자열은 목록에 그려지지 않고, 그려진 항목을 눌러도 실행되지 않는다', async () => {
  const state = base({ B: { text: '정상', name: '배우자', mood: '😊' } });
  state.sharedDiary["2026-11-08');window.__xss=7;//"] = { B: { text: '공격', name: '배우자', mood: '😊' } };
  const r = await render(state);
  assert.deepEqual(r.handlers, []);
  assert.ok(r.entryClicks.every(v => /^goDate\('\d{4}-\d{2}-\d{2}'\)$/.test(v)), JSON.stringify(r.entryClicks));
  assert.ok(!r.text.entryList.includes('공격'));
  for (const item of await page.locator('#entryList .entry-item').all()) await item.click();
  assert.equal(await page.evaluate(() => window.__xss), 0);
});

test('정상 사진·mood·글은 실제 DOM 에 그대로 보인다', async () => {
  const photo = 'https://lh3.googleusercontent.com/a/photo=s96-c?x=1&y=2';
  const state = base({ B: { text: 'A & B <3', name: '배우자', mood: '😊', photo } });
  state.memberProfiles.B.photo = photo;
  const r = await render(state);
  assert.equal(r.sentinel, 0);
  // DOM 의 src 주소만 확인한다. 외부 요청을 막으므로 실제 이미지가 내려받아져 보이는지는 확인하지 않는다.
  assert.deepEqual(r.imgs, [photo, photo]);
  assert.ok(r.text.partnerEntries.includes('😊 배우자'));
  assert.ok(r.text.partnerEntries.includes('A & B <3'));
  assert.ok(r.text.entryList.includes('😊'));
});

test('대조: 진짜 onerror 속성이 있으면 같은 이벤트 방식으로 sentinel 이 바뀐다', async () => {
  await page.evaluate(() => {
    window.__ctlError = 0; window.__ctlLoad = 0;
    document.getElementById('partnerEntries').innerHTML = '<img alt="" onerror="window.__ctlError=1"><span onload="window.__ctlLoad=1"></span>';
  });
  await fire();
  assert.deepEqual(await page.evaluate(() => [window.__ctlError, window.__ctlLoad]), [1, 1],
    'error·load 이벤트를 직접 일으키는 검사 방식이 실제로 인라인 처리기를 실행해야 한다');
});

test('대조: 페이지가 웹소켓을 열면 연결 전에 가로채져 열리지 않고 닫힌다', async () => {
  const before = sockets.length;
  const state = await page.evaluate(() => new Promise(resolve => {
    const ws = new WebSocket('wss://ws.test/probe');
    let opened = false;
    ws.onopen = () => { opened = true; };
    ws.onclose = () => resolve({ opened, readyState: ws.readyState });
    setTimeout(() => resolve({ opened, readyState: ws.readyState, timeout: true }), 3000);
  }));
  assert.deepEqual(sockets.slice(before), ['wss://ws.test/probe']);
  assert.equal(state.opened, false);
  assert.equal(state.readyState, 3);
  sockets.splice(before, 1); // 대조용 시도는 아래 격리 판정에서 뺀다
});

test('격리: 웹소켓은 연결 전에 막히고, 서비스워커는 없고, 저장소 밖 요청은 모두 막히거나 메모리 대역이다', async () => {
  assert.deepEqual(sockets, []);
  assert.equal(await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), false);
  assert.ok(stubbed.every(u => u.startsWith('https://www.gstatic.com/')), JSON.stringify(stubbed));
  assert.ok(local.includes('/shared-diary.html'));
  console.log(JSON.stringify({ local: [...new Set(local)], stubbed: [...new Set(stubbed)], blocked: [...new Set(blocked)], pageErrors }));
});
