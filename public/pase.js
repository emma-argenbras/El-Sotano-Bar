// El pase del invitado: su QR para la puerta. El token va en la URL y es lo
// único que hace falta — no hay cuenta ni login para un invitado.
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getMessaging,
  getToken,
  initializeApp,
  isSupported,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '/vendor/firebase.js';
import { dondeRepartir } from '/corte.js';
import { qrDataURL } from '/vendor/qr.js';

const CFG = window.CONFIG_FIREBASE || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const app = initializeApp(CFG);
// Con cache persistente, igual que la carta: el pase se muestra en la
// puerta, que está abajo y sin señal. Sin esto, abierto sin red se quedaba
// en "Buscando tu pase…" aunque ya se hubiera visto antes.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const id = new URLSearchParams(location.search).get('i')
  || localStorage.getItem('sotano:invitado') || '';

if (!id) {
  // Esta pantalla es también la app del club: si la abrió desde el ícono y
  // todavía no tiene pase, dejarlo en un error es un callejón. El link de
  // registro sin noche lleva a la que esté abierta.
  $('#pase').innerHTML = `
    <div class="aviso"><span>🌙</span><div>
      <b>Todavía no tenés pase.</b><br>
      Anotate para la próxima noche y te lo damos acá mismo.</div></div>
    <a class="btn primario ancho-full" style="margin-top:.9rem;display:block;text-align:center"
       href="/registro.html">Anotarme para la próxima</a>`;
} else {
  localStorage.setItem('sotano:invitado', id);
  onSnapshot(doc(db, 'invitados', id), (d) => {
    if (!d.exists()) {
      $('#pase').innerHTML = `
        <div class="aviso mal"><span>⚠</span><div>
          <b>No encontramos este pase.</b><br>Puede que la noche ya haya pasado.</div></div>
        <a class="btn primario ancho-full" style="margin-top:.9rem;display:block;text-align:center"
           href="/registro.html">Anotarme para la próxima</a>`;
      return;
    }
    const inv = { id: d.id, ...d.data() };
    pintar(inv);
    escucharMensajes(inv);
  }, (e) => {
    $('#pase').innerHTML = `<div class="aviso mal"><span>⚠</span><div>${esc(e.code || e.message)}</div></div>`;
  });
}

const plata = (x) => '$' + Number(x || 0).toLocaleString('es-AR');

// La noche: cuánto sale entrar y qué día es. Vive en el registro, que es
// público — el documento del evento no lo puede leer nadie de afuera. Se pide
// una sola vez.
let laNoche = null;
async function datosDeLaNoche(eventoId) {
  if (laNoche || !eventoId) return laNoche || {};
  try {
    laNoche = (await getDoc(doc(db, 'registros', eventoId))).data() || {};
  } catch { laNoche = {}; }
  return laNoche;
}

// Dónde transfiere, si eligió transferencia. Lo carga la casa en Caja.
let elAlias = null;
async function aliasDePago() {
  if (elAlias) return elAlias;
  try { elAlias = (await getDoc(doc(db, 'publico', 'pagos'))).data() || {}; }
  catch { elAlias = {}; }
  return elAlias;
}

function cuando(f) {
  const d = f?.toDate?.();
  if (!d) return '';
  const txt = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return txt[0].toUpperCase() + txt.slice(1);
}

