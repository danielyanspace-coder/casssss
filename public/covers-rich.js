/**
 * Насыщенные обложки кейсов — пробный вариант.
 *
 * Композиция собрана по образцу «плакатных» обложек: тёмный фон с цветным
 * заревом, лучи из-за героя, крупная эмблема по центру, золотая лента с
 * названием поперёк, реквизит по теме вокруг и раскрытый кофр внизу с
 * подсветкой, заклёпками и разлитым золотом.
 *
 * Всё случайное берётся из детерминированного генератора, засеянного id
 * кейса: обложка стабильна между запусками, но у разных кейсов не совпадают
 * ни разброс реквизита, ни искры, ни оттенки.
 */

const W = 340;
const H = 130;
const CX = W / 2;

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = (r, a, b) => a + r() * (b - a);
const f1 = (n) => Number(n).toFixed(1);

/* ============================================================
   ФОН
   ============================================================ */

function backdrop(r, gid, c1, c2) {
  let out = `<rect width="${W}" height="${H}" fill="url(#bg${gid})"/>`;

  // Лучи из-за героя — задают «плакатность» и вытягивают взгляд к центру.
  const rays = 18;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * 360 + rnd(r, -4, 4);
    out += `<rect x="${CX}" y="46" width="150" height="${f1(rnd(r, 2, 6))}"
      fill="#fff" opacity="${(rnd(r, 0.02, 0.06)).toFixed(3)}"
      transform="rotate(${f1(a)} ${CX} 46)"/>`;
  }

  // Дымка над кофром
  out += `<ellipse cx="${CX}" cy="52" rx="120" ry="46" fill="url(#haze${gid})"/>`;
  return out;
}

/* ============================================================
   РЕКВИЗИТ
   ============================================================ */

/** Фишка казино: кольцо с насечками и светлым центром. */
function chip(x, y, rad, tilt, face, edge) {
  let notches = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 360;
    notches += `<rect x="${f1(x - 1.4)}" y="${f1(y - rad)}" width="2.8" height="${f1(rad * 0.34)}"
      fill="#fff" opacity="0.85" transform="rotate(${f1(a)} ${f1(x)} ${f1(y)})"/>`;
  }
  return `<g transform="rotate(${f1(tilt)} ${f1(x)} ${f1(y)}) translate(0,0)">
    <ellipse cx="${f1(x)}" cy="${f1(y + rad * 0.18)}" rx="${f1(rad)}" ry="${f1(rad * 0.9)}"
      fill="#000" opacity="0.35"/>
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad)}" fill="${edge}"/>
    ${notches}
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad * 0.62)}" fill="${face}"/>
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad * 0.62)}" fill="none"
      stroke="#000" stroke-opacity="0.28" stroke-width="0.8"/>
    <ellipse cx="${f1(x - rad * 0.3)}" cy="${f1(y - rad * 0.35)}" rx="${f1(rad * 0.34)}"
      ry="${f1(rad * 0.2)}" fill="#fff" opacity="0.35" transform="rotate(-35 ${f1(x)} ${f1(y)})"/>
  </g>`;
}

/** Игральная карта рубашкой вниз, с пипом. */
function card(x, y, w, tilt, pip, pipColor) {
  const h = w * 1.42;
  return `<g transform="rotate(${f1(tilt)} ${f1(x)} ${f1(y)})">
    <rect x="${f1(x - w / 2 + 1.5)}" y="${f1(y - h / 2 + 2)}" width="${f1(w)}" height="${f1(h)}"
      rx="2" fill="#000" opacity="0.4"/>
    <rect x="${f1(x - w / 2)}" y="${f1(y - h / 2)}" width="${f1(w)}" height="${f1(h)}"
      rx="2" fill="#fdf6e6" stroke="#c9b68c" stroke-width="0.7"/>
    <g fill="${pipColor}" transform="translate(${f1(x)} ${f1(y)}) scale(${f1(w / 34)})">${pip}</g>
  </g>`;
}

const PIP_SPADE =
  '<path d="M0 -11 C6 -4 12 -1 12 4 C12 9 7 11 3 8 L5 13 L-5 13 L-3 8 C-7 11 -12 9 -12 4 C-12 -1 -6 -4 0 -11Z"/>';
const PIP_HEART =
  '<path d="M0 12 C-13 3 -12 -6 -6 -9 C-2 -11 0 -8 0 -6 C0 -8 2 -11 6 -9 C12 -6 13 3 0 12Z"/>';

