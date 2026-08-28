/**
 * Проверка криптокассы.
 *
 * Тест модульный и без сети: подпись, проверка вебхука и зачисление - это
 * чистая логика, и гонять ради неё живой шлюз значило бы проверять заодно его
 * доступность. Живьём проверяется отдельно, вручную, на настоящем счёте.
 *
 * Запуск: node test/crypto.mjs
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

process.env.DB_PATH = './data/crypto-test.db';
process.env.STARTING_BALANCE = '0';
process.env.HELEKET_MERCHANT = 'test-merchant';
process.env.HELEKET_API_KEY = 'test-key';
rmSync(process.env.DB_PATH, { force: true });
rmSync(process.env.DB_PATH + '-wal', { force: true });
rmSync(process.env.DB_PATH + '-shm', { force: true });

const { getOrCreateUser, getUserById, db, createPayout, adminPayouts } = await import('../server/db.js');
const crypto = await import('../server/crypto.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

/* ---------- Подпись ---------- */
{
  const body = JSON.stringify({ amount: '100', currency: 'RUB' });
  const expected = createHash('md5')
    .update(Buffer.from(body).toString('base64') + 'test-key').digest('hex');
  check('подпись считается как md5(base64(тело) + ключ)', crypto.signBody(body) === expected);
}

