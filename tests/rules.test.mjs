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
    await setDoc(doc(db, 'barra/eventos/items/ev-1'), {
      nombre: 'Noche', estado: 'agendado', capacidad: 100, entrada: 5000,
    });
    // Personal de turno: uno habilitado y uno apagado.
    await setDoc(doc(db, 'accesosBarra/uid-turno-ok'), { usuario: 'nico', activo: true, rol: 'barman' });
    await setDoc(doc(db, 'accesosBarra/uid-gerente'), { usuario: 'guille', activo: true, rol: 'admin' });
    await setDoc(doc(db, 'accesosBarra/uid-turno-off'), { usuario: 'ex-barman', activo: false, rol: 'barman' });
    await setDoc(doc(db, 'accesosBarra/uid-franco'), { usuario: 'franco', activo: true, rol: 'barman' });
    // Esta noche trabaja nico. Franco está registrado pero no asignado.
    await setDoc(doc(db, 'barra/turno'), { eventoId: 'ev-1', barmanes: ['uid-turno-ok', 'uid-puerta'] });
    await setDoc(doc(db, 'accesosBarra/uid-puerta'), { usuario: 'puerta', activo: true, rol: 'puerta' });
    await setDoc(doc(db, 'accesosBarra/uid-aparato'), { usuario: 'barra', activo: true, rol: 'barra' });
    await setDoc(doc(db, 'accesosBarra/uid-sadmin'), { usuario: 'guille', activo: true, rol: 'sadmin' });
    await setDoc(doc(db, 'accesosBarra/uid-recortado'), {
      usuario: 'recortado', activo: true, rol: 'admin',
      permisos: { caja: false, deposito: false, carta: false, calendario: false,
                  puerta: false, pedidos: false, noche: false },
    });
    // Administra la plata y nada más: ve Administración, no el Depósito.
    await setDoc(doc(db, 'accesosBarra/uid-soloplata'), {
      usuario: 'contadora', activo: true, rol: 'admin',
      permisos: { deposito: false, calendario: false },
    });
    await setDoc(doc(db, 'publico/registro'), { eventoId: 'ev-1', nombre: 'Noche' });
    await setDoc(doc(db, 'registros/ev-1'), {
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

// Un nivel más arriba que admin: el único que mueve permisos.
const sadmin = () => env.authenticatedContext('uid-sadmin', {
  email: 'guille@barra.local', provider_id: 'password',
}).firestore();

// Un admin con pantallas apagadas: es el caso que prueba que el interruptor
// frena de verdad y no es solo una pestaña escondida.
const recortado = () => env.authenticatedContext('uid-recortado', {
  email: 'recortado@barra.local', provider_id: 'password',
}).firestore();

const soloPlata = () => env.authenticatedContext('uid-soloplata', {
  email: 'contadora@barra.local', provider_id: 'password',
}).firestore();

const puerta = () => env.authenticatedContext('uid-puerta', {
  email: 'puerta@barra.local', provider_id: 'password',
}).firestore();

// El celular que vive en la barra: cuenta propia, siempre prendida.
const aparato = () => env.authenticatedContext('uid-aparato', {
  email: 'barra@barra.local', provider_id: 'password',
}).firestore();

const invitadoNuevo = (extra = {}) => ({
  eventoId: 'ev-1', nombre: 'Beto', telefono: '1155551111',
  creadoEn: serverTimestamp(), ...extra,
});

describe('alta del celular de la barra', () => {
  it('la casa lo registra como un rol más', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'accesosBarra/uid-aparato-2'),
      { usuario: 'barra2', activo: true, rol: 'barra' }));
  });

  it('un rol inventado sigue sin entrar', async () => {
    await assertFails(setDoc(doc(gerente(), 'accesosBarra/uid-raro'),
      { usuario: 'raro', activo: true, rol: 'dueño' }));
  });

  it('y el aparato no puede darse permisos a sí mismo', async () => {
    await assertFails(setDoc(doc(aparato(), 'accesosBarra/uid-aparato'),
      { usuario: 'barra', activo: true, rol: 'admin' }));
  });
});

