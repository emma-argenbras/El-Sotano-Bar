import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from '/vendor/firebase.js';
import { $, DOMINIO_TURNO, aMail, aUsuario, estado } from './base.js';
import { escucharCarta } from './carta.js';
import { auth, pintarConexion } from './conexion.js';
import { escucharDeposito } from './deposito.js';
import { escucharEvento } from './eventos.js';
import { escucharInvitados } from './invitados.js';
import { escucharCartas } from './cartas.js';
import { escucharJornadas } from './cierre.js';
import { escucharCorte } from './jornada.js';
import { pintarSonido } from './pedidos.js';
import { escucharAccesos, vigilarMiAcceso } from './usuarios.js';

// ---------- login ----------
$('#formLogin').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#btnEntrar');
  btn.disabled = true; btn.textContent = 'Entrando…';
  $('#errorLogin').classList.add('oculto');
  try {
    await signInWithEmailAndPassword(auth, aMail($('#inpMail').value), $('#inpPass').value);
  } catch (err) {
    $('#errorLoginTexto').textContent = mensajeAuth(err.code) || err.message;
    $('#errorLogin').classList.remove('oculto');
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
};

$('#btnOlvide').onclick = async () => {
  const mail = aMail($('#inpMail').value);
  if (!mail.startsWith('@') && !mail.includes('@')) { $('#inpMail').focus(); return; }
  if (mail.endsWith(`@${DOMINIO_TURNO}`)) {
    $('#errorLoginTexto').textContent =
      'Estas cuentas no tienen mail, así que no hay link de recuperación. '
      + 'Si la sabés, podés cambiarla desde adentro con la llave 🔑. '
      + 'Si la perdiste, pedile al dueño que te dé de alta una cuenta nueva.';
    $('#errorLogin').className = 'aviso mal';
    $('#errorLogin').classList.remove('oculto');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, mail);
    $('#errorLoginTexto').textContent = 'Te mandamos un mail para cambiar la contraseña.';
    $('#errorLogin').className = 'aviso ok';
    $('#errorLogin').classList.remove('oculto');
  } catch (err) {
    $('#errorLoginTexto').textContent = mensajeAuth(err.code) || err.message;
    $('#errorLogin').classList.remove('oculto');
  }
};

export function mensajeAuth(code) {
  return {
    'auth/invalid-credential': 'Mail o contraseña incorrectos.',
    'auth/wrong-password':     'Contraseña incorrecta.',
    'auth/user-not-found':     'Ese mail no está dado de alta.',
    'auth/invalid-email':      'El mail no es válido.',
    'auth/too-many-requests':  'Demasiados intentos. Esperá un minuto.',
    'auth/network-request-failed': 'Sin conexión.',
  }[code];
}

// ---------- cambiar la propia contraseña ----------
// Es lo unico que se puede hacer sin un servidor: Firebase deja que cada uno
// cambie la suya, nunca la de otro. Por eso, si alguien queda afuera, la
// salida es que la casa le de de alta una cuenta nueva — no hay forma de
// resetearle la contraseña desde el panel, y decir lo contrario es mentir.
$('#btnMiClave').onclick = () => {
  const u = auth.currentUser;
  if (!u) return;
  $('#quienCambiaClave').textContent = `Entrás como ${aUsuario(u.email)}.`;
  $('#inpClaveVieja').value = '';
  $('#inpClaveNueva').value = '';
  $('#inpClaveNueva2').value = '';
  $('#errorClave').classList.add('oculto');
  $('#btnConfirmarClave').disabled = false;
  $('#btnConfirmarClave').textContent = 'Cambiarla';
  $('#dlgClave').showModal();
  $('#inpClaveVieja').focus();
};
$('#btnCancelarClave').onclick = () => $('#dlgClave').close();
$('#btnConfirmarClave').onclick = async () => {
  const u = auth.currentUser;
  if (!u) return;
  const vieja = $('#inpClaveVieja').value;
  const nueva = $('#inpClaveNueva').value;
  const fallar = (t) => {
    $('#errorClaveTexto').textContent = t;
    $('#errorClave').classList.remove('oculto');
  };
  if (nueva.length < 6) {
    fallar('La nueva necesita al menos 6 caracteres.');
    $('#inpClaveNueva').focus();
    return;
  }
  if (nueva !== $('#inpClaveNueva2').value) {
    fallar('Las dos nuevas no coinciden.');
    $('#inpClaveNueva2').focus();
    return;
  }
  const btn = $('#btnConfirmarClave');
  btn.disabled = true; btn.textContent = 'Cambiando…';
  try {
    // Firebase pide volver a probar quién sos justo antes: si no, alcanzaba
    // con agarrar un celular desbloqueado para quedarse con la cuenta.
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, vieja));
    await updatePassword(u, nueva);
    $('#dlgClave').close();
    alert('Listo, tu contraseña cambió.\n\nAnotala donde la tengas: si se pierde, '
      + 'no se recupera y hay que crear una cuenta nueva.');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Cambiarla';
    fallar(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
      ? 'La contraseña de ahora no es esa.'
      : (mensajeAuth(e.code) || e.code || e.message));
  }
};

$('#btnSalir').onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
  const dentro = !!u && !u.isAnonymous;
  $('#vistaLogin').hidden = dentro;
  $('#vistaPanel').hidden = !dentro;
  if (!dentro) return;
  estado.usuario = aUsuario(u.email);
  // El corte primero: de él depende a qué caja entra lo que se venda, y lo
  // necesitan todos —la barra también, no solo quien mira la caja.
  escucharCorte();
  escucharCartas();
  escucharJornadas();
  pintarConexion(); pintarSonido(); escucharEvento(); escucharCarta();
  escucharInvitados();
  vigilarMiAcceso(u.uid);
  escucharAccesos();
  // El depósito lo necesita hasta la barra: el descuento al entregar sale de
  // los insumos, no de la carta, para los productos que tienen receta.
  escucharDeposito();
});
