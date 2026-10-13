/**
 * Объёмная отрисовка предметов.
 *
 * Зачем третий набор рисунков, когда есть item-art.js и item-art64.js. Те
 * подбирали мотив по ключевому слову названия: «Путь воина» и «Первый удар»
 * оба содержали клинок и получали один и тот же значок. На 820 названий
 * приходилось 120 мотивов, и внутри одного кейса карточки повторялись.
 *
 * Здесь у КАЖДОГО предмета свой рисунок, а этот файл - только кисть: из чего
 * рисунок состоит и как на нём лежит свет. Сами рисунки - в файлах тем рядом.
 *
 * Почему кисть, а не готовые картинки. 820 растровых файлов - это десятки
 * мегабайт на телефон игрока и перерисовка всех при смене стиля. Здесь рисунок
 * это десяток строк, а глянец, фаска и тень ложатся одинаково на все сразу.
 *
 * СВЕТ ВСЕГДА СЛЕВА СВЕРХУ. Блик в левом верхнем углу формы, тень в правом
 * нижнем, грани камня темнеют по мере того, как отворачиваются от света. Если
 * хоть один рисунок осветить справа, лента прочитается как коллаж из разных
 * наборов - глаз ловит это раньше, чем успевает понять, что не так.
 */

/*
 * Все имена верхнего уровня начинаются с HD или hd: автономная сборка
 * складывает модули клиента в одну область видимости, и короткие имена
 * (`seq`, `mat`, `tone`) уже заняты в других файлах.
 */
let hdSeq = 0;

/*
 * Материал - четыре тона от блика к глубокой тени и глянец (0..1).
 *
 * Тона не получены затемнением одного цвета, и это главное, что делает рисунок
 * насыщенным, а не векторным: блик у золота уходит в жёлтый, тень в
 * коричнево-красный, у стали блик холодный, а тень синеватая. Простое
 * затемнение даёт серо-грязную тень - ровно то «векторное» ощущение, от
 * которого уходили.
 */
