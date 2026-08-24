/**
 * Процедурные обложки кейсов.
 *
 * Обложки рисуются кодом, а не лежат картинками: репозиторий остаётся лёгким,
 * обложки не мылятся на любом экране и мгновенно перекрашиваются под тему
 * кейса. Всё случайное берётся из детерминированного генератора, засеянного
 * id кейса: обложка одного и того же кейса всегда одинаковая, но соседние
 * не совпадают ни расположением монет, ни узором, ни формой сундука.
 *
 * Исключения — кейсы с полем art: у них на обложке стоит готовая картинка,
 * присланная владельцем проекта (см. PHOTO_COVERS в конце файла).
 */

/** Хеш строки в 32-битное число — семя для генератора. */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — короткий и хорошо перемешивающий ГПСЧ. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Холст обложки. Пропорция подобрана под ширину карточки, иначе
 *  preserveAspectRatio=slice срезает сундук сверху и снизу. */
const W = 340;
const H = 130;
const CX = W / 2;

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, a, b) => a + r() * (b - a);

/* ---------- Фоновые узоры ---------- */

function patternRays(r, c) {
  let out = '';
  const count = 12 + Math.floor(r() * 8);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 360;
    out += `<rect x="${CX}" y="65" width="260" height="${between(r, 3, 9).toFixed(1)}"
      fill="${c}" opacity="${between(r, 0.05, 0.14).toFixed(2)}"
      transform="rotate(${a.toFixed(1)} ${CX} 65)"/>`;
  }
  return out;
}

function patternGrid(r, c) {
  let out = '';
  for (let x = 0; x <= W; x += 16) {
    out += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-width="0.7" opacity="0.14"/>`;
  }
  for (let y = 0; y <= H; y += 16) {
    out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-width="0.7" opacity="0.14"/>`;
  }
  return out;
}

function patternBokeh(r, c) {
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += `<circle cx="${between(r, 0, W).toFixed(0)}" cy="${between(r, 0, H).toFixed(0)}"
      r="${between(r, 3, 16).toFixed(1)}" fill="${c}" opacity="${between(r, 0.05, 0.16).toFixed(2)}"/>`;
  }
  return out;
}

function patternChevron(r, c) {
  let out = '';
  for (let i = -2; i < 16; i++) {
    const x = i * 26;
    out += `<path d="M${x} 0 L${x + 16} 65 L${x} ${H}" stroke="${c}" stroke-width="2.4"
      fill="none" opacity="0.12"/>`;
  }
  return out;
}

function patternDiamonds(r, c) {
  let out = '';
  for (let i = 0; i < 20; i++) {
    const x = between(r, 0, W);
    const y = between(r, 0, H);
    const s = between(r, 4, 11);
    out += `<path d="M${x} ${y - s} L${x + s} ${y} L${x} ${y + s} L${x - s} ${y} Z"
      fill="none" stroke="${c}" stroke-width="1" opacity="${between(r, 0.1, 0.24).toFixed(2)}"/>`;
  }
  return out;
}

const PATTERNS = [patternRays, patternGrid, patternBokeh, patternChevron, patternDiamonds];

/* ---------- Сундук ---------- */

/**
 * Рисует открытый сундук. Форма крышки и накладки зависят от варианта,
 * поэтому сундуки в разных кейсах отличаются силуэтом, а не только цветом.
 */
