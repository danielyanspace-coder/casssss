/**
 * Процедурные обложки кейсов.
 *
 * 57 кейсов — 57 непохожих обложек, и все рисуются кодом, а не лежат
 * картинками: репозиторий остаётся лёгким, обложки не мылятся на любом
 * экране и мгновенно перекрашиваются под тему кейса.
 *
 * Всё случайное берётся из детерминированного генератора, засеянного id
 * кейса: обложка одного и того же кейса всегда одинаковая, но соседние
 * не совпадают ни расположением монет, ни узором, ни формой сундука.
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

/**
 * Силуэт 911 в профиль, нарисованный путями.
 *
 * Фотографию сюда поставить нельзя: снимки такой машины защищены авторским
 * правом, а генератор изображений в проекте недоступен. Зато силуэт 911
 * узнаётся по пропорциям — низкий нос, купол крыши над передними сиденьями,
 * длинный скат кормы и широкие задние крылья, — и вектор не мылится.
 */
function porsche911(x, y, scale, body, glass, gid) {
  const t = (sx, sy) => `${(x + sx * scale).toFixed(1)} ${(y + sy * scale).toFixed(1)}`;
  const px = (sx) => (x + sx * scale).toFixed(1);
  const py = (sy) => (y + sy * scale).toFixed(1);
  const sz = (v) => (v * scale).toFixed(2);

  // Колесо с пятилучевым диском и красной ступицей.
  const wheel = (cx, cy, r) => {
    const spokes = [0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const ex = (x + (cx + Math.cos(a) * (r - 4.8)) * scale).toFixed(1);
      const ey = (y + (cy + Math.sin(a) * (r - 4.8)) * scale).toFixed(1);
      return `<path d="M ${px(cx)} ${py(cy)} L ${ex} ${ey}" stroke="#cfc6dd"
        stroke-width="${sz(1.7)}" stroke-linecap="round" opacity="0.9"/>`;
    }).join('');

    return `<g>
      <circle cx="${px(cx)}" cy="${py(cy)}" r="${sz(r)}" fill="#0c070f"/>
      <circle cx="${px(cx)}" cy="${py(cy)}" r="${sz(r - 3.4)}" fill="#2a2233"/>
      ${spokes}
      <circle cx="${px(cx)}" cy="${py(cy)}" r="${sz(r - 4.2)}" fill="none"
        stroke="#cfc6dd" stroke-width="${sz(1.5)}"/>
      <circle cx="${px(cx)}" cy="${py(cy)}" r="${sz(2.4)}" fill="#e01030"
        stroke="#ffd60a" stroke-width="${sz(0.8)}"/>
    </g>`;
  };

  return `<g>
    <ellipse cx="${px(96)}" cy="${py(58.4)}" rx="${sz(96)}" ry="${sz(6)}"
      fill="#000" opacity="0.5"/>

    ${wheel(45.5, 44, 14)}
    ${wheel(146.5, 43.2, 14.8)}

    <path d="M ${t(4, 43)}
             C ${t(4, 36)} ${t(5.5, 30)} ${t(10, 25.6)}
             C ${t(15, 20.8)} ${t(19, 18.6)} ${t(24, 18)}
             C ${t(31, 17.2)} ${t(36, 16.8)} ${t(40, 16.6)}
             C ${t(50, 16.4)} ${t(60, 16.5)} ${t(68, 16.2)}
             L ${t(70, 15.4)}
             C ${t(76, 13.4)} ${t(84, 9)} ${t(94, 5.6)}
             C ${t(100, 4.2)} ${t(106, 4.2)} ${t(112, 5.4)}
             C ${t(126, 8.2)} ${t(138, 11.8)} ${t(148, 14.4)}
             C ${t(158, 16.6)} ${t(168, 17.8)} ${t(176, 18.8)}
             C ${t(183, 19.8)} ${t(188, 21.6)} ${t(188.8, 24.6)}
             L ${t(190, 39)}
             L ${t(185, 45)}
             L ${t(164, 47.5)}
             A ${sz(18)} ${sz(18)} 0 0 0 ${t(129, 47.5)}
             L ${t(62.1, 47.5)}
             A ${sz(17)} ${sz(17)} 0 0 0 ${t(28.9, 47.5)}
             L ${t(10, 45.6)}
             C ${t(6, 45)} ${t(4, 44.4)} ${t(4, 43)} Z"
      fill="url(#body${gid})" stroke="#170812" stroke-width="${sz(1.5)}"
      stroke-linejoin="round"/>

    <path d="M ${t(70, 15)} C ${t(76, 12.8)} ${t(84, 8.8)} ${t(93, 6.2)}
             L ${t(100, 5.6)} L ${t(100, 14.2)} Z" fill="${glass}"/>
    <path d="M ${t(104, 5.7)} L ${t(111, 5.9)}
             C ${t(119, 7.6)} ${t(126, 9.8)} ${t(131, 11.8)}
             L ${t(131, 12.9)} L ${t(104, 14)} Z" fill="${glass}"/>
    <path d="M ${t(74, 13.6)} C ${t(80, 11)} ${t(86, 8.2)} ${t(94, 6.6)}"
      stroke="#fff" stroke-width="${sz(1.4)}" fill="none" opacity="0.3"/>

    ${[0, 1, 2, 3, 4].map((i) => `<path d="M ${t(150 + i * 5.5, 14.8 + i * 1.2)}
      L ${t(153 + i * 5.5, 17.6 + i * 1.1)}" stroke="#170812" stroke-width="${sz(0.9)}"
      opacity="0.45"/>`).join('')}

    <path d="M ${t(156, 15.4)} C ${t(170, 16.8)} ${t(182, 18.6)} ${t(188, 21)}
             L ${t(187, 23.2)} C ${t(180, 20.8)} ${t(168, 19)} ${t(155, 17.6)} Z"
      fill="#170812" opacity="0.45"/>

    <rect x="${px(172)}" y="${py(19.6)}" width="${sz(17)}" height="${sz(2.6)}"
      rx="${sz(1.3)}" fill="#ff2438"/>
    <rect x="${px(174)}" y="${py(20.2)}" width="${sz(13)}" height="${sz(0.9)}"
      rx="${sz(0.45)}" fill="#ffb0b8" opacity="0.9"/>

    <path d="M ${t(5, 33)} L ${t(22, 31)} L ${t(22, 35)} L ${t(6, 37)} Z"
      fill="#12080f" opacity="0.7"/>
    <circle cx="${px(26)}" cy="${py(22)}" r="${sz(5.4)}" fill="#170812"/>
    <circle cx="${px(26)}" cy="${py(22)}" r="${sz(4.4)}" fill="url(#lamp${gid})"/>
    <circle cx="${px(24.6)}" cy="${py(20.6)}" r="${sz(1.4)}" fill="#fff" opacity="0.85"/>

    <path d="M ${t(62, 45.2)} L ${t(129, 45.2)} L ${t(129, 47.5)} L ${t(62, 47.5)} Z"
      fill="#170812" opacity="0.55"/>
    <path d="M ${t(124, 20.4)} C ${t(138, 14.4)} ${t(160, 15.6)} ${t(174, 19.4)}"
      stroke="#fff" stroke-width="${sz(1.6)}" fill="none" opacity="0.22"/>
    <path d="M ${t(18, 20.6)} C ${t(34, 18.8)} ${t(52, 19)} ${t(66, 19.6)}"
      stroke="#fff" stroke-width="${sz(1.2)}" fill="none" opacity="0.2"/>

    <path d="M ${t(69, 15.6)} C ${t(66.6, 26)} ${t(66.4, 36)} ${t(67, 46.6)}"
      stroke="#170812" stroke-width="${sz(0.9)}" fill="none" opacity="0.45"/>
    <path d="M ${t(112, 14)} C ${t(111, 26)} ${t(110.4, 36)} ${t(110.4, 46.2)}"
      stroke="#170812" stroke-width="${sz(0.9)}" fill="none" opacity="0.45"/>
    <rect x="${px(99)}" y="${py(18.6)}" width="${sz(7)}" height="${sz(1.9)}"
      rx="${sz(0.9)}" fill="#170812" opacity="0.6"/>
    <path d="M ${t(69, 12.6)} L ${t(61.5, 12)} L ${t(61.5, 15.4)} L ${t(69, 15.6)} Z"
      fill="#170812" opacity="0.8"/>

    <path d="M ${t(28.9, 47.5)} A ${sz(17)} ${sz(17)} 0 0 1 ${t(62.1, 47.5)}"
      fill="none" stroke="#170812" stroke-width="${sz(1.6)}" opacity="0.7"/>
    <path d="M ${t(129, 47.5)} A ${sz(18)} ${sz(18)} 0 0 1 ${t(164, 47.5)}"
      fill="none" stroke="#170812" stroke-width="${sz(1.6)}" opacity="0.7"/>
  </g>`;
}

