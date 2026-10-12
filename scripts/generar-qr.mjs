// Genera un PNG de QR por mesa. Cada QR abre la carta con la mesa ya elegida:
// el cliente no tiene que tipear nada.
//
// Salen a public/qr/ porque además se sirven en la web: /qr.html los muestra
// para proyectarlos desde el celular, y el cliente comparte el de su mesa.
//
//   npm run qr
//   npm run qr -- https://otro-dominio.com
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import QRCode from 'qrcode';

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

const indice = [];
for (const mesa of MESAS) {
  const url = `${BASE}/mesa/${encodeURIComponent(mesa)}`;
  const archivo = archivoDe(mesa);
  await QRCode.toFile(`${SALIDA}/${archivo}`, url, {
    width: 1000, margin: 2, errorCorrectionLevel: 'H',
    color: { dark: '#0d0b10', light: '#ffffff' },
  });
  indice.push({ mesa: String(mesa), archivo, url });
  console.log(`✓ ${SALIDA}/${archivo}  →  ${url}`);
}

// Uno sin mesa, para Instagram, WhatsApp o la puerta del local.
const OPCIONES_QR = { width: 1000, margin: 2, errorCorrectionLevel: 'H',
                      color: { dark: '#0d0b10', light: '#ffffff' } };
await QRCode.toFile(`${SALIDA}/general.png`, BASE, OPCIONES_QR);
console.log(`✓ ${SALIDA}/general.png  →  ${BASE}`);

// El índice lo lee /qr.html, así que agregar una mesa en config.js y correr
// este script alcanza: no hay una segunda lista que mantener.
writeFileSync(`${SALIDA}/mesas.json`, JSON.stringify({
  base: BASE,
  general: { mesa: 'Sin mesa', archivo: 'general.png', url: BASE },
  mesas: indice,
}, null, 2));
console.log(`✓ ${SALIDA}/mesas.json`);
console.log(`\n${MESAS.length} QR listos.`);
console.log(`  Para ver y compartir:  ${BASE}/qr.html`);
console.log(`  Para imprimir:         npm run qr:imprimir`);
