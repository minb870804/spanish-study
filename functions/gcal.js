// ── 구글 캘린더 자동 연동 (minb → 구글, 한 방향) ──
//
// 설정에서 '구글 캘린더 연결'을 누르면 구글 동의 화면을 거쳐 googleCalendarOAuth 로 돌아온다.
// 그때 구글 계정에 'minb 개인', 'minb 공유' 캘린더를 만들고, 이후 일정이 저장될 때마다
// Firestore 트리거가 바뀐 달(또는 반복 일정 목록)만 다시 맞춘다.
//
//   googleCalendarLinks/{uid}               연결 정보(갱신 토큰 포함). 규칙에 없어 앱에서는 읽을 수 없다.
//   googleCalendarLinks/{uid}/synced/{id}   구글에 넣은 이벤트마다 { unit, calendarId, hash }
//   googleCalendarOAuthStates/{nonce}       동의 화면을 오가는 동안만 쓰는 1회용 표
//   users/{uid}.googleCalendar              앱 화면에 보여 줄 연결 상태(토큰 없음)
//
// '맞추기' 단위(unit)는 개인/공유 × 월별 문서 하나 또는 반복 일정 목록이다. 단위마다 원하는 이벤트를
// 처음부터 다시 계산해 바뀐 것만 보내고, 사라진 것은 지운다. 그래서 같은 변경이 두 번 와도 안전하다.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
// firebase-admin v14 모듈러 API 사용
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { randomBytes } = require('node:crypto');
const { monthEvents, recurringEvents, hashOf, kstTodayKey } = require('./gcal-events');

const db = getFirestore();
const REGION = 'asia-northeast3';
const PROJECT = process.env.GCLOUD_PROJECT || 'minb-spanish-study';
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || `https://${REGION}-${PROJECT}.cloudfunctions.net/googleCalendarOAuth`;
const APP_URL = process.env.MINB_APP_URL || 'https://minb87.vercel.app';
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const STATE_TTL_MS = 15 * 60 * 1000;
const CALENDARS = { personal: 'minb 개인', shared: 'minb 공유' };

const linkRef = uid => db.collection('googleCalendarLinks').doc(uid);
const syncedCol = uid => linkRef(uid).collection('synced');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

class GoogleError extends Error {
  constructor(status, json) {
    super(`Google API ${status}: ${(json && json.error && (json.error.message || json.error)) || ''}`);
    this.status = status;
    this.json = json;
  }
}

// ── 토큰·API ──

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(res.status, json);
  return json;
}

// 한 번의 실행 안에서 쓰는 접근 도구. 토큰이 막혔으면 연결 상태를 '다시 연결 필요'로 바꾼다.
function client(uid, link) {
  let accessToken = null;
  async function refresh() {
    try {
      accessToken = (await tokenRequest({ grant_type: 'refresh_token', refresh_token: link.refreshToken })).access_token;
    } catch (error) {
      if (error.status === 400 || error.status === 401) await markBroken(uid, '구글 연결이 해제되었거나 만료되었어요. 다시 연결해 주세요.');
      throw error;
    }
  }
  async function call(method, path, body) {
    if (!accessToken) await refresh();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(CAL_API + path, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.status === 204) return null;
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      if (res.status === 401 && attempt === 0) { await refresh(); continue; }
      const reason = json && json.error && json.error.errors && json.error.errors[0] && json.error.errors[0].reason;
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|userRateLimit/i.test(reason || ''));
      if (retryable && attempt < 5) { await sleep(500 * 2 ** attempt + Math.random() * 300); continue; }
      throw new GoogleError(res.status, json);
    }
  }
  return { call };
}

async function markBroken(uid, message) {
  await Promise.all([
    linkRef(uid).set({ status: 'broken', lastError: message, lastErrorAt: FieldValue.serverTimestamp() }, { merge: true }),
    db.collection('users').doc(uid).set({ googleCalendar: { needsReconnect: true } }, { merge: true })
  ]);
}

async function createCalendar(api, summary) {
  const cal = await api.call('POST', '/calendars', { summary, timeZone: 'Asia/Seoul', description: 'minb 앱 일정이 자동으로 들어오는 캘린더예요. 여기서 고친 내용은 minb 앱에 반영되지 않아요.' });
  return cal.id;
}

// ── 맞추기 ──

// 이벤트 하나를 원하는 모양으로 만든다. 지운 적 있는 id도 update 로 되살아난다.
async function putEvent(api, calendarId, id, body) {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events/${id}`;
  try {
    return await api.call('PUT', path, body);
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
  try {
    return await api.call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, { ...body, id });
  } catch (error) {
    if (error.status === 409) return api.call('PUT', path, body); // 동시에 다른 실행이 먼저 만든 경우
    throw error;
  }
}

async function deleteEvent(api, calendarId, id) {
  try {
    await api.call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${id}`);
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
}

