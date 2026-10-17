/**
 * Оформление ОТДЕЛЬНОГО предмета.
 *
 * Первая версия вешала семейство на тему кейса: все 68 кейсов отличались друг
 * от друга, а внутри кейса двадцать одна карточка выглядела одинаково. Игрок
 * смотрит на состав одного кейса, а не на витрину из разных, - и видел ровно
 * то, с чего начинали: один шаблон, подписи разные.
 *
 * Теперь скин принадлежит предмету. Внутри кейса соседние карточки различаются
 * семейством, формой, материалом и шрифтом подписи.
 *
 * Три правила, которые держат это вместе и не дают превратиться в кашу:
 *
 * 1. ДЕТЕРМИНИРОВАННОСТЬ. Скин считается из идентификатора предмета. Один и тот
 *    же предмет всегда выглядит одинаково - в ленте, в сетке, в выпадениях и на
 *    экране результата. Случайность здесь означала бы, что предмет меняет вид
 *    между двумя взглядами на один экран.
 *
 * 2. ГРОМКОСТЬ РАСТЁТ С РЕДКОСТЬЮ. Дешёвые ступени получают тихие семейства,
 *    верхние - громкие. Это сознательная ПРАВКА прежнего правила «редкость не
 *    равна стилю». Прежнее боялось, что игрок прочитает «ярче значит
 *    вероятнее». Но редкость и вероятность связаны по построению: верхняя
 *    ступень и правда реже. Значит оформление не врёт, а показывает правду,
 *    и ровно этого ждут от открытия кейса.
 *
 *    Чего по-прежнему делать нельзя: привязывать громкость к ЦЕНЕ КЕЙСА.
 *    Филлер в кейсе за 100 000 остаётся филлером и обязан выглядеть тихо.
 *
 * 3. КЕЙС СОХРАНЯЕТ ЛИЦО. Самый дорогой предмет берёт оформление своей темы
 *    (VISUALS в themes.js). Поэтому «Рио» узнаётся по главному призу, а не
 *    растворяется в общей каше: различается тело кейса, а не его вершина.
 *
 * 4. ВНУТРИ КЕЙСА НЕТ ДВУХ ОДИНАКОВЫХ КАРТОЧЕК. Пара «семейство + материал»
 *    в кейсе не повторяется, а соседние ступени различаются семейством.
 *    Хеш по одному предмету этого не гарантирует: три предмета верхней
 *    ступени «Самурая» получали slate с хромом, slate с углём и снова slate с
 *    хромом - «Путь воина» и «Первый удар» были одной карточкой с разной
 *    суммой. Поэтому скины раздаются кейсу целиком (skinsForCase), а хеш
 *    только задаёт порядок перебора - так результат остаётся постоянным.
 */

import { THEMES, FAMILIES, SHAPES, MATERIALS } from './themes.js';

/**
 * Какие семейства допустимы на каждой ступени редкости.
 *
 * Снизу тихие, сверху громкие. Внутри ступени выбор делает хеш предмета -
 * поэтому два предмета одного уровня в одном кейсе всё равно разные.
 *
 * Списки намеренно пересекаются на соседних ступенях: иначе уровень читался бы
 * по оформлению однозначно, и состав кейса превращался бы в таблицу, где цена
 * уже не нужна.
 */
const FAMILY_BY_TIER = {
  common:    ['slate', 'paper'],
  uncommon:  ['slate', 'paper', 'felt'],
  rare:      ['paper', 'felt', 'circuit'],
  epic:      ['felt', 'circuit', 'vault'],
  legendary: ['circuit', 'vault', 'geode'],
  mythic:    ['vault', 'geode', 'prism'],
  /*
   * signature здесь нет намеренно: его носят плюшки и лицо кейса. Отдай его
   * ещё и ступени - и в кейсе с тремя плюшками сочетаний signature не хватит,
   * карточки начнут совпадать.
   */
  unique:    ['geode', 'prism', 'vault'],
};

