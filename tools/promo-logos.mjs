/**
 * Квадратные баннеры пары из присланных логотипов (октябрь 2026):
 *
 *   node tools/promo-logos.mjs
 *     assets-src/ui/promo-casino-logo.png -> public/assets/ui/promo-casino.webp
 *     assets-src/ui/promo-cases-logo.png  -> public/assets/ui/promo-cases.webp
 *
 * Логотипы прислали на прозрачном фоне, а баннер в паре стоит плитой рядом
 * с непрозрачным соседом: прозрачная картинка там читается дырой. Поэтому
 * под логотип кладётся тёмная плита с тёплым свечением в цвет самого знака
 * (красный и золото), а края уходят в цвет фона страницы - у плиты нет
 * рамки, нечему спорить с соседом.
 *
 * Размер ровно 900x782, как у прежних: от пропорции зависит высота пары
 * баннеров (--promo-square-ratio в styles.css).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 900;
const H = 782;
// Поле вокруг знака: без него лампочки рамки упираются в скругление плиты.
const PAD = 0.05;

const JOBS = [
  ['promo-casino-logo.png', 'promo-casino.webp'],
  ['promo-cases-logo.png', 'promo-cases.webp'],
];

const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="54%" r="72%">
      <stop offset="0" stop-color="#6a1410"/>
      <stop offset="0.38" stop-color="#3a0b14"/>
      <stop offset="0.75" stop-color="#170814"/>
      <stop offset="1" stop-color="#0c0710"/>
    </radialGradient>
    <radialGradient id="h" cx="50%" cy="20%" r="55%">
      <stop offset="0" stop-color="#ffb347" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#h)"/>
</svg>`);

for (const [src, out] of JOBS) {
  const box = { w: Math.round(W * (1 - 2 * PAD)), h: Math.round(H * (1 - 2 * PAD)) };
  const logo = await sharp(join(ROOT, 'assets-src/ui', src)).trim()
    .resize(box.w, box.h, { fit: 'inside' }).png().toBuffer();
  const m = await sharp(logo).metadata();
  await sharp(plate)
    .composite([{ input: logo, left: Math.round((W - m.width) / 2), top: Math.round((H - m.height) / 2) }])
    .webp({ quality: 86 })
    .toFile(join(ROOT, 'public/assets/ui', out));
  console.log(out, `${W}x${H}`);
}
