// Carga una carta de arranque. Es idempotente: volver a correrlo no duplica
// ni pisa precios ya ajustados desde el panel, salvo que pases --forzar.
//
//   npm run seed            carga lo que falte
//   npm run seed -- --forzar  reescribe todo
import { getFirestore } from 'firebase-admin/firestore';
import { iniciar } from './_admin.mjs';

const forzar = process.argv.includes('--forzar');

const CARTA = [
  // id,            nombre,                  categoria,   precio, orden, descripcion
  ['fernet',        'Fernet con coca',       'Tragos',      4500, 1, 'El clásico. Hielo aparte si querés.'],
  ['gin-tonic',     'Gin tonic',             'Tragos',      5200, 2, 'Con pepino y enebro.'],
  ['negroni',       'Negroni',               'Tragos',      5800, 3, 'Gin, campari y vermut rosso.'],
  ['caipirinha',    'Caipirinha',            'Tragos',      5000, 4, 'Cachaça, lima y azúcar.'],
  ['vermut',        'Vermut con soda',       'Tragos',      3800, 5, 'Rojo, con rodaja de naranja.'],

  ['birra-tirada',  'Birra tirada (pinta)',  'Cervezas',    3900, 1, 'Rubia de la casa.'],
  ['ipa',           'IPA (pinta)',           'Cervezas',    4300, 2, 'Lupulada, amarga.'],
  ['porter',        'Porter (pinta)',        'Cervezas',    4300, 3, 'Negra, tostada.'],

  ['copa-malbec',   'Copa de Malbec',        'Vinos',       4200, 1, 'Mendoza.'],
  ['copa-blanco',   'Copa de Torrontés',     'Vinos',       4000, 2, 'Salta, fresco.'],

  ['papas',         'Papas bravas',          'Para picar',  5500, 1, 'Con alioli y picante.'],
  ['rabas',         'Rabas',                 'Para picar',  8900, 2, 'Con limón.'],
  ['tabla',         'Tabla de fiambres',     'Para picar', 12500, 3, 'Para dos o tres.'],
  ['empanadas',     'Empanadas (x3)',        'Para picar',  5400, 4, 'Carne o verdura.'],
  ['provoleta',     'Provoleta',             'Para picar',  6800, 5, 'Con orégano y aceite de oliva.'],

  ['agua',          'Agua sin gas',          'Sin alcohol', 2200, 1, ''],
  ['gaseosa',       'Gaseosa',               'Sin alcohol', 2500, 2, 'Línea Coca-Cola.'],
  ['limonada',      'Limonada con menta',    'Sin alcohol', 3400, 3, 'Jarra individual.'],
];

iniciar();
const db = getFirestore();

let creados = 0, salteados = 0, actualizados = 0;
const lote = db.batch();

for (const [id, nombre, categoria, precio, orden, descripcion] of CARTA) {
  const ref = db.collection('carta').doc(id);
  const act = await ref.get();
  if (act.exists && !forzar) { salteados++; continue; }
  lote.set(ref, {
    nombre, categoria, precio, orden, descripcion,
    disponible: true,
    stock: null,          // null = sin control de stock; poné un número para limitarlo
  }, { merge: !forzar });
  act.exists ? actualizados++ : creados++;
}

await lote.commit();
console.log(`✓ Carta lista — ${creados} nuevos, ${actualizados} actualizados, ${salteados} sin tocar`);
if (salteados && !forzar) console.log('  (usá --forzar para reescribir los existentes)');
