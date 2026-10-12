// Punto de entrada del SDK. Se empaqueta a public/vendor/firebase.js con
// `npm run build`, en vez de bajarlo del CDN de gstatic en cada arranque.
//
// Por qué: El Sótano tiene la señal que tiene. Un cliente que abre el QR con
// dos barras de 4G no debería esperar tres pedidos a un CDN externo antes de
// ver la carta. Empaquetado, es un solo archivo del mismo dominio, que además
// el service worker guarda en cache.
export { initializeApp } from 'firebase/app';
export {
  getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence,
} from 'firebase/auth';
export {
  getFirestore, initializeFirestore, connectFirestoreEmulator,
  persistentLocalCache, persistentSingleTabManager,
  collection, doc, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
