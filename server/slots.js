/**
 * Описания слотов: символы, выплаты, ленты, джекпоты и оформление.
 *
 * Математики здесь нет вовсе - она вся в server/slot-engine.js. Здесь только
 * то, что отличает одну игру от другой, и решения, которые принимает человек:
 * какой символ сколько платит, насколько он редкий, сколько стоит джекпот.
 *
 * ПОЧЕМУ ВЫПЛАТЫ ЗАДАНЫ «КАК В МАКЕТЕ», А НЕ В ОДНИХ ЕДИНИЦАХ. Макеты
 * присланы разными, и подписи в них разные: у TREASURE ISLAND выплаты в
 * ставках НА ЛИНИЮ, у GOLDEN LEGACY - в ОБЩИХ ставках. Переписывать одну из
 * таблиц в чужие единицы значит гарантированно ошибиться при сверке с
 * макетом, поэтому числа лежат ровно те же, а поле payUnit говорит движку,
 * как их понимать. Внутри движок всё равно приводит их к линейным ставкам.
 */

import { createHash } from 'node:crypto';
import {
  buildSlot, validateSlot, hitFrequency,
  gridFrom, evaluate, jackpotFrom, jackpotRoll, offsetsFrom, offsetFrom,
  PAYLINES, LINES, ROWS, REELS, WILD, SCATTER,
} from './slot-engine.js';

/*
 * Список, а не `export ... from`: автономная сборка снимает строки импорта
 * выражением по тексту, и конструкцию с `from` она оставила бы висеть
 * посреди файла, уронив разбор всей сборки.
 */
export {
  PAYLINES, LINES, ROWS, REELS, WILD, SCATTER,
  gridFrom, evaluate, jackpotFrom, jackpotRoll, offsetsFrom, offsetFrom,
};

/**
 * ОТДАЧА СЛОТОВ 94%, А НЕ 70%, КАК У ОСТАЛЬНЫХ ИГР ПРОЕКТА.
 *
 * Это осознанное расхождение, и вот почему. Слот - игра на много прокрутов
 * подряд: за сессию их сотни, а не пять, как открытий кейса. При отдаче 0.70
 * ставка в сто рублей уносит тридцать рублей за прокрут, и депозит в пять
 * тысяч кончается за полторы минуты. Ни один слот в мире так не настроен:
 * отраслевая норма 94-96%, и она взята не из щедрости, а потому что при
 * меньшей игрок уходит раньше, чем игра успевает ему понравиться.
 *
 * ЧТО ЭТО ЗНАЧИТ ДЛЯ КАССЫ: слот забирает 6 копеек с рубля оборота вместо
 * тридцати. Хотите как у кейсов - поменяйте это число, всё остальное
 * пересчитается само, включая цену покупки бонуса и долю джекпотов.
 */
export const SLOT_RTP = 0.94;

/** Ставки: один список на оба слота, он же в макетах. */
const BETS = [10, 20, 50, 100, 300, 500, 1000, 2000, 5000, 10000];

/* ============================================================
   TREASURE ISLAND
   ============================================================ */

/**
 * ВЫПЛАТЫ ИЗ МАКЕТА УДВОЕНЫ, И БЕЗ ЭТОГО СЛОТ НЕ СОБИРАЕТСЯ.
 *
 * В присланной таблице пять капитанов дают 1000 линейных ставок, пять
 * десяток - 40. Взятая буквально, эта таблица даёт отдачу около 47% при любой
 * раскладке лент: она просто слишком тонкая. Проверить легко - поставьте
 * payScale = 1 и запустите validateSlots(), он посчитает точную отдачу.
 *
 * Поднимать отдачу лентами нельзя: чтобы выжать из такой таблицы 94%, ленту
 * пришлось бы укоротить до двадцати с небольшим позиций и сделать капитана
 * таким же частым, как десятку. Тогда «1000x» перестаёт быть редким призом, а
 * игрок, посчитавший частоты, увидит, что таблица врёт про редкость.
 *
 * Поэтому умножается вся таблица целиком. Таблица выплат сообщает игроку
 * СООТНОШЕНИЯ призов, и они сохранены до последней цифры: капитан по-прежнему
 * в двадцать пять раз дороже десятки.
 */
