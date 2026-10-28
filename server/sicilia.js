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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  db, getUserById, registerDeposit, trackEvent, payoutForGateway, startPayout, completePayout,
  completePayoutPartial, unstartPayout, moneyTx, ledgerLink, logAdmin, assertDepositAllowed, setting,
} from './db.js';

/* Журнал balance_transactions общий для шлюзов и создаётся в db.js. */
import { alert, countError } from './ops.js';

/* Терминал мобильной коммерции и её предел суммы (см. ниже, у mkReady). */
export const MK = 'mk';
const MK_MAX_RUB = 15_000;

/*
 * Настройки читаются при каждом вызове, а не при загрузке модуля: их правят в
 * .env чаще, чем код, а тестам нужно подставлять свои.
 */
export function siciliaEnv(terminal = 'main') {
  const env = {
    terminal: terminal === MK ? MK : 'main',
    api: (process.env.SICILIA_API_URL || 'https://api.sicilia.ink/api').replace(/\/+$/, ''),
    payUrl: (process.env.SICILIA_PAY_URL || '').replace(/\/+$/, ''),
    payin: String(process.env.SICILIA_PAYIN || 'h2h').trim().toLowerCase() === 'window' ? 'window' : 'h2h',
    merchant: String(process.env.SICILIA_MERCHANT || '').trim(),
    login: String(process.env.SICILIA_LOGIN || '').trim(),
    key: String(process.env.SICILIA_API_KEY || '').trim(),
    min: Number(process.env.SICILIA_MIN || 100),
    max: Number(process.env.SICILIA_MAX || 300_000),
    // Срок реквизита после выдачи: столько идёт таймер в кассе (решение заказчика).
    ttlMs: Number(process.env.SICILIA_ORDER_TTL_MIN || 10) * 60_000,
    callbackIps: String(process.env.SICILIA_CALLBACK_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
    webapp: String(process.env.SITE_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, ''),
    mkMax: Number(process.env.SICILIA_MK_MAX || MK_MAX_RUB),
    mkBank: String(process.env.SICILIA_MK_BANK || 'mobcom').trim(),
  };
  /*
   * Мобильная коммерция - отдельный терминал того же шлюза: свой мерчант,
   * логин и ключ, адрес API и всё остальное общие. Подписи считаются так же,
   * просто его ключами.
   */
  if (env.terminal === MK) {
    env.merchant = String(process.env.SICILIA_MK_MERCHANT || '').trim();
    env.login = String(process.env.SICILIA_MK_LOGIN || '').trim();
    env.key = String(process.env.SICILIA_MK_API_KEY || '').trim();
  }
  return env;
}

/*
 * МОБИЛЬНАЯ КОММЕРЦИЯ - ЗАПАСНОЙ ПУТЬ, А НЕ ТРЕТИЙ СПОСОБ (решение заказчика,
 * октябрь 2026). Игрок по-прежнему выбирает «СБП» или «Карта», и ордер сначала
 * уходит в основной терминал. Только если у того нет свободного реквизита,
 * тот же платёж заводится в терминале мобильной коммерции: игрок пополняет
 * баланс телефона у оператора связи. Выше MK_MAX_RUB этот путь не пробуется:
 * у мобильной коммерции такой предел.
 */
/** Окружение терминала, через который заведён ордер. */
const envFor = (row) => siciliaEnv(row?.terminal === MK ? MK : 'main');

/** Мобильная коммерция настроена: свои мерчант, логин и ключ. */
export function mkReady() {
  return isConfigured(siciliaEnv(MK));
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

  /*
   * Споры по пополнениям: игрок перевёл, а деньги не пришли. Запись живёт у
   * нас всегда, даже если до шлюза дело не дошло: по ней видно, кто и когда
   * жаловался и чем кончилось. Статусы:
   *   new      игрок сообщил, ждёт сотрудника;
   *   sent     апелляция открыта у шлюза, ждём его решения;
   *   won      деньги зачислены (любым путём);
   *   lost     шлюз закрыл апелляцию без зачисления;
   *   declined сотрудник отказал, игрок видит причину.
   */
  CREATE TABLE IF NOT EXISTS sicilia_disputes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL REFERENCES sicilia_orders(id),
    user_id       INTEGER NOT NULL REFERENCES users(id),
    source        TEXT    NOT NULL,          -- 'player' | 'staff'
    status        TEXT    NOT NULL DEFAULT 'new',
    comment       TEXT,
    receipt       TEXT,                      -- имя файла чека в receiptDir()
    appeal_id     INTEGER,
    appeal_status TEXT,
    appeal_reason TEXT,
    fact_sum      TEXT,
    staff_id      INTEGER,
    staff_note    TEXT,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    sent_at       INTEGER,
    closed_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_dispute_order ON sicilia_disputes(order_id);
  CREATE INDEX IF NOT EXISTS idx_dispute_status ON sicilia_disputes(status);
`);

/*
 * Реквизит ордера, выданный шлюзом (JSON), и до какого времени он наш. Нужен,
 * чтобы игрок, закрывший кассу, вернулся к тому же переводу: второй ордер
 * занял бы второй реквизит, а оплаченный первый пришлось бы искать.
 */
const orderCols = db.prepare('PRAGMA table_info(sicilia_orders)').all().map((c) => c.name);
if (!orderCols.includes('late_checked_at')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN late_checked_at INTEGER');
if (!orderCols.includes('requisite')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN requisite TEXT');
if (!orderCols.includes('pay_sum')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN pay_sum TEXT');
if (!orderCols.includes('expires_at')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN expires_at INTEGER');
/*
 * Комиссия шлюза на момент сделки (настройки панели, группа Sicilia). Пишется
 * при зачислении и при закрытии выплаты: сверка с шлюзом (finance.js) считает
 * долг по условиям, действовавшим тогда, а не по сегодняшним.
 */
if (!orderCols.includes('fee_pct')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN fee_pct REAL');
if (!orderCols.includes('fee_fixed')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN fee_fixed INTEGER');
/*
 * Терминал шлюза: NULL - основной, 'mk' - мобильная коммерция. У терминалов
 * разные ключи, и статус, отзыв и апелляция ордера идут ключами того
 * терминала, где ордер заведён: чужой подписи шлюз не примет.
 */
if (!orderCols.includes('terminal')) db.exec('ALTER TABLE sicilia_orders ADD COLUMN terminal TEXT');

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
export function verifyCallback(body, env = null) {
  if (env) return verifyWith(body, env);
  // Колбэк сам не говорит, с какого он терминала: подходит подпись любого
  // из наших. Выплаты идут только через основной.
  return verifyWith(body, siciliaEnv()) || (body?.order_type !== 'payout' && verifyWith(body, siciliaEnv(MK)));
}

function verifyWith(body, env) {
  if (!body || typeof body !== 'object' || !env.key) return false;
  if (body.order_type === 'payout') {
    return sameHex(body.signature, sha256(env.login, body.sum, body.invid, env.key));
  }
  if (isAppealCallback(body)) return sameHex(body.signature, signInvid(String(body.invid), env));
  return sameHex(body.SignatureValue, sha256(body.OutSum, body.InvId, env.key));
}

/*
 * Колбэк закрытия апелляции приходит без order_type и без полей пополнения
 * (InvId, OutSum): только invid, status, reason, fact_sum и подпись
 * sha256('login:invid:apiKey'). Раньше он проверялся как колбэк пополнения и
 * отвергался, а ордер, зачтённый по апелляции позже срока сверки, не
 * зачислялся никогда: игрок заплатил, шлюз подтвердил, а у нас пусто.
 */
export function isAppealCallback(body) {
  return Boolean(body && !body.order_type && body.invid && body.InvId === undefined && body.signature);
}

export function callbackIpAllowed(ip, env = siciliaEnv()) {
  if (!env.callbackIps.length) return true;
  return env.callbackIps.includes(String(ip || '').replace(/^::ffff:/, ''));
}

/* ============================================================
   ЗАПРОСЫ
   ============================================================ */

const TIMEOUT_MS = 20_000;

async function call(method, path, body, { headers = {}, env = siciliaEnv() } = {}) {
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
      const where = env.terminal === MK ? 'Sicilia, мобильная коммерция' : 'Sicilia';
      alert(`sicilia:auth:${env.terminal}`, `${where} отказывает (${res.status}): ${message}. Проверьте логин, ключ и белый список IP сервера у шлюза.`);
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
  const d = lastDispute(r.id);
  let requisite = null;
  if (r.requisite && payable(r)) {
    try { requisite = JSON.parse(r.requisite); } catch { requisite = null; }
  }
  return {
    id: r.id,
    // Номер платежа для поддержки: тот же, что видит шлюз, по нему сотрудник
    // находит оплату у себя и у Sicilia одним поиском.
    number: r.invid,
    amount: r.amount_rub,
    paySum: r.pay_sum != null ? Number(r.pay_sum) : r.amount_rub,
    method: r.method || null,
    status: r.status,
    credited: r.credited_rub,
    createdAt: r.created_at,
    expiresAt: r.expires_at || null,
    paidAt: r.paid_at,
    // Ордер дошёл до шлюза (окно открывали или реквизит выдан): только такие
    // показываются игроку в «Оплатах в ожидании», брошенные до окна там лишние.
    opened: r.gateway_id != null,
    dispute: d ? { status: d.status, note: d.staff_note || d.appeal_reason || null, createdAt: d.created_at } : null,
    requisite,
  };
}

function lastDispute(orderId) {
  return db.prepare('SELECT * FROM sicilia_disputes WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId) || null;
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
  assertDepositAllowed(userId, amount);
  const now = Date.now();
  const info = db.prepare(`INSERT INTO sicilia_orders (kind, user_id, invid, amount_rub, method, terminal, expires_at, created_at, updated_at)
                           VALUES ('payin', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, `tmp-${now}-${Math.random()}`, amount, method, env.terminal === MK ? MK : null, now + env.ttlMs, now, now);
  const invid = makeInvid('lb', info.lastInsertRowid);
  db.prepare('UPDATE sicilia_orders SET invid = ? WHERE id = ?').run(invid, info.lastInsertRowid);
  return db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(info.lastInsertRowid);
}

/** Из ответа orders/create - только то, что нужно игроку для перевода. */
function requisiteFrom(info, method, env = siciliaEnv()) {
  const card = info.card || {};
  /*
   * Мобильная коммерция: реквизит - номер телефона, а «банк» - оператор
   * связи (beeline, megafon, mts-phone...). Игрок пополняет баланс этого
   * номера, и экран кассы рисует оператора вместо банковской карты.
   */
  const mobile = env.terminal === MK || info.is_mobcom === true;
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
    mobile: mobile || undefined,
  };
  if (mobile) return req.phone ? req : null;
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

  try {
    return await placeOrder(userId, amount, method, env, { bank: PAYIN_METHODS[method], senderBank });
  } catch (err) {
    // Запасной путь - только когда у основного терминала нет реквизита. Другие
    // отказы (шлюз лёг, ключ не принят) мобильная коммерция не лечит.
    if (err.code !== 'NO_REQUISITE' || amount > env.mkMax || !mkReady()) throw err;
    try {
      return await placeOrder(userId, amount, method, siciliaEnv(MK), { bank: env.mkBank });
    } catch {
      // Игроку важно одно: реквизита сейчас нет. Почему его не дала мобильная
      // коммерция, видно в строке ордера и в оповещениях служебного бота.
      throw err;
    }
  }
}

