// Sótano — cliente. Carta, carrito y seguimiento de pedidos propios.
// Auth anónima automática: nadie quiere registrarse para pedir una cerveza.
// El SDK viene empaquetado en /vendor (ver src/firebase.js), no del CDN.
import {
  initializeApp,
  getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  connectFirestoreEmulator,
  collection, doc, getDoc, query, where, orderBy, onSnapshot, addDoc, serverTimestamp,
} from '/vendor/firebase.js';
import { cajaDeDia } from '/corte.js';

const CFG = window.CONFIG_FIREBASE || {};
const BAR = window.CONFIG_BAR || { moneda: '$', alertaDemoraMin: 8 };
const $ = (s) => document.querySelector(s);

if (!CFG.apiKey || String(CFG.apiKey).startsWith('REEMPLAZAR')) {
  $('#avisoConfig').classList.remove('oculto');
  $('#carta').innerHTML = '';
  throw new Error('config.js sin completar');
}

const app = initializeApp(CFG);
const auth = getAuth(app);
// Cache local persistente: en un sótano la señal se corta. La carta tiene que seguir visible.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});

// En local apuntamos a los emuladores: nunca tocar datos de producción probando.
export const EN_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (EN_LOCAL) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const plata = (n) => BAR.moneda + Number(n || 0).toLocaleString('es-AR');

// ---------- estado ----------
const estado = {
  desdeCache: false,
  vioPedidos: false,
  hayListo: false,
  tomandoPedidos: true,
  uid: null,
  carta: [],
  categoria: null,
  carrito: new Map(),      // itemId -> cantidad
  pedidos: [],
};

// Quién pide. No hay mesas: cada pedido es de una persona, y se retira en la
// barra. Si llegó con su pase, el nombre sale de ahí; si no, lo escribe.
let quienSoy = localStorage.getItem('sotano:nombre') || '';

// ---------- conexión ----------
// Igual que en el panel: lo decide Firestore, no navigator.onLine.
function pintarConexion() {
  const off = estado.desdeCache === true;
  $('#avisoOffline').classList.toggle('oculto', !off);
  const chip = $('#chipConexion');
  chip.hidden = !off;
  chip.textContent = 'sin conexión';
  chip.className = 'chip mal';
}
addEventListener('online', pintarConexion);
addEventListener('offline', pintarConexion);
pintarConexion();

// ---------- invitado ----------
// Si llegó por su pase, el pedido queda a su nombre y la casa puede ver el
// consumo de cada invitado. Si escanea el QR de la mesa sin pase, no hay
// forma de atribuirlo: es una limitación, no un olvido.
const invitadoId = (() => {
  const porUrl = new URLSearchParams(location.search).get('inv');
  if (porUrl) localStorage.setItem('sotano:invitado', porUrl);
  return porUrl || localStorage.getItem('sotano:invitado') || '';
})();

// Con pase, el nombre sale de ahí y no se lo preguntamos de nuevo.
if (invitadoId) {
  getDoc(doc(db, 'invitados', invitadoId)).then((d) => {
    const n = d.exists() ? d.data().nombre : '';
    if (!n) return;
    quienSoy = n;
    localStorage.setItem('sotano:nombre', n);
    pintarChipMesa();
  }).catch(() => {});
}

// ---------- pasar la carta a otro ----------
// Mostrar el QR en pantalla para que alguien que recién llega lo escanee y
// entre a la carta. Es un diálogo: se cierra y el carrito sigue intacto.
function pintarChipMesa() {
  const c = $('#chipMesa');
  c.hidden = false;
  c.textContent = quienSoy ? `${quienSoy} · QR` : 'Ver QR';
  c.onclick = abrirQrMesa;
}

function abrirQrMesa() {
  $('#dlgMesaAyuda').textContent =
    'Que la escaneen con la cámara: les abre la carta para pedir desde su celular.';
  $('#dlgMesaCual').textContent = '';
  $('#dlgMesaLink').textContent = location.origin;
  const img = $('#imgMesaQr');
  img.alt = 'QR de la carta';
  img.onerror = () => { $('#dlgMesaQr').hidden = true; };
  img.onload = () => { $('#dlgMesaQr').hidden = false; };
  img.src = '/qr/general.png';
  $('#dlgMesa').showModal();
}

