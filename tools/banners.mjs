/**
 * Подготовка присланной графики: баннеры первого экрана, логотип и колесо
 * фортуны.
 *
 * Исходники лежат в корне репозитория под именами с телефона
 * (BCA613B3-....png и так далее). Скрипт переводит их в WebP и кладёт в
 * public/assets/ui/ под понятными именами.
 *
 * Запуск: node tools/banners.mjs
 *
 * ПОЧЕМУ В assets/ui, А НЕ РЯДОМ С ОБЛОЖКАМИ. Автономная демо-сборка сама
 * подставляет внутрь файла всё, что лежит по пути assets/ui/*.webp
 * (см. inlineUi в build-standalone.mjs). Положив картинки туда, мы получаем
 * работающее демо без единой правки сборщика.
 *
 * ПОЧЕМУ ИМЕНА ТОЛЬКО ИЗ БУКВ, ЦИФР И ДЕФИСА. Тот же inlineUi ищет пути
 * выражением [\w-]+\.webp. Имя с точкой, пробелом или кириллицей он не
 * увидит, и в демо картинка окажется битой.
 *
 * СПОСОБЫ ОБРЕЗКИ (поле crop у задания):
 *
 *   нет        - берём файл целиком;
 *   'padding'  - срезаем однотонные поля вокруг рисунка, границу ищем по
 *                отличию от цвета угла;
 *   'alpha'    - срезаем прозрачные поля, границу ищем по альфе;
 *   {x,y,w,h}  - берём прямоугольник, заданный числами;
 *   {cx,cy,r}  - вырезаем круг: всё вне круга становится прозрачным.
 *
 * ЗАЧЕМ ВООБЩЕ СРЕЗАТЬ ПОЛЯ. Сама картинка не обрезается никогда: на баннерах
 * есть надписи у самого края кадра, и обрезка по живому съедает слово. А вот
 * пустые поля вокруг рисунка мешают всерьёз. У пары баннеров под главным они
 * съедали 31% и 13% высоты файла: два блока одинаковой высоты показывали
 * рисунки заметно разной высоты, и квадрат вылезал за линию соседа сверху и
 * снизу. После обрезки пропорции блоков равны пропорциям самих рисунков, и
 * линия сходится сама.
 *
 * ПОЧЕМУ 1600 px ПО ДЛИННОЙ СТОРОНЕ. На компьютере баннер занимает около
 * 1180 CSS-px, на телефоне - ширину экрана. 1600 px держит его резким и там,
 * и там, но не раздувает автономную сборку: все картинки уезжают в неё
 * строками прямо в разметке.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = new URL('../public/assets/ui/', import.meta.url);
const ROOT = new URL('../', import.meta.url);

const WIDE_SIDE = 1600;
const SQUARE_SIDE = 900;
const QUALITY = 0.84;

/*
 * ГЕОМЕТРИЯ КОЛЕСА ФОРТУНЫ, СНЯТАЯ С ПРИСЛАННОЙ КАРТИНКИ.
 *
 * Центр и радиус найдены по золотому ободу: обод прослежен построчно, и по
 * трём строкам решена система на центр и радиус. Границы секторов найдены по
 * яркости вдоль окружности - разделители между секторами светятся, и их
 * девять, ровно через сорок градусов.
 *
 * Эти числа нужны не только здесь: те же START_DEG и SEGMENTS стоят в
 * public/app.js, чтобы остановить колесо на нужном секторе. Меняете картинку -
 * меняйте оба места.
 */
const WHEEL = {
  cx: 608, cy: 672,
  // Радиус выреза. Обод кончается на 390, лампы лежат внутри него, а с 392
  // начинается нарисованный на картинке указатель. Берём 388: указатель не
  // попадает совсем. Свой указатель рисуется в CSS и стоит неподвижно - иначе
  // он крутился бы вместе с колесом и никуда бы не показывал.
  r: 388,
  // Ступица со словом SPIN. Она накладывается сверху неподвижно, иначе
  // надпись крутилась бы вместе с колесом.
  hubR: 125,
};

/* Карточка Lucky Fortune: рамка карточки найдена по светлой линии обвода. */
const CARD = { x: 60, y: 26, w: 1104, h: 1198 };

/*
 * Верхняя иллюстрация окна «Выполните 2 шага». Панель с текстом не берём:
 * её состояния живые, и она собирается разметкой. Нарисованный крестик
 * стираем - своя кнопка закрытия ставится поверх.
 */
const STEPS = { x: 0, y: 0, w: 1122, h: 578 };
// Радиус берёт не только сам крестик, но и фиолетовое кольцо-свечение вокруг
// него: при меньшем радиусе кольцо оставалось висеть пустым бубликом.
const STEPS_ERASE = { cx: 1008, cy: 216, r: 82 };

