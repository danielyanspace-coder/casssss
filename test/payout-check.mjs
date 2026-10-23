/**
 * Проверка заявки на вывод и бонусный счёт: деньги на настоящих функциях
 * базы, без HTTP.
 *
 * Главное здесь - что проверка различает честного игрока и подделку:
 * честный получает зелёный итог, а любой из способов «нарисовать» деньги
 * (запрос руками, подправленный раунд, второй аккаунт на те же реквизиты,
 * начисление сотрудником) даёт красный с понятной причиной.
 *
 * Запуск: node test/payout-check.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/payout-check-test.db';
// В DEV_MODE новый игрок получает стартовый миллион, и счёт денег поехал
// бы. CI гоняет тесты с DEV_MODE=true, поэтому выключаем его явно.
process.env.DEV_MODE = 'false';
process.env.PAYOUT_DATA_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
delete process.env.FIRST_DEPOSIT_PCT;
delete process.env.BONUS_WAGER;
delete process.env.FIRST_DEPOSIT_WAGER;
delete process.env.BONUS_CASHOUT_PCT;
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const dbm = await import('../server/db.js');
const {
  db, getOrCreateUser, getUserById, createPayout, consumeWager, playCaseRound, playGamble,
  adminAdjustBalance, settleRound, grantBonus, refuseBonus, recordAccess, bonusRules,
} = dbm;
const sicilia = await import('../server/sicilia.js');
const { checkPayout, payoutCleared, overridePayoutCheck, canonicalEmail } = await import('../server/payout-check.js');
const { getCase, pickItem } = await import('../server/cases.js');
const { computeRoll } = await import('../server/fair.js');
const { GAMBLE_CONFIG, gambleAceFromRoll } = await import('../server/games.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

/* ---------- Помощники ---------- */

let invSeq = 0;
/** Пополнение тем же путём, что настоящее: ордер шлюза и его подтверждение. */
function gatewayDeposit(userId, amount) {
  const now = Date.now();
  const info = db.prepare(`INSERT INTO sicilia_orders (kind, user_id, invid, amount_rub, status, created_at, updated_at)
                           VALUES ('payin', ?, ?, ?, 'created', ?, ?)`)
    .run(userId, `t${++invSeq}-${now}`, amount, now, now);
  return sicilia.applyPayinStatus(info.lastInsertRowid, { status: 'completed', sum: amount });
}

const CASE = getCase('warmup_100') || getCase('dust_25');
const openCase = (userId) => playCaseRound(userId, CASE,
  (s, c, n) => { const roll = computeRoll(s, c, n); return { item: pickItem(CASE, roll), roll }; },
  (s, c, n) => { const roll = computeRoll(s, c, n); return { item: pickItem(CASE, roll), roll }; });

const sbp = (phone = '79001234567') => ({ method: 'sbp', phone, bank: 'Сбербанк' });
const verdictOf = (res) => `${res.verdict}: ${res.reasons.join(', ')}`;
const failed = (res, id) => res.checks.find((c) => c.id === id && !c.ok);

/* ---------- Честный игрок: зелёный ---------- */

const honest = getOrCreateUser({ id: 'pc-honest', username: 'honest' });
recordAccess(honest.id, '10.0.0.1', 'a'.repeat(32), 'test');
gatewayDeposit(honest.id, 4000);
const h1 = getUserById(honest.id);
check('пополнение на свой счёт, бонус 25% на бонусный',
  h1.balance === 4000 && h1.bonus_balance === 1000, JSON.stringify({ b: h1.balance, bb: h1.bonus_balance }));
check('отыгрыш бонуса ×3', h1.wager_required === 3000, String(h1.wager_required));

for (let i = 0; i < 60 && getUserById(honest.id).deposit_debt > 0; i++) openCase(honest.id);
const hb = getUserById(honest.id).balance;
if (hb >= 1000 && getUserById(honest.id).deposit_debt === 0) {
  const p = createPayout(honest.id, 1000, sbp());
  const res = checkPayout(p.id);
  check('честный игрок получает зелёный итог', res.verdict === 'green', verdictOf(res));
  check('зелёная заявка пропускается дальше без подтверждения', payoutCleared(p.id));

  // Неполная выплата шлюзом: заявка закрыта выплаченной суммой, остаток
  // вернулся. Журнал при этом обязан сходиться, иначе все следующие заявки
  // игрока стали бы красными.
  dbm.startPayout(honest.id, p.id, 'тест');
  const before = getUserById(honest.id).balance;
  dbm.completePayoutPartial(honest.id, p.id, 600, 'выплачено частично');
  check('неполная выплата вернула остаток на баланс', getUserById(honest.id).balance === before + 400);
  const again = checkPayout(p.id);
  check('после неполной выплаты журнал сходится', !failed(again, 'sources'), verdictOf(again));
  check('проверка пересчитала раунды', /пересчитано раундов: [1-9]/.test(res.checks.find((c) => c.id === 'fair').detail),
    res.checks.find((c) => c.id === 'fair').detail);
} else {
  check('у честного игрока хватило на вывод', false, `баланс ${hb}, долг ${getUserById(honest.id).deposit_debt}`);
}

