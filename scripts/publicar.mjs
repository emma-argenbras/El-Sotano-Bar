// Publica a producción. Lo corro yo, no vos.
//
//   npm run publicar                 reglas + app
//   npm run publicar -- --solo-reglas
//   npm run publicar -- --ensayo     hace todas las comprobaciones y no publica
//
// Las cuatro reglas de la casa, metidas en el código para que no dependan de
// que alguien se acuerde:
//
//   1. Solo con todos los tests en verde. Los corre acá, no confía en que
//      alguien los haya corrido antes.
//   2. Nunca entre las 19:00 y las 06:00 de Argentina. El bar está abierto y
//      un despliegue a esa hora es una venta perdida.
//   3. Reglas primero, app después. Al revés, el código nuevo escribe campos
//      que las reglas viejas rechazan.
//   4. Después, verificar contra la API qué quedó publicado de verdad.
//
// Si algo falla, frena ahí. No sigue "a ver si funciona".
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROYECTO = 'el-sotano-bar';
const SITIOS = ['sotano', 'sotano-club', 'el-sotano-bar'];
const ZONA = 'America/Argentina/Buenos_Aires';
const CIERRA = 19;   // a esta hora el bar empieza a vender
const ABRE = 6;      // a esta hora termina la jornada

const soloReglas = process.argv.includes('--solo-reglas');
const ensayo = process.argv.includes('--ensayo');

function cortar(titulo, ...detalle) {
  console.error(`\n  ✖  ${titulo}\n`);
  for (const l of detalle) console.error(`     ${l}`);
  console.error('');
  process.exit(1);
}
const paso = (n, t) => console.log(`\n  ${n}/5  ${t}`);
const listo = (t) => console.log(`       ✓ ${t}`);

const mirar = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

console.log(`\n  ═══  PUBLICAR A PRODUCCIÓN${ensayo ? ' · ENSAYO' : ''}  ═══`);

// --- 1. la hora -------------------------------------------------------------
paso(1, 'La hora');
const ahora = new Date();
const hora = Number(new Intl.DateTimeFormat('es-AR',
  { timeZone: ZONA, hour: 'numeric', hour12: false }).format(ahora));
const reloj = new Intl.DateTimeFormat('es-AR',
  { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(ahora);

if (hora >= CIERRA || hora < ABRE) {
  cortar(`Son las ${reloj} en Argentina: el bar está abierto.`,
    `No se publica entre las ${CIERRA}:00 y las ${ABRE}:00.`,
    'Un despliegue con gente adentro es una venta perdida.',
    '',
    'Esperá a mañana a la mañana.');
}
listo(`${reloj} en Argentina — la ventana está abierta hasta las ${CIERRA}:00`);

// --- 2. las credenciales ----------------------------------------------------
paso(2, 'Las credenciales');
if (!process.env.FIREBASE_SA_JSON) {
  cortar('No hay credenciales de Firebase en el entorno.',
    'Falta la variable FIREBASE_SA_JSON, que se carga una sola vez en',
    'los secretos del entorno. Ver DESPLEGAR.md.');
}
let cuenta;
try {
  cuenta = JSON.parse(process.env.FIREBASE_SA_JSON);
} catch {
  cortar('FIREBASE_SA_JSON no es un JSON válido.',
    'Tiene que ser el contenido entero del archivo que baja Google,',
    'desde la primera llave hasta la última.');
}
if (cuenta.project_id !== PROYECTO) {
  cortar(`La credencial es de otro proyecto: ${cuenta.project_id}`,
    `Tiene que ser de ${PROYECTO}.`);
}
listo(`${cuenta.client_email}`);

// --- 3. el estado del repositorio -------------------------------------------
paso(3, 'El código');
const sucio = mirar('git status --porcelain');
if (sucio === null) cortar('No pude leer el estado de git.');
if (sucio) {
  cortar('Hay cambios sin guardar.',
    'Se publica lo que está commiteado, no lo que está a medias.',
    '', ...sucio.split('\n').slice(0, 10).map((l) => '  ' + l));
}
const commit = mirar('git rev-parse --short HEAD');
const rama = mirar('git rev-parse --abbrev-ref HEAD');
listo(`${rama} · ${commit}`);

// --- 4. los tests -----------------------------------------------------------
paso(4, 'Los tests');
console.log('       (se corren acá: no se confía en que alguien los haya corrido)\n');
for (const [cmd, comoSeLlama] of [
  ['npm test', 'las reglas'],
  ['npm run e2e', 'el recorrido completo'],
]) {
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    cortar(`Fallaron los tests de ${comoSeLlama}.`,
      'No se publicó nada. Arreglalo y volvé a correr esto.');
  }
}
listo('todo en verde');

// --- 5. publicar ------------------------------------------------------------
if (ensayo) {
  console.log('\n  ═══  ENSAYO: pasó todo, no se publicó nada  ═══\n');
  process.exit(0);
}

paso(5, 'Publicando');

// La credencial vive en un archivo temporal con permisos de solo dueño, y se
// borra pase lo que pase: la CLI de Firebase pide una ruta, no el contenido.
const carpeta = mkdtempSync(join(tmpdir(), 'sotano-'));
const llave = join(carpeta, 'sa.json');
writeFileSync(llave, process.env.FIREBASE_SA_JSON, { mode: 0o600 });
const limpiar = () => { try { rmSync(carpeta, { recursive: true, force: true }); } catch { /* ya está */ } };
process.on('exit', limpiar);
process.on('SIGINT', () => { limpiar(); process.exit(130); });

const conLlave = { stdio: 'inherit', env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: llave } };

