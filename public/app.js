/**
 * Клиент мини-аппа: кейсы, краш, рулетка, админка.
 *
 * Клиент НЕ решает исход. Он отправляет запрос, получает от сервера готовый
 * результат и лишь проигрывает анимацию. В краше точка взрыва вообще не
 * приходит на клиент до конца раунда.
 */

import {
  iconCases, iconCrash, iconRoulette, iconHistory, iconFair, iconAdmin,
  iconCoin, iconX2, iconGift, iconBolt, iconSearch, iconPlus, iconMinus,
  iconBlock, iconBack, iconTier, iconStar, iconRouletteMark,
} from './icons.js';
import { caseCover } from './covers.js';
import {
  soundEnabled, toggleSound, sndTick, sndSpinStart, sndLand, sndReveal,
  sndBigWin, sndCollect, sndLose, sndFlip, sndBet, sndCrash, sndClimb,
} from './sounds.js';

const tg = window.Telegram?.WebApp;

const state = {
  config: null,
  user: null,
  openingCaseId: null,
  busy: false,
  crash: null,
  rouletteColor: 'red',
  crashHistory: [],
  rouletteHistory: [],
  admin: { tab: 'overview', users: [], query: '' },
};

const ICONS = {
  cases: iconCases, crash: iconCrash, roulette: iconRoulette,
  history: iconHistory, fair: iconFair, admin: iconAdmin,
  coin: iconCoin, x2: iconX2, gift: iconGift, bolt: iconBolt,
  search: iconSearch, plus: iconPlus, minus: iconMinus,
  block: iconBlock, back: iconBack,
};

/** Расставляет иконки во все элементы с data-ico. */
function mountIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach((el) => {
    const fn = ICONS[el.dataset.ico];
    if (fn && !el.firstElementChild) el.innerHTML = fn();
  });
}

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

/**
 * Сумма с символом валюты. Символ добавлен только ради вида — баланс
 * остаётся условными единицами, платежей и вывода в проекте нет.
 */
