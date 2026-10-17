/**
 * Колесо фортуны: право на прокрут, сутки между прокрутами, цикл из пяти
 * прокрутов и начисление каждого приза.
 *
 * Проверяется на настоящих функциях базы, а не через HTTP: важна арифметика
 * и то, что деньги легли туда, куда обещано, а не код ответа ручки.
 *
 * Запуск: node test/fortune.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/fortune-test.db';
// Приветственный бонус здесь только мешал бы: он тоже висит на пополнении,
// а проверяется колесо.
process.env.FIRST_DEPOSIT_PCT = '0';
process.env.FIRST_DEPOSIT_WAGER = '2';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const {
  db, getOrCreateUser, getUserById, registerDeposit,
  fortuneState, fortuneHistory, playFortuneSpin, getVouchers, getX2Perks,
} = await import('../server/db.js');
const {
  FORTUNE_SEGMENTS, pickSegment, pickAmount, validateFortune,
  SPINS_PER_CYCLE, SPIN_COOLDOWN_MS, MIN_DEPOSIT,
  PERCENT_MIN, PERCENT_MAX, VOUCHER_MIN, VOUCHER_MAX, CASH_PRIZE, GIFT_CASE_MAX_PRICE,
} = await import('../server/fortune.js');
const { CASES } = await import('../server/cases.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

/* ---------- Описание колеса ---------- */

let validateThrew = false;
try { validateFortune(); } catch { validateThrew = true; }
check('описание колеса проходит проверку', !validateThrew);

check('секторов ровно девять', FORTUNE_SEGMENTS.length === 9,
  String(FORTUNE_SEGMENTS.length));
check('сумма весов ровно 100',
  Math.abs(FORTUNE_SEGMENTS.reduce((a, s) => a + s.weight, 0) - 100) < 1e-9);

const byType = (t) => FORTUNE_SEGMENTS.filter((s) => s.type === t).length;
check('четыре сектора с кейсами', byType('case') === 4, String(byType('case')));
check('два сектора с ваучерами', byType('voucher') === 2, String(byType('voucher')));
check('один сектор с удвоителем', byType('x2') === 1);
check('один сектор с процентом', byType('percent') === 1);
check('один сектор с деньгами', byType('cash') === 1);

/* ---------- Частоты по заказу ----------
 *
 * Процент - чаще всего; кейсы часто, но реже процента; ваучеры реже;
 * деньги - самый редкий приз. Это проверяется на весах, а не прогоном:
 * прогон проверял бы генератор случайных чисел, а не наше решение.
 */
const weightOf = (t) => FORTUNE_SEGMENTS.filter((s) => s.type === t)
  .reduce((a, s) => a + s.weight, 0);

check('процент выпадает чаще всего', weightOf('percent') > weightOf('case'),
  `${weightOf('percent')} против ${weightOf('case')}`);
check('кейсы чаще ваучеров', weightOf('case') > weightOf('voucher'));
check('ваучеры чаще денег', weightOf('voucher') > weightOf('cash'));
check('деньги реже всего', weightOf('cash') === Math.min(
  weightOf('percent'), weightOf('case'), weightOf('voucher'), weightOf('x2'), weightOf('cash')));

/* ---------- Выбор сектора по роллу ---------- */

check('ролл 0 даёт первый сектор', pickSegment(0).index === FORTUNE_SEGMENTS[0].index);
check('ролл почти 1 даёт последний сектор',
  pickSegment(0.999999).index === FORTUNE_SEGMENTS[FORTUNE_SEGMENTS.length - 1].index);

// Каждый сектор обязан быть достижим: недостижимый - это нарисованный приз,
// который никогда не выпадет, и такое замечают.
const reachable = new Set();
for (let i = 0; i < 20000; i++) reachable.add(pickSegment(i / 20000).index);
check('каждый сектор достижим', reachable.size === FORTUNE_SEGMENTS.length,
  `достижимо ${reachable.size}`);

check('номинал не выходит за нижнюю границу',
  pickAmount(0, 50, 150, 10) === 50);
check('номинал не выходит за верхнюю границу',
  pickAmount(0.9999, 50, 150, 10) === 150);
check('номинал идёт шагом', pickAmount(0.5, 50, 150, 10) % 10 === 0);

