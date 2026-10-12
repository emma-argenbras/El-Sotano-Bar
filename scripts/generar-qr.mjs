// Genera un PNG de QR por mesa, listo para imprimir y plastificar.
// Cada QR abre la carta con la mesa ya elegida: el cliente no tiene que tipear nada.
//
//   node scripts/generar-qr.mjs
//   node scripts/generar-qr.mjs https://otro-dominio.com
import { mkdirSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const BASE = process.argv[2] || 'https://el-sotano-bar.web.app';
const MESAS = ['1','2','3','4','5','6','7','8','9','10','Barra'];
const SALIDA = 'qr';

mkdirSync(SALIDA, { recursive: true });

for (const mesa of MESAS) {
  const url = `${BASE}/mesa/${encodeURIComponent(mesa)}`;
  const archivo = `${SALIDA}/mesa-${mesa.toLowerCase().replace(/\s+/g, '-')}.png`;
  await QRCode.toFile(archivo, url, {
    width: 1000, margin: 2, errorCorrectionLevel: 'H',
    color: { dark: '#0d0b10', light: '#ffffff' },
  });
  console.log(`✓ ${archivo}  →  ${url}`);
}
console.log(`\n${MESAS.length} QR en ./${SALIDA}/  — imprimí, plastificá y a la mesa.`);
