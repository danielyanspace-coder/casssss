/**
 * Шлюз Sicilia: подписи, ордер через API и платёжное окно, зачисление, выплаты.
 *
 *   npm run test:sicilia
 *
 * Сеть подменена: fetch отвечает так, как описано в документации шлюза
 * (https://documenter.getpostman.com/view/24855881/2sB2x2LaNf), и тест
 * смотрит, что именно мы отправили. Подписи сверяются с формулами из их
 * проверочного bash-скрипта.
 */
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

process.env.DB_PATH = './data/sicilia-test.db';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
Object.assign(process.env, {
  SICILIA_API_URL: 'https://api.test/api',
  SICILIA_PAY_URL: 'https://pay.test',
  // Старые проверки ниже - про окно; ордер через API проверяется своим блоком.
  SICILIA_PAYIN: 'window',
  SICILIA_MERCHANT: '7',
  SICILIA_LOGIN: 'lucky',
  SICILIA_API_KEY: 'k3y',
  SICILIA_MIN: '500',
  SICILIA_MAX: '100000',
  SICILIA_ORDER_TTL_MIN: '30',
  WEBAPP_URL: 'https://luckybox.test',
  // Ключ шифрования карт только для этой тестовой базы: без него заявка на
  // вывод на карту не создаётся вовсе.
  PAYOUT_DATA_KEY: '0'.repeat(64),
});