// Las reglas, primero. Se usa el script propio y no la CLI porque la CLI hace
// un chequeo previo de permisos que una cuenta de servicio acotada no pasa.
console.log('\n       Las reglas de seguridad\n');
try {
  execSync('node scripts/desplegar-reglas.mjs --aplicar', conLlave);
} catch {
  cortar('No se pudieron publicar las reglas.',
    'No se tocó nada más: la app sigue como estaba.');
}
listo('reglas publicadas');

if (soloReglas) {
  console.log('\n  ═══  SOLO REGLAS · PUBLICADO  ═══\n');
  process.exit(0);
}

console.log('\n       Construyendo la app\n');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch {
  cortar('Falló la construcción.',
    'Las reglas YA se publicaron; la app quedó sin actualizar.',
    'Eso no rompe nada: el código viejo no usa los permisos nuevos.');
}

console.log('\n       Publicando la app\n');
try {
  execSync('npx --yes firebase-tools deploy --only hosting --project ' + PROYECTO
    + ' --non-interactive', conLlave);
} catch {
  cortar('No se pudo publicar la app.',
    'Las reglas YA se publicaron; la app quedó sin actualizar.',
    'Eso no rompe nada: el código viejo no usa los permisos nuevos.',
    '',
    'Si el error habla de un permiso que falta, decime cuál es: se agrega',
    'a la cuenta de servicio en un click y se vuelve a correr.');
}

// --- verificar contra la API, no contra la esperanza ------------------------
console.log('\n       Verificando qué quedó publicado\n');
const { iniciar } = await import('./_admin.mjs');
const { getApps } = await import('firebase-admin/app');
iniciar();
const { access_token } = await getApps()[0].options.credential.getAccessToken();

for (const sitio of SITIOS) {
  const r = await fetch(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${sitio}/releases?pageSize=1`,
    { headers: { Authorization: `Bearer ${access_token}` } });
  const j = await r.json().catch(() => ({}));
  const rel = j.releases?.[0];
  if (!rel) { console.log(`       ? ${sitio}: no pude leer la última versión`); continue; }
  console.log(`       ✓ ${sitio}  ·  ${rel.version?.status || '?'}`
    + `  ·  ${new Date(rel.releaseTime).toLocaleString('es-AR', { timeZone: ZONA })}`);
}

console.log(`
  ═══  PUBLICADO  ═══

  Commit ${commit} (${rama}).
  Reglas y app, en ese orden.
`);