/** Форма - свойство семейства, а не отдельное решение: билет у paper, грань у geode. */
const SHAPE_OF_FAMILY = {
  vault: 'notch',
  circuit: 'notch',
  felt: 'card',
  prism: 'card',
  paper: 'ticket',
  geode: 'hex',
  slate: 'card',
  signature: 'card',
};

/**
 * Материалы, которые идут семейству.
 *
 * Не любой с любым: углерод на фольге prism выглядит грязью, а голограмма на
 * шлифованном металле vault спорит с поверхностью. Первый в списке - основной,
 * остальные дают разброс внутри семейства.
 */
const MATERIALS_BY_FAMILY = {
  vault:     ['chrome', 'gold', 'carbon', 'matte'],
  circuit:   ['neon', 'chrome', 'carbon', 'glass'],
  felt:      ['matte', 'gold', 'chrome', 'carbon'],
  prism:     ['holo', 'crystal', 'glass', 'neon'],
  paper:     ['carbon', 'gold', 'glass', 'matte'],
  geode:     ['crystal', 'glass', 'chrome', 'holo'],
  slate:     ['matte', 'chrome', 'carbon', 'glass'],
  // Пять, а не три: signature носят лицо кейса и до трёх плюшек сразу.
  signature: ['gold', 'holo', 'crystal', 'chrome', 'neon'],
};

/*
 * Тихие семейства. Фирменное семейство темы бывает тихим (у «Самурая» и
 * «Тени» это slate), и отдать его главному призу значило бы нарушить правило
 * 2: самая редкая карточка выглядела бы как филлер. Тогда главный приз берёт
 * signature, а лицо темы несёт материал.
 *
 * Фирменное оформление получает ОДИН предмет, самый дорогой. Сначала его
 * давали целой ступени (unique, три предмета), и при тихом семействе темы три
 * главные карточки были одной и той же.
 */
const QUIET_FAMILIES = new Set(['slate', 'paper', 'felt']);

/*
 * Сколько шагов перебора с возвратом дать одному кейсу. На всех 68 кейсах
 * решение находится не дольше чем за полсотни шагов; потолок нужен, чтобы
 * опечатка в таблицах не превратила сборку кейсов на старте в бесконечный
 * перебор.
 */
const SEARCH_BUDGET = 20000;

const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'unique'];

/**
 * Запасные семейства ступени: соседние ступени, сначала ближняя и верхняя.
 * Верхняя раньше нижней, чтобы уступка не делала редкий предмет тише, - и
 * тихие семейства верхним ступеням не достаются никогда (правило 2).
 */
function spareFamilies(tier, own) {
  const at = TIER_ORDER.indexOf(tier);
  const out = [];
  for (let d = 1; d < TIER_ORDER.length; d++) {
    for (const t of [TIER_ORDER[at + d], TIER_ORDER[at - d]]) {
      for (const f of FAMILY_BY_TIER[t] || []) {
        if (own.includes(f) || out.includes(f)) continue;
        if (at >= TIER_ORDER.indexOf('epic') && QUIET_FAMILIES.has(f)) continue;
        out.push(f);
      }
    }
  }
  return out;
}

/**
 * Хеш строки. FNV-1a: короткий, без зависимостей и хорошо перемешивает близкие
 * строки - а идентификаторы предметов отличаются ровно последней цифрой
 * (`rio_1500_7` и `rio_1500_8`), и слабый хеш выдал бы им соседние скины.
 */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Список, сдвинутый на seed: постоянный порядок перебора без случайности. */
