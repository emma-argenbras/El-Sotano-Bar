// Sacar a alguien de la lista de una noche, a mano:
//
//   npm run sacar:invitado -- <token o parte del token>
//
// Borra el invitado, libera el candado de su teléfono y baja el contador del
// cupo. Es lo mismo que hace el botón "Sacar" del panel, para cuando hay que
// arreglar algo desde acá.
import { iniciar } from './_admin.mjs';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { digitosTel, claveAnotado } from '../public/tel.js';

const busca = process.argv[2];
if (!busca) { console.error('Falta el token del invitado.'); process.exit(1); }

iniciar();
const db = getFirestore();

const todos = await db.collection('invitados').get();
const hallados = todos.docs.filter((d) => d.id.startsWith(busca));
if (hallados.length !== 1) {
  console.error(`${hallados.length} invitados empiezan con "${busca}". Tiene que ser uno solo.`);
  process.exit(1);
}

const d = hallados[0];
const { nombre, telefono, eventoId } = d.data();

const tel = digitosTel(telefono);

await db.runTransaction(async (t) => {
  const reg = await t.get(db.doc('publico/registro'));
  t.delete(d.ref);
  if (reg.exists && reg.data().eventoId === eventoId) {
    t.update(db.doc('publico/registro'),
      { registrados: Math.max(0, Number(reg.data().registrados || 0) - 1) });
  }
});

await acomodarCandados(db, eventoId, tel);
console.log(`✓ fuera: ${nombre} (${telefono})`);

// Los candados se rearman después de sacar a alguien: queda uno por invitado
// que todavía tenga ese teléfono, y el primero con la llave limpia. Si quedara
// solo la llave con sufijo, la limpia estaría libre y se podría anotar de
// nuevo con el mismo número, que es justo lo que no queremos.
async function acomodarCandados(base, evento, numero) {
  const quedan = (await base.collection('invitados').where('eventoId', '==', evento).get())
    .docs.filter((x) => digitosTel(x.data().telefono) === numero);
  const viejos = await base.collection('anotados')
    .where('eventoId', '==', evento).where('tel', '==', numero).get();

  const lote = base.batch();
  for (const v of viejos.docs) lote.delete(v.ref);
  quedan.forEach((q, i) => {
    lote.set(base.doc(`anotados/${claveAnotado(evento, numero, i ? q.id.slice(0, 8) : '')}`),
      { eventoId: evento, tel: numero, creadoEn: FieldValue.serverTimestamp() });
  });
  await lote.commit();
}
