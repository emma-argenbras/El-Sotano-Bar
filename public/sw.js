// Service worker de Sótano.
// El local es un sótano: la señal se corta. El cascarón de la app tiene que
// abrir igual, y Firestore ya resuelve sus datos con su propio cache.
const VERSION = 'sotano-7c205eaf71a6';
const ESENCIALES = [
  '/', '/index.html', '/bar.html', '/estilos.css', '/app.js', '/bar.js',
  '/config.js', '/actualizar.js', '/ayuda.js', '/tel.js', '/instalar.js',
  '/manifest.webmanifest', '/vendor/firebase.js',
  '/iconos/icono.svg', '/iconos/icono-192.png', '/iconos/apple-touch-icon.png',
  '/iconos/logo-horizontal.svg', '/iconos/logo-horizontal-claro.svg', '/iconos/logo.svg',
  '/manifest-barra.webmanifest', '/iconos/icono-barra.svg',
  '/iconos/icono-barra-192.png', '/iconos/apple-touch-icon-barra.png',
  // El pase y el registro: la app del club. El pase tiene que abrir en la
  // puerta, que está abajo y sin señal — el QR se dibuja en el celular con el
  // token, y los datos los sirve el cache de Firestore. Por eso va también
  // el bundle del QR, que si no hay que bajarlo justo cuando no se puede.
  '/pase.html', '/pase.js', '/registro.html', '/registro.js', '/vendor/qr.js',
  '/manifest-club.webmanifest', '/iconos/icono-club.svg',
  '/iconos/icono-club-192.png', '/iconos/apple-touch-icon-club.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // cache:'reload' saltea el cache HTTP del navegador (los .js van con
      // max-age=3600). Sin esto el sw nuevo podría guardar los archivos viejos.
      .then((c) => c.addAll(ESENCIALES.map((u) => new Request(u, { cache: 'reload' }))).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca tocar el tráfico de Firebase: Firestore y Auth manejan lo suyo.
  if (/(firestore|googleapis|firebaseio|identitytoolkit|firebaseapp)\.com$/.test(url.hostname)) return;

  if (url.origin !== location.origin) return;

  // Navegación y config: red primero, cache como red de contención.
  const esNavegacion = request.mode === 'navigate';
  // version.js y version.json nunca salen del cache: son justamente lo que
  // se consulta para saber si el cache quedó viejo.
  if (url.pathname.startsWith('/version.')) return;

  if (esNavegacion || url.pathname === '/config.js') {
    e.respondWith(
      fetch(request).then((r) => {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(request, copia)).catch(() => {});
        return r;
      }).catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  // Resto de estáticos: cache primero, refresco en segundo plano.
  e.respondWith(
    caches.match(request).then((hit) => {
      const red = fetch(request).then((r) => {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(request, copia)).catch(() => {});
        return r;
      }).catch(() => hit);
      return hit || red;
    }),
  );
});