function chest(r, variant, metal, dark, gid) {
  const bodyTop = 74;
  const lidCurve = [10, 16, 22][variant % 3];
  const bands = variant % 2 === 0;

  let out = '';

  // Свечение изнутри
  out += `<ellipse cx="${CX}" cy="72" rx="58" ry="22" fill="url(#glow${gid})" opacity="0.95"/>`;

  // Крышка
  out += `<path d="M${CX - 42} ${bodyTop} q0 -${lidCurve + 14} 42 -${lidCurve + 14} q42 0 42 ${lidCurve + 14} Z"
    fill="url(#metalGrad${gid})" stroke="${dark}" stroke-width="1.6" transform="rotate(-13 ${CX - 42} 74)"/>`;

  // Корпус
  out += `<rect x="${CX - 42}" y="${bodyTop}" width="84" height="34" rx="4" fill="url(#metalGrad${gid})"
    stroke="${dark}" stroke-width="1.6"/>`;

  // Внутреннее золото
  out += `<path d="M${CX - 38} ${bodyTop + 2} h76 v6 q-38 9 -76 0 Z" fill="#ffe98a" opacity="0.95"/>`;

  if (bands) {
    out += `<rect x="${CX - 28}" y="${bodyTop}" width="6" height="34" fill="${dark}" opacity="0.4"/>`;
    out += `<rect x="${CX + 22}" y="${bodyTop}" width="6" height="34" fill="${dark}" opacity="0.4"/>`;
  }

  // Замок
  out += `<rect x="${CX - 7}" y="${bodyTop + 9}" width="14" height="13" rx="2.6" fill="${metal}" stroke="${dark}" stroke-width="1.2"/>`;
  out += `<circle cx="${CX}" cy="${bodyTop + 15}" r="2.4" fill="${dark}"/>`;

  return out;
}

/* ---------- Монеты и купюры ---------- */

function coins(r, count, gid) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = between(r, 10, W - 10);
    const y = between(r, 58, 126);
    const rad = between(r, 3.4, 7.2);
    const rot = between(r, -30, 30);
    out += `<g transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">
      <ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rad.toFixed(1)}" ry="${(rad * 0.86).toFixed(1)}"
        fill="url(#coinGrad${gid})" stroke="#a35a00" stroke-width="0.7"/>
      <text x="${x.toFixed(1)}" y="${(y + rad * 0.36).toFixed(1)}" font-size="${(rad * 1.1).toFixed(1)}"
        fill="#8a4a00" text-anchor="middle" font-family="sans-serif" font-weight="bold">$</text>
    </g>`;
  }
  return out;
}

function bills(r, count) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = between(r, 6, W - 34);
    const y = between(r, 92, 122);
    const w = between(r, 20, 30);
    const h = w * 0.44;
    const rot = between(r, -22, 22);
    out += `<g transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" opacity="0.95">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
        rx="1.6" fill="#2fbf71" stroke="#0f7a45" stroke-width="0.8"/>
      <circle cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" r="${(h * 0.28).toFixed(1)}"
        fill="#0f7a45" opacity="0.55"/>
    </g>`;
  }
  return out;
}

function sparks(r, count, color) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = between(r, 10, W - 10);
    const y = between(r, 8, 90);
    const s = between(r, 1.6, 4.4);
    out += `<path d="M${x} ${y - s} L${(x + s * 0.34).toFixed(1)} ${y} L${x} ${y + s} L${(x - s * 0.34).toFixed(1)} ${y} Z"
      fill="${color}" opacity="${between(r, 0.4, 0.95).toFixed(2)}"/>`;
  }
  return out;
}

/* ---------- Сборка обложки ---------- */

/**
 * Возвращает SVG-обложку кейса.
 * @param {{id:string, palette:string[], hasPerks:boolean}} caseData
 */
