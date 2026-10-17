/**
 * Вход на сайт: почта с паролем, Telegram и сессии.
 *
 * Проект начинался мини-приложением Telegram, где игрока опознавала подпись
 * initData. Теперь это обычный сайт, и опознаёт игрока сессия: случайный
 * токен в cookie, а в базе только его хеш. Telegram остался вторым способом
 * входа (официальный виджет Telegram Login) и привязкой к аккаунту: без неё
 * не проверить подписку на канал и некуда слать напоминания бота.
 *
 * Почему cookie, а не токен в localStorage: httpOnly-cookie не прочитать
 * скриптом, и чужой код на странице (расширение, взломанный CDN шрифтов)
 * не унесёт сессию. SameSite=Lax не даёт другому сайту отправить запрос от
 * имени игрока, а сверка Origin в requireSameOrigin закрывает остальное.
 */

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import {
  createSession, sessionByHash, extendSession, deleteSession, getUserById,
  getOrCreateUser,
} from './db.js';

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = 'lb_session';

/** Сколько живёт сессия без входа заново. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/*
 * Сессия продлевается, когда прожита половина срока: игрок, который заходит
 * раз в неделю, не вылетает никогда, а продление на каждом запросе означало
 * бы запись в базу на каждую ставку.
 */
const SESSION_RENEW_AFTER_MS = SESSION_TTL_MS / 2;

/** Подпись виджета Telegram старше суток не принимается: её могли подсмотреть. */
const TELEGRAM_LOGIN_MAX_AGE_S = 24 * 60 * 60;

/*
 * Параметры scrypt. N = 2^15 - около 50 мс на проверку пароля: для человека
 * незаметно, для перебора по утёкшей базе дорого. Память 32 МБ на вызов,
 * поэтому maxmem задан явно: по умолчанию Node пускает только 32 МБ ровно.
 */
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
export const NICK_MIN = 2;
export const NICK_MAX = 24;

const fail = (message, code = 'BAD') => Object.assign(new Error(message), { code });

/* ---------- Проверка ввода ---------- */

/** Почта в нижнем регистре или исключение. Проверка намеренно простая. */
export function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw fail('Проверьте адрес почты');
  }
  return email;
}

export function checkPassword(raw) {
  const password = String(raw ?? '');
  if (password.length < PASSWORD_MIN) throw fail(`Пароль не короче ${PASSWORD_MIN} символов`);
  if (password.length > PASSWORD_MAX) throw fail('Слишком длинный пароль');
  return password;
}

export function normalizeNick(raw) {
  const nick = String(raw || '').trim().replace(/\s+/g, ' ');
  if (nick.length < NICK_MIN || nick.length > NICK_MAX || !/^[\p{L}\p{N} _.-]+$/u.test(nick)) {
    throw fail(`Ник: от ${NICK_MIN} до ${NICK_MAX} букв или цифр`);
  }
  return nick;
}

/* ---------- Пароли ---------- */

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Параметры берутся из самой записи, а не из констант: поднимем N позже -
 * старые пароли продолжат проверяться.
 */
export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, n, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(String(password ?? ''), Buffer.from(salt, 'base64url'), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/*
 * Хеш-пустышка для входа по несуществующей почте. Без него ответ «нет такой
 * почты» приходил бы мгновенно, а «неверный пароль» через 50 мс, и по времени
 * ответа можно было бы перебрать, кто зарегистрирован.
 */
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ||= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

/* ---------- Telegram ---------- */

/**
 * Проверка данных виджета Telegram Login.
 *
 * Отличается от initData мини-приложения: секрет здесь SHA-256 от токена
 * бота, а не HMAC с ключом «WebAppData». Перепутать их - и не пройдёт ни одна
 * настоящая подпись.
 */
export function verifyTelegramLogin(data, botToken) {
  if (!botToken) return { ok: false, error: 'Вход через Telegram не настроен' };
  if (!data || typeof data !== 'object' || !data.hash || !data.id) {
    return { ok: false, error: 'Нет данных Telegram' };
  }
  const fields = Object.keys(data)
    .filter((k) => k !== 'hash' && data[k] !== undefined && data[k] !== null)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(fields).digest();
  const provided = Buffer.from(String(data.hash), 'hex');
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, error: 'Подпись Telegram не совпадает' };
  }
  const authDate = Number(data.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > TELEGRAM_LOGIN_MAX_AGE_S) {
    return { ok: false, error: 'Вход через Telegram устарел, повторите' };
  }
  return {
    ok: true,
    user: {
      id: Number(data.id),
      username: data.username || null,
      first_name: [data.first_name, data.last_name].filter(Boolean).join(' ') || null,
    },
  };
}

/* ---------- Сессии ---------- */

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return '';
}

function writeCookie(req, res, value, maxAgeMs) {
  const bits = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // На локальной машине http, и Secure-cookie браузер бы просто не сохранил.
  if (req.secure) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

/** Заводит сессию и ставит cookie. Вызывать после успешного входа. */
export function startSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  createSession({
    tokenHash: hashToken(token),
    userId,
    ttlMs: SESSION_TTL_MS,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  writeCookie(req, res, token, SESSION_TTL_MS);
}

export function endSession(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) deleteSession(hashToken(token));
  writeCookie(req, res, '', 0);
}

/** Хеш текущей сессии: чтобы при смене пароля не выкинуть того, кто меняет. */
export function currentSessionHash(req) {
  const token = readCookie(req, SESSION_COOKIE);
  return token ? hashToken(token) : '';
}

/*
 * Тестовый игрок DEV_MODE. Его Telegram ID совпадает с тем, что прописан в
 * ADMIN_TG_IDS у тестов и CI, поэтому он же владелец панели.
 */
const DEV_USER = { id: 999000001, username: 'dev_user', first_name: 'Разработчик' };

/**
 * Достаёт игрока из запроса: { ok, user } со строкой из базы.
 *
 * В DEV_MODE запрос без сессии считается запросом тестового игрока - иначе
 * тесты и разработка на localhost упирались бы в форму входа. Заголовок
 * X-Dev-Anon выключает эту подмену: им тесты проверяют сам вход. На рабочем
 * сервере DEV_MODE обязан быть выключен, см. CLAUDE.md.
 */
export function resolveUser(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const session = sessionByHash(hashToken(token));
    if (session) {
      const user = getUserById(session.user_id);
      if (user) {
        if (session.expires_at - Date.now() < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS) {
          extendSession(session.token_hash, Date.now() + SESSION_TTL_MS);
          if (res) writeCookie(req, res, token, SESSION_TTL_MS);
        }
        return { ok: true, user, viaSession: true };
      }
    }
  }

  if (process.env.DEV_MODE === 'true' && !req.get('x-dev-anon')) {
    return { ok: true, user: getOrCreateUser(DEV_USER) };
  }
  return { ok: false, error: 'Войдите в аккаунт', code: 'AUTH' };
}

/**
 * Запрос с cookie обязан прийти с нашей же страницы. SameSite=Lax уже не
 * пускает cookie в POST с чужого сайта, это вторая стена: старые браузеры и
 * поддомены, которые Lax считает «тем же сайтом». Origin браузер ставит сам,
 * и подделать его со страницы нельзя.
 */
export function isSameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/* ---------- Сброс пароля ---------- */

export const RESET_TTL_MS = 60 * 60 * 1000;

export function newResetToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export const resetTokenHash = hashToken;