const TREASURE_ISLAND = {
  id: 'treasure-island',
  name: 'TREASURE ISLAND',
  tagline: 'PIRATE FORTUNE',
  blurb: 'Пиратский остров: расширяющиеся WILD в бонусе и четыре джекпота.',
  theme: 'pirate',
  rtp: SLOT_RTP,
  payUnit: 'line',
  payScale: 2,
  freeSpins: 10,
  freeMultiplier: 1,

  names: {
    captain: 'Пират-капитан', woman: 'Пиратка', ship: 'Корабль', crown: 'Корона',
    compass: 'Компас', parrot: 'Попугай', chest: 'Сундук', spyglass: 'Подзорная труба',
    ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: '10',
  },
  refPays: {
    captain: [50, 250, 1000], woman: [40, 200, 800], ship: [30, 150, 600],
    crown: [20, 100, 400], compass: [15, 75, 300], parrot: [12, 60, 250],
    chest: [10, 50, 200], spyglass: [8, 40, 150], ace: [5, 25, 100],
    king: [4, 20, 80], queen: [3, 15, 60], jack: [2, 12, 50], ten: [2, 10, 40],
  },

  /*
   * Три яруса. Ярус - это РЕДКОСТЬ, а не жанр: внутри яруса символы
   * встречаются одинаково часто и различаются только выплатой. Так устроено
   * большинство слотов, и так проще: различать редкость тринадцати символов по
   * отдельности значит придумать тринадцать чисел, которые нечем обосновать.
   */
  tiers: {
    premium: ['captain', 'woman', 'ship', 'crown'],
    mid: ['compass', 'parrot', 'chest', 'spyglass'],
    low: ['ace', 'king', 'queen', 'jack', 'ten'],
  },
  tierWeight: { premium: 1, mid: 3, low: 6 },

  /** Wild только на втором, третьем и четвёртом барабане. Почему - см. движок. */
  wildWeight: [0, 4, 5, 4, 0],
  /** На крайних барабанах scatter реже: там решается, запустится бонус или нет. */
  scatterWeight: [1, 2, 2, 2, 1],
  scatterPays: { 3: 2, 4: 10, 5: 50 },

  jackpots: [
    { id: 'grand', name: 'GRAND', amount: 2_500_000, split: 4 },
    { id: 'major', name: 'MAJOR', amount: 250_000, split: 6 },
    { id: 'minor', name: 'MINOR', amount: 50_000, split: 8 },
    { id: 'mini', name: 'MINI', amount: 10_000, split: 12 },
  ],

  bets: BETS,
  art: {
    cover: '/assets/ui/slot-cover-treasure.webp',
    logo: '/assets/ui/slot-logo.webp',
    spin: '/assets/ui/slot-spin.webp',
    bonus: '/assets/ui/slot-card-bonus.webp',
    symbols: {
      captain: '/assets/ui/slot-sym-captain.webp',
      woman: '/assets/ui/slot-sym-woman.webp',
      ship: '/assets/ui/slot-sym-ship.webp',
      crown: '/assets/ui/slot-sym-crown.webp',
      compass: '/assets/ui/slot-sym-compass.webp',
      parrot: '/assets/ui/slot-sym-parrot.webp',
      chest: '/assets/ui/slot-sym-chest.webp',
      spyglass: '/assets/ui/slot-sym-spyglass.webp',
      ace: '/assets/ui/slot-sym-ace.webp',
      king: '/assets/ui/slot-sym-king.webp',
      queen: '/assets/ui/slot-sym-queen.webp',
      jack: '/assets/ui/slot-sym-jack.webp',
      ten: '/assets/ui/slot-sym-ten.webp',
      wild: '/assets/ui/slot-sym-wild.webp',
      scatter: '/assets/ui/slot-sym-scatter.webp',
    },
  },
};

/* ============================================================
   GOLDEN LEGACY
   ============================================================ */