/*
 * ЗНАЧКИ БОКОВОГО МЕНЮ.
 *
 * Присланный макет - одна картинка со всей панелью: логотип, восемь плиток с
 * рисунком, названием и подписью. Целиком её взять нельзя: подписи в ней
 * вшиты, активная плитка подсвечена намертво, а блок «Админ» заказчик просил
 * убрать. Поэтому из макета берутся только рисунки, а плитки собираются
 * разметкой - тогда у них живая подсветка и правильный набор разделов.
 *
 * Середины рисунков сняты с макета прослеживанием ярких строк в левой полосе
 * панели, а не отмерены линейкой: шаг между плитками в макете гуляет на
 * десяток точек, и равномерная сетка уводила рисунок вниз к концу списка.
 *
 * Фон плитки в макете почти чёрный, а рисунки светятся, поэтому фон снимается
 * по яркости: всё темнее ALPHA_LO становится прозрачным, светлее ALPHA_HI -
 * непрозрачным, между ними плавный переход. Вырезать по контуру руками не
 * пришлось, а на плитке любого тона рисунок лежит без светлого прямоугольника
 * вокруг.
 */
const MENU_SRC = '0C1E7433-8B84-48B0-A279-716A0320998D.png';

/** Рамка вырезки: левая полоса панели, подписи в неё не попадают. */
const MENU_ART = { x: 100, w: 250, h: 150 };

/** Середина рисунка каждой плитки. Админ пропущен намеренно. */
const MENU_ROWS = [
  [428.5, 'nav-cases'],
  [613, 'nav-upgrade'],
  [787.5, 'nav-crash'],
  [951.5, 'nav-roulette'],
  [1127.5, 'nav-wallet'],
  [1297.5, 'nav-bonuses'],
  [1654.5, 'nav-support'],
];

const MENU_ICONS = MENU_ROWS.map(([centre, out]) => ({
  src: MENU_SRC,
  out: out + '.webp',
  side: 320,
  crop: {
    x: MENU_ART.x,
    y: Math.round(centre - MENU_ART.h / 2),
    w: MENU_ART.w,
    h: MENU_ART.h,
  },
  keyDark: true,
}));