/* ---------- Деньги запросом руками: красный ---------- */

const forger = getOrCreateUser({ id: 'pc-forger', username: 'forger' });
gatewayDeposit(forger.id, 2000);
consumeWager(forger.id, 2000);
db.prepare('UPDATE users SET balance = balance + 50000 WHERE id = ?').run(forger.id);
{
  const p = createPayout(forger.id, 50_000, sbp('79005550001'));
  const res = checkPayout(p.id);
  check('баланс, изменённый запросом руками, - красный', res.verdict === 'red', verdictOf(res));
  check('причина: деньги без происхождения', !!failed(res, 'ledger_origin'), verdictOf(res));
  check('красная заявка дальше не идёт без подтверждения', !payoutCleared(p.id));
  let refused = false;
  try { overridePayoutCheck(p.id, honest.id, 'ок'); } catch (e) { refused = e.code === 'COMMENT'; }
  check('подтверждение без внятного комментария не принимается', refused);
  overridePayoutCheck(p.id, honest.id, 'Проверил вручную по выписке банка');
  check('после подтверждения с комментарием заявка проходит', payoutCleared(p.id));
}

/* ---------- Подправленный раунд: красный ---------- */

const cheat = getOrCreateUser({ id: 'pc-cheat', username: 'cheat' });
gatewayDeposit(cheat.id, 3000);
for (let i = 0; i < 40 && getUserById(cheat.id).deposit_debt > 0; i++) openCase(cheat.id);
{
  const last = db.prepare("SELECT * FROM rounds WHERE user_id = ? AND game = 'case' ORDER BY id DESC LIMIT 1").get(cheat.id);
  db.prepare('UPDATE rounds SET payout = payout + 900 WHERE id = ?').run(last.id);
  const amount = Math.max(1000, getUserById(cheat.id).balance - 1);
  if (getUserById(cheat.id).balance >= 1000) {
    // На карту и по СБП выводится сумма, кратная 100 ₽ (PAYOUT_STEP).
    const p = createPayout(cheat.id, Math.floor(Math.min(amount, getUserById(cheat.id).balance) / 100) * 100, sbp('79005550002'));
    const res = checkPayout(p.id);
    check('подправленная выплата раунда - красный', res.verdict === 'red', verdictOf(res));
    check('причина: раунд не пересчитывается', !!failed(res, 'fair'), verdictOf(res));
    check('причина: журнал не сходится с раундом', !!failed(res, 'sources'), verdictOf(res));
  } else {
    check('у подделывающего хватило на заявку', false, String(getUserById(cheat.id).balance));
  }
}

/* ---------- Второй аккаунт на те же реквизиты и браузер: красный ---------- */

const twin = getOrCreateUser({ id: 'pc-twin', username: 'twin' });
recordAccess(twin.id, '10.0.0.9', 'a'.repeat(32), 'test');
gatewayDeposit(twin.id, 2000);
consumeWager(twin.id, 2000);
{
  const p = createPayout(twin.id, 1000, sbp());
  const res = checkPayout(p.id);
  check('те же реквизиты и браузер - красный', res.verdict === 'red' && !!failed(res, 'linked'), verdictOf(res));
  check('в причине названы связанные аккаунты', /honest/.test(failed(res, 'linked')?.detail || ''),
    failed(res, 'linked')?.detail);
}

/* ---------- Начисление сотрудником: красный ---------- */

const gifted = getOrCreateUser({ id: 'pc-gift', username: 'gifted' });
adminAdjustBalance(honest.id, gifted.id, 5000, 'компенсация', { asDeposit: false });
{
  const p = createPayout(gifted.id, 5000, sbp('79005550003'));
  const res = checkPayout(p.id);
  check('деньги от сотрудника - красный', res.verdict === 'red' && !!failed(res, 'staff'), verdictOf(res));
}

