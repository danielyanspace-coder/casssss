/**
 * Подготовка присланных обложек кейсов к показу в приложении.
 *
 * Исходники лежат в корне репозитория (Пыль.png, Вестерос.png и так далее) -
 * это присланные рендеры с прозрачным фоном. Скрипт переводит их в WebP с
 * сохранённой альфой и кладёт в public/assets/covers/.
 *
 * Запуск: node tools/case-covers.mjs
 *
 * ПОЧЕМУ ОБРЕЗАЕМ ПОЛЯ. У рендеров вокруг объекта остаётся прозрачный воздух,
 * и его доля у разных картинок разная. Если не обрезать, один кейс на полке
 * выглядит крупно, соседний - маленькой иконкой в пустой рамке, хотя размер
 * слота один и тот же. После обрезки по границе непрозрачных пикселей объект
 * у всех занимает кадр целиком, и обложки становятся одного визуального веса.
 *
 * ПОЧЕМУ АЛЬФА СОХРАНЯЕТСЯ. Обложка кладётся прямо на фон карточки, без своей
 * подложки: так у неё нет видимой рамки и она «вписана в сайт». Поэтому фон в
 * картинку не запекается, и показывать её надо через object-fit: contain -
 * иначе прозрачные края обрежутся вместе с объектом.
 *
 * ПОЧЕМУ 500 px ПО ДЛИННОЙ СТОРОНЕ И КАЧЕСТВО 0.78. Обложек восемнадцать, и
 * на вес страницы они влияют сильнее всего остального вместе взятого. Замеры
 * показали, что качество WebP на вес почти не влияет, а размер - линейно:
 * 620 px дают около 140 КБ на картинку, 500 px - около 95 КБ. При этом самый
 * крупный слот обложки (широкая карточка престольной полки) занимает около
 * 244 CSS-px, то есть 500 px хватает даже на экран двойной плотности.
 * Разница видна только при сравнении вплотную, а два мегабайта экономии на
 * мобильном интернете видны сразу. В вёрстке к этому добавлена ленивая
 * загрузка, поэтому за экраном обложки не качаются вовсе.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/**
 * Какой исходник какому ассету соответствует.
 *
 * Ключ - это и значение поля art у кейса, и имя итогового файла.
 */
const MAP = {
  'Пыль.png': 'dust',
  'Искра.png': 'spark',
  'Медяк.png': 'copper',
  'Разогрев.png': 'warmup',
  'Подворотня.png': 'alley',
  'Мерзлота.png': 'frost',
  'Первая руна.png': 'rune',
  'Колода.png': 'deck',
  'Неоновый.png': 'neon',
  'Мираж.png': 'mirage',
  'Пит-стоп.png': 'pit',
  'Ва-банк.png': 'allin',
  'Счастливый.png': 'lucky',
  'Удвоитель.png': 'double',
  'Санторини.png': 'santorini',
  'Рио-де-жанейро.png': 'rio',
  'Монако.png': 'monaco',
  'Лас-Вегас.png': 'vegas',
  'Дубай.png': 'dubai',
  'Сингапур.png': 'singapore',
  'Винтерфелл.png': 'winterfell',
  'Браавос.png': 'braavos',
  'Хай Гарден.png': 'highgarden',
  'Вестерос.png': 'westeros',
};

/** Длинная сторона результата. Обоснование - в шапке файла. */
const MAX_SIDE = 500;

/** Порог альфы, ниже которого пиксель считается фоном при обрезке полей. */
const ALPHA_FLOOR = 8;

/**
 * Прозрачный воздух вокруг объекта, долей от его длинной стороны.
 *
 * Обрезка вплотную по границе непрозрачных пикселей ставит арт впритык к краям
 * слота, и он начинает задевать рамку карточки и подписи. Небольшое поле
 * возвращает объекту воздух, при этом остаётся прозрачным - на фоне карточки
 * его не видно, а композиция перестаёт упираться в углы.
 */
const PADDING = 0.04;

const OUT_DIR = new URL('../public/assets/covers/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

let total = 0;

/**
 * Пропорции готовых обложек.
 *
 * Их надо знать вёрстке: слот под арт нельзя задать одним числом пикселей на
 * все полки. Обложки городов вертикальные, престольные горизонтальные, а на
 * ценовых полках попадаются почти квадратные. Фиксированная высота либо режет
 * высокие, либо оставляет под низкими пустую полосу. Поэтому высота считается
 * из пропорции, а таблица уезжает рядом с картинками.
 */
const aspects = {};

for (const [file, name] of Object.entries(MAP)) {
  const src = new URL(`../${file}`, import.meta.url);
  const dataUri = 'data:image/png;base64,' + readFileSync(src).toString('base64');

  const out = await page.evaluate(async ({ dataUri, MAX_SIDE, ALPHA_FLOOR, PADDING }) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();

    const probe = document.createElement('canvas');
    probe.width = img.width;
    probe.height = img.height;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);

    // Границы непрозрачного содержимого.
    const { data } = pctx.getImageData(0, 0, img.width, img.height);
    let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (data[(y * img.width + x) * 4 + 3] > ALPHA_FLOOR) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error('картинка полностью прозрачная');

    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    const scale = Math.min(1, MAX_SIDE / Math.max(cw, ch));
    const dw = Math.round(cw * scale);
    const dh = Math.round(ch * scale);

    // Поле считается от длинной стороны, чтобы у горизонтальных и вертикальных
    // обложек воздух выглядел одинаковым, а не растягивался по пропорции.
    const pad = Math.round(Math.max(dw, dh) * PADDING);

    const canvas = document.createElement('canvas');
    canvas.width = dw + pad * 2;
    canvas.height = dh + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, minX, minY, cw, ch, pad, pad, dw, dh);

    return {
      base64: canvas.toDataURL("image/webp", 0.78).split(',')[1],
      src: [img.width, img.height],
      trimmed: [cw, ch],
      final: [canvas.width, canvas.height],
    };
  }, { dataUri, MAX_SIDE, ALPHA_FLOOR, PADDING });

  const buf = Buffer.from(out.base64, 'base64');
  writeFileSync(new URL(`${name}.webp`, OUT_DIR), buf);
  total += buf.length;

  aspects[name] = Number((out.final[0] / out.final[1]).toFixed(4));

  const cut = Math.round((1 - (out.trimmed[0] * out.trimmed[1]) / (out.src[0] * out.src[1])) * 100);
  console.log(
    `${name.padEnd(11)} ${String(out.src.join('x')).padEnd(10)} -> ` +
    `${String(out.final.join('x')).padEnd(9)} ${String(Math.round(buf.length / 1024) + ' КБ').padStart(7)}` +
    `   полей срезано ${cut}%`
  );
}

await browser.close();

writeFileSync(new URL('aspects.json', OUT_DIR), JSON.stringify(aspects, null, 2) + '\n');

console.log(`\nВсего ${Object.keys(MAP).length} обложек, ${(total / 1024 / 1024).toFixed(2)} МБ`);
console.log('Пропорции записаны в public/assets/covers/aspects.json');
