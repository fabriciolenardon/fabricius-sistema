// Service worker mínimo de Carnicerías Fabricius.
// Su único objetivo es habilitar que la app se pueda INSTALAR (PWA) en el
// celular. NO cachea contenido a propósito: es un sistema de gestión en vivo,
// así que siempre tiene que mostrar la última versión y los datos al día.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  // Passthrough a la red (sin caché). El handler existe para cumplir el
  // requisito de instalabilidad; ante un fallo de red intenta un cache vacío.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
})

// ── Notificaciones push ──────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  const titulo = data.titulo || data.title || '🥩 Carnicerías Fabricius'
  const opciones = {
    body: data.body || data.mensaje || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [120, 60, 120],
    data: { url: data.url || '/admin/whatsapp' },
  }
  e.waitUntil(self.registration.showNotification(titulo, opciones))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { try { c.navigate(url) } catch {} return c.focus() } }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  }))
})
