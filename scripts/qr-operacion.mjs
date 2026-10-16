// Los QR que el bar realmente usa, en un PDF listo para imprimir.
//
//   npm run qr:operacion
//
// Son dos, y ninguno vence:
//
//   1. CARTA Y PEDIDOS   sotano.web.app
//      El que se pega en la barra o se deja en la mesa. Abre la carta y deja
//      pedir desde el celular. No lleva número de mesa: en Sótano no hay.
//
//   2. INSCRIPCIÓN        sotano.web.app/registro.html
//      El de las noches con lista. A propósito SIN el id del evento adentro:
//      registro.html sin ?ev= mira publico/registro y manda a la noche que
//      esté abierta. Así el mismo papel sirve para todas las noches, y no hay
//      que reimprimir nada cada vez que se agenda una.
//
// Negro sobre blanco, grande y con el logo chico: el sótano tiene poca luz y
// un QR con poco contraste no se lee. Un QR por hoja A4.
//
// Sale a qr-imprimible/, que no se publica ni va al repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const BASE = process.argv[2] || 'https://sotano.web.app';
const SALIDA = 'qr-imprimible';

const QRS = [
  {
    archivo: 'qr-carta.png',
    url: BASE,
    titulo: 'LA CARTA',
    bajada: 'Escaneá y pedí desde tu celular',
    pie: 'Te avisamos acá mismo cuando esté listo',
  },
  {
    archivo: 'qr-inscripcion.png',
    url: `${BASE}/registro.html`,
    titulo: 'ANOTATE',
    bajada: 'Escaneá para entrar a la lista de la noche',
    pie: 'Te llega tu pase al celular',
  },
];

mkdirSync(SALIDA, { recursive: true });

// Corrección de errores alta: el papel se mancha, se dobla y se despega.
for (const q of QRS) {
  await QRCode.toFile(`${SALIDA}/${q.archivo}`, q.url, {
    width: 1400, margin: 1, errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

// Decodificar antes de mandar nada. Un QR que apunta mal, impreso, es papel
// tirado y gente que no puede pedir.
console.log('\nA dónde apunta cada uno (leído del PNG, no del código):\n');
let mal = 0;
for (const q of QRS) {
  const p = PNG.sync.read(readFileSync(`${SALIDA}/${q.archivo}`));
  const leido = jsQR(new Uint8ClampedArray(p.data), p.width, p.height);
  const ok = leido?.data === q.url;
  if (!ok) mal += 1;
  console.log(`  ${ok ? '✓' : '✗'}  ${q.titulo.padEnd(14)} ${leido?.data || 'NO SE PUDO LEER'}`);
}
if (mal) {
  console.error(`\n✗ ${mal} QR no apunta a donde debe. No se arma el PDF.\n`);
  process.exit(1);
}

const LOGO = Buffer.from(
  readFileSync('public/iconos/logo-horizontal-claro.svg', 'utf8'),
).toString('base64');

const hojas = QRS.map((q) => `
  <section class="hoja">
    <img class="marca" src="data:image/svg+xml;base64,${LOGO}" alt="Sótano">
    <h1>${q.titulo}</h1>
    <p class="bajada">${q.bajada}</p>
    <img class="qr" src="data:image/png;base64,${readFileSync(`${SALIDA}/${q.archivo}`).toString('base64')}" alt="">
    <p class="pie">${q.pie}</p>
    <p class="url">${q.url.replace(/^https:\/\//, '')}</p>
  </section>`).join('');

const html = `<!doctype html><html lang="es"><meta charset="utf-8">
<title>QR de Sótano</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #000;
         font-family: system-ui, -apple-system, "Segoe UI", Helvetica, sans-serif; }
  .hoja { width: 210mm; height: 297mm; padding: 18mm 16mm 14mm;
          display: flex; flex-direction: column; align-items: center;
          justify-content: flex-start; break-after: page; }
  .hoja:last-child { break-after: auto; }
  .marca { width: 72mm; height: auto; display: block; }
  h1 { font-size: 46pt; font-weight: 900; letter-spacing: .04em;
       margin: 8mm 0 0; color: #000; }
  .bajada { font-size: 16pt; font-weight: 600; margin: 3mm 0 0; color: #000;
            text-align: center; }
  /* Grande a propósito: se escanea de lejos y con poca luz. El recuadro
     negro ayuda a que la cámara lo encuentre sobre una pared clara. */
  .qr { width: 132mm; height: 132mm; display: block; margin: 8mm 0 0;
        border: 3mm solid #000; }
  .pie { font-size: 13pt; margin: 7mm 0 0; color: #000; text-align: center; }
  .url { font-size: 11pt; margin: 2mm 0 0; color: #444;
         letter-spacing: .04em; font-weight: 600; }
</style>
${hojas}`;

writeFileSync(`${SALIDA}/imprimir.html`, html);

// El contenedor trae su propio Chromium; en la Mac se usa el que haya.
const CHROME = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((r) => existsSync(r));
const nav = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const pg = await nav.newPage();
await pg.setContent(html, { waitUntil: 'load' });
await pg.pdf({ path: `${SALIDA}/QR-Sotano.pdf`, format: 'A4', printBackground: true });
await nav.close();

console.log(`\n✓ ${SALIDA}/QR-Sotano.pdf  —  ${QRS.length} hojas A4, una por QR\n`);
