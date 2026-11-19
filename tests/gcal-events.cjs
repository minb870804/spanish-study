// 구글 캘린더로 보내는 이벤트 모양(functions/gcal-events.js)이 앱의 일정 규칙과 맞는지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
const G = require(path.join(root, 'functions', 'gcal-events.js'));
const { ruleMatchesKey } = require(path.join(root, 'functions', 'recurring-eve.js'));

test('event ids are valid Google ids and stable', () => {
  const id = G.eventId('todo', 'user:abc', '2026-11-19', 't1');
  assert.match(id, /^[0-9a-v]{5,1024}$/);
  assert.equal(id, G.eventId('todo', 'user:abc', '2026-11-19', 't1'));
  assert.notEqual(id, G.eventId('todo', 'user:abc', '2026-11-20', 't1'));
  assert.notEqual(id, G.eventId('todo', 'space:abc', '2026-11-19', 't1'));
});

test('all-day, timed, and period todos', () => {
  assert.deepEqual(pick(G.todoEvent({ text: '장보기' }, '2026-11-19')), { start: { date: '2026-11-19' }, end: { date: '2026-11-20' } });
  assert.deepEqual(pick(G.todoEvent({ text: '회의', time: '14:00', endTime: '15:30' }, '2026-11-19')), {
    start: { dateTime: '2026-11-19T14:00:00', timeZone: 'Asia/Seoul' }, end: { dateTime: '2026-11-19T15:30:00', timeZone: 'Asia/Seoul' }
  });
  // 끝 시간이 없으면 1시간, 자정을 넘어가면 다음 날
  assert.equal(G.todoEvent({ text: '야식', time: '23:30' }, '2026-12-31').end.dateTime, '2027-01-01T00:30:00');
  // 끝이 시작보다 빠르면 1시간짜리로
  assert.equal(G.todoEvent({ text: 'x', time: '10:00', endTime: '09:00' }, '2026-11-19').end.dateTime, '2026-11-19T11:00:00');
  // 종일로 바꾼 일정은 시간이 남아 있어도 종일
  assert.deepEqual(G.todoEvent({ text: 'x', allDay: true, time: '10:00' }, '2026-11-19').start, { date: '2026-11-19' });
  // 기간 일정: 끝 날짜 포함
  assert.deepEqual(pick(G.todoEvent({ text: '여행', startDate: '2026-11-19', endDate: '2026-11-22' }, '2026-11-19')), { start: { date: '2026-11-19' }, end: { date: '2026-11-23' } });
  assert.equal(G.todoEvent({ text: '출장', time: '09:00', endTime: '18:00', startDate: '2026-11-19', endDate: '2026-11-20' }, '2026-11-19').end.dateTime, '2026-11-20T18:00:00');
});

test('title, done mark, notes, location and no Google reminders', () => {
  const body = G.todoEvent({ text: ' 병원 ', done: true, notes: '진료카드', location: '서울대병원' }, '2026-11-19');
  assert.equal(body.summary, '✓ 병원');
  assert.match(body.description, /^진료카드\n\nminb에서 보기: https:\/\/minb87\.vercel\.app\/\?date=2026-11-19$/);
  assert.equal(body.location, '서울대병원');
  assert.deepEqual(body.reminders, { useDefault: false });
  assert.equal(G.todoEvent({ text: '  ' }, '2026-11-19'), null);
});

test('month entries: stored map and legacy array shapes', () => {
  const events = G.monthEvents('user:u', {
    '2026-11-19': { todos: { a: { id: 'a', text: '하나' }, b: { id: 'b', text: '' } }, todoOrder: ['a', 'b'] },
    '2026-11-20': { todos: [{ id: 'c', text: '둘' }, { text: '셋' }] },
    'bad-key': { todos: { d: { text: 'x' } } }
  });
  assert.equal(Object.keys(events).length, 3);
  assert.ok(events[G.eventId('todo', 'user:u', '2026-11-19', 'a')]);
  assert.ok(events[G.eventId('todo', 'user:u', '2026-11-20', 'legacy_1')]);
});

