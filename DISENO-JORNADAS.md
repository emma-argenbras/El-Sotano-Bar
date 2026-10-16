# Jornadas y cierre — propuesta de diseño

Para aprobar antes de construir. No se tocó código ni se desplegó nada.

---

## 1. Lo incómodo, primero

Tres de los cinco números que pediste, con los datos que hay hoy, dan mal.
No por el dashboard: por lo que la app no escribe.

**a) La entrada que se cobra en la puerta no existe en ninguna parte.**
`entrada` es un precio guardado en el evento. Cuando el de la puerta marca
"Entró", se escribe `ingresadoEn` y nada más. La plata que ese invitado puso
en la mano no genera ningún documento. Consecuencia directa:

- *Total vendido* deja afuera toda la recaudación de entradas.
- *Diferencia de caja* va a dar **sobrante** todas las noches de evento, por
  exactamente la plata de las entradas en efectivo. El número que debería
  delatar un faltante va a estar tapado por un sobrante falso.

**b) Nadie cuenta el cajón.** Hoy la app calcula "en el cajón debería haber
$X". No hay ningún lugar donde se anote cuánto había **de verdad**. Sin ese
dato, la diferencia no es un número: es una resta contra nada.

**c) El costo de mercadería está casi vacío.** `costoDeReceta()` devuelve
`null` si a cualquier insumo de la receta le falta el costo. Guille todavía no
devolvió los precios. Hoy la ganancia se calcularía sobre una fracción de lo
vendido y se mostraría como si fuera el total.

Ninguna de las tres se arregla dibujando mejor. Las tres están en el plan de
abajo, antes del dashboard.

Y una cuarta, más chica: **el costo se calcula con los precios de hoy, no con
los del día de la venta.** Cuando entre una compra con el fernet más caro, la
ganancia de las noches pasadas se mueve sola. Eso hay que congelarlo.

---

## 2. Qué es una jornada

**Una jornada es una ventana de tiempo, no un evento.** De un corte al
siguiente. Todo lo que pasó adentro es de esa jornada: las ventas de la app,
las del mostrador, las entradas, los gastos — haya habido evento o no.

Esto corrige el modelo que habíamos hablado (id = id del evento). El motivo es
concreto: hoy `cajaActual()` devuelve el id del evento mientras está abierto y
`dia-AAAA-MM-DD` cuando no. Si la barra cierra el evento a las 03:00 y sigue
vendiendo hasta las 05:00, **una misma noche queda partida en dos cajas**. Si
la jornada es una ventana de tiempo, no se parte nunca.

```
jornadas/{AAAA-MM-DD}            ← la fecha en que arrancó, después del corte
  fecha:      '2026-10-17'
  desde:      Timestamp  17/10 06:00
  hasta:      Timestamp  18/10 06:00   (el corte que se usó, congelado)
  horaCorte:  6                         (con la que se cerró, por si cambia después)
  nombre:     'Noche de tango'  |  'Día común'
  eventoIds:  ['ev_abc']                (los que cayeron adentro; puede ser [])
  estado:     'abierta' | 'cerrada'
  cerradaEn, cerradaPor
  reabiertaEn, reabiertaPor, vecesReabierta
  cierre: { … }                          ← congelado, ver abajo
```

`cajaId` en `pedidos` y `egresos` queda como está y sigue sirviendo de
etiqueta ("esto fue del evento tal"). Pero **quién pertenece a qué jornada lo
decide el reloj**, no el `cajaId`. No hace falta migrar nada.

### Quién la crea

Nadie a mano. La jornada de hoy es virtual hasta que se cierra: el panel la
calcula en vivo desde `desde = último corte`. El documento se escribe recién
al cerrar. Así no quedan jornadas vacías de los días que el bar no abrió.

---

## 3. El cierre

Un botón **"Cerrar la jornada"** en Administración, que abre un paso a paso
corto. No cierra solo, nunca: cerrar es decir "esto fue lo que pasó".

