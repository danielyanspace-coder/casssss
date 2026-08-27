/**
 * ВИТРИНА ВЫПАДЕНИЙ
 *
 * Лента под шапкой, в которую въезжают выпадения других игроков.
 *
 * Показывает не одни крупные выигрыши. Лента из сплошных джекпотов читается
 * как реклама, а не как чужая игра: игрок сравнивает её со своими прокрутами
 * и видит, что у всех вокруг везёт, а у него нет. Поэтому семь записей из
 * десяти - обычные выпадения, и только три - крупные. Так витрина выглядит
 * живой лентой, а редкая дорогая находка в ней остаётся событием.
 *
 * ЧЕСТНОЕ ПРЕДУПРЕЖДЕНИЕ. Пока живых игроков нет, лента наполняется
 * выдуманными выпадениями с выдуманными никами - иначе она была бы пустой.
 * Это витрина, а не статистика: доля крупных выигрышей в ней НЕ равна их
 * доле в игре. Выключается одной переменной FEED_SYNTHETIC=0, и тогда в
 * ленту идут только настоящие прокруты настоящих игроков.
 * Подробности и что с этим делать перед запуском - в NEDOSTATOK.md.
 *
 * Генератор намеренно не трогает provably fair: здесь обычный Math.random,
 * потому что ни один результат отсюда не влияет на баланс игрока.
 */

import { CASES } from './cases.js';

/** С этого множителя выпадение считается крупным. */
export const FEED_MIN_MULTIPLIER = 3;

/**
 * И с этой суммы тоже. Без второго порога крупными считались бы выигрыши
 * вроде «95 ₽» из самых дешёвых кейсов: множитель у них честно больше трёх,
 * но рядом с сорока тысячами это выглядит недоразумением.
 */
export const FEED_MIN_VALUE = 500;

/**
 * Доля крупных выпадений в ленте.
 *
 * Остальное - обычные. Своё выпадение игрока в ленту попадает по настоящему
 * порогу, эта доля касается только выдуманных записей.
 */
export const FEED_BIG_SHARE = 0.3;

/**
 * Нижний порог для обычных выпадений: совсем мелочь вроде «3 ₽» в ленте
 * выглядит поломкой, а не скромным выигрышем.
 */
const PLAIN_MIN_VALUE = 40;

/** Сколько записей держим в памяти. */
const CAPACITY = 60;

/** Как часто добавляется выпадение. */
const INTERVAL_MS = 2000;

/** Выключатель выдуманных выпадений. */
export const FEED_SYNTHETIC = process.env.FEED_SYNTHETIC !== '0';

/**
 * Насколько сильно витрина смещена в сторону дорогих предметов.
 *
 * Внутри отобранных крупных выпадений веса берутся как probability^BIAS.
 * При BIAS = 1 это была бы настоящая пропорция между ними, при BIAS = 0 —
 * равномерный выбор. 0.45 заметно поднимает редкие предметы над просто
 * дорогими, но не превращает ленту в поток джекпотов.
 */
const BIAS = 0.45;

/* ---------- Пул выпадений ---------- */

/**
 * Плоский список «кейс + предмет» из всего, что дороже порога.
 * Строится один раз на старте: конфигурация кейсов при работе не меняется.
 */
const POOL = [];

/**
 * Пул обычных выпадений. Веса здесь настоящие: внутри обычных исходов
 * подкручивать нечего, их и так подавляющее большинство.
 */
const PLAIN_POOL = [];

for (const c of CASES) {
  for (const item of c.items) {
    if (item.kind !== 'item' || !item.value) continue;
    const multiplier = item.value / c.price;
    const entry = {
      caseId: c.id,
      caseName: c.name,
      name: item.name,
      tier: item.tier,
      value: item.value,
      multiplier,
    };

    if (multiplier >= FEED_MIN_MULTIPLIER && item.value >= FEED_MIN_VALUE) {
      POOL.push({ ...entry, weight: Math.pow(item.probability, BIAS) });
    } else if (item.value >= PLAIN_MIN_VALUE) {
      PLAIN_POOL.push({ ...entry, weight: item.probability });
    }
  }
}

function weightedPick(pool) {
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * total;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) return entry;
  }
  return pool[pool.length - 1];
}

function pickFromPool() {
  const big = PLAIN_POOL.length === 0 || Math.random() < FEED_BIG_SHARE;
  const pool = big && POOL.length ? POOL : PLAIN_POOL;
  return { ...weightedPick(pool), big: pool === POOL };
}

/* ---------- Ники ---------- */

/**
 * Выдуманные ники. Собираются из двух частей, чтобы список не выглядел
 * заученным, а повторы в ленте попадались редко.
 */
const NICK_HEAD = [
  'nova', 'lucky', 'shadow', 'astra', 'volt', 'delta', 'orbit', 'grim',
  'echo', 'frost', 'blaze', 'onyx', 'rune', 'vega', 'kilo', 'zen',
  'drift', 'crimson', 'quartz', 'pixel', 'raven', 'atlas', 'noir', 'mango',
  'сова', 'барс', 'вихрь', 'туман', 'кобальт', 'янтарь', 'сокол', 'кремень',
];

const NICK_TAIL = [
  '', '', '_', 'x', 'ka', 'off', 'ov', '77', '01', '_ru', 'pro', 'dev',
  '2k', 'ix', 'er', 'yy', '99', '13', '_tg', 'zz',
];

function randomNick() {
  const head = NICK_HEAD[Math.floor(Math.random() * NICK_HEAD.length)];
  const tail = NICK_TAIL[Math.floor(Math.random() * NICK_TAIL.length)];
  return head + tail;
}

/* ---------- Кольцевой буфер ---------- */

let nextId = 1;
const ring = [];

/**
 * Ключ с буквой впереди. Настоящие выпадения приходят из таблицы rounds
 * со своей нумерацией, и без префикса вторая запись «5» затирала бы на
 * клиенте первую.
 */
function synthetic() {
  const pick = pickFromPool();
  ring.unshift({
    id: `s${nextId++}`,
    nick: randomNick(),
    caseId: pick.caseId,
    caseName: pick.caseName,
    name: pick.name,
    tier: pick.tier,
    value: pick.value,
    multiplier: Number(pick.multiplier.toFixed(2)),
    at: Date.now(),
  });
  if (ring.length > CAPACITY) ring.length = CAPACITY;
}

/** Последние записи, свежие первыми. */
export function getFeed(limit = 24) {
  return ring.slice(0, Math.max(1, Math.min(limit, CAPACITY)));
}

let timer = null;

/** Запускает генератор. Без него лента живёт только на реальных выпадениях. */
export function startFeed() {
  if (timer || !FEED_SYNTHETIC || (POOL.length === 0 && PLAIN_POOL.length === 0)) return;
  // Лента не должна открываться пустой — набиваем историю сразу.
  for (let i = 0; i < 18; i++) synthetic();
  timer = setInterval(synthetic, INTERVAL_MS);
  timer.unref?.();
}

export function stopFeed() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const FEED_CONFIG = {
  minMultiplier: FEED_MIN_MULTIPLIER,
  minValue: FEED_MIN_VALUE,
  bigShare: FEED_BIG_SHARE,
  synthetic: FEED_SYNTHETIC,
  poolSize: POOL.length + PLAIN_POOL.length,
};
