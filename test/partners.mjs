/**
 * Партнёрская программа (/partners) и сверка с Sicilia.
 *
 * Деньги партнёров считаются запросом из игры рефералов, поэтому проверка
 * идёт на настоящих функциях и настоящей базе. Игра подкладывается строками
 * rounds/casino_tx с нужными датами: перенос минуса и смена доли зависят от
 * суток, и ждать сутки тест не может.
 *
 * Запуск: node test/partners.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/partners-test.db';
process.env.FIRST_DEPOSIT_PCT = '0';
process.env.DEV_MODE = 'false';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const dbm = await import('../server/db.js');
const { db, createEmailUserWithPromo, getUserById, saveSettings, getVouchers, pendingDepositBonus } = dbm;
const P = await import('../server/partners.js');
const F = await import('../server/finance.js');
const { getCase, START_CASE_ID } = await import('../server/cases.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const resolveCase = (id) => { const c = getCase(id); return c && { name: c.name, price: c.price, rtp: c.rtp }; };

const NOW = Date.now();
const today = P.dayOf(NOW);
const at = (day, hour = 12) => P.dayStart(day) + hour * 3600_000;
const ADMIN = 1;
db.prepare(`INSERT INTO users (id, server_seed, server_seed_hash, client_seed, created_at) VALUES (1, 's', 'h', 'c', ?)`).run(NOW);

function round(userId, bet, payout, ts) {
  db.prepare(`INSERT INTO rounds (user_id, game, title, subtitle, bet, payout, multiplier, tier, free, roll, nonce,
                                  server_hash, client_seed, created_at)
              VALUES (?, 'case', 't', 's', ?, ?, 1, 'common', 0, 0.5, 1, 'h', 'c', ?)`).run(userId, bet, payout, ts);
}
function deposit(userId, amount, ts) {
  db.prepare("INSERT INTO deposits (user_id, amount, source, comment, created_at) VALUES (?, ?, 'sicilia', 't', ?)").run(userId, amount, ts);
}

/* ---------- Регистрация партнёра и промокод ---------- */
const { partner: A } = P.registerPartner({ email: 'a@p.ru', passwordHash: 'x', name: 'Команда А', contact: '@a' });
check('партнёр заведён с долей по умолчанию 50%', A.share_pct === 50 && A.status === 'active' && A.joined_via === 'self');
check('регистрация партнёра без имени отклонена',
  throwsCode(() => P.registerPartner({ email: 'n@p.ru', passwordHash: 'x', name: ' ' }), 'BAD'));
check('занятая почта партнёром не регистрируется',
  throwsCode(() => P.registerPartner({ email: 'a@p.ru', passwordHash: 'x', name: 'Дубль' }), 'EMAIL_TAKEN'));

check('код короче 4 символов отклонён', throwsCode(() => P.createPromo(A.id, 'ab'), 'BAD'));
check('код с кириллицей отклонён', throwsCode(() => P.createPromo(A.id, 'КОД1'), 'BAD'));
const promo = P.createPromo(A.id, 'team-a');
check('код партнёра заведён в верхнем регистре', promo.code === 'TEAM-A');
check('занятый код отклонён', throwsCode(() => P.createPromo(A.id, 'TEAM-A'), 'TAKEN'));
const row = db.prepare('SELECT * FROM promocodes WHERE id = ?').get(promo.id);
check('код партнёра: кейс «Начало» и 50% к пополнению',
  row.type === 'partner' && row.case_id === START_CASE_ID && row.pct === 50 && row.new_players_only === 1 && row.partner_id === A.id);

/* ---------- Игрок по коду ---------- */
const { user: r1, promo: got } = createEmailUserWithPromo({ email: 'r1@p.ru', passwordHash: 'x', nick: 'r1', promo: 'team-a', resolveCase });
check('игрок по коду привязан к партнёру', getUserById(r1.id).partner_id === A.id);
check('игрок получил кейс «Начало»', getVouchers(r1.id).find((v) => v.case_id === START_CASE_ID)?.count === 1);
check('игрок ждёт +50% к пополнению', pendingDepositBonus(r1.id)?.pct === 50 && got.type === 'partner');

