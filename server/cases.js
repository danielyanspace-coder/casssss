/**
 * Описание кейсов и математика выпадений.
 *
 * Главный принцип: содержимое кейса задаётся НЕ абсолютными числами, а
 * множителями от цены кейса. Поэтому предмет физически не может стоить
 * непропорционально дорого — в кейсе за 100 единиц максимум ограничен
 * maxMultiplier, и предмета на 100000 там не появится по построению.
 *
 * Второй принцип: RTP (return to player) задаётся точно. Вес самого дешёвого
 * предмета не задаётся вручную, а вычисляется так, чтобы матожидание выигрыша
 * равнялось price * rtp с точностью до плавающей точки.
 */

/**
 * Уровни редкости: подпись и цвет для интерфейса.
 *
 * Подписи подобраны под реальные шансы, а не «на вырост»: предмет с шансом
 * 14% называется редким, а не эпическим. Раздувать названия — значит вводить
 * игрока в заблуждение о том, насколько ценно выпадение.
 */
export const TIERS = [
  { id: 'common', label: 'Обычный', color: '#8a94a6' },
  { id: 'uncommon', label: 'Стандартный', color: '#4b74ff' },
  { id: 'rare', label: 'Хороший', color: '#8b5cf6' },
  { id: 'epic', label: 'Редкий', color: '#c026d3' },
  { id: 'legendary', label: 'Эпический', color: '#f43f5e' },
  { id: 'mythic', label: 'Легендарный', color: '#f59e0b' },
  { id: 'unique', label: 'Мифический', color: '#ffd700' },
];

/**
 * Множители стоимости предмета относительно цены кейса.
 * Индекс 0 — «филлер», его вес вычисляется решателем.
 */
const STANDARD_MULTIPLIERS = [0.2, 0.5, 0.9, 1.5, 3, 7, null];
const RISK_MULTIPLIERS = [0.1, 0.35, 0.8, 1.6, 4, 12, null];

/** Профили весов. Индекс 0 всегда null — вычисляется. */
const STANDARD_WEIGHTS = [null, 300, 250, 120, 40, 8, 1.5];
const RISK_WEIGHTS = [null, 340, 90, 60, 40, 12, 2];

const TIER_IDS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'unique'];

/**
 * Решает вес филлера так, чтобы EV == price * rtp.
 *
 * EV = (w0*v0 + A) / (w0 + S), где A и S — сумма (вес*цена) и сумма весов
 * остальных предметов. Отсюда w0 = (T*S - A) / (v0 - T), где T = price * rtp.
 *
 * Решение существует и положительно, когда v0 < T < среднее по остальным.
 */
function solveFillerWeight(values, weights, target) {
  let S = 0;
  let A = 0;
  for (let i = 1; i < values.length; i++) {
    S += weights[i];
    A += weights[i] * values[i];
  }
  const w0 = (target * S - A) / (values[0] - target);
  if (!Number.isFinite(w0) || w0 <= 0) {
    throw new Error(
      `Невозможно подобрать вес филлера: target=${target}, v0=${values[0]}, ` +
        `среднее по остальным=${(A / S).toFixed(2)}. ` +
        `Нужно, чтобы v0 < target < среднее по остальным.`
    );
  }
  return w0;
}

/**
 * Собирает готовый кейс: считает цены предметов, вес филлера, вероятности.
 */
function buildCase(spec) {
  const { multipliers, weights: rawWeights, price, rtp, maxMultiplier, itemNames } = spec;

  const values = multipliers.map((m, i) =>
    Math.round(price * (i === multipliers.length - 1 ? maxMultiplier : m))
  );

  const weights = rawWeights.slice();
  weights[0] = solveFillerWeight(values, weights, price * rtp);

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const items = values.map((value, i) => ({
    id: `${spec.id}_${i}`,
    name: itemNames[i],
    value,
    multiplier: Number((value / price).toFixed(3)),
    tier: TIER_IDS[i],
    probability: weights[i] / totalWeight,
  }));

  // Кумулятивные границы для розыгрыша — считаем один раз при загрузке.
  let acc = 0;
  for (const item of items) {
    acc += item.probability;
    item.cumulative = acc;
  }
  // Страхуем последний предмет от ошибок округления вниз.
  items[items.length - 1].cumulative = 1;

  const ev = items.reduce((sum, it) => sum + it.probability * it.value, 0);

  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    tagline: spec.tagline,
    price,
    rtp,
    maxMultiplier,
    items,
    ev,
    actualRtp: ev / price,
  };
}

