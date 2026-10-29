/**
 * Казино: протокол агрегатора Databetrix.
 *
 * Здесь всё, что говорит с агрегатором: каталог, запуск игры, обложки.
 * Деньги здесь не меняются - кошелёк лежит в casino-db.js, а HTTP-ручки в
 * app.js. Документация агрегатора разобрана в CLAUDE.md, раздел «Казино».
 *
 * Сеть агрегатора ненадёжна: API и CDN обложек рвут соединение через раз.
 * Поэтому каждый запрос с повтором, каталог хранится у нас, а обложки
 * кешируются на диске.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { saveCatalog, catalogStats, setCoverState, gamesWithoutCoverState, gamesWithoutCover } from './casino-db.js';
import { alert } from './ops.js';

/* ---------- Настройки ---------- */

export function casinoEnv() {
  return {
    base: (process.env.DATABETRIX_BASE_URL || 'https://api.game.databetrix.com').replace(/\/+$/, ''),
    agent: process.env.DATABETRIX_AGENT_NAME || '',
    token: process.env.DATABETRIX_AGENT_TOKEN || '',
    // Валюта кошелька. Баланс игроков в рублях, другой здесь быть не может.
    currency: 'RUB',
    // Страна для запуска обязательна по правилам агрегатора. Браузер её не
    // сообщает, а Cloudflare, если стоит перед сервером, сообщает заголовком.
    country: process.env.CASINO_COUNTRY || 'RU',
    // Адреса серверов агрегатора, с которых приходят вызовы кошелька. Список
    // из их документации; пустая строка в окружении выключает проверку
    // (только для локальной разработки).
    callbackIps: (process.env.CASINO_CALLBACK_IPS ?? '51.20.178.99,51.20.217.36')
      .split(',').map((s) => s.trim()).filter(Boolean),
    syncHours: Number(process.env.CASINO_SYNC_HOURS || 6),
  };
}

export const casinoConfigured = () => {
  const e = casinoEnv();
  return Boolean(e.agent && e.token);
};

const RETRIES = 4;
const TIMEOUT_MS = 40_000;

