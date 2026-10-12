// Verificación de firestore.rules contra el emulador.
// Correr con: npm test
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, serverTimestamp,
} from 'firebase/firestore';

let env;
const PROJECT = 'demo-el-sotano';
const MAIL_BARRA = 'emmanuelclubdelmate@gmail.com';

// Pedido mínimo válido, a nombre de quien lo manda.
const pedidoDe = (uid, extra = {}) => ({
  clienteId: uid,
  estado: 'nuevo',
  items: [{ id: 'fernet', nombre: 'Fernet con coca', precio: 4500, cantidad: 2 }],
  total: 9000,
  mesa: '7',
  creadoEn: serverTimestamp(),
  ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // Datos de arranque, escritos salteando las reglas.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'carta/fernet'), {
      nombre: 'Fernet con coca', precio: 4500, categoria: 'tragos',
      disponible: true, stock: 40, orden: 1,
    });
    await setDoc(doc(db, 'pedidos/pedido-de-ana'), {
      clienteId: 'ana', estado: 'nuevo',
      items: [{ id: 'fernet', nombre: 'Fernet con coca', precio: 4500, cantidad: 1 }],
      total: 4500, creadoEn: new Date(),
    });
    await setDoc(doc(db, 'barra/caja'), { abierta: true, totalNoche: 182000 });
    // Personal de turno: uno habilitado y uno apagado.
    await setDoc(doc(db, 'accesosBarra/uid-turno-ok'), { usuario: 'nico', activo: true, rol: 'barman' });
    await setDoc(doc(db, 'accesosBarra/uid-gerente'), { usuario: 'guille', activo: true, rol: 'admin' });
    await setDoc(doc(db, 'accesosBarra/uid-turno-off'), { usuario: 'ex-barman', activo: false, rol: 'barman' });
    await setDoc(doc(db, 'accesosBarra/uid-franco'), { usuario: 'franco', activo: true, rol: 'barman' });
    // Esta noche trabaja nico. Franco está registrado pero no asignado.
    await setDoc(doc(db, 'barra/turno'), { eventoId: 'ev-1', barmanes: ['uid-turno-ok', 'uid-puerta'] });
    await setDoc(doc(db, 'accesosBarra/uid-puerta'), { usuario: 'puerta', activo: true, rol: 'puerta' });
    await setDoc(doc(db, 'publico/registro'), {
      eventoId: 'ev-1', nombre: 'Noche', capacidad: 3, registrados: 1, abierto: true,
    });
    await setDoc(doc(db, 'invitados/token-largo-de-prueba-1'), {
      eventoId: 'ev-1', nombre: 'Ana', telefono: '1155550000',
      creadoEn: new Date(), ingresadoEn: null,
    });
  });
});

after(async () => { if (env) await env.cleanup(); });

// Contextos
const anon = () => env.authenticatedContext('cliente-anon-1', { provider_id: 'anonymous' }).firestore();
const otroAnon = () => env.authenticatedContext('cliente-anon-2', { provider_id: 'anonymous' }).firestore();
const sinLoguear = () => env.unauthenticatedContext().firestore();
const barra = () => env.authenticatedContext('uid-barra', {
  email: MAIL_BARRA, email_verified: true, provider_id: 'password',
}).firestore();

// Cuentas usuario/contraseña del turno: sin mail real, el permiso vive en
// accesosBarra/{uid} y el dueño lo prende y lo apaga.
const turnoOk = () => env.authenticatedContext('uid-turno-ok', {
  email: 'barra-lunes@barra.local', provider_id: 'password',
}).firestore();
const turnoOff = () => env.authenticatedContext('uid-turno-off', {
  email: 'barra-viernes@barra.local', provider_id: 'password',
}).firestore();

const gerente = () => env.authenticatedContext('uid-gerente', {
  email: 'guille@barra.local', provider_id: 'password',
}).firestore();

const franco = () => env.authenticatedContext('uid-franco', {
  email: 'franco@barra.local', provider_id: 'password',
}).firestore();

