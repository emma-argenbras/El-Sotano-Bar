# Auditoría de Sótano — Etapa 1

> Solo lectura. No se modificó código ni datos.
> Fecha: 16/10/2026 · Rama `claude/amazing-euler-3eo4s9` · HEAD `8c2d501`

## Resumen

La app funciona y está bien cerrada del lado de la seguridad: las reglas de
Firestore son serias, el cupo no se puede sobrevender y cada pase vale una sola
entrada. El problema no es lo que está mal hecho, es lo que no está modelado.

El negocio dice que cada fecha es un evento independiente con su carta, sus
productos, su stock y sus precios. **La base no tiene nada de eso por evento:
hay una sola carta, un solo depósito y un solo juego de precios, globales.**
Cambiar el precio de un trago para la fecha del sábado lo cambia para todas las
noches. El cupo y la lista de invitados sí son por evento, y funcionan bien.

Lo segundo: **no hay respaldo**. El proyecto está en plan Spark, que no incluye
exportación programada de Firestore, y no hay ningún backup corriendo hoy.

Lo tercero: **no existe una base de clientes**. "Sótano Club" es una vista que
se arma en el navegador agrupando invitados por teléfono; no hay colección de
personas, historial de asistencia ni registro de consentimiento.

---

## 0 · Estado del repositorio y respaldo

### Git

```
Rama:        claude/amazing-euler-3eo4s9
HEAD:        8c2d501  "Versión sellada del despliegue"
Sin commitear: nada
Sin pushear:   nada
```

Todo está commiteado y empujado al remoto. Las tres suites pasaron antes del
último despliegue: 216 reglas, 95 de punta a punta, 39 de auditoría de permisos.

### Cómo hacer el export de Firestore

**La exportación administrada de Google no está disponible en este proyecto.**
`el-sotano-bar` está en plan **Spark** (sin costo). El `gcloud firestore export`
escribe en un bucket de Cloud Storage, y Cloud Storage requiere **Blaze**. Es un
límite de la plataforma, no de la configuración.

Quedan dos caminos:

**A · Export administrado (requiere pasar a Blaze)**

```bash
# 1. Crear el bucket, una sola vez
gcloud storage buckets create gs://el-sotano-bar-respaldos \
  --project=el-sotano-bar --location=southamerica-east1

# 2. Exportar
gcloud firestore export gs://el-sotano-bar-respaldos/$(date +%Y-%m-%d) \
  --project=el-sotano-bar
```

Ventaja: es la copia oficial, se puede reimportar entera con `gcloud firestore
import`. Blaze tiene capa gratuita; con el volumen de datos de hoy
(~80 documentos) el costo real sería de centavos, pero hay que cargar una
tarjeta y poner un tope de gasto.

**B · Volcado a JSON con el SDK de administrador (funciona hoy, en Spark)**

Ya existe `scripts/respaldar.mjs`, pero solo copia lo que borra el reseteo.
Para un respaldo completo habría que ampliarlo a todas las colecciones,
incluidas `carta`, `insumos`, `accesosBarra` y `publico`. Es un cambio de unas
pocas líneas.

```bash
node scripts/respaldar.mjs respaldo-$(date +%Y-%m-%d).json
```

Limitación honesta: un JSON no es un backup reimportable con un comando;
restaurar implica un script que lo vuelva a escribir documento por documento.
Para 80 documentos alcanza. Para 10.000 invitados dentro de un año, no.

**No ejecuté ninguno de los dos. Esperando tu OK.**

---

## 1 · Inventario

### 1.1 Pantallas

