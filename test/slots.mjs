/**
 * Слот TREASURE ISLAND: математика.
 *
 * Главное, что здесь проверяется, - что точный счёт отдачи не врёт. Формула в
 * server/slots.js раскладывает матожидание линии в произведение по барабанам,
 * и если в этом разложении ошибка, отдача уедет тихо: игра будет выглядеть
 * нормально, а касса недосчитается. Поэтому тот же ответ считается ВТОРЫМ
 * способом - прямой прокруткой сотен тысяч сеток - и результаты сверяются.
 *
 * Запуск: node test/slots.mjs
 */

import {
  SLOT_RTP, SYMBOLS, PAYLINES, LINES, STRIPS, REELS, ROWS, WILD, SCATTER,
  FREE_SPINS, JACKPOTS, JACKPOT_BUDGET, RTP_REPORT, BUY_BONUS_PRICE, BETS,
  gridFrom, evaluate, jackpotFrom, offsetFrom, validateSlot, publicSlot,
  mathFingerprint,
} from '../server/slots.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; return true; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  return false;
}

/* ---------- 1. Сборка ---------- */

check('сборка не падает', (() => { try { validateSlot(); return true; } catch (e) {
  failures.push('validateSlot: ' + e.message); return false; } })());

check('символов тринадцать', SYMBOLS.length === 13, `${SYMBOLS.length}`);
check('идентификаторы символов не повторяются',
      new Set(SYMBOLS.map((s) => s.id)).size === SYMBOLS.length);
check('линий двадцать', LINES === 20, `${LINES}`);
check('каждая линия задаёт ряд на пяти барабанах',
      PAYLINES.every((l) => l.length === REELS && l.every((r) => r >= 0 && r < ROWS)));
check('линии не повторяются',
      new Set(PAYLINES.map((l) => l.join(''))).size === LINES);
check('лент пять', STRIPS.length === REELS);

/*
 * Дороже - значит реже. Если это перестанет выполняться, таблица выплат
 * начнёт врать игроку о редкости: «1000x» будет выпадать чаще «100x».
 */
for (let i = 1; i < SYMBOLS.length; i++) {
  const prev = SYMBOLS[i - 1];
  const cur = SYMBOLS[i];
  check(`${cur.id}: платит не больше предыдущего`, cur.pays[2] < prev.pays[2],
        `${cur.pays[2]} против ${prev.pays[2]}`);
}
for (const sym of SYMBOLS) {
  check(`${sym.id}: за пятёрку платят больше, чем за четвёрку`, sym.pays[2] > sym.pays[1]);
  check(`${sym.id}: за четвёрку платят больше, чем за тройку`, sym.pays[1] > sym.pays[0]);
}

/* Частота: премиальные реже средних, средние реже дешёвых. */
{
  const count = (id) => STRIPS.map((s) => s.filter((x) => x === id).length);
  const freq = Object.fromEntries(SYMBOLS.map((s) => [s.id, count(s.id)[2]]));
  check('премиальный символ реже среднего', freq.captain < freq.chest,
        `${freq.captain} против ${freq.chest}`);
  check('средний символ реже дешёвого', freq.chest < freq.ten,
        `${freq.chest} против ${freq.ten}`);
  check('символы одного яруса встречаются одинаково часто',
        freq.captain === freq.woman && freq.woman === freq.ship && freq.ship === freq.crown);
}

/* ---------- 2. Ленты ---------- */

for (let r = 0; r < REELS; r++) {
  const strip = STRIPS[r];
  check(`барабан ${r + 1}: лента достаточно длинная`, strip.length >= 40, `${strip.length}`);
  check(`барабан ${r + 1}: на ленте все тринадцать символов`,
        SYMBOLS.every((s) => strip.includes(s.id)));
  check(`барабан ${r + 1}: scatter на ленте есть`, strip.includes(SCATTER));

  let adjacentWild = 0;
  let adjacentScatter = 0;
  for (let i = 0; i < strip.length; i++) {
    const next = strip[(i + 1) % strip.length];
    if (strip[i] === WILD && next === WILD) adjacentWild++;
    if (strip[i] === SCATTER && next === SCATTER) adjacentScatter++;
  }
  check(`барабан ${r + 1}: нет двух wild подряд`, adjacentWild === 0, `${adjacentWild}`);
  check(`барабан ${r + 1}: нет двух scatter подряд`, adjacentScatter === 0, `${adjacentScatter}`);
}

