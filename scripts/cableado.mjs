// El mapa del cableado: quién escribe cada dato y quién lo dibuja.
//
// El error que cometí cinco veces en una semana, siempre igual: una pantalla
// lee estado.X, pero el escucha que escribe estado.X no la vuelve a dibujar.
// La pantalla se queda con la foto de antes y nadie se entera hasta que un
// cliente lo nota. Pasó con el Club, con el candado de la baja, con las
// recetas rotas, con el depósito acusando con la carta vacía y con el aviso
// de la noche abierta, que directamente no se mostraba nunca.
//
// Mirarlo a ojo no sirve: son veinticuatro datos y treinta pantallas. Esto lo
// cuenta. Lo usa un test, así que la próxima vez falla antes de publicar.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'public/barra');

// Las pantallas que viven dentro de un diálogo se arman al abrirlo, con el
// dato fresco. No se quedan viejas: no hay nada que repintar.
const DIALOGOS = new Set(['pintarCompra', 'pintarAlDia', 'pintarMarcas',
                          'pintarElegirBarman', 'pintarCartaDeFecha', 'pintarReceta']);

// Recorta el bloque que arranca en el primer `abre` desde `desde`, por balance.
function bloque(s, desde, abre = '{', cierra = '}') {
  let prof = 0, j = s.indexOf(abre, desde);
  if (j < 0) return '';
  const ini = j;
  do {
    if (s[j] === abre) prof++;
    else if (s[j] === cierra) prof--;
    j++;
  } while (prof > 0 && j < s.length);
  return s.slice(ini, j);
}

const llamadas = (txt, propio) =>
  [...txt.matchAll(/\b(\w+)\s*\(/g)].map((x) => x[1]).filter((x) => x !== propio);

export function auditarCableado() {
  const fuente = new Map(readdirSync(DIR).filter((f) => f.endsWith('.js'))
    .map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));

  // 1. Qué escribe cada escucha y a quién llama.
  const escuchas = [];
  for (const [f, s] of fuente) {
    let i = 0;
    while ((i = s.indexOf('onSnapshot(', i)) !== -1) {
      const cuerpo = bloque(s, i, '(', ')');
      escuchas.push({
        f, linea: s.slice(0, i).split('\n').length,
        escribe: [...new Set([...cuerpo.matchAll(/estado\.(\w+)\s*=/g)].map((m) => m[1]))],
        llama: [...new Set(llamadas(cuerpo))],
      });
      i += Math.max(cuerpo.length, 1);
    }
  }

  // 2. Quién llama a quién, y qué lee cada pantalla.
  const llama = new Map();
  const lee = new Map();
  for (const [, s] of fuente) {
    const re = /(?:export )?(?:async )?function (\w+)\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const cuerpo = bloque(s, m.index);
      llama.set(m[1], new Set([...(llama.get(m[1]) || []), ...llamadas(cuerpo, m[1])]));
      if (m[1].startsWith('pintar')) {
        const campos = [...cuerpo.matchAll(/estado\.(\w+)/g)].map((x) => x[1]);
        lee.set(m[1], new Set([...(lee.get(m[1]) || []), ...campos]));
      }
    }
  }

  const alcanza = (raices) => {
    const vistos = new Set(raices), cola = [...raices];
    while (cola.length) {
      for (const h of llama.get(cola.pop()) || []) {
        if (!vistos.has(h)) { vistos.add(h); cola.push(h); }
      }
    }
    return vistos;
  };

  // 3. Cruzar: por cada dato, las pantallas que lo leen contra las que su
  //    escucha alcanza a repintar.
  const porCampo = new Map();
  for (const e of escuchas) {
    for (const c of e.escribe) porCampo.set(c, [...(porCampo.get(c) || []), e]);
  }

  const huecos = [];
  for (const [campo, evs] of porCampo) {
    const repinta = alcanza(evs.flatMap((e) => e.llama));
    for (const [pantalla, campos] of lee) {
      if (!campos.has(campo)) continue;
      if (repinta.has(pantalla) || DIALOGOS.has(pantalla)) continue;
      huecos.push({ campo, pantalla, donde: evs.map((e) => `${e.f}:${e.linea}`).join(' ') });
    }
  }
  return { huecos, datos: porCampo.size, pantallas: lee.size };
}

// Corriéndolo a mano imprime el informe; el test solo mira los huecos.
if (process.argv[1] && process.argv[1].endsWith('cableado.mjs')) {
  const { huecos, datos, pantallas } = auditarCableado();
  console.log(`\n  ${datos} datos · ${pantallas} pantallas\n`);
  if (!huecos.length) console.log('  ✓ no hay pantallas que se queden con la foto vieja\n');
  for (const h of huecos) {
    console.log(`  ✗ ${h.pantalla} lee estado.${h.campo} — escrito en ${h.donde}, que no la repinta`);
  }
  if (huecos.length) console.log(`\n  ${huecos.length} hueco(s)\n`);
  process.exit(huecos.length ? 1 : 0);
}
