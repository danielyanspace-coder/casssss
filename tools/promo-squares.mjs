/**
 * ВНИМАНИЕ: с октября 2026 на месте рисованных стоят присланные заказчиком
 * обложки (assets-src/ui/promo-casino-src.png и promo-cases-src.png,
 * обрезаны по центру до 900x782). Запуск этого скрипта перезапишет их
 * старыми рисованными - запускать, только если заказчик попросит вернуть.
 *
 * Квадратные баннеры пары: «Казино» на главной и «Кейсы» в разделе казино.
 *
 *   node tools/promo-squares.mjs <папка со шрифтами>
 *     ->  public/assets/ui/promo-casino.webp, public/assets/ui/promo-cases.webp
 *
 * В папке шрифтов mont-cyr.woff2 и mont-lat.woff2 (Montserrat 800): шрифт
 * передаётся файлами, иначе безголовый браузер мог бы впечатать запасной.
 *
 * ПОЧЕМУ ТАК, А НЕ ПОДРОБНЕЕ. На телефоне квадрат пары занимает около
 * девяноста точек в ширину. Прежние баннеры (автомат с фишками, три обложки
 * кейсов) были нарисованы мелкими деталями, и на таком размере сливались в
 * кашу - заказчик назвал это «миниатюрным и непонятным». Здесь правила
 * значка, а не иллюстрации:
 *   - один крупный знак на всю плиту, а не сцена из нескольких предметов;
 *   - толстый тёмный контур у каждой формы: край читается на любом фоне;
 *   - блики и тени - плоские формы с чёткой границей, без размытия по
 *     краям: размытый край на маленьком размере и выглядел мылом;
 *   - заголовок на всю ширину плиты.
 * Кейсы нарисованы заново, сундуком, а не обложками наших кейсов.
 *
 * Размер ровно 900x782, как у прежних: от пропорции зависит высота пары
 * баннеров (--promo-square-ratio в styles.css).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = process.argv[2];
if (!FONTS) throw new Error('укажите папку со шрифтами');
const font = (name) => readFileSync(join(FONTS, name)).toString('base64');
const W = 900;
const H = 782;
/* Цвет контура: почти чёрный с оттенком плиты, а не чистый чёрный -
   чистый на фиолетовом читается дырой. */
const INK = '#14061f';

const fontFaces = `
  @font-face { font-family: M; font-weight: 800; unicode-range: U+0400-045F; src: url(data:font/woff2;base64,${font('mont-cyr.woff2')}) format('woff2'); }
  @font-face { font-family: M; font-weight: 800; unicode-range: U+0000-00FF; src: url(data:font/woff2;base64,${font('mont-lat.woff2')}) format('woff2'); }
`;

/* Четырёхлучевая искра: острая форма, а не размытое пятно. */
const spark = (x, y, r, fill = '#fff6d6') => `
  <path d="M${x} ${y - r} Q${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y} Q${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}
           Q${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y} Q${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r}Z" fill="${fill}"/>`;

/*
 * Плита: та же форма, что у широкого баннера рядом, - скругление и светлая
 * кромка. Кромка сплошная, без свечения: свечение и было размытым краем.
 */
function plate(id, top, bottom, rim) {
  return `
    <defs>
      <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
      </linearGradient>
      <clipPath id="${id}-clip"><rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="52"/></clipPath>
    </defs>
    <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="52" fill="url(#${id}-bg)"/>
    <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="52" fill="none" stroke="${rim}" stroke-width="8"/>
    <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="44" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3"/>`;
}

/* ---------- Казино: фишка с золотой семёркой ---------- */

function chip(cx, cy, r, face, faceDark, edge, { seven = false, tilt = 0 } = {}) {
  const depth = r * 0.16;
  const inserts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 360;
    return `<rect x="${cx - r * 0.11}" y="${cy - r + 4}" width="${r * 0.22}" height="${r * 0.2}" rx="${r * 0.04}"
              fill="#fffaf2" stroke="${INK}" stroke-width="5" transform="rotate(${a} ${cx} ${cy})"/>`;
  }).join('');
  const sevenText = seven ? `
    <text x="${cx}" y="${cy + r * 0.29}" text-anchor="middle" font-family="M" font-weight="800" font-size="${r * 0.95}"
          fill="url(#gold)" stroke="${INK}" stroke-width="10" paint-order="stroke" stroke-linejoin="round">7</text>
    <path d="M${cx - r * 0.2} ${cy - r * 0.3} l${r * 0.34} 0 l-${r * 0.05} ${r * 0.08} l-${r * 0.28} 0z" fill="#fff" opacity=".55"/>` : '';
  return `<g transform="rotate(${tilt} ${cx} ${cy})">
    <!-- ребро: тот же круг ниже на толщину фишки -->
    <circle cx="${cx}" cy="${cy + depth}" r="${r}" fill="${edge}" stroke="${INK}" stroke-width="10"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${face}" stroke="${INK}" stroke-width="10"/>
    ${inserts}
    <circle cx="${cx}" cy="${cy}" r="${r * 0.66}" fill="${faceDark}" stroke="${INK}" stroke-width="8"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.56}" fill="none" stroke="#ffd34d" stroke-width="${r * 0.045}"
            stroke-dasharray="${r * 0.12} ${r * 0.08}"/>
    <!-- блик: плоский серп с чёткой границей -->
    <path d="M${cx - r * 0.86} ${cy - r * 0.1} A${r * 0.9} ${r * 0.9} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.86}
             A${r * 1.02} ${r * 1.02} 0 0 0 ${cx - r * 0.86} ${cy - r * 0.1}Z" fill="#ffffff" opacity=".42"/>
    ${sevenText}
  </g>`;
}

const casinoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4b8"/><stop offset=".45" stop-color="#ffd23f"/><stop offset="1" stop-color="#e58a00"/>
    </linearGradient>
    <radialGradient id="red" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="#ff6b81"/><stop offset=".6" stop-color="#e8264a"/><stop offset="1" stop-color="#b3112f"/>
    </radialGradient>
    <radialGradient id="violet" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="#b98cff"/><stop offset="1" stop-color="#6a2fd6"/>
    </radialGradient>
    <radialGradient id="ink" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="#4a4458"/><stop offset="1" stop-color="#1d1828"/>
    </radialGradient>
    <radialGradient id="cz-glow" cx=".5" cy=".62" r=".5">
      <stop offset="0" stop-color="#ff3d77" stop-opacity=".55"/><stop offset="1" stop-color="#ff3d77" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${plate('cz', '#3a0d3f', '#16061f', '#c03a8a')}
  <g clip-path="url(#cz-clip)">
    <!-- лучи за фишкой: чёткие клинья, а не туман -->
    <g opacity=".16" fill="#ffd9ec">
      ${Array.from({ length: 12 }, (_, i) => `<path d="M450 500 L${450 + 900 * Math.cos((i * 30 - 4) * Math.PI / 180)} ${500 + 900 * Math.sin((i * 30 - 4) * Math.PI / 180)} L${450 + 900 * Math.cos((i * 30 + 4) * Math.PI / 180)} ${500 + 900 * Math.sin((i * 30 + 4) * Math.PI / 180)}Z"/>`).join('')}
    </g>
    <ellipse cx="450" cy="510" rx="380" ry="300" fill="url(#cz-glow)"/>
    ${chip(170, 590, 120, 'url(#violet)', '#4a1aa3', '#33127a', { tilt: -18 })}
    ${chip(735, 590, 112, 'url(#ink)', '#121018', '#0b0910', { tilt: 16 })}
    ${chip(450, 500, 215, 'url(#red)', '#7d0a22', '#6b0820', { seven: true })}
    ${spark(712, 300, 34)}${spark(158, 350, 26)}${spark(640, 700, 20, '#ffd34d')}
  </g>
  <text x="450" y="190" text-anchor="middle" font-family="M" font-weight="800" font-size="158" letter-spacing="-4"
        fill="#ffffff" stroke="${INK}" stroke-width="16" paint-order="stroke" stroke-linejoin="round">Казино</text>
