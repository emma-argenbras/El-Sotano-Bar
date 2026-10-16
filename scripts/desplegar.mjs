// Despliega un bloque a producción, de una sola vez y sin pasos sueltos.
//
//   npm run desplegar -- A
//
// Hace todo lo que hay que hacer en el orden que hay que hacerlo:
//   1. se asegura de que no haya trabajo sin guardar,
//   2. se para en el commit del bloque,
//   3. publica las reglas,
//   4. construye y publica la app,
//   5. vuelve a la rama de siempre, pase lo que pase.
//
// Las reglas van ANTES que la app, siempre. Al revés, el código nuevo escribe
// campos que las reglas viejas rechazan y el bar queda roto en el medio.
//
// Si algo falla, frena ahí y dice qué pasó. No sigue "a ver si funciona".
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BLOQUES = {
  A: {
    commit: '38cab69',
    nombre: 'Disponibilidad automática',
    que: 'Cuando se vende algo, la carta se marca sola: el producto que se queda '
       + 'sin insumo aparece agotado sin que nadie lo apague a mano.',
    mirar: [
      'Entrá al panel y abrí la pestaña Carta.',
      'Los productos que salen del depósito tienen que mostrar cuántos quedan.',
      'Si alguno está en cero, tiene que decir agotado.',
    ],
  },
  B: {
    commit: 'fe2bd46',
    nombre: 'La hora de corte del día',
    que: 'El día del bar deja de cortar a medianoche. Lo que se vende a las 3 AM '
       + 'queda contado en la noche anterior.',
    mirar: [
      'Entrá al panel y abrí la pestaña Caja.',
      'Bajá hasta "El día del bar": tiene que decir 6.',
      'Debajo tiene que explicar de qué hora a qué hora va la jornada de hoy.',
      'No toques el número todavía.',
    ],
  },
  C: {
    commit: '6a70eeb',
    nombre: 'El cobro de la entrada en la puerta',
    que: 'Marcar "Entró" ahora pregunta cómo paga la entrada y lo deja anotado. '
       + 'Antes esa plata no quedaba registrada en ningún lado.',
    mirar: [
      'Entrá al panel y abrí la pestaña Puerta.',
      'Tocá "Entró" en alguien de la lista.',
      'Tiene que abrirse la pregunta con Efectivo, Transferencia y Cortesía.',
      'Tocá "Volver": no entra nadie y no se cobra nada. Eso es lo que hay que ver.',
    ],
  },
};

const SITIO = 'https://sotano.web.app';

// ---------------------------------------------------------------------------
const letra = (process.argv[2] || '').trim().toUpperCase();
const bloque = BLOQUES[letra];

function cortar(titulo, ...detalle) {
  console.error(`\n  ✖  ${titulo}\n`);
  for (const l of detalle) console.error(`     ${l}`);
  console.error('');
  process.exit(1);
}

const paso = (n, t) => console.log(`\n  ${n}/5  ${t}`);
const listo = (t) => console.log(`       ✓ ${t}`);

// Lo que solo mira. Devuelve el texto, o null si el comando falla.
function mirar(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

// Lo que hace cosas. Muestra todo en pantalla y corta si falla.
function correr(cmd, comoSeLlama, ayuda) {
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    cortar(`Falló: ${comoSeLlama}`, ...ayuda);
  }
}

if (!bloque) {
  cortar(
    letra ? `No existe el bloque "${letra}".` : 'Falta decir qué bloque desplegar.',
    'Escribilo así, con la letra al final:',
    '',
    ...Object.entries(BLOQUES).map(([k, b]) => `   npm run desplegar -- ${k}      ${b.nombre}`),
  );
}

console.log(`\n  ═══  BLOQUE ${letra} · ${bloque.nombre}  ═══\n`);
console.log(`  ${bloque.que}\n`);

// --- 1. que no haya nada sin guardar ---------------------------------------
paso(1, 'Revisando que esté todo guardado');

if (!existsSync('firebase.json')) {
  cortar('Esto no se está corriendo dentro de la carpeta del proyecto.',
    'Abrí la Terminal dentro de la carpeta El-Sotano-Bar y probá de nuevo.');
}
if (!existsSync('node_modules')) {
  cortar('Faltan las piezas del proyecto.',
    'Corré primero:  npm install');
}

const sucio = mirar('git', ['status', '--porcelain']);
if (sucio === null) cortar('No pude leer el estado de git.', '¿Está instalado git?');
if (sucio) {
  cortar('Hay cambios sin guardar en la carpeta.',
    'Desplegar ahora los perdería. Guardalos o descartalos antes.',
    '',
    'Sin guardar:', ...sucio.split('\n').slice(0, 10).map((l) => '  ' + l));
}

