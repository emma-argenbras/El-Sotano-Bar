// La carta de cada fecha.
//
// El catálogo es el maestro: todo lo que el bar sabe vender. La carta de una
// fecha dice qué sale ESA noche y a cuánto — un bar que hace una noche de
// vinos no quiere la misma lista que un martes.
//
// Un documento por fecha, con un mapa producto → precio. Un producto está en
// la carta de esa noche si tiene precio ahí. Se lee entero de una vez, que es
// como lo necesita el que abre el QR en la mesa.
//
// El stock no vive acá. El depósito es uno solo y lo que hay no depende de la
// fecha: eso sigue en carta/{id}, igual que siempre.
//
// Y lo más importante: si una fecha no tiene carta propia, se vende la de
// siempre. Esto no rompe nada de lo que hay hoy; agrega la posibilidad.
import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
} from '/vendor/firebase.js';
import { $, esc, estado, plata } from './base.js';
import { db } from './conexion.js';
import { fechaDeHoy } from './jornada.js';
import { quienAtiende } from './pedidos.js';

export const CARTA_DE = (fecha) => doc(db, 'cartas', fecha);

// Qué fecha se está editando en el panel. Arranca en la de hoy.
export let fechaCarta = null;

export function escucharCartas() {
  onSnapshot(collection(db, 'cartas'), (snap) => {
    estado.cartas = Object.fromEntries(
      snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    pintarCartaDeFecha();
  }, () => {});
  onSnapshot(collection(db, 'catalogo'), (snap) => {
    estado.catalogo = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));
    pintarCartaDeFecha();
  }, () => {});
}

// Los precios de una fecha, o null si esa fecha no tiene carta propia.
export const preciosDe = (fecha) => estado.cartas?.[fecha]?.precios || null;
export const estaCerrada = (fecha) => estado.cartas?.[fecha]?.cerrada === true;

// De dónde salen los productos que se pueden poner en una carta: del
// catálogo si está cargado, y si no de lo que hay hoy en la carta viva. Así
// esto sirve desde el primer día, sin tener que migrar nada antes.
export function productosDisponibles() {
  const cat = (estado.catalogo || []).filter((c) => c.activo !== false);
  if (cat.length) return cat;
  return (estado.carta || []).filter((c) => c.enCarta !== false);
}

// ---------- la pantalla ----------
export function abrirCartaDeFecha() {
  fechaCarta = fechaCarta || fechaDeHoy();
  estado.editandoPrecios = {};
  pintarCartaDeFecha();
  $('#dlgCartaFecha').showModal();
}

