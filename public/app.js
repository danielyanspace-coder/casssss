/**
 * Клиент мини-аппа: кейсы, краш, рулетка.
 *
 * Клиент НЕ решает исход. Он отправляет запрос, получает от сервера готовый
 * результат и лишь проигрывает анимацию. В краше точка взрыва вообще не
 * приходит на клиент до конца раунда — иначе можно было бы забирать ставку
 * ровно перед ним.
 */

const tg = window.Telegram?.WebApp;

const state = {
  config: null,
  user: null,
  activeCategory: null,
  openingCaseId: null,
  busy: false,
  crash: null,
  rouletteColor: 'red',
  crashHistory: [],
  rouletteHistory: [],
};

/* ============================================================
   API И УТИЛИТЫ
   ============================================================ */

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': tg?.initData || '',
    },
    body: JSON.stringify(body || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Ошибка ${res.status}`);
  return data;
}

const fmt = (n) => Number(n).toLocaleString('ru-RU');

const TIER_ICONS = {
  common: '▪', uncommon: '◆', rare: '✦', epic: '✧',
  legendary: '★', mythic: '☀', unique: '👑',
};

const GAME_ICONS = { case: '🎁', crash: '🚀', roulette: '🎯' };

const CATEGORY_COLORS = {
  start: '#00d4ff', classic: '#a020ff', highroll: '#ffd60a', risk: '#ff1744',
};

function tierColor(tier) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--t-${tier}`).trim() || '#9d8bb0';
}

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function haptic(type = 'light') {
  try {
    if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch { /* вне Telegram вибрации нет */ }
}

/** Падающие символы валюты на фоне. */
function buildMoneyRain() {
  const layer = document.getElementById('moneyRain');
  const symbols = ['$', '💰', '💎', '$', '🪙', '$'];
  let html = '';
  for (let i = 0; i < 18; i++) {
    const left = Math.random() * 100;
    const dur = 9 + Math.random() * 12;
    const delay = -Math.random() * 20;
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    html += `<span class="money-drop" style="left:${left}%;animation-duration:${dur}s;animation-delay:${delay}s">${sym}</span>`;
  }
  layer.innerHTML = html;
}

/* ============================================================
   БАЛАНС И СТАТИСТИКА
   ============================================================ */

function renderBalance() {
  const chip = document.getElementById('balanceChip');
  document.getElementById('balanceValue').textContent = fmt(state.user.balance);
  chip.classList.add('bump');
  setTimeout(() => chip.classList.remove('bump'), 260);

  const row = document.getElementById('bonusRow');
  row.hidden = state.user.balance > state.config.bonus.balanceLimit;
  document.getElementById('bonusHint').textContent =
    `+${fmt(state.config.bonus.amount)} ед., раз в ${state.config.bonus.cooldownMin} мин.`;
}

function renderStats() {
  const s = state.user.stats;
  const cards = [
    { label: 'Сыграно раундов', value: fmt(s.rounds) },
    { label: 'Лучший множитель', value: s.bestMultiplier ? `${s.bestMultiplier}x` : '—' },
    { label: 'Поставлено', value: fmt(s.spent) },
    { label: 'Выиграно', value: fmt(s.won) },
    {
      label: 'Итог',
      value: `${s.profit >= 0 ? '+' : ''}${fmt(s.profit)}`,
      cls: s.profit > 0 ? 'plus' : s.profit < 0 ? 'minus' : '',
    },
    { label: 'Ваш фактический RTP', value: s.spent ? `${((s.won / s.spent) * 100).toFixed(1)}%` : '—' },
  ];

  document.getElementById('statsGrid').innerHTML = cards
    .map((c) => `<div class="stat-card">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value ${c.cls || ''}">${c.value}</div>
      </div>`)
    .join('');
}

function applyUser(user) {
  state.user = user;
  renderBalance();
  renderStats();
}

/* ============================================================
   КЕЙСЫ
   ============================================================ */

function renderCategories() {
  const tabs = document.getElementById('categoryTabs');
  tabs.innerHTML = state.config.categories
    .map((c) => `<button class="tab ${c.id === state.activeCategory ? 'active' : ''}" data-cat="${c.id}">${c.name}</button>`)
    .join('');

  tabs.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeCategory = btn.dataset.cat;
      haptic('light');
      renderCategories();
      renderCases();
    });
  });
}

