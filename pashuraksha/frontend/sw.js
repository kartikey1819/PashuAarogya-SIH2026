/* PashuRaksha service worker — offline shell (FR-20).
   Strategy: network-first for same-origin shell assets (always fresh during
   demos), falling back to cache when offline. API calls: network-only — the
   report queue in api.js handles offline writes. */
const CACHE = 'pashuraksha-v4';
const SHELL = ['/', '/index.html', '/farmer.html', '/vet.html', '/gov.html',
               '/ivr.html', '/css/app.css', '/css/gov.css', '/js/api.js',
               '/js/i18n.js', '/js/farmer.js', '/js/vet.js', '/js/gov.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;           // network-only
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;             // let CDN/tiles pass
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match('/index.html')))
  );
});
