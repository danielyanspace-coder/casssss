/**
 * Финансовый отдел: сверка с Sicilia и касса проекта.
 *
 * ГЛАВНЫЙ ВОПРОС - сколько Sicilia должна проекту. Шлюз P2P: игрок переводит
 * трейдеру шлюза, шлюз записывает сумму на баланс мерчанта (наш) за вычетом
 * комиссии, выплаты игрокам уходят с этого же баланса плюс комиссия, а
 * накопленное шлюз переводит нам по запросу. Поэтому:
 *
 *   долг шлюза = зачислено игрокам по его подтверждению
 *              - комиссия на приём
 *              - выплачено игрокам по его подтверждению
 *              - комиссия на выплату (процент и фикс за штуку)
 *              - что шлюз перевёл нам (расчёты, вносит сотрудник)
 *              + что мы завели шлюзу на выплаты
 *              ± ручные поправки
 *
 * Всё, кроме расчётов, берётся из sicilia_orders: строка появляется ДО
 * запроса к шлюзу, зачисление и закрытие выплаты ставят paid_at по ответу
 * check-status, а не по колбэку (колбэку одному не верим, см. sicilia.js).
 * Комиссия - та, что стояла в панели в момент сделки (fee_pct у строки);
 * у сделок до появления колонки - текущая, и отчёт это помечает.
 *
 * Сравнение с балансом, который шлюз показывает сам (merchantBalance), и
 * список расхождений нужны ровно для того, чтобы шлюз не мог принять трафик
 * и недодать часть: каждая сделка, где его число разошлось с нашим, видна
 * поимённо, с номерами, которые называют их поддержке.
 */

import { db, setting, logAdmin } from './db.js';
import { DAY_MS, TZ_OFFSET_MS, dayOf, dayStart, dayLabel } from './partners.js';
import { LATE_WINDOW_MS } from './sicilia.js';
// casino_tx и crypto_payments заводятся в своих модулях: касса считает и их.
import './casino-db.js';
import './crypto.js';

