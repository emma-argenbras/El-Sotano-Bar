// Sótano — la campanita: lo que espera a la casa.
//
// Hasta acá, cuando alguien tocaba "Ya transferí" el panel vibraba y, si el
// navegador lo dejaba, mostraba una notificación. Pero una notificación se
// va, y si Carli estaba en otra pestaña no se enteraba hasta entrar a la
// lista de la noche. Esto es lo que queda: un número arriba de la campana
// mientras haya plata por buscar en el banco, y al tocarla, la lista con un
// botón para confirmar cada una sin moverse de donde está.
//
// Dos cosas esperan: entradas de invitados que dijeron que transfirieron y
// pedidos de la carta que dijeron lo mismo. Las dos se confirman acá.
import { $, esc, estado, plata } from './base.js';
import { eventoDePuerta, hora, marcarCobrado } from './invitados.js';
import { avisar, confirmarCobroPedido, quienPidio } from './pedidos.js';
import { QUE_HIZO } from './registro.js';

// ---------- avisarle a la casa ----------
//
// "Le avisa a Carli" sin servidor es esto: el panel ya escucha la lista en
// vivo; cuando aparece un aviso nuevo, el navegador muestra una notificación
// y vibra. Funciona mientras el panel esté abierto —en el celular, instalada,
// también con la pantalla apagada un rato—. Con el panel cerrado no llega
// nada: para eso hace falta un servidor (plan Blaze), y eso es otra decisión.
// Mismo mecanismo que "tu pedido está listo" del lado del cliente (app.js).
export function pedirPermisoAviso() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

export function avisarCasa(titulo, cuerpo, tag) {
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  navigator.serviceWorker?.ready.then((reg) => reg.showNotification(titulo, {
    body: cuerpo, tag, renotify: true, vibrate: [120, 80, 120],
    icon: '/iconos/icono-barra-192.png',
  })).catch(() => {});
}

// ---------- lo que espera ----------

// Las noches que todavía cuentan: la que está en curso y las agendadas de
// hoy en adelante. Una entrada sin confirmar de una noche que ya pasó no es
// plata por buscar: es alguien que no vino. La agenda trae también las
// agendadas vencidas que nadie borró —el Calendario las marca "ya pasó"—,
// así que acá se filtran por fecha, con el mismo criterio.
function nochesVigentes() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vienen = (estado.agenda || [])
    .filter((e) => (e.fecha?.toDate?.() || 0) >= hoy)
    .map((e) => e.id);
  return new Set([estado.evento?.id, ...vienen].filter(Boolean));
}

// Avisó que transfirió, nadie confirmó, y todavía no entró: el que ya está
// adentro pagó en la puerta —en efectivo, o se le confirmó ahí—, así que no
// hay plata por buscar.
export function entradasPorConfirmar() {
  const vigentes = nochesVigentes();
  return (estado.invitadosTodos || [])
    .filter((i) => i.avisoPagoEn && !i.pagadoEn && !i.ingresadoEn && !i.entradaPago
      && vigentes.has(i.eventoId))
    .sort((a, b) => (a.avisoPagoEn?.toMillis?.() || 0) - (b.avisoPagoEn?.toMillis?.() || 0));
}

// Dijo que transfirió y la casa no vio la plata. El entregado no entra —se
// entregó, así que alguien la confirmó o la cobró—. El cancelado sí: si la
// transferencia llegó, hay que devolverla, y si no queda a la vista nadie
// se entera de que hay plata de más en el banco.
export function pedidosPorConfirmar() {
  return (estado.pedidos || [])
    .filter((p) => p.pagoElegido === 'virtual' && p.avisoPagoEn && !p.pago && p.estado !== 'entregado');
}

// ---------- el alias cambió ----------
// Cambiar el alias cambia a quién le llega la plata de toda la noche. Lo
// puede hacer cualquiera que tenga la Caja —así el personal no depende de
// nadie—, pero el dueño se entera: queda en su campanita hasta que lo ve.
// Lo visto se recuerda por teléfono; un cambio propio no se avisa.
const ALIAS_VISTO = 'sotano:alias-visto';
const aliasVisto = () => { try { return Number(localStorage.getItem(ALIAS_VISTO) || 0); } catch { return 0; } };

