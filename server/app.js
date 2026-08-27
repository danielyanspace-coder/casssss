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
  BONUS_CONFIG,
  claimBonus,
  finishCrashRound,
  getCrashRound,
  getHistory,
  getOrCreateUser,
  getUserById,
  playCaseRound,
  playCaseBatch,
  playInstantRound,
  rotateServerSeed,
  setClientSeed,
  startCrashRound,
  getVouchers,
  syncAdmins,
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
  createPayout,
  cancelPayout,
  resolvePayout,
  startPayout,
  completePayout,
  adminPayouts,
  payoutStats,
  grantFreeCase,
  freeCaseState,
  recentPublicDrops,
} from './db.js';
import { resolveUser } from './auth.js';
import {
  startFeed, getFeed, FEED_CONFIG, FEED_MIN_MULTIPLIER, FEED_MIN_VALUE,
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

// Администраторы задаются Telegram ID через настройки — не через базу,
// чтобы права нельзя было получить, дописав себе строку в таблицу.
const ADMIN_TG_IDS = String(process.env.ADMIN_TG_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
syncAdmins(ADMIN_TG_IDS);

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '8mb', verify: (req, res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
app.use(express.static(join(__dirname, '..', 'public'), { maxAge: '1h' }));

function auth(req, res, next) {
  const result = resolveUser(req);
  if (!result.ok) return res.status(401).json({ error: result.error });
  const player = getOrCreateUser(result.user);

  // Права админа берутся из настроек при каждом запросе: убрали ID из
  // ADMIN_TG_IDS — доступ пропал сразу, без перезапуска чужих сессий.
  const shouldBeAdmin = ADMIN_TG_IDS.includes(String(player.tg_id));
  if (!!player.is_admin !== shouldBeAdmin) {
    syncAdmins(ADMIN_TG_IDS);
    req.player = getUserById(player.id);
  } else {
    req.player = player;
  }

  if (req.player.is_blocked) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  next();
}

/** Пропускает дальше только администратора. */
function adminOnly(req, res, next) {
  if (!req.player.is_admin) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    balance: user.balance,
    isAdmin: !!user.is_admin,
    x2CaseId: user.x2_case_id,
    gambleStake: user.gamble_stake,
    gambleCase: user.gamble_case,
    vouchers: getVouchers(user.id),
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
    minPayout: MIN_PAYOUT,
  });
});

/* ============================================================
   ВИТРИНА КРУПНЫХ ВЫПАДЕНИЙ
   ============================================================ */

/**
 * Лента открыта без авторизации: она видна и до входа в Telegram.
 * Наружу уходят только ник, кейс и предмет — ни ID, ни балансов.
 */
app.get('/api/feed', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 40);
  const real = recentPublicDrops(limit, FEED_MIN_MULTIPLIER, FEED_MIN_VALUE);
  const shown = FEED_CONFIG.synthetic ? getFeed(limit) : [];

  // Настоящие выпадения идут первыми при равной свежести.
  const merged = [...real, ...shown]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  res.json({ drops: merged, minMultiplier: FEED_MIN_MULTIPLIER, minValue: FEED_MIN_VALUE });
});

app.post('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.player) });
});

/* ============================================================
   КЕЙСЫ
   ============================================================ */

/** Сколько одинаковых кейсов можно открыть за раз. */
const MAX_BATCH = 5;

app.post('/api/open', auth, (req, res) => {
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

  res.json({
    count,
    opened,
    // Поля одиночного открытия сохранены: на них опирается вся анимация.
    ...opened[0],
    totalSpent: opened.reduce((s, o) => s + (o.free ? 0 : caseData.price), 0),
    totalWon: opened.reduce((s, o) => s + o.item.value, 0),
    balance: last.balance,
    user: publicUser(getUserById(user.id)),
  });
});

/* ============================================================
   РУЛЕТКА
   ============================================================ */

