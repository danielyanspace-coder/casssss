/**
 * Казино: вкладки и тематические блоки лобби.
 *
 * Чистые правила без базы и сети: их читают и сервер (casino-db.js, SQL с
 * функцией regexp), и автономная сборка (заглушка считает блоки в браузере
 * по тому же списку). Две копии правил разошлись бы.
 *
 * ПОЧЕМУ БЛОКИ ПО НАЗВАНИЮ И ПО ДАННЫМ, А НЕ «КАК КРАСИВЕЕ». Заказчик
 * попросил разложить игры объективно. Поэтому у каждого блока проверяемое
 * основание:
 *   - «Популярные» - наши ставки за неделю, затем топ агрегатора, затем
 *     стартовый список известных хитов (HITS в casino.js);
 *   - «Лучшие выигрыши» - настоящие раунды наших игроков за неделю с самым
 *     большим множителем к ставке; нет таких раундов - нет блока;
 *   - «Новинки» - список новых релизов агрегатора и игры, появившиеся в
 *     каталоге после первой загрузки;
 *   - тематические - по механике или теме, записанной в названии самой
 *     игры: «Megaways», «Hold and Win», «Book of», «Buy Bonus». Провайдеры
 *     сами так называют игры, это не наша оценка.
 *
 * Шаблон хранится строкой, а не RegExp: та же строка уходит в SQL.
 */

export const CASINO_TABS = [
  { id: 'slots', label: 'Слоты' },
  { id: 'live', label: 'Live казино' },
  { id: 'fast', label: 'Быстрые игры' },
];

/* Сколько плиток в блоке лобби: Популярные - две строки по девять. */
export const POPULAR_SIZE = 18;
export const BLOCK_SIZE = 20;
/* Тематический блок из двух-трёх игр выглядит дырой в лобби и повторяет
   «Популярные»: такие блоки не показываются, игры остаются в поиске. */
export const MIN_BLOCK_GAMES = 4;

/*
 * type:
 *   popular  - всё по порядку популярности;
 *   bigwins  - лучшие выигрыши недели (casino_tx);
 *   new      - новинки;
 *   match    - по шаблону названия.
 * Порядок в массиве - порядок блоков в лобби. «Популярные» первые по
 * просьбе заказчика.
 */
export const CASINO_CATEGORIES = [
  { id: 'popular', kind: 'slots', type: 'popular', title: 'Популярные', icon: 'fire', rows: 2 },
  { id: 'bigwins', kind: 'slots', type: 'bigwins', title: 'Лучшие выигрыши недели', icon: 'trophy' },
  { id: 'new', kind: 'slots', type: 'new', title: 'Новинки', icon: 'spark' },
  { id: 'holdwin', kind: 'slots', type: 'match', title: 'Hold & Win', icon: 'coin',
    pattern: "hold\\s*(&|and|'?n'?)\\s*(win|spin)|\\bcoins?\\s+link\\b|\\bcash\\s+link\\b" },
  { id: 'megaways', kind: 'slots', type: 'match', title: 'Megaways', icon: 'grid', pattern: 'megaways' },
  { id: 'bonusbuy', kind: 'slots', type: 'match', title: 'Покупка бонуса', icon: 'bag',
    pattern: 'buy\\s*bonus|bonus\\s*buy' },
  { id: 'books', kind: 'slots', type: 'match', title: 'Книги', icon: 'book', pattern: '\\bbook\\b' },
  { id: 'fruits', kind: 'slots', type: 'match', title: 'Фрукты и семёрки', icon: 'cherry',
    pattern: 'fruit|sizzling|burning\\s*hot|super\\s*hot|ultra\\s*hot|flaming\\s*hot|\\bsevens?\\b|\\b7s\\b|joker' },
  { id: 'egypt', kind: 'slots', type: 'match', title: 'Древний Египет', icon: 'pyramid',
    pattern: 'egypt|pharaoh|cleopatra|anubis|scarab|pyramid|\\bra\\b|\\btut' },
  { id: 'holiday', kind: 'slots', type: 'match', title: 'Праздничные', icon: 'gift',
    pattern: 'christmas|xmas|santa|halloween|easter|valentin' },

  { id: 'popular-fast', kind: 'fast', type: 'popular', title: 'Популярные', icon: 'fire' },
  { id: 'crash', kind: 'fast', type: 'match', title: 'Краши, мины и плинко', icon: 'rocket',
    pattern: '^(aviator|balloon|mines|plinko)$' },
  { id: 'table-fast', kind: 'fast', type: 'match', title: 'Кости, карты и кено', icon: 'dice',
    pattern: '^(dice|hilo|keno|goal|hotline|mini-roulette)$' },
  { id: 'bigwins-fast', kind: 'fast', type: 'bigwins', title: 'Лучшие выигрыши недели', icon: 'trophy' },

  { id: 'popular-live', kind: 'live', type: 'popular', title: 'Популярные', icon: 'fire' },
  { id: 'shows', kind: 'live', type: 'match', title: 'Игровые шоу', icon: 'wheel',
    pattern: 'crazy\\s*time|monopoly|mega\\s*wheel|funky\\s*time|dream\\s*catcher|deal\\s*or\\s*no\\s*deal|candyland|money\\s*wheel|wheel' },
  { id: 'roulette', kind: 'live', type: 'match', title: 'Рулетка', icon: 'roulette', pattern: 'roulette' },
  { id: 'blackjack', kind: 'live', type: 'match', title: 'Блэкджек', icon: 'cards', pattern: 'blackjack' },
  { id: 'baccarat', kind: 'live', type: 'match', title: 'Баккара', icon: 'cards', pattern: 'baccarat|dragon\\s*tiger' },
  { id: 'poker', kind: 'live', type: 'match', title: 'Покер', icon: 'cards', pattern: "poker|hold\\s*'?em|teen\\s*patti" },
];

/*
 * Блоки провайдеров после тематических: так устроено у 1Win, и это тоже
 * объективное основание - игра принадлежит провайдеру. Берутся первые по
 * порядку провайдеров (PROVIDER_ORDER), чтобы лобби не стало списком всех
 * тридцати трёх.
 */
export const PROVIDER_BLOCKS = 4;

export const categoryById = (id) => CASINO_CATEGORIES.find((c) => c.id === id) || null;
export const categoriesFor = (kind) => CASINO_CATEGORIES.filter((c) => c.kind === kind);

const compiled = new Map();
/** Совпадает ли название игры с шаблоном категории (без учёта регистра). */
export function matchesPattern(pattern, name) {
  let re = compiled.get(pattern);
  if (!re) { re = new RegExp(pattern, 'i'); compiled.set(pattern, re); }
  return re.test(String(name || ''));
}
