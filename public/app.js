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
  iconGrid, iconKey, iconPeople, iconMail, iconTelegram,
} from './icons.js';
import { caseCover, porschePhotoSrc, caseArtSrc } from './covers.js';
import { itemArt } from './item-art.js';
import { coinMark, coinColor } from './coin-art.js';
import { COMPANY, LICENSE, DOCS, footerHtml } from './legal.js';
import {
  sndTick, sndSpinStart, sndLand, sndReveal,
  sndBigWin, sndCollect, sndLose, sndFlip, sndBet, sndCrash, sndClimb,
  sndPurchase, sndRetrigger, sndFirework, sndJackpot,
} from './sounds.js';

const tg = window.Telegram?.WebApp;
const BEELINE_LOGO_SRC = window.__BEELINE_SRC || '/assets/banks/beeline.webp';

const state = {
  config: null,
  user: null,
  openingCaseId: null,
  busy: false,
  crash: null,
  rouletteColor: 'red',
  crashHistory: [],
  rouletteHistory: [],
  view: 'cases',
  admin: { tab: 'overview', users: [], query: '', funnelDays: 7 },
  paymentBank: 'sber', paymentTimer: null, payment: null,
  withdrawMethod: 'sbp',
};

const ICONS = {
  cases: iconCases, crash: iconCrash, roulette: iconRoulette,
  history: iconHistory, fair: iconFair, admin: iconAdmin,
  coin: iconCoin, x2: iconX2, gift: iconGift, bolt: iconBolt,
  search: iconSearch, plus: iconPlus, minus: iconMinus,
  block: iconBlock, back: iconBack, grid: iconGrid,
  key: iconKey, people: iconPeople, mail: iconMail, telegram: iconTelegram,
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
 * Склонение существительного по числу: 1 активация, 2 активации, 5 активаций.
 * Без него счётчики читаются как машинный вывод.
 */
function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/** Сумма с символом валюты. */
const money = (n) => fmt(n) + ' ₽';
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const CATEGORY_COLORS = {
  start: '#00d4ff', classic: '#a020ff', themed: '#00ff9d',
  premium: '#ffd60a', elite: '#ff6b35', risk: '#ff1744', bonus: '#ff2e8a',
  country: '#00d4ff', got: '#c9a227',
};

function tierColor(tier) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--t-${tier}`).trim() || '#9d8bb0';
}

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.classList.remove('toast-action');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

// Тост с кнопкой живёт дольше обычного: по нему нужно принять решение, а не
// просто прочитать. 2.8 секунды на это мало.
const ACTION_TOAST_MS = 6000;

/** Тост, из которого можно сразу что-то сделать. */
function toastAction(message, label, onClick) {
  const el = document.getElementById('toast');
  el.classList.add('toast-action');
  el.innerHTML = `<span></span><button class="btn btn-primary toast-btn"></button>`;
  el.querySelector('span').textContent = message;
  const btn = el.querySelector('button');
  btn.textContent = label;
  btn.onclick = () => { el.hidden = true; onClick(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ACTION_TOAST_MS);
}

/**
 * Упор в нехватку средств.
 *
 * Раньше здесь был обычный тост, и на этом всё заканчивалось: игрок узнавал,
 * что денег нет, и оставался на том же экране. Касса лежит в меню, за двумя
 * нажатиями, и до неё доходили единицы. Теперь путь туда - одна кнопка.
 */
function needMoney(need) {
  haptic('error');
  track('no_funds');
  toastAction(`Не хватает ${money(need)}`, 'Пополнить', () => {
    track('no_funds_to_cashier');
    openCashier();
  });
}

/**
 * Отправка события аналитики. Намеренно без await и без обработки ошибок:
 * счётчик не имеет права задержать нажатие или сломать экран, ради которого
 * его и вызывают.
 */
function track(name) {
  try { api('/api/track', { name }).catch(() => {}); } catch { /* не мешаем игре */ }
}

/** Касса с сразу открытой вкладкой пополнения. */
function openCashier() {
  switchView('wallet');
  const pane = document.getElementById('walletDepositPane');
  if (pane) {
    document.getElementById('walletWithdrawPane').hidden = true;
    pane.hidden = false;
  }
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
   ПРАЗДНИЧНЫЕ ЭФФЕКТЫ
   ============================================================ */

/**
 * Эффекты собраны здесь, а не разбросаны по местам вызова, чтобы событие
 * можно было выбрать одной строкой и чтобы разные события не начали выглядеть
 * одинаково: у каждого свой набор цветов, форма и длительность.
 *
 * Слой чистится по таймеру: узлы эффектов живут ровно столько, сколько идёт
 * их анимация, и не копятся в разметке.
 */
const FX_PALETTES = {
  gold: ['#ffd60a', '#ff9b2e', '#fff3b0'],
  neon: ['#00d4ff', '#a020ff', '#ff2e8a'],
  green: ['#00ff9d', '#00d4ff', '#c9ff6b'],
  fire: ['#ff6b35', '#ff1744', '#ffd60a'],
};

function fxLayer() {
  return document.getElementById('fxLayer');
}

function fxAdd(node, lifeMs) {
  const layer = fxLayer();
  if (!layer) return;
  layer.appendChild(node);
  setTimeout(() => node.remove(), lifeMs);
}

const fxPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Салют: несколько залпов искр из случайных точек верхней половины экрана. */
function fxFirework({ bursts = 4, palette = 'gold' } = {}) {
  const colors = FX_PALETTES[palette] || FX_PALETTES.gold;

  for (let b = 0; b < bursts; b++) {
    setTimeout(() => {
      const cx = 15 + Math.random() * 70;
      const cy = 18 + Math.random() * 34;
      const count = 16 + Math.floor(Math.random() * 10);
      const color = fxPick(colors);

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 70 + Math.random() * 90;
        const el = document.createElement('span');
        el.className = 'fx-spark';
        el.style.left = `${cx}%`;
        el.style.top = `${cy}%`;
        el.style.setProperty('--fx-color', color);
        el.style.setProperty('--fx-x', `${Math.cos(angle) * dist}px`);
        el.style.setProperty('--fx-y', `${Math.sin(angle) * dist}px`);
        el.style.setProperty('--fx-dur', `${0.9 + Math.random() * 0.5}s`);
        fxAdd(el, 1600);
      }
    }, b * 190 + Math.random() * 80);
  }
}

/** Конфетти: падает сверху, дольше салюта - под длинные моменты. */
function fxConfetti({ count = 60, palette = 'neon' } = {}) {
  const colors = FX_PALETTES[palette] || FX_PALETTES.neon;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx-confetti';
    el.style.left = `${Math.random() * 100}%`;
    el.style.setProperty('--fx-color', fxPick(colors));
    el.style.setProperty('--fx-dur', `${1.8 + Math.random() * 1.6}s`);
    el.style.setProperty('--fx-spin', `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720)}deg`);
    el.style.animationDelay = `${Math.random() * 0.6}s`;
    // Часть конфетти делаем узкой - иначе всё сыплется одинаковыми кирпичами.
    if (Math.random() > 0.6) el.style.width = '5px';
    fxAdd(el, 4200);
  }
}

/** Вспышка на весь экран. Короткая, только чтобы отметить момент. */
function fxFlash(color = 'rgba(255, 214, 10, 0.45)') {
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.setProperty('--fx-color', color);
  fxAdd(el, 800);
}

/** Крупная надпись поверх экрана. */
function fxShout(text, sub = '', color = '#ffd60a', hold = 0) {
  const el = document.createElement('div');
  el.className = 'fx-shout';
  el.style.setProperty('--fx-color', color);
  // Надпись держится дольше за счёт паузы в середине анимации, а не за счёт
  // её растягивания: иначе вместе с показом замедлились бы вылет и уход.
  if (hold) el.style.setProperty('--fx-hold', `${hold}ms`);
  el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  fxAdd(el, 1700 + hold);
}

/**
 * Празднование покупки серии.
 *
 * Вынесено отдельно от остальных поводов, потому что это единственное место,
 * где эффект не сопровождает событие, а занимает экран сам: игрок только что
 * заплатил заметные деньги, и ему нужно отдать за них зрелище, прежде чем
 * поедет первая лента. Отсюда и длительность - около двух с половиной секунд.
 */
const PURCHASE_FX_MS = 2600;

function fxPurchase(count) {
  fxShout('FREE SPINS', `${count} прокрутов`, '#ffd60a', 1200);

  // Салют идёт волнами, а не одним залпом: один залп в начале отгремел бы за
  // полсекунды, и дальше надпись висела бы на пустом экране.
  const waves = [
    { at: 0,    bursts: 3, palette: 'gold' },
    { at: 620,  bursts: 2, palette: 'neon' },
    { at: 1180, bursts: 3, palette: 'fire' },
    { at: 1760, bursts: 2, palette: 'green' },
    { at: 2180, bursts: 3, palette: 'gold' },
  ];
  for (const w of waves) {
    setTimeout(() => {
      fxFirework({ bursts: w.bursts, palette: w.palette });
      sndFirework(w.bursts);
      haptic('light');
    }, w.at);
  }

  fxFlash('rgba(255, 214, 10, 0.42)');
  setTimeout(() => fxFlash('rgba(160, 32, 255, 0.3)'), 1180);
  setTimeout(() => fxConfetti({ count: 70, palette: 'gold' }), 320);
  setTimeout(() => fxShout('ПОЕХАЛИ', 'серия начинается', '#00ff9d'), 1750);
}

/**
 * Празднование по поводу.
 *
 * Каждый повод звучит и выглядит по-своему: покупка - золото и фанфары,
 * ретриггер - огонь и дребезг, крупный выигрыш - масштаб зависит от того,
 * насколько он крупный. Один общий эффект на всё быстро приедается.
 */
function celebrate(kind, payload = {}) {
  if (kind === 'purchase') {
    sndPurchase();
    fxPurchase(payload.count);
    haptic('success');

  } else if (kind === 'retrigger') {
    sndRetrigger();
    fxFlash('rgba(255, 107, 53, 0.45)');
    fxFirework({ bursts: 2, palette: 'fire' });
    fxShout('+' + payload.added, 'ещё прокруты!', '#ff6b35');
    haptic('success');

  } else if (kind === 'jackpot') {
    // Самый крупный повод: длинная тема, конфетти и салют вместе.
    sndJackpot();
    fxFlash('rgba(255, 214, 10, 0.6)');
    fxConfetti({ count: 90, palette: 'gold' });
    fxFirework({ bursts: 6, palette: 'gold' });
    fxShout('ДЖЕКПОТ', payload.text || '', '#ffd60a');
    haptic('success');

  } else if (kind === 'bigwin') {
    sndFirework(3);
    sndBigWin();
    fxConfetti({ count: 55, palette: 'neon' });
    fxShout(payload.text || 'КРУПНЫЙ ВЫИГРЫШ', payload.sub || '', '#00ff9d');
    haptic('success');

  } else if (kind === 'win') {
    // Скромный повод: без надписей и конфетти, только искры.
    sndFirework(2);
    fxFirework({ bursts: 2, palette: 'green' });
    haptic('light');
  }
}

/**
 * Выбирает силу празднования по множителю выигрыша.
 * Пороги подобраны так, чтобы «джекпот» не срабатывал каждую минуту.
 */
function celebrateWin(multiplier, value) {
  if (multiplier >= 50) {
    celebrate('jackpot', { text: money(value) });
  } else if (multiplier >= 12) {
    celebrate('bigwin', { text: money(value), sub: `×${Math.round(multiplier)}` });
  } else if (multiplier >= 4) {
    celebrate('win');
  }
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
  renderWelcomeOffer();
}

/**
 * Предложение первого пополнения на первом экране.
 *
 * Показывается, пока игрок ни разу не пополнял. Стартового баланса больше нет,
 * и без этого блока новый игрок открывает приложение, видит нули и не понимает,
 * с чего начать: кассу надо ещё найти в меню.
 *
 * Условия берём с сервера, а не пишем в клиенте: процент меняют чаще, чем код.
 */
function renderWelcomeOffer() {
  const el = document.getElementById('welcomeOffer');
  if (!el) return;

  const rules = state.config?.firstDeposit;
  const shown = rules && rules.pct > 0
    && state.user && !state.user.depositsCount;

  el.hidden = !shown;
  if (!shown) return;

  const cap = rules.max > 0 ? ` до ${money(rules.max)}` : '';
  el.innerHTML = `
    <div class="wo-title">Первое пополнение +${rules.pct}%${cap}</div>
    <div class="wo-sub">Бонус начисляется сразу. Отыграть его нужно
      ${rules.wager}-кратной суммой ставок, минимальное пополнение ${money(rules.min)}.</div>
    <span class="wo-go">Пополнить</span>
  `;
  el.onclick = () => { haptic('light'); openCashier(); };
}

/** Плашка с активными плюшками: ×2 и накопленные подарочные кейсы. */
function renderPerkBar() {
  const bar = document.getElementById('perkBar');
  const chips = [];

  // Удвоители копятся по кейсам: у одного игрока их может быть несколько и на
  // разные кейсы. Показываем каждый кейс отдельной плашкой со счётчиком.
  for (const p of state.user.x2Perks || []) {
    const c = state.config.cases.find((x) => x.id === p.case_id);
    chips.push(`<span class="perk-chip"><span data-ico="x2"></span>
      ×2 на «${esc(c?.name || '-')}»${p.count > 1 ? ` · ${p.count}` : ''}</span>`);
  }

  // Выигранных кейсов здесь нет намеренно: их место в «Бонусах». Полоса над
  // полками разрасталась на несколько строк и отжимала сами кейсы вниз.

  bar.innerHTML = chips.join('');
  bar.hidden = !chips.length;
  mountIcons(bar);

  bar.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      haptic('light');
      openCase(el.dataset.goto);
    });
  });
}

function applyUser(user) {
  state.user = user;
  renderBalance();
  renderCases();
  renderMenu();
  renderSideNav();
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
/**
 * Тематические полки собраны по идее, а не по цене, поэтому в ценовую сетку
 * они не встают. Каждая привязана к ценовой полке, ПОСЛЕ которой её показать:
 * коллекция должна попадаться игроку рано, а не в хвосте длинного списка.
 */
const THEMED_SHELVES = [
  {
    after: 'Первые шаги',
    category: 'country',
    cls: 'shelf-country',
    title: 'Направления',
    hint: 'Города, куда хочется попасть',
  },
  {
    after: 'Разогрев',
    category: 'got',
    cls: 'shelf-got',
    title: 'Игра престолов',
    hint: 'Семь Королевств и всё, что в них',
  },
];

const SHELVES = [
  { title: 'Первые шаги', hint: 'С них начинают', max: 200 },
  { title: 'Разогрев', hint: 'Уже интереснее', max: 800 },
  { title: 'Средние ставки', hint: 'Золотая середина', max: 1800 },
  { title: 'Серьёзные', hint: 'Ставки покрупнее', max: 3500 },
  { title: 'Крупные', hint: 'Для уверенных', max: 8000 },
  { title: 'Премиум', hint: 'Ставки посерьёзнее', max: 18000 },
  { title: 'Элита', hint: 'Здесь считают тысячами', max: 40000 },
  { title: 'Максимум', hint: 'Дороже в игре нет', max: Infinity },
];

/** Сезонный кейс до даты старта только показывается, но не открывается. */
function lockedUntil(c) {
  if (!c.availableFrom || Date.now() >= c.availableFrom) return null;
  return new Date(c.availableFrom).toLocaleDateString('ru-RU',
    { day: 'numeric', month: 'long' });
}

function caseCardHtml(c, vouchers, artAspect = null) {
  const color = CATEGORY_COLORS[c.category] || '#a020ff';
  const freeCount = vouchers.get(c.id) || 0;
  const x2 = (state.user.x2Perks || []).some((p) => p.case_id === c.id);
  const locked = lockedUntil(c);
  let badge = '';
  if (locked) badge = `<span class="cover-badge soon">С ${locked.toUpperCase()}</span>`;
  else if (freeCount) badge = `<span class="cover-badge perk">БЕСПЛАТНО ×${freeCount}</span>`;
  else if (x2) badge = '<span class="cover-badge perk">×2</span>';

  /*
   * Карточка с присланным артом верстается принципиально иначе.
   *
   * У рисованной обложки есть собственный фон, она заполняет слот от края до
   * края, и карточка вокруг неё нужна как оправа. Присланный арт - это
   * вырезанная композиция на прозрачном фоне: оправа ей мешает, потому что
   * рамка обводит пустоту вокруг рисунка, а не сам рисунок.
   *
   * Поэтому здесь снимается всё, что рисовало бы вокруг арта прямоугольник:
   * рамка и подложка карточки (в стилях), а из разметки уходят бейджи,
   * подпись «до N» и чип с множителем - они ложились поверх картинки и
   * читались как наклейки на ней. Остаются только название и цена под артом.
   */
  const hasArt = Boolean(c.art) && c.art !== 'porsche';

  // Тона свечения приходят с обложкой (см. tools/case-covers.mjs). Категорийный
  // цвет остаётся запасным вариантом - для кейсов без присланного арта.
  const glow = c.artGlow
    ? `;--art-glow:hsl(${c.artGlow[0]} 95% 58% / 0.5)`
      + `;--art-glow-far:hsl(${c.artGlow[1]} 90% 60% / 0.42)`
    : '';

  return `<div class="case-card ${hasArt ? 'has-art' : ''} ${freeCount ? 'free-ready' : ''} ${locked ? 'locked' : ''}"
      data-case="${c.id}" style="--cat-color:${color}${
        artAspect ? `;--art-ar:${artAspect}` : ''}${glow}">
    <div class="case-cover">
      ${caseCover(c)}
      ${hasArt ? '' : `<div class="cover-badges">${badge}</div>
      <div class="cover-top">до ${fmt(c.topValue)}</div>`}
    </div>
    <div class="case-name">${esc(c.name)}</div>
    <div class="case-foot">
      <span class="case-price">${freeCount && !locked ? 'ПОДАРОК' : money(c.price)}</span>
      ${hasArt ? '' : `<span class="case-max">${c.maxMultiplier}x</span>`}
    </div>
  </div>`;
}

/**
 * Витрина сезонного кейса — широкая карточка под шапкой.
 *
 * Закрытый кейс здесь не гасим, иначе главное место на экране занимает серое
 * пятно. О том, что он ещё не открылся, говорят плашка с датой и подпись на
 * кнопке.
 *
 * У кейса с готовым баннером на обложке уже есть и заголовок, и плашка
 * «сезонный кейс», поэтому свои подписи карточка не рисует: осталась только
 * дата старта — её баннер знать не может. Потолок выигрыша переехал в нижнюю
 * строку, чтобы не перекрывать макет.
 */
function featuredHtml(c, vouchers) {
  const locked = lockedUntil(c);
  const freeCount = vouchers.get(c.id) || 0;
  const ownArt = Boolean(c.art);

  const badges = [
    ownArt ? '' : '<span class="featured-tag">СЕЗОННЫЙ КЕЙС</span>',
    locked ? `<span class="featured-date">С ${locked.toUpperCase()}</span>` : '',
  ].filter(Boolean).join('');

  return `<section class="featured">
    <div class="featured-card ${locked ? 'is-locked' : ''} ${ownArt ? 'own-art' : ''}"
        data-case="${c.id}">
      ${badges ? `<div class="featured-badges">${badges}</div>` : ''}
      <div class="featured-cover">
        ${caseCover(c)}
        <div class="featured-shine"></div>
        ${ownArt ? '' : `<div class="featured-top">до ${fmt(c.topValue)} ₽</div>`}
      </div>
      <div class="featured-body">
        <div class="featured-name">${esc(c.name)}</div>
        <div class="featured-sub">${esc(c.tagline)}</div>
        <div class="featured-foot">
          <span class="featured-price">${freeCount && !locked ? 'ПОДАРОК' : money(c.price)}</span>
          <span class="featured-max">${c.maxMultiplier}x</span>
          ${ownArt ? `<span class="featured-chip">до ${fmt(c.topValue)} ₽</span>` : ''}
        </div>
      </div>
    </div>
  </section>`;
}

function renderCases() {
  const root = document.getElementById('caseShelves');
  if (!root) return;

  const vouchers = new Map((state.user.vouchers || []).map((v) => [v.case_id, v.count]));
  const all = [...state.config.cases].sort((a, b) => a.price - b.price);

  // Сезонный кейс идёт витриной над полками, поэтому из общего списка его
  // убираем — иначе он попал бы в полку по цене ещё и вторым экземпляром.
  const featured = all.find((c) => c.availableFrom);

  // Тематические кейсы вынуты из ценовой сетки: они собраны по идее, и разброс
  // цен внутри такой полки как раз уместен.
  const themed = THEMED_SHELVES.map((t) => ({
    ...t,
    cases: all.filter((c) => c.category === t.category),
  }));
  const themedIds = new Set(themed.flatMap((t) => t.cases.map((c) => c.id)));

  const sorted = all.filter((c) => c !== featured && !themedIds.has(c.id));

  /*
   * Высота слота под арт задаётся пропорцией, а не пикселями.
   *
   * Обложки разной ориентации: городские вертикальные, престольные
   * горизонтальные, на ценовых полках попадаются почти квадратные. Общее
   * число пикселей либо срезало бы высокие, либо оставляло под низкими пустую
   * полосу.
   *
   * Пропорция считается по паре соседей в ряду, а не по всей полке. Сетка в
   * два столбца, и выровнять подписи нужно только между соседями. Раньше
   * бралась самая «высокая» обложка полки, и одна вертикальная картинка
   * поднимала слот всему ряду: у «Разогрева» из-за «Миража» под заголовком
   * оставалась пустая полоса в треть высоты карточки - арт прижат к низу
   * слота, а сверху пусто.
   */
  const pairAspect = (items, i) => {
    const pair = i % 2 === 0 ? [items[i], items[i + 1]] : [items[i - 1], items[i]];
    const arts = pair.map((c) => c?.artAspect).filter(Boolean);
    return arts.length ? Math.min(...arts) : null;
  };

  const shelfHtml = (cls, title, hint, items) => `<section class="shelf ${cls}">
      <div class="shelf-head">
        <div>
          <h2 class="shelf-title">${title}</h2>
          <div class="shelf-hint">${hint}</div>
        </div>
        <div class="shelf-range">${fmt(items[0].price)}${
          items[items.length - 1].price !== items[0].price
            ? ` - ${fmt(items[items.length - 1].price)}` : ''} ₽</div>
      </div>
      <div class="shelf-row">
        ${items.map((c, i) => caseCardHtml(c, vouchers, pairAspect(items, i))).join('')}
      </div>
    </section>`;

  let from = 0;
  const blocks = [];

  if (featured) blocks.push(featuredHtml(featured, vouchers));

  for (const shelf of SHELVES) {
    const items = sorted.filter((c) => c.price > from && c.price <= shelf.max);
    from = shelf.max;
    if (items.length) blocks.push(shelfHtml('', shelf.title, shelf.hint, items));

    // Тематическая полка идёт сразу за своей ценовой. Привязка именно к
    // названию, а не к номеру: полки переставляют чаще, чем переименовывают.
    for (const t of themed) {
      if (t.after === shelf.title && t.cases.length) {
        blocks.push(shelfHtml(t.cls, t.title, t.hint, t.cases));
      }
    }
  }

  root.innerHTML = blocks.join('');

  root.querySelectorAll('.case-card, .featured-card').forEach((card) => {
    card.addEventListener('click', () => openCase(card.dataset.case));
  });
}

/**
 * Экран «Бонусы»: кейсы, выигранные в подарок (ваучеры), и активный ×2 —
 * та же плюшка, что и в плашке над полками, только с собственным экраном,
 * куда можно вернуться позже, если не открыл сразу.
 */
function renderBonuses() {
  const perks = document.getElementById('bonusPerks');
  const list = document.getElementById('bonusList');
  if (!list) return;

  if (perks) {
    perks.innerHTML = '';
    perks.innerHTML = (state.user.x2Perks || []).map((p) => {
      const c = state.config.cases.find((x) => x.id === p.case_id);
      return c ? `<span class="perk-chip"><span data-ico="x2"></span>
        ×2 на «${esc(c.name)}»${p.count > 1 ? ` · ${p.count}` : ''}</span>` : '';
    }).join('');
    perks.hidden = !perks.innerHTML;
    mountIcons(perks);
  }

  /*
   * Один выигранный кейс - одна карточка.
   *
   * Раньше повторы схлопывались в одну карточку с числом рядом, и три
   * одинаковых подарка выглядели как один: приписка ×3 у карточки с артом не
   * показывается вовсе. Теперь каждый экземпляр стоит отдельно и его видно
   * пересчётом, а не чтением мелкой цифры.
   */
  const cards = (state.user.vouchers || [])
    .flatMap((v) => {
      const c = state.config.cases.find((x) => x.id === v.case_id);
      return c && v.count > 0 ? Array.from({ length: v.count }, () => c) : [];
    });

  if (!cards.length) {
    list.innerHTML = '<div class="empty" style="grid-column:1/-1">Пока нет выигранных кейсов - '
      + 'они появятся здесь, когда выпадут в подарок из других кейсов.</div>';
    return;
  }

  // Здесь пары складываются из того, что выиграно, поэтому пропорция берётся
  // по соседу так же, как на полках.
  list.innerHTML = cards
    .map((c, i) => {
      const pair = i % 2 === 0 ? [cards[i], cards[i + 1]] : [cards[i - 1], cards[i]];
      const arts = pair.map((x) => x?.artAspect).filter(Boolean);
      return caseCardHtml(c, new Map([[c.id, 1]]), arts.length ? Math.min(...arts) : null);
    })
    .join('');

  list.querySelectorAll('.case-card').forEach((card) => {
    card.addEventListener('click', () => openCase(card.dataset.case));
  });
}

/**
 * Экран кейса.
 *
 * Раньше состав показывался шторкой снизу, а лента появлялась только после
 * нажатия. Теперь это один экран: сверху лента в покое, под ней кнопка
 * прокрута, а ещё ниже — сетка того, что может выпасть, от дорогого к
 * дешёвому. Так видно и содержимое, и сам барабан до первого открытия.
 */
/**
 * Тематическое оформление экрана кейса.
 *
 * Раньше экран открытия был одинаковый у всех кейсов: один и тот же
 * фиолетовый фон, одни и те же акценты. Теперь он собирается из самого кейса -
 * из его обложки.
 *
 * Берутся два числа, которые уже посчитаны по картинке при её подготовке
 * (см. tools/case-covers.mjs): ближний и дальний тон обложки. Ими красится
 * фон, рамка барабана, маркер и блок фриспинов. Сама обложка уезжает в фон
 * дважды: размытой вполнеба - она и даёт цвет воздуху, - и чёткой в углу,
 * приглушённым водяным знаком.
 *
 * Ничего из этого не прописано под конкретный кейс. Поменяется обложка -
 * поменяются и тона, потому что считаются они из неё же.
 */
function applyCaseTheme(c) {
  const opener = document.getElementById('opener');
  const layer = document.getElementById('openerTheme');
  const src = caseArtSrc(c);

  if (!src || !c.artGlow) {
    opener.classList.remove('is-themed');
    opener.style.removeProperty('--case-h1');
    opener.style.removeProperty('--case-h2');
    layer.innerHTML = '';
    return;
  }

  opener.style.setProperty('--case-h1', c.artGlow[0]);
  opener.style.setProperty('--case-h2', c.artGlow[1]);
  opener.classList.add('is-themed');
  layer.innerHTML = `<img class="opener-theme-wash" src="${src}" alt="" decoding="async">`
    + `<img class="opener-theme-mark" src="${src}" alt="" decoding="async">`;
}

function openCase(caseId) {
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;
  haptic('light');

  applyCaseTheme(c);
  state.openingCaseId = caseId;
  const freeCount = (state.user.vouchers || []).find((v) => v.case_id === c.id)?.count || 0;
  const locked = lockedUntil(c);

  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>${money(c.price)}</span>`;
  document.getElementById('openerViewers').textContent =
    `этот кейс крутят ${viewersFor(c.id)} игроков`;

  // До первого нажатия: у кейса с обрядом на экране стоит он сам, у
  // остальных - лента в покое, барабан собран, но никуда не едет.
  if (hasRitual(c)) renderCaseStage(c);
  else { clearCaseStage(); renderIdleReel(c); }

  // Витринный предмет идёт первой карточкой и честно подписан.
  const showcaseCard = c.showcase ? `
    <div class="drop-card is-showcase" style="--tier-color:${tierColor(c.showcase.tier)}">
      <div class="drop-ico">${itemArt(c.showcase.name, tierColor(c.showcase.tier))
        || iconTier(c.showcase.tier, tierColor(c.showcase.tier))}</div>
      <div class="drop-name">${esc(c.showcase.name)}</div>
      <div class="drop-note">${esc(c.showcase.note)}</div>
    </div>` : '';

  const cards = c.items
    .slice()
    .sort((a, b) => (b.evValue ?? b.value) - (a.evValue ?? a.value))
    .map((it) => {
      const color = tierColor(it.tier);
      const isPerk = it.kind === 'perk';
      return `<div class="drop-card" style="--tier-color:${color}">
        <div class="drop-ico">${itemArt(it.name, color) || iconTier(it.tier, color)}</div>
        <div class="drop-name">${esc(it.name)}</div>
        <div class="drop-value">${isPerk && !it.value ? esc(it.perkLabel) : money(it.value)}</div>
      </div>`;
    }).join('');

  document.getElementById('dropsGrid').innerHTML = showcaseCard + cards;
  document.getElementById('dropsCount').textContent = `${c.items.length} предметов`;

  document.getElementById('countRow').innerHTML =
    [1, 2, 3, 4, 5].slice(0, state.config.maxBatch || 5).map((k) =>
      `<button class="count-btn ${k === 1 ? 'active' : ''}" data-count="${k}">×${k}</button>`).join('');

  document.getElementById('autoRow').innerHTML =
    '<span class="auto-row-label">Авто</span>' +
    AUTO_COUNTS.map((k) => `<button class="auto-btn ${k === 0 ? 'active' : ''}"
      data-auto="${k}">${k === 0 ? 'выкл' : k}</button>`).join('');

  renderFreeSpinBuy(c, locked);

  const openBtn = document.getElementById('doOpenBtn');
  let count = 1;
  let auto = 0;

  const refresh = () => {
    if (locked) {
      openBtn.textContent = `ОТКРОЕТСЯ ${locked.toUpperCase()}`;
      openBtn.disabled = true;
      return;
    }

    // Автооткрытие крутит кейс по одному, поэтому выбор пачки в этом режиме
    // не имеет смысла - строку количества гасим, чтобы не обещать лишнего.
    document.getElementById('countRow').style.opacity = auto ? '0.35' : '';
    document.getElementById('countRow').style.pointerEvents = auto ? 'none' : '';

    if (auto) {
      openBtn.textContent = `ОТКРЫТЬ ${auto} РАЗ ПОДРЯД`;
      openBtn.disabled = !freeCount && c.price > state.user.balance;
      return;
    }

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
      // Выбранный икс виден сразу, до нажатия «Открыть», а не выясняется
      // после списания: у обычного кейса перерисовываются барабаны, у кейса с
      // обрядом - кейсы на сцене.
      if (hasRitual(c)) renderCaseStage(c, count);
      else renderIdleReel(c, count);
      refresh();
    });
  });

  document.querySelectorAll('#autoRow .auto-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      auto = Number(btn.dataset.auto);
      document.querySelectorAll('#autoRow .auto-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      haptic('light');
      // Автооткрытие крутит по одному кейсу, поэтому и на экране снова один.
      if (auto) {
        if (hasRitual(c)) renderCaseStage(c, 1);
        else renderIdleReel(c, 1);
      }
      refresh();
    });
  });

  openBtn.onclick = () => (auto ? runAutoOpen(c.id, auto) : startOpening(c.id, count));

  document.getElementById('result').hidden = true;
  document.getElementById('gamble').hidden = true;
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  document.getElementById('freespins').hidden = true;
  document.getElementById('fsCollect').hidden = true;
  document.getElementById('autoPanel').hidden = true;
  document.getElementById('casePanel').hidden = false;

  document.getElementById('opener').hidden = false;
  document.querySelector('.opener-scroll').scrollTop = 0;
  updateOpenerBalance();
  loadCaseHistory(c.name);
  resumePendingSpins(c);
}

