/**
 * HTTP-сервер мини-аппа: отдаёт статику и обслуживает игровое API.
 *
 * Важное правило: исход считает ТОЛЬКО сервер. Клиент получает готовый
 * результат и лишь проигрывает анимацию. В краше точка взрыва вообще не
 * уходит на клиент до конца раунда, иначе игрок выводил бы ставку за
 * мгновение до взрыва.
 */

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import {
  CASES, CATEGORIES, getCase, pickItem, publicCase, validateCases, TIERS,
  FREESPIN_PACKS, freeSpinPackPrice,
} from './cases.js';
import {
  CRASH_CONFIG,
  ROULETTE_CONFIG,
  ROULETTE_WHEEL,
  crashMultiplierAt,
  crashPointFromRoll,
  rouletteColorOf,
  rouletteSlotFromRoll,
  validateGames,
  GAMBLE_CONFIG,
  gambleAceFromRoll,
  validateGamble,
  UPGRADE_CONFIG,
  upgradeTarget,
  upgradeChance,
  upgradeWinFromRoll,
  validateUpgrade,
} from './games.js';
import { computeRoll, generateClientSeed } from './fair.js';
import {
  FORTUNE_SEGMENTS, SEGMENT_DEG, SEGMENTS_START_DEG, validateFortune,
  GIFT_CASE_MAX_PRICE, PERCENT_MIN, PERCENT_MAX, VOUCHER_MIN, VOUCHER_MAX, CASH_PRIZE,
} from './fortune.js';
import { limits } from './ratelimit.js';
import * as crypto from './crypto.js';
import {
  BONUS_CONFIG,
  claimBonus,
  finishCrashRound,
  getCrashRound,
  getHistory,
  getOrCreateUser,
  getUserById,
  playCaseRound,
  playCaseBatch,
  buyFreeSpins,
  playInstantRound,
  rotateServerSeed,
  setClientSeed,
  startCrashRound,
  getVouchers, getX2Perks,
  fortuneState, fortuneHistory, playFortuneSpin,
  syncStaff, staffRow, staffList, staffSave, staffRemove, findUserByAnyId,
  playerNotes, addPlayerNote, deletePlayerNote,
  getPlayerLimits, setPlayerLimits, dayActivity, LIMIT_COOLDOWN_MS,
  settingsAll, setting, saveSettings,
  adminJournal, revenueDaily, caseReport as caseRevenueReport, riskSignals,
  logAdmin,
  adminOverview,
  adminUsers,
  adminUserDetail,
  adminAdjustBalance,
  adminSetBlocked,
  adminGrantVoucher,
  adminRecentRounds,
  playGamble,
  clearGamble,
  MIN_PAYOUT,
  getDeposits,
  getPayouts,
  pendingPayoutTotal,
  createPayout, withdrawable,
  cancelPayout,
  resolvePayout,
  startPayout,
  completePayout,
  adminPayouts,
  payoutStats,
  grantFreeCase,
  freeCaseState,
  recentPublicDrops,
  redeemPromo,
  pendingDepositBonus,
  myPromoRedemptions,
  getPartnerByTgId,
  partnerStats,
  partnerReferrals,
  partnerPayoutHistory,
  adminSavePromo,
  adminListPromos,
  adminDeletePromo,
  adminSavePartner,
  adminListPartners,
  adminPayPartner,
  savePendingSpins,
  getPendingSpins,
  clearPendingSpins,
  trackEvent, funnelStats, eventTotals, CLIENT_EVENTS,
  firstDepositRules,
} from './db.js';
import {
  MINIGAMES, MINI_RTP, FAMILIES as MINI_FAMILIES,
  getMinigame, resolveMinigame, publicMinigame, validateMinigames,
} from './minigames.js';
import { resolveUser } from './auth.js';
import {
  PERMISSIONS, PERMISSION_GROUPS, ROLES, ROLE_BY_ID, permissionsFor, balanceCapFor,
  canManage, assignableRoles, publicRoles, isPermission,
} from './staff.js';
import {
  startFeed, getFeed, FEED_CONFIG, FEED_MIN_MULTIPLIER, FEED_MIN_VALUE, FEED_PLAIN_MIN_VALUE,
  FEED_REAL_SHARE,
} from './feed.js';
import {
  isConfigured as subscriptionConfigured,
  isSubscribed,
  subscriptionConfig,
  FREE_CASE_COOLDOWN_MS,
} from './subscription.js';
import {
  createPayment, getPayment, listPayments, verifyDeviceRequest, processBeelineSms,
  heartbeat, registerDevice, adminDevices, adminPayments, paymentDashboard,
  paymentSettings, updatePaymentSettings, openDispute, addSupportMessage,
  supportChat, adminChats,
} from './payments.js';

// Если математика поехала — падаем на старте, до первого игрока.
const caseReport = validateCases();
const gameReport = validateGames();
const gambleReport = validateGamble();
const upgradeReport = validateUpgrade();
const miniReport = validateMinigames();
validateFortune();

