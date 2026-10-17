/**
 * Медали: девять рисунков одного размера и девяти разных конструкций.
 *
 * Первая версия была одной медалью девять раз: золотой круг, фиолетовая лента
 * и цифра посередине. Различалась только цифра, и сетка читалась как список.
 * Здесь у каждой медали своё всё: силуэт (монета, пламя, шестигранник, щит,
 * крылья, венок, подкова, молния, звезда), металл, эмаль и рисунок ленты.
 * Общее только устройство, как у настоящих наградных медалей: прямая лента
 * продета в металлическую перемычку, под ней - тело медали. Поле одно на всех,
 * 120x160, поэтому в сетке они стоят ровно, хотя похожих среди них нет.
 *
 * Id градиентов уникальны на каждую отрисовку (medalSeq): одна медаль
 * встречается и в сетке, и в сцене получения, и url(#...) второй копии иначе
 * указывал бы на первую.
 *
 * Все имена верхнего уровня начинаются с medal: автономная сборка складывает
 * модули клиента в одну область видимости.
 */

let medalSeq = 0;

/** Металлы: четыре тона сверху вниз, как у объёмных рисунков предметов. */
const MEDAL_METALS = {
  gold: ['#fffbe6', '#ffd34d', '#b8740f', '#ffe9a0'],
  silver: ['#ffffff', '#d6dde9', '#6f7f99', '#f1f4f9'],
  bronze: ['#ffe0bd', '#d68d4f', '#7a3f12', '#f2b37c'],
  dark: ['#6a5a86', '#2a1d40', '#0d0716', '#3d2c5c'],
};

function medalDefs(u, metal) {
  const m = MEDAL_METALS[metal];
  return `<linearGradient id="${u}m" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${m[0]}"/><stop offset=".42" stop-color="${m[1]}"/>
      <stop offset=".58" stop-color="${m[2]}"/><stop offset="1" stop-color="${m[3]}"/></linearGradient>
    <radialGradient id="${u}sh" cx=".32" cy=".25" r=".7">
      <stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}rs" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
    <clipPath id="${u}rc"><rect x="38" y="0" width="44" height="56"/></clipPath>`;
}

/**
 * Лента и перемычка. Рисунок ленты - своё у каждой медали; поверх него общий
 * спад в тень книзу и складка посередине: без них лента выглядит наклейкой.
 */
function medalRibbon(u, pattern) {
  return `<g clip-path="url(#${u}rc)">${pattern}</g>
    <rect x="38" y="0" width="44" height="56" fill="url(#${u}rs)"/>
    <path d="M60 0V54" stroke="#000" stroke-opacity=".18" stroke-width="1.2"/>
    <rect x="31" y="49" width="58" height="11" rx="3.5" fill="url(#${u}m)" stroke="#000" stroke-opacity=".35"/>
    <rect x="35" y="52" width="50" height="3" rx="1.5" fill="#000" opacity=".35"/>
    <rect x="55" y="57" width="10" height="16" rx="4" fill="none" stroke="url(#${u}m)" stroke-width="3"/>`;
}

/** Надпись по окружности, как гравировка на ободе. */
function medalRing(u, r, text, color = '#5a3006', size = 6.4) {
  return `<path id="${u}tp" d="M60 108m-${r} 0a${r} ${r} 0 1 1 ${r * 2} 0a${r} ${r} 0 1 1 -${r * 2} 0" fill="none"/>
    <text font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="${size}" letter-spacing="1.6" fill="${color}" opacity=".85">
      <textPath href="#${u}tp" startOffset="0">${text}</textPath></text>`;
}