const puerta = () => env.authenticatedContext('uid-puerta', {
  email: 'puerta@barra.local', provider_id: 'password',
}).firestore();

const invitadoNuevo = (extra = {}) => ({
  eventoId: 'ev-1', nombre: 'Beto', telefono: '1155551111',
  creadoEn: serverTimestamp(), ...extra,
});

describe('registro de invitados', () => {
  it('cualquiera se registra si hay lugar', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-2'), invitadoNuevo()));
  });

  it('hasta sin loguearse: el link se comparte por WhatsApp', async () => {
    await assertSucceeds(setDoc(doc(sinLoguear(), 'invitados/token-largo-de-prueba-3'), invitadoNuevo()));
  });

  it('con un token corto NO: sería adivinable', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/abc'), invitadoNuevo()));
  });

  it('sin nombre o sin teléfono NO', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-4'), invitadoNuevo({ nombre: 'A' })));
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-5'), invitadoNuevo({ telefono: '12' })));
  });

  it('no se puede anotar en un evento que no es el abierto', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-6'), invitadoNuevo({ eventoId: 'otro' })));
  });

  it('no se puede llegar ya marcado como ingresado', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-7'),
      invitadoNuevo({ ingresadoEn: serverTimestamp() })));
  });

  it('con el token se ve el pase propio', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'invitados/token-largo-de-prueba-1')));
  });

  it('la lista entera NO la ve un invitado', async () => {
    await assertFails(getDocs(collection(anon(), 'invitados')));
  });

  it('el contador sube de a uno, nunca de a más', async () => {
    await assertSucceeds(updateDoc(doc(anon(), 'publico/registro'), { registrados: 2 }));
    await assertFails(updateDoc(doc(anon(), 'publico/registro'), { registrados: 50 }));
  });

  it('un invitado NO puede ampliar el cupo ni reabrir el registro', async () => {
    await assertFails(updateDoc(doc(anon(), 'publico/registro'), { capacidad: 999 }));
    await assertFails(updateDoc(doc(anon(), 'publico/registro'), { abierto: false }));
  });

  it('lleno, no entra nadie más', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/registro'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 3, registrados: 3, abierto: true }));
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-8'), invitadoNuevo()));
  });

  it('cerrado el registro, tampoco', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/registro'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 9, registrados: 0, abierto: false }));
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-9'), invitadoNuevo()));
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/registro'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 9, registrados: 0, abierto: true }));
  });
});

describe('invitado de último momento', () => {
  it('la casa lo anota aunque esté lleno', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/registro'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 1, registrados: 9, abierto: true }));
    await assertSucceeds(setDoc(doc(barra(), 'invitados/ultimo-momento-token-largo'), {
      eventoId: 'ev-1', nombre: 'Cami', telefono: '1155552222',
      creadoEn: serverTimestamp(), ingresadoEn: serverTimestamp(), ingresadoPor: 'guille',
    }));
  });

  it('y aunque el registro esté cerrado', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/registro'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 50, registrados: 0, abierto: false }));
    await assertSucceeds(setDoc(doc(barra(), 'invitados/ultimo-momento-token-2xx'), {
      eventoId: 'ev-1', nombre: 'Dani', telefono: '1155553333', creadoEn: serverTimestamp(),
    }));
  });

  it('un desconocido NO puede con el registro cerrado', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/colado-token-largo-xxxxx'), {
      eventoId: 'ev-1', nombre: 'Colado', telefono: '1155554444', creadoEn: serverTimestamp(),
    }));
  });

  it('la puerta tampoco: solo marca ingresos', async () => {
    await assertFails(setDoc(doc(puerta(), 'invitados/puerta-token-largo-xxxxx'), {
      eventoId: 'ev-1', nombre: 'Amigo', telefono: '1155555555', creadoEn: serverTimestamp(),
    }));
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/registro'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 9, registrados: 0, abierto: true }));
  });
});