// unit 하나를 desired({id: body})에 맞춘다. existing 을 넘기지 않으면 Firestore 에서 읽는다.
async function reconcileUnit(uid, api, unit, calendarId, desired, existing) {
  if (!existing) {
    const snap = await syncedCol(uid).where('unit', '==', unit).get();
    existing = new Map(snap.docs.map(d => [d.id, d.data()]));
  }
  const stats = { put: 0, deleted: 0 };
  for (const [id, body] of Object.entries(desired)) {
    const hash = hashOf(body);
    const prev = existing.get(id);
    if (prev && prev.hash === hash && prev.calendarId === calendarId) continue;
    if (prev && prev.calendarId && prev.calendarId !== calendarId) await deleteEvent(api, prev.calendarId, id);
    await putEvent(api, calendarId, id, body);
    await syncedCol(uid).doc(id).set({ unit, calendarId, hash, syncedAt: Date.now() });
    stats.put += 1;
  }
  for (const [id, prev] of existing) {
    if (desired[id]) continue;
    await deleteEvent(api, prev.calendarId || calendarId, id);
    await syncedCol(uid).doc(id).delete();
    stats.deleted += 1;
  }
  return stats;
}

// 연결된 사용자의 공유 공간(멤버일 때만)
async function currentSpaceId(uid) {
  const user = (await db.collection('users').doc(uid).get()).data() || {};
  if (!user.spaceId) return null;
  const space = (await db.collection('spaces').doc(user.spaceId).get()).data() || {};
  return Array.isArray(space.members) && space.members.includes(uid) ? user.spaceId : null;
}

async function activeLink(uid) {
  const snap = await linkRef(uid).get();
  const link = snap.exists ? snap.data() : null;
  return link && link.refreshToken && link.status !== 'broken' && link.calendars ? link : null;
}

// 바뀐 단위 하나만 연결된 사용자(들)에게 반영한다.
async function syncUnitFor(uids, unitOf, desiredOf) {
  for (const uid of uids) {
    const link = await activeLink(uid);
    if (!link) continue;
    const { unit, kind } = unitOf;
    const calendarId = link.calendars[kind];
    try {
      const stats = await reconcileUnit(uid, client(uid, link), unit, calendarId, desiredOf());
      if (stats.put || stats.deleted) logger.info('Google Calendar unit synced', { uid, unit, ...stats });
    } catch (error) {
      await handleSyncError(uid, link, error, unit);
    }
  }
}