/** Заводит ордер в одном терминале и отдаёт игроку реквизит. */
async function placeOrder(userId, amount, method, env, { bank, senderBank = '' }) {
  const row = insertPayin(userId, amount, method, env);
  const sum = String(amount);
  const body = {
    currency: 'RUB',
    merchant: Number(env.merchant) || env.merchant,
    invid: row.invid,
    sum: amount,
    bank,
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
    info = await call('POST', '/orders/create', body, { env });
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
  const requisite = info.invid && String(info.invid) !== row.invid ? null : requisiteFrom(info, method, env);
  if (!requisite) {
    fail('error', 'Шлюз не выдал реквизит');
    try { await unclaimPayin(row, env); } catch { /* нечего отзывать */ }
    throw Object.assign(new Error('Не удалось получить реквизиты. Попробуйте ещё раз.'), { code: 'GATEWAY_ERROR' });
  }
  const paySum = Number(info.sum);
  db.prepare(`UPDATE sicilia_orders SET status = ?, gateway_id = ?, bank = ?, requisite = ?, pay_sum = ?, updated_at = ?
               WHERE id = ?`)
    .run(String(info.status || 'processing'), info.id ?? null, requisite.bankCode, JSON.stringify(requisite),
      Number.isFinite(paySum) && paySum > 0 ? String(paySum) : sum, Date.now(), row.id);
  trackEvent(userId, 'deposit_created', { amount, method: env.terminal === MK ? 'mobcom' : 'sicilia' });
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
export const applyPayinStatus = moneyTx('deposit', (orderId, info) => {
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
  const mk = row.terminal === MK;
  const label = mk ? 'Мобильная коммерция' : 'СБП / карта';

  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(credited, row.user_id);
  ledgerLink('sicilia_orders', row.id);
  db.prepare(`INSERT INTO balance_transactions (user_id, type, amount, sicilia_order_id, comment, created_at)
              VALUES (?, 'DEPOSIT', ?, ?, ?, ?)`).run(row.user_id, credited, row.id, label, now);
  db.prepare(`INSERT INTO deposits (user_id, amount, source, comment, created_at)
              VALUES (?, ?, 'sicilia', ?, ?)`).run(row.user_id, credited, label, now);
  // У мобильной коммерции своя комиссия: оператор связи берёт больше банка.
  const feeKey = mk ? 'sicilia_mk_fee_pct' : 'sicilia_payin_fee_pct';
  db.prepare('UPDATE sicilia_orders SET credited_rub = ?, paid_at = ?, fee_pct = ?, fee_fixed = 0 WHERE id = ?')
    .run(credited, now, Number(setting(feeKey)) || 0, row.id);
  // Общие последствия любого пополнения: бонус, отыгрыш, прокруты колеса.
  const { bonus } = registerDeposit(row.user_id, credited, 'sicilia');
  // Деньги пришли - открытый спор по этой оплате закрыт, каким бы путём ни
  // пришло зачисление: колбэком, сверкой или решением по апелляции.
  db.prepare(`UPDATE sicilia_disputes SET status = 'won', fact_sum = COALESCE(?, fact_sum), closed_at = ?, updated_at = ?
               WHERE order_id = ? AND status IN ('new', 'sent', 'lost')`)
    .run(info.fact_sum != null ? String(info.fact_sum) : null, now, now, row.id);
  return { credited: true, status, amount: credited, bonus, userId: row.user_id, balance: getUserById(row.user_id).balance };
});

/** Спрашивает шлюз о пополнении. */
async function askPayin(row) {
  const sum = String(row.amount_rub);
  const env = envFor(row);
  const info = await call('POST', '/orders/check-status', {
    merchant: Number(env.merchant) || env.merchant, invid: row.invid, signature: signPayin(sum, row.invid, env),
  }, { env });
  // Ответ обязан быть про наш ордер: иначе чужой статус лёг бы на нашу строку.
  if (info.invid && String(info.invid) !== row.invid) {
    throw Object.assign(new Error('Шлюз ответил про другой ордер'), { code: 'MISMATCH' });
  }
  return info;
}

/**
 * Спрашивает шлюз о пополнении и применяет ответ.
 *
 * factHint - FactSum из колбэка. Сумму с изменением шлюз присылает в колбэке,
 * а ответ check-status её может и не содержать. Подпись колбэка FactSum не
 * покрывает, поэтому подсказка берётся только когда шлюз сам, своим
 * ответом, подтвердил «completed», и только если в ответе суммы нет.
 */
export async function confirmPayin(row, factHint = null) {
  const info = await askPayin(row);
  if (String(info.status) === 'completed' && (info.fact_sum == null || info.fact_sum === '') && validSum(factHint)) {
    info.fact_sum = factHint;
  }
  return applyPayinStatus(row.id, info);
}

const validSum = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

/*
 * Отзыв ордера пополнения. В документации шлюза этот путь единственный
 * записан с /api ({API_URL}/api/orders/unclaimed), остальные без. Какой из
 * двух верен на их сервере, станет ясно только живьём, поэтому пробуем оба:
 * 404 на первом значит «не тот путь», а не «нет ордера».
 */
async function unclaimPayin(row, env = envFor(row)) {
  const body = { order_invid: row.invid, signature: signInvid(row.invid, env) };
  try {
    return await call('PUT', '/orders/unclaimed', body, { env });
  } catch (err) {
    if (err.code !== 'GATEWAY_ERROR' || (err.status !== 404 && err.status !== 405)) throw err;
    return call('PUT', '/api/orders/unclaimed', body, { env });
  }
}

/**
 * Отмена пополнения с нашей стороны (кнопка в панели): игрок передумал,
 * оплата задвоилась, ордер завис. Отзываем у шлюза, переспрашиваем статус и
 * закрываем у себя. Если шлюз успел ордер оплатить, деньги зачислятся, а не
 * пропадут: отмена оплаченного не отменяет.
 */
export async function staffCancelDeposit(staffId, orderId) {
  const env = siciliaEnv();
  if (!isConfigured(env)) throw Object.assign(new Error('Шлюз не настроен'), { code: 'NOT_CONFIGURED' });
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND kind = 'payin'").get(Number(orderId));
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (row.paid_at) throw Object.assign(new Error('Платёж уже зачислен'), { code: 'PAID' });
  let error = null;
  try { await unclaimPayin(row); } catch (err) {
    if (err.code === 'GATEWAY_UNREACHABLE') throw err;
    error = err.message;
  }
  let result = { credited: false };
  try { result = await confirmPayin(row); } catch { /* ордера у шлюза нет: окно не открывали */ }
  const after = db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id);
  if (!after.paid_at && !DEAD.has(after.status)) {
    db.prepare("UPDATE sicilia_orders SET status = 'unclaimed', error = ?, updated_at = ? WHERE id = ?")
      .run(error, Date.now(), row.id);
  }
  logAdmin(staffId, row.user_id, 'sicilia_payin_cancel', { amount: row.amount_rub, note: row.invid });
  return { ...result, status: db.prepare('SELECT status FROM sicilia_orders WHERE id = ?').get(row.id).status, error };
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
  try { await unclaimPayin(row); } catch { /* ордер шлюз уже закрыл сам или не заводил */ }
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
  // Прошлая отправка с ошибкой могла дойти до шлюза (обрыв по таймауту):
  // прежде чем слать заново, спрашиваем, нет ли у него того ордера.
  for (const prev of db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND payout_id = ? AND status = 'error'`).all(payout.id)) {
    await settleErroredPayout(prev);
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

/**
 * Ответ check-status выплаты: completed закрывает заявку, cancelled - нет.
 *
 * Неполное подтверждение: трейдер перевёл меньше заявки, и шлюз присылает
 * fact_sum. Заявка закрывается выплаченной суммой, остаток возвращается
 * игроку (completePayoutPartial). Больше заявки не бывает: такую сумму
 * не применяем и зовём человека.
 */
export const applyPayoutStatus = db.transaction((orderId, info) => {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND kind = 'payout'").get(orderId);
  if (!row) throw Object.assign(new Error('Выплата не найдена'), { code: 'NOT_FOUND' });
  const status = String(info.status || row.status);
  const check = Array.isArray(info.transfer_check) ? info.transfer_check[0] : info.transfer_check;
  const fact = validSum(info.fact_sum) ? Math.floor(Number(info.fact_sum)) : null;
  db.prepare(`UPDATE sicilia_orders SET status = ?, check_url = COALESCE(?, check_url),
                     fact_sum = COALESCE(?, fact_sum), updated_at = ? WHERE id = ?`)
    .run(status, check || null, fact != null ? String(info.fact_sum) : null, Date.now(), row.id);
  if (status === 'cancelled' && row.status !== 'cancelled') {
    alert(`sicilia:payout-cancel:${row.id}`, `Sicilia отменила выплату ${row.invid} (заявка #${row.payout_id}, ${row.amount_rub} ₽). `
      + 'Заявка в работе: отправьте заново или верните в ожидание.');
  }
  if (status !== 'completed' || row.paid_at) return { closed: false, status };
  db.prepare('UPDATE sicilia_orders SET paid_at = ?, fee_pct = ?, fee_fixed = ? WHERE id = ?')
    .run(Date.now(), Number(setting('sicilia_payout_fee_pct')) || 0, Number(setting('sicilia_payout_fee_fixed')) || 0, row.id);
  const payout = db.prepare('SELECT status, amount FROM payouts WHERE id = ?').get(row.payout_id);
  // Заявку могли закрыть руками раньше колбэка - второй раз не закрываем.
  if (payout?.status !== 'processing') return { closed: true, status, payoutId: row.payout_id };
  const note = check ? `Sicilia, чек: ${check}` : 'Выплачено через Sicilia';
  if (fact != null && fact < payout.amount) {
    const r = completePayoutPartial(row.sent_by, row.payout_id, fact,
      `${note}. Выплачено ${fact} из ${payout.amount} ₽, остаток ${payout.amount - fact} ₽ вернулся на баланс`);
    return { closed: true, status, payoutId: row.payout_id, partial: true, paid: fact, refund: r.refund, userId: r.userId };
  }
  if (fact != null && fact > payout.amount) {
    alert(`sicilia:payout-over:${row.id}`, `Sicilia сообщает выплату ${fact} ₽ по заявке #${row.payout_id} на ${payout.amount} ₽. `
      + 'Заявка закрыта суммой заявки, разницу проверьте со шлюзом.');
  }
  completePayout(row.sent_by, row.payout_id, note);
  return { closed: true, status, payoutId: row.payout_id };
});

