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
