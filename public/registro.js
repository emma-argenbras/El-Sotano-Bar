// Registro de invitados. Entra cualquiera con el link, sin cuenta ni login.
//
// El id del invitado es un token largo al azar y hace de llave: con él se ve
// el pase y nada más. Por eso el link que se le manda lo lleva adentro.
import {
  initializeApp, getFirestore, initializeFirestore, connectFirestoreEmulator,
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch,
} from '/vendor/firebase.js';
import { claveAnotado, digitosTel, telValido, porQueNoVale, FORMATO_TEL } from '/tel.js';

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
let yaPinto = false;
// El alias al que se transfiere la entrada. Si la casa no cargó ninguno, no
// se ofrece transferencia: sería mandar a la persona a pagar a ningún lado.
let hayAlias = false;

const plata = (n) => '$' + Number(n || 0).toLocaleString('es-AR');

// Cuándo es la noche, escrito como se lo diría alguien: "Sábado 7 de noviembre".
// Sin esto, la invitación no dice para qué día es, que es lo primero que mira
// el que la recibe.
// Sin argumento, la fecha de la noche que se está mirando; con uno, la que
// le pasen —sirve para ofrecer otra noche sin tocar la que está cargada.
function cuando(ts) {
  const f = (ts ?? registro?.fecha)?.toDate?.();
  if (!f) return '';
  const txt = f.toLocaleDateString('es-AR',
    { weekday: 'long', day: 'numeric', month: 'long' });
  return txt[0].toUpperCase() + txt.slice(1);
}

// Un error al arrancar el módulo dejaba la pantalla en "Buscando la noche…"
// sin decir nada. Ahora se ve: es la pantalla que abre gente de afuera, una
// sola vez, y si no funciona no vuelve.
//
// Va acá abajo a propósito: 'yaPinto' tiene que estar declarado antes, o el
// aviso que avisa de los errores se cae con el mismo error que vino a contar.
addEventListener('error', (e) => {
  if (yaPinto) return;
  avisar('Se rompió algo al abrir la página.', e.message, true);
});

const recargar = () => {
  const u = new URL(location.href);
  u.searchParams.set('v', Date.now().toString(36));
  location.replace(u.toString());
};

function avisar(titulo, detalle, conReintento, extra = '') {
  yaPinto = true;
  const cont = $('#pantalla');
  if (!cont) return;
  cont.innerHTML = `
    <div class="aviso mal"><span>⚠</span><div><b>${esc(titulo)}</b>${
      detalle ? '<br>' + esc(detalle) : ''}</div></div>
    ${extra}
    ${conReintento ? `<button class="btn primario ancho-full" id="btnReintentar"
      style="margin-top:.9rem">Reintentar</button>` : ''}`;
  if ($('#btnReintentar')) $('#btnReintentar').onclick = recargar;
}

// Un link viejo no tiene por qué ser un callejón sin salida. La casa mantiene
// en publico/registro cuál es la noche que está tomando gente; si hay una, y
// no es esta, se la ofrece.
async function noDisponible(detalle) {
  avisar('Esta fecha no está disponible.', detalle, false);
  try {
    const apunta = (await getDoc(doc(db, 'publico', 'registro'))).data();
    const otra = apunta?.eventoId;
    if (!otra || otra === mirando) return;
    const d = await getDoc(doc(db, 'registros', otra));
    const r = d.data();
    if (!d.exists() || r.abierto === false) return;
    if (Number(r.registrados || 0) >= Number(r.capacidad || 0)) return;
    avisar('Esta fecha no está disponible.', detalle, false, `
      <a class="btn primario ancho-full" style="margin-top:.9rem"
         href="/registro.html?ev=${encodeURIComponent(otra)}">
        Ir a ${esc(r.nombre || 'la próxima noche')}${
          r.fecha?.toDate ? ' · ' + cuando(r.fecha) : ''}</a>`);
  } catch { /* si no se puede mirar, queda el aviso solo */ }
}

const fallaCarga = (e) =>
  avisar('No pude cargar la noche.', e.code || e.message, true);

