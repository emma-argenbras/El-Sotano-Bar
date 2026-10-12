// Credenciales para los scripts de administración.
// Busca, en orden: FIREBASE_SA_JSON (contenido del JSON) o
// GOOGLE_APPLICATION_CREDENTIALS (ruta al archivo).
// La clave privada NUNCA va al repo: mirá .gitignore.
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';

export const PROYECTO = 'el-sotano-bar';

export function iniciar() {
  if (getApps().length) return getApps()[0];

  if (process.env.FIREBASE_SA_JSON) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SA_JSON)),
      projectId: PROYECTO,
    });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  }

  console.error(`
Faltan credenciales de administrador.

  Opción A (recomendada):
    export FIREBASE_SA_JSON="$(cat ~/Descargas/el-sotano-bar-xxxx.json)"

  Opción B:
    export GOOGLE_APPLICATION_CREDENTIALS=~/Descargas/el-sotano-bar-xxxx.json

La clave se baja en:
  https://console.firebase.google.com/project/el-sotano-bar/settings/serviceaccounts/adminsdk
`);
  process.exit(1);
}
