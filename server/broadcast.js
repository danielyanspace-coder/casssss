/**
 * Рассылка ботом с промокодами: дневной код Колеса удачи всем, кто нажал
 * «Старт» (кнопка «Разместить промокод» во вкладке «Колесо удачи» кабинета
 * /partners).
 *
 * Шлёт сервер, а не процесс бота. Бот читает обновления долгим опросом, и
 * второго читателя на том же токене Telegram не пустит, но отправка
 * сообщений - обычные запросы к API, они с опросом не спорят.
 *
 * Рассылка идёт в фоне и пишет курсор после каждого сообщения: перезапуск
 * сервера посреди неё продолжает с того же места (resumeBroadcasts), и
 * никто не получает код дважды.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBroadcast, getBroadcast, runningBroadcasts, nextBroadcastRecipients,
  advanceBroadcast, finishBroadcast, markBotBlocked,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Картинка дневного кода: «Дневной промокод» от заказчика. */
export const DAILY_PROMO_IMAGE = join(__dirname, '..', 'public', 'assets', 'ui', 'promo-daily.jpg');

/*
 * Пауза между сообщениями. Telegram пускает около 30 сообщений в секунду
 * на бота; держимся ниже, чтобы не ловить 429 на каждом десятке.
 */
const SEND_GAP_MS = 45;
/** Сколько получателей берём из базы за раз. */
const BATCH = 50;
/** Сколько раз повторяем одно сообщение после 429 или сбоя сети. */
const MAX_TRIES = 4;
/** Пауза после сбоя сети, если Telegram не назвал свою. */
const RETRY_MS = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => process.env.TELEGRAM_TOKEN || '';
// Подмена адреса Telegram - только для test/broadcast.mjs.
const apiBase = () => (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function isConfigured() {
  return Boolean(token());
}

/*
 * Текст дневного кода. Код - моноширинным: в Telegram такой текст
 * копируется одним нажатием, а набирать его руками - лишний повод ошибиться.
 */
export function dailyPromoText(code) {
  return [
    '💰 <b>По традиции делимся дневным токеном на прокрут Колеса Удачи:</b>',
    '',
    `🎟 <code>${esc(code)}</code>`,
    '',
    '<i>Забирайте токен и не упускайте свой ежедневный шанс на бонус.</i>',
    '',
    '🎰 <b><u>LuckyBox</u></b> - игры и кейсы',
  ].join('\n');
}

/** Кнопка под сообщением: сразу на колесо с подставленным кодом. */
function wheelButton(code) {
  const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(site)) return undefined;
  return { inline_keyboard: [[{ text: '🎡 Крутить колесо', url: `${site}/?wheel=${encodeURIComponent(code)}` }]] };
}

/**
 * Одно сообщение. Первое уходит файлом, дальше - по file_id, который вернул
 * Telegram: картинку не нужно загружать заново тысячу раз.
 */
async function sendOne(chatId, b, photoId) {
  const caption = b.text;
  const markup = b.promo_code ? wheelButton(b.promo_code) : undefined;
  let res;
  if (photoId) {
    res = await fetch(`${apiBase()}/bot${token()}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoId, caption, parse_mode: 'HTML', reply_markup: markup }),
    });
  } else {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
    if (markup) form.set('reply_markup', JSON.stringify(markup));
    form.set('photo', new Blob([readFileSync(DAILY_PROMO_IMAGE)], { type: 'image/jpeg' }), 'promo.jpg');
    res = await fetch(`${apiBase()}/bot${token()}/sendPhoto`, { method: 'POST', body: form });
  }
  const data = await res.json().catch(() => ({}));
  const sizes = data.result?.photo || [];
  return { status: res.status, data, photoId: sizes.length ? sizes[sizes.length - 1].file_id : null };
}

const active = new Set();

async function run(id) {
  if (active.has(id)) return;
  active.add(id);
  try {
    let b = getBroadcast(id);
    let photoId = b.photo_id;
    for (;;) {
      const batch = nextBroadcastRecipients(b.cursor, BATCH);
      if (!batch.length) break;
      for (const chatId of batch) {
        let ok = false;
        for (let tries = 0; tries < MAX_TRIES; tries++) {
          let r;
          try { r = await sendOne(chatId, b, photoId); }
          catch { await sleep(RETRY_MS); continue; }
          if (r.status === 200 && r.data.ok) {
            ok = true;
            if (!photoId && r.photoId) photoId = r.photoId;
            break;
          }
          if (r.status === 429) { await sleep((r.data.parameters?.retry_after || 3) * 1000); continue; }
          // 403 - бот заблокирован, 400 «chat not found» - чата больше нет:
          // в следующие рассылки этот адресат не попадёт.
          if (r.status === 403 || (r.status === 400 && /chat not found|user is deactivated/i.test(r.data.description || ''))) {
            markBotBlocked(chatId);
          }
          if (r.status === 401) {
            finishBroadcast(id, { status: 'failed', error: 'Telegram не принял токен бота (401)' });
            return;
          }
          break;
        }
        advanceBroadcast(id, { cursor: chatId, ok, photoId });
        await sleep(SEND_GAP_MS);
      }
      b = getBroadcast(id);
    }
    finishBroadcast(id);
  } catch (err) {
    console.error('[broadcast]', err);
    finishBroadcast(id, { status: 'failed', error: String(err.message || err) });
  } finally {
    active.delete(id);
  }
}

/** Новая рассылка дневного кода. Вторая, пока идёт первая, не начинается. */
export function startDailyPromo(adminId, code) {
  if (!isConfigured()) throw Object.assign(new Error('Бот с промокодами не настроен (TELEGRAM_TOKEN)'), { code: 'CLOSED' });
  if (runningBroadcasts().length) throw Object.assign(new Error('Предыдущая рассылка ещё идёт'), { code: 'TAKEN' });
  const b = createBroadcast({ kind: 'daily_promo', promoCode: code, text: dailyPromoText(code), adminId });
  run(b.id);
  return b;
}

/** После перезапуска: недосланные рассылки продолжаются с курсора. */
export function resumeBroadcasts() {
  if (!isConfigured()) return;
  for (const b of runningBroadcasts()) run(b.id);
}
