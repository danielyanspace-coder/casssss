/**
 * Партнёрская программа: кабинет /partners.
 *
 * Партнёр - это аккаунт сайта с записью в partners. Он заводит промокоды
 * (кейс «Начало» плюс процент к первому пополнению), игрок, зарегистрированный
 * по коду, привязывается к нему навсегда (redeemPromo в db.js), и партнёр
 * получает долю дохода с этих игроков. Выводит он её в USDT заявкой, которую
 * обрабатывает человек.
 *
 * ДОХОД (NGR) по игроку считается из тех же таблиц, что и всё остальное:
 *   ставки своими деньгами минус выигрыши своими деньгами (rounds и casino_tx),
 *   минус бонусы, перешедшие в деньги (bonus_events 'convert'),
 *   минус корректировки админа в пользу игрока (deposits 'correction'),
 *   минус издержки, заданные в панели: доля агрегатора с дохода казино и
 *   комиссия приёма с пополнений.
 * Ставка бонусом и выигрыш на бонусный счёт доходом не являются: игрок играл
 * на подаренные деньги, и доля с них была бы долей с прибыли, которой нет.
 *
 * НАЧИСЛЕНИЕ по дням (сутки по Москве) с переносом минуса: минусовой день
 * копится и гасится следующими плюсовыми, доля идёт только с того, что
 * осталось сверх. Иначе схема «привёл себя, крупно выиграл, забрал долю»
 * окупалась бы. Начисленное назад не отнимается: что партнёр уже получил,
 * то его, даже если реферал потом выиграл (это и есть перенос минуса вперёд,
 * а не назад - обычная практика партнёрских программ).
 *
 * ДОЛИ живут в partner_shares, строкой на пару «кто получает - с чьих
 * рефералов» и с периодом действия. Своя доля партнёра - строка, где
 * получатель и источник совпадают. Выгодополучатель сверху (сетка, как в
 * сетевом маркетинге) - строка, где источник чужой: «Б получает 10% дохода
 * рефералов А», и это не из доли А, а сверху. Смена процента закрывает
 * строку и открывает новую: новый процент действует со дня смены, и прошлые
 * начисления не пересчитываются ни вверх, ни вниз.
 *
 * Хранятся только доли и выплаты, начисления считаются запросом: колонка
 * начислений рано или поздно разошлась бы с фактической игрой, а запрос
 * разойтись не может.
 *
 * К ВЫВОДУ доступны только закрытые сутки: сегодняшний доход ещё меняется,
 * и выплаченное утром могло бы к вечеру оказаться не заработанным.
 */

import { db, setting, logAdmin, getUserById, createEmailUser, normalizePromoCode, bonusRules } from './db.js';
import { START_CASE_ID } from './cases.js';
// Таблица casino_tx заводится там: доход партнёра считает и казино.
import './casino-db.js';

export const DAY_MS = 86_400_000;
/* Сутки отчётов - московские (UTC+3, без перехода на летнее время). */
export const TZ_OFFSET_MS = 3 * 3600_000;
/* Сколько всего можно раздать с рефералов одного источника, %. Остаток -
   минимальная доля заведения: без него сетка из трёх получателей по 40%
   платила бы больше, чем приносит трафик. */
export const SHARE_TOTAL_MAX = 90;
/* Реальные пополнения. 'admin' и 'correction' - руки сотрудника, а не касса. */
const DEPOSIT_SOURCES = "('sicilia', 'crypto')";
export const PROMO_CODE_RE = /^[A-Z0-9_-]{4,20}$/;
/* Адреса USDT: TRC20 (Tron) и ERC20/BEP20 (0x). Другие сети не принимаем:
   отправленное не в ту сеть не вернуть. */
export const NETWORKS = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ERC20: /^0x[0-9a-fA-F]{40}$/,
  BEP20: /^0x[0-9a-fA-F]{40}$/,
};

