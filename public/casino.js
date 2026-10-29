/**
 * Казино: лобби игр провайдеров, выбор провайдера, окно запуска и экран игры.
 *
 * Устройство страницы - по образцу 1Win, который прислал заказчик:
 *   меню вкладок «Слоты / Live казино / Быстрые игры» сверху;
 *   баннеры (слайд-шоу и пара Free Money + Кейсы) - статикой в index.html;
 *   поиск и кнопка «Провайдеры» в одну строку;
 *   чипы категорий («Лобби», «Популярные», «Hold & Win»...);
 *   лобби - блоки-ленты с заголовком, стрелками и «Все»; «Популярные» в две
 *   строки и первыми.
 * Какие блоки бывают и почему - server/casino-categories.js.
 *
 * НАВИГАЦИЯ - СТЕК, А НЕ ФЛАГ. Экранов пять: лобби, категория, выбор
 * провайдера, провайдер, поиск. Раньше со страницы провайдера можно было
 * вернуться только в лобби, и к выбору провайдеров обратного пути не было:
 * игрок, промахнувшийся провайдером, начинал заново. Теперь каждый переход
 * кладёт прежний экран в стек, и «Назад» возвращает ровно туда, откуда
 * пришли: из провайдера - к списку провайдеров, из списка - в лобби.
 *
 * Игру клиент не крутит и денег не считает: игра живёт у провайдера в окне
 * iframe, а каждое списание и начисление приходит на сервер вызовом кошелька
 * от агрегатора. Пока игра открыта, клиент раз в несколько секунд спрашивает
 * /api/me, чтобы показать баланс.
 *
 * Модуль не импортирует app.js (круг импортов уронил бы оба файла): всё
 * нужное приходит в createCasino. Имена внутри фабрики - автономная сборка
 * складывает модули клиента в одну область видимости.
 */
import { PROVIDER_LOGOS } from './provider-logos.js';