const money = (n) => fmt(n) + ' ₽';
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const CATEGORY_COLORS = {
  start: '#00d4ff', classic: '#a020ff', themed: '#00ff9d',
  premium: '#ffd60a', elite: '#ff6b35', risk: '#ff1744', bonus: '#ff2e8a',
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
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function haptic(type = 'light') {
  try {
    if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch { /* вне Telegram вибрации нет */ }
}

/** Падающие монеты на фоне — рисуются той же иконкой, что и баланс. */
function buildMoneyRain() {
  const layer = document.getElementById('moneyRain');
  let html = '';
  for (let i = 0; i < 16; i++) {
    const left = Math.random() * 100;
    const dur = 10 + Math.random() * 14;
    const delay = -Math.random() * 24;
    const size = 14 + Math.random() * 16;
    html += `<span class="money-drop" style="left:${left}%;width:${size}px;height:${size}px;
      animation-duration:${dur}s;animation-delay:${delay}s">${iconCoin()}</span>`;
  }
  layer.innerHTML = html;
}

/* ============================================================
   БАЛАНС, ПЛЮШКИ, СТАТИСТИКА
   ============================================================ */

function renderBalance() {
  const chip = document.getElementById('balanceChip');
  document.getElementById('balanceValue').textContent = money(state.user.balance);
  chip.classList.add('bump');
  setTimeout(() => chip.classList.remove('bump'), 260);

  renderPerkBar();
}

/** Плашка с активными плюшками: ×2 и накопленные подарочные кейсы. */
function renderPerkBar() {
  const bar = document.getElementById('perkBar');
  const chips = [];

  if (state.user.x2CaseId) {
    const c = state.config.cases.find((x) => x.id === state.user.x2CaseId);
    chips.push(`<span class="perk-chip"><span data-ico="x2"></span>
      ×2 на «${esc(c?.name || '—')}»</span>`);
  }

  for (const v of state.user.vouchers || []) {
    const c = state.config.cases.find((x) => x.id === v.case_id);
    if (!c) continue;
    // Плашка ведёт на сам кейс: иначе подарок приходится искать по полкам.
    chips.push(`<button class="perk-chip gift" data-goto="${c.id}"><span data-ico="gift"></span>
      «${esc(c.name)}» бесплатно${v.count > 1 ? ` ×${v.count}` : ''}</button>`);
  }

  bar.innerHTML = chips.join('');
  bar.hidden = !chips.length;
  mountIcons(bar);

  bar.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      haptic('light');
      openSheet(el.dataset.goto);
    });
  });
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
      </div>`).join('');
}

function applyUser(user) {
  state.user = user;
  renderBalance();
  renderStats();
  renderCases();
  document.getElementById('navAdmin').hidden = !user.isAdmin;
}

/* ============================================================
   КЕЙСЫ
   ============================================================ */

/**
 * Полки кейсов: ряды по цене, каждый листается вбок.
 *
 * Границы подобраны так, чтобы в ряду выходило 6–9 кейсов: полка короче
 * выглядит куцей, длиннее — заставляет листать слишком долго ради последнего.
 */
const SHELVES = [
  { title: 'Первые шаги', hint: 'С них начинают', max: 200 },
  { title: 'Разогрев', hint: 'Уже интереснее', max: 800 },
  { title: 'Средние ставки', hint: 'Золотая середина', max: 1800 },
  { title: 'Серьёзные', hint: 'Ставки покрупнее', max: 3500 },
  { title: 'Крупные', hint: 'Для уверенных', max: 8000 },
  { title: 'Премиум', hint: 'Лучший RTP в игре', max: 18000 },
  { title: 'Элита', hint: 'Здесь считают тысячами', max: 40000 },
  { title: 'Максимум', hint: 'Дороже в игре нет', max: Infinity },
];

function caseCardHtml(c, vouchers) {
  const color = CATEGORY_COLORS[c.category] || '#a020ff';
  const freeCount = vouchers.get(c.id) || 0;
  const x2 = state.user.x2CaseId === c.id;

  let badge = '';
  if (freeCount) badge = `<span class="cover-badge perk">БЕСПЛАТНО ×${freeCount}</span>`;
  else if (x2) badge = '<span class="cover-badge perk">×2</span>';
  else if (c.hasPerks) badge = '<span class="cover-badge perk">ПЛЮШКИ</span>';
  // Пустой span держит RTP прижатым вправо, когда плюшек у кейса нет.
  else badge = '<span></span>';

  return `<div class="case-card ${freeCount ? 'free-ready' : ''}" data-case="${c.id}"
      style="--cat-color:${color}">
    <div class="case-cover">
      ${caseCover(c)}
      <div class="cover-badges">${badge}
        <span class="cover-badge rtp">${(c.rtp * 100).toFixed(1)}%</span></div>
      <div class="cover-top">до ${fmt(c.topValue)}</div>
    </div>
    <div class="case-name">${esc(c.name)}</div>
    <div class="case-foot">
      <span class="case-price">${freeCount ? 'ПОДАРОК' : money(c.price)}</span>
      <span class="case-max">${c.maxMultiplier}x</span>
    </div>
  </div>`;
}

function renderCases() {
  const root = document.getElementById('caseShelves');
  if (!root) return;

  const vouchers = new Map((state.user.vouchers || []).map((v) => [v.case_id, v.count]));
  const sorted = [...state.config.cases].sort((a, b) => a.price - b.price);

  let from = 0;
  const blocks = [];

  for (const shelf of SHELVES) {
    const items = sorted.filter((c) => c.price > from && c.price <= shelf.max);
    from = shelf.max;
    if (!items.length) continue;

    const lo = items[0].price;
    const hi = items[items.length - 1].price;

    blocks.push(`<section class="shelf">
      <div class="shelf-head">
        <div>
          <h2 class="shelf-title">${shelf.title}</h2>
          <div class="shelf-hint">${shelf.hint}</div>
        </div>
        <div class="shelf-range">${fmt(lo)}${hi !== lo ? ` – ${fmt(hi)}` : ''} ₽</div>
      </div>
      <div class="shelf-row">
        ${items.map((c) => caseCardHtml(c, vouchers)).join('')}
      </div>
    </section>`);
  }

  root.innerHTML = blocks.join('');

  root.querySelectorAll('.case-card').forEach((card) => {
    card.addEventListener('click', () => openSheet(card.dataset.case));
  });
}

function openSheet(caseId) {
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;
  haptic('light');

  const freeCount = (state.user.vouchers || []).find((v) => v.case_id === c.id)?.count || 0;
  const x2 = state.user.x2CaseId === c.id;

  const rows = c.items
    .slice()
    .sort((a, b) => (b.evValue ?? b.value) - (a.evValue ?? a.value))
    .map((it) => {
      const color = tierColor(it.tier);
      const isPerk = it.kind === 'perk';
      return `<div class="item-row" style="--tier-color:${color}">
        <span class="item-ico">${iconTier(it.tier, color)}</span>
        <div class="item-info">
          <div class="item-name">${esc(it.name)}</div>
          <div class="item-mult">${isPerk ? esc(it.perkLabel) : `${it.multiplier}x от цены`}</div>
        </div>
        <div class="item-right">
          <div class="item-value">${isPerk && !it.value ? '—' : money(it.value)}</div>
          <div class="item-chance">${(it.probability * 100).toFixed(3)}%</div>
        </div>
      </div>`;
    }).join('');

  document.getElementById('sheetContent').innerHTML = `
    <div class="sheet-title">${esc(c.name)}</div>
    <div class="sheet-tagline">${esc(c.tagline)}</div>
    <div class="sheet-badges">
      <span class="badge">Цена: <strong>${money(c.price)}</strong></span>
      <span class="badge">RTP: <strong>${(c.rtp * 100).toFixed(2)}%</strong></span>
      <span class="badge">Максимум: <strong>${c.maxMultiplier}x</strong></span>
      ${x2 ? '<span class="badge">Активен: <strong>×2</strong></span>' : ''}
    </div>
    <div class="items-title"><span>Содержимое</span><span>цена / шанс</span></div>
    ${rows}
    <div class="count-row" id="countRow">
      ${[1, 2, 3, 4, 5].slice(0, state.config.maxBatch || 5).map((n) =>
        `<button class="count-btn ${n === 1 ? 'active' : ''}" data-count="${n}">×${n}</button>`).join('')}
    </div>
    <button class="btn btn-primary sheet-open-btn" id="doOpenBtn"></button>
  `;

  const openBtn = document.getElementById('doOpenBtn');
  let count = 1;

  const refresh = () => {
    // Ваучеры покрывают первые открытия пачки, остальное платное.
    const paid = Math.max(0, count - freeCount);
    openBtn.textContent = paid === 0
      ? `ОТКРЫТЬ БЕСПЛАТНО ×${count}`
      : `ОТКРЫТЬ ЗА ${money(paid * c.price)}`;
    openBtn.disabled = paid * c.price > state.user.balance;
  };
  refresh();

  document.querySelectorAll('#countRow .count-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      count = Number(btn.dataset.count);
      document.querySelectorAll('#countRow .count-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      haptic('light');
      refresh();
    });
  });

  document.getElementById('sheetBackdrop').hidden = false;
  openBtn.addEventListener('click', () => {
    closeSheet();
    startOpening(c.id, count);
  });
}

function closeSheet() {
  document.getElementById('sheetBackdrop').hidden = true;
}

document.getElementById('sheetBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'sheetBackdrop') closeSheet();
});

const STRIP_LENGTH = 62;
const WINNER_INDEX = 54;

/**
 * Ширина плитки и шаг берутся из разметки, а не задаются числом.
 *
 * Раньше это были константы, продублированные в CSS. Стоило поменять размер
 * плитки в стилях — и лента доезжала не до той позиции: под маркером
 * оказывался один предмет, а в результате приходил другой. Измерение из DOM
 * убирает саму возможность такого расхождения.
 */
function measureReel(reel) {
  const tiles = reel.children;
  if (!tiles.length) return { tileW: 0, step: 0 };
  const first = tiles[0].getBoundingClientRect();
  const step = tiles.length > 1
    ? tiles[1].getBoundingClientRect().left - first.left
    : first.width;
  return { tileW: first.width, step };
}

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
  const color = tierColor(item.tier);
  return `<div class="reel-tile" style="--tier-color:${color}">
    <div class="tile-icon">${iconTier(item.tier, color)}</div>
    <div class="tile-name">${esc(item.name)}</div>
    <div class="tile-value">${item.kind === 'perk' && !item.value ? iconStar() : money(item.value)}</div>
  </div>`;
}

/** Разметка одной ленты. */
function reelWrapHtml() {
  return `<div class="reel-wrap">
    <div class="reel-marker"></div>
    <div class="reel-fade reel-fade-l"></div>
    <div class="reel-fade reel-fade-r"></div>
    <div class="reel"></div>
  </div>`;
}

/**
 * Щелчки ленты привязаны к её реальному положению, а не к таймеру:
 * когда лента замедляется, щелчки редеют сами — как у настоящего барабана.
 */
function trackReelTicks(reel, step, durationMs) {
  let last = 0;
  const started = performance.now();

  const frame = () => {
    const m = new DOMMatrixReadOnly(getComputedStyle(reel).transform);
    const passed = Math.abs(m.m41) / step;
    if (passed - last >= 1) {
      last = Math.floor(passed);
      sndTick(1 + Math.min(0.5, passed / 400));
    }
    if (performance.now() - started < durationMs) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function startOpening(caseId, count = 1) {
  if (state.busy) return;
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;

  const freeCount = (state.user.vouchers || []).find((v) => v.case_id === c.id)?.count || 0;
  const need = Math.max(0, count - freeCount) * c.price;
  if (need > state.user.balance) {
    toast(`Не хватает ${money(need - state.user.balance)}`);
    haptic('error');
    return;
  }

  state.busy = true;
  state.openingCaseId = caseId;
  state.openingCount = count;

  let data;
  try {
    data = await api('/api/open', { caseId, count });
  } catch (err) {
    state.busy = false;
    toast(err.message);
    haptic('error');
    return;
  }

  const opened = data.opened || [data];

  const opener = document.getElementById('opener');
  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)}${count > 1 ? ` ×${count}` : ''} · ` +
    `<span>${data.totalSpent ? money(data.totalSpent) : 'бесплатно'}</span>`;

  // Число зрителей выдуманное и своё для каждого кейса — чисто оформление.
  document.getElementById('openerViewers').textContent =
    `этот кейс крутят ${viewersFor(c.id)} игроков`;

  document.getElementById('result').hidden = true;
  document.getElementById('gamble').hidden = true;
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  opener.hidden = false;
  document.querySelector('.opener-scroll').scrollTop = 0;
  updateOpenerBalance();
  loadCaseHistory(c.name);

  // Своя лента на каждый кейс пачки — крутятся одновременно.
  const reels = document.getElementById('reels');
  reels.className = 'reels' + (count > 1 ? ' compact' : '');
  reels.innerHTML = opened.map(reelWrapHtml).join('');

  const DURATION = 6.4;
  sndSpinStart();
  sndBet();
  haptic('medium');

  reels.querySelectorAll('.reel').forEach((reel, idx) => {
    // Лента строится из предметов кейса, выигрышный ставится в фиксированную
    // позицию — сервер уже решил исход, анимация лишь доезжает до него.
    const strip = [];
    for (let i = 0; i < STRIP_LENGTH; i++) {
      strip.push(i === WINNER_INDEX ? opened[idx].item : weightedSample(c.items));
    }
    reel.innerHTML = strip.map(tileHtml).join('');

    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0)';
    void reel.offsetWidth;

    const viewport = reel.parentElement.clientWidth;
    const { tileW, step } = measureReel(reel);
    // Сдвиг внутри плитки, но с запасом от краёв: иначе маркер может встать
    // на границу и визуально «зацепить» соседнюю.
    const jitter = (Math.random() - 0.5) * (tileW * 0.5);
    const target = WINNER_INDEX * step + tileW / 2 - viewport / 2 + jitter;

    requestAnimationFrame(() => {
      // Кривая с плавным разгоном: прежняя стартовала на полной скорости,
      // и первые секунды предметы пролетали неразличимо.
      reel.style.transition = `transform ${DURATION}s cubic-bezier(0.32, 0, 0.1, 1)`;
      reel.style.transform = `translateX(${-target}px)`;
    });

    // Щелчки снимаем только с первой ленты — иначе они сливаются в шум.
    if (idx === 0) trackReelTicks(reel, step, DURATION * 1000);
  });

  setTimeout(() => {
    sndLand();
    haptic('medium');
    if (count > 1) showBatchResult(data, c);
    else showCaseResult(data, c);
  }, DURATION * 1000 + 150);
}

