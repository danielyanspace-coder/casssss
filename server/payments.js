/**
 * Приём платежей через СБП на номер Beeline и разбор споров по ним.
 *
 * Как это работает целиком. Игрок просит пополнение на 1000 - мы выдаём ему
 * номер и сумму 1037. Он переводит ровно её. Android-телефон с SIM Beeline
 * ловит SMS «Чек билайн 1037 руб», шлёт её сюда подписанным запросом, и мы по
 * сумме находим заявку. Никакого API у банка нет, сопоставление идёт только по
 * копейкам, поэтому сумма каждой активной заявки обязана быть уникальной - за
 * это отвечает частичный уникальный индекс idx_payment_active_amount.
 *
 * Отсюда все странности ниже: подбор надбавки перебором, отпечаток SMS,
 * подпись устройства и время жизни заявки. Каждая из них закрывает конкретную
 * дыру, а не добавлена для порядка.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db, getUserById, registerDeposit, trackEvent } from './db.js';

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING', PAID: 'PAID', EXPIRED: 'EXPIRED',
  MANUAL_REVIEW: 'MANUAL_REVIEW', CANCELLED: 'CANCELLED',
});

db.exec(`
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    original_amount INTEGER NOT NULL,
    payable_amount INTEGER NOT NULL,
    bank TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    paid_at INTEGER,
    sms_message TEXT,
    -- Отпечаток пришедшей SMS. UNIQUE здесь - защита от двойного зачисления:
    -- шлюз повторяет запрос при обрыве связи, и без него повтор оплатил бы
    -- вторую заявку на ту же сумму.
    sms_fingerprint TEXT UNIQUE
  );
  -- Две активные заявки на одну сумму сделали бы платёж неопознаваемым:
  -- пришедшая SMS подошла бы обеим. Индекс частичный - истёкшие и оплаченные
  -- заявки суммы больше не занимают.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_active_amount
    ON payment_requests(payable_amount) WHERE status = 'PENDING';
  CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_requests(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_requests(status, expires_at);
  -- Журнал всего, что прислало устройство: и платежи, и nonce запросов.
  CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER REFERENCES payment_requests(id),
    device_id TEXT, kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_devices (
    device_id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, last_seen_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS balance_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL,
    amount INTEGER NOT NULL, payment_id INTEGER UNIQUE REFERENCES payment_requests(id),
    comment TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS support_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
    payment_id INTEGER UNIQUE REFERENCES payment_requests(id), status TEXT NOT NULL DEFAULT 'OPEN',
    unread_user INTEGER NOT NULL DEFAULT 0, unread_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES support_chats(id),
    sender_type TEXT NOT NULL, sender_id INTEGER, text TEXT, attachment_url TEXT,
    attachment_name TEXT, created_at INTEGER NOT NULL
  );
`);

/* ============================================================
   НАСТРОЙКИ
   ============================================================ */

// Значения из .env - только начальные: дальше настройки живут в базе и
// меняются из админки без перезапуска. Номер и границы сумм приходится править
// на ходу, когда реквизит упирается в лимит оператора.
const defaults = {
  beeline_phone: process.env.BEELINE_PHONE || '+79990000000',
  payment_ttl_minutes: process.env.PAYMENT_TTL_MINUTES || '10',
  payment_markup_min: process.env.PAYMENT_MARKUP_MIN || '1',
  payment_markup_max: process.env.PAYMENT_MARKUP_MAX || '99',
  payment_min: process.env.PAYMENT_MIN || '500',
  payment_max: process.env.PAYMENT_MAX || '100000',
  beeline_completed_limit: process.env.BEELINE_COMPLETED_LIMIT || '0',
};

const putDefault = db.prepare(
  'INSERT OR IGNORE INTO system_settings(key,value,updated_at) VALUES(?,?,?)'
);
for (const [key, value] of Object.entries(defaults)) putDefault.run(key, String(value), Date.now());

