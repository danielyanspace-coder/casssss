/**
 * Проверка системы карточек выигрыша.
 *
 * Главное, ради чего файл написан: ВНУТРИ ОДНОГО КЕЙСА карточки обязаны
 * различаться. Первая версия системы вешала оформление на тему кейса, и все
 * двадцать с лишним предметов внутри выглядели одинаково - ровно то, с чего
 * начинали. Игрок открывает состав одного кейса, а не сравнивает кейсы между
 * собой, поэтому разнообразие нужно именно здесь.
 *
 * Второе: отрисованное обязано совпадать с тем, что решил сервер. Скин
 * считается в server/card-skins.js и едет в ответе; если клиент начнёт
 * выбирать его сам, лента, сетка и экран результата разойдутся между собой.
 *
 * Третье: геометрия. Срезанный угол и скос обрезают содержимое, и ломается это
 * тихо - цена уезжает под грань, а в прямоугольник при этом помещается.
 *
 * Нужен запущенный сервер: npm run dev
 * Запуск: node test/cards.mjs [url]
 */

import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CASES, publicCase } from '../server/cases.js';
import { FAMILIES } from '../server/themes.js';
import { validateSkins } from '../server/card-skins.js';

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

/* ---------- Что можно проверить без браузера ---------- */

check('таблицы оформления сходятся', (() => {
  try { validateSkins(); return true; } catch { return false; }
})());

/*
 * Разнообразие внутри кейса считается по ВСЕМ 68, а не по выборке: кейс с
 * неудачной раскладкой хешей иначе проедет незамеченным, а именно он и
 * выглядит как «опять одно и то же».
 */
let worstShare = 0;
let worstCase = '';
let minFamilies = 99;
let minFamiliesCase = '';
for (const c of CASES) {
  const pub = publicCase(c);
  const n = {};
  for (const it of pub.items) {
    if (!it.skin) { failures.push(`${pub.id}: у предмета "${it.name}" нет скина`); break; }
    n[it.skin.family] = (n[it.skin.family] || 0) + 1;
  }
  const families = Object.keys(n).length;
  const share = Math.max(...Object.values(n)) / pub.items.length;
  if (share > worstShare) { worstShare = share; worstCase = pub.id; }
  if (families < minFamilies) { minFamilies = families; minFamiliesCase = pub.id; }
}

check('в каждом кейсе не меньше пяти семейств', minFamilies >= 5,
  `минимум ${minFamilies} в кейсе ${minFamiliesCase}`);
check('ни одно семейство не занимает больше половины кейса', worstShare <= 0.5,
  `${(worstShare * 100).toFixed(0)}% в кейсе ${worstCase}`);

/* Скин обязан быть устойчивым: иначе предмет меняет вид между двумя взглядами. */
{
  const a = publicCase(CASES[0]).items.map((it) => `${it.skin.family}/${it.skin.material}`).join(',');
  const b = publicCase(CASES[0]).items.map((it) => `${it.skin.family}/${it.skin.material}`).join(',');
  check('скин одного предмета не меняется между вызовами', a === b);
}

/* ---------- Браузер ---------- */

/*
 * Восемь кейсов вразбивку по цене: композиция у всех общая, проверять все 68
 * в браузере незачем, а вот дешёвый и дорогой краями отличаются.
 */
const sample = [];
const sorted = CASES.slice().sort((a, b) => a.price - b.price);
for (let i = 0; i < 8; i++) sample.push(publicCase(sorted[Math.floor(i * (sorted.length - 1) / 7)]));

/**
 * Сколько ПИКСЕЛЕЙ форма съедает у нижнего края и у правого.
 *
 * Именно в пикселях, а не в долях: clip-path в styles.css задан пикселями, и
 * проверка в процентах с ним расходится - первая версия этого файла требовала
 * от шестиугольника 11% высоты там, где вёрстка оставляет 14 точек.
 *
 * notch срезает только нижний ПРАВЫЙ угол треугольником 10x10, поэтому у него
 * ограничение по правому краю, а не по нижнему.
 */
const GEOMETRY = {
  card:   { bottom: 0,  right: 0  },
  notch:  { bottom: 0,  right: 10 },
  ticket: { bottom: 0,  right: 0  },
  hex:    { bottom: 14, right: 0  },
};

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.case-card', { timeout: 15000 });

// Онбординг перекрывает экран затемнением и съедает все клики.
for (let i = 0; i < 10; i++) {
  if (!(await page.isVisible('#onbBackdrop').catch(() => false))) break;
  await page.click('#onbNext').catch(() => {});
  await page.waitForTimeout(140);
}