/** Итог пачки: список выпавшего и суммарный результат. */
function showBatchResult(data, caseData) {
  const box = document.getElementById('batchSummary');
  const opened = data.opened;
  const net = data.totalWon - data.totalSpent;

  const best = opened.reduce((a, b) => (b.item.value > a.item.value ? b : a));

  box.innerHTML = `
    <div class="batch-total ${net >= 0 ? 'plus' : 'minus'}">
      ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}
    </div>
    <div class="batch-sub">потрачено ${money(data.totalSpent)} · выиграно ${money(data.totalWon)}</div>
    <div class="batch-list">
      ${opened.map((o) => `<div class="mini-row" style="--tier-color:${tierColor(o.item.tier)}">
        <span class="mini-name">${esc(o.item.name)}${o.x2Applied ? ' (×2)' : ''}</span>
        <span class="mini-val">${money(o.item.value)}</span>
      </div>`).join('')}
    </div>
    <div class="result-actions">
      <button class="btn btn-outline" id="batchClose">Забрать</button>
      <button class="btn btn-primary" id="batchAgain">Ещё раз ×${data.count}</button>
    </div>
  `;
  box.hidden = false;

  applyUser(data.user);
  updateOpenerBalance();
  loadCaseHistory(caseData.name);
  state.busy = false;

  sndReveal(best.item.tier);
  if (net > 0) { sndCollect(); haptic('success'); } else { sndLose(); haptic('light'); }

  document.getElementById('batchClose').addEventListener('click', closeOpener);
  document.getElementById('batchAgain').addEventListener('click', () =>
    startOpening(caseData.id, data.count));
}

