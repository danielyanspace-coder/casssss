import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { db, getUserById } from './db.js';

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
    sms_fingerprint TEXT UNIQUE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_active_amount
    ON payment_requests(payable_amount) WHERE status = 'PENDING';
  CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_requests(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_requests(status, expires_at);
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

const defaults = {
  beeline_phone: process.env.BEELINE_PHONE || '+79990000000',
  payment_ttl_minutes: process.env.PAYMENT_TTL_MINUTES || '10',
  payment_markup_min: process.env.PAYMENT_MARKUP_MIN || '1',
  payment_markup_max: process.env.PAYMENT_MARKUP_MAX || '99',
  payment_min: process.env.PAYMENT_MIN || '500',
  payment_max: process.env.PAYMENT_MAX || '100000',
  beeline_completed_limit: process.env.BEELINE_COMPLETED_LIMIT || '0',
};
const putDefault = db.prepare('INSERT OR IGNORE INTO system_settings(key,value,updated_at) VALUES(?,?,?)');
for (const [key, value] of Object.entries(defaults)) putDefault.run(key, String(value), Date.now());

export function paymentSettings() {
  return Object.fromEntries(db.prepare('SELECT key,value FROM system_settings').all().map(r => [r.key, r.value]));
}
export const updatePaymentSettings = db.transaction((values) => {
  const allowed = Object.keys(defaults);
  const stmt = db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
  for (const key of allowed) if (values[key] !== undefined) stmt.run(key, String(values[key]).trim(), Date.now());
  const s = paymentSettings();
  if (!/^\+?[1-9]\d{9,14}$/.test(s.beeline_phone)) throw new Error('Некорректный номер Beeline');
  for (const key of allowed.filter(k => k !== 'beeline_phone')) if (!Number.isFinite(Number(s[key]))) throw new Error(`Некорректно: ${key}`);
  if (+s.payment_min < 1 || +s.payment_max < +s.payment_min || +s.payment_markup_min < 0 || +s.payment_markup_max < +s.payment_markup_min || +s.beeline_completed_limit < 0) throw new Error('Некорректные границы платежей');
  return s;
});

export function beelineLimitUsage(settings = paymentSettings()) {
  const phone = settings.beeline_phone;
  const row = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='PAID' THEN original_amount ELSE 0 END),0) completed,
      COALESCE(SUM(CASE WHEN status='PENDING' AND expires_at>? THEN original_amount ELSE 0 END),0) reserved
    FROM payment_requests WHERE phone=?`).get(Date.now(), phone);
  const limit = Math.trunc(Number(settings.beeline_completed_limit) || 0);
  return { phone, limit, completed: row.completed, reserved: row.reserved,
    remaining: limit > 0 ? Math.max(0, limit - row.completed - row.reserved) : null };
}

export function expirePayments(now = Date.now()) {
  return db.prepare(`UPDATE payment_requests SET status='EXPIRED'
    WHERE status='PENDING' AND expires_at <= ?`).run(now).changes;
}

export const createPayment = db.transaction((userId, rawAmount, bank) => {
  expirePayments();
  const s = paymentSettings();
  const amount = Math.trunc(Number(rawAmount));
  if (!Number.isSafeInteger(amount) || amount < +s.payment_min || amount > +s.payment_max) {
    throw Object.assign(new Error(`Сумма должна быть от ${s.payment_min} до ${s.payment_max} ₽`), { code: 'BAD_AMOUNT' });
  }
  const banks = ['sber', 'ozon', 'alfa', 'tbank', 'vtb', 'any'];
  if (!banks.includes(bank)) throw Object.assign(new Error('Неизвестный банк'), { code: 'BAD_BANK' });
  const usage = beelineLimitUsage(s);
  if (usage.limit > 0 && (usage.remaining < +s.payment_min || amount > usage.remaining)) {
    throw Object.assign(new Error('Реквизиты для пополнения временно недоступны'), { code: 'REQUISITE_LIMIT' });
  }
  const now = Date.now();
  for (let add = +s.payment_markup_min; add <= +s.payment_markup_max; add++) {
    try {
      const info = db.prepare(`INSERT INTO payment_requests
        (user_id,original_amount,payable_amount,bank,phone,status,created_at,expires_at)
        VALUES(?,?,?,?,?,'PENDING',?,?)`).run(userId, amount, amount + add, bank, s.beeline_phone,
          now, now + +s.payment_ttl_minutes * 60000);
      return getPayment(info.lastInsertRowid, userId);
    } catch (e) { if (!String(e.code).includes('CONSTRAINT')) throw e; }
  }
  throw Object.assign(new Error('Нет свободной уникальной суммы. Повторите позже'), { code: 'NO_AMOUNT' });
});

export function getPayment(id, userId) {
  expirePayments();
  return db.prepare(`SELECT id,user_id,original_amount,payable_amount,bank,phone,status,
    created_at,expires_at,paid_at FROM payment_requests WHERE id=? AND user_id=?`).get(id, userId);
}
export function listPayments(userId, limit = 30) { expirePayments(); return db.prepare(`
  SELECT id,original_amount,payable_amount,bank,phone,status,created_at,expires_at,paid_at
  FROM payment_requests WHERE user_id=? ORDER BY id DESC LIMIT ?`).all(userId, limit); }

const completePaymentTx = db.transaction((payment, message, fingerprint, deviceId) => {
  const changed = db.prepare(`UPDATE payment_requests SET status='PAID',paid_at=?,sms_message=?,sms_fingerprint=?
    WHERE id=? AND status='PENDING' AND expires_at>?`).run(Date.now(), message, fingerprint, payment.id, Date.now()).changes;
  if (!changed) throw Object.assign(new Error('Заявка уже обработана или истекла'), { code: 'NOT_PENDING' });
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(payment.original_amount, payment.user_id);
  db.prepare(`INSERT INTO balance_transactions(user_id,type,amount,payment_id,comment,created_at)
    VALUES(?,'DEPOSIT',?,?,?,?)`).run(payment.user_id, payment.original_amount, payment.id, 'Автоплатёж Beeline', Date.now());
  db.prepare(`INSERT INTO deposits(user_id,amount,source,comment,created_at)
    VALUES(?,?,'beeline',?,?)`).run(payment.user_id, payment.original_amount, `Платёж #${payment.id}`, Date.now());
  db.prepare(`INSERT INTO payment_events(payment_id,device_id,kind,payload,created_at)
    VALUES(?,?,'payment.completed',?,?)`).run(payment.id, deviceId, JSON.stringify({ fingerprint }), Date.now());
  return { paymentId: payment.id, userId: payment.user_id, balance: getUserById(payment.user_id).balance };
});