| Página | Quién la usa | Para qué |
|---|---|---|
| `index.html` + `app.js` | Cliente | La carta que abre el QR de la mesa. Arma el pedido, lo manda y sigue su estado. Sin login: identidad anónima de Firebase. |
| `registro.html` + `registro.js` | Invitado | El link de inscripción a una noche. Pide nombre y teléfono, elige medio de pago, descuenta cupo y genera el pase. |
| `pase.html` + `pase.js` | Invitado | Su entrada: QR, datos de la noche y estado del pago. Si todavía no pagó la transferencia, muestra el alias y **no** muestra el QR. |
| `qr.html` | La casa | Hoja de QR por mesa, para imprimir. **Posible material muerto**: ver hallazgo M-2. |
| `bar.html` + `bar.js` | Barra, puerta, admin, dueño | El panel entero, con 9 pestañas (abajo). 3.884 líneas en un solo archivo. |

Las pestañas del panel y quién las ve:

| Pestaña | Barra | Barman | Puerta | Admin | Sadmin |
|---|:--:|:--:|:--:|:--:|:--:|
| Pedidos (tablero) | ✓ | ✓ | — | ✓ | ✓ |
| Carta (agotar, receta) | ✓ | ✓ | — | ✓ | ✓ |
| Noche (turno, conteo) | ✓ | ✓ | — | ✓ | ✓ |
| **Administración** | — | — | — | ✓ | ✓ |
| Depósito | ✓ (solo mira) | — | — | ✓ | ✓ |
| Calendario | — | — | — | ✓ | ✓ |
| Puerta (escanear) | — | — | ✓ | ✓ | ✓ |
| Usuarios | — | — | — | ✓ | ✓ |

Módulos auxiliares: `instalar.js` (instalación de la PWA, compartido por las
cuatro páginas), `actualizar.js` (botón de actualizar y limpieza de caché),
`ayuda.js` (ayuda contextual por rol), `tel.js` (normalización de teléfonos),
`sw.js` (service worker), `config.js` (mesas y ajustes del local).

### 1.2 Colecciones de Firestore

Lo relevado en producción hoy. Las colecciones vacías tras el reseteo del
15/10 no aparecen en el listado del servidor, así que van marcadas con ∅ y
descritas desde las reglas y el código.

#### `carta` — 12 documentos

```json
{
  "nombre": "Fernet con coca",
  "categoria": "tragos",
  "descripcion": "",
  "precio": 4500,
  "disponible": true,
  "enCarta": true,
  "orden": 1,
  "stock": null,
  "receta": [{ "insumoId": "<id>", "medidas": 1 }]
}
```

`stock` es un valor **derivado**: lo calcula el panel a partir del depósito
cuando el producto tiene receta. `null` significa "no lleva cuenta" (∞).
Hoy **ninguno de los 12 productos tiene receta**, así que ninguno descuenta
del depósito al venderse.

#### `insumos` — 57 documentos

```json
{
  "nombre": "Gin Beefeater Clasic",
  "unidad": "Botella 1 Lt",
  "medidas": 15,
  "stock": 15,
  "costo": 25000,
  "minimo": 0,
  "creadoEn": "<timestamp>",
  "proveedorId": "<id>"
}
```

`stock` está en **medidas**, no en unidades. 43 de 57 tienen costo cargado;
**0 de 57 tienen proveedor**.

#### `pedidos` — 1 documento

```json
{
  "clienteId": "<uid anónimo>",
  "nombreCliente": "Mostrador",
  "estado": "entregado",
  "origen": "barra",
  "items": [{ "id": "<id>", "nombre": "...", "precio": 4500, "cantidad": 1 }],
  "total": 4500,
  "pago": "efectivo",
  "cajaId": "<id del evento o 2026-10-16>",
  "vendidoPor": "guilleddv",
  "creadoEn": "<timestamp>"
}
```

El precio queda **congelado dentro del pedido**, así que cambiar la carta no
corrompe el histórico de ventas. Bien resuelto.

#### `compras` — 2 documentos

```json
{
  "proveedor": "Distribuidora",
  "proveedorId": "<id>",
  "fecha": "<timestamp>",
  "items": [{ "insumoId": "<id>", "nombre": "...", "unidades": 3, "costoUnit": 12000 }],
  "total": 36000,
  "condicion": "cuenta | contado | inicial",
  "pago": "efectivo | virtual",
  "sinStock": true,
  "cargadoPor": "guilleddv",
  "creadoEn": "<timestamp>"
}
```