function rotate(list, seed) {
  const k = seed % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/**
 * Скины всем предметам кейса сразу.
 *
 * Перебор идёт от дешёвых к дорогим, с возвратом. Кандидаты предмета - его
 * семейства и материалы в порядке, заданном хешем id; берётся первая пара,
 * которой ещё нет в кейсе и у которой семейство не совпадает с соседом снизу.
 * Решения нет - жадный проход ослабляет требование к соседу, но не к повтору.
 *
 * @param {Array<{id:string, tier:string, kind:string, value:number}>} items
 * @param {{family:string, material:string}} themeVisual  оформление темы
 * @returns {Map<string, {family, shape, material}>} скин по id предмета
 */
export function skinsForCase(items, themeVisual) {
  const out = new Map();
  const used = new Set();
  const key = (family, material) => `${family}/${material}`;

  /*
   * Лицо кейса - один, самый дорогой обычный предмет. Плюшки (фриспины,
   * удвоитель) в это не входят: они всегда signature, это событие, а не
   * предмет темы, и обязано выделяться из ряда.
   */
  const regular = items.filter((it) => it.kind !== 'perk');
  const top = regular.length ? regular.reduce((a, b) => (b.value > a.value ? b : a)) : null;

  const pick = (it, families, prevFamily, spare = []) => {
    const seed = hash(it.id || it.name || '');
    // Материал перебирается по ОТДЕЛЬНОМУ хешу: сдвинутые разряды того же
    // хеша связаны, и на трёх соседях это видно сразу.
    const mseed = hash(`${it.id}#material`);
    /*
     * Порядок уступок: сначала свои семейства без соседа, потом семейства
     * соседних ступеней без соседа, и только потом сосед. Повтор пары не
     * допускается ни на одном шаге. У верхних ступеней по три семейства на
     * девять предметов «Шапито», и своих сочетаний там просто не хватает:
     * прежде последний уникальный предмет молча повторял легендарный.
     */
    const rounds = [
      [rotate(families, seed), true],
      [rotate(spare, seed), true],
      [rotate(families, seed), false],
      [rotate(spare, seed), false],
    ];
    for (const [list, strictNeighbour] of rounds) {
      for (const family of list) {
        if (strictNeighbour && family === prevFamily) continue;
        for (const material of rotate(MATERIALS_BY_FAMILY[family], mseed)) {
          if (!used.has(key(family, material))) return { family, material };
        }
      }
    }
    // Все сочетания заняты - так бывает только в очень длинном кейсе.
    // Повтор лучше, чем карточка без оформления.
    const family = rotate(families, seed)[0];
    return { family, material: rotate(MATERIALS_BY_FAMILY[family], mseed)[0] };
  };

  const assign = (it, choice) => {
    used.add(key(choice.family, choice.material));
    out.set(it.id, { family: choice.family, shape: SHAPE_OF_FAMILY[choice.family], material: choice.material });
  };

  /*
   * Лицо кейса выбирается ПЕРВЫМ и бронирует своё сочетание. Когда оно шло
   * последним по цене, нижние ступени успевали занять материалы темы, и
   * главный приз совпадал с какой-нибудь мифической карточкой.
   */
  let topFamily = null;
  if (top) {
    const family = QUIET_FAMILIES.has(themeVisual.family) ? 'signature' : themeVisual.family;
    const pool = MATERIALS_BY_FAMILY[family];
    // Материал темы, если он идёт этому семейству, - он и несёт лицо кейса.
    const material = pool.includes(themeVisual.material) ? themeVisual.material : pool[0];
    assign(top, { family, material });
    topFamily = family;
  }

  const ladder = regular.filter((it) => it !== top).sort((a, b) => a.value - b.value);
  const belowTop = ladder[ladder.length - 1];
  const options = ladder.map((it) => {
    const tier = FAMILY_BY_TIER[it.tier] ? it.tier : 'common';
    // Предмет прямо под главным призом не берёт его семейство: иначе две
    // верхние карточки ряда сливаются, а смотрят именно на них.
    const families = it === belowTop
      ? FAMILY_BY_TIER[tier].filter((f) => f !== topFamily)
      : FAMILY_BY_TIER[tier];
    const own = families.length ? families : FAMILY_BY_TIER[tier];
    const spare = spareFamilies(tier, own).filter((f) => it !== belowTop || f !== topFamily);
    return { it, own, spare };
  });

  /*
   * Перебор с возвратом. Жадный выбор упирался в конец лестницы: нижние
   * ступени разбирали vault и geode, и двум верхним уникальным предметам
   * оставалось только одно семейство - они шли подряд одинаковыми. Вариантов
   * у лестницы немного, и первое найденное решение по-прежнему следует
   * порядку хеша, поэтому результат постоянен. Не нашлось за отведённое
   * число шагов - жадный проход с уступкой соседу, как раньше.
   */
  const strictCandidates = ({ it, own, spare }, prevFamily) => {
    const seed = hash(it.id || it.name || '');
    const mseed = hash(`${it.id}#material`);
    const out = [];
    for (const family of [...rotate(own, seed), ...rotate(spare, seed)]) {
      if (family === prevFamily) continue;
      for (const material of rotate(MATERIALS_BY_FAMILY[family], mseed)) out.push({ family, material });
    }
    return out;
  };
  let budget = SEARCH_BUDGET;
  const plan = [];
  const solve = (i, prevFamily) => {
    if (i === options.length) return true;
    for (const choice of strictCandidates(options[i], prevFamily)) {
      if (used.has(key(choice.family, choice.material))) continue;
      if (--budget < 0) return false;
      used.add(key(choice.family, choice.material));
      plan.push(choice);
      if (solve(i + 1, choice.family)) return true;
      plan.pop();
      used.delete(key(choice.family, choice.material));
    }
    return false;
  };

  if (solve(0, null)) {
    options.forEach(({ it }, i) => assign(it, plan[i]));
  } else {
    for (const choice of plan) used.delete(key(choice.family, choice.material));
    let prevFamily = null;
    for (const { it, own, spare } of options) {
      const choice = pick(it, own, prevFamily, spare);
      assign(it, choice);
      prevFamily = choice.family;
    }
  }

  for (const it of items.filter((x) => x.kind === 'perk')) assign(it, pick(it, ['signature'], null));
  return out;
}

/**
 * Скин одного предмета вне кейса - для записей, у которых кейса нет.
 * Внутри кейса всегда skinsForCase: только он видит соседей.
 */
export function skinFor(item, themeVisual) {
  return skinsForCase([item], themeVisual).get(item.id);
}

/**
 * Проверка таблиц. Запускается на старте: опечатка в названии семейства или
 * материала иначе всплывёт на экране игрока, а не здесь.
 */
export function validateSkins() {
  const used = new Set();

  for (const [tier, list] of Object.entries(FAMILY_BY_TIER)) {
    if (!list.length) throw new Error(`[skins] у ступени "${tier}" нет ни одного семейства`);
    for (const f of list) {
      if (!FAMILIES.includes(f)) throw new Error(`[skins] ступень "${tier}": неизвестное семейство ${f}`);
      used.add(f);
    }
  }

  for (const [family, shape] of Object.entries(SHAPE_OF_FAMILY)) {
    if (!FAMILIES.includes(family)) throw new Error(`[skins] неизвестное семейство в формах: ${family}`);
    if (!SHAPES.includes(shape)) throw new Error(`[skins] "${family}": неизвестная форма ${shape}`);
  }

  for (const [family, list] of Object.entries(MATERIALS_BY_FAMILY)) {
    if (!FAMILIES.includes(family)) throw new Error(`[skins] неизвестное семейство в материалах: ${family}`);
    if (!list.length) throw new Error(`[skins] у семейства "${family}" нет материалов`);
    for (const m of list) {
      if (!MATERIALS.includes(m)) throw new Error(`[skins] "${family}": неизвестный материал ${m}`);
    }
  }

  // Верхние ступени берут семейство темы, поэтому в таблице они могут не
  // встретиться - добираем из тем, иначе проверка ниже ложно сработает.
  for (const theme of Object.values(THEMES)) used.add(theme.visual.family);

  for (const family of FAMILIES) {
    if (!used.has(family)) {
      throw new Error(`[skins] семейство "${family}" описано, но не достаётся ни одному предмету`);
    }
    if (!SHAPE_OF_FAMILY[family]) throw new Error(`[skins] у семейства "${family}" нет формы`);
    if (!MATERIALS_BY_FAMILY[family]) throw new Error(`[skins] у семейства "${family}" нет материалов`);
  }

  return { tiers: Object.keys(FAMILY_BY_TIER).length, families: FAMILIES.length };
}

export { FAMILY_BY_TIER, SHAPE_OF_FAMILY, MATERIALS_BY_FAMILY };