describe('la puerta', () => {
  it('ve la lista de invitados', async () => {
    await assertSucceeds(getDocs(collection(puerta(), 'invitados')));
  });

  it('marca el ingreso', async () => {
    await assertSucceeds(updateDoc(doc(puerta(), 'invitados/token-largo-de-prueba-1'),
      { ingresadoEn: serverTimestamp(), ingresadoPor: 'puerta' }));
  });

  it('NO puede cambiarle el nombre a un invitado', async () => {
    await assertFails(updateDoc(doc(puerta(), 'invitados/token-largo-de-prueba-1'), { nombre: 'Otro' }));
  });

  it('NO ve la caja ni los pedidos', async () => {
    await assertFails(getDoc(doc(puerta(), 'barra/caja')));
    await assertFails(getDoc(doc(puerta(), 'pedidos/pedido-de-ana')));
  });

  it('NO toca la carta', async () => {
    await assertFails(updateDoc(doc(puerta(), 'carta/fernet'), { disponible: false }));
  });

  it('un invitado NO se marca su propia entrada', async () => {
    await assertFails(updateDoc(doc(anon(), 'invitados/token-largo-de-prueba-2'),
      { ingresadoEn: serverTimestamp() }));
  });

  it('la casa también marca ingresos', async () => {
    await assertSucceeds(updateDoc(doc(barra(), 'invitados/token-largo-de-prueba-2'),
      { ingresadoEn: serverTimestamp(), ingresadoPor: 'admin' }));
  });
});

describe('el barman entra solo la noche que trabaja', () => {
  it('asignado al turno, entra', async () => {
    await assertSucceeds(getDoc(doc(turnoOk(), 'pedidos/pedido-de-ana')));
  });

  it('registrado pero NO asignado, no entra', async () => {
    await assertFails(getDoc(doc(franco(), 'pedidos/pedido-de-ana')));
  });

  it('no asignado, tampoco toca la carta', async () => {
    await assertFails(updateDoc(doc(franco(), 'carta/fernet'), { disponible: false }));
  });

  it('no asignado, no ve la caja', async () => {
    await assertFails(getDoc(doc(franco(), 'barra/caja')));
  });

  it('un barman NO puede meterse en el turno solo', async () => {
    await assertFails(setDoc(doc(franco(), 'barra/turno'),
      { eventoId: 'ev-1', barmanes: ['uid-franco'] }));
  });

  it('el administrador SÍ arma el turno', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'barra/turno'),
      { eventoId: 'ev-1', barmanes: ['uid-turno-ok', 'uid-franco'] }));
  });

  it('recién asignado, ya entra', async () => {
    await assertSucceeds(getDoc(doc(franco(), 'pedidos/pedido-de-ana')));
  });

  it('cerrado el turno, ningún barman entra', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'barra/turno'), { eventoId: null, barmanes: [] }));
    await assertFails(getDoc(doc(turnoOk(), 'pedidos/pedido-de-ana')));
    await assertFails(getDoc(doc(franco(), 'pedidos/pedido-de-ana')));
    // El administrador sigue entrando: no depende del turno.
    await assertSucceeds(getDoc(doc(gerente(), 'pedidos/pedido-de-ana')));
    // Lo dejamos como estaba para los casos que siguen.
    await assertSucceeds(setDoc(doc(gerente(), 'barra/turno'),
      { eventoId: 'ev-1', barmanes: ['uid-turno-ok'] }));
  });
});

