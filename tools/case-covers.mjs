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
 * ЗАЧЕМ СЧИТАЕМ ЦВЕТ СВЕЧЕНИЯ. Вокруг обложки на странице лежит цветной
 * воздух. Раньше его цвет брался от категории, и вся полка светилась
 * одинаково - при том что «Мерзлота» ледяная, «Разогрев» огненный, а
 * «Счастливый» зелёный. Поэтому здесь по каждой обложке считаются два её
 * собственных тона, и вёрстка вешает их двумя тенями разного радиуса.
 *
 * ПОЧЕМУ ДВА ТОНА СЧИТАЮТСЯ ПО-РАЗНОМУ. Обложки - это сундуки с золотом, и
 * самый тяжёлый тон почти у всех один и тот же, оранжевый. Если брать два
 * самых тяжёлых, полка снова светится одинаково - ровно та беда, от которой
 * уходим. Поэтому ближний тон берётся как есть, самый тяжёлый: он честно
 * повторяет обложку и держит свечение в её гамме. А дальний, тот самый
 * заметный воздух, берётся как самый нехарактерный для остальных обложек:
 * доля тона у этой картинки минус его средняя доля по всем. Общее золото
 * так вычитается само собой, а наружу выходит то, чем обложка отличается, -
 * лёд «Мерзлоты», зелень «Счастливого», пурпур «Неонового».
 *
 * ПОЧЕМУ 520 px ПО ДЛИННОЙ СТОРОНЕ И КАЧЕСТВО 0.82. Слот обложки занимает
 * около 200 CSS-px, значит 520 px хватает и на экран тройной плотности - на
 * телефоне обложка остаётся резкой при любом увеличении.
 *
 * Раньше здесь стояли числа поменьше: обложек больше шестидесяти, и весь
 * набор в распакованном виде не помещался в память телефона - вкладка
 * перезагружалась прямо во время прокрутки. Лечить это уменьшением картинок
 * было неправильно: приложение отдаёт обложку файлом по запросу, браузер
 * тянет только видимое и выбрасывает ушедшее с экрана. Достаточно было не
 * держать за экраном лишнего - это делают ленивая загрузка и
 * content-visibility на полках. Так что качество здесь ничем не ограничено,
 * кроме здравого смысла.
 *
 * Отдельная история - автономная сборка: там все обложки лежат строками в
 * одном файле, выбросить их браузер не может, и для неё build-standalone.mjs
 * пережимает их мельче. Приложения это не касается.
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

  // Второй завоз: остальные кейсы проекта.
  'Сейф.png': 'vault',
  'Шапито.png': 'chapito',
  'Путь меча.png': 'blade',
  'Абордаж.png': 'board',
  'Зеленая крепость.png': 'fortress',
  'Ночное дело.png': 'noir',
  'Взлом.png': 'hack',
  'Огранка.png': 'cut',
  'Паровая.png': 'steam',
  'Марианская.png': 'mariana',
  'Сёгун.png': 'shogun',
  'Склеп.png': 'crypt',
  'Карантин.png': 'quarantine',
  'Пепел.png': 'ash',
  'Сокровищница.png': 'hoard',
  'Алмазный фонд.png': 'diamond',
  'Регалии.png': 'regalia',
  'Гробница.png': 'tomb',
  'Орбита.png': 'orbit',
  'Логово.png': 'lair',
  'Депозитарий.png': 'depo',
  'Галактика.png': 'galaxy',
  'Возрождение.png': 'rebirth',
  'Бездна.png': 'abyss',
  'Империя.png': 'empire',
  'Вершина.png': 'apex',
  'Красное или ничего.png': 'redonly',
  'Жерло.png': 'crater',
  'Реактор.png': 'reactor',
  'Тень.png': 'shadow',
  'Полночь.png': 'midnight',
  'Точка невозврата.png': 'nopoint',
  'Подарочный.png': 'gift',
  'Цепная реакция.png': 'chain',
  'Джекпот.png': 'jackpot',
  'Золотой билет.png': 'ticket',
  'Атом.png': 'atom',
  'Клад.png': 'treasure',
  'Мегабокс.png': 'megabox',
  'Бесконечность.png': 'infinity',
  'Легенда.png': 'legend',
  'Три желания.png': 'sultan',
  'Самородок.png': 'nugget',
};

/** Длинная сторона результата. Обоснование - в шапке файла. */
const MAX_SIDE = 520;

/** Порог альфы, ниже которого пиксель считается фоном при обрезке полей. */
const ALPHA_FLOOR = 8;

