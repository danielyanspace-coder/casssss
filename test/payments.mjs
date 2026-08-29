/**
 * Приём платежей Beeline: заявки, зачисление по SMS, подпись устройства,
 * споры и поддержка.
 *
 * Проверяется на настоящих функциях модуля, а не через HTTP: здесь важно
 * поведение денег и состояний, а не коды ответов.
 *
 * Запуск: node test/payments.mjs
 */
import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/payment-test.db';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

// Поощрение первого пополнения проверяется отдельно, в конце. Пока оно
// включено, любая проверка баланса ловила бы бонус вместо самого зачисления.
process.env.FIRST_DEPOSIT_PCT = '0';

const { db, getOrCreateUser, getUserById, withdrawable } = await import('../server/db.js');
const payments = await import('../server/payments.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};
const fails = (name, fn, code) => {
  try { fn(); check(name, false, 'ошибки не было'); }
  catch (err) { check(name, !code || err.code === code || err.status === code, `код ${err.code || err.status}`); }
};

const DEVICE = 'test-device';
const SECRET = 'a-very-long-test-device-secret';
payments.registerDevice(DEVICE, 'Тестовый телефон', SECRET);

const sms = (amount) => `Чек билайн ${amount}.00 руб`;
const pay = (payment) => payments.processBeelineSms({
  amount: payment.payable_amount, message: sms(payment.payable_amount), deviceId: DEVICE,
});

/* ---------- заявки ---------- */

const a = getOrCreateUser({ id: 'pay-a', username: 'a' });
const b = getOrCreateUser({ id: 'pay-b', username: 'b' });

const p1 = payments.createPayment(a.id, 1000, 'sber');
const p2 = payments.createPayment(b.id, 1000, 'any');

check('сумма заявки сохранена как есть', p1.original_amount === 1000);
check('к сумме добавлена надбавка', p1.payable_amount > p1.original_amount);
check('две заявки на одну сумму получают разные надбавки',
  p1.payable_amount !== p2.payable_amount);
check('заявка создаётся активной', p1.status === 'PENDING');
check('заявка видна в списке игрока',
  payments.listPayments(a.id).some((r) => r.id === p1.id));
check('чужая заявка не отдаётся', payments.getPayment(p1.id, b.id) === undefined);

fails('сумма ниже минимума отклонена', () => payments.createPayment(a.id, 1, 'sber'), 'BAD_AMOUNT');
fails('сумма выше максимума отклонена', () => payments.createPayment(a.id, 10 ** 9, 'sber'), 'BAD_AMOUNT');
fails('дробная сумма отклонена', () => payments.createPayment(a.id, 'сто', 'sber'), 'BAD_AMOUNT');
fails('неизвестный банк отклонён', () => payments.createPayment(a.id, 1000, 'мойбанк'), 'BAD_BANK');

/* ---------- зачисление по SMS ---------- */

const before = getUserById(a.id).balance;
const done = pay(p1);
check('зачислена сумма заявки, а не оплаченная с надбавкой',
  getUserById(a.id).balance - before === 1000, String(getUserById(a.id).balance - before));
check('ответ содержит новый баланс', done.balance === getUserById(a.id).balance);
check('заявка переведена в PAID', payments.getPayment(p1.id, a.id).status === 'PAID');
check('записана транзакция баланса',
  db.prepare('SELECT amount FROM balance_transactions WHERE payment_id=?').get(p1.id).amount === 1000);
check('пополнение попало в историю кассы',
  db.prepare("SELECT amount FROM deposits WHERE user_id=? AND source='beeline'").get(a.id).amount === 1000);
check('счётчик пополнений увеличен', getUserById(a.id).deposits_count === 1);
check('пополнение не увеличило отыгранное', getUserById(a.id).wager_progress === 0);

fails('та же SMS второй раз не зачисляется', () => pay(p1), 409);

const balanceAfter = getUserById(a.id).balance;
fails('SMS без слов «чек билайн» отклонена', () => payments.processBeelineSms({
  amount: 12345, message: 'Перевод 12345 руб', deviceId: DEVICE,
}));
fails('SMS без активной заявки отклонена', () => payments.processBeelineSms({
  amount: 999999, message: sms(999999), deviceId: DEVICE,
}), 404);
fails('нулевая сумма отклонена', () => payments.processBeelineSms({
  amount: 0, message: sms(0), deviceId: DEVICE,
}));
check('отклонённые SMS не тронули баланс', getUserById(a.id).balance === balanceAfter);

/* ---------- срок жизни заявки ---------- */

const stale = payments.createPayment(a.id, 700, 'tbank');
db.prepare('UPDATE payment_requests SET expires_at=? WHERE id=?').run(Date.now() - 1000, stale.id);
check('просроченная заявка гаснет сама', payments.getPayment(stale.id, a.id).status === 'EXPIRED');
fails('по просроченной заявке не зачисляют', () => pay(stale), 404);
check('освобождённая сумма снова доступна',
  payments.createPayment(a.id, 700, 'tbank').payable_amount === stale.payable_amount);

/* ---------- подпись устройства ---------- */

const signed = (body, secret = SECRET, ts = Date.now(), nonce = `n-${Math.random()}`) => ({
  deviceId: DEVICE, timestamp: ts, nonce, rawBody: body,
  signature: createHmac('sha256', secret).update(`${ts}.${nonce}.${body}`).digest('hex'),
});

const ok = signed('{"a":1}');
check('верная подпись принимается', payments.verifyDeviceRequest(ok).device_id === DEVICE);
fails('повтор того же nonce отклонён', () => payments.verifyDeviceRequest(ok), 409);
fails('чужой ключ отклонён', () => payments.verifyDeviceRequest(signed('{"a":1}', 'wrong-secret')), 401);
fails('изменённое тело отклонено', () => {
  const s = signed('{"a":1}');
  payments.verifyDeviceRequest({ ...s, rawBody: '{"a":2}' });
}, 401);
fails('просроченный запрос отклонён',
  () => payments.verifyDeviceRequest(signed('{}', SECRET, Date.now() - 3600_000)), 401);
fails('неизвестное устройство отклонено', () => payments.verifyDeviceRequest({
  ...signed('{}'), deviceId: 'no-such-device',
}), 401);

check('ключ устройства не уходит в админку',
  payments.adminDevices().every((d) => !('secret' in d)));

/* ---------- спор и поддержка ---------- */

const chat = payments.openDispute(b.id, p2.id);
check('спор открывает чат', !!chat.id);
check('спор переводит заявку в разбор',
  payments.getPayment(p2.id, b.id).status === 'MANUAL_REVIEW');
check('в чате есть приветствие', payments.supportChat(chat.id).messages.length === 1);
check('повторный спор открывает тот же чат', payments.openDispute(b.id, p2.id).id === chat.id);
fails('спор по чужой заявке невозможен', () => payments.openDispute(a.id, p2.id));

payments.addSupportMessage(chat.id, 'USER', b.id, 'Оплатил, деньги не пришли');
check('сообщение игрока считается непрочитанным у админа',
  payments.supportChat(chat.id).chat.unread_admin === 2);
payments.addSupportMessage(chat.id, 'ADMIN', 1, 'Проверяем');
check('ответ админа считается непрочитанным у игрока',
  payments.supportChat(chat.id).chat.unread_user === 1);
fails('пустое сообщение не отправляется',
  () => payments.addSupportMessage(chat.id, 'USER', b.id, '   '));
check('чат виден в админке', payments.adminChats().some((c) => c.id === chat.id));

/* ---------- настройки ---------- */

fails('номер не из цифр отклонён',
  () => payments.updatePaymentSettings({ beeline_phone: 'позвоните мне' }));
fails('минимум выше максимума отклонён',
  () => payments.updatePaymentSettings({ payment_min: '5000', payment_max: '100' }));
check('после неудачного сохранения настройки прежние',
  payments.paymentSettings().payment_min === '500');

payments.updatePaymentSettings({ beeline_completed_limit: '1500' });
const usage = payments.beelineLimitUsage();
check('лимит учитывает принятое', usage.completed === 1000);
check('лимит учитывает зарезервированное активными заявками', usage.reserved > 0);
fails('заявка сверх лимита отклонена',
  () => payments.createPayment(a.id, 100000, 'sber'), 'REQUISITE_LIMIT');
payments.updatePaymentSettings({ beeline_completed_limit: '0' });
check('нулевой лимит снимает ограничение', payments.beelineLimitUsage().remaining === null);

check('сводка админки считает оплаченные', payments.paymentDashboard().paid === 1);
check('в админке видны заявки всех игроков',
  new Set(payments.adminPayments('ALL').map((r) => r.user_id)).size === 2);
check('фильтр по статусу работает',
  payments.adminPayments('PAID').every((r) => r.status === 'PAID'));

/* ---------- поощрение первого пополнения ---------- */

process.env.FIRST_DEPOSIT_PCT = '100';
process.env.FIRST_DEPOSIT_MAX = '1000';
process.env.FIRST_DEPOSIT_MIN = '500';
process.env.FIRST_DEPOSIT_WAGER = '2';

const c = getOrCreateUser({ id: 'pay-c', username: 'c' });
const pc = payments.createPayment(c.id, 800, 'sber');
pay(pc);
check('первое пополнение удвоено', getUserById(c.id).balance === 1600,
  String(getUserById(c.id).balance));
check('бонус записан как выданный', getUserById(c.id).bonus_granted === 800);
check('бонус требует отыгрыша', getUserById(c.id).wager_required === 1600);
check('бонус не даёт права на вывод', withdrawable(getUserById(c.id)) === 0);

const pc2 = payments.createPayment(c.id, 900, 'sber');
pay(pc2);
check('второе пополнение бонуса не даёт', getUserById(c.id).balance === 2500,
  String(getUserById(c.id).balance));

const d = getOrCreateUser({ id: 'pay-d', username: 'd' });
const pd = payments.createPayment(d.id, 500, 'sber');
db.prepare('UPDATE payment_requests SET original_amount=? WHERE id=?').run(400, pd.id);
pay({ ...pd, original_amount: 400 });
check('пополнение ниже порога бонуса не получает',
  getUserById(d.id).balance === 400, String(getUserById(d.id).balance));

const e = getOrCreateUser({ id: 'pay-e', username: 'e' });
const pe = payments.createPayment(e.id, 100000, 'sber');
pay(pe);
check('бонус ограничен потолком',
  getUserById(e.id).balance === 101000, String(getUserById(e.id).balance));

/* ---------- итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

if (failures.length) {
  console.error(`Платежи: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Платежи: ${passed} проверок пройдено`);