export function pintarCartaDeFecha() {
  if (!$('#dlgCartaFecha')?.open) return;
  const fecha = fechaCarta;
  const precios = preciosDe(fecha);
  const cerrada = estaCerrada(fecha);
  const productos = productosDisponibles();
  const otras = Object.keys(estado.cartas || {})
    .filter((f) => f !== fecha).sort().reverse().slice(0, 10);

  $('#tituloCartaFecha').textContent = `Carta del ${fecha}`;
  $('#cuerpoCartaFecha').innerHTML = `
    <label class="campo">
      <span>Qué fecha</span>
      <input id="inpFechaCarta" type="date" value="${esc(fecha)}">
    </label>

    ${cerrada ? `<div class="aviso"><span>🔒</span><div>
      <b>Esa noche está cerrada.</b> Los precios quedaron como se cobraron.
      ${estado.dueno ? 'Podés corregirlos igual porque sos el dueño.' : ''}</div></div>` : ''}

    ${!precios ? `<div class="aviso"><span>📋</span><div>
      <b>Esta fecha todavía no tiene carta propia.</b><br>
      Mientras no la tenga, esa noche se vende la carta de siempre. Armala solo
      si esa noche vende algo distinto.</div></div>
      <div style="display:flex;gap:.6rem;margin:.8rem 0">
        <button class="btn primario" id="btnDesdeCatalogo" style="flex:1">
          Armar con todo</button>
        ${otras.length ? `<button class="btn" id="btnCopiarOtra" style="flex:1">
          Copiar de otra fecha</button>` : ''}
      </div>` : ''}

    ${precios ? `
      <div class="grupo-personal" style="display:flex;align-items:center;gap:.6rem">
        <span style="flex:1">${Object.keys(precios).length} productos esa noche</span>
      </div>
      <table class="ranking"><tbody>
        ${productos.map((c) => {
          const puesto = precios[c.id] !== undefined;
          return `
          <tr class="${puesto ? '' : 'apagada'}">
            <td>
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
                <input type="checkbox" data-en-carta="${esc(c.id)}" style="width:auto;margin:0"
                       ${puesto ? 'checked' : ''} ${cerrada && !estado.dueno ? 'disabled' : ''}>
                <span>${esc(c.nombre || c.id)}</span>
              </label>
            </td>
            <td class="n" style="width:7rem">
              <input data-precio-fecha="${esc(c.id)}" type="number" min="0" inputmode="numeric"
                     value="${puesto ? precios[c.id] : ''}"
                     placeholder="${Number(c.precio || 0) || ''}"
                     ${cerrada && !estado.dueno ? 'disabled' : ''}
                     aria-label="Precio de ${esc(c.nombre || c.id)} esa noche"
                     style="width:100%;text-align:right">
            </td>
          </tr>`;
        }).join('')}
      </tbody></table>
      <p style="font-size:.76rem;color:var(--suave);margin:.6rem 0 0">
        El precio vacío toma el del catálogo. Lo que destildes no se vende esa
        noche.</p>
      <button class="btn primario ancho-full" id="btnGuardarCartaFecha"
              style="margin-top:.8rem" ${cerrada && !estado.dueno ? 'disabled' : ''}>
        Guardar la carta del ${esc(fecha)}</button>` : ''}`;

  $('#inpFechaCarta').onchange = () => {
    fechaCarta = $('#inpFechaCarta').value || fechaDeHoy();
    pintarCartaDeFecha();
  };
  if ($('#btnDesdeCatalogo')) $('#btnDesdeCatalogo').onclick = () => armarCarta(null);
  if ($('#btnCopiarOtra')) $('#btnCopiarOtra').onclick = () => {
    const cual = prompt('¿De qué fecha la copio?\n\n' + otras.join('\n'), otras[0]);
    if (cual && estado.cartas[cual]) armarCarta(cual);
  };
  if ($('#btnGuardarCartaFecha')) $('#btnGuardarCartaFecha').onclick = guardarCartaDeFecha;
}

// Armar la carta de una fecha: con todo el catálogo, o copiando otra noche.
export async function armarCarta(desde) {
  const fuente = desde ? (estado.cartas[desde]?.precios || {}) : null;
  const precios = fuente
    ? { ...fuente }
    : Object.fromEntries(productosDisponibles().map((c) => [c.id, Number(c.precio || 0)]));

  try {
    await setDoc(CARTA_DE(fechaCarta), {
      fecha: fechaCarta,
      precios,
      copiadaDe: desde || 'catalogo',
      creadaEn: serverTimestamp(),
      creadaPor: quienAtiende() || estado.usuario || 'la casa',
      cerrada: false,
    });
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

export async function guardarCartaDeFecha() {
  const precios = {};
  $('#cuerpoCartaFecha').querySelectorAll('[data-en-carta]').forEach((chk) => {
    if (!chk.checked) return;
    const id = chk.dataset.enCarta;
    const campo = $(`[data-precio-fecha="${CSS.escape(id)}"]`);
    const delCatalogo = Number(productosDisponibles().find((c) => c.id === id)?.precio || 0);
    precios[id] = Math.max(0, Math.round(Number(campo?.value) || delCatalogo));
  });

  if (!Object.keys(precios).length) {
    alert('Una carta sin nada adentro no es una carta.\n\n'
      + 'Dejá al menos un producto, o borrá la fecha.');
    return;
  }

  const btn = $('#btnGuardarCartaFecha');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await updateDoc(CARTA_DE(fechaCarta), { precios });
    btn.textContent = 'Guardado ✓';
  } catch (e) {
    btn.disabled = false; btn.textContent = `Guardar la carta del ${fechaCarta}`;
    alert('No se pudo: ' + (e.code || e.message));
  }
}