/* ============================================================
   СХЕМА
   ============================================================ */

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
function addColumn(table, name, ddl) {
  if (!columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS partner_shares (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    beneficiary_id INTEGER NOT NULL REFERENCES partners(id),
    source_id      INTEGER NOT NULL REFERENCES partners(id),
    pct            REAL    NOT NULL,
    from_at        INTEGER NOT NULL,
    to_at          INTEGER,
    set_by         INTEGER,
    note           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pshares_source ON partner_shares(source_id);
  CREATE INDEX IF NOT EXISTS idx_pshares_benef ON partner_shares(beneficiary_id);
  CREATE INDEX IF NOT EXISTS idx_users_partner ON users(partner_id);
`);
addColumn('partners', 'status', "TEXT NOT NULL DEFAULT 'active'");
addColumn('partners', 'contact', 'TEXT');
addColumn('partners', 'joined_via', "TEXT NOT NULL DEFAULT 'admin'");
/*
 * Выплаты партнёру: старые строки (кнопка «Выплатить» прежней панели) -
 * сразу выплаченные. Заявка из кабинета приходит 'pending' и становится
 * 'paid' или 'rejected' руками сотрудника.
 */
addColumn('partner_payouts', 'status', "TEXT NOT NULL DEFAULT 'paid'");
addColumn('partner_payouts', 'network', 'TEXT');
addColumn('partner_payouts', 'address', 'TEXT');
addColumn('partner_payouts', 'rate', 'REAL');
addColumn('partner_payouts', 'usdt', 'TEXT');
addColumn('partner_payouts', 'txid', 'TEXT');
addColumn('partner_payouts', 'resolved_at', 'INTEGER');
addColumn('partner_payouts', 'resolved_by', 'INTEGER');
addColumn('partner_payouts', 'reason', 'TEXT');

/*
 * Своя доля партнёра правится и в прежней панели (partners.share_pct). Чтобы
 * у доли была история, расхождение превращается в новую строку: старая
 * закрывается сейчас. Первая строка действует «с начала»: доходы до
 * появления таблицы считаются по той доле, что стояла.
 */
function syncOwnShares(now = Date.now()) {
  const rows = db.prepare(`
    SELECT p.id, p.share_pct, p.created_at, s.id AS sid, s.pct
      FROM partners p
      LEFT JOIN partner_shares s ON s.beneficiary_id = p.id AND s.source_id = p.id AND s.to_at IS NULL
  `).all();
  for (const r of rows) {
    if (r.sid == null) {
      const had = db.prepare('SELECT 1 FROM partner_shares WHERE beneficiary_id = ? AND source_id = ?').get(r.id, r.id);
      db.prepare(`INSERT INTO partner_shares (beneficiary_id, source_id, pct, from_at)
                  VALUES (?, ?, ?, ?)`).run(r.id, r.id, r.share_pct, had ? now : 0);
    } else if (Number(r.pct) !== Number(r.share_pct)) {
      db.prepare('UPDATE partner_shares SET to_at = ? WHERE id = ?').run(now, r.sid);
      db.prepare(`INSERT INTO partner_shares (beneficiary_id, source_id, pct, from_at)
                  VALUES (?, ?, ?, ?)`).run(r.id, r.id, r.share_pct, now);
    }
  }
}

/* ============================================================
   ДОХОД ПО ДНЯМ
   ============================================================ */

export const dayOf = (ts) => Math.floor((Number(ts) + TZ_OFFSET_MS) / DAY_MS);
export const dayStart = (day) => day * DAY_MS - TZ_OFFSET_MS;
export const dayLabel = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

const DAY_SQL = (col) => `CAST((${col} + ${TZ_OFFSET_MS}) / ${DAY_MS} AS INTEGER)`;

function blank() {
  return {
    stakeKop: 0, winKop: 0, casinoStakeKop: 0, casinoWinKop: 0, bonusKop: 0, correctionKop: 0,
    deposits: 0, depositsCount: 0, ftd: 0, signups: 0, payouts: 0,
  };
}

/** Доход дня в копейках с издержками из панели. */
function ngrOf(d, costs) {
  const ours = d.stakeKop - d.winKop;
  const casino = d.casinoStakeKop - d.casinoWinKop;
  const casinoCost = Math.round(casino * costs.casino / 100);
  const depositCost = Math.round(d.deposits * 100 * costs.deposit / 100);
  return ours + casino - casinoCost - d.bonusKop - d.correctionKop - depositCost;
}

function costsNow() {
  return {
    casino: Math.max(0, Number(setting('partner_casino_cost_pct')) || 0),
    deposit: Math.max(0, Number(setting('partner_deposit_cost_pct')) || 0),
  };
}

/**
 * Посуточная сводка по партнёрам: Map pid -> Map day -> день.
 * userWhere - дополнительное условие на игрока (u.*), например промокод.
 */
function dailyByPartner({ pids = null, userWhere = '', params = {} } = {}) {
  const filter = pids ? `AND u.partner_id IN (${pids.map(Number).join(',') || 'NULL'})` : '';
  const scope = `u.partner_id IS NOT NULL ${filter} ${userWhere}`;
  const out = new Map();
  const at = (pid, day) => {
    if (!out.has(pid)) out.set(pid, new Map());
    const m = out.get(pid);
    if (!m.has(day)) m.set(day, blank());
    return m.get(day);
  };
  const run = (sql, apply) => {
    for (const r of db.prepare(sql).all(params)) apply(at(r.pid, r.day), r);
  };
  run(`SELECT u.partner_id AS pid, ${DAY_SQL('r.created_at')} AS day,
              SUM(r.bet - r.bonus_bet) AS stake, SUM(r.payout - r.bonus_payout) AS win
         FROM rounds r JOIN users u ON u.id = r.user_id
        WHERE ${scope} GROUP BY pid, day`,
  (d, r) => { d.stakeKop += r.stake * 100; d.winKop += r.win * 100; });
  run(`SELECT u.partner_id AS pid, ${DAY_SQL('t.created_at')} AS day,
              SUM(CASE WHEN t.method = 'bet' AND t.free_round = 0 THEN t.amount_kop ELSE 0 END) AS stake,
              SUM(CASE WHEN t.method IN ('win', 'cashout') THEN t.amount_kop ELSE 0 END) AS win
         FROM casino_tx t JOIN users u ON u.id = t.user_id
        WHERE t.rolled_back = 0 AND ${scope} GROUP BY pid, day`,
  (d, r) => { d.casinoStakeKop += r.stake; d.casinoWinKop += r.win; });
  run(`SELECT u.partner_id AS pid, ${DAY_SQL('e.created_at')} AS day, SUM(e.amount) AS amount
         FROM bonus_events e JOIN users u ON u.id = e.user_id
        WHERE e.kind = 'convert' AND ${scope} GROUP BY pid, day`,
  (d, r) => { d.bonusKop += r.amount * 100; });
  run(`SELECT u.partner_id AS pid, ${DAY_SQL('x.created_at')} AS day,
              SUM(CASE WHEN x.source IN ${DEPOSIT_SOURCES} THEN x.amount ELSE 0 END) AS dep,
              SUM(CASE WHEN x.source IN ${DEPOSIT_SOURCES} THEN 1 ELSE 0 END) AS cnt,
              SUM(CASE WHEN x.source = 'correction' THEN x.amount ELSE 0 END) AS corr
         FROM deposits x JOIN users u ON u.id = x.user_id
        WHERE ${scope} GROUP BY pid, day`,
  (d, r) => { d.deposits += r.dep; d.depositsCount += r.cnt; d.correctionKop += r.corr * 100; });
  run(`SELECT pid, ${DAY_SQL('first')} AS day, COUNT(*) AS n FROM (
         SELECT u.partner_id AS pid, MIN(x.created_at) AS first
           FROM deposits x JOIN users u ON u.id = x.user_id
          WHERE x.source IN ${DEPOSIT_SOURCES} AND ${scope} GROUP BY u.id)
        GROUP BY pid, day`,
  (d, r) => { d.ftd += r.n; });
  run(`SELECT u.partner_id AS pid, ${DAY_SQL('u.created_at')} AS day, COUNT(*) AS n
         FROM users u WHERE ${scope} GROUP BY pid, day`,
  (d, r) => { d.signups += r.n; });
  run(`SELECT u.partner_id AS pid, ${DAY_SQL('p.resolved_at')} AS day, SUM(p.amount) AS amount
         FROM payouts p JOIN users u ON u.id = p.user_id
        WHERE p.status = 'paid' AND p.resolved_at IS NOT NULL AND ${scope} GROUP BY pid, day`,
  (d, r) => { d.payouts += r.amount; });
  return out;
}

/**
 * Перенос минуса: из ряда дохода по дням - то, с чего платится доля.
 * Возвращает Map day -> копейки (только дни с начислением) и текущий
 * непогашенный минус.
 */
export function carryForward(days) {
  const sorted = [...days].sort((a, b) => a[0] - b[0]);
  const base = new Map();
  let carry = 0;
  for (const [day, ngr] of sorted) {
    const x = carry + ngr;
    if (x > 0) { base.set(day, x); carry = 0; } else carry = x;
  }
  return { base, carry };
}

/* ============================================================
   ДОЛИ И НАЧИСЛЕНИЯ
   ============================================================ */

function shareRows() {
  return db.prepare('SELECT * FROM partner_shares ORDER BY from_at').all();
}

/* Процент строки на конец суток day: смена посреди дня действует с этого дня. */
function pctOn(rows, day) {
  const end = dayStart(day + 1);
  const row = rows.filter((r) => r.from_at < end && (r.to_at == null || r.to_at >= end)).pop();
  return row ? Number(row.pct) : 0;
}

/**
 * Полный расчёт программы на момент now. Один проход на всех: запрос по
 * дням общий, а партнёров немного. Возвращает по партнёру:
 *   days     Map day -> день его рефералов (с ngrKop и baseKop),
 *   accrual  Map day -> начислено ему в этот день (своё и сетка),
 *   bySource источник -> { pct, kop } - откуда пришли деньги,
 *   carry    непогашенный минус его рефералов.
 */
export function computeProgram(now = Date.now()) {
  syncOwnShares(now);
  const costs = costsNow();
  const daily = dailyByPartner();
  const shares = shareRows();
  const today = dayOf(now);
  const res = new Map();
  const entry = (pid) => {
    if (!res.has(pid)) res.set(pid, { days: new Map(), accrual: new Map(), bySource: new Map(), carry: 0 });
    return res.get(pid);
  };
  for (const p of db.prepare('SELECT id FROM partners').all()) entry(p.id);

  for (const [sourceId, days] of daily) {
    const src = entry(sourceId);
    const ngr = [];
    for (const [day, d] of days) {
      d.ngrKop = ngrOf(d, costs);
      src.days.set(day, d);
      ngr.push([day, d.ngrKop]);
    }
    const { base, carry } = carryForward(ngr);
    src.carry = carry;
    for (const [day, kop] of base) src.days.get(day).baseKop = kop;

    const bySource = new Map();
    for (const r of shares.filter((s) => s.source_id === sourceId)) {
      if (!bySource.has(r.beneficiary_id)) bySource.set(r.beneficiary_id, []);
      bySource.get(r.beneficiary_id).push(r);
    }
    for (const [benefId, rows] of bySource) {
      const b = entry(benefId);
      for (const [day, kop] of base) {
        const pct = pctOn(rows, day);
        if (!(pct > 0)) continue;
        const part = Math.floor(kop * pct / 100);
        b.accrual.set(day, (b.accrual.get(day) || 0) + part);
        const s = b.bySource.get(sourceId) || { kop: 0, todayKop: 0 };
        s.kop += part;
        if (day === today) s.todayKop += part;
        b.bySource.set(sourceId, s);
      }
    }
  }
  return { res, today, shares, costs };
}

/** Деньги партнёра: начислено, доступно, выплачено, в заявке. В рублях. */
export function balanceOf(pid, program = computeProgram()) {
  const e = program.res.get(pid) || { accrual: new Map() };
  let total = 0;
  let closed = 0;
  for (const [day, kop] of e.accrual) {
    total += kop;
    if (day < program.today) closed += kop;
  }
  const pay = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending
    FROM partner_payouts WHERE partner_id = ?`).get(pid);
  return {
    accrued: Math.floor(total / 100),
    accruedClosed: Math.floor(closed / 100),
    today: Math.floor((total - closed) / 100),
    paid: pay.paid,
    pending: pay.pending,
    available: Math.max(0, Math.floor(closed / 100) - pay.paid - pay.pending),
  };
}

/* ============================================================
   ПАРТНЁР: ЗАВЕДЕНИЕ
   ============================================================ */

const fail = (message, code = 'BAD') => Object.assign(new Error(message), { code });

export function partnerOfUser(userId) {
  return db.prepare('SELECT * FROM partners WHERE user_id = ?').get(userId) || null;
}

export function partnerById(id) {
  return db.prepare(`SELECT p.*, u.email, u.first_name AS nick FROM partners p
                       LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(Number(id)) || null;
}

const cleanName = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const cleanContact = (v) => String(v || '').trim().slice(0, 80);

function insertPartner(userId, { name, contact, via }) {
  const share = Math.min(SHARE_TOTAL_MAX, Math.max(0, Number(setting('partner_default_share')) || 0));
  const now = Date.now();
  const user = getUserById(userId);
  const info = db.prepare(`INSERT INTO partners (tg_id, user_id, name, share_pct, is_active, status, contact,
                                                 joined_via, created_at)
                           VALUES (?, ?, ?, ?, 1, 'active', ?, ?, ?)`)
    .run(user?.tg_id == null ? null : String(user.tg_id), userId, cleanName(name) || null, share,
         cleanContact(contact) || null, via, now);
  // Первая своя доля действует «с начала»: рефералов раньше партнёра не
  // бывает, а сутки, в которые он завёлся, должны считаться по ней целиком.
  db.prepare(`INSERT INTO partner_shares (beneficiary_id, source_id, pct, from_at)
              VALUES (?, ?, ?, 0)`).run(info.lastInsertRowid, info.lastInsertRowid, share);
  return partnerById(info.lastInsertRowid);
}

/** Регистрация в кабинете: новый аккаунт и партнёр одной транзакцией. */
export const registerPartner = db.transaction(({ email, passwordHash, name, contact }) => {
  if (!setting('partner_signup_open')) throw fail('Регистрация партнёров сейчас закрыта', 'CLOSED');
  if (!cleanName(name)) throw fail('Укажите имя или название');
  const user = createEmailUser({ email, passwordHash, nick: cleanName(name).slice(0, 24) });
  return { user, partner: insertPartner(user.id, { name, contact, via: 'self' }) };
});

/** Уже есть аккаунт на сайте - партнёром становятся одной кнопкой. */
export const joinAsPartner = db.transaction((userId, { name, contact } = {}) => {
  if (!setting('partner_signup_open')) throw fail('Регистрация партнёров сейчас закрыта', 'CLOSED');
  const existing = partnerOfUser(userId);
  if (existing) return existing;
  const user = getUserById(userId);
  // Привязанный игрок становится партнёром, но собственная привязка остаётся
  // за тем, кто его привёл: иначе вступление в партнёры переманивало бы.
  return insertPartner(userId, { name: cleanName(name) || user?.first_name || user?.email, contact, via: 'self' });
});

export function updateProfile(pid, { name, contact }) {
  if (!cleanName(name)) throw fail('Укажите имя или название');
  db.prepare('UPDATE partners SET name = ?, contact = ? WHERE id = ?').run(cleanName(name), cleanContact(contact) || null, pid);
  return partnerById(pid);
}

/* ============================================================
   ПРОМОКОДЫ ПАРТНЁРА
   ============================================================ */

/**
 * Код партнёра - промокод типа partner: кейс «Начало» и процент к первому
 * пополнению. Параметры берутся из панели в момент заведения и дальше живут
 * в самом коде: смена умолчаний не меняет то, что партнёр уже обещал
 * своей аудитории.
 */
export const createPromo = db.transaction((pid, rawCode) => {
  const p = partnerById(pid);
  if (!p || p.status !== 'active') throw fail('Кабинет приостановлен', 'BLOCKED');
  const code = normalizePromoCode(rawCode);
  if (!PROMO_CODE_RE.test(code)) throw fail('Код: от 4 до 20 символов, латиница, цифры, _ и -');
  const max = Number(setting('partner_codes_max')) || 0;
  const have = db.prepare('SELECT COUNT(*) AS n FROM promocodes WHERE partner_id = ?').get(pid).n;
  if (max > 0 && have >= max) throw fail(`Не больше ${max} промокодов`);
  if (db.prepare('SELECT 1 FROM promocodes WHERE code = ?').get(code)) throw fail('Такой код уже занят', 'TAKEN');
  const pct = Math.max(1, Number(setting('partner_promo_pct')) || 0);
  const info = db.prepare(`
    INSERT INTO promocodes (code, type, amount, pct, max_bonus, min_deposit, case_id, case_count,
                            wager_multiplier, max_uses, per_user_limit, new_players_only,
                            partner_id, is_active, note, created_at)
    VALUES (?, 'partner', 0, ?, ?, ?, ?, 1, ?, 0, 1, 1, ?, 1, ?, ?)
  `).run(code, pct, Math.max(0, Number(setting('partner_promo_max')) || 0),
         Math.max(0, Number(setting('partner_promo_min_deposit')) || 0), START_CASE_ID,
         bonusRules().wager, pid, 'Код партнёра', Date.now());
  return { id: info.lastInsertRowid, code };
});

export function setPromoActive(pid, promoId, active) {
  const p = partnerById(pid);
  const row = db.prepare('SELECT * FROM promocodes WHERE id = ? AND partner_id = ?').get(Number(promoId), pid);
  if (!row) throw fail('Промокод не найден', 'NOT_FOUND');
  if (active && p?.status !== 'active') throw fail('Кабинет приостановлен', 'BLOCKED');
  db.prepare('UPDATE promocodes SET is_active = ? WHERE id = ?').run(active ? 1 : 0, row.id);
  return { ok: true };
}

/** Коды партнёра со статистикой по каждому. */
function promoStats(pid, program) {
  const codes = db.prepare('SELECT * FROM promocodes WHERE partner_id = ? ORDER BY id DESC').all(pid);
  const costs = program.costs;
  return codes.map((c) => {
    const daily = dailyByPartner({
      pids: [pid],
      userWhere: 'AND u.id IN (SELECT user_id FROM promo_redemptions WHERE promo_id = @promo)',
      params: { promo: c.id },
    }).get(pid) || new Map();
    let deposits = 0; let ftd = 0; let ngr = 0; let depositsCount = 0;
    for (const d of daily.values()) {
      deposits += d.deposits; ftd += d.ftd; depositsCount += d.depositsCount; ngr += ngrOf(d, costs);
    }
    return {
      id: c.id, code: c.code, active: !!c.is_active, type: c.type, createdAt: c.created_at,
      pct: c.pct, maxBonus: c.max_bonus, minDeposit: c.min_deposit,
      activations: c.used_count, ftd, deposits, depositsCount, ngr: Math.round(ngr / 100),
    };
  });
}

/* ============================================================
   КАБИНЕТ ПАРТНЁРА
   ============================================================ */

function sumDays(days, fromDay = -Infinity) {
  const t = { ...blank(), ngrKop: 0, baseKop: 0 };
  for (const [day, d] of days) {
    if (day < fromDay) continue;
    for (const k of Object.keys(blank())) t[k] += d[k];
    t.ngrKop += d.ngrKop || 0;
    t.baseKop += d.baseKop || 0;
  }
  return t;
}

const kpiOf = (t) => ({
  signups: t.signups, ftd: t.ftd, deposits: t.deposits, depositsCount: t.depositsCount,
  payouts: t.payouts, ngr: Math.round(t.ngrKop / 100),
  turnover: Math.round((t.stakeKop + t.casinoStakeKop) / 100),
});

/**
 * Всё, что видит партнёр. Персональных данных рефералов здесь нет: номер,
 * дата и деньги, но не почта и не ник - партнёр приводит трафик, а не
 * получает базу игроков.
 */
export function dashboard(pid, { days = 30, now = Date.now() } = {}) {
  const p = partnerById(pid);
  if (!p) throw fail('Партнёр не найден', 'NOT_FOUND');
  const program = computeProgram(now);
  const e = program.res.get(pid);
  const span = Math.min(366, Math.max(1, Number(days) || 30));
  const from = program.today - span + 1;

  const series = [];
  for (let day = from; day <= program.today; day += 1) {
    const d = e.days.get(day) || blank();
    series.push({
      day: dayLabel(day), signups: d.signups, ftd: d.ftd, deposits: d.deposits,
      ngr: Math.round((d.ngrKop || 0) / 100), earned: Math.floor((e.accrual.get(day) || 0) / 100),
    });
  }

  const shares = program.shares.filter((s) => s.to_at == null);
  const own = shares.find((s) => s.beneficiary_id === pid && s.source_id === pid);
  const network = shares.filter((s) => s.beneficiary_id === pid && s.source_id !== pid).map((s) => {
    const src = partnerById(s.source_id);
    const got = e.bySource.get(s.source_id) || { kop: 0 };
    return { sourceId: s.source_id, name: src?.name || `Партнёр #${s.source_id}`, pct: s.pct,
             earned: Math.floor(got.kop / 100), since: s.from_at };
  });
  // Кто получает сверху с моих рефералов - партнёру знать незачем: это
  // договорённость заведения с третьим лицом, а не его деньги.

  const referrals = db.prepare(`
    SELECT u.id, u.created_at,
           COALESCE((SELECT SUM(amount) FROM deposits x WHERE x.user_id = u.id AND x.source IN ${DEPOSIT_SOURCES}), 0) AS deposits,
           COALESCE((SELECT MAX(created_at) FROM rounds r WHERE r.user_id = u.id), 0) AS last_round,
           (SELECT p2.code FROM promo_redemptions rr JOIN promocodes p2 ON p2.id = rr.promo_id
             WHERE rr.user_id = u.id AND p2.partner_id = u.partner_id ORDER BY rr.id LIMIT 1) AS code
      FROM users u WHERE u.partner_id = ? ORDER BY u.id DESC LIMIT 100
  `).all(pid).map((r) => ({
    id: r.id, createdAt: r.created_at, deposits: r.deposits, code: r.code,
    active: r.last_round > now - 7 * DAY_MS,
  }));

  return {
    partner: publicPartner(p),
    share: own ? own.pct : p.share_pct,
    balance: balanceOf(pid, program),
    carry: Math.round(e.carry / 100),
    today: kpiOf(sumDays(e.days, program.today)),
    period: { days: span, ...kpiOf(sumDays(e.days, from)) },
    total: kpiOf(sumDays(e.days)),
    series,
    promos: promoStats(pid, program),
    referrals,
    network,
    payouts: db.prepare(`SELECT id, amount, status, network, address, usdt, rate, txid, reason, comment,
                                created_at, resolved_at
                           FROM partner_payouts WHERE partner_id = ? ORDER BY id DESC LIMIT 50`).all(pid),
    rules: rulesNow(),
  };
}

