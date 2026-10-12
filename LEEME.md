# El Sótano Bar — PWA de pedidos

Los clientes escanean el QR de su mesa, ven la carta y piden desde el celular.
La barra ve los pedidos entrar en vivo y los va moviendo hasta entregarlos.

- **Cliente:** https://el-sotano-bar.web.app
- **Barra:** https://el-sotano-bar.web.app/bar.html
- **Proyecto Firebase:** `el-sotano-bar` (Firestore en São Paulo, plan Spark)

---

## Puesta en marcha

```bash
npm install
npm run build        # empaqueta el SDK a public/vendor/firebase.js
firebase login       # una sola vez, en tu máquina
npm run deploy       # build + reglas + índices + hosting
```

Después de desplegar, cargá la carta de arranque y creá el usuario de la barra:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/ruta/al/service-account.json
npm run seed         # carta de ejemplo (idempotente)
npm run crear:barra  # crea el usuario y te da un link para elegir la contraseña
```

Si desplegás con un service account en vez de `firebase login`, `firebase deploy`
falla en el chequeo de `serviceusage`. Para las reglas usá `npm run deploy:reglas --
--aplicar`, que habla directo con la API de `firebaserules`. La cuenta necesita
`firebaserules.rulesets.create` y `firebaserules.releases.create` (rol
**Firebase Rules Admin**), y para los índices `roles/datastore.indexAdmin`.

La clave privada se baja de
[Cuentas de servicio](https://console.firebase.google.com/project/el-sotano-bar/settings/serviceaccounts/adminsdk).
**Nunca va al repositorio** — está en `.gitignore`.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Reglas de Firestore contra el emulador (38 casos) |
| `npm run e2e` | Flujo completo en un Chromium real (18 casos) |
| `npm run emu` | Emuladores locales en http://127.0.0.1:5000 |
| `npm run build` | Empaqueta el SDK de Firebase |
| `npm run seed` | Carga la carta de arranque |
| `npm run qr` | Genera un PNG de QR por mesa en `./qr/` |
| `npm run deploy` | Despliega todo |
| `npm run deploy:rules` | Solo las reglas (requiere `firebase login`) |
| `npm run deploy:reglas -- --aplicar` | Publica las reglas con un service account |
| `npm run crear:barra` | Alta del usuario de la barra |

En `localhost` la app se conecta sola a los emuladores: probar nunca toca
datos de producción.

---

## Cómo está armado

```
public/
  index.html  app.js      cliente: carta, carrito, mis pedidos
  bar.html    bar.js      barra: tablero en vivo, estados, stock
  config.js               config web de Firebase (pública) y ajustes del local
  estilos.css             tema oscuro, pensado para un sótano
  sw.js                   service worker: la app abre sin señal
  vendor/firebase.js      SDK empaquetado (generado, no se edita)
src/firebase.js           entrada del empaquetado
firestore.rules           las reglas
tests/rules.test.mjs      38 casos contra el emulador
e2e/flujo.mjs             18 casos en navegador real
scripts/                  seed, alta de barra, QR, build
```

### Datos

**`carta/{id}`** — lectura pública, escritura solo barra.
`nombre`, `descripcion`, `categoria`, `precio`, `orden`, `disponible`, `stock`
(`stock: null` = sin control de stock).

**`pedidos/{id}`** — el cliente crea el suyo, la barra maneja el resto.
`clienteId`, `estado`, `items[]`, `total`, `mesa`, `nota`, `nombreCliente`, `creadoEn`.
Estados: `nuevo → en_preparacion → listo → entregado`, más `cancelado`.

**`barra/{...}`** — privada de la barra. El cliente no lee ni escribe.

---

## Quién es "barra"

Dos caminos, cualquiera alcanza:

1. **Claim `rol: "barra"`** — lo pone `npm run crear:barra`. No cuesta lecturas.
2. **Lista de mails** en `firestore.rules`, función `mailDeBarra()`.

Para sumar a alguien: agregá el mail a esa lista y corré `npm run deploy:rules`,
o mejor, dale el claim con el script.

---

## Decisiones y límites

**Auth anónima para el cliente.** Nadie se registra para pedir una cerveza.
El `uid` anónimo es lo que ata el pedido a quien lo hizo.

**El SDK va empaquetado, no del CDN.** Un sótano tiene la señal que tiene;
bajar tres módulos de gstatic antes de ver la carta es tiempo que el cliente
no tiene. Un solo archivo del mismo dominio, cacheado por el service worker.

**Los precios los manda el cliente, y eso es un agujero conocido.**
Las reglas de Firestore no pueden recorrer un array, así que no hay forma de
validar el total ahí. El panel de barra **recalcula cada pedido contra la carta
actual y marca en rojo el que no coincide**, con el precio correcto a cobrar.
Para cerrarlo del todo haría falta una Cloud Function que valide al crear —
requiere plan Blaze (ver abajo).

**La mesa viene del QR.** `/mesa/7` deja la mesa puesta y queda guardada en la
sesión. `npm run qr` genera los PNG para imprimir.

**Offline.** Firestore guarda en IndexedDB y el service worker cachea el
cascarón: si se corta la señal, la carta se sigue viendo y el pedido se manda
solo cuando vuelve.

---

## Lo que falta

En orden de lo que más rinde:

1. **Validar el total en el servidor** (Cloud Function `onCreate` en `pedidos`).
   Cierra el agujero de precios. Necesita plan Blaze.
2. **Cierre de caja por turno** — la colección `barra/` ya está lista y
   protegida; falta la pantalla.
3. **Aviso al cliente cuando el pedido está listo** — push con FCM, o un
   cambio de color más evidente.
4. **Stock que baje solo** al entregar. Hoy se ajusta a mano desde el panel.
5. **Historial y números del mes** — hoy el tablero muestra solo el día.

---

## Probar antes de tocar producción

```bash
npm test     # las reglas
npm run e2e  # el flujo completo en navegador
```

Las dos corren contra emuladores locales. Si tocás `firestore.rules`,
corré `npm test` antes de `npm run deploy:rules`.
