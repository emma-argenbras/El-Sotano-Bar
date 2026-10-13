// El Sótano — panel de barra. Tablero en vivo, cambio de estado y control de stock.
// El SDK viene empaquetado en /vendor (ver src/firebase.js), no del CDN.
import {
  initializeApp,
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, deleteApp,
  getFirestore, connectFirestoreEmulator, collection, doc, query, where, orderBy,
  onSnapshot, updateDoc, setDoc, deleteDoc, getDocs, Timestamp, addDoc, limit, serverTimestamp,
} from '/vendor/firebase.js';
import { claveAnotado, digitosTel, telValido, porQueNoVale, FORMATO_TEL } from '/tel.js';

// Las cuentas del turno no tienen mail: el usuario escribe "barra-lunes" y
// por detrás va "barra-lunes@barra.local". El dominio no existe ni tiene que
// existir — Firebase solo pide que el string tenga forma de mail.
const DOMINIO_TURNO = 'barra.local';
const aMail = (entrada) => {
  const t = String(entrada || '').trim().toLowerCase();
  return t.includes('@') ? t : `${t}@${DOMINIO_TURNO}`;
};
const aUsuario = (mail) => String(mail || '').replace(`@${DOMINIO_TURNO}`, '');

const CFG = window.CONFIG_FIREBASE || {};
const BAR = window.CONFIG_BAR || { moneda: '$', alertaDemoraMin: 8 };
const $ = (s) => document.querySelector(s);

if (!CFG.apiKey || String(CFG.apiKey).startsWith('REEMPLAZAR')) {
  $('#avisoConfig').classList.remove('oculto');
  $('#formLogin').style.display = 'none';
  throw new Error('config.js sin completar');
}

const app = initializeApp(CFG);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// En local apuntamos a los emuladores: nunca tocar datos de producción probando.
const EMULADOR = ['localhost', '127.0.0.1'].includes(location.hostname);
if (EMULADOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const plata = (n) => BAR.moneda + Number(n || 0).toLocaleString('es-AR');
const DEMORA_MS = (BAR.alertaDemoraMin || 8) * 60_000;

const COLUMNAS = [
  { clave: 'nuevo',          titulo: 'Entraron',   siguiente: 'en_preparacion', accion: 'Preparar' },
  { clave: 'en_preparacion', titulo: 'Preparando', siguiente: 'listo',          accion: 'Listo' },
  { clave: 'listo',          titulo: 'Para llevar a la mesa', siguiente: 'entregado', accion: 'Entregado' },
  { clave: 'entregado',      titulo: 'Entregados', siguiente: null,             accion: null },
];

const estado = { pedidos: [], carta: [], evento: null, eventos: [], agenda: [], mes: null, diaElegido: null, editandoEvento: null, accesos: [], invitados: [], invitadosTodos: [], invitandoA: null, registros: {}, pliegues: { faltan: true, adentro: false, anotados: false }, verTodos: {}, registro: null, buscaInvitado: '', dueno: false, rol: '', ordenCaja: 'fecha', detalleEvento: null, tomandoPedidos: true, desdeCache: false, usuario: '', sonido: localStorage.getItem('sotano:sonido') !== 'no', vistos: new Set() };

// ---------- instalar la app ----------
// Instalada, la barra abre a pantalla completa y sin barra del navegador.
// Tiene manifest propio (manifest-barra.webmanifest), así que arranca en el
// tablero y no en la carta del cliente.
let pedidoDeInstalar = null;
const yaInstalada = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Qué aparato es, para poder explicar el camino correcto. Chrome y Edge
// disparan beforeinstallprompt; Safari y Firefox no, y hay que hacerlo a mano.
function aparato() {
  const ua = navigator.userAgent;
  const tactil = navigator.maxTouchPoints > 1;
  if (/iphone|ipod/i.test(ua) || (/ipad/i.test(ua)) || (navigator.platform === 'MacIntel' && tactil)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/firefox/i.test(ua)) return 'firefox';
  if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return 'safari';
  return 'escritorio';
}

const PASOS = {
  ios: `<ol style="padding-left:1.1rem;margin:0">
      <li>Tocá <b>Compartir</b> <span style="font-size:1.1em">⬆︎</span>, abajo en el medio.</li>
      <li>Bajá hasta <b>Agregar a inicio</b>.</li>
      <li>Confirmá con <b>Agregar</b>.</li>
    </ol>
    <p style="color:var(--suave);font-size:.85rem;margin-bottom:0">
      Tiene que ser desde <b>Safari</b>. Desde Chrome en iPhone no se puede: es una
      restricción de Apple, no de la app.</p>`,
  android: `<ol style="padding-left:1.1rem;margin:0">
      <li>Tocá los <b>tres puntos</b> ⋮ arriba a la derecha.</li>
      <li>Elegí <b>Instalar app</b> o <b>Agregar a pantalla principal</b>.</li>
    </ol>`,
  safari: `<ol style="padding-left:1.1rem;margin:0">
      <li>En el menú <b>Archivo</b>, elegí <b>Agregar al Dock</b>.</li>
    </ol>
    <p style="color:var(--suave);font-size:.85rem;margin-bottom:0">
      Necesitás macOS Sonoma o más nuevo. Si no lo ves, abrila en Chrome.</p>`,
  firefox: `<p style="margin:0">Firefox en escritorio no instala aplicaciones web.
      Abrí <b>${location.host}/bar.html</b> en Chrome, Edge o Safari y desde ahí sí se puede.</p>`,
  escritorio: `<ol style="padding-left:1.1rem;margin:0">
      <li>Mirá la <b>barra de direcciones</b>: a la derecha aparece un ícono de instalar
          <span style="font-size:1.1em">⊕</span>.</li>
      <li>Si no está, entrá a los <b>tres puntos</b> ⋮ → <b>Transmitir, guardar y compartir</b>
          → <b>Instalar página como aplicación</b>.</li>
    </ol>`,
};

function pintarInstalar() {
  const listo = yaInstalada();
  // El botón del encabezado va siempre que no esté instalada, haya prompt o no:
  // si el navegador no lo ofrece, el diálogo explica cómo hacerlo a mano.
  document.querySelectorAll('[data-instalar-btn]').forEach((b) => { b.hidden = listo; });
  const caja = document.querySelector('.instalar');
  if (caja) caja.classList.toggle('oculto', listo);
}

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pedidoDeInstalar = e;
  pintarInstalar();
});
addEventListener('appinstalled', () => {
  pedidoDeInstalar = null;
  $('#dlgInstalar').close();
  pintarInstalar();
});

async function lanzarInstalacion() {
  if (pedidoDeInstalar) {
    // El prompt del navegador se gasta de un solo uso, aunque diga que no.
    const prompt = pedidoDeInstalar;
    pedidoDeInstalar = null;
    prompt.prompt();
    await prompt.userChoice;
    pintarInstalar();
    return;
  }
  // Sin prompt: Safari, Firefox, o Chrome que ya lo gastó. Mostramos el camino.
  $('#pasosInstalar').innerHTML = PASOS[aparato()];
  $('#dlgInstalar').showModal();
}

document.querySelectorAll('[data-instalar-btn]').forEach((b) => b.onclick = lanzarInstalacion);
$('#btnCerrarInstalar').onclick = () => $('#dlgInstalar').close();
pintarInstalar();

// ---------- conexión ----------
// navigator.onLine miente: hay navegadores que lo dejan en false con
// internet andando. El que sabe de verdad es Firestore — si lo que estamos
// mostrando sale del cache, no estamos hablando con el servidor.
function pintarConexion() {
  const chip = $('#chipConexion');
  chip.hidden = !estado.desdeCache;
  chip.textContent = 'sin conexión';
  chip.className = 'chip mal';
}
addEventListener('online', pintarConexion);
addEventListener('offline', pintarConexion);

// ---------- login ----------
$('#formLogin').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#btnEntrar');
  btn.disabled = true; btn.textContent = 'Entrando…';
  $('#errorLogin').classList.add('oculto');
  try {
    await signInWithEmailAndPassword(auth, aMail($('#inpMail').value), $('#inpPass').value);
  } catch (err) {
    $('#errorLoginTexto').textContent = mensajeAuth(err.code) || err.message;
    $('#errorLogin').classList.remove('oculto');
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
};

$('#btnOlvide').onclick = async () => {
  const mail = aMail($('#inpMail').value);
  if (!mail.startsWith('@') && !mail.includes('@')) { $('#inpMail').focus(); return; }
  if (mail.endsWith(`@${DOMINIO_TURNO}`)) {
    $('#errorLoginTexto').textContent =
      'Las cuentas de turno no tienen mail. Pedile al dueño que te la cambie desde el panel.';
    $('#errorLogin').className = 'aviso mal';
    $('#errorLogin').classList.remove('oculto');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, mail);
    $('#errorLoginTexto').textContent = 'Te mandamos un mail para cambiar la contraseña.';
    $('#errorLogin').className = 'aviso ok';
    $('#errorLogin').classList.remove('oculto');
  } catch (err) {
    $('#errorLoginTexto').textContent = mensajeAuth(err.code) || err.message;
    $('#errorLogin').classList.remove('oculto');
  }
};

function mensajeAuth(code) {
  return {
    'auth/invalid-credential': 'Mail o contraseña incorrectos.',
    'auth/wrong-password':     'Contraseña incorrecta.',
    'auth/user-not-found':     'Ese mail no está dado de alta.',
    'auth/invalid-email':      'El mail no es válido.',
    'auth/too-many-requests':  'Demasiados intentos. Esperá un minuto.',
    'auth/network-request-failed': 'Sin conexión.',
  }[code];
}

$('#btnSalir').onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
  const dentro = !!u && !u.isAnonymous;
  $('#vistaLogin').hidden = dentro;
  $('#vistaPanel').hidden = !dentro;
  if (!dentro) return;
  estado.usuario = aUsuario(u.email);
  pintarConexion(); pintarSonido(); escucharEvento(); escucharCarta();
  escucharInvitados();
  vigilarMiAcceso(u.uid);
  // Quién es dueño lo deciden las reglas, no el cliente: si puede listar los
  // accesos, es dueño. Así no hay una segunda lista de mails que mantener.
  escucharAccesos();
});

// ---------- eventos ----------
// Un evento es una noche de trabajo: se abre, entran pedidos, se cierra y la
// caja queda congelada ahí. No se corta a medianoche como el día calendario,
// que es justo cuando un bar está lleno.
const EVENTOS = () => collection(db, 'barra', 'eventos', 'items');
// Lo lee cualquiera sin loguearse: el QR de la mesa necesita saberlo antes
// de que el cliente entre. Las reglas rechazan pedidos nuevos si está en no.
const ESTADO_LOCAL = () => doc(db, 'publico', 'estado');
// Quién trabaja esta noche. Las reglas leen este documento para decidir si un
// barman entra: registrado no alcanza, hay que estar asignado al turno.
const TURNO = () => doc(db, 'barra', 'turno');

