/**
 * Служебный бот: оповещения, привязка Telegram и подтверждение входа в панель.
 *
 *   npm run test:ops
 *
 * Сеть подменена: Telegram отвечает заглушкой, тест смотрит, что именно ему
 * отправили. Обновления бота подаются напрямую в разборщики (_test), без
 * долгого опроса.
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/ops-test.db';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
delete process.env.DEV_MODE;
delete process.env.OPS_2FA;
delete process.env.OPS_ALERT_CHAT_ID;
process.env.PAYOUT_DATA_KEY = '0'.repeat(64);
process.env.OPS_BOT_TOKEN = '777:ops';
process.env.SITE_URL = 'https://luckybox.test';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};
const throwsCode = (fn, code) => { try { fn(); return false; } catch (err) { return err.code === code; } };

/* ---------- Подмена Telegram ---------- */

const sent = [];
let messageId = 100;
globalThis.fetch = async (url, opts = {}) => {
  const method = String(url).split('/').pop();
  const body = opts.body ? JSON.parse(opts.body) : {};
  sent.push({ method, body });
  const result = method === 'sendMessage' ? { message_id: ++messageId } : true;
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
};
const sentTo = (chatId) => sent.filter((s) => s.method === 'sendMessage' && String(s.body.chat_id) === String(chatId));
const flush = () => new Promise((r) => setTimeout(r, 20));

const db = await import('../server/db.js');
const ops = await import('../server/ops.js');
const { bot, onMessage, onCallback, recent } = ops._test;
bot.username = 'lb_ops_bot';

/* ---------- Подготовка: владелец и сессия ---------- */

const owner = db.createEmailUser({ email: 'owner@mail.ru', passwordHash: 'x', nick: 'Владелец' });
const support = db.createEmailUser({ email: 'support@mail.ru', passwordHash: 'x', nick: 'Поддержка' });
db.syncStaff(['owner@mail.ru']);
db.staffSave(owner.id, { userKey: 'support@mail.ru', role: 'support' });
const SESSION = 'h'.repeat(64);
db.createSession({ tokenHash: SESSION, userId: owner.id, ttlMs: 3_600_000, ip: '1.1.1.1', userAgent: 't' });

/* ---------- 1. Включение ---------- */

check('с токеном подтверждение входа требуется', ops.twoFactorRequired());
process.env.OPS_2FA = 'off';
check('OPS_2FA=off - аварийно выключено', !ops.twoFactorRequired());
delete process.env.OPS_2FA;
bot.broken = 'тест';
check('сломанный бот не запирает панель', !ops.twoFactorRequired());
bot.broken = '';
const token = process.env.OPS_BOT_TOKEN;
delete process.env.OPS_BOT_TOKEN;
check('без токена всё выключено', !ops.twoFactorRequired() && !ops.opsConfigured());
check('без токена оповещение молчит', ops.alert('x', 'y') === false);
process.env.OPS_BOT_TOKEN = token;

/* ---------- 2. Привязка ---------- */

{
  const url = ops.createLink(owner.id);
  check('ссылка привязки ведёт в бота', url.startsWith('https://t.me/lb_ops_bot?start=link_'), url);
  const code = url.split('link_')[1];

  await onMessage({ text: '/start link_wrong', chat: { id: 5001, type: 'private' }, from: { id: 5001 } });
  check('чужой код не привязывает', !db.staffRow(owner.id).ops_chat_id);
  check('на чужой код бот отвечает', /устарела/.test(sentTo(5001).at(-1)?.body.text || ''));

  await onMessage({ text: `/start link_${code}`, chat: { id: 5001, type: 'private' }, from: { id: 5001 } });
  check('привязка записала чат', db.staffRow(owner.id).ops_chat_id === '5001');
  check('бот подтвердил привязку', /Готово/.test(sentTo(5001).at(-1)?.body.text || ''));

  await onMessage({ text: `/start link_${code}`, chat: { id: 6001, type: 'private' }, from: { id: 6001 } });
  check('ссылка одноразовая', db.staffRow(owner.id).ops_chat_id === '5001');

  // Аккаунт с Telegram: привязать можно только его же.
  db.linkTelegram(support.id, { id: 7001, username: 'sup' });
  const supUrl = ops.createLink(support.id);
  await onMessage({ text: `/start link_${supUrl.split('link_')[1]}`, chat: { id: 7999, type: 'private' }, from: { id: 7999 } });
  check('чужой Telegram к аккаунту с Telegram не привязать', !db.staffRow(support.id).ops_chat_id);
  const supUrl2 = ops.createLink(support.id);
  await onMessage({ text: `/start link_${supUrl2.split('link_')[1]}`, chat: { id: 7001, type: 'private' }, from: { id: 7001 } });
  check('свой Telegram привязывается', db.staffRow(support.id).ops_chat_id === '7001');

  // Игрок без доступа в панель ссылку не получит, а и получи - не привяжет.
  const player = db.createEmailUser({ email: 'player@mail.ru', passwordHash: 'x', nick: 'Игрок' });
  const pUrl = ops.createLink(player.id);
  await onMessage({ text: `/start link_${pUrl.split('link_')[1]}`, chat: { id: 8001, type: 'private' }, from: { id: 8001 } });
  check('без доступа в панель привязки нет', /Доступа/.test(sentTo(8001).at(-1)?.body.text || ''));

  await onMessage({ text: 'привет', chat: { id: 9001, type: 'private' }, from: { id: 9001 } });
  check('на прочее бот объясняет, кто он', /служебный бот/.test(sentTo(9001).at(-1)?.body.text || ''));
  await onMessage({ text: `/start link_x`, chat: { id: -100, type: 'group' }, from: { id: 1 } });
  check('в группах бот молчит', sentTo(-100).length === 0);
}

