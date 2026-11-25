// ══════════════════════════════════════
// 일정 저장 위치 — 달마다 문서 하나(users/{uid}/dayMonths, spaces/{id}/dayMonths/{YYYY-MM})
// 예전에는 users/{uid}.personalDays · spaces/{id}.days 한 곳에 전부 쌓여 문서 한도(1MB)에
// 닿을 상황이었고, 저장할 때마다 그날 목록을 통째로 덮어써 동시에 고친 쪽이 사라질 수 있었다.
// 처음 한 번 복사해 옮기고(원본은 남김), 이후로는 바뀐 할 일·메모 칸만 골라 쓴다.
// 화면은 예전처럼 personalDaysMap()/sharedDaysMap()이 주는 하루(todos 배열)만 본다.
// ══════════════════════════════════════
const DAY_STORAGE_VERSION = 2;
const DAY_LEGACY_FIELD = { personal: 'personalDays', shared: 'days' };
const DAY_LABEL = { personal: '개인 일정', shared: '공유 일정' };
// days = 화면이 보는 하루들(저장 전에 먼저 바뀐 내용 포함)
// base = 서버에 있다고 알고 있는 마지막 상태. 저장할 때 '무엇을 바꿨는지'는 이것과 비교한다.
//        앱은 화면을 먼저 바꾸고(setDayLocal) 저장하므로, days와 비교하면 바뀐 게 없어 보인다.
//        월별 문서 스냅샷을 받을 때와 저장이 성공했을 때만 갱신한다.
const dayStore = {
  personal: { mode: 'legacy', days: {}, base: {}, unsub: null, owner: null, migrating: false, retryAt: 0 },   // owner = uid
  shared: { mode: 'legacy', days: {}, base: {}, unsub: null, owner: null, migrating: false, retryAt: 0 }       // owner = spaceId
};
const copyDay = day => (day === undefined ? undefined : JSON.parse(JSON.stringify(day)));
const dayBase = (side, key) => dayStore[side].base[key] || {};

function personalDaysMap() {
  return dayStore.personal.mode === 'months' ? dayStore.personal.days : ((userData && userData.personalDays) || {});
}
function sharedDaysMap() {
  return dayStore.shared.mode === 'months' ? dayStore.shared.days : ((spaceData && spaceData.days) || {});
}
const dayOwnerRef = (side, owner) => db.collection(side === 'personal' ? 'users' : 'spaces').doc(owner);
const dayMonthsCol = (side, owner) => dayOwnerRef(side, owner).collection('dayMonths');

function stopDayMonths(side) {
  const st = dayStore[side];
  if (st.unsub) { st.unsub(); st.unsub = null; }
}
function resetDayStorage(side) {
  stopDayMonths(side);
  Object.assign(dayStore[side], { mode: 'legacy', days: {}, base: {}, owner: null, migrating: false, retryAt: 0 });
}

// 사용자·스페이스 문서 스냅샷을 받을 때마다 부른다(data = 방금 받은 문서 내용).
// 처음 받은 문서 기준으로 저장 방식을 정하고, 아직 안 옮겼으면 옮긴다. 옮기는 동안은 예전 일정을 보여 준다.
function ensureDayStorage(side, owner, data) {
  const st = dayStore[side];
  if (!owner || !data) return;
  const moved = (data.dayStorage || 0) >= DAY_STORAGE_VERSION;
  if (st.owner === owner) {
    // 예전 방식으로 쓰던 중 다른 기기가 옮기기를 끝냈으면 새 방식으로 넘어간다(예전 위치는 이제 잠김)
    if (st.mode === 'legacy' && moved && !st.migrating) startDayMonths(side, owner);
    // 이 화면에서 옮기기에 실패했으면 잠시 뒤 다음 스냅샷 때 다시 시도한다.
    else if (st.mode === 'legacy' && !moved && !st.migrating && Date.now() >= st.retryAt) migrateDays(side, owner);
    return;
  }
  resetDayStorage(side);
  st.owner = owner;
  if (moved) { startDayMonths(side, owner); return; }
  migrateDays(side, owner);
}

const DAY_MIGRATION_RETRY_MS = 60 * 1000;
function migrateDays(side, owner) {
  const st = dayStore[side];
  st.migrating = true;
  moveDaysToMonths(side, owner).then(ok => {
    if (st.owner !== owner) return;
    st.migrating = false;
    if (!ok) st.retryAt = Date.now() + DAY_MIGRATION_RETRY_MS;
    if (ok && st.mode === 'legacy') startDayMonths(side, owner);
  });
}

