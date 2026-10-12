// El Sótano — cliente. Carta, carrito y seguimiento de pedidos propios.
// Auth anónima automática: nadie quiere registrarse para pedir una cerveza.
// El SDK viene empaquetado en /vendor (ver src/firebase.js), no del CDN.
import {
  initializeApp,
  getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  connectFirestoreEmulator,
  collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp,
} from '/vendor/firebase.js';

const CFG = window.CONFIG_FIREBASE || {};
const BAR = window.CONFIG_BAR || { moneda: '$', mesas: [], alertaDemoraMin: 8 };
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
  uid: null,
  carta: [],
  categoria: null,
  carrito: new Map(),      // itemId -> cantidad
  pedidos: [],
};

// Mesa desde el QR: /mesa/7 o ?mesa=7, y la recordamos por sesión.
function mesaInicial() {
  const porRuta = location.pathname.match(/^\/mesa\/([^/]+)/);
  const porQuery = new URLSearchParams(location.search).get('mesa');
  const guardada = sessionStorage.getItem('sotano:mesa');
  const m = decodeURIComponent(porRuta?.[1] || porQuery || guardada || '');
  if (m) sessionStorage.setItem('sotano:mesa', m);
  return m;
}
let mesa = mesaInicial();

// ---------- conexión ----------
function pintarConexion() {
  const off = !navigator.onLine;
  $('#avisoOffline').classList.toggle('oculto', !off);
  const chip = $('#chipConexion');
  chip.hidden = !off;
  chip.textContent = 'sin conexión';
  chip.className = 'chip mal';
}
addEventListener('online', pintarConexion);
addEventListener('offline', pintarConexion);
pintarConexion();

if (mesa) {
  const c = $('#chipMesa');
  c.hidden = false;
  c.textContent = 'Mesa ' + mesa;
}

// ---------- auth ----------
onAuthStateChanged(auth, (u) => {
  if (!u) { signInAnonymously(auth).catch(mostrarFalloAuth); return; }
  estado.uid = u.uid;
  escucharCarta();
  escucharMisPedidos();
});
signInAnonymously(auth).catch(mostrarFalloAuth);

function mostrarFalloAuth(e) {
  $('#carta').innerHTML =
    `<div class="aviso mal"><span>⚠</span><div><b>No se pudo entrar.</b><br>${e.code || e.message}
     <br><small>Revisá que el acceso anónimo esté habilitado en Firebase Authentication.</small></div></div>`;
}

// ---------- carta ----------
function escucharCarta() {
  onSnapshot(collection(db, 'carta'), (snap) => {
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
  $('#carrito').classList.toggle('visible', unidades > 0);
  $('#totalCarrito').textContent = plata(totalCarrito());
  $('#detalleCarrito').textContent =
    `${unidades} ${unidades === 1 ? 'item' : 'items'}` + (mesa ? ` · mesa ${mesa}` : '');
}

$('#btnVaciar').onclick = () => { estado.carrito.clear(); pintarCarta(); pintarCarrito(); };

$('#btnConfirmar').onclick = () => {
  const sel = $('#selMesa');
  const opciones = (BAR.mesas || []).length ? BAR.mesas : ['1','2','3','4','5','Barra'];
  sel.innerHTML = opciones.map((m) =>
    `<option value="${esc(m)}" ${String(m) === String(mesa) ? 'selected' : ''}>${esc(m)}</option>`).join('');
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
    mesa = $('#selMesa').value;
    sessionStorage.setItem('sotano:mesa', mesa);
    if (nombre) localStorage.setItem('sotano:nombre', nombre);

    // Los campos deben coincidir exactamente con pedidoValido() en firestore.rules.
    const pedido = {
      clienteId: estado.uid,
      estado: 'nuevo',
      items,
      total: totalCarrito(),
      mesa: String(mesa),
      creadoEn: serverTimestamp(),
    };
    if (nombre) pedido.nombreCliente = nombre;
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
    estado.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarMisPedidos();
  }, (e) => {
    $('#misPedidos').innerHTML =
      `<div class="aviso mal"><span>⚠</span><div>${esc(e.code || e.message)}</div></div>`;
  });
}

const ETIQUETA = {
  nuevo: 'Tomado', en_preparacion: 'Preparando',
  listo: 'Listo, va para tu mesa', entregado: 'Entregado', cancelado: 'Cancelado',
};

function pintarMisPedidos() {
  const activos = estado.pedidos.filter((p) => !['entregado','cancelado'].includes(p.estado)).length;
  $('#cuentaPedidos').textContent = activos ? `(${activos})` : '';

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
        <small style="color:var(--suave)">${p.mesa ? 'Mesa ' + esc(p.mesa) + ' · ' : ''}${hora(p.creadoEn)}</small>
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