/* ---------- Доход по дням и перенос минуса ---------- */
// Два дня назад: +800. Вчера: -1000. Сегодня: +1500 (минус 1000 гасится, остаётся 500).
round(r1.id, 1000, 200, at(today - 2));
round(r1.id, 100, 1100, at(today - 1));
round(r1.id, 1500, 0, at(today, 0) + 60_000);
deposit(r1.id, 2600, at(today - 2));
let bal = P.balanceOf(A.id);
check('начислено 50% с дохода после переноса минуса', bal.accrued === 650, `${bal.accrued}`);
check('к выводу только закрытые сутки', bal.accruedClosed === 400 && bal.available === 400 && bal.today === 250,
  JSON.stringify(bal));
check('перенос минуса: формула', JSON.stringify([...P.carryForward([[1, -100], [2, 50], [3, 80], [4, -10], [5, 30]]).base])
  === JSON.stringify([[3, 30], [5, 20]]));

/* ---------- Казино, бонусы и издержки ---------- */
db.prepare(`INSERT INTO casino_tx (user_id, method, amount_kop, balance_kop, round_id, created_at)
            VALUES (?, 'bet', 40000, 0, 'z1', ?)`).run(r1.id, at(today - 2));
db.prepare(`INSERT INTO bonus_events (user_id, kind, amount, created_at) VALUES (?, 'convert', 100, ?)`).run(r1.id, at(today - 2));
bal = P.balanceOf(A.id);
// День -2: 800 + 400 казино - 100 бонус = 1100 -> 550.
check('казино входит в доход, бонус в деньги - вычитается', bal.accruedClosed === 550, `${bal.accruedClosed}`);
saveSettings(ADMIN, { partner_casino_cost_pct: 25 });
bal = P.balanceOf(A.id);
// 400 казино - 25% агрегатору = 300: день -2 = 1000 -> 500.
check('доля агрегатора с казино вычитается до доли партнёра', bal.accruedClosed === 500, `${bal.accruedClosed}`);
saveSettings(ADMIN, { partner_casino_cost_pct: 0 });

/* ---------- Сетка и смена доли ---------- */
const { partner: B } = P.registerPartner({ email: 'b@p.ru', passwordHash: 'x', name: 'Сетка Б' });
P.setShare(ADMIN, B.id, A.id, 10);
const bBal = P.balanceOf(B.id);
// С сегодняшнего дня: 10% от 500 = 50, прошлое не трогается.
check('выгодополучатель сверху получает с сегодняшнего дня', bBal.accrued === 50 && bBal.available === 0, JSON.stringify(bBal));
check('доля А от этого не уменьшилась', P.balanceOf(A.id).accrued === 800, `${P.balanceOf(A.id).accrued}`);
const { partner: C } = P.registerPartner({ email: 'c@p.ru', passwordHash: 'x', name: 'В' });
check('с одного источника нельзя раздать больше 90%', throwsCode(() => P.setShare(ADMIN, C.id, A.id, 31), 'BAD'));
P.setShare(ADMIN, A.id, A.id, 30);
bal = P.balanceOf(A.id);
check('новая доля - с сегодняшнего дня, прошлое по старой', bal.accruedClosed === 550 && bal.today === 150, JSON.stringify(bal));
check('история доли записана', P.shareHistory(A.id).filter((s) => s.beneficiary_id === A.id && s.source_id === A.id).length === 2);
P.setShare(ADMIN, A.id, A.id, 50);

const ov = P.adminOverview();
const rowA = ov.rows.find((r) => r.id === A.id);
check('обзор: партнёр с сеткой', rowA.network.some((n) => n.beneficiaryId === B.id && n.pct === 10));
check('обзор: регистрации и FTD считаются', rowA.total.signups === 1 && rowA.total.ftd === 1 && rowA.total.deposits === 2600);

/* ---------- Кабинет ---------- */
const dash = P.dashboard(A.id, { days: 7 });
check('кабинет: 7 дней в ряду', dash.series.length === 7);
check('кабинет: статистика кода', dash.promos[0].activations === 1 && dash.promos[0].ftd === 1 && dash.promos[0].deposits === 2600);
check('кабинет: в списке игроков нет почты', dash.referrals.length === 1 && !('email' in dash.referrals[0]));
check('кабинет Б видит доход сети', P.dashboard(B.id).network[0]?.sourceId === A.id);

