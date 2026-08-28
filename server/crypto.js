/**
 * Криптовалютная касса: приём платежей и заявки на вывод через Heleket.
 *
 * Heleket - это шлюз (бывший Cryptomus): мы выставляем счёт в рублях, он сам
 * пересчитывает сумму в выбранную монету по своему курсу, ждёт перевод в
 * блокчейне и сообщает нам о зачислении вебхуком.
 *
 * ПОЧЕМУ МОНЕТУ ВЫБИРАЮТ У НАС. Счёт выставляется сразу на выбранную монету и
 * сеть, а не отдаёт выбор странице шлюза: касса остаётся частью приложения, и
 * игрок не уходит на чужой домен посреди оплаты. Плата за это - мы обязаны
 * сами следить за тем, за чем следила бы его страница: какие пары монета/сеть
 * включены и какая у пары минимальная сумма. И то, и другое берётся у шлюза,
 * а не зашито в код (см. coins()).
 *
 * ПОЧЕМУ ЗАЧИСЛЯЕМ ПО ФАКТУ, А НЕ ПО СЧЁТУ. Зачисляется столько, сколько
 * реально пришло, пересчитанное по курсу этого же счёта. Заплатил ровно -
 * получил сумму счёта. Заплатил больше - получил больше: деньги пришли, и
 * оставлять их себе нечестно. Курс берётся не из внешнего источника, а из
 * самого счёта (сумма в рублях делённая на сумму в монете) - это ровно тот
 * курс, по которому шлюз посчитал платёж, и расхождению взяться неоткуда.
 *
 * СПИСОК МОНЕТ берётся у шлюза и кешируется: включили в кабинете новую сеть -
 * она появилась и в пополнении, и в выводе сама, выключили - пропала. Зашитый
 * список рано или поздно разошёлся бы с действительностью, и игрок платил бы
 * в сеть, которую мы не принимаем.
 *
 * ПОЧЕМУ ВЫВОД НЕ АВТОМАТИЧЕСКИЙ. У Heleket есть ручка выплат, но заявка на
 * вывод здесь проходит через админку теми же состояниями, что и рублёвая:
 * Новая → В работе → Выполнено. Человек смотрит на заявку до того, как деньги
 * ушли. Для казино это не лишняя бюрократия, а единственный момент, когда
 * можно заметить вывод, которого не должно быть.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { db, getUserById, registerDeposit } from './db.js';

/*
 * Зачисления обоих способов оплаты идут в один журнал balance_transactions, а
 * создаётся он в модуле платежей Beeline. Импорт здесь именно ради этого: без
 * него на чистой базе порядок загрузки решает, успеет ли появиться таблица, и
 * приложение падает при первом старте. Дублировать описание таблицы в двух
 * файлах было бы хуже - они разъедутся.
 */
import './payments.js';

const API = 'https://api.heleket.com/v1';

const MERCHANT = process.env.HELEKET_MERCHANT || '';
const API_KEY = process.env.HELEKET_API_KEY || '';

/** Публичный адрес приложения: нужен шлюзу, чтобы прислать вебхук и вернуть игрока. */
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');

/** Нижняя и верхняя границы пополнения криптой, рублей. */
export const CRYPTO_MIN = Number(process.env.CRYPTO_MIN || 500);
export const CRYPTO_MAX = Number(process.env.CRYPTO_MAX || 500_000);

/** Сколько живёт выставленный счёт. Меньше часа мало: перевод в сети идёт долго. */
const INVOICE_LIFETIME_S = Number(process.env.CRYPTO_INVOICE_LIFETIME || 3 * 3600);

/**
 * Проверять ли адрес, с которого пришёл вебхук.
 *
 * Подпись и так закрывает подделку - она считается общим секретом. Адрес
 * добавляет второй рубеж, но при неверно посчитанном числе прокси перед
 * приложением он молча зарубит настоящие зачисления. Поэтому по умолчанию
 * выключено: включать осознанно, проверив, что в логах виден адрес шлюза.
 */
const CHECK_WEBHOOK_IP = process.env.HELEKET_CHECK_IP === 'true';
const WEBHOOK_IP = '31.133.220.8';

