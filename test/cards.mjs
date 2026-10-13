/**
 * Проверка системы карточек выигрыша.
 *
 * Отдельным файлом, а не внутри test/ui.mjs, по двум причинам. Первая: общий
 * интерфейсный прогон длинный и падает на колесе фортуны задолго до кейсов,
 * унося с собой всё, что идёт после. Вторая: здесь проверяется геометрия, и
 * она ломается тихо - срезанный угол съедает цену, и никто не замечает, пока
 * не посмотрит глазами на нужный кейс.
 *
 * Главная проверка - цена целиком лежит внутри ВИДИМОЙ формы карточки, а не
 * внутри её прямоугольника. У шестиугольника это разные вещи: цена помещалась
 * в прямоугольник и при этом уезжала под грань.
 *
 * Нужен запущенный сервер: npm run dev
 * Запуск: node test/cards.mjs [url]
 */

import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CASES, publicCase } from '../server/cases.js';
import { FAMILIES } from '../server/themes.js';

const URL_TARGET = process.argv[2] || 'http://localhost:3000';

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    const bin = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return true; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  return false;
};

/*
 * По одному кейсу на семейство: проверять все 68 незачем, композиция у них
 * общая, а вот каждое семейство обязано быть пройдено - мёртвый отрисовщик
 * первым ломается незамеченным.
 */
const byFamily = new Map();
for (const c of CASES) {
  const pub = publicCase(c);
  if (!byFamily.has(pub.visual.family)) byFamily.set(pub.visual.family, pub);
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.case-card', { timeout: 15000 });

check('у каждого семейства есть кейс', byFamily.size === FAMILIES.length,
  `${byFamily.size} из ${FAMILIES.length}`);

/**
 * Лежит ли точка внутри видимой формы карточки.
 *
 * Прямоугольника мало: clip-path срезает углы и скашивает бока, а цена
 * помещалась в прямоугольник и всё равно оказывалась за гранью.
 */
const GEOMETRY = {
  // Доля высоты снизу и доля ширины с краёв, которые форма съедает.
  card:   { bottom: 0,    side: 0    },
  notch:  { bottom: 0.02, side: 0.03 },
  ticket: { bottom: 0,    side: 0.02 },
  hex:    { bottom: 0.11, side: 0.07 },
};

for (const [family, pub] of byFamily) {
  await page.evaluate((id) => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === id);
    if (card) { card.scrollIntoView({ block: 'center' }); card.click(); }
  }, pub.id);
  await page.waitForSelector('.drop-card', { timeout: 10000 });
  await page.waitForTimeout(250);

  const seen = await page.evaluate((geo) => {
    const tiles = [...document.querySelectorAll('.drop-card')];
    if (!tiles.length) return null;
    const heights = new Set();
    const grads = [];
    let outside = 0;
    let missingSkin = 0;
    let family = null;
    let shape = null;

    for (const t of tiles) {
      heights.add(Math.round(t.getBoundingClientRect().height));
      if (!t.dataset.family || !t.dataset.shape || !t.dataset.material) { missingSkin++; continue; }
      family = t.dataset.family;
      shape = t.dataset.shape;
      const g = geo[t.dataset.shape] || geo.card;
      const cr = t.getBoundingClientRect();
      const v = t.querySelector('.tile-value');
      if (!v) continue;
      const vr = v.getBoundingClientRect();
      if (vr.bottom > cr.bottom - cr.height * g.bottom + 0.5) outside++;
      if (vr.left < cr.left + cr.width * g.side - 0.5) outside++;
      if (vr.right > cr.right - cr.width * g.side + 0.5) outside++;
      for (const id of t.innerHTML.match(/id="(im[^"]+)"/g) || []) grads.push(id);
    }
    return {
      count: tiles.length, family, shape, outside, missingSkin,
      heights: [...heights],
      gradTotal: grads.length,
      gradUnique: new Set(grads).size,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, GEOMETRY);

  if (!check(`${family}: лента отрисована`, seen && seen.count > 0)) continue;

  check(`${family}: у всех плиток есть оформление`, seen.missingSkin === 0,
    `без атрибутов: ${seen.missingSkin}`);
  check(`${family}: семейство совпадает с темой кейса`, seen.family === pub.visual.family,
    `в разметке ${seen.family}, в теме ${pub.visual.family}`);
  check(`${family}: форма совпадает с темой кейса`, seen.shape === pub.visual.shape,
    `в разметке ${seen.shape}, в теме ${pub.visual.shape}`);

  // Ради этой строки файл и написан.
  check(`${family}: цена внутри видимой формы`, seen.outside === 0,
    `нарушений: ${seen.outside} (форма ${seen.shape})`);

  /*
   * Повторись id градиента - и url(#...) во всех плитках разрешился бы в
   * первую: вся лента взяла бы материал первой плитки.
   */
  check(`${family}: id градиентов уникальны`, seen.gradTotal === seen.gradUnique,
    `${seen.gradUnique} уникальных из ${seen.gradTotal}`);

  check(`${family}: нет горизонтального скролла`, seen.overflow <= 0, `${seen.overflow}px`);

  await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.case-card', { timeout: 15000 });
}

/* Система должна давать РАЗНЫЕ карточки, а не один шаблон восьми оттенков. */
const families = new Set([...byFamily.keys()]);
check('семейств в проекте не меньше шести', families.size >= 6, `${families.size}`);

await browser.close();

console.log(`\nКарточки выигрыша: ${passed} проверок пройдено`);
if (failures.length) {
  console.log(`Провалено: ${failures.length}`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
