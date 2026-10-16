import {
  Timestamp,
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '/vendor/firebase.js';
import { $, COLUMNAS, DEMORA_MS, esc, estado, plata } from './base.js';
import { costoDeItems, moverInsumos, opcionesDe, recetaCompleta } from './stock.js';
import { app, auth, db, pintarConexion } from './conexion.js';
import { cajaDeHoy } from './jornada.js';
import { desdeCuando, pintarEvento, resumirCaja } from './eventos.js';

// ---------- pedidos ----------
export let dejarDeEscucharPedidos = null;
export let desdeActual = null;
export function escucharPedidos() {
  // Arranca donde arranca el evento; si no hay evento, el día de hoy.
  const desde = desdeCuando();
  if (dejarDeEscucharPedidos && desdeActual?.getTime() === desde.getTime()) return;
  if (dejarDeEscucharPedidos) dejarDeEscucharPedidos();
  desdeActual = desde;
  estado.vistos.clear();
  const q = query(
    collection(db, 'pedidos'),
    where('creadoEn', '>=', Timestamp.fromDate(desde)),
    orderBy('creadoEn', 'asc'),
  );
  dejarDeEscucharPedidos = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    estado.desdeCache = snap.metadata.fromCache;
    pintarConexion();
    const antes = estado.vistos.size > 0;
    const nuevos = [];
    snap.docChanges().forEach((c) => {
      if (c.type === 'added' && !estado.vistos.has(c.doc.id)) nuevos.push(c.doc.id);
    });
    estado.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.pedidos.forEach((p) => estado.vistos.add(p.id));
    pintarTablero();
    pintarCaja();
    pintarEvento();
    // No sonar en la carga inicial, solo cuando entra algo nuevo estando ya abierto.
    if (antes && nuevos.some((id) => estado.pedidos.find((p) => p.id === id)?.estado === 'nuevo')) avisar();
  }, (e) => {
    if (e.code === 'permission-denied') $('#avisoPermiso').classList.remove('oculto');
    $('#tablero').innerHTML = `<div class="aviso mal"><span>⚠</span><div>${esc(e.code || e.message)}</div></div>`;
  });
}

export function pintarTablero() {
  const cont = $('#tablero');
  cont.innerHTML = COLUMNAS.map((col) => {
    const items = estado.pedidos.filter((p) => p.estado === col.clave);
    return `
    <div class="columna">
      <header>${esc(col.titulo)}<span class="cuenta">${items.length}</span></header>
      ${items.length ? items.map((p) => ticket(p, col)).join('')
        : '<div class="vacio" style="padding:1rem;font-size:.85rem">Nada acá</div>'}
    </div>`;
  }).join('');

  cont.querySelectorAll('[data-avanzar]').forEach((b) =>
    b.onclick = () => cambiarEstado(b.dataset.avanzar, b.dataset.a));
  cont.querySelectorAll('[data-cancelar]').forEach((b) =>
    b.onclick = () => { if (confirm('¿Cancelar este pedido?')) cambiarEstado(b.dataset.cancelar, 'cancelado'); });
  // Entregado por error: sin esto la caja queda mal para siempre.
  cont.querySelectorAll('[data-corregir]').forEach((b) => b.onclick = () => {
    const p = estado.pedidos.find((x) => x.id === b.dataset.corregir);
    const r = prompt(`Corregir el pedido de ${p?.mesa ? 'mesa ' + p.mesa : 'sin mesa'} · ${plata(p?.total)}\n\n`
      + '1 = cancelarlo (sale de la caja)\n'
      + '2 = volverlo a Listo\n\n'
      + 'Dejalo vacío para no tocar nada.', '');
    if (r !== '1' && r !== '2') return;
    // Sacarlo de entregado devuelve lo que se había descontado.
    if (p.estado === 'entregado') moverStock(p, +1);
    cambiarEstado(p.id, r === '1' ? 'cancelado' : 'listo');
  });
}

// Quién pidió. El nombre del invitado manda sobre lo que haya escrito a mano:
// es el que la puerta verificó.
export function quienPidio(p) {
  return estado.invitados.find((i) => i.id === p.invitadoId)?.nombre
    || p.nombreCliente
    || (p.mesa ? 'Mesa ' + p.mesa : 'Sin nombre');
}

