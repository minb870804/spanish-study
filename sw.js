// Minb 서비스워커 — 푸시 알림 + 정적 자산 캐싱
//
// 중요: 페이지 이동(HTML)은 절대 가로채지 않는다.
// 호스팅이 cleanUrls로 /index.html → / 308 리다이렉트를 하는데,
// 리다이렉트된 응답은 navigation 요청에 사용할 수 없어 페이지가 열리지 않는다(ERR_FAILED).
// HTML은 브라우저 기본 캐시에 맡기고, 여기서는 용량이 큰 정적 자산만 캐시해
// 앱 재실행 시 Firebase SDK·폰트·이모지를 네트워크에서 다시 받지 않게 한다.
// 데이터(Firestore)는 SDK 자체 오프라인 캐시가 처리하므로 건드리지 않는다.

const CACHE_VERSION = 'minb-assets-v2';

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

// 캐시해도 되는 같은 출처 자산(아이콘·매니페스트 등). HTML은 제외한다.
function isCacheableSameOrigin(pathname) {
  return /\.(png|svg|ico|webp|jpg|jpeg|woff2?|json)$/i.test(pathname) && pathname !== '/sw.js';
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 이전 버전(HTML을 캐시했던 v1) 캐시를 모두 지워 확실히 정상화한다.
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// 캐시를 먼저 주고, 뒤에서 새 버전을 받아 캐시를 갱신한다(stale-while-revalidate).
// 어떤 경우에도 네트워크 응답을 그대로 돌려주도록 해 앱이 멈추지 않게 한다.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  if (cached) {
    // 백그라운드 갱신(실패는 무시)
    fetch(request).then(res => {
      if (res && (res.ok || res.type === 'opaque') && !res.redirected) {
        cache.put(request, res.clone()).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }

  const res = await fetch(request);
  // 리다이렉트된 응답은 캐시하지 않는다(재사용 시 문제가 될 수 있다).
  if (res && (res.ok || res.type === 'opaque') && !res.redirected) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // 페이지 이동은 손대지 않는다 — 항상 브라우저·네트워크가 처리한다.
  if (req.mode === 'navigate' || req.destination === 'document') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (isApiHost(url.hostname)) return;

  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin ? isCacheableSameOrigin(url.pathname) : CACHEABLE_HOSTS.has(url.hostname);
  if (!cacheable) return;

  // 실패 시에도 일반 네트워크 요청으로 되돌아가도록 폴백을 둔다.
  event.respondWith(cacheFirst(req).catch(() => fetch(req)));
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