export function cambioDeAlias() {
  const p = estado.pagos || {};
  const cuando = p.cambiadoEn?.toMillis?.() || 0;
  if (!estado.dueno || !cuando || cuando <= aliasVisto()) return null;
  if (p.cambiadoPor && p.cambiadoPor === estado.usuario) return null;
  return p;
}

// ---------- lo que se corrigió con motivo ----------
// Reabrir una jornada, anular un pedido entregado o borrar un gasto lo hace
// Carli sin el dueño, pero con motivo y registro (ver registro.js). Al dueño
// le queda en la campanita hasta que toca Visto, y le llega un aviso si el
// panel está abierto. Lo propio no se avisa.
const REGISTRO_VISTO = 'sotano:registro-visto';
const registroVisto = () => { try { return Number(localStorage.getItem(REGISTRO_VISTO) || 0); } catch { return 0; } };

export function correccionesNuevas() {
  if (!estado.dueno) return [];
  const desde = registroVisto();
  return (estado.bitacora || []).filter((r) =>
    (r.cuando?.toMillis?.() || 0) > desde && r.quien !== estado.usuario);
}

function queFue(r) {
  const d = r.detalle || {};
  if (r.que === 'anular-pedido') return `${d.a === 'listo' ? 'volvió a Listo' : 'anuló'} el pedido de ${esc(d.quien || '—')} · ${plata(d.total)}`;
  if (r.que === 'borrar-gasto') return `borró el gasto «${esc(d.concepto || '—')}» · ${plata(d.monto)}`;
  if (r.que === 'reabrir-jornada') return `reabrió la jornada del ${esc(d.fecha || '—')}`;
  return esc(QUE_HIZO[r.que] || r.que);
}

let registroAvisado = null;
function avisarCorrecciones() {
  const ahora = correccionesNuevas();
  if (registroAvisado !== null) {
    for (const r of ahora) {
      if (registroAvisado.has(r.id)) continue;
      avisarCasa(`${r.quien} ${QUE_HIZO[r.que] || r.que}`, `Motivo: ${r.motivo}`, 'sotano-registro-' + r.id);
    }
  }
  if (estado.bitacora) registroAvisado = new Set(ahora.map((r) => r.id));
}

function filaRegistro(r) {
  return `<div class="item"><div class="cuerpo">
    <div class="nombre" style="font-size:.88rem">${esc(r.quien)} ${queFue(r)}</div>
    <div class="desc">${r.cuando?.toDate ? r.cuando.toDate().toLocaleString('es-AR',
      { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : ''} · «${esc(r.motivo)}»</div>
  </div></div>`;
}

// ---------- este teléfono ----------
// En qué está el permiso de avisar, y qué hacer en cada caso. El permiso lo
// da el navegador, una vez por teléfono, y solo si se pide desde un toque:
// por eso hay un botón, y no una pregunta que aparece sola.
function pintarTelefono() {
  const cont = $('#avisosTelefono');
  if (!cont) return;
  const soporta = 'Notification' in window && 'serviceWorker' in navigator;
  const permiso = soporta ? Notification.permission : 'no';
  cont.innerHTML = {
    no: `<div class="aviso"><span>📵</span><div><b>Este navegador no muestra avisos.</b><br>
      <small>En iPhone solo funcionan con la app instalada: Compartir → Agregar a
      inicio, y abrila desde el ícono. La campanita igual cuenta todo acá.</small></div></div>`,
    default: `<button class="btn primario ancho-full" id="btnActivarAvisos">🔔 Activar avisos en este teléfono</button>
      <small style="display:block;color:var(--suave);margin-top:.3rem">Te avisa con el panel abierto, aunque
      estés en otra pestaña o con la pantalla apagada un rato.</small>`,
    granted: `<div class="aviso ok"><span>✓</span><div style="flex:1"><b>Avisos activados en este teléfono.</b><br>
      <small>Con el panel cerrado no llegan: dejalo abierto en segundo plano.</small></div>
      <button class="btn" id="btnProbarAviso" style="padding:.35rem .7rem;font-size:.8rem">Probar</button></div>`,
    denied: `<div class="aviso mal"><span>🔕</span><div><b>Este teléfono tiene los avisos bloqueados.</b><br>
      <small>En Chrome: tocá el candado (o ⋮ → Información del sitio) → Permisos →
      Notificaciones → Permitir. Si usás la app instalada: mantené apretado el
      ícono → Información de la app → Notificaciones. Después volvé acá.</small></div></div>`,
  }[permiso] || '';
  const activar = $('#btnActivarAvisos');
  if (activar) activar.onclick = async () => {
    try { await Notification.requestPermission(); } catch {}
    pintarTelefono();
    if (Notification.permission === 'granted') probarAviso();
  };
  const probar = $('#btnProbarAviso');
  if (probar) probar.onclick = probarAviso;
}

