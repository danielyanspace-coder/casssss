/**
 * Демо вариантов кнопки «Открыть» на экране кейса.
 *
 *   node tools/open-button-demo.mjs   ->  dist/open-button-demo.html
 *
 * Заказчику не нравится нынешняя кнопка, но и что нужно вместо неё, он не
 * знает. Описывать варианты словами бессмысленно: выбирают глазами. Поэтому
 * все варианты стоят на настоящем экране кейса - с его обложкой, ценой,
 * пачками фриспинов и составом, - и между ними переключаются одной кнопкой.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, FREESPIN_PACKS, freeSpinPackPrice } from '../server/cases.js';
import { itemArtHd } from '../public/item-art-hd.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASE_ID = process.argv[2] || 'blade_1500';
const c = CASES.find((x) => x.id === CASE_ID);
if (!c) throw new Error(`нет кейса ${CASE_ID}`);

// Id градиентов в рисунке заменяются меткой: один рисунок вставляется в демо
// несколько раз, и без подмены url(#...) всех копий указывал бы на первую.
let renders = 0;
const art = (key) => {
  const svg = itemArtHd(key);
  const prefix = `hd${(renders++).toString(36)}`;
  if (!svg || !svg.includes(`id="${prefix}`)) throw new Error(`рисунок ${key}: не нашёлся префикс ${prefix}`);
  return svg.replaceAll(`"${prefix}`, '"§').replaceAll(`#${prefix}`, '#§');
};

const cover = `data:image/webp;base64,${readFileSync(join(ROOT, `public/assets/covers/${c.art}.webp`)).toString('base64')}`;

// Состав: четыре самых дорогих предмета и самый частый - чтобы в превью
// «шансов в составе» было видно и редкое, и обычное.
const regular = c.items.filter((it) => it.kind === 'item').sort((a, b) => b.value - a.value);
const picks = [...regular.slice(0, 3), regular[regular.length - 1]];
const items = picks.map((it) => ({
  name: it.name, value: it.value, tier: it.tier, probability: it.probability,
  family: it.skin.family, art: art(it.art),
}));

// Другие кейсы - показать, что вариант «цвет кейса» у каждого свой.
const others = ['vegas', 'arctic', 'toxic', 'pharaoh']
  .map((theme) => CASES.find((x) => x.theme === theme))
  .filter(Boolean)
  .map((x) => ({ name: x.name, price: x.price, palette: x.palette }));

const data = {
  case: { name: c.name, price: c.price, palette: c.palette, cover },
  packs: FREESPIN_PACKS.map((p) => ({ count: p.count, popular: !!p.popular, price: freeSpinPackPrice(c, p.count) })),
  items,
  others,
};

const template = readFileSync(join(ROOT, 'tools/open-button-demo.html'), 'utf8');
if (!template.includes('/*DATA*/')) throw new Error('в шаблоне нет метки /*DATA*/');
const out = template.replace('/*DATA*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/open-button-demo.html'), out);
console.log(`dist/open-button-demo.html: ${(out.length / 1024).toFixed(0)} КБ, кейс «${c.name}»`);
