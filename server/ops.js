/**
 * Служебный бот: оповещения о сбоях и подтверждение входа в панель.
 *
 * Включается одной переменной OPS_BOT_TOKEN (бот из @BotFather, отдельный от
 * игрового). Без неё всё здесь молчит, а вход в панель работает по паролю,
 * как раньше: разработка и тесты бота не требуют.
 *
 * ПРИВЯЗКА. Сотрудник с доступом в панель жмёт «Привязать Telegram», получает
 * ссылку t.me/<бот>?start=link_<код> и нажимает Start. Бот запоминает чат.
 * Если у аккаунта уже есть Telegram (вход через Telegram или привязка в
 * профиле), принимается только он: украденного пароля мало, чтобы подставить
 * свой Telegram.
 *
 * ВХОД В ПАНЕЛЬ. Сессия сотрудника пускается в /api/admin/* только после
 * подтверждения в боте: сообщение с адресом и браузером, кнопки «Это я» и
 * «Это не я» и шестизначный код на случай, если кнопка не сработала.
 * Подтверждение живёт ADMIN_2FA_TTL_MS. «Это не я» закрывает ту сессию и
 * поднимает тревогу владельцам.
 *
 * ОПОВЕЩЕНИЯ. alert(key, text): одинаковый ключ не чаще раза в
 * ALERT_REPEAT_MS, повторы считаются и приходят одной строкой в следующем
 * сообщении. Получатели - владельцы, привязавшие бота, и OPS_ALERT_CHAT_ID.
 *
 * Обновления бота читает сервер долгим опросом (getUpdates), без вебхука:
 * работает и на сервере без домена, и при запуске на своей машине.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';

import { db, getUserById, staffRow, deleteSession } from './db.js';
import { tg, opsToken, alertRecipients, notifyAll, siteLabel } from './ops-notify.js';

/** Сколько живёт подтверждённый вход в панель. Рабочая смена. */
export const ADMIN_2FA_TTL_MS = 12 * 60 * 60 * 1000;
/** Сколько ждём нажатия в боте. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Сколько живёт ссылка привязки. */
const LINK_TTL_MS = 10 * 60 * 1000;
/** Неверных кодов на один запрос - дальше запрос сгорает. */
const CODE_ATTEMPTS = 5;
/** Одинаковое оповещение не чаще. */
const ALERT_REPEAT_MS = 30 * 60 * 1000;
/** Долгий опрос Telegram, секунд. */
const POLL_TIMEOUT_S = 25;
/** Пауза после сбоя опроса; растёт до POLL_BACKOFF_MAX_MS. */
const POLL_BACKOFF_MS = 2000;
const POLL_BACKOFF_MAX_MS = 60_000;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

