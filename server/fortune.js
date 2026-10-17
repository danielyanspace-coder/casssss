/**
 * Колесо фортуны.
 *
 * Девять секторов присланной картинки, их порядок и веса. Здесь только
 * описание призов и выбор сектора по роллу - никаких денег: начисление живёт
 * в транзакции playFortuneSpin() в server/db.js, потому что всё, что меняет
 * баланс, обязано идти одной дверью.
 *
 * ПОРЯДОК СЕКТОРОВ НЕ ПРОИЗВОЛЕН. Он снят с картинки: центр колеса и радиус
 * найдены по золотому ободу, границы секторов - по светящимся разделителям
 * вдоль окружности. Их ровно девять, через сорок градусов, и сектор 0 лежит
 * под указателем на трёх часах. Дальше по часовой стрелке. Меняете картинку -
 * пересчитывайте здесь и в WHEEL в tools/banners.mjs, иначе колесо будет
 * останавливаться не на том, что показало окно выигрыша.
 *
 * ПОЧЕМУ ВЕСА ЗАДАНЫ РУКАМИ, А НЕ РЕШЕНЫ УРАВНЕНИЕМ. Кейсы - игра с
 * объявленной отдачей, и там вероятности решаются, чтобы матожидание сошлось
 * с ценой (см. server/cases.js). Колесо - подарок за пополнение, у него нет
 * цены прокрута, и сходиться не с чем. Поэтому веса здесь - это решение о
 * стоимости акции, и оно принимается человеком, а не решателем.
 */

/** Сколько градусов занимает один сектор и где начинается нулевой. */
export const SEGMENT_DEG = 40;
export const SEGMENTS_START_DEG = -7;

/**
 * Секторы по часовой стрелке от указателя.
 *
 * weight - доля в процентах, сумма обязана быть ровно 100: это проверяет
 * validateFortune() при старте приложения.
 */
export const FORTUNE_SEGMENTS = [
  { index: 0, type: 'case',    weight: 7.5,  label: 'Кейс в подарок' },
  { index: 1, type: 'case',    weight: 7.5,  label: 'Кейс в подарок' },
  { index: 2, type: 'case',    weight: 7.5,  label: 'Кейс в подарок' },
  { index: 3, type: 'case',    weight: 7.5,  label: 'Кейс в подарок' },
  { index: 4, type: 'x2',      weight: 20,   label: 'Удвоитель' },
  { index: 5, type: 'percent', weight: 33,   label: 'Процент к пополнению' },
  { index: 6, type: 'cash',    weight: 2,    label: 'Деньги на счёт' },
  { index: 7, type: 'voucher', weight: 7.5,  label: 'Ваучер' },
  { index: 8, type: 'voucher', weight: 7.5,  label: 'Ваучер' },
];

/* ---------- Номиналы призов ---------- */

/** Процент к следующему пополнению: 50..150 шагом 10. */
export const PERCENT_MIN = 50;
export const PERCENT_MAX = 150;
export const PERCENT_STEP = 10;

/** Ваучер деньгами: 500..1500 шагом 100. */
export const VOUCHER_MIN = 500;
export const VOUCHER_MAX = 1500;
export const VOUCHER_STEP = 100;

/** Единственный денежный приз, самый редкий. */
export const CASH_PRIZE = 2000;

/** Подарочный кейс берётся только из недорогих: дороже отдавать не за что. */
export const GIFT_CASE_MAX_PRICE = 1000;

/**
 * Сколько прокрутов даёт одно пополнение и как часто ими можно пользоваться.
 * Раз в сутки - это ровно двадцать четыре часа от прошлого прокрута, а не
 * календарный день: календарь зависит от часового пояса, и его легко обойти,
 * поменяв пояс на телефоне.
 */
export const SPINS_PER_CYCLE = 5;
export const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Пополнение, открывающее цикл. */
export const MIN_DEPOSIT = 500;

/**
 * Сектор по роллу [0, 1).
 *
 * Идём по списку и вычитаем вес: сектор тот, на котором накопленная сумма
 * впервые обгоняет ролл. Последний возвращается как запас на случай, если
 * из-за двоичной арифметики сумма окажется чуть меньше ролла.
 */
export function pickSegment(roll) {
  let acc = 0;
  for (const seg of FORTUNE_SEGMENTS) {
    acc += seg.weight / 100;
    if (roll < acc) return seg;
  }
  return FORTUNE_SEGMENTS[FORTUNE_SEGMENTS.length - 1];
}

/** Число из диапазона с шагом по второму роллу того же прокрута. */
export function pickAmount(roll, min, max, step) {
  const steps = Math.floor((max - min) / step) + 1;
  return min + Math.min(steps - 1, Math.floor(roll * steps)) * step;
}

/**
 * Сумма весов обязана быть ровно 100.
 *
 * Роняем старт, а не молча выравниваем: сдвинутый вес - это сдвинутая
 * стоимость акции, и узнать о нём надо при выкате, а не по кассе через месяц.
 */
export function validateFortune() {
  const sum = FORTUNE_SEGMENTS.reduce((a, s) => a + s.weight, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`Колесо фортуны: сумма весов ${sum}, а должна быть 100`);
  }
  const seen = new Set();
  for (const s of FORTUNE_SEGMENTS) {
    if (seen.has(s.index)) throw new Error(`Колесо фортуны: сектор ${s.index} задан дважды`);
    seen.add(s.index);
  }
  if (seen.size * SEGMENT_DEG !== 360) {
    throw new Error(`Колесо фортуны: ${seen.size} секторов по ${SEGMENT_DEG} градусов - не круг`);
  }
}