/** Монета с рублём — перекликается с ценником на карточке. */
function coin(x, y, rad, tilt) {
  return `<g transform="rotate(${f1(tilt)} ${f1(x)} ${f1(y)})">
    <ellipse cx="${f1(x)}" cy="${f1(y + rad * 0.22)}" rx="${f1(rad)}" ry="${f1(rad * 0.88)}"
      fill="#000" opacity="0.35"/>
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad)}" fill="url(#coin${'G'})"/>
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad * 0.72)}" fill="none"
      stroke="#8a4a00" stroke-width="0.7" opacity="0.6"/>
    <text x="${f1(x)}" y="${f1(y + rad * 0.42)}" font-size="${f1(rad * 1.25)}" fill="#7a3f00"
      text-anchor="middle" font-family="sans-serif" font-weight="bold">₽</text>
  </g>`;
}

/** Кость с точками. */
function die(x, y, s, tilt) {
  const pips = [[-0.28, -0.28], [0.28, 0.28], [0, 0], [-0.28, 0.28], [0.28, -0.28]];
  return `<g transform="rotate(${f1(tilt)} ${f1(x)} ${f1(y)})">
    <rect x="${f1(x - s / 2)}" y="${f1(y - s / 2)}" width="${f1(s)}" height="${f1(s)}"
      rx="${f1(s * 0.22)}" fill="#f6f1e4" stroke="#b9ab8c" stroke-width="0.7"/>
    ${pips.map(([dx, dy]) =>
      `<circle cx="${f1(x + dx * s)}" cy="${f1(y + dy * s)}" r="${f1(s * 0.09)}" fill="#2a1020"/>`).join('')}
  </g>`;
}

/* ============================================================
   ГЕРОЙ И КОФР
   ============================================================ */

/**
 * Эмблема по центру: крупная фишка на подложке из скрещённых карт.
 * Это смысловой центр композиции, всё остальное работает на неё.
 */
