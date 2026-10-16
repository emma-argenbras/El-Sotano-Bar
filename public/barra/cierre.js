// La jornada y su cierre.
//
// Una jornada es una ventana de tiempo, de un corte al siguiente, y no un
// evento. El motivo es concreto: si la barra cierra el evento a las 3 y sigue
// vendiendo hasta las 5, por cajaId esa noche quedaría partida en dos. Por
// reloj no se parte nunca.
//
// La jornada de hoy es virtual: el panel la calcula en vivo. El documento se
// escribe recién al cerrar, así no quedan jornadas vacías de los días que el
// bar no abrió.
//
// Y cerrar CONGELA. El bloque `cierre` guarda los números, no la forma de
// calcularlos: si mañana cambia un precio, entra una compra atrasada o se
// corrige una receta, el cierre de anoche no se mueve. Una jornada cerrada es
// historia, no una consulta que se vuelve a correr.
import {
  Timestamp, collection, doc, getDocs, onSnapshot, query, serverTimestamp,
  setDoc, updateDoc, where,
} from '/vendor/firebase.js';
import { $, esc, estado, plata } from './base.js';
import { db } from './conexion.js';
import { arranqueDeHoy, fechaDeHoy, horaCorte } from './jornada.js';
import { quienAtiende } from './pedidos.js';

export const JORNADA_DE = (fecha) => doc(db, 'jornadas', fecha);

export function escucharJornadas() {
  onSnapshot(collection(db, 'jornadas'), (snap) => {
    estado.jornadas = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    pintarCierre();
  }, () => {});
}

// ---------- lo que se cuenta ----------
//
// Todo lo que cayó en la ventana. Se filtra por reloj, no por cajaId: ver
// arriba por qué.
export function loDeLaJornada(desde, hasta) {
  const dentro = (ms) => ms >= desde.getTime() && (!hasta || ms < hasta.getTime());
  const cuando = (x, campo) => x[campo]?.toDate?.()?.getTime() ?? 0;

  const ventas = (estado.pedidosCaja || [])
    .filter((p) => p.estado === 'entregado' && dentro(cuando(p, 'creadoEn')));
  const gastos = (estado.egresos || []).filter((e) => dentro(cuando(e, 'fecha')));
  const entradas = (estado.invitadosTodos || [])
    .filter((i) => i.entradaPago && dentro(cuando(i, 'entradaEn')));

  return { ventas, gastos, entradas };
}

const sumar = (lista, campo, como) => lista
  .filter((x) => !como || x.pago === como || x.entradaPago === como)
  .reduce((a, x) => a + Number(x[campo] || 0), 0);

// Los cinco números de la noche, calculados en vivo. Al cerrar, esto es lo
// que queda congelado.
export function numerosDe(desde, hasta, contado) {
  const { ventas, gastos, entradas } = loDeLaJornada(desde, hasta);

  const vEfectivo = sumar(ventas, 'total', 'efectivo');
  const vVirtual = sumar(ventas, 'total', 'virtual');
  const vTotal = sumar(ventas, 'total');

  const eEfectivo = sumar(entradas, 'entradaMonto', 'efectivo');
  const eVirtual = sumar(entradas, 'entradaMonto', 'virtual');
  const cortesias = entradas.filter((i) => i.entradaPago === 'cortesia').length;

  const gEfectivo = sumar(gastos, 'monto', 'efectivo');
  const gTotal = sumar(gastos, 'monto');

  // Lo que tendría que haber en el cajón: el efectivo que entró, por la barra
  // y por la puerta, menos lo que salió en efectivo.
  const esperado = vEfectivo + eEfectivo - gEfectivo;

  // El costo viene congelado en cada pedido, del momento de la venta. Lo que
  // no tiene costo conocido no suma ni al costo ni a la cobertura: media
  // cuenta mostrada como entera es peor que ninguna.
  const costo = ventas.reduce((s, p) => s + Number(p.costoMercaderia || 0), 0);
  const conCosto = ventas.reduce((s, p) => s + Number(p.costoDe || 0), 0);
  const cobertura = vTotal > 0 ? Math.round((conCosto / vTotal) * 100) : 0;

  // Lo más vendido. Por producto y marca: el que mira esto quiere saber si se
  // vendió Quilmes o Brahma, no "cerveza".
  const porProducto = new Map();
  for (const p of ventas) {
    for (const i of (p.items || [])) {
      const clave = i.opcionNombre ? `${i.nombre} · ${i.opcionNombre}` : (i.nombre || i.id);
      const a = porProducto.get(clave) || { nombre: clave, cantidad: 0, importe: 0 };
      a.cantidad += Number(i.cantidad || 0);
      a.importe += Number(i.precio || 0) * Number(i.cantidad || 0);
      porProducto.set(clave, a);
    }
  }
  const ranking = [...porProducto.values()].sort((a, b) => b.cantidad - a.cantidad);

  return {
    ventas: { efectivo: vEfectivo, virtual: vVirtual,
              sinForma: vTotal - vEfectivo - vVirtual, total: vTotal,
              cantidad: ventas.length },
    entradas: { personas: entradas.length, cortesias,
                efectivo: eEfectivo, virtual: eVirtual, total: eEfectivo + eVirtual },
    gastos: { efectivo: gEfectivo, virtual: gTotal - gEfectivo, total: gTotal },
    caja: { esperado,
            contado: contado === null || contado === undefined ? null : Number(contado),
            diferencia: contado === null || contado === undefined
              ? null : Number(contado) - esperado },
    costo: { mercaderia: costo, cobertura },
    resultado: vTotal + eEfectivo + eVirtual - costo,
    top: ranking.slice(0, 3),
    otros: { productos: Math.max(0, ranking.length - 3),
             importe: ranking.slice(3).reduce((s, x) => s + x.importe, 0) },
  };
}