#### `publico` — 3 documentos, **legibles por cualquiera sin login**

```json
// publico/estado
{ "tomandoPedidos": true, "evento": null, "eventoId": null, "cambiadoEn": "<ts>" }
// publico/pagos
{ "alias": "<alias de cobro>", "titular": "" }
// publico/registro   ← puntero heredado, ver hallazgo I-2
{ "eventoId": "<id>", "nombre": "<nombre de la noche>" }
```

#### `accesosBarra` — 5 documentos

```json
{ "usuario": "guilleddv", "rol": "sadmin", "activo": true, "creadoEn": "<ts>" }
```

Roles: `sadmin`, `admin`, `barman`, `puerta`, `barra`. Campo opcional
`permisos` (mapa de 7 interruptores). **Ninguno de los 5 documentos lo tiene**,
así que hoy todos ven todo lo que su rol permite.

#### `barra/eventos/items` ∅ — el evento

```json
{
  "nombre": "Noche de bossa",
  "fecha": "<timestamp>",
  "estado": "agendado | abierto | cerrado",
  "capacidad": 45,
  "entrada": 8000,
  "barmanes": ["<uid>", "<uid>"],
  "abiertoEn": "<ts>", "cerradoEn": "<ts>"
}
```

#### `registros/{eventoId}` ∅ — el cupo y el link

```json
{
  "eventoId": "<id>", "nombre": "Noche de bossa", "fecha": "<timestamp>",
  "capacidad": 45, "registrados": 12, "abierto": true, "entrada": 8000
}
```

**Legible por cualquiera sin login** (es lo que abre el link de inscripción).

#### `invitados/{token}` ∅ — la inscripción y el pase

```json
{
  "eventoId": "<id>",
  "nombre": "<nombre y apellido>",
  "telefono": "1130000000",
  "pago": "efectivo | virtual",
  "creadoEn": "<ts>",
  "pagadoEn": null, "pagadoPor": null,
  "ingresadoEn": null, "ingresadoPor": null
}
```

El id es un token de 32 caracteres de `crypto.getRandomValues`.
**`allow get: if true`**: quien tenga el token lee el documento, sin login.

#### `anotados/{eventoId__telefono}` ∅ — candado de un teléfono por noche

```json
{ "eventoId": "<id>", "tel": "1130000000", "creadoEn": "<ts>" }
```

No se puede leer de afuera, a propósito: si se pudiera, cualquiera probaría
números para averiguar quién está en la lista.

#### `proveedores` ∅ · `egresos` ∅ · `conteos` ∅ · `bajas` ∅

```json
// proveedores/{id}
{ "nombre": "Distribuidora del Centro", "creadoEn": "<ts>" }
// egresos/{id}
{ "concepto": "Hielo", "categoria": "insumo", "monto": 12000, "pago": "efectivo",
  "fecha": "<ts>", "cajaId": "<id>", "proveedorId": "<id>", "compraId": "<id>",
  "cargadoPor": "carli", "creadoEn": "<ts>" }
// conteos/{cajaId}
{ "cajaId": "<id>", "nombre": "Noche", "apertura": {}, "cierre": {},
  "aperturaEn": "<ts>", "cierreEn": "<ts>", "aperturaPor": "nico", "cierrePor": "nico" }
// bajas/{id}   — historia, se escribe una vez y no se toca
{ "nombre": "Gin X", "motivo": "lo cargué mal", "quien": "guille",
  "cuando": "<ts>", "insumoId": "<id>", "stock": 12, "unidad": "botella" }
```

### 1.3 Reglas, Storage y Functions

**Firestore:** `firestore.rules`, 636 líneas, 636 líneas de reglas para ~15
colecciones. Están bien escritas y comentadas: jerarquía de roles por función
(`esElDueno` > `sadmin` > `admin` > `barman`/`puerta`/`barra`), validación de
forma de cada documento (`hasOnly` + tipos + rangos), y restricción de campos
por operación (`diff().affectedKeys().hasOnly(...)`). Cubiertas por 216 tests.