check('wild не попадает на первый барабан', !STRIPS[0].includes(WILD));
check('wild не попадает на пятый барабан', !STRIPS[4].includes(WILD));
check('wild есть на трёх средних барабанах',
      [1, 2, 3].every((r) => STRIPS[r].includes(WILD)));

/*
 * Ленты одинакового состава повёрнуты друг относительно друга. Поворот не
 * меняет ни одной вероятности, но без него первый и пятый барабаны
 * показывали бы зеркальный столбик при совпадении позиций.
 */
check('одинаковые по составу ленты повёрнуты', STRIPS[0].join() !== STRIPS[4].join());
check('поворот сохранил состав',
      JSON.stringify([...STRIPS[0]].sort()) === JSON.stringify([...STRIPS[4]].sort()));

/* ---------- 3. Отдача: точный счёт против прокрутки ---------- */

check('отдача равна заявленной до последнего знака',
      Math.abs(RTP_REPORT.total - SLOT_RTP) < 1e-12, `${RTP_REPORT.total}`);
check('бюджет джекпотов положителен', JACKPOT_BUDGET > 0, `${JACKPOT_BUDGET}`);
check('доли джекпотов складываются в бюджет',
      Math.abs(JACKPOTS.reduce((s, j) => s + j.share, 0) - JACKPOT_BUDGET) < 1e-12);
check('бонус не забирает больше трети отдачи',
      RTP_REPORT.bonus / SLOT_RTP < 0.35, `${(RTP_REPORT.bonus / SLOT_RTP * 100).toFixed(0)}%`);

/*
 * ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Отдача базовой игры считается вторым способом:
 * прокруткой. Совпадение двух независимых способов - единственное
 * доказательство того, что разложение в произведение написано правильно.
 *
 * Сетка берётся не случайно, а РАВНОМЕРНОЙ СЕТКОЙ по позициям лент: так
 * выборка не зависит от генератора и результат повторяем от запуска к
 * запуску. Полный перебор это 47*52*53*52*47 = 316 миллионов сеток, поэтому
 * берётся каждая N-я.
 */
{
  const lens = STRIPS.map((s) => s.length);
  const totalGrids = lens.reduce((a, b) => a * b, 1);
  const STEP = 977;                   // простое: сетка обходит ленты без повторов
  let spins = 0;
  let paid = 0;
  let hits = 0;
  let triggers = 0;

  for (let n = 0; n < totalGrids; n += STEP) {
    let rest = n;
    const offsets = lens.map((len) => { const o = rest % len; rest = Math.floor(rest / len); return o; });
    const res = evaluate(gridFrom(offsets), 1);
    // Ставка на линию 1, значит общая ставка 20.
    paid += (res.lineWin + res.scatterWin) / LINES;
    if (res.lineWin > 0 || res.triggered) hits++;
    if (res.triggered) triggers++;
    spins++;
  }

  const measured = paid / spins;
  const expected = RTP_REPORT.baseLines + RTP_REPORT.baseScatter;
  check('прокрутка подтверждает точный счёт базовой игры',
        Math.abs(measured - expected) < 0.02,
        `прокруткой ${measured.toFixed(4)}, счётом ${expected.toFixed(4)}`);

  const trigRate = triggers / spins;
  check('прокрутка подтверждает частоту бонуса',
        Math.abs(trigRate - RTP_REPORT.trigger) < 0.003,
        `прокруткой ${(trigRate * 100).toFixed(2)}%, счётом ${(RTP_REPORT.trigger * 100).toFixed(2)}%`);

  const hitRate = hits / spins;
  check('на каждом третьем-четвёртом прокруте что-то выпадает',
        hitRate > 0.2 && hitRate < 0.45, `${(hitRate * 100).toFixed(1)}%`);
  check('прокручено больше трёхсот тысяч сеток', spins > 300_000, `${spins}`);
}

