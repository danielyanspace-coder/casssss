/**
 * Крупные рисунки предметов (64x64).
 *
 * Зачем второй набор, когда есть item-art.js. Тот рисовался под значок в 34
 * точки: силуэт простой, заливка плоская, контур тонкий. На маленькой иконке
 * это правильно. Но карточка выигрыша теперь высокая, и рисунок занимает в ней
 * всю свободную площадь - растянутый мотив 24x24 превращается в плоскую
 * пиктограмму. Именно так и выглядели фриспины: бледная загогулина на пол-карты.
 *
 * Здесь всё нарисовано сразу под крупный размер: больше граней, свои тени,
 * заливка градиентом материала.
 *
 * ЗАЛИВКА ПРИХОДИТ СНАРУЖИ. var(--mat) - лицевая поверхность, var(--mat2) -
 * теневая грань, var(--notch) - цвет выреза (совпадает с фоном карточки).
 * Переменные ставит карточка по своему материалу, поэтому один и тот же путь
 * под золотом, хромом и голограммой читается как разные предметы.
 *
 * Мотивы подбираются по ключевым словам названия, как и в старом наборе: имён
 * 820, рисовать под каждое нельзя и не нужно. Чего словарь не знает - уходит в
 * item-art.js, а оттуда в значок уровня редкости.
 */

/*
 * ВСЕ имена верхнего уровня в этом файле заканчиваются на 64 намеренно.
 * Автономная сборка (build-standalone.mjs) складывает все модули клиента в
 * одну область видимости, а `ART`, `MATCH`, `defs`, `HI` и `gradSeq` уже
 * заняты в item-art.js и icons.js. Совпадение валит ВСЮ сборку одной строкой
 * «has already been declared» - на этом уже спотыкались `pause` и `wait` в
 * слотах.
 */
let seq64 = 0;

/*
 * Градиент лежит ВНУТРИ своей svg, потому что CSS-переменные наследуются по
 * дереву: общий блок defs в конце страницы читал бы значения с :root, то есть
 * один материал на весь проект. Id уникален на отрисовку - иначе url(#...) во
 * всех карточках разрешился бы в первый по порядку.
 */