describe('tres niveles: dueño, administrador y barman', () => {
  it('la barra mueve un pedido de estado', async () => {
    await assertSucceeds(updateDoc(doc(turnoOk(), 'pedidos/pedido-de-ana'), { estado: 'listo' }));
  });

  it('la barra NO puede reescribir el total de un pedido', async () => {
    await assertFails(updateDoc(doc(turnoOk(), 'pedidos/pedido-de-ana'), { estado: 'listo', total: 1 }));
  });

  it('la barra marca agotado y ajusta stock', async () => {
    await assertSucceeds(updateDoc(doc(turnoOk(), 'carta/fernet'), { disponible: false, stock: 0 }));
  });

  it('la barra NO puede cambiar un precio', async () => {
    await assertFails(updateDoc(doc(turnoOk(), 'carta/fernet'), { precio: 1 }));
  });

  it('la barra NO puede dar de alta un producto', async () => {
    await assertFails(setDoc(doc(turnoOk(), 'carta/nuevo'), { nombre: 'X', precio: 1 }));
  });

  it('la barra VE la caja y los eventos', async () => {
    await assertSucceeds(getDoc(doc(turnoOk(), 'barra/caja')));
  });

  it('la barra NO puede tocar la caja', async () => {
    await assertFails(updateDoc(doc(turnoOk(), 'barra/caja'), { totalNoche: 0 }));
  });

  it('la barra NO puede cortar ni reabrir los pedidos', async () => {
    await assertFails(setDoc(doc(turnoOk(), 'publico/estado'), { tomandoPedidos: false }));
  });

  it('la barra NO puede borrar un pedido', async () => {
    await assertFails(deleteDoc(doc(turnoOk(), 'pedidos/pedido-de-ana')));
  });

  it('el administrador SÍ cambia precios', async () => {
    await assertSucceeds(updateDoc(doc(gerente(), 'carta/fernet'), { precio: 4800 }));
  });

  it('el administrador SÍ abre y cierra la caja del evento', async () => {
    await assertSucceeds(updateDoc(doc(gerente(), 'barra/caja'), { abierta: false }));
  });

  it('el administrador SÍ corta y reabre los pedidos', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'publico/estado'), { tomandoPedidos: true }));
  });

  it('el administrador NO puede borrar un pedido', async () => {
    await assertFails(deleteDoc(doc(gerente(), 'pedidos/pedido-de-ana')));
  });

  it('el administrador NO puede borrar un producto', async () => {
    await assertFails(deleteDoc(doc(gerente(), 'carta/fernet')));
  });

  it('el administrador SÍ da de alta gente de barra', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'accesosBarra/uid-barra-nuevo'),
      { usuario: 'barra-martes', activo: true, rol: 'barman' }));
  });

  it('el administrador SÍ puede nombrar otro administrador: es cuenta full', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'accesosBarra/uid-otro-jefe'),
      { usuario: 'otro', activo: true, rol: 'admin' }));
  });

  it('nadie puede escribir un rol inventado', async () => {
    // Si no, una cuenta se deja sin acceso sola y no hay como arreglarla.
    await assertFails(updateDoc(doc(gerente(), 'accesosBarra/uid-gerente'), { rol: 'dueno' }));
    await assertFails(setDoc(doc(barra(), 'accesosBarra/uid-raro'),
      { usuario: 'raro', activo: true, rol: 'superusuario' }));
  });

  it('ser dueño sale del token, no del documento: el gerente sigue sin borrar', async () => {
    await assertFails(deleteDoc(doc(gerente(), 'carta/fernet')));
  });

  it('el administrador NO puede borrar un acceso', async () => {
    await assertFails(deleteDoc(doc(gerente(), 'accesosBarra/uid-barra-nuevo')));
  });

  it('la barra NO puede dar de alta a nadie', async () => {
    await assertFails(setDoc(doc(turnoOk(), 'accesosBarra/uid-colado'),
      { usuario: 'colado', activo: true, rol: 'barman' }));
  });

  it('el dueño SÍ borra', async () => {
    await assertSucceeds(deleteDoc(doc(barra(), 'accesosBarra/uid-barra-nuevo')));
  });
});

