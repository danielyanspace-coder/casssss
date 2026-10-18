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
  const body = opts.body ? JSON.parse(opts.body) : null;
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
  check('подтверждённое пополнение зачислено', ok.credited && ok.amount === 1500 && siciliaPaid(u.id) === 1500
    && after.balance === 1500 + ok.bonus, JSON.stringify(ok));
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
  reply = (url, m, body) => ({ status: 201, body: { id: 4, status: 'opened', invid: body.invid } });
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

/* ---------- итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
if (failures.length) {
  console.error(`Sicilia: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Sicilia: ${passed} проверок пройдено`);