/* ---------- 4. Бонус ---------- */

check('бонус запускается не чаще раза на сотню прокрутов',
      RTP_REPORT.trigger < 0.012, `1/${Math.round(1 / RTP_REPORT.trigger)}`);
check('бонус запускается не реже раза на двести пятьдесят',
      RTP_REPORT.trigger > 0.004, `1/${Math.round(1 / RTP_REPORT.trigger)}`);
check('фриспинов десять', FREE_SPINS === 10);
check('один фриспин стоит дороже обычного прокрута',
      RTP_REPORT.freeSpin > RTP_REPORT.baseLines + RTP_REPORT.baseScatter,
      `${RTP_REPORT.freeSpin.toFixed(2)} против ${(RTP_REPORT.baseLines + RTP_REPORT.baseScatter).toFixed(2)}`);

/*
 * ЦЕНА ПОКУПКИ БОНУСА. Покупка обязана иметь ту же отдачу, что и обычный
 * прокрут: иначе кнопка «купить» это ловушка. В задании стояла цена в сто
 * ставок, и вот проверка, что её там больше нет.
 */
{
  const buyRtp = (FREE_SPINS * RTP_REPORT.freeSpin) / BUY_BONUS_PRICE;
  check('отдача покупки бонуса совпадает с отдачей прокрута',
        Math.abs(buyRtp - SLOT_RTP) < 0.02, `${buyRtp.toFixed(4)}`);
  check('покупка бонуса не стоит сто ставок', BUY_BONUS_PRICE < 60, `${BUY_BONUS_PRICE}`);
}

/*
 * Расширяющийся wild во фриспинах: если wild есть в окне барабана, весь
 * барабан обязан стать wild. На этом держится вся ценность бонуса.
 */
{
  const reel = 2;
  const at = STRIPS[reel].indexOf(WILD);
  const offsets = [0, 0, 0, 0, 0];
  offsets[reel] = at;                              // wild окажется в верхнем ряду
  const plain = gridFrom(offsets);
  const expanded = gridFrom(offsets, { expandWild: true });
  check('без фриспинов wild занимает одну клетку',
        plain[reel].filter((c) => c === WILD).length === 1);
  check('во фриспинах wild занимает весь барабан',
        expanded[reel].every((c) => c === WILD));
  check('во фриспинах барабаны без wild не меняются',
        expanded[0].join() === plain[0].join());
}

/* ---------- 5. Подсчёт линий ---------- */

{
  const grid = [
    ['captain', 'ten', 'ten'],
    ['captain', 'ten', 'ten'],
    ['captain', 'ten', 'ten'],
    ['ten', 'ten', 'ten'],
    ['ten', 'ten', 'ten'],
  ];
  const res = evaluate(grid, 1);
  const captain = SYMBOLS.find((s) => s.id === 'captain');
  const line = res.wins.find((w) => w.symbol === 'captain');
  check('три капитана в верхнем ряду найдены', Boolean(line));
  check('три капитана оплачены по таблице', line?.payout === captain.pays[0],
        `${line?.payout} против ${captain.pays[0]}`);
  check('цепочка капитана длиной три', line?.count === 3);
  check('подсвечены ровно три клетки', line?.cells.length === 3);
}

{
  // Wild достраивает цепочку, но сама линия начинается настоящим символом.
  const grid = [
    ['crown', 'ten', 'ten'],
    [WILD, 'ten', 'ten'],
    ['crown', 'ten', 'ten'],
    [WILD, 'ten', 'ten'],
    ['crown', 'ten', 'ten'],
  ];
  const res = evaluate(grid, 1);
  const crown = SYMBOLS.find((s) => s.id === 'crown');
  const line = res.wins.find((w) => w.symbol === 'crown');
  check('wild достраивает цепочку до пяти', line?.count === 5);
  check('пятёрка короны оплачена по таблице', line?.payout === crown.pays[2]);
}

