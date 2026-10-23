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

import { readFileSync } from 'node:fs';

import { THEMES } from './themes.js';
import { skinsForCase } from './card-skins.js';

/**
 * Разбор присланных обложек, посчитанный при их подготовке
 * (см. tools/case-covers.mjs).
 *
 * aspect нужен вёрстке, чтобы задать высоту слота под арт: она разная у
 * вертикальных городских, горизонтальных престольных и почти квадратных
 * обложек ценовых полок.
 *
 * glow - два тона самой обложки. Ими подсвечивается воздух вокруг неё, чтобы
 * свечение шло от картинки, а не от категории.
 */
const ART = JSON.parse(
  readFileSync(new URL('../public/assets/covers/art.json', import.meta.url), 'utf8')
);

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
 * Раскладка двадцати ступеней по семи уровням редкости.
 *
 * Сумма - ровно 20. Наверху три золотых и пять оранжевых: цветной хвост должен
 * быть заметным, иначе лента снова читается как сплошная серая.
 */
const TIER_SPAN = [1, 2, 3, 3, 3, 5, 3];

const TIER_BY_INDEX = TIER_SPAN.flatMap((count, tier) =>
  Array.from({ length: count }, () => TIER_IDS[tier]));

/**
 * Округление номинала до «человеческого» шага.
 *
 * Цена кейса остаётся маркетинговой (999), а вот выигрыш вида 24 975 читается
 * плохо. Шаг растёт вместе с суммой, поэтому мелочь не схлопывается в ноль,
 * а крупные суммы не тянут за собой хвост из значащих цифр.
 *
 * На RTP это не влияет: номиналы округляются ДО того, как решаются
 * вероятности, и решатель сводит матожидание к price * rtp уже по округлённым
 * числам. Погрешность уходит в вероятность филлера, а не в отдачу.
 */
function niceStep(v) {
  // Шаг в единицу до полусотни: на дешёвых кейсах нижние ступени лестницы
  // расходятся всего на пару единиц и при шаге 5 слипались бы в один номинал.
  return v < 50 ? 1
       : v < 100 ? 5
       : v < 1_000 ? 10
       : v < 10_000 ? 50
       : v < 100_000 ? 500
       : v < 1_000_000 ? 1_000
       : 10_000;
}

function roundNice(v) {
  const step = niceStep(v);
  return Math.max(step, Math.round(v / step) * step);
}

/**
 * Верхний номинал округляется ВНИЗ: карточка обещает «макс 12x», и выпасть
 * больше обещанного он не должен, даже на величину шага округления.
 */
function roundNiceDown(v) {
  const step = niceStep(v);
  return Math.max(step, Math.floor(v / step) * step);
}

/**
 * ЛЕСТНИЦА НОМИНАЛОВ: филлер, нижняя полоса, полоса заметных выигрышей и
 * хвост. Всего 20 ступеней.
 *
 * ЧТО ЗДЕСЬ ВАЖНО. Отдача задана точно (0.70) и переложить её больше, чем
 * есть, нельзя: средний прокрут возвращает 70 копеек с рубля при любой
 * раскладке. Но одну и ту же отдачу можно разложить очень по-разному.
 *
 * ИСТОРИЯ, ЧТОБЫ НЕ ПОВТОРЯТЬ. Сначала раскладка была хвостовой: половина
 * прокрутов возвращала меньше четверти цены, депозит уходил обвалом. Потом
 * середину собрали в одну плотную полосу 0.75-1.40 цены, и вышло обратное:
 * две трети прокрутов возвращали «почти всё», а дороже 1.4x не выпадало
 * практически никогда - в кейсе за 7 499 раз на 450 открытий. Заказчик
 * открыл его сорок раз, ни разу не увидел больше 8 500 и описал это точно:
 * «чисто высасывает баланс». Проигрыш шёл ровно, без единого шанса
 * отыграться, и именно это выгоняет игрока, а не сам проигрыш.
 *
 * СЕЙЧАС у отыгрыша есть своя полоса: 1.6-3.2 цены забирают заданную долю
 * матожидания (midShare профиля), и 2x выпадает примерно раз в двадцать
 * открытий. Сценарий «проиграл две цены, следующий прокрут вернул две с
 * половиной» перестал быть чудом. Деньги на это взяты из нижней полосы: она
 * шире (0.40-1.35) и легче.
 *
 * ВАЖНО ДЛЯ ПРАВОК: среднее число прокрутов до нуля зависит ТОЛЬКО от отдачи
 * (банкролл / (1 - rtp)) и формой лестницы не меняется. Форма меняет
 * ощущение и разброс сессий. Хотите действительно больше прокрутов на
 * депозит - это правка rtp, то есть решение о марже.
 */

/** Дешёвая ступень. Её вероятность решается уравнением, а не задаётся. */
const LADDER_FILLER = 0.20;

/**
 * Нижняя полоса: семь ступеней от 0.40 до 1.35 цены. Веса - форма горба
 * внутри полосы, а не вероятности: полоса забирает долю матожидания профиля
 * (bandShare), и вероятность получается делением.
 */
const BAND_STEPS   = [0.40, 0.55, 0.70, 0.85, 1.00, 1.15, 1.35];
const BAND_WEIGHTS = [0.80, 1.05, 1.25, 1.30, 1.15, 0.80, 0.50];

/**
 * Полоса заметных выигрышей: ради неё и переделана лестница (см. шапку).
 * Задана так же, долей матожидания (midShare), веса - форма внутри.
 */
const MID_STEPS   = [1.60, 2.00, 2.50, 3.20];
const MID_WEIGHTS = [1.00, 0.85, 0.62, 0.45];

/**
 * Хвост: от последней ступени полосы до потолка, геометрически. Потолки у
 * кейсов разные, от 60 до 500, поэтому хвост растягивается, а не задаётся
 * таблицей. Потолок добавляется двадцатым.
 */