export function rulesNow() {
  return {
    minWithdraw: Number(setting('partner_min_withdraw')) || 0,
    promoPct: Number(setting('partner_promo_pct')) || 0,
    promoMax: Number(setting('partner_promo_max')) || 0,
    promoMinDeposit: Number(setting('partner_promo_min_deposit')) || 0,
    codesMax: Number(setting('partner_codes_max')) || 0,
    networks: Object.keys(NETWORKS),
    signupOpen: !!setting('partner_signup_open'),
  };
}

export function publicPartner(p) {
  return p && {
    id: p.id, name: p.name, contact: p.contact, status: p.status, email: p.email || null,
    share: p.share_pct, createdAt: p.created_at, joinedVia: p.joined_via,
  };
}

/* ============================================================
   ВЫВОД
   ============================================================ */

/**
 * Заявка на вывод в USDT. Сумма в рублях (баланс партнёра рублёвый), курс
 * Rapira с наценкой вывода (crypto.js payoutRate) показывает, сколько монет
 * придёт; отправляет сотрудник, и отправленное он вписывает сам. Одна
 * открытая заявка за раз: две параллельные проще потерять, чем обработать.
 */
export const requestPayout = db.transaction((pid, { amount, network, address }, rate) => {
  const p = partnerById(pid);
  if (!p || p.status !== 'active') throw fail('Кабинет приостановлен, вывод закрыт', 'BLOCKED');
  const net = String(network || '').toUpperCase();
  const addr = String(address || '').trim();
  if (!NETWORKS[net]) throw fail('Выберите сеть USDT');
  if (!NETWORKS[net].test(addr)) throw fail(`Адрес не похож на адрес ${net}`);
  const sum = Math.trunc(Number(amount) || 0);
  const min = Number(setting('partner_min_withdraw')) || 0;
  if (sum <= 0) throw fail('Укажите сумму');
  if (sum < min) throw fail(`Минимальный вывод ${min} ₽`);
  if (db.prepare("SELECT 1 FROM partner_payouts WHERE partner_id = ? AND status = 'pending'").get(pid)) {
    throw fail('Прошлая заявка ещё в обработке', 'PENDING');
  }
  const bal = balanceOf(pid);
  if (sum > bal.available) throw fail(`Доступно к выводу ${bal.available} ₽`);
  const usdt = rate > 0 ? (Math.floor(sum / rate * 100) / 100).toFixed(2) : null;
  const info = db.prepare(`INSERT INTO partner_payouts (partner_id, amount, status, network, address, rate, usdt, created_at)
                           VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`)
    .run(pid, sum, net, addr, rate || null, usdt, Date.now());
  return { id: info.lastInsertRowid, amount: sum, usdt, rate };
});

