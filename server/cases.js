/**
 * Кейсы: описание, математика выпадений и «плюшки».
 *
 * ТРИ ПРИНЦИПА, на которых держится вся экономика.
 *
 * 1. Содержимое задаётся МНОЖИТЕЛЯМИ от цены кейса, а не абсолютными числами.
 *    Поэтому в кейсе за 100 не может оказаться предмета на 100000: разброс
 *    всегда пропорционален стоимости открытия, по построению.
 *
 * 2. RTP задаётся ТОЧНО. Вероятность самого дешёвого предмета не выставляется
 *    руками, а решается уравнением так, чтобы матожидание в точности равнялось
 *    price * rtp.
 *
 * 3. Плюшки (x2, подарочный кейс, бонус на баланс) задаются не вероятностью, а
 *    ДОЛЕЙ В МАТОЖИДАНИИ. Плюшка с долей 0.06 забирает ровно 6% ожидаемой
 *    отдачи кейса, а её вероятность вычисляется из этой доли и её ценности.
 *    Так подарок в дорогом кейсе автоматически становится редким, и добавить
 *    «приятную мелочь», случайно уведя кейс в минус для заведения, невозможно.
 */

import { THEMES } from './themes.js';

export const TIERS = [
  { id: 'common', label: 'Обычный', color: '#9d8bb0' },
  { id: 'uncommon', label: 'Стандартный', color: '#00d4ff' },
  { id: 'rare', label: 'Хороший', color: '#a855f7' },
  { id: 'epic', label: 'Редкий', color: '#ff2e8a' },
  { id: 'legendary', label: 'Эпический', color: '#ff2d55' },
  { id: 'mythic', label: 'Легендарный', color: '#ff8c00' },
  { id: 'unique', label: 'Мифический', color: '#ffd60a' },
];

const TIER_IDS = TIERS.map((t) => t.id);

/**
 * Профили разброса. Первый множитель — «филлер», его вероятность решается;
 * последний берётся из maxMultiplier кейса.
 */
const PROFILES = {
  soft:   { mult: [0.2, 0.5, 0.9, 1.5, 3, 7],     w: [300, 250, 120, 40, 8, 1.5] },
  normal: { mult: [0.15, 0.45, 0.85, 1.6, 3.5, 8], w: [300, 230, 110, 42, 9, 1.6] },
  risky:  { mult: [0.1, 0.35, 0.8, 1.6, 4, 12],    w: [340, 90, 60, 40, 12, 2] },
  wild:   { mult: [0.05, 0.25, 0.7, 1.8, 5, 15],   w: [380, 70, 45, 30, 10, 2.2] },
};

export const CATEGORIES = [
  { id: 'start', name: 'Старт', description: 'Дешёвые кейсы с мягким разбросом' },
  { id: 'classic', name: 'Классика', description: 'Средние ставки, сбалансированный разброс' },
  { id: 'themed', name: 'Тематические', description: 'Коллекции на любой вкус' },
  { id: 'premium', name: 'Премиум', description: 'Дорогие кейсы, лучший RTP' },
  { id: 'elite', name: 'Элита', description: 'Самые крупные ставки в игре' },
  { id: 'risk', name: 'Риск', description: 'Редкие, но огромные множители' },
  { id: 'bonus', name: 'Бонусные', description: 'С плюшками: x2, подарки, бонусы' },
];

/* ============================================================
   ОПИСАНИЕ КЕЙСОВ
   ============================================================ */

/**
 * Плюшки:
 *   { type: 'credits', amount }    — мгновенный бонус на баланс
 *   { type: 'x2' }                 — следующее открытие ЭТОГО кейса удваивает выплату
 *   { type: 'voucher', caseId }    — бесплатное открытие указанного кейса
 * share — доля матожидания кейса, которую забирает плюшка.
 */
