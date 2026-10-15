// Sótano — panel de barra. Tablero en vivo, cambio de estado y control de stock.
// El SDK viene empaquetado en /vendor (ver src/firebase.js), no del CDN.
import {
  initializeApp,
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
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

// El dueño entra con su mail; el personal, con usuario@barra.local. No hay
// forma de que una cuenta de la casa se haga pasar por el dueño: el mail lo
// fija Firebase al crearla y las reglas miran lo mismo del lado del servidor.
const esElDueno = () => {
  const mail = auth.currentUser?.email || '';
  return !!mail && !mail.endsWith('@' + DOMINIO_TURNO);
};
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

const estado = { pedidos: [], carta: [], evento: null, eventos: [], agenda: [], mes: null, diaElegido: null, editandoEvento: null, accesos: [], invitados: [], invitadosTodos: [], invitandoA: null, registros: {}, esAparato: false, insumos: [], proveedores: [], compras: [], compra: { items: {} }, egresosTodos: [], conteo: null, conteoDe: null, cortarConteo: null, cargandoConteo: {}, egresos: [], pedidosCaja: [], cortarCaja: null, venta: {}, rangoCaja: 'mes', pliegues: { faltan: true, adentro: false, anotados: false }, verTodos: {}, registro: null, buscaInvitado: '', buscaClub: '', verClub: false, pagos: {}, permisos: {}, dueno: false, rol: '', ordenCaja: 'fecha', detalleEvento: null, tomandoPedidos: true, desdeCache: false, usuario: '', sonido: localStorage.getItem('sotano:sonido') !== 'no', vistos: new Set() };

// ---------- instalar la app ----------
// Vive en /instalar.js, compartido con el pase del invitado: el camino para
// instalar es el mismo en los dos lados y no tiene por qué estar dos veces.

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
      'Estas cuentas no tienen mail, así que no hay link de recuperación. '
      + 'Si la sabés, podés cambiarla desde adentro con la llave 🔑. '
      + 'Si la perdiste, pedile al dueño que te dé de alta una cuenta nueva.';
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

// ---------- cambiar la propia contraseña ----------
// Es lo unico que se puede hacer sin un servidor: Firebase deja que cada uno
// cambie la suya, nunca la de otro. Por eso, si alguien queda afuera, la
// salida es que la casa le de de alta una cuenta nueva — no hay forma de
// resetearle la contraseña desde el panel, y decir lo contrario es mentir.
$('#btnMiClave').onclick = () => {
  const u = auth.currentUser;
  if (!u) return;
  $('#quienCambiaClave').textContent = `Entrás como ${aUsuario(u.email)}.`;
  $('#inpClaveVieja').value = '';
  $('#inpClaveNueva').value = '';
  $('#inpClaveNueva2').value = '';
  $('#errorClave').classList.add('oculto');
  $('#btnConfirmarClave').disabled = false;
  $('#btnConfirmarClave').textContent = 'Cambiarla';
  $('#dlgClave').showModal();
  $('#inpClaveVieja').focus();
};
$('#btnCancelarClave').onclick = () => $('#dlgClave').close();
$('#btnConfirmarClave').onclick = async () => {
  const u = auth.currentUser;
  if (!u) return;
  const vieja = $('#inpClaveVieja').value;
  const nueva = $('#inpClaveNueva').value;
  const fallar = (t) => {
    $('#errorClaveTexto').textContent = t;
    $('#errorClave').classList.remove('oculto');
  };
  if (nueva.length < 6) {
    fallar('La nueva necesita al menos 6 caracteres.');
    $('#inpClaveNueva').focus();
    return;
  }
  if (nueva !== $('#inpClaveNueva2').value) {
    fallar('Las dos nuevas no coinciden.');
    $('#inpClaveNueva2').focus();
    return;
  }
  const btn = $('#btnConfirmarClave');
  btn.disabled = true; btn.textContent = 'Cambiando…';
  try {
    // Firebase pide volver a probar quién sos justo antes: si no, alcanzaba
    // con agarrar un celular desbloqueado para quedarse con la cuenta.
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, vieja));
    await updatePassword(u, nueva);
    $('#dlgClave').close();
    alert('Listo, tu contraseña cambió.\n\nAnotala donde la tengas: si se pierde, '
      + 'no se recupera y hay que crear una cuenta nueva.');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Cambiarla';
    fallar(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
      ? 'La contraseña de ahora no es esa.'
      : (mensajeAuth(e.code) || e.code || e.message));
  }
};

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
  escucharAccesos();
  // El depósito lo necesita hasta la barra: el descuento al entregar sale de
  // los insumos, no de la carta, para los productos que tienen receta.
  escucharDeposito();
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
  $('#inpEntrada').value = editando?.entrada || '';
  $('#tituloEvento').textContent = editando ? 'Editar la noche' : 'Agendar una noche';
  $('#btnConfirmarEvento').textContent = editando ? 'Guardar' : 'Agendar';
  pintarElegirBarman(editando?.barmanes || []);
  $('#dlgEvento').showModal();
  $('#inpEvento').focus();
}