export const cancelPayout = db.transaction((pid, id) => {
  const row = db.prepare("SELECT * FROM partner_payouts WHERE id = ? AND partner_id = ? AND status = 'pending'").get(Number(id), pid);
  if (!row) throw fail('Заявка уже обработана', 'NOT_FOUND');
  db.prepare("UPDATE partner_payouts SET status = 'rejected', reason = 'Отменена партнёром', resolved_at = ? WHERE id = ?")
    .run(Date.now(), row.id);
  return { ok: true };
});

/* ============================================================
   АДМИН
   ============================================================ */

/** Сводка программы и список партнёров с деньгами. */
export function adminOverview({ days = 30, now = Date.now() } = {}) {
  const program = computeProgram(now);
  const span = Math.min(366, Math.max(1, Number(days) || 30));
  const from = program.today - span + 1;
  const partners = db.prepare(`SELECT p.*, u.email FROM partners p LEFT JOIN users u ON u.id = p.user_id
                                ORDER BY p.id DESC`).all();
  const rows = partners.map((p) => {
    const e = program.res.get(p.id);
    const bal = balanceOf(p.id, program);
    const subs = program.shares.filter((s) => s.to_at == null && s.source_id === p.id && s.beneficiary_id !== p.id);
    return {
      ...publicPartner(p),
      balance: bal,
      period: kpiOf(sumDays(e.days, from)),
      total: kpiOf(sumDays(e.days)),
      carry: Math.round(e.carry / 100),
      codes: db.prepare('SELECT COUNT(*) AS n FROM promocodes WHERE partner_id = ?').get(p.id).n,
      network: subs.map((s) => ({ beneficiaryId: s.beneficiary_id, pct: s.pct })),
      parents: program.shares.filter((s) => s.to_at == null && s.beneficiary_id === p.id && s.source_id !== p.id)
        .map((s) => ({ sourceId: s.source_id, pct: s.pct })),
    };
  });
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const series = [];
  for (let day = from; day <= program.today; day += 1) {
    let signups = 0; let ftd = 0; let deposits = 0; let ngr = 0; let earned = 0;
    for (const e of program.res.values()) {
      const d = e.days.get(day);
      if (d) { signups += d.signups; ftd += d.ftd; deposits += d.deposits; ngr += d.ngrKop || 0; }
      earned += e.accrual.get(day) || 0;
    }
    series.push({ day: dayLabel(day), signups, ftd, deposits, ngr: Math.round(ngr / 100), earned: Math.floor(earned / 100) });
  }
  return {
    totals: {
      partners: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      accrued: sum((r) => r.balance.accrued),
      paid: sum((r) => r.balance.paid),
      pending: sum((r) => r.balance.pending),
      owed: sum((r) => r.balance.available + r.balance.pending + r.balance.today),
      period: {
        signups: sum((r) => r.period.signups), ftd: sum((r) => r.period.ftd),
        deposits: sum((r) => r.period.deposits), ngr: sum((r) => r.period.ngr),
      },
      requests: db.prepare("SELECT COUNT(*) AS n FROM partner_payouts WHERE status = 'pending'").get().n,
    },
    series,
    rows,
    rules: rulesNow(),
    costs: program.costs,
  };
}

