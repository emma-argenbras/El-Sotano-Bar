// Copia al registro de cada noche los datos que el invitado necesita y que
// quedaron solo en el evento: la fecha y el precio de la entrada.
//
// Hace falta porque esos campos se agregaron después: las noches creadas
// antes tienen el registro sin ellos, y su invitación no dice ni cuándo es ni
// cuánto sale. El registro es lo único que el invitado puede leer — el
// documento del evento no lo ve nadie de afuera.
//
//   node scripts/completar-registros.mjs            (muestra qué falta)
//   node scripts/completar-registros.mjs --aplicar  (lo completa)
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';

iniciar();
const db = getFirestore();

const aplicar = process.argv.includes('--aplicar');

const registros = await db.collection('registros').get();
if (registros.empty) {
  console.log('No hay registros.');
  process.exit(0);
}

let faltan = 0;
for (const d of registros.docs) {
  const r = d.data();
  const ev = await db.doc(`barra/eventos/items/${d.id}`).get();
  if (!ev.exists) {
    console.log(`· ${r.nombre || d.id}: no encuentro su evento, lo dejo como está`);
    continue;
  }
  const parche = {};
  // Solo lo que falta: si alguien ya lo corrigió a mano, no se pisa.
  if (!r.fecha && ev.data().fecha) parche.fecha = ev.data().fecha;
  if (r.entrada === undefined && ev.data().entrada !== undefined) {
    parche.entrada = Number(ev.data().entrada || 0);
  }
  if (!Object.keys(parche).length) {
    console.log(`✓ ${r.nombre || d.id}: completo`);
    continue;
  }
  faltan += 1;
  const dice = Object.entries(parche)
    .map(([k, v]) => `${k}=${k === 'fecha' ? v.toDate().toLocaleDateString('es-AR') : v}`)
    .join(' ');
  if (!aplicar) {
    console.log(`! ${r.nombre || d.id}: le falta ${dice}`);
    continue;
  }
  await d.ref.update(parche);
  console.log(`✓ ${r.nombre || d.id}: completado con ${dice}`);
}

if (faltan && !aplicar) {
  console.log(`\n${faltan} noche(s) incompleta(s). Agregá --aplicar para completarlas.`);
} else if (!faltan) {
  console.log('\nNada que completar.');
}
process.exit(0);
