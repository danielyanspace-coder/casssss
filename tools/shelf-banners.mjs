/**
 * Подготовка присланных баннеров полок и картинки меню.
 *
 * Исходники лежат в корне репозитория (Полка-Разогрев.png и так далее).
 * Скрипт обрезает их по нарисованной неоновой рамке, приводит к общему размеру
 * и кладёт в public/assets/ui/.
 *
 * Запуск: node tools/shelf-banners.mjs
 *
 * ПОЧЕМУ ОБРЕЗАЕМ ПО РАМКЕ. Вокруг рамки в исходниках остаётся тёмное поле
 * разной ширины. Если его не снять, баннеры встают на полках с разными
 * отступами, хотя нарисованы одинаково.
 *
 * ПОЧЕМУ ВПИСЫВАЕМ В ОДИН ХОЛСТ. Пропорции рамок в исходниках заметно разные:
 * 1.95, 2.10, 2.19 и 3.16 у «Первых шагов». Если растянуть все на одну ширину,
 * высоты разойдутся в полтора раза - это видно сразу. Поэтому каждая рамка
 * вписывается целиком в общий холст: широкая упирается в его ширину, узкая -
 * в высоту, остаток холста прозрачный. Слот под заголовок у всех полок один,
 * а площади самих рамок сходятся в пределах десятой доли.
 *
 * Пропорция холста выбрана так, чтобы крайние баннеры (3.16 и 1.95) недобирали
 * до его границ одинаково: A^2 = 3.16 * 1.95, то есть около 2.48.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/** Имя исходника -> имя файла в public/assets/ui/. */
const BANNERS = {
  'Полка-Первые шаги.png': 'shelf-first',
  'Полка-Направления.png': 'shelf-country',
  'Полка-Разогрев.png': 'shelf-warmup',
  'Полка-Игра престолов.png': 'shelf-got',
};

/** Ширина холста баннера. Показывается примерно на 360 CSS-px. */
const BANNER_WIDTH = 1000;

/** Пропорция холста: корень из произведения крайних пропорций рамок. */
const BANNER_ASPECT = 2.48;

/** Запас вокруг найденной рамки, чтобы не срезать внешнее свечение. */
const FRAME_BLEED = 0.012;

/** Порог яркости, по которому ищется неоновая рамка. */
const FRAME_LUMA = 260;

/** Доля ярких пикселей в строке или столбце, чтобы счесть её частью рамки. */
const FRAME_RATIO = 0.25;

const OUT_DIR = new URL('../public/assets/ui/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

/** Находит рамку и возвращает вырезанный кусок как ImageBitmap-подобные данные. */
async function measure(file) {
  const dataUri = 'data:image/png;base64,'
    + readFileSync(new URL(`../${file}`, import.meta.url)).toString('base64');

  return page.evaluate(async ({ dataUri, FRAME_LUMA, FRAME_RATIO }) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();

    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);

    const rowHits = new Array(img.height).fill(0);
    const colHits = new Array(img.width).fill(0);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] > FRAME_LUMA) {
          rowHits[y]++;
          colHits[x]++;
        }
      }
    }

    const first = (hits, total) => hits.findIndex((v) => v / total > FRAME_RATIO);
    const last = (hits, total) => {
      for (let i = hits.length - 1; i >= 0; i--) if (hits[i] / total > FRAME_RATIO) return i;
      return hits.length - 1;
    };

    const box = [
      first(colHits, img.height), first(rowHits, img.width),
      last(colHits, img.height), last(rowHits, img.width),
    ];

    /*
     * Скругление углов рамки. Нужно, чтобы вырезать тёмные квадратные уголки
     * снаружи неоновой линии: на фоне страницы они читаются лишним
     * прямоугольником вокруг баннера.
     *
     * Меряем так: идём вдоль верхней грани от левого угла до первой яркой
     * точки, и вдоль левой грани от того же угла вниз. Обе дают одно и то же
     * расстояние - радиус дуги. Берём меньшее из двух: если в угол попало
     * украшение (у «Разогрева» сверху пламя), одна из мерок окажется больше
     * настоящего радиуса, а вторая нет.
     */
    const bright = (x, y) => {
      const i = (y * img.width + x) * 4;
      return data[i] + data[i + 1] + data[i + 2] > FRAME_LUMA;
    };
    const [bx0, by0, bx1] = box;
    let rx = 0;
    while (bx0 + rx < bx1 && !bright(bx0 + rx, by0 + 2)) rx++;
    let ry = 0;
    while (by0 + ry < box[3] && !bright(bx0 + 2, by0 + ry)) ry++;

    return { src: [img.width, img.height], box, radius: Math.min(rx, ry), dataUri };
  }, { dataUri, FRAME_LUMA, FRAME_RATIO });
}