export function paymentSettings() {
  const rows = db.prepare('SELECT key,value FROM system_settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Сохранение настроек из админки.
 *
 * Проверки идут после записи, внутри транзакции: правила связывают значения
 * между собой (min не больше max), и проверить их можно только по итоговому
 * набору. Любая ошибка откатывает всю запись целиком.
 */
export const updatePaymentSettings = db.transaction((values) => {
  const allowed = Object.keys(defaults);
  const stmt = db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
  for (const key of allowed) {
    if (values[key] !== undefined) stmt.run(key, String(values[key]).trim(), Date.now());
  }

  const s = paymentSettings();
  if (!/^\+?[1-9]\d{9,14}$/.test(s.beeline_phone)) throw new Error('Некорректный номер Beeline');
  for (const key of allowed.filter((k) => k !== 'beeline_phone')) {
    if (!Number.isFinite(Number(s[key]))) throw new Error(`Некорректно: ${key}`);
  }
  if (+s.payment_min < 1 || +s.payment_max < +s.payment_min ||
      +s.payment_markup_min < 0 || +s.payment_markup_max < +s.payment_markup_min ||
      +s.beeline_completed_limit < 0) {
    throw new Error('Некорректные границы платежей');
  }
  return s;
});

/**
 * Сколько ещё можно принять на этот номер.
 *
 * У оператора есть предел суммы за период, и переступать его нельзя: платёж
 * сверх лимита просто не дойдёт, а игрок будет считать, что заплатил. Поэтому
 * в остаток входят и уже принятые платежи, и зарезервированные активными
 * заявками. Лимит 0 означает «без ограничения».
 */
export function beelineLimitUsage(settings = paymentSettings()) {
  const phone = settings.beeline_phone;
  const row = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='PAID' THEN original_amount ELSE 0 END),0) completed,
      COALESCE(SUM(CASE WHEN status='PENDING' AND expires_at>? THEN original_amount ELSE 0 END),0) reserved
    FROM payment_requests WHERE phone=?`).get(Date.now(), phone);

  const limit = Math.trunc(Number(settings.beeline_completed_limit) || 0);
  return {
    phone,
    limit,
    completed: row.completed,
    reserved: row.reserved,
    remaining: limit > 0 ? Math.max(0, limit - row.completed - row.reserved) : null,
  };
}

/* ============================================================
   ЗАЯВКИ НА ПОПОЛНЕНИЕ
   ============================================================ */

/**
 * Гасит просроченные заявки. Вызывается перед каждым чтением и созданием, а не
 * по таймеру: пока заявка числится активной, её сумма занята, и следующий
 * игрок на ту же сумму получил бы другую надбавку без всякой причины.
 */
export function expirePayments(now = Date.now()) {
  return db.prepare(`UPDATE payment_requests SET status='EXPIRED'
    WHERE status='PENDING' AND expires_at <= ?`).run(now).changes;
}

export const createPayment = db.transaction((userId, rawAmount, bank) => {
  expirePayments();
  const s = paymentSettings();
  const amount = Math.trunc(Number(rawAmount));
  if (!Number.isSafeInteger(amount) || amount < +s.payment_min || amount > +s.payment_max) {
    throw Object.assign(new Error(`Сумма должна быть от ${s.payment_min} до ${s.payment_max} ₽`),
      { code: 'BAD_AMOUNT' });
  }

  const banks = ['sber', 'ozon', 'alfa', 'tbank', 'vtb', 'any'];
  if (!banks.includes(bank)) throw Object.assign(new Error('Неизвестный банк'), { code: 'BAD_BANK' });

  const usage = beelineLimitUsage(s);
  if (usage.limit > 0 && (usage.remaining < +s.payment_min || amount > usage.remaining)) {
    throw Object.assign(new Error('Реквизиты для пополнения временно недоступны'),
      { code: 'REQUISITE_LIMIT' });
  }

  // Надбавка подбирается перебором, а не случайным числом: свободных значений
  // всего 99, и случайный выбор упирался бы в занятые тем чаще, чем больше
  // активных заявок. Ошибка UNIQUE здесь - штатный ответ «занято», поэтому она
  // ловится и означает переход к следующей надбавке; любая другая пробрасывается.
  const now = Date.now();
  for (let add = +s.payment_markup_min; add <= +s.payment_markup_max; add++) {
    try {
      const info = db.prepare(`INSERT INTO payment_requests
        (user_id,original_amount,payable_amount,bank,phone,status,created_at,expires_at)
        VALUES(?,?,?,?,?,'PENDING',?,?)`).run(userId, amount, amount + add, bank, s.beeline_phone,
          now, now + +s.payment_ttl_minutes * 60000);
      trackEvent(userId, 'deposit_created', { amount, bank, method: 'beeline' });
      return getPayment(info.lastInsertRowid, userId);
    } catch (e) {
      if (!String(e.code).includes('CONSTRAINT')) throw e;
    }
  }
  throw Object.assign(new Error('Нет свободной уникальной суммы. Повторите позже'),
    { code: 'NO_AMOUNT' });
});

export function getPayment(id, userId) {
  expirePayments();
  return db.prepare(`SELECT id,user_id,original_amount,payable_amount,bank,phone,status,
    created_at,expires_at,paid_at FROM payment_requests WHERE id=? AND user_id=?`).get(id, userId);
}

export function listPayments(userId, limit = 30) {
  expirePayments();
  return db.prepare(`
    SELECT id,original_amount,payable_amount,bank,phone,status,created_at,expires_at,paid_at
    FROM payment_requests WHERE user_id=? ORDER BY id DESC LIMIT ?`).all(userId, limit);
}

/**
 * Зачисление по пришедшей SMS.
 *
 * UPDATE с условием status='PENDING' - это и есть защита от гонки: две SMS,
 * пришедшие одновременно, изменят строку только одна, вторая увидит changes=0
 * и получит отказ. Проверять состояние отдельным SELECT было бы недостаточно.
 *
 * Зачисляется original_amount, а не пришедшая сумма: надбавка - наш способ
 * опознать платёж, а не доход.
 */
const completePaymentTx = db.transaction((payment, message, fingerprint, deviceId) => {
  const changed = db.prepare(`UPDATE payment_requests
      SET status='PAID',paid_at=?,sms_message=?,sms_fingerprint=?
    WHERE id=? AND status='PENDING' AND expires_at>?`)
    .run(Date.now(), message, fingerprint, payment.id, Date.now()).changes;
  if (!changed) throw Object.assign(new Error('Заявка уже обработана или истекла'), { code: 'NOT_PENDING' });

  db.prepare('UPDATE users SET balance=balance+? WHERE id=?')
    .run(payment.original_amount, payment.user_id);
  db.prepare(`INSERT INTO balance_transactions(user_id,type,amount,payment_id,comment,created_at)
    VALUES(?,'DEPOSIT',?,?,?,?)`)
    .run(payment.user_id, payment.original_amount, payment.id, 'Автоплатёж Beeline', Date.now());
  db.prepare(`INSERT INTO deposits(user_id,amount,source,comment,created_at)
    VALUES(?,?,'beeline',?,?)`)
    .run(payment.user_id, payment.original_amount, `Платёж #${payment.id}`, Date.now());
  db.prepare(`INSERT INTO payment_events(payment_id,device_id,kind,payload,created_at)
    VALUES(?,?,'payment.completed',?,?)`)
    .run(payment.id, deviceId, JSON.stringify({ fingerprint }), Date.now());

  // Общие для всех шлюзов последствия: счётчик пополнений, промо-процент и
  // бонус за первое пополнение. Внутри этой же транзакции - откат зачисления
  // обязан отменить и бонус.
  const { bonus } = registerDeposit(payment.user_id, payment.original_amount, 'beeline');

  return {
    paymentId: payment.id,
    userId: payment.user_id,
    bonus,
    balance: getUserById(payment.user_id).balance,
  };
});

