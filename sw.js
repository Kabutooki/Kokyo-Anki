const CACHE_NAME='koukyou-flashcards-v22';
const APP_SHELL=['./','./index.html','./app.js','./cards.json','./manifest.webmanifest','./VERSION.json','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL))) });
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(r=>{if(r&&r.ok){const cp=r.clone();caches.open(CACHE_NAME).then(c=>c.put('./index.html',cp))}return r}).catch(()=>caches.match('./index.html')));return;
 }
 const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('/cards.json')||url.pathname.endsWith('/app.js')){
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(r=>{if(r&&r.ok){const cp=r.clone();caches.open(CACHE_NAME).then(c=>c.put(event.request,cp))}return r}).catch(()=>caches.match(event.request)));return;
 }
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{if(r&&r.ok){const cp=r.clone();caches.open(CACHE_NAME).then(c=>c.put(event.request,cp))}return r})));
});