function showCaseResult(data, caseData) {
  const item = data.item;
  const result = document.getElementById('result');
  result.style.setProperty('--tier-color', tierColor(item.tier));

  document.getElementById('resultTier').textContent = item.kind === 'perk'
    ? (item.perkLabel || 'Плюшка')
    : (state.config.tiers.find((t) => t.id === item.tier)?.label || item.tier);
  document.getElementById('resultName').textContent = item.name;
  document.getElementById('resultValue').textContent =
    item.value ? money(item.value) : '—';

  const net = document.getElementById('resultNet');
  const parts = [];
  if (data.x2Applied) parts.push('множитель ×2 применён');
  for (const g of data.granted || []) {
    if (g.type === 'x2') parts.push('получен ×2 на следующий прокрут');
    if (g.type === 'voucher') parts.push(`подарок: кейс «${g.caseName}»`);
    if (g.type === 'credits') parts.push(`бонус +${fmt(g.amount)}`);
  }
  const netText = data.net >= 0 ? `+${money(data.net)}` : `−${money(Math.abs(data.net))}`;
  net.innerHTML = `${netText}${parts.length ? '<br>' + esc(parts.join(' · ')) : ''}`;
  net.className = `result-net ${data.net >= 0 ? 'plus' : 'minus'}`;

  result.hidden = false;
  applyUser(data.user);
  updateOpenerBalance();
  loadCaseHistory(caseData.name);
  state.busy = false;

  sndReveal(item.tier);
  if (item.multiplier >= 5) sndBigWin();
  if (data.net > 0) { setTimeout(sndCollect, 260); haptic('success'); }
  else { setTimeout(sndLose, 200); haptic('light'); }

  // Рискнуть можно только тем, что реально выиграно на этом прокруте.
  const gambleBtn = document.getElementById('gambleStartBtn');
  const stake = state.user.gambleStake || 0;
  gambleBtn.hidden = stake <= 0;
  if (stake > 0) {
    gambleBtn.textContent = `РИСКНУТЬ ${money(stake)} → ${money(stake * state.config.gamble.payout)}`;
  }

  const freeLeft = (state.user.vouchers || []).find((v) => v.case_id === caseData.id)?.count || 0;
  const againBtn = document.getElementById('againBtn');
  againBtn.disabled = !freeLeft && state.user.balance < caseData.price;
  againBtn.textContent = freeLeft ? 'Ещё раз · бесплатно'
    : againBtn.disabled ? 'Не хватает' : `Ещё раз · ${fmt(caseData.price)}`;
}

/* ---------- Вспомогательное для экрана прокрута ---------- */

/** Выдуманное число зрителей, но стабильное для кейса — чтобы не скакало. */
function viewersFor(caseId) {
  let h = 0;
  for (let i = 0; i < caseId.length; i++) h = (h * 31 + caseId.charCodeAt(i)) >>> 0;
  // Небольшой дрейф по времени, чтобы число выглядело живым.
  return 40 + ((h + Math.floor(Date.now() / 60000)) % 760);
}

function updateOpenerBalance() {
  const el = document.getElementById('openerBalance');
  if (el) el.textContent = money(state.user.balance);
}

/** Последние выпадения игрока именно из этого кейса. */
async function loadCaseHistory(caseTitle) {
  const box = document.getElementById('openerHistory');
  let history;
  try {
    ({ history } = await api('/api/history', { caseTitle, limit: 8 }));
  } catch { return; }

  if (!history.length) {
    box.innerHTML = '<h3><span>Ваши выпадения из этого кейса</span></h3>' +
      '<div class="empty" style="padding:18px">Пока пусто</div>';
    return;
  }

  box.innerHTML = '<h3><span>Ваши выпадения из этого кейса</span>' +
    `<span>${history.length}</span></h3>` +
    history.map((h) => `<div class="mini-row" style="--tier-color:${tierColor(h.tier)}">
      <span class="mini-name">${esc(h.subtitle)}</span>
      <span class="mini-val">${money(h.payout)}</span>
    </div>`).join('');
}

function closeOpener() {
  document.getElementById('opener').hidden = true;
  document.getElementById('gamble').hidden = true;
}

document.getElementById('closeOpener').addEventListener('click', closeOpener);
document.getElementById('closeOpenerTop').addEventListener('click', closeOpener);

/* ============================================================
   РИСК-ИГРА: найди красного туза
   ============================================================ */

const gambleEl = {
  root: () => document.getElementById('gamble'),
  rules: () => document.getElementById('gambleRules'),
  cards: () => document.getElementById('gambleCards'),
  outcome: () => document.getElementById('gambleOutcome'),
};

function renderGamble() {
  const g = state.config.gamble;

  gambleEl.rules().innerHTML =
    `Найдите красного туза среди ${g.cards} карт — выигрыш вырастет в ` +
    `<b>${g.payout} раз</b>. Промах — выигрыш сгорает. ` +
    `Шанс: <b>${g.aces} из ${g.cards}</b> (${(g.chance * 100).toFixed(1)}%).`;

  gambleEl.cards().innerHTML = Array.from({ length: g.cards }, (_, i) =>
    `<button class="gcard" data-idx="${i}">
      <div class="gcard-inner">
        <div class="gcard-face gcard-back">?</div>
        <div class="gcard-face gcard-front blank"></div>
      </div>
    </button>`).join('');

  gambleEl.outcome().textContent = '';
  gambleEl.outcome().className = 'gamble-outcome';

  gambleEl.cards().querySelectorAll('.gcard').forEach((card) => {
    card.addEventListener('click', () => pickGambleCard(Number(card.dataset.idx)));
  });
}