const TAIL_FROM = MID_STEPS[MID_STEPS.length - 1];
const TAIL_STEPS = 7;

/** Полная лестница кейса без потолка: 19 ступеней. */
function ladderFor(maxMultiplier, filler = LADDER_FILLER) {
  const ratio = Math.pow(maxMultiplier / TAIL_FROM, 1 / (TAIL_STEPS + 1));
  const tail = [];
  for (let i = 1; i <= TAIL_STEPS; i++) tail.push(TAIL_FROM * Math.pow(ratio, i));
  return [filler, ...BAND_STEPS, ...MID_STEPS, ...tail];
}

/**
 * Отдача прокрута внутри серии фриспинов: на FS_RTP_LIFT выше отдачи кейса.
 * Серия - событие, и в ней крупное выпадает чаще (таблица - в buildCase).
 * Цена пачек считается от этой же отдачи, см. FREESPIN_PACKS.
 */
const FS_RTP_LIFT = 0.10;
export const fsRtpFor = (rtp) => rtp + FS_RTP_LIFT;

const BAND_COUNT = BAND_STEPS.length;
const MID_COUNT = MID_STEPS.length;

/*
 * ВЕСА ХВОСТА - ломаный степенной закон w ~ m^(-alpha) до перелома и
 * m^(-beta) после. Крутой показатель внизу хвоста держит 5x редким
 * событием, пологий наверху не даёт обещанному потолку исчезнуть: карточка
 * обещает 360x, и он обязан хоть иногда случаться.
 */
const WEIGHT_BREAK = 8;

/**
 * Профили разброса.
 *
 * bandShare и midShare - ДОЛИ МАТОЖИДАНИЯ ПРЕДМЕТОВ, уходящие в нижнюю и
 * среднюю полосу. Именно доли матожидания, а не вероятности: так полосы
 * задаются тем же способом, что и плюшки, и сами подстраиваются под кейс. В
 * бонусном кейсе плюшки съедают четверть матожидания, и полосы ужимаются
 * ровно на эту четверть, а решатель всё равно сходится.
 *
 * Хвост забирает остаток, филлер - остаток вероятности. У soft больше всего
 * спокойной нижней полосы, у wild - хвоста.
 */
const PROFILES = {
  soft:   { bandShare: 0.55, midShare: 0.22, alpha: 1.60, beta: 0.70 },
  normal: { bandShare: 0.52, midShare: 0.22, alpha: 1.50, beta: 0.64 },
  risky:  { bandShare: 0.44, midShare: 0.22, alpha: 1.35, beta: 0.58 },
  wild:   { bandShare: 0.36, midShare: 0.22, alpha: 1.20, beta: 0.52 },
  // Подарок «Начало»: нижняя ступень поднята до 0.30, и она сама забирает
  // заметную долю матожидания - полосам остаётся меньше.
  gift:   { bandShare: 0.46, midShare: 0.16, alpha: 1.70, beta: 0.72 },
};

/** Вес ступени хвоста по ломаному закону. Непрерывен в точке перелома. */
function stepWeight(m, profile) {
  if (m <= WEIGHT_BREAK) return Math.pow(m, -profile.alpha);
  return Math.pow(WEIGHT_BREAK, -profile.alpha)
       * Math.pow(m / WEIGHT_BREAK, -profile.beta);
}

export const CATEGORIES = [
  { id: 'start', name: 'Старт', description: 'Дешёвые кейсы с мягким разбросом' },
  { id: 'classic', name: 'Классика', description: 'Средние ставки, сбалансированный разброс' },
  { id: 'themed', name: 'Тематические', description: 'Коллекции на любой вкус' },
  { id: 'premium', name: 'Премиум', description: 'Дорогие кейсы, лучший RTP' },
  { id: 'elite', name: 'Элита', description: 'Самые крупные ставки в игре' },
  { id: 'risk', name: 'Риск', description: 'Редкие, но огромные множители' },
  { id: 'bonus', name: 'Бонусные', description: 'С плюшками: x2, подарки, бонусы' },
  { id: 'country', name: 'Направления', description: 'Города, куда хочется попасть' },
  { id: 'got', name: 'Игра престолов', description: 'Семь Королевств и всё, что в них' },
  { id: 'season', name: 'Сезонные', description: 'Открыты ограниченное время' },
];

/* ============================================================
   ОПИСАНИЕ КЕЙСОВ
   ============================================================ */

/**
 * Плюшки:
 *   { type: 'credits', amount }    - мгновенный бонус на баланс
 *   { type: 'x2' }                 - следующее открытие ЭТОГО кейса удваивает выплату
 *   { type: 'voucher', caseId }    - бесплатное открытие указанного кейса
 * share - доля матожидания кейса, которую забирает плюшка.
 */
