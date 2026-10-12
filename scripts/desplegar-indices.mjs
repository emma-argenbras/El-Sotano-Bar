// Despliega los índices de firestore.indexes.json, sin pasar por el precheck
// de serviceusage que `firebase deploy` hace y que la cuenta de admin SDK no
// puede hacer. Mismo motivo que scripts/desplegar-reglas.mjs.
//
//   npm run deploy:indices
//
// Por qué existe: el emulador NO exige índices y producción SÍ. Una consulta
// nueva pasa todos los tests y revienta en el celular de la barra con un
// "failed-precondition". Esto se corre junto con el deploy y no vuelve a pasar.
import { readFileSync } from 'node:fs';
import { getApps } from 'firebase-admin/app';
import { iniciar, PROYECTO } from './_admin.mjs';

iniciar();
const { access_token } = await getApps()[0].options.credential.getAccessToken();
const H = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)`;

const { indexes } = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
let nuevos = 0;

for (const idx of indexes) {
  const campos = idx.fields.map((f) => ({
    fieldPath: f.fieldPath,
    ...(f.order ? { order: f.order } : {}),
    ...(f.arrayConfig ? { arrayConfig: f.arrayConfig } : {}),
  }));
  const r = await fetch(`${BASE}/collectionGroups/${idx.collectionGroup}/indexes`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ queryScope: idx.queryScope || 'COLLECTION', fields: campos }),
  });
  const txt = await r.text();
  const etiqueta = `${idx.collectionGroup} [${idx.fields.map((f) => `${f.fieldPath} ${String(f.order || f.arrayConfig).slice(0, 4)}`).join(', ')}]`;
  if (r.ok) { nuevos++; console.log(`✓ ${etiqueta} — creado`); }
  else if (/ALREADY_EXISTS|already exists/.test(txt)) console.log(`· ${etiqueta} — ya estaba`);
  else throw new Error(`${etiqueta} → ${r.status}\n${txt}`);
}

console.log(`\n${indexes.length} índices declarados, ${nuevos} nuevos.`);
if (nuevos) {
  console.log('Tardan un rato en construirse. Hasta que terminen, las consultas');
  console.log('que los necesiten devuelven failed-precondition.');
}