// A dónde hay que volver cuando esto termine, salga bien o salga mal.
const rama = mirar('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const volverA = rama && rama !== 'HEAD' ? rama : mirar('git', ['rev-parse', 'HEAD']);
if (!volverA) cortar('No pude averiguar en qué rama estás.');
listo(`todo guardado (estás en ${volverA})`);

// --- 2. que la cuenta esté conectada ---------------------------------------
paso(2, 'Revisando la cuenta de Firebase');

const FB = mirar('firebase', ['--version']) ? 'firebase' : 'npx --yes firebase-tools';
if (FB.startsWith('npx')) listo('uso firebase-tools por npx (no está instalado aparte)');

const cuenta = mirar('sh', ['-c', `${FB} login:list 2>&1`]);
if (!cuenta || /No authorized|no accounts|Error:/i.test(cuenta)) {
  cortar('No hay ninguna cuenta de Firebase conectada.',
    'Corré esto una sola vez, entrá con tu cuenta de Google y volvé a probar:',
    '',
    '   firebase login');
}
listo(cuenta.split('\n').find((l) => l.includes('@'))?.trim() || 'cuenta conectada');

// --- 3. pararse en el commit del bloque ------------------------------------
paso(3, `Yendo al código del bloque ${letra}`);

correr('git fetch origin', 'bajar el código de GitHub',
  ['Revisá que tengas internet y que puedas entrar al repositorio.']);

if (!mirar('git', ['cat-file', '-t', bloque.commit])) {
  cortar(`No encuentro el código del bloque ${letra} (${bloque.commit}).`,
    'Puede que el repositorio no esté completo. Probá:  git fetch origin --unshallow');
}

// Pase lo que pase de acá en adelante, la carpeta vuelve a quedar como estaba.
let yaVolvi = false;
function volver() {
  if (yaVolvi) return;
  yaVolvi = true;
  // Lo que haya tocado la construcción se descarta: la carpeta estaba limpia
  // al empezar, así que nada de esto es trabajo de nadie.
  try { execSync('git checkout -- .', { stdio: 'ignore' }); } catch { /* da igual */ }
  try {
    execSync(`git checkout ${volverA}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    console.log(`\n  ↩  La carpeta volvió a ${volverA}.`);
  } catch {
    console.error(`\n  ⚠  No pude volver a ${volverA}. Corré a mano:  git checkout ${volverA}\n`);
  }
}
process.on('exit', volver);
process.on('SIGINT', () => { volver(); process.exit(130); });

correr(`git checkout ${bloque.commit} 2>/dev/null`, 'cambiar al código del bloque',
  ['Algo quedó sin guardar en la carpeta. Revisá con:  git status']);
listo(`parado en ${bloque.commit}`);

// --- 4. las reglas, primero ------------------------------------------------
paso(4, 'Publicando las reglas de seguridad');
console.log('       (van antes que la app: al revés, el bar queda roto en el medio)\n');

correr(`${FB} deploy --only firestore:rules`, 'publicar las reglas',
  ['No se publicó nada todavía: la app sigue como estaba.',
   'Si dice que falta un permiso, revisá que entraste con la cuenta dueña del proyecto.']);
listo('reglas publicadas');

// --- 5. la app -------------------------------------------------------------
paso(5, 'Construyendo y publicando la app');

correr('npm run build', 'construir la app',
  ['Las reglas YA se publicaron. La app quedó sin actualizar.',
   'Eso no rompe nada: el código viejo simplemente no usa los permisos nuevos.',
   'Volvé a correr el mismo comando cuando se resuelva.']);

correr(`${FB} deploy --only hosting`, 'publicar la app',
  ['Las reglas YA se publicaron. La app quedó sin actualizar.',
   'Eso no rompe nada: el código viejo simplemente no usa los permisos nuevos.',
   'Volvé a correr el mismo comando cuando se resuelva.']);
listo('app publicada');

// ---------------------------------------------------------------------------
volver();

console.log(`\n  ═══  BLOQUE ${letra} DESPLEGADO  ═══\n`);
console.log(`  Ahora abrí ${SITIO}/bar.html y mirá esto:\n`);
bloque.mirar.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));
console.log(`
  Y lo de siempre, en cualquier bloque:
   · que el panel abra,
   · que las pestañas de arriba respondan al tocarlas.

  No hace falta vender nada ni cargar nada para verificar. Si algo no anda,
  en la consola de Firebase → Hosting → Historial de versiones volvés a la
  anterior con un click.
`);
