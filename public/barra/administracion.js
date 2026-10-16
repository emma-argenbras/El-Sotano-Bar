import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '/vendor/firebase.js';
import { $, esc, estado, plata } from './base.js';
import { EVENTOS, app, db, fallo } from './conexion.js';
import { comoSeDice } from './deposito.js';
import { noches } from './eventos.js';
import { cajaActual } from './pedidos.js';

// ---------- la caja de Sótano ----------
//
// Acá va toda la plata: la de los eventos y la de los días comunes, lo que
// entra y lo que sale. El número que importa no es lo facturado: es lo que
// debería haber en el cajón.
export function desdeDelRango() {
  const ahora = new Date();
  if (estado.rangoCaja === 'hoy') {
    // El día del bar corta a las 6: lo de las 3 AM es de la noche anterior.
    const d = new Date(ahora.getTime() - 6 * 3600 * 1000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 0, 0);
  }
  if (estado.rangoCaja === 'mes') return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  return new Date(ahora.getFullYear() - 2, 0, 1);
}

export let mirandoCaja = null;
export function escucharCaja() {
  const desde = desdeDelRango();
  const clave = `${estado.rangoCaja}:${desde.getTime()}`;
  if (mirandoCaja === clave) return;
  mirandoCaja = clave;
  if (estado.cortarCaja) estado.cortarCaja();

  const q = query(collection(db, 'pedidos'),
    where('estado', '==', 'entregado'),
    where('creadoEn', '>=', Timestamp.fromDate(desde)),
    orderBy('creadoEn', 'desc'));
  const cortarPedidos = onSnapshot(q, (snap) => {
    estado.pedidosCaja = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarCajaGeneral();
  }, fallo('#caja'));

  const cortarEgresos = onSnapshot(
    query(collection(db, 'egresos'), where('fecha', '>=', Timestamp.fromDate(desde))),
    (snap) => {
      estado.egresos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
      pintarCajaGeneral();
    }, () => {});

  estado.cortarCaja = () => { cortarPedidos(); cortarEgresos(); };
}

export function resumirPlata() {
  const ventas = estado.pedidosCaja || [];
  const suma = (lista, como) => lista
    .filter((x) => !como || x.pago === como)
    .reduce((a, x) => a + Number(x.total ?? x.monto ?? 0), 0);

  const entra = suma(ventas);
  const entraEfectivo = suma(ventas, 'efectivo');
  const entraVirtual = suma(ventas, 'virtual');
  // Lo viejo no tiene forma de pago: se dice aparte en vez de inventarla.
  const sinForma = entra - entraEfectivo - entraVirtual;

  const sale = suma(estado.egresos);
  const saleEfectivo = suma(estado.egresos, 'efectivo');

  return {
    entra, entraEfectivo, entraVirtual, sinForma,
    sale, saleEfectivo,
    saldo: entra - sale,
    enCajon: entraEfectivo - saleEfectivo,
    ventas: ventas.length,
  };
}

// Quién vendió cuánto. Solo sirve si la barra eligió quién atiende, así que
// cuando falta se dice en vez de mostrar un ranking mentiroso.
export function porBarman(ventas) {
  const m = new Map();
  for (const v of ventas) {
    const quien = v.vendidoPor || '—';
    const a = m.get(quien) || { cantidad: 0, importe: 0 };
    a.cantidad += 1;
    a.importe += Number(v.total || 0);
    m.set(quien, a);
  }
  return [...m].sort((a, b) => b[1].importe - a[1].importe);
}