app.post('/api/roulette', auth, (req, res) => {
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
          ? `${labelOf(landed)} — забрал ${payout}`
          : `${labelOf(landed)} — мимо`,
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

app.post('/api/crash/start', auth, (req, res) => {
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

app.post('/api/crash/cashout', auth, (req, res) => {
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

/* ============================================================
   ПРОЧЕЕ
   ============================================================ */

// Бонус по таймеру отключён — раздача единиц обесценивала ставку.
app.post('/api/bonus', auth, (req, res) => {
  res.status(410).json({ error: 'disabled', message: 'Бонус больше не выдаётся' });
});

app.post('/api/history', auth, (req, res) => {
  const caseTitle = req.body?.caseTitle ? String(req.body.caseTitle).slice(0, 64) : null;
  const limit = Math.min(60, Math.max(1, Number(req.body?.limit) || 60));
  res.json({ history: getHistory(req.player.id, limit, caseTitle) });
});

/* ============================================================
   КАССА
   ============================================================ */

app.post('/api/wallet', auth, (req, res) => {
  const pending = pendingPayoutTotal(req.player.id);
  res.json({
    balance: req.player.balance,
    pending,
    // Заявка списывает сумму сразу, поэтому доступное к выводу — это и есть
    // текущий баланс; ожидающие заявки показываются отдельной строкой.
    available: req.player.balance,
    minPayout: MIN_PAYOUT,
    deposits: getDeposits(req.player.id),
    payouts: getPayouts(req.player.id),
  });
});

app.post('/api/payout/create', auth, (req, res) => {
  const amount = Math.trunc(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Укажите сумму вывода' });
  }

  try {
    const result = createPayout(req.player.id, amount, {
      method: req.body?.method,
      phone: req.body?.phone,
      bank: req.body?.bank,
      cardNumber: req.body?.cardNumber,
    });
    res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
  } catch (err) {
    if (['MIN','INSUFFICIENT_FUNDS','BAD_PHONE','BAD_BANK','BAD_CARD','BAD_METHOD','PAYOUT_KEY_MISSING'].includes(err.code)) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    throw err;
  }
});

app.post('/api/payout/cancel', auth, (req, res) => {
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

app.post('/api/gamble/pick', auth, (req, res) => {
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

app.post('/api/gamble/skip', auth, (req, res) => {
  clearGamble(req.player.id);
  res.json({ user: publicUser(getUserById(req.player.id)) });
});

/* ============================================================
   АПГРЕЙД
   ============================================================ */

app.post('/api/upgrade', auth, (req, res) => {
  const stake = parseBet(req.body?.stake);
  const multiplier = Number(req.body?.multiplier);

  if (!stake || stake < UPGRADE_CONFIG.minStake) {
    return res.status(400).json({ error: `Минимальная ставка — ${UPGRADE_CONFIG.minStake}` });
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
      subtitle: won ? `x${multiplier} — попал` : `x${multiplier} — мимо`,
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

app.post('/api/free-case/state', auth, (req, res) => {
  if (!subscriptionConfigured()) return res.json({ enabled: false });
  const state = freeCaseState(req.player.id, FREE_CASE_COOLDOWN_MS);
  res.json({ enabled: true, ...subscriptionConfig(), ...state });
});

app.post('/api/free-case/claim', auth, async (req, res) => {
  if (!subscriptionConfigured()) {
    return res.status(503).json({
      error: 'Бесплатный кейс ещё не настроен',
      message: 'Раздел включится, когда будут заданы канал и кейс — см. NEDOSTATOK.md',
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

app.post('/api/fair/rotate', auth, (req, res) => {
  const result = rotateServerSeed(req.player.id);
  res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
});

/* ============================================================
   АДМИНКА
   ============================================================ */

app.post('/api/admin/overview', auth, adminOnly, (req, res) => {
  res.json({ ...adminOverview(), recent: adminRecentRounds(30) });
});

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const query = String(req.body?.query || '').slice(0, 64);
  const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 30));
  const offset = Math.max(0, Number(req.body?.offset) || 0);
  res.json(adminUsers({ query, limit, offset }));
});

app.post('/api/admin/user', auth, adminOnly, (req, res) => {
  const detail = adminUserDetail(Number(req.body?.userId));
  if (!detail) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(detail);
});

app.post('/api/admin/balance', auth, adminOnly, (req, res) => {
  const targetId = Number(req.body?.userId);
  const amount = Math.trunc(Number(req.body?.amount));

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Укажите ненулевую сумму' });
  }
  if (Math.abs(amount) > 100_000_000) {
    return res.status(400).json({ error: 'Слишком большая сумма' });
  }

  try {
    const result = adminAdjustBalance(
      req.player.id, targetId, amount, String(req.body?.note || '').slice(0, 200)
    );
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    throw err;
  }
});

app.post('/api/admin/block', auth, adminOnly, (req, res) => {
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

app.post('/api/admin/voucher', auth, adminOnly, (req, res) => {
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

app.post('/api/admin/payouts', auth, adminOnly, (req, res) => {
  const status = ['pending', 'processing', 'paid', 'rejected', 'cancelled', 'all']
    .includes(req.body?.status) ? req.body.status : 'pending';
  res.json({ rows: adminPayouts(status), stats: payoutStats() });
});

app.post('/api/admin/payout/resolve', auth, adminOnly, (req, res) => {
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

app.post('/api/payments/create', auth, (req, res) => {
  try { res.status(201).json(createPayment(req.player.id, req.body?.amount, String(req.body?.bank || ''))); }
  catch (err) { res.status(400).json({ error: err.code || 'PAYMENT_ERROR', message: err.message }); }
});
app.post('/api/payments/list', auth, (req, res) => res.json({ rows: listPayments(req.player.id) }));
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
app.post('/api/webhooks/beeline', deviceAuth, (req, res) => {
  try {
    const result = processBeelineSms({ amount: req.body?.amount, message: String(req.body?.message || ''), deviceId: req.deviceId });
    emitPayment(result.userId, 'payment.completed', result); res.json({ ok: true, ...result });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
app.post('/api/webhooks/beeline/heartbeat', deviceAuth, (req, res) => { heartbeat(req.deviceId); res.json({ ok: true, serverTime: Date.now() }); });

app.post('/api/support/open', auth, (req, res) => res.status(201).json(openDispute(req.player.id, Number(req.body?.paymentId))));
app.post('/api/support/chat', auth, (req, res) => {
  const data = supportChat(Number(req.body?.chatId));
  if (!data.chat || data.chat.user_id !== req.player.id) return res.status(404).json({ error: 'Чат не найден' }); res.json(data);
});
app.post('/api/support/message', auth, (req, res) => {
  const data = supportChat(Number(req.body?.chatId));
  if (!data.chat || data.chat.user_id !== req.player.id) return res.status(404).json({ error: 'Чат не найден' });
  addSupportMessage(data.chat.id, 'USER', req.player.id, String(req.body?.text || '').slice(0, 2000),
    req.body?.attachmentUrl, String(req.body?.attachmentName || '').slice(0, 200));
  res.status(201).json(supportChat(data.chat.id));
});
app.post('/api/support/upload', auth, (req, res) => {
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

app.post('/api/admin/payments', auth, adminOnly, (req, res) => res.json({ rows: adminPayments(String(req.body?.status || 'ALL')), dashboard: paymentDashboard() }));
app.post('/api/admin/payment-settings', auth, adminOnly, (req, res) => {
  try { res.json(req.body?.save ? updatePaymentSettings(req.body.values || {}) : paymentSettings()); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/admin/payment-devices', auth, adminOnly, (req, res) => res.json({ rows: adminDevices() }));
app.post('/api/admin/payment-device/register', auth, adminOnly, (req, res) => {
  const id=String(req.body?.deviceId||'').trim(), secret=String(req.body?.secret||'');
  if (!id || secret.length < 24) return res.status(400).json({ error: 'ID обязателен, секрет — минимум 24 символа' });
  registerDevice(id, String(req.body?.name||id).slice(0,80), secret); res.status(201).json({ ok:true });
});
app.post('/api/admin/support', auth, adminOnly, (req, res) => res.json({ rows: adminChats() }));
app.post('/api/admin/support/chat', auth, adminOnly, (req, res) => res.json(supportChat(Number(req.body?.chatId))));
app.post('/api/admin/support/message', auth, adminOnly, (req, res) => {
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
    console.log('  DEV_MODE включён — подпись Telegram не проверяется.');
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
