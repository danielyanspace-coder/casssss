# Интеграция Sicilia: создание платежа и получение реквизитов

Документ для технической поддержки. Фрагменты взяты из рабочего `server/sicilia.js` 2 ноября 2026 года. Это выдержки из модуля, а не самостоятельный скрипт: вспомогательные функции, база данных и служебные уведомления остаются в проекте. Значения ключей и логинов не включены.

## Схема интеграции

Node.js, серверная H2H-интеграция. Адрес API: `https://api.sicilia.ink/api`. Отправляем JSON методом `POST` на `/orders/create`. До запроса создаём локальную запись платежа и уникальный `invid`.

Основной терминал: merchant `50`; СБП — `bank: "sbp"`, карта — `bank: "any-bank"`. При отказе из-за отсутствия реквизитов пробуем мобильную коммерцию: merchant `149`, `bank: "mobcom"`, отдельные login и API key. Для резервной попытки создаём новый invid и новую подпись.

Подпись: SHA-256 строки `login:sum:invid:apiKey`, результат в hex. В теле запроса sum передаём числом; для подписи сумму преобразуем в строку.

После выдачи реквизитов показываем их пользователю. Колбэк проверяем по подписи; окончательное подтверждение зачисления получаем отдельной проверкой статуса у шлюза.

## Отказы на 500 RUB

Последние найденные в рабочей базе попытки:

| Время UTC | merchant | bank | invid | Сохранённая ошибка |
| --- | --- | --- | --- | --- |
| 2026-11-02 12:55:49 | 50 | sbp | lb-26-mvz9ibim | No available calls |
| 2026-11-02 12:55:50 | 149 | mobcom | lb-27-mvz9ibpl | No available calls |

Полный response body и HTTP-статус этих запросов не сохранялись. В базе сохранён только текст ошибки; это не полный ответ API. Просим проверить параметры интеграции, формулу подписи, значение bank для мобильной коммерции и причину отказа по указанным invid.

## Настройки терминалов

```js
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
```

## Подпись запроса

```js
const sha256 = (...parts) => createHash('sha256').update(parts.join(':')).digest('hex');

/** Создание ордера, платёжное окно и проверка статуса пополнения. */
export const signPayin = (sum, invid, env = siciliaEnv()) => sha256(env.login, sum, invid, env.key);
```

## HTTP-запрос и обработка ошибок

```js
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
    // «Нет трейдеров» шлюз может прислать и с 403, но это не настройка, а
    // нехватка реквизитов: тревога о ключах на нём была бы ложной.
    if ((res.status === 401 || res.status === 403) && !NO_REQUISITE.test(message)) {
      const where = env.terminal === MK ? 'Sicilia, мобильная коммерция' : 'Sicilia';
      alert(`sicilia:auth:${env.terminal}`, `${where} отказывает (${res.status}): ${message}. Проверьте логин, ключ и белый список IP сервера у шлюза.`);
    } else if (res.status >= 500) {
      countError('sicilia:5xx', `Sicilia отвечает ошибкой ${res.status}: ${message}`, { threshold: 3 });
    }
    throw Object.assign(new Error(message), { code: 'GATEWAY_ERROR', status: res.status });
  }
  return json;
}
```

## Создание платежа и резервный терминал

```js
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
```

## Сопутствующие константы

```js
const PAYIN_METHODS = { sbp: "sbp", card: "any-bank" };
const NO_REQUISITE = /no available (calls|traders)|no traders work/i;
const DEEPLINK_BANKS = ["sberbank", "tinkoff", "vtb", "alfa-bank"];
```
