/**
 * Собственный набор иконок.
 *
 * Системные эмодзи не используются нигде: они выглядят по-разному на iOS,
 * Android и в вебе, ломают единый стиль и не поддаются перекраске. Здесь всё
 * рисуется SVG-путями и красится через currentColor или собственные градиенты.
 */

const svg = (body, viewBox = '0 0 24 24') =>
  `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" class="ico">${body}</svg>`;

/** Уникальный id градиента: иначе два одинаковых defs на странице конфликтуют. */
let gradSeq = 0;
const uid = (p) => `${p}${(gradSeq++).toString(36)}`;

function linear(stops, angle = 90) {
  const id = uid('lg');
  const rad = (angle * Math.PI) / 180;
  const x2 = (0.5 + Math.cos(rad) / 2).toFixed(3);
  const y2 = (0.5 + Math.sin(rad) / 2).toFixed(3);
  const x1 = (0.5 - Math.cos(rad) / 2).toFixed(3);
  const y1 = (0.5 - Math.sin(rad) / 2).toFixed(3);
  const marks = stops
    .map((s, i) => `<stop offset="${(i / (stops.length - 1)) * 100}%" stop-color="${s}"/>`)
    .join('');
  return {
    id,
    def: `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${marks}</linearGradient>`,
  };
}

/* ---------- Навигация ---------- */

export function iconCases() {
  const g = linear(['#ffd60a', '#ff6b35']);
  const l = linear(['#ff2e8a', '#a020ff']);
  return svg(`<defs>${g.def}${l.def}</defs>
    <path d="M3 10.5h18v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-9Z" fill="url(#${g.id})"/>
    <path d="M2.4 6.6A1.5 1.5 0 0 1 3.9 5h16.2a1.5 1.5 0 0 1 1.5 1.6l-.3 3.9H2.7l-.3-3.9Z" fill="url(#${l.id})"/>
    <rect x="10.2" y="5" width="3.6" height="16" rx="1" fill="#fff" opacity=".92"/>
    <path d="M12 5c-1.6-2.4-4.6-2-4.6.2 0 1.2 1.3 1.8 2.4 1.8" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>
    <path d="M12 5c1.6-2.4 4.6-2 4.6.2 0 1.2-1.3 1.8-2.4 1.8" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>`);
}

export function iconCrash() {
  const g = linear(['#00f0ff', '#ff2e8a']);
  return svg(`<defs>${g.def}</defs>
    <path d="M3 20c4.5-.5 8-4 10-8.5S16.4 4 21 3" stroke="url(#${g.id})" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M14.5 3.6 21 3l-.6 6.4-2.6-2.2-3.3-3.6Z" fill="#ffd60a"/>
    <circle cx="7.4" cy="17" r="2.1" fill="#ff2e8a"/>
    <circle cx="7.4" cy="17" r="3.6" stroke="#ff2e8a" stroke-width="1.1" opacity=".45"/>`);
}

export function iconRoulette() {
  const g = linear(['#ff2d55', '#ffd60a']);
  return svg(`<defs>${g.def}</defs>
    <circle cx="12" cy="12" r="9" stroke="url(#${g.id})" stroke-width="2.2"/>
    <path d="M12 3a9 9 0 0 1 7.8 4.5L12 12V3Z" fill="#ff2d55"/>
    <path d="M19.8 16.5A9 9 0 0 1 4.2 16.5L12 12l7.8 4.5Z" fill="#00ff9d" opacity=".85"/>
    <circle cx="12" cy="12" r="2.6" fill="#ffd60a"/>
    <circle cx="12" cy="12" r="1" fill="#12031d"/>`);
}

export function iconHistory() {
  const g = linear(['#00f0ff', '#a020ff']);
  return svg(`<defs>${g.def}</defs>
    <rect x="3" y="13" width="4" height="8" rx="1.3" fill="url(#${g.id})"/>
    <rect x="10" y="8" width="4" height="13" rx="1.3" fill="#ff2e8a"/>
    <rect x="17" y="3.5" width="4" height="17.5" rx="1.3" fill="#ffd60a"/>`);
}