export const CATEGORIES = [
  { id: 'start', name: 'Старт', description: 'Дешёвые кейсы с мягким разбросом' },
  { id: 'classic', name: 'Классика', description: 'Средние ставки, сбалансированный разброс' },
  { id: 'highroll', name: 'Хай-ролл', description: 'Дорогие кейсы, лучший RTP' },
  { id: 'risk', name: 'Риск', description: 'Редкие, но крупные множители' },
];

const SPECS = [
  {
    id: 'first_step',
    name: 'Первый шаг',
    category: 'start',
    tagline: 'С чего-то надо начинать',
    price: 50,
    rtp: 0.95,
    maxMultiplier: 15,
    multipliers: STANDARD_MULTIPLIERS,
    weights: STANDARD_WEIGHTS,
    itemNames: [
      'Ржавый болт',
      'Медный жетон',
      'Латунный ключ',
      'Стальной компас',
      'Кварцевый резонатор',
      'Серебряный сердечник',
      'Золотой пропуск',
    ],
  },
  {
    id: 'warmup',
    name: 'Разогрев',
    category: 'start',
    tagline: 'Тот самый кейс на сотку',
    price: 100,
    rtp: 0.95,
    maxMultiplier: 20,
    multipliers: STANDARD_MULTIPLIERS,
    weights: STANDARD_WEIGHTS,
    itemNames: [
      'Стёртая шестерня',
      'Медный конденсатор',
      'Плазменный резак',
      'Кобальтовый привод',
      'Импульсный модулятор',
      'Ядро реактора',
      'Платиновый ключ доступа',
    ],
  },
  {
    id: 'classic',
    name: 'Классика',
    category: 'classic',
    tagline: 'Ровно посередине',
    price: 250,
    rtp: 0.95,
    maxMultiplier: 22,
    multipliers: STANDARD_MULTIPLIERS,
    weights: STANDARD_WEIGHTS,
    itemNames: [
      'Треснувшая линза',
      'Оптический прицел',
      'Титановый корпус',
      'Гравитационный стабилизатор',
      'Квантовый чип',
      'Кристалл памяти',
      'Реликвия архива',
    ],
  },
  {
    id: 'city_legend',
    name: 'Городская легенда',
    category: 'classic',
    tagline: 'Слухи ходят не зря',
    price: 500,
    rtp: 0.955,
    maxMultiplier: 25,
    multipliers: STANDARD_MULTIPLIERS,
    weights: STANDARD_WEIGHTS,
    itemNames: [
      'Пыльный картридж',
      'Неоновая вывеска',
      'Голографический пропуск',
      'Куртка курьера',
      'Прототип импланта',
      'Ключ от подземки',
      'Артефакт основателя',
    ],
  },
  {
    id: 'vault',
    name: 'Хранилище',
    category: 'highroll',
    tagline: 'Дорого, но честно',
    price: 1000,
    rtp: 0.96,
    maxMultiplier: 28,
    multipliers: STANDARD_MULTIPLIERS,
    weights: STANDARD_WEIGHTS,
    itemNames: [
      'Пустой сейф',
      'Слиток вольфрама',
      'Банковский модуль',
      'Криптографический жетон',
      'Чёрная карта',
      'Печать хранителя',
      'Ключ от главного зала',
    ],
  },
  {
    id: 'orbit',
    name: 'Орбита',
    category: 'highroll',
    tagline: 'Максимальный RTP в игре',
    price: 2500,
    rtp: 0.965,
    maxMultiplier: 30,
    multipliers: STANDARD_MULTIPLIERS,
    weights: STANDARD_WEIGHTS,
    itemNames: [
      'Обломок обшивки',
      'Солнечная панель',
      'Навигационный блок',
      'Ионный двигатель',
      'Криокапсула',
      'Ядро станции',
      'Чёрный ящик «Орбиты»',
    ],
  },
  {
    id: 'all_in',
    name: 'Ва-банк',
    category: 'risk',
    tagline: 'Чаще пусто, реже густо',
    price: 500,
    rtp: 0.94,
    maxMultiplier: 40,
    multipliers: RISK_MULTIPLIERS,
    weights: RISK_WEIGHTS,
    itemNames: [
      'Пустая гильза',
      'Погнутая монета',
      'Счастливый жетон',
      'Красная фишка',
      'Золотая фишка',
      'Бриллиантовая фишка',
      'Джекпот-жетон',
    ],
  },
  {
    id: 'singularity',
    name: 'Сингулярность',
    category: 'risk',
    tagline: 'Самый большой разброс',
    price: 1000,
    rtp: 0.94,
    maxMultiplier: 50,
    multipliers: RISK_MULTIPLIERS,
    weights: RISK_WEIGHTS,
    itemNames: [
      'Космическая пыль',
      'Осколок кометы',
      'Тёмная материя',
      'Квантовая петля',
      'Червоточина',
      'Горизонт событий',
      'Сингулярность',
    ],
  },
];

