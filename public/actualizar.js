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
    // Se DA DE BAJA al service worker, no se le pide que se actualice.
    //
    // update() le pregunta al service worker instalado si hay uno nuevo. Si
    // justamente ese es el que esta sirviendo los archivos viejos, se le esta
    // pidiendo al problema que se arregle solo, y queda un celular clavado en
    // una version vieja con el cartel puesto para siempre.
    //
    // Sin registro no hay quien intercepte: la recarga va derecho a la red, y
    // bar.js vuelve a registrar uno fresco al cargar. Se pierde el modo sin
    // senal por unos segundos, que es exactamente cuando el que toca
    // Actualizar tiene senal.
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    } catch { /* seguimos */ }
    try {
      if (window.caches) {
        for (const k of await caches.keys()) await caches.delete(k);
      }
    } catch { /* seguimos: recargar ya arregla la mayoría de los casos */ }
    // Y se obliga al navegador a revalidar version.js, que es de donde sale el
    // número que decide si el cartel aparece. El HTML se recarga con un
    // cache-buster, pero el <script src="/version.js"> de adentro no lleva
    // ninguno: si esa copia quedó vieja en el cache del navegador, el cartel
    // vuelve a aparecer aunque todo lo demás ya sea nuevo.
    try { await fetch('/version.js', { cache: 'reload' }); } catch { /* seguimos */ }

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
    // Se guarda QUÉ versión se intentó, no un sí o no. Con un sí o no, un
    // intento fallido dejaba la pestaña sin reintentar nunca más, y el
    // despliegue siguiente tampoco entraba: el seguro contra el bucle
    // terminaba tapando lo que venía después.
    let probado = DEL_SERVIDOR;
    try { probado = sessionStorage.getItem(YA_PROBE); } catch { /* sin sesión, no auto */ }
    if (alAbrir && probado !== DEL_SERVIDOR) {
      try { sessionStorage.setItem(YA_PROBE, DEL_SERVIDOR); } catch { return; }
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
