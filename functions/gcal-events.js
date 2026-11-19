// minb 일정 → 구글 캘린더 이벤트 변환(순수 함수). 서버 동기화(gcal.js)와 테스트가 같이 쓴다.
//
// 이벤트 id는 '어느 곳(개인/공유)의 몇 일 할 일 몇 번' 으로 정해지므로 여러 번 보내도 같은 이벤트를 고친다.
// 날짜를 옮기면 다른 id가 되어 새 이벤트가 생기고, 예전 날짜의 이벤트는 그 달을 다시 맞출 때 지워진다.
// (같은 할 일 id만 쓰면 달이 바뀌는 이동에서 '새 달 추가'가 '옛 달 삭제'보다 먼저 처리될 때 지워져 버린다.)
const { createHash } = require('node:crypto');
const { ruleMatchesKey } = require('./recurring-eve');

const TIME_ZONE = 'Asia/Seoul';
const APP_URL = 'https://minb87.vercel.app';
const DAY_MS = 24 * 60 * 60 * 1000;
const LUNAR_YEARS_AHEAD = 20;
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isKey = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

// 구글 이벤트 id 는 base32hex(0-9, a-v) 5~1024자. 16진수는 그 안에 들어간다.
function eventId(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

function hashOf(body) {
  return createHash('sha1').update(JSON.stringify(body)).digest('hex');
}

function addDays(key, n) {
  return new Date(Date.parse(key + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' + 'HH:MM' 에 분을 더한 벽시계 시각(시간대 없음)
function wallTime(key, time, plusMinutes = 0) {
  const [h, m] = time.split(':').map(Number);
  const t = Date.parse(key + 'T00:00:00Z') + (h * 60 + m + plusMinutes) * 60000;
  return new Date(t).toISOString().slice(0, 19);
}

function describe(item, linkKey) {
  const lines = [];
  if (typeof item.notes === 'string' && item.notes.trim()) lines.push(item.notes.trim());
  lines.push(`minb에서 보기: ${APP_URL}/?date=${linkKey}`);
  return lines.join('\n\n');
}

function baseBody(item, linkKey) {
  const body = {
    summary: `${item.done ? '✓ ' : ''}${String(item.text || '').trim() || '(제목 없음)'}`.slice(0, 300),
    description: describe(item, linkKey),
    status: 'confirmed',
    // 알림은 minb 앱이 보낸다. 구글 기본 알림까지 오면 두 번 울린다.
    reminders: { useDefault: false },
    extendedProperties: { private: { minb: '1' } }
  };
  if (typeof item.location === 'string' && item.location.trim()) body.location = item.location.trim().slice(0, 300);
  return body;
}

// 시작·끝 날짜(끝 포함)와 시간으로 start/end 를 만든다.
function timing(item, startKey, endKey) {
  if (item.allDay || !isTime(item.time)) {
    return { start: { date: startKey }, end: { date: addDays(endKey, 1) } };
  }
  const start = wallTime(startKey, item.time);
  let end = isTime(item.endTime) ? wallTime(endKey, item.endTime) : wallTime(endKey, item.time, 60);
  if (end <= start) end = wallTime(startKey, item.time, 60);
  return { start: { dateTime: start, timeZone: TIME_ZONE }, end: { dateTime: end, timeZone: TIME_ZONE } };
}

// 하루 할 일 하나 → 이벤트. 기간 일정(startDate~endDate)은 시작일에 저장되어 있다.
function todoEvent(item, dayKey) {
  if (!isMap(item) || !String(item.text || '').trim()) return null;
  const startKey = isKey(item.startDate) && isKey(item.endDate) && item.endDate > item.startDate ? item.startDate : dayKey;
  const endKey = startKey === item.startDate ? item.endDate : startKey;
  return { ...baseBody(item, startKey), ...timing(item, startKey, endKey) };
}

// 월별 문서의 entries → { 이벤트id: 이벤트 } (owner 는 'user:uid' 또는 'space:id')
function monthEvents(owner, entries) {
  const out = {};
  if (!isMap(entries)) return out;
  for (const [dayKey, day] of Object.entries(entries)) {
    if (!isKey(dayKey) || !isMap(day)) continue;
    const todos = isMap(day.todos) ? Object.entries(day.todos)
      : Array.isArray(day.todos) ? day.todos.map((t, i) => [t && t.id ? String(t.id) : `legacy_${i}`, t]) : [];
    for (const [todoId, todo] of todos) {
      const body = todoEvent(todo, dayKey);
      if (body) out[eventId('todo', owner, dayKey, todoId)] = body;
    }
  }
  return out;
}

// 반복 규칙에서 첫 날짜: 시작일이 없으면 규칙을 만든 날(id='r'+시각36진수), 그것도 없으면 오늘
function ruleStartKey(rule, todayKey) {
  if (isKey(rule.startDate)) return rule.startDate;
  const ms = typeof rule.id === 'string' && /^r[0-9a-z]+$/.test(rule.id) ? parseInt(rule.id.slice(1), 36) : NaN;
  if (Number.isFinite(ms) && ms > Date.UTC(2020, 0, 1) && ms < Date.UTC(2100, 0, 1)) return new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  return todayKey;
}

// 앱은 없는 날짜(31일, 2월 29일 등)를 그달 말일에 보여 준다. 28일 넘는 날은 'N일 이하 중 마지막 날'로 쓴다.
function monthDayRule(n) {
  n = Math.min(Math.max(Number(n) || 1, 1), 31);
  if (n <= 28) return `BYMONTHDAY=${n}`;
  return `BYMONTHDAY=${Array.from({ length: n - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`;
}

function rrule(rule, timed) {
  let r;
  if (rule.freq === 'yearly') r = `FREQ=YEARLY;BYMONTH=${Number(rule.month) || 1};${monthDayRule(rule.monthDay)}`;
  else if (rule.freq === 'monthly') r = `FREQ=MONTHLY;${monthDayRule(rule.monthDay)}`;
  else {
    const days = [...new Set((rule.days || []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
    if (!days.length) return null;
    r = days.length === 7 ? 'FREQ=DAILY' : `FREQ=WEEKLY;BYDAY=${days.map(d => BYDAY[d]).join(',')}`;
  }
  if (isKey(rule.endDate)) {
    // 종일 일정은 날짜, 시간 일정은 UTC 시각으로 끝을 적는다(한국 시간 그날 끝까지).
    r += timed ? `;UNTIL=${rule.endDate.replace(/-/g, '')}T145959Z` : `;UNTIL=${rule.endDate.replace(/-/g, '')}`;
  }
  return `RRULE:${r}`;
}

// 반복 규칙 목록 → { 이벤트id: 이벤트 }. 음력은 규칙으로 쓸 수 없어 해마다 따로 넣는다.
function recurringEvents(owner, rules, todayKey) {
  const out = {};
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!isMap(rule) || !rule.id || !String(rule.text || '').trim()) continue;
    const startKey = ruleStartKey(rule, todayKey);
    if (isKey(rule.endDate) && rule.endDate < startKey) continue;
    const timed = !rule.allDay && isTime(rule.time);
    const item = { ...rule, done: false };

    if (rule.freq === 'yearly' && rule.calendar === 'lunar') {
      const lastYear = Math.min(isKey(rule.endDate) ? Number(rule.endDate.slice(0, 4)) : 9999, Number(todayKey.slice(0, 4)) + LUNAR_YEARS_AHEAD);
      for (let year = Number(startKey.slice(0, 4)); year <= lastYear; year++) {
        for (let key = `${year}-01-01`; key.startsWith(String(year)); key = addDays(key, 1)) {
          if (key < startKey || !ruleMatchesKey({ ...rule, startDate: startKey }, key)) continue;
          out[eventId('rule', owner, rule.id, key)] = { ...baseBody(item, key), ...timing(item, key, key) };
        }
      }
      continue;
    }

    const recurrence = rrule(rule, timed);
    if (!recurrence) continue;
    // 첫 이벤트 날짜가 규칙에 맞아야 구글이 그 날을 엉뚱하게 하나 더 만들지 않는다.
    let first = startKey;
    for (let i = 0; i < 400 && !ruleMatchesKey({ ...rule, startDate: startKey }, first); i++) first = addDays(first, 1);
    if (!ruleMatchesKey({ ...rule, startDate: startKey }, first)) continue;
    out[eventId('rule', owner, rule.id)] = { ...baseBody(item, first), ...timing(item, first, first), recurrence: [recurrence] };
  }
  return out;
}

function kstTodayKey(now = Date.now()) {
  return new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
}

module.exports = { eventId, hashOf, monthEvents, recurringEvents, todoEvent, rrule, monthDayRule, kstTodayKey };