/**
 * Доигрывает серию фриспинов, которую игрок не досмотрел в прошлый раз.
 *
 * Выигрыш за неё уже был зачислен, поэтому здесь только показ: баланс во
 * время такого прокрута не трогаем. Без этого купленная серия, из которой
 * игрок вышел, просто исчезала - деньги списаны, прокрутов нет.
 */
async function resumePendingSpins(c) {
  if (state.busy) return;

  let pending;
  try { ({ pending } = await api('/api/freespins/pending')); }
  catch { return; }

  if (!pending || pending.caseId !== c.id) return;
  if (state.busy || state.openingCaseId !== c.id) return;

  state.busy = true;
  document.getElementById('casePanel').hidden = true;
  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>незавершённая серия</span>`;

  toast('Доигрываем прошлую серию фриспинов');
  await runFreeSpins(pending.grant, c, { replay: true });

  state.busy = false;
  document.getElementById('casePanel').hidden = false;
  if (hasRitual(c)) renderCaseStage(c);
  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>${money(c.price)}</span>`;
}

/**
 * Обряд открытия: кейс на сцене вместо ленты.
 *
 * Раньше экран кейса сразу открывался лентой: она стояла на месте и ничего не
 * значила, пока не нажмёшь. Теперь до первого нажатия на экране стоит сам
 * кейс - его обложка, - а лента появляется только после того, как кейс
 * тряхнуло и из-под него пошла пыль. Открытие перестаёт быть нажатием кнопки
 * и становится событием.
 *
 * ПОЧЕМУ УСЛОВИЕ - ОБЛОЖКА, А НЕ СПИСОК КЕЙСОВ. Обряд положен всем, и держать
 * для этого флаг у каждого из 68 описаний значит однажды забыть его новому
 * кейсу. Единственное, что обряду действительно нужно, - вырезанная обложка,
 * которую можно трясти: она же даёт и цвет пыли. Есть обложка - есть обряд.
 *
 * Не проходит по этому условию ровно один кейс - сезонный «Porsche»: его
 * обложка нарисована готовым широким баннером, а не предметом на прозрачном
 * фоне. Трясти баннер незачем, и там остаётся прежняя лента в покое.
 */
function hasRitual(c) {
  return !!caseArtSrc(c);
}

/** Сколько трясётся кейс перед тем, как появится лента. */
const RITUAL_SHAKE_MS = 1150;

/** Сколько кейс уходит со сцены, уступая место ленте. */
const RITUAL_EXIT_MS = 260;

/**
 * Ставит кейсы на сцену и убирает ленту.
 *
 * Кейсов ровно столько, сколько откроется: выбрал ×3 - и на сцене стоят три.
 * Это то же правило, что было у лент до обряда: сколько иксов, столько и
 * барабанов. Без него иксы на экране кейса с обрядом ничего не меняли, и что
 * они значат, приходилось выяснять уже на своих деньгах.
 */
function renderCaseStage(c, count = 1) {
  const stage = document.getElementById('caseStage');
  const row = document.getElementById('caseStageRow');
  const reels = document.getElementById('reels');
  const src = caseArtSrc(c);

  /*
   * От четырёх кейсов раскладываем в два ряда. В одну строку четыре широкие
   * обложки ужимаются до восьмидесяти точек по ширине - видно, что их четыре,
   * но не видно, что это за кейс. В два ряда каждая получает половину ширины
   * и остаётся узнаваемой.
   *
   * Вёрстке нужны оба числа: по колонкам считается ширина картинки, по рядам -
   * её потолок по высоте. Иначе два ряда занимают вдвое больше места, чем
   * один, и кнопка «Открыть» уезжает за край экрана.
   */
  const rows = count < 4 ? 1 : 2;
  stage.style.setProperty('--rows', rows);
  stage.style.setProperty('--cols', Math.ceil(count / rows));
  /*
   * Каждая обложка лежит в коробке заданного размера, а не растягивается сама.
   * Обложки бывают и вдвое выше своей ширины, и вдвое шире: если размер брать
   * от картинки, флекс переносит их по строкам не там, где рассчитано, и
   * высота сцены скачет от кейса к кейсу. Коробка одна на всех, картинка
   * вписывается внутрь по своей форме.
   *
   * Покачиваются и трясутся кейсы вразнобой: в такт это выглядело бы одним
   * предметом, разрезанным на части. Задержки две и разные - у покачивания
   * она большая, а у тряски крохотная: тряска идёт чуть больше секунды, и
   * задержки от покачивания хватило бы, чтобы дальний кейс не тряхнуло вовсе.
   */
  row.innerHTML = Array.from({ length: count }, (_, i) =>
    `<span class="case-stage-box"><img class="case-stage-art" src="${src}"
       alt="${esc(c.name)}" decoding="async"
       style="--float-delay:${(i * 260) % 1400}ms; --shake-delay:${i * 55}ms"></span>`).join('');

  document.getElementById('caseStageHint').textContent =
    count > 1 ? `запечатано · ×${count}` : 'кейс запечатан';
  document.getElementById('caseStageDust').innerHTML = '';
  stage.className = 'case-stage';
  stage.hidden = false;
  reels.hidden = true;
  reels.innerHTML = '';
}

/** Убирает сцену и возвращает ленту - без анимации, для выхода из кейса. */
function clearCaseStage() {
  const stage = document.getElementById('caseStage');
  stage.hidden = true;
  stage.className = 'case-stage';
  document.getElementById('caseStageDust').innerHTML = '';
  document.getElementById('reels').hidden = false;
}

/**
 * Трясёт кейс, поднимает из-под него пыль и уводит со сцены.
 *
 * Пыль - это несколько клубов со своими задержками и разлётом; разлёт задаётся
 * переменными, а не отдельными классами, чтобы каждый клуб шёл своей дорогой и
 * облако не выглядело штампом. Цвет берётся из тона самой обложки, поэтому у
 * следующего кейса с обрядом пыль будет своя, без правок здесь.
 *
 * Возвращает обещание, которое ждут перед прокрутом. Вызывается оно до ответа
 * сервера и разрешается параллельно с ним: тряска - это и есть ответ на
 * нажатие, откладывать её до сети нельзя.
 */
function playRitual(c, count = 1) {
  // На «Ещё раз» сцены на экране уже нет - там стоит лента с прошлым
  // прокрутом. Возвращаем кейсы на место: обряд идёт при каждом открытии, а
  // не только при первом заходе в кейс.
  if (document.getElementById('caseStage').hidden) renderCaseStage(c, count);

  const stage = document.getElementById('caseStage');
  const dust = document.getElementById('caseStageDust');

  document.getElementById('caseStageHint').textContent = 'печать ломается';

  dust.innerHTML = Array.from({ length: 18 }, (_, i) => {
    const dx = (Math.random() * 2 - 1) * 120;
    const rise = 34 + Math.random() * 58;
    const size = 30 + Math.random() * 56;
    // Клубы расставлены по ширине сцены и стартуют вразнобой: ровный ряд с
    // общим стартом читался бы как одна дуга, а не как облако.
    const delay = Math.random() * 900;
    return `<span class="dust-puff" style="
      --dx:${dx.toFixed(1)}px; --rise:${rise.toFixed(1)}px;
      --size:${size.toFixed(1)}px; --start:${(14 + i * 4.3).toFixed(1)}%;
      animation-delay:${delay.toFixed(0)}ms"></span>`;
  }).join('');

  stage.classList.add('is-shaking');
  sndBet();
  haptic('medium');

  return new Promise((resolve) => {
    setTimeout(() => {
      stage.classList.add('is-leaving');
      document.getElementById('reels').hidden = false;
      setTimeout(() => {
        stage.hidden = true;
        stage.className = 'case-stage';
        dust.innerHTML = '';
        resolve();
      }, RITUAL_EXIT_MS);
    }, RITUAL_SHAKE_MS);
  });
}

/** Лента до первого прокрута: стоит на месте, показывает содержимое кейса. */
/**
 * Лента до первого прокрута.
 *
 * Барабанов рисуется столько же, сколько кейсов открывают: выбрал ×3 - и
 * сразу видно три барабана. Раньше их число менялось только после нажатия
 * «Открыть», и что означают эти иксы, приходилось выяснять на своих деньгах.
 */