/* factHint - fact_sum из колбэка, по тем же правилам, что у пополнения. */
export async function confirmPayout(row, factHint = null) {
  const env = siciliaEnv();
  const sum = String(row.amount_rub);
  const info = await call('POST', '/payout/orders/check-status', {
    merchant: env.merchant, invid: row.invid, signature: signPayout(sum, row.invid, env),
  });
  if (info.invid && String(info.invid) !== row.invid) {
    throw Object.assign(new Error('Шлюз ответил про другую выплату'), { code: 'MISMATCH' });
  }
  if (String(info.status) === 'completed' && !validSum(info.fact_sum) && validSum(factHint)) info.fact_sum = factHint;
  return applyPayoutStatus(row.id, info);
}

/**
 * Отзыв выплаты из шлюза (кнопка в панели). Шлюз отзывает только ордер,
 * который ещё не взял трейдер (opened). После отзыва статус переспрашивается:
 * «в работе» снимается с заявки, только когда шлюз сам подтвердил отмену.
 */
export async function recallPayout(staffId, payoutId) {
  const env = siciliaEnv();
  if (!isConfigured(env)) throw Object.assign(new Error('Шлюз не настроен'), { code: 'NOT_CONFIGURED' });
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payout' AND payout_id = ? ORDER BY id DESC")
    .get(Number(payoutId));
  if (!row) throw Object.assign(new Error('Заявка в шлюз не отправлялась'), { code: 'NOT_FOUND' });
  if (row.paid_at || row.status === 'completed') throw Object.assign(new Error('Шлюз уже выплатил'), { code: 'PAID' });
  if (!DEAD.has(row.status)) {
    await call('PATCH', '/payout/orders/unclaimed', {
      merchant: env.merchant, invid: row.invid, signature: signPayout(String(row.amount_rub), row.invid, env),
    });
  }
  const r = await confirmPayout(row);
  logAdmin(staffId, row.user_id, 'sicilia_payout_recall', { amount: row.amount_rub, note: row.invid });
  return { ...r, ...(await releasePayout(staffId, payoutId)) };
}

