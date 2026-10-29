import { InlineKeyboard, Keyboard } from 'grammy';

/** Постоянное меню и приветствие игрового бота; без сетевых вызовов при импорте. */
export function registerBotMenu(bot) {
  const menu = new Keyboard().text('Поддержка').text('Актуальная ссылка').resized().persistent();
  bot.command('start', (ctx) =>
    ctx.reply(
      '🎰 <b>LUCKYBOX</b> - кейсы, апгрейд, краш и рулетка.\n\n' +
        '🎁 Каждый день в канале - промокод на прокрут <b>Колеса удачи</b>!\n\n' +
        '🔍 <b>Полная прозрачность:</b> содержимое каждого кейса известно до открытия, ' +
        'а результаты любых раундов можно самостоятельно проверить с помощью технологии <b>Provably Fair</b>.\n\n' +
        '🎡 Открывай кейсы, испытывай удачу и проверяй честность результатов самостоятельно!\n\n' +
        '🔞 <b>18+ | Играйте ответственно.</b>',
      { parse_mode: 'HTML', reply_markup: menu }
    )
  );

  // Постоянная клавиатура под полем ввода, отдельно от кнопок постов.
  bot.hears('Поддержка', (ctx) => ctx.reply(
    '💬 <b>Поддержка LUCKYBOX</b>\n\nПо вопросам аккаунта, пополнений и вывода напишите @luckybox_support.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('Написать в поддержку', 'https://t.me/luckybox_support') }
  ));
  bot.hears('Актуальная ссылка', (ctx) => ctx.reply(
    '🔗 <b>Актуальная ссылка LUCKYBOX</b>\n\nhttps://lucky-box.duckdns.org\n\n' +
      '🌐 Если сайт не открывается, попробуйте зайти с VPN: иногда он нужен для доступа.\n\n🔞 18+ | Играйте ответственно.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('Открыть LUCKYBOX', 'https://lucky-box.duckdns.org') }
  ));
}