function hero(r, gid) {
  let out = '';

  // Скрещённые карты за эмблемой
  const cy = 46;

  out += card(CX - 34, cy + 2, 32, -28, PIP_SPADE, '#241024');
  out += card(CX + 34, cy + 2, 32, 28, PIP_HEART, '#c81e3c');

  // Ореол
  out += `<circle cx="${CX}" cy="${cy}" r="42" fill="url(#halo${gid})"/>`;

  // Фишка — смысловой центр, поэтому крупная
  out += `<circle cx="${CX}" cy="${cy}" r="31" fill="#7a1020"/>`;
  out += `<circle cx="${CX}" cy="${cy}" r="31" fill="none" stroke="url(#gold${gid})" stroke-width="4.5"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 360;
    out += `<rect x="${CX - 2.6}" y="${cy - 33}" width="5.2" height="10" rx="1.3"
      fill="url(#gold${gid})" transform="rotate(${f1(a)} ${CX} ${cy})"/>`;
  }
  out += `<circle cx="${CX}" cy="${cy}" r="21" fill="#e0243f"/>`;
  out += `<circle cx="${CX}" cy="${cy}" r="21" fill="none" stroke="#5c0a18" stroke-width="1.3" opacity="0.75"/>`;
  out += `<g fill="#ffe9a8" transform="translate(${CX} ${cy - 1}) scale(1.05)">${PIP_SPADE}</g>`;
  out += `<ellipse cx="${CX - 11}" cy="${cy - 12}" rx="12" ry="6" fill="#fff" opacity="0.26"
    transform="rotate(-32 ${CX - 11} ${cy - 12})"/>`;

  return out;
}

/** Раскрытый кофр внизу: корпус, крышка, лампы, заклёпки, защёлки. */
function crate(r, gid) {
  const top = 92;
  let out = '';

  // Крышка за корпусом
  out += `<path d="M44 ${top} L56 76 H284 L296 ${top} Z" fill="#1b1526" stroke="#3a3350" stroke-width="1.4"/>`;
  out += `<path d="M56 76 H284 L289 83 H51 Z" fill="#2a2338" opacity="0.9"/>`;

  // Свечение изнутри
  out += `<ellipse cx="${CX}" cy="${top - 2}" rx="120" ry="14" fill="url(#inner${gid})"/>`;

  // Корпус
  out += `<rect x="30" y="${top}" width="280" height="34" rx="6"
    fill="url(#metal${gid})" stroke="#0f0b18" stroke-width="1.6"/>`;
  out += `<rect x="30" y="${top}" width="280" height="7" rx="3" fill="#fff" opacity="0.08"/>`;

  // Рёбра жёсткости
  for (const x of [70, 110, 230, 270]) {
    out += `<rect x="${x}" y="${top + 4}" width="7" height="26" rx="2" fill="#000" opacity="0.3"/>`;
  }

  // Заклёпки
  for (let i = 0; i < 14; i++) {
    const x = 44 + i * 19;
    out += `<circle cx="${x}" cy="${top + 5}" r="1.7" fill="#8e86a8" opacity="0.85"/>`;
    out += `<circle cx="${x}" cy="${top + 29}" r="1.7" fill="#8e86a8" opacity="0.7"/>`;
  }

  // Лампы
  for (const x of [58, 282]) {
    out += `<circle cx="${x}" cy="${top + 12}" r="7" fill="url(#lamp${gid})"/>`;
    out += `<circle cx="${x}" cy="${top + 12}" r="2.6" fill="#fff8d8"/>`;
  }

  // Защёлки
  for (const x of [136, 204]) {
    out += `<rect x="${x}" y="${top + 9}" width="16" height="11" rx="2.4"
      fill="url(#gold${gid})" stroke="#5a3a00" stroke-width="0.8"/>`;
    out += `<rect x="${x + 5}" y="${top + 13}" width="6" height="3.5" rx="1" fill="#4a2f00" opacity="0.8"/>`;
  }

  return out;
}

/** Разлитое золото под кофром с потёками. */
function spill(r, gid) {
  let out = `<ellipse cx="${CX}" cy="126" rx="140" ry="10" fill="url(#gold${gid})" opacity="0.85"/>`;
  for (let i = 0; i < 7; i++) {
    const x = rnd(r, 50, 290);
    out += `<ellipse cx="${f1(x)}" cy="${f1(rnd(r, 120, 128))}" rx="${f1(rnd(r, 5, 14))}"
      ry="${f1(rnd(r, 2, 4.5))}" fill="url(#gold${gid})" opacity="0.9"/>`;
  }
  return out;
}

/* ============================================================
   ЛЕНТА С НАЗВАНИЕМ
   ============================================================ */

/**
 * Золотая лента поперёк композиции. Подпись даётся заглавными и
 * растягивается по ширине ленты — так название читается даже в мелком виде.
 */
function ribbon(gid, title) {
  // Лента идёт по нижней трети героя: выше она накрывала бы эмблему,
  // ниже — сливалась бы с кофром.
  const y = 76;
  const h = 21;
  const x0 = 46;
  const wRib = W - x0 * 2;
  const text = title.toUpperCase();

  // Кегль от длины названия: иначе длинное вылезает за края ленты.
  const size = text.length > 16 ? 10 : text.length > 12 ? 12 : text.length > 8 ? 14 : 16;
  const spacing = text.length > 12 ? 1 : 2;

  return `<g transform="rotate(-3 ${CX} ${y})">
    <path d="M${x0 - 20} ${y - h / 2 - 3} L${x0} ${y - h / 2} L${x0} ${y + h / 2}
             L${x0 - 20} ${y + h / 2 + 6} L${x0 - 13} ${y} Z"
      fill="#9a6400" stroke="#5a3a00" stroke-width="0.7"/>
    <path d="M${W - x0 + 20} ${y - h / 2 - 3} L${W - x0} ${y - h / 2} L${W - x0} ${y + h / 2}
             L${W - x0 + 20} ${y + h / 2 + 6} L${W - x0 + 13} ${y} Z"
      fill="#9a6400" stroke="#5a3a00" stroke-width="0.7"/>
    <rect x="${x0}" y="${y - h / 2}" width="${wRib}" height="${h}" rx="2.5"
      fill="url(#gold${gid})" stroke="#6b4400" stroke-width="1"/>
    <rect x="${x0}" y="${y - h / 2}" width="${wRib}" height="5" fill="#fff" opacity="0.3"/>
    <rect x="${x0}" y="${y + h / 2 - 4}" width="${wRib}" height="4" fill="#000" opacity="0.16"/>
    <text x="${CX}" y="${y + size * 0.36}" text-anchor="middle"
      font-family="'Arial Black', Impact, sans-serif" font-weight="900"
      font-size="${size}" letter-spacing="${spacing}"
      fill="#3f2200">${text}</text>
  </g>`;
}

/* ============================================================
   СБОРКА
   ============================================================ */

export function richCover(caseData) {
  const seed = hashString(caseData.id);
  const r = rng(seed);
  const gid = `r${seed.toString(36)}`;
  const [c1, c2] = caseData.palette;

  let props = '';

  // Реквизит слева и справа от героя, ближе к кофру.
  // Реквизит держится по краям кадра: в центре он спорил бы с эмблемой.
  props += chip(rnd(r, 26, 46), rnd(r, 48, 62), rnd(r, 9, 12), rnd(r, -20, 20), '#f4f0e6', '#c81e3c');
  props += chip(rnd(r, 294, 316), rnd(r, 44, 58), rnd(r, 9, 12), rnd(r, -20, 20), '#f4f0e6', '#1b2a6b');
  props += chip(rnd(r, 40, 58), rnd(r, 84, 94), rnd(r, 7, 9), rnd(r, -25, 25), '#2a1020', '#e0b23c');
  props += chip(rnd(r, 286, 306), rnd(r, 84, 94), rnd(r, 6, 8), rnd(r, -25, 25), '#f4f0e6', '#0f6b3c');
  props += die(rnd(r, 20, 36), rnd(r, 100, 112), rnd(r, 10, 13), rnd(r, -25, 25));
  props += die(rnd(r, 306, 322), rnd(r, 98, 110), rnd(r, 9, 12), rnd(r, -25, 25));

  for (let i = 0; i < 8; i++) {
    const left = r() < 0.5;
    props += coin(left ? rnd(r, 14, 62) : rnd(r, 282, 328), rnd(r, 62, 122),
                  rnd(r, 4.5, 7.5), rnd(r, -30, 30));
  }

  let sparks = '';
  for (let i = 0; i < 26; i++) {
    const x = rnd(r, 12, 328);
    const y = rnd(r, 6, 96);
    const s = rnd(r, 1, 3.2);
    sparks += `<path d="M${f1(x)} ${f1(y - s)} L${f1(x + s * 0.3)} ${f1(y)} L${f1(x)} ${f1(y + s)} L${f1(x - s * 0.3)} ${f1(y)} Z"
      fill="#ffe9a8" opacity="${rnd(r, 0.3, 0.95).toFixed(2)}"/>`;
  }

  return `<svg class="cover-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Обложка кейса ${caseData.name}">
    <defs>
      <radialGradient id="bg${gid}" cx="50%" cy="34%" r="62%">
        <stop offset="0%" stop-color="${c1}" stop-opacity="0.55"/>
        <stop offset="45%" stop-color="${c2}" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#0a0410" stop-opacity="1"/>
      </radialGradient>
      <radialGradient id="halo${gid}">
        <stop offset="0%" stop-color="#fff3c4" stop-opacity="0.95"/>
        <stop offset="60%" stop-color="${c1}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="haze${gid}">
        <stop offset="0%" stop-color="${c1}" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="inner${gid}">
        <stop offset="0%" stop-color="#fff2ba" stop-opacity="1"/>
        <stop offset="100%" stop-color="#ffb020" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="lamp${gid}">
        <stop offset="0%" stop-color="#fffbe6" stop-opacity="1"/>
        <stop offset="100%" stop-color="#ffd60a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="gold${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffe98a"/>
        <stop offset="45%" stop-color="#f0b429"/>
        <stop offset="100%" stop-color="#a8700c"/>
      </linearGradient>
      <linearGradient id="metal${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3a3350"/>
        <stop offset="100%" stop-color="#151021"/>
      </linearGradient>
      <radialGradient id="coinG">
        <stop offset="0%" stop-color="#fff2a8"/>
        <stop offset="100%" stop-color="#f0a020"/>
      </radialGradient>
      <linearGradient id="vig${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0a0410" stop-opacity="0.5"/>
        <stop offset="32%" stop-color="#0a0410" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0a0410" stop-opacity="0.75"/>
      </linearGradient>
      <linearGradient id="vigx${gid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0a0410" stop-opacity="0.7"/>
        <stop offset="18%" stop-color="#0a0410" stop-opacity="0"/>
        <stop offset="82%" stop-color="#0a0410" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0a0410" stop-opacity="0.7"/>
      </linearGradient>
    </defs>

    ${backdrop(r, gid, c1, c2)}
    ${hero(r, gid)}
    ${crate(r, gid)}
    ${spill(r, gid)}
    ${props}
    ${ribbon(gid, caseData.name)}
    ${sparks}
    <rect width="${W}" height="${H}" fill="url(#vig${gid})"/>
    <rect width="${W}" height="${H}" fill="url(#vigx${gid})"/>
  </svg>`;
}
