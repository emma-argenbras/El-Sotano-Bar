// Empaqueta el SDK de Firebase a un solo archivo servido desde nuestro dominio.
import { build } from 'esbuild';
import { statSync } from 'node:fs';

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
