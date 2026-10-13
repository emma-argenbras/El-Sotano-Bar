// Registro de invitados. Entra cualquiera con el link, sin cuenta ni login.
//
// El id del invitado es un token largo al azar y hace de llave: con él se ve
// el pase y nada más. Por eso el link que se le manda lo lleva adentro.
import {
  initializeApp, getFirestore, initializeFirestore, connectFirestoreEmulator,
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch,
} from '/vendor/firebase.js';
import { claveAnotado, digitosTel } from '/tel.js';

const CFG = window.CONFIG_FIREBASE || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const app = initializeApp(CFG);
const db = getFirestore(app);
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Token de 32 caracteres del generador criptográfico del navegador: no se
// adivina, y es lo único que protege el pase de cada invitado.
function token() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

let registro = null;

onSnapshot(doc(db, 'publico', 'registro'), (d) => {
  registro = d.exists() ? d.data() : null;
  pintar();
}, (e) => {
  $('#pantalla').innerHTML =
    `<div class="aviso mal"><span>⚠</span><div>No pude cargar la noche.<br>${esc(e.code || e.message)}</div></div>`;
});

// Si en este celular ya se anotó alguien para esta misma noche, se le muestra
// su pase en vez del formulario: es la forma más común de anotarse dos veces,
// volver a abrir el link.
let yaMiro = false;
async function miPaseDeEstaNoche() {
  const id = localStorage.getItem('sotano:invitado');
  if (!id || yaMiro || !registro?.eventoId) return;
  yaMiro = true;
  try {
    const d = await getDoc(doc(db, 'invitados', id));
    if (!d.exists() || d.data().eventoId !== registro.eventoId) return;
    $('#pantalla').innerHTML = `
      <div class="aviso ok"><span>✓</span><div>
        <b>${esc(d.data().nombre)}, ya estás anotado para ${esc(registro.nombre)}.</b><br>
        Una anotación por teléfono: con esta alcanza.</div></div>
      <a class="btn primario ancho-full" style="margin-top:.9rem;display:block;text-align:center"
         href="/pase.html?i=${encodeURIComponent(id)}">Ver mi pase</a>`;
  } catch { /* si no se puede mirar, queda el formulario */ }
}

function pintar() {
  const cont = $('#pantalla');
  if (!registro || !registro.abierto) {
    cont.innerHTML = `<div class="aviso"><span>🌙</span><div>
      <b>Por ahora no hay noche abierta para registrarse.</b><br>
      Seguinos y te avisamos cuando abra la próxima.</div></div>`;
    return;
  }
  const quedan = Math.max(0, Number(registro.capacidad || 0) - Number(registro.registrados || 0));
  if (!quedan) {
    cont.innerHTML = `<div class="aviso mal"><span>🙅</span><div>
      <b>${esc(registro.nombre)} está completo.</b><br>
      Se agotaron los lugares. Escribinos por si se libera alguno.</div></div>`;
    return;
  }
  cont.innerHTML = `
    <h1 style="font-size:1.4rem;margin:.4rem 0 .2rem">${esc(registro.nombre)}</h1>
    <p style="color:var(--suave);margin:0 0 1.2rem">
      Quedan <b style="color:var(--oro)">${quedan}</b> lugares.
      Dejanos tu nombre y tu teléfono y te damos el pase de entrada.
    </p>
    <form id="formRegistro">
      <label class="campo">
        <span>Tu nombre y apellido</span>
        <input id="inpNombre" maxlength="60" required autocomplete="name">
      </label>
      <label class="campo">
        <span>Tu teléfono</span>
        <input id="inpTel" type="tel" maxlength="25" required autocomplete="tel"
               inputmode="tel" placeholder="11 5555 5555">
      </label>
      <div class="aviso mal oculto" id="error"><span>⚠</span><div id="errorTexto"></div></div>
      <button class="btn primario ancho-full" id="btnRegistrar" type="submit">Reservar mi lugar</button>
    </form>
    <p style="color:var(--suave);font-size:.8rem;margin-top:1rem">
      Usamos tu teléfono solo para la lista de la puerta de esa noche.
    </p>`;

  $('#formRegistro').onsubmit = registrar;
  miPaseDeEstaNoche();
}

async function registrar(e) {
  e.preventDefault();
  const btn = $('#btnRegistrar');
  const nombre = $('#inpNombre').value.trim();
  const telefono = $('#inpTel').value.trim();
  if (nombre.length < 2 || telefono.replace(/\D/g, '').length < 6) {
    return fallar('Revisá el nombre y el teléfono.');
  }
  btn.disabled = true; btn.textContent = 'Reservando…';

  const id = token();
  try {
    // Las tres escrituras van juntas: el invitado, el contador y el candado
    // del teléfono. Si el cupo se llenó entre que cargó la página y tocó el
    // botón, o si ese número ya está anotado, las reglas frenan todo el lote
    // y no queda nada a medias.
    const lote = writeBatch(db);
    lote.set(doc(db, 'invitados', id), {
      eventoId: registro.eventoId, nombre, telefono,
      creadoEn: serverTimestamp(), ingresadoEn: null,
    });
    lote.update(doc(db, 'publico', 'registro'),
      { registrados: Number(registro.registrados || 0) + 1 });
    lote.set(doc(db, 'anotados', claveAnotado(registro.eventoId, telefono)), {
      eventoId: registro.eventoId, tel: digitosTel(telefono), creadoEn: serverTimestamp(),
    });
    await lote.commit();
    localStorage.setItem('sotano:invitado', id);
    location.href = `/pase.html?i=${encodeURIComponent(id)}`;
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Reservar mi lugar';
    if (err.code !== 'permission-denied') return fallar(err.code || err.message);
    // El lote se cae por dos motivos y desde afuera no se ve cuál: se preguntan
    // los lugares, y si todavía quedan es que ese teléfono ya está anotado.
    let lleno = false;
    try {
      const d = await getDoc(doc(db, 'publico', 'registro'));
      const r = d.data() || {};
      lleno = Number(r.registrados || 0) >= Number(r.capacidad || 0);
    } catch { /* si no se puede mirar, se asume lo más común */ }
    fallar(lleno
      ? 'Justo se agotaron los lugares. Probá de nuevo por si se libera alguno.'
      : 'Con ese teléfono ya hay alguien anotado para esta noche. Si perdiste tu pase, escribinos y te lo reenviamos.');
  }
}

function fallar(texto) {
  $('#errorTexto').textContent = texto;
  $('#error').classList.remove('oculto');
}
