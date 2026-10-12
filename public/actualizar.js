// Actualizar la app a mano, sin explicarle a nadie qué es un service worker.
//
// Una PWA instalada se queda con los archivos que guardó. El service worker
// se sella con un hash en cada build, así que la versión nueva entra sola en
// la siguiente carga — pero "la siguiente carga" puede tardar días si nadie
// cierra la app. Esto da el camino corto: un botón, y un aviso cuando lo que
// está corriendo quedó viejo.
(function () {
  const $ = (s) => document.querySelector(s);
  const CORRIENDO = window.VERSION_APP || '';

  async function actualizar(boton) {
    if (boton) { boton.disabled = true; boton.dataset.antes = boton.textContent; boton.textContent = '…'; }
    // Cada paso va por su cuenta: si pedir el service worker falla, vaciar el
    // cache igual tiene que pasar — es lo que de verdad destraba la app vieja.
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch { /* seguimos */ }
    try {
      if (window.caches) {
        for (const k of await caches.keys()) await caches.delete(k);
      }
    } catch { /* seguimos: recargar ya arregla la mayoría de los casos */ }
    // Cache-buster para el HTML, que no pasa por el service worker al recargar.
    const u = new URL(location.href);
    u.searchParams.set('v', Date.now().toString(36));
    location.replace(u.toString());
  }

  // ¿Lo que corre quedó viejo? Se pregunta al servidor, no al cache.
  async function hayNueva() {
    if (!CORRIENDO) return false;
    try {
      const r = await fetch('/version.json', { cache: 'no-store' });
      if (!r.ok) return false;
      return (await r.json()).version !== CORRIENDO;
    } catch { return false; }
  }

  async function revisar() {
    const aviso = $('#avisoVersion');
    if (!aviso || !(await hayNueva())) return;
    aviso.classList.remove('oculto');
  }

  document.querySelectorAll('[data-actualizar]').forEach((b) => {
    b.onclick = () => actualizar(b);
    b.title = CORRIENDO ? 'Versión ' + CORRIENDO : 'Actualizar la app';
  });

  // Al abrir, al volver a la app, y cada diez minutos si queda abierta toda
  // la noche. No cuesta nada: es un archivo de treinta bytes.
  addEventListener('load', revisar);
  addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  setInterval(revisar, 10 * 60 * 1000);

  // Si la URL quedó con el cache-buster, se limpia para no arrastrarlo.
  if (new URL(location.href).searchParams.has('v')) {
    const u = new URL(location.href);
    u.searchParams.delete('v');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
})();