**Storage:** no hay `storage.rules` ni uso de Cloud Storage. No hay imágenes de
productos ni flyers de eventos.

**Cloud Functions:** **no hay ninguna.** No existe la carpeta `functions/` ni
está declarada en `firebase.json`. Toda la lógica vive en el navegador y en las
reglas. Ver hallazgo C-2: esto tiene consecuencias de fondo.

**Índices:** 6 compuestos en `firestore.indexes.json`, todos en uso.

---

## 2 · Mapa de datos cruzados

### 2.1 Lo que debería ser por fecha y hoy es global

| Dato | Hoy | Debería ser | Consecuencia |
|---|---|---|---|
| **Carta** (qué productos se ofrecen) | Global: una colección `carta`, sin `eventoId` | Por evento | No se puede armar una carta temática. Sacar un producto para una noche lo saca de todas. |
| **Precios** | Global: `carta.precio` | Por evento | Un precio especial para una fecha cambia el precio de todas las noches siguientes. |
| **Stock de productos** | Derivado del depósito global | Asignado por evento | No se puede reservar mercadería para la fecha del sábado: el stock es uno solo y se lo come la noche del jueves. |
| **Depósito (insumos)** | Global | Global ✓ + asignación por evento | El depósito físico está bien que sea único; lo que falta es poder apartar una parte para una noche. |
| **Conteo de la noche** | Por `cajaId` ✓ | — | Correcto. |
| **Cupo** | Por evento ✓ (`registros/{eventoId}`) | — | Correcto. |
| **Invitados** | Por evento ✓ | — | Correcto. |
| **Ventas y gastos** | Por `cajaId` ✓ (id del evento, o la fecha si no hay evento abierto) | — | Correcto. |
| **Precio de entrada** | Por evento ✓ | — | Correcto. |

**El hueco grande es carta + precios + stock.** Es justamente lo que el negocio
define como propio de cada fecha.

### 2.2 Datos duplicados

| Qué | Dónde | Riesgo |
|---|---|---|
| `registrados` (contador de cupo) | `registros/{ev}.registrados` vs. cantidad real de documentos en `invitados` | **Puede desincronizarse.** Ver I-1. |
| Puntero de la noche abierta | `publico/registro` (`eventoId`, `nombre`) duplica `registros/{ev}` | Dos fuentes de verdad para el link de inscripción. |
| Nombre del proveedor | `compras.proveedor` (copia del día) vs. `proveedores/{id}.nombre` | Ya mitigado en pantalla: la UI prefiere la ficha. El dato duplicado sigue en la base. |
| Datos del evento | `barra/eventos/items/{id}` (nombre, fecha, capacidad, entrada) vs. `registros/{id}` (los mismos cuatro campos) | Se escriben juntos, pero nada garantiza que sigan iguales. |
| Stock del producto | `carta.stock` es una copia calculada de `insumos.stock` vía receta | La escribe el panel; si no hay panel abierto, no se actualiza. Ver I-4. |
| Turno de la noche | `barra/turno` (`eventoId`, `barmanes`) vs. el evento abierto | Dos lugares dicen quién trabaja. |

### 2.3 Código muerto y material sospechoso

| Qué | Estado |
|---|---|
| `public/qr.html` + `public/qr/` | **Probablemente muerto.** Hoja de QR por mesa. El negocio es por evento con cupo; nadie mencionó mesas en todo el proyecto. Sigue desplegado. |
| Flujo "mesa" (`/mesa/**` en los rewrites, `config.js`) | Mismo caso: convive con el flujo de eventos sin integrarse. |
| `publico/registro` | Puntero heredado del link viejo. Se sigue escribiendo y leyendo. Reemplazable por `registros/{eventoId}`. |
| Campo `permisos` en `accesosBarra` | El módulo existe y está probado, pero **ningún usuario lo tiene configurado**. Funcionalidad construida y sin usar. |
| Campo `publico/estado.evento` | Siempre `null` en producción. |
| `src/firebase.js`, `src/qr.js` | **En uso**: son las entradas del bundler (`scripts/build.mjs`). |
| Colecciones sin uso | Ninguna. Todas las declaradas en las reglas tienen código que las escribe. |

