/**
 * Проверка математики: инварианты + симуляция Монте-Карло.
 *
 * Запуск: npm run verify
 *
 * Смысл симуляции — убедиться, что реальные выпадения сходятся к расчётному
 * RTP. Если теория и практика разошлись, значит ошибка в розыгрыше, а не в
 * таблице вероятностей.
 */

import { CASES, pickItem, validateCases } from './cases.js';
import {
  CRASH_CONFIG,
  ROULETTE_CONFIG,
  ROULETTE_WHEEL,
  crashPointFromRoll,
  rouletteColorOf,
  rouletteSlotFromRoll,
  validateGames,
} from './games.js';
import { computeRoll, generateClientSeed, generateServerSeed, hashSeed } from './fair.js';

const ROUNDS = Number(process.argv[2] || 200_000);

console.log('\n=== Инварианты кейсов ===\n');
const report = validateCases();
console.table(report);

console.log(`\n=== Симуляция: ${ROUNDS.toLocaleString('ru-RU')} открытий на кейс ===\n`);

const serverSeed = generateServerSeed();
const clientSeed = generateClientSeed();
const results = [];
let failures = 0;

for (const c of CASES) {
  let payout = 0;
  const counts = new Map(c.items.map((it) => [it.id, 0]));

  for (let n = 1; n <= ROUNDS; n++) {
    const roll = computeRoll(serverSeed, clientSeed, n);
    const item = pickItem(c, roll);
    payout += item.value;
    counts.set(item.id, counts.get(item.id) + 1);
  }

  const empiricalRtp = payout / (ROUNDS * c.price);
  const drift = Math.abs(empiricalRtp - c.actualRtp);

  // Допуск 1.5% — на таком числе раундов дисперсия редких предметов ещё заметна.
  const ok = drift < 0.015;
  if (!ok) failures++;

  results.push({
    кейс: c.name,
    цена: c.price,
    'RTP теория': c.actualRtp.toFixed(4),
    'RTP факт': empiricalRtp.toFixed(4),
    'отклонение': drift.toFixed(4),
    статус: ok ? 'ок' : 'РАСХОЖДЕНИЕ',
  });
}

console.table(results);

console.log('\n=== Таблица шансов ===\n');
for (const c of CASES) {
  console.log(`${c.name} — ${c.price} ед., RTP ${(c.actualRtp * 100).toFixed(2)}%`);
  console.table(
    c.items.map((it) => ({
      предмет: it.name,
      цена: it.value,
      множитель: `${it.multiplier}x`,
      шанс: `${(it.probability * 100).toFixed(4)}%`,
      'вклад в EV': (it.probability * it.value).toFixed(2),
    }))
  );
}

console.log('\n=== Краш ===\n');
validateGames();

