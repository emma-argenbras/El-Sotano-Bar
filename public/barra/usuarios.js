import {
  collection,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteApp,
  doc,
  getAuth,
  initializeApp,
  onSnapshot,
  serverTimestamp,
  setDoc,
  signOut,
  updateDoc,
} from '/vendor/firebase.js';
import { escucharPlataDeposito, pintarAdmin } from './administracion.js';
import { $, CFG, aMail, esc, estado, plata } from './base.js';
import { irA } from './pantallas.js';
import { pintarCartaBar } from './carta.js';
import { EMULADOR, app, auth, db, esElDueno, fallo } from './conexion.js';
import { pintarDeposito } from './deposito.js';
import { noches } from './eventos.js';
import { pintarQuienAtiende } from './pedidos.js';

// ---------- usuarios: quién es quién y qué ve ----------
// Vive en su propia pestaña y la ve solo quien reparte. Lo que se toca acá es
// el acceso de otro, nunca el propio: las reglas lo frenan, pero la pantalla
// tampoco lo ofrece — un botón que va a fallar es peor que no tenerlo.
export const PANTALLAS = [
  ['pedidos', 'Pedidos', 'El tablero: mover pedidos de estado'],
  ['carta', 'Carta', 'Precios, altas y sacar productos'],
  ['noche', 'Noche', 'Arrancar la noche y armar el turno'],
  ['caja', 'Administración', 'Toda la plata: caja, proveedores, costos'],
  ['deposito', 'Depósito', 'Insumos, compras y proveedores'],
  ['calendario', 'Calendario', 'Agendar noches y abrir registros'],
  ['puerta', 'Puerta', 'Escanear pases y marcar el ingreso'],
];

export const QUE_ES_EL_ROL = {
  sadmin: 'Hace todo, y además elige qué ve cada uno.',
  admin: 'Administra todo salvo borrar y repartir permisos.',
  barman: 'Mueve pedidos y cobra, la noche que está asignado.',
  puerta: 'Escanea pases, la noche que está asignada.',
  barra: 'El celular del local: entra siempre, sin depender del turno.',
};

// Los interruptores solo tienen sentido para quien administra: a un barman o
// a la puerta los limita el rol, no esta pantalla.
export const SE_LE_ELIGE = (rol) => rol === 'admin';