document.getElementById('gambleStartBtn').addEventListener('click', () => {
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('result').hidden = true;
  renderGamble();
  gambleEl.root().hidden = false;
  haptic('medium');
});

async function pickGambleCard(index) {
  if (state.busy) return;
  state.busy = true;

  const cards = [...gambleEl.cards().querySelectorAll('.gcard')];
  cards.forEach((c) => c.classList.add('disabled'));
  cards[index].classList.add('picked');

  let data;
  try {
    data = await api('/api/gamble/pick', { index });
  } catch (err) {
    state.busy = false;
    cards.forEach((c) => c.classList.remove('disabled', 'picked'));
    toast(err.message);
    haptic('error');
    return;
  }

  // Сначала переворачивается выбранная карта, затем — все остальные,
  // чтобы было видно, где на самом деле лежал туз.
  const setFace = (i) => {
    const front = cards[i].querySelector('.gcard-front');
    const isAce = i === data.acePosition;
    front.className = 'gcard-face gcard-front ' + (isAce ? 'ace' : 'blank');
    // Пустая карта получает свой знак: без него вскрытая карта выглядит
    // ровно как ещё не перевёрнутая, и непонятно, что раздача уже показана.
    front.innerHTML = isAce ? iconStar('#fff') : '<span class="gcard-empty"></span>';
    cards[i].classList.add('flipped');
  };

  setFace(index);
  sndFlip();
  haptic(data.won ? 'success' : 'error');

  setTimeout(() => {
    cards.forEach((_, i) => {
      if (i !== index) setTimeout(() => { setFace(i); sndFlip(); }, i * 90);
    });

    setTimeout(() => {
      const out = gambleEl.outcome();
      out.textContent = data.won
        ? `Есть туз! Забираете ${money(data.payout)}`
        : `Мимо. Туз был на карте ${data.acePosition + 1}`;
      out.className = 'gamble-outcome ' + (data.won ? 'win' : 'lose');
      if (data.won) { sndBigWin(); sndCollect(); } else sndLose();

      applyUser(data.user);
      updateOpenerBalance();
      loadCaseHistory(state.config.cases.find((c) => c.id === state.openingCaseId)?.name);

      // Рисковать больше нечем — кнопка становится выходом из раздачи.
      const btn = document.getElementById('gambleSkipBtn');
      btn.textContent = 'Продолжить';
      btn.dataset.done = '1';
      state.busy = false;
    }, cards.length * 90 + 400);
  }, 700);
}

document.getElementById('gambleSkipBtn').addEventListener('click', async (e) => {
  const done = e.currentTarget.dataset.done === '1';
  if (!done) {
    // Отказ от риска: ставку надо снять, иначе она осталась бы висеть.
    try { await api('/api/gamble/skip'); } catch { /* не критично */ }
    const me = await api('/api/me').catch(() => null);
    if (me) applyUser(me.user);
  }
  delete e.currentTarget.dataset.done;
  e.currentTarget.textContent = 'Забрать без риска';
  gambleEl.root().hidden = true;
  document.getElementById('result').hidden = false;
  document.getElementById('gambleStartBtn').hidden = true;
  updateOpenerBalance();
});

document.getElementById('againBtn').addEventListener('click', () => {
  if (state.openingCaseId) startOpening(state.openingCaseId, state.openingCount || 1);
});

/* ============================================================
   ПАНЕЛИ СТАВОК
   ============================================================ */

function betValue(inputId) {
  const v = Math.floor(Number(document.getElementById(inputId).value));
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

/**
 * Система координат графика берётся из самого SVG. Держать её числом в коде
 * означало бы третью копию тех же размеров — ровно так лента кейса и разошлась
 * с разметкой.
 */
const [GRAPH_W, GRAPH_H] = (() => {
  const vb = document.getElementById('crashGraph')?.getAttribute('viewBox');
  const parts = (vb || '0 0 300 140').split(/\s+/).map(Number);
  return [parts[2], parts[3]];
})();

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
  crashEl.area().setAttribute('points',
    `0,${GRAPH_H} ${line} ${((elapsedMs / xMax) * GRAPH_W).toFixed(1)},${GRAPH_H}`);

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
    toast(`Не хватает ${money(bet - state.user.balance)}`);
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
  sndBet();
  haptic('medium');

  runCrashLoop();
  pollCrashState();
}

function runCrashLoop() {
  const round = state.crash;
  if (!round || round.finished) return;

  const elapsed = Date.now() - round.localStart;
  const m = Math.exp((state.config.crash.growth * elapsed) / 1000);

  crashEl.multiplier().textContent = `${m.toFixed(2)}x`;
  crashEl.multiplier().style.color = crashColorFor(m);
  crashEl.btn().textContent = `ЗАБРАТЬ ${fmt(Math.floor(round.bet * m))}`;
  drawCrashGraph(elapsed, m);

  // Тон ползёт вверх вместе с множителем, но не чаще раза в ~250 мс.
  if (elapsed - (round.lastClimb || 0) > 250) {
    round.lastClimb = elapsed;
    sndClimb(m);
  }

  round.raf = requestAnimationFrame(runCrashLoop);
}

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

  if (data.status === 'cashed') {
    mult.textContent = `${data.cashedAt.toFixed(2)}x`;
    mult.className = 'crash-multiplier cashed';
    mult.style.color = '';
    status.className = 'crash-status win';
    status.textContent = `Забрали ${money(data.payout)} · взорвалось на ${data.crashPoint.toFixed(2)}x`;
    sndCollect();
    haptic('success');
  } else {
    mult.textContent = `${data.crashPoint.toFixed(2)}x`;
    mult.className = 'crash-multiplier busted';
    mult.style.color = '';
    status.className = 'crash-status lose';
    status.textContent = `Взорвалось. Ставка ${money(round.bet)} потеряна`;
    sndCrash();
    haptic('error');
  }
  pushRecent('crash', data.crashPoint);

  crashEl.rocket().classList.remove('flying');
  crashEl.btn().classList.remove('cashout');
  crashEl.btn().textContent = 'ПОСТАВИТЬ';

  if (data.user) applyUser(data.user);
  state.crash = null;
  state.busy = false;
}