// Si en diez segundos no se pintó nada, algo no llegó: el bundle, la señal,
// la base. Peor que un error es un "Buscando la noche…" eterno, que no le
// dice a nadie qué hacer.
setTimeout(() => {
  if (yaPinto) return;
  avisar('No pude conectarme.',
    'Revisá que tengas internet y tocá Reintentar. Si sigue igual, avisanos.', true);
}, 10000);

// La noche viene en el link: /registro.html?ev=<id>. Cada noche tiene el suyo,
// así el QR de una no manda a la de la semana que viene.
//
// Sin ?ev= es un link viejo, de cuando había uno solo: se mira a qué noche
// apunta la casa y se sigue desde ahí.
// OJO con el orden: escuchar() se llama acá mismo, al cargar el módulo, y
// usa 'mirando'. Si la declaración quedara más abajo, el let todavía está en
// su zona muerta y tira ReferenceError antes de abrir ningún listener: la
// página se queda en "Buscando la noche…" para siempre y nadie se entera.
let mirando = null;

// Se pregunta ANTES de abrir la noche, no en paralelo: si llegara después,
// el formulario ya estaría en pantalla y meterle la pregunta del pago ahí
// significaría repintar y borrarle lo que la persona venía escribiendo.
// Mientras tanto se ve "Buscando la noche…", que es lo que se vería igual.
await getDoc(doc(db, 'publico', 'pagos'))
  .then((d) => { hayAlias = !!String(d.data()?.alias || '').trim(); })
  .catch(() => {});

const cual = new URL(location.href).searchParams.get('ev');
if (cual) {
  escuchar(cual);
} else {
  onSnapshot(doc(db, 'publico', 'registro'), (d) => {
    const ev = d.exists() ? d.data().eventoId : null;
    if (ev) escuchar(ev);
    else { registro = null; pintar(); }
  }, fallaCarga);
}

