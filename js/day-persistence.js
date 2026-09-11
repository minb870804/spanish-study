async function saveRecurring(arr) {
  if (!spaceId || !currentUser) return false;
  const uid = currentUser.uid, activeSpace = spaceId;
  const personal = arr.filter(rule => todoScope(rule, 'private') !== 'shared');
  const shared = arr.filter(rule => todoScope(rule, 'private') === 'shared');
  try {
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), {
      personalRecurring: personal,
      personalUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.update(db.collection('spaces').doc(activeSpace), {
      recurring: shared,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    if (currentUser?.uid === uid && spaceId === activeSpace) {
      userData.personalRecurring = personal;
      spaceData.recurring = shared;
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
  const entries = changes.map(([key, day]) => ({
    key, split: splitDayForStorage(day),
    previous: { personal: personalDayRaw(key), shared: sharedDayRaw(key) }
  }));
  const previousWrites = entries.map(({ key }) => daySaveQueues.get(key) || Promise.resolve());
  for (const { key, split } of entries) {
    pendingDayWrites.set(key, { id: writeId, split });
    applySplitDayLocal(key, split);
  }
  const write = Promise.allSettled(previousWrites).then(async () => {
    const userUpdates = { personalUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const spaceUpdates = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    for (const { key, split } of entries) {
      userUpdates[`personalDays.${key}`] = split.personal;
      spaceUpdates[`days.${key}`] = split.shared;
    }
    if (moveEvent) {
      if (moveEvent.visibility === 'shared') spaceUpdates.moveLog = firebase.firestore.FieldValue.arrayUnion(moveEvent);
      else userUpdates.personalMoveLog = firebase.firestore.FieldValue.arrayUnion(moveEvent);
    }
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), userUpdates);
    batch.update(db.collection('spaces').doc(activeSpace), spaceUpdates);
    await batch.commit();
  });
  for (const { key } of entries) daySaveQueues.set(key, write);
  const isCurrentWrite = key => currentUser?.uid === uid && spaceId === activeSpace
    && pendingDayWrites.get(key)?.id === writeId;
  try {
    await write;
    for (const { key, split } of entries) {
      if (isCurrentWrite(key)) applySplitDayLocal(key, split);
    }
    return true;
  } catch (e) {
    for (const { key, previous } of entries) {
      if (isCurrentWrite(key)) applySplitDayLocal(key, previous);
    }
    console.error('저장 실패:', e);
    toast('저장에 실패했어요. 다시 시도해 주세요.');
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