**Paso 1 — Contá el cajón.** Un solo campo: cuánta plata hay. Es el dato que
hoy falta. Abajo, en gris, lo que la app esperaba. *No se muestra el esperado
antes de que escriba el número* — si lo ve, lo copia.

**Paso 2 — Las entradas.** Solo si hubo evento. Muestra cuántos entraron, a
cuánto estaba la entrada, cuántos ya habían pagado por transferencia, y el
total que debería haber entrado en efectivo por la puerta. Editable, por las
cortesías y los que entran sin lista.

**Paso 3 — Revisá y cerrá.** Los cinco números calculados, con la diferencia
de caja ya visible. Confirmar congela todo.

**Congelar es literal.** El bloque `cierre` guarda los números, no la forma de
calcularlos. Si mañana cambia un precio, entra una compra atrasada o se corrige
una receta, el cierre de anoche no se mueve. Una jornada cerrada es historia.

```
cierre: {
  ventas:    { efectivo, virtual, sinForma, total, cantidad }
  entradas:  { personas, precio, virtual, efectivo, total }
  gastos:    { efectivo, virtual, total }
  caja:      { esperado, contado, diferencia }        ← esperado = efectivo que entró − gastos en efectivo
  costo:     { mercaderia, cobertura }                ← cobertura = % de lo vendido con costo conocido
  resultado:  ventas.total + entradas.total − costo.mercaderia
  asistencia:{ inscriptos, entraron, cupo }           ← null si no hubo evento
  top:       [ { id, nombre, cantidad, importe }, … ] ← los 3 primeros, y el resto agrupado
}
```

**Reabrir.** Solo el dueño. Deja marca (`reabiertaEn`, `vecesReabierta`) y al
volver a cerrar recalcula todo. No se borra el rastro: una jornada que se
reabrió tres veces lo dice en la pantalla.

**Permisos.** Cerrar y reabrir: admin con la pantalla de Caja prendida.
Ver el dashboard: lo mismo. El celular de la barra no cierra nada.

---

## 4. La hora de corte

Hoy las 6 de la mañana están escritas a mano en **tres lugares**:
`pedidos.js:191` (`cajaDeHoy`), `administracion.js:30` (`desdeDelRango`) y
`app.js:157` (`cajaDelDia`, la app del cliente). Tres copias del mismo número
es una que algún día va a quedar distinta.

Pasa a `publico/jornada { horaCorte: 6 }`. Un solo documento, que ya se lee sin
tocar las reglas (`publico/*` es lectura libre y escritura de admin). Los tres
lugares lo leen de ahí, con 6 como valor por defecto si todavía no existe.

En Administración, un campo: **"El día del bar arranca a las [6] de la mañana"**,
con la explicación debajo: *"Lo que se vende a las 3 AM es de la noche
anterior."* Entero, de 0 a 12.

Cambiar el corte **no reescribe jornadas cerradas** (por eso `horaCorte` queda
guardado adentro de cada cierre) y no se puede cambiar con una jornada en
curso que ya tenga ventas: primero se cierra, después se cambia.

---

## 5. El dashboard de cierre

Pantalla nueva, pestaña **"Cierre"** dentro de Administración, al lado de Caja.
Una jornada por vez, con un selector arriba para ir a las anteriores.

### Identidad

Los colores que diste no son los que tiene el panel hoy
(`#0d0b10` / `#f1ecf5` / `#e8b84b`). Son parecidos pero distintos. **Propongo
adoptar los tuyos como los tokens de toda la app**, no solo del dashboard:
dos identidades conviviendo se nota enseguida y envejece mal. Es un cambio
chico en `estilos.css` y lo dejo para que lo apruebes aparte.

```
--fondo:  #141012     fondo
--tinta:  #CCCABE     texto principal   (11.5:1 sobre el fondo)
--oro:    #CDA130     acento, números grandes  (7.9:1)
--apagado:#8A8578     rótulos, ejes, grilla    (5.1:1)
```

