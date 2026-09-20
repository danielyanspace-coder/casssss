/**
 * Мини-игры: математика.
 *
 * Игр пятьдесят, таблиц у них под сотню. Заметить глазами, что в одной из них
 * отдача уехала на процент, невозможно - поэтому проверяется каждая таблица,
 * а не выборка.
 *
 * Запуск: node test/minigames.mjs
 */

import {
  MINIGAMES, MINI_RTP, FAMILIES, getMinigame, resolveMinigame,
  publicMinigame, validateMinigames,
} from '../server/minigames.js';
import { GAME_ART } from '../server/minigame-art.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; return true; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  return false;
}

/* ---------- 1. Сборка ---------- */

check('сборка не падает', (() => { try { validateMinigames(); return true; } catch { return false; } })());
check('игр ровно пятьдесят', MINIGAMES.length === 50, `${MINIGAMES.length}`);

const ids = MINIGAMES.map((g) => g.id);
check('идентификаторы не повторяются', new Set(ids).size === ids.length);

const hues = MINIGAMES.map((g) => g.hue);
check('оттенки не повторяются', new Set(hues).size === hues.length,
      `${hues.length - new Set(hues).size} повторов`);

const arts = MINIGAMES.map((g) => g.art.path);
check('у каждой игры свой значок', new Set(arts).size === MINIGAMES.length,
      `разных значков ${new Set(arts).size}`);
check('значки заданы для всех игр', ids.every((id) => GAME_ART[id]));

const usedFamilies = new Set(MINIGAMES.map((g) => g.family));
check('задействованы все семейства', usedFamilies.size === FAMILIES.length,
      `${usedFamilies.size} из ${FAMILIES.length}`);
check('семейств шестнадцать', FAMILIES.length === 16, `${FAMILIES.length}`);

/*
 * ГЛАВНАЯ ПРОВЕРКА ЭТОГО ФАЙЛА ПОСЛЕ ПЕРЕДЕЛКИ: механики не повторяются.
 *
 * Первая версия раздела была пятьюдесятью вариантами одного и того же
 * «угадай где»: восемь семейств, и половина игр в одном из них. Отличались
 * они названием и цветом, и заказчик это увидел сразу. Поэтому здесь
 * проверяется не количество игр, а то, что описания движения у семейств
 * разные и что ни одно семейство не раздулось за счёт остальных.
 */
const motions = FAMILIES.map((f) => f.motion);
check('у каждого семейства своё описание движения',
      new Set(motions).size === motions.length);
check('у каждого семейства есть описание движения',
      motions.every((m) => typeof m === 'string' && m.length > 10));

for (const family of FAMILIES) {
  const n = MINIGAMES.filter((g) => g.family === family.id).length;
  check(`${family.id}: хотя бы две игры`, n >= 2, `${n}`);
  check(`${family.id}: не больше четверти раздела`, n <= Math.ceil(MINIGAMES.length / 4),
        `${n} из ${MINIGAMES.length}`);
}

/* ---------- 2. Отдача каждой таблицы ---------- */

let tables = 0;
for (const game of MINIGAMES) {
  for (const option of game.options) {
    tables++;
    const sum = option.lose + option.wins.reduce((s, w) => s + w.probability, 0);
    check(`${game.id}/${option.label}: сумма вероятностей равна единице`,
          Math.abs(sum - 1) < 1e-12, `${sum}`);

    const ev = option.wins.reduce((s, w) => s + w.probability * w.multiplier, 0);
    check(`${game.id}/${option.label}: отдача ровно ${MINI_RTP}`,
          Math.abs(ev - MINI_RTP) < 1e-12, `${ev}`);

    check(`${game.id}/${option.label}: все вероятности в (0,1)`,
          option.wins.every((w) => w.probability > 0 && w.probability < 1));

    check(`${game.id}/${option.label}: множители положительны`,
          option.wins.every((w) => w.multiplier > 0));
  }

  /*
   * Варианты одной игры обязаны иметь одинаковую отдачу. Иначе «осторожный»
   * и «рисковый» перестают быть про разброс и становятся про выгоду, а игрок
   * рано или поздно посчитает и увидит, что один вариант хуже другого.
   */
  if (game.options.length > 1) {
    const evs = game.options.map((o) =>
      o.wins.reduce((s, w) => s + w.probability * w.multiplier, 0));
    check(`${game.id}: у всех вариантов одна отдача`,
          Math.max(...evs) - Math.min(...evs) < 1e-12);
  }
}
check('проверено больше восьмидесяти таблиц', tables >= 80, `${tables}`);

/* ---------- 3. Разброс вариантов действительно разный ---------- */

