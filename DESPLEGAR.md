# Desplegar a producción

Desde la Mac, con un comando por bloque. No hace falta guardar ninguna clave
en ningún lado: la sesión de Firebase vive en tu computadora y caduca sola.

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
