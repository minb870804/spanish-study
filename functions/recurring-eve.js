// 반복 일정 '전날 알림'에 쓰는 날짜 판정. 앱의 getRecurringFor·js/lunar.js 와 같은 규칙을 따른다.
// 음력은 중국 음력과 하루씩 어긋나는 달이 있어 한국 전통력(Intl 'dangi')을 쓴다.
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

let dangi = null;
try { dangi = new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { timeZone: 'UTC', month: 'numeric', day: 'numeric' }); } catch (e) {}

function lunarOf(t) {
  const parts = dangi.formatToParts(new Date(t));
  const month = parts.find(p => p.type === 'month').value;
  return { leap: !/^\d+$/.test(month), m: parseInt(month.replace(/\D/g, ''), 10), d: Number(parts.find(p => p.type === 'day').value) };
}

// 'YYYY-MM-DD' 가 음력 M월 D일(윤달 제외)인지. 작은달(29일)의 30일 일정은 그믐(29일)에 맞춘다.
function lunarMatches(key, month, day) {
  if (!dangi) return false;
  const t = Date.parse(key + 'T00:00:00Z');
  const lunar = lunarOf(t);
  if (lunar.leap || lunar.m !== month) return false;
  if (lunar.d === day) return true;
  return day === 30 && lunar.d === 29 && lunarOf(t + DAY_MS).d === 1;
}

function ruleMatchesKey(rule, key) {
  if (!rule) return false;
  if (rule.startDate && key < rule.startDate || rule.endDate && key > rule.endDate) return false;
  const [y, mo, d] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (rule.freq === 'yearly') {
    const month = Number(rule.month) || 1, day = Number(rule.monthDay) || 1;
    if (rule.calendar === 'lunar') return lunarMatches(key, month, day);
    return mo === month && d === Math.min(day, lastDay);
  }
  if (rule.freq === 'monthly') return d === Math.min(Number(rule.monthDay) || 1, lastDay);
  return (rule.days || []).includes(new Date(Date.UTC(y, mo - 1, d)).getUTCDay());
}

// 한국 시간 기준 내일 'YYYY-MM-DD'
function tomorrowKey(now) {
  return new Date(now + KST_OFFSET_MS + DAY_MS).toISOString().slice(0, 10);
}

module.exports = { ruleMatchesKey, tomorrowKey };