/**
 * Доля: своя (source = beneficiary) или сверху с чужих рефералов. pct = 0
 * снимает строку. Проверка суммы - по всем получателям с этого источника.
 */
export const setShare = db.transaction((adminId, beneficiaryId, sourceId, rawPct) => {
  const benef = partnerById(beneficiaryId);
  const source = partnerById(sourceId);
  if (!benef || !source) throw fail('Партнёр не найден', 'NOT_FOUND');
  const pct = Math.round(Number(String(rawPct).replace(',', '.')) * 100) / 100;
  if (!(pct >= 0) || pct > 100) throw fail('Процент от 0 до 100');
  const now = Date.now();
  syncOwnShares(now);
  const open = db.prepare('SELECT * FROM partner_shares WHERE source_id = ? AND to_at IS NULL').all(source.id);
  const others = open.filter((r) => r.beneficiary_id !== benef.id).reduce((a, r) => a + Number(r.pct), 0);
  if (others + pct > SHARE_TOTAL_MAX) {
    throw fail(`С рефералов «${source.name || source.id}» уже раздаётся ${others}%, всего можно не больше ${SHARE_TOTAL_MAX}%`);
  }
  const mine = open.find((r) => r.beneficiary_id === benef.id);
  if (mine && Number(mine.pct) === pct) return { ok: true, unchanged: true };
  if (mine) db.prepare('UPDATE partner_shares SET to_at = ? WHERE id = ?').run(now, mine.id);
  if (pct > 0 || benef.id === source.id) {
    db.prepare(`INSERT INTO partner_shares (beneficiary_id, source_id, pct, from_at, set_by)
                VALUES (?, ?, ?, ?, ?)`).run(benef.id, source.id, pct, now, adminId);
  }
  if (benef.id === source.id) db.prepare('UPDATE partners SET share_pct = ? WHERE id = ?').run(pct, benef.id);
  logAdmin(adminId, benef.user_id || 0, 'partner_share', {
    note: benef.id === source.id ? `доля партнёра #${benef.id}` : `#${benef.id} с рефералов #${source.id}`,
    meta: { before: mine ? Number(mine.pct) : 0, after: pct },
  });
  return { ok: true };
});

