// Que el cascarón de la app lleve todos los módulos del panel.
//
// El panel está partido en módulos y el service worker los guarda uno por
// uno, por nombre. Un módulo nuevo que no esté en la lista no se guarda: el
// panel abre con señal, y abajo, sin señal, el import falla y no abre nada.
// Pasó con avisos.js, y lo encontró una revisión, no una prueba. Ahora sí.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

describe('el service worker', () => {
  it('guarda todos los módulos de public/barra', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    const lista = sw.slice(sw.indexOf('const ESENCIALES'), sw.indexOf('];', sw.indexOf('const ESENCIALES')));
    const faltan = readdirSync('public/barra')
      .filter((f) => f.endsWith('.js'))
      .filter((f) => !lista.includes(`'/barra/${f}'`));
    assert.deepEqual(faltan, [], 'Módulos de barra/ que no están en ESENCIALES de public/sw.js');
  });
});