describe('vigencia: solo se pide con el evento abierto', () => {
  it('con el local abierto, el cliente PUEDE pedir', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/estado'), { tomandoPedidos: true }));
    await assertSucceeds(setDoc(doc(anon(), 'pedidos/con-evento'), pedidoDe('cliente-anon-1')));
  });

  it('cerrado el evento, el mismo pedido se rechaza', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'publico/estado'), { tomandoPedidos: false }));
    await assertFails(setDoc(doc(anon(), 'pedidos/sin-evento'), pedidoDe('cliente-anon-1')));
  });

  it('cerrado el evento, el cliente igual puede ver la carta', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'carta/fernet')));
  });

  it('cerrado el evento, el cliente igual ve sus pedidos de antes', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'pedidos/con-evento')));
  });

  it('cerrado el evento, la barra SÍ puede cargar un pedido a mano', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'pedidos/a-mano'), pedidoDe('uid-barra')));
  });

  it('el cliente NO puede volver a abrir el local', async () => {
    await assertFails(setDoc(doc(anon(), 'publico/estado'), { tomandoPedidos: true }));
  });

  it('cualquiera puede leer si está abierto, incluso sin loguearse', async () => {
    await assertSucceeds(getDoc(doc(sinLoguear(), 'publico/estado')));
  });

  it('la barra SÍ lo prende y lo apaga', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'publico/estado'), { tomandoPedidos: true }));
  });

  it('sin el documento, se siguen tomando pedidos: un borrado no deja el bar mudo', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      deleteDoc(doc(ctx.firestore(), 'publico/estado')));
    await assertSucceeds(setDoc(doc(anon(), 'pedidos/sin-documento'), pedidoDe('cliente-anon-1')));
  });
});

describe('personal de barra por turno', () => {
  it('con el acceso prendido PUEDE ver todos los pedidos', async () => {
    await assertSucceeds(getDoc(doc(turnoOk(), 'pedidos/pedido-de-ana')));
  });

  it('con el acceso prendido PUEDE mover un pedido de estado', async () => {
    await assertSucceeds(updateDoc(doc(turnoOk(), 'pedidos/pedido-de-ana'), { estado: 'en_preparacion' }));
  });

  it('con el acceso prendido PUEDE agotar un item', async () => {
    await assertSucceeds(updateDoc(doc(turnoOk(), 'carta/fernet'), { disponible: false }));
  });

  it('con el acceso APAGADO no ve los pedidos ajenos', async () => {
    await assertFails(getDoc(doc(turnoOff(), 'pedidos/pedido-de-ana')));
  });

  it('con el acceso APAGADO no toca la carta', async () => {
    await assertFails(updateDoc(doc(turnoOff(), 'carta/fernet'), { precio: 1 }));
  });

  it('con el acceso APAGADO no entra a la caja', async () => {
    await assertFails(getDoc(doc(turnoOff(), 'barra/caja')));
  });

  it('NO puede prenderse el acceso solo', async () => {
    await assertFails(updateDoc(doc(turnoOff(), 'accesosBarra/uid-turno-off'), { activo: true }));
  });

  it('NO puede darse de alta un acceso nuevo', async () => {
    await assertFails(setDoc(doc(turnoOk(), 'accesosBarra/uid-inventado'), { usuario: 'x', activo: true }));
  });

  it('NO puede apagar a otro', async () => {
    await assertFails(updateDoc(doc(turnoOk(), 'accesosBarra/uid-turno-off'), { activo: false }));
  });

  it('NO puede listar quiénes tienen acceso', async () => {
    await assertFails(getDocs(collection(turnoOk(), 'accesosBarra')));
  });

  it('sí puede ver el suyo, para saber si lo apagaron', async () => {
    await assertSucceeds(getDoc(doc(turnoOk(), 'accesosBarra/uid-turno-ok')));
  });

  it('un cliente anónimo NO se puede dar acceso', async () => {
    await assertFails(setDoc(doc(anon(), 'accesosBarra/cliente-anon-1'), { usuario: 'yo', activo: true }));
  });

  it('el dueño SÍ da de alta, prende y apaga', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'accesosBarra/uid-nuevo'), { usuario: 'barra-sabado', activo: true }));
    await assertSucceeds(updateDoc(doc(barra(), 'accesosBarra/uid-nuevo'), { activo: false }));
    await assertSucceeds(getDocs(collection(barra(), 'accesosBarra')));
  });
});