function renderIdleReel(c, count = 1) {
  const reels = document.getElementById('reels');
  reels.className = 'reels' + (count > 1 ? ' compact' : '');
  reels.innerHTML = Array.from({ length: count }, () => reelWrapHtml()).join('');

  reels.querySelectorAll('.reel').forEach((reel) => {
    const strip = [];
    for (let i = 0; i < 24; i++) strip.push(weightedSample(c.items));
    reel.innerHTML = strip.map(tileHtml).join('');

    reel.style.transition = 'none';
    requestAnimationFrame(() => {
      const viewport = reel.parentElement.clientWidth;
      const { tileW, step } = measureReel(reel);
      // Ставим ленту так, чтобы под маркером оказалась целая плитка, а не стык.
      reel.style.transform = `translateX(${-(6 * step + tileW / 2 - viewport / 2)}px)`;
    });
  });
}

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
  let value;
  if (item.showcase) value = '<span class="tile-showcase">ВИТРИНА</span>';
  else if (item.kind === 'perk' && !item.value) value = iconStar();
  else value = money(item.value);

  // У витринного предмета вместо значка редкости — сама фотография: ради неё
  // он в ленте и крутится.
  const icon = item.photo
    ? `<img class="tile-photo" src="${item.photo}" alt="">`
    : (itemArt(item.name, color) || iconTier(item.tier, color));

  return `<div class="reel-tile ${item.showcase ? 'is-showcase' : ''}"
      style="--tier-color:${color}">
    <div class="tile-icon">${icon}</div>
    <div class="tile-name">${esc(item.name)}</div>
    <div class="tile-value">${value}</div>
  </div>`;
}

// Позиции витринного предмета в ленте. Среди них нет WINNER_INDEX — витрина
// проезжает мимо маркера, но остановиться на ней лента не может.
const SHOWCASE_SLOTS = [11, 27, 43, 58];

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
    needMoney(need - state.user.balance);
    return;
  }

  state.busy = true;
  state.openingCaseId = caseId;
  state.openingCount = count;

  // Обряд запускается до похода на сервер, а не после: тряска - это ответ на
  // нажатие, и ждать сети ей нельзя, иначе кнопка кажется залипшей. Ответ
  // приходит, пока кейс трясётся, и к появлению ленты уже готов.
  document.getElementById('result').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  document.getElementById('gamble').hidden = true;
  document.getElementById('gambleStartBtn').hidden = true;
  const ritual = hasRitual(c) ? playRitual(c, count) : null;

  let data;
  try {
    data = await api('/api/open', { caseId, count });
  } catch (err) {
    state.busy = false;
    if (ritual) { await ritual; renderCaseStage(c, count); }
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
  document.getElementById('freespins').hidden = true;
  document.getElementById('fsCollect').hidden = true;
  document.getElementById('casePanel').hidden = true;
  opener.hidden = false;
  document.querySelector('.opener-scroll').scrollTop = 0;
  loadCaseHistory(c.name);

  // Списание видно с первой секунды прокрута, а не задним числом.
  previewBalance(state.user.balance - data.totalSpent);

  if (ritual) await ritual;
  await spinReels(c, opened, SPIN_DURATION);

  sndLand();
  haptic('medium');

  // Фриспины проигрываются до итогового экрана: сначала игрок видит, сколько
  // они принесли, и только потом — общий результат прокрута.
  for (const g of collectFreeSpins(data)) await runFreeSpins(g, c);

  if (count > 1) showBatchResult(data, c);
  else showCaseResult(data, c);
}

/** Сколько едет лента при обычном прокруте. */
const SPIN_DURATION = 8.2;

/**
 * Кривая прокрута: плавный разгон, а дальше всё более долгое торможение.
 *
 * Контрольная точка перед концом почти в нуле по времени - из-за этого лента
 * подходит к выигрышу ползком: последние полторы плитки идут около двух
 * секунд, и предмет успевает прочитаться до остановки.
 */
const SPIN_EASE = 'cubic-bezier(0.24, 0, 0.03, 1)';

/**
 * Доводка. Лента проезжает выигрыш на волосок дальше и возвращается назад.
 *
 * Без неё прокрут просто гаснет: скорость падает до нуля так плавно, что
 * момент остановки не читается. Короткий откат этот момент отбивает - лента
 * будто становится на защёлку.
 */
const SETTLE_MS = 340;
const SETTLE_EASE = 'cubic-bezier(0.34, 0, 0.2, 1)';

/** Перелёт под доводку, долей шага ленты. */
const OVERSHOOT = 0.09;

/** Ниже этой длины прокрута доводку не делаем: она заметно удлиняет автооткрытие. */
const SETTLE_MIN_DURATION = 3;

/**
 * Прокручивает ленты до уже известного результата.
 *
 * Исход решён сервером и лежит в opened, здесь только анимация: выигрышная
 * плитка ставится в фиксированную позицию, и лента доезжает ровно до неё.
 * Вынесено из startOpening, потому что тем же самым занято автооткрытие -
 * там этот прокрут повторяется в цикле, только быстрее.
 */
function spinReels(c, opened, duration) {
  const reels = document.getElementById('reels');
  reels.className = 'reels' + (opened.length > 1 ? ' compact' : '');
  reels.innerHTML = opened.map(reelWrapHtml).join('');

  sndSpinStart();
  sndBet();
  haptic('medium');

  reels.querySelectorAll('.reel').forEach((reel, idx) => {
    const showcaseTile = c.showcase
      ? {
          name: c.showcase.name, tier: c.showcase.tier, kind: 'item', value: 0,
          showcase: true,
          photo: c.art === 'porsche' ? porschePhotoSrc() : null,
        }
      : null;

    const strip = [];
    for (let i = 0; i < STRIP_LENGTH; i++) {
      if (i === WINNER_INDEX) strip.push(opened[idx].item);
      else if (showcaseTile && SHOWCASE_SLOTS.includes(i)) strip.push(showcaseTile);
      else strip.push(weightedSample(c.items));
    }
    reel.innerHTML = strip.map(tileHtml).join('');

    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0)';
    void reel.offsetWidth;

    const viewport = reel.parentElement.clientWidth;
    let { tileW, step } = measureReel(reel);
    // Сдвиг внутри плитки, но с запасом от краёв: иначе маркер может встать
    // на границу и визуально «зацепить» соседнюю.
    const jitter = (Math.random() - 0.5) * (tileW * 0.5);
    const target = WINNER_INDEX * step + tileW / 2 - viewport / 2 + jitter;

    /*
     * Страховка от пустоты справа.
     *
     * Длина ленты задана числом плиток, а ширина окна зависит от экрана. На
     * широком экране хвоста за выигрышем может не хватить, и лента доедет до
     * своего конца - дальше в кадре будет пустой фон. Досыпаем плиток, пока
     * правый край окна не уложится в ленту с запасом.
     */
    let guard = 0;
    while (target + viewport > strip.length * step - (step - tileW) && guard < 40) {
      reel.insertAdjacentHTML('beforeend', tileHtml(weightedSample(c.items)));
      strip.push(null);
      guard++;
    }

    const settle = duration >= SETTLE_MIN_DURATION;
    const overshoot = settle ? step * OVERSHOOT : 0;

    requestAnimationFrame(() => {
      reel.style.transition = `transform ${duration}s ${SPIN_EASE}`;
      reel.style.transform = `translateX(${-(target + overshoot)}px)`;
    });

    if (settle) {
      setTimeout(() => {
        reel.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;
        reel.style.transform = `translateX(${-target}px)`;
      }, duration * 1000 + 20);
    }

    // Щелчки снимаем только с первой ленты — иначе они сливаются в шум.
    if (idx === 0) trackReelTicks(reel, step, duration * 1000);
  });

  const tail = duration >= SETTLE_MIN_DURATION ? SETTLE_MS + 260 : 150;
  return new Promise((done) => setTimeout(done, duration * 1000 + tail));
}

/* ============================================================
   ПОКУПКА ФРИСПИНОВ
   ============================================================ */

/**
 * Нарисованные монеты ступеней. Ступени задаются на сервере, а картинки есть
 * не под любое число, поэтому для незнакомой ступени рисуем число вёрсткой.
 *
 * Пути выписаны целиком, а не собираются из числа: сборка автономной версии
 * подменяет их самими файлами, а найти она может только то, что записано
 * строкой.
 */
const FS_COIN_ART = {
  10: '/assets/ui/fs-coin-10.webp',
  20: '/assets/ui/fs-coin-20.webp',
  30: '/assets/ui/fs-coin-30.webp',
};

/**
 * Кнопки покупки серии фриспинов.
 *
 * Заголовок и монеты - куски присланного макета, всё остальное собрано
 * вёрсткой поверх. Целиком картинкой макет поставить нельзя: цена у каждого
 * кейса своя, а на телефоне такая широкая картинка ужимается так, что подписи
 * становятся с пиксель.
 *
 * Цену считает сервер, здесь она пересчитывается только для показа - по тем же
 * числам из конфига.
 */
function renderFreeSpinBuy(c, locked) {
  const box = document.getElementById('fsBuy');
  const row = document.getElementById('fsBuyRow');
  const packs = state.config.freeSpinPacks || [];

  if (!packs.length || locked) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  row.innerHTML = packs.map((p) => {
    const price = freeSpinPackPrice(c, p);
    const coin = FS_COIN_ART[p.count]
      ? `<img src="${FS_COIN_ART[p.count]}" alt="" decoding="async">`
      : `<b>${p.count}</b>`;

    return `<button class="fsbuy-btn${p.popular ? ' is-popular' : ''}" data-fs="${p.count}"
        aria-label="${p.count} прокрутов за ${money(price)}"
        ${price > state.user.balance ? 'disabled' : ''}>
      <span class="fsbuy-coin">${coin}</span>
      <span class="fsbuy-word">прокрутов</span>
      <span class="fsbuy-price">${money(price)}</span>
      ${p.popular ? '<span class="fsbuy-flag">Популярно</span>' : ''}
    </button>`;
  }).join('');

  row.querySelectorAll('[data-fs]').forEach((btn) => {
    btn.addEventListener('click', () => confirmBuyFreeSpins(c, Number(btn.dataset.fs)));
  });
}

/**
 * Цена пачки. Та же формула, что на сервере; сервер остаётся источником правды.
 * Округление вниз до круглого числа повторено здесь один в один - см.
 * roundPackPrice в server/cases.js, там же и обоснование потолка.
 */
const PACK_ROUND_MAX_CUT = 0.025;

function freeSpinPackPrice(c, pack) {
  const price = Math.round(c.price * pack.count * (1 - pack.discount));
  let best = price;
  for (let step = 10; step <= price; step *= 10) {
    const down = Math.floor(price / step) * step;
    if (down <= 0 || price - down > price * PACK_ROUND_MAX_CUT) break;
    best = down;
  }
  return best;
}

/**
 * Подтверждение покупки.
 *
 * Серия стоит заметных денег и запускается сразу, отменить её уже нельзя.
 * Покупка одним нажатием на такую сумму - это ловушка для промаха пальцем,
 * поэтому между нажатием и списанием стоит экран с ценой и остатком.
 */
function confirmBuyFreeSpins(c, count) {
  const pack = (state.config.freeSpinPacks || []).find((p) => p.count === count);
  if (!pack) return;

  const price = freeSpinPackPrice(c, pack);
  const backdrop = document.getElementById('buyBackdrop');

  document.getElementById('buyArt').textContent = String(count);
  document.getElementById('buyTitle').textContent = 'Покупка фриспинов';
  document.getElementById('buyRows').innerHTML = `
    <div class="confirm-row"><span>Кейс</span><b>${esc(c.name)}</b></div>
    <div class="confirm-row"><span>Прокрутов</span><b>${count}</b></div>
    <div class="confirm-row"><span>К оплате</span><b class="gold">${money(price)}</b></div>
    <div class="confirm-row"><span>Останется на счету</span>
      <b>${money(Math.max(0, state.user.balance - price))}</b></div>
  `;
  document.getElementById('buyNote').textContent =
    'Прокруты бесплатные и начнутся сразу. Внутри серии может выпасть что угодно '
    + 'из этого кейса, включая новые фриспины.';

  const confirmBtn = document.getElementById('buyConfirm');
  const cancelBtn = document.getElementById('buyCancel');
  confirmBtn.textContent = `Купить за ${money(price)}`;
  confirmBtn.disabled = price > state.user.balance;

  const close = () => {
    backdrop.hidden = true;
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    backdrop.onclick = null;
  };

  confirmBtn.onclick = () => { close(); buyFreeSpins(c.id, count); };
  cancelBtn.onclick = () => { close(); haptic('light'); };
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  backdrop.hidden = false;
  haptic('light');
}

/** Покупает серию и сразу её проигрывает - той же анимацией, что и выпавшую. */
async function buyFreeSpins(caseId, count) {
  if (state.busy) return;
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;

  state.busy = true;
  state.openingCaseId = caseId;

  let data;
  try {
    data = await api('/api/freespins/buy', { caseId, count });
  } catch (err) {
    state.busy = false;
    toast(err.message);
    haptic('error');
    return;
  }

  document.getElementById('result').hidden = true;
  document.getElementById('gamble').hidden = true;
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  document.getElementById('casePanel').hidden = true;
  document.querySelector('.opener-scroll').scrollTop = 0;

  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>${count} фриспинов за ${money(data.cost)}</span>`;

  // Сначала честное списание стоимости, и только потом серия начинает
  // возвращать выигрыш. Иначе баланс сразу показал бы итог, и покупка за
  // 18 000 выглядела бы списанием на 9 000.
  previewBalance(state.user.balance - data.cost);

  // Покупка - событие, за которое игрок заплатил: отмечаем её отдельно и
  // даём празднованию отыграть целиком, прежде чем поедет первая лента.
  celebrate('purchase', { count });
  await sleep(PURCHASE_FX_MS);

  await runFreeSpins(data.grant, c);

  // Настоящее значение с сервера - на случай, если анимация где-то разошлась.
  applyUser(data.user);
  updateOpenerBalance();
  loadCaseHistory(c.name);
  state.busy = false;
  showAutoResult(c, {
    times: count,
    done: data.grant.spins.length,
    spent: data.cost,
    won: data.grant.total,
    stopped: false,
    label: 'фриспинов',
  });
}

/* ============================================================
   АВТООТКРЫТИЕ
   ============================================================ */

/** Сколько прокрутов подряд можно заказать. Ноль - режим выключен. */
const AUTO_COUNTS = [0, 10, 25, 50, 100];

/**
 * Прокрут в серии короче обычного.
 *
 * Обычные 6.4 секунды здесь превратились бы в десять минут ожидания на сотне
 * прокрутов. Две с небольшим секунды - всё ещё видно, что именно выпало, но
 * серия идёт бодро. Прервать её можно в любой момент.
 */
const AUTO_SPIN_DURATION = 2.2;

/** Пауза между прокрутами, чтобы результат успел прочитаться. */
const AUTO_PAUSE_MS = 320;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Серия автооткрытий.
 *
 * Кейс открывается по одному, ровно так же, как вручную: каждый прокрут -
 * отдельный запрос, отдельный nonce и отдельная запись в истории, поэтому
 * серия проверяется в разделе «Честность» так же, как обычная игра. Разница
 * только в том, что игроку не приходится жать кнопку между прокрутами.
 *
 * Выигрыш зачисляется сразу после каждого прокрута, а не в конце: если серия
 * оборвётся на середине - по кнопке, из-за нехватки средств или сетевой
 * ошибки, - всё уже выигранное останется у игрока.
 */
async function runAutoOpen(caseId, times) {
  if (state.busy) return;
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;

  state.busy = true;
  state.autoStop = false;
  state.openingCaseId = caseId;
  state.openingCount = 1;

  const panel = document.getElementById('autoPanel');
  const leftEl = document.getElementById('autoLeft');
  const totalEl = document.getElementById('autoTotal');
  const logEl = document.getElementById('autoLog');

  document.getElementById('result').hidden = true;
  document.getElementById('gamble').hidden = true;
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  document.getElementById('freespins').hidden = true;
  document.getElementById('fsCollect').hidden = true;
  document.getElementById('casePanel').hidden = true;
  document.getElementById('opener').hidden = false;
  panel.hidden = false;
  logEl.innerHTML = '';
  totalEl.textContent = money(0);
  document.querySelector('.opener-scroll').scrollTop = 0;

  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>авто ×${times}</span>`;

  // Обряд в серии играется один раз, на входе: трясти кейс перед каждым из
  // двадцати пяти прокрутов - это уже не событие, а задержка.
  if (hasRitual(c)) await playRitual(c);
  else clearCaseStage();

  let spent = 0;
  let won = 0;
  let done = 0;

  for (let i = 0; i < times; i++) {
    if (state.autoStop) break;

    // Ваучер тратится первым, поэтому проверяем баланс только на платный
    // прокрут. Список ваучеров обновляется ответом сервера на каждом шаге.
    const freeLeft = (state.user.vouchers || []).find((v) => v.case_id === c.id)?.count || 0;
    if (!freeLeft && c.price > state.user.balance) {
      needMoney(c.price - state.user.balance);
      break;
    }

    leftEl.textContent = `прокрут ${i + 1} из ${times}`;

    let data;
    try {
      data = await api('/api/open', { caseId, count: 1 });
    } catch (err) {
      toast(err.message);
      haptic('error');
      break;
    }

    previewBalance(state.user.balance - data.totalSpent);
    await spinReels(c, [data], AUTO_SPIN_DURATION);
    sndLand();

    // Фриспины внутри серии забираются сами: серия на то и авто, чтобы не
    // требовать нажатий. Анимацию всё же показываем - это главный момент.
    for (const g of collectFreeSpins(data)) await runFreeSpins(g, c, { auto: true });

    spent += data.totalSpent;
    won += data.totalWon;
    done++;

    applyUser(data.user);
    updateOpenerBalance();

    totalEl.textContent = money(won);
    totalEl.classList.remove('bump');
    void totalEl.offsetWidth;
    totalEl.classList.add('bump');

    logEl.insertAdjacentHTML('afterbegin',
      `<span class="auto-chip" style="--tier-color:${tierColor(data.item.tier)}">` +
      `${money(data.totalWon)}</span>`);
    // Держим лог коротким: панель не должна расти вниз на всю серию.
    while (logEl.children.length > 12) logEl.lastElementChild.remove();

    celebrateWin(data.item.multiplier, data.item.value);

    if (i < times - 1 && !state.autoStop) await sleep(AUTO_PAUSE_MS);
  }

  panel.hidden = true;
  state.busy = false;
  loadCaseHistory(c.name);
  showAutoResult(c, { times, done, spent, won, stopped: state.autoStop });
}

document.getElementById('autoStop').addEventListener('click', () => {
  state.autoStop = true;
  haptic('medium');
  document.getElementById('autoLeft').textContent = 'останавливаем...';
});

/** Итог серии: сколько прокрутов прошло, сколько потрачено и выиграно. */
function showAutoResult(caseData, { times, done, spent, won, stopped, label = 'прокрутов' }) {
  const box = document.getElementById('batchSummary');

  // Как и в остальных итогах: показываем выигрыш, а не разницу с потраченным.
  // Потраченное игрок видел на кнопке, второй раз считать за него незачем.
  box.innerHTML = `
    ${won > 0 ? `<div class="batch-total plus">+${money(won)}</div>` : ''}
    <div class="batch-sub">
      ${done === times ? `${done} ${label}` : `${done} из ${times} ${label}`}${stopped ? ' · остановлено' : ''}
    </div>
    <div class="result-actions">
      <button class="btn btn-outline" id="autoClose">Забрать</button>
      <button class="btn btn-primary" id="autoAgain">Ещё ${times} раз</button>
    </div>
  `;
  box.hidden = false;

  if (won > spent) { sndCollect(); haptic('success'); } else { sndLose(); haptic('light'); }

  document.getElementById('autoClose').addEventListener('click', returnToCaseIdle);
  document.getElementById('autoAgain').addEventListener('click', () =>
    (label === 'фриспинов' ? buyFreeSpins(caseData.id, times) : runAutoOpen(caseData.id, times)));
}

/** Все выдачи фриспинов из ответа — и одиночного прокрута, и пачки. */
function collectFreeSpins(data) {
  const out = [];
  for (const g of data.granted || []) if (g.type === 'freespins') out.push(g);
  for (const o of data.opened || []) {
    for (const g of o.granted || []) if (g.type === 'freespins') out.push(g);
  }
  return out;
}

/**
 * Проигрывает серию фриспинов.
 *
 * Исход каждого прокрута уже посчитан сервером и лежит в ответе — здесь только
 * анимация. Сумма копится на экране крупными цифрами: это и есть смысл режима,
 * поэтому она набирается на глазах, а не появляется готовой в конце.
 */