</svg>`;

/* ---------- Кейсы: сундук со светом из-под крышки ---------- */

/* Монета лежит плашмя: эллипс с ребром и знаком, всё с контуром. */
function coin(cx, cy, r, tilt) {
  const ry = r * 0.55;
  return `<g transform="rotate(${tilt} ${cx} ${cy})">
    <ellipse cx="${cx}" cy="${cy + r * 0.18}" rx="${r}" ry="${ry}" fill="#b86400" stroke="${INK}" stroke-width="7"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${ry}" fill="url(#ch-gold)" stroke="${INK}" stroke-width="7"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r * 0.6}" ry="${ry * 0.6}" fill="none" stroke="#c77700" stroke-width="5"/>
    <path d="M${cx - r * 0.55} ${cy - ry * 0.25} q${r * 0.3} ${-ry * 0.55} ${r * 0.75} ${-ry * 0.6}" fill="none"
          stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

const chestSvg = (() => {
  // Сундук спереди: тело - прямоугольник, крышка - арка. Правая грань чуть
  // видна: этого хватает, чтобы он был объёмным, и не добавляет мелочей.
  const x = 215; const y = 405; const w = 470; const h = 255; const side = 46; const lidH = 150;
  const lid = `M${x} ${y} L${x} ${y - lidH * 0.42} Q${x} ${y - lidH} ${x + w / 2} ${y - lidH} Q${x + w} ${y - lidH} ${x + w} ${y - lidH * 0.42} L${x + w} ${y}Z`;
  const band = (bx) => `
    <rect x="${bx}" y="${y - lidH + 6}" width="54" height="${lidH + h - 6}" fill="url(#ch-gold)" stroke="${INK}" stroke-width="9"/>
    <circle cx="${bx + 27}" cy="${y + 40}" r="9" fill="#fff4b8" stroke="${INK}" stroke-width="5"/>
    <circle cx="${bx + 27}" cy="${y + h - 40}" r="9" fill="#fff4b8" stroke="${INK}" stroke-width="5"/>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="ch-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4b8"/><stop offset=".45" stop-color="#ffcc33"/><stop offset="1" stop-color="#d97c00"/>
    </linearGradient>
    <linearGradient id="ch-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8f3bff"/><stop offset="1" stop-color="#4b14b8"/>
    </linearGradient>
    <linearGradient id="ch-lid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b57bff"/><stop offset="1" stop-color="#7a2cf0"/>
    </linearGradient>
    <linearGradient id="ch-ray" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ffe9a0" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="ch-glow" cx=".5" cy=".6" r=".5">
      <stop offset="0" stop-color="#ffc94d" stop-opacity=".5"/><stop offset="1" stop-color="#ffc94d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${plate('ch', '#1d1050', '#0b0620', '#7d5cff')}
  <g clip-path="url(#ch-clip)">
    <ellipse cx="450" cy="470" rx="400" ry="300" fill="url(#ch-glow)"/>
    <!-- лучи из щели под крышкой -->
    ${[-62, -38, -14, 10, 34, 58].map((a) => {
      const r = (d) => (d * Math.PI) / 180;
      const len = 420;
      const x1 = 450 + len * Math.sin(r(a - 6)); const y1 = y - len * Math.cos(r(a - 6));
      const x2 = 450 + len * Math.sin(r(a + 6)); const y2 = y - len * Math.cos(r(a + 6));
      return `<path d="M${430 + a} ${y} L${x1} ${y1} L${x2} ${y2} L${470 + a} ${y}Z" fill="url(#ch-ray)" opacity=".55"/>`;
    }).join('')}
    <!-- тень на полу: плоский эллипс с чёткой границей -->
    <ellipse cx="455" cy="${y + h + 22}" rx="${w * 0.58}" ry="30" fill="#000" opacity=".45"/>
    <!-- правая грань: у тела и у крышки своя, крышка светлее - свет сверху -->
    <path d="M${x + w} ${y} L${x + w + side} ${y + 18} L${x + w + side} ${y + h + 14} L${x + w} ${y + h}Z"
          fill="#2c0b78" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M${x + w} ${y - lidH * 0.42} Q${x + w + side * 0.4} ${y - lidH * 0.42 - 2} ${x + w + side} ${y - lidH * 0.42 + 22}
             L${x + w + side} ${y + 18} L${x + w} ${y}Z"
          fill="#4a1bb0" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    <!-- тело -->
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#ch-body)" stroke="${INK}" stroke-width="10"/>
    <!-- доски: две тёмные линии -->
    <path d="M${x + 10} ${y + h * 0.36} H${x + w - 10} M${x + 10} ${y + h * 0.7} H${x + w - 10}" stroke="#3a0f99" stroke-width="8"/>
    <!-- крышка -->
    <path d="${lid}" fill="url(#ch-lid)" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M${x + 30} ${y - lidH * 0.5} Q${x + 40} ${y - lidH * 0.9} ${x + w * 0.42} ${y - lidH + 16}"
          fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="16" stroke-linecap="round"/>
    ${band(x + 40)}${band(x + w - 94)}
    <!-- щель со светом между крышкой и телом -->
    <rect x="${x + 4}" y="${y - 9}" width="${w - 8}" height="18" fill="#ffe27a" stroke="${INK}" stroke-width="6"/>
    <!-- замок -->
    <path d="M${450 - 62} ${y - 50} h124 v112 q0 34 -62 52 q-62 -18 -62 -52z" fill="url(#ch-gold)" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    <circle cx="450" cy="${y + 14}" r="17" fill="${INK}"/>
    <path d="M443 ${y + 22} h14 l5 34 h-24z" fill="${INK}"/>
    <path d="M${450 - 46} ${y - 38} h40 l-10 14 h-30z" fill="#fff" opacity=".6"/>
    <!-- россыпь монет у подножия: золото из сундука, крупно и с контуром -->
    ${[[188, 668, 40, -8], [262, 694, 34, 12], [150, 712, 30, 4], [700, 672, 38, 10], [770, 700, 32, -10], [636, 712, 28, 0]]
      .map(([cx, cy, r, a]) => coin(cx, cy, r, a)).join('')}
    ${spark(732, 250, 34)}${spark(170, 300, 26)}${spark(470, 690, 22, '#ffd34d')}
  </g>
  <text x="450" y="190" text-anchor="middle" font-family="M" font-weight="800" font-size="158" letter-spacing="-4"
        fill="#ffffff" stroke="${INK}" stroke-width="16" paint-order="stroke" stroke-linejoin="round">Кейсы</text>
</svg>`;
})();

async function render(svg, out) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><html><head><style>${fontFaces}
    html, body { margin: 0; width: ${W}px; height: ${H}px; background: transparent; overflow: hidden; }
    svg { display: block; }</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const png = await page.screenshot({ omitBackground: true });
  await browser.close();
  const webp = await sharp(png).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  writeFileSync(join(ROOT, 'public/assets/ui', out), webp);
  console.log(`${out}: ${(webp.length / 1024).toFixed(0)} КБ`);
}

await render(casinoSvg, 'promo-casino.webp');
await render(chestSvg, 'promo-cases.webp');
