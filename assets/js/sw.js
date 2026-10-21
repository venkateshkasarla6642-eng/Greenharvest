// assets/js/sw.js — GreenHarvest PWA Service Worker v4
// High-performance Stale-While-Revalidate for static assets; never caches private/auth/API data.

const CACHE_NAME = 'gh-shell-v4';

// Static assets to pre-cache (app shell)
const SHELL_ASSETS = [
  '/',
  '/assets/css/styles.css',
  '/assets/js/app.js',
  '/pay/assets/pay-checkout.css',
  '/pay/assets/pay-checkout.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/favicon.png',
  '/manifest.webmanifest'
];

// API routes — NEVER cache these
const NO_CACHE_PATTERNS = [
  /\/api\.php/,
  /\/seed\.php/,
  /\/pay\/api\.php/,
  /\/pay\/webhook\.php/,
  /action=/,
  /token=/,
  /session/,
  /login/,
  /logout/,
  /register/,
  /order/,
  /payment/,
  /cart/,
  /checkout/
];

// ─── INSTALL: Pre-cache app shell ─────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Shell pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: Clean up old caches ────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH: Intelligent Caching Strategy ──────────
// - API & Dynamic routes: Network only (never cached).
// - Navigation / HTML: Network-first with cache fallback.
// - Static assets (CSS, JS, Icons): Stale-While-Revalidate for instant repeat loads.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Never intercept API / auth / sensitive routes
  const isPrivate = NO_CACHE_PATTERNS.some((p) => p.test(url.href));
  if (isPrivate) return;

  // Navigation requests: Network first, fallback to cached shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || new Response('', { status: 503 })))
    );
    return;
  }

  // Static Assets (CSS, JS, Images, Icons): Stale-While-Revalidate
  const isStatic = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pay/assets/') || url.pathname.endsWith('.webmanifest');
  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => null);

        // Return cached version immediately if available, otherwise wait for network
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Default fallback
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
