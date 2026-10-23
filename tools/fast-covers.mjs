/**
 * Обложки наших быстрых игр для вкладки «Быстрые игры» казино: Краш и Апгрейд.
 *
 *   node tools/fast-covers.mjs <папка со шрифтами>
 *     ->  public/assets/ui/fast-crash.webp, public/assets/ui/fast-upgrade.webp
 *
 * В папке шрифтов osw-cyr.woff2 и osw-lat.woff2 (Oswald 700): шрифт
 * передаётся файлами, иначе безголовый браузер впечатал бы запасной.
 *
 * ПОЧЕМУ ТАК. Наши игры стоят в одной сетке с играми Spribe (Aviator, Mines,
 * Dice) и обязаны читаться как одна полка: те же 3:4, насыщенный фон одного
 * цвета, крупный объёмный предмет в верхней части и огромное узкое название
 * внизу. Цвета фона выбраны так, чтобы не совпасть ни с одной из соседних
 * обложек: у Spribe красный, зелёный, синий и оранжевый, у нас малиновый и
 * фиолетовый - цвета самого проекта.
 *
 * Объём - градиентами и бликами, размытие только на фоне (свечение, боке):
 * картинка рисуется один раз заранее, в браузере игрока фильтров нет.
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
/* Размер как у вертикальных обложек Spribe (480x640): та же пропорция и та
   же резкость в одной сетке. */
const W = 480;
const H = 640;

const fontFaces = `
  @font-face { font-family: O; font-weight: 700; unicode-range: U+0400-045F; src: url(data:font/woff2;base64,${font('osw-cyr.woff2')}) format('woff2'); }
  @font-face { font-family: O; font-weight: 700; unicode-range: U+0000-00FF; src: url(data:font/woff2;base64,${font('osw-lat.woff2')}) format('woff2'); }
`;

const sparkle = (x, y, r, o = 1) => `
  <path opacity="${o}" d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}
           Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="#fff"/>`;