const defs64 = (id) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0.45" y2="1">
     <stop offset="0" stop-color="var(--mat-1, #f2f6fa)"/>
     <stop offset="0.45" stop-color="var(--mat-2, #aab6c4)"/>
     <stop offset="1" stop-color="var(--mat-3, #6e7a8a)"/>
   </linearGradient>
   <linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="var(--mat-3, #6e7a8a)"/>
     <stop offset="1" stop-color="var(--mat-2, #aab6c4)" stop-opacity=".55"/>
   </linearGradient></defs>`;

/* Белый блик и тёмная грань одинаковы у всех мотивов - выносим, чтобы не
   повторять в каждом пути. */
const HI64 = 'rgba(255,255,255,.4)';
const HI264 = 'rgba(255,255,255,.22)';

const ART64 = {
  /* ---------- Ключи, замки, печати ---------- */
  key: (m, d) => `<circle cx="20" cy="20" r="13" fill="none" stroke="${m}" stroke-width="7"/>
    <circle cx="20" cy="20" r="5" fill="var(--notch)"/>
    <path d="M28 28 48 48" stroke="${m}" stroke-width="7" stroke-linecap="round"/>
    <path d="M42 42h10v7H42zM36 48h8v6h-8z" fill="${d}"/>
    <circle cx="20" cy="20" r="13" fill="none" stroke="${HI64}" stroke-width="2"/>`,

  lock: (m, d) => `<rect x="12" y="28" width="40" height="28" rx="6" fill="${m}"/>
    <path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="${d}" stroke-width="6"/>
    <rect x="12" y="28" width="40" height="7" fill="${HI64}"/>
    <circle cx="32" cy="40" r="5" fill="${d}"/><path d="M30 43h4v8h-4z" fill="${d}"/>`,

  seal: (m, d) => `<circle cx="32" cy="26" r="17" fill="${m}"/>
    <circle cx="32" cy="26" r="11" fill="none" stroke="${d}" stroke-width="3"/>
    <path d="m32 17 2.8 6 6.4.8-4.8 4.4 1.3 6.3L32 31.4 26.3 34.5l1.3-6.3-4.8-4.4 6.4-.8z" fill="${d}"/>
    <path d="M24 42h16l4 16H20z" fill="${d}"/>
    <path d="M24 42h8l-2 16h-10z" fill="${m}" opacity=".6"/>
    <path d="M20 22a17 17 0 0 1 12-11" stroke="${HI64}" stroke-width="3" fill="none"/>`,

  chest: (m, d) => `<path d="M8 28a24 14 0 0 1 48 0v4H8z" fill="${m}"/>
    <rect x="8" y="32" width="48" height="24" rx="3" fill="${d}"/>
    <rect x="8" y="30" width="48" height="6" fill="${m}"/>
    <rect x="27" y="28" width="10" height="16" rx="2" fill="${m}"/>
    <circle cx="32" cy="38" r="2.6" fill="${d}"/>
    <path d="M14 22a24 14 0 0 1 18-8" stroke="${HI64}" stroke-width="3" fill="none"/>
    <path d="M12 44h12M40 44h12" stroke="${m}" stroke-width="2.5" opacity=".5"/>`,

  /* ---------- Оружие ---------- */
  blade: (m, d) => `<path d="M32 4 40 26v22H24V26z" fill="${m}"/>
    <path d="M32 4 40 26v22h-8z" fill="${HI264}"/>
    <rect x="16" y="46" width="32" height="6" rx="3" fill="${d}"/>
    <rect x="29" y="52" width="6" height="9" rx="2" fill="${d}"/>
    <circle cx="32" cy="61" r="3.4" fill="${m}"/>
    <path d="M32 10v34" stroke="${HI64}" stroke-width="2"/>`,

  dagger: (m, d) => `<path d="M32 6 38 24v16H26V24z" fill="${m}"/>
    <path d="M32 6 38 24v16h-6z" fill="${HI264}"/>
    <rect x="20" y="38" width="24" height="5" rx="2.5" fill="${d}"/>
    <rect x="29.5" y="43" width="5" height="12" rx="2" fill="${d}"/>
    <circle cx="32" cy="57" r="3.6" fill="${m}"/>`,

  hammer: (m, d) => `<rect x="29" y="22" width="6" height="36" rx="2.5" fill="${d}"/>
    <path d="M12 10h40v16H12z" fill="${m}" rx="3"/>
    <rect x="12" y="10" width="40" height="16" rx="4" fill="${m}"/>
    <rect x="14" y="13" width="12" height="6" rx="2" fill="${HI64}"/>
    <path d="M8 14h6v8H8z" fill="${d}"/><path d="M50 14h6v8h-6z" fill="${d}"/>`,

  /* ---------- Регалии ---------- */
  crown: (m, d) => `<path d="M8 46 12 17l13 12 7-17 7 17 13-12 4 29z" fill="${m}"/>
    <path d="M8 46h48v7H8z" fill="${d}"/>
    <path d="M32 12 39 29l-7 3-7-3z" fill="${HI64}"/>
    <circle cx="12" cy="16" r="3.6" fill="${d}"/><circle cx="52" cy="16" r="3.6" fill="${d}"/>
    <circle cx="32" cy="10" r="4" fill="${d}"/>
    <circle cx="32" cy="40" r="3.2" fill="${HI64}"/>`,

  throne: (m, d) => `<path d="M16 8h32v34H16z" fill="${m}"/>
    <path d="M32 8h16v34H32z" fill="${HI264}"/>
    <path d="M12 42h40v8H12z" fill="${d}"/>
    <path d="M14 50h7v10h-7zM43 50h7v10h-7z" fill="${d}"/>
    <path d="M20 4h6v6h-6zM38 4h6v6h-6z" fill="${m}"/>
    <path d="M24 16h16v14H24z" fill="${d}"/>
    <path d="m32 18 2.4 5 5.6.7-4 3.7 1 5.6-5-2.7-5 2.7 1-5.6-4-3.7 5.6-.7z" fill="${m}"/>`,

  goblet: (m, d) => `<path d="M18 10h28v12c0 8-6 13-14 13s-14-5-14-13z" fill="${m}"/>
    <path d="M32 10h14v12c0 7-5 12-12 12.8z" fill="${HI264}"/>
    <rect x="28" y="35" width="8" height="12" fill="${d}"/>
    <path d="M16 47h32l3 9H13z" fill="${m}"/>
    <path d="M11 56h42v4H11z" fill="${d}"/>
    <path d="M22 14h8" stroke="${HI64}" stroke-width="3" stroke-linecap="round"/>`,

  trophy: (m, d) => `<path d="M20 10h24v14c0 8-5 13-12 13s-12-5-12-13z" fill="${m}"/>
    <path d="M32 10h12v14c0 7-4 12-10 12.8z" fill="${HI264}"/>
    <path d="M20 13h-7v5c0 5 3 8 7 9zM44 13h7v5c0 5-3 8-7 9z" fill="${d}"/>
    <rect x="28" y="36" width="8" height="10" fill="${d}"/>
    <path d="M18 46h28l3 8H15z" fill="${m}"/><path d="M14 54h36v4H14z" fill="${d}"/>`,

  ring: (m, d) => `<circle cx="32" cy="40" r="17" fill="none" stroke="${m}" stroke-width="7"/>
    <circle cx="32" cy="40" r="17" fill="none" stroke="${HI64}" stroke-width="2"/>
    <path d="m32 6 8 12-8 8-8-8z" fill="${m}"/>
    <path d="m32 6 8 12-8 8z" fill="${HI264}"/>
    <path d="M24 18h16" stroke="${d}" stroke-width="2.4"/>`,

  /* ---------- Камни и кристаллы ---------- */
  crystal: (m, d) => `<path d="M32 4 52 22 32 60 12 22z" fill="${m}"/>
    <path d="M32 4 42 22 32 60 22 22z" fill="${HI264}"/>
    <path d="M12 22h40" stroke="${d}" stroke-width="2"/>
    <path d="M32 4 22 22h20z" fill="${HI64}"/>
    <path d="M12 22 32 60 22 22z" fill="${d}" opacity=".45"/>`,

  stone: (m, d) => `<path d="M10 40 20 18l18-6 18 12-6 24-22 8z" fill="${m}"/>
    <path d="M20 18l18-6 18 12-20 6z" fill="${HI264}"/>
    <path d="M36 30 56 24l-6 24-22 8z" fill="${d}" opacity=".5"/>
    <path d="M24 24l10 6" stroke="${HI64}" stroke-width="2.4"/>`,

  shard: (m, d) => `<path d="M24 6 42 20 34 40 18 34z" fill="${m}"/>
    <path d="M24 6 42 20 34 40z" fill="${HI264}"/>
    <path d="M34 40 46 54 28 58z" fill="${d}"/>
    <path d="M18 34 10 48l18 10z" fill="${m}" opacity=".7"/>`,

  heart: (m, d) => `<path d="M32 56S8 40 8 24a13 13 0 0 1 24-7 13 13 0 0 1 24 7c0 16-24 32-24 32z" fill="${m}"/>
    <path d="M32 17a13 13 0 0 1 24 7c0 16-24 32-24 32z" fill="${HI264}"/>
    <path d="M18 20a8 8 0 0 1 8-4" stroke="${HI64}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`,

  tear: (m, d) => `<path d="M32 6c10 14 16 21 16 29a16 16 0 0 1-32 0c0-8 6-15 16-29z" fill="${m}"/>
    <path d="M32 6c10 14 16 21 16 29a16 16 0 0 1-16 16z" fill="${HI264}"/>
    <ellipse cx="25" cy="38" rx="4" ry="6" fill="${HI64}" opacity=".7"/>`,

  /* ---------- Деньги ---------- */
  ingot: (m, d) => `<path d="M12 42h40l6 13H6z" fill="${m}"/>
    <path d="M12 42h40l2.4 5H9.6z" fill="${HI64}"/>
    <path d="M18 27h28l5 13H13z" fill="${m}"/>
    <path d="M18 27h28l2 4.4H16z" fill="${HI64}"/>
    <path d="M24 13h16l4 12H20z" fill="${m}"/>
    <path d="M24 13h16l1.4 3.6H22.6z" fill="${HI64}"/>
    <path d="M6 55h52l-1.5 3H7.5z" fill="${d}"/>`,

  coin: (m, d) => `<ellipse cx="32" cy="38" rx="22" ry="8" fill="${d}"/>
    <rect x="10" y="26" width="44" height="12" fill="${d}"/>
    <ellipse cx="32" cy="26" rx="22" ry="8" fill="${m}"/>
    <ellipse cx="32" cy="26" rx="14" ry="5" fill="${HI64}" opacity=".5"/>
    <path d="M29 21h5a3 3 0 0 1 0 6h-5zm0 3h-3" stroke="${d}" stroke-width="2" fill="none"/>`,

  chip: (m, d) => `<circle cx="32" cy="32" r="25" fill="${m}"/>
    <circle cx="32" cy="32" r="25" fill="none" stroke="${d}" stroke-width="9"
            stroke-dasharray="8 15.1" opacity=".9"/>
    <circle cx="32" cy="32" r="17" fill="none" stroke="${HI64}" stroke-width="2"/>
    <circle cx="32" cy="32" r="11" fill="${d}"/>
    <path d="M32 26.5 36 32l-4 5.5L28 32z" fill="${HI64}"/>`,

  note: (m, d) => `<g transform="rotate(-7 32 38)"><rect x="6" y="32" width="52" height="24" rx="3" fill="${d}"/></g>
    <g transform="rotate(4 32 32)">
      <rect x="6" y="24" width="52" height="24" rx="3" fill="${m}"/>
      <ellipse cx="32" cy="36" rx="10" ry="8" fill="none" stroke="${d}" stroke-width="2"/>
      <path d="M29 31h5a2.8 2.8 0 0 1 0 5.6h-5zm0 2.8h-2.4" stroke="${d}" stroke-width="2" fill="none"/>
      <circle cx="13" cy="30" r="2.8" fill="${d}" opacity=".6"/>
      <circle cx="51" cy="42" r="2.8" fill="${d}" opacity=".6"/></g>`,

  pouch: (m, d) => `<path d="M16 26h32c4 10 4 22-16 22S12 36 16 26z" fill="${m}"/>
    <path d="M32 26h16c4 10 4 22-16 22z" fill="${HI264}"/>
    <path d="M18 26c4-6 24-6 28 0" stroke="${d}" stroke-width="4" fill="none"/>
    <path d="M24 16l4 8M40 16l-4 8" stroke="${d}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="26" cy="36" r="3" fill="${HI64}" opacity=".7"/>`,

  /* ---------- Бумага ---------- */
  ticket: (m, d) => `<rect x="5" y="18" width="54" height="30" rx="5" fill="${m}"/>
    <circle cx="5" cy="33" r="5.5" fill="var(--notch)"/><circle cx="59" cy="33" r="5.5" fill="var(--notch)"/>
    <path d="M24 20v26" stroke="var(--notch)" stroke-width="2" stroke-dasharray="3.5 4"/>
    <rect x="30" y="25" width="24" height="3" rx="1.5" fill="${d}"/>
    <rect x="30" y="31.5" width="17" height="3" rx="1.5" fill="${d}" opacity=".7"/>
    <rect x="30" y="38" width="21" height="3" rx="1.5" fill="${d}" opacity=".5"/>
    <path d="M10 28h9v10h-9z" fill="${d}"/><path d="M12 30h5v6h-5z" fill="${HI64}"/>`,

  scroll: (m, d) => `<path d="M14 12h36v40H14z" fill="${m}"/>
    <path d="M32 12h18v40H32z" fill="${HI264}"/>
    <ellipse cx="14" cy="12" rx="5" ry="4" fill="${d}"/><ellipse cx="14" cy="52" rx="5" ry="4" fill="${d}"/>
    <ellipse cx="50" cy="12" rx="5" ry="4" fill="${d}"/><ellipse cx="50" cy="52" rx="5" ry="4" fill="${d}"/>
    <g stroke="${d}" stroke-width="2.4" opacity=".65">
      <path d="M21 22h22M21 30h22M21 38h14"/></g>`,

  scrap: (m, d) => `<path d="M12 14l16-4 24 6-3 18 4 14-20 6-18-8 2-16z" fill="${m}"/>
    <path d="M32 11l20 5-3 18 4 14-20 6z" fill="${HI264}"/>
    <g stroke="${d}" stroke-width="2.2" opacity=".6"><path d="M19 24h20M19 32h16M19 40h12"/></g>`,

  map: (m, d) => `<path d="M6 14l16-6 20 6 16-6v42l-16 6-20-6-16 6z" fill="${m}"/>
    <path d="M22 8v38M42 14v38" stroke="${d}" stroke-width="2.4"/>
    <path d="M42 8l16-6v42l-16 6z" fill="${HI264}"/>
    <path d="M14 24c6 2 10 8 18 6s12-8 18-4" stroke="${d}" stroke-width="2.4" fill="none" opacity=".7"/>
    <path d="m30 30 3 4 5-7" stroke="${HI64}" stroke-width="3" fill="none" stroke-linecap="round"/>`,

  /* ---------- Техника ---------- */
  core: (m, d) => `<circle cx="32" cy="32" r="14" fill="${m}"/>
    <circle cx="32" cy="32" r="7" fill="${HI64}"/>
    <g fill="none" stroke="${d}" stroke-width="3">
      <ellipse cx="32" cy="32" rx="26" ry="10"/>
      <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(60 32 32)"/>
      <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(-60 32 32)"/></g>`,

  cassette: (m, d) => `<rect x="10" y="16" width="44" height="32" rx="4" fill="${m}"/>
    <rect x="10" y="16" width="44" height="8" fill="${HI64}" opacity=".5"/>
    <rect x="16" y="28" width="32" height="14" rx="2" fill="${d}"/>
    <circle cx="24" cy="35" r="4" fill="${m}"/><circle cx="40" cy="35" r="4" fill="${m}"/>
    <path d="M16 48h8v8h-8zM40 48h8v8h-8z" fill="${d}"/>`,

  lamp: (m, d) => `<path d="M32 6a16 16 0 0 1 10 28v6H22v-6A16 16 0 0 1 32 6z" fill="${m}"/>
    <path d="M32 6a16 16 0 0 1 10 28v6h-10z" fill="${HI264}"/>
    <rect x="22" y="42" width="20" height="5" rx="2" fill="${d}"/>
    <rect x="24" y="49" width="16" height="5" rx="2" fill="${d}"/>
    <rect x="27" y="56" width="10" height="4" rx="2" fill="${d}"/>
    <path d="M26 18a9 9 0 0 1 7-5" stroke="${HI64}" stroke-width="3" fill="none" stroke-linecap="round"/>`,

  compass: (m, d) => `<circle cx="32" cy="32" r="24" fill="${m}"/>
    <circle cx="32" cy="32" r="18" fill="${d}"/>
    <path d="m44 20-8 18-18 8 8-18z" fill="${m}"/>
    <path d="m44 20-8 18-10-2z" fill="${HI64}"/>
    <circle cx="32" cy="32" r="3" fill="${m}"/>
    <path d="M32 4v6M32 54v6M4 32h6M54 32h6" stroke="${d}" stroke-width="3" stroke-linecap="round"/>`,

  /* ---------- Прочее ---------- */
  banner: (m, d) => `<path d="M14 6v54" stroke="${d}" stroke-width="4" stroke-linecap="round"/>
    <path d="M16 8h34l-6 11 6 11H16z" fill="${m}"/>
    <path d="M33 8h17l-6 11 6 11H33z" fill="${HI264}"/>
    <circle cx="14" cy="5" r="3.4" fill="${d}"/>
    <path d="M24 16h10" stroke="${d}" stroke-width="2.6" opacity=".6"/>`,

  cloak: (m, d) => `<path d="M32 8c-6 0-10 3-10 3L10 54h44L42 11s-4-3-10-3z" fill="${m}"/>
    <path d="M32 8c6 0 10 3 10 3l12 43H32z" fill="${HI264}"/>
    <path d="M22 11c4 8 16 8 20 0" stroke="${d}" stroke-width="3" fill="none"/>
    <circle cx="32" cy="18" r="4" fill="${d}"/>`,

  mask: (m, d) => `<path d="M4 26c0-7 9-10 28-10s28 3 28 10c0 11-9 20-28 20S4 37 4 26z" fill="${m}"/>
    <path d="M32 16c10 0 28 3 28 10 0 11-9 20-28 20z" fill="${HI264}"/>
    <ellipse cx="19" cy="27" rx="7.5" ry="5.5" fill="var(--notch)"/>
    <ellipse cx="45" cy="27" rx="7.5" ry="5.5" fill="var(--notch)"/>
    <path d="M14 16C8 8 10 2 16 2c0 5 2 9 6 11z" fill="${d}"/>
    <path d="M50 16c6-8 4-14-2-14 0 5-2 9-6 11z" fill="${d}"/>
    <path d="M8 24c8-4 16-5 24-5" stroke="${HI64}" stroke-width="2.4" fill="none"/>`,

  feather: (m, d) => `<path d="M44 8c8 10 6 26-6 36-7 6-16 8-22 8 0-8 2-18 8-25C33 19 38 12 44 8z" fill="${m}"/>
    <path d="M44 8c8 10 6 26-6 36-4 3-8 5-12 6L44 8z" fill="${HI264}"/>
    <path d="M44 8 16 52" stroke="${d}" stroke-width="2.6" stroke-linecap="round"/>
    <g stroke="${d}" stroke-width="1.6" opacity=".6"><path d="M38 16 28 20M35 24 24 28M31 32 20 37"/></g>`,

  fang: (m, d) => `<path d="M24 6c8 0 14 4 14 10 0 14-6 30-10 42-4-12-10-28-10-42 0-6 4-10 6-10z" fill="${m}"/>
    <path d="M28 6c6 1 10 4 10 10 0 14-6 30-10 42z" fill="${HI264}"/>
    <path d="M22 14c3-2 8-2 11 0" stroke="${HI64}" stroke-width="2.6" fill="none"/>`,

  scale: (m, d) => `<g fill="${m}">
      <path d="M32 6c7 0 12 5 12 11s-5 11-12 11-12-5-12-11 5-11 12-11z"/>
      <path d="M18 28c7 0 12 5 12 11s-5 11-12 11S6 45 6 39s5-11 12-11z"/>
      <path d="M46 28c7 0 12 5 12 11s-5 11-12 11-12-5-12-11 5-11 12-11z"/>
      <path d="M32 50c7 0 12 5 12 11H20c0-6 5-11 12-11z"/></g>
    <g fill="${HI264}"><path d="M32 6c7 0 12 5 12 11s-5 11-12 11z"/>
      <path d="M46 28c7 0 12 5 12 11s-5 11-12 11z"/></g>`,

  rune: (m, d) => `<rect x="12" y="6" width="40" height="52" rx="6" fill="${m}"/>
    <rect x="12" y="6" width="20" height="52" rx="6" fill="${HI264}"/>
    <g stroke="${d}" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M24 18v28M24 18l16 12M24 34l16-12"/></g>`,

  star: (m, d) => `<path d="m32 6 7.6 16.3 17.4 2.1-12.9 12 3.5 17.4L32 45.4 16.4 53.8l3.5-17.4-12.9-12 17.4-2.1z"
      fill="${m}" stroke="${d}" stroke-width="2"/>
    <path d="m32 14 4.6 10 10.6 1.3-7.9 7.3 2.1 10.6L32 38z" fill="${HI64}"/>`,

  skyline: (m, d) => `<circle cx="48" cy="14" r="6" fill="${HI64}"/>
    <path d="M6 54V30h9v24z" fill="${m}"/><path d="M17 54V20h10v34z" fill="${m}"/>
    <path d="M29 54V12h8v42z" fill="${d}"/><path d="M39 54V26h9v28z" fill="${m}"/>
    <path d="M50 54V34h8v20z" fill="${m}"/><path d="M4 54h56v4H4z" fill="${d}"/>
    <g fill="rgba(0,0,0,.35)"><rect x="19" y="25" width="3" height="4"/><rect x="23" y="25" width="3" height="4"/>
    <rect x="19" y="33" width="3" height="4"/><rect x="41" y="31" width="3" height="4"/></g>`,

  drum: (m, d) => `<path d="M12 18h40v22a20 8 0 0 1-40 0z" fill="${m}"/>
    <ellipse cx="32" cy="18" rx="20" ry="8" fill="${m}" stroke="${d}" stroke-width="2.5"/>
    <ellipse cx="32" cy="18" rx="13" ry="4.6" fill="${HI64}"/>
    <path d="M14 23 50 35M50 23 14 35" stroke="${d}" stroke-width="2.6"/>
    <path d="M12 40a20 8 0 0 0 40 0" fill="none" stroke="${d}" stroke-width="3.4"/>`,

  ball: (m, d) => `<circle cx="32" cy="32" r="24" fill="${m}"/>
    <path d="M32 8a24 24 0 0 1 0 48 30 30 0 0 0 0-48z" fill="${d}" opacity=".55"/>
    <path d="M32 8a24 24 0 0 0 0 48 30 30 0 0 1 0-48z" fill="${HI64}" opacity=".6"/>
    <path d="M8 32h48" stroke="${d}" stroke-width="2.4"/>
    <ellipse cx="32" cy="32" rx="10" ry="24" fill="none" stroke="${d}" stroke-width="2.4"/>`,

  dice: (m, d) => `<g transform="rotate(-12 32 32)">
    <rect x="12" y="12" width="40" height="40" rx="9" fill="${m}" stroke="${d}" stroke-width="1.6"/>
    <rect x="14" y="14" width="16" height="16" rx="5" fill="${HI64}" opacity=".35"/>
    <circle cx="23" cy="23" r="4" fill="${d}"/><circle cx="41" cy="23" r="4" fill="${d}"/>
    <circle cx="32" cy="32" r="4" fill="${d}"/>
    <circle cx="23" cy="41" r="4" fill="${d}"/><circle cx="41" cy="41" r="4" fill="${d}"/></g>`,

  deck: (m, d) => `<rect x="10" y="16" width="32" height="44" rx="4" fill="${d}" transform="rotate(-13 32 38)"/>
    <rect x="14" y="13" width="32" height="44" rx="4" fill="${m}" transform="rotate(-5 32 38)"/>
    <g transform="rotate(8 32 38)">
      <rect x="18" y="10" width="32" height="44" rx="4" fill="${m}" stroke="${HI64}" stroke-width="1.4"/>
      <path d="M34 22c-3.6 4.4-7 6.6-7 10.2a3.6 3.6 0 0 0 7 1.8 3.6 3.6 0 0 0 7-1.8c0-3.6-3.4-5.8-7-10.2z" fill="${d}"/>
      <rect x="31" y="34" width="6" height="7" rx="1.4" fill="${d}"/></g>`,

  spins: (m, d) => `<path d="M32 9a23 23 0 1 1-16.3 6.7" fill="none" stroke="${m}" stroke-width="6.5"
      stroke-linecap="round"/>
    <path d="M8 8.5 18 18.5 8 20.5z" fill="${m}" transform="rotate(-8 13 14)"/>
    <path d="m32 19 4 8.6 9.4 1.2-7 6.4 2 9.4L32 39.8 23.6 44.6l2-9.4-7-6.4 9.4-1.2z"
      fill="${m}" stroke="${d}" stroke-width="1.4"/>
    <circle cx="32" cy="32" r="3" fill="${HI64}"/>`,

  x2: (m, d) => `<circle cx="32" cy="32" r="25" fill="${m}"/>
    <circle cx="32" cy="32" r="19" fill="${d}"/>
    <text x="32" y="41" font-family="system-ui,sans-serif" font-size="22" font-weight="800"
          fill="${m}" text-anchor="middle">×2</text>
    <path d="M14 22a25 25 0 0 1 14-12" stroke="${HI64}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`,

  sand: (m, d) => `<circle cx="47" cy="16" r="8" fill="${HI64}"/>
    <path d="M4 44c10-10 20 4 30-4s18 2 26-4v22H4z" fill="${m}"/>
    <path d="M4 52c10-8 20 4 30-3s18 1 26-5v14H4z" fill="${d}"/>
    <g fill="${HI64}"><circle cx="18" cy="48" r="1.6"/><circle cx="30" cy="52" r="1.6"/>
    <circle cx="44" cy="48" r="1.6"/></g>`,
};

