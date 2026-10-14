// Punto de entrada del SDK. Se empaqueta a public/vendor/firebase.js con
// `npm run build`, en vez de bajarlo del CDN de gstatic en cada arranque.
//
// Por qué: El Sótano tiene la señal que tiene. Un cliente que abre el QR con
// dos barras de 4G no debería esperar tres pedidos a un CDN externo antes de
// ver la carta. Empaquetado, es un solo archivo del mismo dominio, que además
// el service worker guarda en cache.
export { initializeApp, deleteApp } from 'firebase/app';
export {
  getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence,
  // Cambiar la propia contraseña. Firebase exige volver a probar quién sos
  // justo antes: si no, alcanzaba con agarrar un celular desbloqueado.
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
export {
  getFirestore, initializeFirestore, connectFirestoreEmulator,
  persistentLocalCache, persistentSingleTabManager,
  collection, doc, query, where, orderBy, limit, onSnapshot,
  addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, writeBatch,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
