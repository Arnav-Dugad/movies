// ===== CineVerse Service Worker =====
const VERSION = 'cineverse-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './css/variables.css', './css/base.css', './css/layout.css',
  './css/components.css', './css/animations.css', './css/responsive.css',
  './js/main.js', './js/config.js', './js/firebase.js', './js/api.js',
  './js/state.js', './js/ui.js', './js/events.js', './js/cards.js',
  './js/prefs.js', './js/auth.js', './js/watchlist.js', './js/ratings.js',
  './js/media.js', './js/person.js', './js/detail.js', './js/browse.js',
  './js/discover.js', './js/home.js', './js/hero.js', './js/search.js',
  './js/cmdk.js', './js/compare.js', './js/stats.js', './js/router.js',
  './js/effects.js', './js/pwa.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache the TMDB API (dynamic data) — go straight to network.
  if (url.hostname === 'api.themoviedb.org') return;

  // TMDB / YouTube images: cache-first (stale-while-revalidate style).
  if (url.hostname === 'image.tmdb.org' || url.hostname === 'img.youtube.com') {
    e.respondWith(
      caches.open('cv-images').then(async cache => {
        const cached = await cache.match(req);
        const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // App shell (same-origin): cache-first, fall back to network then cache.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
