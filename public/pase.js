// El pase del invitado: su QR para la puerta. El token va en la URL y es lo
// único que hace falta — no hay cuenta ni login para un invitado.
import {
  initializeApp, getFirestore, connectFirestoreEmulator, doc, getDoc, onSnapshot,
} from '/vendor/firebase.js';
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

// Lo que sale entrar vive en el registro de la noche, que es público: el
// documento del evento no lo puede leer nadie de afuera. Se pide una sola vez.
let entradaDeLaNoche = null;
async function cuantoSaleEntrar(eventoId) {
  if (entradaDeLaNoche !== null || !eventoId) return entradaDeLaNoche;
  try {
    const d = await getDoc(doc(db, 'registros', eventoId));
    entradaDeLaNoche = Number(d.data()?.entrada || 0);
  } catch { entradaDeLaNoche = 0; }
  return entradaDeLaNoche;
}

async function pintar(inv) {
  // El QR lleva solo el token: la puerta lo busca contra su lista.
  const img = await qrDataURL(inv.id, {
    width: 900, margin: 1, errorCorrectionLevel: 'H',
    color: { dark: '#0d0b10', light: '#ffffff' },
  });
  const adentro = !!inv.ingresadoEn;
  const entrada = await cuantoSaleEntrar(inv.eventoId);
  $('#pase').innerHTML = `
    <div class="lienzo-pase ${adentro ? 'usado' : ''}">
      <img class="logo" src="/iconos/logo-horizontal-claro.svg" alt="Sótano" width="443" height="120">
      <img class="qr" src="${img}" alt="Tu QR de entrada">
      <div class="quien">${esc(inv.nombre)}</div>
      <div class="pie-pase">${adentro
        ? '✓ Ya entraste. ¡Buena noche!'
        : 'Mostrá esta pantalla en la puerta'}</div>
    </div>
    ${entrada && !adentro ? `<div class="aviso" style="margin-top:.9rem"><span>🎟</span><div>
      <b>Entrada ${plata(entrada)}</b>, se paga en la puerta.</div></div>` : ''}
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
    const url = `${location.origin}/pase.html?i=${encodeURIComponent(inv.id)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Mi pase — Sótano', url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); $('#btnCompartir').textContent = 'Link copiado ✓'; }
    catch { $('#btnCompartir').textContent = url; }
  };
}