describe('el celular de la barra', () => {
  const ventaDeMostrador = (extra = {}) => ({
    clienteId: 'uid-aparato', estado: 'entregado', origen: 'barra',
    items: [{ id: 'fernet', nombre: 'Fernet con coca', precio: 4500, cantidad: 1 }],
    total: 4500, pago: 'efectivo', vendidoPor: 'nico',
    cajaId: 'dia-2026-10-13', creadoEn: serverTimestamp(), ...extra,
  });

  // El bar vende todos los días, no solo las noches de evento: este aparato
  // no depende del turno.
  it('ve los pedidos sin estar asignado a ninguna noche', async () => {
    await assertSucceeds(getDocs(collection(aparato(), 'pedidos')));
  });

  it('lee el padrón: lo necesita para elegir quién atiende', async () => {
    await assertSucceeds(getDocs(collection(aparato(), 'accesosBarra')));
  });

  it('pero un barman cualquiera no lo lee', async () => {
    await assertFails(getDocs(collection(turnoOk(), 'accesosBarra')));
  });

  it('marca agotado como cualquier barman', async () => {
    await assertSucceeds(updateDoc(doc(aparato(), 'carta/fernet'), { disponible: false }));
  });

  it('carga una venta de mostrador, cobrada y entregada', async () => {
    await assertSucceeds(setDoc(doc(aparato(), 'pedidos/venta-mostrador-1'), ventaDeMostrador()));
  });

  it('pero NO una venta sin forma de pago', async () => {
    await assertFails(setDoc(doc(aparato(), 'pedidos/venta-sin-pago'),
      ventaDeMostrador({ pago: 'fiado' })));
    const { pago, ...sinPago } = ventaDeMostrador();
    await assertFails(setDoc(doc(aparato(), 'pedidos/venta-sin-pago-2'), sinPago));
  });

  it('un cliente NO puede hacerse pasar por una venta de barra', async () => {
    await assertFails(setDoc(doc(anon(), 'pedidos/venta-trucha'),
      ventaDeMostrador({ clienteId: 'cliente-anon-1' })));
  });

  it('al entregar deja la forma de pago y quién despachó', async () => {
    await assertSucceeds(updateDoc(doc(aparato(), 'pedidos/pedido-de-ana'), {
      estado: 'entregado', pago: 'virtual', vendidoPor: 'nico',
    }));
  });

  it('pero NO puede reescribir el total ni los items al cobrar', async () => {
    await assertFails(updateDoc(doc(aparato(), 'pedidos/pedido-de-ana'),
      { estado: 'entregado', total: 1 }));
    await assertFails(updateDoc(doc(aparato(), 'pedidos/pedido-de-ana'),
      { estado: 'entregado', items: [] }));
  });

  it('NO ve ni carga la plata que sale', async () => {
    await assertFails(getDocs(collection(aparato(), 'egresos')));
    await assertFails(setDoc(doc(aparato(), 'egresos/trucho'), {
      concepto: 'Retiro', categoria: 'retiro', monto: 50000,
      pago: 'efectivo', fecha: new Date(),
    }));
  });

  it('tampoco toca precios ni eventos', async () => {
    await assertFails(updateDoc(doc(aparato(), 'carta/fernet'), { precio: 1 }));
    await assertFails(setDoc(doc(aparato(), 'barra/eventos/items/inventado'), { nombre: 'Mía' }));
  });

  it('dado de baja, se queda afuera al toque', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'accesosBarra/uid-aparato'),
        { usuario: 'barra', activo: false, rol: 'barra' }));
    await assertFails(getDocs(collection(aparato(), 'pedidos')));
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'accesosBarra/uid-aparato'),
        { usuario: 'barra', activo: true, rol: 'barra' }));
  });
});

describe('el depósito', () => {
  const insumo = (extra = {}) => ({
    nombre: 'Fernet 750', unidad: 'botella', medidas: 10, stock: 50,
    costo: 12000, minimo: 20, creadoEn: serverTimestamp(), ...extra,
  });

  it('la casa da de alta un insumo', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'insumos/fernet-750'), insumo()));
  });

  it('toda la barra lo ve: necesita saber qué hay', async () => {
    await assertSucceeds(getDocs(collection(turnoOk(), 'insumos')));
    await assertSucceeds(getDocs(collection(aparato(), 'insumos')));
  });

  // Una botella tiene que dar al menos una medida: con cero, un trago
  // descontaría infinito.
  it('con medidas en cero NO', async () => {
    await assertFails(setDoc(doc(barra(), 'insumos/malo-1'), insumo({ medidas: 0 })));
  });

  it('con stock negativo tampoco', async () => {
    await assertFails(setDoc(doc(barra(), 'insumos/malo-2'), insumo({ stock: -5 })));
  });

  it('la barra descuenta al entregar, y nada más', async () => {
    await assertSucceeds(updateDoc(doc(aparato(), 'insumos/fernet-750'), { stock: 49 }));
    await assertFails(updateDoc(doc(aparato(), 'insumos/fernet-750'), { costo: 1 }));
    await assertFails(updateDoc(doc(turnoOk(), 'insumos/fernet-750'), { medidas: 99 }));
  });

  it('un cliente no ve el depósito', async () => {
    await assertFails(getDocs(collection(anon(), 'insumos')));
  });

  // El depósito lo carga un administrador, que no es el dueño: tiene cuenta
  // de usuario y contraseña, no mail de la casa. Si esto no anda, el alta
  // inicial no la puede hacer nadie más que el dueño.
  it('un administrador también da de alta y corrige, no solo el dueño', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'insumos/gancia-1l'),
      insumo({ nombre: 'Gancia 1L' })));
    await assertSucceeds(updateDoc(doc(gerente(), 'insumos/gancia-1l'),
      { nombre: 'Gancia 1L', unidad: 'botella', medidas: 8, stock: 12,
        costo: 9000, minimo: 4 }));
  });

  // El celular de la barra vive prendido arriba del mostrador y sin clave:
  // descuenta al entregar y nada más. Dar de alta mercadería y ponerle precio
  // es de quien se loguea con su cuenta.
  it('el celular de la barra NO da de alta mercadería', async () => {
    await assertFails(setDoc(doc(aparato(), 'insumos/trucho'), insumo()));
  });
});