async function request(path, { method = 'GET', body, retries = RETRIES } = {}) {
  const env = casinoEnv();
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${env.base}${path}`, {
        method,
        headers: {
          'x-agent-name': env.agent,
          'x-agent-token': env.token,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }
      // Ответ с кодом - это ответ, а не сбой сети: повторять его бесполезно.
      return { status: res.status, data };
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw Object.assign(new Error(`Агрегатор не отвечает: ${last?.message || 'сеть'}`), { code: 'CASINO_DOWN' });
}

/* ---------- Каталог ---------- */

const PAGE = 500;

/*
 * Источник, у которого отдача настраивается. Агрегатор применяет minRtp и
 * maxRtp только к играм Sloter (их документация, «Start game»).
 *
 * СЛОТЫ И БЫСТРЫЕ ИГРЫ БЕРУТСЯ ТОЛЬКО ИЗ НЕГО. Это условие договора
 * заказчика с партнёром: на играх с настраиваемой отдачей ставка партнёра
 * ниже, на остальных выше и невыгодно. Pragmatic Play приходит ещё и через
 * NovaPlay (627 игр, из них 88 только там) - эти в лобби не попадают.
 *
 * Живое казино - исключение: у живых столов отдачу задаёт провайдер у
 * всех, и заказчик берёт их такими.
 */
const RTP_SOURCE = 'Sloter';

/*
 * Провайдеры, которые партнёр реально открыл агенту. Каталог отдаёт больше:
 * часть провайдеров у них в тесте, и запуск такой игры падает. Список
 * прислан партнёром (октябрь 2026); сверка без учёта регистра - в нём
 * «Sloter-slot-Belatra», а в каталоге «Sloter-slot-belatra».
 *
 * Живое казино (NovaPlay: Pragmatic Play Live и Evolution) партнёр открыл
 * отдельно: «We have also casino live, Ppl + evolution». У живых столов
 * отдачу задаёт провайдер, наша настройка к ним не применяется, и лобби
 * пишет «по правилам провайдера», а не наше число.
 */
const DEFAULT_PROVIDERS = [
  'Sloter-slot-3oaks', 'Sloter-slot-amatic', 'Sloter-slot-amigo', 'Sloter-slot-amusnet',
  'Sloter-slot-backseat', 'Sloter-slot-booming', 'Sloter-slot-croco', 'Sloter-slot-egt',
  'Sloter-slot-egt_VIP', 'Sloter-slot-elk', 'Sloter-slot-greentube', 'Sloter-slot-habanero',
  'Sloter-slot-hacksaw', 'Sloter-slot-ka', 'Sloter-slot-kajot', 'Sloter-slot-netent',
  'Sloter-slot-nolimitcity', 'Sloter-slot-pateplay', 'Sloter-slot-playngo', 'Sloter-slot-playson',
  'Sloter-slot-playtech', 'Sloter-slot-pragmatic', 'Sloter-slot-push', 'Sloter-slot-rubyplay',
  'Sloter-mini-spribe', 'Sloter-slot-igt', 'Sloter-slot-fazi', 'Sloter-slot-zitro',
  'Sloter-slot-merkur', 'Sloter-slot-yggdrasil', 'Sloter-slot-tomhorn', 'Sloter-slot-platipus',
  'Sloter-slot-Belatra', 'Sloter-slot-Relax',
  'NovaPlay-pragmatic-play-live-np', 'NovaPlay-evolution-sp',
];

export function allowedProviders() {
  const env = process.env.CASINO_PROVIDERS;
  const list = env ? env.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PROVIDERS;
  return new Set(list.map((s) => s.toLowerCase()));
}
const SOURCE_PRIORITY = { [RTP_SOURCE]: 0 };

/* Спорт заказчику не нужен: ни вкладки, ни игр из его каталога. */
function isSport(g, provider) {
  return g.gameType === 2 || /sport/i.test(g.providerId) || /sport/i.test(provider?.name || '');
}

function kindOf(g) {
  if (g.gameType === 1) return 'live';
  // Spribe - быстрые игры: Aviator, Mines, Plinko. Среди слотов они теряются.
  if (/-mini-/i.test(g.providerId)) return 'fast';
  return 'slots';
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9а-яё]+/g, '');

/*
 * Порядок провайдеров в «популярном»: сначала те, кого ищут по имени.
 * Остальные идут после них по числу игр.
 */
const PROVIDER_ORDER = [
  'pragmatic play', 'hacksaw', 'nolimitcity', 'playngo', 'spribe gaming', 'evolution',
  'pragmatic play live', 'netent', 'relax', 'push', 'elk', 'egt', 'amusnet', 'playson',
  'booming', 'habanero', 'yggdrasil', 'playtech', 'greentube', 'igt', 'rubyplay', '3 oaks gaming',
];

/*
 * Стартовый список хитов. API популярности не отдаёт, а лобби в алфавитном
 * порядке начиналось бы с «100 Burning Hot». Это известные всем игры по
 * провайдерам; по мере ставок порядок сменит настоящий спрос (см.
 * casinoGames в casino-db.js). Совпадение по имени без пробелов и знаков:
 * в каталоге «Tombstone R.I.P», а не «Tombstone RIP».
 */
const HITS = [
  'Gates of Olympus', 'Sweet Bonanza', 'Aviator', 'Sugar Rush', 'Starlight Princess',
  'The Dog House', 'Big Bass Bonanza', 'Wanted Dead or a Wild', 'Le Bandit', 'Mental',
  'Gates of Olympus 1000', 'Sweet Bonanza 1000', 'Sugar Rush 1000', 'Starlight Princess 1000',
  'Chaos Crew', 'San Quentin xWays', 'Tombstone RIP', 'Fire in the Hole', 'Legacy of Dead',
  'Reactoonz', 'Rise of Olympus', 'Mines', 'Plinko', 'Crazy Time', 'Lightning Roulette',
  'Monopoly Live', 'Sweet Bonanza CandyLand', 'Mega Wheel', 'PowerUP Roulette', 'Funky Time',
  'Starburst', "Gonzo's Quest", 'Dead or Alive', 'Book of Ra Deluxe', 'Sizzling Hot Deluxe',
  '40 Super Hot', 'Shining Crown', 'Burning Hot', 'Wolf Gold', 'Fruit Party', 'Wild West Gold',
  'Floating Dragon', 'Madame Destiny Megaways', 'Zeus vs Hades - Gods of War', 'Big Bass Splash',
  'Money Train 2', 'Money Train 4', "Jammin' Jars", 'Dork Unit', 'Hand of Anubis',
  'Book of Fallen', 'Buffalo King Megaways', 'Great Rhino Megaways', 'Release the Kraken',
  'Gems Bonanza', 'Mega Roulette', 'Lightning Blackjack', 'XXXtreme Lightning Roulette',
  'Gold Vault Roulette', 'Infinite Blackjack', 'Balloon', 'Dice', 'Hilo', 'Keno', 'Pirots',
  'Pirots 2', 'Le Pharaoh', 'Duel at Dawn', 'Twin Spin', 'Divine Fortune Gold', 'Hot Fiesta',
  'Extra Juicy', 'Big Bass Bonanza Megaways', 'Wisdom of Athena', 'Fortune of Olympus',
  "Joker's Jewels", '5 Lions Megaways', 'Mustang Gold', 'Hot to Burn', 'Great Rhino',
];

/**
 * Превращает сырой каталог агрегатора в наши строки.
 *
 * Чистая функция, без сети: её же зовёт тест и автономная сборка.
 */
export function buildCatalog(rawGames, rawProviders, allowed = allowedProviders(), storefront = {}) {
  // Списки витрины агрегатора: код игры «gameCode:::vendorCode» -> место.
  const topRank = new Map((storefront.top || []).map((code, i) => [code, i]));
  const isNew = new Set(storefront.new || []);
  const provById = new Map(rawProviders.map((p) => [p.id, p]));

  // Провайдер для игрока - бренд и вкладка, а не источник: два «Pragmatic
  // Play» из Sloter и NovaPlay в списке провайдеров - один бренд.
  const brandOf = (g) => {
    const p = provById.get(g.providerId);
    const name = p?.name || g.provider?.name || g.providerId;
    const kind = kindOf(g);
    const base = slug(name);
    // Вкладка в id - чтобы слоты и живые столы одного бренда не слиплись;
    // «pragmatic-play-live» уже говорит о себе сам, второй «-live» не нужен.
    const id = kind === 'slots' || base.endsWith(`-${kind}`) ? base : `${base}-${kind}`;
    return { id, name: name.replace(/^platipus$/i, 'Platipus').replace(/^fazi$/i, 'Fazi'), kind };
  };

  const candidates = [];
  for (const g of rawGames) {
    const p = provById.get(g.providerId);
    if (!allowed.has(String(g.providerId).toLowerCase())) continue;
    if (isSport(g, p)) continue;
    if (g.isActive === false) continue;
    if (kindOf(g) !== 'live' && g.gameSource !== RTP_SOURCE) continue;
    if (!g.img && !g.imgVertical) continue;
    candidates.push({ g, brand: brandOf(g) });
  }

  // Один экземпляр игры на бренд: если одна игра пришла из двух источников,
  // остаётся источник с настраиваемой отдачей.
  const byKey = new Map();
  for (const c of candidates) {
    const key = `${c.brand.id}|${nameKey(c.g.name)}`;
    const prev = byKey.get(key);
    const rank = SOURCE_PRIORITY[c.g.gameSource] ?? 9;
    if (!prev || rank < (SOURCE_PRIORITY[prev.g.gameSource] ?? 9)) byKey.set(key, c);
  }
  const kept = [...byKey.values()];

  // Провайдеры: порядок популярных, затем по числу игр.
  const brands = new Map();
  for (const { brand } of kept) {
    const b = brands.get(brand.id) || { ...brand, count: 0 };
    b.count++;
    brands.set(brand.id, b);
  }
  const orderOf = (name) => {
    const i = PROVIDER_ORDER.indexOf(name.toLowerCase());
    return i === -1 ? PROVIDER_ORDER.length : i;
  };
  const providerList = [...brands.values()]
    .sort((a, b) => orderOf(a.name) - orderOf(b.name) || b.count - a.count || a.name.localeCompare(b.name))
    .map((b, i) => ({ id: b.id, name: b.name, source: 'mixed', kind: b.kind, game_count: b.count, sort: i }));
  const providerSort = new Map(providerList.map((p) => [p.id, p.sort]));

  /*
   * Стартовый ранг. Хиты - по своему месту в списке. Остальные идут
   * «по кругу» провайдеров: первая игра каждого, потом вторая... Иначе за
   * хитами шли бы 674 игры Pragmatic подряд, и до остальных никто бы не
   * долистал.
   */
  const hitRank = new Map(HITS.map((n, i) => [nameKey(n), i]));
  const queues = new Map();
  for (const c of kept.sort((a, b) => a.g.name.localeCompare(b.g.name))) {
    if (hitRank.has(nameKey(c.g.name))) continue;
    const q = queues.get(c.brand.id) || [];
    q.push(c);
    queues.set(c.brand.id, q);
  }
  const ordered = [...queues.entries()].sort((a, b) => providerSort.get(a[0]) - providerSort.get(b[0]));
  const roundRobin = new Map();
  let n = 0;
  for (let depth = 0; ; depth++) {
    let any = false;
    for (const [, q] of ordered) {
      if (depth < q.length) { roundRobin.set(q[depth], n++); any = true; }
    }
    if (!any) break;
  }

  const games = kept.map((c) => {
    const { g, brand } = c;
    const hit = hitRank.get(nameKey(g.name));
    return {
      id: String(g.id),
      name: String(g.name),
      provider_id: brand.id,
      provider_name: brand.name,
      source: String(g.gameSource || ''),
      kind: brand.kind,
      img: g.img || null,
      img_vertical: g.imgVertical || null,
      img_wide: g.imgWide || null,
      demo: g.demo ? 1 : 0,
      freespin: g.isFreespin ? 1 : 0,
      buybonus: g.isBuybonus ? 1 : 0,
      jackpot: g.isJackpot ? 1 : 0,
      // Отдачу из нашей настройки агрегатор применяет только к играм Sloter.
      rtp_mode: g.gameSource === RTP_SOURCE ? 'operator' : 'provider',
      seed_rank: hit !== undefined ? hit : HITS.length + (roundRobin.get(c) ?? 0),
      original_id: g.originalId ? String(g.originalId) : null,
      partner_top: topRank.has(g.originalId) ? topRank.get(g.originalId) : null,
      partner_new: isNew.has(g.originalId) ? 1 : 0,
    };
  });

  return { providers: providerList, games };
}

/*
 * Витрина агрегатора (betinovioslots): у неё есть списки «топ» и «новинки»
 * по провайдерам. Это их данные о спросе и релизах, а не наша оценка, поэтому
 * ими дополняется порядок «Популярных» и блок «Новинки». Ручка витрины не
 * описана в документации агрегатора: не ответила - живём без неё, каталог
 * от этого не страдает.
 */
export async function storefrontLists() {
  const base = (process.env.CASINO_STOREFRONT_URL || 'https://api.betinovioslots.net').replace(/\/+$/, '');
  const agentCode = process.env.CASINO_STOREFRONT_AGENT || 'multitest';
  const out = { top: [], new: [] };
  for (const [key, method] of [['top', 'GetTopGames'], ['new', 'GetNewGames']]) {
    try {
      const res = await fetch(`${base}/backend/unauthorizeapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, agentCode }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json();
      if (data?.status === 0 && Array.isArray(data.vendorGames)) {
        // В каталоге агрегатора originalId - «код игры:::код провайдера».
        out[key] = data.vendorGames.map((v) => `${v.gameCode}:::${v.vendorCode}`);
      }
    } catch { /* витрина молчит - списков нет */ }
  }
  return out;
}

