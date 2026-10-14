// Da de alta (o repara) el usuario de la barra SIN que nadie escriba una contraseña.
// Crea la cuenta con una clave aleatoria descartable y emite un link para que
// la persona elija la suya. Así la contraseña no pasa por acá ni queda en ningún log.
//
//   npm run crear:barra -- emmanuelclubdelmate@gmail.com
import { randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { iniciar } from './_admin.mjs';

const mail = (process.argv[2] || 'emmanuelclubdelmate@gmail.com').trim();

iniciar();
const auth = getAuth();

let usuario;
try {
  usuario = await auth.getUserByEmail(mail);
  console.log(`· Ya existía: ${mail} (uid ${usuario.uid})`);
} catch (e) {
  if (e.code !== 'auth/user-not-found') throw e;
  usuario = await auth.createUser({
    email: mail,
    emailVerified: true,
    // Descartable: se reemplaza con el link de abajo y nunca se muestra.
    password: randomBytes(24).toString('base64url'),
    displayName: 'Barra — Sótano',
  });
  console.log(`✓ Usuario creado: ${mail} (uid ${usuario.uid})`);
}

// Claim de rol: las reglas lo aceptan sin leer ningún documento.
await auth.setCustomUserClaims(usuario.uid, { rol: 'barra' });
console.log('✓ Claim rol=barra asignado');

const link = await auth.generatePasswordResetLink(mail);
console.log(`
Abrí este link UNA vez y elegí la contraseña de la barra:

${link}

Después entrá en https://el-sotano-bar.web.app/bar.html
(el claim de rol se aplica al volver a iniciar sesión)
`);
