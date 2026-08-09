/**
 * HTTP-сервер мини-аппа: отдаёт статику и обслуживает игровое API.
 *
 * Важное правило: исход открытия считает ТОЛЬКО сервер. Клиент получает уже
 * готовый результат и лишь проигрывает анимацию до него. Поэтому подкрутить
 * выпадение из браузера нельзя.
 */

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CASES, CATEGORIES, getCase, pickItem, publicCase, validateCases, TIERS } from './cases.js';
import { computeRoll, generateClientSeed } from './fair.js';
import {
  BONUS_CONFIG,
  claimBonus,
  getHistory,
  getOrCreateUser,
  getUserById,
  recordOpening,
  rotateServerSeed,
  setClientSeed,
} from './db.js';
import { resolveUser } from './auth.js';

// Если математика кейсов сломана — падаем на старте, до первого игрока.
const report = validateCases();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(__dirname, '..', 'public'), { maxAge: '1h' }));

/** Мидлвар авторизации: кладёт игрока в req.player. */
function auth(req, res, next) {
  const result = resolveUser(req);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }
  req.player = getOrCreateUser(result.user);
  next();
}

/** Приводит игрока к виду, который уходит на клиент. */
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    balance: user.balance,
    stats: {
      opened: user.total_opened,
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

app.get('/api/config', (req, res) => {
  res.json({
    categories: CATEGORIES,
    cases: CASES.map(publicCase),
    tiers: TIERS,
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

app.post('/api/open', auth, (req, res) => {
  const { caseId } = req.body || {};
  const caseData = getCase(caseId);
  if (!caseData) {
    return res.status(404).json({ error: 'Кейс не найден' });
  }

  const user = req.player;
  if (user.balance < caseData.price) {
    return res.status(400).json({
      error: 'INSUFFICIENT_FUNDS',
      message: `Не хватает ${caseData.price - user.balance} ед.`,
    });
  }

  const nonce = user.nonce + 1;
  const roll = computeRoll(user.server_seed, user.client_seed, nonce);
  const item = pickItem(caseData, roll);

  let balance;
  try {
    balance = recordOpening(user.id, caseData, item, roll, nonce);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: 'INSUFFICIENT_FUNDS', message: err.message });
    }
    throw err;
  }

  res.json({
    item: {
      id: item.id,
      name: item.name,
      value: item.value,
      tier: item.tier,
      multiplier: Number((item.value / caseData.price).toFixed(2)),
    },
    balance,
    net: item.value - caseData.price,
    fair: {
      roll,
      nonce,
      serverSeedHash: user.server_seed_hash,
      clientSeed: user.client_seed,
    },
    user: publicUser(getUserById(user.id)),
  });
});

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

app.get('/api/history', auth, (req, res) => {
  res.json({ history: getHistory(req.player.id) });
});

// GET-запрос не несёт тела, а initData приходит в заголовке — поэтому история
// доступна и по GET, и по POST для удобства клиента.
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
    console.log('  DEV_MODE включён — подпись Telegram не проверяется.\n');
  }
  console.table(report);
});
