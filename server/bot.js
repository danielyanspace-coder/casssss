/**
 * Telegram-бот: вход в мини-апп и напоминания, зовущие игрока обратно.
 *
 * Запускается отдельным процессом от сервера (npm run bot), потому что
 * веб-приложение должно работать и без запущенного бота — например, локально.
 * Из этого следует и обратное: пока бот не запущен, напоминания не уходят,
 * и это нормально, они не срочные.
 */

import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
import {
  pendingSpinReminders, freeCaseReminders, markNoticeSent,
} from './db.js';
import { getCase } from './cases.js';
import { isConfigured as freeCaseConfigured, FREE_CASE_COOLDOWN_MS } from './subscription.js';

const token = process.env.TELEGRAM_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

if (!token) {
  console.error('TELEGRAM_TOKEN не задан в .env');
  process.exit(1);
}
if (!webAppUrl || !webAppUrl.startsWith('https://')) {
  console.error('WEBAPP_URL не задан или не https - Telegram открывает мини-аппы только по HTTPS');
  process.exit(1);
}

const bot = new Bot(token);

const keyboard = new InlineKeyboard().webApp('Открыть кейсы', webAppUrl);

bot.command('start', (ctx) =>
  ctx.reply(
    'LUCKYBOX - кейсы, апгрейд, краш и рулетка.\n\n' +
      'Содержимое каждого кейса показано целиком до открытия, ' +
      'а результат любого раунда можно перепроверить самостоятельно ' +
      'через provably fair.\n\n' +
      '18+. Играйте ответственно.',
    { reply_markup: keyboard }
  )
);

bot.command('play', (ctx) => ctx.reply('Погнали:', { reply_markup: keyboard }));

bot.command('help', (ctx) =>
  ctx.reply(
    'Как это работает:\n\n' +
      '• У каждого кейса показано всё его содержимое до открытия.\n' +
      '• Шансы одинаковы для всех и не зависят от вашей истории.\n' +
      '• Provably fair: хеш серверного seed показан заранее, ' +
      'после смены seed любой ролл можно пересчитать.\n\n' +
      '/play - открыть приложение'
  )
);

bot.catch((err) => console.error('Ошибка бота:', err));

/* ============================================================
   НАПОМИНАНИЯ
   ============================================================ */

/**
 * Бот сам зовёт игрока обратно: недокрученные фриспины и снова доступный
 * бесплатный кейс - это уже оплаченные поводы вернуться, о которых игрок
 * просто не знает, пока не откроет приложение.
 *
 * Почему это здесь, а не в сервере. Отправлять сообщения умеет только процесс
 * с токеном бота, а держать второй экземпляр Bot в веб-приложении значило бы
 * два подключения к Telegram с одним токеном.
 */

// Как часто просыпаемся. Чаще незачем: поводы появляются раз в сутки, а
// каждая проверка - это запрос к базе.
const SWEEP_INTERVAL_MS = Number(process.env.BOT_SWEEP_MIN || 30) * 60_000;

// Серию напоминаем не сразу: игрок мог просто выйти на минуту.
const SPINS_WAIT_MS = Number(process.env.BOT_SPINS_WAIT_MIN || 90) * 60_000;

// Ночью не пишем. Часы московские: аудитория русскоязычная, и сообщение в
// четыре утра стоит одной блокировки бота вместо одного возврата.
const QUIET_FROM_H = 22;
const QUIET_TO_H = 10;

// Пауза между сообщениями. Telegram ограничивает рассылку примерно 30
// сообщениями в секунду, и упираться в потолок незачем: напоминания не срочные.
const SEND_GAP_MS = 120;

// Сколько напоминаний за один проход. Ограничение не про Telegram, а про нас:
// при первом запуске на живой базе иначе улетела бы рассылка по всем сразу.
const BATCH = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function moscowHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false,
  }).format(now));
}

function isQuietNow() {
  const h = moscowHour();
  return h >= QUIET_FROM_H || h < QUIET_TO_H;
}

/**
 * Отправляет напоминание и помечает его отправленным.
 *
 * Метка ставится и при ошибке 403 - это значит, что игрок заблокировал бота,
 * и повторять попытку каждые полчаса бессмысленно. Любая другая ошибка метки
 * не ставит: подождём следующего прохода.
 */
async function remind(row, kind, tag, text) {
  try {
    await bot.api.sendMessage(row.tg_id, text, { reply_markup: keyboard });
    markNoticeSent(row.id, kind, tag);
    return true;
  } catch (err) {
    if (err?.error_code === 403) {
      markNoticeSent(row.id, kind, tag);
      return false;
    }
    console.error('Не удалось отправить напоминание:', err?.description || err);
    return false;
  }
}

async function sweep() {
  if (isQuietNow()) return;

  let sent = 0;

  for (const row of pendingSpinReminders(SPINS_WAIT_MS, BATCH)) {
    const name = getCase(row.case_id)?.name || 'кейсе';
    const ok = await remind(row, 'freespins', row.created_at,
      `У вас остались недокрученные фриспины в кейсе «${name}».\n\n` +
      'Они никуда не денутся, но и сами себя не откроют.');
    if (ok) sent++;
    await sleep(SEND_GAP_MS);
  }

  if (freeCaseConfigured()) {
    for (const row of freeCaseReminders(FREE_CASE_COOLDOWN_MS, BATCH)) {
      const tag = row.free_case_at ? row.free_case_at + FREE_CASE_COOLDOWN_MS : 0;
      const ok = await remind(row, 'free_case', tag,
        'Бесплатный кейс снова доступен. Забрать можно один раз в сутки.');
      if (ok) sent++;
      await sleep(SEND_GAP_MS);
    }
  }

  if (sent) console.log(`Отправлено напоминаний: ${sent}`);
}

// Проход в try/catch: упавшее напоминание не должно ронять бота, из-за
// которого игроки вообще попадают в приложение.
setInterval(() => { sweep().catch((err) => console.error('Проход напоминаний:', err)); },
  SWEEP_INTERVAL_MS);

// Кнопка рядом с полем ввода — самый заметный вход в мини-апп.
await bot.api.setChatMenuButton({
  menu_button: { type: 'web_app', text: 'Кейсы', web_app: { url: webAppUrl } },
});

console.log('Бот запущен. Мини-апп:', webAppUrl);
bot.start();
