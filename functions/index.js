// Sótano — lo único que corre en el servidor.
//
// Cuando la casa escribe un mensaje a los anotados de una noche (colección
// mensajes, desde Invitaciones en el panel), esto le manda una notificación
// push a cada teléfono que en su pase tocó "Avisame" para esa noche. Sin
// esto el mensaje solo lo ve quien abre el pase.
//
// Necesita el plan Blaze. El envío es gratis (Firebase Cloud Messaging); la
// función entra en la cuota gratis mensual con el uso de un bar.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();

// Las direcciones que ya no sirven —desinstaló la app, borró los datos,
// sacó el permiso— se borran para no seguir intentando.
const VENCIDAS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// En la misma región que la base (southamerica-east1, San Pablo): un
// disparador de Firestore tiene que estar donde está la base.
export const avisarMensaje = onDocumentCreated({
  document: 'mensajes/{id}',
  region: 'southamerica-east1',
}, async (event) => {
  const m = event.data?.data();
  if (!m?.eventoId || !m?.texto) return;

  const db = getFirestore();
  const subs = await db.collection('suscripciones').where('eventoId', '==', m.eventoId).get();
  if (subs.empty) { logger.info('nadie pidió aviso', { evento: m.eventoId }); return; }

  // {nombre} se reemplaza por el nombre de cada uno: "Hola {nombre}, ¿venís?"
  // le llega a Ana como "Hola Ana, ¿venís?". Por eso un mensaje por persona.
  const refs = [...new Set(subs.docs.map((d) => d.data().invitadoId))]
    .map((id) => db.collection('invitados').doc(id));
  const nombres = new Map((await db.getAll(...refs))
    .map((d) => [d.id, String(d.data()?.nombre || '').split(' ')[0]]));
  const texto = (invitadoId) => String(m.texto)
    .replaceAll('{nombre}', nombres.get(invitadoId) || '').replace(/\s+([,.!?])/g, '$1').slice(0, 240);

  const mensajes = subs.docs.map((d) => ({
    token: d.id,
    // Como datos y no como "notificación": la dibuja el service worker del
    // pase (public/sw.js), igual en todos los navegadores.
    webpush: {
      headers: { Urgency: 'high', TTL: String(12 * 3600) },
      data: {
        titulo: 'Sótano',
        texto: texto(d.data().invitadoId),
        link: '/pase.html',
        tag: 'sotano-mensaje-' + event.params.id,
      },
    },
  }));

  let enviados = 0, fallidos = 0;
  // FCM acepta hasta 500 por envío.
  for (let i = 0; i < mensajes.length; i += 500) {
    const lote = mensajes.slice(i, i + 500);
    const r = await getMessaging().sendEach(lote);
    enviados += r.successCount;
    fallidos += r.failureCount;
    await Promise.all(r.responses.map((x, j) => (!x.success && VENCIDAS.has(x.error?.code)
      ? db.collection('suscripciones').doc(lote[j].token).delete().catch(() => {})
      : null)));
  }
  logger.info('mensaje avisado', { evento: m.eventoId, enviados, fallidos });
});