/**
 * ТАБЛИЦА ВЫПЛАТ ВЗЯТА ИЗ МАКЕТА БЕЗ ЕДИНОЙ ПРАВКИ, И ЭТО ВОЗМОЖНО ПОТОМУ,
 * ЧТО ОНА ЗАДАНА В ОБЩИХ СТАВКАХ.
 *
 * «5 - 100x» у льва это сто общих ставок, то есть две тысячи линейных.
 * Пересчитанная в линейные, таблица оказывается ровно того же порядка, что у
 * TREASURE ISLAND после удвоения, и отдача сводится без всякого множителя.
 *
 * ЭТА ИГРА ОЩУЩАЕТСЯ ИНАЧЕ, ЧЕМ ВТОРАЯ, и это видно по двум числам.
 * Что-то выпадает на каждом пятом прокруте против каждого третьего у
 * TREASURE ISLAND, зато сами выигрыши крупнее: соотношение верхнего приза к
 * нижнему здесь 10:1 против 25:1, и отдачу несут не мелкие цепочки дешёвых
 * символов, а средние из дорогих. Плюс бонус, удваивающий выплаты.
 *
 * Два слота с одинаковой отдачей и разным характером - это и есть смысл
 * второй игры. Одинаковые по ощущению отличались бы только картинкой.
 */
const GOLDEN_LEGACY = {
  id: 'golden-legacy',
  name: 'GOLDEN LEGACY',
  tagline: 'FORTUNE FAVORS THE BRAVE',
  blurb: 'Древний храм: крупные выигрыши и бесплатные вращения с удвоением.',
  theme: 'temple',
  rtp: SLOT_RTP,
  payUnit: 'total',
  payScale: 1,
  freeSpins: 10,

  /**
   * Во фриспинах выигрыши по линиям удваиваются.
   *
   * Это не украшение, а единственный рычаг, который двигает ТОЛЬКО долю
   * бонуса: частота wild поднимает и бонус, и базовую игру разом, а длина
   * ленты не меняет вообще ничего (важны лишь соотношения весов). Без
   * множителя бонус этой игры забирал бы пять процентов отдачи и не ощущался
   * бы событием.
   */
  freeMultiplier: 2,

  names: {
    lion: 'Лев', temple: 'Храм', chest: 'Сундук', helmet: 'Шлем',
    wreath: 'Лавровый венок', amphora: 'Амфора',
    ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: '10',
  },
  refPays: {
    lion: [10, 25, 100], temple: [5, 15, 50], chest: [5, 15, 50],
    helmet: [4, 12, 40], wreath: [3, 10, 30], amphora: [2, 8, 25],
    ace: [2, 6, 20], king: [2, 6, 20], queen: [1, 5, 15], jack: [1, 5, 15],
    ten: [1, 3, 10],
  },

  tiers: {
    premium: ['lion', 'temple', 'chest', 'helmet'],
    mid: ['wreath', 'amphora'],
    low: ['ace', 'king', 'queen', 'jack', 'ten'],
  },

  /**
   * Здесь вес задан ПОСИМВОЛЬНО, а не ярусами, и это вынужденно.
   *
   * Ступеньки выплат у этой таблицы пологие (100, 50, 50, 40, 30, 25, 20, 20,
   * 15, 15, 10), и тремя ярусами нужную редкость не выразить: любой ярус
   * склеивает символы, которые обязаны отличаться по частоте, и отдача
   * уезжает на десятки процентов.
   *
   * Числа не выдуманы. Они получены из правила «частота обратно
   * пропорциональна корню из выплаты»: именно такое распределение
   * МИНИМИЗИРУЕТ отдачу при заданной таблице, а её здесь надо было именно
   * опустить - таблица щедрая. Отклонение в любую сторону поднимает отдачу
   * выше заявленной, и бюджет джекпотов уходит в минус.
   */
  weights: {
    lion: 5, temple: 7, chest: 7, helmet: 8, wreath: 9, amphora: 10,
    ace: 11, king: 11, queen: 13, jack: 13, ten: 15,
  },

  wildWeight: [0, 2, 3, 2, 0],
  scatterWeight: [3, 4, 4, 4, 3],
  scatterPays: { 3: 2, 4: 10, 5: 50 },

  jackpots: [
    { id: 'grand', name: 'GRAND', amount: 1_250_000, split: 4 },
    { id: 'major', name: 'MAJOR', amount: 250_000, split: 6 },
    { id: 'minor', name: 'MINOR', amount: 50_000, split: 8 },
    { id: 'mini', name: 'MINI', amount: 10_000, split: 12 },
  ],

  bets: BETS,
  art: {
    cover: '/assets/ui/slot-cover-golden.webp',
    logo: '/assets/ui/gl-logo.webp',
    spin: '/assets/ui/gl-spin.webp',
    bonus: '/assets/ui/gl-bonus.webp',
    symbols: {
      lion: '/assets/ui/gl-sym-lion.webp',
      temple: '/assets/ui/gl-sym-temple.webp',
      chest: '/assets/ui/gl-sym-chest.webp',
      helmet: '/assets/ui/gl-sym-helmet.webp',
      wreath: '/assets/ui/gl-sym-wreath.webp',
      amphora: '/assets/ui/gl-sym-amphora.webp',
      ace: '/assets/ui/gl-sym-ace.webp',
      king: '/assets/ui/gl-sym-king.webp',
      queen: '/assets/ui/gl-sym-queen.webp',
      jack: '/assets/ui/gl-sym-jack.webp',
      ten: '/assets/ui/gl-sym-ten.webp',
      wild: '/assets/ui/gl-sym-wild.webp',
      scatter: '/assets/ui/gl-sym-scatter.webp',
    },
  },
};

