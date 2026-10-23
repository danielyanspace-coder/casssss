/**
 * Бесплатный кейс «Начало» и билеты розыгрыша.
 *
 * Правило денежное (подарок с выигрышем на бонусный счёт), поэтому проверяется
 * на настоящих функциях базы:
 * - первый кейс - за пополнение от START_CASE_MIN_DEPOSIT, не раньше;
 * - следующие - за каждые START_CASE_TURNOVER ставок СВОИМИ деньгами;
 *   ставки бонусом счётчик не двигают (иначе подарок выдавал бы подарок);
 * - выигрыш с кейса приходит на бонусный счёт;
 * - билеты: один за тысячу оборота, не больше двадцати.
 *
 * Запуск: node test/start-case.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/start-case-test.db';
process.env.FIRST_DEPOSIT_PCT = '0';
process.env.DEV_MODE = 'false';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const {
  getOrCreateUser, getUserById, consumeWager, adminAdjustBalance, startCaseState,
  playCaseRound, getVouchers,
} = await import('../server/db.js');
const { getCase, pickItem, START_CASE_ID, validateCases } = await import('../server/cases.js');
const { computeRoll } = await import('../server/fair.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

const ready = (id) => getVouchers(id).find((v) => v.case_id === START_CASE_ID)?.count || 0;
const state = (id) => startCaseState(getUserById(id));
const deposit = (id, amount) => adminAdjustBalance(1, id, amount, 'пополнение');

/* ---------- Математика кейса ---------- */
{
  validateCases();
  const c = getCase(START_CASE_ID);
  check('кейс «Начало» есть и он бесплатный', !!c && c.free === true);
  check('кейс «Начало» без фриспинов', !c.items.some((i) => i.perk?.type === 'freespins'));
  const top = Math.max(...c.items.map((i) => i.value));
  check('потолок «Начала» 10 000 ₽', top === 10_000, `${top}`);
  const mostly = c.items.filter((i) => i.value >= 30 && i.value <= 200).reduce((s, i) => s + i.probability, 0);
  check('в большинстве случаев 30-200 ₽', mostly > 0.9, `${(mostly * 100).toFixed(1)}%`);
}

/* ---------- Первый кейс - за пополнение ---------- */
const a = getOrCreateUser({ id: 'sc-a', username: 'a' });
check('без пополнения кейса нет', ready(a.id) === 0 && state(a.id).startCase.needDeposit);

deposit(a.id, 50);
check('пополнение меньше минимума кейс не даёт', ready(a.id) === 0);
deposit(a.id, 50);
check('пополнения набрали минимум - кейс выдан', ready(a.id) === 1, `${ready(a.id)}`);
check('после выдачи кейс ждёт оборота, а не пополнения', !state(a.id).startCase.needDeposit);

deposit(a.id, 5000);
check('повторное пополнение второй кейс не даёт', ready(a.id) === 1, `${ready(a.id)}`);

/* ---------- Дальше - за оборот своими деньгами ---------- */
consumeWager(a.id, { real: 999 });
check('999 ₽ оборота - ещё не кейс', ready(a.id) === 1);
check('шкала показывает 999 из 1000', state(a.id).startCase.progress === 999, JSON.stringify(state(a.id).startCase));
consumeWager(a.id, { real: 1 });
check('тысяча оборота - второй кейс', ready(a.id) === 2, `${ready(a.id)}`);
check('шкала начинается заново', state(a.id).startCase.progress === 0);

consumeWager(a.id, { bonus: 5000 });
check('ставки бонусом шкалу не двигают', ready(a.id) === 2 && state(a.id).startCase.progress === 0);

consumeWager(a.id, { real: 3200 });
check('3 200 ₽ одной ставкой - три кейса и 200 на шкале',
  ready(a.id) === 5 && state(a.id).startCase.progress === 200, `${ready(a.id)} ${state(a.id).startCase.progress}`);

/* ---------- Открытие: выигрыш - бонус ---------- */
{
  const c = getCase(START_CASE_ID);
  const before = getUserById(a.id);
  const resolve = (s, cs, n) => { const roll = computeRoll(s, cs, n); return { item: pickItem(c, roll), roll }; };
  const r = playCaseRound(a.id, c, resolve, resolve);
  const after = getUserById(a.id);
  check('открытие тратит подарок', ready(a.id) === 4);
  check('баланс своими не списан', after.balance >= before.balance && after.balance - before.balance === 0,
    `${before.balance} -> ${after.balance}`);
  check('выигрыш пришёл на бонусный счёт', after.bonus_balance - before.bonus_balance === r.payout,
    `${after.bonus_balance - before.bonus_balance} vs ${r.payout}`);
}

/* ---------- Билеты ---------- */
{
  const b = getOrCreateUser({ id: 'sc-b', username: 'b' });
  check('билетов нет без оборота', state(b.id).raffle.tickets === 0);
  deposit(b.id, 1000);
  consumeWager(b.id, { real: 2500 });
  check('2 500 ₽ - два билета и 500 на шкале', state(b.id).raffle.tickets === 2 && state(b.id).raffle.progress === 500,
    JSON.stringify(state(b.id).raffle));
  consumeWager(b.id, { real: 1_000_000 });
  check('билетов не больше двадцати', state(b.id).raffle.tickets === 20);
}

if (failures.length) {
  console.error(`Кейс «Начало»: не пройдено ${failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Кейс «Начало»: ${passed} проверок пройдено`);
