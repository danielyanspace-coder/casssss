/**
 * Демо анимации: покупка фриспинов и крупные выигрыши.
 *
 *   node tools/motion-demo.mjs        ->  dist/motion-demo.html
 *
 * Один HTML-файл без сервера - его отправляют заказчику посмотреть задумку до
 * того, как она поедет в приложение. Данные настоящие: цена, вероятности,
 * оформление и объёмные рисунки кейса берутся из той же сборки, что отдаёт
 * сервер. Лента в демо набирается по настоящим вероятностям - иначе демо
 * показывало бы не ту плотность дорогих плиток, что увидит игрок (CLAUDE.md,
 * «Не подкручивать ленту барабана под психологию»).
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

/*
 * Id градиентов в рисунке уникальны на каждую отрисовку (hd<номер>...), а в
 * демо один рисунок вставляется в ленту много раз. Префикс заменяется меткой,
 * и клиент подставляет свой номер на каждую вставку: иначе url(#...) во всех
 * копиях разрешился бы в первую, и снятая с ленты карточка потеряла бы цвета.
 */
let renders = 0;
const art = {};
const addArt = (key) => {
  if (art[key]) return;
  const svg = itemArtHd(key);
  const prefix = `hd${(renders++).toString(36)}`;
  if (!svg || !svg.includes(`id="${prefix}`)) throw new Error(`рисунок ${key}: не нашёлся префикс ${prefix}`);
  art[key] = svg.replaceAll(`"${prefix}`, '"§').replaceAll(`#${prefix}`, '#§');
};

const items = c.items.map((it) => {
  addArt(it.art);
  return {
    name: it.name, kind: it.kind, tier: it.tier, value: it.value,
    probability: it.probability, skin: it.skin, art: it.art,
    count: it.count || 0, perkType: it.perk?.type || null,
  };
});
const packs = FREESPIN_PACKS.map((p) => ({ count: p.count, popular: !!p.popular, discount: p.discount, price: freeSpinPackPrice(c, p.count) }));
for (const p of packs) {
  if (!(p.price > 0)) throw new Error(`пачка ${p.count}: цена не посчиталась`);
  addArt(`perk/fs/${p.count}`);
}

const data = { case: { id: c.id, name: c.name, price: c.price, items, packs }, art };

const template = readFileSync(join(ROOT, 'tools/motion-demo.html'), 'utf8');
if (!template.includes('/*DATA*/')) throw new Error('в шаблоне нет метки /*DATA*/');
const out = template.replace('/*DATA*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/motion-demo.html'), out);
console.log(`dist/motion-demo.html: ${(out.length / 1024).toFixed(0)} КБ, кейс «${c.name}», рисунков ${Object.keys(art).length}`);