/**
 * Часть присланных рендеров пришла без прозрачности: вместо неё в картинку
 * запечена светлая шахматка - та самая, которой редакторы рисуют пустоту.
 * Её надо снять, иначе обложка встанет на страницу белым прямоугольником.
 *
 * Клетки шахматки серые и очень светлые, поэтому ищем их по двум признакам
 * сразу: почти нет разброса между каналами и высокая светлота.
 */
const CHECKER_MAX_CHROMA = 14;
const CHECKER_MIN_LUMA = 226;

/**
 * Прозрачный воздух вокруг объекта, долей от его длинной стороны.
 *
 * Обрезка вплотную по границе непрозрачных пикселей ставит арт впритык к краям
 * слота, и он начинает задевать рамку карточки и подписи. Небольшое поле
 * возвращает объекту воздух, при этом остаётся прозрачным - на фоне карточки
 * его не видно, а композиция перестаёт упираться в углы.
 */
const PADDING = 0.06;

/**
 * Насколько дальний тон должен отличаться от ближнего, в градусах. Два
 * близких цвета сливаются в одно пятно, и вся затея теряется.
 */
const HUE_APART = 40;

/** Число корзин гистограммы тонов. 36 - это по 10 градусов на корзину. */
const HUE_BINS = 36;

/**
 * Наименьшая доля тона, при которой он годится в дальний.
 *
 * У обложек, где кроме золота почти ничего нет, «самый нехарактерный» тон
 * выбирается из шума: доля у всех кандидатов около нуля, и побеждает
 * случайный. Такие обложки честнее светить вторым по тяжести тоном.
 */
const FAR_MIN_SHARE = 0.04;

/** Ниже этой насыщенности точка не участвует в подборе: серое тона не даёт. */
const SAT_FLOOR = 0.34;

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
const art = {};

/** Гистограммы тонов: дальний тон выбирается, когда посчитаны все обложки. */
const hist = {};

for (const [file, name] of Object.entries(MAP)) {
  const src = new URL(`../${file}`, import.meta.url);
  const dataUri = 'data:image/png;base64,' + readFileSync(src).toString('base64');

  const out = await page.evaluate(async ({
    dataUri, MAX_SIDE, ALPHA_FLOOR, PADDING, SAT_FLOOR, BINS,
    CHECKER_MAX_CHROMA, CHECKER_MIN_LUMA,
  }) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();

    const probe = document.createElement('canvas');
    probe.width = img.width;
    probe.height = img.height;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);

    const shot = pctx.getImageData(0, 0, img.width, img.height);
    const { data } = shot;

    /*
     * Снятие запечённой шахматки.
     *
     * Заливка идёт от краёв, а не по всей картинке: внутри рисунка тоже есть
     * светло-серое - блики на металле, седина, белая эмаль, - и по одному
     * лишь цвету оно неотличимо от клетки. Снаружи связной области фона
     * такие места не лежат, поэтому заливка их не трогает.
     *
     * Берёмся за это только если прозрачности нет вовсе: у нормального
     * рендера она есть, и запускать заливку не за чем.
     */
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > ALPHA_FLOOR) opaque++;

    if (opaque > img.width * img.height * 0.99) {
      const isChecker = (i) => {
        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        const max = Math.max(r, g, b); const min = Math.min(r, g, b);
        return max - min <= CHECKER_MAX_CHROMA && (r + g + b) / 3 >= CHECKER_MIN_LUMA;
      };

      const seen = new Uint8Array(img.width * img.height);
      const stack = [];
      for (let x = 0; x < img.width; x++) {
        stack.push(x, x + (img.height - 1) * img.width);
      }
      for (let y = 0; y < img.height; y++) {
        stack.push(y * img.width, y * img.width + img.width - 1);
      }

      while (stack.length) {
        const p = stack.pop();
        if (seen[p]) continue;
        seen[p] = 1;
        if (!isChecker(p * 4)) continue;
        data[p * 4 + 3] = 0;

        const x = p % img.width;
        const y = (p - x) / img.width;
        if (x > 0) stack.push(p - 1);
        if (x < img.width - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - img.width);
        if (y < img.height - 1) stack.push(p + img.width);
      }

      /*
       * Смягчение края. Заливка режет по порогу, и на границе остаётся
       * ступенька из полусветлых точек - остаток растушёвки самого рендера.
       * Точки рядом с уже прозрачными гасим тем сильнее, чем они светлее.
       */
      const soft = new Uint8Array(img.width * img.height);
      for (let y = 1; y < img.height - 1; y++) {
        for (let x = 1; x < img.width - 1; x++) {
          const p = y * img.width + x;
          if (data[p * 4 + 3] === 0) continue;
          const near = data[(p - 1) * 4 + 3] === 0 || data[(p + 1) * 4 + 3] === 0
            || data[(p - img.width) * 4 + 3] === 0 || data[(p + img.width) * 4 + 3] === 0;
          if (!near) continue;
          const luma = (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3;
          if (luma > 200) soft[p] = 1;
        }
      }
      for (let p = 0; p < soft.length; p++) if (soft[p]) data[p * 4 + 3] = 90;

      pctx.putImageData(shot, 0, 0);
    }
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
    ctx.drawImage(probe, minX, minY, cw, ch, pad, pad, dw, dh);

    /*
     * Гистограмма тонов по непрозрачным точкам. Вес точки - куб её
     * насыщенности на альфу: серая заливка тон не задаёт, вялый цвет не
     * должен перебивать чистый, а полупрозрачный край не должен перевешивать
     * середину. Кого из корзин выбрать - решается снаружи, когда посчитаны
     * все обложки.
     */
    const weight = new Array(BINS).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.5) continue;
      const r = data[i] / 255; const g = data[i + 1] / 255; const b = data[i + 2] / 255;
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      if (max === min || l < 0.12 || l > 0.94) continue;
      const sat = (max - min) / (1 - Math.abs(2 * l - 1));
      if (sat < SAT_FLOOR) continue;

      let h;
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h *= 60;

      weight[Math.floor(h / (360 / BINS)) % BINS] += sat * sat * sat * a;
    }

    return {
      base64: canvas.toDataURL("image/webp", 0.82).split(',')[1],
      src: [img.width, img.height],
      trimmed: [cw, ch],
      final: [canvas.width, canvas.height],
      hues: weight,
    };
  }, {
    dataUri, MAX_SIDE, ALPHA_FLOOR, PADDING, SAT_FLOOR, BINS: HUE_BINS,
    CHECKER_MAX_CHROMA, CHECKER_MIN_LUMA,
  });

  const buf = Buffer.from(out.base64, 'base64');
  writeFileSync(new URL(`${name}.webp`, OUT_DIR), buf);
  total += buf.length;

  art[name] = { aspect: Number((out.final[0] / out.final[1]).toFixed(4)) };
  hist[name] = out.hues;

  const cut = Math.round((1 - (out.trimmed[0] * out.trimmed[1]) / (out.src[0] * out.src[1])) * 100);
  console.log(
    `${name.padEnd(11)} ${String(out.src.join('x')).padEnd(10)} -> ` +
    `${String(out.final.join('x')).padEnd(9)} ${String(Math.round(buf.length / 1024) + ' КБ').padStart(7)}` +
    `   полей срезано ${String(cut + '%').padStart(4)}`
  );
}