const SPECS = [
  // ── Старт ───────────────────────────────────────────────
  ['dust_25', 'Пыль', 'Дешевле некуда', 'start', 24, 0.95, 12, 'soft', 'forge'],
  ['spark_50', 'Искра', 'С чего-то надо начинать', 'start', 49, 0.95, 15, 'soft', 'neon'],
  ['copper_75', 'Медяк', 'Мелочь, а приятно', 'start', 74, 0.95, 15, 'soft', 'steampunk'],
  ['warmup_100', 'Разогрев', 'Тот самый кейс на сотку', 'start', 99, 0.95, 20, 'soft', 'casino'],
  ['alley_150', 'Подворотня', 'Что-то да найдётся', 'start', 149, 0.95, 18, 'soft', 'street'],
  ['frost_300', 'Мерзлота', 'Холодный расчёт', 'start', 299, 0.95, 20, 'soft', 'arctic'],
  ['rune_250', 'Первая руна', 'Начало пути', 'start', 249, 0.95, 20, 'soft', 'rune'],

  // ── Классика ────────────────────────────────────────────
  ['deck_400', 'Колода', 'Раздача пошла', 'classic', 399, 0.95, 22, 'normal', 'casino'],
  ['neon_500', 'Неоновый', 'Свет большого города', 'classic', 499, 0.95, 22, 'normal', 'neon'],
  ['mirage_600', 'Мираж', 'Не всё то золото', 'classic', 599, 0.95, 24, 'normal', 'desert'],
  ['forge_750', 'Горн', 'Куётся под давлением', 'classic', 749, 0.952, 24, 'normal', 'forge'],
  ['pit_800', 'Пит-стоп', 'Три секунды на всё', 'classic', 799, 0.952, 24, 'normal', 'racing'],
  ['vault_1000', 'Сейф', 'Что внутри — то ваше', 'classic', 999, 0.955, 25, 'normal', 'vault'],
  ['chapito_1200', 'Шапито', 'Представление начинается', 'classic', 1199, 0.955, 25, 'normal', 'circus'],
  ['blade_1500', 'Путь меча', 'Одно движение', 'classic', 1499, 0.955, 26, 'normal', 'samurai'],
  ['board_1800', 'Абордаж', 'На абордаж!', 'classic', 1799, 0.955, 26, 'normal', 'pirate'],
  ['temple_2000', 'Зелёный храм', 'Глубоко в джунглях', 'classic', 1999, 0.955, 26, 'normal', 'jungle'],
  ['noir_2500', 'Ночное дело', 'Без лишних свидетелей', 'classic', 2499, 0.955, 26, 'normal', 'noir'],

  // ── Тематические ────────────────────────────────────────
  ['hack_3000', 'Взлом', 'Доступ разрешён', 'themed', 2999, 0.955, 26, 'normal', 'cyber'],
  ['cut_3500', 'Огранка', 'Каждая грань считается', 'themed', 3499, 0.956, 27, 'normal', 'crystal'],
  ['steam_4000', 'Паровая', 'Механика не подводит', 'themed', 3999, 0.956, 27, 'normal', 'steampunk'],
  ['mariana_6000', 'Марианская', 'Одиннадцать километров вниз', 'themed', 5999, 0.958, 28, 'normal', 'deepsea'],
  ['shogun_8000', 'Сёгун', 'Власть в одних руках', 'themed', 7999, 0.958, 28, 'normal', 'samurai'],
  ['crypt_12000', 'Склеп', 'Не буди спящих', 'themed', 11999, 0.96, 30, 'normal', 'vampire'],
  ['quarantine_18000', 'Карантин', 'Вход только в костюме', 'themed', 17999, 0.96, 32, 'normal', 'toxic'],
  ['ash_25000', 'Пепел', 'Из пепла — заново', 'themed', 24999, 0.962, 34, 'normal', 'phoenix'],
  ['hoard_35000', 'Сокровищница', 'Дракон не делится', 'themed', 34999, 0.962, 36, 'normal', 'dragon'],
  ['diamond_60000', 'Алмазный фонд', 'Только чистая вода', 'themed', 59999, 0.965, 40, 'normal', 'crystal'],

  // ── Премиум ─────────────────────────────────────────────
  ['regalia_5000', 'Регалии', 'По праву рождения', 'premium', 4999, 0.957, 28, 'normal', 'royal'],
  ['tomb_7500', 'Гробница', 'Проклятие прилагается', 'premium', 7499, 0.958, 30, 'normal', 'pharaoh'],
  ['orbit_10000', 'Орбита', 'Выше только вакуум', 'premium', 9999, 0.96, 32, 'normal', 'orbit'],
  ['lair_15000', 'Логово', 'Тише. Он спит', 'premium', 14999, 0.96, 35, 'normal', 'dragon'],
  ['depo_20000', 'Депозитарий', 'Почти 800 000 за одно открытие', 'premium', 19999, 0.962, 40, 'normal', 'vault'],

  // ── Элита ───────────────────────────────────────────────
  ['galaxy_30000', 'Галактика', 'Масштаб другой', 'elite', 29999, 0.963, 38, 'normal', 'galaxy'],
  ['rebirth_40000', 'Возрождение', 'Всегда возвращается', 'elite', 39999, 0.965, 40, 'normal', 'phoenix'],
  ['abyss_50000', 'Бездна', 'Смотрит в ответ', 'elite', 49999, 0.965, 42, 'normal', 'deepsea'],
  ['empire_75000', 'Империя', 'Всё и сразу', 'elite', 74999, 0.968, 44, 'normal', 'royal'],
  ['apex_100000', 'Вершина', 'Дороже в игре нет', 'elite', 99999, 0.97, 45, 'normal', 'galaxy'],

  // ── Риск ────────────────────────────────────────────────
  ['allin_500', 'Ва-банк', 'Чаще пусто, реже густо', 'risk', 499, 0.94, 40, 'risky', 'casino'],
  ['redonly_1000', 'Красное или ничего', 'Полумер не бывает', 'risk', 999, 0.94, 45, 'risky', 'casino'],
  ['crater_2500', 'Жерло', 'Горячо во всех смыслах', 'risk', 2499, 0.94, 45, 'risky', 'volcano'],
  ['reactor_5000', 'Реактор', 'Стержни на пределе', 'risk', 4999, 0.94, 50, 'wild', 'toxic'],
  ['shadow_10000', 'Тень', 'Никто не узнает', 'risk', 9999, 0.94, 55, 'wild', 'shadow'],
  ['midnight_20000', 'Полночь', 'Ставки после заката', 'risk', 19999, 0.94, 55, 'wild', 'vampire'],
  ['nopoint_50000', 'Точка невозврата', 'Обратно дороги нет', 'risk', 49999, 0.94, 60, 'wild', 'galaxy'],

  // ── Бонусные (с плюшками) ───────────────────────────────
  ['lucky_200', 'Счастливый', 'Иногда просто везёт', 'bonus', 199, 0.95, 18, 'soft', 'casino',
    [{ type: 'credits', amount: 1499, share: 0.07 }]],
  ['double_500', 'Удвоитель', 'Следующий прокрут — вдвойне', 'bonus', 499, 0.95, 22, 'normal', 'neon',
    [{ type: 'x2', share: 0.09 }]],
  ['gift_1000', 'Подарочный', 'С подарком внутри', 'bonus', 999, 0.95, 24, 'normal', 'circus',
    [{ type: 'voucher', caseId: 'neon_500', share: 0.06 }]],
  ['chain_2000', 'Цепная реакция', 'Одно тянет другое', 'bonus', 1999, 0.95, 26, 'normal', 'toxic',
    [{ type: 'x2', share: 0.07 }, { type: 'voucher', caseId: 'vault_1000', share: 0.05 }]],
  ['jackpot_5000', 'Джекпот', 'Или пусто, или очень', 'bonus', 4999, 0.95, 30, 'normal', 'casino',
    [{ type: 'credits', amount: 119999, share: 0.08 }]],
  ['ticket_7000', 'Золотой билет', 'Проход в дорогое', 'bonus', 6999, 0.955, 30, 'normal', 'circus',
    [{ type: 'voucher', caseId: 'steam_4000', share: 0.07 }]],
  ['stake_10000', 'Двойная ставка', 'Удваивает следующий прокрут', 'bonus', 9999, 0.955, 32, 'normal', 'casino',
    [{ type: 'x2', share: 0.1 }]],
  ['treasure_15000', 'Клад', 'Кто нашёл — того и есть', 'bonus', 14999, 0.958, 34, 'normal', 'pirate',
    [{ type: 'credits', amount: 399999, share: 0.07 }]],
  ['megabox_25000', 'Мегабокс', 'Подарок и удвоение', 'bonus', 24999, 0.96, 36, 'normal', 'royal',
    [{ type: 'voucher', caseId: 'orbit_10000', share: 0.06 }, { type: 'x2', share: 0.06 }]],
  ['infinity_50000', 'Бесконечность', 'Не заканчивается', 'bonus', 49999, 0.962, 40, 'normal', 'galaxy',
    [{ type: 'x2', share: 0.08 }, { type: 'credits', amount: 1199999, share: 0.06 }]],
  ['legend_100000', 'Легенда', 'Вершина коллекции', 'bonus', 99999, 0.965, 45, 'normal', 'dragon',
    [{ type: 'voucher', caseId: 'apex_100000', share: 0.07 }, { type: 'x2', share: 0.06 }]],
  ['sultan_40000', 'Три желания', 'Джинн не обманет', 'bonus', 39999, 0.96, 38, 'normal', 'desert',
    [{ type: 'voucher', caseId: 'lair_15000', share: 0.06 }, { type: 'credits', amount: 899999, share: 0.05 }]],
];

