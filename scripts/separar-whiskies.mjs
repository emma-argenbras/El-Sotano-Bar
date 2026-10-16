// Parte los dos whiskies dobles del catálogo en cuatro productos.
//
// "Ruby Label / Gold Label" y "Red Label / Jack Daniels" eran un producto
// cada uno con dos botellas adentro. Una receta no puede decir de cuál
// descontar, y si se acaba una el cliente ve agotado teniendo la otra.
//
//   npm run separar:whiskies              (muestra qué haría)
//   npm run separar:whiskies -- --aplicar (lo escribe)
//
// Solo toca `catalogo`. La colección `carta`, que es la que lee la app en
// producción, queda como está.
//
// La receta no se carga acá: las medidas las pone la casa. Lo que sí queda
// es cada producto apuntando a una sola botella, que era el problema.
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';

const aplicar = process.argv.includes('--aplicar');

iniciar();
const db = getFirestore();

// De qué producto sale cada uno y con qué nombre queda.
const SEPARAR = [
  { desde: 'w-gold', id: 'w-gold', nombre: 'Johnnie Walker Gold Label' },
  { desde: 'w-gold', id: 'w-rubi', nombre: 'Johnnie Walker Black Rubí' },
  { desde: 'w-red',  id: 'w-red',  nombre: 'Johnnie Walker Red Label' },
  { desde: 'w-red',  id: 'w-jack', nombre: 'Jack Daniels' },
];

// El orden de toda la carta después de la separación. Se reescribe entero
// para que no queden huecos ni dos productos peleando el mismo número.
const ORDEN = ['w-gold', 'w-rubi', 'w-red', 'w-jack', 'd-cuervo', 'd-fernet',
               'd-vodka', 'd-aperitivo', 'c-lata', 'v-chandon', 'v-moulin',
               'v-trumpeter', 'v-catena', 's-gaseosa-bot'];

const plata = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
const catalogo = await db.collection('catalogo').get();
const hay = new Map(catalogo.docs.map((d) => [d.id, d.data()]));

console.log(aplicar ? '\nSEPARANDO\n' : '\nESTO HARÍA (no se escribió nada)\n');

const faltan = [...new Set(SEPARAR.map((s) => s.desde))].filter((id) => !hay.has(id));
if (faltan.length) {
  console.log('No está en el catálogo: ' + faltan.join(', '));
  process.exit(1);
}

const escribir = new Map();
for (const s of SEPARAR) {
  const base = hay.get(s.desde);
  escribir.set(s.id, {
    ...base,
    nombre: s.nombre,
    orden: ORDEN.indexOf(s.id) + 1,
  });
  const nuevo = !hay.has(s.id);
  console.log(`${nuevo ? 'crea' : 'pisa'}  catalogo/${s.id}`);
  console.log(`      ${s.nombre}  ·  ${base.categoria}  ·  ${plata(base.precio)}`
    + `  ·  orden ${ORDEN.indexOf(s.id) + 1}`
    + `  ·  sale de "${base.nombre}"`);
}

// Los demás solo cambian de número para no quedar pisados por los nuevos.
console.log('');
for (const id of ORDEN) {
  if (escribir.has(id) || !hay.has(id)) continue;
  const antes = Number(hay.get(id).orden ?? 999);
  const ahora = ORDEN.indexOf(id) + 1;
  if (antes === ahora) continue;
  escribir.set(id, { ...hay.get(id), orden: ahora });
  console.log(`orden  catalogo/${id}  ${antes} → ${ahora}   (${hay.get(id).nombre})`);
}

if (aplicar) {
  const lote = db.batch();
  for (const [id, datos] of escribir) lote.set(db.doc(`catalogo/${id}`), datos);
  await lote.commit();
}

console.log('\n' + (aplicar
  ? `Listo: ${escribir.size} documentos escritos. La carta vieja quedó intacta.`
  : `${escribir.size} documentos a escribir. Corré con --aplicar.`));
console.log('La receta de cada uno la carga la casa: las medidas no se inventan.\n');