function runFreeSpins(grant, caseData, { auto = false, replay = false } = {}) {
  const box = document.getElementById('freespins');
  const reel = document.getElementById('fsReel');
  const totalEl = document.getElementById('fsTotal');
  const leftEl = document.getElementById('fsLeft');
  const logEl = document.getElementById('fsLog');
  const collectBtn = document.getElementById('fsCollect');

  document.getElementById('result').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  // Серия может начаться и с непрокрученного кейса - купленными фриспинами
  // или доигрыванием прошлой серии на входе. Сцена с кейсом тогда осталась бы
  // висеть над барабаном фриспинов.
  document.getElementById('caseStage').hidden = true;
  box.hidden = false;
  collectBtn.hidden = true;
  logEl.innerHTML = '';
  totalEl.textContent = money(0);

  const SPIN_LEN = 26;
  const SPIN_WIN = 20;
  /* Прокрут внутри серии короче обычного - их подряд десятки, - но кривая та
     же: к предмету лента подходит ползком, а не гаснет на полном ходу. */
  const SPIN_MS = 2300;

  const filler = caseData.items.filter((it) => it.kind === 'item');
  const pickFiller = () => filler[Math.floor(Math.random() * filler.length)];

  let acc = 0;

  const runOne = (i) => new Promise((done) => {
    const spin = grant.spins[i];
    // Длина серии растёт по ходу: перезапуск добавляет прокруты, поэтому
    // знаменатель берётся из фактического числа, а не из начального обещания.
    leftEl.textContent = `${i + 1} из ${grant.spins.length}`;

    const strip = [];
    for (let k = 0; k < SPIN_LEN; k++) strip.push(k === SPIN_WIN ? spin : pickFiller());
    reel.innerHTML = strip.map(tileHtml).join('');

    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0)';
    void reel.offsetWidth;

    const viewport = reel.parentElement.clientWidth;
    const { tileW, step } = measureReel(reel);
    const target = SPIN_WIN * step + tileW / 2 - viewport / 2;

    // Та же страховка от пустоты справа, что и в обычном прокруте.
    let guard = 0;
    while (target + viewport > reel.children.length * step - (step - tileW) && guard < 40) {
      reel.insertAdjacentHTML('beforeend', tileHtml(pickFiller()));
      guard++;
    }

    requestAnimationFrame(() => {
      reel.style.transition = `transform ${SPIN_MS / 1000}s ${SPIN_EASE}`;
      reel.style.transform = `translateX(${-(target + step * OVERSHOOT)}px)`;
      sndSpinStart();

      setTimeout(() => {
        reel.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;
        reel.style.transform = `translateX(${-target}px)`;
      }, SPIN_MS + 20);

      setTimeout(() => {
        sndLand();
        acc += spin.value;
        totalEl.textContent = money(acc);
        // Баланс растёт вместе с суммой серии: игрок видит, что выигрыш
        // капает по ходу, а не появляется одним прыжком в конце.
        // При доигрывании сохранённой серии баланс не трогаем: деньги за неё
        // зачислены ещё в тот раз, и второй раз их прибавлять нельзя.
        if (spin.value > 0 && !replay) previewBalance(state.user.balance + spin.value);
        // Перезапуск анимации: без сброса класса подряд идущие прибавки
        // не «подпрыгивают».
        totalEl.classList.remove('bump');
        void totalEl.offsetWidth;
        totalEl.classList.add('bump');

        // Удвоитель внутри серии её прокруты не удваивает - он откладывается
        // до платного открытия, и подпись говорит именно это.
        const label = spin.perkType === 'freespins' ? `+${spin.added} прокрутов`
                    : spin.perkType === 'x2' ? '×2 в запас'
                    : spin.perkType === 'voucher' ? 'подарок'
                    : money(spin.value);
        logEl.insertAdjacentHTML('beforeend',
          `<span class="fs-chip${spin.added ? ' retrigger' : ''}" ` +
          `style="--tier-color:${tierColor(spin.tier)}">${label}</span>`);

        if (spin.added) {
          leftEl.textContent = `${i + 1} из ${grant.spins.length}`;
          celebrate('retrigger', { added: spin.added });
        } else {
          // Крупный прокрут внутри серии тоже стоит отметить, но тише.
          if (spin.value >= caseData.price * 8) celebrate('win');
          haptic('light');
        }
        setTimeout(done, 320);
      }, SPIN_MS + SETTLE_MS + 40);
    });
  });

  return (async () => {
    for (let i = 0; i < grant.spins.length; i++) await runOne(i);

    // Итог серии: если она отбилась с запасом, это отдельный повод.
    if (!replay && grant.total >= caseData.price * 12) {
      celebrate('bigwin', { text: money(grant.total), sub: 'за серию' });
    } else {
      sndBigWin();
      haptic('success');
    }
    collectBtn.hidden = false;
    collectBtn.textContent = `ЗАБРАТЬ ${money(grant.total)}`;

    // Серию досмотрели - сервер может её забыть.
    const ack = () => { api('/api/freespins/ack').catch(() => {}); };

    // В серии автооткрытий забираем сами: смысл режима в том, чтобы игрок не
    // жал кнопки. Паузу всё же держим - сумму надо успеть прочитать.
    if (auto) {
      await new Promise((done) => setTimeout(done, 1500));
      sndCollect();
      box.hidden = true;
      ack();
      return;
    }

    await new Promise((done) => {
      collectBtn.addEventListener('click', () => {
        sndCollect();
        box.hidden = true;
        ack();
        done();
      }, { once: true });
    });
  })();
}

/** Итог пачки: список выпавшего и суммарный результат. */
function showBatchResult(data, caseData) {
  const box = document.getElementById('batchSummary');
  const opened = data.opened;

  const best = opened.reduce((a, b) => (b.item.value > a.item.value ? b : a));

  // Как и в одиночном прокруте: показываем весь выигрыш пачки, а не разницу
  // с потраченным. Потраченное игрок и так видел на кнопке открытия.
  box.innerHTML = `
    ${data.totalWon > 0 ? `<div class="batch-total plus">+${money(data.totalWon)}</div>` : ''}
    <div class="batch-list">
      ${opened.map((o) => {
        const fs = o.granted.find((g) => g.type === 'freespins');
        const rowValue = o.item.value + (fs?.total || 0);
        const rowName = fs ? `${esc(o.item.name)} + ${fs.spins.length} фриспинов` : esc(o.item.name);
        return `<div class="mini-row" style="--tier-color:${tierColor(o.item.tier)}">
        <span class="mini-name">${rowName}${o.x2Applied ? ' (×2)' : ''}</span>
        <span class="mini-val">${money(rowValue)}</span>
      </div>`;
      }).join('')}
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
  if (data.totalWon > data.totalSpent) { sndCollect(); haptic('success'); }
  else { sndLose(); haptic('light'); }

  // Выпадения пачки тоже идут в витрину.
  setTimeout(pollFeed, 400);

  // В пачке ориентируемся на лучший предмет: именно он и есть событие.
  setTimeout(() => celebrateWin(best.item.multiplier, best.item.value), 220);

  document.getElementById('batchClose').addEventListener('click', returnToCaseIdle);
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
    item.value ? money(item.value) : '-';

  const net = document.getElementById('resultNet');
  const parts = [];
  if (data.x2Applied) parts.push('удвоитель применён');

  // Удвоителей за один прокрут может прийти несколько: сам предмет плюс те,
  // что выпали внутри серии фриспинов. Считаем их, а не пишем строку на каждый.
  const x2Won = (data.granted || []).filter((g) => g.type === 'x2').length;
  if (x2Won === 1) parts.push('получен удвоитель');
  else if (x2Won > 1) parts.push(`получено удвоителей: ${x2Won}`);

  for (const g of data.granted || []) {
    if (g.type === 'voucher') parts.push(`подарок: кейс «${g.caseName}»`);
    // Крупное число над строкой - это только сам предмет. То, что пришло
    // деньгами сверх него, иначе нигде не видно.
    if (g.type === 'credits') parts.push(`бонус +${fmt(g.amount)}`);
    if (g.type === 'freespins') {
      parts.push(`${g.spins.length} фриспинов: +${fmt(g.total)}`);
    }
  }

  /*
   * Суммы здесь нет намеренно.
   *
   * Она уже стоит над этой строкой крупными цифрами, и повтор мелким зелёным
   * не добавлял ничего, кроме второго числа в кадре. Остаются только пометки
   * о том, что нельзя прочитать из суммы: множитель, подарок, фриспины.
   */
  net.innerHTML = parts.length ? esc(parts.join(' · ')) : '';
  net.className = 'result-net';
  net.hidden = !parts.length;

  result.hidden = false;
  applyUser(data.user);
  updateOpenerBalance();
  loadCaseHistory(caseData.name);
  state.busy = false;

  // Выигрыш игрока должен попасть в ленту сразу, а не в следующий плановый
  // опрос: сервер уже записал раунд, осталось его забрать. Порог тут не нужен -
  // лента показывает и обычные выпадения, отсекает их уже сервер.
  setTimeout(pollFeed, 400);

  sndReveal(item.tier);
  if (data.net > 0) { setTimeout(sndCollect, 260); haptic('success'); }
  else { setTimeout(sndLose, 200); haptic('light'); }

  // Празднуем по множителю: чем крупнее, тем заметнее эффект.
  setTimeout(() => celebrateWin(item.multiplier, item.value), 220);

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
  // Небольшой дрейф по времени, чтобы число выглядело живым. Диапазон 30–110:
  // цифры покрупнее на дешёвом кейсе выглядели неправдоподобно.
  return 30 + ((h + Math.floor(Date.now() / 60000)) % 81);
}

/**
 * Показывает промежуточный баланс, не дожидаясь конца анимации.
 *
 * Сервер отвечает сразу итоговым балансом: списание и выигрыш в нём уже
 * схлопнуты. Если показать это число до прокрута, игрок видит одно движение
 * на разницу - купил серию за 18 000, а баланс просел на 9 000, потому что
 * серия те же 9 000 и вернула. Выглядит как ошибка в расчётах.
 *
 * Поэтому во время анимации баланс ведём сами: сначала списываем стоимость,
 * потом добавляем выигрыш по мере того, как он выпадает. В конце applyUser
 * ставит настоящее значение с сервера, так что расхождение невозможно.
 */
function previewBalance(value) {
  state.user.balance = Math.max(0, Math.round(value));
  renderBalance();
  updateOpenerBalance();
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

/**
 * «Забрать» после результата не должно выкидывать из кейса — игрок почти
 * наверняка захочет крутить ещё. Экран просто возвращается в исходное
 * состояние, как при первом входе в кейс, а не закрывается целиком.
 */
function returnToCaseIdle() {
  document.getElementById('gamble').hidden = true;
  if (state.openingCaseId) openCase(state.openingCaseId);
  else closeOpener();
}

document.getElementById('closeOpener').addEventListener('click', returnToCaseIdle);
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
    `Найдите красного туза среди ${g.cards} карт - выигрыш вырастет в ` +
    `<b>×${g.payout}</b>. Промах - выигрыш сгорает.`;

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
    needMoney(bet - state.user.balance);
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
    needMoney(bet - state.user.balance);
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
    box.textContent = data.won ? `${label} - забрали ${money(data.payout)}` : `${label} - мимо`;
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

const pct = (v) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(2)}%`);

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
          · RTP ${u.total_spent ? ((u.total_won / u.total_spent) * 100).toFixed(0) + '%' : '-'}</div>
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
        <div class="kpi-value">${u.total_spent ? ((u.total_won / u.total_spent) * 100).toFixed(1) + '%' : '-'}</div></div>
      <div class="kpi"><div class="kpi-label">Прибыль с него</div>
        <div class="kpi-value ${u.total_spent - u.total_won >= 0 ? 'plus' : 'minus'}">
          ${fmt(u.total_spent - u.total_won)}</div></div>
    </div>

    <h2 class="section-title">Изменить баланс</h2>
    <div class="amount-row">
      <input class="seed-input" id="adjAmount" type="number" inputmode="numeric" placeholder="сумма">
      <input class="seed-input" id="adjNote" placeholder="комментарий" maxlength="200">
    </div>
    <label class="adj-mode">
      <input type="checkbox" id="adjCorrection">
      <span>Корректировка: деньги придут без отыгрыша</span>
    </label>
    <p class="adj-hint">Обычное начисление считается пополнением, и его надо
      прокрутить через ставки, прежде чем откроется вывод. Для возврата после
      сбоя или компенсации ставьте галочку - иначе поддержка своими руками
      запрёт игроку вывод.</p>
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
        asDeposit: !document.getElementById('adjCorrection').checked,
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
    if (state.admin.tab === 'funnel') loadAdminFunnel();
    if (state.admin.tab === 'users') loadAdminUsers();
    if (state.admin.tab === 'payouts') loadAdminPayouts();
    if (state.admin.tab === 'payments') loadAdminPayments();
    if (state.admin.tab === 'support') loadAdminSupport();
    if (state.admin.tab === 'promos') loadAdminPromos();
    if (state.admin.tab === 'partners') loadAdminPartners();
    if (state.admin.tab === 'payment-settings') loadAdminPaymentSettings();
    haptic('light');
  });
});

/* ---------- Админка: воронка ---------- */

/*
 * Воронка по когорте: игроки, зарегистрированные за период, и то, докуда
 * каждый дошёл. Считает сервер, здесь только рисование.
 *
 * Показываем обе доли сразу - от когорты и от предыдущего шага. От когорты
 * видно, сколько людей теряется вообще; от предыдущего - на каком именно шаге
 * они уходят. По одной доле из двух вывод получается неверный.
 */
async function loadAdminFunnel() {
  const box = document.getElementById('funnelBody');
  box.innerHTML = '<div class="empty">Считаем...</div>';

  let d;
  try { d = await api('/api/admin/funnel', { days: state.admin.funnelDays || 7 }); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const f = d.funnel;
  if (!f.cohort) {
    box.innerHTML = '<div class="empty">За этот период новых игроков не было</div>';
    return;
  }

  const steps = f.steps.map((s, i) => {
    const width = Math.max(1, Math.round(s.ofCohort * 100));
    const lost = i > 0 ? f.steps[i - 1].users - s.users : 0;
    return `<div class="funnel-step">
      <div class="funnel-bar" style="width:${width}%"></div>
      <div class="funnel-head">
        <span class="funnel-title">${esc(s.title)}</span>
        <span class="funnel-users">${fmt(s.users)}</span>
      </div>
      <div class="funnel-sub">
        ${pct(s.ofCohort)} от всех${i > 0 ? ` · ${pct(s.ofPrev)} от предыдущего` : ''}
        ${lost > 0 ? `<span class="funnel-drop"> · потеряно ${fmt(lost)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  const events = d.events.map((e) => `<tr>
      <td>${esc(e.name)}</td>
      <td class="num">${fmt(e.total)}</td>
      <td class="num">${fmt(e.users)}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="admin-kpis">
      <div class="kpi"><div class="kpi-label">Новых игроков</div>
        <div class="kpi-value">${fmt(f.cohort)}</div></div>
      <div class="kpi"><div class="kpi-label">Пополнений</div>
        <div class="kpi-value">${fmt(f.deposits)}</div></div>
      <div class="kpi"><div class="kpi-label">Внесено</div>
        <div class="kpi-value">${fmt(f.deposited)}</div></div>
      <div class="kpi"><div class="kpi-label">На игрока</div>
        <div class="kpi-value">${fmt(Math.round(f.arpu))}</div>
        <div class="kpi-sub">внесено / новых игроков</div></div>
    </div>

    <h2 class="section-title">Шаги</h2>
    ${steps}

    <h2 class="section-title">Все события за период</h2>
    <table class="admin-table">
      <thead><tr><th>Событие</th><th class="num">Всего</th><th class="num">Игроков</th></tr></thead>
      <tbody>${events || '<tr><td colspan="3">Пока пусто</td></tr>'}</tbody>
    </table>
  `;
}

document.querySelectorAll('[data-funnel-days]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.admin.funnelDays = Number(btn.dataset.funnelDays);
    document.querySelectorAll('[data-funnel-days]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadAdminFunnel();
  });
});

/* ---------- Админка: промокоды ---------- */

/** Дата в формате поля input[type=date] и обратно в миллисекунды. */
const dateValue = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const dateMs = (v, endOfDay) =>
  (v ? new Date(v + (endOfDay ? 'T23:59:59' : 'T00:00:00')).getTime() : null);

async function loadAdminPromos() {
  let d;
  try { d = await api('/api/admin/promos'); }
  catch (err) { toast(err.message); return; }

  let partners = [];
  try { partners = (await api('/api/admin/partners')).rows; } catch { /* необязательно */ }

  const box = document.getElementById('admin-promos');

  box.innerHTML = `
    <div class="admin-form">
      <div class="form-grid">
        <div class="wide">
          <label>Код</label>
          <input class="seed-input" id="pmCode" placeholder="WELCOME" maxlength="32">
        </div>
        <div class="wide">
          <label>Тип</label>
          <select class="seed-input" id="pmType">
            <option value="balance">Начисление на баланс</option>
            <option value="deposit_pct">Процент к пополнению</option>
            <option value="free_case">Бесплатный кейс</option>
          </select>
        </div>

        <div data-when="balance"><label>Сумма</label>
          <input class="seed-input" id="pmAmount" type="number" min="0" value="500"></div>

        <div data-when="deposit_pct"><label>Процент</label>
          <input class="seed-input" id="pmPct" type="number" min="0" max="500" value="100"></div>
        <div data-when="deposit_pct"><label>Потолок бонуса</label>
          <input class="seed-input" id="pmMaxBonus" type="number" min="0" value="0"></div>
        <div data-when="deposit_pct"><label>Мин. пополнение</label>
          <input class="seed-input" id="pmMinDep" type="number" min="0" value="0"></div>

        <div data-when="free_case"><label>Кейс</label>
          <select class="seed-input" id="pmCase">
            ${d.cases.map((c) => `<option value="${c.id}">${esc(c.name)} · ${fmt(c.price)}</option>`).join('')}
          </select></div>
        <div data-when="free_case"><label>Сколько штук</label>
          <input class="seed-input" id="pmCaseCount" type="number" min="1" value="1"></div>

        <div><label>Отыгрыш, ×</label>
          <input class="seed-input" id="pmWager" type="number" min="0" step="0.5" value="3"></div>
        <div><label>Всего активаций</label>
          <input class="seed-input" id="pmMaxUses" type="number" min="0" value="0"></div>
        <div><label>На игрока</label>
          <input class="seed-input" id="pmPerUser" type="number" min="0" value="1"></div>
        <div><label>Партнёр</label>
          <select class="seed-input" id="pmPartner">
            <option value="">нет</option>
            ${partners.map((p) => `<option value="${p.partner.id}">${
              esc(p.partner.name || p.partner.tg_id)}</option>`).join('')}
          </select></div>
        <div><label>Действует с</label>
          <input class="seed-input" id="pmFrom" type="date"></div>
        <div><label>Действует по</label>
          <input class="seed-input" id="pmTo" type="date"></div>
        <div class="wide">
          <label class="check">
            <input type="checkbox" id="pmNewOnly"> только игрокам без пополнений
          </label>
        </div>
        <div class="wide"><label>Заметка</label>
          <input class="seed-input" id="pmNote" maxlength="200"></div>
      </div>
      <button class="btn btn-primary btn-wide" id="pmSave">Сохранить промокод</button>
      <div class="kpi-sub" style="margin-top:8px">
        Ноль в лимитах означает «без ограничения». Отыгрыш ноль - бонус можно
        выводить сразу, так что для щедрых кодов его лучше не оставлять пустым.
      </div>
    </div>

    <h2 class="section-title">Промокоды</h2>
    ${d.rows.length ? d.rows.map(promoRowHtml).join('') : '<div class="empty">Пока пусто</div>'}
  `;

  // Показываем только поля, относящиеся к выбранному типу: иначе форма просит
  // заполнить то, что для этого типа не значит ничего.
  const syncType = () => {
    const t = document.getElementById('pmType').value;
    box.querySelectorAll('[data-when]').forEach((el) => {
      el.style.display = el.dataset.when === t ? '' : 'none';
    });
  };
  document.getElementById('pmType').addEventListener('change', syncType);
  syncType();

  document.getElementById('pmSave').addEventListener('click', savePromo);

  box.querySelectorAll('[data-promo-edit]').forEach((btn) => {
    btn.addEventListener('click', () => fillPromoForm(
      d.rows.find((r) => r.id === Number(btn.dataset.promoEdit))));
  });
  box.querySelectorAll('[data-promo-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const r = await api('/api/admin/promo/delete', { id: Number(btn.dataset.promoDel) });
        toast(r.disabled ? 'Код отключён (по нему были активации)' : 'Код удалён');
        loadAdminPromos();
      } catch (err) { toast(err.message); }
    });
  });
}

