import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from '/vendor/firebase.js';
import { pintarAdmin } from './administracion.js';
import { $, esc, estado, plata } from './base.js';
import { pintarConteo } from './carta.js';
import { db, fallo } from './conexion.js';
import { quienAtiende } from './pedidos.js';

// ---------- el depósito ----------
//
// Lo que se compra y lo que se guarda, que no es lo mismo que lo que se vende.
// Una botella de fernet es un insumo; "Fernet con coca" es un producto de la
// carta que se lleva una medida de esa botella. El stock se lleva en MEDIDAS:
// así una botella que da 10 baja de a una y recién se gasta a la décima.
export const unidadesDe = (ins) => Math.floor(Number(ins.stock || 0) / Math.max(1, Number(ins.medidas || 1)));
export const sueltasDe = (ins) => Number(ins.stock || 0) % Math.max(1, Number(ins.medidas || 1));

export function comoSeDice(ins) {
  const m = Math.max(1, Number(ins.medidas || 1));
  const u = unidadesDe(ins), sueltas = sueltasDe(ins);
  const unidad = ins.unidad || 'unidad';
  if (m === 1) return `${u} ${unidad}${u === 1 ? '' : 's'}`;
  return `${u} ${unidad}${u === 1 ? '' : 's'}`
    + (sueltas ? ` y ${sueltas} medida${sueltas === 1 ? '' : 's'}` : '');
}

// ---------- la carta atada al depósito ----------
// Un producto con receta no lleva stock propio: lo que hay es lo que el
// depósito alcanza a dar. Se calcula con el insumo más corto de la receta,
// porque un fernet con coca sin coca no es un fernet con coca.
//
// Infinity = no tiene receta, lleva su propio número (o ∞) como siempre.
export function rindeDeposito(item) {
  const receta = (item.receta || []).filter((r) => Number(r.medidas) > 0);
  if (!receta.length) return Infinity;
  let menor = Infinity;
  for (const r of receta) {
    const ins = estado.insumos.find((i) => i.id === r.insumoId);
    // Un insumo borrado del depósito deja al producto sin de dónde salir.
    if (!ins) return 0;
    menor = Math.min(menor, Math.floor(Number(ins.stock || 0) / Number(r.medidas)));
  }
  return Math.max(0, menor);
}

// El cliente no puede leer el depósito —ni debe: ahí están los costos y lo que
// hay guardado—, así que el número viajado al que sí lee: el stock del
// producto. Lo escribe el panel cada vez que el depósito se mueve.
//
// Converge sola aunque haya varios celulares abiertos: el valor es una cuenta
// del depósito, no un incremento, así que el segundo que llega ve que ya está
// bien y no escribe. Sin bucle posible.
export async function sincronizarCartaConDeposito() {
  if (!estado.carta.length || !estado.insumos.length) return;
  const cambios = estado.carta
    .filter((i) => (i.receta || []).length)
    .map((i) => ({ id: i.id, rinde: rindeDeposito(i), tenia: i.stock }))
    .filter((x) => x.rinde !== x.tenia);
  // Quien no puede escribir la carta —la puerta, un barman fuera de turno—
  // simplemente no sincroniza: no es su trabajo y las reglas lo frenan igual.
  await Promise.all(cambios.map((x) =>
    updateDoc(doc(db, 'carta', x.id), { stock: x.rinde }).catch(() => {})));
}

export function escucharDeposito() {
  // El insumo lo lee toda la barra: es lo que hay guardado. Lo demás —compras,
  // gastos, proveedores— es plata, y el celular de la barra no lo puede leer.
  // Pedirlo igual sería un permission-denied cada vez que arranca.
  onSnapshot(collection(db, 'insumos'), (snap) => {
    estado.insumos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    pintarDeposito(); pintarAdmin(); pintarConteo(); sincronizarCartaConDeposito();
  }, fallo('#deposito'));

}