// La asistencia de la noche: solo tiene sentido con evento.
export function asistenciaDe(eventoId) {
  if (!eventoId) return null;
  const invs = (estado.invitadosTodos || []).filter((i) => i.eventoId === eventoId);
  if (!invs.length) return null;
  return {
    inscriptos: invs.length,
    entraron: invs.filter((i) => i.ingresadoEn).length,
    cupo: Number(estado.registros?.[eventoId]?.capacidad || 0),
  };
}

// ---------- el tablero ----------
//
// Cinco números y nada más. Se mira parado, con poca luz y el celular en la
// mano: tipografía grande, cifras tabulares para que no bailen al
// actualizarse, y el signo escrito además del color — nadie debería tener que
// mirar un color para saber si falta plata.
export let verJornada = null;    // null = la de hoy
export let comparando = false;

export function irAJornada(fecha) { verJornada = fecha; pintarCierre(); }
export function alternarComparar() { comparando = !comparando; pintarCierre(); }

const signo = (n) => (n > 0 ? '+' : '') + plata(n);

// Una barra partida en tramos, cada uno con su color y su nombre. La leyenda
// va siempre: el color solo no alcanza para decir qué es cada cosa.
function barraPartida(tramos) {
  const total = tramos.reduce((s, t) => s + Math.max(0, t.valor), 0);
  if (total <= 0) return '';
  const vivos = tramos.filter((t) => t.valor > 0);
  return `
    <div class="barra">${vivos.map((t) =>
      `<span style="flex:${t.valor};background:${t.color}"></span>`).join('')}</div>
    <div class="leyenda">${vivos.map((t) =>
      `<span><i style="background:${t.color}"></i>${esc(t.nombre)} ${plata(t.valor)}</span>`).join('')}</div>`;
}

function tarjetaVendido(n) {
  return `
  <div class="tarjeta">
    <div class="rotulo">Total vendido</div>
    <div class="numeron">${plata(n.ventas.total + n.entradas.total)}</div>
    ${barraPartida([
      { nombre: 'Efectivo', valor: n.ventas.efectivo, color: 'var(--graf-oro)' },
      { nombre: 'Virtual', valor: n.ventas.virtual, color: 'var(--graf-azul)' },
      { nombre: 'Entradas', valor: n.entradas.total, color: 'var(--graf-verde)' },
      { nombre: 'Sin forma', valor: n.ventas.sinForma, color: 'var(--apagado)' },
    ])}
    <p class="pie-chico">${n.ventas.cantidad} venta${n.ventas.cantidad === 1 ? '' : 's'}${
      n.entradas.personas ? ` · ${n.entradas.personas} entrada${n.entradas.personas === 1 ? '' : 's'}` : ''}${
      n.entradas.cortesias ? ` · ${n.entradas.cortesias} de cortesía` : ''}</p>
  </div>`;
}