$('#btnCerrarMesa').onclick = () => $('#dlgMesa').close();
$('#btnCompartirMesa').onclick = async () => {
  const url = location.origin;
  if (navigator.share) {
    try { await navigator.share({ title: 'Sótano', text: 'Pedí desde tu celular en Sótano', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const b = $('#btnCompartirMesa');
  try { await navigator.clipboard.writeText(url); b.textContent = 'Link copiado ✓'; }
  catch { b.textContent = 'Copiá el link de abajo'; }
  setTimeout(() => { b.textContent = 'Mandar link'; }, 1800);
};

pintarChipMesa();

// ---------- auth ----------
// El cliente entra anónimo y su uid ES su identidad: "Mis pedidos" son los
// pedidos de ese uid y nada más.
//
// OJO: entrar se pide SOLO acá adentro, cuando ya se sabe que no hay sesión.
// Llamar a signInAnonymously al cargar, en paralelo, era una carrera contra
// la sesión guardada: si ganaba la llamada, Firebase creaba un uid nuevo y la
// persona perdía sus pedidos al recargar — le quedaba "Mis pedidos" vacío y
// nunca le llegaba el aviso de que su trago estaba listo.
onAuthStateChanged(auth, (u) => {
  if (!u) { signInAnonymously(auth).catch(mostrarFalloAuth); return; }
  estado.uid = u.uid;
  escucharEstadoLocal();
  escucharCarta();
  escucharMisPedidos();
});

function mostrarFalloAuth(e) {
  $('#carta').innerHTML =
    `<div class="aviso mal"><span>⚠</span><div><b>No se pudo entrar.</b><br>${e.code || e.message}
     <br><small>Revisá que el acceso anónimo esté habilitado en Firebase Authentication.</small></div></div>`;
}

// ---------- vigencia: ¿el local está tomando pedidos? ----------
// El QR pegado en la mesa no vence nunca: lo que vence es el permiso de
// pedir. Cerrado el evento, la carta se sigue viendo pero no entra nada.
// Las reglas lo rechazan igual: esto es para avisarlo, no para custodiarlo.
// Igual que en el panel: lo que se vende a las 3 AM es de la noche anterior.
// La hora del corte la pone Administración y vive en publico/jornada; si
// todavía no está, valen las 6. Que el cliente y la barra usen la misma es
// lo que hace que el pedido de las 3 AM caiga en la caja de anoche en los
// dos lados. Ver /corte.js.
function cajaDelDia() {
  return cajaDeDia(new Date(), estado.horaCorte);
}

function escucharEstadoLocal() {
  onSnapshot(doc(db, 'publico', 'estado'), (d) => {
    estado.tomandoPedidos = d.exists() ? d.data().tomandoPedidos !== false : true;
    // A qué caja entra lo que se pida: la del evento abierto, o la del día.
    estado.eventoId = d.exists() ? (d.data().eventoId || '') : '';
    pintarEstadoLocal();
    pintarCarta();
    pintarCarrito();
  }, () => {});

  // El corte no se dibuja en ninguna parte: solo decide a qué caja va el
  // pedido. Por eso no repinta nada al llegar.
  onSnapshot(doc(db, 'publico', 'jornada'), (d) => {
    estado.horaCorte = d.exists() ? d.data().horaCorte : undefined;
  }, () => {});
}

function pintarEstadoLocal() {
  const a = $('#avisoCerrado');
  a.classList.toggle('oculto', estado.tomandoPedidos);
}

// ---------- carta ----------
function escucharCarta() {
  onSnapshot(collection(db, 'carta'), { includeMetadataChanges: true }, (snap) => {
    estado.desdeCache = snap.metadata.fromCache;
    pintarConexion();
    estado.carta = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // enCarta:false = no lo vendemos más. No se muestra.
      // disponible:false = se acabó esta noche. Se muestra como "sin stock".
      .filter((i) => i.enCarta !== false)
      .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '')
        || (a.orden ?? 999) - (b.orden ?? 999)
        || (a.nombre || '').localeCompare(b.nombre || ''));
    pintarCategorias();
    pintarCarta();
  }, (e) => {
    $('#carta').innerHTML =
      `<div class="aviso mal"><span>⚠</span><div><b>No se pudo leer la carta.</b><br>${e.code || e.message}</div></div>`;
  });
}

function categorias() {
  return [...new Set(estado.carta.map((i) => i.categoria || 'Otros'))];
}

function pintarCategorias() {
  const cats = categorias();
  const nav = $('#categorias');
  if (cats.length <= 1) { nav.innerHTML = ''; return; }
  nav.innerHTML = ['Todo', ...cats].map((c) => {
    const val = c === 'Todo' ? '' : c;
    const sel = (estado.categoria || '') === val;
    return `<button role="tab" aria-selected="${sel}" data-cat="${val}">${c}</button>`;
  }).join('');
  nav.querySelectorAll('button').forEach((b) => b.onclick = () => {
    estado.categoria = b.dataset.cat || null;
    pintarCategorias(); pintarCarta();
  });
}

function pintarCarta() {
  const cont = $('#carta');
  if (!estado.carta.length) {
    cont.innerHTML = `<div class="vacio">Todavía no hay nada cargado en la carta.<br>
      <small>Desde la Mac: <code>npm run seed</code></small></div>`;
    return;
  }
  const visibles = estado.categoria
    ? estado.carta.filter((i) => (i.categoria || 'Otros') === estado.categoria)
    : estado.carta;

  const porCat = new Map();
  for (const i of visibles) {
    const c = i.categoria || 'Otros';
    if (!porCat.has(c)) porCat.set(c, []);
    porCat.get(c).push(i);
  }

  cont.innerHTML = [...porCat].map(([cat, items]) => `
    <div class="grupo"><h2>${esc(cat)}</h2></div>
    ${items.map(filaItem).join('')}
  `).join('');

  cont.querySelectorAll('[data-mas]').forEach((b) => b.onclick = () => sumar(b.dataset.mas, +1));
  cont.querySelectorAll('[data-menos]').forEach((b) => b.onclick = () => sumar(b.dataset.menos, -1));
}

function filaItem(i) {
  const n = estado.carrito.get(i.id) || 0;
  const sinStock = i.disponible === false || (typeof i.stock === 'number' && i.stock <= 0);
  const topeStock = typeof i.stock === 'number' ? i.stock : Infinity;
  return `
  <div class="item ${sinStock ? 'agotado' : ''}">
    <div class="cuerpo">
      <div class="nombre">${esc(i.nombre || i.id)}${sinStock ? ' — <small>sin stock</small>' : ''}</div>
      ${i.descripcion ? `<div class="desc">${esc(i.descripcion)}</div>` : ''}
    </div>
    <div class="precio">${plata(i.precio)}</div>
    ${sinStock ? '' : `
    <div class="cant">
      <button data-menos="${i.id}" ${n === 0 ? 'disabled' : ''} aria-label="Quitar uno">−</button>
      <span class="n">${n}</span>
      <button data-mas="${i.id}" ${n >= topeStock ? 'disabled' : ''} aria-label="Agregar uno">+</button>
    </div>`}
  </div>`;
}

// ---------- carrito ----------
function sumar(id, delta) {
  const item = estado.carta.find((i) => i.id === id);
  if (!item) return;
  const tope = typeof item.stock === 'number' ? item.stock : 99;
  const n = Math.max(0, Math.min(tope, (estado.carrito.get(id) || 0) + delta));
  if (n === 0) estado.carrito.delete(id); else estado.carrito.set(id, n);
  if (navigator.vibrate) navigator.vibrate(8);
  pintarCarta();
  pintarCarrito();
}

function lineas() {
  return [...estado.carrito].map(([id, cantidad]) => {
    const i = estado.carta.find((x) => x.id === id);
    return { id, nombre: i?.nombre || id, precio: Number(i?.precio || 0), cantidad };
  });
}
const totalCarrito = () => lineas().reduce((s, l) => s + l.precio * l.cantidad, 0);

function pintarCarrito() {
  const ls = lineas();
  const unidades = ls.reduce((s, l) => s + l.cantidad, 0);
  $('#carrito').classList.toggle('visible', unidades > 0 && estado.tomandoPedidos);
  $('#totalCarrito').textContent = plata(totalCarrito());
  $('#detalleCarrito').textContent =
    `${unidades} ${unidades === 1 ? 'item' : 'items'}` + (quienSoy ? ` · ${quienSoy}` : '');
}

$('#btnVaciar').onclick = () => { estado.carrito.clear(); pintarCarta(); pintarCarrito(); };

$('#btnConfirmar').onclick = () => {
  if (!estado.tomandoPedidos) {
    alert('Por ahora no se están tomando pedidos. Acercate a la barra.');
    return;
  }
  $('#inpNombre').value = $('#inpNombre').value || quienSoy;
  $('#resumenPedido').innerHTML = lineas().map((l) =>
    `<div style="display:flex;gap:.5rem"><span style="flex:1">${l.cantidad}× ${esc(l.nombre)}</span>
     <b>${plata(l.precio * l.cantidad)}</b></div>`).join('')
    + `<div style="display:flex;gap:.5rem;margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--borde)">
       <span style="flex:1">Total</span><b style="color:var(--oro)">${plata(totalCarrito())}</b></div>`;
  $('#inpNombre').value = localStorage.getItem('sotano:nombre') || '';
  $('#errorPedido').classList.add('oculto');
  $('#dlgConfirmar').showModal();
};

$('#btnCancelarDlg').onclick = () => $('#dlgConfirmar').close();

$('#btnEnviar').onclick = async () => {
  const btn = $('#btnEnviar');
  const items = lineas();
  if (!items.length) return;

  btn.disabled = true;
  btn.textContent = 'Mandando…';
  try {
    const nombre = $('#inpNombre').value.trim();
    const nota = $('#inpNota').value.trim();
    // Sin nombre no hay a quién llamar: no hay mesa donde dejarlo.
    if (nombre.length < 2) {
      btn.disabled = false; btn.textContent = 'Mandar pedido';
      $('#errorPedidoTexto').textContent = 'Poné tu nombre: te llamamos por ahí cuando esté listo.';
      $('#errorPedido').classList.remove('oculto');
      $('#inpNombre').focus();
      return;
    }
    quienSoy = nombre;
    localStorage.setItem('sotano:nombre', nombre);
    pintarChipMesa();
    pedirPermisoAviso();

    // Los campos deben coincidir exactamente con pedidoValido() en firestore.rules.
    const pedido = {
      clienteId: estado.uid,
      estado: 'nuevo',
      items,
      total: totalCarrito(),
      origen: 'cliente',
      // La noche de bar cruza la medianoche: el día corta a las 6 de la mañana.
      cajaId: estado.eventoId || cajaDelDia(),
      creadoEn: serverTimestamp(),
    };
    if (nombre) pedido.nombreCliente = nombre;
    if (invitadoId) pedido.invitadoId = invitadoId;
    if (nota) pedido.nota = nota;

    // Con cache persistente, addDoc resuelve local y sincroniza al volver la señal.
    await addDoc(collection(db, 'pedidos'), pedido);

    estado.carrito.clear();
    $('#inpNota').value = '';
    $('#dlgConfirmar').close();
    pintarCarta(); pintarCarrito();
    if (navigator.vibrate) navigator.vibrate([18, 60, 18]);
    irA('pedidos');
  } catch (e) {
    $('#errorPedidoTexto').innerHTML =
      `No se pudo mandar el pedido.<br><small>${esc(e.code || e.message)}</small>`;
    $('#errorPedido').classList.remove('oculto');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Mandar pedido';
  }
};

// ---------- mis pedidos ----------
function escucharMisPedidos() {
  // El filtro por clienteId no es cosmético: sin él las reglas rechazan la query entera.
  const q = query(
    collection(db, 'pedidos'),
    where('clienteId', '==', estado.uid),
    orderBy('creadoEn', 'desc'),
  );
  onSnapshot(q, (snap) => {
    const antes = new Map(estado.pedidos.map((p) => [p.id, p.estado]));
    const primeraVuelta = !estado.vioPedidos;
    estado.vioPedidos = true;
    estado.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // El que recién pasó a listo. En la primera carga no se avisa nada:
    // si no, al abrir la app suena por algo que ya te entregaron.
    const reciénListos = primeraVuelta ? [] : estado.pedidos.filter(
      (p) => p.estado === 'listo' && antes.get(p.id) && antes.get(p.id) !== 'listo');
    if (reciénListos.length) avisarListo(reciénListos);
    pintarMisPedidos();
  }, (e) => {
    $('#misPedidos').innerHTML =
      `<div class="aviso mal"><span>⚠</span><div>${esc(e.code || e.message)}</div></div>`;
  });
}

const ETIQUETA = {
  nuevo: 'Tomado', en_preparacion: 'Preparando',
  listo: 'Listo, retiralo en la barra', entregado: 'Entregado', cancelado: 'Cancelado',
};

// ---------- aviso de "tu pedido está listo" ----------
// Tres caminos, porque ninguno solo alcanza: el cartel y el badge para quien
// tiene la app abierta, vibración y sonido para quien la tiene en el bolsillo,
// y una notificación del sistema donde el navegador la permita.
function avisarListo(pedidos) {
  estado.hayListo = true;
  const que = pedidos.flatMap((p) => (p.items || []).map((i) => `${i.cantidad}× ${i.nombre}`)).join(', ');

  if (navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 220]);
  sonar();

  const texto = que;
  $('#textoListo').textContent = texto;
  $('#avisoListo').classList.remove('oculto');

  if ('Notification' in window && Notification.permission === 'granted') {
    // Por el service worker: así aparece aunque la pestaña esté en segundo plano.
    navigator.serviceWorker?.ready.then((reg) => reg.showNotification('Tu pedido está listo 🍸', {
      body: `${texto}\nRetiralo en la barra.`,
      icon: '/iconos/icono-192.png', badge: '/iconos/icono-192.png',
      tag: 'sotano-listo', renotify: true, vibrate: [120, 80, 120],
    })).catch(() => {});
  }
}

// Un beep corto. Sin librerías ni archivos: el sótano tiene la señal que tiene.
function sonar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.52);
  } catch { /* sin audio, quedan el cartel y la vibración */ }
}

