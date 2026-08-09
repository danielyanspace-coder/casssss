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
    is_admin          INTEGER NOT NULL DEFAULT 0,
    is_blocked        INTEGER NOT NULL DEFAULT 0,
    x2_case_id        TEXT,
    gamble_stake      INTEGER NOT NULL DEFAULT 0,
    gamble_case       TEXT,
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
    free         INTEGER NOT NULL DEFAULT 0,
    roll         REAL    NOT NULL,
    nonce        INTEGER NOT NULL,
    server_hash  TEXT    NOT NULL,
    client_seed  TEXT    NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_rounds_created ON rounds(created_at DESC);

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

  -- Подарочные кейсы: сколько бесплатных открытий каждого кейса накоплено.
  CREATE TABLE IF NOT EXISTS vouchers (
    user_id  INTEGER NOT NULL REFERENCES users(id),
    case_id  TEXT    NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, case_id)
  );

  -- Журнал действий администратора: любое изменение баланса извне видно.
  CREATE TABLE IF NOT EXISTS admin_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   INTEGER NOT NULL,
    target_id  INTEGER NOT NULL,
    action     TEXT    NOT NULL,
    amount     INTEGER,
    note       TEXT,
    created_at INTEGER NOT NULL
  );
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

/**
 * CREATE TABLE IF NOT EXISTS не добавляет колонки в уже существующую таблицу,
 * поэтому новые поля досыпаем вручную — иначе база игрока со старой версии
 * уронит сервер на первом же запросе.
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'is_blocked', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'x2_case_id', 'TEXT');
ensureColumn('rounds', 'free', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'gamble_stake', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'gamble_case', 'TEXT');

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

/**
 * История раундов. С caseTitle отдаются только открытия конкретного кейса —
 * это питает блок «ваши выпадения из этого кейса» на экране прокрута.
 */
