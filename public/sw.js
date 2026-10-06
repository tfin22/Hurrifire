// Offline cache for Scramble!. The game is a single index.html.
//
// The page itself is network-first: online you always get the newest build,
// and the cached copy is only the fallback when offline. Everything else
// (manifest, icon) is cache-first. The cache name carries a fingerprint of
// the build, stamped in by the build (vite.config.ts), so each new build
// starts a fresh cache and the old one is cleared out.
const CACHE = 'scramble-__BUILD__';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keep a copy of a good same-origin response. */
function keep(req, res) {
  if (res.ok && new URL(req.url).origin === location.origin) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const page = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (page) {
    // Network first: the newest game when online; the cached one when not.
    e.respondWith(
      fetch(req).then((res) => keep(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }
  // Cache first for the rest, refreshed in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => keep(req, res)).catch(() => hit);
      return hit || net;
    }),
  );
});
