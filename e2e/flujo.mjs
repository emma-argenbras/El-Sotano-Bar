// Prueba de punto a punto contra los emuladores con un Chromium real.
// Recorre lo mismo que haría un cliente en la mesa y la barra atendiéndolo.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://127.0.0.1:5000';
const MAIL_BARRA = 'emmanuelclubdelmate@gmail.com';
const PASS_PRUEBA = 'prueba-solo-emulador-' + Date.now();

let fallos = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const mal = (m, e) => { fallos++; console.log(`  ✗ ${m}${e ? ' — ' + e : ''}`); };
async function chequear(m, fn) {
  try { await fn(); ok(m); } catch (e) { mal(m, e.message.split('\n')[0]); }
}

// ---------- preparar datos en el emulador ----------
initializeApp({ projectId: 'el-sotano-bar' });
const db = getFirestore();
const auth = getAuth();

await db.collection('carta').doc('fernet').set({
  nombre: 'Fernet con coca', categoria: 'Tragos', precio: 4500,
  orden: 1, descripcion: 'El clásico.', disponible: true, stock: null,
});
await db.collection('carta').doc('papas').set({
  // Con stock numérico a propósito: es el producto con el que se prueba que
  // el stock baja solo al entregar.
  nombre: 'Papas bravas', categoria: 'Para picar', precio: 5500,
  orden: 1, descripcion: 'Con alioli.', disponible: true, stock: 20,
});
await db.collection('carta').doc('agotado').set({
  nombre: 'Rabas', categoria: 'Para picar', precio: 8900,
  orden: 2, disponible: false, stock: 0,
});

const u = await auth.createUser({ email: MAIL_BARRA, password: PASS_PRUEBA, emailVerified: true });
console.log(`\nDatos listos en el emulador (uid barra ${u.uid})\n`);

// ---------- navegador ----------
// El contenedor trae un Chromium propio; si existe, lo usamos en vez de bajar otro.
const { existsSync } = await import('node:fs');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const navegador = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {},
);
const errores = [];

console.log('CLIENTE (mesa 7, anónimo)');
const ctxCliente = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const cliente = await ctxCliente.newPage();
cliente.on('pageerror', (e) => errores.push('cliente: ' + e.message));
cliente.on('console', (m) => { if (m.type() === 'error') errores.push('cliente/console: ' + m.text()); });

await cliente.goto(BASE, { waitUntil: 'domcontentloaded' });

await chequear('la carta carga', async () => {
  await cliente.waitForSelector('text=Fernet con coca', { timeout: 15000 });
});
await chequear('sin mesas: arranca sin nombre puesto', async () => {
  const t = await cliente.textContent('#chipMesa');
  if (!t.includes('Ver QR')) throw new Error('chip dice: ' + t);
});
await chequear('el item sin stock se muestra agotado y sin botones', async () => {
  const fila = cliente.locator('.item', { hasText: 'Rabas' });
  if (!(await fila.getAttribute('class')).includes('agotado')) throw new Error('no está marcado');
  if (await fila.locator('.cant').count()) throw new Error('deja sumarlo igual');
});
await chequear('sumar al carrito actualiza el total', async () => {
  await cliente.locator('.item', { hasText: 'Fernet con coca' }).locator('[data-mas]').click();
  await cliente.locator('.item', { hasText: 'Fernet con coca' }).locator('[data-mas]').click();
  await cliente.locator('.item', { hasText: 'Papas bravas' }).locator('[data-mas]').click();
  await cliente.waitForFunction(() =>
    document.querySelector('#totalCarrito')?.textContent.replace(/\D/g, '') === '14500', null, { timeout: 5000 });
});
await chequear('muestra el QR de la mesa y vuelve sin perder el carrito', async () => {
  const antes = await cliente.textContent('#totalCarrito');
  await cliente.click('#chipMesa');
  await cliente.waitForSelector('#dlgMesa[open]', { timeout: 5000 });

  const src = await cliente.getAttribute('#imgMesaQr', 'src');
  if (src !== '/qr/general.png') throw new Error('QR equivocado: ' + src);
  // El PNG tiene que existir de verdad, no quedar como imagen rota.
  const cargo = await cliente.evaluate(() => {
    const i = document.querySelector('#imgMesaQr');
    return i.complete ? i.naturalWidth > 0 : new Promise((ok) => {
      i.onload = () => ok(true); i.onerror = () => ok(false);
    });
  });
  if (!cargo) throw new Error('el PNG del QR no cargó');

  const link = await cliente.textContent('#dlgMesaLink');
  if (!link.startsWith('http')) throw new Error('link equivocado: ' + link);

  await cliente.click('#btnCerrarMesa');
  await cliente.waitForSelector('#dlgMesa[open]', { state: 'detached', timeout: 5000 }).catch(() => {});
  if (await cliente.textContent('#totalCarrito') !== antes) throw new Error('se perdió el carrito');
});
await chequear('se manda el pedido', async () => {
  await cliente.click('#btnConfirmar');
  await cliente.waitForSelector('dialog[open]');
  await cliente.fill('#inpNombre', 'Emma');
  await cliente.fill('#inpNota', 'uno sin hielo');
  await cliente.click('#btnEnviar');
  await cliente.waitForSelector('dialog[open]', { state: 'detached', timeout: 15000 });
});
await chequear('el pedido aparece en "Mis pedidos" como Tomado', async () => {
  await cliente.waitForSelector('#vistaPedidos .pedido', { timeout: 10000 });
  const t = await cliente.textContent('#vistaPedidos');
  if (!t.includes('Tomado')) throw new Error('no dice Tomado');
  if (!t.includes('2× Fernet con coca')) throw new Error('no lista los items');
});

// Un segundo cliente, para probar el aislamiento entre clientes.
console.log('\nOTRO CLIENTE (sesión aparte)');
const ctxOtro = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const otro = await ctxOtro.newPage();
await otro.goto(`${BASE}/mesa/3`, { waitUntil: 'domcontentloaded' });
await chequear('NO ve el pedido del primer cliente', async () => {
  await otro.click('#tabPedidos');
  await otro.waitForTimeout(2500);
  const t = await otro.textContent('#misPedidos');
  if (t.includes('Fernet')) throw new Error('¡está viendo pedidos ajenos!');
  if (!t.includes('Todavía no pediste nada')) throw new Error('estado raro: ' + t.slice(0, 80));
});

console.log('\nBARRA');
const ctxBarra = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
const barra = await ctxBarra.newPage();
barra.on('pageerror', (e) => errores.push('barra: ' + e.message));
await barra.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });

await chequear('el panel pide login', async () => {
  await barra.waitForSelector('#formLogin');
  if (!(await barra.locator('#vistaPanel').isHidden())) throw new Error('el panel está visible sin login');
});
await chequear('el botón de actualizar recarga la app y la deja limpia', async () => {
  // Lo que resuelve: una PWA instalada se queda con los archivos viejos y
  // nadie va a saber qué es un service worker.
  if (!(await barra.locator('[data-actualizar]').first().isVisible()))
    throw new Error('no hay botón de actualizar');

  await barra.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const c = await caches.open('basura-de-prueba');
    await c.put('/marca-vieja', new Response('vieja'));
  });

  // El botón recarga: hay que esperar a que la navegación termine antes de
  // mirar nada, o el contexto se destruye en el medio.
  await Promise.all([
    barra.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    barra.locator('#vistaLogin [data-actualizar]').click(),
  ]);
  await barra.waitForSelector('#formLogin', { timeout: 15000 });

  const quedo = await barra.evaluate(() => caches.keys());
  if (quedo.includes('basura-de-prueba')) throw new Error('no limpió el cache viejo');
  if (new URL(barra.url()).searchParams.has('v')) throw new Error('dejó el cache-buster en la URL');
});

await chequear('actualizar NO le cambia la identidad: sus pedidos siguen siendo suyos', async () => {
  // Si al recargar se crea un uid nuevo, "Mis pedidos" queda vacío y el aviso
  // de "tu trago está listo" no llega nunca. Pasaba de a ratos, que es peor.
  await cliente.waitForFunction(() =>
    document.querySelector('#misPedidos')?.textContent.includes('Tomado'),
    null, { timeout: 15000 });
  await cliente.reload({ waitUntil: 'domcontentloaded' });
  await cliente.waitForFunction(() =>
    document.querySelector('#misPedidos')?.textContent.includes('Tomado'),
    null, { timeout: 20000 }).catch(() => {
      throw new Error('al recargar perdió sus pedidos: le cambió el uid');
    });
});

await chequear('avisa cuando la versión que corre quedó vieja', async () => {
  await barra.waitForSelector('#formLogin', { timeout: 15000 });
  await barra.evaluate(() => {
    const original = window.fetch;
    window.fetch = (u, o) => (String(u).includes('/version.json')
      ? Promise.resolve(new Response('{"version":"sotano-otra"}', { status: 200 }))
      : original(u, o));
    document.dispatchEvent(new Event('visibilitychange'));
    dispatchEvent(new Event('visibilitychange'));
  });
  await barra.waitForFunction(() =>
    !document.querySelector('#avisoVersion')?.classList.contains('oculto'),
    null, { timeout: 10000 });
});

await chequear('la barra se puede instalar como app aparte', async () => {
  // Instalada tiene que abrir el tablero, no la carta del cliente.
  const href = await barra.getAttribute('link[rel=manifest]', 'href');
  if (href !== '/manifest-barra.webmanifest') throw new Error('manifest: ' + href);

  const m = await barra.evaluate((u) => fetch(u).then((r) => r.json()), href);
  if (m.start_url !== '/bar.html') throw new Error('start_url: ' + m.start_url);
  if (m.id === '/index.html') throw new Error('comparte id con la carta: se instalaría una sola');
  if (!m.icons.some((i) => i.purpose === 'maskable')) throw new Error('sin ícono maskable');

  // Abajo del ícono va la marca, no la función: "Sótano". De la carta se
  // distingue por el color del ícono —dorado y oscuro—, no por el texto.
  if (m.short_name !== 'Sótano') throw new Error('short_name: ' + m.short_name);
  const tituloIOS = await barra.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content');
  if (tituloIOS !== 'Sótano') throw new Error('nombre en iOS: ' + tituloIOS);

  // Instalada en una computadora, el navegador pega el nombre de la app y el
  // título de la página uno detrás del otro. Si no son el mismo texto, arriba
  // quedan dos nombres: "Sótano Barra - Barra — Sótano".
  const tituloPagina = await barra.title();
  if (tituloPagina !== m.name)
    throw new Error(`el título de la página ("${tituloPagina}") no es el nombre de la app ("${m.name}")`);

  const mCarta = await barra.evaluate(() =>
    fetch('/manifest.webmanifest').then((r) => r.json()));
  if (mCarta.name !== 'Sótano' || mCarta.short_name !== 'Sótano')
    throw new Error('la app del cliente no se instala como "Sótano": '
      + mCarta.name + ' / ' + mCarta.short_name);

  // Cada ícono declarado tiene que existir de verdad.
  const faltan = await barra.evaluate(async (iconos) => {
    const malos = [];
    for (const i of iconos) {
      const r = await fetch(i.src, { method: 'HEAD' });
      if (!r.ok) malos.push(i.src + ' → ' + r.status);
    }
    return malos;
  }, m.icons);
  if (faltan.length) throw new Error('íconos rotos: ' + faltan.join(', '));

  // Sin service worker registrado desde acá, Chrome no ofrece instalar.
  const conSw = await barra.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true, () => false));
  if (!conSw) throw new Error('/bar.html no registra el service worker');
});

await chequear('el logo dice SÓTANO y el marcado le reserva el lugar justo', async () => {
  // La marca le sacó el "EL". Si alguien toca el generador y no vuelve a
  // correrlo, los SVG quedan con la marca vieja y nadie se entera hasta que
  // está impreso.
  for (const cual of ['/iconos/logo.svg', '/iconos/logo-horizontal.svg',
                      '/iconos/logo-horizontal-claro.svg']) {
    const svg = await barra.evaluate((u) => fetch(u).then((r) => r.text()), cual);
    if (!svg.includes('>SÓTANO<')) throw new Error(cual + ' no dice SÓTANO');
    if (svg.includes('EL SÓTANO')) throw new Error(cual + ' todavía dice EL SÓTANO');
  }

  // Los width/height del marcado son la proporción que el navegador reserva
  // antes de bajar el SVG. Si no coinciden con el viewBox, el encabezado
  // salta al cargar — y se desincronizan solos cuando cambia la palabra.
  const malos = await barra.evaluate(async () => {
    const fallas = [];
    for (const img of document.querySelectorAll('img[src$=".svg"]')) {
      const txt = await fetch(img.getAttribute('src')).then((r) => r.text());
      const vb = (txt.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []).slice(1);
      if (!vb.length) continue;
      const w = img.getAttribute('width'), h = img.getAttribute('height');
      if (w !== vb[0] || h !== vb[1])
        fallas.push(`${img.getAttribute('src')}: el marcado dice ${w}×${h} y el SVG mide ${vb[0]}×${vb[1]}`);
    }
    return fallas;
  });
  if (malos.length) throw new Error(malos.join(' · '));
});

await chequear('el ojo deja ver la contraseña antes de entrar', async () => {
  await barra.fill('#inpPass', 'lo-que-escribi');
  if ((await barra.getAttribute('#inpPass', 'type')) !== 'password')
    throw new Error('arranca mostrando la contraseña');
  await barra.click('#btnVerPass');
  if ((await barra.getAttribute('#inpPass', 'type')) !== 'text')
    throw new Error('el ojo no la muestra');
  if ((await barra.inputValue('#inpPass')) !== 'lo-que-escribi')
    throw new Error('se perdió lo escrito');
  await barra.click('#btnVerPass');
  if ((await barra.getAttribute('#inpPass', 'type')) !== 'password')
    throw new Error('el ojo no la vuelve a tapar');
  await barra.fill('#inpPass', '');
});

await chequear('rechaza una contraseña incorrecta', async () => {
  await barra.fill('#inpMail', MAIL_BARRA);
  await barra.fill('#inpPass', 'equivocada');
  await barra.click('#btnEntrar');
  await barra.waitForSelector('#errorLogin:not(.oculto)', { timeout: 10000 });
});
await chequear(`entra al panel con ${MAIL_BARRA}`, async () => {
  await barra.fill('#inpPass', PASS_PRUEBA);
  await barra.click('#btnEntrar');
  await barra.waitForSelector('#vistaPanel:not([hidden])', { timeout: 15000 });
});
await chequear('el cliente también puede guardarse la carta, con los pasos', async () => {
  // En iPhone el navegador NUNCA ofrece instalar solo: hay que ir a Compartir
  // → Agregar a inicio, y nadie lo sabe. Sin este botón, el cliente no tiene
  // forma de guardarse la app.
  const caja = cliente.locator('.instalar');
  if (await caja.evaluate((e) => e.classList.contains('oculto')))
    throw new Error('el ofrecimiento para instalar quedó escondido');
  const pasos = await caja.textContent();
  for (const paso of ['Instalala', 'Pedí desde la mesa', 'listo'])
    if (!pasos.includes(paso)) throw new Error('le falta el paso: ' + paso);

  await cliente.locator('.instalar [data-instalar-btn]').click();
  await cliente.waitForSelector('#dlgInstalar[open]', { timeout: 5000 });
  if (!(await cliente.textContent('#pasosInstalar')).trim())
    throw new Error('el instructivo quedó vacío');
  await cliente.click('#btnCerrarInstalar');
  if (await cliente.locator('#dlgInstalar').evaluate((d) => d.open))
    throw new Error('no cerró');
  // Y no se comió la carta que la persona estaba mirando.
  if (!(await cliente.textContent('#carta')).trim())
    throw new Error('se perdió la carta');
});

await chequear('adentro del panel se puede instalar, sin depender del navegador', async () => {
  const boton = barra.locator('header.tope [data-instalar-btn]');
  if (!(await boton.isVisible())) throw new Error('no hay botón de instalar estando logueado');

  // Chromium headless no dispara beforeinstallprompt: cae al instructivo,
  // que es justo el caso de Safari y iPhone.
  await boton.click();
  await barra.waitForSelector('#dlgInstalar[open]', { timeout: 5000 });
  const pasos = await barra.textContent('#pasosInstalar');
  if (!pasos.trim()) throw new Error('el instructivo quedó vacío');

  await barra.click('#btnCerrarInstalar');
  if (await barra.locator('#dlgInstalar').evaluate((d) => d.open)) throw new Error('no cerró');
  if (await barra.locator('#vistaPanel').isHidden()) throw new Error('se perdió el panel');
});
await chequear('el pedido del cliente aparece en "Entraron"', async () => {
  await barra.waitForSelector('.ticket', { timeout: 15000 });
  const t = await barra.textContent('#tablero');
  if (!t.includes('Emma')) throw new Error('no muestra quién pidió');
  if (!t.includes('uno sin hielo')) throw new Error('no muestra la aclaración');
  if (!t.includes('14.500')) throw new Error('total mal: ' + t.match(/\$[\d.]+/g));
});
await chequear('la barra lo pasa a Preparando', async () => {
  await barra.locator('[data-avanzar]').first().click();
  await barra.waitForFunction(() =>
    document.querySelector('.ticket.en_preparacion') !== null, null, { timeout: 10000 });
});
await chequear('el cliente ve el cambio en vivo', async () => {
  await cliente.waitForFunction(() =>
    document.querySelector('#misPedidos')?.textContent.includes('Preparando'), null, { timeout: 10000 })
    .catch(async () => {
      const diag = await cliente.evaluate(() => ({
        misPedidos: (document.querySelector('#misPedidos')?.textContent || '').slice(0, 200),
        uid: localStorage.getItem('sotano:uid') || '(no guardado)',
      }));
      throw new Error('el cliente no vio el cambio. ' + JSON.stringify(diag));
    });
});
await chequear('al pasar a Listo, al cliente le avisa en Mis pedidos', async () => {
  await barra.locator('.ticket', { hasText: 'Emma' }).locator('[data-avanzar]').click();
  // El cartel, el badge de la pestaña y la vibración: el cliente puede tener
  // la pantalla apagada o estar mirando la carta.
  await cliente.waitForFunction(() =>
    !document.querySelector('#avisoListo')?.classList.contains('oculto'), null, { timeout: 15000 });
  const t = await cliente.textContent('#avisoListo');
  if (!t.includes('listo')) throw new Error('el cartel no dice nada: ' + t);
  if (!t.includes('Fernet con coca')) throw new Error('no dice qué está listo: ' + t);
  const badge = await cliente.textContent('#cuentaPedidos');
  if (!badge.includes('🔔')) throw new Error('la pestaña no se marca: ' + badge);

  // Tocarlo lleva a Mis pedidos.
  await cliente.click('#avisoListo');
  if (await cliente.locator('#vistaPedidos').isHidden()) throw new Error('no llevó a Mis pedidos');
});

await chequear('reabrir la app con un pedido ya listo NO dispara el aviso', async () => {
  // Si avisara en cada carga, sonaría por algo que ya te entregaron. La sesión
  // anónima vive en IndexedDB, así que recargar es el reabrir de verdad.
  await cliente.reload({ waitUntil: 'domcontentloaded' });
  await cliente.waitForSelector('text=Fernet con coca', { timeout: 15000 });
  await cliente.waitForFunction(() =>
    document.querySelector('#cuentaPedidos')?.textContent.includes('🔔'), null, { timeout: 15000 });
  if (!(await cliente.locator('#avisoListo').evaluate((e) => e.classList.contains('oculto'))))
    throw new Error('avisó de nuevo al reabrir');
});

