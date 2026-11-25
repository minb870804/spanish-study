/* 일정(하루 단위 할 일·메모)을 월별 문서로 나눠 저장하는 도구.
 *
 * 예전에는 공유 일정은 spaces/{id}.days, 개인 일정은 users/{uid}.personalDays 한 곳에
 * 전부 쌓여 문서 한도(1MB)에 닿을 상황이었고, 저장할 때마다 그날 할 일 목록 전체를
 * 통째로 덮어써서 두 사람이 같은 날을 동시에 고치면 한쪽 변경이 사라질 수 있었다.
 *
 *   공유 일정  spaces/{id}/dayMonths/{YYYY-MM}   { entries: { 'YYYY-MM-DD': 저장용 하루 } }
 *   개인 일정  users/{uid}/dayMonths/{YYYY-MM}    { entries: { 'YYYY-MM-DD': 저장용 하루 } }
 *
 * 저장용 하루는 할 일을 배열 대신 id별 맵(todos)과 순서(todoOrder)로 둔다. 저장할 때는
 * 바뀐 할 일·메모 칸만 골라 쓰므로, 서로 다른 할 일을 동시에 고치면 둘 다 남는다.
 * 순서 목록은 통째로 쓰기 때문에 동시에 추가하면 순서가 어긋날 수 있지만, 순서에서 빠진
 * 할 일도 뒤에 붙여 보여 주므로 할 일 자체는 사라지지 않는다.
 *
 * 화면 코드는 계속 예전 모양(todos 배열)만 다룬다. 바꿔 끼우는 건 저장 경계에서만 한다.
 * 월 묶기·검증·정확히 쓰기는 diary-months.js(DiaryMonths)를 그대로 쓴다.
 */
