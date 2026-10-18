/**
 * Приём платежей и выплаты через Sicilia (api.sicilia.ink).
 *
 * Шлюз P2P: игрок переводит по СБП или с карты на реквизит, который выдаёт
 * шлюз, а шлюз сообщает нам о результате колбэком. Документация:
 * https://documenter.getpostman.com/view/24855881/2sB2x2LaNf
 *
 * ПОПОЛНЕНИЕ - ДВА СПОСОБА, выбирается SICILIA_PAYIN.
 *
 * 'h2h' (по умолчанию): ордер заводим мы сами (orders/create), шлюз отвечает
 * реквизитом - карта или телефон получателя, банк, имя, иногда диплинк, - и
 * касса показывает его у нас вместе с суммой и таймером. Так решил заказчик,
 * чтобы не ждать, пока шлюз настроит окно под мерчант.
 *
 * 'window': платёжное окно шлюза отдельной вкладкой. Сервер подписывает
 * ссылку (sum, invid, merchant, callback_url), ордер заводит само окно.
 *
 * В обоих случаях строка в нашей базе появляется ДО ордера у шлюза: колбэк
 * находит её по invid.
 *
 * КОЛБЭКУ ОДНОМУ НЕ ВЕРИМ. Подпись колбэка - sha256('sum:invid:apiKey'), и
 * статуса в ней нет. Значит, подпись отменённого ордера годится и для
 * «успешного» с тем же номером и суммой: подделать её нельзя, а вот
 * переиграть - можно. Поэтому колбэк только будит нас, а решение о
 * зачислении принимается по ответу check-status, который мы запрашиваем сами
 * своей подписью. То же и для выплат.
 *
 * ВЫПЛАТЫ - ИЗ ПАНЕЛИ, А НЕ САМИ. Заявка на вывод проходит прежние
 * состояния (Новая -> В работе -> Выполнено), а кнопка «Выплатить через
 * Sicilia» лишь заменяет ручной перевод: человек смотрит на заявку до того,
 * как деньги ушли. Для выплат шлюз требует наш IP в своём белом списке
 * (иначе 403 «Warn IP client address»), это делается через их поддержку.
 *
 * Деньги здесь двигаются так же, как в crypto.js: одной транзакцией, с
 * уникальной ссылкой в balance_transactions - повторный колбэк упирается в
 * ограничение базы, а не в проверку в коде.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  db, getUserById, registerDeposit, trackEvent, payoutForGateway, startPayout, completePayout,
} from './db.js';

/* Журнал balance_transactions общий для шлюзов и создаётся в db.js. */
import { alert, countError } from './ops.js';

/*
 * Настройки читаются при каждом вызове, а не при загрузке модуля: их правят в
 * .env чаще, чем код, а тестам нужно подставлять свои.
 */
