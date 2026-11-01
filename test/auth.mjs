/**
 * Вход на сайт: пароли, Telegram, сессии, привязки, письма и перенос старой базы.
 *
 *   npm run test:auth
 *
 * Сервер не нужен: модули берутся напрямую, запрос и ответ подменены
 * минимальными заглушками. Отдельно проверяется перенос базы, заведённой
 * ещё мини-приложением: у неё tg_id NOT NULL, и после старта на новой версии
 * игроки, деньги и ссылки на них обязаны остаться на месте.
 */
import { rmSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import Database from 'better-sqlite3';

process.env.DB_PATH = './data/auth-test.db';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
delete process.env.DEV_MODE;
process.env.PAYOUT_DATA_KEY = '0'.repeat(64);

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};
const throwsCode = (fn, code) => {
  try { fn(); return false; } catch (err) { return err.code === code; }
};

/* ---------- База мини-приложения ---------- */

/*
 * Схема users и partners в том виде, в каком их создавала версия до входа на
 * сайте: tg_id NOT NULL. Остальные колонки добавит сам db.js, как он делал
 * это на рабочем сервере.
 */
{
  const old = new Database(process.env.DB_PATH);
  old.exec(`
    CREATE TABLE users (
      id                INTEGER PRIMARY KEY,
      tg_id             TEXT    NOT NULL UNIQUE,
      username          TEXT,
      first_name        TEXT,
      balance           INTEGER NOT NULL DEFAULT 1000,
      server_seed       TEXT    NOT NULL,
      server_seed_hash  TEXT    NOT NULL,
      client_seed       TEXT    NOT NULL,
      nonce             INTEGER NOT NULL DEFAULT 0,
      prev_server_seed  TEXT,
      prev_server_hash  TEXT,
      total_rounds      INTEGER NOT NULL DEFAULT 0,
      total_spent       INTEGER NOT NULL DEFAULT 0,
      total_won         INTEGER NOT NULL DEFAULT 0,
      best_multiplier   REAL    NOT NULL DEFAULT 0,
      last_bonus_at     INTEGER NOT NULL DEFAULT 0,
      is_admin          INTEGER NOT NULL DEFAULT 0,
      is_blocked        INTEGER NOT NULL DEFAULT 0,
      x2_case_id        TEXT,
      gamble_stake      INTEGER NOT NULL DEFAULT 0,
      gamble_case       TEXT,
      created_at        INTEGER NOT NULL
    );
    CREATE TABLE partners (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id      TEXT    NOT NULL UNIQUE,
      name       TEXT,
      share_pct  REAL    NOT NULL DEFAULT 30,
      is_active  INTEGER NOT NULL DEFAULT 1,
      note       TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE rounds (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      game         TEXT    NOT NULL,
      title        TEXT    NOT NULL,
      subtitle     TEXT    NOT NULL,
      bet          INTEGER NOT NULL,
      payout       INTEGER NOT NULL,
      multiplier   REAL    NOT NULL,
      tier         TEXT,
      created_at   INTEGER NOT NULL
    );
  `);
  const add = old.prepare(`INSERT INTO users (id, tg_id, username, first_name, balance, server_seed,
    server_seed_hash, client_seed, created_at) VALUES (?, ?, ?, ?, ?, 's', 'h', 'c', 1)`);
  add.run(7, '700', 'old_one', 'Старый', 12_345);
  add.run(8, '800', 'old_two', 'Второй', 500);
  old.prepare(`INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier, created_at)
               VALUES (7, 'case', 'Кейс', '-', 100, 50, 0.5, 1)`).run();
  old.prepare("INSERT INTO partners (tg_id, name, created_at) VALUES ('800', 'Старый партнёр', 1)").run();
  old.close();
}

const db = await import('../server/db.js');
const auth = await import('../server/auth.js');

/* ---------- 1. Перенос базы ---------- */