function renderCases() {
  const grid = document.getElementById('caseGrid');
  const list = state.config.cases.filter((c) => c.category === state.activeCategory);

  grid.innerHTML = list
    .map((c) => {
      const color = CATEGORY_COLORS[c.category] || '#a020ff';
      const top = c.items[c.items.length - 1];
      return `<div class="case-card" data-case="${c.id}" style="--cat-color:${color}">
        <div class="case-top">
          <div class="case-art">
            <div class="case-orbit"><span>$</span><span>$</span><span>$</span><span>$</span></div>
            <div class="case-box">🎁</div>
          </div>
          <div class="case-info">
            <div class="case-name">${c.name}</div>
            <div class="case-tagline">${c.tagline}</div>
          </div>
        </div>
        <div class="case-bottom">
          <div class="case-price-tag"><b>${fmt(c.price)}</b><i>ЕД.</i></div>
          <div class="case-stats">
            <div class="case-stat max">до <b>${fmt(top.value)}</b></div>
            <div class="case-stat">RTP <b>${(c.rtp * 100).toFixed(1)}%</b></div>
          </div>
        </div>
      </div>`;
    })
    .join('');

  grid.querySelectorAll('.case-card').forEach((card) => {
    card.addEventListener('click', () => openSheet(card.dataset.case));
  });
}

function openSheet(caseId) {
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;
  haptic('light');

  const rows = c.items
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((it) => `<div class="item-row" style="--tier-color:${tierColor(it.tier)}">
        <span class="item-dot"></span>
        <div class="item-info">
          <div class="item-name">${it.name}</div>
          <div class="item-mult">${it.multiplier}x от цены</div>
        </div>
        <div class="item-right">
          <div class="item-value">${fmt(it.value)}</div>
          <div class="item-chance">${(it.probability * 100).toFixed(3)}%</div>
        </div>
      </div>`)
    .join('');

  document.getElementById('sheetContent').innerHTML = `
    <div class="sheet-title">${c.name}</div>
    <div class="sheet-tagline">${c.tagline}</div>
    <div class="sheet-badges">
      <span class="badge">Цена: <strong>${fmt(c.price)} ед.</strong></span>
      <span class="badge">RTP: <strong>${(c.rtp * 100).toFixed(2)}%</strong></span>
      <span class="badge">Максимум: <strong>${c.maxMultiplier}x</strong></span>
    </div>
    <div class="items-title"><span>Содержимое</span><span>цена / шанс</span></div>
    ${rows}
    <button class="btn btn-primary sheet-open-btn" id="doOpenBtn">ОТКРЫТЬ ЗА ${fmt(c.price)}</button>
  `;

  document.getElementById('sheetBackdrop').hidden = false;
  document.getElementById('doOpenBtn').addEventListener('click', () => {
    closeSheet();
    startOpening(c.id);
  });
}

function closeSheet() {
  document.getElementById('sheetBackdrop').hidden = true;
}

document.getElementById('sheetBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'sheetBackdrop') closeSheet();
});

const TILE_WIDTH = 128;
const TILE_STEP = TILE_WIDTH + 10;
const STRIP_LENGTH = 62;
const WINNER_INDEX = 54;

/** Случайный предмет с учётом реальных вероятностей — лента выглядит правдиво. */
function weightedSample(items) {
  const r = Math.random();
  let acc = 0;
  for (const it of items) {
    acc += it.probability;
    if (r < acc) return it;
  }
  return items[0];
}

