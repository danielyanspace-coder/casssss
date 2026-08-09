/**
 * Хранилище на SQLite: баланс, seed-ы, история всех игр.
 *
 * Все три игры пишут в общую таблицу rounds — так история и статистика
 * считаются единообразно, без развилок по типу игры.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateClientSeed, generateServerSeed, hashSeed } from './fair.js';

const DB_PATH = resolve(process.env.DB_PATH || './data/app.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY,
    tg_id             TEXT    NOT NULL UNIQUE,
    username          TEXT,
    first_name        TEXT,
    balance           INTEGER NOT NULL DEFAULT 1000,
    server_seed       TEXT    NOT NULL,
    server_seed_hash  TEXT    NOT NULL,
    client_seed       TEXT    NOT NULL,
    nonce             INTEGER NOT NULL DEFAULT 0,
    prev_server_seed  TEXT,
    prev_server_hash  TEXT,
    total_rounds      INTEGER NOT NULL DEFAULT 0,
    total_spent       INTEGER NOT NULL DEFAULT 0,
    total_won         INTEGER NOT NULL DEFAULT 0,
    best_multiplier   REAL    NOT NULL DEFAULT 0,
    last_bonus_at     INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    game         TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    subtitle     TEXT    NOT NULL,
    bet          INTEGER NOT NULL,
    payout       INTEGER NOT NULL,
    multiplier   REAL    NOT NULL,
    tier         TEXT    NOT NULL,
    roll         REAL    NOT NULL,
    nonce        INTEGER NOT NULL,
    server_hash  TEXT    NOT NULL,
    client_seed  TEXT    NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, id DESC);

  -- Активные раунды краша. Точка краша лежит здесь и на клиент не уходит,
  -- иначе игрок всегда забирал бы выигрыш за мгновение до взрыва.
  CREATE TABLE IF NOT EXISTS crash_rounds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    bet          INTEGER NOT NULL,
    crash_point  REAL    NOT NULL,
    started_at   INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'running',
    cashed_at    REAL,
    roll         REAL    NOT NULL,
    nonce        INTEGER NOT NULL,
    server_hash  TEXT    NOT NULL,
    client_seed  TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_crash_user ON crash_rounds(user_id, id DESC);
`);

// Переезд со старой схемы: история кейсов из openings в общую таблицу rounds.
const hasOldTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='openings'")
  .get();

if (hasOldTable) {
  const migrated = db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n;
  if (migrated === 0) {
    db.exec(`
      INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier,
                          tier, roll, nonce, server_hash, client_seed, created_at)
      SELECT user_id, 'case', case_name, item_name, price, item_value, multiplier,
             item_tier, roll, nonce, server_hash, client_seed, created_at
        FROM openings;
    `);
  }
  db.exec('DROP TABLE openings;');
}

// Старая колонка счётчика называлась иначе — переносим, если осталась.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (userColumns.includes('total_opened') && !userColumns.includes('total_rounds')) {
  db.exec('ALTER TABLE users RENAME COLUMN total_opened TO total_rounds;');
}

const STARTING_BALANCE = Number(process.env.STARTING_BALANCE || 1000);

const insertUser = db.prepare(`
  INSERT INTO users (tg_id, username, first_name, balance, server_seed,
                     server_seed_hash, client_seed, created_at)
  VALUES (@tg_id, @username, @first_name, @balance, @server_seed,
          @server_seed_hash, @client_seed, @created_at)
`);

const selectUser = db.prepare('SELECT * FROM users WHERE tg_id = ?');

export function getOrCreateUser(tgUser) {
  const tgId = String(tgUser.id);
  const existing = selectUser.get(tgId);

  if (existing) {
    if (existing.username !== (tgUser.username || null) ||
        existing.first_name !== (tgUser.first_name || null)) {
      db.prepare('UPDATE users SET username = ?, first_name = ? WHERE id = ?')
        .run(tgUser.username || null, tgUser.first_name || null, existing.id);
      return selectUser.get(tgId);
    }
    return existing;
  }

  const serverSeed = generateServerSeed();
  insertUser.run({
    tg_id: tgId,
    username: tgUser.username || null,
    first_name: tgUser.first_name || null,
    balance: STARTING_BALANCE,
    server_seed: serverSeed,
    server_seed_hash: hashSeed(serverSeed),
    client_seed: generateClientSeed(),
    created_at: Date.now(),
  });
  return selectUser.get(tgId);
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/** Следующий nonce для игрока. Вызывать только внутри транзакции. */
function bumpNonce(userId) {
  db.prepare('UPDATE users SET nonce = nonce + 1 WHERE id = ?').run(userId);
  return getUserById(userId).nonce;
}