const seenFamilies = new Set();

for (const pub of sample) {
  await page.evaluate((id) => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === id);
    if (card) { card.scrollIntoView({ block: 'center' }); card.click(); }
  }, pub.id);
  await page.waitForSelector('.drop-card', { timeout: 10000 });
  await page.waitForTimeout(250);

  const seen = await page.evaluate((geo) => {
    const cards = [...document.querySelectorAll('.drop-card')];
    if (!cards.length) return null;
    const rows = [];
    const grads = [];
    let outside = 0;
    let missingSkin = 0;

    for (const c of cards) {
      if (!c.dataset.family || !c.dataset.shape || !c.dataset.material) { missingSkin++; continue; }
      rows.push({
        name: (c.querySelector('.drop-name')?.textContent || '').trim(),
        family: c.dataset.family,
        shape: c.dataset.shape,
        material: c.dataset.material,
      });
      const g = geo[c.dataset.shape] || geo.card;
      const cr = c.getBoundingClientRect();
      const v = c.querySelector('.drop-value');
      if (!v) continue;
      /*
       * Мерим САМ ТЕКСТ, а не коробку: у подписи свой внутренний отступ, и
       * коробка доходит до края карточки, когда текст до него далеко.
       */
      const cs = getComputedStyle(v);
      const box = v.getBoundingClientRect();
      const text = {
        left: box.left + parseFloat(cs.paddingLeft),
        right: box.right - parseFloat(cs.paddingRight),
        bottom: box.bottom - parseFloat(cs.paddingBottom),
      };
      if (text.bottom > cr.bottom - g.bottom + 0.5) outside++;
      if (text.right > cr.right - g.right + 0.5) outside++;
      if (text.left < cr.left - 0.5) outside++;
      for (const id of c.innerHTML.match(/id="(im[^"]+)"/g) || []) grads.push(id);
    }
    return {
      rows, outside, missingSkin,
      gradTotal: grads.length,
      gradUnique: new Set(grads).size,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, GEOMETRY);

  const tag = pub.id;
  if (!check(`${tag}: состав отрисован`, seen && seen.rows.length > 0)) continue;

  check(`${tag}: у всех карточек есть оформление`, seen.missingSkin === 0,
    `без атрибутов: ${seen.missingSkin}`);

  /* Ради этой строки файл и написан: внутри кейса должно быть РАЗНО. */
  const fams = new Set(seen.rows.map((r) => r.family));
  const mats = new Set(seen.rows.map((r) => r.material));
  const shapes = new Set(seen.rows.map((r) => r.shape));
  fams.forEach((f) => seenFamilies.add(f));

  check(`${tag}: в кейсе несколько семейств`, fams.size >= 4, `${fams.size}: ${[...fams].join(', ')}`);
  check(`${tag}: в кейсе несколько материалов`, mats.size >= 3, `${mats.size}`);
  check(`${tag}: в кейсе несколько форм`, shapes.size >= 2, `${shapes.size}`);

  /* Клиент не выбирает скин сам: что решил сервер, то и нарисовано. */
  const byName = new Map();
  for (const it of pub.items) byName.set(it.name, it.skin);
  let drift = 0;
  for (const r of seen.rows) {
    const want = byName.get(r.name);
    if (!want) continue;              // витринный предмет своего скина не имеет
    if (want.family !== r.family || want.material !== r.material || want.shape !== r.shape) drift++;
  }
  check(`${tag}: разметка совпадает с ответом сервера`, drift === 0, `расхождений: ${drift}`);

  check(`${tag}: цена внутри видимой формы`, seen.outside === 0, `нарушений: ${seen.outside}`);

  /*
   * Повторись id градиента - и url(#...) во всех карточках разрешился бы в
   * первый по порядку: весь кейс взял бы материал первой карточки.
   */
  check(`${tag}: id градиентов уникальны`, seen.gradTotal === seen.gradUnique,
    `${seen.gradUnique} из ${seen.gradTotal}`);

  check(`${tag}: нет горизонтального скролла`, seen.overflow <= 0, `${seen.overflow}px`);

  await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.case-card', { timeout: 15000 });
}

/*
 * Мёртвый отрисовщик не запускается никогда и первым ломается незамеченным,
 * поэтому каждое описанное семейство обязано где-то встретиться.
 */
for (const f of FAMILIES) {
  check(`семейство "${f}" встречается в выборке`, seenFamilies.has(f));
}

await browser.close();

console.log(`\nКарточки выигрыша: ${passed} проверок пройдено`);
if (failures.length) {
  console.log(`Провалено: ${failures.length}`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