/*
 * Отправка с ошибкой: дошёл ли ордер до шлюза? Ответ шлюза с ордером - его
 * статус становится нашим; отказ «не найдено» (4xx) - ордера нет, ошибка
 * остаётся; шлюз молчит - решать нельзя, наверх уходит ошибка.
 */
async function settleErroredPayout(row) {
  try { await confirmPayout(row); } catch (err) {
    if (err.code !== 'GATEWAY_ERROR' || err.status >= 500) throw err;
  }
  return db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id);
}

/**
 * Вернуть заявку в «ожидают», когда шлюз её выплату отменил: после отмены
 * трейдером (возврат в общий пул) или нашего отзыва. Только при отменённом
 * у шлюза ордере: иначе по отправленному переводу вернули бы деньги.
 */
export async function releasePayout(staffId, payoutId) {
  let row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payout' AND payout_id = ? ORDER BY id DESC")
    .get(Number(payoutId));
  if (row?.status === 'error') row = await settleErroredPayout(row);
  if (!row || !DEAD.has(row.status) || row.paid_at) {
    throw Object.assign(new Error('Шлюз не подтвердил отмену выплаты'), { code: 'NOT_CANCELLED' });
  }
  const payout = db.prepare('SELECT status FROM payouts WHERE id = ?').get(Number(payoutId));
  if (payout?.status !== 'processing') return { payoutStatus: payout?.status || null };
  unstartPayout(staffId, Number(payoutId), `Выплата через Sicilia отменена (${row.status}), заявка снова ждёт решения`);
  return { payoutStatus: 'pending' };
}

