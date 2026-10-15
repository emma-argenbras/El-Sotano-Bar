// Deja la app en cero para arrancar a trabajar en serio.
//
// Borra lo que se hizo probando: ventas, gastos, ingresos de mercadería,
// conteos, eventos y sus invitados. NO borra nunca las cuentas del personal,
// la carta, los insumos ni el alias de cobro: eso es la app, no los datos de
// prueba.
//
// Por defecto NO borra nada: muestra qué borraría. Para que lo haga hay que
// agregar --aplicar.
//
//   node scripts/resetear.mjs --plata                     (mira)
//   node scripts/resetear.mjs --plata --aplicar           (borra)
//
// Qué se puede pedir:
//   --plata       ventas, gastos, ingresos de mercadería, conteos, el turno
//   --proveedores las fichas de proveedores (sus cuentas quedan vacías igual)
//   --eventos     eventos, listas de invitados, anotados y registros
//   --stock       pone en cero lo que hay guardado de cada insumo
//   --bajas       el historial de insumos dados de baja
//   --todo        todo lo de arriba
//
// Lo que NUNCA toca: accesosBarra (las cuentas), carta, insumos (los
// productos en sí), publico (el alias de cobro y el estado del local).
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';

const pedido = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const aplicar = pedido.delete('--aplicar');
const todo = pedido.has('--todo');
const quiere = (q) => todo || pedido.has('--' + q);

if (!todo && !pedido.size) {
  console.log(`Falta decir qué resetear.

  --plata        ventas, gastos, ingresos de mercadería, conteos y el turno
  --proveedores  las fichas de proveedores
  --eventos      eventos, invitados, anotados y registros
  --stock        pone en cero lo guardado de cada insumo
  --bajas        el historial de bajas
  --todo         todo junto

Sin --aplicar solo muestra qué borraría.`);
  process.exit(1);
}

iniciar();
const db = getFirestore();

// Borrar de a 400 porque un lote de Firestore aguanta 500 escrituras.
async function vaciar(ref, como) {
  const snap = await ref.get();
  if (!snap.size) { console.log(`  · ${como}: ya está vacío`); return 0; }
  if (!aplicar) { console.log(`  · ${como}: ${snap.size} para borrar`); return snap.size; }
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = db.batch();
    for (const d of snap.docs.slice(i, i + 400)) lote.delete(d.ref);
    await lote.commit();
  }
  console.log(`  · ${como}: ${snap.size} borrados`);
  return snap.size;
}

let total = 0;
console.log(aplicar ? '\nBORRANDO\n' : '\nESTO BORRARÍA (nada se tocó todavía)\n');

if (quiere('plata')) {
  console.log('La plata:');
  total += await vaciar(db.collection('pedidos'), 'ventas y pedidos');
  total += await vaciar(db.collection('egresos'), 'gastos');
  total += await vaciar(db.collection('compras'), 'ingresos de mercadería');
  total += await vaciar(db.collection('conteos'), 'conteos de la noche');
  const turno = db.doc('barra/turno');
  if ((await turno.get()).exists) {
    console.log('  · el turno abierto: 1 para borrar');
    if (aplicar) await turno.delete();
    total += 1;
  }
}

if (quiere('proveedores')) {
  console.log('Los proveedores:');
  total += await vaciar(db.collection('proveedores'), 'fichas de proveedores');
}

if (quiere('eventos')) {
  console.log('Los eventos:');
  total += await vaciar(db.collection('barra').doc('eventos').collection('items'), 'eventos');
  total += await vaciar(db.collection('registros'), 'registros de las noches');
  total += await vaciar(db.collection('invitados'), 'invitados');
  total += await vaciar(db.collection('anotados'), 'candados de anotados');
}

if (quiere('bajas')) {
  console.log('El historial:');
  total += await vaciar(db.collection('bajas'), 'bajas de insumos');
}

if (quiere('stock')) {
  console.log('El stock:');
  const insumos = await db.collection('insumos').get();
  const conStock = insumos.docs.filter((d) => Number(d.data().stock || 0) !== 0);
  if (!conStock.length) console.log('  · ya está todo en cero');
  else if (!aplicar) console.log(`  · ${conStock.length} insumos quedarían en cero`);
  else {
    const lote = db.batch();
    for (const d of conStock) lote.update(d.ref, { stock: 0 });
    await lote.commit();
    console.log(`  · ${conStock.length} insumos en cero`);
  }
  total += conStock.length;
}

console.log(aplicar
  ? `\nListo: ${total} cosas borradas. Lo que no se nombró quedó intacto.`
  : `\n${total} en total. Volvé a correrlo con --aplicar para que lo haga.`);
