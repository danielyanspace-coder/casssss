/**
 * Звуки — синтезируются на месте через WebAudio.
 *
 * Ни одного внешнего файла: автономная HTML-версия должна работать с диска
 * без интернета, а тащить внутрь неё мегабайты mp3 в base64 бессмысленно.
 * Всё собрано из осцилляторов и шума, каждый звук — десятки байт кода.
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

/** Шумовой всплеск — для щелчков и «воздуха». */
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

/** Щелчок ленты — по одному на проехавшую плитку. */
export function sndTick(pitch = 1) {
  noise(0.035, 0.22, 2400 * pitch, 6);
}

/** Начало прокрута: короткий разгон. */
export function sndSpinStart() {
  blip(180, 0.32, 'sawtooth', 0.18, 3.2);
  noise(0.3, 0.14, 900, 1.2);
}

/** Остановка ленты — глухой удар. */
export function sndLand() {
  blip(140, 0.16, 'square', 0.3, 0.6);
  noise(0.09, 0.3, 700, 1.5);
}

/**
 * Раскрытие приза. Чем выше редкость, тем выше и длиннее аккорд —
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

/** Крупный выигрыш — восходящая фанфара поверх раскрытия. */
export function sndBigWin() {
  [523, 659, 784, 1047, 1319].forEach((f, i) =>
    setTimeout(() => blip(f, 0.6, 'square', 0.28), i * 90));
  setTimeout(() => noise(0.5, 0.18, 3000, 0.7), 120);
}

/** Забрать выигрыш — «касса». */
export function sndCollect() {
  [880, 1175, 1568].forEach((f, i) =>
    setTimeout(() => blip(f, 0.35, 'sine', 0.45), i * 70));
  setTimeout(() => noise(0.25, 0.16, 5200, 0.8), 60);
}

/** Проигрыш — короткий спад. */
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

/** Рост множителя в краше — тон ползёт вверх вместе с ним. */
export function sndClimb(multiplier) {
  const f = 300 + Math.min(900, Math.log(multiplier) * 420);
  blip(f, 0.06, 'sine', 0.12);
}