export function siciliaEnv() {
  return {
    api: (process.env.SICILIA_API_URL || 'https://api.sicilia.ink/api').replace(/\/+$/, ''),
    payUrl: (process.env.SICILIA_PAY_URL || '').replace(/\/+$/, ''),
    payin: String(process.env.SICILIA_PAYIN || 'h2h').trim().toLowerCase() === 'window' ? 'window' : 'h2h',
    merchant: String(process.env.SICILIA_MERCHANT || '').trim(),
    login: String(process.env.SICILIA_LOGIN || '').trim(),
    key: String(process.env.SICILIA_API_KEY || '').trim(),
    min: Number(process.env.SICILIA_MIN || 500),
    max: Number(process.env.SICILIA_MAX || 300_000),
    // Срок реквизита после выдачи: столько идёт таймер в кассе (решение заказчика).
    ttlMs: Number(process.env.SICILIA_ORDER_TTL_MIN || 10) * 60_000,
    callbackIps: String(process.env.SICILIA_CALLBACK_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
    webapp: String(process.env.SITE_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, ''),
  };
}

/** Ключи есть - можно говорить с API (проверка статуса, выплаты, баланс). */
export function isConfigured(env = siciliaEnv()) {
  return Boolean(env.merchant && env.login && env.key);
}

/** Пополнение доступно: через API - сразу с ключами, через окно - ещё и с его адресом. */
export function payinReady(env = siciliaEnv()) {
  return isConfigured(env) && (env.payin === 'h2h' || Boolean(env.payUrl));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sicilia_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT    NOT NULL,              -- 'payin' | 'payout'
    user_id      INTEGER NOT NULL REFERENCES users(id),
    invid        TEXT    NOT NULL UNIQUE,
    amount_rub   INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'created',
    gateway_id   INTEGER,
    fact_sum     TEXT,
    credited_rub INTEGER,
    payout_id    INTEGER REFERENCES payouts(id),
    method       TEXT,
    bank         TEXT,
    check_url    TEXT,
    error        TEXT,
    sent_by      INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    paid_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_sicilia_user ON sicilia_orders(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_sicilia_status ON sicilia_orders(kind, status);
  CREATE INDEX IF NOT EXISTS idx_sicilia_payout ON sicilia_orders(payout_id);
`);

/*
 * Реквизит ордера, выданный шлюзом (JSON), и до какого времени он наш. Нужен,
 * чтобы игрок, закрывший кассу, вернулся к тому же переводу: второй ордер
 * занял бы второй реквизит, а оплаченный первый пришлось бы искать.
 */
const orderCols = db.prepare('PRAGMA table_info(sicilia_orders)').all().map((c) => c.name);
if (!orderCols.includes('requisite')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN requisite TEXT');
if (!orderCols.includes('pay_sum')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN pay_sum TEXT');
if (!orderCols.includes('expires_at')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN expires_at INTEGER');

const txCols = db.prepare('PRAGMA table_info(balance_transactions)').all().map((c) => c.name);
if (!txCols.includes('sicilia_order_id')) {
  db.exec('ALTER TABLE balance_transactions ADD COLUMN sicilia_order_id INTEGER REFERENCES sicilia_orders(id)');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_sicilia
             ON balance_transactions(sicilia_order_id) WHERE sicilia_order_id IS NOT NULL`);
}

/* ============================================================
   ПОДПИСИ (раздел Meta документации, проверочный bash-скрипт)
   ============================================================ */

const sha256 = (...parts) => createHash('sha256').update(parts.join(':')).digest('hex');

/** Создание ордера, платёжное окно и проверка статуса пополнения. */
export const signPayin = (sum, invid, env = siciliaEnv()) => sha256(env.login, sum, invid, env.key);
/** Отзыв ордера пополнения и апелляция. */
export const signInvid = (invid, env = siciliaEnv()) => sha256(env.login, invid, env.key);
/** Создание, проверка и отзыв выплаты. */
export const signPayout = (sum, invid, env = siciliaEnv()) => sha256(env.login, sum, invid, env.key, 'PAYOUT');

function sameHex(a, b) {
  const x = Buffer.from(String(a || '').toLowerCase());
  const y = Buffer.from(String(b || '').toLowerCase());
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Подпись колбэка. У пополнения - sha256('OutSum:InvId:apiKey'), где OutSum
 * берётся строкой ровно как пришёл («100.0000», а не 100). У выплаты -
 * sha256('login:sum:invid:apiKey').
 */
export function verifyCallback(body, env = siciliaEnv()) {
  if (!body || typeof body !== 'object' || !env.key) return false;
  if (body.order_type === 'payout') {
    return sameHex(body.signature, sha256(env.login, body.sum, body.invid, env.key));
  }
  return sameHex(body.SignatureValue, sha256(body.OutSum, body.InvId, env.key));
}

export function callbackIpAllowed(ip, env = siciliaEnv()) {
  if (!env.callbackIps.length) return true;
  return env.callbackIps.includes(String(ip || '').replace(/^::ffff:/, ''));
}

/* ============================================================
   ЗАПРОСЫ
   ============================================================ */

const TIMEOUT_MS = 20_000;

async function call(method, path, body, { headers = {} } = {}) {
  const env = siciliaEnv();
  if (!isConfigured(env)) {
    throw Object.assign(new Error('Платёжный шлюз не настроен'), { code: 'NOT_CONFIGURED' });
  }
  let res;
  try {
    res = await fetch(env.api + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    countError('sicilia:down', `Sicilia не отвечает: ${err.message}`, { threshold: 3 });
    throw Object.assign(new Error('Платёжный шлюз временно недоступен'), { code: 'GATEWAY_UNREACHABLE', cause: err });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.message || json.error
      || (json.errors && Object.values(json.errors).flat().join('; ')) || `Шлюз ответил ${res.status}`;
    // 401 и 403 - не сбой сети, а настройка: ключ или белый список адресов
    // шлюза. Сами они не пройдут, нужен человек.
    if (res.status === 401 || res.status === 403) {
      alert('sicilia:auth', `Sicilia отказывает (${res.status}): ${message}. Проверьте ключ и белый список IP сервера у шлюза.`);
    } else if (res.status >= 500) {
      countError('sicilia:5xx', `Sicilia отвечает ошибкой ${res.status}: ${message}`, { threshold: 3 });
    }
    throw Object.assign(new Error(message), { code: 'GATEWAY_ERROR', status: res.status });
  }
  return json;
}

/* ============================================================
   ПОПОЛНЕНИЕ
   ============================================================ */

function makeInvid(prefix, id) {
  return `${prefix}-${id}-${Date.now().toString(36)}`;
}

/** Ордер ещё можно оплатить: не зачислен, не закрыт и время не вышло. */
function payable(r, now = Date.now()) {
  return !r.paid_at && !DEAD.has(r.status) && r.status !== 'expired' && (!r.expires_at || now < r.expires_at);
}

/*
 * Реквизит отдаётся только пока ордер открыт. Реквизиты у шлюза живые и
 * переходят от ордера к ордеру: карта, показанная в истории неделю спустя,
 * уже чужая, и перевод на неё не найдёт никто.
 */
function publicOrder(r) {
  if (!r) return null;
  let requisite = null;
  if (r.requisite && payable(r)) {
    try { requisite = JSON.parse(r.requisite); } catch { requisite = null; }
  }
  return {
    id: r.id,
    amount: r.amount_rub,
    paySum: r.pay_sum != null ? Number(r.pay_sum) : r.amount_rub,
    method: r.method || null,
    status: r.status,
    credited: r.credited_rub,
    createdAt: r.created_at,
    expiresAt: r.expires_at || null,
    paidAt: r.paid_at,
    requisite,
  };
}

/** Ссылка на платёжное окно для строки пополнения. */
function payUrlFor(row, env = siciliaEnv()) {
  const sum = String(row.amount_rub);
  const q = new URLSearchParams({
    sum,
    signature: signPayin(sum, row.invid, env),
    invid: row.invid,
    merchant: env.merchant,
    external_user_id: String(row.user_id),
  });
  if (env.webapp) {
    q.set('redirect_url', env.webapp);
    q.set('callback_url', `${env.webapp}/api/webhooks/sicilia`);
  }
  return `${env.payUrl}/?${q}`;
}

/*
 * Способ оплаты игрока -> метод ордера шлюза. Только два: перевод по СБП на
 * телефон и с карты на карту. Остальные методы шлюза (внутрибанк, QR,
 * трансгран) включаются у них по договорённости, и показывать игроку то, что
 * для мерчанта не включено, значит получать отказ на каждом ордере.
 */
const PAYIN_METHODS = { sbp: 'sbp', card: 'any-bank' };

/*
 * Банк игрока: по нему шлюз отдаёт диплинк, открывающий перевод в приложении
 * банка с уже заполненными полями. Диплинк бывает только у этих четырёх.
 */
export const DEEPLINK_BANKS = ['sberbank', 'tinkoff', 'vtb', 'alfa-bank'];

/* Отказы шлюза, которые значат «сейчас нет реквизита», а не поломку. */
const NO_REQUISITE = /no available (calls|traders)/i;

function validAmount(amountRub, env) {
  const amount = Math.trunc(Number(amountRub));
  if (!Number.isFinite(amount) || amount < env.min) {
    throw Object.assign(new Error(`Минимальная сумма пополнения - ${env.min} ₽`), { code: 'MIN' });
  }
  if (amount > env.max) {
    throw Object.assign(new Error(`Максимальная сумма пополнения - ${env.max} ₽`), { code: 'MAX' });
  }
  return amount;
}

function insertPayin(userId, amount, method, env) {
  const now = Date.now();
  const info = db.prepare(`INSERT INTO sicilia_orders (kind, user_id, invid, amount_rub, method, expires_at, created_at, updated_at)
                           VALUES ('payin', ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, `tmp-${now}-${Math.random()}`, amount, method, now + env.ttlMs, now, now);
  const invid = makeInvid('lb', info.lastInsertRowid);
  db.prepare('UPDATE sicilia_orders SET invid = ? WHERE id = ?').run(invid, info.lastInsertRowid);
  return db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(info.lastInsertRowid);
}

/** Из ответа orders/create - только то, что нужно игроку для перевода. */
function requisiteFrom(info, method) {
  const card = info.card || {};
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const req = {
    method,
    phone: digits(card.telefon) || null,
    card: digits(card.number) || null,
    account: info.account_transfer ? digits(card.account_number) || null : null,
    bik: info.account_transfer ? digits(card.bank_id_code) || null : null,
    holder: String(info.fio || '').trim() || null,
    bank: String(info.bank_data?.name || '').trim() || null,
    bankCode: String(info.bank_data?.code || info.bank || '').trim() || null,
    deeplink: /^https?:\/\//i.test(String(info.deeplink || '')) ? String(info.deeplink) : null,
    payLink: /^https?:\/\//i.test(String(card.payment_link || '')) ? String(card.payment_link) : null,
    abroad: info.trans_gov ? String(info.trans_gov_country || '').trim() || 'да' : null,
  };
  // Куда переводить, решает шлюз: на СБП он может выдать и карту, и телефон.
  // Показываем то, что подходит выбранному способу, а при его отсутствии - что есть.
  const target = method === 'sbp' ? req.phone || req.card : req.card || req.phone;
  return target || req.account || req.payLink ? req : null;
}

/**
 * Заводит пополнение.
 *
 * Через API: ордер у шлюза создаётся здесь же, и игрок получает реквизит.
 * Через окно: сеть не нужна, ордер заведёт окно, когда игрок его откроет.
 */
export async function createDeposit(userId, amountRub, { method = 'sbp', senderBank = '' } = {}) {
  const env = siciliaEnv();
  if (!payinReady(env)) throw Object.assign(new Error('Способ оплаты временно недоступен'), { code: 'NOT_CONFIGURED' });
  const amount = validAmount(amountRub, env);

  if (env.payin === 'window') {
    const row = insertPayin(userId, amount, null, env);
    trackEvent(userId, 'deposit_created', { amount, method: 'sicilia' });
    return { ...publicOrder(row), url: payUrlFor(row, env) };
  }

  if (!PAYIN_METHODS[method]) throw Object.assign(new Error('Выберите способ оплаты'), { code: 'BAD_METHOD' });
  /*
   * Один открытый перевод на игрока. Второй ордер занял бы второй реквизит,
   * а если первый к тому времени оплачен, отменять его нельзя: деньги ушли.
   * Поэтому новый не заводится, пока старый не закрыт, и игрок видит старый.
   */
  const open = db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payin' AND user_id = ? AND requisite IS NOT NULL
                            ORDER BY id DESC LIMIT 5`).all(userId).find((r) => payable(r));
  if (open) {
    throw Object.assign(new Error('У вас уже есть неоплаченный перевод. Оплатите его или отмените.'),
      { code: 'OPEN_ORDER', order: publicOrder(open) });
  }

  const row = insertPayin(userId, amount, method, env);
  const sum = String(amount);
  const body = {
    currency: 'RUB',
    merchant: Number(env.merchant) || env.merchant,
    invid: row.invid,
    sum: amount,
    bank: PAYIN_METHODS[method],
    signature: signPayin(sum, row.invid, env),
    operation: 'Пополнение',
    external_user_id: String(userId),
  };
  if (env.webapp) body.callback_url = `${env.webapp}/api/webhooks/sicilia`;
  if (DEEPLINK_BANKS.includes(senderBank)) body.sender_bank = senderBank;

  const fail = (status, error) => db.prepare('UPDATE sicilia_orders SET status = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(status, String(error).slice(0, 500), Date.now(), row.id);
  let info;
  try {
    info = await call('POST', '/orders/create', body);
  } catch (err) {
    if (err.code === 'GATEWAY_UNREACHABLE') {
      // Ответа не было: ордер у шлюза мог и создаться. Строку не закрываем,
      // сверка спросит статус и отзовёт его по сроку.
      db.prepare('UPDATE sicilia_orders SET error = ?, updated_at = ? WHERE id = ?').run(err.message, Date.now(), row.id);
      throw err;
    }
    fail('error', err.message);
    if (NO_REQUISITE.test(err.message)) {
      throw Object.assign(new Error('Сейчас нет свободных реквизитов на эту сумму. Попробуйте другую сумму или другой способ.'),
        { code: 'NO_REQUISITE' });
    }
    throw Object.assign(new Error('Не удалось создать платёж. Попробуйте ещё раз чуть позже.'), { code: 'GATEWAY_ERROR' });
  }
  // Ответ обязан быть про наш ордер, а реквизит - настоящим.
  const requisite = info.invid && String(info.invid) !== row.invid ? null : requisiteFrom(info, method);
  if (!requisite) {
    fail('error', 'Шлюз не выдал реквизит');
    try { await call('PUT', '/orders/unclaimed', { order_invid: row.invid, signature: signInvid(row.invid, env) }); } catch { /* нечего отзывать */ }
    throw Object.assign(new Error('Не удалось получить реквизиты. Попробуйте ещё раз.'), { code: 'GATEWAY_ERROR' });
  }
  const paySum = Number(info.sum);
  db.prepare(`UPDATE sicilia_orders SET status = ?, gateway_id = ?, bank = ?, requisite = ?, pay_sum = ?, updated_at = ?
               WHERE id = ?`)
    .run(String(info.status || 'processing'), info.id ?? null, requisite.bankCode, JSON.stringify(requisite),
      Number.isFinite(paySum) && paySum > 0 ? String(paySum) : sum, Date.now(), row.id);
  trackEvent(userId, 'deposit_created', { amount, method: 'sicilia' });
  return publicOrder(db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id));
}

/** Статусы шлюза, после которых ордер уже не оплатят. */
const DEAD = new Set(['cancelled', 'error', 'unclaimed']);

/**
 * Зачисление по ответу check-status: ровно один раз.
 *
 * Сумма - FactSum, если шлюз её прислал (ордер подтвердили вручную или
 * поправили сумму), иначе сумма ордера. Дробная часть отбрасывается:
 * баланс проекта - целые рубли, а округление вверх дарило бы деньги.
 */
export const applyPayinStatus = db.transaction((orderId, info) => {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND kind = 'payin'").get(orderId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  const status = String(info.status || '');
  const now = Date.now();
  db.prepare(`UPDATE sicilia_orders SET status = ?, gateway_id = COALESCE(?, gateway_id),
                     fact_sum = COALESCE(?, fact_sum), updated_at = ? WHERE id = ?`)
    .run(status || row.status, info.id ?? null, info.fact_sum != null ? String(info.fact_sum) : null, now, row.id);

  if (status !== 'completed') return { credited: false, status };
  const already = db.prepare('SELECT 1 FROM balance_transactions WHERE sicilia_order_id = ?').get(row.id);
  if (already) return { credited: false, status, duplicate: true };

  const fact = info.fact_sum != null && info.fact_sum !== '' ? Number(info.fact_sum) : NaN;
  const credited = Math.floor(Number.isFinite(fact) && fact > 0 ? fact : Number(info.sum ?? row.amount_rub));
  if (!(credited > 0)) return { credited: false, status, empty: true };

  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(credited, row.user_id);
  db.prepare(`INSERT INTO balance_transactions (user_id, type, amount, sicilia_order_id, comment, created_at)
              VALUES (?, 'DEPOSIT', ?, ?, ?, ?)`).run(row.user_id, credited, row.id, 'СБП / карта', now);
  db.prepare(`INSERT INTO deposits (user_id, amount, source, comment, created_at)
              VALUES (?, ?, 'sicilia', ?, ?)`).run(row.user_id, credited, 'СБП / карта', now);
  db.prepare('UPDATE sicilia_orders SET credited_rub = ?, paid_at = ? WHERE id = ?').run(credited, now, row.id);
  // Общие последствия любого пополнения: бонус, отыгрыш, прокруты колеса.
  const { bonus } = registerDeposit(row.user_id, credited, 'sicilia');
  return { credited: true, status, amount: credited, bonus, userId: row.user_id, balance: getUserById(row.user_id).balance };
});

/** Спрашивает шлюз о пополнении и применяет ответ. */
export async function confirmPayin(row) {
  const sum = String(row.amount_rub);
  const env = siciliaEnv();
  const info = await call('POST', '/orders/check-status', {
    merchant: Number(env.merchant) || env.merchant, invid: row.invid, signature: signPayin(sum, row.invid, env),
  });
  // Ответ обязан быть про наш ордер: иначе чужой статус лёг бы на нашу строку.
  if (info.invid && String(info.invid) !== row.invid) {
    throw Object.assign(new Error('Шлюз ответил про другой ордер'), { code: 'MISMATCH' });
  }
  return applyPayinStatus(row.id, info);
}

/** Сверка по просьбе игрока: «Я оплатил, проверить». */
export async function refreshDeposit(id, userId) {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND user_id = ? AND kind = 'payin'")
    .get(Number(id), userId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (row.paid_at) return { payment: publicOrder(row), credited: false };
  let result = { credited: false };
  try {
    result = await confirmPayin(row);
  } catch (err) {
    // Ордер ещё не заведён (окно не открывали) - это не ошибка, а «ждём».
    if (err.code !== 'GATEWAY_ERROR' || err.status >= 500) throw err;
  }
  return {
    payment: publicOrder(db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id)),
    credited: result.credited,
  };
}

/** Ссылка на окно заново: игрок закрыл его и вернулся оплатить. */
export function reopenDeposit(id, userId) {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND user_id = ? AND kind = 'payin'")
    .get(Number(id), userId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (!payable(row)) {
    throw Object.assign(new Error('Эта оплата уже закрыта, создайте новую'), { code: 'CLOSED' });
  }
  // Ордер, заведённый через API, оплачивается по реквизиту, окна у него нет.
  return row.requisite ? publicOrder(row) : { ...publicOrder(row), url: payUrlFor(row) };
}

/**
 * Игрок отменил перевод. Сначала спрашиваем статус: если деньги уже пришли,
 * отмена означала бы потерю платежа, и вместо неё платёж зачисляется.
 * Только потом ордер отзывается у шлюза, чтобы реквизит освободился сразу.
 */
export async function cancelDeposit(id, userId) {
  const env = siciliaEnv();
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND user_id = ? AND kind = 'payin'")
    .get(Number(id), userId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (row.paid_at) return { payment: publicOrder(row), credited: false };
  if (!payable(row)) return { payment: publicOrder(row), credited: false };
  try {
    const r = await confirmPayin(row);
    if (r.credited || r.status === 'completed') {
      return { payment: publicOrder(db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id)), credited: r.credited };
    }
  } catch (err) {
    // Шлюз недоступен - не отменяем вслепую: перевод мог уже уйти.
    if (err.code === 'GATEWAY_UNREACHABLE' || err.status >= 500) throw err;
  }
  try {
    await call('PUT', '/orders/unclaimed', { order_invid: row.invid, signature: signInvid(row.invid, env) });
  } catch { /* ордер шлюз уже закрыл сам или не заводил */ }
  db.prepare("UPDATE sicilia_orders SET status = 'unclaimed', updated_at = ? WHERE id = ? AND paid_at IS NULL")
    .run(Date.now(), row.id);
  return { payment: publicOrder(db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id)), credited: false };
}

export function listDeposits(userId, limit = 20) {
  return db.prepare("SELECT * FROM sicilia_orders WHERE user_id = ? AND kind = 'payin' ORDER BY id DESC LIMIT ?")
    .all(userId, limit).map(publicOrder);
}

/* ============================================================
   ВЫПЛАТЫ
   ============================================================ */

/*
 * Список банков шлюза: коды для выплат. Ручка открытая, без ключа, поэтому
 * список берётся у шлюза и кешируется, а не зашивается: банки добавляются.
 */
const BANKS_TTL_MS = 6 * 3600_000;
let banksCache = { at: 0, rows: [] };

export async function banks({ force = false } = {}) {
  if (!force && banksCache.rows.length && Date.now() - banksCache.at < BANKS_TTL_MS) return banksCache.rows;
  const env = siciliaEnv();
  try {
    const res = await fetch(`${env.api}/banks`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.data || [];
    if (list.length) banksCache = { at: Date.now(), rows: list.map((b) => ({ code: b.code, name: b.name })) };
  } catch { /* остаётся прежний список */ }
  return banksCache.rows;
}

/*
 * Банк заявки -> код шлюза. Игрок выбирает банк из нашего списка СБП, и
 * названия там пишутся по-разному («Т-Банк», «Т‑Банк (Тинькофф)»), поэтому
 * сравниваем по нормализованному названию. Не нашли - админ выберет сам.
 */
const BANK_STOP = new Set(['ао', 'пао', 'ооо', 'зао', 'акб', 'кб', 'ак', 'нко', 'банк', 'bank']);
const normBank = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\(.*?\)/g, ' ')
  .split(/[^a-zа-я0-9]+/).filter((w) => w && !BANK_STOP.has(w)).map((w) => w.replace(/банк$/, '')).join('');

/*
 * Названия, которые у нас и у шлюза записаны по-разному. Только точные пары:
 * «похожее» сравнение однажды отдало «Т-Банк» Татсоцбанку, а выплата по СБП
 * в чужой банк - это деньги, ушедшие не тому человеку.
 */
const BANK_ALIASES = {
  'т-банк': 'tinkoff', 'тинькофф': 'tinkoff', 'втб': 'vtb', 'сбер': 'sberbank', 'мтс-банк': 'mts',
  'почта банк': 'pochta-bank', 'промсвязьбанк': 'promsvyazbank', 'псб': 'promsvyazbank',
  'хоум кредит': 'home-credit', 'дом.рф': 'dom-rf', 'банк дом.рф': 'dom-rf', 'открытие': 'otkitie',
};

/** Код банка шлюза по названию из заявки: только точное совпадение, иначе null. */
export function matchBank(name, list) {
  const raw = String(name || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!raw) return null;
  const alias = BANK_ALIASES[raw];
  if (alias && list.some((b) => b.code === alias)) return alias;
  const key = normBank(raw);
  const exact = key && list.filter((b) => normBank(b.name) === key);
  // Два банка с одним нормализованным именем - не угадываем, выберет админ.
  return exact && exact.length === 1 ? exact[0].code : null;
}

/**
 * Отправка заявки на вывод через шлюз (кнопка в панели).
 *
 * Сначала заявка переводится в работу (startPayout): с этого момента её
 * нельзя отменить ни игроку, ни поддержке, и деньги не уйдут дважды. Если
 * шлюз отказал, заявка остаётся в работе с текстом ошибки: её можно
 * отправить снова или перевести руками и закрыть, как раньше.
 */
export async function sendPayout(adminId, payoutId, bankCode) {
  const env = siciliaEnv();
  if (!isConfigured(env)) throw Object.assign(new Error('Шлюз не настроен'), { code: 'NOT_CONFIGURED' });
  const payout = payoutForGateway(payoutId);
  if (!payout) throw Object.assign(new Error('Заявка не найдена'), { code: 'NOT_FOUND' });
  if (payout.method !== 'sbp' && payout.method !== 'card') {
    throw Object.assign(new Error('Через шлюз уходят только выводы на карту и по СБП'), { code: 'BAD_METHOD' });
  }
  const active = db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND payout_id = ?
                              AND status NOT IN ('cancelled', 'error', 'unclaimed') ORDER BY id DESC`).get(payout.id);
  if (active) throw Object.assign(new Error('Заявка уже отправлена в шлюз'), { code: 'ALREADY' });
  const bank = String(bankCode || '').trim();
  if (!bank) throw Object.assign(new Error('Выберите банк получателя'), { code: 'BAD_BANK' });

  if (payout.status === 'pending') startPayout(adminId, payout.id, 'Отправлено через Sicilia');
  else if (payout.status !== 'processing') throw Object.assign(new Error('Заявка уже обработана'), { code: 'RESOLVED' });

  const requisite = payout.method === 'sbp'
    ? String(payout.phone || '').replace(/\D/g, '')
    : String(payout.card_number || '').replace(/\D/g, '');
  const now = Date.now();
  const info = db.prepare(`INSERT INTO sicilia_orders (kind, user_id, invid, amount_rub, payout_id, method, bank,
                                                       sent_by, created_at, updated_at)
                           VALUES ('payout', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(payout.user_id, `tmp-${now}-${Math.random()}`, payout.amount, payout.id, payout.method, bank, adminId, now, now);
  const invid = makeInvid('lbp', info.lastInsertRowid);
  db.prepare('UPDATE sicilia_orders SET invid = ? WHERE id = ?').run(invid, info.lastInsertRowid);

  const sum = String(payout.amount);
  try {
    const res = await call('POST', '/payout/orders', {
      merchant: env.merchant, invid, sum, requisite_num: requisite, bank,
      method: payout.method === 'sbp' ? 'sbp' : 'card', signature: signPayout(sum, invid, env),
    });
    if (res.duplicate) throw Object.assign(new Error('Шлюз считает заявку повтором'), { code: 'DUPLICATE' });
    db.prepare('UPDATE sicilia_orders SET status = ?, gateway_id = ?, updated_at = ? WHERE id = ?')
      .run(res.status || 'opened', res.id ?? null, Date.now(), info.lastInsertRowid);
  } catch (err) {
    db.prepare("UPDATE sicilia_orders SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
      .run(String(err.message).slice(0, 300), Date.now(), info.lastInsertRowid);
    throw err;
  }
  return gatewayPayout(payout.id);
}

/** Ответ check-status выплаты: completed закрывает заявку, cancelled - нет. */
export const applyPayoutStatus = db.transaction((orderId, info) => {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND kind = 'payout'").get(orderId);
  if (!row) throw Object.assign(new Error('Выплата не найдена'), { code: 'NOT_FOUND' });
  const status = String(info.status || row.status);
  const check = Array.isArray(info.transfer_check) ? info.transfer_check[0] : info.transfer_check;
  db.prepare(`UPDATE sicilia_orders SET status = ?, check_url = COALESCE(?, check_url), updated_at = ? WHERE id = ?`)
    .run(status, check || null, Date.now(), row.id);
  if (status !== 'completed' || row.paid_at) return { closed: false, status };
  db.prepare('UPDATE sicilia_orders SET paid_at = ? WHERE id = ?').run(Date.now(), row.id);
  const payout = db.prepare('SELECT status FROM payouts WHERE id = ?').get(row.payout_id);
  // Заявку могли закрыть руками раньше колбэка - второй раз не закрываем.
  if (payout?.status === 'processing') {
    completePayout(row.sent_by, row.payout_id, check ? `Sicilia, чек: ${check}` : 'Выплачено через Sicilia');
  }
  return { closed: true, status, payoutId: row.payout_id };
});

export async function confirmPayout(row) {
  const env = siciliaEnv();
  const sum = String(row.amount_rub);
  const info = await call('POST', '/payout/orders/check-status', {
    merchant: env.merchant, invid: row.invid, signature: signPayout(sum, row.invid, env),
  });
  if (info.invid && String(info.invid) !== row.invid) {
    throw Object.assign(new Error('Шлюз ответил про другую выплату'), { code: 'MISMATCH' });
  }
  return applyPayoutStatus(row.id, info);
}

/** Последняя отправка заявки в шлюз - для панели. */
export function gatewayPayout(payoutId) {
  const r = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payout' AND payout_id = ? ORDER BY id DESC")
    .get(payoutId);
  return r ? { status: r.status, bank: r.bank, checkUrl: r.check_url, error: r.error, sentAt: r.created_at } : null;
}

export function gatewayPayouts(ids) {
  const out = {};
  for (const id of ids) { const g = gatewayPayout(id); if (g) out[id] = g; }
  return out;
}

/** Баланс мерчанта: из него уходят выплаты. */
export async function merchantBalance() {
  const env = siciliaEnv();
  const ts = String(Math.floor(Date.now() / 1000));
  return call('GET', `/external/merchants/${encodeURIComponent(env.merchant)}/balance`, undefined, {
    headers: { timestamp: ts, signature: sha256(ts, env.merchant, env.key) },
  });
}

/* ============================================================
   КОЛБЭК И СВЕРКА
   ============================================================ */

/**
 * Колбэк шлюза: подпись проверена в ручке, здесь - перепроверка статуса.
 * Возвращает то, что случилось, чтобы ручка могла сообщить игроку.
 */
export async function handleCallback(body) {
  if (body.order_type === 'payout') {
    const row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payout' AND invid = ?").get(String(body.invid || ''));
    if (!row) return { unknown: true };
    return { kind: 'payout', ...(await confirmPayout(row)) };
  }
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payin' AND invid = ?").get(String(body.InvId || ''));
  if (!row) return { unknown: true };
  if (row.paid_at) return { kind: 'payin', credited: false, duplicate: true };
  return { kind: 'payin', ...(await confirmPayin(row)) };
}

/*
 * Сверка по расписанию. Колбэк может не дойти (сервер перезапускался, сеть),
 * и тогда без сверки деньги игрока висели бы до ручного разбора. Заодно
 * просроченные ордера отзываются: шлюз прямо советует это делать - реквизит
 * освобождается раньше и конверсия растёт.
 */
export const RECONCILE_MS = 5 * 60_000;
const RECONCILE_GRACE_MS = 2 * 60_000;

export async function reconcile(now = Date.now()) {
  const env = siciliaEnv();
  if (!isConfigured(env)) return { checked: 0 };
  let checked = 0;
  const open = db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NULL
                            AND status NOT IN ('cancelled', 'error', 'unclaimed', 'expired') AND created_at < ?`)
    .all(now - RECONCILE_GRACE_MS);
  for (const row of open) {
    checked++;
    let status = null;
    try { status = (await confirmPayin(row)).status; } catch (err) {
      if (err.code === 'GATEWAY_UNREACHABLE') break;
    }
    if (status !== 'completed' && now > (row.expires_at || row.created_at + env.ttlMs)) {
      // Не оплачен за отведённое время - отзываем, если окно его завело.
      try {
        await call('PUT', '/orders/unclaimed', { order_invid: row.invid, signature: signInvid(row.invid, env) });
      } catch { /* ордера могло и не быть: окно не открывали */ }
      db.prepare("UPDATE sicilia_orders SET status = 'expired', updated_at = ? WHERE id = ? AND paid_at IS NULL")
        .run(Date.now(), row.id);
    }
  }
  const sent = db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND paid_at IS NULL
                            AND status IN ('opened', 'in_progress')`).all();
  for (const row of sent) {
    checked++;
    try { await confirmPayout(row); } catch (err) { if (err.code === 'GATEWAY_UNREACHABLE') break; }
  }
  return { checked };
}

export function startReconcile(onCredited) {
  if (!isConfigured()) return;
  setInterval(async () => {
    try {
      const before = new Set(db.prepare("SELECT id FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NOT NULL").all().map((r) => r.id));
      await reconcile();
      const fresh = db.prepare("SELECT id, user_id FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NOT NULL").all()
        .filter((r) => !before.has(r.id));
      for (const r of fresh) onCredited?.(r.user_id);
    } catch (err) {
      console.error('[sicilia] сверка:', err.message);
      alert('sicilia:reconcile', `Sicilia: сверка платежей не прошла (${err.message}). Потерянные колбэки не досчитываются.`);
    }
  }, RECONCILE_MS).unref();
}
