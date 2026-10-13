/**
 * Объёмные рисунки предметов: у каждого свой, и ни один не повторяется.
 *
 *   npm run test:art
 *
 * Сервер не нужен: рисунки - чистые функции, а ключи берутся из той же сборки
 * кейсов, что отдаёт сервер.
 *
 * Главные проверки:
 *  - у каждого предмета каждого кейса есть рисунок по его ключу art;
 *  - в каждой теме ровно столько рисунков, сколько предметов, - лишний или
 *    недостающий рисунок означает, что порядок в hd/<тема>.js разошёлся с
 *    server/themes.js, и «Первый удар» получил бы рисунок цубы;
 *  - все рисунки попарно различны: «ничего нигде не повторяется» - требование
 *    заказчика, и проверять его глазами на 842 картинках нельзя;
 *  - в разметке нет NaN и undefined: такая разметка рисуется пустотой, молча.
 */
import { CASES } from '../server/cases.js';
import { THEMES } from '../server/themes.js';
import { HD_THEMES, itemArtHd } from '../public/item-art-hd.js';
import { HD_SPECIAL_SAMPLES } from '../public/hd/special.js';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
};

/* ---------- Каждой теме - свой файл и ровно по рисунку на предмет ---------- */

for (const [id, theme] of Object.entries(THEMES)) {
  const draws = HD_THEMES[id];
  check(`тема ${id}: есть файл рисунков`, Array.isArray(draws));
  if (!draws) continue;
  check(`тема ${id}: рисунков столько же, сколько предметов`, draws.length === theme.items.length,
    `${draws.length} рисунков на ${theme.items.length} предметов`);
}
check('в реестре нет рисунков для несуществующих тем',
  Object.keys(HD_THEMES).every((id) => THEMES[id]), Object.keys(HD_THEMES).filter((id) => !THEMES[id]).join(', '));

/* ---------- У каждого предмета каждого кейса есть рисунок ---------- */

const list = Array.isArray(CASES) ? CASES : Object.values(CASES);
const keys = new Set();
let missing = 0;
for (const c of list) {
  for (const it of c.items) {
    if (!it.art) { missing++; failures.push(`${c.id}: у «${it.name}» нет ключа рисунка`); continue; }
    keys.add(it.art);
    if (!itemArtHd(it.art)) { missing++; failures.push(`${c.id}: по ключу ${it.art} («${it.name}») рисунка нет`); }
  }
}
check(`у всех предметов всех ${list.length} кейсов есть рисунок`, missing === 0, `пропусков ${missing}`);

// Образцы плюшек в hd/special.js обязаны покрывать всё, что реально выпадает:
// иначе контактный лист показывает не то, что увидит игрок.
const specialKeys = [...keys].filter((key) => /^(perk|jackpot)\//.test(key));
const uncovered = specialKeys.filter((key) => !HD_SPECIAL_SAMPLES.includes(key));
check('образцы плюшек покрывают все плюшки кейсов', uncovered.length === 0, uncovered.join(', '));

/* ---------- Разметка без мусора и без повторов ---------- */

const normalize = (svg) => svg.replace(/hd[0-9a-z]+(?=[a-zA-Z#]|c\d)/g, 'ID').replace(/id="[^"]*"|url\(#[^)]*\)/g, '');
// Контроль самого сравнения: если нормализация не снимает разницу id, то
// «все различны» выполнялось бы всегда, и проверка ничего бы не ловила.
check('одинаковый рисунок после нормализации совпадает с собой',
  normalize(itemArtHd('casino/5')) === normalize(itemArtHd('casino/5')));

const all = [...new Set([...Object.entries(THEMES).flatMap(([id, t]) => t.items.map((_, i) => `${id}/${i}`)), ...HD_SPECIAL_SAMPLES])];
const seen = new Map();
let broken = 0;
for (const key of all) {
  const svg = itemArtHd(key);
  if (!svg) continue;
  if (/NaN|undefined|\[object/.test(svg)) {
    broken++;
    failures.push(`${key}: в разметке ${svg.match(/NaN|undefined|\[object/)[0]}`);
  }
  // Id градиентов уникальны на каждую отрисовку, поэтому для сравнения
  // рисунков их надо привести к одному виду - иначе любые две строки различны.
  const norm = normalize(svg);
  if (seen.has(norm)) failures.push(`${key} повторяет рисунок ${seen.get(norm)}`);
  else seen.set(norm, key);
}
check(`${all.length} рисунков без NaN и undefined`, broken === 0, `сломано ${broken}`);
check(`${all.length} рисунков попарно различны`, seen.size === all.length, `различных ${seen.size}`);

/* ---------- Id градиентов не повторяются между отрисовками ---------- */

// Повторись id - и url(#...) во всех плитках ленты разрешился бы в первый по
// порядку: вся лента взяла бы цвета первой карточки.
const a = itemArtHd('samurai/19'), b = itemArtHd('samurai/19');
const idsA = new Set([...a.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const shared = [...b.matchAll(/id="([^"]+)"/g)].map((m) => m[1]).filter((id) => idsA.has(id));
check('две отрисовки одного рисунка не делят id', shared.length === 0, shared.slice(0, 3).join(', '));

/* ---------- Итог ---------- */

console.log(`\nОбъёмные рисунки: ${passed} проверок пройдено`);
if (failures.length) {
  console.log(`\nПРОВАЛЕНО (${failures.length}):`);
  for (const f of failures.slice(0, 40)) console.log(`  • ${f}`);
  process.exit(1);
}
