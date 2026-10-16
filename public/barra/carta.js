import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '/vendor/firebase.js';
import { pintarAdminCostos } from './administracion.js';
import { $, esc, estado, plata } from './base.js';
import { app, db } from './conexion.js';
import { comoSeDice, rindeDeposito, sincronizarCartaConDeposito } from './deposito.js';
import { hora } from './invitados.js';
import { cajaActual, pintarTablero, quienAtiende } from './pedidos.js';

// ---------- de qué sale cada producto de la carta ----------
export let recetaDe = null;
export function abrirReceta(item) {
  recetaDe = item;
  $('#tituloReceta').textContent = `De qué sale · ${item.nombre || item.id}`;
  $('#cuerpoReceta').innerHTML = estado.insumos.length
    ? `<div class="lista-conteo">${estado.insumos.map((i) => {
        const linea = (item.receta || []).find((r) => r.insumoId === i.id);
        return `
        <div class="item">
          <div class="cuerpo">
            <div class="nombre">${esc(i.nombre)}</div>
            <div class="desc">hay ${comoSeDice(i)}${
              Number(i.medidas || 1) > 1 ? ` · ${i.medidas} medidas por ${esc(i.unidad || 'unidad')}` : ''}</div>
          </div>
          <input class="conteo-num" type="number" min="0" inputmode="numeric"
                 data-receta="${esc(i.id)}" placeholder="0"
                 value="${linea?.medidas ?? ''}">
        </div>`;
      }).join('')}</div>`
    : `<div class="aviso mal"><span>⚠</span><div>
        <b>Todavía no hay insumos.</b> Cargalos en <b>Depósito</b> y volvé.</div></div>`;
  $('#dlgReceta').showModal();
}