/* ============================================================
   ANDROID-ШЛЮЗ
   ============================================================ */

// Запрос устройства действителен пять минут: HMAC подтверждает подлинность, но
// не свежесть, и без окна перехваченный запрос можно было бы повторить завтра.
const REQUEST_MAX_AGE_MS = 5 * 60_000;
// Сколько помним nonce. Сутки - с запасом больше окна свежести.
const NONCE_MEMORY_MS = 86_400_000;

/**
 * Проверка подписи телефона-шлюза.
 *
 * Подпись считается по времени, nonce и сырому телу: тело именно сырое, потому
 * что порядок ключей после JSON.parse/stringify может измениться, и подпись
 * перестала бы сходиться.
 *
 * Сравнение через timingSafeEqual, а не ===: посимвольное сравнение выдаёт
 * длину совпавшего префикса временем ответа.
 */
export function verifyDeviceRequest({ deviceId, timestamp, nonce, signature, rawBody }) {
  const d = db.prepare('SELECT * FROM payment_devices WHERE device_id=? AND enabled=1').get(deviceId);
  if (!d) throw Object.assign(new Error('Устройство не авторизовано'), { status: 401 });
  if (Math.abs(Date.now() - Number(timestamp)) > REQUEST_MAX_AGE_MS) {
    throw Object.assign(new Error('Запрос просрочен'), { status: 401 });
  }

  const expected = createHmac('sha256', d.secret).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Неверная подпись'), { status: 401 });
  }

  const replay = db.prepare(`SELECT 1 FROM payment_events WHERE device_id=? AND kind='request.nonce'
    AND payload=? AND created_at>?`).get(deviceId, nonce, Date.now() - NONCE_MEMORY_MS);
  if (replay) throw Object.assign(new Error('Повторный запрос'), { status: 409 });

  db.prepare('INSERT INTO payment_events(device_id,kind,payload,created_at) VALUES(?,?,?,?)')
    .run(deviceId, 'request.nonce', nonce, Date.now());
  return d;
}

