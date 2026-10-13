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