// 실시간 구독 — 바뀐 달의 문서만 새로 받는다.
function startDayMonths(side, owner) {
  const st = dayStore[side];
  stopDayMonths(side);
  st.mode = 'months';
  st.owner = owner;
  st.unsub = dayMonthsCol(side, owner).onSnapshot(snap => {
    if (st.owner !== owner) return;
    st.days = DayMonths.fromStoredDays(DayMonths.mergeMonths(snap.docs.map(d => d.data())));
    st.base = copyDay(st.days);
    if (userData && spaceData) renderAll();
  }, e => console.error(`${DAY_LABEL[side]} 구독 에러:`, e));
}

// 예전 위치 → 월별 문서로 한 번 옮긴다. 전환 표시까지 달면 true(다른 기기가 이미 옮겼어도 true).
// 실패하면 예전 방식으로 쓰고 다음에 다시 시도한다(원본은 절대 지우지 않는다).
// 이미 표시된(dayStorage >= 2) 곳은 아무것도 쓰지 않는다 — 예전 누락을 자동으로 되살리지 않는다.
async function moveDaysToMonths(side, owner) {
  const FieldPath = firebase.firestore.FieldPath;
  const ref = dayOwnerRef(side, owner), col = dayMonthsCol(side, owner);
  const field = DAY_LEGACY_FIELD[side], label = DAY_LABEL[side];
  const run = async () => {
    // 기기에 남은 오래된 캐시로 옮기면 빠지는 날이 생기므로 원본은 서버에서 읽는다.
    const server = (await ref.get({ source: 'server' })).data() || {};
    if ((server.dayStorage || 0) >= DAY_STORAGE_VERSION) return true; // 다른 기기가 이미 옮김
    // 원본에 있는 달과, 예전 시도가 남겼을 수 있는 월별 문서의 달.
    const existing = (await col.get({ source: 'server' })).docs.map(d => d.id);
    const months = [...new Set([...existing, ...Object.keys(DiaryMonths.groupByMonth(server[field] || {}))])].sort();
    // 모든 복사는 원본 문서(전환 표시)와 함께 읽는 transaction 안에서 한다 — 그사이 다른 기기가 전환을 끝냈으면
    // 아무것도 쓰지 않고 멈춰서, 그 기기의 월별 편집·삭제를 예전 내용으로 덮지 않는다.
    const sync = (list, mark) => db.runTransaction(tx => DayMonths.syncMonths({ tx, ref, col, FieldPath,
      deleteValue: firebase.firestore.FieldValue.delete(), arrayUnion: firebase.firestore.FieldValue.arrayUnion,
      field, version: DAY_STORAGE_VERSION, months: list, mark }));
    let copied = 0;
    for (let i = 0; i < months.length; i += 12) { // 12달(최대 372일)씩 나눠 미리 맞춘다
      const step = await sync(months.slice(i, i + 12), false);
      if (step.already) return true;
      copied += step.written;
    }
    // 이 표시 이후로는 보안 규칙이 예전 위치 쓰기를 막는다(업데이트 안 된 화면이 조용히 어긋나지 않게).
    // 표시와 '그사이 바뀐 날 맞추기'를 한 transaction으로 묶어, 표시가 남았는데 바뀐 날이 빠지는 일이 없게 한다.
    const done = await sync(months, true);
    if (copied || done.written) console.info(`${label}: ${copied}일치를 옮기고 ${done.written}일치를 마무리에서 맞췄어요.`);
    return true;
  };
  try {
    return await DiaryMonths.withTimeout(run(), 45000, `${label} 옮기기`);
  } catch (e) {
    console.warn(`이번엔 ${label}을 옮기지 못했어요 — 예전 방식으로 열고 다음에 다시 시도합니다:`, e && (e.code || e.message));
    return false;
  }
}

