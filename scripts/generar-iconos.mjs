// Genera el logo y todos los íconos de la PWA a partir de una sola definición.
// Si algún día entra el archivo original del diseñador, se reemplazan los SVG
// de public/iconos/ y se vuelve a correr: todo lo demás sale solo.
//
//   npm run iconos
//
// Al terminar imprime el tamaño propio de cada lockup. Si cambia, hay que
// copiarlo a los width/height del marcado: son la proporción que el navegador
// reserva antes de bajar el SVG, y si mienten el encabezado salta al cargar.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const SALIDA = 'public/iconos';
const FONDO = '#0d0b10';
const ORO = '#c6a02f';
const CREMA = '#ede3ce';

// La marca es "SÓTANO", sin "EL".
const MARCA = 'SÓTANO';

// Lo ancho que va la palabra, en múltiplos del cuerpo de letra. La marca es
// de tracking abierto: las letras respiran y es la mitad de su carácter.
const ANCHO_MARCA = 5.3;

// La bombita colgando: cable, casquillo, bulbo y 8 rayos.
// Todos los rayos caen de la horizontal para abajo — arriba está el cable, y
// un rayo apuntando ahí pelearía con él. 0 es derecho para abajo.
function bombita({ cx, cyBulbo, r, desdeArriba }) {
  const rayos = [10, 32, 54, 76, -10, -32, -54, -76].map((grados) => {
    const a = (grados * Math.PI) / 180;
    const [dx, dy] = [Math.sin(a), Math.cos(a)];
    const r1 = r * 1.28, r2 = r * 1.88;
    return `<line x1="${(cx + dx * r1).toFixed(1)}" y1="${(cyBulbo + dy * r1).toFixed(1)}"
                  x2="${(cx + dx * r2).toFixed(1)}" y2="${(cyBulbo + dy * r2).toFixed(1)}"/>`;
  }).join('\n    ');

  return `
  <g stroke="${ORO}" stroke-linecap="round" fill="none">
    <line x1="${cx}" y1="${desdeArriba}" x2="${cx}" y2="${(cyBulbo - r * 1.5).toFixed(1)}" stroke-width="${(r * 0.145).toFixed(2)}"/>
    <g stroke-width="${(r * 0.19).toFixed(2)}">
    ${rayos}
    </g>
  </g>
  <rect x="${(cx - r * 0.38).toFixed(1)}" y="${(cyBulbo - r * 1.58).toFixed(1)}" width="${(r * 0.76).toFixed(1)}" height="${(r * 0.6).toFixed(1)}"
        rx="${(r * 0.1).toFixed(1)}" fill="${ORO}"/>
  <circle cx="${cx}" cy="${cyBulbo}" r="${r}" fill="${ORO}"/>`;
}

const TIPOGRAFIA = `'Playfair Display', 'Didot', 'Bodoni MT', Georgia, 'Times New Roman', serif`;

const CHROME = '/opt/pw-browsers/chromium';
const nav = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const pag = await nav.newPage();

// El ancho de la palabra depende de la tipografía que el navegador tenga a
// mano, así que no se calcula: se mide. Con eso se busca el espaciado que la
// deja del ancho que la marca pide, y después se recorta el lienzo a medida.
async function medir(fontSize, letterSpacing) {
  return pag.evaluate(({ texto, familia, fontSize, letterSpacing }) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '2000'); svg.setAttribute('height', '400');
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '10'); t.setAttribute('y', '200');
    t.setAttribute('font-family', familia);
    t.setAttribute('font-size', String(fontSize));
    t.setAttribute('letter-spacing', String(letterSpacing));
    t.textContent = texto;
    svg.appendChild(t); document.body.appendChild(svg);
    const w = t.getBBox().width;
    svg.remove();
    return w;
  }, { texto: MARCA, familia: TIPOGRAFIA, fontSize, letterSpacing });
}

