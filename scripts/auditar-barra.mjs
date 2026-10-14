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
});

const aparato = () => env.authenticatedContext('uid-aparato',
  { email: 'barra@barra.local', provider_id: 'password' }).firestore();

const db = aparato();
const puede = async (que, fn) => {
  try { await fn(); return { que, ok: true }; }
  catch { return { que, ok: false }; }
};

const pruebas = [
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
  ['DEBE  dar de alta mercadería (hace la carga inicial)', () => setDoc(doc(db, 'insumos/nuevo'), { nombre: 'Gancia', unidad: 'botella', medidas: 8, stock: 1, costo: 1 })],
  ['DEBE  corregir un insumo', () => setDoc(doc(db, 'insumos/f750'), { nombre: 'Fernet 750', unidad: 'botella', medidas: 10, stock: 49, costo: 13000, minimo: 5 })],
  ['DEBE  ver las compras que cargó', () => getDocs(collection(db, 'compras'))],
  ['DEBE  hacer la carga inicial', () => setDoc(doc(db, 'compras/c-inicial'), { proveedor: 'X', fecha: new Date(), total: 0, condicion: 'inicial', items: [{ insumoId: 'f750', nombre: 'F', unidades: 1, costoUnit: 1 }], cargadoPor: 'x', creadoEn: serverTimestamp() })],
  ['DEBE  cargar una compra a cuenta', () => setDoc(doc(db, 'compras/c-cuenta'), { proveedor: 'X', proveedorId: 'p1', fecha: new Date(), total: 1, condicion: 'cuenta', items: [{ insumoId: 'f750', nombre: 'F', unidades: 1, costoUnit: 1 }], cargadoPor: 'x', creadoEn: serverTimestamp() })],
  // Una compra pagada descuenta de la caja, y la caja no es suya: entraría la
  // compra y no el gasto, y la plata se perdería de los libros.
  ['NO    cargar una compra pagada (sale de la caja)', () => setDoc(doc(db, 'compras/c2'), { proveedor: 'X', fecha: new Date(), total: 1, condicion: 'contado', pago: 'efectivo', items: [{ insumoId: 'f750', nombre: 'F', unidades: 1, costoUnit: 1 }], cargadoPor: 'x', creadoEn: serverTimestamp() })],
  ['NO    ver los gastos (es la caja)', () => getDocs(collection(db, 'egresos'))],
  ['NO    borrar una compra', () => deleteDoc(doc(db, 'compras/c1'))],
  ['NO    cargar un gasto', () => setDoc(doc(db, 'egresos/e2'), { concepto: 'Retiro', categoria: 'retiro', monto: 1, pago: 'efectivo', fecha: new Date() })],
  ['DEBE  dar de alta proveedores', () => setDoc(doc(db, 'proveedores/p2'), { nombre: 'Otro' })],
  ['NO    agendar una noche', () => setDoc(doc(db, 'barra/eventos/items/ev-2'), { nombre: 'X', estado: 'agendado' })],
  ['NO    abrir o cerrar el registro de una noche', () => updateDoc(doc(db, 'registros/ev-1'), { abierto: false })],
  ['NO    dar de alta personal', () => setDoc(doc(db, 'accesosBarra/uid-nuevo'), { usuario: 'x', activo: true, rol: 'admin' })],
  ['NO    dar de baja a alguien', () => updateDoc(doc(db, 'accesosBarra/uid-gerente'), { activo: false })],
  ['NO    borrar un invitado de la lista', () => deleteDoc(doc(db, 'invitados/token-de-prueba-larguisimo'))],
  ['NO    cambiar el alias de cobro', () => setDoc(doc(db, 'publico/pagos'), { alias: 'el.mio' })],
  ['NO    cortar los pedidos del local', () => setDoc(doc(db, 'publico/estado'), { tomandoPedidos: false })],
];

const r = await Promise.all(pruebas.map(([q, f]) => puede(q, f)));
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