export function setStatus(adminId, pid, status) {
  const p = partnerById(pid);
  if (!p) throw fail('Партнёр не найден', 'NOT_FOUND');
  if (!['active', 'blocked'].includes(status)) throw fail('Неизвестный статус');
  db.prepare('UPDATE partners SET status = ?, is_active = ? WHERE id = ?').run(status, status === 'active' ? 1 : 0, p.id);
  // Приостановленный партнёр не приводит новых: коды гаснут. Включить их
  // обратно - его же кнопкой, когда кабинет снова откроют.
  if (status === 'blocked') db.prepare('UPDATE promocodes SET is_active = 0 WHERE partner_id = ?').run(p.id);
  logAdmin(adminId, p.user_id || 0, 'partner_status', { note: `#${p.id}: ${status}` });
  return { ok: true };
}

export function shareHistory(pid) {
  return db.prepare(`SELECT s.*, b.name AS beneficiary_name, src.name AS source_name
                       FROM partner_shares s
                       LEFT JOIN partners b ON b.id = s.beneficiary_id
                       LEFT JOIN partners src ON src.id = s.source_id
                      WHERE s.beneficiary_id = ? OR s.source_id = ?
                      ORDER BY s.from_at DESC`).all(pid, pid);
}

export function adminPayouts({ status = 'pending' } = {}) {
  const where = ['pending', 'paid', 'rejected'].includes(status) ? 'WHERE x.status = @status' : '';
  return db.prepare(`SELECT x.*, p.name AS partner_name, u.email AS partner_email
                       FROM partner_payouts x JOIN partners p ON p.id = x.partner_id
                       LEFT JOIN users u ON u.id = p.user_id
                       ${where} ORDER BY x.id DESC LIMIT 200`).all({ status });
}

