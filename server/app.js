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

import { CASES, CATEGORIES, getCase, pickItem, publicCase, validateCases, TIERS } from './cases.js';
import {
  CRASH_CONFIG,
  ROULETTE_CONFIG,
  ROULETTE_WHEEL,
  crashMultiplierAt,
  crashPointFromRoll,
  rouletteColorOf,
  rouletteSlotFromRoll,
  validateGames,
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
  playInstantRound,
  rotateServerSeed,
  setClientSeed,
  startCrashRound,
} from './db.js';
import { resolveUser } from './auth.js';

// Если математика поехала — падаем на старте, до первого игрока.
const caseReport = validateCases();
const gameReport = validateGames();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(__dirname, '..', 'public'), { maxAge: '1h' }));

function auth(req, res, next) {
  const result = resolveUser(req);
  if (!result.ok) return res.status(401).json({ error: result.error });
  req.player = getOrCreateUser(result.user);
  next();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    balance: user.balance,
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
    bonus: {
      amount: BONUS_CONFIG.amount,
      cooldownMin: BONUS_CONFIG.cooldownMs / 60000,
      balanceLimit: BONUS_CONFIG.balanceLimit,
    },
  });
});

app.post('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.player) });
});

/* ============================================================
   КЕЙСЫ
   ============================================================ */

app.post('/api/open', auth, (req, res) => {
  const caseData = getCase(req.body?.caseId);
  if (!caseData) return res.status(404).json({ error: 'Кейс не найден' });

  const user = req.player;
  if (user.balance < caseData.price) {
    return sendInsufficient(res, caseData.price - user.balance);
  }

  let result;
  try {
    result = playInstantRound(user.id, caseData.price, (serverSeed, clientSeed, nonce) => {
      const roll = computeRoll(serverSeed, clientSeed, nonce);
      const item = pickItem(caseData, roll);
      return {
        game: 'case',
        title: caseData.name,
        subtitle: item.name,
        payout: item.value,
        tier: item.tier,
        roll,
        item,
      };
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') return sendInsufficient(res, caseData.price - user.balance);
    throw err;
  }

  res.json({
    item: {
      id: result.item.id,
      name: result.item.name,
      value: result.item.value,
      tier: result.item.tier,
      multiplier: Number((result.item.value / caseData.price).toFixed(2)),
    },
    balance: result.balance,
    net: result.item.value - caseData.price,
    fair: { roll: result.roll, nonce: result.nonce },
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

app.post('/api/bonus', auth, (req, res) => {
  const result = claimBonus(req.player.id);
  if (!result.ok) {
    const message =
      result.reason === 'cooldown'
        ? `Следующий бонус через ${Math.ceil(result.waitLeft / 60000)} мин.`
        : `Бонус доступен, когда баланс меньше ${result.limit} ед.`;
    return res.status(400).json({ error: result.reason, message });
  }
  res.json({ ...result, user: publicUser(getUserById(req.player.id)) });
});

app.post('/api/history', auth, (req, res) => {
  res.json({ history: getHistory(req.player.id) });
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

app.use((err, req, res, next) => {
  console.error('Ошибка запроса:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`\n  Кейс-симулятор запущен на http://localhost:${PORT}`);
  if (process.env.DEV_MODE === 'true') {
    console.log('  DEV_MODE включён — подпись Telegram не проверяется.');
  }
  console.log(`  Краш RTP: ${(gameReport.crashRtp * 100).toFixed(2)}%  ` +
              `Рулетка RTP: ${(gameReport.rouletteRtp * 100).toFixed(2)}%\n`);
  console.table(caseReport);
});