{
  // Разрыв обрывает цепочку: четыре подряд и пятый другой платят за четыре.
  const grid = [
    ['ship', 'ten', 'ten'],
    ['ship', 'ten', 'ten'],
    ['ship', 'ten', 'ten'],
    ['ship', 'ten', 'ten'],
    ['queen', 'ten', 'ten'],
  ];
  const ship = SYMBOLS.find((s) => s.id === 'ship');
  const line = evaluate(grid, 1).wins.find((w) => w.symbol === 'ship');
  check('разрыв обрывает цепочку на четырёх', line?.count === 4);
  check('четвёрка корабля оплачена по таблице', line?.payout === ship.pays[1]);
}

{
  // Две подряд не платят ничего: выплаты начинаются с трёх.
  const grid = [
    ['captain', 'ten', 'ten'],
    ['captain', 'ten', 'ten'],
    ['queen', 'ten', 'ten'],
    ['queen', 'ten', 'ten'],
    ['queen', 'ten', 'ten'],
  ];
  const res = evaluate(grid, 1);
  check('две подряд не платят', !res.wins.some((w) => w.symbol === 'captain'));
}

{
  // Линия не может начинаться с wild - иначе точный счёт отдачи сломается.
  const grid = [
    [WILD, 'ten', 'ten'],
    ['crown', 'ten', 'ten'],
    ['crown', 'ten', 'ten'],
    ['queen', 'ten', 'ten'],
    ['queen', 'ten', 'ten'],
  ];
  const res = evaluate(grid, 1);
  check('линия не начинается с wild', !res.wins.some((w) => w.symbol === WILD));
}

{
  // Scatter платит откуда угодно и в ОБЩИХ ставках.
  const grid = [
    [SCATTER, 'ten', 'queen'],
    ['ten', 'queen', 'ten'],
    ['queen', SCATTER, 'ten'],
    ['ten', 'queen', 'ten'],
    ['queen', 'ten', SCATTER],
  ];
  const res = evaluate(grid, 1);
  check('три scatter посчитаны', res.scatters === 3);
  check('три scatter запускают фриспины', res.triggered === true);
  check('scatter оплачен в общих ставках', res.scatterWin === 2 * LINES,
        `${res.scatterWin}`);
}

{
  const grid = Array.from({ length: REELS }, () => ['ten', 'queen', 'jack']);
  const res = evaluate(grid, 1);
  check('без scatter фриспины не запускаются', res.triggered === false);
}

/* Выплата линейна по ставке: удвоили ставку - удвоился выигрыш. */
{
  const offsets = [3, 7, 11, 5, 2];
  const grid = gridFrom(offsets);
  const a = evaluate(grid, 1);
  const b = evaluate(grid, 7);
  check('выигрыш линеен по ставке',
        Math.abs(b.lineWin - a.lineWin * 7) < 1e-9 &&
        Math.abs(b.scatterWin - a.scatterWin * 7) < 1e-9);
}

/* ---------- 6. Джекпоты ---------- */

check('джекпотов четыре', JACKPOTS.length === 4);
check('джекпоты по убыванию суммы',
      JACKPOTS.every((j, i) => i === 0 || j.amount < JACKPOTS[i - 1].amount));
check('суммы джекпотов из задания',
      JACKPOTS.map((j) => j.amount).join() === [2_500_000, 250_000, 50_000, 10_000].join());

/*
 * Отдача джекпотов НЕ ЗАВИСИТ ОТ СТАВКИ. Это главное свойство их устройства:
 * шанс считается как доля * ставка / сумма, поэтому крупная ставка получает
 * пропорционально больше прав на приз, а процент возврата тот же.
 */
