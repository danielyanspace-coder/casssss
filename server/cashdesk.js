/**
 * Касса для панели: все пополнения одним списком и выгрузки сделок.
 *
 * Только чтение. Деньги здесь не двигаются: зачисления живут в sicilia.js и
 * crypto.js, выводы в db.js. Модуль нужен потому, что сотруднику при споре со
 * шлюзом важен не способ оплаты, а одно: найти сделку по любому номеру, который
 * ему назвали (наш, шлюза, номер игрока), и увидеть её целиком.
 *
 * Номера сделки два, и оба показываются рядом:
 *   наш (invid у Sicilia, order_id у Heleket) - его шлюз видит в каждом нашем
 *     запросе и по нему отвечает на check-status;
 *   шлюза (gateway_id у Sicilia, uuid у Heleket) - его видно в их кабинете.
 */

import { db, payoutCardDigits } from './db.js';
import { gatewayPayouts } from './sicilia.js';

export const DEPOSITS_PAGE = 50;

/* Состояния для фильтра, одинаковые у обоих шлюзов. */
const SIC_DEAD = "('cancelled', 'error', 'unclaimed', 'expired')";
const CRYPTO_DEAD = "('failed', 'fail', 'cancel', 'system_fail', 'wrong_amount', 'expired')";

/**
 * Пополнения через шлюзы. filter: all | credited | open | failed | dispute.
 * q ищет по нашему номеру, номеру шлюза, id игрока, почте и нику.
 */
