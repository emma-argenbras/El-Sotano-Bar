// La cuenta del corte: a qué jornada cae cada momento.
//
// No necesita emulador ni Firestore: son cuatro cuentas con fechas. Pero son
// las cuatro de las que cuelga toda la plata de una noche, así que se prueban
// solas y a fondo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORTE_POR_DEFECTO,
  arranqueDeJornada,
  cajaDeDia,
  corteOPorDefecto,
  corteValido,
  fechaDeJornada,
} from '../public/corte.js';

// Las fechas se arman con el constructor de partes, no con un string ISO:
// `new Date('2026-10-17T03:00')` es hora local pero `...Z` es UTC, y la
// diferencia es justo lo que esta cuenta mide.
const local = (a, m, d, h, min = 0) => new Date(a, m - 1, d, h, min, 0, 0);

describe('la hora de corte', () => {
  it('por defecto son las 6', () => {
    assert.equal(CORTE_POR_DEFECTO, 6);
    assert.equal(corteOPorDefecto(undefined), 6);
    assert.equal(corteOPorDefecto(null), 6);
  });

  it('acepta de 0 a 12 enteros', () => {
    assert.equal(corteValido(0), 0);
    assert.equal(corteValido(6), 6);
    assert.equal(corteValido(12), 12);
    assert.equal(corteValido('8'), 8);
  });

  it('rechaza lo que no es una hora', () => {
    for (const malo of [-1, 13, 25, 6.5, 'seis', '', NaN, {}, [], true]) {
      assert.equal(corteValido(malo), null, `${JSON.stringify(malo)} debería ser inválido`);
    }
  });

  it('un valor roto no deja al bar sin corte: valen las 6', () => {
    assert.equal(corteOPorDefecto('cualquier cosa'), 6);
    assert.equal(corteOPorDefecto(99), 6);
    // Pero el cero es una hora válida, no un valor faltante.
    assert.equal(corteOPorDefecto(0), 0);
  });
});

describe('a qué jornada cae cada momento', () => {
  it('las 3 de la mañana son de la noche anterior', () => {
    assert.equal(fechaDeJornada(local(2026, 10, 17, 3), 6), '2026-10-16');
  });

  it('un minuto antes del corte todavía es ayer', () => {
    assert.equal(fechaDeJornada(local(2026, 10, 17, 5, 59), 6), '2026-10-16');
  });

  it('el corte en punto ya es hoy', () => {
    assert.equal(fechaDeJornada(local(2026, 10, 17, 6, 0), 6), '2026-10-17');
  });

  it('la noche entera cae en el mismo día', () => {
    const noche = [
      local(2026, 10, 16, 21), local(2026, 10, 16, 23, 59),
      local(2026, 10, 17, 0, 1), local(2026, 10, 17, 2),
      local(2026, 10, 17, 5, 59),
    ];
    for (const cuando of noche) {
      assert.equal(fechaDeJornada(cuando, 6), '2026-10-16', cuando.toString());
    }
  });

  it('con corte en 0 el día es el del calendario', () => {
    assert.equal(fechaDeJornada(local(2026, 10, 17, 3), 0), '2026-10-17');
    assert.equal(fechaDeJornada(local(2026, 10, 16, 23, 59), 0), '2026-10-16');
  });

  it('cruza el fin de mes y el fin de año', () => {
    assert.equal(fechaDeJornada(local(2026, 11, 1, 2), 6), '2026-10-31');
    assert.equal(fechaDeJornada(local(2027, 1, 1, 4), 6), '2026-12-31');
  });

  it('el mes y el día van con dos dígitos', () => {
    assert.equal(fechaDeJornada(local(2026, 3, 5, 12), 6), '2026-03-05');
  });
});

describe('el arranque de la jornada', () => {
  it('es el corte del día que corresponde', () => {
    const a = arranqueDeJornada(local(2026, 10, 17, 3), 6);
    assert.equal(a.getTime(), local(2026, 10, 16, 6).getTime());
  });

  it('a las 9 de la noche el arranque es esa misma mañana', () => {
    const a = arranqueDeJornada(local(2026, 10, 16, 21), 6);
    assert.equal(a.getTime(), local(2026, 10, 16, 6).getTime());
  });

  it('justo en el corte arranca una jornada nueva', () => {
    const a = arranqueDeJornada(local(2026, 10, 17, 6), 6);
    assert.equal(a.getTime(), local(2026, 10, 17, 6).getTime());
  });

  it('toda la noche comparte un solo arranque', () => {
    const esperado = local(2026, 10, 16, 6).getTime();
    for (const h of [6, 12, 21, 23]) {
      assert.equal(arranqueDeJornada(local(2026, 10, 16, h), 6).getTime(), esperado);
    }
    for (const h of [0, 3, 5]) {
      assert.equal(arranqueDeJornada(local(2026, 10, 17, h), 6).getTime(), esperado);
    }
  });

  it('con corte en 0 arranca a medianoche', () => {
    const a = arranqueDeJornada(local(2026, 10, 17, 3), 0);
    assert.equal(a.getTime(), local(2026, 10, 17, 0).getTime());
  });

  it('mover el corte mueve la ventana', () => {
    // A las 7 de la mañana: con corte a las 6 ya es hoy, con corte a las 8
    // todavía es ayer. Es exactamente lo que cambia al tocar la config.
    assert.equal(fechaDeJornada(local(2026, 10, 17, 7), 6), '2026-10-17');
    assert.equal(fechaDeJornada(local(2026, 10, 17, 7), 8), '2026-10-16');
  });
});

describe('el id de caja del día', () => {
  it('lleva el prefijo y la fecha de la jornada', () => {
    assert.equal(cajaDeDia(local(2026, 10, 17, 3), 6), 'dia-2026-10-16');
    assert.equal(cajaDeDia(local(2026, 10, 17, 9), 6), 'dia-2026-10-17');
  });

  it('toda la noche entra en la misma caja', () => {
    const antes = cajaDeDia(local(2026, 10, 16, 23, 30), 6);
    const despues = cajaDeDia(local(2026, 10, 17, 2, 15), 6);
    assert.equal(antes, despues);
  });
});