export function pintarCajaGeneral() {
  const cont = $('#caja');
  if (!cont || $('#vistaCaja').hidden) return;
  escucharCaja();
  const r = resumirPlata();
  const rangos = { hoy: 'Hoy', mes: 'Este mes', todo: 'Todo' };
  const gente = porBarman(estado.pedidosCaja || []);

  cont.innerHTML = `
    <div class="tabs chicas">
      ${Object.entries(rangos).map(([k, t]) => `
        <button data-rango="${k}" aria-selected="${estado.rangoCaja === k}">${t}</button>`).join('')}
    </div>

    <div class="caja-evento">
      <div class="titulo">${rangos[estado.rangoCaja]}</div>
      <div class="desde">${r.ventas} venta${r.ventas === 1 ? '' : 's'} cobrada${r.ventas === 1 ? '' : 's'}</div>
      <div class="numeros">
        <div class="plata"><b>${plata(r.entra)}</b><span>entró</span></div>
        <div><b>${plata(r.sale)}</b><span>salió</span></div>
        <div class="plata"><b>${plata(r.saldo)}</b><span>queda</span></div>
      </div>
      <table class="ranking" style="margin-top:.8rem"><tbody>
        <tr><td>💵 Efectivo</td><td class="n">${plata(r.entraEfectivo)}</td></tr>
        <tr><td>📲 Virtual</td><td class="n">${plata(r.entraVirtual)}</td></tr>
        ${r.sinForma ? `<tr><td>Sin forma de pago <small>(antes de que se pidiera)</small></td>
          <td class="n">${plata(r.sinForma)}</td></tr>` : ''}
      </tbody></table>
      <div class="interruptor" style="margin-top:.9rem">
        <div>
          <b>En el cajón debería haber ${plata(r.enCajon)}</b>
          <span>Efectivo cobrado menos los gastos pagados en efectivo.</span>
        </div>
      </div>
    </div>

    <div class="grupo-personal">Alias para transferencias</div>
    <p style="color:var(--suave);font-size:.84rem;margin:0 0 .5rem">
      El que ve el invitado en su pase cuando elige pagar la entrada por
      transferencia. Si está vacío, solo se le ofrece pagar en la puerta.
    </p>
    <label class="campo">
      <span>Alias o CBU</span>
      <input id="inpAlias" maxlength="60" autocomplete="off"
             placeholder="ej. sotano.bar.mp" value="${esc(estado.pagos.alias || '')}">
    </label>
    <label class="campo">
      <span>A nombre de <small>(opcional, para que sepa que no se equivocó)</small></span>
      <input id="inpAliasTitular" maxlength="60" autocomplete="off"
             value="${esc(estado.pagos.titular || '')}">
    </label>
    <button class="btn ancho-full" id="btnGuardarAlias" style="margin-bottom:.4rem">Guardar alias</button>

    <div class="grupo-personal" style="display:flex;align-items:center;gap:.6rem">
      <span style="flex:1">Gastos</span>
      <button class="btn" id="btnNuevoEgreso" style="padding:.25rem .6rem;font-size:.72rem;text-transform:none;letter-spacing:0">
        + Cargar gasto</button>
    </div>
    ${estado.egresos.length ? estado.egresos.map((e) => `
      <div class="item">
        <div class="cuerpo">
          <div class="nombre">${esc(e.concepto)}</div>
          <div class="desc">${e.fecha?.toDate?.()?.toLocaleDateString('es-AR') || ''}
            · ${esc(e.categoria)} · ${e.pago === 'efectivo' ? '💵' : '📲'}
            ${e.cargadoPor ? ' · ' + esc(e.cargadoPor) : ''}</div>
        </div>
        <div class="total">−${plata(e.monto)}</div>
        <button class="btn peligro" data-borrar-egreso="${esc(e.id)}"
                style="padding:.3rem .6rem;font-size:.78rem">✕</button>
      </div>`).join('')
      : '<p style="color:var(--suave);font-size:.9rem">Sin gastos cargados en este período.</p>'}

    ${gente.length ? `
      <div class="grupo-personal">Quién vendió</div>
      <table class="ranking"><tbody>${gente.map(([quien, g]) => `
        <tr><td>${quien === '—' ? '<i>sin registrar</i>' : esc(quien)}</td>
            <td class="n">${g.cantidad}</td><td class="n">${plata(g.importe)}</td></tr>`).join('')}
      </tbody></table>` : ''}`;

  cont.querySelectorAll('[data-rango]').forEach((b) => b.onclick = () => {
    estado.rangoCaja = b.dataset.rango;
    pintarCajaGeneral();
  });
  $('#btnNuevoEgreso').onclick = abrirEgreso;
  $('#btnGuardarAlias').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await setDoc(doc(db, 'publico', 'pagos'), {
        alias: $('#inpAlias').value.trim(),
        titular: $('#inpAliasTitular').value.trim(),
      });
      b.textContent = 'Guardado ✓';
    } catch (err) {
      b.disabled = false; b.textContent = 'Guardar alias';
      alert('No se pudo: ' + (err.code || err.message));
    }
  };
  cont.querySelectorAll('[data-borrar-egreso]').forEach((b) => b.onclick = async () => {
    const e = estado.egresos.find((x) => x.id === b.dataset.borrarEgreso);
    if (!e || !confirm(`¿Borrar el gasto "${e.concepto}" de ${plata(e.monto)}?`)) return;
    try { await deleteDoc(doc(db, 'egresos', e.id)); }
    catch (err) { alert('No se pudo: ' + (err.code || err.message)); }
  });
}

// ---------- la plata que sale ----------
export function abrirEgreso() {
  $('#inpEgrConcepto').value = '';
  $('#inpEgrMonto').value = '';
  $('#inpEgrCategoria').value = 'insumo';
  // Elegir proveedor es lo que convierte un gasto en un pago a cuenta.
  $('#inpEgrProveedor').innerHTML = '<option value="">— ninguno —</option>'
    + estado.proveedores.map((p) => {
        const s = saldoProveedor(p.id);
        return `<option value="${esc(p.id)}">${esc(p.nombre)}${s ? ` — debe ${plata(s)}` : ''}</option>`;
      }).join('');
  $('#dlgEgreso').showModal();
  $('#inpEgrConcepto').focus();
}

export async function guardarEgreso() {
  const concepto = $('#inpEgrConcepto').value.trim();
  const monto = Math.round(Number($('#inpEgrMonto').value) || 0);
  if (concepto.length < 2) { $('#inpEgrConcepto').focus(); return; }
  if (monto <= 0) { $('#inpEgrMonto').focus(); return; }
  const btn = $('#btnGuardarEgreso');
  btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    const proveedorId = $('#inpEgrProveedor').value;
    await addDoc(collection(db, 'egresos'), {
      concepto, monto,
      ...(proveedorId ? { proveedorId } : {}),
      categoria: $('#inpEgrCategoria').value,
      pago: document.querySelector('input[name="egrPago"]:checked').value,
      fecha: Timestamp.fromDate(new Date()),
      cajaId: cajaActual(),
      cargadoPor: estado.usuario || 'casa',
      creadoEn: serverTimestamp(),
    });
    $('#dlgEgreso').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  btn.disabled = false; btn.textContent = 'Cargar';
}

export let yaEscuchaPlataDeposito = false;
export function escucharPlataDeposito() {
  if (yaEscuchaPlataDeposito) return;
  yaEscuchaPlataDeposito = true;

  // Los gastos con proveedor apuntado son los pagos a cuenta: hacen falta
  // completos, no solo los del rango que esté mirando la caja.
  //
  // A quien tiene apagada la pantalla de Caja las reglas se los niegan, y sin
  // los pagos la cuenta corriente daría la deuda entera: mostraría que se
  // debe plata que ya se pagó. Cuando pasa, el depósito no muestra cuentas.
  onSnapshot(collection(db, 'egresos'), (snap) => {
    estado.egresosTodos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.sinPagos = false;
    pintarAdmin();
  }, () => { estado.sinPagos = true; pintarAdmin(); });

  // El alias al que transfieren la entrada. Vive en publico/ porque el
  // invitado lo tiene que poder leer sin cuenta: es lo único que necesita
  // para pagar.
  onSnapshot(doc(db, 'publico', 'pagos'), (d) => {
    estado.pagos = d.exists() ? d.data() : {};
    pintarCajaGeneral();
  }, () => {});
  onSnapshot(collection(db, 'proveedores'), (snap) => {
    estado.proveedores = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    pintarAdmin();
  }, () => {});
  onSnapshot(collection(db, 'compras'), (snap) => {
    estado.compras = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
    pintarAdmin();
  }, () => {});
}

