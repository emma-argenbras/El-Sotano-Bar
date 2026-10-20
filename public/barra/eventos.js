import {
  Timestamp,
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '/vendor/firebase.js';
import { pintarAdminEntradas } from './administracion.js';
import { pintarUsuarios } from './usuarios.js';
import { $, esc, estado, plata } from './base.js';
import { dondeRepartir } from '/corte.js';
import { irA } from './pantallas.js';
import { ESTADO_LOCAL, EVENTOS, TURNO, app, db, fallo } from './conexion.js';
import { bloqueClub, engancharClub, engancharPliegues, enganchatNoches, filaNoche, hora, pintarPuerta, plegable } from './invitados.js';
import { escucharPedidos, pintarCaja, ticket } from './pedidos.js';
import { pintarCierre } from './cierre.js';

export async function marcarTurno(eventoId, barmanes) {
  await setDoc(TURNO(), { eventoId, barmanes, cambiadoEn: serverTimestamp() });
}

export async function marcarTomandoPedidos(valor, evento) {
  await setDoc(ESTADO_LOCAL(), {
    tomandoPedidos: valor,
    evento: valor ? (evento?.nombre ?? null) : null,
    eventoId: valor ? (evento?.id ?? null) : null,
    cambiadoEn: serverTimestamp(),
  });
}


export function escucharEvento() {
  // La agenda: lo que viene, por fecha. El registro de invitados puede estar
  // abierto para una noche agendada sin que la noche haya empezado.
  onSnapshot(query(EVENTOS(), where('estado', '==', 'agendado'), orderBy('fecha', 'asc')), (snap) => {
    estado.agenda = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarEvento(); pintarCalendario(); pintarAdminEntradas();
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
    // Y el cierre de la jornada, que avisa si hay una noche todavía abierta.
    // Es la quinta vez que una pantalla depende de un dato y nadie la vuelve
    // a dibujar cuando ese dato llega: el cartel no aparecía nunca.
    pintarCierre();
    // Las entradas de Administración y la pantalla de Usuarios también miran
    // cuál es la noche abierta: una para cobrar, la otra para el turno.
    pintarAdminEntradas();
    pintarUsuarios();
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
    // El precio de la entrada vive acá: Administración lo lee para cobrarla.
    pintarAdminEntradas();
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

// Desde cuándo mira el tablero: el arranque del evento abierto, o el día de hoy.
export function desdeCuando() {
  const abierto = estado.evento?.abiertoEn?.toDate?.();
  if (abierto) return abierto;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return hoy;
}

export function abrirEvento(editando = null, cuando = null) {
  estado.editandoEvento = editando;
  const d = editando ? editando.fecha?.toDate?.() : (cuando || new Date());
  const etiqueta = (d || new Date()).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' });
  $('#inpEvento').value = editando?.nombre || (etiqueta[0].toUpperCase() + etiqueta.slice(1));
  $('#inpFecha').value = (d || new Date()).toISOString().slice(0, 10);
  $('#inpCapacidad').value = editando?.capacidad || '';
  $('#inpEntrada').value = editando?.entrada || '';
  $('#tituloEvento').textContent = editando ? 'Editar la noche' : 'Agendar una noche';
  $('#btnConfirmarEvento').textContent = editando ? 'Guardar' : 'Agendar';
  // Acá sí se agenda: los campos que «Quién está de turno» esconde vuelven,
  // por si esa pantalla se cerró de una manera que no los devolvió.
  [$('#inpFecha'), $('#inpCapacidad'), $('#inpEntrada')]
    .forEach((e) => e?.closest('.campo')?.classList.remove('oculto'));
  $('#inpEvento').disabled = false;
  pintarElegirBarman(editando?.barmanes || []);
  $('#dlgEvento').showModal();
  $('#inpEvento').focus();
}

export function pintarElegirBarman(marcados = []) {
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

export const barmanMarcados = () =>
  [...document.querySelectorAll('#elegirBarman input:checked')].map((i) => i.value);
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
export async function apuntarLinkViejo() {
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
export async function empezarNoche(ev) {
  // Dos noches abiertas a la vez no es un desorden visual: la caja de cada
  // venta se sella con el id de la noche en curso, y con dos abiertas lo que
  // se vende hoy puede entrar en la caja de anteayer. La asistencia sale del
  // mismo lado y muestra la de la otra. Eso no se avisa, se frena.
  // La noche abierta vive en estado.evento, en singular: estado.eventos son
  // las CERRADAS del historico. Mirar la lista equivocada hacia que el freno
  // no frenara nunca, que es como no tenerlo.
  const abierta = estado.evento && estado.evento.id !== ev.id ? estado.evento : null;
  if (abierta) {
    alert(`No se puede arrancar "${ev.nombre}": "${abierta.nombre}" sigue abierta.\n\n`
      + 'Con dos noches abiertas, lo que se venda hoy puede entrar en la caja de '
      + 'la otra, y la asistencia que se muestra es la de ella.\n\n'
      + `Cerrala primero: Noche → Terminar la noche.`);
    return;
  }
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

export async function borrarAgendado(ev) {
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
export const LINK_REGISTRO = (ev) =>
  `${dondeRepartir(location.origin)}/registro.html?ev=${encodeURIComponent(ev)}`;

// Un QR por noche, guardado para no rearmarlo en cada repintada.
export const qrsGuardados = {};
// El coquito va en el medio, igual que el de la carta. Nivel H de corrección:
// por eso el logo tapando el centro no lo rompe.
export async function qrRegistro(ev) {
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

export function abrirInvitar(ev) {
  if (!ev) return;
  estado.invitandoA = ev;
  $('#tituloInvitar').textContent = `Invitaciones · ${ev.nombre}`;
  $('#cuerpoInvitar').innerHTML = '<div class="cargando">Armando el QR…</div>';
  $('#dlgInvitar').showModal();
  pintarInvitar();
}

export async function pintarInvitar() {
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
export async function abrirCerrarRegistro(ev, estaAbierto, boton) {
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
export async function compartirRegistro(ev, boton) {
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
export async function editarTurno() {
  pintarElegirBarman(estado.evento?.barmanes || []);
  $('#inpEvento').value = estado.evento.nombre;
  $('#inpEvento').disabled = true;
  $('#btnConfirmarEvento').textContent = 'Guardar';
  // Esta pantalla es la de agendar una noche, prestada. Decía «Agendar una
  // noche» y mostraba fecha, capacidad y entrada en blanco sobre una noche
  // que tiene cupo 50: nadie puede saber, mirando eso, que tocar Guardar no
  // le va a pisar el cupo. No se lo pisa —acá solo se escriben los barmanes—
  // pero una pantalla que no se puede creer frena a quien la usa igual que
  // una que rompe. Se muestra solo lo que esta pantalla sí cambia.
  $('#tituloEvento').textContent = 'Quién está de turno';
  const prestados = [$('#inpFecha'), $('#inpCapacidad'), $('#inpEntrada')]
    .map((e) => e?.closest('.campo')).filter(Boolean);
  prestados.forEach((c) => c.classList.add('oculto'));
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
    $('#tituloEvento').textContent = 'Agendar una noche';
    prestados.forEach((c) => c.classList.remove('oculto'));
  }, { once: true });
  dlg.showModal();
}

// El cierre guarda los números calculados, no una referencia a los pedidos:
// el tablero solo carga el evento en curso, así que el histórico tiene que
// poder leerse sin volver a buscar nada.
export function resumirCaja(pedidos) {
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

export async function cerrarEvento() {
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

export function pintarEvento() {
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
              style="margin-top:1rem">Terminar la noche</button>
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

export function pintarEventosPasados() {
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
export const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const mismaFecha = (a, b) => a && b && a.toDateString() === b.toDateString();

// Todo lo que el panel tiene cargado, en una sola lista para el mes.
export function noches() {
  const abierto = estado.evento ? [{ ...estado.evento, estado: 'abierto' }] : [];
  return [...estado.agenda, ...abierto, ...estado.eventos]
    .filter((e) => e.fecha?.toDate)
    .map((e) => ({ ...e, _f: e.fecha.toDate() }));
}

export function pintarCalendario() {
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
