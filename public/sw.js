const CACHE_VERSION = 'v3';
const CORE_CACHE = `secplus-quest-core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `secplus-quest-runtime-${CACHE_VERSION}`;
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');

const withBase = (path) => {
  if (!BASE_PATH) return path;
  if (path === '/') return `${BASE_PATH}/`;
  return `${BASE_PATH}${path}`;
};

const CORE_ASSETS = [
  '/',
  '/map',
  '/roguelike',
  '/roguelike/plan',
  '/review',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
].map(withBase);

const CONTENT_PREFIXES = [
  '/content/chapter_packs/',
  '/content/chapter_lessons/',
  '/content/chapter_enrichment/'
].map(withBase);

const API_PREFIXES = [
  '/api/packs',
  '/api/lessons'
].map(withBase);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![CORE_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(() => notifyOfflineReady())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function notifyOfflineReady() {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'OFFLINE_READY' }));
  });
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || fetchPromise || caches.match(withBase('/offline.html'));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const path = url.pathname;
  const sameOrigin = url.origin === self.location.origin;
  const bypassCache = url.searchParams.has('fresh') || request.headers.get('x-skip-cache') === '1';

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(withBase('/offline.html'));
        })
    );
    return;
  }

  if (sameOrigin && bypassCache) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(withBase('/offline.html'));
        })
    );
    return;
  }

  if (sameOrigin && CONTENT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (sameOrigin && API_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (sameOrigin && CORE_ASSETS.includes(path)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (sameOrigin && ['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
    return;
  }
});
