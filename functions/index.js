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
  const tokens = subs.docs.map((d) => d.id);
  if (!tokens.length) { logger.info('nadie pidió aviso', { evento: m.eventoId }); return; }

  let enviados = 0, fallidos = 0;
  // FCM acepta hasta 500 direcciones por envío.
  for (let i = 0; i < tokens.length; i += 500) {
    const lote = tokens.slice(i, i + 500);
    const r = await getMessaging().sendEachForMulticast({
      tokens: lote,
      // Como datos y no como "notificación": la dibuja el service worker del
      // pase (public/sw.js), igual en todos los navegadores.
      webpush: {
        headers: { Urgency: 'high', TTL: String(12 * 3600) },
        data: {
          titulo: 'Sótano',
          texto: String(m.texto).slice(0, 240),
          link: '/pase.html',
          tag: 'sotano-mensaje-' + event.params.id,
        },
      },
    });
    enviados += r.successCount;
    fallidos += r.failureCount;
    await Promise.all(r.responses.map((x, j) => (!x.success && VENCIDAS.has(x.error?.code)
      ? db.collection('suscripciones').doc(lote[j]).delete().catch(() => {})
      : null)));
  }
  logger.info('mensaje avisado', { evento: m.eventoId, enviados, fallidos });
});