// Больше миллиона одним платежом не бывает: такая сумма означает разобранную не
// ту SMS, а не щедрого игрока.
const SMS_MAX_AMOUNT = 1_000_000;

/**
 * Разбор SMS от оператора.
 *
 * Отпечаток считается от текста вместе с идентификатором устройства: два
 * телефона могут получить одинаковый текст, и общий отпечаток заставил бы
 * второй платёж молча пропасть.
 *
 * Формат текста проверяется здесь только грубо - точный шаблон разбирает само
 * приложение на телефоне. Здесь важно другое: сумма должна совпасть с активной
 * заявкой до копейки, иначе платёж не опознан.
 */
export function processBeelineSms({ amount, message, deviceId }) {
  expirePayments();
  const normalized = Number(amount);
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > SMS_MAX_AMOUNT) {
    throw new Error('Некорректная сумма');
  }
  if (!/чек\s+билайн[а]?/iu.test(message || '')) throw new Error('SMS не соответствует формату Beeline');

  const fingerprint = createHash('sha256').update(`${deviceId}\0${message}`).digest('hex');
  if (db.prepare('SELECT 1 FROM payment_requests WHERE sms_fingerprint=?').get(fingerprint)) {
    throw Object.assign(new Error('SMS уже использована'), { status: 409 });
  }

  // Если заявок с такой суммой почему-то две, берём самую старую: она ждёт
  // дольше и истечёт первой.
  const payment = db.prepare(`SELECT * FROM payment_requests WHERE payable_amount=? AND status='PENDING'
    AND expires_at>? ORDER BY id LIMIT 1`).get(normalized, Date.now());
  if (!payment) throw Object.assign(new Error('Активная заявка не найдена'), { status: 404 });

  return completePaymentTx(payment, message, fingerprint, deviceId);
}

export function heartbeat(deviceId) {
  db.prepare('UPDATE payment_devices SET last_seen_at=? WHERE device_id=?').run(Date.now(), deviceId);
}

/** Регистрация устройства повторно тем же device_id меняет ключ и включает его. */
export function registerDevice(deviceId, name, secret) {
  db.prepare(`INSERT INTO payment_devices(device_id,name,secret,created_at) VALUES(?,?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET name=excluded.name,secret=excluded.secret,enabled=1`)
    .run(deviceId, name, secret, Date.now());
}

/* ============================================================
   АДМИНКА
   ============================================================ */

// Ключ устройства наружу не отдаём даже администратору: он нужен только
// телефону, а в ответе админки его увидел бы любой, кто откроет консоль.
export function adminDevices() {
  return db.prepare(`SELECT device_id,name,enabled,last_seen_at,created_at
    FROM payment_devices ORDER BY name`).all();
}

