const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const MAX_OVERDUE_MS = 24 * 60 * 60 * 1000;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:minb@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ── 일정 알림: 월별 문서 방식 ──
// 일정은 월별 문서(spaces/{id}/dayMonths, users/{uid}/dayMonths)로 옮겨진다(dayStorage >= 2).
// 알림은 그날 일정에 붙고 늦어도 24시간까지만 보내므로, 한국 시간 기준 앞뒤 한 달이면 충분하다.
const DAY_STORAGE_VERSION = 2;
const FieldPath = admin.firestore.FieldPath;

function reminderAction(todo, now) {
  const remindAtMs = Number((todo && todo.remindAtMs) || 0);
  if (!remindAtMs || todo.done || todo.reminderSentAt || todo.reminderSkippedAt) return null;
  if (remindAtMs > now) return null;
  return remindAtMs < now - MAX_OVERDUE_MS ? 'skip' : 'send';
}

function monthsAround(now) {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  return [-1, 0, 1].map(off => new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + off, 1)).toISOString().slice(0, 7));
}

async function remindFromDayMonths(col, now, recipientOf, payloadOf, stats) {
  for (const month of monthsAround(now)) {
    const ref = col.doc(month);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const entries = (snap.data() || {}).entries || {};
    const marks = [];
    for (const [dayKey, day] of Object.entries(entries)) {
      const todos = day && day.todos && typeof day.todos === 'object' && !Array.isArray(day.todos) ? day.todos : {};
      for (const [todoId, todo] of Object.entries(todos)) {
        stats.scanned += 1;
        const action = reminderAction(todo, now);
        if (!action) continue;
        stats.due += 1;
        if (action === 'skip') {
          marks.push({ dayKey, todoId, fields: { reminderSkippedAt: now } });
          stats.skipped += 1;
          continue;
        }
        const result = await sendReminderToUser(recipientOf(todo), payloadOf(dayKey, todoId, todo));
        if (result.sent > 0) {
          marks.push({ dayKey, todoId, fields: { reminderSentAt: now, reminderSentCount: result.sent } });
          stats.sent += result.sent;
        }
      }
    }
    if (!marks.length) continue;
    // 할 일 하나의 알림 칸만 고친다(그날 목록을 통째로 덮지 않는다). 그사이 지워진 할 일은 되살리지 않는다.
    await db.runTransaction(async tx => {
      const cur = ((await tx.get(ref)).data() || {}).entries || {};
      const args = [];
      for (const { dayKey, todoId, fields } of marks) {
        const todos = cur[dayKey] && cur[dayKey].todos;
        if (!todos || !todos[todoId]) continue;
        for (const [field, value] of Object.entries(fields)) args.push(new FieldPath('entries', dayKey, 'todos', todoId, field), value);
      }
      if (args.length) tx.update(ref, args[0], args[1], ...args.slice(2));
    });
  }
}