const JOBS = [
  // Слайд-шоу главного баннера. Порядок показа задан порядком в этом списке.
  { src: 'D6BC2519-B36D-47EE-903D-E3CC550101FE.png', out: 'hero-1.webp', side: WIDE_SIDE },
  { src: 'EE1DE7F8-0010-417B-827E-D0B6EFFE427D.png', out: 'hero-2.webp', side: WIDE_SIDE },
  { src: '16F7CEB0-E741-45A6-8C78-811D5FB87B99.png', out: 'hero-3.webp', side: WIDE_SIDE },
  { src: 'F47531B5-0B24-44D6-ADFD-D30C8582137B.png', out: 'hero-4.webp', side: WIDE_SIDE },

  // Пара под лентой: широкий слева, квадратный справа. Обоим срезаем поля,
  // иначе они не встают по одной линии.
  { src: '8BAFCF8F-7FF3-459C-A57E-21F8ABAB2893.png', out: 'promo-wide.webp',
    side: WIDE_SIDE, crop: 'padding' },
  { src: '7CF7197F-8BCA-4DFF-9C95-3BD99137E05B.png', out: 'promo-square.webp',
    side: SQUARE_SIDE, crop: 'padding' },

  // Логотип. Он с прозрачным фоном, поэтому границу ищем по альфе.
  { src: '6970FDCD-ECAF-473C-979D-800B099CEA90.png', out: 'logo.webp',
    side: 900, crop: 'alpha' },

  // Lucky Fortune: карточка без рамки, колесо, ступица, иллюстрация окна.
  { src: 'BCA613B3-E7FC-4125-B93C-1B59B7E3AEF5.png', out: 'fortune-card.webp',
    side: 1200, crop: CARD },
  { src: 'BCA613B3-E7FC-4125-B93C-1B59B7E3AEF5.png', out: 'fortune-wheel.webp',
    side: 820, crop: { cx: WHEEL.cx, cy: WHEEL.cy, r: WHEEL.r } },
  { src: 'BCA613B3-E7FC-4125-B93C-1B59B7E3AEF5.png', out: 'fortune-hub.webp',
    side: 300, crop: { cx: WHEEL.cx, cy: WHEEL.cy, r: WHEEL.hubR } },
  { src: 'DDDA9C65-FC0A-4337-810C-CFD9149B8E76.png', out: 'fortune-steps.webp',
    side: 1000, crop: STEPS, erase: STEPS_ERASE },

  // Два баннера в самом низу подвала: поддержка и канал. Кнопки на них
  // нарисованы, поверх каждой лежит прозрачная настоящая - см. .footer-promo.
  { src: '15B0F685-0C59-4649-B93D-0FD6E1BD3DF4.png', out: 'footer-support.webp',
    side: 1400, crop: 'padding' },
  { src: 'B6CC3BDB-260A-4AEE-9FAC-D6FC965C06AF.png', out: 'footer-channel.webp',
    side: 1400, crop: 'padding' },

  // Обложка сезонного кейса. Вертикальная, поэтому на компьютере она стоит
  // справа от слайд-шоу, а не полосой под ним.
  { src: '60C7F2F1-77E6-4BA0-AC80-D8B9E89EB50A.png', out: 'case-porsche.webp',
    side: 1100, crop: 'padding' },

  ...MENU_ICONS,
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

for (const job of JOBS) {
  const src = 'data:image/png;base64,'
    + readFileSync(new URL(job.src, ROOT)).toString('base64');

  const res = await page.evaluate(async ({ src, side, quality, crop, erase, keyDark }) => {
    const img = new Image();
    img.src = src;
    await img.decode();

    /** Границы однотонного или прозрачного поля вокруг рисунка. */
    const findBox = (mode) => {
      const probe = document.createElement('canvas');
      probe.width = img.width; probe.height = img.height;
      const px = probe.getContext('2d', { willReadFrequently: true });
      px.drawImage(img, 0, 0);
      const data = px.getImageData(0, 0, probe.width, probe.height).data;
      const at = (i, j) => {
        const k = (j * probe.width + i) * 4;
        return [data[k], data[k + 1], data[k + 2], data[k + 3]];
      };
      const bg = at(0, 0);
      // Порог, а не точное равенство: сжатие и градиент фона дают разброс в
      // несколько единиц, и по точному совпадению поле не нашлось бы вовсе.
      const T = 22;
      const differs = mode === 'alpha'
        ? (i, j) => at(i, j)[3] > 24
        : (i, j) => {
          const q = at(i, j);
          if (q[3] < 16) return false;
          return Math.abs(q[0] - bg[0]) > T
              || Math.abs(q[1] - bg[1]) > T
              || Math.abs(q[2] - bg[2]) > T;
        };
      // Шаг в два пикселя: поля шириной в один пиксель не бывает, а проход по
      // каждому пикселю на картинке в два мегапикселя заметно дольше.
      const STEP = 2;
      let top = 0, bot = img.height - 1, left = 0, right = img.width - 1;
      outerT: for (let j = 0; j < img.height; j += STEP)
        for (let i = 0; i < img.width; i += STEP) if (differs(i, j)) { top = j; break outerT; }
      outerB: for (let j = img.height - 1; j >= 0; j -= STEP)
        for (let i = 0; i < img.width; i += STEP) if (differs(i, j)) { bot = j; break outerB; }
      outerL: for (let i = 0; i < img.width; i += STEP)
        for (let j = 0; j < img.height; j += STEP) if (differs(i, j)) { left = i; break outerL; }
      outerR: for (let i = img.width - 1; i >= 0; i -= STEP)
        for (let j = 0; j < img.height; j += STEP) if (differs(i, j)) { right = i; break outerR; }
      return { x: left, y: top, w: right - left + 1, h: bot - top + 1 };
    };

    const circle = crop && typeof crop === 'object' && 'r' in crop;
    let box;
    if (crop === 'padding' || crop === 'alpha') box = findBox(crop);
    else if (circle) box = { x: crop.cx - crop.r, y: crop.cy - crop.r, w: crop.r * 2, h: crop.r * 2 };
    else if (crop) box = crop;
    else box = { x: 0, y: 0, w: img.width, h: img.height };

    // Меньше исходника не растягиваем: увеличение только смажет картинку.
    const k = Math.min(1, side / Math.max(box.w, box.h));
    const c = document.createElement('canvas');
    c.width = Math.round(box.w * k);
    c.height = Math.round(box.h * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);

    if (circle) {
      // Круглый вырез: всё вне круга уходит в прозрачность. Край чуть мягкий,
      // иначе на повороте окружность заметно рвётся ступеньками.
      ctx.globalCompositeOperation = 'destination-in';
      const R = c.width / 2;
      const g = ctx.createRadialGradient(R, R, R - 2, R, R, R);
      g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    if (keyDark) {
      /*
       * Снятие почти чёрного фона по яркости.
       *
       * Порог мягкий, а не резкий: при резком край рисунка идёт ступеньками,
       * и на тёмной плитке это видно как грязная обводка. Нижняя граница
       * взята чуть выше самого светлого места фона плитки, верхняя - чуть
       * ниже самой тёмной части самих рисунков.
       */
      const ALPHA_LO = 14;
      const ALPHA_HI = 38;
      const im = ctx.getImageData(0, 0, c.width, c.height);
      const px = im.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        const a = Math.max(0, Math.min(1, (lum - ALPHA_LO) / (ALPHA_HI - ALPHA_LO)));
        px[i + 3] = Math.round(px[i + 3] * a);
      }
      ctx.putImageData(im, 0, 0);
    }

    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc((erase.cx - box.x) * k, (erase.cy - box.y) * k, erase.r * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    return {
      w: c.width, h: c.height,
      base64: c.toDataURL('image/webp', quality).split(',')[1],
    };
  }, { src, side: job.side, quality: QUALITY, crop: job.crop || null,
       erase: job.erase || null, keyDark: !!job.keyDark });

  const buf = Buffer.from(res.base64, 'base64');
  writeFileSync(new URL(job.out, OUT), buf);
  console.log(`${job.out.padEnd(20)} ${res.w}x${res.h}  ${(buf.length / 1024).toFixed(0)} КБ`
    + `  соотношение ${(res.w / res.h).toFixed(3)}`);
}

await browser.close();