export function pintarUsuarios() {
  const cont = $('#usuarios');
  if (!cont || $('#vistaUsuarios').hidden) return;
  const yo = auth.currentUser?.uid;

  const fila = (a) => {
    const esYo = a.uid === yo;
    const p = a.permisos || {};
    // Los interruptores son para quien administra: a un barman, a la puerta y
    // al celular los limita el rol, no esta pantalla. Y los mueve un sadmin.
    const conInterruptores = estado.sadmin && !esYo && SE_LE_ELIGE(a.rol);
    return `
    <div class="item ${a.activo ? '' : 'agotado'}" style="flex-direction:column;align-items:stretch;gap:.5rem">
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
        <div class="cuerpo" style="flex:1">
          <div class="nombre">${esc(a.usuario)}${esYo ? ' <small>(vos)</small>' : ''}${
            a.activo ? '' : ' — <small>dado de baja</small>'}</div>
          <div class="desc">${esc(QUE_ES_EL_ROL[a.rol] || QUE_ES_EL_ROL.barman)}${
            (a.rol || 'barman') === 'barman'
              ? ((estado.evento?.barmanes || []).includes(a.uid)
                  ? ' · trabaja esta noche' : ' · sin turno asignado')
              : ''}</div>
        </div>
        ${esYo ? '' : `<button class="btn ${a.activo ? 'peligro' : 'primario'}"
          data-acceso="${esc(a.uid)}" style="padding:.4rem .7rem;font-size:.82rem">
          ${a.activo ? 'Dar de baja' : 'Reactivar'}</button>`}
      </div>
      ${esYo ? `<small style="color:var(--suave)">
        Tu propio acceso no se toca desde acá: es lo que evita que alguien se
        ascienda solo.</small>`
      : conInterruptores ? `
      <div class="elegir-pantallas">
        ${PANTALLAS.map(([k, t, ayuda]) => `
          <label title="${esc(ayuda)}">
            <input type="checkbox" data-permiso="${esc(a.uid)}:${k}"
                   ${p[k] === false ? '' : 'checked'}>
            <span>${t}</span>
          </label>`).join('')}
      </div>` : ''}
    </div>`;
  };

  const grupo = (titulo, gente, vacio, boton) => `
    <div class="grupo-personal">${titulo}</div>
    ${gente.length ? gente.map(fila).join('')
      : `<p style="color:var(--suave);font-size:.88rem;margin:0">${vacio}</p>`}
    ${boton || ''}`;

  const de = (rol) => estado.accesos.filter((a) => (a.rol || 'barman') === rol);

  cont.innerHTML = `
    <p style="color:var(--suave);font-size:.88rem;margin:0 0 .9rem">
      Quién entra al panel. Se registran una vez, con usuario y contraseña;
      después, al abrir cada noche, elegís qué barman trabaja.${estado.sadmin ? `
      Las casillas son las pantallas de cada administrador: lo que está apagado
      <b>no se ve ni se puede hacer</b>, aunque se sepa el camino.` : ''}
    </p>

    ${estado.sadmin ? grupo('Superadministradores', de('sadmin'),
      'Solo vos.',
      `<button class="btn ancho-full" id="btnAltaSadmin" style="margin-top:.6rem">
        Crear superadministrador</button>`) : ''}

    ${grupo('Administradores', de('admin'), 'Solo vos.',
      `<button class="btn ancho-full" id="btnAltaAdmin" style="margin-top:.6rem">
        Crear administrador</button>`)}

    ${grupo('Barman', de('barman'), 'Todavía no registraste ninguno.',
      `<button class="btn primario ancho-full" id="btnAltaBarman" style="margin-top:.6rem">
        Registrar barman</button>`)}

    ${grupo('Celular de la barra', de('barra'),
      'Todavía no hay. Es la cuenta del celular que queda en la barra: entra siempre, sin depender del turno.',
      `<button class="btn ancho-full" id="btnAltaAparato" style="margin-top:.6rem">
        Registrar celular de barra</button>`)}

    ${grupo('Puerta', de('puerta'), 'Todavía no registraste ninguno.',
      `<button class="btn ancho-full" id="btnAltaPuerta" style="margin-top:.6rem">
        Registrar gente de puerta</button>`)}`;

  cont.querySelectorAll('[data-permiso]').forEach((c) => c.onchange = () => {
    const [uid, que] = c.dataset.permiso.split(':');
    guardarPermiso(uid, que, c.checked, c);
  });
  cont.querySelectorAll('[data-acceso]').forEach((b) =>
    b.onclick = () => alternarAcceso(b.dataset.acceso));
  if ($('#btnAltaSadmin')) $('#btnAltaSadmin').onclick = () => altaPersona('sadmin');
  $('#btnAltaAdmin').onclick = () => altaPersona('admin');
  $('#btnAltaBarman').onclick = () => altaPersona('barman');
  $('#btnAltaAparato').onclick = () => altaPersona('barra');
  $('#btnAltaPuerta').onclick = () => altaPersona('puerta');
}

export async function guardarPermiso(uid, que, valor, caja) {
  const a = estado.accesos.find((x) => x.uid === uid);
  if (!a) return;
  caja.disabled = true;
  try {
    // Se manda el documento entero porque las reglas lo validan entero: si
    // llegara solo el permiso, no habría con qué comprobar el rol.
    await updateDoc(doc(db, 'accesosBarra', uid), {
      usuario: a.usuario, rol: a.rol, activo: a.activo !== false,
      permisos: { ...(a.permisos || {}), [que]: valor },
    });
  } catch (e) {
    caja.checked = !valor;
    alert('No se pudo: ' + (e.code || e.message));
  } finally { caja.disabled = false; }
}