// Sin tolerancia, por decisión de la casa: cualquier diferencia se muestra
// con el monto exacto. Sobrar tampoco es una buena noticia — es que algo no
// se anotó— así que no se festeja.
function tarjetaCaja(n) {
  const d = n.caja.diferencia;
  const sinContar = d === null;
  const clase = sinContar ? 'parcial' : (d === 0 ? 'neutro' : (d < 0 ? 'malo' : ''));
  const palabra = sinContar ? 'Sin contar'
    : (d === 0 ? 'Cuadra' : (d < 0 ? `Faltan ${plata(Math.abs(d))}` : `Sobran ${plata(d)}`));
  const tope = Math.max(n.caja.esperado, Number(n.caja.contado || 0), 1);
  const via = (v, color) => `<div class="via"><span style="width:${
    Math.min(100, Math.round((v / tope) * 100))}%;background:${color}"></span></div>`;

  return `
  <div class="tarjeta">
    <div class="rotulo">Diferencia de caja</div>
    <div class="numeron ${clase}">${palabra}</div>
    <div class="fila-barra" style="margin-top:.8rem">
      <span class="que">Esperado</span><span class="cuanto">${plata(n.caja.esperado)}</span>
      ${via(n.caja.esperado, 'var(--apagado)')}
    </div>
    <div class="fila-barra">
      <span class="que">Contado</span>
      <span class="cuanto">${sinContar ? '—' : plata(n.caja.contado)}</span>
      ${sinContar ? '' : via(n.caja.contado, d < 0 ? 'var(--graf-rojo)' : 'var(--graf-oro)')}
    </div>
    <p class="pie-chico">Efectivo que entró, por la barra y por la puerta, menos
      los gastos pagados en efectivo.</p>
  </div>`;
}

// La cobertura va siempre a la vista: una ganancia calculada sobre media
// carta, mostrada como si fuera entera, es la peor clase de número.
function tarjetaGanancia(n) {
  const parcial = n.costo.cobertura < 80;
  const vendido = n.ventas.total + n.entradas.total;
  return `
  <div class="tarjeta">
    <div class="rotulo">Ganancia${parcial ? ' · parcial' : ''}</div>
    <div class="numeron ${parcial ? 'parcial' : 'bueno'}">${plata(n.resultado)}</div>
    ${n.costo.mercaderia > 0 ? barraPartida([
      { nombre: 'Costo', valor: n.costo.mercaderia, color: 'var(--apagado)' },
      { nombre: 'Queda', valor: Math.max(0, vendido - n.costo.mercaderia), color: 'var(--graf-verde)' },
    ]) : ''}
    <p class="pie-chico">${n.costo.cobertura >= 100
      ? 'Calculado sobre todo lo vendido.'
      : `Calculado sobre el ${n.costo.cobertura}% de lo vendido: al resto le falta
         el costo cargado en el depósito.`}</p>
  </div>`;
}

function tarjetaAsistencia(a) {
  if (!a) return '';
  const pct = a.inscriptos ? Math.round((a.entraron / a.inscriptos) * 100) : 0;
  return `
  <div class="tarjeta">
    <div class="rotulo">Asistencia</div>
    <div class="numeron neutro">${a.entraron}<span style="font-size:1.4rem;color:var(--suave)"> de ${a.inscriptos}</span></div>
    <div class="fila-barra" style="margin-top:.6rem">
      <span class="que">Entraron</span><span class="cuanto">${pct}%</span>
      <div class="via"><span style="width:${Math.min(100, pct)}%;background:var(--graf-oro)"></span></div>
    </div>
    <p class="pie-chico">${a.cupo ? `Cupo ${a.cupo}. ` : ''}${
      a.entraron > a.inscriptos ? 'Entró gente que no estaba en la lista.' : ''}</p>
  </div>`;
}

function tarjetaTop(n) {
  if (!n.top.length) return '';
  const tope = n.top[0].cantidad || 1;
  return `
  <div class="tarjeta">
    <div class="rotulo">Lo más vendido</div>
    ${n.top.map((t) => `
      <div class="fila-barra" style="margin-top:.7rem">
        <span class="que">${esc(t.nombre)}</span>
        <span class="cuanto">${t.cantidad} · ${plata(t.importe)}</span>
        <div class="via"><span style="width:${Math.round((t.cantidad / tope) * 100)}%;
             background:var(--graf-oro)"></span></div>
      </div>`).join('')}
    ${n.otros.productos ? `<p class="pie-chico">otros ${n.otros.productos}
      producto${n.otros.productos === 1 ? '' : 's'} · ${plata(n.otros.importe)}</p>` : ''}
  </div>`;
}

