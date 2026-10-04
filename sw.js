// Service worker: lets the app open instantly and work with no internet.
//
// Every deploy to GitHub Pages stamps the BUILD value below with the commit
// id (see .github/workflows/deploy.yml). That makes phones notice the new
// version, download it in the background and offer an "Update" button.
// If you add a new file to the app, add it to ASSETS too.

const BUILD = '__BUILD__';
const IS_DEV = BUILD.startsWith('__'); // running locally, not from GitHub Pages
const CACHE = `expenses-${IS_DEV ? 'dev' : BUILD}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/charts.js',
  './js/dom.js',
  './js/format.js',
  './js/store.js',
  './js/swipe.js',
  './js/ui.js',
  './js/version.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.svg',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // "reload" skips the browser's HTTP cache so we store the newest files.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('expenses-') && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage(BUILD);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Any page load inside the app gets the app shell.
    event.respondWith(IS_DEV ? networkFirst(request, './index.html') : cacheFirst(request, './index.html'));
    return;
  }
  event.respondWith(IS_DEV ? networkFirst(request) : cacheFirst(request));
});

async function cacheFirst(request, cacheKey = request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

// Used while developing locally: always try the network so edits show up.
async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(fallbackKey || request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(fallbackKey || request, { ignoreSearch: true });
    return cached || Response.error();
  }
}
