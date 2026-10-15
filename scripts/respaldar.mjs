// Se lleva una copia de todo lo que el reseteo va a borrar, a un JSON.
//
// No reemplaza a un backup de Firestore: es una foto para poder mirar después
// qué había, o volver a cargar algo a mano si hizo falta.
//
//   node scripts/respaldar.mjs respaldo.json
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'node:fs';

iniciar();
const db = getFirestore();
const salida = process.argv[2] || 'respaldo.json';

const COLECCIONES = ['pedidos', 'egresos', 'compras', 'conteos', 'proveedores',
                     'registros', 'invitados', 'anotados', 'bajas'];

const copia = { cuando: new Date().toISOString(), proyecto: 'el-sotano-bar' };
let total = 0;

for (const c of COLECCIONES) {
  const snap = await db.collection(c).get();
  copia[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  total += snap.size;
  console.log(`· ${c}: ${snap.size}`);
}

const ev = await db.collection('barra').doc('eventos').collection('items').get();
copia.eventos = ev.docs.map((d) => ({ id: d.id, ...d.data() }));
total += ev.size;
console.log(`· eventos: ${ev.size}`);

const turno = await db.doc('barra/turno').get();
copia.turno = turno.exists ? turno.data() : null;
if (turno.exists) { total += 1; console.log('· turno abierto: 1'); }

writeFileSync(salida, JSON.stringify(copia, null, 2), 'utf8');
console.log(`\n${total} documentos → ${salida}`);
