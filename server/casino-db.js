/**
 * Казино: игры провайдеров через агрегатор. Деньги и каталог.
 *
 * Третье после db.js и payments.js место, где меняется баланс. Здесь только
 * то, что касается денег и хранения: протокол агрегатора, синхронизация
 * каталога и HTTP лежат в casino.js и app.js.
 *
 * КОПЕЙКИ. Баланс в users.balance - целые рубли, и весь остальной код
 * (кейсы, касса, вывод, панель) так и работает. У провайдеров ставки и
 * выигрыши дробные: 0.20, 3.75. Округлять чужие деньги нельзя, переводить
 * все суммы проекта в копейки ради одного раздела - риск сломать кассу.
 * Поэтому копейки живут рядом: users.balance_kop, от 0 до 99. Полный баланс
 * игрока = balance + balance_kop / 100. Казино считает в копейках целиком и
 * записывает результат обратно в две колонки, остальной код копеек не видит
 * и видеть не обязан: целые рубли у него те же, что были.
 *
 * Ни одна сумма здесь не проходит через дробное число дольше одного
 * преобразования на входе (toKop). Сложение 0.1 + 0.2 в плавающей точке даёт
 * 0.30000000000000004, и через тысячу ставок касса разошлась бы с игроком.
 */
import { db, getUserById, consumeWager, getPlayerLimits } from './db.js';

/* ---------- Схема ---------- */

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

// Копейки к целым рублям users.balance, всегда от 0 до 99.
ensureColumn('users', 'balance_kop', 'INTEGER NOT NULL DEFAULT 0');
/*
 * Остаток оборота в копейках, ещё не переданный в consumeWager. Отыгрыш
 * депозита и бонуса считается в целых рублях; ставки по 0.20 по одной
 * округлялись бы в ноль, и сто таких ставок не погасили бы ни рубля.
 */
