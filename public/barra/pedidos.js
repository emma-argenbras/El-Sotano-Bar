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
  writeBatch,
} from '/vendor/firebase.js';
import { $, COLUMNAS, DEMORA_MS, esc, estado, plata } from './base.js';
import { costoDeItems, moverInsumos, opcionesDe, recetaCompleta } from './stock.js';
import { app, auth, db, pintarConexion, sinAcceso } from './conexion.js';
import { cajaDeHoy, fechaDeHoy } from './jornada.js';
import { preciosDe } from './cartas.js';
import { desdeCuando, pintarEvento, resumirCaja } from './eventos.js';
import { avisarCasa, pedidosPorConfirmar, pintarAvisos } from './avisos.js';
import { hora } from './invitados.js';
import { pedirMotivo, registrar } from './registro.js';

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
  transferenciasVistas = null;
  const q = query(
    collection(db, 'pedidos'),
    where('creadoEn', '>=', Timestamp.fromDate(desde)),
    orderBy('creadoEn', 'asc'),
  );
  // Si ya llegó la primera foto del servidor. Antes se miraba si había
  // algún pedido visto, y con la lista vacía —el arranque de cada noche— el
  // primer pedido entraba sin sonar.
  let yaCargo = false;
  dejarDeEscucharPedidos = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    estado.desdeCache = snap.metadata.fromCache;
    pintarConexion();
    const antes = yaCargo;
    if (!snap.metadata.fromCache) yaCargo = true;
    const nuevos = [];
    snap.docChanges().forEach((c) => {
      if (c.type === 'added' && !estado.vistos.has(c.doc.id)) nuevos.push(c.doc.id);
    });
    estado.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.pedidos.forEach((p) => estado.vistos.add(p.id));
    pintarTablero();
    pintarCaja();
    pintarEvento();
    // La campanita cuenta los pedidos con transferencia sin confirmar.
    pintarAvisos();
    avisarPedidosConTransferencia();
    // No sonar en la carga inicial, solo cuando entra algo nuevo estando ya abierto.
    if (antes && nuevos.some((id) => estado.pedidos.find((p) => p.id === id)?.estado === 'nuevo')) avisar();
  }, (e) => {
    if (e.code === 'permission-denied') sinAcceso();
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
  cont.querySelectorAll('[data-cancelar]').forEach((b) => b.onclick = () => {
    const p = estado.pedidos.find((x) => x.id === b.dataset.cancelar);
    // Ya tiene la plata confirmada: cancelarlo es anular un cobro. Lo hace un
    // superadministrador, con motivo y registro, como con un entregado.
    if (p?.pago) {
      if (!estado.sadmin) {
        alert('Este pedido ya está cobrado: anularlo lo hace Carli, con motivo.');
        return;
      }
      anularConMotivo(p, 'cancelado', 'Anular un pedido ya cobrado',
        `${quienPidio(p)} · ${plata(p.total)} · cobrado en ${p.pago}\nSi la plata llegó, hay que devolverla.`, 'Anular');
      return;
    }
    // Si dijo que transfirió, la plata puede estar en el banco: cancelar no
    // la devuelve. Queda en la campanita hasta que la casa lo resuelva.
    const pregunta = p && esperaConfirmacion(p)
      ? 'Dijo que transfirió y nadie confirmó la plata.\n\nSi la transferencia llegó, hay que devolverla. ¿Cancelar el pedido igual?'
      : '¿Cancelar este pedido?';
    if (confirm(pregunta)) cambiarEstado(b.dataset.cancelar, 'cancelado');
  });
  cont.querySelectorAll('[data-cobrar-pedido]').forEach((b) =>
    b.onclick = () => confirmarCobroPedido(b.dataset.cobrarPedido, b));
  // Entregado por error: sin esto la caja queda mal para siempre.
  cont.querySelectorAll('[data-corregir]').forEach((b) => b.onclick = () =>
    corregirEntregado(estado.pedidos.find((x) => x.id === b.dataset.corregir)));
}