const DayMonths = (() => {
  const M = typeof DiaryMonths !== 'undefined' ? DiaryMonths : require('./diary-months.js');
  const DELETE = Symbol('delete');   // diffDay가 돌려주는 '이 칸을 지워라' 표시
  const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);

  // 메모리 모양(todos 배열) → 저장용(todos 맵 + todoOrder).
  // id가 없거나 겹치는 할 일도 잃지 않도록 항상 같은 규칙으로 고유 id를 붙인다.
  function toStored(day) {
    if (!isMap(day)) return day;
    const { todos, ...rest } = day;
    const out = { ...rest };
    if (Array.isArray(todos)) {
      out.todos = {};
      out.todoOrder = [];
      const seen = new Set();
      todos.forEach((t, i) => {
        if (!isMap(t)) return;
        const base = t.id ? String(t.id) : `legacy_${i}`;
        let id = base, n = 1;
        while (seen.has(id)) id = `${base}__${n++}`;
        seen.add(id);
        out.todos[id] = t.id === id ? t : { ...t, id };
        out.todoOrder.push(id);
      });
    }
    return out;
  }

  // 저장용 → 메모리 모양. 순서 목록에 없는 할 일(동시에 추가된 경우 등)도 뒤에 붙인다.
  function fromStored(stored) {
    if (!isMap(stored)) return stored;
    const { todos, todoOrder, ...rest } = stored;
    const out = { ...rest };
    if (isMap(todos)) {
      const used = new Set(), list = [];
      (Array.isArray(todoOrder) ? todoOrder : []).forEach(id => {
        if (isMap(todos[id]) && !used.has(id)) { used.add(id); list.push(todos[id]); }
      });
      Object.keys(todos).filter(id => !used.has(id) && isMap(todos[id])).sort().forEach(id => list.push(todos[id]));
      out.todos = list;
    } else if (Array.isArray(todos)) {
      out.todos = todos;
    }
    return out;
  }

  const mapValues = (map, fn) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, fn(v)]));
  const toStoredDays = days => mapValues(days, toStored);
  const fromStoredDays = days => mapValues(days, fromStored);

  // 두 저장용 하루를 비교해 바뀐 곳만 [경로, 값|DELETE] 로 돌려준다.
  // 맵(할 일, 메모 칸, 반복 완료)은 한 칸 단위로, 나머지(순서 목록, 예전 메모 글)는 필드 통째로.
  function diffDay(prev, next) {
    const ops = [];
    const a0 = isMap(prev) ? prev : {}, b0 = isMap(next) ? next : {};
    new Set([...Object.keys(a0), ...Object.keys(b0)]).forEach(f => {
      const a = a0[f], b = b0[f];
      const perKey = (isMap(a) || isMap(b)) && (isMap(a) || a === undefined) && (isMap(b) || b === undefined);
      if (perKey) {
        const am = a || {}, bm = b || {};
        new Set([...Object.keys(am), ...Object.keys(bm)]).forEach(k => {
          if (bm[k] === undefined) { if (am[k] !== undefined) ops.push([[f, k], DELETE]); }
          else if (!M.same(am[k], bm[k])) ops.push([[f, k], bm[k]]);
        });
      } else if (b === undefined) {
        if (a !== undefined) ops.push([[f], DELETE]);
      } else if (!M.same(a, b)) {
        ops.push([[f], b]);
      }
    });
    return ops;
  }

  // 메모리 모양의 이전·이후 하루 → 월 문서에 쓸 { ref, data, options }. 바뀐 게 없으면 null.
  // 쓸 값은 이 순간 복사해 둔다 — 저장이 줄 서서 기다리는 사이 화면이 객체를 바꿔도 영향이 없게.
  function monthWrite({ col, FieldPath, deleteValue, key, prevDay, nextDay }) {
    const ops = diffDay(toStored(prevDay), toStored(nextDay));
    if (!ops.length) return null;
    const day = {};
    const fields = ops.map(([path, value]) => {
      let node = day;
      path.slice(0, -1).forEach(p => { node[p] = node[p] || {}; node = node[p]; });
      node[path[path.length - 1]] = value === DELETE ? deleteValue : JSON.parse(JSON.stringify(value));
      return new FieldPath('entries', key, ...path);
    });
    return { ref: col.doc(M.monthOf(key)), data: { entries: { [key]: day } }, options: { mergeFields: fields }, ops };
  }

  // 예전 위치 → 월별 문서 옮기기의 한 단계. transaction 하나 안에서 한다(tx = 그 transaction).
  // 전환 표시 전에는 월별 문서를 옮기는 기기만 쓰므로 예전 위치(원본)가 기준이다. 원본과 months 달의 월별 문서를
  // 읽어 다른 날(옮기는 사이 바뀐 날·지운 날, 예전 시도가 남긴 오래된 복사본)만 원본대로 맞춘다.
  // 원본 문서도 읽으므로 그사이 다른 기기가 전환 표시를 달면 transaction이 다시 돌면서 아무것도 쓰지 않고 멈춘다
  // — 표시 뒤 다른 기기의 월별 편집·삭제는 덮지 않는다.
  // mark=true면 원본에 있는 모든 달까지 맞추고 같은 커밋에서 전환 표시를 단다(표시가 남았는데 바뀐 날이 빠지는 일이 없게).
  // 한 번에 maxWrites보다 많이 맞춰야 하면 아무것도 쓰지 않고 실패한다(표시도 남지 않아 다음에 다시 시도).
  // 예비 단계에서 월 문서를 쓰면 그 달을 같은 커밋에서 원본 문서의 dayMonthsCopied 에 적어 둔다. 마지막 단계는 이 목록도
  // 읽으므로, 처음 목록에 없던 달을 다른 기기가 복사한 뒤 원본에서 지운 경우에도 그 달을 찾아 지운다.
  async function syncMonths({ tx, ref, col, FieldPath, deleteValue, arrayUnion, field, version, months = [], mark = false, maxWrites = 450 }) {
    const owner = (await tx.get(ref)).data() || {};
    if ((owner.dayStorage || 0) >= version) return { already: true, written: 0 };
    const legacy = M.groupByMonth(toStoredDays(owner[field] || {}));
    const docs = {};
    const targets = mark ? [...months, ...Object.keys(legacy), ...(Array.isArray(owner.dayMonthsCopied) ? owner.dayMonthsCopied : [])] : months;
    for (const month of new Set(targets)) {
      const snap = await tx.get(col.doc(month));
      docs[month] = ((snap.exists && snap.data()) || {}).entries || {};
    }
    const writes = [];
    Object.entries(docs).forEach(([month, entries]) => {
      const want = legacy[month] || {};
      new Set([...Object.keys(entries), ...Object.keys(want)]).forEach(key => {
        if (!M.DAY_KEY.test(key) || M.same(entries[key], want[key])) return;
        writes.push([month, key, want[key] === undefined ? deleteValue : want[key]]);
      });
    });
    if (writes.length > maxWrites) throw new Error(`옮기기에서 한 번에 맞출 날이 너무 많아요(${writes.length})`);
    writes.forEach(([month, key, value]) => tx.set(col.doc(month), { entries: { [key]: value } }, { mergeFields: [new FieldPath('entries', key)] }));
    const copied = [...new Set(writes.map(([month]) => month))];
    if (!mark && copied.length) tx.update(ref, { dayMonthsCopied: arrayUnion(...copied) });
    if (mark) tx.update(ref, { dayStorage: version, dayMovedAt: Date.now() });
    return { already: false, written: writes.length };
  }

  return { DELETE, toStored, fromStored, toStoredDays, fromStoredDays, diffDay, monthWrite, syncMonths,
    mergeMonths: M.mergeMonths, monthOf: M.monthOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DayMonths;