describe('ingresos de mercadería y proveedores', () => {
  const compra = (extra = {}) => ({
    proveedor: 'Distribuidora Sur', proveedorId: 'prov-1',
    fecha: new Date(), total: 120000, condicion: 'cuenta',
    items: [{ insumoId: 'fernet-750', nombre: 'Fernet 750', unidades: 10, costoUnit: 12000 }],
    cargadoPor: 'emma', creadoEn: serverTimestamp(), ...extra,
  });

  it('la casa carga una compra a cuenta', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'compras/compra-1'), compra()));
  });

  it('y una al contado, con forma de pago', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'compras/compra-2'),
      compra({ condicion: 'contado', pago: 'efectivo' })));
  });

  it('y la carga inicial, que no es plata que salió', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'compras/compra-0'),
      compra({ condicion: 'inicial', total: 0 })));
  });

  it('y la que solo deja constancia, sin volver a sumar stock', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'compras/compra-3'),
      compra({ sinStock: true })));
  });

  it('pero sinStock tiene que ser sí o no, no cualquier cosa', async () => {
    await assertFails(setDoc(doc(barra(), 'compras/mala-3'),
      compra({ sinStock: 'puede ser' })));
  });

  it('con una condición inventada NO', async () => {
    await assertFails(setDoc(doc(barra(), 'compras/mala-1'),
      compra({ condicion: 'fiado' })));
  });

  it('sin items tampoco', async () => {
    await assertFails(setDoc(doc(barra(), 'compras/mala-2'), compra({ items: [] })));
  });

  it('la barra NO ve las compras: es plata, no servicio', async () => {
    await assertFails(getDocs(collection(turnoOk(), 'compras')));
    await assertFails(getDocs(collection(aparato(), 'compras')));
    await assertFails(setDoc(doc(aparato(), 'compras/trucha'), compra()));
  });

  it('el proveedor lo da de alta la casa y lo lee la barra', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'proveedores/prov-1'),
      { nombre: 'Distribuidora Sur', creadoEn: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(turnoOk(), 'proveedores/prov-1')));
    await assertFails(setDoc(doc(turnoOk(), 'proveedores/prov-2'), { nombre: 'Mía' }));
  });

  it('y un administrador también lo da de alta', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'proveedores/prov-3'),
      { nombre: 'Bebidas del Centro', creadoEn: serverTimestamp() }));
    // Pero el celular de la barra no: lo lee y nada más.
    await assertFails(setDoc(doc(aparato(), 'proveedores/prov-4'), { nombre: 'Trucha' }));
  });

  it('un pago a cuenta es un gasto con el proveedor apuntado', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'egresos/pago-1'), {
      concepto: 'Pago a Distribuidora Sur', categoria: 'proveedor',
      monto: 50000, pago: 'efectivo', fecha: new Date(),
      proveedorId: 'prov-1', cargadoPor: 'emma', creadoEn: serverTimestamp(),
    }));
  });
});

describe('bajas del depósito', () => {
  const baja = (extra = {}) => ({
    insumoId: 'fernet-750', nombre: 'Fernet 750', unidad: 'botella', stock: 3,
    motivo: 'lo cargué mal', quien: 'guille', cuando: serverTimestamp(), ...extra,
  });

  it('la casa da de baja un insumo y queda el motivo', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'bajas/baja-1'), baja()));
    await assertSucceeds(setDoc(doc(gerente(), 'bajas/baja-2'), baja()));
  });

  it('sin motivo NO: es lo único que queda después', async () => {
    await assertFails(setDoc(doc(barra(), 'bajas/mala-1'), baja({ motivo: '' })));
    await assertFails(setDoc(doc(barra(), 'bajas/mala-2'), baja({ motivo: 'x' })));
  });

  it('la barra no da de baja nada, ni lo lee', async () => {
    await assertFails(setDoc(doc(aparato(), 'bajas/trucha'), baja()));
    await assertFails(getDoc(doc(aparato(), 'bajas/baja-1')));
    await assertFails(setDoc(doc(turnoOk(), 'bajas/trucha-2'), baja()));
  });

  it('un cliente no ve las bajas', async () => {
    await assertFails(getDocs(collection(anon(), 'bajas')));
  });

  // Si se pudiera editar o borrar, no serviría de nada guardarla.
  it('una baja no se edita ni se borra, ni por el dueño', async () => {
    await assertFails(updateDoc(doc(barra(), 'bajas/baja-1'), { motivo: 'otra cosa' }));
    await assertFails(deleteDoc(doc(barra(), 'bajas/baja-1')));
  });

  it('el insumo lo borra la casa, no la barra', async () => {
    await assertFails(deleteDoc(doc(aparato(), 'insumos/fernet-750')));
    await assertSucceeds(deleteDoc(doc(gerente(), 'insumos/gancia-1l')));
  });
});