function tileHtml(item) {
  return `<div class="reel-tile" style="--tier-color:${tierColor(item.tier)}">
    <div class="tile-icon">${TIER_ICONS[item.tier] || '▪'}</div>
    <div class="tile-name">${item.name}</div>
    <div class="tile-value">${fmt(item.value)}</div>
  </div>`;
}

async function startOpening(caseId) {
  if (state.busy) return;
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;

  if (state.user.balance < c.price) {
    toast(`Не хватает ${fmt(c.price - state.user.balance)} ед.`);
    haptic('error');
    return;
  }

  state.busy = true;
  state.openingCaseId = caseId;

  let data;
  try {
    data = await api('/api/open', { caseId });
  } catch (err) {
    state.busy = false;
    toast(err.message);
    haptic('error');
    return;
  }

  const opener = document.getElementById('opener');
  const reel = document.getElementById('reel');
  document.getElementById('openerCaseName').textContent = `${c.name} · ${fmt(c.price)} ед.`;
  document.getElementById('result').hidden = true;
  opener.hidden = false;

  const strip = [];
  for (let i = 0; i < STRIP_LENGTH; i++) {
    strip.push(i === WINNER_INDEX ? data.item : weightedSample(c.items));
  }
  reel.innerHTML = strip.map(tileHtml).join('');

  reel.style.transition = 'none';
  reel.style.transform = 'translateX(0)';
  void reel.offsetWidth; // принудительный reflow, иначе браузер склеит стили

  const viewport = reel.parentElement.clientWidth;
  const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.55);
  const target = WINNER_INDEX * TILE_STEP + TILE_WIDTH / 2 - viewport / 2 + jitter;

  requestAnimationFrame(() => {
    reel.style.transition = 'transform 5.6s cubic-bezier(0.09, 0.72, 0.13, 1)';
    reel.style.transform = `translateX(${-target}px)`;
  });

  haptic('medium');
  const ticks = [1200, 2400, 3300, 4000, 4500, 4900, 5200, 5400];
  const timers = ticks.map((t) => setTimeout(() => haptic('light'), t));

  setTimeout(() => {
    timers.forEach(clearTimeout);
    showCaseResult(data, c);
  }, 5750);
}

function showCaseResult(data, caseData) {
  const item = data.item;
  const result = document.getElementById('result');
  result.style.setProperty('--tier-color', tierColor(item.tier));

  document.getElementById('resultTier').textContent =
    state.config.tiers.find((t) => t.id === item.tier)?.label || item.tier;
  document.getElementById('resultName').textContent = item.name;
  document.getElementById('resultValue').textContent = `${fmt(item.value)} ед.`;

  const net = document.getElementById('resultNet');
  net.textContent = data.net >= 0
    ? `+${fmt(data.net)} ед. · ${item.multiplier}x`
    : `${fmt(data.net)} ед. · ${item.multiplier}x`;
  net.className = `result-net ${data.net >= 0 ? 'plus' : 'minus'}`;

  result.hidden = false;
  applyUser(data.user);
  state.busy = false;
  haptic(data.net > 0 ? 'success' : 'light');

  const againBtn = document.getElementById('againBtn');
  againBtn.disabled = state.user.balance < caseData.price;
  againBtn.textContent = againBtn.disabled ? 'Не хватает' : `Ещё раз · ${fmt(caseData.price)}`;
}

document.getElementById('closeOpener').addEventListener('click', () => {
  document.getElementById('opener').hidden = true;
});

document.getElementById('againBtn').addEventListener('click', () => {
  if (state.openingCaseId) startOpening(state.openingCaseId);
});

/* ============================================================
   ПАНЕЛИ СТАВОК
   ============================================================ */

