/**
 * Слот TREASURE ISLAND: барабаны, панель, бонус и всё остальное.
 *
 * ПОЧЕМУ ЭТО НЕ КАРТИНКА С КНОПКАМИ.
 *
 * Присланный макет - один PNG. Положить его на страницу и накидать сверху
 * прозрачные кнопки было бы вдвое быстрее и полностью бесполезно: барабаны бы
 * не крутились, ставка бы не менялась, выигрыш бы не считался. Поэтому макет
 * разобран на части (tools/slot-assets.mjs), из него взяты только рисунки -
 * символы, логотип, доски рамки, слои фона, - а всё остальное собрано
 * вёрсткой: панели, плашки джекпотов, таблица выплат, история, окна.
 *
 * ГЛАВНОЕ ПРАВИЛО: БАРАБАН ОСТАНАВЛИВАЕТСЯ НА ТОМ, ЧТО РЕШИЛ СЕРВЕР.
 *
 * Клиент не придумывает ни одного символа. Сервер присылает пять позиций на
 * лентах, ленты у клиента те же самые, и прокрут доводится ровно до этих
 * позиций. Поэтому на экране никогда не окажется картинка, не совпадающая с
 * выплатой: остановка и есть результат, а не иллюстрация к нему.
 *
 * ВЫСОТА ЯЧЕЙКИ СНИМАЕТСЯ С РАЗМЕТКИ, А НЕ ЗАШИТА ЧИСЛОМ. На телефоне она
 * одна, на компьютере другая, и зашитое число остановило бы ленту между
 * символами - ровно та ошибка, на которой уже ломался барабан кейсов и
 * барабан мини-игр.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ. Мини-апп открывают на телефоне во встроенном браузере
 * Telegram. Поэтому здесь нет ни одной частицы в DOM, нет теней на движущихся
 * элементах, а сама прокрутка это одно свойство transform на пяти лентах:
 * пять слоёв на видеокарте вместо перерисовки страницы.
 *
 * Модуль не импортирует app.js: всё, что нужно, передаётся в createSlot.
 * Иначе получился бы круг импортов, и оба файла перестали бы грузиться.
 */

/*
 * Имя не `wait`: в автономной сборке все модули клиента склеиваются в один
 * файл, и второе объявление `const wait` рядом с таким же из minigames.js
 * роняет разбор всего файла.
 */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   КАРТИНКИ
   ============================================================ */

/**
 * Пути к символам выписаны ЦЕЛИКОМ, а не склеены из кусков.
 *
 * Автономная демо-сборка подставляет внутрь файла всё, что лежит по пути
 * /assets/ui/*.webp, и ищет их выражением по тексту. Путь, собранный в
 * шаблоне (`/assets/ui/slot-sym-${id}.webp`), она не увидит, и в демо все
 * символы оказались бы битыми. На значках бокового меню это уже случалось.
 */
const SYM_ART = {
  captain:  '/assets/ui/slot-sym-captain.webp',
  woman:    '/assets/ui/slot-sym-woman.webp',
  ship:     '/assets/ui/slot-sym-ship.webp',
  crown:    '/assets/ui/slot-sym-crown.webp',
  compass:  '/assets/ui/slot-sym-compass.webp',
  parrot:   '/assets/ui/slot-sym-parrot.webp',
  chest:    '/assets/ui/slot-sym-chest.webp',
  spyglass: '/assets/ui/slot-sym-spyglass.webp',
  ace:      '/assets/ui/slot-sym-ace.webp',
  king:     '/assets/ui/slot-sym-king.webp',
  queen:    '/assets/ui/slot-sym-queen.webp',
  jack:     '/assets/ui/slot-sym-jack.webp',
  ten:      '/assets/ui/slot-sym-ten.webp',
  wild:     '/assets/ui/slot-sym-wild.webp',
  scatter:  '/assets/ui/slot-sym-scatter.webp',
};

const JACKPOT_ART = {
  grand: '/assets/ui/slot-gem-grand.webp',
  major: '/assets/ui/slot-gem-major.webp',
  minor: '/assets/ui/slot-gem-minor.webp',
  mini:  '/assets/ui/slot-gem-mini.webp',
};

const FEATURE_ART = {
  bonus:  '/assets/ui/slot-card-bonus.webp',
  wild:   '/assets/ui/slot-card-wild.webp',
  expand: '/assets/ui/slot-card-expand.webp',
};

/* ============================================================
   ВРЕМЕНА
   ============================================================ */

/**
 * Сколько барабан крутится до остановки и с каким шагом останавливаются
 * соседние.
 *
 * Шаг между барабанами - не украшение. Пять барабанов, вставших разом, не
 * читаются: глаз не успевает понять, что выпало. Ступенька в 140 мс даёт ту
 * самую паузу, в которой игрок успевает прочитать первый барабан и посмотреть
 * на второй.
 */
const SPIN_MS = 620;
const REEL_STEP_MS = 140;

/** Быстрый режим: та же последовательность, вчетверо короче. */
const FAST_FACTOR = 0.35;

