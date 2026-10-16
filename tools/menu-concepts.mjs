/**
 * Три направления меню - на согласование.
 *
 *   node tools/menu-concepts.mjs   ->  dist/menu-concepts.html
 *
 * Нынешнее меню собрано из присланной картинки с мультяшными объёмными
 * значками, и заказчику кажется, что оно выбивается из остального вида.
 * Варианты нарисованы только материалами самого проекта: обложки кейсов,
 * объёмные рисунки плюшек (public/hd), золото кнопки «Открыть», шрифт
 * Unbounded. Тогда меню говорит тем же языком, что и экран кейса, а не
 * языком генератора картинок.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemArtHd } from '../public/item-art-hd.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const webp = (path) => `data:image/webp;base64,${readFileSync(join(ROOT, path)).toString('base64')}`;

/*
 * Рисунок вставляется в страницу несколько раз, а id градиентов внутри него
 * уникальны на одну отрисовку. Поэтому каждый ключ рисуется заново на каждую
 * вставку: иначе url(#...) второй копии указывал бы на первую.
 */
const art = (key) => {
  const svg = itemArtHd(key);
  if (!svg) throw new Error(`нет рисунка ${key}`);
  return svg;
};

const data = {
  logo: webp('public/assets/ui/logo.webp'),
  covers: ['vault', 'neon', 'rio', 'lucky', 'spark', 'monaco']
    .reduce((acc, k) => ({ ...acc, [k]: webp(`public/assets/covers/${k}.webp`) }), {}),
  art: {
    x2a: art('perk/x2'), x2b: art('perk/x2'),
    fs20a: art('perk/fs/20'), fs20b: art('perk/fs/20'), fs10: art('perk/fs/10'),
    credits: art('perk/credits/25000'),
  },
};

const template = readFileSync(join(ROOT, 'tools/menu-concepts.html'), 'utf8');
if (!template.includes('/*DATA*/')) throw new Error('в шаблоне нет метки /*DATA*/');
const out = template.replace('/*DATA*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/menu-concepts.html'), out);
console.log(`dist/menu-concepts.html: ${(out.length / 1024).toFixed(0)} КБ`);