const measured = {};
for (const file of Object.keys(BANNERS)) {
  const m = await measure(file);
  // Найденная рамка расширяется на запас: порог яркости берёт саму линию,
  // а мягкое свечение снаружи остаётся за границей и без запаса срезается.
  const [x0, y0, x1, y1] = m.box;
  const bx = Math.round((x1 - x0) * FRAME_BLEED);
  const by = Math.round((y1 - y0) * FRAME_BLEED);
  m.box = [
    Math.max(0, x0 - bx), Math.max(0, y0 - by),
    Math.min(m.src[0] - 1, x1 + bx), Math.min(m.src[1] - 1, y1 + by),
  ];
  m.radius += Math.max(bx, by);
  measured[file] = m;
}

const canvasHeight = Math.round(BANNER_WIDTH / BANNER_ASPECT);

let total = 0;
for (const [file, name] of Object.entries(BANNERS)) {
  const m = measured[file];

  const out = await page.evaluate(async ({ m, W, H }) => {
    const img = new Image();
    img.src = m.dataUri;
    await img.decode();

    const [x0, y0, x1, y1] = m.box;
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;

    // Рамка вписывается в холст целиком и встаёт по центру: широкая упирается
    // в ширину, узкая - в высоту. Остаток холста остаётся прозрачным.
    const k = Math.min(W / cw, H / ch);
    const dw = Math.round(cw * k);
    const dh = Math.round(ch * k);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const dx = Math.round((W - dw) / 2);
    const dy = Math.round((H - dh) / 2);
    ctx.drawImage(img, x0, y0, cw, ch, dx, dy, dw, dh);

    // Углы за неоновой линией срезаем: под ними тёмная заливка исходника,
    // и на странице она обводит баннер прямоугольником.
    const r = Math.round(m.radius * k);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, r);
    ctx.fill();

    return {
      base64: canvas.toDataURL('image/webp', 0.82).split(',')[1],
      frame: [dw, dh],
      radius: r,
    };
  }, { m, W: BANNER_WIDTH, H: canvasHeight });

  const buf = Buffer.from(out.base64, 'base64');
  writeFileSync(new URL(`${name}.webp`, OUT_DIR), buf);
  total += buf.length;

  console.log(
    `${name.padEnd(14)} ${String(m.src.join('x')).padEnd(10)} -> холст ${BANNER_WIDTH}x${canvasHeight}` +
    `, рамка ${out.frame.join('x')}, радиус ${out.radius}  ${Math.round(buf.length / 1024)} КБ`
  );
}

/* ---------- Картинка меню ---------- */

/**
 * У меню исходник - снимок экрана целиком: лист меню сверху, под ним размытая
 * страница. Автоматически границы листа не берутся: снизу он переходит в
 * размытие такой же яркости, разрыва по контрасту нет. Поэтому лист вырезается
 * по замеренной рамке.
 */
const MENU_BOX = [32, 140, 819, 1137];

/** Ширина готовой картинки меню. */
const MENU_WIDTH = 900;

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

const menuBuf = Buffer.from(menu.base64, 'base64');
writeFileSync(new URL('../public/assets/menu.webp', import.meta.url), menuBuf);

console.log(
  `\nменю        ${menu.src.join('x')} -> вырезано ${MENU_BOX.join(',')} -> `
  + `${menu.out.join('x')}  ${Math.round(menuBuf.length / 1024)} КБ`
);
console.log(`Баннеров ${Object.keys(BANNERS).length}, всего ${(total / 1024).toFixed(0)} КБ`);

await browser.close();