describe('carta', () => {
  it('cliente anónimo PUEDE leer la carta', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'carta/fernet')));
  });

  it('visitante sin loguear también puede leer la carta (QR de la mesa)', async () => {
    await assertSucceeds(getDoc(doc(sinLoguear(), 'carta/fernet')));
  });

  it('cliente anónimo NO puede tocar el stock', async () => {
    await assertFails(updateDoc(doc(anon(), 'carta/fernet'), { stock: 9999 }));
  });

  it('cliente anónimo NO puede cambiar el precio', async () => {
    await assertFails(updateDoc(doc(anon(), 'carta/fernet'), { precio: 1 }));
  });

  it('cliente anónimo NO puede marcar un item como disponible', async () => {
    await assertFails(updateDoc(doc(anon(), 'carta/fernet'), { disponible: false }));
  });

  it('cliente anónimo NO puede crear items en la carta', async () => {
    await assertFails(setDoc(doc(anon(), 'carta/trucho'), { nombre: 'Gratis', precio: 0 }));
  });

  it('la barra SÍ puede ajustar stock y precio', async () => {
    await assertSucceeds(updateDoc(doc(barra(), 'carta/fernet'), { stock: 35, precio: 4800 }));
  });
});

describe('pedidos — crear', () => {
  it('cliente anónimo PUEDE crear un pedido a su nombre en estado "nuevo"', async () => {
    const db = anon();
    await assertSucceeds(setDoc(doc(db, 'pedidos/p-propio-1'), pedidoDe('cliente-anon-1')));
  });

  it('NO puede crear un pedido a nombre de otro cliente', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-ajeno'), pedidoDe('cliente-anon-2')));
  });

  it('NO puede crear un pedido ya en "listo" (saltear la cola)', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-listo'), pedidoDe('cliente-anon-1', { estado: 'listo' })));
  });

  it('NO puede crear un pedido en "entregado" (comerse la caja)', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-entregado'), pedidoDe('cliente-anon-1', { estado: 'entregado' })));
  });

  it('NO puede crear un pedido vacío', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-vacio'), pedidoDe('cliente-anon-1', { items: [], total: 0 })));
  });

  it('NO puede crear un pedido con total negativo', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-neg'), pedidoDe('cliente-anon-1', { total: -5000 })));
  });

  it('NO puede antedatar el pedido para colarse adelante en la cola', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-antedatado'),
      pedidoDe('cliente-anon-1', { creadoEn: new Date('2020-01-01') })));
  });

  it('NO puede meter campos arbitrarios (ej: descuento)', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'pedidos/p-extra'),
      pedidoDe('cliente-anon-1', { descuento: 100, pagado: true })));
  });

  it('un visitante sin loguear NO puede crear pedidos', async () => {
    const db = sinLoguear();
    await assertFails(setDoc(doc(db, 'pedidos/p-sin-auth'), pedidoDe('cualquiera')));
  });
});

describe('pedidos — leer', () => {
  it('cliente anónimo PUEDE leer su propio pedido', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'pedidos/p-mio'), {
        clienteId: 'cliente-anon-1', estado: 'nuevo',
        items: [{ id: 'fernet', precio: 4500, cantidad: 1 }], total: 4500, creadoEn: new Date(),
      });
    });
    await assertSucceeds(getDoc(doc(anon(), 'pedidos/p-mio')));
  });

  it('cliente anónimo NO puede leer el pedido de otro cliente', async () => {
    await assertFails(getDoc(doc(anon(), 'pedidos/pedido-de-ana')));
  });

  it('cliente anónimo NO puede listar TODOS los pedidos', async () => {
    await assertFails(getDocs(collection(anon(), 'pedidos')));
  });

  it('cliente anónimo NO puede listar los pedidos filtrando por otro clienteId', async () => {
    const db = anon();
    await assertFails(getDocs(query(collection(db, 'pedidos'), where('clienteId', '==', 'ana'))));
  });

  it('cliente anónimo SÍ puede listar filtrando por su propio clienteId', async () => {
    const db = anon();
    await assertSucceeds(getDocs(query(collection(db, 'pedidos'), where('clienteId', '==', 'cliente-anon-1'))));
  });

  it('la barra SÍ puede listar todos los pedidos', async () => {
    await assertSucceeds(getDocs(collection(barra(), 'pedidos')));
  });
});