exports.sendTodoReminders = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    timeoutSeconds: 120,
    memory: '256MiB'
  },
  async () => {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      logger.error('VAPID keys are missing. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
      return;
    }

    const now = Date.now();
    let scanned = 0;
    let due = 0;
    let sent = 0;
    let skipped = 0;
    const monthStats = { scanned: 0, due: 0, sent: 0, skipped: 0 };

    // 저장 방식 표시만 먼저 가볍게 읽는다. 월별 문서로 옮긴 곳은 큰 본문서를 매분 받을 필요가 없다.
    const spacesSnap = await db.collection('spaces').select('dayStorage').get();
    for (const spaceFlag of spacesSnap.docs) {
      if ((spaceFlag.get('dayStorage') || 0) >= DAY_STORAGE_VERSION) {
        await remindFromDayMonths(spaceFlag.ref.collection('dayMonths'), now, todo => todo.by, (dayKey, todoId, todo) => ({
          title: 'Minb 할 일 알림',
          body: todo.text || '확인할 할 일이 있어요.',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: `todo-${spaceFlag.id}-${dayKey}-${todo.id || todoId}`,
          url: `/?date=${dayKey}`
        }), monthStats);
        continue;
      }
      // 아직 옮기지 않은 곳은 예전처럼 본문서 전체를 본다.
      const spaceDoc = await spaceFlag.ref.get();
      if (!spaceDoc.exists) continue;
      const space = spaceDoc.data() || {};
      const days = space.days || {};
      const updates = {};

      for (const [dayKey, day] of Object.entries(days)) {
        const todos = Array.isArray(day.todos) ? day.todos : [];
        let changed = false;

        for (const todo of todos) {
          scanned += 1;
          const remindAtMs = Number(todo.remindAtMs || 0);
          if (!remindAtMs || todo.done || todo.reminderSentAt || todo.reminderSkippedAt) continue;
          if (remindAtMs > now) continue;

          due += 1;
          if (remindAtMs < now - MAX_OVERDUE_MS) {
            todo.reminderSkippedAt = now;
            changed = true;
            skipped += 1;
            continue;
          }

          const result = await sendReminderToUser(todo.by, {
            title: 'Minb 할 일 알림',
            body: todo.text || '확인할 할 일이 있어요.',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: `todo-${spaceDoc.id}-${dayKey}-${todo.id}`,
            url: `/?date=${dayKey}`
          });

          if (result.sent > 0) {
            todo.reminderSentAt = now;
            todo.reminderSentCount = result.sent;
            changed = true;
            sent += result.sent;
          }
        }

        if (changed) {
          updates[`days.${dayKey}.todos`] = todos;
        }
      }

      if (Object.keys(updates).length) {
        updates.updatedAt = FieldValue.serverTimestamp();
        await spaceDoc.ref.update(updates);
      }
    }

    // 개인 일정은 각 사용자 문서에서 별도로 스캔한다.
    const usersSnap = await db.collection('users').select('dayStorage').get();
    for (const userFlag of usersSnap.docs) {
      if ((userFlag.get('dayStorage') || 0) >= DAY_STORAGE_VERSION) {
        await remindFromDayMonths(userFlag.ref.collection('dayMonths'), now, () => userFlag.id, (dayKey, todoId, todo) => ({
          title: 'Minb 개인 일정 알림',
          body: todo.text || '확인할 일정이 있어요.',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: `personal-todo-${userFlag.id}-${dayKey}-${todo.id || todoId}`,
          url: `/?date=${dayKey}`
        }), monthStats);
        continue;
      }
      const userDoc = await userFlag.ref.get();
      if (!userDoc.exists) continue;
      const user = userDoc.data() || {};
      const days = user.personalDays || {};
      const updates = {};

      for (const [dayKey, day] of Object.entries(days)) {
        const todos = Array.isArray(day.todos) ? day.todos : [];
        let changed = false;

        for (const todo of todos) {
          scanned += 1;
          const remindAtMs = Number(todo.remindAtMs || 0);
          if (!remindAtMs || todo.done || todo.reminderSentAt || todo.reminderSkippedAt) continue;
          if (remindAtMs > now) continue;

          due += 1;
          if (remindAtMs < now - MAX_OVERDUE_MS) {
            todo.reminderSkippedAt = now;
            changed = true;
            skipped += 1;
            continue;
          }

          const result = await sendReminderToUser(userDoc.id, {
            title: 'Minb 개인 일정 알림',
            body: todo.text || '확인할 일정이 있어요.',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: `personal-todo-${userDoc.id}-${dayKey}-${todo.id}`,
            url: `/?date=${dayKey}`
          });

          if (result.sent > 0) {
            todo.reminderSentAt = now;
            todo.reminderSentCount = result.sent;
            changed = true;
            sent += result.sent;
          }
        }

        if (changed) updates[`personalDays.${dayKey}.todos`] = todos;
      }

      if (Object.keys(updates).length) {
        updates.personalUpdatedAt = FieldValue.serverTimestamp();
        await userDoc.ref.update(updates);
      }
    }

    logger.info('Todo reminder scan finished', {
      scanned: scanned + monthStats.scanned,
      due: due + monthStats.due,
      sent: sent + monthStats.sent,
      skipped: skipped + monthStats.skipped
    });
  }
);

exports.joinSpace = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const uid = request.auth.uid;
  const code = String(request.data && request.data.code || '').trim().toUpperCase();
  if (!/^[A-HJ-KM-NP-Z2-9]{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', '초대 코드 형식이 올바르지 않습니다.');
  }

  const spaceRef = db.collection('spaces').doc(code);
  const userRef = db.collection('users').doc(uid);
  const token = request.auth.token || {};

  await db.runTransaction(async tx => {
    const spaceSnap = await tx.get(spaceRef);
    if (!spaceSnap.exists) throw new HttpsError('not-found', '존재하지 않는 초대 코드입니다.');
    const space = spaceSnap.data() || {};
    const members = Array.isArray(space.members) ? space.members : [];
    if (!members.includes(uid) && members.length >= 2) {
      throw new HttpsError('resource-exhausted', '이 스페이스는 이미 두 사람이 사용 중입니다.');
    }
    const nextMembers = members.includes(uid) ? members : [...members, uid];
    tx.update(spaceRef, {
      members: nextMembers,
      [`memberProfiles.${uid}`]: {
        name: token.name || '사용자',
        photo: token.picture || ''
      },
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(userRef, { spaceId: code }, { merge: true });
  });

  return { ok: true, spaceId: code };
});

exports.leaveSpace = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const uid = request.auth.uid;
  const spaceId = String(request.data && request.data.spaceId || '').trim().toUpperCase();
  if (!spaceId) throw new HttpsError('invalid-argument', '스페이스 ID가 필요합니다.');

  const spaceRef = db.collection('spaces').doc(spaceId);
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async tx => {
    const [spaceSnap, userSnap] = await Promise.all([tx.get(spaceRef), tx.get(userRef)]);
    if (!spaceSnap.exists) throw new HttpsError('not-found', '스페이스를 찾을 수 없습니다.');
    if (!userSnap.exists || userSnap.data().spaceId !== spaceId) {
      throw new HttpsError('permission-denied', '현재 참여 중인 스페이스가 아닙니다.');
    }
    const members = (spaceSnap.data().members || []).filter(memberUid => memberUid !== uid);
    tx.update(spaceRef, {
      members,
      [`memberProfiles.${uid}`]: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(userRef, { spaceId: null }, { merge: true });
  });
  return { ok: true };
});