export function porscheCover(caseData) {
  const seed = hashString(caseData.id);
  const r = rng(seed);
  const gid = `pc${seed.toString(36)}`;

  let sparks = '';
  for (let i = 0; i < 22; i++) {
    const sx = between(r, 8, W - 8);
    const sy = between(r, 4, 60);
    const s = between(r, 1, 3);
    sparks += `<path d="M${sx.toFixed(1)} ${(sy - s).toFixed(1)} L${(sx + s * 0.3).toFixed(1)} ${sy.toFixed(1)}
      L${sx.toFixed(1)} ${(sy + s).toFixed(1)} L${(sx - s * 0.3).toFixed(1)} ${sy.toFixed(1)} Z"
      fill="#fff3b0" opacity="${between(r, 0.3, 0.9).toFixed(2)}"/>`;
  }

  // Полосы разметки под машиной — «полоса разгона». Три ряда: чем ближе к
  // нижнему краю, тем шире и ярче штрих, за счёт этого дорога уходит вдаль.
  let road = '';
  [[104, 18, 0.08], [113, 26, 0.13], [124, 36, 0.2]].forEach(([ry, len, op], row) => {
    for (let i = -1; i * (len + 16) < W + len; i++) {
      road += `<rect x="${(i * (len + 16) + row * 9).toFixed(1)}" y="${ry}" width="${len}"
        height="${(2 + row).toFixed(1)}" rx="1.5" fill="#fff" opacity="${op}"/>`;
    }
  });

  return `<svg class="cover-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Обложка сезонного кейса">
    <defs>
      <radialGradient id="bg${gid}" cx="50%" cy="38%" r="68%">
        <stop offset="0%" stop-color="#ff2d55" stop-opacity="0.5"/>
        <stop offset="55%" stop-color="#5a0a2a" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#0a0410" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="body${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff5a72"/>
        <stop offset="45%" stop-color="#e01030"/>
        <stop offset="100%" stop-color="#7a0418"/>
      </linearGradient>
      <radialGradient id="glow${gid}">
        <stop offset="0%" stop-color="#ffd60a" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#ffd60a" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="lamp${gid}" cx="38%" cy="34%" r="70%">
        <stop offset="0%" stop-color="#fffdf2"/>
        <stop offset="60%" stop-color="#ffe9a8"/>
        <stop offset="100%" stop-color="#c9922f"/>
      </radialGradient>
      <linearGradient id="vig${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0a0410" stop-opacity="0.45"/>
        <stop offset="40%" stop-color="#0a0410" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0a0410" stop-opacity="0.7"/>
      </linearGradient>
    </defs>

    <rect width="${W}" height="${H}" fill="url(#bg${gid})"/>
    ${(() => {
      let rays = '';
      for (let i = 0; i < 16; i++) {
        rays += `<rect x="${CX}" y="52" width="170" height="${between(r, 2, 6).toFixed(1)}"
          fill="#fff" opacity="${between(r, 0.02, 0.06).toFixed(3)}"
          transform="rotate(${((i / 16) * 360).toFixed(1)} ${CX} 52)"/>`;
      }
      return rays;
    })()}
    ${road}
    <ellipse cx="${CX}" cy="70" rx="140" ry="44" fill="url(#glow${gid})"/>
    ${porsche911(44, 23, 1.3, '#e01030', '#141b30', gid)}
    ${sparks}
    <rect width="${W}" height="${H}" fill="url(#vig${gid})"/>
  </svg>`;
}
