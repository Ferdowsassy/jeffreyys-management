const CACHE = 'jeffreyys-offline-v1';
const PUBLIC_FILES = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json() || {};}catch{}
  event.waitUntil(self.registration.showNotification('Jeffreyys',{body:payload.body || 'Es gibt Neuigkeiten in deinem Workspace.',icon:'/icons/icon-192.png',tag:'jeffreyys-update',data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const client=clients.find(c=>new URL(c.url).origin===self.location.origin);
    if(client)return client.focus();
    return self.clients.openWindow('/');
  }));
});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('jeffreyys-offline-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Never intercept API calls, writes, sessions, SSE, or personal records.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
  } else if (PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