test('month-day rules fall back to the last day like the app', () => {
  assert.equal(G.monthDayRule(15), 'BYMONTHDAY=15');
  assert.equal(G.monthDayRule(31), 'BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
  assert.equal(G.monthDayRule(29), 'BYMONTHDAY=28,29;BYSETPOS=-1');
});

test('recurrence rules', () => {
  assert.equal(G.rrule({ days: [1, 3] }, false), 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  assert.equal(G.rrule({ days: [0, 1, 2, 3, 4, 5, 6] }, false), 'RRULE:FREQ=DAILY');
  assert.equal(G.rrule({ days: [] }, false), null);
  assert.equal(G.rrule({ freq: 'monthly', monthDay: 10, endDate: '2027-03-31' }, false), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=10;UNTIL=20270331');
  assert.equal(G.rrule({ freq: 'yearly', month: 2, monthDay: 29 }, true), 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1');
  assert.equal(G.rrule({ freq: 'monthly', monthDay: 1, endDate: '2027-01-01' }, true), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270101T145959Z');
});

test('recurring events start on the first matching day', () => {
  const rules = [
    { id: 'r1', text: '운동', days: [1, 3], startDate: '2026-11-19' },            // 목요일 시작 → 다음 월요일
    { id: 'r2', text: '월세', freq: 'monthly', monthDay: 31, startDate: '2026-11-01' },
    { id: 'r3', text: '결혼기념일', freq: 'yearly', month: 5, monthDay: 3, startDate: '2020-01-01' },
    { id: 'r4', text: '빈 요일', days: [] }
  ];
  const events = G.recurringEvents('space:s', rules, '2026-11-19');
  assert.equal(Object.keys(events).length, 3);
  const first = rule => events[G.eventId('rule', 'space:s', rule)].start.date;
  assert.equal(first('r1'), '2026-11-23');
  assert.equal(first('r2'), '2026-11-30');
  assert.equal(first('r3'), '2020-05-03');
  for (const id of ['r1', 'r2', 'r3']) {
    const rule = rules.find(r => r.id === id);
    assert.ok(ruleMatchesKey(rule, first(id)), id);
  }
});

test('timed recurring rule keeps its time', () => {
  const events = G.recurringEvents('user:u', [{ id: 'r9', text: '약', days: [0, 1, 2, 3, 4, 5, 6], time: '08:00', startDate: '2026-11-19' }], '2026-11-19');
  const body = Object.values(events)[0];
  assert.deepEqual(body.start, { dateTime: '2026-11-19T08:00:00', timeZone: 'Asia/Seoul' });
  assert.deepEqual(body.recurrence, ['RRULE:FREQ=DAILY']);
});

test('lunar yearly rules become one event per year on the right solar day', () => {
  const rule = { id: 'r5', text: '엄마 생신', freq: 'yearly', calendar: 'lunar', month: 10, monthDay: 4, startDate: '2026-01-01', endDate: '2030-12-31' };
  const events = G.recurringEvents('user:u', [rule], '2026-11-19');
  const days = Object.values(events).map(e => e.start.date).sort();
  assert.equal(days.length, 5);
  assert.equal(days[0], '2026-11-12');
  for (const key of days) assert.ok(ruleMatchesKey(rule, key), key);
  assert.ok(Object.values(events).every(e => !e.recurrence));
});

test('lunar rules without an end stop 20 years ahead', () => {
  const events = G.recurringEvents('user:u', [{ id: 'r6', text: '제사', freq: 'yearly', calendar: 'lunar', month: 3, monthDay: 15, startDate: '2026-01-01' }], '2026-11-19');
  const years = Object.values(events).map(e => Number(e.start.date.slice(0, 4)));
  assert.equal(Math.min(...years), 2026);
  assert.equal(Math.max(...years), 2046);
});

test('rule without start date starts when it was created', () => {
  const created = Date.UTC(2025, 2, 10, 3); // 2025-03-10 12:00 KST
  const events = G.recurringEvents('user:u', [{ id: 'r' + created.toString(36), text: '매월', freq: 'monthly', monthDay: 15 }], '2026-11-19');
  assert.equal(Object.values(events)[0].start.date, '2025-03-15');
});

test('changing a todo changes the hash; same todo keeps it', () => {
  const a = G.todoEvent({ text: '회의', time: '10:00' }, '2026-11-19');
  assert.equal(G.hashOf(a), G.hashOf(G.todoEvent({ text: '회의', time: '10:00' }, '2026-11-19')));
  assert.notEqual(G.hashOf(a), G.hashOf(G.todoEvent({ text: '회의', time: '11:00' }, '2026-11-19')));
});

function pick(body) { return { start: body.start, end: body.end }; }
