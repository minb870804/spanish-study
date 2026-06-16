const { onSchedule } = require('firebase-functions/v2/scheduler');
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

    logger.info('Todo reminder scan finished', { scanned, due, sent, skipped });
  }
);

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
