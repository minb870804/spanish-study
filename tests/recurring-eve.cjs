// 서버 전날 알림(functions/recurring-eve.js)과 앱(js/lunar.js) 의 날짜 판정이 같은지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.MINB_ROOT || path.join(__dirname, '..');
const { ruleMatchesKey, tomorrowKey } = require(path.join(root, 'functions', 'recurring-eve.js'));
global.window = {};
require(path.join(root, 'js', 'lunar.js'));

test('lunar rules match the app on every day of 2026-2030', () => {
  const rules = [[5, 3], [10, 4], [1, 11], [10, 23], [2, 30], [12, 30]].map(([month, monthDay]) => ({ freq: 'yearly', calendar: 'lunar', month, monthDay }));
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2031, 0, 1); t += 864e5) {
    const key = new Date(t).toISOString().slice(0, 10);
    for (const rule of rules) {
      assert.equal(ruleMatchesKey(rule, key), window.lunarToSolarKeys(Number(key.slice(0, 4)), rule.month, rule.monthDay).includes(key), `${key} 음력 ${rule.month}/${rule.monthDay}`);
    }
  }
});

test('known Korean birthdays and solar rules', () => {
  assert.equal(ruleMatchesKey({ freq: 'yearly', calendar: 'lunar', month: 10, monthDay: 4 }, '2026-11-12'), true);
  assert.equal(ruleMatchesKey({ freq: 'yearly', calendar: 'lunar', month: 10, monthDay: 4 }, '2026-11-11'), false);
  assert.equal(ruleMatchesKey({ freq: 'yearly', month: 11, monthDay: 20 }, '2026-11-20'), true);
  assert.equal(ruleMatchesKey({ freq: 'yearly', month: 2, monthDay: 31 }, '2027-02-28'), true);
  assert.equal(ruleMatchesKey({ freq: 'yearly', month: 11, monthDay: 20, startDate: '2027-01-01' }, '2026-11-20'), false);
  assert.equal(ruleMatchesKey({ freq: 'monthly', monthDay: 31 }, '2026-04-30'), true);
  assert.equal(ruleMatchesKey({ days: [4] }, '2026-11-12'), true);
});

test('tomorrow is computed in Korean time', () => {
  assert.equal(tomorrowKey(Date.parse('2026-11-11T09:00:00+09:00')), '2026-11-12');
  assert.equal(tomorrowKey(Date.parse('2026-11-11T00:30:00+09:00')), '2026-11-12');
  assert.equal(tomorrowKey(Date.parse('2026-12-31T23:59:00+09:00')), '2027-01-01');
});
