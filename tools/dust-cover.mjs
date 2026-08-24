/**
 * Сборка обложки кейса «Пыль» из присланного рендера.
 *
 * Скрипт разовый и лежит здесь как история происхождения ассета — так же, как
 * cutout-porsche.mjs. Исходник (рендер с прозрачным фоном) в репозиторий кладётся
 * рядом, в корень: Пыль.png, как и остальные присланные картинки.
 *
 * Запуск: node tools/dust-cover.mjs
 *
 * ЗАЧЕМ ВООБЩЕ СБОРКА, А НЕ ПРЯМАЯ ВСТАВКА КАРТИНКИ.
 * Исходник почти квадратный (1215x1295), а слот обложки горизонтальный: на
 * телефоне карточка примерно 171x104 (1.64:1), на широком экране 137x120
 * (1.14:1). Вставить квадрат в такой слот через object-fit: cover — значит
 * срезать сверху флаг, снизу каменное основание, то есть ровно то, что держит
 * композицию. Поэтому объект не растягивается под слот, а СТАВИТСЯ ЦЕЛИКОМ на
 * дорисованный фон нужной пропорции.
 *
 * ПОЧЕМУ ХОЛСТ 1.5:1 И ОБЪЕКТ В 84% ВЫСОТЫ.
 * Обложка всё равно показывается через object-fit: cover, и пропорция слота
 * гуляет между 1.14:1 и 1.64:1. При холсте 1.5:1 обрезка выходит такой:
 *   слот 1.14:1 — виден центр по ширине, 1.14/1.5 = 76% холста;
 *   слот 1.64:1 — виден центр по высоте, 1.5/1.64 = 91% холста.
 * Объект при высоте 84% занимает 84% высоты и всего 53% ширины холста, то есть
 * укладывается в обе безопасные зоны с запасом и не режется ни на одном экране.
 *
 * Фон дорисовывается намеренно: у объекта края и так уходят в прозрачную
 * песчаную дымку, поэтому граница между ним и градиентом не читается.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../Пыль.png', import.meta.url);
const OUT = new URL('../public/assets/dust-cover.webp', import.meta.url);

/** Холст с запасом по разрешению: обложка показывается максимум ~350 CSS-px. */
const W = 960;
const H = 640;

/** Доля высоты холста, которую занимает объект. Обоснование — в шапке файла. */
const OBJECT_SCALE = 0.84;

const dataUri = 'data:image/png;base64,' + readFileSync(SRC).toString('base64');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const base64 = await page.evaluate(async ({ dataUri, W, H, OBJECT_SCALE }) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── Фон: пустынные сумерки. Цвета сняты с самого рендера (тёмный низ,
  // тёплая песчаная середина), чтобы дорисованное не спорило с объектом.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.00, '#241608');
  sky.addColorStop(0.38, '#4a2f16');
  sky.addColorStop(0.72, '#33200e');
  sky.addColorStop(1.00, '#120a04');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Тёплое свечение за сундуком — оно же держит центр композиции.
  const glow = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, W * 0.42);
  glow.addColorStop(0.00, 'rgba(255, 190, 96, 0.42)');
  glow.addColorStop(0.45, 'rgba(214, 138, 52, 0.20)');
  glow.addColorStop(1.00, 'rgba(180, 110, 40, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Песчаная дымка понизу: смыкает объект с фоном, чтобы он не «висел».
  const haze = ctx.createLinearGradient(0, H * 0.55, 0, H);
  haze.addColorStop(0, 'rgba(196, 150, 96, 0)');
  haze.addColorStop(0.55, 'rgba(196, 150, 96, 0.16)');
  haze.addColorStop(1, 'rgba(120, 84, 48, 0.10)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);

  // ── Объект целиком, по центру.
  const dh = H * OBJECT_SCALE;
  const dw = dh * (img.width / img.height);
  const dx = (W - dw) / 2;
  const dy = (H - dh) / 2;

  // Мягкая тень под основанием — без неё объект выглядит наклейкой.
  ctx.save();
  const shadow = ctx.createRadialGradient(W / 2, dy + dh * 0.93, 0, W / 2, dy + dh * 0.93, dw * 0.46);
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(W / 2, dy + dh * 0.93, dw * 0.46, dh * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(img, dx, dy, dw, dh);

  // ── Виньетка. Низ гасится сильнее: поверх обложки идут подписи карточки
  // («до N» слева внизу), и по светлому песку они не читались бы.
  const vig = ctx.createLinearGradient(0, 0, 0, H);
  vig.addColorStop(0.00, 'rgba(13, 3, 24, 0.34)');
  vig.addColorStop(0.30, 'rgba(13, 3, 24, 0.00)');
  vig.addColorStop(0.72, 'rgba(13, 3, 24, 0.00)');
  vig.addColorStop(1.00, 'rgba(13, 3, 24, 0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  const sides = ctx.createLinearGradient(0, 0, W, 0);
  sides.addColorStop(0.00, 'rgba(13, 3, 24, 0.46)');
  sides.addColorStop(0.22, 'rgba(13, 3, 24, 0.00)');
  sides.addColorStop(0.78, 'rgba(13, 3, 24, 0.00)');
  sides.addColorStop(1.00, 'rgba(13, 3, 24, 0.46)');
  ctx.fillStyle = sides;
  ctx.fillRect(0, 0, W, H);

  return canvas.toDataURL('image/webp', 0.9).split(',')[1];
}, { dataUri, W, H, OBJECT_SCALE });

writeFileSync(OUT, Buffer.from(base64, 'base64'));
await browser.close();

console.log(`Готово: ${OUT.pathname}`);
