// Borra una cuenta de personal: la de Firebase Auth y su documento de acceso.
//
// Hace falta porque desde el panel no se puede cambiar la contraseña de otro
// —Firebase solo deja cambiar la propia— y a veces alguien queda afuera. Esto
// libera el nombre de usuario para volver a darlo de alta desde el panel, con
// una contraseña nueva que elige la casa. La contraseña no pasa por acá.
//
//   node scripts/borrar-usuario.mjs barra            (muestra qué borraría)
//   node scripts/borrar-usuario.mjs barra --aplicar  (lo borra)
import { iniciar } from './_admin.mjs';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const usuario = (process.argv[2] || '').trim().toLowerCase();
const aplicar = process.argv.includes('--aplicar');
if (!usuario || usuario.startsWith('--')) {
  console.log('Falta el usuario.  Ej: node scripts/borrar-usuario.mjs barra');
  process.exit(1);
}

iniciar();
const auth = getAuth();
const db = getFirestore();
const mail = usuario.includes('@') ? usuario : `${usuario}@barra.local`;

let u;
try { u = await auth.getUserByEmail(mail); }
catch { console.log(`No existe ninguna cuenta "${usuario}".`); process.exit(1); }

const acceso = await db.doc(`accesosBarra/${u.uid}`).get();
const a = acceso.exists ? acceso.data() : null;
console.log(`Cuenta: ${mail}`);
console.log(`  rol: ${a?.rol || '(sin acceso)'} · activo: ${a?.activo} · último ingreso: ${u.metadata.lastSignInTime || 'nunca'}`);

// El dueño no tiene documento de acceso: su permiso sale del mail. Borrarlo
// desde acá dejaría al local sin nadie que pueda entrar.
if (!mail.endsWith('@barra.local')) {
  console.log('\nEso no es una cuenta de personal. No la toco.');
  process.exit(1);
}

if (!aplicar) {
  console.log('\nSe borrarían la cuenta y su acceso. Agregá --aplicar para hacerlo.');
  console.log('Después se vuelve a dar de alta desde el panel, con el mismo nombre.');
  process.exit(0);
}

if (acceso.exists) await acceso.ref.delete();
await auth.deleteUser(u.uid);
console.log(`\n✓ Borrada. El nombre "${usuario}" quedó libre.`);
console.log('  Dala de alta de nuevo desde Noche → Personal, con la contraseña que quieras.');
process.exit(0);