/* ---------- Вывод ---------- */
const TRC = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
check('вывод ниже минимума отклонён', throwsCode(() => P.requestPayout(A.id, { amount: 400, network: 'TRC20', address: TRC }, 100), 'BAD'));
saveSettings(ADMIN, { partner_min_withdraw: 100 });
check('вывод больше доступного отклонён', throwsCode(() => P.requestPayout(A.id, { amount: 551, network: 'TRC20', address: TRC }, 100), 'BAD'));
check('кривой адрес отклонён', throwsCode(() => P.requestPayout(A.id, { amount: 300, network: 'TRC20', address: '0x1' }, 100), 'BAD'));
check('неизвестная сеть отклонена', throwsCode(() => P.requestPayout(A.id, { amount: 300, network: 'BTC', address: TRC }, 100), 'BAD'));
const req = P.requestPayout(A.id, { amount: 300, network: 'trc20', address: TRC }, 95.5);
check('заявка принята с оценкой в USDT', req.usdt === '3.14', req.usdt);
check('вторая заявка до решения первой отклонена', throwsCode(() => P.requestPayout(A.id, { amount: 100, network: 'TRC20', address: TRC }, 100), 'PENDING'));
check('заявка резервирует сумму', P.balanceOf(A.id).available === 250 && P.balanceOf(A.id).pending === 300);
check('отказ без причины не принимается', throwsCode(() => P.resolvePayout(ADMIN, req.id, { action: 'reject' }), 'BAD'));
P.resolvePayout(ADMIN, req.id, { action: 'reject', reason: 'Проверка адреса' });
check('отказ возвращает сумму в доступное', P.balanceOf(A.id).available === 550);
const req2 = P.requestPayout(A.id, { amount: 500, network: 'TRC20', address: TRC }, 100);
P.resolvePayout(ADMIN, req2.id, { action: 'paid', usdt: '5,00', txid: 'abc123' });
const paidRow = db.prepare('SELECT * FROM partner_payouts WHERE id = ?').get(req2.id);
check('выплата отмечена с суммой и хешем', paidRow.status === 'paid' && paidRow.usdt === '5.00' && paidRow.txid === 'abc123');
check('после выплаты доступно остаток', P.balanceOf(A.id).available === 50 && P.balanceOf(A.id).paid === 500);
check('повторное решение отклонено', throwsCode(() => P.resolvePayout(ADMIN, req2.id, { action: 'paid' }), 'RESOLVED'));
check('ручная выплата сверх доступного отклонена', throwsCode(() => P.manualPayout(ADMIN, A.id, 51), 'BAD'));
check('партнёр отменяет свою заявку', (() => {
  saveSettings(ADMIN, { partner_min_withdraw: 50 });
  const r = P.requestPayout(A.id, { amount: 50, network: 'ERC20', address: '0x' + 'a'.repeat(40) }, 100);
  P.cancelPayout(A.id, r.id);
  return P.balanceOf(A.id).available === 50;
})());

/* ---------- Приостановка ---------- */
P.setStatus(ADMIN, A.id, 'blocked');
check('приостановка гасит коды', db.prepare('SELECT is_active FROM promocodes WHERE id = ?').get(promo.id).is_active === 0);
check('приостановленный не заводит коды', throwsCode(() => P.createPromo(A.id, 'NEWCODE'), 'BLOCKED'));
check('приостановленный не выводит', throwsCode(() => P.requestPayout(A.id, { amount: 50, network: 'TRC20', address: TRC }, 100), 'BLOCKED'));
P.setStatus(ADMIN, A.id, 'active');

/* ---------- Вступление существующего игрока ---------- */
const { user: plain } = createEmailUserWithPromo({ email: 'plain@p.ru', passwordHash: 'x', nick: 'plain' });
const joined = P.joinAsPartner(plain.id, { name: 'Игрок-партнёр' });
check('игрок становится партнёром одной кнопкой', joined.user_id === plain.id && P.joinAsPartner(plain.id).id === joined.id);
saveSettings(ADMIN, { partner_signup_open: false });
check('закрытый набор партнёров не пускает', throwsCode(() => P.registerPartner({ email: 'z@p.ru', passwordHash: 'x', name: 'Z' }), 'CLOSED'));
saveSettings(ADMIN, { partner_signup_open: true });

