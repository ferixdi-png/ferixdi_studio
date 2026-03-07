// FERIXDI Studio — Service Worker v1
// Strategy: stale-while-revalidate for static assets; skip API routes

const CACHE_NAME = 'ferixdi-v2';
const STATIC_ASSETS = [
  '/', '/index.html', '/main.js', '/engine/generator.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and API requests — always network
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network-first for HTML
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Stale-while-revalidate for JS/JSON/assets
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const fetched = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    )
  );
});