export function ticket(p, col) {
  const ms = p.creadoEn?.toDate ? Date.now() - p.creadoEn.toDate().getTime() : 0;
  const min = Math.floor(ms / 60000);
  const tarde = col.clave !== 'entregado' && ms > DEMORA_MS;
  // La integridad del total se chequea acá: el cliente manda los precios y las
  // reglas no pueden sumar un array. Si no coincide con la carta de ahora, se marca.
  //
  // Nunca se usa el precio que vino en el pedido como respaldo: un pedido con un
  // id inventado traía su propio precio, cuadraba solo y pasaba sin marcar.
  // Un item que no está en la carta es, por definición, para mirar a mano.
  const hayCarta = estado.carta.length > 0;
  const intrusos = (p.items || []).filter((i) => !estado.carta.some((x) => x.id === i.id));
  const esperado = (p.items || []).reduce((s, i) => {
    const c = estado.carta.find((x) => x.id === i.id);
    return s + Number(c?.precio || 0) * Number(i.cantidad || 0);
  }, 0);
  const desfasado = hayCarta
    && (intrusos.length > 0 || Math.abs(esperado - Number(p.total || 0)) > 0.5);
  const aviso = intrusos.length
    ? `⚠ Tiene algo que no está en la carta (${intrusos.map((i) => esc(i.nombre || i.id)).join(', ')}) — cobralo a mano`
    : `⚠ Total informado ${plata(p.total)} ≠ carta ${plata(esperado)} — cobrar ${plata(esperado)}`;

  return `
  <div class="ticket ${col.clave} ${tarde ? 'demorado' : ''}">
    <div class="cabeza">
      <span class="mesa">${esc(quienPidio(p))}</span>
      ${p.invitadoId ? '<small style="color:var(--oro)">invitado</small>' : ''}
      ${p.mesa ? `<small style="color:var(--suave)">mesa ${esc(p.mesa)}</small>` : ''}
      <span class="reloj ${tarde ? 'tarde' : ''}">${min < 1 ? 'recién' : min + ' min'}</span>
    </div>
    <ul>${(p.items || []).map((i) =>
      `<li><b>${Number(i.cantidad)}×</b> ${esc(i.nombre)}${
        i.opcionNombre ? ` · <b style="color:var(--oro)">${esc(i.opcionNombre)}</b>` : ''}</li>`).join('')}</ul>
    ${p.nota ? `<div class="nota">📝 ${esc(p.nota)}</div>` : ''}
    ${desfasado ? `<div class="sospecha">${aviso}</div>` : ''}
    <div class="pie">
      <span class="total">${plata(desfasado && !intrusos.length ? esperado : p.total)}</span>
      ${col.siguiente ? `<button class="btn primario" data-avanzar="${p.id}" data-a="${col.siguiente}">${col.accion}</button>` : ''}
      ${col.clave !== 'entregado'
        ? `<button class="btn peligro" data-cancelar="${p.id}" title="Cancelar">✕</button>`
        : `<button class="btn solo-gerente-inline" data-corregir="${p.id}" title="Corregir">↩</button>`}
    </div>
  </div>`;
}

// ---------- quién atiende y a qué caja entra ----------
//
// El celular de la barra vive logueado con la cuenta del aparato. Quién está
// atendiendo se elige adentro: es una etiqueta para saber quién vendió, no una
// contraseña. Alcanza para el ranking y para preguntar; no para acusar a nadie.
export function quienAtiende() {
  if (!estado.esAparato) return estado.usuario || 'casa';
  return localStorage.getItem('sotano:atiende') || '';
}

export function pintarQuienAtiende() {
  const btn = $('#btnQuienAtiende');
  if (!btn) return;
  btn.hidden = !estado.esAparato;
  $('#quienAtiende').textContent = quienAtiende() || 'Elegir';
  btn.classList.toggle('alerta', estado.esAparato && !quienAtiende());
}

// Los que pueden estar atendiendo: los asignados a la noche, y si no hay
// noche abierta, todos los barmanes activos. El bar vende igual.
export function barmanesPosibles() {
  // Personas, no aparatos: el que atiende es alguien, no el celular mismo.
  const activos = estado.accesos.filter((a) =>
    a.activo && a.rol !== 'puerta' && a.rol !== 'barra');
  const delTurno = estado.evento?.barmanes || [];
  const deLaNoche = activos.filter((a) => delTurno.includes(a.uid));
  return (deLaNoche.length ? deLaNoche : activos).map((a) => a.usuario);
}

