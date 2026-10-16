# Desplegar a producción

Publica Claude. Acá está cómo, qué candados tiene puestos, y qué hay que
configurar una sola vez para que pueda.

---

## Decisión tomada: las direcciones

**La oficial es `sotano.web.app`.** Es la que se reparte: la que va en los QR
de las mesas, en el link de registro y en los pases.

**Los otros dos sitios se mantienen activos para siempre, sirviendo lo mismo:**

| | |
|---|---|
| `sotano.web.app` | **la oficial** — la que se reparte de ahora en adelante |
| `el-sotano-bar.web.app` | se mantiene activo |
| `sotano-club.web.app` | se mantiene activo |

El motivo es simple: hay QR impresos y links dados que apuntan a los otros dos.
Un QR pegado en una mesa no se corrige con un despliegue, y un link que alguien
guardó en el celular tampoco. Mientras los tres sirvan los mismos archivos,
nada de eso se rompe nunca.

Qué implica, en la práctica:

- **Ninguno de los tres se da de baja**, ni se saca de `firebase.json`. Si
  alguna vez hay que apagar uno, primero hay que saber qué está apuntando ahí.
- **Los tres se publican juntos.** `firebase deploy --only hosting` los
  actualiza a los tres de una, y el comando de abajo ya lo hace así. Nunca
  publicar a uno solo: tres sitios con versiones distintas de la app es peor
  que tener uno.
- **Para verificar alcanza con abrir cualquiera**, porque muestran lo mismo.
  Igual, verificá siempre en `sotano.web.app`: es la que usa la gente.
- Si algún día se le pone un dominio propio al bar, se le engancha a
  `sotano.web.app` y los otros dos siguen igual, de red de contención.

---

## Quién publica

**Publica Claude.** Programa, prueba y publica. Vos no abrís la Terminal.

Para eso hacen falta dos cosas, una sola vez, las dos desde el navegador:

### 1. Una llave de Firebase acotada

Una "cuenta de servicio": un usuario que no es una persona, que solo sabe
hacer dos cosas y nada más.

1. Crearla: **https://console.cloud.google.com/iam-admin/serviceaccounts/create?project=el-sotano-bar**
   - Nombre: `publicador`
   - **Continuar**
2. Darle exactamente **dos** permisos, y ninguno más:
   - `Administrador de Firebase Hosting`
   - `Administrador de reglas de Firebase`
   - **Listo**
3. Bajar la llave: en la lista, los tres puntitos de `publicador` →
   **Administrar claves** → **Agregar clave** → **Crear clave nueva** →
   **JSON** → **Crear**. Se descarga un archivo.
4. Cargarla en el entorno de Claude, **no en el chat**: menú del entorno (arriba)
   → **Edit** → **Network secrets** → nombre `FIREBASE_SA_JSON`, valor: el
   contenido entero del archivo. Después se puede borrar el archivo de la
   computadora.

**Por qué dos permisos y no "Administrador de Firebase":** con el rol
completo, esa llave puede leer la base entera —nombres y teléfonos de todos
los que alguna vez se anotaron—. Con estos dos, lo único que puede hacer es
publicar la app y las reglas. Si alguna vez se filtra, no hay datos de nadie
en juego.

Se revoca en un click, en la misma pantalla de claves.

### 2. Dejar ver el sitio publicado

Sin esto, Claude publica pero no puede abrir la página para mirarla: la
política de red del contenedor devuelve 403 para `*.web.app`. Verifica
contra la API de Firebase, que dice qué versión quedó arriba, pero no ve la
pantalla.

Menú del entorno → **Edit** → **Network access** → agregar `*.web.app` en
**Allowed domains**, dejando tildada la casilla de los gestores de paquetes.
Pasos: https://code.claude.com/docs/en/cloud-environments#network-access

---

## Cómo publica

```
npm run publicar
```

Las cuatro reglas están metidas en el código, no dependen de que alguien se
acuerde:

1. **Solo con todos los tests en verde.** Los corre ahí mismo —reglas y
   recorrido completo— y no confía en que alguien los haya corrido antes.
2. **Nunca entre las 19:00 y las 06:00 de Argentina.** El bar está abierto.
   Frena con la hora en pantalla y manda a esperar a la mañana. La única
   forma de pasar es que el dueño lo pida y se escriba el motivo en la
   casilla *"Publicar con el bar abierto"* al lanzarla: el motivo queda
   guardado en el registro de esa corrida, con la hora y quién la lanzó.
   Vacía —que es lo normal— la puerta se cierra igual que siempre.