await chequear('entregar es cobrar: pregunta efectivo o virtual', async () => {
  // A Listo ya lo movió el caso del aviso, acá se cierra el ciclo.
  await barra.locator('.ticket.listo [data-avanzar]').click();
  await barra.waitForSelector('#dlgCobro[open]', { timeout: 10000 });
  await barra.click('#btnEfectivo');
  await barra.waitForSelector('.ticket.entregado', { timeout: 10000 });

  // Y queda guardado cómo pagó: sin eso la caja no se puede partir.
  let p;
  for (let i = 0; i < 40; i++) {
    const q = await db.collection('pedidos').where('estado', '==', 'entregado').get();
    p = q.docs.map((d) => d.data()).find((x) => x.pago);
    if (p) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (p?.pago !== 'efectivo') throw new Error('no guardó la forma de pago: ' + JSON.stringify(p));
  if (!p?.vendidoPor) throw new Error('no guardó quién lo despachó');
});
await chequear('la caja del día suma el pedido entregado', async () => {
  await barra.waitForFunction(() =>
    document.querySelector('#chipCaja')?.textContent.includes('14.500'), null, { timeout: 10000 });
});
await chequear('la barra carga una venta de mostrador y entra a la caja', async () => {
  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.locator('#cuerpoVenta .item', { hasText: 'Papas bravas' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.waitForFunction(() =>
    document.querySelector('.total-venta b')?.textContent.replace(/\D/g, '') !== '0',
    null, { timeout: 5000 });
  await barra.click('#btnVentaVirtual');
  await barra.waitForSelector('#dlgVenta[open]', { state: 'detached', timeout: 10000 })
    .catch(() => {});   // el diálogo se cierra solo al cobrar

  let v;
  for (let i = 0; i < 40; i++) {
    const q = await db.collection('pedidos').where('origen', '==', 'barra').get();
    v = q.docs[0]?.data();
    if (v) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!v) throw new Error('no quedó la venta');
  if (v.pago !== 'virtual') throw new Error('no guardó la forma de pago: ' + v.pago);
  if (v.estado !== 'entregado') throw new Error('la venta de mostrador nace cobrada');
  if (!v.cajaId) throw new Error('no dice a qué caja entra');
  if (!v.vendidoPor) throw new Error('no dice quién vendió');
});

await chequear('la venta de mostrador suma al chip de la caja', async () => {
  await barra.waitForFunction(() =>
    document.querySelector('#chipCaja')?.textContent.includes('20.000'), null, { timeout: 10000 });
});

await chequear('el stock baja solo al entregar, no al pedir', async () => {
  // Papas quedó con stock numérico desde el seed: se mira ese.
  const antes = (await db.doc('carta/papas').get()).data()?.stock;
  if (typeof antes !== 'number') throw new Error('el seed no dejó stock numérico en papas');

  // La venta de mostrador de recién entregó 1 papas: tiene que haber bajado.
  let ahora;
  for (let i = 0; i < 40; i++) {
    ahora = (await db.doc('carta/papas').get()).data()?.stock;
    if (ahora !== antes) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (ahora !== antes) throw new Error('no bajó el stock al cobrar la venta');
});

await chequear('una venta no pisa el stock que se movió por otro lado', async () => {
  // El bug: el descuento se calculaba leyendo el stock de la copia en memoria
  // del celular y escribiendo "lo que yo vi menos lo vendido". Dos celulares
  // entregando en el mismo segundo y una venta desaparecía del depósito.
  //
  // Se reproduce sin pelear con los tiempos: se le cambia el stock por detrás
  // a la pantalla, que queda con el número viejo en memoria, y después se
  // vende. Si descuenta sobre lo que tenía guardado, el cambio se pierde.
  const ref = db.collection('carta').doc('papas');
  const antes = Number((await ref.get()).data().stock);

  await barra.click('#tabCartaBar');
  await barra.waitForFunction((n) =>
    (document.querySelector('#cartaBar')?.textContent || '').includes(String(n)),
    antes, { timeout: 10000 }).catch(() => {});

  // Por detrás: alguien cargó mercadería desde otro lado.
  await ref.update({ stock: antes + 10 });
  await barra.waitForTimeout(300);

  // Y ahora se vende uno desde esta pantalla, con el número viejo en memoria.
  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.locator('#cuerpoVenta .item', { hasText: 'Papas bravas' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');

  for (let i = 0; i < 40; i++) {
    const n = Number((await ref.get()).data().stock);
    if (n === antes + 9) break;
    if (i === 39) {
      throw new Error(`la venta pisó el stock: quedó en ${n} y tenía que quedar en ${antes + 9}`
        + ` (había ${antes + 10} y se vendió 1)`);
    }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  // Se deja como estaba para no correrle el número a los casos que siguen.
  await ref.update({ stock: antes - 1 });
});

await chequear('editar un insumo no le devuelve el stock a lo que era', async () => {
  // El otro bug de la misma familia: al guardar el nombre de un insumo se
  // mandaba también el stock que tenía la pantalla cuando se abrió el
  // diálogo. Si entre medio la barra vendía, esas ventas volvían atrás.
  //
  // El insumo lo crea el caso: así no depende de en qué orden corran los
  // demás, y se lo lleva al terminar.
  const ref = db.collection('insumos').doc('insumo-de-prueba-edicion');
  await ref.set({ nombre: 'Prueba Edición', unidad: 'botella', medidas: 1,
                  stock: 33, costo: 1000, minimo: 0 });
  try {
    await barra.click('#tabDeposito');
    await barra.waitForFunction(() =>
      document.querySelector('#deposito')?.textContent.includes('Prueba Edición'),
      null, { timeout: 15000 });

    // Se abre el diálogo con 33 en pantalla…
    await barra.locator('#deposito .item', { hasText: 'Prueba Edición' })
      .locator('[data-editar-insumo]').click();
    await barra.waitForSelector('#dlgInsumo[open]', { timeout: 5000 });

    // … y mientras está abierto, la barra vende: el stock real baja a 28.
    await ref.update({ stock: 28 });
    await barra.waitForTimeout(400);

    // Se guarda solo un cambio de nombre.
    await barra.fill('#inpInsNombre', 'Prueba Edición SRL');
    await barra.click('#btnGuardarInsumo');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgInsumo')?.open, null, { timeout: 10000 });
    await barra.waitForTimeout(1200);

    const d = (await ref.get()).data();
    if (d.nombre !== 'Prueba Edición SRL') throw new Error('no guardó el nombre nuevo');
    if (Number(d.stock) !== 28) {
      throw new Error(`la edición pisó el stock: quedó en ${d.stock} y tenía que quedar en 28`);
    }
  } finally {
    await ref.delete();
  }
});

await chequear('el conteo de la noche compara y marca lo que falta', async () => {
  await barra.click('#tabCartaBar');
  await barra.click('#btnConteo');
  await barra.waitForSelector('#dlgConteo[open]', { timeout: 10000 });
  if (!(await barra.textContent('#tituloConteo')).includes('apertura'))
    throw new Error('no arranca por la apertura');

  // Se cuenta de más al abrir y de menos al cerrar: tiene que marcar faltante.
  const stockApp = await barra.textContent('.lista-conteo .item .desc');
  if (!stockApp.includes('en la app')) throw new Error('no muestra el stock que tiene la app');
  // Papas no tiene receta: se cuenta solo, como antes.
  if (!(await barra.locator('[data-conteo="item:papas"]').count()))
    throw new Error('no lista los productos que llevan su propio stock');
  const primero = barra.locator('[data-conteo]').first();
  await primero.fill('10');
  await barra.click('#btnGuardarConteo');
  await barra.waitForFunction(() =>
    document.querySelector('#tituloConteo')?.textContent.includes('cierre'),
    null, { timeout: 10000 });

  await barra.locator('[data-conteo]').first().fill('2');
  await barra.click('#btnGuardarConteo');
  await barra.waitForFunction(() =>
    document.querySelector('#cuerpoConteo')?.textContent.includes('Falta mercadería')
    || document.querySelector('#cuerpoConteo')?.textContent.includes('Cierra todo'),
    null, { timeout: 10000 });
  const resultado = await barra.textContent('#cuerpoConteo');
  if (!resultado.includes('Falta mercadería'))
    throw new Error('no detectó el faltante: ' + resultado.slice(0, 200));

  // Y lo que importa: el conteo NO movió el stock de la carta.
  const guardado = await db.collection('conteos').get();
  if (guardado.empty) throw new Error('no guardó el conteo');
  const c = guardado.docs[0].data();
  if (!c.apertura || !c.cierre) throw new Error('le falta alguna de las dos puntas');
  if (!c.aperturaPor || !c.cierrePor) throw new Error('no dice quién contó');
  await barra.click('#btnCerrarConteo');
});

// ---------- aplicar el conteo al depósito ----------
// El conteo por sí solo es control: no mueve nada. Esto es el paso aparte,
// a mano, que dice "lo que hay es lo que conté" — y deja anotado por qué.
await chequear('el conteo cerrado ofrece aplicarse, y muestra qué cambiaría', async () => {
  await barra.click('#tabCartaBar');
  await barra.click('#btnConteo');
  await barra.waitForSelector('#dlgConteo[open]', { timeout: 10000 });
  await barra.waitForSelector('#btnAplicarConteo', { timeout: 10000 });

  await barra.click('#btnAplicarConteo');
  await barra.waitForSelector('#inpMotivoConteo', { timeout: 10000 });
  const t = await barra.textContent('#cuerpoConteo');
  for (const debe of ['Dice la app', 'Contaste', 'Queda en', 'cambia el stock']) {
    if (!t.includes(debe)) {
      await barra.evaluate(() =>
        document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
      throw new Error('la confirmación no dice "' + debe + '": ' + t.slice(0, 200));
    }
  }
});

await chequear('sin motivo no ajusta nada', async () => {
  // El motivo es lo único que queda después del ajuste: sin eso, el stock se
  // movería sin ninguna explicación.
  const antes = (await db.collection('insumos').get()).docs
    .map((d) => `${d.id}:${d.data().stock}`).sort().join(',');

  await barra.click('#btnConfirmarConteo');
  await barra.waitForFunction(() =>
    !document.querySelector('#errorConteo')?.classList.contains('oculto'),
    null, { timeout: 10000 })
    .catch(() => { throw new Error('no avisó que falta el motivo'); });

  await barra.waitForTimeout(800);
  const ahora = (await db.collection('insumos').get()).docs
    .map((d) => `${d.id}:${d.data().stock}`).sort().join(',');
  if (ahora !== antes) throw new Error('movió el stock igual, sin motivo');
  if (!(await db.collection('mermas').get()).empty) throw new Error('anotó una merma sin motivo');
});

await chequear('aplicarlo deja el stock en lo contado y anota la merma', async () => {
  // Este caso abre un diálogo modal. Si se va por una excepción sin cerrarlo,
  // todos los clicks que siguen en la suite pegan contra el diálogo y fallan
  // por timeout: un caso roto se lleva puestos veinte. Por eso el finally.
  const conteo = (await db.collection('conteos').get()).docs[0].data();
  const cerro = conteo.cierre || {};
  const claves = Object.keys(cerro);
  if (!claves.length) throw new Error('el conteo no dejó nada contado');

  // Lo contado puede ser un insumo del depósito o un producto de la carta que
  // lleva su propio stock: acá todavía no hay insumos cargados, se crean más
  // adelante en la suite.
  const donde = (clave) => clave.startsWith('ins:')
    ? { col: 'insumos', id: clave.slice('ins:'.length) }
    : { col: 'carta', id: clave.slice('item:'.length) };

  const comoEstaba = new Map();
  for (const k of claves) {
    const { col, id } = donde(k);
    comoEstaba.set(k, Number((await db.collection(col).doc(id).get()).data()?.stock || 0));
  }

  const MOTIVO = 'se rompieron dos botellas en la barra';
  let mermas = { docs: [] };
  try {
    await barra.fill('#inpMotivoConteo', MOTIVO);
    await barra.click('#btnConfirmarConteo');
    await barra.waitForFunction(() =>
      document.querySelector('#cuerpoConteo')?.textContent.includes('quedó anotada'),
      null, { timeout: 15000 })
      .catch(async () => {
        throw new Error('no confirmó el ajuste: '
          + (await barra.textContent('#cuerpoConteo')).slice(0, 200));
      });

    // El stock queda EXACTAMENTE en lo contado, no en una resta aproximada.
    for (const k of claves) {
      const { col, id } = donde(k);
      const esperado = Number(cerro[k]);
      for (let i = 0; i < 40; i++) {
        const hay = Number((await db.collection(col).doc(id).get()).data()?.stock || 0);
        if (hay === esperado) break;
        if (i === 39) throw new Error(`${col}/${id} quedó en ${hay} y se contó ${esperado}`);
        await new Promise((ok) => setTimeout(ok, 250));
      }
    }

    // Y la merma explica por qué: sin esto el stock se movió porque sí.
    mermas = await db.collection('mermas').get();
    if (mermas.empty) throw new Error('no anotó ninguna merma');
    for (const d of mermas.docs) {
      const m = d.data();
      if (m.motivo !== MOTIVO) throw new Error('el motivo no es el que se escribió: ' + m.motivo);
      if (m.diferencia !== m.contado - m.enApp)
        throw new Error('la cuenta de la merma no cierra: ' + JSON.stringify(m));
      if (m.diferencia === 0) throw new Error('anotó una merma de cero');
      if (!m.quien) throw new Error('no dice quién lo aplicó');
    }
  } finally {
    // Cerrar el diálogo pase lo que pase, y devolver todo como estaba: los
    // casos que siguen cuentan con esos números.
    await barra.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
    for (const [k, stock] of comoEstaba) {
      const { col, id } = donde(k);
      await db.collection(col).doc(id).update({ stock }).catch(() => {});
    }
    await db.collection('mermas').get()
      .then((q) => Promise.all(q.docs.map((d) => d.ref.delete()))).catch(() => {});
    await db.collection('conteos').get()
      .then((q) => Promise.all(q.docs.map((d) => d.ref.delete()))).catch(() => {});
  }
});

await chequear('la barra puede agotar un item y el cliente lo ve', async () => {
  await barra.click('#tabCartaBar');
  await barra.locator('.item', { hasText: 'Fernet con coca' }).locator('[data-toggle]').click();
  await cliente.click('#tabCarta');
  await cliente.waitForFunction(() => {
    const f = [...document.querySelectorAll('.item')].find((e) => e.textContent.includes('Fernet'));
    return f && f.className.includes('agotado');
  }, null, { timeout: 10000 });
});

await chequear('no avisa "sin conexión" si los datos están llegando', async () => {
  // El caso real: Chrome deja navigator.onLine en false con internet andando.
  // El cartel tiene que mirar si Firestore responde, no lo que dice el navegador.
  const ctxMentiroso = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  await ctxMentiroso.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false }));
  const pag = await ctxMentiroso.newPage();
  try {
    await pag.goto(`${BASE}`, { waitUntil: 'domcontentloaded' });
    await pag.waitForSelector('text=Fernet con coca', { timeout: 15000 });
    await pag.waitForTimeout(1500);
    if (await pag.locator('#chipConexion').isVisible())
      throw new Error('dice sin conexión con la carta cargada');
    if (!(await pag.locator('#avisoOffline').evaluate((e) => e.classList.contains('oculto'))))
      throw new Error('muestra el aviso de offline igual');
  } finally { await ctxMentiroso.close(); }
});

console.log('\nUSUARIO DE BARRA DEL TURNO');
await chequear('el dueño crea un usuario de barra sin mail y sin perder su sesión', async () => {
  await barra.click('#tabUsuarios');
  await barra.waitForSelector('#btnAltaBarman', { timeout: 10000 });
  barra.on('dialog', async (d) => d.accept());
  await barra.click('#btnAltaBarman');
  await barra.waitForSelector('#dlgPersona[open]', { timeout: 10000 });

  // Lo que escribe la gente en un celular: mayúsculas, acentos y espacios.
  // El campo lo acomoda solo en vez de rebotarlo después de cargar todo.
  await barra.fill('#inpPersonaUsuario', 'Barra Turno');
  if ((await barra.inputValue('#inpPersonaUsuario')) !== 'barra-turno')
    throw new Error('no acomodó el usuario: ' + (await barra.inputValue('#inpPersonaUsuario')));
  if (!(await barra.textContent('#pistaPersona')).includes('barra-turno'))
    throw new Error('no confirma con qué usuario va a entrar');

  // Contraseña corta: lo dice ahí mismo y no crea nada.
  await barra.fill('#inpPersonaClave', '123');
  await barra.click('#btnConfirmarPersona');
  await barra.waitForFunction(() =>
    !document.querySelector('#errorPersona')?.classList.contains('oculto'), null, { timeout: 5000 });

  await barra.fill('#inpPersonaClave', 'clave-de-prueba');
  await barra.click('#btnConfirmarPersona');
  await barra.waitForFunction(() =>
    document.querySelector('#usuarios')?.textContent.includes('barra-turno'), null, { timeout: 15000 });
  // El alta usa una app aparte justamente para esto: el dueño sigue adentro.
  if (await barra.locator('#vistaPanel').isHidden()) throw new Error('al dueño lo sacó de su propio panel');
  barra.removeAllListeners('dialog');
});

await chequear('el celular de la barra se registra y entra sin turno', async () => {
  // El listener se saca pase lo que pase: si queda puesto, se come los
  // confirm de los casos que siguen y los hace fallar sin motivo.
  barra.on('dialog', async (d) => d.accept());
  try {
    await barra.click('#btnAltaAparato');
    await barra.waitForSelector('#dlgPersona[open]', { timeout: 10000 });
    // Viene con el nombre puesto: es el aparato del local, no una persona.
    if ((await barra.inputValue('#inpPersonaUsuario')) !== 'barra')
      throw new Error('no propone el usuario "barra"');
    await barra.fill('#inpPersonaClave', 'clave-del-aparato');
    await barra.click('#btnConfirmarPersona');
    await barra.waitForFunction(() =>
      document.querySelector('#usuarios')?.textContent.includes('El celular del local'),
      null, { timeout: 15000 });
  } finally { barra.removeAllListeners('dialog'); }

  // Y entra sin estar asignado a ninguna noche: el bar vende todos los días.
  const ctxAparato = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const cel = await ctxAparato.newPage();
  try {
    await cel.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await cel.fill('#inpMail', 'barra');
    await cel.fill('#inpPass', 'clave-del-aparato');
    await cel.click('#btnEntrar');
    await cel.waitForSelector('#vistaPanel:not([hidden])', { timeout: 15000 });
    // El permiso llega por su propio snapshot: hasta que no llega, el panel
    // todavía no sabe que es el aparato de la barra.
    await cel.waitForSelector('#btnQuienAtiende:not([hidden])', { timeout: 20000 });
    if (await cel.locator('#tabCaja').isVisible())
      throw new Error('el aparato no tiene que ver la caja general');
    if (await cel.locator('#tabCalendario').isVisible())
      throw new Error('el aparato no tiene que ver el calendario');
    if (await cel.locator('#tabPuerta').isVisible())
      throw new Error('la puerta es de la gente de puerta, no del aparato');
    // Lo suyo: pedidos, carta y la noche.
    for (const t of ['#tabTablero', '#tabCartaBar', '#tabEvento']) {
      if (!(await cel.locator(t).isVisible())) throw new Error('le falta ' + t);
    }
    if (!(await cel.locator('#btnVentaBarra').isVisible()))
      throw new Error('tiene que poder cargar una venta de mostrador');
    // Leer el padrón ya no lo convierte en dueño: nada de administración.
    if (await cel.locator('#btnAltaBarman').isVisible())
      throw new Error('el aparato no puede dar de alta gente');

    // Quién atiende se elige de una lista, no se escribe: los nombres salen
    // del padrón, que el aparato sí puede leer.
    await cel.click('#btnQuienAtiende');
    await cel.waitForSelector('#dlgAtiende[open]', { timeout: 10000 });
    await cel.waitForSelector('[data-atiende]', { timeout: 10000 });
    const quienes = await cel.textContent('#listaAtiende');
    if (!quienes.includes('barra-turno'))
      throw new Error('no lista a los barmanes registrados: ' + quienes);
    const seLista = await cel.locator('[data-atiende="barra"]').count();
    if (seLista) throw new Error('se lista a sí mismo: el aparato no atiende');
    await cel.locator('[data-atiende="barra-turno"]').click();
    await cel.waitForFunction(() =>
      document.querySelector('#quienAtiende')?.textContent === 'barra-turno',
      null, { timeout: 5000 });

    // Y lee SU ayuda, no la del barman: lo de "quién atiende" es suyo.
    // Hay un botón de ayuda en el login y otro en el panel: el del panel.
    await cel.click('#vistaPanel [data-ayuda]');
    await cel.waitForSelector('#dlgAyuda[open]', { timeout: 10000 });
    const suAyuda = await cel.textContent('#dlgAyuda');
    if (!suAyuda.includes('Celular de la barra'))
      throw new Error('no se reconoce como el aparato del local');
    if (!suAyuda.includes('quién está atendiendo'))
      throw new Error('no le explica lo de quién atiende');
    if (suAyuda.includes('Caja general') || suAyuda.includes('ticket promedio'))
      throw new Error('le muestra la ayuda de la caja, que no es suya');
    if (suAyuda.includes('Ingreso de mercadería') || suAyuda.includes('Carga inicial'))
      throw new Error('le explica cómo cargar el depósito, que no puede hacer');
    await cel.click('#btnCerrarAyuda');
  } finally { await ctxAparato.close(); }
});

const ctxTurno = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const turno = await ctxTurno.newPage();
turno.on('pageerror', (e) => errores.push('turno: ' + e.message));

await chequear('el sadmin reparte pantallas, y lo que apaga se apaga de verdad', async () => {
  // Lo que importa no es que la pestaña desaparezca: es que el dato no se
  // pueda escribir igual. Por eso se prueban las dos cosas.
  await barra.click('#tabUsuarios');
  await barra.waitForSelector('#btnAltaAdmin', { timeout: 10000 });
  barra.on('dialog', async (d) => d.accept());
  try {
    await barra.click('#btnAltaAdmin');
    await barra.waitForSelector('#dlgPersona[open]', { timeout: 10000 });
    await barra.fill('#inpPersonaUsuario', 'recortado');
    await barra.fill('#inpPersonaClave', 'clave-recortada');
    await barra.click('#btnConfirmarPersona');
    await barra.waitForFunction(() =>
      document.querySelector('#usuarios')?.textContent.includes('recortado'),
      null, { timeout: 15000 });
  } finally { barra.removeAllListeners('dialog'); }

  // El dueño ve Usuarios; un admin no.
  await barra.waitForFunction(() =>
    document.querySelector('#tabUsuarios')?.hidden === false, null, { timeout: 10000 })
    .catch(() => { throw new Error('el dueño no ve la pestaña Usuarios'); });
  await barra.click('#tabUsuarios');
  await barra.waitForFunction(() =>
    document.querySelector('#usuarios')?.textContent.includes('recortado'),
    null, { timeout: 15000 });

  // Se le apaga la Caja.
  const uid = await barra.evaluate(() => {
    const c = [...document.querySelectorAll('#usuarios [data-permiso]')]
      .find((x) => x.dataset.permiso.endsWith(':caja'));
    return c ? c.dataset.permiso.split(':')[0] : '';
  });
  if (!uid) throw new Error('no hay interruptores para el admin nuevo');
  await barra.locator(`[data-permiso="${uid}:caja"]`).uncheck();
  for (let i = 0; i < 40; i++) {
    const d = await db.doc(`accesosBarra/${uid}`).get();
    if (d.data()?.permisos?.caja === false) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  const guardado = (await db.doc(`accesosBarra/${uid}`).get()).data();
  if (guardado?.permisos?.caja !== false)
    throw new Error('no guardó el interruptor: ' + JSON.stringify(guardado?.permisos));

  // Y con eso: no ve la pestaña NI puede cargar un gasto.
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await pg.fill('#inpMail', 'recortado');
    await pg.fill('#inpPass', 'clave-recortada');
    await pg.click('#btnEntrar');
    await pg.waitForSelector('#vistaPanel', { state: 'visible', timeout: 20000 });
    await pg.waitForFunction(() =>
      document.querySelector('#tabCaja')?.hidden === true, null, { timeout: 15000 })
      .catch(() => { throw new Error('sigue viendo la pestaña Caja'); });
    // Usuarios sí la ve —tiene que poder dar de alta un barman—, pero no los
    // interruptores: repartir permisos es del sadmin.
    await pg.click('#tabUsuarios');
    await pg.waitForFunction(() =>
      (document.querySelector('#usuarios')?.textContent || '').includes('Barman'),
      null, { timeout: 15000 });
    if (await pg.locator('#usuarios [data-permiso]').count())
      throw new Error('un admin ve los interruptores de permisos');
    if (await pg.locator('#btnAltaSadmin').count())
      throw new Error('un admin puede crear un superadministrador');
    // Y lo que de verdad importa: la escritura frena, no solo la pestaña.
    const pudo = await pg.evaluate(async () => {
      const { getFirestore, doc, setDoc } = await import('/vendor/firebase.js');
      try {
        await setDoc(doc(getFirestore(), 'egresos', 'colado-por-la-consola'), {
          concepto: 'Colado', categoria: 'retiro', monto: 1000,
          pago: 'efectivo', fecha: new Date(),
        });
        return true;
      } catch { return false; }
    });
    if (pudo) throw new Error('la pestaña estaba escondida pero el gasto entró igual');
  } finally { await ctx.close(); }

  // Se lo deja como estaba, que la caja la usan los casos que siguen.
  await barra.locator(`[data-permiso="${uid}:caja"]`).check();
});

await chequear('cada uno puede cambiar su propia contraseña', async () => {
  // Es lo único que se puede sin un servidor: Firebase deja cambiar la propia,
  // nunca la de otro. Se prueba con el celular de la barra, que es la cuenta
  // que más se queda afuera.
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  let dijo = '';
  pg.on('dialog', async (d) => { dijo = d.message(); await d.accept(); });
  try {
    await pg.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await pg.fill('#inpMail', 'barra');
    await pg.fill('#inpPass', 'clave-del-aparato');
    await pg.click('#btnEntrar');
    await pg.waitForSelector('#vistaPanel', { state: 'visible', timeout: 20000 });

    await pg.click('#btnMiClave');
    await pg.waitForSelector('#dlgClave[open]', { timeout: 5000 });

    // Con la de ahora mal, no cambia nada.
    await pg.fill('#inpClaveVieja', 'la-que-no-es');
    await pg.fill('#inpClaveNueva', 'clave-nueva-1');
    await pg.fill('#inpClaveNueva2', 'clave-nueva-1');
    await pg.click('#btnConfirmarClave');
    await pg.waitForFunction(() =>
      !document.querySelector('#errorClave')?.classList.contains('oculto'),
      null, { timeout: 10000 });

    // Y si las dos nuevas no coinciden, tampoco.
    await pg.fill('#inpClaveVieja', 'clave-del-aparato');
    await pg.fill('#inpClaveNueva2', 'otra-distinta');
    await pg.click('#btnConfirmarClave');
    if (!(await pg.textContent('#errorClaveTexto')).includes('no coinciden'))
      throw new Error('no avisa que las nuevas no coinciden');

    await pg.fill('#inpClaveNueva2', 'clave-nueva-1');
    await pg.click('#btnConfirmarClave');
    await pg.waitForFunction(() =>
      !document.querySelector('#dlgClave')?.open, null, { timeout: 15000 }).catch(async () => {
        throw new Error('no la cambió: ' + (await pg.textContent('#errorClaveTexto')));
      });
    if (!dijo.includes('cambió')) throw new Error('no confirma el cambio: ' + dijo);

    // Y la nueva entra de verdad: se sale y se vuelve.
    await pg.click('#btnSalir');
    await pg.waitForSelector('#formLogin', { timeout: 15000 });
    await pg.fill('#inpMail', 'barra');
    await pg.fill('#inpPass', 'clave-nueva-1');
    await pg.click('#btnEntrar');
    await pg.waitForSelector('#vistaPanel', { state: 'visible', timeout: 20000 })
      .catch(() => { throw new Error('con la contraseña nueva no entra'); });

    // Se deja como estaba, que los casos que siguen usan la vieja.
    await pg.click('#btnMiClave');
    await pg.waitForSelector('#dlgClave[open]', { timeout: 5000 });
    await pg.fill('#inpClaveVieja', 'clave-nueva-1');
    await pg.fill('#inpClaveNueva', 'clave-del-aparato');
    await pg.fill('#inpClaveNueva2', 'clave-del-aparato');
    await pg.click('#btnConfirmarClave');
    await pg.waitForFunction(() =>
      !document.querySelector('#dlgClave')?.open, null, { timeout: 15000 });
  } finally { await ctx.close(); }
});

await chequear('sin mail, el "olvidé la contraseña" dice la verdad', async () => {
  // Decía "pedile al dueño que te la cambie desde el panel", y el panel no
  // tiene cómo: desde el navegador no se puede cambiar la contraseña de otro.
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await pg.fill('#inpMail', 'barra');
    await pg.click('#btnOlvide');
    await pg.waitForFunction(() =>
      !document.querySelector('#errorLogin')?.classList.contains('oculto'),
      null, { timeout: 10000 });
    const t = await pg.textContent('#errorLoginTexto');
    if (/cambie desde el panel/i.test(t))
      throw new Error('sigue prometiendo algo que el panel no puede hacer: ' + t);
    if (!/cuenta nueva/i.test(t))
      throw new Error('no dice cuál es la salida real: ' + t);
  } finally { await ctx.close(); }
});

await chequear('registrado pero sin turno, el barman entra y no ve nada', async () => {
  // Registrado no alcanza: las reglas piden estar asignado al evento.
  const ctxSinTurno = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pag = await ctxSinTurno.newPage();
  try {
    await pag.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await pag.fill('#inpMail', 'barra-turno');
    await pag.fill('#inpPass', 'clave-de-prueba');
    await pag.click('#btnEntrar');
    await pag.waitForSelector('#vistaPanel:not([hidden])', { timeout: 15000 });
    await pag.waitForFunction(() =>
      document.querySelector('#tablero')?.textContent.includes('permission-denied')
      || !document.querySelector('#avisoPermiso')?.classList.contains('oculto'),
      null, { timeout: 20000 });
  } finally { await ctxSinTurno.close(); }
});

await chequear('asignarlo al turno le abre el panel', async () => {
  await barra.click('#tabCalendario');
  // Sin evento todavía: lo agendamos eligiendo al barman.
  await barra.waitForSelector('#btnAgendar', { timeout: 10000 });
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'Noche de prueba');
  await barra.check('#elegirBarman input');
  await barra.click('#btnConfirmarEvento');
  // Queda agendada; arrancarla es el segundo paso.
  await barra.waitForSelector('[data-empezar]', { timeout: 10000 });
  barra.once('dialog', (d) => d.accept());
  await barra.locator('[data-empezar]').first().click();
  // Arrancar se hace desde el calendario; la noche en curso vive en Noche.
  await barra.click('#tabEvento');
  await barra.waitForSelector('#evento .caja-evento', { timeout: 15000 });
  const t = await barra.textContent('#evento .caja-evento');
  if (!t.includes('barra-turno')) throw new Error('no muestra quién está de turno: ' + t.slice(0, 200));
});

await chequear('entra con usuario y contraseña, sin escribir ningún mail', async () => {
  await turno.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
  await turno.fill('#inpMail', 'barra-turno');
  await turno.fill('#inpPass', 'clave-de-prueba');
  await turno.click('#btnEntrar');
  await turno.waitForSelector('#vistaPanel:not([hidden])', { timeout: 15000 })
    .catch(async () => {
      throw new Error('login falló: ' + (await turno.textContent('#errorLoginTexto')));
    });
  // El tablero del evento recién abierto está vacío; lo que prueba el acceso
  // es que la carta le llegue.
  await turno.click('#tabCartaBar');
  await turno.waitForSelector('#cartaBar .item', { timeout: 15000 });
  if (!(await turno.locator('#avisoPermiso').evaluate((e) => e.classList.contains('oculto'))))
    throw new Error('le rechazaron la lectura estando de turno');
});

await chequear('la ayuda del barman habla de lo suyo y no de la caja', async () => {
  await turno.click('header [data-ayuda]');
  await turno.waitForSelector('#dlgAyuda[open]', { timeout: 5000 });
  const t = await turno.textContent('#temasAyuda');
  if (!(await turno.textContent('#quienAyuda')).includes('Barman'))
    throw new Error('no dice qué rol es');
  for (const debe of ['El tablero de pedidos', 'Carta y stock', 'Si algo no anda']) {
    if (!t.includes(debe)) throw new Error('le falta: ' + debe);
  }
  for (const noDebe of ['La caja', 'Personal: los niveles', 'Agendar una noche', 'Controlar la entrada']) {
    if (t.includes(noDebe)) throw new Error('le sobra: ' + noDebe);
  }
  // "Sacar" es de admin: dentro de Carta y stock no tiene que aparecer.
  if (t.includes('Poner en carta')) throw new Error('le muestra algo que no puede hacer');
  await turno.click('#btnCerrarAyuda');
});

await chequear('el de la barra ve lo suyo y nada mas', async () => {
  await turno.click('#tabEvento');
  await turno.waitForTimeout(800);
  if (await turno.locator('#tabCalendario').isVisible()) throw new Error('ve el calendario');
  if (await turno.locator('#btnAltaBarman').isVisible()) throw new Error('puede crear usuarios');
  // Todo lo de cuentas vive en Usuarios, y esa pestaña es de quien administra.
  if (!(await turno.locator('#tabUsuarios').isHidden()))
    throw new Error('un barman ve la pestaña Usuarios');
  if (await turno.locator('#btnCerrarEvento').isVisible()) throw new Error('puede cerrar el evento');
  if (await turno.locator('#btnTomando').isVisible()) throw new Error('puede cortar los pedidos');
  // El evento lo ve, con la caja y el ranking: necesita los precios.
  if (!(await turno.locator('#evento .caja-evento').isVisible()))
    throw new Error('no ve la caja del evento');
  if (!(await turno.textContent('#evento .caja-evento')).includes('Noche de prueba'))
    throw new Error('no ve de qué evento se trata');
  if (await turno.locator('#btnTurno').isVisible())
    throw new Error('puede cambiar quién está de turno');

  await turno.click('#tabCartaBar');
  await turno.waitForTimeout(500);
  const sacar = await turno.locator('[data-carta]').first();
  if (await sacar.isVisible()) throw new Error('puede sacar productos de la carta');
  if (!(await turno.locator('[data-toggle]').first().isVisible()))
    throw new Error('no puede marcar agotado, que sí es lo suyo');
});

await chequear('la barra marca agotado pero el servidor le rechaza un precio', async () => {
  await turno.locator('.item', { hasText: 'Papas bravas' }).locator('[data-toggle]').click();
  await turno.waitForFunction(() => {
    const f = [...document.querySelectorAll('#cartaBar .item')]
      .find((x) => x.textContent.includes('Papas bravas'));
    return f?.querySelector('[data-toggle]')?.textContent.includes('Activar');
  }, null, { timeout: 10000 });

  const codigo = await turno.evaluate(async () => {
    const { getFirestore, doc, updateDoc } = await import('/vendor/firebase.js');
    try { await updateDoc(doc(getFirestore(), 'carta', 'papas'), { precio: 1 }); return null; }
    catch (e) { return e.code || e.message; }
  });
  if (codigo !== 'permission-denied') throw new Error('le dejó cambiar el precio: ' + codigo);

  // Lo dejamos disponible otra vez: los casos que siguen lo necesitan.
  // Se confirma contra la base, no contra la pantalla: el caso siguiente le
  // corta el acceso a esta cuenta y una escritura en vuelo se perdería.
  await turno.locator('.item', { hasText: 'Papas bravas' }).locator('[data-toggle]').click();
  let vuelto = false;
  for (let i = 0; i < 40 && !vuelto; i++) {
    vuelto = (await db.doc('carta/papas').get()).data()?.disponible === true;
    if (!vuelto) await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!vuelto) throw new Error('quedó agotado y los casos que siguen lo necesitan');
});

await chequear('apagarlo le corta el acceso al toque', async () => {
  await barra.click('#tabUsuarios');
  await barra.waitForFunction(() =>
    (document.querySelector('#usuarios')?.textContent || '').includes('barra-turno'),
    null, { timeout: 15000 });
  barra.once('dialog', (d) => d.accept());
  // Por nombre, no "el primero de la lista": con otra cuenta dada de alta, el
  // primero deja de ser quien uno cree y se apaga a cualquiera.
  await barra.locator('#usuarios .item', { hasText: 'barra-turno' })
    .locator('[data-acceso]').click();
  await barra.waitForFunction(() => {
    const f = [...document.querySelectorAll('#usuarios .item')]
      .find((x) => x.textContent.includes('barra-turno'));
    return f && f.textContent.includes('dado de baja');
  }, null, { timeout: 10000 });
  // Se va solo, aunque tenga la app abierta: cada cuenta mira su permiso.
  turno.once('dialog', (d) => d.accept());
  await turno.waitForSelector('#vistaLogin:not([hidden])', { timeout: 20000 });
  if (!(await turno.locator('#vistaPanel').isHidden())) throw new Error('sigue adentro del panel');
});
await ctxTurno.close();

// El evento de prueba del bloque anterior queda abierto: lo cerramos para que
// los casos de abajo empiecen sin ninguno.
await chequear('cerrar el evento de prueba deja el tablero limpio', async () => {
  await barra.click('#tabEvento');
  await barra.waitForSelector('#btnCerrarEvento', { timeout: 10000 });
  barra.once('dialog', (d) => d.accept());
  await barra.click('#btnCerrarEvento');
  await barra.waitForSelector('#btnIrCalendario', { timeout: 10000 });
});

console.log('\nCAJA POR EVENTO');
await chequear('abre un evento y la caja pasa a contar desde ahí', async () => {
  await barra.click('#tabCalendario');
  await barra.waitForSelector('#btnAgendar', { timeout: 10000 });
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'Prueba de noche');
  await barra.click('#btnConfirmarEvento');
  await barra.waitForSelector('[data-empezar]', { timeout: 10000 });
  barra.once('dialog', (d) => d.accept());
  await barra.locator('[data-empezar]').first().click();
  // Arrancar se hace desde el calendario; la noche en curso vive en Noche.
  await barra.click('#tabEvento');
  await barra.waitForSelector('#evento .caja-evento', { timeout: 15000 });
  // Leer de una sola vez agarra el momento en que se está repintando: el panel
  // redibuja con cada snapshot que llega.
  await barra.waitForFunction(() =>
    document.querySelector('#evento .caja-evento')?.textContent.includes('Prueba de noche'),
    null, { timeout: 15000 });

  // abiertoEn es un serverTimestamp: hasta que vuelve del servidor llega null
  // y el tablero sigue mostrando el día entero. Esperamos a que se resuelva.
  await barra.waitForFunction(() =>
    !document.querySelector('#evento .caja-evento .desde')?.textContent.includes('—'),
    null, { timeout: 10000 });

  // El pedido entregado antes de abrir el evento no tiene que contar.
  await barra.waitForFunction(() =>
    document.querySelector('#evento .caja-evento .plata b')?.textContent.replace(/\D/g, '') === '0',
    null, { timeout: 10000 });
});
// Dos noches abiertas a la vez mandan la venta de hoy a la caja de la otra,
// y muestran su asistencia. Con 50 personas en la puerta eso no se descubre
// hasta el cierre, cuando ya no se puede arreglar.
await chequear('con una noche abierta no se puede arrancar otra', async () => {
  await barra.click('#tabCalendario');
  await barra.waitForSelector('#btnAgendar', { timeout: 10000 });
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'La segunda noche');
  await barra.click('#btnConfirmarEvento');
  await barra.waitForFunction(() =>
    document.body.textContent.includes('La segunda noche'), null, { timeout: 10000 });

  let aviso = '';
  const oir = async (d) => { aviso = d.message(); await d.accept(); };
  barra.on('dialog', oir);
  try {
    const fila = barra.locator('.item', { hasText: 'La segunda noche' }).first();
    await fila.locator('[data-empezar]').first().click();
    await barra.waitForTimeout(1500);
    if (!/sigue abierta/i.test(aviso))
      throw new Error('la dejó arrancar con otra abierta, o no explicó: ' + aviso);

    const abiertas = (await db.collection('barra').doc('eventos')
      .collection('items').where('estado', '==', 'abierto').get()).size;
    if (abiertas !== 1) throw new Error('quedaron ' + abiertas + ' noches abiertas');
  } finally {
    barra.off('dialog', oir);
    // Que no quede agendada: los casos que siguen cuentan lo que hay en el
    // calendario, y una noche de prueba colada corre todos los numeros.
    const sobra = (await db.collection('barra').doc('eventos').collection('items')
      .where('nombre', '==', 'La segunda noche').get());
    await Promise.all(sobra.docs.map((d) => d.ref.delete()));
  }
  await barra.click('#tabEvento');
});

await chequear('un pedido nuevo entra al evento y suma a la caja al entregarlo', async () => {
  await db.collection('pedidos').add({
    clienteId: 'cliente-evento', estado: 'entregado',
    items: [{ id: 'papas', nombre: 'Papas bravas', precio: 5500, cantidad: 2 }],
    total: 11000, nombreCliente: 'Caja', creadoEn: new Date(),
  });
  await barra.waitForFunction(() =>
    document.querySelector('#evento .caja-evento .plata b')?.textContent.replace(/\D/g, '') === '11000',
    null, { timeout: 10000 });
  const t = await barra.textContent('#evento .caja-evento .ranking');
  if (!t.includes('Papas bravas')) throw new Error('el ranking no lo listó');
});
await chequear('con el evento abierto, el cliente puede pedir', async () => {
  // Arrancar son varias escrituras seguidas; la del interruptor puede llegar
  // un instante después de que la tarjeta ya se dibujó.
  let d;
  for (let i = 0; i < 40; i++) {
    d = (await db.doc('publico/estado').get()).data();
    if (d?.tomandoPedidos === true) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (d?.tomandoPedidos !== true) throw new Error('abrir el evento no habilitó los pedidos');
});
await chequear('cerrar el evento congela la caja y lo manda al histórico', async () => {
  barra.once('dialog', (d) => d.accept());
  await barra.click('#btnCerrarEvento');
  await barra.waitForSelector('#btnIrCalendario', { timeout: 10000 });
  await barra.click('#tabCaja');
  // cerradoEn es un serverTimestamp: localmente llega null y recién al volver
  // del servidor el evento sale de "abierto" y entra al histórico.
  // Esperamos la fila de la noche, no el texto suelto: "Prueba de noche"
  // también aparece en la tarjeta de caja general, que se dibuja antes.
  await barra.waitForFunction(() =>
    [...document.querySelectorAll('#eventosPasados .item')]
      .some((x) => x.textContent.includes('Prueba de noche')),
    null, { timeout: 15000 });
  const fila = await barra.locator('#eventosPasados .item', { hasText: 'Prueba de noche' }).textContent();
  if (!fila.includes('11.000')) throw new Error('la caja no quedó congelada: ' + fila);
});

console.log('\nVIGENCIA: el QR sigue, el permiso de pedir no');
await chequear('el calendario muestra el mes y deja elegir un día', async () => {
  await barra.click('#tabCalendario');
  await barra.waitForSelector('.grilla-mes .dia', { timeout: 10000 });

  // Las noches de la corrida caen hoy: el día de hoy tiene que tener marca.
  const marcado = await barra.evaluate(() =>
    !!document.querySelector('.grilla-mes .dia.hoy .punto'));
  if (!marcado) throw new Error('el día de hoy no muestra ninguna noche');

  // Navegar de mes no rompe nada y cambia el encabezado.
  const mes = await barra.textContent('.nombre-mes');
  await barra.click('#mesDespues');
  if ((await barra.textContent('.nombre-mes')) === mes) throw new Error('no cambió de mes');
  await barra.click('#mesAntes');
  if ((await barra.textContent('.nombre-mes')) !== mes) throw new Error('no volvió');

  // Elegir el día de hoy filtra la lista de abajo a ese día.
  await barra.click('.grilla-mes .dia.hoy');
  await barra.waitForFunction(() =>
    document.querySelector('.grilla-mes .dia.hoy')?.classList.contains('elegido'),
    null, { timeout: 5000 });
  const titulo = await barra.textContent('#calendario .grupo-personal');
  if (titulo.includes('Lo que viene')) throw new Error('no filtró por el día elegido');
  if (!(await barra.textContent('#calendario')).includes('Prueba de noche'))
    throw new Error('no lista la noche de ese día');

  // Y agendar desde ahí viene con la fecha puesta.
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  const hoyISO = await barra.evaluate(() => new Date().toISOString().slice(0, 10));
  if ((await barra.inputValue('#inpFecha')) !== hoyISO)
    throw new Error('no trajo la fecha del día elegido');
  await barra.click('#btnCancelarEvento');
  await barra.click('#tabEvento');
});

await chequear('la caja general suma los eventos cerrados y los rankea', async () => {
  await barra.click('#tabCaja');
  await barra.waitForFunction(() =>
    document.querySelector('#eventosPasados')?.textContent.includes('Caja general'),
    null, { timeout: 10000 });
  const caja = await barra.textContent('#eventosPasados');
  // Dos eventos cerrados en la corrida: el de prueba (sin nada) y este con 11.000.
  if (!caja.includes('11.000')) throw new Error('no suma lo facturado: ' + caja.slice(0, 200));
  if (!caja.includes('La mejor noche fue')) throw new Error('no dice cuál fue la mejor noche');

  // Ordenar por facturación pone primero al que más hizo.
  await barra.click('#btnOrdenCaja');
  await barra.waitForFunction(() =>
    document.querySelector('#btnOrdenCaja')?.textContent.includes('Ver por fecha'),
    null, { timeout: 5000 });
  await barra.waitForFunction(() =>
    document.querySelector('#eventosPasados .item')?.textContent.includes('Prueba de noche'),
    null, { timeout: 10000 }).catch(async () => {
      throw new Error('el ranking no ordena: '
        + (await barra.textContent('#eventosPasados .item')));
    });

  // Y el detalle de una noche muestra qué se vendió.
  await barra.locator('#eventosPasados [data-detalle]').first().click();
  await barra.waitForSelector('#eventosPasados .ranking', { timeout: 5000 });
  const detalle = await barra.textContent('#eventosPasados');
  if (!detalle.includes('Papas bravas')) throw new Error('el detalle no lista lo vendido');
});

await chequear('el depósito: insumo, receta y descuento por medidas', async () => {
  // Si una escritura se cae, el panel avisa con un alert: lo capturamos para
  // que el error del test diga qué pasó en vez de un timeout pelado.
  let seQuejo = '';
  const oirAlertas = async (d) => { seQuejo = d.message(); await d.accept(); };
  barra.on('dialog', oirAlertas);
  try {
  await barra.click('#tabDeposito');
  await barra.waitForSelector('#btnNuevoInsumo', { timeout: 10000 });

  // Una botella que da 10 medidas: lo que se compra, no lo que se vende.
  await barra.click('#btnNuevoInsumo');
  await barra.waitForSelector('#dlgInsumo[open]', { timeout: 5000 });
  await barra.fill('#inpInsNombre', 'Fernet 750');
  await barra.fill('#inpInsUnidad', 'botella');
  await barra.fill('#inpInsMedidas', '10');
  await barra.fill('#inpInsCosto', '12000');
  await barra.click('#btnGuardarInsumo');
  await barra.waitForFunction(() =>
    document.querySelector('#deposito')?.textContent.includes('Fernet 750'),
    null, { timeout: 10000 }).catch(async () => {
      const diag = await barra.evaluate(() => ({
        oculto: document.querySelector('#vistaDeposito')?.hidden,
        html: (document.querySelector('#deposito')?.innerHTML || '').slice(0, 300),
        dlg: document.querySelector('#dlgInsumo')?.open,
      }));
      throw new Error('el insumo no aparecio. ' + JSON.stringify(diag));
    });

  // Entran 3 botellas a cuenta: suma stock y queda la deuda. El ingreso se
  // carga en Administración —es plata—, no en el Depósito.
  await barra.click('#tabCaja');
  await barra.waitForSelector('#btnNuevaCompra', { timeout: 10000 });
  await barra.click('#btnNuevaCompra');
  await barra.waitForSelector('#dlgCompra[open]', { timeout: 5000 });
  await barra.fill('#inpCompraProv', 'Distribuidora Prueba');
  await barra.locator('[data-compra-u]').first().fill('3');
  await barra.locator('[data-compra-c]').first().fill('12000');
  await barra.click('#btnGuardarCompra');
  await barra.click('#tabDeposito');
  await barra.waitForFunction(() =>
    document.querySelector('#deposito')?.textContent.includes('3 botellas'),
    null, { timeout: 10000 }).catch(async () => {
      throw new Error('la compra no sumo stock. Dice: '
        + (await barra.textContent('#deposito')).slice(0, 250));
    });
  await barra.click('#tabCaja');
  await barra.waitForFunction(() =>
    (document.querySelector('#admProveedores')?.textContent || '').includes('Distribuidora'),
    null, { timeout: 10000 }).catch(async () => {
      throw new Error('la compra a cuenta no quedó como deuda: '
        + (await barra.textContent('#admProveedores')).slice(0, 250));
    });

  // Un producto de la carta que sale de esa botella: una medida por trago.
  await barra.click('#tabCartaBar');
  await barra.locator('.item', { hasText: 'Fernet con coca' })
    .locator('[data-receta-de]').click();
  await barra.waitForSelector('#dlgReceta[open]', { timeout: 5000 });
  await barra.locator('[data-receta]').first().fill('1');
  await barra.click('#btnGuardarReceta');
  await barra.waitForFunction(() =>
    document.querySelector('#cartaBar')?.textContent.includes('sale del depósito'),
    null, { timeout: 10000 }).catch(async () => {
      throw new Error('la receta no quedo guardada. Carta: '
        + (await barra.textContent('#cartaBar')).slice(0, 200));
    });

  // Un caso anterior lo dejó agotado: se reactiva para poder venderlo.
  const fila = barra.locator('.item', { hasText: 'Fernet con coca' });
  if ((await fila.locator('[data-toggle]').textContent()).includes('Activar')) {
    await fila.locator('[data-toggle]').click();
    await barra.waitForFunction(() => {
      const f = [...document.querySelectorAll('#cartaBar .item')]
        .find((x) => x.textContent.includes('Fernet con coca'));
      return f && !f.className.includes('agotado');
    }, null, { timeout: 10000 });
  }

  // Y al venderlo, baja UNA MEDIDA, no una botella.
  const medidasAntes = (await db.collection('insumos').get()).docs[0].data().stock;
  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.locator('#cuerpoVenta .item', { hasText: 'Fernet con coca' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');
  let despues;
  for (let i = 0; i < 40; i++) {
    despues = (await db.collection('insumos').get()).docs[0].data().stock;
    if (despues !== medidasAntes) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (despues !== medidasAntes - 1)
    throw new Error(`descontó mal: ${medidasAntes} -> ${despues} (tenía que bajar 1 medida)`);
  } catch (e) {
    throw new Error(e.message + (seQuejo ? ` · el panel dijo: "${seQuejo}"` : ''));
  } finally { barra.removeListener('dialog', oirAlertas); }
});

await chequear('un ingreso en $0 no pasa, y el que se cargó mal se puede borrar', async () => {
  // Lo que pasó de verdad en la barra: se cargó la mercadería que ya estaba
  // con la opción que venía puesta ("A cuenta") y sin precios. Quedaron ocho
  // "Compra suelta · $0" en el histórico. Dos cosas tienen que andar: que el
  // panel lo frene antes, y que lo que ya entró se pueda sacar sin perder el
  // stock —las botellas están, aunque el papel esté mal.
  let dijo = '';
  const oir = async (d) => { dijo = d.message(); await d.accept(); };
  barra.on('dialog', oir);
  try {
    await barra.click('#tabCaja');
    await barra.waitForSelector('#btnNuevaCompra', { timeout: 10000 });
    const cuantas = async () => (await db.collection('compras').get()).size;
    const antes = await cuantas();

    // Sin precios y "a cuenta": no se guarda y se explica por qué.
    await barra.click('#btnNuevaCompra');
    await barra.waitForSelector('#dlgCompra[open]', { timeout: 5000 });
    await barra.locator('[data-compra-u]').first().fill('2');
    await barra.click('#btnGuardarCompra');
    await barra.waitForFunction(() => true);
    if (!dijo.includes('No pusiste los precios'))
      throw new Error('guardó un ingreso de $0 a cuenta. Dijo: ' + (dijo || '(nada)'));
    await barra.waitForTimeout(500);
    if (await cuantas() !== antes)
      throw new Error('igual escribió la compra en $0');

    // La misma carga, pero como "Carga inicial": eso sí entra.
    await barra.click('[data-condicion="inicial"]');
    await barra.click('#btnGuardarCompra');
    await barra.waitForFunction(() =>
      document.querySelector('#admMercaderia')?.textContent.includes('carga inicial'),
      null, { timeout: 10000 });

    // Y se puede borrar sin que se caiga el stock que sumó. El ingreso escribe
    // primero la compra y después el stock, así que hay que dejarlo asentar
    // antes de anotar el número con el que se va a comparar.
    await barra.waitForTimeout(2000);
    const stockAntes = (await db.collection('insumos')
      .where('nombre', '==', 'Fernet 750').get()).docs[0].data().stock;
    await barra.locator('#admMercaderia .item', { hasText: 'carga inicial' })
      .locator('[data-borrar-compra]').click();
    await barra.waitForFunction(() =>
      !document.querySelector('#admMercaderia')?.textContent.includes('carga inicial'),
      null, { timeout: 10000 });
    // La pantalla se actualiza con el cambio local, antes de que el servidor
    // confirme el borrado: contar en ese instante cuenta de más.
    for (let i = 0; i < 40; i++) {
      if (await cuantas() === antes) break;
      if (i === 39) throw new Error('el ingreso no se borró');
      await new Promise((ok) => setTimeout(ok, 250));
    }
    const stockDespues = (await db.collection('insumos')
      .where('nombre', '==', 'Fernet 750').get()).docs[0].data().stock;
    if (stockDespues !== stockAntes)
      throw new Error(`borrar el papel movió el stock: ${stockAntes} -> ${stockDespues}`);
  } finally { barra.removeListener('dialog', oir); }
});

await chequear('la cuenta corriente del proveedor suma, resta y se puede mirar', async () => {
  // Lo que ya quedó del caso anterior: 3 botellas a $12.000 a cuenta de
  // "Distribuidora Prueba" = $36.000 de deuda.
  let dijo = '';
  const oir = async (d) => { dijo = d.message(); await d.accept(); };
  barra.on('dialog', oir);
  try {
    await barra.click('#tabCaja');
    await barra.waitForSelector('#btnNuevaCompra', { timeout: 10000 });
    const deudaDice = async () => await barra.textContent('#admProveedores');
    if (!(await deudaDice()).includes('36.000'))
      throw new Error('no arranca con la deuda de la compra a cuenta: ' + await deudaDice());

    // Al mismo proveedor se le compra algo y se le paga en el acto. Eso NO es
    // un pago a cuenta: la deuda vieja tiene que quedar donde estaba.
    await barra.click('#btnNuevaCompra');
    await barra.waitForSelector('#dlgCompra[open]', { timeout: 5000 });
    await barra.fill('#inpCompraProv', 'Distribuidora Prueba');
    await barra.click('[data-condicion="contado"]');
    await barra.locator('[data-compra-u]').first().fill('1');
    await barra.locator('[data-compra-c]').first().fill('5000');
    await barra.click('#btnGuardarCompra');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgCompra')?.open, null, { timeout: 10000 });
    await barra.waitForTimeout(600);
    if (!(await deudaDice()).includes('36.000'))
      throw new Error('la compra al contado tocó la deuda a cuenta: ' + await deudaDice());

    // Un gasto con el proveedor apuntado sí es un pago: baja la deuda.
    await barra.click('#tabCaja');
    await barra.waitForSelector('#btnNuevoEgreso', { timeout: 10000 });
    await barra.click('#btnNuevoEgreso');
    await barra.waitForSelector('#dlgEgreso[open]', { timeout: 5000 });
    await barra.fill('#inpEgrConcepto', 'Pago a cuenta');
    await barra.fill('#inpEgrMonto', '10000');
    await barra.selectOption('#inpEgrCategoria', 'proveedor');
    const cual = await barra.$eval('#inpEgrProveedor', (sel) =>
      [...sel.options].find((o) => o.textContent.includes('Distribuidora Prueba'))?.value);
    if (!cual) throw new Error('el gasto no ofrece al proveedor');
    await barra.selectOption('#inpEgrProveedor', cual);
    await barra.click('#btnGuardarEgreso');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgEgreso')?.open, null, { timeout: 10000 });

    await barra.click('#tabCaja');
    await barra.waitForFunction(() =>
      document.querySelector('#admProveedores')?.textContent.includes('26.000'),
      null, { timeout: 10000 }).catch(async () => {
        throw new Error('el pago no bajó la deuda: ' + await deudaDice());
      });

    // Y la cuenta se puede abrir y leer movimiento por movimiento.
    await barra.locator('[data-ver-prov]').first().click();
    await barra.waitForSelector('#dlgProveedor[open]', { timeout: 5000 });
    const cuenta = await barra.textContent('#cuerpoProveedor');
    if (!cuenta.includes('se le debe')) throw new Error('no dice el saldo: ' + cuenta.slice(0, 200));
    if (!cuenta.includes('Mercadería')) throw new Error('no lista la compra a cuenta');
    if (!cuenta.includes('Pago a cuenta')) throw new Error('no lista el pago');
    if (cuenta.includes('5.000')) throw new Error('mete la compra al contado en la cuenta corriente');

    // El nombre se corrige desde ahí y los ingresos viejos lo siguen.
    await barra.fill('#inpNombreProv', 'Distribuidora Prueba SRL');
    await barra.click('#btnGuardarProveedor');
    await barra.waitForFunction(() =>
      document.querySelector('#admProveedores')?.textContent.includes('Distribuidora Prueba SRL'),
      null, { timeout: 10000 });
    if (dijo) throw new Error('el panel se quejó: ' + dijo);
  } finally {
    barra.removeListener('dialog', oir);
    await barra.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
});

await chequear('el precio se cambia en Administración, al lado de lo que deja', async () => {
  // Poner un precio sin ver el costo es apostar. Acá los dos números están
  // en la misma fila, y el margen se recalcula al guardar.
  await barra.click('#tabCaja');
  await barra.waitForSelector('#admCostos [data-precio]', { timeout: 15000 });

  const fila = barra.locator('#admCostos tr', { hasText: 'Fernet con coca' });
  const campo = fila.locator('[data-precio]');
  const antes = Number(await campo.inputValue());
  if (!antes) throw new Error('el producto no tiene precio para cambiar');

  await campo.fill(String(antes + 1000));
  await campo.blur();
  for (let i = 0; i < 40; i++) {
    const d = (await db.collection('carta').where('nombre', '==', 'Fernet con coca').get()).docs[0];
    if (Number(d.data().precio) === antes + 1000) break;
    if (i === 39) throw new Error('no guardó el precio: quedó en ' + d.data().precio);
    await new Promise((ok) => setTimeout(ok, 250));
  }

  // Y lo deja como estaba, para no ensuciarle la carta a los casos que siguen.
  await barra.waitForTimeout(500);
  await fila.locator('[data-precio]').fill(String(antes));
  await fila.locator('[data-precio]').blur();
  for (let i = 0; i < 40; i++) {
    const d = (await db.collection('carta').where('nombre', '==', 'Fernet con coca').get()).docs[0];
    if (Number(d.data().precio) === antes) break;
    if (i === 39) throw new Error('no pudo volver al precio original');
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

await chequear('la carta avisa cuándo un producto no sale del depósito', async () => {
  // Un producto sin receta se vende sin descontar ninguna botella. Eso no se
  // puede descubrir tres meses después mirando por qué no cierra el stock.
  await barra.click('#tabCartaBar');
  await barra.waitForSelector('#cartaBar .item', { timeout: 10000 });
  const dice = await barra.textContent('#cartaBar');
  if (!dice.includes('no salen del depósito'))
    throw new Error('no avisa que hay productos sueltos: ' + dice.slice(0, 250));
  if (!dice.includes('no sale del depósito'))
    throw new Error('no lo marca producto por producto');
  // Y el que sí tiene receta no aparece marcado.
  const conReceta = await barra.locator('#cartaBar .item', { hasText: 'Fernet con coca' }).textContent();
  if (conReceta.includes('no sale del depósito'))
    throw new Error('marca como suelto a uno que tiene receta');
});

// El caso de la noche del 16: Trumpeter y Catena con 6 y 3 botellas en el
// depósito salían agotados en el QR y la carta decía "sin material", que
// manda a comprar lo que ya está guardado. La receta apuntaba a un insumo
// que no estaba. Un cero tiene que decir cuál de las dos cosas es.
await chequear('una receta que apunta a un insumo que no está lo dice, y no "sin material"', async () => {
  const carta = await db.collection('carta').get();
  const victima = carta.docs.find((d) => (d.data().receta || []).length);
  if (!victima) throw new Error('no hay ningún producto con receta para romper');
  const antes = victima.data().receta;
  await victima.ref.update({ receta: [{ insumoId: 'insumo-que-no-existe', medidas: 1 }] });

  try {
    await barra.click('#tabCartaBar');
    await barra.waitForFunction(() =>
      document.querySelector('#cartaBar')?.textContent.includes('la receta apunta a un insumo que no está'),
      null, { timeout: 15000 })
      .catch(() => { throw new Error('no dice que la receta está rota'); });

    const t = await barra.textContent('#cartaBar');
    // Y no puede seguir diciendo lo otro: son dos arreglos distintos.
    const fila = await barra.locator('#cartaBar .item', { hasText: victima.data().nombre }).first().textContent();
    if (fila.includes('sin material en el depósito'))
      throw new Error('sigue diciendo "sin material", que manda a comprar de más');
    if (!t.includes('receta rota'))
      throw new Error('no lo avisa arriba, donde se ve sin buscar');
  } finally {
    await victima.ref.update({ receta: antes });
  }
});

await chequear('sin Caja no se muestra ningún saldo de proveedor', async () => {
  // El admin recortado no puede leer los gastos: las reglas se los niegan.
  // Sin los pagos, un saldo diría que se debe plata que ya se pagó. Antes
  // que un número falso, ninguno.
  // Otro caso le devuelve el permiso de Caja, así que este fija el suyo en vez
  // de confiar en cómo lo dejó el anterior.
  const suyo = (await db.collection('accesosBarra')
    .where('usuario', '==', 'recortado').get()).docs[0];
  if (!suyo) throw new Error('no está la cuenta recortada');
  await suyo.ref.update({ permisos: { caja: false } });

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await pg.fill('#inpMail', 'recortado');
    await pg.fill('#inpPass', 'clave-recortada');
    await pg.click('#btnEntrar');
    await pg.waitForSelector('#vistaPanel', { state: 'visible', timeout: 20000 });
    await pg.waitForFunction(() =>
      document.querySelector('#tabCaja')?.hidden === true, null, { timeout: 15000 });
    await pg.click('#tabDeposito');
    await pg.waitForSelector('#btnNuevoInsumo', { timeout: 15000 });
    await pg.waitForTimeout(1000);
    // El Depósito dice qué hay y nada más: ni saldos, ni costos, ni ingresos.
    const dice = (await pg.textContent('#deposito')).replace(/\s+/g, ' ');
    if (dice.includes('se debe') || dice.includes('ver cuenta'))
      throw new Error('el depósito le muestra saldos: ' + dice.slice(0, 300));
    if (dice.includes('Ingreso de mercadería'))
      throw new Error('el depósito le deja cargar mercadería');
    if (/\$\s?\d/.test(dice))
      throw new Error('el depósito le muestra plata: ' + dice.slice(0, 300));
  } finally {
    await ctx.close();
    // Se lo devuelve como estaba, para no romperle el caso al que sigue.
    await suyo.ref.update({ permisos: { caja: true } });
  }
});

await chequear('poner al día el depósito le abre la cuenta a cada proveedor', async () => {
  // La barra cargó la mercadería sin precio y sin proveedor para poder
  // vender. Esto lo completa después, de una sola vez, sin volver a sumar el
  // stock —que ya está contado— y abriendo la cuenta del proveedor.
  let dijo = '';
  const oir = async (d) => { dijo = d.message(); await d.accept(); };
  barra.on('dialog', oir);
  try {
    await barra.click('#tabDeposito');
    await barra.waitForSelector('#btnNuevoInsumo', { timeout: 10000 });

    // Un insumo como los carga la barra: nombre y poco más.
    await barra.click('#btnNuevoInsumo');
    await barra.waitForSelector('#dlgInsumo[open]', { timeout: 5000 });
    await barra.fill('#inpInsNombre', 'Gancia 950');
    await barra.fill('#inpInsUnidad', 'botella');
    await barra.fill('#inpInsMedidas', '5');
    await barra.fill('#inpInsCosto', '');
    await barra.click('#btnGuardarInsumo');
    await barra.waitForFunction(() =>
      document.querySelector('#deposito')?.textContent.includes('Gancia 950'),
      null, { timeout: 10000 });

    // El panel avisa que falta y ofrece completarlo.
    await barra.click('#tabCaja');
    await barra.waitForSelector('#btnAlDia', { timeout: 10000 });
    await barra.click('#btnAlDia');
    await barra.waitForSelector('#dlgAlDia[open]', { timeout: 5000 });

    const fila = barra.locator('#cuerpoAlDia .item', { hasText: 'Gancia 950' });
    await fila.locator('[data-ald-prov]').fill('Bebidas del Sur');
    await fila.locator('[data-ald-costo]').fill('9000');
    await fila.locator('[data-ald-uni]').fill('2');
    await barra.click('#btnGuardarAlDia');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgAlDia')?.open, null, { timeout: 10000 });

    // La deuda quedó abierta con ese proveedor…
    await barra.waitForFunction(() =>
      document.querySelector('#admProveedores')?.textContent.includes('Bebidas del Sur'),
      null, { timeout: 10000 });
    const dice = await barra.textContent('#vistaCaja');
    if (!dice.includes('18.000')) throw new Error('no abrió la deuda: ' + dice.slice(0, 300));
    if (!dice.includes('sin sumar stock'))
      throw new Error('no avisa que el ingreso no sumó stock');

    // …y el stock sigue donde estaba: la mercadería ya estaba contada.
    const g = (await db.collection('insumos').where('nombre', '==', 'Gancia 950').get()).docs[0];
    if (Number(g.data().stock) !== 0)
      throw new Error('volvió a sumar stock: quedó en ' + g.data().stock);
    if (Number(g.data().costo) !== 9000)
      throw new Error('no le guardó el precio al insumo');
    if (!g.data().proveedorId) throw new Error('no le guardó el proveedor al insumo');

    // Y la cuenta del proveedor nuevo se puede abrir.
    await barra.locator('#admProveedores tr', { hasText: 'Bebidas del Sur' }).click();
    await barra.waitForSelector('#dlgProveedor[open]', { timeout: 5000 });
    if (!(await barra.textContent('#cuerpoProveedor')).includes('se le debe'))
      throw new Error('la cuenta del proveedor nuevo no muestra el saldo');
    await barra.click('#btnGuardarProveedor');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgProveedor')?.open, null, { timeout: 5000 });

    // La otra mitad: cuando el depósito arranca de cero, la misma pantalla
    // tiene que cargar el stock en vez de dejarlo como está.
    await barra.click('#btnAlDia');
    await barra.waitForSelector('#dlgAlDia[open]', { timeout: 5000 });
    await barra.click('[data-ald-stock="cargar"]');
    const otra = barra.locator('#cuerpoAlDia .item', { hasText: 'Gancia 950' });
    await otra.locator('[data-ald-prov]').fill('Bebidas del Sur');
    await otra.locator('[data-ald-costo]').fill('9000');
    await otra.locator('[data-ald-uni]').fill('3');
    await barra.click('#btnGuardarAlDia');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgAlDia')?.open, null, { timeout: 10000 });
    for (let i = 0; i < 40; i++) {
      const d = (await db.collection('insumos').where('nombre', '==', 'Gancia 950').get()).docs[0];
      if (Number(d.data().stock) === 15) break;
      if (i === 39) throw new Error('no cargó el stock: quedó en ' + d.data().stock);
      await new Promise((ok) => setTimeout(ok, 250));
    }
    if (dijo) throw new Error('el panel se quejó: ' + dijo);
  } finally {
    barra.removeListener('dialog', oir);
    await barra.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
});

await chequear('la venta deja la carta al día en la misma operación', async () => {
  // Lo que importa no es solo que el número baje: es que `disponible` quede
  // escrito por la misma operación que movió el stock, sin que nadie tenga
  // que tener una pantalla abierta mirando.
  const fernet = (await db.collection('carta').where('nombre', '==', 'Fernet con coca').get()).docs[0];
  const insumo = (await db.collection('insumos').where('nombre', '==', 'Fernet 750').get()).docs[0];
  if (!fernet || !insumo) throw new Error('falta el producto con receta o su insumo');

  // Una sola medida en el depósito: alcanza para un trago y nada más.
  await insumo.ref.update({ stock: 1 });
  for (let i = 0; i < 60; i++) {
    const d = await fernet.ref.get();
    if (Number(d.data().stock) === 1 && d.data().disponible !== false) break;
    if (i === 59) throw new Error('no quedó en 1 disponible: ' + JSON.stringify((await fernet.ref.get()).data()));
    await new Promise((ok) => setTimeout(ok, 250));
  }

  // Se vende el último: el depósito queda en cero y el producto se apaga
  // solo, en la misma operación.
  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.locator('#cuerpoVenta .item', { hasText: 'Fernet con coca' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');

  for (let i = 0; i < 60; i++) {
    const d = (await fernet.ref.get()).data();
    if (Number(d.stock) === 0 && d.disponible === false) break;
    if (i === 59) {
      throw new Error('no se apagó solo: ' + JSON.stringify({ stock: d.stock, disponible: d.disponible }));
    }
    await new Promise((ok) => setTimeout(ok, 250));
  }

  // Y el cliente lo ve agotado, sin que nadie lo marque.
  await cliente.waitForFunction(() => {
    const f = [...document.querySelectorAll('#carta .item')]
      .find((x) => x.textContent.includes('Fernet con coca'));
    return f && f.className.includes('agotado');
  }, null, { timeout: 15000 });
});

await chequear('apagado a mano le gana al depósito', async () => {
  // Se rompió la botella: el depósito dice que hay, pero no hay. La marca
  // tiene que aguantar aunque entre mercadería después.
  const fernet = (await db.collection('carta').where('nombre', '==', 'Fernet con coca').get()).docs[0];
  const insumo = (await db.collection('insumos').where('nombre', '==', 'Fernet 750').get()).docs[0];

  await barra.click('#tabCartaBar');
  const fila = barra.locator('#cartaBar .item', { hasText: 'Fernet con coca' });
  await barra.waitForFunction(() =>
    [...document.querySelectorAll('#cartaBar .item')]
      .some((x) => x.textContent.includes('Fernet con coca')), null, { timeout: 10000 });

  // Con el depósito en cero el botón ofrece reactivar; se carga stock para
  // que ofrezca apagarlo a mano.
  await insumo.ref.update({ stock: 50 });
  await barra.waitForFunction(() =>
    (document.querySelector('#cartaBar')?.textContent || '').includes('Agotar a mano'),
    null, { timeout: 15000 });

  await fila.locator('[data-toggle]').click();
  for (let i = 0; i < 40; i++) {
    const d = (await fernet.ref.get()).data();
    if (d.apagadoAMano === true && d.disponible === false) break;
    if (i === 39) throw new Error('no quedó apagado a mano: ' + JSON.stringify(d));
    await new Promise((ok) => setTimeout(ok, 250));
  }

  // Entra mercadería: el cálculo NO lo puede encender.
  await insumo.ref.update({ stock: 80 });
  await barra.waitForTimeout(2500);
  const d = (await fernet.ref.get()).data();
  if (d.disponible !== false) throw new Error('el depósito le ganó a la marca a mano');
  if (d.apagadoAMano !== true) throw new Error('se borró la marca sola');

  // Y se suelta desde el mismo botón.
  await fila.locator('[data-toggle]').click();
  for (let i = 0; i < 40; i++) {
    const x = (await fernet.ref.get()).data();
    if (x.apagadoAMano === false && x.disponible === true) break;
    if (i === 39) throw new Error('no se soltó: ' + JSON.stringify(x));
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

await chequear('la carta se queda sin stock sola cuando el depósito se vacía', async () => {
  // Lo que el cliente ve no puede depender de que alguien se acuerde de tocar
  // "Agotar": si no hay fernet en el depósito, el fernet con coca no se puede
  // pedir. El número del producto lo escribe el panel, calculado del depósito,
  // porque el cliente no puede leer el depósito —ahí están los costos.
  const cartaDe = async (nombre) => {
    const q = await db.collection('carta').where('nombre', '==', nombre).get();
    return q.docs[0];
  };
  const fernet = await cartaDe('Fernet con coca');
  if (!fernet) throw new Error('no está el producto con receta');
  const insumo = (await db.collection('insumos').where('nombre', '==', 'Fernet 750').get()).docs[0];
  if (!insumo) throw new Error('no está el insumo');

  const esperarStock = async (cuanto) => {
    for (let i = 0; i < 60; i++) {
      const d = await fernet.ref.get();
      if (Number(d.data().stock) === cuanto) return;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    const d = await fernet.ref.get();
    throw new Error(`el producto quedó en ${d.data().stock} y tenía que quedar en ${cuanto}`);
  };

  // Seis medidas en el depósito, un trago lleva una: salen seis.
  await insumo.ref.update({ stock: 6 });
  await esperarStock(6);

  // Se vacía: el cliente tiene que verlo sin stock, sin que nadie lo marque.
  await insumo.ref.update({ stock: 0 });
  await esperarStock(0);
  await cliente.waitForFunction(() => {
    const f = [...document.querySelectorAll('#carta .item')]
      .find((x) => x.textContent.includes('Fernet con coca'));
    return f && f.className.includes('agotado');
  }, null, { timeout: 20000 }).catch(() => {
    throw new Error('el cliente lo sigue viendo disponible con el depósito en cero');
  });

  // Entra mercadería: vuelve solo, sin tocar nada en la carta.
  await insumo.ref.update({ stock: 30 });
  await esperarStock(30);
  await cliente.waitForFunction(() => {
    const f = [...document.querySelectorAll('#carta .item')]
      .find((x) => x.textContent.includes('Fernet con coca'));
    return f && !f.className.includes('agotado');
  }, null, { timeout: 20000 }).catch(() => {
    throw new Error('no volvió a la carta al reponer el depósito');
  });
});

await chequear('un insumo cargado por error se da de baja, con el motivo', async () => {
  // Pasó de verdad: cargaron mal un insumo y no había forma de sacarlo.
  await barra.click('#tabDeposito');
  await barra.waitForSelector('#btnNuevoInsumo', { timeout: 10000 });
  await barra.click('#btnNuevoInsumo');
  await barra.waitForSelector('#dlgInsumo[open]', { timeout: 5000 });
  await barra.fill('#inpInsNombre', 'Cargado por error');
  await barra.fill('#inpInsUnidad', 'botella');
  await barra.fill('#inpInsMedidas', '1');
  await barra.fill('#inpInsCosto', '1');
  await barra.click('#btnGuardarInsumo');
  await barra.waitForFunction(() =>
    document.querySelector('#deposito')?.textContent.includes('Cargado por error'),
    null, { timeout: 10000 });

  const fila = barra.locator('#deposito .item', { hasText: 'Cargado por error' });
  await fila.locator('[data-baja-insumo]').click();
  await barra.waitForSelector('#dlgBaja[open]', { timeout: 5000 });

  // Sin motivo no se puede: es lo único que queda después.
  await barra.click('#btnConfirmarBaja');
  await barra.waitForFunction(() =>
    !document.querySelector('#errorBaja')?.classList.contains('oculto'), null, { timeout: 5000 });
  if (!(await barra.textContent('#deposito')).includes('Cargado por error'))
    throw new Error('lo borró sin motivo');

  await barra.fill('#inpMotivoBaja', 'me equivoqué al cargarlo');
  await barra.click('#btnConfirmarBaja');
  await barra.waitForFunction(() =>
    !document.querySelector('#deposito')?.textContent.includes('Cargado por error'),
    null, { timeout: 10000 }).catch(async () => {
      throw new Error('no se fue del depósito: '
        + (await barra.textContent('#errorBaja')).slice(0, 160));
    });

  // Y queda el por qué, con quién lo hizo.
  let b;
  for (let i = 0; i < 40; i++) {
    const q = await db.collection('bajas').where('nombre', '==', 'Cargado por error').get();
    b = q.docs[0]?.data();
    if (b) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!b) throw new Error('no quedó registrada la baja');
  if (b.motivo !== 'me equivoqué al cargarlo') throw new Error('guardó otro motivo: ' + b.motivo);
  if (!b.quien) throw new Error('no dice quién la dio de baja');
});

await chequear('un insumo del que sale un trago NO se puede dar de baja', async () => {
  // Borrarlo dejaría al trago sin de dónde salir, y se agotaría solo sin que
  // nadie entienda por qué. Se frena con el nombre del producto.
  const fila = barra.locator('#deposito .item', { hasText: 'Fernet 750' });
  await fila.locator('[data-baja-insumo]').click();
  await barra.waitForSelector('#dlgBaja[open]', { timeout: 5000 });
  if (!(await barra.textContent('#queSeDaDeBaja')).includes('Fernet con coca'))
    throw new Error('no avisa qué producto depende de él');
  await barra.fill('#inpMotivoBaja', 'probando');
  await barra.click('#btnConfirmarBaja');
  await barra.waitForFunction(() =>
    !document.querySelector('#errorBaja')?.classList.contains('oculto'), null, { timeout: 5000 });
  if (!(await barra.textContent('#errorBajaTexto')).includes('Fernet con coca'))
    throw new Error('el error no dice de qué receta sacarlo');
  await barra.click('#btnCancelarBaja');
  if (!(await barra.textContent('#deposito')).includes('Fernet 750'))
    throw new Error('lo borró igual');
});

await chequear('el administrador carga el depósito con su cuenta, de punta a punta', async () => {
  // El depósito real no lo carga el dueño: lo carga un administrador, parado
  // en la barra, con su usuario y contraseña. Hasta acá todo el depósito se
  // probaba con la cuenta de la casa, que resuelve por mail y no pasa por
  // accesosBarra. Si el alta no anda con cuenta de administrador, la carga
  // inicial no la puede hacer nadie más que el dueño.
  await barra.click('#tabUsuarios');
  await barra.waitForSelector('#btnAltaAdmin', { timeout: 10000 });
  barra.on('dialog', async (d) => d.accept());
  try {
    await barra.click('#btnAltaAdmin');
    await barra.waitForSelector('#dlgPersona[open]', { timeout: 10000 });
    await barra.fill('#inpPersonaUsuario', 'guille');
    await barra.fill('#inpPersonaClave', 'clave-del-gerente');
    await barra.click('#btnConfirmarPersona');
    await barra.waitForFunction(() =>
      document.querySelector('#usuarios')?.textContent.includes('guille'),
      null, { timeout: 15000 });
  } finally { barra.removeAllListeners('dialog'); }

  const ctxGer = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const ger = await ctxGer.newPage();
  let seQuejoGer = '';
  ger.on('dialog', async (d) => { seQuejoGer = d.message(); await d.accept(); });
  try {
    await ger.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await ger.fill('#inpMail', 'guille');
    await ger.fill('#inpPass', 'clave-del-gerente');
    await ger.click('#btnEntrar');
    await ger.waitForSelector('#vistaPanel', { state: 'visible', timeout: 20000 });

    // Sin turno asignado y sin ser el dueño, igual ve el depósito: la cuenta
    // de administrador no depende del evento.
    await ger.waitForFunction(() =>
      document.querySelector('#tabDeposito') &&
      !document.querySelector('#tabDeposito').hidden, null, { timeout: 15000 })
      .catch(() => { throw new Error('el administrador no ve la pestaña Depósito'); });

    await ger.click('#tabDeposito');
    await ger.waitForSelector('#btnNuevoInsumo', { timeout: 10000 });
    await ger.click('#btnNuevoInsumo');
    await ger.waitForSelector('#dlgInsumo[open]', { timeout: 5000 });
    await ger.fill('#inpInsNombre', 'Gancia 1L');
    await ger.fill('#inpInsUnidad', 'botella');
    await ger.fill('#inpInsMedidas', '8');
    await ger.fill('#inpInsCosto', '9000');
    await ger.click('#btnGuardarInsumo');
    await ger.waitForFunction(() =>
      document.querySelector('#deposito')?.textContent.includes('Gancia 1L'),
      null, { timeout: 15000 }).catch(() => {
        throw new Error('el administrador no pudo dar de alta el insumo'
          + (seQuejoGer ? ` · el panel dijo: "${seQuejoGer}"` : ''));
      });

    // Y queda en la base de verdad, no solo pintado en la pantalla.
    let guardado = null;
    for (let i = 0; i < 40; i++) {
      const q = await db.collection('insumos').where('nombre', '==', 'Gancia 1L').get();
      guardado = q.docs[0]?.data();
      if (guardado) break;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    if (!guardado) throw new Error('el insumo no llegó a la base');
    if (Number(guardado.medidas) !== 8)
      throw new Error('guardó mal las medidas: ' + guardado.medidas);
  } finally { await ctxGer.close(); }
});

await chequear('el celular de la barra ve el depósito, pero solo de mirar', async () => {
  // Necesita saber qué hay para no prometer un trago que no se puede hacer.
  // Pero es el aparato que vive prendido arriba del mostrador y sin clave: no
  // da de alta mercadería, no carga compras y no ve plata.
  const ctxCel = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const cel = await ctxCel.newPage();
  try {
    await cel.goto(`${BASE}/bar.html`, { waitUntil: 'domcontentloaded' });
    await cel.fill('#inpMail', 'barra');
    await cel.fill('#inpPass', 'clave-del-aparato');
    await cel.click('#btnEntrar');
    await cel.waitForSelector('#vistaPanel', { state: 'visible', timeout: 20000 });

    await cel.waitForFunction(() =>
      document.querySelector('#tabDeposito')?.hidden === false, null, { timeout: 15000 })
      .catch(() => { throw new Error('el celular de la barra no ve la pestaña Depósito'); });
    await cel.click('#tabDeposito');
    await cel.waitForFunction(() =>
      document.querySelector('#deposito')?.textContent.includes('Fernet 750'),
      null, { timeout: 15000 }).catch(async () => {
        throw new Error('no ve lo que hay guardado: '
          + (await cel.textContent('#deposito')).slice(0, 200));
      });

    // Nada de lo que no puede hacer.
    for (const q of ['#btnNuevoInsumo', '#btnNuevaCompra', '[data-editar-insumo]',
                     '[data-baja-insumo]', '[data-borrar-compra]'])
      if (await cel.locator(q).count()) throw new Error('le muestra ' + q);
    const dice = await cel.textContent('#deposito');
    if (dice.includes('se debe')) throw new Error('le muestra la deuda');
    if (/12\.000|\bc\/u\b/.test(dice)) throw new Error('le muestra lo que costó: ' + dice.slice(0, 200));

    // Y la caja sigue sin ser suya.
    if (await cel.locator('#tabCaja').isVisible())
      throw new Error('el celular de la barra ve la caja');
  } finally { await ctxCel.close(); }
});

await chequear('la caja junta lo que entra y lo que sale', async () => {
  await barra.click('#tabCaja');
  await barra.waitForSelector('#caja .caja-evento', { timeout: 10000 });
  // Por defecto mira el mes: tiene que haber plata de las ventas de la corrida.
  const antes = await barra.textContent('#caja');
  if (!antes.includes('entró')) throw new Error('no muestra lo que entró');
  if (!antes.includes('En el cajón debería haber'))
    throw new Error('no dice cuánto efectivo debería haber');
  if (!antes.includes('Efectivo') || !antes.includes('Virtual'))
    throw new Error('no parte la plata por forma de pago');
});

await chequear('un gasto baja la caja y el efectivo del cajón', async () => {
  const enCajon = () => barra.evaluate(() =>
    Number((document.querySelector('#caja .interruptor b')?.textContent || '')
      .replace(/\D/g, '')));
  const antes = await enCajon();

  await barra.click('#btnNuevoEgreso');
  await barra.waitForSelector('#dlgEgreso[open]', { timeout: 5000 });
  await barra.fill('#inpEgrConcepto', 'Hielo de la noche');
  await barra.fill('#inpEgrMonto', '3000');
  await barra.selectOption('#inpEgrCategoria', 'insumo');
  await barra.click('#btnGuardarEgreso');

  await barra.waitForFunction(() =>
    document.querySelector('#caja')?.textContent.includes('Hielo de la noche'),
    null, { timeout: 10000 });
  const despues = await enCajon();
  if (despues !== antes - 3000)
    throw new Error(`el efectivo del cajón no bajó: ${antes} -> ${despues}`);

  // Y queda en la base con quién lo cargó. Se busca por concepto y se espera:
  // la pantalla lo muestra apenas se escribe local, y el servidor confirma
  // un instante después.
  let e;
  for (let i = 0; i < 40; i++) {
    const q = await db.collection('egresos').where('concepto', '==', 'Hielo de la noche').get();
    e = q.docs[0]?.data();
    if (e) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!e || e.monto !== 3000) throw new Error('no se guardó el gasto: ' + JSON.stringify(e));
  if (e.pago !== 'efectivo') throw new Error('no guardó cómo se pagó');
  if (!e.cargadoPor) throw new Error('no dice quién lo cargó');
});

await chequear('la caja dice quién vendió', async () => {
  const t = await barra.textContent('#caja');
  if (!t.includes('Quién vendió')) throw new Error('no muestra el ranking por barman');
});

await chequear('un entregado por error se puede corregir', async () => {
  // Sin esto la caja queda mal para siempre: entregado no tenía vuelta atrás.
  await barra.click('#tabTablero');
  const antes = await barra.textContent('#chipCaja');
  await barra.waitForSelector('.ticket.entregado [data-corregir]', { timeout: 10000 });
  barra.once('dialog', (d) => d.accept('1'));
  await barra.locator('.ticket.entregado [data-corregir]').first().click();
  await barra.waitForFunction((t) =>
    document.querySelector('#chipCaja')?.textContent !== t, antes, { timeout: 10000 });
});

await chequear('cerrado el evento, el cliente ve la carta pero no puede pedir', async () => {
  const ctxTarde = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const tarde = await ctxTarde.newPage();
  try {
    // Mismo QR de la mesa, el de siempre: lo que cambió es el permiso.
    await tarde.goto(`${BASE}`, { waitUntil: 'domcontentloaded' });
    await tarde.waitForSelector('text=Fernet con coca', { timeout: 15000 });
    await tarde.waitForFunction(() =>
      !document.querySelector('#avisoCerrado')?.classList.contains('oculto'),
      null, { timeout: 10000 });

    // Suma al carrito (el Fernet lo dejó agotado un test anterior, uso otro):
    // la barra de Pedir no tiene que aparecer.
    const fila = tarde.locator('.item', { hasText: 'Papas bravas' });
    if (!(await fila.count())) throw new Error('no veo Papas bravas. Carta: ' + (await tarde.textContent('#carta')).slice(0, 300));
    if (!(await fila.locator('[data-mas]').count()))
      throw new Error('Papas sin botón de sumar: ' + (await fila.textContent()));
    await fila.locator('[data-mas]').click();
    await tarde.waitForTimeout(800);
    if (await tarde.locator('#carrito.visible').count())
      throw new Error('deja pedir con el evento cerrado');

    // Y lo que importa: aunque se saltee la pantalla, las reglas lo rechazan.
    const rechazado = await tarde.evaluate(async () => {
      const { getFirestore, collection, addDoc, serverTimestamp, getAuth } =
        await import('/vendor/firebase.js');
      try {
        await addDoc(collection(getFirestore(), 'pedidos'), {
          clienteId: getAuth().currentUser.uid, estado: 'nuevo',
          items: [{ id: 'papas', nombre: 'Papas bravas', precio: 5500, cantidad: 1 }],
          total: 5500, mesa: '7', creadoEn: serverTimestamp(),
        });
        return null;
      } catch (e) { return e.code || e.message; }
    });
    if (rechazado !== 'permission-denied')
      throw new Error('las reglas lo dejaron pasar: ' + rechazado);
  } finally { await ctxTarde.close(); }
});

await chequear('reabrir vuelve a habilitar los pedidos', async () => {
  await barra.click('#tabEvento');
  await barra.waitForSelector('#btnTomando', { timeout: 10000 });
  await barra.click('#btnTomando');
  await barra.waitForFunction(() =>
    document.querySelector('#btnTomando')?.textContent.includes('Cortar'), null, { timeout: 10000 });
  const d = await (await import('node:timers/promises')).setTimeout(500)
    .then(() => db.doc('publico/estado').get());
  if (d.data()?.tomandoPedidos !== true) throw new Error('no reabrió');
});

await barra.click('#tabTablero');

// El registro ahora es uno por noche: registros/<id del evento>.
const idDeNoche = async (nombre) => {
  const q = await db.collection('barra/eventos/items').where('nombre', '==', nombre).get();
  return q.docs[0]?.id;
};
const registroDe = async (nombre) => {
  const id = await idDeNoche(nombre);
  return id ? (await db.doc(`registros/${id}`).get()).data() : null;
};

console.log('\nINVITADOS: registro, pase y puerta');
let tokenInvitado = null;

await chequear('el admin abre un evento con cupo y eso abre el registro', async () => {
  await barra.click('#tabCalendario');
  await barra.waitForSelector('#btnAgendar', { timeout: 10000 });
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'Noche con lista');
  await barra.fill('#inpCapacidad', '2');
  await barra.click('#btnConfirmarEvento');
  // El registro abre al agendar: la gracia es que se anoten antes de la noche,
  // así que el link tiene que estar a mano sin arrancarla.
  await barra.waitForSelector('[data-empezar]', { timeout: 10000 });
  await barra.waitForSelector('[data-invitar]', { timeout: 10000 });
  const fila = await barra.locator('#calendario .item', { hasText: 'Noche con lista' })
    .first().textContent();
  if (!fila.includes('cupo 2')) throw new Error('la agenda no muestra el cupo: ' + fila);
  // Abrir el evento son varias escrituras; la del registro puede llegar
  // un instante después de que la tarjeta ya se dibujó.
  let r;
  for (let i = 0; i < 40; i++) {
    r = await registroDe('Noche con lista');
    if (r?.abierto === true) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (r?.abierto !== true) throw new Error('no abrió el registro de esa noche');
  if (r?.capacidad !== 2) throw new Error('no guardó el cupo: ' + r?.capacidad);
  // Y el link viejo, el que no dice de qué noche es, apunta a ella.
  const suId = await idDeNoche('Noche con lista');
  let puntero;
  for (let i = 0; i < 40; i++) {
    puntero = (await db.doc('publico/registro').get()).data();
    if (puntero?.eventoId === suId) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (puntero?.eventoId !== suId)
    throw new Error(`el puntero no quedó en esta noche: ${JSON.stringify(puntero)} vs ${suId}`);
});

await chequear('las invitaciones traen el link y el QR de la noche', async () => {
  await barra.locator('#calendario .item', { hasText: 'Noche con lista' })
    .first().locator('[data-invitar]').click();
  await barra.waitForSelector('#dlgInvitar[open]', { timeout: 10000 });
  await barra.waitForSelector('#dlgInvitar .qr', { timeout: 10000 });
  const idNoche = await idDeNoche('Noche con lista');
  const texto = await barra.textContent('#dlgInvitar');
  if (!texto.includes(`/registro.html?ev=${idNoche}`))
    throw new Error('el link no lleva la noche adentro: ' + texto);
  if (!texto.includes('0 de 2 anotados')) throw new Error('no muestra el contador: ' + texto);

  // Un QR con el logo encima que no se lee no sirve: se decodifica de verdad.
  const src = await barra.getAttribute('#dlgInvitar .qr', 'src');
  const { PNG } = await import('pngjs');
  const jsQR = (await import('jsqr')).default;
  const img = PNG.sync.read(Buffer.from(src.split(',')[1], 'base64'));
  const leido = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  if (leido?.data !== `${BASE}/registro.html?ev=${idNoche}`)
    throw new Error('el QR dice: ' + leido?.data);
  await barra.click('#btnCerrarInvitar');
});

await chequear('una noche nueva NO se roba el link de la anterior', async () => {
  const dePrimera = await idDeNoche('Noche con lista');

  // Esto es lo que pasaba antes: al crear la segunda noche, el QR de la
  // primera empezaba a llevar a la segunda. Ahora cada una tiene el suyo.
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'La noche siguiente');
  await barra.fill('#inpCapacidad', '3');
  await barra.click('#btnConfirmarEvento');
  await barra.waitForFunction(() =>
    document.querySelector('#calendario')?.textContent.includes('La noche siguiente'),
    null, { timeout: 10000 });
  const deSegunda = await idDeNoche('La noche siguiente');

  // Cada registro con su cupo y su cuenta, sin pisarse.
  let uno, dos;
  for (let i = 0; i < 40; i++) {
    uno = await registroDe('Noche con lista');
    dos = await registroDe('La noche siguiente');
    if (uno?.abierto && dos?.abierto) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!uno?.abierto || !dos?.abierto) throw new Error('alguna de las dos no quedó abierta');
  if (uno.capacidad !== 2 || dos.capacidad !== 3) throw new Error('se mezclaron los cupos');

  // Y el QR de la primera sigue siendo el de la primera.
  await barra.locator('#calendario .item', { hasText: 'Noche con lista' })
    .first().locator('[data-invitar]').click();
  await barra.waitForSelector('#dlgInvitar[open]', { timeout: 10000 });
  await barra.waitForSelector('#dlgInvitar .qr', { timeout: 10000 });
  const dice = await barra.textContent('#dlgInvitar');
  if (!dice.includes(`?ev=${dePrimera}`) || dice.includes(`?ev=${deSegunda}`))
    throw new Error('el link de la primera cambió: ' + dice);
  await barra.click('#btnCerrarInvitar');

  // La noche de prueba se saca para no dejarla dando vueltas en la agenda.
  barra.once('dialog', (d) => d.accept());
  await barra.locator('#calendario .item', { hasText: 'La noche siguiente' })
    .first().locator('[data-quitar]').click();
  await barra.waitForFunction(() =>
    !document.querySelector('#calendario')?.textContent.includes('La noche siguiente'),
    null, { timeout: 10000 });

  // Y sacarla de la agenda no toca el registro de la otra.
  const sigue = await registroDe('Noche con lista');
  if (!sigue?.abierto) throw new Error('le cerró el registro a la primera');
});

const ctxInv = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const invitado = await ctxInv.newPage();
invitado.on('pageerror', (e) => errores.push('invitado: ' + e.message));

await chequear('un invitado se registra sin cuenta y recibe su pase con QR', async () => {
  await invitado.goto(`${BASE}/registro.html`, { waitUntil: 'domcontentloaded' });
  await invitado.waitForSelector('#formRegistro', { timeout: 15000 });
  if (!(await invitado.textContent('#pantalla')).includes('Noche con lista'))
    throw new Error('no muestra de qué noche se trata');
  await invitado.fill('#inpNombre', 'Ana Prueba');
  await invitado.fill('#inpTel', '11 5555 0000');
  await invitado.click('#btnRegistrar');

  await invitado.waitForSelector('.lienzo-pase .qr', { timeout: 15000 });
  if (!(await invitado.textContent('.lienzo-pase')).includes('Ana Prueba'))
    throw new Error('el pase no dice de quién es');
  tokenInvitado = new URL(invitado.url()).searchParams.get('i');
  if (!tokenInvitado || tokenInvitado.length < 16) throw new Error('token flojo: ' + tokenInvitado);

  // El contador de ESA noche tiene que haber subido: es lo que cierra el cupo.
  const r = await registroDe('Noche con lista');
  if (r?.registrados !== 1) throw new Error('no contó el registro: ' + r?.registrados);
});

await chequear('el QR del pase codifica su token', async () => {
  const src = await invitado.getAttribute('.lienzo-pase .qr', 'src');
  const png = Buffer.from(src.split(',')[1], 'base64');
  const { PNG } = await import('pngjs');
  const jsQR = (await import('jsqr')).default;
  const img = PNG.sync.read(png);
  const leido = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  if (leido?.data !== tokenInvitado) throw new Error('el QR dice: ' + leido?.data);
});

await chequear('el teléfono se escribe de una sola manera: sin 0 y sin 15', async () => {
  const ctxTel = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctxTel.newPage();
  try {
    await pg.goto(`${BASE}/registro.html`, { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#formRegistro', { timeout: 15000 });
    if (!(await pg.textContent('#pistaTel')).includes('sin 0 y sin 15'))
      throw new Error('no explica cómo se escribe');

    await pg.fill('#inpNombre', 'Cero Adelante');
    await pg.fill('#inpTel', '03454189066');
    // Lo que entra es solo número, y recortado a diez.
    const loQueQueda = await pg.inputValue('#inpTel');
    if (/[^0-9 ]/.test(loQueQueda)) throw new Error('dejó escribir otra cosa: ' + loQueQueda);
    if (!(await pg.textContent('#pistaTel')).includes('Sacale el 0'))
      throw new Error('no avisa del 0: ' + (await pg.textContent('#pistaTel')));

    await pg.click('#btnRegistrar');
    await pg.waitForFunction(() =>
      !document.querySelector('#error')?.classList.contains('oculto'), null, { timeout: 10000 });
    if (!(await pg.textContent('#errorTexto')).includes('Sacale el 0'))
      throw new Error('lo dejó pasar igual');
    if (pg.url().includes('pase.html')) throw new Error('lo anotó con el 0');

    // Y bien escrito, la pista lo confirma antes de tocar el botón.
    await pg.fill('#inpTel', '3454189066');
    if (!(await pg.textContent('#pistaTel')).includes('bien'))
      throw new Error('no confirma el formato bueno');
  } finally { await ctxTel.close(); }
});

await chequear('dos personas se anotan al mismo tiempo y entran las dos', async () => {
  // Es lo que pasa justo cuando se comparte el link: todos a la vez. El
  // contador sube de a uno y las reglas exigen el numero exacto, asi que sin
  // reintento el segundo rebota aunque haya lugar.
  await barra.click('#tabCalendario');
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'Noche de la avalancha');
  await barra.fill('#inpCapacidad', '5');
  // Con entrada paga: lo que sale entrar tiene que llegar hasta el invitado,
  // que solo puede leer el registro de la noche y nunca el evento.
  await barra.fill('#inpEntrada', '3500');
  await barra.click('#btnConfirmarEvento');
  const idAval = await (async () => {
    for (let i = 0; i < 40; i++) {
      const x = await idDeNoche('Noche de la avalancha');
      if (x) return x;
      await new Promise((ok) => setTimeout(ok, 250));
    }
  })();
  if (!idAval) throw new Error('no se agendó la noche de prueba');
  // El registro de esa noche es una escritura aparte: hasta que no está, la
  // página del invitado no tiene qué mostrar.
  for (let i = 0; i < 40; i++) {
    if ((await db.doc(`registros/${idAval}`).get()).exists) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!(await db.doc(`registros/${idAval}`).get()).exists)
    throw new Error('la noche quedó sin registro: el link no lleva a ningún lado');

  const dos = await Promise.all([1, 2].map(async (n) => {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/registro.html?ev=${idAval}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#formRegistro', { timeout: 15000 }).catch(async () => {
      throw new Error('la página del invitado no mostró el formulario. Dice: '
        + (await pg.textContent('#pantalla')).trim().slice(0, 160));
    });
    // Lo que cuesta se dice antes de pedirle los datos, no en la puerta.
    const dice = await pg.textContent('#pantalla');
    if (!dice.includes('3.500'))
      throw new Error('no avisa lo que sale la entrada: ' + dice.slice(0, 200));
    // Y para qué día es, que es lo primero que mira el que recibe el link.
    if (!/lunes|martes|miércoles|jueves|viernes|sábado|domingo/i.test(dice))
      throw new Error('la invitación no dice qué día es: ' + dice.slice(0, 200));
    await pg.fill('#inpNombre', `Simultaneo ${n}`);
    await pg.fill('#inpTel', `11555566${n}${n}`);
    return { ctx, pg };
  }));
  // Los dos botones, al mismo tiempo.
  await Promise.all(dos.map(({ pg }) => pg.click('#btnRegistrar')));
  try {
    for (const { pg } of dos) {
      await pg.waitForURL(/pase\.html/, { timeout: 20000 }).catch(() => {});
    }
    const anotados = await db.collection('invitados').where('eventoId', '==', idAval).get();
    if (anotados.size !== 2)
      throw new Error(`entraron ${anotados.size} de 2: el segundo rebotó por la carrera`);
    // Y el pase también lo dice: es lo que la persona mira en la puerta.
    await dos[0].pg.waitForFunction(() =>
      document.querySelector('#pase')?.textContent.includes('3.500'),
      null, { timeout: 20000 }).catch(async () => {
        throw new Error('el pase no dice lo que hay que pagar: '
          + (await dos[0].pg.textContent('#pase')).slice(0, 200));
      });
    const reg = (await db.doc(`registros/${idAval}`).get()).data();
    if (Number(reg.registrados) !== 2)
      throw new Error('el contador no cuadra: ' + reg.registrados);
  } finally { await Promise.all(dos.map(({ ctx }) => ctx.close())); }
});

await chequear('con el cupo justo, el que llega segundo no entra', async () => {
  const idAval = await idDeNoche('Noche de la avalancha');
  // Se deja un solo lugar: 5 de capacidad, 4 tomados.
  await db.doc(`registros/${idAval}`).update({ registrados: 4 });

  const dos = await Promise.all([3, 4].map(async (n) => {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/registro.html?ev=${idAval}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#formRegistro', { timeout: 15000 });
    await pg.fill('#inpNombre', `Ultimo ${n}`);
    await pg.fill('#inpTel', `11555577${n}${n}`);
    return { ctx, pg };
  }));
  await Promise.all(dos.map(({ pg }) => pg.click('#btnRegistrar')));
  try {
    await new Promise((ok) => setTimeout(ok, 6000));
    const reg = (await db.doc(`registros/${idAval}`).get()).data();
    if (Number(reg.registrados) > Number(reg.capacidad))
      throw new Error(`el cupo se paso: ${reg.registrados} de ${reg.capacidad}`);
    if (Number(reg.registrados) !== 5)
      throw new Error('tenia que entrar exactamente uno: quedo en ' + reg.registrados);
  } finally { await Promise.all(dos.map(({ ctx }) => ctx.close())); }

  // La noche de la avalancha se saca de la agenda: si queda, la Puerta empieza
  // a mirarla a ella —es la próxima agendada con cupo— y los casos que siguen
  // no encuentran a sus invitados.
  await barra.click('#tabCalendario');
  barra.once('dialog', (d) => d.accept());
  await barra.locator('#calendario .item', { hasText: 'Noche de la avalancha' })
    .first().locator('[data-quitar]').click();
  await barra.waitForFunction(() =>
    !document.querySelector('#calendario')?.textContent.includes('Noche de la avalancha'),
    null, { timeout: 10000 });
  // Y el link viejo vuelve a la noche con lista, que es la que sigue en juego.
  await barra.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
});

await chequear('con alias cargado, el invitado elige transferencia y lo ve en su pase', async () => {
  // Sin alias no se le ofrece transferir: sería mandarlo a pagar a ningún lado.
  await db.doc('publico/pagos').set({ alias: 'sotano.prueba.mp', titular: 'Sotano Prueba' });

  // Una noche propia, para no ensuciar las listas de los otros casos.
  await barra.click('#tabCalendario');
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'Noche de la transferencia');
  await barra.fill('#inpCapacidad', '4');
  await barra.fill('#inpEntrada', '7000');
  await barra.click('#btnConfirmarEvento');
  let idTrans;
  for (let i = 0; i < 40; i++) {
    idTrans = await idDeNoche('Noche de la transferencia');
    if (idTrans && (await db.doc(`registros/${idTrans}`).get()).exists) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!idTrans) throw new Error('no se agendó la noche de prueba');

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/registro.html?ev=${idTrans}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#formRegistro', { timeout: 15000 });

    // La fecha y el precio, antes de pedirle nada.
    const dice = await pg.textContent('#pantalla');
    if (!dice.includes('7.000')) throw new Error('no dice el precio: ' + dice.slice(0, 200));
    if (!/lunes|martes|miércoles|jueves|viernes|sábado|domingo/i.test(dice))
      throw new Error('no dice qué día es');

    // Desde la invitación también se puede guardar la app.
    if (await pg.locator('.instalar').evaluate((e) => e.classList.contains('oculto')))
      throw new Error('en la invitación no se ofrece instalar');

    await pg.fill('#inpNombre', 'Transferencia Prueba');
    await pg.fill('#inpTel', '1155558888');
    // Se toca la tarjeta entera, no el puntito: el radio va oculto a propósito.
    await pg.locator('.elegir-pago label', { hasText: 'Transferencia' }).click();
    if (!(await pg.locator('.elegir-pago input[value="virtual"]').isChecked()))
      throw new Error('tocar la tarjeta no eligió transferencia');
    await pg.click('#btnRegistrar');
    await pg.waitForURL(/pase\.html/, { timeout: 20000 });

    // Todavía NO tiene QR: dijo que transfiere y nadie confirmó que llegó.
    await pg.waitForFunction(() =>
      document.querySelector('#pase')?.textContent.includes('sotano.prueba.mp'),
      null, { timeout: 20000 }).catch(async () => {
        throw new Error('el pase no muestra adónde transferir: '
          + (await pg.textContent('#pase')).slice(0, 300));
      });
    const pase = await pg.textContent('#pase');
    if (!pase.includes('7.000')) throw new Error('el pase no dice cuánto');
    if (!pase.includes('Noche de la transferencia'))
      throw new Error('el pase no dice de qué noche es');
    if (!/lunes|martes|miércoles|jueves|viernes|sábado|domingo/i.test(pase))
      throw new Error('el pase no dice qué día es');
    if (!pase.includes('confirmemos tu pago'))
      throw new Error('no le dice que le vamos a avisar');
    if (await pg.locator('.lienzo-pase .qr').count())
      throw new Error('le dio el QR sin haber confirmado el pago');

    // Y quedó guardado cómo dijo que paga.
    const inv = (await db.collection('invitados')
      .where('eventoId', '==', idTrans).get()).docs[0];
    if (inv?.data().pago !== 'virtual')
      throw new Error('no guardó la forma de pago: ' + inv?.data().pago);

    // La casa ve la transferencia en el banco y la confirma desde las
    // invitaciones de esa noche.
    await barra.click('#tabCalendario');
    await barra.locator('#calendario .item', { hasText: 'Noche de la transferencia' })
      .first().locator('[data-invitar]').click();
    await barra.waitForSelector('#dlgInvitar[open]', { timeout: 10000 });
    // La lista va plegada, y adentro de un <details> cerrado nada es visible:
    // primero se espera a que exista, después se abre.
    await barra.waitForSelector('#cuerpoInvitar [data-pliegue="anotados"]',
      { state: 'attached', timeout: 15000 });
    await barra.evaluate(() => {
      document.querySelector('#cuerpoInvitar [data-pliegue="anotados"]').open = true;
    });
    await barra.waitForSelector('#cuerpoInvitar [data-cobrado]', { timeout: 15000 })
      .catch(async () => {
        throw new Error('no apareció el botón de cobrado: '
          + (await barra.textContent('#cuerpoInvitar')).slice(0, 300));
      });
    await barra.locator('#cuerpoInvitar [data-cobrado]').first().click();

    // El QR le aparece solo, sin recargar: el pase escucha su documento.
    await pg.waitForSelector('.lienzo-pase .qr', { timeout: 20000 }).catch(async () => {
      throw new Error('confirmado el pago, el QR no apareció: '
        + (await pg.textContent('#pase')).slice(0, 300));
    });
    if (!(await pg.textContent('#pase')).includes('Entrada paga'))
      throw new Error('el pase no dice que ya está pago');
  } finally {
    await ctx.close();
    // Devolver la pantalla como estaba: el panel recuerda qué desplegables
    // quedaron abiertos, y eso ensucia los casos que siguen.
    await barra.evaluate(() => {
      const d = document.querySelector('#cuerpoInvitar [data-pliegue="anotados"]');
      if (d) d.open = false;
    }).catch(() => {});
    await barra.click('#btnCerrarInvitar');
    await barra.waitForFunction(() =>
      !document.querySelector('#dlgInvitar')?.open, null, { timeout: 10000 });
    // Cerrar tiene que llevarse la lista: son nombres y teléfonos, y además
    // confunde a cualquiera que busque plegables en la pantalla.
    if ((await barra.textContent('#cuerpoInvitar')).trim())
      throw new Error('al cerrar Invitaciones quedó la lista en pantalla');
  }

  // La noche se saca de la agenda: si queda, la Puerta la toma como la
  // próxima y los casos que siguen no encuentran a sus invitados.
  await barra.click('#tabCalendario');
  barra.once('dialog', (d) => d.accept());
  await barra.locator('#calendario .item', { hasText: 'Noche de la transferencia' })
    .first().locator('[data-quitar]').click();
  await barra.waitForFunction(() =>
    !document.querySelector('#calendario')?.textContent.includes('Noche de la transferencia'),
    null, { timeout: 10000 });
});

await chequear('sin alias cargado no se ofrece transferir', async () => {
  await db.doc('publico/pagos').set({ alias: '', titular: '' });
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    const id = await idDeNoche('Noche con lista');
    await pg.goto(`${BASE}/registro.html?ev=${id}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#formRegistro', { timeout: 15000 });
    if (await pg.locator('.elegir-pago').count())
      throw new Error('ofrece transferir sin tener adónde');
  } finally { await ctx.close(); }
  // Se deja cargado para lo que siga.
  await db.doc('publico/pagos').set({ alias: 'sotano.prueba.mp', titular: 'Sotano Prueba' });
});

await chequear('un link a una noche que no existe lo dice, y ofrece la que hay', async () => {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/registro.html?ev=no-existe-esta-noche`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() =>
      document.querySelector('#pantalla')?.textContent.includes('Esta fecha no está disponible'),
      null, { timeout: 15000 });
    if ((await pg.textContent('#pantalla')).includes('Buscando la noche'))
      throw new Error('se quedó colgado en el cartel de carga');
    // Un link muerto no tiene por qué ser un callejón sin salida: si la casa
    // tiene una noche tomando gente, se la ofrece.
    await pg.waitForFunction(() =>
      (document.querySelector('#pantalla')?.textContent || '').includes('Ir a'),
      null, { timeout: 15000 }).catch(async () => {
        throw new Error('no ofrece la próxima noche: '
          + (await pg.textContent('#pantalla')).slice(0, 200));
      });
    const link = await pg.locator('#pantalla a.btn').getAttribute('href');
    if (!link || !link.startsWith('/registro.html?ev=') || link.includes('no-existe'))
      throw new Error('el link que ofrece no sirve: ' + link);
  } finally { await ctx.close(); }
});

await chequear('una noche cerrada tampoco deja colgado al que llega tarde', async () => {
  // Existe, pero ya no toma gente. Para el que abre el link es lo mismo que si
  // no existiera, y tiene que decir lo mismo.
  const cerrada = 'noche-cerrada-de-prueba';
  await db.doc(`registros/${cerrada}`).set({
    eventoId: cerrada, nombre: 'Noche cerrada', capacidad: 10,
    registrados: 0, abierto: false, fecha: new Date(),
  });
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/registro.html?ev=${cerrada}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() =>
      document.querySelector('#pantalla')?.textContent.includes('Esta fecha no está disponible'),
      null, { timeout: 15000 }).catch(async () => {
        throw new Error('no avisa que cerró: '
          + (await pg.textContent('#pantalla')).slice(0, 200));
      });
    if ((await pg.textContent('#pantalla')).includes('Buscando la noche'))
      throw new Error('se quedó colgado en el cartel de carga');
  } finally {
    await ctx.close();
    await db.doc(`registros/${cerrada}`).delete();
  }
});

// De acá en adelante se usa el link propio de la noche, que es el que se
// reparte: el viejo sin ?ev= ya quedó probado más arriba, y además ahora
// apunta a la noche de la carrera, que se llenó a propósito.
const idConLista = await idDeNoche('Noche con lista');

await chequear('el mismo teléfono no se anota dos veces, aunque lo escriba distinto', async () => {
  const ctxDup = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const dup = await ctxDup.newPage();
  try {
    await dup.goto(`${BASE}/registro.html?ev=${idConLista}`, { waitUntil: 'domcontentloaded' });
    await dup.waitForSelector('#formRegistro', { timeout: 15000 });
    await dup.fill('#inpNombre', 'Ana De Nuevo');
    // El mismo número de Ana, escrito con guiones y espacios.
    await dup.fill('#inpTel', '11-5555 0000');
    await dup.click('#btnRegistrar');
    await dup.waitForFunction(() =>
      !document.querySelector('#error')?.classList.contains('oculto'), null, { timeout: 15000 });
    const dice = await dup.textContent('#errorTexto');
    if (!dice.includes('ya hay alguien anotado')) throw new Error('otro error: ' + dice);
    if (dup.url().includes('pase.html')) throw new Error('la dejó anotarse igual');
  } finally { await ctxDup.close(); }

  // Y lo importante: el contador no se movió, así que no se comió un lugar.
  const r = await registroDe('Noche con lista');
  if (r?.registrados !== 1) throw new Error('el lote dejó algo a medias: ' + r?.registrados);
});

await chequear('si vuelve a abrir el link, ve su pase en vez del formulario', async () => {
  // En otra pestaña del mismo celular: el pase abierto se deja como está.
  const otraPestania = await ctxInv.newPage();
  try {
    await otraPestania.goto(`${BASE}/registro.html?ev=${idConLista}`, { waitUntil: 'domcontentloaded' });
    await otraPestania.waitForFunction(() =>
      document.querySelector('#pantalla')?.textContent.includes('ya estás anotado'),
      null, { timeout: 15000 });
    if (await otraPestania.locator('#formRegistro').count())
      throw new Error('le muestra el formulario igual');
  } finally { await otraPestania.close(); }
});

await chequear('lleno el cupo, no se registra nadie más', async () => {
  // Queda uno: lo tomamos, y el siguiente tiene que rebotar.
  const ctx2 = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  try {
    await p2.goto(`${BASE}/registro.html?ev=${idConLista}`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#formRegistro', { timeout: 15000 });
    await p2.fill('#inpNombre', 'Beto Prueba');
    await p2.fill('#inpTel', '11 5555 1111');
    await p2.click('#btnRegistrar');
    await p2.waitForSelector('.lienzo-pase .qr', { timeout: 15000 });
  } finally { await ctx2.close(); }

  const ctx3 = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await ctx3.newPage();
  try {
    await p3.goto(`${BASE}/registro.html?ev=${idConLista}`, { waitUntil: 'domcontentloaded' });
    await p3.waitForFunction(() =>
      document.querySelector('#pantalla')?.textContent.includes('completo'), null, { timeout: 15000 });
    if (await p3.locator('#formRegistro').count()) throw new Error('deja anotarse igual');
  } finally { await ctx3.close(); }

  // Y el servidor también lo rechaza, no solo la pantalla.
  const rechazado = await invitado.evaluate(async () => {
    const { getFirestore, doc, setDoc, serverTimestamp } = await import('/vendor/firebase.js');
    try {
      await setDoc(doc(getFirestore(), 'invitados', 'colado-con-token-largo-xxxx'), {
        eventoId: 'cualquiera', nombre: 'Colado', telefono: '1155559999',
        creadoEn: serverTimestamp(), ingresadoEn: null,
      });
      return null;
    } catch (e) { return e.code; }
  });
  if (rechazado !== 'permission-denied') throw new Error('las reglas lo dejaron pasar: ' + rechazado);
});

await chequear('la ayuda del admin tiene todo', async () => {
  await barra.click('header [data-ayuda]');
  await barra.waitForSelector('#dlgAyuda[open]', { timeout: 5000 });
  const t = await barra.textContent('#temasAyuda');
  for (const debe of ['Entrar e instalar', 'Agendar una noche', 'Arrancar y cerrar la noche',
                      'Invitados y el link de registro', 'La caja', 'Personal: los niveles',
                      'El tablero de pedidos', 'Carta y stock', 'Controlar la entrada',
                      'El depósito: insumos y compras', 'Si algo no anda']) {
    if (!t.includes(debe)) throw new Error('le falta: ' + debe);
  }
  if (!t.includes('Poner en carta')) throw new Error('le esconde algo que sí puede hacer');
  await barra.click('#btnCerrarAyuda');
});

await chequear('la casa ve la lista y marca el ingreso', async () => {
  await barra.click('#tabPuerta');
  await barra.waitForFunction(() =>
    document.querySelector('#puerta')?.textContent.includes('Ana Prueba'), null, { timeout: 15000 });
  const cont = await barra.textContent('.contador-puerta');
  if (!cont.includes('2')) throw new Error('el contador no cuadra: ' + cont);

  await barra.locator('.invitado', { hasText: 'Ana Prueba' }).locator('[data-ingreso]').click();
  await barra.waitForFunction(() => {
    const f = [...document.querySelectorAll('.invitado')].find((x) => x.textContent.includes('Ana Prueba'));
    return f?.classList.contains('adentro');
  }, null, { timeout: 10000 });

  // Y el invitado lo ve en su pase, en vivo.
  await invitado.waitForFunction(() =>
    document.querySelector('.lienzo-pase')?.classList.contains('usado'), null, { timeout: 15000 });
});

await chequear('la lista de la puerta va plegada: faltan abierto, ya entraron cerrado', async () => {
  const faltan = barra.locator('details[data-pliegue="faltan"]');
  const adentro = barra.locator('details[data-pliegue="adentro"]');
  if (!(await faltan.count()) || !(await adentro.count()))
    throw new Error('la lista quedó plana, sin plegables');
  if (!(await faltan.evaluate((d) => d.open))) throw new Error('"Faltan entrar" tiene que abrir solo');
  if (await adentro.evaluate((d) => d.open)) throw new Error('"Ya entraron" tiene que arrancar cerrado');
  if (!(await adentro.locator('summary').textContent()).includes('1'))
    throw new Error('el grupo no dice cuántos hay');
  // Ana ya entró: está adentro del grupo cerrado y se ve al abrirlo.
  await adentro.locator('summary').click();
  await barra.waitForSelector('details[data-pliegue="adentro"] .invitado', { timeout: 10000 });
  if (!(await adentro.textContent()).includes('Ana Prueba'))
    throw new Error('no la muestra al abrir');
  await adentro.locator('summary').click();

  // Y buscando no se pliega nada: lo que importa es el resultado.
  await barra.fill('#inpBuscaInv', 'Ana');
  await barra.waitForFunction(() =>
    !document.querySelector('details[data-pliegue]'), null, { timeout: 10000 });
  if (!(await barra.textContent('#puerta')).includes('Ana Prueba'))
    throw new Error('la búsqueda no la encuentra');
  await barra.fill('#inpBuscaInv', '');
  await barra.waitForSelector('details[data-pliegue="faltan"], details[data-pliegue="adentro"]',
    { timeout: 10000 });
});

await chequear('desde la noche se ve quiénes se anotaron', async () => {
  await barra.click('#tabCalendario');
  await barra.locator('#calendario .item', { hasText: 'Noche con lista' })
    .first().locator('[data-invitar]').click();
  await barra.waitForSelector('#dlgInvitar[open]', { timeout: 10000 });
  const pliegue = barra.locator('#dlgInvitar details[data-pliegue="anotados"]');
  await pliegue.waitFor({ timeout: 10000 });
  if (await pliegue.evaluate((d) => d.open)) throw new Error('tiene que arrancar plegado');
  await pliegue.locator('summary').click();
  await barra.waitForSelector('#dlgInvitar details[data-pliegue="anotados"] .invitado',
    { timeout: 10000 });
  const dice = await pliegue.textContent();
  for (const quien of ['Ana Prueba', 'Beto Prueba'])
    if (!dice.includes(quien)) throw new Error('falta ' + quien + ' en la lista: ' + dice);
  await barra.click('#btnCerrarInvitar');
  await barra.click('#tabPuerta');
});

await chequear('la casa anota un invitado de último momento, con la lista llena', async () => {
  // El cupo era 2 y ya se llenó: por el link no entra nadie más, pero la casa
  // sí puede anotar a alguien que aparece en la puerta.
  await barra.click('#tabPuerta');
  await barra.waitForSelector('#btnAltaInvitado', { timeout: 10000 });
  await barra.click('#btnAltaInvitado');
  await barra.waitForSelector('#dlgInvitado[open]', { timeout: 5000 });
  await barra.fill('#inpInvNombre', 'Cami Última');
  await barra.fill('#inpInvTel', '11 5555 7777');
  await barra.click('#btnGuardarInvitado');

  await barra.waitForSelector('#paseNuevo .lienzo-pase .qr', { timeout: 15000 });
  if (!(await barra.textContent('#paseNuevo')).includes('Cami Última'))
    throw new Error('no confirma a quién anotó');
  await barra.click('#btnCerrarInvitado');

  // Entra ya marcada como adentro, que es lo que pasa en la puerta.
  await barra.waitForFunction(() => {
    const f = [...document.querySelectorAll('.invitado')].find((x) => x.textContent.includes('Cami Última'));
    return f?.classList.contains('adentro');
  }, null, { timeout: 15000 });

  const g = await db.collection('invitados').where('nombre', '==', 'Cami Última').get();
  if (g.empty) throw new Error('no quedó guardada');
  if (!g.docs[0].data().ingresadoEn) throw new Error('no quedó marcada como entrada');
  if (g.docs[0].id.length < 16) throw new Error('token flojo: ' + g.docs[0].id);
});

await chequear('la casa saca a alguien de la lista y le libera el teléfono', async () => {
  const antes = (await registroDe('Noche con lista'))?.registrados;
  const adentro = barra.locator('details[data-pliegue="adentro"]');
  if (!(await adentro.evaluate((d) => d.open))) await adentro.locator('summary').click();
  await barra.waitForSelector('details[data-pliegue="adentro"] .invitado', { timeout: 10000 });

  barra.once('dialog', (d) => d.accept());
  await barra.locator('.invitado', { hasText: 'Cami Última' }).locator('[data-sacar]').click();

  // Se va de la base, no solo de la pantalla.
  let quedan;
  for (let i = 0; i < 40; i++) {
    quedan = await db.collection('invitados').where('nombre', '==', 'Cami Última').get();
    if (quedan.empty) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!quedan.empty) throw new Error('sigue en la lista');

  // Y le libera el candado del teléfono: si vuelve, se puede anotar de nuevo.
  // Va después de borrar al invitado, así que se espera por separado.
  let candados;
  for (let i = 0; i < 40; i++) {
    candados = await db.collection('anotados').where('tel', '==', '1155557777').get();
    if (candados.empty) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (!candados.empty) throw new Error('le quedó el teléfono bloqueado');

  // El cupo tiene que aflojar uno.
  let r;
  for (let i = 0; i < 40; i++) {
    r = await registroDe('Noche con lista');
    if (Number(r?.registrados) === antes - 1) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (Number(r?.registrados) !== antes - 1)
    throw new Error(`el contador no bajó: ${antes} -> ${r?.registrados}`);
});

await chequear('Sótano Club se arma solo con los que se anotaron', async () => {
  // No hay una base de clientes aparte: anotarse a una noche YA es el alta.
  // La lista junta por teléfono, no por nombre, porque cada uno lo escribe
  // distinto cada vez.
  await barra.click('#tabCalendario');
  await barra.waitForFunction(() =>
    document.querySelector('#calendario')?.textContent.includes('Sótano Club'),
    null, { timeout: 15000 });
  // La lista va plegada de a cinco, así que a alguien de hace rato se lo
  // busca — que es como se usa de verdad. Apoyarse en que esté entre los
  // primeros es frágil: cualquier anotación nueva lo corre.
  await barra.fill('#buscaClub', 'Ana');
  await barra.waitForFunction(() =>
    document.querySelector('#calendario')?.textContent.includes('Ana Prueba'),
    null, { timeout: 10000 }).catch(async () => {
      throw new Error('el club no tiene a quien se anotó: '
        + (await barra.textContent('#calendario')).slice(-400));
    });

  // El buscador: por nombre y por teléfono, y escrito como venga.
  await barra.fill('#buscaClub', 'beto');
  await barra.waitForFunction(() => {
    const t = document.querySelector('#calendario')?.textContent || '';
    return t.includes('Beto Prueba') && !t.includes('Ana Prueba');
  }, null, { timeout: 10000 }).catch(async () => {
    throw new Error('el buscador por nombre no filtra: '
      + (await barra.textContent('#calendario')).slice(-300));
  });

  await barra.fill('#buscaClub', 'nadie-con-este-nombre');
  await barra.waitForFunction(() =>
    document.querySelector('#calendario')?.textContent.includes('Nadie con ese nombre'),
    null, { timeout: 10000 });
  await barra.fill('#buscaClub', '');
});

await chequear('el pase es Sótano Club: ícono y nombre propios', async () => {
  // En la pantalla de inicio hay tres apps de la casa. Esta es la del
  // invitado y no puede llamarse igual ni verse igual que las otras dos.
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(`${BASE}/pase.html`, { waitUntil: 'domcontentloaded' });
    const href = await pg.getAttribute('link[rel=manifest]', 'href');
    if (href !== '/manifest-club.webmanifest') throw new Error('manifest: ' + href);
    const m = await pg.evaluate((u) => fetch(u).then((r) => r.json()), href);
    if (m.short_name !== 'Sótano Club') throw new Error('short_name: ' + m.short_name);
    if (m.start_url !== '/pase.html') throw new Error('start_url: ' + m.start_url);
    if (m.id === '/index.html' || m.id === '/bar.html')
      throw new Error('comparte id con otra app: se instalaría una sola');
    const tituloIOS = await pg.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content');
    if (tituloIOS !== 'Sótano Club') throw new Error('nombre en iOS: ' + tituloIOS);
    if (!m.icons.some((i) => i.purpose === 'maskable')) throw new Error('sin ícono maskable');
    // Y los íconos que declara existen y son los del club, no los de la carta.
    const faltan = await pg.evaluate(async (iconos) => {
      const malos = [];
      for (const i of iconos) {
        if (!i.src.includes('club')) malos.push('no es del club: ' + i.src);
        const r = await fetch(i.src, { method: 'HEAD' });
        if (!r.ok) malos.push(i.src + ' → ' + r.status);
      }
      return malos;
    }, m.icons);
    if (faltan.length) throw new Error(faltan.join(', '));

    // Sin pase guardado no puede ser un callejón: es la pantalla que abre al
    // tocar el ícono.
    await pg.waitForFunction(() =>
      document.querySelector('#pase')?.textContent.includes('Todavía no tenés pase'),
      null, { timeout: 15000 });
    const href2 = await pg.getAttribute('#pase a', 'href');
    if (!href2 || !href2.includes('/registro.html'))
      throw new Error('no ofrece anotarse a la próxima: ' + href2);
  } finally { await ctx.close(); }
});

await chequear('lo que pide el invitado queda a su nombre', async () => {
  await invitado.goto(`${BASE}/?inv=${tokenInvitado}`, { waitUntil: 'domcontentloaded' });
  await invitado.waitForSelector('text=Papas bravas', { timeout: 15000 });
  await invitado.locator('.item', { hasText: 'Papas bravas' }).locator('[data-mas]').click();
  await invitado.click('#btnConfirmar');
  await invitado.click('#btnEnviar');
  await invitado.waitForSelector('#dlgConfirmar:not([open])', { timeout: 15000 }).catch(() => {});

  await barra.click('#tabTablero');
  await barra.waitForFunction(() =>
    document.querySelector('#tablero')?.textContent.includes('Ana Prueba'), null, { timeout: 15000 });

  const guardado = await db.collection('pedidos').where('invitadoId', '==', tokenInvitado).get();
  if (guardado.empty) throw new Error('el pedido no quedó atado al invitado');
});
await ctxInv.close();

// Detección de total adulterado: un cliente malicioso manda precios truchos.
console.log('\nINTEGRIDAD DE TOTALES');
await chequear('la barra marca un pedido con total adulterado', async () => {
  await db.collection('pedidos').add({
    clienteId: 'atacante', estado: 'nuevo',
    items: [{ id: 'papas', nombre: 'Papas bravas', precio: 1, cantidad: 2 }],
    total: 2, nombreCliente: 'Atacante', creadoEn: new Date(),
  });
  await barra.click('#tabTablero');
  await barra.waitForFunction(() =>
    document.querySelector('.ticket .sospecha') !== null, null, { timeout: 10000 });
  const t = await barra.textContent('.ticket .sospecha');
  if (!t.includes('11.000')) throw new Error('no recalculó bien: ' + t);
});
await chequear('también marca el pedido con un id que no existe en la carta', async () => {
  // El truco: inventar un id. Antes el panel caía al precio que mandaba el
  // cliente, cuadraba solo y el pedido pasaba sin una sola marca.
  await db.collection('pedidos').add({
    clienteId: 'atacante', estado: 'nuevo',
    items: [{ id: 'no-existe', nombre: 'Rabas', precio: 1, cantidad: 1 }],
    total: 1, nombreCliente: 'Colado', creadoEn: new Date(),
  });
  const marcado = await barra.waitForFunction(() => {
    const t = [...document.querySelectorAll('.ticket')].find((x) => x.textContent.includes('Rabas'));
    return t ? !!t.querySelector('.sospecha') : false;
  }, null, { timeout: 10000 }).then(() => true, () => false);
  if (!marcado) throw new Error('el pedido con id inventado pasó sin marcar');
});

// ---------- el cierre de la barra ----------
// Son dos cierres, no uno. El barman cuenta SU cajón: el efectivo que cobró
// en la barra, sin entradas y sin egresos. Lo que se prueba acá es que el
// conteo sea a ciegas y que no se pueda rehacer una vez visto el resultado.
console.log('\nEL CIERRE DE LA BARRA');

await chequear('el botón de cerrar la barra vive en Pedidos, no en caja', async () => {
  await barra.click('#tabTablero');
  await barra.waitForSelector('#btnCerrarBarra', { timeout: 20000 });
});

await chequear('no deja cerrar la barra sin contar el cajón', async () => {
  try {
    await barra.click('#btnCerrarBarra');
    await barra.waitForSelector('#dlgCerrarBarra[open]', { timeout: 10000 });

    // Contar ANTES de ver lo esperado, igual que en la jornada.
    const antes = await barra.textContent('#cuerpoCerrarBarra');
    // Ojo con el texto de la consigna, que dice "lo que la app esperaba":
    // lo que no puede estar es el NUMERO, y ese sale con su rótulo.
    if (/Cobrado en efectivo/i.test(antes))
      throw new Error('muestra lo cobrado antes de que cuenten: se copia');

    await barra.click('#btnVerCierreBarra');
    await barra.waitForFunction(() =>
      !document.querySelector('#errorBarra')?.classList.contains('oculto'),
      null, { timeout: 10000 })
      .catch(() => { throw new Error('dejó seguir sin contar el cajón'); });
    if (!(await db.collection('cierresBarra').get()).empty)
      throw new Error('cerró la barra igual');
  } catch (e) {
    await barra.evaluate(() => document.querySelector('#dlgCerrarBarra')?.close());
    throw e;
  }
});

await chequear('contado el cajón, la barra muestra su diferencia exacta', async () => {
  try {
    await barra.fill('#inpContadoBarra', '1');
    await barra.click('#btnVerCierreBarra');
    await barra.waitForFunction(() =>
      document.querySelector('#cuerpoCerrarBarra')?.textContent.includes('Cobrado en efectivo'),
      null, { timeout: 15000 });
    const t = await barra.textContent('#cuerpoCerrarBarra');
    if (!/Faltan|Sobran|Cuadra/i.test(t))
      throw new Error('no dice si falta o sobra: ' + t.slice(0, 200));
    // Y tiene que decir que esto es solo la barra: si no, el barman cree que
    // está respondiendo por las entradas.
    if (!t.includes('solo la barra'))
      throw new Error('no aclara que cuenta solo la barra');
  } catch (e) {
    await barra.evaluate(() => document.querySelector('#dlgCerrarBarra')?.close());
    throw e;
  }
});

await chequear('al confirmar, el cierre de barra queda escrito con la resta', async () => {
  await barra.click('#btnConfirmarBarra');
  await barra.waitForSelector('#dlgCerrarBarra[open]', { state: 'detached', timeout: 15000 })
    .catch(() => {});

  let c;
  for (let i = 0; i < 60; i++) {
    const q = await db.collection('cierresBarra').get();
    if (!q.empty) { c = q.docs[0].data(); break; }
    if (i === 59) throw new Error('nunca escribió el cierre de la barra');
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (c.contado !== 1) throw new Error('no guardó lo contado: ' + c.contado);
  if (c.diferencia !== c.contado - c.esperado)
    throw new Error('la diferencia no sale de la resta: ' + JSON.stringify(c));
  if (!c.cerradaPor) throw new Error('no dice quién contó');
  // El cajón del barman no incluye las entradas: lo esperado es solo lo que
  // cobró la barra en efectivo.
  if (c.esperado !== c.ventas.efectivo)
    throw new Error('lo esperado no es el efectivo de la barra: ' + JSON.stringify(c));
});

await chequear('contada una vez, la barra no se vuelve a contar', async () => {
  await barra.waitForFunction(() =>
    document.querySelector('#cierreBarra')?.textContent.includes('La barra la cerró'),
    null, { timeout: 15000 })
    .catch(() => { throw new Error('no avisa que la barra ya se cerró'); });
  if (await barra.locator('#btnCerrarBarra').count())
    throw new Error('el botón de contar sigue ahí después de contar');
});

// ---------- el cierre de la jornada ----------
// El número con el que se termina la noche. Lo que importa no es que la
// pantalla dibuje: es que al cerrar los números queden CONGELADOS.
console.log('\nEL CIERRE DE LA JORNADA');

await chequear('el tablero muestra los cinco números de la noche', async () => {
  await barra.click('#tabCaja');
  await barra.waitForSelector('#cierre .tarjeta', { timeout: 20000 });
  const t = await barra.textContent('#cierre');
  for (const debe of ['Total vendido', 'Diferencia de caja', 'Ganancia', 'Lo más vendido']) {
    if (!t.includes(debe)) throw new Error('le falta "' + debe + '": ' + t.slice(0, 300));
  }
  if (!t.includes('Jornada en curso'))
    throw new Error('no avisa que la jornada está abierta y los números se mueven');
});

await chequear('sin contar el cajón no se cierra nada', async () => {
  await barra.click('#btnCerrarJornada');
  await barra.waitForSelector('#dlgCerrarJornada[open]', { timeout: 10000 });

  // Contar ANTES de ver lo esperado: si se ve primero, se copia.
  const antes = await barra.textContent('#cuerpoCerrarJornada');
  if (/esperad/i.test(antes))
    throw new Error('muestra lo esperado antes de que cuenten: se copia');

  await barra.click('#btnVerCierre');
  await barra.waitForFunction(() =>
    !document.querySelector('#errorCierre')?.classList.contains('oculto'),
    null, { timeout: 10000 })
    .catch(() => { throw new Error('dejó seguir sin contar el cajón'); });
  if (!(await db.collection('jornadas').get()).empty)
    throw new Error('cerró la jornada igual');
});

await chequear('contado el cajón, muestra la diferencia exacta', async () => {
  // Un número cualquiera: lo que importa es que la resta se vea.
  await barra.fill('#inpContado', '1');
  await barra.click('#btnVerCierre');
  await barra.waitForFunction(() =>
    document.querySelector('#cuerpoCerrarJornada')?.textContent.includes('Diferencia de caja'),
    null, { timeout: 10000 });
  const t = await barra.textContent('#cuerpoCerrarJornada');
  // Sin tolerancia: cualquier diferencia se dice, con el monto.
  if (!/Faltan|Sobran|cuadra/i.test(t))
    throw new Error('no dice si falta o sobra: ' + t.slice(0, 200));
  if (!t.includes('congelados')) throw new Error('no avisa que se congela');
  // El punto de los dos cierres: el gerente ve el conteo del barman al lado
  // del suyo antes de confirmar.
  if (!t.includes('La barra la cerró'))
    throw new Error('no le muestra al gerente lo que contó el barman');
});

await chequear('al confirmar, la jornada queda cerrada y con sus números', async () => {
  await barra.click('#btnConfirmarCierre');
  await barra.waitForSelector('#dlgCerrarJornada[open]', { state: 'detached', timeout: 15000 })
    .catch(() => {});

  let j;
  for (let i = 0; i < 60; i++) {
    const q = await db.collection('jornadas').get();
    if (!q.empty && q.docs[0].data().cierre) { j = q.docs[0].data(); break; }
    if (i === 59) throw new Error('nunca escribió la jornada');
    await new Promise((ok) => setTimeout(ok, 250));
  }
  const c = j.cierre;
  for (const campo of ['ventas', 'entradas', 'gastos', 'caja', 'costo', 'top']) {
    if (c[campo] === undefined) throw new Error('al cierre le falta ' + campo);
  }
  if (c.caja.contado !== 1) throw new Error('no guardó lo contado: ' + c.caja.contado);
  if (c.caja.diferencia !== c.caja.contado - c.caja.esperado)
    throw new Error('la diferencia no sale de la resta: ' + JSON.stringify(c.caja));
  if (!j.cerradaPor) throw new Error('no dice quién cerró');
  if (j.horaCorte !== 6) throw new Error('no guardó con qué corte se cerró');
  // El conteo del barman viaja congelado con el resto: si mañana se corrige
  // el documento de la barra, el cierre de anoche no se mueve.
  if (!c.barra) throw new Error('el cierre no se llevó el conteo de la barra');
  if (c.barra.contado !== 1)
    throw new Error('congeló otro número: ' + JSON.stringify(c.barra));
});

// Esto es lo que hace que un cierre sirva: que no se mueva después.
await chequear('una venta posterior NO mueve los números ya cerrados', async () => {
  const antes = JSON.stringify((await db.collection('jornadas').get()).docs[0].data().cierre);

  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.locator('#cuerpoVenta .item', { hasText: 'Fernet con coca' })
    .locator('[data-d="1"]').first().click();
  await barra.click('#btnVentaEfectivo');
  await barra.waitForSelector('#dlgVenta[open]', { state: 'detached', timeout: 15000 }).catch(() => {});
  await barra.waitForTimeout(2500);

  const ahora = JSON.stringify((await db.collection('jornadas').get()).docs[0].data().cierre);
  if (ahora !== antes)
    throw new Error('el cierre se movió solo después de cerrado');
});

await chequear('la jornada cerrada se muestra como congelada', async () => {
  await barra.click('#tabCaja');
  await barra.waitForFunction(() =>
    document.querySelector('#cierre')?.textContent.includes('congelados'),
    null, { timeout: 20000 })
    .catch(() => { throw new Error('no dice que los números están congelados'); });
  const t = await barra.textContent('#cierre');
  if (!t.includes('Cerrada por')) throw new Error('no dice quién la cerró');
});

await chequear('comparar jornadas no inventa lo que no hay', async () => {
  await barra.locator('#cierre [data-vista="comparar"]').click();
  await barra.waitForFunction(() =>
    document.querySelector('#cierre')?.textContent.includes('Vendido'),
    null, { timeout: 10000 });
  const t = await barra.textContent('#cierre');
  for (const medida of ['Vendido', 'Ganancia', 'Diferencia de caja', 'Asistencia']) {
    if (!t.includes(medida)) throw new Error('falta la medida ' + medida);
  }
  if (!t.includes('Todo junto')) throw new Error('no muestra la tabla con todo');
  await barra.locator('#cierre [data-vista="una"]').click();
});

// ---------- la hora a la que corta el día del bar ----------
// La noche no termina a medianoche. Qué plata es de qué noche depende de
// este número, así que se mira que se vea, que se pueda mover y —sobre
// todo— que NO se pueda mover en el medio de una jornada ya cobrada.
console.log('\nEL DÍA DEL BAR');

await chequear('Administración muestra a qué hora arranca el día', async () => {
  await barra.click('#tabCaja');
  await barra.waitForSelector('#inpCorte', { timeout: 15000 });
  const hora = await barra.inputValue('#inpCorte');
  if (hora !== '6') throw new Error('arranca por defecto en: ' + hora);
  const t = await barra.textContent('#caja');
  if (!t.includes('de las 6:00')) throw new Error('no dice la ventana de hoy');
});

await chequear('moverlo con la jornada ya cobrada se rechaza y el campo vuelve', async () => {
  // Es el caso peligroso: cambiarlo ahora le cambiaría el día a ventas que
  // ya están contadas. Tiene que frenar y decir por qué.
  let aviso = '';
  const oir = (d) => { aviso = d.message(); d.accept(); };
  barra.on('dialog', oir);
  try {
    await barra.fill('#inpCorte', '9');
    await barra.click('#btnGuardarCorte');
    for (let i = 0; i < 40 && !aviso; i++) await new Promise((ok) => setTimeout(ok, 250));
    if (!aviso.includes('venta')) throw new Error('no avisó: ' + (aviso || 'nada'));

    const d = await db.doc('publico/jornada').get();
    if (d.exists && d.data().horaCorte === 9) throw new Error('lo guardó igual');

    // Y el campo no queda mintiendo con un 9 que nunca se guardó.
    await barra.waitForFunction(() =>
      document.querySelector('#inpCorte')?.value === '6', null, { timeout: 5000 })
      .catch(() => { throw new Error('el campo quedó en el valor rechazado'); });
  } finally {
    barra.removeListener('dialog', oir);
  }
});

await chequear('cambiarlo mueve la ventana de la caja sin recargar', async () => {
  await db.doc('publico/jornada').set({ horaCorte: 10 });
  await barra.waitForFunction(() =>
    document.querySelector('#caja')?.textContent.includes('de las 10:00'),
    null, { timeout: 10000 })
    .catch(() => { throw new Error('la caja siguió mostrando la ventana vieja'); });
  const hora = await barra.inputValue('#inpCorte');
  if (hora !== '10') throw new Error('el campo no se actualizó: ' + hora);

  await db.doc('publico/jornada').set({ horaCorte: 6 });
  await barra.waitForFunction(() =>
    document.querySelector('#inpCorte')?.value === '6', null, { timeout: 10000 });
});

// ---------- la marca la elige el cliente ----------
// Una cerveza en lata son cuatro latas al mismo precio, cada una de su
// propia caja. El cliente dice cuál, y esa caja es la que baja.
console.log('\nLA MARCA LA ELIGE EL CLIENTE');

await chequear('el cliente no puede agregar sin elegir la marca', async () => {
  await db.collection('insumos').doc('ins-quilmes').set({
    nombre: 'Quilmes lata', unidad: 'lata', medidas: 1, stock: 10, costo: 1200, minimo: 0,
  });
  await db.collection('insumos').doc('ins-brahma').set({
    nombre: 'Brahma lata', unidad: 'lata', medidas: 1, stock: 10, costo: 1100, minimo: 0,
  });
  await db.collection('carta').doc('lata').set({
    nombre: 'Cerveza en lata', categoria: 'Cervezas', precio: 4000, orden: 80,
    disponible: true, stock: 20,
    opciones: [
      { id: 'ins-quilmes', nombre: 'Quilmes lata', insumoId: 'ins-quilmes', medidas: 1 },
      { id: 'ins-brahma', nombre: 'Brahma lata', insumoId: 'ins-brahma', medidas: 1 },
    ],
  });

  await cliente.click('#tabCarta');
  await cliente.waitForFunction(() =>
    document.querySelector('#carta')?.textContent.includes('Cerveza en lata'),
    null, { timeout: 15000 });

  const fila = cliente.locator('.item', { hasText: 'Cerveza en lata' });
  // Con marcas no hay +/-: hay un botón que abre la pregunta.
  if (await fila.locator('[data-mas]').count())
    throw new Error('deja sumarla sin elegir marca');
  if (!(await fila.locator('[data-elegir]').count()))
    throw new Error('no ofrece elegir');

  await fila.locator('[data-elegir]').click();
  await cliente.waitForSelector('#dlgOpcion[open]', { timeout: 10000 });
  const t = await cliente.textContent('#cuerpoOpcion');
  for (const marca of ['Quilmes', 'Brahma']) {
    if (!t.includes(marca)) throw new Error('no ofrece ' + marca);
  }
  // Nada preseleccionado: el botón arranca apagado.
  if (!(await cliente.locator('#btnAgregarOpcion').isDisabled())) {
    await cliente.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
    throw new Error('deja agregar sin haber elegido nada');
  }
});

await chequear('elegida la marca, el pedido la lleva adentro', async () => {
  await cliente.click('[data-opcion="ins-brahma"]');
  if (await cliente.locator('#btnAgregarOpcion').isDisabled())
    throw new Error('eligió la marca y el botón sigue apagado');
  await cliente.click('#btnAgregarOpcion');
  await cliente.waitForSelector('#dlgOpcion[open]', { state: 'detached', timeout: 10000 }).catch(() => {});

  await cliente.click('#btnConfirmar');
  await cliente.waitForSelector('dialog[open]', { timeout: 10000 });
  const resumen = await cliente.textContent('#resumenPedido');
  if (!resumen.includes('Brahma')) throw new Error('el resumen no dice qué marca: ' + resumen);
  await cliente.fill('#inpNombre', 'Probador Marca');
  await cliente.click('#btnEnviar');
  await cliente.waitForSelector('dialog[open]', { state: 'detached', timeout: 15000 });

  for (let i = 0; i < 40; i++) {
    const q = await db.collection('pedidos').where('nombreCliente', '==', 'Probador Marca').get();
    if (!q.empty) {
      const it = (q.docs[0].data().items || [])[0];
      if (it.opcionId !== 'ins-brahma')
        throw new Error('el pedido no guardó la marca: ' + JSON.stringify(it));
      if (it.opcionNombre !== 'Brahma lata')
        throw new Error('no guardó el nombre de la marca: ' + JSON.stringify(it));
      return;
    }
    if (i === 39) throw new Error('el pedido nunca llegó');
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

await chequear('al entregarlo baja la caja de ESA marca y no la de la otra', async () => {
  const antes = {
    q: Number((await db.collection('insumos').doc('ins-quilmes').get()).data().stock),
    b: Number((await db.collection('insumos').doc('ins-brahma').get()).data().stock),
  };

  await barra.click('#tabTablero');
  const ticket = barra.locator('.ticket', { hasText: 'Probador Marca' });
  await ticket.waitFor({ timeout: 15000 });
  // El ticket tiene que decir qué marca: el que prepara saca la lata mirando esto.
  if (!(await ticket.textContent()).includes('Brahma'))
    throw new Error('el ticket no dice la marca');

  // El tablero mueve el pedido con [data-avanzar]: columna por columna hasta
  // entregado, que es cuando baja el stock.
  for (let i = 0; i < 5; i++) {
    const d = await db.collection('pedidos').where('nombreCliente', '==', 'Probador Marca').get();
    if (d.docs[0].data().estado === 'entregado') break;
    const btn = barra.locator('.ticket', { hasText: 'Probador Marca' }).locator('[data-avanzar]');
    if (!(await btn.count())) throw new Error('el ticket no tiene botón para avanzar');
    try {
      await btn.first().click({ timeout: 8000 });
      // Al pasar a entregado el panel pregunta cómo pagó, y hasta que no se
      // conteste el diálogo tapa el tablero entero. Es lo que corresponde:
      // si se deja para después, no se hace nunca.
      if (await barra.locator('#dlgCobro[open]').count()) {
        await barra.click('#btnEfectivo');
        await barra.waitForSelector('#dlgCobro[open]', { state: 'detached', timeout: 10000 })
          .catch(() => {});
      }
    } catch (e) {
      // Adivinar por qué no se puede hacer click cuesta una corrida entera.
      const diag = await barra.evaluate(() => {
        const t = [...document.querySelectorAll('.ticket')]
          .find((x) => x.textContent.includes('Probador Marca'));
        const abiertos = [...document.querySelectorAll('dialog[open]')].map((x) => x.id);
        if (!t) return { ticket: 'no está en el DOM', abiertos };
        const b = t.querySelector('[data-avanzar]');
        const caja = b?.getBoundingClientRect();
        return {
          abiertos,
          estado: t.className,
          visible: !!caja && caja.width > 0 && caja.height > 0,
          caja: caja && { x: Math.round(caja.x), y: Math.round(caja.y) },
          tapadoPor: caja
            ? document.elementFromPoint(caja.x + caja.width / 2, caja.y + caja.height / 2)
                ?.outerHTML.slice(0, 120)
            : null,
        };
      });
      throw new Error(e.message.split('\n')[0] + ' — ' + JSON.stringify(diag));
    }
    await barra.waitForTimeout(700);
  }

  for (let i = 0; i < 60; i++) {
    const q = Number((await db.collection('insumos').doc('ins-quilmes').get()).data().stock);
    const b = Number((await db.collection('insumos').doc('ins-brahma').get()).data().stock);
    if (b === antes.b - 1) {
      if (q !== antes.q) throw new Error('también descontó Quilmes, que nadie pidió');
      return;
    }
    if (i === 59) throw new Error(`Brahma quedó en ${b} (era ${antes.b}) y Quilmes en ${q}`);
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

await chequear('se acaba una marca y la otra se sigue vendiendo', async () => {
  // Es toda la gracia: que se acabe Quilmes no agota la cerveza.
  await db.collection('insumos').doc('ins-quilmes').update({ stock: 0 });

  await cliente.click('#tabCarta');
  await cliente.waitForFunction(() => {
    const f = [...document.querySelectorAll('.item')].find((x) => x.textContent.includes('Cerveza en lata'));
    return f && !f.className.includes('agotado');
  }, null, { timeout: 20000 })
    .catch(() => { throw new Error('agotó el producto entero por una sola marca'); });

  await cliente.locator('.item', { hasText: 'Cerveza en lata' }).locator('[data-elegir]').click();
  await cliente.waitForSelector('#dlgOpcion[open]', { timeout: 10000 });
  try {
    await cliente.waitForFunction(() =>
      document.querySelector('[data-opcion="ins-quilmes"]')?.disabled === true,
      null, { timeout: 20000 })
      .catch(() => { throw new Error('ofrece una marca que se acabó'); });
    if (await cliente.locator('[data-opcion="ins-brahma"]').isDisabled())
      throw new Error('apagó la marca que sí hay');
  } finally {
    // Si esto se va por una excepción con el diálogo abierto, cada click que
    // sigue en la suite pega contra el diálogo y muere por timeout.
    await cliente.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
  }
});

await chequear('la barra vende una marca puntual desde el mostrador', async () => {
  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.waitForFunction(() =>
    document.querySelector('#cuerpoVenta')?.textContent.includes('Cerveza en lata · Brahma'),
    null, { timeout: 15000 })
    .catch(() => { throw new Error('no desarma el producto en una fila por marca'); });

  // La que se acabó se muestra agotada y no deja sumarla.
  const quilmes = barra.locator('#cuerpoVenta .item', { hasText: 'Cerveza en lata · Quilmes' });
  if (!(await quilmes.locator('[data-d="1"]').isDisabled())) {
    await barra.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
    throw new Error('deja vender una marca que se acabó');
  }

  const antesB = Number((await db.collection('insumos').doc('ins-brahma').get()).data().stock);
  await barra.locator('#cuerpoVenta .item', { hasText: 'Cerveza en lata · Brahma' })
    .locator('[data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');
  await barra.waitForSelector('#dlgVenta[open]', { state: 'detached', timeout: 15000 }).catch(() => {});

  for (let i = 0; i < 60; i++) {
    const b = Number((await db.collection('insumos').doc('ins-brahma').get()).data().stock);
    if (b === antesB - 1) return;
    if (i === 59) throw new Error(`Brahma quedó en ${b}, era ${antesB}`);
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

// ---------- el costo de la mercadería, congelado ----------
// Antes el costo salía siempre de los precios de HOY: entraba una compra con
// el fernet más caro y la ganancia de las noches pasadas se movía sola, sin
// que nadie hubiera tocado nada. Un número cerrado que cambia solo no sirve
// para cerrar nada.
console.log('\nEL COSTO SE CONGELA EN LA VENTA');

await chequear('al entregar queda escrito lo que costó la mercadería', async () => {
  // Una botella de 10 medidas a $6.000: cada medida sale $600. El trago lleva
  // 2 medidas, así que cuesta $1.200 y se vende a $5.000.
  await db.collection('insumos').doc('ins-costo').set({
    nombre: 'Botella Costo', unidad: 'botella', medidas: 10,
    stock: 100, costo: 6000, minimo: 0,
  });
  await db.collection('carta').doc('trago-costo').set({
    nombre: 'Trago Costo', categoria: 'Tragos', precio: 5000, orden: 90,
    disponible: true, receta: [{ insumoId: 'ins-costo', medidas: 2 }],
  });

  await barra.click('#tabTablero');
  await barra.waitForFunction(() =>
    document.querySelector('#cartaBar, #vistaTablero') !== null, null, { timeout: 10000 });
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.waitForFunction(() =>
    document.querySelector('#cuerpoVenta')?.textContent.includes('Trago Costo'),
    null, { timeout: 15000 });

  const fila = barra.locator('#cuerpoVenta .item', { hasText: 'Trago Costo' });
  await fila.locator('[data-venta][data-d="1"]').click();
  await fila.locator('[data-venta][data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');
  await barra.waitForSelector('#dlgVenta[open]', { state: 'detached', timeout: 15000 }).catch(() => {});

  for (let i = 0; i < 60; i++) {
    const q = await db.collection('pedidos').where('cajaId', '!=', null).get();
    const p = q.docs.map((d) => d.data())
      .find((d) => (d.items || []).some((x) => x.id === 'trago-costo'));
    if (p?.costoMercaderia !== undefined && p.costoMercaderia !== null) {
      // 2 tragos × 2 medidas × $600 = $2.400. Vendidos a $5.000 cada uno.
      if (p.costoMercaderia !== 2400)
        throw new Error('costó mal: ' + p.costoMercaderia + ' (debería ser 2400)');
      if (p.costoDe !== 10000)
        throw new Error('la cobertura quedó mal: ' + p.costoDe + ' (debería ser 10000)');
      return;
    }
    if (i === 59) throw new Error('nunca escribió el costo');
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

await chequear('una compra más cara NO mueve el costo de lo ya vendido', async () => {
  // Es el bug entero en un caso: la botella pasa a costar el doble y lo que
  // se vendió anoche tiene que seguir costando lo que costó.
  const antes = await db.collection('pedidos').get()
    .then((q) => q.docs.find((d) => (d.data().items || []).some((x) => x.id === 'trago-costo')));
  if (!antes) throw new Error('no encuentro la venta del caso anterior');

  await db.collection('insumos').doc('ins-costo').update({ costo: 12000 });
  await barra.waitForTimeout(2500);

  const ahora = (await antes.ref.get()).data();
  if (ahora.costoMercaderia !== 2400)
    throw new Error('el costo de una venta vieja se movió solo: '
      + ahora.costoMercaderia + ' (tenía que quedar en 2400)');

  // Y una venta nueva sí toma el precio nuevo: 2 medidas × $1.200 = $2.400 por
  // trago. Lo que se congela es lo viejo, no el cálculo.
  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.locator('#cuerpoVenta .item', { hasText: 'Trago Costo' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');
  await barra.waitForSelector('#dlgVenta[open]', { state: 'detached', timeout: 15000 }).catch(() => {});

  for (let i = 0; i < 60; i++) {
    const nuevas = (await db.collection('pedidos').get()).docs
      .filter((d) => d.id !== antes.id
        && (d.data().items || []).some((x) => x.id === 'trago-costo'));
    const nueva = nuevas.find((d) => d.data().costoMercaderia != null);
    if (nueva) {
      if (nueva.data().costoMercaderia !== 2400)
        throw new Error('la venta nueva no tomó el costo nuevo: '
          + nueva.data().costoMercaderia + ' (debería ser 2400)');
      return;
    }
    if (i === 59) throw new Error('la venta nueva nunca guardó costo');
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

await chequear('un producto sin costo cargado no inventa un número', async () => {
  // Media cuenta es peor que ninguna: si falta el costo de una botella, ese
  // producto no suma al costo NI a lo que se cuenta como cubierto.
  await db.collection('insumos').doc('ins-sin-costo').set({
    nombre: 'Botella Sin Costo', unidad: 'botella', medidas: 10,
    stock: 100, costo: 0, minimo: 0,
  });
  await db.collection('carta').doc('trago-sin-costo').set({
    nombre: 'Trago Sin Costo', categoria: 'Tragos', precio: 7000, orden: 91,
    disponible: true, receta: [{ insumoId: 'ins-sin-costo', medidas: 1 }],
  });

  await barra.click('#tabTablero');
  await barra.click('#btnVentaBarra');
  await barra.waitForSelector('#dlgVenta[open]', { timeout: 10000 });
  await barra.waitForFunction(() =>
    document.querySelector('#cuerpoVenta')?.textContent.includes('Trago Sin Costo'),
    null, { timeout: 15000 });
  // Uno con costo y uno sin: el pedido tiene que contar solo el que se sabe.
  await barra.locator('#cuerpoVenta .item', { hasText: 'Trago Sin Costo' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.locator('#cuerpoVenta .item', { hasText: 'Trago Costo' })
    .locator('[data-venta][data-d="1"]').click();
  await barra.click('#btnVentaEfectivo');
  await barra.waitForSelector('#dlgVenta[open]', { state: 'detached', timeout: 15000 }).catch(() => {});

  for (let i = 0; i < 60; i++) {
    const d = (await db.collection('pedidos').get()).docs
      .find((x) => (x.data().items || []).some((y) => y.id === 'trago-sin-costo'));
    if (d?.data().costoMercaderia != null) {
      const p = d.data();
      // Solo el trago con costo: $2.400. El otro no suma nada.
      if (p.costoMercaderia !== 2400)
        throw new Error('inventó un costo: ' + p.costoMercaderia);
      // Y la cobertura dice $5.000 de $12.000 vendidos, no $12.000.
      if (p.costoDe !== 5000)
        throw new Error('la cobertura miente: ' + p.costoDe + ' (debería ser 5000)');
      if (p.total !== 12000) throw new Error('el total quedó mal: ' + p.total);
      return;
    }
    if (i === 59) throw new Error('nunca escribió el costo');
    await new Promise((ok) => setTimeout(ok, 250));
  }
});

// ---------- la plata de la puerta ----------
// Antes la entrada era un precio guardado en el evento y nada más: nadie
// escribía nunca que alguien la había pagado. Toda la recaudación de la
// puerta no existía en la base.
console.log('\nLA ENTRADA SE COBRA EN LA PUERTA');

// Contra la noche que la puerta está mirando, sea cual sea a esta altura:
// se saca de alguien que ya está en la lista, no se adivina.
const nocheDeLaPuerta = async () => {
  await barra.click('#tabPuerta');
  await barra.waitForSelector('#puerta .invitado', { timeout: 15000 });
  const nombre = await barra.locator('#puerta .invitado .nombre').first().textContent();
  const q = await db.collection('invitados').where('nombre', '==', nombre.trim()).get();
  return q.docs[0].data().eventoId;
};
let nQuienEntra = 0;
const quienEntra = async (evento) => {
  const nombre = `Entra ${++nQuienEntra} Prueba`;
  await db.collection('invitados').doc(`token-cobro-${nQuienEntra}-xxxxxxxxxx`).set({
    eventoId: evento, nombre, telefono: '', creadoEn: new Date(),
  });
  await barra.waitForFunction((n) =>
    document.querySelector('#puerta')?.textContent.includes(n), nombre, { timeout: 15000 });
  return { id: `token-cobro-${nQuienEntra}-xxxxxxxxxx`, nombre };
};
const esperarCobro = async (id, comoDebeQuedar) => {
  for (let i = 0; i < 40; i++) {
    const d = (await db.collection('invitados').doc(id).get()).data();
    if (comoDebeQuedar(d)) return d;
    if (i === 39) throw new Error('quedó así: ' + JSON.stringify({
      ingresadoEn: !!d.ingresadoEn, entradaPago: d.entradaPago, entradaMonto: d.entradaMonto }));
    await new Promise((ok) => setTimeout(ok, 250));
  }
};

const laNoche = await nocheDeLaPuerta();
await db.doc(`registros/${laNoche}`).set({ entrada: 5000 }, { merge: true });

await chequear('la puerta pregunta cómo paga antes de dejar entrar', async () => {
  const quien = await quienEntra(laNoche);
  await barra.locator('.invitado', { hasText: quien.nombre }).locator('[data-ingreso]').click();
  await barra.waitForSelector('#dlgEntrada[open]', { timeout: 10000 });
  const t = await barra.textContent('#cuerpoEntrada');
  if (!t.includes(quien.nombre)) throw new Error('no dice a quién le cobra: ' + t);
  if (!t.includes('5.000')) throw new Error('no dice cuánto: ' + t);
  for (const forma of ['efectivo', 'virtual', 'cortesia']) {
    if (!(await barra.locator(`[data-forma="${forma}"]`).count()))
      throw new Error('le falta la forma de pago: ' + forma);
  }

  await barra.click('[data-forma="efectivo"]');
  await barra.waitForSelector('#dlgEntrada[open]', { state: 'detached', timeout: 10000 }).catch(() => {});
  await esperarCobro(quien.id, (d) =>
    d.ingresadoEn && d.entradaPago === 'efectivo' && d.entradaMonto === 5000);
});

await chequear('lo cobrado se ve en la lista, al lado del nombre', async () => {
  await barra.waitForFunction(() => {
    const f = [...document.querySelectorAll('.invitado')].find((x) => x.textContent.includes('Entra 1 Prueba'));
    return f?.textContent.includes('entrada');
  }, null, { timeout: 10000 }).catch(() => { throw new Error('la fila no muestra el cobro'); });
});

await chequear('si la puerta se arrepiente, no entra ni se cobra', async () => {
  // El agujero que esto viene a tapar: que el diálogo se cierre solo y la
  // persona quede adentro sin haber pagado.
  const quien = await quienEntra(laNoche);
  await barra.locator('.invitado', { hasText: quien.nombre }).locator('[data-ingreso]').click();
  await barra.waitForSelector('#dlgEntrada[open]', { timeout: 10000 });
  await barra.click('#btnCancelarEntrada');
  await barra.waitForSelector('#dlgEntrada[open]', { state: 'detached', timeout: 10000 }).catch(() => {});

  await new Promise((ok) => setTimeout(ok, 1500));
  const d = (await db.collection('invitados').doc(quien.id).get()).data();
  if (d.ingresadoEn) throw new Error('lo dejó entrar igual');
  if (d.entradaPago) throw new Error('le cobró igual: ' + d.entradaPago);
});

await chequear('la cortesía entra en cero y queda marcada como tal', async () => {
  const quien = await quienEntra(laNoche);
  const oir = (d) => d.accept();
  barra.on('dialog', oir);
  try {
    await barra.locator('.invitado', { hasText: quien.nombre }).locator('[data-ingreso]').click();
    await barra.waitForSelector('#dlgEntrada[open]', { timeout: 10000 });
    await barra.click('[data-forma="cortesia"]');
    await esperarCobro(quien.id, (d) =>
      d.ingresadoEn && d.entradaPago === 'cortesia' && d.entradaMonto === 0);
  } finally {
    barra.removeListener('dialog', oir);
    await barra.evaluate(() =>
      document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
});

await chequear('deshacer la entrada se lleva el cobro', async () => {
  const fila = barra.locator('.invitado', { hasText: 'Entra 1 Prueba' });
  await fila.locator('[data-ingreso]').click();
  await esperarCobro('token-cobro-1-xxxxxxxxxx', (d) =>
    !d.ingresadoEn && !d.entradaPago && !d.entradaMonto);
});

await chequear('en una noche sin entrada no pregunta nada', async () => {
  await db.doc(`registros/${laNoche}`).set({ entrada: 0 }, { merge: true });
  await barra.waitForFunction(() =>
    !document.querySelector('#puerta')?.textContent.includes('Entrada $'),
    null, { timeout: 10000 }).catch(() => {});

  const quien = await quienEntra(laNoche);
  await barra.locator('.invitado', { hasText: quien.nombre }).locator('[data-ingreso]').click();
  await esperarCobro(quien.id, (d) => d.ingresadoEn);
  if (await barra.locator('#dlgEntrada[open]').count())
    throw new Error('abrió el diálogo igual, sin entrada que cobrar');
  const d = (await db.collection('invitados').doc(quien.id).get()).data();
  if (d.entradaPago) throw new Error('inventó un cobro: ' + d.entradaPago);
});

await navegador.close();

const ruido = errores.filter((e) => !/favicon|sw\.js|manifest|Failed to load resource/i.test(e));
if (ruido.length) { console.log('\nErrores de consola:'); ruido.forEach((e) => console.log('  ! ' + e)); }

console.log(`\n${fallos === 0 ? '✓ TODO BIEN' : '✗ ' + fallos + ' FALLO(S)'}`);
process.exit(fallos === 0 ? 0 : 1);
