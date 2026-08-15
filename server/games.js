/**
 * Математика краша и рулетки.
 *
 * Обе игры используют тот же provably fair ролл, что и кейсы: число из [0, 1),
 * полученное из HMAC(serverSeed, "clientSeed:nonce"). Разница только в том, как
 * это число превращается в результат.
 */

/* ============================================================
   КРАШ
   ============================================================ */

/** Доля, которую забирает заведение. RTP краша = 1 - EDGE. */
const CRASH_EDGE = 0.3;

/** Потолок множителя — иначе редкий раунд может тянуться минутами. */
const CRASH_MAX = 1000;

/** Скорость роста множителя: m(t) = e^(GROWTH * t), t в секундах. */
const CRASH_GROWTH = 0.22;

export const CRASH_CONFIG = {
  edge: CRASH_EDGE,
  rtp: 1 - CRASH_EDGE,
  maxMultiplier: CRASH_MAX,
  growth: CRASH_GROWTH,
};

/**
 * Точка краша из ролла.
 *
 * Формула: crash = (1 - edge) / (1 - u).
 *
 * Почему RTP получается ровно 1 - edge при ЛЮБОЙ цели вывода c:
 *   P(crash >= c) = P((1-e)/(1-u) >= c) = (1-e)/c
 *   EV = c * P(дожили до c) = c * (1-e)/c = 1-e
 * То есть выбор момента вывода не меняет матожидание — можно играть
 * осторожно или жадно, ожидание одинаковое. Меняется только дисперсия.
 *
 * При u < edge формула даёт меньше единицы — это мгновенный краш на 1.00x.
 */
export function crashPointFromRoll(roll) {
  const raw = (1 - CRASH_EDGE) / (1 - roll);
  const floored = Math.floor(raw * 100) / 100;
  return Math.max(1, Math.min(floored, CRASH_MAX));
}

/** Множитель в момент времени elapsedMs от старта раунда. */
export function crashMultiplierAt(elapsedMs) {
  const t = Math.max(0, elapsedMs) / 1000;
  return Math.exp(CRASH_GROWTH * t);
}

/** Сколько миллисекунд нужно, чтобы множитель дорос до m. */
export function crashTimeToReach(multiplier) {
  if (multiplier <= 1) return 0;
  return (Math.log(multiplier) / CRASH_GROWTH) * 1000;
}

/* ============================================================
   РУЛЕТКА
   ============================================================ */

/**
 * Колесо на 15 секторов: 1 зелёный, 7 красных, 7 чёрных.
 *
 * Выплаты подобраны так, что RTP одинаков для любой ставки:
 *   красное/чёрное: (7/15) * 2  = 14/15 = 93.33%
 *   зелёное:        (1/15) * 14 = 14/15 = 93.33%
 * Поэтому «зелёное» — не ловушка с худшими шансами, а та же игра
 * с другой дисперсией.
 */
export const ROULETTE_WHEEL = [
  'green',
  'red', 'black', 'red', 'black', 'red', 'black', 'red',
  'black', 'red', 'black', 'red', 'black', 'red', 'black',
];

export const ROULETTE_PAYOUTS = { red: 1.5, black: 1.5, green: 10.5 };

export const ROULETTE_COLORS = [
  { id: 'red', label: 'Красное', payout: 1.5, slots: 7 },
  { id: 'green', label: 'Зелёное', payout: 10.5, slots: 1 },
  { id: 'black', label: 'Чёрное', payout: 1.5, slots: 7 },
];

export const ROULETTE_CONFIG = {
  slots: ROULETTE_WHEEL.length,
  payouts: ROULETTE_PAYOUTS,
  colors: ROULETTE_COLORS,
  rtp: (7 / 15) * 1.5,
};

/** Номер выпавшего сектора из ролла. */
export function rouletteSlotFromRoll(roll) {
  const slot = Math.floor(roll * ROULETTE_WHEEL.length);
  // Страховка от roll, равного 1 из-за ошибок округления.
  return Math.min(slot, ROULETTE_WHEEL.length - 1);
}

export function rouletteColorOf(slot) {
  return ROULETTE_WHEEL[slot];
}

/* ============================================================
   ПРОВЕРКА ИНВАРИАНТОВ
   ============================================================ */

