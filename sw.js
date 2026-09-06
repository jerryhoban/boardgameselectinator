// Minimal service worker for "What Should We Play?"
//
// Purpose: makes the site installable to a phone's home screen (Android
// requires a registered service worker with a fetch handler before it will
// offer "Add to Home Screen" as a real app install). It also caches the
// app shell so the interface still loads if the connection is briefly
// spotty — but it deliberately NEVER caches /api/collection, since that's
// live data from BoardGameGeek and must always be fetched fresh.

var CACHE_NAME = 'wswp-shell-v1';
var SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/logo-header.png',
  '/assets/bg-shelf.jpg',
  '/assets/bg-table.webp',
  '/assets/powered-by-bgg.webp',
  '/assets/bgg-shield.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Never cache the live BGG API — always go to the network.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Only handle GET requests for same-origin app-shell files; let
  // everything else (e.g. POSTs, cross-origin requests) pass straight
  // through untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      // Cache-first for speed, but keep the cache warm in the background.
      return cached || networkFetch;
    })
  );
});
