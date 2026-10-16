// Pasa los productos de la carta actual al catálogo base.
//
// El catálogo es el maestro: de ahí sale la carta de cada fecha, que después
// cada fecha edita por su cuenta. Lo que hoy está en `carta` es, en los
// hechos, ese maestro — nunca hubo carta por fecha.
//
//   npm run migrar:catalogo              (muestra qué haría)
//   npm run migrar:catalogo -- --aplicar (lo escribe)
//
// Sin --aplicar NO escribe nada: lee la carta y dice, producto por producto,
// qué documento crearía.
//
// Qué NO hace, a propósito:
//   - no borra ni toca `carta`. La app vieja la sigue leyendo hasta que el
//     panel nuevo esté arriba; borrarla antes deja al cliente sin nada.
//   - no toca `stock` ni `disponible`: son del momento, no del maestro. El
//     stock sale del depósito y lo de hoy no es lo de la fecha que viene.
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';

const aplicar = process.argv.includes('--aplicar');

iniciar();
const db = getFirestore();

const carta = await db.collection('carta').orderBy('orden').get()
  .catch(() => db.collection('carta').get());
const yaHay = await db.collection('catalogo').get();
const existentes = new Set(yaHay.docs.map((d) => d.id));

console.log(aplicar ? '\nESCRIBIENDO EL CATÁLOGO\n' : '\nESTO HARÍA (no se escribió nada)\n');
console.log(`Carta actual: ${carta.size} productos.`
  + (yaHay.size ? `  Catálogo: ya tiene ${yaHay.size}.` : '  Catálogo: vacío.'));
console.log('');

const plata = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
let crea = 0, pisa = 0;
const avisos = [];

for (const d of carta.docs) {
  const c = d.data();
  const receta = (c.receta || []).filter((r) => Number(r.medidas) > 0);

  // El maestro guarda lo que define al producto, no lo que pasa hoy con él.
  const nuevo = {
    nombre: c.nombre || d.id,
    categoria: c.categoria || '',
    descripcion: c.descripcion || '',
    precio: Number(c.precio || 0),
    orden: Number(c.orden ?? 999),
    // enCarta false = lo sacaron de la venta. En el catálogo eso es "inactivo":
    // sigue estando para poder volver a usarlo, pero no entra en una fecha nueva.
    // Decisión de la casa: lo que hoy está agotado y apagado nace apagado en
    // el catálogo, para que no se cuele en la primera fecha que se arme.
    activo: c.enCarta !== false && c.disponible !== false,
    ...(receta.length ? { receta } : {}),
  };

  const estado = existentes.has(d.id) ? 'PISA' : 'crea';
  if (existentes.has(d.id)) pisa += 1; else crea += 1;

  console.log(`${estado}  catalogo/${d.id}`);
  console.log(`      ${nuevo.nombre}  ·  ${nuevo.categoria || 'sin categoría'}  ·  ${plata(nuevo.precio)}`
    + `  ·  orden ${nuevo.orden}${nuevo.activo ? '' : '  ·  INACTIVO (estaba fuera de carta)'}`);
  console.log(`      receta: ${receta.length
    ? receta.map((r) => `${r.medidas} de ${r.insumoId}`).join(', ')
    : 'ninguna — no descuenta del depósito'}`);
  console.log(`      no se copia: stock=${c.stock === null || c.stock === undefined ? '∞' : c.stock}`
    + `, disponible=${c.disponible !== false}`);
  console.log('');

  if (!nuevo.precio) avisos.push(`${nuevo.nombre}: precio en cero`);
  if (!receta.length) avisos.push(`${nuevo.nombre}: sin receta, no toca el depósito`);
  if (!nuevo.categoria) avisos.push(`${nuevo.nombre}: sin categoría`);

  if (aplicar) await db.doc(`catalogo/${d.id}`).set(nuevo);
}

if (avisos.length) {
  console.log('PARA MIRAR ANTES DE APLICAR');
  for (const a of avisos) console.log('  · ' + a);
  console.log('');
}

console.log(aplicar
  ? `Listo: ${crea} creados, ${pisa} pisados. La carta vieja quedó intacta.`
  : `${crea} a crear, ${pisa} a pisar. Corré con --aplicar para que lo haga.`);