Tipografía pensada para leer parada, con poca luz y el celular en la mano:

| | tamaño | peso |
|---|---|---|
| número grande | `clamp(2.4rem, 9vw, 3.6rem)` | 700, `font-variant-numeric: tabular-nums` |
| número secundario | `1.5rem` | 650, tabular |
| rótulo | `.78rem`, mayúsculas, `letter-spacing:.08em` | 600, en `--apagado` |
| texto | `1rem` mínimo | — |

Tabulares es importante: sin eso las cifras bailan al actualizarse en vivo.

### La paleta de los gráficos — validada, no estimada

Los colores de marca sirven para texto y acentos, pero como series de un
gráfico sobre `#141012` no pasan las pruebas (quedan demasiado claros y el
verde contra el rojo no se distinguen con daltonismo). Corrí el validador y
quedó esta paleta, **en este orden fijo**:

```
node scripts/validate_palette.js "#B88D0A,#2DAD78,#5B98D7,#E7645E" --mode dark --surface "#141012"

  [PASS] Lightness band         los 4 dentro de L 0.48–0.67
  [PASS] Chroma floor           los 4 >= 0.1
  [PASS] CVD separation         peor par #2DAD78↔#B88D0A ΔE 9.7 (protan)
  [PASS] Normal-vision floor    peor par ΔE 16.3
  [PASS] Contrast vs surface    los 4 >= 3:1
  → ALL CHECKS PASS
```

- `#B88D0A` oro de gráfico — lo vendido, la serie principal
- `#2DAD78` verde — la ganancia, lo que sobra
- `#5B98D7` azul — virtual, lo secundario
- `#E7645E` rojo — el faltante

El oro del gráfico es más oscuro que el oro de marca a propósito: `#CDA130`
como relleno sobre negro vibra. El de marca queda para los números grandes y
los acentos, donde sí funciona.

### Los cinco números

**1 · Total vendido — número grande, sin gráfico.**
Un número solo no es un gráfico: es un número. Abajo, una barra apilada fina
(10px, puntas redondeadas 4px, 2px de aire entre segmentos) con el reparto
efectivo / virtual, cada segmento con su monto escrito al lado. Si hay
entradas, entran como tercer segmento. Y una línea chica: *"N ventas"*.

**2 · Diferencia de caja — número grande con signo.**
Debajo, dos barras cortas enfrentadas: **esperado** y **contado**, misma
escala, etiquetadas directamente. El color sigue el signo:

- falta plata → `#E7645E`, con la palabra **FALTAN $X**
- sobra plata → `#CDA130`, **SOBRAN $X** (sobrar también es un error, no es
  una buena noticia: se dice, no se festeja)
- diferencia menor a $2.000 o al 1% → gris `--apagado`, **"cuadra"**

El signo va escrito, no solo pintado. Nadie debería tener que mirar el color
para saber si falta plata.

**3 · Ganancia — número grande + una barra de composición.**
Una sola barra: lo vendido, partida en costo (gris apagado) y ganancia (verde),
con el porcentaje escrito encima de la parte verde.

Y debajo, en letra chica pero **siempre visible**: *"Calculado sobre el 64% de
lo vendido: a 7 productos les falta el costo."* Si la cobertura baja del 80%,
el número grande se muestra en `--apagado` en vez de verde, con la palabra
**parcial** al lado. Un número incompleto que se ve completo es peor que no
mostrarlo.

**4 · Asistencia — barra de progreso.**
Solo en jornadas con evento; si no hubo, la tarjeta no se dibuja (no se muestra
vacía). Una barra: **entraron** sobre **inscriptos**, con una marca vertical en
el **cupo**. Los tres números escritos. Si entró gente que no estaba en la
lista, la barra pasa del 100% y lo dice — es información, no un error.