crashEl.btn().addEventListener('click', () => {
  if (state.crash && !state.crash.finished) cashoutCrash();
  else startCrash();
});

function pushRecent(game, value) {
  if (game === 'crash') {
    state.crashHistory.unshift(value);
    state.crashHistory = state.crashHistory.slice(0, 14);
    document.getElementById('crashRecent').innerHTML = state.crashHistory
      .map((v) => `<span class="recent-pill ${v < 2 ? 'low' : v < 10 ? 'mid' : 'high'}">${v.toFixed(2)}x</span>`)
      .join('');
  } else {
    state.rouletteHistory.unshift(value);
    state.rouletteHistory = state.rouletteHistory.slice(0, 14);
    const labels = { red: 'К', black: 'Ч', green: 'З' };
    document.getElementById('rouletteRecent').innerHTML = state.rouletteHistory
      .map((c) => `<span class="recent-pill ${c}">${labels[c]}</span>`).join('');
  }
}

/* ============================================================
   РУЛЕТКА
   ============================================================ */

const ROUL_LOOPS = 6;
const ROUL_WINNER_LOOP = 4;

function renderColorPicker() {
  const picker = document.getElementById('colorPicker');
  picker.innerHTML = state.config.roulette.colors
    .map((c) => `<button class="color-btn ${c.id} ${c.id === state.rouletteColor ? 'selected' : ''}"
        data-color="${c.id}"><span>${c.label}</span><small>${c.payout}x · ${c.slots}/15</small></button>`)
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
  // Метки секторов — собственные SVG, а не типографские символы: так они
  // одинаково выглядят на всех платформах и красятся под цвет сектора.

  let html = '';
  for (let i = 0; i < wheel.length * ROUL_LOOPS; i++) {
    const color = wheel[i % wheel.length];
    html += `<div class="roulette-tile ${color}">${iconRouletteMark(color)}</div>`;
  }
  reel.innerHTML = html;
  reel.style.transition = 'none';
  const { step } = measureReel(reel);
  reel.style.transform = `translateX(${-offsetTiles * step}px)`;
}

async function spinRoulette() {
  if (state.busy) return;

  const bet = betValue('rouletteBet');
  if (!bet) { toast('Укажите ставку'); return; }
  if (bet > state.user.balance) {
    toast(`Не хватает ${money(bet - state.user.balance)}`);
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
  void reel.offsetWidth;

  const winnerIndex = ROUL_WINNER_LOOP * wheelLen + data.slot;
  const viewport = reel.parentElement.clientWidth;
  const { tileW, step } = measureReel(reel);
  const jitter = (Math.random() - 0.5) * (tileW * 0.45);
  const target = winnerIndex * step + tileW / 2 - viewport / 2 + jitter;

  requestAnimationFrame(() => {
    reel.style.transition = 'transform 5.4s cubic-bezier(0.32, 0, 0.1, 1)';
    reel.style.transform = `translateX(${-target}px)`;
  });

  sndSpinStart();
  sndBet();
  haptic('medium');
  const timers = [800, 1600, 2300, 2900, 3400, 3900, 4300, 4700, 5000, 5200]
    .map((t) => setTimeout(() => { haptic('light'); sndTick(); }, t));

  setTimeout(() => {
    timers.forEach(clearTimeout);
    const box = document.getElementById('rouletteResult');
    const label = state.config.roulette.colors.find((c) => c.id === data.landed)?.label;
    box.textContent = data.won ? `${label} — забрали ${money(data.payout)}` : `${label} — мимо`;
    box.className = `roulette-result ${data.won ? 'win' : 'lose'}`;

    pushRecent('roulette', data.landed);
    applyUser(data.user);
    sndLand();
    if (data.won) { sndReveal(data.landed === 'green' ? 'unique' : 'epic'); sndCollect(); }
    else sndLose();
    haptic(data.won ? 'success' : 'error');

    state.busy = false;
    document.getElementById('rouletteSpinBtn').disabled = false;
  }, 5550);
}

document.getElementById('rouletteSpinBtn').addEventListener('click', spinRoulette);

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
  } catch (err) { toast(err.message); haptic('error'); }
});

document.getElementById('rotateBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/fair/rotate');
    state.user = data.user;
    renderFair();
    toast('Seed сменён, прошлый раскрыт');
    haptic('success');
  } catch (err) { toast(err.message); }
});


