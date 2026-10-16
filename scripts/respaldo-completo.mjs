// Copia TODA la base a un archivo JSON, con subcolecciones incluidas.
//
// A diferencia de respaldar.mjs —que solo copia lo que se lleva el reseteo—,
// este recorre la base entera: cada colección de la raíz y, dentro de cada
// documento, sus subcolecciones, hasta donde haya.
//
//   node scripts/respaldo-completo.mjs                       (muestra qué hay)
//   node scripts/respaldo-completo.mjs respaldo.json         (lo escribe)
//
// ES SOLO LECTURA: abre, lee y escribe un archivo local. No toca la base.
//
// Qué NO es: un backup reimportable con un comando. Para volver a cargarlo
// haría falta un script que lo escriba documento por documento. Para el
// tamaño de hoy alcanza y sobra; para 10.000 invitados, no.
//
// Los tipos de Firestore que no son JSON —fechas, referencias, coordenadas,
// bytes— se guardan envueltos, así se pueden reconocer al restaurar:
//   { "__tipo": "fecha", "valor": "2026-10-16T03:00:00.000Z" }
import { iniciar, PROYECTO } from './_admin.mjs';
import { getFirestore, Timestamp, GeoPoint, DocumentReference, FieldPath } from 'firebase-admin/firestore';
import { writeFileSync } from 'node:fs';

const salida = process.argv[2] || '';

iniciar();
const db = getFirestore();

// Un valor de Firestore, en algo que JSON pueda escribir sin perder qué era.
function plano(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return { __tipo: 'fecha', valor: v.toDate().toISOString() };
  if (v instanceof GeoPoint) return { __tipo: 'punto', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __tipo: 'ref', ruta: v.path };
  if (v instanceof FieldPath) return { __tipo: 'campo', valor: String(v) };
  if (Buffer.isBuffer(v)) return { __tipo: 'bytes', valor: v.toString('base64') };
  if (Array.isArray(v)) return v.map(plano);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plano(x);
    return o;
  }
  return v;
}

let documentos = 0;
let colecciones = 0;

// Baja por el árbol: cada documento puede tener sus propias subcolecciones.
async function copiarColeccion(ref, sangria = '') {
  const snap = await ref.get();
  const subs = [];
  const docs = {};

  for (const d of snap.docs) {
    documentos += 1;
    const hijas = await d.ref.listCollections();
    const entrada = { datos: plano(d.data()) };
    if (hijas.length) {
      entrada.subcolecciones = {};
      for (const h of hijas) {
        subs.push(h.id);
        entrada.subcolecciones[h.id] = await copiarColeccion(h, sangria + '    ');
      }
    }
    docs[d.id] = entrada;
  }

  colecciones += 1;
  console.log(`${sangria}· ${ref.id}: ${snap.size} documento${snap.size === 1 ? '' : 's'}`
    + (subs.length ? ` (+ ${[...new Set(subs)].join(', ')})` : ''));
  return docs;
}

console.log(`\nLeyendo ${PROYECTO}\n`);

const copia = {
  proyecto: PROYECTO,
  cuando: new Date().toISOString(),
  colecciones: {},
};

for (const c of await db.listCollections()) {
  copia.colecciones[c.id] = await copiarColeccion(c);
}

console.log(`\n${documentos} documentos en ${colecciones} colecciones.`);

if (!salida) {
  console.log('\nNo se escribió nada: pasale un nombre de archivo para guardarlo.');
  console.log('  node scripts/respaldo-completo.mjs respaldo.json\n');
} else {
  writeFileSync(salida, JSON.stringify(copia, null, 2), 'utf8');
  console.log(`\nGuardado en ${salida}\n`);
}