/* ---------- Сверка с Sicilia ---------- */
saveSettings(ADMIN, { sicilia_payin_fee_pct: '7,5', sicilia_payout_fee_pct: 2, sicilia_payout_fee_fixed: 10 });
check('дробная комиссия с запятой сохраняется', dbm.setting('sicilia_payin_fee_pct') === 7.5);
const order = (o) => db.prepare(`INSERT INTO sicilia_orders (kind, user_id, invid, amount_rub, status, credited_rub, fact_sum,
                                   fee_pct, fee_fixed, created_at, updated_at, paid_at, expires_at)
                                 VALUES (@kind, @user, @invid, @amount, @status, @credited, @fact, @pct, @fixed, @t, @t, @paid, @exp)`)
  .run({ user: r1.id, status: 'completed', credited: null, fact: null, pct: null, fixed: null, paid: null, exp: null, ...o });
order({ kind: 'payin', invid: 'lb-1', amount: 1000, credited: 1000, pct: 5, fixed: 0, t: at(today - 1, 10), paid: at(today - 1, 10) });
order({ kind: 'payin', invid: 'lb-2', amount: 1000, credited: 900, fact: '900', pct: 5, fixed: 0, t: at(today, 1), paid: at(today, 1) });
order({ kind: 'payout', invid: 'lbp-1', amount: 500, pct: 2, fixed: 10, t: at(today, 2), paid: at(today, 2) });
order({ kind: 'payin', invid: 'lb-3', amount: 700, status: 'cancelled', t: NOW - 3600_000 });
F.addSettlement(ADMIN, { kind: 'withdraw', amount: 200, txid: 'w1', at: at(today, 3) });
// Отчёты считаются «на конец сегодняшних суток». Иначе тест зависел бы от
// часа запуска: в 01:30 по Москве сделки 02:00 и 03:00 ещё в будущем, и в
// долг не попадают (так он однажды упал в CI).
const END = P.dayStart(today + 1) - 1;
// 1000 - 50 + 900 - 45 - 500 - (10 + 10) - 200 = 1085.
check('долг шлюза: принято минус комиссии, выплаты и переводы нам', F.siciliaOwed(END) === 1085, `${F.siciliaOwed(END)}`);
const L = F.siciliaLedger({ days: 3, now: END });
check('по дням: три строки, новые сверху', L.rows.length === 3 && L.rows[0].label === P.dayLabel(today));
check('по дням: нарастающий итог сходится с долгом', L.closing === 1085 && L.rows[0].balance === 1085 && L.rows[1].balance === 950);
check('по дням: выставлено и подтверждено различаются', L.rows[0].payinOrdered === 1000 && L.rows[0].payin === 900);
const H = F.siciliaLedger({ day: P.dayLabel(today), now: END });
check('по часам: 24 строки и тот же итог', H.rows.length === 24 && H.closing === 1085 && H.opening === 950);
check('по часам: сделка в своём часе', H.rows.find((r) => r.label === '02:00').payoutCount === 1);
const issues = F.siciliaIssues({ now: END });
check('расхождение: шлюз подтвердил меньше выставленного', issues.short.rows.length === 1 && issues.short.sum === 100);
check('отозванный ордер ещё перепроверяется', issues.watching.rows.some((r) => r.invid === 'lb-3'));
check('поправка без объяснения не принимается', throwsCode(() => F.addSettlement(ADMIN, { kind: 'adjust', amount: -50 }), 'BAD'));
const adj = F.addSettlement(ADMIN, { kind: 'adjust', amount: -85, note: 'сверка с выпиской' });
check('поправка в пользу шлюза уменьшает долг', F.siciliaOwed(END) === 1000);
F.voidSettlement(ADMIN, adj.id);
check('погашенная запись не считается', F.siciliaOwed(END) === 1085);
const csv = F.siciliaCsvRows(3, END);
check('выгрузка: сделки и расчёты построчно', csv.rows.length === 4 && csv.rows.some((r) => r[1] === 'lbp-1'));
const cash = F.cashSummary({ days: 3, now: END });
check('касса: пополнения и доход по дням', cash.total.depSicilia === 2600 && cash.rows.length === 3);

for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });
console.log(`Партнёры и сверка: ${passed} проверок прошло`);
if (failures.length) {
  console.error(failures.map((f) => `  ПРОВАЛ: ${f}`).join('\n'));
  process.exit(1);
}