const SPECS = [
  /*
   * «Начало» - бесплатный кейс. Открывается только подарком: за первое
   * пополнение от START_CASE_MIN_DEPOSIT и за каждые START_CASE_TURNOVER
   * рублей своих ставок (server/db.js, блок «КЕЙС НАЧАЛО»).
   *
   * Цена 100 - номинал для решателя, игрок её не платит. От неё считаются
   * ступени: филлер поднят до 0.30 (30 ₽), полоса 40-135 ₽, заметные
   * 160-320 ₽, потолок 100x - 10 000 ₽ (так просил заказчик: «в основном
   * 30-200, максимум 10 000»). Отдача 0.6: подарок стоит кассе 60 ₽ в
   * среднем, и выигрыш с него приходит на бонусный счёт с отыгрышем и
   * потолком вывода, как любой подарок.
   */
  ['start_free', 'Начало', 'Первый кейс - за наш счёт', 'start', 100, 0.6, 100, 'gift', 'pirate', [],
    { art: 'nachalo', free: true, filler: 0.30 }],

  // ── Старт ───────────────────────────────────────────────
  ['dust_25', 'Пыль', 'Дешевле некуда', 'start', 24, 0.7, 60, 'soft', 'forge', [],
    { art: 'dust' }],
  ['spark_50', 'Искра', 'С чего-то надо начинать', 'start', 49, 0.7, 90, 'soft', 'neon', [],
    { art: 'spark' }],
  ['copper_75', 'Медяк', 'Мелочь, а приятно', 'start', 74, 0.7, 90, 'soft', 'steampunk', [],
    { art: 'copper' }],
  ['warmup_100', 'Разогрев', 'Тот самый кейс на сотку', 'start', 99, 0.7, 130, 'soft', 'casino', [],
    { art: 'warmup' }],
  ['alley_150', 'Подворотня', 'Что-то да найдётся', 'start', 149, 0.7, 120, 'soft', 'street', [],
    { art: 'alley' }],
  ['frost_300', 'Мерзлота', 'Холодный расчёт', 'start', 299, 0.7, 130, 'soft', 'arctic', [],
    { art: 'frost' }],
  ['rune_250', 'Первая руна', 'Начало пути', 'start', 249, 0.7, 130, 'soft', 'rune', [],
    { art: 'rune' }],

  // ── Классика ────────────────────────────────────────────
  ['deck_400', 'Колода', 'Раздача пошла', 'classic', 399, 0.7, 150, 'normal', 'casino', [],
    { art: 'deck' }],
  ['neon_500', 'Неоновый', 'Свет большого города', 'classic', 499, 0.7, 150, 'normal', 'neon', [],
    { art: 'neon' }],
  ['mirage_600', 'Мираж', 'Не всё то золото', 'classic', 599, 0.7, 170, 'normal', 'desert', [],
    { art: 'mirage' }],
  ['pit_800', 'Пит-стоп', 'Три секунды на всё', 'classic', 799, 0.7, 170, 'normal', 'racing', [],
    { art: 'pit' }],
  ['vault_1000', 'Сейф', 'Что внутри - то ваше', 'classic', 999, 0.7, 180,
    'normal', 'vault', [], { art: 'vault' }],
  ['chapito_1200', 'Шапито', 'Представление начинается', 'classic', 1199, 0.7, 180,
    'normal', 'circus', [], { art: 'chapito' }],
  ['blade_1500', 'Путь меча', 'Одно движение', 'classic', 1499, 0.7, 190,
    'normal', 'samurai', [], { art: 'blade' }],
  ['board_1800', 'Абордаж', 'На абордаж!', 'classic', 1799, 0.7, 190,
    'normal', 'pirate', [], { art: 'board' }],
  ['temple_2000', 'Зелёная крепость', 'Львы своё не отдают', 'classic', 1999, 0.7, 190,
    'normal', 'fortress', [], { art: 'fortress' }],
  ['noir_2500', 'Ночное дело', 'Без лишних свидетелей', 'classic', 2499, 0.7, 190,
    'normal', 'noir', [], { art: 'noir' }],

  // ── Тематические ────────────────────────────────────────
  ['hack_3000', 'Взлом', 'Доступ разрешён', 'themed', 2999, 0.7, 190,
    'normal', 'cyber', [], { art: 'hack' }],
  ['cut_3500', 'Огранка', 'Каждая грань считается', 'themed', 3499, 0.7, 200,
    'normal', 'crystal', [], { art: 'cut' }],
  ['steam_4000', 'Паровая', 'Механика не подводит', 'themed', 3999, 0.7, 200,
    'normal', 'steampunk', [], { art: 'steam' }],
  ['mariana_6000', 'Марианская', 'Одиннадцать километров вниз', 'themed', 5999, 0.7, 210,
    'normal', 'deepsea', [], { art: 'mariana' }],
  ['shogun_8000', 'Сёгун', 'Власть в одних руках', 'themed', 7999, 0.7, 210,
    'normal', 'samurai', [], { art: 'shogun' }],
  ['crypt_12000', 'Склеп', 'Не буди спящих', 'themed', 11999, 0.7, 225,
    'normal', 'vampire', [], { art: 'crypt' }],
  ['quarantine_18000', 'Карантин', 'Вход только в костюме', 'themed', 17999, 0.7, 240,
    'normal', 'toxic', [], { art: 'quarantine' }],
  ['ash_25000', 'Пепел', 'Из пепла - заново', 'themed', 24999, 0.7, 260,
    'normal', 'phoenix', [], { art: 'ash' }],
  ['hoard_35000', 'Сокровищница', 'Дракон не делится', 'themed', 34999, 0.7, 280,
    'normal', 'dragon', [], { art: 'hoard' }],
  ['diamond_60000', 'Алмазный фонд', 'Только чистая вода', 'themed', 59999, 0.7, 320,
    'normal', 'crystal', [], { art: 'diamond' }],

  // ── Премиум ─────────────────────────────────────────────
  ['regalia_5000', 'Регалии', 'По праву рождения', 'premium', 4999, 0.7, 210,
    'normal', 'royal', [], { art: 'regalia' }],
  ['tomb_7500', 'Гробница', 'Проклятие прилагается', 'premium', 7499, 0.7, 225,
    'normal', 'pharaoh', [], { art: 'tomb' }],
  ['orbit_10000', 'Орбита', 'Выше только вакуум', 'premium', 9999, 0.7, 240,
    'normal', 'orbit', [], { art: 'orbit' }],
  ['lair_15000', 'Логово', 'Тише. Он спит', 'premium', 14999, 0.7, 270,
    'normal', 'dragon', [], { art: 'lair' }],
  ['depo_20000', 'Депозитарий', 'Почти 800 000 за одно открытие', 'premium', 19999, 0.7, 320,
    'normal', 'vault', [], { art: 'depo' }],

  // ── Элита ───────────────────────────────────────────────
  ['galaxy_30000', 'Галактика', 'Масштаб другой', 'elite', 29999, 0.7, 300,
    'normal', 'galaxy', [], { art: 'galaxy' }],
  ['rebirth_40000', 'Возрождение', 'Всегда возвращается', 'elite', 39999, 0.7, 320,
    'normal', 'phoenix', [], { art: 'rebirth' }],
  ['abyss_50000', 'Бездна', 'Смотрит в ответ', 'elite', 49999, 0.7, 340,
    'normal', 'deepsea', [], { art: 'abyss' }],
  ['empire_75000', 'Империя', 'Всё и сразу', 'elite', 74999, 0.7, 350,
    'normal', 'royal', [], { art: 'empire' }],
  ['apex_100000', 'Вершина', 'Дороже в игре нет', 'elite', 99999, 0.7, 360,
    'normal', 'galaxy', [], { art: 'apex' }],

  // ── Риск ────────────────────────────────────────────────
  ['allin_500', 'Ва-банк', 'Чаще пусто, реже густо', 'risk', 499, 0.7, 320, 'risky', 'casino', [],
    { art: 'allin' }],
  ['redonly_1000', 'Красное или ничего', 'Полумер не бывает', 'risk', 999, 0.7, 360,
    'risky', 'casino', [], { art: 'redonly' }],
  ['crater_2500', 'Жерло', 'Горячо во всех смыслах', 'risk', 2499, 0.7, 360,
    'risky', 'volcano', [], { art: 'crater' }],
  ['reactor_5000', 'Реактор', 'Стержни на пределе', 'risk', 4999, 0.7, 400,
    'wild', 'toxic', [], { art: 'reactor' }],
  ['shadow_10000', 'Тень', 'Никто не узнает', 'risk', 9999, 0.7, 450,
    'wild', 'shadow', [], { art: 'shadow' }],
  ['midnight_20000', 'Полночь', 'Ставки после заката', 'risk', 19999, 0.7, 450,
    'wild', 'vampire', [], { art: 'midnight' }],
  ['nopoint_50000', 'Точка невозврата', 'Обратно дороги нет', 'risk', 49999, 0.7, 500,
    'wild', 'galaxy', [], { art: 'nopoint' }],

  // ── Бонусные (с плюшками) ───────────────────────────────
  ['lucky_200', 'Счастливый', 'Иногда просто везёт', 'bonus', 199, 0.7, 120, 'soft', 'casino',
    [{ type: 'credits', amount: 1500, share: 0.07 }], { art: 'lucky' }],
  ['double_500', 'Удвоитель', 'Следующий прокрут - вдвойне', 'bonus', 499, 0.7, 150, 'normal', 'neon',
    [{ type: 'x2', share: 0.09 }], { art: 'double' }],
  ['gift_1000', 'Подарочный', 'С подарком внутри', 'bonus', 999, 0.7, 170, 'normal', 'circus',
    [{ type: 'voucher', caseId: 'neon_500', share: 0.06 }],
    { art: 'gift' }],
  ['chain_2000', 'Цепная реакция', 'Одно тянет другое', 'bonus', 1999, 0.7, 190, 'normal', 'toxic',
    [{ type: 'x2', share: 0.07 }, { type: 'voucher', caseId: 'vault_1000', share: 0.05 }],
    { art: 'chain' }],
  ['jackpot_5000', 'Джекпот', 'Или пусто, или очень', 'bonus', 4999, 0.7, 225, 'normal', 'casino',
    [{ type: 'credits', amount: 120000, share: 0.08 }],
    { art: 'jackpot' }],
  ['ticket_7000', 'Золотой билет', 'Проход в дорогое', 'bonus', 6999, 0.7, 225, 'normal', 'circus',
    [{ type: 'voucher', caseId: 'steam_4000', share: 0.07 }],
    { art: 'ticket' }],
  ['stake_10000', 'Атом', 'Ядро удваивает следующий прокрут', 'bonus', 9999, 0.7, 240,
    'normal', 'atom', [{ type: 'x2', share: 0.1 }], { art: 'atom' }],
  ['treasure_15000', 'Клад', 'Кто нашёл - того и есть', 'bonus', 14999, 0.7, 260, 'normal', 'pirate',
    [{ type: 'credits', amount: 400000, share: 0.07 }],
    { art: 'treasure' }],
  ['megabox_25000', 'Мегабокс', 'Подарок и удвоение', 'bonus', 24999, 0.7, 280, 'normal', 'royal',
    [{ type: 'voucher', caseId: 'crypt_12000', share: 0.06 }, { type: 'x2', share: 0.06 }],
    { art: 'megabox' }],
  ['infinity_50000', 'Бесконечность', 'Не заканчивается', 'bonus', 49999, 0.7, 320, 'normal', 'galaxy',
    [{ type: 'x2', share: 0.08 }, { type: 'credits', amount: 1200009, share: 0.06 }],
    { art: 'infinity' }],
  ['legend_100000', 'Легенда', 'Вершина коллекции', 'bonus', 99999, 0.7, 360, 'normal', 'dragon',
    [{ type: 'voucher', caseId: 'abyss_50000', share: 0.07 }, { type: 'x2', share: 0.06 }],
    { art: 'legend' }],
  // ── Сезонные ────────────────────────────────────────────
  ['porsche_999', 'Porsche 911', 'Сезонный кейс - с 1 октября', 'season',
    999, 0.7, 180, 'normal', 'garage', [], {
      availableFrom: '2026-10-01T00:00:00Z',
      art: 'porsche',
      /**
       * Витринный предмет. Он крутится в ленте и виден в составе кейса, но
       * НЕ входит в таблицу розыгрыша: сумма его вероятностей не участвует
       * в решателе, и выпасть он не может.
       *
       * Вероятность здесь намеренно не указана. Написать рядом с призом
       * число, которое не соответствует механике, - значит обмануть игрока,
       * а весь остальной проект построен на обратном.
       */
      showcase: {
        name: 'Porsche 911 (992.2)',
        tier: 'unique',
      },
    }],

  ['sultan_40000', 'Три желания', 'Джинн не обманет', 'bonus', 39999, 0.7, 300, 'normal', 'desert',
    [{ type: 'voucher', caseId: 'lair_15000', share: 0.06 }, { type: 'credits', amount: 900000, share: 0.05 }],
    { art: 'sultan' }],

  ['rolex_6000', 'Самородок', 'Жила уходит вглубь', 'premium', 5999, 0.7, 300,
    'normal', 'goldmine', [],
    { art: 'nugget', jackpot: { name: 'Самородок «Золотой великан»', value: 2999500, share: 0.02 } }],

  // ── Направления ─────────────────────────────────────────
  ['santorini_999', 'Санторини', 'Белое на синем', 'country', 999, 0.7, 180, 'soft', 'santorini',
    [], { art: 'santorini' }],
  ['rio_1500', 'Рио-де-Жанейро', 'Карнавал не заканчивается', 'country', 1499, 0.7, 220,
    'normal', 'rio', [], { art: 'rio' }],
  ['monaco_2500', 'Монако', 'Казино, яхты, Гран-при', 'country', 2499, 0.7, 260, 'normal', 'monaco',
    [], { art: 'monaco' }],
  ['vegas_3000', 'Лас-Вегас', 'Город, который не спит', 'country', 2999, 0.7, 280, 'normal', 'vegas',
    [{ type: 'freespins', count: 7, share: 0.09 }], { art: 'vegas' }],
  ['dubai_5000', 'Дубай', 'Золото и небоскрёбы', 'country', 4999, 0.7, 300, 'normal', 'dubai',
    [{ type: 'freespins', count: 10, share: 0.12 }], { art: 'dubai' }],
  ['singapore_8000', 'Сингапур', 'Порядок и роскошь', 'country', 7999, 0.7, 340,
    'normal', 'singapore', [{ type: 'freespins', count: 12, share: 0.10 }],
    { art: 'singapore' }],

  // ── Игра престолов ──────────────────────────────────────
  // Цены держатся в узком диапазоне намеренно: это одна коллекция, и разница
  // между кейсами здесь в разбросе и плюшках, а не в стоимости входа.
  ['winterfell_699', 'Винтерфелл', 'Зима уже пришла', 'got', 699, 0.7, 180,
    'normal', 'winterfell', [{ type: 'x2', share: 0.07 }], { art: 'winterfell' }],
  ['braavos_999', 'Браавос', 'Валар моргулис', 'got', 999, 0.7, 200,
    'normal', 'braavos', [{ type: 'credits', amount: 25000, share: 0.07 }],
    { art: 'braavos' }],
  ['highgarden_1299', 'Хай Гарден', 'Золотая роза Простора', 'got', 1299, 0.7, 220,
    'normal', 'highgarden', [{ type: 'voucher', caseId: 'winterfell_699', share: 0.06 }],
    { art: 'highgarden' }],
  ['westeros_1699', 'Вестерос', 'Игра, где либо побеждают, либо умирают', 'got', 1699, 0.7, 260,
    'risky', 'westeros', [{ type: 'voucher', caseId: 'braavos_999', share: 0.06 },
                          { type: 'x2', share: 0.06 }], { art: 'westeros' }],
];

