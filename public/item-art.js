/**
 * Рисунки предметов.
 *
 * Раньше на плитке стоял значок уровня редкости — один и тот же ромб на сотни
 * разных названий. Здесь у каждого предмета свой мотив: «Кувшин вина» — кувшин,
 * «Катана мастера» — клинок, «Яхта на рейде» — яхта.
 *
 * Мотивов около шестидесяти, а названий больше семисот, поэтому рисунок
 * подбирается по ключевым словам названия, а не заводится под каждое отдельно.
 * Такой словарь переживает добавление новых предметов: пока в названии есть
 * знакомое слово, картинка найдётся сама.
 *
 * Рисунки рассчитаны на 34 пикселя — это размер значка на плитке. Поэтому
 * силуэт крупный и без мелочи: на таком размере тонкие детали сливаются.
 * Цвет приходит снаружи — он берётся от уровня редкости, и один и тот же
 * мотив в дешёвом кейсе серый, а в дорогом золотой.
 */

const S = (body) => `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;

/** Тёмный контур: на светлом мотиве держит форму, на тёмном фоне — силуэт. */
const INK = '#140720';

const ART = {
  /* ---------- Кузница, оружие ---------- */
  hammer: (c) => S(`<rect x="10.6" y="9" width="2.8" height="12" rx="1.2" fill="${INK}"/>
    <rect x="5" y="3" width="14" height="6.4" rx="1.8" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="6.6" y="4.6" width="4" height="3.2" rx="0.8" fill="#fff" opacity="0.3"/>`),
  anvil: (c) => S(`<path d="M3 8h14l-2.4 3.6H8.6L3 8Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="9" y="11.4" width="5" height="4.6" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="5.6" y="16" width="12" height="3.4" rx="1" fill="${c}" stroke="${INK}" stroke-width="1.2"/>`),
  blade: (c) => S(`<path d="M12 2 15 9v8h-6V9l3-7Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="7" y="17" width="10" height="2.4" rx="1" fill="${INK}"/>
    <rect x="11" y="19.4" width="2" height="3" rx="1" fill="${INK}"/>
    <path d="M12 3.6V16" stroke="#fff" stroke-width="1" opacity="0.45"/>`),
  dagger: (c) => S(`<path d="M12 2.5 14.4 11 12 14 9.6 11 12 2.5Z" fill="${c}" stroke="${INK}" stroke-width="1.1"/>
    <rect x="7.6" y="13.6" width="8.8" height="2" rx="1" fill="${INK}"/>
    <rect x="11.1" y="15.6" width="1.8" height="6" rx="0.9" fill="${INK}"/>`),
  ingot: (c) => S(`<path d="M4 15h16l-2.6-5.4H6.6L4 15Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="4" y="15" width="16" height="4" rx="1" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M7 11h7" stroke="#fff" stroke-width="1.2" opacity="0.4"/>`),
  nail: (c) => S(`<rect x="9" y="3" width="6" height="2.6" rx="1" fill="${c}" stroke="${INK}" stroke-width="1"/>
    <path d="M11 5.6h2l-1 15-1-15Z" fill="${c}" stroke="${INK}" stroke-width="1"/>`),
  tongs: (c) => S(`<path d="M8 21 11 11 8 4" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M16 21 13 11l3-7" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="12" cy="11" r="1.8" fill="${INK}"/>`),

  /* ---------- Деньги, хранилище ---------- */
  coin: (c) => S(`<circle cx="12" cy="12" r="8.6" fill="${c}" stroke="${INK}" stroke-width="1.3"/>
    <circle cx="12" cy="12" r="5.6" fill="none" stroke="${INK}" stroke-width="1" opacity="0.5"/>
    <path d="M12 8v8M10 10h3.4a1.6 1.6 0 0 1 0 3.2H10" stroke="${INK}" stroke-width="1.4"
      stroke-linecap="round"/>`),
  bill: (c) => S(`<rect x="2.6" y="6.4" width="18.8" height="11.2" rx="1.8" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="3.1" fill="none" stroke="${INK}" stroke-width="1.3"/>
    <path d="M5.4 9.2h1.6M17 14.8h1.6" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>`),
  safe: (c) => S(`<rect x="3.4" y="4" width="17.2" height="16" rx="2.4" fill="${c}"
      stroke="${INK}" stroke-width="1.3"/>
    <circle cx="14" cy="12" r="3.6" fill="none" stroke="${INK}" stroke-width="1.4"/>
    <path d="M14 8.4v7.2M10.4 12h7.2" stroke="${INK}" stroke-width="1.2"/>
    <rect x="5.6" y="7" width="2.6" height="10" rx="1" fill="${INK}" opacity="0.35"/>`),
  key: (c) => S(`<circle cx="8" cy="8" r="4.4" fill="none" stroke="${c}" stroke-width="2.2"/>
    <path d="m11.2 11.2 8.4 8.4" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="m16.6 16.6 2 2M14.4 18.8l1.6 1.6" stroke="${c}" stroke-width="2.2"
      stroke-linecap="round"/>`),
  chest: (c) => S(`<path d="M3.6 10.4a8.4 8.4 0 0 1 16.8 0Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="3.6" y="10.4" width="16.8" height="8.6" rx="1.6" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="10.6" y="11.6" width="2.8" height="4.4" rx="1" fill="${INK}"/>`),
  card: (c) => S(`<rect x="4.4" y="3" width="15.2" height="18" rx="2.2" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M12 7.4 15 11l-3 3.6L9 11l3-3.6Z" fill="${INK}"/>`),
  chip: (c) => S(`<circle cx="12" cy="12" r="8.6" fill="${c}" stroke="${INK}" stroke-width="1.3"/>
    <circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" stroke-width="1.6" opacity="0.65"/>
    <path d="M12 3.4v3M12 17.6v3M3.4 12h3M17.6 12h3" stroke="${INK}" stroke-width="1.8"
      stroke-linecap="round"/>`),
  dice: (c) => S(`<rect x="4" y="4" width="16" height="16" rx="3.4" fill="${c}"
      stroke="${INK}" stroke-width="1.3"/>
    <circle cx="8.6" cy="8.6" r="1.5" fill="${INK}"/><circle cx="15.4" cy="8.6" r="1.5" fill="${INK}"/>
    <circle cx="12" cy="12" r="1.5" fill="${INK}"/>
    <circle cx="8.6" cy="15.4" r="1.5" fill="${INK}"/><circle cx="15.4" cy="15.4" r="1.5" fill="${INK}"/>`),

  /* ---------- Регалии ---------- */
  crown: (c) => S(`<path d="M3 17.6 4.6 6.4l4.4 4.2L12 4l3 6.6 4.4-4.2L21 17.6H3Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="3" y="17.6" width="18" height="2.8" rx="1" fill="${INK}" opacity="0.6"/>`),
  cup: (c) => S(`<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M7 5.6H4.6v2A3.4 3.4 0 0 0 7 10.8M17 5.6h2.4v2A3.4 3.4 0 0 1 17 10.8"
      stroke="${INK}" stroke-width="1.2"/>
    <rect x="10.8" y="14" width="2.4" height="4" fill="${INK}"/>
    <rect x="7.6" y="18" width="8.8" height="2.4" rx="1" fill="${INK}"/>`),
  ring: (c) => S(`<circle cx="12" cy="14.4" r="6" fill="none" stroke="${c}" stroke-width="2.4"/>
    <path d="m12 3.2 3 3.6-3 3.4-3-3.4 3-3.6Z" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`),
  seal: (c) => S(`<circle cx="12" cy="9.6" r="6" fill="${c}" stroke="${INK}" stroke-width="1.3"/>
    <path d="M9 9.6h6M12 6.6v6" stroke="${INK}" stroke-width="1.5"/>
    <path d="M8.4 14.6 7 21.4l5-2.4 5 2.4-1.4-6.8" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>`),
  scroll: (c) => S(`<rect x="5" y="4.6" width="14" height="14.8" rx="2" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M8 9h8M8 12h8M8 15h5" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`),
  mask: (c) => S(`<path d="M4 6.6h16v6.2c0 4.4-3.4 8.4-8 8.4s-8-4-8-8.4V6.6Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M8 11.2c1.2-1.2 2.6-1.2 3.6 0M12.4 11.2c1.2-1.2 2.6-1.2 3.6 0"
      stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>`),
  skull: (c) => S(`<path d="M12 3a8 8 0 0 0-8 8c0 3 1.6 4.6 3 5.6V20h10v-3.4c1.4-1 3-2.6 3-5.6a8 8 0 0 0-8-8Z"
      fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="9" cy="11" r="2" fill="${INK}"/><circle cx="15" cy="11" r="2" fill="${INK}"/>
    <path d="M11 15.4h2" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`),

  /* ---------- Море, пираты ---------- */
  anchor: (c) => S(`<circle cx="12" cy="4.6" r="2.4" fill="none" stroke="${c}" stroke-width="1.8"/>
    <path d="M12 7v13M6.4 9.6h11.2" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
    <path d="M4.6 14.4c0 3.6 3.4 6 7.4 6s7.4-2.4 7.4-6" stroke="${c}" stroke-width="2"
      stroke-linecap="round"/>`),
  compass: (c) => S(`<circle cx="12" cy="12" r="8.6" fill="${c}" stroke="${INK}" stroke-width="1.3"/>
    <path d="m15.4 8.6-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" fill="${INK}"/>`),
  shell: (c) => S(`<path d="M12 20.4C6.6 20.4 3 15.4 3 10.6A9 9 0 0 1 21 10.6c0 4.8-3.6 9.8-9 9.8Z"
      fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M12 20V4M8 19.4 6 6M16 19.4 18 6" stroke="${INK}" stroke-width="1" opacity="0.55"/>`),
  pearl: (c) => S(`<circle cx="12" cy="11" r="6.6" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="9.6" cy="8.6" r="2" fill="#fff" opacity="0.55"/>`),
  trident: (c) => S(`<path d="M12 4v17M6 6v3.6a6 6 0 0 0 12 0V6" stroke="${c}" stroke-width="2.2"
      stroke-linecap="round"/>
    <path d="m12 2 1.6 2.6h-3.2L12 2Z" fill="${c}"/>`),
  ship: (c) => S(`<path d="M3 15.6h18l-2.6 4.4H5.6L3 15.6Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M12 3v12" stroke="${INK}" stroke-width="1.6"/>
    <path d="M12.8 4.4 18 9l-5.2 2.6V4.4Z" fill="${c}" stroke="${INK}" stroke-width="1.1"/>
    <path d="M11.2 6 7 9.6l4.2 2V6Z" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`),
  flag: (c) => S(`<path d="M6 3v18" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M7.4 4.2h11.4l-2.6 3.8 2.6 3.8H7.4V4.2Z" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`),

  /* ---------- Природа, стихии ---------- */
  flame: (c) => S(`<path d="M12 2.4c3.4 4 5.6 6.4 5.6 10.2A5.6 5.6 0 0 1 12 21.6a5.6 5.6 0 0 1-5.6-9
      c0-3.8 2.2-6.2 5.6-10.2Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M12 12c1.6 1.8 2.4 2.8 2.4 4.2A2.4 2.4 0 0 1 12 18.8a2.4 2.4 0 0 1-2.4-4.2c0-1.4.8-2.4 2.4-4.6Z"
      fill="#fff" opacity="0.45"/>`),
  snow: (c) => S(`<path d="M12 2v20M3.4 7 20.6 17M20.6 7 3.4 17" stroke="${c}" stroke-width="2"
      stroke-linecap="round"/>
    <path d="M9 4.4 12 6.6l3-2.2M9 19.6l3-2.2 3 2.2" stroke="${c}" stroke-width="1.7"
      stroke-linecap="round"/>`),
  bolt: (c) => S(`<path d="M13.6 2 5 13.4h5.4L9.4 22 19 10.4h-5.6L13.6 2Z" fill="${c}"
      stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`),
  feather: (c) => S(`<path d="M18.6 4.2c-7 0-11.4 4.6-11.4 10.2 0 1.6.4 3 1 4.2L19 6.8c-.2-1-.4-2-.4-2.6Z"
      fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M4.4 20.6 12 13" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`),
  leaf: (c) => S(`<path d="M20 4C10 4 4 9 4 15.4c0 2 .6 3.6 1.6 4.8C12 20 20 14.6 20 4Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M5.6 20.2 16 7.4" stroke="${INK}" stroke-width="1.2" opacity="0.6"/>`),
  palm: (c) => S(`<path d="M11 21c0-6 .6-10 2-12" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M13 8c-3-2.6-6.4-2-8 .6M13 8c3.6-1.8 6.8-.4 8 2.4M13 8c-1.6-3.4-.4-6 2.4-7"
      stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`),
  gem: (c) => S(`<path d="M7 3h10l4 6-9 12L3 9l4-6Z" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>
    <path d="M3 9h18M7 3l5 18M17 3l-5 18" stroke="${INK}" stroke-width="1" opacity="0.5"/>`),
  star: (c) => S(`<path d="m12 2.6 2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.4l-6.1 3.6 1.5-6.8L2.2 9.6l6.9-.7L12 2.6Z"
      fill="${c}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`),
  moon: (c) => S(`<path d="M20 15.4A9 9 0 0 1 8.6 4 9.2 9.2 0 1 0 20 15.4Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>`),
  planet: (c) => S(`<circle cx="12" cy="11" r="6.4" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <ellipse cx="12" cy="13.4" rx="10.4" ry="3.2" fill="none" stroke="${INK}" stroke-width="1.4"
      transform="rotate(-18 12 13.4)"/>`),

  /* ---------- Техника ---------- */
  gear: (c) => S(`<path d="M12 2.6 14 5l3-.8.6 3.1 2.8 1.5-1.6 2.7 1.6 2.7-2.8 1.5-.6 3.1-3-.8-2 2.4-2-2.4
      -3 .8-.6-3.1-2.8-1.5L4.2 12 2.6 9.3l2.8-1.5L6 4.7l3 .8 2-2.9Z" fill="${c}"
      stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="3" fill="${INK}"/>`),
  watch: (c) => S(`<circle cx="12" cy="12" r="6.6" fill="${c}" stroke="${INK}" stroke-width="1.3"/>
    <path d="M12 8.4V12l2.6 1.8" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M9.4 5.6 10 2.4h4l.6 3.2M9.4 18.4 10 21.6h4l.6-3.2" fill="${c}" stroke="${INK}"
      stroke-width="1.1"/>`),
  cpu: (c) => S(`<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1" fill="${INK}"/>
    <path d="M9 6.4V3.4M15 6.4V3.4M9 20.6v-3M15 20.6v-3M6.4 9H3.4M6.4 15H3.4M20.6 9h-3M20.6 15h-3"
      stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`),
  server: (c) => S(`<rect x="4" y="3.4" width="16" height="5.6" rx="1.6" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <rect x="4" y="10.2" width="16" height="5.6" rx="1.6" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="4" y="17" width="16" height="4" rx="1.6" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="7.4" cy="6.2" r="1" fill="${INK}"/><circle cx="7.4" cy="13" r="1" fill="${INK}"/>`),
  rocket: (c) => S(`<path d="M12 2c3.4 3 5 6.6 5 10.4l-2.4 3h-5.2L7 12.4C7 8.6 8.6 5 12 2Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <circle cx="12" cy="9.4" r="2" fill="${INK}"/>
    <path d="M9.4 15.4 7 20l3.4-1.4M14.6 15.4 17 20l-3.4-1.4" fill="${c}" stroke="${INK}"
      stroke-width="1.1"/>`),
  bulb: (c) => S(`<path d="M12 2.6a6.6 6.6 0 0 0-3.6 12.2v2.2h7.2v-2.2A6.6 6.6 0 0 0 12 2.6Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <rect x="9.2" y="17.6" width="5.6" height="3.4" rx="1.2" fill="${INK}"/>`),
  flask: (c) => S(`<path d="M9.6 3v6.4L4.8 18a2.6 2.6 0 0 0 2.2 3.8h10a2.6 2.6 0 0 0 2.2-3.8L14.4 9.4V3"
      fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M8.4 3h7.2" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M7 15.6h10" stroke="${INK}" stroke-width="1.2" opacity="0.55"/>`),

  /* ---------- Транспорт, город ---------- */
  car: (c) => S(`<path d="M3.4 15.4 5 10.4A2.4 2.4 0 0 1 7.2 8.8h9.6a2.4 2.4 0 0 1 2.2 1.6l1.6 5"
      fill="${c}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="2.6" y="14.6" width="18.8" height="3.6" rx="1.6" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="7" cy="18.4" r="2.2" fill="${INK}"/><circle cx="17" cy="18.4" r="2.2" fill="${INK}"/>`),
  wheel: (c) => S(`<circle cx="12" cy="12" r="8.6" fill="${INK}"/>
    <circle cx="12" cy="12" r="5" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="1.6" fill="${INK}"/>
    <path d="M12 7v10M7 12h10" stroke="${INK}" stroke-width="1.3"/>`),
  steering: (c) => S(`<circle cx="12" cy="12" r="8.6" fill="none" stroke="${c}" stroke-width="2.2"/>
    <circle cx="12" cy="12" r="2.6" fill="${c}"/>
    <path d="M12 9.4V4M9.6 13.4 5 17M14.4 13.4 19 17" stroke="${c}" stroke-width="2"
      stroke-linecap="round"/>`),
  plane: (c) => S(`<path d="M11 2.6c1.2 0 1.8 1 1.8 2.2v4.4l8 4.6v2.4l-8-2.4v4l2.6 2v1.8L11 20.4
      l-4.4 1.2v-1.8l2.6-2v-4l-8 2.4v-2.4l8-4.6V4.8c0-1.2.6-2.2 1.8-2.2Z" fill="${c}"
      stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`),
  tower: (c) => S(`<path d="M9 21V6l3-4 3 4v15" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>
    <rect x="5" y="12" width="4" height="9" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="15" y="9" width="4" height="12" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M11 9h2M11 13h2M11 17h2" stroke="${INK}" stroke-width="1.1"/>`),
  yacht: (c) => S(`<path d="M2.6 16.4h18.8l-2.4 4H5L2.6 16.4Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M6 16.4V9.4h12l-2.6 7" fill="${c}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M8.4 9.4V5.6h6" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`),

  /* ---------- Быт, еда, вещи ---------- */
  jug: (c) => S(`<path d="M8.6 3h6.8l-.6 2.6c2.4 1.4 3.8 3.8 3.8 6.6v6.2a2.6 2.6 0 0 1-2.6 2.6H8
      a2.6 2.6 0 0 1-2.6-2.6v-6.2c0-2.8 1.4-5.2 3.8-6.6L8.6 3Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M18.6 9.4c1.8 0 3 1.2 3 3s-1.2 3-3 3" fill="none" stroke="${INK}" stroke-width="1.4"/>
    <path d="M7.6 13.6h8.8" stroke="${INK}" stroke-width="1.1" opacity="0.55"/>`),
  glass: (c) => S(`<path d="M6.6 3h10.8l-1.2 7a4.4 4.4 0 0 1-8.4 0L6.6 3Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="11" y="14" width="2" height="5.6" fill="${INK}"/>
    <rect x="7.6" y="19.6" width="8.8" height="2" rx="1" fill="${INK}"/>`),
  bottle: (c) => S(`<path d="M10 2.6h4v3.8l2.4 3.2c.6.8 1 1.8 1 2.8v7a2 2 0 0 1-2 2H8.6a2 2 0 0 1-2-2v-7
      c0-1 .4-2 1-2.8L10 6.4V2.6Z" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>
    <rect x="8" y="12.6" width="8" height="4" rx="1" fill="#fff" opacity="0.35"/>`),
  lamp: (c) => S(`<path d="M6 15.6c0-3 2.6-5.4 6.4-5.4 3.4 0 6 1.8 6 4 0 1-.6 1.6-1.6 1.6H6Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M6 15.6h11.6v1.6c0 1.2-1 2.2-2.2 2.2H8.2c-1.2 0-2.2-1-2.2-2.2v-1.6Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M18.4 11.4 22 8.6M12.4 10.2V6.6" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`),
  hat: (c) => S(`<path d="M8 3.4h8v9H8v-9Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="3.4" y="12" width="17.2" height="3" rx="1.5" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="8" y="9" width="8" height="3" fill="${INK}" opacity="0.6"/>`),
  ticket: (c) => S(`<path d="M3 7.4h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4v-3Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M12 8.6v1.8M12 13.6v1.8" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`),
  drum: (c) => S(`<ellipse cx="12" cy="7.6" rx="8" ry="3.4" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M4 7.6v8.8c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4V7.6" fill="${c}" stroke="${INK}"
      stroke-width="1.2"/>
    <path d="m5.4 10 13.2 4M18.6 10 5.4 14" stroke="${INK}" stroke-width="1.1" opacity="0.6"/>`),
  balloon: (c) => S(`<ellipse cx="12" cy="9.4" rx="6.4" ry="7.4" fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <path d="m12 16.8-1.4 2h2.8L12 16.8Z" fill="${INK}"/>
    <path d="M12 19c0 2-2 1.6-2 3.2" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>
    <ellipse cx="9.6" cy="7" rx="1.6" ry="2.2" fill="#fff" opacity="0.45"
      transform="rotate(-20 9.6 7)"/>`),
  flower: (c) => S(`<circle cx="12" cy="9" r="2.4" fill="${INK}"/>
    ${[0, 72, 144, 216, 288].map((a) =>
      `<ellipse cx="12" cy="4.6" rx="2.4" ry="3.6" fill="${c}" stroke="${INK}" stroke-width="1"
        transform="rotate(${a} 12 9)"/>`).join('')}
    <path d="M12 12v9" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`),
  cat: (c) => S(`<path d="M6 9 5 3.6 9.4 6.4a9 9 0 0 1 5.2 0L19 3.6 18 9c1.2 1.4 2 3.2 2 5.2
      0 4-3.6 6.8-8 6.8s-8-2.8-8-6.8c0-2 .8-3.8 2-5.2Z" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>
    <circle cx="9.2" cy="13" r="1.4" fill="${INK}"/><circle cx="14.8" cy="13" r="1.4" fill="${INK}"/>
    <path d="M11 16.4h2" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>`),
  pyramid: (c) => S(`<path d="M12 3 22 19.6H2L12 3Z" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>
    <path d="M12 3v16.6M12 3 6 19.6M12 3l6 16.6" stroke="${INK}" stroke-width="1" opacity="0.45"/>`),
  eye: (c) => S(`<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12Z"
      fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="3.4" fill="${INK}"/>
    <circle cx="10.8" cy="10.8" r="1.1" fill="#fff" opacity="0.7"/>`),
  wing: (c) => S(`<path d="M21 5c-8 0-14 4.6-14 10.4 0 1.4.3 2.6.8 3.6C16 18 21 12.4 21 5Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <path d="M18.4 7.6C13 8.6 9.6 12 9 16.6" stroke="${INK}" stroke-width="1.1" opacity="0.6"/>`),
  egg: (c) => S(`<path d="M12 2.6c4 0 7 6 7 10.4 0 4.6-3.2 8-7 8s-7-3.4-7-8C5 8.6 8 2.6 12 2.6Z"
      fill="${c}" stroke="${INK}" stroke-width="1.2"/>
    <ellipse cx="9.6" cy="9.6" rx="1.6" ry="2.4" fill="#fff" opacity="0.4"
      transform="rotate(-20 9.6 9.6)"/>`),
  helmet: (c) => S(`<path d="M4.6 16.4C4.6 9.6 8 5 12 5s7.4 4.6 7.4 11.4H4.6Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="3.6" y="16.4" width="16.8" height="3" rx="1.4" fill="${INK}"/>
    <path d="M12 5V2M8 8.6c2.6-1.4 5.4-1.4 8 0" stroke="${INK}" stroke-width="1.3"
      stroke-linecap="round"/>`),
  spray: (c) => S(`<rect x="7.4" y="7" width="9.2" height="14" rx="2.2" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <rect x="9.6" y="3" width="4.8" height="4" rx="1.2" fill="${INK}"/>
    <path d="M17.6 5.4h2.8M17.6 8.4h2.8" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`),
  shoe: (c) => S(`<path d="M3 17.4V12c2.4 0 3.6-1.2 5.4-1.2 1.4 0 2 .8 3.4 1.8 1.8 1.2 4 1.6 7 1.8
      1.6.1 2.2.9 2.2 2v1H3Z" fill="${c}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="2.6" y="17.4" width="18.8" height="2.6" rx="1.2" fill="${INK}"/>`),
  gun: (c) => S(`<path d="M3.4 8.6h13v4h-2.8l-1.6 3H8.4l-.6-3H6l-2.6 4V8.6Z" fill="${c}"
      stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="9" cy="10.6" r="1.6" fill="${INK}"/>
    <rect x="16.4" y="9.4" width="4.2" height="2.4" rx="1" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`),
  smoke: (c) => S(`<rect x="2.6" y="12.6" width="14" height="4.4" rx="1.4" fill="${c}"
      stroke="${INK}" stroke-width="1.2"/>
    <rect x="17.4" y="12.6" width="4" height="4.4" rx="1.4" fill="${INK}"/>
    <path d="M6.4 12.6V17M10.4 12.6V17" stroke="${INK}" stroke-width="1.1"/>
    <path d="M18 8.6c0-2 2-2 2-4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`),
  carpet: (c) => S(`<path d="M3 8c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0v8c-2-1.4-4-1.4-6 0s-4 1.4-6 0-4-1.4-6 0V8Z"
      fill="${c}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M3 12c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0" stroke="${INK}" stroke-width="1"
      opacity="0.5"/>`),
  sand: (c) => S(`<path d="M2 18c3-5 5-7 8-7s4 3 6 3 3-2 6-5v9H2Z" fill="${c}" stroke="${INK}"
      stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="17.4" cy="6.4" r="2.6" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`),
  tent: (c) => S(`<path d="M12 3 22 20H2L12 3Z" fill="${c}" stroke="${INK}" stroke-width="1.2"
      stroke-linejoin="round"/>
    <path d="M12 8.6 16.6 20H7.4L12 8.6Z" fill="${INK}" opacity="0.55"/>`),
};