ensureColumn('users', 'casino_wager_kop', 'INTEGER NOT NULL DEFAULT 0');
// Обороты казино для профиля и панели. Отдельно от total_spent/total_won:
// те в целых рублях и участвуют в медалях кейсов.
ensureColumn('users', 'casino_bet_kop', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'casino_win_kop', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  /*
   * Каталог хранится у нас, а не запрашивается на каждый заход: игр 6 500, у
   * агрегатора лимит на частоту, а CDN и API отвечают через раз. Обновляет
   * его синхронизация (casino.js) по расписанию.
   */
  CREATE TABLE IF NOT EXISTS casino_providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    source      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    game_count  INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS casino_games (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    provider_id   TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    source        TEXT NOT NULL,
    kind          TEXT NOT NULL,
    img           TEXT,
    img_vertical  TEXT,
    img_wide      TEXT,
    demo          INTEGER NOT NULL DEFAULT 0,
    freespin      INTEGER NOT NULL DEFAULT 0,
    buybonus      INTEGER NOT NULL DEFAULT 0,
    jackpot       INTEGER NOT NULL DEFAULT 0,
    rtp_mode      TEXT NOT NULL DEFAULT 'provider',
    seed_rank     INTEGER NOT NULL DEFAULT 1000000,
    active        INTEGER NOT NULL DEFAULT 1,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS casino_games_kind ON casino_games (kind, active);
  CREATE INDEX IF NOT EXISTS casino_games_provider ON casino_games (provider_id, active);

  /*
   * Каждый денежный вызов агрегатора - строка. dedupe_key = метод + номер
   * операции провайдера (originalTransId): повтор с тем же номером обязан
   * вернуть код 9 и не тронуть баланс. Сценарии проверки партнёра шлют
   * повтор именно с новым transactionId и прежним originalTransId, так что
   * ключ по transactionId такой повтор пропустил бы.
   *
   * Метод входит в ключ, потому что у ставки и её отмены номер провайдера
   * может совпадать, а это разные операции.
   */
  CREATE TABLE IF NOT EXISTS casino_tx (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    method        TEXT NOT NULL,
    dedupe_key    TEXT UNIQUE,
    tx_id         TEXT,
    orig_tx_id    TEXT,
    round_id      TEXT,
    game_id       TEXT,
    provider_id   TEXT,
    amount_kop    INTEGER NOT NULL DEFAULT 0,
    free_round    INTEGER NOT NULL DEFAULT 0,
    rolled_back   INTEGER NOT NULL DEFAULT 0,
    balance_kop   INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS casino_tx_round ON casino_tx (user_id, round_id);
  CREATE INDEX IF NOT EXISTS casino_tx_game ON casino_tx (game_id, created_at);
  CREATE INDEX IF NOT EXISTS casino_tx_user ON casino_tx (user_id, created_at);
`);

/* ---------- Коды ответа агрегатору ---------- */

/*
 * GameProxyResponseStatusCode из документации агрегатора. Девятки в таблице
 * документации нет, но её требуют их же сценарии проверки повторов.
 */
export const CASINO_STATUS = {
  OK: 0,
  USER_NOT_FOUND: 1,
  GENERIC: 2,
  INVALID_REQUEST: 3,
  INVALID_CREDENTIALS: 4,
  BET_NOT_EXIST: 5,
  LOW_BALANCE: 8,
  DUPLICATE: 9,
};

const MESSAGES = {
  0: 'Success', 1: 'User not found', 2: 'Generic error', 3: 'Invalid request',
  4: 'Invalid credentials', 5: 'Bet does not exist', 8: 'Insufficient balance',
  9: 'Duplicated transaction',
};

/* ---------- Деньги в копейках ---------- */

/**
 * Рубли с агрегатора -> целые копейки. Единственное место, где дробное
 * число превращается в деньги.
 *
 * Сначала toFixed до шести знаков, потом округление: у 1.005 * 100 в
 * двоичной записи выходит 100.49999999999999, и голый Math.round отнял бы
 * копейку. Шесть знаков срезают хвост представления, но не настоящие доли.
 */
export function toKop(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(Number((n * 100).toFixed(6)));
}

export const kopToRub = (kop) => kop / 100;

/** Полный баланс игрока в копейках: целые рубли плюс остаток. */
export function userKop(user) {
  return user.balance * 100 + (user.balance_kop || 0);
}

/** Полный баланс в рублях для ответа клиенту: 1234.5 и так далее. */
export function userBalanceRub(user) {
  return kopToRub(userKop(user));
}

/* Пишет полный баланс обратно в две колонки. Ниже нуля не уходит никогда:
   все списания проверены до вызова. */
function writeKop(userId, kop) {
  if (!(kop >= 0)) throw Object.assign(new Error('Баланс ушёл бы в минус'), { status: CASINO_STATUS.GENERIC });
  db.prepare('UPDATE users SET balance = ?, balance_kop = ? WHERE id = ?')
    .run(Math.floor(kop / 100), kop % 100, userId);
}

/**
 * Оборот казино гасит отыгрыш депозита и бонуса тем же consumeWager, что и
 * кейсы, но целыми рублями: копейки копятся в casino_wager_kop, пока не
 * наберётся рубль.
 */
function addWager(userId, kop) {
  if (!(kop > 0)) return;
  const pending = (getUserById(userId).casino_wager_kop || 0) + kop;
  const rub = Math.floor(pending / 100);
  db.prepare('UPDATE users SET casino_wager_kop = ?, casino_bet_kop = casino_bet_kop + ? WHERE id = ?')
    .run(pending % 100, kop, userId);
  if (rub > 0) consumeWager(userId, rub);
}

/* ---------- Игрок ---------- */

/*
 * Наш идентификатор игрока у агрегатора. Не tg_id: его незачем отдавать
 * третьей стороне. Префикс отличает наших игроков от тестовых в их кабинете
 * и не даёт перепутать номер с чем-то ещё. Лимит агрегатора - 20 символов.
 */
export const casinoPlayerId = (userId) => `lb${userId}`;

export function userFromCasinoId(value) {
  const m = /^lb(\d{1,17})$/.exec(String(value || ''));
  return m ? getUserById(Number(m[1])) : null;
}

/** Самоисключение запрещает ставки в казино так же, как запрещает их в
 * кейсах: выигрыш по уже сделанной ставке при этом начисляется. */
export function casinoExcluded(userId) {
  const limits = getPlayerLimits(userId);
  return (limits?.excluded_until || 0) > Date.now();
}

/* ---------- Кошелёк: один вызов агрегатора ---------- */

const insertTx = db.prepare(`
  INSERT INTO casino_tx (user_id, method, dedupe_key, tx_id, orig_tx_id, round_id,
                         game_id, provider_id, amount_kop, free_round, balance_kop, created_at)
  VALUES (@user_id, @method, @dedupe_key, @tx_id, @orig_tx_id, @round_id,
          @game_id, @provider_id, @amount_kop, @free_round, @balance_kop, @created_at)
`);

const fail = (status, extra = {}) => Object.assign(new Error(MESSAGES[status] || 'error'), { status, ...extra });

function dedupeKey(method, req) {
  const id = req.originalTransId || req.transactionId;
  return id ? `${method}:${id}` : null;
}

function roundBets(userId, roundId) {
  if (!roundId) return [];
  return db.prepare(`SELECT * FROM casino_tx
                      WHERE user_id = ? AND round_id = ? AND method = 'bet' AND rolled_back = 0`)
    .all(userId, roundId);
}

/**
 * Операции, на которые указывает отмена.
 *
 * Если агрегатор перечислил операции в transactions[], отменяются ровно они
 * (по нашему tx_id или по номеру провайдера). Иначе отменяется весь раунд:
 * все неотменённые ставки, выигрыши и досрочные закрытия с тем же roundId.
 */
function rollbackTargets(userId, req) {
  const ids = (Array.isArray(req.transactions) ? req.transactions : [])
    .map((t) => t?.transactionId).filter(Boolean);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM casino_tx
                        WHERE user_id = ? AND rolled_back = 0 AND method IN ('bet','win','cashout')
                          AND (tx_id IN (${marks}) OR orig_tx_id IN (${marks}))`)
      .all(userId, ...ids, ...ids);
  }
  if (!req.roundId) return [];
  return db.prepare(`SELECT * FROM casino_tx
                      WHERE user_id = ? AND round_id = ? AND rolled_back = 0
                        AND method IN ('bet','win','cashout')`)
    .all(userId, req.roundId);
}