// Se pide recién al mandar el pedido: antes de eso el cliente no tiene por qué
// entender para qué le pedimos permiso de notificar.
function pedirPermisoAviso() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

function pintarMisPedidos() {
  const activos = estado.pedidos.filter((p) => !['entregado','cancelado'].includes(p.estado)).length;
  const listos = estado.pedidos.filter((p) => p.estado === 'listo').length;
  $('#cuentaPedidos').textContent = listos ? '🔔' : (activos ? `(${activos})` : '');
  $('#cuentaPedidos').classList.toggle('listo', listos > 0);
  if (!listos) { estado.hayListo = false; $('#avisoListo').classList.add('oculto'); }

  if (!estado.pedidos.length) {
    $('#misPedidos').innerHTML = `<div class="vacio">Todavía no pediste nada.<br>
      <small>Lo que pidas aparece acá y vas viendo cómo avanza.</small></div>`;
    return;
  }
  $('#misPedidos').innerHTML = estado.pedidos.map((p) => `
    <div class="pedido">
      <div class="fila">
        <span class="estado ${p.estado}">${ETIQUETA[p.estado] || p.estado}</span>
        <span class="relleno"></span>
        <small style="color:var(--suave)">${hora(p.creadoEn)}</small>
      </div>
      <ul>${(p.items || []).map((i) => `<li>${i.cantidad}× ${esc(i.nombre)}</li>`).join('')}</ul>
      <div class="fila" style="margin-top:.5rem">
        <span class="relleno"></span>
        <b style="color:var(--oro)">${plata(p.total)}</b>
      </div>
      ${p.nota ? `<div class="nota" style="font-size:.83rem;color:var(--suave)">“${esc(p.nota)}”</div>` : ''}
    </div>`).join('');
}

// ---------- pestañas ----------
function irA(cual) {
  const carta = cual === 'carta';
  $('#tabCarta').setAttribute('aria-selected', carta);
  $('#tabPedidos').setAttribute('aria-selected', !carta);
  $('#vistaCarta').hidden = !carta;
  $('#vistaPedidos').hidden = carta;
}
$('#avisoListo').onclick = () => { irA('pedidos'); $('#avisoListo').classList.add('oculto'); };
$('#tabCarta').onclick = () => irA('carta');
$('#tabPedidos').onclick = () => irA('pedidos');

// ---------- utilidades ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function hora(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'ahora';
}

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