/* ============================================================
   СБОРКА
   ============================================================ */

const PERK_LABELS = {
  x2: 'Удвоитель ×2',
  voucher: 'Подарочный кейс',
  credits: 'Бонус на баланс',
  freespins: 'Фриспины',
};

/**
 * Собирает кейс: считает цены предметов, ценность и вероятность плюшек,
 * затем решает вероятность филлера так, чтобы EV точно равнялось price * rtp.
 *
 * Работа идёт сразу в вероятностях, а не в весах: вероятность плюшки жёстко
 * задана её долей в матожидании, и подмешивать её к весовой схеме было бы
 * лишним кругом вычислений.
 */
/** Сколько фриспинов даёт кейс и какую долю матожидания они забирают. */
function freeSpinSpec(price) {
  if (price < 500) return { type: 'freespins', count: 5, share: 0.07 };
  if (price < 5000) return { type: 'freespins', count: 10, share: 0.08 };
  if (price < 30000) return { type: 'freespins', count: 15, share: 0.09 };
  return { type: 'freespins', count: 20, share: 0.10 };
}

function buildCase(spec, builtById) {
  const [id, name, tagline, category, price, rtp, maxMultiplier, profileId, themeId,
         declaredPerks = [], extra = {}] = spec;

  // Фриспины добавляются каждому кейсу, если не заданы в описании явно.
  // Бесплатному кейсу - нет: его открывают только подарком, а серия с
  // подарка была бы подарком сверх объявленного.
  const perkSpecs = extra.free || declaredPerks.some((p) => p.type === 'freespins')
    ? declaredPerks
    : [...declaredPerks, freeSpinSpec(price)];

  const profile = PROFILES[profileId];
  const theme = THEMES[themeId];
  const target = price * rtp;

  const ladder = ladderFor(maxMultiplier, extra.filler);
  const values = [
    ...ladder.map((m) => roundNice(price * m)),
    roundNiceDown(price * maxMultiplier),
  ];

  // После округления соседние ступени могут совпасть - тогда в таблице
  // оказались бы два предмета с одинаковой ценой. Разводим их на шаг.
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) values[i] = values[i - 1] + niceStep(values[i - 1]);
  }

  // Плюшки, не выдающие единицы сразу (x2 и подарок), забирают долю
  // матожидания в обход мгновенной выплаты - отсюда и считается ожидаемая
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
    } else if (p.type === 'freespins') {
      /*
       * Фриспин крутит свою таблицу (fsProbability, см. ниже), и её
       * матожидание решается точно: price * fsRtpFor(rtp). Серия из N
       * прокрутов стоит N таких матожиданий, вероятность плюшки получается из
       * доли: p = share·target/evValue. Ряд довесков сходится, так как
       * ожидаемое число новых фриспинов на прокрут меньше единицы.
       */
      evValue = p.count * price * fsRtpFor(rtp);
      label = `${p.count} фриспинов`;
    } else if (p.type === 'voucher') {
      const targetCase = builtById.get(p.caseId);
      if (!targetCase) {
        throw new Error(`[${id}] подарочный кейс ${p.caseId} не найден или собран позже`);
      }
      // Бесплатное открытие даёт игроку ВСЁ, что даёт тот кейс, - полное EV.
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
          : p.type === 'freespins' ? { type: 'freespins', caseId: id, count: p.count }
          : { type: 'x2', caseId: id },
      perkLabel: PERK_LABELS[p.type],
      // Рисунок плюшки зависит от её содержимого: десять фриспинов и двадцать
      // выглядят по-разному, а ваучер несёт имя своего кейса.
      art: p.type === 'freespins' ? `perk/fs/${p.count}`
        : p.type === 'credits' ? `perk/credits/${p.amount}`
        : p.type === 'voucher' ? `perk/voucher/${p.caseId}`
        : 'perk/x2',
      value: payout,
      evValue,
      share: p.share,
      count: p.count,
      // Доля матожидания задана - отсюда вероятность.
      probability: (p.share * target) / evValue,
      tier: 'unique',
      multiplier: Number((evValue / price).toFixed(3)),
    };
  });

  // Джекпот - обычный предмет, но его вероятность задаётся не весом, а долей
  // матожидания, как у плюшек. Так дорогой приз можно поставить на любой
  // сколь угодно малый шанс, не ломая остальную таблицу.
  const jackpotItems = [];
  if (extra.jackpot) {
    const j = extra.jackpot;
    if (!(j.value > 0) || !(j.share > 0)) {
      throw new Error(`[${id}] у джекпота должны быть положительные value и share`);
    }
    // Номинал округляется тем же шагом, что и обычные предметы: иначе среди
    // ровных чисел торчал бы один с «хвостом».
    const jackpotValue = roundNice(j.value);
    jackpotItems.push({
      id: `${id}_jackpot`,
      name: j.name,
      kind: 'item',
      art: `jackpot/${id}`,
      value: jackpotValue,
      evValue: jackpotValue,
      share: j.share,
      probability: (j.share * target) / jackpotValue,
      tier: 'unique',
      multiplier: Number((jackpotValue / price).toFixed(3)),
      jackpot: true,
    });
  }

  const preFixed = [...perkItems, ...jackpotItems];
  const K = preFixed.reduce((s, it) => s + it.probability, 0);
  const totalShare = [...perkSpecs, ...(extra.jackpot ? [extra.jackpot] : [])]
    .reduce((s, p) => s + p.share, 0);

  if (!(target * (1 - totalShare) > 0)) {
    throw new Error(`[${id}] плюшки и джекпот забрали всё матожидание`);
  }

  const preItems = [...perkItems, ...jackpotItems];
  const perkProbability = preItems.reduce((s, it) => s + it.probability, 0);
  if (perkProbability >= 0.4) {
    throw new Error(`[${id}] плюшки занимают ${(perkProbability * 100).toFixed(1)}% вероятности`);
  }

  /*
   * РЕШЕНИЕ ТАБЛИЦЫ. Два неизвестных, два уравнения, ни одной подобранной
   * руками вероятности.
   *
   * Нижняя и средняя полосы забирают заданные доли матожидания и разложены
   * внутри себя по весам. Хвост задан формой, но не масштабом: множитель s
   * решается. Филлер забирает остаток вероятности.
   *
   *   сумма вероятностей:  p0 + B + M + s*W = free
   *   матожидание:         p0*v0 + EVb + EVm + s*Et = target - perkEv
   *
   * Отсюда s, затем p0. Оба обязаны выйти положительными: если нет -
   * форма полос не совместима с отдачей, и это ошибка сборки, а не повод
   * подправить число.
   */
  const perkEv = preItems.reduce((s, it) => s + it.probability * it.evValue, 0);
  const free = 1 - perkProbability;
  const v0 = values[0];
  const itemEv = target - perkEv;   // матожидание, оставшееся обычным предметам

  // Полоса задана долей матожидания: отсюда её вероятность, а не наоборот.
  const group = (vals, weights, share) => {
    const wSum = weights.reduce((a, b) => a + b, 0);
    const avg = vals.reduce((s, v, i) => s + (weights[i] / wSum) * v, 0);
    const ev = share * itemEv;
    const mass = ev / avg;
    return { ev, mass, avg, probs: weights.map((w) => (w / wSum) * mass) };
  };
  const band = group(values.slice(1, 1 + BAND_COUNT), BAND_WEIGHTS, profile.bandShare);
  const mid = group(values.slice(1 + BAND_COUNT, 1 + BAND_COUNT + MID_COUNT), MID_WEIGHTS, profile.midShare);

  // Хвост: от ступени после средней полосы до потолка включительно.
  const tailMultipliers = [...ladder.slice(1 + BAND_COUNT + MID_COUNT), maxMultiplier];
  const tailWeights = tailMultipliers.map((m) => stepWeight(m, profile));
  const tailValues = values.slice(1 + BAND_COUNT + MID_COUNT);
  const tailW = tailWeights.reduce((a, b) => a + b, 0);
  const tailE = tailValues.reduce((s, v, i) => s + tailWeights[i] * v, 0);

  const fixedMass = band.mass + mid.mass;
  const scale = (itemEv - band.ev - mid.ev - v0 * (free - fixedMass)) / (tailE - tailW * v0);
  const p0 = free - fixedMass - scale * tailW;

  if (!(scale > 0) || !(p0 > 0) || !(fixedMass < free)) {
    throw new Error(
      `[${id}] не удалось свести математику: хвост=${scale.toFixed(6)}, ` +
      `филлер=${p0.toFixed(4)}, полосы=${(fixedMass * 100).toFixed(1)}%. ` +
      `Полосы забирают ${((profile.bandShare + profile.midShare) * 100).toFixed(0)}% ` +
      `матожидания предметов - либо уменьшить доли профиля, либо поднять rtp кейса.`
    );
  }

  const tailProbs = tailWeights.map((w) => w * scale);

  const normalItems = values.map((value, i) => ({
    id: `${id}_${i}`,
    name: theme.items[i],
    kind: 'item',
    /*
     * Ключ рисунка - тема и номер, а не название: одиннадцать названий
     * повторяются в разных темах, и по названию два разных предмета получили
     * бы один рисунок (public/item-art-hd.js).
     */
    art: `${themeId}/${i}`,
    value,
    evValue: value,
    multiplier: Number((value / price).toFixed(3)),
    tier: TIER_BY_INDEX[i],
    probability: i === 0 ? p0
      : i <= BAND_COUNT ? band.probs[i - 1]
      : i <= BAND_COUNT + MID_COUNT ? mid.probs[i - 1 - BAND_COUNT]
      : tailProbs[i - 1 - BAND_COUNT - MID_COUNT],
  }));

  const items = [...normalItems, ...preItems];

  /*
   * Оформление принадлежит ПРЕДМЕТУ, а не кейсу: внутри одного кейса соседние
   * карточки обязаны различаться. Считается здесь один раз, потому что один и
   * тот же предмет показывают лента, сетка состава, витрина выпадений и экран
   * результата - четыре места, и расхождение между ними заметно сразу.
   */
  const skins = skinsForCase(items, theme.visual);
  for (const item of items) item.skin = skins.get(item.id);

  let acc = 0;
  for (const item of items) {
    acc += item.probability;
    item.cumulative = acc;
  }
  items[items.length - 1].cumulative = 1;

  /*
   * ТАБЛИЦА ФРИСПИНОВ. Те же предметы, но заметные выигрыши (от первой
   * ступени средней полосы и выше) выпадают чаще в одно и то же число раз
   * (1 + boost), а филлер отдаёт им ровно столько вероятности, сколько они
   * взяли. boost не подбирается: он решается из уравнения матожидания
   *   EV(обычная таблица) + boost·S = price · fsRtp,
   * где S - сумма p·(v - v0) по ускоряемым предметам. Плюшки не трогаются:
   * их ценность и так посчитана по этой таблице.
   *
   * Зачем. Купленная или выпавшая серия должна ощущаться событием, а не
   * десятью обычными открытиями подряд (решение заказчика). Это не обман:
   * интерфейс прямо говорит, что во фриспинах крупное выпадает чаще, и
   * лента серии крутится по этой же таблице.
   */
  const fsTarget = price * fsRtpFor(rtp);
  const boosted = (it) => it.kind === 'item' && it.value >= price * MID_STEPS[0];
  const S = items.reduce((s, it) => s + (boosted(it) ? it.probability * (it.value - v0) : 0), 0);
  const ev0 = items.reduce((s, it) => s + it.probability * it.evValue, 0);
  const boost = (fsTarget - ev0) / S;
  const taken = items.reduce((s, it) => s + (boosted(it) ? it.probability * boost : 0), 0);
  if (!(boost > 0) || !(normalItems[0].probability - taken > 0)) {
    throw new Error(`[${id}] таблица фриспинов не сходится: boost=${boost}, филлер=${normalItems[0].probability - taken}`);
  }
  let fsAcc = 0;
  for (const it of items) {
    it.fsProbability = it === normalItems[0] ? it.probability - taken
      : boosted(it) ? it.probability * (1 + boost) : it.probability;
    fsAcc += it.fsProbability;
    it.fsCumulative = fsAcc;
  }
  items[items.length - 1].fsCumulative = 1;

  const ev = items.reduce((s, it) => s + it.probability * it.evValue, 0);
  const cashEv = items.reduce((s, it) => s + it.probability * it.value, 0);

  return {
    id, name, category, tagline, price, rtp,
    maxMultiplier: jackpotItems.length
      ? Math.max(maxMultiplier, Math.ceil(jackpotItems[0].value / price))
      : maxMultiplier,
    theme: themeId,
    palette: theme.palette,
    visual: theme.visual,
    items,
    // Плюшки есть теперь у всех, поэтому для плашки на карточке важны только
    // те, что заданы кейсу отдельно, - иначе метка перестаёт что-либо значить.
    hasPerks: declaredPerks.length > 0,
    // Витрина и сезонность не влияют на математику: решатель их не видит.
    showcase: extra.showcase || null,
    availableFrom: extra.availableFrom ? Date.parse(extra.availableFrom) : null,
    art: extra.art || null,
    // Бесплатный кейс: открывается только подарком, цена - номинал для
    // решателя, а не ставка. См. START_CASE_ID.
    free: !!extra.free,
    ev,
    cashEv,
    actualRtp: ev / price,
    fsBoost: 1 + boost,
    fsRtp: fsRtpFor(rtp),
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

/* ============================================================
   ПОКУПКА ФРИСПИНОВ
   ============================================================ */

/**
 * Пачки фриспинов, которые можно купить прямо в кейсе.
 *
 * ОТДАЧА ПАЧКИ = fsRtp / (1 - скидка). Прокрут серии крутит свою таблицу с
 * отдачей на FS_RTP_LIFT выше кейса (0.80 против 0.70), и уже это делает
 * покупку выгоднее ручного открытия: крупное в серии выпадает примерно в
 * полтора раза чаще. Скидка сверху небольшая: 80%, 82.5% и 85.1% по
 * ступеням. Выше не поднимать без решения о марже: пачка, которая отдаёт
 * девять десятых, становится способом играть мимо отдачи кейсов.
 */
/* popular - какую ступень выделить в интерфейсе. Флаг живёт здесь, а не в
   вёрстке: середина выгодна не сама по себе, а потому что так настроена
   лесенка скидок, и решаться это должно там же, где лесенка. */
export const FREESPIN_PACKS = [
  { count: 10, discount: 0 },
  { count: 20, discount: 0.03, popular: true },
  { count: 30, discount: 0.06 },
];

/**
 * Насколько цену пачки можно уронить ради круглого числа.
 *
 * Округление вниз - это дополнительная скидка сверх лесенки, то есть прибавка
 * к отдаче пачки. Без потолка «1099» превратилось бы в «1000», и отдача той
 * пачки ушла бы на девять пунктов вверх от соседних - при почти одинаковой
 * цене кейса. Два с половиной процента дают круглые числа вроде 6600 из 6641
 * и при этом не разваливают лесенку.
 */
const PACK_ROUND_MAX_CUT = 0.025;

/**
 * Округление цены пачки вниз до круглого числа.
 *
 * Берём самый крупный шаг из 10, 100, 1000 и так далее, при котором отрезанное
 * укладывается в потолок. Считается здесь же, рядом с ценой: клиент повторяет
 * ту же формулу только ради показа, источник правды - сервер.
 */
export function roundPackPrice(price) {
  let best = price;
  for (let step = 10; step <= price; step *= 10) {
    const down = Math.floor(price / step) * step;
    if (down <= 0 || price - down > price * PACK_ROUND_MAX_CUT) break;
    best = down;
  }
  return best;
}

/** Цена пачки. Считается только здесь, клиент её лишь показывает. */
export function freeSpinPackPrice(caseData, count) {
  const pack = FREESPIN_PACKS.find((p) => p.count === count);
  if (!pack) return null;
  return roundPackPrice(Math.round(caseData.price * count * (1 - pack.discount)));
}

export function getCase(id) {
  return builtById.get(id);
}

/**
 * Предмет по роллу. free = прокрут серии фриспинов: у неё своя таблица
 * (fsCumulative), и проверка раунда обязана брать ту же.
 */
export function pickItem(caseData, roll, free = false) {
  const key = free ? 'fsCumulative' : 'cumulative';
  for (const item of caseData.items) {
    if (roll < item[key]) return item;
  }
  return caseData.items[caseData.items.length - 1];
}

/* ============================================================
   ПРОВЕРКА ИНВАРИАНТОВ
   ============================================================ */

/** Допустимая доля цены подарочного кейса от цены выдавшего его. */
const VOUCHER_RATIO = [0.25, 0.6];

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

    const sumFs = c.items.reduce((s, it) => s + it.fsProbability, 0);
    const fsEv = c.items.reduce((s, it) => s + it.fsProbability * it.evValue, 0);
    if (Math.abs(sumFs - 1) > 1e-9 || Math.abs(fsEv / c.price - c.fsRtp) > 1e-9) {
      throw new Error(`[${c.id}] таблица фриспинов: сумма ${sumFs}, отдача ${fsEv / c.price}, ожидалась ${c.fsRtp}`);
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

    /*
     * Названия внутри кейса уникальны: по названию витрина находит предмет
     * настоящего выпадения (в таблице раундов лежит только оно), и два
     * одноимённых предмета дали бы витрине чужую карточку.
     */
    const names = new Set();
    for (const it of c.items) {
      if (names.has(it.name)) throw new Error(`[${c.id}] два предмета с названием «${it.name}»`);
      names.add(it.name);
    }

    for (const it of c.items) {
      if (!(it.probability > 0) || !(it.probability < 1)) {
        throw new Error(`[${c.id}] предмет ${it.id} имеет вероятность ${it.probability}`);
      }
    }

    // Подарочный кейс должен быть сопоставим по цене с тем, который его
    // выдаёт. Слишком дорогой подарок ломает ощущение уровня («за 999 дали
    // кейс за 100 000»), слишком дешёвый обесценивает саму находку.
    for (const it of c.items) {
      if (it.perk?.type === 'voucher') {
        const gift = builtById.get(it.perk.caseId);
        const ratio = gift.price / c.price;
        if (ratio < VOUCHER_RATIO[0] || ratio > VOUCHER_RATIO[1]) {
          throw new Error(
            `[${c.id}] дарит кейс ${gift.id} за ${gift.price} - это ${(ratio * 100).toFixed(0)}% ` +
            `от цены, допустимо ${VOUCHER_RATIO[0] * 100}-${VOUCHER_RATIO[1] * 100}%`
          );
        }
      }
    }

    // Витринный предмет обязан оставаться вне таблицы: если он окажется
    // среди items, у него появится вероятность, и обещание «не выпадает»
    // перестанет быть правдой.
    if (c.showcase && c.items.some((it) => it.name === c.showcase.name)) {
      throw new Error(`[${c.id}] витринный предмет попал в таблицу розыгрыша`);
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

/** Бесплатный кейс «Начало» (см. SPECS). */
export const START_CASE_ID = 'start_free';

export function publicCase(c) {
  return {
    id: c.id,
    free: c.free || undefined,
    name: c.name,
    category: c.category,
    tagline: c.tagline,
    price: c.price,
    rtp: Number(c.actualRtp.toFixed(4)),
    maxMultiplier: c.maxMultiplier,
    theme: c.theme,
    palette: c.palette,
    visual: c.visual,
    hasPerks: c.hasPerks,
    showcase: c.showcase,
    availableFrom: c.availableFrom,
    art: c.art,
    artAspect: ART[c.art]?.aspect || null,
    artGlow: ART[c.art]?.glow || null,
    topValue: Math.max(...c.items.filter((i) => i.kind === 'item').map((i) => i.value)),
    items: c.items.map((it) => ({
      id: it.id,
      name: it.name,
      kind: it.kind,
      value: it.value,
      evValue: it.evValue,
      multiplier: it.multiplier,
      tier: it.tier,
      skin: it.skin,
      art: it.art,
      perkLabel: it.perkLabel,
      probability: it.probability,
      fsProbability: it.fsProbability,
    })),
    // Во сколько раз в серии фриспинов чаще выпадает заметный выигрыш.
    fsBoost: Number(c.fsBoost.toFixed(2)),
  };
}