// La cuenta corriente sale de dos cosas que ya existen: lo que se compró a
// cuenta y lo que se le pagó (un gasto con ese proveedor apuntado).
//
// Un gasto con compraId adentro NO es un pago a cuenta: es la compra que se
// pagó en el acto, que nunca generó deuda. Contarlo bajaba una deuda que
// seguía estando: le comás $50.000 al contado al mismo que ya le debías
// $100.000 y la app te decía que debías $50.000.
export const esPagoACuenta = (e) => !!e.proveedorId && !e.compraId;

export function pagosProveedor(id) {
  return (estado.egresosTodos || []).filter((e) => e.proveedorId === id && esPagoACuenta(e));
}

export function comprasACuenta(id) {
  return estado.compras.filter((c) => c.proveedorId === id && c.condicion === 'cuenta');
}

export function saldoProveedor(id) {
  const debe = comprasACuenta(id).reduce((a, c) => a + Number(c.total || 0), 0);
  const pagado = pagosProveedor(id).reduce((a, e) => a + Number(e.monto || 0), 0);
  return debe - pagado;
}

// El resumen de cuenta: cada compra a cuenta suma, cada pago resta, y al lado
// de cada renglón queda cuánto se debía en ese momento. Sin esto el saldo es
// un número que hay que creer; con esto se puede discutir con el proveedor.
export function movimientosProveedor(id) {
  const movs = [
    ...comprasACuenta(id).map((c) => ({
      cuando: c.fecha?.seconds || 0,
      fecha: c.fecha?.toDate?.().toLocaleDateString('es-AR') || '',
      detalle: `Mercadería · ${(c.items || []).length} producto${
        (c.items || []).length === 1 ? '' : 's'}`,
      debe: Number(c.total || 0), haber: 0,
    })),
    ...pagosProveedor(id).map((e) => ({
      cuando: e.fecha?.seconds || 0,
      fecha: e.fecha?.toDate?.().toLocaleDateString('es-AR') || '',
      detalle: `Pago · ${e.concepto || ''}${e.pago === 'virtual' ? ' (virtual)' : ''}`,
      debe: 0, haber: Number(e.monto || 0),
    })),
  ].sort((a, b) => a.cuando - b.cuando);

  let saldo = 0;
  for (const m of movs) { saldo += m.debe - m.haber; m.saldo = saldo; }
  return movs;
}

// El nombre del proveedor vive en su ficha. En la compra queda una copia del
// día que se cargó: si después se corrige un nombre mal escrito, vale el de
// la ficha, no la copia vieja.
export function comoSeLlamaProveedor(c) {
  const p = estado.proveedores.find((x) => x.id === c.proveedorId);
  return p?.nombre || c.proveedor || '';
}

// El Depósito dice qué hay y nada más. Cuánto costó, a quién se le debe y
// cuánto deja cada trago viven en Administración: es plata, y la plata va
// ---------- Administración: las cuentas de los proveedores ----------
export function pintarAdmin() {
  pintarCajaGeneral();
  pintarAdminProveedores();
  pintarAdminMercaderia();
  pintarAdminCostos();
  pintarAdminEntradas();
}

// ---------- Administración: lo que se cobra en la puerta ----------
// La noche se agenda en el Calendario; acá solo se le pone precio a la
// entrada, que es plata y por eso vive en el mismo lugar que el resto.
export function pintarAdminEntradas() {
  const cont = $('#admEntradas');
  if (!cont || $('#vistaCaja').hidden) return;
  if (cont.contains(document.activeElement)) return;

  const noches = [
    ...(estado.evento ? [{ ...estado.evento, ahora: true }] : []),
    ...estado.agenda,
  ];

  cont.innerHTML = !noches.length
    ? `<div class="vacio">No hay noches agendadas.<br>
       <small>Se agendan en <b>Calendario</b>.</small></div>`
    : `<table class="ranking"><tbody>
      ${noches.map((e) => `
        <tr>
          <td>${esc(e.nombre || 'Noche')}${e.ahora
            ? ' <small style="color:var(--verde)">en curso</small>' : ''}
            <br><small style="color:var(--suave)">${
              e.fecha?.toDate?.().toLocaleDateString('es-AR') || ''}</small></td>
          <td class="n" style="width:7rem">
            <input data-entrada="${esc(e.id)}" type="number" min="0" inputmode="numeric"
                   value="${Number(e.entrada || 0) || ''}" placeholder="gratis"
                   aria-label="Entrada de ${esc(e.nombre || 'la noche')}"
                   style="width:100%;text-align:right">
            <small style="color:var(--suave)">entrada</small></td>
        </tr>`).join('')}
    </tbody></table>`;

  cont.querySelectorAll('[data-entrada]').forEach((el) => el.onchange = async () => {
    const ev = noches.find((x) => x.id === el.dataset.entrada);
    const nuevo = Math.max(0, Math.round(Number(el.value) || 0));
    if (!ev || nuevo === Number(ev.entrada || 0)) return;
    try { await updateDoc(doc(EVENTOS(), ev.id), { entrada: nuevo }); }
    catch (err) {
      el.value = Number(ev.entrada || 0) || '';
      alert('No se pudo: ' + (err.code || err.message));
    }
  });
}

