/**
 * Слоты: полка игр, барабаны, панель, бонус и все окна.
 *
 * ПОЧЕМУ ЭТО НЕ КАРТИНКА С КНОПКАМИ.
 *
 * Присланные макеты - большие PNG. Положить такой на страницу и накидать
 * сверху прозрачные кнопки было бы вдвое быстрее и полностью бесполезно:
 * барабаны бы не крутились, ставка бы не менялась, выигрыш бы не считался.
 * Поэтому макеты разобраны на части (tools/slot-assets.mjs и
 * tools/slot-golden-assets.mjs), из них взяты только рисунки - символы,
 * логотипы, колонны, доски, слои фона, - а всё остальное собрано вёрсткой:
 * панели, плашки джекпотов, таблица выплат, история, десяток окон.
 *
 * ГЛАВНОЕ ПРАВИЛО: БАРАБАН ОСТАНАВЛИВАЕТСЯ НА ТОМ, ЧТО РЕШИЛ СЕРВЕР.
 *
 * Клиент не придумывает ни одного символа. Сервер присылает пять позиций на
 * лентах, ленты у клиента те же самые, и прокрут доводится ровно до этих
 * позиций. Поэтому на экране никогда не окажется картинка, не совпадающая с
 * выплатой: остановка и есть результат, а не иллюстрация к нему.
 *
 * ЛЕНТА ВИРТУАЛЬНАЯ, И ЭТО НЕ ОПТИМИЗАЦИЯ РАДИ ОПТИМИЗАЦИИ. У GOLDEN LEGACY
 * лента длиной 115 позиций; выложить её в разметку целиком это шестьсот
 * картинок на экран, и телефон это замечает. В разметке живёт окно из восьми
 * ячеек на барабан, а символы в них переписываются при прокрутке. Сорок узлов
 * вместо шестисот, и длина ленты перестаёт влиять на скорость вовсе.
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
const SPIN_MS = 640;
const REEL_STEP_MS = 140;

/** Быстрый режим: та же последовательность, вчетверо короче. */
const FAST_FACTOR = 0.35;

/**
 * Задержка перед последним барабаном, когда на остановившихся уже лежат два
 * scatter.
 *
 * Это не обман: исход УЖЕ решён сервером, и задержка ничего не меняет. Она
 * честно отмечает, что прямо сейчас решается бонус, и без неё самый важный
 * момент игры проходит незамеченным.
 */
const ANTICIPATION_MS = 900;

/** Сколько полных оборотов лента обязана пройти до остановки. */
const MIN_TURNS = 2;

/**
 * Сколько ячеек барабана живёт в разметке.
 *
 * Три видимых плюс запас сверху и снизу: на быстрой прокрутке между кадрами
 * лента успевает уехать больше чем на ячейку, и без запаса сверху появлялась
 * бы щель.
 */
const CELLS = 8;

/** Пороги крупного выигрыша, в ставках. */
const BIG_WIN = 20;
const MEGA_WIN = 50;

/* ============================================================
   ЗНАЧКИ
   ============================================================ */

const ICO = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  sound: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M4 9v6h4l5 4V5L8 9H4zm11 1 5 5m0-5-5 5',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v1m0 3v5',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2 .5-.6 1.5 1 1.8-1.6 1.6-1.8-1-1.5.6L13 19h-2l-.5-2-1.5-.6-1.8 1-1.6-1.6 1-1.8L6 12.5 4 12v-2l2-.5.6-1.5-1-1.8 1.6-1.6 1.8 1L10.5 5 11 3h2l.5 2 1.5.6 1.8-1 1.6 1.6-1 1.8.6 1.5 2 .5z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zm9 0v13M12 7S9 3 7 4.5 8.5 7 12 7zm0 0s3-4 5-2.5S15.5 7 12 7z',
  music: 'M9 18V5l10-2v13M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6 3 3M18 6l-3 3M9 15l-3 3',
  close: 'M6 6l12 12M18 6 6 18',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
  play: 'M8 5l11 7-11 7z',
  stop: 'M7 7h10v10H7z',
  back: 'M15 5l-7 7 7 7',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6m0-6-6 6',
};

const icon = (name, cls = 'sl-ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="${ICO[name]}"></path></svg>`;

/* ============================================================
   НАСТРОЙКИ
   ============================================================ */

const SETTINGS_KEY = 'luckybox.slot.settings';
const DEFAULT_SETTINGS = { sound: true, music: false, animation: true, fast: false };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    // Приватное окно, запрет на хранилище, что угодно: настройки не та вещь,
    // ради которой игра имеет право не открыться.
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* см. выше */ }
}

/* ============================================================
   МОДУЛЬ
   ============================================================ */

