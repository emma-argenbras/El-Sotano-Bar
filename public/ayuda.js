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
      quien: ['admin', 'barman', 'puerta'],
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
        como un bar común.</p>`,
    },
    {
      quien: ['admin'],
      titulo: 'Arrancar y cerrar la noche',
      cuerpo: `
        <p><b>Arrancar</b> abre la noche: desde ese momento entran pedidos y la
        caja cuenta. El tablero mira desde ahí, no desde las 00:00 — una noche de
        bar no termina a medianoche.</p>
        <p><b>Cerrar evento y hacer la caja</b> congela los números y la manda al
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
        <p>El link es <b>uno solo</b> para todo el bar y lleva a <b>una</b> noche:
        la última que agendaste con cupo. Si tenés dos agendadas y querés que la
        gente se anote a la otra, entrá a sus <b>Invitaciones</b> y tocá <b>Pasar
        el link a esta noche</b>. El cartel rojo te avisa cuando el link está
        apuntando a otra.</p>
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
        Entra aunque la lista esté llena. Le podés mandar su pase ahí mismo.</p>`,
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
      titulo: 'Personal: quién es quién',
      cuerpo: `
        <p>En <b>Evento → Personal</b>. Se registran una vez y después los asignás
        a cada noche.</p>
        <p><b>Administrador</b> — todo lo que podés vos menos borrar. Cuenta
        permanente, no depende del evento.</p>
        <p><b>Barman</b> — mueve pedidos y marca agotado. Ve precios y caja.
        <b>Solo entra la noche en que está asignado.</b></p>
        <p><b>Puerta</b> — solo la pantalla de puerta. No ve caja, pedidos ni
        carta. También solo la noche que trabaja.</p>
        <p><b>Dar de baja</b> le corta el acceso al toque, aunque tenga la app
        abierta. Para sacar a alguien de una noche puntual, mejor usá
        <b>De turno → Cambiar</b>.</p>`,
    },
    {
      quien: ['admin', 'barman'],
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
      quien: ['admin', 'barman'],
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
      quien: ['admin', 'barman'],
      titulo: 'Carta y stock',
      cuerpo: `
        <p><b>Agotar</b> marca que se acabó. El cliente lo sigue viendo pero no lo
        puede pedir. <b>Activar</b> lo vuelve a habilitar.</p>
        <p>Los <b>− ∞ +</b> ajustan el stock. En ∞ no se controla.</p>
        <p><b>El stock no baja solo</b> al entregar: hay que ajustarlo a mano.</p>
        <p class="solo-admin-ayuda"><b>Sacar</b> retira un producto de la carta: el
        cliente deja de verlo. No se borra, vuelve con <b>Poner en carta</b>.
        Distinto de Agotar, que es "se acabó esta noche".</p>`,
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
      quien: ['admin', 'barman', 'puerta'],
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