// Sacar un pedido de entregado saca plata de la caja: anularlo, o volverlo
// a Listo para cobrarlo de nuevo. Lo hace un superadministrador, con motivo,
// y en la misma escritura queda la entrada del registro (las reglas la
// piden). El dueño lo ve en su campanita. Después se devuelve el stock.
export async function corregirEntregado(p) {
  if (!p) return;
  const r = prompt(`Corregir el pedido de ${quienPidio(p)} · ${plata(p.total)}\n\n`
    + '1 = anularlo (sale de la caja)\n'
    + '2 = volverlo a Listo, para cobrarlo de nuevo\n\n'
    + 'Dejalo vacío para no tocar nada.', '');
  if (r !== '1' && r !== '2') return;
  const nuevo = r === '1' ? 'cancelado' : 'listo';
  await anularConMotivo(p, nuevo,
    r === '1' ? 'Anular un pedido entregado' : 'Volver a Listo un pedido entregado',
    `${quienPidio(p)} · ${plata(p.total)}${p.pago ? ' · cobrado en ' + p.pago : ''}\n`
      + (r === '1' ? 'Sale de la caja y se devuelve el stock.' : 'Se devuelve el stock y al entregarlo se vuelve a cobrar.'),
    r === '1' ? 'Anular' : 'Volver a Listo');
}

