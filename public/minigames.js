/**
 * Мини-игры: витрина, экран игры и восемь способов показать исход.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: картинка не придумывает шансы.
 *
 * Исход решает сервер и присылает индекс выигрышного исхода. Здесь он
 * раскрывается, и раскрытие обязано соответствовать настоящим вероятностям:
 *
 *   - у колеса угол сектора равен его вероятности, а не «поровну на всех».
 *     Сектор с шансом два процента это тонкая полоска, а не шестая часть
 *     круга. Колесо с равными секторами и разными шансами врёт картинкой;
 *   - у плинко ширина лунки равна её вероятности;
 *   - ячейки в «выборе» заполняются выборкой из той же таблицы, по которой
 *     играет сервер, поэтому «один из трёх» на экране и есть один из трёх;
 *   - в «дорожке» и «поле» место срыва берётся из настоящего условного
 *     распределения: сорваться на первом шаге вероятнее, чем на последнем,
 *     и на экране это так и выглядит.
 *
 * Модуль не импортирует app.js: всё, что ему нужно, передаётся в createMini.
 * Иначе получился бы круг импортов, и оба файла перестали бы грузиться.
 */

/** Сколько миллисекунд длится раскрытие у каждого семейства. */
const REVEAL_MS = {
  pick: 900, wheel: 3400, reels: 2200, toss: 1300,
  drop: 2400, path: 1800, field: 1800, bet: 1200,
};

/* ============================================================
   ЧЕСТНАЯ РАСКЛАДКА
   ============================================================ */

/**
 * Разбивает круг (или полосу) на доли по настоящим вероятностям.
 *
 * Проигрыш дробится на несколько долей: одна сплошная тёмная половина круга
 * выглядит как поломка, а не как «мимо». На вероятность это не влияет -
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
  // Перемешиваем по фиксированному правилу, а не случайно: сектор должен
  // стоять на одном месте между прокрутами, иначе игрок не запомнит колесо.
  out.sort((a, b) => ((a.multiplier * 7919 + 13) % 11) - ((b.multiplier * 7919 + 13) % 11));
  return out;
}

/** Случайный индекс доли, отвечающей нужному исходу. */
function shareFor(list, outcomeIndex) {
  const hits = list
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.outcomeIndex === outcomeIndex);
  if (!hits.length) return 0;
  return hits[Math.floor(Math.random() * hits.length)].i;
}

/** Выборка одного исхода из настоящей таблицы игры. Нужна только для показа. */
function sampleOutcome(option) {
  const roll = Math.random();
  let acc = 0;
  for (const w of option.wins) {
    acc += w.probability;
    if (roll < acc) return w.multiplier;
  }
  return 0;
}

/**
 * На каком шаге сорвалось, если известно, что сорвалось.
 *
 * Шанс дойти до конца известен (он же вероятность выигрыша), шагов n, значит
 * шанс пережить один шаг равен корню n-й степени. Отсюда условное
 * распределение места срыва. Без этого срыв рисовался бы равномерно, и
 * «дошёл до предпоследней ступени» случалось бы так же часто, как «упал на
 * первой», - чего не бывает.
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

/* ============================================================
   МОДУЛЬ
   ============================================================ */