async function handleSyncError(uid, link, error, unit) {
  logger.error('Google Calendar sync failed', { uid, unit, status: error.status, message: error.message });
  // 사용자가 구글에서 캘린더를 지웠으면 새로 만들어 전부 다시 넣는다.
  if (error.status === 404 && link) {
    try {
      const api = client(uid, link);
      const calendars = { ...link.calendars };
      let recreated = false;
      for (const kind of Object.keys(CALENDARS)) {
        try { await api.call('GET', `/calendars/${encodeURIComponent(calendars[kind])}`); } catch (e) {
          if (e.status !== 404) throw e;
          calendars[kind] = await createCalendar(api, CALENDARS[kind]);
          recreated = true;
        }
      }
      if (recreated) {
        await db.recursiveDelete(syncedCol(uid));
        await linkRef(uid).set({ calendars, syncRequestedAt: Date.now() }, { merge: true });
        return;
      }
    } catch (e) {
      logger.error('Google Calendar recreate failed', { uid, message: e.message });
    }
  }
  if (error.status !== 400 && error.status !== 401) {
    await linkRef(uid).set({ lastError: String(error.message).slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

// 처음 연결했을 때와 '다시 맞추기' 때: 모든 단위를 맞추고, 더는 없는 단위(나간 공간 등)의 이벤트는 지운다.
async function fullSync(uid, link) {
  const api = client(uid, link);
  const today = kstTodayKey();
  const all = await syncedCol(uid).get();
  const byUnit = new Map();
  for (const d of all.docs) {
    const unit = d.get('unit');
    if (!byUnit.has(unit)) byUnit.set(unit, new Map());
    byUnit.get(unit).set(d.id, d.data());
  }
  const units = [];
  const user = (await db.collection('users').doc(uid).get()).data() || {};
  units.push({ unit: `user:${uid}:recurring`, kind: 'personal', desired: recurringEvents(`user:${uid}`, user.personalRecurring, today) });
  for (const doc of (await db.collection('users').doc(uid).collection('dayMonths').get()).docs) {
    units.push({ unit: `user:${uid}:month:${doc.id}`, kind: 'personal', desired: monthEvents(`user:${uid}`, doc.get('entries')) });
  }
  const spaceId = await currentSpaceId(uid);
  if (spaceId) {
    const space = (await db.collection('spaces').doc(spaceId).get()).data() || {};
    units.push({ unit: `space:${spaceId}:recurring`, kind: 'shared', desired: recurringEvents(`space:${spaceId}`, space.recurring, today) });
    for (const doc of (await db.collection('spaces').doc(spaceId).collection('dayMonths').get()).docs) {
      units.push({ unit: `space:${spaceId}:month:${doc.id}`, kind: 'shared', desired: monthEvents(`space:${spaceId}`, doc.get('entries')) });
    }
  }
  const totals = { put: 0, deleted: 0, events: 0 };
  for (const { unit, kind, desired } of units) {
    const stats = await reconcileUnit(uid, api, unit, link.calendars[kind], desired, byUnit.get(unit) || new Map());
    byUnit.delete(unit);
    totals.put += stats.put; totals.deleted += stats.deleted; totals.events += Object.keys(desired).length;
  }
  for (const [unit, existing] of byUnit) {
    const stats = await reconcileUnit(uid, api, unit, null, {}, existing);
    totals.deleted += stats.deleted;
  }
  return totals;
}

// ── 트리거 ──

const triggerOpts = path => ({ document: path, region: REGION, timeoutSeconds: 300, memory: '256MiB' });

exports.gcalSyncUserMonth = onDocumentWritten(triggerOpts('users/{uid}/dayMonths/{month}'), async event => {
  const { uid, month } = event.params;
  const after = event.data.after.exists ? event.data.after.data() : {};
  if (event.data.before.exists && same(event.data.before.get('entries'), after.entries)) return;
  await syncUnitFor([uid], { unit: `user:${uid}:month:${month}`, kind: 'personal' }, () => monthEvents(`user:${uid}`, after.entries));
});

exports.gcalSyncSpaceMonth = onDocumentWritten(triggerOpts('spaces/{spaceId}/dayMonths/{month}'), async event => {
  const { spaceId, month } = event.params;
  const after = event.data.after.exists ? event.data.after.data() : {};
  if (event.data.before.exists && same(event.data.before.get('entries'), after.entries)) return;
  const members = (await db.collection('spaces').doc(spaceId).get()).get('members') || [];
  const uids = [];
  for (const uid of members) if (await currentSpaceId(uid) === spaceId) uids.push(uid);
  await syncUnitFor(uids, { unit: `space:${spaceId}:month:${month}`, kind: 'shared' }, () => monthEvents(`space:${spaceId}`, after.entries));
});

exports.gcalSyncUserDoc = onDocumentWritten(triggerOpts('users/{uid}'), async event => {
  const { uid } = event.params;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.exists ? event.data.after.data() : {};
  if (!same(before.spaceId, after.spaceId)) {
    // 공간을 옮기면 공유 캘린더 내용이 통째로 바뀐다 → 전체 다시 맞추기
    const link = await activeLink(uid);
    if (link) await linkRef(uid).set({ syncRequestedAt: Date.now() }, { merge: true });
    return;
  }
  if (same(before.personalRecurring, after.personalRecurring)) return;
  await syncUnitFor([uid], { unit: `user:${uid}:recurring`, kind: 'personal' }, () => recurringEvents(`user:${uid}`, after.personalRecurring, kstTodayKey()));
});

exports.gcalSyncSpaceDoc = onDocumentWritten(triggerOpts('spaces/{spaceId}'), async event => {
  const { spaceId } = event.params;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.exists ? event.data.after.data() : {};
  if (same(before.recurring, after.recurring)) return;
  const uids = [];
  for (const uid of after.members || []) if (await currentSpaceId(uid) === spaceId) uids.push(uid);
  await syncUnitFor(uids, { unit: `space:${spaceId}:recurring`, kind: 'shared' }, () => recurringEvents(`space:${spaceId}`, after.recurring, kstTodayKey()));
});

// 연결 직후·'다시 맞추기' 요청 때 전체를 맞춘다.
exports.gcalFullSync = onDocumentWritten({ ...triggerOpts('googleCalendarLinks/{uid}'), timeoutSeconds: 540 }, async event => {
  const { uid } = event.params;
  if (!event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data();
  if (!after.syncRequestedAt || before.syncRequestedAt === after.syncRequestedAt) return;
  const link = await activeLink(uid);
  if (!link) return;
  try {
    const totals = await fullSync(uid, link);
    logger.info('Google Calendar full sync finished', { uid, ...totals });
    await Promise.all([
      linkRef(uid).set({ lastFullSyncAt: Date.now(), lastError: FieldValue.delete() }, { merge: true }),
      db.collection('users').doc(uid).set({ googleCalendar: { lastFullSyncAt: Date.now(), syncedEvents: totals.events } }, { merge: true })
    ]);
  } catch (error) {
    await handleSyncError(uid, link, error, 'full');
  }
});

// ── 연결·해제 ──

function requireConfig() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    logger.error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are missing. Set them in functions/.env.');
    throw new HttpsError('failed-precondition', '구글 캘린더 연동 설정이 아직 준비되지 않았어요.');
  }
}

exports.googleCalendarConnectUrl = onCall({ region: REGION }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  requireConfig();
  const nonce = randomBytes(24).toString('hex');
  await db.collection('googleCalendarOAuthStates').doc(nonce).set({ uid: request.auth.uid, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: `openid email ${SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: nonce
  });
  if (request.auth.token && request.auth.token.email) params.set('login_hint', request.auth.token.email);
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
});

function backToApp(res, result) {
  res.redirect(302, `${APP_URL}/?gcal=${encodeURIComponent(result)}#settings`);
}

exports.googleCalendarOAuth = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  const nonce = String(req.query.state || '');
  if (!/^[0-9a-f]{48}$/.test(nonce)) return backToApp(res, 'error');
  const stateRef = db.collection('googleCalendarOAuthStates').doc(nonce);
  const state = await db.runTransaction(async tx => {
    const snap = await tx.get(stateRef);
    if (!snap.exists) return null;
    tx.delete(stateRef);
    return snap.data();
  });
  if (!state || Date.now() - state.createdAt > STATE_TTL_MS) return backToApp(res, 'expired');
  if (req.query.error || !req.query.code) return backToApp(res, 'cancelled');
  const uid = state.uid;
  try {
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: REDIRECT_URI });
    if (!String(tokens.scope || '').split(' ').includes(SCOPE)) return backToApp(res, 'scope');
    if (!tokens.refresh_token) return backToApp(res, 'error');
    let email = '';
    try { email = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1], 'base64url').toString()).email || ''; } catch (e) {}

    // 예전에 연결했던 캘린더가 같은 구글 계정에 남아 있으면 그대로 쓴다.
    const prev = (await linkRef(uid).get()).data() || {};
    const link = { refreshToken: tokens.refresh_token, calendars: {} };
    const api = client(uid, link);
    const reuse = prev.calendars && prev.email === email;
    for (const kind of Object.keys(CALENDARS)) {
      let id = reuse ? prev.calendars[kind] : null;
      if (id) {
        try { await api.call('GET', `/calendars/${encodeURIComponent(id)}`); } catch (e) { if (e.status !== 404) throw e; id = null; }
      }
      link.calendars[kind] = id || await createCalendar(api, CALENDARS[kind]);
    }
    if (!reuse) await db.recursiveDelete(syncedCol(uid));
    await linkRef(uid).set({
      ...link, email, status: 'active', connectedAt: Date.now(), syncRequestedAt: Date.now(),
      lastError: FieldValue.delete()
    }, { merge: true });
    await db.collection('users').doc(uid).set({ googleCalendar: { connected: true, email, connectedAt: Date.now(), needsReconnect: FieldValue.delete() } }, { merge: true });
    return backToApp(res, 'connected');
  } catch (error) {
    logger.error('Google Calendar OAuth failed', { uid, status: error.status, message: error.message });
    return backToApp(res, 'error');
  }
});

exports.googleCalendarResync = onCall({ region: REGION }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const link = await activeLink(request.auth.uid);
  if (!link) throw new HttpsError('failed-precondition', '구글 캘린더를 먼저 연결해 주세요.');
  await linkRef(request.auth.uid).set({ syncRequestedAt: Date.now() }, { merge: true });
  return { ok: true };
});

// 연결 해제: 토큰을 폐기하고 동기화를 멈춘다. 구글에 만든 캘린더는 남겨 두므로 필요하면 구글에서 지운다.
exports.googleCalendarDisconnect = onCall({ region: REGION }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const uid = request.auth.uid;
  const snap = await linkRef(uid).get();
  const token = snap.exists && snap.get('refreshToken');
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    } catch (error) {
      logger.warn('Google token revoke failed', { uid, message: error.message });
    }
  }
  await db.recursiveDelete(linkRef(uid));
  await db.collection('users').doc(uid).set({ googleCalendar: FieldValue.delete() }, { merge: true });
  return { ok: true };
});