export function pintarAdminProveedores() {
  const cont = $('#admProveedores');
  if (!cont || $('#vistaCaja').hidden) return;

  // Se listan todos los que tuvieron movimiento, no solo los que deben: al
  // que está al día también hay que poder abrirle la cuenta y mirarla.
  const conCuenta = estado.proveedores
    .map((p) => ({ ...p, saldo: saldoProveedor(p.id),
                   movs: movimientosProveedor(p.id).length }))
    .filter((p) => p.movs > 0)
    .sort((a, b) => b.saldo - a.saldo);
  const deuda = conCuenta.reduce((a, p) => a + Math.max(0, p.saldo), 0);

  // Dos motivos para no mostrar saldos: no tener la pantalla, o que las
  // reglas nieguen los gastos. Cualquiera de los dos deja la cuenta coja.
  if (estado.sinPagos || !estado.veCaja) {
    cont.innerHTML = `<div class="aviso"><span>🔒</span><div>
      Las cuentas corrientes se miran con el permiso de <b>Administración</b>:
      sin los pagos cargados, el saldo contaría como pendiente plata que ya
      fue abonada.</div></div>`;
    return;
  }

  cont.innerHTML = !conCuenta.length
    ? `<div class="vacio">Todavía no hay cuentas.<br>
       <small>Se abren solas al cargar un ingreso de mercadería a cuenta.</small></div>`
    : `<div class="caja-evento">
      <div class="numeros"><div class="plata"><b>${plata(deuda)}</b><span>se debe</span></div></div>
      <table class="ranking"><tbody>${conCuenta.map((p) => `
        <tr data-ver-prov="${esc(p.id)}" style="cursor:pointer">
          <td>${esc(p.nombre)} <small style="color:var(--suave)">ver cuenta ›</small></td>
          <td class="n">${p.saldo > 0.5 ? plata(p.saldo)
            : p.saldo < -0.5 ? `a favor ${plata(-p.saldo)}` : 'al día'}</td></tr>`).join('')}
      </tbody></table>
    </div>`;

  cont.querySelectorAll('[data-ver-prov]').forEach((f) => f.onclick = () =>
    abrirProveedor(f.dataset.verProv));
}

// ---------- Administración: lo que entró y lo que costó ----------
export function pintarAdminMercaderia() {
  const cont = $('#admMercaderia');
  if (!cont || $('#vistaCaja').hidden) return;

  // Lo que entró al depósito sin decir de quién vino ni cuánto salió. Se
  // mira contra las fichas que existen hoy: un proveedor borrado deja al
  // insumo apuntando a la nada, y eso también es un producto sin proveedor.
  const sinDatos = estado.insumos.filter((i) =>
    !estado.proveedores.some((p) => p.id === i.proveedorId) || !Number(i.costo || 0));

  cont.innerHTML = `
    <button class="btn primario ancho-full" id="btnNuevaCompra"
            style="margin-bottom:.9rem">+ Ingreso de mercadería</button>

    ${sinDatos.length ? `<div class="aviso" style="margin-bottom:.9rem">
      <span>📋</span><div>
      <b>${sinDatos.length} producto${sinDatos.length === 1 ? '' : 's'} sin proveedor ni precio.</b>
      Cargalos de una y cada proveedor arranca su cuenta corriente.
      <button class="btn primario ancho-full" id="btnAlDia" style="margin-top:.6rem">
        Poner al día el depósito</button></div></div>` : ''}

    ${estado.compras.length ? estado.compras.slice(0, 15).map((c) => `
      <div class="item">
        <div class="cuerpo">
          <div class="nombre">${esc(comoSeLlamaProveedor(c) || 'Compra suelta')}</div>
          <div class="desc">${c.fecha?.toDate?.()?.toLocaleDateString('es-AR') || ''}
            · ${(c.items || []).length} producto${(c.items || []).length === 1 ? '' : 's'}
            · ${c.condicion === 'inicial' ? 'carga inicial'
               : c.condicion === 'cuenta' ? 'a cuenta' : 'pagada'}${
               c.sinStock ? ' · sin sumar stock' : ''}</div>
        </div>
        <div class="total">${c.condicion === 'inicial' && !Number(c.total || 0)
          ? '—' : plata(c.total)}</div>
        <button class="btn peligro" data-borrar-compra="${esc(c.id)}"
                title="Borrar este ingreso" style="padding:.3rem .55rem;font-size:.78rem">✕</button>
      </div>`).join('')
      : `<div class="vacio">Todavía no se cargó ningún ingreso.</div>`}`;

  if ($('#btnNuevaCompra')) $('#btnNuevaCompra').onclick = abrirCompra;
  if ($('#btnAlDia')) $('#btnAlDia').onclick = abrirAlDia;
  cont.querySelectorAll('[data-borrar-compra]').forEach((b) => b.onclick = () =>
    borrarCompra(estado.compras.find((c) => c.id === b.dataset.borrarCompra)));
}

// ---------- Administración: cuánto deja cada trago ----------
// El precio de venta está en la carta y el costo en el depósito; el margen
// solo se puede ver si los dos números se miran juntos, y ese es el trabajo
// de esta pantalla.
export function costoDeReceta(item) {
  const receta = (item.receta || []).filter((r) => Number(r.medidas) > 0);
  if (!receta.length) return null;
  let total = 0;
  for (const r of receta) {
    const ins = estado.insumos.find((i) => i.id === r.insumoId);
    if (!ins || !Number(ins.costo || 0)) return null;
    const medidas = Math.max(1, Number(ins.medidas || 1));
    total += Number(ins.costo) / medidas * Number(r.medidas);
  }
  return Math.round(total);
}