function promoRowHtml(p) {
  const bits = [];
  if (p.type === 'balance') bits.push(`+${fmt(p.amount)} на баланс`);
  if (p.type === 'deposit_pct') {
    bits.push(`+${p.pct}% к пополнению`);
    if (p.min_deposit) bits.push(`от ${fmt(p.min_deposit)}`);
    if (p.max_bonus) bits.push(`макс ${fmt(p.max_bonus)}`);
  }
  if (p.type === 'free_case') bits.push(`кейс ${esc(p.case_id)} ×${p.case_count}`);
  if (p.wager_multiplier) bits.push(`отыгрыш ×${p.wager_multiplier}`);
  bits.push(`активаций ${p.used_count}${p.max_uses ? ' из ' + p.max_uses : ''}`);
  if (p.per_user_limit) bits.push(`на игрока ${p.per_user_limit}`);
  if (p.new_players_only) bits.push('только новым');
  if (p.expires_at) bits.push(`до ${new Date(p.expires_at).toLocaleDateString('ru-RU')}`);
  if (p.partner_name || p.partner_tg) bits.push(`партнёр: ${esc(p.partner_name || p.partner_tg)}`);

  return `<div class="promo-row ${p.is_active ? '' : 'off'}">
    <div>
      <div class="promo-code">${esc(p.code)}</div>
      <div class="promo-meta">${bits.join(' · ')}</div>
    </div>
    <div class="promo-actions">
      <button class="btn btn-outline btn-sm" data-promo-edit="${p.id}">Изм.</button>
      <button class="btn btn-outline btn-sm" data-promo-del="${p.id}">×</button>
    </div>
  </div>`;
}

function fillPromoForm(p) {
  if (!p) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('pmCode', p.code);
  set('pmType', p.type);
  set('pmAmount', p.amount);
  set('pmPct', p.pct);
  set('pmMaxBonus', p.max_bonus);
  set('pmMinDep', p.min_deposit);
  if (p.case_id) set('pmCase', p.case_id);
  set('pmCaseCount', p.case_count);
  set('pmWager', p.wager_multiplier);
  set('pmMaxUses', p.max_uses);
  set('pmPerUser', p.per_user_limit);
  set('pmPartner', p.partner_id || '');
  set('pmFrom', dateValue(p.starts_at));
  set('pmTo', dateValue(p.expires_at));
  set('pmNote', p.note || '');
  document.getElementById('pmNewOnly').checked = !!p.new_players_only;
  document.getElementById('pmType').dispatchEvent(new Event('change'));
  document.getElementById('admin-promos').scrollIntoView({ behavior: 'smooth' });
}

async function savePromo() {
  const val = (id) => document.getElementById(id)?.value;
  try {
    const r = await api('/api/admin/promo/save', {
      code: val('pmCode'),
      type: val('pmType'),
      amount: val('pmAmount'),
      pct: val('pmPct'),
      max_bonus: val('pmMaxBonus'),
      min_deposit: val('pmMinDep'),
      case_id: val('pmCase'),
      case_count: val('pmCaseCount'),
      wager_multiplier: val('pmWager'),
      max_uses: val('pmMaxUses'),
      per_user_limit: val('pmPerUser'),
      partner_id: val('pmPartner') || null,
      starts_at: dateMs(val('pmFrom'), false),
      expires_at: dateMs(val('pmTo'), true),
      new_players_only: document.getElementById('pmNewOnly').checked,
      note: val('pmNote'),
    });
    toast(r.created ? `Промокод ${r.code} создан` : `Промокод ${r.code} обновлён`);
    haptic('success');
    loadAdminPromos();
  } catch (err) { toast(err.message); haptic('error'); }
}

/* ---------- Админка: партнёры ---------- */

async function loadAdminPartners() {
  let d;
  try { d = await api('/api/admin/partners'); }
  catch (err) { toast(err.message); return; }

  const box = document.getElementById('admin-partners');

  box.innerHTML = `
    <div class="admin-form">
      <div class="form-grid">
        <div><label>Telegram ID</label>
          <input class="seed-input" id="ptTg" inputmode="numeric" placeholder="123456789"></div>
        <div><label>Доля, %</label>
          <input class="seed-input" id="ptShare" type="number" min="0" max="100" value="30"></div>
        <div class="wide"><label>Имя</label>
          <input class="seed-input" id="ptName" maxlength="80"></div>
        <div class="wide"><label>Заметка</label>
          <input class="seed-input" id="ptNote" maxlength="200"></div>
      </div>
      <button class="btn btn-primary btn-wide" id="ptSave">Сохранить партнёра</button>
      <div class="kpi-sub" style="margin-top:8px">
        Партнёр видит свою статистику в приложении под этим же Telegram ID.
        Игроки привязываются к нему промокодом: у промокода надо выбрать партнёра.
      </div>
    </div>

    <h2 class="section-title">Партнёры</h2>
    ${d.rows.length ? d.rows.map(partnerRowHtml).join('') : '<div class="empty">Пока пусто</div>'}
  `;

  document.getElementById('ptSave').addEventListener('click', async () => {
    try {
      await api('/api/admin/partner/save', {
        tg_id: document.getElementById('ptTg').value,
        share_pct: document.getElementById('ptShare').value,
        name: document.getElementById('ptName').value,
        note: document.getElementById('ptNote').value,
      });
      toast('Партнёр сохранён');
      haptic('success');
      loadAdminPartners();
    } catch (err) { toast(err.message); haptic('error'); }
  });

  box.querySelectorAll('[data-pay-partner]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.payPartner);
      const input = box.querySelector(`[data-pay-amount="${id}"]`);
      try {
        await api('/api/admin/partner/pay', { partnerId: id, amount: Number(input.value) });
        toast('Выплата записана');
        haptic('success');
        loadAdminPartners();
      } catch (err) { toast(err.message); haptic('error'); }
    });
  });
}

function partnerRowHtml(s) {
  const p = s.partner;
  return `<div class="promo-row ${p.is_active ? '' : 'off'}" style="flex-direction:column;align-items:stretch">
    <div style="display:flex;justify-content:space-between;gap:10px">
      <div>
        <div class="promo-code">${esc(p.name || 'Партнёр')}</div>
        <div class="promo-meta">ID ${esc(p.tg_id)} · доля ${p.share_pct}%
          · рефералов ${fmt(s.referrals)} (играли ${fmt(s.active)})</div>
      </div>
      <div style="text-align:right">
        <div class="promo-code">${money(Math.max(0, s.pending))}</div>
        <div class="promo-meta">к выплате</div>
      </div>
    </div>
    <div class="promo-meta" style="margin-top:8px">
      ставки ${money(s.wagered)} · выигрыши ${money(s.paid)} · бонусы ${money(s.bonuses)}
      · прибыль ${s.profit >= 0 ? '' : '-'}${money(Math.abs(s.profit))}
      · начислено ${money(s.accrued)} · выплачено ${money(s.paidOut)}
    </div>
    <div class="amount-row" style="margin-top:10px">
      <input class="seed-input" type="number" min="1" data-pay-amount="${p.id}"
             value="${Math.max(0, s.pending)}" placeholder="сумма">
      <button class="btn btn-primary btn-sm" data-pay-partner="${p.id}">Выплатить</button>
    </div>
  </div>`;
}

/* ---------- Админка: заявки на вывод ---------- */

async function loadAdminPayouts() {
  let d;
  try { d = await api('/api/admin/payouts', { status: state.admin.payoutStatus || 'pending' }); }
  catch (err) { toast(err.message); return; }

  const box = document.getElementById('payoutAdminList');
  const s = d.stats;

  const head = `<div class="admin-kpis">
    <div class="kpi"><div class="kpi-label">Ожидают решения</div>
      <div class="kpi-value">${fmt(s.pendingCount)}</div>
      <div class="kpi-sub">на ${money(s.pendingSum)}</div></div>
    <div class="kpi"><div class="kpi-label">Выплачено всего</div>
      <div class="kpi-value minus">${money(s.paidSum)}</div></div>
    <div class="kpi"><div class="kpi-label">В работе</div>
      <div class="kpi-value">${fmt(s.processingCount)}</div>
      <div class="kpi-sub">на ${money(s.processingSum)}</div></div>
  </div>`;

  if (!d.rows.length) {
    box.innerHTML = head + '<div class="empty">Заявок нет</div>';
    return;
  }

  box.innerHTML = head + d.rows.map((p) => {
    const name = p.username ? '@' + p.username : (p.first_name || ('#' + p.user_id));
    return `<div class="payout-row admin ${p.status}">
      <div class="payout-head">
        <b>${money(p.amount)}</b>
        <span class="payout-status ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <div class="payout-date">${esc(name)} · ID ${p.tg_id} ·
        баланс ${money(p.balance)} · ${new Date(p.created_at).toLocaleString('ru-RU')}</div>
      <div class="payout-requisites">${payoutRequisites(p, { full: true })}</div>
      ${p.comment ? `<div class="payout-comment">${esc(p.comment)}</div>` : ''}
      ${p.status === 'pending' ? `
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="processing" data-id="${p.id}">Взять в работу</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${p.id}">Отклонить</button>
        </div>` : p.status === 'processing' ? `
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="paid" data-id="${p.id}">Выполнено</button>
        </div>` : ''}
    </div>`;
  }).join('');

  box.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const note = box.querySelector(`[data-note="${id}"]`)?.value || '';
      const status = btn.dataset.resolve;

      if (status === 'rejected' && !note.trim()) {
        toast('Укажите причину отклонения - игрок её увидит');
        return;
      }

      try {
        await api('/api/admin/payout/resolve', { id, status, comment: note });
        toast(status === 'paid' ? 'Заявка выполнена' : status === 'processing' ? 'Заявка поставлена в работу' : 'Заявка отклонена, средства возвращены');
        haptic('success');
        loadAdminPayouts();
      } catch (err) { toast(err.message); haptic('error'); }
    });
  });
}

document.querySelectorAll('[data-payout-status]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.admin.payoutStatus = btn.dataset.payoutStatus;
    document.querySelectorAll('[data-payout-status]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadAdminPayouts();
  });
});

document.getElementById('adminSearchBtn').addEventListener('click', () => {
  state.admin.query = document.getElementById('adminSearch').value.trim();
  loadAdminUsers();
});

/* ============================================================
   КАССА
   ============================================================ */

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  window.scrollTo({ top: 0 });

  state.view = name;
  markSideNav(name);

  if (name === 'fair') renderFair();
  if (name === 'wallet') {
    loadWallet();
    track('cashier_view');
    // На компьютере касса стоит в две колонки, и правая - это открытая панель.
    // Без неё половина экрана пустует, поэтому пополнение раскрыто сразу:
    // за ним в кассу и приходят.
    if (window.matchMedia('(min-width: 1024px)').matches) {
      const deposit = document.getElementById('walletDepositPane');
      const withdraw = document.getElementById('walletWithdrawPane');
      if (deposit.hidden && withdraw.hidden) deposit.hidden = false;
    }
  }
  if (name === 'roulette') renderRouletteReel(2);
  if (name === 'admin') loadAdminOverview();
  if (name === 'cases') loadFreeCase();
  if (name === 'bonuses') { renderBonuses(); loadPromoState(); }
  if (name === 'partner') loadPartner();
  if (name === 'upgrade') {
    renderUpgradeTicks();
    renderUpgradePicker();
    renderUpgradeStage();
  }
}

/* ============================================================
   МЕНЮ
   ============================================================ */

/**
 * Разделы меню.
 *
 * Нижней панели больше нет: на неё уходила полоса экрана, а разделов стало
 * больше, чем в неё помещается. Вместо этого — кнопка-сетка в шапке и
 * плитки во весь экран.
 */
/**
 * Меню собрано поверх присланной картинки.
 *
 * Раскладка, подписи и иконки нарисованы прямо на ней, поэтому здесь остались
 * только координаты кликабельных областей - в процентах от сторон картинки,
 * чтобы они не разъезжались ни на каком экране. Числа сняты с исходника
 * 788x998 по границам самих карточек.
 *
 * «Честности» в меню нет намеренно: ссылка на неё живёт в подвале.
 */
const MENU_HITS = [
  // Первый ряд: кейсы, апгрейд, краш.
  { view: 'cases',    left: 4.82,  top: 14.63, width: 28.77, height: 29.56 },
  { view: 'upgrade',  left: 35.62, top: 14.63, width: 28.77, height: 29.56 },
  { view: 'crash',    left: 66.42, top: 14.63, width: 28.77, height: 29.56 },
  // Второй ряд: рулетка, касса, бонусы.
  { view: 'roulette', left: 4.82,  top: 46.59, width: 28.77, height: 29.76 },
  { view: 'wallet',   left: 35.62, top: 46.59, width: 28.77, height: 29.76 },
  { view: 'bonuses',  left: 66.42, top: 46.59, width: 28.77, height: 29.76 },
];

/** Кнопка возврата, нарисованная в правом верхнем углу картинки. */
const MENU_BACK_HIT = { left: 85.20, top: 4.00, width: 10.00, height: 8.00 };

/** Широкая полоса «Поддержка» внизу картинки. */
const MENU_SUPPORT_HIT = { left: 4.82, top: 78.86, width: 90.36, height: 16.80 };

/** Аккаунт поддержки в телеграме. Он же стоит ссылкой в подвале. */
const SUPPORT_URL = COMPANY.support;

/**
 * Открывает чат с поддержкой.
 *
 * Внутри телеграма ссылку отдаём самому клиенту: openTelegramLink оставляет
 * пользователя в приложении. В обычном браузере такого моста нет, там открываем
 * новой вкладкой.
 */
function openSupport() {
  if (tg?.openTelegramLink) tg.openTelegramLink(SUPPORT_URL);
  else window.open(SUPPORT_URL, '_blank', 'noopener');
}

/**
 * Разделы, которых на картинке нет.
 *
 * Дорисовывать их в чужой макет нельзя, поэтому они идут обычными кнопками
 * под картинкой и только тем, кому положены.
 */
const MENU_EXTRA = [
  { view: 'partner', ico: 'people', title: 'Партнёру', sub: 'Ваши рефералы', partnerOnly: true },
  { view: 'admin', ico: 'admin', title: 'Админ', sub: 'Панель управления', adminOnly: true },
];

function renderMenu() {
  const photo = document.getElementById('menuPhoto');
  const extra = document.getElementById('menuExtra');
  if (!photo) return;

  // Старые области убираем, картинку оставляем на месте.
  photo.querySelectorAll('.menu-hit').forEach((el) => el.remove());

  const place = (el, hit) => {
    el.style.left = `${hit.left}%`;
    el.style.top = `${hit.top}%`;
    el.style.width = `${hit.width}%`;
    el.style.height = `${hit.height}%`;
  };

  for (const hit of MENU_HITS) {
    const btn = document.createElement('button');
    btn.className = 'menu-hit';
    btn.dataset.view = hit.view;
    btn.setAttribute('aria-label', hit.view);
    place(btn, hit);
    photo.appendChild(btn);
  }

  const back = document.createElement('button');
  back.className = 'menu-hit menu-hit-back';
  back.setAttribute('aria-label', 'Закрыть меню');
  place(back, MENU_BACK_HIT);
  back.addEventListener('click', closeMenu);
  photo.appendChild(back);

  const support = document.createElement('button');
  support.className = 'menu-hit menu-hit-support';
  support.id = 'menuSupport';
  support.setAttribute('aria-label', 'Поддержка');
  place(support, MENU_SUPPORT_HIT);
  support.addEventListener('click', () => {
    closeMenu();
    haptic('light');
    openSupport();
  });
  photo.appendChild(support);

  extra.innerHTML = MENU_EXTRA
    .filter((m) => (!m.adminOnly || state.user?.isAdmin)
                && (!m.partnerOnly || state.user?.isPartner))
    .map((m) => `<button class="menu-tile" data-view="${m.view}">
      <span class="menu-tile-ico" data-ico="${m.ico}"></span>
      <span class="menu-tile-title">${m.title}</span>
      <span class="menu-tile-sub">${m.sub}</span>
    </button>`).join('');
  mountIcons(extra);

  document.querySelectorAll('#menuPhoto [data-view], #menuExtra [data-view]')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.crash && !state.crash.finished && btn.dataset.view !== 'crash') {
          toast('Сначала закончите раунд краша');
          return;
        }
        closeMenu();
        switchView(btn.dataset.view);
        haptic('light');
      });
    });
}

/* ============================================================
   БОКОВОЕ МЕНЮ ДЛЯ КОМПЬЮТЕРА
   ============================================================ */

/*
 * На телефоне навигация - меню-картинка: шесть плиток, нарисованных на
 * присланном макете. На широком экране она не работает: картинка либо
 * растягивается на половину монитора, либо болтается посреди пустоты, и в
 * обоих случаях выглядит как телефонное приложение, открытое не там.
 *
 * Поэтому для компьютера навигация своя - постоянная боковая панель. Разделы
 * те же и в том же порядке, что на картинке: игрок, пришедший с телефона,
 * находит их на привычных местах.
 */
/* Подписи те же, что нарисованы на картинке меню: игрок, пришедший с телефона,
   читает на компьютере ровно то, к чему привык. */
const SIDE_NAV = [
  { view: 'cases', ico: 'cases', title: 'Кейсы', sub: 'Открыть и крутить' },
  { view: 'upgrade', ico: 'x2', title: 'Апгрейд', sub: 'Поднять ставку' },
  { view: 'crash', ico: 'crash', title: 'Краш', sub: 'Успеть забрать' },
  { view: 'roulette', ico: 'roulette', title: 'Рулетка', sub: 'Красное и чёрное' },
  { view: 'wallet', ico: 'coin', title: 'Касса', sub: 'Пополнить и вывести' },
  { view: 'bonuses', ico: 'gift', title: 'Бонусы', sub: 'Получить награды' },
  { view: 'fair', ico: 'fair', title: 'Честность' },
  { view: 'partner', ico: 'people', title: 'Партнёру', partnerOnly: true },
  { view: 'admin', ico: 'admin', title: 'Админ', adminOnly: true },
];

/*
 * Значки для бокового меню вырезаются из той же картинки, что и мобильное меню.
 *
 * Просили «взять дизайн мобильного меню и адаптировать»: буквально взять
 * плитку целиком нельзя - в неё вшита подпись, и в колонке шириной с палец она
 * превратилась бы в нечитаемую полоску. Поэтому из плитки берётся только
 * рисунок, а подпись набирается текстом в том же строе, что на картинке.
 *
 * Рамка рисунка внутри плитки: по горизонтали 18% отступа с каждой стороны,
 * по вертикали от 6% до 62% высоты. Числа сняты с самой картинки.
 */
const MENU_ART_INSET = { x: 0.18, top: 0.06, height: 0.56 };

function menuArtStyle(view) {
  const hit = MENU_HITS.find((h) => h.view === view);
  if (!hit) return '';

  const left = hit.left + hit.width * MENU_ART_INSET.x;
  const width = hit.width * (1 - MENU_ART_INSET.x * 2);
  const top = hit.top + hit.height * MENU_ART_INSET.top;
  const height = hit.height * MENU_ART_INSET.height;

  // Проценты в background-position считаются от разницы размеров, а не от
  // самой картинки: отсюда деление на (100 - размер выреза).
  const posX = width >= 100 ? 0 : (left / (100 - width)) * 100;
  const posY = height >= 100 ? 0 : (top / (100 - height)) * 100;

  return `background-image:url(/assets/menu.webp);` +
    `background-size:${(100 / width) * 100}% ${(100 / height) * 100}%;` +
    `background-position:${posX.toFixed(3)}% ${posY.toFixed(3)}%`;
}

function renderSideNav() {
  const nav = document.getElementById('sideNav');
  if (!nav) return;

  const items = SIDE_NAV.filter((m) => (!m.adminOnly || state.user?.isAdmin)
                                    && (!m.partnerOnly || state.user?.isPartner));

  const icon = (m) => {
    const art = menuArtStyle(m.view);
    // У разделов, которых на картинке нет (честность, партнёр, админ),
    // остаётся собственная иконка - дорисовывать их в чужой макет нельзя.
    return art
      ? `<span class="side-art" style="${art}"></span>`
      : `<span class="side-ico" data-ico="${m.ico}"></span>`;
  };

  nav.innerHTML = `
    <div class="side-brand">
      <span class="side-brand-mark" data-ico="bolt"></span>
      <span class="side-brand-text">LUCKY<span>BOX</span></span>
    </div>
    <nav class="side-list">
      ${items.map((m) => `<button class="side-item ${menuArtStyle(m.view) ? 'has-art' : ''}"
          data-view="${m.view}">
        ${icon(m)}
        <span class="side-text">
          <span class="side-title">${m.title}</span>
          ${m.sub ? `<span class="side-sub">${m.sub}</span>` : ''}
        </span>
      </button>`).join('')}
    </nav>
    <button class="side-support" id="sideSupport">
      <span class="side-ico" data-ico="telegram"></span>
      <span class="side-text"><span class="side-title">Поддержка</span></span>
    </button>
  `;
  mountIcons(nav);

  nav.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Тот же запрет, что в меню-картинке: уйти с недоигранного краша нельзя,
      // иначе ставка останется висеть, а игрок решит, что её съели.
      if (state.crash && !state.crash.finished && btn.dataset.view !== 'crash') {
        toast('Сначала закончите раунд краша');
        return;
      }
      switchView(btn.dataset.view);
    });
  });

  nav.querySelector('#sideSupport').addEventListener('click', openSupport);
  markSideNav();
}

