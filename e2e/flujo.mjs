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

await cliente.goto(`${BASE}/mesa/7`, { waitUntil: 'domcontentloaded' });

await chequear('la carta carga', async () => {
  await cliente.waitForSelector('text=Fernet con coca', { timeout: 15000 });
});
await chequear('el QR dejó la mesa 7 puesta', async () => {
  const t = await cliente.textContent('#chipMesa');
  if (!t.includes('7')) throw new Error('chip dice: ' + t);
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
await chequear('el pedido del cliente aparece en "Entraron"', async () => {
  await barra.waitForSelector('.ticket', { timeout: 15000 });
  const t = await barra.textContent('#tablero');
  if (!t.includes('Mesa 7')) throw new Error('no muestra la mesa');
  if (!t.includes('Emma')) throw new Error('no muestra el nombre');
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
await chequear('la barra lo pasa a Listo y después Entregado', async () => {
  await barra.locator('.ticket.en_preparacion [data-avanzar]').click();
  await barra.waitForSelector('.ticket.listo', { timeout: 10000 });
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

// Detección de total adulterado: un cliente malicioso manda precios truchos.
console.log('\nINTEGRIDAD DE TOTALES');
await chequear('la barra marca un pedido con total adulterado', async () => {
  await db.collection('pedidos').add({
    clienteId: 'atacante', estado: 'nuevo',
    items: [{ id: 'papas', nombre: 'Papas bravas', precio: 1, cantidad: 2 }],
    total: 2, mesa: '9', creadoEn: new Date(),
  });
  await barra.click('#tabTablero');
  await barra.waitForFunction(() =>
    document.querySelector('.ticket .sospecha') !== null, null, { timeout: 10000 });
  const t = await barra.textContent('.ticket .sospecha');
  if (!t.includes('11.000')) throw new Error('no recalculó bien: ' + t);
});

await navegador.close();

const ruido = errores.filter((e) => !/favicon|sw\.js|manifest|Failed to load resource/i.test(e));
if (ruido.length) { console.log('\nErrores de consola:'); ruido.forEach((e) => console.log('  ! ' + e)); }

console.log(`\n${fallos === 0 ? '✓ TODO BIEN' : '✗ ' + fallos + ' FALLO(S)'}`);
process.exit(fallos === 0 ? 0 : 1);