// Todavía no confirmamos su pago: en vez del QR, adónde transferir y qué va a
// pasar después. Esta pantalla se actualiza sola cuando la casa confirma —está
// escuchando el documento—, así que el QR le aparece sin hacer nada.
// h23: en algunos Safari es-AR salía "p. m." y quedaba "p. m.." contra el
// punto de la frase.
const horaDe = (t) => t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function pintarEsperandoPago(inv, noche, fecha, entrada, al) {
  $('#pase').innerHTML = `
    <div class="aviso" style="margin-bottom:.9rem"><span>⏳</span><div>
      <b>${esc(inv.nombre)}, tu lugar está guardado.</b><br>
      ${esc(noche.nombre || 'La noche')}${fecha ? ' · ' + esc(fecha) : ''}</div></div>

    ${al.alias ? `
      <div class="aviso"><span>🎟</span><div style="flex:1">
        <b>Transferí ${plata(entrada)} a:</b><br>
        <b style="color:var(--oro);font-size:1.15rem;word-break:break-all">${esc(al.alias)}</b>
        ${al.titular ? `<br><small>A nombre de ${esc(al.titular)}</small>` : ''}
      </div></div>
      <button class="btn ancho-full" id="btnCopiarAlias" style="margin-top:.5rem">Copiar el alias</button>` : `
      <div class="aviso mal"><span>⚠</span><div>
        <b>Todavía no hay alias cargado.</b> Escribinos y lo arreglamos.</div></div>`}

    ${al.alias ? (inv.avisoPagoEn ? `
      <div class="aviso ok" style="margin-top:.9rem"><span>✓</span><div>
        <b>Avisaste que transferiste${inv.avisoPagoEn?.toDate ? ' a las ' + horaDe(inv.avisoPagoEn) : ''}.</b><br>
        La casa lo revisa en el banco y te confirma acá.</div></div>` : `
      <button class="btn primario ancho-full" id="btnYaTransferi" style="margin-top:.9rem">
        Ya transferí</button>
      <small style="display:block;color:var(--suave);margin-top:.4rem;text-align:center">
        Tocalo después de mandar la plata: le avisa a la casa que te busque en el banco.</small>`) : ''}

    <div class="aviso" style="margin-top:.9rem"><span>📲</span><div>
      <b>Ni bien confirmemos tu pago te avisamos por acá.</b><br>
      Instalate la app y tu QR de acceso aparece solo en esta misma pantalla:
      no tenés que hacer nada ni volver a buscar el link.</div></div>`;

  // El aviso es una sola escritura, de un solo campo, que las reglas dejan
  // levantar una vez. La pantalla escucha el documento: se redibuja sola.
  if ($('#btnYaTransferi')) $('#btnYaTransferi').onclick = async () => {
    const b = $('#btnYaTransferi');
    b.disabled = true; b.textContent = 'Avisando…';
    try {
      await updateDoc(doc(db, 'invitados', inv.id), { avisoPagoEn: serverTimestamp() });
    } catch (e) {
      b.disabled = false; b.textContent = 'Ya transferí';
      alert('No se pudo avisar: ' + (e.code || e.message) + '\n\nProbá de nuevo, o escribinos.');
    }
  };

  if ($('#btnCopiarAlias')) $('#btnCopiarAlias').onclick = async () => {
    try {
      await navigator.clipboard.writeText(al.alias);
      $('#btnCopiarAlias').textContent = 'Alias copiado ✓';
    } catch { $('#btnCopiarAlias').textContent = al.alias; }
  };
}