/* ---------- 3. Подтверждение кнопкой ---------- */

{
  check('до подтверждения сессия не пущена', !ops.sessionConfirmed(SESSION));
  const st = ops.twoFactorState(owner.id, SESSION);
  check('состояние: требуется, привязан, не подтверждён', st.required && st.linked && !st.confirmed && st.bot === 'lb_ops_bot');

  const { id } = await ops.requestApproval(owner.id, SESSION, { ip: '9.9.9.9', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });
  const msg = sentTo(5001).at(-1)?.body;
  check('запрос ушёл в привязанный чат', !!msg && /Вход в панель/.test(msg.text));
  check('в запросе адрес и браузер', /9\.9\.9\.9/.test(msg.text) && /Chrome, Windows/.test(msg.text));
  check('в запросе две кнопки', msg.reply_markup?.inline_keyboard?.[0]?.length === 2);

  // Нажатие из чужого чата ничего не делает.
  await onCallback({ id: 'q1', data: `ok:${id}`, message: { chat: { id: 4242 }, text: msg.text } });
  check('чужой чат не подтверждает', !ops.sessionConfirmed(SESSION));

  await onCallback({ id: 'q2', data: `ok:${id}`, message: { chat: { id: 5001 }, text: msg.text } });
  check('«Это я» пускает сессию', ops.sessionConfirmed(SESSION));
  check('статус запроса - подтверждён', ops.challengeStatus(id, owner.id) === 'approved');
  check('сообщение помечено', sent.some((s) => s.method === 'editMessageText' && /ПОДТВЕРЖДЕНО/.test(s.body.text)));

  await onCallback({ id: 'q3', data: `no:${id}`, message: { chat: { id: 5001 }, text: msg.text } });
  check('повторное нажатие по закрытому запросу не действует', ops.sessionConfirmed(SESSION));
}

/* ---------- 4. Код и «Это не я» ---------- */

{
  const S2 = 'b'.repeat(64);
  db.createSession({ tokenHash: S2, userId: owner.id, ttlMs: 3_600_000 });
  const { id } = await ops.requestApproval(owner.id, S2, { ip: '2.2.2.2', userAgent: '' });
  const code = /Код: (\d{6})/.exec(sentTo(5001).at(-1).body.text)?.[1];
  check('в сообщении шестизначный код', /^\d{6}$/.test(code || ''));
  check('неверный код отклонён', throwsCode(() => ops.confirmByCode(id, owner.id, '000000' === code ? '111111' : '000000'), 'BAD_CODE'));
  check('чужой не подтвердит чужой запрос', throwsCode(() => ops.confirmByCode(id, support.id, code), 'EXPIRED'));
  ops.confirmByCode(id, owner.id, code);
  check('верный код пускает', ops.sessionConfirmed(S2));

  const S3 = 'c'.repeat(64);
  db.createSession({ tokenHash: S3, userId: owner.id, ttlMs: 3_600_000 });
  const r3 = await ops.requestApproval(owner.id, S3, { ip: '6.6.6.6', userAgent: '' });
  for (let i = 0; i < 5; i++) { try { ops.confirmByCode(r3.id, owner.id, 'nope'); } catch { /* ожидаемо */ } }
  check('пять неверных кодов сжигают запрос', ops.challengeStatus(r3.id, owner.id) === 'burned');

  const S4 = 'd'.repeat(64);
  db.createSession({ tokenHash: S4, userId: owner.id, ttlMs: 3_600_000 });
  const r4 = await ops.requestApproval(owner.id, S4, { ip: '6.6.6.6', userAgent: '' });
  const before = sent.length;
  await onCallback({ id: 'q4', data: `no:${r4.id}`, message: { chat: { id: 5001 }, text: 'x' } });
  await flush();
  check('«Это не я» закрывает ту сессию', !db.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(S4));
  check('«Это не я» поднимает тревогу',
    sent.slice(before).some((s) => s.method === 'sendMessage' && /Отклонён вход/.test(s.body.text)));

  const S5 = 'e'.repeat(64);
  db.createSession({ tokenHash: S5, userId: owner.id, ttlMs: 3_600_000 });
  const r5 = await ops.requestApproval(owner.id, S5, { ip: '', userAgent: '' });
  await ops.requestApproval(owner.id, S5, { ip: '', userAgent: '' });
  check('новый запрос заменяет прежний', ops.challengeStatus(r5.id, owner.id) === 'replaced');
  db.db.prepare('UPDATE admin_challenges SET expires_at = 1 WHERE user_id = ?').run(owner.id);
  check('просроченный запрос не принимается', throwsCode(() => ops.confirmByCode(r5.id + 1, owner.id, '123456'), 'EXPIRED'));

  const unlinked = db.createEmailUser({ email: 'new@mail.ru', passwordHash: 'x', nick: 'Новый' });
  db.staffSave(owner.id, { userKey: 'new@mail.ru', role: 'support' });
  let err = null;
  try { await ops.requestApproval(unlinked.id, 'f'.repeat(64), {}); } catch (e) { err = e; }
  check('без привязки запрос не отправить', err?.code === 'NOT_LINKED');
}

