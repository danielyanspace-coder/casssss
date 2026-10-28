/**
 * Telegram-бот: ссылка на сайт и напоминания, зовущие игрока обратно.
 *
 * Проект - сайт, а не мини-приложение: бот открывает его обычной ссылкой во
 * внешнем браузере. Писать бот может только тем, кто вошёл через Telegram или
 * привязал его в профиле: у зарегистрированного по почте адресата в Telegram
 * нет (см. pendingSpinReminders и freeCaseReminders в db.js).
 *
 * Запускается отдельным процессом от сервера (npm run bot), потому что
 * веб-приложение должно работать и без запущенного бота - например, локально.
 * Из этого следует и обратное: пока бот не запущен, напоминания не уходят,
 * и это нормально, они не срочные.
 */

import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
import {
  pendingSpinReminders, freeCaseReminders, markNoticeSent,
  touchBotSubscriber, markBotBlocked,
} from './db.js';
import { getCase } from './cases.js';
import { isConfigured as freeCaseConfigured, FREE_CASE_COOLDOWN_MS } from './subscription.js';

const token = process.env.TELEGRAM_TOKEN;
const webAppUrl = process.env.SITE_URL || process.env.WEBAPP_URL;

/*
 * Бот на сайте необязателен: без токена работает вход по почте, а бот просто
 * не нужен. Поэтому выход без ошибки - служба с Restart=on-failure тогда не
 * перезапускает его каждые пять секунд и не засыпает журнал.
 */
if (!token) {
  console.log('TELEGRAM_TOKEN не задан: бот не нужен, выходим');
  process.exit(0);
}
if (!webAppUrl || !webAppUrl.startsWith('https://')) {
  console.error('SITE_URL не задан или не https: Telegram не даёт ставить в кнопки адрес без HTTPS');
  process.exit(1);
}

const bot = new Bot(token);

const keyboard = new InlineKeyboard().url('Открыть LUCKYBOX', webAppUrl);

/*
 * Каждый, кто пишет боту в личке, попадает в список рассылки дневного кода
 * (server/broadcast.js). Писать первым Telegram боту не даёт, поэтому список
 * собирается только так. Ошибка базы не должна мешать ответу на сообщение.
 */
bot.use(async (ctx, next) => {
  if (ctx.chat?.type === 'private' && ctx.from) {
    try { touchBotSubscriber(ctx.chat.id, { username: ctx.from.username || null, firstName: ctx.from.first_name || null }); }
    catch (err) { console.error('[bot] подписчик', err.message); }
  }
  return next();
});

// Заблокировал бота - из рассылки выпадает; разблокировал - вернётся
// первым же сообщением (touchBotSubscriber снимает пометку).
bot.on('my_chat_member', (ctx) => {
  const st = ctx.myChatMember?.new_chat_member?.status;
  if (ctx.chat?.type === 'private' && (st === 'kicked' || st === 'left')) {
    try { markBotBlocked(ctx.chat.id); } catch { /* не критично */ }
  }
});

bot.command('start', (ctx) =>
  ctx.reply(
    'LUCKYBOX - кейсы, апгрейд, краш и рулетка.\n\n' +
      'Сюда каждый день приходит промокод на прокрут Колеса удачи.\n\n' +
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
      '/play - открыть сайт'
  )
);

bot.catch((err) => console.error('Ошибка бота:', err));

/* ============================================================
   НАПОМИНАНИЯ
   ============================================================ */

/**
 * Бот сам зовёт игрока обратно: недокрученные фриспины и снова доступный
 * бесплатный кейс - это уже оплаченные поводы вернуться, о которых игрок
 * просто не знает, пока не зайдёт на сайт.
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
// которого игроки вообще попадают на сайт.
setInterval(() => { sweep().catch((err) => console.error('Проход напоминаний:', err)); },
  SWEEP_INTERVAL_MS);

/*
 * Кнопку мини-приложения рядом с полем ввода снимаем: она открыла бы сайт
 * внутри Telegram, а сайт рассчитан на обычный браузер. Вход - ссылкой из
 * сообщений и команды /play.
 */
await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });

console.log('Бот запущен. Сайт:', webAppUrl);
bot.start();