await browser.close();

/* ---------- Выбор тонов свечения ---------- */

const step = 360 / HUE_BINS;
/** Центр корзины, а не край: край даёт заметный сдвиг при десяти градусах. */
const hueOf = (i) => Math.round(i * step + step / 2);
const apart = (i, j) => {
  const d = Math.abs(i - j) * step;
  return Math.min(d, 360 - d);
};

// Доли тонов внутри каждой обложки и средняя доля по всем.
const shares = {};
for (const [name, w] of Object.entries(hist)) {
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  shares[name] = w.map((v) => v / sum);
}
const mean = new Array(HUE_BINS).fill(0);
for (const sh of Object.values(shares)) sh.forEach((v, i) => { mean[i] += v; });
for (let i = 0; i < HUE_BINS; i++) mean[i] /= Object.keys(shares).length;

for (const [name, sh] of Object.entries(shares)) {
  const near = sh.indexOf(Math.max(...sh));

  // Дальний тон: где эта обложка сильнее всего опережает среднюю по всем.
  let far = near;
  let bestLift = -Infinity;
  for (let i = 0; i < HUE_BINS; i++) {
    if (apart(i, near) < HUE_APART) continue;
    if (sh[i] < FAR_MIN_SHARE) continue;
    const lift = sh[i] - mean[i];
    if (lift > bestLift) { bestLift = lift; far = i; }
  }

  // Ничего заметного за порогом нет - берём просто второй по тяжести.
  if (far === near) {
    let bestShare = -1;
    for (let i = 0; i < HUE_BINS; i++) {
      if (apart(i, near) >= HUE_APART && sh[i] > bestShare) { bestShare = sh[i]; far = i; }
    }
  }

  art[name].glow = [hueOf(near), hueOf(far)];
  console.log(`${name.padEnd(11)} тона ${hueOf(near)} / ${hueOf(far)}`);
}

writeFileSync(new URL('art.json', OUT_DIR), JSON.stringify(art, null, 2) + '\n');

console.log(`\nВсего ${Object.keys(MAP).length} обложек, ${(total / 1024 / 1024).toFixed(2)} МБ`);
console.log('Пропорции и тона записаны в public/assets/covers/art.json');