const HOUR_MS = 3600_000;
const SETTLE_KINDS = {
  withdraw: { sign: -1, label: 'Sicilia перевела нам' },
  topup: { sign: 1, label: 'Мы завели на баланс шлюза' },
  fee: { sign: -1, label: 'Удержание шлюза' },
  adjust: { sign: 1, label: 'Поправка' },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS sicilia_settlements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT    NOT NULL,
    amount_rub INTEGER NOT NULL,
    usdt       TEXT,
    rate       REAL,
    txid       TEXT,
    note       TEXT,
    at         INTEGER NOT NULL,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    voided_at  INTEGER,
    voided_by  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_sic_settle_at ON sicilia_settlements(at);
  CREATE INDEX IF NOT EXISTS idx_sicilia_paid ON sicilia_orders(kind, paid_at);
`);

const fail = (message, code = 'BAD') => Object.assign(new Error(message), { code });

/* ============================================================
   СДЕЛКИ С КОМИССИЕЙ
   ============================================================ */

const validNum = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

/** Сумма, которую шлюз считает проведённой по выплате: его fact_sum или заявка. */
const payoutPaid = (r) => (validNum(r.fact_sum) ? Math.floor(Number(r.fact_sum)) : r.amount_rub);

function feeOf(r, amount, kind) {
  const pct = r.fee_pct != null ? Number(r.fee_pct)
    : Number(setting(kind === 'payin' ? 'sicilia_payin_fee_pct' : 'sicilia_payout_fee_pct')) || 0;
  const fixed = kind === 'payin' ? 0
    : r.fee_fixed != null ? Number(r.fee_fixed) : Number(setting('sicilia_payout_fee_fixed')) || 0;
  return Math.round((amount * pct / 100 + fixed) * 100) / 100;
}

/** Проведённые шлюзом сделки в окне [from, to), каждая со своей комиссией. */
function settledOrders(from, to) {
  return db.prepare(`SELECT * FROM sicilia_orders WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
                      ORDER BY paid_at`).all(from, to).map((r) => {
    const amount = r.kind === 'payin' ? (r.credited_rub || 0) : payoutPaid(r);
    return { ...r, amount, fee: feeOf(r, amount, r.kind), feeGuessed: r.fee_pct == null };
  });
}

function settlements(from, to) {
  return db.prepare(`SELECT * FROM sicilia_settlements WHERE voided_at IS NULL AND at >= ? AND at < ? ORDER BY at`)
    .all(from, to);
}

const signed = (s) => (SETTLE_KINDS[s.kind]?.sign || 1) * s.amount_rub;

function bucketBlank(key, label) {
  return {
    key, label,
    payinCount: 0, payinOrdered: 0, payin: 0, payinFee: 0,
    payoutCount: 0, payout: 0, payoutFee: 0,
    settled: 0, net: 0, balance: 0,
  };
}

/* Изменение долга шлюза за набор сделок и расчётов. */
function apply(b, orders, settles) {
  for (const o of orders) {
    if (o.kind === 'payin') {
      b.payinCount += 1; b.payinOrdered += o.amount_rub; b.payin += o.amount; b.payinFee += o.fee;
    } else {
      b.payoutCount += 1; b.payout += o.amount; b.payoutFee += o.fee;
    }
  }
  for (const s of settles) b.settled += signed(s);
  b.payinFee = Math.round(b.payinFee * 100) / 100;
  b.payoutFee = Math.round(b.payoutFee * 100) / 100;
  b.net = Math.round((b.payin - b.payinFee - b.payout - b.payoutFee + b.settled) * 100) / 100;
  return b;
}

/**
 * Сверка с Sicilia: по дням (days последних суток) или по часам одного дня.
 * opening - долг на начало окна, closing - на конец; balance у строки -
 * нарастающий итог, то есть долг шлюза на конец этой строки.
 */
export function siciliaLedger({ days = 30, day = null, now = Date.now() } = {}) {
  const hourly = day != null && day !== '';
  let from; let to; let step; let label;
  if (hourly) {
    const d = typeof day === 'string' ? Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS) : Number(day);
    if (!Number.isFinite(d)) throw fail('Неверная дата');
    from = dayStart(d); to = dayStart(d + 1); step = HOUR_MS;
    label = (t) => `${String(Math.floor(((t + TZ_OFFSET_MS) % DAY_MS) / HOUR_MS)).padStart(2, '0')}:00`;
  } else {
    const span = Math.min(366, Math.max(1, Number(days) || 30));
    const today = dayOf(now);
    from = dayStart(today - span + 1); to = dayStart(today + 1); step = DAY_MS;
    label = (t) => dayLabel(dayOf(t));
  }

  const opening = apply(bucketBlank('open', ''), settledOrders(0, from), settlements(0, from)).net;
  const orders = settledOrders(from, to);
  const settles = settlements(from, to);
  const rows = [];
  let running = opening;
  for (let t = from; t < to; t += step) {
    const b = apply(bucketBlank(t, label(t)),
      orders.filter((o) => o.paid_at >= t && o.paid_at < t + step),
      settles.filter((s) => s.at >= t && s.at < t + step));
    running = Math.round((running + b.net) * 100) / 100;
    b.balance = running;
    rows.push(b);
  }
  const total = apply(bucketBlank('total', 'Итого'), orders, settles);
  return {
    granularity: hourly ? 'hour' : 'day',
    from, to, opening, closing: running, total,
    rows: rows.reverse(),
    fees: {
      payinPct: Number(setting('sicilia_payin_fee_pct')) || 0,
      payoutPct: Number(setting('sicilia_payout_fee_pct')) || 0,
      payoutFixed: Number(setting('sicilia_payout_fee_fixed')) || 0,
      guessed: orders.filter((o) => o.feeGuessed).length,
    },
    settlements: settles.reverse().map((s) => ({ ...s, label: SETTLE_KINDS[s.kind]?.label || s.kind, signed: signed(s) })),
  };
}

/** Долг шлюза за всё время - то, что сравнивается с его собственным балансом. */
export function siciliaOwed(now = Date.now()) {
  return apply(bucketBlank('all', ''), settledOrders(0, now + 1), settlements(0, now + 1)).net;
}

/**
 * Где число шлюза разошлось с нашим, или где деньги могли застрять у него.
 * Каждая строка - с обоими номерами сделки: по ним и разговаривают с их
 * поддержкой.
 */
export function siciliaIssues({ now = Date.now() } = {}) {
  const pick = (sql, ...args) => db.prepare(sql).all(...args);
  const short = pick(`SELECT * FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NOT NULL
                        AND credited_rub < amount_rub ORDER BY paid_at DESC LIMIT 100`);
  const over = pick(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND paid_at IS NOT NULL
                       AND fact_sum IS NOT NULL AND CAST(fact_sum AS REAL) > amount_rub ORDER BY paid_at DESC LIMIT 100`);
  const partial = pick(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND paid_at IS NOT NULL
                          AND fact_sum IS NOT NULL AND CAST(fact_sum AS REAL) < amount_rub ORDER BY paid_at DESC LIMIT 100`);
  const late = pick(`SELECT * FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NOT NULL
                       AND expires_at IS NOT NULL AND paid_at > expires_at ORDER BY paid_at DESC LIMIT 100`);
  const disputes = pick(`SELECT d.*, o.invid, o.gateway_id, o.amount_rub FROM sicilia_disputes d
                           JOIN sicilia_orders o ON o.id = d.order_id
                          WHERE d.status IN ('new', 'sent') ORDER BY d.id DESC LIMIT 100`);
  // Закрыты у нас неоплаченными, а поздняя сверка их ещё спрашивает: шлюз
  // может зачесть их руками позже, и тогда деньги придут сами.
  const watching = pick(`SELECT * FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NULL
                           AND status IN ('cancelled', 'unclaimed', 'expired', 'error') AND created_at > ?
                         ORDER BY id DESC LIMIT 100`, now - LATE_WINDOW_MS);
  const stuckPayouts = pick(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND paid_at IS NULL
                               AND status NOT IN ('cancelled', 'error', 'unclaimed') AND created_at < ?
                             ORDER BY id LIMIT 100`, now - 24 * HOUR_MS);
  const view = (r) => ({
    id: r.id, kind: r.kind, invid: r.invid, gatewayId: r.gateway_id, userId: r.user_id,
    amount: r.amount_rub, credited: r.credited_rub, fact: r.fact_sum, status: r.status,
    createdAt: r.created_at, paidAt: r.paid_at,
  });
  return {
    short: { title: 'Шлюз подтвердил меньше, чем выставлено', hint: 'Игрок мог перевести всю сумму: сверьте с чеком', rows: short.map(view),
             sum: short.reduce((a, r) => a + r.amount_rub - (r.credited_rub || 0), 0) },
    disputes: { title: 'Игрок перевёл, деньги не пришли', hint: 'Открытые споры: деньги могут лежать у шлюза',
                rows: disputes.map((d) => ({ ...view({ ...d, id: d.order_id, kind: 'payin', status: d.status, user_id: d.user_id }), disputeId: d.id })),
                sum: disputes.reduce((a, r) => a + r.amount_rub, 0) },
    stuckPayouts: { title: 'Выплата в шлюзе дольше суток', hint: 'Шлюз не закрыл и не отменил: спросите статус', rows: stuckPayouts.map(view),
                    sum: stuckPayouts.reduce((a, r) => a + r.amount_rub, 0) },
    over: { title: 'Шлюз сообщил выплату больше заявки', hint: 'Разницу шлюз списал с нашего баланса', rows: over.map(view),
            sum: over.reduce((a, r) => a + Number(r.fact_sum) - r.amount_rub, 0) },
    partial: { title: 'Выплата неполная', hint: 'Остаток вернулся игроку на баланс', rows: partial.map(view),
               sum: partial.reduce((a, r) => a + r.amount_rub - Number(r.fact_sum), 0) },
    late: { title: 'Зачислено после срока ордера', hint: 'Нормально для ручного подтверждения; много таких - вопрос к шлюзу', rows: late.map(view),
            sum: late.reduce((a, r) => a + (r.credited_rub || 0), 0) },
    watching: { title: 'Закрыты неоплаченными, ещё перепроверяются', hint: '72 часа сверка спрашивает их статус сама', rows: watching.map(view),
                sum: watching.reduce((a, r) => a + r.amount_rub, 0) },
  };
}