/**
 * Записывает завершённый раунд любой игры: снимает ставку, начисляет выплату,
 * обновляет счётчики и историю. Всё одной транзакцией, поэтому параллельные
 * запросы не уведут баланс в минус.
 */
export const settleRound = db.transaction((userId, round) => {
  const user = getUserById(userId);
  if (user.balance < round.bet) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }

  const newBalance = user.balance - round.bet + round.payout;
  const multiplier = round.payout / round.bet;

  db.prepare(`
    UPDATE users
       SET balance = ?,
           total_rounds = total_rounds + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(newBalance, round.bet, round.payout, multiplier, userId);

  db.prepare(`
    INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier,
                        tier, roll, nonce, server_hash, client_seed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, round.game, round.title, round.subtitle, round.bet, round.payout,
         multiplier, round.tier, round.roll, round.nonce, user.server_seed_hash,
         user.client_seed, Date.now());

  return newBalance;
});

/* ---------- Кейсы и рулетка: ставка и результат за один вызов ---------- */

export const playInstantRound = db.transaction((userId, bet, resolve) => {
  const before = getUserById(userId);
  if (before.balance < bet) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }

  const nonce = bumpNonce(userId);
  const user = getUserById(userId);
  const outcome = resolve(user.server_seed, user.client_seed, nonce);

  const balance = settleRound(userId, { ...outcome, bet, nonce });
  return { ...outcome, nonce, bet, balance };
});

/* ---------- Краш: ставка и вывод — разные запросы ---------- */

