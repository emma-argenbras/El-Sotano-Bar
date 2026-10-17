import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '/vendor/firebase.js';
import { pintarAdmin } from './administracion.js';
import { $, esc, estado, plata } from './base.js';
import { pintarCartaBar, pintarConteo } from './carta.js';
import { db, fallo } from './conexion.js';
import { quienAtiende } from './pedidos.js';
import { insumosHuerfanos, opcionesDe, productosQueUsan, rindeCon, rindeOpcion, trabasDe } from './stock.js';

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
// El stock de hoy, tal como lo tiene el panel en memoria.
const loQueHay = () =>
  new Map(estado.insumos.map((i) => [i.id, Number(i.stock || 0)]));

export function rindeDeposito(item) {
  return rindeCon(item, loQueHay());
}

// Si la receta quedó apuntando a algo que no está, el cero no es falta de
// mercadería. Se devuelve el nombre del insumo cuando se lo puede recuperar,
// y si no el identificador: algo que buscar es mejor que nada.
export function huerfanosDe(item) {
  // Sin depósito cargado, TODO parece huérfano: el mapa está vacío y ninguna
  // receta encuentra su insumo. Acusar ahí es acusar sin haber mirado, y la
  // carta marcaba siete productos como rotos y agotados mientras el depósito
  // todavía venía en camino. Es la tercera vez que cometo este error hoy.
  if (!estado.insumos.length) return [];
  return insumosHuerfanos(item, loQueHay());
}

// Por qué este producto no sale, con nombres y números en vez de una frase.
export function porQueNoSale(item) {
  if (!estado.insumos.length) return [];
  const nombres = new Map(estado.insumos.map((i) => [i.id, i.nombre || i.id]));
  return trabasDe(item, loQueHay()).map((t) => t.falta
    ? `«${t.insumoId}» no está en el depósito`
    : `${nombres.get(t.insumoId)}: hay ${t.hay}, lleva ${t.lleva}`);
}

// El cliente no puede leer el depósito —ni debe: ahí están los costos y lo que
// hay guardado—, así que el número viajado al que sí lee: el stock del
// producto. Lo escribe el panel cada vez que el depósito se mueve.
//
// Converge sola aunque haya varios celulares abiertos: el valor es una cuenta
// del depósito, no un incremento, así que el segundo que llega ve que ya está
// bien y no escribe. Sin bucle posible.
// Quien mueve el stock deja la carta al día en el mismo lote (ver stock.js).
// Esto es el corrector: corre cuando llega un cambio del depósito y arregla
// lo que haya quedado torcido —una receta nueva, un movimiento hecho desde
// otro lado, dos ventas en el mismo segundo—. No es un latido: reacciona a
// un cambio real, no al reloj.
export async function sincronizarCartaConDeposito() {
  if (!estado.carta.length || !estado.insumos.length) return;
  const hay = loQueHay();
  const cambios = estado.carta
    // Un producto con marcas puede no tener receta propia: lo único que lleva
    // está en la marca. Dejarlo afuera era no corregirlo nunca.
    .filter((i) => (i.receta || []).length || opcionesDe(i).length)
    .map((i) => {
      const rinde = rindeCon(i, hay);
      // Apagado a mano gana: el depósito no lo vuelve a encender.
      const disponible = i.apagadoAMano === true ? false : rinde > 0;
      const marcas = opcionesDe(i);
      const porMarca = marcas.length
        ? Object.fromEntries(marcas.map((o) => [o.id, rindeOpcion(i, o.id, hay)]))
        : null;
      const marcasIguales = !porMarca
        || marcas.every((o) => Number(i.opcionesStock?.[o.id]) === porMarca[o.id]);
      return { id: i.id, rinde, disponible, porMarca,
               igual: rinde === i.stock && disponible === i.disponible && marcasIguales };
    })
    .filter((x) => !x.igual);
  // Quien no puede escribir la carta —la puerta, un barman fuera de turno—
  // simplemente no sincroniza: no es su trabajo y las reglas lo frenan igual.
  await Promise.all(cambios.map((x) =>
    updateDoc(doc(db, 'carta', x.id), {
      stock: x.rinde, disponible: x.disponible,
      ...(x.porMarca ? { opcionesStock: x.porMarca } : {}),
    }).catch(() => {})));
}