function betValue(inputId) {
  const el = document.getElementById(inputId);
  const v = Math.floor(Number(el.value));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function setBet(inputId, value) {
  document.getElementById(inputId).value = Math.max(1, Math.floor(value));
}

function wireBetPanel(inputId, addAttr, quickAttr) {
  document.querySelectorAll(`[${addAttr}]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      setBet(inputId, betValue(inputId) + Number(btn.getAttribute(addAttr)));
      haptic('light');
    });
  });

  document.querySelectorAll(`[${quickAttr}]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute(quickAttr);
      const cur = betValue(inputId) || 1;
      if (mode === 'half') setBet(inputId, Math.max(1, Math.floor(cur / 2)));
      if (mode === 'double') setBet(inputId, cur * 2);
      if (mode === 'max') setBet(inputId, Math.max(1, state.user.balance));
      haptic('light');
    });
  });
}

/* ============================================================
   КРАШ
   ============================================================ */

const crashEl = {
  multiplier: () => document.getElementById('crashMultiplier'),
  status: () => document.getElementById('crashStatus'),
  btn: () => document.getElementById('crashActionBtn'),
  line: () => document.getElementById('crashLine'),
  area: () => document.getElementById('crashArea'),
  rocket: () => document.getElementById('crashRocket'),
};

const GRAPH_W = 300;
const GRAPH_H = 140;

/** Перерисовывает кривую роста по текущему времени раунда. */
function drawCrashGraph(elapsedMs, multiplier) {
  const growth = state.config.crash.growth;
  const xMax = Math.max(6000, elapsedMs * 1.15);
  const yMax = Math.max(2, multiplier * 1.15);

  const points = [];
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * elapsedMs;
    const m = Math.exp((growth * t) / 1000);
    const x = (t / xMax) * GRAPH_W;
    const y = GRAPH_H - ((m - 1) / (yMax - 1)) * (GRAPH_H - 12);
    points.push(`${x.toFixed(1)},${Math.max(4, y).toFixed(1)}`);
  }

  const line = points.join(' ');
  crashEl.line().setAttribute('points', line);
  crashEl.area().setAttribute('points', `0,${GRAPH_H} ${line} ${(elapsedMs / xMax * GRAPH_W).toFixed(1)},${GRAPH_H}`);

  const last = points[points.length - 1].split(',');
  const stage = document.getElementById('crashStage');
  crashEl.rocket().style.transform =
    `translate(${(Number(last[0]) / GRAPH_W) * stage.clientWidth - 15}px, ` +
    `${(Number(last[1]) / GRAPH_H) * stage.clientHeight - stage.clientHeight - 15}px)`;
}

function resetCrashGraph() {
  crashEl.line().setAttribute('points', '');
  crashEl.area().setAttribute('points', '');
  crashEl.rocket().classList.remove('flying');
  crashEl.rocket().style.transform = 'translate(0, -15px)';
}

/** Цвет множителя меняется по мере роста — визуальная шкала риска. */
function crashColorFor(m) {
  if (m < 2) return 'var(--cyan)';
  if (m < 5) return 'var(--pink)';
  if (m < 15) return 'var(--magenta)';
  return 'var(--gold)';
}

async function startCrash() {
  if (state.busy || state.crash) return;

  const bet = betValue('crashBet');
  if (!bet) { toast('Укажите ставку'); return; }
  if (bet > state.user.balance) {
    toast(`Не хватает ${fmt(bet - state.user.balance)} ед.`);
    haptic('error');
    return;
  }

  state.busy = true;
  let data;
  try {
    data = await api('/api/crash/start', { bet });
  } catch (err) {
    state.busy = false;
    toast(err.message);
    haptic('error');
    return;
  }

  applyUser(data.user);

  state.crash = { roundId: data.roundId, bet, localStart: Date.now(), finished: false };

  resetCrashGraph();
  crashEl.rocket().classList.add('flying');
  crashEl.multiplier().className = 'crash-multiplier';
  crashEl.status().className = 'crash-status';
  crashEl.status().textContent = 'Забирай, пока не взорвалось';

  const btn = crashEl.btn();
  btn.classList.add('cashout');
  btn.textContent = 'ЗАБРАТЬ';
  haptic('medium');

  runCrashLoop();
  pollCrashState();
}