/**
 * Задержка перед пятым барабаном, когда на первых трёх уже лежат два scatter.
 *
 * Это не обман: исход УЖЕ решён сервером, и задержка ничего не меняет. Она
 * честно отмечает, что прямо сейчас решается бонус, и без неё самый важный
 * момент игры проходит незамеченным.
 */
const ANTICIPATION_MS = 900;

/** Скорость ленты в ячейках за секунду. */
const REEL_SPEED = 26;

/** Сколько полных оборотов лента обязана пройти до остановки. */
const MIN_TURNS = 2;

/* ============================================================
   ЗНАЧКИ ПАНЕЛИ
   ============================================================ */

const ICO = {
  sound: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M4 9v6h4l5 4V5L8 9H4zm11 1 5 5m0-5-5 5',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v1m0 3v5',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2 .5-.6 1.5 1 1.8-1.6 1.6-1.8-1-1.5.6L13 19h-2l-.5-2-1.5-.6-1.8 1-1.6-1.6 1-1.8L6 12.5 4 12v-2l2-.5.6-1.5-1-1.8 1.6-1.6 1.8 1L10.5 5 11 3h2l.5 2 1.5.6 1.8-1 1.6 1.6-1 1.8.6 1.5 2 .5z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zm9 0v13M12 7S9 3 7 4.5 8.5 7 12 7zm0 0s3-4 5-2.5S15.5 7 12 7z',
  cup: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3m10-5h3v2a3 3 0 0 1-3 3M9 20h6m-3-4v4',
  close: 'M6 6l12 12M18 6 6 18',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
};