---

## 3 · Comparación con apps de gestión de bares y eventos

Referencia: el conjunto habitual de un sistema de ticketing + guest list + POS
para locales con eventos (tipo Eventbrite / Tixr / Prekindle del lado de
entradas, y Square / Toast / Fudo del lado de barra).

| Módulo | Estado | Detalle |
|---|---|---|
| **Eventos / calendario** | ✅ Existe | Agendar, abrir, cerrar. Con cupo y precio de entrada. |
| **Inscripción / entradas** | 🟡 A medias | Hay link, cupo y pase con QR. **Falta**: tipos de entrada (general / VIP / early bird), cortesías diferenciadas, códigos de descuento, límite de fecha de venta. |
| **Cobro de entradas** | 🟡 A medias | Efectivo en la puerta o transferencia al alias, confirmada a mano por una persona. **Falta**: cobro online (Mercado Pago), conciliación automática. |
| **Lista de espera** | ❌ Falta | Cupo lleno = puerta cerrada. No se captura la demanda ni se avisa si se libera un lugar. |
| **Check-in por QR** | ✅ Existe | Escaneo en la puerta, un pase = una entrada, deshacer para el error. Bien resuelto. |
| **Carta** | 🟡 A medias | Existe y es pública por QR. **Falta** que sea por evento. |
| **Ventas / POS** | 🟡 A medias | Pedidos del cliente + venta de mostrador, cobro por efectivo/virtual, tablero por estados. **Falta**: división de cuenta, propina, comanda impresa, anulación con motivo. |
| **Stock** | 🟡 A medias | Depósito con insumos, medidas, mínimos, ingresos y recetas. **Falta**: que sea por evento, y mermas/roturas como concepto propio (hoy solo hay "baja de insumo"). |
| **Cuentas corrientes de proveedores** | ✅ Existe | Deuda, pagos y resumen de cuenta por proveedor. Nuevo de ayer. |
| **Costos y márgenes** | ✅ Existe | Costo de la receta contra precio de venta, en pesos y en porcentaje. Nuevo de ayer. |
| **CRM de clientes** | ❌ Falta | "Sótano Club" es una vista derivada, no una base. Ver I-6. |
| **Comunicaciones** | ❌ Falta | No hay envío de mails ni WhatsApp ni notificaciones push. El pase se comparte a mano. |
| **Reportes de cierre** | 🟡 A medias | Hay caja por rango y "noche por noche" con facturación. **Falta** un cierre formal por evento: entradas vs. barra, costo de lo consumido, resultado neto. |
| **Control de acceso / roles** | ✅ Existe | 5 roles, jerarquía, interruptores por pantalla, probado con 216 tests y una auditoría propia. Por encima del promedio. |
| **Auditoría / trazabilidad** | 🟡 A medias | Cada escritura guarda quién la hizo (`cargadoPor`, `vendidoPor`, `ingresadoPor`). **Falta** un registro de cambios: quién cambió un precio y cuándo. |
| **Respaldo y recuperación** | ❌ Falta | Ver punto 0. |

---

## 4 · Riesgos

### Datos personales de clientes

1. **El pase se lee sin autenticación, solo con el token.** El token es de 32
   caracteres generados con el generador criptográfico del navegador, así que no
   se adivina. Pero viaja en la URL (`/pase.html?i=...`), queda en el historial
   del teléfono y en cualquier captura de pantalla que el invitado comparta.
   Quien tenga ese link ve **nombre completo y teléfono**.
2. **Los pases no caducan.** El de una fecha de hace seis meses sigue siendo
   legible hoy, y seguirá siéndolo siempre.