/* ============================================================
   АДМИНКА
   ============================================================ */

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(2)}%`);

async function loadAdminOverview() {
  let d;
  try { d = await api('/api/admin/overview'); }
  catch (err) { toast(err.message); return; }

  const kpis = [
    { label: 'Игроков', value: fmt(d.users.total), sub: `активных: ${fmt(d.users.active || 0)}` },
    { label: 'Раундов', value: fmt(d.rounds.total) },
    { label: 'Поставлено', value: fmt(d.rounds.wagered) },
    { label: 'Выплачено', value: fmt(d.rounds.paid) },
    {
      label: 'Прибыль заведения',
      value: `${d.rounds.profit >= 0 ? '+' : ''}${fmt(d.rounds.profit)}`,
      cls: d.rounds.profit >= 0 ? 'plus' : 'minus',
      sub: `фактический RTP: ${pct(d.rounds.rtp)}`,
    },
    { label: 'Единиц на руках', value: fmt(d.users.balance), sub: `заблокировано: ${fmt(d.users.blocked || 0)}` },
  ];

  const gameRows = d.byGame.map((g) => `<tr>
      <td>${({ case: 'Кейсы', crash: 'Краш', roulette: 'Рулетка' })[g.game] || g.game}</td>
      <td class="num">${fmt(g.rounds)}</td>
      <td class="num">${fmt(g.wagered)}</td>
      <td class="num">${fmt(g.profit)}</td>
      <td class="num">${pct(g.rtp)}</td>
    </tr>`).join('');

  const winRows = d.topWins.map((w) => `<tr>
      <td>${esc(w.username || w.first_name || w.user_id)}</td>
      <td>${esc(w.subtitle)}</td>
      <td class="num">${fmt(w.payout)}</td>
    </tr>`).join('');

  document.getElementById('admin-overview').innerHTML = `
    <div class="admin-kpis">
      ${kpis.map((k) => `<div class="kpi">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls || ''}">${k.value}</div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
      </div>`).join('')}
    </div>

    <h2 class="section-title">За сутки</h2>
    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Раундов</div><div class="kpi-value">${fmt(d.today.rounds)}</div></div>
      <div class="kpi"><div class="kpi-label">Игроков</div><div class="kpi-value">${fmt(d.today.players)}</div></div>
      <div class="kpi"><div class="kpi-label">Поставлено</div><div class="kpi-value">${fmt(d.today.wagered)}</div></div>
      <div class="kpi"><div class="kpi-label">Прибыль</div>
        <div class="kpi-value ${d.today.profit >= 0 ? 'plus' : 'minus'}">${fmt(d.today.profit)}</div></div>
    </div>

    <h2 class="section-title">По играм</h2>
    <table class="admin-table">
      <thead><tr><th>Игра</th><th class="num">Раундов</th><th class="num">Ставки</th>
        <th class="num">Прибыль</th><th class="num">RTP</th></tr></thead>
      <tbody>${gameRows || '<tr><td colspan="5">Нет данных</td></tr>'}</tbody>
    </table>

    <h2 class="section-title">Крупнейшие выигрыши</h2>
    <table class="admin-table">
      <thead><tr><th>Игрок</th><th>Что</th><th class="num">Выплата</th></tr></thead>
      <tbody>${winRows || '<tr><td colspan="3">Нет данных</td></tr>'}</tbody>
    </table>
  `;

  renderAdminFeed(d.recent);
}

function renderAdminFeed(recent) {
  document.getElementById('admin-feed').innerHTML = recent.length
    ? recent.map((r) => {
        const profit = r.payout - r.bet;
        return `<div class="history-row" style="--tier-color:${profit >= 0 ? 'var(--green)' : 'var(--line)'}">
          <div class="history-main">
            <div class="history-item">${esc(r.subtitle)}</div>
            <div class="history-case">${esc(r.username || r.first_name || ('#' + r.user_id))}
              · ${esc(r.title)} · ${r.free ? 'подарок' : fmt(r.bet)}</div>
          </div>
          <div class="history-right">
            <div class="history-value">${fmt(r.payout)}</div>
            <div class="history-mult ${profit >= 0 ? 'plus' : 'minus'}">${r.multiplier.toFixed(2)}x</div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Пока нет раундов</div>';
}

async function loadAdminUsers() {
  let d;
  try { d = await api('/api/admin/users', { query: state.admin.query }); }
  catch (err) { toast(err.message); return; }

  state.admin.users = d.rows;
  const list = document.getElementById('adminUserList');

  list.innerHTML = d.rows.length ? d.rows.map((u) => {
    const name = u.username ? '@' + u.username : (u.first_name || 'Без имени');
    const letter = (u.first_name || u.username || '?').trim().charAt(0).toUpperCase();
    return `<div class="user-row ${u.is_blocked ? 'blocked' : ''}" data-user="${u.id}">
      <div class="user-avatar">${esc(letter)}</div>
      <div class="user-main">
        <div class="user-name">${esc(name)}${u.is_admin ? ' <span class="admin-tag">АДМИН</span>' : ''}</div>
        <div class="user-meta">ID ${u.tg_id} · раундов ${fmt(u.total_rounds)}
          · RTP ${u.total_spent ? ((u.total_won / u.total_spent) * 100).toFixed(0) + '%' : '—'}</div>
      </div>
      <div class="user-bal">${fmt(u.balance)}</div>
    </div>`;
  }).join('') : '<div class="empty">Никого не найдено</div>';

  list.querySelectorAll('.user-row').forEach((row) => {
    row.addEventListener('click', () => openAdminUser(Number(row.dataset.user)));
  });
}

