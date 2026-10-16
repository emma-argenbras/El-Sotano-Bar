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

// Mueve el stock de varios insumos y deja la carta al día, en un solo lote.
//
//   moverInsumos([{ insumoId, delta: -2 }])     resta dos medidas
//   moverInsumos([{ insumoId, valor: 40 }])     lo deja en cuarenta
//
// La resta la hace el servidor con increment: dos celulares vendiendo a la vez
// no se pisan, y sin señal el lote queda encolado y sale al volver. Una
// transacción haría lo primero pero no lo segundo, y el bar está abajo.
export async function moverInsumos(movimientos, extras) {
  const reales = movimientos.filter((m) =>
    estado.insumos.some((i) => i.id === m.insumoId));
  if (!reales.length && !(extras || []).length) return;

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
  apuntarDisponibilidad(lote, reales);
  await lote.commit();
}