async function marcarTurno(eventoId, barmanes) {
  await setDoc(TURNO(), { eventoId, barmanes, cambiadoEn: serverTimestamp() });
}

async function marcarTomandoPedidos(valor, evento) {
  await setDoc(ESTADO_LOCAL(), {
    tomandoPedidos: valor,
    evento: valor ? (evento?.nombre ?? null) : null,
    eventoId: valor ? (evento?.id ?? null) : null,
    cambiadoEn: serverTimestamp(),
  });
}


function escucharEvento() {
  // La agenda: lo que viene, por fecha. El registro de invitados puede estar
  // abierto para una noche agendada sin que la noche haya empezado.
  onSnapshot(query(EVENTOS(), where('estado', '==', 'agendado'), orderBy('fecha', 'asc')), (snap) => {
    estado.agenda = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarEvento(); pintarCalendario();
  }, fallo('#evento'));

  onSnapshot(query(EVENTOS(), where('estado', '==', 'abierto'), limit(1)), (snap) => {
    estado.evento = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    // Siempre: escucharPedidos() no hace nada si el "desde" no cambió. Hace
    // falta llamarlo igual porque abiertoEn es un serverTimestamp y llega null
    // en la primera vuelta — el evento no cambia de id, pero sí de arranque.
    escucharPedidos();
    pintarEvento();
    pintarCaja();
    pintarCalendario();
  }, fallo('#evento'));

  // El puntero del link viejo (/registro.html sin noche): a qué noche manda.
  onSnapshot(doc(db, 'publico', 'registro'), (d) => {
    estado.registro = d.exists() ? d.data() : null;
    pintarInvitar(); pintarPuerta(); pintarEvento(); pintarCalendario();
  }, () => {});

  // Un registro por noche. Cada uno con su cupo y su cuenta.
  onSnapshot(collection(db, 'registros'), (snap) => {
    estado.registros = {};
    snap.docs.forEach((d) => { estado.registros[d.id] = d.data(); });
    pintarInvitar(); pintarPuerta(); pintarEvento(); pintarCalendario();
  }, () => {});

  onSnapshot(ESTADO_LOCAL(), (d) => {
    estado.tomandoPedidos = d.exists() ? d.data().tomandoPedidos !== false : true;
    pintarEvento();
  }, () => {});

  onSnapshot(query(EVENTOS(), where('estado', '==', 'cerrado'), orderBy('fecha', 'desc'), limit(30)), (snap) => {
    estado.eventos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarEventosPasados(); pintarCalendario();
  }, fallo('#eventosPasados'));
}

const fallo = (sel) => (e) => {
  if (e.code === 'permission-denied') $('#avisoPermiso').classList.remove('oculto');
  // failed-precondition acá es casi siempre un índice que falta o que todavía
  // se está construyendo. Decirlo así, y no con el código pelado.
  const texto = e.code === 'failed-precondition'
    ? '<b>Esto todavía no está listo.</b><br>La base está armando un índice nuevo. '
      + 'Probá de nuevo en unos minutos; el resto del panel anda igual.'
    : esc(e.code || e.message);
  $(sel).innerHTML = `<div class="aviso mal"><span>⚠</span><div>${texto}</div></div>`;
};

// Desde cuándo mira el tablero: el arranque del evento abierto, o el día de hoy.
function desdeCuando() {
  const abierto = estado.evento?.abiertoEn?.toDate?.();
  if (abierto) return abierto;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return hoy;
}

function abrirEvento(editando = null, cuando = null) {
  estado.editandoEvento = editando;
  const d = editando ? editando.fecha?.toDate?.() : (cuando || new Date());
  const etiqueta = (d || new Date()).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' });
  $('#inpEvento').value = editando?.nombre || (etiqueta[0].toUpperCase() + etiqueta.slice(1));
  $('#inpFecha').value = (d || new Date()).toISOString().slice(0, 10);
  $('#inpCapacidad').value = editando?.capacidad || '';
  $('#tituloEvento').textContent = editando ? 'Editar la noche' : 'Agendar una noche';
  $('#btnConfirmarEvento').textContent = editando ? 'Guardar' : 'Agendar';
  pintarElegirBarman(editando?.barmanes || []);
  $('#dlgEvento').showModal();
  $('#inpEvento').focus();
}

function pintarElegirBarman(marcados = []) {
  const equipo = estado.accesos.filter((a) => a.rol !== 'admin' && a.activo);
  $('#elegirBarman').innerHTML = equipo.length
    ? equipo.map((b) => `<label><input type="checkbox" value="${esc(b.uid)}"
        ${marcados.includes(b.uid) ? 'checked' : ''}> ${esc(b.usuario)}
        <small style="color:var(--suave)">${b.rol === 'puerta' ? 'puerta' : 'barra'}</small></label>`).join('')
    : `<div class="vacio">Todavía no registraste ningún barman. Podés abrir el evento
       igual y asignarlos después.</div>`;
}

const barmanMarcados = () =>
  [...document.querySelectorAll('#elegirBarman input:checked')].map((i) => i.value);

