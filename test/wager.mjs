/**
 * Проверка правила «вывести можно не больше, чем поставлено».
 *
 * Правило денежное, поэтому проверяется на настоящих функциях базы, а не через
 * HTTP: здесь важна арифметика счётчика, а не то, каким кодом отвечает ручка.
 *
 * Запуск: node test/wager.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/wager-test.db';
// Поощрение первого пополнения здесь только мешало бы: проверяется арифметика
// зачисления, а не маркетинг. Отключаем явно.
process.env.FIRST_DEPOSIT_PCT = '0';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const {
  db, getOrCreateUser, getUserById, consumeWager, withdrawable,
  createPayout, cancelPayout, resolvePayout, adminAdjustBalance,
} = await import('../server/db.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

const sbp = { method: 'sbp', phone: '79001234567', bank: 'Сбербанк' };
const tryPayout = (id, amount) => {
  try { return { ok: true, res: createPayout(id, amount, sbp) }; }
  catch (err) { return { ok: false, code: err.code, available: err.available }; }
};

/* ---------- Случай из задачи ----------
 *
 * Числа взяты в десять раз крупнее, чем в постановке: минимальная сумма вывода
 * в проекте - тысяча, и на «внёс 1000, поставил 200» заявку не создать вообще.
 * Соотношение то же: внёс, поставил пятую часть, вывести можешь пятую часть.
 */
{
  const u = getOrCreateUser({ id: 'w-a', username: 'a' });
  db.prepare('UPDATE users SET balance = 10000 WHERE id = ?').run(u.id);

  check('внёс десять тысяч, не играл - выводить нечего',
        withdrawable(getUserById(u.id)) === 0,
        String(withdrawable(getUserById(u.id))));

  const early = tryPayout(u.id, 10000);
  check('вывод без ставок отклоняется', !early.ok && early.code === 'WAGER_PROGRESS',
        String(early.code));

  // Поставил две тысячи.
  consumeWager(u.id, 2000);
  check('после ставок на 2000 доступно ровно 2000',
        withdrawable(getUserById(u.id)) === 2000,
        String(withdrawable(getUserById(u.id))));

  const tooMuch = tryPayout(u.id, 3000);
  check('вывести больше отыгранного нельзя', !tooMuch.ok && tooMuch.code === 'WAGER_PROGRESS');
  check('в отказе названо доступное число', tooMuch.available === 2000, String(tooMuch.available));

  const ok = tryPayout(u.id, 2000);
  check('ровно отыгранное вывести можно', ok.ok === true, String(ok.code));
  check('после вывода отыгранное израсходовано',
        withdrawable(getUserById(u.id)) === 0,
        String(withdrawable(getUserById(u.id))));
}

/* ---------- Отыгранное не тратится дважды ---------- */
{
  const u = getOrCreateUser({ id: 'w-b', username: 'b' });
  db.prepare('UPDATE users SET balance = 50000 WHERE id = ?').run(u.id);
  consumeWager(u.id, 10000);

  const first = tryPayout(u.id, 6000);
  check('первая заявка проходит', first.ok);
  check('осталось отыгранного 4000', withdrawable(getUserById(u.id)) === 4000,
        String(withdrawable(getUserById(u.id))));

  const second = tryPayout(u.id, 6000);
  check('вторая заявка на те же десять тысяч отклоняется', !second.ok);
  check('но 4000 вывести всё ещё можно', tryPayout(u.id, 4000).ok);
}

/* ---------- Отмена возвращает и деньги, и отыгранное ---------- */
{
  const u = getOrCreateUser({ id: 'w-c', username: 'c' });
  db.prepare('UPDATE users SET balance = 30000 WHERE id = ?').run(u.id);
  consumeWager(u.id, 30000);

  const made = createPayout(u.id, 15000, sbp);
  check('после заявки доступно меньше на её сумму',
        withdrawable(getUserById(u.id)) === 15000,
        String(withdrawable(getUserById(u.id))));

  cancelPayout(u.id, made.id);
  check('отмена вернула деньги', getUserById(u.id).balance === 30000,
        String(getUserById(u.id).balance));
  check('отмена вернула и отыгранное', withdrawable(getUserById(u.id)) === 30000,
        String(withdrawable(getUserById(u.id))));
}

/* ---------- Отклонение администратором тоже возвращает ---------- */
{
  const u = getOrCreateUser({ id: 'w-d', username: 'd' });
  const admin = getOrCreateUser({ id: 'w-admin', username: 'adm' });
  db.prepare('UPDATE users SET balance = 20000 WHERE id = ?').run(u.id);
  consumeWager(u.id, 20000);

  const made = createPayout(u.id, 8000, sbp);
  resolvePayout(admin.id, made.id, 'rejected', 'не подошло');
  check('отклонение вернуло деньги', getUserById(u.id).balance === 20000,
        String(getUserById(u.id).balance));
  check('отклонение вернуло отыгранное', withdrawable(getUserById(u.id)) === 20000,
        String(withdrawable(getUserById(u.id))));
}

/* ---------- Доступное не больше баланса ---------- */
{
  const u = getOrCreateUser({ id: 'w-e', username: 'e' });
  db.prepare('UPDATE users SET balance = 100 WHERE id = ?').run(u.id);
  consumeWager(u.id, 9999);
  check('много ставок при пустом балансе не создают денег',
        withdrawable(getUserById(u.id)) === 100,
        String(withdrawable(getUserById(u.id))));
}

/* ---------- Начисление администратором тоже надо отыграть ---------- */
{
  const u = getOrCreateUser({ id: 'w-f', username: 'f' });
  const admin = getOrCreateUser({ id: 'w-admin2', username: 'adm2' });
  adminAdjustBalance(admin.id, u.id, 5000, 'подарок');
  check('начисленное администратором сразу не выводится',
        withdrawable(getUserById(u.id)) === 0,
        String(withdrawable(getUserById(u.id))));
}

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

console.log(`\nПройдено проверок: ${passed}`);
if (failures.length) {
  console.log(`\nПРОВАЛЕНО (${failures.length}):`);
  for (const f of failures) console.log('  • ' + f);
  process.exit(1);
}
console.log('Правило отыгрыша работает как задумано.\n');
