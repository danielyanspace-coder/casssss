/**
 * Клиент мини-аппа.
 *
 * Клиент НЕ решает, что выпадет. Он отправляет запрос, получает от сервера
 * готовый предмет и лишь прокручивает ленту до него. Любые правки в консоли
 * меняют только картинку, но не результат и не баланс.
 */

const tg = window.Telegram?.WebApp;

const state = {
  config: null,
  user: null,
  activeCategory: null,
  openingCaseId: null,
  busy: false,
};

/* ---------- Работа с API ---------- */

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
  if (!res.ok) {
    throw new Error(data.message || data.error || `Ошибка ${res.status}`);
  }
  return data;
}

/* ---------- Утилиты ---------- */

const fmt = (n) => Number(n).toLocaleString('ru-RU');

const TIER_ICONS = {
  common: '▪', uncommon: '◆', rare: '✦', epic: '✧',
  legendary: '★', mythic: '☀', unique: '♛',
};

const CATEGORY_COLORS = {
  start: '#4b74ff', classic: '#8b5cf6', highroll: '#ffb020', risk: '#f43f5e',
};

function tierColor(tier) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--t-${tier}`).trim() || '#8a94a6';
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
    if (type === 'success' || type === 'error') {
      tg?.HapticFeedback?.notificationOccurred(type);
    } else {
      tg?.HapticFeedback?.impactOccurred(type);
    }
  } catch { /* вне Telegram вибрации просто нет */ }
}

/* ---------- Отрисовка баланса и статистики ---------- */

function renderBalance() {
  const chip = document.getElementById('balanceChip');
  document.getElementById('balanceValue').textContent = fmt(state.user.balance);
  chip.classList.add('bump');
  setTimeout(() => chip.classList.remove('bump'), 260);

  const row = document.getElementById('bonusRow');
  const limit = state.config.bonus.balanceLimit;
  row.hidden = state.user.balance > limit;
  document.getElementById('bonusHint').textContent =
    `Начислим ${fmt(state.config.bonus.amount)} ед., не чаще раза в ${state.config.bonus.cooldownMin} мин.`;
}

function renderStats() {
  const s = state.user.stats;
  const profit = s.profit;
  const cards = [
    { label: 'Открыто кейсов', value: fmt(s.opened) },
    { label: 'Лучший множитель', value: s.bestMultiplier ? `${s.bestMultiplier}x` : '—' },
    { label: 'Потрачено', value: fmt(s.spent) },
    { label: 'Выиграно', value: fmt(s.won) },
    {
      label: 'Итог',
      value: `${profit >= 0 ? '+' : ''}${fmt(profit)}`,
      cls: profit > 0 ? 'plus' : profit < 0 ? 'minus' : '',
    },
    {
      label: 'Ваш фактический RTP',
      value: s.spent ? `${((s.won / s.spent) * 100).toFixed(1)}%` : '—',
    },
  ];

  document.getElementById('statsGrid').innerHTML = cards
    .map(
      (c) => `<div class="stat-card">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value ${c.cls || ''}">${c.value}</div>
      </div>`
    )
    .join('');
}

/* ---------- Категории и кейсы ---------- */

function renderCategories() {
  const tabs = document.getElementById('categoryTabs');
  tabs.innerHTML = state.config.categories
    .map(
      (c) =>
        `<button class="tab ${c.id === state.activeCategory ? 'active' : ''}" data-cat="${c.id}">${c.name}</button>`
    )
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
      const color = CATEGORY_COLORS[c.category] || '#6c5ce7';
      return `<div class="case-card" data-case="${c.id}" style="--cat-color:${color}">
        <div class="case-art"><div class="case-box">📦</div></div>
        <div class="case-name">${c.name}</div>
        <div class="case-tagline">${c.tagline}</div>
        <div class="case-meta">
          <span class="case-price">${fmt(c.price)}</span>
          <span class="case-rtp">RTP ${(c.rtp * 100).toFixed(1)}%</span>
        </div>
      </div>`;
    })
    .join('');

  grid.querySelectorAll('.case-card').forEach((card) => {
    card.addEventListener('click', () => openSheet(card.dataset.case));
  });
}

/* ---------- Шторка с составом кейса ---------- */

function openSheet(caseId) {
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;

  haptic('light');

  const rows = c.items
    .slice()
    .sort((a, b) => b.value - a.value)
    .map(
      (it) => `<div class="item-row" style="--tier-color:${tierColor(it.tier)}">
        <span class="item-dot"></span>
        <div class="item-info">
          <div class="item-name">${it.name}</div>
          <div class="item-mult">${it.multiplier}x от цены</div>
        </div>
        <div class="item-right">
          <div class="item-value">${fmt(it.value)}</div>
          <div class="item-chance">${(it.probability * 100).toFixed(3)}%</div>
        </div>
      </div>`
    )
    .join('');

  document.getElementById('sheetContent').innerHTML = `
    <div class="sheet-head">
      <div style="flex:1">
        <div class="sheet-title">${c.name}</div>
        <div class="sheet-tagline">${c.tagline}</div>
      </div>
    </div>
    <div class="sheet-badges">
      <span class="badge">Цена: <strong>${fmt(c.price)} ед.</strong></span>
      <span class="badge">RTP: <strong>${(c.rtp * 100).toFixed(2)}%</strong></span>
      <span class="badge">Максимум: <strong>${c.maxMultiplier}x</strong></span>
      <span class="badge">Предметов: <strong>${c.items.length}</strong></span>
    </div>
    <div class="items-title"><span>Содержимое</span><span>цена / шанс</span></div>
    ${rows}
    <button class="btn btn-primary sheet-open-btn" id="doOpenBtn">
      Открыть за ${fmt(c.price)} ед.
    </button>
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