function escuchar(ev) {
  if (mirando === ev) return;
  mirando = ev;
  onSnapshot(doc(db, 'registros', ev), (d) => {
    // Firestore aplica la escritura propia en local antes de que el servidor
    // la confirme. Durante ese rato el contador sube y la noche puede parecer
    // completa por un instante; si se repintara, se borraría el formulario
    // que la persona está usando. Lo propio sin confirmar no se dibuja.
    if (d.metadata.hasPendingWrites && $('#formRegistro')) return;
    if (!d.exists()) {
      // El link apunta a una noche que no está: se dice, en vez de hacerlo
      // pasar por "no hay ninguna noche abierta", que manda a buscar donde no es.
      registro = null;
      noDisponible('El link puede ser viejo o estar cortado.');
      return;
    }
    if (d.data().abierto === false) {
      // Existe pero ya cerró. Mismo cartel: para el que llega, es lo mismo.
      registro = null;
      noDisponible('Esa noche dejó de tomar anotaciones.');
      return;
    }
    registro = { ...d.data(), eventoId: d.id };
    pintar();
  }, fallaCarga);
}

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
  yaPinto = true;

  // El contador cambia cada vez que alguien se anota — y también cuando la
  // propia anotación de esta persona se escribe local y el servidor después
  // la rechaza. Si se redibujara la pantalla entera, se borraría lo que está
  // escribiendo y el cartel de error que acaba de aparecer. Así que mientras
  // el formulario esté en pantalla y la noche siga tomando gente, se toca
  // solo el número.
  const hayForm = !!$('#formRegistro');
  const quedanAhora = registro
    ? Math.max(0, Number(registro.capacidad || 0) - Number(registro.registrados || 0))
    : 0;
  if (hayForm && registro && registro.abierto && quedanAhora > 0) {
    const n = $('#quedanLugares');
    if (n) n.textContent = quedanAhora;
    return;
  }

  if (!registro) {
    cont.innerHTML = `<div class="aviso"><span>🌙</span><div>
      <b>Por ahora no hay noche abierta para registrarse.</b><br>
      Seguinos y te avisamos cuando abra la próxima.</div></div>`;
    return;
  }
  if (!registro.abierto) {
    // La noche existe pero ya no toma gente: no es lo mismo y se nota.
    cont.innerHTML = `<div class="aviso mal"><span>🔒</span><div>
      <b>${esc(registro.nombre || 'Esa noche')} ya no toma anotaciones.</b><br>
      Si creés que es un error, escribinos.</div></div>`;
    return;
  }
  const quedan = Math.max(0, Number(registro.capacidad || 0) - Number(registro.registrados || 0));
  if (!quedan) {
    cont.innerHTML = `<div class="aviso mal"><span>🙅</span><div>
      <b>${esc(registro.nombre)} está completo.</b><br>
      Se agotaron los lugares. Escribinos por si se libera alguno.</div></div>`;
    return;
  }
  // Lo que cuesta entrar se dice ANTES de pedirle los datos, no después: que
  // se entere al llegar a la puerta es la peor manera de enterarse.
  const entrada = Number(registro.entrada || 0);
  cont.innerHTML = `
    <h1 style="font-size:1.4rem;margin:.4rem 0 .2rem">${esc(registro.nombre)}</h1>
    ${cuando() ? `<div style="color:var(--oro);font-weight:700;margin:0 0 .5rem">
      ${esc(cuando())}</div>` : ''}
    <p style="color:var(--suave);margin:0 0 ${entrada ? '.8rem' : '1.2rem'}">
      Quedan <b style="color:var(--oro)" id="quedanLugares">${quedan}</b> lugares.
      Dejanos tu nombre y tu teléfono y te damos el pase de entrada.
    </p>
    ${entrada ? `<div class="aviso" style="margin-bottom:1.2rem"><span>🎟</span><div>
      <b>La entrada sale ${plata(entrada)}.</b><br>
      Anotarte te guarda el lugar.</div></div>` : ''}
    <form id="formRegistro">
      <label class="campo">
        <span>Tu nombre y apellido</span>
        <input id="inpNombre" maxlength="60" required autocomplete="name">
      </label>
      <label class="campo">
        <span>Tu teléfono <small>(sin 0 y sin 15)</small></span>
        <div class="con-prefijo">
          <span class="prefijo">+54 9</span>
          <input id="inpTel" type="tel" maxlength="13" required autocomplete="tel"
                 inputmode="numeric" placeholder="3454 18 9066">
        </div>
        <small class="pista" id="pistaTel">${esc(FORMATO_TEL)}</small>
      </label>
      ${entrada && hayAlias ? `
      <div class="campo">
        <span>¿Cómo vas a pagar la entrada?</span>
        <div class="elegir-pago">
          <label><input type="radio" name="pago" value="efectivo" checked>
            <b>En la puerta</b><small>Efectivo, al llegar</small></label>
          <label><input type="radio" name="pago" value="virtual">
            <b>Transferencia</b><small>El alias te queda en el pase</small></label>
        </div>
      </div>` : ''}
      <div class="aviso mal oculto" id="error"><span>⚠</span><div id="errorTexto"></div></div>
      <button class="btn primario ancho-full" id="btnRegistrar" type="submit">Reservar mi lugar</button>
    </form>
    <p style="color:var(--suave);font-size:.8rem;margin-top:1rem">
      Guardamos tu nombre y teléfono para la lista de la puerta y para reconocerte
      la próxima vez que vengas. No lo compartimos con nadie.
    </p>`;

  $('#formRegistro').onsubmit = registrar;

  // Mientras escribe: solo números, de a bloques, y la pista le dice qué le
  // falta. Que se entere acá y no al tocar el botón.
  const tel = $('#inpTel');
  tel.oninput = () => {
    const d = tel.value.replace(/\D/g, '').slice(0, 10);
    tel.value = d.length > 6 ? `${d.slice(0, 4)} ${d.slice(4, 6)} ${d.slice(6)}` : d;
    const mal = d ? porQueNoVale(d) : '';
    $('#pistaTel').textContent = d && !mal ? '✓ Así está bien' : (mal || FORMATO_TEL);
    $('#pistaTel').className = 'pista' + (d && !mal ? ' bien' : (d && mal ? ' mal' : ''));
  };

  miPaseDeEstaNoche();
}