export function validateGames() {
  // Рулетка: RTP всех ставок обязан совпадать.
  const rtps = ROULETTE_COLORS.map((c) => (c.slots / ROULETTE_WHEEL.length) * c.payout);
  const first = rtps[0];
  for (const r of rtps) {
    if (Math.abs(r - first) > 1e-9) {
      throw new Error(`Рулетка: RTP ставок разошёлся — ${rtps.join(', ')}`);
    }
  }
  if (first >= 1) {
    throw new Error(`Рулетка: RTP ${first} >= 1, игра убыточна для заведения`);
  }

  const totalSlots = ROULETTE_COLORS.reduce((s, c) => s + c.slots, 0);
  if (totalSlots !== ROULETTE_WHEEL.length) {
    throw new Error(`Рулетка: секторов ${ROULETTE_WHEEL.length}, в описании ${totalSlots}`);
  }

  for (const c of ROULETTE_COLORS) {
    const actual = ROULETTE_WHEEL.filter((x) => x === c.id).length;
    if (actual !== c.slots) {
      throw new Error(`Рулетка: ${c.id} — на колесе ${actual}, в описании ${c.slots}`);
    }
  }

  // Краш: точка краша никогда не выходит за границы.
  for (const u of [0, 0.0001, 0.049, 0.05, 0.5, 0.9, 0.999, 0.99999, 0.9999999]) {
    const p = crashPointFromRoll(u);
    if (p < 1 || p > CRASH_MAX) {
      throw new Error(`Краш: ролл ${u} дал точку ${p} вне [1, ${CRASH_MAX}]`);
    }
  }

  return {
    crashRtp: 1 - CRASH_EDGE,
    rouletteRtp: first,
  };
}

/* ============================================================
   РИСК-ИГРА ПОСЛЕ ПРОКРУТА («найди туза»)
   ============================================================ */

/**
 * Шесть карт, одна из них — красный туз. Игрок ставит свой выигрыш и
 * выбирает карту: угадал — выигрыш умножается, промахнулся — сгорает.
 *
 * ПРО МНОЖИТЕЛЬ. Соблазн поставить x2 велик, но при одном тузе из шести
 * шанс попасть — ровно 1/6, и тогда отдача была бы 2/6 = 33%. Это не
 * «небольшое преимущество заведения», а игра, где игрок теряет две трети
 * ставки на каждом шаге, — и рано или поздно это замечают.
 *
 * Поэтому множитель приведён в соответствие с картинкой: 6 карт, 1 туз,
 * выплата x5. Отдача 5/6 = 83.3%, преимущество заведения 16.7% — заметное,
 * но честное, и то, что видит игрок, совпадает с тем, что считает сервер.
 *
 * Если всё же нужен именно x2, уменьшите количество карт до двух:
 * при 1 тузе из 2 отдача будет 100%, при 1 из 2 с выплатой 1.9 — 95%.
 */
export const GAMBLE_CONFIG = {
  cards: 6,
  aces: 1,
  payout: 4.2,
};

GAMBLE_CONFIG.chance = GAMBLE_CONFIG.aces / GAMBLE_CONFIG.cards;
GAMBLE_CONFIG.rtp = GAMBLE_CONFIG.chance * GAMBLE_CONFIG.payout;

/** Позиция туза из ролла. */
export function gambleAceFromRoll(roll) {
  return Math.min(Math.floor(roll * GAMBLE_CONFIG.cards), GAMBLE_CONFIG.cards - 1);
}

export function validateGamble() {
  const { cards, aces, payout, rtp } = GAMBLE_CONFIG;
  if (aces < 1 || aces >= cards) {
    throw new Error(`Риск-игра: тузов ${aces} при ${cards} картах`);
  }
  if (rtp >= 1) {
    throw new Error(`Риск-игра: отдача ${rtp} >= 1, заведение в убытке`);
  }
  // Ниже 70% игра превращается в чистое изъятие — такой перекос ловим сразу.
  if (rtp < 0.7) {
    throw new Error(`Риск-игра: отдача ${(rtp * 100).toFixed(1)}% слишком низкая`);
  }
  if (payout * aces >= cards) {
    throw new Error('Риск-игра: выплата не оставляет преимущества заведению');
  }
  return { rtp, chance: GAMBLE_CONFIG.chance };
}
