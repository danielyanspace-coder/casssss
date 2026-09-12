/**
 * Подготовка присланных баннеров первого экрана.
 *
 * Исходники лежат в корне репозитория под своими исходными именами с
 * фотоаппарата (8BAFCF8F-....png и так далее). Скрипт переводит их в WebP и
 * кладёт в public/assets/ui/ под понятными именами.
 *
 * Запуск: node tools/banners.mjs
 *
 * ПОЧЕМУ В assets/ui, А НЕ РЯДОМ С ОБЛОЖКАМИ. Автономная демо-сборка сама
 * подставляет внутрь файла всё, что лежит по пути assets/ui/*.webp
 * (см. inlineUi в build-standalone.mjs). Положив баннеры туда, мы получаем
 * работающее демо без единой правки сборщика.
 *
 * ПОЧЕМУ ИМЕНА ТОЛЬКО ИЗ БУКВ, ЦИФР И ДЕФИСА. Тот же inlineUi ищет пути
 * выражением [\w-]+\.webp. Имя с точкой, пробелом или кириллицей он не
 * увидит, и в демо баннер окажется битой картинкой.
 *
 * ПОЧЕМУ НИЧЕГО НЕ ОБРЕЗАЕТСЯ. На баннерах есть надписи, и они прижаты к
 * краям кадра. Любая обрезка съедает слово. Поэтому здесь только уменьшение
 * по длинной стороне, пропорции сохраняются до пикселя, а вёрстка показывает
 * баннер целиком, без object-fit: cover.
 *
 * ПОЧЕМУ 1600 px ПО ДЛИННОЙ СТОРОНЕ. На компьютере баннер занимает около
 * 1180 CSS-px, на телефоне - ширину экрана. 1600 px держит его резким и на
 * компьютере, и на телефоне с двойной плотностью, но не раздувает автономную
 * сборку: все шесть картинок уезжают в неё строками прямо в разметке.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = new URL('../public/assets/ui/', import.meta.url);
const ROOT = new URL('../', import.meta.url);

/** Длинная сторона и качество. Квадрат меньше: он и на экране меньше. */
const WIDE_SIDE = 1600;
const SQUARE_SIDE = 900;
const QUALITY = 0.84;

const JOBS = [
  // Слайд-шоу главного баннера. Порядок показа задан порядком в этом списке.
  { src: 'D6BC2519-B36D-47EE-903D-E3CC550101FE.png', out: 'hero-1.webp', side: WIDE_SIDE },
  { src: 'EE1DE7F8-0010-417B-827E-D0B6EFFE427D.png', out: 'hero-2.webp', side: WIDE_SIDE },
  { src: '16F7CEB0-E741-45A6-8C78-811D5FB87B99.png', out: 'hero-3.webp', side: WIDE_SIDE },
  { src: 'F47531B5-0B24-44D6-ADFD-D30C8582137B.png', out: 'hero-4.webp', side: WIDE_SIDE },
  // Пара под главным баннером: широкий слева, квадратный справа.
  { src: '8BAFCF8F-7FF3-459C-A57E-21F8ABAB2893.png', out: 'promo-wide.webp', side: WIDE_SIDE },
  { src: 'E84D969D-377C-4DCF-AC02-CF912A12FDC2.png', out: 'promo-square.webp', side: SQUARE_SIDE },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

for (const job of JOBS) {
  const src = 'data:image/png;base64,'
    + readFileSync(new URL(job.src, ROOT)).toString('base64');

  const res = await page.evaluate(async ({ src, side, quality }) => {
    const img = new Image();
    img.src = src;
    await img.decode();

    // Меньше исходника не растягиваем: увеличение только смажет картинку.
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return {
      w: c.width, h: c.height,
      base64: c.toDataURL('image/webp', quality).split(',')[1],
    };
  }, { src, side: job.side, quality: QUALITY });

  const buf = Buffer.from(res.base64, 'base64');
  writeFileSync(new URL(job.out, OUT), buf);
  console.log(`${job.out.padEnd(18)} ${res.w}x${res.h}  ${(buf.length / 1024).toFixed(0)} КБ`
    + `  соотношение ${(res.w / res.h).toFixed(3)}`);
}

await browser.close();