/**
 * Применяет пакет вызовов агрегатора.
 *
 * Агрегатор шлёт массив: обычно из одного вызова, но бывает «ставка и
 * выигрыш одним пакетом». Пакет проходит целиком или не проходит вовсе -
 * это прямо требуют их сценарии: ставка больше баланса в паре с выигрышем
 * обязана вернуть 8, а не списать и тут же начислить. Поэтому всё в одной
 * транзакции, и любой отказ откатывает весь пакет.
 *
 * Возвращает { statusCode, balance } для ответа. Бросает только на
 * непредвиденном; ожидаемые отказы приходят кодом.
 */
export function casinoWallet(requests, { currency = 'RUB' } = {}) {
  const list = Array.isArray(requests) ? requests : [requests];
  if (!list.length || list.some((r) => !r || typeof r !== 'object')) {
    return { statusCode: CASINO_STATUS.INVALID_REQUEST };
  }

  // Все вызовы пакета - про одного игрока. Чужой userId посреди пакета -
  // ошибка агрегатора, а не повод начислить кому-то второму.
  const user = userFromCasinoId(list[0].userId);
  if (!user) return { statusCode: CASINO_STATUS.USER_NOT_FOUND };
  if (list.some((r) => String(r.userId) !== String(list[0].userId))) {
    return { statusCode: CASINO_STATUS.INVALID_REQUEST, balance: userBalanceRub(user) };
  }

  try {
    const balance = applyBatch(user.id, list, currency);
    return { statusCode: CASINO_STATUS.OK, balance };
  } catch (err) {
    if (err.status === undefined) throw err;
    // Баланс в отказе - текущий, после отката: этого требует документация
    // для нехватки средств, и для остальных отказов он тоже правдив.
    return { statusCode: err.status, balance: userBalanceRub(getUserById(user.id)) };
  }
}

