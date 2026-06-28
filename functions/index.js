const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
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
    const spacesSnap = await db.collection('spaces').get();
    let scanned = 0;
    let due = 0;
    let sent = 0;
    let skipped = 0;

    for (const spaceDoc of spacesSnap.docs) {
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
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
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

    logger.info('Todo reminder scan finished', { scanned, due, sent, skipped });
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