{
  const col = (table, name) => db.db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === name);
  check('перенос: tg_id игроков больше не NOT NULL', col('users', 'tg_id')?.notnull === 0);
  check('перенос: tg_id партнёров больше не NOT NULL', col('partners', 'tg_id')?.notnull === 0);
  check('перенос: у игроков есть почта и пароль', !!col('users', 'email') && !!col('users', 'password_hash'));
  check('перенос: у партнёров есть user_id', !!col('partners', 'user_id'));
  const u7 = db.getUserById(7);
  check('перенос: игрок и баланс на месте', u7?.balance === 12_345 && u7.tg_id === '700',
    JSON.stringify(u7 && { balance: u7.balance, tg: u7.tg_id }));
  check('перенос: раунд по-прежнему ссылается на игрока',
    db.db.prepare('SELECT user_id FROM rounds WHERE user_id = 7').get()?.user_id === 7);
  check('перенос: внешние ключи целы', db.db.pragma('foreign_key_check').length === 0);
  check('перенос: внешние ключи снова включены', db.db.pragma('foreign_keys', { simple: true }) === 1);
  check('перенос: старый вход через Telegram находит того же игрока',
    db.getOrCreateUser({ id: 700, username: 'old_one', first_name: 'Старый' }).id === 7);
  check('перенос: партнёр по Telegram ID узнаётся', db.getPartnerForUser(db.getUserById(8))?.name === 'Старый партнёр');
}

/* ---------- 2. Ввод ---------- */

check('почта: приводится к нижнему регистру', auth.normalizeEmail('  Ivan@Mail.RU ') === 'ivan@mail.ru');
check('почта: без домена отклоняется', throwsCode(() => auth.normalizeEmail('ivan@'), 'BAD'));
check('почта: пробел внутри отклоняется', throwsCode(() => auth.normalizeEmail('iv an@mail.ru'), 'BAD'));
check('пароль: короткий отклоняется', throwsCode(() => auth.checkPassword('1234567'), 'BAD'));
check('пароль: восемь символов проходят', auth.checkPassword('12345678') === '12345678');
check('ник: один символ отклоняется', throwsCode(() => auth.normalizeNick('a'), 'BAD'));
check('ник: разметка отклоняется', throwsCode(() => auth.normalizeNick('<b>x</b>'), 'BAD'));
check('ник: кириллица и пробелы проходят', auth.normalizeNick('  Иван   Петров ') === 'Иван Петров');

/* ---------- 3. Пароли ---------- */

{
  const hash = await auth.hashPassword('secret123');
  check('хеш: не содержит пароля', !hash.includes('secret123'));
  check('хеш: верный пароль подходит', await auth.verifyPassword('secret123', hash));
  check('хеш: неверный пароль не подходит', !(await auth.verifyPassword('secret124', hash)));
  check('хеш: соль своя у каждого', hash !== await auth.hashPassword('secret123'));
  check('хеш: пустая запись не подходит ни к чему', !(await auth.verifyPassword('secret123', null)));
}

/* ---------- 4. Аккаунты по почте ---------- */

const hash = await auth.hashPassword('secret123');
const ivan = db.createEmailUser({ email: 'ivan@mail.ru', passwordHash: hash, nick: 'Иван' });
check('регистрация: игрок создан без Telegram', ivan.tg_id === null && ivan.email === 'ivan@mail.ru');
check('регистрация: ник лёг в имя', ivan.first_name === 'Иван' && ivan.username === null);
check('регистрация: стартового баланса нет', ivan.balance === 0);
check('регистрация: вторая на ту же почту отклонена',
  throwsCode(() => db.createEmailUser({ email: 'ivan@mail.ru', passwordHash: hash, nick: 'Клон' }), 'EMAIL_TAKEN'));
