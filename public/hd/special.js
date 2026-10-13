/**
 * Плюшки и джекпоты: фриспины, удвоитель, бонус, кейс в подарок.
 *
 * Ключ приходит с сервера (server/cases.js, поле art): perk/fs/10,
 * perk/credits/25000, perk/voucher/vault_1000, perk/x2, jackpot/<кейс>.
 * Рисунок зависит от содержимого: десять фриспинов и двадцать - разные
 * карточки, и богаче выглядит та, что больше даёт.
 */
import { hdRect, hdEll, hdNgon, hdPoly, hdStar } from './kit.js';
import { hdCoin, hdIngot } from './parts.js';

/*
 * Отделка фриспинов растёт с числом прокрутов: бронза, серебро, золото,
 * золото с рубинами, платина с сапфирами, бриллианты. Порядок важен - игрок
 * должен с первого взгляда видеть, какая серия больше.
 */
const HD_FS_TRIM = [
  [5, { ring: 'bronze', gem: 'topaz', glow: '#ff9a4a', rays: 0 }],
  [7, { ring: 'silver', gem: 'sapphire', glow: '#9ad8ff', rays: 0 }],
  [10, { ring: 'gold', gem: 'emerald', glow: '#ffd34d', rays: 10 }],
  [12, { ring: 'gold', gem: 'ruby', glow: '#ff6a8a', rays: 12 }],
  [15, { ring: ['#ffffff', '#e2e8f2', '#9aa6ba', '#3a4252', 1], gem: 'sapphire', glow: '#7ab8ff', rays: 14 }],
  [20, { ring: ['#ffffff', '#e2f7ff', '#93d2ff', '#365f8f', 1], gem: 'diamond', glow: '#e8f8ff', rays: 18 }],
];

/** Название подарочного кейса - на билете. */
const HD_VOUCHER_NAMES = {
  abyss_50000: 'БЕЗДНА', braavos_999: 'БРААВОС', crypt_12000: 'СКЛЕП', lair_15000: 'ЛОГОВО',
  neon_500: 'НЕОНОВЫЙ', steam_4000: 'ПАРОВАЯ', vault_1000: 'СЕЙФ', winterfell_699: 'ВИНТЕРФЕЛЛ',
};

/** Короткая запись суммы: 1 500, 25K, 1,2M. */
function hdShortSum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  return n.toLocaleString('ru-RU').replace(/ /g, ' ');
}

/** Рисунок фриспинов: барабан со стрелкой по кругу и числом. */
function hdFreespins(count) {
  let trim = HD_FS_TRIM[0][1];
  for (const [n, t] of HD_FS_TRIM) if (count >= n) trim = t;
  return (k) => (trim.rays ? k.rays(trim.glow, trim.rays, 0.36) : '') + k.aura(trim.glow, 0.54) + k.shadow(50, 92, 28) +
    k.c(50, 50, 34, trim.ring, 'd', { w: 1.6, b: true, bw: 3 }) +
    k.c(50, 50, 27, ['#5a3aaa', '#2a0a6a', '#140434', '#05010e', 0.8], 'r', { w: 1.2 }) +
    // Стрелка по кругу: «ещё прокрут».
    k.s('M28 44A23 23 0 0 1 70 36', k.tone(trim.ring)[1], 3.4) + k.p('M66 28L74 38L62 40Z', trim.ring, 'd', { w: 0.8 }) +
    k.s('M72 56A23 23 0 0 1 30 64', k.tone(trim.ring)[1], 3.4) + k.p('M34 72L26 62L38 60Z', trim.ring, 'd', { w: 0.8 }) +
    k.txt(50, 60, String(count), count >= 10 ? 22 : 26, trim.ring) +
    hdNgon(50, 50, 31, Math.min(12, 4 + count / 2), -90).map(([x, y]) => k.gem(x, y, 2.4, trim.gem, { n: 6, w: 0.4 })).join('') +
    k.spark(28, 24, 4 + count / 5);
}

/** Удвоитель: литое «×2», молнии, алое кольцо. */
function hdX2() {
  return (k) => k.rays('#ff6a3a', 14, 0.4) + k.aura('#ff2e55', 0.6) + k.shadow(50, 92, 28) +
    k.c(50, 50, 34, ['#ffd0d8', '#e8102a', '#8a0618', '#2a0206', 1], 'r', { w: 1.6, b: true, bw: 3 }) +
    k.s(hdEll(50, 50, 28), '#ffcf3f', 2) +
    k.txt(50, 63, '×2', 34, 'gold', { ls: -2 }) +
    k.glow('M14 22L24 32L18 34L28 44', '#ffe28a', 0.8) + k.glow('M86 78L76 68L82 66L72 56', '#ffe28a', 0.8);
}