// La escritura de toda corrección que saca plata: motivo, entrada del
// registro y el cambio de estado en un solo lote. Si estaba entregado,
// después se devuelve el stock.
async function anularConMotivo(p, nuevo, titulo, texto, boton) {
  const motivo = await pedirMotivo({ titulo, texto, boton });
  if (!motivo) return;
  const n = Number(p.vecesCorregido || 0) + 1;
  try {
    const lote = writeBatch(db);
    registrar(lote, `anular-pedido-${p.id}-${n}`, 'anular-pedido', motivo, {
      pedidoId: p.id, quien: quienPidio(p), total: Number(p.total || 0),
      pago: p.pago || '', de: p.estado, a: nuevo,
    });
    lote.update(doc(db, 'pedidos', p.id), { estado: nuevo, vecesCorregido: n });
    await lote.commit();
    // Sacarlo de entregado devuelve lo que se había descontado.
    if (p.estado === 'entregado') await moverStock(p, +1);
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// Quién pidió. El nombre del invitado manda sobre lo que haya escrito a mano:
// es el que la puerta verificó.
export function quienPidio(p) {
  return estado.invitados.find((i) => i.id === p.invitadoId)?.nombre
    || p.nombreCliente
    || (p.mesa ? 'Mesa ' + p.mesa : 'Sin nombre');
}

// Dijo que transfiere y la casa todavía no vio la plata.
export const esperaConfirmacion = (p) => p.pagoElegido === 'virtual' && !p.pago;

// Cómo se paga, en el ticket. Para la transferencia, en qué está: es lo que
// decide si el pedido se puede entregar o no.
function lineaPago(p, col) {
  const quien = (campo) => (p[campo] ? ' · ' + esc(p[campo]) : '');
  if (col.clave === 'entregado') {
    if (!p.pago) return '';
    return `<div class="pago">${p.pago === 'virtual' ? '📲 Transferencia' : '💵 Efectivo'}${
      p.pagoElegido === 'virtual' ? quien('cobradoPor') : ''}</div>`;
  }
  if (p.pagoElegido === 'virtual') {
    if (esperaConfirmacion(p)) {
      return `<div class="pago espera">📲 Dice que transfirió ${hora(p.avisoPagoEn)} · <b>falta que la casa la confirme</b>
           <button class="btn primario solo-gerente-inline" data-cobrar-pedido="${p.id}"
                   title="Confirmar que llegó la transferencia">Cobrado</button></div>`;
    }
    // Dijo que transfería pero la casa lo cobró en efectivo —la plata nunca
    // llegó y pagó en la barra—: se dice tal cual, y no hay nada que deshacer.
    if (p.pago === 'efectivo') {
      return `<div class="pago ok">💵 Cobrado en efectivo${quien('cobradoPor')} ${hora(p.cobradoEn)}</div>`;
    }
    return `<div class="pago ok">📲 Transferencia confirmada${quien('cobradoPor')} ${hora(p.cobradoEn)}
           <button class="btn solo-gerente-inline" data-cobrar-pedido="${p.id}"
                   title="Deshacer: no había llegado">Sin cobrar</button></div>`;
  }
  if (p.pagoElegido === 'efectivo') return '<div class="pago">💵 Paga en la barra</div>';
  return '';
}

// El botón que lo mueve de columna. Entregar un pedido con transferencia sin
// confirmar no es del barman: lo que ve es que falta la casa. Quien puede
// confirmar —la casa— sí lo puede entregar, y de paso la confirma.
function botonAvanzar(p, col) {
  if (!col.siguiente) return '';
  const frena = col.siguiente === 'entregado' && esperaConfirmacion(p);
  return `${frena ? '<span class="chip alerta" title="Hasta que la casa confirme la transferencia, no se entrega">⏳ Sin confirmar</span>' : ''}
    <button class="btn primario ${frena ? 'solo-gerente-inline' : ''}" data-avanzar="${p.id}" data-a="${col.siguiente}">${col.accion}</button>`;
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
  // El precio con el que se compara es el de LA NOCHE DEL PEDIDO, no el de
  // hoy. Si una noche tuvo carta propia y se comparara contra la de siempre,
  // cada pedido legítimo de esa noche saldría marcado como adulterado.
  const precios = preciosDe(fechaDelPedido(p));
  const precioDe = (id) => (precios && precios[id] !== undefined
    ? Number(precios[id])
    : Number(estado.carta.find((x) => x.id === id)?.precio || 0));

  const hayCarta = estado.carta.length > 0;
  const intrusos = (p.items || []).filter((i) => !estado.carta.some((x) => x.id === i.id));
  const esperado = (p.items || []).reduce(
    (s, i) => s + precioDe(i.id) * Number(i.cantidad || 0), 0);
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
    ${lineaPago(p, col)}
    <div class="pie">
      <span class="total">${plata(desfasado && !intrusos.length ? esperado : p.total)}</span>
      ${botonAvanzar(p, col)}
      ${col.clave !== 'entregado'
        ? `<button class="btn peligro" data-cancelar="${p.id}" title="Cancelar">✕</button>`
        : `<button class="btn solo-sadmin" data-corregir="${p.id}" title="Corregir">↩</button>`}
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

// De qué noche es un pedido. El id de caja de un día común ya la lleva
// adentro; el de un evento no, así que se saca de cuándo se hizo.
export function fechaDelPedido(p) {
  const caja = String(p?.cajaId || '');
  if (caja.startsWith('dia-')) return caja.slice('dia-'.length);
  const cuando = p?.creadoEn?.toDate?.();
  return fechaDeHoy(cuando || undefined);
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

// La carta del mostrador es la de esta noche: si la noche tiene carta
// propia, solo lo que está en ella y a su precio. Antes cobraba siempre con
// la de todos los días, y el tablero marcaba la venta como adulterada.
function cartaDeEstaNoche() {
  const precios = preciosDe(fechaDeHoy());
  const vendible = estado.carta.filter((x) => x.enCarta !== false);
  if (!precios) return vendible;
  return vendible.filter((x) => precios[x.id] !== undefined)
    .map((x) => ({ ...x, precio: Number(precios[x.id]) }));
}

// Cada renglón vendible: el producto solo, o el producto por cada marca.
export function renglonesVendibles() {
  const out = [];
  for (const i of cartaDeEstaNoche()) {
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
    const c = cartaDeEstaNoche().find((x) => x.id === id);
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
    const c = cartaDeEstaNoche().find((x) => x.id === id) || {};
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
  ).catch((e) => {
    // Antes se tragaba el error: el pedido quedaba cobrado sin descontar el
    // stock ni congelar el costo, y nadie se enteraba.
    alert(`Se ${signo === -1 ? 'entregó' : 'corrigió'}, pero no se pudo mover el stock `
      + `(${e.code || e.message}).\n\nAvisale a Carli: el depósito quedó sin actualizar.`);
  });
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
  // Qué dijo el cliente, para que el que cobra no adivine. Con transferencia
  // sin confirmar, 📲 es confirmarla: solo si se la vio en el banco.
  const dijo = pedido.pagoElegido === 'virtual'
    ? ` · dijo que transfirió${pedido.avisoPagoEn ? ' a las ' + hora(pedido.avisoPagoEn) : ''}: 📲 solo si la viste en el banco`
    : pedido.pagoElegido === 'efectivo' ? ' · dijo que paga en efectivo' : '';
  $('#detalleCobro').textContent =
    `${quienPidio(pedido)} · ${plata(pedido.total)}${dijo}`;
  $('#dlgCobro').showModal();
}

export async function cerrarCobro(pago) {
  const p = cobrando;
  cobrando = null;
  $('#dlgCobro').close();
  if (!p) return;
  // Otro celular ya lo entregó mientras este preguntaba cómo pagó: no se
  // cobra ni se descuenta dos veces (las reglas tampoco lo dejan).
  if (estado.pedidos.find((x) => x.id === p.id)?.estado === 'entregado') {
    alert(`Ese pedido ya lo entregó otro (${estado.pedidos.find((x) => x.id === p.id)?.vendidoPor || 'la barra'}).`);
    return;
  }
  const quien = quienAtiende() || estado.usuario || 'casa';
  try {
    await updateDoc(doc(db, 'pedidos', p.id), {
      estado: 'entregado', pago, vendidoPor: quien,
      // Quién vio la plata y cuándo. Para el efectivo es el mismo que
      // entrega; para una transferencia, es la confirmación que faltaba.
      cobradoEn: serverTimestamp(), cobradoPor: quien,
    });
    // Recién acá sale de la barra: ahora sí baja el stock.
    if (p.estado !== 'entregado') await moverStock(p, -1);
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) { alert('No se pudo cobrar: ' + (e.code || e.message)); }
}

// Con la plata ya confirmada no hay nada que preguntar: se entrega y se
// anota quién. Es el caso del pedido con transferencia que la casa confirmó.
async function entregarCobrado(p) {
  try {
    await updateDoc(doc(db, 'pedidos', p.id), {
      estado: 'entregado', vendidoPor: quienAtiende() || estado.usuario || 'casa',
    });
    if (p.estado !== 'entregado') await moverStock(p, -1);
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) { alert('No se pudo entregar: ' + (e.code || e.message)); }
}

// La casa vio la transferencia en el banco. Un campo, una hora del servidor
// y quién lo confirmó; el pedido queda listo para que la barra lo entregue
// sin preguntar nada. Se puede deshacer, por si se confundió de pedido:
// vuelve a esperar, y no se entrega hasta confirmarlo de nuevo.
export async function confirmarCobroPedido(id, boton) {
  const p = estado.pedidos.find((x) => x.id === id);
  if (!p) return;
  const yaCobrado = !!p.pago;
  if (yaCobrado && !confirm(`¿Marcar el pedido de ${quienPidio(p)} como NO cobrado?\n\n`
    + 'Vuelve a esperar la transferencia: hasta que la confirmes de nuevo, no se entrega.')) return;
  if (boton) boton.disabled = true;
  try {
    await updateDoc(doc(db, 'pedidos', id), yaCobrado
      ? { pago: null, cobradoEn: null, cobradoPor: null }
      : { pago: 'virtual', cobradoEn: serverTimestamp(),
          cobradoPor: quienAtiende() || estado.usuario || 'la casa' });
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) {
    alert('No se pudo: ' + (e.code || e.message));
  } finally {
    if (boton) boton.disabled = false;
  }
}

// Los pedidos con transferencia que ya se vieron, para avisar solo los
// nuevos. null hasta la primera foto: lo que ya estaba al abrir no es
// novedad. Mismo mecanismo que el de las entradas, en invitados.js.
let transferenciasVistas = null;

function avisarPedidosConTransferencia() {
  const ahora = new Set(pedidosPorConfirmar().map((p) => p.id));
  if (transferenciasVistas !== null) {
    for (const p of estado.pedidos) {
      if (!ahora.has(p.id) || transferenciasVistas.has(p.id)) continue;
      avisarCasa(`${quienPidio(p)} pidió y dice que transfirió`,
        `${plata(p.total)} · ${hora(p.avisoPagoEn)} · revisá el banco y tocá Cobrado`,
        'sotano-transferencia-pedido-' + p.id);
    }
  }
  transferenciasVistas = ahora;
}

export async function cambiarEstado(id, nuevo) {
  // Entregar es cobrar: no se pasa de largo.
  if (nuevo === 'entregado') {
    const p = estado.pedidos.find((x) => x.id === id);
    // Salvo la transferencia que la casa ya confirmó: ahí no hay nada que
    // preguntar. Para todo lo demás se pregunta siempre, aunque ya tenga un
    // pago anotado: ↩ → "volverlo a Listo" → Entregado es la forma de
    // corregir un cobro mal cargado, y si no preguntara, no habría otra.
    if (p && p.pagoElegido === 'virtual' && p.pago === 'virtual') return entregarCobrado(p);
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

// El interruptor del sonido vive en avisos.js, adentro de la campanita:
// tocar la campana abre los avisos, no silencia.
