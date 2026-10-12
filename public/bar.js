// El Sótano — panel de barra. Tablero en vivo, cambio de estado y control de stock.
// El SDK viene empaquetado en /vendor (ver src/firebase.js), no del CDN.
import {
  initializeApp,
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, deleteApp,
  getFirestore, connectFirestoreEmulator, collection, doc, query, where, orderBy,
  onSnapshot, updateDoc, setDoc, Timestamp, addDoc, limit, serverTimestamp,
} from '/vendor/firebase.js';

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

const estado = { pedidos: [], carta: [], evento: null, eventos: [], accesos: [], dueno: false, tomandoPedidos: true, desdeCache: false, usuario: '', sonido: localStorage.getItem('sotano:sonido') !== 'no', vistos: new Set() };

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

async function marcarTomandoPedidos(valor, evento) {
  await setDoc(ESTADO_LOCAL(), {
    tomandoPedidos: valor,
    evento: valor ? (evento?.nombre ?? null) : null,
    eventoId: valor ? (evento?.id ?? null) : null,
    cambiadoEn: serverTimestamp(),
  });
}


function escucharEvento() {
  onSnapshot(query(EVENTOS(), where('cerradoEn', '==', null), limit(1)), (snap) => {
    estado.evento = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    // Siempre: escucharPedidos() no hace nada si el "desde" no cambió. Hace
    // falta llamarlo igual porque abiertoEn es un serverTimestamp y llega null
    // en la primera vuelta — el evento no cambia de id, pero sí de arranque.
    escucharPedidos();
    pintarEvento();
    pintarCaja();
  }, fallo('#evento'));

  onSnapshot(ESTADO_LOCAL(), (d) => {
    estado.tomandoPedidos = d.exists() ? d.data().tomandoPedidos !== false : true;
    pintarEvento();
  }, () => {});

  onSnapshot(query(EVENTOS(), orderBy('abiertoEn', 'desc'), limit(20)), (snap) => {
    estado.eventos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.cerradoEn);
    pintarEventosPasados();
  }, fallo('#eventosPasados'));
}

const fallo = (sel) => (e) => {
  if (e.code === 'permission-denied') $('#avisoPermiso').classList.remove('oculto');
  $(sel).innerHTML = `<div class="aviso mal"><span>⚠</span><div>${esc(e.code || e.message)}</div></div>`;
};

// Desde cuándo mira el tablero: el arranque del evento abierto, o el día de hoy.
function desdeCuando() {
  const abierto = estado.evento?.abiertoEn?.toDate?.();
  if (abierto) return abierto;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return hoy;
}

async function abrirEvento() {
  const sugerido = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const nombre = (prompt('Nombre del evento', sugerido[0].toUpperCase() + sugerido.slice(1)) || '').trim();
  if (!nombre) return;
  try {
    const ref = await addDoc(EVENTOS(), { nombre, abiertoEn: serverTimestamp(), cerradoEn: null, cierre: null });
    await marcarTomandoPedidos(true, { id: ref.id, nombre });
  } catch (e) { alert('No se pudo abrir: ' + (e.code || e.message)); }
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
  try {
    await updateDoc(doc(db, 'barra', 'eventos', 'items', estado.evento.id),
      { cerradoEn: serverTimestamp(), cierre: r });
    await marcarTomandoPedidos(false);
  } catch (e) { alert('No se pudo cerrar: ' + (e.code || e.message)); }
}