/* ---------- 5. Оповещения ---------- */

{
  recent.clear();
  const before = sent.length;
  check('первое оповещение уходит', ops.alert('k1', 'Сломалось') === true);
  await flush();
  const first = sent.slice(before).filter((s) => s.method === 'sendMessage');
  check('оповещение получил владелец', first.some((s) => s.body.chat_id === '5001'));
  check('поддержка оповещения не получает', !first.some((s) => s.body.chat_id === '7001'));
  check('в оповещении сайт', /СБОЙ · luckybox\.test/.test(first[0]?.body.text || ''));
  check('повтор того же сбоя молчит', ops.alert('k1', 'Сломалось') === false);
  check('другой сбой уходит', ops.alert('k2', 'Другое') === true);

  process.env.OPS_ALERT_CHAT_ID = '-1009';
  const b2 = sent.length;
  ops.alert('k3', 'В общий чат');
  await flush();
  check('OPS_ALERT_CHAT_ID тоже получает', sent.slice(b2).some((s) => s.body.chat_id === '-1009'));
  delete process.env.OPS_ALERT_CHAT_ID;

  const b3 = sent.length;
  for (let i = 0; i < 9; i++) ops.countError('c1', 'Ошибки 500', { threshold: 10 });
  await flush();
  check('девять ошибок - ещё не повод', sent.length === b3);
  ops.countError('c1', 'Ошибки 500', { threshold: 10 });
  await flush();
  check('десятая ошибка будит', sent.slice(b3).some((s) => /Ошибки 500/.test(s.body.text || '')));
}

/* ---------- 6. Telegram владельца из .env ---------- */

{
  process.env.OPS_OWNER_CHAT_ID = '8602356502';
  const S6 = 'g'.repeat(64);
  db.createSession({ tokenHash: S6, userId: owner.id, ttlMs: 3_600_000 });
  check('закреплённый Telegram считается привязкой', ops.twoFactorState(owner.id, S6).linked);
  await ops.requestApproval(owner.id, S6, { ip: '3.3.3.3', userAgent: '' });
  check('запрос входа владельца уходит в закреплённый чат',
    /Вход в панель/.test(sentTo('8602356502').at(-1)?.body.text || ''));

  const url = ops.createLink(owner.id);
  await onMessage({ text: `/start link_${url.split('link_')[1]}`, chat: { id: 4444, type: 'private' }, from: { id: 4444 } });
  check('к владельцу не привязать другой Telegram', /задан на сервере/.test(sentTo(4444).at(-1)?.body.text || ''));
  check('прежняя привязка не перезаписана', db.staffRow(owner.id).ops_chat_id === '5001');

  // Закрепление касается только владельцев из .env: у поддержки свой чат.
  const S7 = 'k'.repeat(64);
  db.createSession({ tokenHash: S7, userId: support.id, ttlMs: 3_600_000 });
  await ops.requestApproval(support.id, S7, { ip: '', userAgent: '' });
  check('поддержка получает запрос в свой чат', /Вход в панель/.test(sentTo(7001).at(-1)?.body.text || ''));

  recent.clear();
  const b = sent.length;
  ops.alert('pin', 'Проверка закреплённого');
  await flush();
  check('оповещения идут в закреплённый чат', sent.slice(b).some((x) => x.body.chat_id === '8602356502'));
  delete process.env.OPS_OWNER_CHAT_ID;
}

/* ---------- Итог ---------- */

console.log(`\nСлужебный бот: пройдено ${passed}, не пройдено ${failures.length}`);
for (const f of failures) console.log('  ✗', f);
db.db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
process.exit(failures.length ? 1 : 0);
