const CACHE_NAME = 'raga-live-cache-v4';
const BASE = self.registration.scope.endsWith('/') ? self.registration.scope : self.registration.scope + '/';
const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'app.js?v=4',
  BASE + 'worklet-processor.js',
  BASE + 'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => { if (k !== CACHE_NAME) return caches.delete(k); })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const isHTMLRequest = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHTMLRequest) {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return resp;
    }))
  );
});