// La plata del depósito —compras, gastos, proveedores— va aparte: el celular
// de la barra no la puede leer, y pedirla igual es un permission-denied cada
// vez que arranca.
//
// Se engancha cuando se sabe el rol, no al cargar: al cargar todavía no se
// sabe quién entró, y gatear acá dejaba al dueño sin sus propias compras.
// toda al mismo lugar.
export function pintarDeposito() {
  const cont = $('#deposito');
  if (!cont || $('#vistaDeposito').hidden) return;
  const bajos = estado.insumos.filter((i) =>
    Number(i.minimo || 0) > 0 && unidadesDe(i) < Number(i.minimo));

  // El celular de la barra mira y nada más: no da de alta mercadería y no
  // ve la plata. Mostrarle esos botones sería ofrecerle algo que las reglas
  // le van a negar.
  const soloMira = estado.esAparato;

  cont.innerHTML = `
    ${soloMira ? '' : `
    <button class="btn primario ancho-full" id="btnNuevoInsumo"
            style="margin-bottom:.9rem">+ Insumo</button>`}

    ${soloMira ? `<p style="color:var(--suave);font-size:.86rem;margin:0 0 .9rem">
      Lo que hay guardado, para saber qué se puede hacer. Lo carga la casa.</p>` : ''}

    ${bajos.length ? `<div class="aviso mal"><span>⚠</span><div>
      <b>Se está por acabar:</b> ${bajos.map((i) => esc(i.nombre)).join(', ')}.</div></div>` : ''}

    ${estado.insumos.length ? estado.insumos.map((i) => {
      const bajo = Number(i.minimo || 0) > 0 && unidadesDe(i) < Number(i.minimo);
      return `
      <div class="item ${bajo ? 'agotado' : ''}">
        <div class="cuerpo">
          <div class="nombre">${esc(i.nombre)}</div>
          <div class="desc">${comoSeDice(i)}${
            Number(i.medidas || 1) > 1 ? ` · ${i.medidas} medidas por ${esc(i.unidad || 'unidad')}` : ''}</div>
        </div>
        ${soloMira ? '' : `
        <button class="btn" data-editar-insumo="${esc(i.id)}"
                style="padding:.3rem .6rem;font-size:.78rem">Editar</button>
        <button class="btn peligro solo-gerente-inline" data-baja-insumo="${esc(i.id)}"
                title="Darlo de baja" style="padding:.3rem .55rem;font-size:.78rem">✕</button>`}
      </div>`;
    }).join('')
      : `<div class="vacio">El depósito está vacío.<br>
         <small>Cargá los insumos y después, en <b>Administración → Mercadería</b>,
         lo que compraste.</small></div>`}`;

  if ($('#btnNuevoInsumo')) $('#btnNuevoInsumo').onclick = () => abrirInsumo(null);
  cont.querySelectorAll('[data-baja-insumo]').forEach((b) => b.onclick = () =>
    abrirBaja(estado.insumos.find((i) => i.id === b.dataset.bajaInsumo)));
  cont.querySelectorAll('[data-editar-insumo]').forEach((b) => b.onclick = () =>
    abrirInsumo(estado.insumos.find((i) => i.id === b.dataset.editarInsumo)));
}

// ---------- dar de baja un insumo ----------
// Borrar y listo no sirve: dentro de un mes nadie se acuerda por qué
// desapareció una botella del depósito. El motivo es obligatorio y queda.
//
// Y antes de borrar se mira quién depende de él: si un trago de la carta sale
// de ese insumo, borrarlo lo dejaría sin de dónde salir y el producto se
// agotaría solo, sin que nadie entienda por qué.
export let dandoDeBaja = null;

export function quienUsa(insumoId) {
  return estado.carta
    .filter((c) => (c.receta || []).some((r) => r.insumoId === insumoId))
    .map((c) => c.nombre || c.id);
}

export function abrirBaja(ins) {
  if (!ins) return;
  dandoDeBaja = ins;
  const usan = quienUsa(ins.id);
  $('#queSeDaDeBaja').innerHTML = `<b>${esc(ins.nombre)}</b> — ${esc(comoSeDice(ins))} en el depósito.`
    + (usan.length
      ? `<br><span style="color:var(--naranja)">Ojo: ${esc(usan.join(', '))} ${
          usan.length === 1 ? 'sale' : 'salen'} de acá.</span>`
      : '');
  $('#inpMotivoBaja').value = '';
  $('#errorBaja').classList.add('oculto');
  $('#btnConfirmarBaja').disabled = false;
  $('#btnConfirmarBaja').textContent = 'Dar de baja';
  $('#dlgBaja').showModal();
  $('#inpMotivoBaja').focus();
}