/* ---------- Таблицы ---------- */

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// Чат служебного бота у сотрудника и отметка подтверждённого входа у сессии.
ensureColumn('staff', 'ops_chat_id', 'TEXT');
ensureColumn('sessions', 'admin_ok_until', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE TABLE IF NOT EXISTS ops_links (
    code_hash  TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_challenges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT    NOT NULL,
    code_hash    TEXT    NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'pending',
    chat_id      TEXT,
    message_id   INTEGER,
    ip           TEXT,
    user_agent   TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );
`);

/* ---------- Состояние бота ---------- */

const bot = {
  username: '',
  // Неустранимая ошибка настройки: неверный токен или чужой читатель на нём.
  // С ней подтверждение входа не требуется, иначе панель была бы заперта.
  broken: '',
  offset: 0,
  running: false,
};

/** Задан ли служебный бот вообще. */
export function opsConfigured() {
  return Boolean(opsToken());
}

/**
 * Нужно ли подтверждение входа. Выключается OPS_2FA=off - аварийный ключ на
 * случай, если Telegram недоступен, а в панель надо срочно.
 */
export function twoFactorRequired() {
  return opsConfigured() && !bot.broken && process.env.OPS_2FA !== 'off';
}

/* ---------- Оповещения ---------- */

const recent = new Map();   // key -> { at, suppressed }

/**
 * Оповещение владельцам. Не бросает и не ждёт: вызывается из обработчиков
 * ошибок, и падение отправки не должно ронять то, что и так сломалось.
 */
export function alert(key, text) {
  if (!opsConfigured()) return false;
  const now = Date.now();
  const prev = recent.get(key);
  if (prev && now - prev.at < ALERT_REPEAT_MS) {
    prev.suppressed++;
    return false;
  }
  const repeats = prev?.suppressed ? `\n(ещё ${prev.suppressed} раз за прошлые ${ALERT_REPEAT_MS / 60000} мин)` : '';
  recent.set(key, { at: now, suppressed: 0 });
  const message = `СБОЙ · ${siteLabel()}\n${text}${repeats}`;
  notifyAll(alertRecipients(db), message).catch(() => {});
  return true;
}

/** Сообщение, которое не про сбой: восстановление, привязка, тревога входа. */
export function inform(text) {
  if (!opsConfigured()) return;
  notifyAll(alertRecipients(db), `${siteLabel()}\n${text}`).catch(() => {});
}

/*
 * Счётчик для частых ошибок (500-е ответы). Одна ошибка - не повод будить
 * владельца, десяток за пять минут - повод.
 */
const counters = new Map();
export function countError(key, text, { threshold = 10, windowMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now();
  const list = (counters.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  counters.set(key, list);
  if (list.length >= threshold) {
    counters.set(key, []);
    alert(key, `${text}\n${list.length} раз за ${Math.round(windowMs / 60000)} мин`);
  }
}

/* ---------- Привязка Telegram ---------- */

/*
 * Telegram владельца, закреплённый в окружении (OPS_OWNER_CHAT_ID, через
 * запятую). Подтверждения входа владельца уходят туда сразу, без привязки из
 * панели, и привязать к владельцу другой Telegram нельзя: первая привязка из
 * панели защищена только паролем, а закреплённая в .env - доступом к серверу.
 */
function ownerChats() {
  return String(process.env.OPS_OWNER_CHAT_ID || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function isEnvOwner(staff) {
  return Boolean(staff && staff.role === 'owner' && staff.added_by === null);
}

/** Куда слать подтверждение входа этому сотруднику. */
function chatFor(staff) {
  if (!staff?.active) return '';
  const pinned = isEnvOwner(staff) ? ownerChats() : [];
  if (pinned.length) return pinned.includes(String(staff.ops_chat_id)) ? String(staff.ops_chat_id) : pinned[0];
  return staff.ops_chat_id ? String(staff.ops_chat_id) : '';
}

function displayName(user) {
  return user.email || (user.username ? `@${user.username}` : (user.first_name || `#${user.id}`));
}

