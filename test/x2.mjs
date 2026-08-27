/**
 * УДВОИТЕЛИ: ВСЕ КОМБИНАЦИИ
 *
 * Удвоитель - единственная плюшка, которая живёт дольше одного прокрута,
 * поэтому у неё больше всего мест, где можно потерять выигрыш игрока. Здесь
 * проверяется каждое: копятся ли они, тратятся ли по одному, не сгорают ли на
 * фриспинах, как ложатся на пачку открытий и не переходят ли на чужой кейс.
 *
 * Розыгрыш подменяется сценарием, а не отдаётся случаю: проверяется логика, а
 * не везение. Работает с базой напрямую, поэтому запускается отдельно от
 * тестов по HTTP.
 *
 * Запуск: node test/x2.mjs
 */
import { getCase } from '../server/cases.js';
import {
  getOrCreateUser, adminAdjustBalance, playCaseRound, playCaseBatch,
  buyFreeSpins, getX2Perks, getUserById,
} from '../server/db.js';

const c = getCase('double_500');
const user = getOrCreateUser({ id: 777001, username: 'x2audit', first_name: 'Аудит' });
adminAdjustBalance(user.id, user.id, 5_000_000, 'аудит');

const cash = c.items.find((i) => i.kind === 'item' && i.value > 0);
const x2Item = c.items.find((i) => i.perk?.type === 'x2');
const fsItem = c.items.find((i) => i.perk?.type === 'freespins');
const zero = c.items.find((i) => i.kind === 'item' && i.value === cash.value);

if (!x2Item || !fsItem) { console.log('в кейсе нет нужных плюшек'); process.exit(1); }

/** Розыгрыш по сценарию: список предметов, которые надо выдать по порядку. */
function scripted(list) {
  let i = 0;
  return () => ({ item: list[Math.min(i++, list.length - 1)], roll: 0.5 });
}

const perks = (id = c.id) => getX2Perks(user.id).find((p) => p.case_id === id)?.count || 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'ПЛОХО'} ${name}: получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`);
};

/*
 * Запас с прошлого прогона надо снять: игрок в базе тот же, а проверки
 * считают удвоители от нуля. Снимаем денежными выигрышами - тем же способом,
 * которым их тратит игра.
 */
while (perks() > 0) playCaseRound(user.id, c, scripted([cash]), scripted([zero]));

/* 1. Два удвоителя подряд копятся, а не затирают друг друга. */
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
check('два удвоителя подряд копятся', perks(), 2);

/* 2. Первый денежный выигрыш тратит ровно один. */
let r = playCaseRound(user.id, c, scripted([cash]), scripted([zero]));
check('денежный выигрыш удвоен', r.payout, cash.value * 2);
check('потрачен один удвоитель', perks(), 1);

/* 3. Второй денежный выигрыш тратит второй. */
r = playCaseRound(user.id, c, scripted([cash]), scripted([zero]));
check('второй выигрыш тоже удвоен', r.payout, cash.value * 2);
check('удвоителей не осталось', perks(), 0);

/* 4. Без удвоителя выплата обычная. */
r = playCaseRound(user.id, c, scripted([cash]), scripted([zero]));
check('без удвоителя выплата обычная', r.payout, cash.value);

/* 5. Удвоитель не сгорает на фриспинах. */
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
const before = perks();
r = playCaseRound(user.id, c, scripted([fsItem]), scripted([zero]));
check('фриспины удвоитель не тратят', perks(), before);
check('серия не удвоена', r.freeSpinsPayout, zero.value * fsItem.perk.count);

/* 6. Удвоитель, выпавший внутри серии, копится и не удваивает прокруты. */
const beforeSeries = perks();
r = playCaseRound(user.id, c, scripted([fsItem]), scripted([x2Item, zero]));
check('удвоитель из серии положен в запас', perks(), beforeSeries + 1);
check('прокрут после удвоителя не удвоен', r.granted.find((g) => g.type === 'freespins').spins[1].value, zero.value);

/* 7. Пачка: удвоителей меньше, чем кейсов. */
// Сбрасываем запас денежными выигрышами.
while (perks() > 0) playCaseRound(user.id, c, scripted([cash]), scripted([zero]));
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
check('перед пачкой два удвоителя', perks(), 2);
const batch = playCaseBatch(user.id, c, 5, scripted([cash, cash, cash, cash, cash]), scripted([zero]));
check('в пачке удвоены ровно два кейса', batch.filter((x) => x.x2Applied).length, 2);
check('удвоены именно первые', batch.map((x) => x.x2Applied), [true, true, false, false, false]);
check('после пачки запас пуст', perks(), 0);

/* 8. Купленная серия удвоитель не тратит, но выпавший в ней кладёт в запас. */
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
const beforeBuy = perks();
const bought = buyFreeSpins(user.id, c, 10, 4700, scripted([x2Item, zero]));
check('купленная серия не тратит удвоитель', perks(), beforeBuy + 1);
check('серия вернула счётчик выигранных', bought.x2Won, 1);
check('прокруты купленной серии не удвоены', bought.spins[1].value, zero.value);

/* 9. Удвоитель одного кейса не работает в другом. */
const other = getCase('warmup_100');
const otherCash = other.items.find((i) => i.kind === 'item' && i.value > 0);
const mine = perks();
r = playCaseRound(user.id, other, scripted([otherCash]), scripted([otherCash]));
check('чужой кейс удвоитель не тратит', perks(), mine);
check('чужой кейс не удвоен', r.payout, otherCash.value);

/* 10. Баланс сходится: списание, выплата, ничего не потеряно. */
const b0 = getUserById(user.id).balance;
playCaseRound(user.id, c, scripted([x2Item]), scripted([zero]));
const afterX2 = getUserById(user.id).balance;
check('выпавший удвоитель денег не приносит', afterX2, b0 - c.price);
r = playCaseRound(user.id, c, scripted([cash]), scripted([zero]));
check('баланс после удвоенного выигрыша', getUserById(user.id).balance,
  afterX2 - c.price + cash.value * 2);

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : '\nВсе комбинации сходятся.');
process.exit(failed ? 1 : 0);