function pintarEvento() {
  const cont = $('#evento');
  if (!estado.evento) {
    cont.innerHTML = `<div class="aviso"><span>🎪</span><div>
      <b>No hay ningún evento abierto.</b><br>
      Sin evento, el tablero muestra lo del día y se vacía a medianoche.
      Abriendo uno, la noche sigue entera hasta que vos la cierres.
      </div></div>
      <div class="interruptor" style="margin-top:.9rem">
        <div>
          <b>${estado.tomandoPedidos ? 'Tomando pedidos' : 'No se toman pedidos'}</b>
          <span>${estado.tomandoPedidos
            ? 'Sin evento abierto, pero el QR deja pedir.'
            : 'El QR sigue andando y nadie puede mandar un pedido.'}</span>
        </div>
        <button class="btn ${estado.tomandoPedidos ? 'peligro' : 'primario'}" id="btnTomando">
          ${estado.tomandoPedidos ? 'Cortar' : 'Reabrir'}
        </button>
      </div>
      <button class="btn primario ancho-full" id="btnAbrirEvento" style="margin-top:.9rem">Abrir evento</button>`;
    $('#btnAbrirEvento').onclick = abrirEvento;
    $('#btnTomando').onclick = async () => {
      const prender = !estado.tomandoPedidos;
      if (!prender && !confirm('¿Cortar los pedidos?')) return;
      try { await marcarTomandoPedidos(prender, null); }
      catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
    };
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
      ${r.sinCerrar ? `<div class="aviso mal" style="margin-top:.8rem"><span>⚠</span><div>
        Hay ${r.sinCerrar} pedidos sin entregar. <b>No suman a la caja</b> hasta que los marques.</div></div>` : ''}
      <div class="interruptor">
        <div>
          <b>${estado.tomandoPedidos ? 'Tomando pedidos' : 'No se toman pedidos'}</b>
          <span>${estado.tomandoPedidos
            ? 'El QR de la mesa abre la carta y deja pedir.'
            : 'El QR sigue andando, pero nadie puede mandar un pedido.'}</span>
        </div>
        <button class="btn ${estado.tomandoPedidos ? 'peligro' : 'primario'}" id="btnTomando">
          ${estado.tomandoPedidos ? 'Cortar' : 'Reabrir'}
        </button>
      </div>
      ${r.porItem.length ? `<table class="ranking"><tbody>${r.porItem.map((i) => `
        <tr><td>${esc(i.nombre)}</td><td class="n">${i.cantidad}</td><td class="n">${plata(i.importe)}</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:var(--suave);font-size:.9rem">Todavía no se entregó nada.</p>'}
      <button class="btn peligro ancho-full" id="btnCerrarEvento" style="margin-top:1rem">Cerrar evento y hacer la caja</button>
    </div>`;
  $('#btnCerrarEvento').onclick = cerrarEvento;
  $('#btnTomando').onclick = async () => {
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
  cont.innerHTML = estado.eventos.map((e) => {
    const c = e.cierre || {};
    const f = e.cerradoEn?.toDate?.();
    return `<div class="item">
      <div class="cuerpo">
        <div class="nombre">${esc(e.nombre)}</div>
        <div class="desc">${f ? f.toLocaleDateString('es-AR') : ''} · ${c.entregados ?? 0} entregados${c.cancelados ? ` · ${c.cancelados} cancelados` : ''}</div>
      </div>
      <div class="total">${plata(c.facturado || 0)}</div>
    </div>`;
  }).join('');
}

// ---------- usuarios de barra del turno ----------
// Cuentas usuario/contraseña, sin mail, que el dueño da de alta para un
// evento y apaga cuando termina. El permiso es accesosBarra/{uid}: apagarlo
// corta el acceso en el momento, sin tocar reglas ni redesplegar.
function escucharAccesos() {
  onSnapshot(collection(db, 'accesosBarra'), (snap) => {
    estado.dueno = true;
    document.body.classList.add('es-dueno');
    estado.accesos = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => Number(!!b.activo) - Number(!!a.activo)
        || String(a.usuario).localeCompare(String(b.usuario)));
    pintarAccesos();
  }, (e) => {
    // permission-denied acá es la respuesta esperada para el personal de
    // turno: no es dueño, no ve la administración y no pasa nada.
    estado.dueno = false;
    document.body.classList.remove('es-dueno');
    if (e.code !== 'permission-denied') fallo('#accesos')(e);
  });
}

// Las reglas rechazan cualquier escritura en cuanto se apaga el acceso, pero
// un listener ya abierto puede seguir recibiendo un rato: Firestore no vuelve
// a evaluar la regla al instante. Así que cada cuenta mira su propio permiso
// y se va sola cuando se lo apagan.
function vigilarMiAcceso(uid) {
  // El dueño no tiene documento de acceso, así que "no existe" no puede
  // significar echarlo. Solo se reacciona a un permiso que estuvo y se cayó.
  let loTuvo = false;
  let yendose = false;
  onSnapshot(doc(db, 'accesosBarra', uid), (d) => {
    if (d.exists() && d.data().activo === true) { loTuvo = true; return; }
    if (!d.exists() && !loTuvo) return;
    if (yendose) return;
    yendose = true;
    signOut(auth).finally(() =>
      alert('Se cerró tu turno. Pedile al dueño que te vuelva a habilitar.'));
  }, () => {});
}

async function altaUsuarioBarra() {
  const usuario = (prompt('Usuario para la barra (sin espacios)',
    estado.evento ? 'barra-' + String(estado.evento.nombre).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'barra') || '').trim().toLowerCase();
  if (!usuario) return;
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) {
    alert('Entre 3 y 30 caracteres: letras, números, punto, guión o guión bajo. Sin espacios ni acentos.');
    return;
  }
  const clave = (prompt(`Contraseña para "${usuario}" (mínimo 6)\n\nAnotala: no se puede recuperar, se cambia creando otra.`) || '');
  if (clave.length < 6) { if (clave) alert('Mínimo 6 caracteres.'); return; }

  // Una app aparte para el alta: createUser deja logueada a la cuenta nueva,
  // y si usáramos la principal el dueño se quedaría afuera de su propio panel.
  const secundaria = initializeApp(CFG, 'alta-' + Date.now());
  const authSec = getAuth(secundaria);
  if (EMULADOR) connectAuthEmulator(authSec, 'http://127.0.0.1:9099', { disableWarnings: true });
  try {
    const cred = await createUserWithEmailAndPassword(authSec, aMail(usuario), clave);
    await setDoc(doc(db, 'accesosBarra', cred.user.uid), {
      usuario,
      activo: true,
      eventoId: estado.evento?.id || null,
      evento: estado.evento?.nombre || null,
      creadoEn: serverTimestamp(),
    });
    alert(`Listo.\n\nUsuario: ${usuario}\nContraseña: la que pusiste\n\nEn el celular de la barra:\n${location.origin}/bar.html`);
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
  if (a.activo && !confirm(`Apagar "${a.usuario}"?\n\nPierde el acceso al toque, aunque tenga la app abierta.`)) return;
  try { await updateDoc(doc(db, 'accesosBarra', uid), { activo: !a.activo }); }
  catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

function pintarAccesos() {
  const cont = $('#accesos');
  if (!cont) return;
  const alta = `<button class="btn primario ancho-full" id="btnAltaBarra" style="margin-top:.8rem">Crear usuario de barra</button>`;
  if (!estado.accesos.length) {
    cont.innerHTML = `<p style="color:var(--suave);font-size:.9rem;margin:0">
      Todavía no creaste ninguno. El de la barra entra con usuario y contraseña, sin mail.</p>${alta}`;
  } else {
    cont.innerHTML = estado.accesos.map((a) => `
      <div class="item ${a.activo ? '' : 'agotado'}">
        <div class="cuerpo">
          <div class="nombre">${esc(a.usuario)}${a.activo ? '' : ' — <small>apagado</small>'}</div>
          <div class="desc">${a.evento ? esc(a.evento) : 'sin evento'}</div>
        </div>
        <button class="btn ${a.activo ? 'peligro' : 'primario'}" data-acceso="${esc(a.uid)}"
                style="padding:.4rem .7rem;font-size:.82rem">${a.activo ? 'Apagar' : 'Prender'}</button>
      </div>`).join('') + alta;
  }
  $('#btnAltaBarra').onclick = altaUsuarioBarra;
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
      <span class="mesa">${p.mesa ? 'Mesa ' + esc(p.mesa) : 'Sin mesa'}</span>
      ${p.nombreCliente ? `<small style="color:var(--suave)">${esc(p.nombreCliente)}</small>` : ''}
      <span class="reloj ${tarde ? 'tarde' : ''}">${min < 1 ? 'recién' : min + ' min'}</span>
    </div>
    <ul>${(p.items || []).map((i) =>
      `<li><b>${Number(i.cantidad)}×</b> ${esc(i.nombre)}</li>`).join('')}</ul>
    ${p.nota ? `<div class="nota">📝 ${esc(p.nota)}</div>` : ''}
    ${desfasado ? `<div class="sospecha">${aviso}</div>` : ''}
    <div class="pie">
      <span class="total">${plata(desfasado && !intrusos.length ? esperado : p.total)}</span>
      ${col.siguiente ? `<button class="btn primario" data-avanzar="${p.id}" data-a="${col.siguiente}">${col.accion}</button>` : ''}
      ${col.clave !== 'entregado' ? `<button class="btn peligro" data-cancelar="${p.id}" title="Cancelar">✕</button>` : ''}
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
      <button class="btn" data-carta="${i.id}" style="padding:.4rem .7rem;font-size:.82rem">
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
  const vistas = { tablero: '#vistaTablero', carta: '#vistaCartaBar', evento: '#vistaEvento' };
  const tabs = { tablero: '#tabTablero', carta: '#tabCartaBar', evento: '#tabEvento' };
  for (const k of Object.keys(vistas)) {
    $(vistas[k]).hidden = k !== cual;
    $(tabs[k]).setAttribute('aria-selected', String(k === cual));
  }
}
$('#tabTablero').onclick = () => irA('tablero');
$('#tabCartaBar').onclick = () => irA('carta');
$('#tabEvento').onclick = () => irA('evento');

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
