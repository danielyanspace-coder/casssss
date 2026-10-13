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
 * 3. КЕЙС СОХРАНЯЕТ ЛИЦО. Два верхних уровня берут семейство своей темы
 *    (VISUALS в themes.js). Поэтому «Рио» узнаётся по главным призам, а не
 *    растворяется в общей каше: различается тело кейса, а не его вершина.
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
  unique:    ['geode', 'prism', 'signature'],
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
  vault:     ['chrome', 'gold', 'carbon'],
  circuit:   ['neon', 'chrome', 'carbon'],
  felt:      ['matte', 'gold', 'chrome'],
  prism:     ['holo', 'crystal', 'glass'],
  paper:     ['carbon', 'gold', 'glass'],
  geode:     ['crystal', 'glass', 'chrome'],
  slate:     ['matte', 'chrome', 'carbon'],
  signature: ['gold', 'holo', 'crystal'],
};

/*
 * Фирменное семейство темы берёт ТОЛЬКО верхняя ступень.
 *
 * Сначала их было две, unique и mythic, - это три плюс пять предметов, и
 * восемь самых дорогих карточек подряд выглядели одинаково. А смотрят именно
 * на них. Одна ступень - это три карточки: кейс узнаётся, ряд не слипается.
 */
const SIGNATURE_TIERS = new Set(['unique']);

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

/**
 * Скин одного предмета.
 *
 * @param {{id:string, tier:string, kind:string}} item
 * @param {object} themeVisual  оформление темы кейса (THEMES[id].visual)
 */
export function skinFor(item, themeVisual) {
  const seed = hash(item.id || item.name || '');
  const tier = FAMILY_BY_TIER[item.tier] ? item.tier : 'common';

  /*
   * Плюшки (удвоитель, ваучер, фриспины) всегда в signature: это не предмет
   * из темы кейса, а событие, и оно обязано выделяться из ряда. Иначе игрок
   * пролистывает фриспины как обычную ступень.
   */
  const family = item.kind === 'perk'
    ? 'signature'
    : SIGNATURE_TIERS.has(tier)
      ? themeVisual.family
      : FAMILY_BY_TIER[tier][seed % FAMILY_BY_TIER[tier].length];

  /*
   * Материал берёт ОТДЕЛЬНЫЙ хеш, а не сдвиг того же.
   * Со сдвигом три предмета верхней ступени получили один и тот же материал:
   * сдвинутые разряды одного хеша остаются связанными, и на выборке из трёх
   * это видно сразу. Второй хеш независим по построению.
   */
  const pool = MATERIALS_BY_FAMILY[family];
  const material = pool[hash(`${item.id}#material`) % pool.length];

  return { family, shape: SHAPE_OF_FAMILY[family], material };
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
