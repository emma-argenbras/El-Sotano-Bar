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

// El sw sirve los estáticos de cache primero. Si la versión no cambia, el
// navegador se queda con el app.js viejo para siempre y un deploy no se ve.
// El hash la cambia sola cada vez que cambia algo que el cliente descarga.
const SELLADOS = [
  'public/index.html', 'public/bar.html', 'public/qr.html',
  'public/app.js', 'public/bar.js', 'public/estilos.css',
  'public/manifest.webmanifest', 'public/manifest-barra.webmanifest',
  'public/iconos/icono.svg', 'public/iconos/logo-horizontal.svg',
  salida,
];
const hash = createHash('sha256');
for (const f of SELLADOS) hash.update(readFileSync(f));
const version = `sotano-${hash.digest('hex').slice(0, 12)}`;

const sw = readFileSync('public/sw.js', 'utf8');
const nuevo = sw.replace(/^const VERSION = '.*';$/m, `const VERSION = '${version}';`);
if (nuevo === sw && !sw.includes(`'${version}'`)) {
  throw new Error('No pude sellar public/sw.js: no encontré la línea de VERSION');
}
writeFileSync('public/sw.js', nuevo);
console.log(`✓ public/sw.js — ${version}`);
