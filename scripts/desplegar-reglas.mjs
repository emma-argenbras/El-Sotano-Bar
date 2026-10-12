// Publica firestore.rules con un service account, sin pasar por el precheck de
// serviceusage que `firebase deploy` hace y que la cuenta de admin SDK no puede hacer.
//
//   npm run deploy:reglas            compara repo vs. producción
//   npm run deploy:reglas -- --aplicar  publica
//
// Permisos necesarios en el service account:
//   firebaserules.rulesets.create  y  firebaserules.releases.create/update
import { readFileSync } from 'node:fs';
import { getApps } from 'firebase-admin/app';
import { iniciar, PROYECTO } from './_admin.mjs';

const RULES = 'firestore.rules';
const APLICAR = process.argv.includes('--aplicar');
const RELEASE = `projects/${PROYECTO}/releases/cloud.firestore`;

iniciar();
const { access_token } = await getApps()[0].options.credential.getAccessToken();

async function api(path, init = {}) {
  const r = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status}\n${txt}`);
  return txt ? JSON.parse(txt) : {};
}

const local = readFileSync(RULES, 'utf8');

let vivo = null;
try {
  const rel = await api(RELEASE);
  vivo = (await api(rel.rulesetName)).source.files.map((f) => f.content).join('\n');
  console.log(`· en producción: ${rel.rulesetName}`);
} catch (e) {
  if (!/-> 404/.test(e.message)) throw e;
  console.log('· no hay reglas publicadas en producción');
}

if (vivo !== null && vivo.trim() === local.trim()) {
  console.log('✓ Producción ya tiene estas reglas — nada que hacer');
  process.exit(0);
}
console.log(vivo === null ? '! producción está SIN reglas (Firestore rechaza todo)'
                          : '! producción DIFIERE de firestore.rules');
if (!APLICAR) { console.log('  (agregá --aplicar para publicar)'); process.exit(2); }

const ruleset = await api(`projects/${PROYECTO}/rulesets`, {
  method: 'POST',
  body: JSON.stringify({ source: { files: [{ name: RULES, content: local }] } }),
});
console.log(`✓ ruleset ${ruleset.name}`);

try {
  await api(`projects/${PROYECTO}/releases`, {
    method: 'POST',
    body: JSON.stringify({ name: RELEASE, rulesetName: ruleset.name }),
  });
  console.log('✓ release cloud.firestore creado — las reglas ya están en vivo');
} catch (e) {
  if (!/-> 409/.test(e.message)) throw e;
  await api(RELEASE, {
    method: 'PATCH',
    body: JSON.stringify({ release: { name: RELEASE, rulesetName: ruleset.name } }),
  });
  console.log('✓ release cloud.firestore actualizado — las reglas ya están en vivo');
}