// 하루 하나의 변경을 저장 묶음(batch)에 담는다. 월별 방식이면 바뀐 칸만, 예전 방식이면 하루 통째로.
// legacyUpdate: 예전 방식일 때 본문서에 모아 쓸 객체(호출한 쪽이 batch.update로 한 번에 쓴다)
function addDayWrite(batch, legacyUpdate, side, owner, key, prevDay, nextDay, mode = dayStore[side].mode) {
  if (mode === 'months') {
    const w = DayMonths.monthWrite({ col: dayMonthsCol(side, owner), FieldPath: firebase.firestore.FieldPath,
      deleteValue: firebase.firestore.FieldValue.delete(), key, prevDay, nextDay });
    if (w) batch.set(w.ref, w.data, w.options);
    return !!w;
  }
  legacyUpdate[`${DAY_LEGACY_FIELD[side]}.${key}`] = nextDay;
  return true;
}

// arr = 화면 목록(getAllRecurring())에 이번 변경을 더한 결과. 화면 목록은 오래됐을 수 있으므로 통째로 쓰지 않고,
// 화면 목록과 비교해 이번에 바꾼 것(추가·삭제·바뀐 칸)만 골라 서버의 최신 목록에 얹는다.
// 개인·공유 두 문서를 한 transaction에서 읽고 쓰므로 공유 범위 이동도 함께 반영되거나 함께 실패한다.
// 상대가 이미 지운 규칙은 고쳐도 되살리지 않는다.
let recurringSaveSeq = 0;
async function saveRecurring(arr) {
  if (!spaceId || !currentUser) return false;
  const uid = currentUser.uid, activeSpace = spaceId;
  // 저장이 끝났을 때 화면에 결과를 넣는 건 '가장 최근에 시작한 저장'이고 그사이 새 스냅샷이 없을 때만.
  // 아니면 이미 더 최신 상태를 보고 있으므로 건드리지 않는다(구독이 서버 결과를 다시 보내 준다).
  const seq = ++recurringSaveSeq, startUser = userData, startSpace = spaceData;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const base = new Map(getAllRecurring().map(rule => [rule.id, rule]));
  const nextIds = new Set(arr.map(rule => rule.id));
  const removed = [...base.keys()].filter(id => !nextIds.has(id));
  const changes = arr.map(rule => {
    const prev = base.get(rule.id);
    if (!prev) return { rule, added: true };
    const fields = [...new Set([...Object.keys(prev), ...Object.keys(rule)])].filter(f => !same(prev[f], rule[f]));
    return fields.length ? { rule, fields } : null;
  }).filter(Boolean);
  const userRef = db.collection('users').doc(uid), spaceRef = db.collection('spaces').doc(activeSpace);
  let personal, shared;
  try {
    await db.runTransaction(async tx => {
      const userDoc = (await tx.get(userRef)).data() || {};
      const spaceDoc = (await tx.get(spaceRef)).data() || {};
      const serverPersonal = userDoc.personalRecurring || [], serverShared = spaceDoc.recurring || [];
      let all = [...serverPersonal.map(rule => scopedTodo(rule, 'private')), ...serverShared.map(rule => scopedTodo(rule, 'shared'))];
      all = all.filter(rule => !removed.includes(rule.id));
      changes.forEach(({ rule, added, fields }) => {
        const cur = all.find(item => item.id === rule.id);
        if (!cur) { if (added) all.push(JSON.parse(JSON.stringify(rule))); return; }
        (fields || Object.keys(rule)).forEach(f => {
          if (rule[f] === undefined) delete cur[f]; else cur[f] = JSON.parse(JSON.stringify(rule[f]));
        });
      });
      personal = all.filter(rule => todoScope(rule, 'private') !== 'shared');
      shared = all.filter(rule => todoScope(rule, 'private') === 'shared');
      if (!same(personal, serverPersonal)) tx.update(userRef, {
        personalRecurring: personal,
        personalUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (!same(shared, serverShared)) tx.update(spaceRef, {
        recurring: shared,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    if (seq === recurringSaveSeq && currentUser?.uid === uid && spaceId === activeSpace) {
      if (userData && userData === startUser) userData.personalRecurring = personal;
      if (spaceData && spaceData === startSpace) spaceData.recurring = shared;
    }
    return true;
  } catch (e) {
    console.error('반복 할 일 저장 실패:', e);
    toast('저장에 실패했어요. 다시 시도해 주세요.');
    return false;
  }
}

async function saveDayChanges(changes, moveEvent = null) {
  if (!spaceId || !currentUser) return false;
  const uid = currentUser.uid, activeSpace = spaceId;
  const writeId = ++daySaveSeq;
  // 실패 이유 판단과 쓰는 위치는 '저장을 시작한 때'의 방식을 따른다.
  const modes = { personal: dayStore.personal.mode, shared: dayStore.shared.mode };
  const entries = changes.map(([key, day]) => ({
    key, split: splitDayForStorage(day),
    previous: { personal: personalDayRaw(key), shared: sharedDayRaw(key) }
  }));
  // 쓸 내용은 지금 계산해 둔다(이전 상태 대비 바뀐 칸만, 값은 이 순간 복사).
  const batch = db.batch();
  const userUpdates = {}, spaceUpdates = {};
  let monthWrites = 0;
  for (const { key, split } of entries) {
    if (addDayWrite(batch, userUpdates, 'personal', uid, key, dayBase('personal', key), split.personal, modes.personal) && modes.personal === 'months') monthWrites++;
    if (addDayWrite(batch, spaceUpdates, 'shared', activeSpace, key, dayBase('shared', key), split.shared, modes.shared) && modes.shared === 'months') monthWrites++;
  }
  if (moveEvent) {
    if (moveEvent.visibility === 'shared') spaceUpdates.moveLog = firebase.firestore.FieldValue.arrayUnion(moveEvent);
    else userUpdates.personalMoveLog = firebase.firestore.FieldValue.arrayUnion(moveEvent);
  }
  // 본문서는 쓸 게 있을 때만 건드린다 — 월별 방식에선 큰 본문서를 매번 두 기기가 다시 받지 않게.
  if (Object.keys(userUpdates).length) {
    userUpdates.personalUpdatedAt = firebase.firestore.FieldValue.serverTimestamp();
    batch.update(db.collection('users').doc(uid), userUpdates);
  }
  if (Object.keys(spaceUpdates).length) {
    spaceUpdates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    batch.update(db.collection('spaces').doc(activeSpace), spaceUpdates);
  }
  const hasWrites = monthWrites > 0 || Object.keys(userUpdates).length > 0 || Object.keys(spaceUpdates).length > 0;
  const previousWrites = entries.map(({ key }) => daySaveQueues.get(key) || Promise.resolve());
  for (const { key, split } of entries) {
    pendingDayWrites.set(key, { id: writeId, split });
    applySplitDayLocal(key, split);
  }
  const write = Promise.allSettled(previousWrites).then(async () => {
    if (hasWrites) await batch.commit();
  });
  for (const { key } of entries) daySaveQueues.set(key, write);
  const isCurrentWrite = key => currentUser?.uid === uid && spaceId === activeSpace
    && pendingDayWrites.get(key)?.id === writeId;
  try {
    await write;
    for (const { key, split } of entries) {
      // 방금 쓴 내용이 이제 서버에 있다 — 다음 저장은 이걸 기준으로 비교한다(스냅샷보다 먼저 올 수 있으므로).
      if (modes.personal === 'months' && dayStore.personal.owner === uid) dayStore.personal.base[key] = copyDay(split.personal);
      if (modes.shared === 'months' && dayStore.shared.owner === activeSpace) dayStore.shared.base[key] = copyDay(split.shared);
      if (isCurrentWrite(key)) applySplitDayLocal(key, split);
    }
    return true;
  } catch (e) {
    for (const { key, previous } of entries) {
      if (isCurrentWrite(key)) applySplitDayLocal(key, previous);
    }
    console.error('저장 실패:', e);
    if (e && e.code === 'permission-denied' && (modes.personal === 'legacy' || modes.shared === 'legacy')) {
      // 다른 기기가 저장 방식을 바꿔 예전 위치가 잠겼다. 화면은 곧 새 방식으로 넘어간다.
      toast('저장 방식이 바뀌었어요. 잠시 후 다시 해 주세요.');
    } else {
      toast('저장에 실패했어요. 다시 시도해 주세요.');
    }
    return false;
  } finally {
    for (const { key } of entries) {
      if (isCurrentWrite(key)) pendingDayWrites.delete(key);
      if (daySaveQueues.get(key) === write) daySaveQueues.delete(key);
    }
  }
}

function saveDay(key, day) {
  return saveDayChanges([[key, day]]);
}

function saveMovedDays(sourceKey, sourceDay, targetKey, targetDay, moveEvent = null) {
  return saveDayChanges([[sourceKey, sourceDay], [targetKey, targetDay]], moveEvent);
}
