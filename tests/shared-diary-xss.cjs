// 교환일기 화면이 상대방이 저장한 photo·mood·날짜 키를 HTML로 해석하지 않는지 확인한다.
// shared-diary.html 의 실제 renderPartners·renderList 와 js/diary-common.js 의 esc 를 그대로 실행한다.
// 공격 문자열은 렌더 결과 문자열로만 검사하며 실행하지 않는다.
// 태그·속성 판별은 간단한 정규식이라 실제 브라우저 HTML 파서와 완전히 같지는 않다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'shared-diary.html'), 'utf8');
const common = fs.readFileSync(path.join(root, 'js', 'diary-common.js'), 'utf8');
const extract = name => {
  const start = page.indexOf('function ' + name + '(');
  return page.slice(start, page.indexOf('\n}\n', start) + 2);
};

// 브라우저가 텍스트 노드를 innerHTML로 직렬화하는 규칙(& < > 와 nbsp만 바꾼다)을 따른다.
const serializeText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
function render(state) {
  const els = {};
  const element = () => ({ innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const context = vm.createContext({
    console, navigator: { onLine: true }, localStorage: { getItem() {}, setItem() {} },
    window: { addEventListener() {} },
    document: {
      getElementById: id => (els[id] ||= element()),
      createElement: () => { let text = ''; return { set textContent(v) { text = String(v); }, get innerHTML() { return serializeText(text); } }; }
    },
    currentUser: { uid: 'me' }, spaceData: state.spaceData, editingKey: state.editingKey,
    viewMonth: new Date(2026, 10, 1), DAYS_KO: ['일', '월', '화', '수', '목', '금', '토'],
    getEntries: key => (state.spaceData.sharedDiary || {})[key] || {}
  });
  vm.runInContext(common + '\n' + ['photoImg', 'renderMembers', 'partnerNames', 'renderPartners', 'renderList'].map(extract).join('\n'), context);
  context.renderMembers();
  context.renderPartners();
  context.renderList();
  return { members: els.memberChips.innerHTML, partners: els.partnerEntries.innerHTML, list: els.entryList.innerHTML };
}
const imgSources = html => tags(html).filter(t => t.tag === 'img').map(t => (t.attrs.find(a => a.name === 'src') || {}).value);

// 렌더된 HTML의 태그와 속성을 읽는다. 따옴표로 묶인 값은 값으로만 본다.
function tags(html) {
  const out = [];
  const re = /<\s*([a-zA-Z][\w-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = [];
    const are = /([^\s=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
    let a;
    while ((a = are.exec(m[2]))) attrs.push({ name: a[1].toLowerCase(), value: a[3] ?? a[4] ?? a[2] ?? '' });
    out.push({ tag: m[1].toLowerCase(), attrs });
  }
  return out;
}
function assertInert(html) {
  for (const { tag, attrs } of tags(html)) {
    assert.ok(['div', 'span', 'img', 'button'].includes(tag), `예상하지 못한 태그 <${tag}>: ${html}`);
    for (const { name, value } of attrs) {
      assert.ok(!name.startsWith('on') || (name === 'onclick' && /^goDate\('\d{4}-\d{2}-\d{2}'\)$/.test(value)),
        `이벤트 속성 ${name}="${value}" 이 끼어들었다: ${html}`);
      if (tag === 'img' && name === 'src') assert.match(value, /^https:\/\//, `img src 는 https 주소만: ${value}`);
      assert.ok(['class', 'src', 'alt', 'referrerpolicy', 'onclick', 'type'].includes(name), `예상하지 못한 속성 ${name}: ${html}`);
    }
  }
}

const KEY = '2026-11-07';
const diary = entries => ({ editingKey: KEY, spaceData: { members: ['me', 'partner'], memberProfiles: { partner: { name: '배우자' } }, sharedDiary: { [KEY]: entries } } });

test('photo 속성 탈출 문자열은 이벤트 속성이 되지 않는다', () => {
  const { partners } = render(diary({ partner: { text: '안녕', name: '배우자', mood: '😊', photo: 'https://img.test/a.png" onerror="globalThis.pwned=1" x="' } }));
  assertInert(partners);
});

test('javascript: 사진 주소는 이미지로 쓰지 않는다', () => {
  const { partners } = render(diary({ partner: { text: '안녕', name: '배우자', mood: '😊', photo: 'javascript:globalThis.pwned=1' } }));
  assertInert(partners);
  assert.doesNotMatch(partners, /javascript:/i);
});

test('mood 에 넣은 태그는 글자로만 보인다(일기 카드와 목록 모두)', () => {
  const payload = '<img src=x onerror="globalThis.pwned=1">';
  const { partners, list } = render(diary({ partner: { text: '안녕', name: '배우자', mood: payload } }));
  assertInert(partners);
  assertInert(list);
  assert.match(partners, /&lt;img src=x onerror=/);
  assert.match(list, /&lt;img src=x onerror=/);
});

test('날짜 키로 위장한 문자열은 목록 onclick 으로 들어가지 않는다', () => {
  const state = diary({ partner: { text: '정상', name: '배우자', mood: '😊' } });
  state.spaceData.sharedDiary["2026-11-08');globalThis.pwned=1;//"] = { partner: { text: '공격', name: '배우자', mood: '😊' } };
  const { list } = render(state);
  assertInert(list);
  assert.doesNotMatch(list, /pwned/);
});

test('회원 칩 사진도 속성 탈출과 javascript: 주소를 막는다', () => {
  const state = diary({ partner: { text: '안녕', name: '배우자', mood: '😊' } });
  state.spaceData.memberProfiles = { me: { name: '나', photo: 'javascript:globalThis.pwned=1' }, partner: { name: '배우자', photo: 'https://img.test/p.png" onerror="globalThis.pwned=1' } };
  const { members } = render(state);
  assertInert(members);
  assert.doesNotMatch(members, /javascript:/i);
});

test('정상 사진·mood·글은 그대로 보인다', () => {
  const photo = 'https://lh3.googleusercontent.com/a/photo=s96-c?x=1&y=2';
  const state = diary({ partner: { text: 'A & B <3', name: '배우자', mood: '😊', photo } });
  state.spaceData.memberProfiles.partner.photo = photo;
  const { members, partners, list } = render(state);
  assertInert(members);
  assertInert(partners);
  assertInert(list);
  // 속성 값은 HTML 엔티티(&amp;)로 적혀 있고 브라우저가 & 로 되돌린다.
  assert.deepEqual(imgSources(partners).map(s => s.replace(/&amp;/g, '&')), [photo]);
  assert.deepEqual(imgSources(members).map(s => s.replace(/&amp;/g, '&')), [photo]);
  assert.match(partners, /😊 배우자/);
  assert.match(partners, /A &amp; B &lt;3/);
  assert.match(list, /<span>😊<\/span>/);
  assert.match(list, /goDate\('2026-11-07'\)/);
});

test('사진이 없으면 기본 아이콘을 쓴다', () => {
  const { partners } = render(diary({ partner: { text: '안녕', name: '배우자' } }));
  assertInert(partners);
  assert.match(partners, /👤/);
  assert.match(partners, /📝 배우자/);
});
