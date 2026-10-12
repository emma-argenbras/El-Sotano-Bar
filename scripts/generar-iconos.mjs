// Genera el logo y todos los íconos de la PWA a partir de una sola definición.
// Si algún día entra el archivo original del diseñador, se reemplazan los SVG
// de public/iconos/ y se vuelve a correr: todo lo demás sale solo.
//
//   npm run iconos
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SALIDA = 'public/iconos';
const FONDO = '#0d0b10';
const ORO = '#c6a02f';
const CREMA = '#ede3ce';

// La bombita colgando: cable, casquillo, bulbo y 8 rayos.
// Ninguno apunta derecho para arriba, ahí está el cable.
function bombita({ cx, cyBulbo, r, desdeArriba }) {
  const rayos = [20, 55, 90, 125, -20, -55, -90, -125].map((grados) => {
    const a = (grados * Math.PI) / 180;
    const [dx, dy] = [Math.sin(a), Math.cos(a)];
    const r1 = r * 1.34, r2 = r * 1.86;
    return `<line x1="${(cx + dx * r1).toFixed(1)}" y1="${(cyBulbo + dy * r1).toFixed(1)}"
                  x2="${(cx + dx * r2).toFixed(1)}" y2="${(cyBulbo + dy * r2).toFixed(1)}"/>`;
  }).join('\n    ');

  return `
  <g stroke="${ORO}" stroke-linecap="round" fill="none">
    <line x1="${cx}" y1="${desdeArriba}" x2="${cx}" y2="${cyBulbo - r * 1.52}" stroke-width="${r * 0.13}"/>
    <g stroke-width="${r * 0.17}">
    ${rayos}
    </g>
  </g>
  <rect x="${cx - r * 0.34}" y="${cyBulbo - r * 1.62}" width="${r * 0.68}" height="${r * 0.72}"
        rx="${r * 0.1}" fill="${ORO}"/>
  <circle cx="${cx}" cy="${cyBulbo}" r="${r}" fill="${ORO}"/>`;
}

const TIPOGRAFIA = `'Playfair Display', 'Didot', 'Bodoni MT', Georgia, 'Times New Roman', serif`;

// --- Lockup vertical: bombita arriba, marca abajo. Es el logo completo. ---
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 714 594" width="714" height="594">
  <rect width="714" height="594" fill="${FONDO}"/>
  ${bombita({ cx: 357, cyBulbo: 246, r: 38, desdeArriba: 66 })}
  <text x="357" y="455" text-anchor="middle" fill="${CREMA}"
        font-family="${TIPOGRAFIA}" font-size="96" letter-spacing="6">EL SÓTANO</text>
</svg>`;

// --- Lockup horizontal: va en el encabezado, que es una franja baja. ---
const logoH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 120" width="560" height="120">
  ${bombita({ cx: 52, cyBulbo: 70, r: 20, desdeArriba: 12 })}
  <text x="112" y="86" fill="${CREMA}"
        font-family="${TIPOGRAFIA}" font-size="58" letter-spacing="3.5">EL SÓTANO</text>
</svg>`;

// --- Ícono: solo la bombita. A 192px el texto "EL SÓTANO" sería ilegible. ---
const icono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="${FONDO}"/>
  ${bombita({ cx: 256, cyBulbo: 290, r: 72, desdeArriba: 72 })}
</svg>`;

// --- Ícono de la barra: invertido. En la pantalla de inicio hay dos apps
//     instaladas (carta y barra) y hay que distinguirlas de un vistazo. ---
const iconoBarra = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="${ORO}"/>
  ${bombita({ cx: 256, cyBulbo: 290, r: 72, desdeArriba: 72 }).replaceAll(ORO, FONDO)}
</svg>`;

const iconoBarraMaskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${ORO}"/>
  ${bombita({ cx: 256, cyBulbo: 288, r: 58, desdeArriba: 136 }).replaceAll(ORO, FONDO)}
</svg>`;

// --- Maskable: Android recorta en círculo, todo tiene que entrar en el 80% central. ---
const iconoMaskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${FONDO}"/>
  ${bombita({ cx: 256, cyBulbo: 288, r: 58, desdeArriba: 136 })}
</svg>`;

mkdirSync(SALIDA, { recursive: true });
const svgs = {
  'logo.svg': logo,
  'logo-horizontal.svg': logoH,
  'icono.svg': icono,
  'icono-maskable.svg': iconoMaskable,
  'icono-barra.svg': iconoBarra,
  'icono-barra-maskable.svg': iconoBarraMaskable,
};
for (const [nombre, contenido] of Object.entries(svgs)) {
  writeFileSync(`${SALIDA}/${nombre}`, contenido.trim() + '\n');
  console.log(`✓ ${SALIDA}/${nombre}`);
}

// Los PNG son para quien no lee SVG: iOS y algunos lanzadores de Android.
const CHROME = '/opt/pw-browsers/chromium';
const { existsSync } = await import('node:fs');
const nav = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const pag = await nav.newPage();

const PNGS = [
  ['icono-192.png', icono, 192, 192],
  ['icono-512.png', icono, 512, 512],
  ['icono-maskable-512.png', iconoMaskable, 512, 512],
  ['apple-touch-icon.png', icono, 180, 180],
  ['icono-barra-192.png', iconoBarra, 192, 192],
  ['icono-barra-512.png', iconoBarra, 512, 512],
  ['icono-barra-maskable-512.png', iconoBarraMaskable, 512, 512],
  ['apple-touch-icon-barra.png', iconoBarra, 180, 180],
  ['logo.png', logo, 714, 594],
  ['logo-horizontal.png', logoH, 1120, 240],
];
for (const [nombre, svg, w, h] of PNGS) {
  await pag.setViewportSize({ width: w, height: h });
  await pag.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  await pag.screenshot({ path: `${SALIDA}/${nombre}`, omitBackground: true });
  console.log(`✓ ${SALIDA}/${nombre} — ${w}×${h}`);
}
await nav.close();