async function pintar(inv) {
  // El QR lleva solo el token: la puerta lo busca contra su lista.
  const img = await qrDataURL(inv.id, {
    width: 900, margin: 1, errorCorrectionLevel: 'H',
    color: { dark: '#0d0b10', light: '#ffffff' },
  });
  const adentro = !!inv.ingresadoEn;
  const noche = await datosDeLaNoche(inv.eventoId);
  const entrada = Number(noche.entrada || 0);
  const fecha = cuando(noche.fecha);
  // Si dijo que transfiere, acá tiene que estar el alias: si no, el pase le
  // dice cuánto pagar y no adónde.
  // Quien dijo que transfiere no tiene QR hasta que la casa confirme que la
  // plata llegó: el banco no le avisa a la app, lo confirma una persona.
  if (inv.pago === 'virtual' && entrada > 0 && !inv.pagadoEn) {
    return pintarEsperandoPago(inv, noche, fecha, entrada, await aliasDePago());
  }
  $('#pase').innerHTML = `
    <div class="lienzo-pase ${adentro ? 'usado' : ''}">
      <img class="logo" src="/iconos/logo-horizontal-claro.svg" alt="Sótano" width="443" height="120">
      <img class="qr" src="${img}" alt="Tu QR de entrada">
      <div class="quien">${esc(inv.nombre)}</div>
      ${noche.nombre ? `<div style="color:#444;font-size:.9rem;margin-top:.2rem">${
        esc(noche.nombre)}${fecha ? ' · ' + esc(fecha) : ''}</div>` : ''}
      <div class="pie-pase">${adentro
        ? '✓ Ya entraste. ¡Buena noche!'
        : 'Mostrá esta pantalla en la puerta'}</div>
    </div>
    ${entrada && !adentro && inv.pago !== 'virtual' ? `
      <div class="aviso" style="margin-top:.9rem"><span>🎟</span><div>
        <b>Entrada ${plata(entrada)}</b>, se paga en la puerta.</div></div>` : ''}
    ${entrada && inv.pago === 'virtual' ? `
      <div class="aviso ok" style="margin-top:.9rem"><span>✓</span><div>
        <b>Entrada paga.</b> Recibimos tus ${plata(entrada)}: en la puerta no pagás nada.
      </div></div>` : ''}
    <div style="display:flex;gap:.6rem;margin-top:1rem">
      <button class="btn" id="btnCompartir" style="flex:1">Compartir</button>
      <a class="btn primario" href="/?inv=${encodeURIComponent(inv.id)}" style="flex:1.4">Ver la carta</a>
    </div>
    <p style="color:var(--suave);font-size:.84rem;margin-top:1rem">
      Guardá este link: es tu entrada. Si pedís desde acá, tu consumo queda a tu nombre.
    </p>
    ${adentro ? `
      <a class="btn ancho-full" style="margin-top:.2rem;display:block;text-align:center"
         href="/registro.html">Anotarme para la próxima noche</a>` : ''}`;

  $('#btnCompartir').onclick = async () => {
    const url = `${dondeRepartir(location.origin)}/pase.html?i=${encodeURIComponent(inv.id)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Mi pase — Sótano', url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); $('#btnCompartir').textContent = 'Link copiado ✓'; }
    catch { $('#btnCompartir').textContent = url; }
  };
}

// ---------- lo que dice la casa ----------
// Los mensajes de la casa a los anotados de esta noche, arriba del pase. Si
// el último pide confirmar, el invitado contesta si viene o no: es lo que
// le dice a la casa cuántos esperar y qué lugares liberar.
//
// Llega mientras el pase está abierto: si entra uno nuevo, además avisa con
// una notificación, si el teléfono ya dio permiso. Con el pase cerrado no
// llega nada hasta que haya notificaciones push (plan Blaze).
let mirandoMensajes = null;
let mensajes = null;
let elInvitado = null;

function escucharMensajes(inv) {
  elInvitado = inv;
  if (mirandoMensajes === inv.eventoId) { pintarMensajes(); return; }
  mirandoMensajes = inv.eventoId;
  if (!inv.eventoId) return;
  onSnapshot(query(collection(db, 'mensajes'), where('eventoId', '==', inv.eventoId)), (snap) => {
    const antes = mensajes ? new Set(mensajes.map((m) => m.id)) : null;
    mensajes = snap.docs.map((x) => ({ id: x.id, ...x.data() }))
      .sort((a, b) => (b.en?.toMillis?.() || 0) - (a.en?.toMillis?.() || 0));
    if (antes) {
      for (const m of mensajes) {
        if (antes.has(m.id) || !('Notification' in window) || Notification.permission !== 'granted') continue;
        navigator.serviceWorker?.ready.then((reg) => reg.showNotification('Sótano', {
          body: m.texto, tag: 'sotano-mensaje-' + m.id, icon: '/iconos/icono-club-192.png',
        })).catch(() => {});
      }
    }
    pintarMensajes();
  }, () => {});
}

function pintarMensajes() {
  const cont = $('#mensajesCasa');
  const inv = elInvitado;
  if (!cont || !inv) return;
  if (!mensajes?.length) { cont.innerHTML = cajaAvisarme(inv); engancharAvisarme(inv); return; }
  const ultimos = mensajes.slice(0, 3);
  const pide = ultimos[0].pideConfirmar === true && !inv.ingresadoEn;
  const dijo = inv.asistencia === 'si' ? 'Dijiste que venís' : inv.asistencia === 'no' ? 'Dijiste que no venís' : '';
  cont.innerHTML = `
    <div class="aviso mensajes-casa" style="margin-bottom:.9rem;flex-direction:column;align-items:stretch">
      ${ultimos.map((m, i) => `
        <div style="${i ? 'margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--borde);opacity:.75' : ''}">
          <small style="color:var(--suave)">📣 La casa${m.en?.toDate ? ' · ' + horaDe(m.en) : ''}</small><br>
          <span style="white-space:pre-line">${esc(conNombre(m.texto, inv))}</span>
        </div>`).join('')}
      ${pide ? `
        <div style="margin-top:.8rem">
          ${dijo ? `<small style="display:block;color:var(--verde);margin-bottom:.4rem">✓ ${dijo}. Si cambiás de idea, tocá la otra.</small>` : ''}
          <div style="display:flex;gap:.6rem">
            <button class="btn ${inv.asistencia === 'si' ? 'primario' : ''}" data-asistencia="si" style="flex:1">Voy</button>
            <button class="btn ${inv.asistencia === 'no' ? 'primario' : ''}" data-asistencia="no" style="flex:1">No voy</button>
          </div>
        </div>` : ''}
    </div>
    ${cajaAvisarme(inv)}`;
  engancharAvisarme(inv);
  cont.querySelectorAll('[data-asistencia]').forEach((b) => b.onclick = async () => {
    if (b.dataset.asistencia === inv.asistencia) return;
    cont.querySelectorAll('[data-asistencia]').forEach((x) => { x.disabled = true; });
    try {
      await updateDoc(doc(db, 'invitados', inv.id),
        { asistencia: b.dataset.asistencia, asistenciaEn: serverTimestamp() });
    } catch (e) {
      cont.querySelectorAll('[data-asistencia]').forEach((x) => { x.disabled = false; });
      alert('No se pudo guardar: ' + (e.code || e.message) + '\n\nProbá de nuevo.');
    }
  });
}

// ---------- avisame ----------
// Para que los mensajes de la casa le lleguen con el pase cerrado. Guarda la
// dirección de este teléfono para notificaciones (la da Firebase Cloud
// Messaging) atada a su invitación; el envío lo hace la función del servidor.
//
// El permiso se pide desde un toque, nunca solo. En iPhone funciona solo con
// la app instalada en la pantalla de inicio: desde Safari, isSupported() da
// false y se le explica.
const PUSH = window.CONFIG_PUSH || {};
const AVISO_GUARDADO = (inv) => `sotano:push-${inv.id}`;
let soportaPush = null;
isSupported().then((si) => { soportaPush = si; pintarMensajes(); }).catch(() => { soportaPush = false; });

function yaAvisa(inv) {
  try { return localStorage.getItem(AVISO_GUARDADO(inv)) === 'si'; } catch { return false; }
}

function cajaAvisarme(inv) {
  if (!PUSH.vapidKey || inv.ingresadoEn || !('Notification' in window && 'serviceWorker' in navigator)) {
    const iphone = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
    return PUSH.vapidKey && iphone && !inv.ingresadoEn ? `<p style="color:var(--suave);font-size:.82rem;margin:.2rem 0 .9rem">
      📲 En iPhone, para que te avisemos de los mensajes de la casa, instalá la app
      (Compartir → Agregar a inicio) y abrí tu pase desde el ícono.</p>` : '';
  }
  if (soportaPush === false || Notification.permission === 'denied') return '';
  if (yaAvisa(inv) && Notification.permission === 'granted') {
    return `<p style="color:var(--verde);font-size:.84rem;margin:.2rem 0 .9rem">🔔 Te avisamos cuando la casa mande un mensaje.</p>`;
  }
  return `<button class="btn ancho-full" id="btnAvisarme" style="margin-bottom:.9rem">
    🔔 Avisame cuando la casa mande un mensaje</button>`;
}

function engancharAvisarme(inv) {
  const b = $('#btnAvisarme');
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Activando…';
    try {
      if ((await Notification.requestPermission()) !== 'granted') { pintarMensajes(); return; }
      const token = await getToken(getMessaging(app), {
        vapidKey: PUSH.vapidKey,
        serviceWorkerRegistration: await navigator.serviceWorker.ready,
      });
      await setDoc(doc(db, 'suscripciones', token), {
        invitadoId: inv.id, eventoId: inv.eventoId, creadoEn: serverTimestamp(),
      });
      try { localStorage.setItem(AVISO_GUARDADO(inv), 'si'); } catch {}
    } catch (e) {
      alert('No se pudo activar el aviso: ' + (e.code || e.message));
    }
    pintarMensajes();
  };
}

// {nombre} en un mensaje de la casa es el nombre de quien lo lee.
function conNombre(texto, inv) {
  const nombre = String(inv?.nombre || '').split(' ')[0];
  return String(texto || '').replaceAll('{nombre}', nombre).replace(/\s+([,.!?])/g, '$1');
}
