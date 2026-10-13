/**
 * Общие детали рисунков: масти, карта, фишка, монета, бутылка, ключ.
 *
 * Объявлены через function, а не через const: в автономной сборке все модули
 * складываются в одну область видимости в алфавитном порядке, и темы,
 * стоящие по алфавиту раньше этого файла, вызывают детали при загрузке.
 * Объявление функции поднимается в начало области, константа - нет.
 */
import { hdEll, hdRect, hdNgon, hdPoly } from './kit.js';

/** Масть в квадрате со стороной 2s с центром в (cx, cy). */
export function hdSuit(k, kind, cx, cy, s, m) {
  const P = {
    heart: `M0 0.9C-0.4 0.5-1 0.1-1-0.35C-1-0.8-0.6-1-0.3-1C-0.1-1 0-0.85 0-0.7C0-0.85 0.1-1 0.3-1C0.6-1 1-0.8 1-0.35C1 0.1 0.4 0.5 0 0.9Z`,
    diamond: 'M0-1L0.72 0L0 1L-0.72 0Z',
    spade: 'M0-1C0.4-0.5 1-0.2 1 0.25C1 0.6 0.7 0.75 0.45 0.75C0.25 0.75 0.12 0.65 0.06 0.55L0.25 1H-0.25L-0.06 0.55C-0.12 0.65-0.25 0.75-0.45 0.75C-0.7 0.75-1 0.6-1 0.25C-1-0.2-0.4-0.5 0-1Z',
    club: 'M0-1A0.38 0.38 0 0 1 0.3-0.38A0.38 0.38 0 1 1 0.15 0.3L0.28 1H-0.28L-0.15 0.3A0.38 0.38 0 1 1-0.3-0.38A0.38 0.38 0 0 1 0-1Z',
  };
  const red = kind === 'heart' || kind === 'diamond';
  return k.g(`translate(${cx} ${cy}) scale(${s})`,
    k.p(P[kind], m || (red ? 'red' : 'black'), 'd', { w: 1.4 / s, g: 0.6 }));
}

/** Игральная карта: бумага с лаком, ранг в углах, масть по центру. */
export function hdCard(k, x, y, w, h, rank, suit, o = {}) {
  const red = suit === 'heart' || suit === 'diamond';
  const ink = red ? '#d0102a' : '#14121c';
  const fs = w * 0.26;
  let s = k.r(x, y, w, h, w * 0.1, o.face || 'porcelain', 'd', { w: 1.3, g: 0.5 });
  if (o.back) {
    s += k.r(x + w * 0.1, y + w * 0.1, w * 0.8, h - w * 0.2, w * 0.06, o.back, 'd', { w: 0.8, g: 0.4 });
    for (let i = 1; i < 5; i++) s += k.s(`M${x + w * 0.1} ${y + h * i / 5}L${x + w * 0.9} ${y + h * (i - 1) / 5 + w * 0.1}`, '#ffffff', 0.6, 0.3);
    return s;
  }
  s += `<text x="${x + w * 0.2}" y="${y + fs * 1.1}" font-size="${fs}" font-weight="900" text-anchor="middle" ` +
    `font-family="Unbounded, Manrope, system-ui, sans-serif" fill="${ink}">${rank}</text>`;
  s += hdSuit(k, suit, x + w * 0.2, y + fs * 1.65, fs * 0.36, red ? 'red' : 'black');
  s += hdSuit(k, suit, x + w / 2, y + h * 0.56, w * (o.big ?? 0.24), o.suitM);
  if (o.gilt) s += k.s(hdRect(x + 1.4, y + 1.4, w - 2.8, h - 2.8, w * 0.08), '#ffcf3f', 1.2, 0.9);
  return s;
}

/**
 * Фишка в перспективе: бортик-цилиндр и лицевой эллипс. Метки по борту и по
 * лицу - то, по чему фишку узнают; без них это шашка.
 */
