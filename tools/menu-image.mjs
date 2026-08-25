/**
 * Подготовка присланной картинки меню.
 *
 * Исходник (Меню.png) - снимок экрана целиком: лист меню сверху, под ним
 * размытая страница. Нужен только сам лист.
 *
 * Запуск: node tools/menu-image.mjs
 *
 * ПОЧЕМУ ГРАНИЦЫ ЗАДАНЫ ЧИСЛАМИ. Автоматически лист не находится: снизу он
 * переходит в размытие такой же яркости, разрыва по контрасту там нет.
 * Поэтому границы замерены один раз и выписаны сюда.
 *
 * Проценты кликабельных областей в public/app.js (MENU_HITS и соседние) сняты
 * с результата этого скрипта. Меняется вырез - пересчитываются и они.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

/** Границы листа меню в исходнике. */
const MENU_BOX = [32, 140, 819, 1137];

/** Ширина готовой картинки. */
const MENU_WIDTH = 900;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const menuUri = 'data:image/png;base64,'
  + readFileSync(new URL('../Меню.png', import.meta.url)).toString('base64');

const menu = await page.evaluate(async ({ dataUri, box, W }) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();

  const [x0, y0, x1, y1] = box;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const scale = Math.min(1, W / cw);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, cw, ch, 0, 0, canvas.width, canvas.height);

  return {
    base64: canvas.toDataURL('image/webp', 0.9).split(',')[1],
    src: [img.width, img.height],
    out: [canvas.width, canvas.height],
  };
}, { dataUri: menuUri, box: MENU_BOX, W: MENU_WIDTH });

const buf = Buffer.from(menu.base64, 'base64');
writeFileSync(new URL('../public/assets/menu.webp', import.meta.url), buf);

console.log(
  `меню ${menu.src.join('x')} -> вырезано ${MENU_BOX.join(',')} -> `
  + `${menu.out.join('x')}  ${Math.round(buf.length / 1024)} КБ`
);

await browser.close();