export function adminDeposits({ q = '', filter = 'all', limit = DEPOSITS_PAGE, before = 0 } = {}) {
  const text = String(q || '').trim();
  const like = `%${text.toLowerCase()}%`;
  const num = /^\d+$/.test(text) ? Number(text) : -1;
  const lim = Math.min(200, Math.max(1, Number(limit) || DEPOSITS_PAGE));

  const sicWhere = {
    credited: 'o.paid_at IS NOT NULL',
    open: `o.paid_at IS NULL AND o.status NOT IN ${SIC_DEAD}`,
    failed: `o.paid_at IS NULL AND o.status IN ${SIC_DEAD}`,
    dispute: "EXISTS (SELECT 1 FROM sicilia_disputes d WHERE d.order_id = o.id AND d.status IN ('new', 'sent'))",
  }[filter] || '1';
  const cryWhere = {
    credited: 'c.paid_at IS NOT NULL',
    open: `c.paid_at IS NULL AND c.status NOT IN ${CRYPTO_DEAD}`,
    failed: `c.paid_at IS NULL AND c.status IN ${CRYPTO_DEAD}`,
    dispute: '0',
  }[filter] || '1';

  const search = (ours, gw) => text ? `AND (lower(${ours}) LIKE @like OR lower(CAST(${gw} AS TEXT)) LIKE @like
      OR u.id = @num OR CAST(u.tg_id AS TEXT) = @text OR lower(COALESCE(u.email, '')) LIKE @like
      OR lower(COALESCE(u.username, '')) LIKE @like)` : '';

  /*
   * Общая лента по времени: у двух таблиц свои id, поэтому листаем по
   * created_at. Совпадение до миллисекунды у двух оплат возможно, но тогда
   * одна строка просто окажется и на этой, и на следующей странице.
   */
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT 'sicilia' AS source, o.id, o.invid AS number, CAST(o.gateway_id AS TEXT) AS gateway_id,
             o.amount_rub AS amount, o.credited_rub AS credited, o.status, o.fact_sum,
             o.created_at, o.paid_at, NULL AS currency, o.terminal,
             u.id AS user_id, u.email, u.username, u.first_name, u.tg_id
        FROM sicilia_orders o JOIN users u ON u.id = o.user_id
       WHERE o.kind = 'payin' AND ${sicWhere} ${search('o.invid', 'o.gateway_id')}
      UNION ALL
      SELECT 'crypto' AS source, c.id, c.order_id AS number, c.uuid AS gateway_id,
             c.amount_rub AS amount, c.credited_rub AS credited, c.status, c.payer_amount AS fact_sum,
             c.created_at, c.paid_at, c.currency, NULL AS terminal,
             u.id AS user_id, u.email, u.username, u.first_name, u.tg_id
        FROM crypto_payments c JOIN users u ON u.id = c.user_id
       WHERE ${cryWhere} ${search('c.order_id', 'c.uuid')}
    )
    WHERE (@before = 0 OR created_at < @before)
    ORDER BY created_at DESC LIMIT @lim
  `).all({ like, num, text, before: Number(before) || 0, lim });

  const disputes = disputesFor(rows.filter((r) => r.source === 'sicilia').map((r) => r.id));
  return rows.map((r) => ({ ...r, dispute: r.source === 'sicilia' ? disputes.get(r.id) || null : null }));
}

function disputesFor(orderIds) {
  const out = new Map();
  if (!orderIds.length) return out;
  const rows = db.prepare(`SELECT * FROM sicilia_disputes WHERE order_id IN (${orderIds.map(() => '?').join(',')})
                           ORDER BY id`).all(...orderIds);
  // Последний спор по оплате главный: прошлые закрыты и видны в журнале.
  for (const d of rows) {
    out.set(d.order_id, {
      id: d.id, source: d.source, status: d.status, comment: d.comment,
      receipt: d.receipt ? `/receipts/${d.receipt}` : null,
      appealId: d.appeal_id, appealStatus: d.appeal_status, appealReason: d.appeal_reason,
      factSum: d.fact_sum, staffNote: d.staff_note, error: d.error,
      createdAt: d.created_at, sentAt: d.sent_at, closedAt: d.closed_at,
    });
  }
  return out;
}

/** Сводка для шапки раздела: что требует внимания прямо сейчас. */
export function depositsSummary(now = Date.now()) {
  const day = now - 86400000;
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const sic = one(`SELECT COUNT(*) AS n, COALESCE(SUM(credited_rub), 0) AS sum FROM sicilia_orders
                    WHERE kind = 'payin' AND paid_at >= ?`, day);
  const cry = one(`SELECT COUNT(*) AS n, COALESCE(SUM(credited_rub), 0) AS sum FROM crypto_payments
                    WHERE paid_at >= ?`, day);
  const created = one(`SELECT COUNT(*) AS n FROM sicilia_orders WHERE kind = 'payin' AND created_at >= ?`, day).n
    + one('SELECT COUNT(*) AS n FROM crypto_payments WHERE created_at >= ?', day).n;
  return {
    paidCount: sic.n + cry.n,
    paidSum: sic.sum + cry.sum,
    // Доля дошедших до денег среди созданных за сутки: падение - первый
    // признак, что у шлюза кончились реквизиты или окно не открывается.
    conversion: created ? (sic.n + cry.n) / created : null,
    disputesNew: one("SELECT COUNT(*) AS n FROM sicilia_disputes WHERE status = 'new'").n,
    disputesSent: one("SELECT COUNT(*) AS n FROM sicilia_disputes WHERE status = 'sent'").n,
  };
}

/* ============================================================
   ВЫГРУЗКИ СДЕЛОК
   ============================================================ */

const date = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '');
const who = (r) => r.email || (r.username ? '@' + r.username : '') || r.first_name || '';

/** Пополнения за период построчно: оба номера, сумма заявки и зачисленная. */
export function depositsCsvRows(days) {
  const from = Date.now() - days * 86400000;
  const rows = [];
  let before = 0;
  // Листаем той же выборкой, что и панель: одно правило на оба места.
  for (;;) {
    const page = adminDeposits({ limit: 200, before }).filter((r) => r.created_at >= from);
    rows.push(...page);
    if (page.length < 200) break;
    before = page[page.length - 1].created_at;
  }
  return {
    head: ['создано (UTC)', 'зачислено (UTC)', 'шлюз', 'наш номер', 'номер шлюза', 'игрок', 'почта или ник',
           'сумма заявки', 'зачислено', 'факт шлюза', 'монета', 'статус', 'спор'],
    rows: rows.map((r) => [date(r.created_at), date(r.paid_at), r.source === 'sicilia' ? 'Sicilia' : 'Heleket',
      r.number, r.gateway_id || '', r.user_id, who(r), r.amount, r.credited ?? '', r.fact_sum ?? '',
      r.currency || '', r.status, r.dispute ? r.dispute.status : '']),
  };
}

/**
 * Выводы за период построчно. Номер карты в файле только последними цифрами:
 * выгрузку пересылают и хранят где попало, а полный номер нужен лишь тому,
 * кто платит, и он видит его в панели.
 */
export function payoutsCsvRows(days) {
  const from = Date.now() - days * 86400000;
  const list = db.prepare(`
    SELECT p.*, u.email, u.username, u.first_name
      FROM payouts p JOIN users u ON u.id = p.user_id
     WHERE p.created_at >= ? ORDER BY p.id DESC`).all(from);
  const gw = gatewayPayouts(list.map((p) => p.id));
  const tail = (row) => {
    const digits = payoutCardDigits(row);
    return digits ? `*${digits.slice(-4)}` : '';
  };
  return {
    head: ['создано (UTC)', 'закрыто (UTC)', 'номер заявки', 'игрок', 'почта или ник', 'сумма', 'способ',
           'реквизит', 'банк', 'статус', 'номер Sicilia (наш)', 'номер Sicilia (шлюза)', 'статус Sicilia', 'чек', 'комментарий'],
    rows: list.map((p) => {
      const g = gw[p.id];
      const requisite = p.method === 'card' ? tail(p)
        : p.method === 'crypto' ? p.crypto_address || '' : p.phone || '';
      return [date(p.created_at), date(p.resolved_at), p.id, p.user_id, who(p), p.amount, p.method,
        requisite, p.bank || p.crypto_network || '', p.status, g?.invid || '', g?.gatewayId || '',
        g?.status || '', g?.checkUrl || '', p.comment || ''];
    }),
  };
}

export function toCsv(head, rows) {
  const escape = (v) => {
    // Кавычки CSV не мешают Excel исполнить формулу из ника/комментария.
    // Числовые значения остаются числами, пользовательские строки - текстом.
    const raw = String(v ?? '');
    const text = typeof v === 'string' && (/^\s*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw)) ? "'" + raw : raw;
    return /[";\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return '﻿' + [head, ...rows].map((r) => r.map(escape).join(';')).join('\r\n');
}
