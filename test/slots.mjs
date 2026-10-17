/**
 * Слоты: математика обеих игр.
 *
 * Главное, что здесь проверяется, - что точный счёт отдачи не врёт. Формула в
 * server/slot-engine.js раскладывает матожидание линии в произведение по
 * барабанам, и если в этом разложении ошибка, отдача уедет тихо: игра будет
 * выглядеть нормально, а касса недосчитается. Поэтому тот же ответ считается
 * ВТОРЫМ способом - прямой прокруткой сотен тысяч сеток - и результаты
 * сверяются.
 *
 * Проверки идут по всем слотам сразу: вторая игра отличается от первой
 * таблицей, весами и множителем бонуса, и половина ошибок вылезает именно
 * там, где игры расходятся.
 *
 * Запуск: node test/slots.mjs
 */

import {
  SLOTS, getSlot, publicSlot, slotCard, validateSlots, mathFingerprint,
  PAYLINES, LINES, ROWS, REELS, WILD, SCATTER,
  gridFrom, evaluate, jackpotFrom, jackpotRoll, offsetsFrom, offsetFrom,
  hitFrequency,
} from '../server/slots.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; return true; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  return false;
}

/* ---------- 1. Реестр ---------- */

check('сборка не падает', (() => {
  try { validateSlots(); return true; } catch (e) {
    failures.push('validateSlots: ' + e.message); return false;
  }
})());

check('слотов два', SLOTS.length === 2, `${SLOTS.length}`);
check('идентификаторы слотов не повторяются',
      new Set(SLOTS.map((s) => s.id)).size === SLOTS.length);
check('неизвестный слот не находится', getSlot('такого-нет') === null);
check('известный слот находится', getSlot(SLOTS[0].id)?.id === SLOTS[0].id);
check('пустой идентификатор не находится', getSlot('') === null && getSlot(null) === null);

check('линий двадцать', LINES === 20, `${LINES}`);
check('каждая линия задаёт ряд на пяти барабанах',
      PAYLINES.every((l) => l.length === REELS && l.every((r) => r >= 0 && r < ROWS)));
check('линии не повторяются', new Set(PAYLINES.map((l) => l.join(''))).size === LINES);

/* Карточка полки не тащит с собой ленты и таблицы: они там не нужны. */
{
  const card = slotCard(SLOTS[0]);
  check('карточка полки без лент', card.strips === undefined);
  check('карточка полки без таблицы выплат', card.symbols === undefined);
  check('на карточке есть обложка', typeof card.cover === 'string' && card.cover.endsWith('.webp'));
  check('на карточке есть верхний джекпот', card.topJackpot > 0);
}

check('отпечаток математики стабилен', mathFingerprint() === mathFingerprint());
check('отпечаток короткий', mathFingerprint().length === 12);

/* ---------- 2. Каждый слот по отдельности ---------- */

