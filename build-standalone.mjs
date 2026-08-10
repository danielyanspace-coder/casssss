/**
 * Сборка автономной HTML-версии для просмотра без сервера.
 *
 * Файл собирается из ТЕХ ЖЕ исходников, что и рабочий проект: разметка,
 * стили, иконки, обложки и клиентский код берутся как есть, а таблицы кейсов
 * выгружаются из server/cases.js. Так демо не разъезжается с проектом при
 * правках — пересобрал и получил актуальную версию.
 *
 * Отличие одно: вместо сервера подставляется заглушка, которая перехватывает
 * fetch к /api/* и считает всё в браузере. Поэтому демо годится, чтобы
 * потыкать интерфейс, но НЕ является защищённой версией — в настоящей игре
 * исход считает сервер, и серверный seed игроку недоступен.
 *
 * Запуск: node build-standalone.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CASES, CATEGORIES, TIERS, publicCase } from './server/cases.js';
import { CRASH_CONFIG, ROULETTE_CONFIG, ROULETTE_WHEEL, GAMBLE_CONFIG } from './server/games.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ---------- Конфиг игры ---------- */

const config = {
  categories: CATEGORIES,
  cases: CASES.map(publicCase),
  tiers: TIERS,
  crash: {
    rtp: CRASH_CONFIG.rtp,
    maxMultiplier: CRASH_CONFIG.maxMultiplier,
    growth: CRASH_CONFIG.growth,
    edge: CRASH_CONFIG.edge,
  },
  roulette: {
    rtp: ROULETTE_CONFIG.rtp,
    slots: ROULETTE_CONFIG.slots,
    colors: ROULETTE_CONFIG.colors,
    wheel: ROULETTE_WHEEL,
  },
  gamble: {
    cards: GAMBLE_CONFIG.cards,
    aces: GAMBLE_CONFIG.aces,
    payout: GAMBLE_CONFIG.payout,
    chance: GAMBLE_CONFIG.chance,
    rtp: GAMBLE_CONFIG.rtp,
  },
  bonus: { enabled: false },
  maxBatch: 5,
  minPayout: 1000,
};

// Кумулятивные границы и плюшки нужны заглушке для розыгрыша, но в publicCase
// их нет — сервер не отдаёт их клиенту. Для демо добавляем.
const drawTables = CASES.map((c) => ({
  id: c.id,
  price: c.price,
  name: c.name,
  // Дата старта нужна и офлайн: иначе сезонный кейс, закрытый на сервере,
  // в автономной сборке открывался бы свободно.
  availableFrom: c.availableFrom,
  items: c.items.map((it) => ({
    id: it.id,
    name: it.name,
    kind: it.kind,
    value: it.value,
    tier: it.tier,
    perk: it.perk || null,
    perkLabel: it.perkLabel || null,
    cumulative: it.cumulative,
  })),
}));

/* ---------- Исходники клиента ---------- */

const heroData = readFileSync(new URL('./public/assets/hero.webp', import.meta.url)).toString('base64');
const porscheData = readFileSync(new URL('./public/assets/porsche.webp', import.meta.url)).toString('base64');

const css = read('./public/styles.css');
const html = read('./public/index.html');
const icons = read('./public/icons.js');
const covers = read('./public/covers.js');
const sounds = read('./public/sounds.js');
const legal = read('./public/legal.js');
const app = read('./public/app.js');

// Тело страницы без внешних подключений — всё уедет внутрь файла.
const body = html
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/<script[^>]*telegram[^>]*><\/script>/g, '')
  .replace(/<script[^>]*src="\/app\.js"[^>]*><\/script>/g, '')
  .replace(/<picture>[\s\S]*?<\/picture>/,
    () => `<img src="data:image/webp;base64,${heroData}" alt="Лучший проект Las Vegas 2026" class="hero-img">`);

// Модульный синтаксис снимаем: файл открывают с диска, а браузеры не грузят
// ES-модули по file:// — всё склеивается в один обычный скрипт.
const strip = (src) => src
  .replace(/^import[\s\S]*?from\s+'[^']*';\s*$/gm, '')
  .replace(/^export\s+/gm, '');

/* ---------- Заглушка сервера ---------- */

