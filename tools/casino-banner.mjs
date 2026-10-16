/**
 * Квадратный баннер «Казино» на первом экране.
 *
 *   node tools/casino-banner.mjs <montserrat-800-cyrillic.woff2> <montserrat-800-latin.woff2>
 *     ->  public/assets/ui/promo-casino.webp
 *
 * Нарисован вместо присланного «Бонусы» и потому повторяет его во всём, что
 * видно рядом с широким баннером: тот же размер 900x782 (от пропорции
 * зависит высота пары, см. .promo-pair в styles.css), та же тёмная
 * фиолетовая плита со скруглением и прозрачными углами, тот же жирный белый
 * заголовок сверху и объёмный предмет под ним. Вместо подарка - игровой
 * автомат с фишками: это вход в слоты провайдеров, а не в бонусы.
 *
 * Шрифт передаётся файлами, а не ссылкой на Google Fonts: рисует безголовый
 * браузер, и если шрифт не успеет доехать, в картинку навсегда впечатается
 * запасной. Файлов два, потому что Google режет начертание по алфавитам:
 * в кириллическом нет ни цифр, ни латиницы, и «777» с «WIN» выходили
 * засечками из системного шрифта.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets/ui/promo-casino.webp');
const W = 900;
const H = 782;
const QUALITY = 0.9;

const [cyrPath, latPath] = process.argv.slice(2);
if (!cyrPath || !latPath) throw new Error('укажите два файла Montserrat 800: кириллица и латиница');
const fontCyr = readFileSync(cyrPath).toString('base64');
const fontLat = readFileSync(latPath).toString('base64');

/* Фишка: ребро стопкой эллипсов, сверху диск с вставками по кругу. */
function chip(cx, cy, r, color, dark, layers = 1, tilt = 0.36) {
  const ry = r * tilt;
  const step = r * 0.16;
  let out = '';
  for (let i = layers - 1; i >= 0; i--) {
    const y = cy + i * step;
    out += `<ellipse cx="${cx}" cy="${y + step * 0.55}" rx="${r}" ry="${ry}" fill="${dark}"/>`;
    out += `<rect x="${cx - r}" y="${y}" width="${r * 2}" height="${step * 0.55}" fill="${dark}"/>`;
    // Белые вставки на ребре: по ним фишка и читается фишкой, а не шайбой.
    for (const k of [-0.62, -0.08, 0.46]) {
      out += `<rect x="${cx + k * r}" y="${y + 1}" width="${r * 0.16}" height="${step * 0.5}" rx="2" fill="#f3e9ff" opacity=".85"/>`;
    }
    out += `<ellipse cx="${cx}" cy="${y}" rx="${r}" ry="${ry}" fill="url(#chip-${color.slice(1)})"/>`;
  }
  const top = cy;
  let inserts = '';
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    const x = cx + Math.cos(ang) * r * 0.82;
    const y = top + Math.sin(ang) * ry * 0.82;
    inserts += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r * 0.13}" ry="${ry * 0.2}" fill="#f6eeff"/>`;
  }
  return `${out}${inserts}
    <ellipse cx="${cx}" cy="${top}" rx="${r * 0.58}" ry="${ry * 0.58}" fill="none" stroke="#f6eeff" stroke-width="3" stroke-dasharray="7 6" opacity=".9"/>
    <ellipse cx="${cx - r * 0.18}" cy="${top - ry * 0.25}" rx="${r * 0.5}" ry="${ry * 0.32}" fill="#fff" opacity=".18"/>`;
}

/* Барабан окна: светлый цилиндр с семёркой. Тень сверху и снизу делает его
   круглым, а не плоской наклейкой. */