/*
 * Ключевые слова. Порядок значим: выигрывает первое совпадение, поэтому узкие
 * правила стоят выше широких. «Перо с карнавала» обязано попасть в перо, а не
 * в маску, хотя слово «карнавал» есть в обоих.
 */
const MATCH64 = [
  [/фриспин|вращен|прокрут/i, 'spins'],
  [/удвоит|множител|×2|x2/i, 'x2'],
  [/перо|крыл/i, 'feather'],
  [/ключ/i, 'key'],
  [/замок|засов|затвор/i, 'lock'],
  [/печат|клейм|жетон|медал|орден/i, 'seal'],
  [/сундук|сейф|казна|клад|банк|хранилищ/i, 'chest'],
  [/кинжал|нож(?![а-яё])|стилет/i, 'dagger'],
  [/клинок|меч|катана|сабл|лезви/i, 'blade'],
  [/молот|кирка|топор|кувалд/i, 'hammer'],
  [/корона|венец|диадем/i, 'crown'],
  [/трон|престол/i, 'throne'],
  [/кубок|чаш|бокал|грааль/i, 'goblet'],
  [/трофей|приз|чемпион|победа|триумф/i, 'trophy'],
  [/кольц|перстен|обруч/i, 'ring'],
  [/кристалл|самоцвет|алмаз|бриллиант|изумруд|рубин|сапфир/i, 'crystal'],
  [/осколок|обломок|скол/i, 'shard'],
  [/камен|камн|порода|валун|гранит/i, 'stone'],
  [/сердц/i, 'heart'],
  [/слеза|капл|роса/i, 'tear'],
  [/слиток|золот(о|а)\b|брусок/i, 'ingot'],
  [/монет|дублон|талер/i, 'coin'],
  [/фишк/i, 'chip'],
  [/купюр|банкнот|пачк|деньг|наличн/i, 'note'],
  [/мешоч|горсть|щепот|кисет|мешок|сумк/i, 'pouch'],
  [/билет|ложа|проход|пропуск|абонемент|заявк|право/i, 'ticket'],
  [/свиток|манускрипт|грамот|указ/i, 'scroll'],
  [/обрывок|клочок|записк|лоскут/i, 'scrap'],
  [/карта|план|чертёж|чертеж|схем/i, 'map'],
  [/ядро|реактор|двигател|сфер|орбит/i, 'core'],
  [/кассет|контейнер|модул|блок пит|батаре/i, 'cassette'],
  [/лампа|факел|фонар|пламя|огон|свеч|горн/i, 'lamp'],
  [/компас|секстант|навигат/i, 'compass'],
  [/знам|флаг|штандарт|вымпел/i, 'banner'],
  [/плащ|мантия|накидк|шкур|мех/i, 'cloak'],
  [/маск|личин|лицо/i, 'mask'],
  [/клык|зуб|коготь|бивень/i, 'fang'],
  [/чешу|панцир|шип/i, 'scale'],
  [/руна|символ|знак|тайна|слово/i, 'rune'],
  [/город|панорам|небоскрёб|небоскреб|квартал|улиц/i, 'skyline'],
  [/барабан|бубен|литавр/i, 'drum'],
  [/мяч|шар(?![а-яё])/i, 'ball'],
  [/кост(и|ей)|кубик|зар(ы|ь)/i, 'dice'],
  [/колод|карты игральн|туз/i, 'deck'],
  [/песок|пляж|дюн|бархан/i, 'sand'],
  [/звезд|сияни|блеск|легенд|слава/i, 'star'],
];

/** Мотив по названию; null, если знакомых слов не нашлось. */
export function art64For(name) {
  for (const [re, key] of MATCH64) if (re.test(name)) return key;
  return null;
}

/**
 * Крупный рисунок предмета, залитый материалом карточки.
 *
 * Возвращает null на незнакомом названии - вызывающий код откатится на
 * item-art.js, а оттуда на значок уровня редкости.
 */
export function itemArt64(name) {
  const key = art64For(name);
  if (!key) return null;
  const id = `a${(seq64++).toString(36)}`;
  return `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">${defs64(id)}` +
         `${ART64[key](`url(#${id})`, `url(#${id}d)`)}</svg>`;
}

/** Сколько мотивов в наборе - для проверок. */
export const ART64_COUNT = Object.keys(ART64).length;