/* ============================================================
   СБОРКА
   ============================================================ */

const PERK_LABELS = {
  x2: 'Удвоитель ×2',
  voucher: 'Подарочный кейс',
  credits: 'Бонус на баланс',
};

/**
 * Собирает кейс: считает цены предметов, ценность и вероятность плюшек,
 * затем решает вероятность филлера так, чтобы EV точно равнялось price * rtp.
 *
 * Работа идёт сразу в вероятностях, а не в весах: вероятность плюшки жёстко
 * задана её долей в матожидании, и подмешивать её к весовой схеме было бы
 * лишним кругом вычислений.
 */
function buildCase(spec, builtById) {
  const [id, name, tagline, category, price, rtp, maxMultiplier, profileId, themeId, perkSpecs = []] = spec;

  const profile = PROFILES[profileId];
  const theme = THEMES[themeId];
  const target = price * rtp;

  const values = [
    ...profile.mult.map((m) => Math.round(price * m)),
    Math.round(price * maxMultiplier),
  ];

  // Плюшки, не выдающие единицы сразу (x2 и подарок), забирают долю
  // матожидания в обход мгновенной выплаты — отсюда и считается ожидаемая
  // выплата единицами, на которую опирается x2.
  const deferredShare = perkSpecs
    .filter((p) => p.type !== 'credits')
    .reduce((s, p) => s + p.share, 0);
  const creditEv = target * (1 - deferredShare);

  const perkItems = perkSpecs.map((p, i) => {
    let evValue;
    let payout = 0;
    let label;

    if (p.type === 'credits') {
      evValue = p.amount;
      payout = p.amount;
      label = `Бонус +${p.amount.toLocaleString('ru-RU')}`;
    } else if (p.type === 'x2') {
      // Удваивается только выплата единицами следующего открытия этого кейса.
      evValue = creditEv;
      label = 'Удвоитель ×2';
    } else if (p.type === 'voucher') {
      const targetCase = builtById.get(p.caseId);
      if (!targetCase) {
        throw new Error(`[${id}] подарочный кейс ${p.caseId} не найден или собран позже`);
      }
      // Бесплатное открытие даёт игроку ВСЁ, что даёт тот кейс, — полное EV.
      evValue = targetCase.price * targetCase.rtp;
      label = `Кейс «${targetCase.name}» бесплатно`;
    } else {
      throw new Error(`[${id}] неизвестный тип плюшки: ${p.type}`);
    }

    if (evValue <= 0) throw new Error(`[${id}] плюшка ${p.type} имеет нулевую ценность`);

    return {
      id: `${id}_perk${i}`,
      name: label,
      kind: 'perk',
      perk: p.type === 'voucher' ? { type: 'voucher', caseId: p.caseId }
          : p.type === 'credits' ? { type: 'credits', amount: p.amount }
          : { type: 'x2', caseId: id },
      perkLabel: PERK_LABELS[p.type],
      value: payout,
      evValue,
      // Доля матожидания задана — отсюда вероятность.
      probability: (p.share * target) / evValue,
      tier: 'unique',
      multiplier: Number((evValue / price).toFixed(3)),
    };
  });

  const perkProbability = perkItems.reduce((s, it) => s + it.probability, 0);
  if (perkProbability >= 0.4) {
    throw new Error(`[${id}] плюшки занимают ${(perkProbability * 100).toFixed(1)}% вероятности`);
  }

  // Относительные веса обычных предметов, кроме филлера.
  const restWeights = profile.w;
  const restSum = restWeights.reduce((a, b) => a + b, 0);
  const restValues = values.slice(1);
  const avgRest = restValues.reduce((s, v, i) => s + (restWeights[i] / restSum) * v, 0);

  // EV = p0*v0 + q*avgRest + (доли плюшек) = target.
  // Плюшки по построению дают ровно target * Σshare, отсюда:
  const perkEv = perkItems.reduce((s, it) => s + it.probability * it.evValue, 0);
  const v0 = values[0];
  const q = (target - perkEv - (1 - perkProbability) * v0) / (avgRest - v0);
  const p0 = 1 - perkProbability - q;

  if (!(q > 0) || !(p0 > 0)) {
    throw new Error(
      `[${id}] не удалось свести математику: q=${q.toFixed(4)}, p0=${p0.toFixed(4)}. ` +
      `Филлер ${v0} должен быть дешевле цели ${target.toFixed(0)}, ` +
      `а средняя по остальным (${avgRest.toFixed(0)}) — дороже.`
    );
  }

  const normalItems = values.map((value, i) => ({
    id: `${id}_${i}`,
    name: theme.items[i],
    kind: 'item',
    value,
    evValue: value,
    multiplier: Number((value / price).toFixed(3)),
    tier: TIER_IDS[i],
    probability: i === 0 ? p0 : q * (restWeights[i - 1] / restSum),
  }));

  const items = [...normalItems, ...perkItems];

  let acc = 0;
  for (const item of items) {
    acc += item.probability;
    item.cumulative = acc;
  }
  items[items.length - 1].cumulative = 1;

  const ev = items.reduce((s, it) => s + it.probability * it.evValue, 0);
  const cashEv = items.reduce((s, it) => s + it.probability * it.value, 0);

  return {
    id, name, category, tagline, price, rtp, maxMultiplier,
    theme: themeId,
    palette: theme.palette,
    items,
    hasPerks: perkItems.length > 0,
    ev,
    cashEv,
    actualRtp: ev / price,
  };
}