**5 · Top 3 productos — barras horizontales.**
Tres barras, un solo color (`#B88D0A`), ordenadas de mayor a menor, con el
nombre a la izquierda y la cantidad y el importe al final de cada barra. Una
cuarta línea gris: *"otros 11 productos · $X"*. Un ranking de tres no necesita
leyenda ni colores distintos: el orden ya es la información.

### Interacción

Tocar cualquier tarjeta la abre con el detalle (las ventas que la componen).
En el gráfico, cada barra tiene su tooltip al tocarla. Nada depende de pasar el
mouse por encima: esto se usa con el pulgar.

---

## 6. Comparar jornadas

Misma pantalla, un interruptor arriba: **Una jornada / Comparar**.

Una fila de botones para elegir el período (últimas 7 · últimas 30 · todas) y
otra para elegir la medida: **Vendido · Ganancia · Diferencia de caja ·
Asistencia**. Una medida por vez, un eje. Nunca dos escalas distintas en el
mismo gráfico.

El gráfico es de barras verticales, una por jornada, en orden cronológico. En
"Vendido" se dibuja una segunda serie encima, **Ganancia**, porque son la misma
unidad y comparten eje legítimamente: oro y verde, con leyenda y con las dos
últimas barras etiquetadas directamente. Las jornadas con evento llevan un
punto dorado debajo del eje, para que se vea de un vistazo si los eventos
rinden más que los días comunes.

Debajo, siempre, **la misma información en tabla**: una fila por jornada con las
cinco columnas, ordenable. Es el requisito de accesibilidad y además es lo que
vas a querer copiar y pegar.

Arriba del todo, tres números de resumen del período: total vendido, ganancia
acumulada y el promedio por jornada.

---

## 7. Orden de construcción

Primero lo que hace que los números sean ciertos; el dibujo al final.

| | Qué | Por qué va acá |
|---|---|---|
| 1 | `publico/jornada.horaCorte` y los tres lugares leyendo de ahí | Sin un corte único no hay jornada |
| 2 | Cobrar la entrada deja registro (`cobroEntrada` en el invitado al marcar "Entró") | Sin esto la diferencia de caja no sirve |
| 3 | Congelar el costo en la venta (`costoUnitario` en cada ítem del pedido) | Sin esto la ganancia de ayer cambia sola |
| 4 | Modelo `jornadas` + reglas + el cierre con el conteo del cajón | El núcleo |
| 5 | El dashboard de una jornada | |
| 6 | La vista de comparación | |

Cada paso con sus tests (e2e contra el emulador y reglas), y te aviso al
terminar cada uno. Nada se despliega sin tu OK.

Los pasos 2 y 3 son cambios de comportamiento, no de pantalla. Son los que
convierten los cinco números en datos reales. Si querés el dashboard antes,
se puede — pero mostraría las tres mentiras del punto 1, y prefiero no
construir un tablero que haya que desconfiar.

---

## 8. Lo que falta que decidas

1. **Los colores nuevos, ¿para toda la app o solo para el dashboard?**
   Recomiendo toda la app.
2. **La entrada en efectivo, ¿se anota al marcar "Entró"?** Es un toque más
   para el de la puerta (elegir efectivo o ya pagó). La alternativa es
   estimarla al cierre: más cómodo, menos exacto. Recomiendo anotarla.
3. **Los que entran sin estar en la lista**, ¿existen? Si pasa seguido, la
   asistencia necesita un contador de "entró sin lista" en la puerta.
4. **El umbral de "cuadra".** Propongo $2.000 o 1%, lo que sea mayor.
5. **¿Quién cierra la jornada?** Propongo: cualquier admin con Caja prendida.
   Reabrir, solo vos.
6. **¿Cierre automático?** Propongo que no: si a las 06:00 nadie cerró, la
   jornada queda abierta y el panel muestra un aviso. Una jornada cerrada por
   un reloj, sin nadie que haya contado el cajón, es un cierre falso.