let syncing = null;
let lastSync = { at: 0, ok: null, message: '', games: 0 };

/** Синхронизация каталога. Параллельный вызов ждёт уже идущую. */
export function syncCatalog() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const raw = [];
      for (let offset = 0; ; offset += PAGE) {
        const { status, data } = await request(`/api/game/get-games?offset=${offset}&length=${PAGE}`);
        if (status !== 200 || !Array.isArray(data?.items)) throw new Error(`get-games: ${status} ${data?.message || ''}`);
        raw.push(...data.items);
        if (raw.length >= data.total || !data.items.length) break;
      }
      const { status, data: providers } = await request('/api/game/get-providers');
      if (status !== 200 || !Array.isArray(providers)) throw new Error(`get-providers: ${status}`);

      const built = buildCatalog(raw, providers, allowedProviders(), await storefrontLists());
      // Пустой ответ - сбой агрегатора, а не «все игры убрали»: не гасим лобби.
      if (!built.games.length) throw new Error('агрегатор вернул пустой каталог');
      saveCatalog(built.providers, built.games);
      lastSync = { at: Date.now(), ok: true, message: '', games: built.games.length };
      checkCoversInBackground();
    } catch (err) {
      console.error('[casino] синхронизация каталога:', err.message);
      alert('casino:sync', `Казино: каталог игр не обновился (${err.message}). Лобби работает на прежнем каталоге.`);
      // Агрегатор лежит при первом же старте - лобби не должно быть пустым:
      // поднимаем снимок. Старый каталог в базе при сбое не трогаем.
      if (!catalogStats().games && existsSync(SNAPSHOT_PATH)) {
        console.log(`[casino] каталог из снимка, игр ${loadSnapshot()}`);
      }
      lastSync = { at: Date.now(), ok: false, message: err.message, games: catalogStats().games };
    } finally {
      syncing = null;
    }
    return lastSync;
  })();
  return syncing;
}

