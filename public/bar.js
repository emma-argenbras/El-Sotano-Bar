// Sótano — panel de barra. Tablero en vivo, cambio de estado y control de stock.
//
// Esto es el arranque y nada más: trae los módulos de barra/, engancha los
// botones que cruzan pantallas y prende el service worker. Cada módulo se
// ocupa de lo suyo y no hace nada al importarse salvo quedar listo.
import { irA } from './barra/pantallas.js';
import { guardarAlDia, guardarEgreso, pintarAdmin } from './barra/administracion.js';
import { $, estado } from './barra/base.js';
import { abrirConteo, abrirNuevoProducto, guardarNuevoProducto, guardarReceta } from './barra/carta.js';
import { abrirCartaDeFecha } from './barra/cartas.js';
import './barra/cierre.js';
import { pedirPermisoAviso } from './barra/invitados.js';
import { guardarInsumo, guardarPrecios, guardarStock, pintarDeposito } from './barra/deposito.js';
import { abrirVenta, cancelarCobro, cerrarCobro, elegirQuienAtiende, pintarTablero } from './barra/pedidos.js';
import { crearPersona, limpiarUsuario, pintarUsuarios, pistaPersona } from './barra/usuarios.js';
import './barra/login.js';
import './barra/invitados.js';
import './barra/eventos.js';


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
$('#btnCartaFecha').onclick = abrirCartaDeFecha;
$('#btnNuevoProducto').onclick = abrirNuevoProducto;
$('#btnGuardarProducto').onclick = guardarNuevoProducto;
$('#btnCancelarProducto').onclick = () => $('#dlgNuevoProducto').close();
$('#btnCerrarCartaFecha').onclick = () => $('#dlgCartaFecha').close();
$('#btnCancelarCierre').onclick = () => $('#dlgCerrarJornada').close();
$('#btnCancelarCierreBarra').onclick = () => $('#dlgCerrarBarra').close();
// El permiso para avisar se pide con el primer toque en el panel: los
// navegadores lo exigen desde un gesto, y acá hay uno seguro.
document.querySelector('.tabs')?.addEventListener('click', pedirPermisoAviso, { once: true });
$('#btnCancelarInsumo').onclick = () => $('#dlgInsumo').close();
$('#btnGuardarInsumo').onclick = guardarInsumo;
$('#btnCancelarStock').onclick = () => $('#dlgStock').close();
$('#btnGuardarStock').onclick = guardarStock;
$('#btnCancelarPrecios').onclick = () => $('#dlgPrecios').close();
$('#btnGuardarPrecios').onclick = guardarPrecios;
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
$('#btnCancelarCobro').onclick = cancelarCobro;
$('#btnCancelarVenta').onclick = () => $('#dlgVenta').close();
$('#btnCancelarEntrada').onclick = () => $('#dlgEntrada').close();
$('#btnCancelarEgreso').onclick = () => $('#dlgEgreso').close();
$('#btnCancelarAlDia').onclick = () => $('#dlgAlDia').close();
$('#btnGuardarAlDia').onclick = guardarAlDia;
$('#btnGuardarEgreso').onclick = guardarEgreso;

$('#tabTablero').onclick = () => irA('tablero');
$('#tabCartaBar').onclick = () => irA('carta');
$('#tabEvento').onclick = () => irA('evento');
$('#tabCaja').onclick = () => { irA('caja'); pintarAdmin(); };
$('#tabDeposito').onclick = () => { irA('deposito'); pintarDeposito(); };
$('#tabCalendario').onclick = () => irA('calendario');
$('#tabPuerta').onclick = () => irA('puerta');
$('#tabUsuarios').onclick = () => { irA('usuarios'); pintarUsuarios(); };

// Los relojes de los tickets tienen que correr aunque no entre nada nuevo.
setInterval(() => { if (!$('#vistaPanel').hidden && !$('#vistaTablero').hidden) pintarTablero(); }, 30_000);

// ---------- service worker ----------
// Hace falta para que el navegador ofrezca instalar, y para que el tablero
// abra aunque la señal se corte. Antes solo lo registraba la carta: quien
// entraba derecho a /bar.html se quedaba sin las dos cosas.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