function pintarElegirBarman(marcados = []) {
  // El celular de la barra no hace turno: es el aparato del local y entra
  // siempre. Listarlo acá era ofrecer asignar un mueble a una noche.
  const equipo = estado.accesos.filter((a) =>
    a.activo && a.rol !== 'admin' && a.rol !== 'barra');
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
$('#btnCerrarInvitar').onclick = () => {
  estado.invitandoA = null;
  // Se vacía al cerrar: si no, la lista de esa noche queda en el DOM —con sus
  // nombres y teléfonos— detrás de un diálogo cerrado, y la próxima vez que
  // se abre se ve un instante la noche anterior.
  $('#cuerpoInvitar').innerHTML = '';
  $('#dlgInvitar').close();
};
// Ver lo que se escribe: la contraseña de la barra la comparte gente que la
// tipea en un celular, y a ciegas se equivoca y no sabe por qué no entra.
$('#btnVerPass').onclick = () => {
  const i = $('#inpPass');
  const verla = i.type === 'password';
  i.type = verla ? 'text' : 'password';
  $('#btnVerPass').setAttribute('aria-pressed', String(verla));
  $('#btnVerPass').textContent = verla ? '🙈' : '👁';
  i.focus();
};

$('#btnQuienAtiende').onclick = elegirQuienAtiende;
$('#btnConteo').onclick = abrirConteo;
$('#btnCancelarInsumo').onclick = () => $('#dlgInsumo').close();
$('#btnGuardarInsumo').onclick = guardarInsumo;
$('#btnCancelarCompra').onclick = () => $('#dlgCompra').close();
$('#btnCancelarReceta').onclick = () => $('#dlgReceta').close();
$('#btnGuardarReceta').onclick = guardarReceta;
$('#btnCerrarConteo').onclick = () => $('#dlgConteo').close();
$('#btnCerrarAtiende').onclick = () => $('#dlgAtiende').close();
$('#btnCancelarPersona').onclick = () => $('#dlgPersona').close();
$('#btnConfirmarPersona').onclick = crearPersona;
$('#inpPersonaUsuario').oninput = () => {
  const i = $('#inpPersonaUsuario');
  const limpio = limpiarUsuario(i.value);
  if (limpio !== i.value) i.value = limpio;
  pistaPersona();
};
$('#btnVentaBarra').onclick = abrirVenta;
$('#btnEfectivo').onclick = () => cerrarCobro('efectivo');
$('#btnVirtual').onclick = () => cerrarCobro('virtual');
$('#btnCancelarCobro').onclick = () => { cobrando = null; $('#dlgCobro').close(); };
$('#btnCancelarVenta').onclick = () => $('#dlgVenta').close();
$('#btnCancelarEgreso').onclick = () => $('#dlgEgreso').close();
$('#btnGuardarEgreso').onclick = guardarEgreso;
$('#btnConfirmarEvento').onclick = async () => {
  const nombre = $('#inpEvento').value.trim();
  if (!nombre) { $('#inpEvento').focus(); return; }
  const fecha = new Date($('#inpFecha').value + 'T12:00:00');
  if (isNaN(fecha)) { $('#inpFecha').focus(); return; }
  const capacidad = Math.max(0, Math.floor(Number($('#inpCapacidad').value) || 0));
  // Lo que cuesta entrar esa noche. Viaja al registro, que es lo único que el
  // invitado puede leer: el documento del evento no lo ve nadie de afuera.
  const entrada = Math.max(0, Math.floor(Number($('#inpEntrada').value) || 0));
  const elegidos = barmanMarcados();
  const editando = estado.editandoEvento;
  try {
    if (editando) {
      await updateDoc(doc(db, 'barra', 'eventos', 'items', editando.id),
        { nombre, fecha: Timestamp.fromDate(fecha), capacidad, entrada, barmanes: elegidos });
      // El registro de ESTA noche, que es suyo y de ninguna otra.
      if (capacidad > 0) {
        const yaHay = estado.registros[editando.id];
        await setDoc(doc(db, 'registros', editando.id), {
          eventoId: editando.id, nombre, capacidad, entrada,
          // La fecha va acá porque el registro es lo único que el invitado
          // puede leer: una invitación sin fecha no sirve para nada.
          fecha: Timestamp.fromDate(fecha),
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
        abiertoEn: null, cerradoEn: null, cierre: null, barmanes: elegidos,
        capacidad, entrada,
      });
      // El registro se abre al agendar: la gracia es que se anoten antes.
      if (capacidad > 0) {
        await setDoc(doc(db, 'registros', ref.id), {
          eventoId: ref.id, nombre, capacidad, entrada,
          fecha: Timestamp.fromDate(fecha), registrados: 0, abierto: true,
        });
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
    // Lo que ve el cliente va primero: si algo falla más atrás, la noche ya
    // está tomando pedidos igual. Es el mismo cuidado que al cerrarla.
    await marcarTomandoPedidos(true, ev);
    // El link sin noche manda a la que está en curso. Que no pueda tumbar lo
    // de arriba: es lo de menos.
    await setDoc(doc(db, 'publico', 'registro'),
      { eventoId: ev.id, nombre: ev.nombre }).catch(() => {});
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
    // setDoc pisa el documento entero: si no se vuelven a escribir, la fecha
    // y el precio de la entrada se pierden al cerrar y reabrir una noche, y
    // la invitación queda sin decir ni cuándo es ni cuánto sale.
    await setDoc(doc(db, 'registros', ev.id), {
      eventoId: ev.id, nombre: ev.nombre, capacidad: Number(ev.capacidad || 0),
      entrada: Number(ev.entrada || estado.registros[ev.id]?.entrada || 0),
      ...(ev.fecha ? { fecha: ev.fecha } : {}),
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
  const texto = `Reservá tu lugar para ${ev?.nombre || 'la próxima noche'} en Sótano`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Sótano', text: texto, url }); return; }
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
    </button>
    ${bloqueClub()}`;

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
  engancharClub(cont);
}

// ---------- usuarios: quién es quién y qué ve ----------
// Vive en su propia pestaña y la ve solo quien reparte. Lo que se toca acá es
// el acceso de otro, nunca el propio: las reglas lo frenan, pero la pantalla
// tampoco lo ofrece — un botón que va a fallar es peor que no tenerlo.
const PANTALLAS = [
  ['pedidos', 'Pedidos', 'El tablero: mover pedidos de estado'],
  ['carta', 'Carta', 'Precios, altas y sacar productos'],
  ['noche', 'Noche', 'Arrancar la noche y armar el turno'],
  ['caja', 'Caja', 'La plata: ver y cargar gastos'],
  ['deposito', 'Depósito', 'Insumos, compras y proveedores'],
  ['calendario', 'Calendario', 'Agendar noches y abrir registros'],
  ['puerta', 'Puerta', 'Escanear pases y marcar el ingreso'],
];

const QUE_ES_EL_ROL = {
  sadmin: 'Hace todo, y además elige qué ve cada uno.',
  admin: 'Administra todo salvo borrar y repartir permisos.',
  barman: 'Mueve pedidos y cobra, la noche que está asignado.',
  puerta: 'Escanea pases, la noche que está asignada.',
  barra: 'El celular del local: entra siempre, sin depender del turno.',
};

// Los interruptores solo tienen sentido para quien administra: a un barman o
// a la puerta los limita el rol, no esta pantalla.
const SE_LE_ELIGE = (rol) => rol === 'admin';

function pintarUsuarios() {
  const cont = $('#usuarios');
  if (!cont || $('#vistaUsuarios').hidden) return;
  const yo = auth.currentUser?.uid;
  const gente = [...estado.accesos].sort((a, b) =>
    String(a.usuario).localeCompare(String(b.usuario)));

  cont.innerHTML = `
    <p style="color:var(--suave);font-size:.88rem;margin:0 0 .9rem">
      Quién entra al panel y qué ve cada uno. Lo de abajo son pantallas: lo que
      está apagado no se ve <b>ni se puede hacer</b>, aunque se sepa el camino.
    </p>
    ${gente.length ? gente.map((a) => {
      const esYo = a.uid === yo;
      const p = a.permisos || {};
      const suyo = SE_LE_ELIGE(a.rol);
      return `
      <div class="item" style="flex-direction:column;align-items:stretch;gap:.5rem">
        <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
          <div class="cuerpo" style="flex:1">
            <div class="nombre">${esc(a.usuario)}${esYo ? ' <small>(vos)</small>' : ''}</div>
            <div class="desc">${esc(QUE_ES_EL_ROL[a.rol] || QUE_ES_EL_ROL.barman)}</div>
          </div>
          <span class="chip">${esc(a.rol || 'barman')}</span>
          ${esYo ? '' : `<button class="btn ${a.activo ? '' : 'primario'}"
            data-alternar="${esc(a.uid)}" style="padding:.35rem .7rem;font-size:.8rem">
            ${a.activo ? 'Dar de baja' : 'Reactivar'}</button>`}
        </div>
        ${esYo ? `<small style="color:var(--suave)">
          Tu propio acceso no se toca desde acá, ni el tuyo ni el de nadie sobre
          sí mismo: es lo que evita que alguien se ascienda solo.</small>`
        : suyo ? `
        <div class="elegir-pantallas">
          ${PANTALLAS.map(([k, t, ayuda]) => `
            <label title="${esc(ayuda)}">
              <input type="checkbox" data-permiso="${esc(a.uid)}:${k}"
                     ${p[k] === false ? '' : 'checked'}>
              <span>${t}</span>
            </label>`).join('')}
        </div>` : `<small style="color:var(--suave)">
          A este nivel lo limita el rol, no las pantallas.</small>`}
      </div>`;
    }).join('')
      : '<div class="vacio">Todavía no hay nadie dado de alta.</div>'}

    <div class="grupo-personal">Dar de alta</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn" id="btnAltaSadmin" style="flex:1">+ Superadmin</button>
      <button class="btn" id="btnAltaAdmin2" style="flex:1">+ Administrador</button>
    </div>`;

  cont.querySelectorAll('[data-permiso]').forEach((c) => c.onchange = () => {
    const [uid, que] = c.dataset.permiso.split(':');
    guardarPermiso(uid, que, c.checked, c);
  });
  cont.querySelectorAll('[data-alternar]').forEach((b) => b.onclick = () =>
    alternarAcceso(b.dataset.alternar));
  $('#btnAltaSadmin').onclick = () => altaPersona('sadmin');
  $('#btnAltaAdmin2').onclick = () => altaPersona('admin');
}

async function guardarPermiso(uid, que, valor, caja) {
  const a = estado.accesos.find((x) => x.uid === uid);
  if (!a) return;
  caja.disabled = true;
  try {
    // Se manda el documento entero porque las reglas lo validan entero: si
    // llegara solo el permiso, no habría con qué comprobar el rol.
    await updateDoc(doc(db, 'accesosBarra', uid), {
      usuario: a.usuario, rol: a.rol, activo: a.activo !== false,
      permisos: { ...(a.permisos || {}), [que]: valor },
    });
  } catch (e) {
    caja.checked = !valor;
    alert('No se pudo: ' + (e.code || e.message));
  } finally { caja.disabled = false; }
}

// ---------- Sótano Club ----------
// No hay una base de clientes aparte: anotarse a una noche YA es el alta. La
// gente de Sótano Club son los invitados de todas las noches, juntados por teléfono
// —que es el único dato que no se repite— y no por nombre, que cada uno
// escribe distinto cada vez.
//
// Que no exista una colección nueva no es pereza: cada lugar donde se guarda
// un teléfono es un lugar más que proteger, y este ya está protegido.
function genteDelClub() {
  const porTel = new Map();
  for (const i of (estado.invitadosTodos || [])) {
    const tel = digitosTel(i.telefono || '');
    if (!tel) continue;
    const cuando = i.creadoEn?.toMillis?.() || 0;
    const ya = porTel.get(tel);
    if (!ya) {
      porTel.set(tel, {
        tel, nombre: i.nombre || '', noches: new Set([i.eventoId]),
        primera: cuando, ultima: cuando, entro: i.ingresadoEn ? 1 : 0,
      });
      continue;
    }
    ya.noches.add(i.eventoId);
    if (i.ingresadoEn) ya.entro += 1;
    if (cuando && cuando < ya.primera) ya.primera = cuando;
    // El nombre que vale es el último que dejó: si lo escribió mejor, mejor.
    if (cuando >= ya.ultima) { ya.ultima = cuando; ya.nombre = i.nombre || ya.nombre; }
  }
  return [...porTel.values()]
    .map((p) => ({ ...p, noches: p.noches.size }))
    .sort((a, b) => b.ultima - a.ultima);
}

function bloqueClub() {
  const todos = genteDelClub();
  if (!todos.length) {
    return `<div class="grupo-personal">Sótano Club</div>
      <p style="color:var(--suave);font-size:.9rem;margin:0">
        Todavía no se anotó nadie. Cada persona que se anota a una noche entra
        acá sola.</p>`;
  }
  const q = estado.buscaClub.trim().toLowerCase();
  const qTel = digitosTel(estado.buscaClub);
  const filtrados = q
    ? todos.filter((p) => p.nombre.toLowerCase().includes(q)
        || (qTel && p.tel.includes(qTel)))
    : todos;
  // Plegado por defecto: con doscientas personas, la pantalla no termina más.
  const muestra = estado.verClub || q ? filtrados : filtrados.slice(0, 5);
  const repiten = todos.filter((p) => p.noches > 1).length;

  return `
    <div class="grupo-personal">Sótano Club · ${todos.length}</div>
    <p style="color:var(--suave);font-size:.86rem;margin:0 0 .6rem">
      Todos los que se anotaron alguna vez, juntados por teléfono.${
      repiten ? ` <b>${repiten}</b> volvieron más de una noche.` : ''}
    </p>
    <label class="campo">
      <span>Buscar por nombre o teléfono</span>
      <input id="buscaClub" value="${esc(estado.buscaClub)}" autocomplete="off">
    </label>
    ${muestra.map((p) => `
      <div class="item">
        <div class="cuerpo">
          <div class="nombre">${esc(p.nombre || 'Sin nombre')}</div>
          <div class="desc">${esc(p.tel)} · ${p.noches} noche${p.noches === 1 ? '' : 's'}${
            p.entro ? ` · entró ${p.entro}` : ' · todavía no entró'}${
            p.ultima ? ` · última vez ${new Date(p.ultima).toLocaleDateString('es-AR')}` : ''}</div>
        </div>
      </div>`).join('')}
    ${!q && filtrados.length > muestra.length
      ? `<button class="btn ancho-full" id="verClub" style="margin-top:.5rem">Ver los ${
          filtrados.length - muestra.length} que faltan</button>`
      : ''}
    ${q && !filtrados.length
      ? `<p style="color:var(--suave);font-size:.9rem;margin:.4rem 0 0">Nadie con ese nombre ni ese teléfono.</p>`
      : ''}`;
}

function engancharClub(cont) {
  const b = cont.querySelector('#buscaClub');
  if (b) {
    b.oninput = () => {
      estado.buscaClub = b.value;
      pintarCalendario();
      // Repintar mata el campo: se vuelve a poner el foco donde estaba.
      const otra = $('#buscaClub');
      if (otra) { otra.focus(); otra.setSelectionRange(otra.value.length, otra.value.length); }
    };
  }
  const v = cont.querySelector('#verClub');
  if (v) v.onclick = () => { estado.verClub = true; pintarCalendario(); };
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
        Number(e.entrada || 0) ? ` · entrada ${plata(e.entrada)}` : ''}${
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
      try { await navigator.share({ title: 'Tu pase — Sótano', url }); return; }
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
  const esperaPago = i.pago === 'virtual' && !i.pagadoEn;
  // Cuántos días lleva anotado sin pagar: a los dos o tres, conviene
  // escribirle o liberarle el lugar con la ✕.
  const desde = i.creadoEn?.toMillis?.() || 0;
  const dias = esperaPago && desde
    ? Math.floor((Date.now() - desde) / 86400000) : 0;
  return `<div class="item invitado ${i.ingresadoEn ? 'adentro' : ''}">
    <div class="cuerpo">
      <div class="nombre">${esc(i.nombre)}</div>
      <div class="desc">${esc(i.telefono)}${i.ingresadoEn ? ' · entró ' + hora(i.ingresadoEn) : ''}${
        gastó ? ' · consumió ' + plata(gastó) : ''}${
        // Quien dijo que transfiere no tiene QR hasta que alguien confirme que
        // la plata llegó. Hasta entonces ocupa un lugar sin haber pagado.
        esperaPago ? ` · <b style="color:var(--naranja)">esperando pago${
          dias ? ' · hace ' + dias + (dias === 1 ? ' día' : ' días') : ''}</b>` : ''}${
        i.pago === 'virtual' && i.pagadoEn ? ' · <b style="color:var(--verde)">pagó</b>' : ''}</div>
    </div>
    ${i.pago === 'virtual' ? `<button class="btn ${esperaPago ? 'primario' : ''}" data-cobrado="${esc(i.id)}"
            title="${esperaPago ? 'Confirmar que llegó la transferencia' : 'Deshacer: no había llegado'}"
            style="padding:.4rem .7rem;font-size:.82rem">
      ${esperaPago ? 'Cobrado' : 'Sin cobrar'}</button>` : ''}
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

// Confirmar que la transferencia llegó. Lo hace una persona mirando el banco:
// una transferencia a un alias no le avisa a la app, no hay nada que escuchar.
//
// Apenas se escribe, el pase del invitado lo ve —está escuchando su documento—
// y su QR aparece solo, sin que tenga que recargar ni volver a buscar el link.
async function marcarCobrado(id, boton) {
  const i = (estado.invitadosTodos || []).find((x) => x.id === id);
  if (!i) return;
  const yaPago = !!i.pagadoEn;
  if (yaPago && !confirm(`¿Marcar a "${i.nombre}" como NO pagado?\n\n`
    + 'Su QR de acceso desaparece hasta que lo vuelvas a confirmar.')) return;
  if (boton) boton.disabled = true;
  try {
    await updateDoc(doc(db, 'invitados', id), yaPago
      ? { pagadoEn: null, pagadoPor: null }
      : { pagadoEn: serverTimestamp(), pagadoPor: quienAtiende() || estado.usuario || 'la casa' });
  } catch (e) {
    alert('No se pudo: ' + (e.code || e.message));
  } finally {
    if (boton) boton.disabled = false;
  }
}

function engancharPliegues(cont) {
  cont.querySelectorAll('[data-cobrado]').forEach((b) => b.onclick = () =>
    marcarCobrado(b.dataset.cobrado, b));
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
  // Lo que hay que cobrarle a cada uno, a la vista de quien está en la puerta.
  const entrada = Number(estado.registros[eventoDePuerta()]?.entrada || 0);
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
    ${entrada ? `<div class="aviso" style="margin-top:.8rem"><span>🎟</span><div>
      <b>Entrada ${plata(entrada)}</b> por persona. Se cobra acá.</div></div>` : ''}
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
  cont.querySelectorAll('[data-cobrado]').forEach((b) => b.onclick = () =>
    marcarCobrado(b.dataset.cobrado, b));
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
    // OJO: poder leer el padrón ya no significa ser el dueño. Lo leen el dueño,
    // los administradores y el celular de la barra, que lo necesita para saber
    // quién puede estar atendiendo. El dueño es el que entra con un mail de
    // verdad: todas las cuentas de la casa son usuario@barra.local.
    estado.dueno = esElDueno();
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
// Qué puede ver esta persona. Mismo criterio que las reglas: sin permisos
// cargados manda el rol, y al sadmin no lo recorta nadie.
//
// Esto SOLO esconde pestañas. Lo que frena de verdad son las reglas: si esto
// fuera lo único, alcanzaría con abrir la consola para saltearlo.
const puedoVer = (que) => estado.sadmin || estado.permisos[que] !== false;

function aplicarRol() {
  const b = document.body.classList;
  // sadmin es un nivel arriba de admin: lo único que lo distingue, por ahora,
  // es que elige qué ve cada uno. El dueño entra acá sin documento.
  estado.sadmin = estado.dueno || estado.rol === 'sadmin';
  const gerente = estado.sadmin || estado.rol === 'admin';
  b.toggle('es-dueno', estado.dueno);
  b.toggle('es-sadmin', estado.sadmin);
  b.toggle('es-gerente', gerente);
  b.toggle('es-barra', !estado.dueno && estado.rol === 'barman');
  // El celular de la barra: no es una persona, es el aparato del local.
  estado.esAparato = !estado.dueno && estado.rol === 'barra';
  b.toggle('es-aparato', estado.esAparato);
  pintarQuienAtiende();
  if (gerente && puedoVer('deposito')) escucharPlataDeposito();

  // Primero el rol, después el interruptor: lo que el rol no da, ningún
  // interruptor lo enciende.
  $('#tabCaja').hidden = !(gerente && puedoVer('caja'));
  // El depósito también lo ve el celular de la barra: necesita saber qué hay
  // para no prometer un trago que no se puede hacer. Lo ve de mirar nada más
  // —adentro no hay ningún botón suyo—, y las reglas lo frenan igual.
  $('#tabDeposito').hidden = !((gerente || estado.esAparato) && puedoVer('deposito'));
  $('#tabCalendario').hidden = !(gerente && puedoVer('calendario'));
  // Usuarios es de quien reparte, y de nadie más.
  $('#tabUsuarios').hidden = !estado.sadmin;
  // El celular de la barra atiende la barra: pedidos, carta y la noche. La
  // puerta es de la gente de la puerta, con su propia cuenta.
  $('#tabPuerta').hidden = estado.esAparato || !puedoVer('puerta');
  $('#tabTablero').hidden = !puedoVer('pedidos');
  $('#tabCartaBar').hidden = !puedoVer('carta');
  $('#tabEvento').hidden = !puedoVer('noche');

  // Si quedó parado en una pantalla que ya no puede ver, se lo lleva a la
  // primera que sí: que no quede mirando algo vacío sin entender por qué.
  const abierta = [...document.querySelectorAll('.tabs [role=tab]')]
    .find((t) => t.getAttribute('aria-selected') === 'true');
  if (abierta && abierta.hidden) {
    const otra = [...document.querySelectorAll('.tabs [role=tab]')].find((t) => !t.hidden);
    if (otra) otra.click();
  }

  if (estado.esAparato && !$('#vistaPuerta').hidden) irA('tablero');
  // La puerta no trabaja pedidos ni carta: se le deja su pantalla y nada más.
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
    if (d.exists()) {
      estado.rol = d.data().rol || 'barman';
      estado.permisos = d.data().permisos || {};
      aplicarRol();
    }
    if (d.exists() && d.data().activo === true) { loTuvo = true; return; }
    if (!d.exists() && !loTuvo) return;
    if (yendose) return;
    yendose = true;
    signOut(auth).finally(() =>
      alert('Se cerró tu turno. Pedile al dueño que te vuelva a habilitar.'));
  }, () => {});
}

const QUE_ES = {
  sadmin: { nombre: 'superadministrador',
            puede: 'Todo lo de un administrador y además elige qué ve cada uno. Es el único que reparte permisos.' },
  admin: { nombre: 'administrador',
           puede: 'Hace todo lo que hacés vos menos borrar la base. Cuenta permanente, no depende del evento.' },
  barman: { nombre: 'barman',
            puede: 'Mueve pedidos, cobra y marca agotado. Para su celular propio: solo entra la noche en que lo asignás.' },
  puerta: { nombre: 'gente de puerta',
            puede: 'Solo la pantalla de puerta: escanea pases y marca quién entró. No ve caja ni pedidos.' },
  barra: { nombre: 'celular de la barra',
           puede: 'La cuenta del aparato que queda en el local. Entra siempre, sin depender del turno, y adentro se elige quién está atendiendo.' },
};

// El usuario se acomoda solo mientras se escribe: lo que la gente tipea en un
// celular trae mayúsculas, acentos y espacios, y antes eso era un cartel de
// error después de haber cargado todo.
function limpiarUsuario(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // acentos fuera
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9._-]+/g, '-')                     // espacios y símbolos → guión
    .replace(/^-+/, '')
    .slice(0, 30);
}

const usuarioValido = (u) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);

let altaRol = null;
function altaPersona(rol) {
  altaRol = rol;
  const q = QUE_ES[rol] || QUE_ES.barman;
  $('#tituloPersona').textContent = `Registrar ${q.nombre}`;
  $('#quePuedePersona').textContent = q.puede;
  $('#inpPersonaUsuario').value = rol === 'barra' ? 'barra' : '';
  $('#inpPersonaClave').value = '';
  $('#errorPersona').classList.add('oculto');
  $('#btnConfirmarPersona').disabled = false;
  $('#btnConfirmarPersona').textContent = 'Crear';
  $('#dlgPersona').showModal();
  pistaPersona();
  if (rol !== 'barra') $('#inpPersonaUsuario').focus();
  else $('#inpPersonaClave').focus();
}

function pistaPersona() {
  const u = $('#inpPersonaUsuario').value;
  const p = $('#pistaPersona');
  if (!u) {
    p.className = 'pista';
    p.textContent = 'Entre 3 y 30: letras, números, punto, guión o guión bajo.';
    return;
  }
  const ok = usuarioValido(u);
  p.className = 'pista ' + (ok ? 'bien' : 'mal');
  p.textContent = ok
    ? `✓ Va a entrar escribiendo "${u}"`
    : (u.length < 3 ? 'Le faltan letras: mínimo 3.' : 'Tiene que empezar con una letra o un número.');
}

function fallaPersona(texto) {
  $('#errorPersonaTexto').textContent = texto;
  $('#errorPersona').classList.remove('oculto');
}

async function crearPersona() {
  const usuario = limpiarUsuario($('#inpPersonaUsuario').value);
  $('#inpPersonaUsuario').value = usuario;
  const clave = $('#inpPersonaClave').value;
  const q = QUE_ES[altaRol] || QUE_ES.barman;
  if (!usuarioValido(usuario)) {
    fallaPersona('El usuario tiene que tener entre 3 y 30 caracteres y empezar con letra o número.');
    $('#inpPersonaUsuario').focus();
    return;
  }
  if (clave.length < 6) {
    fallaPersona('La contraseña necesita al menos 6 caracteres.');
    $('#inpPersonaClave').focus();
    return;
  }
  const btn = $('#btnConfirmarPersona');
  btn.disabled = true; btn.textContent = 'Creando…';
  $('#errorPersona').classList.add('oculto');

  // Una app aparte para el alta: createUser deja logueada a la cuenta nueva,
  // y si usáramos la principal te quedarías afuera de tu propio panel.
  const secundaria = initializeApp(CFG, 'alta-' + Date.now());
  const authSec = getAuth(secundaria);
  if (EMULADOR) connectAuthEmulator(authSec, 'http://127.0.0.1:9099', { disableWarnings: true });
  try {
    const cred = await createUserWithEmailAndPassword(authSec, aMail(usuario), clave);
    await setDoc(doc(db, 'accesosBarra', cred.user.uid), {
      usuario, rol: altaRol, activo: true, creadoEn: serverTimestamp(),
    });
    $('#dlgPersona').close();
    alert(`Listo.\n\nUsuario: ${usuario}\nNivel: ${q.nombre}\n\n`
      + (altaRol === 'admin' || altaRol === 'barra' ? ''
        : 'Para que entre, asignalo al evento desde "De turno".\n\n')
      + `Que entre en:\n${location.origin}/bar.html`);
  } catch (e) {
    fallaPersona(e.code === 'auth/email-already-in-use'
      ? `Ya existe un usuario "${usuario}". Elegí otro nombre.`
      : (e.code === 'auth/weak-password'
        ? 'Esa contraseña es muy débil para Firebase. Probá con una más larga.'
        : 'No se pudo crear: ' + (e.code || e.message)));
    btn.disabled = false; btn.textContent = 'Crear';
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
  pintarUsuarios();
  const cont = $('#accesos');
  if (!cont) return;
  const admins = estado.accesos.filter((a) => a.rol === 'admin');
  const barmanes = estado.accesos.filter((a) => (a.rol || 'barman') === 'barman');
  const puertas = estado.accesos.filter((a) => a.rol === 'puerta');
  const aparatos = estado.accesos.filter((a) => a.rol === 'barra');

  const fila = (a) => `
    <div class="item ${a.activo ? '' : 'agotado'}">
      <div class="cuerpo">
        <div class="nombre">${esc(a.usuario)}${a.activo ? '' : ' — <small>dado de baja</small>'}</div>
        <div class="desc">${a.rol === 'admin'
          ? 'administra todo menos borrar'
          : a.rol === 'barra'
            ? 'el aparato del local: entra siempre'
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

    <div class="grupo-personal">Celular de la barra</div>
    ${aparatos.length ? aparatos.map(fila).join('')
      : `<p style="color:var(--suave);font-size:.88rem;margin:0">
         Todavía no hay. Es la cuenta del celular que queda en la barra: entra
         siempre, sin depender del turno.</p>`}
    <button class="btn ancho-full" id="btnAltaAparato" style="margin-top:.6rem">Registrar celular de barra</button>

    <div class="grupo-personal">Puerta</div>
    ${puertas.length ? puertas.map(fila).join('')
      : '<p style="color:var(--suave);font-size:.88rem;margin:0">Todavía no registraste ninguno.</p>'}
    <button class="btn ancho-full" id="btnAltaPuerta" style="margin-top:.6rem">Registrar gente de puerta</button>`;

  $('#btnAltaAdmin').onclick = () => altaPersona('admin');
  $('#btnAltaBarman').onclick = () => altaPersona('barman');
  $('#btnAltaAparato').onclick = () => altaPersona('barra');
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
    if (r !== '1' && r !== '2') return;
    // Sacarlo de entregado devuelve lo que se había descontado.
    if (p.estado === 'entregado') moverStock(p, +1);
    cambiarEstado(p.id, r === '1' ? 'cancelado' : 'listo');
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

// ---------- quién atiende y a qué caja entra ----------
//
// El celular de la barra vive logueado con la cuenta del aparato. Quién está
// atendiendo se elige adentro: es una etiqueta para saber quién vendió, no una
// contraseña. Alcanza para el ranking y para preguntar; no para acusar a nadie.
function quienAtiende() {
  if (!estado.esAparato) return estado.usuario || 'casa';
  return localStorage.getItem('sotano:atiende') || '';
}

function pintarQuienAtiende() {
  const btn = $('#btnQuienAtiende');
  if (!btn) return;
  btn.hidden = !estado.esAparato;
  $('#quienAtiende').textContent = quienAtiende() || 'Elegir';
  btn.classList.toggle('alerta', estado.esAparato && !quienAtiende());
}

// Los que pueden estar atendiendo: los asignados a la noche, y si no hay
// noche abierta, todos los barmanes activos. El bar vende igual.
function barmanesPosibles() {
  // Personas, no aparatos: el que atiende es alguien, no el celular mismo.
  const activos = estado.accesos.filter((a) =>
    a.activo && a.rol !== 'puerta' && a.rol !== 'barra');
  const delTurno = estado.evento?.barmanes || [];
  const deLaNoche = activos.filter((a) => delTurno.includes(a.uid));
  return (deLaNoche.length ? deLaNoche : activos).map((a) => a.usuario);
}

function elegirQuienAtiende() {
  const gente = barmanesPosibles();
  const actual = quienAtiende();
  const delTurno = (estado.evento?.barmanes || []).length > 0;
  $('#listaAtiende').innerHTML = gente.length
    ? gente.map((g) => `
        <button class="btn ${g === actual ? 'primario' : ''} ancho-full"
                data-atiende="${esc(g)}" style="margin-bottom:.5rem;padding:.9rem">
          ${esc(g)}${g === actual ? ' ✓' : ''}</button>`).join('')
      + (delTurno ? `<p style="color:var(--suave);font-size:.78rem;margin:.6rem 0 0">
          Son los asignados a esta noche.</p>` : '')
    : `<div class="aviso"><span>👤</span><div>
        <b>Todavía no hay barmanes registrados.</b><br>
        Se registran desde el panel de un administrador, en
        <b>Noche → Personal</b>.</div></div>`;
  $('#listaAtiende').querySelectorAll('[data-atiende]').forEach((b) => b.onclick = () => {
    localStorage.setItem('sotano:atiende', b.dataset.atiende);
    pintarQuienAtiende();
    $('#dlgAtiende').close();
  });
  $('#dlgAtiende').showModal();
}

// La caja a la que entra lo que se vende: la del evento abierto, o la del día.
// La noche de bar cruza la medianoche, así que el día corta a las 6 de la
// mañana: lo que se vende a las 3 AM es de la noche anterior.
function cajaDeHoy() {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  return `dia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const cajaActual = () => estado.evento?.id || cajaDeHoy();

// ---------- la caja de Sótano ----------
//
// Acá va toda la plata: la de los eventos y la de los días comunes, lo que
// entra y lo que sale. El número que importa no es lo facturado: es lo que
// debería haber en el cajón.
function desdeDelRango() {
  const ahora = new Date();
  if (estado.rangoCaja === 'hoy') {
    // El día del bar corta a las 6: lo de las 3 AM es de la noche anterior.
    const d = new Date(ahora.getTime() - 6 * 3600 * 1000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 0, 0);
  }
  if (estado.rangoCaja === 'mes') return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  return new Date(ahora.getFullYear() - 2, 0, 1);
}

let mirandoCaja = null;
function escucharCaja() {
  const desde = desdeDelRango();
  const clave = `${estado.rangoCaja}:${desde.getTime()}`;
  if (mirandoCaja === clave) return;
  mirandoCaja = clave;
  if (estado.cortarCaja) estado.cortarCaja();

  const q = query(collection(db, 'pedidos'),
    where('estado', '==', 'entregado'),
    where('creadoEn', '>=', Timestamp.fromDate(desde)),
    orderBy('creadoEn', 'desc'));
  const cortarPedidos = onSnapshot(q, (snap) => {
    estado.pedidosCaja = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarCajaGeneral();
  }, fallo('#caja'));

  const cortarEgresos = onSnapshot(
    query(collection(db, 'egresos'), where('fecha', '>=', Timestamp.fromDate(desde))),
    (snap) => {
      estado.egresos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
      pintarCajaGeneral();
    }, () => {});

  estado.cortarCaja = () => { cortarPedidos(); cortarEgresos(); };
}

function resumirPlata() {
  const ventas = estado.pedidosCaja || [];
  const suma = (lista, como) => lista
    .filter((x) => !como || x.pago === como)
    .reduce((a, x) => a + Number(x.total ?? x.monto ?? 0), 0);

  const entra = suma(ventas);
  const entraEfectivo = suma(ventas, 'efectivo');
  const entraVirtual = suma(ventas, 'virtual');
  // Lo viejo no tiene forma de pago: se dice aparte en vez de inventarla.
  const sinForma = entra - entraEfectivo - entraVirtual;

  const sale = suma(estado.egresos);
  const saleEfectivo = suma(estado.egresos, 'efectivo');

  return {
    entra, entraEfectivo, entraVirtual, sinForma,
    sale, saleEfectivo,
    saldo: entra - sale,
    enCajon: entraEfectivo - saleEfectivo,
    ventas: ventas.length,
  };
}

// Quién vendió cuánto. Solo sirve si la barra eligió quién atiende, así que
// cuando falta se dice en vez de mostrar un ranking mentiroso.
function porBarman(ventas) {
  const m = new Map();
  for (const v of ventas) {
    const quien = v.vendidoPor || '—';
    const a = m.get(quien) || { cantidad: 0, importe: 0 };
    a.cantidad += 1;
    a.importe += Number(v.total || 0);
    m.set(quien, a);
  }
  return [...m].sort((a, b) => b[1].importe - a[1].importe);
}

function pintarCajaGeneral() {
  const cont = $('#caja');
  if (!cont || $('#vistaCaja').hidden) return;
  escucharCaja();
  const r = resumirPlata();
  const rangos = { hoy: 'Hoy', mes: 'Este mes', todo: 'Todo' };
  const gente = porBarman(estado.pedidosCaja || []);

  cont.innerHTML = `
    <div class="tabs chicas">
      ${Object.entries(rangos).map(([k, t]) => `
        <button data-rango="${k}" aria-selected="${estado.rangoCaja === k}">${t}</button>`).join('')}
    </div>

    <div class="caja-evento">
      <div class="titulo">${rangos[estado.rangoCaja]}</div>
      <div class="desde">${r.ventas} venta${r.ventas === 1 ? '' : 's'} cobrada${r.ventas === 1 ? '' : 's'}</div>
      <div class="numeros">
        <div class="plata"><b>${plata(r.entra)}</b><span>entró</span></div>
        <div><b>${plata(r.sale)}</b><span>salió</span></div>
        <div class="plata"><b>${plata(r.saldo)}</b><span>queda</span></div>
      </div>
      <table class="ranking" style="margin-top:.8rem"><tbody>
        <tr><td>💵 Efectivo</td><td class="n">${plata(r.entraEfectivo)}</td></tr>
        <tr><td>📲 Virtual</td><td class="n">${plata(r.entraVirtual)}</td></tr>
        ${r.sinForma ? `<tr><td>Sin forma de pago <small>(antes de que se pidiera)</small></td>
          <td class="n">${plata(r.sinForma)}</td></tr>` : ''}
      </tbody></table>
      <div class="interruptor" style="margin-top:.9rem">
        <div>
          <b>En el cajón debería haber ${plata(r.enCajon)}</b>
          <span>Efectivo cobrado menos los gastos pagados en efectivo.</span>
        </div>
      </div>
    </div>

    <div class="grupo-personal">Alias para transferencias</div>
    <p style="color:var(--suave);font-size:.84rem;margin:0 0 .5rem">
      El que ve el invitado en su pase cuando elige pagar la entrada por
      transferencia. Si está vacío, solo se le ofrece pagar en la puerta.
    </p>
    <label class="campo">
      <span>Alias o CBU</span>
      <input id="inpAlias" maxlength="60" autocomplete="off"
             placeholder="ej. sotano.bar.mp" value="${esc(estado.pagos.alias || '')}">
    </label>
    <label class="campo">
      <span>A nombre de <small>(opcional, para que sepa que no se equivocó)</small></span>
      <input id="inpAliasTitular" maxlength="60" autocomplete="off"
             value="${esc(estado.pagos.titular || '')}">
    </label>
    <button class="btn ancho-full" id="btnGuardarAlias" style="margin-bottom:.4rem">Guardar alias</button>

    <div class="grupo-personal" style="display:flex;align-items:center;gap:.6rem">
      <span style="flex:1">Gastos</span>
      <button class="btn" id="btnNuevoEgreso" style="padding:.25rem .6rem;font-size:.72rem;text-transform:none;letter-spacing:0">
        + Cargar gasto</button>
    </div>
    ${estado.egresos.length ? estado.egresos.map((e) => `
      <div class="item">
        <div class="cuerpo">
          <div class="nombre">${esc(e.concepto)}</div>
          <div class="desc">${e.fecha?.toDate?.()?.toLocaleDateString('es-AR') || ''}
            · ${esc(e.categoria)} · ${e.pago === 'efectivo' ? '💵' : '📲'}
            ${e.cargadoPor ? ' · ' + esc(e.cargadoPor) : ''}</div>
        </div>
        <div class="total">−${plata(e.monto)}</div>
        <button class="btn peligro" data-borrar-egreso="${esc(e.id)}"
                style="padding:.3rem .6rem;font-size:.78rem">✕</button>
      </div>`).join('')
      : '<p style="color:var(--suave);font-size:.9rem">Sin gastos cargados en este período.</p>'}

    ${gente.length ? `
      <div class="grupo-personal">Quién vendió</div>
      <table class="ranking"><tbody>${gente.map(([quien, g]) => `
        <tr><td>${quien === '—' ? '<i>sin registrar</i>' : esc(quien)}</td>
            <td class="n">${g.cantidad}</td><td class="n">${plata(g.importe)}</td></tr>`).join('')}
      </tbody></table>` : ''}`;

  cont.querySelectorAll('[data-rango]').forEach((b) => b.onclick = () => {
    estado.rangoCaja = b.dataset.rango;
    pintarCajaGeneral();
  });
  $('#btnNuevoEgreso').onclick = abrirEgreso;
  $('#btnGuardarAlias').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await setDoc(doc(db, 'publico', 'pagos'), {
        alias: $('#inpAlias').value.trim(),
        titular: $('#inpAliasTitular').value.trim(),
      });
      b.textContent = 'Guardado ✓';
    } catch (err) {
      b.disabled = false; b.textContent = 'Guardar alias';
      alert('No se pudo: ' + (err.code || err.message));
    }
  };
  cont.querySelectorAll('[data-borrar-egreso]').forEach((b) => b.onclick = async () => {
    const e = estado.egresos.find((x) => x.id === b.dataset.borrarEgreso);
    if (!e || !confirm(`¿Borrar el gasto "${e.concepto}" de ${plata(e.monto)}?`)) return;
    try { await deleteDoc(doc(db, 'egresos', e.id)); }
    catch (err) { alert('No se pudo: ' + (err.code || err.message)); }
  });
}

// ---------- venta de mostrador ----------
// El que compra en la barra no usa la app del cliente: la carga quien atiende,
// con la forma de pago, y nace entregada. Es la venta de todos los días.
function abrirVenta() {
  estado.venta = {};
  $('#dlgVenta').showModal();
  pintarVenta();
}

function totalVenta() {
  return Object.entries(estado.venta).reduce((s, [id, cant]) => {
    const c = estado.carta.find((x) => x.id === id);
    return s + Number(c?.precio || 0) * cant;
  }, 0);
}

function pintarVenta() {
  const vendibles = estado.carta.filter((i) => i.enCarta !== false);
  const total = totalVenta();
  const quien = quienAtiende();
  $('#cuerpoVenta').innerHTML = `
    ${estado.esAparato && !quien ? `<div class="aviso mal"><span>⚠</span><div>
      <b>Elegí quién está atendiendo</b> arriba, antes de cobrar.</div></div>` : ''}
    <div class="lista-venta">
      ${vendibles.map((i) => `
        <div class="item ${i.disponible === false ? 'agotado' : ''}">
          <div class="cuerpo">
            <div class="nombre">${esc(i.nombre || i.id)}</div>
            <div class="desc">${plata(i.precio)}${i.disponible === false ? ' · agotado' : ''}</div>
          </div>
          <div class="cant">
            <button data-venta="${i.id}" data-d="-1" aria-label="Quitar">−</button>
            <span class="n">${estado.venta[i.id] || 0}</span>
            <button data-venta="${i.id}" data-d="1" aria-label="Agregar"
                    ${i.disponible === false ? 'disabled' : ''}>+</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="total-venta">
      <span>Total</span><b>${plata(total)}</b>
    </div>
    <div style="display:flex;gap:.6rem;margin-top:.6rem">
      <button class="btn primario" id="btnVentaEfectivo" style="flex:1;padding:.9rem"
              ${!total ? 'disabled' : ''}>💵 Efectivo</button>
      <button class="btn primario" id="btnVentaVirtual" style="flex:1;padding:.9rem"
              ${!total ? 'disabled' : ''}>📲 Virtual</button>
    </div>`;

  $('#cuerpoVenta').querySelectorAll('[data-venta]').forEach((b) => b.onclick = () => {
    const id = b.dataset.venta;
    const cuanto = (estado.venta[id] || 0) + Number(b.dataset.d);
    if (cuanto <= 0) delete estado.venta[id]; else estado.venta[id] = cuanto;
    pintarVenta();
  });
  if ($('#btnVentaEfectivo')) $('#btnVentaEfectivo').onclick = () => cobrarVenta('efectivo');
  if ($('#btnVentaVirtual')) $('#btnVentaVirtual').onclick = () => cobrarVenta('virtual');
}

async function cobrarVenta(pago) {
  const items = Object.entries(estado.venta).map(([id, cantidad]) => {
    const c = estado.carta.find((x) => x.id === id) || {};
    return { id, nombre: c.nombre || id, precio: Number(c.precio || 0), cantidad };
  });
  if (!items.length) return;
  const quien = quienAtiende();
  if (estado.esAparato && !quien) { elegirQuienAtiende(); return; }

  const btn = $(pago === 'efectivo' ? '#btnVentaEfectivo' : '#btnVentaVirtual');
  if (btn) { btn.disabled = true; btn.textContent = 'Cobrando…'; }
  try {
    await addDoc(collection(db, 'pedidos'), {
      clienteId: auth.currentUser.uid,
      estado: 'entregado', origen: 'barra',
      items, total: totalVenta(), pago,
      vendidoPor: quien || estado.usuario || 'casa',
      cajaId: cajaActual(),
      nombreCliente: 'Mostrador',
      creadoEn: serverTimestamp(),
    });
    await moverStock({ items }, -1);
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    estado.venta = {};
    $('#dlgVenta').close();
  } catch (e) {
    pintarVenta();
    alert('No se pudo cobrar: ' + (e.code || e.message));
  }
}

// ---------- la plata que sale ----------
function abrirEgreso() {
  $('#inpEgrConcepto').value = '';
  $('#inpEgrMonto').value = '';
  $('#inpEgrCategoria').value = 'insumo';
  // Elegir proveedor es lo que convierte un gasto en un pago a cuenta.
  $('#inpEgrProveedor').innerHTML = '<option value="">— ninguno —</option>'
    + estado.proveedores.map((p) => {
        const s = saldoProveedor(p.id);
        return `<option value="${esc(p.id)}">${esc(p.nombre)}${s ? ` — debe ${plata(s)}` : ''}</option>`;
      }).join('');
  $('#dlgEgreso').showModal();
  $('#inpEgrConcepto').focus();
}

async function guardarEgreso() {
  const concepto = $('#inpEgrConcepto').value.trim();
  const monto = Math.round(Number($('#inpEgrMonto').value) || 0);
  if (concepto.length < 2) { $('#inpEgrConcepto').focus(); return; }
  if (monto <= 0) { $('#inpEgrMonto').focus(); return; }
  const btn = $('#btnGuardarEgreso');
  btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    const proveedorId = $('#inpEgrProveedor').value;
    await addDoc(collection(db, 'egresos'), {
      concepto, monto,
      ...(proveedorId ? { proveedorId } : {}),
      categoria: $('#inpEgrCategoria').value,
      pago: document.querySelector('input[name="egrPago"]:checked').value,
      fecha: Timestamp.fromDate(new Date()),
      cajaId: cajaActual(),
      cargadoPor: estado.usuario || 'casa',
      creadoEn: serverTimestamp(),
    });
    $('#dlgEgreso').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  btn.disabled = false; btn.textContent = 'Cargar';
}

// ---------- el depósito ----------
//
// Lo que se compra y lo que se guarda, que no es lo mismo que lo que se vende.
// Una botella de fernet es un insumo; "Fernet con coca" es un producto de la
// carta que se lleva una medida de esa botella. El stock se lleva en MEDIDAS:
// así una botella que da 10 baja de a una y recién se gasta a la décima.
const unidadesDe = (ins) => Math.floor(Number(ins.stock || 0) / Math.max(1, Number(ins.medidas || 1)));
const sueltasDe = (ins) => Number(ins.stock || 0) % Math.max(1, Number(ins.medidas || 1));

function comoSeDice(ins) {
  const m = Math.max(1, Number(ins.medidas || 1));
  const u = unidadesDe(ins), sueltas = sueltasDe(ins);
  const unidad = ins.unidad || 'unidad';
  if (m === 1) return `${u} ${unidad}${u === 1 ? '' : 's'}`;
  return `${u} ${unidad}${u === 1 ? '' : 's'}`
    + (sueltas ? ` y ${sueltas} medida${sueltas === 1 ? '' : 's'}` : '');
}

// ---------- la carta atada al depósito ----------
// Un producto con receta no lleva stock propio: lo que hay es lo que el
// depósito alcanza a dar. Se calcula con el insumo más corto de la receta,
// porque un fernet con coca sin coca no es un fernet con coca.
//
// Infinity = no tiene receta, lleva su propio número (o ∞) como siempre.
function rindeDeposito(item) {
  const receta = (item.receta || []).filter((r) => Number(r.medidas) > 0);
  if (!receta.length) return Infinity;
  let menor = Infinity;
  for (const r of receta) {
    const ins = estado.insumos.find((i) => i.id === r.insumoId);
    // Un insumo borrado del depósito deja al producto sin de dónde salir.
    if (!ins) return 0;
    menor = Math.min(menor, Math.floor(Number(ins.stock || 0) / Number(r.medidas)));
  }
  return Math.max(0, menor);
}

// El cliente no puede leer el depósito —ni debe: ahí están los costos y lo que
// hay guardado—, así que el número viajado al que sí lee: el stock del
// producto. Lo escribe el panel cada vez que el depósito se mueve.
//
// Converge sola aunque haya varios celulares abiertos: el valor es una cuenta
// del depósito, no un incremento, así que el segundo que llega ve que ya está
// bien y no escribe. Sin bucle posible.
async function sincronizarCartaConDeposito() {
  if (!estado.carta.length || !estado.insumos.length) return;
  const cambios = estado.carta
    .filter((i) => (i.receta || []).length)
    .map((i) => ({ id: i.id, rinde: rindeDeposito(i), tenia: i.stock }))
    .filter((x) => x.rinde !== x.tenia);
  // Quien no puede escribir la carta —la puerta, un barman fuera de turno—
  // simplemente no sincroniza: no es su trabajo y las reglas lo frenan igual.
  await Promise.all(cambios.map((x) =>
    updateDoc(doc(db, 'carta', x.id), { stock: x.rinde }).catch(() => {})));
}

function escucharDeposito() {
  // El insumo lo lee toda la barra: es lo que hay guardado. Lo demás —compras,
  // gastos, proveedores— es plata, y el celular de la barra no lo puede leer.
  // Pedirlo igual sería un permission-denied cada vez que arranca.
  onSnapshot(collection(db, 'insumos'), (snap) => {
    estado.insumos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    pintarDeposito(); pintarConteo(); sincronizarCartaConDeposito();
  }, fallo('#deposito'));

}

// La plata del depósito —compras, gastos, proveedores— va aparte: el celular
// de la barra no la puede leer, y pedirla igual es un permission-denied cada
// vez que arranca.
//
// Se engancha cuando se sabe el rol, no al cargar: al cargar todavía no se
// sabe quién entró, y gatear acá dejaba al dueño sin sus propias compras.
let yaEscuchaPlataDeposito = false;
function escucharPlataDeposito() {
  if (yaEscuchaPlataDeposito) return;
  yaEscuchaPlataDeposito = true;

  // Los gastos con proveedor apuntado son los pagos a cuenta: hacen falta
  // completos, no solo los del rango que esté mirando la caja.
  onSnapshot(collection(db, 'egresos'), (snap) => {
    estado.egresosTodos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarDeposito();
  }, () => {});

  // El alias al que transfieren la entrada. Vive en publico/ porque el
  // invitado lo tiene que poder leer sin cuenta: es lo único que necesita
  // para pagar.
  onSnapshot(doc(db, 'publico', 'pagos'), (d) => {
    estado.pagos = d.exists() ? d.data() : {};
    pintarCajaGeneral();
  }, () => {});
  onSnapshot(collection(db, 'proveedores'), (snap) => {
    estado.proveedores = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    pintarDeposito();
  }, () => {});
  onSnapshot(collection(db, 'compras'), (snap) => {
    estado.compras = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
    pintarDeposito();
  }, () => {});
}

// La cuenta corriente sale de dos cosas que ya existen: lo que se compró a
// cuenta y lo que se le pagó (un gasto con ese proveedor apuntado).
function saldoProveedor(id) {
  const debe = estado.compras
    .filter((c) => c.proveedorId === id && c.condicion === 'cuenta')
    .reduce((a, c) => a + Number(c.total || 0), 0);
  const pagado = (estado.egresosTodos || [])
    .filter((e) => e.proveedorId === id)
    .reduce((a, e) => a + Number(e.monto || 0), 0);
  return debe - pagado;
}

function pintarDeposito() {
  const cont = $('#deposito');
  if (!cont || $('#vistaDeposito').hidden) return;
  const bajos = estado.insumos.filter((i) =>
    Number(i.minimo || 0) > 0 && unidadesDe(i) < Number(i.minimo));
  const conDeuda = estado.proveedores
    .map((p) => ({ ...p, saldo: saldoProveedor(p.id) }))
    .filter((p) => Math.abs(p.saldo) > 0.5);
  const deuda = conDeuda.reduce((a, p) => a + p.saldo, 0);

  // El celular de la barra mira y nada más: no da de alta mercadería, no
  // carga compras y no ve la plata. Mostrarle esos botones sería ofrecerle
  // algo que las reglas le van a negar.
  const soloMira = estado.esAparato;

  cont.innerHTML = `
    ${soloMira ? '' : `
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.9rem">
      <button class="btn primario" id="btnNuevaCompra" style="flex:1">+ Ingreso de mercadería</button>
      <button class="btn" id="btnNuevoInsumo" style="flex:1">+ Insumo</button>
    </div>`}

    ${soloMira ? `<p style="color:var(--suave);font-size:.86rem;margin:0 0 .9rem">
      Lo que hay guardado, para saber qué se puede hacer. Lo carga la casa.</p>` : ''}

    ${bajos.length ? `<div class="aviso mal"><span>⚠</span><div>
      <b>Se está por acabar:</b> ${bajos.map((i) => esc(i.nombre)).join(', ')}.</div></div>` : ''}

    ${deuda && !soloMira ? `<div class="caja-evento" style="margin-bottom:.9rem">
      <div class="titulo">Deuda con proveedores</div>
      <div class="numeros"><div class="plata"><b>${plata(deuda)}</b><span>se debe</span></div></div>
      <table class="ranking"><tbody>${conDeuda.map((p) => `
        <tr><td>${esc(p.nombre)}</td><td class="n">${plata(p.saldo)}</td></tr>`).join('')}
      </tbody></table>
      <p style="font-size:.76rem;color:var(--suave);margin:.7rem 0 0">
        Para bajarla, cargá el pago en <b>Caja → + Cargar gasto</b> eligiendo al proveedor.</p>
    </div>` : ''}

    ${estado.insumos.length ? estado.insumos.map((i) => {
      const bajo = Number(i.minimo || 0) > 0 && unidadesDe(i) < Number(i.minimo);
      return `
      <div class="item ${bajo ? 'agotado' : ''}">
        <div class="cuerpo">
          <div class="nombre">${esc(i.nombre)}</div>
          <div class="desc">${comoSeDice(i)}${
            Number(i.medidas || 1) > 1 ? ` · ${i.medidas} medidas por ${esc(i.unidad || 'unidad')}` : ''}${
            // Lo que costó es plata de la casa: en el celular del mostrador no va.
            i.costo && !soloMira ? ` · ${plata(i.costo)} c/u` : ''}</div>
        </div>
        ${soloMira ? '' : `
        <button class="btn" data-editar-insumo="${esc(i.id)}"
                style="padding:.3rem .6rem;font-size:.78rem">Editar</button>
        <button class="btn peligro solo-gerente-inline" data-baja-insumo="${esc(i.id)}"
                title="Darlo de baja" style="padding:.3rem .55rem;font-size:.78rem">✕</button>`}
      </div>`;
    }).join('')
      : `<div class="vacio">El depósito está vacío.<br>
         <small>Cargá los insumos y después, con <b>Ingreso de mercadería</b>, lo que compraste.</small></div>`}

    ${estado.compras.length ? `
      <div class="grupo-personal">Últimos ingresos</div>
      ${estado.compras.slice(0, 8).map((c) => `
        <div class="item">
          <div class="cuerpo">
            <div class="nombre">${esc(c.proveedor || 'Compra suelta')}</div>
            <div class="desc">${c.fecha?.toDate?.()?.toLocaleDateString('es-AR') || ''}
              · ${(c.items || []).length} producto${(c.items || []).length === 1 ? '' : 's'}
              · ${c.condicion === 'inicial' ? 'carga inicial'
                 : c.condicion === 'cuenta' ? 'a cuenta' : 'pagada'}</div>
          </div>
          <div class="total">${c.condicion === 'inicial' ? '—' : plata(c.total)}</div>
        </div>`).join('')}` : ''}`;

  // Para el celular de la barra estos botones no existen: se engancha lo que
  // haya, no lo que debería haber.
  if ($('#btnNuevoInsumo')) $('#btnNuevoInsumo').onclick = () => abrirInsumo(null);
  if ($('#btnNuevaCompra')) $('#btnNuevaCompra').onclick = abrirCompra;
  cont.querySelectorAll('[data-baja-insumo]').forEach((b) => b.onclick = () =>
    abrirBaja(estado.insumos.find((i) => i.id === b.dataset.bajaInsumo)));
  cont.querySelectorAll('[data-editar-insumo]').forEach((b) => b.onclick = () =>
    abrirInsumo(estado.insumos.find((i) => i.id === b.dataset.editarInsumo)));
}

// ---------- dar de baja un insumo ----------
// Borrar y listo no sirve: dentro de un mes nadie se acuerda por qué
// desapareció una botella del depósito. El motivo es obligatorio y queda.
//
// Y antes de borrar se mira quién depende de él: si un trago de la carta sale
// de ese insumo, borrarlo lo dejaría sin de dónde salir y el producto se
// agotaría solo, sin que nadie entienda por qué.
let dandoDeBaja = null;

function quienUsa(insumoId) {
  return estado.carta
    .filter((c) => (c.receta || []).some((r) => r.insumoId === insumoId))
    .map((c) => c.nombre || c.id);
}

function abrirBaja(ins) {
  if (!ins) return;
  dandoDeBaja = ins;
  const usan = quienUsa(ins.id);
  $('#queSeDaDeBaja').innerHTML = `<b>${esc(ins.nombre)}</b> — ${esc(comoSeDice(ins))} en el depósito.`
    + (usan.length
      ? `<br><span style="color:var(--naranja)">Ojo: ${esc(usan.join(', '))} ${
          usan.length === 1 ? 'sale' : 'salen'} de acá.</span>`
      : '');
  $('#inpMotivoBaja').value = '';
  $('#errorBaja').classList.add('oculto');
  $('#btnConfirmarBaja').disabled = false;
  $('#btnConfirmarBaja').textContent = 'Dar de baja';
  $('#dlgBaja').showModal();
  $('#inpMotivoBaja').focus();
}

$('#btnCancelarBaja').onclick = () => { dandoDeBaja = null; $('#dlgBaja').close(); };
$('#btnConfirmarBaja').onclick = async () => {
  const ins = dandoDeBaja;
  if (!ins) return;
  const motivo = $('#inpMotivoBaja').value.trim();
  const fallar = (t) => {
    $('#errorBajaTexto').textContent = t;
    $('#errorBaja').classList.remove('oculto');
  };
  if (motivo.length < 3) {
    fallar('Escribí el motivo: es lo único que queda después.');
    $('#inpMotivoBaja').focus();
    return;
  }
  // Un trago que sale de este insumo quedaría sin de dónde salir: se frena
  // acá, con el nombre del producto, en vez de romperlo en silencio.
  const usan = quienUsa(ins.id);
  if (usan.length) {
    fallar(`Primero sacalo de la receta de ${usan.join(', ')}, en Carta y stock.`);
    return;
  }
  const btn = $('#btnConfirmarBaja');
  btn.disabled = true; btn.textContent = 'Dando de baja…';
  try {
    // Primero queda la historia; recién después desaparece el insumo. Si se
    // cayera en el medio, es preferible una baja anotada de más que una
    // botella que desapareció sin explicación.
    await addDoc(collection(db, 'bajas'), {
      insumoId: ins.id, nombre: ins.nombre || ins.id,
      unidad: ins.unidad || 'unidad', stock: Number(ins.stock || 0),
      motivo, quien: quienAtiende() || estado.usuario || 'la casa',
      cuando: serverTimestamp(),
    });
    await deleteDoc(doc(db, 'insumos', ins.id));
    dandoDeBaja = null;
    $('#dlgBaja').close();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Dar de baja';
    fallar('No se pudo: ' + (e.code || e.message));
  }
};

let editandoInsumo = null;
function abrirInsumo(ins) {
  editandoInsumo = ins;
  $('#tituloInsumo').textContent = ins ? 'Editar insumo' : 'Nuevo insumo';
  $('#inpInsNombre').value = ins?.nombre || '';
  $('#inpInsUnidad').value = ins?.unidad || '';
  $('#inpInsMedidas').value = ins?.medidas ?? 1;
  $('#inpInsCosto').value = ins?.costo ?? '';
  $('#inpInsMinimo').value = ins?.minimo ?? '';
  $('#dlgInsumo').showModal();
  $('#inpInsNombre').focus();
}

async function guardarInsumo() {
  const nombre = $('#inpInsNombre').value.trim();
  if (nombre.length < 2) { $('#inpInsNombre').focus(); return; }
  const medidas = Math.max(1, Math.floor(Number($('#inpInsMedidas').value) || 1));
  const datos = {
    nombre,
    unidad: $('#inpInsUnidad').value.trim() || 'unidad',
    medidas,
    stock: Number(editandoInsumo?.stock || 0),
    costo: Math.max(0, Number($('#inpInsCosto').value) || 0),
    minimo: Math.max(0, Number($('#inpInsMinimo').value) || 0),
    ...(editandoInsumo ? {} : { creadoEn: serverTimestamp() }),
  };
  try {
    if (editandoInsumo) await updateDoc(doc(db, 'insumos', editandoInsumo.id), datos);
    else await addDoc(collection(db, 'insumos'), datos);
    $('#dlgInsumo').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- ingreso de mercadería ----------
function abrirCompra() {
  estado.compra = { items: {}, condicion: 'cuenta', pago: 'efectivo', proveedorId: '', proveedor: '' };
  $('#dlgCompra').showModal();
  pintarCompra();
}

function totalCompra() {
  return Object.entries(estado.compra.items).reduce((a, [id, l]) => {
    return a + Number(l.unidades || 0) * Number(l.costoUnit || 0);
  }, 0);
}

function pintarCompra() {
  const c = estado.compra;
  const esInicial = c.condicion === 'inicial';
  $('#cuerpoCompra').innerHTML = `
    <label class="campo">
      <span>Proveedor <small>(vacío si fue una compra suelta)</small></span>
      <input id="inpCompraProv" list="listaProv" maxlength="60" autocomplete="off"
             value="${esc(c.proveedor || '')}" placeholder="Distribuidora, super, kiosco…">
      <datalist id="listaProv">
        ${estado.proveedores.map((p) => `<option value="${esc(p.nombre)}">`).join('')}
      </datalist>
    </label>

    <div class="campo">
      <span style="display:block;font-size:.82rem;color:var(--suave);margin-bottom:.4rem">Qué es</span>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        ${[['cuenta', 'A cuenta'], ['contado', 'Pagada'], ['inicial', 'Carga inicial']].map(([k, t]) => `
          <button type="button" class="btn ${c.condicion === k ? 'primario' : ''}"
                  data-condicion="${k}" style="flex:1;font-size:.84rem">${t}</button>`).join('')}
      </div>
      <small class="pista">${{
        cuenta: 'Suma stock y queda como deuda con el proveedor.',
        contado: 'Suma stock y sale de la caja ahora.',
        inicial: 'Solo suma stock: es lo que ya tenías, no plata que salió.',
      }[c.condicion]}</small>
    </div>

    ${c.condicion === 'contado' ? `
      <div class="campo">
        <span style="display:block;font-size:.82rem;color:var(--suave);margin-bottom:.4rem">Cómo se pagó</span>
        <div style="display:flex;gap:.6rem">
          ${[['efectivo', '💵 Efectivo'], ['virtual', '📲 Virtual']].map(([k, t]) => `
            <button type="button" class="btn ${c.pago === k ? 'primario' : ''}"
                    data-pagocompra="${k}" style="flex:1">${t}</button>`).join('')}
        </div>
      </div>` : ''}

    ${estado.insumos.length ? `
      <div class="lista-venta">
        ${estado.insumos.map((i) => {
          const l = c.items[i.id] || {};
          return `
          <div class="item" style="flex-wrap:wrap">
            <div class="cuerpo" style="flex:1 0 100%">
              <div class="nombre">${esc(i.nombre)}</div>
              <div class="desc">hay ${comoSeDice(i)}</div>
            </div>
            <label style="flex:1;font-size:.76rem;color:var(--suave)">entran
              <input class="conteo-num" type="number" min="0" inputmode="numeric"
                     data-compra-u="${esc(i.id)}" value="${l.unidades ?? ''}"
                     placeholder="0" style="width:100%"></label>
            ${!esInicial ? `<label style="flex:1;font-size:.76rem;color:var(--suave)">$ c/u
              <input class="conteo-num" type="number" min="0" inputmode="numeric"
                     data-compra-c="${esc(i.id)}" value="${l.costoUnit ?? i.costo ?? ''}"
                     placeholder="0" style="width:100%"></label>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${!esInicial ? `<div class="total-venta"><span>Total</span><b>${plata(totalCompra())}</b></div>` : ''}
      <button class="btn primario ancho-full" id="btnGuardarCompra" style="margin-top:.8rem">
        ${esInicial ? 'Cargar el stock inicial' : 'Guardar el ingreso'}</button>`
      : `<div class="aviso mal"><span>⚠</span><div>
          <b>Primero cargá los insumos.</b> Son las botellas, latas y paquetes que
          comprás.</div></div>`}`;

  $('#cuerpoCompra').querySelectorAll('[data-condicion]').forEach((b) => b.onclick = () => {
    estado.compra.condicion = b.dataset.condicion; pintarCompra();
  });
  $('#cuerpoCompra').querySelectorAll('[data-pagocompra]').forEach((b) => b.onclick = () => {
    estado.compra.pago = b.dataset.pagocompra; pintarCompra();
  });
  const prov = $('#inpCompraProv');
  if (prov) prov.oninput = () => { estado.compra.proveedor = prov.value; };
  $('#cuerpoCompra').querySelectorAll('[data-compra-u]').forEach((inp) => inp.oninput = () => {
    const id = inp.dataset.compraU;
    estado.compra.items[id] = { ...(estado.compra.items[id] || {}), unidades: Number(inp.value) || 0 };
    if (!estado.compra.items[id].unidades) delete estado.compra.items[id];
    const t = $('.total-venta b'); if (t) t.textContent = plata(totalCompra());
  });
  $('#cuerpoCompra').querySelectorAll('[data-compra-c]').forEach((inp) => inp.oninput = () => {
    const id = inp.dataset.compraC;
    estado.compra.items[id] = { ...(estado.compra.items[id] || {}), costoUnit: Number(inp.value) || 0 };
    const t = $('.total-venta b'); if (t) t.textContent = plata(totalCompra());
  });
  if ($('#btnGuardarCompra')) $('#btnGuardarCompra').onclick = guardarCompra;
}

async function guardarCompra() {
  const c = estado.compra;
  const items = Object.entries(c.items)
    .filter(([, l]) => Number(l.unidades) > 0)
    .map(([id, l]) => {
      const ins = estado.insumos.find((x) => x.id === id) || {};
      return { insumoId: id, nombre: ins.nombre || id,
               unidades: Number(l.unidades), costoUnit: Number(l.costoUnit || 0) };
    });
  if (!items.length) { alert('Cargá al menos un producto.'); return; }

  const btn = $('#btnGuardarCompra');
  btn.disabled = true; btn.textContent = 'Guardando…';
  const nombreProv = ($('#inpCompraProv')?.value || '').trim();
  const total = c.condicion === 'inicial' ? 0 : totalCompra();
  try {
    // El proveedor se da de alta solo la primera vez que se lo nombra.
    let proveedorId = '';
    if (nombreProv) {
      const ya = estado.proveedores.find((p) =>
        p.nombre.toLowerCase() === nombreProv.toLowerCase());
      if (ya) proveedorId = ya.id;
      else {
        const ref = await addDoc(collection(db, 'proveedores'),
          { nombre: nombreProv, creadoEn: serverTimestamp() });
        proveedorId = ref.id;
      }
    }

    const ref = await addDoc(collection(db, 'compras'), {
      proveedor: nombreProv, proveedorId,
      fecha: Timestamp.fromDate(new Date()),
      items, total, condicion: c.condicion,
      ...(c.condicion === 'contado' ? { pago: c.pago } : {}),
      cargadoPor: estado.usuario || 'casa',
      creadoEn: serverTimestamp(),
    });

    // Suma el stock, en medidas.
    await Promise.all(items.map((i) => {
      const ins = estado.insumos.find((x) => x.id === i.insumoId);
      if (!ins) return null;
      const medidas = Math.max(1, Number(ins.medidas || 1));
      return updateDoc(doc(db, 'insumos', i.insumoId),
        { stock: Number(ins.stock || 0) + i.unidades * medidas });
    }));

    // Pagada en el acto: además es plata que salió de la caja.
    if (c.condicion === 'contado' && total > 0) {
      await addDoc(collection(db, 'egresos'), {
        concepto: `Mercadería${nombreProv ? ' · ' + nombreProv : ''}`,
        categoria: nombreProv ? 'proveedor' : 'insumo',
        monto: total, pago: c.pago,
        fecha: Timestamp.fromDate(new Date()),
        cajaId: cajaActual(), proveedorId, compraId: ref.id,
        cargadoPor: estado.usuario || 'casa', creadoEn: serverTimestamp(),
      }).catch(() => {});
    }
    $('#dlgCompra').close();
  } catch (e) {
    alert('No se pudo: ' + (e.code || e.message));
  }
  btn.disabled = false;
}

// ---------- de qué sale cada producto de la carta ----------
let recetaDe = null;
function abrirReceta(item) {
  recetaDe = item;
  $('#tituloReceta').textContent = `De qué sale · ${item.nombre || item.id}`;
  $('#cuerpoReceta').innerHTML = estado.insumos.length
    ? `<div class="lista-conteo">${estado.insumos.map((i) => {
        const linea = (item.receta || []).find((r) => r.insumoId === i.id);
        return `
        <div class="item">
          <div class="cuerpo">
            <div class="nombre">${esc(i.nombre)}</div>
            <div class="desc">hay ${comoSeDice(i)}${
              Number(i.medidas || 1) > 1 ? ` · ${i.medidas} medidas por ${esc(i.unidad || 'unidad')}` : ''}</div>
          </div>
          <input class="conteo-num" type="number" min="0" inputmode="numeric"
                 data-receta="${esc(i.id)}" placeholder="0"
                 value="${linea?.medidas ?? ''}">
        </div>`;
      }).join('')}</div>`
    : `<div class="aviso mal"><span>⚠</span><div>
        <b>Todavía no hay insumos.</b> Cargalos en <b>Depósito</b> y volvé.</div></div>`;
  $('#dlgReceta').showModal();
}

async function guardarReceta() {
  const receta = [];
  $('#cuerpoReceta').querySelectorAll('[data-receta]').forEach((inp) => {
    const medidas = Number(inp.value) || 0;
    if (medidas > 0) receta.push({ insumoId: inp.dataset.receta, medidas });
  });
  try {
    await updateDoc(doc(db, 'carta', recetaDe.id), { receta });
    $('#dlgReceta').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- el conteo de la noche ----------
//
// Es control, no inventario: lo que la barra cuenta a mano al abrir y al
// cerrar. NO toca el stock de la carta. Sirve para una sola cosa, que es la
// que importa: comparar lo que había, lo que se vendió y lo que quedó.
function escucharConteo() {
  const caja = cajaActual();
  if (estado.conteoDe === caja) return;
  estado.conteoDe = caja;
  if (estado.cortarConteo) estado.cortarConteo();
  estado.cortarConteo = onSnapshot(doc(db, 'conteos', caja), (d) => {
    estado.conteo = d.exists() ? d.data() : null;
    pintarConteo();
  }, () => {});
}

// Qué se cuenta: lo del depósito (botellas, latas) y los productos de la carta
// que todavía no tienen receta y llevan su propio stock. Contar "Fernet con
// coca" no tiene sentido cuando sale de una botella: lo que se cuenta es la
// botella.
function cosasAContar() {
  const sueltos = estado.carta.filter((i) =>
    i.enCarta !== false && !(i.receta || []).length && typeof i.stock === 'number');
  return [
    ...estado.insumos.map((i) => ({
      clave: `ins:${i.id}`, nombre: i.nombre, insumo: i,
      medidas: Math.max(1, Number(i.medidas || 1)),
      unidad: i.unidad || 'unidad', enApp: Number(i.stock || 0),
    })),
    ...sueltos.map((i) => ({
      clave: `item:${i.id}`, nombre: i.nombre || i.id, insumo: null,
      medidas: 1, unidad: 'unidad', enApp: Number(i.stock || 0),
    })),
  ];
}

// Lo que salió en esta caja, en las mismas unidades en que se cuenta: medidas
// para el depósito, unidades para lo suelto.
function consumoDeLaCaja() {
  const m = new Map();
  const sumar = (clave, cuanto) => m.set(clave, (m.get(clave) || 0) + cuanto);
  for (const p of estado.pedidos) {
    if (p.estado !== 'entregado') continue;
    for (const i of (p.items || [])) {
      const c = estado.carta.find((x) => x.id === i.id);
      const cuantos = Number(i.cantidad || 0);
      if (c && (c.receta || []).length) {
        for (const r of c.receta) sumar(`ins:${r.insumoId}`, Number(r.medidas || 0) * cuantos);
      } else {
        sumar(`item:${i.id}`, cuantos);
      }
    }
  }
  return m;
}

function abrirConteo() {
  escucharConteo();
  estado.cargandoConteo = {};
  $('#dlgConteo').showModal();
  pintarConteo();
}

function pintarConteo() {
  if (!$('#dlgConteo').open) return;
  const c = estado.conteo || {};
  const hayApertura = !!c.aperturaEn;
  const hayCierre = !!c.cierreEn;
  const etapa = !hayApertura ? 'apertura' : (!hayCierre ? 'cierre' : 'listo');
  const vendido = consumoDeLaCaja();
  const cosas = cosasAContar();

  $('#tituloConteo').textContent = {
    apertura: 'Conteo de apertura',
    cierre: 'Conteo de cierre',
    listo: 'Conteo de la noche',
  }[etapa];
  $('#subtituloConteo').textContent = {
    apertura: 'Contá lo que hay antes de abrir. Esto no toca el stock: es control.',
    cierre: 'Contá lo que quedó. Abajo vas a ver si falta algo.',
    listo: 'Ya está cerrado. Esto es lo que dio.',
  }[etapa];

  if (!cosas.length) {
    $('#cuerpoConteo').innerHTML = `<div class="aviso"><span>📦</span><div>
      <b>No hay nada para contar.</b> Cargá los insumos del depósito, o ponele
      stock a los productos de la carta.</div></div>`;
    return;
  }

  // Cerrado: la comparación, que es para lo que se hizo todo esto.
  if (etapa === 'listo') {
    const filas = cosas.map((x) => {
      const abrio = Number(c.apertura?.[x.clave] ?? 0);
      const salio = Number(vendido.get(x.clave) || 0);
      const cerro = Number(c.cierre?.[x.clave] ?? 0);
      return { x, abrio, salio, cerro, dif: cerro - (abrio - salio) };
    }).filter((f) => f.abrio || f.salio || f.cerro);
    const faltan = filas.filter((f) => f.dif < 0);
    const comoSe = (f, n) => f.x.medidas > 1
      ? `${n} <small>med</small>` : String(n);
    $('#cuerpoConteo').innerHTML = `
      ${faltan.length ? `<div class="aviso mal"><span>⚠</span><div>
        <b>Falta mercadería en ${faltan.length} producto${faltan.length === 1 ? '' : 's'}.</b><br>
        Puede ser rotura, un trago servido de más o algo que no se cobró.</div></div>`
        : `<div class="aviso ok"><span>✓</span><div>
        <b>Cierra todo.</b> Lo que quedó coincide con lo vendido.</div></div>`}
      <table class="ranking tabla-conteo" style="margin-top:.8rem"><thead>
        <tr><th>Qué</th><th class="n">Abrió</th><th class="n">Salió</th>
            <th class="n">Quedó</th><th class="n">Dif</th></tr></thead><tbody>
        ${filas.map((f) => `
          <tr class="${f.dif < 0 ? 'falta' : (f.dif > 0 ? 'sobra' : '')}">
            <td>${esc(f.x.nombre)}</td>
            <td class="n">${comoSe(f, f.abrio)}</td><td class="n">${f.salio}</td>
            <td class="n">${f.cerro}</td>
            <td class="n">${f.dif > 0 ? '+' : ''}${f.dif || '—'}</td>
          </tr>`).join('')}
      </tbody></table>
      <p style="font-size:.76rem;color:var(--suave);margin:.8rem 0 0">
        Lo contó ${esc(c.aperturaPor || '—')} al abrir y ${esc(c.cierrePor || '—')} al cerrar.
        Lo del depósito va en medidas. El conteo no movió el stock.</p>
      <button class="btn ancho-full solo-gerente-inline" id="btnRehacerConteo"
              style="margin-top:.7rem">Empezar un conteo nuevo</button>`;
    if ($('#btnRehacerConteo')) $('#btnRehacerConteo').onclick = rehacerConteo;
    return;
  }

  // Abierto o por cerrar: la planilla. Se cuenta en unidades enteras o medias
  // botellas, que es como se cuenta en una barra.
  $('#cuerpoConteo').innerHTML = `
    ${hayApertura ? `<p style="font-size:.8rem;color:var(--suave);margin:0 0 .6rem">
      Abrió ${esc(c.aperturaPor || '')} ${c.aperturaEn?.toDate?.()
        ? 'a las ' + hora(c.aperturaEn) : ''}.</p>` : ''}
    <div class="lista-conteo">
      ${cosas.map((x) => {
        const abrio = Number(c.apertura?.[x.clave] ?? 0);
        const salio = Number(vendido.get(x.clave) || 0);
        const enApp = x.medidas > 1
          ? `${Math.floor(x.enApp / x.medidas)} ${esc(x.unidad)}${
              x.enApp % x.medidas ? ' y ' + (x.enApp % x.medidas) + ' med' : ''}`
          : x.enApp;
        return `
        <div class="item">
          <div class="cuerpo">
            <div class="nombre">${esc(x.nombre)}</div>
            <div class="desc">en la app: ${enApp}${
              x.medidas > 1 ? ` · ${x.medidas} medidas por ${esc(x.unidad)}` : ''}${
              etapa === 'cierre' ? ` · abrió ${abrio} · salió ${salio}` : ''}</div>
          </div>
          <input class="conteo-num" type="number" min="0" step="${x.medidas > 1 ? '0.5' : '1'}"
                 inputmode="decimal" data-conteo="${esc(x.clave)}"
                 data-medidas="${x.medidas}" placeholder="0"
                 value="${estado.cargandoConteo[x.clave] ?? ''}">
        </div>`;
      }).join('')}
    </div>
    <p style="font-size:.76rem;color:var(--suave);margin:.6rem 0 0">
      Contá en ${cosas.some((x) => x.medidas > 1)
        ? 'unidades: media botella se escribe 0.5' : 'unidades'}.</p>
    <button class="btn primario ancho-full" id="btnGuardarConteo" style="margin-top:.8rem">
      ${etapa === 'apertura' ? 'Guardar el conteo de apertura' : 'Cerrar el conteo'}</button>`;

  $('#cuerpoConteo').querySelectorAll('[data-conteo]').forEach((inp) => {
    inp.oninput = () => { estado.cargandoConteo[inp.dataset.conteo] = inp.value; };
  });
  $('#btnGuardarConteo').onclick = () => guardarConteo(etapa);
}

async function guardarConteo(etapa) {
  // Se cuenta en unidades y se guarda en medidas: media botella de 10 medidas
  // son 5. Así la comparación con lo vendido es contra lo mismo.
  const numeros = {};
  $('#cuerpoConteo').querySelectorAll('[data-conteo]').forEach((inp) => {
    if (inp.value === '') return;
    const medidas = Math.max(1, Number(inp.dataset.medidas || 1));
    numeros[inp.dataset.conteo] = Math.max(0, Math.round((Number(inp.value) || 0) * medidas));
  });
  if (!Object.keys(numeros).length) {
    alert('Cargá al menos un producto.');
    return;
  }
  const btn = $('#btnGuardarConteo');
  btn.disabled = true; btn.textContent = 'Guardando…';
  const quien = quienAtiende() || estado.usuario || 'casa';
  try {
    await setDoc(doc(db, 'conteos', cajaActual()), etapa === 'apertura'
      ? { cajaId: cajaActual(), nombre: estado.evento?.nombre || 'Día',
          apertura: numeros, aperturaEn: serverTimestamp(), aperturaPor: quien }
      : { cierre: numeros, cierreEn: serverTimestamp(), cierrePor: quien },
      { merge: true });
    estado.cargandoConteo = {};
  } catch (e) {
    alert('No se pudo guardar: ' + (e.code || e.message));
  }
  btn.disabled = false;
}

async function rehacerConteo() {
  if (!confirm('¿Empezar un conteo nuevo?\n\nSe borra el de esta noche.')) return;
  try { await deleteDoc(doc(db, 'conteos', cajaActual())); estado.cargandoConteo = {}; }
  catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- el stock baja al entregar ----------
//
// Al entregar, no al pedir: lo que todavía no salió de la barra sigue siendo
// stock. Solo se tocan los productos que llevan cuenta; los que están en ∞ no
// se controlan y se dejan como están.
//
// signo = -1 descuenta (se entregó), +1 devuelve (se corrigió un entregado).
async function moverStock(pedido, signo) {
  // Lo que hay que mover del depósito: se junta todo primero, porque dos
  // tragos distintos pueden salir de la misma botella.
  const porInsumo = new Map();
  const sueltos = [];

  for (const i of (pedido?.items || [])) {
    const c = estado.carta.find((x) => x.id === i.id);
    if (!c) continue;
    const cuantos = Number(i.cantidad || 0);
    if (Array.isArray(c.receta) && c.receta.length) {
      // Sale del depósito: una medida por vez, no una botella.
      for (const r of c.receta) {
        porInsumo.set(r.insumoId,
          (porInsumo.get(r.insumoId) || 0) + Number(r.medidas || 0) * cuantos);
      }
    } else if (typeof c.stock === 'number') {
      // Sin receta: sigue descontando su propio stock, como antes. Así lo que
      // ya estaba cargado no se rompe mientras se arma el depósito.
      sueltos.push({ id: i.id, stock: c.stock, cuantos });
    }
  }

  await Promise.all([
    ...sueltos.map((x) => updateDoc(doc(db, 'carta', x.id),
      // No baja de cero: un stock en negativo no significa nada y asusta al
      // que lo mira. Si falta, lo muestra el conteo de la noche.
      { stock: Math.max(0, x.stock + signo * x.cuantos) }).catch(() => {})),
    ...[...porInsumo].map(([id, medidas]) => {
      const ins = estado.insumos.find((x) => x.id === id);
      if (!ins) return null;
      return updateDoc(doc(db, 'insumos', id),
        { stock: Math.max(0, Number(ins.stock || 0) + signo * medidas) }).catch(() => {});
    }),
  ]);
}

// ---------- cobrar ----------
// Al entregar hay que decir cómo pagó: un toque, y la caja queda cerrada en el
// momento. Si se deja para después, no se hace nunca.
let cobrando = null;
function pedirPago(pedido) {
  cobrando = pedido;
  $('#detalleCobro').textContent =
    `${quienPidio(pedido)} · ${plata(pedido.total)}`;
  $('#dlgCobro').showModal();
}

async function cerrarCobro(pago) {
  const p = cobrando;
  cobrando = null;
  $('#dlgCobro').close();
  if (!p) return;
  try {
    await updateDoc(doc(db, 'pedidos', p.id), {
      estado: 'entregado', pago, vendidoPor: quienAtiende() || estado.usuario || 'casa',
    });
    // Recién acá sale de la barra: ahora sí baja el stock.
    if (p.estado !== 'entregado') await moverStock(p, -1);
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) { alert('No se pudo cobrar: ' + (e.code || e.message)); }
}

async function cambiarEstado(id, nuevo) {
  // Entregar es cobrar: no se pasa de largo.
  if (nuevo === 'entregado') {
    const p = estado.pedidos.find((x) => x.id === id);
    if (p) return pedirPago(p);
  }
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
    // Una receta nueva, o un producto nuevo con receta, también mueve el
    // número: no solo lo mueve el depósito.
    sincronizarCartaConDeposito();
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
    // Con receta, el número no se toca a mano: lo pone el depósito. Mostrar
    // los − + ahí sería mentir, porque la próxima venta lo vuelve a calcular.
    const delDeposito = (i.receta || []).length > 0;
    const rinde = delDeposito ? rindeDeposito(i) : null;
    return `
    <div class="item ${fuera || i.disponible === false || rinde === 0 ? 'agotado' : ''}">
      <div class="cuerpo">
        <div class="nombre">${esc(i.nombre || i.id)}${fuera ? ' — <small>fuera de carta</small>' : ''}</div>
        <div class="desc">${esc(i.categoria || '')} · ${plata(i.precio)}${
          delDeposito ? ` · ${rinde === 0 ? 'sin material en el depósito' : 'sale del depósito'}` : ''}</div>
      </div>
      ${delDeposito ? `
      <div class="cant" title="Lo que el depósito alcanza a dar. Para que suba, cargá mercadería.">
        <span class="n">${rinde}</span>
      </div>` : `
      <div class="cant">
        <button data-stock="${i.id}" data-d="-1" aria-label="Restar stock" ${fuera ? 'disabled' : ''}>−</button>
        <span class="n">${typeof i.stock === 'number' ? i.stock : '∞'}</span>
        <button data-stock="${i.id}" data-d="1" aria-label="Sumar stock" ${fuera ? 'disabled' : ''}>+</button>
      </div>`}
      <button class="btn" data-toggle="${i.id}" style="padding:.4rem .7rem;font-size:.82rem" ${fuera ? 'disabled' : ''}>
        ${i.disponible === false ? 'Activar' : 'Agotar'}
      </button>
      <button class="btn solo-gerente-inline" data-receta-de="${i.id}"
              style="padding:.4rem .7rem;font-size:.82rem"
              title="De qué insumo sale">${(i.receta || []).length ? '🧾' : '🧾+'}</button>
      <button class="btn solo-gerente-inline" data-carta="${i.id}" style="padding:.4rem .7rem;font-size:.82rem">
        ${fuera ? 'Poner en carta' : 'Sacar'}
      </button>
    </div>`;
  }).join('');

  cont.querySelectorAll('[data-receta-de]').forEach((b) => b.onclick = () =>
    abrirReceta(estado.carta.find((i) => i.id === b.dataset.recetaDe)));
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
                   evento: '#vistaEvento', caja: '#vistaCaja',
                   deposito: '#vistaDeposito',
                   calendario: '#vistaCalendario', puerta: '#vistaPuerta',
                   usuarios: '#vistaUsuarios' };
  const tabs = { tablero: '#tabTablero', carta: '#tabCartaBar',
                 evento: '#tabEvento', caja: '#tabCaja',
                 deposito: '#tabDeposito',
                 calendario: '#tabCalendario', puerta: '#tabPuerta',
                 usuarios: '#tabUsuarios' };
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
$('#tabCaja').onclick = () => { irA('caja'); pintarCajaGeneral(); };
$('#tabDeposito').onclick = () => { irA('deposito'); pintarDeposito(); };
$('#tabCalendario').onclick = () => irA('calendario');
$('#tabPuerta').onclick = () => irA('puerta');
$('#tabUsuarios').onclick = () => { irA('usuarios'); pintarUsuarios(); };

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