export function escucharDeposito() {
  // El insumo lo lee toda la barra: es lo que hay guardado. Lo demás —compras,
  // gastos, proveedores— es plata, y el celular de la barra no lo puede leer.
  // Pedirlo igual sería un permission-denied cada vez que arranca.
  onSnapshot(collection(db, 'insumos'), (snap) => {
    estado.insumos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    // La carta también: su renglón dice si el producto sale del depósito y
    // cuántas quedan, así que pintada antes de que llegue esto se queda con
    // una foto en la que no hay nada y nadie la vuelve a dibujar.
    pintarDeposito(); pintarAdmin(); pintarConteo(); pintarCartaBar();
    sincronizarCartaConDeposito();
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

  // Dos insumos con el mismo nombre es la trampa más cara del depósito: la
  // receta apunta a uno, la mercadería entra en el otro, y el producto sale
  // agotado con el depósito lleno. A ojo no se distinguen —se llaman igual—,
  // así que lo tiene que decir la pantalla.
  const porNombre = new Map();
  for (const i of estado.insumos) {
    const clave = String(i.nombre || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clave) continue;
    porNombre.set(clave, [...(porNombre.get(clave) || []), i]);
  }
  const repetidos = [...porNombre.values()].filter((g) => g.length > 1);

  // Cargar mercadería en el depósito NO la pone en la carta: hace falta que
  // algún producto diga que sale de ahí. Nadie avisaba eso, y se cargaban
  // cajones enteros esperando verlos aparecer del otro lado.
  // Con la carta todavía en camino NINGÚN insumo encuentra su producto, y
  // los setenta y cuatro dirían "no sale en la carta". Es el mismo error que
  // cometí hoy en el Club, en el candado de la baja y en las recetas rotas:
  // una pantalla que dicta sentencia antes de que lleguen los datos.
  const hayCarta = (estado.carta || []).length > 0;
  const huerfano = (i) => hayCarta && !productosQueUsan([i.id]).length;
  const sueltos = hayCarta ? estado.insumos.filter(huerfano) : [];

  // El celular de la barra mira y nada más: no da de alta mercadería y no
  // ve la plata. Mostrarle esos botones sería ofrecerle algo que las reglas
  // le van a negar.
  const soloMira = estado.esAparato;

  cont.innerHTML = `
    ${repetidos.length ? `
    <div class="aviso mal" style="margin-bottom:.9rem"><span>⛔</span><div>
      <b>Hay nombres repetidos en el depósito.</b> La receta apunta a uno solo,
      así que la mercadería que entra en el otro no la ve nadie y el producto
      sale agotado con el depósito lleno.
      ${repetidos.map((g) => `<br>• <b>${esc(g[0].nombre)}</b> está ${g.length} veces:
        ${g.map((i) => comoSeDice(i)).join(' / ')}`).join('')}
      <br><small>Dejá uno solo: pasale el stock al que usa la receta y dale de
      baja al otro.</small></div></div>` : ''}

    ${sueltos.length && !soloMira ? `
    <div class="aviso" style="margin-bottom:.9rem"><span>📋</span><div>
      <b>${sueltos.length} ${sueltos.length === 1 ? 'insumo no sale' : 'insumos no salen'}
      en la carta.</b> Cargar algo acá no lo pone a la venta: hace falta que un
      producto diga que sale de ahí. Andá a <b>Carta</b> y tocale el 🧾 al
      producto que corresponda.
      <br><small>${esc(sueltos.map((i) => i.nombre || i.id).join(', '))}</small>
    </div></div>` : ''}

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
            Number(i.medidas || 1) > 1 ? ` · ${i.medidas} medidas por ${esc(i.unidad || 'unidad')}` : ''}${
            !hayCarta ? ''
              : huerfano(i) ? ' · <b style="color:var(--naranja)">no sale en la carta</b>'
              : ` · <span style="color:var(--suave)">sale en ${
                  esc(productosQueUsan([i.id]).map((c) => c.nombre || c.id).join(', '))}</span>`}</div>
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

// Quién se queda sin de dónde salir si este insumo desaparece.
//
// Mira las recetas Y las marcas: un producto cuya única fuente es la marca no
// tiene receta propia, y mirando solo recetas el candado lo dejaba pasar.
// Borrado el insumo, el producto queda en cero para siempre y la linea muerta
// ni siquiera se ve en el editor.
export function quienUsa(insumoId) {
  return productosQueUsan([insumoId]).map((c) => c.nombre || c.id);
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
  // La carta se lee de memoria. Si todavía no llegó, "no lo usa nadie" no es
  // una respuesta: es no haber mirado. Y borrar con eso deja al producto
  // apuntando a un insumo que ya no existe.
  if (!estado.carta.length) {
    fallar('Todavía no cargó la carta. Esperá unos segundos y probá de nuevo: '
      + 'sin ella no se puede saber qué productos salen de este insumo.');
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
// El producto que sale de este insumo tal cual, si existe. Lleva el id del
// insumo: uno por insumo, y así editarlo lo encuentra sin buscar por nombre.
const productoTalCual = (ins) =>
  ins ? (estado.carta || []).find((c) => c.id === ins.id) : null;

// Qué parte de la carta propone el nombre. Es una PROPUESTA que se escribe
// en el campo y se puede cambiar: nunca se guarda sola. Adivinar en silencio
// es peor que el cajón de sastre; proponer y que confirmen, no.
const PARTES = [
  [/cerveza|lata|porr[oó]n|ipa|lager|heineken|quilmes|brahma|corona|stella|grunbauch|grünbauch/i, 'Cervezas'],
  [/vino|malbec|cabernet|tinto|blanco|rosado|trumpeter|catena|moulin/i, 'Vinos'],
  [/champ|espumante|chandon|baron/i, 'Espumantes'],
  [/gin|vodka|whisk|ron |ron$|tequila|aperol|campari|fernet|licor|aperitivo/i, 'Destilados'],
  [/gaseosa|coca|sprite|fanta|agua|jugo|tonica|tónica|red bull|energizante/i, 'Sin alcohol'],
  [/papa|picada|tabla|mani|maní|snack|empanada/i, 'Para picar'],
];
const parteQueSugiere = (nombre) =>
  (PARTES.find(([re]) => re.test(nombre || '')) || [])[1] || '';

export function abrirInsumo(ins) {
  editandoInsumo = ins;
  $('#tituloInsumo').textContent = ins ? 'Editar insumo' : 'Nuevo insumo';
  $('#inpInsNombre').value = ins?.nombre || '';
  $('#inpInsUnidad').value = ins?.unidad || '';
  $('#inpInsMedidas').value = ins?.medidas ?? 1;
  $('#inpInsCosto').value = ins?.costo ?? '';
  $('#inpInsMinimo').value = ins?.minimo ?? '';

  const yaEsta = productoTalCual(ins);
  const vende = !!yaEsta && yaEsta.enCarta !== false;
  $('#inpInsVende').checked = vende;
  $('#inpInsPrecio').value = yaEsta?.precio ?? '';
  $('#inpInsCategoria').value = yaEsta?.categoria || parteQueSugiere(ins?.nombre);
  // Mientras no tenga una propia, el nombre va proponiendo. En cuanto la
  // tocan a mano, deja de proponer: lo que escribieron manda.
  $('#inpInsNombre').oninput = () => {
    if ($('#inpInsCategoria').dataset.tocada === '1') return;
    $('#inpInsCategoria').value = parteQueSugiere($('#inpInsNombre').value);
  };
  $('#inpInsCategoria').dataset.tocada = '';
  $('#inpInsCategoria').oninput = () => { $('#inpInsCategoria').dataset.tocada = '1'; };

  // Qué se vende: la unidad entera o una medida. Son dos cosas distintas y
  // la app no puede adivinar. Un vino que se lleva la mesa descuenta la
  // botella; un gin en copa, una medida. Antes descontaba siempre una, asi
  // que dieciseis botellas de dieciseis medidas se ofrecian como 256.
  const medidasPorUnidad = Math.max(1, Number(ins?.medidas || 1));
  const llevaAhora = Number(yaEsta?.receta?.[0]?.medidas || 1);
  $('#inpInsQueVende').value = llevaAhora > 1 ? 'unidad' : 'medida';
  pintarQueSeVende(ins);
  $('#inpInsMedidas').oninput = () => pintarQueSeVende({
    ...ins, medidas: Number($('#inpInsMedidas').value) || 1,
  });
  $('#inpInsQueVende').onchange = () => pintarQueSeVende({
    ...ins, medidas: Number($('#inpInsMedidas').value) || 1,
  });

  // Y si el insumo ya sale en otros productos, se dice. No se frena: el
  // mismo gin puede ser "Gin tonic" y "Gin solo" a precios distintos, y eso
  // es deseado. Lo que no puede pasar es que ocurra sin que nadie lo vea.
  const otros = ins
    ? productosQueUsan([ins.id]).filter((c) => c.id !== ins.id && c.enCarta !== false)
    : [];
  $('#avisaYaSale').classList.toggle('oculto', !otros.length);
  if (otros.length) {
    $('#avisaYaSaleTexto').innerHTML = `Este insumo ya sale en
      <b>${esc(otros.map((c) => c.nombre || c.id).join(', '))}</b>.
      Esto agrega <b>otro</b> producto que descuenta de la misma mercadería.`;
  }
  $('#listaCategorias').innerHTML = [...new Set((estado.carta || [])
    .map((c) => c.categoria).filter(Boolean))]
    .map((c) => `<option value="${esc(c)}">`).join('');
  $('#camposVende').classList.toggle('oculto', !vende);
  $('#inpInsVende').onchange = () =>
    $('#camposVende').classList.toggle('oculto', !$('#inpInsVende').checked);

  $('#dlgInsumo').showModal();
  $('#inpInsNombre').focus();
}

// Cuántas medidas se lleva una venta, y cómo se lo explica. Con una sola
// medida por unidad no hay dos casos: la lata ES la medida, y preguntar
// sería inventar una decisión que no existe.
function pintarQueSeVende(ins) {
  const m = Math.max(1, Number(ins?.medidas || 1));
  const unidad = ins?.unidad || 'unidad';
  const campo = $('#campoQueSeVende');
  if (!campo) return;
  campo.classList.toggle('oculto', m === 1);
  if (m === 1) { $('#pistaQueVende').textContent = ''; return; }
  const entera = $('#inpInsQueVende').value === 'unidad';
  $('#pistaQueVende').textContent = entera
    ? `Cada venta descuenta ${m} medidas, o sea una ${unidad} entera.`
    : `Cada venta descuenta 1 de las ${m} medidas que da cada ${unidad}.`;
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
  const vende = $('#inpInsVende').checked;
  const precio = Math.max(0, Number($('#inpInsPrecio').value) || 0);
  if (vende && !precio) {
    alert('Para que salga en la carta hace falta a cuánto se vende.');
    $('#inpInsPrecio').focus();
    return;
  }
  // La categoría se elige. Caer en "Otros" sin decir nada dejó quince
  // productos ahí dentro: cervezas, vinos y gins juntos en un cajón de
  // sastre, y el cliente abriendo el QR para encontrarlos.
  const categoria = $('#inpInsCategoria').value.trim();
  if (vende && !categoria) {
    alert('Elegí en qué parte de la carta va: Cervezas, Vinos, Tragos…');
    $('#inpInsCategoria').focus();
    return;
  }
  // Y el nombre repetido se frena acá también. Fernet quedó dos veces con el
  // mismo nombre, en dos partes distintas de la carta: el cliente ve dos
  // renglones iguales y la barra no sabe cuál tocar.
  const repetido = vende && (estado.carta || []).find((c) =>
    c.id !== editandoInsumo?.id && c.enCarta !== false
    && (c.nombre || '').trim().toLowerCase() === nombre.toLowerCase());
  if (repetido) {
    alert(`Ya hay un producto que se llama "${nombre}" en la carta.\n\n`
      + 'Dos renglones con el mismo nombre no se distinguen: ponele otro '
      + 'nombre a este, o sacá el que ya está.');
    return;
  }

  try {
    let id = editandoInsumo?.id;
    if (editandoInsumo) await updateDoc(doc(db, 'insumos', id), datos);
    else id = (await addDoc(collection(db, 'insumos'), datos)).id;

    // Y el producto que sale de él tal cual. Va con el MISMO id que el
    // insumo: uno por insumo, sin inventar claves y sin buscar por nombre.
    // Una venta descuenta una medida — la lata si la lata es una medida, un
    // trago si la botella da veinte.
    const yaEsta = productoTalCual(editandoInsumo);
    if (vende) {
      // Una medida, o todas las que da la unidad. Con una sola medida por
      // unidad las dos ramas dan lo mismo y el selector ni se muestra.
      const lleva = $('#inpInsQueVende').value === 'unidad' ? medidas : 1;
      await setDoc(doc(db, 'carta', id), {
        nombre: datos.nombre,
        categoria,
        precio,
        receta: [{ insumoId: id, medidas: lleva }],
        enCarta: true,
        ...(yaEsta ? {} : { orden: 50, disponible: true }),
      }, { merge: true });
    } else if (yaEsta && yaEsta.enCarta !== false) {
      // Destildarlo lo saca de la carta, no lo borra: el histórico de lo que
      // se vendió tiene que seguir encontrando el producto.
      await updateDoc(doc(db, 'carta', id), { enCarta: false });
    }
    $('#dlgInsumo').close();
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}
