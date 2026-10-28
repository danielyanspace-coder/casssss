/**
 * Рассылка дневного кода ботом (server/broadcast.js), Telegram подменён
 * своим сервером на localhost:
 * - уходит всем подписчикам и вошедшим через Telegram, каждому по разу;
 * - картинка грузится файлом один раз, дальше идёт по file_id;
 * - 403 помечает чат заблокированным, в следующую рассылку он не попадает;
 * - 429 выжидается и сообщение доходит;
 * - перезапуск посреди рассылки продолжает с курсора, без повторов;
 * - вторая рассылка, пока идёт первая, не начинается.
 *
 * Запуск: node test/broadcast.mjs
 */
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';

process.env.DB_PATH = './data/broadcast-test.db';
process.env.DEV_MODE = 'false';
process.env.TELEGRAM_TOKEN = 'TEST:TOKEN';
process.env.SITE_URL = 'https://lucky.example';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Подменённый Telegram ---------- */

const got = [];
let multipart = 0;
let throttleOnce = new Set([105]);
const blocked = new Set([103]);
let hold = null;

const fake = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const type = req.headers['content-type'] || '';
  let chatId; let photo; let caption; let markup;
  if (type.includes('multipart')) {
    multipart++;
    const text = body.toString('latin1');
    chatId = Number(/name="chat_id"\r\n\r\n(-?\d+)/.exec(text)?.[1]);
    photo = 'FILE';
    caption = Buffer.from(/name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1] || '', 'latin1').toString('utf8');
    markup = /name="reply_markup"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1];
  } else {
    const j = JSON.parse(body.toString('utf8'));
    chatId = j.chat_id; photo = j.photo; caption = j.caption; markup = j.reply_markup && JSON.stringify(j.reply_markup);
  }
  if (hold) await hold;
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (throttleOnce.has(chatId)) {
    throttleOnce.delete(chatId);
    return send(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } });
  }
  if (blocked.has(chatId)) return send(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
  got.push({ chatId, photo, caption, markup });
  send(200, { ok: true, result: { message_id: got.length, photo: [{ file_id: 'small' }, { file_id: 'BIG_ID' }] } });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${fake.address().port}`;

const db = await import('../server/db.js');
const broadcast = await import('../server/broadcast.js');

/* ---------- Список получателей ---------- */

for (const id of [101, 102, 103, 104, 105]) db.touchBotSubscriber(id, { username: `u${id}` });
// Вошедший через Telegram получает тоже, хоть и не жал «Старт»; дубль с
// подписчиком - один раз.
db.getOrCreateUser({ id: 106, first_name: 'Тг' });
db.getOrCreateUser({ id: 101, first_name: 'Дубль' });
check('получатели: подписчики и вошедшие через Telegram без дублей', db.broadcastAudience() === 6, db.nextBroadcastRecipients(0, 50).join(','));

/* ---------- Рассылка ---------- */

const waitDone = async (id) => {
  for (let i = 0; i < 200; i++) {
    const b = db.getBroadcast(id);
    if (b.status !== 'running') return b;
    await sleep(50);
  }
  return db.getBroadcast(id);
};

const first = broadcast.startDailyPromo(null, 'SPINTEST1');
let second;
try { broadcast.startDailyPromo(null, 'SPINTEST2'); } catch (e) { second = e; }
check('вторая рассылка, пока идёт первая, не начинается', second?.code === 'TAKEN');
const done = await waitDone(first.id);

check('рассылка закончилась', done.status === 'done', JSON.stringify(done));
check('дошло всем, кроме заблокировавшего', done.sent === 5 && done.failed === 1, `${done.sent}/${done.failed}`);
check('каждому по одному сообщению', new Set(got.map((g) => g.chatId)).size === got.length && got.length === 5);
check('картинка загружена файлом один раз', multipart === 1, multipart);
check('дальше картинка по file_id', got.slice(1).every((g) => g.photo === 'BIG_ID'));
check('429 выждан, сообщение дошло', got.some((g) => g.chatId === 105));
const msg = got[0];
check('текст: код моноширинным', msg.caption.includes('<code>SPINTEST1</code>'), msg.caption);
check('текст: жирный заголовок и курсив', /<b>По традиции/.test(msg.caption) && /<i>Забирайте/.test(msg.caption));
check('кнопка ведёт на колесо с кодом', /lucky\.example\/\?wheel=SPINTEST1/.test(msg.markup || ''), msg.markup);
check('заблокировавший помечен', db.broadcastAudience() === 5);

/* ---------- Перезапуск посреди рассылки ---------- */

got.length = 0;
let release;
hold = new Promise((r) => { release = r; });
const b2 = db.createBroadcast({ kind: 'daily_promo', promoCode: 'SPINTEST3', text: broadcast.dailyPromoText('SPINTEST3') });
// Будто прошлый процесс успел отправить двум первым и упал.
db.advanceBroadcast(b2.id, { cursor: 102, ok: true });
db.advanceBroadcast(b2.id, { cursor: 102, ok: true });
hold = null; release();
broadcast.resumeBroadcasts();
const d2 = await waitDone(b2.id);
check('после перезапуска - только оставшимся', got.length === 3 && !got.some((g) => g.chatId <= 102),
  got.map((g) => g.chatId).join(','));
check('после перезапуска счётчик сходится', d2.sent === 5 && d2.status === 'done', JSON.stringify(d2));

/* ---------- Подписчик вернулся ---------- */
db.touchBotSubscriber(103, { username: 'back' });
check('написал боту снова - вернулся в рассылку', db.broadcastAudience() === 6);

fake.close();
if (failures.length) {
  console.error(`Рассылка бота: не пройдено ${failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Рассылка бота: ${passed} проверок пройдено`);
process.exit(0);
