// El pase del invitado: su QR para la puerta. El token va en la URL y es lo
// único que hace falta — no hay cuenta ni login para un invitado.
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  initializeApp,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from '/vendor/firebase.js';
import { dondeRepartir } from '/corte.js';
import { qrDataURL } from '/vendor/qr.js';

const CFG = window.CONFIG_FIREBASE || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const app = initializeApp(CFG);
const db = getFirestore(app);
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
    pintar({ id: d.id, ...d.data() });
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
