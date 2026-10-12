// Empaqueta el SDK de Firebase a un solo archivo servido desde nuestro dominio,
// y sella el service worker con un hash del contenido.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const salida = 'public/vendor/firebase.js';

await build({
  entryPoints: ['src/firebase.js'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  outfile: salida,
  legalComments: 'none',
});

const kb = (statSync(salida).size / 1024).toFixed(0);
console.log(`✓ ${salida} — ${kb} kB`);

// Segundo bundle: generar y leer QR. Va aparte porque la carta y el panel de
// pedidos no lo necesitan, y son las pantallas que más rápido tienen que abrir.
const salidaQr = 'public/vendor/qr.js';
await build({
  entryPoints: ['src/qr.js'], bundle: true, format: 'esm', target: ['es2020'],
  minify: true, outfile: salidaQr, legalComments: 'none', platform: 'browser',
});
console.log(`✓ ${salidaQr} — ${(statSync(salidaQr).size / 1024).toFixed(0)} kB`);

// El sw sirve los estáticos de cache primero. Si la versión no cambia, el
// navegador se queda con el app.js viejo para siempre y un deploy no se ve.
// El hash la cambia sola cada vez que cambia algo que el cliente descarga.
const SELLADOS = [
  'public/index.html', 'public/bar.html', 'public/qr.html',
  'public/app.js', 'public/bar.js', 'public/actualizar.js', 'public/estilos.css',
  'public/registro.js', 'public/pase.js', 'public/ayuda.js',
  'public/manifest.webmanifest', 'public/manifest-barra.webmanifest',
  'public/iconos/icono.svg', 'public/iconos/logo-horizontal.svg',
  salida,
];
const hash = createHash('sha256');
for (const f of SELLADOS) hash.update(readFileSync(f));
const version = `sotano-${hash.digest('hex').slice(0, 12)}`;

// La versión también queda servible: la app la consulta cada tanto para saber
// si lo que está corriendo quedó viejo. Van sin cache (ver firebase.json).
writeFileSync('public/version.js', `window.VERSION_APP = ${JSON.stringify(version)};\n`);
writeFileSync('public/version.json', JSON.stringify({ version }) + '\n');
console.log(`✓ public/version.js — ${version}`);

const sw = readFileSync('public/sw.js', 'utf8');
const nuevo = sw.replace(/^const VERSION = '.*';$/m, `const VERSION = '${version}';`);
if (nuevo === sw && !sw.includes(`'${version}'`)) {
  throw new Error('No pude sellar public/sw.js: no encontré la línea de VERSION');
}
writeFileSync('public/sw.js', nuevo);
console.log(`✓ public/sw.js — ${version}`);