export function createSlot(deps) {
  const { api, esc, fmt, money, toast, haptic, state, sounds = {} } = deps;

  /** Всё изменяемое состояние экрана в одном месте. */
  const ui = {
    cards: [],           // полка: короткие описания игр
    slot: null,          // открытая игра целиком
    bet: 100,
    busy: false,
    auto: 0,             // сколько автопрокрутов осталось, -1 это «бесконечно»
    free: null,          // { spinsLeft, lineBet } пока идёт бонус
    history: [],
    spinNo: 0,
    settings: loadSettings(),
    reels: [],
    lastAnswer: null,
  };

  /*
   * ЗВУК СОБРАН СОБЫТИЯМИ, А НЕ ВЫЗОВАМИ ФУНКЦИЙ ПО МЕСТУ.
   *
   * Список событий закрытый, и это позволяет позже подменить реализацию
   * целиком - хоть на настоящие файлы, хоть на тишину, - не трогая игровой
   * код. Пока событие звучит синтезатором проекта: отдельных файлов слота
   * нет, а тащить их на телефон ради восьми звуков незачем.
   */
  const SOUND_MAP = {
    buttonClick: 'tick', spinStart: 'bet', reelSpin: null, reelStop: 'land',
    win: 'collect', bigWin: 'bigWin', scatter: 'reveal', bonus: 'bigWin',
  };

  function snd(event) {
    if (!ui.settings.sound) return;
    const name = SOUND_MAP[event];
    if (!name) return;
    try { sounds[name]?.(); } catch { /* звук не обязателен */ }
  }

  const root = () => document.getElementById('slotRoot');
  const shelfBox = () => document.getElementById('slotShelf');

  /* ============================================================
     ИСТОЧНИК ИСХОДА
     ============================================================

     Весь обмен с сервером собран в один объект намеренно. Исход прокрута
     решает сервер, и когда это поменяется (другой протокол, другой адрес,
     заглушка для демо), править придётся здесь, а не в десяти местах
     анимации. */

  const engine = {
    list: () => api('/api/slots', {}),
    describe: (slotId) => api('/api/slot', { slotId }),
    getSpinResult: (slotId, bet) => api('/api/slot/spin', { slotId, bet }),
    getFreeSpinResult: (slotId) => api('/api/slot/free', { slotId }),
    buyBonus: (slotId, bet) => api('/api/slot/buy', { slotId, bet }),
  };

  /* ============================================================
     ПОЛКА
     ============================================================ */

  function shelfHtml() {
    return `
      <div class="game-head">
        <h1 class="game-title">СЛОТЫ</h1>
        <p class="game-sub">Пять барабанов, двадцать линий, бесплатные вращения
          и четыре джекпота. Отдача ${(ui.cards[0]?.rtp * 100 || 94).toFixed(0)}%.</p>
      </div>
      <div class="sl-shelf">
        ${ui.cards.map((c) => `
          <button class="sl-card" data-slot="${esc(c.id)}" data-theme="${esc(c.theme)}">
            <img class="sl-card-cover" src="${c.cover}" alt="" loading="lazy">
            <span class="sl-card-body">
              <span class="sl-card-name">${esc(c.name)}</span>
              <span class="sl-card-tag">${esc(c.tagline)}</span>
              <span class="sl-card-blurb">${esc(c.blurb)}</span>
              <span class="sl-card-facts">
                <span>${c.lines} линий</span>
                <span>Отдача ${(c.rtp * 100).toFixed(0)}%</span>
                <span>Джекпот ${fmt(c.topJackpot)} ₽</span>
              </span>
            </span>
          </button>`).join('')}
      </div>`;
  }

  async function openShelf() {
    const box = shelfBox();
    if (!box) return;
    if (!ui.cards.length) {
      try {
        ui.cards = (await engine.list()).slots;
      } catch (err) {
        toast(err.message);
        return;
      }
    }
    box.innerHTML = shelfHtml();
    box.hidden = false;
    const game = root();
    if (game) { game.hidden = true; game.innerHTML = ''; }

    box.querySelectorAll('[data-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        snd('buttonClick');
        haptic('light');
        open(btn.dataset.slot);
      });
    });
  }

  /* ============================================================
     РАЗМЕТКА ИГРЫ
     ============================================================ */

  const artOf = (id) => ui.slot.art.symbols[id] || '';

  function symbolImg(id, cls = 'sl-sym') {
    return `<img class="${cls}" src="${artOf(id)}" alt="" draggable="false">`;
  }

  function jackpotPlaques() {
    return ui.slot.jackpots.map((j) => `
      <div class="sl-jp sl-jp-${j.id}">
        <span class="sl-jp-name">${j.name}</span>
        <span class="sl-jp-sum">${money(j.amount)}</span>
      </div>`).join('');
  }

  /** Одна лента: окно из CELLS ячеек, символы в нём переписываются на ходу. */
  function reelHtml(reel) {
    return `<div class="sl-reel" data-reel="${reel}">
      <div class="sl-strip">
        ${Array.from({ length: CELLS }, () =>
          `<div class="sl-cell"><img class="sl-sym" alt="" draggable="false"></div>`).join('')}
      </div>
    </div>`;
  }

  function render() {
    const box = root();
    if (!box || !ui.slot) return;
    const s = ui.slot;

    box.innerHTML = `
      <div class="sl-stage" id="slotStage" data-theme="${esc(s.theme)}" data-slot-id="${esc(s.id)}">
        <div class="sl-bg"></div>

        <div class="sl-top">
          <button class="sl-back" data-act="shelf">${icon('back')}<span>Слоты</span></button>
          <img class="sl-logo" src="${s.art.logo}" alt="${esc(s.name)}">
          <div class="sl-jackpots">${jackpotPlaques()}</div>
          <div class="sl-bonus-badge" id="slotBonusBadge" hidden>
            <span class="sl-bonus-title">БЕСПЛАТНЫЕ ВРАЩЕНИЯ</span>
            <span class="sl-bonus-left" id="slotBonusLeft"></span>
          </div>
        </div>

        <div class="sl-rail">
          <button class="sl-round" data-act="menu" aria-label="Меню">${icon('menu')}</button>
          <button class="sl-round" data-act="sound" id="slotSound" aria-label="Звук">${icon('sound')}</button>
          <button class="sl-round" data-act="full" aria-label="Во весь экран">${icon('full')}</button>
        </div>

        <div class="sl-main">
          <div class="sl-machine">
            <div class="sl-frame"></div>
            <div class="sl-reels" id="slotReels">
              ${Array.from({ length: s.reels }, (_, r) => reelHtml(r)).join('')}
              <svg class="sl-lines" id="slotLines" viewBox="0 0 100 60" preserveAspectRatio="none"></svg>
            </div>
            <div class="sl-linetag" id="slotLineTag" hidden></div>
          </div>

          <div class="sl-panel">
            <div class="sl-balance">
              <span class="sl-label">БАЛАНС</span>
              <span class="sl-value" id="slotBalance">${money(state.user?.balance || 0)}</span>
            </div>

            <div class="sl-bet">
              <button class="sl-round sl-bet-btn" data-act="bet-down" aria-label="Уменьшить ставку">${icon('minus')}</button>
              <button class="sl-bet-box" data-act="bet-pick">
                <span class="sl-label">СТАВКА</span>
                <span class="sl-value" id="slotBet">${money(ui.bet)}</span>
              </button>
              <button class="sl-round sl-bet-btn" data-act="bet-up" aria-label="Увеличить ставку">${icon('plus')}</button>
            </div>

            <button class="sl-btn sl-btn-max" data-act="max">МАКС<br>СТАВКА</button>

            <button class="sl-spin" id="slotSpin" aria-label="Крутить">
              <img src="${s.art.spin}" alt="">
              <span class="sl-spin-count" id="slotSpinCount"></span>
            </button>

            <button class="sl-btn sl-btn-auto" data-act="auto">АВТО<br><span id="slotAutoMark">ВЫКЛ</span></button>
            <button class="sl-btn sl-btn-buy" data-act="buy">${icon('gift', 'sl-ico sl-ico-gift')}<span>КУПИТЬ<br>БОНУС</span></button>
          </div>

          <div class="sl-win" id="slotWin" hidden>
            <span class="sl-label">ВЫИГРЫШ</span>
            <span class="sl-win-sum" id="slotWinSum">0 ₽</span>
          </div>

          <div class="sl-tools">
            <button class="sl-round" data-act="paytable" aria-label="Таблица выплат">${icon('table')}</button>
            <button class="sl-round" data-act="history" aria-label="История">${icon('clock')}</button>
            <button class="sl-round" data-act="settings" aria-label="Настройки">${icon('gear')}</button>
          </div>
        </div>

        <aside class="sl-side">
          <div class="sl-card-panel">
            <div class="sl-panel-head">ТАБЛИЦА ВЫПЛАТ</div>
            ${paytableHtml()}
          </div>
          <div class="sl-card-panel">
            <div class="sl-panel-head">${icon('clock', 'sl-ico sl-ico-sm')} ИСТОРИЯ</div>
            <div class="sl-history-list" id="slotHistory">${historyHtml()}</div>
          </div>
        </aside>

        <div class="sl-banner" id="slotBanner" hidden></div>
      </div>

      <div class="sl-modal" id="slotModal" hidden>
        <div class="sl-modal-box">
          <button class="sl-modal-close" data-act="modal-close" aria-label="Закрыть">${icon('close')}</button>
          <div class="sl-modal-body" id="slotModalBody"></div>
        </div>
      </div>`;

    bind();
    layoutReels();
    syncSound();
    updateAuto();
    updateBonusBadge();
  }

  /* ============================================================
     ТАБЛИЦА ВЫПЛАТ И ИСТОРИЯ
     ============================================================ */

  /**
   * Подпись под символом берётся из поля shown, а не из внутренних выплат.
   *
   * Внутри выплаты всегда в линейных ставках, но макеты подписаны по-разному:
   * у одной игры в ставках на линию, у другой в общих. Таблица на экране
   * обязана выглядеть так же, как в макете, иначе игрок сверит и не поймёт.
   */
  function payUnitNote() {
    const lines = ui.slot.lines.length;
    return ui.slot.payUnit === 'total'
      ? `Выплаты указаны в ОБЩИХ ставках: «5 - 100x» это сто ваших ставок.`
      : `Выплаты указаны в ставках НА ЛИНИЮ. Линий ${lines}, ставка на линию
         равна общей, делённой на ${lines}.`;
  }

  function paytableHtml() {
    const rows = ui.slot.symbols.map((s) => `
      <div class="sl-pay">
        ${symbolImg(s.id, 'sl-pay-img')}
        <div class="sl-pay-nums">
          <span>5 - ${fmt(s.shown[2])}x</span>
          <span>4 - ${fmt(s.shown[1])}x</span>
          <span>3 - ${fmt(s.shown[0])}x</span>
        </div>
      </div>`).join('');

    const scatter = Object.entries(ui.slot.scatterPays)
      .map(([n, m]) => `${n} - ${m}x ставки`).join(', ');

    const mult = ui.slot.freeMultiplier > 1
      ? ` Во время бонуса выигрыши по линиям умножаются на ${ui.slot.freeMultiplier}.`
      : '';

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
      <p class="sl-pay-note">${payUnitNote()} Линии считаются слева направо от
        первого барабана.${mult} Отдача игры ${(ui.slot.rtp * 100).toFixed(0)}%.</p>`;
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
    const nodes = root()?.querySelectorAll('.sl-reel');
    if (!nodes?.length) return;

    ui.reels = Array.from(nodes).map((el, index) => {
      const strip = el.querySelector('.sl-strip');
      const cell = strip.firstElementChild?.getBoundingClientRect().height || 0;
      const old = ui.reels[index];
      return {
        el,
        strip,
        cells: Array.from(strip.children),
        cell,
        length: ui.slot.strips[index].length,
        pos: old?.pos ?? 0,
        base: null,
        expanded: false,
      };
    });
    ui.reels.forEach(draw);
  }

  /**
   * Рисует барабан по дробной позиции ленты.
   *
   * Символы переписываются только когда целая часть позиции изменилась: на
   * быстрой прокрутке это раз в несколько кадров вместо сорока присваиваний
   * каждый кадр.
   */
  function draw(reel) {
    const base = Math.floor(reel.pos);
    const frac = reel.pos - base;

    if (base !== reel.base) {
      reel.base = base;
      const strip = ui.slot.strips[ui.reels.indexOf(reel)];
      const L = reel.length;
      for (let k = 0; k < reel.cells.length; k++) {
        const id = reel.expanded && k < ui.slot.rows
          ? 'wild'
          : strip[(((base + k) % L) + L) % L];
        const cell = reel.cells[k];
        if (cell.dataset.sym !== id) {
          cell.dataset.sym = id;
          cell.firstElementChild.src = artOf(id);
        }
      }
    }
    reel.strip.style.transform = `translate3d(0, ${-frac * reel.cell}px, 0)`;
  }

  /** Ставит барабаны в конкретные позиции лент без анимации. */
  function setOffsets(offsets) {
    ui.reels.forEach((reel, i) => {
      reel.pos = offsets[i] % reel.length;
      reel.base = null;
      draw(reel);
    });
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  /**
   * Крутит барабан и доводит его до позиции offset.
   *
   * Позиция УМЕНЬШАЕТСЯ: так символы едут сверху вниз, как на настоящем
   * барабане. Перелёт с возвратом в конце - тоже не украшение: барабан,
   * вставший намертво, выглядит как подмена картинки, а не как остановка.
   */
  function spinReel(reel, offset, duration, delay) {
    return new Promise((resolve) => {
      const start = performance.now() + delay;
      const L = reel.length;
      const from = reel.pos;
      const want = from - (MIN_TURNS + Math.random() * 0.4) * L;
      // Ближайшая позиция, сравнимая с offset по модулю длины, не ближе
      // MIN_TURNS оборотов.
      const to = offset - Math.ceil((offset - want) / L) * L;
      const overshoot = 0.32;

      function frame(now) {
        if (now < start) { requestAnimationFrame(frame); return; }
        const t = Math.min(1, (now - start) / duration);
        const bounce = t > 0.86 ? Math.sin(((t - 0.86) / 0.14) * Math.PI) * overshoot : 0;
        reel.pos = from + (to - from) * easeOut(t) - bounce;
        draw(reel);
        if (t < 1) { requestAnimationFrame(frame); return; }
        reel.pos = ((offset % L) + L) % L;
        reel.base = null;
        draw(reel);
        resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /* ============================================================
     ПОДСВЕТКА ЛИНИЙ
     ============================================================ */

  const LINE_COLORS = ['#ffd45e', '#5ee0ff', '#ff8ad4', '#9dff74', '#ffb3f0'];

  function clearHighlights() {
    root()?.querySelectorAll('.sl-cell.is-win, .sl-cell.is-scatter')
      .forEach((el) => el.classList.remove('is-win', 'is-scatter'));
    const svg = document.getElementById('slotLines');
    if (svg) svg.innerHTML = '';
    const tag = document.getElementById('slotLineTag');
    if (tag) tag.hidden = true;
  }

  /**
   * Ячейка окна: барабан показывает три подряд идущие позиции ленты, начиная
   * с той, на которой он встал. В разметке окно начинается с нулевой ячейки,
   * поэтому ряд и есть её номер.
   */
  function cellEl(reel, row) {
    return ui.reels[reel]?.cells[row] || null;
  }

  /** Рисует линию поверх барабанов: по центрам выигрышных клеток. */
  function drawLine(win, color) {
    const svg = document.getElementById('slotLines');
    if (!svg) return;
    const pts = win.cells.map(([reel, row]) => {
      const x = ((reel + 0.5) / ui.slot.reels) * 100;
      const y = ((row + 0.5) / ui.slot.rows) * 60;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    svg.insertAdjacentHTML('beforeend',
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="0.9"
         stroke-linecap="round" stroke-linejoin="round" class="sl-line"></polyline>`);
  }

  function lineTag(text) {
    const tag = document.getElementById('slotLineTag');
    if (!tag) return;
    tag.textContent = text;
    tag.hidden = false;
  }

  async function showWins(result) {
    clearHighlights();

    if (result.scatters >= 3) {
      for (let r = 0; r < ui.slot.reels; r++) {
        for (let row = 0; row < ui.slot.rows; row++) {
          const el = cellEl(r, row);
          if (el?.dataset.sym === 'scatter') el.classList.add('is-scatter');
        }
      }
      snd('scatter');
    }
    if (!result.wins.length) return;

    // Сначала все линии разом: игрок видит масштаб выигрыша целиком.
    result.wins.forEach((w, i) => {
      drawLine(w, LINE_COLORS[i % LINE_COLORS.length]);
      w.cells.forEach(([reel, row]) => cellEl(reel, row)?.classList.add('is-win'));
    });

    // Потом по одной, если их несколько: иначе не разобрать, что за что.
    if (result.wins.length > 1 && ui.settings.animation && !ui.settings.fast) {
      await pause(1000);
      for (const w of result.wins) {
        clearHighlights();
        drawLine(w, '#ffd45e');
        w.cells.forEach(([reel, row]) => cellEl(reel, row)?.classList.add('is-win'));
        lineTag(`Линия ${w.line + 1} - ${money(w.payout)}`);
        await pause(620);
      }
    } else if (result.wins.length === 1) {
      lineTag(`Линия ${result.wins[0].line + 1} - ${money(result.wins[0].payout)}`);
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
    if (!ui.settings.animation) { sum.textContent = money(amount); return; }

    const total = ui.settings.fast ? ms * FAST_FACTOR : ms;
    const start = performance.now();
    await new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - start) / total);
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
    await pause(ui.settings.fast ? ms * FAST_FACTOR : ms);
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
    if (x >= MEGA_WIN) return { title: 'MEGA WIN', cls: 'is-mega' };
    if (x >= BIG_WIN) return { title: 'BIG WIN', cls: 'is-big' };
    return null;
  }

  /** Окно крупного выигрыша: то самое «BIG WIN / ПРОДОЛЖИТЬ» из макета. */
  function bigWinModal(title, amount) {
    return new Promise((resolve) => {
      openModal(`
        <div class="sl-bigwin ${title === 'MEGA WIN' ? 'is-mega' : ''}">
          <div class="sl-bigwin-title">${esc(title)}</div>
          <div class="sl-bigwin-sum">${money(amount)}</div>
          <button class="sl-gold-btn" data-act="modal-close">ПРОДОЛЖИТЬ</button>
        </div>`, { onClose: resolve });
      // Окно не держит игру: через четыре секунды оно уходит само, иначе
      // автопрокрут упирается в него и стоит до нажатия.
      setTimeout(() => { if (modalOpen()) closeModal(); }, 4000);
    });
  }

  /* ============================================================
     БОНУС
     ============================================================ */

  function updateBonusBadge() {
    const badge = document.getElementById('slotBonusBadge');
    const left = document.getElementById('slotBonusLeft');
    const count = document.getElementById('slotSpinCount');
    if (!badge) return;
    badge.hidden = !ui.free;
    if (left && ui.free) left.textContent = `Осталось ${ui.free.spinsLeft}`;
    if (count) count.textContent = ui.free ? ui.free.spinsLeft : '';
    document.getElementById('slotStage')?.classList.toggle('is-bonus', Boolean(ui.free));
  }

  /** Доигрывает серию фриспинов до конца, по одному прокруту. */
  async function playFreeSeries() {
    let total = 0;
    while (ui.free && ui.free.spinsLeft > 0) {
      let res;
      try {
        res = await engine.getFreeSpinResult(ui.slot.id);
      } catch (err) {
        toast(err.message);
        break;
      }
      ui.free.spinsLeft = res.spinsLeft;
      total = res.sessionWin;
      updateBonusBadge();

      await runReels(res, { free: true });

      if (res.payout > 0) {
        snd('win');
        await countUp(res.payout, 700);
      }
      applyUser(res);
      await pause(ui.settings.fast ? 160 : 420);
    }

    ui.free = null;
    updateBonusBadge();
    ui.reels.forEach((r) => { r.expanded = false; r.base = null; draw(r); });

    if (total > 0) {
      pushHistory(0, total);
      await bigWinModal('БОНУС ЗАВЕРШЁН', total);
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

    snd('spinStart');

    // Во фриспинах wild расширяется на весь барабан. Признак ставится ДО
    // прокрутки: иначе барабан на долю секунды показал бы обычные символы.
    ui.reels.forEach((reel, i) => {
      reel.expanded = free && res.grid[i].every((s) => s === 'wild');
      reel.el.classList.toggle('is-expanded', reel.expanded);
      reel.base = null;
    });

    if (!ui.settings.animation) {
      setOffsets(res.offsets);
      await showWins(res);
      return;
    }

    const duration = ui.settings.fast ? SPIN_MS * FAST_FACTOR : SPIN_MS;
    const step = ui.settings.fast ? REEL_STEP_MS * FAST_FACTOR : REEL_STEP_MS;

    const stops = [];
    let extra = 0;
    for (let i = 0; i < ui.reels.length; i++) {
      /*
       * Сколько scatter уже показано на остановленных барабанах. Считаем по
       * сетке, которую прислал сервер: она и есть то, что встанет на экране.
       */
      if (i === ui.slot.reels - 1 && !ui.settings.fast) {
        const shown = res.grid.slice(0, i).flat().filter((s) => s === 'scatter').length;
        if (shown >= 2) {
          extra += ANTICIPATION_MS;
          ui.reels[i].el.classList.add('is-anticipating');
        }
      }
      stops.push(spinReel(ui.reels[i], res.offsets[i], duration, i * step + extra)
        .then(() => {
          ui.reels[i].el.classList.remove('is-anticipating');
          snd('reelStop');
        }));
    }
    await Promise.all(stops);
    await showWins(res);
  }

  async function spin() {
    if (ui.busy || !ui.slot) return;
    if (ui.free) { toast('Идут бесплатные вращения'); return; }

    if ((state.user?.balance ?? 0) < ui.bet) {
      ui.auto = 0;
      updateAuto();
      noFundsModal();
      return;
    }

    ui.busy = true;
    setSpinning(true);

    let res;
    try {
      res = await engine.getSpinResult(ui.slot.id, ui.bet);
    } catch (err) {
      ui.busy = false;
      ui.auto = 0;
      updateAuto();
      setSpinning(false);
      if (/INSUFFICIENT|Не хватает/.test(String(err.message))) noFundsModal();
      else toast(err.message);
      return;
    }

    ui.lastAnswer = res;
    await runReels(res);
    applyUser(res);
    pushHistory(ui.bet, res.payout);

    if (res.payout > 0) {
      const tier = winTier(res.payout, ui.bet);
      if (tier) {
        snd('bigWin');
        haptic('success');
        await countUp(res.payout, 600);
        await bigWinModal(tier.title, res.payout);
      } else {
        snd('win');
        await countUp(res.payout);
      }
    }

    if (res.jackpot) {
      snd('bigWin');
      haptic('success');
      pushHistory(0, res.jackpot.amount);
      await bigWinModal(`JACKPOT ${res.jackpot.name}`, res.jackpot.amount);
    }

    if (res.freeSpins > 0) {
      ui.auto = 0;
      updateAuto();
      ui.free = { spinsLeft: res.freeSpins, lineBet: res.lineBet };
      updateBonusBadge();
      snd('bonus');
      haptic('success');
      await freeSpinsModal(res.freeSpins);
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
        await pause(ui.settings.fast ? 120 : 380);
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
    snd('buttonClick');
    haptic('light');
  }

  /**
   * «Макс. ставка» ставит максимум, НА КОТОРЫЙ ХВАТАЕТ ДЕНЕГ, а не максимум
   * из списка. Иначе кнопка ставит заведомо недоступную ставку и следующим
   * нажатием игрок получает окно «недостаточно средств» - от кнопки, которая
   * обещала обратное.
   */
  function maxBet() {
    const balance = state.user?.balance ?? 0;
    const affordable = ui.slot.bets.filter((b) => b <= balance);
    setBet(affordable.length ? affordable[affordable.length - 1] : ui.slot.bets[0]);
    snd('buttonClick');
    haptic('medium');
  }

  const AUTO_STEPS = [10, 25, 50, 100, -1];

  function updateAuto() {
    const mark = document.getElementById('slotAutoMark');
    if (mark) mark.textContent = ui.auto === 0 ? 'ВЫКЛ' : ui.auto === -1 ? '∞' : ui.auto;
    root()?.querySelector('.sl-btn-auto')?.classList.toggle('is-on', ui.auto !== 0);
  }

  function autoModal() {
    openModal(`
      <h2 class="sl-modal-title">АВТОИГРА</h2>
      <div class="sl-auto-row">
        ${AUTO_STEPS.map((n) => `<button class="sl-chip ${ui.auto === n ? 'is-on' : ''}"
           data-act="auto-set" data-n="${n}">${n === -1 ? '∞' : n}</button>`).join('')}
      </div>
      <button class="sl-gold-btn sl-gold-btn-quiet" data-act="auto-stop">
        ${icon('stop', 'sl-ico sl-ico-sm')} ОСТАНОВИТЬ</button>
      <p class="sl-modal-note">Автопрокрут останавливается сам, когда кончились
        вращения, не хватило денег или запустился бонус.</p>`);
  }

  /* ============================================================
     ОКНА
     ============================================================ */

  let modalClose = null;

  const modalOpen = () => !document.getElementById('slotModal')?.hidden;

  function openModal(html, { onClose = null } = {}) {
    const box = document.getElementById('slotModal');
    const body = document.getElementById('slotModalBody');
    if (!box || !body) return;
    body.innerHTML = html;
    box.hidden = false;
    modalClose = onClose;
  }

  function closeModal() {
    const box = document.getElementById('slotModal');
    if (box) box.hidden = true;
    const done = modalClose;
    modalClose = null;
    if (done) done();
  }

  function menuHtml() {
    return `
      <h2 class="sl-modal-title">МЕНЮ</h2>
      <div class="sl-menu-list">
        <button class="sl-menu-item" data-act="paytable">${icon('table')}<span>Таблица выплат</span></button>
        <button class="sl-menu-item" data-act="rules">${icon('info')}<span>Правила игры</span></button>
        <button class="sl-menu-item" data-act="settings">${icon('gear')}<span>Настройки</span></button>
        <button class="sl-menu-item" data-act="history">${icon('clock')}<span>История</span></button>
        <button class="sl-menu-item" data-act="shelf">${icon('back')}<span>Другие слоты</span></button>
      </div>`;
  }

  function rulesHtml() {
    const lines = ui.slot.lines.length;
    const mult = ui.slot.freeMultiplier > 1
      ? `<li>Во время бесплатных вращений выигрыши по линиям умножаются на
           ${ui.slot.freeMultiplier}.</li>` : '';
    return `
      <h2 class="sl-modal-title">ПРАВИЛА ИГРЫ</h2>
      <ul class="sl-rules">
        <li>Пять барабанов по три символа, ${lines} линий. Линии считаются
          слева направо и обязательно от первого барабана: разрыв обрывает цепочку.</li>
        <li>${payUnitNote()}</li>
        <li><b>WILD</b> заменяет любой символ, кроме SCATTER. На первом и пятом
          барабане он не встречается.</li>
        <li><b>SCATTER</b> платит из любого места экрана. Три и больше дают
          ${ui.slot.freeSpins} бесплатных вращений.</li>
        <li>Во время бесплатных вращений WILD расширяется на весь барабан.
          Внутри бонуса новые вращения не выдаются.</li>
        ${mult}
        <li>Джекпоты разыгрываются отдельно от барабанов. Шанс пропорционален
          ставке: чем крупнее ставка, тем больше прав на приз.</li>
        <li>Отдача игры ${(ui.slot.rtp * 100).toFixed(0)}%. Покупка бонуса стоит
          ${fmt(ui.slot.buyBonusPrice)} ставок и имеет ту же отдачу, что и обычный прокрут.</li>
      </ul>`;
  }

  function settingsHtml() {
    const row = (key, name, ico) => `
      <label class="sl-switch">
        ${icon(ico)}
        <span>${name}</span>
        <input type="checkbox" data-opt="${key}" ${ui.settings[key] ? 'checked' : ''}>
      </label>`;
    return `
      <h2 class="sl-modal-title">НАСТРОЙКИ</h2>
      ${row('sound', 'Звук', 'sound')}
      ${row('music', 'Музыка', 'music')}
      ${row('animation', 'Анимация', 'spark')}
      ${row('fast', 'Быстрый прокрут', 'play')}
      <button class="sl-gold-btn sl-gold-btn-quiet" data-act="settings-reset">Сбросить</button>
      <p class="sl-modal-note">Выключенная анимация показывает результат сразу.
        На исход и на выплату это не влияет никак: результат решает сервер до
        начала вращения. Музыки в игре пока нет - выключатель сохранится и
        заработает вместе с ней.</p>`;
  }

  function buyHtml() {
    const price = ui.slot.buyBonusPrice * ui.bet;
    return `
      <h2 class="sl-modal-title">КУПИТЬ БОНУС</h2>
      <div class="sl-buy-art" style="background-image:url('${ui.slot.art.bonus}')">
        <span>БОНУСНЫЙ РАУНД</span>
      </div>
      <p class="sl-modal-lead">${ui.slot.freeSpins} бесплатных вращений с
        расширяющимися WILD при ставке ${money(ui.bet)}.</p>
      <div class="sl-buy-price">${money(price)}</div>
      <p class="sl-modal-note">Цена посчитана из матожидания бонуса: покупка
        имеет ту же отдачу, что и обычный прокрут. Дешевле обычной игры бонус
        не бывает, и дороже тоже.</p>
      <button class="sl-gold-btn" data-act="buy-go">КУПИТЬ</button>
      <button class="sl-gold-btn sl-gold-btn-quiet" data-act="modal-close">ОТМЕНА</button>`;
  }

  function betPickHtml() {
    const balance = state.user?.balance ?? 0;
    return `
      <h2 class="sl-modal-title">ВЫБЕРИТЕ СТАВКУ</h2>
      <div class="sl-bet-grid">
        ${ui.slot.bets.map((b) => `<button class="sl-chip ${b === ui.bet ? 'is-on' : ''}
          ${b > balance ? 'is-off' : ''}" data-act="bet-set" data-n="${b}">${fmt(b)}</button>`).join('')}
      </div>
      <p class="sl-modal-note">Ставка делится между ${ui.slot.lines.length} линиями.
        Серым отмечены ставки, на которые не хватает баланса.</p>`;
  }

  function noFundsModal() {
    haptic('error');
    openModal(`
      <div class="sl-alert">
        ${icon('alert', 'sl-ico sl-ico-alert')}
        <h2 class="sl-modal-title">НЕДОСТАТОЧНО СРЕДСТВ</h2>
        <p class="sl-modal-lead">Для этой ставки требуется ${money(ui.bet)}.<br>
          Пожалуйста, уменьшите ставку.</p>
        <button class="sl-gold-btn" data-act="modal-close">OK</button>
        <button class="sl-gold-btn sl-gold-btn-quiet" data-act="cashier">ПОПОЛНИТЬ</button>
      </div>`);
  }

  function freeSpinsModal(count) {
    return new Promise((resolve) => {
      openModal(`
        <div class="sl-free" style="background-image:url('${ui.slot.art.bonus}')">
          <h2 class="sl-modal-title">БЕСПЛАТНЫЕ ВРАЩЕНИЯ</h2>
          <div class="sl-free-count">${count}</div>
          <div class="sl-free-sub">БЕСПЛАТНЫХ ВРАЩЕНИЙ</div>
          <p class="sl-free-note">Собрано 3 или более символов SCATTER</p>
          <button class="sl-gold-btn" data-act="modal-close">НАЧАТЬ</button>
        </div>`, { onClose: resolve });
      setTimeout(() => { if (modalOpen()) closeModal(); }, 5000);
    });
  }

  async function buyBonus() {
    if (ui.busy || ui.free) return;
    const price = ui.slot.buyBonusPrice * ui.bet;
    if ((state.user?.balance ?? 0) < price) { closeModal(); noFundsModal(); return; }

    ui.busy = true;
    let res;
    try {
      res = await engine.buyBonus(ui.slot.id, ui.bet);
    } catch (err) {
      ui.busy = false;
      if (/INSUFFICIENT|Не хватает/.test(String(err.message))) { closeModal(); noFundsModal(); }
      else toast(err.message);
      return;
    }
    closeModal();
    applyUser(res);
    pushHistory(res.price, 0);
    ui.free = { spinsLeft: res.spinsLeft, lineBet: res.lineBet };
    updateBonusBadge();
    snd('bonus');
    await freeSpinsModal(res.spinsLeft);
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
      if (e.target.id === 'slotModal') { closeModal(); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'bet-down') stepBet(-1);
      else if (act === 'bet-up') stepBet(1);
      else if (act === 'bet-pick') openModal(betPickHtml());
      else if (act === 'bet-set') { setBet(Number(btn.dataset.n)); closeModal(); }
      else if (act === 'max') maxBet();
      else if (act === 'auto') autoModal();
      else if (act === 'auto-set') {
        ui.auto = Number(btn.dataset.n);
        updateAuto();
        closeModal();
        if (!ui.busy) spin();
      } else if (act === 'auto-stop') { ui.auto = 0; updateAuto(); closeModal(); }
      else if (act === 'buy') openModal(buyHtml());
      else if (act === 'buy-go') buyBonus();
      else if (act === 'menu') openModal(menuHtml());
      else if (act === 'rules') openModal(rulesHtml());
      else if (act === 'paytable') openModal(`<h2 class="sl-modal-title">ТАБЛИЦА ВЫПЛАТ</h2>${paytableHtml()}`);
      else if (act === 'history') openModal(`<h2 class="sl-modal-title">ИСТОРИЯ</h2>
        <div class="sl-history-list">${historyHtml()}</div>`);
      else if (act === 'settings') openModal(settingsHtml());
      else if (act === 'settings-reset') {
        ui.settings = { ...DEFAULT_SETTINGS };
        saveSettings(ui.settings);
        syncSound();
        openModal(settingsHtml());
      } else if (act === 'modal-close') closeModal();
      else if (act === 'sound') toggleSound();
      else if (act === 'full') toggleFull();
      else if (act === 'cashier') { closeModal(); deps.onCashier?.(); }
      else if (act === 'shelf') { closeModal(); close(); openShelf(); }
    });

    box.addEventListener('change', (e) => {
      const opt = e.target.dataset?.opt;
      if (!opt) return;
      ui.settings[opt] = e.target.checked;
      saveSettings(ui.settings);
      syncSound();
    });

    document.getElementById('slotSpin')?.addEventListener('click', () => {
      snd('buttonClick');
      haptic('medium');
      if (ui.auto !== 0) { ui.auto = 0; updateAuto(); return; }
      spin();
    });

    // Пересчёт высоты ячейки: на повороте телефона и в полноэкранном режиме
    // она меняется, и без этого лента встала бы между символами.
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (root()?.offsetParent) layoutReels(); }, 180);
  }

  function toggleSound() {
    ui.settings.sound = !ui.settings.sound;
    saveSettings(ui.settings);
    syncSound();
    haptic('light');
  }

  function syncSound() {
    const btn = document.getElementById('slotSound');
    if (btn) btn.innerHTML = icon(ui.settings.sound ? 'sound' : 'mute');
  }

  /**
   * Полный экран через Fullscreen API, с откатом на собственный класс.
   *
   * Во встроенном браузере Telegram запрос на полный экран часто отклоняется
   * без объяснений, и кнопка, которая ничего не делает, хуже её отсутствия.
   * Поэтому при отказе игра разворачивается своими силами.
   */
  function toggleFull() {
    const stage = document.getElementById('slotStage');
    if (!stage) return;
    const done = () => setTimeout(layoutReels, 80);

    if (document.fullscreenElement) {
      document.exitFullscreen?.().then(done).catch(done);
      return;
    }
    const req = stage.requestFullscreen?.bind(stage);
    if (req) {
      req().then(done).catch(() => { stage.classList.toggle('is-full'); done(); });
    } else {
      stage.classList.toggle('is-full');
      done();
    }
  }

  /* ============================================================
     ВХОД
     ============================================================ */

  async function open(slotId) {
    let data;
    try {
      data = await engine.describe(slotId);
    } catch (err) {
      toast(err.message);
      return;
    }

    ui.slot = data.slot;
    ui.history = [];
    ui.spinNo = 0;
    ui.auto = 0;
    ui.bet = ui.slot.bets.includes(100) ? 100 : ui.slot.bets[0];
    ui.free = data.session
      ? { spinsLeft: data.session.spinsLeft, lineBet: data.session.lineBet }
      : null;

    const shelf = shelfBox();
    if (shelf) shelf.hidden = true;
    const game = root();
    if (game) game.hidden = false;

    render();
    // Начальная картинка берётся с лент, а не из случайных символов: иначе
    // первый же прокрут менял бы экран рывком.
    setOffsets(ui.slot.strips.map((s) => Math.floor(Math.random() * s.length)));

    if (ui.free) {
      updateBonusBadge();
      await freeSpinsModal(ui.free.spinsLeft);
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

  return { openShelf, open, close, refreshBalance };
}
