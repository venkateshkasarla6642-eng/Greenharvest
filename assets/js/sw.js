// assets/js/sw.js — GreenHarvest PWA Service Worker v2
// Caches static assets for offline shell; never caches auth/API/private data.
// Updated: icons now correctly sized (192, 512) — cache version bumped.

const CACHE_NAME = 'gh-shell-v2';

// Static assets to pre-cache (app shell)
const SHELL_ASSETS = [
  '/',
  '/assets/css/styles.css',
  '/assets/js/app.js',
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

// ─── FETCH: Network-first strategy ────────────────
// API calls: always network, no caching.
// Static assets: network-first, fallback to cache.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (CDN scripts, fonts, etc.)
  if (url.origin !== self.location.origin) return;

  // Never intercept API / auth / sensitive routes
  const isPrivate = NO_CACHE_PATTERNS.some((p) => p.test(url.href));
  if (isPrivate) return; // Let browser handle naturally

  // Network-first for everything else
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache valid responses for static assets
        if (response && response.status === 200) {
          const isStaticAsset =
            url.pathname.startsWith('/assets/') ||
            url.pathname === '/' ||
            url.pathname.endsWith('.webmanifest');

          if (isStaticAsset) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
        }
        return response;
      })
      .catch(() => {
        // Offline fallback: serve cached version if available
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, serve cached homepage as fallback
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('', { status: 503 });
        });
      })
  );
});