describe('el conteo de la noche', () => {
  const conteo = (extra = {}) => ({
    cajaId: 'ev-1', nombre: 'Noche',
    apertura: { fernet: 12, papas: 30 },
    aperturaEn: new Date(), aperturaPor: 'nico', ...extra,
  });

  it('lo carga quien atiende: tiene las botellas delante', async () => {
    await assertSucceeds(setDoc(doc(turnoOk(), 'conteos/ev-1'), conteo()));
    await assertSucceeds(setDoc(doc(aparato(), 'conteos/dia-2026-10-13'),
      conteo({ cajaId: 'dia-2026-10-13' })));
  });

  it('y lo cierra con el segundo conteo', async () => {
    await assertSucceeds(updateDoc(doc(turnoOk(), 'conteos/ev-1'), {
      cierre: { fernet: 9, papas: 24 }, cierreEn: new Date(), cierrePor: 'nico',
    }));
  });

  it('la casa lo lee', async () => {
    await assertSucceeds(getDoc(doc(barra(), 'conteos/ev-1')));
    await assertSucceeds(getDoc(doc(gerente(), 'conteos/ev-1')));
  });

  it('un cliente no: no es asunto suyo', async () => {
    await assertFails(getDoc(doc(anon(), 'conteos/ev-1')));
    await assertFails(setDoc(doc(anon(), 'conteos/trucho'), conteo()));
  });

  it('con campos inventados NO', async () => {
    await assertFails(setDoc(doc(turnoOk(), 'conteos/ev-9'),
      conteo({ cajaId: 'ev-9', loQueSea: true })));
  });

  it('el conteo NO toca el stock de la carta: es control, no inventario', async () => {
    // La barra puede ajustar stock por su cuenta, pero el conteo es otro
    // documento: guardar uno no cambia el otro.
    const antes = await getDoc(doc(barra(), 'carta/fernet'));
    await assertSucceeds(updateDoc(doc(turnoOk(), 'conteos/ev-1'),
      { cierre: { fernet: 0 } }));
    const despues = await getDoc(doc(barra(), 'carta/fernet'));
    assert.equal(despues.data().stock, antes.data().stock);
  });
});

