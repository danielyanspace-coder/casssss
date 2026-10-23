/**
 * «Колесо удачи» в Free Money: прокрут за промокод из Telegram-бота.
 *
 * Не путать с Lucky Fortune (fortune.js): то колесо даёт пять прокрутов за
 * пополнение и нарисовано присланной картинкой. Это - рисованное, и крутится
 * только промокодом типа 'wheel': один код - один прокрут, сколько раз один
 * игрок может ввести один код, решает сам промокод (per_user_limit).
 *
 * ПРИЗЫ. Либо кейс до 150 ₽ (подарочный ваучер: выигрыш с него на бонусный
 * счёт), либо процент к следующему пополнению с потолком (тот же слот, что у
 * промокода и Lucky Fortune: складывать их нельзя, вдвоём выше сотни).
 *
 * УГОЛ РАВЕН ВЕРОЯТНОСТИ. Сектор занимает на колесе ровно свою долю круга, как
 * у рулетки (CLAUDE.md, «Рулетка»). Равные сектора с разными весами - это
 * колесо, которое врёт глазами: игрок видит «+30%» шириной с «Пыль» и
 * читает, что шансы равные. Поэтому редкий приз на колесе узкий.
 *
 * СТОИМОСТЬ АКЦИИ. Веса заданы руками, как у Lucky Fortune: у колеса нет
 * цены прокрута, сходиться не с чем, и это решение о бюджете акции.
 * Ожидаемая ценность прокрута - около 35 ₽ кейсами и процент, который
 * сработает только при пополнении (то есть оплачивается доходом с него).
 */

/** Потолок бонуса по проценту с колеса, рублей. */
export const WHEEL_PCT_CAP = 5000;
/** С какого пополнения срабатывает процент с колеса. */
export const WHEEL_PCT_MIN_DEPOSIT = 100;

/*
 * Сектора по часовой стрелке от верхней точки. Цвета - для отрисовки, текст -
 * подпись на секторе и в окне выигрыша.
 */
export const WHEEL_SECTORS = [
  { id: 'dust',  type: 'case', caseId: 'dust_25',    label: 'Пыль',   weight: 24, color: '#3a2a55' },
  { id: 'p10',   type: 'pct',  pct: 10,              label: '+10%',   weight: 15, color: '#1f6b4f' },
  { id: 'spark', type: 'case', caseId: 'spark_50',   label: 'Искра',  weight: 19, color: '#5b2a7a' },
  { id: 'p20',   type: 'pct',  pct: 20,              label: '+20%',   weight: 9,  color: '#21805c' },
  { id: 'copper',type: 'case', caseId: 'copper_75',  label: 'Медяк',  weight: 14, color: '#7a3b2a' },
  { id: 'warm',  type: 'case', caseId: 'warmup_100', label: 'Разогрев', weight: 9, color: '#8a2a3b' },
  { id: 'p30',   type: 'pct',  pct: 30,              label: '+30%',   weight: 4,  color: '#2a9a6c' },
  { id: 'alley', type: 'case', caseId: 'alley_150',  label: 'Подворотня', weight: 6, color: '#9a6a1a' },
];

const TOTAL = WHEEL_SECTORS.reduce((s, x) => s + x.weight, 0);

/** Сектор по роллу из [0, 1). Порядок секторов - порядок на колесе. */
export function pickWheelSector(roll) {
  let acc = 0;
  for (const s of WHEEL_SECTORS) {
    acc += s.weight / TOTAL;
    if (roll < acc) return s;
  }
  return WHEEL_SECTORS[WHEEL_SECTORS.length - 1];
}

/** Описание колеса для клиента: доли круга считаются здесь, один раз. */
export function wheelConfig() {
  let from = 0;
  return {
    pctCap: WHEEL_PCT_CAP,
    pctMinDeposit: WHEEL_PCT_MIN_DEPOSIT,
    sectors: WHEEL_SECTORS.map((s) => {
      const share = s.weight / TOTAL;
      const out = { id: s.id, type: s.type, label: s.label, color: s.color,
        caseId: s.caseId || null, pct: s.pct || null, from, share };
      from += share;
      return out;
    }),
  };
}