3. **No hay registro de consentimiento.** Se guarda el teléfono de cada persona
   que se anota, sin una casilla que diga para qué, y sin forma de darse de
   baja. Si se empiezan a mandar notificaciones —que es el plan declarado—, eso
   pasa a ser un problema concreto frente a la ley de datos personales
   argentina (25.326).
4. **Cualquier admin puede exportar la lista entera.** No hay registro de quién
   miró o bajó los datos de clientes.

### Sobreventa de cupo

5. **El cupo está bien blindado.** La inscripción escribe el invitado, el
   contador y el candado del teléfono en un solo lote, y la regla exige que el
   número nuevo sea exactamente el anterior más uno. Dos personas que se anotan
   en el mismo segundo no pueden pasarse del tope: la segunda choca y reintenta.
   Probado con un caso de carrera simultánea.
6. **El riesgo real está en la deriva del contador**, no en la carrera. Ver I-1.
7. **La casa puede pasarse del cupo a propósito**, anotando a mano. Es
   deliberado y está bien, pero nada avisa en la puerta que esa noche hay 48
   personas para un cupo de 45.

### Cosas que pueden romper una fecha en vivo

8. **No hay Cloud Functions: si el navegador se cierra a mitad de una
   operación de varios documentos, queda a medias.** Los casos concretos: sacar
   a un invitado (tres escrituras sueltas), anotar a mano (dos escrituras, y el
   contador con el error silenciado), y el ingreso de mercadería (la compra, el
   stock y el gasto).
9. **El stock de la carta lo escribe el panel, no el servidor.** Si nadie con
   permiso tiene el panel abierto, la carta del cliente no refleja lo que hay en
   el depósito. Hoy no se nota porque ningún producto tiene receta.
10. **`bar.js` tiene 3.884 líneas.** Ayer, moviendo la plata a Administración,
    borré cinco funciones enteras sin darme cuenta y el panel quedó sin arrancar.
    Los tests no lo detectaron porque esperaban un selector y no distinguen
    "todavía no apareció" de "la página está rota". Es el riesgo más probable de
    todos los de esta lista: el archivo es demasiado grande para cambiarlo con
    seguridad.
11. **Un solo barman mal configurado deja la barra sin cobrar.** El barman solo
    ve el tablero la noche que está asignado al turno. Si nadie arma el turno, la
    barra no puede trabajar.
12. **El teléfono tiene formato argentino obligatorio** (10 dígitos, sin 0 y sin
    15). Un extranjero no se puede anotar por el link.

---

## Hallazgos ordenados por gravedad

### Crítico

| # | Hallazgo |
|---|---|
| **C-1** | **Carta, precios y stock son globales, no por evento.** Es la diferencia más grande entre lo que el negocio dice ser y lo que la base modela. |
| **C-2** | **No hay backend (Cloud Functions).** Toda operación de varios documentos depende de que el navegador no se cierre. Y bloquea: notificaciones, cobro online, cierre automático de registros, reseteo de contraseñas de otros, respaldo programado. |
| **C-3** | **No hay respaldo de la base.** Plan Spark, sin export administrado, sin script de volcado completo. Un borrado accidental hoy no tiene vuelta atrás. |
| **C-4** | **Datos personales sin ciclo de vida.** Pases que no caducan, sin consentimiento registrado, sin baja, sin trazabilidad de quién los consulta. |

### Importante

