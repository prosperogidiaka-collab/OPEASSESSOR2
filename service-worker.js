const CACHE_NAME = 'ope-assessor-v57';

// Same-origin app shell. These are cached one-by-one (not via cache.addAll, which
// is all-or-nothing — one bad URL would wipe the whole precache).
const APP_SHELL_URLS = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './style.css',
  './manifest.json',
  './summary-preview.png',
  './ope-icon-192.png',
  './ope-icon-512.png'
];

// Cross-origin assets loaded by index.html (the Tailwind CDN script). These must
// be fetched with mode: 'no-cors' — a plain fetch()/cache.add() fails with a
// CORS error because the CDN sends no Access-Control-Allow-Origin header. The
// resulting opaque response can still be served back for the matching <script src>.
const CROSS_ORIGIN_PRECACHE_URLS = [
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(APP_SHELL_URLS.map((url) => cache.add(url)));
      await Promise.allSettled(
        CROSS_ORIGIN_PRECACHE_URLS.map((url) =>
          fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isApiRequest = requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith('/api/');
  const isAppShellAsset = requestUrl.origin === self.location.origin && (
    requestUrl.pathname.endsWith('/config.js') ||
    requestUrl.pathname.endsWith('/app.js') ||
    requestUrl.pathname.endsWith('/style.css') ||
    requestUrl.pathname.endsWith('/index.html')
  );

  if (isApiRequest) {
    // Don't touch /api/* at all — the page owns all sync behaviour now (manual
    // only, with its own bounded retries). No SW-level fetch, no retry, and no
    // synthetic 503 response that used to masquerade as a backend outage.
    return;
  }

  if (isAppShellAsset) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      }).catch(() => caches.match(event.request).then((response) => response || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only re-cache full, same-origin basic responses (skip 206 range
        // responses, opaque cross-origin responses, errors, etc.).
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      }).catch(() => {
        // Offline: only navigations should fall back to the cached shell —
        // returning index.html for an image/script request just breaks it.
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html').then((shell) => shell || Response.error());
        }
        return Response.error();
      });
    })
  );
});
