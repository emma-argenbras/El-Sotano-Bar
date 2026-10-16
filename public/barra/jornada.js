// La jornada: de un corte al siguiente.
//
// Una noche de bar no entra en un día del calendario. Arranca a las nueve y
// termina a las cinco de la mañana del día siguiente, y toda esa plata es la
// misma plata. La jornada es esa ventana: del corte de una mañana al de la
// siguiente.
//
// La hora del corte vive en publico/jornada y la cambia Administración. Está
// en publico/ porque la app del cliente también la necesita —el pedido que
// entra a las 3 AM tiene que caer en la misma caja que el que se cobra en la
// barra— y el que pide desde la mesa no tiene cuenta para leer otra cosa.
//
// Si el documento no existe todavía, o alguien guardó cualquier cosa, valen
// las 6: el bar no se queda sin corte por un dato faltante.
import { doc, onSnapshot } from '/vendor/firebase.js';
import {
  CORTE_POR_DEFECTO,
  arranqueDeJornada,
  cajaDeDia,
  corteOPorDefecto,
  corteValido,
  fechaDeJornada,
} from '/corte.js';
import { estado } from './base.js';
import { db } from './conexion.js';

export { CORTE_POR_DEFECTO, corteValido };

export const CORTE = () => doc(db, 'publico', 'jornada');

// La hora de corte que rige ahora mismo.
export const horaCorte = () => corteOPorDefecto(estado.jornada?.horaCorte);

// Cuándo arrancó la jornada en curso. Es el "desde" de la caja de hoy.
export const arranqueDeHoy = (cuando) => arranqueDeJornada(cuando, horaCorte());

// La fecha de la jornada en curso, en AAAA-MM-DD. Va a ser el id del
// documento de cierre.
export const fechaDeHoy = (cuando) => fechaDeJornada(cuando, horaCorte());

// El id de caja de un día sin evento.
export const cajaDeHoy = (cuando) => cajaDeDia(cuando, horaCorte());

// Quién se entera cuando cambia el corte. Cada pantalla que muestra plata de
// "hoy" se tiene que volver a dibujar: lo que entraba en la jornada dejó de
// entrar, o al revés.
const avisar = new Set();
export function alCambiarElCorte(fn) { avisar.add(fn); }

let yaEscucha = false;
export function escucharCorte() {
  if (yaEscucha) return;
  yaEscucha = true;
  onSnapshot(CORTE(), (d) => {
    estado.jornada = d.exists() ? d.data() : {};
    for (const fn of avisar) { try { fn(); } catch { /* una pantalla rota no tumba al resto */ } }
  }, () => {});
}
