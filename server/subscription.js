/**
 * БЕСПЛАТНЫЙ КЕЙС ЗА ПОДПИСКУ НА КАНАЛ
 *
 * Подписался на канал — раз в сутки бесплатный прокрут. Проверка идёт через
 * Bot API getChatMember: статусы member, administrator и creator считаются
 * подпиской, всё остальное (left, kicked) — нет.
 *
 * ЧТО НУЖНО, ЧТОБЫ ЭТО ЗАРАБОТАЛО. Раздел выключен, пока не заполнены
 * переменные окружения — см. NEDOSTATOK.md, пункт «Бесплатный кейс».
 * Коротко: нужен реальный канал, бот должен быть в нём администратором
 * (иначе getChatMember вернёт ошибку доступа), и нужно выбрать кейс,
 * который раздаётся. Пока переменных нет, isConfigured() отдаёт false,
 * ручка возвращает понятную ошибку, а плитка в интерфейсе не показывается.
 *
 * ПОЧЕМУ ПРОВЕРЯЕМ КАЖДЫЙ РАЗ. Соблазн проверить подписку однажды и
 * запомнить флаг в базе велик, но тогда достаточно подписаться в первый
 * день и отписаться — кейсы продолжат капать. Поэтому запрос к Telegram
 * уходит на каждую выдачу.
 */

/** ID или @username канала: -1001234567890 либо @luckybox_channel. */
const CHANNEL_ID = process.env.TG_CHANNEL_ID || '';

/** Ссылка, которую показываем игроку, если он ещё не подписан. */
const CHANNEL_URL = process.env.TG_CHANNEL_URL || '';

/** Кейс, который выдаётся. Должен существовать в конфигурации кейсов. */
const FREE_CASE_ID = process.env.FREE_CASE_ID || '';

const TOKEN = process.env.TELEGRAM_TOKEN || '';

/** Раз в сутки. */
export const FREE_CASE_COOLDOWN_MS =
  Number(process.env.FREE_CASE_COOLDOWN_H || 24) * 60 * 60 * 1000;

/** Сколько ждать ответ Telegram, прежде чем сдаться. */
const REQUEST_TIMEOUT_MS = 5000;

export function isConfigured() {
  return Boolean(TOKEN && CHANNEL_ID && FREE_CASE_ID);
}

export function subscriptionConfig() {
  return {
    enabled: isConfigured(),
    channelUrl: CHANNEL_URL,
    caseId: FREE_CASE_ID,
    cooldownMs: FREE_CASE_COOLDOWN_MS,
  };
}

/**
 * Подписан ли игрок на канал.
 *
 * Возвращает { ok, subscribed, reason }. Сетевую ошибку намеренно НЕ
 * выдаём за «не подписан»: иначе упавший Telegram превращается в отказ
 * всем подряд, и игрок видит «вы не подписаны», будучи подписанным.
 */
export async function isSubscribed(tgId) {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };

  const url = `https://api.telegram.org/bot${TOKEN}/getChatMember`
    + `?chat_id=${encodeURIComponent(CHANNEL_ID)}&user_id=${encodeURIComponent(tgId)}`;

  let payload;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!payload?.ok) {
    // Самая частая причина — бот не администратор канала.
    return { ok: false, reason: 'telegram', detail: payload?.description || '' };
  }

  const status = payload.result?.status;
  return {
    ok: true,
    subscribed: status === 'member' || status === 'administrator' || status === 'creator',
    status,
  };
}