describe('la plata que sale', () => {
  const egreso = (extra = {}) => ({
    concepto: 'Hielo', categoria: 'insumo', monto: 12000,
    pago: 'efectivo', fecha: new Date(), cargadoPor: 'emma',
    creadoEn: serverTimestamp(), ...extra,
  });

  it('la casa carga un egreso', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'egresos/egreso-1'), egreso()));
    await assertSucceeds(setDoc(doc(gerente(), 'egresos/egreso-2'), egreso({ cargadoPor: 'guille' })));
  });

  it('sin concepto, con monto cero o en negativo NO', async () => {
    await assertFails(setDoc(doc(barra(), 'egresos/egreso-malo-1'), egreso({ concepto: '' })));
    await assertFails(setDoc(doc(barra(), 'egresos/egreso-malo-2'), egreso({ monto: 0 })));
    await assertFails(setDoc(doc(barra(), 'egresos/egreso-malo-3'), egreso({ monto: -5000 })));
  });

  it('con una categoría inventada tampoco', async () => {
    await assertFails(setDoc(doc(barra(), 'egresos/egreso-malo-4'),
      egreso({ categoria: 'cualquiera' })));
  });

  it('el barman no los ve: es plata, no servicio', async () => {
    await assertFails(getDocs(collection(turnoOk(), 'egresos')));
    await assertFails(setDoc(doc(turnoOk(), 'egresos/trucho-2'), egreso()));
  });

  it('un cliente menos todavía', async () => {
    await assertFails(getDocs(collection(anon(), 'egresos')));
  });

  it('la casa puede corregirlo y borrarlo', async () => {
    await assertSucceeds(updateDoc(doc(gerente(), 'egresos/egreso-1'), { monto: 13000 }));
    await assertSucceeds(deleteDoc(doc(gerente(), 'egresos/egreso-2')));
  });
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

  // Cómo DIJO que va a pagar la entrada. Es un dato suyo, no plata cobrada:
  // quien cobra es la puerta, y por eso solo hay dos valores posibles.
  it('puede decir cómo va a pagar la entrada', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'invitados/token-pago-efectivo-1'),
      invitadoNuevo({ pago: 'efectivo' })));
    await assertSucceeds(setDoc(doc(sinLoguear(), 'invitados/token-pago-virtual-1'),
      invitadoNuevo({ pago: 'virtual' })));
  });

  it('con una forma de pago inventada NO', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-pago-trucho-11'),
      invitadoNuevo({ pago: 'gratis' })));
  });

  // Nadie se marca su propio pago: su QR depende de eso.
  it('no se puede anotar diciendo que ya pagó', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-ya-pague-1111'),
      invitadoNuevo({ pago: 'virtual', pagadoEn: serverTimestamp() })));
  });

  // La plata la confirma quien mira el banco, no quien está en la entrada.
  it('la barra confirma que la transferencia llegó, la puerta no', async () => {
    await setDoc(doc(barra(), 'invitados/token-a-cobrar-11111'),
      invitadoNuevo({ pago: 'virtual' }));
    await assertFails(updateDoc(doc(puerta(), 'invitados/token-a-cobrar-11111'),
      { pagadoEn: serverTimestamp(), pagadoPor: 'yo' }));
    await assertFails(updateDoc(doc(anon(), 'invitados/token-a-cobrar-11111'),
      { pagadoEn: serverTimestamp(), pagadoPor: 'yo' }));
    await assertSucceeds(updateDoc(doc(gerente(), 'invitados/token-a-cobrar-11111'),
      { pagadoEn: serverTimestamp(), pagadoPor: 'guille' }));
    // Y se puede deshacer, por si se confundió de persona.
    await assertSucceeds(updateDoc(doc(gerente(), 'invitados/token-a-cobrar-11111'),
      { pagadoEn: null, pagadoPor: null }));
  });

  it('confirmando el pago no se cuela otro cambio', async () => {
    await assertFails(updateDoc(doc(gerente(), 'invitados/token-a-cobrar-11111'),
      { pagadoEn: serverTimestamp(), nombre: 'Otro' }));
  });

  // El alias al que se transfiere lo lee cualquiera —hace falta para pagar—
  // pero lo escribe solo la casa.
  it('el alias de pago lo lee cualquiera y lo escribe la casa', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'publico/pagos'),
      { alias: 'sotano.bar.mp', titular: 'Sotano' }));
    await assertSucceeds(getDoc(doc(sinLoguear(), 'publico/pagos')));
    await assertFails(setDoc(doc(anon(), 'publico/pagos'), { alias: 'el.mio' }));
    await assertFails(setDoc(doc(turnoOk(), 'publico/pagos'), { alias: 'el.mio' }));
  });

  it('sin nombre o sin teléfono NO', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-4'), invitadoNuevo({ nombre: 'A' })));
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-5'), invitadoNuevo({ telefono: '12' })));
  });

  // Un solo formato: si uno escribe con 0 y otro sin, el candado del teléfono
  // no sirve, porque para la base son dos números distintos.
  it('con el 0 adelante NO', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-formato-tel-1xx'),
      invitadoNuevo({ telefono: '03454189066' })));
  });

  it('con el 15 NO', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-formato-tel-2xx'),
      invitadoNuevo({ telefono: '3454159066' + '12' })));
  });

  it('con el 54 del país NO', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-formato-tel-3xx'),
      invitadoNuevo({ telefono: '5493454189066' })));
  });

  it('con guiones o espacios NO: se guarda solo el número', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-formato-tel-4xx'),
      invitadoNuevo({ telefono: '3454 18-9066' })));
  });

  it('diez números pelados sí', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'invitados/token-formato-tel-5xx'),
      invitadoNuevo({ telefono: '3454189066' })));
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
    await assertSucceeds(updateDoc(doc(anon(), 'registros/ev-1'), { registrados: 2 }));
    await assertFails(updateDoc(doc(anon(), 'registros/ev-1'), { registrados: 50 }));
  });

  it('un invitado NO puede ampliar el cupo ni reabrir el registro', async () => {
    await assertFails(updateDoc(doc(anon(), 'registros/ev-1'), { capacidad: 999 }));
    await assertFails(updateDoc(doc(anon(), 'registros/ev-1'), { abierto: false }));
  });

  it('lleno, no entra nadie más', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 3, registrados: 3, abierto: true }));
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-8'), invitadoNuevo()));
  });

  it('cerrado el registro, tampoco', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 9, registrados: 0, abierto: false }));
    await assertFails(setDoc(doc(anon(), 'invitados/token-largo-de-prueba-9'), invitadoNuevo()));
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 9, registrados: 0, abierto: true }));
  });
});

describe('cada noche tiene su registro', () => {
  before(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'registros/ev-1'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 9, registrados: 0, abierto: true });
      await setDoc(doc(db, 'registros/ev-7'),
        { eventoId: 'ev-7', nombre: 'La otra', capacidad: 5, registrados: 0, abierto: true });
      await setDoc(doc(db, 'registros/ev-8'),
        { eventoId: 'ev-8', nombre: 'Ya pasó', capacidad: 5, registrados: 5, abierto: false });
    });
  });

  // Lo que hacía falta: dos noches tomando gente al mismo tiempo, cada una
  // por su link. Antes el registro era uno solo y el QR viejo llevaba al
  // evento nuevo.
  it('con dos noches abiertas, cada una anota en la suya', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'invitados/token-noche-uno-largo-x'),
      invitadoNuevo({ eventoId: 'ev-1', telefono: '1155557001' })));
    await assertSucceeds(setDoc(doc(anon(), 'invitados/token-noche-siete-larg'),
      invitadoNuevo({ eventoId: 'ev-7', telefono: '1155557002' })));
  });

  it('el mismo teléfono se anota a las dos: son noches distintas', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'anotados/ev-1__1155557003'),
      { eventoId: 'ev-1', tel: '1155557003', creadoEn: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(anon(), 'anotados/ev-7__1155557003'),
      { eventoId: 'ev-7', tel: '1155557003', creadoEn: serverTimestamp() }));
  });

  it('a una noche cerrada no entra nadie, aunque otra esté abierta', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-noche-ocho-largo-'),
      invitadoNuevo({ eventoId: 'ev-8', telefono: '1155557004' })));
  });

  it('a una noche que no existe tampoco', async () => {
    await assertFails(setDoc(doc(anon(), 'invitados/token-noche-fantasma-x'),
      invitadoNuevo({ eventoId: 'ev-no-existe', telefono: '1155557005' })));
  });

  it('el contador de una noche no lo mueve el de otra', async () => {
    await assertSucceeds(updateDoc(doc(anon(), 'registros/ev-7'), { registrados: 1 }));
    await assertFails(updateDoc(doc(anon(), 'registros/ev-7'), { registrados: 4 }));
    await assertFails(updateDoc(doc(anon(), 'registros/ev-8'), { registrados: 1 }));
  });

  it('cualquiera lee el registro de una noche: es lo que abre su link', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'registros/ev-7')));
  });

  it('pero NO la lista de todas las noches', async () => {
    await assertFails(getDocs(collection(anon(), 'registros')));
    await assertSucceeds(getDocs(collection(barra(), 'registros')));
  });

  it('un invitado NO puede crear ni ampliar una noche', async () => {
    await assertFails(setDoc(doc(anon(), 'registros/ev-inventada'),
      { eventoId: 'ev-inventada', nombre: 'Mía', capacidad: 99, registrados: 0, abierto: true }));
    await assertFails(updateDoc(doc(anon(), 'registros/ev-7'), { capacidad: 999 }));
    await assertFails(updateDoc(doc(anon(), 'registros/ev-7'), { abierto: false }));
  });

  it('la casa sí: abre, cierra y corrige', async () => {
    await assertSucceeds(updateDoc(doc(barra(), 'registros/ev-7'), { abierto: false }));
    await assertSucceeds(updateDoc(doc(barra(), 'registros/ev-7'), { abierto: true }));
  });
});