export const HD_MAT = {
  gold:      ['#fff8d0', '#ffcf3f', '#d18a12', '#5e2f03', 0.95],
  oldgold:   ['#fbe7a8', '#d6a63a', '#94631a', '#3d2406', 0.7],
  rosegold:  ['#ffe6dc', '#f4a98c', '#c06a54', '#4f221b', 0.9],
  silver:    ['#ffffff', '#dfe5ee', '#98a5b6', '#323b49', 0.95],
  chrome:    ['#ffffff', '#c9d4e2', '#5c6b80', '#161c28', 1],
  steel:     ['#f2f6fb', '#b9c4d2', '#6b7889', '#212833', 0.85],
  iron:      ['#a3acb8', '#5d6670', '#363d45', '#111418', 0.5],
  blacksteel:['#8f9ab2', '#323847', '#191c24', '#06070b', 0.8],
  bronze:    ['#ffe2b0', '#d1914a', '#8f5524', '#361b09', 0.8],
  copper:    ['#ffd7c0', '#e2814f', '#a64a28', '#43170b', 0.85],
  brass:     ['#fff2bf', '#dcb557', '#9a7424', '#3c2a08', 0.85],
  red:       ['#ffa3a3', '#ec1f30', '#9e0b1d', '#360108', 1],
  crimson:   ['#ff8fa0', '#c8103c', '#7c0624', '#270109', 1],
  black:     ['#8d93a6', '#2b2f3b', '#14161d', '#020203', 1],
  porcelain: ['#ffffff', '#eef2f7', '#bfc9d8', '#5e6a7c', 0.9],
  ivory:     ['#fffbea', '#efe2c2', '#c4ad83', '#5c4a2c', 0.6],
  bone:      ['#fffdf2', '#e8dcc0', '#b5a27c', '#4e4026', 0.5],
  wood:      ['#f6c991', '#b9763a', '#7a4620', '#2e1606', 0.35],
  darkwood:  ['#c08a5f', '#6e3d1e', '#45230e', '#160902', 0.45],
  bamboo:    ['#f6fbb8', '#bcd24f', '#6f8a1e', '#263306', 0.55],
  straw:     ['#fff4bd', '#eac666', '#b38a2e', '#4f360b', 0.3],
  paper:     ['#fffef8', '#f3ead4', '#cbbd99', '#6e5e3e', 0.2],
  parchment: ['#fff4d4', '#e8d099', '#b8995a', '#54401b', 0.25],
  leather:   ['#e8ad7d', '#9c5a2e', '#653416', '#250f04', 0.45],
  jade:      ['#dcffea', '#3fcf86', '#1a8a55', '#05341e', 0.95],
  emerald:   ['#ccffe2', '#13d67a', '#06854a', '#012b16', 1],
  ruby:      ['#ffd2da', '#ff2e55', '#b00a2c', '#3e000d', 1],
  sapphire:  ['#d6e8ff', '#2f6dff', '#1636a8', '#050f38', 1],
  amethyst:  ['#f2dbff', '#b04dff', '#6a1bb8', '#21073d', 1],
  topaz:     ['#fff2c9', '#ffb534', '#c46b0a', '#452002', 1],
  diamond:   ['#ffffff', '#e2f7ff', '#93d2ff', '#365f8f', 1],
  ice:       ['#ffffff', '#c0efff', '#5fb7e8', '#174469', 1],
  glass:     ['#ffffff', '#d3f0ff', '#83bdd8', '#264f63', 0.9],
  water:     ['#e2fbff', '#3fc2ff', '#0f6fc0', '#041f42', 0.9],
  obsidian:  ['#b0a2d4', '#2e2343', '#160f24', '#040209', 1],
  lava:      ['#fff3ad', '#ff8a1e', '#d1260f', '#3f0504', 0.6],
  neonpink:  ['#ffd9f1', '#ff2ea6', '#b0006a', '#380024', 1],
  neoncyan:  ['#e3ffff', '#2ef3ff', '#0099b8', '#002f3d', 1],
  neongreen: ['#eaffdc', '#3dff7a', '#09b046', '#023514', 1],
  plasma:    ['#f4e2ff', '#b45cff', '#6a10d0', '#1e0438', 1],
  toxic:     ['#f7ffcf', '#b6ff1f', '#62b000', '#1b3500', 0.9],
  carbon:    ['#959dab', '#3b4048', '#1f2228', '#08090b', 0.7],
  rubber:    ['#70747e', '#30333a', '#1b1d22', '#060708', 0.3],
  stone:     ['#ece5d7', '#a99d89', '#6f6454', '#29231b', 0.2],
  granite:   ['#cfccd6', '#86828f', '#4f4b57', '#1a181e', 0.25],
  sand:      ['#fff5d3', '#efce86', '#c09a4c', '#5a4014', 0.2],
  marble:    ['#ffffff', '#ece9f2', '#b9b3c7', '#55506a', 0.7],
  pearl:     ['#ffffff', '#f8eff7', '#d6c4dd', '#7d6b8b', 1],
  coral:     ['#ffe2d8', '#ff7a5c', '#cf3f2d', '#521007', 0.7],
  snow:      ['#ffffff', '#f2f9ff', '#c4d9ee', '#627c9a', 0.6],
  fur:       ['#f7ecda', '#c7a57c', '#8a6640', '#33220f', 0.2],
};

/* ---------- Цвет ---------- */

function hdHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hdHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Поворот оттенка к цели на долю пути - по короткой дуге. */
const hdToward = (h, target, k) => h + ((((target - h) % 360) + 540) % 360 - 180) * k;

/*
 * Четыре тона из одного цвета. Блик уходит к тёплому жёлтому, тень к
 * холодному фиолетовому - так пишут маслом, и именно этот сдвиг отличает
 * объём от затемнения. Насыщенность тени выше, чем у основы: тень, которая
 * сереет, выглядит как грязь, а не как глубина.
 */
export function hdTone(hex, gloss = 0.75) {
  const [h, s, l] = hdHsl(hex);
  return [
    hdHex(hdToward(h, 55, 0.22), s * 0.92, l + (1 - l) * 0.66),
    hex,
    hdHex(hdToward(h, 255, 0.12), s * 1.08, l * 0.64),
    hdHex(hdToward(h, 262, 0.22), s * 1.12, l * 0.26),
    gloss,
  ];
}

/** Смешение двух цветов, t от 0 до 1. */
export function hdMix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

/*
 * Контур - тёмный тон своего же материала, а не общий чёрный. Чёрный контур
 * вокруг золота и вокруг льда делает из них наклейки одного листа; свой тёмный
 * тон держит силуэт и не спорит с материалом.
 */