/** Локальная анимация: множитель считается по той же формуле, что на сервере. */
function runCrashLoop() {
  const round = state.crash;
  if (!round || round.finished) return;

  const elapsed = Date.now() - round.localStart;
  const m = Math.exp((state.config.crash.growth * elapsed) / 1000);

  crashEl.multiplier().textContent = `${m.toFixed(2)}x`;
  crashEl.multiplier().style.color = crashColorFor(m);
  crashEl.btn().textContent = `ЗАБРАТЬ ${fmt(Math.floor(round.bet * m))}`;
  drawCrashGraph(elapsed, m);

  round.raf = requestAnimationFrame(runCrashLoop);
}

/**
 * Опрос сервера. Точку взрыва клиент заранее не знает, поэтому узнаёт о ней
 * только отсюда — иначе можно было бы выводить ставку ровно перед взрывом.
 */
async function pollCrashState() {
  const round = state.crash;
  if (!round || round.finished) return;

  let data;
  try {
    data = await api('/api/crash/state', { roundId: round.roundId });
  } catch {
    round.poll = setTimeout(pollCrashState, 400);
    return;
  }

  if (data.status === 'busted') {
    finishCrash({ status: 'busted', crashPoint: data.crashPoint, payout: 0, user: data.user });
    return;
  }
  if (data.status === 'cashed') return;

  round.poll = setTimeout(pollCrashState, 150);
}

async function cashoutCrash() {
  const round = state.crash;
  if (!round || round.finished) return;

  round.cashing = true;
  let data;
  try {
    data = await api('/api/crash/cashout', { roundId: round.roundId });
  } catch (err) {
    toast(err.message);
    return;
  }

  finishCrash(data);
}

function finishCrash(data) {
  const round = state.crash;
  if (!round || round.finished) return;

  round.finished = true;
  cancelAnimationFrame(round.raf);
  clearTimeout(round.poll);

  const mult = crashEl.multiplier();
  const status = crashEl.status();
  const btn = crashEl.btn();

  if (data.status === 'cashed') {
    mult.textContent = `${data.cashedAt.toFixed(2)}x`;
    mult.className = 'crash-multiplier cashed';
    mult.style.color = '';
    status.className = 'crash-status win';
    status.textContent = `Забрали ${fmt(data.payout)} ед. · взорвалось на ${data.crashPoint.toFixed(2)}x`;
    haptic('success');
    pushRecent('crash', data.crashPoint);
  } else {
    mult.textContent = `${data.crashPoint.toFixed(2)}x`;
    mult.className = 'crash-multiplier busted';
    mult.style.color = '';
    status.className = 'crash-status lose';
    status.textContent = `Взорвалось. Ставка ${fmt(round.bet)} ед. потеряна`;
    haptic('error');
    pushRecent('crash', data.crashPoint);
  }

  crashEl.rocket().classList.remove('flying');
  btn.classList.remove('cashout');
  btn.textContent = 'ПОСТАВИТЬ';

  if (data.user) applyUser(data.user);
  state.crash = null;
  state.busy = false;
}

crashEl.btn().addEventListener('click', () => {
  if (state.crash && !state.crash.finished) cashoutCrash();
  else startCrash();
});

/** Лента последних результатов — общая для краша и рулетки. */
function pushRecent(game, value) {
  if (game === 'crash') {
    state.crashHistory.unshift(value);
    state.crashHistory = state.crashHistory.slice(0, 14);
    document.getElementById('crashRecent').innerHTML = state.crashHistory
      .map((v) => {
        const cls = v < 2 ? 'low' : v < 10 ? 'mid' : 'high';
        return `<span class="recent-pill ${cls}">${v.toFixed(2)}x</span>`;
      })
      .join('');
  } else {
    state.rouletteHistory.unshift(value);
    state.rouletteHistory = state.rouletteHistory.slice(0, 14);
    const labels = { red: 'К', black: 'Ч', green: 'З' };
    document.getElementById('rouletteRecent').innerHTML = state.rouletteHistory
      .map((c) => `<span class="recent-pill ${c}">${labels[c]}</span>`)
      .join('');
  }
}

