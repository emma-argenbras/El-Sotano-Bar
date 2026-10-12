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
    await setDoc(doc(db, 'accesosBarra/uid-turno-ok'), { usuario: 'barra-lunes', activo: true });
    await setDoc(doc(db, 'accesosBarra/uid-turno-off'), { usuario: 'barra-viernes', activo: false });
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

  it('un usuario con claim rol=barra también entra (sin estar en la lista de mails)', async () => {
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
