/**
 * Telegram-бот: единственная задача — дать кнопку, открывающую мини-апп.
 *
 * Запускается отдельным процессом от сервера (npm run bot), потому что
 * веб-приложение должно работать и без запущенного бота — например, локально.
 */

import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

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

// Кнопка рядом с полем ввода — самый заметный вход в мини-апп.
await bot.api.setChatMenuButton({
  menu_button: { type: 'web_app', text: 'Кейсы', web_app: { url: webAppUrl } },
});

console.log('Бот запущен. Мини-апп:', webAppUrl);
bot.start();