// ── 한국 공휴일(공공데이터포털 특일 정보) 조회 ──────────────────────────
// 인증키는 서버에만 두고, 결과는 Firestore(caches/holidays_{year})에 캐싱한다.
const HOLIDAY_API_KEY = process.env.HOLIDAY_API_KEY;
const HOLIDAY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 올해·미래 연도는 7일마다 갱신(대체공휴일 지정 반영)

exports.getHolidays = onCall({ region: 'asia-northeast3' }, async request => {
  const year = Number(request.data && request.data.year);
  if (!Number.isInteger(year) || year < 2004 || year > 2100) {
    throw new HttpsError('invalid-argument', '연도가 올바르지 않습니다.');
  }
  if (!HOLIDAY_API_KEY) {
    logger.error('HOLIDAY_API_KEY is missing. Set it in functions/.env.');
    throw new HttpsError('failed-precondition', '공휴일 API 키가 설정되지 않았습니다.');
  }

  const cacheRef = db.collection('caches').doc(`holidays_${year}`);
  const cacheSnap = await cacheRef.get();
  const currentYear = new Date().getFullYear();
  if (cacheSnap.exists) {
    const cached = cacheSnap.data() || {};
    const fresh = year < currentYear || (Date.now() - Number(cached.fetchedAt || 0) < HOLIDAY_CACHE_TTL_MS);
    if (fresh && Array.isArray(cached.holidays)) {
      return { year, holidays: cached.holidays };
    }
  }

  const holidays = await fetchHolidaysForYear(year);
  await cacheRef.set({ holidays, fetchedAt: Date.now(), updatedAt: FieldValue.serverTimestamp() });
  return { year, holidays };
});

async function fetchHolidaysForYear(year) {
  const url = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
    + `?serviceKey=${HOLIDAY_API_KEY}&solYear=${year}&numOfRows=100&_type=json`;

  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (error) {
    logger.error('Holiday API request failed', { year, message: error.message });
    throw new HttpsError('unavailable', '공휴일 정보를 불러오지 못했습니다.');
  }

  const body = json && json.response && json.response.body;
  const rawItems = body && body.items && body.items.item;
  const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);

  return items
    .filter(it => String(it.isHoliday).toUpperCase() === 'Y')
    .map(it => {
      const s = String(it.locdate); // YYYYMMDD
      return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, name: String(it.dateName || '공휴일') };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── 일정을 '배우자와 공유'하면 상대방(배우자) 기기에 즉시 푸시 알림 ──
exports.notifyScheduleShared = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const uid = request.auth.uid;
  const token = request.auth.token || {};
  const text = String((request.data && request.data.text) || '').trim().slice(0, 120);
  const dayKey = String((request.data && request.data.dayKey) || '').trim();
  const url = /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? `/?date=${dayKey}` : '/';

  // 공유한 사람의 스페이스 → 배우자(다른 멤버) 찾기
  const userSnap = await db.collection('users').doc(uid).get();
  const spaceId = userSnap.exists ? (userSnap.data() || {}).spaceId : null;
  if (!spaceId) return { sent: 0, recipients: 0 };

  const spaceSnap = await db.collection('spaces').doc(spaceId).get();
  if (!spaceSnap.exists) return { sent: 0, recipients: 0 };
  const spaceMembers = (spaceSnap.data() || {}).members;
  if (!Array.isArray(spaceMembers) || !spaceMembers.includes(uid)) {
    throw new HttpsError('permission-denied', '현재 참여 중인 스페이스가 아닙니다.');
  }
  const members = spaceMembers.filter(m => m && m !== uid);
  if (!members.length) return { sent: 0, recipients: 0 };

  const sharerName = token.name || '배우자';
  let sent = 0;
  for (const memberUid of members) {
    const result = await sendReminderToUser(memberUid, {
      title: '👫 배우자가 일정을 공유했어요',
      body: text ? `${sharerName}: ${text}` : `${sharerName}님이 새 일정을 공유했어요.`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `share-${spaceId}-${dayKey}-${text}`.slice(0, 120),
      url
    });
    sent += result.sent;
  }
  return { sent, recipients: members.length };
});