| # | Hallazgo |
|---|---|
| **I-1** | **El contador `registrados` puede desincronizarse del conteo real.** El alta manual lo incrementa con el error silenciado (`.catch(() => {})`); la baja hace tres escrituras sueltas. Si queda alto, el registro se cierra antes de tiempo; si queda bajo, se sobrevende. |
| **I-2** | **`publico/registro` duplica `registros/{eventoId}`.** Dos fuentes de verdad para cuál es la noche abierta. |
| **I-3** | **No hay lista de espera.** Con cupos de 30-60 personas y fechas temáticas, la demanda que no entra hoy se pierde entera. |
| **I-4** | **El stock de la carta lo calcula y escribe el cliente, no el servidor.** |
| **I-5** | **No hay cierre formal por evento.** Hay caja por rango y facturación por noche, pero no un resumen inmutable de la fecha: entradas cobradas, ventas de barra, costo de lo consumido, resultado. |
| **I-6** | **"Sótano Club" no es una base de clientes.** Es una vista en memoria del navegador que agrupa invitados por teléfono. Sin historial de asistencia, sin notas, sin segmentación, sin consentimiento. |
| **I-7** | **`bar.js` tiene 3.884 líneas en un archivo.** Ya causó un incidente. |
| **I-8** | **Sin registro de cambios sensibles.** Quién cambió un precio, quién borró un ingreso, quién modificó un cupo. |
| **I-9** | **Teléfono argentino obligatorio** como identificador único de persona. |

### Menor

| # | Hallazgo |
|---|---|
| **M-1** | El módulo de permisos por pantalla está construido, probado y **sin usar**: ninguno de los 5 usuarios tiene `permisos` configurado. |
| **M-2** | `qr.html`, la carpeta `public/qr/` y el flujo `/mesa/**` parecen material muerto del modelo "bar con mesas", que convive sin integrarse con el modelo "bar con eventos". |
| **M-3** | `publico/estado.evento` está siempre en `null`: campo huérfano. |
| **M-4** | El nombre del proveedor se copia en cada compra. Ya mitigado en pantalla. |
| **M-5** | No hay imágenes: ni de productos en la carta, ni flyer del evento en la invitación. Storage no está habilitado. |
| **M-6** | Los eventos duplican cuatro campos con su registro (nombre, fecha, capacidad, entrada) sin nada que garantice que sigan iguales. |
| **M-7** | La ayuda contextual (`ayuda.js`, 422 líneas) hay que actualizarla a mano con cada cambio de pantalla; ya quedó desfasada una vez. |

---

## Propuesta de modelo de datos (solo propuesta)

La idea central: **el evento deja de ser un documento más y pasa a ser el
contenedor**. Lo que es de una fecha vive adentro de esa fecha.

```
eventos/{eventoId}
    nombre, fecha, estado, capacidad, entrada, barmanes[]
    cartaBase: <plantillaId>          // de qué plantilla salió la carta
    abiertoEn, cerradoEn, creadoPor

    /carta/{itemId}                   ← COPIA congelada para esta noche
        nombre, categoria, precio, disponible, orden
        receta: [{ insumoId, medidas }]
        asignado: 40                  // medidas apartadas para esta noche
        vendido: 12

    /invitados/{token}                ← en vez de la colección global
        clienteId, nombre, telefono   // nombre y tel copiados al momento
        pago, pagadoEn, pagadoPor
        ingresadoEn, ingresadoPor
        expiraEn                      // ← el pase caduca

    /espera/{id}                      ← NUEVO: lista de espera
        clienteId, nombre, telefono, creadoEn, avisadoEn

    /ventas/{id}                      ← en vez de pedidos con cajaId
    /gastos/{id}                      ← en vez de egresos con cajaId
    /conteo                           ← apertura y cierre

    /cierre                           ← NUEVO: resumen inmutable
        entradasCobradas, ventasBarra, costoConsumido, resultado
        cerradoPor, cerradoEn

cartas/{plantillaId}                  ← NUEVO: plantillas reutilizables
    nombre: "Carta de verano"
    /items/{id}  nombre, categoria, precio, receta[]

clientes/{clienteId}                  ← NUEVO: la persona, una sola vez
    telNormalizado (clave natural), nombre, creadoEn
    vecesQueVino, ultimaVez, gastoAcumulado
    consentimiento: { notificaciones: bool, cuando, desdeDonde }
    bajaEn: null                      // derecho a que lo dejen en paz
    notas                             // "cumple en marzo", "viene con grupo"

insumos/{id}                          ← SIGUE GLOBAL: el depósito físico
    nombre, unidad, medidas, stock, costo, minimo, proveedorId

proveedores/{id}   compras/{id}   bajas/{id}   accesosBarra/{uid}
    ← sin cambios

cambios/{id}                          ← NUEVO: registro de cambios sensibles
    que: "precio" | "cupo" | "baja" | "permiso"
    quien, cuando, antes, despues, sobre
```