// ---------- padrón de personal ----------
// Cuentas usuario/contraseña, sin mail, que el dueño da de alta para un
// evento y apaga cuando termina. El permiso es accesosBarra/{uid}: apagarlo
// corta el acceso en el momento, sin tocar reglas ni redesplegar.
export function escucharAccesos() {
  onSnapshot(collection(db, 'accesosBarra'), (snap) => {
    // OJO: poder leer el padrón ya no significa ser el dueño. Lo leen el dueño,
    // los administradores y el celular de la barra, que lo necesita para saber
    // quién puede estar atendiendo. El dueño es el que entra con un mail de
    // verdad: todas las cuentas de la casa son usuario@barra.local.
    estado.dueno = esElDueno();
    aplicarRol();
    estado.accesos = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => Number(!!b.activo) - Number(!!a.activo)
        || String(a.usuario).localeCompare(String(b.usuario)));
    pintarUsuarios();
  }, (e) => {
    // permission-denied acá es la respuesta esperada para el personal de
    // turno: no es dueño, no ve la administración y no pasa nada.
    estado.dueno = false;
    aplicarRol();
    if (e.code !== 'permission-denied') fallo('#usuarios')(e);
  });
}

// Las reglas rechazan cualquier escritura en cuanto se apaga el acceso, pero
// un listener ya abierto puede seguir recibiendo un rato: Firestore no vuelve
// a evaluar la regla al instante. Así que cada cuenta mira su propio permiso
// y se va sola cuando se lo apagan.
// Mi rol: dueño (sin documento), gerente o barra.
// Qué puede ver esta persona. Mismo criterio que las reglas: sin permisos
// cargados manda el rol, y al sadmin no lo recorta nadie.
//
// Esto SOLO esconde pestañas. Lo que frena de verdad son las reglas: si esto
// fuera lo único, alcanzaría con abrir la consola para saltearlo.
export const puedoVer = (que) => estado.sadmin || estado.permisos[que] !== false;

export function aplicarRol() {
  const b = document.body.classList;
  // sadmin es un nivel arriba de admin: lo único que lo distingue, por ahora,
  // es que elige qué ve cada uno. El dueño entra acá sin documento.
  estado.sadmin = estado.dueno || estado.rol === 'sadmin';
  const gerente = estado.sadmin || estado.rol === 'admin';
  b.toggle('es-dueno', estado.dueno);
  b.toggle('es-sadmin', estado.sadmin);
  b.toggle('es-gerente', gerente);
  b.toggle('es-barra', !estado.dueno && estado.rol === 'barman');
  // El celular de la barra: no es una persona, es el aparato del local.
  estado.esAparato = !estado.dueno && estado.rol === 'barra';
  b.toggle('es-aparato', estado.esAparato);
  pintarQuienAtiende();
  if (gerente && puedoVer('deposito')) escucharPlataDeposito();

  // Primero el rol, después el interruptor: lo que el rol no da, ningún
  // interruptor lo enciende.
  // Quien no ve la Caja no ve los pagos a proveedores, y sin los pagos un
  // saldo de cuenta corriente contaría como pendiente plata ya abonada.
  estado.veCaja = gerente && puedoVer('caja');
  $('#tabCaja').hidden = !estado.veCaja;
  // El depósito también lo ve el celular de la barra: necesita saber qué hay
  // para no prometer un trago que no se puede hacer. Lo ve de mirar nada más
  // —adentro no hay ningún botón suyo—, y las reglas lo frenan igual.
  $('#tabDeposito').hidden = !((gerente || estado.esAparato) && puedoVer('deposito'));
  $('#tabCalendario').hidden = !(gerente && puedoVer('calendario'));
  // Todo lo de cuentas vive acá. La ve quien administra —un admin tiene que
  // poder dar de alta un barman—; los interruptores, solo el sadmin.
  $('#tabUsuarios').hidden = !gerente;
  // El celular de la barra atiende la barra: pedidos, carta y la noche. La
  // puerta es de la gente de la puerta, con su propia cuenta.
  $('#tabPuerta').hidden = estado.esAparato || !puedoVer('puerta');
  $('#tabTablero').hidden = !puedoVer('pedidos');
  $('#tabCartaBar').hidden = !puedoVer('carta');
  $('#tabEvento').hidden = !puedoVer('noche');

  // Si quedó parado en una pantalla que ya no puede ver, se lo lleva a la
  // primera que sí: que no quede mirando algo vacío sin entender por qué.
  const abierta = [...document.querySelectorAll('.tabs [role=tab]')]
    .find((t) => t.getAttribute('aria-selected') === 'true');
  if (abierta && abierta.hidden) {
    const otra = [...document.querySelectorAll('.tabs [role=tab]')].find((t) => !t.hidden);
    if (otra) otra.click();
  }

  if (estado.esAparato && !$('#vistaPuerta').hidden) irA('tablero');
  // La puerta no trabaja pedidos ni carta: se le deja su pantalla y nada más.
  const soloPuerta = !estado.dueno && estado.rol === 'puerta';
  b.toggle('es-puerta', soloPuerta);
  if (soloPuerta && !$('#vistaPuerta').hidden === false) irA('puerta');

  // El panel se pinta antes de que llegue el documento de acceso: hasta ese
  // momento no se sabe qué pantallas tiene apagadas. Lo que ya se dibujó con
  // el dato viejo hay que volver a dibujarlo, o queda mostrando de más.
  pintarDeposito();
  pintarAdmin();
  pintarCartaBar();
}