/* ---------- Открытие кейса ---------- */

const TILE_WIDTH = 120;
const TILE_GAP = 10;
const TILE_STEP = TILE_WIDTH + TILE_GAP;
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

  // Сервер уже определил предмет — дальше только анимация до него.
  const opener = document.getElementById('opener');
  const reel = document.getElementById('reel');
  const result = document.getElementById('result');

  document.getElementById('openerCaseName').textContent = `${c.name} · ${fmt(c.price)} ед.`;
  result.hidden = true;
  opener.hidden = false;

  const strip = [];
  for (let i = 0; i < STRIP_LENGTH; i++) {
    strip.push(i === WINNER_INDEX ? data.item : weightedSample(c.items));
  }
  reel.innerHTML = strip.map(tileHtml).join('');

  // Сбрасываем ленту в начало без анимации.
  reel.style.transition = 'none';
  reel.style.transform = 'translateX(0)';
  void reel.offsetWidth; // принудительный reflow, иначе браузер склеит стили

  const viewport = reel.parentElement.clientWidth;
  // Небольшой сдвиг внутри плитки — чтобы остановка не всегда была ровно по центру.
  const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.55);
  const target = WINNER_INDEX * TILE_STEP + TILE_WIDTH / 2 - viewport / 2 + jitter;

  requestAnimationFrame(() => {
    reel.style.transition = 'transform 5.6s cubic-bezier(0.09, 0.72, 0.13, 1)';
    reel.style.transform = `translateX(${-target}px)`;
  });

  haptic('medium');

  // Тиканье по мере замедления — оживляет прокрутку.
  const ticks = [1200, 2400, 3300, 4000, 4500, 4900, 5200, 5400];
  const timers = ticks.map((t) => setTimeout(() => haptic('light'), t));

  setTimeout(() => {
    timers.forEach(clearTimeout);
    showResult(data, c);
  }, 5750);
}

function showResult(data, caseData) {
  const item = data.item;
  const color = tierColor(item.tier);
  const tierLabel =
    state.config.tiers.find((t) => t.id === item.tier)?.label || item.tier;

  const result = document.getElementById('result');
  result.style.setProperty('--tier-color', color);
  document.getElementById('resultTier').textContent = tierLabel;
  document.getElementById('resultName').textContent = item.name;
  document.getElementById('resultValue').textContent = `${fmt(item.value)} ед.`;

  const net = document.getElementById('resultNet');
  net.textContent =
    data.net >= 0
      ? `+${fmt(data.net)} ед. к балансу · ${item.multiplier}x`
      : `${fmt(data.net)} ед. · ${item.multiplier}x`;
  net.className = `result-net ${data.net >= 0 ? 'plus' : 'minus'}`;

  result.hidden = false;

  state.user = data.user;
  renderBalance();
  renderStats();
  state.busy = false;

  haptic(data.net > 0 ? 'success' : 'light');

  const againBtn = document.getElementById('againBtn');
  againBtn.disabled = state.user.balance < caseData.price;
  againBtn.textContent =
    state.user.balance < caseData.price
      ? 'Не хватает средств'
      : `Ещё раз · ${fmt(caseData.price)}`;
}

document.getElementById('closeOpener').addEventListener('click', () => {
  document.getElementById('opener').hidden = true;
  loadHistory();
});

document.getElementById('againBtn').addEventListener('click', () => {
  if (state.openingCaseId) startOpening(state.openingCaseId);
});

/* ---------- История ---------- */

async function loadHistory() {
  let history;
  try {
    ({ history } = await api('/api/history'));
  } catch {
    return;
  }

  const list = document.getElementById('historyList');
  if (!history.length) {
    list.innerHTML = '<div class="empty">Пока пусто. Откройте первый кейс.</div>';
    return;
  }

  list.innerHTML = history
    .map((h) => {
      const profit = h.item_value - h.price;
      return `<div class="history-row" style="--tier-color:${tierColor(h.item_tier)}">
        <div class="history-main">
          <div class="history-item">${h.item_name}</div>
          <div class="history-case">${h.case_name} · ${fmt(h.price)} ед.</div>
        </div>
        <div class="history-right">
          <div class="history-value">${fmt(h.item_value)}</div>
          <div class="history-mult ${profit >= 0 ? 'plus' : 'minus'}">
            ${h.multiplier.toFixed(2)}x
          </div>
        </div>
      </div>`;
    })
    .join('');
}

/* ---------- Честность ---------- */

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
  const seed = document.getElementById('clientSeedInput').value.trim();
  try {
    const data = await api('/api/fair/client-seed', { seed });
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

/* ---------- Бонус ---------- */

document.getElementById('bonusBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/bonus');
    state.user = data.user;
    renderBalance();
    renderStats();
    toast(`Начислено ${fmt(data.amount)} ед.`);
    haptic('success');
  } catch (err) {
    toast(err.message);
    haptic('error');
  }
});

/* ---------- Навигация ---------- */

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    haptic('light');

    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'fair') renderFair();
  });
});

/* ---------- Старт ---------- */

async function init() {
  try {
    tg?.ready();
    tg?.expand();
    if (tg?.setHeaderColor) tg.setHeaderColor('#0a0b14');
    if (tg?.setBackgroundColor) tg.setBackgroundColor('#0a0b14');
    if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch { /* обычный браузер — ничего страшного */ }

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
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">Не удалось загрузить приложение.<br>${err.message}</div>`;
  }
}

init();