describe('pedidos — cambiar estado', () => {
  it('cliente anónimo NO puede cambiar el estado de su propio pedido', async () => {
    await assertFails(updateDoc(doc(anon(), 'pedidos/p-mio'), { estado: 'listo' }));
  });

  it('cliente anónimo NO puede cambiar el estado de un pedido ajeno', async () => {
    await assertFails(updateDoc(doc(anon(), 'pedidos/pedido-de-ana'), { estado: 'entregado' }));
  });

  it('cliente anónimo NO puede inflar el total de un pedido ya creado', async () => {
    await assertFails(updateDoc(doc(anon(), 'pedidos/p-mio'), { total: 0 }));
  });

  it('cliente anónimo NO puede borrar su pedido', async () => {
    await assertFails(deleteDoc(doc(anon(), 'pedidos/p-mio')));
  });

  it('otro cliente anónimo NO puede tocar el pedido del primero', async () => {
    await assertFails(updateDoc(doc(otroAnon(), 'pedidos/p-mio'), { estado: 'cancelado' }));
  });

  it('la barra SÍ puede pasar el pedido a "en_preparacion"', async () => {
    await assertSucceeds(updateDoc(doc(barra(), 'pedidos/p-mio'), { estado: 'en_preparacion' }));
  });

  it('la barra NO puede poner un estado inventado', async () => {
    await assertFails(updateDoc(doc(barra(), 'pedidos/p-mio'), { estado: 'gratis_total' }));
  });

  it('la barra NO puede reasignar el pedido a otro cliente', async () => {
    await assertFails(updateDoc(doc(barra(), 'pedidos/p-mio'), { clienteId: 'otro' }));
  });
});

describe('barra (colección privada)', () => {
  it('cliente anónimo NO puede leer la caja', async () => {
    await assertFails(getDoc(doc(anon(), 'barra/caja')));
  });

  it('cliente anónimo NO puede escribir en la colección barra', async () => {
    await assertFails(setDoc(doc(anon(), 'barra/caja'), { totalNoche: 0 }));
  });

  it('cliente anónimo NO puede crear documentos nuevos en barra', async () => {
    await assertFails(setDoc(doc(anon(), 'barra/trucho'), { hola: true }));
  });

  it('cliente anónimo NO puede escribir en subcolecciones de barra', async () => {
    await assertFails(setDoc(doc(anon(), 'barra/caja/movimientos/m1'), { monto: -1000 }));
  });

  it('un usuario con mail NO autorizado NO entra a barra', async () => {
    const intruso = env.authenticatedContext('uid-intruso', {
      email: 'cualquiera@gmail.com', email_verified: true, provider_id: 'password',
    }).firestore();
    await assertFails(getDoc(doc(intruso, 'barra/caja')));
  });

  it('la barra SÍ lee y escribe su caja', async () => {
    await assertSucceeds(getDoc(doc(barra(), 'barra/caja')));
    await assertSucceeds(setDoc(doc(barra(), 'barra/caja'), { abierta: true, totalNoche: 200000 }));
  });

  it('un usuario con el claim de dueño entra sin estar en la lista de mails', async () => {
    // Ojo: el claim del token es otra cosa que el rol de accesosBarra. Este
    // marca al dueño y se llama 'barra' por historia.
    const porClaim = env.authenticatedContext('uid-staff-2', { rol: 'barra' }).firestore();
    await assertSucceeds(getDoc(doc(porClaim, 'barra/caja')));
  });
});

describe('colecciones no declaradas', () => {
  it('nadie puede escribir en una colección cualquiera', async () => {
    await assertFails(setDoc(doc(anon(), 'loquesea/x'), { a: 1 }));
    await assertFails(setDoc(doc(barra(), 'loquesea/x'), { a: 1 }));
  });
});
