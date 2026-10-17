/**
 * Разбор присланного дизайна выбора фриспинов на части.
 *
 * Исходник (Фриспины.png) - готовая картинка на 1536x1024 с ценами кейса
 * «Пыль». Целиком её поставить нельзя: цены у каждого кейса свои, а на
 * телефоне такая широкая картинка ужимается так, что подписи становятся с
 * пиксель. Поэтому картинка разбирается на неизменные части - заголовок и три
 * монеты, - а карточки, подписи и цены собираются вёрсткой поверх.
 *
 * Запуск: node tools/freespin-packs.mjs
 *
 * КАК ВЫРЕЗАЕМ. Заголовок и монеты нарисованы свечением поверх тёмной
 * подложки, то есть сложением. Значит и снять их можно вычитанием: берём цвет
 * подложки рядом с деталью и вычитаем его из каждой точки. Остаётся чистое
 * свечение на чёрном, которое на странице кладётся режимом screen - тем же
 * сложением, только уже с нашим фоном. Ключевание по прозрачности здесь хуже:
 * у монеты «10» тёмный фиолетовый ободок, и по яркости он ушёл бы в полупрозрачность.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = new URL('../public/assets/ui/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

/**
 * Что вырезаем.
 *
 * search - где искать деталь, bg - откуда брать цвет подложки. Точные границы
 * детали внутри search ищутся сами, по превышению над подложкой: обводить
 * монету руками бессмысленно, у неё размытый край свечения.
 */
const PARTS = [
  // Заголовок с росчерками. Ищем по всей верхней полосе панели, подложку
  // берём над плашкой FREE SPINS - там чистый фон.
  { name: 'fs-title',   search: [96, 96, 1444, 366],  bg: [300, 110],  width: 1100 },
  // Монеты. Границы поиска идут по внутренностям карточек: если задеть
  // нарисованную рамку, она окажется ярче подложки и растянет вырез до края.
  { name: 'fs-coin-10', search: [140, 415, 490, 675],  bg: [150, 425],  width: 300 },
  { name: 'fs-coin-20', search: [590, 405, 950, 675],  bg: [600, 420],  width: 340 },
  { name: 'fs-coin-30', search: [1042, 415, 1392, 675], bg: [1052, 425], width: 300 },
];

/** Насколько точка должна быть светлее подложки, чтобы счесть её деталью. */
const KEY_THRESHOLD = 26;

/**
 * Доля стороны, на которой вырез гасится к чёрному по краю.
 *
 * За монетой в исходнике лежит мягкое сияние, оно расходится дальше самой
 * монеты и обрывается ровно на границе выреза - прямоугольником. Плавное
 * затухание убирает эту границу: при наложении режимом screen чёрное не даёт
 * ничего, и сияние просто сходит на нет.
 */
const EDGE_FEATHER = 0.09;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const dataUri = 'data:image/png;base64,'
  + readFileSync(new URL('../Фриспины.png', import.meta.url)).toString('base64');

for (const part of PARTS) {
  const out = await page.evaluate(async ({ dataUri, part, KEY_THRESHOLD, FEATHER }) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();

    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);

    const at = (x, y) => {
      const i = (y * img.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };

    const bg = at(part.bg[0], part.bg[1]);
    const [sx0, sy0, sx1, sy1] = part.search;

    // Граница детали: крайние точки, что заметно светлее подложки.
    let x0 = sx1; let y0 = sy1; let x1 = sx0; let y1 = sy0;
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const p = at(x, y);
        const over = Math.max(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
        if (over > KEY_THRESHOLD) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }

    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;

    /*
     * Вычитаем подложку. Одним цветом не обойтись: у средней карточки заливка
     * с золотым отливом и заметным градиентом, и от постоянного вычитания
     * вокруг монеты остаётся светлый прямоугольник - след самой карточки.
     * Поэтому подложка берётся как плоскость по четырём углам выреза: в углах
     * свечения уже нет, а градиент карточки они описывают точно.
     */
    const patch = (px, py) => {
      const acc = [0, 0, 0];
      let n = 0;
      for (let y = py - 3; y <= py + 3; y++) {
        for (let x = px - 3; x <= px + 3; x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const p = at(x, y);
          acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2];
          n++;
        }
      }
      return acc.map((v) => v / n);
    };
    const c00 = patch(x0, y0);
    const c10 = patch(x1, y0);
    const c01 = patch(x0, y1);
    const c11 = patch(x1, y1);

    // Затухание к краю выреза: 0 на самой границе, 1 глубже feather.
    const band = Math.max(1, Math.round(Math.min(cw, ch) * FEATHER));
    const ramp = (d) => {
      const t = Math.min(1, Math.max(0, d / band));
      return t * t * (3 - 2 * t);
    };
    const fade = (x, y) => Math.min(
      ramp(x), ramp(cw - 1 - x), ramp(y), ramp(ch - 1 - y)
    );

    const cut = document.createElement('canvas');
    cut.width = cw;
    cut.height = ch;
    const cctx = cut.getContext('2d');
    const out = cctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      const v = ch > 1 ? y / (ch - 1) : 0;
      for (let x = 0; x < cw; x++) {
        const u = cw > 1 ? x / (cw - 1) : 0;
        const p = at(x0 + x, y0 + y);
        const i = (y * cw + x) * 4;
        for (let ch3 = 0; ch3 < 3; ch3++) {
          const top = c00[ch3] * (1 - u) + c10[ch3] * u;
          const bot = c01[ch3] * (1 - u) + c11[ch3] * u;
          const value = p[ch3] - (top * (1 - v) + bot * v);
          out.data[i + ch3] = Math.max(0, Math.round(value * fade(x, y)));
        }
        out.data[i + 3] = 255;
      }
    }
    cctx.putImageData(out, 0, 0);

    const scale = Math.min(1, part.width / cw);
    const fin = document.createElement('canvas');
    fin.width = Math.round(cw * scale);
    fin.height = Math.round(ch * scale);
    const fctx = fin.getContext('2d');
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(cut, 0, 0, cw, ch, 0, 0, fin.width, fin.height);

    return {
      base64: fin.toDataURL('image/webp', 0.86).split(',')[1],
      box: [x0, y0, x1, y1],
      bg,
      out: [fin.width, fin.height],
    };
  }, { dataUri, part, KEY_THRESHOLD, FEATHER: EDGE_FEATHER });

  const buf = Buffer.from(out.base64, 'base64');
  writeFileSync(new URL(`${part.name}.webp`, OUT_DIR), buf);

  console.log(
    `${part.name.padEnd(12)} подложка ${out.bg.join(',')}  вырезано ${out.box.join(',')}`
    + ` -> ${out.out.join('x')}  ${Math.round(buf.length / 1024)} КБ`
  );
}

await browser.close();
