// Copia TODA la base a un archivo JSON, con subcolecciones incluidas.
//
// A diferencia de respaldar.mjs —que solo copia lo que se lleva el reseteo—,
// este recorre la base entera: cada colección de la raíz y, dentro de cada
// documento, sus subcolecciones, hasta donde haya.
//
// Ojo con los documentos fantasma. En Firestore, barra/eventos no existe como
// documento: es solo la percha de la que cuelga barra/eventos/items. Una
// consulta normal no lo devuelve, y si se recorre así, los eventos se pierden
// sin que nadie se entere. Por eso se listan los documentos (listDocuments),
// que sí los incluye, en vez de consultarlos.
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
  const refs = await ref.listDocuments();
  const subs = [];
  const docs = {};
  let reales = 0;
  let fantasmas = 0;

  for (const r of refs) {
    const d = await r.get();
    const hijas = await r.listCollections();
    // Un documento fantasma no tiene datos: existe solo porque algo cuelga de
    // él. Se copia igual, para no perder lo que tiene adentro.
    const entrada = d.exists ? { datos: plano(d.data()) } : { fantasma: true };
    if (d.exists) { reales += 1; documentos += 1; } else { fantasmas += 1; }
    if (hijas.length) {
      entrada.subcolecciones = {};
      for (const h of hijas) {
        subs.push(h.id);
        entrada.subcolecciones[h.id] = await copiarColeccion(h, sangria + '    ');
      }
    }
    docs[r.id] = entrada;
  }

  colecciones += 1;
  console.log(`${sangria}· ${ref.id}: ${reales} documento${reales === 1 ? '' : 's'}`
    + (fantasmas ? ` (+${fantasmas} sin datos, solo percha)` : '')
    + (subs.length ? ` → ${[...new Set(subs)].join(', ')}` : ''));
  return docs;
}

console.log(`\nLeyendo ${PROYECTO}\n`);

const copia = {
  proyecto: PROYECTO,
  cuando: new Date().toISOString(),
  colecciones: {},
};

// listCollections() de la raíz puede dejar afuera una colección cuyos únicos
// documentos son perchas. Las conocidas se agregan a mano para que nunca
// falten, aunque hoy estén vacías.
const SIEMPRE = ['barra'];
const raiz = new Set([...(await db.listCollections()).map((c) => c.id), ...SIEMPRE]);

for (const id of [...raiz].sort()) {
  copia.colecciones[id] = await copiarColeccion(db.collection(id));
}

console.log(`\n${documentos} documentos en ${colecciones} colecciones.`);

if (!salida) {
  console.log('\nNo se escribió nada: pasale un nombre de archivo para guardarlo.');
  console.log('  node scripts/respaldo-completo.mjs respaldo.json\n');
} else {
  writeFileSync(salida, JSON.stringify(copia, null, 2), 'utf8');
  console.log(`\nGuardado en ${salida}\n`);
}