3. **Reglas primero, app después.** Si se corta justo en el medio, lo que
   queda arriba son reglas nuevas con código viejo, que no rompe nada.
4. **Después verifica contra la API** qué versión quedó publicada en cada uno
   de los tres sitios, y avisa qué mirar en el celular.

`npm run publicar -- --ensayo` hace todas las comprobaciones y no publica
nada. `npm run publicar -- --solo-reglas`, solo las reglas.

---

## Si alguna vez tenés que publicar vos

No hace falta en el día a día. Queda escrito por si Claude no está disponible
y hay que sacar un arreglo urgente.

## Una sola vez

### 1. Traerte el código

El repositorio es privado, así que no alcanza con bajarlo como ZIP. La forma
más simple, sin tokens ni contraseñas:

1. Bajá **GitHub Desktop** de [desktop.github.com](https://desktop.github.com)
   y abrilo.
2. **Sign in to GitHub.com** → se abre el navegador → entrá con tu cuenta.
3. **File → Clone repository → GitHub.com** → buscá `El-Sotano-Bar` en la
   lista → **Clone**.
4. Anotá dónde lo guardó (por defecto, `Documents/GitHub/El-Sotano-Bar`).

La primera vez, macOS puede pedirte instalar las herramientas de desarrollo:
aceptá y esperá. Es una sola vez.

### 2. Preparar la Terminal

1. En GitHub Desktop: **Repository → Open in Terminal**.
2. Pegá esto y dale Enter:

   ```
   npm install
   ```

   Si dice que `npm` no existe, bajá Node de [nodejs.org](https://nodejs.org)
   (la versión LTS), instalalo, cerrá la Terminal y volvé a abrirla.

### 3. Entrar a Firebase

```
npm install -g firebase-tools
firebase login
```

Se abre el navegador. Elegí la cuenta dueña del proyecto y aceptá. Listo:
queda guardado en tu Mac y no hay que repetirlo.

---

## Desplegar un bloque

Un comando. Hace todo solo y frena si algo falla.

```
npm run desplegar A
```

Y después `B`, `C` y `D`. **De a uno**, verificando en el medio.

El comando se encarga de:

1. revisar que no haya trabajo sin guardar,
2. revisar que la cuenta esté conectada,
3. pararse en el código de ese bloque,
4. publicar las reglas de seguridad —**siempre antes que la app**, porque al
   revés el código nuevo escribe cosas que las reglas viejas rechazan,
5. construir y publicar la app,
6. dejar la carpeta como estaba, salga bien o salga mal.

Si algo falla, se detiene ahí y dice qué pasó. No sigue a ver si funciona.

---

## Qué mirar después de cada bloque

En **https://sotano.web.app/bar.html**.

Nada de esto vende, carga ni mueve stock: es todo mirar.

**Siempre, en cualquier bloque**
- que el panel abra,
- que las pestañas de arriba respondan al tocarlas.

**Bloque A · Disponibilidad automática**
- Pestaña **Carta**: los productos que salen del depósito muestran cuántos
  quedan, y el que está en cero dice agotado.

**Bloque B · La hora de corte**
- Pestaña **Caja**, bajando: tiene que aparecer **"El día del bar"** con un
  **6**, y debajo de qué hora a qué hora va la jornada de hoy.
- No toques el número todavía.

**Bloque C · El cobro de la entrada**
- Pestaña **Puerta** → tocá **"Entró"** en alguien de la lista.
- Tiene que abrirse la pregunta con **Efectivo**, **Transferencia** y
  **Cortesía**.
- Tocá **"Volver"**: no entra nadie y no se cobra nada. Eso es justamente lo
  que hay que comprobar.

**Bloque D · Los QR apuntan a la dirección oficial**
- Abrí `/qr.html` y escaneá cualquier QR con la cámara del celular: tiene que
  abrir **sotano.web.app**.
- Los QR que estén pegados en las mesas son los viejos, pero **siguen
  funcionando** y van a seguir funcionando: apuntan a `el-sotano-bar.web.app`,
  que se mantiene activo. Reimprimirlos es prolijidad, no urgencia. Cuando se
  haga: `npm run qr:imprimir`.

---

## Si algo salió mal

Consola de Firebase → **Hosting** → **Historial de versiones** → volvés a la
anterior con un click.

Las reglas se publican antes que la app a propósito: si el despliegue se corta
en el medio, lo que queda arriba son reglas nuevas con el código viejo, y eso
no rompe nada —el código viejo simplemente no usa los permisos nuevos.
