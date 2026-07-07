/* DeepFle Service Worker — 오프라인 지원 + 정적 자원 캐싱 (PWA) */
const CACHE = 'deepfle-v2';
const ASSETS = [
  './deepfle-dashboard.html',
  './manifest.json',
  './deepfle-icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API 호출은 항상 네트워크 우선 (실시간 데이터)
  if (url.pathname.startsWith('/api') || url.port === '5050') {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({error: '오프라인 — 네트워크 연결을 확인하세요'}),
        {status: 503, headers: {'Content-Type': 'application/json'}})
    ));
    return;
  }
  // HTML 문서는 network-first (코드 수정 즉시 반영, 오프라인 시 캐시 폴백)
  if (e.request.mode === 'navigate' || (e.request.destination === 'document') ||
      url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)); }
        return res;
      }).catch(() => caches.match(e.request).then((c) => c || caches.match('./deepfle-dashboard.html')))
    );
    return;
  }
  // 그 외 정적 자원은 캐시 우선
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (e.request.method === 'GET' && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('./deepfle-dashboard.html')))
  );
});