describe('un teléfono, una anotación', () => {
  const candado = (extra = {}) => ({
    eventoId: 'ev-1', tel: '1155553333', creadoEn: serverTimestamp(), ...extra,
  });

  it('el primero con ese teléfono entra', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'anotados/ev-1__1155553333'), candado()));
  });

  it('el segundo con el mismo teléfono rebota', async () => {
    await assertFails(setDoc(doc(otroAnon(), 'anotados/ev-1__1155553333'), candado()));
  });

  it('el mismo teléfono en otra noche sí: el candado es por evento', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-2'),
        { eventoId: 'ev-2', nombre: 'Otra', capacidad: 3, registrados: 0, abierto: true }));
    await assertSucceeds(setDoc(doc(anon(), 'anotados/ev-2__1155553333'),
      candado({ eventoId: 'ev-2' })));
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 3, registrados: 1, abierto: true }));
  });

  it('la llave tiene que ser la noche y el número, no cualquier cosa', async () => {
    await assertFails(setDoc(doc(anon(), 'anotados/cualquier-cosa'), candado({ tel: '1155554444' })));
    await assertFails(setDoc(doc(anon(), 'anotados/ev-1__1155554444'), candado({ tel: '1155559999' })));
  });

  it('no se puede anotar contra una noche que no es la del registro', async () => {
    await assertFails(setDoc(doc(anon(), 'anotados/ev-9__1155554444'),
      candado({ eventoId: 'ev-9', tel: '1155554444' })));
  });

  it('nadie de afuera puede leerlo: sería preguntar quién está en la lista', async () => {
    await assertFails(getDoc(doc(anon(), 'anotados/ev-1__1155553333')));
    await assertFails(getDocs(collection(anon(), 'anotados')));
  });

  it('la barra y la puerta sí lo leen', async () => {
    await assertSucceeds(getDocs(collection(barra(), 'anotados')));
    await assertSucceeds(getDocs(collection(puerta(), 'anotados')));
  });

  it('la casa lo libera si se anotó mal un número', async () => {
    await assertSucceeds(deleteDoc(doc(barra(), 'anotados/ev-1__1155553333')));
  });

  it('pisarlo no se puede ni siendo la casa: eso desarmaría el candado', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'anotados/ev-1__1155558888'),
        { eventoId: 'ev-1', tel: '1155558888', creadoEn: new Date() }));
    await assertFails(updateDoc(doc(barra(), 'anotados/ev-1__1155558888'), { tel: '1155550001' }));
    await assertFails(setDoc(doc(anon(), 'anotados/ev-1__1155558888'),
      { eventoId: 'ev-1', tel: '1155558888', creadoEn: serverTimestamp() }));
  });
});