**Las tres decisiones de fondo de esta propuesta:**

1. **La carta del evento es una copia, no una referencia.** Cuando se abre la
   noche, se copian los items de la plantilla. A partir de ahí la noche tiene su
   carta: cambiarle el precio no toca ninguna otra fecha, y el histórico queda
   fijo para siempre sin depender de que el pedido haya guardado bien el precio.

2. **El stock se asigna, no se comparte.** `insumos` sigue siendo el depósito
   físico único. Cada evento aparta una cantidad (`asignado`) y descuenta contra
   eso. Lo que sobra vuelve al depósito al cerrar la noche. Así dos fechas
   abiertas a la vez no se comen el stock entre ellas.

3. **El cliente existe como persona.** Hoy una persona que vino a cinco fechas
   son cinco documentos sueltos de `invitados`. Con `clientes/{id}` es una
   persona con cinco asistencias, y recién ahí tiene sentido hablar de club, de
   notificaciones y de segmentar.

**Lo que esta propuesta cuesta:** es una migración de datos, no un cambio de
pantalla. Implica mover `invitados`, `pedidos` y `egresos` a subcolecciones del
evento, reescribir buena parte de las reglas, y tocar las cuatro páginas. No es
algo para hacer la semana de una fecha.

---

## Dudas que necesito que respondas

1. **Carta por evento: ¿copia o plantilla?** ¿La carta de cada fecha arranca de
   una plantilla y se modifica, o cada fecha se arma desde cero? ¿Cuántas
   plantillas distintas te imaginás?

2. **Stock por evento: ¿apartás mercadería de verdad?** ¿O te alcanza con ver
   cuánto se consumió en cada fecha, sin reservarlo de antemano?

3. **Precios:** ¿los precios cambian por fecha temática, o cambian con el tiempo
   y da lo mismo la fecha? Son dos problemas distintos.

4. **Blaze.** ¿Estás dispuesto a pasar el proyecto a plan pago? De eso dependen
   el respaldo automático, las notificaciones push, el cobro online y poder
   resetear la contraseña de un empleado. Sin eso, varias de las cosas que
   venimos hablando no se pueden hacer, y te lo voy a repetir cada vez.

5. **Notificaciones:** cuando dijiste "enviaremos notificaciones", ¿pensás en
   WhatsApp a mano, en mail, o en notificación de la app? Cada una es un camino
   distinto.

6. **Datos personales:** ¿querés que agregue una casilla de consentimiento al
   formulario de inscripción y una forma de darse de baja? Hoy guardás teléfonos
   sin eso, y en cuanto empieces a mandar mensajes pasa a importar.

7. **Pases vencidos:** ¿el pase de una fecha pasada debería dejar de abrirse?
   ¿A los cuántos días?

8. **Lista de espera:** ¿la querés? ¿Y si se libera un lugar, el aviso sale solo
   o lo mandás vos a mano?

9. **`qr.html` y el flujo de mesas:** ¿lo usan? ¿Hay mesas numeradas con QR en
   el local, o eso quedó de una idea anterior?

10. **Cierre de la noche:** ¿qué números querés ver cuando cerrás una fecha?
    Decime los cinco que mirarías primero y armo el cierre alrededor de eso.

11. **Tipos de entrada:** ¿alguna vez vas a tener entrada general y VIP, early
    bird, o cortesías con nombre? ¿O siempre es un precio único por noche?

12. **Dos fechas abiertas a la vez:** ¿puede pasar que haya dos noches con el
    registro abierto al mismo tiempo? La base lo soporta; quiero saber si es un
    caso real para priorizarlo.

---

*Fin de la Etapa 1. No se propusieron ni se hicieron cambios.*