/**
 * Решение по заявке. «Выплачено» - после того, как сотрудник сам отправил
 * монеты: сумму в USDT и хеш он вписывает с экрана кошелька, а не из нашей
 * оценки. Отказ с причиной возвращает сумму в доступное.
 */
export const resolvePayout = db.transaction((adminId, id, { action, usdt, txid, reason } = {}) => {
  const row = db.prepare('SELECT * FROM partner_payouts WHERE id = ?').get(Number(id));
  if (!row) throw fail('Заявка не найдена', 'NOT_FOUND');
  if (row.status !== 'pending') throw fail('Заявка уже обработана', 'RESOLVED');
  const now = Date.now();
  if (action === 'paid') {
    const sent = usdt == null || usdt === '' ? row.usdt : String(usdt).replace(',', '.');
    if (sent != null && !(Number(sent) > 0)) throw fail('Сумма в USDT не похожа на число');
    db.prepare(`UPDATE partner_payouts SET status = 'paid', usdt = ?, txid = ?, resolved_at = ?, resolved_by = ?
                 WHERE id = ?`).run(sent, String(txid || '').trim().slice(0, 120) || null, now, adminId, row.id);
  } else if (action === 'reject') {
    const why = String(reason || '').trim();
    if (why.length < 3) throw fail('Напишите причину: её увидит партнёр');
    db.prepare(`UPDATE partner_payouts SET status = 'rejected', reason = ?, resolved_at = ?, resolved_by = ?
                 WHERE id = ?`).run(why.slice(0, 300), now, adminId, row.id);
  } else throw fail('Неизвестное действие');
  logAdmin(adminId, 0, action === 'paid' ? 'partner_payout' : 'partner_payout_reject', {
    amount: row.amount, note: `партнёр #${row.partner_id}, заявка #${row.id}`,
  });
  return db.prepare('SELECT * FROM partner_payouts WHERE id = ?').get(row.id);
});