/* ---------- Бонусный счёт ---------- */

const b = getOrCreateUser({ id: 'pc-bonus', username: 'bonus' });
gatewayDeposit(b.id, 2000);
check('приветственный бонус на бонусном счёте', getUserById(b.id).bonus_balance === 500);
// Свои деньги тратятся первыми: пока их хватает, бонус не тронут.
openCase(b.id);
check('ставка идёт из своих, пока их хватает', getUserById(b.id).bonus_balance >= 500,
  String(getUserById(b.id).bonus_balance));
// Свои кончились - ставка идёт с бонусного счёта.
db.transaction(() => dbm.withLedger('test_drain', () => {
  db.prepare('UPDATE users SET balance = 0 WHERE id = ?').run(b.id);
}))();
const beforeWager = getUserById(b.id).wager_required;
const bonusBefore = getUserById(b.id).bonus_balance;
check('бонуса хватает на ставку', bonusBefore >= CASE.price, String(bonusBefore));
if (bonusBefore >= CASE.price) {
  openCase(b.id);
  const after = getUserById(b.id);
  check('без своих ставка идёт с бонусного счёта', after.wager_required === beforeWager - CASE.price,
    `${beforeWager} -> ${after.wager_required}`);
  const r = db.prepare("SELECT * FROM rounds WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(b.id);
  check('раунд помнит бонусную часть ставки', r.bonus_bet === CASE.price, String(r.bonus_bet));
  check('выигрыш бонусной ставки остаётся бонусом', r.bonus_payout === r.payout - (JSON.parse(r.meta).granted || 0) || r.payout === 0,
    JSON.stringify({ bp: r.bonus_payout, p: r.payout }));
}
refuseBonus(b.id);
check('отказ от бонуса обнуляет бонусный счёт', getUserById(b.id).bonus_balance === 0
  && getUserById(b.id).wager_required === 0);

/* ---------- Потолок перевода не поднять окружением ---------- */

process.env.BONUS_CASHOUT_PCT = '90';
check('потолок перевода зажат безопасным пределом', bonusRules().cashoutPct <= 28, String(bonusRules().cashoutPct));
delete process.env.BONUS_CASHOUT_PCT;

/* ---------- Дыра риск-игры закрыта ---------- */

const g = getOrCreateUser({ id: 'pc-gamble', username: 'gamble' });
gatewayDeposit(g.id, 3000);
consumeWager(g.id, 3000);
let stakeRound = null;
for (let i = 0; i < 30; i++) {
  openCase(g.id);
  if (getUserById(g.id).gamble_stake > 0) { stakeRound = getUserById(g.id); break; }
}
if (stakeRound) {
  // Выигрыш ушёл в заявку - рисковать им больше нельзя.
  createPayout(g.id, Math.floor(getUserById(g.id).balance / 100) * 100, sbp('79005550004'));
  let code = null;
  try {
    playGamble(g.id, 0, GAMBLE_CONFIG, (s, c, n) => { const roll = computeRoll(s, c, n); return { acePosition: gambleAceFromRoll(roll), roll }; });
  } catch (e) { code = e.code; }
  check('выигрыш, ушедший в заявку, в риск-игре не играет', code === 'NO_STAKE', String(code));
  check('баланс не ушёл в минус', getUserById(g.id).balance >= 0);
} else {
  check('кейс дал ставку для риск-игры', false);
}

/* ---------- Почта-клон ---------- */

check('точки и +метка в Gmail - один ящик',
  canonicalEmail('Ivan.P+promo@GoogleMail.com') === canonicalEmail('ivanp@gmail.com'));
check('у других доменов точки значимы',
  canonicalEmail('ivan.p@mail.ru') !== canonicalEmail('ivanp@mail.ru'));

/* ---------- Журнал пишет триггер базы ---------- */

{
  const u = getOrCreateUser({ id: 'pc-raw', username: 'raw' });
  db.prepare('UPDATE users SET balance = 777 WHERE id = ?').run(u.id);
  const row = db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(u.id);
  check('изменение мимо кода всё равно в журнале', row && row.kind === 'unattributed' && row.real_kop === 77700,
    JSON.stringify(row));
}

/* ---------- Итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

if (failures.length) {
  console.error(`Проверка заявок: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Проверка заявок: ${passed} проверок пройдено`);