const shim = `
/* ============================================================
   ЗАГЛУШКА СЕРВЕРА ДЛЯ АВТОНОМНОЙ ВЕРСИИ
   Перехватывает fetch к /api/* и считает всё в браузере.
   В рабочем проекте это делает сервер.
   ============================================================ */

const DRAW = ${JSON.stringify(drawTables)};
const CONFIG = ${JSON.stringify(config)};
const DRAW_BY_ID = new Map(DRAW.map((c) => [c.id, c]));

/* ---------- SHA-256 и HMAC на чистом JS ----------
   Своя реализация, а не crypto.subtle: тот доступен только в защищённом
   контексте, и на file:// в части браузеров его просто нет. */

const K256 = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

function sha256Bytes(bytes) {
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const len = bytes.length;
  const withPad = new Uint8Array((((len + 9) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296));

  const w = new Uint32Array(64);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = (h[i] >>> 16) & 255;
    out[i * 4 + 2] = (h[i] >>> 8) & 255; out[i * 4 + 3] = h[i] & 255;
  }
  return out;
}

const enc = new TextEncoder();
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function sha256Hex(str) { return toHex(sha256Bytes(enc.encode(str))); }

function hmacSha256Hex(keyStr, msgStr) {
  let key = enc.encode(keyStr);
  if (key.length > 64) key = sha256Bytes(key);
  const pad = new Uint8Array(64);
  pad.set(key);
  const inner = new Uint8Array(64 + msgStr.length * 4);
  const msg = enc.encode(msgStr);
  const ipad = new Uint8Array(64 + msg.length);
  for (let i = 0; i < 64; i++) ipad[i] = pad[i] ^ 0x36;
  ipad.set(msg, 64);
  const innerHash = sha256Bytes(ipad);
  const opad = new Uint8Array(96);
  for (let i = 0; i < 64; i++) opad[i] = pad[i] ^ 0x5c;
  opad.set(innerHash, 64);
  return toHex(sha256Bytes(opad));
}

function computeRoll(serverSeed, clientSeed, nonce) {
  const h = hmacSha256Hex(serverSeed, clientSeed + ':' + nonce);
  return parseInt(h.slice(0, 8), 16) / 0x100000000;
}

const randHex = (n) => {
  const a = new Uint8Array(n);
  (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a)
    : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  return toHex(a);
};

/* ---------- Хранилище ---------- */

const STORE_KEY = 'luckybox-demo-v1';

function freshUser() {
  const serverSeed = randHex(32);
  return {
    id: 1, username: 'demo', firstName: 'Гость',
    balance: 5000,
    serverSeed, serverSeedHash: sha256Hex(serverSeed),
    clientSeed: randHex(8), nonce: 0,
    prevServerSeed: null, prevServerHash: null,
    x2CaseId: null, vouchers: {}, gambleStake: 0,
    deposits: [{ amount: 5000, source: 'start', comment: 'Стартовый баланс', created_at: Date.now() }],
    payouts: [],
    stats: { rounds: 0, spent: 0, won: 0, bestMultiplier: 0 },
    rounds: [],
    lastBonusAt: 0,
  };
}

/**
 * Демонстрационные игроки — чтобы в админке было на что смотреть.
 * Это выдуманные данные, а не чья-то реальная статистика.
 */
function demoPlayers() {
  const names = [
    ['demo_kirill', 'Кирилл'], ['demo_anna', 'Анна'], ['demo_pavel', 'Павел'],
    ['demo_sveta', 'Светлана'], ['demo_oleg', 'Олег'], ['demo_marina', 'Марина'],
    ['demo_ivan', 'Иван'],
  ];
  return names.map(([u, n], i) => {
    const spent = Math.round(20000 + Math.random() * 900000);
    const won = Math.round(spent * (0.82 + Math.random() * 0.28));
    return {
      id: i + 2, tg_id: String(50000000 + i * 137), username: u, first_name: n,
      balance: Math.round(Math.random() * 120000),
      total_rounds: Math.round(spent / 1500), total_spent: spent, total_won: won,
      best_multiplier: Number((2 + Math.random() * 40).toFixed(2)),
      is_admin: 0, is_blocked: i === 5 ? 1 : 0,
      created_at: Date.now() - Math.round(Math.random() * 40) * 86400000,
      demo: true,
    };
  });
}

let store = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.user) return parsed;
    }
  } catch { /* повреждённое хранилище просто игнорируем */ }
  return { user: freshUser(), players: demoPlayers(), adminLog: [], showAdmin: false };
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* приватный режим */ }
}

/* ---------- Публичный вид игрока ---------- */

function publicUser() {
  const u = store.user;
  return {
    id: u.id, username: u.username, firstName: u.firstName,
    balance: u.balance,
    // Кнопка «Админ» скрыта: в рабочей версии её видят только Telegram ID
    // из ADMIN_TG_IDS. Посмотреть панель в демо — demoAdmin() в консоли.
    isAdmin: !!store.showAdmin,
    x2CaseId: u.x2CaseId,
    gambleStake: u.gambleStake || 0,
    vouchers: Object.entries(u.vouchers).filter(([, n]) => n > 0)
      .map(([case_id, count]) => ({ case_id, count })),
    stats: {
      rounds: u.stats.rounds, spent: u.stats.spent, won: u.stats.won,
      bestMultiplier: Number(u.stats.bestMultiplier.toFixed(2)),
      profit: u.stats.won - u.stats.spent,
    },
    fair: {
      serverSeedHash: u.serverSeedHash, clientSeed: u.clientSeed, nonce: u.nonce,
      prevServerSeed: u.prevServerSeed, prevServerHash: u.prevServerHash,
    },
  };
}

function pickItem(table, roll) {
  for (const it of table.items) if (roll < it.cumulative) return it;
  return table.items[table.items.length - 1];
}

function pushRound(round) {
  store.user.rounds.unshift({ ...round, created_at: Date.now() });
  store.user.rounds = store.user.rounds.slice(0, 120);
}

/* ---------- Обработчики «эндпоинтов» ---------- */

let crashRound = null;


/** Одно открытие кейса. Общая часть для одиночного открытия и пачки. */
function openOnce(table) {
    const u = store.user;
    const free = (u.vouchers[table.id] || 0) > 0;
    u.nonce++;
    const roll = computeRoll(u.serverSeed, u.clientSeed, u.nonce);
    const item = pickItem(table, roll);

    const x2Active = u.x2CaseId === table.id;
    const payout = item.value * (x2Active && item.value > 0 ? 2 : 1);

    const granted = [];
    if (item.perk) {
      if (item.perk.type === 'credits') granted.push({ type: 'credits', amount: item.value });
      if (item.perk.type === 'voucher') {
        u.vouchers[item.perk.caseId] = (u.vouchers[item.perk.caseId] || 0) + 1;
        granted.push({ type: 'voucher', caseId: item.perk.caseId,
          caseName: DRAW_BY_ID.get(item.perk.caseId)?.name });
      }
      if (item.perk.type === 'x2') granted.push({ type: 'x2', caseId: table.id });
    }

    if (free) u.vouchers[table.id]--;
    u.x2CaseId = item.perk?.type === 'x2' ? table.id : (x2Active ? null : u.x2CaseId);

    const spent = free ? 0 : table.price;
    u.balance += payout - spent;
    u.stats.rounds++;
    u.stats.spent += spent;
    u.stats.won += payout;
    if (!free) u.stats.bestMultiplier = Math.max(u.stats.bestMultiplier, payout / table.price);

    u.gambleStake = payout > 0 ? payout : 0;

    pushRound({
      game: 'case', title: table.name,
      subtitle: item.name + (x2Active && item.value > 0 ? ' (×2)' : ''),
      bet: spent, payout, multiplier: free ? 0 : payout / table.price,
      tier: item.tier, free: free ? 1 : 0,
    });
    return {
      item: { id: item.id, name: item.name, kind: item.kind, value: payout,
              tier: item.tier, perkLabel: item.perkLabel,
              multiplier: Number((payout / table.price).toFixed(2)) },
      granted, free, x2Applied: x2Active && item.value > 0,
      net: payout - spent,
      fair: { roll, nonce: u.nonce },
    };
}

const routes = {
  'GET /api/config': () => CONFIG,

  'POST /api/me': () => ({ user: publicUser() }),

  'POST /api/open': (body) => {
    const table = DRAW_BY_ID.get(body.caseId);
    if (!table) return { status: 404, body: { error: 'Кейс не найден' } };

    if (table.availableFrom && Date.now() < table.availableFrom) {
      const starts = new Date(table.availableFrom).toLocaleDateString('ru-RU');
      return { status: 403, body: { error: 'Кейс откроется ' + starts } };
    }

    const u = store.user;
    const count = Math.min(CONFIG.maxBatch, Math.max(1, Math.trunc(Number(body.count) || 1)));
    const vouchers = u.vouchers[table.id] || 0;
    // Ваучеры покрывают первые открытия пачки, остальное платное.
    const need = Math.max(0, count - vouchers) * table.price;

    if (u.balance < need) {
      return { status: 400, body: { error: 'INSUFFICIENT_FUNDS',
        message: 'Не хватает ' + (need - u.balance) + ' ед.' } };
    }

    const opened = [];
    for (let n = 0; n < count; n++) opened.push(openOnce(table));
    save();

    return {
      count,
      opened,
      ...opened[0],
      totalSpent: opened.reduce((a, o) => a + (o.free ? 0 : table.price), 0),
      totalWon: opened.reduce((a, o) => a + o.item.value, 0),
      balance: u.balance,
      user: publicUser(),
    };
  },
  'POST /api/roulette': (body) => {
    const u = store.user;
    u.gambleStake = 0;
    const bet = Math.floor(Number(body.bet));
    const payouts = { red: 2, black: 2, green: 14 };
    if (!bet || bet < 1) return { status: 400, body: { error: 'Некорректная ставка' } };
    if (!payouts[body.color]) return { status: 400, body: { error: 'Некорректный цвет' } };
    if (u.balance < bet) {
      return { status: 400, body: { error: 'INSUFFICIENT_FUNDS',
        message: 'Не хватает ' + (bet - u.balance) + ' ед.' } };
    }

    u.nonce++;
    const roll = computeRoll(u.serverSeed, u.clientSeed, u.nonce);
    const slot = Math.min(Math.floor(roll * CONFIG.roulette.wheel.length),
                          CONFIG.roulette.wheel.length - 1);
    const landed = CONFIG.roulette.wheel[slot];
    const won = landed === body.color;
    const payout = won ? bet * payouts[body.color] : 0;
    const label = CONFIG.roulette.colors.find((c) => c.id === landed).label;

    u.balance += payout - bet;
    u.stats.rounds++; u.stats.spent += bet; u.stats.won += payout;
    u.stats.bestMultiplier = Math.max(u.stats.bestMultiplier, payout / bet);

    pushRound({ game: 'roulette', title: 'Рулетка',
      subtitle: won ? label + ' — забрал ' + payout : label + ' — мимо',
      bet, payout, multiplier: payout / bet,
      tier: won ? (landed === 'green' ? 'unique' : 'epic') : 'common', free: 0 });
    save();

    return { slot, landed, won, payout, net: payout - bet, balance: u.balance,
             fair: { roll, nonce: u.nonce }, user: publicUser() };
  },

  'POST /api/crash/start': (body) => {
    const u = store.user;
    u.gambleStake = 0;
    const bet = Math.floor(Number(body.bet));
    if (!bet || bet < 1) return { status: 400, body: { error: 'Некорректная ставка' } };
    if (u.balance < bet) {
      return { status: 400, body: { error: 'INSUFFICIENT_FUNDS',
        message: 'Не хватает ' + (bet - u.balance) + ' ед.' } };
    }

    u.nonce++;
    const roll = computeRoll(u.serverSeed, u.clientSeed, u.nonce);
    const raw = (1 - CONFIG.crash.edge) / (1 - roll);
    const crashPoint = Math.max(1, Math.min(Math.floor(raw * 100) / 100, CONFIG.crash.maxMultiplier));

    u.balance -= bet;
    crashRound = { id: Date.now(), bet, crashPoint, startedAt: Date.now(), status: 'running', nonce: u.nonce };
    save();

    return { roundId: crashRound.id, startedAt: crashRound.startedAt,
             serverTime: Date.now(), bet, balance: u.balance, user: publicUser() };
  },

  'POST /api/crash/state': () => {
    if (!crashRound) return { status: 404, body: { error: 'Раунд не найден' } };
    if (crashRound.status !== 'running') {
      return { status: crashRound.status, crashPoint: crashRound.crashPoint };
    }
    const elapsed = Date.now() - crashRound.startedAt;
    const current = Math.exp((CONFIG.crash.growth * elapsed) / 1000);
    if (current >= crashRound.crashPoint) return finishCrash('busted', null);
    return { status: 'running', multiplier: Number(current.toFixed(2)), elapsed };
  },

  'POST /api/crash/cashout': () => {
    if (!crashRound || crashRound.status !== 'running') {
      return { status: 400, body: { error: 'Раунд уже завершён' } };
    }
    const elapsed = Date.now() - crashRound.startedAt;
    const current = Math.exp((CONFIG.crash.growth * elapsed) / 1000);
    if (current >= crashRound.crashPoint) return finishCrash('busted', null);
    return finishCrash('cashed', Number(current.toFixed(2)));
  },

  'POST /api/bonus': () => ({ status: 410, body: { error: 'disabled',
    message: 'Бонус больше не выдаётся' } }),

  /* ---------- Касса ---------- */

  'POST /api/wallet': () => {
    const u = store.user;
    const pending = u.payouts.filter((p) => p.status === 'pending')
      .reduce((a, p) => a + p.amount, 0);
    return {
      balance: u.balance, pending, available: u.balance,
      minPayout: CONFIG.minPayout,
      deposits: u.deposits, payouts: u.payouts,
    };
  },

  'POST /api/payout/create': (body) => {
    const u = store.user;
    const amount = Math.trunc(Number(body.amount));
    if (!amount || amount <= 0) return { status: 400, body: { error: 'Укажите сумму вывода' } };
    if (amount < CONFIG.minPayout) {
      return { status: 400, body: { error: 'MIN',
        message: 'Минимальная сумма вывода — ' + CONFIG.minPayout } };
    }
    if (amount > u.balance) {
      return { status: 400, body: { error: 'INSUFFICIENT_FUNDS', message: 'Недостаточно средств' } };
    }

    // Списываем сразу — как на сервере: иначе один баланс можно заявить дважды.
    u.balance -= amount;
    const id = Date.now();
    u.payouts.unshift({ id, amount, status: 'pending', comment: null,
                        created_at: Date.now(), resolved_at: null });
    save();
    return { id, amount, balance: u.balance, user: publicUser() };
  },

  'POST /api/payout/cancel': (body) => {
    const u = store.user;
    const p = u.payouts.find((x) => x.id === Number(body.id));
    if (!p) return { status: 404, body: { error: 'Заявка не найдена' } };
    if (p.status !== 'pending') return { status: 400, body: { error: 'Заявка уже обработана' } };

    p.status = 'cancelled';
    p.resolved_at = Date.now();
    u.balance += p.amount;
    save();
    return { balance: u.balance, user: publicUser() };
  },

  'POST /api/admin/payouts': (body) => {
    const u = store.user;
    const status = body.status || 'pending';
    const rows = (status === 'all' ? u.payouts : u.payouts.filter((p) => p.status === status))
      .map((p) => ({ ...p, user_id: u.id, tg_id: '999000001',
                     username: u.username, first_name: u.firstName, balance: u.balance }));
    const sum = (st) => u.payouts.filter((p) => p.status === st).reduce((a, p) => a + p.amount, 0);
    return {
      rows,
      stats: {
        pendingSum: sum('pending'),
        pendingCount: u.payouts.filter((p) => p.status === 'pending').length,
        paidSum: sum('paid'), rejectedSum: sum('rejected'),
      },
    };
  },

  'POST /api/admin/payout/resolve': (body) => {
    const u = store.user;
    const p = u.payouts.find((x) => x.id === Number(body.id));
    if (!p) return { status: 404, body: { error: 'Заявка не найдена' } };
    if (p.status !== 'pending') return { status: 400, body: { error: 'Заявка уже обработана' } };
    if (!['paid', 'rejected'].includes(body.status)) {
      return { status: 400, body: { error: 'Недопустимый статус' } };
    }

    p.status = body.status;
    p.comment = body.comment || null;
    p.resolved_at = Date.now();
    // Отклонение возвращает деньги, выплата — нет: они считаются ушедшими.
    if (body.status === 'rejected') u.balance += p.amount;
    save();
    return { status: p.status, amount: p.amount };
  },

  'POST /api/history': (body) => {
    const title = body.caseTitle;
    const limit = Math.min(60, Math.max(1, Number(body.limit) || 60));
    const rows = title
      ? store.user.rounds.filter((r) => r.game === 'case' && r.title === title)
      : store.user.rounds;
    return { history: rows.slice(0, limit) };
  },

  'POST /api/gamble/pick': (body) => {
    const u = store.user;
    const stake = u.gambleStake || 0;
    if (stake <= 0) return { status: 400, body: { error: 'Нечем рисковать' } };

    const index = Math.trunc(Number(body.index));
    if (!Number.isInteger(index) || index < 0 || index >= CONFIG.gamble.cards) {
      return { status: 400, body: { error: 'Некорректный выбор карты' } };
    }

    u.nonce++;
    const roll = computeRoll(u.serverSeed, u.clientSeed, u.nonce);
    const acePosition = Math.min(Math.floor(roll * CONFIG.gamble.cards), CONFIG.gamble.cards - 1);
    const won = index === acePosition;
    const payout = won ? stake * CONFIG.gamble.payout : 0;

    // Ставка уже на балансе: при выигрыше доначисляем, при промахе снимаем.
    u.balance += payout - stake;
    u.gambleStake = 0;
    u.stats.rounds++; u.stats.spent += stake; u.stats.won += payout;
    u.stats.bestMultiplier = Math.max(u.stats.bestMultiplier, won ? CONFIG.gamble.payout : 0);

    pushRound({ game: 'gamble', title: 'Риск-игра',
      subtitle: won ? 'Нашёл туза — ' + CONFIG.gamble.payout + 'x' : 'Промах',
      bet: stake, payout, multiplier: won ? CONFIG.gamble.payout : 0,
      tier: won ? 'unique' : 'common', free: 0 });
    save();

    return { won, acePosition, payout, stake, balance: u.balance,
             fair: { roll, nonce: u.nonce }, user: publicUser() };
  },

  'POST /api/gamble/skip': () => {
    store.user.gambleStake = 0;
    save();
    return { user: publicUser() };
  },

  'POST /api/fair/client-seed': (body) => {
    const seed = String(body.seed || '').trim() || randHex(8);
    if (seed.length > 64 || !/^[\\w-]+$/.test(seed)) {
      return { status: 400, body: { error: 'Seed: до 64 символов, только буквы, цифры, дефис и подчёркивание' } };
    }
    store.user.clientSeed = seed;
    save();
    return { user: publicUser() };
  },

  'POST /api/fair/rotate': () => {
    const u = store.user;
    u.prevServerSeed = u.serverSeed;
    u.prevServerHash = u.serverSeedHash;
    u.serverSeed = randHex(32);
    u.serverSeedHash = sha256Hex(u.serverSeed);
    u.nonce = 0;
    save();
    return { revealedSeed: u.prevServerSeed, revealedHash: u.prevServerHash,
             newHash: u.serverSeedHash, user: publicUser() };
  },

  /* ---------- Админка ---------- */

  'POST /api/admin/overview': () => {
    const me = store.user;
    const all = [{ ...me, tg_id: '999000001', total_rounds: me.stats.rounds,
                   total_spent: me.stats.spent, total_won: me.stats.won,
                   first_name: me.firstName, is_blocked: 0 }, ...store.players];

    const wagered = all.reduce((s, p) => s + p.total_spent, 0);
    const paid = all.reduce((s, p) => s + p.total_won, 0);
    const rounds = all.reduce((s, p) => s + p.total_rounds, 0);

    const byGame = ['case', 'crash', 'roulette'].map((game) => {
      const rs = me.rounds.filter((r) => r.game === game);
      const w = rs.reduce((s, r) => s + r.bet, 0);
      const p = rs.reduce((s, r) => s + r.payout, 0);
      return { game, rounds: rs.length, wagered: w, paid: p, profit: w - p, rtp: w ? p / w : null };
    }).filter((g) => g.rounds);

    const dayAgo = Date.now() - 86400000;
    const today = me.rounds.filter((r) => r.created_at > dayAgo);

    return {
      users: { total: all.length, active: all.filter((p) => p.total_rounds > 0).length,
               blocked: all.filter((p) => p.is_blocked).length,
               balance: all.reduce((s, p) => s + p.balance, 0) },
      rounds: { total: rounds, wagered, paid, profit: wagered - paid,
                rtp: wagered ? paid / wagered : null },
      byGame,
      today: { rounds: today.length, players: today.length ? 1 : 0,
               wagered: today.reduce((s, r) => s + r.bet, 0),
               paid: today.reduce((s, r) => s + r.payout, 0),
               profit: today.reduce((s, r) => s + r.bet - r.payout, 0) },
      topWins: me.rounds.slice().sort((a, b) => b.payout - a.payout).slice(0, 10)
        .map((r) => ({ ...r, username: me.username, user_id: me.id })),
      recent: me.rounds.slice(0, 30).map((r) => ({ ...r, username: me.username, user_id: me.id })),
    };
  },

  'POST /api/admin/users': (body) => {
    const q = String(body.query || '').toLowerCase();
    const me = store.user;
    const all = [{ id: me.id, tg_id: '999000001', username: me.username, first_name: me.firstName,
                   balance: me.balance, total_rounds: me.stats.rounds, total_spent: me.stats.spent,
                   total_won: me.stats.won, best_multiplier: me.stats.bestMultiplier,
                   is_admin: 1, is_blocked: 0, created_at: Date.now() }, ...store.players];
    const rows = all.filter((p) => !q ||
      (p.username || '').toLowerCase().includes(q) ||
      (p.first_name || '').toLowerCase().includes(q) ||
      String(p.tg_id).includes(q));
    return { rows, total: rows.length };
  },

  'POST /api/admin/user': (body) => {
    const id = Number(body.userId);
    if (id === store.user.id) {
      const me = store.user;
      return {
        user: { id: me.id, tg_id: '999000001', username: me.username, first_name: me.firstName,
                balance: me.balance, total_rounds: me.stats.rounds, total_spent: me.stats.spent,
                total_won: me.stats.won, is_blocked: 0, is_admin: 1 },
        history: me.rounds.slice(0, 30),
        vouchers: Object.entries(me.vouchers).filter(([, n]) => n > 0)
          .map(([case_id, count]) => ({ case_id, count })),
        log: store.adminLog.filter((l) => l.target_id === id).slice(0, 20),
      };
    }
    const p = store.players.find((x) => x.id === id);
    if (!p) return { status: 404, body: { error: 'Игрок не найден' } };
    return { user: p, history: [], vouchers: [],
             log: store.adminLog.filter((l) => l.target_id === id).slice(0, 20) };
  },

  'POST /api/admin/balance': (body) => {
    const id = Number(body.userId);
    const amount = Math.trunc(Number(body.amount));
    if (!amount) return { status: 400, body: { error: 'Укажите ненулевую сумму' } };

    const target = id === store.user.id ? store.user : store.players.find((x) => x.id === id);
    if (!target) return { status: 404, body: { error: 'Игрок не найден' } };

    const before = target.balance;
    target.balance = Math.max(0, before + amount);
    store.adminLog.unshift({ target_id: id, action: amount > 0 ? 'credit' : 'debit',
      amount: target.balance - before, note: body.note || null, created_at: Date.now() });
    if (target.balance > before && target === store.user) {
      store.user.deposits.unshift({ amount: target.balance - before, source: 'admin',
        comment: body.note || 'Начисление администратором', created_at: Date.now() });
    }
    save();
    return { balance: target.balance, applied: target.balance - before };
  },

  'POST /api/admin/block': (body) => {
    const p = store.players.find((x) => x.id === Number(body.userId));
    if (!p) return { status: 400, body: { error: 'В демо блокируется только демо-игрок' } };
    p.is_blocked = body.blocked ? 1 : 0;
    store.adminLog.unshift({ target_id: p.id, action: body.blocked ? 'block' : 'unblock',
      amount: null, note: null, created_at: Date.now() });
    save();
    return { blocked: !!p.is_blocked };
  },

  'POST /api/admin/voucher': (body) => {
    const id = Number(body.userId);
    const count = Math.max(1, Math.trunc(Number(body.count) || 1));
    if (!DRAW_BY_ID.get(body.caseId)) return { status: 400, body: { error: 'Кейс не найден' } };
    if (id === store.user.id) {
      store.user.vouchers[body.caseId] = (store.user.vouchers[body.caseId] || 0) + count;
    }
    store.adminLog.unshift({ target_id: id, action: 'voucher', amount: count,
      note: body.caseId, created_at: Date.now() });
    save();
    return { vouchers: Object.entries(store.user.vouchers).filter(([, n]) => n > 0)
      .map(([case_id, c]) => ({ case_id, count: c })) };
  },
};

function finishCrash(status, cashedAt) {
  const u = store.user;
  const r = crashRound;
  const payout = status === 'cashed' ? Math.floor(r.bet * cashedAt) : 0;

  r.status = status;
  u.balance += payout;
  u.stats.rounds++; u.stats.spent += r.bet; u.stats.won += payout;
  u.stats.bestMultiplier = Math.max(u.stats.bestMultiplier, payout / r.bet);

  pushRound({ game: 'crash', title: 'Краш',
    subtitle: status === 'cashed'
      ? 'Забрал на ' + cashedAt.toFixed(2) + 'x'
      : 'Взорвался на ' + r.crashPoint.toFixed(2) + 'x',
    bet: r.bet, payout, multiplier: payout / r.bet,
    tier: payout === 0 ? 'common' : payout / r.bet < 2 ? 'rare' : payout / r.bet < 5 ? 'epic'
        : payout / r.bet < 15 ? 'legendary' : 'unique',
    free: 0 });
  save();

  return { status, payout, crashPoint: r.crashPoint,
           cashedAt: status === 'cashed' ? cashedAt : null,
           net: payout - r.bet, balance: u.balance, user: publicUser() };
}

/* ---------- Перехват fetch ---------- */

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);

  const method = (init.method || 'GET').toUpperCase();
  const key = method + ' ' + url;
  const handler = routes[key];

  if (!handler) {
    return new Response(JSON.stringify({ error: 'Не найдено: ' + key }),
      { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* пустое тело */ }

  // Небольшая задержка, чтобы поведение было как с настоящим сервером.
  await new Promise((r) => setTimeout(r, 40));

  const out = handler(body);
  const isError = out && typeof out.status === 'number' && out.body;

  return new Response(JSON.stringify(isError ? out.body : out), {
    status: isError ? out.status : 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// Точки входа для автотестов: сверяют криптографию демо с эталонной.
window.__hmacTest = hmacSha256Hex;
window.__shaTest = sha256Hex;

/** Показать/скрыть админку в демо. В проде это делает ADMIN_TG_IDS. */
window.demoAdmin = (on = true) => {
  store.showAdmin = !!on;
  save();
  location.reload();
};

/** Сброс демо-прогресса — доступен из консоли. */
window.resetDemo = () => {
  localStorage.removeItem(STORE_KEY);
  location.reload();
};
`;