const hdInkOf = (t) => hdMix(t[3], '#06020c', 0.45);

/* ---------- Градиенты ---------- */

const hdStops = (list) => list.map(([o, c, a = 1]) =>
  `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('');

const hdLin = (id, x1, y1, x2, y2, stops) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${hdStops(stops)}</linearGradient>`;

/*
 * Виды заливки. Градиенты считаются по рамке КАЖДОЙ формы отдельно
 * (objectBoundingBox), поэтому одна и та же заливка на рукояти и на клинке
 * даёт каждому свой объём, а не один общий перелив на весь рисунок.
 *
 *   d  диагональ - основной: свет слева сверху
 *   v  сверху вниз - плоские стоячие формы, ткань, флаги
 *   c  цилиндр поперёк ширины - стоячие бутылки, колонны, свечи
 *   h  цилиндр поперёк высоты - лежачие трубы, рукояти, слитки
 *   m  полированный металл - чередование отражений, клинки и хром
 *   r  сфера
 */
const HD_GRAD = {
  d: (id, t) => hdLin(id, 0, 0, 0.75, 1,
    [[0, t[0]], [0.3, t[1]], [0.72, t[2]], [1, t[3]]]),
  v: (id, t) => hdLin(id, 0, 0, 0, 1,
    [[0, t[0]], [0.42, t[1]], [1, t[3]]]),
  c: (id, t) => hdLin(id, 0, 0, 1, 0,
    [[0, t[3]], [0.14, t[2]], [0.34, t[0]], [0.5, t[1]], [0.82, t[2]], [1, t[3]]]),
  h: (id, t) => hdLin(id, 0, 0, 0, 1,
    [[0, t[3]], [0.14, t[2]], [0.34, t[0]], [0.5, t[1]], [0.82, t[2]], [1, t[3]]]),
  m: (id, t) => hdLin(id, 0, 0, 1, 0.7,
    [[0, t[2]], [0.2, t[0]], [0.38, t[1]], [0.5, t[3]], [0.62, t[1]], [0.82, t[0]], [1, t[2]]]),
  r: (id, t) => `<radialGradient id="${id}" cx="0.4" cy="0.36" r="0.75" fx="0.3" fy="0.24">` +
    hdStops([[0, t[0]], [0.3, t[1]], [0.78, t[2]], [1, t[3]]]) + '</radialGradient>',
};

/* ---------- Геометрия ---------- */

const hdN = (v) => Math.round(v * 100) / 100;

/** Прямоугольник со скруглением как путь: фаске и обрезке нужен путь. */
export function hdRect(x, y, w, h, r = 0) {
  r = Math.min(r, w / 2, h / 2);
  if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}` +
    `a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}` +
    `v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

export function hdEll(cx, cy, rx, ry = rx) {
  return `M${hdN(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${hdN(2 * rx)} 0a${rx} ${ry} 0 1 0 ${hdN(-2 * rx)} 0Z`;
}

/** Правильный многоугольник; rot в градусах, -90 ставит вершину вверх. */
export function hdNgon(cx, cy, r, n, rot = -90, sy = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (rot + (i * 360) / n) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a) * sy]);
  }
  return pts;
}

export const hdPoly = (pts) => 'M' + pts.map(([x, y]) => `${hdN(x)} ${hdN(y)}`).join('L') + 'Z';

/** Звезда: n лучей, внешний и внутренний радиусы. */
export function hdStar(cx, cy, r1, r2, n = 5, rot = -90) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (rot + (i * 180) / n) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return hdPoly(pts);
}

/* ---------- Кисть ---------- */

/**
 * Кисть одной отрисовки.
 *
 * Id градиентов уникален на каждый вызов: повторись он - и url(#...) во всех
 * карточках ленты разрешился бы в первый по порядку, и вся лента взяла бы
 * цвета первой плитки. На этом уже ломалось item-art.js.
 */
