/**
 * Звуки - синтезируются на месте через WebAudio.
 *
 * Ни одного внешнего файла: автономная HTML-версия должна работать с диска
 * без интернета, а тащить внутрь неё мегабайты mp3 в base64 бессмысленно.
 * Всё собрано из осцилляторов и шума, каждый звук - десятки байт кода.
 *
 * Браузеры не дают запускать звук до первого касания экрана, поэтому
 * аудиоконтекст создаётся лениво, при первом же действии игрока.
 */

let ctx = null;
let master = null;
let enabled = true;

try {
  enabled = localStorage.getItem('luckybox-sound') !== 'off';
} catch { /* приватный режим */ }

function audio() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  return ctx;
}

/** Контекст засыпает, если звук пытались завести до касания экрана. */
function wake() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  return c;
}

export function soundEnabled() { return enabled; }

export function toggleSound(on) {
  enabled = on === undefined ? !enabled : !!on;
  try { localStorage.setItem('luckybox-sound', enabled ? 'on' : 'off'); } catch { /* пусто */ }
  if (enabled) { wake(); blip(660, 0.06, 'triangle', 0.5); }
  return enabled;
}

/**
 * Базовый кирпичик: тон с затуханием.
 * @param {number} freq   частота, Гц
 * @param {number} dur    длительность, с
 * @param {string} type   форма волны
 * @param {number} vol    громкость 0..1
 * @param {number} slide  во сколько раз частота уезжает к концу
 */
function blip(freq, dur, type = 'sine', vol = 1, slide = 1) {
  if (!enabled) return;
  const c = wake();
  if (!c) return;

  const osc = c.createOscillator();
  const gain = c.createGain();
  const t = c.currentTime;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);

  // Короткая атака и экспоненциальный спад: без них слышны щелчки на краях.
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Шумовой всплеск - для щелчков и «воздуха». */
function noise(dur, vol = 0.3, freq = 1800, q = 1) {
  if (!enabled) return;
  const c = wake();
  if (!c) return;

  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  src.buffer = buf;

  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;

  const gain = c.createGain();
  gain.gain.value = vol;

  src.connect(filter).connect(gain).connect(master);
  src.start();
}

/* ============================================================
   ЗВУКИ ИГРЫ
   ============================================================ */

/** Щелчок ленты - по одному на проехавшую плитку. */
export function sndTick(pitch = 1) {
  noise(0.035, 0.22, 2400 * pitch, 6);
}

/** Начало прокрута: короткий разгон. */
export function sndSpinStart() {
  blip(180, 0.32, 'sawtooth', 0.18, 3.2);
  noise(0.3, 0.14, 900, 1.2);
}

/** Остановка ленты - глухой удар. */
export function sndLand() {
  blip(140, 0.16, 'square', 0.3, 0.6);
  noise(0.09, 0.3, 700, 1.5);
}

/**
 * Раскрытие приза. Чем выше редкость, тем выше и длиннее аккорд -
 * ухо считывает ценность раньше, чем игрок успевает прочитать сумму.
 */
export function sndReveal(tier) {
  const scale = {
    common: [392], uncommon: [440, 554],
    rare: [523, 659], epic: [587, 740, 880],
    legendary: [659, 830, 988], mythic: [698, 880, 1047, 1319],
    unique: [784, 988, 1175, 1568],
  };
  const notes = scale[tier] || scale.common;
  notes.forEach((f, i) => setTimeout(() => blip(f, 0.5, 'triangle', 0.5), i * 85));
}

/** Крупный выигрыш - восходящая фанфара поверх раскрытия. */
export function sndBigWin() {
  [523, 659, 784, 1047, 1319].forEach((f, i) =>
    setTimeout(() => blip(f, 0.6, 'square', 0.28), i * 90));
  setTimeout(() => noise(0.5, 0.18, 3000, 0.7), 120);
}

/** Забрать выигрыш - «касса». */
export function sndCollect() {
  [880, 1175, 1568].forEach((f, i) =>
    setTimeout(() => blip(f, 0.35, 'sine', 0.45), i * 70));
  setTimeout(() => noise(0.25, 0.16, 5200, 0.8), 60);
}

/** Проигрыш - короткий спад. */
export function sndLose() {
  blip(300, 0.35, 'sawtooth', 0.24, 0.45);
}

/** Переворот карты. */
export function sndFlip() {
  noise(0.07, 0.28, 1500, 2.4);
  blip(520, 0.09, 'triangle', 0.22, 1.5);
}

/** Ставка сделана. */
export function sndBet() {
  blip(420, 0.09, 'square', 0.26);
  setTimeout(() => blip(620, 0.09, 'square', 0.22), 60);
}

/** Взрыв в краше. */
export function sndCrash() {
  noise(0.55, 0.42, 260, 0.6);
  blip(120, 0.5, 'sawtooth', 0.3, 0.3);
}