export function getHistory(userId, limit = 60, caseTitle = null) {
  const columns = `game, title, subtitle, bet, payout, multiplier, tier, free,
                   roll, nonce, server_hash, client_seed, created_at`;

  if (caseTitle) {
    return db.prepare(`
      SELECT ${columns}
        FROM rounds
       WHERE user_id = ? AND game = 'case' AND title = ?
       ORDER BY id DESC
       LIMIT ?
    `).all(userId, caseTitle, limit);
  }

  return db.prepare(`
    SELECT ${columns}
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

/* ============================================================
   ПЛЮШКИ: ×2, подарочные кейсы, бонусы
   ============================================================ */

export function getVouchers(userId) {
  return db.prepare('SELECT case_id, count FROM vouchers WHERE user_id = ? AND count > 0')
    .all(userId);
}

function addVoucher(userId, caseId, delta = 1) {
  db.prepare(`
    INSERT INTO vouchers (user_id, case_id, count) VALUES (?, ?, ?)
    ON CONFLICT(user_id, case_id) DO UPDATE SET count = count + excluded.count
  `).run(userId, caseId, delta);
}

/**
 * Открытие кейса целиком: списание либо расход ваучера, розыгрыш, применение
 * ×2, выдача плюшек, запись истории. Одной транзакцией — параллельные запросы
 * не смогут потратить один ваучер дважды или уйти в минус по балансу.
 *
 * resolve(serverSeed, clientSeed, nonce) должен вернуть выпавший предмет.
 */
export const playCaseRound = db.transaction((userId, caseData, resolve) => {
  const before = getUserById(userId);

  // Бесплатное открытие тратит ваучер и не трогает баланс.
  const voucher = db.prepare('SELECT count FROM vouchers WHERE user_id = ? AND case_id = ?')
    .get(userId, caseData.id);
  const isFree = !!voucher && voucher.count > 0;

  if (!isFree && before.balance < caseData.price) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }

  const nonce = bumpNonce(userId);
  const user = getUserById(userId);
  const { item, roll } = resolve(user.server_seed, user.client_seed, nonce);

  // ×2 действует только на тот кейс, который его выдал.
  const x2Active = user.x2_case_id === caseData.id;
  const payout = item.value * (x2Active && item.value > 0 ? 2 : 1);

  const granted = [];
  if (item.perk) {
    if (item.perk.type === 'credits') granted.push({ type: 'credits', amount: item.value });
    if (item.perk.type === 'voucher') {
      addVoucher(userId, item.perk.caseId, 1);
      granted.push({ type: 'voucher', caseId: item.perk.caseId });
    }
    if (item.perk.type === 'x2') granted.push({ type: 'x2', caseId: caseData.id });
  }

  if (isFree) {
    db.prepare('UPDATE vouchers SET count = count - 1 WHERE user_id = ? AND case_id = ?')
      .run(userId, caseData.id);
  }

  const spent = isFree ? 0 : caseData.price;
  const newBalance = before.balance - spent + payout;

  // Новый ×2 ставится после того, как старый уже применён к этому прокруту.
  const nextX2 = item.perk?.type === 'x2' ? caseData.id : (x2Active ? null : user.x2_case_id);

  // Бесплатный раунд не идёт в лучший множитель: делить на нулевую ставку
  // бессмысленно, а price там условная.
  const multiplier = isFree ? 0 : payout / caseData.price;

  db.prepare(`
    UPDATE users
       SET balance = ?, x2_case_id = ?,
           gamble_stake = ?, gamble_case = ?,
           total_rounds = total_rounds + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(newBalance, nextX2, payout > 0 ? payout : 0, payout > 0 ? caseData.id : null,
         spent, payout, multiplier, userId);

  db.prepare(`
    INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier,
                        tier, free, roll, nonce, server_hash, client_seed, created_at)
    VALUES (?, 'case', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, caseData.name,
         item.name + (x2Active && item.value > 0 ? ' (×2)' : ''),
         spent, payout, multiplier, item.tier, isFree ? 1 : 0,
         roll, nonce, user.server_seed_hash, user.client_seed, Date.now());

  return {
    item, roll, nonce, payout, granted,
    free: isFree,
    x2Applied: x2Active && item.value > 0,
    balance: newBalance,
  };
});

/* ============================================================
   АДМИНКА
   ============================================================ */

/** Помечает администраторами всех, чей Telegram ID указан в настройках. */
export function syncAdmins(tgIds) {
  db.prepare('UPDATE users SET is_admin = 0').run();
  if (!tgIds.length) return;
  const marks = tgIds.map(() => '?').join(',');
  db.prepare(`UPDATE users SET is_admin = 1 WHERE tg_id IN (${marks})`).run(...tgIds);
}

export function adminOverview() {
  const users = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN total_rounds > 0 THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) AS blocked,
           COALESCE(SUM(balance), 0) AS balance
      FROM users
  `).get();

  const rounds = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(bet), 0) AS wagered,
           COALESCE(SUM(payout), 0) AS paid
      FROM rounds
  `).get();

  const byGame = db.prepare(`
    SELECT game, COUNT(*) AS rounds,
           COALESCE(SUM(bet), 0) AS wagered,
           COALESCE(SUM(payout), 0) AS paid
      FROM rounds GROUP BY game ORDER BY wagered DESC
  `).all();

  const dayAgo = Date.now() - 86400000;
  const today = db.prepare(`
    SELECT COUNT(*) AS rounds,
           COALESCE(SUM(bet), 0) AS wagered,
           COALESCE(SUM(payout), 0) AS paid,
           COUNT(DISTINCT user_id) AS players
      FROM rounds WHERE created_at > ?
  `).get(dayAgo);

  const topWins = db.prepare(`
    SELECT r.title, r.subtitle, r.bet, r.payout, r.multiplier, r.created_at,
           u.username, u.first_name, u.id AS user_id
      FROM rounds r JOIN users u ON u.id = r.user_id
     ORDER BY r.payout DESC LIMIT 10
  `).all();

  return {
    users,
    rounds: {
      ...rounds,
      // Прибыль заведения = поставлено минус выплачено.
      profit: rounds.wagered - rounds.paid,
      rtp: rounds.wagered ? rounds.paid / rounds.wagered : null,
    },
    byGame: byGame.map((g) => ({
      ...g,
      profit: g.wagered - g.paid,
      rtp: g.wagered ? g.paid / g.wagered : null,
    })),
    today: { ...today, profit: today.wagered - today.paid },
    topWins,
  };
}

export function adminUsers({ query = '', limit = 30, offset = 0 } = {}) {
  const like = `%${query}%`;
  const rows = db.prepare(`
    SELECT id, tg_id, username, first_name, balance, total_rounds, total_spent,
           total_won, best_multiplier, is_admin, is_blocked, created_at
      FROM users
     WHERE (? = '' OR username LIKE ? OR first_name LIKE ? OR tg_id LIKE ?)
     ORDER BY total_spent DESC, id ASC
     LIMIT ? OFFSET ?
  `).all(query, like, like, like, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM users
     WHERE (? = '' OR username LIKE ? OR first_name LIKE ? OR tg_id LIKE ?)
  `).get(query, like, like, like).n;

  return { rows, total };
}