export function vigilarMiAcceso(uid) {
  // El dueño no tiene documento de acceso, así que "no existe" no puede
  // significar echarlo. Solo se reacciona a un permiso que estuvo y se cayó.
  let loTuvo = false;
  let yendose = false;
  onSnapshot(doc(db, 'accesosBarra', uid), (d) => {
    if (d.exists()) {
      estado.rol = d.data().rol || 'barman';
      estado.permisos = d.data().permisos || {};
      aplicarRol();
    }
    if (d.exists() && d.data().activo === true) { loTuvo = true; return; }
    if (!d.exists() && !loTuvo) return;
    if (yendose) return;
    yendose = true;
    signOut(auth).finally(() =>
      alert('Se cerró tu turno. Pedile al dueño que te vuelva a habilitar.'));
  }, () => {});
}

export const QUE_ES = {
  sadmin: { nombre: 'superadministrador',
            puede: 'Todo lo de un administrador y además elige qué ve cada uno. Es el único que reparte permisos.' },
  admin: { nombre: 'administrador',
           puede: 'Hace todo lo que hacés vos menos borrar la base. Cuenta permanente, no depende del evento.' },
  barman: { nombre: 'barman',
            puede: 'Mueve pedidos, cobra y marca agotado. Para su celular propio: solo entra la noche en que lo asignás.' },
  puerta: { nombre: 'gente de puerta',
            puede: 'Solo la pantalla de puerta: escanea pases y marca quién entró. No ve caja ni pedidos.' },
  barra: { nombre: 'celular de la barra',
           puede: 'La cuenta del aparato que queda en el local. Entra siempre, sin depender del turno, y adentro se elige quién está atendiendo.' },
};

// El usuario se acomoda solo mientras se escribe: lo que la gente tipea en un
// celular trae mayúsculas, acentos y espacios, y antes eso era un cartel de
// error después de haber cargado todo.
export function limpiarUsuario(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // acentos fuera
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9._-]+/g, '-')                     // espacios y símbolos → guión
    .replace(/^-+/, '')
    .slice(0, 30);
}

export const usuarioValido = (u) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);

