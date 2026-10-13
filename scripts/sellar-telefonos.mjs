// Candado retroactivo: los que ya estaban anotados antes de que existiera la
// regla de "un teléfono, una anotación" no tienen su documento en 'anotados'.
// Sin esto podrían anotarse de nuevo esta misma noche.
//
//   npm run sellar:telefonos
import { iniciar, PROYECTO } from './_admin.mjs';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { digitosTel, claveAnotado } from '../public/tel.js';

iniciar();
const db = getFirestore();

const invitados = await db.collection('invitados').get();
let puestos = 0, yaEstaban = 0, sinTelefono = 0;

for (const d of invitados.docs) {
  const { eventoId = '', telefono = '' } = d.data();
  if (!digitosTel(telefono) || !eventoId) { sinTelefono++; continue; }

  // Si dos viejos comparten teléfono, el primero se queda con la llave limpia
  // y el otro con un sufijo: no se inventa que nunca estuvo.
  let clave = claveAnotado(eventoId, telefono);
  if ((await db.doc(`anotados/${clave}`).get()).exists) {
    yaEstaban++;
    clave = claveAnotado(eventoId, telefono, d.id.slice(0, 8));
    if ((await db.doc(`anotados/${clave}`).get()).exists) continue;
  }
  await db.doc(`anotados/${clave}`).set({
    eventoId, tel: digitosTel(telefono), creadoEn: FieldValue.serverTimestamp(),
  });
  puestos++;
}

console.log(`✓ ${PROYECTO}: ${invitados.size} invitados · ${puestos} candados nuevos`
  + ` · ${yaEstaban} repetidos · ${sinTelefono} sin teléfono`);