/** Последняя отправка заявки в шлюз - для панели. */
export function gatewayPayout(payoutId) {
  const r = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payout' AND payout_id = ? ORDER BY id DESC")
    .get(payoutId);
  return r ? {
    status: r.status, bank: r.bank, checkUrl: r.check_url, error: r.error, sentAt: r.created_at,
    // Оба номера: наш (invid) шлюз знает по запросам, свой (id) - по кабинету.
    invid: r.invid, gatewayId: r.gateway_id, factSum: r.fact_sum,
  } : null;
}

export function gatewayPayouts(ids) {
  const out = {};
  for (const id of ids) { const g = gatewayPayout(id); if (g) out[id] = g; }
  return out;
}

/** Баланс мерчанта: из него уходят выплаты. */
export async function merchantBalance(env = siciliaEnv()) {
  const ts = String(Math.floor(Date.now() / 1000));
  return call('GET', `/external/merchants/${encodeURIComponent(env.merchant)}/balance`, undefined, {
    headers: { timestamp: ts, signature: sha256(ts, env.merchant, env.key) }, env,
  });
}

/*
 * Проверка логина терминала для отчёта настройки (deploy/setup.sh). Баланс
 * спрашивается без логина, поэтому неверный логин он не ловит: так и вышло
 * с почтой вместо логина мерчанта, и каждое пополнение падало с «Invalid
 * signature». Здесь заводится ордер на заведомо невозможный 1 ₽: шлюз
 * проверяет подпись первой, и ответ «Invalid signature» значит неверный
 * логин, а отказ по сумме или «нет реквизитов» - что подпись принята.
 */
export async function probeSignature(terminal = 'main') {
  const env = siciliaEnv(terminal);
  if (!isConfigured(env)) return { ok: false, reason: 'ключи не заданы' };
  const invid = `lb-probe-${Date.now().toString(36)}`;
  try {
    await call('POST', '/orders/create', {
      currency: 'RUB', merchant: Number(env.merchant) || env.merchant, invid, sum: 1,
      bank: terminal === MK ? env.mkBank : 'sbp', signature: signPayin('1', invid, env), operation: 'Пополнение',
    }, { env });
    // Ордер на 1 ₽ всё же создан - подпись верна; отзываем, чтобы не висел.
    try { await call('PUT', '/orders/unclaimed', { order_invid: invid, signature: signInvid(invid, env) }, { env }); } catch { /* сам истечёт */ }
    return { ok: true };
  } catch (err) {
    if (/signature/i.test(err.message)) return { ok: false, reason: 'логин или ключ не подходят (Invalid signature)' };
    if (/offline/i.test(err.message)) return { ok: false, reason: 'терминал выключен у шлюза (Merchant is offline)' };
    if (err.code === 'GATEWAY_UNREACHABLE') return { ok: false, reason: 'шлюз не отвечает' };
    return { ok: true, note: err.message };
  }
}

/*
 * Что шлюз должен нам по всем терминалам. Сверка финотдела считает долг по
 * всем ордерам Sicilia, и сравнивать его с балансом одного основного
 * терминала значило бы видеть «расхождение» ровно на сумму мобильной
 * коммерции.
 */
export async function gatewayBalance() {
  const main = await merchantBalance();
  if (!mkReady()) return main;
  const mk = await merchantBalance(siciliaEnv(MK));
  const add = (k) => Math.round(((Number(main?.[k]) || 0) + (Number(mk?.[k]) || 0)) * 100) / 100;
  return { balance: add('balance'), frozen_balance: add('frozen_balance'), terminals: { main, mk } };
}

/* ============================================================
   КОЛБЭК И СВЕРКА
   ============================================================ */

/**
 * Колбэк шлюза: подпись проверена в ручке, здесь - перепроверка статуса.
 * Возвращает то, что случилось, чтобы ручка могла сообщить игроку.
 */
export async function handleCallback(body) {
  if (isAppealCallback(body)) return { kind: 'appeal', ...(await applyAppealCallback(body)) };
  if (body.order_type === 'payout') {
    const row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payout' AND invid = ?").get(String(body.invid || ''));
    if (!row) return { unknown: true };
    return { kind: 'payout', ...(await confirmPayout(row, body.fact_sum)) };
  }
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payin' AND invid = ?").get(String(body.InvId || ''));
  if (!row) return { unknown: true };
  if (row.paid_at) return { kind: 'payin', credited: false, duplicate: true };
  return { kind: 'payin', ...(await confirmPayin(row, body.FactSum)) };
}