export function elegirQuienAtiende() {
  const gente = barmanesPosibles();
  const actual = quienAtiende();
  const delTurno = (estado.evento?.barmanes || []).length > 0;
  $('#listaAtiende').innerHTML = gente.length
    ? gente.map((g) => `
        <button class="btn ${g === actual ? 'primario' : ''} ancho-full"
                data-atiende="${esc(g)}" style="margin-bottom:.5rem;padding:.9rem">
          ${esc(g)}${g === actual ? ' ✓' : ''}</button>`).join('')
      + (delTurno ? `<p style="color:var(--suave);font-size:.78rem;margin:.6rem 0 0">
          Son los asignados a esta noche.</p>` : '')
    : `<div class="aviso"><span>👤</span><div>
        <b>Todavía no hay barmanes registrados.</b><br>
        Se registran desde el panel de un administrador, en
        <b>Noche → Personal</b>.</div></div>`;
  $('#listaAtiende').querySelectorAll('[data-atiende]').forEach((b) => b.onclick = () => {
    localStorage.setItem('sotano:atiende', b.dataset.atiende);
    pintarQuienAtiende();
    $('#dlgAtiende').close();
  });
  $('#dlgAtiende').showModal();
}

// La caja a la que entra lo que se vende: la del evento abierto, o la del día.
// La noche de bar cruza la medianoche, así que el día no corta a medianoche
// sino a la hora que diga Administración. Ver barra/jornada.js.
export const cajaActual = () => estado.evento?.id || cajaDeHoy();

// ---------- venta de mostrador ----------
// El que compra en la barra no usa la app del cliente: la carga quien atiende,
// con la forma de pago, y nace entregada. Es la venta de todos los días.
export function abrirVenta() {
  estado.venta = {};
  $('#dlgVenta').showModal();
  pintarVenta();
}

// En la barra, un producto con marcas se muestra desarmado: un renglón por
// marca. Acá no hay que preguntar nada —el que atiende ya sabe cuál le
// pidieron— y un diálogo de más por lata es una cola más larga.
export const claveVenta = (id, opcionId) => (opcionId ? `${id}::${opcionId}` : id);
export function partirVenta(clave) {
  const i = clave.indexOf('::');
  return i < 0 ? { id: clave, opcionId: null } : { id: clave.slice(0, i), opcionId: clave.slice(i + 2) };
}

// Cada renglón vendible: el producto solo, o el producto por cada marca.
export function renglonesVendibles() {
  const out = [];
  for (const i of estado.carta.filter((x) => x.enCarta !== false)) {
    const marcas = opcionesDe(i);
    if (!marcas.length) {
      out.push({ clave: i.id, item: i, opcion: null, nombre: i.nombre || i.id,
                 agotado: i.disponible === false });
      continue;
    }
    for (const o of marcas) {
      out.push({
        clave: claveVenta(i.id, o.id), item: i, opcion: o,
        nombre: `${i.nombre || i.id} · ${o.nombre}`,
        agotado: i.disponible === false || Number(i.opcionesStock?.[o.id] ?? 1) <= 0,
      });
    }
  }
  return out;
}

export function totalVenta() {
  return Object.entries(estado.venta).reduce((s, [clave, cant]) => {
    const { id } = partirVenta(clave);
    const c = estado.carta.find((x) => x.id === id);
    return s + Number(c?.precio || 0) * cant;
  }, 0);
}