export function pintarAdminCostos() {
  const cont = $('#admCostos');
  if (!cont || $('#vistaCaja').hidden) return;
  // Si está escribiendo un precio, repintar le borra lo que escribió a mitad
  // de camino. La tabla espera: el próximo cambio la vuelve a dibujar.
  if (cont.contains(document.activeElement)) return;

  const filas = estado.carta
    .filter((i) => i.enCarta !== false)
    .map((i) => {
      const costo = costoDeReceta(i);
      const precio = Number(i.precio || 0);
      return { id: i.id, nombre: i.nombre || i.id, precio, costo,
               deja: costo === null ? null : precio - costo };
    });
  const conCuenta = filas.filter((f) => f.deja !== null);

  cont.innerHTML = `
    <table class="ranking"><tbody>
      ${filas.map((f) => `
        <tr>
          <td>${esc(f.nombre)}<br><small style="color:var(--suave)">
            ${f.costo === null ? 'sin costo cargado' : `cuesta ${plata(f.costo)}`}</small></td>
          <td class="n" style="width:6.5rem">
            <input data-precio="${esc(f.id)}" type="number" min="0" inputmode="numeric"
                   value="${f.precio || ''}" aria-label="Precio de ${esc(f.nombre)}"
                   style="width:100%;text-align:right">
            <small style="color:var(--suave)">se vende</small></td>
          <td class="n">${f.deja === null ? '—'
            : `<b style="color:var(--${f.deja > 0 ? 'verde' : 'rojo'})">${plata(f.deja)}</b>
               <br><small style="color:var(--suave)">${f.precio
                 ? Math.round(f.deja / f.precio * 100) : 0}%</small>`}</td>
        </tr>`).join('')}
    </tbody></table>
    ${conCuenta.length < filas.length ? `
      <p style="font-size:.76rem;color:var(--suave);margin:.7rem 0 0">
        Los que dicen “sin costo cargado” no tienen receta o les falta el precio
        del insumo. Se arregla en <b>Carta → 🧾</b> y acá arriba en
        <b>Poner al día</b>.</p>` : ''}`;

  // El precio se guarda al salir del campo, no en cada tecla: escribir 2500
  // pasaría por 2, 25 y 250, y cada uno sería un precio real por un rato.
  cont.querySelectorAll('[data-precio]').forEach((e) => e.onchange = async () => {
    const i = estado.carta.find((x) => x.id === e.dataset.precio);
    const nuevo = Math.max(0, Math.round(Number(e.value) || 0));
    if (!i || nuevo === Number(i.precio || 0)) return;
    try { await updateDoc(doc(db, 'carta', i.id), { precio: nuevo }); }
    catch (err) {
      e.value = i.precio || '';
      alert('No se pudo: ' + (err.code || err.message));
    }
  });
}

// ---------- la cuenta de un proveedor ----------
export let mirandoProveedor = null;

export function abrirProveedor(id) {
  const p = estado.proveedores.find((x) => x.id === id);
  if (!p) return;
  mirandoProveedor = p;
  $('#dlgProveedor').showModal();
  pintarProveedor();
}

export function pintarProveedor() {
  const p = mirandoProveedor;
  if (!p || !$('#dlgProveedor')?.open) return;
  const movs = movimientosProveedor(p.id);
  const saldo = saldoProveedor(p.id);

  $('#tituloProveedor').textContent = p.nombre;
  $('#cuerpoProveedor').innerHTML = `
    <div class="numeros" style="margin-bottom:.8rem">
      <div class="plata"><b>${saldo > 0.5 ? plata(saldo)
        : saldo < -0.5 ? plata(-saldo) : plata(0)}</b>
        <span>${saldo > 0.5 ? 'se le debe' : saldo < -0.5 ? 'quedó a favor' : 'al día'}</span></div>
    </div>

    <table class="ranking"><tbody>
      ${movs.map((m) => `
        <tr>
          <td><small style="color:var(--suave)">${esc(m.fecha)}</small><br>${esc(m.detalle)}</td>
          <td class="n" style="color:${m.debe ? 'var(--naranja)' : 'var(--verde)'}">
            ${m.debe ? '+' : '−'}${plata(m.debe || m.haber)}</td>
          <td class="n"><small style="color:var(--suave)">${plata(m.saldo)}</small></td>
        </tr>`).join('')}
    </tbody></table>

    <p style="font-size:.76rem;color:var(--suave);margin:.8rem 0 0">
      Lo naranja es mercadería que se llevó a cuenta; lo verde, lo que se le pagó.
      La última columna es cuánto se le debía después de cada movimiento.</p>

    <label class="campo" style="margin-top:1rem">
      <span>Nombre <small>(corregilo si quedó mal escrito)</small></span>
      <input id="inpNombreProv" maxlength="60" autocomplete="off" value="${esc(p.nombre)}">
    </label>`;
  $('#btnGuardarProveedor').onclick = guardarNombreProveedor;
}

// ---------- poner al día el depósito ----------
// La barra cargó la mercadería para poder vender: sin precios y sin decir de
// quién vino. Acá se completa todo junto y cada proveedor arranca su cuenta.
//
// NO toca el stock. Las botellas ya están contadas en el depósito; volver a
// sumarlas las contaría dos veces. Lo único que escribe es el papel que
// faltaba: de quién vino cada cosa, cuánto salió, y si se debe o ya se pagó.
export function abrirAlDia() {
  // Si el depósito está en cero es porque todavía no se cargó nada: la
  // pantalla arranca cargando el stock. Si ya hay botellas contadas, no.
  const hayStock = estado.insumos.some((i) => Number(i.stock || 0) > 0);
  estado.alDia = { filas: {}, condicion: 'cuenta', stock: hayStock ? 'ya' : 'cargar' };
  for (const i of estado.insumos) {
    const medidas = Math.max(1, Number(i.medidas || 1));
    estado.alDia.filas[i.id] = {
      proveedor: estado.proveedores.find((p) => p.id === i.proveedorId)?.nombre || '',
      costo: Number(i.costo || 0) || '',
      unidades: Math.round(Number(i.stock || 0) / medidas * 100) / 100,
    };
  }
  $('#dlgAlDia').showModal();
  pintarAlDia();
}

export function filasAlDia() {
  return estado.insumos
    .map((i) => ({ ins: i, ...(estado.alDia.filas[i.id] || {}) }))
    .filter((f) => String(f.proveedor || '').trim().length >= 2
      && Number(f.costo) > 0 && Number(f.unidades) > 0);
}