// Espaciado que deja la palabra del ancho pedido. Veinte vueltas de bisección
// alcanzan y sobran para quedar dentro del píxel.
async function espaciadoPara(fontSize) {
  const objetivo = fontSize * ANCHO_MARCA;
  let bajo = 0, alto = fontSize;
  for (let i = 0; i < 20; i++) {
    const medio = (bajo + alto) / 2;
    if ((await medir(fontSize, medio)) < objetivo) bajo = medio; else alto = medio;
  }
  const ls = Number(((bajo + alto) / 2).toFixed(2));
  return { ls, ancho: await medir(fontSize, ls) };
}

// --- Lockup vertical: bombita arriba, marca abajo. Es el logo completo. ---
const CUERPO_V = 96;
const { ls: lsV, ancho: anchoV } = await espaciadoPara(CUERPO_V);
const ALTO_V = 594;
// El lienzo se ajusta a la palabra, que es lo más ancho del conjunto.
const ANCHO_V = Math.round(anchoV + CUERPO_V * 1.1);
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANCHO_V} ${ALTO_V}" width="${ANCHO_V}" height="${ALTO_V}">
  <rect width="${ANCHO_V}" height="${ALTO_V}" fill="${FONDO}"/>
  ${bombita({ cx: ANCHO_V / 2, cyBulbo: 246, r: 38, desdeArriba: 66 })}
  <text x="${ANCHO_V / 2}" y="455" text-anchor="middle" fill="${CREMA}"
        font-family="${TIPOGRAFIA}" font-size="${CUERPO_V}" letter-spacing="${lsV}">${MARCA}</text>
</svg>`;

// --- Lockup horizontal: va en el encabezado, que es una franja baja. ---
const CUERPO_H = 58;
const { ls: lsH, ancho: anchoH } = await espaciadoPara(CUERPO_H);
const X_TEXTO = 112;
const ALTO_H = 120;
const ANCHO_H = Math.round(X_TEXTO + anchoH + 24);
const logoH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANCHO_H} ${ALTO_H}" width="${ANCHO_H}" height="${ALTO_H}">
  ${bombita({ cx: 52, cyBulbo: 70, r: 20, desdeArriba: 12 })}
  <text x="${X_TEXTO}" y="86" fill="${CREMA}"
        font-family="${TIPOGRAFIA}" font-size="${CUERPO_H}" letter-spacing="${lsH}">${MARCA}</text>
</svg>`;

// --- Ícono: solo la bombita. A 192px la palabra sería ilegible. ---
const icono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="${FONDO}"/>
  ${bombita({ cx: 256, cyBulbo: 290, r: 72, desdeArriba: 72 })}
</svg>`;

// --- El mismo lockup para fondo claro: la bombita sigue dorada y la marca
//     pasa a oscuro. Va en la hoja impresa y en la tarjeta de /qr.html. ---
const logoHClaro = logoH.replace(new RegExp(CREMA, 'gi'), '#1a1a1a');

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
  'logo-horizontal-claro.svg': logoHClaro,
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
const PNGS = [
  ['icono-192.png', icono, 192, 192],
  ['icono-512.png', icono, 512, 512],
  ['icono-maskable-512.png', iconoMaskable, 512, 512],
  ['apple-touch-icon.png', icono, 180, 180],
  ['icono-barra-192.png', iconoBarra, 192, 192],
  ['icono-barra-512.png', iconoBarra, 512, 512],
  ['icono-barra-maskable-512.png', iconoBarraMaskable, 512, 512],
  ['apple-touch-icon-barra.png', iconoBarra, 180, 180],
  ['logo.png', logo, ANCHO_V, ALTO_V],
  ['logo-horizontal.png', logoH, ANCHO_H * 2, ALTO_H * 2],
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

console.log(`\nTamaño propio de cada lockup — tiene que coincidir con los`);
console.log(`width/height del marcado que los usa:`);
console.log(`  logo.svg             width="${ANCHO_V}" height="${ALTO_V}"`);
console.log(`  logo-horizontal.svg  width="${ANCHO_H}" height="${ALTO_H}"`);