/**
 * Ключевые слова → мотив. Порядок важен: список просматривается сверху вниз,
 * поэтому частные правила («золотой слиток») должны стоять раньше общих
 * («золото»). Первое совпадение и выигрывает.
 */
const MATCH = [
  [/молот|кувалд/i, 'hammer'],
  [/наковальн/i, 'anvil'],
  [/клинок|катана|меч|сабл|клык|вакидзаси|резец|зубил|коса/i, 'blade'],
  [/кинжал|нож|танто|игл/i, 'dagger'],
  [/слиток|брусок|заготовк|сталь|окалин|базальт/i, 'ingot'],
  [/гвозд|шуруп|штырь/i, 'nail'],
  [/пружин|гайк|вентил|шестерн|винт|подшипник/i, 'gear'],
  [/клещ|щипц/i, 'tongs'],

  [/монет|дублон|грош|динар|жетон|медал/i, 'coin'],
  [/купюр|банкнот|пачка купюр|деньг|чек|талон|купон|конверт|грамот|патент|доля|акци/i, 'bill'],
  [/сейф|ячейк|хранилищ|депозит|банк|касс|фонд|запас|портфел/i, 'safe'],
  [/ключ|отмычк|замок|засов|доступ|пропуск|прописк|швартовк/i, 'key'],
  [/сундук|ларец|клад|сокровищ|шкатул|кофр/i, 'chest'],
  [/карт[аы]? |колод|флеш|каре|туз|игральн/i, 'card'],
  [/фишк|фишек/i, 'chip'],
  [/кубик|кост[ия]|стакан для/i, 'dice'],

  [/корон|венец|титул|диадем/i, 'crown'],
  [/кубок|чаш|трофе|гран-при|браслет|подиум|овац|аншлаг|чемпион/i, 'cup'],
  [/кольц|перстен|запонк|ожерель|цеп[ьи]|гриллз/i, 'ring'],
  [/печат|герб|подпис|клятв|договор|право|слово|имя|указ/i, 'seal'],
  [/свиток|папирус|бумаг|досье|список|книг|чертёж|афиш|формул|рецепт|код|дело/i, 'scroll'],
  [/маск|шут|личин/i, 'mask'],
  // «Черепок» — это осколок посуды, а не череп: частное правило должно стоять
  // выше общего, иначе от амфоры остаётся скелет.
  [/черепок|черепк/i, 'jug'],
  [/череп(?![а-яёa-z])|черепа|скелет|кост[ья]ной|метк/i, 'skull'],

  [/якор/i, 'anchor'],
  [/компас|навигац|азимут/i, 'compass'],
  [/раковин|ракушк|коралл/i, 'shell'],
  [/жемчуг|жемчужин/i, 'pearl'],
  [/трезуб|копь|гарпун|посох|скипетр/i, 'trident'],
  [/корабл|галеон|шхун|лодк|ладь|флот|каюта|парус|мачт/i, 'ship'],
  [/яхт|катер/i, 'yacht'],
  [/флаг|флаж|знам|вымпел|стяг/i, 'flag'],

  [/огон|пламя|пожар|факел|горн|уголь|жар|извержен|лав|магм|костёр/i, 'flame'],
  [/снег|лёд|лед|иней|мороз|мерзлот|вьюг|зим|наст|айсберг|полюс/i, 'snow'],
  [/молни|разряд|гром|электр/i, 'bolt'],
  [/перо|пёрышк|оперен/i, 'feather'],
  [/лист|лиан|ветв|олив|трав|виноград|орхиде|цвет|росток/i, 'leaf'],
  [/пальм|остров|бухт|гаван|пляж|берег/i, 'palm'],
  [/алмаз|бриллиант|рубин|сапфир|изумруд|аметист|топаз|кристалл|самоцвет|огранк|карат|турмалин|александрит|кварц/i, 'gem'],
  [/звезд|сияни|свет|рассвет|заря|блеск/i, 'star'],
  [/луна|ночь|сумерк|темнот|тьм|тень/i, 'moon'],
  [/планет|орбит|галактик|туманност|комет|метеор|спутник|космос|вселенн|звёздн|квазар|сингулярност|сверхнов/i, 'planet'],

  [/часы|хронометр|хронограф|турбийон|календар|механизм|калибр|циферблат|стрелк/i, 'watch'],
  [/чип|процессор|плат[аы]|микросхем|нейро|имплант|интерфейс|цифров/i, 'cpu'],
  [/сервер|дата-центр|стойк|сет[ьи]|облак|канал связи|модул связи/i, 'server'],
  [/ракет|шаттл|двигател|турбин|наддув|компрессор|двигател|марс|стартер/i, 'rocket'],
  [/лампа джинн|джинн/i, 'lamp'],
  [/лампоч|лампа|фонар|светильник|подсветк|прожектор|неон|вывеск|голограмм|лазер|проектор/i, 'bulb'],
  [/подзорн|телескоп|бинокл|перископ/i, 'eye'],
  [/скафандр|шлем|каск/i, 'helmet'],
  [/колб|пробирк|реагент|мутаген|сыворотк|штамм|яд[ао]?\b|противояди|синтез|эликсир/i, 'flask'],

  [/машин|автомоб|болид|купе|порше|суперкар|лимузин|кузов/i, 'car'],
  [/колес|покрышк|шин[аы]|слик|диск/i, 'wheel'],
  [/рул[ья]|штурвал/i, 'steering'],
  [/самолёт|самолет|дирижабл|крыл|полёт|авиа/i, 'plane'],
  [/башн|небоскрёб|небоскреб|здани|дом|вилл|дворец|замок|апартамент|пентхаус|люкс|резиденц|город|храм|часовн|купол|шатёр|гараж|мастерск|лаборатор|станц|склеп|гробниц|усыпальниц|логов|убежищ|бокс/i, 'tower'],

  [/кувшин|амфор|сосуд|канистр|фляг|котёл|бочк/i, 'jug'],
  [/бокал|стакан|рюмк|фужер/i, 'glass'],
  [/бутыл|вино|виск|ром(?![а-яёa-z])|шампан/i, 'bottle'],
  [/шляп|цилиндр|кепк|шлем|каск/i, 'hat'],
  [/билет|абонемент|приглашен|ложа|место|трибун|столик/i, 'ticket'],
  [/барабан|бубен|тамбурин|самб/i, 'drum'],
  [/шар|мяч|сфер/i, 'balloon'],
  [/скарабе|жук|бабочк/i, 'flower'],
  [/кот|кошач|ягуар|тигр|лев(?![а-яёa-z])|зверь|сокол|птиц|попуга/i, 'cat'],
  [/пирамид|сфинкс|обелиск/i, 'pyramid'],
  [/глаз|взгляд|око|зрен|предсказ|видени/i, 'eye'],
  [/крыл|чешу|дракон|феникс|левиафан|кракен/i, 'wing'],
  [/яйц|скорлуп|гнезд/i, 'egg'],
  [/доспех|броня|щит|латы|мантия|плащ|костюм|куртк|бомбер|респиратор/i, 'helmet'],
  [/баллон|спрей|маркер|краск|роспис|граффит|стен[аы]/i, 'spray'],
  [/кроссовк|сапог|ботинк|обув|скейт/i, 'shoe'],
  [/револьвер|пистолет|ружь|гильз|порох|оруж/i, 'gun'],
  [/сигар|табак|портсигар|окурок|кальян|дым/i, 'smoke'],
  [/ковёр|ковер|полотн|ткан|шёлк|сукно|сет[ьи] |верёвк|шнур|ремеш|лент/i, 'carpet'],
  [/песок|песчан|бархан|пыл[ьи]|пепел|зол[аы]|прах|пемз/i, 'sand'],
  [/шатёр|цирк|палатк|тент/i, 'tent'],
  // Добор: слова, оставшиеся без мотива после первой раскладки.
  [/трон|держав|повелител|княз|родословн|импери|власт|титул/i, 'crown'],
  [/сердц|кров|дыхани|голос|душ|бессмерти|перерожден|рождени|жизн/i, 'flame'],
  [/руна|тотем|оберег|заклят|проклят|тайн|секрет|предани|легенд/i, 'seal'],
  [/камен|галь|осколок|обсидиан|кварц|валун|мишен|алтар|идол|стел/i, 'gem'],
  [/крюк|кошк|трапец|канат|леск/i, 'tongs'],
  [/труб|оптоволокн|провод|кабел|контур|антенн|фильтр|стержен|реактор|ядро/i, 'cpu'],
  [/сектор|день|день(?![а-яёa-z])|просмотр|лейбл|трек|рекорд|круг|позиц|очк/i, 'star'],
  [/коготь|клык|ящер|зверин/i, 'blade'],
  [/время|безмолви|вечност|эпох|век(?![а-яёa-z])|момент|час(?![а-яёa-z])/i, 'watch'],
  [/анкх|крест|кол(?![а-яёa-z])|саркофаг|гроб|склеп|могил|долин/i, 'seal'],
  [/свеч|огарок|спичк|зажиган|искр/i, 'flame'],
  [/зеркал|портрет|картин|витрин|галере|коллекц|экземпляр|лот(?![а-яёa-z])/i, 'card'],
  [/тормоз|капот|коробк|выхлоп|щётк|щеток|ковш|ветош|масл|деталь|запчаст/i, 'gear'],
  [/врат|двер|порог|вход|арк/i, 'tower'],
  [/волн|вод[аы]|дно|глубин|море|океан|river|рек[аи]|кальдер|лагун/i, 'shell'],
  [/ящик|короб|контейнер|чемодан|кейс/i, 'chest'],
  [/признани|компромат|запис|документ|отчёт|прошени/i, 'scroll'],
  [/манометр|рука|автоматон|робот|механик|оборот|привод/i, 'gear'],
  [/грунт|матери|энерги|червоточин|горизонт|материк/i, 'planet'],
  [/берест|бумаг|букв|письм|надпис|имя(?![а-яёa-z])|слов/i, 'scroll'],
  [/дерев|орех|колючк|куст|росток|сельв|лес(?![а-яёa-z])/i, 'leaf'],
  [/нить|шёлк|шелк|прях|ткац/i, 'carpet'],
  [/плутони|радиац|молодост|эликсир/i, 'flask'],
  [/цуба|веер|бамбук|путь|удар|стойк/i, 'blade'],
  [/салфетк|скатерт|полотенц/i, 'carpet'],
  [/ставк|джекпот|автомат|стол(?![а-яёa-z])|приватн|хайроллер/i, 'chip'],
  // «Вид с Корковаду», «Вид с бассейна» — это всегда панорама сверху,
  // поэтому рисуем силуэт города, а не абстрактную звезду.
  [/вид(?![а-яёa-z])|панорам|обзорн|смотров/i, 'tower'],
  [/закат|горизонт|пейзаж/i, 'star'],
  [/золот|платин|серебр|медь|бронз/i, 'ingot'],
  [/побед|первенств|финал|турнир/i, 'cup'],
  [/финик|чай|кофе|специ|шафран|еда|ужин|завтрак/i, 'glass'],
  [/проездн|пропуск|карточк|абонемент/i, 'ticket'],
  [/мерлион|статуэтк|скульптур|фигур/i, 'cat'],
  [/ставн|окн[оа]|рам[аы]|створк/i, 'card'],
  [/луп[аы]|стекл|линз|очк[иа]/i, 'eye'],
  [/корпус|калибр|репетир|ход(?![а-яёa-z])/i, 'watch'],
  [/оазис|желани|ветер|ветр|шаг(?![а-яёa-z])|дорог|тропа|путь/i, 'sand'],
  [/квартал|улиц|район|блок(?![а-яёa-z])|проспект/i, 'tower'],
  // Последний добор: одиночные названия, не попавшие ни под одно правило.
  [/чёрная карта|карта(?![а-яёa-z])/i, 'card'],
  [/лампа|панел|обшивк|мусор|отсек|узел|модул|скафандр|криокапсул|набор/i, 'cpu'],
  [/flush|роял|комбинац/i, 'card'],
  [/горсть|щёпот|горст/i, 'sand'],
  [/кол(?![а-яёa-z])|осинов|шест(?![а-яёa-z])/i, 'dagger'],
  [/кузн|горнил|мастерств/i, 'anvil'],
  [/нос(?![а-яёa-z])|грим|клоун/i, 'balloon'],
  [/начал|заново|исток|перв(ый|ая|ое)/i, 'star'],
  [/щётк|щеток|комплект|набор/i, 'gear'],
  [/шестёрк|шестерк|оппозит|мотор/i, 'rocket'],
  [/вид(?![а-яёa-z])|обзор|смотров/i, 'eye'],
  [/лот(?![а-яёa-z])|аукцион|торг/i, 'bill'],
  [/ход(?![а-яёa-z])|шаг(?![а-яёa-z])|движен/i, 'watch'],
];

/** Мотив по названию предмета; null, если знакомых слов не нашлось. */
export function artFor(name) {
  for (const [re, key] of MATCH) if (re.test(name)) return key;
  return null;
}

/**
 * Рисунок предмета. Если название незнакомо, возвращает null — вызывающий код
 * подставит значок уровня редкости, как было раньше.
 */
export function itemArt(name, color) {
  const key = artFor(name);
  return key ? ART[key](color) : null;
}

/** Сколько мотивов в библиотеке — для проверок. */
export const ART_COUNT = Object.keys(ART).length;
