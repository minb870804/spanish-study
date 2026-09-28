function createDiaryStorage({db, ref, field, depth, current, receive, observe, fail}) {
  let mode = 'legacy', stopped = false, unsubscribe = null, migrating = false;
  const active = () => !stopped && current();
  const months = () => ref.collection('diaryMonths');
  function startMonths() {
    if (!active() || mode === 'months') return;
    mode = 'months';
    unsubscribe = months().onSnapshot({includeMetadataChanges:true}, snap => {
      if (!active()) return;
      observe(snap);
      if (!snap.metadata?.hasPendingWrites) receive(DiaryMonths.mergeMonths(snap.docs.map(doc => doc.data())));
    }, error => { if (active()) fail(error); });
  }
  async function migrate() {
    if (migrating) return;
    migrating = true;
    const startedAt = Date.now();
    try {
      const server = (await ref.get({source:'server'})).data() || {};
      if (!active()) return;
      if ((server.diaryStorage || 0) >= 2) { startMonths(); return; }
      const deps = {db, col:months(), FieldPath:firebase.firestore.FieldPath, depth};
      const result = await DiaryMonths.migrate({...deps, legacy:server[field] || {}});
      if (!active() || !result.ok) return;
      await ref.set({diaryStorage:2, diaryMovedAt:startedAt}, {merge:true});
      startMonths();
      const fresh = (await ref.get({source:'server'})).data() || {};
      await DiaryMonths.catchUp({...deps, legacy:fresh[field] || {}, since:startedAt - 600000});
    } catch (error) {
      console.warn('일기 월별 저장 전환을 다음 연결에서 다시 시도합니다:', error.code || error.message);
    }
  }
  return {
    read(data, snap) {
      if (!active()) return;
      if ((data.diaryStorage || 0) >= 2) startMonths();
      if (mode === 'months') return;
      observe(snap);
      receive(data[field] || {});
      if (!snap.metadata?.fromCache) void migrate();
    },
    write(key, entry, uid) {
      const path = depth === 2 ? [key, uid] : [key];
      if (mode === 'months') {
        return months().doc(DiaryMonths.monthOf(key)).set(
          {entries:depth === 2 ? {[key]:{[uid]:entry}} : {[key]:entry}},
          {mergeFields:[new firebase.firestore.FieldPath('entries', ...path)]});
      }
      if (depth === 1) return ref.set({[field]:{[key]:entry}}, {merge:true});
      return ref.update({[[field, ...path].join('.')]:entry, updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    },
    remove(key, uid) {
      const path = depth === 2 ? [key, uid] : [key];
      if (mode === 'months') return months().doc(DiaryMonths.monthOf(key))
        .update(new firebase.firestore.FieldPath('entries', ...path), firebase.firestore.FieldValue.delete());
      return ref.update({[[field, ...path].join('.')]:firebase.firestore.FieldValue.delete()});
    },
    stop() { stopped = true; unsubscribe?.(); }
  };
}
