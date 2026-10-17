/**
 * Лобби провайдера в разделе «Казино» - макет на согласование.
 *
 *   DATABETRIX_AGENT_NAME=... DATABETRIX_AGENT_TOKEN=... \
 *   NODE_USE_ENV_PROXY=1 node tools/casino-concept.mjs   ->  dist/casino-concept.html
 *
 * Обложки и названия настоящие: берутся из каталога агрегатора той же ручкой
 * get-games, которой будет пользоваться рабочий раздел. Картинки вкладываются
 * в файл, потому что макет открывают с телефона, а CDN агрегатора отвечает
 * через раз.
 *
 * Ключ агента читается только из окружения и в файл не попадает: макет
 * пересылают, а ключ даёт доступ к запуску игр за деньги.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.DATABETRIX_BASE_URL || 'https://api.game.databetrix.com';
const AGENT = process.env.DATABETRIX_AGENT_NAME;
const TOKEN = process.env.DATABETRIX_AGENT_TOKEN;
if (!AGENT || !TOKEN) throw new Error('нужны DATABETRIX_AGENT_NAME и DATABETRIX_AGENT_TOKEN');

const PROVIDER = 'Sloter-slot-pragmatic';
// Отдача, которую заказчик выставит в панели агрегатора. В рабочем разделе
// она придёт из настройки, здесь стоит то же число, чтобы плашка была видна.
const RTP_LABEL = 70;
const PAGE = 500;
const RETRIES = 4;

/*
 * Порядок - «популярные» для макета. Последняя игра выбрана намеренно без
 * вертикальной обложки: так видно, как плитка выглядит с запасной
 * горизонтальной картинкой.
 */
const PICK = [
  'Gates of Olympus', 'Sweet Bonanza', 'Sugar Rush', 'The Dog House',
  'Big Bass Bonanza', 'Starlight Princess', 'Wolf Gold', 'Fruit Party',
  'Gates of Olympus 1000', 'Floating Dragon', 'Wild West Gold', '5 Rabbits Megaways',
];
const FORMATS_OF = 'Gates of Olympus';

/* CDN агрегатора рвёт соединение через раз: повторяем, а не падаем. */
async function get(url, init = {}) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(40_000) });
      if (res.ok) return res;
      last = new Error(`${res.status} ${url}`);
    } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw last;
}

const headers = { 'x-agent-name': AGENT, 'x-agent-token': TOKEN };

async function catalog() {
  const games = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await (await get(`${BASE}/api/game/get-games?offset=${offset}&length=${PAGE}`, { headers })).json();
    games.push(...page.items);
    if (games.length >= page.total || !page.items.length) return games;
  }
}

const MIME = { avif: 'image/avif', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

async function dataUri(url) {
  const buf = Buffer.from(await (await get(url)).arrayBuffer());
  const ext = (url.match(/\.(\w+)(?:\?|$)/) || [])[1]?.toLowerCase();
  return { uri: `data:${MIME[ext] || 'image/webp'};base64,${buf.toString('base64')}`, kb: Math.round(buf.length / 1024), ext };
}

const games = await catalog();
const providers = await (await get(`${BASE}/api/game/get-providers`, { headers })).json();
const mine = games.filter((g) => g.providerId === PROVIDER);
const provider = providers.find((p) => p.id === PROVIDER);

const tiles = [];
for (const name of PICK) {
  const g = mine.find((x) => x.name === name);
  if (!g) throw new Error(`в каталоге нет «${name}»`);
  const art = await dataUri(g.imgVertical || g.img);
  const wide = g.imgWide ? (await dataUri(g.imgWide)).uri : null;
  tiles.push({
    name: g.name, cover: art.uri, vertical: !!g.imgVertical, wide,
    demo: g.demo, freespin: g.isFreespin, buybonus: g.isBuybonus,
  });
}

const sample = mine.find((x) => x.name === FORMATS_OF);
const formats = [];
for (const [field, label, use] of [
  ['imgVertical', 'Вертикальная', 'плитка в сетке'],
  ['img', 'Основная', 'запасная плитка'],
  ['imgSquare', 'Квадратная', 'не нужна: тяжёлая'],
  ['imgWide', 'Широкая', 'окно запуска, баннеры'],
]) {
  if (!sample[field]) continue;
  const f = await dataUri(sample[field]);
  formats.push({ field, label, use, ...f });
}

const coverage = (field) => Math.round((games.filter((g) => g[field]).length / games.length) * 100);

const data = {
  rtp: RTP_LABEL,
  provider: { name: provider.name, count: mine.length },
  tiles,
  formats,
  coverage: { vertical: coverage('imgVertical'), wide: coverage('imgWide'), square: coverage('imgSquare') },
  others: providers
    .filter((p) => p.id !== PROVIDER && p.gameCount > 0 && /slot/.test(p.id))
    .sort((a, b) => b.gameCount - a.gameCount)
    .slice(0, 14)
    .map((p) => ({ name: p.name, count: p.gameCount })),
};

const template = readFileSync(join(ROOT, 'tools/casino-concept.html'), 'utf8');
if (!template.includes('/*DATA*/')) throw new Error('в шаблоне нет метки /*DATA*/');
const out = template.replace('/*DATA*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/casino-concept.html'), out);
console.log(`dist/casino-concept.html: ${(out.length / 1024).toFixed(0)} КБ, плиток ${tiles.length}`);
