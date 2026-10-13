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
  nombre: 'Papas bravas', categoria: 'Para picar', precio: 5500,
  orden: 1, descripcion: 'Con alioli.', disponible: true, stock: null,
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

  // En la pantalla de inicio tiene que decir "El Sótano", sin que nadie lo
  // reescriba a mano al instalarlo.
  if (m.short_name !== 'El Sótano') throw new Error('short_name: ' + m.short_name);
  const tituloIOS = await barra.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content');
  if (tituloIOS !== 'El Sótano') throw new Error('nombre en iOS: ' + tituloIOS);

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
    document.querySelector('#misPedidos')?.textContent.includes('Preparando'), null, { timeout: 10000 });
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

await chequear('la barra lo pasa a Entregado', async () => {
  // A Listo ya lo movió el caso del aviso, acá se cierra el ciclo.
  await barra.locator('.ticket.listo [data-avanzar]').click();
  await barra.waitForSelector('.ticket.entregado', { timeout: 10000 });
});
await chequear('la caja del día suma el pedido entregado', async () => {
  await barra.waitForFunction(() =>
    document.querySelector('#chipCaja')?.textContent.includes('14.500'), null, { timeout: 10000 });
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
  await barra.click('#tabEvento');
  await barra.waitForSelector('#btnAltaBarman', { timeout: 10000 });
  const respuestas = ['barra-turno', 'clave-de-prueba'];
  barra.on('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(respuestas.shift() ?? '');
    else await d.accept();
  });
  await barra.click('#btnAltaBarman');
  await barra.waitForFunction(() =>
    document.querySelector('#accesos')?.textContent.includes('barra-turno'), null, { timeout: 15000 });
  // El alta usa una app aparte justamente para esto: el dueño sigue adentro.
  if (await barra.locator('#vistaPanel').isHidden()) throw new Error('al dueño lo sacó de su propio panel');
  barra.removeAllListeners('dialog');
});