export let altaRol = null;
export function altaPersona(rol) {
  altaRol = rol;
  const q = QUE_ES[rol] || QUE_ES.barman;
  $('#tituloPersona').textContent = `Registrar ${q.nombre}`;
  $('#quePuedePersona').textContent = q.puede;
  $('#inpPersonaUsuario').value = rol === 'barra' ? 'barra' : '';
  $('#inpPersonaClave').value = '';
  $('#errorPersona').classList.add('oculto');
  $('#btnConfirmarPersona').disabled = false;
  $('#btnConfirmarPersona').textContent = 'Crear';
  $('#dlgPersona').showModal();
  pistaPersona();
  if (rol !== 'barra') $('#inpPersonaUsuario').focus();
  else $('#inpPersonaClave').focus();
}

export function pistaPersona() {
  const u = $('#inpPersonaUsuario').value;
  const p = $('#pistaPersona');
  if (!u) {
    p.className = 'pista';
    p.textContent = 'Entre 3 y 30: letras, números, punto, guión o guión bajo.';
    return;
  }
  const ok = usuarioValido(u);
  p.className = 'pista ' + (ok ? 'bien' : 'mal');
  p.textContent = ok
    ? `✓ Va a entrar escribiendo "${u}"`
    : (u.length < 3 ? 'Le faltan letras: mínimo 3.' : 'Tiene que empezar con una letra o un número.');
}

export function fallaPersona(texto) {
  $('#errorPersonaTexto').textContent = texto;
  $('#errorPersona').classList.remove('oculto');
}

export async function crearPersona() {
  const usuario = limpiarUsuario($('#inpPersonaUsuario').value);
  $('#inpPersonaUsuario').value = usuario;
  const clave = $('#inpPersonaClave').value;
  const q = QUE_ES[altaRol] || QUE_ES.barman;
  if (!usuarioValido(usuario)) {
    fallaPersona('El usuario tiene que tener entre 3 y 30 caracteres y empezar con letra o número.');
    $('#inpPersonaUsuario').focus();
    return;
  }
  if (clave.length < 6) {
    fallaPersona('La contraseña necesita al menos 6 caracteres.');
    $('#inpPersonaClave').focus();
    return;
  }
  const btn = $('#btnConfirmarPersona');
  btn.disabled = true; btn.textContent = 'Creando…';
  $('#errorPersona').classList.add('oculto');

  // Una app aparte para el alta: createUser deja logueada a la cuenta nueva,
  // y si usáramos la principal te quedarías afuera de tu propio panel.
  const secundaria = initializeApp(CFG, 'alta-' + Date.now());
  const authSec = getAuth(secundaria);
  if (EMULADOR) connectAuthEmulator(authSec, 'http://127.0.0.1:9099', { disableWarnings: true });
  try {
    const cred = await createUserWithEmailAndPassword(authSec, aMail(usuario), clave);
    await setDoc(doc(db, 'accesosBarra', cred.user.uid), {
      usuario, rol: altaRol, activo: true, creadoEn: serverTimestamp(),
    });
    $('#dlgPersona').close();
    alert(`Listo.\n\nUsuario: ${usuario}\nNivel: ${q.nombre}\n\n`
      + (altaRol === 'admin' || altaRol === 'barra' ? ''
        : 'Para que entre, asignalo al evento desde "De turno".\n\n')
      + `Que entre en:\n${location.origin}/bar.html`);
  } catch (e) {
    fallaPersona(e.code === 'auth/email-already-in-use'
      ? `Ya existe un usuario "${usuario}". Elegí otro nombre.`
      : (e.code === 'auth/weak-password'
        ? 'Esa contraseña es muy débil para Firebase. Probá con una más larga.'
        : 'No se pudo crear: ' + (e.code || e.message)));
    btn.disabled = false; btn.textContent = 'Crear';
  } finally {
    await signOut(authSec).catch(() => {});
    await deleteApp(secundaria).catch(() => {});
  }
}

export async function alternarAcceso(uid) {
  const a = estado.accesos.find((x) => x.uid === uid);
  if (!a) return;
  if (a.activo && !confirm(`¿Dar de baja a "${a.usuario}"?\n\n`
    + 'Pierde el acceso al toque, aunque tenga la app abierta.')) return;
  try { await updateDoc(doc(db, 'accesosBarra', uid), { activo: !a.activo }); }
  catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}