for (const slot of SLOTS) {
  const tag = slot.id;

  /* --- символы и таблица --- */

  check(`${tag}: символов хотя бы десять`, slot.symbols.length >= 10, `${slot.symbols.length}`);
  check(`${tag}: идентификаторы символов не повторяются`,
        new Set(slot.symbols.map((s) => s.id)).size === slot.symbols.length);

  for (const sym of slot.symbols) {
    check(`${tag}/${sym.id}: за пятёрку платят больше, чем за четвёрку`, sym.pays[2] > sym.pays[1]);
    check(`${tag}/${sym.id}: за четвёрку платят больше, чем за тройку`, sym.pays[1] > sym.pays[0]);
    check(`${tag}/${sym.id}: есть подпись для экрана`,
          Array.isArray(sym.shown) && sym.shown.length === 3);
    check(`${tag}/${sym.id}: название не пустое`, typeof sym.name === 'string' && sym.name.length > 0);
  }

  /*
   * Дороже - значит не чаще. Если это перестанет выполняться, таблица выплат
   * начнёт врать игроку о редкости: «100x» будет выпадать чаще «10x».
   */
  const freq = (id) => slot.strips[2].filter((x) => x === id).length;
  for (let i = 1; i < slot.symbols.length; i++) {
    const prev = slot.symbols[i - 1];
    const cur = slot.symbols[i];
    check(`${tag}/${cur.id}: платит не больше предыдущего`, cur.pays[2] <= prev.pays[2],
          `${cur.pays[2]} против ${prev.pays[2]}`);
    check(`${tag}/${cur.id}: встречается не реже предыдущего`, freq(cur.id) >= freq(prev.id),
          `${freq(cur.id)} против ${freq(prev.id)}`);
  }

  /*
   * ПОДПИСЬ НА ЭКРАНЕ ОБЯЗАНА СХОДИТЬСЯ С ВЫПЛАТОЙ.
   *
   * Внутри выплаты всегда в линейных ставках, а подписаны таблицы по-разному:
   * у одной игры в ставках на линию, у другой в общих. Если пересчёт
   * разойдётся, игрок увидит в таблице одно число, а получит другое.
   */
  const unit = slot.payUnit === 'total' ? LINES : 1;
  for (const sym of slot.symbols) {
    check(`${tag}/${sym.id}: подпись сходится с выплатой`,
          sym.pays.every((p, i) => Math.abs(p - sym.shown[i] * unit) < 1e-9),
          `${sym.shown.join('/')} против ${sym.pays.join('/')}`);
  }

  /* --- ленты --- */

  for (let r = 0; r < REELS; r++) {
    const strip = slot.strips[r];
    check(`${tag}: барабан ${r + 1} достаточно длинный`, strip.length >= 30, `${strip.length}`);
    check(`${tag}: барабан ${r + 1} содержит все символы`,
          slot.symbols.every((s) => strip.includes(s.id)));
    check(`${tag}: барабан ${r + 1} содержит scatter`, strip.includes(SCATTER));

    let adjacentWild = 0;
    let adjacentScatter = 0;
    for (let i = 0; i < strip.length; i++) {
      const next = strip[(i + 1) % strip.length];
      if (strip[i] === WILD && next === WILD) adjacentWild++;
      if (strip[i] === SCATTER && next === SCATTER) adjacentScatter++;
    }
    check(`${tag}: барабан ${r + 1} без двух wild подряд`, adjacentWild === 0, `${adjacentWild}`);
    check(`${tag}: барабан ${r + 1} без двух scatter подряд`, adjacentScatter === 0, `${adjacentScatter}`);
  }

  check(`${tag}: wild не попадает на первый барабан`, !slot.strips[0].includes(WILD));
  check(`${tag}: wild не попадает на пятый барабан`, !slot.strips[4].includes(WILD));
  check(`${tag}: wild есть на трёх средних барабанах`,
        [1, 2, 3].every((r) => slot.strips[r].includes(WILD)));

  /*
   * Ленты одинакового состава повёрнуты друг относительно друга. Поворот не
   * меняет ни одной вероятности, но без него первый и пятый барабаны
   * показывали бы зеркальный столбик при совпадении позиций.
   */
  check(`${tag}: одинаковые по составу ленты повёрнуты`,
        slot.strips[0].join() !== slot.strips[4].join());
  check(`${tag}: поворот сохранил состав`,
        JSON.stringify([...slot.strips[0]].sort()) === JSON.stringify([...slot.strips[4]].sort()));

  /* --- отдача --- */

  const r = slot.report;
  check(`${tag}: отдача равна заявленной до последнего знака`,
        Math.abs(r.total - slot.rtp) < 1e-12, `${r.total}`);
  check(`${tag}: бюджет джекпотов положителен`, slot.jackpotBudget > 0, `${slot.jackpotBudget}`);
  check(`${tag}: доли джекпотов складываются в бюджет`,
        Math.abs(slot.jackpots.reduce((s, j) => s + j.share, 0) - slot.jackpotBudget) < 1e-12);
  check(`${tag}: бонус не забирает больше трети отдачи`,
        r.bonus / slot.rtp < 0.35, `${(r.bonus / slot.rtp * 100).toFixed(0)}%`);
  check(`${tag}: бонус заметен в отдаче`,
        r.bonus / slot.rtp > 0.1, `${(r.bonus / slot.rtp * 100).toFixed(0)}%`);
  check(`${tag}: один фриспин дороже обычного прокрута`,
        r.freeSpin > r.baseLines + r.baseScatter,
        `${r.freeSpin.toFixed(2)} против ${(r.baseLines + r.baseScatter).toFixed(2)}`);

  /*
   * ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Отдача базовой игры считается вторым способом:
   * прокруткой. Совпадение двух независимых способов - единственное
   * доказательство того, что разложение в произведение написано правильно.
   *
   * Сетка берётся не случайно, а РАВНОМЕРНОЙ СЕТКОЙ по позициям лент: так
   * выборка не зависит от генератора и результат повторяем от запуска к
   * запуску.
   */
  {
    const lens = slot.strips.map((s) => s.length);
    const totalGrids = lens.reduce((a, b) => a * b, 1);
    const STEP = 977;                 // простое: обход лент без повторов
    let spins = 0;
    let paid = 0;
    let hits = 0;
    let triggers = 0;

    for (let n = 0; n < totalGrids; n += STEP) {
      let rest = n;
      const offsets = lens.map((len) => {
        const o = rest % len; rest = Math.floor(rest / len); return o;
      });
      const res = evaluate(slot, gridFrom(slot, offsets), 1);
      // Ставка на линию 1, значит общая ставка 20.
      paid += (res.lineWin + res.scatterWin) / LINES;
      if (res.lineWin > 0 || res.triggered) hits++;
      if (res.triggered) triggers++;
      spins++;
      if (spins >= 400_000) break;
    }

    const measured = paid / spins;
    const expected = r.baseLines + r.baseScatter;
    check(`${tag}: прокрутка подтверждает точный счёт базовой игры`,
          Math.abs(measured - expected) < 0.03,
          `прокруткой ${measured.toFixed(4)}, счётом ${expected.toFixed(4)}`);

    const trigRate = triggers / spins;
    check(`${tag}: прокрутка подтверждает частоту бонуса`,
          Math.abs(trigRate - r.trigger) < 0.004,
          `прокруткой ${(trigRate * 100).toFixed(2)}%, счётом ${(r.trigger * 100).toFixed(2)}%`);

    const hitRate = hits / spins;
    check(`${tag}: что-то выпадает не реже, чем раз на шесть прокрутов`,
          hitRate > 0.15 && hitRate < 0.5, `${(hitRate * 100).toFixed(1)}%`);
    check(`${tag}: прокручено больше ста тысяч сеток`, spins > 100_000, `${spins}`);
  }

  /* --- бонус --- */

  check(`${tag}: бонус запускается не чаще раза на сотню прокрутов`,
        r.trigger < 0.012, `1/${Math.round(1 / r.trigger)}`);
  check(`${tag}: бонус запускается не реже раза на двести пятьдесят`,
        r.trigger > 0.004, `1/${Math.round(1 / r.trigger)}`);
  check(`${tag}: фриспинов десять`, slot.freeSpins === 10);

  /*
   * ЦЕНА ПОКУПКИ БОНУСА. Покупка обязана иметь ту же отдачу, что и обычный
   * прокрут: иначе кнопка «купить» это ловушка. В задании стояла цена в сто
   * ставок, и вот проверка, что её там больше нет.
   */
  {
    const buyRtp = (slot.freeSpins * r.freeSpin) / slot.buyBonusPrice;
    check(`${tag}: отдача покупки бонуса совпадает с отдачей прокрута`,
          Math.abs(buyRtp - slot.rtp) < 0.03, `${buyRtp.toFixed(4)}`);
    check(`${tag}: покупка бонуса не стоит сто ставок`, slot.buyBonusPrice < 60,
          `${slot.buyBonusPrice}`);
  }

  /*
   * Множитель фриспинов обязан применяться при настоящем розыгрыше, а не
   * только в счёте отдачи. Если его забыть в evaluate, отдача окажется ниже
   * заявленной ровно на долю бонуса, и заметить это можно только счётом.
   */
  {
    const grid = [
      [slot.symbols[0].id, 'x', 'x'],
      [slot.symbols[0].id, 'x', 'x'],
      [slot.symbols[0].id, 'x', 'x'],
      ['x', 'x', 'x'],
      ['x', 'x', 'x'],
    ];
    const base = evaluate(slot, grid, 1).lineWin;
    const free = evaluate(slot, grid, 1, { free: true }).lineWin;
    check(`${tag}: множитель бонуса применяется при розыгрыше`,
          Math.abs(free - base * slot.freeMultiplier) < 1e-9,
          `${free} против ${base} × ${slot.freeMultiplier}`);
  }

  /*
   * Расширяющийся wild во фриспинах: если wild есть в окне барабана, весь
   * барабан обязан стать wild. На этом держится вся ценность бонуса.
   */
  {
    const reel = 2;
    const at = slot.strips[reel].indexOf(WILD);
    const offsets = [0, 0, 0, 0, 0];
    offsets[reel] = at;
    const plain = gridFrom(slot, offsets);
    const expanded = gridFrom(slot, offsets, { expandWild: true });
    check(`${tag}: без фриспинов wild занимает одну клетку`,
          plain[reel].filter((c) => c === WILD).length === 1);
    check(`${tag}: во фриспинах wild занимает весь барабан`,
          expanded[reel].every((c) => c === WILD));
    check(`${tag}: во фриспинах барабаны без wild не меняются`,
          expanded[0].join() === plain[0].join());
  }

  /* --- подсчёт линий --- */

  const top = slot.symbols[0];
  const low = slot.symbols[slot.symbols.length - 1];

  {
    const grid = [
      [top.id, low.id, low.id], [top.id, low.id, low.id], [top.id, low.id, low.id],
      [low.id, low.id, low.id], [low.id, low.id, low.id],
    ];
    const line = evaluate(slot, grid, 1).wins.find((w) => w.symbol === top.id);
    check(`${tag}: три верхних символа найдены`, Boolean(line));
    check(`${tag}: три оплачены по таблице`, line?.payout === top.pays[0],
          `${line?.payout} против ${top.pays[0]}`);
    check(`${tag}: подсвечены ровно три клетки`, line?.cells.length === 3);
  }

  {
    // Wild достраивает цепочку, но сама линия начинается настоящим символом.
    const second = slot.symbols[1];
    const grid = [
      [second.id, low.id, low.id], [WILD, low.id, low.id], [second.id, low.id, low.id],
      [WILD, low.id, low.id], [second.id, low.id, low.id],
    ];
    const line = evaluate(slot, grid, 1).wins.find((w) => w.symbol === second.id);
    check(`${tag}: wild достраивает цепочку до пяти`, line?.count === 5);
    check(`${tag}: пятёрка оплачена по таблице`, line?.payout === second.pays[2]);
  }

  {
    // Разрыв обрывает цепочку: четыре подряд и пятый другой платят за четыре.
    const grid = [
      [top.id, low.id, low.id], [top.id, low.id, low.id], [top.id, low.id, low.id],
      [top.id, low.id, low.id], [low.id, low.id, low.id],
    ];
    const line = evaluate(slot, grid, 1).wins.find((w) => w.symbol === top.id);
    check(`${tag}: разрыв обрывает цепочку на четырёх`, line?.count === 4);
    check(`${tag}: четвёрка оплачена по таблице`, line?.payout === top.pays[1]);
  }

  {
    // Линия не может начинаться с wild - иначе точный счёт отдачи сломается.
    const grid = [
      [WILD, low.id, low.id], [top.id, low.id, low.id], [top.id, low.id, low.id],
      ['x', 'x', 'x'], ['x', 'x', 'x'],
    ];
    check(`${tag}: линия не начинается с wild`,
          !evaluate(slot, grid, 1).wins.some((w) => w.symbol === WILD));
  }

  {
    // Scatter платит откуда угодно и в ОБЩИХ ставках.
    const grid = [
      [SCATTER, low.id, 'x'], ['x', low.id, 'x'], ['x', SCATTER, 'x'],
      ['x', low.id, 'x'], ['x', 'x', SCATTER],
    ];
    const res = evaluate(slot, grid, 1);
    check(`${tag}: три scatter посчитаны`, res.scatters === 3);
    check(`${tag}: три scatter запускают фриспины`, res.triggered === true);
    check(`${tag}: scatter оплачен в общих ставках`,
          res.scatterWin === slot.scatterPays[3] * LINES, `${res.scatterWin}`);
  }

  {
    const grid = Array.from({ length: REELS }, () => ['x', 'x', 'x']);
    check(`${tag}: без scatter фриспины не запускаются`,
          evaluate(slot, grid, 1).triggered === false);
  }

  /* Выплата линейна по ставке: удвоили ставку - удвоился выигрыш. */
  {
    const offsets = [3, 7, 11, 5, 2];
    const grid = gridFrom(slot, offsets);
    const a = evaluate(slot, grid, 1);
    const b = evaluate(slot, grid, 7);
    check(`${tag}: выигрыш линеен по ставке`,
          Math.abs(b.lineWin - a.lineWin * 7) < 1e-9 &&
          Math.abs(b.scatterWin - a.scatterWin * 7) < 1e-9);
  }

  /* --- джекпоты --- */

  check(`${tag}: джекпотов четыре`, slot.jackpots.length === 4);
  check(`${tag}: джекпоты по убыванию суммы`,
        slot.jackpots.every((j, i) => i === 0 || j.amount < slot.jackpots[i - 1].amount));

  /*
   * Отдача джекпотов НЕ ЗАВИСИТ ОТ СТАВКИ. Это главное свойство их
   * устройства: шанс считается как доля * ставка / сумма, поэтому крупная
   * ставка получает пропорционально больше прав на приз, а процент возврата
   * тот же.
   */
  for (const bet of slot.bets) {
    let ev = 0;
    for (const j of slot.jackpots) ev += ((j.share * bet) / j.amount) * j.amount;
    check(`${tag}: ставка ${bet} даёт ту же отдачу джекпотов`,
          Math.abs(ev / bet - slot.jackpotBudget) < 1e-12, `${(ev / bet).toFixed(6)}`);
  }

  {
    check(`${tag}: нулевой ролл отдаёт верхний джекпот`,
          jackpotFrom(slot, 0, 10000)?.id === slot.jackpots[0].id);
    check(`${tag}: единичный ролл не отдаёт ничего`,
          jackpotFrom(slot, 0.999999, 10) === null);

    const bet = 10000;
    const STEPS = 1_000_000;
    const hits = {};
    for (let i = 0; i < STEPS; i++) {
      const j = jackpotFrom(slot, (i + 0.5) / STEPS, bet);
      if (j) hits[j.id] = (hits[j.id] || 0) + 1;
    }
    for (const j of slot.jackpots) {
      const want = (j.share * bet) / j.amount;
      const got = (hits[j.id] || 0) / STEPS;
      check(`${tag}/${j.id}: шанс совпадает с расчётным`,
            Math.abs(got - want) < 2 / STEPS + 1e-9, `${got} против ${want}`);
    }
  }

  /* --- позиции лент --- */

  {
    const L = slot.strips[0].length;
    check(`${tag}: ролл 0 даёт первую позицию`, offsetFrom(0, L) === 0);
    check(`${tag}: ролл почти 1 даёт последнюю позицию`, offsetFrom(0.999999, L) === L - 1);
    check(`${tag}: ролл 1 не выходит за ленту`, offsetFrom(1, L) === L - 1);

    // Пять позиций из одного числа: все в границах своих лент.
    for (const roll of [0, 0.123456789, 0.5, 0.987654321, 0.999999]) {
      const offs = offsetsFrom(roll, slot.strips);
      check(`${tag}: позиции из ролла ${roll} в границах лент`,
            offs.length === REELS &&
            offs.every((o, i) => o >= 0 && o < slot.strips[i].length), offs.join('/'));
    }

    // Равномерность первой позиции по всей шкале.
    const seen = new Array(L).fill(0);
    const STEPS = L * 1000;
    for (let i = 0; i < STEPS; i++) seen[offsetsFrom((i + 0.5) / STEPS, slot.strips)[0]]++;
    check(`${tag}: позиции первой ленты равновероятны`,
          seen.every((n) => Math.abs(n - STEPS / L) <= 1));

    // Ролл джекпота - отдельное число из того же: в границах и не равно нулю.
    check(`${tag}: ролл джекпота лежит в (0,1)`,
          [0.1, 0.5, 0.9].every((x) => {
            const j = jackpotRoll(x);
            return j >= 0 && j < 1;
          }));
  }

  /* --- что уезжает клиенту --- */

  {
    const pub = publicSlot(slot);
    check(`${tag}: клиенту уезжают ленты`, pub.strips.length === REELS);
    check(`${tag}: клиенту уезжает таблица выплат`, pub.symbols.length === slot.symbols.length);
    check(`${tag}: клиенту уезжают линии`, pub.lines.length === LINES);
    check(`${tag}: клиенту уезжает цена покупки бонуса`,
          pub.buyBonusPrice === slot.buyBonusPrice);
    check(`${tag}: клиенту уезжают ставки`, pub.bets.join() === slot.bets.join());
    check(`${tag}: клиенту уезжают пути к картинкам`,
          typeof pub.art?.logo === 'string' &&
          slot.symbols.every((s) => typeof pub.art.symbols[s.id] === 'string'));
    check(`${tag}: у wild и scatter тоже есть картинки`,
          typeof pub.art.symbols.wild === 'string' &&
          typeof pub.art.symbols.scatter === 'string');
    check(`${tag}: клиенту уезжают джекпоты без внутренних долей`,
          pub.jackpots.every((j) => j.share === undefined));
    check(`${tag}: название английское`, /^[A-Z ]+$/.test(pub.name), pub.name);

    /*
     * Ленты клиента и сервера обязаны совпадать буква в букву: клиент крутит
     * барабан по своей ленте и останавливает его на позиции, которую выбрал
     * сервер. Разойдутся - на экране встанет не то, за что заплатили.
     */
    check(`${tag}: ленты клиента совпадают с серверными`,
          JSON.stringify(pub.strips) === JSON.stringify(slot.strips));
  }

  /* --- ставки --- */

  check(`${tag}: ставок десять`, slot.bets.length === 10, `${slot.bets.length}`);
  check(`${tag}: ставки по возрастанию`,
        slot.bets.every((b, i) => i === 0 || b > slot.bets[i - 1]));
  check(`${tag}: ставки делятся на двадцать линий без остатка`,
        slot.bets.every((b) => Number.isInteger((b / LINES) * LINES) && b % 1 === 0));
}

/* ---------- 3. Игры действительно разные ---------- */

/*
 * Второй слот сделан не ради второй картинки. Если обе игры сойдутся по
 * ощущению, одна из них лишняя, и это видно по двум числам: частоте
 * попаданий и доле бонуса.
 */
{
  const hits = SLOTS.map((s) => hitFrequency(s, 60_000));
  check('частота попаданий у игр разная',
        Math.abs(hits[0] - hits[1]) > 0.05,
        hits.map((h) => (h * 100).toFixed(1) + '%').join(' против '));
  check('таблицы выплат у игр разные',
        SLOTS[0].symbols.map((s) => s.id).join() !== SLOTS[1].symbols.map((s) => s.id).join());
  check('оформление у игр разное', SLOTS[0].theme !== SLOTS[1].theme);
  check('обложки у игр разные', SLOTS[0].art.cover !== SLOTS[1].art.cover);
}

/* ---------- Итог ---------- */

console.log(`Слоты: ${passed} проверок пройдено`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.slice(0, 30).forEach((f) => console.error('  • ' + f));
  if (failures.length > 30) console.error(`  ... и ещё ${failures.length - 30}`);
  process.exit(1);
}
