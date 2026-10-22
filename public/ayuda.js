// Ayuda del panel, por rol. Cada uno ve lo suyo y nada más: al barman no le
// sirve leer sobre la caja, y a la puerta le estorba todo lo demás.
//
// El contenido vive acá y en ningún otro lado. Si cambia cómo funciona algo,
// se cambia en este archivo y listo.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  // quien: en qué roles aparece cada tema.
  const TEMAS = [
    {
      quien: ['admin', 'barman', 'barra', 'puerta'],
      titulo: 'Entrar e instalar',
      cuerpo: `
        <p>Entrás con <b>usuario y contraseña</b>, sin mail. El usuario te lo dio
        la casa y la contraseña no se recupera: si se pierde, te crean una cuenta
        nueva.</p>
        <p>Tocá <b>⬇ Instalar</b> arriba para que quede como una app en tu
        pantalla de inicio. En iPhone tiene que ser desde Safari: Compartir ⬆︎ →
        Agregar a inicio. Desde Chrome en iPhone no se puede, es de Apple.</p>
        <p>Si algo se ve raro o viejo, tocá <b>↻</b>. Limpia la app y la deja en
        la última versión. Cuando hay una versión nueva te avisa solo.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'El calendario',
      cuerpo: `
        <p>La pestaña <b>Calendario</b> es la vista del mes. Cada día con noche
        tiene un punto: <b>dorado</b> agendada, <b>verde</b> en curso,
        <b>gris</b> ya cerrada.</p>
        <p>Tocás un día y abajo ves lo de ese día, con todo lo que podés hacerle.
        Tocás de nuevo y vuelve a mostrarte lo que viene.</p>
        <p>Con un día elegido, <b>Agendar una noche</b> ya viene con esa fecha
        puesta.</p>
        <p>La pestaña <b>Noche</b> es solo lo de hoy: la caja, quién está de
        turno y el registro. El mes se mira acá.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'Agendar una noche',
      cuerpo: `
        <p>En <b>Calendario → Agendar una noche</b> ponés nombre, fecha, cupo y
        qué barman o gente de puerta trabaja.</p>
        <p>Queda <b>agendada</b>, no abierta. Ahí todavía no entran pedidos.</p>
        <p><b>El registro de invitados abre al agendar</b>, no al arrancar. Esa es
        la gracia: agendás el viernes de la semana que viene y la gente se anota
        durante toda la semana.</p>
        <p>Si dejás el cupo vacío, no hay lista de invitados y la noche funciona
        como un bar común.</p>
        <p><b>Entrada</b>: lo que sale entrar esa noche. Vacío o cero es gratis.
        Se lo decimos a la persona <b>antes</b> de pedirle los datos, le queda
        escrito en el pase, y en <b>Puerta</b> aparece cuánto cobrarle a cada
        uno. Por ahora se cobra en la puerta: la app lo avisa, no lo cobra.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'Arrancar y cerrar la noche',
      cuerpo: `
        <p><b>Arrancar</b> abre la noche: desde ese momento entran pedidos y la
        caja cuenta. El tablero mira desde ahí, no desde las 00:00 — una noche de
        bar no termina a medianoche.</p>
        <p><b>Terminar la noche</b> congela los números y la manda al
        histórico. <b>No se puede reabrir.</b></p>
        <p>Antes de cerrar, fijate que no queden pedidos sin entregar: <b>no suman
        a la caja</b>. El cartel te avisa cuántos quedaron.</p>
        <p><b>Cortar</b> frena la entrada de pedidos sin cerrar la noche. Sirve
        para el último pedido: cortás, servís lo que quedó pendiente y después
        cerrás con todo entregado.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'Invitados y el link de registro',
      cuerpo: `
        <p>Cada noche con cupo tiene <b>Invitaciones</b>: en el
        <b>Calendario</b>, en su renglón, y en <b>Noche</b> si es la que está en
        curso. Ahí adentro está el <b>link</b>, el <b>QR</b> para bajar y cuántos
        se anotaron. <b>Mandar el link</b> abre el menú de compartir de tu celular:
        elegís WhatsApp, Instagram o lo que sea. <b>La app no manda nada por su
        cuenta.</b></p>
        <p><b>Cada noche tiene su propio link y su propio QR.</b> El de una no
        lleva a la otra: podés tener dos noches anotando gente al mismo tiempo,
        cada una con su cupo y su lista. Crear una noche nueva no le toca nada a
        la anterior.</p>
        <p>Ahí mismo podés <b>cerrar el registro de esa noche</b> cuando no
        quieras más anotados, y volver a abrirlo. Al <b>cerrar el evento</b> se
        cierra solo: el link de esa noche vence ahí.</p>
        <p>El invitado deja nombre y teléfono, y recibe <b>su pase con QR</b>. El
        teléfono entra de una sola manera: <b>diez números, sin el 0 y sin el
        15</b> (3454 18 9066). El formulario no deja escribirlo de otra forma y
        le dice qué sacar. Es lo que hace que el candado del teléfono sirva: si
        uno lo escribe con 0 y otro sin, para la base son dos personas.</p>
        <p><b>Un teléfono, una anotación por noche.</b> Si intenta de nuevo con el
        mismo número —aunque lo escriba con +54, con 0 o con 15— le rebota, y si
        vuelve a abrir el link desde el mismo celular ve su pase en vez del
        formulario. Al anotar de último momento, si el número ya está en la lista
        te avisa de quién es y vos decidís si lo anotás igual: hay parejas que
        comparten teléfono.</p>
        <p>En <b>Puerta</b> ves la lista, quién entró, a qué hora y <b>cuánto
        consumió cada uno</b>. Va en dos grupos que se abren y se cierran:
        <b>Faltan entrar</b> abierto y <b>Ya entraron</b> cerrado, así con sesenta
        anotados no tenés que scrollear sin fin. Cada grupo muestra los primeros
        veinte y el resto con <b>Ver los otros</b>. Si buscás por nombre, la
        búsqueda manda y no se pliega nada.</p>
        <p>Para ver quiénes se anotaron a una noche que todavía no arrancó, está
        adentro de sus <b>Invitaciones</b>, en <b>Quiénes se anotaron</b>.</p>
        <p>La <b>✕</b> roja saca a alguien de la lista para siempre: se anotó dos
        veces, se equivocó de noche. Su pase deja de servir y le libera el
        teléfono para que se pueda anotar de nuevo.</p>
        <p>Si alguien aparece sin anotarse: <b>+ Invitado de último momento</b>.
        Mismo formato de teléfono, o dejalo vacío si no hay.
        Entra aunque la lista esté llena. Le podés mandar su pase ahí mismo.</p>
        <p><b>Sótano Club</b> está abajo de todo en <b>Calendario</b>: todos los que
        se anotaron alguna vez, juntados por teléfono. No hay que darlos de
        alta — anotarse a una noche ya es el alta. De cada uno ves cuántas
        noches vino, cuántas veces entró y cuándo fue la última. Se busca por
        nombre o por teléfono.</p>
        <p>Del lado de la persona, su pase <b>es</b> la app de Sótano Club: la puede
        instalar en su celular desde el pase, queda con su propio ícono claro
        —distinto del de la carta y del de la barra— y abre directo en su
        entrada, aunque abajo no haya señal.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'La plata de Sótano',
      cuerpo: `
        <p>La pestaña <b>Administración</b> es donde vive toda la plata: la
        caja, las cuentas de los proveedores, lo que costó la mercadería y
        cuánto deja cada trago. El <b>Depósito</b> de al lado solo dice qué
        hay guardado.</p>
        <p>Arriba, la <b>caja</b>: lo de los eventos y lo de los días comunes,
        lo que entra y lo que sale. Elegís <b>Hoy</b>, <b>Este mes</b> o
        <b>Todo</b>.</p>
        <p>Lo que entra se parte en <b>efectivo</b> y <b>virtual</b>. Lo que
        salió son los <b>gastos</b> que cargás vos o Guille: proveedor, sueldo,
        insumo, retiro de plata. La barra no los puede cargar ni ver.</p>
        <p>El número que más sirve es <b>“en el cajón debería haber”</b>: el
        efectivo cobrado menos los gastos pagados en efectivo. Si no coincide
        con lo que hay, falta plata o falta cargar un gasto.</p>
        <p><b>Quién vendió</b> muestra el ranking por barman. Solo sirve si en
        la barra eligieron quién atiende; si no, cae en “sin registrar”.</p>
        <p><b>Proveedores</b> es la cuenta corriente de cada uno: lo que se le
        compró a cuenta suma, lo que se le pagó resta, y al lado de cada
        renglón queda cuánto se le debía en ese momento. Se abre tocando su
        nombre, y desde ahí también se corrige si quedó mal escrito.</p>
        <p><b>Mercadería</b> es el ingreso de lo que comprás y el histórico de
        lo que entró. Es también donde está <b>Poner al día el depósito</b>,
        para completar de una vez el proveedor y el precio de todo lo que ya
        está cargado.</p>
        <p><b>Costos y márgenes</b> cruza el precio de venta de cada producto
        con lo que cuesta hacerlo, y te dice cuánta plata deja y qué
        porcentaje es. El que dice “sin costo cargado” es porque le falta la
        receta o el precio del insumo.</p>
        <p>Abajo, <b>noche por noche</b>: el histórico de eventos cerrados, que
        podés ordenar por fecha o por facturación.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'La caja',
      cuerpo: `
        <p>La caja de la noche suma <b>solo los pedidos entregados</b>. Un pedido
        que quedó en Preparando no existe para la caja.</p>
        <p>Si marcaste un pedido entregado por error, en el ticket hay un <b>↩</b>
        para cancelarlo o devolverlo a Listo. Sin eso la caja queda mal para
        siempre.</p>
        <p>Abajo de todo, <b>Caja general</b>: lo facturado de todas las noches,
        el ticket promedio, cuál fue la mejor noche y qué se vende más. Lo podés
        ordenar por fecha o por facturación, y abrir cada noche para ver qué se
        vendió.</p>
        <p>Los números de una noche cerrada <b>no se mueven</b> aunque mañana
        cambies un precio.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'Usuarios: quién entra y qué ve',
      cuerpo: `
        <p>La pestaña <b>Usuarios</b> la ve solo un <b>superadmin</b>. Ahí está
        todo lo de las cuentas: quién entra, con qué nivel, y qué pantallas ve
        cada administrador.</p>
        <p>Los niveles van de arriba abajo: <b>dueño</b> (vos, por tu mail),
        <b>superadmin</b>, <b>administrador</b>, y después barman, puerta y el
        celular del local. La única diferencia entre superadmin y administrador,
        por ahora, es que el superadmin reparte permisos.</p>
        <p>Las casillas son las siete pantallas. Lo que está apagado
        <b>no se ve y no se puede hacer</b>: no es que se esconda el botón, es
        que la operación se rechaza aunque alguien sepa el camino.</p>
        <p>Tres cosas que la app no deja hacer, a propósito: nadie edita su
        propio acceso —ni el superadmin—, un administrador no puede hacer
        superadmin a nadie ni tocar a uno, y a vos nadie te puede sacar el
        acceso, porque el tuyo sale de tu mail y no de un documento.</p>
        <p>Al barman, a la puerta y al celular del local no se les eligen
        pantallas: a ellos los limita el rol. Y si alguien no tiene nada
        configurado, ve lo de siempre — que esta pantalla exista no le saca
        nada a nadie.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'Personal: los niveles',
      cuerpo: `
        <p>En la pestaña <b>Usuarios</b>. Se registran una vez y después los
        asignás a cada noche desde <b>Noche → De turno</b>.</p>
        <p><b>Administrador</b> — todo lo que podés vos menos borrar. Cuenta
        permanente, no depende del evento.</p>
        <p><b>Barman</b> — mueve pedidos y marca agotado. Ve precios y caja.
        <b>Solo entra la noche en que está asignado.</b> Es para el celular
        propio de cada uno.</p>
        <p><b>Celular de la barra</b> — la cuenta del aparato que vive en el
        local, siempre prendida: el bar vende todos los días, no solo las
        noches de evento. No depende del turno. Adentro se elige <b>quién
        atiende</b>, y eso queda en cada venta. Ojo: eso es una etiqueta, no
        una contraseña — cualquiera que agarre ese celular puede tocar otro
        nombre.</p>
        <p><b>Puerta</b> — solo la pantalla de puerta. No ve caja, pedidos ni
        carta. También solo la noche que trabaja.</p>
        <p><b>Dar de baja</b> le corta el acceso al toque, aunque tenga la app
        abierta. Para sacar a alguien de una noche puntual, mejor usá
        <b>De turno → Cambiar</b>.</p>`,
    },
    {
      quien: ['barra'],
      titulo: 'Este celular es el del local',
      cuerpo: `
        <p>Esta cuenta es del <b>aparato</b>, no de una persona: queda prendida
        siempre y no depende de ninguna noche, porque el bar vende todos los
        días.</p>
        <p>Por eso, antes de arrancar el turno tocá <b>👤</b> arriba y elegí
        <b>quién está atendiendo</b>. Eso queda guardado en cada venta y es lo
        que después muestra el ranking de la casa.</p>
        <p>De acá se ven <b>Pedidos</b>, <b>Carta</b> (con el stock y el conteo),
        <b>Depósito</b> y <b>Noche</b>. La caja general, el calendario y la
        puerta son de otras cuentas.</p>
        <p>El <b>Depósito</b> es para mirar: lo que hay guardado y qué se está
        por acabar, para no prometer un trago que no se puede hacer. No se
        carga mercadería desde acá, ni se ven precios ni lo que se le debe a
        los proveedores — eso es de la casa.</p>
        <p><b>No toques Salir</b> salvo que la casa te lo pida: para volver a
        entrar hace falta la contraseña del local.</p>`,
    },
    {
      quien: ['admin', 'barman', 'barra'],
      titulo: 'El tablero de pedidos',
      cuerpo: `
        <p>Los pedidos entran en <b>Entraron</b> y se mueven con un toque:
        Entraron → Preparando → Listo → Entregado.</p>
        <p>Cuando lo pasás a <b>Listo</b>, al cliente le suena el celular, le
        vibra y le aparece un cartel. Viene a buscarlo a la barra.</p>
        <p>El ticket dice <b>quién pidió</b>. Si dice <b>invitado</b> en dorado,
        es alguien que la puerta verificó.</p>
        <p>Un ticket que lleva mucho tiempo se marca en rojo.</p>
        <p>La <b>✕</b> cancela un pedido.</p>`,
    },
    {
      quien: ['admin', 'barman', 'barra'],
      titulo: 'Cobrar y vender en la barra',
      cuerpo: `
        <p>Al pasar un pedido a <b>Entregado</b> pregunta cómo pagó:
        <b>Efectivo</b> o <b>Virtual</b>. Un toque, y no se puede saltear: esa
        es toda la contabilidad del bar.</p>
        <p>Si el cliente eligió <b>transferencia</b> desde la carta, el pedido
        entra cuando toca <b>Ya transferí</b> y el ticket lo dice en naranja:
        <i>falta que la casa la confirme</i>. Se prepara igual, pero no se
        entrega hasta que un administrador la ve en el banco y toca
        <b>Cobrado</b> —en el ticket o en la <b>🔔 campanita</b> de arriba, que
        cuenta cuántas hay por confirmar—. Confirmada, Entregado no pregunta
        nada: la plata ya está.</p>
        <p>El que compra en el mostrador no usa la app. Para eso está
        <b>+ Venta en la barra</b>, arriba de los pedidos: tocás los productos,
        ves el total y cobrás. Entra a la caja como cualquier venta.</p>
        <p>Si el bar vende un día que no es de evento, va a la <b>caja del
        día</b>. El día corta a las 6 de la mañana: lo que se vende a las 3 AM
        es de la noche anterior.</p>
        <p>En el celular de la barra, arriba está <b>👤 quién atiende</b>.
        Elegilo al empezar el turno, de la lista: es lo que queda guardado en
        cada venta. Si cambia la gente en la barra, cambialo.</p>`,
    },
    {
      quien: ['admin', 'barman', 'barra'],
      titulo: 'Cuando el ticket se pone rojo con un aviso',
      cuerpo: `
        <p>Dice <b>"Total informado ≠ carta"</b>: el precio que mandó el celular
        del cliente no coincide con la carta. <b>Cobrá lo que dice la carta</b>,
        que es el número que te muestra abajo.</p>
        <p>Dice <b>"Tiene algo que no está en la carta"</b>: el pedido trae un
        producto que no existe. <b>Cobralo a mano</b> y fijate qué pasó.</p>
        <p>No es paranoia: los precios los manda el celular del cliente y se
        pueden falsear. Por eso el panel los recalcula siempre.</p>`,
    },
    {
      quien: ['admin', 'barman', 'barra'],
      titulo: 'Carta y stock',
      cuerpo: `
        <p><b>Agotar</b> marca que se acabó. El cliente lo sigue viendo pero no lo
        puede pedir. <b>Activar</b> lo vuelve a habilitar.</p>
        <p>Los <b>− ∞ +</b> ajustan el stock. En ∞ no se controla.</p>
        <p><b>El stock baja solo al entregar</b>, no al pedir: lo que todavía no
        salió de la barra sigue contando. Si corregís un entregado, vuelve.</p>
        <p><b>🧮 Conteo de la noche</b>: contás lo que hay <b>antes de abrir</b>,
        y al terminar contás de nuevo. La app compara lo que había, lo que se
        vendió y lo que quedó, y te marca en rojo dónde falta.</p>
        <p>El conteo <b>no toca el stock</b>: es control, no inventario. Si
        falta, puede ser rotura, un pedido mal cargado o un vaso que no se
        cobró — el número te dice dónde mirar.</p>
        <p class="solo-admin-ayuda"><b>Sacar</b> retira un producto de la carta: el
        cliente deja de verlo. No se borra, vuelve con <b>Poner en carta</b>.
        Distinto de Agotar, que es "se acabó esta noche".</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'El depósito: insumos y compras',
      cuerpo: `
        <p>La pestaña <b>Depósito</b> es el stock real del local: las botellas,
        latas y paquetes que hay guardados. Es distinto de la carta — la carta
        es lo que se vende, el depósito es lo que se tiene.</p>
        <p><b>+ Insumo</b> da de alta una cosa. Lo importante es
        <b>medidas</b>: cuántos tragos salen de esa botella. Una de fernet de
        750 da unas 10 medidas, entonces ponés 10. Si es algo que se vende
        cerrado —una lata, una cerveza— poné <b>1</b>.</p>
        <p>El <b>costo</b> es lo que te sale a vos, no lo que cobrás. El
        <b>mínimo</b> es el nivel al que querés que te avise: cuando baja de
        ahí, aparece arriba en rojo.</p>
        <p>El <b>costo</b> y el proveedor de cada insumo se cargan en
        <b>Administración → Mercadería</b>: es plata, y la plata vive toda en
        el mismo lugar.</p>
        <p><b>Cargar el stock inicial</b>: la primera vez, entrás por
        <b>Administración → Ingreso de mercadería</b> y elegís <b>Carga
        inicial</b>. Suma todo lo que ya tenés sin descontar plata de la caja,
        porque esa plata ya salió hace rato.</p>
        <p>De ahí en adelante, cada compra entra por <b>Ingreso de
        mercadería</b> con el proveedor y las unidades. <b>Pagada</b> la
        descuenta de la caja en el momento. <b>A cuenta</b> la deja como deuda
        con ese proveedor hasta que le pagues: la ves en
        <b>Administración → Proveedores</b>, y al pagarle queda como gasto.</p>
        <p><b>La receta</b> es lo que une las dos cosas. En <b>Carta y stock</b>,
        el botón de receta de cada producto dice de qué insumo sale y cuántas
        medidas lleva. Un fernet con coca lleva 1 medida de fernet: al
        entregarlo, baja <b>una medida</b> del depósito, no una botella.</p>
        <p>Un producto sin receta no toca el depósito. Eso está bien para cosas
        que no salen de una botella.</p>
        <p>La <b>✕</b> roja da de baja un insumo: pide el motivo, que queda
        registrado con tu nombre. Si un trago de la carta sale de ese insumo,
        no te deja hasta que lo saques de la receta — si no, el trago se
        agotaría solo y nadie entendería por qué.</p>
        <p>Esto lo cargás vos o un administrador con su cuenta. <b>Desde el
        celular de la barra no se puede</b>: ese aparato ve el depósito para
        saber qué hay —sin precios, sin compras y sin la deuda— y descuenta al
        entregar, pero no da de alta mercadería ni le pone precio. Vive
        prendido arriba del mostrador y lo levanta cualquiera.</p>`,
    },
    {
      quien: ['admin', 'puerta'],
      titulo: 'Controlar la entrada',
      cuerpo: `
        <p><b>Escanear pase</b> abre la cámara. Apuntá al QR del invitado y se
        marca solo. Al marcarlo te muestra <b>el teléfono con el que se anotó</b>:
        si dudás, pedile los últimos números.</p>
        <p><b>Un pase, una entrada.</b> Si el QR ya se usó, el segundo que lo
        muestre no entra, aunque sea otro celular: te dice a qué hora entró el
        primero. No es la pantalla la que se acuerda, es la base.</p>
        <p>Si la cámara no abre o el QR no se lee, <b>buscalo por nombre o
        teléfono</b> y tocá <b>Entró</b>.</p>
        <p>Te equivocaste: <b>Deshacer</b> lo saca, y ahí sí puede volver a
        entrar una vez.</p>
        <p>Arriba ves <b>cuántos entraron contra el cupo</b>. Cuando se llena,
        avisa en rojo.</p>
        <p>La lista va en dos grupos: <b>Faltan entrar</b> abierto y <b>Ya
        entraron</b> cerrado. Al marcar a alguien pasa de uno al otro, por eso
        la lista se va achicando sola a medida que entra la gente.</p>
        <p>Alguien que no está en la lista: avisale a la casa. La lista no se
        agranda desde la puerta.</p>`,
    },
    {
      quien: ['admin', 'barman', 'barra', 'puerta'],
      titulo: 'Si algo no anda',
      cuerpo: `
        <p><b>"sin conexión"</b> en rojo: se cortó internet. Lo que ves es lo
        último que llegó. Vuelve solo.</p>
        <p><b>"Esto todavía no está listo"</b>: la base está armando algo por
        dentro. Esperá unos minutos; el resto del panel anda igual.</p>
        <p><b>"Se cerró tu turno"</b>: te dieron de baja o la noche terminó.
        Hablá con la casa.</p>
        <p><b>Se ve raro o faltan cosas</b>: tocá <b>↻</b>. Arregla casi todo.</p>`,
    },
  ];

  function pintar(rol) {
    const mios = TEMAS.filter((t) => t.quien.includes(rol));
    $('#temasAyuda').innerHTML = mios.map((t, i) => `
      <details class="tema" ${i === 0 ? 'open' : ''}>
        <summary>${esc(t.titulo)}</summary>
        <div class="cuerpo-tema">${t.cuerpo}</div>
      </details>`).join('');
    $('#quienAyuda').textContent = {
      admin: 'Administrador — tenés todo',
      barman: 'Barman',
      barra: 'Celular de la barra',
      puerta: 'Puerta',
    }[rol] || '';
    // Dentro de la ayuda del barman, lo que es solo de admin no va.
    if (rol !== 'admin') {
      $('#temasAyuda').querySelectorAll('.solo-admin-ayuda').forEach((e) => e.remove());
    }
  }

  // El rol lo decide el panel (bar.js) y lo deja en el body; acá solo se lee.
  function miRol() {
    const c = document.body.classList;
    if (c.contains('es-dueno') || c.contains('es-gerente')) return 'admin';
    if (c.contains('es-puerta')) return 'puerta';
    // El celular del local: lo suyo se parece a lo del barman, pero tiene su
    // propia pantalla de "quién atiende" y no depende de ningún turno.
    if (c.contains('es-aparato')) return 'barra';
    return 'barman';
  }

  window.abrirAyuda = () => {
    pintar(miRol());
    $('#dlgAyuda').showModal();
  };

  function enganchar() {
    document.querySelectorAll('[data-ayuda]').forEach((b) => b.onclick = window.abrirAyuda);
    const cerrar = $('#btnCerrarAyuda');
    if (cerrar) cerrar.onclick = () => $('#dlgAyuda').close();
  }
  // El script va al final del body, pero no se da por sentado.
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', enganchar);
  else enganchar();
})();