// Администраторы задаются Telegram ID через настройки — не через базу,
// чтобы права нельзя было получить, дописав себе строку в таблицу.
const ADMIN_TG_IDS = String(process.env.ADMIN_TG_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
syncStaff(ADMIN_TG_IDS);

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

/*
 * За nginx все запросы приходят с адреса самого nginx. Без этой строки
 * ограничитель частоты считал бы всех безымянных клиентов за одного и рубил
 * бы вход целиком, а в логах стоял бы один и тот же 127.0.0.1.
 *
 * Число - сколько прокси перед приложением. Один nginx на том же сервере это
 * 1. Если добавите Cloudflare или второй балансировщик, увеличьте: доверять
 * всей цепочке (`true`) нельзя, заголовок подделывается кем угодно.
 */
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

app.use(express.json({ limit: '8mb', verify: (req, res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
app.use(express.static(join(__dirname, '..', 'public'), { maxAge: '1h' }));

function auth(req, res, next) {
  const result = resolveUser(req);
  if (!result.ok) return res.status(401).json({ error: result.error });

  // Закрытая регистрация касается только НОВЫХ: у того, кто уже заходил,
  // доступ отбирать не за что, а закрывают приём обычно на время разбора.
  if (!setting('registration_open') && !findUserByAnyId(String(result.user.id))) {
    return res.status(403).json({ error: 'Регистрация новых игроков временно закрыта' });
  }

  const player = getOrCreateUser(result.user);

  /*
   * Владельцы задаются Telegram ID в настройках, и список сверяется при
   * каждом запросе того, кто в нём есть или должен был быть: убрали ID из
   * ADMIN_TG_IDS - доступ пропал сразу, без перезапуска.
   *
   * Сверка идёт только для владельцев. Остальных сотрудников заводит человек
   * через панель, и переменная окружения их не касается.
   */
  const inEnv = ADMIN_TG_IDS.includes(String(player.tg_id));
  const bootstrapRow = staffRow(player.id);
  const bootstrapMismatch = inEnv
    ? !bootstrapRow || (bootstrapRow.added_by === null && bootstrapRow.role !== 'owner')
    : !!(bootstrapRow && bootstrapRow.added_by === null);
  if (bootstrapMismatch) {
    syncStaff(ADMIN_TG_IDS);
    req.player = getUserById(player.id);
  } else {
    req.player = player;
  }

  req.staff = staffRow(req.player.id);
  req.perms = permissionsFor(req.staff);

  if (req.player.is_blocked) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  maintenanceGate(req, res, next);
}

/**
 * Режим обслуживания.
 *
 * Стоит ПОСЛЕ auth, а не до: сотрудники обязаны входить в закрытую площадку,
 * иначе включивший работы сам себя из панели и выгонит. Заглушка отдаётся
 * кодом 503, чтобы клиент отличал её от обычной ошибки.
 *
 * Список исключений короткий и не случайный: /api/me и /api/config нужны
 * клиенту, чтобы вообще показать экран с заглушкой.
 */
/**
 * Минимум вывода: настройка панели, а если её не трогали - значение сервера.
 *
 * Ноль означает «как в настройках сервера», а не «выводить можно копейку»:
 * пустое поле в панели не должно молча открывать вывод на любую сумму.
 */
function minPayoutNow() {
  return setting('min_payout') || MIN_PAYOUT;
}

const MAINTENANCE_OPEN = new Set(['/api/me', '/api/config', '/api/track']);

function maintenanceGate(req, res, next) {
  if (!setting('maintenance')) return next();
  if (req.perms && req.perms.size > 0) return next();
  if (MAINTENANCE_OPEN.has(req.path)) return next();
  return res.status(503).json({
    error: 'Идут технические работы. Загляните чуть позже',
    maintenance: true,
  });
}

/**
 * Выключатель игры из панели.
 *
 * Прятать раздел на клиенте мало: раздел открывается прямым запросом, а
 * выключают игру обычно потому, что в ней что-то не так. Поэтому отказ
 * стоит на сервере, а клиент по тому же признаку прячет вход, чтобы игрок
 * не упирался в кнопку, которая всегда ругается.
 */
function gameGate(key) {
  return (req, res, next) => {
    if (setting(`games_${key}`)) return next();
    res.status(503).json({ error: 'Игра временно недоступна' });
  };
}

/**
 * Проверка права.
 *
 * Не «пропустить админа», а именно право: дальше по коду ни одна ручка не
 * должна спрашивать про роль. Как только появляется `if (role === 'admin')`,
 * набор прав перестаёт быть правдой о том, кто что может.
 */
function need(permission) {
  return (req, res, next) => {
    if (!req.perms || !req.perms.has(permission)) {
      return res.status(403).json({ error: 'Недостаточно прав', need: permission });
    }
    next();
  };
}

/** Есть ли у человека хоть какой-то доступ в панель. */
function adminOnly(req, res, next) {
  if (!req.perms || req.perms.size === 0) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  next();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    balance: user.balance,
    isAdmin: !!user.is_admin,
    x2Perks: getX2Perks(user.id),
    gambleStake: user.gamble_stake,
    gambleCase: user.gamble_case,
    vouchers: getVouchers(user.id),
    // Долг по обороту закрывает вывод, поэтому игрок должен его видеть.
    wagerRequired: user.wager_required || 0,
    // По нему клиент решает, показывать ли предложение первого пополнения.
    depositsCount: user.deposits_count || 0,
    isPartner: Boolean(getPartnerByTgId(user.tg_id)),
    stats: {
      rounds: user.total_rounds,
      spent: user.total_spent,
      won: user.total_won,
      bestMultiplier: Number(user.best_multiplier.toFixed(2)),
      profit: user.total_won - user.total_spent,
    },
    fair: {
      serverSeedHash: user.server_seed_hash,
      clientSeed: user.client_seed,
      nonce: user.nonce,
      prevServerSeed: user.prev_server_seed,
      prevServerHash: user.prev_server_hash,
    },
  };
}

/** Ставка должна быть целым числом в разумных границах. */
function parseBet(raw) {
  const bet = Math.floor(Number(raw));
  if (!Number.isFinite(bet) || bet < 1) return null;
  if (bet > 10_000_000) return null;
  return bet;
}

function sendInsufficient(res, need) {
  return res.status(400).json({
    error: 'INSUFFICIENT_FUNDS',
    message: `Не хватает ${need} ед.`,
  });
}

/* ============================================================
   КОНФИГ И ИГРОК
   ============================================================ */

app.get('/api/config', (req, res) => {
  res.json({
    categories: CATEGORIES,
    cases: CASES.map(publicCase),
    tiers: TIERS,
    crash: {
      rtp: CRASH_CONFIG.rtp,
      maxMultiplier: CRASH_CONFIG.maxMultiplier,
      growth: CRASH_CONFIG.growth,
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
    upgrade: {
      minStake: UPGRADE_CONFIG.minStake,
      multipliers: UPGRADE_CONFIG.multipliers,
    },
    feed: { minMultiplier: FEED_CONFIG.minMultiplier, minValue: FEED_CONFIG.minValue },
    freeCase: subscriptionConfig(),
    bonus: { enabled: false },
    maxBatch: MAX_BATCH,
    freeSpinPacks: FREESPIN_PACKS,
    minigames: {
      rtp: MINI_RTP,
      families: MINI_FAMILIES,
      games: MINIGAMES.map(publicMinigame),
    },
    minPayout: minPayoutNow(),
    // Выключатели из панели: клиент по ним прячет разделы, сервер по ним же
    // отказывает. Прятать без отказа нельзя - раздел открывается прямым
    // запросом; отказывать без пряток можно, но игрок будет тыкать в кнопку,
    // которая всегда ругается.
    open: {
      payouts: setting('payouts_open'),
      deposits: setting('deposits_open'),
      cases: setting('games_cases'),
      crash: setting('games_crash'),
      roulette: setting('games_roulette'),
      upgrade: setting('games_upgrade'),
      mini: setting('games_mini'),
      fortune: setting('games_fortune'),
    },
    // Условия приветственного бонуса нужны клиенту, чтобы показать их в кассе
    // до пополнения, а не после.
    firstDeposit: firstDepositRules(),
  });
});

/* ============================================================
   ВИТРИНА КРУПНЫХ ВЫПАДЕНИЙ
   ============================================================ */

/**
 * Лента открыта без авторизации: она видна и до входа в Telegram.
 * Наружу уходят только ник, кейс и предмет — ни ID, ни балансов.
 */
app.get('/api/feed', limits.read, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 40);
  // Свои выпадения игрок должен видеть в ленте наравне с выдуманными, поэтому
  // порог тут только по сумме - тот же, ниже которого выпадение выглядит
  // поломкой, а не скромным выигрышем.
  // Доля настоящих ограничена: иначе игрок, открывший подряд четыре десятка
  // кейсов, вытесняет из витрины всё остальное - см. FEED_REAL_SHARE.
  const real = recentPublicDrops(Math.ceil(limit * FEED_REAL_SHARE), FEED_PLAIN_MIN_VALUE);
  const shown = FEED_CONFIG.synthetic ? getFeed(limit) : [];

  // Настоящие выпадения идут первыми при равной свежести.
  const merged = [...real, ...shown]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  res.json({
    drops: merged,
    minMultiplier: FEED_MIN_MULTIPLIER,
    minValue: FEED_MIN_VALUE,
    bigShare: FEED_CONFIG.bigShare,
  });
});

app.post('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.player) });
});

/**
 * События, которые может отправить только клиент: заход в кассу, упор в
 * нехватку средств, пройденный онбординг. Сервер о них не знает - они
 * происходят целиком в интерфейсе.
 *
 * Имя проверяется по белому списку CLIENT_EVENTS, а свойства не принимаются
 * вовсе: иначе в таблицу можно было бы насыпать что угодно и любого размера.
 * Ограничитель тот же, что у чтения: событие дешевле любого запроса к базе.
 */
app.post('/api/track', auth, limits.read, (req, res) => {
  const name = String(req.body?.name || '');
  if (!CLIENT_EVENTS.has(name)) return res.status(400).json({ error: 'Неизвестное событие' });
  trackEvent(req.player.id, name);
  res.json({ ok: true });
});

/* ============================================================
   КЕЙСЫ
   ============================================================ */

/** Сколько одинаковых кейсов можно открыть за раз. */
const MAX_BATCH = 5;

app.post('/api/open', auth, limits.play, gameGate('cases'), (req, res) => {
  const caseData = getCase(req.body?.caseId);
  if (!caseData) return res.status(404).json({ error: 'Кейс не найден' });

  // Сезонный кейс до даты старта не открывается. Проверка именно здесь, на
  // сервере: спрятать кнопку в интерфейсе мало, запрос можно послать напрямую.
  if (caseData.availableFrom && Date.now() < caseData.availableFrom) {
    const starts = new Date(caseData.availableFrom).toLocaleDateString('ru-RU');
    return res.status(403).json({ error: `Кейс откроется ${starts}` });
  }

  const count = Math.min(MAX_BATCH, Math.max(1, Math.trunc(Number(req.body?.count) || 1)));

  const user = req.player;
  const vouchers = getVouchers(user.id).find((v) => v.case_id === caseData.id)?.count || 0;
  // Ваучеры покрывают первые открытия пачки, остальное оплачивается балансом.
  const payable = Math.max(0, count - vouchers);
  const need = payable * caseData.price;

  if (user.balance < need) return sendInsufficient(res, need - user.balance);

  let results;
  try {
    results = playCaseBatch(user.id, caseData, count, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { item: pickItem(caseData, roll), roll };
    }, (serverSeed, clientSeed, nonce) => {
      // Фриспин крутит ту же полную таблицу, что и платное открытие.
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { item: pickItem(caseData, roll), roll };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, need - user.balance);
    throw err;
  }

  const opened = results.map((result) => ({
    item: {
      id: result.item.id,
      name: result.item.name,
      kind: result.item.kind,
      value: result.payout,
      tier: result.item.tier,
      perkLabel: result.item.perkLabel,
      multiplier: Number((result.payout / caseData.price).toFixed(2)),
    },
    granted: result.granted.map((g) => ({
      ...g,
      caseName: g.caseId ? getCase(g.caseId)?.name : undefined,
    })),
    free: result.free,
    x2Applied: result.x2Applied,
    net: result.totalPayout - (result.free ? 0 : caseData.price),
    fair: { roll: result.roll, nonce: result.nonce },
  }));

  const last = results[results.length - 1];

  // Выпавшая серия тоже может остаться недосмотренной. Храним последнюю:
  // показать всё равно можно только одну за раз.
  const pending = opened.flatMap((o) => o.granted).filter((g) => g.type === 'freespins');
  if (pending.length) savePendingSpins(user.id, caseData.id, pending[pending.length - 1]);

  // Выигрыш фриспинов реально зачислен на баланс в той же транзакции, что и
  // сам предмет, — его нельзя терять при подсчёте суммы пачки, иначе итог
  // на экране разойдётся с тем, что реально начислено.
  const freeSpinsTotal = (o) =>
    o.granted.find((g) => g.type === 'freespins')?.total || 0;

  trackEvent(user.id, 'case_open', { caseId: caseData.id, count, price: caseData.price });

  res.json({
    count,
    opened,
    // Поля одиночного открытия сохранены: на них опирается вся анимация.
    ...opened[0],
    totalSpent: opened.reduce((s, o) => s + (o.free ? 0 : caseData.price), 0),
    totalWon: opened.reduce((s, o) => s + o.item.value + freeSpinsTotal(o), 0),
    balance: last.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/**
 * Покупка серии фриспинов.
 *
 * Цену считает сервер, клиент её только показывает: иначе подобранным запросом
 * можно было бы купить серию за свою цену.
 */
app.post('/api/freespins/buy', auth, limits.play, gameGate('cases'), (req, res) => {
  const caseData = getCase(req.body?.caseId);
  if (!caseData) return res.status(404).json({ error: 'Кейс не найден' });

  if (caseData.availableFrom && Date.now() < caseData.availableFrom) {
    const starts = new Date(caseData.availableFrom).toLocaleDateString('ru-RU');
    return res.status(403).json({ error: `Кейс откроется ${starts}` });
  }

  const count = Math.trunc(Number(req.body?.count));
  const cost = freeSpinPackPrice(caseData, count);
  if (!cost) return res.status(400).json({ error: 'Такой пачки нет' });

  const user = req.player;
  if (user.balance < cost) return sendInsufficient(res, cost - user.balance);

  let result;
  try {
    result = buyFreeSpins(user.id, caseData, count, cost,
      (serverSeed, clientSeed, nonce) => {
        const roll = computeRoll(serverSeed, clientSeed, nonce);
        return { item: pickItem(caseData, roll), roll };
      });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, cost - user.balance);
    throw err;
  }

  const grant = {
    type: 'freespins',
    caseId: caseData.id,
    count: result.count,
    capped: result.capped,
    spins: result.spins,
    total: result.total,
  };

  // Серию запоминаем до того, как игрок её досмотрит: закроет кейс на середине
  // - при следующем заходе она доиграется, а не пропадёт.
  savePendingSpins(user.id, caseData.id, grant);
  trackEvent(user.id, 'freespins_bought', { caseId: caseData.id, count: result.count, cost: result.cost });

  res.json({
    // Форма ответа повторяет выдачу фриспинов из кейса: клиент проигрывает их
    // той же анимацией, что и выпавшие.
    grant,
    cost: result.cost,
    balance: result.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/* ============================================================
   РУЛЕТКА
   ============================================================ */

app.post('/api/roulette', auth, limits.play, gameGate('roulette'), (req, res) => {
  const bet = parseBet(req.body?.bet);
  const color = String(req.body?.color || '');

  if (!bet) return res.status(400).json({ error: 'Некорректная ставка' });
  if (!ROULETTE_CONFIG.payouts[color]) {
    return res.status(400).json({ error: 'Некорректный цвет' });
  }

  const user = req.player;
  if (user.balance < bet) return sendInsufficient(res, bet - user.balance);

  let result;
  try {
    result = playInstantRound(user.id, bet, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      const slot = rouletteSlotFromRoll(roll);
      const landed = rouletteColorOf(slot);
      const won = landed === color;
      const payout = won ? bet * ROULETTE_CONFIG.payouts[color] : 0;

      return {
        game: 'roulette',
        title: 'Рулетка',
        subtitle: won
          ? `${labelOf(landed)} - забрал ${payout}`
          : `${labelOf(landed)} - мимо`,
        payout,
        tier: won ? (landed === 'green' ? 'unique' : 'epic') : 'common',
        roll,
        slot,
        landed,
        won,
      };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, bet - user.balance);
    throw err;
  }

  res.json({
    slot: result.slot,
    landed: result.landed,
    won: result.won,
    payout: result.payout,
    net: result.payout - bet,
    balance: result.balance,
    fair: { roll: result.roll, nonce: result.nonce },
    user: publicUser(getUserById(user.id)),
  });
});

function labelOf(colorId) {
  return ROULETTE_CONFIG.colors.find((c) => c.id === colorId)?.label || colorId;
}

/* ============================================================
   КРАШ
   ============================================================ */

app.post('/api/crash/start', auth, limits.play, gameGate('crash'), (req, res) => {
  const bet = parseBet(req.body?.bet);
  if (!bet) return res.status(400).json({ error: 'Некорректная ставка' });

  const user = req.player;
  if (user.balance < bet) return sendInsufficient(res, bet - user.balance);

  let round;
  try {
    round = startCrashRound(user.id, bet, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { crashPoint: crashPointFromRoll(roll), roll };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, bet - user.balance);
    throw err;
  }

  // crashPoint намеренно не отдаём — иначе клиент знал бы будущее.
  res.json({
    roundId: round.roundId,
    startedAt: round.startedAt,
    serverTime: Date.now(),
    bet,
    balance: round.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/**
 * Опрос состояния раунда. Клиент дёргает это каждые ~150 мс, чтобы узнать,
 * не взорвалось ли — раньше времени точку краша он получить не может.
 */
app.post('/api/crash/state', auth, (req, res) => {
  const round = getCrashRound(Number(req.body?.roundId), req.player.id);
  if (!round) return res.status(404).json({ error: 'Раунд не найден' });

  if (round.status !== 'running') {
    return res.json({
      status: round.status,
      crashPoint: round.crash_point,
      cashedAt: round.cashed_at,
    });
  }

  const elapsed = Date.now() - round.started_at;
  const current = crashMultiplierAt(elapsed);

  if (current >= round.crash_point) {
    const result = finishCrashRound(round.id, req.player.id, 'busted', null);
    return res.json({
      status: 'busted',
      crashPoint: round.crash_point,
      payout: 0,
      balance: result?.balance ?? getUserById(req.player.id).balance,
      user: publicUser(getUserById(req.player.id)),
    });
  }

  res.json({
    status: 'running',
    multiplier: Number(current.toFixed(2)),
    elapsed,
  });
});

app.post('/api/crash/cashout', auth, limits.play, (req, res) => {
  const round = getCrashRound(Number(req.body?.roundId), req.player.id);
  if (!round) return res.status(404).json({ error: 'Раунд не найден' });
  if (round.status !== 'running') {
    return res.status(400).json({ error: 'Раунд уже завершён', status: round.status });
  }

  // Момент вывода считается по часам сервера, а не по тому, что прислал клиент.
  const elapsed = Date.now() - round.started_at;
  const current = crashMultiplierAt(elapsed);

  if (current >= round.crash_point) {
    const result = finishCrashRound(round.id, req.player.id, 'busted', null);
    return res.json({
      status: 'busted',
      crashPoint: round.crash_point,
      payout: 0,
      balance: result?.balance ?? getUserById(req.player.id).balance,
      user: publicUser(getUserById(req.player.id)),
    });
  }

  const cashedAt = Number(current.toFixed(2));
  const result = finishCrashRound(round.id, req.player.id, 'cashed', cashedAt);
  if (!result) return res.status(400).json({ error: 'Раунд уже завершён' });

  res.json({
    status: 'cashed',
    cashedAt,
    payout: result.payout,
    crashPoint: round.crash_point,
    net: result.payout - round.bet,
    balance: result.balance,
    user: publicUser(getUserById(req.player.id)),
  });
});

/**
 * Незавершённая серия фриспинов.
 *
 * Деньги за неё уже на балансе, поэтому это только показ: клиент доигрывает
 * прокруты и подтверждает через /api/freespins/ack.
 */
app.post('/api/freespins/pending', auth, (req, res) => {
  res.json({ pending: getPendingSpins(req.player.id) });
});

app.post('/api/freespins/ack', auth, (req, res) => {
  clearPendingSpins(req.player.id);
  res.json({ ok: true });
});

/* ============================================================
   ПРОМОКОДЫ
   ============================================================ */

/** Кейс для промокода описывается ровно тем, что нужно хранилищу. */
function promoCaseResolver(caseId) {
  const c = getCase(caseId);
  return c ? { name: c.name, price: c.price, rtp: c.rtp } : null;
}

app.post('/api/promo/redeem', auth, limits.guess, (req, res) => {
  let result;
  try {
    result = redeemPromo(req.player.id, req.body?.code, promoCaseResolver);
  } catch (err) {
    if (err.code === 'PROMO' || err.code === 'BAD') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  trackEvent(req.player.id, 'promo_redeemed', { type: result?.type });
  res.json({ result, user: publicUser(getUserById(req.player.id)) });
});

/** Всё, что показывается в разделе «Бонусы». */
app.post('/api/promo/state', auth, (req, res) => {
  res.json({
    pendingDeposit: pendingDepositBonus(req.player.id),
    history: myPromoRedemptions(req.player.id),
    wagerRequired: req.player.wager_required || 0,
  });
});

/* ============================================================
   ПАРТНЁРУ
   ============================================================ */

/**
 * Статистика партнёра для него самого.
 *
 * Партнёр опознаётся по Telegram ID своего аккаунта: отдельного входа нет,
 * он открывает то же приложение, что и игроки.
 */
app.post('/api/partner/stats', auth, limits.read, (req, res) => {
  const partner = getPartnerByTgId(req.player.tg_id);
  if (!partner) return res.status(403).json({ error: 'Вы не партнёр' });

  const stats = partnerStats(partner.id);
  res.json({
    ...stats,
    referrals: partnerReferrals(partner.id),
    referralCount: stats.referrals,
    payouts: partnerPayoutHistory(partner.id),
    promos: adminListPromos().filter((p) => p.partner_id === partner.id)
      .map((p) => ({ code: p.code, type: p.type, used: p.used_count })),
  });
});

/* ============================================================
   АДМИНКА: ПРОМОКОДЫ И ПАРТНЁРЫ
   ============================================================ */

app.post('/api/admin/promos', auth, need('promo.view'), (req, res) => {
  res.json({ rows: adminListPromos(), cases: CASES.map((c) => ({ id: c.id, name: c.name, price: c.price })) });
});

app.post('/api/admin/promo/save', auth, need('promo.edit'), (req, res) => {
  try {
    res.json(adminSavePromo(req.player.id, req.body || {}));
  } catch (err) {
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/promo/delete', auth, need('promo.edit'), (req, res) => {
  try {
    res.json(adminDeletePromo(req.player.id, Number(req.body?.id)));
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/partners', auth, need('partners.view'), (req, res) => {
  res.json({ rows: adminListPartners() });
});

app.post('/api/admin/partner/save', auth, need('partners.edit'), (req, res) => {
  try {
    res.json(adminSavePartner(req.player.id, req.body || {}));
  } catch (err) {
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/partner/pay', auth, need('partners.pay'), (req, res) => {
  try {
    res.json(adminPayPartner(req.player.id, Number(req.body?.partnerId),
                             req.body?.amount, req.body?.comment));
  } catch (err) {
    if (err.code === 'BAD' || err.code === 'NOT_FOUND') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

/* ============================================================
   ПРОЧЕЕ
   ============================================================ */

// Бонус по таймеру отключён — раздача единиц обесценивала ставку.
app.post('/api/bonus', auth, limits.play, (req, res) => {
  res.status(410).json({ error: 'disabled', message: 'Бонус больше не выдаётся' });
});

app.post('/api/history', auth, limits.read, (req, res) => {
  const caseTitle = req.body?.caseTitle ? String(req.body.caseTitle).slice(0, 64) : null;
  const limit = Math.min(60, Math.max(1, Number(req.body?.limit) || 60));
  res.json({ history: getHistory(req.player.id, limit, caseTitle) });
});

/* ============================================================
   КАССА
   ============================================================ */

app.post('/api/wallet', auth, limits.read, (req, res) => {
  const pending = pendingPayoutTotal(req.player.id);
  res.json({
    balance: req.player.balance,
    pending,
    /*
     * Доступное к выводу: весь баланс, если пополнение прокручено ставками, и
     * ноль, пока не прокручено. Заявка списывает сумму сразу, поэтому
     * ожидающие показываются отдельной строкой и здесь уже не участвуют.
     */
    available: withdrawable(req.player),
    // Сколько ещё надо поставить, чтобы открылся вывод. Игрок должен видеть
    // расстояние до цели, а не только слово «нельзя».
    depositDebt: req.player.deposit_debt || 0,
    wagerProgress: req.player.wager_progress,
    minPayout: minPayoutNow(),
    deposits: getDeposits(req.player.id),
    payouts: getPayouts(req.player.id),
  });
});

app.post('/api/payout/create', auth, limits.cashier, (req, res) => {
  if (!setting('payouts_open')) {
    return res.status(503).json({ error: 'Приём заявок на вывод временно закрыт' });
  }
  const amount = Math.trunc(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Укажите сумму вывода' });
  }
  if (amount < minPayoutNow()) {
    return res.status(400).json({
      error: `Минимальная сумма вывода ${minPayoutNow().toLocaleString('ru-RU')}`,
    });
  }

  try {
    const result = createPayout(req.player.id, amount, {
      method: req.body?.method,
      phone: req.body?.phone,
      bank: req.body?.bank,
      cardNumber: req.body?.cardNumber,
      cryptoCurrency: req.body?.cryptoCurrency,
      cryptoNetwork: req.body?.cryptoNetwork,
      cryptoAddress: req.body?.cryptoAddress,
      cryptoAmount: req.body?.cryptoAmount,
      cryptoRate: req.body?.cryptoRate,
    });
    trackEvent(req.player.id, 'payout_created', { amount, method: req.body?.method });
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    // Ожидаемые отказы: игроку показывается сообщение, а не «что-то пошло не
    // так». WAGER - невыполненный отыгрыш бонуса, остальные - проверки
    // реквизитов платёжного модуля.
    if ([
      'MIN', 'INSUFFICIENT_FUNDS', 'WAGER', 'WAGER_PROGRESS',
      'BAD_PHONE', 'BAD_BANK', 'BAD_CARD', 'BAD_METHOD', 'PAYOUT_KEY_MISSING',
      'BAD_CURRENCY', 'BAD_NETWORK', 'BAD_ADDRESS', 'BAD_RATE',
    ].includes(err.code)) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    throw err;
  }
});

app.post('/api/payout/cancel', auth, limits.cashier, (req, res) => {
  try {
    const result = cancelPayout(req.player.id, Number(req.body?.id));
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'RESOLVED') return res.status(400).json({ error: err.message });
    throw err;
  }
});

/* ============================================================
   РИСК-ИГРА
   ============================================================ */

app.post('/api/gamble/pick', auth, limits.play, (req, res) => {
  const index = Math.trunc(Number(req.body?.index));
  if (!Number.isInteger(index) || index < 0 || index >= GAMBLE_CONFIG.cards) {
    return res.status(400).json({ error: 'Некорректный выбор карты' });
  }

  let result;
  try {
    result = playGamble(req.player.id, index, GAMBLE_CONFIG, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      return { acePosition: gambleAceFromRoll(roll), roll };
    });
  } catch (err) {
    if (err.code === 'NO_STAKE') return res.status(400).json({ error: 'Нечем рисковать' });
    throw err;
  }

  res.json({
    won: result.won,
    acePosition: result.acePosition,
    payout: result.payout,
    stake: result.stake,
    balance: result.balance,
    fair: { roll: result.roll, nonce: result.nonce },
    user: publicUser(getUserById(req.player.id)),
  });
});

app.post('/api/gamble/skip', auth, limits.play, (req, res) => {
  clearGamble(req.player.id);
  res.json({ user: publicUser(getUserById(req.player.id)) });
});

/* ============================================================
   АПГРЕЙД
   ============================================================ */

app.post('/api/upgrade', auth, limits.play, gameGate('upgrade'), (req, res) => {
  const stake = parseBet(req.body?.stake);
  const multiplier = Number(req.body?.multiplier);

  if (!stake || stake < UPGRADE_CONFIG.minStake) {
    return res.status(400).json({ error: `Минимальная ставка - ${UPGRADE_CONFIG.minStake}` });
  }
  if (!UPGRADE_CONFIG.multipliers.includes(multiplier)) {
    return res.status(400).json({ error: 'Недоступный множитель' });
  }
  if (req.player.balance < stake) return sendInsufficient(res, stake);

  const target = upgradeTarget(stake, multiplier);
  const chance = upgradeChance(stake, target);

  const result = playInstantRound(req.player.id, stake, (serverSeed, clientSeed, nonce) => {
    const roll = computeRoll(serverSeed, clientSeed, nonce);
    const won = upgradeWinFromRoll(roll, chance);
    return {
      game: 'upgrade',
      title: 'Апгрейд',
      subtitle: won ? `x${multiplier} - попал` : `x${multiplier} - мимо`,
      payout: won ? target : 0,
      tier: won ? 'legendary' : 'common',
      roll,
      won,
    };
  });

  res.json({
    won: result.won,
    stake,
    target,
    multiplier,
    // Угол стрелки: ролл — это доля круга от верхней точки. Сектор выигрыша
    // клиент рисует сам от нуля до chance, поэтому картинка проверяема.
    chance,
    balance: result.balance,
    fair: { roll: result.roll, nonce: result.nonce },
    user: publicUser(getUserById(req.player.id)),
  });
});

/* ============================================================
   БЕСПЛАТНЫЙ КЕЙС ЗА ПОДПИСКУ
   ============================================================ */

/* ============================================================
   КОЛЕСО ФОРТУНЫ
   ============================================================ */

/**
 * Состояние колеса: шаги, остаток прокрутов, когда следующий.
 *
 * Описание секторов отдаётся вместе с состоянием, а не лежит в клиенте:
 * иначе при правке весов пришлось бы помнить про два места, и колесо
 * останавливалось бы не на том, что показало окно выигрыша.
 */
/* ============================================================
   МИНИ-ИГРЫ
   ============================================================ */

/**
 * Один раунд мини-игры.
 *
 * Исход решает сервер и отдаёт вместе с ним ИНДЕКС исхода. Клиент по нему
 * рисует именно тот сектор, ту клетку и ту грань, которые соответствуют
 * результату. Без индекса анимация подбирала бы картинку сама, и однажды
 * колесо встало бы не на то, что написано в окне выигрыша, - а это уже не
 * косметика, а обман игрока.
 */
app.post('/api/mini/play', auth, limits.play, gameGate('mini'), (req, res) => {
  const game = getMinigame(req.body?.gameId);
  if (!game) return res.status(400).json({ error: 'Игра не найдена' });

  const optionIndex = Math.trunc(Number(req.body?.option) || 0);
  if (!game.options[optionIndex]) {
    return res.status(400).json({ error: 'Такого варианта нет' });
  }

  const bet = parseBet(req.body?.bet);
  if (!bet) return res.status(400).json({ error: 'Некорректная ставка' });
  if (bet < game.minBet || bet > game.maxBet) {
    return res.status(400).json({
      error: `Ставка от ${game.minBet.toLocaleString('ru-RU')} до ${game.maxBet.toLocaleString('ru-RU')}`,
    });
  }

  const user = req.player;
  if (user.balance < bet) return sendInsufficient(res, bet - user.balance);

  /*
   * Ячейка, которую игрок ткнул, приходит вместе со ставкой и на исход не
   * влияет: ячейки равноправны, и разыгрывается не «что лежит под третьей»,
   * а «сколько платит эта попытка». Номер нужен только рисунку - подсветить
   * надо именно ту ячейку, по которой нажали.
   */
  const picked = Math.max(0, Math.trunc(Number(req.body?.picked) || 0));

  let result;
  try {
    result = playInstantRound(user.id, bet, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      const outcome = resolveMinigame(game, optionIndex, roll);
      const payout = Math.round(bet * outcome.multiplier);
      const option = game.options[optionIndex];

      return {
        game: 'mini',
        title: game.name,
        subtitle: outcome.win
          ? `${option.label} - ×${outcome.multiplier}`
          : `${option.label} - мимо`,
        payout,
        tier: !outcome.win ? 'common'
            : outcome.multiplier >= 50 ? 'unique'
            : outcome.multiplier >= 10 ? 'mythic'
            : outcome.multiplier >= 3 ? 'epic'
            : 'rare',
        roll,
        multiplier: outcome.multiplier,
        outcomeIndex: outcome.outcomeIndex,
        win: outcome.win,
      };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, bet - user.balance);
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }

  trackEvent(user.id, 'mini_played', { gameId: game.id, bet, win: result.win });

  res.json({
    gameId: game.id,
    option: optionIndex,
    picked,
    win: result.win,
    multiplier: result.multiplier,
    outcomeIndex: result.outcomeIndex,
    payout: result.payout,
    bet,
    roll: result.roll,
    nonce: result.nonce,
    balance: result.balance,
    user: publicUser(getUserById(user.id)),
  });
});

app.post('/api/fortune/state', auth, limits.read, (req, res) => {
  res.json({
    ...fortuneState(req.player.id),
    history: fortuneHistory(req.player.id),
    wheel: {
      segments: FORTUNE_SEGMENTS.map((s) => ({ index: s.index, type: s.type, label: s.label })),
      segmentDeg: SEGMENT_DEG,
      startDeg: SEGMENTS_START_DEG,
    },
    prizes: {
      percentMin: PERCENT_MIN, percentMax: PERCENT_MAX,
      voucherMin: VOUCHER_MIN, voucherMax: VOUCHER_MAX,
      cash: CASH_PRIZE, giftCaseMaxPrice: GIFT_CASE_MAX_PRICE,
    },
  });
});

/**
 * Прокрут. Ограничитель тот же, что у кассы: денежная ручка, и дёргать её
 * вплотную незачем - всё равно раз в сутки.
 */
app.post('/api/fortune/spin', auth, limits.cashier, gameGate('fortune'), (req, res) => {
  let result;
  try {
    result = playFortuneSpin(req.player.id, CASES);
  } catch (err) {
    if (err.code === 'FORTUNE_EMPTY' || err.code === 'FORTUNE_COOLDOWN') {
      return res.status(400).json({ error: err.code, message: err.message, readyAt: err.readyAt });
    }
    throw err;
  }

  const c = result.prize.caseId ? getCase(result.prize.caseId) : null;
  res.json({
    prize: {
      ...result.prize,
      caseName: c?.name || null,
      casePrice: c?.price || 0,
    },
    user: publicUser(getUserById(req.player.id)),
    state: fortuneState(req.player.id),
  });
});

app.post('/api/free-case/state', auth, (req, res) => {
  if (!subscriptionConfigured()) return res.json({ enabled: false });
  const state = freeCaseState(req.player.id, FREE_CASE_COOLDOWN_MS);
  res.json({ enabled: true, ...subscriptionConfig(), ...state });
});

app.post('/api/free-case/claim', auth, limits.cashier, async (req, res) => {
  if (!subscriptionConfigured()) {
    return res.status(503).json({
      error: 'Бесплатный кейс ещё не настроен',
      message: 'Раздел включится, когда будут заданы канал и кейс - см. NEDOSTATOK.md',
    });
  }

  const { caseId } = subscriptionConfig();
  if (!getCase(caseId)) {
    return res.status(500).json({ error: `Кейс ${caseId} не найден в конфигурации` });
  }

  const check = await isSubscribed(req.player.tg_id);

  if (!check.ok) {
    // Сеть или права бота — это наша проблема, а не игрока, и говорить
    // ему «вы не подписаны» в такой ситуации нельзя.
    const message = check.reason === 'network'
      ? 'Telegram не ответил, попробуйте ещё раз'
      : 'Проверка подписки недоступна, мы уже чиним';
    return res.status(503).json({ error: message });
  }

  if (!check.subscribed) {
    return res.status(403).json({
      error: 'Подпишитесь на канал',
      channelUrl: subscriptionConfig().channelUrl,
    });
  }

  const granted = grantFreeCase(req.player.id, caseId, FREE_CASE_COOLDOWN_MS);
  if (!granted.ok) {
    return res.status(429).json({ error: 'Кейс уже получен', readyAt: granted.readyAt });
  }

  res.json({
    ok: true,
    caseId,
    readyAt: granted.readyAt,
    vouchers: getVouchers(req.player.id),
    user: publicUser(getUserById(req.player.id)),
  });
});

app.post('/api/fair/client-seed', auth, (req, res) => {
  const raw = String(req.body?.seed ?? '').trim();
  const seed = raw || generateClientSeed();
  if (seed.length > 64 || !/^[\w-]+$/.test(seed)) {
    return res.status(400).json({
      error: 'Seed: до 64 символов, только буквы, цифры, дефис и подчёркивание',
    });
  }
  setClientSeed(req.player.id, seed);
  res.json({ user: publicUser(getUserById(req.player.id)) });
});

app.post('/api/fair/rotate', auth, limits.guess, (req, res) => {
  const result = rotateServerSeed(req.player.id);
  res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
});

/* ============================================================
   АДМИНКА
   ============================================================ */

app.post('/api/admin/overview', auth, need('reports.view'), (req, res) => {
  res.json({ ...adminOverview(), recent: adminRecentRounds(30) });
});

/**
 * Воронка: сколько игроков дошло до каждого шага.
 *
 * Период ограничен сверху: запрос за всё время прочитал бы таблицу событий
 * целиком, а она растёт быстрее всех остальных.
 */
app.post('/api/admin/funnel', auth, need('reports.view'), (req, res) => {
  const days = Math.min(90, Math.max(1, Math.trunc(Number(req.body?.days) || 7)));
  res.json({ funnel: funnelStats(days), events: eventTotals(days) });
});

app.post('/api/admin/users', auth, need('players.view'), (req, res) => {
  const query = String(req.body?.query || '').slice(0, 64);
  const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 30));
  const offset = Math.max(0, Number(req.body?.offset) || 0);
  res.json(adminUsers({ query, limit, offset }));
});

app.post('/api/admin/user', auth, need('players.view'), (req, res) => {
  const detail = adminUserDetail(Number(req.body?.userId));
  if (!detail) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(detail);
});

app.post('/api/admin/balance', auth, need('players.balance'), (req, res) => {
  const targetId = Number(req.body?.userId);
  const amount = Math.trunc(Number(req.body?.amount));

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Укажите ненулевую сумму' });
  }
  if (Math.abs(amount) > 100_000_000) {
    return res.status(400).json({ error: 'Слишком большая сумма' });
  }

  /*
   * Потолок одной правки. Он не про недоверие к поддержке, а про опечатку:
   * компенсация зависшего прокрута на 500 с промахом в три нуля уходит без
   * единой проверки, и заметят её в отчёте через неделю. Подтверждение здесь
   * не помогло бы - его нажимают не глядя.
   */
  const cap = balanceCapFor(req.staff);
  if (cap > 0 && Math.abs(amount) > cap) {
    return res.status(403).json({
      error: `Правка больше ${cap.toLocaleString('ru-RU')} вам недоступна`,
    });
  }

  try {
    // asDeposit=false - это корректировка: деньги доходят без долга по обороту.
    // По умолчанию начисление считается пополнением и требует отыгрыша.
    const result = adminAdjustBalance(
      req.player.id, targetId, amount, String(req.body?.note || '').slice(0, 200),
      { asDeposit: req.body?.asDeposit !== false }
    );
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/block', auth, need('players.block'), (req, res) => {
  const targetId = Number(req.body?.userId);
  if (targetId === req.player.id) {
    return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });
  }
  try {
    res.json(adminSetBlocked(req.player.id, targetId, !!req.body?.blocked));
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/voucher', auth, need('players.gift'), (req, res) => {
  const targetId = Number(req.body?.userId);
  const caseId = String(req.body?.caseId || '');
  const count = Math.min(100, Math.max(1, Math.trunc(Number(req.body?.count) || 1)));

  if (!getCase(caseId)) return res.status(400).json({ error: 'Кейс не найден' });

  try {
    res.json({ vouchers: adminGrantVoucher(req.player.id, targetId, caseId, count) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/payouts', auth, need('finance.payouts.view'), (req, res) => {
  const status = ['pending', 'processing', 'paid', 'rejected', 'cancelled', 'all']
    .includes(req.body?.status) ? req.body.status : 'pending';
  res.json({ rows: adminPayouts(status), stats: payoutStats() });
});

app.post('/api/admin/payout/resolve', auth, need('finance.payouts.resolve'), (req, res) => {
  const id = Number(req.body?.id);
  const status = String(req.body?.status || '');
  const comment = String(req.body?.comment || '').slice(0, 300);

  try {
    let result;
    if (status === 'processing') result = startPayout(req.player.id, id, comment);
    else if (status === 'paid') result = completePayout(req.player.id, id, comment);
    else result = resolvePayout(req.player.id, id, status, comment);
    res.json({ ...result, stats: payoutStats() });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'RESOLVED' || err.code === 'BAD_STATUS') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

/* ============================================================
   КРИПТОКАССА HELEKET
   ============================================================ */

/**
 * Что доступно к оплате: монеты, сети и курсы.
 *
 * Курсы отдаются здесь же, а не отдельной ручкой: интерфейсу они нужны ровно
 * в тот момент, когда он рисует список монет, и второй запрос был бы лишним
 * походом по сети ради тех же данных.
 */
app.post('/api/crypto/options', auth, limits.read, async (req, res) => {
  if (!crypto.isConfigured()) return res.json({ enabled: false, coins: [], rates: {} });
  try {
    const [coins, rates] = await Promise.all([crypto.coins(), crypto.rates()]);
    res.json({
      enabled: true,
      coins,
      rates,
      min: crypto.CRYPTO_MIN,
      max: crypto.CRYPTO_MAX,
    });
  } catch (err) {
    res.status(503).json({ error: err.code || 'GATEWAY_ERROR', message: err.message });
  }
});

app.post('/api/crypto/create', auth, limits.cashier, async (req, res) => {
  if (!setting('deposits_open')) {
    return res.status(503).json({ error: 'Приём пополнений временно закрыт' });
  }

  try {
    const payment = await crypto.createDeposit(
      req.player.id, req.body?.amount, req.body?.currency, req.body?.network
    );
    res.status(201).json(payment);
  } catch (err) {
    const status = err.code === 'GATEWAY_UNREACHABLE' || err.code === 'NOT_CONFIGURED' ? 503 : 400;
    res.status(status).json({ error: err.code || 'CRYPTO_ERROR', message: err.message });
  }
});

app.post('/api/crypto/list', auth, limits.read, (req, res) => {
  res.json({ rows: crypto.listDeposits(req.player.id) });
});

/**
 * Сверка платежа со шлюзом по просьбе игрока.
 *
 * Нужна, когда вебхук не дошёл: сеть моргнула, приложение перезапускалось.
 * Без неё деньги висели бы до ручного разбора, а игрок видел бы «ожидание»
 * при уже отправленном переводе.
 */
app.post('/api/crypto/refresh', auth, limits.cashier, async (req, res) => {
  try {
    const result = await crypto.refreshDeposit(req.body?.id, req.player.id);
    if (result.credited) {
      emitPayment(req.player.id, 'payment.completed', { source: 'crypto' });
    }
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: err.code || 'CRYPTO_ERROR', message: err.message });
  }
});

/**
 * Вебхук шлюза.
 *
 * Отвечаем 200 на всё, что подписано нашим ключом, даже если платёж уже был
 * зачислен: шлюз повторяет доставку до успешного ответа, и на любой другой
 * код он будет ломиться снова и снова. Защита от повторного зачисления живёт
 * в базе, а не в коде ответа.
 */
app.post('/api/webhooks/heleket', limits.webhook, (req, res) => {
  if (!crypto.webhookIpAllowed(req.ip)) {
    return res.status(403).json({ error: 'Чужой адрес' });
  }
  if (!crypto.verifyWebhook(req.body)) {
    return res.status(401).json({ error: 'Подпись не совпала' });
  }

  try {
    const result = crypto.applyWebhook(req.body);
    if (result.credited) emitPayment(result.userId, 'payment.completed', { source: 'crypto' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(200).json({ ok: true, unknown: true });
    throw err;
  }
});

/* ============================================================
   ПОПОЛНЕНИЯ BEELINE, REALTIME И ФИНАНСОВАЯ ПОДДЕРЖКА
   ============================================================ */

const paymentStreams = new Map();
function emitPayment(userId, event, data) {
  for (const res of paymentStreams.get(userId) || []) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

app.get('/api/payments/events', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders(); res.write('event: connected\ndata: {}\n\n');
  const set = paymentStreams.get(req.player.id) || new Set(); set.add(res); paymentStreams.set(req.player.id, set);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 25000);
  req.on('close', () => { clearInterval(keepalive); set.delete(res); if (!set.size) paymentStreams.delete(req.player.id); });
});

app.post('/api/payments/create', auth, limits.cashier, (req, res) => {
  if (!setting('deposits_open')) {
    return res.status(503).json({ error: 'Приём пополнений временно закрыт' });
  }

  try { res.status(201).json(createPayment(req.player.id, req.body?.amount, String(req.body?.bank || ''))); }
  catch (err) { res.status(400).json({ error: err.code || 'PAYMENT_ERROR', message: err.message }); }
});
app.post('/api/payments/list', auth, limits.read, (req, res) => res.json({ rows: listPayments(req.player.id) }));
app.post('/api/payments/get', auth, (req, res) => {
  const row = getPayment(Number(req.body?.id), req.player.id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' }); res.json(row);
});

function deviceAuth(req, res, next) {
  try {
    verifyDeviceRequest({ deviceId: req.get('X-Device-Id'), timestamp: req.get('X-Timestamp'),
      nonce: req.get('X-Nonce'), signature: req.get('X-Signature'), rawBody: req.rawBody || '' });
    req.deviceId = req.get('X-Device-Id'); next();
  } catch (err) { res.status(err.status || 401).json({ error: err.message }); }
}
app.post('/api/webhooks/beeline', limits.webhook, deviceAuth, (req, res) => {
  try {
    const result = processBeelineSms({ amount: req.body?.amount, message: String(req.body?.message || ''), deviceId: req.deviceId });
    emitPayment(result.userId, 'payment.completed', result); res.json({ ok: true, ...result });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
app.post('/api/webhooks/beeline/heartbeat', limits.webhook, deviceAuth, (req, res) => { heartbeat(req.deviceId); res.json({ ok: true, serverTime: Date.now() }); });

app.post('/api/support/open', auth, (req, res) => res.status(201).json(openDispute(req.player.id, Number(req.body?.paymentId))));
app.post('/api/support/chat', auth, (req, res) => {
  const data = supportChat(Number(req.body?.chatId));
  if (!data.chat || data.chat.user_id !== req.player.id) return res.status(404).json({ error: 'Чат не найден' }); res.json(data);
});
app.post('/api/support/message', auth, limits.cashier, (req, res) => {
  const data = supportChat(Number(req.body?.chatId));
  if (!data.chat || data.chat.user_id !== req.player.id) return res.status(404).json({ error: 'Чат не найден' });
  addSupportMessage(data.chat.id, 'USER', req.player.id, String(req.body?.text || '').slice(0, 2000),
    req.body?.attachmentUrl, String(req.body?.attachmentName || '').slice(0, 200));
  res.status(201).json(supportChat(data.chat.id));
});
app.post('/api/support/upload', auth, limits.cashier, (req, res) => {
  const mime=String(req.body?.mime||''), name=String(req.body?.name||'file').replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,100);
  const allowed={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
  if (!allowed[mime]) return res.status(400).json({error:'Разрешены JPG, PNG, WebP и PDF'});
  let bytes; try { bytes=Buffer.from(String(req.body?.base64||''),'base64'); } catch { return res.status(400).json({error:'Файл повреждён'}); }
  if (!bytes.length || bytes.length>5*1024*1024) return res.status(400).json({error:'Размер файла: до 5 МБ'});
  const dir=join(__dirname,'..','data','support-uploads'); mkdirSync(dir,{recursive:true});
  const file=`${req.player.id}-${randomUUID()}.${allowed[mime]}`; writeFileSync(join(dir,file),bytes,{flag:'wx'});
  res.status(201).json({url:`/api/support/files/${file}`,name});
});
app.get('/api/support/files/:file', auth, (req,res) => {
  const file=String(req.params.file); if(!new RegExp(`^${req.player.id}-[0-9a-f-]+\\.(jpg|png|webp|pdf)$`,'i').test(file)) return res.status(404).end();
  res.sendFile(join(__dirname,'..','data','support-uploads',file));
});

app.post('/api/admin/payments', auth, need('finance.payments.view'), (req, res) => res.json({ rows: adminPayments(String(req.body?.status || 'ALL')), dashboard: paymentDashboard() }));
app.post('/api/admin/payment-settings', auth, need('finance.settings'), (req, res) => {
  try { res.json(req.body?.save ? updatePaymentSettings(req.body.values || {}) : paymentSettings()); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/admin/payment-devices', auth, need('finance.settings'), (req, res) => res.json({ rows: adminDevices() }));
app.post('/api/admin/payment-device/register', auth, need('finance.settings'), (req, res) => {
  const id=String(req.body?.deviceId||'').trim(), secret=String(req.body?.secret||'');
  if (!id || secret.length < 24) return res.status(400).json({ error: 'ID обязателен, секрет — минимум 24 символа' });
  registerDevice(id, String(req.body?.name||id).slice(0,80), secret); res.status(201).json({ ok:true });
});
/* ============================================================
   БЭК-ОФИС: СОТРУДНИКИ, ЖУРНАЛ, НАСТРОЙКИ, РИСК, ОТЧЁТЫ
   ============================================================ */

/**
 * Что этот сотрудник может. Клиент рисует панель по этому ответу и ничего
 * не додумывает: раздела, на который нет права, он просто не строит.
 *
 * Это удобство, а не защита. Защита - need() на каждой ручке: спрятанный
 * раздел открывается одной строкой в консоли браузера.
 */
app.post('/api/admin/me', auth, adminOnly, (req, res) => {
  const role = ROLE_BY_ID.get(req.staff?.role);
  res.json({
    role: req.staff?.role || null,
    roleName: role?.name || '',
    permissions: [...req.perms],
    balanceCap: balanceCapFor(req.staff),
    note: req.staff?.note || '',
    sections: {
      players: req.perms.has('players.view'),
      finance: req.perms.has('finance.payouts.view') || req.perms.has('finance.payments.view'),
      promo: req.perms.has('promo.view') || req.perms.has('partners.view'),
      support: req.perms.has('support.view'),
      risk: req.perms.has('risk.view'),
      reports: req.perms.has('reports.view'),
      journal: req.perms.has('journal.view'),
      staff: req.perms.has('staff.manage'),
      settings: req.perms.has('settings.manage'),
    },
  });
});

app.post('/api/admin/staff', auth, need('staff.manage'), (req, res) => {
  res.json({
    rows: staffList(),
    roles: publicRoles(),
    assignable: assignableRoles(req.perms, req.staff?.role).map((r) => r.id),
    permissions: PERMISSIONS,
    groups: PERMISSION_GROUPS,
    // Выдать можно только то, что есть у себя: иначе любой, кому доверили
    // заводить поддержку, за два шага выписывает себе реквизиты приёма.
    grantable: [...req.perms],
    meId: req.player.id,
  });
});

app.post('/api/admin/staff/save', auth, need('staff.manage'), (req, res) => {
  const body = req.body || {};
  const role = String(body.role || '');
  if (!ROLE_BY_ID.has(role)) return res.status(400).json({ error: 'Неизвестная роль' });

  const allowedRoles = assignableRoles(req.perms, req.staff?.role).map((r) => r.id);
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ error: 'Эта роль вам недоступна' });
  }

  const extra = (Array.isArray(body.extra) ? body.extra : []).filter(isPermission);
  const denied = (Array.isArray(body.denied) ? body.denied : []).filter(isPermission);
  const notMine = extra.filter((p) => !req.perms.has(p));
  if (notMine.length) {
    return res.status(403).json({ error: `Нельзя выдать то, чего нет у вас: ${notMine.join(', ')}` });
  }

  const target = findUserByAnyId(body.userKey);
  if (target) {
    const existing = staffRow(target.id);
    if (existing && !canManage(req.perms, req.staff?.role, existing.role)) {
      return res.status(403).json({ error: 'Эту запись вам править нельзя' });
    }
    // Снять права самому себе можно только по ошибке, и это ошибка, после
    // которой в панель никто не войдёт. Поэтому нельзя.
    if (target.id === req.player.id && body.active === false) {
      return res.status(400).json({ error: 'Нельзя выключить самого себя' });
    }
  }

  try {
    res.json({ rows: staffSave(req.player.id, { ...body, role, extra, denied }) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/staff/remove', auth, need('staff.manage'), (req, res) => {
  const userId = Number(req.body?.userId);
  if (userId === req.player.id) {
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  }
  const existing = staffRow(userId);
  if (!existing) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (!canManage(req.perms, req.staff?.role, existing.role)) {
    return res.status(403).json({ error: 'Эту запись вам править нельзя' });
  }
  res.json({ rows: staffRemove(req.player.id, userId) });
});

app.post('/api/admin/journal', auth, need('journal.view'), (req, res) => {
  res.json(adminJournal({
    limit: Math.min(200, Math.max(1, Number(req.body?.limit) || 80)),
    offset: Math.max(0, Number(req.body?.offset) || 0),
    adminId: Math.max(0, Number(req.body?.adminId) || 0),
    action: String(req.body?.action || '').slice(0, 40),
  }));
});

app.post('/api/admin/settings', auth, need('settings.manage'), (req, res) => {
  res.json({ rows: settingsAll() });
});

app.post('/api/admin/settings/save', auth, need('settings.manage'), (req, res) => {
  res.json({ rows: saveSettings(req.player.id, req.body?.patch || {}) });
});

app.post('/api/admin/player/note', auth, need('players.notes'), (req, res) => {
  const userId = Number(req.body?.userId);
  try {
    res.json({ notes: addPlayerNote(req.player.id, userId, req.body?.text, req.body?.pinned) });
  } catch (err) {
    if (err.code === 'BAD') return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/player/note/delete', auth, need('players.notes'), (req, res) => {
  try {
    res.json({ notes: deletePlayerNote(req.player.id, Number(req.body?.noteId)) });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/player/limits', auth, need('players.limits'), (req, res) => {
  const userId = Number(req.body?.userId);
  if (!getUserById(userId)) return res.status(404).json({ error: 'Игрок не найден' });
  res.json({
    limits: setPlayerLimits(req.player.id, userId, req.body?.patch || {}),
    day: dayActivity(userId),
    cooldownMs: LIMIT_COOLDOWN_MS,
  });
});

app.post('/api/admin/risk', auth, need('risk.view'), (req, res) => {
  res.json(riskSignals({ limit: Math.min(100, Math.max(5, Number(req.body?.limit) || 40)) }));
});

app.post('/api/admin/reports', auth, need('reports.view'), (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.body?.days) || 30));
  res.json({ days, daily: revenueDaily(days), cases: caseRevenueReport(days) });
});

/**
 * Выгрузка в CSV.
 *
 * Разделитель - точка с запятой, кодировка с BOM: Excel в русской локали
 * открывает запятую как разделитель дробной части и складывает всю строку в
 * одну ячейку. Это не придирка, это первое, обо что спотыкается любой отчёт.
 */
app.post('/api/admin/export', auth, need('reports.view'), (req, res) => {
  const kind = String(req.body?.kind || 'daily');
  const days = Math.min(180, Math.max(1, Number(req.body?.days) || 30));
  const date = (t) => new Date(t).toISOString().slice(0, 10);

  let head = [];
  let rows = [];
  if (kind === 'cases') {
    head = ['кейс', 'открытий', 'игроков', 'поставлено', 'выплачено', 'доход', 'отдача'];
    rows = caseRevenueReport(days).map((r) => [
      r.title, r.opened, r.players, r.wagered, r.paid, r.ggr,
      r.rtp === null ? '' : (r.rtp * 100).toFixed(2)]);
  } else {
    head = ['дата', 'раундов', 'игроков', 'поставлено', 'выплачено', 'доход',
            'отдача', 'пополнено', 'выведено', 'чистый приход', 'регистраций'];
    rows = revenueDaily(days).map((r) => [
      date(r.day), r.rounds, r.players, r.wagered, r.paid, r.ggr,
      r.rtp === null ? '' : (r.rtp * 100).toFixed(2),
      r.deposits, r.payouts, r.net, r.signups]);
  }

  const escape = (v) => {
    const text = String(v ?? '');
    return /[";\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const csv = '\ufeff' + [head, ...rows].map((r) => r.map(escape).join(';')).join('\r\n');
  logAdmin(req.player.id, 0, 'export', { note: kind, meta: { days, rows: rows.length } });
  res.type('text/csv; charset=utf-8').send(csv);
});

app.post('/api/admin/support', auth, need('support.view'), (req, res) => res.json({ rows: adminChats() }));
app.post('/api/admin/support/chat', auth, need('support.view'), (req, res) => res.json(supportChat(Number(req.body?.chatId))));
app.post('/api/admin/support/message', auth, need('support.reply'), (req, res) => {
  addSupportMessage(Number(req.body?.chatId),'ADMIN',req.player.id,String(req.body?.text||'').slice(0,2000),req.body?.attachmentUrl,String(req.body?.attachmentName||'').slice(0,200));
  res.status(201).json(supportChat(Number(req.body?.chatId)));
});

app.use((err, req, res, next) => {
  console.error('Ошибка запроса:', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  startFeed();

  console.log(`\n  LUCKYBOX запущен на http://localhost:${PORT}`);
  if (process.env.DEV_MODE === 'true') {
    console.log('  DEV_MODE включён - подпись Telegram не проверяется.');
  }
  console.log(`  Краш RTP: ${(gameReport.crashRtp * 100).toFixed(2)}%  ` +
              `Рулетка RTP: ${(gameReport.rouletteRtp * 100).toFixed(2)}%  ` +
              `Риск-игра RTP: ${(gambleReport.rtp * 100).toFixed(2)}%  ` +
              `Апгрейд RTP: ${(upgradeReport.rtp * 100).toFixed(2)}%`);
  console.log(`  Витрина: ${FEED_CONFIG.synthetic ? 'выдуманные выпадения включены' : 'только живые игроки'}` +
              `, порог x${FEED_CONFIG.minMultiplier}, пул ${FEED_CONFIG.poolSize}`);
  console.log(`  Бесплатный кейс за подписку: ${subscriptionConfigured() ? 'настроен' : 'выключен (нет канала/кейса)'}\n`);
  console.table(caseReport);
});
