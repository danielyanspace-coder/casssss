/**
 * Правило вывода: пополнение надо прокрутить через ставки, после чего
 * выводится весь баланс, включая выигрыш.
 *
 * Раньше правило было другим и неверным - вывод упирался в сумму ставок, то
 * есть наказывал ровно за крупный выигрыш. Здесь проверяется, что этого больше
 * нет: отыграл внесённое - забирай всё.
 *
 * Правило денежное, поэтому проверяется на настоящих функциях базы, а не через
 * HTTP: важна арифметика счётчика, а не то, каким кодом отвечает ручка.
 *
 * Запуск: node test/wager.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/wager-test.db';
// Поощрение первого пополнения здесь только мешало бы: проверяется правило
// вывода, а не маркетинг. Отключаем явно.
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
  catch (err) { return { ok: false, code: err.code, left: err.left }; }
};

/** Пополнение настоящими деньгами идёт через ту же дверь, что и шлюзы. */
const deposit = (id, amount) => adminAdjustBalance(1, id, amount, 'пополнение');

const debt = (id) => getUserById(id).deposit_debt;
const free = (id) => withdrawable(getUserById(id));

/* ---------- Случай из постановки ----------
 *
 * Внёс тысячу, отыграл тысячу, выиграл миллион - миллион можно вывести
 * целиком. Числа крупнее, чем в постановке, только потому, что минимальная
 * сумма вывода в проекте тысяча.
 */

const a = getOrCreateUser({ id: 'wg-a', username: 'a' });

deposit(a.id, 10_000);
check('пополнение создаёт долг по обороту', debt(a.id) === 10_000, String(debt(a.id)));
check('до отыгрыша вывод закрыт полностью', free(a.id) === 0, String(free(a.id)));

const early = tryPayout(a.id, 5000);
check('заявка до отыгрыша отклонена', !early.ok && early.code === 'WAGER_PROGRESS', early.code);
check('отказ называет, сколько осталось поставить', early.left === 10_000, String(early.left));

consumeWager(a.id, 4000);
check('ставка гасит долг частично', debt(a.id) === 6000, String(debt(a.id)));
check('частично отыгранный депозит вывод не открывает', free(a.id) === 0, String(free(a.id)));

consumeWager(a.id, 6000);
check('депозит отыгран полностью', debt(a.id) === 0);

// Выигрыш: баланс вырос далеко за пределы внесённого.
db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(1_000_000, a.id);
check('после отыгрыша выводится весь баланс, а не сумма ставок',
  free(a.id) === 1_000_000, String(free(a.id)));

const big = tryPayout(a.id, 1_000_000);
check('заявку на весь выигрыш принимают', big.ok, big.code);
check('баланс списан целиком', getUserById(a.id).balance === 0);

/* ---------- Переигрывать после каждой выплаты не нужно ---------- */

db.prepare('UPDATE users SET balance = 50_000 WHERE id = ?').run(a.id);
check('вывод не восстанавливает долг', debt(a.id) === 0);
check('второй вывод подряд доступен без новых ставок', free(a.id) === 50_000);
check('вторая заявка принимается', tryPayout(a.id, 20_000).ok);

/* ---------- Отмена ---------- */

const cancelled = tryPayout(a.id, 10_000);
const beforeCancel = getUserById(a.id).balance;
cancelPayout(a.id, cancelled.res.id);
check('отмена возвращает деньги', getUserById(a.id).balance === beforeCancel + 10_000);
check('отмена не воскрешает долг', debt(a.id) === 0, String(debt(a.id)));

/* ---------- Отклонение администратором ---------- */

const rejected = tryPayout(a.id, 10_000);
const beforeReject = getUserById(a.id).balance;
resolvePayout(1, rejected.res.id, 'rejected', 'проверка');
check('отклонение возвращает деньги', getUserById(a.id).balance === beforeReject + 10_000);
check('отклонение не воскрешает долг', debt(a.id) === 0);

/* ---------- Новое пополнение - новый долг ---------- */

deposit(a.id, 30_000);
check('следующее пополнение снова закрывает вывод', free(a.id) === 0);
check('долг равен новому пополнению', debt(a.id) === 30_000, String(debt(a.id)));

consumeWager(a.id, 30_000);
check('прокрутил новое пополнение - вывод снова открыт', free(a.id) > 0);

// Переигранное сверх депозита ничего не копит впрок: следующее пополнение
// придётся отыгрывать заново.
consumeWager(a.id, 100_000);
deposit(a.id, 5000);
check('переигранное впрок не засчитывается', debt(a.id) === 5000, String(debt(a.id)));

/* ---------- Бонусный отыгрыш живёт отдельно ---------- */

const b = getOrCreateUser({ id: 'wg-b', username: 'b' });
deposit(b.id, 20_000);
consumeWager(b.id, 20_000);
check('депозит игрока b отыгран', debt(b.id) === 0);

// Долг по бонусу выставляем напрямую: как именно его начисляет промокод,
// проверяется в другом месте, здесь важно, что он закрывает вывод сам по себе.
db.prepare('UPDATE users SET wager_required = 10000 WHERE id = ?').run(b.id);
check('бонус повесил свой отыгрыш', getUserById(b.id).wager_required === 10_000);
const blocked = tryPayout(b.id, 10_000);
check('неотыгранный бонус закрывает вывод отдельно',
  !blocked.ok && blocked.code === 'WAGER', blocked.code);

consumeWager(b.id, 10_000);
check('бонусный долг гасится теми же ставками', getUserById(b.id).wager_required === 0);
check('после бонуса вывод открыт', tryPayout(b.id, 10_000).ok);

/* ---------- Границы ---------- */

const c = getOrCreateUser({ id: 'wg-c', username: 'c' });
deposit(c.id, 50_000);
consumeWager(c.id, 50_000);

const overBalance = tryPayout(c.id, 999_999);
check('больше баланса вывести нельзя',
  !overBalance.ok && overBalance.code === 'INSUFFICIENT_FUNDS', overBalance.code);

const tiny = tryPayout(c.id, 10);
check('минимальная сумма вывода работает', !tiny.ok && tiny.code === 'MIN', tiny.code);

check('оборот копится ставками', getUserById(c.id).wager_progress === 50_000,
  String(getUserById(c.id).wager_progress));

/* ---------- Итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

if (failures.length) {
  console.error(`Отыгрыш: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Отыгрыш: ${passed} проверок пройдено`);