export function pintarAlDia() {
  const listas = filasAlDia();
  const total = listas.reduce((a, f) => a + Number(f.costo) * Number(f.unidades), 0);

  $('#cuerpoAlDia').innerHTML = `
    <div class="campo">
      <span style="display:block;font-size:.82rem;color:var(--suave);margin-bottom:.4rem">
        Esta mercadería…</span>
      <div style="display:flex;gap:.4rem">
        ${[['cuenta', 'Se la debemos'], ['inicial', 'Ya está pagada']].map(([k, t]) => `
          <button type="button" class="btn ${estado.alDia.condicion === k ? 'primario' : ''}"
                  data-ald-cond="${k}" style="flex:1;font-size:.84rem">${t}</button>`).join('')}
      </div>
      <small class="pista">${estado.alDia.condicion === 'cuenta'
        ? 'Arranca la cuenta corriente de cada proveedor con lo que se le debe.'
        : 'Queda el precio y el proveedor anotados, sin deuda y sin tocar la caja.'}</small>
    </div>

    <div class="campo">
      <span style="display:block;font-size:.82rem;color:var(--suave);margin-bottom:.4rem">
        Y en el depósito…</span>
      <div style="display:flex;gap:.4rem">
        ${[['ya', 'Ya está contada'], ['cargar', 'Cargá el stock']].map(([k, t]) => `
          <button type="button" class="btn ${estado.alDia.stock === k ? 'primario' : ''}"
                  data-ald-stock="${k}" style="flex:1;font-size:.84rem">${t}</button>`).join('')}
      </div>
      <small class="pista">${estado.alDia.stock === 'ya'
        ? 'No se toca lo guardado: ya está contado y sumarlo de nuevo lo duplica.'
        : 'Lo guardado de cada producto pasa a ser lo que cargues acá.'}</small>
    </div>

    <datalist id="listaProvAlDia">
      ${estado.proveedores.map((p) => `<option value="${esc(p.nombre)}">`).join('')}
    </datalist>

    ${estado.insumos.map((i) => {
      const f = estado.alDia.filas[i.id] || {};
      const medidas = Math.max(1, Number(i.medidas || 1));
      return `
      <div class="item"><div class="cuerpo" style="width:100%">
        <div class="nombre">${esc(i.nombre)}</div>
        <div class="desc">hay ${Math.round(Number(i.stock || 0) / medidas * 100) / 100}
          ${esc(i.unidad || 'unidad')}${medidas > 1 ? ` de ${medidas} medidas` : ''}</div>
        <div style="display:flex;gap:.4rem;margin-top:.45rem;flex-wrap:wrap">
          <input data-ald-prov="${esc(i.id)}" list="listaProvAlDia" maxlength="60"
                 autocomplete="off" placeholder="Proveedor"
                 value="${esc(f.proveedor || '')}" style="flex:2;min-width:9rem">
          <input data-ald-costo="${esc(i.id)}" type="number" min="0" inputmode="numeric"
                 placeholder="$ por ${esc(i.unidad || 'unidad')}"
                 value="${esc(String(f.costo ?? ''))}" style="flex:1;min-width:6rem">
          <input data-ald-uni="${esc(i.id)}" type="number" min="0" step="0.01" inputmode="decimal"
                 placeholder="cuántas" value="${esc(String(f.unidades ?? ''))}"
                 style="flex:1;min-width:5rem">
        </div>
      </div></div>`;
    }).join('')}

    <div class="total-venta"><span>${listas.length} producto${
      listas.length === 1 ? '' : 's'} listo${listas.length === 1 ? '' : 's'}</span>
      <b>${plata(total)}</b></div>`;

  $('#cuerpoAlDia').querySelectorAll('[data-ald-cond]').forEach((b) => b.onclick = () => {
    estado.alDia.condicion = b.dataset.aldCond; pintarAlDia();
  });
  $('#cuerpoAlDia').querySelectorAll('[data-ald-stock]').forEach((b) => b.onclick = () => {
    estado.alDia.stock = b.dataset.aldStock; pintarAlDia();
  });
  const anotar = (sel, campo) =>
    $('#cuerpoAlDia').querySelectorAll(sel).forEach((e) => e.oninput = () => {
      const id = e.dataset.aldProv || e.dataset.aldCosto || e.dataset.aldUni;
      estado.alDia.filas[id] = { ...(estado.alDia.filas[id] || {}), [campo]: e.value };
      // El total de abajo se escribe a mano para no repintar mientras escribe.
      const l = filasAlDia();
      const t = l.reduce((a, f) => a + Number(f.costo) * Number(f.unidades), 0);
      const pie = $('#cuerpoAlDia .total-venta');
      if (pie) pie.innerHTML = `<span>${l.length} producto${l.length === 1 ? '' : 's'} listo${
        l.length === 1 ? '' : 's'}</span><b>${plata(t)}</b>`;
    });
  anotar('[data-ald-prov]', 'proveedor');
  anotar('[data-ald-costo]', 'costo');
  anotar('[data-ald-uni]', 'unidades');
}

export async function guardarAlDia() {
  const listas = filasAlDia();
  if (!listas.length) {
    alert('Completá al menos un producto con proveedor, precio y cantidad.');
    return;
  }
  const condicion = estado.alDia.condicion;
  const cargaStock = estado.alDia.stock === 'cargar';
  const btn = $('#btnGuardarAlDia');
  btn.disabled = true; btn.textContent = 'Guardando…';

  // Una compra por proveedor, con todo lo que le compramos adentro.
  const porProveedor = new Map();
  for (const f of listas) {
    const nombre = String(f.proveedor).trim();
    const clave = nombre.toLowerCase();
    if (!porProveedor.has(clave)) porProveedor.set(clave, { nombre, filas: [] });
    porProveedor.get(clave).filas.push(f);
  }

  try {
    for (const { nombre, filas } of porProveedor.values()) {
      let proveedorId = estado.proveedores.find((p) =>
        p.nombre.toLowerCase() === nombre.toLowerCase())?.id;
      if (!proveedorId) {
        const ref = await addDoc(collection(db, 'proveedores'),
          { nombre, creadoEn: serverTimestamp() });
        proveedorId = ref.id;
      }

      const items = filas.map((f) => ({
        insumoId: f.ins.id, nombre: f.ins.nombre,
        unidades: Number(f.unidades), costoUnit: Number(f.costo),
      }));
      await addDoc(collection(db, 'compras'), {
        proveedor: nombre, proveedorId,
        fecha: Timestamp.fromDate(new Date()),
        items,
        total: items.reduce((a, i) => a + i.unidades * i.costoUnit, 0),
        condicion,
        // Cuando la mercadería ya estaba contada, este ingreso no la vuelve a
        // sumar: hacerlo la contaría dos veces.
        ...(cargaStock ? {} : { sinStock: true }),
        cargadoPor: estado.usuario || 'casa',
        creadoEn: serverTimestamp(),
      });

      // Y cada insumo se queda con su precio y su proveedor, que es lo que
      // después dice cuánto deja cada trago.
      await Promise.all(filas.map((f) => {
        const medidas = Math.max(1, Number(f.ins.medidas || 1));
        return updateDoc(doc(db, 'insumos', f.ins.id), {
          costo: Number(f.costo), proveedorId,
          ...(cargaStock ? { stock: Number(f.unidades) * medidas } : {}),
        });
      }));
    }
    $('#dlgAlDia').close();
  } catch (e) {
    alert('No se pudo: ' + (e.code || e.message));
  }
  btn.disabled = false; btn.textContent = 'Guardar';
}