export const CASES = SPECS.map(buildCase);

const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

export function getCase(id) {
  return CASE_BY_ID.get(id);
}

/**
 * Переводит число [0,1) в выпавший предмет по кумулятивным вероятностям.
 */
export function pickItem(caseData, roll) {
  for (const item of caseData.items) {
    if (roll < item.cumulative) return item;
  }
  return caseData.items[caseData.items.length - 1];
}

/**
 * Проверка инвариантов. Запускается при старте сервера — если математика
 * поехала, сервер падает сразу, а не отдаёт игрокам кривые шансы.
 */
export function validateCases(cases = CASES) {
  const report = [];

  for (const c of cases) {
    const sumP = c.items.reduce((s, it) => s + it.probability, 0);
    if (Math.abs(sumP - 1) > 1e-9) {
      throw new Error(`[${c.id}] сумма вероятностей = ${sumP}, ожидалась 1`);
    }

    if (Math.abs(c.actualRtp - c.rtp) > 1e-9) {
      throw new Error(
        `[${c.id}] RTP = ${c.actualRtp.toFixed(6)}, ожидался ${c.rtp}`
      );
    }

    const maxValue = Math.max(...c.items.map((it) => it.value));
    if (maxValue > c.price * c.maxMultiplier + 0.5) {
      throw new Error(
        `[${c.id}] максимальный предмет ${maxValue} превышает лимит ` +
          `${c.price * c.maxMultiplier}`
      );
    }

    // Матожидание обязано быть ниже цены — иначе кейс бесконечно доходен.
    if (c.ev >= c.price) {
      throw new Error(`[${c.id}] EV ${c.ev} >= цены ${c.price}`);
    }

    for (const it of c.items) {
      if (it.probability <= 0 || it.probability >= 1) {
        throw new Error(`[${c.id}] предмет ${it.id} имеет вероятность ${it.probability}`);
      }
    }

    report.push({
      id: c.id,
      name: c.name,
      price: c.price,
      ev: Number(c.ev.toFixed(4)),
      rtp: Number(c.actualRtp.toFixed(6)),
      maxValue,
      maxMultiplier: Number((maxValue / c.price).toFixed(2)),
      topChance: c.items[c.items.length - 1].probability,
    });
  }

  return report;
}

/** Публичный вид кейса — то, что уходит на клиент. */
export function publicCase(c) {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    tagline: c.tagline,
    price: c.price,
    rtp: Number(c.actualRtp.toFixed(4)),
    maxMultiplier: c.maxMultiplier,
    items: c.items.map((it) => ({
      id: it.id,
      name: it.name,
      value: it.value,
      multiplier: it.multiplier,
      tier: it.tier,
      probability: it.probability,
    })),
  };
}