export function pintarVenta() {
  const vendibles = renglonesVendibles();
  const total = totalVenta();
  const quien = quienAtiende();
  $('#cuerpoVenta').innerHTML = `
    ${estado.esAparato && !quien ? `<div class="aviso mal"><span>⚠</span><div>
      <b>Elegí quién está atendiendo</b> arriba, antes de cobrar.</div></div>` : ''}
    <div class="lista-venta">
      ${vendibles.map((v) => `
        <div class="item ${v.agotado ? 'agotado' : ''}">
          <div class="cuerpo">
            <div class="nombre">${esc(v.nombre)}</div>
            <div class="desc">${plata(v.item.precio)}${v.agotado ? ' · agotado' : ''}</div>
          </div>
          <div class="cant">
            <button data-venta="${esc(v.clave)}" data-d="-1" aria-label="Quitar">−</button>
            <span class="n">${estado.venta[v.clave] || 0}</span>
            <button data-venta="${esc(v.clave)}" data-d="1" aria-label="Agregar"
                    ${v.agotado ? 'disabled' : ''}>+</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="total-venta">
      <span>Total</span><b>${plata(total)}</b>
    </div>
    <div style="display:flex;gap:.6rem;margin-top:.6rem">
      <button class="btn primario" id="btnVentaEfectivo" style="flex:1;padding:.9rem"
              ${!total ? 'disabled' : ''}>💵 Efectivo</button>
      <button class="btn primario" id="btnVentaVirtual" style="flex:1;padding:.9rem"
              ${!total ? 'disabled' : ''}>📲 Virtual</button>
    </div>`;

  $('#cuerpoVenta').querySelectorAll('[data-venta]').forEach((b) => b.onclick = () => {
    const clave = b.dataset.venta;
    const cuanto = (estado.venta[clave] || 0) + Number(b.dataset.d);
    if (cuanto <= 0) delete estado.venta[clave]; else estado.venta[clave] = cuanto;
    pintarVenta();
  });
  if ($('#btnVentaEfectivo')) $('#btnVentaEfectivo').onclick = () => cobrarVenta('efectivo');
  if ($('#btnVentaVirtual')) $('#btnVentaVirtual').onclick = () => cobrarVenta('virtual');
}

export async function cobrarVenta(pago) {
  const items = Object.entries(estado.venta).map(([clave, cantidad]) => {
    const { id, opcionId } = partirVenta(clave);
    const c = estado.carta.find((x) => x.id === id) || {};
    const o = opcionId ? opcionesDe(c).find((x) => x.id === opcionId) : null;
    return {
      id, nombre: c.nombre || id, precio: Number(c.precio || 0), cantidad,
      ...(o ? { opcionId: o.id, opcionNombre: o.nombre } : {}),
    };
  });
  if (!items.length) return;
  const quien = quienAtiende();
  if (estado.esAparato && !quien) { elegirQuienAtiende(); return; }

  const btn = $(pago === 'efectivo' ? '#btnVentaEfectivo' : '#btnVentaVirtual');
  if (btn) { btn.disabled = true; btn.textContent = 'Cobrando…'; }
  try {
    const ref = await addDoc(collection(db, 'pedidos'), {
      clienteId: auth.currentUser.uid,
      estado: 'entregado', origen: 'barra',
      items, total: totalVenta(), pago,
      vendidoPor: quien || estado.usuario || 'casa',
      cajaId: cajaActual(),
      nombreCliente: 'Mostrador',
      creadoEn: serverTimestamp(),
    });
    // Con el id: si no, la venta de mostrador sería la única sin costo
    // anotado, y es la más común de todas.
    await moverStock({ id: ref.id, items }, -1);
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    estado.venta = {};
    $('#dlgVenta').close();
  } catch (e) {
    pintarVenta();
    alert('No se pudo cobrar: ' + (e.code || e.message));
  }
}

// ---------- el stock baja al entregar ----------
//
// Al entregar, no al pedir: lo que todavía no salió de la barra sigue siendo
// stock. Solo se tocan los productos que llevan cuenta; los que están en ∞ no
// se controlan y se dejan como están.
//
// La misma operación que mueve el depósito deja escrito qué queda disponible
// en la carta, en un solo lote. Ver barra/stock.js.
//
// signo = -1 descuenta (se entregó), +1 devuelve (se corrigió un entregado).
export async function moverStock(pedido, signo) {
  // Lo que hay que mover del depósito: se junta todo primero, porque dos
  // tragos distintos pueden salir de la misma botella.
  const porInsumo = new Map();
  const sueltos = new Map();

  for (const i of (pedido?.items || [])) {
    const c = estado.carta.find((x) => x.id === i.id);
    if (!c) continue;
    const cuantos = Number(i.cantidad || 0);
    // Con marca, la receta incluye la caja de esa marca y no la de otra: el
    // que pidió Quilmes descuenta Quilmes.
    const receta = recetaCompleta(c, i.opcionId);
    if (receta.length) {
      // Sale del depósito: una medida por vez, no una botella.
      for (const r of receta) {
        porInsumo.set(r.insumoId,
          (porInsumo.get(r.insumoId) || 0) + Number(r.medidas || 0) * cuantos);
      }
    } else if (typeof c.stock === 'number') {
      // Sin receta: lleva su propio número, como antes. Así lo que todavía no
      // está atado al depósito no se rompe mientras se arma.
      sueltos.set(i.id, (sueltos.get(i.id) || 0) + cuantos);
    }
  }

  const extras = [...sueltos].map(([id, cuantos]) => {
    const c = estado.carta.find((x) => x.id === id);
    const queda = Number(c?.stock || 0) + signo * cuantos;
    return {
      id,
      delta: signo * cuantos,
      // Apagado a mano gana: el depósito no lo vuelve a encender.
      disponible: c?.apagadoAMano === true ? false : queda > 0,
    };
  });

  // El costo de la mercadería se congela acá, en el mismo lote que el
  // movimiento de stock: es el momento en que la mercadería sale de verdad.
  // Deshacer un entregado lo borra, porque lo que no salió no costó nada.
  const apuntes = pedido?.id ? [{
    coleccion: 'pedidos',
    id: pedido.id,
    datos: signo === -1
      ? (({ mercaderia, de }) => ({ costoMercaderia: mercaderia, costoDe: de }))(costoDeItems(pedido.items))
      : { costoMercaderia: null, costoDe: null },
  }] : [];

  await moverInsumos(
    [...porInsumo].map(([insumoId, medidas]) => ({ insumoId, delta: signo * medidas })),
    extras,
    apuntes,
  ).catch(() => {});
}

// ---------- cobrar ----------
// Al entregar hay que decir cómo pagó: un toque, y la caja queda cerrada en el
// momento. Si se deja para después, no se hace nunca.
export let cobrando = null;

// Lo pide el arranque: desde otro módulo no se puede asignar una variable
// importada, así que el que la tiene es el que la limpia.
export function cancelarCobro() {
  cobrando = null;
  $('#dlgCobro').close();
}
export function pedirPago(pedido) {
  cobrando = pedido;
  $('#detalleCobro').textContent =
    `${quienPidio(pedido)} · ${plata(pedido.total)}`;
  $('#dlgCobro').showModal();
}

export async function cerrarCobro(pago) {
  const p = cobrando;
  cobrando = null;
  $('#dlgCobro').close();
  if (!p) return;
  try {
    await updateDoc(doc(db, 'pedidos', p.id), {
      estado: 'entregado', pago, vendidoPor: quienAtiende() || estado.usuario || 'casa',
    });
    // Recién acá sale de la barra: ahora sí baja el stock.
    if (p.estado !== 'entregado') await moverStock(p, -1);
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) { alert('No se pudo cobrar: ' + (e.code || e.message)); }
}

export async function cambiarEstado(id, nuevo) {
  // Entregar es cobrar: no se pasa de largo.
  if (nuevo === 'entregado') {
    const p = estado.pedidos.find((x) => x.id === id);
    if (p) return pedirPago(p);
  }
  try {
    await updateDoc(doc(db, 'pedidos', id), { estado: nuevo });
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) {
    alert('No se pudo cambiar el estado: ' + (e.code || e.message));
  }
}

export function pintarCaja() {
  const r = resumirCaja(estado.pedidos);
  const chip = $('#chipCaja');
  // Con evento abierto la caja es la del evento; si no, la del día.
  chip.textContent = `${estado.evento ? esc(estado.evento.nombre) + ' · ' : ''}`
    + `${r.sinCerrar} en curso · ${plata(r.facturado)}`;
  chip.className = 'chip ' + (r.sinCerrar > 6 ? 'alerta' : 'ok');
}

// ---------- carta y stock ----------
// ---------- aviso sonoro ----------
export let ctxAudio;
export function avisar() {
  if (navigator.vibrate) navigator.vibrate([90, 70, 90]);
  if (!estado.sonido) return;
  try {
    ctxAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
    // Dos notas cortas: audible sobre la música sin ser una alarma.
    [[880, 0], [1320, 0.14]].forEach(([hz, t]) => {
      const o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, ctxAudio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctxAudio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + t + 0.13);
      o.connect(g); g.connect(ctxAudio.destination);
      o.start(ctxAudio.currentTime + t); o.stop(ctxAudio.currentTime + t + 0.15);
    });
  } catch {}
}

export function pintarSonido() {
  $('#btnSonido').textContent = estado.sonido ? '🔔' : '🔕';
  $('#btnSonido').title = estado.sonido ? 'Aviso sonoro activado' : 'Aviso sonoro silenciado';
}
$('#btnSonido').onclick = () => {
  estado.sonido = !estado.sonido;
  localStorage.setItem('sotano:sonido', estado.sonido ? 'si' : 'no');
  pintarSonido();
  if (estado.sonido) avisar();   // también desbloquea el audio en móviles
};
