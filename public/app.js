/**
 * Клиент сайта: кейсы, казино, краш, рулетка, вход, админка.
 *
 * Клиент НЕ решает исход. Он отправляет запрос, получает от сервера готовый
 * результат и лишь проигрывает анимацию. В краше точка взрыва вообще не
 * приходит на клиент до конца раунда.
 */

import {
  iconCases, iconCrash, iconRoulette, iconHistory, iconFair, iconAdmin,
  iconCoin, iconX2, iconGift, iconBolt, iconSearch, iconPlus, iconMinus,
  iconBlock, iconBack, iconTier, iconStar,
  iconGrid, iconKey, iconPeople, iconMail, iconTelegram, iconEye,
  markF1, markITF, markGambling, markWorldGame,
  iconSlot,
} from './icons.js';
import { caseCover, porschePhotoSrc, caseArtSrc, caseStageSrc } from './covers.js';
import { itemArt, itemArtMaterial } from './item-art.js';
import { itemArt64 } from './item-art64.js';
import { itemArtHd } from './item-art-hd.js';
import { coinMark, coinColor } from './coin-art.js';
import { COMPANY, LICENSE, DOCS, PARTNERS, footerHtml } from './legal.js';
import { createSlot } from './slots.js';
import { createCasino } from './casino.js';
import {
  sndTick, sndSpinStart, sndLand, sndReveal,
  sndBigWin, sndCollect, sndLose, sndFlip, sndBet, sndCrash, sndClimb,
  sndRetrigger, sndFirework,
  sndWhoosh, sndBoom, sndSlash, sndRiser, sndHit, sndFanfare, sndCoin, sndDeal,
  sndChime, sndSoft,
  sndShuffle, sndCardDrop, sndHeartbeat, sndAceWin, sndStamp, sndBurn, sndPurchase,
} from './sounds.js';
import { createMotion, MOTION_NICE_AT } from './motion.js';


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
  admin: { tab: 'overview', users: [], query: '', funnelDays: 7, perms: new Set(), me: null, reportDays: 30 },
  depositChosen: false,
  withdrawMethod: 'sbp',
  /*
   * Колесо фортуны. Лежит здесь, а не отдельной константой внизу файла:
   * init() вызывается раньше, чем выполнится конец файла, и объявленная там
   * константа попала бы в мёртвую зону и уронила бы страницу.
   *
   * angle копится и никогда не уменьшается. Если каждый раз доворачивать «на
   * ближайший подходящий угол», второй прокрут иногда пошёл бы назад, а
   * колесо, дающее задний ход, читается как поломка.
   */
  fortune: { data: null, angle: 0, busy: false },
};

const ICONS = {
  cases: iconCases, crash: iconCrash, roulette: iconRoulette,
  history: iconHistory, fair: iconFair, admin: iconAdmin,
  coin: iconCoin, x2: iconX2, gift: iconGift, bolt: iconBolt,
  search: iconSearch, plus: iconPlus, minus: iconMinus,
  block: iconBlock, back: iconBack, grid: iconGrid,
  key: iconKey, people: iconPeople, mail: iconMail, telegram: iconTelegram, eye: iconEye,
  slot: iconSlot,
  markF1, markITF, markGambling, markWorldGame,
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

/**
 * Запрос к серверу. Сессия едет в httpOnly-cookie сама, заголовков входа нет.
 *
 * Ответ «войдите» (401 с кодом AUTH) открывает окно входа: гость видит сайт
 * целиком, и вход спрашивается ровно в момент, когда без аккаунта дальше
 * нельзя. Ошибка всё равно бросается - вызывающий код снимает свои флаги
 * занятости как после любой неудачи.
 */
async function api(path, body, { quiet = false } = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Ошибка ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    if (res.status === 401 && data.code === 'AUTH' && !quiet) {
      openAuth(authDefaultPane());
    }
    // Подтверждение входа в панель истекло посреди работы: показываем экран
    // подтверждения вместо разделов, а не россыпь ошибок «нет доступа».
    if (res.status === 403 && data.code === 'ADMIN_2FA' && state.view === 'admin') {
      renderAdminGate();
    }
    throw err;
  }
  return data;
}

const fmt = (n) => Number(n).toLocaleString('ru-RU');

/**
 * Как назвать игрока в панели: почта, Telegram ID или внутренний номер.
 * На сайте у зарегистрированного по почте Telegram нет вовсе, и прежнее
 * «ID ${tg_id}» печатало ему «ID null».
 */
function playerIdent(u, id = u?.id ?? u?.user_id) {
  const bits = [];
  if (u?.email) bits.push(u.email);
  if (u?.tg_id != null) bits.push(`TG ${u.tg_id}`);
  bits.push(`#${id}`);
  return bits.join(' · ');
}

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

/*
 * Сумма с символом валюты.
 *
 * Пробел перед знаком рубля НЕРАЗРЫВНЫЙ (U+00A0). С обычным «3 650 ₽»
 * разрывалось между числом и знаком, и на карточке знак уезжал на вторую
 * строку - выглядит как сломанная вёрстка, а сумма тут главное.
 *
 * Разряды внутри числа разделяет сам toLocaleString('ru-RU'), и он тоже
 * ставит неразрывный пробел, поэтому «329 000» не рассыпается.
 */
/*
 * Сумма денег. Копейки показываются, только если они есть: «1 250 ₽», но
 * «12,50 ₽». Дробные суммы бывают только у казино (ставки провайдеров по
 * 0,20), и для них «12,5 ₽» читалось бы как опечатка.
 */
const fmtMoney = (n) => {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(v)
    ? v.toLocaleString('ru-RU')
    : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const money = (n) => fmtMoney(n) + ' ₽';
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
  // Поверх окна входа тост не нужен: окно само объясняет, что случилось, а
  // строка «Войдите в аккаунт» под ним читалась бы как вторая ошибка.
  if (!document.getElementById('authBackdrop')?.hidden) return;
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
  // У гостя баланс ноль не потому, что деньги кончились: ему нужен вход.
  if (state.guest) return openAuth(authDefaultPane());
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
  // События пишутся по игроку: у гостя аккаунта нет, и считать нечего.
  if (state.guest) return;
  try { api('/api/track', { name }, { quiet: true }).catch(() => {}); } catch { /* не мешаем игре */ }
}

/** Касса с сразу открытой вкладкой пополнения. */
function openCashier() {
  if (state.guest) return openAuth(authDefaultPane());
  switchView('wallet');
  setCashMode('deposit');
}

/*
 * Отклик вибрацией. Сайт работает в обычном браузере, где из всего этого
 * есть только navigator.vibrate - на Android. iOS и компьютер молчат, и это
 * нормально: отклик дополняет звук и анимацию, а не заменяет их.
 */
const HAPTIC_MS = { light: 8, medium: 14, heavy: 22, success: [10, 40, 16], error: [24, 50, 24] };

function haptic(type = 'light') {
  try {
    if (navigator.vibrate) navigator.vibrate(HAPTIC_MS[type] || HAPTIC_MS.light);
  } catch { /* вибрации нет */ }
}

/** Падающие монеты на фоне - рисуются той же иконкой, что и баланс. */
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

/*
 * Показ выигрыша и фриспинов (public/motion.js). Создаётся при первом
 * обращении: в момент разбора модуля часть того, что ему передаётся, ещё не
 * объявлена, а обращение к const до объявления роняет весь клиент.
 */
let motionInstance = null;
function motion() {
  return motionInstance ||= createMotion({
    money,
    artFor: (item) => tileArt(item, tierColor(item.tier)),
    tierColor,
    haptic,
    snd: {
      sndWhoosh, sndBoom, sndSlash, sndRiser, sndHit, sndFanfare, sndCoin, sndDeal,
      sndChime, sndSoft,
    },
  });
}

/** Плитка ленты, на которой остановился прокрут: с неё срывается карточка. */
function winnerTile(reelIndex = 0) {
  return document.querySelectorAll('#reels .reel')[reelIndex]?.children[WINNER_INDEX] || null;
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
 * Празднование приза колеса фортуны.
 *
 * Выигрыши кейсов и фриспинов показывает public/motion.js: там сила показа
 * считается от множителя к цене кейса. У приза колеса цены прокрута нет,
 * множитель считать не от чего, поэтому здесь остался прежний салют.
 */
function celebrate(kind, payload = {}) {
  if (kind === 'bigwin') {
    sndFirework(3);
    sndBigWin();
    fxConfetti({ count: 55, palette: 'neon' });
    fxShout(payload.text || 'КРУПНЫЙ ВЫИГРЫШ', payload.sub || '', '#00ff9d');
    haptic('success');
  }
}

/* ============================================================
   БАЛАНС, ПЛЮШКИ, СТАТИСТИКА
   ============================================================ */

/** Сумма с отдельно выделенным знаком рубля: он набран жирнее цифр. */
const moneyRich = (n) => `${fmtMoney(n)} <span class="rub">₽</span>`;

/*
 * Сколько игрок может поставить в наших играх: свои деньги и бонусный счёт.
 * Бонус играет, когда своих не хватает на ставку, поэтому кнопка «открыть»
 * не должна гаснуть у того, у кого свои кончились, а бонус есть. Шапка
 * показывает только свои: их выводят и ими играет казино.
 */
function spendableMoney() {
  return Math.max(0, state.user?.balance || 0) + Math.max(0, state.user?.bonusBalance || 0);
}

function renderBalance() {
  const chip = document.getElementById('balanceChip');
  document.getElementById('balanceValue').innerHTML = moneyRich(state.user.balance);
  chip.classList.add('bump');
  setTimeout(() => chip.classList.remove('bump'), 260);

  renderPerkBar();
}

/** Плашка с активными плюшками: ×2 и накопленные подарочные кейсы. */
function renderPerkBar() {
  const bar = document.getElementById('perkBar');
  const chips = [];

  // Удвоители копятся по кейсам: у одного игрока их может быть несколько и на
  // разные кейсы. Показываем каждый кейс отдельной плашкой со счётчиком.
  for (const p of state.user.x2Perks || []) {
    // Удвоитель с колеса фортуны не привязан к кейсу и лежит под ключом «*».
    // Подписывать его названием кейса нельзя: он работает в любом.
    const where = p.case_id === '*'
      ? 'в любом кейсе'
      : `на «${esc(state.config.cases.find((x) => x.id === p.case_id)?.name || '-')}»`;
    chips.push(`<span class="perk-chip"><span data-ico="x2"></span>
      ×2 ${where}${p.count > 1 ? ` · ${p.count}` : ''}</span>`);
  }

  // Бонусный счёт - первым: это деньги, которыми игрок может играть сейчас.
  // Нажатие ведёт в кассу, где расписано, сколько осталось отыграть.
  if ((state.user.bonusBalance || 0) > 0) {
    chips.unshift(`<span class="perk-chip is-bonus" data-goto-cashier>
      Бонус ${money(state.user.bonusBalance)}${state.user.wagerRequired > 0
        ? ` · отыграть ${money(state.user.wagerRequired)}` : ''}</span>`);
  }

  // Выигранных кейсов здесь нет намеренно: их место в «Бонусах». Полоса над
  // полками разрасталась на несколько строк и отжимала сами кейсы вниз.

  bar.innerHTML = chips.join('');
  bar.querySelector('[data-goto-cashier]')?.addEventListener('click', () => { haptic('light'); openCashier(); });
  bar.hidden = !chips.length;
  mountIcons(bar);

  bar.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      haptic('light');
      openCase(el.dataset.goto);
    });
  });
}

/** Как часто одна карточка может выпустить искры: не чаще раза в полсекунды. */
const CARD_SPARK_GAP_MS = 500;

/**
 * Кейс на полке приподнимается под пальцем или курсором, и вокруг него
 * вспыхивают искры в тон обложки. Слушатель один на полку, а не на каждую
 * карточку: полки перерисовываются после каждого раунда.
 */
function wireCaseCardFx(list) {
  if (!list || list.dataset.fx) return;
  list.dataset.fx = '1';
  const fire = (e) => {
    const card = e.target.closest?.('.case-card.has-art');
    if (!card || !list.contains(card)) return;
    const now = performance.now();
    if (now - (Number(card.dataset.spark) || 0) < CARD_SPARK_GAP_MS) return;
    card.dataset.spark = String(now);
    const c = state.config.cases.find((x) => x.id === card.dataset.case);
    const [h1, h2] = c?.artGlow || [275, 300];
    const cover = card.querySelector('.case-cover');
    if (!cover) return;
    const b = cover.getBoundingClientRect();
    sparkBurst(cover, b.width / 2, b.height * 0.55, {
      n: 16, dist: [b.width * 0.3, b.width * 0.55], size: 5,
      colors: [`hsl(${h1} 95% 65%)`, `hsl(${h2} 90% 70%)`, '#fff6cf'],
    });
  };
  list.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') fire(e); });
  list.addEventListener('pointerdown', fire);
}

/** Сколько монет летит в баланс при пополнении. */
const DEPOSIT_COINS = 14;

/**
 * Пополнение: монеты летят в баланс, и сумма в шапке досчитывается до новой.
 * Первое пополнение - отдельная сцена с сундуком: это начало игры, и оно
 * заслуживает больше, чем строку в истории.
 */
function celebrateDeposit(before, after) {
  const gained = Math.max(0, after.balance - before.balance);
  const chip = document.getElementById('balanceChip');
  const target = chip?.offsetParent ? chip : document.getElementById('openerBalance');
  setTimeout(() => {
    coinShower(target, DEPOSIT_COINS);
    countBalance(before.balance, after.balance);
    sndCoin();
  }, 60);
  if (!before.depositsCount) {
    // Про бонус сцена говорит, только если он правда пришёл на бонусный счёт.
    const bonus = (after.bonusBalance || 0) > (before.bonusBalance || 0);
    setTimeout(() => showFirstDepositChest(gained, bonus), 900);
  }
}

/** Монеты из середины экрана в баланс по дугам, каждая со своей задержкой. */
function coinShower(toEl, n) {
  if (!toEl) return;
  const t = toEl.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'coin-shower';
  document.body.append(layer);
  for (let i = 0; i < n; i++) {
    const coin = document.createElement('span');
    coin.className = 'coin-fly';
    coin.innerHTML = iconCoin();
    const x0 = innerWidth / 2 + (Math.random() - 0.5) * 160;
    const y0 = innerHeight * 0.55 + (Math.random() - 0.5) * 120;
    coin.style.left = `${x0}px`;
    coin.style.top = `${y0}px`;
    layer.append(coin);
    const dx = t.left + t.width / 2 - x0, dy = t.top + t.height / 2 - y0;
    coin.animate([
      { transform: 'translate(0, 0) scale(0.2) rotate(0deg)', opacity: 0 },
      { transform: `translate(${dx * 0.2 + (Math.random() - 0.5) * 120}px, ${dy * 0.2 - 80}px) scale(1.1) rotate(200deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.5) rotate(540deg)`, opacity: 0.9 },
    ], { duration: 900, delay: i * 55, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' });
    setTimeout(() => { sndCoin(); }, 900 + i * 55);
  }
  setTimeout(() => {
    layer.remove();
    toEl.classList.remove('bump');
    void toEl.offsetWidth;
    toEl.classList.add('bump');
  }, 900 + n * 55 + 100);
}

/** Сумма в шапке бежит от старой к новой, а не меняется скачком. */
function countBalance(from, to) {
  const el = document.getElementById('balanceValue');
  if (!el || from === to) return;
  const t0 = performance.now();
  const COUNT_MS = 1400;
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / COUNT_MS);
    // Сюда могли успеть прийти новые числа: тогда счёт уступает настоящему.
    if (state.user.balance !== to) return;
    el.innerHTML = moneyRich(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Сцена первого пополнения закрывается сама: ничто не ждёт нажатия вечно. */
const FIRST_DEPOSIT_SCENE_MS = 6500;

/**
 * Сундук первого пополнения: крышка откидывается, из него бьёт свет и
 * летят монеты, под ним - сумма на балансе. Бонус называется, только если
 * сервер его действительно начислил (вырос отыгрыш): обещать то, чего нет,
 * эта сцена не должна.
 */
function showFirstDepositChest(amount, bonus) {
  const scene = document.createElement('div');
  scene.className = 'chest-scene';
  scene.innerHTML = `
    <div class="chest-dim"></div>
    <div class="chest-rays"></div>
    <div class="chest-body">
      <div class="chest">
        <svg viewBox="0 0 160 130" aria-hidden="true">
          <defs>
            <linearGradient id="chWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b2bb0"/><stop offset="1" stop-color="#24104a"/></linearGradient>
            <linearGradient id="chGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#e8a024"/><stop offset="1" stop-color="#ffd34d"/></linearGradient>
            <radialGradient id="chLight" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".5" stop-color="#ffd34d" stop-opacity=".6"/><stop offset="1" stop-color="#ffd34d" stop-opacity="0"/></radialGradient>
          </defs>
          <ellipse class="chest-glow" cx="80" cy="62" rx="62" ry="30" fill="url(#chLight)"/>
          <rect x="16" y="60" width="128" height="62" rx="8" fill="url(#chWood)" stroke="url(#chGold)" stroke-width="4"/>
          <rect x="16" y="78" width="128" height="8" fill="url(#chGold)"/>
          <rect x="68" y="70" width="24" height="26" rx="4" fill="url(#chGold)"/>
          <circle cx="80" cy="82" r="4" fill="#24104a"/>
          <g class="chest-lid">
            <path d="M16 60 V44 C16 22 46 12 80 12 C114 12 144 22 144 44 V60 Z" fill="url(#chWood)" stroke="url(#chGold)" stroke-width="4"/>
            <path d="M16 50 H144" stroke="url(#chGold)" stroke-width="6"/>
          </g>
        </svg>
      </div>
      <div class="chest-eyebrow">первое пополнение</div>
      <div class="chest-sum">+${money(amount)}</div>
      <div class="chest-note">${bonus ? 'Бонус за первое пополнение уже внутри' : 'Деньги на балансе, удачи в игре'}</div>
      <button class="open-cta chest-go" type="button"><span class="open-act"><span>Играть</span><small>к кейсам</small></span></button>
    </div>`;
  document.body.append(scene);
  requestAnimationFrame(() => scene.classList.add('is-in'));
  sndPurchase();
  setTimeout(() => {
    if (!scene.isConnected) return;
    const c = scene.querySelector('.chest').getBoundingClientRect();
    sparkBurst(scene, c.left + c.width / 2, c.top + c.height * 0.45,
      { n: 40, colors: ['#ffd34d', '#fff6cf', '#ff7a3a'], dist: [90, 220], size: 8 });
    sndFanfare();
    haptic('success');
  }, 700);
  const close = () => {
    if (!scene.isConnected) return;
    scene.classList.add('is-out');
    setTimeout(() => scene.remove(), 260);
  };
  scene.querySelector('.chest-go').onclick = () => { close(); switchView('cases'); };
  scene.querySelector('.chest-dim').onclick = close;
  setTimeout(close, FIRST_DEPOSIT_SCENE_MS);
}

function applyUser(user) {
  const before = state.user;
  state.user = user;
  // Пополнение узнаём по счётчику пополнений, а не по росту баланса: баланс
  // растёт и от выигрыша, а праздновать выигрыш как взнос нельзя.
  if (before && user && user.depositsCount > (before.depositsCount || 0)) {
    celebrateDeposit(before, user);
  }
  renderBalance();
  renderCases();
  renderMenu();
  renderSideNav();
  // Шкалы Free Money двигаются вместе с оборотом, пока раздел открыт.
  if (state.view === 'freemoney') { renderBonuses(); renderFreeMoney(); }
}

/* ============================================================
   КЕЙСЫ
   ============================================================ */

/**
 * Полки кейсов: ряды по цене, каждый листается вбок.
 *
 * Границы подобраны так, чтобы в ряду выходило 6-9 кейсов: полка короче
 * выглядит куцей, длиннее - заставляет листать слишком долго ради последнего.
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
  if (c.free) badge = '<span class="cover-badge perk">FREE</span>';
  else if (locked) badge = `<span class="cover-badge soon">С ${locked.toUpperCase()}</span>`;
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

  /*
   * Обложки «дышат» вразнобой: задержка - от имени кейса, а не случайная,
   * чтобы при перерисовке полки кейс не дёргался в другую фазу. Доступные по
   * балансу изредка вспыхивают бликом: видно, что можно открыть прямо сейчас.
   */
  let h = 0;
  for (let i = 0; i < c.id.length; i++) h = (h * 31 + c.id.charCodeAt(i)) >>> 0;
  const breath = `;--breath:${-((h % 5500) / 1000).toFixed(2)}s;--glint:${-((h % 9000) / 1000).toFixed(2)}s`;
  const afford = !locked && (freeCount > 0 || (!c.free && c.price <= (state.user?.balance || 0)));
  // Бесплатный кейс: вместо цены - «FREE», а готовый подарок светится.
  // Число подарков - отдельной приклеенной плашкой, тише самой надписи
  // (решение заказчика): главное на полке «FREE», а сколько их - справка.
  const priceLabel = c.free ? 'FREE'
    : freeCount && !locked ? 'ПОДАРОК' : money(c.price);
  const priceHtml = c.free && freeCount
    ? `<span class="case-price-pair"><span class="case-price">${priceLabel}</span><span class="case-count">×${fmt(freeCount)}</span></span>`
    : `<span class="case-price">${priceLabel}</span>`;

  return `<div class="case-card ${hasArt ? 'has-art' : ''} ${freeCount ? 'free-ready' : ''} ${c.free ? 'is-gift' : ''} ${locked ? 'locked' : ''} ${afford ? 'can-afford' : ''}"
      data-case="${c.id}" style="--cat-color:${color}${
        artAspect ? `;--art-ar:${artAspect}` : ''}${glow}${breath}">
    <div class="case-cover">
      ${caseCover(c)}
      ${hasArt ? '' : `<div class="cover-badges">${badge}</div>
      <div class="cover-top">до ${fmt(c.topValue)}</div>`}
    </div>
    <div class="case-name">${esc(c.name)}</div>
    <div class="case-foot">
      ${priceHtml}
      ${hasArt ? '' : `<span class="case-max">${c.maxMultiplier}x</span>`}
    </div>
  </div>`;
}

/**
 * Витрина сезонного кейса - широкая карточка под шапкой.
 *
 * Закрытый кейс здесь не гасим, иначе главное место на экране занимает серое
 * пятно. О том, что он ещё не открылся, говорят плашка с датой и подпись на
 * кнопке.
 *
 * У кейса с готовым баннером на обложке уже есть и заголовок, и плашка
 * «сезонный кейс», поэтому свои подписи карточка не рисует: осталась только
 * дата старта - её баннер знать не может. Потолок выигрыша переехал в нижнюю
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
  // убираем - иначе он попал бы в полку по цене ещё и вторым экземпляром.
  const featured = all.find((c) => c.availableFrom);

  // Тематические кейсы вынуты из ценовой сетки: они собраны по идее, и разброс
  // цен внутри такой полки как раз уместен.
  const themed = THEMED_SHELVES.map((t) => ({
    ...t,
    cases: all.filter((c) => c.category === t.category),
  }));
  const themedIds = new Set(themed.flatMap((t) => t.cases.map((c) => c.id)));

  // Бесплатный «Начало» стоит первым на первой полке (решение заказчика):
  // его номинал - для решателя, по цене он не сортируется.
  const gifts = all.filter((c) => c.free);
  const sorted = all.filter((c) => c !== featured && !themedIds.has(c.id) && !c.free);

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

  const shelfHtml = (cls, title, hint, items) => {
    const paid = items.filter((c) => !c.free);
    return `<section class="shelf ${cls}">
      <div class="shelf-head">
        <div>
          <h2 class="shelf-title">${title}</h2>
          <div class="shelf-hint">${hint}</div>
        </div>
        <div class="shelf-range">${fmt(paid[0].price)}${
          paid[paid.length - 1].price !== paid[0].price
            ? ` - ${fmt(paid[paid.length - 1].price)}` : ''} ₽</div>
      </div>
      <div class="shelf-row">
        ${items.map((c, i) => caseCardHtml(c, vouchers, pairAspect(items, i))).join('')}
      </div>
    </section>`;
  };

  let from = 0;
  const blocks = [];

  /*
   * Сезонный кейс рисуется не здесь, а в свой слот на первом экране.
   *
   * На телефоне он от этого не сдвинулся: слот идёт сразу за парой баннеров,
   * ровно там, где карточка стояла первой полкой. А на компьютере слот лежит
   * в сетке справа от слайд-шоу - одной разметкой в двух местах этого было бы
   * не сделать, переносить блок между контейнерами стилями нельзя.
   *
   * Класс на стопке баннеров нужен, чтобы слайд-шоу растянулось на всю ширину,
   * когда сезонного кейса нет вовсе: иначе справа осталась бы пустая колонка.
   */
  const slot = document.getElementById('featuredSlot');
  const stack = document.querySelector('.banner-stack');
  if (slot) slot.innerHTML = featured ? featuredHtml(featured, vouchers) : '';
  if (stack) stack.classList.toggle('no-featured', !featured);

  for (const shelf of SHELVES) {
    const items = sorted.filter((c) => c.price > from && c.price <= shelf.max);
    if (from === 0) items.unshift(...gifts);
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
  wireCaseCardFx(root);

  // Слот сезонного кейса лежит вне списка полок, поэтому перебираем оба места.
  [root, slot].filter(Boolean).forEach((box) => {
    box.querySelectorAll('.case-card, .featured-card').forEach((card) => {
      card.addEventListener('click', () => openCase(card.dataset.case));
    });
  });
}

/**
 * Экран «Бонусы»: кейсы, выигранные в подарок (ваучеры), и активный ×2 -
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
   * Одна плитка на кейс, число подарков - крупной плашкой на ней.
   *
   * Раньше каждый экземпляр стоял отдельной карточкой, чтобы три подарка не
   * читались как один. Но «Начало» выдаётся за каждую тысячу оборота, и у
   * крупного игрока их тысячи: тысячи плиток с обложкой роняли страницу на
   * iPhone (раздел перезагружался по кругу). Плашка ×N крупная, чтобы число
   * читалось сразу, а не мелкой цифрой.
   */
  const cards = (state.user.vouchers || [])
    .map((v) => ({ c: state.config.cases.find((x) => x.id === v.case_id), n: v.count }))
    .filter((g) => g.c && g.n > 0);

  // Блок «Ваши подарки» во Free Money виден, только когда есть что открыть:
  // пустая полка с извинением сверху раздела - худшее начало витрины.
  const gifts = document.getElementById('fmGifts');
  if (gifts) gifts.hidden = !cards.length && !(state.user.x2Perks || []).length;
  const total = cards.reduce((a, g) => a + g.n, 0)
    + (state.user.x2Perks || []).reduce((a, p) => a + (p.count || 1), 0);
  const sum = document.getElementById('fmGiftsSum');
  if (sum) sum.textContent = `Подарков: ${fmt(total)}`;
  if (!cards.length) {
    list.innerHTML = '';
    return;
  }

  /*
   * Подарок - простая плитка: обложка, название, кнопка. Эффекты карточки
   * полки (дыхание, блик, искры, свечение) бесплатному кейсу не нужны.
   */
  list.innerHTML = cards
    .map(({ c, n }) => {
      const art = caseArtSrc(c);
      return `<button type="button" class="fm-gift" data-case="${c.id}">
        ${art ? `<img src="${art}" alt="">` : ''}
        ${n > 1 ? `<span class="fm-gift-n">×${fmt(n)}</span>` : ''}
        <span class="fm-gift-name">${esc(c.name)}</span>
        <span class="fm-gift-go">Открыть бесплатно</span></button>`;
    })
    .join('');
  list.querySelectorAll('.fm-gift').forEach((b) => {
    b.onclick = () => { haptic('light'); openCase(b.dataset.case); };
  });
}

/**
 * Экран кейса.
 *
 * Раньше состав показывался шторкой снизу, а лента появлялась только после
 * нажатия. Теперь это один экран: сверху лента в покое, под ней кнопка
 * прокрута, а ещё ниже - сетка того, что может выпасть, от дорогого к
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

/*
 * Экран кейса собирается не мгновенно: состав с объёмными рисунками, лента,
 * раскладка всей страницы. На слабом телефоне это секунда, и нажатие на
 * кейс выглядело проигнорированным. Поэтому при входе снаружи сначала
 * показывается загрузка, кадр уходит на экран, и только потом строится кейс.
 * Загрузка проявляется с задержкой (CSS) и крутится на видеокарте: на
 * быстром телефоне её не видно, на медленном она не замирает, пока главный
 * поток занят сборкой.
 */
function openCase(caseId, { now = false } = {}) {
  if (!now && document.getElementById('opener').hidden) {
    const loader = document.getElementById('caseLoader');
    loader.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { openCase(caseId, { now: true }); } finally { loader.hidden = true; }
    }));
    return;
  }
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;
  haptic('light');

  applyCaseTheme(c);
  state.openingCaseId = caseId;
  const freeCount = (state.user.vouchers || []).find((v) => v.case_id === c.id)?.count || 0;
  const locked = lockedUntil(c);

  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>${c.free ? 'бесплатно' : money(c.price)}</span>`;
  document.getElementById('openerViewers').textContent =
    `этот кейс крутят ${viewersFor(c.id)} игроков`;

  // До первого нажатия: у кейса с обрядом на экране стоит он сам, у
  // остальных - лента в покое, барабан собран, но никуда не едет.
  if (hasRitual(c)) renderCaseStage(c);
  else { clearCaseStage(); renderIdleReel(c); }

  // Витринный предмет идёт первой карточкой: пунктирная рамка отличает его
  // от тех, что действительно разыгрываются.
  const showcaseCard = c.showcase ? `
    <div class="drop-card rw-skin is-showcase" ${skinAttrs(c.showcase.skin || c.visual)}
         style="--tier-color:${tierColor(c.showcase.tier)}">
      <div class="drop-ico">${tileArt(c.showcase, tierColor(c.showcase.tier))}</div>
      <div class="drop-name"><span>${esc(c.showcase.name)}</span></div>
    </div>` : '';

  const sortedItems = c.items
    .slice()
    .sort((a, b) => (b.evValue ?? b.value) - (a.evValue ?? a.value));
  const cards = sortedItems
    .map((it) => {
      const color = tierColor(it.tier);
      const isPerk = it.kind === 'perk';
      return `<div class="drop-card rw-skin" ${skinAttrs(it.skin)} style="--tier-color:${color}">
        <div class="drop-ico">${tileArt(it, color)}</div>
        <div class="drop-name"><span>${esc(it.name)}</span></div>
        <div class="drop-value">${isPerk && !it.value ? esc(it.perkLabel) : money(it.value)}</div>
      </div>`;
    }).join('');

  document.getElementById('dropsGrid').innerHTML = showcaseCard + cards;
  requestAnimationFrame(() => fitNames(document.getElementById('dropsGrid')));

  /*
   * Нажатие на предмет в составе показывает его крупно: та же карточка, что
   * вылетает при выигрыше, но без начисления и без надписи WIN (см. inspect
   * в motion.js). Порядок карточек в сетке совпадает с sortedItems, витрина
   * идёт первой.
   */
  const gridItems = [...(c.showcase ? [c.showcase] : []), ...sortedItems];
  document.querySelectorAll('#dropsGrid .drop-card').forEach((card, i) => {
    card.onclick = () => {
      const it = gridItems[i];
      if (!it) return;
      // Витринный предмет не разыгрывается: множитель к цене кейса у него
      // намекал бы, что его можно выиграть.
      const isShowcase = !!c.showcase && i === 0;
      haptic('light');
      motion().inspect(it, {
        tile: card, price: isShowcase ? 0 : c.price, theme: c.theme,
        tierLabel: isShowcase ? 'витрина'
          : it.kind === 'perk' ? (it.perkLabel || 'бонус')
          : (state.config.tiers.find((t) => t.id === it.tier)?.label || ''),
      });
    };
  });
  document.getElementById('dropsCount').textContent = `${c.items.length} предметов`;

  /*
   * Управление открытием - одной строкой: икс кнопками «−» и «+», золотая
   * кнопка с ценой отдельной плашкой и переключатель авто. Раньше это были
   * три ряда: пять плашек иксов, шесть плашек авто и розовая кнопка, где цена
   * читалась последней словом капсом. Заказчик выбрал вариант «Пульт» из
   * нескольких показанных ему отдельным демо.
   */
  const maxCount = state.config.maxBatch || 2;
  const countVal = document.getElementById('countVal');
  const openAct = document.getElementById('openAct');
  const openSub = document.getElementById('openSub');
  const openPrice = document.getElementById('openPrice');
  const autoToggle = document.getElementById('autoToggle');
  const autoBadge = document.getElementById('autoBadge');

  document.getElementById('autoRow').innerHTML =
    '<span class="auto-row-label">Авто</span>' +
    AUTO_COUNTS.map((k) => `<button class="auto-btn" data-auto="${k}" aria-pressed="false">${k}</button>`).join('');

  renderFreeSpinBuy(c, locked);
  // Бесплатный кейс открывается по одному и только подарком: ни икса, ни
  // авто, ни пачек фриспинов у него нет.
  document.getElementById('countRow').hidden = !!c.free;
  document.getElementById('autoToggle').hidden = !!c.free;
  document.getElementById('autoRow').hidden = !!c.free;

  const openBtn = document.getElementById('doOpenBtn');
  let count = 1;
  let auto = 0;
  // Число авто, к которому вернётся переключатель: выключил и включил снова -
  // получил то же, что выбирал, а не сброс на десять.
  let autoLast = AUTO_COUNTS[0];

  const refresh = () => {
    countVal.textContent = `×${auto ? 1 : count}`;
    document.getElementById('countRow').classList.toggle('is-off', !!auto);
    autoToggle.classList.toggle('active', !!auto);
    autoToggle.setAttribute('aria-pressed', String(!!auto));
    autoBadge.textContent = auto ? String(auto) : '';
    document.querySelectorAll('#autoRow .auto-btn').forEach((b) => {
      const on = Number(b.dataset.auto) === auto;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });

    if (locked) {
      openAct.textContent = `Откроется ${locked}`;
      openSub.textContent = '';
      openPrice.hidden = true;
      openBtn.disabled = true;
      fitOpenBtn();
      return;
    }
    openPrice.hidden = false;

    if (c.free) {
      openAct.textContent = 'Открыть';
      openSub.textContent = freeCount ? `подарков: ${freeCount}` : 'подарок за пополнение';
      openPrice.textContent = 'Бесплатно';
      openBtn.classList.remove('is-short');
      fitOpenBtn();
      return;
    }

    // Автооткрытие крутит кейс по одному. На кнопке полная сумма серии, а
    // не «10 раз подряд»: игрок видит, на сколько он соглашается.
    if (auto) {
      openAct.textContent = `Открыть ${auto} раз`;
      openSub.textContent = `по ${money(c.price)}`;
      openPrice.textContent = money(auto * c.price);
      // Не disabled: у отключённой кнопки клик не срабатывает, и игрок без
      // денег не попадал в «Пополнить». Нехватку показывает приглушённый вид.
      openBtn.classList.toggle('is-short', !freeCount && c.price > spendableMoney());
      fitOpenBtn();
      return;
    }

    // Ваучеры покрывают первые открытия пачки, остальное платное.
    const paid = Math.max(0, count - freeCount);
    openAct.textContent = paid === 0 ? 'Открыть бесплатно' : 'Открыть';
    openSub.textContent = count > 1 ? `${count} ${plural(count, 'кейс', 'кейса', 'кейсов')} сразу` : 'один кейс';
    openPrice.textContent = paid === 0 ? `×${count}` : money(paid * c.price);
    openBtn.classList.toggle('is-short', paid * c.price > spendableMoney());
    fitOpenBtn();
  };
  refresh();

  document.querySelectorAll('#countRow [data-step]').forEach((btn) => {
    btn.onclick = () => {
      if (auto) return;
      const next = Math.min(maxCount, Math.max(1, count + Number(btn.dataset.step)));
      if (next === count) return;
      count = next;
      haptic('light');
      // Выбранный икс виден сразу, до нажатия «Открыть», а не выясняется
      // после списания: у обычного кейса перерисовываются барабаны, у кейса с
      // обрядом - кейсы на сцене.
      if (hasRitual(c)) renderCaseStage(c, count);
      else renderIdleReel(c, count);
      refresh();
    };
  });

  const setAuto = (k) => {
    auto = k;
    if (k) autoLast = k;
    haptic('light');
    // Автооткрытие крутит по одному кейсу, поэтому и на экране снова один.
    if (hasRitual(c)) renderCaseStage(c, auto ? 1 : count);
    else renderIdleReel(c, auto ? 1 : count);
    refresh();
  };
  // Повторное нажатие на выбранное число выключает авто: отдельной плашки
  // «выкл» больше нет, а переключатель справа делает то же одним касанием.
  document.querySelectorAll('#autoRow .auto-btn').forEach((btn) => {
    btn.onclick = () => setAuto(Number(btn.dataset.auto) === auto ? 0 : Number(btn.dataset.auto));
  });
  autoToggle.onclick = () => setAuto(auto ? 0 : autoLast);

  openBtn.onclick = () => (c.free ? startOpening(c.id, 1)
    : auto ? runAutoOpen(c.id, auto) : startOpening(c.id, count));

  document.getElementById('result').hidden = true;
  document.getElementById('gamble').hidden = true;
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('batchSummary').hidden = true;
  document.getElementById('freespins').hidden = true;
  document.getElementById('fsCollect').hidden = true;
  document.getElementById('autoPanel').hidden = true;
  document.getElementById('casePanel').hidden = false;

  document.getElementById('opener').hidden = false;
  document.body.classList.add('case-open');
  window.scrollTo({ top: 0 });
  document.querySelector('.opener-scroll').scrollTop = 0;
  updateOpenerBalance();
  // Замер кнопки - только у показанного окна: у скрытого ширина нулевая.
  fitOpenBtn();
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
  // Тихо: гость смотрит кейс, и окно входа на просмотре ему не нужно.
  try { ({ pending } = await api('/api/freespins/pending', null, { quiet: true })); }
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
 * Кейсов ровно столько, сколько откроется: выбрал ×2 - и на сцене стоят два.
 * Это то же правило, что было у лент до обряда: сколько иксов, столько и
 * барабанов. Без него иксы на экране кейса с обрядом ничего не меняли, и что
 * они значат, приходилось выяснять уже на своих деньгах.
 */
function renderCaseStage(c, count = 1) {
  const stage = document.getElementById('caseStage');
  const row = document.getElementById('caseStageRow');
  const reels = document.getElementById('reels');
  // На сцене обложка крупная и одна: ей нужен свой, крупный файл, а не
  // обложка полки, растянутая вдвое. Но крупный файл в три раза тяжелее, и
  // пока он едет, сцена стояла пустой. Поэтому сначала ставится обложка полки
  // (она уже в кеше браузера: игрок только что нажал на неё), а крупная
  // подменяет её, когда целиком загрузится и раскодируется.
  const hi = caseStageSrc(c);
  const low = caseArtSrc(c);
  const src = low || hi;

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

  if (hi && hi !== src) {
    const pic = new Image();
    pic.src = hi;
    pic.decode().then(() => {
      row.querySelectorAll('.case-stage-art').forEach((img) => {
        if (img.getAttribute('src') === src) img.src = hi;
      });
    }).catch(() => { /* крупной нет - остаётся обложка полки */ });
  }

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
 * Барабанов рисуется столько же, сколько кейсов открывают: выбрал ×2 - и
 * сразу видно два барабана. Раньше их число менялось только после нажатия
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
    // Экран кейса в этот момент ещё может быть скрыт: меряем после показа.
    requestAnimationFrame(() => fitNames(reel));

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
 * плитки в стилях - и лента доезжала не до той позиции: под маркером
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

/** key = 'fsProbability' для ленты серии фриспинов: у неё своя таблица. */
function weightedSample(items, key = 'probability') {
  const r = Math.random();
  let acc = 0;
  for (const it of items) {
    acc += it[key] ?? it.probability;
    if (r < acc) return it;
  }
  return items[0];
}

/*
 * Оформление принадлежит ПРЕДМЕТУ и приходит с сервера полем `skin`
 * (server/card-skins.js). Внутри одного кейса соседние карточки обязаны
 * различаться: кейс открывают ради его состава, а не ради сравнения кейсов
 * между собой.
 *
 * Запасные значения нужны там, где скина нет: витринный предмет и записи
 * выпадений, сделанные до этой правки.
 */
const DEFAULT_SKIN = { family: 'slate', shape: 'card', material: 'matte' };

/**
 * Оформление по идентификатору кейса. Общая лента выпадений показывает
 * выигрыши из чужих кейсов, и тема до неё не доезжает - зато доезжает caseId,
 * а список кейсов уже лежит в состоянии.
 */
function skinOfCase(caseId) {
  return state.config?.cases?.find((x) => x.id === caseId)?.visual || DEFAULT_SKIN;
}

function skinAttrs(visual) {
  const v = visual || DEFAULT_SKIN;
  return `data-family="${v.family}" data-shape="${v.shape}" data-material="${v.material}"`;
}

/**
 * Рисунок предмета.
 *
 * Свой рисунок у каждого из 820 предметов и у каждой плюшки (item-art-hd.js,
 * public/hd/). Ключ приходит с сервера полем `art` - тема и номер, а не
 * название: одиннадцать названий повторяются в разных темах, и по имени два
 * разных предмета получили бы одну картинку.
 *
 * Объём там рисуется слоями градиентов и бликом, а не SVG-фильтром: фильтр на
 * шестидесяти плитках ленты заметно тормозит в мобильном браузере.
 *
 * Прежние наборы (item-art64.js и мелкие мотивы медальоном) остались запасом
 * для того, у чего ключа нет: витринной плитки и выпадений, записанных до
 * появления ключа.
 */
function tileArt(item, color) {
  if (item.photo) return `<img class="tile-photo" src="${item.photo}" alt="">`;
  const own = itemArtHd(item.art);
  if (own) return own;
  const big = itemArt64(item.name);
  if (big) return big;
  const small = itemArtMaterial(item.name) || itemArt(item.name, color) || iconTier(item.tier, color);
  return `<span class="art-medal">${small}</span>`;
}

/*
 * Длинное слово в подписи не переносится и уезжает под край плитки: «10
 * ФРИСПИНО» вместо «10 ФРИСПИНОВ». С ценой то же: «Подарочный кейс» и
 * «26 240 000 ₽» на телефоне получали многоточие. Ширина плитки зависит от экрана, шрифт и
 * разрядка - от семейства, поэтому заранее стилями это не решить. Подпись,
 * которая не влезла, ужимается по факту замера. Сначала все чтения, потом все
 * записи: иначе каждая плитка заново пересчитывала бы раскладку.
 */
const NAME_FIT_SEL = '.tile-name > span, .drop-name > span, .tile-value, .drop-value';
/** Мельче этой доли подпись не становится: дальше её уже не прочитать. */
const NAME_MIN_SCALE = 0.55;
/** Запас на сглаживание: замер в целых точках, а шрифт сжимается дробно. */
const NAME_FIT_SLACK = 0.97;

function fitNames(root, reset = false) {
  if (!root) return;
  const spans = [...root.querySelectorAll(NAME_FIT_SEL)];
  if (reset) for (const s of spans) s.style.fontSize = '';
  const fixes = [];
  for (const s of spans) {
    const w = s.clientWidth;
    if (w && s.scrollWidth > w + 1) {
      // Поля в обеих ширинах одинаковы и в масштаб не входят: у цены они
      // заметные, и без вычета она оставалась бы с многоточием.
      const cs = getComputedStyle(s);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const k = (w - pad) / (s.scrollWidth - pad);
      // В точках от своего размера, а не в em: em считается от родителя, и у
      // цены, чей размер задан ей самой, сжатие выходило меньше нужного.
      fixes.push([s, parseFloat(cs.fontSize) * Math.max(NAME_MIN_SCALE, k * NAME_FIT_SLACK)]);
    }
  }
  for (const [s, px] of fixes) s.style.fontSize = `${px.toFixed(2)}px`;
}

// Сетка состава и выпадений тянется по ширине окна: после поворота телефона
// или смены размера окна подписи меряются заново. И после загрузки шрифтов:
// замер, сделанный запасным шрифтом, дисплейному мал, он шире.
let nameFitTimer = 0;
function refitOpenerNames() {
  clearTimeout(nameFitTimer);
  nameFitTimer = setTimeout(() => {
    if (!document.getElementById('opener').hidden) fitNames(document.getElementById('opener'), true);
  }, 200);
}
addEventListener('resize', refitOpenerNames);
document.fonts?.addEventListener?.('loadingdone', refitOpenerNames);

function tileHtml(item, visual) {
  // Скин принадлежит предмету. visual остаётся запасным: витринная плитка и
  // старые записи выпадений своего скина не несут.
  const color = tierColor(item.tier);
  let value;
  if (item.showcase) value = '<span class="tile-showcase">ВИТРИНА</span>';
  else if (item.kind === 'perk' && !item.value) value = iconStar();
  else value = money(item.value);

  // У витринного предмета вместо значка редкости - сама фотография: ради неё
  // он в ленте и крутится.
  const icon = tileArt(item, color);

  return `<div class="reel-tile rw-skin ${item.showcase ? 'is-showcase' : ''}"
      ${skinAttrs(item.skin || visual)} style="--tier-color:${color}">
    <div class="tile-icon">${icon}</div>
    <div class="tile-name"><span>${esc(item.name)}</span></div>
    <div class="tile-value">${value}</div>
  </div>`;
}

// Позиции витринного предмета в ленте. Среди них нет WINNER_INDEX - витрина
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
 * когда лента замедляется, щелчки редеют сами - как у настоящего барабана.
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

/**
 * Открытие кейса.
 *
 * again - повтор с экрана результата. Обряд (тряска кейса) положен только
 * первому открытию: на «Ещё раз» на экране уже стоит лента, игрок смотрит на
 * неё и ждёт следующего прокрута, и возвращать кейс на сцену ради второй
 * тряски значит секунду держать его перед тем, чего он уже попросил.
 */
async function startOpening(caseId, count = 1, { again = false } = {}) {
  if (state.busy) return;
  const c = state.config.cases.find((x) => x.id === caseId);
  if (!c) return;

  const freeCount = (state.user.vouchers || []).find((v) => v.case_id === c.id)?.count || 0;
  // Бесплатный кейс без подарка не открывается: вместо кассы - приглашение.
  if (c.free && !freeCount) { showStartGate(c); return; }
  const need = Math.max(0, count - freeCount) * c.price;
  if (need > spendableMoney()) {
    needMoney(need - spendableMoney());
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
  const ritual = hasRitual(c) && !again ? playRitual(c, count) : null;
  if (again) clearCaseStage();

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

  // Число зрителей выдуманное и своё для каждого кейса - чисто оформление.
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
  document.body.classList.add('case-open');
  window.scrollTo({ top: 0 });
  document.querySelector('.opener-scroll').scrollTop = 0;

  /*
   * Историю здесь НЕ обновляем.
   *
   * Сервер записал раунд в тот же миг, когда его посчитал, а лента едет ещё
   * несколько секунд. Обновив список сейчас, мы показали бы игроку его
   * собственный выигрыш до того, как он его увидел на ленте, - прокрут
   * превращался бы в формальность. История обновляется там, где результат
   * уже показан: в showResult, showBatchResult и по концу автооткрытия.
   */

  // Списание видно с первой секунды прокрута, а не задним числом.
  previewBalance(state.user.balance - data.totalSpent);

  if (ritual) await ritual;
  await spinReels(c, opened, SPIN_DURATION);

  sndLand();
  haptic('medium');
  await playDoublers(opened);

  /*
   * Показ выигрыша - с плитки, на которой встала лента, и до экрана
   * результата: карточка срывается именно с того места, куда смотрит игрок.
   * В пачке событие - лучший предмет, показывается только он.
   */
  let bestIdx = 0;
  opened.forEach((o, i) => { if ((o.item.value || 0) > (opened[bestIdx].item.value || 0)) bestIdx = i; });
  const best = opened[bestIdx].item;
  if (best.kind !== 'perk' || best.value) {
    await motion().win(best, {
      tile: winnerTile(bestIdx), price: c.price, theme: c.theme,
      collectTo: document.getElementById('openerBalance'),
    });
  }

  // Фриспины проигрываются до итогового экрана: сначала игрок видит, сколько
  // они принесли, и только потом - общий результат прокрута. Итог серии
  // сравнивается с ценой открытия: за неё игрок и получил серию.
  const fsGrants = collectFreeSpins(data);
  if (fsGrants.length) {
    // Ленты, на которых выпали серии: из каждой летит свой сгусток пролога, и
    // в центре они сливаются в один. Итог общей серии сравнивается с ценой
    // именно этих открытий - за них игрок и получил прокруты.
    const from = opened.map((o, i) => ((o.granted || []).some((g) => g.type === 'freespins') ? i : -1))
      .filter((i) => i >= 0);
    const merged = mergeFreeSpinGrants(fsGrants);
    await runFreeSpins(merged, c, {
      cost: c.price * Math.max(1, from.length),
      origins: from.map(winnerTile),
      sub: merged.parts ? mergedSeriesSub(merged.parts) : null,
    });
  }

  if (count > 1) showBatchResult(data, c);
  else showCaseResult(data, c);
}

/**
 * Выигрышная плитка ленты - с номиналом предмета, без удвоителя.
 *
 * Удвоение показывается отдельно, когда лента встала (playDoublers): на
 * плитке стоит та же сумма, что у предмета в составе кейса, и игрок видит,
 * что выпало и что добавил удвоитель. baseValue присылает сервер; у старых
 * ответов его нет, и тогда плитка остаётся как была.
 */
function reelItem(o) {
  return o.x2Applied && o.item.baseValue != null
    ? { ...o.item, value: o.item.baseValue } : o.item;
}

/** Печать ×2 на всех плитках, где сработал удвоитель. Ждёт самую долгую. */
async function playDoublers(opened) {
  const jobs = opened
    .map((o, i) => (o.x2Applied && o.item.baseValue != null && o.item.value > o.item.baseValue
      ? motion().doubler(winnerTile(i), {
        from: o.item.baseValue, to: o.item.value,
        label: '×2', sub: 'удвоитель',
      })
      // Кейс-подарок удвоитель удваивает штуками: второй такой же кейс.
      : o.x2Applied && (o.granted || []).some((g) => g.type === 'voucher' && g.doubled)
        ? motion().doubler(winnerTile(i), { label: '×2', sub: 'удвоитель', note: '+1 кейс' })
        : null))
    .filter(Boolean);
  if (jobs.length) await Promise.all(jobs);
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
      if (i === WINNER_INDEX) strip.push(reelItem(opened[idx]));
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
      reel.insertAdjacentHTML('beforeend', tileHtml(weightedSample(c.items), c.visual));
      strip.push(null);
      guard++;
    }
    fitNames(reel);

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

    // Щелчки снимаем только с первой ленты - иначе они сливаются в шум.
    if (idx === 0) trackReelTicks(reel, step, duration * 1000);
  });

  const tail = duration >= SETTLE_MIN_DURATION ? SETTLE_MS + 260 : 150;
  return new Promise((done) => setTimeout(done, duration * 1000 + tail));
}

/* ============================================================
   ПОКУПКА ФРИСПИНОВ
   ============================================================ */

/**
 * Кнопки покупки серии фриспинов.
 *
 * Компактные плитки: число прокрутов, подпись и цена. Раньше блок был собран
 * вокруг присланного макета - картинка-заголовок во всю ширину и нарисованные
 * монеты, - и на экране кейса занимал больше места, чем сама лента. Заказчик
 * выбрал вид из демо анимации: покупка серии - дополнительная кнопка, а не
 * главное на странице.
 *
 * Цену считает сервер, здесь она пересчитывается только для показа - по тем же
 * числам из конфига.
 */
function renderFreeSpinBuy(c, locked) {
  const box = document.getElementById('fsBuy');
  const row = document.getElementById('fsBuyRow');
  const packs = state.config.freeSpinPacks || [];

  if (!packs.length || locked || c.free) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  row.innerHTML = packs.map((p) => {
    const price = freeSpinPackPrice(c, p);

    return `<button class="fsbuy-btn${p.popular ? ' is-popular' : ''}" data-fs="${p.count}"
        aria-label="${p.count} прокрутов за ${money(price)}"
        ${price > spendableMoney() ? 'disabled' : ''}>
      <b class="fsbuy-count">${p.count}</b>
      <span class="fsbuy-word">free spins</span>
      <span class="fsbuy-price">${money(price)}</span>
      ${p.popular ? '<span class="fsbuy-flag">Хит</span>' : ''}
    </button>`;
  }).join('');

  row.querySelectorAll('[data-fs]').forEach((btn) => {
    btn.addEventListener('click', () => confirmBuyFreeSpins(c, Number(btn.dataset.fs), btn));
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
/** Сколько жетонов кружит вокруг большого: больше тридцати сливаются в кольцо. */
const BUY_ORBIT_MAX = 30;

/** Уход сцены покупки: короткий, решение уже принято. */
const BUY_SCENE_OUT_MS = 200;
// Миг, когда жетон долетел (около 60% анимации bsToken в 0.9 с).
const BUY_TOKEN_LAND_MS = 540;

/**
 * Покупка серии фриспинов - сцена, а не окно с таблицей.
 *
 * Плитка пачки срывается с того места, где её нажали, и разворачивается в
 * крупный объёмный жетон; вокруг него по кругу встают жетоны, по одному на
 * прокрут, - сколько их, видно глазами, а не только цифрой. Ниже коротко:
 * какой кейс, сколько останется на счету, и золотая кнопка с ценой той же
 * разметки, что «Открыть». Цена здесь - та же, что на плитке и на сервере.
 */
function confirmBuyFreeSpins(c, count, fromEl = null) {
  const pack = (state.config.freeSpinPacks || []).find((p) => p.count === count);
  if (!pack) return;

  const price = freeSpinPackPrice(c, pack);
  const scene = document.getElementById('buyBackdrop');
  const token = document.getElementById('buyArt');

  // Объёмный жетон из набора плюшек, а для числа, которого там нет (30), -
  // присланная монета той же пачки. Пути целиком, чтобы их увидела сборка.
  const FS_COINS = { 10: '/assets/ui/fs-coin-10.webp', 20: '/assets/ui/fs-coin-20.webp', 30: '/assets/ui/fs-coin-30.webp' };
  token.innerHTML = itemArtHd(`perk/fs/${count}`)
    || (FS_COINS[count] ? `<img src="${FS_COINS[count]}" alt="">` : `<b>${count}</b>`);
  document.getElementById('buyTitle').innerHTML =
    `<span class="bs-count">${count}</span><span class="bs-word">FREE SPINS</span>`;
  document.getElementById('buyCase').textContent = `кейс «${c.name}»`;
  const perSpin = Math.round(price / count);
  document.getElementById('buyRows').innerHTML = `
    <span>по ${money(perSpin)} за прокрут</span>
    <span>останется ${money(Math.max(0, spendableMoney() - price))}</span>`;
  // Таблица серии своя, и это говорится прямо: крупное в ней чаще.
  document.getElementById('buyNote').textContent =
    `Прокруты начнутся сразу. В серии крупные выигрыши выпадают в ${String(c.fsBoost || 1.5).replace('.', ',')} раза чаще, чем при обычном открытии.`;

  // Жетоны вокруг: по одному на прокрут, каждый со своей задержкой появления.
  const n = Math.min(count, BUY_ORBIT_MAX);
  document.getElementById('buyOrbit').innerHTML = Array.from({ length: n }, (_, i) =>
    `<i style="--a:${((i / n) * 360).toFixed(1)}deg;--d:${(300 + i * 28)}ms"></i>`).join('');

  const confirmBtn = document.getElementById('buyConfirm');
  const cancelBtn = document.getElementById('buyCancel');
  const short = price > spendableMoney();
  confirmBtn.querySelector('.open-act > span').textContent = short ? 'Не хватает' : 'Купить';
  document.getElementById('buySub').textContent = `${count} ${plural(count, 'прокрут', 'прокрута', 'прокрутов')}`;
  document.getElementById('buyPrice').textContent = money(price);
  confirmBtn.disabled = short;

  // Жетон вылетает с плитки: сдвиг считается от её настоящего места.
  scene.hidden = false;
  scene.classList.remove('is-in', 'is-out');
  const from = fromEl?.getBoundingClientRect();
  const to = token.getBoundingClientRect();
  if (from && from.width && to.width) {
    token.style.setProperty('--fx', `${(from.left + from.width / 2 - (to.left + to.width / 2)).toFixed(0)}px`);
    token.style.setProperty('--fy', `${(from.top + from.height / 2 - (to.top + to.height / 2)).toFixed(0)}px`);
    token.style.setProperty('--fs', (from.height / to.height).toFixed(3));
  } else {
    token.style.setProperty('--fx', '0px');
    token.style.setProperty('--fy', '60px');
    token.style.setProperty('--fs', '0.4');
  }
  void scene.offsetWidth;
  scene.classList.add('is-in');
  requestAnimationFrame(() => fitOpenBtn(confirmBtn));
  sndWhoosh(true);
  // Жетон садится на место примерно к середине своей кривой: в этот миг
  // вспышка искр, звон и раздача кольца.
  setTimeout(() => {
    if (scene.hidden || scene.classList.contains('is-out')) return;
    sndDeal(4); sndChime();
    const r = token.getBoundingClientRect();
    sparkBurst(scene, r.left + r.width / 2, r.top + r.height / 2,
      { n: 22, colors: ['#ffe58a', '#ffffff', '#c9a8ff'], dist: [70, 150], size: 5 });
  }, BUY_TOKEN_LAND_MS);

  const close = () => {
    if (scene.classList.contains('is-out')) return;
    scene.classList.add('is-out');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    scene.onclick = null;
    setTimeout(() => { scene.hidden = true; scene.classList.remove('is-in', 'is-out'); }, BUY_SCENE_OUT_MS);
  };

  confirmBtn.onclick = () => { close(); buyFreeSpins(c.id, count); };
  cancelBtn.onclick = () => { close(); haptic('light'); };
  // Закрывается нажатием мимо: по затемнению и пустому месту сцены.
  scene.onclick = (e) => { if (!e.target.closest('.bs-actions, .bs-token, .bs-info')) close(); };
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

  // Кнопку пачки прячут вместе с панелью кейса, а сгусток пролога вылетает
  // именно из неё - поэтому её место снимается до того, как она исчезнет.
  const btnRect = document.querySelector(`#fsBuyRow [data-fs="${count}"]`)?.getBoundingClientRect();
  const origin = btnRect && btnRect.width
    ? { cx: btnRect.left + btnRect.width / 2, cy: btnRect.top + btnRect.height / 2 }
    : null;

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

  // Покупка - событие, за которое игрок заплатил: пролог серии отыгрывает
  // целиком, прежде чем поедет первая лента (runFreeSpins). Итог серии
  // сравнивается с ценой пачки.
  await runFreeSpins(data.grant, c, { cost: data.cost, origin });

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

/**
 * Цена под надписью, если в строку они не влезают.
 *
 * Решить это шириной экрана нельзя: на одном и том же телефоне «1 499 ₽»
 * помещается рядом с «Открыть» свободно, а «4 999 950 ₽» за пятьдесят
 * открытий дорогого кейса сжимает надпись до «О…». Поэтому кнопка меряет
 * сама себя: надпись обрезалась - цена переезжает вниз.
 */
function fitOpenBtn(target) {
  // «Ещё раз» устроена так же, как «Открыть», и меряется тем же кодом.
  const btn = target instanceof HTMLElement ? target : document.getElementById('doOpenBtn');
  if (!btn || !btn.offsetParent) return;
  btn.classList.remove('is-tight');
  const cut = [...btn.querySelectorAll('.open-act > span, .open-act small')]
    .some((el) => el.scrollWidth > el.clientWidth + 1);
  btn.classList.toggle('is-tight', cut);
}
addEventListener('resize', () => fitOpenBtn());
// Просмотр предмета закрывается и с клавиатуры: на компьютере до кнопки
// «Закрыть» тянуться мышью дальше, чем до Esc.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  motion().closeInspect();
  if (!document.getElementById('feedBackdrop').hidden) document.getElementById('feedSheetClose').click();
  if (!document.getElementById('buyBackdrop').hidden) document.getElementById('buyCancel').click();
});
// Дисплейный шрифт шире запасного: приехал позже замера - меряем заново.
document.fonts?.ready.then(() => fitOpenBtn());

/* ============================================================
   АВТООТКРЫТИЕ
   ============================================================ */

/**
 * Сколько прокрутов подряд можно заказать. Сотни нет по просьбе заказчика:
 * четыре плашки рядом с подписью «Авто» не влезали в строку, а сто открытий
 * подряд - это не удобство, а уход в ленту на десять минут.
 */
const AUTO_COUNTS = [10, 25, 50];

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
  document.body.classList.add('case-open');
  window.scrollTo({ top: 0 });
  panel.hidden = false;
  logEl.innerHTML = '';
  totalEl.textContent = money(0);
  document.querySelector('.opener-scroll').scrollTop = 0;

  document.getElementById('openerCaseName').innerHTML =
    `${esc(c.name)} · <span>авто ×${times}</span>`;

  /*
   * Идущая серия подсвечена в том же ряду чисел, где её выбрали, с полосой
   * прогресса. Нажатие на это число останавливает серию: игрок ищет
   * выключатель там, где включал. Остальные числа во время серии молчат.
   */
  const runRow = document.getElementById('autoRunRow');
  runRow.innerHTML = '<span class="auto-row-label">Авто</span>' + AUTO_COUNTS.map((k) =>
    `<button class="auto-btn${k === times ? ' active is-running' : ''}" data-auto="${k}" ${k === times ? '' : 'disabled'}>
      <span>${k}</span>${k === times ? '<small>стоп</small><i class="auto-progress"></i>' : ''}
    </button>`).join('');
  const runBtn = runRow.querySelector('.is-running');
  const setProgress = (n) => runBtn?.style.setProperty('--p', `${Math.round((n / times) * 100)}%`);
  setProgress(0);
  if (runBtn) runBtn.onclick = () => document.getElementById('autoStop').click();

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
    if (!freeLeft && c.price > spendableMoney()) {
      needMoney(c.price - spendableMoney());
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
    await playDoublers([data]);

    // Фриспины внутри серии забираются сами: серия на то и авто, чтобы не
    // требовать нажатий. Анимацию всё же показываем - это главный момент.
    for (const g of collectFreeSpins(data)) await runFreeSpins(g, c, { auto: true });

    spent += data.totalSpent;
    won += data.totalWon;
    done++;
    setProgress(done);

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

    // В автооткрытии показ короче и сам уступает следующему прокруту:
    // смысл режима в том, чтобы игрок не жал кнопки.
    await motion().win(data.item, { tile: winnerTile(0), price: c.price, theme: c.theme, auto: true });

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
  const running = document.querySelector('#autoRunRow .is-running');
  if (running) {
    running.classList.add('is-stopping');
    running.querySelector('small').textContent = 'стоим';
  }
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

/** Все выдачи фриспинов из ответа - и одиночного прокрута, и пачки. */
/**
 * Серии фриспинов из ответа открытия.
 *
 * Берутся из opened, а granted верхнего уровня - только когда opened нет.
 * Сервер кладёт поля первого открытия и наверх (на них опирается анимация
 * одиночного прокрута), и сбор из обоих мест проигрывал серию первого кейса
 * дважды.
 */
function collectFreeSpins(data) {
  const sources = data.opened ? data.opened.map((o) => o.granted) : [data.granted];
  return sources.flatMap((list) => (list || []).filter((g) => g.type === 'freespins'));
}

/**
 * Несколько серий одного открытия - одна общая серия.
 *
 * В пачке фриспины могут выпасть на обеих лентах сразу. Показывать их
 * двумя сериями подряд значит дважды проиграть пролог и дважды подвести итог:
 * событие, которое случается раз на сотни пачек, растворялось в повторе.
 * Общая серия - одно событие («двойная серия»), один счёт и один итог.
 *
 * Денег это не меняет ни на копейку. Каждая серия посчитана сервером в
 * транзакции своего открытия и уже входит в отдачу кейса; здесь они только
 * складываются для показа. Никакого бонуса за совпадение нет и быть не
 * должно: он не входит в матожидание кейса и сломал бы отдачу.
 *
 * Та же склейка стоит на сервере (mergeFreeSpinGrants в server/app.js) - для
 * доигрывания недосмотренной серии.
 */
function mergeFreeSpinGrants(grants) {
  if (grants.length === 1) return grants[0];
  return {
    type: 'freespins',
    caseId: grants[0].caseId,
    count: grants.reduce((n, g) => n + (g.count || g.spins.length), 0),
    capped: grants.some((g) => g.capped),
    spins: grants.flatMap((g) => g.spins),
    total: grants.reduce((n, g) => n + (g.total || 0), 0),
    parts: grants.map((g) => g.count || g.spins.length),
  };
}

/**
 * Эмблема серии. Рисунки есть только на числа из таблицы плюшек и пачек;
 * у общей серии число сумма (10 + 12 = 22), и тогда берётся эмблема первой
 * из сложенных серий.
 */
function fsEmblem(grant, count) {
  return itemArtHd(`perk/fs/${count}`) || itemArtHd(`perk/fs/${grant.parts?.[0] || grant.count}`) || '';
}

/** Подпись под числом прокрутов в прологе общей серии. */
function mergedSeriesSub(parts) {
  const name = { 2: 'двойная серия', 3: 'тройная серия' }[parts.length] || `${parts.length} серии`;
  return `${name} · ${parts.join(' + ')}`;
}

/**
 * Проигрывает серию фриспинов.
 *
 * Исход каждого прокрута уже посчитан сервером и лежит в ответе - здесь только
 * анимация. Сумма копится на экране крупными цифрами: это и есть смысл режима,
 * поэтому она набирается на глазах, а не появляется готовой в конце.
 *
 * Пролог (сгусток, взрыв, FREE SPINS, жетоны в ячейки) играется у купленной и
 * у выпавшей серии, но не в автооткрытии и не при доигрывании: там серию уже
 * видели или смотрят мельком.
 *
 * @param {object} opts
 * @param {number} [opts.cost]    чем заплачено за серию: цена пачки или цена
 *                                открытия, в котором она выпала. По ней итог
 *                                решает, праздновать ли (см. seriesVerdict)
 * @param {Element|object} [opts.origin] откуда летит сгусток пролога
 */
async function runFreeSpins(grant, caseData, { auto = false, replay = false, cost = 0, origin = null, origins = null, sub = null } = {}) {
  const box = document.getElementById('freespins');
  const reel = document.getElementById('fsReel');
  const totalEl = document.getElementById('fsTotal');
  const leftEl = document.getElementById('fsLeft');
  const logEl = document.getElementById('fsLog');
  const collectBtn = document.getElementById('fsCollect');
  const pipsEl = document.getElementById('fsPips');
  const verdictEl = document.getElementById('fsVerdict');

  /*
   * Ячеек столько, сколько прокрутов игрок увидит. На старте это число без
   * ретриггеров; серия, упёршаяся в потолок, прокрутов меньше, чем обещано, и
   * лишних ячеек, которые так и не погаснут, быть не должно.
   */
  const added = grant.spins.reduce((n, sp) => n + (sp.added || 0), 0);
  const startCount = Math.max(1, Math.min(grant.spins.length, (grant.count || grant.spins.length) - added));
  let shown = startCount;

  const withIntro = !auto && !replay;
  const open = (filled) => {
    document.getElementById('result').hidden = true;
    document.getElementById('batchSummary').hidden = true;
    // Серия может начаться и с непрокрученного кейса - купленными фриспинами
    // или доигрыванием прошлой серии на входе. Сцена с кейсом тогда осталась
    // бы висеть над барабаном фриспинов.
    document.getElementById('caseStage').hidden = true;
    box.hidden = false;
    // После пачки серия стоит под двумя лентами, за нижним краем телефона.
    // Прокручиваем, только если она не видна: у одиночного открытия экран
    // прыгал бы без нужды.
    if (box.getBoundingClientRect().bottom > innerHeight) box.scrollIntoView({ block: 'start' });
    collectBtn.hidden = true;
    logEl.innerHTML = '';
    verdictEl.innerHTML = '';
    verdictEl.className = 'fs-verdict';
    totalEl.textContent = money(0);
    leftEl.textContent = `0 из ${shown}`;
    document.getElementById('opener').classList.add('is-bonus');
    document.getElementById('fsEmblem').innerHTML = fsEmblem(grant, startCount);
    pipsEl.innerHTML = Array.from({ length: startCount }, () => `<i class="fs-pip${filled ? ' full' : ''}"></i>`).join('');
    return {
      pips: [...pipsEl.children],
      emblem: document.getElementById('fsEmblem'),
      onToken: (i) => {
        const pip = pipsEl.children[i];
        if (!pip) return;
        pip.classList.add('full', 'pop');
        leftEl.textContent = `0 из ${i + 1}`;
      },
    };
  };

  if (withIntro) {
    await motion().purchase({
      count: startCount, origin, origins, sub, theme: caseData.theme,
      emblem: fsEmblem(grant, startCount),
      prepare: () => open(false),
    });
    leftEl.textContent = `0 из ${shown}`;
  } else {
    open(true);
  }

  const SPIN_LEN = 26;
  const SPIN_WIN = 20;
  /* Прокрут внутри серии короче обычного - их подряд десятки, - но кривая та
     же: к предмету лента подходит ползком, а не гаснет на полном ходу. */
  const SPIN_MS = 2300;

  // Лента серии - по настоящим вероятностям серии (своя таблица фриспинов,
  // в ней крупное чаще), как и основная. Раньше плитки брались равномерно, и
  // предмет за 184 000 мелькал так же часто, как филлер: игрок читает по
  // ленте свои шансы, и это была ложь.
  const pickFiller = () => weightedSample(caseData.items, 'fsProbability');

  let acc = 0;

  const runOne = (i) => new Promise((done) => {
    const spin = grant.spins[i];
    // Длина серии растёт по ходу: перезапуск добавляет прокруты, поэтому
    // знаменатель берётся из показанного числа, а не из начального обещания.
    leftEl.textContent = `${i + 1} из ${shown}`;
    [...pipsEl.children].forEach((pip, k) => {
      pip.classList.toggle('spent', k < i);
      pip.classList.toggle('is-current', k === i);
    });

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
      reel.insertAdjacentHTML('beforeend', tileHtml(pickFiller(), caseData.visual));
      guard++;
    }
    fitNames(reel);

    requestAnimationFrame(() => {
      reel.style.transition = `transform ${SPIN_MS / 1000}s ${SPIN_EASE}`;
      reel.style.transform = `translateX(${-(target + step * OVERSHOOT)}px)`;
      sndSpinStart();

      setTimeout(() => {
        reel.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;
        reel.style.transform = `translateX(${-target}px)`;
      }, SPIN_MS + 20);

      setTimeout(async () => {
        sndLand();
        const tile = reel.children[SPIN_WIN];
        // Баланс растёт вместе с суммой серии: игрок видит, что выигрыш
        // капает по ходу, а не появляется одним прыжком в конце.
        // При доигрывании сохранённой серии баланс не трогаем: деньги за неё
        // зачислены ещё в тот раз, и второй раз их прибавлять нельзя.
        if (spin.value > 0 && !replay) previewBalance(state.user.balance + spin.value);

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
          // Ретриггер: новые жетоны вылетают из плитки в новые ячейки.
          const fresh = Math.max(0, Math.min(spin.added, grant.spins.length - shown));
          pipsEl.insertAdjacentHTML('beforeend', '<i class="fs-pip"></i>'.repeat(fresh));
          const newPips = [...pipsEl.children].slice(pipsEl.children.length - fresh);
          shown += fresh;
          leftEl.textContent = `${i + 1} из ${shown}`;
          if (newPips.length && tile) {
            await motion().retrigger(tile, newPips, (k) => newPips[k].classList.add('full', 'pop'));
          } else {
            sndRetrigger();
          }
        } else {
          // Крупный прокрут внутри серии: тот же показ, что у открытия, но
          // короче и без ожидания нажатия.
          if (tile && spin.value >= caseData.price * MOTION_NICE_AT) {
            await motion().win(spin, { tile, price: caseData.price, theme: caseData.theme, inSeries: true, auto, collectTo: totalEl });
          }
          if (spin.value > 0 && tile) motion().payout(`+${money(spin.value)}`, tile, totalEl, tierColor(spin.tier));
          haptic('light');
        }

        // Сумма прибавляется, когда до счётчика долетела её копия, а не раньше.
        setTimeout(() => {
          acc += spin.value;
          totalEl.textContent = money(acc);
          // Перезапуск анимации: без сброса класса подряд идущие прибавки
          // не «подпрыгивают».
          totalEl.classList.remove('bump');
          void totalEl.offsetWidth;
          totalEl.classList.add('bump');
          if (spin.value > 0) sndCoin();
        }, spin.value > 0 ? 700 : 0);
        setTimeout(done, spin.value > 0 ? 760 : 320);
      }, SPIN_MS + SETTLE_MS + 40);
    });
  });

  for (let i = 0; i < grant.spins.length; i++) await runOne(i);
  [...pipsEl.children].forEach((pip) => { pip.classList.remove('is-current'); pip.classList.add('spent'); });

  // Итог серии честный: празднуется только окупившаяся. Неокупившаяся
  // молчит: строка «серия вернула 85% цены» игроку ничего не даёт (решение
  // заказчика), сумма и так стоит на счётчике. Доигрывание итог не
  // сравнивает - цена той покупки здесь неизвестна.
  const ratio = cost > 0 ? grant.total / cost : 0;
  const compare = cost > 0 && !replay;
  if (compare) {
    verdictEl.className = 'fs-verdict';
    verdictEl.innerHTML = ratio >= 1 ? `<em>${seriesRatio(ratio)}</em> к цене ${esc(money(cost))}` : '';
  }
  haptic(ratio >= 1 ? 'success' : 'light');
  // Кнопка показывается ДО вылета суммы: сумма улетает именно в неё.
  collectBtn.hidden = false;
  collectBtn.textContent = `ЗАБРАТЬ ${money(grant.total)}`;
  // Вылет итога крупно (решение заказчика, октябрь 2026). В автооткрытии -
  // прежний короткий салют: там смысл в том, чтобы не задерживать серию.
  const showTotal = !auto && grant.total > 0;
  if (auto && compare) motion().seriesEnd(totalEl, ratio);
  else if (!showTotal) sndCollect();

  // Серию досмотрели - сервер может её забыть.
  const ack = () => { api('/api/freespins/ack').catch(() => {}); };
  const finish = () => {
    sndCollect();
    box.hidden = true;
    // Кнопка прячется вместе с панелью: иначе следующий показ панели на
    // долю секунды выводил бы «Забрать» прошлой серии.
    collectBtn.hidden = true;
    endBonusMode();
    ack();
  };

  // В серии автооткрытий забираем сами: смысл режима в том, чтобы игрок не
  // жал кнопки. Паузу всё же держим - сумму надо успеть прочитать.
  if (auto) {
    await sleep(1500);
    finish();
    return;
  }

  await new Promise((done) => {
    const take = () => {
      collectBtn.removeEventListener('click', take);
      fsCollectPending = null;
      finish();
      done();
    };
    // Ожидание «Забрать» ставится до показа итога, а не после: закрытие кейса
    // посреди показа обязано забрать за игрока (fsCollectPending в
    // closeOpener), иначе state.busy остался бы висеть.
    fsCollectPending = take;
    collectBtn.addEventListener('click', take);
    if (showTotal) {
      motion().seriesTotal(totalEl, { total: grant.total, cost: compare ? cost : 0, text: money(grant.total), button: collectBtn })
        .catch(() => {});
    }
  });
}

/*
 * Серия, ждущая «Забрать». Кейс могут закрыть, не нажав её (крестик, пункт
 * меню): тогда closeOpener забирает сам. Иначе открытие так и висело бы
 * незавершённым, state.busy не снимался, и ни один кейс больше не
 * открывался до перезагрузки страницы. Деньги серии начислены сервером
 * заранее, «Забрать» только закрывает показ.
 */
let fsCollectPending = null;

/** Множитель итога серии: ×1,4 или ×12. */
function seriesRatio(r) {
  return `×${r >= 10 ? Math.round(r) : r.toFixed(1).replace('.', ',')}`;
}

/** Выйти из бонусного режима окна кейса: фон темы возвращается. */
function endBonusMode() {
  document.getElementById('opener')?.classList.remove('is-bonus');
  const pips = document.getElementById('fsPips');
  if (pips) pips.innerHTML = '';
  const emblem = document.getElementById('fsEmblem');
  if (emblem) emblem.innerHTML = '';
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
      <button class="take-btn" id="batchClose">Забрать</button>
      <button class="open-cta again-cta" id="batchAgain">
        <span class="open-act"><span>Ещё раз</span><small></small></span>
        <span class="open-price"></span>
      </button>
    </div>
  `;
  box.hidden = false;
  setAgainButton(document.getElementById('batchAgain'), caseData, data.count);
  // Две полноразмерные ленты занимают большую часть экрана телефона, и итог
  // пачки оказывается под ними. Подводим к нему, если он не виден.
  if (box.getBoundingClientRect().top > innerHeight * 0.7) {
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  applyUser(data.user);
  updateOpenerBalance();
  loadCaseHistory(caseData.name);
  state.busy = false;

  sndReveal(best.item.tier);
  if (data.totalWon > data.totalSpent) { sndCollect(); haptic('success'); }
  else { sndLose(); haptic('light'); }

  // Выпадения пачки тоже идут в витрину.
  setTimeout(pollFeed, 400);

  // Показ лучшего предмета уже прошёл в startOpening, на ленте.

  document.getElementById('batchClose').addEventListener('click', returnToCaseIdle);
  document.getElementById('batchAgain').addEventListener('click', () =>
    startOpening(caseData.id, data.count, { again: true }));
}

function showCaseResult(data, caseData) {
  const item = data.item;
  const result = document.getElementById('result');
  result.style.setProperty('--tier-color', tierColor(item.tier));

  document.getElementById('resultTier').textContent = item.kind === 'perk'
    ? (item.perkLabel || 'Плюшка')
    : (state.config.tiers.find((t) => t.id === item.tier)?.label || item.tier);
  // Имя предмета залито градиентом его материала (золото, хром, голограмма):
  // та же карточка только что стояла на ленте, и подпись продолжает её, а не
  // начинает белым текстом заново.
  const nameEl = document.getElementById('resultName');
  nameEl.textContent = item.name;
  nameEl.dataset.material = item.skin?.material || 'matte';
  document.getElementById('resultValue').textContent =
    item.value ? money(item.value) : '-';

  const net = document.getElementById('resultNet');
  const parts = [];
  if (data.x2Applied) {
    const extra = item.baseValue != null ? item.value - item.baseValue : 0;
    const doubledGift = (data.granted || []).some((g) => g.type === 'voucher' && g.doubled);
    parts.push(extra > 0 ? `удвоитель ×2: +${fmt(extra)}`
      : doubledGift ? 'удвоитель ×2: два кейса' : 'удвоитель применён');
  }

  // Удвоителей за один прокрут может прийти несколько: сам предмет плюс те,
  // что выпали внутри серии фриспинов. Считаем их, а не пишем строку на каждый.
  const x2Won = (data.granted || []).filter((g) => g.type === 'x2').length;
  if (x2Won === 1) parts.push('получен удвоитель');
  else if (x2Won > 1) parts.push(`получено удвоителей: ${x2Won}`);

  for (const g of data.granted || []) {
    // Второй ваучер от удвоителя - тот же кейс: одна строка с «×2», а не две.
    if (g.type === 'voucher' && !g.doubled) {
      const twice = (data.granted || []).some((d) => d.type === 'voucher' && d.doubled && d.caseId === g.caseId);
      parts.push(`подарок: кейс «${g.caseName}»${twice ? ' ×2' : ''}`);
    }
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

  // Показ выигрыша уже прошёл в startOpening, с плитки ленты: здесь
  // только итог.

  // Рискнуть можно только тем, что реально выиграно на этом прокруте.
  const gambleBtn = document.getElementById('gambleStartBtn');
  const stake = state.user.gambleStake || 0;
  gambleBtn.hidden = stake <= 0;
  if (stake > 0) {
    const g = state.config.gamble;
    gambleBtn.innerHTML = `<span class="gamble-cta-suit">${iconAce()}</span>
      <span class="gamble-cta-txt"><b>Рискнуть</b><small>${money(stake)} → ${money(stake * g.payout)}</small></span>
      <span class="gamble-cta-x">×${g.payout}</span>`;
  }

  setAgainButton(document.getElementById('againBtn'), caseData, 1);
}

/**
 * «Ещё раз» той же разметкой, что и «Открыть»: надпись, подпись и цена
 * плашкой. Цена здесь не конец фразы, а отдельное число - это деньги игрока.
 */
function setAgainButton(btn, caseData, count) {
  const freeLeft = (state.user.vouchers || []).find((v) => v.case_id === caseData.id)?.count || 0;
  if (caseData.free) {
    // Подарков больше нет - кнопка ведёт к условию, а не в кассу.
    btn.disabled = false;
    btn.querySelector('.open-act > span').textContent = freeLeft ? 'Ещё раз' : 'Как получить ещё';
    btn.querySelector('.open-act small').textContent = freeLeft ? `подарков: ${freeLeft}` : 'за каждые 1 000 ₽ ставок';
    btn.querySelector('.open-price').textContent = 'Бесплатно';
    requestAnimationFrame(() => fitOpenBtn(btn));
    return;
  }
  const paid = Math.max(0, count - freeLeft);
  btn.disabled = paid * caseData.price > spendableMoney();
  btn.querySelector('.open-act > span').textContent = btn.disabled ? 'Не хватает' : 'Ещё раз';
  btn.querySelector('.open-act small').textContent =
    count > 1 ? `${count} ${plural(count, 'кейс', 'кейса', 'кейсов')} сразу` : 'тот же кейс';
  btn.querySelector('.open-price').textContent = paid === 0 ? 'бесплатно' : money(paid * caseData.price);
  requestAnimationFrame(() => fitOpenBtn(btn));
}

/* ---------- Бесплатный кейс «Начало»: приглашение ---------- */

/** Сколько сцена-приглашение ждёт, прежде чем закрыться сама. */
const START_GATE_MS = 16000;

/**
 * Сцена вместо кассы, когда «Начало» нечем открыть.
 *
 * Не тост и не окно подтверждения: это предложение, и оно должно выглядеть
 * подарком. Кейс поднимается из света, за ним медленно вращаются лучи, на
 * нём бирка FREE. Новичку - «пополните от 100 ₽», тому, кто кейс уже
 * открывал, - шкала до следующего (тот же оборот, что в Free Money).
 * Закрывается кнопкой, нажатием мимо, Esc и сама: ничто не ждёт вечно.
 */
function showStartGate(c) {
  document.getElementById('startGate')?.remove();
  const st = state.user?.startCase || { needDeposit: true, minDeposit: 100, step: 1000, progress: 0 };
  const guest = !!state.guest;
  const deposit = guest || st.needDeposit;
  const left = Math.max(0, st.step - st.progress);
  const pct = Math.round((st.progress / st.step) * 100);
  const cover = caseStageSrc(c) || caseArtSrc(c);
  const top = Math.max(...c.items.map((i) => i.value));

  const scene = document.createElement('div');
  scene.id = 'startGate';
  scene.className = 'sg-scene';
  scene.innerHTML = `
    <div class="sg-glow"></div>
    <div class="sg-card" role="dialog" aria-label="Как получить кейс «${esc(c.name)}»">
      <button class="sg-close" aria-label="Закрыть">×</button>
      <div class="sg-hero">
        <div class="sg-rays"></div>
        ${cover ? `<img class="sg-cover" src="${cover}" alt="">` : ''}
      </div>
      <div class="sg-kicker">${deposit ? 'Подарок новичку' : 'Кейс снова ждёт'}</div>
      <h3 class="sg-title">${deposit
        ? `Пополните от <b>${money(st.minDeposit)}</b><br>и кейс ваш бесплатно`
        : `Ещё <b>${money(left)}</b> ставок<br>и кейс снова ваш`}</h3>
      <p class="sg-sub">В кейсе до ${money(top)}. Выигрыш приходит на бонусный счёт.</p>
      ${deposit ? `<ol class="sg-steps">
        <li><i>1</i><span>Пополнение<br>от ${money(st.minDeposit)}</span></li>
        <li><i>2</i><span>Кейс<br>в подарок</span></li>
        <li><i>3</i><span>Ещё один за каждые ${fmt(st.step)} ₽ ставок</span></li>
      </ol>` : `<div class="sg-meter" style="--p:${pct}%">
        <div class="sg-meter-bar"><i></i></div>
        <div class="sg-meter-row"><span>${money(st.progress)}</span><span>из ${money(st.step)}</span></div>
      </div>`}
      <button class="sg-cta">${guest ? 'Зарегистрироваться' : deposit ? `Пополнить от ${money(st.minDeposit)}` : 'Играть дальше'}</button>
      <button class="sg-later">${deposit ? 'Позже' : 'Понятно'}</button>
    </div>`;
  document.body.appendChild(scene);
  void scene.offsetWidth;
  scene.classList.add('is-in');
  sndWhoosh(true);
  haptic('light');
  setTimeout(() => {
    if (!scene.isConnected || scene.classList.contains('is-out')) return;
    const r = scene.querySelector('.sg-cover, .sg-hero')?.getBoundingClientRect();
    if (r) sparkBurst(scene, r.left + r.width / 2, r.top + r.height * 0.55,
      { n: 20, colors: ['#ffe58a', '#ffffff', '#ffb648'], dist: [60, 140], size: 5 });
    sndChime();
  }, 520);

  let timer = 0;
  const close = () => {
    if (scene.classList.contains('is-out')) return;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    scene.classList.add('is-out');
    setTimeout(() => scene.remove(), 320);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  timer = setTimeout(close, START_GATE_MS);
  scene.querySelector('.sg-close').onclick = close;
  scene.querySelector('.sg-later').onclick = close;
  scene.onclick = (e) => { if (!e.target.closest('.sg-card')) close(); };
  scene.querySelector('.sg-cta').onclick = () => {
    close();
    if (guest) return openAuth(authDefaultPane());
    if (deposit) { closeOpener(); openCashier(); }
  };
}

/**
 * Значок красного туза: червонная масть. Нарисован здесь, а не взят из
 * значков: на кнопке риска, на рубашке выигрышной карты и в штампе нужен
 * один и тот же знак, и он должен читаться как карта, а не как звезда.
 */
function iconAce(color = 'currentColor') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${color}"
    d="M12 21c-.4 0-.8-.2-1.1-.4C6.4 17 3 14 3 9.9 3 7.2 5.1 5 7.7 5c1.8 0 3.3.9 4.3 2.4C13 5.9 14.5 5 16.3 5 18.9 5 21 7.2 21 9.9c0 4.1-3.4 7.1-7.9 10.7-.3.2-.7.4-1.1.4z"/></svg>`;
}

/* ---------- Вспомогательное для экрана прокрута ---------- */

/** Выдуманное число зрителей, но стабильное для кейса - чтобы не скакало. */
function viewersFor(caseId) {
  let h = 0;
  for (let i = 0; i < caseId.length; i++) h = (h * 31 + caseId.charCodeAt(i)) >>> 0;
  // Небольшой дрейф по времени, чтобы число выглядело живым. Диапазон 10-30:
  // сотня человек в одном кейсе - это уже не «рядом кто-то играет», а цифра,
  // которую никто не проверит и никто не поверит.
  return 10 + ((h + Math.floor(Date.now() / 60000)) % 21);
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

/** Сколько выпадений забирать с сервера за раз: столько же отдаёт ручка. */
const HISTORY_LOAD = 60;

/**
 * Предмет кейса по строке истории.
 *
 * В истории лежит подпись раунда, а не идентификатор предмета: «Имя (×2)» или
 * «10 фриспинов» за купленную серию. Внутри одного кейса имена не
 * повторяются, поэтому имени хватает, чтобы найти рисунок и оформление.
 */
function historyItem(c, h) {
  const mark = (h.subtitle || '').match(/ \(×(2|10)\)$/);
  const x2 = mark ? `×${mark[1]}` : '';
  const name = (h.subtitle || '').replace(/ \(×(2|10)\)$/, '');
  const own = c?.items.find((it) => it.name === name);
  const fs = name.match(/^(\d+) фриспинов$/);
  const base = own || {
    name, tier: h.tier, kind: fs ? 'perk' : 'item',
    art: fs ? `perk/fs/${fs[1]}` : null, skin: c?.visual,
  };
  return { ...base, value: h.payout, x2 };
}

/** Показ выпадения крупно: витрина, как у карточки состава. */
function inspectHistory(c, item, tile) {
  haptic('light');
  motion().inspect(item, {
    tile, price: c?.price || 0, theme: c?.theme,
    tierLabel: item.x2 ? `ваше выпадение · ${item.x2}` : 'ваше выпадение',
    valueNote: 'выпало вам',
  });
}

/**
 * Последние выпадения игрока именно из этого кейса.
 *
 * Два вида. На экране кейса - карточками, как состав, только мельче: это
 * то, что игрок уже достал из этого кейса, и показывать это надо тем же
 * языком, что и то, что достать можно. Во время прокрута - прежним списком
 * строк: под лентой и итогом карточки отвлекали бы от главного, а строка
 * читается краем глаза. Нажатие в обоих видах открывает предмет крупно.
 */
async function loadCaseHistory(caseTitle) {
  const box = document.getElementById('openerHistory');
  if (!box.children.length) {
    box.innerHTML = '<div class="hist-grid"><span class="skel skel-hist"></span><span class="skel skel-hist"></span><span class="skel skel-hist"></span></div>';
  }
  let history;
  try {
    ({ history } = await api('/api/history', { caseTitle, limit: HISTORY_LOAD }, { quiet: true }));
  } catch { box.innerHTML = ''; return; }

  const c = state.config.cases.find((x) => x.name === caseTitle);
  const idle = !document.getElementById('casePanel').hidden;
  const head = (n) => `<div class="sec-head">
      <span class="sec-title">Ваши выпадения</span>
      ${n ? `<span class="sec-chip">${n}</span>` : ''}
    </div>`;

  if (!history.length) {
    box.innerHTML = head(0) +
      '<div class="hist-empty">Здесь появятся предметы, которые выпадут вам из этого кейса</div>';
    return;
  }

  const items = history.map((h) => historyItem(c, h));

  if (!idle) {
    box.innerHTML = head(history.length) + items.slice(0, 8).map((it, i) =>
      `<button class="mini-row" data-i="${i}" style="--tier-color:${tierColor(it.tier)}">
        <span class="mini-name">${esc(it.name)}${it.x2 ? ` <em>${it.x2}</em>` : ''}</span>
        <span class="mini-val">${money(it.value)}</span>
      </button>`).join('');
    box.querySelectorAll('.mini-row').forEach((row) => {
      row.onclick = () => inspectHistory(c, items[Number(row.dataset.i)], row);
    });
    return;
  }

  box.innerHTML = head(history.length) +
    '<div class="hist-grid" id="histGrid"></div>' +
    '<button class="hist-more" id="histMore" hidden>Показать ещё</button>';

  const grid = box.querySelector('#histGrid');
  const more = box.querySelector('#histMore');

  /*
   * Порция - целое число рядов: столько карточек, сколько помещается в ряд,
   * умноженное на число рядов. Оба числа живут в CSS (--hist-cols и
   * --hist-rows), потому что от ширины экрана зависят именно они, и считать
   * их второй раз в коде значит однажды разойтись с вёрсткой.
   */
  const css = getComputedStyle(grid);
  const page = (Number(css.getPropertyValue('--hist-cols')) || 3) *
               (Number(css.getPropertyValue('--hist-rows')) || 3);
  let shown = 0;

  const card = (it, i) => {
    const color = tierColor(it.tier);
    return `<button class="drop-card rw-skin hist-card" data-i="${i}" ${skinAttrs(it.skin || c?.visual)}
        style="--tier-color:${color}">
      <div class="drop-ico">${tileArt(it, color)}</div>
      <div class="drop-name"><span>${esc(it.name)}</span></div>
      <div class="drop-value">${money(it.value)}</div>
      ${it.x2 ? `<span class="hist-x2">${it.x2}</span>` : ''}
    </button>`;
  };

  const showMore = () => {
    const next = items.slice(shown, shown + page);
    grid.insertAdjacentHTML('beforeend', next.map((it, k) => card(it, shown + k)).join(''));
    // Новые карточки въезжают по одной: видно, что добавилось именно они.
    [...grid.children].slice(shown).forEach((el, k) => el.style.setProperty('--k', k));
    fitNames(grid);
    shown += next.length;
    more.hidden = shown >= items.length;
  };
  grid.onclick = (e) => {
    const el = e.target.closest('.hist-card');
    if (el) inspectHistory(c, items[Number(el.dataset.i)], el);
  };
  more.onclick = () => { haptic('light'); showMore(); };
  showMore();
}

function closeOpener() {
  fsCollectPending?.();
  // Показ, оставшийся висеть поверх закрытого кейса, перекрыл бы весь экран.
  motion().reset();
  endBonusMode();
  document.getElementById('opener').hidden = true;
  document.body.classList.remove('case-open');
  document.getElementById('gamble').hidden = true;
}

/**
 * «Забрать» после результата не должно выкидывать из кейса - игрок почти
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
  fx: () => document.getElementById('gambleFx'),
};

/** Сколько карты разлетаются из колоды по столу. */
const GAMBLE_DEAL_STEP_MS = 85;

/**
 * Пауза между выбором и вскрытием. Ответ сервера приходит за десятки
 * миллисекунд, и мгновенный переворот проглатывал момент, ради которого
 * игрок и рискнул. Исход к этому времени уже решён: пауза его не меняет,
 * она отмечает выбор.
 */
const GAMBLE_SUSPENSE_MS = 650;

/** Строки исхода. Сухое «Мимо» на проигрыше читалось как ошибка формы. */
const GAMBLE_LOSE_LINES = [
  ['Туз ускользнул', 'Он прятался на карте №{n}'],
  ['Не в этот раз', 'Красный туз лежал на карте №{n}'],
  ['Карта пустая', 'Туз ждал на карте №{n}'],
];

function renderGamble() {
  const g = state.config.gamble;
  const stake = state.user.gambleStake || 0;

  /*
   * Заголовок крупный и короткий, ставка и выигрыш - двумя плашками со
   * стрелкой множителя между ними. Прежняя строка мелким серым текстом
   * объясняла правило, но не показывала, что на кону.
   */
  gambleEl.rules().innerHTML = `
    <div class="gr-eyebrow">риск-игра</div>
    <div class="gr-title">Найди красного туза</div>
    <div class="gr-sub">Один туз среди ${g.cards} карт. Нашли - выигрыш растёт, промах - сгорает.</div>
    <div class="gr-stakes">
      <span class="gr-stake" id="gambleStake"><b>${money(stake)}</b><small>на кону</small></span>
      <span class="gr-mult">×${g.payout}</span>
      <span class="gr-stake is-prize"><b>${money(stake * g.payout)}</b><small>если туз</small></span>
    </div>`;

  gambleEl.cards().innerHTML = Array.from({ length: g.cards }, (_, i) =>
    `<button class="gcard" data-idx="${i}" style="--i:${i}" aria-label="Карта ${i + 1}">
      <div class="gcard-inner">
        <div class="gcard-face gcard-back"><span class="gcard-emblem">${iconAce()}</span></div>
        <div class="gcard-face gcard-front blank"></div>
      </div>
    </button>`).join('');

  gambleEl.outcome().innerHTML = '';
  gambleEl.outcome().className = 'gamble-outcome';
  gambleEl.fx().innerHTML = '';
  gambleEl.root().className = 'gamble';

  const cards = [...gambleEl.cards().querySelectorAll('.gcard')];
  cards.forEach((card) => {
    card.addEventListener('click', () => pickGambleCard(Number(card.dataset.idx)));
  });

  /*
   * Раздача: карты вылетают из одной точки над столом и раскладываются по
   * местам. Смещение каждой считается от её настоящего места в сетке, а не
   * задаётся числом: на телефоне и компьютере сетка разной ширины.
   */
  requestAnimationFrame(() => {
    const box = gambleEl.cards().getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top - 40;
    cards.forEach((card, i) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--fx', `${(cx - (r.left + r.width / 2)).toFixed(0)}px`);
      card.style.setProperty('--fy', `${(cy - (r.top + r.height / 2)).toFixed(0)}px`);
      card.style.setProperty('--rot', `${((i % 2 ? 1 : -1) * (8 + i * 3))}deg`);
    });
    gambleEl.root().classList.add('is-dealing');
    sndShuffle(cards.length);
    cards.forEach((_, i) => setTimeout(() => sndCardDrop(i), 260 + i * GAMBLE_DEAL_STEP_MS));
    setTimeout(() => gambleEl.root().classList.replace('is-dealing', 'is-ready'),
      260 + cards.length * GAMBLE_DEAL_STEP_MS + 420);
  });
}

document.getElementById('gambleStartBtn').addEventListener('click', () => {
  document.getElementById('gambleStartBtn').hidden = true;
  document.getElementById('result').hidden = true;
  gambleEl.root().hidden = false;
  // Стол целиком в кадре: под лентой он начинался у нижнего края, и исход
  // раздачи оказывался за экраном.
  renderGamble();
  gambleEl.root().scrollIntoView({ block: 'start' });
  haptic('medium');
});

async function pickGambleCard(index) {
  if (state.busy) return;
  state.busy = true;

  const root = gambleEl.root();
  const cards = [...gambleEl.cards().querySelectorAll('.gcard')];
  cards.forEach((c) => c.classList.add('disabled'));
  cards[index].classList.add('picked');
  root.classList.add('is-picked');
  sndHeartbeat();
  haptic('medium');

  let data;
  try {
    [data] = await Promise.all([
      api('/api/gamble/pick', { index }),
      sleep(GAMBLE_SUSPENSE_MS),
    ]);
  } catch (err) {
    state.busy = false;
    cards.forEach((c) => c.classList.remove('disabled', 'picked'));
    root.classList.remove('is-picked');
    toast(err.message);
    haptic('error');
    return;
  }

  // Сначала переворачивается выбранная карта, затем - все остальные,
  // чтобы было видно, где на самом деле лежал туз.
  const setFace = (i) => {
    const front = cards[i].querySelector('.gcard-front');
    const isAce = i === data.acePosition;
    front.className = 'gcard-face gcard-front ' + (isAce ? 'ace' : 'blank');
    // Пустая карта получает свой знак: без него вскрытая карта выглядит
    // ровно как ещё не перевёрнутая, и непонятно, что раздача уже показана.
    front.innerHTML = isAce
      ? `<span class="ace-corner">A</span><span class="ace-suit">${iconAce('#fff')}</span><span class="ace-corner is-bottom">A</span>`
      : '<span class="gcard-empty"></span>';
    cards[i].classList.add('flipped');
    if (isAce) cards[i].classList.add('is-ace');
  };

  setFace(index);
  sndFlip();
  haptic(data.won ? 'success' : 'error');

  const g = state.config.gamble;
  const out = gambleEl.outcome();

  if (data.won) {
    root.classList.add('is-won');
    sndAceWin();
    gambleBurst(cards[index]);
    // Множитель печатью ложится на плашку ставки, и сумма под ним растёт до
    // выигрыша: видно, что именно умножилось и во сколько раз.
    setTimeout(() => gambleStamp(data.payout), 520);
  } else {
    root.classList.add('is-lost');
    cards[index].classList.add('is-burnt');
    sndBurn();
  }

  setTimeout(() => {
    cards.forEach((_, i) => {
      if (i !== index) setTimeout(() => { setFace(i); sndFlip(); }, i * 90);
    });

    setTimeout(() => {
      if (data.won) {
        out.innerHTML = `<b>Туз ваш!</b><span>Выигрыш вырос в ${String(g.payout).replace('.', ',')} раза: ${money(data.payout)} уже на балансе</span>`;
      } else {
        const [title, line] = GAMBLE_LOSE_LINES[Math.floor(Math.random() * GAMBLE_LOSE_LINES.length)];
        out.innerHTML = `<b>${title}</b><span>${line.replace('{n}', data.acePosition + 1)}. Кейс по-прежнему ждёт вас</span>`;
        sndLose();
      }
      out.className = 'gamble-outcome ' + (data.won ? 'win' : 'lose');

      applyUser(data.user);
      updateOpenerBalance();
      loadCaseHistory(state.config.cases.find((c) => c.id === state.openingCaseId)?.name);

      // Рисковать больше нечем - кнопка становится выходом из раздачи.
      const btn = document.getElementById('gambleSkipBtn');
      btn.textContent = 'Продолжить';
      btn.dataset.done = '1';
      state.busy = false;
    }, cards.length * 90 + 400);
  }, data.won ? 1500 : 900);
}

/** Искры из выигравшей карты. Частицы - узлы с переменными, не холст. */
function gambleBurst(card) {
  const fx = gambleEl.fx();
  const host = fx.getBoundingClientRect();
  const r = card.getBoundingClientRect();
  const x = r.left + r.width / 2 - host.left;
  const y = r.top + r.height / 2 - host.top;
  fx.innerHTML = `<span class="gfx-ring" style="left:${x}px;top:${y}px"></span>` +
    Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
      const d = 70 + Math.random() * 90;
      return `<span class="gfx-spark" style="left:${x}px;top:${y}px;
        --dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;
        --d:${(Math.random() * 160).toFixed(0)}ms"></span>`;
    }).join('');
}

/** Печать множителя на ставке и счёт суммы до выигрыша. */
function gambleStamp(payout) {
  const plate = document.getElementById('gambleStake');
  if (!plate) return;
  const sum = plate.querySelector('b');
  const from = state.user.gambleStake || payout / state.config.gamble.payout;
  plate.insertAdjacentHTML('beforeend',
    `<span class="gr-stamp">×${state.config.gamble.payout}</span>`);
  plate.classList.add('is-stamped');
  plate.querySelector('small').textContent = 'выигрыш';
  sndStamp();
  haptic('heavy');

  const started = performance.now();
  const COUNT_MS = 900;
  let lastCoin = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - started) / COUNT_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    sum.textContent = money(Math.round(from + (payout - from) * eased));
    if (now - lastCoin > 90 && t < 1) { sndCoin(); lastCoin = now; }
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  if (state.openingCaseId) startOpening(state.openingCaseId, state.openingCount || 1, { again: true });
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
      if (mode === 'max') setBet(inputId, Math.max(1, spendableMoney()));
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
 * означало бы третью копию тех же размеров - ровно так лента кейса и разошлась
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

  // Ракета летит по концу кривой носом по касательной; координаты из
  // системы графика переводятся в точки сцены.
  const stage = document.getElementById('crashStage');
  const toPx = (pt) => {
    const [x, y] = pt.split(',').map(Number);
    return [(x / GRAPH_W) * stage.clientWidth, (y / GRAPH_H) * stage.clientHeight];
  };
  const [x, y] = toPx(points[points.length - 1]);
  const [px, py] = toPx(points[points.length - 3] || points[0]);
  const angle = Math.atan2(y - py, x - px) || 0;
  crashEl.rocket().style.transform =
    `translate(${(x - 35).toFixed(1)}px, ${(y - 15).toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
  crashFx().fly(x, y, angle, multiplier);
}

function resetCrashGraph() {
  crashEl.line().setAttribute('points', '');
  crashEl.area().setAttribute('points', '');
  crashEl.rocket().classList.remove('flying', 'gone');
  const stage = document.getElementById('crashStage');
  crashEl.rocket().style.transform = `translate(-4px, ${stage.clientHeight - 30}px) rotate(-0.5rad)`;
  crashFx().reset();
}

/** Рубежи множителя: на каждом вспышка, звук и надпись. */
const CRASH_MILESTONES = [2, 5, 10, 25, 50, 100];

/**
 * Эффекты краша: звёзды, шлейф, рубежи, взрыв и золото.
 *
 * Два холста: звёзды позади кривой и частицы впереди неё. Звёзды летят
 * навстречу ракете тем быстрее, чем выше множитель, - скорость видна
 * всем экраном, а не только числом. Частиц немного и живут они меньше
 * секунды: сцена должна оставаться лёгкой в мобильном браузере.
 *
 * Цикл крутится, только пока раздел краша на экране: на спрятанном холсте
 * рисовать незачем.
 */
function createCrashFx(stage) {
  const back = document.createElement('canvas');
  const front = document.createElement('canvas');
  back.className = 'crash-stars';
  front.className = 'crash-fx';
  stage.prepend(back);
  stage.append(front);
  const bg = back.getContext('2d');
  const fg = front.getContext('2d');
  let W = 0, H = 0, raf = 0, last = 0;
  let speed = 0.4;
  let rocket = null;
  const P = [];
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75 }));

  const fit = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = stage.clientWidth; H = stage.clientHeight;
    for (const c of [back, front]) { c.width = W * dpr; c.height = H * dpr; }
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    fg.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const add = (p) => { P.push({ age: 0, drag: 0.9, g: 0, ...p }); wake(); };

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (!stage.offsetParent) { raf = 0; return; }
    if (W !== stage.clientWidth || H !== stage.clientHeight) fit();

    bg.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.x -= speed * s.z * dt * 0.35;
      s.y += speed * s.z * dt * 0.12;
      if (s.x < 0) { s.x = 1; s.y = Math.random(); }
      if (s.y > 1) { s.y = 0; s.x = Math.random(); }
      const len = 1 + speed * s.z * 10;
      bg.strokeStyle = `rgba(220, 200, 255, ${0.25 + s.z * 0.5})`;
      bg.lineWidth = s.z * 1.6;
      bg.beginPath();
      bg.moveTo(s.x * W, s.y * H);
      bg.lineTo(s.x * W + len, s.y * H - len * 0.34);
      bg.stroke();
    }

    // Шлейф: из сопла летят искры назад и в стороны.
    if (rocket) {
      const n = 2 + Math.min(4, Math.floor(speed));
      for (let i = 0; i < n; i++) {
        const back = rocket.angle + Math.PI + (Math.random() - 0.5) * 0.6;
        const v = 60 + Math.random() * 120;
        P.push({ age: 0, life: 0.35 + Math.random() * 0.4, drag: 0.92, g: 0,
          x: rocket.x - Math.cos(rocket.angle) * 22, y: rocket.y - Math.sin(rocket.angle) * 22,
          vx: Math.cos(back) * v, vy: Math.sin(back) * v, size: 2 + Math.random() * 3,
          color: Math.random() < 0.5 ? '#ffd34d' : (Math.random() < 0.5 ? '#ff7a3a' : '#ff2e8a') });
      }
    }

    fg.clearRect(0, 0, W, H);
    fg.globalCompositeOperation = 'lighter';
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) { P.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.age / p.life;
      if (p.ring) {
        fg.strokeStyle = p.color; fg.globalAlpha = k; fg.lineWidth = 3 * k + 0.5;
        fg.beginPath(); fg.arc(p.x, p.y, p.ring * (1 - k * k) + 6, 0, Math.PI * 2); fg.stroke();
      } else {
        fg.fillStyle = p.color; fg.globalAlpha = k;
        fg.beginPath(); fg.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2); fg.fill();
      }
    }
    fg.globalAlpha = 1;
    fg.globalCompositeOperation = 'source-over';

    raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!raf && stage.offsetParent) { fit(); last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  return {
    wake,
    fly(x, y, angle, m) { rocket = { x, y, angle }; speed = 0.8 + Math.log(m) * 2.2; wake(); },
    reset() { rocket = null; speed = 0.4; P.length = 0; wake(); },
    milestone(x, y, color) {
      add({ x, y, vx: 0, vy: 0, life: 0.7, ring: 70, color });
      add({ x, y, vx: 0, vy: 0, life: 0.9, ring: 120, color: '#ffffff' });
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 200;
        add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7, size: 2.5, color: i % 2 ? color : '#ffffff' });
      }
    },
    explode(x, y) {
      rocket = null;
      speed = 0.2;
      add({ x, y, vx: 0, vy: 0, life: 0.8, ring: 140, color: '#ff5d2e' });
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 320;
        add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.9, g: 320, drag: 0.95,
          size: 1.5 + Math.random() * 4, color: ['#ffd34d', '#ff7a3a', '#ff2e8a', '#ffffff', '#6c4bb4'][i % 5] });
      }
    },
    cashout(x, y) {
      add({ x, y, vx: 0, vy: 0, life: 0.8, ring: 110, color: '#7dffb3' });
      for (let i = 0; i < 40; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 160 + Math.random() * 260;
        add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 + Math.random() * 0.6, g: 520, drag: 0.97,
          size: 3 + Math.random() * 3, color: i % 3 ? '#ffd34d' : '#fff6cf' });
      }
    },
  };
}

let crashFxInst = null;
/** Эффекты краша создаются при первом обращении: сцена к этому времени есть. */
function crashFx() {
  return (crashFxInst ||= createCrashFx(document.getElementById('crashStage')));
}

/** Где сейчас ракета в координатах сцены. */
function crashRocketPoint() {
  const st = document.getElementById('crashStage').getBoundingClientRect();
  const r = crashEl.rocket().getBoundingClientRect();
  return [r.left + r.width / 2 - st.left, r.top + r.height / 2 - st.top];
}

/** Рубеж множителя: вспышка от ракеты, надпись, звук, лёгкая тряска сцены. */
function crashMilestone(m) {
  const stage = document.getElementById('crashStage');
  const [x, y] = crashRocketPoint();
  const color = m >= 10 ? '#ffd34d' : m >= 5 ? '#ff2e8a' : '#6bbdcc';
  crashFx().milestone(x, y, color);
  const tag = document.createElement('div');
  tag.className = 'crash-mile';
  tag.style.setProperty('--c', color);
  tag.textContent = `×${m}`;
  stage.append(tag);
  setTimeout(() => tag.remove(), 1300);
  crashEl.multiplier().classList.remove('is-pulse');
  void crashEl.multiplier().offsetWidth;
  crashEl.multiplier().classList.add('is-pulse');
  stage.animate([{ translate: '0 0' }, { translate: '0 3px' }, { translate: '0 -2px' }, { translate: '0 0' }], { duration: 260 });
  if (m >= 10) { sndHit(m >= 50 ? 1.26 : 1.12); sndChime(); } else sndChime();
  haptic(m >= 10 ? 'heavy' : 'medium');
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
  if (bet > spendableMoney()) {
    needMoney(bet - spendableMoney());
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
  if (m >= (round.nextMile ?? CRASH_MILESTONES[0])) {
    const passed = CRASH_MILESTONES.filter((v) => v <= m).pop();
    round.nextMile = CRASH_MILESTONES.find((v) => v > m) ?? Infinity;
    // Отрисовка ракеты идёт ниже: рубеж показываем со следующего кадра,
    // когда она уже стоит на новом месте.
    requestAnimationFrame(() => crashMilestone(passed));
  }
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

  const [rx, ry] = crashRocketPoint();
  const flash = document.getElementById('crashFlash');
  if (data.status === 'cashed') {
    mult.textContent = `${data.cashedAt.toFixed(2)}x`;
    mult.className = 'crash-multiplier cashed';
    mult.style.color = '';
    status.className = 'crash-status win';
    status.textContent = `Забрали ${money(data.payout)} · взорвалось на ${data.crashPoint.toFixed(2)}x`;
    // Золото сыплется из ракеты: забрал - значит выпрыгнул с добычей.
    crashFx().cashout(rx, ry);
    flash.className = 'crash-flash is-win';
    sndCollect();
    sndCoin();
    setTimeout(sndCoin, 120);
    haptic('success');
  } else {
    mult.textContent = `${data.crashPoint.toFixed(2)}x`;
    mult.className = 'crash-multiplier busted';
    mult.style.color = '';
    status.className = 'crash-status lose';
    status.textContent = `Взорвалось. Ставка ${money(round.bet)} потеряна`;
    // Ракета разлетается обломками, сцену встряхивает, вспышка красная.
    crashFx().explode(rx, ry);
    crashEl.rocket().classList.add('gone');
    flash.className = 'crash-flash is-boom';
    document.getElementById('crashStage').animate([
      { translate: '0 0' }, { translate: '-9px 4px' }, { translate: '8px -5px' },
      { translate: '-5px 3px' }, { translate: '3px -1px' }, { translate: '0 0' },
    ], { duration: 520, easing: 'ease-out' });
    sndCrash();
    sndBoom();
    haptic('error');
  }
  setTimeout(() => { flash.className = 'crash-flash'; }, 700);
  pushRecent('crash', data.crashPoint);

  if (data.status === 'cashed') crashEl.rocket().classList.remove('flying');
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

/** Сколько крутится колесо рулетки. */
const ROUL_SPIN_MS = 6400;

/**
 * Доля прокрута, к которой шар садится в лунку. Дальше он едет вместе с
 * колесом: шар, катящийся до самой остановки колеса, выглядит пущенным по
 * льду, а не по дереву.
 */
const ROUL_BALL_SETTLE = 0.8;

/** Сколько оборотов шар делает навстречу колесу. */
const ROUL_BALL_TURNS = 7;

/** Сколько полных оборотов колесо делает за прокрут, не меньше. */
const ROUL_WHEEL_TURNS = 3;

/*
 * Радиусы - доли радиуса всего колеса, вместе с ободом. Они повторяют
 * вёрстку: колесо с секторами вписано в обод с отступом 8% (.rw-wheel), лунки -
 * внешнее кольцо секторов. Поменяли отступ в стилях - поменяйте и здесь, иначе
 * шар поедет мимо желоба.
 */
const ROUL_TRACK_R = 0.885;
const ROUL_POCKET_R = 0.755;

/** Ламп на ободе: бегут по кругу во время прокрута. */
const ROUL_BULBS = 20;

const rw = { angle: 0, ballAngle: 0, built: '' };

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


/** Координата точки на окружности: угол по часовой от верха, SVG-оси. */
function rwPoint(r, deg) {
  const a = (deg * Math.PI) / 180;
  return `${(150 + r * Math.sin(a)).toFixed(2)} ${(150 - r * Math.cos(a)).toFixed(2)}`;
}

/** Путь сектора между радиусами r0 и r1. */
function rwSector(r0, r1, from, to) {
  return `M${rwPoint(r1, from)} A${r1} ${r1} 0 0 1 ${rwPoint(r1, to)} ` +
    `L${rwPoint(r0, to)} A${r0} ${r0} 0 0 0 ${rwPoint(r0, from)}Z`;
}

/**
 * Колесо рулетки.
 *
 * Прежняя рулетка была лентой плиток, как кейс, и ничем не отличалась от него
 * на экране. Теперь это колесо: золотой обод с лампами, лунки по краю,
 * сектора с метками и шар, который бежит навстречу колесу и падает в лунку.
 *
 * Сектора равные, потому что и шансы равные: 1/15 у каждого. Колесо
 * рисуется один раз и только поворачивается, перерисовка - лишь если сервер
 * прислал другое колесо.
 */
function renderRouletteWheel() {
  const wheel = state.config.roulette.wheel;
  const key = wheel.join(',');
  const host = document.getElementById('rouletteWheel');
  if (!host) return;

  if (rw.built !== key) {
    const seg = 360 / wheel.length;
    const fill = { red: 'url(#rwRed)', black: 'url(#rwBlack)', green: 'url(#rwGreen)' };
    const pocket = { red: '#8f0f22', black: '#120720', green: '#00744a' };
    const sectors = wheel.map((color, i) => {
      const from = i * seg, to = (i + 1) * seg, mid = from + seg / 2;
      const [mx, my] = rwPoint(92, mid).split(' ');
      return `<path d="${rwSector(52, 118, from, to)}" fill="${fill[color]}"/>
        <path d="${rwSector(118, 150, from, to)}" fill="${pocket[color]}"/>
        <g class="rw-mark" data-color="${color}" data-sector="${i}"
           transform="translate(${mx} ${my}) rotate(${mid})">${rouletteMarkSvg(color)}</g>`;
    }).join('');
    const frets = wheel.map((_, i) =>
      `<path d="M${rwPoint(118, i * seg)} L${rwPoint(150, i * seg)}" />`).join('');
    host.innerHTML = `<svg viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <radialGradient id="rwRed" cx="150" cy="150" r="118" gradientUnits="userSpaceOnUse">
          <stop offset=".45" stop-color="#7a0716"/><stop offset="1" stop-color="#ff3b5c"/></radialGradient>
        <radialGradient id="rwBlack" cx="150" cy="150" r="118" gradientUnits="userSpaceOnUse">
          <stop offset=".45" stop-color="#0c0418"/><stop offset="1" stop-color="#3a2462"/></radialGradient>
        <radialGradient id="rwGreen" cx="150" cy="150" r="118" gradientUnits="userSpaceOnUse">
          <stop offset=".45" stop-color="#00593a"/><stop offset="1" stop-color="#19f0a0"/></radialGradient>
        <linearGradient id="rwGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#e8a024"/><stop offset="1" stop-color="#ffd34d"/></linearGradient>
      </defs>
      ${sectors}
      <path class="rw-hl" id="rouletteHl" d="" />
      <g class="rw-frets">${frets}</g>
      <circle cx="150" cy="150" r="118" fill="none" stroke="url(#rwGold)" stroke-width="2.4"/>
      <circle cx="150" cy="150" r="149" fill="none" stroke="url(#rwGold)" stroke-width="2"/>
      <circle cx="150" cy="150" r="52" fill="none" stroke="url(#rwGold)" stroke-width="2.4"/>
    </svg>`;

    document.getElementById('rouletteRim').innerHTML = Array.from({ length: ROUL_BULBS }, (_, i) =>
      `<i style="--a:${(i * 360) / ROUL_BULBS}deg; --i:${i}"></i>`).join('');
    rw.built = key;
  }

  host.style.transform = `rotate(${rw.angle}deg)`;
  placeRouletteBall(rw.ballAngle, ROUL_POCKET_R);
}

/** Метка сектора: ромб, квадрат или звезда, как и прежде на плитках. */
function rouletteMarkSvg(color) {
  if (color === 'green') return '<path d="M0 -11 3.2 -3.4 11 -3.4 4.8 1.6 7 9.4 0 4.8 -7 9.4 -4.8 1.6 -11 -3.4 -3.2 -3.4Z" fill="#eafff5"/>';
  if (color === 'red') return '<path d="M0 -10 8 0 0 10 -8 0Z" fill="#fff" opacity=".92"/>';
  return '<rect x="-7" y="-7" width="14" height="14" rx="2.5" fill="#cbb6e8" opacity=".85"/>';
}

function placeRouletteBall(angle, radiusK) {
  const wrap = document.querySelector('#rouletteStage .rw-wrap');
  const ball = document.getElementById('rouletteBall');
  if (!wrap || !ball) return;
  const R = wrap.clientWidth / 2;
  ball.style.transform = `rotate(${angle}deg) translateY(${(-radiusK * R).toFixed(1)}px)`;
}

const easeOutQuart = (k) => 1 - Math.pow(1 - k, 4);
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);

/**
 * Прокрут: колесо по часовой, шар навстречу.
 *
 * Исход решён сервером (data.slot), здесь только движение к нему. Колесо
 * доворачивает выпавший сектор под самоцвет сверху, шар катится по желобу,
 * теряет скорость, прыгает по лункам и садится ровно в этот сектор. В конце
 * шар стоит в лунке, а лунка - под самоцветом: остановка и есть результат.
 */
function spinRouletteWheel(slot) {
  const wheel = state.config.roulette.wheel;
  const seg = 360 / wheel.length;
  const mid = (slot + 0.5) * seg;
  // Колесо встаёт не точно серединой сектора под самоцвет: так живее, а
  // разброс держим в середине сектора, чтобы лунка не читалась соседней.
  const jitter = (Math.random() - 0.5) * seg * 0.45;
  const w0 = rw.angle;
  let wEnd = -mid + jitter;
  wEnd += 360 * Math.ceil((w0 + ROUL_WHEEL_TURNS * 360 - wEnd) / 360);

  const hostWheel = document.getElementById('rouletteWheel');
  const stage = document.getElementById('rouletteStage');
  stage.className = 'rw-stage is-spinning';
  document.getElementById('rouletteHl').setAttribute('d', rwSector(52, 150, slot * seg, (slot + 1) * seg));

  return new Promise((done) => {
    const started = performance.now();
    let lastFret = null;
    let lastTick = 0;
    const frame = (now) => {
      const k = Math.min(1, (now - started) / ROUL_SPIN_MS);
      const W = w0 + (wEnd - w0) * easeOutQuart(k);
      const kb = Math.min(1, k / ROUL_BALL_SETTLE);
      let rel = ROUL_BALL_TURNS * 360 * (1 - easeOutCubic(kb));

      // Последние сорок процентов пути шар падает из желоба в лунки и
      // прыгает по ним: радиус скачет вниз-вверх, угол качается между
      // соседними лунками, и оба затухают к посадке.
      const drop = Math.max(0, Math.min(1, (kb - 0.6) / 0.4));
      let radius = ROUL_TRACK_R;
      if (drop > 0) {
        const hop = Math.abs(Math.sin(drop * Math.PI * 4)) * (1 - drop);
        radius = ROUL_TRACK_R + (ROUL_POCKET_R - ROUL_TRACK_R) * drop + hop * 0.06;
        rel += Math.sin(drop * Math.PI * 5) * seg * 0.55 * (1 - drop);
      }

      hostWheel.style.transform = `rotate(${W}deg)`;
      const ballAngle = W + mid + rel;
      placeRouletteBall(ballAngle, radius);

      // Щелчок на каждой лунке, которую шар проходит относительно колеса.
      const fret = Math.floor(rel / seg);
      if (lastFret !== null && fret !== lastFret && now - lastTick > 45) {
        sndTick(1 + (1 - k) * 0.4);
        lastTick = now;
        if (drop > 0) haptic('light');
      }
      lastFret = fret;

      if (k < 1) requestAnimationFrame(frame);
      else {
        rw.angle = ((W % 360) + 360) % 360;
        rw.ballAngle = ((ballAngle % 360) + 360) % 360;
        hostWheel.style.transform = `rotate(${rw.angle}deg)`;
        placeRouletteBall(rw.ballAngle, ROUL_POCKET_R);
        done();
      }
    };
    requestAnimationFrame(frame);
  });
}

/** Искры из точки: общий мелкий эффект для игр. Узлы с переменными, не холст. */
function sparkBurst(host, x, y, { n = 24, colors = ['#ffe58a', '#ffffff'], dist = [60, 140], size = 6 } = {}) {
  const layer = document.createElement('div');
  layer.className = 'fx-burst';
  layer.innerHTML = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = dist[0] + Math.random() * (dist[1] - dist[0]);
    const c = colors[i % colors.length];
    return `<i style="left:${x}px;top:${y}px;--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;
      --c:${c};--s:${(size * (0.6 + Math.random() * 0.8)).toFixed(1)}px;--d:${(Math.random() * 120).toFixed(0)}ms"></i>`;
  }).join('');
  host.append(layer);
  setTimeout(() => layer.remove(), 1400);
}

async function spinRoulette() {
  if (state.busy) return;

  const bet = betValue('rouletteBet');
  if (!bet) { toast('Укажите ставку'); return; }
  if (bet > spendableMoney()) {
    needMoney(bet - spendableMoney());
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

  sndSpinStart();
  sndBet();
  haptic('medium');
  await spinRouletteWheel(data.slot);

  const stage = document.getElementById('rouletteStage');
  stage.className = `rw-stage is-landed is-${data.landed}${data.won ? ' is-won' : ''}`;
  const box = document.getElementById('rouletteResult');
  const label = state.config.roulette.colors.find((c) => c.id === data.landed)?.label;
  box.innerHTML = data.won
    ? `<b>${label} - забрали ${money(data.payout)}</b>`
    : `<b>${label} - мимо</b>`;
  box.className = `roulette-result ${data.won ? 'win' : 'lose'} is-${data.landed}`;

  pushRecent('roulette', data.landed);
  applyUser(data.user);
  sndLand();
  if (data.won) {
    // Свет бьёт столбом из выигравшей лунки, из неё же летят искры.
    const pointer = document.getElementById('roulettePointer').getBoundingClientRect();
    const host = stage.getBoundingClientRect();
    const colors = { red: ['#ff6b85', '#ffe58a', '#fff'], black: ['#c9a8ff', '#ffe58a', '#fff'], green: ['#19f0a0', '#ffe58a', '#fff'] }[data.landed];
    sparkBurst(stage, pointer.left + pointer.width / 2 - host.left, pointer.bottom - host.top + 18,
      { n: data.landed === 'green' ? 44 : 28, colors, dist: [50, data.landed === 'green' ? 190 : 130] });
    sndReveal(data.landed === 'green' ? 'unique' : 'epic');
    if (data.landed === 'green') sndFanfare(1.12); else sndCollect();
  } else sndLose();
  haptic(data.won ? 'success' : 'error');

  state.busy = false;
  document.getElementById('rouletteSpinBtn').disabled = false;
}

document.getElementById('rouletteSpinBtn').addEventListener('click', spinRoulette);


/* ============================================================
   ЧЕСТНОСТЬ
   ============================================================ */

/** Сколько длится «расшифровка» хеша при входе в раздел. */
const FAIR_DECODE_MS = 650;

/**
 * Хеш проявляется из перебора символов слева направо. Это не украшение
 * ради украшения: так видно, что строка - результат вычисления, а не надпись.
 * Длина строки всё время та же, что у настоящего хеша, и в конце стоит ровно
 * он.
 */
function decodeInto(el, text) {
  const HEX = '0123456789abcdef';
  const started = performance.now();
  const frame = (now) => {
    const k = Math.min(1, (now - started) / FAIR_DECODE_MS);
    const fixed = Math.floor(text.length * k);
    el.textContent = text.slice(0, fixed) +
      Array.from({ length: text.length - fixed }, () => HEX[Math.floor(Math.random() * 16)]).join('');
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * Блок партнёров. Список живёт в legal.js и пуст, пока партнёрство не
 * подтверждено договором; пустой список - блока нет вовсе.
 */
function renderFairPartners() {
  const box = document.getElementById('fairPartners');
  if (!PARTNERS.length) { box.hidden = true; return; }
  const names = PARTNERS.map((p) => p.with || p.name);
  const joined = names.length > 1
    ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names[0];
  box.innerHTML = `
    <div class="fair-eyebrow">Нам есть что терять</div>
    <h3 class="fair-partners-title">Партнёр мирового спорта</h3>
    <div class="fair-marks">
      ${PARTNERS.map((p) => `<span class="fair-mark" data-ico="${p.mark}" title="${esc(p.title)}"></span>`).join('')}
    </div>
    <p class="fair-partners-text">
      LUCKYBOX сотрудничает с ${esc(joined)}. В большом спорте
      репутация строится годами, а рушится за один день, и партнёров там
      выбирают так же строго, как пилотов на стартовую решётку. Этим доверием
      мы дорожим больше, чем любым отдельным выигрышем, поэтому каждый исход у
      нас можно проверить, а не принимать на веру.
    </p>
    <div class="fair-pledges">
      <span>исход записан до игры</span><span>формула открыта</span><span>проверка за минуту</span>
    </div>`;
  box.hidden = false;
  mountIcons(box);
}

/* Отдача казино из настройки: то же число, что сервер передаёт агрегатору
   при каждом запуске игры. Раздел выключен - карточки нет. */
function renderFairCasino() {
  const box = document.getElementById('fairCasino');
  const rtp = state.config?.casino?.rtp;
  box.hidden = !(rtp > 0) || !viewOpen('casino');
  if (!box.hidden) document.getElementById('fairCasinoRtp').textContent = `${rtp}%`;
}

function renderFair() {
  const f = state.user.fair;
  renderFairPartners();
  renderFairCasino();
  decodeInto(document.getElementById('serverHash'), f.serverSeedHash);
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
        <div class="user-meta">${esc(playerIdent(u))} · раундов ${fmt(u.total_rounds)}
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
    const who = l.admin_username ? '@' + l.admin_username : (l.admin_name || '');
    return `<div class="log-row">
      <span>${esc(BO_ACTIONS[l.action] || l.action)}${l.note ? ` · ${esc(l.note)}` : ''}
        <div class="bo-sub">${esc(who)} · ${boDateTime(l.created_at)}</div></span>
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
        <div class="user-meta">${esc(playerIdent(u))}</div>
      </div>
    </div>

    ${boKpis([
      { label: 'Баланс', value: fmt(u.balance),
        sub: `к выводу: ${fmt(d.money.withdrawable)}` },
      { label: 'Пополнил', value: fmt(d.money.deposited),
        sub: d.money.bonus ? `бонусами ещё ${fmt(d.money.bonus)}` : '' },
      { label: 'Вывел', value: fmt(d.money.paidOut),
        sub: d.money.pendingOut ? `в заявках ${fmt(d.money.pendingOut)}` : '' },
      { label: 'Касса заработала', value: fmt(d.money.deposited - d.money.paidOut),
        cls: d.money.deposited - d.money.paidOut >= 0 ? 'plus' : 'minus',
        sub: 'пополнил минус вывел' },
      { label: 'Раундов', value: fmt(u.total_rounds),
        sub: `поставил ${fmt(u.total_spent)}` },
      { label: 'Его отдача', value: u.total_spent
          ? ((u.total_won / u.total_spent) * 100).toFixed(1) + '%' : '-',
        cls: u.total_spent && u.total_won > u.total_spent ? 'minus' : '',
        sub: `выиграл ${fmt(u.total_won)}` },
      { label: 'Долг по обороту', value: fmt(d.money.depositDebt),
        cls: d.money.depositDebt ? 'minus' : 'plus',
        sub: d.money.depositDebt ? 'вывод закрыт, пока не отыграет' : 'вывод открыт' },
      { label: 'Бонусный счёт', value: fmt(d.money.bonusBalance || 0),
        sub: d.money.wagerRequired ? `отыграть ${fmt(d.money.wagerRequired)}` : 'вывод не запирает' },
      { label: 'Бонусы в деньги', value: fmt(d.money.bonusConverted || 0),
        sub: `ещё можно ${fmt(d.money.bonusCashoutLeft || 0)}` },
    ])}

    <div class="bo-daybar">
      За сутки: поставил <b>${fmt(d.day.wagered)}</b> ·
      проиграл <b>${fmt(d.day.lost)}</b> ·
      пополнил <b>${fmt(d.day.deposited)}</b>
    </div>

    ${boCan('players.balance') ? `
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
      запрёт игроку вывод.${state.admin.me?.balanceCap
        ? ` Ваш потолок одной правки: ${fmt(state.admin.me.balanceCap)}.` : ''}</p>
    <div class="admin-actions">
      <button class="btn btn-primary" id="adjPlus"><span data-ico="plus"></span> Начислить</button>
      <button class="btn btn-outline" id="adjMinus"><span data-ico="minus"></span> Списать</button>
    </div>` : ''}

    ${boCan('players.gift') ? `
    <h2 class="section-title">Подарочный кейс</h2>
    <div class="amount-row">
      <select class="seed-input" id="voucherCase">
        ${state.config.cases.map((c) => `<option value="${c.id}">${esc(c.name)} · ${fmt(c.price)}</option>`).join('')}
      </select>
      <input class="seed-input" id="voucherCount" type="number" value="1" min="1" max="100" style="max-width:80px">
    </div>
    <button class="btn btn-outline btn-wide" id="grantVoucher">Выдать кейс</button>` : ''}

    ${boCan('players.limits') ? `
    <h2 class="section-title">Лимиты ответственной игры</h2>
    <p class="game-sub">Ужесточение действует сразу, ослабление - через сутки.
      Лимит, который снимается в ту минуту, когда очень хочется играть, не лимит.</p>
    <div class="bo-settings">
      <label class="bo-field"><b>Пополнение в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limDeposit" value="${d.limits.deposit_day || 0}"></label>
      <label class="bo-field"><b>Проигрыш в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limLoss" value="${d.limits.loss_day || 0}"></label>
      <label class="bo-field"><b>Оборот в сутки</b>
        <i>0 - без ограничения</i>
        <input class="seed-input" type="number" id="limWager" value="${d.limits.wager_day || 0}"></label>
      <label class="bo-field"><b>Самоисключение, дней</b>
        <i>Продлить можно, укоротить - нет</i>
        <input class="seed-input" type="number" id="limExclude" value="0"></label>
    </div>
    ${d.limits.pending_at ? `<p class="adj-hint">Ослабление вступит в силу
      ${boDateTime(d.limits.pending_at)}.</p>` : ''}
    ${d.limits.excluded_until > Date.now() ? `<p class="adj-hint">Самоисключение
      до ${boDateTime(d.limits.excluded_until)}.</p>` : ''}
    <button class="btn btn-outline btn-wide" id="saveLimits">Сохранить лимиты</button>` : ''}

    ${boCan('players.block') ? `
    <h2 class="section-title">Доступ</h2>
    <button class="btn ${u.is_blocked ? 'btn-primary' : 'btn-outline'} btn-wide" id="toggleBlock">
      <span data-ico="block"></span> ${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
    </button>` : ''}

    ${boCan('players.notes') ? `
    <h2 class="section-title">Заметки</h2>
    <div class="amount-row">
      <input class="seed-input" id="noteText" maxlength="2000" placeholder="что важно знать следующему">
      <button class="btn btn-sm" id="noteAdd">Добавить</button>
    </div>
    ${d.notes.length ? d.notes.map((n) => `<div class="bo-note">
      <div>${esc(n.text)}</div>
      <div class="bo-sub">${esc(n.author_username ? '@' + n.author_username
        : (n.author_name || '#' + n.author_id))} · ${boDateTime(n.created_at)}
        <button class="bo-userlink" data-note-del="${n.id}">убрать</button></div>
    </div>`).join('') : '<div class="empty">Пока ничего</div>'}` : ''}

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

  document.getElementById('adjPlus')?.addEventListener('click', () => adjust(1));
  document.getElementById('adjMinus')?.addEventListener('click', () => adjust(-1));

  document.getElementById('saveLimits')?.addEventListener('click', async () => {
    const num = (id) => Math.max(0, Math.trunc(Number(document.getElementById(id).value) || 0));
    try {
      await api('/api/admin/player/limits', { userId, patch: {
        deposit_day: num('limDeposit'), loss_day: num('limLoss'),
        wager_day: num('limWager'), excludedDays: num('limExclude'),
      } });
      toast('Лимиты сохранены');
      openAdminUser(userId);
    } catch (err) { toast(err.message); }
  });

  document.getElementById('noteAdd')?.addEventListener('click', async () => {
    const text = document.getElementById('noteText').value.trim();
    if (!text) { toast('Пустая заметка'); return; }
    try {
      await api('/api/admin/player/note', { userId, text });
      openAdminUser(userId);
    } catch (err) { toast(err.message); }
  });

  detail.querySelectorAll('[data-note-del]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('/api/admin/player/note/delete', { noteId: Number(b.dataset.noteDel) });
        openAdminUser(userId);
      } catch (err) { toast(err.message); }
    };
  });

  document.getElementById('grantVoucher')?.addEventListener('click', async () => {
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

  document.getElementById('toggleBlock')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/block', { userId, blocked: !u.is_blocked });
      toast(u.is_blocked ? 'Разблокирован' : 'Заблокирован');
      openAdminUser(userId);
      loadAdminUsers();
    } catch (err) { toast(err.message); haptic('error'); }
  });
}

/* ---------- Панель: разделы и права ---------- */

/*
 * Список разделов с правом, которое их открывает.
 *
 * Право одно на раздел - то, без которого раздел бессмысленен. Внутри раздела
 * отдельные кнопки прячутся по своим правам: финансист видит заявки на вывод,
 * но кнопку «Выплатить» видит только с finance.payouts.resolve.
 */
const BO_SECTIONS = [
  { id: 'overview', name: 'Сводка', group: 'Обзор', need: 'reports.view', load: () => loadAdminOverview() },
  { id: 'reports', name: 'Отчёты', group: 'Обзор', need: 'reports.view', load: () => loadAdminReports() },
  { id: 'funnel', name: 'Воронка', group: 'Обзор', need: 'reports.view', load: () => loadAdminFunnel() },
  { id: 'feed', name: 'Лента', group: 'Обзор', need: 'reports.view', load: () => loadAdminOverview() },

  { id: 'users', name: 'Игроки', group: 'Игроки', need: 'players.view', load: () => loadAdminUsers() },
  { id: 'risk', name: 'Риск', group: 'Игроки', need: 'risk.view', load: () => loadAdminRisk() },

  { id: 'deposits', name: 'Пополнения', group: 'Финансы', need: 'finance.payouts.view', load: () => loadAdminDeposits() },
  { id: 'payouts', name: 'Выводы', group: 'Финансы', need: 'finance.payouts.view', load: () => loadAdminPayouts() },

  { id: 'promos', name: 'Промокоды', group: 'Промо', need: 'promo.view', load: () => loadAdminPromos() },
  { id: 'partners', name: 'Партнёры', group: 'Промо', need: 'partners.view', load: () => loadAdminPartners() },

  { id: 'casino', name: 'Казино', group: 'Система', need: 'games.manage', load: () => loadAdminCasino() },
  { id: 'settings', name: 'Настройки', group: 'Система', need: 'settings.manage', load: () => loadAdminSettings() },
  { id: 'staff', name: 'Сотрудники', group: 'Система', need: 'staff.manage', load: () => loadAdminStaff() },
  { id: 'journal', name: 'Журнал', group: 'Система', need: 'journal.view', load: () => loadAdminJournal() },
];

function boCan(permission) {
  return state.admin.perms?.has(permission) || false;
}

function boOpen(id) {
  const section = BO_SECTIONS.find((s) => s.id === id);
  if (!section || !boCan(section.need)) return;
  state.admin.tab = id;
  document.querySelectorAll('[data-admin-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.adminTab === id));
  document.querySelectorAll('.admin-pane').forEach((p) =>
    p.classList.toggle('active', p.id === `admin-${id}`));
  document.getElementById('adminDetail').hidden = true;
  section.load();
  haptic('light');
}

/**
 * Собирает панель под права вошедшего.
 *
 * Вызывается при каждом входе в раздел: состав команды меняют на ходу, и
 * панель, собранная один раз при загрузке страницы, показывала бы вчерашние
 * права до перезагрузки.
 */
/* ---------- Подтверждение входа в панель ---------- */

/*
 * Если на сервере включён служебный бот, панель открывается только после
 * подтверждения в Telegram (server/ops.js). Экран сам опрашивает сервер и
 * открывает панель, как только в боте нажали «Это я».
 */
const GATE_POLL_MS = 2000;
const gateState = { poll: 0, id: 0 };

function showAdminShell(open) {
  document.getElementById('boGate').hidden = open;
  document.getElementById('boShell').hidden = !open;
  if (open) clearInterval(gateState.poll);
}

/** true - панель можно открывать. */
async function adminGateOk() {
  let st;
  try { st = await api('/api/admin/2fa/status'); }
  catch (err) { toast(err.message); return false; }
  if (!st.required || st.confirmed) { showAdminShell(true); return true; }
  renderAdminGate(st);
  return false;
}

async function renderAdminGate(st) {
  clearInterval(gateState.poll);
  if (!st) {
    try { st = await api('/api/admin/2fa/status'); } catch (err) { toast(err.message); return; }
  }
  showAdminShell(false);
  const box = document.getElementById('boGate');

  if (!st.linked) {
    box.innerHTML = `
      <div class="bo-gate-card">
        <div class="bo-gate-title">Привяжите Telegram</div>
        <p>Вход в панель подтверждается в служебном боте${st.bot ? ` <b>@${esc(st.bot)}</b>` : ''}.
          Откройте его по кнопке ниже и нажмите Start - бот запомнит этот Telegram.
          Сюда же будут приходить оповещения о сбоях.</p>
        <button class="btn btn-primary btn-wide" id="gateLink">Открыть служебного бота</button>
        <button class="btn btn-outline btn-wide" id="gateLinked">Я нажал Start</button>
      </div>`;
    document.getElementById('gateLink').onclick = async () => {
      const tab = openBlankTab();
      try {
        const { url } = await api('/api/admin/2fa/link');
        if (tab && !tab.closed) tab.location.href = url; else window.open(url, '_blank', 'noopener');
      } catch (err) { tab?.close(); toast(err.message); }
    };
    document.getElementById('gateLinked').onclick = () => initAdminPanel();
    return;
  }

  box.innerHTML = `
    <div class="bo-gate-card">
      <div class="bo-gate-title">Подтвердите вход</div>
      <p>Мы отправим запрос в служебного бота${st.bot ? ` <b>@${esc(st.bot)}</b>` : ''}.
        Нажмите там «Это я» - панель откроется сама. Не пришло - введите код из сообщения.</p>
      <button class="btn btn-primary btn-wide" id="gateSend">Отправить запрос в Telegram</button>
      <div class="bo-gate-wait" id="gateWait" hidden>
        <div class="bo-gate-status" id="gateStatus">Ждём подтверждения в Telegram…</div>
        <div class="bo-gate-code">
          <input class="seed-input" id="gateCode" inputmode="numeric" maxlength="6" placeholder="Код из сообщения">
          <button class="btn btn-outline" id="gateCodeBtn">Подтвердить</button>
        </div>
      </div>
    </div>`;

  const status = (text) => { document.getElementById('gateStatus').textContent = text; };
  document.getElementById('gateSend').onclick = async () => {
    const btn = document.getElementById('gateSend');
    btn.disabled = true;
    try {
      const r = await api('/api/admin/2fa/request');
      gateState.id = r.id;
      document.getElementById('gateWait').hidden = false;
      btn.textContent = 'Отправить ещё раз';
      status('Ждём подтверждения в Telegram…');
      clearInterval(gateState.poll);
      gateState.poll = setInterval(async () => {
        if (state.view !== 'admin') { clearInterval(gateState.poll); return; }
        try {
          const p = await api('/api/admin/2fa/poll', { id: gateState.id });
          if (p.confirmed) { clearInterval(gateState.poll); initAdminPanel(); return; }
          if (p.status === 'denied') { clearInterval(gateState.poll); status('Вход отклонён в Telegram. Сессия закрыта.'); }
          if (p.status === 'expired' || p.status === 'burned') { clearInterval(gateState.poll); status('Запрос устарел, отправьте новый.'); }
        } catch { /* сеть моргнула - следующий опрос */ }
      }, GATE_POLL_MS);
    } catch (err) { toast(err.message); }
    btn.disabled = false;
  };
  document.getElementById('gateCodeBtn').onclick = async () => {
    try {
      await api('/api/admin/2fa/code', { id: gateState.id, code: document.getElementById('gateCode').value });
      initAdminPanel();
    } catch (err) { status(err.message); haptic('error'); }
  };
}

async function initAdminPanel() {
  if (!(await adminGateOk())) return;
  let me;
  try { me = await api('/api/admin/me'); }
  catch (err) { toast(err.message); return; }

  state.admin.perms = new Set(me.permissions);
  state.admin.me = me;

  document.getElementById('boWho').innerHTML =
    `${esc(me.roleName || 'Без роли')} · прав: ${me.permissions.length}` +
    (me.balanceCap ? ` · правка баланса до ${fmt(me.balanceCap)}` : '');

  const allowed = BO_SECTIONS.filter((s) => boCan(s.need));
  const groups = [];
  for (const section of allowed) {
    let group = groups.find((g) => g.name === section.group);
    if (!group) groups.push(group = { name: section.group, items: [] });
    group.items.push(section);
  }

  document.getElementById('boNav').innerHTML = groups.map((g) => `
    <div class="bo-group">
      <div class="bo-group-name">${esc(g.name)}</div>
      ${g.items.map((s) => `<button class="bo-link" data-admin-tab="${s.id}">${esc(s.name)}${
        s.id === 'deposits' && me.sections?.disputes ? ` <span class="bo-badge" title="Споры ждут решения">${fmt(me.sections.disputes)}</span>` : ''}</button>`).join('')}
    </div>`).join('') || '<div class="empty">Разделов нет</div>';

  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => boOpen(btn.dataset.adminTab));
  });

  const first = allowed.find((s) => s.id === state.admin.tab) || allowed[0];
  if (first) boOpen(first.id);
  else document.getElementById('boNav').innerHTML =
    '<div class="empty">Доступа ни к одному разделу нет</div>';
}

document.getElementById('boRefresh')?.addEventListener('click', () => {
  const current = state.admin.tab;
  state.admin.tab = current;
  initAdminPanel();
});

/* ---------- Панель: казино ---------- */

/*
 * Состояние каталога и деньги казино. Отдачу здесь не меняют: она в
 * «Настройках» рядом с выключателями игр, а тут видно, какое число
 * применяется на самом деле (с учётом пределов агрегатора).
 */
async function loadAdminCasino() {
  const pane = document.getElementById('admin-casino');
  pane.innerHTML = '<div class="empty">Загрузка...</div>';
  let d;
  try { d = await api('/api/admin/casino'); } catch (err) { pane.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const s = d.sync;
  const syncLine = !d.configured
    ? 'Ключи агрегатора не заданы: каталог из снимка в репозитории'
    : s.running ? 'Идёт обновление каталога...'
    : s.at ? `${s.ok ? 'Обновлён' : 'Ошибка обновления'} ${boDateTime(s.at)}${s.ok ? '' : `: ${esc(s.message)}`}`
    : 'Ещё не обновлялся';
  const row = (label, m) => `<tr><td>${label}</td><td class="num">${money(m.bets)}</td><td class="num">${money(m.wins)}</td>
    <td class="num">${money(m.ggr)}</td><td class="num">${fmt(m.rounds)}</td><td class="num">${fmt(m.players)}</td></tr>`;
  pane.innerHTML = `
    ${boKpis([
      { label: 'Игр в лобби', value: fmt(s.games), sub: `провайдеров ${fmt(s.providers)}` },
      { label: 'Отдача слотов', value: `${d.rtp}%`, sub: `пределы агрегатора ${d.rtpRange[0]}-${d.rtpRange[1]}%` },
      { label: 'Доход кассы за 30 дней', value: money(d.month.ggr), sub: 'ставки минус выигрыши', cls: d.month.ggr >= 0 ? 'plus' : 'minus' },
    ])}
    <div class="bo-subtitle">Каталог</div>
    <p class="bo-note">${syncLine}. По расписанию каталог обновляется сам.</p>
    <div class="admin-actions">
      <button class="btn btn-outline btn-sm" id="casinoSync" ${d.configured ? '' : 'disabled'}>Обновить сейчас</button>
    </div>
    <div class="bo-subtitle">Деньги</div>
    ${boTable([{ label: 'Период' }, { label: 'Ставки', num: true }, { label: 'Выигрыши', num: true },
      { label: 'Доход', num: true }, { label: 'Раундов', num: true }, { label: 'Игроков', num: true }],
      [row('Сутки', d.today), row('7 дней', d.week), row('30 дней', d.month)])}`;
  document.getElementById('casinoSync')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api('/api/admin/casino/sync'); toast('Каталог обновлён'); } catch (err) { toast(err.message); }
    loadAdminCasino();
  });
}

/* ---------- Панель: общие кирпичи ---------- */

const boDate = (t) => new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
const boDateTime = (t) => new Date(t).toLocaleString('ru-RU',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function boKpis(items) {
  return `<div class="admin-kpis">${items.map((k) => `<div class="kpi">
    <div class="kpi-label">${esc(k.label)}</div>
    <div class="kpi-value ${k.cls || ''}">${k.value}</div>
    ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
  </div>`).join('')}</div>`;
}

function boTable(head, rows, empty = 'Нет данных') {
  return `<div class="bo-scroll"><table class="admin-table">
    <thead><tr>${head.map((h) => `<th class="${h.num ? 'num' : ''}">${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.join('')
      : `<tr><td colspan="${head.length}">${esc(empty)}</td></tr>`}</tbody>
  </table></div>`;
}

/*
 * Столбики рисуются делениями, а не картинкой и не библиотекой.
 *
 * График в панели нужен ровно для одного: увидеть, что позавчера было не как
 * обычно. Для этого хватает высоты столбика, а тянуть ради этого рисовалку в
 * проект без сборщика - значит тянуть её и на телефон игрока.
 */
function boBars(points, { key, label, color = 'var(--cyan)' }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p[key])));
  return `<div class="bo-chart" role="img" aria-label="${esc(label)}">
    ${points.map((p) => {
      const value = p[key];
      const height = Math.round((Math.abs(value) / max) * 100);
      return `<div class="bo-bar" title="${boDate(p.day)}: ${fmt(value)}">
        <i style="height:${Math.max(2, height)}%;background:${value < 0 ? 'var(--pink)' : color}"></i>
        <span>${boDate(p.day)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------- Панель: отчёты ---------- */

async function loadAdminReports() {
  const box = document.getElementById('admin-reports');
  box.innerHTML = '<div class="empty">Считаем...</div>';

  let d;
  try { d = await api('/api/admin/reports', { days: state.admin.reportDays }); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const sum = (key) => d.daily.reduce((a, r) => a + r[key], 0);
  const wagered = sum('wagered');
  const paid = sum('paid');

  const dayRows = [...d.daily].reverse().map((r) => `<tr>
    <td>${boDate(r.day)}</td>
    <td class="num">${fmt(r.rounds)}</td>
    <td class="num">${fmt(r.players)}</td>
    <td class="num">${fmt(r.wagered)}</td>
    <td class="num ${r.ggr >= 0 ? 'plus' : 'minus'}">${fmt(r.ggr)}</td>
    <td class="num">${pct(r.rtp)}</td>
    <td class="num">${fmt(r.deposits)}</td>
    <td class="num">${fmt(r.payouts)}</td>
    <td class="num ${r.net >= 0 ? 'plus' : 'minus'}">${fmt(r.net)}</td>
    <td class="num">${fmt(r.signups)}</td>
  </tr>`);

  const caseRows = d.cases.slice(0, 30).map((c) => `<tr>
    <td>${esc(c.title)}</td>
    <td class="num">${fmt(c.opened)}</td>
    <td class="num">${fmt(c.players)}</td>
    <td class="num">${fmt(c.wagered)}</td>
    <td class="num ${c.ggr >= 0 ? 'plus' : 'minus'}">${fmt(c.ggr)}</td>
    <td class="num">${pct(c.rtp)}</td>
  </tr>`);

  box.innerHTML = `
    <div class="admin-tabs" id="reportPeriod">
      ${[7, 30, 90].map((n) => `<button class="tab ${n === state.admin.reportDays ? 'active' : ''}"
        data-report-days="${n}">${n} дней</button>`).join('')}
      <button class="tab" id="exportDaily">Выгрузить дни</button>
      <button class="tab" id="exportCases">Выгрузить кейсы</button>
    </div>

    ${boKpis([
      { label: 'Поставлено', value: fmt(wagered) },
      { label: 'Выплачено', value: fmt(paid) },
      { label: 'Доход с игры', value: fmt(wagered - paid),
        cls: wagered - paid >= 0 ? 'plus' : 'minus',
        sub: `фактическая отдача ${pct(wagered ? paid / wagered : null)}` },
      { label: 'Пополнено', value: fmt(sum('deposits')) },
      { label: 'Выведено', value: fmt(sum('payouts')) },
      { label: 'Чистый приход', value: fmt(sum('deposits') - sum('payouts')),
        cls: sum('deposits') - sum('payouts') >= 0 ? 'plus' : 'minus',
        sub: 'пополнения минус выплаты' },
      { label: 'Регистраций', value: fmt(sum('signups')) },
    ])}

    <h2 class="section-title">Доход с игры по дням</h2>
    ${boBars(d.daily, { key: 'ggr', label: 'Доход по дням', color: 'var(--green)' })}

    <h2 class="section-title">Чистый приход кассы по дням</h2>
    <p class="game-sub">Пополнения минус выплаты. Доход с игры считает ставки,
      но выигрыш на балансе игрока ещё не выведен и ничей.</p>
    ${boBars(d.daily, { key: 'net', label: 'Приход кассы по дням' })}

    <h2 class="section-title">По дням</h2>
    ${boTable(
      ['Дата', { label: 'Раундов', num: 1 }, { label: 'Игроков', num: 1 },
       { label: 'Ставки', num: 1 }, { label: 'Доход', num: 1 }, { label: 'Отдача', num: 1 },
       { label: 'Пополнено', num: 1 }, { label: 'Выведено', num: 1 },
       { label: 'Чисто', num: 1 }, { label: 'Регистраций', num: 1 }],
      dayRows)}

    <h2 class="section-title">По кейсам</h2>
    ${boTable(
      ['Кейс', { label: 'Открытий', num: 1 }, { label: 'Игроков', num: 1 },
       { label: 'Ставки', num: 1 }, { label: 'Доход', num: 1 }, { label: 'Отдача', num: 1 }],
      caseRows)}
  `;

  box.querySelectorAll('[data-report-days]').forEach((btn) => {
    btn.onclick = () => {
      state.admin.reportDays = Number(btn.dataset.reportDays);
      loadAdminReports();
    };
  });
  box.querySelector('#exportDaily').onclick = () => boExport('daily');
  box.querySelector('#exportCases').onclick = () => boExport('cases');
}

/**
 * Выгрузка отчёта файлом.
 *
 * Скачивание собрано вручную через Blob, а не ссылкой на ручку: отчёт
 * отдаётся только на POST, чтобы чужая страница не могла подсунуть ссылку
 * на выгрузку и заставить браузер сотрудника её открыть.
 */
async function boExport(kind) {
  try {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, days: state.admin.reportDays }),
    });
    if (!res.ok) throw new Error('Не удалось выгрузить');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luckybox-${kind}-${state.admin.reportDays}d.csv`;
    a.click();
    // Отзыв ссылки сразу после click() в Safari и Firefox иногда отменял загрузку.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл готов');
  } catch (err) { toast(err.message); }
}

/* ---------- Панель: пополнения ---------- */

/*
 * Все пополнения через шлюзы одним списком. Главное здесь - номера: наш (его
 * шлюз видит в каждом запросе) и шлюза (его видно в их кабинете). При споре
 * сотрудник ищет сделку по любому номеру, который ему назвали, и копирует
 * нужный одним нажатием, а не переписывает руками.
 */
const DEP_FILTERS = [
  ['all', 'Все'], ['credited', 'Зачислены'], ['open', 'Ждут оплаты'], ['failed', 'Не оплачены'], ['dispute', 'Споры'],
];
const DEP_STATUS = {
  created: 'создан', pending: 'ждёт оплаты', processing: 'в обработке', completed: 'зачислен',
  cancelled: 'отменён шлюзом', error: 'ошибка шлюза', unclaimed: 'отозван', expired: 'не оплачен вовремя',
  paid: 'зачислен', paid_over: 'зачислен с переплатой', failed: 'не прошёл', wrong_amount: 'не та сумма',
  cancel: 'отменён', fail: 'не прошёл', system_fail: 'сбой шлюза', process: 'в обработке', check: 'проверяется',
};
const DISPUTE_STATUS = {
  new: 'Игрок сообщил: деньги не пришли', sent: 'Апелляция у шлюза', won: 'Спор выигран, зачислено',
  lost: 'Шлюз отказал', declined: 'Отказано сотрудником',
};
/* Сколько дней выгружать: финансист сверяется с выпиской за месяц. */
const EXPORT_DAYS = [7, 30, 90];

function idChip(label, value) {
  if (!value) return '';
  return `<button class="dep-id" type="button" data-copy="${esc(String(value))}" title="Скопировать">
    <span>${esc(label)}</span><b>${esc(String(value))}</b></button>`;
}

function bindIdChips(box) {
  box.querySelectorAll('[data-copy]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано'); haptic('light'); }
      catch { toast('Скопируйте вручную'); }
    });
  });
}

function exportBarHtml() {
  return `<div class="dep-export">
    <span>Выгрузка в Excel</span>
    <select class="seed-input" id="depExportDays">${EXPORT_DAYS.map((d) =>
      `<option value="${d}"${d === 30 ? ' selected' : ''}>${d} дн.</option>`).join('')}</select>
    <button class="btn btn-outline btn-sm" data-fin-export="deposits">Пополнения</button>
    <button class="btn btn-outline btn-sm" data-fin-export="payouts">Выводы</button>
  </div>`;
}

function bindExportBar(box) {
  box.querySelectorAll('[data-fin-export]').forEach((b) => b.addEventListener('click', () =>
    finExport(b.dataset.finExport, Number(box.querySelector('#depExportDays')?.value) || 30)));
}

/* Скачивание тем же способом, что и отчёты: POST и Blob, а не ссылка. */
async function finExport(kind, days) {
  try {
    const res = await fetch('/api/admin/export/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, days }),
    });
    if (!res.ok) throw new Error('Не удалось выгрузить');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `luckybox-${kind}-${days}d.csv`;
    a.click();
    // Отзыв ссылки сразу после click() в Safari и Firefox иногда отменял загрузку.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл готов');
  } catch (err) { toast(err.message); }
}

/*
 * Чек с телефона - это фото на 4-8 МБ. Пережимаем в JPEG по длинной стороне
 * RECEIPT_MAX_SIDE: текст чека читается, а файл в разы меньше, что важно на
 * мобильной связи и для лимита шлюза. Не вышло (старый браузер) - уходит как есть.
 */
const RECEIPT_MAX_SIDE = 1800;
const RECEIPT_QUALITY = 0.85;
async function receiptDataUrl(file) {
  if (!file) return null;
  if (!/^image\//.test(file.type)) throw new Error('Нужна картинка: фото или скриншот чека');
  const raw = await new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fail(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = raw;
    });
    const k = Math.min(1, RECEIPT_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', RECEIPT_QUALITY);
  } catch { return raw; }
}

async function loadAdminDeposits({ more = false } = {}) {
  const box = document.getElementById('admin-deposits');
  const st = state.admin.dep || (state.admin.dep = { filter: 'all', q: '', rows: [] });
  if (!more) st.rows = [];
  if (!box.dataset.built) {
    box.dataset.built = '1';
    box.innerHTML = `
      <div id="depKpis"></div>
      <div class="admin-search">
        <input class="seed-input" id="depSearch" placeholder="номер наш или шлюза, почта, ник, id игрока">
        <button class="btn btn-sm" id="depSearchBtn">Найти</button>
      </div>
      <div class="admin-tabs" id="depFilter">${DEP_FILTERS.map(([id, name]) =>
        `<button class="tab${id === st.filter ? ' active' : ''}" data-dep-filter="${id}">${name}</button>`).join('')}</div>
      <div id="depList"></div>
      <button class="btn btn-outline" id="depMore" hidden>Показать ещё</button>
      ${exportBarHtml()}`;
    const search = () => { st.q = box.querySelector('#depSearch').value.trim(); loadAdminDeposits(); };
    box.querySelector('#depSearchBtn').addEventListener('click', search);
    box.querySelector('#depSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    box.querySelectorAll('[data-dep-filter]').forEach((b) => b.addEventListener('click', () => {
      st.filter = b.dataset.depFilter;
      box.querySelectorAll('[data-dep-filter]').forEach((x) => x.classList.toggle('active', x === b));
      loadAdminDeposits();
    }));
    box.querySelector('#depMore').addEventListener('click', () => loadAdminDeposits({ more: true }));
    bindExportBar(box);
  }

  const list = box.querySelector('#depList');
  if (!more) list.innerHTML = '<span class="skel skel-line"></span>'.repeat(4);
  let d;
  try {
    d = await api('/api/admin/deposits', {
      q: st.q, filter: st.filter, before: more && st.rows.length ? st.rows[st.rows.length - 1].created_at : 0,
    });
  } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  st.rows.push(...d.rows);
  st.meta = d;

  const s = d.summary;
  box.querySelector('#depKpis').innerHTML = `<div class="admin-kpis">
    <div class="kpi"><div class="kpi-label">Зачислено за сутки</div>
      <div class="kpi-value plus">${money(s.paidSum)}</div><div class="kpi-sub">${fmt(s.paidCount)} оплат</div></div>
    <div class="kpi"><div class="kpi-label">Доходят до оплаты</div>
      <div class="kpi-value">${s.conversion == null ? '-' : Math.round(s.conversion * 100) + '%'}</div>
      <div class="kpi-sub">из созданных за сутки</div></div>
    <div class="kpi${s.disputesNew ? ' kpi-alert' : ''}"><div class="kpi-label">Споры ждут решения</div>
      <div class="kpi-value">${fmt(s.disputesNew)}</div><div class="kpi-sub">сообщили игроки</div></div>
    <div class="kpi"><div class="kpi-label">Апелляции у шлюза</div>
      <div class="kpi-value">${fmt(s.disputesSent)}</div><div class="kpi-sub">ждём решения Sicilia</div></div>
  </div>`;

  list.innerHTML = st.rows.length ? st.rows.map((r) => depositRowHtml(r, d)).join('')
    : `<div class="empty">${st.q ? 'Ничего не нашлось' : 'Пополнений нет'}</div>`;
  box.querySelector('#depMore').hidden = d.rows.length < 50;
  bindIdChips(list);
  bindDepositRows(list);
}

function depositRowHtml(r, meta) {
  const paid = !!r.paid_at;
  const name = r.username ? '@' + r.username : (r.email || r.first_name || ('#' + r.user_id));
  const tone = paid ? 'paid' : ['created', 'pending', 'processing', 'process', 'check'].includes(r.status) ? 'processing' : 'rejected';
  const d = r.dispute;
  const canAct = meta.canResolve && r.source === 'sicilia' && !paid;
  const disputeBox = d ? `<div class="dep-dispute is-${d.status}">
      <b>${esc(DISPUTE_STATUS[d.status] || d.status)}</b>
      <small>${d.source === 'player' ? 'Сообщил игрок' : 'Открыл сотрудник'} · ${new Date(d.createdAt).toLocaleString('ru-RU')}</small>
      ${d.comment ? `<p>«${esc(d.comment)}»</p>` : ''}
      ${d.receipt ? `<a class="dep-receipt" href="${esc(d.receipt)}" target="_blank" rel="noopener"><img src="${esc(d.receipt)}" alt="Чек" loading="lazy"><span>Открыть чек</span></a>` : ''}
      ${d.appealReason ? `<p>Ответ шлюза: ${esc(d.appealReason)}</p>` : ''}
      ${d.staffNote ? `<p>Ответ игроку: ${esc(d.staffNote)}</p>` : ''}
      ${d.error ? `<p class="dep-error">Не ушло в шлюз: ${esc(d.error)}</p>` : ''}
    </div>` : '';
  const newDispute = d && d.status === 'new';
  const actions = canAct ? `<div class="dep-actions" data-dep-actions="${r.id}">
      <button class="btn btn-outline btn-sm" data-dep-recheck="${r.id}">Проверить у шлюза</button>
      ${['created', 'pending', 'processing'].includes(r.status) ? `<button class="btn btn-outline btn-sm" data-dep-cancel="${r.id}">Отменить у шлюза</button>` : ''}
      ${!d || !['new', 'sent'].includes(d.status) || newDispute
        ? `<button class="btn btn-sm" data-dep-appeal="${r.id}" data-dispute="${newDispute ? d.id : ''}">${newDispute ? 'Отправить спор в Sicilia' : 'Открыть спор'}</button>` : ''}
      ${newDispute ? `<button class="btn btn-outline btn-sm" data-dep-decline="${d.id}">Отказать</button>` : ''}
    </div>
    <div class="dep-form" data-dep-form="${r.id}" hidden></div>` : '';
  return `<div class="payout-row admin ${tone}">
    <div class="payout-head">
      <b>${money(r.amount)}${paid && r.credited !== r.amount ? ` <small class="dep-fact">зачислено ${money(r.credited)}</small>` : ''}</b>
      <span class="payout-status ${tone}">${esc(DEP_STATUS[r.status] || r.status)}</span>
    </div>
    <div class="payout-date">${r.source === 'sicilia' ? 'СБП / карта · Sicilia' : `Криптовалюта${r.currency ? ' ' + esc(r.currency) : ''} · Heleket`} ·
      <a href="#" data-dep-user="${r.user_id}">${esc(name)}</a> · ${esc(playerIdent(r, r.user_id))}</div>
    <div class="payout-date">Создан ${new Date(r.created_at).toLocaleString('ru-RU')}${paid ? ` · зачислен ${new Date(r.paid_at).toLocaleString('ru-RU')}` : ''}</div>
    <div class="dep-ids">${idChip('Наш номер', r.number)}${idChip(r.source === 'sicilia' ? 'Номер Sicilia' : 'Номер Heleket', r.gateway_id)}</div>
    ${disputeBox}
    ${actions}
  </div>`;
}

function bindDepositRows(list) {
  list.querySelectorAll('[data-dep-user]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openAdminUser(Number(a.dataset.depUser));
  }));
  list.querySelectorAll('[data-dep-recheck]').forEach((b) => b.addEventListener('click', () => withCashBusy(b, async () => {
    try {
      const r = await api('/api/admin/deposit/recheck', { id: Number(b.dataset.depRecheck) });
      toast(r.credited ? `Зачислено ${money(r.amount)}` : `Шлюз отвечает: ${DEP_STATUS[r.status] || r.status || 'нет ордера'}`);
      loadAdminDeposits();
    } catch (err) { toast(err.message); }
  })));
  list.querySelectorAll('[data-dep-cancel]').forEach((b) => b.addEventListener('click', () => {
    // Второе нажатие подтверждает: отмена оплаты, которую игрок сейчас
    // переводит, оставит его деньги у трейдера до разбора.
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Точно отменить?'; return; }
    withCashBusy(b, async () => {
      try {
        const r = await api('/api/admin/deposit/cancel', { id: Number(b.dataset.depCancel) });
        toast(r.credited ? `Оплата успела пройти: зачислено ${money(r.amount)}` : 'Оплата отменена у шлюза');
        loadAdminDeposits();
      } catch (err) { toast(err.message); }
    });
  }));
  list.querySelectorAll('[data-dep-appeal]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.depAppeal;
    const form = list.querySelector(`[data-dep-form="${id}"]`);
    const row = state.admin.dep.rows.find((x) => x.source === 'sicilia' && String(x.id) === id);
    const fromPlayer = !!b.dataset.dispute;
    if (!state.admin.dep.meta.siteUrl) { toast('Не задан SITE_URL: шлюзу не по чему открыть чек'); return; }
    form.hidden = !form.hidden;
    if (form.hidden) return;
    form.innerHTML = `
      <label class="dep-label">Причина для шлюза</label>
      <textarea class="seed-input" rows="2" data-f="reason" placeholder="Например: перевод выполнен, чек приложен, сумма совпадает">${esc(row?.dispute?.comment || '')}</textarea>
      <label class="dep-label">${fromPlayer ? 'Свой чек, если чек игрока не годится' : 'Чек перевода (фото или скриншот)'}</label>
      <label class="dep-file"><span data-f="filename">Выбрать файл</span><input type="file" accept="image/*" data-f="file" hidden></label>
      <div class="admin-actions"><button class="btn btn-primary" data-f="send">Отправить апелляцию</button></div>`;
    form.querySelector('[data-f="file"]').addEventListener('change', (e) => {
      form.querySelector('[data-f="filename"]').textContent = e.target.files[0]?.name || 'Выбрать файл';
    });
    form.querySelector('[data-f="send"]').addEventListener('click', (e) => withCashBusy(e.currentTarget, async () => {
      try {
        const image = await receiptDataUrl(form.querySelector('[data-f="file"]').files[0]);
        if (!fromPlayer && !image) { toast('Приложите чек'); return; }
        const r = await api('/api/admin/dispute/open', {
          orderId: Number(id), disputeId: fromPlayer ? Number(b.dataset.dispute) : undefined,
          reason: form.querySelector('[data-f="reason"]').value, image,
        });
        toast(r.credited ? 'Пока открывали спор, деньги пришли: зачислено' : 'Апелляция открыта, решение придёт от шлюза');
        haptic('success');
        loadAdminDeposits();
      } catch (err) { toast(err.message); }
    }));
  }));
  list.querySelectorAll('[data-dep-decline]').forEach((b) => b.addEventListener('click', () => {
    const form = b.closest('.payout-row').querySelector('[data-dep-form]');
    form.hidden = false;
    form.innerHTML = `
      <label class="dep-label">Ответ игроку: почему отказано</label>
      <textarea class="seed-input" rows="2" data-f="note" placeholder="Например: перевод ушёл на реквизиты другого платежа"></textarea>
      <div class="admin-actions"><button class="btn btn-outline" data-f="send">Отказать</button></div>`;
    form.querySelector('[data-f="send"]').addEventListener('click', (e) => withCashBusy(e.currentTarget, async () => {
      try {
        await api('/api/admin/dispute/decline', { id: Number(b.dataset.depDecline), note: form.querySelector('[data-f="note"]').value });
        toast('Игрок увидит ответ в кассе');
        loadAdminDeposits();
      } catch (err) { toast(err.message); }
    }));
  }));
}

/* ---------- Панель: риск ---------- */

async function loadAdminRisk() {
  const box = document.getElementById('admin-risk');
  box.innerHTML = '<div class="empty">Проверяем...</div>';

  let d;
  try { d = await api('/api/admin/risk'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const openLink = (id, label) =>
    `<button class="bo-userlink" data-open-user="${id}">${esc(label)}</button>`;

  const signals = [
    {
      title: 'Один номер СБП на нескольких аккаунтах',
      hint: 'Самый прямой признак мультиаккаунта: деньги сходятся в один кошелёк.',
      head: ['Номер', { label: 'Аккаунтов', num: 1 }, { label: 'Сумма заявок', num: 1 }, 'Кто'],
      rows: d.sharedPhone.map((r) => `<tr>
        <td>${esc(r.phone)}</td><td class="num">${r.accounts}</td>
        <td class="num">${fmt(r.amount)}</td>
        <td>${String(r.users).split(',').map((id) => openLink(id, '#' + id)).join(' ')}</td></tr>`),
    },
    {
      title: 'Один криптокошелёк на нескольких аккаунтах',
      head: ['Адрес', { label: 'Аккаунтов', num: 1 }, { label: 'Сумма заявок', num: 1 }, 'Кто'],
      rows: d.sharedWallet.map((r) => `<tr>
        <td class="bo-mono">${esc(String(r.address).slice(0, 18))}…</td>
        <td class="num">${r.accounts}</td><td class="num">${fmt(r.amount)}</td>
        <td>${String(r.users).split(',').map((id) => openLink(id, '#' + id)).join(' ')}</td></tr>`),
    },
    {
      title: 'Заявка на вывод при почти нулевом обороте',
      hint: 'Так выглядит и вымывание бонусов, и прогон чужих денег через площадку.',
      head: ['Игрок', { label: 'Заявка', num: 1 }, { label: 'Поставил всего', num: 1 },
             { label: 'Раундов', num: 1 }, 'Статус'],
      rows: d.quickCashout.map((r) => `<tr>
        <td>${openLink(r.user_id, r.username ? '@' + r.username : (r.first_name || '#' + r.user_id))}</td>
        <td class="num">${fmt(r.amount)}</td><td class="num">${fmt(r.total_spent)}</td>
        <td class="num">${fmt(r.total_rounds)}</td><td>${esc(r.status)}</td></tr>`),
    },
    {
      title: 'Отдача игрока сильно выше заявленной',
      hint: 'Само по себе это везение. Ровно так же выглядит и найденная дыра, поэтому смотреть стоит.',
      head: ['Игрок', { label: 'Поставил', num: 1 }, { label: 'Выиграл', num: 1 },
             { label: 'Его отдача', num: 1 }, { label: 'Баланс', num: 1 }],
      rows: d.hotPlayers.map((r) => `<tr>
        <td>${openLink(r.id, r.username ? '@' + r.username : (r.first_name || '#' + r.id))}</td>
        <td class="num">${fmt(r.total_spent)}</td><td class="num">${fmt(r.total_won)}</td>
        <td class="num plus">${((r.total_won / r.total_spent) * 100).toFixed(0)}%</td>
        <td class="num">${fmt(r.balance)}</td></tr>`),
    },
    {
      title: 'Свежие аккаунты с бонусом и без единой ставки',
      head: ['Игрок', { label: 'Промокодов', num: 1 }, { label: 'Баланс', num: 1 }, 'Заведён'],
      rows: d.bonusOnly.map((r) => `<tr>
        <td>${openLink(r.id, r.username ? '@' + r.username : (r.first_name || '#' + r.id))}</td>
        <td class="num">${r.redemptions}</td><td class="num">${fmt(r.balance)}</td>
        <td>${boDateTime(r.created_at)}</td></tr>`),
    },
  ];

  const total = signals.reduce((a, s) => a + s.rows.length, 0);

  box.innerHTML = `
    <p class="game-sub">Сигнал это повод посмотреть, а не повод заблокировать.
      Ни один из них ничего не делает сам.</p>
    ${boKpis([{ label: 'Сигналов', value: fmt(total),
                cls: total ? 'minus' : 'plus',
                sub: total ? 'есть что проверить' : 'чисто' }])}
    ${signals.map((s) => `
      <h2 class="section-title">${esc(s.title)}</h2>
      ${s.hint ? `<p class="game-sub">${esc(s.hint)}</p>` : ''}
      ${boTable(s.head, s.rows, 'Чисто')}`).join('')}
  `;

  box.querySelectorAll('[data-open-user]').forEach((b) => {
    b.onclick = () => openAdminUser(Number(b.dataset.openUser));
  });
}

/* ---------- Панель: настройки площадки ---------- */

async function loadAdminSettings() {
  const box = document.getElementById('admin-settings');
  box.innerHTML = '<div class="empty">Загружаем...</div>';

  let d;
  try { d = await api('/api/admin/settings'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const groups = [];
  for (const row of d.rows) {
    let g = groups.find((x) => x.name === row.group);
    if (!g) groups.push(g = { name: row.group, items: [] });
    g.items.push(row);
  }

  box.innerHTML = `
    <p class="game-sub">Меняется на лету, без выката. Каждая правка попадает
      в журнал вместе с тем, что было до неё.</p>
    ${groups.map((g) => `
      <h2 class="section-title">${esc(g.name)}</h2>
      <div class="bo-settings">
        ${g.items.map((row) => row.type === 'bool' ? `
          <label class="bo-toggle">
            <input type="checkbox" data-setting="${row.key}" ${row.value === '1' ? 'checked' : ''}>
            <span><b>${esc(row.label)}</b>${row.hint ? `<i>${esc(row.hint)}</i>` : ''}</span>
          </label>` : `
          <label class="bo-field">
            <b>${esc(row.label)}</b>
            ${row.hint ? `<i>${esc(row.hint)}</i>` : ''}
            <input class="seed-input" type="number" inputmode="numeric"
                   data-setting="${row.key}" value="${esc(row.value)}">
          </label>`).join('')}
      </div>`).join('')}
    <button class="btn btn-primary btn-wide" id="saveSettings">Сохранить</button>
  `;

  box.querySelector('#saveSettings').onclick = async () => {
    const patch = {};
    box.querySelectorAll('[data-setting]').forEach((el) => {
      patch[el.dataset.setting] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try {
      await api('/api/admin/settings/save', { patch });
      toast('Сохранено');
      haptic('success');
      loadAdminSettings();
    } catch (err) { toast(err.message); haptic('error'); }
  };
}

/* ---------- Панель: сотрудники ---------- */

async function loadAdminStaff() {
  const box = document.getElementById('admin-staff');
  box.innerHTML = '<div class="empty">Загружаем...</div>';

  let d;
  try { d = await api('/api/admin/staff'); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  state.admin.staff = d;
  const roleName = (id) => d.roles.find((r) => r.id === id)?.name || id;

  const rows = d.rows.map((r) => {
    const name = r.username ? '@' + r.username : (r.first_name || 'Без имени');
    return `<tr class="${r.active ? '' : 'bo-off'}">
      <td>${esc(name)}<div class="bo-sub">${esc(playerIdent(r, r.user_id))}</div></td>
      <td>${esc(roleName(r.role))}${r.added_by === null ? '<div class="bo-sub">из настроек сервера</div>' : ''}</td>
      <td class="num">${fmt(r.actions || 0)}</td>
      <td>${r.last_action ? boDateTime(r.last_action) : 'не заходил'}</td>
      <td>${r.active ? '<span class="bo-ok">работает</span>' : '<span class="bo-no">выключен</span>'}</td>
      <td class="bo-rowact">
        <button class="btn btn-sm" data-staff-edit="${r.user_id}">Править</button>
        ${r.user_id === d.meId ? '' : `<button class="btn btn-sm btn-outline" data-staff-del="${r.user_id}">Убрать</button>`}
      </td>
    </tr>`;
  });

  box.innerHTML = `
    <p class="game-sub">Роль это заготовка набора прав. Поправки сверху дают
      «поддержка, но ещё и промокоды» без новой роли.</p>

    ${boTable(['Сотрудник', 'Роль', { label: 'Действий', num: 1 }, 'Последнее', 'Статус', ''], rows,
              'Пока только вы')}

    <h2 class="section-title">Роли</h2>
    <div class="bo-roles">
      ${d.roles.map((r) => `<div class="bo-role ${d.assignable.includes(r.id) ? '' : 'bo-off'}">
        <b>${esc(r.name)}</b>
        <p>${esc(r.description)}</p>
        <span>${r.permissions.length} прав${r.balanceCap ? ` · правка баланса до ${fmt(r.balanceCap)}` : ''}</span>
        ${d.assignable.includes(r.id) ? '' : '<span class="bo-no">вам недоступна</span>'}
      </div>`).join('')}
    </div>

    <h2 class="section-title">Добавить или изменить</h2>
    <div id="staffForm"></div>
  `;

  renderStaffForm(null);

  box.querySelectorAll('[data-staff-edit]').forEach((b) => {
    b.onclick = () => {
      const row = d.rows.find((r) => r.user_id === Number(b.dataset.staffEdit));
      renderStaffForm(row);
      document.getElementById('staffForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
  box.querySelectorAll('[data-staff-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Убрать сотрудника из панели?')) return;
      try {
        await api('/api/admin/staff/remove', { userId: Number(b.dataset.staffDel) });
        toast('Убран');
        loadAdminStaff();
      } catch (err) { toast(err.message); }
    };
  });
}

function renderStaffForm(row) {
  const d = state.admin.staff;
  const box = document.getElementById('staffForm');
  const parse = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };
  const extra = new Set(row ? parse(row.extra_perms) : []);
  const denied = new Set(row ? parse(row.denied_perms) : []);
  const role = row?.role || d.assignable[d.assignable.length - 1] || d.roles[0].id;

  const byGroup = d.groups.map((g) => ({
    ...g, items: d.permissions.filter((p) => p.group === g.id),
  }));

  box.innerHTML = `
    <div class="bo-settings">
      <label class="bo-field">
        <b>Кто</b>
        <i>Почта, Telegram ID, ник или внутренний номер. Человек должен сначала зарегистрироваться на сайте.</i>
        <input class="seed-input" id="staffKey" value="${row ? esc(row.email || row.tg_id || row.user_id) : ''}"
               ${row ? 'readonly' : ''} placeholder="почта, 123456789 или @nickname">
      </label>
      <label class="bo-field">
        <b>Роль</b>
        <select class="seed-input" id="staffRole">
          ${d.roles.filter((r) => d.assignable.includes(r.id)).map((r) =>
            `<option value="${r.id}" ${r.id === role ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
      </label>
      <label class="bo-field">
        <b>Потолок одной правки баланса</b>
        <i>Пусто - как у роли. Ноль - без потолка.</i>
        <input class="seed-input" id="staffCap" type="number" inputmode="numeric"
               value="${row && row.balance_cap !== null ? row.balance_cap : ''}">
      </label>
      <label class="bo-field">
        <b>Заметка</b>
        <input class="seed-input" id="staffNote" maxlength="300" value="${row ? esc(row.note || '') : ''}">
      </label>
      <label class="bo-toggle">
        <input type="checkbox" id="staffActive" ${!row || row.active ? 'checked' : ''}>
        <span><b>Доступ включён</b><i>Выключенный сотрудник остаётся в списке, но в панель не входит</i></span>
      </label>
    </div>

    <h3 class="bo-subtitle">Поправки к роли</h3>
    <p class="game-sub">Слева выдать сверх роли, справа отобрать. Выдать можно
      только то, что есть у вас самих.</p>
    <div class="bo-perms">
      ${byGroup.map((g) => `
        <div class="bo-perm-group">
          <div class="bo-group-name">${esc(g.name)}</div>
          ${g.items.map((p) => `
            <div class="bo-perm ${d.grantable.includes(p.id) ? '' : 'bo-off'}">
              <span><b>${esc(p.label)}</b>${p.hint ? `<i>${esc(p.hint)}</i>` : ''}</span>
              <label title="Выдать сверх роли">
                <input type="checkbox" data-extra="${p.id}" ${extra.has(p.id) ? 'checked' : ''}
                       ${d.grantable.includes(p.id) ? '' : 'disabled'}>+
              </label>
              <label title="Отобрать у роли">
                <input type="checkbox" data-denied="${p.id}" ${denied.has(p.id) ? 'checked' : ''}>&minus;
              </label>
            </div>`).join('')}
        </div>`).join('')}
    </div>

    <div class="admin-actions">
      <button class="btn btn-primary" id="staffSave">${row ? 'Сохранить' : 'Добавить'}</button>
      ${row ? '<button class="btn btn-outline" id="staffCancel">Отмена</button>' : ''}
    </div>
  `;

  box.querySelector('#staffSave').onclick = async () => {
    const payload = {
      userKey: box.querySelector('#staffKey').value.trim(),
      role: box.querySelector('#staffRole').value,
      balanceCap: box.querySelector('#staffCap').value === ''
        ? null : Number(box.querySelector('#staffCap').value),
      note: box.querySelector('#staffNote').value,
      active: box.querySelector('#staffActive').checked,
      extra: [...box.querySelectorAll('[data-extra]:checked')].map((i) => i.dataset.extra),
      denied: [...box.querySelectorAll('[data-denied]:checked')].map((i) => i.dataset.denied),
    };
    if (!payload.userKey) { toast('Укажите, кого добавляем'); return; }
    try {
      await api('/api/admin/staff/save', payload);
      toast('Сохранено');
      haptic('success');
      loadAdminStaff();
    } catch (err) { toast(err.message); haptic('error'); }
  };
  box.querySelector('#staffCancel')?.addEventListener('click', () => renderStaffForm(null));
}

/* ---------- Панель: журнал ---------- */

const BO_ACTIONS = {
  credit: 'Начисление', debit: 'Списание', block: 'Блокировка',
  unblock: 'Разблокировка', voucher: 'Выдан кейс', payout_paid: 'Вывод выплачен',
  payout_rejected: 'Вывод отклонён', payout_processing: 'Вывод в работе',
  partner_payout: 'Выплата партнёру', promo_save: 'Промокод сохранён',
  promo_delete: 'Промокод удалён', partner_save: 'Партнёр сохранён',
  staff_add: 'Сотрудник добавлен', staff_update: 'Права изменены',
  staff_remove: 'Сотрудник убран', settings: 'Настройки', limits: 'Лимиты',
  note_add: 'Заметка', note_delete: 'Заметка удалена', export: 'Выгрузка',
};

async function loadAdminJournal() {
  const box = document.getElementById('admin-journal');
  box.innerHTML = '<div class="empty">Загружаем...</div>';

  let d;
  try { d = await api('/api/admin/journal', { action: state.admin.journalAction || '' }); }
  catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const rows = d.rows.map((l) => {
    const who = l.admin_username ? '@' + l.admin_username : (l.admin_name || '#' + l.admin_id);
    const target = l.target_id
      ? (l.target_username ? '@' + l.target_username : (l.target_name || '#' + l.target_id))
      : '';
    let meta = '';
    if (l.meta) {
      try {
        meta = Object.entries(JSON.parse(l.meta))
          .map(([k, v]) => `${k}: ${typeof v === 'object' && v && 'before' in v
            ? `${v.before} → ${v.after}` : JSON.stringify(v)}`)
          .join(', ');
      } catch { meta = ''; }
    }
    return `<tr>
      <td>${boDateTime(l.created_at)}</td>
      <td>${esc(who)}</td>
      <td>${esc(BO_ACTIONS[l.action] || l.action)}</td>
      <td>${esc(target)}</td>
      <td class="num ${l.amount > 0 ? 'plus' : l.amount < 0 ? 'minus' : ''}">${l.amount ? fmt(l.amount) : ''}</td>
      <td class="bo-sub">${esc(l.note || '')}${meta ? `<br>${esc(meta)}` : ''}</td>
    </tr>`;
  });

  box.innerHTML = `
    <p class="game-sub">Всё, что сотрудники делают руками. Записи не правятся
      и не удаляются.</p>
    <div class="admin-tabs">
      <button class="tab ${state.admin.journalAction ? '' : 'active'}" data-journal="">Все</button>
      ${d.actions.slice(0, 10).map((a) => `<button class="tab
        ${state.admin.journalAction === a.action ? 'active' : ''}"
        data-journal="${esc(a.action)}">${esc(BO_ACTIONS[a.action] || a.action)} · ${a.n}</button>`).join('')}
    </div>
    ${boTable(['Когда', 'Кто', 'Что', 'Кому', { label: 'Сумма', num: 1 }, 'Подробности'], rows,
              'Пока ничего')}
    <p class="game-sub">Показано ${d.rows.length} из ${fmt(d.total)}.</p>
  `;

  box.querySelectorAll('[data-journal]').forEach((b) => {
    b.onclick = () => { state.admin.journalAction = b.dataset.journal; loadAdminJournal(); };
  });
}

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
              esc(p.partner.name || p.partner.email || p.partner.tg_id)}</option>`).join('')}
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
  // Управление программой - в кабинете /partners: доли, сетка, заявки на
  // вывод и сверка со шлюзом. Здесь список для взгляда и заведение партнёра
  // из существующего игрока.
  box.innerHTML = `
    <a class="btn btn-primary btn-wide" href="/partners/" target="_blank" rel="noopener">Открыть кабинет партнёров</a>
    <div class="admin-form" style="margin-top:14px">
      <div class="form-grid">
        <div><label>Игрок</label>
          <input class="seed-input" id="ptTg" placeholder="почта, Telegram ID или номер"></div>
        <div><label>Доля, %</label>
          <input class="seed-input" id="ptShare" type="number" min="0" max="90" value="50"></div>
        <div class="wide"><label>Имя</label>
          <input class="seed-input" id="ptName" maxlength="80"></div>
      </div>
      <button class="btn btn-outline btn-wide" id="ptSave">Сделать партнёром</button>
    </div>

    <h2 class="section-title">Партнёры</h2>
    ${d.rows.length ? d.rows.map((r) => `<div class="promo-row ${r.status === 'active' ? '' : 'off'}">
        <div>
          <div class="promo-code">${esc(r.name || 'Партнёр')}</div>
          <div class="promo-meta">#${r.id} · ${esc(r.email || '')} · доля ${r.share}% · игроков ${fmt(r.total.signups)}</div>
        </div>
        <div style="text-align:right">
          <div class="promo-code">${money(r.balance.available)}</div>
          <div class="promo-meta">к выводу</div>
        </div>
      </div>`).join('') : '<div class="empty">Пока пусто</div>'}
  `;

  document.getElementById('ptSave').addEventListener('click', async () => {
    try {
      await api('/api/admin/partner/save', {
        userKey: document.getElementById('ptTg').value,
        share_pct: document.getElementById('ptShare').value,
        name: document.getElementById('ptName').value,
      });
      toast('Партнёр сохранён');
      haptic('success');
      loadAdminPartners();
    } catch (err) { toast(err.message); haptic('error'); }
  });
}

/* ---------- Админка: заявки на вывод ---------- */

/*
 * Шлюз Sicilia в заявках: баланс мерчанта сверху и кнопка выплаты у заявок
 * на карту и по СБП. Банк подставляется по названию из заявки, но выбирает и
 * подтверждает его человек: ошибка в банке при СБП - деньги не тому.
 */
const SICILIA_STATUS = {
  opened: 'отправлено, ждёт обработки', in_progress: 'в обработке у шлюза', completed: 'выплачено',
  cancelled: 'отменено шлюзом', error: 'ошибка', unclaimed: 'отозвано',
};
async function siciliaAdminInfo() {
  const cached = state.admin.sicilia;
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
  try {
    state.admin.sicilia = { at: Date.now(), ...(await api('/api/admin/sicilia')) };
  } catch {
    state.admin.sicilia = { at: Date.now(), configured: false, banks: [] };
  }
  return state.admin.sicilia;
}

function siciliaPayoutBlock(p, gateway, info) {
  const g = gateway[p.id];
  const line = g ? `<div class="payout-comment">Sicilia: ${esc(SICILIA_STATUS[g.status] || g.status)}${g.error ? ` - ${esc(g.error)}` : ''}${
    g.checkUrl ? ` · <a href="${esc(g.checkUrl)}" target="_blank" rel="noopener">чек</a>` : ''}</div>
    <div class="dep-ids">${idChip('Наш номер', g.invid)}${g.gatewayId ? idChip('Номер Sicilia', g.gatewayId) : ''}</div>` : '';
  const dead = g && ['cancelled', 'error', 'unclaimed'].includes(g.status);
  // Отзыв - пока ордер не закрыт шлюзом; возврат в «ожидают» - когда шлюз
  // выплату отменил, а заявка ещё «в работе».
  const manage = info.configured && g && p.status === 'processing' ? `<div class="admin-actions">
    ${['opened', 'in_progress'].includes(g.status) ? `<button class="btn btn-outline btn-sm" data-sic-recall="${p.id}">Отозвать из Sicilia</button>` : ''}
    ${dead ? `<button class="btn btn-outline btn-sm" data-sic-release="${p.id}">Вернуть в ожидание</button>` : ''}
  </div>` : '';
  const canSend = info.configured && (p.method === 'sbp' || p.method === 'card')
    && (p.status === 'pending' || p.status === 'processing')
    && (!g || dead);
  if (!canSend) return line + manage;
  const options = info.banks.map((b) => `<option value="${esc(b.code)}"${b.code === p.gatewayBank ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
  return `${line}${manage}<div class="admin-actions sicilia-send">
    <select class="seed-input" data-sic-bank="${p.id}"><option value="">Банк получателя…</option>${options}</select>
    <button class="btn btn-outline" data-sic-pay="${p.id}" data-amount="${p.amount}">Выплатить через Sicilia</button>
  </div>`;
}

/*
 * Плашка проверки заявки на вывод. Зелёная - всё сошлось, красная - есть
 * подозрения, с причинами. Красную нельзя двинуть к выплате, пока сотрудник
 * не разобрал причины и не подтвердил заявку комментарием: подозрение не
 * должно уйти деньгами одним нажатием «взять в работу».
 */
function riskPlate(p) {
  const c = p.check;
  if (!c) return '';
  const green = c.verdict === 'green';
  const why = green ? 'Математика сходится, источники денег подтверждены'
    : esc((c.reasons || []).join(' · '));
  const ok = c.override
    ? `<div class="risk-override">Подтверждено сотрудником: «${esc(c.override.comment)}»</div>` : '';
  return `<div class="risk-plate ${green ? 'risk-green' : 'risk-red'}">
      <span class="risk-dot" aria-hidden="true"></span>
      <div class="risk-text"><b>${green ? 'Проверено системой' : 'Есть подозрения'}</b><small>${why}</small></div>
      <button class="risk-more" data-risk-open="${p.id}" type="button">Подробнее</button>
    </div>
    ${ok}
    <div class="risk-details" data-risk-details="${p.id}" hidden></div>`;
}

/** Полный разбор проверки: каждый пункт с подробностями. */
function riskDetailsHtml(c) {
  const s = c.summary || {};
  const rows = c.checks.map((x) => `<li class="${x.ok ? 'ok' : x.level === 'info' ? 'info' : 'bad'}">
      <span>${x.ok ? '✓' : x.level === 'info' ? 'i' : '✗'}</span>
      <div><b>${esc(x.title)}</b><small>${esc(x.detail || '')}</small></div></li>`).join('');
  return `<ul class="risk-list">${rows}</ul>
    <div class="risk-summary">Пополнил ${money(s.deposited || 0)} · выплачено ${money(s.paidOut || 0)} ·
      итог игр ${money(s.gamesNet || 0)} · раундов ${fmt(s.rounds || 0)} · лучший выигрыш ${money(s.bestWin || 0)} ·
      аккаунту ${fmt(s.accountAgeDays || 0)} дн. · проверено ${new Date(c.checkedAt).toLocaleString('ru-RU')}</div>
    <button class="btn btn-outline btn-sm" data-risk-recheck="${c.payoutId || ''}" type="button">Перепроверить</button>`;
}

async function loadAdminPayouts() {
  let d;
  try { d = await api('/api/admin/payouts', { status: state.admin.payoutStatus || 'pending' }); }
  catch (err) { toast(err.message); return; }
  const sic = d.siciliaReady ? await siciliaAdminInfo() : { configured: false, banks: [] };

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
    ${sic.configured ? `<div class="kpi"><div class="kpi-label">Баланс Sicilia</div>
      <div class="kpi-value">${sic.balance ? money(Math.floor(sic.balance.balance)) : '-'}</div>
      <div class="kpi-sub">${sic.balance ? `заморожено ${money(Math.floor(sic.balance.frozen_balance || 0))}` : esc(sic.balanceError || '')}</div></div>` : ''}
  </div>`;

  if (!d.rows.length) {
    box.innerHTML = head + '<div class="empty">Заявок нет</div>' + exportBarHtml();
    bindExportBar(box);
    return;
  }

  box.innerHTML = head + d.rows.map((p) => {
    const name = p.username ? '@' + p.username : (p.first_name || ('#' + p.user_id));
    return `<div class="payout-row admin ${p.status}">
      <div class="payout-head">
        <b>${money(p.amount)}${p.requested_amount ? ` <small class="dep-fact">из ${money(p.requested_amount)}</small>` : ''}</b>
        <span class="payout-status ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <div class="payout-date">${esc(name)} · ${esc(playerIdent(p, p.user_id))} ·
        баланс ${money(p.balance)} · ${new Date(p.created_at).toLocaleString('ru-RU')}</div>
      <div class="payout-requisites">${payoutRequisites(p, { full: true })}</div>
      ${riskPlate(p)}
      ${p.comment ? `<div class="payout-comment">${esc(p.comment)}</div>` : ''}
      ${p.check && p.check.verdict === 'red' && !p.check.override && ['pending', 'processing'].includes(p.status) ? `
        <textarea class="seed-input risk-note" data-risk-note="${p.id}" rows="2"
          placeholder="Почему заявку можно выплатить: что проверено вручную"></textarea>
        <div class="admin-actions">
          <button class="btn btn-primary" data-risk-ok="${p.id}">Подтвердить заявку</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${p.id}">Отклонить</button>
        </div>
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку (при отклонении)">` : `
      ${siciliaPayoutBlock(p, d.gateway || {}, sic)}
      ${p.status === 'pending' ? `
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="processing" data-id="${p.id}">Взять в работу</button>
          <button class="btn btn-outline" data-resolve="rejected" data-id="${p.id}">Отклонить</button>
        </div>` : p.status === 'processing' ? `
        <input class="seed-input payout-note" data-note="${p.id}" placeholder="комментарий игроку">
        <div class="admin-actions">
          <button class="btn btn-primary" data-resolve="paid" data-id="${p.id}">Выполнено</button>
        </div>` : ''}`}
    </div>`;
  }).join('');

  box.insertAdjacentHTML('beforeend', exportBarHtml());
  bindExportBar(box);
  bindIdChips(box);

  const openDetails = async (id, recheck = false) => {
    const panel = box.querySelector(`[data-risk-details="${id}"]`);
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<span class="skel skel-line"></span>';
    try {
      const { check } = await api('/api/admin/payout/check', { id, recheck });
      panel.innerHTML = riskDetailsHtml({ ...check, payoutId: id });
      panel.querySelector('[data-risk-recheck]')?.addEventListener('click', async () => {
        await openDetails(id, true);
        loadAdminPayouts();
      });
    } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  box.querySelectorAll('[data-risk-open]').forEach((btn) => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.riskOpen);
    const panel = box.querySelector(`[data-risk-details="${id}"]`);
    if (panel && !panel.hidden) { panel.hidden = true; return; }
    openDetails(id);
  }));

  box.querySelectorAll('[data-risk-ok]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.riskOk);
    const comment = box.querySelector(`[data-risk-note="${id}"]`)?.value || '';
    try {
      await api('/api/admin/payout/override', { id, comment });
      toast('Заявка подтверждена, решение записано в журнал');
      haptic('success');
      loadAdminPayouts();
    } catch (err) { toast(err.message); haptic('error'); }
  }));

  // Выплата через шлюз - вторым нажатием: первое показывает, сколько и куда.
  const sicAction = (attr, path, ok) => box.querySelectorAll(`[${attr}]`).forEach((btn) => btn.addEventListener('click', () =>
    withCashBusy(btn, async () => {
      try {
        const r = await api(path, { id: Number(btn.getAttribute(attr)) });
        toast(ok(r));
        haptic('success');
      } catch (err) { toast(err.message); haptic('error'); }
      loadAdminPayouts();
    })));
  sicAction('data-sic-recall', '/api/admin/sicilia/payout/recall',
    (r) => (r.payoutStatus === 'pending' ? 'Выплата отозвана, заявка снова ждёт решения' : 'Запрос на отзыв отправлен'));
  sicAction('data-sic-release', '/api/admin/sicilia/payout/release', () => 'Заявка снова ждёт решения');

  box.querySelectorAll('[data-sic-pay]').forEach((btn) => {
    // Сменили банк после первого нажатия - подтверждение снимается: уйти
    // выплата должна ровно в тот банк, что был показан на кнопке.
    box.querySelector(`[data-sic-bank="${btn.dataset.sicPay}"]`)?.addEventListener('change', () => {
      btn.dataset.armed = '';
      btn.textContent = 'Выплатить через Sicilia';
      btn.classList.replace('btn-primary', 'btn-outline');
    });
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.sicPay);
      const select = box.querySelector(`[data-sic-bank="${id}"]`);
      const bank = select?.value || '';
      if (!bank) { toast('Выберите банк получателя'); return; }
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = `Подтвердить: ${money(Number(btn.dataset.amount))} · ${select.selectedOptions[0].textContent}`;
        btn.classList.replace('btn-outline', 'btn-primary');
        return;
      }
      btn.disabled = true;
      try {
        await api('/api/admin/sicilia/payout', { id, bank });
        toast('Выплата отправлена в Sicilia');
        haptic('success');
      } catch (err) { toast(err.message); haptic('error'); }
      loadAdminPayouts();
    });
  });

  box.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const note = box.querySelector(`[data-note="${id}"]`)?.value || '';
      const status = btn.dataset.resolve;

      if (status === 'rejected' && !note.trim()) {
        toast('Укажите причину отклонения - игрок её увидит');
        return;
      }

      // Второе нажатие, пока идёт первое, не шлёт второй запрос.
      await withCashBusy(btn, async () => {
        try {
          await api('/api/admin/payout/resolve', { id, status, comment: note });
          toast(status === 'paid' ? 'Заявка выполнена' : status === 'processing' ? 'Заявка поставлена в работу' : 'Заявка отклонена, средства возвращены');
          haptic('success');
          loadAdminPayouts();
        } catch (err) { toast(err.message); haptic('error'); }
      });
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

/*
 * Казино тоже отдельным файлом: лобби на пять тысяч игр, окно запуска и
 * экран игры к остальному app.js отношения не имеют.
 */
const casino = createCasino({
  api, esc, money, toast, haptic, state, plural,
  onUser: (user) => applyUser(user),
  // Наши Краш и Апгрейд в сетке быстрых игр открываются своими разделами.
  openOwn: (view) => switchView(view),
  ownOpen: (view) => viewOpen(view),
});

/*
 * Слот живёт отдельным файлом: у него своя анимация лент, своя панель и
 * свои окна, и держать всё это в app.js значило бы добавить туда полторы
 * тысячи строк, никак не связанных с остальным.
 */
const slot = createSlot({
  api, esc, fmt, money, toast, haptic, state,
  sounds: {
    bet: sndBet, tick: sndTick, land: sndLand,
    collect: sndCollect, bigWin: sndBigWin, lose: sndLose,
  },
  onUser: (user) => applyUser(user),
  onNoFunds: (need) => needMoney(need),
  onCashier: () => openCashier(),
});

/* ============================================================
   КАССА
   ============================================================ */

function switchView(name) {
  // Раздела «Бонусы» больше нет: всё бесплатное живёт во Free Money, и
  // старые входы (меню, ссылки) ведут туда.
  if (name === 'bonuses') name = 'freemoney';
  // Выключенную игру не открываем даже по прямой ссылке или из старого меню:
  // сервер всё равно откажет, и игрок увидит ошибку вместо объяснения.
  if (!viewOpen(name)) {
    toast('Раздел временно недоступен');
    return;
  }
  // Открытый кейс лежит поверх разделов: без закрытия меню переключало бы
  // раздел под ним, и игрок видел бы всё тот же кейс. Серия авто
  // останавливается, как по «СТОП»: начатый прокрут уже посчитан сервером,
  // следующий не начнётся.
  if (!document.getElementById('opener').hidden) {
    state.autoStop = true;
    closeOpener();
  }
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  window.scrollTo({ top: 0 });

  state.view = name;
  markSideNav(name);
  // Ушли из панели - адрес снова главная, иначе обновление страницы
  // вернуло бы в панель, откуда уже ушли.
  if (name !== 'admin' && wantsAdmin()) history.replaceState(null, '', '/' + location.search);

  if (name === 'fair') renderFair();
  if (name === 'wallet') {
    loadWallet();
    track('cashier_view');
    // «Пополнить» и «Вывести» - переключатель, а не две раскрывашки: одна
    // панель открыта всегда. Первым раскрыто пополнение, за ним в кассу и
    // приходят; на компьютере без него пустовала бы вся правая колонка.
    if (!document.getElementById('cashSwitch').dataset.mode) setCashMode('deposit');
  }
  if (name === 'roulette') renderRouletteWheel();
  if (name === 'crash') { if (!state.crash) resetCrashGraph(); crashFx().wake(); }
  if (name === 'slots') slot.openShelf();
  else slot.close();
  if (name === 'casino') casino.open();
  else casino.close();
  if (name === 'admin') initAdminPanel();
  if (name === 'cases') loadFreeCase();
  if (name === 'freemoney') openFreeMoney();
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
 * больше, чем в неё помещается. Вместо этого - кнопка-сетка в шапке и
 * плитки во весь экран.
 */
/** Аккаунт поддержки в телеграме. Он же стоит ссылкой в подвале. */
const SUPPORT_URL = COMPANY.support;

/** Открывает чат с поддержкой новой вкладкой: сайт остаётся открытым. */
function openSupport() {
  window.open(SUPPORT_URL, '_blank', 'noopener');
}

/*
 * Меню телефона - те же плитки, что боковая панель компьютера (решение
 * заказчика: «одинаково и пункты, и оформление»). Раньше это была присланная
 * картинка с прозрачными кнопками поверх, и разделы, которых на ней не было
 * (казино, партнёр, админ), висели под ней чужими кнопками.
 *
 * АДМИНКА ЗДЕСЬ ЕСТЬ, а в боковой панели нет: заказчик убрал её из меню
 * компьютера, но другого входа в панель пока нет (будет скрытая ссылка), и
 * убрать его и отсюда значило бы отрезать администратора от панели.
 */
const MENU_ADMIN = { view: 'admin', ico: 'admin', title: 'Админ', sub: 'Панель управления' };

function renderMenu() {
  const nav = document.getElementById('menuNav');
  if (!nav) return;
  nav.innerHTML = navTilesHtml({ admin: !!state.user?.isAdmin, supportId: 'menuSupport' });
  mountIcons(nav);

  nav.querySelectorAll('[data-view]').forEach((btn) => {
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
  nav.querySelector('#menuSupport').addEventListener('click', () => {
    closeMenu();
    haptic('light');
    openSupport();
  });
}

/* ============================================================
   БОКОВОЕ МЕНЮ ДЛЯ КОМПЬЮТЕРА
   ============================================================ */

/*
 * На компьютере меню - постоянная боковая панель, на телефоне те же плитки
 * открываются листом по кнопке в шапке (renderMenu выше). Разметка у них
 * одна (navTilesHtml), поэтому разделы, подписи и порядок совпадают.
 */
/*
 * Боковое меню компьютерной версии собрано по присланному макету: плитка с
 * рисунком слева, названием, подписью и стрелкой справа.
 *
 * Названия и подписи взяты из макета дословно.
 *
 * Путь к рисунку хранится целиком, вместе с ведущим слешем: автономная сборка
 * заменяет строку «/assets/ui/...» на сам файл, а склеенный из кусков путь она
 * не увидит - и рисунки окажутся битыми. На этом уже ловились.
 *
 * АДМИНКИ ЗДЕСЬ НЕТ НАМЕРЕННО. Заказчик просил убрать её из меню: вход в неё
 * будет отдельной скрытой ссылкой с паролем. Пока такой ссылки нет, вход
 * остаётся в меню телефона (MENU_ADMIN выше) - убирать его тоже
 * значило бы отрезать администратора от панели совсем.
 *
 * «Честности» здесь нет по другой причине: ссылка на неё стоит в подвале, и
 * второй вход в тот же раздел только удлиняет меню.
 */
/**
 * Игра выключена из панели управления.
 *
 * Клиент прячет вход, сервер отказывает. Нужно и то и другое: прятать без
 * отказа бессмысленно (раздел открывается прямым запросом), а отказывать без
 * пряток значит оставить игроку кнопку, которая всегда ругается.
 */
/** Подпись баннера «Казино», когда раздел выключен в панели. */
const CASINO_SOON = 'Казино скоро откроется';

const VIEW_SWITCH = {
  cases: 'cases', crash: 'crash', roulette: 'roulette',
  upgrade: 'upgrade', freemoney: 'fortune', slots: 'slots', casino: 'casino',
};

function viewOpen(view) {
  const key = VIEW_SWITCH[view];
  if (!key) return true;
  const open = state.config?.open;
  return !open || open[key] !== false;
}

const SIDE_NAV = [
  { view: 'cases', art: '/assets/ui/nav-cases.webp', title: 'Кейсы', sub: 'Открывай и побеждай' },
  { view: 'upgrade', art: '/assets/ui/nav-upgrade.webp', title: 'Апгрейд', sub: 'Увеличь свой выигрыш' },
  { view: 'crash', art: '/assets/ui/nav-crash.webp', title: 'Краш', sub: 'Лови коэффициент' },
  { view: 'roulette', art: '/assets/ui/nav-roulette.webp', title: 'Рулетка', sub: 'Испытай удачу' },
  { view: 'wallet', art: '/assets/ui/nav-wallet.webp', title: 'Касса', sub: 'Пополнение и вывод' },
  { view: 'casino', art: '/assets/ui/nav-casino.webp', title: 'Казино', sub: 'Слоты провайдеров' },
  { view: 'slots', ico: 'slot', title: 'Слоты', sub: 'TREASURE ISLAND' },
  { view: 'freemoney', art: '/assets/ui/nav-bonuses.webp', title: 'Бонусы', sub: 'Free Money и подарки' },
  { view: 'partner', ico: 'people', title: 'Партнёру', sub: 'Статистика и выплаты',
    partnerOnly: true },
];

/**
 * Плитки меню: разделы квадратами в сетке, касса и поддержка ниже
 * прямоугольниками (решение заказчика): это два действия «вне игры», и
 * отделены они так же. Одна разметка на боковую панель компьютера и лист
 * меню телефона - иначе они разошлись бы с первой же правки.
 */
/*
 * «Главный приз дня» в боковой панели компьютера, между разделами и кассой
 * (там пустовало место). Это самый дорогой предмет одного из дорогих
 * кейсов - то, что в нём действительно лежит, с настоящей суммой.
 *
 * НЕ «крупнейший выигрыш дня». Заказчик просил выдуманный выигрыш, чтобы
 * не стыдно было за 700 ₽; но выдуманный выигрыш игрок читает как факт
 * «кто-то сегодня столько снял», а это неправда, подталкивающая ставить
 * (то же правило, что у блока лучших выигрышей казино: раундов нет - блока
 * нет). Приз кейса - правда, и сумма у него те же миллионы.
 *
 * Кейс меняется раз в сутки и случайно, а не по кругу: номер берётся из
 * хеша даты. Хеш, а не Math.random, чтобы все игроки и все перерисовки за
 * день видели один и тот же приз.
 */
const DAILY_PRIZE_MIN_PRICE = 20000;

function dailyPrize() {
  const cases = (state.config?.cases || []).filter((c) => !c.free && c.price >= DAILY_PRIZE_MIN_PRICE
    && (!c.availableFrom || Date.now() >= c.availableFrom) && c.items?.length);
  if (!cases.length) return null;
  const d = new Date();
  const key = `prize:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  const c = cases[h % cases.length];
  const item = c.items.filter((it) => it.kind === 'item').reduce((a, b) => (b.value > a.value ? b : a), { value: 0 });
  return item.value > 0 ? { c, item } : null;
}

function dailyPrizeHtml() {
  const p = dailyPrize();
  if (!p) return '';
  const color = tierColor(p.item.tier);
  return `<button class="side-prize" data-prize-case="${esc(p.c.id)}" style="--tier-color:${color}"
      data-material="${p.item.skin?.material || 'gold'}">
    <span class="side-prize-kicker">Главный приз дня</span>
    <span class="side-prize-art">${tileArt(p.item, color)}</span>
    <span class="side-prize-name">${esc(p.item.name)}</span>
    <span class="side-prize-value">${money(p.item.value)}</span>
    <span class="side-prize-case">в кейсе «${esc(p.c.name)}»</span>
  </button>`;
}

function navTilesHtml({ admin = false, supportId, prize = false }) {
  const items = SIDE_NAV.filter((m) => (!m.adminOnly || state.user?.isAdmin)
                                    && (!m.partnerOnly || state.user?.isPartner)
                                    && viewOpen(m.view));

  // Рисунок плитки - вырезка из присланного макета. У разделов, которых в
  // макете нет (партнёр, слоты), остаётся собственная иконка.
  const icon = (m) => (m.art
    ? `<img class="side-art" src="${m.art}" alt="">`
    : `<span class="side-ico" data-ico="${m.ico}"></span>`);

  const tile = (m, extra = '') => `<button class="side-item${extra}" ${m.view
    ? `data-view="${m.view}"` : `id="${m.id}"`}>
      ${icon(m)}
      <span class="side-text">
        <span class="side-title">${m.title}</span>
        ${m.sub ? `<span class="side-sub">${m.sub}</span>` : ''}
      </span>
      <span class="side-go" aria-hidden="true"></span>
    </button>`;

  const wallet = items.find((m) => m.view === 'wallet');
  const grid = items.filter((m) => m !== wallet);
  return `
    <nav class="side-list">
      ${grid.map((m) => tile(m, ' is-sq')).join('')}
    </nav>
    ${prize ? dailyPrizeHtml() : ''}
    <div class="side-bottom">
      ${wallet ? tile(wallet, ' is-wide') : ''}
      ${tile({ id: supportId, art: '/assets/ui/nav-support.webp', title: 'Поддержка',
               sub: 'Мы всегда на связи' }, ' is-tall')}
      ${admin ? tile(MENU_ADMIN, ' is-wide is-admin') : ''}
    </div>`;
}

function renderSideNav() {
  const nav = document.getElementById('sideNav');
  if (!nav) return;
  nav.innerHTML = `
    <button class="side-brand" data-view="cases" aria-label="На главную">
      <img src="/assets/ui/logo.webp" alt="LUCKYBOX" class="side-brand-logo">
    </button>
    ${navTilesHtml({ supportId: 'sideSupport', prize: true })}
  `;
  mountIcons(nav);
  nav.querySelector('[data-prize-case]')?.addEventListener('click', (e) => {
    if (state.crash && !state.crash.finished) { toast('Сначала закончите раунд краша'); return; }
    openCase(e.currentTarget.dataset.prizeCase);
  });

  nav.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Тот же запрет, что в меню телефона: уйти с недоигранного краша нельзя,
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
document.getElementById('menuClose').addEventListener('click', closeMenu);
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
  sicilia: 'Пополнение СБП / картой',
  promo: 'Бонус по промокоду',
  welcome: 'Бонус за первое пополнение',
};

/* ---------- Касса: общие детали оформления ---------- */

/*
 * Иконки кассы. Один набор с одной толщиной линии: раньше в кассе не было ни
 * одной иконки, и экран держался на рамках разного цвета, отчего каждый блок
 * выглядел отдельной поделкой.
 */
const CASH_ICONS = {
  shield: '<path d="M12 3.2 5 6v5.4c0 4.3 3 8 7 9.4 4-1.4 7-5.1 7-9.4V6l-7-2.8Z"/><path d="m9 12 2.2 2.2L15.4 10"/>',
  in: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  out: '<path d="M12 20V9"/><path d="m7.5 13.5 4.5-4.5 4.5 4.5"/><path d="M5 4.5h14"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="M3 10h18"/><path d="M7 14.6h3.2"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.6"/><path d="M11 17.6h2"/>',
  crypto: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4l8-4.6Z"/><path d="M9.6 8.6h3.6a1.7 1.7 0 0 1 0 3.4H9.6m0 0h4.1a1.7 1.7 0 0 1 0 3.4H9.6V8.6Z"/>',
  arrow: '<path d="M5 12h13"/><path d="m13 6.5 5.5 5.5-5.5 5.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.4"/><path d="M15.5 8.5V6.9a2.4 2.4 0 0 0-2.4-2.4H6.9a2.4 2.4 0 0 0-2.4 2.4v6.2a2.4 2.4 0 0 0 2.4 2.4h1.6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.9v.1"/>',
  warn: '<path d="M12 4 21 19.5H3L12 4Z"/><path d="M12 10v4.2"/><path d="M12 17v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3 9h18M12 9v11"/><path d="M12 9c-2.5 0-4.5-1-4.5-2.8S10 4 12 9Zm0 0c2.5 0 4.5-1 4.5-2.8S14 4 12 9Z"/>',
  open: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5h4"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  back: '<path d="M19 12H6"/><path d="m11 6.5-5.5 5.5 5.5 5.5"/>',
  empty: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 10h16"/><path d="M8 14.5h4"/>',
};

const cashIcon = (name) =>
  `<svg class="cash-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CASH_ICONS[name] || ''}</svg>`;

/*
 * Рисунки способов пополнения (решение заказчика): у «СБП и карта» - знак
 * СБП перед банковской картой, у криптовалюты - веер монет BTC, ETH, USDT.
 * Знак СБП - отметка способа оплаты, как на кассе в магазине; банковской
 * карте намеренно не дан ни один банк и ни одна платёжная система.
 */
const CASH_ART = {
  sbp: `<svg viewBox="0 0 64 40" aria-hidden="true">
    <defs>
      <linearGradient id="caCard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5cff"/><stop offset="1" stop-color="#ff4fa8"/></linearGradient>
      <linearGradient id="caChip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="1" stop-color="#d89a22"/></linearGradient>
    </defs>
    <g transform="rotate(-9 42 20)">
      <rect x="22" y="6" width="40" height="27" rx="4.5" fill="url(#caCard)"/>
      <rect x="22" y="12" width="40" height="5" fill="rgba(20,6,40,.45)"/>
      <rect x="27" y="21" width="8" height="6" rx="1.4" fill="url(#caChip)"/>
      <rect x="44" y="25.5" width="13" height="2" rx="1" fill="rgba(255,255,255,.55)"/>
      <rect x="22.5" y="6.5" width="39" height="5" rx="4" fill="rgba(255,255,255,.18)"/>
    </g>
    <rect x="2" y="7" width="26" height="26" rx="7" fill="#fff"/>
    <g transform="translate(6.2 9.25) scale(0.43)">
      <path fill="#5b57a2" d="M0 10.39l6.13 10.95v6.68L.01 38.95z"/>
      <path fill="#d90751" d="M23.53 17.35l5.74-3.52 11.75-.01-17.49 10.71z"/>
      <path fill="#fab718" d="M23.5 10.33l.03 14.49-6.14-3.77V0z"/>
      <path fill="#ed6f26" d="M41.02 13.83l-11.75.01-5.77-3.51L17.39 0z"/>
      <path fill="#63b22f" d="M23.53 39.01V31.97l-6.14-3.69.01 21.66z"/>
      <path fill="#1487c9" d="M23.53 32.3L29.25 35.53 41.01 35.52 23.53 24.82z"/>
      <path fill="#017f36" d="M17.4 49.94l6.13-10.95 5.72-3.46 11.76-.01z"/>
      <path fill="#984995" d="M.01 38.95l17.46-10.69-5.87-3.69-5.47 3.42z"/>
    </g>
  </svg>`,
  crypto: `<svg viewBox="0 0 64 40" aria-hidden="true">
    <g transform="rotate(-16 22 34)">
      <circle cx="18" cy="20" r="12" fill="#f7931a"/><circle cx="18" cy="20" r="12" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>
      <path d="M15.3 13.6v12.8M17.6 13.6v1.6m0 9.6v1.6M14 14.6h5.2a2.5 2.5 0 0 1 0 5H14m0 0h5.8a2.6 2.6 0 0 1 0 5.2H14" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g transform="rotate(16 42 34)">
      <circle cx="46" cy="20" r="12" fill="#26a17b"/><circle cx="46" cy="20" r="12" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>
      <path d="M40 14.2h12M46 14.2v12.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="46" cy="18.4" rx="6.2" ry="1.9" fill="none" stroke="#fff" stroke-width="1.5"/>
    </g>
    <g>
      <circle cx="32" cy="18" r="13" fill="#3c3c5c"/><circle cx="32" cy="18" r="13" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/>
      <path d="M32 7.6 25.6 18.4 32 22.2 38.4 18.4Z" fill="#c7cdfa"/>
      <path d="M32 7.6V22.2L38.4 18.4Z" fill="#8c95e6"/>
      <path d="M25.6 19.7 32 28.6 38.4 19.7 32 23.5Z" fill="#c7cdfa"/>
      <path d="M32 23.5V28.6L38.4 19.7Z" fill="#8c95e6"/>
    </g>
  </svg>`,
};

/** Подставляет иконки в разметку из index.html по data-cash-ico. */
function hydrateCashIcons(root) {
  root?.querySelectorAll('[data-cash-art]').forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = CASH_ART[el.dataset.cashArt] || '';
  });
  root?.querySelectorAll('[data-cash-ico]').forEach((el) => {
    if (el.dataset.icoDone) return;
    el.insertAdjacentHTML('afterbegin', cashIcon(el.dataset.cashIco));
    el.dataset.icoDone = '1';
  });
}
hydrateCashIcons(document.getElementById('view-wallet'));

/** Высота карточки баланса для липкого переключателя под ней (см. styles.css). */
(function watchCashHero() {
  const hero = document.querySelector('#view-wallet > .wallet-card');
  if (!hero || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    document.getElementById('view-wallet').style.setProperty('--cash-hero-h', `${hero.offsetHeight}px`);
  }).observe(hero);
})();

const cashReduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Дата в истории: «18 окт., 10:11». Год и секунды в кассе никто не читает. */
const cashDate = (ts) => new Date(ts).toLocaleString('ru-RU', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

/** Длительность докрутки баланса, мс. */
const CASH_BALANCE_TWEEN_MS = 700;
let cashShownBalance = null;

/*
 * Баланс докручивается от старого значения к новому, а не подменяется:
 * вывод и отмена заявки видны глазами, а не только по цифре. Знак рубля -
 * отдельным узлом, мельче и золотом: крупная сумма читается быстрее без него.
 */
function paintCashBalance(to) {
  const el = document.getElementById('walletBalance');
  // Копейки бывают (казино), поэтому в промежутке целые рубли, а в конце
  // ровно та сумма, что пришла с сервера.
  const draw = (v) => { el.innerHTML = `${fmtMoney(v)}<span class="cash-cur">₽</span>`; };
  const from = cashShownBalance;
  cashShownBalance = to;
  if (from === null || from === to || cashReduceMotion()) { draw(to); return; }

  const start = performance.now();
  const step = (now) => {
    if (cashShownBalance !== to) return;
    const t = Math.min(1, (now - start) / CASH_BALANCE_TWEEN_MS);
    draw(t < 1 ? Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))) : to);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * «Пополнить» и «Вывести» - один переключатель: открыта всегда ровно одна
 * панель. Раньше это были две кнопки-раскрывашки разных цветов, и на
 * телефоне касса открывалась пустой, без формы.
 */
function setCashMode(mode) {
  const sw = document.getElementById('cashSwitch');
  if (!sw || sw.dataset.mode === mode) return;
  sw.dataset.mode = mode;
  for (const [key, paneId, tabId] of [
    ['deposit', 'walletDepositPane', 'walletDeposit'],
    ['withdraw', 'walletWithdrawPane', 'walletWithdraw'],
  ]) {
    const on = key === mode;
    const tab = document.getElementById(tabId);
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    const pane = document.getElementById(paneId);
    pane.hidden = !on;
    // Анимацию входа перезапускаем вручную: панель не создаётся заново, а
    // только показывается, и без перезапуска она сыграла бы один раз.
    if (on) { pane.classList.remove('is-entering'); void pane.offsetWidth; pane.classList.add('is-entering'); }
  }
}

/** Строка истории: значок, что и когда, сумма и статус. */
function cashTxRow({ tone, icon, title, sub, amount, status }) {
  return `<div class="cash-tx tone-${tone}">
    <span class="cash-tx-ico">${cashIcon(icon)}</span>
    <span class="cash-tx-main"><b>${title}</b><small>${sub}</small></span>
    <span class="cash-tx-side"><b>${amount}</b><small>${status}</small></span>
  </div>`;
}

const cashEmpty = (title, text) => `<div class="cash-empty">
  <span class="cash-empty-ico">${cashIcon('empty')}</span><b>${title}</b><small>${text}</small></div>`;

/** Кнопка на время запроса: крутится и не нажимается, чтобы не создать две заявки. */
async function withCashBusy(btn, fn) {
  if (!btn || btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy');
  btn.disabled = true;
  try { await fn(); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
}

/** Копирование с подтверждением на самой кнопке: тост внизу экрана легко пропустить. */
function bindCashCopy(btn, text, label = 'Скопировать') {
  btn?.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* нет доступа к буферу */ }
    if (!ok) { toast('Скопируйте вручную'); return; }
    haptic('light');
    const span = btn.querySelector('.cash-copy-label');
    btn.classList.add('is-copied');
    if (span) span.textContent = 'Скопировано';
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      btn.classList.remove('is-copied');
      if (span) span.textContent = label;
    }, 1600);
  });
}

/** То же предложение, что на первом экране, но внутри кассы. */
function renderDepositOffer() {
  const el = document.getElementById('depositOffer');
  if (!el) return;

  const rules = state.config?.firstDeposit;
  const shown = rules && rules.pct > 0 && state.user && !state.user.depositsCount;
  el.hidden = !shown;
  if (!shown) return;

  /*
   * Купон, а не абзац. Раньше здесь стоял сплошной текст на полэкрана, и
   * заказчик назвал его «иишным». Главное - число и два условия - видно
   * сразу; как бонус переходит в деньги, раскрывается по нажатию.
   */
  el.innerHTML = `
    <div class="do-main">
      <div class="do-pct"><b>+${rules.pct}%</b><span>к первому<br>пополнению</span></div>
      <div class="do-terms">
        ${rules.max > 0 ? `<span>бонус до <b>${money(rules.max)}</b></span>` : ''}
        <span>пополнение от <b>${money(rules.min)}</b></span>
      </div>
    </div>
    <details class="do-more">
      <summary>Как работает бонус</summary>
      <p>Бонус приходит на бонусный счёт вместе с пополнением. Им играют, когда своих денег не хватает на ставку.
      После ставок бонусом на ×${rules.wager} от его суммы он переходит в деньги${rules.cashoutPct ? `, но не больше ${rules.cashoutPct}% от ваших пополнений` : ''}.
      Свои деньги выводятся в любой момент.</p>
    </details>`;
}

async function loadWallet() {
  let w;
  // Пока касса грузится, на месте списков мерцают силуэты строк.
  for (const id of ['depositList', 'payoutList']) {
    const el = document.getElementById(id);
    if (el && !el.children.length) el.innerHTML = '<span class="skel skel-line"></span>'.repeat(3);
  }
  // Первый заход в кассу открывает способ пополнения сам: Sicilia, если
  // шлюз настроен, иначе криптовалюту. Дальше игрок переключает сам.
  if (!state.depositChosen) { state.depositChosen = true; openDefaultDeposit(); }
  try { w = await api('/api/wallet'); }
  catch (err) { toast(err.message); return; }

  state.wallet = w;
  renderDepositOffer();

  paintCashBalance(w.balance);
  document.getElementById('walletRows').innerHTML = `
    <div class="cash-stat"><span>К выводу</span><b>${money(w.available)}</b></div>
    ${w.pending ? `<div class="cash-stat is-pending"><span>В обработке</span><b>${money(w.pending)}</b></div>` : ''}
    <div class="cash-stat"><span>Мин. вывод</span><b>${money(w.minPayout)}</b></div>
  `;

  // Бонусы приходят отдельной строкой рядом с самим пополнением, и плюсом
  // им рисовать нечего: значок подарка отличает их от внесённых денег.
  document.getElementById('depositList').innerHTML = w.deposits.length
    ? w.deposits.map((d) => cashTxRow({
        tone: 'ok', icon: ['promo', 'welcome'].includes(d.source) ? 'gift' : 'plus',
        title: esc(d.comment || SOURCE_LABEL[d.source] || 'Пополнение'),
        sub: cashDate(d.created_at),
        amount: `+${money(d.amount)}`, status: 'Зачислено',
      })).join('')
    : cashEmpty('Пополнений пока нет', 'Здесь появятся все зачисления на баланс');

  renderPayoutList(w.payouts);
  loadSiciliaIssues();

  /*
   * Игроку важно не только сколько доступно, но и почему ноль. Молчаливое
   * «доступно 0» при полном балансе читается как поломка, поэтому условие
   * названо прямо здесь, с конкретным числом, а не спрятано в правилах.
   */
  renderWalletBonus(w.bonus);

  document.getElementById('withdrawHint').innerHTML =
    `Доступно <b>${money(w.available)}</b><i></i>минимум ${money(w.minPayout)}`
    + (w.depositDebt > 0
      ? `<span class="withdraw-locked">Пополнение нужно прокрутить через ставки:
           осталось поставить ${money(w.depositDebt)}. После этого выводится
           весь баланс, включая выигрыш.</span>`
      : '');
}

/**
 * Бонусный счёт в кассе: сколько есть, сколько отыграть, сколько можно
 * перевести в деньги, и отказ. Правило потолка называется прямо: игрок,
 * который отыграл бонус и не увидел его в деньгах целиком, должен знать
 * почему ещё до этого, а не после.
 */
function renderWalletBonus(b) {
  const box = document.getElementById('walletBonus');
  if (!box) return;
  if (!b || !(b.balance > 0)) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const left = b.wagerLeft > 0
    ? `Осталось поставить бонусом <b>${money(b.wagerLeft)}</b>, и он перейдёт в деньги.`
    : 'Бонус отыгран и ждёт лимита: перейдёт в деньги после следующего пополнения.';
  box.innerHTML = `
    <div class="cash-bonus-head"><span>Бонусный счёт</span><b>${money(b.balance)}</b></div>
    <p>${left} Бонусом играют в кейсах, краше, рулетке и апгрейде, когда своих
      не хватает на ставку. В деньги бонусы переходят до ${b.rules.cashoutPct}% от суммы
      пополнений: сейчас можно перевести до ${money(b.cashoutLeft)}.</p>
    <button class="cash-bonus-refuse" id="bonusRefuse" type="button">Отказаться от бонуса</button>`;
  const btn = document.getElementById('bonusRefuse');
  btn.addEventListener('click', async () => {
    // Вторым нажатием: отказ необратим, и случайное касание не должно сжечь бонус.
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = `Точно отказаться от ${money(b.balance)}?`;
      return;
    }
    try {
      const r = await api('/api/bonus/refuse');
      applyUser(r.user);
      toast('Бонус снят, свои деньги на месте');
      haptic('light');
      loadWallet();
    } catch (err) { toast(err.message); haptic('error'); }
  });
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

/** Где хранится, какие выплаты игрок уже видел выплаченными. */
const PAID_SEEN_KEY = 'lb-paid-seen-v1';

/**
 * Заявка уходит конвертом: письмо с суммой ложится внутрь, клапан
 * закрывается, сверху падает золотая печать, и конверт улетает. Это
 * подтверждение, а не ожидание: интерфейс за ним не заперт.
 */
function sendPayoutEnvelope(amount) {
  const scene = document.createElement('div');
  scene.className = 'env-scene';
  scene.innerHTML = `
    <div class="env">
      <div class="env-letter"><small>заявка на вывод</small><b>${money(amount)}</b></div>
      <div class="env-back"></div>
      <div class="env-front"></div>
      <div class="env-flap"></div>
      <div class="env-seal">LB</div>
    </div>
    <div class="env-caption">Заявка отправлена</div>`;
  document.body.append(scene);
  requestAnimationFrame(() => scene.classList.add('is-in'));
  sndWhoosh(true);
  setTimeout(() => { sndStamp(); haptic('medium'); }, 900);
  setTimeout(() => { scene.classList.add('is-gone'); sndWhoosh(false); }, 1700);
  setTimeout(() => scene.remove(), 2500);
}

/** Выплаченные заявки, которые игрок ещё не видел такими. */
function freshPaidIds(payouts) {
  const paid = payouts.filter((p) => p.status === 'paid').map((p) => String(p.id));
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(PAID_SEEN_KEY) || 'null'); } catch { /* приватный режим */ }
  // Первый заход: всё прошлое считаем увиденным, иначе печати застучат по
  // всей истории разом.
  const fresh = seen ? paid.filter((id) => !seen.includes(id)) : [];
  try { localStorage.setItem(PAID_SEEN_KEY, JSON.stringify(paid)); } catch { /* приватный режим */ }
  return new Set(fresh);
}

function renderPayoutList(payouts) {
  const box = document.getElementById('payoutList');
  if (!payouts.length) {
    box.innerHTML = cashEmpty('Заявок пока нет', 'Созданные заявки на вывод появятся здесь');
    return;
  }

  // Новая выплата получает золотую печать с ударом: деньги пришли, и это
  // видно сразу, а не мелким словом в статусе.
  const fresh = freshPaidIds(payouts);
  if (fresh.size) setTimeout(() => { sndStamp(); sndCollect(); haptic('success'); }, 350);

  box.innerHTML = payouts.map((p) => `
    <div class="payout-row ${p.status}">
      ${p.status === 'paid' ? `<span class="payout-seal${fresh.has(String(p.id)) ? ' is-new' : ''}" aria-hidden="true">✓</span>` : ''}
      <div class="payout-head">
        <b>${money(p.amount)}${p.requested_amount ? ` <small class="dep-fact">из ${money(p.requested_amount)}</small>` : ''}</b>
        <span class="payout-status ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <div class="payout-date">${cashDate(p.created_at)}</div>
      <div class="payout-requisites">${payoutRequisites(p)}</div>
      ${p.comment ? `<div class="payout-comment">${esc(p.comment)}</div>` : ''}
      ${p.status === 'pending'
        ? `<button class="payout-cancel" data-cancel="${p.id}">Отменить заявку</button>`
        : ''}
    </div>`).join('');

  // Кнопка отмены есть только у заявок в обработке: после решения
  // администратора отменять уже нечего.
  box.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => withCashBusy(btn, async () => {
      try {
        const r = await api('/api/payout/cancel', { id: Number(btn.dataset.cancel) });
        applyUser(r.user);
        toast('Заявка отменена, средства возвращены');
        sndCollect();
        haptic('success');
        loadWallet();
      } catch (err) { toast(err.message); haptic('error'); }
    }));
  });
}

document.getElementById('walletDeposit').addEventListener('click', () => { setCashMode('deposit'); haptic('light'); });

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
  loaded: false, enabled: false, coins: [], rates: {}, payoutRates: {}, min: 100, max: 500000,
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

/**
 * Курс пополнения и курс вывода у USDT разные: вывод считается по Rapira с
 * наценкой. Поэтому каждая сторона кассы берёт свою таблицу.
 */
function sideRates(side) {
  return side === 'withdraw' ? { ...cryptoState.rates, ...cryptoState.payoutRates } : cryptoState.rates;
}

function coinAmount(rub, currency, side = 'deposit') {
  const rate = sideRates(side)[currency];
  if (!rate || !rub) return null;
  const value = rub / rate;
  return value.toFixed(coinDecimals(rate));
}

/** Курс монеты словами: «1 USDT = 86,15 ₽». */
function rateLine(currency, side = 'deposit') {
  const rate = sideRates(side)[currency];
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
      // Запоминается только рабочая касса. Отказ (шлюз моргнул, сервер
      // перезапускался с новыми ключами) раньше запоминался до перезагрузки
      // страницы, и игрок видел «недоступна», когда касса уже работала.
      loaded: !!data.enabled,
      enabled: !!data.enabled,
      coins: data.coins || [],
      rates: data.rates || {},
      payoutRates: data.payoutRates || {},
      min: data.min ?? 100,
      max: data.max ?? 500000,
    });
  } catch {
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
/*
 * Суммы в кассе вводятся с разрядами: «8 800», а не «8800». Поэтому поле
 * текстовое (у type="number" пробел внутри недопустим), а число из него
 * читается только через amountOf: в value лежат пробелы, и Number() дал бы NaN.
 * Курсор после переформатирования ставится после того же по счёту знака,
 * иначе при правке в середине числа он улетал бы в конец.
 */
const AMOUNT_GROUP = '\u00a0';
const AMOUNT_MAX_DIGITS = 9;
function amountOf(input) {
  return Number(String(input?.value || '').replace(/\D/g, '')) || 0;
}
function groupDigits(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, AMOUNT_GROUP);
}
function setAmount(input, n) {
  if (!input) return;
  const digits = String(Math.trunc(Number(n) || 0) || '');
  input.value = groupDigits(digits);
}
function bindAmountInput(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, AMOUNT_MAX_DIGITS);
    input.value = groupDigits(digits);
    let pos = 0, seen = 0;
    while (pos < input.value.length && seen < before) {
      if (/\d/.test(input.value[pos])) seen += 1;
      pos += 1;
    }
    try { input.setSelectionRange(pos, pos); } catch { /* поле не в фокусе */ }
  });
}
// Вешается раньше остальных слушателей ввода: они видят уже ровное значение.
['cryptoAmount', 'siciliaAmount', 'withdrawAmount'].forEach((id) => bindAmountInput(document.getElementById(id)));

function refreshCryptoRate(side) {
  const isDeposit = side === 'deposit';
  const box = document.getElementById(isDeposit ? 'cryptoRate' : 'withdrawRate');
  const currency = cryptoState[side].currency;
  if (!box) return;

  if (!currency) { box.innerHTML = ''; return; }

  const rub = amountOf(document.getElementById(isDeposit ? 'cryptoAmount' : 'withdrawAmount'));
  const amount = coinAmount(rub, currency, side);
  const course = rateLine(currency, side);

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
    setAmount(input, b.dataset.sum);
    refreshCryptoRate('deposit');
    markQuick(row, input);
    haptic('light');
  }));
}

async function openCryptoDeposit() {
  const box = document.getElementById('cryptoCreate');
  showDepositPane('cryptoCreate');

  await loadCryptoOptions();
  if (!cryptoState.enabled || !cryptoState.coins.length) {
    box.innerHTML = '<p class="empty">Криптокасса временно недоступна. Попробуйте позже.</p>';
    return;
  }

  renderCoinGrid(document.getElementById('coinGrid'), 'deposit');
  renderCryptoQuick();
  document.getElementById('cryptoAmount').placeholder = `от ${fmtMoney(cryptoState.min)}`;
  selectCoin('deposit', cryptoState.deposit.currency || cryptoState.coins[0].currency);
}

document.getElementById('coinNetworkSelect')?.addEventListener('change', (e) => {
  cryptoState.deposit.network = e.target.value;
  refreshCryptoRate('deposit');
});

document.getElementById('withdrawNetwork')?.addEventListener('change', (e) => {
  cryptoState.withdraw.network = e.target.value;
});
document.getElementById('cryptoAmount')?.addEventListener('input', (e) => {
  refreshCryptoRate('deposit');
  markQuick(document.getElementById('cryptoQuick'), e.target);
});

/** Подсвечивает быструю сумму, совпавшую с введённой: видно, что выбрано. */
function markQuick(row, input) {
  row?.querySelectorAll('.quick-btn').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.sum) === amountOf(input)));
}

document.getElementById('cryptoCreateBtn')?.addEventListener('click', async () => {
  const { currency, network } = cryptoState.deposit;
  const amount = amountOf(document.getElementById('cryptoAmount'));
  if (!currency || !network) return toast('Выберите монету и сеть');
  if (!amount || amount < cryptoState.min) return toast(`Минимум ${money(cryptoState.min)}`);

  await withCashBusy(document.getElementById('cryptoCreateBtn'), async () => {
    try {
      const payment = await api('/api/crypto/create', { amount, currency, network });
      showCryptoCheckout(payment);
      haptic('success');
    } catch (err) {
      toast(err.message);
      haptic('error');
    }
  });
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
          <div class="invoice-label">К оплате</div>
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
          <span class="invoice-addr">${esc(p.address)}</span>
          <span class="cash-copy">${cashIcon('copy')}${cashIcon('check')}<span class="cash-copy-label">Скопировать</span></span>
        </button>` : ''}

      <div class="invoice-warn">${cashIcon('warn')}<span>Отправляйте только ${p.currency} в сети
        ${esc(p.networkName)}. Перевод в другой сети теряется без возврата.</span></div>

      ${p.payUrl ? `<a class="cash-cta" href="${p.payUrl}"
         target="_blank" rel="noopener"><span>Открыть страницу оплаты</span>${cashIcon('open')}</a>` : ''}

      <div class="cash-row2">
        <button class="cash-ghost" id="cryptoCheck">${cashIcon('refresh')}Я оплатил</button>
        <button class="cash-ghost" id="cryptoBack">Другой способ</button>
      </div>
      <div class="invoice-status" id="cryptoStatus"></div>
    </div>`;

  // Адрес копируется нажатием на всю плашку: переписывать его руками с экрана
  // телефона - верный способ потерять перевод.
  bindCashCopy(document.getElementById('cryptoCopy'), p.address);

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

/* Способы пополнения: у каждого свой экран, открыт ровно один. */
const DEPOSIT_PANES = ['cryptoCreate', 'cryptoCheckout', 'siciliaCreate', 'siciliaCheckout'];
function showDepositPane(...ids) {
  for (const id of DEPOSIT_PANES) {
    const el = document.getElementById(id);
    if (el) el.hidden = !ids.includes(id);
  }
}
function markDepositMethod(method) {
  document.querySelectorAll('[data-payment-method]').forEach((b) =>
    b.classList.toggle('active', b.dataset.paymentMethod === method));
}

document.querySelector('[data-payment-method="crypto"]')?.addEventListener('click', () => {
  markDepositMethod('crypto');
  stopSiciliaTimers();
  openCryptoDeposit();
});

/*
 * Способов пополнения два: СБП и карта через Sicilia и криптовалюта. Первым
 * открывается Sicilia, если шлюз настроен: рублёвой оплатой пользуется
 * большинство. Не настроен - касса сразу открывает криптовалюту.
 */
async function openDefaultDeposit() {
  await loadSiciliaOptions();
  if (siciliaState.enabled) openSiciliaDeposit();
  else { markDepositMethod('crypto'); openCryptoDeposit(); }
}

/* ---------- СБП и карта: шлюз Sicilia ---------- */

/*
 * Два способа, их выбирает сервер (mode в /api/sicilia/options):
 * 'h2h' - ордер заводит сервер, реквизит, сумму и таймер показываем здесь;
 * 'window' - оплата в окне шлюза, открытом отдельной вкладкой.
 */
const siciliaState = {
  loaded: false, enabled: false, mode: 'h2h', min: 100, max: 300000,
  method: 'sbp', bank: '', poll: 0, tick: 0, current: null,
};
// Пока карточка ожидания на экране, раз в столько спрашиваем, не пришли ли
// деньги. Колбэк шлюза приходит на сервер раньше, и поток событий сообщит
// сам; опрос - запас на случай, когда поток оборвался.
const SICILIA_POLL_MS = 15000;
const SICILIA_QUICK = [100, 500, 1000, 5000, 10000];
// Меньше стольких секунд до конца - таймер жёлтый: пора заканчивать перевод.
const SICILIA_HURRY_S = 180;
// Сколько ждём второго нажатия «Отменить»: отмена после перевода стоит денег.
const SICILIA_CANCEL_CONFIRM_MS = 4000;
const SICILIA_BANK_KEY = 'lb.sicilia.bank';

/*
 * Банк игрока: для этих четырёх шлюз отдаёт ссылку, открывающую перевод в
 * приложении банка с уже заполненными полями. Коды - те же, что у шлюза.
 */
const SICILIA_BANKS = [
  { code: 'sberbank', name: 'Сбер' },
  { code: 'tinkoff', name: 'Т-Банк' },
  { code: 'vtb', name: 'ВТБ' },
  { code: 'alfa-bank', name: 'Альфа' },
  { code: '', name: 'Другой' },
];

async function loadSiciliaOptions() {
  if (siciliaState.loaded) return siciliaState;
  try {
    const d = await api('/api/sicilia/options');
    Object.assign(siciliaState, {
      loaded: true, enabled: !!d.enabled, mode: d.mode === 'window' ? 'window' : 'h2h',
      min: d.min ?? 100, max: d.max ?? 300000,
    });
  } catch {
    siciliaState.loaded = true;
  }
  try { siciliaState.bank = localStorage.getItem(SICILIA_BANK_KEY) || ''; } catch { /* нет хранилища */ }
  const tab = document.querySelector('[data-payment-method="sicilia"]');
  if (tab) tab.hidden = !siciliaState.enabled;
  return siciliaState;
}

/*
 * Пустая вкладка под окно шлюза, открытая до запроса (иначе браузер сочтёт
 * её всплывающим окном). Ссылку на наш сайт у неё отбираем сразу: страница
 * шлюза иначе получила бы window.opener и могла подменить нашу вкладку.
 */
function openBlankTab() {
  const tab = window.open('', '_blank');
  if (tab) { try { tab.opener = null; } catch { /* чужая вкладка */ } }
  return tab;
}

/*
 * Окно оплаты открывается отдельной вкладкой, а сайт остаётся открытым и
 * ждёт. Вкладку открываем ДО запроса к серверу (pending), иначе браузер
 * сочтёт её всплывающим окном и заблокирует.
 */
function openPaymentWindow(url, pending) {
  if (pending && !pending.closed) { pending.location.href = url; return true; }
  return !!window.open(url, '_blank', 'noopener');
}

function stopSiciliaTimers() {
  clearInterval(siciliaState.poll);
  clearInterval(siciliaState.tick);
}

function openSiciliaDeposit({ resume = true } = {}) {
  stopSiciliaTimers();
  markDepositMethod('sicilia');
  showDepositPane('siciliaCreate');
  const h2h = siciliaState.mode === 'h2h';
  const input = document.getElementById('siciliaAmount');
  input.placeholder = `от ${fmtMoney(siciliaState.min)}`;
  document.getElementById('siciliaQuick').innerHTML = SICILIA_QUICK
    .filter((v) => v >= siciliaState.min && v <= siciliaState.max)
    .map((v) => `<button type="button" class="quick-btn" data-sum="${v}">${money(v)}</button>`).join('');
  document.querySelectorAll('#siciliaQuick [data-sum]').forEach((b) => b.addEventListener('click', () => {
    setAmount(input, b.dataset.sum);
    syncSiciliaAmount();
    haptic('light');
  }));

  document.querySelectorAll('[data-sic-h2h]').forEach((el) => { el.hidden = !h2h; });
  document.getElementById('siciliaFine').textContent = h2h
    ? 'Реквизиты для перевода появятся здесь. Переведите точную сумму: деньги зачислятся сами, как только банк подтвердит перевод.'
    : 'Окно оплаты откроется отдельно. Оплатите точную сумму и вернитесь сюда: деньги зачислятся сами, как только банк подтвердит перевод.';
  if (h2h) {
    markSiciliaMethod(siciliaState.method);
    renderSiciliaBanks();
  }
  syncSiciliaAmount();

  // Неоплаченный перевод живёт дольше кассы: вернувшийся игрок видит его, а
  // не форму, иначе он заведёт второй и переведёт не на тот реквизит.
  if (h2h && resume) {
    api('/api/sicilia/list', {}, { quiet: true }).then((d) => {
      const open = (d.rows || []).find((r) => r.requisite);
      const pane = document.getElementById('siciliaCreate');
      if (open && !pane.hidden) showSiciliaRequisite(open);
    }).catch(() => {});
  }
}

function markSiciliaMethod(method) {
  siciliaState.method = method === 'card' ? 'card' : 'sbp';
  const seg = document.getElementById('siciliaMethod');
  if (!seg) return;
  seg.dataset.active = siciliaState.method;
  seg.querySelectorAll('[data-sic-method]').forEach((b) =>
    b.classList.toggle('active', b.dataset.sicMethod === siciliaState.method));
}
document.querySelectorAll('[data-sic-method]').forEach((b) => b.addEventListener('click', () => {
  markSiciliaMethod(b.dataset.sicMethod);
  haptic('light');
}));

function renderSiciliaBanks() {
  const row = document.getElementById('siciliaBank');
  if (!row) return;
  row.innerHTML = SICILIA_BANKS.map((b) => `<button type="button" class="quick-btn${
    b.code === siciliaState.bank ? ' active' : ''}" data-bank="${b.code}">${b.name}</button>`).join('');
  row.querySelectorAll('[data-bank]').forEach((btn) => btn.addEventListener('click', () => {
    siciliaState.bank = btn.dataset.bank;
    try { localStorage.setItem(SICILIA_BANK_KEY, siciliaState.bank); } catch { /* нет хранилища */ }
    row.querySelectorAll('[data-bank]').forEach((x) => x.classList.toggle('active', x === btn));
    haptic('light');
  }));
}

/*
 * Кнопка называет сумму: «Пополнить 3 000 ₽» успокаивает лучше безликого
 * «Продолжить».
 */
function syncSiciliaAmount() {
  const input = document.getElementById('siciliaAmount');
  const n = amountOf(input);
  markQuick(document.getElementById('siciliaQuick'), input);
  const verb = siciliaState.mode === 'h2h' ? 'Пополнить' : 'Оплатить';
  document.getElementById('siciliaCreateLabel').textContent = n > 0 ? `${verb} ${money(n)}`
    : siciliaState.mode === 'h2h' ? 'Получить реквизиты' : 'Перейти к оплате';
}
document.getElementById('siciliaAmount')?.addEventListener('input', syncSiciliaAmount);

document.querySelector('[data-payment-method="sicilia"]')?.addEventListener('click', () => openSiciliaDeposit());

document.getElementById('siciliaCreateBtn')?.addEventListener('click', async () => {
  const amount = amountOf(document.getElementById('siciliaAmount'));
  if (!amount || amount < siciliaState.min) return toast(`Минимум ${money(siciliaState.min)}`);
  if (amount > siciliaState.max) return toast(`Максимум ${money(siciliaState.max)}`);
  const btn = document.getElementById('siciliaCreateBtn');

  if (siciliaState.mode === 'h2h') {
    await withCashBusy(btn, async () => {
      try {
        const order = await api('/api/sicilia/create', { amount, method: siciliaState.method, senderBank: siciliaState.bank });
        showSiciliaRequisite(order);
        haptic('success');
      } catch (err) {
        if (err.code === 'OPEN_ORDER' && err.data?.order) {
          showSiciliaRequisite(err.data.order);
          toast('Сначала завершите этот перевод или отмените его');
        } else {
          toast(err.message);
        }
        haptic('error');
      }
    });
    return;
  }

  btn.disabled = true;
  btn.classList.add('is-busy');
  const pending = openBlankTab();
  try {
    const order = await api('/api/sicilia/create', { amount });
    const opened = openPaymentWindow(order.url, pending);
    showSiciliaCheckout(order, opened);
    haptic('success');
  } catch (err) {
    pending?.close();
    toast(err.message);
    haptic('error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }
});

/* ---------- Перевод по реквизиту ---------- */

/** «79991234567» -> «+7 999 123-45-67»: так номер сверяют глазами. */
function fmtPhone(d) {
  const m = String(d || '').match(/^7?(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : String(d || '');
}
/** Номер карты четвёрками, как он напечатан на карте. */
const fmtCard = (d) => String(d || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtLeft = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/*
 * Что показать на карточке: телефон для СБП, карта для перевода на карту,
 * счёт для перевода по счёту. Шлюз решает сам и может выдать на СБП карту -
 * тогда показываем карту, а не пустое поле телефона.
 */
function siciliaTarget(r) {
  if (r.account) return { kind: 'account', tag: 'Счёт', label: 'Номер счёта', text: r.account, copy: r.account };
  const phone = r.phone && { kind: 'sbp', tag: 'СБП', label: 'Номер телефона', text: fmtPhone(r.phone), copy: `+${r.phone.replace(/^8/, '7')}` };
  const card = r.card && { kind: 'card', tag: 'Карта', label: 'Номер карты', text: fmtCard(r.card), copy: r.card };
  return r.method === 'card' ? card || phone : phone || card;
}

/* Маска вместо номера после срока: той же длины, чтобы карточка не прыгала. */
const maskRequisite = (text) => String(text).replace(/\d/g, '•');

/*
 * Чип и знак бесконтакта нарисованы, а не взяты картинкой: это рисунок
 * «карты вообще», без логотипа и цвета какого-либо банка. Карточка
 * показывает, куда переводить, и не должна выдавать себя за карту
 * конкретного банка.
 */
const SIC_CHIP = `<svg class="sic-chip" viewBox="0 0 40 30" aria-hidden="true">
  <rect x="0.5" y="0.5" width="39" height="29" rx="6"/>
  <path d="M0.5 10.5h11a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-11M39.5 10.5h-11a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h11M14.5 0.5v10M25.5 0.5v10M14.5 19.5v10M25.5 19.5v10"/>
</svg>`;
const SIC_WAVES = `<svg class="sic-waves" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M8.5 8.2a5.6 5.6 0 0 1 0 7.6M12 5.6a9.4 9.4 0 0 1 0 12.8M15.5 3a13.2 13.2 0 0 1 0 18"/></svg>`;

/**
 * Экран перевода: сумма с таймером, реквизит на карточке, три шага, одна
 * главная кнопка.
 *
 * Сумма и номер копируются нажатием: переписывать номер с экрана телефона -
 * верный способ ошибиться цифрой и отправить деньги мимо. Отмена - тихая
 * ссылка внизу, а не кнопка рядом с главной: её нажимают по ошибке.
 */
function showSiciliaRequisite(order) {
  const r = order.requisite;
  if (!r) { openSiciliaDeposit({ resume: false }); return; }
  stopSiciliaTimers();
  siciliaState.current = order;
  showDepositPane('siciliaCheckout');
  const box = document.getElementById('siciliaCheckout');
  const target = siciliaTarget(r);
  const sum = Number(order.paySum || order.amount);
  const sumCopy = Number.isInteger(sum) ? String(sum) : sum.toFixed(2).replace('.', ',');
  const where = target?.kind === 'sbp'
    ? `по СБП по номеру телефона${r.bank ? `, банк <b>${esc(r.bank)}</b>` : ''}`
    : target?.kind === 'account' ? 'по реквизитам счёта' : 'на карту по номеру';
  const lead = r.deeplink || r.payLink;

  box.innerHTML = `
    <div class="sic-pay">
      <div class="sic-top">
        <div class="sic-amount">
          <div class="invoice-label">К переводу</div>
          <div class="sic-amount-row">
            <span class="sic-amount-num">${money(sum)}</span>
            <button class="sic-icon-btn" id="sicCopySum" type="button" aria-label="Скопировать сумму">
              <span class="cash-copy">${cashIcon('copy')}${cashIcon('check')}</span>
            </button>
          </div>
        </div>
        <div class="sic-clock" id="sicTimer" role="timer" aria-label="Время на перевод">
          <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="sic-clock-bg" cx="22" cy="22" r="19"/>
            <circle class="sic-clock-fg" id="sicTimerArc" cx="22" cy="22" r="19" pathLength="100"/></svg>
          <span class="sic-clock-text"><b id="sicTimerText">--:--</b></span>
        </div>
      </div>

      ${target ? `
      <div class="sic-card-stage">
        <button class="sic-card" id="sicCopyTarget" type="button" data-kind="${target.kind}"
                aria-label="${esc(target.label)} получателя, скопировать">
          <span class="sic-card-fx" aria-hidden="true"><span class="sic-card-glow"></span><span class="sic-card-sheen"></span></span>
          <span class="sic-card-head">
            <span class="sic-card-bank">${esc(r.bank || 'Банк получателя')}</span>
            <span class="cash-copy">${cashIcon('copy')}${cashIcon('check')}<span class="cash-copy-label">Скопировать</span></span>
          </span>
          <span class="sic-card-mid">${SIC_CHIP}${target.kind === 'card' ? SIC_WAVES : ''}<span class="sic-card-tag">${target.tag}</span></span>
          <span class="sic-card-label">${esc(target.label)}</span>
          <span class="sic-card-num" id="sicNum">${esc(target.text)}</span>
          ${r.holder ? `<span class="sic-card-holder"><small>Получатель</small>${esc(r.holder)}</span>` : ''}
          <span class="sic-card-stamp" aria-hidden="true">Срок истёк</span>
        </button>
      </div>` : ''}
      ${r.bik ? `
      <button class="sic-line" id="sicCopyBik" type="button">
        <span><small>БИК банка</small>${esc(r.bik)}</span>
        <span class="cash-copy">${cashIcon('copy')}${cashIcon('check')}<span class="cash-copy-label">Скопировать</span></span>
      </button>` : ''}
      ${r.abroad ? `<div class="sic-abroad">${cashIcon('info')}<span>Перевод за рубеж: ${esc(r.abroad)}</span></div>` : ''}

      <ol class="sic-steps">
        <li><i>1</i><span>Скопируйте номер и сумму</span></li>
        <li><i>2</i><span>Переведите ${where}</span></li>
        <li><i>3</i><span>Вернитесь сюда: деньги зачислятся сами</span></li>
      </ol>

      <div class="sic-actions">
        ${r.deeplink ? `<a class="cash-cta" id="sicOpenBank" href="${esc(r.deeplink)}" target="_blank" rel="noopener"><span>Открыть в банке</span>${cashIcon('open')}</a>` : ''}
        ${r.payLink ? `<a class="cash-cta" id="sicOpenBank" href="${esc(r.payLink)}" target="_blank" rel="noopener"><span>Перейти к оплате</span>${cashIcon('open')}</a>` : ''}
        <button class="${lead ? 'cash-ghost' : 'cash-cta'} sic-paid" id="siciliaCheck">${lead ? cashIcon('check') : ''}<span>Я перевёл</span>${lead ? '' : cashIcon('check')}</button>
      </div>
      <div class="invoice-status" id="siciliaStatus" aria-live="polite"></div>

      <p class="sic-note">${cashIcon('warn')}<span>Ровно ${money(sum)} одним переводом. Другая сумма задержит
        зачисление. Реквизит одноразовый: в следующий раз получите новый.</span></p>
      <button class="sic-cancel" id="siciliaCancel" type="button">Отменить перевод</button>
    </div>`;

  bindCashCopy(document.getElementById('sicCopySum'), sumCopy);
  const card = document.getElementById('sicCopyTarget');
  if (target) bindCashCopy(card, target.copy);
  if (r.bik) bindCashCopy(document.getElementById('sicCopyBik'), r.bik);
  tiltSiciliaCard(card);
  document.getElementById('siciliaCheck').addEventListener('click', () => checkSicilia(order, true));

  const cancel = document.getElementById('siciliaCancel');
  let armed = 0;
  cancel.addEventListener('click', async () => {
    if (cancel.dataset.expired) { openSiciliaDeposit({ resume: false }); return; }
    if (!armed) {
      armed = setTimeout(() => { armed = 0; cancel.textContent = 'Отменить перевод'; cancel.classList.remove('is-armed'); }, SICILIA_CANCEL_CONFIRM_MS);
      cancel.textContent = 'Точно? Нажмите ещё раз, если не переводили';
      cancel.classList.add('is-armed');
      haptic('light');
      return;
    }
    clearTimeout(armed);
    await withCashBusy(cancel, async () => {
      try {
        const res = await api('/api/sicilia/cancel', { id: order.id });
        if (res.user) applyUser(res.user);
        if (res.credited || res.payment?.paidAt) {
          toast('Перевод уже пришёл и зачислен');
          sndCollect(); haptic('success');
          showSiciliaDone(res.payment?.credited);
          loadWallet();
          return;
        }
        toast('Перевод отменён');
        loadWallet();
        openSiciliaDeposit({ resume: false });
      } catch (err) {
        armed = 0;
        cancel.textContent = 'Отменить перевод';
        cancel.classList.remove('is-armed');
        toast(err.message);
      }
    });
  });

  const pay = box.querySelector('.sic-pay');
  const arc = document.getElementById('sicTimerArc');
  const total = Math.max(1, (order.expiresAt || 0) - (order.createdAt || 0));
  const tick = () => {
    if (!order.expiresAt) { document.getElementById('sicTimer').hidden = true; return; }
    const left = Math.max(0, Math.round((order.expiresAt - Date.now()) / 1000));
    document.getElementById('sicTimerText').textContent = fmtLeft(left);
    arc.style.strokeDashoffset = String(100 - Math.min(100, (left * 1000 / total) * 100));
    pay.dataset.hurry = left <= SICILIA_HURRY_S ? '1' : '0';
    if (left === 0) siciliaExpired(pay, cancel, target);
  };
  tick();
  siciliaState.tick = setInterval(tick, 1000);
  siciliaState.poll = setInterval(() => {
    if (document.hidden || box.hidden) return;
    checkSicilia(order, false);
  }, SICILIA_POLL_MS);
}

/*
 * Карточка чуть поворачивается за пальцем или мышью: так она читается
 * предметом, а не плашкой. Только при точном указателе и без просьбы
 * системы убрать движение; на телефоне поворот не нужен, там карточку
 * нажимают, а не разглядывают.
 */
const SIC_TILT_DEG = 6;
function tiltSiciliaCard(card) {
  if (!card || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  card.addEventListener('pointermove', (e) => {
    const b = card.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5;
    const y = (e.clientY - b.top) / b.height - 0.5;
    card.style.setProperty('--rx', `${(-y * SIC_TILT_DEG).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${(x * SIC_TILT_DEG).toFixed(2)}deg`);
    card.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

/*
 * Время вышло: номер на карточке сразу заменяется маской. Сервер реквизит
 * уже не отдаст, а перевод на него после срока шлюз не сопоставит с ордером.
 * «Я перевёл» остаётся: перевод, ушедший в последние секунды, ещё найдётся.
 */
function siciliaExpired(pay, cancel, target) {
  clearInterval(siciliaState.tick);
  if (pay.dataset.expired) return;
  pay.dataset.expired = '1';
  const card = document.getElementById('sicCopyTarget');
  if (card) {
    card.disabled = true;
    const num = document.getElementById('sicNum');
    if (num && target) num.textContent = maskRequisite(target.text);
  }
  pay.querySelectorAll('#sicCopyBik, #sicOpenBank, .sic-steps').forEach((el) => el.remove());
  const note = pay.querySelector('.sic-note span');
  if (note) note.textContent = 'Время на перевод вышло, реквизит больше не действует. Если вы успели перевести, нажмите «Я перевёл». Если нет, создайте новый перевод.';
  // Скорее всего игрок не успел: главным становится новый перевод, а
  // «Я перевёл» уступает место, но остаётся.
  cancel.textContent = 'Новый перевод';
  cancel.dataset.expired = '1';
  cancel.className = 'cash-cta sic-new';
  const check = document.getElementById('siciliaCheck');
  if (check) {
    check.className = 'cash-ghost sic-paid';
    check.innerHTML = `${cashIcon('check')}<span>Я перевёл</span>`;
  }
  pay.querySelector('.sic-actions')?.prepend(cancel);
}

/*
 * Деньги пришли: реквизит убирается, на его месте - итог. Оставленный на
 * экране реквизит выглядел бы приглашением перевести ещё раз.
 */
function showSiciliaDone(amount) {
  stopSiciliaTimers();
  const box = document.getElementById('siciliaCheckout');
  if (!box || box.hidden) return;
  // Поток событий обычно опережает ответ проверки и суммы не знает: итог
  // рисуется сразу, а сумма дописывается, когда её пришлёт проверка.
  const done = box.querySelector('.sic-done');
  if (done) {
    const sumEl = done.querySelector('.sic-done-sum');
    if (amount && sumEl && !sumEl.textContent) sumEl.textContent = `+${money(amount)}`;
    return;
  }
  if (!box.querySelector('.sic-pay')) return;
  box.innerHTML = `
    <div class="sic-done">
      <svg class="sic-done-mark" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="sic-done-ring" cx="32" cy="32" r="28" pathLength="100"/>
        <path class="sic-done-tick" d="M20 33.5 28.5 42 45 24" pathLength="100"/>
      </svg>
      <div class="sic-done-title">Деньги на балансе</div>
      <div class="sic-done-sum">${amount ? `+${money(amount)}` : ''}</div>
      <button class="cash-ghost" id="siciliaMore">${cashIcon('plus')}Пополнить ещё</button>
    </div>`;
  document.getElementById('siciliaMore').addEventListener('click', () => openSiciliaDeposit({ resume: false }));
}

/** Карточка ожидания для окна шлюза: сумма, «открыть окно снова», «я оплатил». */
function showSiciliaCheckout(order, opened = true) {
  siciliaState.current = order;
  showDepositPane('siciliaCheckout');
  const box = document.getElementById('siciliaCheckout');
  box.innerHTML = `
    <div class="sicilia-wait">
      <div class="cash-wait-head">
        <span class="cash-pulse" aria-hidden="true"></span>
        <div>
          <div class="cash-wait-status">Ждём подтверждения банка</div>
          <div class="sicilia-wait-sub">${opened ? 'Оплата открыта в отдельном окне' : 'Окно оплаты не открылось само'}</div>
        </div>
      </div>
      <div class="sicilia-wait-sum">${money(order.amount)}</div>
      <p>${opened ? 'Переведите точную сумму по реквизитам в окне оплаты.' : 'Нажмите кнопку ниже, чтобы открыть его.'}
        Как только банк подтвердит перевод, деньги появятся на балансе.</p>
      <button class="cash-cta" id="siciliaReopen"><span>Открыть окно оплаты</span>${cashIcon('open')}</button>
      <div class="cash-row2">
        <button class="cash-ghost" id="siciliaCheck">${cashIcon('refresh')}Я оплатил</button>
        <button class="cash-ghost" id="siciliaBack">Другая сумма</button>
      </div>
      <div class="invoice-status" id="siciliaStatus"></div>
    </div>`;
  document.getElementById('siciliaReopen').addEventListener('click', async () => {
    const pending = openBlankTab();
    try {
      const again = await api('/api/sicilia/reopen', { id: order.id });
      openPaymentWindow(again.url, pending);
    } catch (err) {
      pending?.close();
      toast(err.message);
    }
  });
  document.getElementById('siciliaBack').addEventListener('click', () => openSiciliaDeposit({ resume: false }));
  document.getElementById('siciliaCheck').addEventListener('click', () => checkSicilia(order, true));
  stopSiciliaTimers();
  siciliaState.poll = setInterval(() => {
    if (document.hidden || box.hidden) return;
    checkSicilia(order, false);
  }, SICILIA_POLL_MS);
}

async function checkSicilia(order, byHand) {
  const status = document.getElementById('siciliaStatus');
  // Пульс у строки - знак, что ждём банк, а не что ничего не происходит.
  const say = (text, wait) => { if (!status) return; status.textContent = text; status.classList.toggle('is-wait', !!wait); };
  if (byHand) say('Проверяем платёж…', true);
  try {
    const r = await api('/api/sicilia/refresh', { id: order.id });
    if (r.credited || r.payment?.paidAt) {
      stopSiciliaTimers();
      if (r.user) applyUser(r.user);
      say('Платёж зачислен.');
      if (r.credited) { toast('Платёж зачислен'); sndCollect(); haptic('success'); }
      showSiciliaDone(r.payment?.credited);
      loadWallet();
      return;
    }
    const closed = ['cancelled', 'error', 'unclaimed', 'expired'].includes(r.payment?.status);
    if (closed) { stopSiciliaTimers(); loadSiciliaIssues(); }
    if (byHand || closed) {
      if (closed) say('Оплата не поступила и закрыта. Если вы перевели деньги, нажмите «Деньги не пришли» в списке ниже и приложите чек.');
      else say('Ждём подтверждение банка. Обычно это 2-4 минуты, страницу можно не обновлять.', true);
    }
  } catch (err) {
    if (byHand) say(err.message);
  }
}

/* ---------- Касса: оплата не пришла ---------- */

/*
 * Оплаты СБП, которые ещё не зачислены, за последние ISSUE_WINDOW_DAYS дней.
 * Отсюда игрок сообщает: перевёл, а деньги не пришли, и прикладывает чек.
 * Номер платежа показан, чтобы поддержка нашла оплату одним поиском, а не по
 * сумме и времени. Срок совпадает с серверным (DISPUTE_WINDOW_MS).
 */
const ISSUE_WINDOW_DAYS = 7;
const ISSUE_STATUS = {
  created: 'Ждём оплату', pending: 'Ждём оплату', processing: 'Банк проверяет перевод',
  cancelled: 'Оплата не поступила', error: 'Оплата не поступила', unclaimed: 'Оплата не поступила',
  expired: 'Оплата не поступила',
};
const ISSUE_DISPUTE = {
  new: 'Чек получен, проверяем', sent: 'Передано в платёжную систему, ждём ответа',
  won: 'Зачислено по вашему обращению', lost: 'Платёжная система не подтвердила перевод',
  declined: 'Отказано',
};

async function loadSiciliaIssues() {
  const wrap = document.getElementById('siciliaIssues');
  if (!wrap || state.guest) return;
  let rows = [];
  try { rows = (await api('/api/sicilia/list')).rows || []; } catch { return; }
  const from = Date.now() - ISSUE_WINDOW_DAYS * 86400000;
  const open = rows.filter((r) => !r.paidAt && r.createdAt >= from && (r.opened || r.dispute));
  wrap.hidden = !open.length;
  const list = document.getElementById('siciliaIssueList');
  list.innerHTML = open.map((r) => {
    const d = r.dispute;
    const canReport = !d || !['new', 'sent'].includes(d.status);
    return `<div class="cash-issue" data-issue="${r.id}">
      <div class="cash-issue-head">
        <b>${money(r.amount)}</b>
        <span>${esc(d ? ISSUE_DISPUTE[d.status] || '' : ISSUE_STATUS[r.status] || 'Ждём оплату')}</span>
      </div>
      <small>${cashDate(r.createdAt)} · платёж № ${esc(r.number || String(r.id))}</small>
      ${d?.note && ['declined', 'lost'].includes(d.status) ? `<p class="cash-issue-note">${esc(d.note)}</p>` : ''}
      ${canReport ? `<button class="cash-ghost cash-issue-btn" data-issue-report="${r.id}">${cashIcon('warn')}Деньги не пришли</button>` : ''}
      <div class="cash-issue-form" data-issue-form="${r.id}" hidden>
        <p>Приложите чек или скриншот перевода из приложения банка: сумма, дата и получатель должны быть видны.</p>
        <label class="cash-issue-file">${cashIcon('plus')}<span data-issue-file-label>Выбрать чек</span>
          <input type="file" accept="image/*" data-issue-file hidden></label>
        <textarea class="seed-input" rows="2" maxlength="500" data-issue-comment
          placeholder="Когда и с какого банка переводили (необязательно)"></textarea>
        <button class="cash-cta" data-issue-send><span>Отправить</span>${cashIcon('arrow')}</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-issue-report]').forEach((b) => b.addEventListener('click', () => {
    const form = list.querySelector(`[data-issue-form="${b.dataset.issueReport}"]`);
    form.hidden = !form.hidden;
    haptic('light');
  }));
  list.querySelectorAll('[data-issue-file]').forEach((input) => input.addEventListener('change', () => {
    const label = input.closest('.cash-issue-file').querySelector('[data-issue-file-label]');
    label.textContent = input.files[0] ? input.files[0].name : 'Выбрать чек';
    input.closest('.cash-issue-file').classList.toggle('is-picked', !!input.files[0]);
  }));
  list.querySelectorAll('[data-issue-send]').forEach((btn) => btn.addEventListener('click', () => withCashBusy(btn, async () => {
    const box = btn.closest('[data-issue]');
    const file = box.querySelector('[data-issue-file]').files[0];
    if (!file) { toast('Приложите чек перевода'); return; }
    try {
      const image = await receiptDataUrl(file);
      const r = await api('/api/sicilia/report', {
        id: Number(box.dataset.issue), image, comment: box.querySelector('[data-issue-comment]').value,
      });
      if (r.user) applyUser(r.user);
      if (r.credited) { toast('Платёж нашёлся и зачислен'); sndCollect(); loadWallet(); }
      else toast('Чек получен. Проверим перевод и вернёмся с ответом здесь же');
      haptic('success');
      loadSiciliaIssues();
    } catch (err) { toast(err.message); haptic('error'); }
  })));
}

function startPaymentEvents(){
  /*
   * Поток событий имеет смысл только когда страницу отдаёт сервер. В
   * автономной сборке её открывают файлом с диска, сервера нет вовсе, и
   * EventSource там не подключается, а падает с ошибкой в консоли при каждом
   * запуске. Ждать от неё платежей всё равно нечего.
   */
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  if (state.guest) return;
  const es=new EventSource('/api/payments/events');
  es.addEventListener('payment.completed', async () => {
    showSiciliaDone();
    toast('Платёж успешно поступил. Средства зачислены на счёт.');
    sndCollect();
    haptic('success');
    // Сбой сети здесь не должен оставить необработанную ошибку: баланс
    // всё равно обновит касса ниже.
    try { applyUser((await api('/api/me')).user); } catch { /* обновится при следующем запросе */ }
    loadWallet();
  });
}

document.getElementById('walletWithdraw').addEventListener('click', () => { setCashMode('withdraw'); haptic('light'); });

document.getElementById('withdrawAll').addEventListener('click', () => {
  setAmount(document.getElementById('withdrawAmount'), Math.floor(state.wallet?.available || 0));
  if (state.withdrawMethod === 'crypto') refreshCryptoRate('withdraw');
  haptic('light');
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
  // По этому атрибуту плашка переключателя едет под выбранный способ.
  btn.parentElement.dataset.active = state.withdrawMethod;
  haptic('light');
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

document.getElementById('withdrawSubmit').addEventListener('click', (e) => withCashBusy(e.currentTarget, async () => {
  const amount = amountOf(document.getElementById('withdrawAmount'));
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
      payload.cryptoAmount = coinAmount(amount, currency, 'withdraw') || '';
      payload.cryptoRate = sideRates('withdraw')[currency] || 0;
    } else payload.cardNumber = document.getElementById('withdrawCard').value;
    const r = await api('/api/payout/create', payload);
    applyUser(r.user);
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('withdrawPhone').value = '';
    document.getElementById('withdrawCard').value = '';
    const addr = document.getElementById('withdrawAddress');
    if (addr) addr.value = '';
    sendPayoutEnvelope(amount);
    haptic('success');
    loadWallet();
  } catch (err) { toast(err.message); haptic('error'); }
}));

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
 * сдвигая остальные вправо, - как настоящая живая лента.
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

/** Ключи уже показанных записей - иначе один выигрыш въехал бы дважды. */
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
  const art = tileArt(drop, color);
  // Ников в карточке нет: витрина показывает выигрыш, а не того, кто его снял.
  // Семейства и силуэта у плашки ленты нет, только материал рисунка. Лента
  // бежит мимо глаз полосой из десятка плашек, и скосы, билеты и
  // шестигранники разных форм подряд читались рваным краем, а не витриной
  // (решение заказчика). Оформление предмета целиком видно, когда плашку
  // нажали: открывается та же карточка, что в составе.
  const skin = drop.skin || skinOfCase(drop.caseId) || DEFAULT_SKIN;
  return `<button class="feed-card is-new" data-drop="${esc(String(drop.id))}"
      data-material="${skin.material}" style="--tier-color:${color}">
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
  track.querySelectorAll('.skel').forEach((el) => el.remove());
  track.insertAdjacentHTML('afterbegin', feedCardHtml(drop));
  if (!animate) track.firstElementChild.classList.remove('is-new');

  while (track.children.length > FEED_MAX_CARDS) {
    const gone = track.lastElementChild;
    feedDrops.delete(gone.dataset.drop);
    gone.remove();
  }
  document.getElementById('feed').hidden = false;
}

/** Сколько длится вход сцены выигрыша из ленты до появления подписей. */
const FEED_SCENE_MS = 900;

/** Уход сцены: короткий, игрок уже решил закрыть. */
const FEED_SCENE_OUT_MS = 180;

/**
 * Выигрыш из ленты.
 *
 * Витрина показывает, что и сколько выпало, но не откуда - а именно это и
 * интересно: увидел крупное выпадение, хочешь тот же кейс. Поэтому нажатие
 * открывает сцену с обложкой кейса и кнопкой, которая ведёт прямо в него.
 *
 * Это сцена, а не окно с текстом: карточка срывается с ленты с того места,
 * где её нажали, переворачивается в воздухе, и за ней из света поднимается
 * кейс-источник. Порядок важен: сначала предмет (на него нажали), потом
 * откуда он (ради этого открыли), и только потом подписи и кнопка.
 */
function openFeedDrop(drop, fromEl = null) {
  const c = state.config.cases.find((x) => x.id === drop.caseId);
  const scene = document.getElementById('feedBackdrop');
  const color = tierColor(drop.tier);
  const skin = drop.skin || skinOfCase(drop.caseId);

  scene.style.setProperty('--tier-color', color);
  document.getElementById('feedSheetTier').textContent =
    state.config.tiers.find((t) => t.id === drop.tier)?.label || '';
  const nameEl = document.getElementById('feedSheetName');
  nameEl.textContent = drop.name;
  nameEl.dataset.material = skin.material || 'matte';
  document.getElementById('feedSheetValue').textContent = money(drop.value);

  // Карточка предмета - той же разметкой, что состав кейса: игрок узнаёт её
  // по виду, а сцена не заводит своего третьего оформления предмета.
  const card = document.getElementById('feedSheetCard');
  card.innerHTML = `<div class="drop-card rw-skin" ${skinAttrs(skin)} style="--tier-color:${color}">
      <div class="drop-ico">${tileArt(drop, color)}</div>
      <div class="drop-name"><span>${esc(drop.name)}</span></div>
      <div class="drop-value">${money(drop.value)}</div>
    </div>`;
  requestAnimationFrame(() => fitNames(card));

  const cover = document.getElementById('feedSheetCover');
  cover.innerHTML = c ? caseCover(c) : '';
  const [h1, h2] = c?.artGlow || [275, 300];
  scene.style.setProperty('--glow-a', `hsl(${h1} 95% 60%)`);
  scene.style.setProperty('--glow-b', `hsl(${h2} 90% 62%)`);

  document.getElementById('feedSheetCase').innerHTML = c
    ? `${esc(c.name)}`
    : esc(drop.caseName || '');

  const openBtn = document.getElementById('feedSheetOpen');
  const closeBtn = document.getElementById('feedSheetClose');
  openBtn.hidden = !c;
  if (c) {
    document.getElementById('feedSheetSub').textContent = c.name;
    document.getElementById('feedSheetPrice').textContent = money(c.price);
  }

  // Пылинки поднимаются от кейса к карточке: след, по которому видно, откуда
  // она. Каждая со своей траекторией и задержкой, иначе облако читалось бы
  // одним штампом.
  document.getElementById('feedSheetMotes').innerHTML = Array.from({ length: 22 }, () => {
    const x = (Math.random() * 2 - 1) * 90;
    return `<i style="--x:${x.toFixed(0)}px;--drift:${((Math.random() * 2 - 1) * 40).toFixed(0)}px;
      --d:${(700 + Math.random() * 2400).toFixed(0)}ms;--t:${(2200 + Math.random() * 1800).toFixed(0)}ms;
      --s:${(2 + Math.random() * 3).toFixed(1)}px"></i>`;
  }).join('');

  /*
   * Карточка вылетает оттуда, где её нажали: сдвиг от её места в сцене до
   * плитки ленты считается из настоящих прямоугольников, а не задаётся числом.
   * Без плитки (например, открыли из кода) она просто проявляется на месте.
   */
  scene.hidden = false;
  scene.classList.remove('is-in', 'is-out');
  const from = fromEl?.getBoundingClientRect();
  if (from && from.width) {
    const to = card.getBoundingClientRect();
    card.style.setProperty('--fx', `${(from.left + from.width / 2 - (to.left + to.width / 2)).toFixed(0)}px`);
    card.style.setProperty('--fy', `${(from.top + from.height / 2 - (to.top + to.height / 2)).toFixed(0)}px`);
    card.style.setProperty('--fs', (from.width / to.width).toFixed(3));
  } else {
    card.style.setProperty('--fx', '0px');
    card.style.setProperty('--fy', '40px');
    card.style.setProperty('--fs', '0.6');
  }
  void scene.offsetWidth;
  scene.classList.add('is-in');
  sndWhoosh(true);
  setTimeout(() => { if (!scene.hidden) sndChime(); }, FEED_SCENE_MS * 0.6);

  const close = () => {
    if (scene.classList.contains('is-out')) return;
    scene.classList.add('is-out');
    openBtn.onclick = null;
    closeBtn.onclick = null;
    scene.onclick = null;
    setTimeout(() => {
      scene.hidden = true;
      scene.classList.remove('is-in', 'is-out');
    }, FEED_SCENE_OUT_MS);
  };

  // Кнопки нет, если кейса в конфиге не нашлось: запись могла остаться в
  // ленте от версии, где такой кейс ещё был.
  openBtn.onclick = c ? () => { close(); openCase(c.id); } : null;
  closeBtn.onclick = () => { close(); haptic('light'); };
  // Закрывается нажатием мимо: по затемнению и пустому месту сцены.
  scene.onclick = (e) => {
    if (e.target.closest('.fsc-actions, .fsc-card, .fsc-info')) return;
    close();
  };
  haptic('light');
}

document.getElementById('feedTrack')?.addEventListener('click', (e) => {
  const card = e.target.closest('.feed-card');
  const drop = card && feedDrops.get(card.dataset.drop);
  if (drop) openFeedDrop(drop, card);
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
  // Пока лента стоит (открыт кейс), очередь растёт: держим только свежие,
  // старее того, что поместится в ленту, показывать всё равно незачем.
  if (feedQueue.length > FEED_MAX_CARDS) feedQueue.splice(0, feedQueue.length - FEED_MAX_CARDS);

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
      // Пока открыт кейс, лента стоит: на телефоне она живёт под ним, и
      // каждая новая плитка - раскладка и перерисовка посреди прокрута, из-за
      // которых лента кейса подвисала на остановке. Очередь ждёт.
      if (document.body.classList.contains('case-open')) return;
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
 * токен бота и выдаваемый кейс. Пока их нет, кнопки просто не существует -
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
    : info.needsTelegram ? 'привяжите Telegram и подпишитесь на канал' : 'за подписку на канал';
}

async function loadFreeCase() {
  if (!state.config?.freeCase?.enabled) return;
  try {
    renderFreeCase(await api('/api/free-case/state', null, { quiet: true }));
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
    renderFreeCase({ enabled: true, readyAt: res.readyAt });
    // Кейс уже выдан: сбой обновления баланса не повод показывать ошибку.
    api('/api/me').then((me) => applyUser(me.user)).catch(() => {});
  } catch (err) {
    toast(err.message);
    haptic('error');
    // Не подписан - открываем канал, чтобы не искать его руками.
    const url = state.config?.freeCase?.channelUrl;
    if (url && /подпиш/i.test(err.message)) {
      window.open(url, '_blank', 'noopener');
    }
    // Без Telegram подписку не проверить: ведём в профиль, где его привязывают.
    if (err.code === 'TG_REQUIRED') openAccount();
    btn.disabled = false;
  }
});

/* ============================================================
   ПРОМОКОДЫ
   ============================================================ */

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
  if (r.type === 'partner') {
    const parts = [`Кейс «${r.caseName}» в подарке и +${r.pct}% к первому пополнению`];
    if (r.minDeposit) parts.push(`от ${money(r.minDeposit)}`);
    if (r.maxBonus) parts.push(`не более ${money(r.maxBonus)}`);
    return parts.join(', ');
  }
  return 'Промокод применён';
}

/** Подарок по промокоду закрывается сам: ничто не ждёт нажатия вечно. */
const GIFT_SCENE_MS = 5200;

/**
 * Подарок: лента развязывается, крышка взлетает, из коробки бьёт свет и
 * выходит то, что дал код. Текст - тот же, что строка под полем: сцена не
 * обещает больше, чем начислено.
 */
function showGiftReveal(code, text) {
  const scene = document.createElement('div');
  scene.className = 'gift-scene';
  scene.innerHTML = `
    <div class="chest-dim"></div>
    <div class="chest-rays"></div>
    <div class="gift-body">
      <div class="gift">
        <svg viewBox="0 0 160 150" aria-hidden="true">
          <defs>
            <linearGradient id="gfBox" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#4a1d96"/></linearGradient>
            <linearGradient id="gfGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#e8a024"/><stop offset="1" stop-color="#ffd34d"/></linearGradient>
            <radialGradient id="gfLight" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".5" stop-color="#ffd34d" stop-opacity=".6"/><stop offset="1" stop-color="#ffd34d" stop-opacity="0"/></radialGradient>
          </defs>
          <ellipse class="gift-glow" cx="80" cy="66" rx="66" ry="36" fill="url(#gfLight)"/>
          <rect x="24" y="66" width="112" height="76" rx="8" fill="url(#gfBox)"/>
          <rect x="72" y="66" width="16" height="76" fill="url(#gfGold)"/>
          <g class="gift-lid">
            <rect x="16" y="46" width="128" height="24" rx="6" fill="url(#gfBox)" stroke="#2a0d55" stroke-width="2"/>
            <rect x="72" y="46" width="16" height="24" fill="url(#gfGold)"/>
            <g class="gift-bow">
              <path d="M80 46c-10-22-38-26-38-10 0 12 22 12 38 10z" fill="url(#gfGold)"/>
              <path d="M80 46c10-22 38-26 38-10 0 12-22 12-38 10z" fill="url(#gfGold)"/>
              <circle cx="80" cy="44" r="7" fill="#ffd34d"/>
            </g>
          </g>
        </svg>
      </div>
      <div class="chest-eyebrow">промокод ${esc(code)}</div>
      <div class="gift-text">${esc(text)}</div>
    </div>`;
  document.body.append(scene);
  requestAnimationFrame(() => scene.classList.add('is-in'));
  sndPurchase();
  setTimeout(() => {
    if (!scene.isConnected) return;
    const g = scene.querySelector('.gift').getBoundingClientRect();
    sparkBurst(scene, g.left + g.width / 2, g.top + g.height * 0.4,
      { n: 36, colors: ['#ffd34d', '#c9a8ff', '#fff6cf'], dist: [80, 200], size: 7 });
    sndChime();
    sndCollect();
  }, 900);
  const close = () => {
    if (!scene.isConnected) return;
    scene.classList.add('is-out');
    setTimeout(() => scene.remove(), 260);
  };
  scene.onclick = close;
  setTimeout(close, GIFT_SCENE_MS);
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

  // Партнёрская программа живёт в своём кабинете (/partners): здесь только
  // сводка, а коды, статистика и вывод - там.
  box.innerHTML = `
    <div class="partner-kpis">
      ${kpi('К выводу', money(d.balance.available), 'plus')}
      ${kpi('Начислено', money(d.balance.accrued), '', `доля ${d.share}%`)}
      ${kpi('Игроков', fmt(d.total.signups), '', `пополнили: ${fmt(d.total.ftd)}`)}
      ${kpi('Выплачено', money(d.balance.paid))}
    </div>
    <a class="btn btn-primary btn-wide" href="/partners/" target="_blank" rel="noopener">Открыть кабинет партнёра</a>
  `;
}

/* ============================================================
   АПГРЕЙД
   ============================================================ */

/**
 * Ставка против цели. Сектор выигрыша нарисован на кольце, стрелка
 * останавливается на угле roll * 360 градусов от верхней точки - то есть
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

/** Насечки по кругу - иначе кольцо выглядит пустым до первого прокрута. */
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
 * Формулы те же, что на сервере, - но результат раунда клиент всё равно
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

  arc.style.strokeDasharray = `${(data.chance * UPG_CIRC).toFixed(2)} ${UPG_CIRC.toFixed(2)}`;

  // Стрелка всегда крутится вперёд: копим абсолютный угол, а не задаём его
  // заново, иначе после второго прокрута она отматывала бы назад.
  const current = state.upgradeAngle || 0;
  const currentMod = ((current % 360) + 360) % 360;
  const wanted = data.fair.roll * 360;
  const delta = wanted - currentMod + (wanted < currentMod ? 360 : 0);
  state.upgradeAngle = current + UPG_TURNS * 360 + delta;

  // Ставка уходит с баланса сразу, итог приходит после остановки стрелки.
  previewBalance(state.user.balance - stake);
  const stage = document.getElementById('upgStage');
  stage.className = 'upg-stage is-charging';
  sndBet();
  sndRiser(UPG_CHARGE_MS / 1000);
  haptic('medium');
  await upgCharge(needle, current);

  stage.className = 'upg-stage is-spinning';
  sndSpinStart();
  await upgSpin(needle, current, state.upgradeAngle, stage);

  // Баланс показываем после остановки: раньше итог был виден в шапке до
  // того, как стрелка доехала.
  applyUser(data.user);
  if (data.won) {
    stage.className = 'upg-stage is-won';
    outcome.innerHTML = `<b>Апгрейд удался</b><span>забрали ${money(data.target)}</span>`;
    outcome.className = 'upg-outcome win';
    const box = stage.getBoundingClientRect();
    sparkBurst(stage, box.width / 2, box.height / 2,
      { n: 40, colors: ['#ffe58a', '#ffffff', '#ff2e8a', '#00f0ff'], dist: [80, 190], size: 7 });
    upgCountTo(stake, data.target);
    sndAceWin();
    sndCollect();
    haptic('success');
  } else {
    stage.className = 'upg-stage is-lost';
    outcome.innerHTML = '<b>Мимо сектора</b><span>ставка сгорела</span>';
    outcome.className = 'upg-outcome lose';
    stage.animate([{ translate: '0 0' }, { translate: '-7px 0' }, { translate: '6px 0' },
      { translate: '-3px 0' }, { translate: '0 0' }], { duration: 420, easing: 'ease-out' });
    sndBurn();
    haptic('error');
  }
  state.busy = false;
  btn.disabled = false;
  setTimeout(() => { if (!state.busy) renderUpgradeStage(); }, 1800);
});

/** Зарядка перед прокрутом. */
const UPG_CHARGE_MS = 800;

/** Прокрут стрелки. Последняя треть - замедленная съёмка. */
const UPG_SPIN_MS = 3800;

/** Длина шлейфа на полной скорости, градусов. */
const UPG_TRAIL_MAX = 140;

/**
 * Зарядка: стрелка дрожит на месте всё сильнее, кольцо разгорается. Исход
 * уже решён сервером; зарядка - это вдох перед прокрутом, а не расчёт.
 */
function upgCharge(needle, angle) {
  return new Promise((done) => {
    const t0 = performance.now();
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / UPG_CHARGE_MS);
      const shake = Math.sin(now / 22) * 4 * k;
      // Перед рывком стрелка чуть отходит назад, как пружина.
      needle.style.transform = `rotate(${(angle - 10 * k * k + shake).toFixed(3)}deg)`;
      if (k < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Прокрут с затуханием. Кривая - степень 4.2: стрелка срывается почти
 * мгновенно, а последние градусы ползёт; на этой части сцена приближается и
 * темнеет (класс is-slowmo), как стоп-кадр в кино. В конце в transform стоит
 * ровно итоговый угол: по нему тест сверяет стрелку с сектором.
 */
function upgSpin(needle, from, to, stage) {
  const trail = document.getElementById('upgTrail');
  const r = UPG_RADIUS;
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(130 + r * Math.sin(a)).toFixed(2)} ${(130 - r * Math.cos(a)).toFixed(2)}`;
  };
  return new Promise((done) => {
    const t0 = performance.now();
    let lastTick = Math.floor(from / 10);
    let prev = from;
    let slow = false;
    let beat = false;
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / UPG_SPIN_MS);
      const e = 1 - Math.pow(1 - k, 4.2);
      const angle = from + (to - from) * e;
      needle.style.transform = `rotate(${angle.toFixed(3)}deg)`;

      const speed = angle - prev;
      prev = angle;
      const len = Math.min(UPG_TRAIL_MAX, speed * 9);
      trail.setAttribute('d', len > 1.5
        ? `M${pt(angle - len)} A${r} ${r} 0 ${len > 180 ? 1 : 0} 1 ${pt(angle)}` : '');

      const tick = Math.floor(angle / 10);
      if (tick !== lastTick) { lastTick = tick; sndTick(1 + speed / 40); }

      if (!slow && to - angle < 40) { slow = true; stage.classList.add('is-slowmo'); }
      if (!beat && to - angle < 8) { beat = true; sndHeartbeat(); haptic('medium'); }

      if (k < 1) requestAnimationFrame(frame);
      else {
        needle.style.transform = `rotate(${to.toFixed(3)}deg)`;
        trail.setAttribute('d', '');
        done();
      }
    };
    requestAnimationFrame(frame);
  });
}

/** Счёт цели: сумма в центре кольца бежит от ставки до выигрыша. */
function upgCountTo(from, to) {
  const el = document.getElementById('upgTarget');
  const t0 = performance.now();
  const COUNT_MS = 900;
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / COUNT_MS);
    el.textContent = money(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

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
    text: 'Содержимое каждого кейса и стоимость каждого предмета показаны заранее. ' +
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
      'и должен сойтись до последнего знака. Раздел «Честность игры» в подвале сайта.',
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
        `Им играют, когда своих не хватает на ставку; после ставок бонусом на ×${rules.wager} от его суммы он переходит в деньги` +
        (rules.cashoutPct ? `, но не больше ${rules.cashoutPct}% от ваших пополнений. ` : '. ') +
        'Если у вас есть промокод, введите его во Free Money.';
    } else {
      title = 'Готово';
      text = 'Пополните счёт в кассе и открывайте кейсы. ' +
        'Промокод, если он есть, вводится во Free Money.';
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
   ВХОД НА САЙТ
   ============================================================
   Сайт открыт без входа: гость видит кейсы, казино, правила и ленту.
   Аккаунт спрашивается в момент, когда без него дальше нельзя: ставка,
   касса, промокод (api() ловит 401 и открывает это окно). Сессия живёт в
   httpOnly-cookie, клиент её не видит и не хранит. */

/*
 * Гость - пустой игрок той же формы, что присылает сервер: весь остальной
 * код читает state.user и не обязан знать про гостей. Баланс ноль, и
 * needMoney/openCashier по флагу state.guest ведут не в кассу, а ко входу.
 */
function guestUser() {
  return {
    id: 0, username: null, firstName: null, balance: 0, isAdmin: false,
    x2Perks: [], gambleStake: 0, gambleCase: null, vouchers: [],
    wagerRequired: 0, bonusBalance: 0, bonusCashoutLeft: 0, depositsCount: 0,
    isPartner: false,
    email: null, hasPassword: false, telegram: null,
    stats: { rounds: 0, spent: 0, won: 0, bestMultiplier: 0, profit: 0 },
    fair: { serverSeedHash: '', clientSeed: '', nonce: 0, prevServerSeed: null, prevServerHash: null },
  };
}

// Был ли на этом устройстве аккаунт: вернувшемуся первым показываем вход, а
// не регистрацию. Только удобство, при пустом хранилище всё работает так же.
const AUTH_SEEN_KEY = 'lb_had_account';
function authDefaultPane() {
  try { return localStorage.getItem(AUTH_SEEN_KEY) ? 'login' : 'register'; } catch { return 'register'; }
}

const AUTH_PANES = {
  // Вкладок сверху нет: переход между входом и регистрацией - строкой внизу
  // окна (switchTo), как привыкли по другим сайтам.
  login: { title: 'Вход', submit: 'Войти', fields: ['email', 'password'], forgot: true, telegram: true,
    switchTo: ['Нет аккаунта?', 'Зарегистрироваться', 'register'] },
  register: { title: 'Регистрация', submit: 'Создать аккаунт', fields: ['nick', 'email', 'password', 'promo', 'adult'], telegram: true,
    switchTo: ['Уже зарегистрированы?', 'Войти', 'login'] },
  forgot: { title: 'Восстановление пароля', submit: 'Прислать ссылку', fields: ['email'],
    switchTo: ['Вспомнили пароль?', 'Войти', 'login'] },
  reset: { title: 'Новый пароль', submit: 'Сохранить и войти', fields: ['password'] },
  password: { title: 'Пароль', submit: 'Сохранить', fields: ['password'] },
  account: { title: 'Профиль' },
};

const authUi = { pane: 'login', resetToken: '', busy: false };

function authEl(id) { return document.getElementById(id); }

function authFail(message) {
  const box = authEl('authError');
  box.textContent = message;
  box.hidden = !message;
}

function openAuth(pane = 'login') {
  closeMenu();
  showAuthPane(pane);
  authEl('authBackdrop').hidden = false;
  // Фокус в первое поле: на компьютере сразу печатают, не ища мышью.
  const first = authEl('authForm').querySelector('[data-auth-field]:not([hidden]) input');
  if (first && matchMedia('(min-width: 1024px)').matches) first.focus();
}

function closeAuth() {
  authEl('authBackdrop').hidden = true;
  authFail('');
}

function showAuthPane(pane) {
  authUi.pane = pane;
  const def = AUTH_PANES[pane];
  const user = state.user;
  const isAccount = pane === 'account';

  authEl('authTitle').textContent = def.title;
  authEl('authTabs').hidden = !def.tabs;
  document.querySelectorAll('[data-auth-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.authTab === pane);
  });

  // Смена пароля: у кого пароль уже есть, спрашиваем текущий; у пришедшего
  // через Telegram пароля нет, и вместо него он задаёт почту для входа.
  let fields = def.fields || [];
  if (pane === 'password') {
    fields = user?.hasPassword ? ['current', 'password'] : ['email', 'password'];
    authEl('authTitle').textContent = user?.hasPassword ? 'Смена пароля' : 'Вход по почте';
  }
  authEl('authForm').hidden = isAccount;
  document.querySelectorAll('[data-auth-field]').forEach((el) => {
    el.hidden = !fields.includes(el.dataset.authField);
  });
  authEl('authPasswordLabel').textContent = pane === 'login' || pane === 'register' ? 'Пароль' : 'Новый пароль';
  authEl('authPassword').autocomplete = pane === 'login' ? 'current-password' : 'new-password';
  authEl('authSubmit').textContent = pane === 'password' && !user?.hasPassword ? 'Сохранить' : (def.submit || '');
  authEl('authForgot').hidden = !def.forgot;
  const sw = authEl('authSwitch');
  sw.hidden = !def.switchTo;
  if (def.switchTo) {
    const [text, action, target] = def.switchTo;
    sw.innerHTML = `${esc(text)} <button type="button" class="auth-switch-go">${esc(action)}</button>`;
    sw.querySelector('button').onclick = () => showAuthPane(target);
  }
  authFail('');

  const note = authEl('authNote');
  note.hidden = true;
  if (pane === 'forgot') {
    note.hidden = false;
    note.textContent = state.config?.auth?.mail
      ? 'Пришлём на почту ссылку для нового пароля. Она действует час.'
      : 'Восстановление по почте пока недоступно. Напишите в поддержку, поможем вернуть доступ.';
  }

  const bot = state.config?.auth?.telegramBot;
  authEl('authOr').hidden = !(def.telegram && bot);
  authEl('authTelegram').hidden = !(def.telegram && bot);
  if (def.telegram && bot) mountTelegramWidget(authEl('authTelegram'), 'login');

  authEl('authAccount').hidden = !isAccount;
  if (isAccount) renderAccount();
}

/*
 * Официальный виджет Telegram Login. Он рисует свою кнопку в iframe и
 * вызывает глобальную функцию с подписанными данными; подпись сервер
 * проверяет токеном бота. request-access=write нужен боту: без разрешения
 * писать первым он не смог бы напомнить о фриспинах.
 *
 * Работает только на домене, который указан боту в @BotFather (/setdomain).
 */
function mountTelegramWidget(box, mode) {
  const bot = state.config?.auth?.telegramBot;
  if (!bot) return;
  window.lbTelegramAuth = (data) => onTelegramAuth(data, mode);
  if (box.dataset.mounted === bot) return;
  box.innerHTML = '';
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.dataset.telegramLogin = bot;
  script.dataset.size = 'large';
  script.dataset.radius = '12';
  script.dataset.requestAccess = 'write';
  script.dataset.onauth = 'lbTelegramAuth(user)';
  box.appendChild(script);
  box.dataset.mounted = bot;
}

async function onTelegramAuth(data, mode) {
  try {
    const res = await api(mode === 'link' ? '/api/auth/link-telegram' : '/api/auth/telegram', { data });
    if (mode === 'link') {
      applyUser(res.user);
      toast('Telegram привязан');
      haptic('success');
      showAuthPane('account');
      loadFreeCase();
      return;
    }
    signedIn(res.user, res.created);
  } catch (err) {
    authFail(err.message);
    haptic('error');
  }
}

function renderAccount() {
  const u = state.user || {};
  authEl('accNick').textContent = u.firstName || u.username || '-';
  authEl('accEmail').textContent = u.email || 'не задана';
  authEl('accTelegram').textContent = u.telegram
    ? (u.telegram.username ? `@${u.telegram.username}` : 'привязан') : 'не привязан';
  const bot = state.config?.auth?.telegramBot;
  const canLink = !u.telegram && !!bot;
  authEl('accTgHint').hidden = !canLink;
  authEl('accTelegramWidget').hidden = !canLink;
  if (canLink) mountTelegramWidget(authEl('accTelegramWidget'), 'link');
  authEl('accPassword').textContent = u.hasPassword ? 'Сменить пароль' : 'Входить по почте и паролю';
}

function openAccount() {
  if (state.guest) return openAuth(authDefaultPane());
  openAuth('account');
}

/** Шапка: гостю - «Войти» и «Регистрация», игроку - баланс и профиль. */
function renderAuthChrome() {
  const guest = !!state.guest;
  authEl('topAuth').hidden = !guest;
  authEl('accountBtn').hidden = guest;
  authEl('balanceChip').hidden = guest;
  authEl('topDeposit').hidden = guest;
  document.body.classList.toggle('is-guest', guest);
}

/** Сразу после входа: то, что гостю не запускалось. */
function signedIn(user, created = false) {
  const wasGuest = state.guest;
  state.guest = false;
  try { localStorage.setItem(AUTH_SEEN_KEY, '1'); } catch { /* приватное окно */ }
  closeAuth();
  applyUser(user);
  renderFair();
  renderAuthChrome();
  haptic('success');
  toast(created ? 'Аккаунт создан. Добро пожаловать!' : 'Вы вошли');
  if (wasGuest) {
    startPaymentEvents();
    loadFreeCase();
    startOnboarding();
  }
  openAdminEntry();
}

/*
 * Скрытый вход в панель: адрес /admin. В боковом меню компьютера админки нет
 * по решению заказчика, а меню телефона там не открыть, поэтому вход с
 * компьютера - только по адресу. Сайт под ним тот же, панель открывается
 * поверх. Не сотруднику адрес ничего не показывает: возвращаем на главную.
 */
const ADMIN_PATH = '/admin';

function wantsAdmin() {
  return location.pathname.replace(/\/+$/, '') === ADMIN_PATH;
}

function openAdminEntry() {
  if (!wantsAdmin() || state.guest) return;
  if (state.user?.isAdmin) { switchView('admin'); return; }
  history.replaceState(null, '', '/' + location.search);
  toast('Нет доступа к панели');
}

async function submitAuth(event) {
  event.preventDefault();
  if (authUi.busy) return;
  const v = (id) => authEl(id).value;
  const pane = authUi.pane;
  authFail('');

  if (pane === 'register' && !authEl('authAdult').checked) {
    authFail('Подтвердите, что вам есть 18 лет');
    return;
  }

  authUi.busy = true;
  authEl('authSubmit').disabled = true;
  try {
    if (pane === 'login') {
      const res = await api('/api/auth/login', { email: v('authEmail'), password: v('authPassword') });
      signedIn(res.user);
    } else if (pane === 'register') {
      const promo = v('authPromo').trim();
      const res = await api('/api/auth/register', {
        email: v('authEmail'), password: v('authPassword'), nick: v('authNick'), promo,
      });
      signedIn(res.user, true);
      // Подарок по коду показываем той же сценой, что была у поля промокода:
      // текст - ровно то, что начислено.
      if (res.promo) setTimeout(() => showGiftReveal(promo.toUpperCase(), promoResultText(res.promo)), 600);
      // Код партнёра своё отработал: следующий аккаунт на этом устройстве
      // по нему уже не придёт.
      try { localStorage.removeItem(REF_PROMO_KEY); } catch { /* хранилище закрыто */ }
    } else if (pane === 'forgot') {
      if (!state.config?.auth?.mail) { openSupport(); return; }
      const res = await api('/api/auth/forgot', { email: v('authEmail') });
      const note = authEl('authNote');
      note.textContent = res.message;
      note.hidden = false;
    } else if (pane === 'reset') {
      const res = await api('/api/auth/reset', { token: authUi.resetToken, password: v('authPassword') });
      authUi.resetToken = '';
      signedIn(res.user);
    } else if (pane === 'password') {
      const res = await api('/api/auth/password', {
        current: v('authCurrent'), password: v('authPassword'), email: v('authEmail'),
      });
      applyUser(res.user);
      toast('Сохранено');
      showAuthPane('account');
    }
    authEl('authPassword').value = '';
    authEl('authCurrent').value = '';
  } catch (err) {
    authFail(err.message);
    haptic('error');
  } finally {
    authUi.busy = false;
    authEl('authSubmit').disabled = false;
  }
}

function wireAuth() {
  document.getElementById('fmBack')?.addEventListener('click', () => { haptic('light'); switchView('cases'); });
  authEl('authForm').addEventListener('submit', submitAuth);
  authEl('authClose').addEventListener('click', closeAuth);
  authEl('authBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'authBackdrop') closeAuth();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !authEl('authBackdrop').hidden) closeAuth();
  });
  document.querySelectorAll('[data-auth-tab]').forEach((b) => {
    b.addEventListener('click', () => showAuthPane(b.dataset.authTab));
  });
  document.querySelectorAll('[data-auth-open]').forEach((b) => {
    b.addEventListener('click', () => openAuth(b.dataset.authOpen));
  });
  authEl('authForgot').addEventListener('click', () => showAuthPane('forgot'));
  authEl('authEye').addEventListener('click', () => {
    const input = authEl('authPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  authEl('authForm').querySelectorAll('[data-doc]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); openDoc(a.dataset.doc); });
  });
  authEl('accountBtn').addEventListener('click', openAccount);
  authEl('accPassword').addEventListener('click', () => showAuthPane('password'));
  authEl('accLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout'); } catch { /* cookie уйдёт и так */ }
    // Перезагрузка, а не перерисовка: после выхода в памяти не должно
    // остаться ничего от прежнего игрока - ни истории, ни открытой кассы.
    location.reload();
  });
}

/*
 * Ссылка из письма сброса: /?reset=<токен>. Токен убираем из адресной
 * строки сразу, чтобы он не остался в истории браузера и не ушёл в Referer.
 */
function takeResetToken() {
  const params = new URLSearchParams(location.search);
  const token = params.get('reset');
  if (!token) return '';
  params.delete('reset');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  return token;
}

/** Текущий игрок или null, если не вошёл. Окно входа здесь не открывается. */
async function loadMe() {
  try {
    return (await api('/api/me', null, { quiet: true })).user;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

/* ============================================================
   НАВИГАЦИЯ И СТАРТ
   ============================================================ */

/*
 * Ссылка партнёра: /?promo=КОД (кабинет /partners). Код запоминается на
 * устройстве и подставляется в поле регистрации: гость мог сначала
 * походить по сайту и зарегистрироваться позже. Из адресной строки код
 * убирается, чтобы ссылку, скопированную игроком дальше, не приписали
 * партнёру повторно. Хранилище - только удобство: без него код всё равно
 * стоит в поле в этом заходе.
 */
const REF_PROMO_KEY = 'lb_ref_promo';
/*
 * Ссылка из бота с дневным кодом: /?wheel=КОД. Открывает Free Money на
 * Колесе удачи с уже подставленным кодом: из рассылки в один шаг до SPIN.
 * Код убирается из адреса сразу, как и промокод партнёра.
 */
function takeWheelLink() {
  let code = '';
  try {
    const url = new URL(location.href);
    code = (url.searchParams.get('wheel') || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (url.searchParams.has('wheel')) {
      url.searchParams.delete('wheel');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch { /* адрес без параметров */ }
  return code;
}

function openWheelWithCode(code) {
  if (!code || !viewOpen('freemoney')) return;
  switchView('freemoney');
  // Раздел дорисовывается после переключения: ждём, пока поле появится.
  requestAnimationFrame(() => setTimeout(() => {
    const input = document.getElementById('pwCode');
    if (input) input.value = code;
    setWheelCode(code, { quiet: true });
    const el = document.getElementById('fmWheel');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - fmStickyBottom() - FM_TAB_GAP });
  }, WHEEL_LINK_DELAY_MS));
}

/** Сколько ждать отрисовки Free Money перед подстановкой кода из ссылки. */
const WHEEL_LINK_DELAY_MS = 350;

function takeReferralPromo() {
  let code = '';
  let fresh = false;
  try {
    const url = new URL(location.href);
    code = (url.searchParams.get('promo') || '').trim().slice(0, 32);
    fresh = !!code;
    if (code) {
      url.searchParams.delete('promo');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch { /* адрес без параметров */ }
  try {
    if (code) localStorage.setItem(REF_PROMO_KEY, code);
    else code = localStorage.getItem(REF_PROMO_KEY) || '';
  } catch { /* хранилище закрыто */ }
  if (code) document.getElementById('authPromo').value = code;
  return { code, fresh };
}

/*
 * Обложки полок грузятся лениво, и при быстрой прокрутке плитки стояли
 * пустыми: ленивая загрузка начинает тянуть картинку, только когда та
 * подъезжает к экрану. Поэтому, когда первый экран уже показан, остальные
 * обложки подгружаются фоном, по нескольку за раз, чтобы не отнимать канал у
 * того, что игрок открывает прямо сейчас. С включённой экономией трафика
 * не подгружаем: там ленивая загрузка и есть то, чего человек хочет.
 */
const COVER_WARM_DELAY_MS = 1500;
const COVER_WARM_BATCH = 3;
const COVER_WARM_STEP_MS = 350;
function warmShelfCovers() {
  if (navigator.connection?.saveData) return;
  const step = () => {
    const rest = [...document.querySelectorAll('.cover-art[loading="lazy"]')];
    rest.slice(0, COVER_WARM_BATCH).forEach((img) => { img.loading = 'eager'; });
    if (rest.length > COVER_WARM_BATCH) setTimeout(step, COVER_WARM_STEP_MS);
  };
  setTimeout(step, COVER_WARM_DELAY_MS);
}

async function init() {
  mountIcons();
  buildMoneyRain();
  buildFooter();
  // Баннеры лежат в разметке и от сервера не зависят: крутим их сразу, не
  // дожидаясь конфига. Иначе первые секунды на экране висит неподвижный кадр.
  runHeroSlider();
  runHeroSlider('czHero', 'czHeroDots');
  wireFortune();


  wireAuth();

  try {
    const [config, me] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      loadMe(),
    ]);

    state.config = config;
    state.guest = !me;
    const user = me || guestUser();
    state.user = user;
    renderAuthChrome();
    renderColorPicker();
    renderRouletteWheel();
    applyUser(user);
    renderFair();

    wireBetPanel('crashBet', 'data-crash-add', 'data-crash-bet');
    wireBetPanel('rouletteBet', 'data-roul-add', 'data-roul-bet');
    wireBetPanel('upgStake', 'data-upg-add', 'data-upg-bet');

    // Цель пересчитывается на лету - иначе игрок жмёт «Апгрейд», не увидев,
    // за что играет.
    document.getElementById('upgStake').addEventListener('input', () => {
    if (!state.busy) renderUpgradeStage();
  });
    renderUpgradeTicks();
    renderUpgradePicker();
    renderUpgradeStage();

    startFeed();
    warmShelfCovers();
    authUi.resetToken = takeResetToken();
    const refPromo = takeReferralPromo();
    if (authUi.resetToken) {
      openAuth('reset');
    } else if (state.guest && refPromo.fresh) {
      // Пришёл по ссылке партнёра - сразу регистрация с его кодом.
      openAuth('register');
    } else if (state.guest && wantsAdmin()) {
      openAuth('login');
    } else if (!state.guest) {
      startPaymentEvents();
      loadFreeCase();
      startOnboarding();
      openAdminEntry();
    }
    // Гостю тоже: колесо он увидит с кодом, а вход спросят на SPIN.
    openWheelWithCode(takeWheelLink());
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">Не удалось загрузить приложение.<br>${esc(err.message)}</div>`;
  }
}

init();


/* ============================================================
   КОЛЕСО ФОРТУНЫ
   ============================================================ */

/** Середина сектора в градусах: ноль - указатель на трёх часах, дальше по часовой. */
function fortuneSegmentCenter(index) {
  const { startDeg, segmentDeg } = state.fortune.data.wheel;
  return startDeg + segmentDeg * index + segmentDeg / 2;
}

/* ---------- Рисунок колеса ----------
 *
 * Колесо нарисовано разметкой, а не присланной картинкой (заказчик:
 * «задумка классная, исполнено ужасно»). Геометрия секторов приходит с
 * сервера (state.fortune.data.wheel), поэтому стрелка по-прежнему
 * останавливается ровно на том, что показало окно выигрыша: рисунок и
 * розыгрыш читают одно и то же описание. FORTUNE_WHEEL_FALLBACK - только для
 * первой отрисовки, пока описание не приехало (и для гостя, которому сервер
 * его не отдаёт); порядок тот же, что в server/fortune.js.
 *
 * Свет сверху слева, как у остальных рисунков проекта: блик-купол поверх
 * колеса НЕ вращается вместе с ним (.fortune-gloss), иначе стекло крутилось
 * бы вместе с секторами. Вечных анимаций нет: лампы бегут только во время
 * прокрута (класс is-spinning), раздел Free Money уже падал на iPhone.
 */
const FORTUNE_WHEEL_FALLBACK = {
  startDeg: -7,
  segmentDeg: 40,
  segments: ['case', 'case', 'case', 'case', 'x2', 'percent', 'cash', 'voucher', 'voucher']
    .map((type, index) => ({ index, type })),
};

/** Радиус секторов в координатах рисунка (-50..50). Обод снаружи. */
const LF_SECTOR_R = 40;

/** Ламп на ободе: по две на сектор - на границе и посередине. */
const LF_LAMPS_PER_SECTOR = 2;

/*
 * Цвета секторов: светлый у обода, насыщенный посередине, тёмный у центра.
 * Сектора одного вида различаются цветом (четыре кейса - четыре камня), а
 * соседи никогда не совпадают по тону. Самый редкий приз (деньги) - золото.
 */
const LF_TONES = {
  case: [['#ff8aa6', '#e0285a', '#5c0624'], ['#7ff5c4', '#15b07a', '#05432e'],
    ['#8fd0ff', '#2a6fe0', '#0b2466'], ['#ffd27a', '#e5801a', '#6b2c04']],
  x2: [['#bdb8ff', '#5d4ff2', '#1d137a']],
  percent: [['#ffa6e8', '#d8309f', '#5e0a4c']],
  cash: [['#fff3b8', '#f2b52c', '#6e3f04']],
  voucher: [['#8ef5ea', '#16a5a8', '#06474f'], ['#e2b2ff', '#9142e6', '#34106b']],
};

let lfSeq = 0;

function fortuneWheelSpec() {
  const w = state.fortune.data?.wheel;
  return w?.segments?.length ? w : FORTUNE_WHEEL_FALLBACK;
}

/** Рисунок приза в секторе. Верх рисунка смотрит на обод. */
function lfPrizeArt(type, tone, id, prizes) {
  const [light, mid, dark] = tone;
  if (type === 'case') {
    return `<g>
      <ellipse cx="0" cy="8.6" rx="8.5" ry="1.6" fill="#000" opacity="0.35"/>
      <rect x="-8.2" y="-1.8" width="16.4" height="9.6" rx="1.6" fill="${dark}" stroke="#2a1000" stroke-width="0.5"/>
      <rect x="-8.2" y="-1.8" width="16.4" height="4.2" rx="1.6" fill="${mid}" opacity="0.55"/>
      <path d="M-8.2 -1.4 V-4.6 Q-8.2 -9.6 0 -9.6 Q8.2 -9.6 8.2 -4.6 V-1.4 Z" fill="${mid}" stroke="#2a1000" stroke-width="0.5"/>
      <path d="M-6.6 -5 Q-6 -8.4 0 -8.5 Q3 -8.5 4.6 -7.6" fill="none" stroke="${light}" stroke-width="1" stroke-linecap="round" opacity="0.9"/>
      <rect x="-6.3" y="-9.2" width="1.7" height="17" fill="url(#${id}g)"/>
      <rect x="4.6" y="-9.2" width="1.7" height="17" fill="url(#${id}g)"/>
      <rect x="-8.6" y="-2.4" width="17.2" height="1.5" rx="0.6" fill="url(#${id}g)"/>
      <rect x="-1.8" y="-3.6" width="3.6" height="4.4" rx="0.8" fill="url(#${id}g)" stroke="#5a2a00" stroke-width="0.35"/>
      <circle cx="0" cy="-1.9" r="0.55" fill="#3a1500"/>
    </g>`;
  }
  if (type === 'x2' || type === 'percent') {
    const text = type === 'x2' ? '×2' : '+%';
    return `<text x="0" y="1" text-anchor="middle" dominant-baseline="middle"
      font-family="Unbounded, Manrope, sans-serif" font-weight="900" font-size="${type === 'x2' ? 11.5 : 10.5}"
      fill="url(#${id}g)" stroke="#2b0d00" stroke-width="1.1" paint-order="stroke"
      letter-spacing="-0.4">${text}</text>
      <text x="-0.6" y="0.2" text-anchor="middle" dominant-baseline="middle"
      font-family="Unbounded, Manrope, sans-serif" font-weight="900" font-size="${type === 'x2' ? 11.5 : 10.5}"
      fill="none" stroke="#fff" stroke-width="0.25" opacity="0.6" letter-spacing="-0.4">${text}</text>`;
  }
  if (type === 'cash') {
    const coin = (y) => `<ellipse cx="0" cy="${y + 1}" rx="6.4" ry="2.4" fill="#8a4a05"/>
      <ellipse cx="0" cy="${y}" rx="6.4" ry="2.4" fill="url(#${id}g)" stroke="#6b3a02" stroke-width="0.35"/>`;
    return `<g>
      <ellipse cx="0" cy="8.4" rx="7.5" ry="1.5" fill="#000" opacity="0.35"/>
      ${coin(5)}${coin(2.2)}${coin(-0.6)}
      <text x="0" y="-0.5" text-anchor="middle" dominant-baseline="middle" font-family="Manrope, sans-serif"
        font-weight="900" font-size="3.4" fill="#7a3f00">₽</text>
      <text x="0" y="-6.4" text-anchor="middle" dominant-baseline="middle"
        font-family="Unbounded, Manrope, sans-serif" font-weight="900" font-size="4.6"
        fill="#fff" stroke="#3a1800" stroke-width="0.7" paint-order="stroke">${fmt(prizes?.cash || 2000)}</text>
    </g>`;
  }
  // Ваучер: золотой билет с выемками по бокам.
  return `<g transform="rotate(-8)">
    <ellipse cx="0" cy="7.4" rx="8" ry="1.4" fill="#000" opacity="0.3"/>
    <path d="M-9 -5 H9 V-1.6 A1.6 1.6 0 0 0 9 1.6 V5 H-9 V1.6 A1.6 1.6 0 0 0 -9 -1.6 Z"
      fill="url(#${id}g)" stroke="#5a2a00" stroke-width="0.45"/>
    <rect x="-7.4" y="-3.5" width="14.8" height="7" rx="0.8" fill="none" stroke="#8a4a05" stroke-width="0.35" stroke-dasharray="0.9 0.6"/>
    <text x="0" y="0.3" text-anchor="middle" dominant-baseline="middle" font-family="Unbounded, Manrope, sans-serif"
      font-weight="900" font-size="3.5" fill="#5a2600" letter-spacing="0.2">LUCKY</text>
    <path d="M-8 -4.2 H8" stroke="#fff" stroke-width="0.5" opacity="0.55"/>
  </g>`;
}

/** Колесо целиком: сектора, разделители, призы, обод с лампами. */
function fortuneWheelMarkup() {
  const { startDeg, segmentDeg, segments } = fortuneWheelSpec();
  const prizes = state.fortune.data?.prizes;
  const id = `lf${++lfSeq}`;
  const rad = (d) => (d * Math.PI) / 180;
  const pt = (d, r) => `${(Math.cos(rad(d)) * r).toFixed(2)} ${(Math.sin(rad(d)) * r).toFixed(2)}`;
  const seen = {};
  const defs = [];
  const parts = [];

  segments.forEach((seg, i) => {
    const tones = LF_TONES[seg.type] || LF_TONES.percent;
    const tone = tones[(seen[seg.type] = (seen[seg.type] ?? -1) + 1) % tones.length];
    const a0 = startDeg + segmentDeg * i;
    const a1 = a0 + segmentDeg;
    const mid = a0 + segmentDeg / 2;
    defs.push(`<radialGradient id="${id}s${i}" cx="0" cy="0" r="${LF_SECTOR_R}" gradientUnits="userSpaceOnUse">
      <stop offset="0.15" stop-color="${tone[2]}"/><stop offset="0.72" stop-color="${tone[1]}"/>
      <stop offset="1" stop-color="${tone[0]}"/></radialGradient>`);
    parts.push(`<path class="lf-sec" d="M0 0 L${pt(a0, LF_SECTOR_R)} A${LF_SECTOR_R} ${LF_SECTOR_R} 0 0 1 ${pt(a1, LF_SECTOR_R)} Z" fill="url(#${id}s${i})"/>`);
    // Светлая кромка у обода: сектор читается выпуклым, а не плоской долькой.
    parts.push(`<path d="M${pt(a0 + 1.5, LF_SECTOR_R - 1.4)} A${LF_SECTOR_R - 1.4} ${LF_SECTOR_R - 1.4} 0 0 1 ${pt(a1 - 1.5, LF_SECTOR_R - 1.4)}"
      fill="none" stroke="${tone[0]}" stroke-width="1.1" opacity="0.7"/>`);
    const [x, y] = pt(mid, 26.5).split(' ');
    parts.push(`<g transform="translate(${x} ${y}) rotate(${mid + 90})">${lfPrizeArt(seg.type, tone, id, prizes)}</g>`);
  });

  // Разделители: золотые спицы с заклёпкой у обода.
  const spokes = segments.map((_, i) => {
    const a = startDeg + segmentDeg * i;
    return `<path d="M${pt(a, 11)} L${pt(a, LF_SECTOR_R)}" stroke="url(#${id}g)" stroke-width="1"/>
      <circle cx="${pt(a, LF_SECTOR_R - 2.6).split(' ')[0]}" cy="${pt(a, LF_SECTOR_R - 2.6).split(' ')[1]}" r="0.95" fill="url(#${id}g)" stroke="#5a2a00" stroke-width="0.25"/>`;
  }).join('');

  const lampCount = segments.length * LF_LAMPS_PER_SECTOR;
  const lamps = Array.from({ length: lampCount }, (_, i) => {
    const [x, y] = pt(startDeg + (segmentDeg / LF_LAMPS_PER_SECTOR) * i, 44.4).split(' ');
    return `<g class="lf-lamp lf-lamp-${i % 2}"><circle cx="${x}" cy="${y}" r="2.5" fill="#ffd34d" opacity="0.22"/>
      <circle cx="${x}" cy="${y}" r="1.45" fill="url(#${id}l)"/></g>`;
  }).join('');

  return `<defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff6c4"/><stop offset="0.45" stop-color="#ffcf45"/><stop offset="1" stop-color="#b8700c"/></linearGradient>
      <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff2b8"/><stop offset="0.25" stop-color="#f2b53a"/><stop offset="0.5" stop-color="#8a4d0a"/>
        <stop offset="0.72" stop-color="#ffd76a"/><stop offset="1" stop-color="#7a3f06"/></linearGradient>
      <radialGradient id="${id}l" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#fff0a0"/><stop offset="1" stop-color="#ff9d00"/></radialGradient>
      ${defs.join('')}
    </defs>
    <circle r="49.4" fill="#1a0726"/>
    ${parts.join('')}
    <circle r="${LF_SECTOR_R}" fill="none" stroke="#2a0d00" stroke-width="0.9"/>
    ${spokes}
    <circle r="44.5" fill="none" stroke="url(#${id}r)" stroke-width="8.6"/>
    <circle r="48.7" fill="none" stroke="#3d1d00" stroke-width="0.6"/>
    <circle r="47.9" fill="none" stroke="#fff" stroke-width="0.35" opacity="0.4"/>
    <circle r="40.9" fill="none" stroke="#fff4c2" stroke-width="0.3" opacity="0.5"/>
    ${lamps}`;
}

/** Колесо на сцене и его уменьшенная копия на витрине. */
function renderFortuneArt() {
  const wheel = document.getElementById('fortuneWheel');
  if (wheel && !state.fortune.busy) wheel.innerHTML = fortuneWheelMarkup();
  for (const id of ['fortuneMini', 'fortuneStepsWheel']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = fortuneWheelMarkup();
  }
  const p = state.fortune.data?.prizes;
  const cash = document.getElementById('fortuneCashChip');
  if (cash) cash.textContent = money(p?.cash || 2000);
  const voucher = document.getElementById('fortuneVoucherChip');
  if (voucher) voucher.textContent = `Ваучер до ${money(p?.voucherMax || 1500)}`;
}

async function loadFortune() {
  try {
    state.fortune.data = await api('/api/fortune/state', null, { quiet: true });
  } catch {
    // Колесо необязательно: ивент просто останется на витрине.
    return;
  }
  renderFortuneArt();
  renderFortuneStatus();
  renderFortuneLog();
}

/** Подпись под колесом: сколько прокрутов и когда следующий. */
function renderFortuneStatus() {
  const el = document.getElementById('fortuneStatus');
  const d = state.fortune.data;
  if (!el || !d) return;

  const spinBtn = document.getElementById('fortuneSpin');
  /*
   * Кнопка выключается ТОЛЬКО на время самого прокрута.
   *
   * Когда прокрутов нет, она обязана остаться нажимаемой: именно нажатие
   * открывает окно с шагами, где написано, что делать дальше. Выключенная
   * кнопка вместо этого просто молчала бы, и игрок не узнал бы, как получить
   * ещё прокруты. Недоступность показывает класс, а не атрибут.
   */
  spinBtn.disabled = state.fortune.busy;
  spinBtn.classList.toggle('locked', !d.canSpin);

  if (d.spinsLeft <= 0) {
    el.innerHTML = '<span class="fortune-status-main">Прокруты кончились</span>'
      + `<span class="fortune-status-sub">Пополните счёт от ${money(d.minDeposit)}, `
      + `чтобы получить ещё ${d.spinsPerCycle}</span>`;
    return;
  }
  if (!d.canSpin && d.readyAt) {
    el.innerHTML = '<span class="fortune-status-main">Следующий прокрут через '
      + esc(untilText(d.readyAt)) + '</span>'
      + `<span class="fortune-status-sub">Осталось прокрутов: ${d.spinsLeft}</span>`;
    return;
  }
  el.innerHTML = '<span class="fortune-status-main">Прокрут доступен</span>'
    + `<span class="fortune-status-sub">Осталось: ${d.spinsLeft} из ${d.spinsPerCycle}, `
    + 'по одному в сутки</span>';
}

/** «через 7 ч 20 мин» - без секунд: они всё равно не тикают на этом экране. */
function untilText(ts) {
  const left = Math.max(0, ts - Date.now());
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${Math.max(1, m)} мин`;
}

function renderFortuneLog() {
  const el = document.getElementById('fortuneLog');
  const rows = state.fortune.data?.history || [];
  if (!el) return;

  if (!rows.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<h3 class="fortune-log-head">Ваши призы</h3>'
    + rows.map((r) => `<div class="fortune-log-row">
        <span class="fortune-log-kind">${esc(fortunePrizeTitle(r))}</span>
        <span class="fortune-log-date">${new Date(r.created_at).toLocaleDateString('ru-RU')}</span>
      </div>`).join('');
}

/** Короткое название приза одной строкой: и для журнала, и для окна выигрыша. */
function fortunePrizeTitle(prize) {
  if (prize.kind === 'percent') return `+${prize.amount}% к пополнению`;
  if (prize.kind === 'x2') return 'Удвоитель ×2';
  if (prize.kind === 'case') {
    const id = prize.caseId || prize.case_id;
    const c = state.config?.cases.find((x) => x.id === id);
    return c ? `Кейс «${c.name}» в подарок` : 'Кейс в подарок';
  }
  if (prize.kind === 'voucher') return `Ваучер ${money(prize.amount)} на бонусный счёт`;
  if (prize.kind === 'cash') return `${money(prize.amount)} на бонусный счёт`;
  return 'Приз';
}

/**
 * Окно «Выполните 2 шага».
 *
 * Показывается, когда крутить нельзя по существу: не пополнял или цикл
 * израсходован. Простое ожидание суток сюда не относится - там всё ясно из
 * подписи под колесом, и окно было бы лишним хлопком по рукам.
 */
function showFortuneSteps() {
  const d = state.fortune.data;
  if (!d) return;

  const s1 = document.getElementById('fortuneStep1');
  const s2 = document.getElementById('fortuneStep2');

  // Первый шаг: регистрация на сайте. Гостю колесо не загружается вовсе
  // (fortune/state требует входа), поэтому красным он почти не горит.
  setFortuneStep(s1, d.registered, 'Выполнено', 'Не выполнено');

  const cycleDone = d.deposited && d.spinsLeft <= 0;
  document.getElementById('fortuneStep2Name').innerHTML =
    `Пополнить счёт на сумму от <b>${money(d.minDeposit)}</b>`;
  document.getElementById('fortuneStep2Note').textContent = cycleDone
    ? `Прокруты этого цикла закончились. Новое пополнение от ${money(d.minDeposit)} `
      + `откроет ещё ${d.spinsPerCycle}.`
    : `Внесите депозит от ${money(d.minDeposit)} и крутите Колесо фортуны `
      + `1 раз в сутки в течение ${d.spinsPerCycle} дней.`;
  setFortuneStep(s2, d.spinsLeft > 0, 'Выполнено', 'Не выполнено');

  document.getElementById('fortuneStepsGo').textContent =
    d.spinsLeft > 0 ? 'К колесу' : 'Пополнить счёт';

  renderFortuneArt();
  document.getElementById('fortuneStepsBackdrop').hidden = false;
}

function setFortuneStep(el, done, okText, badText) {
  el.classList.toggle('done', done);
  el.classList.toggle('todo', !done);
  el.querySelector('.fortune-step-flag').textContent = done ? okText : badText;
  el.querySelector('.fortune-step-mark').textContent = done ? '✓' : el.dataset.no || '2';
}

/** Прокрут: сервер решает приз, колесо лишь доезжает до нужного сектора. */
async function spinFortune() {
  // Гостю колесо не крутится - предлагаем вход, а не молчим.
  if (state.guest) { openAuth(authDefaultPane()); return; }
  if (state.fortune.busy || !state.fortune.data) return;
  if (!state.fortune.data.canSpin) {
    // Сутки ещё не прошли - это не повод для окна с шагами.
    if (state.fortune.data.spinsLeft > 0) { toast('Следующий прокрут через ' + untilText(state.fortune.data.readyAt)); return; }
    showFortuneSteps();
    return;
  }

  // Объявлены внутри по той же причине, что и состояние выше: конец файла к
  // моменту первого вызова может быть ещё не выполнен.
  const TURNS = 6;
  const SPIN_MS = 5200;

  state.fortune.busy = true;
  renderFortuneStatus();
  haptic('medium');

  let res;
  try {
    res = await api('/api/fortune/spin');
  } catch (err) {
    state.fortune.busy = false;
    renderFortuneStatus();
    toast(err.message);
    return;
  }

  const wheel = document.getElementById('fortuneWheel');
  const center = fortuneSegmentCenter(res.prize.segment);

  /*
   * Небольшой разброс внутри сектора. Колесо, всегда замирающее ровно по
   * середине сектора, выглядит подстроенным - а оно как раз честное, просто
   * приз решён заранее.
   */
  const half = state.fortune.data.wheel.segmentDeg / 2;
  const jitter = (Math.random() * 2 - 1) * (half - 6);

  // Указатель стоит на нуле, значит нужный сектор должен приехать в ноль.
  const target = ((-center - jitter) % 360 + 360) % 360;
  const cur = ((state.fortune.angle % 360) + 360) % 360;
  state.fortune.angle += ((target - cur) % 360 + 360) % 360 + 360 * TURNS;

  wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.16, 0.84, 0.24, 1)`;
  wheel.style.transform = `rotate(${state.fortune.angle}deg)`;
  // Лампы обода бегут, пока колесо крутится, и гаснут в бег вместе с ним.
  const box = wheel.parentElement;
  box.classList.add('is-spinning');
  sndSpinStart();
  fortuneHighlight(wheel, SPIN_MS, res.prize.segment);

  await sleep(SPIN_MS + 120);
  box.classList.remove('is-spinning');

  applyUser(res.user);
  state.fortune.data = { ...state.fortune.data, ...res.state };
  state.fortune.busy = false;
  renderFortuneStatus();

  showFortuneWin(res.prize);
  loadFortune();
}

/** С какого момента прокрута сектора под указателем начинают подсвечиваться. */
const FORTUNE_HL_FROM = 0.55;

/** Радиус секторов колеса, доля стороны рисунка (LF_SECTOR_R из 100). */
const FORTUNE_HL_R = 0.4;

/**
 * Подсветка секторов на торможении.
 *
 * Когда колесо замедляется, сектор под указателем загорается, и каждый
 * следующий - со щелчком: последние секунды читаются как перебор вариантов,
 * а не как просто замирающая картинка. Клин рисуется в координатах колеса и
 * поворачивается вместе с ним; какой сектор под указателем, считается из
 * настоящего поворота картинки, а не из расписания.
 */
function fortuneHighlight(wheel, spinMs, winner) {
  const box = wheel.parentElement;
  let ov = box.querySelector('.fortune-hl');
  if (!ov) {
    ov = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ov.setAttribute('viewBox', '-50 -50 100 100');
    ov.setAttribute('class', 'fortune-hl');
    ov.innerHTML = '<path/>';
    box.insertBefore(ov, wheel.nextSibling);
  }
  const path = ov.querySelector('path');
  const { startDeg, segmentDeg } = state.fortune.data.wheel;
  const r = FORTUNE_HL_R * 100;
  const wedge = (i) => {
    const a0 = ((startDeg + segmentDeg * i) * Math.PI) / 180;
    const a1 = ((startDeg + segmentDeg * (i + 1)) * Math.PI) / 180;
    return `M0 0 L${(Math.cos(a0) * r).toFixed(2)} ${(Math.sin(a0) * r).toFixed(2)} ` +
      `A${r} ${r} 0 0 1 ${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)}Z`;
  };
  ov.classList.remove('is-final');
  ov.style.transition = wheel.style.transition;
  ov.style.transform = wheel.style.transform;
  const t0 = performance.now();
  let shown = -1;
  const frame = (now) => {
    const k = (now - t0) / spinMs;
    if (k >= 1) {
      path.setAttribute('d', wedge(winner));
      ov.classList.add('is-final', 'is-on');
      return;
    }
    if (k >= FORTUNE_HL_FROM) {
      const m = new DOMMatrixReadOnly(getComputedStyle(wheel).transform);
      const rot = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      const under = ((-rot % 360) + 360) % 360;
      const idx = Math.floor((((under - startDeg) % 360) + 360) % 360 / segmentDeg);
      if (idx !== shown) {
        shown = idx;
        path.setAttribute('d', wedge(idx));
        ov.classList.add('is-on');
        ov.classList.remove('is-blink');
        void ov.getBoundingClientRect();
        ov.classList.add('is-blink');
        sndTick(1.2);
        haptic('light');
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Окно выигрыша: крупно что выпало и одна строка о том, что с этим делать. */
/** Через сколько окно выигрыша Lucky Fortune закрывается само. */
const FORTUNE_WIN_MS = 12000;

/**
 * Окно выигрыша Lucky Fortune.
 *
 * Раньше все призы показывались одинаково: значок в квадрате и строка.
 * Заказчик назвал это ужасным, и он прав: «+15%» и кейс выглядели одной
 * карточкой. Теперь у каждого вида своя композиция и своё движение -
 * медальон процента, переворачивающаяся монета ×2, обложка кейса, золотой
 * билет ваучера, стопка монет денег, - а сумма досчитывается.
 */
function showFortuneWin(prize) {
  const wager = state.config?.firstDeposit?.wager ?? 3;
  const giftCase = prize.caseId ? state.config.cases.find((c) => c.id === prize.caseId) : null;
  const cover = giftCase ? (caseStageSrc(giftCase) || caseArtSrc(giftCase)) : null;
  const art = {
    percent: `<div class="fw-medal"><b>%</b>${'<i></i>'.repeat(6)}</div>`,
    x2: '<div class="fw-coin"><b>×2</b></div>',
    case: cover ? `<img class="fw-case" src="${cover}" alt="">` : '<div class="fw-coin"><b>★</b></div>',
    voucher: `<div class="fw-ticket"><span>LUCKY</span><b>${fmt(prize.amount)} ₽</b></div>`,
    cash: '<div class="fw-stack"><i></i><i></i><i></i><i></i></div>',
  }[prize.kind] || '';

  const value = {
    percent: `+<span class="fw-num" data-to="${prize.amount}">0</span>%`,
    x2: '×2',
    case: prize.caseName ? `«${esc(prize.caseName)}»` : 'Кейс',
    voucher: `<span class="fw-num" data-to="${prize.amount}">0</span> ₽`,
    cash: `<span class="fw-num" data-to="${prize.amount}">0</span> ₽`,
  }[prize.kind] || '';

  const note = {
    percent: `Придёт вместе со следующим пополнением от ${money(state.fortune.data.minDeposit)}.`,
    x2: 'Следующий денежный выигрыш в любом кейсе удвоится.',
    case: 'Лежит в ваших подарках во Free Money, открывается бесплатно.',
    voucher: `На бонусном счёте. Отыграть: ${money(prize.amount * wager)} ставками.`,
    cash: `На бонусном счёте. Отыграть: ${money(prize.amount * wager)} ставками.`,
  }[prize.kind] || '';

  const kind = {
    percent: 'Процент к пополнению',
    x2: 'Удвоитель',
    case: 'Кейс в подарок',
    voucher: 'Ваучер',
    cash: 'Деньги на счёт',
  }[prize.kind] || 'Приз';

  const box = document.getElementById('fortuneWinBackdrop');
  document.getElementById('fortuneWinArt').innerHTML = art;
  document.getElementById('fortuneWinKind').textContent = kind;
  document.getElementById('fortuneWinValue').innerHTML = value;
  document.getElementById('fortuneWinNote').textContent = note;
  box.dataset.kind = prize.kind;
  box.classList.remove('is-in');
  box.hidden = false;
  void box.offsetWidth;
  box.classList.add('is-in');

  // Сумма досчитывается к моменту, когда приз сел на место.
  box.querySelectorAll('.fw-num').forEach((el) => {
    const to = Number(el.dataset.to) || 0;
    const t0 = performance.now() + 380;
    const step = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / 900));
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && box.isConnected && !box.hidden) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // Деньги и кейс празднуем громче процента: иначе каждый прокрут выглядит
  // одинаково, и редкий приз теряется среди частых.
  if (prize.kind === 'cash' || prize.kind === 'voucher') { sndBigWin(); celebrate('bigwin'); }
  else sndReveal('rare');
  haptic('medium');
  setTimeout(() => {
    if (box.hidden) return;
    const r = box.querySelector('.fw-stage').getBoundingClientRect();
    sparkBurst(box, r.left + r.width / 2, r.top + r.height / 2,
      { n: 26, colors: ['#ffe58a', '#ffffff', '#d38bff'], dist: [70, 160], size: 6 });
  }, 420);
  clearTimeout(box._auto);
  box._auto = setTimeout(() => { if (!box.hidden) document.getElementById('fortuneWinClose').click(); }, FORTUNE_WIN_MS);
  box.onclick = (e) => { if (!e.target.closest('.fortune-win')) document.getElementById('fortuneWinClose').click(); };
}

/**
 * Заход в раздел Free Money.
 *
 * ВСЕГДА возвращает к обложке, даже если в прошлый раз игрок ушёл с середины
 * колеса. Раздел - это витрина розыгрыша, а не сохранённая игра: открыв его
 * заново и увидев наполовину прокрученное колесо, игрок решит, что попал не
 * туда.
 */
function openFreeMoney() {
  document.getElementById('fortuneIntro').hidden = false;
  document.getElementById('fortuneStage').hidden = true;
  // Подарки первыми: от них зависит, есть ли вкладка «Подарки».
  setGiftsOpen(false);
  renderBonuses();
  renderFreeMoney();
  renderFortuneArt();
  loadFortune();
}

/* ============================================================
   FREE MONEY: ИВЕНТЫ
   ============================================================ */

/*
 * Ивенты рисуются из state.user (startCase, raffle, vouchers) и config
 * (promoWheel, raffle, projectBot). Перерисовка дешёвая и идёт при каждом
 * applyUser, пока раздел открыт: поставил в соседней вкладке - шкалы
 * сдвинулись сами.
 */
function renderFreeMoney() {
  if (!document.getElementById('view-freemoney')) return;
  renderDriveEvent();
  renderStartEvent();
  renderPromoWheel();
  renderBotEvent();
  renderFmTabs();
}

/*
 * Вкладки-якоря. Список - из ивентов, что сейчас на странице (подарков нет -
 * нет и вкладки). Подсвечена та, чей ивент сейчас под вкладками: игрок видит,
 * где он, и вкладка не врёт после ручной прокрутки.
 */
function renderFmTabs() {
  const tabs = document.getElementById('fmTabs');
  if (!tabs) return;
  const evs = [...document.querySelectorAll('#view-freemoney .fm-tile')].filter((e) => !e.hidden);
  tabs.innerHTML = evs.map((e) => `<button class="fm-tab" data-go="${e.id}">${esc(e.dataset.tab || '')}</button>`).join('');
  tabs.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => {
      haptic('light');
      if (b.dataset.go === 'fmGifts') setGiftsOpen(true);
      const el = document.getElementById(b.dataset.go);
      const top = el.getBoundingClientRect().top + window.scrollY - fmStickyBottom() - FM_TAB_GAP;
      window.scrollTo({ top, behavior: 'smooth' });
      // На компьютере плитка коротко приподнимается, когда до неё доехали:
      // видно, какой блок отвечает на нажатие. Стиль только в десктопном
      // блоке styles.css, на телефоне класс ничего не делает.
      el.classList.remove('fm-hello');
      clearTimeout(el.fmHelloT);
      el.fmHelloT = setTimeout(() => {
        void el.offsetWidth;
        el.classList.add('fm-hello');
        el.addEventListener('animationend', () => el.classList.remove('fm-hello'), { once: true });
      }, FM_HELLO_DELAY_MS);
    };
  });
  markFmTab();
}

/** Отступ от шапки до ивента, к которому прокрутили. */
const FM_TAB_GAP = 12;

/** Пауза перед «это я»: плитка должна сначала доехать до экрана. */
const FM_HELLO_DELAY_MS = 380;

/*
 * Нижний край шапки - по разметке, а не числом. Вкладки к ней не липнут
 * (решение заказчика: полоса, едущая за прокруткой, мешала), поэтому
 * прокрутка к ивенту отсчитывается от шапки.
 */
function fmStickyBottom() {
  return document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
}

function markFmTab() {
  if (state.view !== 'freemoney') return;
  const tabs = document.getElementById('fmTabs');
  const line = fmStickyBottom() + FM_TAB_GAP * 3;
  let current = null;
  tabs?.querySelectorAll('[data-go]').forEach((b) => {
    const el = document.getElementById(b.dataset.go);
    if (el && el.getBoundingClientRect().top <= line) current = b;
  });
  current ||= tabs?.querySelector('[data-go]');
  tabs?.querySelectorAll('.fm-tab').forEach((b) => b.classList.toggle('active', b === current));
  // Активная вкладка не уходит за край ленты: полоса прокручивается к ней сама.
  if (current) {
    const r = current.getBoundingClientRect();
    const box = tabs.getBoundingClientRect();
    if (r.left < box.left || r.right > box.right) {
      tabs.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
    }
  }
}

let fmScrollQueued = false;
window.addEventListener('scroll', () => {
  if (fmScrollQueued || state.view !== 'freemoney') return;
  fmScrollQueued = true;
  requestAnimationFrame(() => { fmScrollQueued = false; markFmTab(); });
}, { passive: true });

/*
 * Высота шапки - в переменную --topbar-h, по которой липнут вкладки Free
 * Money. Числом в стилях она расходилась с настоящей (в шапке ещё отступ под
 * вырез экрана), и между шапкой и вкладками оставалась щель, в которой
 * проезжал контент.
 */
function syncTopbarHeight() {
  const bar = document.querySelector('.topbar');
  if (bar) document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
}
window.addEventListener('resize', syncTopbarHeight);
syncTopbarHeight();

/*
 * «Ваши подарки» свёрнуты кнопкой: список виден только по нажатию (решение
 * заказчика - россыпь плиток портила вид раздела). Состояние не
 * запоминается: зашёл в раздел - подарки снова свёрнуты.
 */
function setGiftsOpen(open) {
  const btn = document.getElementById('fmGiftsToggle');
  const body = document.getElementById('fmGiftsBody');
  if (!btn || !body) return;
  btn.setAttribute('aria-expanded', String(open));
  body.hidden = !open;
}
document.getElementById('fmGiftsToggle')?.addEventListener('click', (e) => {
  haptic('light');
  setGiftsOpen(e.currentTarget.getAttribute('aria-expanded') !== 'true');
});

/* ---------- Dream Car: розыгрыш автомобиля ---------- */

/*
 * Собран по образцу 1Win, присланному заказчиком: фото во всю карточку,
 * заголовки широким жирным шрифтом поверх неба, под фото - строка о том, как
 * получить билет, счётчик «Получено N из M» и карта билетов.
 */
function renderDriveEvent() {
  const box = document.getElementById('fmDrive');
  if (!box) return;
  const cfg = state.config.raffle || { prize: 'Rolls-Royce Wraith', step: 1000, max: 20 };
  const r = state.user?.raffle || { tickets: 0, max: cfg.max, step: cfg.step, progress: 0 };
  const left = Math.max(0, r.step - r.progress);
  const full = r.tickets >= r.max;
  const tickets = Array.from({ length: r.max }, (_, i) =>
    `<i class="dv-t${i < r.tickets ? ' got' : ''}">${i + 1}</i>`).join('');

  box.innerHTML = `
    <div class="dv-photo">
      <img src="/assets/ui/raffle-dubai.webp" alt="Rolls-Royce Wraith">
      <span class="dv-badge"><i></i>Идёт розыгрыш</span>
      <div class="dv-head">
        <div class="dv-kicker">Розыгрыш авто</div>
        <div class="dv-give">Дарим</div>
        <div class="dv-brand">ROLLS-ROYCE</div>
        <div class="dv-model">WRAITH</div>
      </div>
    </div>
    <div class="dv-body">
      <p class="dv-lead">Копите билеты ставками и получите шанс выиграть Rolls-Royce Wraith от LUCKYBOX.
        Билет - за каждые ${fmt(r.step)} ₽ ставок.</p>
      <div class="dv-count">Получено <b>${r.tickets} из ${r.max}</b></div>
      <div class="dv-tickets" aria-label="Билеты: ${r.tickets} из ${r.max}">${tickets}</div>
      ${state.guest ? '<button class="fm-btn" id="dvGo">Войти и копить билеты</button>'
        : `<div class="dv-next">${full ? 'Все билеты собраны' : `До следующего билета <b>${money(left)}</b> ставок`}</div>`}
    </div>`;
  box.querySelector('#dvGo')?.addEventListener('click', () => {
    haptic('light');
    openAuth(authDefaultPane());
  });
}

/* ---------- Кейс «Начало» ---------- */

/** На сколько делений режется шкала оборота: по сотне на деление. */
const START_SEGMENTS = 10;

function renderStartEvent() {
  const box = document.getElementById('fmStart');
  if (!box) return;
  const c = state.config.cases.find((x) => x.free);
  if (!c) { box.hidden = true; return; }
  const st = state.user?.startCase || { ready: 0, needDeposit: true, minDeposit: 100, step: 1000, progress: 0 };
  const guest = !!state.guest;
  const pct = st.ready > 0 ? 100 : st.needDeposit ? 0 : Math.round((st.progress / st.step) * 100);
  const cover = caseArtSrc(c);
  const top = Math.max(...c.items.map((i) => i.value));
  const status = st.ready > 0
    ? { cls: 'is-ready', line: 'Готов к открытию', cta: 'Открыть' }
    : guest || st.needDeposit
      ? { cls: 'is-locked', line: `Пополните от ${money(st.minDeposit)}`, cta: guest ? 'Войти' : 'Пополнить' }
      : { cls: 'is-progress', line: `Ещё ${money(st.step - st.progress)} ставок`, cta: 'Играть' };

  box.innerHTML = `
    <div class="st-glass ${status.cls}">
      <button class="st-cover" aria-label="Кейс «${esc(c.name)}»">
        ${cover ? `<img src="${cover}" alt="">` : ''}
        ${st.ready > 0 ? `<span class="st-badge">×${fmt(st.ready)}</span>` : ''}
      </button>
      <div class="st-kicker">Бесплатный кейс</div>
      <div class="st-name">${esc(c.name)} <small>до ${money(top)}</small></div>
      <div class="st-segs" aria-hidden="true">${Array.from({ length: START_SEGMENTS }, (_, i) =>
        `<i class="${(i + 1) * (100 / START_SEGMENTS) <= pct ? 'on' : ''}"></i>`).join('')}</div>
      <div class="st-line">${status.line}</div>
      <button class="fm-btn st-cta">${status.cta}</button>
    </div>`;
  const go = () => {
    haptic('light');
    if (st.ready > 0) return openCase(c.id);
    if (guest) return openAuth(authDefaultPane());
    if (st.needDeposit) return openCashier();
    return showStartGate(c);
  };
  box.querySelector('.st-cta').onclick = go;
  box.querySelector('.st-cover').onclick = () => { haptic('light'); openCase(c.id); };
}

/* ---------- Колесо удачи: прокрут промокодом ---------- */

const WHEEL_R = 150;          // радиус секторов в координатах SVG
const WHEEL_HUB_R = 52;       // радиус ступицы: на ней кнопка SPIN
const WHEEL_BULBS = 24;       // лампочек по ободу
const WHEEL_GEMS = 8;         // самоцветов на ободе между лампочками
const WHEEL_SPIN_MS = 5600;   // длительность прокрута
const WHEEL_TURNS = 6;        // полных оборотов до остановки

/*
 * Сундуки на секторах-кейсах рисуются цветом, а не подписью (решение
 * заказчика: колесо - картинка, а не список). Цвет сундука выбран в пару к
 * цвету сектора, чтобы сундук не сливался с фоном. Что за кейс, игрок узнаёт
 * в окне приза.
 */
const WHEEL_CHESTS = {
  dust: ['#3df0a6', '#16a46a'],
  spark: ['#55e6ff', '#1792c2'],
  copper: ['#c49bff', '#7244e6'],
  warm: ['#ffd95e', '#d69a10'],
  alley: ['#ff86dc', '#cf3aa6'],
};

/** Яркая палитра секторов: каждый свой цвет, соседние не сливаются. */
const WHEEL_COLORS = {
  dust: ['#2b1c9c', '#6a7bff'],
  p10: ['#05795a', '#24f0ae'],
  spark: ['#86106f', '#ff4fc1'],
  p20: ['#075c94', '#2fd2ff'],
  copper: ['#8c3307', '#ff9a2e'],
  warm: ['#7c0b2a', '#ff4672'],
  p30: ['#7a5a00', '#ffe23d'],
  alley: ['#45138f', '#b067ff'],
};

const wheelState = { rotation: 0, busy: false, code: '' };

/** Точка на окружности: угол от верхней точки по часовой стрелке. */
function wheelPoint(r, turn) {
  const a = turn * Math.PI * 2 - Math.PI / 2;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** Сундук в своих координатах: центр в нуле, ширина около 36. */
function wheelChest([body, dark], i) {
  return `<g class="pw-chest">
    <defs><linearGradient id="pwc${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${body}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
    <path d="M-17 -5 Q-17 -19 0 -19 Q17 -19 17 -5 Z" fill="url(#pwc${i})" stroke="#1a0b2e" stroke-width="1.8"/>
    <rect x="-17" y="-6" width="34" height="20" rx="3" fill="url(#pwc${i})" stroke="#1a0b2e" stroke-width="1.8"/>
    <rect x="-17" y="-7.5" width="34" height="4" fill="#ffe7a0" stroke="#1a0b2e" stroke-width="1.2"/>
    <rect x="-12" y="-18" width="4" height="31" fill="#ffe7a0" opacity=".85"/>
    <rect x="8" y="-18" width="4" height="31" fill="#ffe7a0" opacity=".85"/>
    <rect x="-4" y="-4" width="8" height="9" rx="1.6" fill="#fff4c8" stroke="#1a0b2e" stroke-width="1.2"/>
    <circle cy="0" r="1.4" fill="#1a0b2e"/>
    <path d="M-13 -15 Q-6 -18 2 -17" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".55"/>
  </g>`;
}

/** Искорка-звезда для фона секторов. */
function wheelStar(x, y, s) {
  return `<path class="pw-star" d="M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y}
    L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y}
    L${x - s * 0.28} ${y - s * 0.28} Z"/>`;
}

function wheelSvg(sectors) {
  const mid = (WHEEL_R + WHEEL_HUB_R) / 2 + 8;
  const paths = sectors.map((s, i) => {
    const [x0, y0] = wheelPoint(WHEEL_R, s.from);
    const [x1, y1] = wheelPoint(WHEEL_R, s.from + s.share);
    const large = s.share > 0.5 ? 1 : 0;
    const deg = (s.from + s.share / 2) * 360;
    const right = deg < 180;
    let mark;
    if (s.type === 'case') {
      // Сундук стоит поперёк радиуса крышкой к ободу и мельчает в узком
      // секторе, чтобы не залезать на соседа.
      const arc = (s.share * Math.PI * 2 * mid);
      const k = Math.min(1.25, Math.max(0.7, arc / 46));
      mark = `<g transform="translate(0 ${-mid}) scale(${k.toFixed(2)})">${wheelChest(WHEEL_CHESTS[s.id] || ['#fff', '#aaa'], i)}</g>`;
    } else {
      // Процент - вдоль радиуса от обода к центру; на правой половине текст
      // развёрнут, чтобы ни одна подпись не читалась вверх ногами.
      mark = `<text class="pw-lbl" transform="translate(0 ${-WHEEL_R + 12}) rotate(${right ? -90 : 90})"
        text-anchor="${right ? 'end' : 'start'}" dominant-baseline="central">${esc(s.label)}</text>`;
    }
    return `<g class="pw-sec" data-sec="${s.id}">
      <path d="M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${WHEEL_R} ${WHEEL_R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"
        fill="url(#pwg${i})"/>
      <g transform="rotate(${deg.toFixed(2)})">${mark}</g>
    </g>`;
  }).join('');
  const seams = sectors.map((s) => {
    const [x, y] = wheelPoint(WHEEL_R, s.from);
    return `<line x1="0" y1="0" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>`;
  }).join('');
  const grads = sectors.map((s, i) => {
    const [dark, bright] = WHEEL_COLORS[s.id] || [s.color, s.color];
    return `<radialGradient id="pwg${i}" cx="0" cy="0" r="${WHEEL_R}" gradientUnits="userSpaceOnUse">
      <stop offset="0.3" stop-color="${dark}"/>
      <stop offset="0.9" stop-color="${bright}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.75"/></radialGradient>`;
  }).join('');
  const stars = [[40, -96, 3], [-70, -60, 2.4], [96, 30, 2.8], [-30, 104, 2.2], [-108, 16, 3], [64, 92, 2.2], [20, -128, 2]]
    .map(([x, y, s]) => wheelStar(x, y, s)).join('');
  const bulbs = Array.from({ length: WHEEL_BULBS }, (_, i) => {
    const [x, y] = wheelPoint(WHEEL_R + 13, i / WHEEL_BULBS);
    return `<circle class="pw-bulb${i % 2 ? ' odd' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"/>`;
  }).join('');
  const gems = Array.from({ length: WHEEL_GEMS }, (_, i) => {
    const [x, y] = wheelPoint(WHEEL_R + 13, (i + 0.5) / WHEEL_GEMS);
    const c = ['#ff4fc1', '#2fd2ff', '#24f0ae', '#ffe23d'][i % 4];
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><path d="M0 -7 L6 0 L0 7 L-6 0 Z" fill="${c}"
      stroke="#3a1500" stroke-width="1.2"/><path d="M0 -7 L6 0 L0 0 Z" fill="#fff" opacity=".45"/></g>`;
  }).join('');
  return `<svg class="pw-svg" viewBox="-180 -180 360 360" aria-hidden="true">
    <defs>${grads}
      <linearGradient id="pwRim" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0" stop-color="#fff4c9"/><stop offset="0.35" stop-color="#ffc83a"/>
        <stop offset="0.6" stop-color="#b8650a"/><stop offset="1" stop-color="#ffd86a"/></linearGradient>
      <radialGradient id="pwHalo" cx="0" cy="0" r="180" gradientUnits="userSpaceOnUse">
        <stop offset="0.78" stop-color="#ff4fc1" stop-opacity="0.55"/>
        <stop offset="0.9" stop-color="#7a4dff" stop-opacity="0.3"/>
        <stop offset="1" stop-color="#2fd2ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="pwHub" cx="-0.25" cy="-0.3" r="1">
        <stop offset="0" stop-color="#fff6d0"/><stop offset="0.45" stop-color="#ffb52e"/><stop offset="1" stop-color="#a34d00"/></radialGradient>
    </defs>
    <circle r="180" fill="url(#pwHalo)"/>
    <circle r="${WHEEL_R + 22}" fill="#1b0b33"/>
    <circle r="${WHEEL_R + 13}" fill="none" stroke="url(#pwRim)" stroke-width="18"/>
    <circle r="${WHEEL_R + 22}" fill="none" stroke="#ffe7a0" stroke-width="1.4" opacity=".7"/>
    <g class="pw-bulbs">${bulbs}</g>
    <g>${gems}</g>
    <g class="pw-rotor" id="pwRotor" style="transform:rotate(${wheelState.rotation}deg)">${paths}
      <g class="pw-seams">${seams}</g>
      <g class="pw-stars">${stars}</g>
      <circle r="${WHEEL_R}" fill="none" stroke="#fff3c4" stroke-width="2.5"/></g>
    <circle r="${WHEEL_HUB_R + 6}" fill="#1b0b33" opacity=".55"/>
  </svg>`;
}

/*
 * Колесо без легенды и без подписей кейсов (решение заказчика): само колесо и
 * всё яркое внутри. Шансы не спрятаны - каждый сектор занимает ровно свою
 * долю круга, и угол читается глазом (CLAUDE.md, «Колесо удачи»).
 *
 * Поле промокода крупное и лежит прямо поверх колеса. Код введён - поле
 * уходит, в центре встаёт кнопка SPIN; под ней код, его можно поправить.
 */
function renderPromoWheel() {
  const box = document.getElementById('fmWheel');
  const cfg = state.config.promoWheel;
  if (!box || !cfg) return;
  // Колесо не пересобираем посреди прокрута: перерисовка сбросила бы угол.
  if (wheelState.busy && box.querySelector('.pw-svg')) return;
  box.innerHTML = `
    <div class="fm-tile-head"><h2 class="fm-tile-title">Колесо удачи</h2>
      <span class="fm-tile-note">промокоды - в нашем боте</span></div>
    <div class="pw-card">
      <div class="pw-wheel">
        <span class="pw-pin" aria-hidden="true"></span>
        ${wheelSvg(cfg.sectors)}
        <form class="pw-code-box" id="pwForm" autocomplete="off">
          <input class="pw-code" id="pwCode" maxlength="32" placeholder="ПРОМОКОД"
            autocapitalize="characters" spellcheck="false" aria-label="Промокод колеса">
          <button class="pw-ok" type="submit" aria-label="Готово">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor"
              stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </form>
        <button class="pw-spin" id="pwSpin" type="button" hidden>SPIN</button>
      </div>
      <button class="pw-code-chip" id="pwChip" type="button" hidden></button>
      <div class="pw-err" id="pwErr" hidden></div>
    </div>`;
  const input = box.querySelector('#pwCode');
  input.value = wheelState.code;
  input.addEventListener('input', () => { input.value = input.value.toUpperCase(); box.querySelector('#pwErr').hidden = true; });
  box.querySelector('#pwForm').onsubmit = (e) => { e.preventDefault(); takeWheelCode(); };
  box.querySelector('#pwSpin').onclick = spinPromoWheel;
  box.querySelector('#pwChip').onclick = () => setWheelCode('');
  setWheelCode(wheelState.code, { quiet: true });
}

/** Промокод принят полем: поле уходит, появляется SPIN. Пустой - обратно поле. */
function setWheelCode(code, { quiet = false } = {}) {
  wheelState.code = code;
  const form = document.getElementById('pwForm');
  const spin = document.getElementById('pwSpin');
  const chip = document.getElementById('pwChip');
  if (!form) return;
  form.hidden = !!code;
  spin.hidden = !code;
  chip.hidden = !code;
  chip.innerHTML = code ? `Код <b>${esc(code)}</b> · изменить` : '';
  if (!code && !quiet) document.getElementById('pwCode')?.focus();
}

function takeWheelCode() {
  if (state.guest) return openAuth(authDefaultPane());
  const input = document.getElementById('pwCode');
  const code = input.value.trim().toUpperCase();
  if (!code) {
    const err = document.getElementById('pwErr');
    err.textContent = 'Введите промокод из бота';
    err.hidden = false;
    input.focus();
    haptic('error');
    return;
  }
  input.blur();
  haptic('light');
  setWheelCode(code);
}

async function spinPromoWheel() {
  if (wheelState.busy) return;
  if (state.guest) return openAuth(authDefaultPane());
  const err = document.getElementById('pwErr');
  const code = wheelState.code;
  if (!code) return setWheelCode('');
  wheelState.busy = true;
  const btn = document.getElementById('pwSpin');
  btn.disabled = true;
  let data;
  try {
    data = await api('/api/wheel/spin', { code }, { quiet: true });
  } catch (e) {
    wheelState.busy = false;
    btn.disabled = false;
    // Код не подошёл - возвращаем поле с ним же, чтобы поправить опечатку.
    setWheelCode('', { quiet: true });
    document.getElementById('pwCode').value = code;
    err.textContent = e.message;
    err.hidden = false;
    haptic('error');
    return;
  }

  const cfg = state.config.promoWheel;
  const sec = cfg.sectors.find((x) => x.id === data.result.sector);
  // Точка остановки - внутри сектора, но не на самой границе: стрелка,
  // вставшая на шов, читается как спорная.
  const jitter = (Math.random() - 0.5) * sec.share * 0.6;
  const target = (sec.from + sec.share / 2 + jitter) * 360;
  const base = Math.ceil(wheelState.rotation / 360) * 360;
  const finalRot = base + WHEEL_TURNS * 360 - target;
  const rotor = document.getElementById('pwRotor');
  const card = document.querySelector('.pw-card');
  card.classList.add('is-spinning');
  sndSpinStart();
  rotor.style.transition = `transform ${WHEEL_SPIN_MS}ms cubic-bezier(0.12, 0.62, 0.08, 1)`;
  requestAnimationFrame(() => { rotor.style.transform = `rotate(${finalRot}deg)`; });

  // Щелчки на каждом шве: угол снимается с настоящего поворота, а не
  // из расписания, поэтому звук совпадает с тем, что видно.
  const seams = cfg.sectors.map((x) => x.from * 360);
  let lastSeam = -1;
  const t0 = performance.now();
  const tick = () => {
    const m = getComputedStyle(rotor).transform;
    if (m && m !== 'none') {
      const [a, b] = m.slice(7, -1).split(',').map(Number);
      const rot = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
      const under = (360 - rot) % 360;
      const idx = seams.filter((d) => d <= under).length - 1;
      if (idx !== lastSeam) { if (lastSeam !== -1) sndTick(1.1); lastSeam = idx; }
    }
    if (performance.now() - t0 < WHEEL_SPIN_MS) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  await new Promise((r) => setTimeout(r, WHEEL_SPIN_MS + 120));
  wheelState.rotation = finalRot;
  card.classList.remove('is-spinning');
  document.querySelector(`.pw-sec[data-sec="${sec.id}"]`)?.classList.add('is-win');
  sndLand();
  btn.disabled = false;
  wheelState.busy = false;
  setWheelCode('', { quiet: true });
  if (data.user) applyUser(data.user);
  showWheelWin(data.result, sec);
}

/** Окно приза колеса: кейс с обложкой или процент крупной цифрой. */
function showWheelWin(result, sec) {
  document.getElementById('wheelWin')?.remove();
  const c = result.caseId ? state.config.cases.find((x) => x.id === result.caseId) : null;
  const cover = c ? (caseStageSrc(c) || caseArtSrc(c)) : null;
  const scene = document.createElement('div');
  scene.id = 'wheelWin';
  scene.className = 'sg-scene pw-win';
  scene.innerHTML = `<div class="sg-glow"></div>
    <div class="sg-card" role="dialog" aria-label="Приз колеса">
      <button class="sg-close" aria-label="Закрыть">×</button>
      <div class="sg-hero"><div class="sg-rays"></div>
        ${cover ? `<img class="sg-cover" src="${cover}" alt="">` : `<div class="pw-win-pct">+${result.pct}%</div>`}</div>
      <div class="sg-kicker">Колесо удачи</div>
      <h3 class="sg-title">${c ? `Кейс <b>«${esc(c.name)}»</b><br>в подарок` : `<b>+${result.pct}%</b> к пополнению`}</h3>
      <p class="sg-sub">${c ? 'Он уже лежит в ваших подарках: откройте его, когда захотите.'
        : `Сработает на следующем пополнении от ${money(result.minDeposit)}, бонус до ${money(result.maxBonus)}.`}</p>
      <button class="sg-cta">${c ? 'Открыть сейчас' : 'Пополнить'}</button>
      <button class="sg-later">Позже</button>
    </div>`;
  document.body.appendChild(scene);
  void scene.offsetWidth;
  scene.classList.add('is-in');
  sndFanfare();
  haptic('success');
  setTimeout(() => {
    if (!scene.isConnected) return;
    const r = scene.querySelector('.sg-hero').getBoundingClientRect();
    sparkBurst(scene, r.left + r.width / 2, r.top + r.height * 0.55,
      { n: 30, colors: ['#ffe58a', '#ffffff', '#8cf5b4'], dist: [70, 170], size: 6 });
  }, 420);
  let timer = 0;
  const close = () => {
    if (scene.classList.contains('is-out')) return;
    clearTimeout(timer);
    scene.classList.add('is-out');
    setTimeout(() => scene.remove(), 320);
  };
  timer = setTimeout(close, START_GATE_MS);
  scene.querySelector('.sg-close').onclick = close;
  scene.querySelector('.sg-later').onclick = close;
  scene.onclick = (e) => { if (!e.target.closest('.sg-card')) close(); };
  scene.querySelector('.sg-cta').onclick = () => { close(); if (c) openCase(c.id); else openCashier(); };
}


/* ---------- Telegram-бот ---------- */

function renderBotEvent() {
  const box = document.getElementById('fmBot');
  if (!box) return;
  const bot = state.config.projectBot || 'Luckyboxbonus_bot';
  box.innerHTML = `
    <div class="bt-tile">
      <span class="bt-ico" aria-hidden="true"><svg viewBox="0 0 48 48"><path fill="#fff"
        d="M40.6 9.4 6.9 22.4c-2.3.9-2.3 2.2-.4 2.8l8.6 2.7 3.3 10.2c.4 1.1.2 1.6 1.4 1.6.9 0 1.3-.4 1.8-.9l4.3-4.2 8.9 6.6c1.6.9 2.8.4 3.2-1.5l5.8-27.4c.6-2.4-.9-3.5-2.5-2.8zM17.2 27.6l19.4-12.2c.9-.6 1.8-.3 1.1.4L21.1 30.8l-.6 6.9z"/></svg></span>
      <div class="bt-kicker">Наш бот</div>
      <div class="bt-name" role="button" tabindex="0" title="Скопировать">@${esc(bot)}</div>
      <div class="bt-sub">Промокоды для колеса, кейс «Начало» и новости розыгрыша</div>
      <a class="fm-btn fm-btn-glass bt-open" href="tg://resolve?domain=${encodeURIComponent(bot)}">Открыть</a>
    </div>`;
  // Ник копируется нажатием: на компьютере кнопки «Открыть» нет, а
  // перепечатывать ник руками - лишний повод ошибиться.
  const name = box.querySelector('.bt-name');
  name.onclick = async () => {
    try { await navigator.clipboard.writeText(`@${bot}`); toast('Ник бота скопирован'); } catch { /* буфер недоступен */ }
    haptic('light');
  };
}

function wireFortune() {
  document.getElementById('fortuneGo')?.addEventListener('click', () => {
    haptic('light');
    document.getElementById('fortuneIntro').hidden = true;
    document.getElementById('fortuneStage').hidden = false;
    // Окно с шагами показывается здесь, а не при входе на страницу: сначала
    // игрок должен увидеть, ради чего его о чём-то просят.
    if (state.fortune.data && !state.fortune.data.canSpin && state.fortune.data.spinsLeft <= 0) showFortuneSteps();
  });

  document.getElementById('fortuneSpin')?.addEventListener('click', spinFortune);

  document.getElementById('fortuneStepsClose')?.addEventListener('click', () => {
    document.getElementById('fortuneStepsBackdrop').hidden = true;
  });
  document.getElementById('fortuneStepsGo')?.addEventListener('click', () => {
    document.getElementById('fortuneStepsBackdrop').hidden = true;
    if (!state.fortune.data || state.fortune.data.spinsLeft <= 0) openCashier();
  });
  document.getElementById('fortuneWinClose')?.addEventListener('click', () => {
    document.getElementById('fortuneWinBackdrop').hidden = true;
    haptic('light');
  });

  document.getElementById('promoFortune')?.addEventListener('click', () => {
    haptic('light');
    switchView('freemoney');
  });
  /*
   * «Казино» стоит на месте «Бонусов» (решение заказчика; бонусы остались в
   * меню). Если раздел выключен в панели, баннер говорит это словами, а не
   * молчит: кнопка, которая ничего не делает, хуже надписи.
   */
  // Пара под слайд-шоу в казино: Free Money и обратно в кейсы.
  document.getElementById('czPromoFortune')?.addEventListener('click', () => {
    haptic('light');
    switchView('freemoney');
  });
  document.getElementById('czPromoCases')?.addEventListener('click', () => {
    haptic('light');
    switchView('cases');
  });
  document.getElementById('promoCasino')?.addEventListener('click', () => {
    haptic('light');
    if (viewOpen('casino')) switchView('casino');
    else toast(CASINO_SOON);
  });
  document.getElementById('brandHome')?.addEventListener('click', () => {
    haptic('light');
    switchView('cases');
  });
}

/* ============================================================
   ГЛАВНЫЙ БАННЕР
   ============================================================ */

/**
 * Слайд-шоу главного баннера.
 *
 * ПОЧЕМУ ПЕРЕКЛЮЧЕНИЕ ПРОЗРАЧНОСТЬЮ, А НЕ СДВИГОМ. Сдвиг требует полосы
 * шириной в четыре экрана, а такая полоса на телефоне ловит горизонтальный
 * свайп и конфликтует с прокруткой страницы. Стопка с прозрачностью этой беды
 * не имеет вовсе.
 *
 * ПОЧЕМУ ТАЙМЕР ОСТАНАВЛИВАЕТСЯ НА СКРЫТОЙ ВКЛАДКЕ. Иначе свёрнутое
 * приложение продолжает перекрашивать баннер: работа впустую, а на телефоне
 * ещё и расход батареи. Вернувшись, игрок увидит тот же кадр, на котором ушёл.
 */
function runHeroSlider(heroId = 'hero', dotsId = 'heroDots') {
  const hero = document.getElementById(heroId);
  const dotsBox = document.getElementById(dotsId);
  if (!hero || !dotsBox) return;

  const slides = [...hero.querySelectorAll('.hero-img')];
  if (slides.length < 2) return;

  /*
   * Длительность у каждого слайда своя (data-ms). Джекпот-баннер стоит
   * десять секунд, фирменные по три: заказчику нужно, чтобы большую часть
   * времени на экране был вход в казино. Слайд без data-ms стоит шесть
   * секунд: за меньшее время надпись не успеваешь прочитать.
   */
  const DEFAULT_SLIDE_MS = 6000;
  const durationOf = (el) => Number(el.dataset.ms) || DEFAULT_SLIDE_MS;

  let at = 0;
  let timer = null;

  dotsBox.innerHTML = slides
    .map((_, i) => `<button class="hero-dot${i === 0 ? ' on' : ''}" type="button"
      aria-label="Баннер ${i + 1}"></button>`)
    .join('');
  const dots = [...dotsBox.children];

  const show = (next) => {
    at = (next + slides.length) % slides.length;
    slides.forEach((el, i) => el.classList.toggle('active', i === at));
    dots.forEach((el, i) => el.classList.toggle('on', i === at));
  };

  // Таймер одноразовый и заводится заново на каждом слайде: у слайдов
  // разная длительность, и setInterval с одним шагом её бы не учёл.
  const start = () => {
    if (timer !== null) return;
    // Под открытым кейсом слайд не меняется: смена кадра - перерисовка
    // баннера под лентой, которую игрок в этот момент смотрит.
    timer = setTimeout(() => {
      timer = null;
      if (!document.body.classList.contains('case-open')) show(at + 1);
      start();
    }, durationOf(slides[at]));
  };
  const stop = () => { clearTimeout(timer); timer = null; };

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      // Отсчёт начинается заново: иначе выбранный вручную кадр мог смениться
      // через полсекунды, и нажатие выглядело бы сломанным.
      stop();
      show(i);
      start();
      haptic('light');
    });
  });

  /* Баннер с data-go ведёт в раздел: джекпот на главной - в казино, в
     самом казино - к «Популярным». */
  slides.forEach((el) => {
    if (!el.dataset.go) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      haptic('light');
      if (el.dataset.go === 'casino') { if (viewOpen('casino')) switchView('casino'); }
      else casino.focusBlock(el.dataset.go);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  start();
}

/* ============================================================
   СЧЁТЧИКИ В ПОДВАЛЕ
   ============================================================ */

/**
 * Витринные счётчики: открытых кейсов и игроков.
 *
 * Числа не приходят с сервера и ничего не измеряют - это оформление, как и
 * счётчик зрителей на экране кейса. Кейсы прибавляются каждую секунду,
 * игроки - примерно раз в десять минут, иначе рост выглядел бы неправдоподобно.
 *
 * Стартовая точка сдвигается по реальному времени, поэтому у зашедшего завтра
 * счётчик не откатится к исходному значению.
 */
function startFooterCounters() {
  // Константы объявлены внутри намеренно: функция вызывается при отрисовке
  // подвала, а это происходит раньше, чем выполнится конец файла, - вынесенные
  // наружу const попали бы в мёртвую зону и уронили бы страницу.
  const ORIGIN = Date.parse('2026-08-17T00:00:00Z');
  const BASE = { cases: 1_567_266, players: 45_678 };

  /*
   * Те же числа стоят и в подвале, и в шапке на компьютере. Считаются один раз
   * и рисуются в оба места: два независимых счётчика на одной странице
   * разъехались бы за минуту, и это заметно.
   */
  const casesEls = ['statCases', 'statCasesTop'].map((id) => document.getElementById(id));
  const playersEls = ['statPlayers', 'statPlayersTop'].map((id) => document.getElementById(id));
  const onlineEl = document.getElementById('statOnline');
  if (!casesEls[0] && !casesEls[1]) return;

  const elapsed = Math.max(0, Date.now() - ORIGIN) / 1000;
  let cases = BASE.cases + Math.floor(elapsed * 1.5);
  let players = BASE.players + Math.floor(elapsed / 600);

  /*
   * «Сейчас онлайн» - выдуманное число, и оно обязано вести себя как живое:
   * стоять на месте оно не может, но и прыгать с 1200 на 3300 за секунду тоже.
   * Поэтому берётся случайная точка в диапазоне, а дальше она гуляет мелкими
   * шагами вокруг неё.
   */
  const ONLINE_MIN = 1200;
  const ONLINE_MAX = 3300;
  let online = ONLINE_MIN + Math.floor(Math.random() * (ONLINE_MAX - ONLINE_MIN + 1));

  const paint = () => {
    for (const el of casesEls) if (el) el.textContent = fmt(cases);
    for (const el of playersEls) if (el) el.textContent = fmt(players);
    if (onlineEl) onlineEl.textContent = fmt(online);
  };
  paint();

  if (state.counterTimers) state.counterTimers.forEach(clearInterval);
  state.counterTimers = [
    setInterval(() => { cases += 1 + Math.floor(Math.random() * 2); paint(); }, 1000),
    setInterval(() => { players += 1 + Math.floor(Math.random() * 2); paint(); }, 600_000),
    setInterval(() => {
      online = Math.max(ONLINE_MIN, Math.min(ONLINE_MAX,
        online + Math.round((Math.random() - 0.5) * 24)));
      paint();
    }, 4000),
  ];
}