/** Рост множителя в краше - тон ползёт вверх вместе с ним. */
/**
 * Фанфары покупки фриспинов: восходящий аккорд с раскатом.
 *
 * Момент покупки должен звучать иначе, чем обычный выигрыш, - это событие, за
 * которое игрок сознательно заплатил, и оно заслуживает собственной темы.
 *
 * Тема тянется около двух с половиной секунд, потому что столько же идёт
 * празднование на экране: короткий аккорд отзвучал бы на первой волне салюта,
 * и дальше картинка шла бы молча. Поэтому за первым подъёмом идёт второй,
 * октавой выше, а под ними всё это время держится басовая нота.
 */
export function sndPurchase() {
  const rise = [392, 523, 659, 784, 1046];
  rise.forEach((f, i) => {
    setTimeout(() => {
      blip(f, 0.32, 'triangle', 0.5);
      blip(f * 2, 0.22, 'sine', 0.22);
    }, i * 85);
  });
  setTimeout(() => noise(0.5, 0.16, 5200, 0.7), 420);

  // Басовая подложка: два длинных тона, чтобы между подъёмами не было тишины.
  setTimeout(() => blip(196, 1.2, 'sine', 0.16, 0.4), 300);
  setTimeout(() => blip(262, 1.2, 'sine', 0.16, 0.4), 1400);

  // Второй подъём, выше и шире первого.
  const climb = [523, 659, 784, 1046, 1318, 1568];
  climb.forEach((f, i) => {
    setTimeout(() => {
      blip(f, 0.3, 'triangle', 0.34);
      blip(f * 1.5, 0.2, 'sine', 0.16);
    }, 1180 + i * 95);
  });

  // Финальный аккорд со звоном - под последнюю волну салюта.
  setTimeout(() => {
    [784, 1046, 1568].forEach((f, i) =>
      setTimeout(() => blip(f, 0.7, 'triangle', 0.4, 0.6), i * 45));
    noise(0.6, 0.18, 6000, 0.75);
  }, 2050);
}

/**
 * Ретриггер: серия продлила сама себя.
 *
 * Звук нарочно «взлетающий» и с дребезгом - он должен выделяться на фоне
 * ровных щелчков серии, потому что это самое редкое, что в ней бывает.
 */
export function sndRetrigger() {
  blip(330, 0.5, 'sawtooth', 0.34, 4);
  setTimeout(() => blip(880, 0.3, 'square', 0.26, 1.6), 90);
  setTimeout(() => {
    [1046, 1318, 1568].forEach((f, i) =>
      setTimeout(() => blip(f, 0.26, 'triangle', 0.42), i * 60));
  }, 200);
  setTimeout(() => noise(0.4, 0.2, 3200, 0.6), 260);
}

/**
 * Салют: россыпь хлопков со звоном.
 *
 * Отличается от sndBigWin тем, что не тянет ноту, а рассыпается, - под
 * визуальный фейерверк ровный аккорд звучал бы мимо картинки.
 */
export function sndFirework(bursts = 4) {
  for (let i = 0; i < bursts; i++) {
    const delay = i * 190 + Math.random() * 90;
    setTimeout(() => {
      noise(0.28, 0.26, 900 + Math.random() * 1400, 0.8);
      const base = 700 + Math.random() * 700;
      blip(base, 0.24, 'triangle', 0.3, 1.7);
      setTimeout(() => blip(base * 1.5, 0.18, 'sine', 0.2), 70);
    }, delay);
  }
}

/**
 * Джекпот: длинная восходящая тема для по-настоящему крупного выигрыша.
 * Звучит заметно дольше остальных - иначе не отличается от обычной удачи.
 */
export function sndJackpot() {
  const seq = [523, 659, 784, 1046, 1318, 1568];
  seq.forEach((f, i) => {
    setTimeout(() => {
      blip(f, 0.42, 'triangle', 0.5);
      blip(f / 2, 0.42, 'sine', 0.3);
    }, i * 110);
  });
  setTimeout(() => {
    blip(2093, 0.9, 'sine', 0.4);
    noise(0.8, 0.18, 6000, 0.5);
  }, seq.length * 110);
}

export function sndClimb(multiplier) {
  const f = 300 + Math.min(900, Math.log(multiplier) * 420);
  blip(f, 0.06, 'sine', 0.12);
}

/* ============================================================
   ЗВУКИ ПОКАЗА ВЫИГРЫША (public/motion.js)
   ============================================================ */

/**
 * Шум с проездом фильтра. Обычный noise() стоит на одной частоте, а свист,
 * нарастание и удар клинка читаются именно движением частоты.
 */