/*
 * Сверка по расписанию. Колбэк может не дойти (сервер перезапускался, сеть),
 * и тогда без сверки деньги игрока висели бы до ручного разбора. Заодно
 * просроченные ордера отзываются: шлюз прямо советует это делать - реквизит
 * освобождается раньше и конверсия растёт.
 */
export const RECONCILE_MS = 5 * 60_000;
const RECONCILE_GRACE_MS = 2 * 60_000;
export const LATE_WINDOW_MS = 72 * 3600_000;
export const LATE_EVERY_MS = 3600_000;

export async function reconcile(now = Date.now()) {
  const env = siciliaEnv();
  if (!isConfigured(env)) return { checked: 0 };
  let checked = 0;
  const open = db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payin' AND paid_at IS NULL
                            AND status NOT IN ('cancelled', 'error', 'unclaimed', 'expired') AND created_at < ?`)
    .all(now - RECONCILE_GRACE_MS);
  const mkOn = mkReady();
  for (const row of open) {
    // Ордер мобильной коммерции без её ключей спросить нечем: ждёт, пока
    // ключи вернут, а не отзывается вслепую.
    if (row.terminal === MK && !mkOn) continue;
    checked++;
    let status = null;
    try { status = (await confirmPayin(row)).status; } catch (err) {
      if (err.code === 'GATEWAY_UNREACHABLE') break;
    }
    if (status !== 'completed' && now > (row.expires_at || row.created_at + env.ttlMs)) {
      // Не оплачен за отведённое время - отзываем, если окно его завело.
      try { await unclaimPayin(row); } catch { /* ордера могло и не быть: окно не открывали */ }
      db.prepare("UPDATE sicilia_orders SET status = 'expired', updated_at = ? WHERE id = ? AND paid_at IS NULL")
        .run(Date.now(), row.id);
    }
  }
  /*
   * Поздняя сверка. Ордер, закрытый у нас как неоплаченный, шлюз может зачесть
   * позже: трейдер подтвердил вручную, сумму поправили, апелляцию решили в
   * пользу игрока. Колбэк об этом может и не дойти, поэтому такие ордера
   * переспрашиваются ещё LATE_WINDOW_MS, но не чаще раза в LATE_EVERY_MS,
   * а ордера с открытой апелляцией - при каждой сверке, сколько бы ни длился спор.
   */
  const late = db.prepare(`SELECT o.* FROM sicilia_orders o
                            WHERE o.kind = 'payin' AND o.paid_at IS NULL
                              AND o.status IN ('cancelled', 'error', 'unclaimed', 'expired')
                              AND ((o.created_at > @window AND (o.late_checked_at IS NULL OR o.late_checked_at < @every))
                                OR EXISTS (SELECT 1 FROM sicilia_disputes d WHERE d.order_id = o.id AND d.status = 'sent'))`)
    .all({ window: now - LATE_WINDOW_MS, every: now - LATE_EVERY_MS });
  for (const row of late) {
    if (row.terminal === MK && !mkOn) continue;
    checked++;
    db.prepare('UPDATE sicilia_orders SET late_checked_at = ? WHERE id = ?').run(now, row.id);
    // Применяем только зачисление: «ещё ждёт» от шлюза не должно оживлять
    // ордер, который мы уже закрыли и отозвали.
    try {
      const info = await askPayin(row);
      if (String(info.status) === 'completed') applyPayinStatus(row.id, info);
    } catch (err) { if (err.code === 'GATEWAY_UNREACHABLE') break; }
  }
  // Выплаты в работе у шлюза и отправки с ошибкой за последние сутки-трое:
  // ошибка по таймауту не значит, что ордера у шлюза нет.
  const sent = db.prepare(`SELECT * FROM sicilia_orders WHERE kind = 'payout' AND paid_at IS NULL
                            AND (status IN ('opened', 'in_progress') OR (status = 'error' AND created_at > ?))`)
    .all(now - LATE_WINDOW_MS);
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

/* ============================================================
   СПОРЫ: ЧЕК ИГРОКА И АПЕЛЛЯЦИЯ У ШЛЮЗА
   ============================================================ */

/*
 * Чеки лежат рядом с базой, как обложки казино, и отдаются по ссылке со
 * случайным именем: апелляция шлюза принимает чек только ссылкой на картинку
 * (поле image), файлом его не передать. 16 случайных байт имени не угадать
 * перебором, а список файлов сервер не отдаёт. Копия базы чеки не включает:
 * это не деньги, а приложение к спору, и потеря файла не теряет ничего, кроме
 * картинки.
 */
export const receiptDir = () => join(dirname(resolve(process.env.DB_PATH || './data/app.db')), 'sicilia-receipts');
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
/* Сколько дней после оплаты игрок может сообщить, что деньги не пришли. */
export const DISPUTE_WINDOW_MS = 7 * 24 * 3600_000;
const OPEN_DISPUTE = new Set(['new', 'sent']);

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Тип картинки по первым байтам, а не по тому, что прислал браузер. */
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** Сохраняет чек из data:-ссылки или base64 и возвращает имя файла. */
export function saveReceipt(data) {
  const raw = String(data || '').replace(/^data:[^,]*,/, '');
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) return null;
  if (buf.length > RECEIPT_MAX_BYTES) throw Object.assign(new Error('Чек больше 5 МБ'), { code: 'TOO_BIG' });
  const ext = sniffImage(buf);
  if (!ext) throw Object.assign(new Error('Чек нужен картинкой: JPG, PNG или WEBP'), { code: 'BAD_FILE' });
  const dir = receiptDir();
  mkdirSync(dir, { recursive: true });
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  writeFileSync(join(dir, name), buf);
  return name;
}

export function receiptFile(name) {
  if (!RECEIPT_NAME_RE.test(String(name || ''))) return null;
  const path = join(receiptDir(), name);
  if (!existsSync(path)) return null;
  return { path, type: MIME[name.split('.').pop()] };
}

function receiptUrl(name, env = siciliaEnv()) {
  return name && env.webapp ? `${env.webapp}/receipts/${name}` : null;
}

/**
 * Игрок сообщает: перевёл, а деньги не пришли.
 *
 * Сразу в шлюз это не уходит: чек может быть чужим или нарисованным, а
 * апелляция у шлюза - это претензия мерчанта к трейдеру, и ложная бьёт по
 * нашей репутации у шлюза. Поэтому спор сначала видит сотрудник. Перед этим
 * статус ордера переспрашивается: часто деньги просто пришли позже, и спор
 * тогда не нужен вовсе.
 */
export async function reportDeposit(userId, orderId, { comment, image } = {}) {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND user_id = ? AND kind = 'payin'").get(Number(orderId), userId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (row.paid_at) throw Object.assign(new Error('Этот платёж уже зачислен'), { code: 'PAID' });
  if (Date.now() - row.created_at > DISPUTE_WINDOW_MS) {
    throw Object.assign(new Error('Срок для обращения по этому платежу прошёл, напишите в поддержку'), { code: 'TOO_OLD' });
  }
  const open = lastDispute(row.id);
  if (open && OPEN_DISPUTE.has(open.status)) {
    throw Object.assign(new Error('Обращение по этому платежу уже рассматривается'), { code: 'ALREADY' });
  }
  const text = String(comment || '').trim().slice(0, 500);
  if (!image) throw Object.assign(new Error('Приложите чек или скриншот перевода'), { code: 'NO_RECEIPT' });

  if (isConfigured(envFor(row))) {
    try {
      const r = await confirmPayin(row);
      if (r.credited) return { credited: true, payment: publicOrder(db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id)) };
    } catch { /* шлюз не ответил - спор всё равно примем */ }
  }

  const receipt = saveReceipt(image);
  const now = Date.now();
  const info = db.prepare(`INSERT INTO sicilia_disputes (order_id, user_id, source, comment, receipt, created_at, updated_at)
                           VALUES (?, ?, 'player', ?, ?, ?, ?)`).run(row.id, userId, text || null, receipt, now, now);
  trackEvent(userId, 'deposit_dispute', { amount: row.amount_rub });
  alert(`sicilia:dispute:${info.lastInsertRowid}`,
    `Игрок #${userId} сообщает, что оплата ${row.invid} на ${row.amount_rub} ₽ не зачислена. Чек приложен, спор ждёт в панели: Финансы -> Пополнения.`);
  return { credited: false, payment: publicOrder(db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id)) };
}