/* Боке: размытые круги разной глубины, как в рендерах Spribe. */
const bokeh = (spots) => spots.map(([x, y, r, c, o]) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}" filter="url(#blur)"/>`).join('');

/* Название: огромное, узкое, белое, с мягкой тенью вниз. Подпись проекта
   под ним, как «SPRIBE» под «AVIATOR». */
function title(text, size) {
  return `
    <text x="${W / 2}" y="578" text-anchor="middle" font-family="O" font-weight="700" font-size="${size}"
          fill="#000" opacity="0.28" filter="url(#soft)">${text}</text>
    <text x="${W / 2}" y="572" text-anchor="middle" font-family="O" font-weight="700" font-size="${size}"
          fill="#fff">${text}</text>
    <text x="${W / 2}" y="616" text-anchor="middle" font-family="O" font-weight="700" font-size="22"
          letter-spacing="3" fill="#fff" opacity="0.9">LUCKYBOX</text>
    <rect x="${W / 2 - 52}" y="622" width="104" height="2.5" fill="#fff" opacity="0.75"/>`;
}

const commonDefs = `
  <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>`;

/* ---------- Краш: ракета на взлёте по кривой множителя ---------- */

function crashCover() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${commonDefs}
    <radialGradient id="cBg" cx="0.55" cy="0.32" r="0.85">
      <stop offset="0" stop-color="#ff5fa2"/><stop offset="0.45" stop-color="#c41866"/><stop offset="1" stop-color="#3a0726"/>
    </radialGradient>
    <linearGradient id="cBottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a0726" stop-opacity="0"/><stop offset="1" stop-color="#2a0419" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="cCurve" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ff9ccb" stop-opacity="0"/><stop offset="0.35" stop-color="#ffd1e6"/><stop offset="1" stop-color="#fff"/>
    </linearGradient>
    <linearGradient id="cArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9ccb" stop-opacity="0.45"/><stop offset="1" stop-color="#ff9ccb" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cBody" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8d93d8"/><stop offset="0.3" stop-color="#f4f5ff"/><stop offset="0.55" stop-color="#ffffff"/>
      <stop offset="0.8" stop-color="#c6c9f0"/><stop offset="1" stop-color="#6a6fb8"/>
    </linearGradient>
    <linearGradient id="cRed" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9c0a3e"/><stop offset="0.4" stop-color="#ff3d74"/><stop offset="0.65" stop-color="#ff7aa0"/><stop offset="1" stop-color="#8a0636"/>
    </linearGradient>
    <radialGradient id="cGlass" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#e9fbff"/><stop offset="0.35" stop-color="#5fd0ff"/><stop offset="1" stop-color="#1b3f9e"/>
    </radialGradient>
    <linearGradient id="cFlame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffbe0"/><stop offset="0.25" stop-color="#ffd84a"/><stop offset="0.6" stop-color="#ff7a2a"/><stop offset="1" stop-color="#ff2a6a" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#cBg)"/>
  ${bokeh([[60, 120, 46, '#ffb3d4', 0.35], [420, 80, 60, '#ff8cc0', 0.3], [400, 360, 70, '#ff4f9a', 0.28], [80, 420, 54, '#ffd6e8', 0.18]])}

  <g transform="translate(250 250) scale(1.22) translate(-250 -250)">
  <!-- Кривая множителя: та же, по которой летит ракета в игре -->
  <path d="M-10 470 C 150 465, 250 400, 330 250 L 330 470 Z" fill="url(#cArea)"/>
  <path d="M-10 470 C 150 465, 250 400, 330 250" fill="none" stroke="#fff" stroke-width="14" opacity="0.35" filter="url(#glow)"/>
  <path d="M-10 470 C 150 465, 250 400, 330 250" fill="none" stroke="url(#cCurve)" stroke-width="7" stroke-linecap="round"/>

  <!-- Ракета, наклонённая по ходу кривой -->
  <g transform="translate(318 214) rotate(38)">
    <!-- пламя -->
    <path d="M-30 96 C -26 160, -10 210, 0 250 C 10 210, 26 160, 30 96 Z" fill="url(#cFlame)" filter="url(#soft)" opacity="0.95"/>
    <path d="M-18 96 C -14 140, -6 175, 0 200 C 6 175, 14 140, 18 96 Z" fill="#fffbe6" opacity="0.9"/>
    <!-- стабилизаторы -->
    <path d="M-44 40 C -86 70, -92 110, -84 128 L -40 98 Z" fill="url(#cRed)"/>
    <path d="M44 40 C 86 70, 92 110, 84 128 L 40 98 Z" fill="url(#cRed)"/>
    <!-- корпус -->
    <path d="M0 -150 C 52 -110, 62 -20, 50 96 L -50 96 C -62 -20, -52 -110, 0 -150 Z" fill="url(#cBody)"/>
    <!-- нос -->
    <path d="M0 -150 C 34 -124, 46 -92, 49 -64 C 18 -74, -18 -74, -49 -64 C -46 -92, -34 -124, 0 -150 Z" fill="url(#cRed)"/>
    <!-- юбка сопла -->
    <path d="M-50 96 L 50 96 L 40 116 L -40 116 Z" fill="#5d4f8e"/>
    <path d="M-40 116 L 40 116 L 34 124 L -34 124 Z" fill="#2b2050"/>
    <!-- иллюминатор -->
    <circle cx="0" cy="-12" r="27" fill="#3b2e6e"/>
    <circle cx="0" cy="-12" r="21" fill="url(#cGlass)"/>
    <ellipse cx="-7" cy="-21" rx="8" ry="5" fill="#fff" opacity="0.85" transform="rotate(-30 -7 -21)"/>
    <!-- полоса и блик корпуса -->
    <rect x="-55" y="40" width="110" height="10" fill="url(#cRed)" opacity="0.95"/>
    <path d="M-22 -110 C -34 -70, -38 -10, -34 80" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.7"/>
    <!-- средний стабилизатор -->
    <path d="M-7 70 L 7 70 L 6 128 L -6 128 Z" fill="url(#cRed)"/>
  </g>
  </g>

  ${sparkle(110, 210, 14)}${sparkle(410, 430, 10, 0.85)}${sparkle(70, 330, 8, 0.7)}${sparkle(440, 170, 7, 0.8)}
  <rect y="380" width="${W}" height="260" fill="url(#cBottom)"/>
  ${title('КРАШ', 150)}
</svg>`;
}

/* ---------- Апгрейд: самоцвет со стрелками вверх над шкалой шанса ---------- */

function upgradeCover() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${commonDefs}
    <radialGradient id="uBg" cx="0.5" cy="0.33" r="0.85">
      <stop offset="0" stop-color="#b98bff"/><stop offset="0.45" stop-color="#6a2bd6"/><stop offset="1" stop-color="#1d0a45"/>
    </radialGradient>
    <linearGradient id="uBottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d0a45" stop-opacity="0"/><stop offset="1" stop-color="#140734" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="uRing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7cf3ff"/><stop offset="1" stop-color="#ff7ad0"/>
    </linearGradient>
    <linearGradient id="uGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4c2"/><stop offset="0.35" stop-color="#ffd05a"/><stop offset="0.7" stop-color="#f39a1d"/><stop offset="1" stop-color="#b8620a"/>
    </linearGradient>
    <linearGradient id="uF1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eafcff"/><stop offset="1" stop-color="#8ae6ff"/></linearGradient>
    <linearGradient id="uF2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fd6ff"/><stop offset="1" stop-color="#3d7bf0"/></linearGradient>
    <linearGradient id="uF3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9a4ff"/><stop offset="1" stop-color="#5b3ce0"/></linearGradient>
    <linearGradient id="uF4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a8cff"/><stop offset="1" stop-color="#2a2a9e"/></linearGradient>
    <linearGradient id="uF5" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9be0"/><stop offset="1" stop-color="#9b3ce0"/></linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#uBg)"/>
  ${bokeh([[70, 110, 50, '#e2c8ff', 0.3], [410, 90, 56, '#9fe9ff', 0.26], [420, 380, 66, '#c06bff', 0.28], [60, 400, 50, '#ffb3e6', 0.2]])}

  <g transform="translate(240 256) scale(1.16) translate(-240 -240)">
  <!-- Шкала шанса: кольцо апгрейда с подсвеченной долей -->
  <circle cx="240" cy="250" r="168" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="20"/>
  <path d="M240 82 A168 168 0 0 1 398 307" fill="none" stroke="url(#uRing)" stroke-width="22" stroke-linecap="round" opacity="0.5" filter="url(#glow)"/>
  <path d="M240 82 A168 168 0 0 1 398 307" fill="none" stroke="url(#uRing)" stroke-width="16" stroke-linecap="round"/>
  <circle cx="398" cy="307" r="13" fill="#fff"/>

  <!-- Самоцвет: грани разного света, свет сверху слева -->
  <g transform="translate(240 286)">
    <ellipse cx="0" cy="118" rx="96" ry="16" fill="#0b0322" opacity="0.45" filter="url(#soft)"/>
    <path d="M-104 -22 L -56 -74 L 56 -74 L 104 -22 L 0 104 Z" fill="#2a1a8e"/>
    <path d="M-56 -74 L 0 -74 L -24 -22 Z" fill="url(#uF1)"/>
    <path d="M0 -74 L 56 -74 L 24 -22 Z" fill="url(#uF2)"/>
    <path d="M-24 -22 L 0 -74 L 24 -22 Z" fill="#dff8ff"/>
    <path d="M-104 -22 L -56 -74 L -24 -22 Z" fill="url(#uF3)"/>
    <path d="M104 -22 L 56 -74 L 24 -22 Z" fill="url(#uF4)"/>
    <path d="M-104 -22 L -24 -22 L 0 104 Z" fill="url(#uF5)"/>
    <path d="M-24 -22 L 24 -22 L 0 104 Z" fill="url(#uF2)"/>
    <path d="M24 -22 L 104 -22 L 0 104 Z" fill="url(#uF4)"/>
    <path d="M-60 -64 L -34 -64 L -48 -34 Z" fill="#fff" opacity="0.8"/>
  </g>

  <!-- Две стрелки вверх: объёмное золото с кромкой -->
  <g transform="translate(240 150)">
    <path d="M0 -92 L 62 -38 L 34 -38 L 34 -6 L -34 -6 L -34 -38 L -62 -38 Z" fill="#7a3a06" transform="translate(0 6)"/>
    <path d="M0 -92 L 62 -38 L 34 -38 L 34 -6 L -34 -6 L -34 -38 L -62 -38 Z" fill="url(#uGold)"/>
    <path d="M0 -80 L 44 -42 L -44 -42 Z" fill="#fff" opacity="0.35"/>
  </g>
  </g>

  ${sparkle(120, 170, 13)}${sparkle(380, 200, 9, 0.85)}${sparkle(96, 330, 8, 0.7)}${sparkle(352, 470, 10, 0.8)}
  <rect y="380" width="${W}" height="260" fill="url(#uBottom)"/>
  ${title('АПГРЕЙД', 118)}
</svg>`;
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
for (const [name, svg] of [['fast-crash', crashCover()], ['fast-upgrade', upgradeCover()]]) {
  await page.setContent(`<!doctype html><html><head><style>${fontFaces}
    html,body{margin:0;background:#000} svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  const out = join(ROOT, 'public/assets/ui', `${name}.webp`);
  writeFileSync(out, await sharp(png).webp({ quality: 86 }).toBuffer());
  console.log('записано', out);
}
await browser.close();