export function hdChip(k, cx, cy, r, face, o = {}) {
  const tilt = o.tilt ?? 0.42, h = o.h ?? r * 0.22, ry = r * tilt;
  const spot = o.spot || '#ffffff', n = o.spots ?? 8;
  let s = k.p(`M${cx - r} ${cy}v${h}a${r} ${ry} 0 0 0 ${2 * r} 0v${-h}Z`, face, 'h', { w: 1.4 });
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.08 + (0.84 * i) / (n - 1));
    const x = cx - r * Math.cos(a);
    const yy = cy + ry * Math.sin(a);
    const wdt = r * 0.22 * Math.sin(a);
    if (i % 2 === 0) s += k.f(`M${x - wdt / 2} ${yy}h${wdt}v${h}h${-wdt}Z`, spot, 0.95);
  }
  s += k.e(cx, cy, r, ry, face, 'd', { w: 1.4 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    s += k.g(`translate(${cx + r * 0.84 * Math.cos(a)} ${cy + ry * 0.84 * Math.sin(a)})`,
      k.f(hdEll(0, 0, r * 0.1, ry * 0.12), spot, 0.95));
  }
  s += k.s(hdEll(cx, cy, r * 0.62, ry * 0.62), spot, 1, 0.7);
  if (o.label) {
    const fs = r * 0.5;
    s += `<text x="${cx}" y="${cy + fs * 0.28}" font-size="${fs}" font-weight="900" text-anchor="middle" ` +
      `font-family="Unbounded, Manrope, system-ui, sans-serif" fill="${o.labelColor || spot}" ` +
      `transform="translate(0 ${cy}) scale(1 ${tilt * 1.6}) translate(0 ${-cy})">${o.label}</text>`;
  }
  return s;
}

/**
 * Монета, повёрнутая к зрителю под углом: видны лицо и ребро. Чеканка
 * рисуется вызывающим поверх лица (emblem) и тоже сжимается по вертикали.
 */
export function hdCoin(k, cx, cy, r, m, emblem = '', o = {}) {
  const sy = o.sy ?? 1, h = o.h ?? r * 0.16;
  let s = k.p(`M${cx - r} ${cy}v${h}a${r} ${r * sy} 0 0 0 ${2 * r} 0v${-h}Z`, m, 'h', { w: 1.4 });
  if (o.reeded !== false) {
    for (let i = 1; i < 14; i++) {
      const x = cx - r + (2 * r * i) / 14;
      s += k.s(`M${x} ${cy + r * sy * Math.sqrt(1 - ((x - cx) / r) ** 2) * 0.2}v${h}`, k.tone(m)[3], 0.5, 0.35);
    }
  }
  s += k.e(cx, cy, r, r * sy, m, 'd', { w: 1.4, b: true, bw: r * 0.12 });
  s += k.s(hdEll(cx, cy, r * 0.8, r * 0.8 * sy), k.tone(m)[3], 0.8, 0.5);
  if (emblem) s += k.g(`translate(${cx} ${cy}) scale(1 ${sy}) translate(${-cx} ${-cy})`, emblem);
  return s;
}

/** Бутылка: горлышко, плечи, этикетка. glass - материал стекла, liquid - уровень. */
export function hdBottle(k, cx, base, w, h, glass, o = {}) {
  const neck = w * 0.3, sh = h * 0.42;
  const d = `M${cx - neck / 2} ${base - h}h${neck}v${h * 0.18}q${w * 0.35} ${h * 0.08} ${w * 0.35} ${sh * 0.4}` +
    `V${base - 3}q0 3-3 3H${cx - w / 2 + 3}q-3 0-3-3V${base - h + h * 0.18 + sh * 0.4}` +
    `q0-${sh * 0.32} ${w * 0.35}-${sh * 0.4}Z`;
  let s = k.p(d, glass, 'c', { w: 1.4, g: 0.9 });
  if (o.liquid) {
    const top = base - h * (o.level ?? 0.55);
    s += k.p(`M${cx - w / 2 + 1.5} ${top}H${cx + w / 2 - 1.5}V${base - 3}q0 1.5-1.5 1.5H${cx - w / 2 + 3}q-1.5 0-1.5-1.5Z`,
      o.liquid, 'c', { w: 0, g: 0.3, op: 0.85 });
  }
  if (o.label) s += k.r(cx - w / 2, base - h * 0.42, w, h * 0.24, 1, o.label, 'c', { w: 0.9, g: 0.3 });
  if (o.cork) s += k.r(cx - neck / 2 - 0.6, base - h - h * 0.08, neck + 1.2, h * 0.1, 1, o.cork, 'c', { w: 0.9 });
  s += k.hl(`M${cx - w / 2 + 3} ${base - h * 0.5}V${base - 6}`, 1.4, 0.55);
  return s;
}