export function hdKit() {
  const id = `hd${(hdSeq++).toString(36)}`;
  const defs = new Map();
  let clip = 0;

  /** Материал по имени, по цвету или готовым набором тонов. */
  const tone = (m) => {
    if (Array.isArray(m)) return m;
    if (m[0] === '#') return hdTone(m);
    const t = HD_MAT[m];
    if (!t) throw new Error(`hd: неизвестный материал ${m}`);
    return t;
  };
  const key = (m) => Array.isArray(m) ? 'a' + m[1].slice(1) : m[0] === '#' ? 'x' + m.slice(1) : m;

  const fill = (m, kind = 'd') => {
    const gid = `${id}${key(m)}${kind}`;
    if (!defs.has(gid)) defs.set(gid, HD_GRAD[kind](gid, tone(m)));
    return `url(#${gid})`;
  };

  const sheenId = `${id}sh`;
  const sheen = () => {
    if (!defs.has(sheenId)) {
      defs.set(sheenId, `<radialGradient id="${sheenId}" cx="0.3" cy="0.16" r="0.78">` +
        hdStops([[0, '#ffffff', 0.85], [0.42, '#ffffff', 0.16], [1, '#ffffff', 0]]) +
        '</radialGradient>');
    }
    return `url(#${sheenId})`;
  };

  const radial = (name, stops, cx = 0.5, cy = 0.5, r = 0.5) => {
    const gid = `${id}${name}`;
    if (!defs.has(gid)) {
      defs.set(gid, `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="${r}">${hdStops(stops)}</radialGradient>`);
    }
    return `url(#${gid})`;
  };

  const k = {
    tone,
    fill,

    /**
     * Объёмная форма: заливка материалом, контур своим тёмным тоном и глянец
     * по той же форме. Глянец - это повтор пути с белым радиальным пятном,
     * а не фильтр: SVG-фильтры на шестидесяти плитках ленты тормозят прокрут
     * во встроенном браузере Telegram, а повтор пути не стоит ничего.
     *
     * o.b - фаска: светлая кромка по верхнему левому краю изнутри и тёмная по
     *       нижнему правому. Делает плоскую плашку литой.
     * o.g - сила глянца поверх материала, o.w - толщина контура.
     */
    p(d, m, kind = 'd', o = {}) {
      const t = tone(m);
      const ink = o.ink || hdInkOf(t);
      const w = o.w ?? 1.6;
      const gloss = o.g ?? t[4];
      let s = `<path d="${d}" fill="${fill(m, kind)}"` +
        (w ? ` stroke="${ink}" stroke-width="${w}" stroke-linejoin="round"` : '') +
        (o.op ? ` opacity="${o.op}"` : '') + '/>';
      if (o.b) {
        const cid = `${id}c${clip++}`;
        defs.set(cid, `<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
        const bw = o.bw ?? 2.6;
        s += `<g clip-path="url(#${cid})" fill="none" stroke-linejoin="round">` +
          `<path d="${d}" stroke="${t[0]}" stroke-width="${bw}" opacity=".8" transform="translate(1.3 1.6)"/>` +
          `<path d="${d}" stroke="${t[3]}" stroke-width="${bw}" opacity=".55" transform="translate(-1.3 -1.6)"/></g>`;
      }
      if (gloss > 0.05) s += `<path d="${d}" fill="${sheen()}" opacity="${gloss}"/>`;
      return s;
    },

    r(x, y, w, h, rr, m, kind, o) { return k.p(hdRect(x, y, w, h, rr), m, kind, o); },
    e(cx, cy, rx, ry, m, kind, o) { return k.p(hdEll(cx, cy, rx, ry), m, kind, o); },
    c(cx, cy, r, m, kind, o) { return k.p(hdEll(cx, cy, r), m, kind, o); },
    poly(pts, m, kind, o) { return k.p(hdPoly(pts), m, kind, o); },

    /**
     * Шар: жемчуг, ядро, планета, мяч. Кроме сферической заливки у него
     * отражённый свет по нижнему правому краю - без него шар читается
     * диском с градиентом.
     */
    o(cx, cy, r, m, o = {}) {
      const t = tone(m);
      return `<path d="${hdEll(cx, cy, r)}" fill="${fill(m, 'r')}" stroke="${hdInkOf(t)}" stroke-width="${o.w ?? 1.6}"/>` +
        `<path d="M${hdN(cx + r * 0.15)} ${hdN(cy + r * 0.86)}A${r * 0.88} ${r * 0.88} 0 0 0 ${hdN(cx + r * 0.86)} ${hdN(cy + r * 0.12)}" ` +
        `fill="none" stroke="${t[0]}" stroke-width="${hdN(r * 0.09)}" stroke-linecap="round" opacity=".38"/>` +
        `<ellipse cx="${hdN(cx - r * 0.34)}" cy="${hdN(cy - r * 0.42)}" rx="${hdN(r * 0.3)}" ry="${hdN(r * 0.17)}" ` +
        `fill="#fff" opacity="${o.g ?? 0.85}" transform="rotate(-32 ${hdN(cx - r * 0.34)} ${hdN(cy - r * 0.42)})"/>`;
    },

    /**
     * Огранённый камень. Грань темнеет по мере того, как отворачивается от
     * света слева сверху, и каждая грань расколота на две с разным тоном -
     * отсюда игра камня, которой у залитого градиентом многоугольника нет.
     *
     * n - число граней по кругу, t - доля площадки, sy - сплющивание по
     * вертикали (камень под углом), rot - поворот.
     */
    gem(cx, cy, r, m, o = {}) {
      const t = tone(m);
      const n = o.n ?? 8, rot = o.rot ?? -90, sy = o.sy ?? 1, tf = o.t ?? 0.52;
      const out = hdNgon(cx, cy, r, n, rot, sy);
      const inn = hdNgon(cx, cy - r * 0.04, r * tf, n, rot, sy);
      const ramp = [t[3], t[2], t[1], t[0]];
      const shade = (b) => {
        b = Math.min(1, Math.max(0, b)) * 3;
        const i = Math.min(2, Math.floor(b));
        return hdMix(ramp[i], ramp[i + 1], b - i);
      };
      let s = '';
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const mid = (rot + ((i + 0.5) * 360) / n) * Math.PI / 180;
        // Свет приходит из левого верхнего угла: направление (-1,-1).
        const b = (Math.cos(mid - (225 * Math.PI) / 180) + 1) / 2;
        s += `<path d="${hdPoly([inn[i], out[i], out[j]])}" fill="${shade(b * 0.9 + 0.05)}"/>`;
        s += `<path d="${hdPoly([inn[i], out[j], inn[j]])}" fill="${shade(b * 0.9 + 0.2)}"/>`;
      }
      s += `<path d="${hdPoly(inn)}" fill="${fill(m, 'd')}"/>`;
      s += `<path d="${hdPoly(inn)}" fill="${sheen()}" opacity=".7"/>`;
      // Рёбра граней - тонкий светлый штрих: свет на ребре, а не тень.
      s += `<path d="${out.map((p, i) => `M${hdN(p[0])} ${hdN(p[1])}L${hdN(inn[i][0])} ${hdN(inn[i][1])}`).join('')}" ` +
        `stroke="${t[0]}" stroke-width=".6" opacity=".45"/>`;
      s += `<path d="${hdPoly(out)}" fill="none" stroke="${hdInkOf(t)}" stroke-width="${o.w ?? 1.6}" stroke-linejoin="round"/>`;
      return s;
    },

    /** Плоская заливка без света: прорези, тени деталей, рисунок на ткани. */
    f(d, color, op) {
      return `<path d="${d}" fill="${color}"${op != null ? ` opacity="${op}"` : ''}/>`;
    },

    /** Линия без объёма. */
    s(d, color, w = 1.6, op, cap = 'round') {
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" ` +
        `stroke-linejoin="round"${op != null ? ` opacity="${op}"` : ''}/>`;
    },

    /** Блик: белый штрих по ребру. Ставится последним, поверх всего. */
    hl(d, w = 2, op = 0.8) { return k.s(d, '#fff', w, op); },

    /**
     * Трубка: шнур, верёвка, провод, цепь, щупальце. Три штриха один поверх
     * другого: контур, тело и смещённый к свету блик.
     */
    tube(d, m, w = 4, o = {}) {
      const t = tone(m);
      return k.s(d, hdInkOf(t), w + 2.6, o.op) + k.s(d, t[2], w, o.op) +
        `<g transform="translate(${hdN(-w * 0.14)} ${hdN(-w * 0.18)})">` +
        k.s(d, t[1], w * 0.62, o.op) + k.s(d, t[0], w * 0.26, (o.op ?? 1) * 0.9) + '</g>';
    },

    /**
     * Свечение: неон, магия, плазма. Широкие полупрозрачные штрихи вместо
     * размытия - фильтр blur на ленте из шестидесяти плиток слишком дорог.
     */
    glow(d, color, w = 3) {
      return k.s(d, color, w * 5, 0.12) + k.s(d, color, w * 2.6, 0.26) +
        k.s(d, color, w) + k.s(d, '#fff', w * 0.38, 0.9);
    },

    /** Пламя: раскалённое ядро внизу, красные края наверху. */
    fire(d, o = {}) {
      const g = radial('fire', [[0, '#fffbe2'], [0.22, '#ffe066'], [0.5, '#ff8a1e'],
        [0.8, '#e5261b'], [1, '#7a0712']], 0.5, 0.86, 0.9);
      return `<path d="${d}" fill="${g}"${o.op ? ` opacity="${o.op}"` : ''}/>` +
        `<path d="${d}" fill="${sheen()}" opacity=".35"/>`;
    },

    /**
     * Ореол за предметом. Цвет у каждого рисунка свой, и именно он делает
     * карточки одного уровня редкости разными с первого взгляда: рамка у них
     * одного цвета, а свет за предметом - нет.
     */
    aura(color, op = 0.55, r = 47, cx = 50, cy = 48) {
      const g = radial(`au${key(color)}`, [[0, color, op], [0.5, color, op * 0.32], [1, color, 0]]);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${g}"/>`;
    },

    /** Лучи за предметом: только для верхних ступеней, чтобы не обесценить. */
    rays(color, n = 14, op = 0.4, cx = 50, cy = 48) {
      const g = radial(`ra${key(color)}`, [[0, color, op], [0.7, color, op * 0.25], [1, color, 0]], 0.5, 0.5, 0.5);
      let d = '';
      for (let i = 0; i < n; i++) {
        const a1 = ((i * 360) / n) * Math.PI / 180;
        const a2 = a1 + (Math.PI / n) * 0.55;
        d += `M${cx} ${cy}L${hdN(cx + 60 * Math.cos(a1))} ${hdN(cy + 60 * Math.sin(a1))}` +
          `L${hdN(cx + 60 * Math.cos(a2))} ${hdN(cy + 60 * Math.sin(a2))}Z`;
      }
      return `<path d="${d}" fill="${g}"/>`;
    },

    /** Тень под предметом: без неё он висит в воздухе. */
    shadow(cx = 50, cy = 90, rx = 30, ry = 4.6, op = 0.6) {
      const g = radial('shd', [[0, '#000', 1], [0.6, '#000', 0.35], [1, '#000', 0]]);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${g}" opacity="${op}"/>`;
    },

    /** Искра блика: четыре луча и мягкое пятно. */
    spark(x, y, s = 6, color = '#fff') {
      const g = radial('spk', [[0, '#fff', 0.9], [1, '#fff', 0]]);
      return `<circle cx="${x}" cy="${y}" r="${hdN(s * 0.9)}" fill="${g}"/>` +
        `<path d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}` +
        `Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z" fill="${color}"/>`;
    },

    /** Надпись литым шрифтом: числа на фишках, номера, ×2. */
    txt(x, y, str, size, m = 'gold', o = {}) {
      const t = tone(m);
      return `<text x="${x}" y="${y}" font-size="${size}" font-weight="900" text-anchor="middle" ` +
        `font-family="Unbounded, Manrope, system-ui, sans-serif" letter-spacing="${o.ls ?? -0.5}" ` +
        `fill="${fill(m, 'v')}" stroke="${hdInkOf(t)}" stroke-width="${hdN(size * 0.09)}" ` +
        `paint-order="stroke" stroke-linejoin="round">${str}</text>`;
    },

    g(transform, body) { return `<g transform="${transform}">${body}</g>`; },

    /** Содержимое внутри формы: узор чешуи на яйце, туманность в склянке. */
    clip(d, body) {
      const cid = `${id}c${clip++}`;
      defs.set(cid, `<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
      return `<g clip-path="url(#${cid})">${body}</g>`;
    },

    /** Готовая svg: определения собираются по ходу рисования. */
    svg(body) {
      return `<svg class="hd-art" viewBox="0 0 100 100" fill="none" aria-hidden="true">` +
        `<defs>${[...defs.values()].join('')}</defs>${body}</svg>`;
    },
  };
  return k;
}