const MEDAL_ART = {
  /* Бронзовая монета с насечкой по кромке и выпуклой единицей. */
  r1(u) {
    const stripes = [0, 1, 2, 3, 4, 5].map((i) =>
      `<rect x="${38 + i * 8}" y="0" width="4" height="56" fill="${i % 2 ? '#f4ecff' : '#9b6cf2'}"/>`).join('');
    return `${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#5b2bb0"/>${stripes}`)}
      <circle cx="60" cy="108" r="42" fill="url(#${u}m)" stroke="#5a2a08" stroke-width="1.5"/>
      <circle cx="60" cy="108" r="39" fill="none" stroke="#7a3f12" stroke-width="2.4" stroke-dasharray="1.6 2.2"/>
      <circle cx="60" cy="108" r="30" fill="#b06a2c" stroke="#ffe0bd" stroke-opacity=".6"/>
      ${medalRing(u, 34.5, 'ПЕРВЫЙ РАУНД · LUCKYBOX · ПЕРВЫЙ РАУНД ·', '#4a2206', 5.6)}
      <text x="60" y="124" text-anchor="middle" font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="42"
        fill="url(#${u}m)" stroke="#5a2a08" stroke-width="1.2">1</text>
      <path d="M78 92l1.6 3.4 3.6.4-2.7 2.5.8 3.6-3.3-1.8-3.3 1.8.8-3.6-2.7-2.5 3.6-.4z" fill="#ffe0bd"/>
      <circle cx="60" cy="108" r="42" fill="url(#${u}sh)"/>`;
  },

  /* Пламя, вырубленное по силуэту: эмаль трёх огненных тонов вокруг диска. */
  r10(u) {
    const diag = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      `<path d="M${20 + i * 12} 0l-22 56h5l22-56z" fill="#7a0d10" opacity=".35"/>`).join('');
    return `<defs><linearGradient id="${u}f" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#ffd34d"/><stop offset=".45" stop-color="#ff6a1a"/><stop offset="1" stop-color="#c1121f"/></linearGradient></defs>
      ${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="url(#${u}f)"/>${diag}`)}
      <path d="M60 60c6 12 22 16 26 32 3-6 2-12 0-16 10 8 16 22 12 38-4 18-20 30-38 30s-34-12-38-30c-3-14 2-26 10-34 0 6 2 10 6 12-2-14 10-22 22-32z"
        fill="url(#${u}m)" stroke="#6b2b00" stroke-width="1.4"/>
      <path d="M60 68c4 9 16 13 19 25 2-4 2-8 1-11 6 6 10 16 8 27-3 13-15 22-28 22s-25-9-28-22c-2-10 1-19 6-24 0 4 2 7 4 8-1-10 7-16 18-25z"
        fill="url(#${u}f)"/>
      <circle cx="60" cy="116" r="19" fill="url(#${u}m)" stroke="#6b2b00" stroke-width="1.2"/>
      <circle cx="60" cy="116" r="15" fill="#3a1205"/>
      <text x="60" y="122" text-anchor="middle" font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="16" fill="#ffd34d">10</text>
      <path d="M60 60c6 12 22 16 26 32" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>`;
  },

  /* Хромированный шестигранник с неоновой рамкой эмали. */
  r100(u) {
    const chev = [0, 1, 2, 3, 4].map((i) =>
      `<path d="M38 ${i * 12 - 2}l22 9 22-9v5l-22 9-22-9z" fill="#22d3ee" opacity=".85"/>`).join('');
    const hex = (r) => Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(60 + Math.cos(a) * r).toFixed(1)},${(108 + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    return `${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#0b0f1a"/>${chev}`)}
      <polygon points="${hex(45)}" fill="url(#${u}m)" stroke="#2a3446" stroke-width="1.4"/>
      <polygon points="${hex(38)}" fill="#0a1a24"/>
      <polygon points="${hex(34)}" fill="none" stroke="#22d3ee" stroke-width="3.2"/>
      <polygon points="${hex(34)}" fill="none" stroke="#a5f3fc" stroke-width="1" opacity=".9"/>
      <text x="60" y="114" text-anchor="middle" font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="19"
        fill="#cffafe" stroke="#22d3ee" stroke-width=".6">100</text>
      <text x="60" y="128" text-anchor="middle" font-family="Manrope,sans-serif" font-weight="800" font-size="6.5" letter-spacing="2" fill="#67e8f9">РАУНДОВ</text>
      <polygon points="${hex(45)}" fill="url(#${u}sh)"/>`;
  },

  /* Геральдический щит: багровая эмаль, скрещённые мечи, свиток с числом. */
  r500(u) {
    return `${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#b91c1c"/>
        <rect x="52" y="0" width="16" height="56" fill="#ffd34d"/>
        <rect x="56" y="0" width="1.4" height="56" fill="#fff" opacity=".8"/><rect x="62.6" y="0" width="1.4" height="56" fill="#fff" opacity=".8"/>`)}
      <path d="M60 62l38 10v30c0 26-18 42-38 50-20-8-38-24-38-50V72z" fill="url(#${u}m)" stroke="#5a3006" stroke-width="1.4"/>
      <path d="M60 69l31 8v25c0 21-14 34-31 41-17-7-31-20-31-41V77z" fill="#8f0f1f"/>
      <path d="M60 69l31 8v25c0 21-14 34-31 41z" fill="#c1121f" opacity=".55"/>
      <g stroke="#ffd34d" stroke-width="3.4" stroke-linecap="round">
        <path d="M42 84l34 36"/><path d="M78 84l-34 36"/></g>
      <g fill="url(#${u}m)"><rect x="36" y="80" width="10" height="4" rx="1.5" transform="rotate(45 41 82)"/>
        <rect x="74" y="80" width="10" height="4" rx="1.5" transform="rotate(-45 79 82)"/></g>
      <path d="M30 120h60l-5 6 5 6H30l5-6z" fill="url(#${u}m)" stroke="#5a3006"/>
      <text x="60" y="129.5" text-anchor="middle" font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="9" fill="#5a3006">500</text>
      <path d="M60 62l38 10v30c0 26-18 42-38 50-20-8-38-24-38-50V72z" fill="url(#${u}sh)"/>`;
  },

  /*
   * Награда за тысячу открытий: хромовое кольцо с гравировкой, радужные
   * крылья эмалью по бокам и вращающийся центр. Это единственная медаль с
   * деньгами (×10 к следующему выигрышу), и выглядеть она должна главной.
   */
  c1000(u) {
    const dots = [[42, 6, 5, '#ff3b5c'], [55, 12, 7, '#22c55e'], [72, 4, 6, '#3b82f6'], [48, 24, 6, '#facc15'],
      [70, 22, 8, '#ef4444'], [60, 36, 5, '#a855f7'], [44, 44, 7, '#3b82f6'], [76, 42, 6, '#facc15'],
      [62, 50, 4, '#22c55e'], [80, 12, 3, '#fff'], [50, 34, 2.5, '#fff'], [40, 30, 3, '#f97316']];
    const splash = dots.map(([x, y, r, c]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('');
    const bands = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];
    // Крылья - дуги эмали за кольцом: правое длинное уходит вверх, левое
    // короткое вниз, как у присланного образца. Внутренний край прячется под
    // кольцо, наружу выходит радуга.
    const p = (r, a) => `${(60 + Math.cos(a) * r).toFixed(1)} ${(108 + Math.sin(a) * r).toFixed(1)}`;
    const wing = (a0, a1) => bands.map((c, i) => {
      const r0 = 36 + i * 3.6, r1 = r0 + 3.2;
      const sweep = a1 > a0 ? 1 : 0;
      return `<path d="M${p(r0, a0)} A${r0} ${r0} 0 0 ${sweep} ${p(r0, a1)} L${p(r1, a1)} A${r1} ${r1} 0 0 ${1 - sweep} ${p(r1, a0)}Z"
        fill="${c}" stroke="#c9d3e3" stroke-width=".7"/>`;
    }).join('');
    return `${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#141018"/>${splash}`)}
      ${wing(0.65, -1.15)}${wing(Math.PI - 0.15, Math.PI + 0.85)}
      <circle cx="60" cy="108" r="40" fill="url(#${u}m)" stroke="#3b4456" stroke-width="1.4"/>
      ${medalRing(u, 35.5, 'ДЕСЯТИКРАТНЫЙ · 1000 КЕЙСОВ · LUCKYBOX ·', '#3b4456', 5.4)}
      <circle cx="60" cy="108" r="29" fill="#0d0716" stroke="#c9d3e3" stroke-width="1.6"/>
      <g class="medal-spin" style="transform-origin:60px 108px">
        <circle cx="60" cy="108" r="26" fill="none" stroke="#a855f7" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>
        <text x="60" y="115" text-anchor="middle" font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="20" fill="#facc15"
          stroke="#7c3aed" stroke-width="1.4" paint-order="stroke">×10</text>
      </g>
      <circle cx="60" cy="108" r="40" fill="url(#${u}sh)"/>`;
  },

  /* Лавровый венок вокруг огранённого рубина, сверху корона. */
  r5000(u) {
    const leaves = Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI * (0.62 + i * 0.105);
      const x = 60 + Math.cos(a) * 36, y = 110 + Math.sin(a) * 36;
      const rot = (a * 180) / Math.PI + 90;
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.6" ry="8" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
        + `<ellipse cx="${(120 - x).toFixed(1)}" cy="${y.toFixed(1)}" rx="3.6" ry="8" transform="rotate(${(-rot).toFixed(0)} ${(120 - x).toFixed(1)} ${y.toFixed(1)})"/>`;
    }).join('');
    return `<defs><radialGradient id="${u}r" cx=".4" cy=".3" r=".8">
        <stop offset="0" stop-color="#ffb3c1"/><stop offset=".45" stop-color="#e11d48"/><stop offset="1" stop-color="#5b0718"/></radialGradient></defs>
      ${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#4c1d95"/>
        <rect x="38" y="0" width="5" height="56" fill="#ffd34d"/><rect x="77" y="0" width="5" height="56" fill="#ffd34d"/>
        ${[8, 22, 36].map((y) => `<circle cx="60" cy="${y}" r="2.2" fill="#ffd34d"/>`).join('')}`)}
      <g fill="url(#${u}m)" stroke="#5a3006" stroke-width=".8">${leaves}</g>
      <path d="M44 72l6 8 10-12 10 12 6-8 2 14H42z" fill="url(#${u}m)" stroke="#5a3006"/>
      <circle cx="50" cy="71" r="2.2" fill="#e11d48"/><circle cx="60" cy="66" r="2.4" fill="#22d3ee"/><circle cx="70" cy="71" r="2.2" fill="#e11d48"/>
      <path d="M60 88l18 10v20l-18 12-18-12V98z" fill="url(#${u}r)" stroke="url(#${u}m)" stroke-width="2.6"/>
      <path d="M60 88v42M42 98l36 20M78 98l-36 20" stroke="#fff" stroke-opacity=".25" stroke-width=".8"/>
      <path d="M60 88l18 10-18 8-18-8z" fill="#fff" opacity=".28"/>
      <path d="M38 138h44" stroke="url(#${u}m)" stroke-width="3" stroke-linecap="round"/>`;
  },

  /* Подкова на удачу: золото, изумрудная эмаль, гвозди, клевер внутри. */
  x10(u) {
    const argyle = [0, 1, 2, 3].map((i) =>
      `<path d="M60 ${i * 15 - 4}l11 8-11 8-11-8z" fill="#ffd34d" opacity=".9"/>`).join('');
    const holes = [-1.2, -0.75, -0.3, 0.3, 0.75, 1.2].map((k) => {
      const a = Math.PI / 2 + k * 1.15;
      return `<circle cx="${(60 + Math.cos(a) * 34).toFixed(1)}" cy="${(102 + Math.sin(a) * 34).toFixed(1)}" r="2" fill="#3a1d00"/>`;
    }).join('');
    return `${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#047857"/>${argyle}`)}
      <path d="M30 78c-8 16-8 40 6 56 12 13 36 13 48 0 14-16 14-40 6-56l-14 4c5 12 5 28-3 38-7 8-19 8-26 0-8-10-8-26-3-38z"
        fill="url(#${u}m)" stroke="#5a3006" stroke-width="1.4"/>
      <path d="M36 82c-6 14-6 34 5 47 10 11 28 11 38 0 11-13 11-33 5-47l-6 2c4 11 4 26-3 35-8 9-22 9-30 0-7-9-7-24-3-35z" fill="#059669"/>
      ${holes}
      <rect x="27" y="72" width="16" height="9" rx="2" fill="url(#${u}m)" stroke="#5a3006"/>
      <rect x="77" y="72" width="16" height="9" rx="2" fill="url(#${u}m)" stroke="#5a3006"/>
      <g fill="#22c55e" stroke="#065f46" stroke-width=".8">
        <circle cx="55" cy="104" r="5.5"/><circle cx="65" cy="104" r="5.5"/><circle cx="55" cy="114" r="5.5"/><circle cx="65" cy="114" r="5.5"/></g>
      <path d="M60 109c2 6 4 10 8 14" stroke="#065f46" stroke-width="1.6" fill="none"/>
      <path d="M30 78c-8 16-8 40 6 56" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" fill="none"/>`;
  },

  /* Молния пробивает тёмный диск и выходит за его край. */
  x50(u) {
    return `<defs><linearGradient id="${u}b" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e0f2fe"/><stop offset=".45" stop-color="#38bdf8"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>
      ${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="#0f1b4d"/>
        <path d="M38 10l8 6 8-6 8 6 8-6 8 6 4-3M38 30l8 6 8-6 8 6 8-6 8 6 4-3" fill="none" stroke="#e0f2fe" stroke-width="2.4"/>
        <path d="M38 48l8 6 8-6 8 6 8-6 8 6 4-3" fill="none" stroke="#38bdf8" stroke-width="2.4"/>`)}
      <circle cx="60" cy="108" r="40" fill="#0b1026" stroke="url(#${u}m)" stroke-width="5"/>
      <circle cx="60" cy="108" r="34" fill="none" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="2 3" opacity=".8"/>
      <path d="M68 58L36 114h20l-10 44 38-60H62z" fill="url(#${u}b)" stroke="url(#${u}m)" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M68 58L36 114h20" fill="none" stroke="#fff" stroke-width="1.2" opacity=".8"/>
      <text x="78" y="134" text-anchor="middle" font-family="Unbounded,Manrope,sans-serif" font-weight="800" font-size="8.5" fill="#e0f2fe">×50</text>`;
  },

  /* Звезда с голографической эмалью и лучами за ней. */
  x100(u) {
    const star = (r1, r2) => Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? r2 : r1;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return `${(60 + Math.cos(a) * r).toFixed(1)},${(110 + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    const rays = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return `<path d="M60 110L${(60 + Math.cos(a - 0.08) * 48).toFixed(1)} ${(110 + Math.sin(a - 0.08) * 48).toFixed(1)}L${(60 + Math.cos(a + 0.08) * 48).toFixed(1)} ${(110 + Math.sin(a + 0.08) * 48).toFixed(1)}z"/>`;
    }).join('');
    return `<defs><linearGradient id="${u}h" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fbcfe8"/><stop offset=".25" stop-color="#c4b5fd"/><stop offset=".5" stop-color="#a5f3fc"/>
        <stop offset=".75" stop-color="#bbf7d0"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs>
      ${medalRibbon(u, `<rect x="38" y="0" width="44" height="56" fill="url(#${u}h)"/>
        ${[[46, 10], [70, 22], [52, 38], [74, 48]].map(([x, y]) => `<path d="M${x} ${y - 4}l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="#fff"/>`).join('')}`)}
      <g fill="#fde68a" opacity=".35">${rays}</g>
      <polygon points="${star(46, 20)}" fill="url(#${u}m)" stroke="#5a3006" stroke-width="1.4" stroke-linejoin="round"/>
      <polygon points="${star(38, 16)}" fill="url(#${u}h)"/>
      <polygon points="${star(38, 16)}" fill="url(#${u}sh)"/>
      <path d="M60 98l2.5 7.5 7.5 2.5-7.5 2.5-2.5 7.5-2.5-7.5-7.5-2.5 7.5-2.5z" fill="#fff"/>`;
  },
};

/** Металл каждой медали: соседние в сетке не должны быть одного цвета. */
const MEDAL_METAL_OF = {
  r1: 'bronze', r10: 'gold', r100: 'silver', r500: 'gold', c1000: 'silver',
  r5000: 'gold', x10: 'gold', x50: 'silver', x100: 'gold',
};

/** Рисунок медали по её id. */
export function medalSvg(id) {
  const draw = MEDAL_ART[id];
  if (!draw) return '';
  const u = `md${(medalSeq++).toString(36)}`;
  return `<svg viewBox="0 0 120 160" aria-hidden="true"><defs>${medalDefs(u, MEDAL_METAL_OF[id] || 'gold')}</defs>${draw(u)}</svg>`;
}

/** Какие медали нарисованы - для проверки, что у каждой из списка есть рисунок. */
export const MEDAL_IDS = Object.keys(MEDAL_ART);