export function isConfigured() {
  return Boolean(MERCHANT && API_KEY);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS crypto_payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    order_id     TEXT    NOT NULL UNIQUE,
    uuid         TEXT,
    amount_rub   INTEGER NOT NULL,
    currency     TEXT    NOT NULL,
    network      TEXT    NOT NULL,
    payer_amount TEXT,
    address      TEXT,
    address_qr   TEXT,
    pay_url      TEXT,
    status       TEXT    NOT NULL DEFAULT 'pending',
    txid         TEXT,
    credited_rub INTEGER,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER,
    paid_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_crypto_user ON crypto_payments(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_crypto_status ON crypto_payments(status);
`);

/*
 * Зачисление привязывается к строке платежа, и колонка уникальна: вебхук от
 * шлюза приходит по нескольку раз на один платёж (это нормальное поведение,
 * он повторяет доставку до успешного ответа), и без этого ограничения каждый
 * повтор клал бы деньги заново.
 */
const payCols = db.prepare('PRAGMA table_info(crypto_payments)').all().map((c) => c.name);
if (!payCols.includes('credited_rub')) {
  db.exec('ALTER TABLE crypto_payments ADD COLUMN credited_rub INTEGER');
}
if (!payCols.includes('address_qr')) {
  db.exec('ALTER TABLE crypto_payments ADD COLUMN address_qr TEXT');
}

const txCols = db.prepare('PRAGMA table_info(balance_transactions)').all().map((c) => c.name);
if (!txCols.includes('crypto_payment_id')) {
  db.exec('ALTER TABLE balance_transactions ADD COLUMN crypto_payment_id INTEGER REFERENCES crypto_payments(id)');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_crypto
             ON balance_transactions(crypto_payment_id) WHERE crypto_payment_id IS NOT NULL`);
}

/* ============================================================
   ПОДПИСЬ
   ============================================================ */

/**
 * Подпись запроса: md5 от тела в base64, склеенного с ключом.
 *
 * Так описано в документации Heleket и так проверено живым запросом к
 * `/v1/payment/services` - выдумывать тут нечего.
 */
export function signBody(body) {
  return createHash('md5')
    .update(Buffer.from(body, 'utf8').toString('base64') + API_KEY)
    .digest('hex');
}

/**
 * Проверка подписи вебхука.
 *
 * Шлюз подписывает то же тело, но с уже вынутым полем sign. Тонкость: PHP при
 * кодировании JSON экранирует косые черты (`\/`), а Node - нет. Если в теле
 * попадётся поле с косой чертой, две стороны посчитают подпись от разных строк
 * и настоящее зачисление будет отвергнуто. Поэтому проверяем оба варианта:
 * совпадение с любым означает, что тело подписано нашим ключом.
 */