/* ---------- Право на прокрут ---------- */

const a = getOrCreateUser({ id: 'ft-a', username: 'a' });

check('без пополнения прокрутов нет', fortuneState(a.id).spinsLeft === 0);
check('без пополнения крутить нельзя', fortuneState(a.id).canSpin === false);
check('шаг «пополнил» не выполнен', fortuneState(a.id).deposited === false);

let tooSmall = false;
registerDeposit(a.id, MIN_DEPOSIT - 1);
check('пополнение меньше порога прокрутов не даёт', fortuneState(a.id).spinsLeft === 0,
  String(fortuneState(a.id).spinsLeft));

registerDeposit(a.id, MIN_DEPOSIT);
check('пополнение от порога открывает цикл',
  fortuneState(a.id).spinsLeft === SPINS_PER_CYCLE, String(fortuneState(a.id).spinsLeft));
check('шаг «пополнил» выполнен', fortuneState(a.id).deposited === true);
check('крутить можно сразу', fortuneState(a.id).canSpin === true);

// Второе пополнение внутри незакрытого цикла прокруты не копит: обещано
// «раз в сутки», а не «пачкой за один вечер».
registerDeposit(a.id, MIN_DEPOSIT * 4);
check('второе пополнение не копит прокруты',
  fortuneState(a.id).spinsLeft === SPINS_PER_CYCLE, String(fortuneState(a.id).spinsLeft));

/* ---------- Сутки между прокрутами ---------- */

playFortuneSpin(a.id, CASES);
check('прокрут списан', fortuneState(a.id).spinsLeft === SPINS_PER_CYCLE - 1);
check('сразу второй раз крутить нельзя', fortuneState(a.id).canSpin === false);
check('сказано, когда можно', fortuneState(a.id).readyAt > Date.now());

let cooldownCode = '';
try { playFortuneSpin(a.id, CASES); } catch (err) { cooldownCode = err.code; }
check('второй прокрут подряд отклонён', cooldownCode === 'FORTUNE_COOLDOWN', cooldownCode);

/** Отматывает время прошлого прокрута назад, как будто прошли сутки. */
const skipDay = (id) => db.prepare('UPDATE users SET fortune_last_spin = ? WHERE id = ?')
  .run(Date.now() - SPIN_COOLDOWN_MS - 1000, id);

skipDay(a.id);
check('через сутки крутить снова можно', fortuneState(a.id).canSpin === true);

/* ---------- Цикл кончается и требует нового пополнения ---------- */

for (let i = 0; i < SPINS_PER_CYCLE - 1; i++) { playFortuneSpin(a.id, CASES); skipDay(a.id); }
check('цикл израсходован', fortuneState(a.id).spinsLeft === 0,
  String(fortuneState(a.id).spinsLeft));
check('с пустым циклом крутить нельзя', fortuneState(a.id).canSpin === false);

let emptyCode = '';
try { playFortuneSpin(a.id, CASES); } catch (err) { emptyCode = err.code; }
check('прокрут при пустом цикле отклонён', emptyCode === 'FORTUNE_EMPTY', emptyCode);

registerDeposit(a.id, MIN_DEPOSIT);
check('новое пополнение открывает новый цикл',
  fortuneState(a.id).spinsLeft === SPINS_PER_CYCLE);
check('циклов посчитано два', getUserById(a.id).fortune_cycles === 2,
  String(getUserById(a.id).fortune_cycles));

check('журнал записал все прокруты', fortuneHistory(a.id, 50).length === SPINS_PER_CYCLE,
  String(fortuneHistory(a.id, 50).length));

/* ---------- Начисление каждого приза ----------
 *
 * Сектор задаётся не случайностью, а подменой ключа: подбираем игроку такой
 * client_seed, при котором первый же ролл попадает в нужный сектор. Так
 * проверяется именно начисление, а не везение.
 */
const { computeRoll } = await import('../server/fair.js');

/** Заводит игрока, у которого следующий прокрут даст сектор нужного типа. */
function playerForPrize(tag, type) {
  const u = getOrCreateUser({ id: 'ft-' + tag, username: tag });
  registerDeposit(u.id, MIN_DEPOSIT);
  const row = getUserById(u.id);

  for (let k = 0; k < 4000; k++) {
    const seed = 'seed' + k;
    const roll = computeRoll(row.server_seed, seed, row.nonce + 1);
    if (pickSegment(roll).type === type) {
      db.prepare('UPDATE users SET client_seed = ? WHERE id = ?').run(seed, u.id);
      return u.id;
    }
  }
  return null;
}