export function caseCover(caseData) {
  // Кейсы с присланной картинкой рисуются ею, а не процедурным сундуком.
  // Диспетчеризация здесь, а не у вызывающего кода, — чтобы и приложение, и
  // офлайн-сборка получили обложку без отдельной правки.
  if (caseData.art === 'porsche') return porscheCover(caseData);
  if (ART_COVERS.has(caseData.art)) return artCover(caseData);

  const seed = hashString(caseData.id);
  const r = rng(seed);

  const [c1, c2] = caseData.palette;
  const patternFn = PATTERNS[seed % PATTERNS.length];
  // Сдвиг обязательно беззнаковый: у половины семян `>>` даёт отрицательное
  // число, остаток от него тоже отрицательный, и индекс массива уходит в минус.
  const chestVariant = (seed >>> 3) % 6;
  const metal = pick(r, ['#ffd60a', '#e8b23a', '#d9a441', '#f2c14e']);
  const dark = '#3a1f0a';

  const gid = `c${seed.toString(36)}`;

  return `<svg class="cover-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Обложка кейса">
    <defs>
      <linearGradient id="bg${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <radialGradient id="glow${gid}">
        <stop offset="0%" stop-color="#fff6c9" stop-opacity="1"/>
        <stop offset="55%" stop-color="${metal}" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="${metal}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="metalGrad${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${metal}"/>
        <stop offset="100%" stop-color="#8a5a12"/>
      </linearGradient>
      <radialGradient id="coinGrad${gid}">
        <stop offset="0%" stop-color="#fff2a8"/>
        <stop offset="100%" stop-color="#f0a020"/>
      </radialGradient>
      <linearGradient id="vig${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="55%" stop-color="#0d0318" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0d0318" stop-opacity="0.85"/>
      </linearGradient>
    </defs>

    <rect width="${W}" height="${H}" fill="url(#bg${gid})"/>
    <rect width="${W}" height="${H}" fill="#12031d" opacity="0.42"/>
    ${patternFn(r, '#ffffff')}
    ${sparks(r, 10 + Math.floor(r() * 8), '#fff3b0')}
    ${chest(r, chestVariant, metal, dark, gid)}
    ${coins(r, 13 + Math.floor(r() * 9), gid)}
    ${bills(r, 3 + Math.floor(r() * 3))}
    <rect width="${W}" height="${H}" fill="url(#vig${gid})"/>
  </svg>`;
}

/* ============================================================
   ОБЛОЖКИ-КАРТИНКИ
   ============================================================ */

/**
 * Пути к присланным картинкам.
 *
 * В автономной сборке подменяются на data-URI: файл открывают с диска, где
 * относительных путей к папке assets уже нет. Сборка выставляет глобальные
 * переменные до подключения этого кода, поэтому читать их надо в момент
 * вызова, а не при загрузке модуля.
 */
const asset = (globalName, path) => () =>
  (typeof window !== 'undefined' && window[globalName]) || path;

const porscheBannerSrc = asset('__PORSCHE_BANNER_SRC', '/assets/porsche-banner.webp');
const porscheSrc = asset('__PORSCHE_SRC', '/assets/porsche.webp');

/**
 * Присланные обложки с прозрачным фоном.
 *
 * Ключ - это и значение поля art у кейса, и имя файла в public/assets/covers/.
 */
const ART_COVERS = new Set([
  'dust', 'spark', 'copper', 'warmup', 'alley', 'frost', 'rune', 'deck',
  'neon', 'mirage', 'pit', 'allin', 'lucky', 'double',
  'santorini', 'rio', 'monaco', 'vegas', 'dubai', 'singapore',
  'winterfell', 'braavos', 'highgarden', 'westeros',
]);

/** Автономная сборка складывает все обложки в один объект с data-URI. */
function artSrc(name) {
  const inlined = typeof window !== 'undefined' && window.__COVER_ART;
  return (inlined && inlined[name]) || `/assets/covers/${name}.webp`;
}

/** Вырезанная машина для плитки в ленте - баннер туда слишком широкий. */
export function porschePhotoSrc() {
  return porscheSrc();
}

/**
 * Обложка сезонного кейса - готовый баннер во всю ширину карточки.
 *
 * Он нарисован с собственным фоном под конкретную пропорцию, поэтому идёт
 * через object-fit: cover, как обычная фотография.
 */
export function porscheCover(caseData) {
  const alt = `Обложка кейса «${caseData.name}»`;
  return `<img class="cover-photo" src="${porscheBannerSrc()}" alt="${alt}">`;
}

/**
 * Обложка-арт с прозрачным фоном.
 *
 * Подложки у неё нет: объект ложится прямо на фон карточки, поэтому рамки не
 * видно и обложка выглядит частью интерфейса. Отсюда и object-fit: contain в
 * стилях - при cover прозрачные поля обрезались бы вместе с объектом.
 *
 * Ленивая загрузка обязательна: обложек восемнадцать, и без неё первый экран
 * тянул бы все полтора мегабайта разом.
 */
export function artCover(caseData) {
  const alt = `Обложка кейса «${caseData.name}»`;
  return `<img class="cover-art" src="${artSrc(caseData.art)}" alt="${alt}"
    loading="lazy" decoding="async">`;
}
