import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '/vendor/firebase.js';
import { claveAnotado, digitosTel, porQueNoVale, telValido } from '/tel.js';
import { $, esc, estado, plata } from './base.js';
import { dondeRepartir } from '/corte.js';
import { app, db, fallo } from './conexion.js';
import { abrirEvento, abrirInvitar, borrarAgendado, empezarNoche, noches, pintarCalendario, pintarEvento, pintarInvitar } from './eventos.js';
import { quienAtiende } from './pedidos.js';

// ---------- Sótano Club ----------
// No hay una base de clientes aparte: anotarse a una noche YA es el alta. La
// gente de Sótano Club son los invitados de todas las noches, juntados por teléfono
// —que es el único dato que no se repite— y no por nombre, que cada uno
// escribe distinto cada vez.
//
// Que no exista una colección nueva no es pereza: cada lugar donde se guarda
// un teléfono es un lugar más que proteger, y este ya está protegido.
export function genteDelClub() {
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

export function bloqueClub() {
  const todos = genteDelClub();
  // Cuántos invitados tiene cargados el panel AHORA. Va solo en los dos
  // casos raros —contadores que suman con la lista vacia, y anotados sin
  // telefono—, que es cuando hace falta poder discutirle al cartel. En el
  // caso benigno, con el bar recien abierto y nadie anotado todavia, el
  // numero es ruido.
  const cargados = (estado.invitadosTodos || []).length;
  if (!todos.length) {
    // "No se anotó nadie" con la lista llena es mentira, y manda a buscar un
    // problema que no existe. El Club junta por teléfono —es el único dato
    // que no se repite—, así que el que se anotó sin teléfono no entra. Eso
    // hay que decirlo, no esconderlo detrás de un cero.
    const sinTel = (estado.invitadosTodos || [])
      .filter((i) => !digitosTel(i.telefono || '')).length;

    // El caso grave: los contadores de cada noche dicen que hay anotados pero
    // no hay un solo invitado guardado. Entonces la puerta no tiene contra
    // qué chequear a nadie, y eso no se puede descubrir con la cola afuera.
    const contados = Object.values(estado.registros || {})
      .reduce((a, r) => a + Number(r?.registrados || 0), 0);
    if (estado.invitadosListos && !(estado.invitadosTodos || []).length && contados > 0) {
      return `<div class="grupo-personal">Sótano Club</div>
        <div class="aviso mal" style="margin:0"><span>⛔</span><div>
          <b>Los contadores dicen ${contados} anotados y no hay ninguno guardado.</b>
          El número de cada noche es un contador aparte; los nombres viven en
          otro lado y acá no llegó ninguno. Si esto sigue así, <b>la puerta no
          tiene lista contra qué chequear</b>.
          <br><small>El panel tiene ${cargados} invitados cargados.
          Mirá la pestaña Puerta: si tampoco muestra nombres, es eso. Si los
          muestra, lo que falla es este bloque.</small></div></div>`;
    }

    return `<div class="grupo-personal">Sótano Club</div>
      <p style="color:var(--suave);font-size:.9rem;margin:0">${sinTel ? `
        Hay <b>${sinTel}</b> anotado${sinTel === 1 ? '' : 's'}, pero
        ${sinTel === 1 ? 'no dejó' : 'ninguno dejó'} teléfono. El Club junta por
        teléfono, que es el único dato que no se repite: el que se anota por el
        QR siempre lo deja, y el que cargás a mano desde el panel, solo si se lo
        ponés. <small>(${cargados} cargados, ${sinTel} sin teléfono.)</small>`
      : `Todavía no se anotó nadie. Cada persona que se anota a una noche entra
        acá sola.`}</p>`;
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

export function engancharClub(cont) {
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

export function filaNoche(e, hoy) {
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

export function enganchatNoches(cont, hoy) {
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
export function eventoDePuerta() {
  if (estado.evento?.id) return estado.evento.id;
  const proxima = [...(estado.agenda || [])]
    .filter((e) => Number(e.capacidad || 0) > 0)
    .sort((a, b) => (a.fecha?.toMillis?.() || 0) - (b.fecha?.toMillis?.() || 0))[0];
  return proxima?.id || estado.registro?.eventoId || '';
}

// La lista de ESTA noche, sacada de la lista entera. Es una cuenta derivada:
// depende de los invitados Y de cuál es la noche abierta, así que hay que
// rehacerla cuando cambia cualquiera de las dos cosas. Antes se hacía solo
// cuando llegaban invitados: si la noche arrancaba después, la lista se
// quedaba filtrada por la noche anterior, y la Noche mostraba "0 de 45
// anotados · 3 adentro" —los tres eran del Cumple de la semana pasada—
// hasta que alguien se anotara y la lista se volviera a filtrar.
export function filtrarInvitados() {
  const noche = eventoDePuerta();
  estado.invitados = (estado.invitadosTodos || [])
    .filter((i) => !noche || i.eventoId === noche)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
}

export function escucharInvitados() {
  onSnapshot(collection(db, 'invitados'), (snap) => {
    estado.invitadosTodos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.invitadosListos = true;
    filtrarInvitados();
    pintarPuerta();
    pintarInvitar();   // si está abierto el diálogo de una noche, su lista también
    // Y el calendario, que es donde vive el bloque del Club. Faltaba: el
    // calendario lo pintan los listeners de noches y registros, que llegan
    // antes, asi que el Club se dibujaba con la lista todavia vacia y se
    // quedaba con esa foto para siempre. Invitaciones, que si se repinta,
    // mostraba los 18 al lado de un Club que decia que no habia nadie.
    pintarCalendario();
    // Y la Noche, que cuenta cuántos se anotaron y cuántos entraron. Mismo
    // caso que el Club: la dibujan escuchas que llegan antes que la lista.
    pintarEvento();
  }, (e) => {
    if (e.code === 'permission-denied') { estado.invitados = []; pintarPuerta(); return; }
    fallo('#puerta')(e);
  });
}

// Token igual que el del registro por link: es la llave del pase.
export function tokenInvitado() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

export function abrirAltaInvitado() {
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
  // El de último momento es, casi siempre, el que paga en la puerta: se le
  // pregunta antes de anotarlo, así entra y paga en la misma escritura.
  let cobro = null;
  if (entra && precioEntrada()) {
    cobro = await pedirFormaDeEntrada(nombre, precioEntrada());
    if (!cobro) return;
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
      ...(cobro ? {
        entradaEn: serverTimestamp(),
        entradaPor: quienAtiende() || estado.usuario || 'casa',
        entradaPago: cobro.pago,
        entradaMonto: cobro.monto,
      } : {}),
    });
    // El contador también, para que el cupo siga cuadrando. Lo suma el
    // servidor, no la pantalla: dos personas anotando a la vez leían las dos
    // el mismo número y escribían el mismo, y el contador quedaba uno abajo
    // de la gente que hay. Uno abajo en el contador es un lugar de más que la
    // página de inscripción le da a cualquiera.
    //
    // Y si no se puede escribir, se dice. Tragarse el error dejaba al
    // invitado anotado con el cupo corrido y nadie se enteraba.
    if (estado.registros[evento]) {
      try {
        await updateDoc(doc(db, 'registros', evento), { registrados: increment(1) });
      } catch (err) {
        alert(`${nombre} quedó anotado, pero no se pudo mover el contador del cupo`
          + ` (${err.code || err.message}).\n\n`
          + 'Avisale a la casa: hasta que se corrija, la página de inscripción '
          + 'cree que queda un lugar más del que hay.');
      }
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
export async function mostrarPaseNuevo(id, nombre) {
  const url = `${dondeRepartir(location.origin)}/pase.html?i=${encodeURIComponent(id)}`;
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

// Lo que sale la entrada de esta noche. Cero es noche libre.
export const precioEntrada = () =>
  Number(estado.registros[eventoDePuerta()]?.entrada || 0);

// Cómo paga cada uno. "cortesía" es una entrada regalada: entra igual y no
// deja plata, pero queda anotada —el cierre las cuenta aparte, porque una
// noche con veinte cortesías no es una noche floja, es otra cosa.
export const FORMAS_ENTRADA = [
  ['efectivo', '💵', 'Efectivo', 'Va al cajón.'],
  ['virtual', '📲', 'Transferencia', 'No va al cajón.'],
  ['cortesia', '🎟', 'Cortesía', 'Entra sin pagar.'],
];

// Marca que entró y, si la noche cobra entrada, con qué pagó.
//
// Las dos cosas en la misma escritura. Separarlas dejaba el hueco de siempre:
// alguien entra, el cobro se escribe después y en el medio se corta la señal
// —y el cierre termina con una persona adentro que no pagó nada.
//
// Esto es lo que hace que el cierre pueda comparar el cajón contra algo. Sin
// esto, la plata de la puerta no existía en ninguna parte: la entrada era un
// precio guardado en el evento y nada más.
export async function marcarIngreso(id, entra, cobro) {
  try {
    await updateDoc(doc(db, 'invitados', id), {
      ingresadoEn: entra ? serverTimestamp() : null,
      ingresadoPor: entra ? (estado.usuario || 'casa') : null,
      // Deshacer limpia el cobro también: si no entró, no pagó entrada.
      entradaEn: entra && cobro ? serverTimestamp() : null,
      entradaPor: entra && cobro ? (quienAtiende() || estado.usuario || 'casa') : null,
      entradaPago: entra && cobro ? cobro.pago : null,
      entradaMonto: entra && cobro ? Number(cobro.monto || 0) : null,
    });
    if (navigator.vibrate) navigator.vibrate(entra ? [60, 50, 60] : 30);
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// El paso de la puerta: entra, y antes se dice cómo paga.
//
// No pregunta cuando no hay nada que preguntar —noche sin entrada, o el que
// ya transfirió y la casa se lo confirmó—; en la puerta hay fila, y un
// diálogo de más por persona es un diálogo de más cien veces por noche.
//
// Devuelve { pago, monto }, o null si la puerta se arrepintió: ahí no entra
// nadie y no se escribe nada.
export function pedirFormaDeEntrada(nombre, precio) {
  return new Promise((listo) => {
    const dlg = $('#dlgEntrada');
    let resuelto = false;
    const terminar = (r) => {
      if (resuelto) return;
      resuelto = true;
      dlg.oncancel = null; dlg.onclose = null;
      dlg.close();
      listo(r);
    };

    $('#cuerpoEntrada').innerHTML = `
      <p style="margin:.2rem 0 1rem">
        <b style="font-size:1.1rem">${esc(nombre)}</b><br>
        <span style="color:var(--suave)">Entrada ${plata(precio)}</span></p>
      ${FORMAS_ENTRADA.map(([clave, icono, titulo, pie]) => `
        <button class="btn ancho-full" data-forma="${clave}"
                style="margin-bottom:.5rem;text-align:left;padding:.8rem .9rem">
          <b>${icono} ${titulo}</b>
          <span style="display:block;font-weight:400;font-size:.8rem;color:var(--suave)">
            ${clave === 'cortesia' ? pie : plata(precio) + ' · ' + pie}</span>
        </button>`).join('')}`;

    $('#cuerpoEntrada').querySelectorAll('[data-forma]').forEach((b) => b.onclick = () => {
      const pago = b.dataset.forma;
      if (pago === 'cortesia'
        && !confirm(`¿${nombre} entra de cortesía?\n\nNo paga entrada y queda anotado así.`)) return;
      terminar({ pago, monto: pago === 'cortesia' ? 0 : precio });
    });

    // Volver, Escape o cerrar el diálogo de cualquier otra forma: no entra.
    // Que se cierre solo y la persona quede adentro sin pagar es justo el
    // agujero que esto viene a tapar.
    dlg.oncancel = () => terminar(null);
    dlg.onclose = () => terminar(null);
    dlg.showModal();
  });
}

// Cobra y marca el ingreso. Devuelve true si entró.
export async function cobrarYEntrar(inv) {
  const precio = precioEntrada();
  if (!precio) { await marcarIngreso(inv.id, true); return true; }

  // Ya pagó por transferencia y alguien de la barra lo confirmó: no se le
  // cobra de nuevo, pero la entrada queda contada como virtual.
  if (inv.pago === 'virtual' && inv.pagadoEn) {
    await marcarIngreso(inv.id, true, { pago: 'virtual', monto: precio });
    return true;
  }

  const cobro = await pedirFormaDeEntrada(inv.nombre, precio);
  if (!cobro) return false;
  await marcarIngreso(inv.id, true, cobro);
  return true;
}

// ---------- lector de QR con la cámara ----------
export let camara = null;
export let leyendo = false;

export async function abrirCamara() {
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

export function cerrarCamara() {
  leyendo = false;
  camara?.getTracks().forEach((t) => t.stop());
  camara = null;
  const v = $('#visor');
  if (v) v.srcObject = null;
}

export function resolverEscaneo(texto) {
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
    // "Adelante" recién después de cobrar: si la puerta se arrepiente a mitad
    // de camino, el cartel no puede estar diciendo que ya pasó.
    cobrarYEntrar(inv).then((entro) => {
      caja.innerHTML = entro
        // El teléfono que dejó al anotarse: sirve para chequear que el que
        // muestra el QR es el que se registró, pidiéndole los últimos números.
        ? `<div class="aviso ok"><span>✓</span><div>
            <b>Adelante, ${esc(inv.nombre)}.</b><br>
            Se anotó con el <b>${esc(inv.telefono || 'sin teléfono')}</b>.</div></div>`
        : `<div class="aviso"><span>↩</span><div>
            <b>${esc(inv.nombre)} no entró.</b><br>
            No se cobró la entrada. Escaneá de nuevo cuando esté.</div></div>`;
      seguirEscaneando(caja);
    });
    return;
  }
  seguirEscaneando(caja);
}

function seguirEscaneando(caja) {
  caja.innerHTML += '<button class="btn primario ancho-full" id="btnSeguir" style="margin-top:.7rem">Escanear el siguiente</button>';
  $('#btnSeguir').onclick = () => { $('#escaneo').innerHTML = ''; abrirCamara(); };
}

// ---------- la lista de invitados, plegada ----------
// Con sesenta anotados una lista plana no se puede usar en un celular: se
// scrollea para siempre. Van en grupos que se abren y se cierran, y cada uno
// muestra los primeros y el resto a pedido.
export const TOPE_LISTA = 20;

// Con qué pagó la entrada, para que se vea en la lista. La cortesía se
// marca distinto a propósito: es la única que entra sin dejar plata, y al
// cierre hay que poder contarlas de un vistazo.
export function comoEntro(i) {
  if (!i.entradaPago) return '';
  if (i.entradaPago === 'cortesia') return ' · <b style="color:var(--oro)">🎟 cortesía</b>';
  return ` · ${i.entradaPago === 'efectivo' ? '💵' : '📲'} entrada ${plata(i.entradaMonto || 0)}`;
}

export function renglonInvitado(i, conBoton) {
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
        comoEntro(i)}${
        gastó ? ' · consumió ' + plata(gastó) : ''}${
        // Quien dijo que transfiere no tiene QR hasta que alguien confirme que
        // la plata llegó. Hasta entonces ocupa un lugar sin haber pagado.
        // Si tocó "Ya transferí", acá dice a qué hora: es a quién buscar en el
        // banco. Sin el aviso, "esperando pago" a secas.
        esperaPago ? (i.avisoPagoEn
          ? ` · <b style="color:var(--oro)">dice que transfirió ${hora(i.avisoPagoEn)}</b> · revisá el banco`
          : ` · <b style="color:var(--naranja)">esperando pago${
              dias ? ' · hace ' + dias + (dias === 1 ? ' día' : ' días') : ''}</b>`) : ''}${
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

export function plegable(clave, titulo, gente, { abierto = false, conBoton = false } = {}) {
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
export async function sacarInvitado(inv) {
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

    // Igual que al anotar: la resta la hace el servidor. Leer y escribir desde
    // la pantalla perdía una de cada dos cuando se sacaba a dos a la vez.
    if (estado.registros[inv.eventoId]) {
      await updateDoc(doc(db, 'registros', inv.eventoId), { registrados: increment(-1) });
    }
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// Confirmar que la transferencia llegó. Lo hace una persona mirando el banco:
// una transferencia a un alias no le avisa a la app, no hay nada que escuchar.
//
// Apenas se escribe, el pase del invitado lo ve —está escuchando su documento—
// y su QR aparece solo, sin que tenga que recargar ni volver a buscar el link.
export async function marcarCobrado(id, boton) {
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

export function engancharPliegues(cont) {
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

export function pintarPuerta() {
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
    // Entrar puede costar plata; deshacer nunca.
    if (i.ingresadoEn) marcarIngreso(i.id, false); else cobrarYEntrar(i);
  });
  engancharPliegues(cont);
}

// Lo que lleva gastado un invitado: la suma de sus pedidos entregados. Sale
// de los pedidos que ya tiene cargados el tablero, sin leer nada de más.
export function consumoDe(id) {
  return estado.pedidos
    .filter((p) => p.invitadoId === id && p.estado === 'entregado')
    .reduce((s, p) => s + Number(p.total || 0), 0);
}

export const hora = (t) => (t?.toDate ? t.toDate().toLocaleTimeString('es-AR',
  { hour: '2-digit', minute: '2-digit' }) : '');