/* ============================================================
   РЕЕСТР
   ============================================================ */

/** Порядок здесь - порядок на полке. Первым стоит тот, что показываем. */
export const SLOTS = [GOLDEN_LEGACY, TREASURE_ISLAND].map(buildSlot);

export const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

export function getSlot(id) {
  return SLOT_BY_ID.get(String(id || '')) || null;
}

/** Описание одного слота для клиента. */
export function publicSlot(slot) {
  return {
    id: slot.id,
    name: slot.name,
    tagline: slot.tagline,
    blurb: slot.blurb,
    theme: slot.theme,
    rtp: slot.rtp,
    reels: REELS,
    rows: ROWS,
    lines: PAYLINES,
    symbols: slot.symbols.map((s) => ({
      id: s.id, name: s.name, tier: s.tier, pays: s.pays, shown: s.shown,
    })),
    payUnit: slot.payUnit,
    wild: WILD,
    scatter: SCATTER,
    scatterPays: slot.scatterPays,
    freeSpins: slot.freeSpins,
    freeMultiplier: slot.freeMultiplier,
    buyBonusPrice: slot.buyBonusPrice,
    jackpots: slot.jackpots.map((j) => ({ id: j.id, name: j.name, amount: j.amount })),
    bets: slot.bets,
    art: slot.art,
    // Ленты клиенту нужны, чтобы крутить барабан настоящими символами, а не
    // случайной кашей: остановка обязана попасть в то же окно, что решил
    // сервер. Прятать их незачем - исход всё равно решает сервер.
    strips: slot.strips,
  };
}

/** Короткое описание для полки: ленты и таблицы туда не нужны. */
export function slotCard(slot) {
  return {
    id: slot.id,
    name: slot.name,
    tagline: slot.tagline,
    blurb: slot.blurb,
    theme: slot.theme,
    rtp: slot.rtp,
    cover: slot.art.cover,
    lines: LINES,
    freeSpins: slot.freeSpins,
    topJackpot: slot.jackpots[0].amount,
    minBet: slot.bets[0],
  };
}

/** Роняет старт, если математика хотя бы одного слота не сошлась. */
export function validateSlots() {
  return SLOTS.map((slot) => validateSlot(slot));
}

export { hitFrequency };

/** Отпечаток настроек: меняется вместе с лентами и выплатами. */
export function mathFingerprint() {
  return createHash('sha256')
    .update(JSON.stringify(SLOTS.map((s) => ({
      id: s.id, symbols: s.symbols, strips: s.strips, jackpots: s.jackpots,
    }))))
    .digest('hex').slice(0, 12);
}
