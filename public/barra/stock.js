// El stock del depósito y lo que eso deja disponible en la carta.
//
// La regla de la casa: el stock solo se mueve por una acción de la app —una
// venta, un ingreso de mercadería, un ajuste, un conteo aplicado— y esa misma
// operación deja escrito qué productos quedan disponibles. Todo junto, en un
// lote: si algo falla, no queda el depósito movido y la carta mintiendo.
//
// Nada de esto depende de que haya un celular prendido mirando: lo escribe el
// que hizo la operación, que por definición estaba ahí.
import { writeBatch, doc, increment } from '/vendor/firebase.js';
import { estado } from './base.js';
import { db } from './conexion.js';

// Cuántas veces sale un producto con el stock que se le pase. Infinity es
// "no lleva cuenta": los productos sin receta no salen del depósito.
export function rindeCon(item, stockPorInsumo) {
  const receta = (item.receta || []).filter((r) => Number(r.medidas) > 0);
  if (!receta.length) return Infinity;
  let menor = Infinity;
  for (const r of receta) {
    const hay = stockPorInsumo.get(r.insumoId);
    // Un insumo que ya no está deja al producto sin de dónde salir.
    if (hay === undefined) return 0;
    menor = Math.min(menor, Math.floor(hay / Number(r.medidas)));
  }
  return Math.max(0, menor);
}

// El stock que va a quedar después del movimiento, según lo que el panel tiene
// en memoria. Es una estimación: la resta de verdad la hace el servidor con
// increment, así que si otro celular vendió en el mismo segundo este número
// puede quedar corto por un instante. El siguiente movimiento —o el próximo
// cambio que llegue del servidor— lo corrige.
function stockDespues(movimientos) {
  const mapa = new Map(estado.insumos.map((i) => [i.id, Number(i.stock || 0)]));
  for (const m of movimientos) {
    if (!mapa.has(m.insumoId)) continue;
    mapa.set(m.insumoId, m.valor !== undefined
      ? Number(m.valor)
      : mapa.get(m.insumoId) + Number(m.delta || 0));
  }
  return mapa;
}

// Qué productos de la carta tocan esos insumos. Sale de lo que el panel ya
// tiene cargado; un producto al que le acaban de poner receta en otro
// dispositivo entra en el siguiente movimiento.
export function productosQueUsan(insumoIds) {
  const ids = new Set(insumoIds);
  return estado.carta.filter((c) =>
    (c.receta || []).some((r) => ids.has(r.insumoId)));
}

// Agrega al lote lo que hay que escribir en la carta por un movimiento de
// stock: cuántas salen y si está disponible.
//
// apagadoAMano gana siempre. Se rompió la botella, se volcó el balde de hielo:
// el depósito dice que hay, pero no hay. Mientras esté puesta, el cálculo
// mira y no toca.
export function apuntarDisponibilidad(lote, movimientos, quedan) {
  const mapa = quedan || stockDespues(movimientos);
  const tocados = productosQueUsan(movimientos.map((m) => m.insumoId));
  for (const c of tocados) {
    const rinde = rindeCon(c, mapa);
    const disponible = c.apagadoAMano === true ? false : rinde > 0;
    if (c.stock === rinde && c.disponible === disponible) continue;
    lote.update(doc(db, 'carta', c.id), { stock: rinde, disponible });
  }
  return tocados.length;
}

// Lo que le cuesta a la casa una unidad de un producto, según su receta y lo
// que valen hoy los insumos. null = no se sabe: falta el costo de al menos
// una botella, y media cuenta es peor que ninguna.
export function costoDeReceta(item) {
  const receta = (item.receta || []).filter((r) => Number(r.medidas) > 0);
  if (!receta.length) return null;
  let total = 0;
  for (const r of receta) {
    const ins = estado.insumos.find((i) => i.id === r.insumoId);
    if (!ins || !Number(ins.costo || 0)) return null;
    const medidas = Math.max(1, Number(ins.medidas || 1));
    total += Number(ins.costo) / medidas * Number(r.medidas);
  }
  return Math.round(total);
}

// Lo que costó la mercadería de una venta, con los precios de HOY.
//
// Se calcula una sola vez, cuando el pedido se entrega, y queda escrito en el
// pedido. Antes el costo salía siempre de los insumos actuales: entraba una
// compra con el fernet más caro y la ganancia de las noches pasadas se movía
// sola, sin que nadie hubiera tocado nada. Un número cerrado que cambia solo
// no es un número.
//
// Devuelve también 'de': cuánto de lo vendido tiene costo conocido. Sin eso,
// una ganancia calculada sobre la mitad de la carta se muestra como si fuera
// la ganancia entera.
export function costoDeItems(items) {
  let mercaderia = 0;
  let de = 0;
  for (const i of (items || [])) {
    const c = estado.carta.find((x) => x.id === i.id);
    const unitario = c ? costoDeReceta(c) : null;
    if (unitario === null) continue;
    const cuantos = Number(i.cantidad || 0);
    mercaderia += unitario * cuantos;
    de += Number(i.precio || 0) * cuantos;
  }
  return { mercaderia: Math.round(mercaderia), de: Math.round(de) };
}

// Mueve el stock de varios insumos y deja la carta al día, en un solo lote.
//
//   moverInsumos([{ insumoId, delta: -2 }])     resta dos medidas
//   moverInsumos([{ insumoId, valor: 40 }])     lo deja en cuarenta
//
// La resta la hace el servidor con increment: dos celulares vendiendo a la vez
// no se pisan, y sin señal el lote queda encolado y sale al volver. Una
// transacción haría lo primero pero no lo segundo, y el bar está abajo.
export async function moverInsumos(movimientos, extras, apuntes) {
  const reales = movimientos.filter((m) =>
    estado.insumos.some((i) => i.id === m.insumoId));
  if (!reales.length && !(extras || []).length && !(apuntes || []).length) return;

  const lote = writeBatch(db);
  for (const m of reales) {
    lote.update(doc(db, 'insumos', m.insumoId), m.valor !== undefined
      ? { stock: Math.max(0, Number(m.valor)) }
      : { stock: increment(Number(m.delta || 0)) });
  }
  // Lo que no sale del depósito y lleva su propio número: los productos de la
  // carta sin receta.
  for (const e of (extras || [])) {
    lote.update(doc(db, 'carta', e.id), {
      stock: increment(Number(e.delta || 0)),
      ...(e.disponible === undefined ? {} : { disponible: e.disponible }),
    });
  }
  // Lo que hay que dejar anotado en el mismo lote que el movimiento. Hoy es
  // el costo de la mercadería de un pedido entregado: si se escribiera aparte
  // y fallara, quedaría stock descontado sin costo, o al revés.
  for (const a of (apuntes || [])) {
    lote.update(doc(db, a.coleccion, a.id), a.datos);
  }
  apuntarDisponibilidad(lote, reales);
  await lote.commit();
}