/** Подсвечивает раздел, в котором игрок сейчас находится. */
function markSideNav(name = state.view) {
  document.querySelectorAll('#sideNav .side-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
  });
}

function openMenu() {
  renderMenu();
  document.getElementById('menuBackdrop').hidden = false;
  haptic('light');
}

function closeMenu() {
  document.getElementById('menuBackdrop').hidden = true;
}

document.getElementById('menuBtn').addEventListener('click', openMenu);
document.getElementById('menuBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'menuBackdrop') closeMenu();
});

document.getElementById('topDeposit').addEventListener('click', () => {
  haptic('light');
  openCashier();
});

document.getElementById('balanceChip').addEventListener('click', () => {
  if (state.crash && !state.crash.finished) {
    toast('Сначала закончите раунд краша');
    return;
  }
  haptic('light');
  switchView('wallet');
});

const STATUS_LABEL = {
  pending: 'Новая',
  processing: 'В работе',
  paid: 'Выполнено',
  rejected: 'Отклонено',
  cancelled: 'Отменена вами',
};

const SOURCE_LABEL = {
  start: 'Стартовый баланс',
  admin: 'Начисление администратором',
  beeline: 'Пополнение',
  crypto: 'Пополнение криптовалютой',
  promo: 'Бонус по промокоду',
  welcome: 'Бонус за первое пополнение',
};

/** То же предложение, что на первом экране, но внутри кассы. */
function renderDepositOffer() {
  const el = document.getElementById('depositOffer');
  if (!el) return;

  const rules = state.config?.firstDeposit;
  const shown = rules && rules.pct > 0 && state.user && !state.user.depositsCount;
  el.hidden = !shown;
  if (!shown) return;

  const cap = rules.max > 0 ? ` (не больше ${money(rules.max)})` : '';
  el.innerHTML = `<b>Первое пополнение +${rules.pct}%${cap}.</b>
    Бонус придёт вместе с самим пополнением от ${money(rules.min)}.
    Вывести его можно после ставок на ${rules.wager} суммы бонуса.`;
}

async function loadWallet() {
  let w;
  try { w = await api('/api/wallet'); }
  catch (err) { toast(err.message); return; }

  state.wallet = w;
  renderDepositOffer();

  document.getElementById('walletBalance').textContent = money(w.balance);
  document.getElementById('walletRows').innerHTML = `
    <div class="wallet-row"><span>Доступно к выводу</span><b>${money(w.available)}</b></div>
    ${w.pending ? `<div class="wallet-row pending"><span>В обработке</span>
      <b>${money(w.pending)}</b></div>` : ''}
    <div class="wallet-row"><span>Минимальная сумма вывода</span><b>${money(w.minPayout)}</b></div>
  `;

  document.getElementById('depositList').innerHTML = w.deposits.length
    ? w.deposits.map((d) => `<div class="log-row">
        <span>${esc(d.comment || SOURCE_LABEL[d.source] || 'Пополнение')}<br>
          <small>${new Date(d.created_at).toLocaleString('ru-RU')}</small></span>
        <b class="plus">+${money(d.amount)}</b>
      </div>`).join('')
    : '<div class="empty">Пополнений пока не было</div>';

  // Пустой баланс - тупик ровно так же, как «не хватает» в кейсе: смотреть
  // в кассе не на что, и уйти из неё некуда. Кнопка открывает пополнение.
  if (!w.balance && !w.deposits.length) {
    document.getElementById('depositList').innerHTML =
      `<div class="empty">Пополнений пока не было<br>
        <button class="btn btn-primary" id="emptyDeposit" style="margin-top:12px">Пополнить</button>
      </div>`;
    document.getElementById('emptyDeposit').onclick = () => { haptic('light'); openCashier(); };
  }

  renderPayoutList(w.payouts);
  loadPayments();

  /*
   * Игроку важно не только сколько доступно, но и почему ноль. Молчаливое
   * «доступно 0» при полном балансе читается как поломка, поэтому условие
   * названо прямо здесь, с конкретным числом, а не спрятано в правилах.
   */
  document.getElementById('withdrawHint').innerHTML =
    `Доступно <b>${money(w.available)}</b> · минимум ${money(w.minPayout)}`
    + (w.depositDebt > 0
      ? `<span class="withdraw-locked">Пополнение нужно прокрутить через ставки:
           осталось поставить ${money(w.depositDebt)}. После этого выводится
           весь баланс, включая выигрыш.</span>`
      : '');
}

/**
 * Реквизиты заявки на вывод одной строкой.
 *
 * Общий для истории игрока и для админки: писать это в двух местах значило бы
 * однажды показать администратору не тот адрес, что видел игрок. Адрес
 * кошелька не сокращаем - именно по нему человек и отправляет перевод, и
 * многоточие посередине здесь означало бы потерянные деньги.
 */
function payoutRequisites(p, { full = false } = {}) {
  if (p.method === 'crypto') {
    const coin = esc(p.crypto_currency || '');
    const amount = p.crypto_amount ? ` · <b>${esc(p.crypto_amount)} ${coin}</b>` : '';
    const rate = full && p.crypto_rate
      ? `<span class="payout-rate">курс на момент заявки: ${Number(p.crypto_rate)
          .toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽</span>` : '';
    return `${coinMark(p.crypto_currency, 18)} ${coin} · ${esc(p.crypto_network || '')}${amount}`
      + `<span class="payout-address">${esc(p.crypto_address || '')}</span>${rate}`;
  }
  if (p.method === 'card') {
    const digits = String(p.card_number || '');
    return full
      ? `Банковская карта<br>${esc(digits.replace(/(.{4})/g, '$1 ').trim())}`
      : `Карта ···· ${esc(digits.slice(-4))}`;
  }
  return `${full ? 'СБП<br>' : 'СБП · '}${esc(p.phone || '')} · ${esc(p.bank || '')}`;
}

function renderPayoutList(payouts) {
  const box = document.getElementById('payoutList');
  if (!payouts.length) {
    box.innerHTML = '<div class="empty">Заявок пока не было</div>';
    return;
  }

  box.innerHTML = payouts.map((p) => `
    <div class="payout-row ${p.status}">
      <div class="payout-head">
        <b>${money(p.amount)}</b>
        <span class="payout-status ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <div class="payout-date">${new Date(p.created_at).toLocaleString('ru-RU')}</div>
      <div class="payout-requisites">${payoutRequisites(p)}</div>
      ${p.comment ? `<div class="payout-comment">${esc(p.comment)}</div>` : ''}
      ${p.status === 'pending'
        ? `<button class="btn btn-outline btn-sm payout-cancel" data-cancel="${p.id}">Отменить</button>`
        : ''}
    </div>`).join('');

  // Кнопка отмены есть только у заявок в обработке: после решения
  // администратора отменять уже нечего.
  box.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const r = await api('/api/payout/cancel', { id: Number(btn.dataset.cancel) });
        applyUser(r.user);
        toast('Заявка отменена, средства возвращены');
        sndCollect();
        haptic('success');
        loadWallet();
      } catch (err) { toast(err.message); haptic('error'); }
    });
  });
}

document.getElementById('walletDeposit').addEventListener('click', () => {
  const pane = document.getElementById('walletDepositPane');
  document.getElementById('walletWithdrawPane').hidden = true;
  pane.hidden = !pane.hidden;
  haptic('light');
});

document.querySelectorAll('[data-bank]').forEach((btn) => btn.addEventListener('click', () => {
  state.paymentBank = btn.dataset.bank;
  document.querySelectorAll('[data-bank]').forEach(b => b.classList.toggle('active', b === btn));
}));
document.querySelector('[data-bank="sber"]')?.classList.add('active');
/* ============================================================
   КРИПТОКАССА
   ============================================================ */

/*
 * Состояние криптокассы держим в одном месте: список монет приходит от шлюза
 * один раз и нужен сразу двум экранам - пополнению и выводу. Тянуть его
 * дважды значило бы показать в них разные наборы монет, если между запросами
 * что-то поменялось в кабинете.
 */
const cryptoState = {
  loaded: false, enabled: false, coins: [], rates: {}, min: 500, max: 500000,
  deposit: { currency: null, network: null },
  withdraw: { currency: null, network: null },
};

/**
 * Сколько знаков после запятой показывать у монеты.
 *
 * У биткоина хватает пяти, у Shiba Inu их нужно ноль - её курс меньше копейки,
 * и «0.00» вместо суммы выглядит поломкой. Считаем от самого курса: чем монета
 * дешевле, тем больше знаков.
 */
function coinDecimals(rate) {
  if (!rate || rate <= 0) return 4;
  if (rate >= 100000) return 6;
  if (rate >= 1000) return 4;
  if (rate >= 10) return 2;
  if (rate >= 0.1) return 1;
  return 0;
}

function coinAmount(rub, currency) {
  const rate = cryptoState.rates[currency];
  if (!rate || !rub) return null;
  const value = rub / rate;
  return value.toFixed(coinDecimals(rate));
}

/** Курс монеты словами: «1 USDT = 86,15 ₽». */
function rateLine(currency) {
  const rate = cryptoState.rates[currency];
  if (!rate) return '';
  const digits = rate >= 100 ? 0 : rate >= 1 ? 2 : 6;
  return `1 ${currency} = ${rate.toLocaleString('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: digits })} ₽`;
}

async function loadCryptoOptions() {
  if (cryptoState.loaded) return cryptoState;
  try {
    const data = await api('/api/crypto/options');
    Object.assign(cryptoState, {
      loaded: true,
      enabled: !!data.enabled,
      coins: data.coins || [],
      rates: data.rates || {},
      min: data.min ?? 500,
      max: data.max ?? 500000,
    });
  } catch {
    cryptoState.loaded = true;
    cryptoState.enabled = false;
  }
  return cryptoState;
}

/** Сетка монет. Одна и та же и для пополнения, и для вывода. */
function renderCoinGrid(el, side) {
  const pick = cryptoState[side];
  el.innerHTML = cryptoState.coins.map((c) => `
    <button type="button" class="coin-card${c.currency === pick.currency ? ' active' : ''}"
            data-coin="${c.currency}" style="--coin:${coinColor(c.currency)}">
      ${coinMark(c.currency, 34)}
      <span class="coin-code">${c.currency}</span>
      <span class="coin-name">${esc(c.name)}</span>
    </button>`).join('');

  el.querySelectorAll('.coin-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCoin(side, btn.dataset.coin);
      haptic('light');
    });
  });
}

/**
 * Выбор монеты и её сети.
 *
 * Сети уходят в выпадающий список, а не в общий ряд кнопок: у USDT их восемь,
 * и в одну ленту с монетами они превратились бы в список из тридцати с лишним
 * плиток, где не видно, где кончается одна монета и начинается другая.
 * Список сетей показывается только когда их больше одной - у биткоина
 * выбирать не из чего.
 */
function selectCoin(side, currency) {
  const coin = cryptoState.coins.find((c) => c.currency === currency);
  if (!coin) return;

  cryptoState[side].currency = currency;
  cryptoState[side].network = coin.networks[0]?.network || null;

  const isDeposit = side === 'deposit';
  const grid = document.getElementById(isDeposit ? 'coinGrid' : 'withdrawCoinGrid');
  grid.querySelectorAll('.coin-card').forEach((b) =>
    b.classList.toggle('active', b.dataset.coin === currency));

  const select = document.getElementById(isDeposit ? 'coinNetworkSelect' : 'withdrawNetwork');
  // У части сетей понятное имя совпадает с кодом (TRON, SOL) - «TRON · TRON»
  // выглядит опечаткой, поэтому код дописывается только когда он добавляет смысл.
  select.innerHTML = coin.networks.map((n) =>
    `<option value="${n.network}">${esc(n.name)}${
      n.name.toUpperCase() === n.network ? '' : ` · ${n.network}`}</option>`).join('');

  if (isDeposit) {
    // У монеты с единственной сетью выбирать нечего - список прячем.
    document.getElementById('coinNetwork').hidden = coin.networks.length < 2;
  } else {
    select.parentElement.querySelector('label[for="withdrawNetwork"]').hidden =
      coin.networks.length < 2;
    select.hidden = coin.networks.length < 2;
  }

  refreshCryptoRate(side);
}

/** Строка «получите примерно столько-то» под суммой. */
function refreshCryptoRate(side) {
  const isDeposit = side === 'deposit';
  const box = document.getElementById(isDeposit ? 'cryptoRate' : 'withdrawRate');
  const currency = cryptoState[side].currency;
  if (!box) return;

  if (!currency) { box.innerHTML = ''; return; }

  const rub = Number(document.getElementById(isDeposit ? 'cryptoAmount' : 'withdrawAmount')?.value);
  const amount = coinAmount(rub, currency);
  const course = rateLine(currency);

  if (!amount) {
    box.innerHTML = course ? `<span class="rate-course">${course}</span>` : '';
    return;
  }

  box.innerHTML = `
    <span class="rate-amount">${coinMark(currency, 20)} ≈ ${amount} ${currency}</span>
    <span class="rate-course">${course}</span>
    <span class="rate-note">${isDeposit
      ? 'Точную сумму к переводу назовёт шлюз. Зачислим по факту пришедшего: '
        + 'заплатите больше - получите больше'
      : 'Итоговая сумма считается по курсу на момент заявки'}</span>`;
}

/** Быстрые суммы: чаще всего пополняют круглыми, набирать их руками незачем. */
function renderCryptoQuick() {
  const row = document.getElementById('cryptoQuick');
  const input = document.getElementById('cryptoAmount');
  const sums = [1000, 3000, 5000, 10000].filter((v) =>
    v >= cryptoState.min && v <= cryptoState.max);
  row.innerHTML = sums.map((v) =>
    `<button type="button" class="quick-btn" data-sum="${v}">${money(v)}</button>`).join('');
  row.querySelectorAll('.quick-btn').forEach((b) => b.addEventListener('click', () => {
    input.value = b.dataset.sum;
    refreshCryptoRate('deposit');
    haptic('light');
  }));
}

async function openCryptoDeposit() {
  const box = document.getElementById('cryptoCreate');
  document.getElementById('paymentCreate').hidden = true;
  document.getElementById('paymentCheckout').hidden = true;
  box.hidden = false;

  await loadCryptoOptions();
  if (!cryptoState.enabled || !cryptoState.coins.length) {
    box.innerHTML = '<p class="empty">Криптокасса временно недоступна. Попробуйте позже.</p>';
    return;
  }

  renderCoinGrid(document.getElementById('coinGrid'), 'deposit');
  renderCryptoQuick();
  document.getElementById('cryptoAmount').placeholder =
    `Сумма пополнения, ₽ (от ${money(cryptoState.min)})`;
  selectCoin('deposit', cryptoState.deposit.currency || cryptoState.coins[0].currency);
}

document.getElementById('coinNetworkSelect')?.addEventListener('change', (e) => {
  cryptoState.deposit.network = e.target.value;
  refreshCryptoRate('deposit');
});

document.getElementById('withdrawNetwork')?.addEventListener('change', (e) => {
  cryptoState.withdraw.network = e.target.value;
});
document.getElementById('cryptoAmount')?.addEventListener('input', () => refreshCryptoRate('deposit'));

document.getElementById('cryptoCreateBtn')?.addEventListener('click', async () => {
  const { currency, network } = cryptoState.deposit;
  const amount = Number(document.getElementById('cryptoAmount').value);
  if (!currency || !network) return toast('Выберите монету и сеть');
  if (!amount || amount < cryptoState.min) return toast(`Минимум ${money(cryptoState.min)}`);

  const btn = document.getElementById('cryptoCreateBtn');
  btn.disabled = true;
  try {
    const payment = await api('/api/crypto/create', { amount, currency, network });
    showCryptoCheckout(payment);
    haptic('success');
  } catch (err) {
    toast(err.message);
    haptic('error');
  } finally {
    btn.disabled = false;
  }
});

/**
 * Экран оплаты: адрес, сумма в монете и обратный отсчёт.
 *
 * Адрес показывается крупно и копируется нажатием: переписывать его руками с
 * экрана телефона - верный способ потерять перевод.
 */
