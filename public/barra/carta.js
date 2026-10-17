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
import { comoSeDice, huerfanosDe, porQueNoSale, rindeDeposito, sincronizarCartaConDeposito } from './deposito.js';
import { hora } from './invitados.js';
import { cajaActual, pintarTablero, quienAtiende } from './pedidos.js';
import { moverInsumos, opcionesDe, recetaCompleta, saleDelDeposito } from './stock.js';

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

  // Una línea que apunta a un insumo borrado no tenía fila donde aparecer: la
  // lista se arma recorriendo el depósito, y lo que no está en el depósito no
  // se dibuja. El producto quedaba en cero y acá se veía todo bien, que es la
  // peor combinación posible. Ahora se muestra, y guardar la saca.
  const fantasmas = (item.receta || [])
    .filter((r) => !estado.insumos.some((i) => i.id === r.insumoId));
  if (fantasmas.length) {
    $('#cuerpoReceta').insertAdjacentHTML('afterbegin', `
      <div class="aviso mal" style="margin-bottom:.8rem"><span>⛔</span><div>
        <b>Esta receta apunta a ${fantasmas.length}
        ${fantasmas.length === 1 ? 'insumo que ya no está' : 'insumos que ya no están'}
        en el depósito.</b> Por eso el producto sale agotado aunque haya
        mercadería. <b>Tocá Guardar</b> y
        ${fantasmas.length === 1 ? 'esa línea se va' : 'esas líneas se van'};
        después poné de qué sale ahora.
        <br><small>${fantasmas.map((r) => `«${esc(r.insumoId)}» × ${esc(String(r.medidas))}`).join(' · ')}</small>
      </div></div>`);
  }
  pintarMarcas(item);
  verPestañaReceta('receta');
  $('#tabsReceta').querySelectorAll('[data-tabreceta]').forEach((b) =>
    b.onclick = () => verPestañaReceta(b.dataset.tabreceta));
  $('#dlgReceta').showModal();
}

function verPestañaReceta(cual) {
  $('#cuerpoReceta').hidden = cual !== 'receta';
  $('#cuerpoMarcas').hidden = cual !== 'marcas';
  $('#tabsReceta').querySelectorAll('[data-tabreceta]').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.tabreceta === cual)));
}

// ---------- las marcas entre las que elige el cliente ----------
//
// Una cerveza en lata no es un producto: son cuatro latas distintas al mismo
// precio, cada una de su propia caja. Separarlas en cuatro productos llena la
// carta de renglones casi iguales; esto las deja en uno solo y hace que el
// cliente diga cuál quiere antes de agregarla.
//
// Lo que define una marca es de qué insumo sale. Sin eso no es una marca: es
// un texto, y el depósito no se entera de nada.
export function pintarMarcas(item) {
  const marcas = opcionesDe(item);
  $('#cuerpoMarcas').innerHTML = !estado.insumos.length
    ? `<div class="aviso mal"><span>⚠</span><div>
        <b>Todavía no hay insumos.</b> Cargalos en <b>Depósito</b> y volvé.</div></div>`
    : `<p style="color:var(--suave);font-size:.84rem;margin:0 0 .7rem">
        Marcá los insumos entre los que el cliente elige. Cada uno se le
        ofrece como una opción y descuenta de su propia caja. Si no marcás
        ninguno, el producto se vende sin preguntar nada.</p>
      <div class="lista-conteo">${estado.insumos.map((i) => {
        const puesta = marcas.find((o) => o.insumoId === i.id);
        return `
        <div class="item">
          <label class="cuerpo" style="display:flex;align-items:center;gap:.6rem;cursor:pointer">
            <input type="checkbox" data-marca="${esc(i.id)}" style="width:auto;margin:0"
                   ${puesta ? 'checked' : ''}>
            <span>
              <span class="nombre">${esc(i.nombre)}</span>
              <span class="desc" style="display:block">hay ${comoSeDice(i)}</span>
            </span>
          </label>
          <input class="conteo-num" type="number" min="0" inputmode="numeric"
                 data-marca-medidas="${esc(i.id)}" placeholder="1"
                 title="Medidas que se lleva esta marca"
                 value="${puesta?.medidas ?? ''}">
        </div>`;
      }).join('')}</div>
      <p style="font-size:.76rem;color:var(--suave);margin:.6rem 0 0">
        El número es cuántas medidas se lleva esa marca. Vacío cuenta como 1.</p>`;
}

