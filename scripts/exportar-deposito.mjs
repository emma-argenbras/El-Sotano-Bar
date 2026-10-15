// Saca a un Excel todo lo que hay en el depósito hoy: los insumos cargados y
// los ingresos de mercadería con los que entraron.
//
// Sirve para mirarlo fuera de la app y decidir si algo quedó mal cargado:
// la columna "Condición" dice si cada ingreso sumó plata (a cuenta / pagada)
// o solo stock (carga inicial).
//
//   node scripts/exportar-deposito.mjs            → deposito.csv acá
//   node scripts/exportar-deposito.mjs /ruta.csv  → donde quieras
//
// Es solo lectura: no toca nada.
import { iniciar } from './_admin.mjs';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'node:fs';

iniciar();
const db = getFirestore();
const salida = process.argv[2] || 'deposito.csv';

const fecha = (t) => t?.toDate?.().toLocaleDateString('es-AR') || '';
const num = (n) => String(Number(n || 0)).replace('.', ',');
// Excel en español separa con punto y coma; el BOM es para que no rompa
// los acentos al abrirlo.
const fila = (c) => c.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';');

const [insumos, compras, prov] = await Promise.all([
  db.collection('insumos').get(),
  db.collection('compras').get(),
  db.collection('proveedores').get(),
]);
const nombreProv = new Map(prov.docs.map((d) => [d.id, d.data().nombre]));

const lineas = [];

lineas.push(fila(['INSUMOS EN EL DEPÓSITO']));
lineas.push(fila(['Nombre', 'Unidad', 'Medidas por unidad', 'Stock (medidas)',
                  'Stock (unidades)', 'Costo por unidad', 'Mínimo']));
const porNombre = (a, b) => String(a.data().nombre).localeCompare(String(b.data().nombre));
for (const d of insumos.docs.sort(porNombre)) {
  const i = d.data();
  const medidas = Math.max(1, Number(i.medidas || 1));
  lineas.push(fila([i.nombre, i.unidad || '', medidas, num(i.stock),
                    num(Number(i.stock || 0) / medidas), num(i.costo), num(i.minimo)]));
}

lineas.push('');
lineas.push(fila(['INGRESOS DE MERCADERÍA']));
lineas.push(fila(['Fecha', 'Proveedor', 'Condición', 'Qué hizo con la plata',
                  'Producto', 'Unidades', 'Costo por unidad', 'Subtotal',
                  'Total del ingreso', 'Cargado por']));
const queHizo = {
  inicial: 'nada: solo sumó stock',
  cuenta: 'quedó como deuda con el proveedor',
  contado: 'salió de la caja',
};
const recientes = compras.docs
  .sort((a, b) => (b.data().fecha?.seconds || 0) - (a.data().fecha?.seconds || 0));
for (const d of recientes) {
  const c = d.data();
  const quien = c.proveedor || nombreProv.get(c.proveedorId) || 'Compra suelta';
  for (const it of c.items || []) {
    lineas.push(fila([fecha(c.fecha), quien, c.condicion, queHizo[c.condicion] || '',
                      it.nombre, num(it.unidades), num(it.costoUnit),
                      num(Number(it.unidades || 0) * Number(it.costoUnit || 0)),
                      num(c.total), c.cargadoPor || '']));
  }
}

writeFileSync(salida, '﻿' + lineas.join('\r\n'), 'utf8');
console.log(`${insumos.size} insumos y ${compras.size} ingresos → ${salida}`);
