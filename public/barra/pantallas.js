// Cambiar de pestaña. Vive aparte de base.js porque necesita apagar la cámara
// al salir de Puerta, y base.js no importa nada a propósito: es el piso del
// que cuelga todo lo demás y tiene que inicializarse primero.
import { $ } from './base.js';
import { cerrarCamara } from './invitados.js';

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