function reel(x, y, w, h) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#reel)"/>
    <text x="${x + w / 2}" y="${y + h * 0.74}" text-anchor="middle" font-family="M" font-weight="800"
      font-size="${h * 0.72}" fill="url(#seven)" stroke="#5a0b2a" stroke-width="3" paint-order="stroke">7</text>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#reelShade)"/>`;
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      @font-face { font-family: M; font-weight: 800; unicode-range: U+0400-045F;
        src: url(data:font/woff2;base64,${fontCyr}) format('woff2'); }
      @font-face { font-family: M; font-weight: 800; unicode-range: U+0000-00FF;
        src: url(data:font/woff2;base64,${fontLat}) format('woff2'); }
    </style>
    <radialGradient id="bg" cx="50%" cy="78%" r="75%">
      <stop offset="0" stop-color="#4a1d6e"/>
      <stop offset=".45" stop-color="#241034"/>
      <stop offset="1" stop-color="#120a1c"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#d946ef" stop-opacity=".55"/>
      <stop offset="1" stop-color="#d946ef" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7c4bb0"/>
      <stop offset="1" stop-color="#3b1d5c"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a3046"/>
      <stop offset=".45" stop-color="#1b1624"/>
      <stop offset="1" stop-color="#0b0910"/>
    </linearGradient>
    <linearGradient id="bodySide" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#14101b"/>
      <stop offset="1" stop-color="#050408"/>
    </linearGradient>
    <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c026d3"/>
      <stop offset=".5" stop-color="#f472d0"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
    <linearGradient id="reel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bfb3d6"/>
      <stop offset=".5" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#b3a6cc"/>
    </linearGradient>
    <linearGradient id="reelShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a0d2a" stop-opacity=".55"/>
      <stop offset=".22" stop-color="#1a0d2a" stop-opacity="0"/>
      <stop offset=".78" stop-color="#1a0d2a" stop-opacity="0"/>
      <stop offset="1" stop-color="#1a0d2a" stop-opacity=".55"/>
    </linearGradient>
    <linearGradient id="seven" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd76a"/>
      <stop offset=".5" stop-color="#ff4f8b"/>
      <stop offset="1" stop-color="#b3125a"/>
    </linearGradient>
    <radialGradient id="ball" cx="35%" cy="30%" r="70%">
      <stop offset="0" stop-color="#ffe1f5"/>
      <stop offset=".35" stop-color="#f05bc8"/>
      <stop offset="1" stop-color="#7a1170"/>
    </radialGradient>
    <linearGradient id="rod" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8e86a0"/>
      <stop offset=".5" stop-color="#f2eefa"/>
      <stop offset="1" stop-color="#6b6380"/>
    </linearGradient>
    <linearGradient id="chip-e879f9" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f5a8ff"/><stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
    <linearGradient id="chip-8b5cf6" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c4b0ff"/><stop offset="1" stop-color="#6d3fe0"/>
    </linearGradient>
    <linearGradient id="chip-2a2235" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4c4060"/><stop offset="1" stop-color="#17121f"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
    <clipPath id="plate"><rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="44"/></clipPath>
  </defs>

  <!-- Плита: как у «Бонусов», тёмная, с фиолетовым свечением снизу. -->
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="44" fill="url(#bg)"/>
  <g clip-path="url(#plate)">
    <ellipse cx="450" cy="640" rx="380" ry="170" fill="url(#glow)"/>
    <ellipse cx="450" cy="770" rx="330" ry="40" fill="#000" opacity=".45" filter="url(#soft)"/>
  </g>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="44" fill="none" stroke="url(#edge)" stroke-width="4"/>

  <text x="450" y="178" text-anchor="middle" font-family="M" font-weight="800" font-size="142"
    fill="#fff" letter-spacing="-2">Казино</text>

  <!-- Автомат -->
  <g transform="translate(0 6)">
    <ellipse cx="452" cy="728" rx="250" ry="26" fill="#000" opacity=".55" filter="url(#neonBlur)"/>

    <!-- Боковина даёт объём: корпус повернут к зрителю на три четверти. -->
    <path d="M598 300 L640 318 L640 702 L598 720 Z" fill="url(#bodySide)"/>
    <rect x="262" y="300" width="340" height="420" rx="34" fill="url(#body)"/>
    <rect x="262" y="300" width="340" height="140" rx="34" fill="url(#gloss)"/>

    <!-- Купол с неоновой кромкой -->
    <path d="M286 312 Q432 214 578 312 Z" fill="#1d1628"/>
    <path d="M286 312 Q432 214 578 312" fill="none" stroke="url(#neon)" stroke-width="16" stroke-linecap="round" filter="url(#neonBlur)" opacity=".9"/>
    <path d="M286 312 Q432 214 578 312" fill="none" stroke="url(#neon)" stroke-width="7" stroke-linecap="round"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const t = (i + 1) / 8;
      const x = (1 - t) ** 2 * 286 + 2 * (1 - t) * t * 432 + t ** 2 * 578;
      const y = (1 - t) ** 2 * 312 + 2 * (1 - t) * t * 214 + t ** 2 * 312;
      return `<circle cx="${x.toFixed(1)}" cy="${(y + 22).toFixed(1)}" r="7" fill="#ffe7a8"/>
              <circle cx="${x.toFixed(1)}" cy="${(y + 22).toFixed(1)}" r="13" fill="#ffd36a" opacity=".35"/>`;
    }).join('')}

    <!-- Окно с барабанами -->
    <rect x="290" y="356" width="284" height="170" rx="22" fill="#08060c"/>
    <rect x="290" y="356" width="284" height="170" rx="22" fill="none" stroke="url(#neon)" stroke-width="5"/>
    ${reel(304, 372, 80, 138)}
    ${reel(392, 372, 80, 138)}
    ${reel(480, 372, 80, 138)}
    <!-- Линия выплаты только метками по краям окна: поперёк семёрок она их
         перечёркивала. -->
    <path d="M292 432 L306 441 L292 450 Z" fill="#ff4f8b"/>
    <path d="M572 432 L558 441 L572 450 Z" fill="#ff4f8b"/>
    <rect x="296" y="362" width="272" height="40" rx="18" fill="#fff" opacity=".08"/>

    <!-- Табло выигрыша и кнопки -->
    <rect x="300" y="548" width="264" height="54" rx="14" fill="#0d0a14" stroke="#3b2a52" stroke-width="3"/>
    <text x="432" y="588" text-anchor="middle" font-family="M" font-weight="800" font-size="36"
      fill="#ffd36a" letter-spacing="6">WIN</text>
    <rect x="306" y="624" width="76" height="34" rx="12" fill="#c026d3"/>
    <rect x="394" y="624" width="76" height="34" rx="12" fill="#8b5cf6"/>
    <rect x="482" y="624" width="76" height="34" rx="12" fill="#f472d0"/>
    <rect x="306" y="624" width="76" height="14" rx="7" fill="#fff" opacity=".25"/>
    <rect x="394" y="624" width="76" height="14" rx="7" fill="#fff" opacity=".25"/>
    <rect x="482" y="624" width="76" height="14" rx="7" fill="#fff" opacity=".25"/>
    <path d="M262 676 H602 V690 Q602 720 572 720 H292 Q262 720 262 690 Z" fill="#0a0810"/>

    <!-- Рычаг -->
    <rect x="636" y="430" width="26" height="70" rx="10" fill="#1b1624"/>
    <path d="M652 450 L692 330" stroke="url(#rod)" stroke-width="14" stroke-linecap="round"/>
    <circle cx="695" cy="318" r="30" fill="url(#ball)"/>
    <circle cx="686" cy="306" r="9" fill="#fff" opacity=".7"/>
  </g>

  <!-- Фишки: стопка слева, россыпь справа -->
  ${chip(170, 640, 70, '#e879f9', '#7d1680', 4)}
  ${chip(232, 694, 54, '#8b5cf6', '#3c1f8c', 2)}
  ${chip(728, 676, 66, '#2a2235', '#0b0910', 3)}
  ${chip(790, 612, 46, '#e879f9', '#7d1680', 1)}
</svg>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<html><body style="margin:0;background:transparent">
  <img id="i" width="${W}" height="${H}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
  </body></html>`);
await page.waitForFunction(() => document.getElementById('i').complete);
// Шрифт внутри SVG-картинки грузится отдельно от страницы: даём ему кадр.
await page.waitForTimeout(400);
const base64 = await page.evaluate(async ({ w, h, q }) => {
  const img = document.getElementById('i');
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/webp', q).split(',')[1];
}, { w: W, h: H, q: QUALITY });
await browser.close();

writeFileSync(OUT, Buffer.from(base64, 'base64'));
console.log(`${OUT}: ${(Buffer.from(base64, 'base64').length / 1024).toFixed(0)} КБ`);
