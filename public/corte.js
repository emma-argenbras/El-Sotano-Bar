// A qué día pertenece lo que pasa de madrugada.
//
// El día del bar no corta a medianoche. Lo que se vende a las 3 AM es de la
// noche anterior: la misma gente, el mismo turno, la misma caja. Por eso el
// corte está en la mañana —6 por defecto— y se puede mover desde
// Administración, porque no todos los bares cierran a la misma hora.
//
// Acá no se lee nada de Firestore a propósito: son cuatro cuentas con fechas
// y las usa tanto el panel como la app del cliente. Cada lado consigue la
// hora por su cuenta y se la pasa; así la cuenta es una sola y no hay tres
// copias del 6 escritas a mano, que fue lo que había.
export const CORTE_POR_DEFECTO = 6;

// La dirección que se reparte. Los links y los QR salían con el dominio
// donde estuviera abierto el panel en ese momento: si entrabas por
// el-sotano-bar.web.app, eso era lo que se iba por WhatsApp. Funcionan los
// tres, pero lo que se reparte tiene que ser uno solo y ser siempre el mismo.
//
// En desarrollo y en los emuladores se usa el de la pestaña: ahí no hay
// nada que repartir y apuntar a producción rompería las pruebas.
export const OFICIAL = 'https://sotano.web.app';
export const dondeRepartir = (origen) => {
  const o = String(origen || '');
  return /^https:\/\/[a-z0-9-]+\.web\.app$/.test(o) ? OFICIAL : o;
};

// Entre 0 y 12. Cero es "corta a medianoche"; más de mediodía ya no sería un
// corte, sería el día de ayer entero.
//
// Se mira el tipo antes de convertir porque Number() es demasiado generoso:
// Number(null), Number('') y Number([]) dan 0, que es una hora válida. Un
// campo vacío pasaría por "corta a medianoche" y le cambiaría el día a toda
// la madrugada.
export function corteValido(h) {
  if (typeof h !== 'number' && typeof h !== 'string') return null;
  if (typeof h === 'string' && h.trim() === '') return null;
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n <= 12 ? n : null;
}

export const corteOPorDefecto = (h) => corteValido(h) ?? CORTE_POR_DEFECTO;

const dosDigitos = (n) => String(n).padStart(2, '0');

// La fecha de la jornada a la que cae un momento, en AAAA-MM-DD. A las 3 AM
// del 17 con corte a las 6 devuelve el 16: todavía es la noche del 16.
export function fechaDeJornada(cuando = new Date(), corte = CORTE_POR_DEFECTO) {
  const d = new Date(cuando.getTime() - corteOPorDefecto(corte) * 3600 * 1000);
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

// El momento exacto en que arrancó esa jornada: el corte del día que
// corresponde. Es el "desde" de todas las cuentas de la noche.
export function arranqueDeJornada(cuando = new Date(), corte = CORTE_POR_DEFECTO) {
  const h = corteOPorDefecto(corte);
  const d = new Date(cuando.getTime() - h * 3600 * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
}

// El id de caja de un día sin evento. El prefijo distingue a simple vista un
// día común del id de un evento.
export const cajaDeDia = (cuando = new Date(), corte = CORTE_POR_DEFECTO) =>
  `dia-${fechaDeJornada(cuando, corte)}`;
