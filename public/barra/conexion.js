// La conexión con Firebase y lo que cuelga de ella: las cuentas, la base, y
// los atajos a los documentos que mira medio panel.

import {
  initializeApp,
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, deleteApp,
  getFirestore, connectFirestoreEmulator, collection, doc, query, where, orderBy,
  onSnapshot, updateDoc, setDoc, deleteDoc, getDocs, Timestamp, addDoc, limit, serverTimestamp,
} from '/vendor/firebase.js';
import { claveAnotado, digitosTel, telValido, porQueNoVale, FORMATO_TEL } from '/tel.js';
import { $, CFG, DOMINIO_TURNO, esc, estado } from './base.js';

if (!CFG.apiKey || String(CFG.apiKey).startsWith('REEMPLAZAR')) {
  $('#avisoConfig').classList.remove('oculto');
  $('#formLogin').style.display = 'none';
  throw new Error('config.js sin completar');
}

export const app = initializeApp(CFG);
export const auth = getAuth(app);
export const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// En local apuntamos a los emuladores: nunca tocar datos de producción probando.
export const EMULADOR = ['localhost', '127.0.0.1'].includes(location.hostname);
if (EMULADOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// El dueño entra con su mail; el personal, con usuario@barra.local. No hay
// forma de que una cuenta de la casa se haga pasar por el dueño: el mail lo
// fija Firebase al crearla y las reglas miran lo mismo del lado del servidor.
export const esElDueno = () => {
  const mail = auth.currentUser?.email || '';
  return !!mail && !mail.endsWith('@' + DOMINIO_TURNO);
};

// ---------- conexión ----------
// navigator.onLine miente: hay navegadores que lo dejan en false con
// internet andando. El que sabe de verdad es Firestore — si lo que estamos
// mostrando sale del cache, no estamos hablando con el servidor.
export function pintarConexion() {
  const chip = $('#chipConexion');
  chip.hidden = !estado.desdeCache;
  chip.textContent = 'sin conexión';
  chip.className = 'chip mal';
}
addEventListener('online', pintarConexion);
addEventListener('offline', pintarConexion);



// ---------- eventos ----------
// Un evento es una noche de trabajo: se abre, entran pedidos, se cierra y la
// caja queda congelada ahí. No se corta a medianoche como el día calendario,
// que es justo cuando un bar está lleno.
export const EVENTOS = () => collection(db, 'barra', 'eventos', 'items');
// Lo lee cualquiera sin loguearse: el QR de la mesa necesita saberlo antes
// de que el cliente entre. Las reglas rechazan pedidos nuevos si está en no.
export const ESTADO_LOCAL = () => doc(db, 'publico', 'estado');
// Quién trabaja esta noche. Las reglas leen este documento para decidir si un
// barman entra: registrado no alcanza, hay que estar asignado al turno.
export const TURNO = () => doc(db, 'barra', 'turno');



export const fallo = (sel) => (e) => {
  if (e.code === 'permission-denied') $('#avisoPermiso').classList.remove('oculto');
  // failed-precondition acá es casi siempre un índice que falta o que todavía
  // se está construyendo. Decirlo así, y no con el código pelado.
  const texto = e.code === 'failed-precondition'
    ? '<b>Esto todavía no está listo.</b><br>La base está armando un índice nuevo. '
      + 'Probá de nuevo en unos minutos; el resto del panel anda igual.'
    : esc(e.code || e.message);
  $(sel).innerHTML = `<div class="aviso mal"><span>⚠</span><div>${texto}</div></div>`;
};
