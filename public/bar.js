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

const estado = { pedidos: [], carta: [], evento: null, eventos: [], accesos: [], dueno: false, rol: '', ordenCaja: 'fecha', detalleEvento: null, tomandoPedidos: true, desdeCache: false, usuario: '', sonido: localStorage.getItem('sotano:sonido') !== 'no', vistos: new Set() };

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

function abrirEvento() {
  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' });
  $('#inpEvento').value = hoy[0].toUpperCase() + hoy.slice(1);
  pintarElegirBarman();
  $('#dlgEvento').showModal();
  $('#inpEvento').focus();
}

function pintarElegirBarman(marcados = []) {
  const barmanes = estado.accesos.filter((a) => a.rol !== 'admin' && a.activo);
  $('#elegirBarman').innerHTML = barmanes.length
    ? barmanes.map((b) => `<label><input type="checkbox" value="${esc(b.uid)}"
        ${marcados.includes(b.uid) ? 'checked' : ''}> ${esc(b.usuario)}</label>`).join('')
    : `<div class="vacio">Todavía no registraste ningún barman. Podés abrir el evento
       igual y asignarlos después.</div>`;
}

const barmanMarcados = () =>
  [...document.querySelectorAll('#elegirBarman input:checked')].map((i) => i.value);

$('#btnCancelarEvento').onclick = () => $('#dlgEvento').close();
$('#btnConfirmarEvento').onclick = async () => {
  const nombre = $('#inpEvento').value.trim();
  if (!nombre) { $('#inpEvento').focus(); return; }
  const elegidos = barmanMarcados();
  try {
    const ref = await addDoc(EVENTOS(), {
      nombre, abiertoEn: serverTimestamp(), cerradoEn: null, cierre: null, barmanes: elegidos,
    });
    await marcarTurno(ref.id, elegidos);
    await marcarTomandoPedidos(true, { id: ref.id, nombre });
    $('#dlgEvento').close();
  } catch (e) { alert('No se pudo abrir: ' + (e.code || e.message)); }
};

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
  try {
    await updateDoc(doc(db, 'barra', 'eventos', 'items', estado.evento.id),
      { cerradoEn: serverTimestamp(), cierre: r });
    await marcarTurno(null, []);
    await marcarTomandoPedidos(false);
  } catch (e) { alert('No se pudo cerrar: ' + (e.code || e.message)); }
}

function pintarEvento() {
  const cont = $('#evento');
  if (!estado.evento) {
    // La barra no puede abrir un evento: decirle qué pasa, no dejarla mirando
    // una tarjeta vacía con botones que no existen.
    if (!estado.dueno && estado.rol !== 'admin') {
      cont.innerHTML = `<div class="aviso"><span>🎪</span><div>
        <b>No hay ningún evento abierto.</b><br>
        ${estado.tomandoPedidos
          ? 'Igual se están tomando pedidos: lo que entre lo vas a ver en Pedidos.'
          : 'Y no se están tomando pedidos. Avisale a quien maneja la caja.'}
        </div></div>`;
      return;
    }
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
        <button class="btn ${estado.tomandoPedidos ? 'peligro' : 'primario'} solo-gerente-inline" id="btnTomando">
          ${estado.tomandoPedidos ? 'Cortar' : 'Reabrir'}
        </button>
      </div>
      <button class="btn primario ancho-full solo-gerente-inline" id="btnAbrirEvento"
              style="margin-top:.9rem">Abrir evento</button>`;
    if ($('#btnAbrirEvento')) $('#btnAbrirEvento').onclick = abrirEvento;
    if ($('#btnTomando')) $('#btnTomando').onclick = async () => {
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
  const que = rol === 'admin' ? 'administrador' : 'barman';
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
      + (rol === 'barman'
        ? 'Para que entre, asignalo al evento desde "De turno".\n\n'
        : '')
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
  const barmanes = estado.accesos.filter((a) => a.rol !== 'admin');

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
    <button class="btn primario ancho-full" id="btnAltaBarman" style="margin-top:.6rem">Registrar barman</button>`;

  $('#btnAltaAdmin').onclick = () => altaPersona('admin');
  $('#btnAltaBarman').onclick = () => altaPersona('barman');
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
