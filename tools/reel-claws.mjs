/**
 * Подготовка когтей, которые держат рамку барабана.
 *
 * Исходник - «Когти.png» в корне репозитория: пара симметричных лап на
 * прозрачном фоне, левая и правая в одном кадре с пустотой посередине.
 * Скрипт разрезает её на две половины и кладёт в public/assets/ui/.
 *
 * Запуск: node tools/reel-claws.mjs
 *
 * ПОЧЕМУ РЕЖЕМ ПО ПУСТОТЕ, А НЕ ПОПОЛАМ. Половины в присланном кадре не
 * одинаковой ширины и стоят не строго по центру. Деление ровно посередине
 * отрезало бы у одной лапы кончик когтя, а другой добавило бы лишний воздух -
 * и на странице они встали бы несимметрично. Поэтому шов ищется по самому
 * длинному вертикальному коридору прозрачности между ними.
 *
 * ПОЧЕМУ ОБРЕЗАЕМ ПОЛЯ. Дальше вёрстка ставит лапу по краю рамки барабана. Ей
 * нужно, чтобы край файла совпадал с краем рисунка: любой прозрачный запас
 * превратился бы в зазор между лапой и рамкой, разный слева и справа.
 *
 * ПОЧЕМУ ПРОПОРЦИЯ НИГДЕ НЕ ЗАПИСАНА. Вёрстка задаёт лапе только высоту, а
 * ширину оставляет auto - её браузер берёт из самой картинки. Значит числу
 * пропорции в коде взяться неоткуда и разойтись с файлом тоже нечему:
 * поменяется исходник, лапа встанет по нему.
 *
 * ПОЧЕМУ 560 px ПО ДЛИННОЙ СТОРОНЕ. Лапа занимает около 190 CSS-px по высоте,
 * значит этого хватает на экран тройной плотности с запасом.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = new URL('../Когти.png', import.meta.url);
const OUT_DIR = new URL('../public/assets/ui/', import.meta.url);

/** Длинная сторона результата. Обоснование - в шапке файла. */
const MAX_SIDE = 560;

/** Порог альфы, ниже которого пиксель считается пустотой. */
const ALPHA_FLOOR = 8;

/** Качество WebP. Лапа лежит поверх тёмного фона, артефакты на ней не видны. */
const QUALITY = 0.88;

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const dataUri = 'data:image/png;base64,' + readFileSync(SRC).toString('base64');

const out = await page.evaluate(async ({ dataUri, MAX_SIDE, ALPHA_FLOOR, QUALITY }) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();

  const probe = document.createElement('canvas');
  probe.width = img.width;
  probe.height = img.height;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(img, 0, 0);
  const { data } = pctx.getImageData(0, 0, img.width, img.height);

  const alphaAt = (x, y) => data[(y * img.width + x) * 4 + 3];

  // Столбец считается пустым, если в нём нет ни одной непрозрачной точки.
  const filled = [];
  for (let x = 0; x < img.width; x++) {
    let any = false;
    for (let y = 0; y < img.height && !any; y++) if (alphaAt(x, y) > ALPHA_FLOOR) any = true;
    filled.push(any);
  }

  const first = filled.indexOf(true);
  const last = filled.lastIndexOf(true);

  // Самый длинный коридор пустоты между крайними столбцами - это и есть шов.
  let best = null; let start = null;
  for (let x = first; x <= last; x++) {
    if (!filled[x]) { if (start === null) start = x; continue; }
    if (start !== null) {
      if (!best || x - start > best[1] - best[0]) best = [start, x - 1];
      start = null;
    }
  }
  if (!best) throw new Error('в картинке нет разрыва между лапами');
  const seam = Math.round((best[0] + best[1]) / 2);

  const cut = (x0, x1) => {
    // Границы рисунка внутри половины: по ним и обрезаем.
    let minX = x1, maxX = x0, minY = img.height, maxY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = x0; x <= x1; x++) {
        if (alphaAt(x, y) <= ALPHA_FLOOR) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));

    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, minX, minY, w, h, 0, 0, c.width, c.height);
    return { uri: c.toDataURL('image/webp', QUALITY), w: c.width, h: c.height };
  };

  return { left: cut(first, seam), right: cut(seam, last), seam };
}, { dataUri, MAX_SIDE, ALPHA_FLOOR, QUALITY });

await browser.close();

for (const [side, res] of Object.entries({ l: out.left, r: out.right })) {
  const bytes = Buffer.from(res.uri.split(',')[1], 'base64');
  writeFileSync(new URL(`claw-${side}.webp`, OUT_DIR), bytes);
  console.log(`claw-${side}.webp  ${res.w}x${res.h}  ${(bytes.length / 1024).toFixed(1)} КБ`
    + `  пропорция ${(res.w / res.h).toFixed(3)}`);
}

console.log('шов по x =', out.seam);
