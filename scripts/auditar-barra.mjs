// Auditoría del celular de la barra: qué puede hacer de verdad, probado contra
// el emulador con las reglas reales. No lee las reglas: las ejerce.
//
//   npx firebase emulators:exec --only firestore --project demo-el-sotano \
//     "node scripts/auditar-barra.mjs"
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp,
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-el-sotano',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'accesosBarra/uid-aparato'), { usuario: 'barra', activo: true, rol: 'barra' });
  await setDoc(doc(db, 'accesosBarra/uid-sadmin'), { usuario: 'guille', activo: true, rol: 'sadmin' });
  await setDoc(doc(db, 'accesosBarra/uid-turno-ok'), { usuario: 'barra-lunes', activo: true, rol: 'barman' });
  await setDoc(doc(db, 'accesosBarra/uid-recortado'), {
    usuario: 'recortado', activo: true, rol: 'admin',
    permisos: { caja: false, deposito: false, carta: false, calendario: false,
                puerta: false, pedidos: false, noche: false },
  });
  await setDoc(doc(db, 'accesosBarra/uid-gerente'), { usuario: 'guille', activo: true, rol: 'admin' });
  await setDoc(doc(db, 'carta/fernet'), { nombre: 'Fernet', precio: 4500, categoria: 'tragos', disponible: true, stock: 10, orden: 1 });
  await setDoc(doc(db, 'insumos/f750'), { nombre: 'Fernet 750', unidad: 'botella', medidas: 10, stock: 50, costo: 12000, minimo: 5 });
  await setDoc(doc(db, 'proveedores/p1'), { nombre: 'Distribuidora' });
  await setDoc(doc(db, 'compras/c1'), { proveedor: 'D', proveedorId: 'p1', fecha: new Date(), total: 1, condicion: 'contado', pago: 'efectivo', items: [{ insumoId: 'f750', nombre: 'F', unidades: 1, costoUnit: 1 }], cargadoPor: 'x', creadoEn: serverTimestamp() });
  await setDoc(doc(db, 'egresos/e1'), { concepto: 'Hielo', categoria: 'insumo', monto: 100, pago: 'efectivo', fecha: new Date() });
  await setDoc(doc(db, 'registros/ev-1'), { eventoId: 'ev-1', nombre: 'Noche', capacidad: 10, registrados: 0, abierto: true });
  await setDoc(doc(db, 'invitados/token-de-prueba-larguisimo'), { eventoId: 'ev-1', nombre: 'Beto', telefono: '1155551111', creadoEn: serverTimestamp(), pago: 'virtual' });
  await setDoc(doc(db, 'barra/eventos'), { x: 1 });
  await setDoc(doc(db, 'barra/eventos/items/ev-1'), { nombre: 'Noche', estado: 'abierto', capacidad: 10 });
  await setDoc(doc(db, 'publico/estado'), { tomandoPedidos: true });
  await setDoc(doc(db, 'publico/pagos'), { alias: 'x.y.z' });
  await setDoc(doc(db, 'conteos/caja-1'), { cajaId: 'c', nombre: 'Noche', apertura: {} });
  await setDoc(doc(db, 'pedidos/pedido-1'), { clienteId: 'x', estado: 'nuevo', total: 100,
    items: [{ id: 'fernet', nombre: 'Fernet', precio: 100, cantidad: 1 }], mesa: '1', creadoEn: serverTimestamp() });
});

const aparato = () => env.authenticatedContext('uid-aparato',
  { email: 'barra@barra.local', provider_id: 'password' }).firestore();

const db = aparato();
const puede = async (que, fn) => {
  try { await fn(); return { que, ok: true }; }
  catch { return { que, ok: false }; }
};