export function verifyDeviceRequest({ deviceId, timestamp, nonce, signature, rawBody }) {
  const d = db.prepare('SELECT * FROM payment_devices WHERE device_id=? AND enabled=1').get(deviceId);
  if (!d) throw Object.assign(new Error('Устройство не авторизовано'), { status: 401 });
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) throw Object.assign(new Error('Запрос просрочен'), { status: 401 });
  const expected = createHmac('sha256', d.secret).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature || ''));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('Неверная подпись'), { status: 401 });
  const replay = db.prepare(`SELECT 1 FROM payment_events WHERE device_id=? AND kind='request.nonce'
    AND payload=? AND created_at>?`).get(deviceId, nonce, Date.now() - 86400000);
  if (replay) throw Object.assign(new Error('Повторный запрос'), { status: 409 });
  db.prepare(`INSERT INTO payment_events(device_id,kind,payload,created_at) VALUES(?,'request.nonce',?,?)`).run(deviceId, nonce, Date.now());
  return d;
}

export function processBeelineSms({ amount, message, deviceId }) {
  expirePayments();
  const normalized = Number(amount);
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > 1000000) throw new Error('Некорректная сумма');
  if (!/чек\s+билайн[а]?/iu.test(message || '')) throw new Error('SMS не соответствует формату Beeline');
  const fingerprint = createHash('sha256').update(`${deviceId}\0${message}`).digest('hex');
  if (db.prepare('SELECT 1 FROM payment_requests WHERE sms_fingerprint=?').get(fingerprint)) throw Object.assign(new Error('SMS уже использована'), { status: 409 });
  const payment = db.prepare(`SELECT * FROM payment_requests WHERE payable_amount=? AND status='PENDING'
    AND expires_at>? ORDER BY id LIMIT 1`).get(normalized, Date.now());
  if (!payment) throw Object.assign(new Error('Активная заявка не найдена'), { status: 404 });
  return completePaymentTx(payment, message, fingerprint, deviceId);
}

