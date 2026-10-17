/** Казино. Порядок = порядок предметов в server/themes.js. */
import { hdRect, hdEll, hdNgon, hdPoly, hdStar } from './kit.js';
import { hdSuit, hdCard, hdChip, hdCoin, hdKey } from './parts.js';

export const HD_CASINO = (() => {
  /** Кубик в изометрии с точками на трёх видимых гранях. */
  const die = (k, cx, cy, s, m, pip) => {
    const top = hdPoly([[cx, cy - s], [cx + s * 0.9, cy - s * 0.5], [cx, cy], [cx - s * 0.9, cy - s * 0.5]]);
    const left = hdPoly([[cx - s * 0.9, cy - s * 0.5], [cx, cy], [cx, cy + s], [cx - s * 0.9, cy + s * 0.5]]);
    const right = hdPoly([[cx, cy], [cx + s * 0.9, cy - s * 0.5], [cx + s * 0.9, cy + s * 0.5], [cx, cy + s]]);
    const dot = (x, y, sx = 1) => k.f(hdEll(x, y, s * 0.11 * sx, s * 0.08), pip);
    return k.p(left, m, 'v', { w: 1.3 }) + k.p(right, m, 'd', { w: 1.3, g: 0.2 }) + k.p(top, m, 'd', { w: 1.3 }) +
      dot(cx, cy - s * 0.5, 1.3) +
      dot(cx - s * 0.62, cy + s * 0.02, 0.7) + dot(cx - s * 0.28, cy + s * 0.48, 0.7) +
      dot(cx + s * 0.28, cy - s * 0.02, 0.7) + dot(cx + s * 0.62, cy + s * 0.2, 0.7) +
      dot(cx + s * 0.28, cy + s * 0.42, 0.7) + dot(cx + s * 0.62, cy + s * 0.62, 0.7);
  };

  return [
    /* 0 Погнутая фишка - серая фишка, выгнутая и с трещиной. */
    (k) => k.aura('#7d8aa6', 0.36) + k.shadow(50, 84, 28) +
      k.g('rotate(-14 50 56) skewX(-8)', hdChip(k, 50, 54, 28, '#6b7aa0', { spot: '#d8dde8' })) +
      k.s('M40 50l6 4-4 4 7 3', '#1b2030', 1.6) + k.s('M40 49l6 4-4 4 7 3', '#c4ccdc', 0.6, 0.7),

    /* 1 Использованный билет - мятый билет из автомата со штрихкодом. */
    (k) => k.aura('#c9d4e2', 0.34) + k.shadow(50, 86, 32) +
      k.g('rotate(-10 50 50)',
        k.p('M16 32L84 28L86 70L52 74L46 70L40 76L14 74Z', 'paper', 'd', { w: 1.3, g: 0.3 }) +
        k.s('M20 38h40M20 44h30', '#2a2430', 1.6, 0.8) +
        [0, 2, 3, 5, 7, 8, 10, 11, 13, 15, 16, 18, 20, 21, 23].map((i) => k.f(hdRect(22 + i * 2.2, 52, i % 3 ? 1 : 1.6, 14), '#14121c')).join('') +
        k.f('M60 34h20v12H60Z', '#ff2e55', 0.85) +
        k.s('M62 40h16', '#ffffff', 1.2) +
        k.s('M46 70L52 74', '#8a7c5e', 0.8)),

    /* 2 Колода карт - стопка рубашкой вверх и туз пик сверху. */
    (k) => k.aura('#ff4060', 0.4) + k.shadow(50, 88, 30) +
      [6, 4, 2].map((o) => hdCard(k, 22 + o, 26 + o, 40, 56, '', '', { back: '#c8103c' })).join('') +
      k.g('rotate(14 60 54)', hdCard(k, 40, 22, 40, 56, 'A', 'spade', { big: 0.3 })),

    /* 3 Стакан для костей - кожаный стакан на боку, два кубика выкатились. */
    (k) => k.aura('#d2873a', 0.4) + k.shadow(50, 88, 36) +
      k.g('rotate(-62 38 54)',
        k.p('M24 36h28l-4 40H28Z', 'leather', 'c', { w: 1.5, b: true }) +
        k.r(22, 32, 32, 6, 3, 'gold', 'c', { w: 1.2 }) +
        k.r(26, 74, 24, 4, 2, 'gold', 'c', { w: 1 }) +
        k.s('M30 46h16M30 52h16M30 58h16M30 64h16', '#3a1a08', 0.8, 0.5)) +
      die(k, 62, 66, 10, 'porcelain', '#14121c') + k.g('rotate(18 78 52)', die(k, 78, 52, 8, 'porcelain', '#d0102a')),

    /* 4 Красная фишка - столбик из трёх красных фишек номиналом 5. */
    (k) => k.aura('#ff2e55', 0.46) + k.shadow(50, 88, 30) +
      hdChip(k, 50, 74, 28, 'red') + hdChip(k, 50, 64, 28, 'red') +
      hdChip(k, 52, 52, 28, 'red', { label: '5' }) +
      k.spark(30, 40, 4),

    /* 5 Сукно со стола - рулон зелёного сукна с золотой разметкой. */
    (k) => k.aura('#16c25a', 0.4) + k.shadow(50, 86, 36) +
      k.p('M14 44L70 30L86 62L30 78Z', '#0f7a3a', 'd', { w: 1.4, g: 0.15 }) +
      k.s('M24 50L70 38M30 62L76 50M50 42L58 70', '#ffcf3f', 1.4, 0.85) +
      `<text x="52" y="58" font-size="9" font-weight="800" fill="#ffcf3f" text-anchor="middle" transform="rotate(-15 52 58)" font-family="Unbounded, system-ui">21</text>` +
      k.g('rotate(-14 22 62)', k.r(8, 52, 18, 24, 9, '#0f7a3a', 'c', { w: 1.4, g: 0.3 }) + k.e(17, 52, 9, 3.4, '#14a04e', 'r', { w: 1.2 })),

    /* 6 Золотая фишка - фишка стоит ребром, на лице корона. */
    (k) => k.aura('#ffcf3f', 0.5) + k.shadow(50, 90, 26) +
      k.e(52, 52, 30, 32, 'oldgold', 'h', { w: 1.4 }) +
      k.e(48, 52, 30, 32, 'gold', 'd', { b: true, bw: 3 }) +
      hdNgon(48, 52, 26, 8, -90).map(([x, y], i) => k.g(`rotate(${i * 45} ${x} ${y})`, k.f(hdRect(x - 3, y - 2, 6, 4, 1), '#fff6c4', 0.95))).join('') +
      k.s(hdEll(48, 52, 18, 19), '#8a5a08', 1.2, 0.7) +
      k.p('M36 60L34 44L41 50L48 40L55 50L62 44L60 60Z', 'gold', 'd', { w: 1.2 }) +
      k.spark(30, 30, 5),

    /* 7 Кубик из слоновой кости - резной кубик с рубиновыми точками. */
    (k) => k.aura('#ffe6b0', 0.42) + k.shadow(50, 88, 26) +
      die(k, 50, 50, 28, 'ivory', '#c8103c') +
      k.s('M50 22L74 36M50 22L26 36', '#ffffff', 1, 0.7) +
      k.spark(70, 26, 4),

    /* 8 Фишка VIP-зала - чёрная фишка с золотым бортом и надписью VIP. */
    (k) => k.aura('#a020ff', 0.48) + k.shadow(50, 88, 30) +
      hdChip(k, 50, 66, 30, 'black', { spot: '#ffcf3f' }) +
      hdChip(k, 50, 54, 30, 'black', { spot: '#ffcf3f', label: 'VIP', labelColor: '#ffcf3f' }) +
      k.p('M30 30Q50 22 70 30L66 38Q50 32 34 38Z', '#7a1fd6', 'v', { w: 1.2 }) +
      k.spark(70, 44, 4),

    /* 9 Бриллиантовая фишка - фишка из огранённого хрусталя. */
    (k) => k.rays('#bfefff', 12, 0.3) + k.aura('#7fd8ff', 0.5) + k.shadow(50, 88, 28) +
      k.p(`M20 56v8a30 12 0 0 0 60 0v-8Z`, 'diamond', 'h', { w: 1.4 }) +
      k.gem(50, 54, 30, 'diamond', { n: 12, sy: 0.42, t: 0.6 }) +
      k.spark(36, 46, 6) + k.spark(66, 52, 4),

    /* 10 Каре тузов - четыре туза веером. */
    (k) => k.aura('#ff4d6e', 0.46) + k.shadow(50, 90, 34) +
      ['spade', 'heart', 'club', 'diamond'].map((s, i) => k.g(`rotate(${-22 + i * 15} 50 96)`, hdCard(k, 32, 24, 36, 52, 'A', s))).join(''),

    /* 11 Royal Flush - пять червей от десятки до туза, золотой обрез. */
    (k) => k.rays('#ff6b8a', 12, 0.3) + k.aura('#ff2e55', 0.52) + k.shadow(50, 90, 36) +
      ['10', 'J', 'Q', 'K', 'A'].map((r, i) => k.g(`rotate(${-26 + i * 13} 50 98)`, hdCard(k, 33, 24, 34, 50, r, 'heart', { gilt: true }))).join('') +
      k.spark(76, 24, 5),

    /* 12 Ключ от кассы - латунный ключ, головка в виде фишки с пикой. */
    (k) => k.aura('#ffb534', 0.44) + k.shadow(50, 84, 30) +
      k.g('rotate(-30 50 50)', hdKey(k, 26, 50, 48, 'brass', {
        bow: hdChip(k, 26, 50, 14, 'red', { tilt: 1, h: 0 }) + hdSuit(k, 'spade', 26, 50, 5, 'black'),
      })) + k.spark(72, 30, 4),

    /* 13 Стол хайроллеров - полуовал сукна, золотой борт, столбики фишек. */
    (k) => k.aura('#16c25a', 0.46) + k.shadow(50, 90, 40) +
      k.p('M8 44H92Q92 84 50 84Q8 84 8 44Z', 'darkwood', 'd', { w: 1.6 }) +
      k.p('M14 46H86Q86 78 50 78Q14 78 14 46Z', '#0f7a3a', 'd', { w: 1.2, g: 0.2 }) +
      k.s('M24 58Q50 72 76 58', '#ffcf3f', 1.2, 0.8) +
      [30, 42, 54, 66].map((x) => k.r(x - 4, 62, 8, 8, 2, '#ffffff', 'v', { w: 0.6, g: 0.2, op: 0.4 })).join('') +
      [[24, 40, 'red'], [34, 38, 'black'], [66, 38, 'gold'], [76, 40, 'sapphire']].map(([x, y, m]) =>
        [0, 1, 2].map((j) => hdChip(k, x, y - j * 4, 6, m, { h: 2 })).join('')).join('') +
      k.r(42, 26, 16, 10, 2, 'porcelain', 'd', { w: 1 }),

    /* 14 Кольцо чемпиона - массивный перстень с рубином и пикой. */
    (k) => k.aura('#ff2e55', 0.5) + k.shadow(50, 90, 26) +
      k.p('M24 58a26 22 0 1 0 52 0a26 22 0 1 0-52 0ZM32 60a18 14 0 1 1 36 0a18 14 0 1 1-36 0Z', 'gold', 'd', { w: 1.6, b: true }) +
      k.p('M28 40L72 40L66 58H34Z', 'gold', 'd', { w: 1.4, b: true }) +
      k.gem(50, 40, 13, 'ruby', { n: 8, sy: 0.7 }) +
      hdSuit(k, 'spade', 50, 40, 4, 'gold') +
      [32, 68].map((x) => k.gem(x, 46, 2.6, 'diamond', { n: 6, w: 0.6 })).join('') +
      k.spark(66, 28, 4),

    /* 15 Джекпот-жетон - большой золотой жетон с тремя семёрками и огнями. */
    (k) => k.rays('#ffd34d', 14, 0.36) + k.aura('#ffb81f', 0.54) + k.shadow(50, 90, 28) +
      hdCoin(k, 50, 50, 34, 'gold', k.txt(50, 58, '777', 20, 'red', { ls: -1 }), { reeded: false }) +
      hdNgon(50, 50, 29, 16, -90).map(([x, y], i) => k.c(x, y, 1.7, i % 2 ? '#ffe066' : '#ff2e55', 'r', { w: 0.4 })).join('') +
      k.spark(28, 28, 5),

    /* 16 Банк турнира - кейс-рэк со столбиками фишек всех цветов. */
    (k) => k.aura('#2ef3ff', 0.42) + k.shadow(50, 90, 40) +
      k.p('M10 66H90L84 86H16Z', 'blacksteel', 'h', { w: 1.4 }) +
      [['red', 18], ['black', 32], ['gold', 46], ['sapphire', 60], ['emerald', 74]].map(([m, x], i) =>
        [0, 1, 2, 3, 4, 5].slice(0, 3 + (i % 3)).map((j) => hdChip(k, x + 4, 64 - j * 6, 7.4, m, { h: 2.4 })).join('')).join('') +
      k.spark(80, 34, 4),

    /* 17 Браслет серии - массивный золотой браслет с плакеткой в камнях. */
    (k) => k.aura('#ffcf3f', 0.5) + k.shadow(50, 88, 34) +
      k.p('M12 54a38 18 0 1 0 76 0a38 18 0 1 0-76 0ZM20 54a30 11 0 1 1 60 0a30 11 0 1 1-60 0Z', 'gold', 'h', { w: 1.5 }) +
      [16, 26, 74, 84].map((x) => k.s(`M${x} ${48}v12`, '#8a5a08', 1, 0.6)).join('') +
      k.r(30, 36, 40, 26, 6, 'gold', 'd', { w: 1.6, b: true }) +
      k.r(34, 40, 32, 18, 4, 'black', 'd', { w: 1 }) +
      hdSuit(k, 'spade', 50, 49, 6, 'gold') +
      hdNgon(50, 49, 13, 10, -90, 0.6).map(([x, y]) => k.gem(x, y, 1.6, 'diamond', { n: 6, w: 0.4 })).join('') +
      k.spark(68, 34, 4),

    /* 18 Доля в заведении - сертификат с гравюрой казино, печать и перо. */
    (k) => k.aura('#7fc4a0', 0.4) + k.shadow(50, 88, 34) +
      k.p('M16 22h64v62H16Z', 'parchment', 'v', { w: 1.4, g: 0.2 }) +
      k.s(hdRect(20, 26, 56, 54, 2), '#3d6b4e', 1.6) +
      k.s('M30 40h36M34 46h28', '#3d6b4e', 1.4, 0.8) +
      k.p('M34 66V56l14-8 14 8v10Z', '#3d6b4e', 'v', { w: 0.8, g: 0, op: 0.7 }) +
      [38, 44, 52, 58].map((x) => k.s(`M${x} 58v8`, '#efe1bb', 1)).join('') +
      k.c(70, 74, 9, 'crimson', 'r', { w: 1.2 }) +
      k.p(hdStar(70, 74, 5, 2.2, 5), '#ff8aa0', 'd', { w: 0.6, g: 0 }) +
      k.g('rotate(38 74 30)', k.p('M70 10Q82 20 76 46L72 48Q72 24 70 10Z', 'porcelain', 'd', { w: 1 }) + k.r(71.4, 46, 3.4, 8, 1, 'gold', 'c', { w: 0.8 })),

    /* 19 Право на банк - золотое колесо рулетки в камнях, вид сверху. */
    (k) => {
      let pockets = '';
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a1 = (i * 360) / n, a2 = ((i + 1) * 360) / n;
        const p = (r, a) => [50 + r * Math.cos(a * Math.PI / 180), 50 + r * 0.62 * Math.sin(a * Math.PI / 180)];
        pockets += k.f(hdPoly([p(20, a1), p(32, a1), p(32, a2), p(20, a2)]), i === 0 ? '#0f9a46' : i % 2 ? '#c8103c' : '#14121c');
      }
      return k.rays('#ffd34d', 16, 0.44) + k.aura('#ffb81f', 0.58) + k.shadow(50, 84, 40) +
        k.p('M12 52v6a38 24 0 0 0 76 0v-6Z', 'darkwood', 'h', { w: 1.4 }) +
        k.e(50, 52, 38, 24, 'gold', 'd', { w: 1.6, b: true, bw: 3 }) +
        k.g('translate(0 2)', pockets) +
        k.e(50, 52, 19, 12, 'gold', 'r', { w: 1.2 }) +
        k.tube('M38 50h24M50 42v16', 'gold', 2.4) +
        k.gem(50, 50, 5, 'diamond', { n: 8, sy: 0.7 }) +
        k.o(68, 46, 2.6, 'porcelain') +
        hdNgon(50, 52, 35, 12, -90, 0.63).map(([x, y], i) => k.gem(x, y, 1.8, i % 2 ? 'ruby' : 'diamond', { n: 6, w: 0.4 })).join('') +
        k.spark(26, 30, 6) + k.spark(78, 34, 4);
    },
  ];
})();