function probarAviso() {
  avisarCasa('Prueba de aviso · Sótano',
    'Así te llega cuando alguien dice que transfirió.', 'sotano-prueba');
}

// ---------- la campanita ----------
// Lo último que se dibujó: la lista se vuelve a armar en cada foto de cinco
// escuchas, y si el HTML es el mismo no se toca el DOM —si no, con el
// diálogo abierto, el botón que estabas por tocar desaparece abajo del dedo.
let ultimoAvisos = null;

export function pintarAvisos() {
  const pedidos = pedidosPorConfirmar();
  const entradas = entradasPorConfirmar();
  const alias = cambioDeAlias();
  const correcciones = correccionesNuevas();
  avisarCorrecciones();
  const n = pedidos.length + entradas.length + (alias ? 1 : 0) + correcciones.length;

  const globo = $('#globoAvisos');
  globo.hidden = n === 0;
  globo.textContent = n;
  $('#btnSonido').title = n ? `${n} por confirmar en el banco` : 'Avisos';
  pintarSonido();

  const noche = (id) => estado.registros?.[id]?.nombre || '';
  const deLaPuerta = eventoDePuerta();
  const html = (n ? `
    ${correcciones.length ? `
      <div class="item aviso-pendiente" style="flex-direction:column;align-items:stretch">
        <div class="nombre">📝 Correcciones con motivo</div>
        ${correcciones.map(filaRegistro).join('')}
        <button class="btn" data-registro-visto style="margin-top:.4rem">Visto</button>
      </div>` : ''}
    ${alias ? `
      <div class="item aviso-pendiente">
        <div class="cuerpo">
          <div class="nombre">🏦 Cambió el alias: ahora transfieren a <b>${esc(alias.alias || '(ninguno)')}</b></div>
          <div class="desc">${alias.titular ? esc(alias.titular) + ' · ' : ''}lo cambió ${
            esc(alias.cambiadoPor || '—')} · ${hora(alias.cambiadoEn)}</div>
        </div>
        <button class="btn" data-alias-visto style="padding:.4rem .7rem;font-size:.82rem">Visto</button>
      </div>` : ''}
    ${pedidos.map((p) => {
      const cancelado = p.estado === 'cancelado';
      return `
      <div class="item aviso-pendiente">
        <div class="cuerpo">
          <div class="nombre">🍸 ${esc(quienPidio(p))} dice que transfirió ${plata(p.total)}${
            cancelado ? ' · <b style="color:var(--rojo)">pedido cancelado</b>' : ''}</div>
          <div class="desc">${hora(p.avisoPagoEn)} · ${esc((p.items || [])
            .map((i) => `${Number(i.cantidad)}× ${i.nombre}`).join(', '))} · ${
            cancelado ? 'si la plata llegó, hay que devolverla' : 'revisá el banco'}</div>
        </div>
        <button class="btn ${cancelado ? '' : 'primario'} solo-gerente-inline" data-cobrar-pedido="${esc(p.id)}"
                title="${cancelado ? 'La vi y la resolví: devuelta, o nunca llegó' : 'Confirmar que llegó la transferencia'}"
                style="padding:.4rem .7rem;font-size:.82rem">${cancelado ? 'Resuelto' : 'Cobrado'}</button>
      </div>`;
    }).join('')}
    ${entradas.map((i) => `
      <div class="item aviso-pendiente">
        <div class="cuerpo">
          <div class="nombre">🎟 ${esc(i.nombre)} dice que transfirió la entrada</div>
          <div class="desc">${hora(i.avisoPagoEn)}${
            i.eventoId !== deLaPuerta && noche(i.eventoId) ? ' · ' + esc(noche(i.eventoId)) : ''} · revisá el banco</div>
        </div>
        <button class="btn primario" data-cobrado="${esc(i.id)}"
                style="padding:.4rem .7rem;font-size:.82rem">Cobrado</button>
      </div>`).join('')}`
    : `<div class="vacio">Nada por confirmar.<br>
        <small>Cuando alguien toque "Ya transferí" aparece acá, con un número
        arriba de la campana, hasta que lo confirmes.</small></div>`)
    // El registro entero, para quien puede corregir: lo que se hizo, quién y
    // por qué. No suma al número de la campana: es para consultar.
    + (estado.sadmin && (estado.bitacora || []).length ? `
      <details style="margin-top:.8rem"><summary style="cursor:pointer;color:var(--suave);font-size:.85rem">
        Registro de cambios (${estado.bitacora.length})</summary>
        ${estado.bitacora.map(filaRegistro).join('')}</details>` : '');

  pintarTelefono();
  if (html === ultimoAvisos) return;
  ultimoAvisos = html;
  const cuerpo = $('#cuerpoAvisos');
  cuerpo.innerHTML = html;
  const vistoRegistro = cuerpo.querySelector('[data-registro-visto]');
  if (vistoRegistro) vistoRegistro.onclick = () => {
    const ultimo = Math.max(...(estado.bitacora || []).map((r) => r.cuando?.toMillis?.() || 0), 0);
    try { localStorage.setItem(REGISTRO_VISTO, String(ultimo || Date.now())); } catch {}
    pintarAvisos();
  };
  const visto = cuerpo.querySelector('[data-alias-visto]');
  if (visto) visto.onclick = () => {
    try { localStorage.setItem(ALIAS_VISTO, String(estado.pagos?.cambiadoEn?.toMillis?.() || Date.now())); } catch {}
    pintarAvisos();
  };
  cuerpo.querySelectorAll('[data-cobrar-pedido]').forEach((b) =>
    b.onclick = () => confirmarCobroPedido(b.dataset.cobrarPedido, b));
  cuerpo.querySelectorAll('[data-cobrado]').forEach((b) =>
    b.onclick = () => marcarCobrado(b.dataset.cobrado, b));
}

export function abrirAvisos() {
  pintarAvisos();
  $('#dlgAvisos').showModal();
}

// ---------- el sonido ----------
// El interruptor del beep vive adentro del diálogo. Antes era la campana
// misma, y tocarla para ver qué pasaba la silenciaba sin querer.
export function pintarSonido() {
  $('#iconoCampana').textContent = estado.sonido ? '🔔' : '🔕';
  $('#btnSonidoToggle').textContent = estado.sonido
    ? '🔔 Suena cuando entra un pedido · tocá para silenciar'
    : '🔕 Silenciado · tocá para que suene';
}

$('#btnSonido').onclick = abrirAvisos;
$('#btnCerrarAvisos').onclick = () => $('#dlgAvisos').close();
$('#btnSonidoToggle').onclick = () => {
  estado.sonido = !estado.sonido;
  localStorage.setItem('sotano:sonido', estado.sonido ? 'si' : 'no');
  pintarSonido();
  if (estado.sonido) avisar();   // también desbloquea el audio en móviles
};