{
  // Проверяем ключевое свойство: RTP не зависит от выбранной цели вывода.
  const targets = [1.2, 1.5, 2, 3, 5, 10, 25, 100];
  const rows = [];
  let crashFail = 0;

  for (const target of targets) {
    let payout = 0;
    let survived = 0;
    for (let n = 1; n <= ROUNDS; n++) {
      const roll = computeRoll(serverSeed, `crash:${target}`, n);
      const point = crashPointFromRoll(roll);
      if (point >= target) {
        payout += target;
        survived++;
      }
    }
    const rtp = payout / ROUNDS;
    const theoryChance = CRASH_CONFIG.rtp / target;

    // Допуск считаем от стандартной ошибки, а не берём фиксированным: выплата
    // равна target с вероятностью p, поэтому дисперсия растёт вместе с целью.
    // При цели 100x редкие попадания дают разброс в разы шире, чем при 1.5x,
    // и единый порог ложно ругался бы на совершенно нормальные прогоны.
    const se = target * Math.sqrt((theoryChance * (1 - theoryChance)) / ROUNDS);
    const ok = Math.abs(rtp - CRASH_CONFIG.rtp) < 4 * se;
    if (!ok) crashFail++;

    rows.push({
      'цель вывода': `${target}x`,
      'шанс дожить (теория)': theoryChance.toFixed(4),
      'шанс дожить (факт)': (survived / ROUNDS).toFixed(4),
      'RTP факт': rtp.toFixed(4),
      'допуск ±4σ': (4 * se).toFixed(4),
      статус: ok ? 'ок' : 'РАСХОЖДЕНИЕ',
    });
  }

  console.log(`Теоретический RTP краша: ${CRASH_CONFIG.rtp.toFixed(4)} при любой цели\n`);
  console.table(rows);
  if (crashFail) failures += crashFail;

  // Мгновенный взрыв на 1.00x.
  //
  // Это НЕ просто edge: точка краша округляется вниз до сотых, поэтому в 1.00
  // схлопывается весь интервал сырых значений [1.00, 1.01). Отсюда
  //   P = P(0.95/(1-u) < 1.01) = 1 - 0.95/1.01 ≈ 5.94%,
  // а не 5%. На RTP это не влияет: для любой цели c, кратной 0.01,
  // floor(raw*100)/100 >= c равносильно raw >= c, то есть шанс дожить
  // остаётся ровно 0.95/c.
  let instant = 0;
  for (let n = 1; n <= ROUNDS; n++) {
    if (crashPointFromRoll(computeRoll(serverSeed, 'crash:instant', n)) <= 1) instant++;
  }
  const instantTheory = 1 - CRASH_CONFIG.rtp / 1.01;
  console.log(
    `Мгновенный взрыв на 1.00x: факт ${(instant / ROUNDS * 100).toFixed(2)}%, ` +
    `теория ${(instantTheory * 100).toFixed(2)}%`
  );
}

console.log('\n=== Рулетка ===\n');

{
  const counts = { red: 0, black: 0, green: 0 };
  for (let n = 1; n <= ROUNDS; n++) {
    const roll = computeRoll(serverSeed, 'roulette', n);
    counts[rouletteColorOf(rouletteSlotFromRoll(roll))]++;
  }

  const rows = ROULETTE_CONFIG.colors.map((c) => {
    const share = counts[c.id] / ROUNDS;
    const rtp = share * c.payout;
    return {
      ставка: c.label,
      выплата: `${c.payout}x`,
      'секторов': `${c.slots}/${ROULETTE_WHEEL.length}`,
      'шанс теория': (c.slots / ROULETTE_WHEEL.length).toFixed(4),
      'шанс факт': share.toFixed(4),
      'RTP факт': rtp.toFixed(4),
      статус: Math.abs(rtp - ROULETTE_CONFIG.rtp) < 0.02 ? 'ок' : 'РАСХОЖДЕНИЕ',
    };
  });

  console.log(`Теоретический RTP рулетки: ${ROULETTE_CONFIG.rtp.toFixed(4)} для любой ставки\n`);
  console.table(rows);

  for (const row of rows) {
    if (row.статус !== 'ок') failures++;
  }
}

console.log('\n=== Проверка provably fair ===\n');
// Воспроизводим ролл независимо и сверяем — так же, как это сделал бы игрок.
const testNonce = 42;
const roll = computeRoll(serverSeed, clientSeed, testNonce);
console.log('serverSeed:      ', serverSeed);
console.log('SHA-256(seed):   ', hashSeed(serverSeed));
console.log('clientSeed:      ', clientSeed);
console.log('nonce:           ', testNonce);
console.log('roll:            ', roll);
console.log('повтор совпадает:', computeRoll(serverSeed, clientSeed, testNonce) === roll);

// Распределение самих роллов должно быть равномерным на [0,1).
let sum = 0;
const buckets = new Array(10).fill(0);
for (let n = 1; n <= 100_000; n++) {
  const r = computeRoll(serverSeed, clientSeed, n);
  sum += r;
  buckets[Math.min(9, Math.floor(r * 10))]++;
}
console.log('\nСреднее по 100 000 роллов:', (sum / 100_000).toFixed(5), '(ожидается ≈0.5)');
console.log('Распределение по децилям (ожидается ≈10000 в каждом):');
console.log(buckets.join('  '));

if (failures > 0) {
  console.error(`\nПРОВАЛЕНО: расхождений — ${failures}\n`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.\n');