const ctxTurno = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const turno = await ctxTurno.newPage();
turno.on('pageerror', (e) => errores.push('turno: ' + e.message));

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
  for (const noDebe of ['La caja', 'Personal: quién es quién', 'Agendar una noche', 'Controlar la entrada']) {
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
  if (await turno.locator('.solo-gerente').isVisible()) throw new Error('ve la administración');
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
  barra.once('dialog', (d) => d.accept());
  await barra.click('#accesos [data-acceso]');
  await barra.waitForFunction(() =>
    document.querySelector('#accesos')?.textContent.includes('dado de baja'), null, { timeout: 10000 });
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
  const t = await barra.textContent('#evento .caja-evento');
  if (!t.includes('Prueba de noche')) throw new Error('no tomó el nombre: ' + t.slice(0, 120));

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
  const d = await db.doc('publico/estado').get();
  if (d.data()?.tomandoPedidos !== true) throw new Error('abrir el evento no habilitó los pedidos');
});
await chequear('cerrar el evento congela la caja y lo manda al histórico', async () => {
  barra.once('dialog', (d) => d.accept());
  await barra.click('#btnCerrarEvento');
  await barra.waitForSelector('#btnIrCalendario', { timeout: 10000 });
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
  await barra.click('#tabEvento');
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
  const primero = await barra.textContent('#eventosPasados .item');
  if (!primero.includes('Prueba de noche')) throw new Error('el ranking no ordena: ' + primero);

  // Y el detalle de una noche muestra qué se vendió.
  await barra.locator('#eventosPasados [data-detalle]').first().click();
  await barra.waitForSelector('#eventosPasados .ranking', { timeout: 5000 });
  const detalle = await barra.textContent('#eventosPasados');
  if (!detalle.includes('Papas bravas')) throw new Error('el detalle no lista lo vendido');
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
  const fila = await barra.locator('.item', { hasText: 'Noche con lista' }).textContent();
  if (!fila.includes('cupo 2')) throw new Error('la agenda no muestra el cupo: ' + fila);
  // Abrir el evento son varias escrituras; la del registro puede llegar
  // un instante después de que la tarjeta ya se dibujó.
  let r;
  for (let i = 0; i < 40; i++) {
    r = (await db.doc('publico/registro').get()).data();
    if (r?.abierto === true) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (r?.abierto !== true) throw new Error('no abrió el registro');
  if (r?.capacidad !== 2) throw new Error('no guardó el cupo: ' + r?.capacidad);
});

await chequear('las invitaciones traen el link y el QR de la noche', async () => {
  await barra.locator('.item', { hasText: 'Noche con lista' })
    .locator('[data-invitar]').click();
  await barra.waitForSelector('#dlgInvitar[open]', { timeout: 10000 });
  await barra.waitForSelector('#dlgInvitar .qr', { timeout: 10000 });
  const texto = await barra.textContent('#dlgInvitar');
  if (!texto.includes('/registro.html')) throw new Error('no muestra el link: ' + texto);
  if (!texto.includes('0 de 2 anotados')) throw new Error('no muestra el contador: ' + texto);

  // Un QR con el logo encima que no se lee no sirve: se decodifica de verdad.
  const src = await barra.getAttribute('#dlgInvitar .qr', 'src');
  const { PNG } = await import('pngjs');
  const jsQR = (await import('jsqr')).default;
  const img = PNG.sync.read(Buffer.from(src.split(',')[1], 'base64'));
  const leido = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  if (leido?.data !== `${BASE}/registro.html`) throw new Error('el QR dice: ' + leido?.data);
  await barra.click('#btnCerrarInvitar');
});

await chequear('si el link quedó apuntando a otra noche, se puede volver a pasar', async () => {
  const dePrimera = (await db.collection('barra/eventos/items')
    .where('nombre', '==', 'Noche con lista').get()).docs[0].id;

  // Una segunda noche con cupo se lleva el link: es un registro solo para todas.
  await barra.click('#btnAgendar');
  await barra.waitForSelector('#dlgEvento[open]', { timeout: 5000 });
  await barra.fill('#inpEvento', 'Noche que roba el link');
  await barra.fill('#inpCapacidad', '3');
  await barra.click('#btnConfirmarEvento');
  await barra.waitForFunction(() =>
    document.querySelector('#calendario')?.textContent.includes('Noche que roba el link'),
    null, { timeout: 10000 });

  await barra.locator('.item', { hasText: 'Noche con lista' })
    .locator('[data-invitar]').click();
  await barra.waitForSelector('#dlgInvitar[open]', { timeout: 10000 });
  await barra.waitForSelector('#btnActivarRegistro', { timeout: 10000 });
  if (!(await barra.textContent('#dlgInvitar')).includes('Noche que roba el link'))
    throw new Error('no avisa a qué noche está apuntando el link');

  await barra.click('#btnActivarRegistro');
  let r;
  for (let i = 0; i < 40; i++) {
    r = (await db.doc('publico/registro').get()).data();
    if (r?.eventoId === dePrimera) break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  if (r?.eventoId !== dePrimera) throw new Error('no pasó el link: ' + r?.eventoId);
  if (r?.capacidad !== 2 || r?.registrados !== 0) throw new Error('quedó mal el contador');
  await barra.waitForSelector('#btnActivarRegistro', { state: 'detached', timeout: 10000 });
  await barra.click('#btnCerrarInvitar');

  // La noche de prueba se saca para no dejarla dando vueltas en la agenda.
  barra.once('dialog', (d) => d.accept());
  await barra.locator('.item', { hasText: 'Noche que roba el link' })
    .locator('[data-quitar]').click();
  await barra.waitForFunction(() =>
    !document.querySelector('#calendario')?.textContent.includes('Noche que roba el link'),
    null, { timeout: 10000 });
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

  // El contador tiene que haber subido: es lo que cierra el cupo.
  const r = await db.doc('publico/registro').get();
  if (r.data()?.registrados !== 1) throw new Error('no contó el registro');
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

await chequear('el mismo teléfono no se anota dos veces, aunque lo escriba distinto', async () => {
  const ctxDup = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const dup = await ctxDup.newPage();
  try {
    await dup.goto(`${BASE}/registro.html`, { waitUntil: 'domcontentloaded' });
    await dup.waitForSelector('#formRegistro', { timeout: 15000 });
    await dup.fill('#inpNombre', 'Ana De Nuevo');
    // El mismo número de Ana con otro formato: +54 9, guiones, el 0 adelante.
    await dup.fill('#inpTel', '+54 9 11 5555-0000');
    await dup.click('#btnRegistrar');
    await dup.waitForFunction(() =>
      !document.querySelector('#error')?.classList.contains('oculto'), null, { timeout: 15000 });
    const dice = await dup.textContent('#errorTexto');
    if (!dice.includes('ya hay alguien anotado')) throw new Error('otro error: ' + dice);
    if (dup.url().includes('pase.html')) throw new Error('la dejó anotarse igual');
  } finally { await ctxDup.close(); }

  // Y lo importante: el contador no se movió, así que no se comió un lugar.
  const r = await db.doc('publico/registro').get();
  if (r.data()?.registrados !== 1) throw new Error('el lote dejó algo a medias: ' + r.data()?.registrados);
});

await chequear('si vuelve a abrir el link, ve su pase en vez del formulario', async () => {
  // En otra pestaña del mismo celular: el pase abierto se deja como está.
  const otraPestania = await ctxInv.newPage();
  try {
    await otraPestania.goto(`${BASE}/registro.html`, { waitUntil: 'domcontentloaded' });
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
    await p2.goto(`${BASE}/registro.html`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#formRegistro', { timeout: 15000 });
    await p2.fill('#inpNombre', 'Beto Prueba');
    await p2.fill('#inpTel', '11 5555 1111');
    await p2.click('#btnRegistrar');
    await p2.waitForSelector('.lienzo-pase .qr', { timeout: 15000 });
  } finally { await ctx2.close(); }

  const ctx3 = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await ctx3.newPage();
  try {
    await p3.goto(`${BASE}/registro.html`, { waitUntil: 'domcontentloaded' });
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
                      'Invitados y el link de registro', 'La caja', 'Personal: quién es quién',
                      'El tablero de pedidos', 'Carta y stock', 'Controlar la entrada',
                      'Si algo no anda']) {
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
  await barra.locator('.item', { hasText: 'Noche con lista' }).locator('[data-invitar]').click();
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

await navegador.close();

const ruido = errores.filter((e) => !/favicon|sw\.js|manifest|Failed to load resource/i.test(e));
if (ruido.length) { console.log('\nErrores de consola:'); ruido.forEach((e) => console.log('  ! ' + e)); }

console.log(`\n${fallos === 0 ? '✓ TODO BIEN' : '✗ ' + fallos + ' FALLO(S)'}`);
process.exit(fallos === 0 ? 0 : 1);
