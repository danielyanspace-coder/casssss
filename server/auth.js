/**
 * Проверка initData из Telegram Mini App.
 *
 * Telegram отдаёт мини-аппу строку initData с подписью. Проверяем её так, как
 * описано в документации Bot API: секретный ключ = HMAC-SHA256(токен бота)
 * с ключом "WebAppData", затем сверяем hash от отсортированных пар key=value.
 *
 * Без этой проверки любой мог бы отправить чужой user.id и играть за него.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = Number(process.env.INITDATA_MAX_AGE || 24 * 60 * 60);

export function verifyInitData(initData, botToken) {
  if (!initData) return { ok: false, error: 'initData отсутствует' };

  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  if (!providedHash) return { ok: false, error: 'hash отсутствует' };

  params.delete('hash');
  // Telegram подписывает пары, отсортированные по ключу, склеенные через \n.
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(providedHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'Подпись не совпадает' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
    return { ok: false, error: 'initData просрочен' };
  }

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, error: 'user отсутствует' };

  try {
    return { ok: true, user: JSON.parse(rawUser) };
  } catch {
    return { ok: false, error: 'user повреждён' };
  }
}

/**
 * Достаёт игрока из запроса.
 *
 * В DEV_MODE подпись не проверяется и подставляется тестовый пользователь —
 * это нужно, чтобы открыть игру в обычном браузере на localhost. В проде
 * DEV_MODE должен быть выключен.
 */
export function resolveUser(req) {
  if (process.env.DEV_MODE === 'true') {
    return {
      ok: true,
      user: { id: 999000001, username: 'dev_user', first_name: 'Разработчик' },
    };
  }

  const botToken = process.env.TELEGRAM_TOKEN;
  if (!botToken) return { ok: false, error: 'TELEGRAM_TOKEN не задан на сервере' };

  const initData = req.get('X-Telegram-Init-Data') || req.body?.initData;
  return verifyInitData(initData, botToken);
}