export const syncStatus = () => ({ ...lastSync, running: Boolean(syncing), ...catalogStats() });

/*
 * Снимок каталога в репозитории (tools/casino-snapshot.mjs). На нём
 * работают разработка, тесты и автономная сборка: без ключа агрегатора и
 * без сети лобби иначе было бы пустым, и проверять было бы нечего.
 */
export const SNAPSHOT_PATH = new URL('./casino-catalog.json', import.meta.url);

export function loadSnapshot() {
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  saveCatalog(snap.providers, snap.games);
  return snap.games.length;
}

/**
 * Каталог при старте: с ключами - синхронизация сейчас и затем по
 * расписанию; без ключей - снимок из репозитория, если в базе пусто.
 */
export function startCatalogSync() {
  if (!casinoConfigured()) {
    if (!catalogStats().games && existsSync(SNAPSHOT_PATH)) {
      console.log(`[casino] ключей агрегатора нет: каталог из снимка, игр ${loadSnapshot()}`);
    }
    return;
  }
  // Проверка обложек, прерванная перезапуском, продолжается с того же места.
  checkCoversInBackground();
  const hours = Math.max(1, casinoEnv().syncHours);
  syncCatalog();
  setInterval(syncCatalog, hours * 3600 * 1000).unref();
}

/* ---------- Запуск игры ---------- */