/* ---------- Проверка вебхука ---------- */
{
  const sign = (obj) => createHash('md5')
    .update(Buffer.from(JSON.stringify(obj)).toString('base64') + 'test-key').digest('hex');

  const body = { type: 'payment', order_id: 'lb-1-x', status: 'paid', amount: '100' };
  check('верная подпись принимается', crypto.verifyWebhook({ ...body, sign: sign(body) }));
  check('чужая подпись отвергается', !crypto.verifyWebhook({ ...body, sign: 'a'.repeat(32) }));
  check('без подписи отвергается', !crypto.verifyWebhook(body));
  check('изменённое тело отвергается',
        !crypto.verifyWebhook({ ...body, amount: '999', sign: sign(body) }));

  /*
   * Косые черты. PHP на стороне шлюза экранирует их в JSON, Node - нет.
   * Проверяем, что тело с косой чертой принимается при подписи по обоим
   * вариантам: иначе настоящее зачисление молча отвергалось бы.
   */
  const slashed = { order_id: 'lb-1-y', status: 'paid', txid: 'ab/cd' };
  const escapedSign = createHash('md5')
    .update(Buffer.from(JSON.stringify(slashed).replace(/\//g, '\\/')).toString('base64') + 'test-key')
    .digest('hex');
  check('подпись с экранированными косыми принимается',
        crypto.verifyWebhook({ ...slashed, sign: escapedSign }));
  check('подпись без экранирования тоже принимается',
        crypto.verifyWebhook({ ...slashed, sign: sign(slashed) }));
}

/* ---------- Зачисление ---------- */
{
  const user = getOrCreateUser({ id: 'crypto-a', username: 'a' });
  const now = Date.now();
  db.prepare(`INSERT INTO crypto_payments (user_id, order_id, amount_rub, currency, network, created_at)
              VALUES (?, 'ord-1', 1500, 'USDT', 'TRON', ?)`).run(user.id, now);

  const first = crypto.applyWebhook({ order_id: 'ord-1', status: 'paid', txid: 'tx1' });
  check('оплата зачисляется', first.credited === true && first.amount === 1500);
  check('баланс вырос ровно на сумму заявки', getUserById(user.id).balance === 1500,
        String(getUserById(user.id).balance));

  const second = crypto.applyWebhook({ order_id: 'ord-1', status: 'paid', txid: 'tx1' });
  check('повторный вебхук не зачисляет второй раз', second.credited === false && second.duplicate);
  check('баланс после повтора не изменился', getUserById(user.id).balance === 1500,
        String(getUserById(user.id).balance));

  const ledger = db.prepare('SELECT COUNT(*) n FROM balance_transactions WHERE crypto_payment_id IS NOT NULL').get().n;
  check('в журнале ровно одна запись', ledger === 1, `их ${ledger}`);
}

/* ---------- Незавершённые статусы ---------- */
{
  const user = getOrCreateUser({ id: 'crypto-b', username: 'b' });
  db.prepare(`INSERT INTO crypto_payments (user_id, order_id, amount_rub, currency, network, created_at)
              VALUES (?, 'ord-2', 700, 'BTC', 'BTC', ?)`).run(user.id, Date.now());

  for (const status of ['confirm_check', 'wrong_amount', 'cancel', 'fail']) {
    const r = crypto.applyWebhook({ order_id: 'ord-2', status });
    check(`статус «${status}» деньги не зачисляет`, r.credited === false);
  }
  check('баланс при незавершённых статусах нулевой', getUserById(user.id).balance === 0);

  // Переплата - это оплата: деньги пришли, и заявку надо закрыть.
  const over = crypto.applyWebhook({ order_id: 'ord-2', status: 'paid_over' });
  check('переплата зачисляется', over.credited === true);
  check('при переплате зачисляется исходная сумма', getUserById(user.id).balance === 700,
        String(getUserById(user.id).balance));
}

/* ---------- Неизвестный заказ ---------- */
{
  let code = null;
  try { crypto.applyWebhook({ order_id: 'нет-такого', status: 'paid' }); }
  catch (err) { code = err.code; }
  check('вебхук по чужому заказу отвергается', code === 'NOT_FOUND', String(code));
}

/* ---------- Заявка на вывод криптой ---------- */
{
  const user = getOrCreateUser({ id: 'crypto-c', username: 'c' });
  db.prepare('UPDATE users SET balance = 50000 WHERE id = ?').run(user.id);

  const good = {
    method: 'crypto', cryptoCurrency: 'usdt', cryptoNetwork: 'tron',
    cryptoAddress: 'TXYZabcdefghijklmnop123456', cryptoAmount: '57.42', cryptoRate: 87.08,
  };
  const made = createPayout(user.id, 5000, good);
  check('заявка криптой создаётся', made.id > 0);
  check('сумма списана сразу', getUserById(user.id).balance === 45000,
        String(getUserById(user.id).balance));

  const row = adminPayouts('pending').find((r) => r.id === made.id);
  check('админка видит монету и сеть',
        row?.crypto_currency === 'USDT' && row?.crypto_network === 'TRON');
  check('админка видит адрес и сумму в монете',
        row?.crypto_address === good.cryptoAddress && row?.crypto_amount === '57.42');
  check('курс сохранён в заявке', Number(row?.crypto_rate) === 87.08);

  const bad = (extra) => {
    try { createPayout(user.id, 5000, { ...good, ...extra }); return null; }
    catch (err) { return err.code; }
  };
  check('пустой адрес отвергается', bad({ cryptoAddress: '' }) === 'BAD_ADDRESS');
  check('мусор вместо адреса отвергается', bad({ cryptoAddress: 'нет' }) === 'BAD_ADDRESS');
  check('адрес с пробелами отвергается', bad({ cryptoAddress: 'abc def ghi jkl mno pqr' }) === 'BAD_ADDRESS');
  check('без монеты отвергается', bad({ cryptoCurrency: '' }) === 'BAD_CURRENCY');
  check('без курса отвергается', bad({ cryptoRate: 0 }) === 'BAD_RATE');
  check('неизвестный способ отвергается', bad({ method: 'голубь' }) === 'BAD_METHOD');
}

/* ---------- Настроенность ---------- */
{
  check('шлюз считается настроенным при заданных ключах', crypto.isConfigured() === true);
}

db.close();
for (const tail of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + tail, { force: true });

console.log(`\nПройдено проверок: ${passed}`);
if (failures.length) {
  console.log(`\nПРОВАЛЕНО (${failures.length}):`);
  for (const f of failures) console.log('  • ' + f);
  process.exit(1);
}
console.log('Криптокасса работает как задумано.\n');