export const startCrashRound = db.transaction((userId, bet, computeCrashPoint) => {
  const before = getUserById(userId);
  if (before.balance < bet) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }

  // Незакрытый раунд закрываем как проигранный, чтобы нельзя было держать
  // несколько ставок разом и выводить только удачную.
  db.prepare(`UPDATE crash_rounds SET status = 'busted'
               WHERE user_id = ? AND status = 'running'`).run(userId);

  const nonce = bumpNonce(userId);
  const user = getUserById(userId);
  const { crashPoint, roll } = computeCrashPoint(user.server_seed, user.client_seed, nonce);

  // Ставка списывается сразу: выплата придёт отдельно, при выводе.
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(bet, userId);

  const info = db.prepare(`
    INSERT INTO crash_rounds (user_id, bet, crash_point, started_at, roll, nonce,
                              server_hash, client_seed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, bet, crashPoint, Date.now(), roll, nonce,
         user.server_seed_hash, user.client_seed);

  return {
    roundId: info.lastInsertRowid,
    startedAt: Date.now(),
    nonce,
    balance: getUserById(userId).balance,
  };
});

export function getCrashRound(roundId, userId) {
  return db.prepare('SELECT * FROM crash_rounds WHERE id = ? AND user_id = ?')
    .get(roundId, userId);
}

/**
 * Фиксирует итог раунда краша.
 *
 * Ставка уже списана при старте, поэтому здесь только начисляем выплату и
 * дописываем историю — счётчик потраченного увеличиваем вручную.
 */
export const finishCrashRound = db.transaction((roundId, userId, status, cashedAt) => {
  const round = db.prepare(`SELECT * FROM crash_rounds WHERE id = ? AND user_id = ?
                             AND status = 'running'`).get(roundId, userId);
  if (!round) return null;

  const payout = status === 'cashed' ? Math.floor(round.bet * cashedAt) : 0;
  const multiplier = payout / round.bet;

  db.prepare('UPDATE crash_rounds SET status = ?, cashed_at = ? WHERE id = ?')
    .run(status, status === 'cashed' ? cashedAt : null, roundId);

  db.prepare(`
    UPDATE users
       SET balance = balance + ?,
           total_rounds = total_rounds + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(payout, round.bet, payout, multiplier, userId);

  db.prepare(`
    INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier,
                        tier, roll, nonce, server_hash, client_seed, created_at)
    VALUES (?, 'crash', 'Краш', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId,
         status === 'cashed' ? `Забрал на ${cashedAt.toFixed(2)}x` : `Взорвался на ${round.crash_point.toFixed(2)}x`,
         round.bet, payout, multiplier,
         crashTier(multiplier), round.roll, round.nonce,
         round.server_hash, round.client_seed, Date.now());

  return {
    status,
    payout,
    crashPoint: round.crash_point,
    cashedAt: status === 'cashed' ? cashedAt : null,
    balance: getUserById(userId).balance,
  };
});

/** Цвет строки в истории подбирается по тому, насколько удачным был раунд. */
export function crashTier(multiplier) {
  if (multiplier === 0) return 'common';
  if (multiplier < 1) return 'uncommon';
  if (multiplier < 2) return 'rare';
  if (multiplier < 5) return 'epic';
  if (multiplier < 15) return 'legendary';
  if (multiplier < 50) return 'mythic';
  return 'unique';
}

/* ---------- История, seed-ы, бонус ---------- */

export function getHistory(userId, limit = 60) {
  return db.prepare(`
    SELECT game, title, subtitle, bet, payout, multiplier, tier,
           roll, nonce, server_hash, client_seed, created_at
      FROM rounds
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ?
  `).all(userId, limit);
}

export function setClientSeed(userId, seed) {
  db.prepare('UPDATE users SET client_seed = ? WHERE id = ?').run(seed, userId);
}

export const rotateServerSeed = db.transaction((userId) => {
  const user = getUserById(userId);
  const newSeed = generateServerSeed();

  // Незавершённый раунд краша использует старый seed — закрываем его,
  // иначе после ротации проверка результата не сойдётся.
  db.prepare(`UPDATE crash_rounds SET status = 'busted'
               WHERE user_id = ? AND status = 'running'`).run(userId);

  db.prepare(`
    UPDATE users
       SET prev_server_seed = server_seed,
           prev_server_hash = server_seed_hash,
           server_seed = ?,
           server_seed_hash = ?,
           nonce = 0
     WHERE id = ?
  `).run(newSeed, hashSeed(newSeed), userId);

  return {
    revealedSeed: user.server_seed,
    revealedHash: user.server_seed_hash,
    newHash: hashSeed(newSeed),
  };
});

const BONUS_AMOUNT = Number(process.env.BONUS_AMOUNT || 500);
const BONUS_COOLDOWN_MS = Number(process.env.BONUS_COOLDOWN_MIN || 60) * 60 * 1000;
const BONUS_BALANCE_LIMIT = Number(process.env.BONUS_BALANCE_LIMIT || 250);

export const claimBonus = db.transaction((userId) => {
  const user = getUserById(userId);
  const now = Date.now();
  const waitLeft = user.last_bonus_at + BONUS_COOLDOWN_MS - now;

  if (user.balance > BONUS_BALANCE_LIMIT) {
    return { ok: false, reason: 'balance', limit: BONUS_BALANCE_LIMIT };
  }
  if (waitLeft > 0) {
    return { ok: false, reason: 'cooldown', waitLeft };
  }

  const newBalance = user.balance + BONUS_AMOUNT;
  db.prepare('UPDATE users SET balance = ?, last_bonus_at = ? WHERE id = ?')
    .run(newBalance, now, userId);

  return { ok: true, amount: BONUS_AMOUNT, balance: newBalance };
});

export const BONUS_CONFIG = {
  amount: BONUS_AMOUNT,
  cooldownMs: BONUS_COOLDOWN_MS,
  balanceLimit: BONUS_BALANCE_LIMIT,
};