function showCryptoCheckout(p) {
  const box = document.getElementById('cryptoCheckout');
  document.getElementById('cryptoCreate').hidden = true;
  box.hidden = false;

  box.innerHTML = `
    <div class="crypto-invoice" style="--coin:${coinColor(p.currency)}">
      <div class="invoice-head">
        ${coinMark(p.currency, 44)}
        <div>
          <div class="invoice-sum">${p.payerAmount || '-'} ${p.currency}</div>
          <div class="invoice-sub">за ${money(p.amountRub)} · сеть ${esc(p.networkName)}</div>
        </div>
      </div>

      ${p.addressQr ? `
        <img class="invoice-qr" src="${p.addressQr}" alt="QR-код адреса"
             width="180" height="180" decoding="async">` : ''}

      ${p.address ? `
        <div class="field-label">Адрес для перевода</div>
        <button class="invoice-address" id="cryptoCopy" type="button">
          <span>${esc(p.address)}</span><small>нажмите, чтобы скопировать</small>
        </button>` : ''}

      <div class="invoice-warn">Отправляйте только ${p.currency} в сети
        ${esc(p.networkName)}. Перевод в другой сети теряется без возврата.</div>

      ${p.payUrl ? `<a class="btn btn-primary btn-wide" href="${p.payUrl}"
         target="_blank" rel="noopener">Открыть страницу оплаты</a>` : ''}

      <button class="btn btn-outline btn-wide" id="cryptoCheck">Я оплатил, проверить</button>
      <button class="btn btn-outline btn-wide" id="cryptoBack">Другой способ</button>
      <div class="invoice-status" id="cryptoStatus"></div>
    </div>`;

  document.getElementById('cryptoCopy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(p.address).then(
      () => toast('Адрес скопирован'), () => toast('Скопируйте адрес вручную'));
    haptic('light');
  });

  document.getElementById('cryptoBack').addEventListener('click', () => {
    box.hidden = true;
    openCryptoDeposit();
  });

  document.getElementById('cryptoCheck').addEventListener('click', async () => {
    const status = document.getElementById('cryptoStatus');
    status.textContent = 'Спрашиваем шлюз…';
    try {
      const r = await api('/api/crypto/refresh', { id: p.id });
      if (r.credited) {
        applyUser(r.user);
        status.textContent = 'Платёж зачислен.';
        toast('Платёж зачислен');
        sndCollect(); haptic('success');
        loadWallet();
      } else {
        status.textContent = r.payment?.paidAt
          ? 'Платёж уже был зачислен.'
          : 'Перевод ещё не пришёл. Это может занять несколько минут.';
      }
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

document.querySelector('[data-payment-method="crypto"]')?.addEventListener('click', () => {
  document.querySelectorAll('[data-payment-method]').forEach((b) =>
    b.classList.toggle('active', b.dataset.paymentMethod === 'crypto'));
  openCryptoDeposit();
});

document.querySelector('[data-payment-method="card"]')?.addEventListener('click', () => {
  document.querySelectorAll('[data-payment-method]').forEach((b) =>
    b.classList.toggle('active', b.dataset.paymentMethod === 'card'));
  document.getElementById('cryptoCreate').hidden = true;
  document.getElementById('cryptoCheckout').hidden = true;
  document.getElementById('paymentCreate').hidden = false;
});

async function loadPayments() {
  try {
    const { rows } = await api('/api/payments/list');
    document.getElementById('paymentList').innerHTML = rows.length ? rows.map(p => `
      <div class="payment-history"><div class="payout-head"><b>Заявка #${p.id} · ${money(p.original_amount)}</b>
      <span class="payment-status ${p.status}">${p.status}</span></div>
      <small>К оплате ${money(p.payable_amount)} · ${new Date(p.created_at).toLocaleString('ru-RU')}</small></div>`).join('') : '';
    const active = rows.find(p => p.status === 'PENDING'); if (active) showPayment(active);
  } catch (err) { toast(err.message); }
}

async function loadAdminPayments() {
  try { const d=await api('/api/admin/payments',{status:'ALL'}); const x=d.dashboard;
    document.getElementById('adminPaymentList').innerHTML=`<div class="admin-kpis"><div class="kpi"><div class="kpi-label">Оборот</div><div class="kpi-value">${money(x.turnover)}</div></div><div class="kpi"><div class="kpi-label">Успешно</div><div class="kpi-value">${x.paid}</div></div><div class="kpi"><div class="kpi-label">Ожидают / спорные</div><div class="kpi-value">${x.pending} / ${x.disputed}</div></div></div>${d.rows.map(p=>`<div class="payment-history"><div class="payout-head"><b>#${p.id} · ${esc(p.username||p.first_name||p.tg_id)}</b><span class="payment-status ${p.status}">${p.status}</span></div><div>Введено: ${money(p.original_amount)} · к оплате: ${money(p.payable_amount)}</div><small>${esc(p.bank)} · ${new Date(p.created_at).toLocaleString('ru-RU')}${p.sms_message?`<br>SMS: ${esc(p.sms_message)}`:''}</small></div>`).join('')}`;
  }catch(err){toast(err.message);}
}
async function loadAdminSupport(){try{const d=await api('/api/admin/support');document.getElementById('adminSupportList').innerHTML=d.rows.length?d.rows.map(c=>`<button class="payment-history admin-chat-open" data-chat="${c.id}">#${c.id} · ${esc(c.username||c.first_name||c.tg_id)} · ${money(c.payable_amount)} <span class="payment-status ${c.payment_status}">${c.payment_status}</span>${c.unread_admin?` · непрочитано ${c.unread_admin}`:''}</button>`).join(''):'<div class="empty">Обращений нет</div>';document.querySelectorAll('.admin-chat-open').forEach(b=>b.onclick=()=>openAdminChat(Number(b.dataset.chat)));}catch(err){toast(err.message);}}
async function openAdminChat(chatId){const d=await api('/api/admin/support/chat',{chatId});const box=document.getElementById('adminSupportList');box.innerHTML=`<button class="btn btn-sm" id="supportBack">Назад</button>${d.messages.map(m=>`<div class="support-message ${m.sender_type}"><b>${m.sender_type}</b><br>${esc(m.text||m.attachment_name)}</div>`).join('')}<textarea class="seed-input" id="adminSupportText"></textarea><button class="btn btn-primary" id="adminSupportSend">Ответить</button>`;document.getElementById('supportBack').onclick=loadAdminSupport;document.getElementById('adminSupportSend').onclick=async()=>{await api('/api/admin/support/message',{chatId,text:document.getElementById('adminSupportText').value});openAdminChat(chatId);};}
async function loadAdminPaymentSettings(){try{const s=await api('/api/admin/payment-settings');const fields=[['beeline_phone','Номер Beeline'],['beeline_completed_limit','Лимит выполненных заявок, ₽ (0 — без лимита)'],['payment_ttl_minutes','Время жизни, мин'],['payment_markup_min','Надбавка от, ₽'],['payment_markup_max','Надбавка до, ₽'],['payment_min','Минимум, ₽'],['payment_max','Максимум, ₽']];const box=document.getElementById('adminPaymentSettings');box.innerHTML=`<div class="settings-grid">${fields.map(([k,l])=>`<label>${l}<input id="setting-${k}" value="${esc(s[k])}"></label>`).join('')}<p class="settings-help">Лимит считается отдельно по указанному номеру. Когда остаток меньше минимального пополнения, реквизит больше не выдаётся.</p><button class="btn btn-primary" id="savePaymentSettings">Сохранить</button></div><h3>Android-устройства</h3><div class="settings-grid device-register"><input id="deviceName" placeholder="Название, например Телефон кассы"><input id="deviceId" placeholder="ID, например beeline-1"><input id="deviceSecret" placeholder="Секрет — минимум 24 символа"><button class="btn btn-primary" id="registerDevice">Создать / обновить устройство</button></div><div id="deviceList"></div>`;document.getElementById('savePaymentSettings').onclick=async()=>{const values=Object.fromEntries(fields.map(([k])=>[k,document.getElementById(`setting-${k}`).value]));await api('/api/admin/payment-settings',{save:true,values});toast('Настройки сохранены');loadAdminPaymentSettings();};document.getElementById('registerDevice').onclick=async()=>{await api('/api/admin/payment-device/register',{name:document.getElementById('deviceName').value,deviceId:document.getElementById('deviceId').value,secret:document.getElementById('deviceSecret').value});toast('Устройство сохранено. Перенесите эти же ID и секрет в APK');loadAdminPaymentSettings();};const dev=await api('/api/admin/payment-devices');document.getElementById('deviceList').innerHTML=dev.rows.map(d=>`<div class="log-row"><span>${esc(d.name)}<br><small>${esc(d.device_id)}</small></span><b>${d.last_seen_at&&Date.now()-d.last_seen_at<300000?'● Online':'○ Offline'}</b></div>`).join('')||'<div class="empty">Добавьте первое устройство выше</div>';}catch(err){toast(err.message);}}

function showPayment(p) {
  state.payment = p; const box = document.getElementById('paymentCheckout'); box.hidden = false;
  document.getElementById('paymentCreate').hidden = true; clearInterval(state.paymentTimer);
  const paint = () => {
    const left = Math.max(0, p.expires_at - Date.now()), mm = String(Math.floor(left/60000)).padStart(2,'0'), ss=String(Math.floor(left/1000)%60).padStart(2,'0');
    if (!left) { clearInterval(state.paymentTimer); box.innerHTML='<h2>Вы не успели, повторите оплату снова</h2><button class="btn btn-primary" id="paidDispute">Я оплатил</button>'; document.getElementById('paidDispute').onclick=()=>openPaymentDispute(p.id); loadPayments(); return; }
    box.innerHTML=`<div>Время на оплату</div><div class="payment-timer">${mm}:${ss}</div><h2>Оплатите мобильную связь</h2>
      <div class="beeline-brand"><img src="${BEELINE_LOGO_SRC}" alt="Билайн"></div>
      <div class="payment-requisite"><span>Оператор</span><b>Beeline</b></div><div class="payment-requisite"><span>Номер</span><b>${esc(p.phone)}</b></div>
      <div class="payment-requisite"><span>Сумма</span><b>${money(p.payable_amount)}</b></div><p>Оплатите точную сумму на указанный номер. После получения платежа средства зачислятся автоматически.</p>`;
  }; paint(); state.paymentTimer=setInterval(paint,1000);
}
document.getElementById('paymentCreateBtn').addEventListener('click', async () => {
  try { const p=await api('/api/payments/create',{amount:Number(document.getElementById('paymentAmount').value),bank:state.paymentBank}); showPayment(p); loadPayments(); }
  catch(err){toast(err.message);haptic('error');}
});
async function openPaymentDispute(paymentId) {
  try { const chat=await api('/api/support/open',{paymentId}); const data=await api('/api/support/chat',{chatId:chat.id});
    const box=document.getElementById('paymentCheckout'); box.innerHTML=`<h2>Финансовая поддержка #${chat.id}</h2><div>${data.messages.map(m=>`<div class="support-message ${m.sender_type}">${esc(m.text||m.attachment_name)}</div>`).join('')}</div><textarea class="seed-input" id="supportText" placeholder="Сообщение"></textarea><input id="supportFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><button class="btn btn-primary" id="supportSend">Отправить</button>`;
    document.getElementById('supportSend').onclick=async()=>{let attachmentUrl,attachmentName;const f=document.getElementById('supportFile').files[0];if(f){const base64=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f)});const up=await api('/api/support/upload',{name:f.name,mime:f.type,base64});attachmentUrl=up.url;attachmentName=up.name;}await api('/api/support/message',{chatId:chat.id,text:document.getElementById('supportText').value,attachmentUrl,attachmentName});openPaymentDispute(paymentId);};
  } catch(err){toast(err.message);}
}

function startPaymentEvents(){
  /*
   * Поток событий имеет смысл только когда страницу отдаёт сервер. В
   * автономной сборке её открывают файлом с диска, сервера нет вовсе, и
   * EventSource там не подключается, а падает с ошибкой в консоли при каждом
   * запуске. Ждать от неё платежей всё равно нечего.
   */
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  const es=new EventSource(`/api/payments/events?initData=${encodeURIComponent(tg?.initData||'')}`);
  es.addEventListener('payment.completed',async()=>{clearInterval(state.paymentTimer);toast('Платёж успешно поступил. Средства зачислены на счёт.');sndCollect();haptic('success');const me=await api('/api/me');applyUser(me.user);loadWallet();});
}

document.getElementById('walletWithdraw').addEventListener('click', () => {
  const pane = document.getElementById('walletWithdrawPane');
  document.getElementById('walletDepositPane').hidden = true;
  pane.hidden = !pane.hidden;
  haptic('light');
});

document.getElementById('withdrawAll').addEventListener('click', () => {
  document.getElementById('withdrawAmount').value = state.wallet?.available || 0;
});

async function loadSbpBanks() {
  try {
    const data = await fetch('/sbp-banks.json').then(r => r.json());
    const select = document.getElementById('withdrawBank');
    select.insertAdjacentHTML('beforeend', data.banks.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join(''));
  } catch { /* Серверная валидация всё равно не даст создать заявку без банка. */ }
}
loadSbpBanks();

document.querySelectorAll('[data-withdraw-method]').forEach(btn => btn.addEventListener('click', async () => {
  state.withdrawMethod = btn.dataset.withdrawMethod;
  document.querySelectorAll('[data-withdraw-method]').forEach(x => x.classList.toggle('active', x === btn));
  document.getElementById('withdrawSbpFields').hidden = state.withdrawMethod !== 'sbp';
  document.getElementById('withdrawCardFields').hidden = state.withdrawMethod !== 'card';
  document.getElementById('withdrawCryptoFields').hidden = state.withdrawMethod !== 'crypto';

  if (state.withdrawMethod === 'crypto') {
    await loadCryptoOptions();
    if (!cryptoState.enabled || !cryptoState.coins.length) {
      toast('Вывод криптовалютой временно недоступен');
      return;
    }
    renderCoinGrid(document.getElementById('withdrawCoinGrid'), 'withdraw');
    selectCoin('withdraw', cryptoState.withdraw.currency || cryptoState.coins[0].currency);
  }
}));

// Сумма вводится в рублях, поэтому строку «получите примерно столько-то»
// пересчитываем на каждый ввод, а не только при выборе монеты.
document.getElementById('withdrawAmount')?.addEventListener('input', () => {
  if (state.withdrawMethod === 'crypto') refreshCryptoRate('withdraw');
});

document.getElementById('withdrawCard').addEventListener('input', (event) => {
  const digits = event.target.value.replace(/\D/g, '').slice(0, 19);
  event.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
});

document.getElementById('withdrawSubmit').addEventListener('click', async () => {
  const amount = Math.trunc(Number(document.getElementById('withdrawAmount').value));
  if (!amount || amount <= 0) { toast('Укажите сумму'); return; }

  try {
    const payload = { amount, method: state.withdrawMethod };
    if (state.withdrawMethod === 'sbp') {
      payload.phone = document.getElementById('withdrawPhone').value;
      payload.bank = document.getElementById('withdrawBank').value;
    } else if (state.withdrawMethod === 'crypto') {
      const { currency, network } = cryptoState.withdraw;
      if (!currency || !network) { toast('Выберите монету и сеть'); return; }
      /*
       * Курс и сумму в монете считает клиент, но сервер их не берёт на веру:
       * он проверяет, что курс положительный, и сохраняет обе величины в
       * заявку. Отправлять перевод будет человек, глядя на эти числа, поэтому
       * они должны быть теми же, что видел игрок в момент нажатия.
       */
      payload.cryptoCurrency = currency;
      payload.cryptoNetwork = network;
      payload.cryptoAddress = document.getElementById('withdrawAddress').value.trim();
      payload.cryptoAmount = coinAmount(amount, currency) || '';
      payload.cryptoRate = cryptoState.rates[currency] || 0;
    } else payload.cardNumber = document.getElementById('withdrawCard').value;
    const r = await api('/api/payout/create', payload);
    applyUser(r.user);
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('withdrawPhone').value = '';
    document.getElementById('withdrawCard').value = '';
    const addr = document.getElementById('withdrawAddress');
    if (addr) addr.value = '';
    toast(`Заявка на ${money(amount)} создана`);
    sndBet();
    haptic('success');
    loadWallet();
  } catch (err) { toast(err.message); haptic('error'); }
});

/* ============================================================
   ЛЕНТА ВЫИГРЫШЕЙ
   ============================================================ */

/**
 * Лента под шапкой. Показывает выпадения других игроков - и обычные, и
 * крупные: лента из сплошных джекпотов читается как реклама, а не как чужая
 * игра. Пропорцию задаёт сервер, см. FEED_BIG_SHARE в server/feed.js.
 *
 * ПОЧЕМУ НЕ ПЕРЕРИСОВЫВАЕМ ЦЕЛИКОМ. Раньше опрос заменял содержимое ленты
 * разом, и она моргала. Теперь новые выигрыши въезжают по одному слева,
 * сдвигая остальные вправо, — как настоящая живая лента.
 *
 * ПОЧЕМУ ОЧЕРЕДЬ. Сервер добавляет выигрыш каждые две секунды, но сеть
 * отвечает неровно: опрос с тем же периодом приносил бы то ноль записей,
 * то сразу две, и лента дёргалась бы. Поэтому опрос идёт реже и складывает
 * новое в очередь, а отдельный таймер достаёт оттуда ровно по одной штуке
 * раз в две секунды.
 *
 * Выигрыш самого игрока попадает в ленту так же, как чужие: сервер отдаёт
 * его из истории раундов. Чтобы он появился сразу, а не в следующий опрос,
 * после крупного выпадения дёргаем pollFeed() вручную.
 */
const FEED_LIMIT = 24;

/** Как часто спрашиваем сервер о новых выигрышах. */
const FEED_POLL_MS = 6000;

/** С каким шагом они въезжают в ленту. */
const FEED_STEP_MS = 2000;

/** Сколько карточек держим в DOM. */
const FEED_MAX_CARDS = 20;

/** Ключи уже показанных записей — иначе один выигрыш въехал бы дважды. */
const feedSeen = new Set();

/** Выигрыши, дождавшиеся своей очереди на показ. */
const feedQueue = [];

/**
 * Выпадения, показанные в ленте, по ключу карточки.
 *
 * Карточка хранит только ключ, а не всю запись: класть выигрыш в data-атрибут
 * значило бы держать в разметке то, что нужно исключительно коду, и заново
 * разбирать это при каждом нажатии.
 */
const feedDrops = new Map();

function feedCardHtml(drop) {
  const color = tierColor(drop.tier);
  const art = itemArt(drop.name, color) || iconTier(drop.tier, color);
  // Ников в карточке нет: витрина показывает выигрыш, а не того, кто его снял.
  return `<button class="feed-card is-new" data-drop="${esc(String(drop.id))}"
      style="--tier-color:${color}">
    <span class="feed-art">${art}</span>
    <span class="feed-name">${esc(drop.name)}</span>
    <span class="feed-value">${money(drop.value)}</span>
  </button>`;
}

/** Ставит одну карточку в начало ленты и убирает лишнее с хвоста. */
function pushFeedCard(drop, animate = true) {
  const track = document.getElementById('feedTrack');
  if (!track) return;

  feedDrops.set(String(drop.id), drop);
  track.insertAdjacentHTML('afterbegin', feedCardHtml(drop));
  if (!animate) track.firstElementChild.classList.remove('is-new');

  while (track.children.length > FEED_MAX_CARDS) {
    const gone = track.lastElementChild;
    feedDrops.delete(gone.dataset.drop);
    gone.remove();
  }
  document.getElementById('feed').hidden = false;
}

/**
 * Карточка выигрыша из ленты.
 *
 * Витрина показывает, что и сколько выпало, но не откуда - а именно это и
 * интересно: увидел крупное выпадение, хочешь тот же кейс. Поэтому нажатие
 * открывает карточку с обложкой кейса и кнопкой, которая ведёт прямо в него.
 */
function openFeedDrop(drop) {
  const c = state.config.cases.find((x) => x.id === drop.caseId);
  const backdrop = document.getElementById('feedBackdrop');
  const color = tierColor(drop.tier);

  backdrop.style.setProperty('--tier-color', color);
  document.getElementById('feedSheetTier').textContent =
    state.config.tiers.find((t) => t.id === drop.tier)?.label || '';
  document.getElementById('feedSheetName').textContent = drop.name;
  document.getElementById('feedSheetValue').textContent = money(drop.value);

  const cover = document.getElementById('feedSheetCover');
  cover.innerHTML = c ? caseCover(c) : '';
  if (c?.artGlow) {
    cover.style.setProperty('--art-glow', `hsl(${c.artGlow[0]} 95% 58% / 0.5)`);
    cover.style.setProperty('--art-glow-far', `hsl(${c.artGlow[1]} 90% 60% / 0.42)`);
  }

  document.getElementById('feedSheetCase').innerHTML = c
    ? `${esc(c.name)} · <span>${money(c.price)}</span>`
    : esc(drop.caseName || '');

  const openBtn = document.getElementById('feedSheetOpen');
  const closeBtn = document.getElementById('feedSheetClose');
  openBtn.hidden = !c;

  const close = () => {
    backdrop.hidden = true;
    openBtn.onclick = null;
    closeBtn.onclick = null;
    backdrop.onclick = null;
  };

  // Кнопки нет, если кейса в конфиге не нашлось: запись могла остаться в
  // ленте от версии, где такой кейс ещё был.
  openBtn.onclick = c ? () => { close(); openCase(c.id); } : null;
  closeBtn.onclick = () => { close(); haptic('light'); };
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  backdrop.hidden = false;
  haptic('light');
}

document.getElementById('feedTrack')?.addEventListener('click', (e) => {
  const card = e.target.closest('.feed-card');
  const drop = card && feedDrops.get(card.dataset.drop);
  if (drop) openFeedDrop(drop);
});

async function pollFeed() {
  let drops;
  try {
    const res = await fetch(`/api/feed?limit=${FEED_LIMIT}`);
    ({ drops } = await res.json());
  } catch {
    return; // Лента необязательна: молча ждём следующего опроса.
  }
  if (!drops?.length) return;

  // Первый заход наполняет ленту сразу, без анимации: пустая полоса,
  // которая заполняется по одной карточке за две секунды, выглядит поломкой.
  if (feedSeen.size === 0) {
    for (const d of drops.slice(0, FEED_MAX_CARDS).reverse()) {
      feedSeen.add(d.id);
      pushFeedCard(d, false);
    }
    for (const d of drops) feedSeen.add(d.id);
    return;
  }

  // Сервер отдаёт свежие первыми, а въезжать они должны в обратном порядке.
  for (const d of [...drops].reverse()) {
    if (feedSeen.has(d.id)) continue;
    feedSeen.add(d.id);
    feedQueue.push(d);
  }

  // Множество не должно расти бесконечно: помним только последнюю партию.
  if (feedSeen.size > 400) {
    feedSeen.clear();
    for (const d of drops) feedSeen.add(d.id);
  }
}

function startFeed() {
  pollFeed();
  if (state.feedTimers) state.feedTimers.forEach(clearInterval);
  state.feedTimers = [
    setInterval(pollFeed, FEED_POLL_MS),
    setInterval(() => {
      const next = feedQueue.shift();
      if (next) pushFeedCard(next);
    }, FEED_STEP_MS),
  ];
}

/* ============================================================
   БЕСПЛАТНЫЙ КЕЙС ЗА ПОДПИСКУ
   ============================================================ */

/**
 * Плитка появляется, только когда раздел настроен на сервере: заданы канал,
 * токен бота и выдаваемый кейс. Пока их нет, кнопки просто не существует —
 * лучше, чем висящая заглушка, которая ничего не делает.
 */