const { db, getOrCreateUser, getUserById, createPayout } = await import('../server/db.js');
const s = await import('../server/sicilia.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};
const sha = (str) => createHash('sha256').update(str).digest('hex');

/* ---------- Подмена сети ---------- */

const calls = [];
let reply = () => ({ status: 404, body: { message: 'нет' } });
globalThis.fetch = async (url, opts = {}) => {
  // Чек к ордеру уходит формой (multipart), остальное - JSON.
  const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body || null;
  calls.push({ url: String(url), method: opts.method || 'GET', body, headers: opts.headers || {} });
  const r = reply(String(url), opts.method || 'GET', body);
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};
// Сколько зачислено пополнениями Sicilia: баланс сверх этого - бонус за
// первое пополнение, его начисляет registerDeposit.
const siciliaPaid = (userId) => db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM deposits WHERE user_id = ? AND source = 'sicilia'")
  .get(userId).n;
const lastCall = (part) => [...calls].reverse().find((c) => c.url.includes(part));

let tg = 9_100_000;
function player(balance = 0) {
  const u = getOrCreateUser({ id: ++tg, username: `s${tg}`, first_name: 'S' });
  // Подготовка тестовой базы, а не правка денег игрока.
  db.prepare('UPDATE users SET balance = ?, deposit_debt = 0, wager_required = 0 WHERE id = ?').run(balance, u.id);
  return getUserById(u.id);
}

/* ---------- Подписи ---------- */

{
  check('подпись ордера: sha256(login:sum:invid:apiKey)', s.signPayin('1000', 'inv1') === sha('lucky:1000:inv1:k3y'));
  check('подпись отзыва: sha256(login:invid:apiKey)', s.signInvid('inv1') === sha('lucky:inv1:k3y'));
  check('подпись выплаты: sha256(login:sum:invid:apiKey:PAYOUT)', s.signPayout('500', 'p1') === sha('lucky:500:p1:k3y:PAYOUT'));
  check('колбэк пополнения: подпись sha256(OutSum:InvId:apiKey)',
    s.verifyCallback({ InvId: 'a', OutSum: '100.0000', SignatureValue: sha('100.0000:a:k3y') }));
  check('колбэк пополнения: чужая подпись отвергается',
    !s.verifyCallback({ InvId: 'a', OutSum: '100.0000', SignatureValue: sha('100:a:k3y') }));
  check('колбэк пополнения: без подписи отвергается', !s.verifyCallback({ InvId: 'a', OutSum: '1' }));
  check('колбэк выплаты: подпись sha256(login:sum:invid:apiKey)',
    s.verifyCallback({ order_type: 'payout', invid: 'p', sum: '500', signature: sha('lucky:500:p:k3y') }));
  check('колбэк выплаты: подпись пополнения не подходит',
    !s.verifyCallback({ order_type: 'payout', invid: 'p', sum: '500', signature: sha('500:p:k3y') }));
}

/* ---------- Платёжное окно ---------- */

{
  const u = player();
  let err = null;
  try { await s.createDeposit(u.id, 100); } catch (e) { err = e; }
  check('пополнение ниже минимума отклонено', err?.code === 'MIN');
  err = null;
  try { await s.createDeposit(u.id, 200000); } catch (e) { err = e; }
  check('пополнение выше максимума отклонено', err?.code === 'MAX');

  const d = await s.createDeposit(u.id, 1500);
  const url = new URL(d.url);
  const invid = url.searchParams.get('invid');
  check('окно: адрес из SICILIA_PAY_URL', url.origin === 'https://pay.test');
  check('окно: сумма, мерчант, игрок', url.searchParams.get('sum') === '1500' && url.searchParams.get('merchant') === '7'
    && url.searchParams.get('external_user_id') === String(u.id));
  check('окно: подпись ссылки', url.searchParams.get('signature') === sha(`lucky:1500:${invid}:k3y`));
  check('окно: колбэк и возврат на наш адрес',
    url.searchParams.get('callback_url') === 'https://luckybox.test/api/webhooks/sicilia'
    && url.searchParams.get('redirect_url') === 'https://luckybox.test');
  check('окно: сети не трогали - ордер заводит само окно', calls.length === 0);
  check('окно: та же ссылка открывается снова', s.reopenDeposit(d.id, u.id).url === d.url);

  const saved = process.env.SICILIA_PAY_URL;
  process.env.SICILIA_PAY_URL = '';
  err = null;
  try { await s.createDeposit(u.id, 1500); } catch (e) { err = e; }
  check('без адреса окна пополнение недоступно', err?.code === 'NOT_CONFIGURED' && !s.payinReady());
  process.env.SICILIA_PAY_URL = saved;

  /* ---------- Колбэк и зачисление ---------- */

  const statusReply = (status, extra = {}) => (u2, m, body) => (u2.endsWith('/orders/check-status')
    ? { status: 200, body: { id: 55, invid: body.invid, status, sum: '1500.0000', fact_sum: null, ...extra } }
    : { status: 404, body: {} });
  const cb = { InvId: invid, OutSum: '1500.0000', Status: 'completed', SignatureValue: sha(`1500.0000:${invid}:k3y`) };

  // Колбэк врёт: «completed», а шлюз на прямой вопрос говорит «processing».
  reply = statusReply('processing');
  const lied = await s.handleCallback(cb);
  check('колбэк без подтверждения шлюза денег не даёт', !lied.credited && getUserById(u.id).balance === 0);
  const asked = lastCall('/orders/check-status');
  check('статус спрашиваем своей подписью',
    asked && asked.body.invid === invid && asked.body.signature === sha(`lucky:1500:${invid}:k3y`) && asked.body.merchant === 7);

  reply = statusReply('completed');
  const ok = await s.handleCallback(cb);
  const after = getUserById(u.id);
  // Бонус за первое пополнение ложится на бонусный счёт, свои - ровно сумма.
  check('подтверждённое пополнение зачислено', ok.credited && ok.amount === 1500 && siciliaPaid(u.id) === 1500
    && after.balance === 1500 && after.bonus_balance === ok.bonus, JSON.stringify(ok));
  check('пополнение идёт через registerDeposit: долг отыгрыша и счётчик',
    after.deposit_debt >= 1500 && after.deposits_count === 1);
  check('пополнение записано в историю пополнений',
    db.prepare("SELECT COUNT(*) AS n FROM deposits WHERE user_id = ? AND source = 'sicilia'").get(u.id).n === 1);
  const again = await s.handleCallback(cb);
  await s.applyPayinStatus(d.id, { status: 'completed', sum: '1500' });
  check('повторный колбэк второй раз не зачисляет', !again.credited && siciliaPaid(u.id) === 1500
    && getUserById(u.id).balance === after.balance);

  // Сумму поправили вручную: зачисляется FactSum, дробь отбрасывается.
  const u2 = player();
  const d2 = await s.createDeposit(u2.id, 2000);
  reply = statusReply('completed', { fact_sum: 1800.75 });
  const fixed = await s.refreshDeposit(d2.id, u2.id);
  check('зачисляется фактическая сумма, если шлюз её поправил', fixed.credited && siciliaPaid(u2.id) === 1800,
    String(siciliaPaid(u2.id)));

  // Шлюз ответил про чужой ордер - статус не применяется.
  const u3 = player();
  const d3 = await s.createDeposit(u3.id, 900);
  reply = () => ({ status: 200, body: { invid: 'чужой', status: 'completed', sum: '900' } });
  let mism = null;
  try { await s.refreshDeposit(d3.id, u3.id); } catch (e) { mism = e; }
  check('ответ про другой ордер не применяется', mism?.code === 'MISMATCH' && getUserById(u3.id).balance === 0);

  // Окно не открывали: шлюз ордера не знает - это «ждём», а не ошибка.
  reply = () => ({ status: 422, body: { message: 'Order not found' } });
  const wait = await s.refreshDeposit(d3.id, u3.id);
  check('ордер ещё не заведён - проверка отвечает «ждём»', wait.credited === false && wait.payment.status === 'created');

  reply = statusReply('cancelled');
  await s.refreshDeposit(d3.id, u3.id);
  check('отменённый шлюзом ордер не зачисляется', getUserById(u3.id).balance === 0
    && s.listDeposits(u3.id)[0].status === 'cancelled');
  let closed = null;
  try { s.reopenDeposit(d3.id, u3.id); } catch (e) { closed = e; }
  check('закрытую оплату заново не открыть', closed?.code === 'CLOSED');

  /* ---------- Сверка и отзыв просроченных ---------- */

  const u4 = player();
  const d4 = await s.createDeposit(u4.id, 700);
  const inv4 = db.prepare('SELECT invid FROM sicilia_orders WHERE id = ?').get(d4.id).invid;
  db.prepare('UPDATE sicilia_orders SET created_at = ?, expires_at = ? WHERE id = ?')
    .run(Date.now() - 31 * 60_000, Date.now() - 60_000, d4.id);
  reply = (u5) => (u5.endsWith('/orders/check-status')
    ? { status: 200, body: { invid: inv4, status: 'processing', sum: '700' } }
    : u5.endsWith('/orders/unclaimed') ? { status: 200, body: {} } : { status: 404, body: {} });
  calls.length = 0;
  await s.reconcile();
  const un = lastCall('/orders/unclaimed');
  check('сверка: просроченный ордер отозван у шлюза', un && un.method === 'PUT'
    && un.body.order_invid === inv4 && un.body.signature === sha(`lucky:${inv4}:k3y`));
  check('сверка: просроченный помечен истёкшим', s.listDeposits(u4.id)[0].status === 'expired');

  const u5 = player();
  const d5 = await s.createDeposit(u5.id, 600);
  db.prepare('UPDATE sicilia_orders SET created_at = ? WHERE id = ?').run(Date.now() - 5 * 60_000, d5.id);
  const inv5 = db.prepare('SELECT invid FROM sicilia_orders WHERE id = ?').get(d5.id).invid;
  reply = () => ({ status: 200, body: { invid: inv5, status: 'completed', sum: '600' } });
  await s.reconcile();
  check('сверка: потерянный колбэк не теряет деньги', siciliaPaid(u5.id) === 600);
}

/* ---------- Ордер через API: реквизит у нас в кассе ---------- */

{
  process.env.SICILIA_PAYIN = 'h2h';
  const savedPay = process.env.SICILIA_PAY_URL;
  process.env.SICILIA_PAY_URL = '';
  check('через API пополнение доступно и без адреса окна', s.payinReady());

  // Ответ orders/create из их документации.
  const created = (body, extra = {}) => ({
    id: 212, invid: body.invid, exist: 'new', status: 'processing', operation: 'Пополнение',
    card: { number: '2200 1234 5678 9010', telefon: '79991234567', account_number: '40817810000000000001', bank_id_code: '044525225', payment_link: null },
    currency: 'RUB', sum: `${body.sum}.0000`, fact_sum: null, fio: 'Иванов И', bank: 'sberbank',
    bank_data: { name: 'Сбербанк', code: 'sberbank', logo: '', code_nspk: '100000000111' },
    deeplink: body.sender_bank ? 'https://deep.link/pay' : null,
    sbp: true, account_transfer: false, trans_gov: null, trans_gov_country: null, ...extra,
  });
  let createdReply = created;
  reply = (url, m, body) => (url.endsWith('/orders/create') ? { status: 201, body: createdReply(body) }
    : url.endsWith('/orders/check-status') ? { status: 200, body: { invid: body.invid, status: 'processing', sum: '1000' } }
      : url.endsWith('/orders/unclaimed') ? { status: 200, body: {} } : { status: 404, body: {} });

  const u = player();
  let err = null;
  try { await s.createDeposit(u.id, 1000, { method: 'qr' }); } catch (e) { err = e; }
  check('api: неизвестный способ оплаты отклонён', err?.code === 'BAD_METHOD');

  calls.length = 0;
  const d = await s.createDeposit(u.id, 1000, { method: 'sbp', senderBank: 'sberbank' });
  const sent = lastCall('/orders/create');
  check('api: ордер заводим сами, POST orders/create', sent && sent.method === 'POST');
  check('api: метод СБП, рубли, сумма, мерчант, игрок', sent.body.bank === 'sbp' && sent.body.currency === 'RUB'
    && sent.body.sum === 1000 && sent.body.merchant === 7 && sent.body.external_user_id === String(u.id)
    && sent.body.operation === 'Пополнение');
  check('api: подпись ордера sha256(login:sum:invid:apiKey)', sent.body.signature === sha(`lucky:1000:${sent.body.invid}:k3y`));
  check('api: колбэк на наш адрес', sent.body.callback_url === 'https://luckybox.test/api/webhooks/sicilia');
  check('api: банк игрока уходит для диплинка', sent.body.sender_bank === 'sberbank');
  check('api: игрок получает реквизит', d.requisite && d.requisite.phone === '79991234567'
    && d.requisite.card === '2200123456789010' && d.requisite.holder === 'Иванов И' && d.requisite.bank === 'Сбербанк',
    JSON.stringify(d.requisite));
  check('api: сумма к оплате и таймер', d.paySum === 1000 && d.expiresAt > Date.now() + 29 * 60_000
    && d.expiresAt <= Date.now() + 30 * 60_000);
  check('api: диплинк банка передан игроку', d.requisite.deeplink === 'https://deep.link/pay');
  check('api: ссылки на окно у такого ордера нет', !d.url);
  check('api: ключ и подпись игроку не уходят', !JSON.stringify(d).includes('k3y') && !('signature' in d));

  err = null;
  try { await s.createDeposit(u.id, 2000, { method: 'card' }); } catch (e) { err = e; }
  check('api: второй открытый перевод не заводится, игрок видит первый', err?.code === 'OPEN_ORDER' && err.order?.id === d.id);

  const again = s.reopenDeposit(d.id, u.id);
  check('api: возврат в кассу показывает тот же реквизит', again.requisite?.phone === '79991234567' && !again.url);

  // Отмена: сначала статус, потом отзыв у шлюза.
  calls.length = 0;
  const cancelled = await s.cancelDeposit(d.id, u.id);
  check('api: отмена сначала спрашивает статус', calls[0]?.url.endsWith('/orders/check-status'));
  const un = lastCall('/orders/unclaimed');
  check('api: отмена отзывает ордер у шлюза', un && un.body.order_invid === sent.body.invid
    && un.body.signature === sha(`lucky:${sent.body.invid}:k3y`));
  check('api: отменённый закрыт и реквизит больше не показывается',
    cancelled.payment.status === 'unclaimed' && cancelled.payment.requisite === null);
  check('api: в истории реквизита закрытого перевода нет', s.listDeposits(u.id).every((r) => !r.requisite));

  // Отмена уже оплаченного: деньги зачисляются, а не теряются.
  const d2 = await s.createDeposit(u.id, 1000, { method: 'card' });
  check('api: перевод на карту - метод any-bank', lastCall('/orders/create').body.bank === 'any-bank'
    && d2.requisite.card === '2200123456789010');
  reply = (url, m, body) => (url.endsWith('/orders/check-status')
    ? { status: 200, body: { invid: body.invid, status: 'completed', sum: '1000.0000', fact_sum: null } }
    : { status: 200, body: {} });
  calls.length = 0;
  const late = await s.cancelDeposit(d2.id, u.id);
  check('api: отмена оплаченного перевода зачисляет его', late.credited && siciliaPaid(u.id) === 1000
    && !calls.some((c) => c.url.endsWith('/orders/unclaimed')));

  // Шлюз недоступен - отмена не делается вслепую.
  const u2 = player();
  reply = (url, m, body) => (url.endsWith('/orders/create') ? { status: 201, body: created(body) } : { status: 404, body: {} });
  const d3 = await s.createDeposit(u2.id, 800, { method: 'sbp' });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
  err = null;
  try { await s.cancelDeposit(d3.id, u2.id); } catch (e) { err = e; }
  globalThis.fetch = savedFetch;
  check('api: без ответа шлюза перевод не отменяется', err?.code === 'GATEWAY_UNREACHABLE'
    && s.listDeposits(u2.id)[0].status === 'processing');

  // Время вышло: реквизит скрыт сразу, не дожидаясь сверки.
  db.prepare('UPDATE sicilia_orders SET created_at = ?, expires_at = ? WHERE id = ?')
    .run(Date.now() - 31 * 60_000, Date.now() - 1000, d3.id);
  check('api: просроченный реквизит не показывается', s.listDeposits(u2.id)[0].requisite === null);
  err = null;
  try { s.reopenDeposit(d3.id, u2.id); } catch (e) { err = e; }
  check('api: просроченный перевод заново не открыть', err?.code === 'CLOSED');
  reply = (url, m, body) => (url.endsWith('/orders/check-status')
    ? { status: 200, body: { invid: body.invid, status: 'processing', sum: '800' } } : { status: 200, body: {} });
  await s.reconcile();
  check('api: сверка закрывает просроченный по его сроку', s.listDeposits(u2.id)[0].status === 'expired');

  // Нет свободного реквизита - понятный отказ, строка закрыта.
  const u3 = player();
  reply = () => ({ status: 422, body: { message: 'No available calls' } });
  err = null;
  try { await s.createDeposit(u3.id, 900, { method: 'sbp' }); } catch (e) { err = e; }
  check('api: «No available calls» - игроку «нет свободных реквизитов»', err?.code === 'NO_REQUISITE'
    && /реквизит/.test(err.message));
  check('api: неудачный ордер закрыт и не мешает следующему', s.listDeposits(u3.id)[0].status === 'error');

  // Шлюз ответил без реквизита - ордер отзывается, игрок ничего не видит.
  createdReply = (body) => created(body, { card: {} });
  reply = (url, m, body) => (url.endsWith('/orders/create') ? { status: 201, body: createdReply(body) } : { status: 200, body: {} });
  calls.length = 0;
  err = null;
  try { await s.createDeposit(u3.id, 900, { method: 'sbp' }); } catch (e) { err = e; }
  check('api: ответ без реквизита - отказ и отзыв ордера', err?.code === 'GATEWAY_ERROR'
    && calls.some((c) => c.url.endsWith('/orders/unclaimed')));

  // Ответ про чужой ордер не показывается игроку.
  createdReply = (body) => created({ ...body, invid: 'чужой' });
  err = null;
  try { await s.createDeposit(u3.id, 900, { method: 'sbp' }); } catch (e) { err = e; }
  check('api: реквизит чужого ордера не показывается', err?.code === 'GATEWAY_ERROR');

  // Сеть оборвалась на создании: ордер мог создаться, строку не закрываем.
  const u4 = player();
  globalThis.fetch = async () => { throw new Error('timeout'); };
  err = null;
  try { await s.createDeposit(u4.id, 900, { method: 'sbp' }); } catch (e) { err = e; }
  globalThis.fetch = savedFetch;
  check('api: обрыв на создании оставляет строку сверке', err?.code === 'GATEWAY_UNREACHABLE'
    && s.listDeposits(u4.id)[0].status === 'created');

  // Перевод по счёту: номер счёта и БИК, только когда шлюз так сказал.
  const u5 = player();
  createdReply = (body) => created(body, { account_transfer: true, card: { account_number: '40817810000000000001', bank_id_code: '044525225' } });
  reply = (url, m, body) => (url.endsWith('/orders/create') ? { status: 201, body: createdReply(body) } : { status: 200, body: {} });
  const d5 = await s.createDeposit(u5.id, 900, { method: 'card' });
  check('api: перевод по счёту - счёт и БИК', d5.requisite.account === '40817810000000000001' && d5.requisite.bik === '044525225');

  process.env.SICILIA_PAY_URL = savedPay;
  process.env.SICILIA_PAYIN = 'window';
}

/* ---------- Банки ---------- */

{
  const list = [{ code: 'tinkoff', name: 'Тинькофф' }, { code: 'tatsotsbank', name: 'Татсоцбанк' },
    { code: 'sberbank', name: 'Сбербанк' }, { code: 'vtb', name: 'Банк ВТБ' }];
  check('банк: Т-Банк -> tinkoff, а не Татсоцбанк', s.matchBank('Т-Банк', list) === 'tinkoff');
  check('банк: ВТБ -> vtb', s.matchBank('ВТБ', list) === 'vtb');
  check('банк: точное название', s.matchBank('Сбербанк', list) === 'sberbank');
  check('банк: незнакомый - не угадываем', s.matchBank('Т', list) === null && s.matchBank('Какой-то банк', list) === null);
}

/* ---------- Выплаты ---------- */

{
  const admin = player();
  const u = player(20000);
  const { id } = createPayout(u.id, 5000, { method: 'sbp', phone: '+7 (912) 345-67-89', bank: 'Т-Банк' });

  reply = (url, m, body) => (url.endsWith('/payout/orders')
    ? { status: 201, body: { id: 3, status: 'opened', invid: body.invid, duplicate: false } }
    : { status: 404, body: {} });
  calls.length = 0;
  let err = null;
  try { await s.sendPayout(admin.id, id, ''); } catch (e) { err = e; }
  check('выплата без банка не уходит', err?.code === 'BAD_BANK' && calls.length === 0);

  const g = await s.sendPayout(admin.id, id, 'tinkoff');
  const sent = lastCall('/payout/orders');
  check('выплата: тело запроса по документации', sent && sent.body.sum === '5000' && sent.body.method === 'sbp'
    && sent.body.bank === 'tinkoff' && sent.body.requisite_num === '79123456789'
    && sent.body.signature === sha(`lucky:5000:${sent.body.invid}:k3y:PAYOUT`), JSON.stringify(sent?.body));
  check('выплата: заявка переведена в работу', db.prepare('SELECT status FROM payouts WHERE id = ?').get(id).status === 'processing');
  check('выплата: статус шлюза виден в панели', g.status === 'opened' && g.bank === 'tinkoff');
  err = null;
  try { await s.sendPayout(admin.id, id, 'tinkoff'); } catch (e) { err = e; }
  check('выплата: повторная отправка запрещена', err?.code === 'ALREADY');

  const inv = sent.body.invid;
  reply = (url) => (url.endsWith('/payout/orders/check-status')
    ? { status: 200, body: { invid: inv, status: 'completed', transfer_check: ['https://chk.test/1.pdf'] } }
    : { status: 404, body: {} });
  const done = await s.handleCallback({ order_type: 'payout', invid: inv, sum: '5000', status: 'completed',
    signature: sha(`lucky:5000:${inv}:k3y`) });
  const p = db.prepare('SELECT status, comment, resolved_by FROM payouts WHERE id = ?').get(id);
  check('выплата: подтверждённая шлюзом закрывает заявку', done.closed && p.status === 'paid' && p.resolved_by === admin.id,
    JSON.stringify(p));
  check('выплата: ссылка на чек сохранена', /chk\.test/.test(p.comment) && s.gatewayPayout(id).checkUrl === 'https://chk.test/1.pdf');

  // Шлюз отказал - заявка остаётся в работе, отправить можно снова.
  const u2 = player(20000);
  const card = createPayout(u2.id, 3000, { method: 'card', cardNumber: '4111111111111111' });
  reply = () => ({ status: 403, body: { error: 'Warn IP client address. Contact with support' } });
  err = null;
  try { await s.sendPayout(admin.id, card.id, 'sberbank'); } catch (e) { err = e; }
  check('выплата: отказ шлюза виден текстом', /Warn IP/.test(err?.message || '') && /Warn IP/.test(s.gatewayPayout(card.id).error));
  check('выплата: после отказа заявка в работе, деньги не вернулись игроку',
    db.prepare('SELECT status FROM payouts WHERE id = ?').get(card.id).status === 'processing');
  // Перед повтором сервер спрашивает, не дошла ли прошлая отправка: шлюз
  // отвечает «не найдено», и только тогда уходит новая.
  reply = (url, m, body) => (url.endsWith('/payout/orders/check-status')
    ? { status: 404, body: { message: 'Order not found' } }
    : { status: 201, body: { id: 4, status: 'opened', invid: body.invid } });
  await s.sendPayout(admin.id, card.id, 'sberbank');
  const cardSent = lastCall('/payout/orders');
  check('выплата на карту: номер карты и метод card', cardSent.body.requisite_num === '4111111111111111' && cardSent.body.method === 'card');

  // Колбэк «completed» без подтверждения шлюза заявку не закрывает.
  reply = () => ({ status: 200, body: { invid: cardSent.body.invid, status: 'in_progress' } });
  await s.handleCallback({ order_type: 'payout', invid: cardSent.body.invid, sum: '3000', status: 'completed',
    signature: sha(`lucky:3000:${cardSent.body.invid}:k3y`) });
  check('выплата: колбэк без подтверждения не закрывает заявку',
    db.prepare('SELECT status FROM payouts WHERE id = ?').get(card.id).status === 'processing');

  // Баланс мерчанта: подпись в заголовках.
  reply = () => ({ status: 200, body: { balance: 123.4, frozen_balance: 0 } });
  const bal = await s.merchantBalance();
  const bc = lastCall('/balance');
  check('баланс мерчанта: подпись sha256(timestamp:merchant:apiKey)', bal.balance === 123.4
    && bc.url.endsWith('/external/merchants/7/balance')
    && bc.headers.signature === sha(`${bc.headers.timestamp}:7:k3y`));
}

/* ---------- Споры: чек игрока, апелляция, колбэк закрытия, поздняя сверка ---------- */

{
  // Самая маленькая настоящая PNG: проверка типа идёт по первым байтам.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const u = player();
  const order = await s.createDeposit(u.id, 2000);
  const row = db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(order.id);
  check('номер платежа виден игроку для поддержки', order.number === row.invid && /^lb-/.test(order.number));

  reply = () => ({ status: 200, body: { id: 812, invid: row.invid, status: 'pending', sum: '2000' } });
  let refused = '';
  try { await s.reportDeposit(u.id, order.id, { comment: 'перевёл' }); } catch (e) { refused = e.code; }
  check('спор без чека не принимается', refused === 'NO_RECEIPT', refused);
  try { await s.reportDeposit(u.id, order.id, { image: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') }); }
  catch (e) { refused = e.code; }
  check('чек не картинкой не принимается', refused === 'BAD_FILE', refused);

  const rep = await s.reportDeposit(u.id, order.id, { comment: 'перевёл в 12:00 со Сбера', image: png });
  const d1 = db.prepare('SELECT * FROM sicilia_disputes WHERE order_id = ?').get(order.id);
  check('спор игрока заведён и ждёт сотрудника', !rep.credited && d1?.status === 'new' && d1.source === 'player');
  check('чек сохранён и отдаётся по случайному имени', s.RECEIPT_NAME_RE.test(d1.receipt) && !!s.receiptFile(d1.receipt));
  check('чужие имена файлов не открываются', !s.receiptFile('../app.db') && !s.receiptFile('x.png'));
  check('спор видно игроку в его оплатах', s.listDeposits(u.id)[0].dispute?.status === 'new');
  try { await s.reportDeposit(u.id, order.id, { image: png }); } catch (e) { refused = e.code; }
  check('второй спор по той же оплате не заводится', refused === 'ALREADY', refused);

  // Сотрудник открывает апелляцию: файл к ордеру и апелляция со ссылкой на чек.
  calls.length = 0;
  reply = (url, m, body) => url.endsWith('/appeals')
    ? { status: 201, body: { id: 31, order_id: 812, inv_id: body.order_invid, status: 'created' } }
    : url.includes('/upload-client-receipt/') ? { status: 201, body: { receipt: { id: 1 } } }
      : { status: 200, body: { id: 812, invid: row.invid, status: 'pending', sum: '2000' } };
  const admin = player();
  const opened = await s.openAppeal(admin.id, { disputeId: d1.id, reason: 'Перевод есть, чек приложен' });
  const ap = lastCall('/appeals');
  check('апелляция: подпись sha256(login:invid:apiKey) и наш номер', ap.body.order_invid === row.invid
    && ap.body.signature === sha(`lucky:${row.invid}:k3y`) && ap.body.merchant === 7);
  check('апелляция: чек ссылкой на наш сайт', ap.body.image === `https://luckybox.test/receipts/${d1.receipt}`);
  check('апелляция: причина в поле openning_reason', ap.body.openning_reason === 'Перевод есть, чек приложен');
  check('чек загружен файлом к ордеру шлюза', calls.some((c) => c.url.endsWith('/upload-client-receipt/812')));
  check('спор переведён в «у шлюза»', opened.dispute.status === 'sent' && opened.dispute.appealId === 31);

  // Ордер истёк у нас, а шлюз решил апелляцию в пользу игрока и прислал колбэк.
  db.prepare("UPDATE sicilia_orders SET status = 'expired', created_at = ? WHERE id = ?").run(Date.now() - 5 * 86400000, order.id);
  const cb = { invid: row.invid, status: 'completed', reason: 'чек подтверждён', fact_sum: '1990', signature: sha(`lucky:${row.invid}:k3y`) };
  check('колбэк апелляции: подпись sha256(login:invid:apiKey) принимается', s.verifyCallback(cb));
  check('колбэк апелляции: чужая подпись отвергается', !s.verifyCallback({ ...cb, signature: sha(`x:${row.invid}:k3y`) }));
  reply = () => ({ status: 200, body: { id: 812, invid: row.invid, status: 'completed', sum: '2000', fact_sum: '1990' } });
  const won = await s.handleCallback(cb);
  const d2 = db.prepare('SELECT * FROM sicilia_disputes WHERE id = ?').get(d1.id);
  check('апелляция в пользу игрока зачисляет по факту шлюза', won.kind === 'appeal' && won.credited && won.amount === 1990
    && siciliaPaid(u.id) === 1990, JSON.stringify(won));
  check('спор закрыт победой с причиной шлюза', d2.status === 'won' && d2.appeal_reason === 'чек подтверждён');
  const again = await s.handleCallback(cb);
  check('повтор колбэка апелляции денег не даёт', !again.credited && siciliaPaid(u.id) === 1990);

  // Проигранная апелляция: шлюз отказал, денег нет.
  const u2 = player();
  const o2 = await s.createDeposit(u2.id, 1000);
  const r2 = db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(o2.id);
  reply = () => ({ status: 200, body: { id: 813, invid: r2.invid, status: 'cancelled', sum: '1000' } });
  const lost = await s.handleCallback({ invid: r2.invid, status: 'rejected', reason: 'чек не совпал', signature: sha(`lucky:${r2.invid}:k3y`) });
  const d3 = db.prepare('SELECT * FROM sicilia_disputes WHERE order_id = ?').get(o2.id);
  check('апелляция из кабинета шлюза видна в споре', d3?.source === 'staff' && d3.status === 'lost' && !lost.credited);

  // Отказ сотрудника: только по новому спору и с причиной для игрока.
  const u3 = player();
  const o3 = await s.createDeposit(u3.id, 700);
  reply = () => ({ status: 200, body: { status: 'pending' } });
  await s.reportDeposit(u3.id, o3.id, { image: png });
  const d4 = db.prepare('SELECT * FROM sicilia_disputes WHERE order_id = ?').get(o3.id);
  try { s.declineDispute(admin.id, d4.id, ''); } catch (e) { refused = e.code; }
  check('отказ в споре без причины не проходит', refused === 'NO_NOTE', refused);
  s.declineDispute(admin.id, d4.id, 'Перевод ушёл на чужие реквизиты');
  check('отказ виден игроку', s.listDeposits(u3.id)[0].dispute?.status === 'declined'
    && s.listDeposits(u3.id)[0].dispute.note === 'Перевод ушёл на чужие реквизиты');

  // Поздняя сверка: ордер истёк у нас, а потом шлюз зачёл его без колбэка.
  const u4 = player();
  const o4 = await s.createDeposit(u4.id, 900);
  const r4 = db.prepare('SELECT * FROM sicilia_orders WHERE id = ?').get(o4.id);
  db.prepare("UPDATE sicilia_orders SET status = 'expired', created_at = ? WHERE id = ?").run(Date.now() - 3600_000, o4.id);
  reply = (url, m, body) => url.endsWith('/orders/check-status') && body.invid === r4.invid
    ? { status: 200, body: { id: 900, invid: r4.invid, status: 'completed', sum: '900' } }
    : { status: 200, body: { invid: body?.invid, status: 'cancelled' } };
  await s.reconcile();
  check('поздняя сверка зачисляет ордер, зачтённый после срока', siciliaPaid(u4.id) === 900);
  calls.length = 0;
  await s.reconcile();
  check('поздняя сверка не дёргает шлюз чаще раза в час',
    !calls.some((c) => c.body?.invid === r4.invid));
}

/* ---------- Сценарии проверки шлюза: 4 на вход, 4 на выход ---------- */

{
  const admin = player();
  const balanceOf = (id) => getUserById(id).balance;

  // Вход 2: подтверждение с изменённой суммой. FactSum пришёл только в
  // колбэке, check-status его не вернул: зачисляем по факту.
  {
    const u = player();
    const o = await s.createDeposit(u.id, 1000);
    const inv = db.prepare('SELECT invid FROM sicilia_orders WHERE id = ?').get(o.id).invid;
    reply = (url, m, body) => url.endsWith('/orders/check-status')
      ? { status: 200, body: { id: 70, invid: body.invid, status: 'completed', sum: '1000', fact_sum: null } } : { status: 404, body: {} };
    const r = await s.handleCallback({ InvId: inv, OutSum: '1000.0000', FactSum: '1100.00', Status: 'completed',
      SignatureValue: sha(`1000.0000:${inv}:k3y`) });
    check('вход 2: изменённая сумма из колбэка зачислена', r.credited && siciliaPaid(u.id) === 1100, JSON.stringify(r));
  }

  // Вход 2, обман: FactSum в колбэке без подтверждения шлюзом не берётся.
  {
    const u = player();
    const o = await s.createDeposit(u.id, 1000);
    const inv = db.prepare('SELECT invid FROM sicilia_orders WHERE id = ?').get(o.id).invid;
    reply = (url, m, body) => url.endsWith('/orders/check-status')
      ? { status: 200, body: { id: 71, invid: body.invid, status: 'processing', sum: '1000' } } : { status: 404, body: {} };
    await s.handleCallback({ InvId: inv, OutSum: '1000.0000', FactSum: '99999', Status: 'completed',
      SignatureValue: sha(`1000.0000:${inv}:k3y`) });
    check('вход 2: сумма из колбэка без подтверждения шлюза не зачисляется', siciliaPaid(u.id) === 0);
  }

  // Вход 3: отмена со стороны шлюза: колбэк cancelled, денег нет, оплата закрыта.
  {
    const u = player();
    const o = await s.createDeposit(u.id, 800);
    const inv = db.prepare('SELECT invid FROM sicilia_orders WHERE id = ?').get(o.id).invid;
    reply = (url, m, body) => url.endsWith('/orders/check-status')
      ? { status: 200, body: { id: 72, invid: body.invid, status: 'cancelled', sum: '800' } } : { status: 404, body: {} };
    const r = await s.handleCallback({ InvId: inv, OutSum: '800.0000', Status: 'cancelled', SignatureValue: sha(`800.0000:${inv}:k3y`) });
    check('вход 3: отмена шлюзом закрывает оплату без денег', !r.credited && siciliaPaid(u.id) === 0
      && s.listDeposits(u.id)[0].status === 'cancelled');
  }

  // Вход 4: отмена с нашей стороны из панели. Первый путь отзыва 404 -
  // пробуем путь из документации с /api.
  {
    const u = player();
    const o = await s.createDeposit(u.id, 900);
    const inv = db.prepare('SELECT invid FROM sicilia_orders WHERE id = ?').get(o.id).invid;
    calls.length = 0;
    let unclaimed = false;
    reply = (url, m, body) => {
      if (url === 'https://api.test/api/orders/unclaimed') return { status: 404, body: { message: 'Not Found' } };
      if (url === 'https://api.test/api/api/orders/unclaimed') { unclaimed = true; return { status: 200, body: {} }; }
      if (url.endsWith('/orders/check-status')) return { status: 200, body: { id: 73, invid: body.invid, status: unclaimed ? 'unclaimed' : 'pending', sum: '900' } };
      return { status: 404, body: {} };
    };
    const r = await s.staffCancelDeposit(admin.id, o.id);
    const un = calls.filter((c) => c.url.includes('/orders/unclaimed'));
    check('вход 4: отзыв идёт PUT с подписью sha256(login:invid:apiKey)', un.length === 2 && un.every((c) => c.method === 'PUT'
      && c.body.order_invid === inv && c.body.signature === sha(`lucky:${inv}:k3y`)));
    check('вход 4: отменённая нами оплата закрыта', !r.credited && s.listDeposits(u.id)[0].status === 'unclaimed', JSON.stringify(r));
  }

  // Вход 4, гонка: игрок успел оплатить, пока отменяли - деньги зачисляются.
  {
    const u = player();
    const o = await s.createDeposit(u.id, 600);
    reply = (url, m, body) => url.includes('/orders/unclaimed') ? { status: 422, body: { message: 'Order completed' } }
      : url.endsWith('/orders/check-status') ? { status: 200, body: { id: 74, invid: body.invid, status: 'completed', sum: '600' } } : { status: 404, body: {} };
    const r = await s.staffCancelDeposit(admin.id, o.id);
    check('вход 4: отмена оплаченной не отменяет, деньги зачислены', r.credited && siciliaPaid(u.id) === 600);
  }

  // Выход: общий помощник отправки.
  const sendOut = async (amount) => {
    const u = player(amount + 1000);
    const { id } = createPayout(u.id, amount, { method: 'sbp', phone: '+79120000000', bank: 'Т-Банк' });
    reply = (url, m, body) => url.endsWith('/payout/orders')
      ? { status: 201, body: { id: 500 + id, status: 'opened', invid: body.invid, duplicate: false } } : { status: 404, body: {} };
    await s.sendPayout(admin.id, id, 'tinkoff');
    const inv = lastCall('/payout/orders').body.invid;
    return { u, id, inv };
  };
  const payoutRow = (id) => db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
  const payoutCb = (inv, sum, extra = {}) => ({ order_type: 'payout', invid: inv, sum: String(sum), status: 'completed',
    signature: sha(`lucky:${sum}:${inv}:k3y`), ...extra });

  // Выход 2: неполное подтверждение - заявка закрывается выплаченной суммой,
  // остаток возвращается игроку.
  {
    const { u, id, inv } = await sendOut(3000);
    const before = balanceOf(u.id);
    reply = (url, m, body) => url.endsWith('/payout/orders/check-status')
      ? { status: 200, body: { invid: body.invid, status: 'completed', transfer_check: ['https://chk.test/p.pdf'] } } : { status: 404, body: {} };
    const r = await s.handleCallback(payoutCb(inv, 3000, { fact_sum: 2000 }));
    const p = payoutRow(id);
    check('выход 2: заявка закрыта выплаченной суммой', r.partial && p.status === 'paid' && p.amount === 2000
      && p.requested_amount === 3000, JSON.stringify({ r, p: { status: p.status, amount: p.amount, req: p.requested_amount } }));
    check('выход 2: невыплаченный остаток вернулся на баланс', balanceOf(u.id) === before + 1000, `${balanceOf(u.id)} vs ${before + 1000}`);
    const again = await s.handleCallback(payoutCb(inv, 3000, { fact_sum: 2000 }));
    check('выход 2: повтор колбэка остаток второй раз не возвращает', !again.closed && balanceOf(u.id) === before + 1000);
  }

  // Выход 3: отмена шлюзом (возврат в общий пул выплат): заявка остаётся в
  // работе, возвращается в ожидание только по нашей кнопке и только при
  // отмене, подтверждённой шлюзом.
  {
    const { u, id, inv } = await sendOut(1500);
    reply = (url, m, body) => url.endsWith('/payout/orders/check-status')
      ? { status: 200, body: { invid: body.invid, status: 'in_progress' } } : { status: 404, body: {} };
    let refused = null;
    try { await s.releasePayout(admin.id, id); } catch (e) { refused = e.code; }
    check('выход 3: пока шлюз выплачивает, заявку в ожидание не вернуть', refused === 'NOT_CANCELLED', refused);
    reply = (url, m, body) => url.endsWith('/payout/orders/check-status')
      ? { status: 200, body: { invid: body.invid, status: 'cancelled' } } : { status: 404, body: {} };
    await s.handleCallback({ ...payoutCb(inv, 1500), status: 'cancelled' });
    check('выход 3: отмена шлюзом не закрывает и не возвращает деньги сама', payoutRow(id).status === 'processing');
    const back = await s.releasePayout(admin.id, id);
    check('выход 3: после отмены шлюзом заявка снова ждёт решения', back.payoutStatus === 'pending' && payoutRow(id).status === 'pending');
    // Отправить заново можно: прошлый ордер отменён.
    reply = (url, m, body) => url.endsWith('/payout/orders')
      ? { status: 201, body: { id: 990, status: 'opened', invid: body.invid } } : { status: 404, body: {} };
    const g2 = await s.sendPayout(admin.id, id, 'tinkoff');
    check('выход 3: отменённую выплату можно отправить заново новым номером', g2.status === 'opened' && g2.invid !== inv);
    void u;
  }

  // Выход 4: отмена с нашей стороны - отзыв PATCH /payout/orders/unclaimed.
  {
    const { id, inv } = await sendOut(1200);
    let recalled = false;
    calls.length = 0;
    reply = (url, m, body) => {
      if (url.endsWith('/payout/orders/unclaimed')) { recalled = true; return { status: 200, body: {} }; }
      if (url.endsWith('/payout/orders/check-status')) return { status: 200, body: { invid: body.invid, status: recalled ? 'cancelled' : 'opened' } };
      return { status: 404, body: {} };
    };
    const r = await s.recallPayout(admin.id, id);
    const rc = lastCall('/payout/orders/unclaimed');
    check('выход 4: отзыв PATCH с подписью выплаты', rc?.method === 'PATCH' && rc.body.invid === inv
      && rc.body.signature === sha(`lucky:1200:${inv}:k3y:PAYOUT`));
    check('выход 4: отозванная заявка снова ждёт решения', r.payoutStatus === 'pending' && payoutRow(id).status === 'pending');
  }

  // Обрыв при отправке: ордер у шлюза создался, а мы получили ошибку. Заново
  // не отправляем и в ожидание не возвращаем - иначе выплата ушла бы дважды.
  {
    const u = player(5000);
    const { id } = createPayout(u.id, 2000, { method: 'sbp', phone: '+79120000001', bank: 'Т-Банк' });
    reply = (url) => url.endsWith('/payout/orders') ? { status: 502, body: { message: 'Bad gateway' } } : { status: 404, body: {} };
    try { await s.sendPayout(admin.id, id, 'tinkoff'); } catch { /* ошибка ожидаема */ }
    reply = (url, m, body) => url.endsWith('/payout/orders/check-status')
      ? { status: 200, body: { invid: body.invid, status: 'in_progress' } }
      : url.endsWith('/payout/orders') ? { status: 201, body: { id: 991, status: 'opened', invid: body.invid } } : { status: 404, body: {} };
    let refused = null;
    try { await s.sendPayout(admin.id, id, 'tinkoff'); } catch (e) { refused = e.code; }
    check('обрыв: ордер у шлюза есть - вторую выплату не шлём', refused === 'ALREADY', refused);
    refused = null;
    try { await s.releasePayout(admin.id, id); } catch (e) { refused = e.code; }
    check('обрыв: ордер у шлюза есть - в ожидание не возвращаем', refused === 'NOT_CANCELLED', refused);
  }
}

/* ---------- итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
rmSync(s.receiptDir(), { recursive: true, force: true });
if (failures.length) {
  console.error(`Sicilia: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Sicilia: ${passed} проверок пройдено`);