export function heartbeat(deviceId) { db.prepare('UPDATE payment_devices SET last_seen_at=? WHERE device_id=?').run(Date.now(), deviceId); }
export function registerDevice(deviceId, name, secret) { db.prepare(`INSERT INTO payment_devices(device_id,name,secret,created_at)
  VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET name=excluded.name,secret=excluded.secret,enabled=1`).run(deviceId, name, secret, Date.now()); }
export function adminDevices() { return db.prepare('SELECT device_id,name,enabled,last_seen_at,created_at FROM payment_devices ORDER BY name').all(); }
export function adminPayments(status = 'ALL') { expirePayments(); const w = status === 'ALL' ? '' : 'WHERE p.status=?'; return db.prepare(`SELECT p.*,u.tg_id,u.username,u.first_name FROM payment_requests p JOIN users u ON u.id=p.user_id ${w} ORDER BY p.id DESC LIMIT 100`).all(...(status === 'ALL' ? [] : [status])); }
export function paymentDashboard() { expirePayments(); return { ...db.prepare(`SELECT COUNT(*) total,
  COALESCE(SUM(CASE WHEN status='PAID' THEN original_amount ELSE 0 END),0) turnover,
  SUM(status='PAID') paid,SUM(status='PENDING') pending,SUM(status='EXPIRED') expired,
  SUM(status='MANUAL_REVIEW') disputed FROM payment_requests`).get(), limitUsage: beelineLimitUsage() }; }

export const openDispute = db.transaction((userId, paymentId) => {
  const p = getPayment(paymentId, userId); if (!p) throw new Error('Заявка не найдена');
  let chat = db.prepare('SELECT * FROM support_chats WHERE payment_id=?').get(paymentId);
  if (!chat) {
    const now = Date.now(); const info = db.prepare(`INSERT INTO support_chats(user_id,payment_id,status,unread_admin,created_at,updated_at) VALUES(?,?,'OPEN',1,?,?)`).run(userId,paymentId,now,now);
    db.prepare(`INSERT INTO support_messages(chat_id,sender_type,text,created_at) VALUES(?,'SYSTEM',?,?)`).run(info.lastInsertRowid,'Вас приветствует финансовый отдел LuckyBox. Если вы оплатили, а сумма не поступила, пожалуйста, отправьте чек об оплате.',now);
    db.prepare(`UPDATE payment_requests SET status='MANUAL_REVIEW' WHERE id=? AND status IN ('PENDING','EXPIRED')`).run(paymentId);
    chat = db.prepare('SELECT * FROM support_chats WHERE id=?').get(info.lastInsertRowid);
  }
  return chat;
});
export function addSupportMessage(chatId, senderType, senderId, text, attachmentUrl, attachmentName) {
  if (!String(text || '').trim() && !attachmentUrl) throw new Error('Пустое сообщение');
  const now=Date.now(); db.prepare(`INSERT INTO support_messages(chat_id,sender_type,sender_id,text,attachment_url,attachment_name,created_at) VALUES(?,?,?,?,?,?,?)`).run(chatId,senderType,senderId,text||null,attachmentUrl||null,attachmentName||null,now);
  db.prepare(`UPDATE support_chats SET updated_at=?, unread_admin=unread_admin+?, unread_user=unread_user+? WHERE id=?`).run(now,senderType==='USER'?1:0,senderType==='ADMIN'?1:0,chatId);
}
export function supportChat(chatId) { return { chat: db.prepare('SELECT * FROM support_chats WHERE id=?').get(chatId), messages: db.prepare('SELECT * FROM support_messages WHERE chat_id=? ORDER BY id').all(chatId) }; }
export function adminChats() { return db.prepare(`SELECT c.*,p.payable_amount,p.status payment_status,u.tg_id,u.username,u.first_name FROM support_chats c JOIN payment_requests p ON p.id=c.payment_id JOIN users u ON u.id=c.user_id ORDER BY c.updated_at DESC`).all(); }