export function adminPayments(status = 'ALL') {
  expirePayments();
  const where = status === 'ALL' ? '' : 'WHERE p.status=?';
  return db.prepare(`SELECT p.*,u.tg_id,u.username,u.first_name
    FROM payment_requests p JOIN users u ON u.id=p.user_id ${where}
    ORDER BY p.id DESC LIMIT 100`).all(...(status === 'ALL' ? [] : [status]));
}

export function paymentDashboard() {
  expirePayments();
  const row = db.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN status='PAID' THEN original_amount ELSE 0 END),0) turnover,
    SUM(status='PAID') paid,SUM(status='PENDING') pending,SUM(status='EXPIRED') expired,
    SUM(status='MANUAL_REVIEW') disputed FROM payment_requests`).get();
  return { ...row, limitUsage: beelineLimitUsage() };
}

/* ============================================================
   СПОРЫ И ПОДДЕРЖКА
   ============================================================ */

/**
 * Спор по платежу: игрок заплатил, а SMS не пришла.
 *
 * Заявка переводится в MANUAL_REVIEW, и это важнее, чем кажется: из этого
 * состояния её уже не погасит expirePayments, то есть платёж не потеряется,
 * пока человек не разберётся. Из PAID переводить нечего - деньги уже на месте.
 */
export const openDispute = db.transaction((userId, paymentId) => {
  const p = getPayment(paymentId, userId);
  if (!p) throw new Error('Заявка не найдена');

  let chat = db.prepare('SELECT * FROM support_chats WHERE payment_id=?').get(paymentId);
  if (!chat) {
    const now = Date.now();
    const info = db.prepare(`INSERT INTO support_chats(user_id,payment_id,status,unread_admin,created_at,updated_at)
      VALUES(?,?,'OPEN',1,?,?)`).run(userId, paymentId, now, now);
    db.prepare('INSERT INTO support_messages(chat_id,sender_type,text,created_at) VALUES(?,?,?,?)')
      .run(info.lastInsertRowid, 'SYSTEM',
        'Вас приветствует финансовый отдел LuckyBox. Если вы оплатили, а сумма не поступила, ' +
        'пожалуйста, отправьте чек об оплате.', now);
    db.prepare(`UPDATE payment_requests SET status='MANUAL_REVIEW'
      WHERE id=? AND status IN ('PENDING','EXPIRED')`).run(paymentId);
    chat = db.prepare('SELECT * FROM support_chats WHERE id=?').get(info.lastInsertRowid);
  }
  return chat;
});

export function addSupportMessage(chatId, senderType, senderId, text, attachmentUrl, attachmentName) {
  if (!String(text || '').trim() && !attachmentUrl) throw new Error('Пустое сообщение');
  const now = Date.now();
  db.prepare(`INSERT INTO support_messages
    (chat_id,sender_type,sender_id,text,attachment_url,attachment_name,created_at)
    VALUES(?,?,?,?,?,?,?)`)
    .run(chatId, senderType, senderId, text || null, attachmentUrl || null, attachmentName || null, now);

  // Счётчик непрочитанного растёт у противоположной стороны: своё сообщение
  // непрочитанным быть не может.
  db.prepare(`UPDATE support_chats SET updated_at=?, unread_admin=unread_admin+?, unread_user=unread_user+?
    WHERE id=?`).run(now, senderType === 'USER' ? 1 : 0, senderType === 'ADMIN' ? 1 : 0, chatId);
}

export function supportChat(chatId) {
  return {
    chat: db.prepare('SELECT * FROM support_chats WHERE id=?').get(chatId),
    messages: db.prepare('SELECT * FROM support_messages WHERE chat_id=? ORDER BY id').all(chatId),
  };
}

export function adminChats() {
  return db.prepare(`SELECT c.*,p.payable_amount,p.status payment_status,u.tg_id,u.username,u.first_name
    FROM support_chats c JOIN payment_requests p ON p.id=c.payment_id JOIN users u ON u.id=c.user_id
    ORDER BY c.updated_at DESC`).all();
}