const petr = db.createEmailUser({ email: 'petr@mail.ru', passwordHash: hash, nick: 'Пётр' });
check('регистрация: два игрока без Telegram уживаются', petr.id !== ivan.id && petr.tg_id === null);
check('регистрация: событие signup записано',
  db.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE user_id = ? AND name = 'signup'").get(ivan.id).n === 1);

/* ---------- 5. Привязки ---------- */

{
  const linked = db.linkTelegram(ivan.id, { id: 555, username: 'ivan_tg' });
  check('привязка: Telegram записан к аккаунту', linked.tg_id === '555' && linked.username === 'ivan_tg');
  check('привязка: вход через этот Telegram ведёт в тот же аккаунт',
    db.getOrCreateUser({ id: 555, username: 'ivan_tg', first_name: 'Иван' }).id === ivan.id);
  check('привязка: чужой Telegram не отнять',
    throwsCode(() => db.linkTelegram(petr.id, { id: 555 }), 'TG_TAKEN'));
  check('привязка: Telegram старого игрока не отнять',
    throwsCode(() => db.linkTelegram(petr.id, { id: 700 }), 'TG_TAKEN'));

  const old = db.setEmailLogin(7, 'old@mail.ru', hash);
  check('почта для пришедшего через Telegram задаётся', old.email === 'old@mail.ru' && old.tg_id === '700');
  check('чужую почту не занять', throwsCode(() => db.setEmailLogin(8, 'ivan@mail.ru', hash), 'EMAIL_TAKEN'));
}

/* ---------- 6. Владельцы и партнёры ---------- */

{
  const keys = ['999', 'Ivan@Mail.ru'.toLowerCase()];
  check('владелец по почте узнаётся', db.isOwnerKeyed(db.getUserById(ivan.id), keys));
  check('владелец по Telegram ID узнаётся', db.isOwnerKeyed({ tg_id: '999', email: null }, keys));
  check('посторонний не владелец', !db.isOwnerKeyed(db.getUserById(petr.id), keys));
  check('игрок без Telegram не совпадает с пустым ключом', !db.isOwnerKeyed({ tg_id: null, email: null }, ['null', '']));

  db.syncStaff(keys);
  check('syncStaff: владелец по почте получил панель', db.staffRow(ivan.id)?.role === 'owner');
  db.syncStaff(['999']);
  check('syncStaff: убрали почту - доступ пропал', !db.staffRow(ivan.id));

  const created = db.adminSavePartner(ivan.id, { userKey: 'petr@mail.ru', share_pct: 25 });
  check('партнёр заводится по почте', created.created);
  check('партнёр по почте узнаётся в своём аккаунте', db.getPartnerForUser(db.getUserById(petr.id))?.share_pct === 25);
  check('партнёр: повтор обновляет, а не дублирует',
    db.adminSavePartner(ivan.id, { userKey: 'petr@mail.ru', share_pct: 40 }).created === false
    && db.getPartnerForUser(db.getUserById(petr.id))?.share_pct === 40);
  check('партнёр: несуществующая почта отклонена',
    throwsCode(() => db.adminSavePartner(ivan.id, { userKey: 'nobody@mail.ru' }), 'BAD'));
  check('панель находит игрока по почте', db.findUserByAnyId('PETR@mail.ru')?.id === petr.id);
}

/* ---------- 7. Сессии ---------- */

function fakeReq(cookie = '', headers = {}) {
  const h = { cookie, 'user-agent': 'test', host: 'luckybox.test', ...headers };
  return { ip: '1.2.3.4', secure: true, get: (k) => h[k.toLowerCase()] };
}
function fakeRes() {
  const cookies = [];
  return { cookies, append: (k, v) => { if (k === 'Set-Cookie') cookies.push(v); } };
}
const tokenFrom = (res) => /lb_session=([^;]*)/.exec(res.cookies.at(-1) || '')?.[1] || '';

{
  const res = fakeRes();
  auth.startSession(fakeReq(), res, ivan.id);
  const setCookie = res.cookies[0] || '';
  check('сессия: cookie httpOnly', /HttpOnly/.test(setCookie));
  check('сессия: cookie SameSite=Lax', /SameSite=Lax/.test(setCookie));
  check('сессия: на https cookie Secure', /Secure/.test(setCookie));
  const token = tokenFrom(res);
  check('сессия: в базе не сам токен',
    !db.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(token)
    && !!db.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?')
      .get(createHash('sha256').update(token).digest('hex')));

  const who = auth.resolveUser(fakeReq(`a=1; lb_session=${token}`));
  check('сессия: по cookie находится игрок', who.ok && who.user.id === ivan.id);
  check('сессия: без cookie - отказ', auth.resolveUser(fakeReq()).ok === false);
  check('сессия: поддельный токен - отказ', auth.resolveUser(fakeReq('lb_session=forged')).ok === false);

  // Просроченная сессия не пускает и удаляется.
  db.db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?').run(ivan.id);
  check('сессия: просроченная не пускает', auth.resolveUser(fakeReq(`lb_session=${token}`)).ok === false);
  check('сессия: просроченная удалена', !db.db.prepare('SELECT 1 FROM sessions WHERE user_id = ?').get(ivan.id));

  // Смена пароля выкидывает остальные устройства, но не текущее.
  const a = fakeRes(); auth.startSession(fakeReq(), a, ivan.id);
  const b = fakeRes(); auth.startSession(fakeReq(), b, ivan.id);
  db.deleteUserSessions(ivan.id, auth.currentSessionHash(fakeReq(`lb_session=${tokenFrom(a)}`)));
  check('пароль сменён: текущее устройство осталось', auth.resolveUser(fakeReq(`lb_session=${tokenFrom(a)}`)).ok);
  check('пароль сменён: другое устройство вышло', !auth.resolveUser(fakeReq(`lb_session=${tokenFrom(b)}`)).ok);

  // Выход стирает сессию и cookie.
  const out = fakeRes();
  auth.endSession(fakeReq(`lb_session=${tokenFrom(a)}`), out);
  check('выход: сессия удалена', !auth.resolveUser(fakeReq(`lb_session=${tokenFrom(a)}`)).ok);
  check('выход: cookie обнулена', /Max-Age=0/.test(out.cookies[0] || ''));

  check('чужая страница отклоняется', !auth.isSameOrigin(fakeReq('', { origin: 'https://evil.test' })));
  check('своя страница проходит', auth.isSameOrigin(fakeReq('', { origin: 'https://luckybox.test' })));
  check('запрос без Origin проходит (не браузер)', auth.isSameOrigin(fakeReq()));
}

/* ---------- 8. DEV_MODE ---------- */

{
  process.env.DEV_MODE = 'true';
  const dev = auth.resolveUser(fakeReq());
  check('DEV_MODE: без сессии - тестовый игрок', dev.ok && dev.user.tg_id === '999000001');
  check('DEV_MODE: X-Dev-Anon выключает подмену', !auth.resolveUser(fakeReq('', { 'x-dev-anon': '1' })).ok);
  delete process.env.DEV_MODE;
  check('без DEV_MODE подмены нет', !auth.resolveUser(fakeReq()).ok);
}

/* ---------- 9. Виджет Telegram Login ---------- */

{
  const TOKEN = '123:abc';
  const sign = (data) => {
    const line = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
    const secret = createHash('sha256').update(TOKEN).digest();
    return { ...data, hash: createHmac('sha256', secret).update(line).digest('hex') };
  };
  const now = Math.floor(Date.now() / 1000);
  const good = sign({ id: 4242, first_name: 'Анна', username: 'anna', auth_date: now });
  const ok = auth.verifyTelegramLogin(good, TOKEN);
  check('Telegram: верная подпись принята', ok.ok && ok.user.id === 4242 && ok.user.username === 'anna');
  check('Telegram: подмена id ломает подпись', !auth.verifyTelegramLogin({ ...good, id: 1 }, TOKEN).ok);
  check('Telegram: чужой токен не подходит', !auth.verifyTelegramLogin(good, '999:zzz').ok);
  check('Telegram: старая подпись отклонена',
    !auth.verifyTelegramLogin(sign({ id: 4242, auth_date: now - 3 * 24 * 3600 }), TOKEN).ok);
  check('Telegram: без токена бота вход выключен', !auth.verifyTelegramLogin(good, '').ok);

  // Подпись initData мини-приложения устроена иначе: её здесь принимать нельзя.
  const line = `auth_date=${now}\nid=4242`;
  const webAppSecret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const webAppHash = createHmac('sha256', webAppSecret).update(line).digest('hex');
  check('Telegram: подпись мини-приложения не принимается',
    !auth.verifyTelegramLogin({ id: 4242, auth_date: now, hash: webAppHash }, TOKEN).ok);
}

/* ---------- 10. Сброс пароля ---------- */

{
  const { token, tokenHash } = auth.newResetToken();
  db.createPasswordReset(petr.id, tokenHash, auth.RESET_TTL_MS);
  const s1 = fakeRes(); auth.startSession(fakeReq(), s1, petr.id);
  const newHash = await auth.hashPassword('another123');
  const user = db.usePasswordReset(auth.resetTokenHash(token), newHash);
  check('сброс: пароль сменён', user.id === petr.id && await auth.verifyPassword('another123', db.getUserById(petr.id).password_hash));
  check('сброс: все сессии игрока закрыты', !auth.resolveUser(fakeReq(`lb_session=${tokenFrom(s1)}`)).ok);
  check('сброс: ссылка одноразовая',
    throwsCode(() => db.usePasswordReset(auth.resetTokenHash(token), newHash), 'RESET_INVALID'));

  const late = auth.newResetToken();
  db.createPasswordReset(petr.id, late.tokenHash, -1);
  check('сброс: просроченная ссылка отклонена',
    throwsCode(() => db.usePasswordReset(late.tokenHash, newHash), 'RESET_INVALID'));

  const first = auth.newResetToken();
  db.createPasswordReset(ivan.id, first.tokenHash, auth.RESET_TTL_MS);
  db.createPasswordReset(ivan.id, auth.newResetToken().tokenHash, auth.RESET_TTL_MS);
  check('сброс: новая ссылка отменяет прежнюю',
    throwsCode(() => db.usePasswordReset(first.tokenHash, newHash), 'RESET_INVALID'));
}

/* ---------- 11. Напоминания бота ---------- */

{
  // Бот пишет по tg_id: игрок без Telegram не должен попасть в рассылку.
  const rows = db.freeCaseReminders(0, 100);
  check('бот: игрок без Telegram не в рассылке', !rows.some((r) => r.id === petr.id));
  check('бот: привязавший Telegram в рассылке', rows.some((r) => r.id === ivan.id));
}

/* ---------- 12. Письма через Resend ---------- */

{
  // Сеть подменена: настоящих писем тест не шлёт.
  const realFetch = globalThis.fetch;
  const calls = [];
  let replies = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
    const r = replies.shift() || { status: 200, body: { id: 'ok' } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  process.env.RESEND_API_KEY = 're_test';
  delete process.env.MAIL_FROM;
  const mailer = await import('../server/mailer.js');

  check('почта: с ключом Resend включена', mailer.isMailConfigured());
  const sent = await mailer.sendMail({ to: 'a@b.ru', subject: 'Тема', text: 'Текст' });
  const first = calls[0];
  check('почта: ушла в API Resend с ключом', first?.url === 'https://api.resend.com/emails'
    && first.headers.Authorization === 'Bearer re_test' && sent.id === 'ok');
  check('почта: до подтверждения домена отправитель onboarding@resend.dev',
    /onboarding@resend\.dev/.test(first?.body.from));

  calls.length = 0;
  replies = [{ status: 500, body: {} }, { status: 200, body: { id: 'second' } }];
  const retried = await mailer.sendMail({ to: 'a@b.ru', subject: 'Т', text: 'Т' });
  check('почта: сбой Resend повторяется', retried.id === 'second' && calls.length === 2);
  check('почта: повтор с тем же ключом идемпотентности',
    calls[0].headers['Idempotency-Key'] && calls[0].headers['Idempotency-Key'] === calls[1].headers['Idempotency-Key']);

  calls.length = 0;
  replies = [{ status: 403, body: { message: 'domain not verified' } }];
  let refused = null;
  try { await mailer.sendMail({ to: 'a@b.ru', subject: 'Т', text: 'Т' }); } catch (err) { refused = err; }
  check('почта: отказ 403 не повторяется и доходит до вызывающего',
    refused?.status === 403 && calls.length === 1);

  delete process.env.RESEND_API_KEY;
  globalThis.fetch = realFetch;

  // Настоящий транспорт Nodemailer без сети: совместимость обновлений SMTP.
  const oldSmtp = process.env.SMTP_URL;
  process.env.SMTP_URL = 'log';
  const smtpMessage = {to:'quality@example.com', subject:'Проверка сброса', text:'Тестовая ссылка: https://example.com/?reset=test-only'};
  const smtpResult = await mailer.sendMail(smtpMessage);
  const smtpJson = JSON.parse(String(smtpResult.message));
  check('почта: транспорт Nodemailer сохраняет тему и текст',
    smtpJson.subject === smtpMessage.subject && smtpJson.text === smtpMessage.text);
  check('почта: транспорт Nodemailer сохраняет адрес получателя',
    smtpJson.to.some(address => address.address === smtpMessage.to));
  check('почта: логирование тестового письма совместимо с SMTP',
    mailer.lastLoggedMail.to === smtpMessage.to);
  if (oldSmtp === undefined) delete process.env.SMTP_URL;
  else process.env.SMTP_URL = oldSmtp;
}

/* ---------- Итог ---------- */

console.log(`\nВход: пройдено ${passed}, не пройдено ${failures.length}`);
for (const f of failures) console.log('  ✗', f);
db.db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
process.exit(failures.length ? 1 : 0);
