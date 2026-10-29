import assert from 'node:assert/strict';
import { Bot } from 'grammy';
import { registerBotMenu } from '../server/bot-menu.js';

// Обрабатываем настоящие Telegram updates через grammY, не вызывая Telegram.
const bot = new Bot('123:test', { botInfo: {
  id: 123, is_bot: true, first_name: 'Lucky Box', username: 'Luckyboxbonus_bot',
  can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
} });
const sent = [];
bot.api.config.use(async (_prev, method, payload) => {
  assert.equal(method, 'sendMessage');
  sent.push(payload);
  return { ok: true, result: { message_id: sent.length, date: 0,
    chat: { id: 456, type: 'private' }, text: payload.text } };
});
registerBotMenu(bot);
for (const [i, text] of ['/start', 'Поддержка', 'Актуальная ссылка'].entries()) {
  await bot.handleUpdate({ update_id: i, message: {
    message_id: i, date: 0, chat: { id: 456, type: 'private' },
    from: { id: 456, is_bot: false, first_name: 'Tester' }, text,
    ...(text === '/start' ? { entities: [{ type: 'bot_command', offset: 0, length: 6 }] } : {}),
  } });
}
assert.equal(sent.length, 3);
assert.deepEqual(sent[0].reply_markup.keyboard, [[{ text: 'Поддержка' }, { text: 'Актуальная ссылка' }]]);
assert.equal(sent[0].reply_markup.is_persistent, true);
assert.equal(sent[0].parse_mode, 'HTML');
assert.match(sent[0].text, /🎰 <b>LUCKYBOX<\/b>/);
assert.match(sent[0].text, /<b>Provably Fair<\/b>/);
assert.match(sent[0].text, /18\+ \| Играйте ответственно/);
assert.equal(sent[1].reply_markup.inline_keyboard[0][0].url, 'https://t.me/luckybox_support');
assert.equal(sent[2].reply_markup.inline_keyboard[0][0].url, 'https://lucky-box.duckdns.org');
assert.match(sent[2].text, /VPN/);
console.log('Bot menu: 10 checks passed (mock Telegram API)');
