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

// Las noches que todavía cuentan: la que está en curso y las agendadas. Una
// entrada sin confirmar de una noche que ya pasó no es plata por buscar: es
// alguien que no vino.
function nochesVigentes() {
  return new Set([estado.evento?.id, ...(estado.agenda || []).map((e) => e.id)].filter(Boolean));
}

export function entradasPorConfirmar() {
  const vigentes = nochesVigentes();
  return (estado.invitadosTodos || [])
    .filter((i) => i.avisoPagoEn && !i.pagadoEn && vigentes.has(i.eventoId))
    .sort((a, b) => (a.avisoPagoEn?.toMillis?.() || 0) - (b.avisoPagoEn?.toMillis?.() || 0));
}

export function pedidosPorConfirmar() {
  return (estado.pedidos || [])
    .filter((p) => p.pagoElegido === 'virtual' && p.avisoPagoEn && !p.pago
      && !['entregado', 'cancelado'].includes(p.estado));
}

// ---------- la campanita ----------
export function pintarAvisos() {
  const pedidos = pedidosPorConfirmar();
  const entradas = entradasPorConfirmar();
  const n = pedidos.length + entradas.length;

  const globo = $('#globoAvisos');
  globo.hidden = n === 0;
  globo.textContent = n;
  $('#btnSonido').title = n ? `${n} por confirmar en el banco` : 'Avisos';
  pintarSonido();

  // La lista se redibuja aunque el diálogo esté cerrado: es barata, y así al
  // abrirlo ya está, y si está abierto cambia sola cuando alguien confirma.
  const noche = (id) => estado.registros?.[id]?.nombre || '';
  const deLaPuerta = eventoDePuerta();
  $('#cuerpoAvisos').innerHTML = n ? `
    ${pedidos.map((p) => `
      <div class="item aviso-pendiente">
        <div class="cuerpo">
          <div class="nombre">🍸 ${esc(quienPidio(p))} dice que transfirió ${plata(p.total)}</div>
          <div class="desc">${hora(p.avisoPagoEn)} · ${esc((p.items || [])
            .map((i) => `${Number(i.cantidad)}× ${i.nombre}`).join(', '))} · revisá el banco</div>
        </div>
        <button class="btn primario solo-gerente-inline" data-cobrar-pedido="${esc(p.id)}"
                style="padding:.4rem .7rem;font-size:.82rem">Cobrado</button>
      </div>`).join('')}
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
        arriba de la campana, hasta que lo confirmes.</small></div>`;

  $('#cuerpoAvisos').querySelectorAll('[data-cobrar-pedido]').forEach((b) =>
    b.onclick = () => confirmarCobroPedido(b.dataset.cobrarPedido, b));
  $('#cuerpoAvisos').querySelectorAll('[data-cobrado]').forEach((b) =>
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
