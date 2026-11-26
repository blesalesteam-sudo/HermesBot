// hermesBot · trabajador de servicio: permite instalar la app, abrirla aunque falle la red
// un momento y que los avisos lleven de vuelta a la conversación.
const CACHE = 'hermesbot-v1'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)

  if (req.method !== 'GET' || url.origin !== location.origin || /^\/(api|ws|files|health)(\/|$)/.test(url.pathname)) { return }

  // Los archivos con huella en el nombre no cambian nunca: primero la copia guardada.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }

        return res
      }))
    )

    return
  }

  // La página: siempre la versión nueva si hay red; si no, la última que se guardó.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)) }

        return res
      }).catch(() => caches.match('/'))
    )
  }
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => (list[0] ? list[0].focus() : self.clients.openWindow('/')))
  )
})