const applyBatch = db.transaction((userId, list, currency) => {
  const now = Date.now();

  for (const req of list) {
    const method = String(req.method || '');
    if (method === 'get_balance') continue;

    if (!['bet', 'win', 'rollback', 'cashout'].includes(method)) throw fail(CASINO_STATUS.INVALID_REQUEST);
    if (req.currency && String(req.currency).toUpperCase() !== currency) throw fail(CASINO_STATUS.INVALID_REQUEST);

    const key = dedupeKey(method, req);
    if (key && db.prepare('SELECT 1 FROM casino_tx WHERE dedupe_key = ?').get(key)) {
      throw fail(CASINO_STATUS.DUPLICATE);
    }

    const free = req.isFreeRound === true || req.additionalData?.freeRoundPlay === true;
    let amount = toKop(req.amount ?? 0);
    if (Number.isNaN(amount)) throw fail(CASINO_STATUS.INVALID_REQUEST);

    const user = getUserById(userId);
    let kop = userKop(user);
    const row = {
      user_id: userId, method, dedupe_key: key,
      tx_id: req.transactionId ? String(req.transactionId) : null,
      orig_tx_id: req.originalTransId ? String(req.originalTransId) : null,
      round_id: req.roundId ? String(req.roundId) : null,
      game_id: req.gameId ? String(req.gameId) : null,
      provider_id: req.providerId ? String(req.providerId) : null,
      amount_kop: amount, free_round: free ? 1 : 0, balance_kop: 0, created_at: now,
    };

    if (method === 'bet') {
      // Самоисключение закрывает новые ставки, но не трогает расчёт старых.
      if (casinoExcluded(userId) || user.is_blocked) throw fail(CASINO_STATUS.GENERIC);
      // Ставка фриспина оплачена пакетом фриспинов, а не игроком: деньги с
      // баланса не уходят, строка нужна, чтобы выигрыш нашёл свою ставку.
      const debit = free ? 0 : amount;
      if (debit > kop) throw fail(CASINO_STATUS.LOW_BALANCE);
      kop -= debit;
      writeKop(userId, kop);
      addWager(userId, debit);
    } else if (method === 'win' || method === 'cashout') {
      // Выигрыш без ставки - ошибка агрегатора или подделка. Начислять его
      // нельзя: сценарии партнёра проверяют ровно это.
      if (!roundBets(userId, req.roundId).length) throw fail(CASINO_STATUS.BET_NOT_EXIST);
      kop += amount;
      writeKop(userId, kop);
      if (amount > 0) {
        db.prepare('UPDATE users SET casino_win_kop = casino_win_kop + ? WHERE id = ?').run(amount, userId);
      }
    } else if (method === 'rollback') {
      const targets = rollbackTargets(userId, req);
      // Отменять нечего - ошибка, а не тихий успех: так требуют сценарии партнёра.
      if (!targets.length) throw fail(CASINO_STATUS.BET_NOT_EXIST);
      /*
       * Отмена возвращает раунд в исходное: ставки назад, выигрыши обратно.
       * Если выигрыш уже потрачен, забираем сколько есть, а не уводим баланс
       * в минус: недостачу видно в панели по разнице в строке отмены.
       */
      let net = 0;
      for (const t of targets) {
        const paid = t.method === 'bet' ? (t.free_round ? 0 : t.amount_kop) : -t.amount_kop;
        net += paid;
      }
      kop = Math.max(0, kop + net);
      amount = net;
      writeKop(userId, kop);
      const marks = targets.map(() => '?').join(',');
      db.prepare(`UPDATE casino_tx SET rolled_back = 1 WHERE id IN (${marks})`).run(...targets.map((t) => t.id));
      row.amount_kop = net;
    }

    row.balance_kop = kop;
    insertTx.run(row);
  }

  return userBalanceRub(getUserById(userId));
});

/* ---------- Каталог ---------- */

/**
 * Записывает каталог целиком. Игры, пропавшие у агрегатора, не удаляются, а
 * гасятся: по ним остаётся история операций, и ссылка из неё не должна
 * вести в пустоту.
 */
export const saveCatalog = db.transaction((providers, games) => {
  const now = Date.now();
  db.prepare('UPDATE casino_providers SET active = 0').run();
  db.prepare('UPDATE casino_games SET active = 0').run();

  const putProvider = db.prepare(`
    INSERT INTO casino_providers (id, name, source, kind, game_count, sort, active, updated_at)
    VALUES (@id, @name, @source, @kind, @game_count, @sort, 1, @updated_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, source=excluded.source, kind=excluded.kind,
      game_count=excluded.game_count, sort=excluded.sort, active=1, updated_at=excluded.updated_at
  `);
  for (const p of providers) putProvider.run({ ...p, updated_at: now });

  const putGame = db.prepare(`
    INSERT INTO casino_games (id, name, provider_id, provider_name, source, kind, img, img_vertical,
                              img_wide, demo, freespin, buybonus, jackpot, rtp_mode, seed_rank,
                              active, updated_at)
    VALUES (@id, @name, @provider_id, @provider_name, @source, @kind, @img, @img_vertical,
            @img_wide, @demo, @freespin, @buybonus, @jackpot, @rtp_mode, @seed_rank, 1, @updated_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider_id=excluded.provider_id,
      provider_name=excluded.provider_name, source=excluded.source, kind=excluded.kind,
      img=excluded.img, img_vertical=excluded.img_vertical, img_wide=excluded.img_wide,
      demo=excluded.demo, freespin=excluded.freespin, buybonus=excluded.buybonus,
      jackpot=excluded.jackpot, rtp_mode=excluded.rtp_mode, seed_rank=excluded.seed_rank,
      active=1, updated_at=excluded.updated_at
  `);
  for (const g of games) putGame.run({ ...g, updated_at: now });
});

