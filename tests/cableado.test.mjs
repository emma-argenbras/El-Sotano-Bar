// Que ninguna pantalla se quede con la foto vieja.
//
// Cinco veces en una semana publiqué una pantalla que leía un dato y no se
// volvía a dibujar cuando ese dato llegaba. Las cinco las encontró un cliente
// o una auditoría, no yo. Esto lo encuentra antes de publicar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditarCableado } from '../scripts/cableado.mjs';

describe('el cableado de las pantallas', () => {
  it('ninguna pantalla lee un dato que su escucha no repinta', () => {
    const { huecos } = auditarCableado();
    assert.deepEqual(huecos.map((h) => `${h.pantalla} ← estado.${h.campo}`), [],
      'Hay pantallas que se quedan con la foto vieja. Agregá el repintado en '
      + 'el escucha que escribe ese dato, o si es un diálogo que se arma al '
      + 'abrirlo, sumalo a DIALOGOS en scripts/cableado.mjs.');
  });

  it('encuentra las pantallas y los datos: si da cero, el script se rompió', () => {
    const { datos, pantallas } = auditarCableado();
    assert.ok(datos >= 15, `solo encontró ${datos} datos`);
    assert.ok(pantallas >= 20, `solo encontró ${pantallas} pantallas`);
  });
});
