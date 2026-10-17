/**
 * Значок вкладки и ярлыка на телефоне из знака логотипа.
 *
 * Мини-приложению значок не был нужен: его показывал Telegram. У сайта без
 * него вкладка стоит с серым глобусом, а браузер на каждый заход ловит 404
 * на /favicon.ico. Знак берётся из того же logo.webp, что и шапка: левая
 * часть картинки до буквы «L» надписи.
 *
 *   node tools/favicon.mjs
 */

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const LOGO = fileURLToPath(new URL('../public/assets/ui/logo.webp', import.meta.url));
const OUT = fileURLToPath(new URL('../public/', import.meta.url));

// Знак занимает левые 175 точек логотипа высотой 235: дальше начинается
// надпись, и в значке она читалась бы обрезком буквы.
const MARK = { left: 0, top: 0, width: 175, height: 235 };
const BG = '#120a1c';

async function icon(size, file, radius) {
  const pad = Math.round(size * 0.14);
  const mark = await sharp(LOGO).extract(MARK)
    .resize({ width: size - pad * 2, height: size - pad * 2, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/></svg>`);
  await sharp(plate).composite([{ input: mark, left: pad, top: pad }]).png().toFile(OUT + file);
  console.log(file, size);
}

await icon(64, 'favicon.png', 14);
// Ярлык на экране iPhone: система сама скругляет углы, поэтому квадрат.
await icon(180, 'apple-touch-icon.png', 0);