async function openAdminUser(userId) {
  let d;
  try { d = await api('/api/admin/user', { userId }); }
  catch (err) { toast(err.message); return; }

  const u = d.user;
  const name = u.username ? '@' + u.username : (u.first_name || 'Без имени');

  const logRows = d.log.map((l) => {
    const labels = { credit: 'Начислено', debit: 'Списано', block: 'Заблокирован',
                     unblock: 'Разблокирован', voucher: 'Выдан кейс' };
    return `<div class="log-row">
      <span>${labels[l.action] || l.action}${l.note ? ` · ${esc(l.note)}` : ''}</span>
      <b class="${l.amount > 0 ? 'plus' : l.amount < 0 ? 'minus' : ''}">${l.amount ? fmt(l.amount) : ''}</b>
    </div>`;
  }).join('');

  const histRows = d.history.slice(0, 12).map((h) => `<div class="log-row">
      <span>${esc(h.title)} · ${esc(h.subtitle)}</span>
      <b class="${h.payout >= h.bet ? 'plus' : 'minus'}">${fmt(h.payout - h.bet)}</b>
    </div>`).join('');

  const detail = document.getElementById('adminDetail');
  detail.innerHTML = `
    <div class="detail-head">
      <button class="btn btn-outline" id="detailBack"><span data-ico="back"></span></button>
      <div style="flex:1">
        <div class="user-name" style="font-size:19px">${esc(name)}</div>
        <div class="user-meta">Telegram ID ${u.tg_id} · внутренний #${u.id}</div>
      </div>
    </div>

    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Баланс</div><div class="kpi-value">${fmt(u.balance)}</div></div>
      <div class="kpi"><div class="kpi-label">Раундов</div><div class="kpi-value">${fmt(u.total_rounds)}</div></div>
      <div class="kpi"><div class="kpi-label">Поставил</div><div class="kpi-value">${fmt(u.total_spent)}</div></div>
      <div class="kpi"><div class="kpi-label">Выиграл</div><div class="kpi-value">${fmt(u.total_won)}</div></div>
      <div class="kpi"><div class="kpi-label">Его RTP</div>
        <div class="kpi-value">${u.total_spent ? ((u.total_won / u.total_spent) * 100).toFixed(1) + '%' : '—'}</div></div>
      <div class="kpi"><div class="kpi-label">Прибыль с него</div>
        <div class="kpi-value ${u.total_spent - u.total_won >= 0 ? 'plus' : 'minus'}">
          ${fmt(u.total_spent - u.total_won)}</div></div>
    </div>

    <h2 class="section-title">Изменить баланс</h2>
    <div class="amount-row">
      <input class="seed-input" id="adjAmount" type="number" inputmode="numeric" placeholder="сумма">
      <input class="seed-input" id="adjNote" placeholder="комментарий" maxlength="200">
    </div>
    <div class="admin-actions">
      <button class="btn btn-primary" id="adjPlus"><span data-ico="plus"></span> Начислить</button>
      <button class="btn btn-outline" id="adjMinus"><span data-ico="minus"></span> Списать</button>
    </div>

    <h2 class="section-title">Подарочный кейс</h2>
    <div class="amount-row">
      <select class="seed-input" id="voucherCase">
        ${state.config.cases.map((c) => `<option value="${c.id}">${esc(c.name)} · ${fmt(c.price)}</option>`).join('')}
      </select>
      <input class="seed-input" id="voucherCount" type="number" value="1" min="1" max="100" style="max-width:80px">
    </div>
    <button class="btn btn-outline btn-wide" id="grantVoucher">Выдать кейс</button>

    <h2 class="section-title">Доступ</h2>
    <button class="btn ${u.is_blocked ? 'btn-primary' : 'btn-outline'} btn-wide" id="toggleBlock">
      <span data-ico="block"></span> ${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
    </button>

    ${d.vouchers.length ? `<h2 class="section-title">Подарки на руках</h2>
      ${d.vouchers.map((v) => `<div class="log-row"><span>${esc(
        state.config.cases.find((c) => c.id === v.case_id)?.name || v.case_id)}</span>
        <b>×${v.count}</b></div>`).join('')}` : ''}

    <h2 class="section-title">Действия администраторов</h2>
    ${logRows || '<div class="empty">Пока ничего</div>'}

    <h2 class="section-title">Последние раунды</h2>
    ${histRows || '<div class="empty">Пока ничего</div>'}
  `;

  detail.hidden = false;
  mountIcons(detail);

  document.getElementById('detailBack').addEventListener('click', () => { detail.hidden = true; });

  const adjust = async (sign) => {
    const raw = Math.abs(Math.trunc(Number(document.getElementById('adjAmount').value)));
    if (!raw) { toast('Укажите сумму'); return; }
    try {
      await api('/api/admin/balance', {
        userId, amount: sign * raw,
        note: document.getElementById('adjNote').value,
      });
      toast(sign > 0 ? `Начислено ${fmt(raw)}` : `Списано ${fmt(raw)}`);
      haptic('success');
      openAdminUser(userId);
      loadAdminUsers();
    } catch (err) { toast(err.message); haptic('error'); }
  };

  document.getElementById('adjPlus').addEventListener('click', () => adjust(1));
  document.getElementById('adjMinus').addEventListener('click', () => adjust(-1));

  document.getElementById('grantVoucher').addEventListener('click', async () => {
    try {
      await api('/api/admin/voucher', {
        userId,
        caseId: document.getElementById('voucherCase').value,
        count: Number(document.getElementById('voucherCount').value) || 1,
      });
      toast('Кейс выдан');
      haptic('success');
      openAdminUser(userId);
    } catch (err) { toast(err.message); haptic('error'); }
  });

  document.getElementById('toggleBlock').addEventListener('click', async () => {
    try {
      await api('/api/admin/block', { userId, blocked: !u.is_blocked });
      toast(u.is_blocked ? 'Разблокирован' : 'Заблокирован');
      openAdminUser(userId);
      loadAdminUsers();
    } catch (err) { toast(err.message); haptic('error'); }
  });
}

document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.admin.tab = btn.dataset.adminTab;
    document.querySelectorAll('[data-admin-tab]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.admin-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`admin-${state.admin.tab}`).classList.add('active');
    if (state.admin.tab === 'users') loadAdminUsers();
    haptic('light');
  });
});

document.getElementById('adminSearchBtn').addEventListener('click', () => {
  state.admin.query = document.getElementById('adminSearch').value.trim();
  loadAdminUsers();
});

/* ============================================================
   НАВИГАЦИЯ И СТАРТ
   ============================================================ */

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (state.crash && !state.crash.finished && btn.dataset.view !== 'crash') {
      toast('Сначала закончите раунд краша');
      return;
    }

    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    window.scrollTo({ top: 0 });
    haptic('light');

    if (btn.dataset.view === 'fair') renderFair();
    if (btn.dataset.view === 'roulette') renderRouletteReel(2);
    if (btn.dataset.view === 'admin') loadAdminOverview();
  });
});

async function init() {
  try {
    tg?.ready();
    tg?.expand();
    if (tg?.setHeaderColor) tg.setHeaderColor('#0d0318');
    if (tg?.setBackgroundColor) tg.setBackgroundColor('#0d0318');
    if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch { /* обычный браузер */ }

  mountIcons();
  buildMoneyRain();

  const soundBtn = document.getElementById('soundBtn');
  const paintSound = () => {
    soundBtn.textContent = soundEnabled() ? 'ЗВУК ВКЛ' : 'ЗВУК ВЫКЛ';
    soundBtn.classList.toggle('off', !soundEnabled());
  };
  paintSound();
  soundBtn.addEventListener('click', () => { toggleSound(); paintSound(); });

  try {
    const [config, me] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      api('/api/me'),
    ]);

    state.config = config;
    state.user = me.user;
    renderColorPicker();
    renderRouletteReel(2);
    applyUser(me.user);
    renderFair();

    wireBetPanel('crashBet', 'data-crash-add', 'data-crash-bet');
    wireBetPanel('rouletteBet', 'data-roul-add', 'data-roul-bet');
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">Не удалось загрузить приложение.<br>${esc(err.message)}</div>`;
  }
}

init();