/** Ручная выплата мимо заявки (наличными, другим способом) - отмечается сразу. */
export const manualPayout = db.transaction((adminId, pid, amount, comment) => {
  const sum = Math.trunc(Number(amount) || 0);
  if (sum <= 0) throw fail('Укажите сумму');
  const bal = balanceOf(Number(pid));
  if (sum > bal.available) throw fail(`К выплате доступно ${bal.available} ₽`);
  db.prepare(`INSERT INTO partner_payouts (partner_id, amount, status, comment, created_at, resolved_at, resolved_by)
              VALUES (?, ?, 'paid', ?, ?, ?, ?)`).run(Number(pid), sum, String(comment || '').slice(0, 200) || null,
    Date.now(), Date.now(), adminId);
  logAdmin(adminId, 0, 'partner_payout', { amount: sum, note: `партнёр #${pid}, вручную` });
  return balanceOf(Number(pid));
});

/** Найти партнёра для привязки: по номеру, почте или названию. */
export function findPartner(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (/^\d+$/.test(k)) return partnerById(Number(k));
  const row = db.prepare(`SELECT p.id FROM partners p LEFT JOIN users u ON u.id = p.user_id
                           WHERE lower(u.email) = lower(?) OR lower(p.name) = lower(?) LIMIT 1`).get(k, k);
  return row ? partnerById(row.id) : null;
}