let pruebas = [
  // Lo que SÍ definimos para el celular de la barra.
  ['DEBE  leer la carta', () => getDocs(collection(db, 'carta'))],
  ['DEBE  marcar agotado / ajustar stock', () => updateDoc(doc(db, 'carta/fernet'), { stock: 9 })],
  ['DEBE  ver los pedidos', () => getDocs(collection(db, 'pedidos'))],
  ['DEBE  ver la noche en curso', () => getDoc(doc(db, 'barra/eventos/items/ev-1'))],
  ['DEBE  ver el depósito (para saber qué hay)', () => getDocs(collection(db, 'insumos'))],
  ['DEBE  descontar al entregar', () => updateDoc(doc(db, 'insumos/f750'), { stock: 49 })],
  ['DEBE  cargar el conteo de la noche', () => setDoc(doc(db, 'conteos/caja-2'), { cajaId: 'c', nombre: 'Noche', apertura: { f750: 4 }, aperturaPor: 'guille' })],
  ['DEBE  leer el conteo de la noche', () => getDoc(doc(db, 'conteos/caja-1'))],
  ['DEBE  leer los nombres del personal (para elegir quién atiende)', () => getDocs(collection(db, 'accesosBarra'))],

  // Lo que NO tiene que poder.
  ['NO    cambiar precios de la carta', () => updateDoc(doc(db, 'carta/fernet'), { precio: 1 })],
  ['NO    dar de alta un producto', () => setDoc(doc(db, 'carta/nuevo'), { nombre: 'X', precio: 1, categoria: 'c', orden: 1 })],
  ['NO    borrar un producto', () => deleteDoc(doc(db, 'carta/fernet'))],
  ['NO    dar de alta mercadería', () => setDoc(doc(db, 'insumos/nuevo'), { nombre: 'X', unidad: 'u', medidas: 1, stock: 1, costo: 1 })],
  ['NO    cambiar el costo de un insumo', () => updateDoc(doc(db, 'insumos/f750'), { costo: 1 })],
  ['NO    ver las compras (es plata)', () => getDocs(collection(db, 'compras'))],
  ['NO    cargar una compra', () => setDoc(doc(db, 'compras/c2'), { proveedor: 'X', fecha: new Date(), total: 1, condicion: 'contado', pago: 'efectivo', items: [{ insumoId: 'f750', nombre: 'F', unidades: 1, costoUnit: 1 }], cargadoPor: 'x', creadoEn: serverTimestamp() })],
  ['NO    ver los gastos (es plata)', () => getDocs(collection(db, 'egresos'))],
  ['NO    cargar un gasto', () => setDoc(doc(db, 'egresos/e2'), { concepto: 'Retiro', categoria: 'retiro', monto: 1, pago: 'efectivo', fecha: new Date() })],
  ['NO    dar de alta proveedores', () => setDoc(doc(db, 'proveedores/p2'), { nombre: 'Otro' })],
  ['NO    agendar una noche', () => setDoc(doc(db, 'barra/eventos/items/ev-2'), { nombre: 'X', estado: 'agendado' })],
  ['NO    abrir o cerrar el registro de una noche', () => updateDoc(doc(db, 'registros/ev-1'), { abierto: false })],
  ['NO    dar de alta personal', () => setDoc(doc(db, 'accesosBarra/uid-nuevo'), { usuario: 'x', activo: true, rol: 'admin' })],
  ['NO    dar de baja a alguien', () => updateDoc(doc(db, 'accesosBarra/uid-gerente'), { activo: false })],
  ['NO    borrar un invitado de la lista', () => deleteDoc(doc(db, 'invitados/token-de-prueba-larguisimo'))],
  ['NO    cambiar el alias de cobro', () => setDoc(doc(db, 'publico/pagos'), { alias: 'el.mio' })],
  ['NO    cortar los pedidos del local', () => setDoc(doc(db, 'publico/estado'), { tomandoPedidos: false })],
];

// ---- Un admin con todas las pantallas apagadas ----
// Esconder una pestaña no es un permiso: lo que vale es que el dato no se
// pueda escribir igual mandando la operación a mano.
const rec = env.authenticatedContext('uid-recortado',
  { email: 'recortado@barra.local', provider_id: 'password' }).firestore();

const delRecortado = [
  ['NO    (recortado) ver ni cargar gastos', () => getDocs(collection(rec, 'egresos'))],
  ['NO    (recortado) cargar mercadería', () => setDoc(doc(rec, 'insumos/colado'), { nombre: 'Colado', unidad: 'u', medidas: 1, stock: 1, costo: 1 })],
  ['NO    (recortado) tocar precios', () => updateDoc(doc(rec, 'carta/fernet'), { precio: 1 })],
  ['NO    (recortado) agendar una noche', () => setDoc(doc(rec, 'barra/eventos/items/ev-colado'), { nombre: 'Colada', estado: 'agendado' })],
  ['NO    (recortado) armar el turno', () => setDoc(doc(rec, 'barra/turno'), { eventoId: 'ev-1', barmanes: [] })],
  ['NO    (recortado) mover un pedido', () => updateDoc(doc(rec, 'pedidos/pedido-1'), { estado: 'en_preparacion' })],
  ['NO    (recortado) repartir permisos', () => updateDoc(doc(rec, 'accesosBarra/uid-aparato'), { usuario: 'barra', activo: true, rol: 'barra', permisos: { caja: true } })],
  ['NO    (recortado) ascenderse a sadmin', () => updateDoc(doc(rec, 'accesosBarra/uid-recortado'), { usuario: 'recortado', activo: true, rol: 'sadmin' })],
  ['DEBE  (recortado) seguir viendo lo que no se le apagó', () => getDocs(collection(rec, 'insumos'))],
];

// ---- El sadmin, que es el que reparte ----
const sad = env.authenticatedContext('uid-sadmin',
  { email: 'guille@barra.local', provider_id: 'password' }).firestore();

const delSadmin = [
  ['DEBE  (sadmin) repartir permisos', () => updateDoc(doc(sad, 'accesosBarra/uid-turno-ok'), { usuario: 'barra-lunes', activo: true, rol: 'barman', permisos: { caja: false } })],
  ['DEBE  (sadmin) ver la caja sin que nadie lo recorte', () => getDocs(collection(sad, 'egresos'))],
  ['NO    (sadmin) editar su propio acceso', () => updateDoc(doc(sad, 'accesosBarra/uid-sadmin'), { usuario: 'guille', activo: true, rol: 'sadmin', permisos: { caja: true } })],
];

pruebas.push(...delRecortado, ...delSadmin);

// Una por una, no todas juntas: comparten la misma base y una prueba que
// escribe le cambia el piso a la que estaba leyendo.
const r = [];
for (const [q, f] of pruebas) r.push(await puede(q, f));
let mal = 0;
console.log('\nCELULAR DE LA BARRA — lo que puede hacer de verdad\n');
for (const { que, ok } of r) {
  const esperado = que.startsWith('DEBE');
  const bien = ok === esperado;
  if (!bien) mal += 1;
  console.log(`${bien ? '✓' : '✗ OJO'}  ${que} → ${ok ? 'PUEDE' : 'no puede'}`);
}
console.log(mal ? `\n✗ ${mal} permiso(s) fuera de lo definido` : '\n✓ Todo como lo definimos');
await env.cleanup();
process.exit(mal ? 1 : 0);
