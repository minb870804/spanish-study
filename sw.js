// Minb 서비스워커 — 푸시 알림 + 앱 셸 캐싱
// 캐싱 목적: 앱을 다시 열 때 HTML·SDK를 네트워크에서 다시 받지 않고 즉시 화면을 띄운다.
// 데이터(Firestore)는 여기서 건드리지 않는다. SDK가 자체 오프라인 캐시로 처리한다.

const CACHE_VERSION = 'minb-shell-v1';

// 미리 받아둘 앱 셸. 실패해도 설치는 계속 진행한다(개별 요청으로 처리).
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png'
];

// 캐시해도 안전한 외부 호스트 — URL에 버전이 박혀 있어 내용이 바뀌지 않는다.
const CACHEABLE_HOSTS = new Set([
  'www.gstatic.com',        // Firebase SDK
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'        // Twemoji
]);

// 절대 가로채면 안 되는 호스트 — 인증·DB·서버 함수는 항상 네트워크로.
function isApiHost(hostname) {
  return hostname.endsWith('googleapis.com') && !hostname.startsWith('fonts.')
    || hostname.endsWith('cloudfunctions.net')
    || hostname.endsWith('firebaseio.com')
    || hostname.endsWith('firebaseapp.com');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(PRECACHE_URLS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// 캐시를 먼저 주고, 뒤에서 새 버전을 받아 캐시를 갱신한다(stale-while-revalidate).
async function staleWhileRevalidate(request, notifyOnChange) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });

  const networkUpdate = fetch(request).then(async (res) => {
    // opaque(type:'opaque')는 status가 0이라 res.ok가 false다.
    // 폰트·이모지 같은 cross-origin 이미지도 캐시해야 재실행 시 요청이 줄어든다.
    if (!res || (!res.ok && res.type !== 'opaque')) return null;
    const copy = res.clone();
    // HTML이 실제로 바뀌었을 때만 새 버전 안내(매 실행마다 알리면 시끄럽다)
    if (notifyOnChange && cached) {
      try {
        const [oldText, newText] = await Promise.all([cached.clone().text(), res.clone().text()]);
        if (oldText !== newText) {
          const clientList = await self.clients.matchAll({ type: 'window' });
          clientList.forEach(c => c.postMessage({ type: 'shell-updated' }));
        }
      } catch (e) {}
    }
    await cache.put(request, copy);
    return res;
  }).catch(() => null);

  if (cached) return cached;            // 즉시 표시
  const fresh = await networkUpdate;    // 첫 방문은 네트워크를 기다림
  return fresh || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isApiHost(url.hostname)) return;  // 인증·DB·함수는 그대로 통과

  // 페이지 이동(앱 실행) — 캐시된 HTML로 즉시 띄우고 뒤에서 갱신
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(new Request('/index.html'), true));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname === '/sw.js') return; // 워커 자신은 캐시하지 않는다

  if (sameOrigin || CACHEABLE_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, false));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Minb 알림', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Minb 할 일 알림';
  const options = {
    body: data.body || '확인할 할 일이 있어요.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'minb-todo-reminder',
    data: { url: data.url || '/' },
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return clients.openWindow(targetUrl);
  })());
});