/** Бонус на баланс: стопки монет, растущие с суммой, сумма на ленте. */
function hdCredits(amount) {
  const stacks = Math.min(5, 1 + Math.floor(Math.log10(Math.max(amount, 10)) - 2));
  return (k) => (amount >= 1e5 ? k.rays('#ffd34d', 16, 0.4) : '') + k.aura('#3dff7a', 0.5) + k.shadow(50, 90, 36) +
    (amount >= 4e5 ? [[22, 60], [76, 62]].map(([x, y]) => k.g(`rotate(${x < 50 ? -14 : 14} ${x} ${y})`, k.r(x - 12, y - 6, 24, 12, 1.4, '#4cbf6a', 'h', { w: 0.9 }) + k.c(x, y, 3.4, '#2a8a4a', 'r', { w: 0.4 }))).join('') : '') +
    Array.from({ length: stacks }, (_, s) => {
      const x = 50 + (s - (stacks - 1) / 2) * 14, h = 3 + ((s * 7) % 4) + stacks;
      return Array.from({ length: h }, (_, i) => hdCoin(k, x, 74 - i * 4, 8, 'gold', '', { sy: 0.36, h: 2.4, reeded: false })).join('');
    }).join('') +
    k.p('M10 20H90L84 28L90 36H10L16 28Z', ['#d8ffd8', '#2fbf5a', '#0a6a2a', '#022a0a', 0.8], 'h', { w: 1.3 }) +
    k.txt(50, 32.4, `+${hdShortSum(amount)}`, 11, 'gold', { ls: 0 });
}

/** Кейс в подарок: золотой билет с названием кейса и бантом. */
function hdVoucher(caseId) {
  const name = HD_VOUCHER_NAMES[caseId] || 'КЕЙС';
  return (k) => k.rays('#ffd34d', 12, 0.34) + k.aura('#ff6ab8', 0.5) + k.shadow(50, 88, 34) +
    k.g('rotate(-10 50 52)',
      k.p('M10 30H90V74H10V62a6 6 0 0 0 0-12Z', 'gold', 'd', { w: 1.6, b: true }) +
      `<path d="M70 30V74" stroke="#8a5a08" stroke-width="1.2" stroke-dasharray="2 2.4"/>` +
      // Подарок на корешке билета: на основной части - только название, иначе
      // длинное имя («ВИНТЕРФЕЛЛ») уезжает под рисунок.
      k.r(74, 44, 12, 12, 1.4, ['#ffd0e8', '#e81e8a', '#8a0a4a', '#2a0214', 1], 'd', { w: 0.8 }) +
      k.s('M80 44V56M74 50H86', '#ffcf3f', 1.4) + k.p('M80 44Q76 38 74 42Q76 46 80 44Q84 38 86 42Q84 46 80 44Z', '#ffcf3f', 'd', { w: 0.4 }) +
      k.txt(40, 50, name, name.length > 7 ? 6.4 : 8.4, ['#5a3a08', '#3a2205', '#2a1803', '#100802', 0.2], { ls: 0.3 }) +
      k.txt(40, 63, 'В ПОДАРОК', 5, ['#7a0a3a', '#a8105a', '#5a0a2a', '#200008', 0.2], { ls: 0.8 })) +
    k.spark(84, 22, 5);
}

/** Джекпот: самородок-великан на постаменте за бархатным канатом. */
function hdJackpot() {
  return (k) => k.rays('#fff1b0', 22, 0.5) + k.aura('#ffcf3f', 0.66) + k.shadow(50, 94, 40) +
    k.r(22, 78, 56, 14, 2, 'black', 'h', { w: 1.4 }) + k.r(26, 82, 48, 4, 1, 'gold', 'h', { w: 0.6 }) +
    [[10, 70], [90, 70]].map(([x, y]) => k.r(x - 1.6, y, 3.2, 22, 1, 'gold', 'c', { w: 0.6 }) + k.o(x, y, 3, 'gold')).join('') +
    k.tube('M10 72Q30 86 50 80Q70 86 90 72', ['#ffb0c0', '#b0103a', '#6a0620', '#200008', 0.6], 2.4) +
    k.g('translate(50 44) scale(2.5)',
      k.p('M-10-2Q-12-10-4-12Q2-16 8-10Q14-8 12 0Q14 8 6 10Q0 14-6 10Q-14 8-10-2Z', 'gold', 'd', { w: 0.4, b: true, bw: 0.5 }) +
      [[-4, -4, 1.6], [4, 2, 1.8], [-2, 6, 1.2], [6, -6, 1]].map(([x, y, r]) => k.c(x, y, r, '#a8640a', 'd', { w: 0, g: 0, op: 0.6 })).join('')) +
    k.spark(34, 30, 7) + k.spark(68, 58, 4) + k.spark(60, 22, 3);
}

/** Рисунок по ключу; null - ключ не из этого файла. */
export function hdSpecial(key) {
  const [kind, type, arg] = String(key).split('/');
  if (kind === 'jackpot') return hdJackpot();
  if (kind !== 'perk') return null;
  if (type === 'fs') return hdFreespins(Number(arg) || 10);
  if (type === 'x2') return hdX2();
  if (type === 'credits') return hdCredits(Number(arg) || 0);
  if (type === 'voucher') return hdVoucher(arg);
  return null;
}

/** Все ключи, которые этот файл умеет рисовать, - для контактного листа и проверок. */
export const HD_SPECIAL_SAMPLES = [
  'perk/fs/5', 'perk/fs/7', 'perk/fs/10', 'perk/fs/12', 'perk/fs/15', 'perk/fs/20', 'perk/x2',
  'perk/credits/1500', 'perk/credits/25000', 'perk/credits/120000', 'perk/credits/400000', 'perk/credits/900000', 'perk/credits/1200009',
  ...Object.keys(HD_VOUCHER_NAMES).map((id) => `perk/voucher/${id}`), 'jackpot/rolex_6000',
];