const icon = (name, cls = 'sl-ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="${ICO[name]}"></path></svg>`;

/* ============================================================
   МОДУЛЬ
   ============================================================ */

export function createSlot(deps) {
  const { api, esc, fmt, money, toast, haptic, state, sounds = {} } = deps;
  const snd = (name) => { try { sounds[name]?.(); } catch { /* звук не обязателен */ } };

  /** Всё изменяемое состояние экрана в одном месте. */
  const ui = {
    slot: null,          // описание игры с сервера
    bet: 100,
    busy: false,
    auto: 0,             // сколько автопрокрутов осталось, -1 это «бесконечно»
    free: null,          // { spinsLeft, lineBet, totalWin } пока идёт бонус
    history: [],
    spinNo: 2448,        // номер прокрута в истории, как в макете
    sound: true,
    fast: false,
    lastWin: 0,
    reels: [],           // состояние пяти лент
  };

  const root = () => document.getElementById('slotRoot');
  const $ = (sel) => root()?.querySelector(sel);

  /* ============================================================
     РАЗМЕТКА
     ============================================================ */

  function symbolImg(id, cls = 'sl-sym') {
    return `<img class="${cls}" src="${SYM_ART[id] || ''}" alt="" draggable="false">`;
  }

  function jackpotPlaques() {
    return ui.slot.jackpots.map((j) => `
      <div class="sl-jp sl-jp-${j.id}">
        <div class="sl-jp-head">
          <img class="sl-jp-gem" src="${JACKPOT_ART[j.id]}" alt="">
          <span class="sl-jp-name">${j.name}</span>
        </div>
        <div class="sl-jp-sum">${money(j.amount)}</div>
      </div>`).join('');
  }

  /**
   * Одна лента. Ячеек на одну больше, чем позиций на ленте, плюс три сверху:
   * лента закольцована, и последние три ячейки повторяют первые - иначе при
   * переходе через ноль в окне была бы дырка.
   */
  function reelHtml(reel) {
    const strip = ui.slot.strips[reel];
    const cells = strip.concat(strip.slice(0, ui.slot.rows));
    return `<div class="sl-reel" data-reel="${reel}">
      <div class="sl-strip">
        ${cells.map((id) => `<div class="sl-cell" data-sym="${id}">${symbolImg(id)}</div>`).join('')}
      </div>
    </div>`;
  }

  function betControls() {
    return `
      <div class="sl-bet">
        <button class="sl-round sl-bet-btn" data-act="bet-down" aria-label="Уменьшить ставку">${icon('minus')}</button>
        <div class="sl-bet-box">
          <div class="sl-bet-label">СТАВКА</div>
          <div class="sl-bet-value" id="slotBet">${money(ui.bet)}</div>
        </div>
        <button class="sl-round sl-bet-btn" data-act="bet-up" aria-label="Увеличить ставку">${icon('plus')}</button>
      </div>`;
  }

  function render() {
    const box = root();
    if (!box || !ui.slot) return;

    box.innerHTML = `
      <div class="sl-stage" id="slotStage">
        <div class="sl-bg">
          <img class="sl-bg-sky" src="/assets/ui/slot-bg-sky.webp" alt="">
          <img class="sl-bg-cliff" src="/assets/ui/slot-bg-cliff.webp" alt="">
          <img class="sl-bg-jungle" src="/assets/ui/slot-bg-jungle.webp" alt="">
        </div>

        <div class="sl-top">
          <img class="sl-logo" src="/assets/ui/slot-logo.webp" alt="TREASURE ISLAND">
          <div class="sl-jackpots">${jackpotPlaques()}</div>
          <div class="sl-bonus-badge" id="slotBonusBadge" hidden>
            <img src="/assets/ui/slot-chest.webp" alt="">
            <div>
              <div class="sl-bonus-title">БОНУС АКТИВИРОВАН</div>
              <div class="sl-bonus-dots" id="slotBonusDots"></div>
            </div>
          </div>
        </div>

        <div class="sl-rail">
          <button class="sl-round" data-act="rules" aria-label="Правила">${icon('info')}</button>
          <button class="sl-round" data-act="sound" id="slotSound" aria-label="Звук">${icon('sound')}</button>
          <button class="sl-round" data-act="full" aria-label="Во весь экран">${icon('full')}</button>
        </div>

        <div class="sl-main">
          <div class="sl-machine">
            <img class="sl-frame sl-frame-top" src="/assets/ui/slot-frame-top.webp" alt="">
            <img class="sl-frame sl-frame-left" src="/assets/ui/slot-frame-left.webp" alt="">
            <img class="sl-frame sl-frame-right" src="/assets/ui/slot-frame-right.webp" alt="">
            <img class="sl-frame sl-frame-bottom" src="/assets/ui/slot-frame-bottom.webp" alt="">

            <div class="sl-reels" id="slotReels">
              ${Array.from({ length: ui.slot.reels }, (_, r) => reelHtml(r)).join('')}
              <svg class="sl-lines" id="slotLines" viewBox="0 0 100 60" preserveAspectRatio="none"></svg>
            </div>

            <div class="sl-banner" id="slotBanner" hidden></div>
          </div>

          <div class="sl-panel">
            <div class="sl-balance">
              <div class="sl-balance-label">БАЛАНС</div>
              <div class="sl-balance-value" id="slotBalance">${money(state.user?.balance || 0)}</div>
            </div>

            ${betControls()}

            <button class="sl-spin" id="slotSpin" aria-label="Крутить">
              <img src="/assets/ui/slot-spin.webp" alt="">
              <span class="sl-spin-count" id="slotSpinCount"></span>
            </button>

            <button class="sl-btn sl-btn-max" data-act="max">МАКС<br>СТАВКА</button>
            <button class="sl-btn sl-btn-auto" data-act="auto">АВТО<br><span id="slotAutoMark">∞</span></button>
            <button class="sl-btn sl-btn-buy" data-act="buy">${icon('gift', 'sl-ico sl-ico-gift')}<span>КУПИТЬ<br>БОНУС</span></button>
          </div>

          <div class="sl-win" id="slotWin" hidden>
            <span class="sl-win-label">ВЫИГРЫШ</span>
            <span class="sl-win-sum" id="slotWinSum">0 ₽</span>
          </div>

          <div class="sl-features">
            <button class="sl-feat" data-act="rules">
              <img src="${FEATURE_ART.bonus}" alt="">
              <span class="sl-feat-title">БОНУСНЫЙ РАУНД</span>
              <span class="sl-feat-sub">${ui.slot.freeSpins} бесплатных вращений</span>
            </button>
            <button class="sl-feat" data-act="rules">
              <img src="${FEATURE_ART.wild}" alt="">
              <span class="sl-feat-title">ДИКИЕ СИМВОЛЫ</span>
              <span class="sl-feat-sub">WILD</span>
            </button>
            <button class="sl-feat" data-act="rules">
              <img src="${FEATURE_ART.expand}" alt="">
              <span class="sl-feat-title">РАСШИРЯЮЩИЕСЯ СИМВОЛЫ</span>
              <span class="sl-feat-sub">Во время бонуса</span>
            </button>
          </div>

          <div class="sl-tools">
            <button class="sl-round" data-act="paytable" aria-label="Таблица выплат">${icon('table')}</button>
            <button class="sl-round" data-act="history" aria-label="История">${icon('clock')}</button>
            <button class="sl-round" data-act="settings" aria-label="Настройки">${icon('gear')}</button>
          </div>
        </div>

        <aside class="sl-side">
          <div class="sl-card sl-paytable">
            <div class="sl-card-head">ТАБЛИЦА ВЫПЛАТ</div>
            ${paytableHtml()}
          </div>
          <div class="sl-card sl-history">
            <div class="sl-card-head">${icon('clock', 'sl-ico sl-ico-sm')} ИСТОРИЯ</div>
            <div class="sl-history-list" id="slotHistory">${historyHtml()}</div>
          </div>
        </aside>
      </div>

      <div class="sl-modal" id="slotModal" hidden>
        <div class="sl-modal-box">
          <button class="sl-modal-close" data-act="modal-close" aria-label="Закрыть">${icon('close')}</button>
          <div class="sl-modal-body" id="slotModalBody"></div>
        </div>
      </div>`;

    bind();
    layoutReels();
    updateBonusBadge();
  }

  /* ============================================================
     ТАБЛИЦА ВЫПЛАТ И ИСТОРИЯ
     ============================================================ */

  function paytableHtml() {
    const rows = ui.slot.symbols.map((s) => `
      <div class="sl-pay">
        ${symbolImg(s.id, 'sl-pay-img')}
        <div class="sl-pay-nums">
          <span>5 - ${fmt(s.pays[2])}x</span>
          <span>4 - ${fmt(s.pays[1])}x</span>
          <span>3 - ${fmt(s.pays[0])}x</span>
        </div>
      </div>`).join('');

    const scatter = Object.entries(ui.slot.scatterPays)
      .map(([n, m]) => `${n} - ${m}x ставки`).join(', ');

    return `
      <div class="sl-pay-grid">${rows}</div>
      <div class="sl-pay-special">
        <div class="sl-pay">
          ${symbolImg('wild', 'sl-pay-img')}
          <div class="sl-pay-text"><b>WILD</b><br>Заменяет все символы, кроме SCATTER.
            Не выпадает на первом и пятом барабане.</div>
        </div>
        <div class="sl-pay">
          ${symbolImg('scatter', 'sl-pay-img')}
          <div class="sl-pay-text"><b>SCATTER</b><br>3 и больше в любом месте:
            ${ui.slot.freeSpins} бесплатных вращений. Платит ${esc(scatter)}.</div>
        </div>
      </div>
      <p class="sl-pay-note">Выплаты указаны в ставках на линию. Линий
        ${ui.slot.lines.length}, ставка на линию равна общей, делённой на
        ${ui.slot.lines.length}. Линии считаются слева направо от первого барабана.
        Отдача игры ${(ui.slot.rtp * 100).toFixed(0)}%.</p>`;
  }

  function historyHtml() {
    if (!ui.history.length) return '<div class="sl-history-empty">Прокрутов ещё не было</div>';
    return ui.history.map((h) => `
      <div class="sl-history-row">
        <span class="sl-h-id">#${h.id}</span>
        <span class="sl-h-bet">${fmt(h.bet)} ₽</span>
        <span class="sl-h-win ${h.win > 0 ? 'is-win' : ''}">${h.win > 0 ? '+' : ''}${fmt(h.win)} ₽</span>
        <span class="sl-h-time">${h.time}</span>
      </div>`).join('');
  }

  function pushHistory(bet, win) {
    ui.spinNo++;
    const d = new Date();
    ui.history.unshift({
      id: ui.spinNo,
      bet,
      win,
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    });
    ui.history = ui.history.slice(0, 40);
    const box = document.getElementById('slotHistory');
    if (box) box.innerHTML = historyHtml();
  }

  /* ============================================================
     ЛЕНТЫ: ГЕОМЕТРИЯ И ДВИЖЕНИЕ
     ============================================================ */

  /**
   * Снимает высоту ячейки с разметки и заводит состояние лент.
   *
   * Высота НЕ зашита числом: на телефоне и на компьютере она разная, а
   * остановка обязана попадать ровно в ячейку. Зашитое число оставило бы
   * ленту стоять между символами.
   */
  function layoutReels() {
    const reels = root()?.querySelectorAll('.sl-reel');
    if (!reels?.length) return;

    ui.reels = Array.from(reels).map((el, index) => {
      const strip = el.querySelector('.sl-strip');
      const cell = strip.firstElementChild?.getBoundingClientRect().height || 0;
      const state0 = ui.reels[index];
      return {
        el,
        strip,
        cell,
        length: ui.slot.strips[index].length,
        pos: state0?.pos ?? 0,
        spinning: false,
        target: null,
      };
    });
    ui.reels.forEach(draw);
  }

  function draw(reel) {
    reel.strip.style.transform = `translate3d(0, ${-reel.pos * reel.cell}px, 0)`;
  }

  /** Ставит барабан в конкретную позицию ленты без анимации. */
  function setOffsets(offsets) {
    ui.reels.forEach((reel, i) => {
      reel.pos = offsets[i] % reel.length;
      draw(reel);
    });
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  /**
   * Крутит барабан и доводит его до позиции offset.
   *
   * Перелёт с возвратом (ANTICIPATE) - не украшение: барабан, вставший
   * намертво, выглядит как подмена картинки. Лента проскакивает на треть
   * ячейки и отыгрывает назад, как настоящая на тормозе.
   */
  function spinReel(reel, offset, duration, delay) {
    return new Promise((resolve) => {
      const start = performance.now() + delay;
      const turns = MIN_TURNS + Math.random() * 0.4;
      const from = reel.pos;
      // Ближайшая позиция, кратная длине ленты, не ближе MIN_TURNS оборотов.
      let to = from + turns * reel.length;
      to = Math.ceil((to - offset) / reel.length) * reel.length + offset;
      const overshoot = 0.34;

      reel.spinning = true;
      function frame(now) {
        if (now < start) { requestAnimationFrame(frame); return; }
        const t = Math.min(1, (now - start) / duration);
        // Хвост движения: небольшой перелёт и возврат на место.
        const e = easeOut(t);
        const bounce = t > 0.86 ? Math.sin((t - 0.86) / 0.14 * Math.PI) * overshoot : 0;
        reel.pos = from + (to - from) * e + bounce;
        draw(reel);
        if (t < 1) { requestAnimationFrame(frame); return; }
        reel.pos = offset % reel.length;
        draw(reel);
        reel.spinning = false;
        resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /* ============================================================
     ПОДСВЕТКА ЛИНИЙ
     ============================================================ */

  function clearHighlights() {
    root()?.querySelectorAll('.sl-cell.is-win').forEach((el) => el.classList.remove('is-win'));
    root()?.querySelectorAll('.sl-cell.is-scatter').forEach((el) => el.classList.remove('is-scatter'));
    const svg = document.getElementById('slotLines');
    if (svg) svg.innerHTML = '';
  }

  /**
   * Ячейка окна: барабан показывает три подряд идущие позиции ленты, начиная
   * с той, на которой он встал. Поэтому строка окна это (позиция + ряд).
   */
  function cellEl(reel, row) {
    const r = ui.reels[reel];
    if (!r) return null;
    const index = (Math.round(r.pos) + row) % r.length;
    return r.strip.children[index] || null;
  }

  /** Рисует линию поверх барабанов: по центрам выигрышных клеток. */
  function drawLine(win, color) {
    const svg = document.getElementById('slotLines');
    if (!svg) return;
    const reels = ui.slot.reels;
    const rows = ui.slot.rows;
    const pts = win.cells.map(([reel, row]) => {
      const x = ((reel + 0.5) / reels) * 100;
      const y = ((row + 0.5) / rows) * 60;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    svg.insertAdjacentHTML('beforeend',
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="0.9"
         stroke-linecap="round" stroke-linejoin="round" class="sl-line"></polyline>`);
  }

  /** Цвета линий: подряд идущие линии не должны сливаться. */
  const LINE_COLORS = ['#ffd45e', '#5ee0ff', '#ff8ad4', '#9dff74', '#ffb3f0'];

  async function showWins(result) {
    clearHighlights();
    if (result.scatters >= 3) {
      for (let r = 0; r < ui.slot.reels; r++) {
        for (let row = 0; row < ui.slot.rows; row++) {
          const el = cellEl(r, row);
          if (el?.dataset.sym === 'scatter') el.classList.add('is-scatter');
        }
      }
    }
    if (!result.wins.length) return;

    // Сначала все линии разом: игрок видит масштаб выигрыша целиком.
    result.wins.forEach((w, i) => {
      drawLine(w, LINE_COLORS[i % LINE_COLORS.length]);
      w.cells.forEach(([reel, row]) => cellEl(reel, row)?.classList.add('is-win'));
    });

    // Потом по одной, если их несколько: иначе не разобрать, что за что.
    if (result.wins.length > 1 && !ui.fast) {
      await pause(1100);
      for (const w of result.wins) {
        clearHighlights();
        drawLine(w, '#ffd45e');
        w.cells.forEach(([reel, row]) => cellEl(reel, row)?.classList.add('is-win'));
        await pause(620);
      }
    }
  }

  /* ============================================================
     СЧЁТЧИК ВЫИГРЫША
     ============================================================ */

  async function countUp(amount, ms = 900) {
    const box = document.getElementById('slotWin');
    const sum = document.getElementById('slotWinSum');
    if (!box || !sum) return;
    if (amount <= 0) { box.hidden = true; return; }

    box.hidden = false;
    const start = performance.now();
    await new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - start) / (ui.fast ? ms * FAST_FACTOR : ms));
        sum.textContent = money(Math.round(amount * easeOut(t)));
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /* ============================================================
     ПЛАШКИ СОБЫТИЙ
     ============================================================ */

  async function banner(title, sub, cls, ms = 1800) {
    const el = document.getElementById('slotBanner');
    if (!el) return;
    el.className = `sl-banner ${cls}`;
    el.innerHTML = `<div class="sl-banner-title">${esc(title)}</div>
                    <div class="sl-banner-sub">${esc(sub)}</div>`;
    el.hidden = false;
    await pause(ui.fast ? ms * FAST_FACTOR : ms);
    el.hidden = true;
  }

  /**
   * Порог крупного выигрыша считается от СТАВКИ, а не от суммы.
   *
   * «BIG WIN» на тысячу рублей при ставке десять тысяч - издёвка. Игрок
   * оценивает выигрыш относительно того, сколько поставил, и пороги обязаны
   * считаться так же.
   */
  function winTier(payout, bet) {
    const x = payout / bet;
    if (x >= 50) return { title: 'MEGA WIN', cls: 'is-mega' };
    if (x >= 20) return { title: 'BIG WIN', cls: 'is-big' };
    return null;
  }

  /* ============================================================
     БОНУС
     ============================================================ */

  function updateBonusBadge() {
    const badge = document.getElementById('slotBonusBadge');
    const dots = document.getElementById('slotBonusDots');
    if (!badge) return;
    badge.hidden = !ui.free;
    if (!ui.free || !dots) return;
    const total = ui.slot.freeSpins;
    const left = ui.free.spinsLeft;
    dots.innerHTML = Array.from({ length: Math.min(total, 10) },
      (_, i) => `<span class="${i < left ? 'on' : ''}"></span>`).join('');
    const count = document.getElementById('slotSpinCount');
    if (count) count.textContent = left > 0 ? left : '';
  }

  /** Доигрывает серию фриспинов до конца, по одному прокруту. */
  async function playFreeSeries() {
    let total = 0;
    while (ui.free && ui.free.spinsLeft > 0) {
      let res;
      try {
        res = await api('/api/slot/free', {});
      } catch (err) {
        toast(err.message);
        break;
      }
      ui.free.spinsLeft = res.spinsLeft;
      total = res.sessionWin;
      updateBonusBadge();

      await runReels(res, { free: true });

      if (res.payout > 0) {
        snd('bigWin');
        await countUp(res.payout, 700);
      }
      applyUser(res);
      await pause(ui.fast ? 160 : 420);
    }

    ui.free = null;
    updateBonusBadge();
    if (total > 0) {
      await banner('БОНУС ЗАВЕРШЁН', `Выигрыш ${money(total)}`, 'is-bonus', 2200);
      pushHistory(0, total);
    }
  }

  /* ============================================================
     ПРОКРУТ
     ============================================================ */

  function applyUser(res) {
    if (res.user) deps.onUser?.(res.user);
    const box = document.getElementById('slotBalance');
    if (box) box.textContent = money(res.user?.balance ?? res.balance ?? 0);
  }

  /**
   * Останавливает пять барабанов по очереди на позициях, которые решил сервер.
   *
   * ЗАДЕРЖКА ПЕРЕД ПОСЛЕДНИМ БАРАБАНОМ появляется только тогда, когда на уже
   * остановившихся лежат два scatter: третий решает бонус. Ничего не меняя в
   * исходе, она отмечает единственный момент игры, ради которого стоит
   * смотреть на экран.
   */
  async function runReels(res, { free = false } = {}) {
    clearHighlights();
    const winBox = document.getElementById('slotWin');
    if (winBox) winBox.hidden = true;

    snd('bet');
    const duration = ui.fast ? SPIN_MS * FAST_FACTOR : SPIN_MS;
    const step = ui.fast ? REEL_STEP_MS * FAST_FACTOR : REEL_STEP_MS;

    const stops = [];
    let extra = 0;
    for (let i = 0; i < ui.reels.length; i++) {
      /*
       * Сколько scatter уже показано на остановленных барабанах. Считаем по
       * сетке, которую прислал сервер: она и есть то, что встанет на экране.
       */
      if (i === ui.slot.reels - 1 && !ui.fast) {
        const shown = res.grid.slice(0, i).flat().filter((s) => s === 'scatter').length;
        if (shown >= 2) {
          extra += ANTICIPATION_MS;
          ui.reels[i].el.classList.add('is-anticipating');
        }
      }
      stops.push(spinReel(ui.reels[i], res.offsets[i], duration, i * step + extra)
        .then(() => {
          ui.reels[i].el.classList.remove('is-anticipating');
          snd('land');
        }));
    }
    await Promise.all(stops);

    // Во фриспинах wild расширяется на весь барабан: рисуем это по сетке
    // сервера, а не по ленте - на ленте расширения нет.
    if (free) {
      res.grid.forEach((column, reel) => {
        if (column.every((s) => s === 'wild')) {
          ui.reels[reel].el.classList.add('is-expanded');
          for (let row = 0; row < ui.slot.rows; row++) {
            const el = cellEl(reel, row);
            if (el) { el.dataset.sym = 'wild'; el.firstElementChild.src = SYM_ART.wild; }
          }
        } else {
          ui.reels[reel].el.classList.remove('is-expanded');
        }
      });
    } else {
      ui.reels.forEach((r) => r.el.classList.remove('is-expanded'));
      // Лента вернулась к своим символам: расширение жило только в бонусе.
      restoreStrips();
    }

    await showWins(res);
  }

  /** Возвращает лентам их настоящие символы после расширения wild. */
  function restoreStrips() {
    ui.reels.forEach((reel, i) => {
      const strip = ui.slot.strips[i];
      const cells = reel.strip.children;
      for (let k = 0; k < cells.length; k++) {
        const id = strip[k % strip.length];
        if (cells[k].dataset.sym !== id) {
          cells[k].dataset.sym = id;
          cells[k].firstElementChild.src = SYM_ART[id];
        }
      }
    });
  }

  async function spin() {
    if (ui.busy || !ui.slot) return;
    if (ui.free) { toast('Идут бесплатные вращения'); return; }

    ui.busy = true;
    setSpinning(true);

    let res;
    try {
      res = await api('/api/slot/spin', { bet: ui.bet });
    } catch (err) {
      ui.busy = false;
      ui.auto = 0;
      setSpinning(false);
      if (String(err.message).includes('INSUFFICIENT') || String(err.message).includes('Не хватает')) {
        deps.onNoFunds?.(ui.bet);
      } else toast(err.message);
      return;
    }

    await runReels(res);
    applyUser(res);
    pushHistory(ui.bet, res.payout);
    ui.lastWin = res.payout;

    if (res.payout > 0) {
      const tier = winTier(res.payout, ui.bet);
      if (tier) { snd('bigWin'); await banner(tier.title, money(res.payout), tier.cls); }
      else snd('collect');
      await countUp(res.payout);
    }

    if (res.jackpot) {
      snd('bigWin');
      haptic('success');
      await banner(`JACKPOT ${res.jackpot.name}`, money(res.jackpot.amount), 'is-jackpot', 3200);
      pushHistory(0, res.jackpot.amount);
    }

    if (res.freeSpins > 0) {
      ui.auto = 0;
      ui.free = { spinsLeft: res.freeSpins, lineBet: res.lineBet };
      updateBonusBadge();
      snd('bigWin');
      haptic('success');
      await banner(`${res.freeSpins} ФРИСПИНОВ`, 'Расширяющиеся WILD', 'is-bonus', 2600);
      await playFreeSeries();
    }

    ui.busy = false;
    setSpinning(false);

    /*
     * Автопрокрут останавливается сам, когда запустился бонус: доигрывать
     * серию и тут же уходить в следующую ставку означало бы, что игрок не
     * увидел, сколько выиграл.
     */
    if (ui.auto !== 0 && !ui.free) {
      if (ui.auto > 0) ui.auto--;
      updateAuto();
      if (ui.auto !== 0) {
        await pause(ui.fast ? 120 : 380);
        spin();
      }
    }
  }

  function setSpinning(on) {
    const btn = document.getElementById('slotSpin');
    if (btn) { btn.classList.toggle('is-spinning', on); btn.disabled = on; }
  }

  /* ============================================================
     ПАНЕЛЬ
     ============================================================ */

  function setBet(next) {
    const bets = ui.slot.bets;
    ui.bet = bets.includes(next) ? next : bets[0];
    const box = document.getElementById('slotBet');
    if (box) box.textContent = money(ui.bet);
  }

  function stepBet(dir) {
    const bets = ui.slot.bets;
    const at = bets.indexOf(ui.bet);
    setBet(bets[Math.min(bets.length - 1, Math.max(0, at + dir))]);
    haptic('light');
  }

  const AUTO_STEPS = [10, 25, 50, 100, -1, 0];

  function toggleAuto() {
    const at = AUTO_STEPS.indexOf(ui.auto);
    ui.auto = AUTO_STEPS[(at + 1) % AUTO_STEPS.length];
    updateAuto();
    if (ui.auto !== 0 && !ui.busy) spin();
  }

  function updateAuto() {
    const mark = document.getElementById('slotAutoMark');
    if (mark) mark.textContent = ui.auto === 0 ? 'ВЫКЛ' : ui.auto === -1 ? '∞' : ui.auto;
    root()?.querySelector('.sl-btn-auto')?.classList.toggle('is-on', ui.auto !== 0);
  }

  /* ============================================================
     ОКНА
     ============================================================ */

  function openModal(html) {
    const box = document.getElementById('slotModal');
    const body = document.getElementById('slotModalBody');
    if (!box || !body) return;
    body.innerHTML = html;
    box.hidden = false;
  }

  function closeModal() {
    const box = document.getElementById('slotModal');
    if (box) box.hidden = true;
  }

  function rulesHtml() {
    const lines = ui.slot.lines.length;
    return `
      <h2 class="sl-modal-title">ПРАВИЛА</h2>
      <ul class="sl-rules">
        <li>Пять барабанов по три символа, ${lines} линий. Линии считаются
          слева направо и обязательно от первого барабана: разрыв обрывает цепочку.</li>
        <li>Выплаты в таблице указаны в ставках НА ЛИНИЮ. Ставка на линию равна
          общей ставке, делённой на ${lines}.</li>
        <li><b>WILD</b> заменяет любой символ, кроме SCATTER. На первом и пятом
          барабане он не встречается.</li>
        <li><b>SCATTER</b> платит из любого места экрана. Три и больше дают
          ${ui.slot.freeSpins} бесплатных вращений.</li>
        <li>Во время бесплатных вращений WILD расширяется на весь барабан.
          Внутри бонуса новые вращения не выдаются.</li>
        <li>Джекпоты разыгрываются отдельно от барабанов. Шанс пропорционален
          ставке: чем крупнее ставка, тем больше прав на приз.</li>
        <li>Отдача игры ${(ui.slot.rtp * 100).toFixed(0)}%. Покупка бонуса стоит
          ${fmt(ui.slot.buyBonusPrice)} ставок и имеет ту же отдачу, что и обычный прокрут.</li>
      </ul>`;
  }

  function settingsHtml() {
    return `
      <h2 class="sl-modal-title">НАСТРОЙКИ</h2>
      <label class="sl-switch">
        <input type="checkbox" data-opt="sound" ${ui.sound ? 'checked' : ''}>
        <span>Звук</span>
      </label>
      <label class="sl-switch">
        <input type="checkbox" data-opt="fast" ${ui.fast ? 'checked' : ''}>
        <span>Быстрый прокрут</span>
      </label>
      <p class="sl-modal-note">Быстрый прокрут сокращает анимацию. На исход и
        на выплату он не влияет никак: результат решает сервер до начала
        вращения.</p>`;
  }

  function buyHtml() {
    const price = ui.slot.buyBonusPrice * ui.bet;
    return `
      <h2 class="sl-modal-title">КУПИТЬ БОНУС</h2>
      <p class="sl-modal-lead">${ui.slot.freeSpins} бесплатных вращений с
        расширяющимися WILD при ставке ${money(ui.bet)}.</p>
      <div class="sl-buy-price">${money(price)}</div>
      <p class="sl-modal-note">Цена посчитана из матожидания бонуса: покупка
        имеет ту же отдачу, что и обычный прокрут. Дешевле обычной игры бонус
        не бывает и дороже тоже.</p>
      <button class="btn btn-primary sl-buy-go" data-act="buy-go">Купить за ${money(price)}</button>`;
  }

  async function buyBonus() {
    if (ui.busy || ui.free) return;
    ui.busy = true;
    let res;
    try {
      res = await api('/api/slot/buy', { bet: ui.bet });
    } catch (err) {
      ui.busy = false;
      if (String(err.message).includes('INSUFFICIENT') || String(err.message).includes('Не хватает')) {
        deps.onNoFunds?.(ui.slot.buyBonusPrice * ui.bet);
      } else toast(err.message);
      return;
    }
    closeModal();
    applyUser(res);
    pushHistory(res.price, 0);
    ui.free = { spinsLeft: res.spinsLeft, lineBet: res.lineBet };
    updateBonusBadge();
    await banner(`${res.spinsLeft} ФРИСПИНОВ`, 'Куплено', 'is-bonus', 2000);
    await playFreeSeries();
    ui.busy = false;
  }

  /* ============================================================
     СОБЫТИЯ
     ============================================================ */

  function bind() {
    const box = root();
    if (!box) return;

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) {
        if (e.target.id === 'slotModal') closeModal();
        return;
      }
      const act = btn.dataset.act;
      if (act === 'bet-down') stepBet(-1);
      else if (act === 'bet-up') stepBet(1);
      else if (act === 'max') { setBet(ui.slot.bets[ui.slot.bets.length - 1]); haptic('medium'); }
      else if (act === 'auto') toggleAuto();
      else if (act === 'buy') openModal(buyHtml());
      else if (act === 'buy-go') buyBonus();
      else if (act === 'rules') openModal(rulesHtml());
      else if (act === 'paytable') openModal(`<h2 class="sl-modal-title">ТАБЛИЦА ВЫПЛАТ</h2>${paytableHtml()}`);
      else if (act === 'history') openModal(`<h2 class="sl-modal-title">ИСТОРИЯ</h2>
        <div class="sl-history-list">${historyHtml()}</div>`);
      else if (act === 'settings') openModal(settingsHtml());
      else if (act === 'modal-close') closeModal();
      else if (act === 'sound') toggleSound();
      else if (act === 'full') toggleFull();
    });

    box.addEventListener('change', (e) => {
      const opt = e.target.dataset?.opt;
      if (opt === 'sound') { ui.sound = e.target.checked; syncSound(); }
      if (opt === 'fast') ui.fast = e.target.checked;
    });

    document.getElementById('slotSpin')?.addEventListener('click', () => {
      haptic('medium');
      if (ui.auto !== 0) { ui.auto = 0; updateAuto(); return; }
      spin();
    });

    // Пересчёт высоты ячейки: на повороте телефона она меняется, и без этого
    // лента встала бы между символами.
    window.addEventListener('resize', onResize);
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (root()?.offsetParent) layoutReels(); }, 180);
  }

  function toggleSound() {
    ui.sound = !ui.sound;
    syncSound();
    haptic('light');
  }

  function syncSound() {
    const btn = document.getElementById('slotSound');
    if (btn) btn.innerHTML = icon(ui.sound ? 'sound' : 'mute');
    deps.onSound?.(ui.sound);
  }

  function toggleFull() {
    const stage = document.getElementById('slotStage');
    if (!stage) return;
    stage.classList.toggle('is-full');
    // Пересчитать ячейку обязательно: во весь экран она выше.
    setTimeout(layoutReels, 60);
  }

  /* ============================================================
     ВХОД
     ============================================================ */

  async function open() {
    if (!ui.slot) {
      let data;
      try {
        data = await api('/api/slot', {});
      } catch (err) {
        toast(err.message);
        return;
      }
      ui.slot = data.slot;
      ui.bet = ui.slot.bets.includes(100) ? 100 : ui.slot.bets[0];
      if (data.session) ui.free = { spinsLeft: data.session.spinsLeft, lineBet: data.session.lineBet };
    }

    render();
    // Начальная картинка берётся с лент, а не из случайных символов: иначе
    // первый же прокрут менял бы экран рывком.
    setOffsets(ui.slot.strips.map((s) => Math.floor(Math.random() * s.length)));

    if (ui.free) {
      updateBonusBadge();
      await banner('БОНУС ПРОДОЛЖАЕТСЯ', `${ui.free.spinsLeft} вращений`, 'is-bonus', 1800);
      await playFreeSeries();
    }
  }

  /** Уход из раздела гасит автопрокрут: иначе он крутит ставки за спиной. */
  function close() {
    ui.auto = 0;
    updateAuto();
  }

  function refreshBalance() {
    const box = document.getElementById('slotBalance');
    if (box) box.textContent = money(state.user?.balance || 0);
  }

  return { open, close, render, refreshBalance };
}