/* ============================================================
   РУЛЕТКА
   ============================================================ */

const ROUL_TILE = 84;
const ROUL_STEP = ROUL_TILE + 10;
const ROUL_LOOPS = 6;
const ROUL_WINNER_LOOP = 4;

function renderColorPicker() {
  const picker = document.getElementById('colorPicker');
  picker.innerHTML = state.config.roulette.colors
    .map((c) => `<button class="color-btn ${c.id} ${c.id === state.rouletteColor ? 'selected' : ''}"
        data-color="${c.id}">
        <span>${c.label}</span>
        <small>${c.payout}x · ${c.slots}/15</small>
      </button>`)
    .join('');

  picker.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.rouletteColor = btn.dataset.color;
      haptic('light');
      renderColorPicker();
    });
  });
}

function renderRouletteReel(offsetTiles = 0) {
  const wheel = state.config.roulette.wheel;
  const reel = document.getElementById('rouletteReel');
  const labels = { red: '♦', black: '♠', green: '★' };

  let html = '';
  for (let i = 0; i < wheel.length * ROUL_LOOPS; i++) {
    const color = wheel[i % wheel.length];
    html += `<div class="roulette-tile ${color}">${labels[color]}</div>`;
  }
  reel.innerHTML = html;

  reel.style.transition = 'none';
  reel.style.transform = `translateX(${-offsetTiles * ROUL_STEP}px)`;
}

async function spinRoulette() {
  if (state.busy) return;

  const bet = betValue('rouletteBet');
  if (!bet) { toast('Укажите ставку'); return; }
  if (bet > state.user.balance) {
    toast(`Не хватает ${fmt(bet - state.user.balance)} ед.`);
    haptic('error');
    return;
  }

  state.busy = true;
  document.getElementById('rouletteResult').textContent = '';
  document.getElementById('rouletteSpinBtn').disabled = true;

  let data;
  try {
    data = await api('/api/roulette', { bet, color: state.rouletteColor });
  } catch (err) {
    state.busy = false;
    document.getElementById('rouletteSpinBtn').disabled = false;
    toast(err.message);
    haptic('error');
    return;
  }

  const reel = document.getElementById('rouletteReel');
  const wheelLen = state.config.roulette.wheel.length;

  renderRouletteReel(0);
  void reel.offsetWidth; // reflow, иначе анимация не стартует

  // Выигрышный сектор должен встать под маркер после нескольких оборотов.
  const winnerIndex = ROUL_WINNER_LOOP * wheelLen + data.slot;
  const viewport = reel.parentElement.clientWidth;
  const jitter = (Math.random() - 0.5) * (ROUL_TILE * 0.5);
  const target = winnerIndex * ROUL_STEP + ROUL_TILE / 2 - viewport / 2 + jitter;

  requestAnimationFrame(() => {
    reel.style.transition = 'transform 4.6s cubic-bezier(0.08, 0.7, 0.12, 1)';
    reel.style.transform = `translateX(${-target}px)`;
  });

  haptic('medium');
  const timers = [1000, 2000, 2900, 3500, 3900, 4200, 4400].map((t) =>
    setTimeout(() => haptic('light'), t)
  );

  setTimeout(() => {
    timers.forEach(clearTimeout);

    const box = document.getElementById('rouletteResult');
    const label = state.config.roulette.colors.find((c) => c.id === data.landed)?.label;
    box.textContent = data.won
      ? `${label} — забрали ${fmt(data.payout)} ед.`
      : `${label} — мимо`;
    box.className = `roulette-result ${data.won ? 'win' : 'lose'}`;

    pushRecent('roulette', data.landed);
    applyUser(data.user);
    haptic(data.won ? 'success' : 'error');

    state.busy = false;
    document.getElementById('rouletteSpinBtn').disabled = false;
  }, 4750);
}

