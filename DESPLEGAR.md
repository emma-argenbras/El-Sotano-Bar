# Desplegar a producción

Desde la Mac, con un comando por bloque. No hace falta guardar ninguna clave
en ningún lado: la sesión de Firebase vive en tu computadora y caduca sola.

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
- **Los QR pegados en las mesas son los viejos y hay que reimprimirlos.** Un
  QR impreso no se arregla con un despliegue. Para la hoja lista para
  imprimir: `npm run qr:imprimir`.

---

## Si algo salió mal

Consola de Firebase → **Hosting** → **Historial de versiones** → volvés a la
anterior con un click.

Las reglas se publican antes que la app a propósito: si el despliegue se corta
en el medio, lo que queda arriba son reglas nuevas con el código viejo, y eso
no rompe nada —el código viejo simplemente no usa los permisos nuevos.