/** Ключ: кольцо-головка, стержень, бородка. bow - готовая головка, если нужна своя. */
export function hdKey(k, x, y, len, m, o = {}) {
  const r = o.r ?? 9;
  let s = o.bow || (k.c(x, y, r, m, 'd', { b: true, bw: 2 }) + k.c(x, y, r * 0.45, '#0b0710', 'd', { w: 1.2, g: 0 }));
  s += k.r(x + r - 1, y - 2.6, len, 5.2, 2, m, 'h', { w: 1.2 });
  const bx = x + r + len - 12;
  s += k.p(`M${bx} ${y + 2}h12v8h-3v-4h-3v6h-3v-4h-3Z`, m, 'd', { w: 1.1 });
  return s;
}

/** Слиток: трапеция в перспективе с клеймом. */
export function hdIngot(k, cx, cy, w, m, o = {}) {
  const h = w * 0.34, top = w * 0.72;
  let s = k.p(`M${cx - w / 2} ${cy + h / 2}L${cx - top / 2} ${cy - h / 2}H${cx + top / 2}L${cx + w / 2} ${cy + h / 2}Z`, m, 'd', { w: 1.4, b: true, bw: 2 });
  s += k.p(`M${cx - w / 2} ${cy + h / 2}H${cx + w / 2}v${h * 0.36}H${cx - w / 2}Z`, m, 'h', { w: 1.2 });
  if (o.stamp) s += k.r(cx - top * 0.3, cy - h * 0.3, top * 0.6, h * 0.5, 1, m, 'd', { w: 0.8, g: 0.2, b: true, bw: 1 });
  return s;
}

/**
 * Перо: стержень и опахало из бородок. Залитый лист читается листиком, а
 * перо делают перо расходящиеся волокна и рваный край.
 * o.soft - доля подложки под бородками (0..1).
 */
export function hdFeather(k, x, y, len, rot, m, o = {}) {
  const t = k.tone(m);
  let barbs = '';
  for (let i = 2; i < 19; i++) {
    const f = i / 20, w = len * 0.3 * Math.sin(Math.PI * Math.min(1, f * 1.15));
    const yy = -len * f;
    barbs += k.s(`M0 ${yy}q${-w * 0.5} ${-len * 0.02} ${-w} ${-len * 0.1}`, i % 3 ? t[1] : t[0], len * 0.045, 0.95) +
      k.s(`M0 ${yy}q${w * 0.5} ${-len * 0.02} ${w} ${-len * 0.1}`, i % 2 ? t[1] : t[2], len * 0.045, 0.95);
  }
  return k.g(`translate(${x} ${y}) rotate(${rot})`,
    k.p(`M0 0C${-len * 0.34} ${-len * 0.3} ${-len * 0.3} ${-len * 0.84} 0 ${-len * 1.04}C${len * 0.3} ${-len * 0.84} ${len * 0.34} ${-len * 0.3} 0 0Z`,
      m, 'd', { w: 0, g: 0.3, op: o.soft ?? 0.55 }) +
    barbs + k.s(`M0 0V${-len * 0.98}`, t[0], Math.max(0.8, len * 0.02), 0.9));
}