export function iconFair() {
  const g = linear(['#00ff9d', '#00f0ff']);
  return svg(`<defs>${g.def}</defs>
    <path d="M12 2.6 20 6v6.2c0 4.7-3.3 8-8 9.2-4.7-1.2-8-4.5-8-9.2V6l8-3.4Z" fill="url(#${g.id})" opacity=".22"/>
    <path d="M12 2.6 20 6v6.2c0 4.7-3.3 8-8 9.2-4.7-1.2-8-4.5-8-9.2V6l8-3.4Z" stroke="url(#${g.id})" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="m8.2 12.2 2.6 2.6 5-5.2" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`);
}

export function iconAdmin() {
  const g = linear(['#ffd60a', '#ff6b35']);
  return svg(`<defs>${g.def}</defs>
    <path d="M3.4 8.2 7 12l3.6-6.2a1.6 1.6 0 0 1 2.8 0L17 12l3.6-3.8c1-1.1 2.7-.1 2.3 1.3l-2.5 8.6a1.6 1.6 0 0 1-1.5 1.1H5.1a1.6 1.6 0 0 1-1.5-1.1L1.1 9.5c-.4-1.4 1.3-2.4 2.3-1.3Z" fill="url(#${g.id})"/>
    <circle cx="12" cy="16.4" r="1.5" fill="#12031d" opacity=".45"/>`);
}

/* ---------- Редкости ---------- */

const TIER_SHAPES = {
  common: (c) => `<circle cx="12" cy="12" r="5.4" fill="${c}"/>`,
  uncommon: (c) => `<path d="M12 5.6 18.4 12 12 18.4 5.6 12 12 5.6Z" fill="${c}"/>`,
  rare: (c) => `<path d="M12 4.4 15.2 10 21 12l-5.8 2-3.2 5.6L8.8 14 3 12l5.8-2L12 4.4Z" fill="${c}"/>`,
  epic: (c) => `<path d="M7.4 4h9.2l3.4 5.4-8 10.6-8-10.6L7.4 4Z" fill="${c}"/>
                <path d="M3.9 9.4h16.2" stroke="#12031d" stroke-width="1" opacity=".35"/>`,
  legendary: (c) => `<path d="m12 3.2 2.6 5.7 6.2.7-4.6 4.2 1.3 6.1L12 16.8 6.5 19.9l1.3-6.1L3.2 9.6l6.2-.7L12 3.2Z" fill="${c}"/>`,
  mythic: (c) => `<path d="M12 2.8c2.4 3.4 5.8 4.6 5.8 8.8A5.8 5.8 0 0 1 12 21.2a5.8 5.8 0 0 1-5.8-9.6c0-4.2 3.4-5.4 5.8-8.8Z" fill="${c}"/>
                  <path d="M12 9.4c1.2 1.8 2.6 2.4 2.6 4.4A2.7 2.7 0 0 1 12 16.6a2.7 2.7 0 0 1-2.6-2.8c0-2 1.4-2.6 2.6-4.4Z" fill="#fff" opacity=".55"/>`,
  unique: (c) => `<path d="M4 8.6 8 12l4-7.4L16 12l4-3.4-1.8 10H5.8L4 8.6Z" fill="${c}"/>
                  <circle cx="12" cy="16" r="1.4" fill="#12031d" opacity=".4"/>`,
};

export function iconTier(tier, color) {
  const draw = TIER_SHAPES[tier] || TIER_SHAPES.common;
  return svg(`<g filter="url(#none)">${draw(color)}</g>`);
}

/* ---------- Мелкие иконки ---------- */

