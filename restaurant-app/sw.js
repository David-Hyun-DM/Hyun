const CACHE = 'matzip-v2';
const ASSETS = ['./index.html', './style.css', './app.js', './icon.svg', './manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // 카카오 API 요청은 캐시 제외
    if (e.request.url.includes('dapi.kakao.com') || e.request.url.includes('map.kakao.com')) return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('./index.html')))
    );
});
