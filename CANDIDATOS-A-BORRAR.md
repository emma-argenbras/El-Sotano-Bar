# Candidatos a borrar

Código que ya no se usa pero que todavía no se saca. Cada uno con qué lo toca,
para que el día que se decida sacarlo no haya que buscarlo de nuevo.

Nada de esto está roto. Son cosas que funcionan y que no hacen falta: el costo
de tenerlas es que hay que leerlas, mantenerlas y probarlas cada vez que se
toca algo cerca.

---

## Flujo de mesas  ·  anotado el 16/10/2026

**Por qué está acá.** Sótano no tiene mesas numeradas y no hay ningún QR
pegado en ninguna mesa. El flujo quedó de una idea anterior. (Duda 9 de la
auditoría, respondida por la casa el 16/10.)

**Por qué no se borra ahora.** Decisión de la casa: primero estabilizar las
jornadas y el cierre. Sacar esto no arregla nada que esté roto hoy y toca
nueve archivos, varios de ellos en el camino de una venta.

### Qué habría que tocar

**Se borra entero**

| Archivo | Qué es |
|---|---|
| `public/qr.html` | La pantalla que muestra los QR por mesa para proyectarlos |
| `scripts/generar-qr.mjs` | Genera un PNG por mesa (`npm run qr`) |
| `scripts/hoja-qr.mjs` | Arma la hoja A4 de 4 QR por hoja (`npm run qr:imprimir`) |
| `public/qr/mesa-*.png` | Los 13 PNG, uno por mesa |
| `public/qr/mesas.json` | El índice que `qr.html` y la hoja leen |

Se queda `scripts/qr-operacion.mjs` (`npm run qr:operacion`): es el que arma
los dos QR que el bar sí usa, y no depende de las mesas.

**Se edita**

| Archivo | Qué sacar | Ojo con |
|---|---|---|
| `public/config.js` | `CONFIG_BAR.mesas` (la lista de 12) | `generar-qr.mjs` la lee como única fuente de verdad; se va junto con él |
| `firebase.json` | Las tres reglas `"source": "/mesa/**"`, una por sitio | Son tres, no una. Si queda una, ese sitio sigue sirviendo una ruta muerta |
| `public/app.js` | El chip de mesa, leer la mesa de la URL y mandarla en el pedido | **Acá está el riesgo.** El pedido se crea en el mismo lugar; tocar esto es tocar el camino de una venta |
| `public/barra/pedidos.js` | `quienPidio()` y el renglón del ticket, que caen a "Mesa N" cuando no hay nombre | Hay pedidos viejos con `mesa` guardada: el tablero tiene que seguir mostrándolos bien o se pierde el historial |
| `public/index.html` | `<title>`, la descripción y el paso 2 del instalador dicen "pedí desde la mesa" | Es texto de cara al cliente: hay que reescribirlo, no solo borrarlo |
| `e2e/flujo.mjs` | Los 8 casos que usan mesas | Varios prueban otra cosa y de paso usan una mesa. Hay que leerlos uno por uno |
| `scripts/desplegar.mjs`, `scripts/auditar-barra.mjs` | Menciones sueltas | Cosméticas |
| `public/sw.js`, `scripts/build.mjs` | `qr.html` sale del precache y del sellado | Si se borra el archivo y no se saca de las listas, el service worker falla al instalarse |

### El orden que yo seguiría

1. **Primero los pedidos viejos.** Decidir qué pasa con los que tienen `mesa`
   guardada: el tablero los tiene que seguir mostrando. Lo más barato es dejar
   `quienPidio()` como está —ya cae a "Sin nombre" cuando no hay mesa— y no
   tocar nada de lectura.
2. **Después `app.js`**, que es lo único en el camino de una venta. Un caso de
   e2e que mande un pedido sin mesa y lo cobre, antes y después.
3. **Después lo que no se ejecuta:** `qr.html`, los scripts, los PNG, el JSON,
   y en el mismo commit sacarlos de `sw.js` y de `build.mjs`.
4. **Al final `firebase.json`**, los tres `/mesa/**` juntos. Un link viejo a
   `/mesa/7` va a dar 404 a partir de ahí: es el único cambio que alguien de
   afuera puede notar.

### Lo que hay que saber antes de empezar

- ¿Hay pedidos en producción con el campo `mesa` cargado? Si los hay, la
  pantalla del tablero y la caja los tienen que seguir leyendo. Se mira con
  `npm run respaldo` y un vistazo al JSON.
- ¿Quedó algún link a `/mesa/N` dado por fuera (WhatsApp, un flyer)? Si sí,
  los tres sitios se mantienen activos igual, pero la ruta en sí deja de
  existir.