document.getElementById('rouletteSpinBtn').addEventListener('click', spinRoulette);

/* ============================================================
   ИСТОРИЯ
   ============================================================ */

async function loadHistory() {
  let history;
  try {
    ({ history } = await api('/api/history'));
  } catch {
    return;
  }

  const list = document.getElementById('historyList');
  if (!history.length) {
    list.innerHTML = '<div class="empty">Пока пусто. Сыграйте первый раунд.</div>';
    return;
  }

  list.innerHTML = history
    .map((h) => {
      const profit = h.payout - h.bet;
      return `<div class="history-row" style="--tier-color:${tierColor(h.tier)}">
        <div class="history-ico">${GAME_ICONS[h.game] || '🎲'}</div>
        <div class="history-main">
          <div class="history-item">${h.subtitle}</div>
          <div class="history-case">${h.title} · ставка ${fmt(h.bet)}</div>
        </div>
        <div class="history-right">
          <div class="history-value">${fmt(h.payout)}</div>
          <div class="history-mult ${profit >= 0 ? 'plus' : 'minus'}">${h.multiplier.toFixed(2)}x</div>
        </div>
      </div>`;
    })
    .join('');
}

/* ============================================================
   ЧЕСТНОСТЬ
   ============================================================ */

function renderFair() {
  const f = state.user.fair;
  document.getElementById('serverHash').textContent = f.serverSeedHash;
  document.getElementById('nonceBox').textContent = f.nonce;
  const input = document.getElementById('clientSeedInput');
  if (document.activeElement !== input) input.value = f.clientSeed;

  if (f.prevServerSeed) {
    document.getElementById('revealedCard').hidden = false;
    document.getElementById('revealedSeed').textContent = f.prevServerSeed;
    document.getElementById('revealedHash').textContent = f.prevServerHash;
  }
}

document.getElementById('saveSeedBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/fair/client-seed', {
      seed: document.getElementById('clientSeedInput').value.trim(),
    });
    state.user = data.user;
    renderFair();
    toast('Client seed сохранён');
    haptic('success');
  } catch (err) {
    toast(err.message);
    haptic('error');
  }
});

document.getElementById('rotateBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/fair/rotate');
    state.user = data.user;
    renderFair();
    toast('Seed сменён, прошлый раскрыт');
    haptic('success');
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById('bonusBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/bonus');
    applyUser(data.user);
    toast(`Начислено ${fmt(data.amount)} ед.`);
    haptic('success');
  } catch (err) {
    toast(err.message);
    haptic('error');
  }
});

/* ============================================================
   НАВИГАЦИЯ И СТАРТ
   ============================================================ */

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Уход с краша во время раунда бросил бы ставку — не пускаем.
    if (state.crash && !state.crash.finished && btn.dataset.view !== 'crash') {
      toast('Сначала закончите раунд краша');
      return;
    }

    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    haptic('light');

    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'fair') renderFair();
    if (btn.dataset.view === 'roulette') renderRouletteReel(2);
  });
});

async function init() {
  try {
    tg?.ready();
    tg?.expand();
    if (tg?.setHeaderColor) tg.setHeaderColor('#0d0318');
    if (tg?.setBackgroundColor) tg.setBackgroundColor('#0d0318');
    if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch { /* обычный браузер — ничего страшного */ }

  buildMoneyRain();

  try {
    const [config, me] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      api('/api/me'),
    ]);

    state.config = config;
    state.user = me.user;
    state.activeCategory = config.categories[0].id;

    renderBalance();
    renderCategories();
    renderCases();
    renderStats();
    renderFair();
    renderColorPicker();
    renderRouletteReel(2);

    wireBetPanel('crashBet', 'data-crash-add', 'data-crash-bet');
    wireBetPanel('rouletteBet', 'data-roul-add', 'data-roul-bet');
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">Не удалось загрузить приложение.<br>${err.message}</div>`;
  }
}

init();