$('#btnCancelarEvento').onclick = () => $('#dlgEvento').close();
$('#btnCerrarInvitar').onclick = () => { estado.invitandoA = null; $('#dlgInvitar').close(); };
$('#btnConfirmarEvento').onclick = async () => {
  const nombre = $('#inpEvento').value.trim();
  if (!nombre) { $('#inpEvento').focus(); return; }
  const fecha = new Date($('#inpFecha').value + 'T12:00:00');
  if (isNaN(fecha)) { $('#inpFecha').focus(); return; }
  const capacidad = Math.max(0, Math.floor(Number($('#inpCapacidad').value) || 0));
  const elegidos = barmanMarcados();
  const editando = estado.editandoEvento;
  try {
    if (editando) {
      await updateDoc(doc(db, 'barra', 'eventos', 'items', editando.id),
        { nombre, fecha: Timestamp.fromDate(fecha), capacidad, barmanes: elegidos });
      // El registro de ESTA noche, que es suyo y de ninguna otra.
      if (capacidad > 0) {
        const yaHay = estado.registros[editando.id];
        await setDoc(doc(db, 'registros', editando.id), {
          eventoId: editando.id, nombre, capacidad,
          registrados: Number(yaHay?.registrados || 0),
          abierto: yaHay ? yaHay.abierto !== false : true,
        });
      } else if (estado.registros[editando.id]) {
        // Le sacaron el cupo: no hay lista, se cierra.
        await updateDoc(doc(db, 'registros', editando.id), { capacidad: 0, abierto: false });
      }
    } else {
      const ref = await addDoc(EVENTOS(), {
        nombre, fecha: Timestamp.fromDate(fecha), estado: 'agendado',
        abiertoEn: null, cerradoEn: null, cierre: null, barmanes: elegidos, capacidad,
      });
      // El registro se abre al agendar: la gracia es que se anoten antes.
      if (capacidad > 0) {
        await setDoc(doc(db, 'registros', ref.id),
          { eventoId: ref.id, nombre, capacidad, registrados: 0, abierto: true });
        // Y el link viejo, el que no dice de qué noche es, se reacomoda.
        await setDoc(doc(db, 'publico', 'registro'), { eventoId: ref.id, nombre });
        estado.registros[ref.id] = { abierto: true, capacidad, nombre };
      }
    }
    $('#dlgEvento').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
};

// El link viejo (/registro.html sin noche) tiene que llevar a algún lado: a la
// que está en curso, y si no, a la próxima agendada con cupo. Se recalcula
// cada vez que cambia la agenda, así no queda apuntando a una noche cancelada.
async function apuntarLinkViejo() {
  const enCurso = estado.evento?.id && estado.registros[estado.evento.id]?.abierto !== false
    ? estado.evento : null;
  const proxima = [...(estado.agenda || [])]
    .filter((e) => Number(e.capacidad || 0) > 0 && estado.registros[e.id]?.abierto !== false)
    .sort((a, b) => (a.fecha?.toMillis?.() || 0) - (b.fecha?.toMillis?.() || 0))[0];
  const elegida = enCurso || proxima || null;
  await setDoc(doc(db, 'publico', 'registro'),
    { eventoId: elegida?.id || null, nombre: elegida?.nombre || null }).catch(() => {});
}

// Arrancar la noche: recién acá entran pedidos.
async function empezarNoche(ev) {
  if (!confirm(`¿Arrancar "${ev.nombre}"?\n\nDesde ahora entran pedidos y la caja cuenta.`)) return;
  try {
    await updateDoc(doc(db, 'barra', 'eventos', 'items', ev.id),
      { estado: 'abierto', abiertoEn: serverTimestamp() });
    await marcarTurno(ev.id, ev.barmanes || []);
    // El link sin noche manda a la que está en curso.
    await setDoc(doc(db, 'publico', 'registro'), { eventoId: ev.id, nombre: ev.nombre });
    await marcarTomandoPedidos(true, ev);
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

async function borrarAgendado(ev) {
  if (!confirm(`¿Sacar "${ev.nombre}" de la agenda?`)) return;
  try {
    await updateDoc(doc(db, 'barra', 'eventos', 'items', ev.id), { estado: 'cancelado' });
    // Su registro se cierra: el link de esa noche deja de anotar gente.
    if (estado.registros[ev.id]) {
      await updateDoc(doc(db, 'registros', ev.id), { abierto: false });
    }
    if (estado.registro?.eventoId === ev.id) {
      if (estado.registros[ev.id]) estado.registros[ev.id] = { ...estado.registros[ev.id], abierto: false };
      await apuntarLinkViejo();
    }
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- invitaciones: el link y el QR de una noche ya creada ----------
// El link de registro es uno solo (/registro.html) y apunta a la noche que
// tenga el registro abierto. Por eso acá no alcanza con mostrarlo: hay que
// decir a qué noche está apuntando, y dejar pasarlo a esta.
// El link lleva la noche adentro: el QR de una noche no manda a otra. Es la
// diferencia entre "el link del bar" y "el link de este evento".
const LINK_REGISTRO = (ev) =>
  `${location.origin}/registro.html?ev=${encodeURIComponent(ev)}`;

// Un QR por noche, guardado para no rearmarlo en cada repintada.
const qrsGuardados = {};
// El coquito va en el medio, igual que el de la carta. Nivel H de corrección:
// por eso el logo tapando el centro no lo rompe.
async function qrRegistro(ev) {
  if (qrsGuardados[ev]) return qrsGuardados[ev];
  const { qrDataURL } = await import('/vendor/qr.js');
  const base = await qrDataURL(LINK_REGISTRO(ev), {
    width: 600, margin: 2, errorCorrectionLevel: 'H',
    color: { dark: '#0d0b10', light: '#ffffff' },
  });
  let final = base;
  try {
    const cargar = (src) => new Promise((ok, mal) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src;
    });
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 600;
    const cx = lienzo.getContext('2d');
    cx.drawImage(await cargar(base), 0, 0, 600, 600);
    const lado = 120, desde = (600 - lado) / 2;
    cx.fillStyle = '#ffffff';
    cx.fillRect(desde - 10, desde - 10, lado + 20, lado + 20);
    cx.drawImage(await cargar('/iconos/icono.svg'), desde, desde, lado, lado);
    final = lienzo.toDataURL('image/png');
  } catch { /* sin logo se lee igual */ }
  qrsGuardados[ev] = final;
  return final;
}

function abrirInvitar(ev) {
  if (!ev) return;
  estado.invitandoA = ev;
  $('#tituloInvitar').textContent = `Invitaciones · ${ev.nombre}`;
  $('#cuerpoInvitar').innerHTML = '<div class="cargando">Armando el QR…</div>';
  $('#dlgInvitar').showModal();
  pintarInvitar();
}

async function pintarInvitar() {
  const ev = estado.invitandoA;
  if (!ev || !$('#dlgInvitar').open) return;
  const url = LINK_REGISTRO(ev.id);
  const reg = estado.registros[ev.id];
  const abierto = !!reg && reg.abierto !== false;
  const anotados = Number(reg?.registrados || 0);
  const cupo = Number(ev.capacidad || 0);

  // Sin cupo no hay lista: no tiene sentido mostrar un QR que no lleva a nada.
  if (!cupo) {
    $('#cuerpoInvitar').innerHTML = `<div class="aviso mal"><span>⚠</span><div>
      <b>Esta noche no tiene cupo.</b> Sin cupo no hay lista de invitados: editala,
      ponele una capacidad y el registro abre solo.</div></div>`;
    return;
  }

  // Los anotados de esta noche, no los de la lista que esté mirando la puerta.
  const dela = (estado.invitadosTodos || [])
    .filter((i) => i.eventoId === ev.id)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  const img = await qrRegistro(ev.id);
  if (estado.invitandoA !== ev || !$('#dlgInvitar').open) return;  // cambió mientras cargaba

  const aviso = abierto ? '' : `
    <div class="aviso mal"><span>⚠</span><div>
      <b>El registro de esta noche está cerrado.</b> El link y el QR siguen siendo
      suyos, pero nadie se puede anotar hasta que lo abras.</div></div>`;

  $('#cuerpoInvitar').innerHTML = `
    ${aviso}
    <div class="lienzo-pase" style="padding:.9rem">
      <img class="qr" src="${img}" alt="QR para anotarse" style="max-width:240px">
      <div class="pie-pase">Para anotarse a ${esc(ev.nombre)}</div>
    </div>
    <p style="font-size:.8rem;color:var(--oro);word-break:break-all;margin:.8rem 0 .2rem">${esc(url)}</p>
    <p style="font-size:.78rem;color:var(--suave);margin:0 0 .8rem">
      ${anotados} de ${cupo} anotados · quedan ${Math.max(0, cupo - anotados)} lugares</p>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap">
      <button class="btn primario" id="btnMandarLink" style="flex:1">Mandar el link</button>
      <button class="btn" id="btnBajarQr" style="flex:1">Bajar el QR</button>
    </div>
    <button class="btn ${abierto ? 'peligro' : 'primario'} ancho-full solo-gerente-inline"
            id="btnAbrirRegistro" style="margin-top:.6rem">
      ${abierto ? 'Cerrar el registro de esta noche' : 'Abrir el registro de esta noche'}</button>
    ${plegable('anotados', 'Quiénes se anotaron', dela, { abierto: estado.pliegues.anotados })}
    <p style="font-size:.74rem;color:var(--suave);margin:.7rem 0 0">
      Este link y este QR son <b>de esta noche</b>: no llevan a ninguna otra. La app
      no manda nada sola: elegís vos por dónde compartirlo.</p>`;

  engancharPliegues($('#cuerpoInvitar'));
  $('#btnMandarLink').onclick = (e) => compartirRegistro(ev, e.currentTarget);
  $('#btnBajarQr').onclick = async () => {
    const a = document.createElement('a');
    a.href = await qrRegistro(ev.id);
    a.download = 'qr-' + String(ev.nombre).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
    a.click();
  };
  if ($('#btnAbrirRegistro')) $('#btnAbrirRegistro').onclick = (e) => abrirCerrarRegistro(ev, abierto, e.currentTarget);
}

// Abrir o cerrar la lista de una noche, sin tocar las otras.
async function abrirCerrarRegistro(ev, estaAbierto, boton) {
  if (estaAbierto && !confirm(`¿Cerrar el registro de "${ev.nombre}"?\n\n`
    + 'Su link deja de anotar gente. Los que ya están anotados siguen igual.')) return;
  if (boton) boton.disabled = true;
  try {
    await setDoc(doc(db, 'registros', ev.id), {
      eventoId: ev.id, nombre: ev.nombre, capacidad: Number(ev.capacidad || 0),
      registrados: Number(estado.registros[ev.id]?.registrados
        || (estado.invitadosTodos || []).filter((i) => i.eventoId === ev.id).length),
      abierto: !estaAbierto,
    });
  } catch (e) {
    if (boton) boton.disabled = false;
    alert('No se pudo: ' + (e.code || e.message));
  }
}

// El link de registro se comparte por donde el celular ofrezca: WhatsApp,
// Instagram, lo que sea. La app no manda nada por su cuenta.
async function compartirRegistro(ev, boton) {
  const url = LINK_REGISTRO(ev.id);
  const texto = `Reservá tu lugar para ${ev?.nombre || 'la próxima noche'} en El Sótano`;
  if (navigator.share) {
    try { await navigator.share({ title: 'El Sótano', text: texto, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (boton) { const a = boton.textContent; boton.textContent = 'Copiado ✓';
      setTimeout(() => { boton.textContent = a; }, 1600); }
  } catch { alert(url); }
}

// Cambiar quién está de turno sin cerrar el evento: alguien entra más tarde,
// otro se va antes.
async function editarTurno() {
  pintarElegirBarman(estado.evento?.barmanes || []);
  $('#inpEvento').value = estado.evento.nombre;
  $('#inpEvento').disabled = true;
  $('#btnConfirmarEvento').textContent = 'Guardar';
  const dlg = $('#dlgEvento');
  const antes = $('#btnConfirmarEvento').onclick;
  $('#btnConfirmarEvento').onclick = async () => {
    const elegidos = barmanMarcados();
    try {
      await updateDoc(doc(db, 'barra', 'eventos', 'items', estado.evento.id), { barmanes: elegidos });
      await marcarTurno(estado.evento.id, elegidos);
      dlg.close();
    } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  };
  dlg.addEventListener('close', () => {
    $('#inpEvento').disabled = false;
    $('#btnConfirmarEvento').textContent = 'Abrir';
    $('#btnConfirmarEvento').onclick = antes;
  }, { once: true });
  dlg.showModal();
}

// El cierre guarda los números calculados, no una referencia a los pedidos:
// el tablero solo carga el evento en curso, así que el histórico tiene que
// poder leerse sin volver a buscar nada.
function resumirCaja(pedidos) {
  const entregados = pedidos.filter((p) => p.estado === 'entregado');
  const porItem = new Map();
  for (const p of entregados) {
    for (const i of (p.items || [])) {
      const carta = estado.carta.find((x) => x.id === i.id);
      const precio = Number(carta?.precio ?? i.precio ?? 0);
      const cant = Number(i.cantidad || 0);
      const a = porItem.get(i.id) || { nombre: carta?.nombre || i.nombre || i.id, cantidad: 0, importe: 0 };
      a.cantidad += cant; a.importe += precio * cant;
      porItem.set(i.id, a);
    }
  }
  return {
    pedidos: pedidos.length,
    entregados: entregados.length,
    cancelados: pedidos.filter((p) => p.estado === 'cancelado').length,
    sinCerrar: pedidos.filter((p) => !['entregado', 'cancelado'].includes(p.estado)).length,
    facturado: entregados.reduce((s, p) => s + Number(p.total || 0), 0),
    porItem: [...porItem.values()].sort((a, b) => b.importe - a.importe),
  };
}

async function cerrarEvento() {
  const r = resumirCaja(estado.pedidos);
  const aviso = r.sinCerrar
    ? `\n\nOJO: quedan ${r.sinCerrar} pedidos sin entregar ni cancelar. No entran en la caja.`
    : '';
  if (!confirm(`Cerrar "${estado.evento.nombre}"\n\n`
    + `${r.entregados} entregados · ${plata(r.facturado)}${aviso}\n\nNo se puede reabrir.`)) return;
  // El id se guarda ACÁ: apenas la noche pasa a 'cerrado', el listener deja
  // estado.evento en null y leerlo después de un await revienta a la mitad.
  const id = estado.evento.id;
  try {
    await updateDoc(doc(db, 'barra', 'eventos', 'items', id),
      { estado: 'cerrado', cerradoEn: serverTimestamp(), cierre: r });
    await marcarTurno(null, []);
    // Cerrada la noche no se registra nadie más: su link vence acá.
    if (estado.registros[id]) {
      await updateDoc(doc(db, 'registros', id), { abierto: false });
      estado.registros[id] = { ...estado.registros[id], abierto: false };
    }
    await apuntarLinkViejo();
  } catch (e) {
    alert('No se pudo cerrar: ' + (e.code || e.message));
  }
  // Pase lo que pase con el registro, los pedidos se cortan: es lo que ve el
  // cliente, y dejarlo tomando pedidos con la noche cerrada es peor.
  try { await marcarTomandoPedidos(false); }
  catch (e) { alert('Ojo: no pude cortar los pedidos. ' + (e.code || e.message)); }
}

function pintarEvento() {
  const cont = $('#evento');
  if (!estado.evento) {
    if (!estado.dueno && estado.rol !== 'admin') {
      cont.innerHTML = `<div class="aviso"><span>🎪</span><div>
        <b>No hay ninguna noche abierta.</b><br>
        ${estado.tomandoPedidos
          ? 'Igual se están tomando pedidos: lo que entre lo vas a ver en Pedidos.'
          : 'Y no se están tomando pedidos. Avisale a quien maneja la caja.'}
        </div></div>`;
      return;
    }
    // La agenda vive en Calendario. Acá solo lo de hoy y cómo llegar allá.
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const proxima = [...estado.agenda]
      .filter((e) => e.fecha?.toDate && e.fecha.toDate() >= hoy)
      .sort((a, b) => a.fecha.toDate() - b.fecha.toDate())[0];
    cont.innerHTML = `
      <div class="aviso"><span>🎪</span><div>
        <b>No hay ninguna noche abierta.</b><br>
        ${proxima
          ? `La próxima es <b>${esc(proxima.nombre)}</b>, ${proxima.fecha.toDate()
              .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}.`
          : 'Tampoco hay ninguna agendada.'}
        </div></div>

      <div class="interruptor">
        <div>
          <b>${estado.tomandoPedidos ? 'Tomando pedidos' : 'No se toman pedidos'}</b>
          <span>${estado.tomandoPedidos
            ? 'Sin noche abierta, pero el QR deja pedir.'
            : 'El QR anda y nadie puede mandar un pedido.'}</span>
        </div>
        <button class="btn ${estado.tomandoPedidos ? 'peligro' : 'primario'} solo-gerente-inline" id="btnTomando">
          ${estado.tomandoPedidos ? 'Cortar' : 'Reabrir'}
        </button>
      </div>

      ${proxima ? `<button class="btn primario ancho-full solo-gerente-inline" data-empezar="${esc(proxima.id)}"
        style="margin-top:.9rem">Arrancar ${esc(proxima.nombre)}</button>` : ''}
      <button class="btn ancho-full solo-gerente-inline" id="btnIrCalendario" style="margin-top:.6rem">
        Ver el calendario</button>`;

    if ($('#btnTomando')) $('#btnTomando').onclick = async () => {
      const prender = !estado.tomandoPedidos;
      if (!prender && !confirm('¿Cortar los pedidos?')) return;
      try { await marcarTomandoPedidos(prender, null); }
      catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
    };
    if ($('#btnIrCalendario')) $('#btnIrCalendario').onclick = () => irA('calendario');
    enganchatNoches(cont, hoy);
    return;
  }
  const desde = estado.evento.abiertoEn?.toDate?.();
  const horas = desde ? ((Date.now() - desde) / 3600000) : 0;
  const r = resumirCaja(estado.pedidos);
  cont.innerHTML = `
    <div class="caja-evento">
      <div class="titulo">${esc(estado.evento.nombre)}</div>
      <div class="desde">Abierto ${desde ? desde.toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }) : '—'}
        · ${horas < 1 ? 'hace menos de una hora' : `hace ${Math.floor(horas)} h`}</div>
      <div class="numeros">
        <div><b>${r.entregados}</b><span>entregados</span></div>
        <div><b>${r.sinCerrar}</b><span>en curso</span></div>
        <div><b>${r.cancelados}</b><span>cancelados</span></div>
        <div class="plata"><b>${plata(r.facturado)}</b><span>caja</span></div>
      </div>
      ${Number(estado.evento.capacidad || 0) > 0 ? `
      <div class="interruptor" style="margin-top:.9rem">
        <div>
          <b>Registro de invitados</b>
          <span>${Number(estado.registros[estado.evento.id]?.registrados || 0)} de ${Number(estado.evento.capacidad)} anotados
            · ${estado.invitados.filter((i) => i.ingresadoEn).length} adentro${
            estado.registros[estado.evento.id]?.abierto === false ? ' · registro cerrado' : ''}</span>
          <span style="word-break:break-all;color:var(--oro)">${esc(LINK_REGISTRO(estado.evento.id))}</span>
        </div>
        <button class="btn solo-gerente-inline" id="btnLinkRegistro">Invitaciones</button>
      </div>` : ''}
      <div class="interruptor" style="margin-top:.9rem">
        <div>
          <b>De turno</b>
          <span>${(estado.evento.barmanes || []).length
            ? (estado.evento.barmanes || []).map((u) =>
                esc(estado.accesos.find((a) => a.uid === u)?.usuario || u)).join(', ')
            : 'Nadie asignado. Solo entran los administradores.'}</span>
        </div>
        <button class="btn solo-gerente-inline" id="btnTurno">Cambiar</button>
      </div>
      ${r.sinCerrar ? `<div class="aviso mal" style="margin-top:.8rem"><span>⚠</span><div>
        Hay ${r.sinCerrar} pedidos sin entregar. <b>No suman a la caja</b> hasta que los marques.</div></div>` : ''}
      <div class="interruptor">
        <div>
          <b>${estado.tomandoPedidos ? 'Tomando pedidos' : 'No se toman pedidos'}</b>
          <span>${estado.tomandoPedidos
            ? 'El QR de la mesa abre la carta y deja pedir.'
            : 'El QR sigue andando, pero nadie puede mandar un pedido.'}</span>
        </div>
        <button class="btn ${estado.tomandoPedidos ? 'peligro' : 'primario'} solo-gerente-inline" id="btnTomando">
          ${estado.tomandoPedidos ? 'Cortar' : 'Reabrir'}
        </button>
      </div>
      ${r.porItem.length ? `<table class="ranking"><tbody>${r.porItem.map((i) => `
        <tr><td>${esc(i.nombre)}</td><td class="n">${i.cantidad}</td><td class="n">${plata(i.importe)}</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:var(--suave);font-size:.9rem">Todavía no se entregó nada.</p>'}
      <button class="btn peligro ancho-full solo-gerente-inline" id="btnCerrarEvento"
              style="margin-top:1rem">Cerrar evento y hacer la caja</button>
    </div>`;
  if ($('#btnCerrarEvento')) $('#btnCerrarEvento').onclick = cerrarEvento;
  if ($('#btnTurno')) $('#btnTurno').onclick = editarTurno;
  if ($('#btnLinkRegistro')) $('#btnLinkRegistro').onclick = () => abrirInvitar(estado.evento);
  if ($('#btnTomando')) $('#btnTomando').onclick = async () => {
    const prender = !estado.tomandoPedidos;
    if (!prender && !confirm('¿Cortar los pedidos?\n\nEl QR sigue andando, pero el cliente no va a poder mandar nada hasta que lo reabras.')) return;
    try { await marcarTomandoPedidos(prender, estado.evento); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  };
}

function pintarEventosPasados() {
  const cont = $('#eventosPasados');
  if (!estado.eventos.length) {
    cont.innerHTML = '<p style="color:var(--suave);font-size:.9rem">Todavía no cerraste ninguno.</p>';
    return;
  }

  // La caja general: la suma de todo lo cerrado. Es el número que se mira
  // para saber cómo viene el mes, no el de una noche suelta.
  const total = estado.eventos.reduce((a, e) => a + Number(e.cierre?.facturado || 0), 0);
  const pedidos = estado.eventos.reduce((a, e) => a + Number(e.cierre?.entregados || 0), 0);
  const ticket = pedidos ? Math.round(total / pedidos) : 0;
  const mejor = [...estado.eventos].sort(
    (a, b) => Number(b.cierre?.facturado || 0) - Number(a.cierre?.facturado || 0))[0];

  // Lo más vendido de todos los eventos juntos: qué conviene tener siempre.
  const acumulado = new Map();
  for (const e of estado.eventos) {
    for (const i of (e.cierre?.porItem || [])) {
      const a = acumulado.get(i.nombre) || { cantidad: 0, importe: 0 };
      a.cantidad += Number(i.cantidad || 0);
      a.importe += Number(i.importe || 0);
      acumulado.set(i.nombre, a);
    }
  }
  const top = [...acumulado].sort((a, b) => b[1].importe - a[1].importe).slice(0, 5);

  const porPlata = estado.ordenCaja === 'plata';
  const lista = [...estado.eventos].sort(porPlata
    ? (a, b) => Number(b.cierre?.facturado || 0) - Number(a.cierre?.facturado || 0)
    : (a, b) => (b.cerradoEn?.seconds || 0) - (a.cerradoEn?.seconds || 0));

  cont.innerHTML = `
    <div class="caja-evento">
      <div class="titulo">Caja general</div>
      <div class="desde">${estado.eventos.length} evento${estado.eventos.length === 1 ? '' : 's'} cerrado${estado.eventos.length === 1 ? '' : 's'}</div>
      <div class="numeros">
        <div class="plata"><b>${plata(total)}</b><span>facturado</span></div>
        <div><b>${pedidos}</b><span>pedidos</span></div>
        <div><b>${plata(ticket)}</b><span>por pedido</span></div>
      </div>
      ${mejor ? `<p style="font-size:.86rem;color:var(--suave);margin:.9rem 0 0">
        La mejor noche fue <b style="color:var(--texto)">${esc(mejor.nombre)}</b>
        con ${plata(mejor.cierre?.facturado || 0)}.</p>` : ''}
      ${top.length ? `<div class="grupo-personal">Lo más vendido, de todas las noches</div>
        <table class="ranking"><tbody>${top.map(([nombre, i]) => `
          <tr><td>${esc(nombre)}</td><td class="n">${i.cantidad}</td><td class="n">${plata(i.importe)}</td></tr>`).join('')}
        </tbody></table>` : ''}
    </div>

    <div class="grupo-personal" style="display:flex;align-items:center;gap:.6rem">
      <span style="flex:1">Noche por noche</span>
      <button class="btn" id="btnOrdenCaja" style="padding:.25rem .6rem;font-size:.72rem;text-transform:none;letter-spacing:0">
        ${porPlata ? 'Ver por fecha' : 'Ver por facturación'}
      </button>
    </div>
    ${lista.map((e, i) => {
      const c = e.cierre || {};
      const f = e.cerradoEn?.toDate?.();
      const abierto = estado.detalleEvento === e.id;
      return `<div class="item ${abierto ? '' : ''}" style="flex-wrap:wrap">
        <div class="cuerpo">
          <div class="nombre">${porPlata ? `<b style="color:var(--oro)">${i + 1}º</b> ` : ''}${esc(e.nombre)}</div>
          <div class="desc">${f ? f.toLocaleDateString('es-AR') : ''} · ${c.entregados ?? 0} entregados${c.cancelados ? ` · ${c.cancelados} cancelados` : ''}</div>
        </div>
        <div class="total">${plata(c.facturado || 0)}</div>
        <button class="btn" data-detalle="${esc(e.id)}" style="padding:.3rem .6rem;font-size:.78rem">
          ${abierto ? 'Ocultar' : 'Ver'}
        </button>
        ${abierto ? `<table class="ranking" style="flex-basis:100%"><tbody>${
          (c.porItem || []).length
            ? (c.porItem || []).map((it) => `<tr><td>${esc(it.nombre)}</td>
                <td class="n">${it.cantidad}</td><td class="n">${plata(it.importe)}</td></tr>`).join('')
            : '<tr><td colspan="3" style="color:var(--suave)">No se entregó nada esa noche.</td></tr>'
        }</tbody></table>` : ''}
      </div>`;
    }).join('')}`;

  $('#btnOrdenCaja').onclick = () => {
    estado.ordenCaja = porPlata ? 'fecha' : 'plata';
    pintarEventosPasados();
  };
  cont.querySelectorAll('[data-detalle]').forEach((b) => b.onclick = () => {
    estado.detalleEvento = estado.detalleEvento === b.dataset.detalle ? null : b.dataset.detalle;
    pintarEventosPasados();
  });
}

// ---------- calendario ----------
// Separado de la noche en curso a propósito: una cosa es trabajar esta noche
// y otra es mirar el mes. Amontonarlas en la misma pantalla no deja hacer
// ninguna de las dos bien.
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const mismaFecha = (a, b) => a && b && a.toDateString() === b.toDateString();

// Todo lo que el panel tiene cargado, en una sola lista para el mes.
function noches() {
  const abierto = estado.evento ? [{ ...estado.evento, estado: 'abierto' }] : [];
  return [...estado.agenda, ...abierto, ...estado.eventos]
    .filter((e) => e.fecha?.toDate)
    .map((e) => ({ ...e, _f: e.fecha.toDate() }));
}

function pintarCalendario() {
  const cont = $('#calendario');
  if (!cont) return;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const cursor = estado.mes ? new Date(estado.mes) : new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const todas = noches();

  const primero = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const ultimo = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  // La semana arranca el lunes, como la semana de un bar.
  const antes = (primero.getDay() + 6) % 7;

  const celdas = [];
  for (let i = 0; i < antes; i++) celdas.push('<div class="dia vacio"></div>');
  for (let d = 1; d <= ultimo.getDate(); d++) {
    const fecha = new Date(cursor.getFullYear(), cursor.getMonth(), d);
    const delDia = todas.filter((e) => mismaFecha(e._f, fecha));
    celdas.push(`<button class="dia ${mismaFecha(fecha, hoy) ? 'hoy' : ''} ${
      mismaFecha(fecha, estado.diaElegido) ? 'elegido' : ''}" data-dia="${fecha.toISOString()}">
      <span>${d}</span>
      <span class="puntos">${delDia.slice(0, 3).map((e) =>
        `<span class="punto ${esc(e.estado || 'agendado')}"></span>`).join('')}</span>
    </button>`);
  }

  const elegidas = estado.diaElegido
    ? todas.filter((e) => mismaFecha(e._f, estado.diaElegido))
    : todas.filter((e) => e._f >= hoy && e.estado === 'agendado')
        .sort((a, b) => a._f - b._f).slice(0, 8);

  cont.innerHTML = `
    <div class="mes-cabeza">
      <button class="btn" id="mesAntes">‹</button>
      <div class="nombre-mes">${cursor.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</div>
      <button class="btn" id="mesDespues">›</button>
    </div>
    <div class="grilla-mes">
      ${DIAS.map((d) => `<div class="dia-nombre">${d}</div>`).join('')}
      ${celdas.join('')}
    </div>
    <div class="leyenda">
      <span><i class="punto agendado"></i> agendada</span>
      <span><i class="punto abierto"></i> en curso</span>
      <span><i class="punto cerrado"></i> cerrada</span>
    </div>

    <div class="grupo-personal">${estado.diaElegido
      ? estado.diaElegido.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
      : 'Lo que viene'}</div>
    ${elegidas.length ? elegidas.map((e) => filaNoche(e, hoy)).join('')
      : `<p style="color:var(--suave);font-size:.9rem;margin:0">Nada ${
          estado.diaElegido ? 'ese día' : 'agendado'}.</p>`}
    <button class="btn primario ancho-full solo-gerente-inline" id="btnAgendar" style="margin-top:.7rem">
      Agendar una noche${estado.diaElegido ? ' el ' + estado.diaElegido.toLocaleDateString('es-AR') : ''}
    </button>`;

  $('#mesAntes').onclick = () => {
    estado.mes = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    estado.diaElegido = null; pintarCalendario();
  };
  $('#mesDespues').onclick = () => {
    estado.mes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    estado.diaElegido = null; pintarCalendario();
  };
  cont.querySelectorAll('[data-dia]').forEach((b) => b.onclick = () => {
    const f = new Date(b.dataset.dia);
    estado.diaElegido = mismaFecha(f, estado.diaElegido) ? null : f;
    pintarCalendario();
  });
  if ($('#btnAgendar')) $('#btnAgendar').onclick = () => abrirEvento(null, estado.diaElegido);
  enganchatNoches(cont, hoy);
}

function filaNoche(e, hoy) {
  const pasada = e._f < hoy;
  const etiqueta = { abierto: 'en curso', cerrado: 'cerrada' }[e.estado] || (pasada ? 'ya pasó' : 'agendada');
  // El renglón va en dos filas: el nombre y la fecha arriba, los botones abajo.
  // Con cuatro botones al lado, el texto quedaba en una columna de una palabra.
  return `<div class="item fila-noche">
    <div class="cuerpo">
      <div class="nombre">${esc(e.nombre)}</div>
      <div class="desc">${e._f.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
        · ${etiqueta}${e.capacidad ? ` · cupo ${e.capacidad}` : ''}${
        estado.registros[e.id] ? ` · ${Number(estado.registros[e.id].registrados || 0)} anotados` : ''}${
        e.estado === 'cerrado' ? ` · ${plata(e.cierre?.facturado || 0)}` : ''}</div>
    </div>
    <div class="acciones-noche">
      ${Number(e.capacidad || 0) > 0 && e.estado !== 'cerrado'
        ? `<button class="btn" data-invitar="${esc(e.id)}">Invitaciones</button>` : ''}
      ${e.estado === 'agendado' ? `
        <button class="btn" data-editar="${esc(e.id)}">Editar</button>
        <button class="btn peligro" data-quitar="${esc(e.id)}">✕</button>
        <button class="btn primario" data-empezar="${esc(e.id)}">Arrancar</button>` : ''}
    </div>
  </div>`;
}

function enganchatNoches(cont, hoy) {
  const buscar = (id) => noches().find((e) => e.id === id);
  cont.querySelectorAll('[data-invitar]').forEach((b) => b.onclick = () => abrirInvitar(buscar(b.dataset.invitar)));
  cont.querySelectorAll('[data-editar]').forEach((b) => b.onclick = () => abrirEvento(buscar(b.dataset.editar)));
  cont.querySelectorAll('[data-quitar]').forEach((b) => b.onclick = () => borrarAgendado(buscar(b.dataset.quitar)));
  cont.querySelectorAll('[data-empezar]').forEach((b) => b.onclick = () => empezarNoche(buscar(b.dataset.empezar)));
}

// ---------- puerta: quién entra ----------
// La lista la ven la puerta y la casa. El invitado no: su token le abre su
// pase y nada más.
//
// La puerta mira una noche: la que está en curso. Si todavía no arrancó, la
// próxima agendada con cupo, que es la que está por entrar.
function eventoDePuerta() {
  if (estado.evento?.id) return estado.evento.id;
  const proxima = [...(estado.agenda || [])]
    .filter((e) => Number(e.capacidad || 0) > 0)
    .sort((a, b) => (a.fecha?.toMillis?.() || 0) - (b.fecha?.toMillis?.() || 0))[0];
  return proxima?.id || estado.registro?.eventoId || '';
}

function escucharInvitados() {
  onSnapshot(collection(db, 'invitados'), (snap) => {
    estado.invitadosTodos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.invitados = estado.invitadosTodos
      .filter((i) => !eventoDePuerta() || i.eventoId === eventoDePuerta())
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    pintarPuerta();
    pintarInvitar();   // si está abierto el diálogo de una noche, su lista también
  }, (e) => {
    if (e.code === 'permission-denied') { estado.invitados = []; pintarPuerta(); return; }
    fallo('#puerta')(e);
  });
}

// Token igual que el del registro por link: es la llave del pase.
function tokenInvitado() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

function abrirAltaInvitado() {
  $('#inpInvNombre').value = '';
  $('#inpInvTel').value = '';
  $('#inpInvEntra').checked = true;
  $('#paseNuevo').innerHTML = '';
  $('#btnGuardarInvitado').hidden = false;
  $('#btnGuardarInvitado').disabled = false;
  $('#btnGuardarInvitado').textContent = 'Anotar';
  $('#dlgInvitado').showModal();
  $('#inpInvNombre').focus();
}

$('#btnCerrarInvitado').onclick = () => $('#dlgInvitado').close();
$('#btnGuardarInvitado').onclick = async () => {
  const nombre = $('#inpInvNombre').value.trim();
  const telefono = digitosTel($('#inpInvTel').value);
  if (nombre.length < 2) { $('#inpInvNombre').focus(); return; }
  // Mismo molde que el registro, para que el candado del teléfono cierre. Sin
  // teléfono se puede anotar igual: en la puerta a veces no hay otra.
  if (telefono && !telValido(telefono)) {
    alert(porQueNoVale($('#inpInvTel').value));
    $('#inpInvTel').focus(); return;
  }
  const entra = $('#inpInvEntra').checked;
  const btn = $('#btnGuardarInvitado');
  const evento = eventoDePuerta();

  // Un teléfono, una anotación. Acá la casa sí puede forzarlo: pasa que dos
  // personas comparten un número. Pero que lo decida, no que se le escape.
  const repetido = digitosTel(telefono) && (estado.invitadosTodos || []).find(
    (i) => i.eventoId === evento && digitosTel(i.telefono) === digitosTel(telefono));
  let sufijo = '';
  if (repetido) {
    if (!confirm(`Con ese teléfono ya está anotado ${repetido.nombre}.\n\n¿Anotarlo igual?`)) return;
    sufijo = String(Date.now());
  }
  btn.disabled = true; btn.textContent = 'Anotando…';

  const id = tokenInvitado();
  try {
    if (digitosTel(telefono)) {
      await setDoc(doc(db, 'anotados', claveAnotado(evento, telefono, sufijo)),
        { eventoId: evento, tel: digitosTel(telefono), creadoEn: serverTimestamp() });
    }
    await setDoc(doc(db, 'invitados', id), {
      eventoId: evento,
      nombre, telefono,
      creadoEn: serverTimestamp(),
      ...(entra ? { ingresadoEn: serverTimestamp(), ingresadoPor: estado.usuario || 'casa' } : {}),
    });
    // El contador también, para que el cupo siga cuadrando.
    if (estado.registros[evento]) {
      await updateDoc(doc(db, 'registros', evento),
        { registrados: Number(estado.registros[evento].registrados || 0) + 1 }).catch(() => {});
    }
    await mostrarPaseNuevo(id, nombre);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Anotar';
    alert(e.code === 'permission-denied' && digitosTel(telefono)
      ? 'Ese teléfono ya está anotado para esta noche.'
      : 'No se pudo: ' + (e.code || e.message));
  }
};

// Su pase, igual que el de quien se registró por el link: para que pueda
// pedir con su nombre y para que lo tenga si sale y vuelve.
async function mostrarPaseNuevo(id, nombre) {
  const url = `${location.origin}/pase.html?i=${encodeURIComponent(id)}`;
  let img = '';
  try {
    const { qrDataURL } = await import('/vendor/qr.js');
    img = await qrDataURL(id, { width: 600, margin: 1, errorCorrectionLevel: 'H',
      color: { dark: '#0d0b10', light: '#ffffff' } });
  } catch { /* sin QR igual queda el link */ }
  $('#btnGuardarInvitado').hidden = true;
  $('#paseNuevo').innerHTML = `
    <div class="aviso ok" style="margin-top:.9rem"><span>✓</span><div>
      <b>${esc(nombre)} quedó anotado.</b></div></div>
    ${img ? `<div class="lienzo-pase" style="margin-top:.8rem;padding:.9rem">
      <img class="qr" src="${img}" alt="Pase de ${esc(nombre)}" style="max-width:220px">
      <div class="pie-pase">Su pase</div></div>` : ''}
    <button class="btn primario ancho-full" id="btnPasarPase" style="margin-top:.8rem">
      Mandarle el pase</button>
    <p style="font-size:.78rem;color:var(--suave);word-break:break-all;margin:.6rem 0 0">${esc(url)}</p>`;
  $('#btnPasarPase').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Tu pase — El Sótano', url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); $('#btnPasarPase').textContent = 'Link copiado ✓'; }
    catch { /* el link ya está a la vista */ }
  };
}

async function marcarIngreso(id, entra) {
  try {
    await updateDoc(doc(db, 'invitados', id), {
      ingresadoEn: entra ? serverTimestamp() : null,
      ingresadoPor: entra ? (estado.usuario || 'casa') : null,
    });
    if (navigator.vibrate) navigator.vibrate(entra ? [60, 50, 60] : 30);
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- lector de QR con la cámara ----------
let camara = null;
let leyendo = false;

async function abrirCamara() {
  const video = $('#visor');
  if (!video) return;
  try {
    camara = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false,
    });
  } catch (e) {
    $('#escaneo').innerHTML = `<div class="aviso mal"><span>⚠</span><div>
      <b>No pude abrir la cámara.</b><br>${esc(e.name)} — buscá al invitado por nombre.</div></div>`;
    return;
  }
  video.srcObject = camara;
  video.setAttribute('playsinline', '');
  await video.play().catch(() => {});
  leyendo = true;
  const { leerQR } = await import('/vendor/qr.js');
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });

  (function mirar() {
    if (!leyendo) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      lienzo.width = video.videoWidth; lienzo.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
      const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const leido = leerQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (leido?.data) return resolverEscaneo(leido.data.trim());
    }
    requestAnimationFrame(mirar);
  })();
}

function cerrarCamara() {
  leyendo = false;
  camara?.getTracks().forEach((t) => t.stop());
  camara = null;
  const v = $('#visor');
  if (v) v.srcObject = null;
}

function resolverEscaneo(texto) {
  leyendo = false;
  // El QR lleva el token pelado, pero si alguien muestra el link completo
  // también lo entendemos.
  const id = texto.includes('i=') ? new URL(texto, location.origin).searchParams.get('i') : texto;
  const inv = estado.invitados.find((x) => x.id === id);
  const caja = $('#escaneo');
  if (!inv) {
    caja.innerHTML = `<div class="aviso mal"><span>✖</span><div>
      <b>Ese pase no es de esta noche.</b><br>Buscalo por nombre o que se registre.</div></div>`;
  } else if (inv.ingresadoEn) {
    // Un pase, una entrada. El que lo reenvió por WhatsApp no pasa dos veces.
    caja.innerHTML = `<div class="aviso mal"><span>✖</span><div>
      <b>${esc(inv.nombre)} ya entró a las ${hora(inv.ingresadoEn)}.</b><br>
      Este pase se usó. Si fue un error, buscalo en la lista y tocá Deshacer.</div></div>`;
  } else {
    marcarIngreso(inv.id, true);
    // El teléfono que dejó al anotarse: sirve para chequear que el que muestra
    // el QR es el que se registró, pidiéndole los últimos números.
    caja.innerHTML = `<div class="aviso ok"><span>✓</span><div>
      <b>Adelante, ${esc(inv.nombre)}.</b><br>
      Se anotó con el <b>${esc(inv.telefono || 'sin teléfono')}</b>.</div></div>`;
  }
  caja.innerHTML += '<button class="btn primario ancho-full" id="btnSeguir" style="margin-top:.7rem">Escanear el siguiente</button>';
  $('#btnSeguir').onclick = () => { $('#escaneo').innerHTML = ''; abrirCamara(); };
}

// ---------- la lista de invitados, plegada ----------
// Con sesenta anotados una lista plana no se puede usar en un celular: se
// scrollea para siempre. Van en grupos que se abren y se cierran, y cada uno
// muestra los primeros y el resto a pedido.
const TOPE_LISTA = 20;

function renglonInvitado(i, conBoton) {
  const gastó = consumoDe(i.id);
  return `<div class="item invitado ${i.ingresadoEn ? 'adentro' : ''}">
    <div class="cuerpo">
      <div class="nombre">${esc(i.nombre)}</div>
      <div class="desc">${esc(i.telefono)}${i.ingresadoEn ? ' · entró ' + hora(i.ingresadoEn) : ''}${
        gastó ? ' · consumió ' + plata(gastó) : ''}</div>
    </div>
    ${conBoton ? `<button class="btn ${i.ingresadoEn ? '' : 'primario'}" data-ingreso="${esc(i.id)}"
            style="padding:.4rem .7rem;font-size:.82rem">
      ${i.ingresadoEn ? 'Deshacer' : 'Entró'}</button>` : ''}
    <button class="btn peligro solo-gerente-inline" data-sacar="${esc(i.id)}"
            title="Sacarlo de la lista" style="padding:.4rem .6rem;font-size:.82rem">✕</button>
  </div>`;
}

function plegable(clave, titulo, gente, { abierto = false, conBoton = false } = {}) {
  if (!gente.length) return '';
  const todos = estado.verTodos[clave];
  const muestra = todos ? gente : gente.slice(0, TOPE_LISTA);
  const faltan = gente.length - muestra.length;
  return `<details class="plegable" data-pliegue="${esc(clave)}" ${abierto ? 'open' : ''}>
    <summary>${esc(titulo)} <span class="cuantos">${gente.length}</span></summary>
    <div class="adentro-plegable">
      ${muestra.map((i) => renglonInvitado(i, conBoton)).join('')}
      ${faltan ? `<button class="btn ancho-full" data-vertodos="${esc(clave)}"
        style="margin-top:.4rem">Ver los otros ${faltan}</button>` : ''}
    </div>
  </details>`;
}

// Abrir, cerrar y "ver todos" se recuerdan: el panel se repinta con cada
// cambio en la base y sería insoportable que se cerrara solo todo el tiempo.
// Sacar a alguien de la lista: se anotó dos veces, se equivocó de noche. Van
// las tres cosas juntas: el invitado, el candado de su teléfono (para que se
// pueda volver a anotar) y el contador del cupo.
async function sacarInvitado(inv) {
  if (!confirm(`¿Sacar a ${inv.nombre} de la lista?\n\nSu pase deja de servir.`)) return;
  try {
    await deleteDoc(doc(db, 'invitados', inv.id));

    const tel = digitosTel(inv.telefono);
    if (tel) {
      // Si dos comparten teléfono porque la casa lo forzó, se libera uno solo:
      // el que quede sigue bloqueando al número.
      const candados = await getDocs(query(collection(db, 'anotados'),
        where('eventoId', '==', inv.eventoId), where('tel', '==', tel)));
      const libre = candados.docs
        .sort((a, b) => b.id.length - a.id.length)[0];   // primero la del sufijo
      if (libre) await deleteDoc(doc(db, 'anotados', libre.id));
    }

    if (estado.registros[inv.eventoId]) {
      await updateDoc(doc(db, 'registros', inv.eventoId),
        { registrados: Math.max(0, Number(estado.registros[inv.eventoId].registrados || 0) - 1) });
    }
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

function engancharPliegues(cont) {
  cont.querySelectorAll('[data-sacar]').forEach((b) => b.onclick = () => {
    const i = (estado.invitadosTodos || []).find((x) => x.id === b.dataset.sacar);
    if (i) sacarInvitado(i);
  });
  cont.querySelectorAll('[data-pliegue]').forEach((d) => d.ontoggle = () => {
    estado.pliegues[d.dataset.pliegue] = d.open;
  });
  cont.querySelectorAll('[data-vertodos]').forEach((b) => b.onclick = () => {
    estado.verTodos[b.dataset.vertodos] = true;
    if (cont.id === 'puerta') pintarPuerta(); else pintarInvitar();
  });
}

function pintarPuerta() {
  const cont = $('#puerta');
  if (!cont) return;
  const invs = estado.invitados;
  const adentro = invs.filter((i) => i.ingresadoEn).length;
  const cupo = Number(estado.registros[eventoDePuerta()]?.capacidad || 0);
  const lleno = cupo && adentro >= cupo;
  const busca = (estado.buscaInvitado || '').toLowerCase();
  const visibles = busca
    ? invs.filter((i) => `${i.nombre} ${i.telefono}`.toLowerCase().includes(busca))
    : invs;

  cont.innerHTML = `
    <div class="contador-puerta">
      <div class="${lleno ? 'lleno' : ''}"><b>${adentro}</b><span>adentro</span></div>
      <div><b>${invs.length}</b><span>registrados</span></div>
      <div><b>${cupo || '—'}</b><span>cupo</span></div>
    </div>
    ${lleno ? `<div class="aviso mal" style="margin-top:.8rem"><span>⚠</span><div>
      <b>Se llenó.</b> Entraron ${adentro} de ${cupo}.</div></div>` : ''}

    <div style="display:flex;gap:.6rem;margin-top:.9rem">
      <button class="btn primario" id="btnEscanear" style="flex:1">Escanear pase</button>
      <button class="btn" id="btnCerrarCam" style="flex:0 0 auto" hidden>Cerrar cámara</button>
    </div>
    <button class="btn ancho-full solo-gerente-inline" id="btnAltaInvitado" style="margin-top:.6rem">
      + Invitado de último momento</button>
    <video id="visor" hidden muted playsinline></video>
    <div class="resultado-escaneo" id="escaneo"></div>

    <label class="campo" style="margin-top:1.1rem">
      <span>Buscar por nombre o teléfono</span>
      <input id="inpBuscaInv" value="${esc(estado.buscaInvitado || '')}" autocomplete="off">
    </label>

    ${!invs.length
      ? '<p style="color:var(--suave);font-size:.9rem">Todavía no se registró nadie para esta noche.</p>'
      : busca
        // Buscando no se pliega nada: lo que importa es ver el resultado.
        ? (visibles.length
            ? visibles.map((i) => renglonInvitado(i, true)).join('')
            : '<p style="color:var(--suave);font-size:.9rem">Nadie con ese nombre.</p>')
        : plegable('faltan', 'Faltan entrar', visibles.filter((i) => !i.ingresadoEn),
            { abierto: estado.pliegues.faltan, conBoton: true })
          + plegable('adentro', 'Ya entraron', visibles.filter((i) => i.ingresadoEn),
            { abierto: estado.pliegues.adentro, conBoton: true })}`;

  if ($('#btnAltaInvitado')) $('#btnAltaInvitado').onclick = abrirAltaInvitado;
  $('#btnEscanear').onclick = () => {
    $('#visor').hidden = false;
    $('#btnCerrarCam').hidden = false;
    $('#escaneo').innerHTML = '';
    abrirCamara();
  };
  $('#btnCerrarCam').onclick = () => {
    cerrarCamara();
    $('#visor').hidden = true;
    $('#btnCerrarCam').hidden = true;
  };
  const inp = $('#inpBuscaInv');
  inp.oninput = () => {
    estado.buscaInvitado = inp.value;
    const pos = inp.selectionStart;
    pintarPuerta();
    const nuevo = $('#inpBuscaInv');
    nuevo.focus(); nuevo.setSelectionRange(pos, pos);
  };
  cont.querySelectorAll('[data-ingreso]').forEach((b) => b.onclick = () => {
    const i = estado.invitados.find((x) => x.id === b.dataset.ingreso);
    marcarIngreso(i.id, !i.ingresadoEn);
  });
  engancharPliegues(cont);
}

// Lo que lleva gastado un invitado: la suma de sus pedidos entregados. Sale
// de los pedidos que ya tiene cargados el tablero, sin leer nada de más.
function consumoDe(id) {
  return estado.pedidos
    .filter((p) => p.invitadoId === id && p.estado === 'entregado')
    .reduce((s, p) => s + Number(p.total || 0), 0);
}

const hora = (t) => (t?.toDate ? t.toDate().toLocaleTimeString('es-AR',
  { hour: '2-digit', minute: '2-digit' }) : '');

// ---------- padrón de personal ----------
// Cuentas usuario/contraseña, sin mail, que el dueño da de alta para un
// evento y apaga cuando termina. El permiso es accesosBarra/{uid}: apagarlo
// corta el acceso en el momento, sin tocar reglas ni redesplegar.
function escucharAccesos() {
  onSnapshot(collection(db, 'accesosBarra'), (snap) => {
    estado.dueno = true;
    aplicarRol();
    estado.accesos = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => Number(!!b.activo) - Number(!!a.activo)
        || String(a.usuario).localeCompare(String(b.usuario)));
    pintarAccesos();
  }, (e) => {
    // permission-denied acá es la respuesta esperada para el personal de
    // turno: no es dueño, no ve la administración y no pasa nada.
    estado.dueno = false;
    aplicarRol();
    if (e.code !== 'permission-denied') fallo('#accesos')(e);
  });
}

// Las reglas rechazan cualquier escritura en cuanto se apaga el acceso, pero
// un listener ya abierto puede seguir recibiendo un rato: Firestore no vuelve
// a evaluar la regla al instante. Así que cada cuenta mira su propio permiso
// y se va sola cuando se lo apagan.
// Mi rol: dueño (sin documento), gerente o barra.
function aplicarRol() {
  const b = document.body.classList;
  b.toggle('es-dueno', estado.dueno);
  b.toggle('es-gerente', estado.dueno || estado.rol === 'admin');
  b.toggle('es-barra', !estado.dueno && estado.rol === 'barman');
  // La puerta no trabaja pedidos ni carta: se le deja su pantalla y nada más.
  $('#tabCalendario').hidden = !(estado.dueno || estado.rol === 'admin');
  const soloPuerta = !estado.dueno && estado.rol === 'puerta';
  b.toggle('es-puerta', soloPuerta);
  if (soloPuerta && !$('#vistaPuerta').hidden === false) irA('puerta');
}

function vigilarMiAcceso(uid) {
  // El dueño no tiene documento de acceso, así que "no existe" no puede
  // significar echarlo. Solo se reacciona a un permiso que estuvo y se cayó.
  let loTuvo = false;
  let yendose = false;
  onSnapshot(doc(db, 'accesosBarra', uid), (d) => {
    if (d.exists()) { estado.rol = d.data().rol || 'barman'; aplicarRol(); }
    if (d.exists() && d.data().activo === true) { loTuvo = true; return; }
    if (!d.exists() && !loTuvo) return;
    if (yendose) return;
    yendose = true;
    signOut(auth).finally(() =>
      alert('Se cerró tu turno. Pedile al dueño que te vuelva a habilitar.'));
  }, () => {});
}

async function altaPersona(rol) {
  const que = { admin: 'administrador', barman: 'barman', puerta: 'puerta' }[rol];
  const usuario = (prompt(`Usuario del ${que} (sin espacios ni acentos)`) || '').trim().toLowerCase();
  if (!usuario) return;
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) {
    alert('Entre 3 y 30 caracteres: letras, números, punto, guión o guión bajo.');
    return;
  }
  const clave = prompt(`Contraseña para "${usuario}" (mínimo 6)\n\n`
    + 'Anotala: no se puede recuperar, se cambia creando otra cuenta.') || '';
  if (clave.length < 6) { if (clave) alert('Mínimo 6 caracteres.'); return; }

  // Una app aparte para el alta: createUser deja logueada a la cuenta nueva,
  // y si usáramos la principal te quedarías afuera de tu propio panel.
  const secundaria = initializeApp(CFG, 'alta-' + Date.now());
  const authSec = getAuth(secundaria);
  if (EMULADOR) connectAuthEmulator(authSec, 'http://127.0.0.1:9099', { disableWarnings: true });
  try {
    const cred = await createUserWithEmailAndPassword(authSec, aMail(usuario), clave);
    await setDoc(doc(db, 'accesosBarra', cred.user.uid), {
      usuario, rol, activo: true, creadoEn: serverTimestamp(),
    });
    alert(`Listo.\n\nUsuario: ${usuario}\nNivel: ${que}\n\n`
      + (rol === 'admin' ? ''
        : 'Para que entre, asignalo al evento desde "De turno".\n\n')
      + `Que entre en:\n${location.origin}/bar.html`);
  } catch (e) {
    alert(e.code === 'auth/email-already-in-use'
      ? `Ya existe un usuario "${usuario}". Elegí otro nombre.`
      : 'No se pudo crear: ' + (e.code || e.message));
  } finally {
    await signOut(authSec).catch(() => {});
    await deleteApp(secundaria).catch(() => {});
  }
}

async function alternarAcceso(uid) {
  const a = estado.accesos.find((x) => x.uid === uid);
  if (!a) return;
  if (a.activo && !confirm(`¿Dar de baja a "${a.usuario}"?\n\n`
    + 'Pierde el acceso al toque, aunque tenga la app abierta.')) return;
  try { await updateDoc(doc(db, 'accesosBarra', uid), { activo: !a.activo }); }
  catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

function pintarAccesos() {
  const cont = $('#accesos');
  if (!cont) return;
  const admins = estado.accesos.filter((a) => a.rol === 'admin');
  const barmanes = estado.accesos.filter((a) => (a.rol || 'barman') === 'barman');
  const puertas = estado.accesos.filter((a) => a.rol === 'puerta');

  const fila = (a) => `
    <div class="item ${a.activo ? '' : 'agotado'}">
      <div class="cuerpo">
        <div class="nombre">${esc(a.usuario)}${a.activo ? '' : ' — <small>dado de baja</small>'}</div>
        <div class="desc">${a.rol === 'admin'
          ? 'administra todo menos borrar'
          : (estado.evento?.barmanes || []).includes(a.uid) ? 'trabaja esta noche' : 'sin turno asignado'}</div>
      </div>
      <button class="btn ${a.activo ? 'peligro' : 'primario'}" data-acceso="${esc(a.uid)}"
              style="padding:.4rem .7rem;font-size:.82rem">${a.activo ? 'Dar de baja' : 'Reactivar'}</button>
    </div>`;

  cont.innerHTML = `
    <div class="grupo-personal">Administradores</div>
    ${admins.length ? admins.map(fila).join('')
      : '<p style="color:var(--suave);font-size:.88rem;margin:0">Solo vos.</p>'}
    <button class="btn ancho-full" id="btnAltaAdmin" style="margin-top:.6rem">Crear administrador</button>

    <div class="grupo-personal">Barman</div>
    ${barmanes.length ? barmanes.map(fila).join('')
      : '<p style="color:var(--suave);font-size:.88rem;margin:0">Todavía no registraste ninguno.</p>'}
    <button class="btn primario ancho-full" id="btnAltaBarman" style="margin-top:.6rem">Registrar barman</button>

    <div class="grupo-personal">Puerta</div>
    ${puertas.length ? puertas.map(fila).join('')
      : '<p style="color:var(--suave);font-size:.88rem;margin:0">Todavía no registraste ninguno.</p>'}
    <button class="btn ancho-full" id="btnAltaPuerta" style="margin-top:.6rem">Registrar gente de puerta</button>`;

  $('#btnAltaAdmin').onclick = () => altaPersona('admin');
  $('#btnAltaBarman').onclick = () => altaPersona('barman');
  $('#btnAltaPuerta').onclick = () => altaPersona('puerta');
  cont.querySelectorAll('[data-acceso]').forEach((b) =>
    b.onclick = () => alternarAcceso(b.dataset.acceso));
}

// ---------- pedidos ----------
let dejarDeEscucharPedidos = null;
let desdeActual = null;
function escucharPedidos() {
  // Arranca donde arranca el evento; si no hay evento, el día de hoy.
  const desde = desdeCuando();
  if (dejarDeEscucharPedidos && desdeActual?.getTime() === desde.getTime()) return;
  if (dejarDeEscucharPedidos) dejarDeEscucharPedidos();
  desdeActual = desde;
  estado.vistos.clear();
  const q = query(
    collection(db, 'pedidos'),
    where('creadoEn', '>=', Timestamp.fromDate(desde)),
    orderBy('creadoEn', 'asc'),
  );
  dejarDeEscucharPedidos = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    estado.desdeCache = snap.metadata.fromCache;
    pintarConexion();
    const antes = estado.vistos.size > 0;
    const nuevos = [];
    snap.docChanges().forEach((c) => {
      if (c.type === 'added' && !estado.vistos.has(c.doc.id)) nuevos.push(c.doc.id);
    });
    estado.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.pedidos.forEach((p) => estado.vistos.add(p.id));
    pintarTablero();
    pintarCaja();
    pintarEvento();
    // No sonar en la carga inicial, solo cuando entra algo nuevo estando ya abierto.
    if (antes && nuevos.some((id) => estado.pedidos.find((p) => p.id === id)?.estado === 'nuevo')) avisar();
  }, (e) => {
    if (e.code === 'permission-denied') $('#avisoPermiso').classList.remove('oculto');
    $('#tablero').innerHTML = `<div class="aviso mal"><span>⚠</span><div>${esc(e.code || e.message)}</div></div>`;
  });
}

function pintarTablero() {
  const cont = $('#tablero');
  cont.innerHTML = COLUMNAS.map((col) => {
    const items = estado.pedidos.filter((p) => p.estado === col.clave);
    return `
    <div class="columna">
      <header>${esc(col.titulo)}<span class="cuenta">${items.length}</span></header>
      ${items.length ? items.map((p) => ticket(p, col)).join('')
        : '<div class="vacio" style="padding:1rem;font-size:.85rem">Nada acá</div>'}
    </div>`;
  }).join('');

  cont.querySelectorAll('[data-avanzar]').forEach((b) =>
    b.onclick = () => cambiarEstado(b.dataset.avanzar, b.dataset.a));
  cont.querySelectorAll('[data-cancelar]').forEach((b) =>
    b.onclick = () => { if (confirm('¿Cancelar este pedido?')) cambiarEstado(b.dataset.cancelar, 'cancelado'); });
  // Entregado por error: sin esto la caja queda mal para siempre.
  cont.querySelectorAll('[data-corregir]').forEach((b) => b.onclick = () => {
    const p = estado.pedidos.find((x) => x.id === b.dataset.corregir);
    const r = prompt(`Corregir el pedido de ${p?.mesa ? 'mesa ' + p.mesa : 'sin mesa'} · ${plata(p?.total)}\n\n`
      + '1 = cancelarlo (sale de la caja)\n'
      + '2 = volverlo a Listo\n\n'
      + 'Dejalo vacío para no tocar nada.', '');
    if (r === '1') cambiarEstado(p.id, 'cancelado');
    else if (r === '2') cambiarEstado(p.id, 'listo');
  });
}

// Quién pidió. El nombre del invitado manda sobre lo que haya escrito a mano:
// es el que la puerta verificó.
function quienPidio(p) {
  return estado.invitados.find((i) => i.id === p.invitadoId)?.nombre
    || p.nombreCliente
    || (p.mesa ? 'Mesa ' + p.mesa : 'Sin nombre');
}

function ticket(p, col) {
  const ms = p.creadoEn?.toDate ? Date.now() - p.creadoEn.toDate().getTime() : 0;
  const min = Math.floor(ms / 60000);
  const tarde = col.clave !== 'entregado' && ms > DEMORA_MS;
  // La integridad del total se chequea acá: el cliente manda los precios y las
  // reglas no pueden sumar un array. Si no coincide con la carta de ahora, se marca.
  //
  // Nunca se usa el precio que vino en el pedido como respaldo: un pedido con un
  // id inventado traía su propio precio, cuadraba solo y pasaba sin marcar.
  // Un item que no está en la carta es, por definición, para mirar a mano.
  const hayCarta = estado.carta.length > 0;
  const intrusos = (p.items || []).filter((i) => !estado.carta.some((x) => x.id === i.id));
  const esperado = (p.items || []).reduce((s, i) => {
    const c = estado.carta.find((x) => x.id === i.id);
    return s + Number(c?.precio || 0) * Number(i.cantidad || 0);
  }, 0);
  const desfasado = hayCarta
    && (intrusos.length > 0 || Math.abs(esperado - Number(p.total || 0)) > 0.5);
  const aviso = intrusos.length
    ? `⚠ Tiene algo que no está en la carta (${intrusos.map((i) => esc(i.nombre || i.id)).join(', ')}) — cobralo a mano`
    : `⚠ Total informado ${plata(p.total)} ≠ carta ${plata(esperado)} — cobrar ${plata(esperado)}`;

  return `
  <div class="ticket ${col.clave} ${tarde ? 'demorado' : ''}">
    <div class="cabeza">
      <span class="mesa">${esc(quienPidio(p))}</span>
      ${p.invitadoId ? '<small style="color:var(--oro)">invitado</small>' : ''}
      ${p.mesa ? `<small style="color:var(--suave)">mesa ${esc(p.mesa)}</small>` : ''}
      <span class="reloj ${tarde ? 'tarde' : ''}">${min < 1 ? 'recién' : min + ' min'}</span>
    </div>
    <ul>${(p.items || []).map((i) =>
      `<li><b>${Number(i.cantidad)}×</b> ${esc(i.nombre)}</li>`).join('')}</ul>
    ${p.nota ? `<div class="nota">📝 ${esc(p.nota)}</div>` : ''}
    ${desfasado ? `<div class="sospecha">${aviso}</div>` : ''}
    <div class="pie">
      <span class="total">${plata(desfasado && !intrusos.length ? esperado : p.total)}</span>
      ${col.siguiente ? `<button class="btn primario" data-avanzar="${p.id}" data-a="${col.siguiente}">${col.accion}</button>` : ''}
      ${col.clave !== 'entregado'
        ? `<button class="btn peligro" data-cancelar="${p.id}" title="Cancelar">✕</button>`
        : `<button class="btn solo-gerente-inline" data-corregir="${p.id}" title="Corregir">↩</button>`}
    </div>
  </div>`;
}

async function cambiarEstado(id, nuevo) {
  try {
    await updateDoc(doc(db, 'pedidos', id), { estado: nuevo });
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) {
    alert('No se pudo cambiar el estado: ' + (e.code || e.message));
  }
}

function pintarCaja() {
  const r = resumirCaja(estado.pedidos);
  const chip = $('#chipCaja');
  // Con evento abierto la caja es la del evento; si no, la del día.
  chip.textContent = `${estado.evento ? esc(estado.evento.nombre) + ' · ' : ''}`
    + `${r.sinCerrar} en curso · ${plata(r.facturado)}`;
  chip.className = 'chip ' + (r.sinCerrar > 6 ? 'alerta' : 'ok');
}

// ---------- carta y stock ----------
function escucharCarta() {
  onSnapshot(collection(db, 'carta'), (snap) => {
    estado.carta = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || (a.orden ?? 999) - (b.orden ?? 999));
    pintarCartaBar();
    pintarTablero();
  });
}

function pintarCartaBar() {
  const cont = $('#cartaBar');
  if (!estado.carta.length) {
    cont.innerHTML = `<div class="vacio">La carta está vacía.<br><small>Desde la Mac: <code>npm run seed</code></small></div>`;
    return;
  }
  cont.innerHTML = estado.carta.map((i) => {
    const fuera = i.enCarta === false;   // retirado: el cliente no lo ve
    return `
    <div class="item ${fuera || i.disponible === false ? 'agotado' : ''}">
      <div class="cuerpo">
        <div class="nombre">${esc(i.nombre || i.id)}${fuera ? ' — <small>fuera de carta</small>' : ''}</div>
        <div class="desc">${esc(i.categoria || '')} · ${plata(i.precio)}</div>
      </div>
      <div class="cant">
        <button data-stock="${i.id}" data-d="-1" aria-label="Restar stock" ${fuera ? 'disabled' : ''}>−</button>
        <span class="n">${typeof i.stock === 'number' ? i.stock : '∞'}</span>
        <button data-stock="${i.id}" data-d="1" aria-label="Sumar stock" ${fuera ? 'disabled' : ''}>+</button>
      </div>
      <button class="btn" data-toggle="${i.id}" style="padding:.4rem .7rem;font-size:.82rem" ${fuera ? 'disabled' : ''}>
        ${i.disponible === false ? 'Activar' : 'Agotar'}
      </button>
      <button class="btn solo-gerente-inline" data-carta="${i.id}" style="padding:.4rem .7rem;font-size:.82rem">
        ${fuera ? 'Poner en carta' : 'Sacar'}
      </button>
    </div>`;
  }).join('');

  cont.querySelectorAll('[data-stock]').forEach((b) => b.onclick = async () => {
    const i = estado.carta.find((x) => x.id === b.dataset.stock);
    const n = Math.max(0, (typeof i.stock === 'number' ? i.stock : 0) + Number(b.dataset.d));
    try { await updateDoc(doc(db, 'carta', i.id), { stock: n, disponible: n > 0 }); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  });
  cont.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
    const i = estado.carta.find((x) => x.id === b.dataset.toggle);
    try { await updateDoc(doc(db, 'carta', i.id), { disponible: i.disponible === false }); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  });
  // Sacar de la carta / volver a ponerlo. Nada se borra: el item queda guardado.
  cont.querySelectorAll('[data-carta]').forEach((b) => b.onclick = async () => {
    const i = estado.carta.find((x) => x.id === b.dataset.carta);
    const volver = i.enCarta === false;
    if (!volver && !confirm(`¿Sacar "${i.nombre}" de la carta? El cliente deja de verlo.`)) return;
    try { await updateDoc(doc(db, 'carta', i.id), { enCarta: volver, ...(volver ? { disponible: true } : {}) }); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  });
}

// ---------- aviso sonoro ----------
let ctxAudio;
function avisar() {
  if (navigator.vibrate) navigator.vibrate([90, 70, 90]);
  if (!estado.sonido) return;
  try {
    ctxAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
    // Dos notas cortas: audible sobre la música sin ser una alarma.
    [[880, 0], [1320, 0.14]].forEach(([hz, t]) => {
      const o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, ctxAudio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctxAudio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + t + 0.13);
      o.connect(g); g.connect(ctxAudio.destination);
      o.start(ctxAudio.currentTime + t); o.stop(ctxAudio.currentTime + t + 0.15);
    });
  } catch {}
}

function pintarSonido() {
  $('#btnSonido').textContent = estado.sonido ? '🔔' : '🔕';
  $('#btnSonido').title = estado.sonido ? 'Aviso sonoro activado' : 'Aviso sonoro silenciado';
}
$('#btnSonido').onclick = () => {
  estado.sonido = !estado.sonido;
  localStorage.setItem('sotano:sonido', estado.sonido ? 'si' : 'no');
  pintarSonido();
  if (estado.sonido) avisar();   // también desbloquea el audio en móviles
};

// ---------- pestañas ----------
function irA(cual) {
  const vistas = { tablero: '#vistaTablero', carta: '#vistaCartaBar',
                   evento: '#vistaEvento', calendario: '#vistaCalendario', puerta: '#vistaPuerta' };
  const tabs = { tablero: '#tabTablero', carta: '#tabCartaBar',
                 evento: '#tabEvento', calendario: '#tabCalendario', puerta: '#tabPuerta' };
  // La cámara se apaga al salir de Puerta: no se deja prendida de fondo.
  if (cual !== 'puerta') cerrarCamara();
  for (const k of Object.keys(vistas)) {
    $(vistas[k]).hidden = k !== cual;
    $(tabs[k]).setAttribute('aria-selected', String(k === cual));
  }
}
$('#tabTablero').onclick = () => irA('tablero');
$('#tabCartaBar').onclick = () => irA('carta');
$('#tabEvento').onclick = () => irA('evento');
$('#tabCalendario').onclick = () => irA('calendario');
$('#tabPuerta').onclick = () => irA('puerta');

// Los relojes de los tickets tienen que correr aunque no entre nada nuevo.
setInterval(() => { if (!$('#vistaPanel').hidden && !$('#vistaTablero').hidden) pintarTablero(); }, 30_000);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------- service worker ----------
// Hace falta para que el navegador ofrezca instalar, y para que el tablero
// abra aunque la señal se corte. Antes solo lo registraba la carta: quien
// entraba derecho a /bar.html se quedaba sin las dos cosas.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