/**
 * Открывает игровую сессию. Возвращает { url } или { html }.
 *
 * Отдача (minRtp = maxRtp) передаётся только играм Sloter: остальным
 * агрегатор её не применяет, и передавать её туда значило бы делать вид,
 * что она там что-то значит.
 */
export async function launchGame({ game, playerId, demo, ip, country, rtp, lobbyUrl, language = 'ru' }) {
  const env = casinoEnv();
  const body = {
    userId: playerId,
    gameId: game.id,
    language,
    currency: env.currency,
    ip: ip || '',
    country: country || env.country,
    demo: Boolean(demo),
  };
  if (game.rtp_mode === 'operator' && rtp > 0) { body.minRtp = rtp; body.maxRtp = rtp; }
  if (lobbyUrl) { body.lobbyURL = lobbyUrl; body.originURL = lobbyUrl; }

  const { status, data } = await request('/api/game/start-game', { method: 'POST', body, retries: 2 });
  if (status === 200 && data && data.statusCode === 0 && (data.url || data.htmlContent)) {
    return { ok: true, url: data.url || null, html: data.htmlContent || null };
  }
  return { ok: false, status, message: data?.message || `код ${status}` };
}

/* ---------- Обложки ---------- */

/*
 * Плитка на телефоне занимает ~115 точек при тройной плотности, на
 * компьютере ~165 при двойной. 330 пикселей хватает обоим, а вертикальная
 * обложка у части провайдеров 590x790 и весит до 100 КБ: сорок восемь таких
 * на странице - мегабайты на мобильном интернете.
 */
