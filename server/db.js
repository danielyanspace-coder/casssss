/**
 * Хранилище на SQLite: баланс, seed-ы, история всех игр.
 *
 * Все три игры пишут в общую таблицу rounds — так история и статистика
 * считаются единообразно, без развилок по типу игры.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generateClientSeed, generateServerSeed, hashSeed } from './fair.js';

const DB_PATH = resolve(process.env.DB_PATH || './data/app.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function payoutKey() {
  const raw = String(process.env.PAYOUT_DATA_KEY || '');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}
function encryptCard(pan) {
  const key = payoutKey();
  if (!key) throw Object.assign(new Error('На сервере не задан PAYOUT_DATA_KEY'), { code: 'PAYOUT_KEY_MISSING' });
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(pan,'utf8'),cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
function decryptCard(value) {
  if (!value?.startsWith('v1.')) return value || '';
  try { const [,iv,tag,data]=value.split('.'), decipher=createDecipheriv('aes-256-gcm',payoutKey(),Buffer.from(iv,'base64url')); decipher.setAuthTag(Buffer.from(tag,'base64url')); return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'); }
  catch { return 'Недоступно: проверьте PAYOUT_DATA_KEY'; }
}

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

  -- Накопленные удвоители. Таблица, а не колонка в users: раньше хранился
  -- один case_id, и второй выпавший удвоитель затирал первый - выигрыш
  -- пропадал. Теперь их можно копить, и по кейсам они считаются отдельно.
  CREATE TABLE IF NOT EXISTS x2_perks (
    user_id  INTEGER NOT NULL REFERENCES users(id),
    case_id  TEXT    NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, case_id)
  );

  -- Заявки на вывод. Сумма списывается сразу при создании, поэтому статус
  -- pending означает «деньги уже сняты и ждут решения администратора».
  CREATE TABLE IF NOT EXISTS payouts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    amount       INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    comment      TEXT,
    created_at   INTEGER NOT NULL,
    resolved_at  INTEGER,
    resolved_by  INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status, id DESC);

  -- История зачислений: стартовый баланс и всё, что начислил администратор.
  CREATE TABLE IF NOT EXISTS deposits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL,
    source     TEXT    NOT NULL,
    comment    TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, id DESC);

  -- Промокоды. Один код - один набор условий; всё, чем он ограничен, лежит
  -- здесь же, чтобы правила выдачи не расползались по коду.
  CREATE TABLE IF NOT EXISTS promocodes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT    NOT NULL UNIQUE,
    -- balance: сразу на баланс; deposit_pct: процент к следующему пополнению;
    -- free_case: подарочные открытия кейса.
    type              TEXT    NOT NULL,
    amount            INTEGER NOT NULL DEFAULT 0,
    pct               INTEGER NOT NULL DEFAULT 0,
    max_bonus         INTEGER NOT NULL DEFAULT 0,
    min_deposit       INTEGER NOT NULL DEFAULT 0,
    case_id           TEXT,
    case_count        INTEGER NOT NULL DEFAULT 1,
    -- Во сколько раз бонус надо прокрутить ставками, прежде чем выводить.
    wager_multiplier  REAL    NOT NULL DEFAULT 0,
    max_uses          INTEGER NOT NULL DEFAULT 0,
    used_count        INTEGER NOT NULL DEFAULT 0,
    per_user_limit    INTEGER NOT NULL DEFAULT 1,
    new_players_only  INTEGER NOT NULL DEFAULT 0,
    starts_at         INTEGER,
    expires_at        INTEGER,
    partner_id        INTEGER REFERENCES partners(id),
    is_active         INTEGER NOT NULL DEFAULT 1,
    note              TEXT,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS promo_redemptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_id   INTEGER NOT NULL REFERENCES promocodes(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    granted    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_promo_red_user ON promo_redemptions(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_promo_red_promo ON promo_redemptions(promo_id);

  -- Обещанный процент к пополнению. Ждёт здесь, пока игрок не пополнит счёт:
  -- платёжного шлюза ещё нет, и применить его прямо сейчас не к чему.
  CREATE TABLE IF NOT EXISTS pending_deposit_bonus (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id),
    promo_id         INTEGER NOT NULL REFERENCES promocodes(id),
    pct              INTEGER NOT NULL,
    max_bonus        INTEGER NOT NULL DEFAULT 0,
    min_deposit      INTEGER NOT NULL DEFAULT 0,
    wager_multiplier REAL    NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
  );

  -- Партнёры реферальной программы. Заводятся по Telegram ID: партнёр видит
  -- свою статистику тем же аккаунтом, которым заходит в приложение.
  CREATE TABLE IF NOT EXISTS partners (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id      TEXT    NOT NULL UNIQUE,
    name       TEXT,
    share_pct  REAL    NOT NULL DEFAULT 30,
    is_active  INTEGER NOT NULL DEFAULT 1,
    note       TEXT,
    created_at INTEGER NOT NULL
  );

  -- Выплаты партнёру. Начисления не хранятся: они считаются запросом из
  -- раундов рефералов, поэтому не могут разойтись с фактической игрой.
  CREATE TABLE IF NOT EXISTS partner_payouts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL REFERENCES partners(id),
    amount     INTEGER NOT NULL,
    comment    TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_partner_payouts ON partner_payouts(partner_id, id DESC);

  -- Незавершённая серия фриспинов.
  --
  -- Выигрыш серии зачисляется сразу, в той же транзакции, что и её розыгрыш,
  -- поэтому потерять деньги игрок не может. Но если он вышел из кейса, не
  -- досмотрев прокруты, серия для него просто исчезает - выглядит это как
  -- пропавшая покупка. Поэтому нерассказанная серия лежит здесь и доигрывается
  -- при следующем заходе в тот же кейс.
  --
  -- Серия на игрока одна: купить вторую, не досмотрев первую, нельзя.
  CREATE TABLE IF NOT EXISTS pending_spins (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id),
    case_id    TEXT    NOT NULL,
    payload    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Собственная аналитика. Внешних счётчиков в мини-аппе нет и быть не может:
  -- Telegram открывает приложение во встроенном браузере, где сторонние скрипты
  -- половине игроков не загрузятся, а платить деньгами за то, что уже лежит в
  -- своей же базе, незачем. Событие - это только имя, игрок и момент; всё
  -- остальное (сумма, кейс, причина) кладётся в props отдельной строкой JSON,
  -- чтобы добавление нового события не требовало миграции.
  CREATE TABLE IF NOT EXISTS analytics_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    name       TEXT    NOT NULL,
    props      TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(name, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_user ON analytics_events(user_id, id DESC);

  -- Что бот уже написал игроку. Нужна ровно для одного: не написать второй раз.
  -- Ключ - игрок и повод, а не время: напоминание про один и тот же
  -- недосмотренный набор фриспинов не должно приходить каждый час.
  CREATE TABLE IF NOT EXISTS bot_notices (
    user_id  INTEGER NOT NULL REFERENCES users(id),
    kind     TEXT    NOT NULL,
    tag      TEXT    NOT NULL DEFAULT '',
    sent_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, tag)
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
/**
 * Добавляет колонку, если её ещё нет.
 *
 * Возвращает true, когда колонка действительно появилась. Это нужно разовым
 * пересчётам: их надо выполнить ровно один раз, в момент появления колонки, и
 * заводить ради этого отдельную таблицу отметок незачем.
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols.includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  return true;
}

ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'is_blocked', 'INTEGER NOT NULL DEFAULT 0');
// Колонка осталась от прежней схемы: один удвоитель на игрока. Данные из неё
// переезжают в x2_perks, сама она больше не читается и не пишется.
ensureColumn('users', 'x2_case_id', 'TEXT');
db.exec(`
  INSERT INTO x2_perks (user_id, case_id, count)
  SELECT id, x2_case_id, 1 FROM users WHERE x2_case_id IS NOT NULL
  ON CONFLICT(user_id, case_id) DO NOTHING;
  UPDATE users SET x2_case_id = NULL WHERE x2_case_id IS NOT NULL;
`);
ensureColumn('rounds', 'free', 'INTEGER NOT NULL DEFAULT 0');
// Кейс, из которого пришло выпадение. Нужен витрине: по нему карточка выигрыша
// находит кейс и ведёт в него. У строк, записанных до появления колонки, пусто -
// такая запись просто останется без кнопки.
ensureColumn('rounds', 'case_id', 'TEXT');
ensureColumn('users', 'gamble_stake', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'gamble_case', 'TEXT');
ensureColumn('users', 'free_case_at', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('payouts', 'method', "TEXT NOT NULL DEFAULT 'sbp'");
ensureColumn('payouts', 'phone', 'TEXT');
ensureColumn('payouts', 'bank', 'TEXT');
ensureColumn('payouts', 'card_number', 'TEXT');
ensureColumn('payouts', 'processing_at', 'INTEGER');

/*
 * Вывод криптовалютой. Отдельные колонки, а не переиспользованные phone/bank:
 * адрес кошелька, сеть и сумма в монете - разные по смыслу вещи, и складывать
 * их в поля от СБП значит однажды отправить перевод не туда.
 *
 * Курс и сумма в монете сохраняются в заявку в момент её создания. Пока
 * администратор до неё дойдёт, курс уедет, и без записи было бы непонятно, от
 * чего считали ту сумму, которую видел игрок.
 */