$('#btnCancelarBaja').onclick = () => { dandoDeBaja = null; $('#dlgBaja').close(); };
$('#btnConfirmarBaja').onclick = async () => {
  const ins = dandoDeBaja;
  if (!ins) return;
  const motivo = $('#inpMotivoBaja').value.trim();
  const fallar = (t) => {
    $('#errorBajaTexto').textContent = t;
    $('#errorBaja').classList.remove('oculto');
  };
  if (motivo.length < 3) {
    fallar('Escribí el motivo: es lo único que queda después.');
    $('#inpMotivoBaja').focus();
    return;
  }
  // Un trago que sale de este insumo quedaría sin de dónde salir: se frena
  // acá, con el nombre del producto, en vez de romperlo en silencio.
  const usan = quienUsa(ins.id);
  if (usan.length) {
    fallar(`Primero sacalo de la receta de ${usan.join(', ')}, en Carta y stock.`);
    return;
  }
  const btn = $('#btnConfirmarBaja');
  btn.disabled = true; btn.textContent = 'Dando de baja…';
  try {
    // Primero queda la historia; recién después desaparece el insumo. Si se
    // cayera en el medio, es preferible una baja anotada de más que una
    // botella que desapareció sin explicación.
    await addDoc(collection(db, 'bajas'), {
      insumoId: ins.id, nombre: ins.nombre || ins.id,
      unidad: ins.unidad || 'unidad', stock: Number(ins.stock || 0),
      motivo, quien: quienAtiende() || estado.usuario || 'la casa',
      cuando: serverTimestamp(),
    });
    await deleteDoc(doc(db, 'insumos', ins.id));
    dandoDeBaja = null;
    $('#dlgBaja').close();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Dar de baja';
    fallar('No se pudo: ' + (e.code || e.message));
  }
};

export let editandoInsumo = null;
export function abrirInsumo(ins) {
  editandoInsumo = ins;
  $('#tituloInsumo').textContent = ins ? 'Editar insumo' : 'Nuevo insumo';
  $('#inpInsNombre').value = ins?.nombre || '';
  $('#inpInsUnidad').value = ins?.unidad || '';
  $('#inpInsMedidas').value = ins?.medidas ?? 1;
  $('#inpInsCosto').value = ins?.costo ?? '';
  $('#inpInsMinimo').value = ins?.minimo ?? '';
  $('#dlgInsumo').showModal();
  $('#inpInsNombre').focus();
}

export async function guardarInsumo() {
  const nombre = $('#inpInsNombre').value.trim();
  if (nombre.length < 2) { $('#inpInsNombre').focus(); return; }
  const medidas = Math.max(1, Math.floor(Number($('#inpInsMedidas').value) || 1));
  const datos = {
    nombre,
    unidad: $('#inpInsUnidad').value.trim() || 'unidad',
    medidas,
    // El stock NO se manda al editar. Mandarlo escribía el número que tenía
    // la pantalla cuando se abrió el diálogo: si mientras tanto la barra
    // vendió, esas ventas volvían atrás al guardar el nombre.
    ...(editandoInsumo ? {} : { stock: 0 }),
    costo: Math.max(0, Number($('#inpInsCosto').value) || 0),
    minimo: Math.max(0, Number($('#inpInsMinimo').value) || 0),
    // El proveedor no se toca desde acá: si no se reenvía, se borra.
    ...(editandoInsumo?.proveedorId ? { proveedorId: editandoInsumo.proveedorId } : {}),
    ...(editandoInsumo ? {} : { creadoEn: serverTimestamp() }),
  };
  try {
    if (editandoInsumo) await updateDoc(doc(db, 'insumos', editandoInsumo.id), datos);
    else await addDoc(collection(db, 'insumos'), datos);
    $('#dlgInsumo').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}
