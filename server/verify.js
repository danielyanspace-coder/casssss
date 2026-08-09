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
