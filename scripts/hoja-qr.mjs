// Arma la hoja A4 para imprimir y plastificar: 4 QR por hoja con línea de corte.
// Sale a ./qr-imprimible/ (fuera de public/: esto no se publica, se imprime).
//
//   npm run qr:imprimir
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ORIGEN = 'public/qr';
const SALIDA = 'qr-imprimible';
const { mesas } = JSON.parse(readFileSync(`${ORIGEN}/mesas.json`, 'utf8'));
// La variante para fondo claro la genera npm run iconos.
const LOGO_B64 = Buffer.from(
  readFileSync('public/iconos/logo-horizontal-claro.svg', 'utf8'),
).toString('base64');

// En una hoja impresa "Para llevar" no tiene mesa donde ir.
const PARA_PEGAR = mesas.filter((m) => !/para llevar/i.test(m.mesa));

const tarjetas = PARA_PEGAR.map(({ mesa, archivo }) => `
  <div class="tarjeta">
    <img class="marca" src="data:image/svg+xml;base64,${LOGO_B64}" alt="El Sótano">
    <img src="data:image/png;base64,${readFileSync(`${ORIGEN}/${archivo}`).toString('base64')}" alt="QR ${mesa}">
    <div class="mesa">${/^\d+$/.test(mesa) ? 'MESA ' + mesa : mesa.toUpperCase()}</div>
    <div class="pie">Escaneá y pedí desde tu celular</div>
  </div>`).join('');

mkdirSync(SALIDA, { recursive: true });
writeFileSync(`${SALIDA}/imprimir.html`, `<!doctype html><html lang="es"><meta charset="utf-8">
<title>QR por mesa — El Sótano</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .hoja { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 136mm; }
  .tarjeta { border: 1px dashed #bbb; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 6mm; break-inside: avoid; }
  .marca { width: 46mm; height: auto; display: block; margin-bottom: 3mm; }
  img { width: 62mm; height: 62mm; display: block; }
  .mesa { font-size: 26pt; font-weight: 800; letter-spacing: .06em; margin-top: 4mm; color:#111; }
  .pie { font-size: 9.5pt; color: #666; margin-top: 1.5mm; }
</style>
<div class="hoja">${tarjetas}</div>
</html>`);

// El contenedor trae su propio Chromium; si está, se usa ese.
const nav = await chromium.launch(
  existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
const pag = await nav.newPage();
await pag.goto(`file://${process.cwd()}/${SALIDA}/imprimir.html`, { waitUntil: 'load' });
await pag.pdf({ path: `${SALIDA}/qr-mesas.pdf`, format: 'A4', printBackground: true });
await nav.close();

console.log(`✓ ${SALIDA}/qr-mesas.pdf — ${PARA_PEGAR.length} QR, 4 por hoja`);