export async function guardarReceta() {
  const receta = [];
  $('#cuerpoReceta').querySelectorAll('[data-receta]').forEach((inp) => {
    const medidas = Number(inp.value) || 0;
    if (medidas > 0) receta.push({ insumoId: inp.dataset.receta, medidas });
  });

  // El id de la marca es el del insumo: es lo único que no se repite y no
  // hay que inventarlo. El nombre se copia del depósito para que el cliente
  // vea "Quilmes" y no un código.
  const opciones = [];
  $('#cuerpoMarcas').querySelectorAll('[data-marca]').forEach((chk) => {
    if (!chk.checked) return;
    const id = chk.dataset.marca;
    const ins = estado.insumos.find((i) => i.id === id);
    const medidas = Math.max(1,
      Number($(`[data-marca-medidas="${CSS.escape(id)}"]`)?.value) || 1);
    opciones.push({ id, nombre: ins?.nombre || id, insumoId: id, medidas });
  });

  if (opciones.length === 1) {
    alert('Una sola marca no es una elección.\n\nPoné dos o más, o ninguna y '
      + 'cargala en "Siempre lleva".');
    return;
  }

  try {
    await updateDoc(doc(db, 'carta', recetaDe.id), { receta, opciones });
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
    i.enCarta !== false && !saleDelDeposito(i) && typeof i.stock === 'number');
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
      // Con la marca que se vendió: dos Quilmes salen de la caja de Quilmes,
      // no de una bolsa común. Sin esto, un producto que sale solo de sus
      // marcas se contaba como una unidad suelta y el conteo no cerraba
      // nunca contra el depósito.
      const receta = c ? recetaCompleta(c, i.opcionId) : [];
      if (receta.length) {
        for (const r of receta) sumar(`ins:${r.insumoId}`, Number(r.medidas || 0) * cuantos);
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
      <button class="btn primario ancho-full solo-gerente-inline" id="btnAplicarConteo"
              style="margin-top:.9rem">Aplicar conteo al depósito</button>
      <p class="solo-gerente-inline" style="font-size:.76rem;color:var(--suave);margin:.4rem 0 0">
        Deja el stock en lo que contaste y anota la diferencia como merma.
        Vas a ver qué cambia antes de confirmar.</p>
      <button class="btn ancho-full solo-gerente-inline" id="btnRehacerConteo"
              style="margin-top:.7rem">Empezar un conteo nuevo</button>`;
    if ($('#btnRehacerConteo')) $('#btnRehacerConteo').onclick = rehacerConteo;
    if ($('#btnAplicarConteo')) $('#btnAplicarConteo').onclick = pedirAplicarConteo;
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

// ---------- aplicar el conteo al depósito ----------
//
// El conteo por sí solo no mueve nada: es control. Esto es el paso aparte,
// a mano y con confirmación, que dice "lo que hay es lo que conté".
//
// Nunca automático, a propósito. Un conteo mal cargado que ajusta solo es
// peor que no contar: borra las ventas de la noche sin que nadie se entere.
//
// Lo que se aplica es "lo contado contra lo que dice la app AHORA", no contra
// lo que decía cuando se contó. Si entre el conteo y esto alguien vendió, la
// diferencia lo muestra y el que confirma lo ve.
export function diferenciasDelConteo() {
  const c = estado.conteo || {};
  if (!c.cierreEn) return [];
  return cosasAContar()
    .filter((x) => c.cierre?.[x.clave] !== undefined)
    .map((x) => {
      const contado = Number(c.cierre[x.clave]);
      const enApp = Number(x.enApp || 0);
      return { x, contado, enApp, dif: contado - enApp };
    })
    .filter((f) => f.dif !== 0);
}

export function pedirAplicarConteo() {
  const filas = diferenciasDelConteo();
  const comoSe = (f, n) => f.x.medidas > 1
    ? `${n} <small>med</small>` : String(n);

  if (!filas.length) {
    $('#cuerpoConteo').innerHTML = `
      <div class="aviso ok"><span>✓</span><div>
        <b>No hay nada que ajustar.</b> Lo que contaste es exactamente lo que
        dice la app.</div></div>
      <button class="btn ancho-full" id="btnVolverConteo" style="margin-top:.9rem">Volver</button>`;
    $('#btnVolverConteo').onclick = pintarConteo;
    return;
  }

  const faltan = filas.filter((f) => f.dif < 0);
  const sobran = filas.filter((f) => f.dif > 0);

  $('#cuerpoConteo').innerHTML = `
    <div class="aviso mal"><span>⚠</span><div>
      <b>Esto cambia el stock del depósito.</b><br>
      ${faltan.length ? `${faltan.length} con menos de lo que dice la app` : ''}${
        faltan.length && sobran.length ? ' · ' : ''}${
        sobran.length ? `${sobran.length} con más` : ''}.
      Lo que falta queda anotado como merma, con tu motivo, y no se borra.</div></div>

    <table class="ranking tabla-conteo" style="margin-top:.8rem"><thead>
      <tr><th>Qué</th><th class="n">Dice la app</th><th class="n">Contaste</th>
          <th class="n">Queda en</th><th class="n">Dif</th></tr></thead><tbody>
      ${filas.map((f) => `
        <tr class="${f.dif < 0 ? 'falta' : 'sobra'}">
          <td>${esc(f.x.nombre)}</td>
          <td class="n">${comoSe(f, f.enApp)}</td>
          <td class="n">${comoSe(f, f.contado)}</td>
          <td class="n"><b>${comoSe(f, f.contado)}</b></td>
          <td class="n">${f.dif > 0 ? '+' : ''}${f.dif}</td>
        </tr>`).join('')}
    </tbody></table>

    <label class="campo" style="margin-top:.9rem">
      <span>¿Por qué la diferencia? <small>(queda anotado para siempre)</small></span>
      <input id="inpMotivoConteo" maxlength="200" autocomplete="off"
             placeholder="ej. se rompieron dos botellas en la barra">
    </label>
    <div id="errorConteo" class="aviso mal oculto" style="margin:.2rem 0 .6rem">
      <span>⚠</span><div id="errorConteoTexto"></div></div>

    <div style="display:flex;gap:.6rem;margin-top:.4rem">
      <button class="btn" id="btnVolverConteo" style="flex:1">Volver</button>
      <button class="btn primario" id="btnConfirmarConteo" style="flex:1.4">
        Ajustar ${filas.length} producto${filas.length === 1 ? '' : 's'}</button>
    </div>`;

  $('#btnVolverConteo').onclick = pintarConteo;
  $('#btnConfirmarConteo').onclick = aplicarConteo;
  $('#inpMotivoConteo').focus();
}

export async function aplicarConteo() {
  const filas = diferenciasDelConteo();
  if (!filas.length) { pintarConteo(); return; }

  const motivo = $('#inpMotivoConteo').value.trim();
  const fallar = (t) => {
    $('#errorConteoTexto').textContent = t;
    $('#errorConteo').classList.remove('oculto');
  };
  if (motivo.length < 3) {
    fallar('Escribí el motivo: es lo único que queda después del ajuste.');
    $('#inpMotivoConteo').focus();
    return;
  }

  const btn = $('#btnConfirmarConteo');
  btn.disabled = true; btn.textContent = 'Ajustando…';

  // Todo en un lote: el stock nuevo y la merma anotada. Si se cayera en el
  // medio, quedaría el stock cambiado sin ninguna explicación de por qué.
  const quien = quienAtiende() || estado.usuario || 'la casa';
  const lote = cajaActual();
  const movimientos = [];
  const extras = [];
  const apuntes = [];

  for (const f of filas) {
    if (f.x.insumo) movimientos.push({ insumoId: f.x.insumo.id, valor: f.contado });
    else extras.push({ id: f.x.clave.slice('item:'.length), valor: f.contado });

    apuntes.push({
      coleccion: 'mermas',
      id: doc(collection(db, 'mermas')).id,
      crear: true,
      datos: {
        cajaId: lote,
        clave: f.x.clave,
        nombre: f.x.nombre,
        unidad: f.x.unidad || 'unidad',
        enApp: f.enApp,
        contado: f.contado,
        diferencia: f.dif,
        motivo, quien,
        cuando: serverTimestamp(),
      },
    });
  }

  try {
    await moverInsumos(movimientos, extras, apuntes);
    $('#cuerpoConteo').innerHTML = `
      <div class="aviso ok"><span>✓</span><div>
        <b>Listo.</b> El depósito quedó en lo que contaste, y la diferencia
        quedó anotada.</div></div>
      <button class="btn ancho-full" id="btnVolverConteo" style="margin-top:.9rem">Volver</button>`;
    $('#btnVolverConteo').onclick = pintarConteo;
  } catch (e) {
    btn.disabled = false;
    btn.textContent = `Ajustar ${filas.length} producto${filas.length === 1 ? '' : 's'}`;
    fallar('No se pudo: ' + (e.code || e.message)
      + '. No se cambió nada: el ajuste va entero o no va.');
  }
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
  if (!cont) return;
  // Si están escribiendo un precio acá adentro, repintar se lo borra a mitad
  // de camino. La pantalla espera: el próximo cambio la vuelve a dibujar.
  //
  // Solo el casillero del precio, no cualquier cosa con foco: al tocar un
  // botón el foco queda EN ese botón, que también vive acá adentro, y un
  // guardia ancho dejaba la pantalla congelada después de cada click —
  // marcabas agotado y no pasaba nada a la vista.
  const foco = document.activeElement;
  if (foco && cont.contains(foco) && foco.matches?.('input[data-precio-carta]')) return;
  if (!estado.carta.length) {
    cont.innerHTML = `<div class="vacio">La carta está vacía.<br><small>Desde la Mac: <code>npm run seed</code></small></div>`;
    return;
  }
  // La carta tiene que salir siempre del depósito: un producto sin receta se
  // vende sin descontar ninguna botella, y el depósito deja de servir para
  // saber qué hay. Mientras falte alguno, el panel lo dice arriba de todo.
  const sueltos = estado.carta.filter((i) =>
    i.enCarta !== false && !saleDelDeposito(i));

  // Y una receta rota es peor que una que falta: el producto sale agotado en
  // el QR aunque el depósito esté lleno, y el cartel de abajo manda a comprar
  // lo que ya está guardado. Esto va primero porque está costando ventas.
  const rotas = estado.carta.filter((i) =>
    i.enCarta !== false && saleDelDeposito(i) && huerfanosDe(i).length);

  cont.innerHTML = `${rotas.length && !estado.esAparato ? `
    <div class="aviso mal" style="margin-bottom:.9rem"><span>⛔</span><div>
      <b>${rotas.length} producto${rotas.length === 1 ? ' tiene su receta rota' : 's tienen la receta rota'}:
      ${esc(rotas.map((i) => i.nombre || i.id).join(', '))}.</b>
      Apunta${rotas.length === 1 ? '' : 'n'} a un insumo que ya no está en el depósito
      —borrado, renombrado o duplicado—, así que sale${rotas.length === 1 ? '' : 'n'}
      agotado${rotas.length === 1 ? '' : 's'} aunque haya mercadería.
      Tocale${rotas.length === 1 ? '' : 's'} el 🧾 y deci${rotas.length === 1 ? '' : 'les'}
      de qué insumo sale${rotas.length === 1 ? '' : 'n'} ahora.</div></div>` : ''}`
    + `${sueltos.length && !estado.esAparato ? `
    <div class="aviso mal" style="margin-bottom:.9rem"><span>⚠</span><div>
      <b>${sueltos.length} de ${estado.carta.filter((i) => i.enCarta !== false).length}
      productos no salen del depósito.</b> Venderlos no descuenta ninguna botella.
      Tocales el 🧾+ y deciles de qué insumo salen y cuántas medidas llevan:
      ${esc(sueltos.map((i) => i.nombre || i.id).join(', '))}.</div></div>` : ''}`
    + estado.carta.map((i) => {
    const fuera = i.enCarta === false;   // retirado: el cliente no lo ve
    // Con receta, el número no se toca a mano: lo pone el depósito. Mostrar
    // los − + ahí sería mentir, porque la próxima venta lo vuelve a calcular.
    const delDeposito = saleDelDeposito(i);
    const rinde = delDeposito ? rindeDeposito(i) : null;
    // Un cero por receta rota no se arregla comprando: hay que tocar la
    // receta. Decir "sin material" manda a buscar lo que ya está guardado.
    const rota = rinde === 0 ? huerfanosDe(i) : [];
    // Con los números a la vista no hay nada que adivinar: o falta mercadería
    // de verdad, o el que tiene stock es otro insumo con el mismo nombre.
    const trabas = rinde === 0 ? porQueNoSale(i) : [];
    return `
    <div class="item ${fuera || i.disponible === false || i.apagadoAMano || rinde === 0 ? 'agotado' : ''}">
      <div class="cuerpo">
        <div class="nombre">${esc(i.nombre || i.id)}${fuera ? ' — <small>fuera de carta</small>' : ''}</div>
        <div class="desc">${esc(i.categoria || '')} · ${plata(i.precio)} · ${
          delDeposito
            ? (rota.length
                ? '<b style="color:var(--rojo)">la receta apunta a un insumo que no está</b>'
                : rinde === 0
                  ? `<b style="color:var(--rojo)">no sale</b> — ${esc(trabas.join(' · '))}`
                  : 'sale del depósito')
            : '<b style="color:var(--naranja)">no sale del depósito</b>'}${
          i.apagadoAMano ? ' · <b style="color:var(--rojo)">agotado a mano</b>' : ''}</div>
        <label class="precio-carta solo-gerente">
          <span>A cuánto se vende</span>
          <input data-precio-carta="${i.id}" type="number" min="0" inputmode="numeric"
                 value="${Number(i.precio || 0) || ''}" placeholder="sin precio"
                 aria-label="Precio de ${esc(i.nombre || i.id)}">
        </label>
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
              title="De qué insumo sale">${saleDelDeposito(i) ? '🧾' : '🧾+'}</button>
      <button class="btn solo-gerente-inline" data-carta="${i.id}" style="padding:.4rem .7rem;font-size:.82rem">
        ${fuera ? 'Poner en carta' : 'Sacar'}
      </button>
    </div>`;
  }).join('');

  // El precio se corrige donde se lo ve. Antes habia que ir a Administracion,
  // y el que esta armando la carta no siempre entra ahi.
  cont.querySelectorAll('[data-precio-carta]').forEach((e) => e.onchange = async () => {
    const i = estado.carta.find((x) => x.id === e.dataset.precioCarta);
    const nuevo = Math.max(0, Number(e.value) || 0);
    if (!i || nuevo === Number(i.precio || 0)) return;
    try { await updateDoc(doc(db, 'carta', i.id), { precio: nuevo }); }
    catch (err) {
      alert('No se pudo cambiar el precio: ' + (err.code || err.message));
      e.value = Number(i.precio || 0) || '';
    }
  });

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
    const sale = saleDelDeposito(i);
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
