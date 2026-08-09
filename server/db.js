/**
 * Хранилище на SQLite. Баланс, seed-ы и история открытий.
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
    total_opened      INTEGER NOT NULL DEFAULT 0,
    total_spent       INTEGER NOT NULL DEFAULT 0,
    total_won         INTEGER NOT NULL DEFAULT 0,
    best_multiplier   REAL    NOT NULL DEFAULT 0,
    last_bonus_at     INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS openings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    case_id      TEXT    NOT NULL,
    case_name    TEXT    NOT NULL,
    price        INTEGER NOT NULL,
    item_name    TEXT    NOT NULL,
    item_value   INTEGER NOT NULL,
    item_tier    TEXT    NOT NULL,
    multiplier   REAL    NOT NULL,
    roll         REAL    NOT NULL,
    nonce        INTEGER NOT NULL,
    server_hash  TEXT    NOT NULL,
    client_seed  TEXT    NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_openings_user ON openings(user_id, id DESC);
`);

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
    // Ник в Telegram мог поменяться с прошлого захода.
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

/**
 * Открытие кейса одной транзакцией: списание, начисление, счётчики, история.
 * Баланс проверяется внутри транзакции, поэтому параллельные запросы от
 * одного игрока не уведут его в минус.
 */
export const recordOpening = db.transaction((userId, caseData, item, roll, nonce) => {
  const user = getUserById(userId);
  if (user.balance < caseData.price) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }

  const newBalance = user.balance - caseData.price + item.value;
  const multiplier = item.value / caseData.price;

  db.prepare(`
    UPDATE users
       SET balance = ?,
           nonce = ?,
           total_opened = total_opened + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(newBalance, nonce, caseData.price, item.value, multiplier, userId);

  db.prepare(`
    INSERT INTO openings (user_id, case_id, case_name, price, item_name, item_value,
                          item_tier, multiplier, roll, nonce, server_hash,
                          client_seed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, caseData.id, caseData.name, caseData.price, item.name, item.value,
         item.tier, multiplier, roll, nonce, user.server_seed_hash,
         user.client_seed, Date.now());

  return newBalance;
});

export function getHistory(userId, limit = 50) {
  return db.prepare(`
    SELECT case_name, item_name, item_value, item_tier, price, multiplier,
           roll, nonce, server_hash, client_seed, created_at
      FROM openings
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ?
  `).all(userId, limit);
}

export function setClientSeed(userId, seed) {
  db.prepare('UPDATE users SET client_seed = ? WHERE id = ?').run(seed, userId);
}

/**
 * Раскрывает текущий serverSeed и ставит новый. Nonce сбрасывается, потому что
 * пара (seed, nonce) начинает отсчёт заново.
 */
export function rotateServerSeed(userId) {
  const user = getUserById(userId);
  const newSeed = generateServerSeed();

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
}

const BONUS_AMOUNT = Number(process.env.BONUS_AMOUNT || 500);
const BONUS_COOLDOWN_MS = Number(process.env.BONUS_COOLDOWN_MIN || 60) * 60 * 1000;
const BONUS_BALANCE_LIMIT = Number(process.env.BONUS_BALANCE_LIMIT || 250);

/**
 * Бонус — чтобы игра не заканчивалась насовсем. Даётся, только когда баланс
 * действительно низкий, и не чаще раза в час.
 */
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