export function adminUserDetail(userId) {
  const user = getUserById(userId);
  if (!user) return null;
  return {
    user,
    history: getHistory(userId, 30),
    vouchers: getVouchers(userId),
    log: db.prepare(`
      SELECT action, amount, note, created_at FROM admin_log
       WHERE target_id = ? ORDER BY id DESC LIMIT 20
    `).all(userId),
  };
}

/**
 * Изменение баланса администратором. Отрицательная сумма списывает, но не
 * ниже нуля — уводить игрока в долг нельзя.
 */
export const adminAdjustBalance = db.transaction((adminId, targetId, amount, note) => {
  const target = getUserById(targetId);
  if (!target) throw Object.assign(new Error('Игрок не найден'), { code: 'NOT_FOUND' });

  const newBalance = Math.max(0, target.balance + amount);
  const applied = newBalance - target.balance;

  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, targetId);
  db.prepare(`
    INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(adminId, targetId, amount >= 0 ? 'credit' : 'debit', applied, note || null, Date.now());

  return { balance: newBalance, applied };
});

export const adminSetBlocked = db.transaction((adminId, targetId, blocked) => {
  const target = getUserById(targetId);
  if (!target) throw Object.assign(new Error('Игрок не найден'), { code: 'NOT_FOUND' });

  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, targetId);
  db.prepare(`
    INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
  `).run(adminId, targetId, blocked ? 'block' : 'unblock', Date.now());

  return { blocked: !!blocked };
});

export const adminGrantVoucher = db.transaction((adminId, targetId, caseId, count) => {
  if (!getUserById(targetId)) throw Object.assign(new Error('Игрок не найден'), { code: 'NOT_FOUND' });
  addVoucher(targetId, caseId, count);
  db.prepare(`
    INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
    VALUES (?, ?, 'voucher', ?, ?, ?)
  `).run(adminId, targetId, count, caseId, Date.now());
  return getVouchers(targetId);
});

export function adminRecentRounds(limit = 40) {
  return db.prepare(`
    SELECT r.game, r.title, r.subtitle, r.bet, r.payout, r.multiplier, r.free,
           r.created_at, u.username, u.first_name, u.id AS user_id
      FROM rounds r JOIN users u ON u.id = r.user_id
     ORDER BY r.id DESC LIMIT ?
  `).all(limit);
}

/* ============================================================
   РИСК-ИГРА ПОСЛЕ ПРОКРУТА
   ============================================================ */

/**
 * Ставка риск-игры — это выигрыш последнего прокрута, он уже зачислен на
 * баланс. Поэтому при проигрыше ставку снимаем, а при выигрыше доначисляем
 * разницу до итоговой выплаты.
 *
 * Ставка обнуляется внутри той же транзакции: иначе одним выигрышем можно
 * было бы рискнуть дважды, отправив два запроса подряд.
 */
export const playGamble = db.transaction((userId, pickIndex, config, resolve) => {
  const user = getUserById(userId);
  const stake = user.gamble_stake;

  if (!stake || stake <= 0) {
    throw Object.assign(new Error('Нечем рисковать'), { code: 'NO_STAKE' });
  }

  const nonce = user.nonce + 1;
  db.prepare('UPDATE users SET nonce = ? WHERE id = ?').run(nonce, userId);

  const fresh = getUserById(userId);
  const { acePosition, roll } = resolve(fresh.server_seed, fresh.client_seed, nonce);
  const won = pickIndex === acePosition;
  const payout = won ? stake * config.payout : 0;

  // Ставка уже на балансе: при выигрыше добавляем недостающее, при проигрыше снимаем.
  const delta = payout - stake;

  db.prepare(`
    UPDATE users
       SET balance = balance + ?,
           gamble_stake = 0,
           gamble_case = NULL,
           total_rounds = total_rounds + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(delta, stake, payout, won ? config.payout : 0, userId);

  db.prepare(`
    INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier,
                        tier, free, roll, nonce, server_hash, client_seed, created_at)
    VALUES (?, 'gamble', 'Риск-игра', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(userId,
         won ? `Нашёл туза — ${config.payout}x` : 'Промах',
         stake, payout, won ? config.payout : 0,
         won ? 'unique' : 'common',
         roll, nonce, fresh.server_seed_hash, fresh.client_seed, Date.now());

  return {
    won, acePosition, payout, stake, roll, nonce,
    balance: getUserById(userId).balance,
  };
});

/** Сбрасывает предложенный риск, если игрок им не воспользовался. */
export function clearGamble(userId) {
  db.prepare('UPDATE users SET gamble_stake = 0, gamble_case = NULL WHERE id = ?').run(userId);
}
