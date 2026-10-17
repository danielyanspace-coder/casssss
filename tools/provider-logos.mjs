/**
 * Логотипы провайдеров для раздела «Казино» -> «Провайдеры».
 *
 *   NODE_USE_ENV_PROXY=1 node tools/provider-logos.mjs
 *     ->  public/assets/ui/prov-<id>.webp и public/provider-logos.js
 *
 * Агрегатор логотипов не отдаёт: у всех провайдеров logoUrl пустой, и их
 * витрина тоже без логотипов. Поэтому каждый знак взят с ОФИЦИАЛЬНОГО сайта
 * провайдера, из шапки, - адрес записан рядом, чтобы любой знак можно было
 * перепроверить и обновить. Где официального знака найти не удалось
 * (сайт закрыт проверкой на робота или знак нарисован в разметке без
 * отдельного файла), лобби ставит название провайдера текстом, а не чужую
 * картинку из случайного каталога.
 *
 * Знаки приводятся к одному виду: обрезаются пустые поля, высота одинаковая.
 * mode 'mono' - знак с тёмной надписью: на тёмной плитке он не читается,
 * поэтому перекрашивается в белый по своей же прозрачности.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/ui');
const HEIGHT = 96;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/*
 * id - это id провайдера в нашем каталоге (casino.js -> buildCatalog).
 * inline - знак нарисован прямо в разметке страницы: берём первый <svg> с
 * logo в классе или подписи.
 */
const SOURCES = {
  'pragmatic-play': { url: 'https://www.pragmaticplay.com/wp-content/themes/gp-theme-basic/libs/dist/images/PP-white-logo.svg' },
  'pragmatic-play-live': { url: 'https://www.pragmaticplay.com/wp-content/themes/gp-theme-basic/libs/dist/images/PP-white-logo.svg' },
  hacksaw: { inline: 'https://www.hacksawgaming.com/', mode: 'mono', viewBox: '0 0 1400 800' },
  nolimitcity: { url: 'https://fan-cdn.nolimitcity.com/NLC_Logo_08_f398e35f72.svg', mode: 'mono' },
  playngo: { url: 'https://www.playngo.com/assets/site/brand/playngo-logo.webp' },
  relax: { url: 'https://www.relax-gaming.com/static/img/logo.svg' },
  amusnet: { url: 'https://www.amusnet.com/_next/static/media/Logo-Amusnet.fcd267bb.svg' },
  booming: { url: 'https://strapi-dev.booming-games.com/15/logo_36bdb913dd.svg', mode: 'mono' },
  habanero: { inline: 'https://habanerosystems.com/', mode: 'mono' },
  yggdrasil: { url: 'https://yggdrasilgaming.com/w/files/2022/02/logo-header.svg', mode: 'mono' },
  playtech: { url: 'https://www.playtech.com/app/uploads/2023/08/logo-asset.svg' },
  greentube: { url: 'https://b2b-assets.greentube.com/wp-content/themes/greentube/src/img/greentube-logo.svg' },
  igt: { url: 'https://www.igt.com/igtsitecore/images/IGT-Logo-Purple-grd-RGB.png' },
  rubyplay: { url: 'https://rubyplay.com/wp-content/uploads/2024/12/rubyplay_logo_02_colour_alt.svg', mode: 'mono' },
  amigo: { url: 'https://amigogaming.com/image/layout/logo.svg' },
  merkur: { url: 'https://merkur-gaming.com/medien/mswlogo-negativ.svg' },
  kajot: { url: 'https://kajotgames.com/wp-content/uploads/Kajot-Games-logo.svg' },
  // Знак на чёрной подложке: подложка снимается по яркости.
  belatra: { url: 'https://belatragames.com/images/logo-168.gif', mode: 'keyDark' },
  tomhorn: { url: 'https://www.tomhorngaming.com/site/templates/images/logo.png' },
  // PatePlay: на сайте только значок на белом квадрате, без названия -
  // в плитке он не узнаётся, поэтому у PatePlay название текстом.
  backseat: { url: 'https://backseatgaming.com/wp-content/themes/backseat/public/images/logo.7480da.svg' },
  zitro: { url: 'https://zitrogames.com/wp-content/uploads/2021/09/LOGO_Zitro.png' },
  'evolution-live': { url: 'https://cdn.evolution.com/uploads/evolution_logo_full_white_60f6ca525e.svg' },
};

async function get(url) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      last = new Error(`${res.status} ${url}`);
    } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw last;
}

async function source(spec) {
  if (spec.inline) {
    const html = await (await get(spec.inline)).text();
    const m = html.match(/<svg[^>]*(?:class|aria-label|id)=["'][^"']*logo[^"']*["'][\s\S]*?<\/svg>/i);
    if (!m) throw new Error('на странице нет знака');
    let svg = m[0].includes('xmlns') ? m[0] : m[0].replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    // Цвет знака на сайте задают их стили, которых здесь нет: currentColor
    // и fill="none" с классом остались бы чёрными или пустыми. Задаём белый.
    svg = svg.replace('<svg', '<svg color="#ffffff"').replace(/fill="none"/g, 'fill="#ffffff"');
    // У Hacksaw контур выходит за собственный viewBox: расширяем область, а
    // лишнее поле срежет trim в normalize.
    if (spec.viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${spec.viewBox}"`).replace(/\s(width|height)="[^"]*"/g, '');
    return Buffer.from(svg);
  }
  return Buffer.from(await (await get(spec.url)).arrayBuffer());
}

async function normalize(buf, mode) {
  // Векторный знак рисуется крупно, потом сжимается: так края чистые.
  let img = sharp(buf, { density: 600 }).ensureAlpha().trim();
  img = sharp(await img.png().toBuffer()).resize({ height: HEIGHT, withoutEnlargement: false });
  if (mode === 'keyDark') {
    // Почти чёрные точки становятся прозрачными, остальное как было.
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] < 90) data[i + 3] = 0;
    }
    img = sharp(data, { raw: info });
  }
  if (mode === 'mono') {
    // Белый знак по собственной прозрачности: цвет уходит, форма остаётся.
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
    img = sharp(data, { raw: info });
  }
  return img.webp({ quality: 90, alphaQuality: 100 }).toBuffer();
}

mkdirSync(OUT_DIR, { recursive: true });
const done = {};
for (const [id, spec] of Object.entries(SOURCES)) {
  if (!spec) continue;
  try {
    const out = await normalize(await source(spec), spec.mode);
    writeFileSync(join(OUT_DIR, `prov-${id}.webp`), out);
    done[id] = `/assets/ui/prov-${id}.webp`;
    console.log('ok', id, `${(out.length / 1024).toFixed(1)} КБ`);
  } catch (err) {
    console.log('нет', id, err.message);
  }
}

/*
 * Карта для клиента. Пути целиком, с ведущим слешем: автономная сборка
 * подставляет файл вместо строки /assets/ui/<имя>.webp и склеенный из кусков
 * путь не увидела бы.
 */
const lines = Object.entries(done).map(([id, p]) => `  '${id}': '${p}',`).join('\n');
writeFileSync(join(ROOT, 'public/provider-logos.js'), `/**
 * Логотипы провайдеров казино. Файл собирает tools/provider-logos.mjs - не
 * правьте руками: источник каждого знака записан там.
 *
 * Провайдера, которого здесь нет, лобби показывает названием текстом.
 */
export const PROVIDER_LOGOS = {
${lines}
};
`);
console.log(`логотипов: ${Object.keys(done).length}`);
