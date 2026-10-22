// Sótano — el registro de cambios.
//
// Lo que saca plata de la caja o descongela números —anular un pedido
// entregado, borrar un gasto, reabrir una jornada— lo puede hacer un
// superadministrador sin depender del dueño, pero no en silencio: pide un
// motivo, y en la misma escritura deja una entrada en registro/, con quién y
// la hora del servidor. Las reglas exigen que la entrada exista, así que no
// hay forma de hacerlo sin dejarla. El dueño se entera en su campanita.
import {
  collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp,
} from '/vendor/firebase.js';
import { $, estado } from './base.js';
import { db } from './conexion.js';
import { pintarAvisos } from './avisos.js';

// ---------- el motivo ----------
// Un diálogo propio y no un prompt(): el motivo queda escrito para siempre,
// y en un prompt del navegador no se ve qué se está por hacer.
let esperando = null;

export function pedirMotivo({ titulo, texto, boton = 'Confirmar' }) {
  $('#tituloMotivo').textContent = titulo;
  $('#textoMotivo').textContent = texto || '';
  $('#inpMotivo').value = '';
  $('#errorMotivo').classList.add('oculto');
  $('#btnConfirmarMotivo').textContent = boton;
  $('#dlgMotivo').showModal();
  $('#inpMotivo').focus();
  return new Promise((resolver) => { esperando = resolver; });
}

function cerrarMotivo(motivo) {
  $('#dlgMotivo').close();
  const r = esperando;
  esperando = null;
  if (r) r(motivo);
}

$('#btnCancelarMotivo').onclick = () => cerrarMotivo(null);
$('#dlgMotivo').addEventListener('cancel', () => cerrarMotivo(null));
$('#btnConfirmarMotivo').onclick = () => {
  const m = $('#inpMotivo').value.trim();
  if (m.length < 3) {
    $('#errorMotivo').classList.remove('oculto');
    $('#inpMotivo').focus();
    return;
  }
  cerrarMotivo(m.slice(0, 300));
};

// ---------- la entrada ----------
// El id lo arma quien llama, con la misma forma que piden las reglas:
// "anular-pedido-<id>-<n>", "borrar-gasto-<id>", "reabrir-jornada-<fecha>-<n>".
export function registrar(lote, id, que, motivo, detalle = {}) {
  lote.set(doc(db, 'registro', id), {
    que, motivo,
    quien: estado.usuario || 'la casa',
    cuando: serverTimestamp(),
    detalle,
  });
}

// ---------- lo que se ve ----------
// Las últimas entradas. Lo leen los administradores; al personal de turno
// las reglas se lo niegan, y no pasa nada.
export function escucharRegistro() {
  onSnapshot(query(collection(db, 'registro'), orderBy('cuando', 'desc'), limit(30)), (snap) => {
    estado.bitacora = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarAvisos();
  }, () => { estado.bitacora = []; });
}

export const QUE_HIZO = {
  'anular-pedido': 'corrigió un pedido entregado',
  'borrar-gasto': 'borró un gasto',
  'reabrir-jornada': 'reabrió una jornada',
};
