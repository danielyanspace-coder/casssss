/**
 * Мини-игры: витрина, экран игры и шестнадцать способов показать исход.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: КАРТИНКА НЕ ПРИДУМЫВАЕТ ШАНСЫ.
 *
 * Исход решает сервер и присылает индекс выигрышного исхода. Здесь он
 * раскрывается, и раскрытие обязано соответствовать настоящим вероятностям:
 *
 *   - у колеса угол сектора равен его вероятности, а не «поровну на всех».
 *     Сектор с шансом два процента это тонкая полоска, а не шестая часть
 *     круга. Колесо с равными секторами и разными шансами врёт картинкой;
 *   - у плинко ширина лунки равна её вероятности;
 *   - во «взлёте» точка обрыва берётся из настоящего распределения краша:
 *     P(дожить до x) = отдача / x. Поэтому мгновенный обрыв случается ровно в
 *     тридцати процентах случаев, а не тогда, когда красивее;
 *   - в цепочках (накачка, подъём, раскопки, мины, выше-ниже) место срыва
 *     берётся из условного распределения: сорваться на первом шаге
 *     вероятнее, чем на последнем, и на экране это так и выглядит;
 *   - у костей грань обязана удовлетворять условию варианта. Список
 *     выигрышных граней приходит с сервера, клиент его не выдумывает.
 *
 * ВТОРОЕ ПРАВИЛО: СЕМЕЙСТВО ЭТО ДВИЖЕНИЕ. Шестнадцать отрисовщиков, и у
 * каждого своё: множитель бежит вверх и обрывается, шар надувается рывками и
 * лопается, фигурка идёт по этажам, ленты тормозят по очереди, тираж
 * выпадает по одному числу, бегуны едут наперегонки. Если два отрисовщика
 * начинают выглядеть одинаково, значит одна из механик лишняя.
 *
 * Модуль не импортирует app.js: всё, что нужно, передаётся в createMini.
 * Иначе получился бы круг импортов, и оба файла перестали бы грузиться.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const pickOf = (arr) => arr[rnd(arr.length)];

/** Отдача мини-игр. Нужна для распределения точки обрыва во «взлёте». */
const RTP = 0.70;

/* ============================================================
   ЧЕСТНАЯ РАСКЛАДКА
   ============================================================ */

/**
 * Разбивает круг (или полосу) на доли по настоящим вероятностям.
 *
 * Проигрыш дробится на несколько долей: одна сплошная тёмная половина круга
 * выглядит как поломка, а не как «мимо». На вероятность это не влияет,
 * сумма долей проигрыша остаётся прежней.
 */
function shares(option, loseParts = 4) {
  const out = option.wins.map((w, i) => ({
    p: w.probability, multiplier: w.multiplier, outcomeIndex: i, win: true,
  }));
  const lose = Math.max(0, 1 - out.reduce((s, x) => s + x.p, 0));
  for (let i = 0; i < loseParts; i++) {
    out.push({ p: lose / loseParts, multiplier: 0, outcomeIndex: -1, win: false });
  }
  // Порядок фиксированный, а не случайный: сектор должен стоять на одном
  // месте между прокрутами, иначе игрок не запомнит колесо.
  out.sort((a, b) => ((a.multiplier * 7919 + 13) % 11) - ((b.multiplier * 7919 + 13) % 11));
  return out;
}

/** Индекс доли, отвечающей нужному исходу. */
function shareFor(list, outcomeIndex) {
  const hits = list.map((s, i) => ({ s, i })).filter((x) => x.s.outcomeIndex === outcomeIndex);
  return hits.length ? pickOf(hits).i : 0;
}

/**
 * На каком шаге сорвалось, если известно, что сорвалось.
 *
 * Шанс дойти до конца известен, шагов n, значит шанс пережить один шаг равен
 * корню n-й степени. Отсюда условное распределение места срыва. Без этого
 * срыв рисовался бы равномерно, и «дошёл до предпоследней ступени»
 * случалось бы так же часто, как «упал на первой», чего не бывает.
 */
function failStep(steps, winChance) {
  const survive = Math.pow(Math.max(winChance, 1e-9), 1 / steps);
  const weights = [];
  for (let k = 1; k <= steps; k++) weights.push(Math.pow(survive, k - 1) * (1 - survive));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let roll = Math.random() * total;
  for (let k = 0; k < steps; k++) {
    roll -= weights[k];
    if (roll <= 0) return k;
  }
  return steps - 1;
}

/**
 * Точка обрыва во «взлёте», если до цели не долетели.
 *
 * Распределение то же, что у краша в основной игре: дожить до x можно с
 * вероятностью rtp/x. Условно на «не долетел до цели» это даёт
 *     u ~ U(0, 1 - rtp/цель),  x = rtp / (1 - u),
 * а при u ниже 1-rtp выходит мгновенный обрыв на единице. Именно поэтому
 * примерно каждый третий взлёт заканчивается, не начавшись, и это честно:
 * так устроена сама игра, а не анимация.
 */
function crashBelow(target) {
  const cap = 1 - RTP / target;
  const u = Math.random() * cap;
  if (u <= 1 - RTP) return 1;
  return RTP / (1 - u);
}

/* ============================================================
   МОДУЛЬ
   ============================================================ */