function sweep(dur, vol, from, to, q = 1, type = 'bandpass') {
  if (!enabled) return;
  const c = wake();
  if (!c) return;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  const t = c.currentTime;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** Тон с долгой атакой: нарастание под счёт выигрыша, а не щелчок. */
function swell(freq, dur, type, vol, slide) {
  if (!enabled) return;
  const c = wake();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const t = c.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.8);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Свист: карточка срывается с ленты (вверх) или уходит на баланс (вниз). */
export function sndWhoosh(up = true) { sweep(0.38, 0.5, up ? 300 : 3000, up ? 3200 : 260, 0.9); }

/** Удар: низкий провал и глухой шум. Под вспышку и ударную волну. */
export function sndBoom() {
  blip(150, 0.7, 'sine', 0.9, 0.25);
  sweep(0.35, 0.6, 1200, 90, 0.7, 'lowpass');
}

/** Клинок: короткий высокий шум сверху вниз. */
export function sndSlash() { sweep(0.22, 0.45, 7000, 1800, 3, 'highpass'); }

/** Нарастание под счёт суммы. Длина равна длине счёта. */
export function sndRiser(dur) {
  sweep(dur, 0.32, 200, 5000, 2);
  swell(110, dur, 'sawtooth', 0.1, 4);
}

/** Аккорд ступени: BIG, MEGA, EPIC звучат один выше другого. */
export function sndHit(pitch = 1) {
  [0, 4, 7, 12].forEach((s) => blip(330 * pitch * Math.pow(2, s / 12), 0.55, 'sawtooth', 0.1));
}

/** Фанфара на итоговую сумму. */
export function sndFanfare(pitch = 1) {
  [0, 4, 7, 12, 16, 19, 24].forEach((s, i) =>
    setTimeout(() => blip(392 * pitch * Math.pow(2, s / 12), 0.5, 'triangle', 0.22), i * 70));
}

/** Монета: высокий двойной звон, под каждую каплю счёта. */
export function sndCoin() {
  const f = 2200 + Math.random() * 800;
  blip(f, 0.14, 'sine', 0.16);
  setTimeout(() => blip(f * 1.5, 0.1, 'sine', 0.09), 25);
}

/** Жетон фриспина ложится на место. Каждый следующий чуть выше. */
export function sndDeal(i = 0) {
  blip(660 * Math.pow(2, Math.min(i, 24) / 24), 0.09, 'triangle', 0.3);
}

/** Окупил ставку: короткий звон без праздника. */
export function sndChime() {
  [0, 4, 7].forEach((s, i) =>
    setTimeout(() => blip(880 * Math.pow(2, s / 12), 0.35, 'triangle', 0.18), i * 50));
}

/** Возврат меньше ставки: мягкая нота, не фанфара и не «проигрыш». */
export function sndSoft() { blip(520, 0.4, 'sine', 0.14, 0.96); }

/* ============================================================
   РИСК-ИГРА: найди красного туза
   ============================================================ */

/**
 * Тасовка: серия коротких шорохов, как колода, пущенная веером. Шорох -
 * шум узкой полосы, у каждой карты своя частота: одинаковые щелчки подряд
 * звучат как метроном, а не как бумага.
 */
export function sndShuffle(cards = 6) {
  for (let i = 0; i < cards * 2; i++) {
    setTimeout(() => noise(0.045, 0.22, 2600 + Math.random() * 2200, 2.2), i * 38);
  }
}

/** Карта ложится на стол: глухой шлепок, а не щелчок. */
export function sndCardDrop(i = 0) {
  noise(0.06, 0.32, 900 + i * 60, 1.4);
  blip(180 + i * 8, 0.07, 'sine', 0.18, 0.7);
}

/**
 * Удар сердца перед вскрытием. Два низких толчка: игрок уже выбрал, и эти
 * полсекунды тишины без звука читаются как зависание, а не как ожидание.
 */
export function sndHeartbeat() {
  blip(62, 0.16, 'sine', 0.9, 0.6);
  setTimeout(() => blip(56, 0.2, 'sine', 0.7, 0.6), 170);
}

/** Туз найден: металлический удар и восходящий аккорд. */
export function sndAceWin() {
  blip(1760, 0.5, 'triangle', 0.22, 1);
  blip(2637, 0.4, 'sine', 0.12, 1);
  [0, 7, 12, 16, 19].forEach((s, i) =>
    setTimeout(() => blip(523 * Math.pow(2, s / 12), 0.6, 'triangle', 0.2), 90 + i * 65));
}

/** Множитель печатью ложится на сумму: тяжёлый удар со звоном сверху. */
export function sndStamp() {
  blip(120, 0.35, 'sine', 0.9, 0.4);
  noise(0.12, 0.5, 600, 0.8);
  setTimeout(() => blip(1320, 0.3, 'triangle', 0.16), 40);
}

/**
 * Выигрыш сгорел: нисходящий тон и треск. Не «проигрыш» с фанфарой
 * наоборот - игрок и так расстроен, звук только отмечает, что всё кончено.
 */
export function sndBurn() {
  sweep(0.7, 0.35, 2400, 140, 1.2, 'lowpass');
  blip(220, 0.6, 'sawtooth', 0.08, 0.5);
  for (let i = 0; i < 6; i++) setTimeout(() => noise(0.03, 0.18, 3000 + Math.random() * 2000, 4), 80 + i * 70);
}