/** Ссылка привязки для сотрудника. Пустая строка, если бот не готов. */
export function createLink(userId) {
  if (!bot.username) return '';
  const code = randomBytes(12).toString('base64url');
  db.prepare('DELETE FROM ops_links WHERE user_id = ? OR expires_at < ?').run(userId, Date.now());
  db.prepare('INSERT INTO ops_links (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha(code), userId, Date.now() + LINK_TTL_MS);
  return `https://t.me/${bot.username}?start=link_${code}`;
}

function linkChat(code, from, chatId) {
  const row = db.prepare('SELECT * FROM ops_links WHERE code_hash = ?').get(sha(code));
  if (!row || row.expires_at < Date.now()) return { ok: false, text: 'Ссылка устарела. Возьмите новую в панели.' };
  const user = getUserById(row.user_id);
  const staff = staffRow(row.user_id);
  if (!user || !staff?.active) return { ok: false, text: 'Доступа в панель у этого аккаунта нет.' };
  // Владелец с закреплённым в .env Telegram - только из него.
  const pinned = isEnvOwner(staff) ? ownerChats() : [];
  if (pinned.length && !pinned.includes(String(chatId))) {
    return { ok: false, text: 'Для этого аккаунта Telegram задан на сервере (OPS_OWNER_CHAT_ID).' };
  }
  // У аккаунта уже есть свой Telegram - привязать можно только его.
  if (!pinned.length && user.tg_id != null && String(user.tg_id) !== String(from.id)) {
    return { ok: false, text: 'Этот аккаунт привязан к другому Telegram. Откройте ссылку из него.' };
  }
  db.prepare('DELETE FROM ops_links WHERE code_hash = ?').run(sha(code));
  const before = staff.ops_chat_id;
  db.prepare('UPDATE staff SET ops_chat_id = ? WHERE user_id = ?').run(String(chatId), row.user_id);
  inform(`Сотрудник ${displayName(user)} привязал Telegram для входа в панель`
    + (before && before !== String(chatId) ? ' (сменил прежний)' : '') + '.');
  return { ok: true, text: `Готово. Этот Telegram привязан к панели как ${displayName(user)}. `
    + 'Сюда будут приходить подтверждения входа и оповещения о сбоях.' };
}

/* ---------- Подтверждение входа ---------- */

/** Подтверждён ли вход для этой сессии. */
export function sessionConfirmed(sessionHash) {
  if (!sessionHash) return false;
  const row = db.prepare('SELECT admin_ok_until FROM sessions WHERE token_hash = ?').get(sessionHash);
  return Boolean(row && row.admin_ok_until > Date.now());
}

export function twoFactorState(userId, sessionHash) {
  const staff = staffRow(userId);
  return {
    required: twoFactorRequired(),
    confirmed: sessionConfirmed(sessionHash),
    linked: Boolean(chatFor(staff)),
    bot: bot.username,
  };
}

function shortUa(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'браузер';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Mac OS/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(', ');
}

/** Запрос подтверждения: сообщение в бот с кнопками и кодом. */
export async function requestApproval(userId, sessionHash, { ip, userAgent }) {
  const staff = staffRow(userId);
  const chatId = chatFor(staff);
  if (!chatId) throw Object.assign(new Error('Сначала привяжите Telegram'), { code: 'NOT_LINKED' });
  if (!sessionHash) throw Object.assign(new Error('Войдите на сайт заново'), { code: 'NO_SESSION' });

  const now = Date.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare("UPDATE admin_challenges SET status = 'replaced' WHERE user_id = ? AND status = 'pending'").run(userId);
  const info = db.prepare(`
    INSERT INTO admin_challenges (user_id, session_hash, code_hash, chat_id, ip, user_agent, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, sessionHash, sha(code), chatId, ip || null,
         String(userAgent || '').slice(0, 300) || null, now, now + CHALLENGE_TTL_MS);
  const id = Number(info.lastInsertRowid);

  const when = new Date(now).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const msg = await tg('sendMessage', {
    chat_id: chatId,
    text: `Вход в панель ${siteLabel()}\n\n`
      + `Адрес: ${ip || 'неизвестен'}\nБраузер: ${shortUa(userAgent)}\nВремя: ${when} (МСК)\n\n`
      + `Код: ${code}\nЗапрос действует ${CHALLENGE_TTL_MS / 60000} минут.`,
    reply_markup: { inline_keyboard: [[
      { text: 'Это я, впустить', callback_data: `ok:${id}` },
      { text: 'Это не я', callback_data: `no:${id}` },
    ]] },
  });
  db.prepare('UPDATE admin_challenges SET message_id = ? WHERE id = ?').run(msg.message_id, id);
  return { id, expiresAt: now + CHALLENGE_TTL_MS };
}

function approve(challenge) {
  db.prepare("UPDATE admin_challenges SET status = 'approved' WHERE id = ?").run(challenge.id);
  db.prepare('UPDATE sessions SET admin_ok_until = ? WHERE token_hash = ?')
    .run(Date.now() + ADMIN_2FA_TTL_MS, challenge.session_hash);
}

function deny(challenge) {
  db.prepare("UPDATE admin_challenges SET status = 'denied' WHERE id = ?").run(challenge.id);
  // Чужой вход с верным паролем: закрываем ту сессию сразу.
  deleteSession(challenge.session_hash);
  const user = getUserById(challenge.user_id);
  alert(`deny:${challenge.user_id}`,
    `Отклонён вход в панель под ${user ? displayName(user) : '#' + challenge.user_id}`
    + ` с адреса ${challenge.ip || 'неизвестен'}. Пароль этого аккаунта знает кто-то ещё: смените его.`);
}

/** Ввод кода из сообщения вручную - запасной путь, если кнопка не сработала. */
export function confirmByCode(id, userId, code) {
  const c = db.prepare('SELECT * FROM admin_challenges WHERE id = ? AND user_id = ?').get(id, userId);
  if (!c || c.status !== 'pending' || c.expires_at < Date.now()) {
    throw Object.assign(new Error('Запрос устарел, отправьте новый'), { code: 'EXPIRED' });
  }
  if (sha(String(code || '').trim()) !== c.code_hash) {
    const attempts = c.attempts + 1;
    db.prepare('UPDATE admin_challenges SET attempts = ?, status = ? WHERE id = ?')
      .run(attempts, attempts >= CODE_ATTEMPTS ? 'burned' : 'pending', id);
    throw Object.assign(new Error(attempts >= CODE_ATTEMPTS
      ? 'Слишком много неверных кодов, отправьте новый запрос' : 'Код не подходит'), { code: 'BAD_CODE' });
  }
  approve(c);
  return true;
}

export function challengeStatus(id, userId) {
  const c = db.prepare('SELECT status, expires_at FROM admin_challenges WHERE id = ? AND user_id = ?').get(id, userId);
  if (!c) return 'missing';
  if (c.status === 'pending' && c.expires_at < Date.now()) return 'expired';
  return c.status;
}

/* ---------- Обновления бота ---------- */

async function onCallback(q) {
  const [action, rawId] = String(q.data || '').split(':');
  const c = db.prepare('SELECT * FROM admin_challenges WHERE id = ?').get(Number(rawId));
  let answer = 'Запрос устарел';
  // Нажать может только тот чат, куда ушёл запрос.
  if (c && String(c.chat_id) === String(q.message?.chat?.id) && c.status === 'pending' && c.expires_at > Date.now()) {
    if (action === 'ok') { approve(c); answer = 'Вход подтверждён'; }
    if (action === 'no') { deny(c); answer = 'Вход отклонён, сессия закрыта'; }
    try {
      await tg('editMessageText', {
        chat_id: c.chat_id, message_id: c.message_id,
        text: `${q.message?.text || 'Вход в панель'}\n\n${action === 'ok' ? 'ПОДТВЕРЖДЕНО' : 'ОТКЛОНЕНО'}`,
      });
    } catch { /* сообщение могли удалить - не страшно */ }
  }
  try { await tg('answerCallbackQuery', { callback_query_id: q.id, text: answer }); } catch { /* пусть */ }
}

async function onMessage(m) {
  const text = String(m.text || '').trim();
  const chatId = m.chat?.id;
  if (!chatId || m.chat?.type !== 'private') return;
  const link = /^\/start\s+link_([A-Za-z0-9_-]+)$/.exec(text);
  const reply = link
    ? linkChat(link[1], m.from || {}, chatId).text
    : 'Это служебный бот LUCKYBOX: оповещения о сбоях и подтверждение входа в панель. '
      + 'Привязать его можно из панели управления.';
  try { await tg('sendMessage', { chat_id: chatId, text: reply }); } catch { /* пусть */ }
}

async function pollOnce() {
  const updates = await tg('getUpdates', {
    offset: bot.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'],
  }, { timeoutMs: (POLL_TIMEOUT_S + 10) * 1000 });
  for (const u of updates) {
    bot.offset = u.update_id + 1;
    try {
      if (u.callback_query) await onCallback(u.callback_query);
      else if (u.message) await onMessage(u.message);
    } catch (err) {
      console.error('[ops] обновление не разобрано:', err.message);
    }
  }
}

/**
 * Запуск бота. Неверный токен (401) или второй читатель на том же токене
 * (409) - неустранимая ошибка настройки: бот выключается, подтверждение входа
 * перестаёт требоваться, в журнал пишется причина. Иначе панель оказалась бы
 * заперта на боте, который не может ответить.
 */
export async function startOpsBot() {
  if (!opsConfigured() || bot.running) return;
  if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_TOKEN === opsToken()) {
    bot.broken = 'OPS_BOT_TOKEN совпадает с TELEGRAM_TOKEN: служебному боту нужен отдельный бот';
    console.error(`[ops] ${bot.broken}`);
    return;
  }
  try {
    bot.username = (await tg('getMe')).username || '';
    await tg('deleteWebhook', {});
  } catch (err) {
    if (err.status === 401 || err.status === 404) {
      bot.broken = 'OPS_BOT_TOKEN не принят Telegram';
      console.error(`[ops] ${bot.broken}`);
      return;
    }
    console.error('[ops] Telegram недоступен, повторим:', err.message);
  }
  bot.running = true;
  let backoff = POLL_BACKOFF_MS;
  (async () => {
    while (bot.running) {
      try {
        if (!bot.username) bot.username = (await tg('getMe')).username || '';
        await pollOnce();
        backoff = POLL_BACKOFF_MS;
      } catch (err) {
        if (err.status === 409) {
          bot.broken = 'служебный бот читает кто-то ещё: проверьте, что OPS_BOT_TOKEN не используется в другом месте';
          console.error(`[ops] ${bot.broken}`);
          bot.running = false;
          return;
        }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, POLL_BACKOFF_MAX_MS);
      }
    }
  })();
}

export function stopOpsBot() {
  bot.running = false;
}

/** Для тестов: состояние бота и разбор обновлений без сети. */
export const _test = { bot, onMessage, onCallback, recent };