const comoPaga = () =>
  document.querySelector('input[name="pago"]:checked')?.value || 'efectivo';

// El lote: el invitado, el contador y el candado del teléfono, todo junto.
// Si algo lo rechaza, no queda nada a medias.
function loteDeAnotacion(id, nombre, telefono, registrados) {
  const lote = writeBatch(db);
  lote.set(doc(db, 'invitados', id), {
    eventoId: registro.eventoId, nombre, telefono,
    // Cómo DIJO que va a pagar. No es plata cobrada: quien cobra es la puerta.
    pago: comoPaga(),
    creadoEn: serverTimestamp(), ingresadoEn: null,
  });
  lote.update(doc(db, 'registros', registro.eventoId),
    { registrados: Number(registrados) + 1 });
  lote.set(doc(db, 'anotados', claveAnotado(registro.eventoId, telefono)), {
    eventoId: registro.eventoId, tel: digitosTel(telefono), creadoEn: serverTimestamp(),
  });
  return lote.commit();
}

async function registrar(e) {
  e.preventDefault();
  const btn = $('#btnRegistrar');
  const nombre = $('#inpNombre').value.trim();
  const telefono = digitosTel($('#inpTel').value);
  if (nombre.length < 2) return fallar('Falta tu nombre y apellido.');
  // Un solo formato para todos: así el candado del teléfono sirve de verdad.
  if (!telValido(telefono)) return fallar(porQueNoVale($('#inpTel').value));
  btn.disabled = true; btn.textContent = 'Reservando…';

  const id = token();
  // El contador sube de a uno y las reglas exigen que el número que se manda
  // sea exactamente el que hay más uno. Cuando dos se anotan en el mismo
  // segundo —que es lo que pasa justo cuando se comparte el link— el segundo
  // choca aunque haya lugar de sobra. Por eso se reintenta con el número
  // fresco en vez de echarlo.
  let ultimo = null;
  for (let intento = 0; intento < 4; intento++) {
    try {
      await loteDeAnotacion(id, nombre, telefono, registro.registrados || 0);
      localStorage.setItem('sotano:invitado', id);
      location.href = `/pase.html?i=${encodeURIComponent(id)}`;
      return;
    } catch (err) {
      ultimo = err;
      if (err.code !== 'permission-denied') break;
      // Releer el estado real: si se llenó, no hay nada que reintentar; si
      // todavía hay lugar, se perdió una carrera y se vuelve a probar.
      let r;
      try { r = (await getDoc(doc(db, 'registros', registro.eventoId))).data(); }
      catch { break; }
      if (!r || r.abierto === false) break;
      if (Number(r.registrados || 0) >= Number(r.capacidad || 0)) {
        registro = { ...registro, ...r };
        break;
      }
      registro = { ...registro, ...r };
      await new Promise((ok) => setTimeout(ok, 150 + Math.random() * 350));
    }
  }

  btn.disabled = false; btn.textContent = 'Reservar mi lugar';
  if (ultimo && ultimo.code !== 'permission-denied') {
    return fallar(ultimo.code || ultimo.message);
  }
  // Agotados los reintentos: o se llenó, o ese teléfono ya está anotado.
  // Desde afuera no se ve cuál, así que se mira el cupo para decidir.
  const quedan = Number(registro.capacidad || 0) - Number(registro.registrados || 0);
  if (registro.abierto === false) {
    return fallar('Esa noche dejó de tomar anotaciones mientras completabas.');
  }
  fallar(quedan <= 0
    ? 'Justo se agotaron los lugares. Probá de nuevo por si se libera alguno.'
    : 'Con ese teléfono ya hay alguien anotado para esta noche. Si perdiste tu pase, escribinos y te lo reenviamos.');
}

function fallar(texto) {
  $('#errorTexto').textContent = texto;
  $('#error').classList.remove('oculto');
}