/* ---------- Сборка ---------- */

const page = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>LUCKYBOX — демо</title>
<style>
${css}

/* ---------- Только для автономной версии ---------- */

.demo-note {
  position: relative; z-index: 3;
  margin: 0 0 16px;
  padding: 13px 15px;
  border-radius: 14px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
  background: var(--bg-soft);
  border: 1.5px solid var(--gold);
}
.demo-note b { color: var(--gold); }
.demo-note code {
  font-family: ui-monospace, Menlo, monospace;
  color: var(--cyan);
  font-size: 11.5px;
}
</style>
</head>
<body>
${body}

<script>
/* Заглушка живёт в СВОЕЙ области видимости. При склейке в общую её
   внутренние имена (например finishCrash) перекрывались одноимёнными
   функциями клиента, и раунд краша переставал завершаться. */
(function () {
'use strict';
${shim}
})();
</script>

<script>
/* Снимок машины уезжает в файл целиком: с диска относительных путей нет.
   Присваивание идёт до кода обложек — оттуда эта переменная и читается. */
window.__PORSCHE_SRC = 'data:image/webp;base64,${porscheData}';
</script>

<script>
(function () {
'use strict';

${strip(icons)}

${strip(covers)}

${strip(sounds)}

${strip(legal)}

${strip(app)}

// Пояснение про демо — над полками.
const shelves = document.getElementById('caseShelves');
if (shelves) {
  const note = document.createElement('div');
  note.className = 'demo-note';
  note.innerHTML = '<b>Это автономное демо.</b> Вся математика считается прямо ' +
    'в браузере, прогресс хранится локально и никуда не уходит. В рабочей версии ' +
    'исход раундов считает сервер, а серверный seed игроку недоступен — здесь это ' +
    'невозможно по определению. Игроки в админке выдуманы для наглядности. ' +
    'Кнопка «Админ» скрыта — в рабочей версии её видят только Telegram ID ' +
    'из ADMIN_TG_IDS; посмотреть панель здесь: <code>demoAdmin()</code>. ' +
    'Сбросить прогресс: <code>resetDemo()</code>.';
  shelves.parentNode.insertBefore(note, shelves);
}
})();
</script>
</body>
</html>
`;

/**
 * Защита от столкновения имён: куски склеиваются в одну область видимости,
 * и повторное объявление функции молча перекрывает предыдущее. Именно так
 * заглушечный finishCrash был перекрыт клиентским. Лучше уронить сборку.
 */
function topLevelNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) {
    names.add(m[1]);
  }
  return names;
}

const scopes = {
  icons: topLevelNames(icons), covers: topLevelNames(covers),
  sounds: topLevelNames(sounds), legal: topLevelNames(legal),
  app: topLevelNames(app),
};
const clashes = [];
for (const [aName, aSet] of Object.entries(scopes)) {
  for (const [bName, bSet] of Object.entries(scopes)) {
    if (aName >= bName) continue;
    for (const n of aSet) if (bSet.has(n)) clashes.push(`${n} (${aName} и ${bName})`);
  }
}
if (clashes.length) {
  console.error('Столкновение имён при склейке:\n  ' + clashes.join('\n  '));
  process.exit(1);
}

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
const out = new URL('./dist/luckybox-demo.html', import.meta.url);
writeFileSync(out, page);

console.log('Собрано:', out.pathname);
console.log('Размер:', (Buffer.byteLength(page) / 1024 / 1024).toFixed(2), 'МБ');
console.log('Кейсов в демо:', config.cases.length);