const COVER_WIDTH = 330;
// У декоративных обложек свой бюджет ожидания: таймаут API запуска игры
// (40 с × 4) не должен держать соединения браузера несколько минут.
const COVER_TIMEOUT_MS = 8000;
const COVER_RETRIES = 2;
const COVER_QUALITY = 78;
// Путь абсолютный, как у самой базы в db.js: res.sendFile относительный не
// принимает, а DB_PATH в .env.example относительный (./data/app.db), и каждая
// обложка казино отвечала бы 500.
const coverDir = () => join(dirname(resolve(process.env.DB_PATH || './data/app.db')), 'casino-covers');

let sharpLib;
async function sharp() {
  if (sharpLib === undefined) {
    try { sharpLib = (await import('sharp')).default; } catch { sharpLib = null; }
  }
  return sharpLib;
}

const inflight = new Map();

/**
 * Файл обложки игры: из кеша или скачанный, пережатый и сохранённый.
 * Возвращает { file } или { redirect }, или null, если обложку взять неоткуда.
 *
 * Имя файла - хеш адреса картинки, а не id игры: агрегатор меняет обложку,
 * не меняя id, и кеш по id показывал бы старую вечно.
 */
export async function coverFile(game) {
  const src = game.img_vertical || game.img;
  if (!src) return null;
  const vertical = Boolean(game.img_vertical);
  // Без sharp пережимать нечем: отдаём исходный адрес, браузер возьмёт с CDN.
  if (!(await sharp())) return { redirect: src, vertical };
  const hash = createHash('sha1').update(src).digest('hex').slice(0, 20);
  const dir = coverDir();
  const file = join(dir, `${hash}.webp`);
  if (existsSync(file)) return { file, vertical };
  if (inflight.has(file)) return inflight.get(file);

  const job = (async () => {
    let last;
    for (let i = 0; i < COVER_RETRIES; i++) {
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
        // Файла нет на CDN - повторять незачем: ответ будет тот же, а игрок
        // всё это время смотрит на пустую плитку.
        if (res.status === 404 || res.status === 410) return { missing: true, vertical };
        if (!res.ok) throw new Error(`обложка ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const out = await (await sharp())(buf)
          .resize({ width: COVER_WIDTH, withoutEnlargement: true })
          .webp({ quality: COVER_QUALITY })
          .toBuffer();
        mkdirSync(dir, { recursive: true });
        // Через временный файл: оборванная запись не должна стать кешем.
        writeFileSync(`${file}.tmp`, out);
        renameSync(`${file}.tmp`, file);
        return { file, vertical };
      } catch (err) {
        last = err;
        if (i + 1 < COVER_RETRIES) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    console.error('[casino] обложка', game.id, last?.message);
    return null;
  })().finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

export const readCover = (file) => readFileSync(file);

/*
 * ПРОВЕРКА ОБЛОЖЕК. Часть картинок каталога на CDN агрегатора отсутствует
 * (у Tomhorn и Zitro десятки: адрес есть, файл отвечает 404), и на плитке
 * вместо обложки вставал знак вопроса. Проверка ставит игре признак:
 *   'v' - вертикальная обложка есть;
 *   'w' - вертикальной нет или она не грузится, есть горизонтальная;
 *   'x' - не грузится ни одна.
 * По признаку лобби ставит игры с настоящей обложкой вперёд, а без неё -
 * в конец списка, и клиент не просит картинку, которой нет.
 *
 * Сетевой сбой - не приговор: признак ставится только по ответу сервера
 * (4xx), иначе игра на минуту недоступного CDN навсегда ушла бы в конец.
 */
export const COVER_PROBE_CONCURRENCY = 16;
const PROBE_TIMEOUT_MS = 20_000;

async function coverAlive(url) {
  if (!url) return false;
  for (let i = 0; i < 2; i++) {
    try {
      let res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      // Не все CDN отвечают на HEAD: тогда спрашиваем сам файл.
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        await res.arrayBuffer().catch(() => {});
      }
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) return false;
    } catch { /* сбой сети - попробуем ещё раз */ }
  }
  return null;
}

/** Признак обложки одной игры или null, если CDN не ответил. */
export async function probeCover(game) {
  if (game.img_vertical) {
    const v = await coverAlive(game.img_vertical);
    if (v) return 'v';
    if (v === null) return null;
  }
  const w = await coverAlive(game.img);
  if (w === null) return null;
  return w ? 'w' : 'x';
}

/*
 * Фоновая проверка после синхронизации: только игры без признака, пачками,
 * тихо (BACKGROUND_PROBE_CONCURRENCY запросов разом) - CDN агрегатора общий
 * с игроками, и проверка не должна отнимать у них скорость.
 */
const BACKGROUND_PROBE_CONCURRENCY = 4;
const BACKGROUND_PROBE_BATCH = 200;
let probing = null;

export function checkCoversInBackground() {
  if (probing || process.env.CASINO_COVER_PROBE === '0') return probing;
  probing = (async () => {
    let checked = 0;
    for (;;) {
      const batch = gamesWithoutCoverState(BACKGROUND_PROBE_BATCH);
      let known = 0;
      await probeCovers(batch, (g, state) => { if (state) { setCoverState(g.id, state); known++; } },
        BACKGROUND_PROBE_CONCURRENCY);
      checked += known;
      // Пачка без единого ответа - CDN недоступен: остальное в следующий раз.
      if (batch.length < BACKGROUND_PROBE_BATCH || known === 0) break;
    }
    // Скрытые за отсутствие обложки - одним проходом: выложат картинку,
    // и игра вернётся в лобби сама, к ближайшей синхронизации.
    await probeCovers(gamesWithoutCover(), (g, state) => { if (state && state !== 'x') setCoverState(g.id, state); },
      BACKGROUND_PROBE_CONCURRENCY);
    if (checked) console.log(`[casino] проверено обложек: ${checked}`);
  })().catch((err) => console.error('[casino] проверка обложек:', err.message))
    .finally(() => { probing = null; });
  return probing;
}

/** Проверяет игры пачкой; onResult(game, state) зовётся по мере ответов. */
export async function probeCovers(games, onResult, concurrency = COVER_PROBE_CONCURRENCY) {
  let next = 0;
  const worker = async () => {
    while (next < games.length) {
      const g = games[next++];
      onResult(g, await probeCover(g));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, worker));
}