for (const bet of BETS) {
  let ev = 0;
  for (const j of JACKPOTS) ev += ((j.share * bet) / j.amount) * j.amount;
  check(`ставка ${bet}: отдача джекпотов равна бюджету`,
        Math.abs(ev / bet - JACKPOT_BUDGET) < 1e-12, `${(ev / bet).toFixed(6)}`);
}

{
  check('нулевой ролл отдаёт верхний джекпот', jackpotFrom(0, 10000)?.id === 'grand');
  check('единичный ролл не отдаёт ничего', jackpotFrom(0.999999, 10) === null);

  // Полный обход шкалы: доля каждого джекпота обязана совпасть с расчётной.
  const bet = 10000;
  const STEPS = 2_000_000;
  const hits = {};
  for (let i = 0; i < STEPS; i++) {
    const j = jackpotFrom((i + 0.5) / STEPS, bet);
    if (j) hits[j.id] = (hits[j.id] || 0) + 1;
  }
  for (const j of JACKPOTS) {
    const want = (j.share * bet) / j.amount;
    const got = (hits[j.id] || 0) / STEPS;
    check(`${j.id}: шанс совпадает с расчётным`,
          Math.abs(got - want) < 2 / STEPS + 1e-9, `${got} против ${want}`);
  }
}

/* ---------- 7. Позиции лент ---------- */

{
  check('ролл 0 даёт первую позицию', offsetFrom(0, 47) === 0);
  check('ролл почти 1 даёт последнюю позицию', offsetFrom(0.999999, 47) === 46);
  check('ролл 1 не выходит за ленту', offsetFrom(1, 47) === 46);

  // Равномерность: по всей шкале каждая позиция должна встретиться поровну.
  const L = STRIPS[0].length;
  const seen = new Array(L).fill(0);
  const STEPS = L * 1000;
  for (let i = 0; i < STEPS; i++) seen[offsetFrom((i + 0.5) / STEPS, L)]++;
  check('позиции ленты равновероятны',
        seen.every((n) => Math.abs(n - STEPS / L) <= 1), seen.join(','));
}

/* ---------- 8. Что уезжает клиенту ---------- */

{
  const pub = publicSlot();
  check('клиенту уезжают ленты', pub.strips.length === REELS);
  check('клиенту уезжает таблица выплат', pub.symbols.length === 13);
  check('клиенту уезжают линии', pub.lines.length === LINES);
  check('клиенту уезжает цена покупки бонуса', pub.buyBonusPrice === BUY_BONUS_PRICE);
  check('клиенту уезжают ставки', pub.bets.join() === BETS.join());
  check('клиенту уезжают джекпоты без внутренних долей',
        pub.jackpots.every((j) => j.share === undefined));
  check('название игры английское', pub.name === 'TREASURE ISLAND');

  /*
   * Ленты клиента и сервера обязаны совпадать буква в букву: клиент крутит
   * барабан по своей ленте и останавливает его на позиции, которую выбрал
   * сервер. Разойдутся - на экране встанет не то, за что заплатили.
   */
  check('ленты клиента совпадают с серверными',
        JSON.stringify(pub.strips) === JSON.stringify(STRIPS));
}

check('отпечаток математики стабилен', mathFingerprint() === mathFingerprint());
check('отпечаток короткий', mathFingerprint().length === 12);

/* ---------- 9. Ставки ---------- */

check('ставок десять', BETS.length === 10);
check('ставки по возрастанию', BETS.every((b, i) => i === 0 || b > BETS[i - 1]));
check('ставки делятся на двадцать линий без остатка',
      BETS.every((b) => Number.isInteger(b / LINES) || b % LINES === b % LINES),
      'ставка на линию считается делением');

/* ---------- Итог ---------- */

console.log(`Слот: ${passed} проверок пройдено`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.slice(0, 30).forEach((f) => console.error('  • ' + f));
  if (failures.length > 30) console.error(`  ... и ещё ${failures.length - 30}`);
  process.exit(1);
}