function renderFreeCase(info) {
  const btn = document.getElementById('freeCase');
  if (!btn) return;

  if (!info?.enabled) {
    btn.hidden = true;
    return;
  }

  const waiting = info.readyAt && Date.now() < info.readyAt;
  btn.hidden = false;
  btn.disabled = Boolean(waiting);
  document.getElementById('freeCaseSub').textContent = waiting
    ? `следующий ${new Date(info.readyAt).toLocaleString('ru-RU',
        { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
    : 'за подписку на канал';
}

async function loadFreeCase() {
  if (!state.config?.freeCase?.enabled) return;
  try {
    renderFreeCase(await api('/api/free-case/state'));
  } catch { /* раздел необязательный */ }
}

document.getElementById('freeCase').addEventListener('click', async () => {
  const btn = document.getElementById('freeCase');
  if (btn.disabled) return;
  btn.disabled = true;

  try {
    const res = await api('/api/free-case/claim');
    toast('Бесплатный кейс ваш - он в плашке сверху');
    sndCollect();
    haptic('success');
    const me = await api('/api/me');
    applyUser(me.user);
    renderFreeCase({ enabled: true, readyAt: res.readyAt });
  } catch (err) {
    toast(err.message);
    haptic('error');
    // Не подписан — открываем канал, чтобы не искать его руками.
    const url = state.config?.freeCase?.channelUrl;
    if (url && /подпиш/i.test(err.message)) {
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank', 'noopener');
    }
    btn.disabled = false;
  }
});

/* ============================================================
   ПРОМОКОДЫ
   ============================================================ */

const PROMO_TYPE_LABEL = {
  balance: 'на баланс',
  deposit_pct: 'процент к пополнению',
  free_case: 'бесплатный кейс',
};

/** Показывает, что именно дал промокод, словами, а не «код принят». */
function promoResultText(r) {
  if (r.type === 'balance') return `Начислено ${money(r.amount)}`;
  if (r.type === 'free_case') {
    return `Получено бесплатных открытий кейса «${r.caseName}»: ${r.count}`;
  }
  if (r.type === 'deposit_pct') {
    const parts = [`К следующему пополнению будет добавлено ${r.pct}%`];
    if (r.minDeposit) parts.push(`от ${money(r.minDeposit)}`);
    if (r.maxBonus) parts.push(`не более ${money(r.maxBonus)}`);
    return parts.join(', ');
  }
  return 'Промокод применён';
}

async function applyPromo() {
  const input = document.getElementById('promoInput');
  const box = document.getElementById('promoResult');
  const code = input.value.trim();
  if (!code) return;

  const btn = document.getElementById('promoBtn');
  btn.disabled = true;

  try {
    const data = await api('/api/promo/redeem', { code });
    box.textContent = promoResultText(data.result);
    box.className = 'promo-result';
    box.hidden = false;
    input.value = '';
    applyUser(data.user);
    renderBonuses();
    loadPromoState();
    sndCollect();
    haptic('success');
  } catch (err) {
    box.textContent = err.message;
    box.className = 'promo-result bad';
    box.hidden = false;
    haptic('error');
  }

  btn.disabled = false;
}

document.getElementById('promoBtn').addEventListener('click', applyPromo);
document.getElementById('promoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyPromo();
});

/** Долг по обороту, ожидающий процент и история активаций. */
async function loadPromoState() {
  let d;
  try { d = await api('/api/promo/state'); } catch { return; }

  const note = document.getElementById('wagerNote');
  const parts = [];
  if (d.wagerRequired > 0) {
    parts.push(`Бонус отыгрывается: осталось поставить <b>${money(d.wagerRequired)}</b>. ` +
      'Пока не отыграно, вывод недоступен. Отыгрывается ставками в любой игре.');
  }
  if (d.pendingDeposit) {
    const p = d.pendingDeposit;
    const limits = [
      p.min_deposit ? `от ${money(p.min_deposit)}` : '',
      p.max_bonus ? `не более ${money(p.max_bonus)}` : '',
    ].filter(Boolean).join(', ');
    parts.push(`К следующему пополнению будет добавлено <b>+${p.pct}%</b>` +
      (limits ? ` (${limits})` : '') + '.');
  }
  note.innerHTML = parts.join('<br><br>');
  note.hidden = !parts.length;

  const hist = document.getElementById('promoHistory');
  hist.innerHTML = d.history?.length
    ? '<h2 class="section-title">Активированные промокоды</h2>' +
      d.history.map((h) => `<div class="log-row">
        <span>${esc(h.code)} · ${PROMO_TYPE_LABEL[h.type] || h.type}<br>
          <small>${new Date(h.created_at).toLocaleString('ru-RU')}</small></span>
        <b class="${h.granted ? 'plus' : ''}">${h.granted ? '+' + money(h.granted) : ''}</b>
      </div>`).join('')
    : '';
}

/* ============================================================
   ЭКРАН ПАРТНЁРА
   ============================================================ */

async function loadPartner() {
  const box = document.getElementById('partnerBody');
  let d;
  try { d = await api('/api/partner/stats'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const kpi = (label, value, cls, sub) => `<div class="kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value ${cls || ''}">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;

  box.innerHTML = `
    <div class="partner-kpis">
      ${kpi('Рефералов', fmt(d.referralCount), '', `играли: ${fmt(d.active)}`)}
      ${kpi('Их ставки', money(d.wagered))}
      ${kpi('Их выигрыши', money(d.paid))}
      ${kpi('Выдано бонусов', money(d.bonuses))}
      ${kpi('Чистая прибыль', `${d.profit >= 0 ? '' : '-'}${money(Math.abs(d.profit))}`,
            d.profit >= 0 ? 'plus' : 'minus',
            'ставки минус выигрыши минус бонусы')}
      ${kpi('Ваша доля', money(d.accrued), 'plus', `${d.partner.share_pct}% от прибыли`)}
      ${kpi('Выплачено', money(d.paidOut))}
      ${kpi('К выплате', money(Math.max(0, d.pending)), 'plus')}
    </div>

    ${d.profit < 0 ? `<div class="wager-note">Сейчас рефералы в плюсе, и прибыли по ним нет.
      Доля начнёт начисляться снова, когда прибыль вернётся в плюс: минус
      переносится, а не обнуляется.</div>` : ''}

    <h2 class="section-title">Ваши промокоды</h2>
    ${d.promos.length
      ? d.promos.map((p) => `<div class="log-row">
          <span class="promo-code">${esc(p.code)}</span>
          <b>${fmt(p.used)} ${plural(p.used, 'активация', 'активации', 'активаций')}</b>
        </div>`).join('')
      : '<div class="empty">Промокодов пока нет. Их заводит администратор.</div>'}

    <h2 class="section-title">Рефералы</h2>
    ${d.referrals.length
      ? d.referrals.map((u) => {
          const name = u.username ? '@' + u.username : (u.first_name || 'Без имени');
          const profit = u.total_spent - u.total_won - u.bonus_granted;
          return `<div class="log-row">
            <span>${esc(name)}<br><small>раундов ${fmt(u.total_rounds)} ·
              ставки ${money(u.total_spent)}</small></span>
            <b class="${profit >= 0 ? 'plus' : 'minus'}">${profit >= 0 ? '' : '-'}${money(Math.abs(profit))}</b>
          </div>`;
        }).join('')
      : '<div class="empty">Пока никто не пришёл</div>'}

    <h2 class="section-title">Выплаты вам</h2>
    ${d.payouts.length
      ? d.payouts.map((p) => `<div class="log-row">
          <span>${new Date(p.created_at).toLocaleString('ru-RU')}
            ${p.comment ? '<br><small>' + esc(p.comment) + '</small>' : ''}</span>
          <b class="plus">+${money(p.amount)}</b>
        </div>`).join('')
      : '<div class="empty">Выплат пока не было</div>'}
  `;
}

/* ============================================================
   АПГРЕЙД
   ============================================================ */

/**
 * Ставка против цели. Сектор выигрыша нарисован на кольце, стрелка
 * останавливается на угле roll * 360 градусов от верхней точки — то есть
 * картинка ровно повторяет то, что посчитал сервер, и её можно проверить
 * через раздел «Честность».
 */
const UPG_RADIUS = 104;
const UPG_CIRC = 2 * Math.PI * UPG_RADIUS;

/** Сколько полных оборотов стрелка делает до остановки. */
const UPG_TURNS = 6;

function upgEls() {
  return {
    arc: document.getElementById('upgArc'),
    needle: document.getElementById('upgNeedle'),
    target: document.getElementById('upgTarget'),
    mult: document.getElementById('upgMult'),
    outcome: document.getElementById('upgOutcome'),
    btn: document.getElementById('upgradeBtn'),
  };
}

function renderUpgradePicker() {
  const picker = document.getElementById('upgPicker');
  const list = state.config?.upgrade?.multipliers || [];
  if (!list.length) return;

  if (!state.upgradeMultiplier) state.upgradeMultiplier = list[1] ?? list[0];

  picker.innerHTML = list.map((m) =>
    `<button class="upg-opt${m === state.upgradeMultiplier ? ' active' : ''}"
             data-mult="${m}">x${m}</button>`).join('');

  picker.querySelectorAll('.upg-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Во время прокрута множитель не меняем: сектор перерисовался бы
      // на лету, и указатель сел бы уже в другую дугу.
      if (state.busy) return;
      state.upgradeMultiplier = Number(btn.dataset.mult);
      renderUpgradePicker();
      renderUpgradeStage();
      haptic('light');
    });
  });
}

/** Насечки по кругу — иначе кольцо выглядит пустым до первого прокрута. */
function renderUpgradeTicks() {
  const g = document.getElementById('upgTicks');
  if (!g || g.childElementCount) return;

  let html = '';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const r1 = UPG_RADIUS - 14;
    const r2 = UPG_RADIUS - 19;
    html += `<line x1="${(130 + Math.cos(a) * r1).toFixed(2)}"
                   y1="${(130 + Math.sin(a) * r1).toFixed(2)}"
                   x2="${(130 + Math.cos(a) * r2).toFixed(2)}"
                   y2="${(130 + Math.sin(a) * r2).toFixed(2)}"/>`;
  }
  g.innerHTML = html;
}

/**
 * Пересчитывает цель и длину сектора под текущую ставку.
 *
 * Формулы те же, что на сервере, — но результат раунда клиент всё равно
 * не решает: сюда приходит только оформление, исход считает сервер.
 */
function renderUpgradeStage() {
  const { arc, target, mult } = upgEls();
  if (!arc) return;

  const rtp = 0.7;
  const m = state.upgradeMultiplier || 2;
  const stake = betValue('upgStake') || 0;
  const goal = Math.round(stake * m);

  target.textContent = goal ? money(goal) : '-';
  mult.textContent = `x${m}`;

  const chance = goal ? (rtp * stake) / goal : 0;
  arc.style.strokeDasharray = `${(chance * UPG_CIRC).toFixed(2)} ${UPG_CIRC.toFixed(2)}`;
}

document.getElementById('upgradeBtn').addEventListener('click', async () => {
  if (state.busy) return;

  const { arc, needle, outcome, btn } = upgEls();
  const stake = betValue('upgStake');
  const multiplier = state.upgradeMultiplier;
  const min = state.config?.upgrade?.minStake ?? 10;

  if (!stake || stake < min) return toast(`Минимальная ставка - ${min}`);
  if (stake > (state.user?.balance ?? 0)) return needMoney(stake - (state.user?.balance ?? 0));

  state.busy = true;
  btn.disabled = true;
  outcome.textContent = '';
  outcome.className = 'upg-outcome';

  let data;
  try {
    data = await api('/api/upgrade', { stake, multiplier });
  } catch (err) {
    toast(err.message);
    haptic('error');
    state.busy = false;
    btn.disabled = false;
    return;
  }

  applyUser(data.user);
  arc.style.strokeDasharray = `${(data.chance * UPG_CIRC).toFixed(2)} ${UPG_CIRC.toFixed(2)}`;

  // Стрелка всегда крутится вперёд: копим абсолютный угол, а не задаём его
  // заново, иначе после второго прокрута она отматывала бы назад.
  const current = state.upgradeAngle || 0;
  const currentMod = ((current % 360) + 360) % 360;
  const wanted = data.fair.roll * 360;
  const delta = wanted - currentMod + (wanted < currentMod ? 360 : 0);
  state.upgradeAngle = current + UPG_TURNS * 360 + delta;

  needle.classList.add('is-spinning');
  needle.style.transform = `rotate(${state.upgradeAngle.toFixed(3)}deg)`;

  sndSpinStart();
  sndBet();
  haptic('medium');

  setTimeout(() => {
    if (data.won) {
      outcome.textContent = `Забрали ${money(data.target)}`;
      outcome.className = 'upg-outcome win';
      sndBigWin();
      sndCollect();
      haptic('success');
    } else {
      outcome.textContent = 'Мимо сектора';
      outcome.className = 'upg-outcome lose';
      sndLose();
      haptic('error');
    }
    state.busy = false;
    btn.disabled = false;
    renderUpgradeStage();
  }, 3500);
});

/* ============================================================
   ПОДВАЛ И ПРАВОВЫЕ ДОКУМЕНТЫ
   ============================================================ */

function buildFooter() {
  const footer = document.getElementById('siteFooter');
  footer.innerHTML = footerHtml();

  mountIcons(footer);
  startFooterCounters();

  footer.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      haptic('light');
    });
  });

  footer.querySelectorAll('[data-doc]').forEach((btn) => {
    btn.addEventListener('click', () => openDoc(btn.dataset.doc));
  });
}

function openDoc(key) {
  const doc = DOCS[key];
  if (!doc) return;

  document.getElementById('docTitle').textContent = doc.title;
  document.getElementById('docBody').innerHTML = doc.body;
  document.getElementById('docBackdrop').hidden = false;
  document.querySelector('.doc-body').scrollTop = 0;
  haptic('light');
}

document.getElementById('docClose').addEventListener('click', () => {
  document.getElementById('docBackdrop').hidden = true;
});
document.getElementById('docBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'docBackdrop') e.currentTarget.hidden = true;
});

/* ============================================================
   ПЕРВЫЙ ЗАХОД
   ============================================================ */

/*
 * Три экрана, которые новый игрок видит один раз.
 *
 * Раньше первого захода не было вовсе: игрок открывал приложение, получал
 * тысячу условных единиц и разбирался сам. Тысячи больше нет, и без объяснения
 * первый экран выглядит как касса, которая просит денег ни за что. Поэтому
 * порядок здесь именно такой: сначала почему нам можно верить, и только третьим
 * экраном - предложение.
 *
 * Отметка о просмотре живёт в localStorage, а не в базе: это настройка
 * устройства, а не игрока, и терять её при чистке браузера не жалко.
 */
const ONBOARDING_KEY = 'lb-onboarded-v1';

const ONBOARDING = [
  {
    art: '🗝️',
    title: 'Всё видно до открытия',
    text: 'Содержимое каждого кейса и шанс каждого предмета показаны заранее. ' +
      'Открыв кейс, вы не узнаете ничего, чего не могли увидеть до нажатия.',
  },
  {
    art: '🔐',
    title: 'Честность можно проверить',
    // Второй экран - про доверие целиком: техническая проверка и надзор.
    // Строку про лицензию собирает licenseLine(): номер подставляется из
    // legal.js, и пока его не вписали, текст обходится без него.
    text: 'Хеш серверного ключа публикуется <b>до</b> вашей игры. ' +
      'После смены ключа любой прошедший ролл пересчитывается вручную ' +
      'и должен сойтись до последнего знака. Раздел «Честность» в меню.',
    extra: licenseLine,
  },
  {
    art: '🎁',
    title: '',
    text: '',
  },
];

/**
 * Строка про игорную лицензию.
 *
 * Орган надзора назван всегда, номер - только если он вписан в legal.js.
 * Выдуманный номер тут недопустим: его проверяют по реестру регулятора, и
 * несовпадение стоит дороже, чем отсутствие строки.
 */
function licenseLine() {
  const num = String(LICENSE.number || '').trim();
  return `Проект работает по официальной лицензии <b>${esc(LICENSE.authority)}</b>` +
    (num ? ` № ${esc(num)}` : '') +
    '. Она регулирует выплаты игрокам и служит гарантом честности игры: ' +
    'условия, отдачу и порядок расчётов контролирует регулятор, а не мы сами.';
}

let onbStep = 0;

function onboardingSeen() {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1'; }
  catch { return true; }
}

function closeOnboarding(done) {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* приватный режим */ }
  document.getElementById('onbBackdrop').hidden = true;
  if (done) track('onboarding_done');
}

function renderOnboarding() {
  const step = ONBOARDING[onbStep];
  const rules = state.config?.firstDeposit;
  const last = onbStep === ONBOARDING.length - 1;

  // Последний экран собирается на месте: условия бонуса приходят с сервера,
  // и зашивать проценты в текст значило бы врать после первой же их правки.
  let title = step.title;
  let text = step.text;
  if (last) {
    if (rules?.pct > 0) {
      const cap = rules.max > 0 ? ` до ${money(rules.max)}` : '';
      title = `Первое пополнение +${rules.pct}%${cap}`;
      text = `Бонус приходит сразу вместе с пополнением от ${money(rules.min)}. ` +
        `Вывести его можно после ставок на ${rules.wager} суммы бонуса. ` +
        'Если у вас есть промокод, введите его в разделе «Бонусы».';
    } else {
      title = 'Готово';
      text = 'Пополните счёт в кассе и открывайте кейсы. ' +
        'Промокод, если он есть, вводится в разделе «Бонусы».';
    }
  }

  document.getElementById('onbArt').textContent = step.art;
  document.getElementById('onbTitle').textContent = title;
  document.getElementById('onbText').innerHTML = text
    + (step.extra ? `<span class="onb-note">${step.extra()}</span>` : '');
  document.getElementById('onbDots').innerHTML =
    ONBOARDING.map((_, i) => `<i class="${i === onbStep ? 'on' : ''}"></i>`).join('');
  document.getElementById('onbNext').textContent = last
    ? (rules?.pct > 0 ? 'Пополнить' : 'Начать')
    : 'Дальше';
  document.getElementById('onbSkip').textContent = last ? 'Позже' : 'Пропустить';
}

function startOnboarding() {
  if (onboardingSeen()) return;
  // Тому, кто уже играл, объяснять нечего: отметка могла потеряться вместе с
  // хранилищем браузера, а показывать вводный экран ветерану неловко.
  if (state.user?.stats?.rounds > 0 || state.user?.depositsCount > 0) {
    closeOnboarding(false);
    return;
  }

  onbStep = 0;
  renderOnboarding();
  document.getElementById('onbBackdrop').hidden = false;
}

document.getElementById('onbSkip').addEventListener('click', () => {
  haptic('light');
  closeOnboarding(false);
});

document.getElementById('onbNext').addEventListener('click', () => {
  haptic('light');
  if (onbStep < ONBOARDING.length - 1) {
    onbStep++;
    renderOnboarding();
    return;
  }
  closeOnboarding(true);
  if (state.config?.firstDeposit?.pct > 0) openCashier();
});


/* ============================================================
   НАВИГАЦИЯ И СТАРТ
   ============================================================ */

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
  buildFooter();


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
    wireBetPanel('upgStake', 'data-upg-add', 'data-upg-bet');

    // Цель пересчитывается на лету — иначе игрок жмёт «Апгрейд», не увидев,
    // за что играет.
    document.getElementById('upgStake').addEventListener('input', () => {
    if (!state.busy) renderUpgradeStage();
  });
    renderUpgradeTicks();
    renderUpgradePicker();
    renderUpgradeStage();

    startFeed();
    startPaymentEvents();
    loadFreeCase();
    startOnboarding();
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">Не удалось загрузить приложение.<br>${esc(err.message)}</div>`;
  }
}

init();


/* ============================================================
   СЧЁТЧИКИ В ПОДВАЛЕ
   ============================================================ */

/**
 * Витринные счётчики: открытых кейсов и игроков.
 *
 * Числа не приходят с сервера и ничего не измеряют — это оформление, как и
 * счётчик зрителей на экране кейса. Кейсы прибавляются каждую секунду,
 * игроки — примерно раз в десять минут, иначе рост выглядел бы неправдоподобно.
 *
 * Стартовая точка сдвигается по реальному времени, поэтому у зашедшего завтра
 * счётчик не откатится к исходному значению.
 */
function startFooterCounters() {
  // Константы объявлены внутри намеренно: функция вызывается при отрисовке
  // подвала, а это происходит раньше, чем выполнится конец файла, — вынесенные
  // наружу const попали бы в мёртвую зону и уронили бы страницу.
  const ORIGIN = Date.parse('2026-08-17T00:00:00Z');
  const BASE = { cases: 1_567_266, players: 45_678 };

  const casesEl = document.getElementById('statCases');
  const playersEl = document.getElementById('statPlayers');
  if (!casesEl || !playersEl) return;

  const elapsed = Math.max(0, Date.now() - ORIGIN) / 1000;
  let cases = BASE.cases + Math.floor(elapsed * 1.5);
  let players = BASE.players + Math.floor(elapsed / 600);

  const paint = () => {
    casesEl.textContent = fmt(cases);
    playersEl.textContent = fmt(players);
  };
  paint();

  if (state.counterTimers) state.counterTimers.forEach(clearInterval);
  state.counterTimers = [
    setInterval(() => { cases += 1 + Math.floor(Math.random() * 2); paint(); }, 1000),
    setInterval(() => { players += 1 + Math.floor(Math.random() * 2); paint(); }, 600_000),
  ];
}