exports.notifySharedDiaryEntry = onCall({ region: 'asia-northeast3', timeoutSeconds: 60 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const authorUid = request.auth.uid;
  const spaceId = String(request.data && request.data.spaceId || '').trim().toUpperCase();
  const dayKey = String(request.data && request.data.dayKey || '').trim();
  if (!/^[A-HJ-KM-NP-Z2-9]{6}$/.test(spaceId) || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new HttpsError('invalid-argument', '스페이스 또는 날짜가 올바르지 않습니다.');
  }
  const spaceRef = db.collection('spaces').doc(spaceId);
  const spaceSnap = await spaceRef.get();
  const space = spaceSnap.exists ? spaceSnap.data() || {} : {};
  if (!Array.isArray(space.members) || !space.members.includes(authorUid)) {
    throw new HttpsError('permission-denied', '현재 참여 중인 스페이스가 아닙니다.');
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new HttpsError('failed-precondition', '푸시 알림 설정이 필요합니다.');
  }
  const recipients = [...new Set(space.members.filter(uid => typeof uid === 'string' && uid && uid !== authorUid))];
  let sent = 0;
  let attempted = 0;
  for (const recipientUid of recipients) {
    const notificationId = createHash('sha256')
      .update(JSON.stringify([spaceId, dayKey, authorUid, recipientUid]))
      .digest('hex');
    // Unmatched top-level collection: Firestore rules deny all client access.
    const deliveryRef = db.collection('diaryNotificationDeliveries').doc(notificationId);
    // 교환일기는 월별 문서(spaces/{id}/diaryMonths/{YYYY-MM})로 옮겨졌을 수 있다.
    // 전환 전후 어느 쪽 화면에서 저장해도 알림이 가도록 새 위치를 먼저 보고, 없으면 예전 위치를 본다.
    const monthRef = spaceRef.collection('diaryMonths').doc(dayKey.slice(0, 7));
    const claimed = await db.runTransaction(async tx => {
      const [delivery, currentSpace, monthSnap] = await Promise.all([tx.get(deliveryRef), tx.get(spaceRef), tx.get(monthRef)]);
      if (delivery.exists || !currentSpace.exists) return false;
      const current = currentSpace.data() || {};
      if (!Array.isArray(current.members) || !current.members.includes(authorUid) || !current.members.includes(recipientUid)) return false;
      const monthEntries = monthSnap.exists ? ((monthSnap.data() || {}).entries || {}) : {};
      const entry = (monthEntries[dayKey] && monthEntries[dayKey][authorUid])
        || (current.sharedDiary && current.sharedDiary[dayKey] && current.sharedDiary[dayKey][authorUid]);
      if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) return false;
      if (entry.authorUid !== undefined && entry.authorUid !== authorUid) return false;
      tx.create(deliveryRef, {
        spaceId, dayKey, authorUid, recipientUid,
        status: 'attempted', attemptedAt: FieldValue.serverTimestamp()
      });
      return true;
    });
    if (!claimed) continue;
    attempted += 1;
    // Claim before sending: duplicate calls never retry an uncertain delivery.
    try {
      const result = await sendReminderToUser(recipientUid, {
        title: 'Minb 교환일기',
        body: '새 교환일기가 도착했어요. 함께 확인해 보세요.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `diary-${notificationId}`,
        url: '/shared-diary'
      });
      sent += result.sent;
      await deliveryRef.update({
        status: result.sent > 0 ? 'sent' : 'not-sent',
        sent: result.sent,
        finishedAt: FieldValue.serverTimestamp()
      });
    } catch (error) {
      logger.error('Shared diary push attempt failed; delivery will not be retried', {
        notificationId, message: error.message
      });
    }
  }
  return { sent, recipients: attempted };
});

async function sendReminderToUser(uid, payload) {
  if (!uid) return { sent: 0 };

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { sent: 0 };

  const subscriptions = userSnap.data().pushSubscriptions || {};
  const deleteUpdates = {};
  let sent = 0;

  for (const [id, subscription] of Object.entries(subscriptions)) {
    if (!subscription || !subscription.endpoint || !subscription.keys) continue;
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      const statusCode = error.statusCode || error.status;
      if (statusCode === 404 || statusCode === 410) {
        deleteUpdates[`pushSubscriptions.${id}`] = FieldValue.delete();
      } else {
        logger.warn('Push send failed', { uid, statusCode, message: error.message });
      }
    }
  }

  if (Object.keys(deleteUpdates).length) {
    await userRef.update(deleteUpdates);
  }

  return { sent };
}