export function catalogStats() {
  return {
    games: db.prepare('SELECT COUNT(*) AS n FROM casino_games WHERE active = 1').get().n,
    providers: db.prepare('SELECT COUNT(*) AS n FROM casino_providers WHERE active = 1').get().n,
    updatedAt: db.prepare('SELECT MAX(updated_at) AS t FROM casino_games WHERE active = 1').get().t || 0,
  };
}

/*
 * Окно популярности. Неделя, а не всё время: иначе игра, которую крутили на
 * запуске, навсегда стоит первой, даже когда в неё уже никто не заходит.
 */
const POPULAR_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * Страница игр лобби.
 *
 * «Популярные» - сначала по числу наших ставок за неделю, потом по
 * стартовому порядку хитов (seed_rank). Пока ставок нет, порядок целиком
 * задаёт стартовый список, а по мере игры его сменяет настоящий спрос.
 */
export function casinoGames({ kind = '', provider = '', q = '', sort = 'popular', offset = 0, limit = 48 } = {}) {
  const where = ['g.active = 1'];
  const args = { since: Date.now() - POPULAR_WINDOW_MS };
  if (kind) { where.push('g.kind = @kind'); args.kind = kind; }
  if (provider) { where.push('g.provider_id = @provider'); args.provider = provider; }
  if (q) { where.push('g.name LIKE @q ESCAPE \'\\\''); args.q = `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`; }

  const order = sort === 'az' ? 'g.name COLLATE NOCASE ASC'
    : sort === 'new' ? 'g.updated_at DESC, g.seed_rank ASC'
    : 'heat DESC, g.seed_rank ASC, g.name COLLATE NOCASE ASC';

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM casino_games g WHERE ${whereSql}`).get(args).n;
  const rows = db.prepare(`
    SELECT g.*, COALESCE(h.n, 0) AS heat
      FROM casino_games g
      LEFT JOIN (SELECT game_id, COUNT(*) AS n FROM casino_tx
                  WHERE method = 'bet' AND created_at >= @since GROUP BY game_id) h
        ON h.game_id = g.id
     WHERE ${whereSql}
     ORDER BY ${order}
     LIMIT @limit OFFSET @offset
  `).all({ ...args, limit: Math.min(Math.max(1, limit), 120), offset: Math.max(0, offset) });
  return { total, rows };
}

export function casinoGame(id) {
  return db.prepare('SELECT * FROM casino_games WHERE id = ? AND active = 1').get(String(id || ''));
}

export function casinoProviders() {
  return db.prepare(`SELECT * FROM casino_providers WHERE active = 1 AND game_count > 0
                      ORDER BY sort ASC, game_count DESC`).all();
}

/** Операции игрока для истории и панели, свежие первыми. */
export function casinoHistory(userId, limit = 50) {
  return db.prepare(`SELECT t.*, g.name AS game_name FROM casino_tx t
                       LEFT JOIN casino_games g ON g.id = t.game_id
                      WHERE t.user_id = ? ORDER BY t.id DESC LIMIT ?`).all(userId, limit);
}

/** Сводка для панели: оборот, выплаты и доход кассы за период. */
export function casinoSummary(sinceMs = 0) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN method = 'bet' AND free_round = 0 AND rolled_back = 0 THEN amount_kop END), 0) AS bets,
           COALESCE(SUM(CASE WHEN method IN ('win','cashout') AND rolled_back = 0 THEN amount_kop END), 0) AS wins,
           COUNT(DISTINCT user_id) AS players,
           COUNT(CASE WHEN method = 'bet' THEN 1 END) AS rounds
      FROM casino_tx WHERE created_at >= ?`).get(sinceMs);
  return {
    bets: kopToRub(row.bets), wins: kopToRub(row.wins), ggr: kopToRub(row.bets - row.wins),
    players: row.players, rounds: row.rounds,
  };
}