/* ============================================================
   РАСЧЁТЫ С ШЛЮЗОМ (вносит сотрудник)
   ============================================================ */

export const addSettlement = db.transaction((adminId, { kind, amount, usdt, rate, txid, note, at } = {}) => {
  if (!SETTLE_KINDS[kind]) throw fail('Выберите вид расчёта');
  let sum = Math.round(Number(String(amount).replace(',', '.')) || 0);
  if (kind === 'adjust') {
    if (!sum) throw fail('Укажите сумму поправки (минус - в пользу шлюза)');
  } else if (!(sum > 0)) throw fail('Укажите сумму в рублях');
  const why = String(note || '').trim();
  if (kind === 'adjust' && why.length < 5) throw fail('Поправка без объяснения не принимается');
  const when = at ? Number(at) || Date.parse(at) : Date.now();
  if (!Number.isFinite(when)) throw fail('Неверная дата');
  if (kind !== 'adjust') sum = Math.abs(sum);
  const info = db.prepare(`INSERT INTO sicilia_settlements (kind, amount_rub, usdt, rate, txid, note, at, created_by, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(kind, sum, usdt ? String(usdt).slice(0, 40) : null, Number(rate) || null,
         txid ? String(txid).slice(0, 120) : null, why.slice(0, 300) || null, when, adminId, Date.now());
  logAdmin(adminId, 0, 'sicilia_settlement', { amount: sum, note: `${SETTLE_KINDS[kind].label}${why ? `: ${why}` : ''}` });
  return { id: info.lastInsertRowid };
});

/* Ошибочную запись не удаляют, а гасят: видно, кто внёс и кто погасил. */
export function voidSettlement(adminId, id) {
  const row = db.prepare('SELECT * FROM sicilia_settlements WHERE id = ? AND voided_at IS NULL').get(Number(id));
  if (!row) throw fail('Запись не найдена', 'NOT_FOUND');
  db.prepare('UPDATE sicilia_settlements SET voided_at = ?, voided_by = ? WHERE id = ?').run(Date.now(), adminId, row.id);
  logAdmin(adminId, 0, 'sicilia_settlement_void', { amount: row.amount_rub, note: `#${row.id}` });
  return { ok: true };
}

/* ============================================================
   ВЫГРУЗКА ДЛЯ СВЕРКИ С ВЫПИСКОЙ ШЛЮЗА
   ============================================================ */

export function siciliaCsvRows(days = 30, now = Date.now()) {
  const from = dayStart(dayOf(now) - Math.min(366, Math.max(1, Number(days) || 30)) + 1);
  const iso = (t) => (t ? new Date(t + TZ_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19) : '');
  const head = ['Вид', 'Наш номер', 'Номер шлюза', 'Игрок', 'Создан (МСК)', 'Проведён (МСК)',
    'Выставлено', 'Подтверждено шлюзом', 'Комиссия', 'Изменение долга шлюза'];
  const rows = settledOrders(from, now + 1).map((o) => [
    o.kind === 'payin' ? 'Пополнение' : 'Выплата', o.invid, o.gateway_id ?? '', o.user_id,
    iso(o.created_at), iso(o.paid_at), o.amount_rub, o.amount, o.fee.toFixed(2),
    (o.kind === 'payin' ? o.amount - o.fee : -(o.amount + o.fee)).toFixed(2),
  ]);
  for (const s of settlements(from, now + 1)) {
    rows.push([SETTLE_KINDS[s.kind]?.label || s.kind, `расчёт #${s.id}`, s.txid || '', '', iso(s.created_at), iso(s.at),
      s.amount_rub, '', '', signed(s).toFixed(2)]);
  }
  return { head, rows };
}

/* ============================================================
   КАССА ПРОЕКТА
   ============================================================ */

/**
 * Деньги проекта по дням: что пришло (по каналам), что ушло (выводы игроков
 * и партнёров), доход игр. Это не прибыль бухгалтерии, а движение денег: по
 * нему видно, куда делись деньги за день, не открывая каждую сделку.
 */
export function cashSummary({ days = 30, now = Date.now() } = {}) {
  const span = Math.min(366, Math.max(1, Number(days) || 30));
  const today = dayOf(now);
  const from = dayStart(today - span + 1);
  const D = (col) => `CAST((${col} + ${TZ_OFFSET_MS}) / ${DAY_MS} AS INTEGER)`;
  const map = new Map();
  const at = (day) => {
    if (!map.has(day)) {
      map.set(day, { day: dayLabel(day), depSicilia: 0, depCrypto: 0, depOther: 0, payoutSbp: 0, payoutCrypto: 0,
        partnerPaid: 0, ggrCases: 0, ggrCasino: 0, bonusConverted: 0, signups: 0, ftd: 0 });
    }
    return map.get(day);
  };
  for (let d = today - span + 1; d <= today; d += 1) at(d);
  const each = (sql, fn) => { for (const r of db.prepare(sql).all(from)) if (map.has(r.day)) fn(at(r.day), r); };
  each(`SELECT ${D('created_at')} AS day, source, SUM(amount) AS s FROM deposits WHERE created_at >= ? GROUP BY day, source`,
    (b, r) => {
      if (r.source === 'sicilia') b.depSicilia += r.s;
      else if (r.source === 'crypto') b.depCrypto += r.s;
      else if (r.source === 'admin') b.depOther += r.s;
    });
  each(`SELECT ${D('resolved_at')} AS day, method, SUM(amount) AS s FROM payouts
         WHERE status = 'paid' AND resolved_at >= ? GROUP BY day, method`,
    (b, r) => { if (r.method === 'crypto') b.payoutCrypto += r.s; else b.payoutSbp += r.s; });
  each(`SELECT ${D('resolved_at')} AS day, SUM(amount) AS s FROM partner_payouts
         WHERE status = 'paid' AND COALESCE(resolved_at, created_at) >= ? GROUP BY day`,
    (b, r) => { b.partnerPaid += r.s; });
  each(`SELECT ${D('created_at')} AS day, SUM(bet - bonus_bet) - SUM(payout - bonus_payout) AS s
          FROM rounds WHERE created_at >= ? GROUP BY day`, (b, r) => { b.ggrCases += r.s; });
  each(`SELECT ${D('created_at')} AS day,
               SUM(CASE WHEN method = 'bet' AND free_round = 0 THEN amount_kop ELSE 0 END)
             - SUM(CASE WHEN method IN ('win', 'cashout') THEN amount_kop ELSE 0 END) AS s
          FROM casino_tx WHERE rolled_back = 0 AND created_at >= ? GROUP BY day`,
    (b, r) => { b.ggrCasino += Math.round(r.s / 100); });
  each(`SELECT ${D('created_at')} AS day, SUM(amount) AS s FROM bonus_events
         WHERE kind = 'convert' AND created_at >= ? GROUP BY day`, (b, r) => { b.bonusConverted += r.s; });
  each(`SELECT ${D('created_at')} AS day, COUNT(*) AS s FROM users WHERE created_at >= ? GROUP BY day`,
    (b, r) => { b.signups += r.s; });
  each(`SELECT ${D('first')} AS day, COUNT(*) AS s FROM (
          SELECT MIN(created_at) AS first FROM deposits WHERE source IN ('sicilia', 'crypto') GROUP BY user_id)
         WHERE first >= ? GROUP BY day`, (b, r) => { b.ftd += r.s; });
  const rows = [...map.values()].reverse();
  for (const r of rows) {
    r.depTotal = r.depSicilia + r.depCrypto + r.depOther;
    r.outTotal = r.payoutSbp + r.payoutCrypto + r.partnerPaid;
    r.cashNet = r.depTotal - r.outTotal;
    r.ngr = r.ggrCases + r.ggrCasino - r.bonusConverted;
  }
  const total = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === 'number') total[k] = (total[k] || 0) + v;
  // Обязательства перед игроками: всё, что они могут потребовать прямо сейчас.
  const liab = db.prepare(`SELECT COALESCE(SUM(balance), 0) AS bal, COALESCE(SUM(balance_kop), 0) AS kop,
                                  COALESCE(SUM(bonus_balance), 0) AS bonus FROM users`).get();
  const pendingPayouts = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS n FROM payouts
                                      WHERE status IN ('pending', 'processing')`).get();
  return {
    days: span, rows, total,
    liabilities: {
      playersBalance: liab.bal + Math.floor(liab.kop / 100), bonusBalance: liab.bonus,
      pendingPayouts: pendingPayouts.s, pendingPayoutsCount: pendingPayouts.n,
    },
  };
}