export function createMini(deps) {
  const { api, esc, fmt, money, toast, haptic, state, sounds = {} } = deps;
  const snd = (name) => { try { sounds[name]?.(); } catch { /* звук не обязателен */ } };

  const ui = { family: 'all', game: null, option: 0, bet: 100, busy: false };

  const games = () => state.config?.minigames?.games || [];
  const families = () => state.config?.minigames?.families || [];

  const skin = (hue) => `--mg-h:${hue}`;

  function artSvg(art, cls = 'mg-art') {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="${art.path}"></path></svg>`;
  }

  /* ---------- Витрина ---------- */

  function renderShelf() {
    const box = document.getElementById('miniShelf');
    if (!box) return;

    const list = ui.family === 'all'
      ? games()
      : games().filter((g) => g.family === ui.family);

    document.getElementById('miniFamilies').innerHTML =
      [{ id: 'all', name: 'Все' }, ...families()]
        .map((f) => `<button class="tab ${f.id === ui.family ? 'active' : ''}"
          data-mini-family="${f.id}">${esc(f.name)}</button>`).join('');

    const motion = new Map(families().map((f) => [f.id, f.motion]));

    box.innerHTML = list.map((g) => `
      <button class="mg-card" style="${skin(g.hue)}" data-mini-game="${g.id}">
        <span class="mg-card-art">${artSvg(g.art)}</span>
        <span class="mg-card-name">${esc(g.name)}</span>
        <span class="mg-card-sub">${esc(g.tagline)}</span>
        <span class="mg-card-foot">
          <i>${esc(motion.get(g.family) || '')}</i>
          <b>до ×${g.top}</b>
        </span>
      </button>`).join('');

    box.querySelectorAll('[data-mini-game]').forEach((b) => {
      b.onclick = () => openGame(b.dataset.miniGame);
    });
    document.querySelectorAll('[data-mini-family]').forEach((b) => {
      b.onclick = () => { ui.family = b.dataset.miniFamily; renderShelf(); };
    });
  }

  /* ---------- Экран игры ---------- */

  function openGame(id) {
    const game = games().find((g) => g.id === id);
    if (!game) return;
    ui.game = game;
    ui.option = 0;
    ui.bet = Math.max(game.minBet, Math.min(game.maxBet, ui.bet || game.minBet));
    document.getElementById('miniShelfWrap').hidden = true;
    const screen = document.getElementById('miniGame');
    screen.hidden = false;
    renderGame();
    screen.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function closeGame() {
    ui.game = null;
    const screen = document.getElementById('miniGame');
    if (screen) screen.hidden = true;
    const wrap = document.getElementById('miniShelfWrap');
    if (wrap) wrap.hidden = false;
  }

  function renderGame() {
    const g = ui.game;
    const option = g.options[ui.option];
    const screen = document.getElementById('miniGame');
    screen.setAttribute('style', skin(g.hue));

    const familyName = families().find((f) => f.id === g.family)?.motion || '';

    screen.innerHTML = `
      <div class="mg-head">
        <button class="btn btn-outline btn-sm" id="mgBack">Назад</button>
        <div class="mg-head-main">
          <div class="mg-title">${esc(g.name)}</div>
          <div class="mg-sub">${esc(familyName)}</div>
        </div>
        <span class="mg-head-art">${artSvg(g.art, 'mg-art mg-art-lg')}</span>
      </div>

      <div class="mg-stage" id="mgStage"></div>

      <div class="mg-result" id="mgResult" hidden></div>

      ${g.options.length > 1 ? `
      <div class="mg-options" id="mgOptions">
        ${g.options.map((o, i) => `
          <button class="mg-option ${i === ui.option ? 'active' : ''}" data-mini-option="${i}">
            <b>${esc(o.label)}</b>
            <i>${esc(o.hint)}</i>
            <span>шанс ${(o.winChance * 100).toFixed(1)}% · до ×${o.top}</span>
          </button>`).join('')}
      </div>` : ''}

      <div class="mg-bet">
        <div class="mg-bet-row">
          <button class="btn btn-sm btn-outline" data-mini-bet="half">÷2</button>
          <input class="seed-input" id="mgBet" type="number" inputmode="numeric"
                 value="${ui.bet}" min="${g.minBet}" max="${g.maxBet}">
          <button class="btn btn-sm btn-outline" data-mini-bet="double">×2</button>
          <button class="btn btn-sm btn-outline" data-mini-bet="max">Макс</button>
        </div>
        <div class="mg-bet-hint">Ставка от ${fmt(g.minBet)} до ${fmt(g.maxBet)}</div>
      </div>

      <button class="btn btn-primary btn-wide" id="mgPlay">${
        g.family === 'pick' ? 'Выберите ячейку' : PLAY_LABEL[g.family] || 'Играть'}</button>

      <details class="mg-rules">
        <summary>Шансы и выплаты</summary>
        <table class="admin-table">
          <thead><tr><th>Исход</th><th class="num">Шанс</th></tr></thead>
          <tbody>
            ${option.wins.map((w) => `<tr>
              <td>×${w.multiplier}</td>
              <td class="num">${(w.probability * 100).toFixed(w.probability < 0.001 ? 4 : 2)}%</td>
            </tr>`).join('')}
            <tr><td>мимо</td><td class="num">${((1 - option.winChance) * 100).toFixed(2)}%</td></tr>
          </tbody>
        </table>
        <p class="mg-rules-note">Отдача игры ${(g.rtp * 100).toFixed(0)}%. Исход решает
          сервер и проверяется через «Честность игры»: движение на экране лишь
          показывает уже решённый результат.</p>
      </details>
    `;

    document.getElementById('mgBack').onclick = closeGame;
    screen.querySelectorAll('[data-mini-option]').forEach((b) => {
      b.onclick = () => { ui.option = Number(b.dataset.miniOption); renderGame(); };
    });
    screen.querySelectorAll('[data-mini-bet]').forEach((b) => {
      b.onclick = () => {
        const input = document.getElementById('mgBet');
        const cur = Number(input.value) || g.minBet;
        const next = b.dataset.miniBet === 'half' ? Math.floor(cur / 2)
                   : b.dataset.miniBet === 'double' ? cur * 2
                   : Math.min(g.maxBet, state.user?.balance || g.maxBet);
        input.value = Math.max(g.minBet, Math.min(g.maxBet, next));
        ui.bet = Number(input.value);
      };
    });
    document.getElementById('mgBet').oninput = (e) => { ui.bet = Number(e.target.value) || 0; };

    const play = document.getElementById('mgPlay');
    if (g.family === 'pick') play.disabled = true;
    play.onclick = () => run();

    IDLE[g.family](document.getElementById('mgStage'), g, option);
  }

  /** Подпись на кнопке: она тоже часть механики. */
  const PLAY_LABEL = {
    rise: 'Взлетаем', pump: 'Качать', climb: 'Подниматься', mines: 'Идти по полю',
    drop: 'Бросить шар', wheel: 'Крутить', reels: 'Крутить', keno: 'Тираж',
    race: 'Старт', hilo: 'Раздать', limbo: 'Запустить', scratch: 'Стереть',
    shot: 'Бить', dice: 'Бросить', dig: 'Копать',
  };

  /* ---------- Розыгрыш ---------- */

  async function run(picked = 0) {
    if (ui.busy) return;
    const g = ui.game;
    const bet = Math.trunc(Number(document.getElementById('mgBet').value) || 0);
    if (bet < g.minBet || bet > g.maxBet) {
      toast(`Ставка от ${fmt(g.minBet)} до ${fmt(g.maxBet)}`);
      return;
    }

    ui.busy = true;
    ui.bet = bet;
    const play = document.getElementById('mgPlay');
    play.disabled = true;
    document.getElementById('mgResult').hidden = true;

    let data;
    try {
      data = await api('/api/mini/play', { gameId: g.id, option: ui.option, bet, picked });
    } catch (err) {
      toast(err.message);
      haptic('error');
      ui.busy = false;
      play.disabled = g.family === 'pick';
      return;
    }

    if (data.user) deps.onUser?.(data.user);
    snd('bet');

    const stage = document.getElementById('mgStage');
    const option = g.options[ui.option];
    await PLAY[g.family](stage, g, option, { ...data, picked }, { snd, haptic });

    const box = document.getElementById('mgResult');
    box.hidden = false;
    box.className = `mg-result ${data.win ? 'win' : 'lose'}`;
    box.innerHTML = data.win
      ? `<b>×${data.multiplier}</b><span>${money(data.payout)}</span>`
      : `<b>Мимо</b><span>Ставка ${money(bet)}</span>`;

    if (data.win) { snd(data.multiplier >= 10 ? 'bigWin' : 'reveal'); haptic('success'); }
    else { snd('lose'); haptic('light'); }

    deps.onRound?.(data);

    ui.busy = false;
    play.disabled = g.family === 'pick';
  }

  /* ============================================================
     ШЕСТНАДЦАТЬ МЕХАНИК
     ============================================================
     IDLE рисует покой, PLAY возвращает обещание и двигает.
     Разделены намеренно: у каждой механики своя длительность, и общий
     таймер на всех заставлял бы кости лежать лишние две секунды, а колесо
     наоборот обрывал бы на полпути.
     ============================================================ */

  const IDLE = {};
  const PLAY = {};

  /* ---------- Взлёт: множитель бежит вверх и обрывается ---------- */

  IDLE.rise = (stage, g, option) => {
    stage.innerHTML = `
      <div class="mg-rise">
        <svg class="mg-rise-svg" viewBox="0 0 100 60" preserveAspectRatio="none">
          <path class="mg-rise-fill" id="mgRiseFill" d="M0 60 L0 60 Z"></path>
          <path class="mg-rise-line" id="mgRiseLine" d="M0 60"></path>
        </svg>
        <div class="mg-rise-craft" id="mgRiseCraft">${CRAFT[option.view.curve] || '✈'}</div>
        <div class="mg-rise-num" id="mgRiseNum">1.00<i>×</i></div>
        <div class="mg-rise-goal">цель ×${option.view.peak}</div>
      </div>`;
  };

  const CRAFT = { plane: '✈', rocket: '▲', chart: '●' };

  PLAY.rise = (stage, g, option, result, fx) => new Promise((resolve) => {
    IDLE.rise(stage, g, option);
    const target = option.view.peak;
    const stop = result.win ? target : crashBelow(target);

    const num = stage.querySelector('#mgRiseNum');
    const line = stage.querySelector('#mgRiseLine');
    const fill = stage.querySelector('#mgRiseFill');
    const craft = stage.querySelector('#mgRiseCraft');
    const wrap = stage.querySelector('.mg-rise');

    // Мгновенный обрыв: рисовать полёт нечего, и затягивать его нечестно.
    if (stop <= 1.001) {
      wrap.classList.add('boom');
      num.textContent = '1.00';
      fx.snd('crash');
      setTimeout(resolve, 900);
      return;
    }

    const DURATION = 900 + Math.min(2400, Math.log(stop) * 1300);
    const started = performance.now();
    const pts = [];

    function frame(now) {
      const t = Math.min(1, (now - started) / DURATION);
      const value = 1 + (stop - 1) * t * t;   // ускоряется, как и положено
      num.firstChild.nodeValue = value.toFixed(2);

      const x = t * 100;
      const y = 60 - Math.min(58, (Math.log(value) / Math.log(Math.max(stop, 1.02))) * 54);
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
      line.setAttribute('d', `M0 60 L${pts.join(' L')}`);
      fill.setAttribute('d', `M0 60 L${pts.join(' L')} L${x.toFixed(1)} 60 Z`);
      craft.style.left = `${x}%`;
      craft.style.top = `${(y / 60) * 100}%`;

      if (t < 1) { requestAnimationFrame(frame); return; }

      if (result.win) {
        wrap.classList.add('cashed');
        fx.snd('collect');
      } else {
        wrap.classList.add('boom');
        fx.snd('crash');
        fx.haptic('error');
      }
      setTimeout(resolve, 700);
    }
    requestAnimationFrame(frame);
  });

  /* ---------- Накачка: шар надувается рывками и лопается ---------- */

  IDLE.pump = (stage, g, option) => {
    stage.innerHTML = `
      <div class="mg-pump" data-shape="${option.view.shape}">
        <div class="mg-pump-body" id="mgPumpBody"><span id="mgPumpNum">×1.00</span></div>
        <div class="mg-pump-scale">${Array.from({ length: option.view.pumps },
          (_, i) => `<i data-p="${i}"></i>`).join('')}</div>
      </div>`;
  };

  PLAY.pump = async (stage, g, option, result, fx) => {
    IDLE.pump(stage, g, option);
    const n = option.view.pumps;
    const stop = result.win ? n : failStep(n, option.winChance);
    const body = stage.querySelector('#mgPumpBody');
    const num = stage.querySelector('#mgPumpNum');
    const step = Math.pow(option.top, 1 / n);

    for (let i = 0; i < (result.win ? n : stop); i++) {
      body.style.transform = `scale(${1 + (i + 1) * (0.9 / n)})`;
      body.classList.add('kick');
      num.textContent = '×' + Math.pow(step, i + 1).toFixed(2);
      fx.snd('tick');
      await wait(190);
      body.classList.remove('kick');
      await wait(40);
    }

    if (result.win) {
      body.classList.add('held');
      fx.snd('collect');
      await wait(600);
    } else {
      body.style.transform = `scale(${1 + (stop + 1) * (0.9 / n) + 0.25})`;
      await wait(120);
      body.classList.add('pop');
      fx.snd('crash');
      fx.haptic('error');
      await wait(650);
    }
  };

  /* ---------- Подъём: фигурка идёт вверх по этажам ---------- */

  IDLE.climb = (stage, g, option) => {
    const n = option.view.steps;
    const step = Math.pow(option.top, 1 / n);
    stage.innerHTML = `
      <div class="mg-climb" data-style="${option.view.style}">
        ${Array.from({ length: n }, (_, i) => {
          const level = n - 1 - i;
          return `<div class="mg-floor" data-f="${level}">
            <span class="mg-floor-n">${level + 1}</span>
            <span class="mg-floor-x">×${Math.pow(step, level + 1).toFixed(2)}</span>
          </div>`;
        }).join('')}
        <div class="mg-climb-hero" id="mgHero"></div>
      </div>`;
  };

  PLAY.climb = async (stage, g, option, result, fx) => {
    IDLE.climb(stage, g, option);
    const n = option.view.steps;
    const stop = result.win ? n : failStep(n, option.winChance);
    const hero = stage.querySelector('#mgHero');
    const floors = [...stage.querySelectorAll('.mg-floor')];

    for (let i = 0; i < (result.win ? n : stop + 1); i++) {
      const floor = floors.find((f) => Number(f.dataset.f) === i);
      hero.style.bottom = `calc(${i} * var(--floor-h) + 6px)`;
      hero.classList.add('hop');
      fx.snd('tick');
      await wait(200);
      hero.classList.remove('hop');

      const failedHere = !result.win && i === stop;
      floor?.classList.add(failedHere ? 'broken' : 'done');
      if (failedHere) {
        hero.classList.add('fall');
        fx.snd('lose');
        fx.haptic('error');
        await wait(650);
        return;
      }
      await wait(90);
    }
    hero.classList.add('top');
    fx.snd('collect');
    await wait(520);
  };

  /* ---------- Мины: клетки вскрываются по одной ---------- */

  IDLE.mines = (stage, g, option) => {
    const { size, picks, traps } = option.view;
    const cols = Math.round(Math.sqrt(size));
    stage.innerHTML = `
      <div class="mg-grid mg-mines" style="--cols:${cols}">
        ${Array.from({ length: size }, (_, i) =>
          `<div class="mg-cell" data-i="${i}"><span></span></div>`).join('')}
      </div>
      <div class="mg-note">Откроем ${picks} из ${size}, ловушек ${traps}</div>`;
  };

  const TRAP_MARK = { mine: '✸', ice: '≋', mushroom: '☠', spike: '▲' };

  PLAY.mines = async (stage, g, option, result, fx) => {
    IDLE.mines(stage, g, option);
    const { size, picks, trap } = option.view;
    const stop = result.win ? picks : failStep(picks, option.winChance);

    // Порядок клеток - показ, а не розыгрыш: на исход влияет только сколько
    // их решено открыть, а не какие именно.
    const order = Array.from({ length: size }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, picks);
    const cells = [...stage.querySelectorAll('.mg-cell')];
    const note = stage.querySelector('.mg-note');

    for (let k = 0; k < (result.win ? picks : stop + 1); k++) {
      const cell = cells[order[k]];
      const bad = !result.win && k === stop;
      cell.classList.add('open', bad ? 'trap' : 'hit');
      cell.firstElementChild.textContent = bad ? (TRAP_MARK[trap] || '✕') : '✓';
      fx.snd(bad ? 'lose' : 'tick');
      if (bad) {
        note.textContent = `Ловушка на ${k + 1}-й клетке`;
        fx.haptic('error');
        await wait(700);
        return;
      }
      note.textContent = `Открыто ${k + 1} из ${picks}`;
      await wait(180);
    }
    note.textContent = 'Прошли поле целиком';
    fx.snd('collect');
    await wait(450);
  };

  /* ---------- Падение: шар прыгает по штырям ---------- */

  IDLE.drop = (stage, g, option) => {
    const rows = option.view.rows;
    const list = shares(option, Math.max(2, Math.round((option.view.slots || 9) / 3)));
    let acc = 0;
    stage.dataset.slots = JSON.stringify(list.map((s) => {
      const from = acc; acc += s.p;
      return { p: s.p, mid: (from + acc) / 2, win: s.win,
               multiplier: s.multiplier, outcomeIndex: s.outcomeIndex };
    }));
    const slots = JSON.parse(stage.dataset.slots);

    stage.innerHTML = `
      <div class="mg-drop">
        <div class="mg-pegs" id="mgPegs">${Array.from({ length: rows }, (_, r) =>
          `<div class="mg-peg-row">${Array.from({ length: r + 2 }, () => '<i></i>').join('')}</div>`
        ).join('')}</div>
        <div class="mg-ball" id="mgBall"></div>
        <div class="mg-slots">${slots.map((s, i) =>
          `<div class="mg-slot ${s.win ? 'win' : ''}" data-s="${i}"
                style="flex-grow:${Math.max(s.p, 0.012)}">${s.win ? '×' + s.multiplier : '-'}</div>`
        ).join('')}</div>
      </div>`;
    stage.dataset.slots = JSON.stringify(slots);
  };

  PLAY.drop = async (stage, g, option, result, fx) => {
    IDLE.drop(stage, g, option);
    const slots = JSON.parse(stage.dataset.slots);
    const idx = shareFor(slots.map((s) => ({ outcomeIndex: s.outcomeIndex })), result.outcomeIndex);
    const targetX = slots[idx].mid * 100;

    const pegs = stage.querySelector('#mgPegs');
    const ball = stage.querySelector('#mgBall');
    const rows = option.view.rows;
    const height = pegs.getBoundingClientRect().height || 180;

    ball.style.opacity = '1';
    let x = 50;
    // Шар именно ПРЫГАЕТ по рядам, а не съезжает: путь строится так, чтобы
    // прийти в нужную лунку, но каждый ряд отклоняет его вбок, как штырь.
    for (let r = 0; r <= rows; r++) {
      const t = (r + 1) / (rows + 1);
      const drift = (Math.random() - 0.5) * 16 * (1 - t);
      x = x + (targetX - x) * t + drift;
      ball.style.transition = 'top 130ms cubic-bezier(0.45,0,1,1), left 130ms ease-out';
      ball.style.top = `${(height * t).toFixed(1)}px`;
      ball.style.left = `${Math.max(3, Math.min(97, x)).toFixed(1)}%`;
      if (r % 2 === 0) fx.snd('tick');
      await wait(125);
    }
    ball.style.left = `${targetX.toFixed(1)}%`;
    stage.querySelector(`[data-s="${idx}"]`)?.classList.add('landed');
    fx.snd(result.win ? 'reveal' : 'lose');
    await wait(500);
  };

  /* ---------- Колесо: угол сектора равен вероятности ---------- */

  IDLE.wheel = (stage, g, option) => {
    const list = shares(option, Math.max(3, Math.round((option.view.sectors || 8) / 3)));
    let angle = 0;
    const arcs = list.map((s) => {
      const from = angle; angle += s.p * 360;
      return { ...s, from, to: angle, mid: (from + angle) / 2 };
    });
    stage.dataset.arcs = JSON.stringify(arcs);

    const R = 46;
    const arcPath = (a) => {
      const rad = (d) => ((d - 90) * Math.PI) / 180;
      const x1 = 50 + R * Math.cos(rad(a.from)), y1 = 50 + R * Math.sin(rad(a.from));
      const x2 = 50 + R * Math.cos(rad(a.to)), y2 = 50 + R * Math.sin(rad(a.to));
      return `M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
             `A ${R} ${R} 0 ${a.to - a.from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    };

    stage.innerHTML = `
      <div class="mg-wheel">
        <svg viewBox="0 0 100 100" class="mg-wheel-svg" id="mgWheelSvg">
          ${arcs.map((a, i) => `<path d="${arcPath(a)}" class="mg-sector ${a.win ? 'win' : ''}"
            style="--i:${i}"></path>`).join('')}
          <circle cx="50" cy="50" r="12" class="mg-wheel-hub"></circle>
        </svg>
        <div class="mg-wheel-pin"></div>
      </div>
      <div class="mg-legend">${arcs.filter((a) => a.win)
        .map((a) => `<span>×${a.multiplier} · ${(a.p * 100).toFixed(a.p < 0.001 ? 3 : 1)}%</span>`)
        .join('')}</div>`;
  };

  PLAY.wheel = (stage, g, option, result, fx) => new Promise((resolve) => {
    IDLE.wheel(stage, g, option);
    const arcs = JSON.parse(stage.dataset.arcs);
    const idx = shareFor(arcs, result.outcomeIndex);
    const deg = 360 * 6 - arcs[idx].mid;
    const svg = stage.querySelector('#mgWheelSvg');
    svg.style.transition = 'transform 3.2s cubic-bezier(0.12, 0.72, 0.12, 1)';
    requestAnimationFrame(() => { svg.style.transform = `rotate(${deg}deg)`; });
    const ticks = setInterval(() => fx.snd('tick'), 260);
    setTimeout(() => { clearInterval(ticks); resolve(); }, 3400);
  });

  /* ---------- Барабаны: ленты тормозят по очереди ---------- */

  const SYMBOLS = ['◆', '★', '●', '▲', '■', '♠', '♥', '⬢'];

  IDLE.reels = (stage, g, option) => {
    const count = option.view.reels;
    const pool = SYMBOLS.slice(0, option.view.symbols);
    stage.innerHTML = `<div class="mg-reels">${Array.from({ length: count }, (_, i) =>
      `<div class="mg-reel"><div class="mg-strip" data-r="${i}">${
        Array.from({ length: 18 }, () => `<span>${pickOf(pool)}</span>`).join('')
      }</div></div>`).join('')}</div>`;
  };

  PLAY.reels = async (stage, g, option, result, fx) => {
    const count = option.view.reels;
    const pool = SYMBOLS.slice(0, option.view.symbols);

    // Сколько полос совпадает: чем крупнее множитель, тем больше. Иначе
    // картинка спорит с суммой - три одинаковых и выплата в полторы ставки.
    let faces;
    if (result.win) {
      const rank = (result.outcomeIndex + 1) / option.wins.length;
      const same = rank > 0.65 ? count : Math.max(2, count - 1);
      const hero = pickOf(pool);
      faces = Array.from({ length: count }, (_, i) => (i < same ? hero : pickOf(pool)));
    } else {
      do { faces = Array.from({ length: count }, () => pickOf(pool)); }
      while (pool.length >= count && new Set(faces).size < count);
    }

    // Лента длинная и заканчивается нужным символом: остановка это торможение
    // ленты, а не подмена картинки в окне.
    stage.innerHTML = `<div class="mg-reels">${faces.map((f, i) =>
      `<div class="mg-reel"><div class="mg-strip" data-r="${i}">${
        Array.from({ length: 24 }, () => `<span>${pickOf(pool)}</span>`).join('')
      }<span class="mg-final">${f}</span></div></div>`).join('')}</div>`;

    const strips = [...stage.querySelectorAll('.mg-strip')];
    /*
     * Высота ячейки снимается с разметки, а не зашита числом. На компьютере
     * ячейка крупнее, и зашитое число остановило бы ленту между символами -
     * ровно та же ошибка, на которой уже ломался барабан кейсов.
     */
    const cell = strips[0]?.firstElementChild?.getBoundingClientRect().height || 76;
    strips.forEach((s) => { s.style.transform = 'translateY(0)'; });

    await wait(30);
    for (let i = 0; i < strips.length; i++) {
      const strip = strips[i];
      const shift = 24 * cell;
      strip.style.transition = `transform ${1.1 + i * 0.45}s cubic-bezier(0.16, 0.9, 0.2, 1)`;
      strip.style.transform = `translateY(-${shift}px)`;
    }
    for (let i = 0; i < strips.length; i++) {
      await wait(i === 0 ? 1150 : 450);
      strips[i].parentElement.classList.add('stopped');
      fx.snd('land');
    }
    await wait(350);
  };

  /* ---------- Лото: тираж выпадает по одному числу ---------- */

  IDLE.keno = (stage, g, option) => {
    const { pool, picks } = option.view;
    const mine = new Set();
    while (mine.size < picks) mine.add(1 + rnd(pool));
    stage.dataset.mine = JSON.stringify([...mine]);
    stage.innerHTML = `
      <div class="mg-keno">
        <div class="mg-keno-grid">${Array.from({ length: pool }, (_, i) =>
          `<span class="mg-keno-n ${mine.has(i + 1) ? 'mine' : ''}" data-n="${i + 1}">${i + 1}</span>`
        ).join('')}</div>
        <div class="mg-note">Ваши ${picks} отмечены. Тираж ${option.view.draw} чисел</div>
      </div>`;
  };

  PLAY.keno = async (stage, g, option, result, fx) => {
    IDLE.keno(stage, g, option);
    const { pool, draw, hits } = option.view;
    const mine = JSON.parse(stage.dataset.mine);
    const need = result.win ? (hits ? hits[result.outcomeIndex] : 1) : 0;

    // Тираж собирается так, чтобы совпадений вышло ровно столько, сколько
    // оплачено. Числа настоящие, подогнано только их количество - иначе
    // подпись «четыре совпадения» не совпала бы с выплатой.
    const matched = [...mine].sort(() => Math.random() - 0.5).slice(0, need);
    const rest = [];
    while (matched.length + rest.length < draw) {
      const n = 1 + rnd(pool);
      if (mine.includes(n) || rest.includes(n)) continue;
      rest.push(n);
    }
    const drawn = [...matched, ...rest].sort(() => Math.random() - 0.5);

    const note = stage.querySelector('.mg-note');
    let got = 0;
    for (const n of drawn) {
      const el = stage.querySelector(`[data-n="${n}"]`);
      el.classList.add('drawn');
      if (mine.includes(n)) { got++; el.classList.add('hit'); fx.snd('reveal'); }
      else fx.snd('tick');
      note.textContent = `Совпадений: ${got}`;
      await wait(210);
    }
    await wait(420);
  };

  /* ---------- Заезд: участники едут наперегонки ---------- */

  const RUNNER = { horse: '🐎', snail: '🐌', drone: '▰' };

  IDLE.race = (stage, g, option) => {
    const n = option.view.runners;
    stage.innerHTML = `
      <div class="mg-race">
        ${Array.from({ length: n }, (_, i) => `
          <div class="mg-lane ${i === option.view.lane ? 'mine' : ''}">
            <span class="mg-runner" data-lane="${i}">${RUNNER[option.view.kind] || '●'}</span>
          </div>`).join('')}
        <div class="mg-finish"></div>
      </div>
      <div class="mg-note">Ваш участник подсвечен</div>`;
  };

  PLAY.race = async (stage, g, option, result, fx) => {
    IDLE.race(stage, g, option);
    const n = option.view.runners;
    const mine = option.view.lane;
    const winner = result.win ? mine : (() => { let k; do { k = rnd(n); } while (k === mine); return k; })();

    const runners = [...stage.querySelectorAll('.mg-runner')];
    // У каждого своя длительность: победитель приходит первым, остальные
    // растягиваются позади. Без разброса все прибегают одновременно, и заезд
    // перестаёт читаться как заезд.
    const times = runners.map((_, i) => (i === winner ? 2600 : 2900 + rnd(1400)));
    runners.forEach((r, i) => {
      // Разгон у каждого свой: с одинаковой кривой шестеро едут строем, и
      // заезд перестаёт читаться как заезд.
      r.style.transition = `left ${times[i]}ms cubic-bezier(${(0.2 + Math.random() * 0.4).toFixed(2)}, 0.08, 0.55, 1)`;
    });
    await wait(30);
    runners.forEach((r) => { r.style.left = 'calc(100% - 34px)'; });
    const ticks = setInterval(() => fx.snd('tick'), 300);
    await wait(2650);
    clearInterval(ticks);
    runners[winner].classList.add('won');
    stage.querySelector('.mg-note').textContent =
      result.win ? 'Ваш участник первый' : `Первым пришёл номер ${winner + 1}`;
    fx.snd(result.win ? 'collect' : 'lose');
    await wait(700);
  };

  /* ---------- Выше-ниже: карты переворачиваются цепочкой ---------- */

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т'];
  const SUITS = ['♠', '♥', '♦', '♣'];

  IDLE.hilo = (stage, g, option) => {
    stage.innerHTML = `
      <div class="mg-cards">${Array.from({ length: option.view.cards }, (_, i) =>
        `<div class="mg-card-flip" data-c="${i}"><div class="mg-face back">?</div>
         <div class="mg-face front"></div></div>`).join('')}</div>
      <div class="mg-note">Каждая угаданная карта умножает</div>`;
  };

  PLAY.hilo = async (stage, g, option, result, fx) => {
    IDLE.hilo(stage, g, option);
    const n = option.view.cards;
    const stop = result.win ? n : failStep(n, option.winChance);
    const step = Math.pow(option.top, 1 / n);
    const note = stage.querySelector('.mg-note');

    for (let i = 0; i < (result.win ? n : stop + 1); i++) {
      const el = stage.querySelector(`[data-c="${i}"]`);
      const good = result.win || i < stop;
      const suit = pickOf(SUITS);
      el.querySelector('.front').innerHTML =
        `<b class="${suit === '♥' || suit === '♦' ? 'red' : ''}">${pickOf(RANKS)}${suit}</b>`;
      el.classList.add('flip', good ? 'good' : 'bad');
      fx.snd(good ? 'flip' : 'lose');
      note.textContent = good
        ? `Угадано ${i + 1} · ×${Math.pow(step, i + 1).toFixed(2)}`
        : `Сорвалось на ${i + 1}-й карте`;
      if (!good) { fx.haptic('error'); await wait(700); return; }
      await wait(330);
    }
    fx.snd('collect');
    await wait(450);
  };

  /* ---------- Предел: стрелка летит по шкале ---------- */

  IDLE.limbo = (stage, g, option) => {
    const top = option.view.scaleTop;
    const marks = [1, 2, 5, 10, 25, top].filter((v, i, a) => v <= top && a.indexOf(v) === i);
    const pos = (v) => (Math.log(v) / Math.log(top)) * 100;
    stage.innerHTML = `
      <div class="mg-limbo">
        <div class="mg-limbo-scale">
          ${marks.map((v) => `<i style="left:${pos(v).toFixed(1)}%"><b>×${v}</b></i>`).join('')}
          <div class="mg-limbo-goal" style="left:${pos(option.view.peak ?? option.top).toFixed(1)}%"></div>
          <div class="mg-limbo-needle" id="mgNeedle"></div>
        </div>
        <div class="mg-limbo-num" id="mgLimboNum">×1.00</div>
        <div class="mg-note">Цель ×${option.top}: выпавшее должно быть не ниже</div>
      </div>`;
  };

  PLAY.limbo = (stage, g, option, result, fx) => new Promise((resolve) => {
    IDLE.limbo(stage, g, option);
    const top = option.view.scaleTop;
    const goal = option.top;

    /*
     * Выпавшее число берётся из того же распределения, что и сама игра:
     * P(значение ≥ x) = отдача / x. Победа это «значение ≥ цели», и по
     * построению её вероятность равна отдача/цель - ровно то, что стоит в
     * таблице шансов. Поэтому шкала не врёт.
     */
    let value;
    if (result.win) {
      const u = Math.random() * (RTP / goal);
      value = Math.max(goal, RTP / Math.max(u, 1e-9));
    } else {
      const u = 1 - RTP / goal;
      value = RTP / Math.max(1 - Math.random() * u, 1e-9);
      value = Math.min(value, goal * 0.999);
    }
    value = Math.min(value, top * 1.5);

    const pos = (v) => Math.max(0, Math.min(100, (Math.log(Math.max(v, 1)) / Math.log(top)) * 100));
    const needle = stage.querySelector('#mgNeedle');
    const num = stage.querySelector('#mgLimboNum');
    const started = performance.now();
    const DURATION = 1500;

    function frame(now) {
      const t = Math.min(1, (now - started) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      // По дороге стрелка мечется: иначе она просто едет в ответ, и никакого
      // ожидания нет.
      const jitter = t < 0.85 ? (Math.random() - 0.5) * 30 * (1 - t) : 0;
      const shown = t < 1 ? Math.max(1, value * (0.15 + 0.85 * eased)) : value;
      needle.style.left = `${Math.max(0, Math.min(100, pos(shown) + jitter))}%`;
      num.textContent = '×' + shown.toFixed(2);
      if (t < 1) { requestAnimationFrame(frame); return; }
      needle.classList.add(result.win ? 'win' : 'lose');
      num.classList.add(result.win ? 'win' : 'lose');
      fx.snd(result.win ? 'collect' : 'lose');
      setTimeout(resolve, 650);
    }
    const ticks = setInterval(() => fx.snd('tick'), 180);
    setTimeout(() => clearInterval(ticks), DURATION);
    requestAnimationFrame(frame);
  });

  /* ---------- Скретч: стираете защитный слой ---------- */

  IDLE.scratch = (stage, g, option) => {
    stage.innerHTML = `
      <div class="mg-scratch" style="--cols:${option.view.panels <= 3 ? 3 : 3}">
        ${Array.from({ length: option.view.panels }, (_, i) =>
          `<div class="mg-panel" data-p="${i}"><span class="mg-panel-sym"></span>
           <span class="mg-panel-foil"></span></div>`).join('')}
      </div>
      <div class="mg-note">Под слоем ${option.view.panels} полей</div>`;
  };

  PLAY.scratch = async (stage, g, option, result, fx) => {
    IDLE.scratch(stage, g, option);
    const pool = SYMBOLS.slice(0, option.view.symbols);
    const panels = option.view.panels;

    // Сколько полей совпало, столько и платят: чем выше исход, тем больше.
    let same = 0;
    if (result.win) {
      const rank = (result.outcomeIndex + 1) / option.wins.length;
      same = Math.max(2, Math.round(2 + rank * (panels - 2)));
    }
    const hero = pickOf(pool);
    const syms = Array.from({ length: panels }, (_, i) => (i < same ? hero : pickOf(pool)));
    if (!result.win) {
      // Проигрыш: следим, чтобы случайно не сложилась пара.
      const seen = new Set();
      for (let i = 0; i < panels; i++) {
        let s; let guard = 0;
        do { s = pickOf(pool); guard++; } while (seen.has(s) && guard < 40);
        seen.add(s); syms[i] = s;
      }
    } else {
      syms.sort(() => Math.random() - 0.5);
    }

    const note = stage.querySelector('.mg-note');
    for (let i = 0; i < panels; i++) {
      const el = stage.querySelector(`[data-p="${i}"]`);
      el.querySelector('.mg-panel-sym').textContent = syms[i];
      el.classList.add('scratched');
      if (syms[i] === hero && result.win) el.classList.add('hit');
      fx.snd('tick');
      note.textContent = `Открыто ${i + 1} из ${panels}`;
      await wait(240);
    }
    if (result.win) { note.textContent = `Совпало ${same}`; fx.snd('collect'); }
    else note.textContent = 'Совпадений нет';
    await wait(500);
  };

  /* ---------- Удар: мяч летит в угол, вратарь прыгает ---------- */

  IDLE.shot = (stage, g, option) => {
    stage.innerHTML = `
      <div class="mg-goal">
        <div class="mg-goal-net"></div>
        <div class="mg-keeper" id="mgKeeper">🧤</div>
        <div class="mg-ballshot" id="mgShot">⚽</div>
        ${option.view.kind === 'wall' ? '<div class="mg-wall">▮▮▮▮</div>' : ''}
      </div>
      <div class="mg-note">${option.view.kind === 'dart' ? 'Бросок в мишень' : 'Вратарь выбирает свой угол'}</div>`;
  };

  PLAY.shot = async (stage, g, option, result, fx) => {
    IDLE.shot(stage, g, option);
    const shots = option.label.includes('подряд')
      ? Number(option.label.match(/\d+/)?.[0] || 1) : 1;
    const stop = result.win ? shots : failStep(shots, option.winChance);
    const ball = stage.querySelector('#mgShot');
    const keeper = stage.querySelector('#mgKeeper');
    const note = stage.querySelector('.mg-note');
    const corners = [18, 50, 82];

    for (let i = 0; i < (result.win ? shots : stop + 1); i++) {
      const good = result.win || i < stop;
      const aim = corners[Math.min(option.view.aim ?? 0, corners.length - 1)];
      const keeperTo = good ? pickOf(corners.filter((c) => Math.abs(c - aim) > 20)) : aim;

      ball.style.transition = 'none';
      ball.style.left = '50%';
      ball.style.bottom = '6px';
      ball.classList.remove('flying');
      await wait(40);

      keeper.style.transition = 'left 420ms cubic-bezier(0.3,0,0.4,1)';
      keeper.style.left = `${keeperTo}%`;
      ball.style.transition = 'left 460ms cubic-bezier(0.2,0,0.5,1), bottom 460ms cubic-bezier(0.2,0,0.5,1)';
      ball.style.left = `${aim}%`;
      ball.style.bottom = '58%';
      ball.classList.add('flying');
      fx.snd('tick');
      await wait(480);

      ball.classList.add(good ? 'scored' : 'saved');
      note.textContent = good
        ? (shots > 1 ? `Забито ${i + 1} из ${shots}` : 'Гол')
        : 'Вратарь взял';
      fx.snd(good ? 'reveal' : 'lose');
      if (!good) { fx.haptic('error'); await wait(650); return; }
      await wait(shots > 1 ? 320 : 600);
      ball.classList.remove('scored');
    }
    fx.snd('collect');
    await wait(400);
  };

  /* ---------- Кости: кубики катятся и замирают ---------- */

  const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  IDLE.dice = (stage, g, option) => {
    stage.innerHTML = `
      <div class="mg-dice">${Array.from({ length: option.view.dice }, (_, i) =>
        `<span class="mg-die" data-d="${i}">${PIPS[1 + rnd(6)]}</span>`).join('')}</div>
      <div class="mg-note">${esc(option.hint)}</div>`;
  };

  PLAY.dice = async (stage, g, option, result, fx) => {
    IDLE.dice(stage, g, option);
    const view = option.view;
    const dice = [...stage.querySelectorAll('.mg-die')];
    const note = stage.querySelector('.mg-note');

    /*
     * Грани подбираются так, чтобы удовлетворять условию варианта. Список
     * выигрышных граней приходит с сервера: если бы клиент решал сам, на
     * выигрыше «ровно шесть» могла бы показаться четвёрка.
     */
    const faces = rollFaces(view, result.win);

    dice.forEach((d) => d.classList.add('rolling'));
    const ticks = setInterval(() => fx.snd('tick'), 110);
    await wait(900);
    clearInterval(ticks);

    for (let i = 0; i < dice.length; i++) {
      dice[i].classList.remove('rolling');
      dice[i].textContent = PIPS[faces[i]];
      dice[i].classList.add('settled');
      fx.snd('land');
      await wait(140);
    }

    if (view.dice === 2) note.textContent = `Сумма ${faces[0] + faces[1]}`;
    else if (view.combos) note.textContent = result.win
      ? view.combos[result.outcomeIndex] : 'комбинации нет';
    else note.textContent = `Выпало ${faces[0]}`;
    await wait(500);
  };

  function rollFaces(view, win) {
    const n = view.dice;
    const any = () => 1 + rnd(6);
    for (let guard = 0; guard < 500; guard++) {
      const faces = Array.from({ length: n }, any);
      const ok = matches(view, faces);
      if (ok === win) return faces;
    }
    return Array.from({ length: n }, any);
  }

  function matches(view, faces) {
    if (view.good) return view.good.includes(faces[0]);
    if (view.sums) return view.sums.includes(faces[0] + faces[1]);
    if (view.doubles) return faces[0] === faces[1];
    if (view.combos) {
      const counts = {};
      for (const f of faces) counts[f] = (counts[f] || 0) + 1;
      return Math.max(...Object.values(counts)) >= 2;
    }
    return false;
  }

  /* ---------- Раскопки: слои снимаются один за другим ---------- */

  IDLE.dig = (stage, g, option) => {
    const n = option.view.layers;
    const step = Math.pow(option.top, 1 / n);
    stage.innerHTML = `
      <div class="mg-dig" data-ground="${option.view.ground}">
        ${Array.from({ length: n }, (_, i) =>
          `<div class="mg-layer" data-l="${i}"><span>×${Math.pow(step, i + 1).toFixed(2)}</span></div>`
        ).join('')}
        <div class="mg-dig-find" id="mgFind">💎</div>
      </div>
      <div class="mg-note">Снимем ${n} слоёв</div>`;
  };

  PLAY.dig = async (stage, g, option, result, fx) => {
    IDLE.dig(stage, g, option);
    const n = option.view.layers;
    const stop = result.win ? n : failStep(n, option.winChance);
    const note = stage.querySelector('.mg-note');

    for (let i = 0; i < (result.win ? n : stop + 1); i++) {
      const layer = stage.querySelector(`[data-l="${i}"]`);
      const bad = !result.win && i === stop;
      layer.classList.add(bad ? 'blocked' : 'removed');
      fx.snd(bad ? 'lose' : 'tick');
      note.textContent = bad ? `Порода на ${i + 1}-м слое` : `Снято ${i + 1} из ${n}`;
      if (bad) { fx.haptic('error'); await wait(680); return; }
      await wait(230);
    }
    stage.querySelector('#mgFind').classList.add('found');
    note.textContent = 'Докопались';
    fx.snd('collect');
    await wait(520);
  };

  /* ---------- Выбор: закрытые ячейки ---------- */

  IDLE.pick = (stage, g, option) => {
    const cells = option.view.cells;
    stage.innerHTML = `
      <div class="mg-grid" style="--cols:${Math.min(4, cells)}">
        ${Array.from({ length: cells }, (_, i) =>
          `<button class="mg-cell" data-cell="${i}"><span>?</span></button>`).join('')}
      </div>
      <div class="mg-note">Нажмите на ячейку</div>`;
    stage.querySelectorAll('[data-cell]').forEach((b) => {
      b.onclick = () => { if (!ui.busy) run(Number(b.dataset.cell)); };
    });
  };

  PLAY.pick = async (stage, g, option, result, fx) => {
    const cells = option.view.cells;
    // Остальные ячейки заполняются выборкой из настоящей таблицы: так «один
    // из трёх» на экране и есть один из трёх.
    const values = Array.from({ length: cells }, () => sampleOutcome(option));
    values[result.picked % cells] = result.multiplier;

    stage.innerHTML = `
      <div class="mg-grid" style="--cols:${Math.min(4, cells)}">
        ${values.map((m, i) => `<div class="mg-cell reveal ${m > 0 ? 'hit' : ''}
          ${i === result.picked % cells ? 'picked' : ''}" style="--i:${i}">
          <span>${m > 0 ? '×' + m : '-'}</span></div>`).join('')}
      </div>
      <div class="mg-note">Ваша ячейка подсвечена</div>`;
    for (let i = 0; i < cells; i++) { fx.snd('tick'); await wait(90); }

    /*
     * Раскрытие остаётся на экране: если сбросить его сразу, игрок увидит
     * закрытые ячейки одновременно с окном выигрыша и не поймёт, где именно
     * лежало то, что ему заплатили. Новый раунд начинается нажатием на любую
     * ячейку, и тогда же поле закрывается обратно.
     */
    stage.querySelectorAll('.mg-cell').forEach((cell, i) => {
      cell.classList.add('again');
      cell.onclick = () => {
        if (ui.busy) return;
        IDLE.pick(stage, ui.game, ui.game.options[ui.option]);
        run(i);
      };
    });
    await wait(400);
  };

  function sampleOutcome(option) {
    const roll = Math.random();
    let acc = 0;
    for (const w of option.wins) {
      acc += w.probability;
      if (roll < acc) return w.multiplier;
    }
    return 0;
  }

  return { renderShelf, openGame, closeGame, close: closeGame };
}
