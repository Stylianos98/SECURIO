// Cache only build assets and the public shell. Authenticated responses bypass the service worker.
const shell = 'securio-shell-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(shell).then(cache => cache.addAll(['/', '/icon.svg'])));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('securio-shell-') && key !== shell).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(event.request).catch(() => caches.open(shell).then(cache => cache.match('/'))));
    return;
  }
  if (!url.pathname.startsWith('/_next/static/')) return;
  event.respondWith(caches.open(shell).then(async cache => {
    const existing = await cache.match(event.request);
    if (existing) return existing;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