export async function guardarNombreProveedor() {
  const p = mirandoProveedor;
  const nombre = ($('#inpNombreProv')?.value || '').trim();
  if (!p || nombre.length < 2 || nombre === p.nombre) { $('#dlgProveedor').close(); return; }
  try {
    await updateDoc(doc(db, 'proveedores', p.id), { nombre });
    $('#dlgProveedor').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- borrar un ingreso de mercadería ----------
// Se borra el papel, no la mercadería: el stock que sumó ese ingreso queda
// como está, porque las botellas siguen en el depósito. Sirve para los
// ingresos cargados mal —sin precio, con la condición que no era— que
// después ensucian la deuda con proveedores.
//
// Si la compra se había pagado en el acto, el gasto que dejó en la caja se
// va con ella: si no, la caja quedaría pagando algo que ya no existe.
export async function borrarCompra(c) {
  if (!c) return;
  const quien = c.proveedor || 'Compra suelta';
  const gasto = (estado.egresosTodos || []).find((e) => e.compraId === c.id);
  if (!confirm(`¿Borrar el ingreso de "${quien}"?\n\n`
    + `El stock que sumó NO se toca: la mercadería sigue en el depósito.\n`
    + `Solo desaparece de "Últimos ingresos"`
    + (c.condicion === 'cuenta' && Number(c.total || 0) > 0
      ? ` y de la deuda con el proveedor.` : '.')
    + (gasto ? `\n\nTambién se borra el gasto de ${plata(gasto.monto)} que dejó en la caja.` : ''))) return;
  try {
    if (gasto) await deleteDoc(doc(db, 'egresos', gasto.id));
    await deleteDoc(doc(db, 'compras', c.id));
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- ingreso de mercadería ----------
export function abrirCompra() {
  estado.compra = { items: {}, condicion: 'cuenta', pago: 'efectivo', proveedorId: '', proveedor: '' };
  $('#dlgCompra').showModal();
  pintarCompra();
}

export function totalCompra() {
  return Object.entries(estado.compra.items).reduce((a, [id, l]) => {
    return a + Number(l.unidades || 0) * Number(l.costoUnit || 0);
  }, 0);
}

export function pintarCompra() {
  const c = estado.compra;
  const esInicial = c.condicion === 'inicial';
  $('#cuerpoCompra').innerHTML = `
    <label class="campo">
      <span>Proveedor <small>(vacío si fue una compra suelta)</small></span>
      <input id="inpCompraProv" list="listaProv" maxlength="60" autocomplete="off"
             value="${esc(c.proveedor || '')}" placeholder="Distribuidora, super, kiosco…">
      <datalist id="listaProv">
        ${estado.proveedores.map((p) => `<option value="${esc(p.nombre)}">`).join('')}
      </datalist>
    </label>

    <div class="campo">
      <span style="display:block;font-size:.82rem;color:var(--suave);margin-bottom:.4rem">Qué es</span>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        ${[['cuenta', 'A cuenta'], ['contado', 'Pagada'], ['inicial', 'Carga inicial']].map(([k, t]) => `
          <button type="button" class="btn ${c.condicion === k ? 'primario' : ''}"
                  data-condicion="${k}" style="flex:1;font-size:.84rem">${t}</button>`).join('')}
      </div>
      <small class="pista">${{
        cuenta: 'Suma stock y queda como deuda con el proveedor.',
        contado: 'Suma stock y sale de la caja ahora.',
        inicial: 'Solo suma stock: es lo que ya tenías, no plata que salió.',
      }[c.condicion]}</small>
    </div>

    ${c.condicion === 'contado' ? `
      <div class="campo">
        <span style="display:block;font-size:.82rem;color:var(--suave);margin-bottom:.4rem">Cómo se pagó</span>
        <div style="display:flex;gap:.6rem">
          ${[['efectivo', '💵 Efectivo'], ['virtual', '📲 Virtual']].map(([k, t]) => `
            <button type="button" class="btn ${c.pago === k ? 'primario' : ''}"
                    data-pagocompra="${k}" style="flex:1">${t}</button>`).join('')}
        </div>
      </div>` : ''}

    ${estado.insumos.length ? `
      <div class="lista-venta">
        ${estado.insumos.map((i) => {
          const l = c.items[i.id] || {};
          return `
          <div class="item" style="flex-wrap:wrap">
            <div class="cuerpo" style="flex:1 0 100%">
              <div class="nombre">${esc(i.nombre)}</div>
              <div class="desc">hay ${comoSeDice(i)}</div>
            </div>
            <label style="flex:1;font-size:.76rem;color:var(--suave)">entran
              <input class="conteo-num" type="number" min="0" inputmode="numeric"
                     data-compra-u="${esc(i.id)}" value="${l.unidades ?? ''}"
                     placeholder="0" style="width:100%"></label>
            ${!esInicial ? `<label style="flex:1;font-size:.76rem;color:var(--suave)">$ c/u
              <input class="conteo-num" type="number" min="0" inputmode="numeric"
                     data-compra-c="${esc(i.id)}" value="${l.costoUnit ?? i.costo ?? ''}"
                     placeholder="0" style="width:100%"></label>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${!esInicial ? `<div class="total-venta"><span>Total</span><b>${plata(totalCompra())}</b></div>` : ''}
      <button class="btn primario ancho-full" id="btnGuardarCompra" style="margin-top:.8rem">
        ${esInicial ? 'Cargar el stock inicial' : 'Guardar el ingreso'}</button>`
      : `<div class="aviso mal"><span>⚠</span><div>
          <b>Primero cargá los insumos.</b> Son las botellas, latas y paquetes que
          comprás.</div></div>`}`;

  $('#cuerpoCompra').querySelectorAll('[data-condicion]').forEach((b) => b.onclick = () => {
    estado.compra.condicion = b.dataset.condicion; pintarCompra();
  });
  $('#cuerpoCompra').querySelectorAll('[data-pagocompra]').forEach((b) => b.onclick = () => {
    estado.compra.pago = b.dataset.pagocompra; pintarCompra();
  });
  const prov = $('#inpCompraProv');
  if (prov) prov.oninput = () => { estado.compra.proveedor = prov.value; };
  $('#cuerpoCompra').querySelectorAll('[data-compra-u]').forEach((inp) => inp.oninput = () => {
    const id = inp.dataset.compraU;
    estado.compra.items[id] = { ...(estado.compra.items[id] || {}), unidades: Number(inp.value) || 0 };
    if (!estado.compra.items[id].unidades) delete estado.compra.items[id];
    const t = $('.total-venta b'); if (t) t.textContent = plata(totalCompra());
  });
  $('#cuerpoCompra').querySelectorAll('[data-compra-c]').forEach((inp) => inp.oninput = () => {
    const id = inp.dataset.compraC;
    estado.compra.items[id] = { ...(estado.compra.items[id] || {}), costoUnit: Number(inp.value) || 0 };
    const t = $('.total-venta b'); if (t) t.textContent = plata(totalCompra());
  });
  if ($('#btnGuardarCompra')) $('#btnGuardarCompra').onclick = guardarCompra;
}

export async function guardarCompra() {
  const c = estado.compra;
  const items = Object.entries(c.items)
    .filter(([, l]) => Number(l.unidades) > 0)
    .map(([id, l]) => {
      const ins = estado.insumos.find((x) => x.id === id) || {};
      return { insumoId: id, nombre: ins.nombre || id,
               unidades: Number(l.unidades), costoUnit: Number(l.costoUnit || 0) };
    });
  if (!items.length) { alert('Cargá al menos un producto.'); return; }

  const btn = $('#btnGuardarCompra');
  btn.disabled = true; btn.textContent = 'Guardando…';
  const nombreProv = ($('#inpCompraProv')?.value || '').trim();
  const total = c.condicion === 'inicial' ? 0 : totalCompra();

  // Un ingreso en $0 que dice "a cuenta" o "pagada" no es una compra: es
  // mercadería que ya estaba y se cargó con la opción que venía puesta.
  // Dejarlo pasar llena el depósito de ingresos de $0 y, si alguno llevara
  // precio, inventaría una deuda con el proveedor que nadie contrajo.
  if (c.condicion !== 'inicial' && total === 0) {
    alert('No pusiste los precios.\n\n'
      + 'Si esto es mercadería que ya tenías, elegí "Carga inicial": '
      + 'suma el stock y no toca la plata.');
    btn.disabled = false; btn.textContent = 'Guardar el ingreso';
    return;
  }

  try {
    // El proveedor se da de alta solo la primera vez que se lo nombra.
    let proveedorId = '';
    if (nombreProv) {
      const ya = estado.proveedores.find((p) =>
        p.nombre.toLowerCase() === nombreProv.toLowerCase());
      if (ya) proveedorId = ya.id;
      else {
        const ref = await addDoc(collection(db, 'proveedores'),
          { nombre: nombreProv, creadoEn: serverTimestamp() });
        proveedorId = ref.id;
      }
    }

    const ref = await addDoc(collection(db, 'compras'), {
      proveedor: nombreProv, proveedorId,
      fecha: Timestamp.fromDate(new Date()),
      items, total, condicion: c.condicion,
      ...(c.condicion === 'contado' ? { pago: c.pago } : {}),
      cargadoPor: estado.usuario || 'casa',
      creadoEn: serverTimestamp(),
    });

    // Suma el stock, en medidas.
    await Promise.all(items.map((i) => {
      const ins = estado.insumos.find((x) => x.id === i.insumoId);
      if (!ins) return null;
      const medidas = Math.max(1, Number(ins.medidas || 1));
      return updateDoc(doc(db, 'insumos', i.insumoId),
        { stock: Number(ins.stock || 0) + i.unidades * medidas });
    }));

    // Pagada en el acto: además es plata que salió de la caja.
    if (c.condicion === 'contado' && total > 0) {
      await addDoc(collection(db, 'egresos'), {
        concepto: `Mercadería${nombreProv ? ' · ' + nombreProv : ''}`,
        categoria: nombreProv ? 'proveedor' : 'insumo',
        monto: total, pago: c.pago,
        fecha: Timestamp.fromDate(new Date()),
        cajaId: cajaActual(), proveedorId, compraId: ref.id,
        cargadoPor: estado.usuario || 'casa', creadoEn: serverTimestamp(),
      }).catch(() => {});
    }
    $('#dlgCompra').close();
  } catch (e) {
    alert('No se pudo: ' + (e.code || e.message));
  }
  btn.disabled = false;
  btn.textContent = c.condicion === 'inicial' ? 'Cargar el stock inicial' : 'Guardar el ingreso';
}
