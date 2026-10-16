// La franja en la que no se publica. Es una regla de negocio, no un detalle:
// publicar con el bar lleno es una venta perdida.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { horaEnArgentina, sePuedePublicar } from '../scripts/ventana.mjs';

// Argentina es UTC-3 todo el año, así que las horas UTC son fijas.
const enArgentina = (h, m = 0) => new Date(Date.UTC(2026, 9, 17, h + 3, m));

describe('la ventana para publicar', () => {
  it('a media tarde se puede', () => {
    assert.equal(sePuedePublicar(enArgentina(14)), true);
  });

  it('un minuto antes de las 19 todavía se puede', () => {
    assert.equal(sePuedePublicar(enArgentina(18, 59)), true);
  });

  it('a las 19 en punto ya no', () => {
    assert.equal(sePuedePublicar(enArgentina(19)), false);
  });

  it('de madrugada no', () => {
    for (const h of [20, 22, 23, 1, 3, 5]) {
      assert.equal(sePuedePublicar(enArgentina(h)), false, `a las ${h}`);
    }
  });

  // El caso que más me preocupaba: si el formateador devolviera 24 en vez de
  // 0, la medianoche pasaría el filtro justo en el peor horario posible.
  it('la medianoche es 0, no 24, y no se publica', () => {
    assert.equal(horaEnArgentina(enArgentina(0)), 0);
    assert.equal(sePuedePublicar(enArgentina(0)), false);
    assert.equal(sePuedePublicar(enArgentina(0, 30)), false);
  });

  it('a las 5:59 no, a las 6 en punto sí', () => {
    assert.equal(sePuedePublicar(enArgentina(5, 59)), false);
    assert.equal(sePuedePublicar(enArgentina(6)), true);
  });
});