export async function guardarReceta() {
  const receta = [];
  $('#cuerpoReceta').querySelectorAll('[data-receta]').forEach((inp) => {
    const medidas = Number(inp.value) || 0;
    if (medidas > 0) receta.push({ insumoId: inp.dataset.receta, medidas });
  });
  try {
    await updateDoc(doc(db, 'carta', recetaDe.id), { receta });
    $('#dlgReceta').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

// ---------- el conteo de la noche ----------
//
// Es control, no inventario: lo que la barra cuenta a mano al abrir y al
// cerrar. NO toca el stock de la carta. Sirve para una sola cosa, que es la
// que importa: comparar lo que había, lo que se vendió y lo que quedó.
export function escucharConteo() {
  const caja = cajaActual();
  if (estado.conteoDe === caja) return;
  estado.conteoDe = caja;
  if (estado.cortarConteo) estado.cortarConteo();
  estado.cortarConteo = onSnapshot(doc(db, 'conteos', caja), (d) => {
    estado.conteo = d.exists() ? d.data() : null;
    pintarConteo();
  }, () => {});
}

// Qué se cuenta: lo del depósito (botellas, latas) y los productos de la carta
// que todavía no tienen receta y llevan su propio stock. Contar "Fernet con
// coca" no tiene sentido cuando sale de una botella: lo que se cuenta es la
// botella.
export function cosasAContar() {
  const sueltos = estado.carta.filter((i) =>
    i.enCarta !== false && !(i.receta || []).length && typeof i.stock === 'number');
  return [
    ...estado.insumos.map((i) => ({
      clave: `ins:${i.id}`, nombre: i.nombre, insumo: i,
      medidas: Math.max(1, Number(i.medidas || 1)),
      unidad: i.unidad || 'unidad', enApp: Number(i.stock || 0),
    })),
    ...sueltos.map((i) => ({
      clave: `item:${i.id}`, nombre: i.nombre || i.id, insumo: null,
      medidas: 1, unidad: 'unidad', enApp: Number(i.stock || 0),
    })),
  ];
}

// Lo que salió en esta caja, en las mismas unidades en que se cuenta: medidas
// para el depósito, unidades para lo suelto.
export function consumoDeLaCaja() {
  const m = new Map();
  const sumar = (clave, cuanto) => m.set(clave, (m.get(clave) || 0) + cuanto);
  for (const p of estado.pedidos) {
    if (p.estado !== 'entregado') continue;
    for (const i of (p.items || [])) {
      const c = estado.carta.find((x) => x.id === i.id);
      const cuantos = Number(i.cantidad || 0);
      if (c && (c.receta || []).length) {
        for (const r of c.receta) sumar(`ins:${r.insumoId}`, Number(r.medidas || 0) * cuantos);
      } else {
        sumar(`item:${i.id}`, cuantos);
      }
    }
  }
  return m;
}

export function abrirConteo() {
  escucharConteo();
  estado.cargandoConteo = {};
  $('#dlgConteo').showModal();
  pintarConteo();
}

export function pintarConteo() {
  if (!$('#dlgConteo').open) return;
  const c = estado.conteo || {};
  const hayApertura = !!c.aperturaEn;
  const hayCierre = !!c.cierreEn;
  const etapa = !hayApertura ? 'apertura' : (!hayCierre ? 'cierre' : 'listo');
  const vendido = consumoDeLaCaja();
  const cosas = cosasAContar();

  $('#tituloConteo').textContent = {
    apertura: 'Conteo de apertura',
    cierre: 'Conteo de cierre',
    listo: 'Conteo de la noche',
  }[etapa];
  $('#subtituloConteo').textContent = {
    apertura: 'Contá lo que hay antes de abrir. Esto no toca el stock: es control.',
    cierre: 'Contá lo que quedó. Abajo vas a ver si falta algo.',
    listo: 'Ya está cerrado. Esto es lo que dio.',
  }[etapa];

  if (!cosas.length) {
    $('#cuerpoConteo').innerHTML = `<div class="aviso"><span>📦</span><div>
      <b>No hay nada para contar.</b> Cargá los insumos del depósito, o ponele
      stock a los productos de la carta.</div></div>`;
    return;
  }

  // Cerrado: la comparación, que es para lo que se hizo todo esto.
  if (etapa === 'listo') {
    const filas = cosas.map((x) => {
      const abrio = Number(c.apertura?.[x.clave] ?? 0);
      const salio = Number(vendido.get(x.clave) || 0);
      const cerro = Number(c.cierre?.[x.clave] ?? 0);
      return { x, abrio, salio, cerro, dif: cerro - (abrio - salio) };
    }).filter((f) => f.abrio || f.salio || f.cerro);
    const faltan = filas.filter((f) => f.dif < 0);
    const comoSe = (f, n) => f.x.medidas > 1
      ? `${n} <small>med</small>` : String(n);
    $('#cuerpoConteo').innerHTML = `
      ${faltan.length ? `<div class="aviso mal"><span>⚠</span><div>
        <b>Falta mercadería en ${faltan.length} producto${faltan.length === 1 ? '' : 's'}.</b><br>
        Puede ser rotura, un trago servido de más o algo que no se cobró.</div></div>`
        : `<div class="aviso ok"><span>✓</span><div>
        <b>Cierra todo.</b> Lo que quedó coincide con lo vendido.</div></div>`}
      <table class="ranking tabla-conteo" style="margin-top:.8rem"><thead>
        <tr><th>Qué</th><th class="n">Abrió</th><th class="n">Salió</th>
            <th class="n">Quedó</th><th class="n">Dif</th></tr></thead><tbody>
        ${filas.map((f) => `
          <tr class="${f.dif < 0 ? 'falta' : (f.dif > 0 ? 'sobra' : '')}">
            <td>${esc(f.x.nombre)}</td>
            <td class="n">${comoSe(f, f.abrio)}</td><td class="n">${f.salio}</td>
            <td class="n">${f.cerro}</td>
            <td class="n">${f.dif > 0 ? '+' : ''}${f.dif || '—'}</td>
          </tr>`).join('')}
      </tbody></table>
      <p style="font-size:.76rem;color:var(--suave);margin:.8rem 0 0">
        Lo contó ${esc(c.aperturaPor || '—')} al abrir y ${esc(c.cierrePor || '—')} al cerrar.
        Lo del depósito va en medidas. El conteo no movió el stock.</p>
      <button class="btn ancho-full solo-gerente-inline" id="btnRehacerConteo"
              style="margin-top:.7rem">Empezar un conteo nuevo</button>`;
    if ($('#btnRehacerConteo')) $('#btnRehacerConteo').onclick = rehacerConteo;
    return;
  }

  // Abierto o por cerrar: la planilla. Se cuenta en unidades enteras o medias
  // botellas, que es como se cuenta en una barra.
  $('#cuerpoConteo').innerHTML = `
    ${hayApertura ? `<p style="font-size:.8rem;color:var(--suave);margin:0 0 .6rem">
      Abrió ${esc(c.aperturaPor || '')} ${c.aperturaEn?.toDate?.()
        ? 'a las ' + hora(c.aperturaEn) : ''}.</p>` : ''}
    <div class="lista-conteo">
      ${cosas.map((x) => {
        const abrio = Number(c.apertura?.[x.clave] ?? 0);
        const salio = Number(vendido.get(x.clave) || 0);
        const enApp = x.medidas > 1
          ? `${Math.floor(x.enApp / x.medidas)} ${esc(x.unidad)}${
              x.enApp % x.medidas ? ' y ' + (x.enApp % x.medidas) + ' med' : ''}`
          : x.enApp;
        return `
        <div class="item">
          <div class="cuerpo">
            <div class="nombre">${esc(x.nombre)}</div>
            <div class="desc">en la app: ${enApp}${
              x.medidas > 1 ? ` · ${x.medidas} medidas por ${esc(x.unidad)}` : ''}${
              etapa === 'cierre' ? ` · abrió ${abrio} · salió ${salio}` : ''}</div>
          </div>
          <input class="conteo-num" type="number" min="0" step="${x.medidas > 1 ? '0.5' : '1'}"
                 inputmode="decimal" data-conteo="${esc(x.clave)}"
                 data-medidas="${x.medidas}" placeholder="0"
                 value="${estado.cargandoConteo[x.clave] ?? ''}">
        </div>`;
      }).join('')}
    </div>
    <p style="font-size:.76rem;color:var(--suave);margin:.6rem 0 0">
      Contá en ${cosas.some((x) => x.medidas > 1)
        ? 'unidades: media botella se escribe 0.5' : 'unidades'}.</p>
    <button class="btn primario ancho-full" id="btnGuardarConteo" style="margin-top:.8rem">
      ${etapa === 'apertura' ? 'Guardar el conteo de apertura' : 'Cerrar el conteo'}</button>`;

  $('#cuerpoConteo').querySelectorAll('[data-conteo]').forEach((inp) => {
    inp.oninput = () => { estado.cargandoConteo[inp.dataset.conteo] = inp.value; };
  });
  $('#btnGuardarConteo').onclick = () => guardarConteo(etapa);
}

export async function guardarConteo(etapa) {
  // Se cuenta en unidades y se guarda en medidas: media botella de 10 medidas
  // son 5. Así la comparación con lo vendido es contra lo mismo.
  const numeros = {};
  $('#cuerpoConteo').querySelectorAll('[data-conteo]').forEach((inp) => {
    if (inp.value === '') return;
    const medidas = Math.max(1, Number(inp.dataset.medidas || 1));
    numeros[inp.dataset.conteo] = Math.max(0, Math.round((Number(inp.value) || 0) * medidas));
  });
  if (!Object.keys(numeros).length) {
    alert('Cargá al menos un producto.');
    return;
  }
  const btn = $('#btnGuardarConteo');
  btn.disabled = true; btn.textContent = 'Guardando…';
  const quien = quienAtiende() || estado.usuario || 'casa';
  try {
    await setDoc(doc(db, 'conteos', cajaActual()), etapa === 'apertura'
      ? { cajaId: cajaActual(), nombre: estado.evento?.nombre || 'Día',
          apertura: numeros, aperturaEn: serverTimestamp(), aperturaPor: quien }
      : { cierre: numeros, cierreEn: serverTimestamp(), cierrePor: quien },
      { merge: true });
    estado.cargandoConteo = {};
  } catch (e) {
    alert('No se pudo guardar: ' + (e.code || e.message));
  }
  btn.disabled = false;
}

export async function rehacerConteo() {
  if (!confirm('¿Empezar un conteo nuevo?\n\nSe borra el de esta noche.')) return;
  try { await deleteDoc(doc(db, 'conteos', cajaActual())); estado.cargandoConteo = {}; }
  catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}

export function escucharCarta() {
  onSnapshot(collection(db, 'carta'), (snap) => {
    estado.carta = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || (a.orden ?? 999) - (b.orden ?? 999));
    pintarCartaBar();
    pintarTablero();
    // El margen sale de cruzar el precio de venta con el costo de la receta:
    // si cambia cualquiera de los dos, hay que volver a hacer la cuenta.
    pintarAdminCostos();
    // Una receta nueva, o un producto nuevo con receta, también mueve el
    // número: no solo lo mueve el depósito.
    sincronizarCartaConDeposito();
  });
}

export function pintarCartaBar() {
  const cont = $('#cartaBar');
  if (!estado.carta.length) {
    cont.innerHTML = `<div class="vacio">La carta está vacía.<br><small>Desde la Mac: <code>npm run seed</code></small></div>`;
    return;
  }
  // La carta tiene que salir siempre del depósito: un producto sin receta se
  // vende sin descontar ninguna botella, y el depósito deja de servir para
  // saber qué hay. Mientras falte alguno, el panel lo dice arriba de todo.
  const sueltos = estado.carta.filter((i) =>
    i.enCarta !== false && !((i.receta || []).length));

  cont.innerHTML = `${sueltos.length && !estado.esAparato ? `
    <div class="aviso mal" style="margin-bottom:.9rem"><span>⚠</span><div>
      <b>${sueltos.length} de ${estado.carta.filter((i) => i.enCarta !== false).length}
      productos no salen del depósito.</b> Venderlos no descuenta ninguna botella.
      Tocales el 🧾+ y deciles de qué insumo salen y cuántas medidas llevan:
      ${esc(sueltos.map((i) => i.nombre || i.id).join(', '))}.</div></div>` : ''}`
    + estado.carta.map((i) => {
    const fuera = i.enCarta === false;   // retirado: el cliente no lo ve
    // Con receta, el número no se toca a mano: lo pone el depósito. Mostrar
    // los − + ahí sería mentir, porque la próxima venta lo vuelve a calcular.
    const delDeposito = (i.receta || []).length > 0;
    const rinde = delDeposito ? rindeDeposito(i) : null;
    return `
    <div class="item ${fuera || i.disponible === false || i.apagadoAMano || rinde === 0 ? 'agotado' : ''}">
      <div class="cuerpo">
        <div class="nombre">${esc(i.nombre || i.id)}${fuera ? ' — <small>fuera de carta</small>' : ''}</div>
        <div class="desc">${esc(i.categoria || '')} · ${plata(i.precio)} · ${
          delDeposito
            ? (rinde === 0 ? 'sin material en el depósito' : 'sale del depósito')
            : '<b style="color:var(--naranja)">no sale del depósito</b>'}${
          i.apagadoAMano ? ' · <b style="color:var(--rojo)">agotado a mano</b>' : ''}</div>
      </div>
      ${delDeposito ? `
      <div class="cant" title="Lo que el depósito alcanza a dar. Para que suba, cargá mercadería.">
        <span class="n">${rinde}</span>
      </div>` : `
      <div class="cant">
        <button data-stock="${i.id}" data-d="-1" aria-label="Restar stock" ${fuera ? 'disabled' : ''}>−</button>
        <span class="n">${typeof i.stock === 'number' ? i.stock : '∞'}</span>
        <button data-stock="${i.id}" data-d="1" aria-label="Sumar stock" ${fuera ? 'disabled' : ''}>+</button>
      </div>`}
      <button class="btn ${i.apagadoAMano ? 'peligro' : ''}" data-toggle="${i.id}"
              style="padding:.4rem .7rem;font-size:.82rem" ${fuera ? 'disabled' : ''}
              title="${delDeposito
                ? 'Apagarlo a mano: el depósito no lo vuelve a encender'
                : 'Marcarlo agotado'}">
        ${i.apagadoAMano ? 'Reactivar'
          : delDeposito ? 'Agotar a mano'
          : i.disponible === false ? 'Activar' : 'Agotar'}
      </button>
      <button class="btn solo-gerente-inline" data-receta-de="${i.id}"
              style="padding:.4rem .7rem;font-size:.82rem"
              title="De qué insumo sale">${(i.receta || []).length ? '🧾' : '🧾+'}</button>
      <button class="btn solo-gerente-inline" data-carta="${i.id}" style="padding:.4rem .7rem;font-size:.82rem">
        ${fuera ? 'Poner en carta' : 'Sacar'}
      </button>
    </div>`;
  }).join('');

  cont.querySelectorAll('[data-receta-de]').forEach((b) => b.onclick = () =>
    abrirReceta(estado.carta.find((i) => i.id === b.dataset.recetaDe)));
  cont.querySelectorAll('[data-stock]').forEach((b) => b.onclick = async () => {
    const i = estado.carta.find((x) => x.id === b.dataset.stock);
    const n = Math.max(0, (typeof i.stock === 'number' ? i.stock : 0) + Number(b.dataset.d));
    try { await updateDoc(doc(db, 'carta', i.id), { stock: n, disponible: n > 0 }); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  });
  // Agotar a mano. En un producto que sale del depósito no alcanza con
  // apagar `disponible`: el próximo movimiento de stock lo vuelve a encender.
  // Se rompió la botella, se volcó el hielo: queda la marca, y el cálculo
  // mira y no toca hasta que alguien la saque.
  cont.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
    const i = estado.carta.find((x) => x.id === b.dataset.toggle);
    const sale = (i.receta || []).length > 0;
    const datos = sale
      ? (i.apagadoAMano
        ? { apagadoAMano: false, disponible: rindeDeposito(i) > 0 }
        : { apagadoAMano: true, disponible: false })
      : { disponible: i.disponible === false };
    try { await updateDoc(doc(db, 'carta', i.id), datos); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  });
  // Sacar de la carta / volver a ponerlo. Nada se borra: el item queda guardado.
  cont.querySelectorAll('[data-carta]').forEach((b) => b.onclick = async () => {
    const i = estado.carta.find((x) => x.id === b.dataset.carta);
    const volver = i.enCarta === false;
    if (!volver && !confirm(`¿Sacar "${i.nombre}" de la carta? El cliente deja de verlo.`)) return;
    try { await updateDoc(doc(db, 'carta', i.id), { enCarta: volver, ...(volver ? { disponible: true } : {}) }); }
    catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
  });
}
