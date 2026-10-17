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
  //
  // Y se guarda QUÉ dijo cada lado. Un cartel que insiste después de
  // actualizar puede ser el cache sirviendo lo viejo o dos archivos que no
  // coinciden entre si, y son arreglos distintos: sin los dos numeros a la
  // vista hay que adivinar cual de los dos es.
  let DEL_SERVIDOR = '';

  async function hayNueva() {
    if (!CORRIENDO) return false;
    try {
      const r = await fetch('/version.json', { cache: 'no-store' });
      if (!r.ok) return false;
      DEL_SERVIDOR = (await r.json()).version || '';
      return DEL_SERVIDOR !== CORRIENDO;
    } catch { return false; }
  }

  // Al ABRIR se actualiza sola; estando abierta, avisa y espera.
  //
  // La diferencia no es de gusto: al abrir no hay nada empezado que perder,
  // y en medio de la noche una recarga sorpresa se lleva puesto el pedido que
  // alguien estaba cargando. Decirle a la gente "cerrá y abrí la app" no
  // alcanzaba —la app guardada sigue sirviendo lo viejo hasta que alguien
  // toca el botón—, así que abrir tiene que hacer de verdad lo que promete.
  const YA_PROBE = 'sotano:autoactualizado';

  async function revisar(alAbrir) {
    const aviso = $('#avisoVersion');
    if (!(await hayNueva())) {
      try { sessionStorage.removeItem(YA_PROBE); } catch { /* da igual */ }
      return;
    }
    // Una sola vez por pestaña: si la versión nueva no llega a quedar
    // corriendo, esto recargaría para siempre.
    let probado = true;
    try { probado = sessionStorage.getItem(YA_PROBE) === '1'; } catch { /* sin sesión, no auto */ }
    if (alAbrir && !probado) {
      try { sessionStorage.setItem(YA_PROBE, '1'); } catch { return; }
      actualizar(null);
      return;
    }
    if (!aviso) return;
    const detalle = aviso.querySelector('[data-versiones]');
    if (detalle) detalle.textContent = `Tenés ${CORRIENDO} · hay ${DEL_SERVIDOR}`;
    aviso.classList.remove('oculto');
  }

  document.querySelectorAll('[data-actualizar]').forEach((b) => {
    b.onclick = () => actualizar(b);
    b.title = CORRIENDO ? 'Versión ' + CORRIENDO : 'Actualizar la app';
  });

  // Al abrir, al volver a la app, y cada diez minutos si queda abierta toda
  // la noche. No cuesta nada: es un archivo de treinta bytes.
  addEventListener('load', () => revisar(true));
  addEventListener('visibilitychange', () => { if (!document.hidden) revisar(false); });
  setInterval(() => revisar(false), 10 * 60 * 1000);

  // Si la URL quedó con el cache-buster, se limpia para no arrastrarlo.
  if (new URL(location.href).searchParams.has('v')) {
    const u = new URL(location.href);
    u.searchParams.delete('v');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
})();
