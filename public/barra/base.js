// Sótano — lo que usa todo el panel: el estado en memoria, los atajos al DOM
// y las constantes. No importa nada, así siempre se inicializa primero y
// ningún otro módulo se encuentra con una variable a medio hacer.

// Las cuentas del turno no tienen mail: el usuario escribe "barra-lunes" y
// por detrás va "barra-lunes@barra.local". El dominio no existe ni tiene que
// existir — Firebase solo pide que el string tenga forma de mail.
export const DOMINIO_TURNO = 'barra.local';

export const aMail = (entrada) => {
  const t = String(entrada || '').trim().toLowerCase();
  return t.includes('@') ? t : `${t}@${DOMINIO_TURNO}`;
};
export const aUsuario = (mail) => String(mail || '').replace(`@${DOMINIO_TURNO}`, '');

export const CFG = window.CONFIG_FIREBASE || {};
export const BAR = window.CONFIG_BAR || { moneda: '$', alertaDemoraMin: 8 };
export const $ = (s) => document.querySelector(s);


export const plata = (n) => BAR.moneda + Number(n || 0).toLocaleString('es-AR');
export const DEMORA_MS = (BAR.alertaDemoraMin || 8) * 60_000;

export const COLUMNAS = [
  { clave: 'nuevo',          titulo: 'Entraron',   siguiente: 'en_preparacion', accion: 'Preparar' },
  { clave: 'en_preparacion', titulo: 'Preparando', siguiente: 'listo',          accion: 'Listo' },
  { clave: 'listo',          titulo: 'Para llevar a la mesa', siguiente: 'entregado', accion: 'Entregado' },
  { clave: 'entregado',      titulo: 'Entregados', siguiente: null,             accion: null },
];

export const estado = { pedidos: [], carta: [], evento: null, eventos: [], agenda: [], mes: null, diaElegido: null, editandoEvento: null, accesos: [], invitados: [], invitadosTodos: [], invitandoA: null, registros: {}, esAparato: false, insumos: [], proveedores: [], compras: [], compra: { items: {} }, alDia: { filas: {}, condicion: 'cuenta', stock: 'ya' }, egresosTodos: [], sinPagos: false, veCaja: false, conteo: null, conteoDe: null, cortarConteo: null, cargandoConteo: {}, egresos: [], pedidosCaja: [], cortarCaja: null, venta: {}, rangoCaja: 'mes', pliegues: { faltan: true, adentro: false, anotados: false }, verTodos: {}, registro: null, buscaInvitado: '', buscaClub: '', verClub: false, pagos: {}, permisos: {}, dueno: false, rol: '', ordenCaja: 'fecha', detalleEvento: null, tomandoPedidos: true, desdeCache: false, usuario: '', sonido: localStorage.getItem('sotano:sonido') !== 'no', vistos: new Set() };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------- pestañas ----------
export function irA(cual) {
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
