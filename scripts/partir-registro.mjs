// El registro pasó de ser uno solo (publico/registro) a uno por noche
// (registros/<id del evento>). Esto arma los que faltan:
//
//   npm run partir:registro
//
// Cuenta los anotados de verdad, no copia el contador viejo: si alguien se
// anotó a una noche y el puntero ya estaba en otra, el número estaba mal.
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';

iniciar();
const db = getFirestore();

const eventos = await db.collection('barra/eventos/items').get();
const invitados = await db.collection('invitados').get();
const puntero = (await db.doc('publico/registro').get()).data() || {};

let puestos = 0;
for (const e of eventos.docs) {
  const ev = e.data();
  const cupo = Number(ev.capacidad || 0);
  if (!cupo) continue;
  if ((await db.doc(`registros/${e.id}`).get()).exists) continue;

  const anotados = invitados.docs.filter((i) => i.data().eventoId === e.id).length;
  // Una noche cerrada no toma más gente: su link ya venció.
  const abierto = ev.estado !== 'cerrado' && ev.estado !== 'cancelado';
  await db.doc(`registros/${e.id}`).set({
    eventoId: e.id, nombre: ev.nombre || '', capacidad: cupo,
    registrados: anotados, abierto,
  });
  console.log(`  ${ev.nombre} · ${anotados}/${cupo} · ${abierto ? 'abierto' : 'cerrado'}`);
  puestos++;
}

// El puntero queda solo como puntero: el link viejo sigue llevando a esa noche.
if (puntero.eventoId) {
  await db.doc('publico/registro').set({
    eventoId: puntero.eventoId, nombre: puntero.nombre || '',
  });
}

console.log(`✓ ${puestos} registros nuevos · puntero: ${puntero.eventoId || 'ninguno'}`);
