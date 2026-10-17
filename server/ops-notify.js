/**
 * Отправка сообщений служебным ботом.
 *
 * Отдельный файл без зависимостей от db.js намеренно: им пользуются не
 * только сервер, но и сторож (deploy/watchdog.mjs) и копия базы
 * (deploy/backup.mjs). Это другие процессы, и тянуть в них весь db.js с его
 * миграциями ради одного сообщения нельзя - сторож должен работать и тогда,
 * когда сервер упал на старте из-за этой самой базы.
 *
 * Служебный бот - НЕ тот, что пишет игрокам (TELEGRAM_TOKEN). У него свой
 * токен OPS_BOT_TOKEN: сервер читает его обновления, а два читателя на одном
 * токене Telegram не допускает.
 */

const TG_TIMEOUT_MS = 10_000;

/* Telegram режет сообщение длиннее 4096 символов. */
const TG_TEXT_MAX = 4000;

export function opsToken() {
  return process.env.OPS_BOT_TOKEN || '';
}

/** Вызов Bot API. Ошибку сети или отказ Telegram отдаёт исключением. */
export async function tg(method, params = {}, { timeoutMs = TG_TIMEOUT_MS, token = opsToken() } = {}) {
  if (!token) throw Object.assign(new Error('OPS_BOT_TOKEN не задан'), { code: 'OPS_OFF' });
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw Object.assign(new Error(`Telegram ${method}: ${data.description || res.status}`),
      { code: 'TG_ERROR', status: data.error_code || res.status });
  }
  return data.result;
}

/**
 * Кому слать оповещения: владельцы панели, привязавшие служебного бота,
 * закреплённый Telegram владельца OPS_OWNER_CHAT_ID и общий чат
 * OPS_ALERT_CHAT_ID, если они заданы. Привязка - та же, что для входа
 * в панель, поэтому отдельно настраивать получателей не нужно.
 */
export function alertRecipients(db) {
  const ids = new Set();
  // Закреплённый Telegram владельца получает оповещения и без привязки.
  const extra = [process.env.OPS_ALERT_CHAT_ID, process.env.OPS_OWNER_CHAT_ID]
    .flatMap((v) => String(v || '').split(','))
    .map((s) => s.trim()).filter(Boolean);
  for (const id of extra) ids.add(id);
  try {
    const rows = db.prepare(`
      SELECT ops_chat_id FROM staff
       WHERE active = 1 AND role = 'owner' AND ops_chat_id IS NOT NULL
    `).all();
    for (const r of rows) ids.add(String(r.ops_chat_id));
  } catch { /* колонки ещё нет: сервер с ботом ни разу не запускался */ }
  return [...ids];
}

/** Шлёт текст всем получателям. Никогда не бросает: оповещение не роняет код. */
export async function notifyAll(chatIds, text, extra = {}) {
  if (!opsToken() || !chatIds.length) return 0;
  const body = text.length > TG_TEXT_MAX ? text.slice(0, TG_TEXT_MAX) + '…' : text;
  let sent = 0;
  for (const chatId of chatIds) {
    try {
      await tg('sendMessage', { chat_id: chatId, text: body, disable_web_page_preview: true, ...extra });
      sent++;
    } catch (err) {
      console.error(`[ops] не отправлено в ${chatId}:`, err.message);
    }
  }
  return sent;
}

/** Подпись сервера в сообщении: на каком сайте случилось. */
export function siteLabel() {
  const url = process.env.SITE_URL || process.env.WEBAPP_URL || '';
  try { return url ? new URL(url).host : 'LUCKYBOX'; } catch { return 'LUCKYBOX'; }
}