// Кейсы без подарочных плюшек собираются первыми: подарок ссылается на
// уже посчитанный кейс.
const builtById = new Map();
const withVoucher = [];

for (const spec of SPECS) {
  const perks = spec[9] || [];
  if (perks.some((p) => p.type === 'voucher')) withVoucher.push(spec);
  else {
    const built = buildCase(spec, builtById);
    builtById.set(built.id, built);
  }
}
for (const spec of withVoucher) {
  const built = buildCase(spec, builtById);
  builtById.set(built.id, built);
}

// Порядок как в SPECS, а не как в порядке сборки.
export const CASES = SPECS.map((s) => builtById.get(s[0]));

export function getCase(id) {
  return builtById.get(id);
}

export function pickItem(caseData, roll) {
  for (const item of caseData.items) {
    if (roll < item.cumulative) return item;
  }
  return caseData.items[caseData.items.length - 1];
}

/* ============================================================
   ПРОВЕРКА ИНВАРИАНТОВ
   ============================================================ */

export function validateCases(cases = CASES) {
  const report = [];
  const seen = new Set();

  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`Дубликат id кейса: ${c.id}`);
    seen.add(c.id);

    const sumP = c.items.reduce((s, it) => s + it.probability, 0);
    if (Math.abs(sumP - 1) > 1e-9) {
      throw new Error(`[${c.id}] сумма вероятностей = ${sumP}, ожидалась 1`);
    }

    if (Math.abs(c.actualRtp - c.rtp) > 1e-9) {
      throw new Error(`[${c.id}] RTP = ${c.actualRtp.toFixed(8)}, ожидался ${c.rtp}`);
    }

    // Ни один предмет не может стоить больше заявленного потолка.
    const maxValue = Math.max(...c.items.filter((i) => i.kind === 'item').map((i) => i.value));
    if (maxValue > c.price * c.maxMultiplier + 0.5) {
      throw new Error(`[${c.id}] предмет ${maxValue} превышает потолок ${c.price * c.maxMultiplier}`);
    }

    // Кейс обязан быть убыточен для игрока, иначе его можно крутить в плюс.
    if (c.ev >= c.price) throw new Error(`[${c.id}] EV ${c.ev} >= цены ${c.price}`);

    for (const it of c.items) {
      if (!(it.probability > 0) || !(it.probability < 1)) {
        throw new Error(`[${c.id}] предмет ${it.id} имеет вероятность ${it.probability}`);
      }
    }

    // Подарочный кейс не должен быть дороже того, который его выдаёт, —
    // иначе выгоднее крутить дешёвый ради подарка.
    for (const it of c.items) {
      if (it.perk?.type === 'voucher') {
        const gift = builtById.get(it.perk.caseId);
        if (gift.price > c.price) {
          throw new Error(`[${c.id}] дарит более дорогой кейс ${gift.id} (${gift.price} > ${c.price})`);
        }
      }
    }

    report.push({
      id: c.id,
      название: c.name,
      цена: c.price,
      rtp: Number(c.actualRtp.toFixed(6)),
      максимум: maxValue,
      'x макс': Number((maxValue / c.price).toFixed(1)),
      плюшки: c.items.filter((i) => i.kind === 'perk').length || '',
    });
  }

  return report;
}

export function publicCase(c) {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    tagline: c.tagline,
    price: c.price,
    rtp: Number(c.actualRtp.toFixed(4)),
    maxMultiplier: c.maxMultiplier,
    theme: c.theme,
    palette: c.palette,
    hasPerks: c.hasPerks,
    topValue: Math.max(...c.items.filter((i) => i.kind === 'item').map((i) => i.value)),
    items: c.items.map((it) => ({
      id: it.id,
      name: it.name,
      kind: it.kind,
      value: it.value,
      evValue: it.evValue,
      multiplier: it.multiplier,
      tier: it.tier,
      perkLabel: it.perkLabel,
      probability: it.probability,
    })),
  };
}