ensureColumn('payouts', 'crypto_currency', 'TEXT');
ensureColumn('payouts', 'crypto_network', 'TEXT');
ensureColumn('payouts', 'crypto_address', 'TEXT');
ensureColumn('payouts', 'crypto_amount', 'TEXT');
ensureColumn('payouts', 'crypto_rate', 'REAL');

// Отыгрыш бонусов: сколько ещё надо поставить, прежде чем выводить средства.
ensureColumn('users', 'wager_required', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Отыгранный оборот: сколько из внесённого игрок уже прокрутил ставками.
 *
 * Правило простое: вывести можно не больше, чем поставлено. Внёс тысячу и
 * сразу пошёл выводить - вывести нечего; поставил двести - двести и доступно.
 *
 * Счётчик, а не флаг, потому что открывается вывод постепенно, по мере игры,
 * а не разом после какой-то отметки. Растёт от каждой ставки, уменьшается на
 * сумму заявки на вывод и возвращается, если заявку отменили или отклонили.
 */
const wagerProgressAdded = ensureColumn('users', 'wager_progress', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Разовый пересчёт для тех, кто играл до появления правила. Без него игрок с
 * тысячей прокрутов увидел бы нулевой доступный вывод и решил бы, что деньги
 * пропали. Считаем по фактическим ставкам за вычетом уже выведенного.
 */
if (wagerProgressAdded) {
  db.exec(`
    UPDATE users SET wager_progress = MAX(0,
      COALESCE((SELECT SUM(bet) FROM rounds WHERE rounds.user_id = users.id), 0)
      - COALESCE((SELECT SUM(amount) FROM payouts
                   WHERE payouts.user_id = users.id
                     AND status IN ('pending','processing','paid')), 0));
  `);
}

// Сумма выданных игроку бонусов - вычитается из прибыли при расчёте партнёру.
ensureColumn('users', 'bonus_granted', 'INTEGER NOT NULL DEFAULT 0');
// Сколько раз игрок пополнял счёт: по нему работает условие «только новым».
ensureColumn('users', 'deposits_count', 'INTEGER NOT NULL DEFAULT 0');
// К какому партнёру привязан игрок. Ставится один раз, первым промокодом.
ensureColumn('users', 'partner_id', 'INTEGER');

// Стартового баланса нет намеренно. Раньше новый игрок получал 1000 условных
// единиц, и этого хватало, чтобы поставить их один раз и подать заявку на вывод,
// не внеся ни рубля: отыгранное считается по ставкам, а откуда взялись деньги,
// правило вывода не различает. Регистрация одноразовых Telegram-аккаунтов стоит
// дешевле такой выплаты, поэтому подарок убран целиком, а не уменьшен.
// Новому игроку теперь дают не деньги, а поощрение за первое пополнение.
//
// Исключение ровно одно: DEV_MODE. В нём подпись Telegram не проверяется и все
// запросы считаются запросами одного тестового игрока - ему нужен баланс,
// иначе автотесты не сделают ни одной ставки. Переменной окружения для этого
// нет намеренно: включить подарок на рабочем сервере можно только вместе с
// выключенной авторизацией, а это уже не про баланс.
const DEV_START_BALANCE = process.env.DEV_MODE === 'true' ? 1_000_000 : 0;

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
    balance: DEV_START_BALANCE,
    server_seed: serverSeed,
    server_seed_hash: hashSeed(serverSeed),
    client_seed: generateClientSeed(),
    created_at: Date.now(),
  });

  const created = selectUser.get(tgId);
  trackEvent(created.id, 'signup');
  return created;
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

  consumeWager(userId, round.bet);

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
  consumeWager(userId, bet);

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

/**
 * Бонус отключён: раздача единиц по таймеру ломала ощущение ставки —
 * проигрыш переставал что-либо значить, раз через час всё равно доначислят.
 * Функция оставлена, чтобы старый клиент получал внятный отказ, а не 404.
 */
export const claimBonus = db.transaction((userId) => {
  return { ok: false, reason: 'disabled' };
});