/* Процент к пополнению */
const pid = playerForPrize('pct', 'percent');
check('игрок на процент найден', pid !== null);
if (pid) {
  const { prize } = playFortuneSpin(pid, CASES);
  check('выпал процент', prize.kind === 'percent', prize.kind);
  check('процент в обещанных границах',
    prize.amount >= PERCENT_MIN && prize.amount <= PERCENT_MAX, String(prize.amount));

  const pending = db.prepare('SELECT * FROM pending_deposit_bonus WHERE user_id = ?').get(pid);
  check('процент лёг в слот к пополнению', !!pending);
  check('процент в слоте тот же, что показали', pending?.pct === prize.amount);
  check('процент баланс не трогает', getUserById(pid).balance === 0,
    String(getUserById(pid).balance));

  // Процент обязан примениться при следующем пополнении.
  const before = getUserById(pid).balance;
  registerDeposit(pid, 1000);
  const gained = getUserById(pid).balance - before;
  check('процент применился к пополнению', gained === Math.floor(1000 * prize.amount / 100),
    `${gained} при ${prize.amount}%`);
  check('слот после применения пуст',
    !db.prepare('SELECT 1 FROM pending_deposit_bonus WHERE user_id = ?').get(pid));
}

/* Удвоитель */
const xid = playerForPrize('x2', 'x2');
check('игрок на удвоитель найден', xid !== null);
if (xid) {
  const { prize } = playFortuneSpin(xid, CASES);
  check('выпал удвоитель', prize.kind === 'x2', prize.kind);
  const perks = getX2Perks(xid);
  check('удвоитель лёг в запас', perks.length === 1, JSON.stringify(perks));
  check('удвоитель универсальный', perks[0]?.case_id === '*', perks[0]?.case_id);
}

/* Подарочный кейс */
const cid = playerForPrize('case', 'case');
check('игрок на кейс найден', cid !== null);
if (cid) {
  const { prize } = playFortuneSpin(cid, CASES);
  check('выпал кейс', prize.kind === 'case', prize.kind);
  check('кейс не дороже потолка', prize.amount <= GIFT_CASE_MAX_PRICE, String(prize.amount));
  const v = getVouchers(cid);
  check('ваучер на этот кейс выдан',
    v.length === 1 && v[0].case_id === prize.caseId, JSON.stringify(v));
  check('кейс баланс не трогает', getUserById(cid).balance === 0);
}

/* Ваучер деньгами */
const vid = playerForPrize('vou', 'voucher');
check('игрок на ваучер найден', vid !== null);
if (vid) {
  const before = getUserById(vid);
  const { prize } = playFortuneSpin(vid, CASES);
  check('выпал ваучер', prize.kind === 'voucher', prize.kind);
  check('ваучер в обещанных границах',
    prize.amount >= VOUCHER_MIN && prize.amount <= VOUCHER_MAX, String(prize.amount));
  const after = getUserById(vid);
  check('ваучер зачислен на баланс', after.balance - before.balance === prize.amount,
    String(after.balance - before.balance));
  check('на ваучер повешен отыгрыш',
    after.wager_required - before.wager_required === prize.amount * 2,
    String(after.wager_required - before.wager_required));
}

/* Деньги */
const mid = playerForPrize('cash', 'cash');
check('игрок на деньги найден', mid !== null);
if (mid) {
  const before = getUserById(mid);
  const { prize } = playFortuneSpin(mid, CASES);
  check('выпали деньги', prize.kind === 'cash', prize.kind);
  check('сумма денег ровно обещанная', prize.amount === CASH_PRIZE, String(prize.amount));
  const after = getUserById(mid);
  check('деньги зачислены', after.balance - before.balance === CASH_PRIZE);
  check('на деньги повешен отыгрыш',
    after.wager_required - before.wager_required === CASH_PRIZE * 2);
}

/* ---------- Итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

if (failures.length) {
  console.error(`Колесо фортуны: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Колесо фортуны: ${passed} проверок пройдено`);
