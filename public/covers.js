/**
 * Процедурные обложки кейсов.
 *
 * Обложки рисуются кодом, а не лежат картинками: репозиторий остаётся лёгким,
 * обложки не мылятся на любом экране и мгновенно перекрашиваются под тему
 * кейса. Всё случайное берётся из детерминированного генератора, засеянного
 * id кейса: обложка одного и того же кейса всегда одинаковая, но соседние
 * не совпадают ни расположением монет, ни узором, ни формой сундука.
 *
 * Исключение одно — сезонный кейс: там в центре стоит присланная фотография
 * машины, а сцена вокруг неё по-прежнему считается кодом (см. porscheCover).
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
  // Сезонные кейсы рисуются собственной обложкой: у них своя сцена, а не
  // процедурный сундук. Диспетчеризация здесь, а не у вызывающего кода, —
  // чтобы и приложение, и офлайн-сборка получили её без отдельной правки.
  if (caseData.art === 'porsche') return porscheCover(caseData);

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
   СЕЗОННАЯ ОБЛОЖКА: PORSCHE 911
   ============================================================ */


/* ============================================================
   СЕЗОННАЯ ОБЛОЖКА С ФОТОГРАФИЕЙ
   ============================================================ */

/**
 * Путь к снимку машины.
 *
 * В автономной сборке подменяется на data-URI: файл открывают с диска, где
 * относительных путей к папке assets уже нет. Сборка выставляет глобальную
 * переменную до подключения этого кода.
 */
const PORSCHE_SRC = (typeof window !== 'undefined' && window.__PORSCHE_SRC)
  || '/assets/porsche.webp';

/** Тот же снимок нужен ленте прокрута, поэтому путь отдаётся наружу. */
export function porschePhotoSrc() {
  return PORSCHE_SRC;
}

/** Сезонная обложка шире и выше обычных — она рисуется только на витрине. */
const PW = 360;
const PH = 180;

/**
 * Обложка сезонного кейса: фотография на неоновой сцене.
 *
 * В отличие от остальных обложек здесь не процедурный рисунок, а снимок,
 * присланный владельцем проекта. Всё вокруг — фон, лучи, отражение, текст —
 * по-прежнему считается кодом, поэтому обложка остаётся резкой на любом
 * экране, а в файл добавляется только сама фотография.
 */
