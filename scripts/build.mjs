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
// Va TODO lo que el cliente descarga: si algo queda afuera y un día cambia
// solo eso, la versión no se mueve y el celular se queda con la copia vieja
// para siempre. Las páginas del invitado son las que más duelen: las abre una
// vez, desde un celular ajeno, y no vuelve.
const SELLADOS = [
  'public/index.html', 'public/bar.html', 'public/qr.html',
  'public/registro.html', 'public/pase.html',
  'public/app.js', 'public/bar.js', 'public/actualizar.js', 'public/estilos.css',
  'public/registro.js', 'public/pase.js', 'public/ayuda.js', 'public/tel.js',
  'public/instalar.js', 'public/corte.js',
  // Los módulos del panel: si cambia uno solo, la versión tiene que cambiar,
  // o el navegador se queda con una mezcla de viejo y nuevo.
  'public/barra/base.js', 'public/barra/conexion.js', 'public/barra/login.js',
  'public/barra/eventos.js', 'public/barra/usuarios.js', 'public/barra/invitados.js',
  'public/barra/pedidos.js', 'public/barra/carta.js', 'public/barra/deposito.js',
  'public/barra/administracion.js', 'public/barra/pantallas.js', 'public/barra/stock.js',
  'public/barra/jornada.js', 'public/barra/cartas.js',
  'public/manifest.webmanifest', 'public/manifest-barra.webmanifest',
  'public/manifest-club.webmanifest',
  'public/iconos/icono.svg', 'public/iconos/icono-barra.svg',
  'public/iconos/icono-club.svg',
  'public/iconos/logo.svg', 'public/iconos/logo-horizontal.svg',
  'public/iconos/logo-horizontal-claro.svg',
  salida,
];
const hash = createHash('sha256');
for (const f of SELLADOS) hash.update(readFileSync(f));
// El service worker también cuenta: la lista de lo que guarda para andar sin
// señal es parte de lo que el cliente se baja. Se le saca la línea de la
// versión antes de hashearlo, porque si no se muerde la cola: la versión sale
// del contenido y el contenido lleva la versión.
hash.update(readFileSync('public/sw.js', 'utf8').replace(/^const VERSION = '.*';$/m, ''));
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
