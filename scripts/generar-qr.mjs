// Genera un PNG de QR por mesa. Cada QR abre la carta con la mesa ya elegida:
// el cliente no tiene que tipear nada.
//
// Salen a public/qr/ porque además se sirven en la web: /qr.html los muestra
// para proyectarlos desde el celular, y el cliente comparte el de su mesa.
//
//   npm run qr
//   npm run qr -- https://otro-dominio.com
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import QRCode from 'qrcode';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'https://el-sotano-bar.web.app';
const SALIDA = 'public/qr';

// Las mesas son las de config.js: una sola fuente de verdad.
const ctx = createContext({ window: {} });
runInContext(readFileSync('public/config.js', 'utf8'), ctx);
const MESAS = ctx.window.CONFIG_BAR?.mesas;
if (!Array.isArray(MESAS) || !MESAS.length) {
  throw new Error('No encontré window.CONFIG_BAR.mesas en public/config.js');
}

export const archivoDe = (mesa) => `mesa-${String(mesa).toLowerCase().replace(/\s+/g, '-')}.png`;

mkdirSync(SALIDA, { recursive: true });

// La bombita va en el centro del QR. Se puede porque el nivel de corrección H
// reconstruye hasta ~30% del código perdido; esto tapa cerca del 4%. Igual no
// se da por sentado: al final del script cada PNG se vuelve a decodificar.
const LOGO = readFileSync('public/iconos/icono.svg', 'utf8');
const LADO = 1000;
const navegador = await chromium.launch(
  existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
const pagina = await navegador.newPage({ viewport: { width: LADO, height: LADO } });

async function qrConLogo(url, destino) {
  const dataUrl = await QRCode.toDataURL(url, {
    width: LADO, margin: 2, errorCorrectionLevel: 'H',
    color: { dark: '#0d0b10', light: '#ffffff' },
  });
  await pagina.setContent(`<style>
      html,body{margin:0;width:${LADO}px;height:${LADO}px;background:#fff}
      .marco{position:relative;width:${LADO}px;height:${LADO}px}
      .marco>img{width:100%;height:100%;display:block}
      .coco{position:absolute;inset:0;margin:auto;width:20%;height:20%;
            background:#fff;border-radius:18%;display:flex;align-items:center;
            justify-content:center;padding:1.4%}
      .coco svg{width:100%;height:100%;display:block}
    </style>
    <div class="marco"><img src="${dataUrl}"><div class="coco">${LOGO}</div></div>`,
    { waitUntil: 'load' });
  await pagina.screenshot({ path: destino });
}

const indice = [];
for (const mesa of MESAS) {
  const url = `${BASE}/mesa/${encodeURIComponent(mesa)}`;
  const archivo = archivoDe(mesa);
  await qrConLogo(url, `${SALIDA}/${archivo}`);
  indice.push({ mesa: String(mesa), archivo, url });
  console.log(`✓ ${SALIDA}/${archivo}  →  ${url}`);
}

// Uno sin mesa, para Instagram, WhatsApp o la puerta del local.
await qrConLogo(BASE, `${SALIDA}/general.png`);
console.log(`✓ ${SALIDA}/general.png  →  ${BASE}`);

// El índice lo lee /qr.html, así que agregar una mesa en config.js y correr
// este script alcanza: no hay una segunda lista que mantener.
writeFileSync(`${SALIDA}/mesas.json`, JSON.stringify({
  base: BASE,
  general: { mesa: 'Sin mesa', archivo: 'general.png', url: BASE },
  mesas: indice,
}, null, 2));
console.log(`✓ ${SALIDA}/mesas.json`);
await navegador.close();

// Un QR con el logo encima que no se lee no sirve de nada, y plastificado se
// descubre tarde. Se decodifican todos antes de dar el trabajo por hecho.
const { PNG } = await import('pngjs');
const jsQR = (await import('jsqr')).default;
let fallados = 0;
for (const { archivo, url } of [...indice, { archivo: 'general.png', url: BASE }]) {
  const img = PNG.sync.read(readFileSync(`${SALIDA}/${archivo}`));
  const leido = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  if (leido?.data !== url) {
    fallados++;
    console.error(`✗ ${archivo} NO se lee bien → ${leido?.data ?? '(ilegible)'}`);
  }
}
if (fallados) throw new Error(`${fallados} QR no se leen: no los imprimas`);
console.log(`✓ los ${indice.length + 1} QR se decodifican y apuntan a donde deben`);

console.log(`\n${MESAS.length} QR listos.`);
console.log(`  Para ver y compartir:  ${BASE}/qr.html`);
console.log(`  Para imprimir:         npm run qr:imprimir`);