// ---------- comparar jornadas ----------
//
// Una medida por vez y un solo eje. Dos escalas distintas en el mismo
// gráfico es la forma más rápida de que dos números que no se parecen
// parezcan comparables.
export let medida = 'vendido';
export function verMedida(cual) { medida = cual; pintarCierre(); }

const MEDIDAS = {
  vendido: { titulo: 'Vendido', de: (c) => (c?.ventas?.total || 0) + (c?.entradas?.total || 0),
             como: plata, color: 'var(--graf-oro)' },
  ganancia: { titulo: 'Ganancia', de: (c) => c?.resultado || 0,
              como: plata, color: 'var(--graf-verde)' },
  caja: { titulo: 'Diferencia de caja', de: (c) => c?.caja?.diferencia || 0,
          como: signo, color: 'var(--graf-rojo)' },
  asistencia: { titulo: 'Asistencia', de: (c) => c?.asistencia?.entraron || 0,
                como: (n) => String(n), color: 'var(--graf-azul)' },
};

function pintarComparar() {
  const cerradas = (estado.jornadas || []).filter((j) => j.cierre).slice(0, 30);
  if (!cerradas.length) {
    return `<div class="aviso"><span>📊</span><div>
      <b>Todavía no hay ninguna jornada cerrada.</b><br>
      Cerrá una noche y acá vas a poder compararla con las que sigan.</div></div>`;
  }

  const m = MEDIDAS[medida];
  const filas = [...cerradas].reverse()
    .map((j) => ({ fecha: j.fecha, nombre: j.nombre, evento: !!j.eventoId,
                   valor: m.de(j.cierre) }));
  const tope = Math.max(...filas.map((f) => Math.abs(f.valor)), 1);

  const total = filas.reduce((s, f) => s + (f.valor || 0), 0);

  return `
    <div class="tabs chicas" style="margin-bottom:.8rem">
      ${Object.entries(MEDIDAS).map(([k, v]) =>
        `<button data-medida="${k}" aria-selected="${medida === k}">${v.titulo}</button>`).join('')}
    </div>

    <div class="tarjeta">
      <div class="rotulo">${esc(m.titulo)} · ${filas.length} jornada${filas.length === 1 ? '' : 's'}</div>
      <div class="numeron">${m.como(medida === 'asistencia' ? total : total)}</div>
      <p class="pie-chico">Promedio por jornada:
        ${m.como(Math.round(total / filas.length))}</p>
    </div>

    <div class="tarjeta">
      ${filas.map((f) => `
        <div class="fila-barra">
          <span class="que">${esc(f.fecha)}${f.evento ? ' <span style="color:var(--oro)">●</span>' : ''}</span>
          <span class="cuanto">${m.como(f.valor)}</span>
          <div class="via"><span style="width:${
            Math.round((Math.abs(f.valor) / tope) * 100)}%;background:${m.color}"></span></div>
        </div>`).join('')}
      <p class="pie-chico"><span style="color:var(--oro)">●</span> noches con evento</p>
    </div>

    <div class="tarjeta">
      <div class="rotulo">Todo junto</div>
      <table class="comparar"><thead><tr>
        <th>Jornada</th><th>Vendido</th><th>Ganancia</th><th>Caja</th><th>Entraron</th>
      </tr></thead><tbody>
        ${[...cerradas].map((j) => {
          const c = j.cierre;
          const d = c.caja?.diferencia;
          return `<tr>
            <td>${esc(j.fecha)}</td>
            <td>${plata((c.ventas?.total || 0) + (c.entradas?.total || 0))}</td>
            <td>${plata(c.resultado || 0)}</td>
            <td style="color:${d < 0 ? 'var(--graf-rojo)' : 'var(--suave)'}">${
              d === null || d === undefined ? '—' : signo(d)}</td>
            <td>${c.asistencia ? `${c.asistencia.entraron}/${c.asistencia.inscriptos}` : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody></table>
    </div>`;
}

// ---------- la pantalla entera ----------
export function pintarCierre() {
  const cont = $('#cierre');
  if (!cont || $('#vistaCaja')?.hidden) return;

  if (comparando) {
    cont.innerHTML = `
      <div class="tabs chicas">
        <button data-vista="una" aria-selected="false">Una jornada</button>
        <button data-vista="comparar" aria-selected="true">Comparar</button>
      </div>
      ${pintarComparar()}`;
    engancharCierre(cont);
    return;
  }

  const hoy = fechaDeHoy();
  const fecha = verJornada || hoy;
  const guardada = (estado.jornadas || []).find((j) => j.fecha === fecha);
  const esHoy = fecha === hoy;

  // Una jornada cerrada muestra lo que quedó congelado. La de hoy se calcula
  // en vivo: todavía no es historia.
  const n = guardada?.cierre || (esHoy
    ? numerosDe(arranqueDeHoy(), null, null)
    : null);
  const asistencia = guardada?.cierre?.asistencia
    || (esHoy ? asistenciaDe(estado.evento?.id) : null);

  const otras = (estado.jornadas || []).map((j) => j.fecha);
  const fechas = [...new Set([hoy, ...otras])].sort().reverse();

  cont.innerHTML = `
    <div class="tabs chicas">
      <button data-vista="una" aria-selected="true">Una jornada</button>
      <button data-vista="comparar" aria-selected="false">Comparar</button>
    </div>

    <label class="campo">
      <span>Qué noche</span>
      <select id="selJornada">
        ${fechas.map((f) => `<option value="${esc(f)}" ${f === fecha ? 'selected' : ''}>
          ${esc(f)}${f === hoy ? ' · hoy' : ''}${
          (estado.jornadas || []).some((j) => j.fecha === f && j.cierre) ? ' · cerrada' : ''}
        </option>`).join('')}
      </select>
    </label>

    ${!n ? `<div class="aviso"><span>📅</span><div>
      <b>Esa noche no se cerró.</b> No hay números congelados para mostrar.</div></div>`
    : `
      ${guardada?.cierre ? `<div class="aviso ok"><span>🔒</span><div>
        <b>Cerrada por ${esc(guardada.cerradaPor || 'la casa')}.</b>
        Estos números quedaron congelados: no se mueven aunque cambien los
        precios o entre una compra.${guardada.vecesReabierta
          ? ` Se reabrió ${guardada.vecesReabierta} ${guardada.vecesReabierta === 1 ? 'vez' : 'veces'}.`
          : ''}</div></div>` : `<div class="aviso"><span>⏳</span><div>
        <b>Jornada en curso</b>, desde las ${horaCorte()}:00. Estos números se
        mueven con cada venta.</div></div>`}

      ${tarjetaVendido(n)}
      ${tarjetaCaja(n)}
      ${tarjetaGanancia(n)}
      ${tarjetaAsistencia(asistencia)}
      ${tarjetaTop(n)}

      ${esHoy && !guardada?.cierre ? `
        <button class="btn primario ancho-full solo-gerente-inline" id="btnCerrarJornada">
          Cerrar la jornada</button>
        <p class="pie-chico">Primero vas a contar el cajón. Después se congela.</p>` : ''}
      ${guardada?.cierre && estado.dueno ? `
        <button class="btn ancho-full" id="btnReabrirJornada" style="margin-top:.6rem">
          Reabrir esta jornada</button>` : ''}`}`;

  engancharCierre(cont);
}

function engancharCierre(cont) {
  cont.querySelectorAll('[data-vista]').forEach((b) => b.onclick = () => {
    comparando = b.dataset.vista === 'comparar';
    pintarCierre();
  });
  cont.querySelectorAll('[data-medida]').forEach((b) => b.onclick = () => verMedida(b.dataset.medida));
  if ($('#selJornada')) $('#selJornada').onchange = () => irAJornada($('#selJornada').value);
  if ($('#btnCerrarJornada')) $('#btnCerrarJornada').onclick = abrirCierre;
  if ($('#btnReabrirJornada')) $('#btnReabrirJornada').onclick = reabrirJornada;
}

// ---------- cerrar ----------
//
// Contar el cajón ANTES de ver lo esperado. Si se ve primero, se copia: el
// número deja de ser un conteo y pasa a ser una confirmación.
export function abrirCierre() {
  $('#cuerpoCerrarJornada').innerHTML = `
    <p style="color:var(--suave);font-size:.9rem;margin:.2rem 0 1rem">
      Contá la plata que hay en el cajón y escribila. Recién después vas a ver
      lo que la app esperaba.</p>
    <label class="campo">
      <span>Cuánta plata hay en el cajón</span>
      <input id="inpContado" type="number" min="0" inputmode="numeric" placeholder="0">
    </label>
    <div id="errorCierre" class="aviso mal oculto"><span>⚠</span><div id="errorCierreTexto"></div></div>
    <button class="btn primario ancho-full" id="btnVerCierre" style="margin-top:.6rem">
      Ver el cierre</button>`;
  $('#btnVerCierre').onclick = revisarCierre;
  $('#dlgCerrarJornada').showModal();
  $('#inpContado').focus();
}

export function revisarCierre() {
  const contado = $('#inpContado').value;
  if (contado === '' || Number(contado) < 0) {
    $('#errorCierreTexto').textContent = 'Escribí cuánta plata hay, aunque sea cero.';
    $('#errorCierre').classList.remove('oculto');
    $('#inpContado').focus();
    return;
  }
  const n = numerosDe(arranqueDeHoy(), null, Math.round(Number(contado)));
  const d = n.caja.diferencia;

  $('#cuerpoCerrarJornada').innerHTML = `
    <div class="cierre">
      ${tarjetaCaja(n)}
      ${tarjetaVendido(n)}
      ${tarjetaGanancia(n)}
    </div>
    <div class="aviso ${d === 0 ? 'ok' : 'mal'}"><span>${d === 0 ? '✓' : '⚠'}</span><div>
      ${d === 0 ? '<b>La caja cuadra.</b>'
        : `<b>${d < 0 ? 'Faltan' : 'Sobran'} ${plata(Math.abs(d))}.</b>
           ${d > 0 ? 'Sobrar también es que algo no se anotó.' : ''}`}<br>
      Al confirmar, estos números quedan congelados.</div></div>
    <div style="display:flex;gap:.6rem;margin-top:.9rem">
      <button class="btn" id="btnVolverCierre" style="flex:1">Volver</button>
      <button class="btn primario" id="btnConfirmarCierre" style="flex:1.4">
        Cerrar la jornada</button>
    </div>`;
  $('#btnVolverCierre').onclick = abrirCierre;
  $('#btnConfirmarCierre').onclick = () => cerrarJornada(Math.round(Number(contado)));
}

export async function cerrarJornada(contado) {
  const btn = $('#btnConfirmarCierre');
  btn.disabled = true; btn.textContent = 'Cerrando…';
  const fecha = fechaDeHoy();
  const desde = arranqueDeHoy();
  const n = numerosDe(desde, null, contado);
  const asistencia = asistenciaDe(estado.evento?.id);
  const ya = (estado.jornadas || []).find((j) => j.fecha === fecha);

  try {
    await setDoc(JORNADA_DE(fecha), {
      fecha,
      desde: Timestamp.fromDate(desde),
      hasta: serverTimestamp(),
      horaCorte: horaCorte(),
      nombre: estado.evento?.nombre || 'Día común',
      ...(estado.evento?.id ? { eventoId: estado.evento.id } : {}),
      cerradaEn: serverTimestamp(),
      cerradaPor: quienAtiende() || estado.usuario || 'la casa',
      vecesReabierta: Number(ya?.vecesReabierta || 0),
      cierre: { ...n, asistencia },
    });
    $('#dlgCerrarJornada').close();
    verJornada = fecha;
    pintarCierre();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Cerrar la jornada';
    alert('No se pudo cerrar: ' + (e.code || e.message));
  }
}

// Reabrir deja marca. Una jornada que se reabrió tres veces lo dice en la
// pantalla: el rastro es el punto.
export async function reabrirJornada() {
  const fecha = verJornada || fechaDeHoy();
  if (!confirm(`¿Reabrir la jornada del ${fecha}?\n\n`
    + 'Sus números dejan de estar congelados y queda anotado que se reabrió.')) return;
  try {
    await updateDoc(JORNADA_DE(fecha), {
      cierre: null,
      reabiertaEn: serverTimestamp(),
      reabiertaPor: quienAtiende() || estado.usuario || 'la casa',
      vecesReabierta: Number((estado.jornadas || [])
        .find((j) => j.fecha === fecha)?.vecesReabierta || 0) + 1,
    });
  } catch (e) { alert('No se pudo: ' + (e.code || e.message)); }
}
