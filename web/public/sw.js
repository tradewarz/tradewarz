// TradeWarz service worker. Two jobs: make the site installable as an app, and keep the app shell
// (the page and its hashed assets) available when the network is not, so an installed app opens
// to "the hub is not answering" rather than a browser error. It never caches the API (/api/*),
// the live stream, or anything from another origin: every price, candidate, balance and trade is
// fetched live, every time. Nothing here can sign, send or see a key.
const VERSION = 'tw-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.add('/')).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data: never cached, never served stale
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/avatar.png' || url.pathname === '/manifest.webmanifest') e.respondWith(cacheFirst(req));
});

/** The page: fresh when possible, the last copy when offline. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) ?? new Response('TradeWarz is offline: no network, and no saved copy of the page yet.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

/** Hashed assets never change under the same name: once seen, served from the cache. */
async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
