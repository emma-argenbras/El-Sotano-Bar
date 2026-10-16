// ¿Se puede publicar ahora?
//
// El bar está abierto de las 19 a las 6. Publicar en esa franja es una venta
// perdida, así que la regla no vive en una guía que alguien tiene que
// acordarse de leer: vive acá, y la usan tanto el publicador de la máquina
// como la receta de GitHub.
//
//   node scripts/ventana.mjs      sale con 0 si se puede, con 1 si no
export const ZONA = 'America/Argentina/Buenos_Aires';
export const CIERRA = 19;  // a esta hora el bar empieza a vender
export const ABRE = 6;     // a esta hora termina la jornada

// La hora de Argentina, 0 a 23.
//
// Ojo con el formateador: en algunas versiones es-AR con hour12:false
// devuelve 24 para la medianoche en vez de 0, y 24 no es menor que 6 — con
// eso, la medianoche pasaría el filtro justo en el peor horario posible.
export function horaEnArgentina(cuando = new Date()) {
  const h = Number(new Intl.DateTimeFormat('es-AR',
    { timeZone: ZONA, hour: 'numeric', hour12: false }).format(cuando));
  return h % 24;
}

export function relojEnArgentina(cuando = new Date()) {
  return new Intl.DateTimeFormat('es-AR',
    { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(cuando);
}

export function sePuedePublicar(cuando = new Date()) {
  const h = horaEnArgentina(cuando);
  return h >= ABRE && h < CIERRA;
}

// Como programa: lo usa la receta de GitHub, que solo sabe de códigos de salida.
if (import.meta.url === `file://${process.argv[1]}`) {
  const ahora = new Date();
  if (sePuedePublicar(ahora)) {
    console.log(`Son las ${relojEnArgentina(ahora)} en Argentina: se puede publicar.`);
    process.exit(0);
  }
  console.error(`Son las ${relojEnArgentina(ahora)} en Argentina: el bar está abierto.`);
  console.error(`No se publica entre las ${CIERRA}:00 y las ${ABRE}:00. Esperá a mañana.`);
  process.exit(1);
}