/** Загрузка чека плательщика к ордеру у шлюза (multipart, только картинки). */
async function uploadClientReceipt(row, receipt, env) {
  const file = receiptFile(receipt);
  if (!file || !row.gateway_id) return null;
  const form = new FormData();
  form.set('file', new Blob([readFileSync(file.path)], { type: file.type }), receipt);
  form.set('signature', signInvid(row.invid, env));
  const res = await fetch(`${env.api}/upload-client-receipt/${encodeURIComponent(row.gateway_id)}`, {
    method: 'POST', headers: { Accept: 'application/json' }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok;
}

/**
 * Открывает апелляцию у шлюза (кнопка в панели).
 *
 * disputeId - спор игрока: берётся его чек. Без него сотрудник открывает
 * спор сам и прикладывает свой чек (image). Чек уходит двумя путями: файлом к
 * ордеру (upload-client-receipt, если известен номер ордера у шлюза) и
 * ссылкой в апелляции - второе обязательно, первое помогает трейдеру.
 */
export async function openAppeal(staffId, { orderId, disputeId, reason, image } = {}) {
  let env = siciliaEnv();
  if (!isConfigured(env)) throw Object.assign(new Error('Шлюз не настроен'), { code: 'NOT_CONFIGURED' });
  if (!env.webapp) {
    throw Object.assign(new Error('Не задан SITE_URL: шлюзу не по чему открыть чек'), { code: 'NO_SITE_URL' });
  }
  let dispute = disputeId
    ? db.prepare('SELECT * FROM sicilia_disputes WHERE id = ?').get(Number(disputeId)) : null;
  if (disputeId && !dispute) throw Object.assign(new Error('Спор не найден'), { code: 'NOT_FOUND' });
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND kind = 'payin'")
    .get(dispute ? dispute.order_id : Number(orderId));
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  // Апелляция подписывается ключом терминала, где заведён ордер.
  env = envFor(row);
  if (!isConfigured(env)) throw Object.assign(new Error('Терминал этого платежа не настроен'), { code: 'NOT_CONFIGURED' });
  if (row.paid_at) throw Object.assign(new Error('Платёж уже зачислен'), { code: 'PAID' });
  if (dispute && dispute.status === 'sent') throw Object.assign(new Error('Апелляция уже открыта'), { code: 'ALREADY' });
  const text = String(reason || dispute?.comment || '').trim().slice(0, 500);
  if (text.length < 5) throw Object.assign(new Error('Опишите причину спора для шлюза'), { code: 'NO_REASON' });

  const now = Date.now();
  const receipt = image ? saveReceipt(image) : dispute?.receipt;
  if (!receipt) throw Object.assign(new Error('Нужен чек перевода'), { code: 'NO_RECEIPT' });
  if (!dispute) {
    const info = db.prepare(`INSERT INTO sicilia_disputes (order_id, user_id, source, comment, receipt, staff_id, created_at, updated_at)
                             VALUES (?, ?, 'staff', ?, ?, ?, ?, ?)`).run(row.id, row.user_id, text, receipt, staffId, now, now);
    dispute = db.prepare('SELECT * FROM sicilia_disputes WHERE id = ?').get(info.lastInsertRowid);
  } else if (image) {
    db.prepare('UPDATE sicilia_disputes SET receipt = ? WHERE id = ?').run(receipt, dispute.id);
  }

  // Номер ордера у шлюза нужен для загрузки файла: спросим, если не знаем.
  if (!row.gateway_id) { try { await confirmPayin(row); } catch { /* не страшно */ } }
  const fresh = db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id);
  if (fresh.paid_at) return { credited: true, dispute: adminDispute(dispute.id) };
  try { await uploadClientReceipt(fresh, receipt, env); } catch { /* файлом не вышло - ссылка в апелляции всё равно уйдёт */ }

  try {
    const res = await call('POST', '/appeals', {
      merchant: Number(env.merchant) || env.merchant,
      order_invid: row.invid,
      image: receiptUrl(receipt, env),
      // Так поле названо в их API, с двумя n.
      openning_reason: text,
      signature: signInvid(row.invid, env),
    }, { env });
    db.prepare(`UPDATE sicilia_disputes SET status = 'sent', appeal_id = ?, appeal_status = ?, staff_id = ?, comment = COALESCE(comment, ?),
                       error = NULL, sent_at = ?, updated_at = ? WHERE id = ?`)
      .run(res.id ?? null, res.status || 'created', staffId, text, now, now, dispute.id);
  } catch (err) {
    db.prepare('UPDATE sicilia_disputes SET error = ?, updated_at = ? WHERE id = ?')
      .run(String(err.message).slice(0, 300), Date.now(), dispute.id);
    throw err;
  }
  logAdmin(staffId, row.user_id, 'sicilia_appeal', { amount: row.amount_rub, note: row.invid });
  return { credited: false, dispute: adminDispute(dispute.id) };
}

/** Сотрудник отказывает в споре: чек не тот, перевод на чужие реквизиты и т. п. */
export function declineDispute(staffId, disputeId, note) {
  const d = db.prepare('SELECT * FROM sicilia_disputes WHERE id = ?').get(Number(disputeId));
  if (!d) throw Object.assign(new Error('Спор не найден'), { code: 'NOT_FOUND' });
  if (d.status !== 'new') throw Object.assign(new Error('Спор уже в работе у шлюза или закрыт'), { code: 'RESOLVED' });
  const text = String(note || '').trim().slice(0, 300);
  if (text.length < 5) throw Object.assign(new Error('Напишите игроку, почему отказано'), { code: 'NO_NOTE' });
  const now = Date.now();
  db.prepare(`UPDATE sicilia_disputes SET status = 'declined', staff_id = ?, staff_note = ?, closed_at = ?, updated_at = ?
               WHERE id = ?`).run(staffId, text, now, now, d.id);
  logAdmin(staffId, d.user_id, 'sicilia_dispute_decline', { note: text });
  return adminDispute(d.id);
}

/**
 * Колбэк закрытия апелляции. Как и остальные колбэки, сам ничего не решает:
 * записываем, что сказал шлюз, и переспрашиваем статус ордера своей подписью.
 * Зачисление, если оно есть, проходит той же applyPayinStatus.
 */
export async function applyAppealCallback(body) {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE kind = 'payin' AND invid = ?").get(String(body.invid));
  if (!row) return { unknown: true };
  const now = Date.now();
  let dispute = lastDispute(row.id);
  if (!dispute) {
    // Апелляцию открыли не из панели, а в кабинете шлюза: заводим запись,
    // чтобы спор был виден рядом с остальными.
    const info = db.prepare(`INSERT INTO sicilia_disputes (order_id, user_id, source, status, created_at, updated_at, sent_at)
                             VALUES (?, ?, 'staff', 'sent', ?, ?, ?)`).run(row.id, row.user_id, now, now, now);
    dispute = db.prepare('SELECT * FROM sicilia_disputes WHERE id = ?').get(info.lastInsertRowid);
  }
  db.prepare(`UPDATE sicilia_disputes SET appeal_status = ?, appeal_reason = ?, fact_sum = COALESCE(?, fact_sum), updated_at = ?
               WHERE id = ?`)
    .run(String(body.status || ''), body.reason ? String(body.reason).slice(0, 300) : null,
         body.fact_sum != null ? String(body.fact_sum) : null, now, dispute.id);

  let result = { credited: false };
  if (!row.paid_at) result = await confirmPayin(row, body.fact_sum);
  const after = db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(row.id);
  if (!after.paid_at) {
    db.prepare(`UPDATE sicilia_disputes SET status = 'lost', closed_at = ?, updated_at = ? WHERE id = ? AND status IN ('new', 'sent')`)
      .run(now, now, dispute.id);
  }
  alert(`sicilia:appeal:${row.id}`, after.paid_at
    ? `Апелляция по ${row.invid} решена в пользу игрока #${row.user_id}: зачислено ${after.credited_rub} ₽.`
    : `Апелляция по ${row.invid} (игрок #${row.user_id}, ${row.amount_rub} ₽) закрыта без зачисления: ${body.reason || body.status || 'без причины'}.`);
  return { ...result, userId: row.user_id };
}

/* ---------- Для панели ---------- */

function adminDispute(id) {
  const d = db.prepare('SELECT * FROM sicilia_disputes WHERE id = ?').get(id);
  return d && {
    id: d.id, orderId: d.order_id, source: d.source, status: d.status, comment: d.comment,
    receipt: d.receipt ? `/receipts/${d.receipt}` : null,
    appealId: d.appeal_id, appealStatus: d.appeal_status, appealReason: d.appeal_reason,
    factSum: d.fact_sum, staffNote: d.staff_note, error: d.error,
    createdAt: d.created_at, sentAt: d.sent_at, closedAt: d.closed_at,
  };
}

export function openDisputesCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM sicilia_disputes WHERE status = 'new'").get().n;
}

/** Переспросить шлюз о пополнении из панели. */
export async function recheckDeposit(orderId) {
  const row = db.prepare("SELECT * FROM sicilia_orders WHERE id = ? AND kind = 'payin'").get(Number(orderId));
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (row.paid_at) return { credited: false, status: row.status, paid: true };
  return confirmPayin(row);
}

export { adminDispute };