export function iconCoin() {
  const g = linear(['#ffe66a', '#ff9f0a']);
  return svg(`<defs>${g.def}</defs>
    <ellipse cx="12" cy="12" rx="8.4" ry="8.4" fill="url(#${g.id})"/>
    <ellipse cx="12" cy="12" rx="6" ry="6" fill="none" stroke="#a35a00" stroke-width="1.1" opacity=".55"/>
    <path d="M12 7.4v9.2M14.4 9.4c-.6-.8-4.2-1.2-4.2.9 0 1.9 4.2 1 4.2 2.9 0 2.1-3.6 1.7-4.3.8"
          stroke="#8a4a00" stroke-width="1.5" stroke-linecap="round"/>`);
}

export function iconX2() {
  const g = linear(['#00ff9d', '#ffd60a']);
  return svg(`<defs>${g.def}</defs>
    <circle cx="12" cy="12" r="9.2" fill="url(#${g.id})"/>
    <path d="M6.6 8.2 11 15.6M11 8.2 6.6 15.6" stroke="#053021" stroke-width="2.1" stroke-linecap="round"/>
    <path d="M13.6 9.2c1.6-1.6 4.2-.8 4.2 1.1 0 1.8-3.6 2.8-4.2 5.3h4.6" stroke="#053021" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`);
}

export function iconGift() {
  const g = linear(['#ff2e8a', '#a020ff']);
  return svg(`<defs>${g.def}</defs>
    <rect x="3.4" y="10" width="17.2" height="10.6" rx="1.6" fill="url(#${g.id})"/>
    <rect x="2.4" y="6.4" width="19.2" height="4.2" rx="1.4" fill="#ffd60a"/>
    <rect x="10.4" y="6.4" width="3.2" height="14.2" fill="#fff" opacity=".9"/>
    <path d="M12 6.4C10.6 3.4 7 3.9 7 5.9c0 1.1 1.4 1.6 2.6 1.6M12 6.4c1.4-3 5-2.5 5-.5 0 1.1-1.4 1.6-2.6 1.6"
          stroke="#ffd60a" stroke-width="1.5" stroke-linecap="round"/>`);
}

export function iconBolt() {
  const g = linear(['#ffd60a', '#ff2d55']);
  return svg(`<defs>${g.def}</defs>
    <path d="M13.6 2 5 13.4h5.4L9.8 22l8.8-11.6h-5.6L13.6 2Z" fill="url(#${g.id})"/>`);
}

export function iconSearch() {
  return svg(`<circle cx="10.6" cy="10.6" r="6.4" stroke="currentColor" stroke-width="2"/>
    <path d="m15.4 15.4 4.4 4.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`);
}

export function iconPlus() {
  return svg(`<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`);
}

export function iconMinus() {
  return svg(`<path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`);
}

export function iconBlock() {
  return svg(`<circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="2"/>
    <path d="m6.4 6.4 11.2 11.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`);
}

export function iconBack() {
  return svg(`<path d="M14.5 5 8 12l6.5 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
}

export const GAME_ICONS = {
  case: iconCases,
  crash: iconCrash,
  roulette: iconRoulette,
};

/** Звезда для плюшек и меток — вместо символа ★ из эмодзи-диапазона. */
export function iconStar(color = '#ffd60a') {
  return svg(`<path d="m12 3 2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 17.1 6.4 20.2l1.3-6.3L2.9 9.6l6.4-.7L12 3Z" fill="${color}"/>`);
}

/** Метки секторов рулетки: ромб, квадрат, звезда. */
export function iconRouletteMark(kind) {
  if (kind === 'green') return iconStar('#04241a');
  if (kind === 'red') return svg('<path d="M12 4 20 12 12 20 4 12 12 4Z" fill="#fff"/>');
  return svg('<rect x="5" y="5" width="14" height="14" rx="2" fill="#cbb6e8"/>');
}

/** Динамик — для переключателя звука. */
export function iconSound(on = true) {
  const waves = on
    ? '<path d="M16.4 8.6a4.6 4.6 0 0 1 0 6.8M19 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : '<path d="m17 9.5 5 5M22 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return svg(`<path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"
      fill="currentColor"/>${waves}`);
}