export function porscheCover(caseData) {
  const seed = hashString(caseData.id);
  const r = rng(seed);
  const gid = `pc${seed.toString(36)}`;

  // Лучи из-за машины.
  let rays = '';
  for (let i = 0; i < 22; i++) {
    rays += `<rect x="${PW / 2}" y="88" width="230" height="${between(r, 2, 7).toFixed(1)}"
      fill="#fff" opacity="${between(r, 0.02, 0.07).toFixed(3)}"
      transform="rotate(${((i / 22) * 360).toFixed(1)} ${PW / 2} 88)"/>`;
  }

  // Искры и конфетти.
  let sparks = '';
  for (let i = 0; i < 34; i++) {
    const sx = between(r, 6, PW - 6);
    const sy = between(r, 6, 150);
    const s = between(r, 1.2, 3.6);
    const col = pick(r, ['#fff3b0', '#ffd60a', '#ff2e8a', '#00f0ff']);
    sparks += `<path d="M${sx.toFixed(1)} ${(sy - s).toFixed(1)}
      L${(sx + s * 0.34).toFixed(1)} ${sy.toFixed(1)}
      L${sx.toFixed(1)} ${(sy + s).toFixed(1)}
      L${(sx - s * 0.34).toFixed(1)} ${sy.toFixed(1)} Z"
      fill="${col}" opacity="${between(r, 0.35, 0.95).toFixed(2)}"/>`;
  }

  // Горизонтальные неоновые росчерки — «смазанная скорость».
  let streaks = '';
  for (let i = 0; i < 7; i++) {
    const sy = between(r, 40, 140);
    const sw = between(r, 60, 190);
    const sx = between(r, -20, PW - 40);
    const col = pick(r, ['#00f0ff', '#ff2e8a', '#ffd60a']);
    streaks += `<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}"
      height="${between(r, 1, 2.6).toFixed(1)}" rx="1" fill="${col}"
      opacity="${between(r, 0.12, 0.3).toFixed(2)}"/>`;
  }

  const CAR_X = 25;
  const CAR_Y = 52;
  const CAR_W = 310;
  const CAR_H = 90;
  const GROUND = CAR_Y + CAR_H;

  return `<svg class="cover-svg" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg" role="img"
    aria-label="Сезонный кейс Porsche 911">
    <defs>
      <radialGradient id="bg${gid}" cx="50%" cy="46%" r="72%">
        <stop offset="0%" stop-color="#ff2d55" stop-opacity="0.62"/>
        <stop offset="48%" stop-color="#6d0b3f" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#0d0316" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="gold${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff8d0"/>
        <stop offset="52%" stop-color="#ffd60a"/>
        <stop offset="100%" stop-color="#ff9b2e"/>
      </linearGradient>
      <radialGradient id="glow${gid}">
        <stop offset="0%" stop-color="#ffd60a" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="#ffd60a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="fade${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.42"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <mask id="refl${gid}">
        <rect x="0" y="${GROUND}" width="${PW}" height="40" fill="url(#fade${gid})"/>
      </mask>
      <linearGradient id="vig${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0d0316" stop-opacity="0.5"/>
        <stop offset="52%" stop-color="#0d0316" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0d0316" stop-opacity="0.55"/>
      </linearGradient>
      <filter id="soft${gid}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3"/>
      </filter>
    </defs>

    <rect width="${PW}" height="${PH}" fill="url(#bg${gid})"/>
    ${rays}

    <text x="${PW / 2}" y="128" text-anchor="middle" font-size="112" font-weight="900"
      font-family="Impact, 'Arial Black', system-ui, sans-serif" fill="#fff"
      opacity="0.07" letter-spacing="6">911</text>
    <text x="${PW / 2}" y="128" text-anchor="middle" font-size="112" font-weight="900"
      font-family="Impact, 'Arial Black', system-ui, sans-serif" fill="none"
      stroke="#ffd60a" stroke-width="1.2" opacity="0.22" letter-spacing="6">911</text>

    ${streaks}
    <ellipse cx="${PW / 2}" cy="${GROUND - 6}" rx="150" ry="42" fill="url(#glow${gid})"/>

    <g mask="url(#refl${gid})" opacity="0.5">
      <image href="${PORSCHE_SRC}" x="${CAR_X}" y="${GROUND}" width="${CAR_W}"
        height="${CAR_H}" transform="scale(1,-1) translate(0,${-2 * GROUND})"
        preserveAspectRatio="xMidYMid meet"/>
    </g>

    <ellipse cx="${PW / 2}" cy="${GROUND - 2}" rx="120" ry="7" fill="#000" opacity="0.55"/>
    <image href="${PORSCHE_SRC}" x="${CAR_X}" y="${CAR_Y}" width="${CAR_W}" height="${CAR_H}"
      preserveAspectRatio="xMidYMid meet"/>

    <rect x="0" y="${GROUND + 1}" width="${PW}" height="2" fill="#ff2e8a" opacity="0.55"/>
    <rect x="0" y="${GROUND + 1}" width="${PW}" height="2" fill="#ff2e8a" opacity="0.5"
      filter="url(#soft${gid})"/>

    ${sparks}

    <text x="16" y="24" font-size="10.5" font-weight="900" letter-spacing="2.6"
      fill="#00f0ff" opacity="0.95">ОСЕННЯЯ СЕРИЯ · MMXXVI</text>
    <text x="16" y="44" font-size="15.5" font-weight="900" letter-spacing="0.2"
      fill="url(#gold${gid})">ЛЕГЕНДА ИЗ ЦУФФЕНХАУЗЕНА</text>

    <g transform="translate(${PW - 84} 12)">
      <rect width="70" height="21" rx="10.5" fill="#0d0316" opacity="0.8"
        stroke="#ffd60a" stroke-width="1.4"/>
      <text x="35" y="15" text-anchor="middle" font-size="11" font-weight="900"
        letter-spacing="1.6" fill="#ffd60a">TURBO S</text>
    </g>

    <text x="16" y="${PH - 24}" font-size="9.5" font-weight="800" letter-spacing="1.8"
      fill="#d6c2f0" opacity="0.9">ВИТРИНА СЕЗОНА · ВНЕ РОЗЫГРЫША</text>

    <rect width="${PW}" height="${PH}" fill="url(#vig${gid})"/>
  </svg>`;
}