export function createMini(deps) {
  const { api, esc, fmt, money, toast, haptic, state, sounds = {} } = deps;
  const snd = (name) => { try { sounds[name]?.(); } catch { /* звук не обязателен */ } };

  const ui = {
    family: 'all',
    game: null,
    option: 0,
    bet: 100,
    busy: false,
  };

  const games = () => state.config?.minigames?.games || [];
  const families = () => state.config?.minigames?.families || [];

  /** Палитра карточки строится из одного числа, поэтому не разъезжается. */
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
      [{ id: 'all', name: 'Все', hint: `${games().length} игр` }, ...families()]
        .map((f) => `<button class="tab ${f.id === ui.family ? 'active' : ''}"
          data-mini-family="${f.id}">${esc(f.name)}</button>`).join('');

    box.innerHTML = list.map((g) => `
      <button class="mg-card" style="${skin(g.hue)}" data-mini-game="${g.id}">
        <span class="mg-card-art">${artSvg(g.art)}</span>
        <span class="mg-card-name">${esc(g.name)}</span>
        <span class="mg-card-sub">${esc(g.tagline)}</span>
        <span class="mg-card-top">до ×${g.top}</span>
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
    document.getElementById('miniGame').hidden = true;
    document.getElementById('miniShelfWrap').hidden = false;
  }

  function renderGame() {
    const g = ui.game;
    const option = g.options[ui.option];
    const screen = document.getElementById('miniGame');
    screen.setAttribute('style', skin(g.hue));

    screen.innerHTML = `
      <div class="mg-head">
        <button class="btn btn-outline btn-sm" id="mgBack">Назад</button>
        <div class="mg-head-main">
          <div class="mg-title">${esc(g.name)}</div>
          <div class="mg-sub">${esc(g.tagline)}</div>
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
        g.family === 'pick' ? 'Выберите ячейку' : 'Играть'}</button>

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
          сервер и проверяется через «Честность игры»: раскрытие на экране лишь
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

    renderStage();
  }

  /* ---------- Поле игры до розыгрыша ---------- */

  function renderStage(result = null) {
    const g = ui.game;
    const option = g.options[ui.option];
    const stage = document.getElementById('mgStage');
    STAGE[g.family](stage, g, option, result);
  }

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
      data = await api('/api/mini/play', {
        gameId: g.id, option: ui.option, bet, picked,
      });
    } catch (err) {
      toast(err.message);
      haptic('error');
      ui.busy = false;
      play.disabled = g.family === 'pick';
      return;
    }

    if (data.user) deps.onUser?.(data.user);
    snd('bet');
    renderStage(data);

    await new Promise((r) => setTimeout(r, REVEAL_MS[g.family] || 1500));

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
    if (g.family === 'pick') play.textContent = 'Выберите ячейку';
  }

  /* ============================================================
     ВОСЕМЬ СПОСОБОВ ПОКАЗАТЬ ИСХОД
     ============================================================ */

  const STAGE = {
    /* ---- Выбор: ячейки равноправны, содержимое берётся из той же таблицы ---- */
    pick(stage, g, option, result) {
      const cells = option.view.cells || 4;
      if (!result) {
        stage.innerHTML = `<div class="mg-grid" style="--cols:${Math.min(5, Math.ceil(Math.sqrt(cells)))}">
          ${Array.from({ length: cells }, (_, i) =>
            `<button class="mg-cell" data-cell="${i}"><span>?</span></button>`).join('')}
        </div>`;
        stage.querySelectorAll('[data-cell]').forEach((b) => {
          b.onclick = () => { if (!ui.busy) run(Number(b.dataset.cell)); };
        });
        return;
      }

      // Остальные ячейки заполняются выборкой из настоящей таблицы: так
      // «один из трёх» на экране и есть один из трёх.
      const values = Array.from({ length: cells }, () => sampleOutcome(option));
      values[result.picked % cells] = result.multiplier;

      stage.innerHTML = `<div class="mg-grid" style="--cols:${Math.min(5, Math.ceil(Math.sqrt(cells)))}">
        ${values.map((m, i) => `<div class="mg-cell open ${m > 0 ? 'hit' : ''}
          ${i === result.picked % cells ? 'picked' : ''}">
          <span>${m > 0 ? '×' + m : '-'}</span></div>`).join('')}
      </div>`;
    },

    /* ---- Колесо: угол сектора равен его вероятности ---- */
    wheel(stage, g, option, result) {
      const list = shares(option, Math.max(3, Math.round((option.view.sectors || 8) / 3)));
      let angle = 0;
      const arcs = list.map((s) => {
        const from = angle;
        angle += s.p * 360;
        return { ...s, from, to: angle, mid: (from + angle) / 2 };
      });

      const R = 46;
      const arcPath = (a) => {
        if (a.to - a.from >= 359.9) return `M 50 4 A ${R} ${R} 0 1 1 49.9 4 Z`;
        const rad = (d) => ((d - 90) * Math.PI) / 180;
        const x1 = 50 + R * Math.cos(rad(a.from)), y1 = 50 + R * Math.sin(rad(a.from));
        const x2 = 50 + R * Math.cos(rad(a.to)), y2 = 50 + R * Math.sin(rad(a.to));
        return `M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
               `A ${R} ${R} 0 ${a.to - a.from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      };

      stage.innerHTML = `
        <div class="mg-wheel">
          <svg viewBox="0 0 100 100" class="mg-wheel-svg" id="mgWheelSvg">
            ${arcs.map((a, i) => `<path d="${arcPath(a)}"
              class="mg-sector ${a.win ? 'win' : ''}"
              style="--i:${i}"></path>`).join('')}
            <circle cx="50" cy="50" r="12" class="mg-wheel-hub"></circle>
          </svg>
          <div class="mg-wheel-pin"></div>
        </div>
        <div class="mg-legend">${arcs.filter((a) => a.win)
          .map((a) => `<span>×${a.multiplier} · ${(a.p * 100).toFixed(a.p < 0.001 ? 3 : 1)}%</span>`)
          .join('')}</div>`;

      if (!result) return;
      const idx = shareFor(arcs, result.outcomeIndex);
      const target = arcs[idx];
      // Указатель стоит сверху, поэтому нужный сектор надо привезти к нулю.
      const deg = 360 * 6 - target.mid;
      const svg = document.getElementById('mgWheelSvg');
      svg.style.transition = 'transform 3.2s cubic-bezier(0.12, 0.72, 0.12, 1)';
      requestAnimationFrame(() => { svg.style.transform = `rotate(${deg}deg)`; });
    },

    /* ---- Барабаны ---- */
    reels(stage, g, option, result) {
      const count = option.view.reels || 3;
      const symbols = ['◆', '★', '●', '▲', '■', '♠', '♥', '⬢'].slice(0, option.view.symbols || 6);
      const pick = () => symbols[Math.floor(Math.random() * symbols.length)];

      let faces;
      if (!result) faces = Array.from({ length: count }, () => '?');
      else if (result.win) {
        // Чем крупнее множитель, тем больше совпадений: три одинаковых должны
        // означать крупный выигрыш, иначе картинка спорит с суммой.
        const hero = pick();
        const same = result.multiplier >= 10 ? count : Math.max(2, count - 1);
        faces = Array.from({ length: count }, (_, i) => (i < same ? hero : pick()));
      } else {
        // Проигрыш: следим, чтобы случайно не сложилось совпадение.
        do { faces = Array.from({ length: count }, pick); }
        while (new Set(faces).size < count && symbols.length >= count);
      }

      stage.innerHTML = `<div class="mg-reels">${faces.map((f, i) =>
        `<div class="mg-reel ${result ? 'stop' : ''}" style="--i:${i}"><span>${f}</span></div>`
      ).join('')}</div>`;
    },

    /* ---- Бросок ---- */
    toss(stage, g, option, result) {
      const faces = option.view.faces || 6;
      const dice = option.view.dice || 1;
      const face = () => 1 + Math.floor(Math.random() * Math.min(faces, 6));
      const shown = result
        ? Array.from({ length: dice }, face)
        : Array.from({ length: dice }, () => '?');

      stage.innerHTML = `<div class="mg-toss">${shown.map((v, i) =>
        `<div class="mg-die ${result ? 'stop' : 'roll'}" style="--i:${i}">${v}</div>`).join('')}
        ${faces > 6 ? `<div class="mg-number">${result
          ? 1 + Math.floor(Math.random() * faces) : '?'}</div>` : ''}</div>`;
    },

    /* ---- Падение: ширина лунки равна её вероятности ---- */
    drop(stage, g, option, result) {
      const rows = option.view.rows || 8;
      const list = shares(option, Math.max(2, Math.round((option.view.slots || 9) / 3)));
      let acc = 0;
      const slots = list.map((s) => {
        const from = acc;
        acc += s.p;
        return { ...s, from, to: acc, mid: (from + acc) / 2 };
      });

      stage.innerHTML = `
        <div class="mg-drop">
          <div class="mg-pegs">${Array.from({ length: rows }, (_, r) =>
            `<div class="mg-peg-row">${Array.from({ length: r + 2 },
              () => '<i></i>').join('')}</div>`).join('')}</div>
          <div class="mg-ball" id="mgBall"></div>
          <div class="mg-slots">${slots.map((s) =>
            `<div class="mg-slot ${s.win ? 'win' : ''}" style="flex-grow:${Math.max(s.p, 0.01)}">
              ${s.win ? '×' + s.multiplier : '-'}</div>`).join('')}</div>
        </div>`;

      if (!result) return;
      const idx = shareFor(slots, result.outcomeIndex);
      const ball = document.getElementById('mgBall');
      ball.style.setProperty('--x', `${(slots[idx].mid * 100).toFixed(2)}%`);
      requestAnimationFrame(() => ball.classList.add('fall'));
    },

    /* ---- Дорожка: место срыва берётся из условного распределения ---- */
    path(stage, g, option, result) {
      const steps = option.view.steps || 5;
      const stop = result && !result.win ? failStep(steps, option.winChance) : steps;

      stage.innerHTML = `<div class="mg-path">${Array.from({ length: steps }, (_, i) => `
        <div class="mg-step ${result ? (i < stop ? 'done' : i === stop && !result.win ? 'fail' : '') : ''}"
             style="--i:${i}">
          <b>${i + 1}</b>
        </div>`).join('')}
        <div class="mg-step goal ${result?.win ? 'done' : ''}">★</div></div>`;
    },

    /* ---- Поле ---- */
    field(stage, g, option, result) {
      const size = option.view.size || 25;
      const picks = option.view.picks || 3;
      const cols = Math.round(Math.sqrt(size));
      const stop = result && !result.win ? failStep(picks, option.winChance) : picks;

      // Какие клетки открываем - показ, а не розыгрыш: порядок клеток на исход
      // не влияет, влияет только сколько их решено открыть.
      const order = Array.from({ length: size }, (_, i) => i)
        .sort(() => Math.random() - 0.5)
        .slice(0, picks);

      stage.innerHTML = `<div class="mg-grid mg-field" style="--cols:${cols}">
        ${Array.from({ length: size }, (_, i) => {
          const at = order.indexOf(i);
          if (!result || at < 0) return '<div class="mg-cell"><span></span></div>';
          if (at < stop) return `<div class="mg-cell open hit" style="--i:${at}"><span>✓</span></div>`;
          if (at === stop && !result.win) {
            return `<div class="mg-cell open trap" style="--i:${at}"><span>✕</span></div>`;
          }
          return '<div class="mg-cell"><span></span></div>';
        }).join('')}
      </div>
      <div class="mg-field-note">${result
        ? (result.win ? `Открыто ${picks} из ${size}, ловушек не попалось`
                      : `Ловушка на ${stop + 1}-й клетке`)
        : `Откроем ${picks} клеток из ${size}, ловушек ${option.view.traps}`}</div>`;
    },

    /* ---- Ставка: просто честное раскрытие ---- */
    bet(stage, g, option, result) {
      const label = result
        ? (result.win ? option.label : 'Не ' + option.label.toLowerCase())
        : '?';
      stage.innerHTML = `<div class="mg-bet-stage ${result ? (result.win ? 'win' : 'lose') : ''}">
        <div class="mg-bet-face">${esc(label)}</div>
        <div class="mg-bet-note">${esc(option.hint)}</div>
      </div>`;
    },
  };

  return { renderShelf, openGame, closeGame, close: closeGame };
}