const claimBonusLegacy = db.transaction((userId) => {
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

/* ---------- Удвоители ---------- */

/**
 * Удвоители, накопленные игроком, по кейсам.
 *
 * Удвоитель привязан к кейсу, который его выдал, и это не украшение. Его
 * ценность в математике посчитана как ожидаемая выплата ЭТОГО кейса: если бы
 * удвоитель, выигранный в кейсе за 24, можно было применить к кейсу за
 * 100 000, отдача перестала бы сходиться и появилась бы дыра, через которую
 * выносится касса.
 */
export function getX2Perks(userId) {
  return db.prepare('SELECT case_id, count FROM x2_perks WHERE user_id = ? AND count > 0')
    .all(userId);
}

function x2Count(userId, caseId) {
  const row = db.prepare('SELECT count FROM x2_perks WHERE user_id = ? AND case_id = ?')
    .get(userId, caseId);
  return row?.count || 0;
}

function addX2(userId, caseId, delta = 1) {
  db.prepare(`
    INSERT INTO x2_perks (user_id, case_id, count) VALUES (?, ?, ?)
    ON CONFLICT(user_id, case_id) DO UPDATE SET count = count + excluded.count
  `).run(userId, caseId, delta);
}

function spendX2(userId, caseId) {
  db.prepare('UPDATE x2_perks SET count = count - 1 WHERE user_id = ? AND case_id = ? AND count > 0')
    .run(userId, caseId);
}

/* ---------- Бесплатный кейс за подписку ---------- */

/**
 * Выдача бесплатного прокрута. Проверка подписки к этому моменту уже
 * пройдена — здесь только кулдаун и сам ваучер.
 *
 * Кулдаун проверяется ВНУТРИ транзакции, а не до неё: два одновременных
 * запроса иначе успели бы прочитать старую метку и выдать два ваучера.
 */
export const grantFreeCase = db.transaction((userId, caseId, cooldownMs) => {
  const user = getUserById(userId);
  const now = Date.now();
  const readyAt = user.free_case_at + cooldownMs;

  if (user.free_case_at && now < readyAt) {
    return { ok: false, reason: 'cooldown', readyAt };
  }

  addVoucher(userId, caseId, 1);
  db.prepare('UPDATE users SET free_case_at = ? WHERE id = ?').run(now, userId);

  return { ok: true, caseId, readyAt: now + cooldownMs };
});

/** Когда игроку снова доступен бесплатный кейс. */
export function freeCaseState(userId, cooldownMs) {
  const user = getUserById(userId);
  const readyAt = user.free_case_at ? user.free_case_at + cooldownMs : 0;
  return { readyAt, ready: Date.now() >= readyAt };
}

/* ---------- Витрина выпадений ---------- */

/**
 * Крупные выпадения живых игроков для витрины.
 *
 * Ник берём из username, а если его нет — из имени. Ни Telegram ID, ни
 * баланс наружу не уходят: витрина видна всем.
 */
/**
 * Выпадения живых игроков для витрины.
 *
 * Порог один - минимальная сумма. Раньше стояла ещё и отсечка по множителю:
 * витрина показывала только крупные выигрыши, и обычное открытие в неё не
 * попадало вовсе. Теперь лента показывает и обычные выпадения, и у игрока
 * нет причин не видеть в ней своё.
 */
export function recentPublicDrops(limit = 24, minValue = 40) {
  return db.prepare(`
    SELECT r.id, r.case_id, r.title AS case_name, r.subtitle AS name, r.tier,
           r.payout AS value, r.multiplier, r.created_at,
           u.username, u.first_name
      FROM rounds r
      JOIN users u ON u.id = r.user_id
     WHERE r.game = 'case' AND r.payout >= ?
     ORDER BY r.id DESC
     LIMIT ?
  `).all(minValue, limit).map((row) => ({
    id: `r${row.id}`,
    nick: row.username || row.first_name || 'игрок',
    caseId: row.case_id,
    caseName: row.case_name,
    name: row.name,
    tier: row.tier,
    value: row.value,
    multiplier: Number(row.multiplier.toFixed(2)),
    at: row.created_at,
    real: true,
  }));
}

/**
 * Открытие кейса целиком: списание либо расход ваучера, розыгрыш, применение
 * ×2, выдача плюшек, запись истории. Одной транзакцией — параллельные запросы
 * не смогут потратить один ваучер дважды или уйти в минус по балансу.
 *
 * resolve(serverSeed, clientSeed, nonce) должен вернуть выпавший предмет.
 */
/** Потолок длины серии фриспинов — предохранитель, см. розыгрыш ниже. */
export const MAX_FREE_SPINS = 300;

/**
 * Прокручивает серию фриспинов и возвращает её итог.
 *
 * Серия крутит ту же полную таблицу, что и платное открытие, поэтому внутри
 * неё может выпасть что угодно, включая новые фриспины: они просто добавляются
 * к остатку. Ряд сходится - ожидаемое число довесков равно share < 1 на
 * прокрут, - но предохранитель всё равно нужен: без него единственная
 * невероятная последовательность подвесила бы транзакцию.
 *
 * Каждый прокрут берёт свой nonce, поэтому проверяется так же, как обычный.
 * Вызывать только внутри транзакции: функция двигает nonce и тратит ваучеры.
 */
function runFreeSpinSeries(userId, caseData, startCount, resolveFree) {
  const spins = [];
  let remaining = startCount;
  let count = startCount;
  let x2Won = 0;
  let payout = 0;

  while (remaining > 0 && spins.length < MAX_FREE_SPINS) {
    remaining--;
    const spinNonce = bumpNonce(userId);
    const u = getUserById(userId);
    const spin = resolveFree(u.server_seed, u.client_seed, spinNonce);
    const fi = spin.item;

    let added = 0;
    if (fi.perk) {
      if (fi.perk.type === 'freespins') { added = fi.perk.count; remaining += added; count += added; }
      // Удвоитель внутри серии её прокруты не трогает: он копится и ждёт
      // следующего платного открытия этого кейса. Иначе удвоитель, выпавший
      // на дармовом прокруте, тут же обесценивался бы на следующем таком же.
      if (fi.perk.type === 'x2') x2Won++;
      if (fi.perk.type === 'voucher') addVoucher(userId, fi.perk.caseId, 1);
    }

    payout += fi.value;
    spins.push({
      name: fi.name,
      value: fi.value,
      tier: fi.tier,
      kind: fi.kind,
      perkType: fi.perk?.type || null,
      added,
      x2: false,
      roll: spin.roll,
      nonce: spinNonce,
    });
  }

  return { spins, payout, count, capped: spins.length >= MAX_FREE_SPINS, x2Won };
}

export const playCaseRound = db.transaction((userId, caseData, resolve, resolveFree) => {
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

  /*
   * Удвоитель тратится только на денежный выигрыш.
   *
   * Плюшка деньгами не приходит: фриспины, подарочный кейс и сам удвоитель
   * имеют value = 0, и на них удвоитель не расходуется - он остаётся ждать.
   * Иначе выигранный удвоитель сгорал бы на первом же прокруте, который
   * выдал фриспины, и игрок терял бы его, ничего не получив.
   */
  const x2Active = item.value > 0 && x2Count(userId, caseData.id) > 0;
  const payout = x2Active ? item.value * 2 : item.value;
  if (x2Active) spendX2(userId, caseData.id);

  const granted = [];
  // Фриспины прокручиваются здесь же, внутри той же транзакции: игрок не может
  // закрыть приложение между выдачей и начислением и потерять выигрыш.
  // Каждый прокрут берёт свой nonce, поэтому проверяется так же, как обычный.
  let freeSpinsPayout = 0;

  if (item.perk) {
    // Сумма берётся из payout, а не из номинала: если на кейсе висел ×2,
    // бонус зачисляется удвоенным, и подпись обязана показать то же число.
    if (item.perk.type === 'credits') granted.push({ type: 'credits', amount: payout });
    if (item.perk.type === 'voucher') {
      addVoucher(userId, item.perk.caseId, 1);
      granted.push({ type: 'voucher', caseId: item.perk.caseId });
    }
    if (item.perk.type === 'x2') {
      // Новый удвоитель кладётся в запас уже после того, как старый применён
      // к этому же прокруту: сам себя он удвоить не может.
      addX2(userId, caseData.id, 1);
      granted.push({ type: 'x2', caseId: caseData.id });
    }
    if (item.perk.type === 'freespins') {
      const series = runFreeSpinSeries(userId, caseData, item.perk.count, resolveFree);
      freeSpinsPayout = series.payout;

      // Удвоители, выпавшие внутри серии, копятся так же, как обычные.
      if (series.x2Won > 0) {
        addX2(userId, caseData.id, series.x2Won);
        for (let i = 0; i < series.x2Won; i++) {
          granted.push({ type: 'x2', caseId: caseData.id });
        }
      }

      granted.push({
        type: 'freespins',
        caseId: caseData.id,
        count: series.count,
        capped: series.capped,
        spins: series.spins,
        total: series.payout,
      });
    }
  }

  if (isFree) {
    db.prepare('UPDATE vouchers SET count = count - 1 WHERE user_id = ? AND case_id = ?')
      .run(userId, caseData.id);
  }

  const spent = isFree ? 0 : caseData.price;
  const totalPayout = payout + freeSpinsPayout;
  const newBalance = before.balance - spent + totalPayout;

  // Бесплатный раунд не идёт в лучший множитель: делить на нулевую ставку
  // бессмысленно, а price там условная.
  const multiplier = isFree ? 0 : totalPayout / caseData.price;

  db.prepare(`
    UPDATE users
       SET balance = ?,
           gamble_stake = ?, gamble_case = ?,
           total_rounds = total_rounds + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(newBalance, totalPayout > 0 ? totalPayout : 0,
         totalPayout > 0 ? caseData.id : null,
         spent, totalPayout, multiplier, userId);

  db.prepare(`
    INSERT INTO rounds (user_id, game, case_id, title, subtitle, bet, payout, multiplier,
                        tier, free, roll, nonce, server_hash, client_seed, created_at)
    VALUES (?, 'case', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, caseData.id, caseData.name,
         item.name + (x2Active ? ' (×2)' : ''),
         spent, totalPayout, multiplier, item.tier, isFree ? 1 : 0,
         roll, nonce, user.server_seed_hash, user.client_seed, Date.now());

  consumeWager(userId, spent);

  return {
    item, roll, nonce, payout, granted,
    freeSpinsPayout,
    totalPayout,
    free: isFree,
    x2Applied: x2Active,
    balance: newBalance,
  };
});

/**
 * Покупка серии фриспинов.
 *
 * Отдельная транзакция, а не открытие кейса: игрок платит не за прокрут, а
 * сразу за серию, и по цене серия дешевле, чем те же прокруты поодиночке
 * (лесенка скидок в FREESPIN_PACKS). Внутри крутится ровно та же таблица и
 * тот же provably fair, что и в обычной игре.
 *
 * В историю пишется одной строкой: ставка - цена пачки, выплата - итог серии.
 * Ролл и nonce берутся с первого прокрута, чтобы серию можно было проверить с
 * её начала.
 */
export const buyFreeSpins = db.transaction((userId, caseData, count, cost, resolveFree) => {
  const before = getUserById(userId);
  if (before.balance < cost) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }

  const user = getUserById(userId);
  const series = runFreeSpinSeries(userId, caseData, count, resolveFree);

  const newBalance = before.balance - cost + series.payout;
  const multiplier = series.payout / cost;

  // Удвоители из серии копятся и ждут платного открытия этого кейса. Купленная
  // серия - тот же дармовой прокрут, удваивать её ими нечестно по отношению к
  // самому игроку: удвоитель сгорел бы на прокруте, который он и так получил.
  if (series.x2Won > 0) addX2(userId, caseData.id, series.x2Won);

  db.prepare(`
    UPDATE users
       SET balance = ?,
           gamble_stake = ?, gamble_case = ?,
           total_rounds = total_rounds + 1,
           total_spent = total_spent + ?,
           total_won = total_won + ?,
           best_multiplier = MAX(best_multiplier, ?)
     WHERE id = ?
  `).run(newBalance,
         series.payout > 0 ? series.payout : 0,
         series.payout > 0 ? caseData.id : null,
         cost, series.payout, multiplier, userId);

  const first = series.spins[0];
  db.prepare(`
    INSERT INTO rounds (user_id, game, case_id, title, subtitle, bet, payout, multiplier,
                        tier, free, roll, nonce, server_hash, client_seed, created_at)
    VALUES (?, 'case', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(userId, caseData.id, caseData.name, `${count} фриспинов`,
         cost, series.payout, multiplier, 'unique',
         first.roll, first.nonce, user.server_seed_hash, user.client_seed, Date.now());

  consumeWager(userId, cost);

  return {
    count: series.count,
    capped: series.capped,
    spins: series.spins,
    total: series.payout,
    // Сколько удвоителей серия отложила в запас: интерфейсу надо это показать,
    // иначе они появляются в плашке молча.
    x2Won: series.x2Won,
    cost,
    balance: newBalance,
  };
});

/**
 * Несколько открытий одного кейса одной транзакцией.
 *
 * Важно, что это именно транзакция: при частичной нехватке средств не должно
 * получиться «три кейса открылись, четвёртый нет» — либо вся пачка, либо
 * ничего. Каждое открытие внутри само разбирается с ваучером и ×2.
 */
export const playCaseBatch = db.transaction((userId, caseData, count, resolve, resolveFree) => {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(playCaseRound(userId, caseData, resolve, resolveFree));
  }
  return results;
});

/* ---------- Незавершённая серия фриспинов ---------- */

/**
 * Запоминает серию, которую игрок ещё не досмотрел.
 *
 * Деньги уже у него на балансе - здесь хранится только то, что показать.
 */
export function savePendingSpins(userId, caseId, grant) {
  db.prepare(`
    INSERT INTO pending_spins (user_id, case_id, payload, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      case_id = excluded.case_id, payload = excluded.payload,
      created_at = excluded.created_at
  `).run(userId, caseId, JSON.stringify(grant), Date.now());
}

export function getPendingSpins(userId) {
  const row = db.prepare('SELECT * FROM pending_spins WHERE user_id = ?').get(userId);
  if (!row) return null;
  try {
    return { caseId: row.case_id, grant: JSON.parse(row.payload), at: row.created_at };
  } catch {
    // Повреждённая запись не должна мешать игре - просто выбрасываем её.
    clearPendingSpins(userId);
    return null;
  }
}

export function clearPendingSpins(userId) {
  db.prepare('DELETE FROM pending_spins WHERE user_id = ?').run(userId);
}

/* ============================================================
   ОТЫГРЫШ БОНУСОВ
   ============================================================ */

/**
 * Отыгрыш - это защита от простой схемы: ввёл промокод на 1000, тут же заказал
 * вывод, ушёл. Ни во что не сыграв, игрок вынес бы подаренные деньги.
 *
 * Схема выбрана самая простая из работающих: бонус не хранится отдельным
 * кошельком, вместо этого игроку записывается долг по обороту. Выдали бонус B
 * с множителем M - к долгу прибавилось B * M. Каждая ставка гасит долг на свой
 * размер. Пока долг не погашен, вывод закрыт.
 *
 * Почему не отдельный «бонусный баланс»: тогда пришлось бы решать, из какого
 * кошелька идёт каждая ставка и в какой попадает выигрыш, и любая ошибка в
 * этой развилке видна игроку как пропавшие деньги. Долг по обороту такой
 * развилки не создаёт вовсе.
 *
 * Отыграть можно любой игрой: кейсами, крашем, рулеткой, апгрейдом. Ограничить
 * отыгрыш одной игрой было бы честнее к заведению, но игроку это правило почти
 * всегда объясняют плохо, и оно превращается в ловушку.
 */

/** Добавляет долг по обороту за выданный бонус. */
function addWager(userId, bonusAmount, multiplier) {
  if (!(bonusAmount > 0) || !(multiplier > 0)) return;
  db.prepare('UPDATE users SET wager_required = wager_required + ? WHERE id = ?')
    .run(Math.round(bonusAmount * multiplier), userId);
}

/**
 * Учитывает сделанную ставку.
 *
 * Делает две вещи сразу, и обе про одну ставку. Гасит долг по обороту за
 * выданный бонус - он не уходит в минус, лишнее просто сгорает. И копит
 * отыгранный оборот, которым открывается вывод внесённого.
 *
 * Одна функция, а не две, потому что вызывается она из каждой игры: две
 * означали бы, что однажды где-то вызовут только одну, и правило поедет
 * молча, в пользу того, кто это заметит первым.
 */
export function consumeWager(userId, bet) {
  if (!(bet > 0)) return;
  const amount = Math.round(bet);
  db.prepare(`UPDATE users
                 SET wager_required = MAX(0, wager_required - ?),
                     wager_progress = wager_progress + ?
               WHERE id = ?`).run(amount, amount, userId);
}

/** Пополнение отыгрывать надо: доступное к выводу от него не растёт. */
/**
 * Условия поощрения за первое пополнение.
 *
 * Читается из окружения при каждом вызове, а не один раз при загрузке: правило
 * маркетинговое, его меняют чаще, чем код, и перезапуск ради процента - лишний
 * повод уронить приём платежей.
 */
export function firstDepositRules() {
  return {
    // Процент к первому пополнению. 0 выключает поощрение целиком.
    pct: Number(process.env.FIRST_DEPOSIT_PCT ?? 100),
    // Потолок бонуса в рублях: процент без потолка - это подарок тому, кто
    // внесёт миллион и сразу закажет вывод.
    max: Number(process.env.FIRST_DEPOSIT_MAX ?? 1000),
    // Меньше этой суммы поощрения нет: иначе пополнение на рубль давало бы бонус.
    min: Number(process.env.FIRST_DEPOSIT_MIN ?? 500),
    // Во сколько раз бонус надо отыграть ставками. Бонусные деньги не
    // увеличивают отыгранное (см. withdrawable), так что вывести их, не сыграв,
    // нельзя в любом случае; множитель задаёт, сколько надо сыграть, чтобы
    // погас долг по обороту.
    wager: Number(process.env.FIRST_DEPOSIT_WAGER ?? 2),
  };
}

/** Сколько дадим сверх этого пополнения, если оно первое. Ноль - не дадим. */
export function firstDepositBonus(amount, rules = firstDepositRules()) {
  if (!(rules.pct > 0) || !(amount >= rules.min)) return 0;
  const raw = Math.floor((amount * rules.pct) / 100);
  return rules.max > 0 ? Math.min(raw, rules.max) : raw;
}

/**
 * Всё, что должно произойти после зачисления пополнения, кроме самого
 * зачисления: строку в deposits и прибавку к балансу пишет тот, кто принял
 * деньги (он один знает комментарий и идентификатор платежа), а общие для всех
 * шлюзов последствия собраны здесь.
 *
 * Отыгранное (wager_progress) пополнение НЕ увеличивает - в этом и смысл
 * правила: вывести можно только то, что прошло через ставки.
 *
 * Вызывать внутри транзакции того, кто зачисляет: бонус и счётчик пополнений
 * не должны пережить откат зачисления.
 */
export function registerDeposit(userId, amount, source = 'gateway') {
  const before = getUserById(userId);
  if (!before) return { bonus: 0 };

  db.prepare('UPDATE users SET deposits_count = deposits_count + 1 WHERE id = ?').run(userId);
  trackEvent(userId, 'deposit_paid', { amount, source });

  // Обещанный промокодом процент важнее приветственного: игрок его специально
  // активировал. Складывать их нельзя - это один и тот же слот «процент к
  // пополнению», и вместе они дают отдачу выше 100%.
  const promoBonus = applyDepositBonus(userId, amount);
  if (promoBonus > 0) return { bonus: promoBonus, kind: 'promo' };

  if (before.deposits_count > 0) return { bonus: 0 };

  const rules = firstDepositRules();
  const bonus = firstDepositBonus(amount, rules);
  if (bonus <= 0) return { bonus: 0 };

  db.prepare('UPDATE users SET balance = balance + ?, bonus_granted = bonus_granted + ? WHERE id = ?')
    .run(bonus, bonus, userId);
  addWager(userId, bonus, rules.wager);
  db.prepare(`INSERT INTO deposits (user_id, amount, source, comment, created_at)
              VALUES (?, ?, 'welcome', ?, ?)`)
    .run(userId, bonus, `Бонус за первое пополнение +${rules.pct}%`, Date.now());
  trackEvent(userId, 'deposit_first_bonus', { amount, bonus });

  return { bonus, kind: 'first' };
}

/**
 * Сколько игрок может вывести прямо сейчас.
 *
 * Меньшее из двух: что есть на балансе и что отыграно ставками. Первое
 * очевидно, второе - то самое правило: вывести можно не больше, чем поставил.
 */
export function withdrawable(user) {
  return Math.max(0, Math.min(user.balance, user.wager_progress));
}

/* ============================================================
   АНАЛИТИКА
   ============================================================ */

/**
 * Разрешённые события. Список закрытый намеренно: часть событий шлёт клиент,
 * а клиенту верить нельзя - без белого списка в таблицу насыпали бы что угодно
 * и она перестала бы быть пригодной для отчётов.
 *
 * Порядок здесь не случайный: воронка ниже читает его сверху вниз.
 */
export const FUNNEL_STEPS = [
  { name: 'signup', title: 'Открыл приложение' },
  { name: 'case_open', title: 'Открыл кейс' },
  { name: 'cashier_view', title: 'Зашёл в кассу' },
  { name: 'deposit_created', title: 'Создал заявку' },
  { name: 'deposit_paid', title: 'Пополнил' },
  { name: 'payout_created', title: 'Заказал вывод' },
];

/** События, которые вправе прислать клиент. Всё остальное пишет только сервер. */
export const CLIENT_EVENTS = new Set([
  'cashier_view', 'no_funds', 'no_funds_to_cashier', 'promo_view', 'onboarding_done',
]);

const ALL_EVENTS = new Set([
  ...FUNNEL_STEPS.map((s) => s.name),
  ...CLIENT_EVENTS,
  'deposit_first_bonus', 'promo_redeemed', 'freespins_bought', 'bot_reminder',
]);

const insertEvent = db.prepare(
  'INSERT INTO analytics_events (user_id, name, props, created_at) VALUES (?, ?, ?, ?)'
);

/**
 * Записывает событие. Никогда не бросает исключение: аналитика не имеет права
 * уронить игру или платёж, ради которых её и вызывают.
 */
export function trackEvent(userId, name, props) {
  if (!ALL_EVENTS.has(name)) return false;
  try {
    insertEvent.run(userId || null, name, props ? JSON.stringify(props) : null, Date.now());
    return true;
  } catch {
    return false;
  }
}

/**
 * Воронка по когорте: берём игроков, зарегистрированных за период, и смотрим,
 * до какого шага каждый дошёл.
 *
 * Считаем именно по когорте, а не по событиям за период. Иначе на шаге
 * «пополнил» оказались бы вчерашние игроки, пополнившие сегодня, и доля
 * получилась бы выше настоящей - отчёт, который врёт в приятную сторону,
 * хуже отсутствующего.
 */
export function funnelStats(days = 7) {
  const from = Date.now() - Math.max(1, days) * 86400000;
  const cohort = db.prepare('SELECT COUNT(*) n FROM users WHERE created_at >= ?').get(from).n;

  const step = db.prepare(`
    SELECT COUNT(DISTINCT e.user_id) n
      FROM analytics_events e
      JOIN users u ON u.id = e.user_id
     WHERE e.name = ? AND u.created_at >= ?
  `);

  let prev = cohort;
  const steps = FUNNEL_STEPS.map((s, i) => {
    // Первый шаг - сама когорта: событие signup пишется при создании игрока,
    // но у игроков, заведённых до появления аналитики, его нет.
    const users = i === 0 ? cohort : step.get(s.name, from).n;
    const row = {
      name: s.name,
      title: s.title,
      users,
      ofCohort: cohort ? users / cohort : 0,
      ofPrev: prev ? users / prev : 0,
    };
    prev = users;
    return row;
  });

  const money = db.prepare(`
    SELECT COALESCE(SUM(d.amount), 0) deposited, COUNT(*) count
      FROM deposits d JOIN users u ON u.id = d.user_id
     WHERE u.created_at >= ? AND d.source IN ('beeline', 'crypto', 'admin')
  `).get(from);

  return {
    days,
    from,
    cohort,
    steps,
    deposited: money.deposited,
    deposits: money.count,
    arpu: cohort ? money.deposited / cohort : 0,
  };
}

/** Сырые счётчики событий за период - для строки «прочее» под воронкой. */
export function eventTotals(days = 7) {
  const from = Date.now() - Math.max(1, days) * 86400000;
  return db.prepare(`
    SELECT name, COUNT(*) total, COUNT(DISTINCT user_id) users
      FROM analytics_events WHERE created_at >= ?
     GROUP BY name ORDER BY total DESC
  `).all(from);
}

/* ============================================================
   НАПОМИНАНИЯ БОТА
   ============================================================ */

/**
 * Кого нужно позвать обратно и по какому поводу.
 *
 * Общее правило для всех поводов: пишем один раз на повод. Ключ повторности -
 * пара «повод + метка»: для фриспинов метка это момент покупки серии, для
 * бесплатного кейса - момент, с которого он снова доступен. Так следующая
 * серия или следующие сутки дадут новое напоминание, а одно и то же - нет.
 *
 * Молчащих аккаунтов не трогаем: писать тому, кто не заходил месяц, значит
 * собирать жалобы на спам и блокировки бота, а вернуть его сообщением про
 * недокрученные фриспины всё равно не выйдет.
 */
const REMIND_SILENCE_MS = 30 * 86400000;

/** Незавершённая серия фриспинов, о которой ещё не напоминали. */
export function pendingSpinReminders(minAgeMs, limit = 50) {
  const now = Date.now();
  return db.prepare(`
    SELECT u.id, u.tg_id, u.first_name, u.username, s.case_id, s.created_at
      FROM pending_spins s
      JOIN users u ON u.id = s.user_id
     WHERE s.created_at <= ?
       AND u.is_blocked = 0
       AND u.created_at >= ?
       AND NOT EXISTS (SELECT 1 FROM bot_notices n
                        WHERE n.user_id = u.id AND n.kind = 'freespins'
                          AND n.tag = CAST(s.created_at AS TEXT))
     ORDER BY s.created_at LIMIT ?
  `).all(now - minAgeMs, now - REMIND_SILENCE_MS, limit);
}

/**
 * Кому снова доступен бесплатный кейс.
 *
 * Игроки, ни разу его не забиравшие, тоже попадают сюда: free_case_at у них
 * ноль, то есть кейс доступен с самого начала. Метка «0» гарантирует, что
 * такое приглашение уйдёт ровно однажды.
 */
export function freeCaseReminders(cooldownMs, limit = 50) {
  const now = Date.now();
  return db.prepare(`
    SELECT id, tg_id, first_name, username, free_case_at
      FROM users
     WHERE is_blocked = 0
       AND created_at >= ?
       AND (free_case_at = 0 OR free_case_at + ? <= ?)
       AND NOT EXISTS (SELECT 1 FROM bot_notices n
                        WHERE n.user_id = users.id AND n.kind = 'free_case'
                          AND n.tag = CAST(CASE WHEN free_case_at = 0 THEN 0
                                                ELSE free_case_at + ? END AS TEXT))
     ORDER BY free_case_at LIMIT ?
  `).all(now - REMIND_SILENCE_MS, cooldownMs, now, cooldownMs, limit);
}

/** Отмечает отправленное напоминание. Повторный вызов ничего не меняет. */
export function markNoticeSent(userId, kind, tag) {
  db.prepare(`INSERT OR IGNORE INTO bot_notices (user_id, kind, tag, sent_at)
              VALUES (?, ?, ?, ?)`).run(userId, kind, String(tag), Date.now());
  trackEvent(userId, 'bot_reminder', { kind });
}

/* ============================================================
   ПРОМОКОДЫ
   ============================================================ */

const PROMO_TYPES = new Set(['balance', 'deposit_pct', 'free_case']);

/** Приводит код к каноническому виду: регистр и пробелы не должны мешать. */
export function normalizePromoCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function getPromoByCode(code) {
  return db.prepare('SELECT * FROM promocodes WHERE code = ?').get(normalizePromoCode(code));
}

/**
 * Активация промокода игроком.
 *
 * resolveCase(caseId) отдаёт { name, price, rtp } - знание о кейсах живёт в
 * cases.js, и тащить его в хранилище незачем.
 *
 * Возвращает описание того, что игрок получил, чтобы интерфейс мог сказать это
 * словами, а не «код принят».
 */
export const redeemPromo = db.transaction((userId, rawCode, resolveCase) => {
  const code = normalizePromoCode(rawCode);
  const fail = (message, codeName) =>
    Object.assign(new Error(message), { code: codeName || 'PROMO' });

  if (!code) throw fail('Введите промокод');

  const promo = db.prepare('SELECT * FROM promocodes WHERE code = ?').get(code);
  if (!promo || !promo.is_active) throw fail('Промокод не найден');

  const now = Date.now();
  if (promo.starts_at && now < promo.starts_at) throw fail('Промокод ещё не начал действовать');
  if (promo.expires_at && now > promo.expires_at) throw fail('Срок действия промокода истёк');
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
    throw fail('Промокод уже использован максимальное число раз');
  }

  const mine = db.prepare(
    'SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id = ? AND user_id = ?'
  ).get(promo.id, userId).n;
  if (promo.per_user_limit > 0 && mine >= promo.per_user_limit) {
    throw fail('Вы уже активировали этот промокод');
  }

  const user = getUserById(userId);
  if (promo.new_players_only && user.deposits_count > 0) {
    throw fail('Промокод только для игроков без пополнений');
  }

  let granted = 0;
  let result;

  if (promo.type === 'balance') {
    if (!(promo.amount > 0)) throw fail('Промокод настроен неверно');
    granted = promo.amount;
    db.prepare('UPDATE users SET balance = balance + ?, bonus_granted = bonus_granted + ? WHERE id = ?')
      .run(granted, granted, userId);
    addWager(userId, granted, promo.wager_multiplier);
    result = { type: 'balance', amount: granted };

  } else if (promo.type === 'free_case') {
    const target = resolveCase(promo.case_id);
    if (!target) throw fail('Промокод настроен неверно');
    const count = Math.max(1, promo.case_count);
    addVoucher(userId, promo.case_id, count);

    // Подарочный кейс стоит заведению своё матожидание, а не цену: игрок
    // получает не деньги, а прокрут. Эта же сумма потом вычитается из прибыли
    // при расчёте доли партнёра.
    granted = Math.round(target.price * target.rtp * count);
    db.prepare('UPDATE users SET bonus_granted = bonus_granted + ? WHERE id = ?')
      .run(granted, userId);
    addWager(userId, granted, promo.wager_multiplier);
    result = { type: 'free_case', caseId: promo.case_id, caseName: target.name, count };

  } else if (promo.type === 'deposit_pct') {
    if (!(promo.pct > 0)) throw fail('Промокод настроен неверно');
    // Процент вешается на следующее пополнение: сейчас начислять нечего.
    db.prepare(`
      INSERT INTO pending_deposit_bonus
        (user_id, promo_id, pct, max_bonus, min_deposit, wager_multiplier, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        promo_id = excluded.promo_id, pct = excluded.pct,
        max_bonus = excluded.max_bonus, min_deposit = excluded.min_deposit,
        wager_multiplier = excluded.wager_multiplier, created_at = excluded.created_at
    `).run(userId, promo.id, promo.pct, promo.max_bonus, promo.min_deposit,
           promo.wager_multiplier, now);
    result = { type: 'deposit_pct', pct: promo.pct, maxBonus: promo.max_bonus,
               minDeposit: promo.min_deposit };

  } else {
    throw fail('Промокод настроен неверно');
  }

  // Привязка к партнёру ставится один раз и навсегда: если игрок уже чей-то,
  // второй промокод его не переманивает.
  if (promo.partner_id && !user.partner_id) {
    db.prepare('UPDATE users SET partner_id = ? WHERE id = ?').run(promo.partner_id, userId);
  }

  db.prepare('UPDATE promocodes SET used_count = used_count + 1 WHERE id = ?').run(promo.id);
  db.prepare(`INSERT INTO promo_redemptions (promo_id, user_id, granted, created_at)
              VALUES (?, ?, ?, ?)`).run(promo.id, userId, granted, now);

  const after = getUserById(userId);
  return {
    ...result,
    wagerRequired: after.wager_required,
    balance: after.balance,
  };
});

/** Ожидающий процент к пополнению - показывается игроку в разделе бонусов. */
export function pendingDepositBonus(userId) {
  return db.prepare('SELECT * FROM pending_deposit_bonus WHERE user_id = ?').get(userId) || null;
}

/** История активаций игрока. */
export function myPromoRedemptions(userId, limit = 20) {
  return db.prepare(`
    SELECT r.granted, r.created_at, p.code, p.type
      FROM promo_redemptions r
      JOIN promocodes p ON p.id = r.promo_id
     WHERE r.user_id = ?
     ORDER BY r.id DESC
     LIMIT ?
  `).all(userId, limit);
}

/* ============================================================
   ПАРТНЁРЫ
   ============================================================ */

export function getPartnerByTgId(tgId) {
  return db.prepare('SELECT * FROM partners WHERE tg_id = ?').get(String(tgId)) || null;
}

/**
 * Статистика партнёра.
 *
 * Прибыль считается запросом по раундам его рефералов, а не копится отдельной
 * колонкой: колонка рано или поздно разошлась бы с фактической игрой, а запрос
 * разойтись не может.
 *
 * Берётся чистая прибыль: ставки минус выплаты минус выданные этим игрокам
 * бонусы. Без вычета бонусов партнёр получал бы долю с прибыли, которой не
 * было, - игрок ведь играл на подаренные деньги.
 *
 * Минус переносится сам собой, потому что считается за всё время: если реферал
 * крупно выиграл, доля партнёра снова станет положительной только после того,
 * как эта прибыль отыграется обратно. Это обычная практика партнёрских
 * программ, и она защищает от схемы «привёл себя, выиграл, забрал долю».
 */
export function partnerStats(partnerId) {
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(partnerId);
  if (!partner) return null;

  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE partner_id = @pid) AS referrals,
      (SELECT COUNT(*) FROM users WHERE partner_id = @pid AND total_rounds > 0) AS active,
      COALESCE((SELECT SUM(r.bet) FROM rounds r
                  JOIN users u ON u.id = r.user_id
                 WHERE u.partner_id = @pid), 0) AS wagered,
      COALESCE((SELECT SUM(r.payout) FROM rounds r
                  JOIN users u ON u.id = r.user_id
                 WHERE u.partner_id = @pid), 0) AS paid,
      COALESCE((SELECT SUM(u.bonus_granted) FROM users u
                 WHERE u.partner_id = @pid), 0) AS bonuses,
      COALESCE((SELECT SUM(amount) FROM partner_payouts WHERE partner_id = @pid), 0) AS payouts
  `).get({ pid: partnerId });

  const profit = totals.wagered - totals.paid - totals.bonuses;
  const accrued = profit > 0 ? Math.floor((profit * partner.share_pct) / 100) : 0;

  return {
    partner,
    referrals: totals.referrals,
    active: totals.active,
    wagered: totals.wagered,
    paid: totals.paid,
    bonuses: totals.bonuses,
    profit,
    accrued,
    paidOut: totals.payouts,
    pending: accrued - totals.payouts,
  };
}

/** Рефералы партнёра списком - для его собственного экрана. */
export function partnerReferrals(partnerId, limit = 50) {
  return db.prepare(`
    SELECT u.id, u.username, u.first_name, u.created_at, u.total_rounds,
           u.total_spent, u.total_won, u.bonus_granted
      FROM users u
     WHERE u.partner_id = ?
     ORDER BY u.id DESC
     LIMIT ?
  `).all(partnerId, limit);
}

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

  // Начисление показывается игроку в истории пополнений, списание — нет:
  // в кассе он должен видеть приход, а не служебные корректировки.
  if (applied > 0) {
    db.prepare(`INSERT INTO deposits (user_id, amount, source, comment, created_at)
                VALUES (?, ?, 'admin', ?, ?)`)
      .run(targetId, applied, note || 'Начисление администратором', Date.now());
    registerDeposit(targetId, applied, 'admin');
  }

  return { balance: getUserById(targetId).balance, applied };
});

/**
 * Применяет обещанный промокодом процент к пополнению.
 *
 * Вызывается только из registerDeposit, то есть одинаково для всех шлюзов:
 * Beeline, криптокассы и начисления руками. Бонус одноразовый - сработал,
 * запись убирается.
 */
function applyDepositBonus(userId, depositAmount) {
  const pending = db.prepare('SELECT * FROM pending_deposit_bonus WHERE user_id = ?').get(userId);
  if (!pending) return 0;
  if (depositAmount < pending.min_deposit) return 0;

  let bonus = Math.floor((depositAmount * pending.pct) / 100);
  if (pending.max_bonus > 0) bonus = Math.min(bonus, pending.max_bonus);
  if (bonus <= 0) return 0;

  db.prepare('UPDATE users SET balance = balance + ?, bonus_granted = bonus_granted + ? WHERE id = ?')
    .run(bonus, bonus, userId);
  addWager(userId, bonus, pending.wager_multiplier);

  db.prepare(`INSERT INTO deposits (user_id, amount, source, comment, created_at)
              VALUES (?, ?, 'promo', ?, ?)`)
    .run(userId, bonus, `Бонус к пополнению +${pending.pct}%`, Date.now());

  db.prepare('DELETE FROM pending_deposit_bonus WHERE user_id = ?').run(userId);
  return bonus;
}

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
         won ? `Нашёл туза - ${config.payout}x` : 'Промах',
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

/* ---------- Админка: промокоды ---------- */

/** Поля, которые администратор может задать у промокода. */
const PROMO_FIELDS = [
  'type', 'amount', 'pct', 'max_bonus', 'min_deposit', 'case_id', 'case_count',
  'wager_multiplier', 'max_uses', 'per_user_limit', 'new_players_only',
  'starts_at', 'expires_at', 'partner_id', 'is_active', 'note',
];

export const adminSavePromo = db.transaction((adminId, data) => {
  const code = normalizePromoCode(data.code);
  if (!code) throw Object.assign(new Error('Укажите код'), { code: 'BAD' });
  if (!PROMO_TYPES.has(data.type)) {
    throw Object.assign(new Error('Неизвестный тип промокода'), { code: 'BAD' });
  }

  const row = {
    code,
    type: data.type,
    amount: Math.max(0, Math.trunc(Number(data.amount) || 0)),
    pct: Math.max(0, Math.trunc(Number(data.pct) || 0)),
    max_bonus: Math.max(0, Math.trunc(Number(data.max_bonus) || 0)),
    min_deposit: Math.max(0, Math.trunc(Number(data.min_deposit) || 0)),
    case_id: data.case_id || null,
    case_count: Math.max(1, Math.trunc(Number(data.case_count) || 1)),
    wager_multiplier: Math.max(0, Number(data.wager_multiplier) || 0),
    max_uses: Math.max(0, Math.trunc(Number(data.max_uses) || 0)),
    per_user_limit: Math.max(0, Math.trunc(Number(data.per_user_limit) || 1)),
    new_players_only: data.new_players_only ? 1 : 0,
    starts_at: data.starts_at ? Number(data.starts_at) : null,
    expires_at: data.expires_at ? Number(data.expires_at) : null,
    partner_id: data.partner_id ? Number(data.partner_id) : null,
    is_active: data.is_active === false ? 0 : 1,
    note: data.note || null,
  };

  const existing = db.prepare('SELECT id FROM promocodes WHERE code = ?').get(code);

  if (existing) {
    // Счётчик активаций при правке не трогаем: это факт, а не настройка.
    const sets = PROMO_FIELDS.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE promocodes SET ${sets} WHERE id = @id`).run({ ...row, id: existing.id });
    db.prepare(`INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
                VALUES (?, 0, 'promo_edit', NULL, ?, ?)`).run(adminId, code, Date.now());
    return { id: existing.id, code, created: false };
  }

  const cols = ['code', ...PROMO_FIELDS];
  const info = db.prepare(`
    INSERT INTO promocodes (${cols.join(', ')}, created_at)
    VALUES (${cols.map((c) => '@' + c).join(', ')}, @created_at)
  `).run({ ...row, created_at: Date.now() });

  db.prepare(`INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
              VALUES (?, 0, 'promo_add', NULL, ?, ?)`).run(adminId, code, Date.now());

  return { id: info.lastInsertRowid, code, created: true };
});

export function adminListPromos() {
  return db.prepare(`
    SELECT p.*, pa.name AS partner_name, pa.tg_id AS partner_tg
      FROM promocodes p
      LEFT JOIN partners pa ON pa.id = p.partner_id
     ORDER BY p.id DESC
  `).all();
}

export const adminDeletePromo = db.transaction((adminId, id) => {
  const promo = db.prepare('SELECT * FROM promocodes WHERE id = ?').get(id);
  if (!promo) throw Object.assign(new Error('Промокод не найден'), { code: 'NOT_FOUND' });

  // Активации не удаляем: они часть истории начислений. Сам код просто гасим,
  // если им уже пользовались, и удаляем, если нет.
  if (promo.used_count > 0) {
    db.prepare('UPDATE promocodes SET is_active = 0 WHERE id = ?').run(id);
  } else {
    db.prepare('DELETE FROM promocodes WHERE id = ?').run(id);
  }

  db.prepare(`INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
              VALUES (?, 0, 'promo_del', NULL, ?, ?)`).run(adminId, promo.code, Date.now());

  return { disabled: promo.used_count > 0 };
});

/* ---------- Админка: партнёры ---------- */

export const adminSavePartner = db.transaction((adminId, data) => {
  const tgId = String(data.tg_id || '').trim();
  if (!/^\d+$/.test(tgId)) {
    throw Object.assign(new Error('Telegram ID - это число'), { code: 'BAD' });
  }

  const share = Math.min(100, Math.max(0, Number(data.share_pct) || 0));
  const existing = db.prepare('SELECT id FROM partners WHERE tg_id = ?').get(tgId);

  if (existing) {
    db.prepare(`UPDATE partners SET name = ?, share_pct = ?, is_active = ?, note = ?
                 WHERE id = ?`)
      .run(data.name || null, share, data.is_active === false ? 0 : 1,
           data.note || null, existing.id);
    return { id: existing.id, created: false };
  }

  const info = db.prepare(`
    INSERT INTO partners (tg_id, name, share_pct, is_active, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tgId, data.name || null, share, data.is_active === false ? 0 : 1,
         data.note || null, Date.now());

  db.prepare(`INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
              VALUES (?, 0, 'partner_add', NULL, ?, ?)`).run(adminId, tgId, Date.now());

  return { id: info.lastInsertRowid, created: true };
});

/** Все партнёры со сведённой статистикой - для списка в админке. */
export function adminListPartners() {
  return db.prepare('SELECT id FROM partners ORDER BY id DESC')
    .all()
    .map((row) => partnerStats(row.id));
}

export const adminPayPartner = db.transaction((adminId, partnerId, amount, comment) => {
  const stats = partnerStats(partnerId);
  if (!stats) throw Object.assign(new Error('Партнёр не найден'), { code: 'NOT_FOUND' });

  const sum = Math.trunc(Number(amount) || 0);
  if (sum <= 0) throw Object.assign(new Error('Укажите сумму'), { code: 'BAD' });
  if (sum > stats.pending) {
    throw Object.assign(new Error(`К выплате доступно ${stats.pending}`), { code: 'BAD' });
  }

  db.prepare(`INSERT INTO partner_payouts (partner_id, amount, comment, created_at)
              VALUES (?, ?, ?, ?)`).run(partnerId, sum, comment || null, Date.now());
  db.prepare(`INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
              VALUES (?, 0, 'partner_payout', ?, ?, ?)`)
    .run(adminId, sum, `партнёр #${partnerId}`, Date.now());

  return partnerStats(partnerId);
});

export function partnerPayoutHistory(partnerId, limit = 30) {
  return db.prepare(`SELECT * FROM partner_payouts WHERE partner_id = ?
                      ORDER BY id DESC LIMIT ?`).all(partnerId, limit);
}

/* ============================================================
   КАССА: ПОПОЛНЕНИЯ И ВЫВОДЫ
   ============================================================ */

/** Минимальная сумма заявки на вывод. */
export const MIN_PAYOUT = Number(process.env.MIN_PAYOUT || 1000);

export function getDeposits(userId, limit = 50) {
  return db.prepare(`
    SELECT amount, source, comment, created_at
      FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `).all(userId, limit);
}

export function getPayouts(userId, limit = 50) {
  return db.prepare(`
    SELECT id, amount, status, method, phone, bank, card_number,
           crypto_currency, crypto_network, crypto_address, crypto_amount,
           comment, created_at, processing_at, resolved_at
      FROM payouts WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `).all(userId, limit).map(row => ({ ...row, card_number: row.card_number ? `•••• ${decryptCard(row.card_number).slice(-4)}` : null }));
}

/** Сумма заявок, ожидающих решения администратора. */
export function pendingPayoutTotal(userId) {
  return db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM payouts
                      WHERE user_id = ? AND status IN ('pending','processing')`).get(userId).n;
}

/**
 * Создание заявки на вывод.
 *
 * Сумма списывается сразу, а не при одобрении: иначе игрок мог бы подать
 * несколько заявок на один и тот же баланс, а потом проиграть его в кейсах,
 * и администратору пришлось бы выплачивать то, чего уже нет.
 */
export const createPayout = db.transaction((userId, amount, details = {}) => {
  const user = getUserById(userId);

  if (amount < MIN_PAYOUT) {
    throw Object.assign(new Error(`Минимальная сумма вывода - ${MIN_PAYOUT}`), { code: 'MIN' });
  }
  if (amount > user.balance) {
    throw Object.assign(new Error('Недостаточно средств'), { code: 'INSUFFICIENT_FUNDS' });
  }
  /*
   * Вывести можно не больше, чем поставлено. Сообщение обязано называть
   * конкретное число: «отыграйте депозит» игрок читает как отказ без причины,
   * а «доступно 200 ₽, поставлено 200 из 1000» - как понятное правило.
   */
  const free = withdrawable(user);
  if (amount > free) {
    throw Object.assign(
      new Error(free > 0
        ? `Доступно к выводу ${free} - остальное нужно отыграть ставками`
        : 'Сначала сыграйте: вывести можно не больше, чем поставлено'),
      { code: 'WAGER_PROGRESS', available: free }
    );
  }
  if (user.wager_required > 0) {
    throw Object.assign(
      new Error(`Бонус не отыгран: осталось поставить ${user.wager_required}`),
      { code: 'WAGER' }
    );
  }

  const method = String(details.method || '').toLowerCase();
  let phone = null, bank = null, cardNumber = null;
  let cryptoCurrency = null, cryptoNetwork = null, cryptoAddress = null;
  let cryptoAmount = null, cryptoRate = null;
  if (method === 'sbp') {
    const digits = String(details.phone || '').replace(/\D/g, '');
    phone = digits.length === 11 && /^[78]/.test(digits) ? `+7${digits.slice(1)}` : null;
    bank = String(details.bank || '').trim().slice(0, 120);
    if (!phone) throw Object.assign(new Error('Укажите корректный номер телефона'), { code: 'BAD_PHONE' });
    if (!bank) throw Object.assign(new Error('Выберите банк'), { code: 'BAD_BANK' });
  } else if (method === 'card') {
    cardNumber = String(details.cardNumber || '').replace(/\D/g, '');
    if (!/^\d{16,19}$/.test(cardNumber)) throw Object.assign(new Error('Укажите корректный номер карты'), { code: 'BAD_CARD' });
    const validLuhn = cardNumber.split('').reverse().reduce((sum, ch, i) => {
      let n = Number(ch); if (i % 2) { n *= 2; if (n > 9) n -= 9; } return sum + n;
    }, 0) % 10 === 0;
    if (!validLuhn) throw Object.assign(new Error('Проверьте номер карты'), { code: 'BAD_CARD' });
  } else if (method === 'crypto') {
    /*
     * Адрес не проверяем по форме конкретной сети: у двух десятков сетей свои
     * форматы, и жёсткая проверка отвергала бы верные адреса новых сетей
     * раньше, чем мы успевали бы её поправить. Проверяем длину и алфавит -
     * этого хватает, чтобы отсечь пустое поле и явный мусор, а сверяет адрес
     * администратор перед отправкой: заявка всё равно проходит через его руки.
     */
    cryptoCurrency = String(details.cryptoCurrency || '').toUpperCase().slice(0, 12);
    cryptoNetwork = String(details.cryptoNetwork || '').toUpperCase().slice(0, 16);
    cryptoAddress = String(details.cryptoAddress || '').trim();
    cryptoAmount = String(details.cryptoAmount || '').slice(0, 40);
    cryptoRate = Number(details.cryptoRate) || null;

    if (!cryptoCurrency || !cryptoNetwork) {
      throw Object.assign(new Error('Выберите монету и сеть'), { code: 'BAD_CURRENCY' });
    }
    if (!/^[A-Za-z0-9:_-]{16,120}$/.test(cryptoAddress)) {
      throw Object.assign(new Error('Проверьте адрес кошелька'), { code: 'BAD_ADDRESS' });
    }
    if (!cryptoRate || cryptoRate <= 0) {
      throw Object.assign(new Error('Курс недоступен, попробуйте позже'), { code: 'BAD_RATE' });
    }
  } else {
    throw Object.assign(new Error('Выберите способ вывода'), { code: 'BAD_METHOD' });
  }

  // Вместе с деньгами расходуется и отыгранное: одну и ту же тысячу ставок
  // нельзя предъявить дважды.
  db.prepare(`UPDATE users
                 SET balance = balance - ?,
                     wager_progress = MAX(0, wager_progress - ?)
               WHERE id = ?`).run(amount, amount, userId);
  const info = db.prepare(`
    INSERT INTO payouts (user_id, amount, status, method, phone, bank, card_number,
                         crypto_currency, crypto_network, crypto_address, crypto_amount,
                         crypto_rate, created_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, amount, method, phone, bank, cardNumber ? encryptCard(cardNumber) : null,
         cryptoCurrency, cryptoNetwork, cryptoAddress, cryptoAmount, cryptoRate, Date.now());

  return { id: info.lastInsertRowid, amount, balance: getUserById(userId).balance };
});

/** Отмена собственной заявки: средства возвращаются на баланс. */
export const cancelPayout = db.transaction((userId, payoutId) => {
  const row = db.prepare(`SELECT * FROM payouts WHERE id = ? AND user_id = ?`)
    .get(payoutId, userId);

  if (!row) throw Object.assign(new Error('Заявка не найдена'), { code: 'NOT_FOUND' });
  if (row.status !== 'pending') {
    throw Object.assign(new Error('Заявка уже обработана'), { code: 'RESOLVED' });
  }

  db.prepare(`UPDATE payouts SET status = 'cancelled', resolved_at = ? WHERE id = ?`)
    .run(Date.now(), payoutId);
  // Деньги вернулись - вернулось и отыгранное, которым они были открыты.
  db.prepare('UPDATE users SET balance = balance + ?, wager_progress = wager_progress + ? WHERE id = ?')
    .run(row.amount, row.amount, userId);

  return { balance: getUserById(userId).balance };
});

/**
 * Решение администратора по заявке.
 *
 * При отклонении сумма возвращается игроку — она была списана авансом.
 * При выплате остаётся списанной: деньги считаются ушедшими.
 */
export const resolvePayout = db.transaction((adminId, payoutId, status, comment) => {
  const row = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);

  if (!row) throw Object.assign(new Error('Заявка не найдена'), { code: 'NOT_FOUND' });
  if (row.status !== 'pending') {
    throw Object.assign(new Error('Заявка уже обработана'), { code: 'RESOLVED' });
  }
  if (status !== 'rejected') {
    throw Object.assign(new Error('Недопустимый статус'), { code: 'BAD_STATUS' });
  }

  db.prepare(`UPDATE payouts SET status = ?, comment = ?, resolved_at = ?, resolved_by = ?
               WHERE id = ?`)
    .run(status, comment || null, Date.now(), adminId, payoutId);

  db.prepare('UPDATE users SET balance = balance + ?, wager_progress = wager_progress + ? WHERE id = ?')
    .run(row.amount, row.amount, row.user_id);

  db.prepare(`
    INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(adminId, row.user_id, 'payout_rejected', row.amount, comment || null, Date.now());

  return { status, amount: row.amount, userId: row.user_id };
});

/** После перевода в работу возврат средств и отмена заявки запрещены. */
export const startPayout = db.transaction((adminId, payoutId, comment) => {
  const row = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);
  if (!row) throw Object.assign(new Error('Заявка не найдена'), { code: 'NOT_FOUND' });
  if (row.status !== 'pending') throw Object.assign(new Error('Заявка уже обработана'), { code: 'RESOLVED' });
  const now = Date.now();
  db.prepare(`UPDATE payouts SET status='processing', comment=?, processing_at=?, resolved_by=?
              WHERE id=? AND status='pending'`).run(comment || null, now, adminId, payoutId);
  db.prepare(`INSERT INTO admin_log (admin_id,target_id,action,amount,note,created_at)
              VALUES (?,?,'payout_processing',?,?,?)`).run(adminId, row.user_id, row.amount, comment || null, now);
  return { status: 'processing', amount: row.amount, userId: row.user_id };
});

export const completePayout = db.transaction((adminId, payoutId, comment) => {
  const row = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);
  if (!row) throw Object.assign(new Error('Заявка не найдена'), { code: 'NOT_FOUND' });
  if (row.status !== 'processing') throw Object.assign(new Error('Сначала поставьте заявку в работу'), { code: 'BAD_STATUS' });
  const now = Date.now();
  db.prepare(`UPDATE payouts SET status='paid', comment=COALESCE(?,comment), resolved_at=?, resolved_by=?
              WHERE id=? AND status='processing'`).run(comment || null, now, adminId, payoutId);
  db.prepare(`INSERT INTO admin_log (admin_id,target_id,action,amount,note,created_at)
              VALUES (?,?,'payout_paid',?,?,?)`).run(adminId, row.user_id, row.amount, comment || null, now);
  return { status: 'paid', amount: row.amount, userId: row.user_id };
});

export function adminPayouts(status = 'pending', limit = 60) {
  const where = status === 'all' ? '' : 'WHERE p.status = ?';
  const args = status === 'all' ? [limit] : [status, limit];
  return db.prepare(`
    SELECT p.id, p.amount, p.status, p.method, p.phone, p.bank, p.card_number,
           p.crypto_currency, p.crypto_network, p.crypto_address, p.crypto_amount,
           p.crypto_rate,
           p.comment, p.created_at, p.processing_at, p.resolved_at,
           u.id AS user_id, u.tg_id, u.username, u.first_name, u.balance
      FROM payouts p JOIN users u ON u.id = p.user_id
      ${where}
     ORDER BY p.id DESC LIMIT ?
  `).all(...args).map(row => ({ ...row, card_number: row.card_number ? decryptCard(row.card_number) : null }));
}

export function payoutStats() {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0)  AS pendingSum,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 END), 0)       AS pendingCount,
      COALESCE(SUM(CASE WHEN status = 'processing' THEN amount END), 0) AS processingSum,
      COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 END), 0) AS processingCount,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)     AS paidSum,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN amount END), 0) AS rejectedSum
    FROM payouts
  `).get();
}