export function verifyWebhook(payload) {
  const { sign, ...rest } = payload || {};
  if (!sign || typeof sign !== 'string') return false;

  const plain = JSON.stringify(rest);
  const escaped = plain.replace(/\//g, '\\/');

  return [plain, escaped].some((body) => {
    const expected = signBody(body);
    const a = Buffer.from(expected);
    const b = Buffer.from(sign);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export function webhookIpAllowed(ip) {
  if (!CHECK_WEBHOOK_IP) return true;
  // ::ffff:1.2.3.4 - тот же адрес, просто в форме IPv4-в-IPv6.
  return String(ip || '').replace(/^::ffff:/, '') === WEBHOOK_IP;
}

/* ============================================================
   ЗАПРОСЫ К ШЛЮЗУ
   ============================================================ */

async function call(path, payload = {}) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Криптокасса не настроена'), { code: 'NOT_CONFIGURED' });
  }

  const body = JSON.stringify(payload);
  let res;
  try {
    res = await fetch(API + path, {
      method: 'POST',
      headers: { merchant: MERCHANT, sign: signBody(body), 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // Шлюз недоступен - это не ошибка игрока, и текст должен это отражать.
    throw Object.assign(new Error('Криптокасса временно недоступна'),
      { code: 'GATEWAY_UNREACHABLE', cause: err });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.state !== 0) {
    const message = json.message
      || (json.errors && Object.values(json.errors).flat().join('; '))
      || `Шлюз ответил ${res.status}`;
    throw Object.assign(new Error(message), { code: 'GATEWAY_ERROR', status: res.status });
  }
  return json.result;
}

/* ============================================================
   СПИСОК МОНЕТ
   ============================================================ */

/**
 * Что мы знаем о монетах помимо их кода.
 *
 * Название - для показа, id - чтобы спросить курс, приоритет - порядок в
 * списке. Стейблкоины наверху не случайно: ими платят чаще всего, потому что
 * их курс не меняется, пока перевод идёт по сети.
 *
 * Монета, которой здесь нет, всё равно покажется - просто своим кодом и без
 * курса. Список у шлюза может пополниться в любой момент, и пропадать из-за
 * этого касса не должна.
 */
const COINS = {
  USDT: { name: 'Tether',    rate: 'tether',        order: 1 },
  USDC: { name: 'USD Coin',  rate: 'usd-coin',      order: 2 },
  DAI:  { name: 'Dai',       rate: 'dai',           order: 3 },
  BTC:  { name: 'Bitcoin',   rate: 'bitcoin',       order: 4 },
  ETH:  { name: 'Ethereum',  rate: 'ethereum',      order: 5 },
  TRX:  { name: 'TRON',      rate: 'tron',          order: 6 },
  BNB:  { name: 'BNB',       rate: 'binancecoin',   order: 7 },
  SOL:  { name: 'Solana',    rate: 'solana',        order: 8 },
  LTC:  { name: 'Litecoin',  rate: 'litecoin',      order: 9 },
  DOGE: { name: 'Dogecoin',  rate: 'dogecoin',      order: 10 },
  XMR:  { name: 'Monero',    rate: 'monero',        order: 11 },
  BCH:  { name: 'Bitcoin Cash', rate: 'bitcoin-cash', order: 12 },
  DASH: { name: 'Dash',      rate: 'dash',          order: 13 },
  AVAX: { name: 'Avalanche', rate: 'avalanche-2',   order: 14 },
  POL:  { name: 'Polygon',   rate: 'matic-network', order: 15 },
  SHIB: { name: 'Shiba Inu', rate: 'shiba-inu',     order: 16 },
  GRAM: { name: 'Gram',      rate: null,            order: 17 },
};

/** Как называется сеть в глазах игрока: коды вроде BSC ему ничего не говорят. */
const NETWORKS = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BSC: 'BNB Smart Chain', TRON: 'TRON',
  SOL: 'Solana', POLYGON: 'Polygon', ARBITRUM: 'Arbitrum', AVALANCHE: 'Avalanche',
  TON: 'TON', LTC: 'Litecoin', DOGE: 'Dogecoin', BCH: 'Bitcoin Cash',
  DASH: 'Dash', XMR: 'Monero',
};

/** Сколько держим список монет. Он меняется раз в месяцы, чаще спрашивать незачем. */
const SERVICES_TTL_MS = 10 * 60_000;
let servicesCache = { at: 0, list: null };

/**
 * Монеты, доступные к оплате: спрашиваем у шлюза и складываем по монетам.
 *
 * Возвращается уже готовая для показа структура: монета, её сети и границы
 * суммы. Порядок - по таблице выше, незнакомые монеты в конце по алфавиту.
 */
export async function coins({ force = false } = {}) {
  const fresh = Date.now() - servicesCache.at < SERVICES_TTL_MS;
  if (!force && fresh && servicesCache.list) return servicesCache.list;

  let services;
  try {
    services = await call('/payment/services', {});
  } catch (err) {
    // Отдаём прошлый список, если он был: разовый сбой шлюза не повод гасить
    // кассу целиком.
    if (servicesCache.list) return servicesCache.list;
    throw err;
  }

  const byCoin = new Map();
  for (const s of services) {
    if (!s.is_available) continue;
    const meta = COINS[s.currency];
    if (!byCoin.has(s.currency)) {
      byCoin.set(s.currency, {
        currency: s.currency,
        name: meta?.name || s.currency,
        order: meta?.order ?? 99,
        networks: [],
      });
    }
    byCoin.get(s.currency).networks.push({
      network: s.network,
      name: NETWORKS[s.network] || s.network,
      minAmount: Number(s.limit?.min_amount ?? 0),
      maxAmount: Number(s.limit?.max_amount ?? 0),
    });
  }

  const list = [...byCoin.values()].sort((a, b) =>
    a.order - b.order || a.currency.localeCompare(b.currency));

  // Внутри монеты сети идут в том же порядке, что и в таблице сетей: у USDT
  // это ставит TRON и BSC выше, а они и есть самые дешёвые по комиссии.
  const netOrder = ['TRON', 'BSC', 'SOL', 'TON', 'POLYGON', 'ARBITRUM', 'AVALANCHE', 'ETH'];
  for (const c of list) {
    c.networks.sort((a, b) => {
      const ai = netOrder.indexOf(a.network); const bi = netOrder.indexOf(b.network);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.network.localeCompare(b.network);
    });
  }

  servicesCache = { at: Date.now(), list };
  return list;
}

/* ============================================================
   КУРСЫ
   ============================================================ */

/**
 * Курс нужен только чтобы ПОКАЗАТЬ игроку, сколько примерно он переведёт.
 *
 * Настоящий пересчёт делает шлюз в момент выставления счёта, и его результат
 * приходит в ответе. Поэтому неточность здесь ничего не стоит и ни на какие
 * деньги не влияет - но подписать «примерно» обязательно, иначе расхождение в
 * пару процентов выглядит обманом.
 *
 * Для вывода курс важнее: по нему считается сумма, которую администратор
 * отправит руками. Там курс сохраняется в заявку вместе со временем - чтобы
 * при разборе было видно, по какому именно считали.
 */
const RATES_TTL_MS = 60_000;
let ratesCache = { at: 0, map: null };

export async function rates({ force = false } = {}) {
  if (!force && ratesCache.map && Date.now() - ratesCache.at < RATES_TTL_MS) {
    return ratesCache.map;
  }

  const ids = [...new Set(Object.values(COINS).map((c) => c.rate).filter(Boolean))];
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=rub`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) throw new Error(`курсы: ${res.status}`);
    const json = await res.json();

    const map = {};
    for (const [code, meta] of Object.entries(COINS)) {
      const rub = meta.rate && json[meta.rate]?.rub;
      if (rub > 0) map[code] = rub;
    }
    if (!Object.keys(map).length) throw new Error('курсы пришли пустыми');

    ratesCache = { at: Date.now(), map };
    return map;
  } catch (err) {
    // Со старым курсом касса работает, без курса - нет. Отдаём последний
    // известный, а если его нет, пустой: интерфейс тогда просто не показывает
    // оценку, а сумму всё равно посчитает шлюз.
    if (ratesCache.map) return ratesCache.map;
    return {};
  }
}

/* ============================================================
   ПОПОЛНЕНИЕ
   ============================================================ */

/** Идентификатор заказа: он же ключ от повторной обработки на стороне шлюза. */
function makeOrderId(userId) {
  return `lb-${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Выставляет счёт и запоминает его.
 *
 * Строка в базе создаётся ДО обращения к шлюзу: если ответ потеряется по
 * дороге, платёж всё равно найдётся по order_id, когда придёт вебхук. Обратный
 * порядок оставил бы зачисление без строки, к которой его привязать.
 */
export async function createDeposit(userId, amountRub, currency, network, rubRate = null) {
  const amount = Math.trunc(Number(amountRub));
  if (!Number.isFinite(amount) || amount < CRYPTO_MIN) {
    throw Object.assign(new Error(`Минимальная сумма пополнения - ${CRYPTO_MIN} ₽`), { code: 'MIN' });
  }
  if (amount > CRYPTO_MAX) {
    throw Object.assign(new Error(`Максимальная сумма пополнения - ${CRYPTO_MAX} ₽`), { code: 'MAX' });
  }

  const available = await coins();
  const coin = available.find((c) => c.currency === String(currency || '').toUpperCase());
  if (!coin) throw Object.assign(new Error('Такая монета не принимается'), { code: 'BAD_CURRENCY' });
  const net = coin.networks.find((n) => n.network === String(network || '').toUpperCase());
  if (!net) throw Object.assign(new Error('Такая сеть не принимается'), { code: 'BAD_NETWORK' });

  /*
   * У каждой пары монета/сеть свой минимум, и он задан в монете, а не в
   * рублях: у биткоина это сотые доли, у Dogecoin - десятки штук. Шлюз
   * отвергнет счёт ниже минимума, но сообщение придёт по-английски и про
   * монету, которую игрок не выбирал осознанно. Проверяем сами и говорим
   * по-русски, во сколько это обходится в рублях.
   */
  const rate = Number(rubRate) > 0 ? Number(rubRate) : (await rates())[coin.currency];
  if (net.minAmount > 0 && rate > 0) {
    const minRub = Math.ceil(net.minAmount * rate);
    if (amount < minRub) {
      throw Object.assign(
        new Error(`Минимум для ${coin.currency} в сети ${net.name} - около ${minRub} ₽`),
        { code: 'MIN_NETWORK', minRub }
      );
    }
  }

  const orderId = makeOrderId(userId);
  const row = db.prepare(`
    INSERT INTO crypto_payments (user_id, order_id, amount_rub, currency, network, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, orderId, amount, coin.currency, net.network, Date.now());
  const id = row.lastInsertRowid;

  let invoice;
  try {
    invoice = await call('/payment', {
      amount: String(amount),
      currency: 'RUB',
      to_currency: coin.currency,
      network: net.network,
      order_id: orderId,
      lifetime: INVOICE_LIFETIME_S,
      url_callback: WEBAPP_URL ? `${WEBAPP_URL}/api/webhooks/heleket` : undefined,
      url_success: WEBAPP_URL || undefined,
      // Доплата разрешена: игрок может прислать меньше, чем нужно, и добить
      // остаток вторым переводом. Зачислим по факту пришедшего.
      is_payment_multiple: true,
    });
  } catch (err) {
    db.prepare("UPDATE crypto_payments SET status='failed' WHERE id=?").run(id);
    throw err;
  }

  /*
   * QR-код приходит от шлюза готовой картинкой, и мы её сохраняем.
   *
   * Рисовать его самим значило бы тянуть библиотеку ради того, что уже есть в
   * ответе. А сохраняем потому, что игрок закрывает приложение и возвращается:
   * без картинки в базе ему пришлось бы заводить новый счёт вместо того, чтобы
   * доплатить по старому.
   */
  db.prepare(`
    UPDATE crypto_payments
       SET uuid=?, currency=?, network=?, payer_amount=?, address=?, address_qr=?,
           pay_url=?, status=?, expires_at=?
     WHERE id=?
  `).run(
    invoice.uuid || null,
    (invoice.payer_currency || coin.currency || '').toUpperCase(),
    (invoice.network || net.network || '').toUpperCase(),
    invoice.payer_amount != null ? String(invoice.payer_amount) : null,
    invoice.address || null,
    invoice.address_qr_code || null,
    invoice.url || null,
    invoice.payment_status || 'pending',
    invoice.expired_at ? invoice.expired_at * 1000 : null,
    id
  );

  return publicPayment(db.prepare('SELECT * FROM crypto_payments WHERE id=?').get(id));
}

/** Статусы шлюза, при которых деньги считаются полученными. */
const PAID_STATUSES = new Set(['paid', 'paid_over']);

/**
 * Обработка вебхука: зачисление ровно один раз.
 *
 * Транзакция целиком, потому что здесь два действия, которые обязаны случиться
 * вместе: рост баланса и запись о зачислении. Уникальность crypto_payment_id в
 * balance_transactions делает повтор безопасным - вторая попытка упрётся в
 * ограничение базы, а не в проверку в коде, которую можно обойти гонкой.
 */
export const applyWebhook = db.transaction((payload) => {
  const orderId = String(payload.order_id || '');
  const row = db.prepare('SELECT * FROM crypto_payments WHERE order_id=?').get(orderId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });

  const status = String(payload.status || '');
  const currency = String(payload.payer_currency || row.currency || '');
  const network = String(payload.network || row.network || '');

  db.prepare(`UPDATE crypto_payments
                 SET status=?, txid=COALESCE(?,txid),
                     currency=COALESCE(NULLIF(?,''), currency),
                     network=COALESCE(NULLIF(?,''), network)
               WHERE id=?`)
    .run(status, payload.txid || null, currency, network, row.id);

  if (!PAID_STATUSES.has(status)) return { credited: false, status };

  const already = db.prepare('SELECT 1 FROM balance_transactions WHERE crypto_payment_id=?').get(row.id);
  if (already) return { credited: false, status, duplicate: true };

  const credited = creditedRubles(row, payload);
  if (!(credited > 0)) return { credited: false, status, empty: true };

  const now = Date.now();
  const label = currency ? `${currency}${network ? ` · ${network}` : ''}` : 'криптовалюта';

  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(credited, row.user_id);
  db.prepare(`INSERT INTO balance_transactions (user_id, type, amount, crypto_payment_id, comment, created_at)
              VALUES (?, 'DEPOSIT', ?, ?, ?, ?)`)
    .run(row.user_id, credited, row.id, `Криптоплатёж ${label}`, now);
  db.prepare(`INSERT INTO deposits (user_id, amount, source, comment, created_at)
              VALUES (?, ?, 'crypto', ?, ?)`)
    .run(row.user_id, credited, label, now);
  db.prepare('UPDATE crypto_payments SET paid_at=?, credited_rub=? WHERE id=?')
    .run(now, credited, row.id);

  // Пополнение обязано быть отыграно ставками, прежде чем его можно вывести.
  registerDeposit(row.user_id, credited);

  return {
    credited: true,
    status,
    paymentId: row.id,
    userId: row.user_id,
    amount: credited,
    invoiced: row.amount_rub,
    balance: getUserById(row.user_id).balance,
  };
});

/**
 * Сколько рублей зачислить за пришедший перевод.
 *
 * Считаем от того, что пришло на самом деле, а не от суммы счёта: заплатил
 * ровно - получил сумму счёта, заплатил больше - получил больше. Деньги ведь
 * пришли, и оставлять излишек себе нечестно.
 *
 * Курс берётся из самого счёта: сумма в рублях, делённая на сумму в монете,
 * которую шлюз просил перевести. Это ровно тот курс, по которому он считал
 * этот платёж, поэтому расхождению взяться неоткуда - в отличие от внешнего
 * источника, который к моменту прихода перевода уже другой.
 *
 * Если чего-то из этих чисел нет, зачисляем сумму счёта: недоплата и
 * переплата - редкость, а платёж без зачисления - всегда разбирательство.
 */
function creditedRubles(row, payload) {
  const paid = Number(payload.payment_amount);
  const asked = Number(payload.payer_amount ?? row.payer_amount);
  const invoiced = Number(payload.amount) || row.amount_rub;

  if (paid > 0 && asked > 0 && invoiced > 0) {
    return Math.max(1, Math.round(paid * (invoiced / asked)));
  }
  return row.amount_rub;
}

function publicPayment(r) {
  if (!r) return null;
  return {
    id: r.id,
    amountRub: r.amount_rub,
    currency: r.currency,
    network: r.network,
    networkName: NETWORKS[r.network] || r.network,
    payerAmount: r.payer_amount,
    address: r.address,
    addressQr: r.address_qr,
    payUrl: r.pay_url,
    status: r.status,
    txid: r.txid,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    paidAt: r.paid_at,
  };
}

export function listDeposits(userId, limit = 20) {
  return db.prepare('SELECT * FROM crypto_payments WHERE user_id=? ORDER BY id DESC LIMIT ?')
    .all(userId, limit).map(publicPayment);
}

export function getDeposit(id, userId) {
  return publicPayment(
    db.prepare('SELECT * FROM crypto_payments WHERE id=? AND user_id=?').get(Number(id), userId)
  );
}

/**
 * Сверка с шлюзом по одному платежу.
 *
 * Нужна на случай, когда вебхук не дошёл: сеть моргнула, приложение
 * перезапускалось. Игрок открывает свою заявку, мы спрашиваем шлюз напрямую и
 * зачисляем, если он говорит, что оплачено. Без этого деньги висели бы до
 * ручного разбора.
 */
export async function refreshDeposit(id, userId) {
  const row = db.prepare('SELECT * FROM crypto_payments WHERE id=? AND user_id=?')
    .get(Number(id), userId);
  if (!row) throw Object.assign(new Error('Платёж не найден'), { code: 'NOT_FOUND' });
  if (row.paid_at) return { payment: publicPayment(row), credited: false };

  const info = await call('/payment/info', { order_id: row.order_id });
  const result = applyWebhook({
    order_id: row.order_id, status: info.payment_status, txid: info.txid,
  });
  return {
    payment: publicPayment(db.prepare('SELECT * FROM crypto_payments WHERE id=?').get(row.id)),
    credited: result.credited,
  };
}

export { COINS, NETWORKS };