describe('invitado de último momento', () => {
  it('la casa lo anota aunque esté lleno', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
        { eventoId: 'ev-1', nombre: 'Noche', capacidad: 1, registrados: 9, abierto: true }));
    await assertSucceeds(setDoc(doc(barra(), 'invitados/ultimo-momento-token-largo'), {
      eventoId: 'ev-1', nombre: 'Cami', telefono: '1155552222',
      creadoEn: serverTimestamp(), ingresadoEn: serverTimestamp(), ingresadoPor: 'guille',
    }));
  });

  it('la casa usa el mismo molde de teléfono', async () => {
    await assertFails(setDoc(doc(barra(), 'invitados/ultimo-momento-mal-tel-x'), {
      eventoId: 'ev-1', nombre: 'Mal Tel', telefono: '03454189066',
      creadoEn: serverTimestamp(),
    }));
  });

  it('pero puede anotar sin teléfono: en la puerta a veces no hay', async () => {
    await assertSucceeds(setDoc(doc(barra(), 'invitados/ultimo-momento-sin-tel'), {
      eventoId: 'ev-1', nombre: 'Sin Tel', telefono: '',
      creadoEn: serverTimestamp(),
    }));
  });

  it('y aunque el registro esté cerrado', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
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
      setDoc(doc(ctx.firestore(), 'registros/ev-1'),
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

  // Un pase, una entrada: el que reenvía su QR no mete a un amigo.
  it('un pase ya usado NO entra de nuevo', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'invitados/token-ya-uso-su-pase-xx'), {
        eventoId: 'ev-1', nombre: 'Lu', telefono: '1155556666',
        creadoEn: new Date(), ingresadoEn: new Date(), ingresadoPor: 'puerta',
      }));
    await assertFails(updateDoc(doc(puerta(), 'invitados/token-ya-uso-su-pase-xx'),
      { ingresadoEn: serverTimestamp(), ingresadoPor: 'puerta' }));
    await assertFails(updateDoc(doc(barra(), 'invitados/token-ya-uso-su-pase-xx'),
      { ingresadoEn: serverTimestamp(), ingresadoPor: 'admin' }));
  });

  it('pero deshacer sí, que la puerta se equivoca', async () => {
    await assertSucceeds(updateDoc(doc(puerta(), 'invitados/token-ya-uso-su-pase-xx'),
      { ingresadoEn: null, ingresadoPor: null }));
    // Y deshecho, vuelve a poder entrar una vez.
    await assertSucceeds(updateDoc(doc(puerta(), 'invitados/token-ya-uso-su-pase-xx'),
      { ingresadoEn: serverTimestamp(), ingresadoPor: 'puerta' }));
  });

  it('la puerta NO puede sacar a nadie de la lista', async () => {
    await assertFails(deleteDoc(doc(puerta(), 'invitados/token-ya-uso-su-pase-xx')));
  });

  it('la casa sí: se anotó dos veces, se saca', async () => {
    await assertSucceeds(deleteDoc(doc(barra(), 'invitados/token-ya-uso-su-pase-xx')));
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

  it('el administrador SÍ agenda noches y arma el turno', async () => {
    await assertSucceeds(setDoc(doc(gerente(), 'barra/eventos/items/ev-del-gerente'),
      { nombre: 'Noche del gerente', estado: 'agendado' }));
    await assertSucceeds(setDoc(doc(gerente(), 'barra/turno'),
      { eventoId: 'ev-1', barmanes: ['uid-turno-ok', 'uid-puerta'] }));
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

describe('sadmin: un nivel más arriba', () => {
  // La jerarquía tiene que estar en las reglas. Si vive solo en la pantalla,
  // alcanza con mandar la escritura a mano para saltearla.
  it('un sadmin hace todo lo que hace un admin', async () => {
    await assertSucceeds(setDoc(doc(sadmin(), 'carta/nuevo-del-sadmin'),
      { nombre: 'Algo', precio: 100, categoria: 'tragos', orden: 9 }));
    await assertSucceeds(getDocs(collection(sadmin(), 'egresos')));
  });

  it('solo un sadmin mueve permisos: un admin no', async () => {
    await assertSucceeds(updateDoc(doc(sadmin(), 'accesosBarra/uid-turno-ok'),
      { usuario: 'barra-lunes', activo: true, rol: 'barman', permisos: { caja: false } }));
    await assertFails(updateDoc(doc(gerente(), 'accesosBarra/uid-turno-ok'),
      { usuario: 'barra-lunes', activo: true, rol: 'barman', permisos: { caja: true } }));
  });

  // El candado que importa: sin esto, un admin se asciende solo y la
  // jerarquía no existe.
  it('un admin NO puede hacer sadmin a nadie', async () => {
    await assertFails(setDoc(doc(gerente(), 'accesosBarra/uid-nuevo-sadmin'),
      { usuario: 'colado', activo: true, rol: 'sadmin' }));
    await assertSucceeds(setDoc(doc(sadmin(), 'accesosBarra/uid-nuevo-sadmin'),
      { usuario: 'otro-sadmin', activo: true, rol: 'sadmin' }));
  });

  it('un admin NO puede degradar ni apagar a un sadmin', async () => {
    await assertFails(updateDoc(doc(gerente(), 'accesosBarra/uid-sadmin'),
      { usuario: 'guille', activo: true, rol: 'admin' }));
    await assertFails(updateDoc(doc(gerente(), 'accesosBarra/uid-sadmin'),
      { usuario: 'guille', activo: false, rol: 'sadmin' }));
  });

  // Nadie se toca lo suyo: ni para ascenderse ni para dejarse afuera.
  it('nadie edita su propio acceso, ni el sadmin', async () => {
    await assertFails(updateDoc(doc(sadmin(), 'accesosBarra/uid-sadmin'),
      { usuario: 'guille', activo: true, rol: 'sadmin', permisos: { caja: true } }));
    await assertFails(updateDoc(doc(gerente(), 'accesosBarra/uid-gerente'),
      { usuario: 'guille2', activo: true, rol: 'sadmin' }));
  });

  it('con un permiso inventado NO: ensuciaría el documento sin hacer nada', async () => {
    await assertFails(updateDoc(doc(sadmin(), 'accesosBarra/uid-turno-ok'),
      { usuario: 'barra-lunes', activo: true, rol: 'barman', permisos: { inventado: true } }));
  });
});

describe('las pantallas apagadas frenan de verdad', () => {
  // Esconder una pestaña no es un permiso: lo que importa es que el dato no
  // se pueda escribir igual mandando la operación a mano.
  it('sin caja no ve ni carga gastos', async () => {
    await assertFails(getDocs(collection(recortado(), 'egresos')));
    await assertFails(setDoc(doc(recortado(), 'egresos/colado'), {
      concepto: 'Retiro', categoria: 'retiro', monto: 1000,
      pago: 'efectivo', fecha: new Date(),
    }));
  });

  // La plata vive en Administración: quien tiene esa pantalla trabaja los
  // ingresos y los costos aunque no entre al Depósito.
  it('con Administración alcanza para los ingresos y los costos', async () => {
    await assertSucceeds(getDocs(collection(soloPlata(), 'compras')));
    await assertSucceeds(setDoc(doc(soloPlata(), 'compras/desde-admin'), {
      proveedor: 'Distri', fecha: new Date(), total: 1000, condicion: 'cuenta',
      items: [{ insumoId: 'fernet-750', nombre: 'Fernet', unidades: 1, costoUnit: 1000 }],
    }));
  });

  it('sin ninguna de las dos, las compras siguen cerradas', async () => {
    await assertFails(getDocs(collection(recortado(), 'compras')));
  });

  // El precio de la entrada es plata; la fecha y el cupo son del Calendario.
  it('desde Administración se toca el precio de la entrada y nada más', async () => {
    await assertSucceeds(updateDoc(
      doc(soloPlata(), 'barra/eventos/items/ev-1'), { entrada: 8000 }));
    await assertFails(updateDoc(
      doc(soloPlata(), 'barra/eventos/items/ev-1'), { entrada: 8000, capacidad: 999 }));
    await assertFails(updateDoc(
      doc(soloPlata(), 'barra/eventos/items/ev-1'), { capacidad: 999 }));
  });

  it('sin depósito no carga mercadería ni ve las compras', async () => {
    await assertFails(setDoc(doc(recortado(), 'insumos/colado'), {
      nombre: 'Colado', unidad: 'botella', medidas: 1, stock: 1, costo: 1,
    }));
    await assertFails(getDocs(collection(recortado(), 'compras')));
  });

  it('sin carta no toca precios', async () => {
    await assertFails(setDoc(doc(recortado(), 'carta/colado'),
      { nombre: 'Colado', precio: 1, categoria: 'tragos', orden: 1 }));
    await assertFails(updateDoc(doc(recortado(), 'carta/fernet'), { precio: 1 }));
  });

  it('sin calendario no agenda noches ni abre registros', async () => {
    await assertFails(setDoc(doc(recortado(), 'barra/eventos/items/ev-colado'),
      { nombre: 'Colada', estado: 'agendado' }));
    await assertFails(updateDoc(doc(recortado(), 'registros/ev-1'), { abierto: false }));
  });

  it('sin noche no arma el turno', async () => {
    await assertFails(setDoc(doc(recortado(), 'barra/turno'),
      { eventoId: 'ev-1', barmanes: [] }));
  });

  it('sin pedidos no mueve un pedido de estado', async () => {
    await assertFails(updateDoc(doc(recortado(), 'pedidos/pedido-de-ana'),
      { estado: 'en_preparacion' }));
  });

  // Y lo que no se apagó sigue andando: el recorte es de lo que se apagó, no
  // de la cuenta entera.
  it('lo que no se apagó sigue funcionando', async () => {
    await assertSucceeds(getDocs(collection(recortado(), 'insumos')));
    await assertSucceeds(getDoc(doc(recortado(), 'pedidos/pedido-de-ana')));
  });

  // Al sadmin no lo limita ningún interruptor: es el que reparte.
  it('al sadmin no lo recorta nadie', async () => {
    await assertSucceeds(getDocs(collection(sadmin(), 'egresos')));
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

  // Escribir bajo barra/ son dos cosas y dos pantallas: agendar noches es el
  // Calendario, y decir quién trabaja esta noche es la Noche. El comodín ya no
  // deja escribir nada más — si dejara, los interruptores no servirían.
  it('la casa escribe las noches y el turno, y nada más bajo barra/', async () => {
    await assertSucceeds(getDoc(doc(barra(), 'barra/caja')));
    await assertSucceeds(setDoc(doc(barra(), 'barra/eventos/items/ev-nuevo'),
      { nombre: 'Otra noche', estado: 'agendado' }));
    await assertSucceeds(setDoc(doc(barra(), 'barra/turno'),
      { eventoId: 'ev-1', barmanes: ['uid-turno-ok', 'uid-puerta'] }));
    await assertFails(setDoc(doc(barra(), 'barra/caja'), { abierta: true }));
    await assertFails(setDoc(doc(barra(), 'barra/inventado'), { x: 1 }));
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
