const CACHE_NAME = 'tcg-card-tracker-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          console.log('Clearing old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // NEVER intercept external API requests or same-origin API/Supabase proxy routes
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/supabase-proxy/') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // SPA fallback for navigation requests
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Network first for all local assets
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
