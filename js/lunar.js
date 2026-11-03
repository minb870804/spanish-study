// 음력(한국 전통력) → 양력 변환. 브라우저 내장 Intl 'dangi' 달력을 쓴다.
// 중국 음력과 하루씩 어긋나는 달이 있어 'chinese' 가 아니라 'dangi' 를 쓴다.
(function () {
  let fmt = null;
  try { fmt = new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { timeZone: 'UTC', month: 'numeric', day: 'numeric' }); } catch (e) {}
  const cache = new Map(); // 양력 연도 → { 'M-D': ['YYYY-MM-DD', ...] } (윤달 제외)

  function lunarOf(t) {
    const parts = fmt.formatToParts(new Date(t));
    const month = parts.find(p => p.type === 'month').value;
    return { leap: !/^\d+$/.test(month), m: parseInt(month.replace(/\D/g, ''), 10), d: Number(parts.find(p => p.type === 'day').value) };
  }

  function yearMap(year) {
    if (cache.has(year)) return cache.get(year);
    const map = {};
    const add = (k, key) => (map[k] = map[k] || []).push(key);
    for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 864e5) {
      const lunar = lunarOf(t);
      if (lunar.leap) continue;
      const key = new Date(t).toISOString().slice(0, 10);
      add(`${lunar.m}-${lunar.d}`, key);
      // 작은달(29일)에는 음력 30일 일정을 그믐(29일)에 표시
      if (lunar.d === 29 && lunarOf(t + 864e5).d === 1) add(`${lunar.m}-30`, key);
    }
    cache.set(year, map);
    return map;
  }

  // 그 양력 연도에 음력 M월 D일이 되는 양력 날짜 목록('YYYY-MM-DD')
  window.lunarToSolarKeys = function (year, month, day) {
    if (!fmt) return [];
    return yearMap(year)[`${month}-${day}`] || [];
  };
  window.lunarSupported = !!fmt;
})();