export function createCasino(deps) {
  const { api, esc, money, toast, haptic, state, onUser, plural } = deps;

  /*
   * Наши быстрые игры в одной сетке с играми провайдеров. Обложки нарисованы
   * под соседние обложки Spribe (tools/fast-covers.mjs). Пути целые, вместе
   * с ведущим слешем: автономная сборка подставляет файл по строке пути.
   * Выключенная в панели игра на витрину не попадает (deps.ownOpen).
   */
  const OWN_FAST = [
    { view: 'crash', name: 'Краш', cover: '/assets/ui/fast-crash.webp' },
    { view: 'upgrade', name: 'Апгрейд', cover: '/assets/ui/fast-upgrade.webp' },
  ];
  // Быстрых игр у провайдера десяток: столько грузим разом, без «Показать ещё».
  const FAST_LIMIT = 60;

  /* Сколько плиток за один запрос страницы: целые ряды и по три, и по шесть. */
  const PAGE = 48;
  // Пока игра открыта, баланс обновляется так часто. Чаще незачем: ставка в
  // слоте раз в две-три секунды, а лишний запрос - лишняя батарея телефона.
  const BALANCE_POLL_MS = 4000;
  const SEARCH_DEBOUNCE_MS = 250;
  // Не загрузилась обложка - одна повторная попытка через эту паузу. Сеть в
  // мобильном браузере моргает, и без повтора разовый сбой убирал бы игру с
  // витрины (Gates of Olympus пропадал с первого экрана).
  const COVER_RETRY_MS = 1500;

  const ui = {
    active: false,
    polling: false,
    lobby: null,           // вкладки, счётчики, провайдеры, отдача
    kind: 'slots',
    home: {},              // блоки лобби по вкладкам, кешируются
    fast: null,            // все быстрые игры одним списком, кешируется
    view: { type: 'home' },
    stack: [],             // откуда пришли: для «Назад»
    q: '',
    games: [],
    total: 0,
    loading: false,
    seq: 0,
    poll: 0,
    searchTimer: 0,
  };

  const $ = (id) => document.getElementById(id);
  const root = () => $('casinoRoot');
  const fmtN = (n) => Number(n || 0).toLocaleString('ru-RU');
  const gamesWord = (n) => plural(n, 'игра', 'игры', 'игр');

  /* ---------- Значки блоков ---------- */

  /* Простые контуры 24x24 в цвет текста: значок поддерживает заголовок, а
     не спорит с обложками под ним. */
  const ICONS = {
    fire: 'M12 2c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-1-3 0-6 1-8.5z',
    trophy: 'M7 4h10v3a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 12v4M8 20h8M10 16h4v4h-4z',
    spark: 'M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
    coin: 'M12 3a8 8 0 1 0 0 18 8 8 0 0 0 0-18zm0 4v10m-2.5-7.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.7c0 2.6-5 1.3-5 3.9 0 1 1 1.9 2.5 1.9s2.5-.6 2.5-1.6',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    bag: 'M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0',
    book: 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM8 7h7',
    cherry: 'M8 15a3 3 0 1 0 0 .1zM16 17a3 3 0 1 0 0 .1zM8 12c1-5 4-8 9-9M16 14c0-4 0-8 1-11',
    pyramid: 'M12 3l9 17H3zM12 3l3 17M7.5 12h9',
    gift: 'M4 9h16v4H4zM6 13h12v8H6zM12 9v12M12 9c-2-5-6-4-4-1M12 9c2-5 6-4 4-1',
    rocket: 'M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2zM9 15l-3 4 4-1M15 15l3 4-4-1M12 9a1.5 1.5 0 1 0 0 .1',
    bomb: 'M11 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15 8l3-3M18 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
    dice: 'M5 5h14v14H5zM9 9h.1M15 15h.1M15 9h.1M9 15h.1M12 12h.1',
    wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
    roulette: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    cards: 'M7 3h10v14H7zM4 7v13h10',
  };
  /*
   * Значок на цветной плашке: тонкий серый контур рядом с яркими обложками
   * терялся и выглядел чужим (заказчик). Теперь у каждой категории свой
   * градиент, контур белый и потолще - значок читается как часть фирменного
   * стиля, а не как системная иконка.
   */
  const ICON_TONES = {
    fire: ['#ff9a3c', '#ff3d6e'], trophy: ['#ffe07a', '#e59a1a'], spark: ['#b98bff', '#6a4dff'],
    coin: ['#ffd54a', '#f0861c'], grid: ['#4fd1ff', '#3a6bff'], bag: ['#ff7ab8', '#c13bff'],
    book: ['#f2c879', '#a8651c'], cherry: ['#ff6b6b', '#c4124f'], pyramid: ['#ffd68a', '#d48a2a'],
    gift: ['#7ef0a8', '#1fa86a'], rocket: ['#6fc8ff', '#5a5bff'], bomb: ['#c9c9d6', '#5d5d74'],
    dice: ['#d58bff', '#7a3bff'], wheel: ['#5fe8d4', '#1b9e9e'], roulette: ['#ff6b6b', '#1fa86a'],
    cards: ['#8fa3ff', '#4a3bd6'],
  };
  const icon = (name) => {
    if (!ICONS[name]) return '';
    const [a, b] = ICON_TONES[name] || ['#b98bff', '#6a4dff'];
    return `<span class="cz-ib" style="--a:${a};--b:${b}"><svg class="cz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg></span>`;
  };
  const chevron = (dir) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

  /* ---------- Провайдер: знак или название ---------- */

  /*
   * Знак - официальный логотип с сайта провайдера (tools/provider-logos.mjs).
   * Где его нет, название текстом, а не чужая картинка из случайного каталога.
   */
  function providerMark(p, cls = '') {
    const logo = PROVIDER_LOGOS[p.id];
    // Без loading="lazy": знак лёгкий, а ленивый в заголовке ленты не
    // грузился, пока его не прокрутят, и заголовок стоял пустым.
    return logo
      ? `<img class="cz-plogo ${cls}" src="${logo}" alt="${esc(p.name)}" decoding="async">`
      : `<span class="cz-pword ${cls}">${esc(p.name)}</span>`;
  }

  /* ---------- Каркас ---------- */

  function shell() {
    return `
      <div class="cz-tools">
        <label class="cz-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="czQ" type="search" placeholder="Поиск" autocomplete="off" enterkeyhint="search">
        </label>
        <button class="cz-provbtn" id="czProvBtn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" rx="2"/></svg>
          Провайдеры
        </button>
      </div>
      <div class="cz-chips" id="czChips"></div>
      <div class="cz-body" id="czBody"></div>`;
  }

  function renderSeg() {
    const seg = $('czSeg');
    if (!seg || !ui.lobby) return;
    seg.innerHTML = ui.lobby.tabs.map((t) => `
      <button class="cz-seg-btn" role="tab" data-kind="${t.id}" aria-selected="${t.id === ui.kind}">${esc(t.label)}</button>`).join('');
  }

  /* Чипы: «Лобби» и блоки текущей вкладки, которые сейчас есть. */
  function renderChips() {
    const chips = $('czChips');
    // У быстрых игр категорий нет: их десяток, и все видны одной сеткой.
    const blocks = ui.kind === 'fast' ? [] : (ui.home[ui.kind] || []).filter((b) => b.type !== 'provider');
    const active = ui.view.type === 'home' ? 'home' : ui.view.type === 'category' ? ui.view.id : '';
    chips.hidden = !blocks.length;
    chips.innerHTML = [
      `<button class="cz-chip" data-chip="home" aria-pressed="${active === 'home'}">${icon('grid')}Лобби</button>`,
      ...blocks.map((b) => `<button class="cz-chip" data-chip="${esc(b.id)}" aria-pressed="${active === b.id}">${icon(b.icon)}${esc(b.title)}</button>`),
    ].join('');
    // Лента чипов живёт между перерисовками и помнит прокрутку: после смены
    // вкладки она стояла бы посередине, спрятав «Лобби». Выбранный чип -
    // в видимую часть, без рывка страницы.
    const on = chips.querySelector('[aria-pressed="true"]');
    chips.scrollLeft = on ? Math.max(0, on.offsetLeft - chips.offsetLeft - 18) : 0;
  }

  /* Баннеры только в лобби: на экране категории или провайдера они уводили
     бы список игр за пределы первого экрана. */
  function syncBanners() {
    const banners = $('czBanners');
    if (banners) banners.hidden = ui.view.type !== 'home';
  }

  /* ---------- Плитка ---------- */

  /*
   * «N играют» под обложкой, как у 1Win (просьба заказчика). Числа
   * выдуманные, поэтому живут под тем же выключателем, что и выдуманная
   * лента выигрышей (FEED_SYNTHETIC): выключили оживление - пропали и они.
   *
   * Число держится от ранга игры в «Популярных»: первая около 110, к
   * двадцатой - десяток, остальные 1-14. Дрейф раз в LIVE_DRIFT_MS от
   * хеша игры и времени: число живое, но не скачет при каждой перерисовке.
   */
  const LIVE_MAX = 110;
  const LIVE_DRIFT_MS = 90_000;
  const popularRank = new Map();
  function livePlayers(g) {
    let h = 2166136261;
    const key = `${g.id}:${Math.floor(Date.now() / LIVE_DRIFT_MS)}`;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    const jitter = (h % 1000) / 1000;
    const rank = popularRank.get(g.id);
    if (rank == null) return 1 + Math.floor(jitter * jitter * 14);
    const base = LIVE_MAX * Math.exp(-rank / 8);
    return Math.max(2, Math.min(LIVE_MAX, Math.round(base * (0.82 + jitter * 0.3))));
  }
  const liveHtml = (g) => {
    if (!deps.state?.config?.feed?.synthetic) return '';
    const n = livePlayers(g);
    return `<span class="cz-live"><i></i><b>${n}</b> ${plural(n, 'играет', 'играют', 'играют')}</span>`;
  };

  function tileHtml(g, ref, { badge = true } = {}) {
    // Горизонтальная запасная обложка не обрезается под 3:4: она стоит
    // целиком поверх своей же размытой копии. Обрезка съела бы название.
    const art = g.vertical
      ? `<img src="${g.cover}" alt="" loading="lazy" decoding="async">`
      : `<img class="cz-blur" src="${g.cover}" alt="" loading="lazy" decoding="async"><img class="cz-fit" src="${g.cover}" alt="" loading="lazy" decoding="async">`;
    // У «Лучших выигрышей» на плитке настоящий множитель раунда.
    const mult = badge && g.winMult ? `<span class="cz-mult">×${fmtN(g.winMult)}</span>` : '';
    return `<button class="cz-tile" data-ref="${ref}" data-game="${esc(g.id)}">
      <span class="cz-art${g.vertical ? '' : ' is-wide'}">
        ${art}${mult}
        <span class="cz-hover">
          <span class="cz-play"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#3a1d00"/></svg></span>
        </span>
      </span>
      <span class="cz-name">${esc(g.name)}</span>
      ${g.winAmount ? `<span class="cz-prov cz-win">${money(g.winAmount)}</span>` : `<span class="cz-prov">${esc(g.provider)}</span>`}
      ${g.winAmount ? '' : liveHtml(g)}
    </button>`;
  }

  /* Игры, на которые ссылаются плитки: по data-ref плитка находит свою. */
  const refs = new Map();
  let refSeq = 0;
  const remember = (g) => { const id = `r${++refSeq}`; refs.set(id, g); return id; };

  /*
   * Обложка не загрузилась у игрока. Игры без обложки сервер в списки не
   * отдаёт, но про часть он ещё не знает. Вертикальной нет - пробуем
   * горизонтальную (g.alt); нет и её - плитка убирается совсем: игру без
   * обложки заказчик решил не показывать, знак вопроса тем более. Сервер
   * при этом запомнит 404, и в следующий раз игры в списке уже не будет.
   */
  function onCoverError(img) {
    if (!ui.active || img.dataset.pausedSrc) return;
    const tile = img.closest('.cz-tile[data-ref]');
    const g = tile && refs.get(tile.dataset.ref);
    if (!g || !tile.isConnected) return;
    if (!img.dataset.retried) {
      img.dataset.retried = '1';
      const src = img.getAttribute('src');
      setTimeout(() => {
        if (ui.active && img.isConnected && !img.dataset.pausedSrc) img.src = `${src}${src.includes('?') ? '&' : '?'}retry=1`;
      }, COVER_RETRY_MS);
      return;
    }
    if (!g.alt || tile.dataset.fallback) { tile.remove(); return; }
    const fresh = document.createElement('div');
    fresh.innerHTML = tileHtml({ ...g, vertical: false, cover: g.alt }, tile.dataset.ref);
    const next = fresh.firstElementChild;
    next.dataset.fallback = 'alt';
    tile.replaceWith(next);
  }

  /* ---------- Лобби: блоки-ленты ---------- */

  function blockHtml(b) {
    const head = b.type === 'provider'
      ? `<button class="cz-btitle" data-provider="${esc(b.provider)}">${providerMark({ id: b.provider, name: b.title }, 'is-inline')}${chevron('right')}</button>`
      : `<button class="cz-btitle" data-chip="${esc(b.id)}">${icon(b.icon)}<span>${esc(b.title)}</span>${chevron('right')}</button>`;
    const more = b.total > b.games.length
      ? `<button class="cz-tile cz-all" ${b.type === 'provider' ? `data-provider="${esc(b.provider)}"` : `data-chip="${esc(b.id)}"`}>
           <span class="cz-art"><span class="cz-all-in">Все<b>${fmtN(b.total)}</b><small>${gamesWord(b.total)}</small></span></span>
         </button>` : '';
    return `<section class="cz-block" data-block="${esc(b.id)}">
      <div class="cz-bhead">
        ${head}
        <div class="cz-arrows">
          <button class="cz-arrow" data-scroll="-1" aria-label="Назад">${chevron('left')}</button>
          <button class="cz-arrow" data-scroll="1" aria-label="Вперёд">${chevron('right')}</button>
        </div>
      </div>
      <div class="cz-track${b.rows === 2 ? ' is-two' : ''}">
        ${b.games.map((g) => tileHtml(g, remember(g))).join('')}${more}
      </div>
    </section>`;
  }

  /*
   * Быстрые игры - одна сетка без категорий и без лент со стрелками
   * (решение заказчика): игр немного, и все должны быть видны сразу, без
   * прокрутки вбок. Наши Краш и Апгрейд стоят первыми.
   */
  function ownTileHtml(o) {
    return `<button class="cz-tile cz-own" data-own="${o.view}">
      <span class="cz-art">
        <img src="${o.cover}" alt="" loading="lazy" decoding="async">
        <span class="cz-hover">
          <span class="cz-play"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#3a1d00"/></svg></span>
        </span>
      </span>
      <span class="cz-name">${esc(o.name)}</span>
      <span class="cz-prov">LUCKYBOX</span>
    </button>`;
  }

  function renderFast() {
    const body = $('czBody');
    if (!ui.fast) { skeletonHome(); return; }
    const own = OWN_FAST.filter((o) => !deps.ownOpen || deps.ownOpen(o.view));
    body.innerHTML = `<div class="cz-grid cz-fast" data-block="fast">
        ${own.map(ownTileHtml).join('')}${ui.fast.map((g) => tileHtml(g, remember(g))).join('')}
      </div>
      <p class="cz-note">Отдача игр провайдеров <b>${esc(String(ui.lobby.rtp))}%</b>. Краш и Апгрейд - наши игры,
        их исход проверяется в разделе «Честность игры».</p>`;
  }

  async function loadFast() {
    if (ui.fast) return ui.fast;
    const { games } = await api('/api/casino/games', { kind: 'fast', offset: 0, limit: FAST_LIMIT });
    ui.fast = games;
    return games;
  }

  function renderHome() {
    if (ui.kind === 'fast') { renderFast(); return; }
    const body = $('czBody');
    const blocks = ui.home[ui.kind];
    if (!blocks) { skeletonHome(); return; }
    if (!blocks.length) {
      // Пустая вкладка честно говорит, что столы готовятся, а не стоит пустой.
      body.innerHTML = `<div class="cz-soon">
        <b>${ui.kind === 'live' ? 'Live казино готовится к запуску' : 'Игры скоро появятся'}</b>
        <span>${ui.kind === 'live' ? 'Столы Pragmatic Play Live и Evolution подключаются. А пока загляните в слоты.' : 'Загляните во вкладку «Слоты».'}</span>
        <button class="cz-soon-btn" data-kind="slots">Перейти к слотам</button>
      </div>`;
      return;
    }
    // Отдачи на экране игр нет (решение заказчика): она объявлена одна на
    // всё казино в разделе «Честность игры», и повторять её здесь незачем.
    body.innerHTML = blocks.map(blockHtml).join('');
  }

  function skeletonHome() {
    $('czBody').innerHTML = [0, 1].map(() => `<section class="cz-block">
      <div class="cz-bhead"><span class="skel cz-skel-title"></span></div>
      <div class="cz-track">${Array.from({ length: 6 }, () =>
        '<span class="cz-tile cz-skel"><span class="cz-art skel"></span><span class="cz-name skel"></span></span>').join('')}</div>
    </section>`).join('');
  }

  async function loadHome(kind) {
    if (kind === 'fast') return loadFast();
    if (ui.home[kind]) return ui.home[kind];
    const { blocks } = await api('/api/casino/home', { kind });
    ui.home[kind] = blocks;
    // Ранг в «Популярных» задаёт, сколько человек «играют» в игру (livePlayers).
    for (const b of blocks) {
      if (b.type === 'popular') b.games.forEach((g, i) => { if (!popularRank.has(g.id)) popularRank.set(g.id, i); });
    }
    return blocks;
  }

  /* ---------- Списки: категория, провайдер, поиск ---------- */

  function listHead(title, count, extra = '') {
    return `<div class="cz-listhead">
      <button class="cz-back" data-back>${chevron('left')}<span>Назад</span></button>
      <div class="cz-listtitle">${title}</div>
      ${count !== null ? `<span class="cz-count">${count}</span>` : ''}
      ${extra}
    </div>`;
  }

  function renderList() {
    const v = ui.view;
    const body = $('czBody');
    let title = '';
    if (v.type === 'category') {
      const b = (ui.home[ui.kind] || []).find((x) => x.id === v.id);
      title = `${icon(b?.icon)}<span>${esc(b?.title || '')}</span>`;
    } else if (v.type === 'provider') {
      const p = ui.lobby.providers.find((x) => x.id === v.id) || { id: v.id, name: v.id };
      title = providerMark(p, 'is-title');
    } else if (v.type === 'search') {
      title = `<span>Поиск: «${esc(ui.q)}»</span>`;
    }
    body.innerHTML = `${listHead(title, '')}
      <div class="cz-grid" id="czGrid"></div>
      <div class="cz-empty" id="czEmpty" hidden></div>
      <div class="cz-more" id="czMore" hidden>
        <div class="cz-progress"><i id="czBar"></i></div>
        <small id="czMoreText"></small>
        <button type="button" id="czMoreBtn">Показать ещё</button>
      </div>`;
    reload();
  }

  function renderGrid(fromIndex = 0) {
    const grid = $('czGrid');
    if (!grid) return;
    const html = ui.games.slice(fromIndex).map((g) => tileHtml(g, remember(g))).join('');
    if (fromIndex === 0) grid.innerHTML = html;
    else grid.insertAdjacentHTML('beforeend', html);

    const shown = ui.games.length;
    const count = root().querySelector('.cz-listhead .cz-count');
    if (count) count.textContent = ui.total ? `${fmtN(ui.total)} ${gamesWord(ui.total)}` : '';
    const empty = $('czEmpty');
    empty.hidden = ui.total > 0 || ui.loading;
    empty.textContent = ui.q ? `По запросу «${ui.q}» ничего нет` : 'Игр пока нет';
    $('czMore').hidden = shown >= ui.total;
    $('czMoreText').textContent = `Показано ${fmtN(shown)} из ${fmtN(ui.total)}`;
    $('czBar').style.width = `${ui.total ? Math.max(2, (shown / ui.total) * 100) : 0}%`;
  }

  function skeletonGrid() {
    const grid = $('czGrid');
    if (!grid) return;
    grid.innerHTML = Array.from({ length: 12 }, () =>
      '<span class="cz-tile cz-skel"><span class="cz-art skel"></span><span class="cz-name skel"></span></span>').join('');
    $('czMore').hidden = true;
    $('czEmpty').hidden = true;
  }

  function fetchPage(offset) {
    const v = ui.view;
    return api('/api/casino/games', {
      kind: ui.kind,
      provider: v.type === 'provider' ? v.id : '',
      category: v.type === 'category' ? v.id : '',
      q: v.type === 'search' ? ui.q : '',
      offset,
      limit: PAGE,
    });
  }

  /*
   * Ответы на устаревшие запросы отбрасываются по номеру: игрок, быстро
   * перещёлкнувший экраны, иначе увидел бы список того экрана, ответ на
   * который пришёл последним, а не того, на котором он стоит.
   */
  async function reload() {
    const seq = ++ui.seq;
    ui.loading = true;
    skeletonGrid();
    try {
      const data = await fetchPage(0);
      if (seq !== ui.seq) return;
      ui.games = data.games;
      ui.total = data.total;
      ui.loading = false;
      renderGrid(0);
    } catch (err) {
      if (seq !== ui.seq) return;
      ui.loading = false;
      toast(err.message);
    }
  }

  async function loadMore() {
    if (ui.loading || ui.games.length >= ui.total) return;
    const seq = ui.seq;
    ui.loading = true;
    pauseCoverRequests();
    const btn = $('czMoreBtn');
    btn.disabled = true;
    try {
      const data = await fetchPage(ui.games.length);
      if (seq !== ui.seq) return;
      const from = ui.games.length;
      ui.games = ui.games.concat(data.games);
      ui.total = data.total;
      renderGrid(from);
    } catch (err) {
      toast(err.message);
    } finally {
      ui.loading = false;
      if (btn.isConnected) btn.disabled = false;
      resumeCoverRequests();
    }
  }

  /* ---------- Выбор провайдера ---------- */

  function renderProviders() {
    const list = ui.lobby.providers.filter((p) => p.kind === ui.kind);
    const kindTitle = ui.lobby.tabs.find((t) => t.id === ui.kind)?.label || '';
    $('czBody').innerHTML = `${listHead(`<span>Провайдеры · ${esc(kindTitle)}</span>`, null)}
      ${list.length ? `<div class="cz-pgrid">${list.map((p) => `
        <button class="cz-pcard" data-provider="${esc(p.id)}">
          <span class="cz-pmark">${providerMark(p)}</span>
          <span class="cz-pcount">${fmtN(p.count)} ${gamesWord(p.count)}</span>
        </button>`).join('')}</div>`
        : '<div class="cz-empty">Провайдеров в этой вкладке пока нет</div>'}`;
  }

  // Удаление тега img само по себе не всегда отменяет загрузку. Сбрасываем
  // src перед заменой экрана, освобождая соединения для следующего API-запроса.
  function pauseCoverRequests() {
    root()?.querySelectorAll('.cz-art img[src]').forEach((img) => {
      if (!img.complete) { img.dataset.pausedSrc = img.getAttribute('src'); img.removeAttribute('src'); }
    });
  }

  function resumeCoverRequests() {
    if (!ui.active) return;
    root()?.querySelectorAll('img[data-paused-src]').forEach((img) => {
      const src = img.dataset.pausedSrc;
      delete img.dataset.pausedSrc;
      img.src = src;
    });
  }

  /* ---------- Переходы ---------- */

  function render() {
    if (!ui.active) return;
    pauseCoverRequests();
    // Вкладка на корне: по ней стили делают плитки live крупнее (у живых
    // столов обложка - картинка стола, мелкой она не читается). Именно
    // data-cz-kind, а не data-kind: по data-kind обработчик нажатий ищет
    // кнопки вкладок, и корень с этим атрибутом ловил бы каждое нажатие.
    root().dataset.czKind = ui.kind;
    syncBanners();
    renderSeg();
    renderChips();
    const t = ui.view.type;
    if (t === 'home') renderHome();
    else if (t === 'providers') renderProviders();
    else renderList();
  }

  /* Переход вперёд: прежний экран уходит в стек. */
  function go(view) {
    ui.stack.push(ui.view);
    ui.view = view;
    render();
    window.scrollTo({ top: 0 });
  }

  function back() {
    ui.view = ui.stack.pop() || { type: 'home' };
    // Из поиска назад - поле очищается, иначе возврат выглядит как поиск.
    if (ui.view.type !== 'search') { ui.q = ''; const q = $('czQ'); if (q) q.value = ''; }
    render();
    window.scrollTo({ top: 0 });
  }

  async function setKind(kind) {
    if (ui.kind === kind && ui.view.type === 'home') return;
    ui.kind = kind;
    ui.view = { type: 'home' };
    ui.stack = [];
    ui.q = '';
    const q = $('czQ'); if (q) q.value = '';
    render();
    try { await loadHome(kind); } catch (err) { toast(err.message); return; }
    if (ui.kind === kind && ui.view.type === 'home') render();
  }

  function openChip(id) {
    if (id === 'home') {
      if (ui.view.type !== 'home') { ui.view = { type: 'home' }; ui.stack = []; render(); }
      return;
    }
    // Чип из чипа не копит стек: «Назад» с любой категории ведёт в лобби.
    if (ui.view.type === 'category') { ui.view = { type: 'category', id }; render(); window.scrollTo({ top: 0 }); }
    else go({ type: 'category', id });
  }

  function scrollTrack(btn) {
    const track = btn.closest('.cz-block')?.querySelector('.cz-track');
    if (!track) return;
    track.scrollBy({ left: Number(btn.dataset.scroll) * track.clientWidth * 0.9, behavior: 'smooth' });
  }

  function bind() {
    const r = root();
    if (r.dataset.bound) return;
    r.dataset.bound = '1';

    const onClick = (e) => {
      const kindBtn = e.target.closest('[data-kind]');
      if (kindBtn) { haptic('light'); setKind(kindBtn.dataset.kind); return; }
      if (e.target.closest('[data-back]')) { haptic('light'); back(); return; }
      if (e.target.closest('#czProvBtn')) {
        haptic('light');
        if (ui.view.type !== 'providers') go({ type: 'providers' });
        return;
      }
      const prov = e.target.closest('[data-provider]');
      if (prov) { haptic('light'); go({ type: 'provider', id: prov.dataset.provider }); return; }
      const chip = e.target.closest('[data-chip]');
      if (chip) { haptic('light'); openChip(chip.dataset.chip); return; }
      const arrow = e.target.closest('[data-scroll]');
      if (arrow) { scrollTrack(arrow); return; }
      if (e.target.closest('#czMoreBtn')) { loadMore(); return; }
      const own = e.target.closest('[data-own]');
      if (own) { haptic('light'); deps.openOwn?.(own.dataset.own); return; }
      const tile = e.target.closest('.cz-tile[data-ref]');
      if (tile) openSheet(refs.get(tile.dataset.ref));
    };
    r.addEventListener('click', onClick);
    $('czSeg').addEventListener('click', onClick);
    // Событие error у картинки не всплывает: ловим на погружении.
    r.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG' && e.target.closest('.cz-art')) onCoverError(e.target);
    }, true);

    r.addEventListener('input', (e) => {
      if (e.target.id !== 'czQ') return;
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(() => {
        ui.q = e.target.value.trim();
        if (ui.q) {
          if (ui.view.type === 'search') { renderList(); }
          else go({ type: 'search' });
        } else if (ui.view.type === 'search') {
          back();
        }
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  /* ---------- Вход в раздел ---------- */

  async function open() {
    ui.active = true;
    const r = root();
    if (!r.firstChild) r.innerHTML = shell();
    bind();
    if (!ui.lobby) {
      skeletonHome();
      try {
        ui.lobby = await api('/api/casino/lobby');
      } catch (err) {
        toast(err.message);
        return;
      }
    }
    render();
    try { await loadHome(ui.kind); } catch (err) { toast(err.message); return; }
    if (ui.view.type === 'home') render();
    resumeCoverRequests();
  }

  /* Баннер «Большие джекпоты» в казино ведёт к блоку «Популярные». */
  async function focusBlock(id) {
    // Блок ищется после того, как вкладка слотов дорисована: до этого его
    // нет в разметке, и баннер никуда не прокручивал.
    if (ui.kind !== 'slots' || ui.view.type !== 'home') await setKind('slots');
    const el = root().querySelector(`[data-block="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Окно запуска ---------- */

  function openSheet(g) {
    if (!g) return;
    haptic('light');
    const sheet = $('czSheet');
    const sheetArt = g.wide || g.cover;
    $('czSheetArt').style.backgroundImage = sheetArt ? `url("${sheetArt}")` : 'none';
    $('czSheetArt').classList.toggle('is-cover', !g.wide);
    $('czSheetName').textContent = g.name;
    $('czSheetProv').textContent = g.provider;
    const demo = $('czDemo');
    demo.hidden = !g.demo;
    demo.onclick = () => launch(g, true);
    $('czPlay').onclick = () => launch(g, false);
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-in'));
  }

  function closeSheet() {
    const sheet = $('czSheet');
    sheet.classList.remove('is-in');
    sheet.hidden = true;
    $('czSheetArt').style.backgroundImage = 'none';
  }

  /* ---------- Экран игры ---------- */

  async function launch(g, demo) {
    if (state.guest) {
      pauseCoverRequests();
      closeSheet();
      deps.onAuth?.();
      return;
    }
    pauseCoverRequests();
    const btn = demo ? $('czDemo') : $('czPlay');
    btn.disabled = true;
    try {
      const data = await api('/api/casino/launch', { gameId: g.id, demo });
      closeSheet();
      openFrame(g, data, demo);
    } catch (err) {
      // Гость: api() уже открыл окно регистрации. Превью игры убираем, иначе
      // оно оставалось поверх окна входа, и регистрация шла «под» слотом.
      if (err.status === 401) { closeSheet(); return; }
      toast(err.message);
      haptic('error');
    } finally {
      btn.disabled = false;
      if ($('czFrame').hidden && ($('authBackdrop')?.hidden ?? true)) resumeCoverRequests();
    }
  }

  function renderFrameBalance() {
    const el = $('czFrameBalance');
    if (el && state.user) el.textContent = money(state.user.balance);
  }

  async function refreshUser(force = false) {
    if (ui.polling || (!force && (document.hidden || $('czFrame').hidden))) return;
    ui.polling = true;
    try {
      const { user } = await api('/api/me');
      onUser(user);
      renderFrameBalance();
    } catch { /* сеть моргнула - следующий опрос поправит */ }
    finally { ui.polling = false; }
  }

  function openFrame(g, data, demo) {
    const frame = $('czFrame');
    $('czFrameName').textContent = demo ? `${g.name} · демо` : g.name;
    renderFrameBalance();
    const host = $('czFrameHost');
    host.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'cz-iframe';
    iframe.setAttribute('allow', 'autoplay; fullscreen; clipboard-write; encrypted-media');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    // Агрегатор отдаёт либо адрес, либо готовый HTML - одно из двух.
    if (data.url) iframe.src = data.url;
    else {
      // Готовый HTML в srcdoc получил бы адрес нашего сайта, и его скрипты
      // ходили бы в наши ручки с сессией игрока. Песочница без
      // allow-same-origin делает его чужим для нашего сайта.
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
      iframe.srcdoc = data.html || '';
    }
    host.append(iframe);
    frame.hidden = false;
    document.body.classList.add('cz-playing');
    clearInterval(ui.poll);
    if (!demo) ui.poll = setInterval(refreshUser, BALANCE_POLL_MS);
  }

  function closeFrame() {
    const frame = $('czFrame');
    if (frame.hidden) return;
    clearInterval(ui.poll);
    ui.poll = 0;
    // Окно игры удаляется целиком, а не прячется: иначе звук игры и её
    // запросы шли бы дальше в невидимом iframe.
    $('czFrameHost').innerHTML = '';
    frame.hidden = true;
    document.body.classList.remove('cz-playing');
    refreshUser(true).finally(resumeCoverRequests);
  }

  function bindOverlays() {
    const sheet = $('czSheet');
    if (sheet.dataset.bound) return;
    sheet.dataset.bound = '1';
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
    $('czFrameClose').addEventListener('click', () => { haptic('light'); closeFrame(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });
  }

  return {
    open() { bindOverlays(); return open(); },
    close() {
      ui.active = false;
      ui.seq++;
      clearTimeout(ui.searchTimer);
      // Скрытые обложки не должны занимать все HTTP/1-соединения и держать
      // запросы кассы/игр в очереди. При следующем открытии разметка восстановится.
      root()?.querySelectorAll('img[src]').forEach((img) => {
        if (!img.complete) { img.dataset.pausedSrc = img.getAttribute('src'); img.removeAttribute('src'); }
      });
      closeSheet(); closeFrame();
    },
    focusBlock,
    resumeCovers: resumeCoverRequests,
    /** Открыта ли сейчас игра: пока да, остальной интерфейс не трогаем. */
    playing: () => !$('czFrame').hidden,
  };
}