for (const game of MINIGAMES.filter((g) => g.options.length > 1)) {
  const chances = game.options.map((o) => o.winChance);
  const tops = game.options.map((o) => o.top);
  const differ = new Set(chances).size > 1 || new Set(tops).size > 1;

  /*
   * Варианты либо отличаются разбросом, либо это равноправные стороны -
   * «орёл или решка», «первая или вторая». Второе допустимо только там, где
   * выбор стороны и есть вся игра: в «дорожке» два одинаковых варианта
   * означали бы, что один из них нарисовали зря.
   */
  check(`${game.id}: варианты отличаются или это выбор стороны`,
        differ || ['dice', 'race', 'shot', 'wheel'].includes(game.family),
        `семейство ${game.family}`);
}

/*
 * Цепочки (подъём, накачка, мины, раскопки, выше-ниже): чем дальше идёшь,
 * тем больше платят и тем реже доходишь. Это и есть настоящий выбор, ради
 * которого варианты вообще существуют.
 */
const CHAINS = ['climb', 'pump', 'mines', 'dig', 'hilo'];
for (const game of MINIGAMES.filter((g) => CHAINS.includes(g.family) && g.options.length > 1)) {
  const tops = game.options.map((o) => o.top);
  const chances = game.options.map((o) => o.winChance);
  check(`${game.id}: дальше - дороже`,
        tops.every((t, i) => i === 0 || t > tops[i - 1]), tops.join(' < '));
  check(`${game.id}: дальше - реже`,
        chances.every((c, i) => i === 0 || c < chances[i - 1]),
        chances.map((c) => (c * 100).toFixed(1) + '%').join(' > '));
}

/*
 * Взлёт и предел: вариант это ЦЕЛЬ, и выплата обязана ей равняться. Если
 * потолок варианта разойдётся с подписью, игрок увидит на экране «×5», а
 * заплатят ему по другой цифре.
 */
for (const game of MINIGAMES.filter((g) => ['rise', 'limbo'].includes(g.family))) {
  for (const option of game.options) {
    const shown = Number(option.label.replace(/[^\d.]/g, ''));
    check(`${game.id}/${option.label}: выплата равна подписи варианта`,
          Math.abs(option.top - shown) < 1e-9, `${option.top} против ${shown}`);
    check(`${game.id}/${option.label}: шанс равен отдаче, делённой на цель`,
          Math.abs(option.winChance - MINI_RTP / shown) < 1e-9);
  }
  if (game.family === 'rise') {
    for (const option of game.options) {
      check(`${game.id}/${option.label}: цель на экране совпадает с выплатой`,
            Math.abs(option.view.peak - option.top) < 1e-9);
    }
  }
}

/* ---------- 4. Границы ставки ---------- */

for (const game of MINIGAMES) {
  check(`${game.id}: минимум ставки положителен`, game.minBet > 0);
  check(`${game.id}: максимум больше минимума`, game.maxBet > game.minBet);
}

/* ---------- 5. Розыгрыш ---------- */

check('неизвестная игра не находится', getMinigame('такой-нет') === null);
check('известная игра находится', getMinigame('dice')?.id === 'dice');

{
  const game = getMinigame('coin');
  let threw = false;
  try { resolveMinigame(game, 99, 0.5); } catch { threw = true; }
  check('несуществующий вариант отклоняется', threw);
}

/*
 * Проверка самого решателя: прогоняем ролл по всей шкале и смотрим, что доля
 * каждого исхода совпала с его вероятностью. Это не статистика, а точный
 * обход: ролл берётся сеткой, а не случайно.
 */
for (const game of MINIGAMES) {
  for (let oi = 0; oi < game.options.length; oi++) {
    const option = game.options[oi];
    const STEPS = 200000;
    const hits = new Array(option.wins.length).fill(0);
    let lost = 0;
    for (let i = 0; i < STEPS; i++) {
      const r = (i + 0.5) / STEPS;
      const out = resolveMinigame(game, oi, r);
      if (out.win) hits[out.outcomeIndex]++;
      else lost++;
    }
    const ok = option.wins.every((w, i) =>
      Math.abs(hits[i] / STEPS - w.probability) < 2 / STEPS + 1e-9);
    check(`${game.id}/${option.label}: решатель попадает в заданные шансы`, ok);
    check(`${game.id}/${option.label}: доля проигрышей совпадает`,
          Math.abs(lost / STEPS - option.lose) < 2 / STEPS + 1e-9);
  }
}

/* ---------- 6. Что уезжает клиенту ---------- */

{
  const pub = publicMinigame(MINIGAMES[0]);
  check('клиенту уезжают варианты', Array.isArray(pub.options) && pub.options.length > 0);
  check('клиенту уезжают вероятности',
        pub.options[0].wins.every((w) => typeof w.probability === 'number'));
  check('клиенту уезжает описание картинки', typeof pub.art?.path === 'string');
  check('клиенту не уезжает внутренний шанс проигрыша отдельным полем',
        pub.options[0].lose === undefined);
}

/* ---------- Итог ---------- */

console.log(`Мини-игры: ${passed} проверок пройдено`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.slice(0, 30).forEach((f) => console.error('  • ' + f));
  if (failures.length > 30) console.error(`  ... и ещё ${failures.length - 30}`);
  process.exit(1);
}
