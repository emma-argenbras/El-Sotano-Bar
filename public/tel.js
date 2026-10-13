// Un teléfono, una anotación por noche.
//
// El mismo número se escribe de mil formas: "11 5555-0000", "+54 9 11 5555
// 0000", "011 15 5555 0000". Son la misma persona, así que antes de comparar
// se deja el número en su forma corta: área + número, diez dígitos.
export function digitosTel(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('54')) d = d.slice(2);   // país
  if (d.length > 10 && d.startsWith('9')) d = d.slice(1);    // el 9 de celular
  while (d.length > 10 && d.startsWith('0')) d = d.slice(1); // el 0 de larga distancia
  // El 15 viejo: va pegado después del área y sobran justo dos dígitos.
  if (d.length === 12) {
    for (const area of [2, 3, 4]) {
      if (d.slice(area, area + 2) === '15') { d = d.slice(0, area) + d.slice(area + 2); break; }
    }
  }
  return d.length > 10 ? d.slice(-10) : d;
}

// La llave del candado. Es el id del documento en 'anotados': como las reglas
// dejan crearlo pero nunca pisarlo, el segundo intento con el mismo teléfono
// choca y el lote entero se cae.
export function claveAnotado(eventoId, tel, sufijo = '') {
  return `${eventoId}__${digitosTel(tel)}${sufijo ? '__' + sufijo : ''}`;
}

// Cómo se escribe un teléfono acá: diez números, área y número, sin el 0 de
// larga distancia y sin el 15. Todos los de Argentina entran en ese molde:
// 11 + ocho, 3454 + seis, 351 + siete. Guardar siempre lo mismo es lo que
// hace que el candado sirva; si uno lo escribe con 0 y otro sin, son dos.
const cuantos = (n, uno, varios) =>
  n === 1 ? `${uno} 1 número` : `${varios} ${n} números`;

export const FORMATO_TEL = 'Diez números, sin 0 y sin 15. Ej.: 3454 18 9066';

export function telValido(tel) {
  return /^[1-9][0-9]{9}$/.test(String(tel ?? '').replace(/\D/g, ''));
}

// El porqué, en criollo. El cartel tiene que decir qué sacar, no "inválido".
export function porQueNoVale(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return 'Falta el teléfono. ' + FORMATO_TEL;
  if (d.startsWith('0')) return 'Sacale el 0 de adelante. ' + FORMATO_TEL;
  if (d.startsWith('54')) return 'Sacale el 54 de adelante. ' + FORMATO_TEL;
  if (d.length === 12 && [2, 3, 4].some((a) => d.slice(a, a + 2) === '15'))
    return 'Sacale el 15. ' + FORMATO_TEL;
  if (d.length < 10) return `${cuantos(10 - d.length, 'Te falta', 'Te faltan')}. ` + FORMATO_TEL;
  if (d.length > 10) return `${cuantos(d.length - 10, 'Te sobra', 'Te sobran')}. ` + FORMATO_TEL;
  return '';
}
