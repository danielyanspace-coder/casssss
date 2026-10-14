/**
 * Показ выигрыша и фриспинов: карточка срывается с ленты, сумма набирается
 * на глазах, покупка серии разворачивается в отдельную сцену.
 *
 * Задумка показана заказчику демо-файлом (tools/motion-demo.html) и принята,
 * здесь она перенесена в приложение. Правила, ради которых она так устроена:
 *
 *  - СИЛА ПОКАЗА - МНОЖИТЕЛЬ К ЦЕНЕ КЕЙСА, а не сумма. 8 600 в кейсе за 1 499
 *    это событие, а в кейсе за 100 000 нет;
 *  - ВОЗВРАТ МЕНЬШЕ СТАВКИ НЕ ПРАЗДНУЕТСЯ. Салют за проигрыш учит игрока, что
 *    проигрыш это успех;
 *  - НИЧТО НЕ ЖДЁТ НАЖАТИЯ ВЕЧНО. Окно выигрыша закрывается само через
 *    несколько секунд: игрок, который отвернулся, не должен найти приложение
 *    запертым, а автооткрытие и тесты не должны упираться в окно.
 *
 * Всё объявлено внутри createMotion: автономная сборка складывает модули
 * клиента в одну область видимости, и имена вроде wait, E или P столкнулись
 * бы с чужими (CLAUDE.md, «Одинаковые имена на верхнем уровне»).
 */

/*
 * Ступени показа. Пороги - множитель к цене кейса.
 * NICE: карточка приподнимается прямо в ленте, экран не перехватывается.
 * LEVELS: захват экрана; посреди счёта показ повышает ступень.
 */
export const MOTION_NICE_AT = 4;
export const MOTION_LEVELS = [
  { key: 'big',  at: 12,  word: 'BIG WIN',  pitch: 1,    color: '#ffd34d', countMs: 2600 },
  { key: 'mega', at: 50,  word: 'MEGA WIN', pitch: 1.26, color: '#ff5bd8', countMs: 4300 },
  { key: 'epic', at: 150, word: 'EPIC WIN', pitch: 1.5,  color: '#7df9ff', countMs: 6200 },
];

/**
 * @param {object} o
 * @param {(n:number)=>string} o.money     формат суммы
 * @param {(item:object)=>string} o.artFor рисунок предмета (svg)
 * @param {(tier:string)=>string} o.tierColor
 * @param {object} o.snd                   звуки из sounds.js
 * @param {(kind:string)=>void} o.haptic
 */
export function createMotion({ money, artFor, tierColor, snd, haptic = () => {} }) {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const QTY = REDUCED ? 0.35 : 1;
  const NB = ' ';
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const play = (name, ...args) => { try { snd[name]?.(...args); } catch { /* звук не обязателен */ } };
  const xFmt = (m) => `×${m >= 10 ? Math.round(m) : m.toFixed(1).replace('.', ',')}`;

  /* Кривые. Одна сетка на все движения: у каждого эффекта своя кривая -
     и экран дёргается вразнобой, читаясь как набор чужих анимаций. */
  const E = {
    out: 'cubic-bezier(.16,1,.3,1)',
    back: 'cubic-bezier(.34,1.56,.64,1)',
    in: 'cubic-bezier(.55,0,.8,.2)',
    inout: 'cubic-bezier(.65,0,.35,1)',
  };
  const anim = (el, kf, opts) => el.animate(kf, { fill: 'both', ...(typeof opts === 'number' ? { duration: opts } : opts) });

  /*
   * Акцент удара - свой у темы. Клинок наискосок и лепестки идут «Самураю» и
   * «Хайгардену», но не «Вегасу»: там они выглядели бы чужими. Ритм и кривые
   * общие, меняются только частицы.
   */
  const ACCENTS = {
    samurai: { slash: true, petals: true },
    shadow: { slash: true },
    westeros: { slash: true },
    winterfell: { slash: true },
    braavos: { slash: true },
    highgarden: { petals: true },
    santorini: { petals: true },
    phoenix: { petals: true },
  };
  let accent = {};

  /* ---------- Слои ---------- */

  let root = null, layer = null, top = null, cv = null, g = null;
  let W = 0, H = 0;

  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'mo-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div class="mo-layer"></div><canvas class="mo-canvas"></canvas><div class="mo-top"></div>';
    document.body.appendChild(root);
    layer = root.querySelector('.mo-layer');
    top = root.querySelector('.mo-top');
    cv = root.querySelector('canvas');
    g = cv.getContext('2d');
    fit();
    addEventListener('resize', fit);
  }
  function fit() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function el(tag, cls, parent) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    (parent || layer).append(d);
    return d;
  }
  const box = (node) => {
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };
  /* Колонка показа: на телефоне весь экран, на компьютере - столбец шириной
     с телефон посередине, иначе карточка и надписи растягиваются по окну. */
  const colX = () => W / 2;

  /*
   * Сцена уходит назад классом, а не анимацией. Анимация размытия с
   * заполнением однажды осталась висеть после отмены, и вся серия фриспинов
   * шла в тумане. У класса одно состояние, и reset() снимает его наверняка.
   */
  function recede(on) { document.body.classList.toggle('mo-receded', !!on); }

  /* ---------- Частицы ---------- */

  function sprite(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    return c;
  }
  function starPath(x, cx, cy, r1, r2, n = 5) {
    x.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? r2 : r1;
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    x.closePath();
  }
  /* Монета рисуется один раз в спрайт: сто монет градиентами на каждом кадре
     телефон не вытянет. Поворот - сжатием спрайта по ширине. */
  let COIN, COIN_BACK, PETAL;
  function sprites() {
    if (COIN) return;
    COIN = sprite(96, (x, s) => {
      const r = s / 2;
      const gr = x.createRadialGradient(r * 0.72, r * 0.6, 2, r, r, r);
      gr.addColorStop(0, '#fffbe0'); gr.addColorStop(0.35, '#ffd85a'); gr.addColorStop(0.78, '#d89420'); gr.addColorStop(1, '#7a4508');
      x.fillStyle = gr; x.beginPath(); x.arc(r, r, r - 1, 0, 7); x.fill();
      x.lineWidth = s * 0.05; x.strokeStyle = 'rgba(122,69,8,.7)'; x.beginPath(); x.arc(r, r, r * 0.76, 0, 7); x.stroke();
      x.fillStyle = 'rgba(110,60,6,.55)'; starPath(x, r + 1.5, r + 2, r * 0.42, r * 0.18); x.fill();
      x.fillStyle = '#fff2b8'; starPath(x, r, r, r * 0.42, r * 0.18); x.fill();
    });
    COIN_BACK = sprite(96, (x, s) => {
      const r = s / 2;
      const gr = x.createRadialGradient(r * 0.8, r * 0.7, 2, r, r, r);
      gr.addColorStop(0, '#ffe58a'); gr.addColorStop(0.5, '#c8841a'); gr.addColorStop(1, '#5a3006');
      x.fillStyle = gr; x.beginPath(); x.arc(r, r, r - 1, 0, 7); x.fill();
      x.lineWidth = s * 0.07; x.strokeStyle = 'rgba(255,230,150,.45)'; x.beginPath(); x.arc(r, r, r * 0.62, 0, 7); x.stroke();
    });
    PETAL = sprite(48, (x, s) => {
      const gr = x.createLinearGradient(0, 0, s, s);
      gr.addColorStop(0, '#fff0f6'); gr.addColorStop(0.5, '#ffb3d1'); gr.addColorStop(1, '#ff6aa6');
      x.fillStyle = gr;
      x.beginPath();
      x.moveTo(s / 2, s * 0.06);
      x.bezierCurveTo(s * 0.95, s * 0.2, s * 0.9, s * 0.8, s / 2, s * 0.96);
      x.bezierCurveTo(s * 0.1, s * 0.8, s * 0.05, s * 0.2, s / 2, s * 0.06);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,.45)';
      x.beginPath(); x.ellipse(s * 0.42, s * 0.36, s * 0.08, s * 0.2, -0.4, 0, 7); x.fill();
    });
  }
  const glowCache = {};
  const glowSprite = (color) => (glowCache[color] ||= sprite(64, (x, s) => {
    const gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, color); gr.addColorStop(0.35, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
  }));

  const P = [];
  const EM = [];
  let raf = 0, lastT = 0;
  const kick = () => { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(loop); } };
  const add = (p) => { mount(); sprites(); P.push(Object.assign({ age: 0, life: 2, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0 }, p)); kick(); };
  const emit = (ms, every, fn) => { const e = { left: ms, every, acc: every, fn }; EM.push(e); kick(); return e; };
  const stopEmit = (e) => { const i = EM.indexOf(e); if (i >= 0) EM.splice(i, 1); };

  function loop(now) {
    const dt = Math.min(0.034, (now - lastT) / 1000);
    lastT = now;
    for (let i = EM.length - 1; i >= 0; i--) {
      const e = EM[i];
      e.left -= dt * 1000; e.acc += dt * 1000;
      while (e.acc >= e.every) { e.acc -= e.every; e.fn(); }
      if (e.left <= 0) EM.splice(i, 1);
    }
    g.clearRect(0, 0, W, H);
    const glows = [];
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life || (p.t !== 'fly' && p.y > H + 80 && p.vy > 0)) {
        P.splice(i, 1);
        if (p.age >= p.life) p.done?.();
        continue;
      }
      step(p, dt);
      if (p.t === 'spark' || p.t === 'glow' || p.t === 'pull') glows.push(p); else draw(p);
    }
    g.globalCompositeOperation = 'lighter';
    for (const p of glows) draw(p);
    g.globalCompositeOperation = 'source-over';
    if (P.length || EM.length) raf = requestAnimationFrame(loop);
    else { raf = 0; g.clearRect(0, 0, W, H); }
  }

  function step(p, dt) {
    if (p.t === 'fly') {
      const u = p.age / p.life;
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const a = 1 - e;
      p.x = a * a * p.x0 + 2 * a * e * p.cx + e * e * p.x1;
      p.y = a * a * p.y0 + 2 * a * e * p.cy + e * e * p.y1;
      p.ph += p.vph * dt;
      return;
    }
    if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
    p.vy += p.g * dt;
    if (p.t === 'petal' || p.t === 'conf') {
      p.vy = Math.min(p.vy, p.term || 140);
      p.x += Math.sin(p.age * 2.6 + p.sw) * 34 * dt;
    }
    if (p.t === 'pull') {
      // Искру тянет к центру заряда: ускоряется к цели и гаснет у неё.
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 2400 * dt; p.vy += (dy / d) * 2400 * dt;
      if (d < 10) p.age = p.life;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.vr) p.rot += p.vr * dt;
    if (p.vph) p.ph += p.vph * dt;
  }

  function draw(p) {
    const fade = Math.min(1, (p.life - p.age) / (p.fade || 0.35));
    if (p.t === 'coin' || p.t === 'fly') {
      const c = Math.cos(p.ph);
      const sx = Math.max(0.1, Math.abs(c));
      g.save();
      g.globalAlpha = p.t === 'fly' ? 1 : fade;
      g.translate(p.x, p.y);
      g.rotate(p.rot || 0);
      // Ребро: без него сжатый спрайт читается плоским кружком, а не монетой.
      if (sx < 0.95) {
        g.fillStyle = '#7a4508';
        g.beginPath();
        g.ellipse(Math.sign(c || 1) * p.r * 0.14 * (1 - sx), 0, p.r * sx + 1.2, p.r, 0, 0, 7);
        g.fill();
      }
      g.scale(sx, 1);
      g.drawImage(c >= 0 ? COIN : COIN_BACK, -p.r, -p.r, p.r * 2, p.r * 2);
      g.restore();
    } else if (p.t === 'spark' || p.t === 'pull') {
      g.globalAlpha = fade;
      g.strokeStyle = p.color;
      g.lineWidth = p.w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028);
      g.stroke();
      g.globalAlpha = 1;
    } else if (p.t === 'glow') {
      g.globalAlpha = Math.min(1, p.age / 0.4) * fade * (p.a ?? 0.6);
      g.drawImage(glowSprite(p.color), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      g.globalAlpha = 1;
    } else {
      g.save();
      g.globalAlpha = fade;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.max(0.15, Math.abs(Math.cos(p.ph))));
      if (p.t === 'petal') g.drawImage(PETAL, -p.r, -p.r, p.r * 2, p.r * 2);
      else { g.fillStyle = p.color; g.fillRect(-p.r / 2, -p.r, p.r, p.r * 2); }
      g.restore();
    }
  }

  function sparks(x, y, n, colors, speed = 560, o = {}) {
    n = Math.round(n * QTY);
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + rand(-o.spread, o.spread) : rand(0, Math.PI * 2);
      const v = speed * rand(0.35, 1);
      add({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.g ?? 260, drag: o.drag ?? 2.4, life: rand(0.45, 1.1), color: pick(colors), w: rand(1.2, 2.8) });
    }
  }
  function coins(x, y, n, { speed = 640, angle = -Math.PI / 2, spread = Math.PI * 0.55, r = [8, 15], g: grav = 1500 } = {}) {
    n = Math.round(n * QTY);
    for (let i = 0; i < n; i++) {
      const a = angle + rand(-spread, spread);
      const v = speed * rand(0.55, 1.1);
      add({ t: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: grav, r: rand(r[0], r[1]), rot: rand(-0.4, 0.4), vr: rand(-2, 2), ph: rand(0, 6), vph: rand(7, 16), life: 2.6, fade: 0.5 });
    }
  }
  /* Падающие сверху частицы темы: лепестки или конфетти её цветов. */
  function shower(n, colors) {
    n = Math.round(n * QTY);
    for (let i = 0; i < n; i++) {
      const base = { x: rand(0, W), y: -20 + rand(-60, 0), vx: rand(-40, 40), vy: rand(30, 120), g: 90, term: rand(70, 130), rot: rand(0, 6), vr: rand(-3, 3), ph: rand(0, 6), vph: rand(3, 7), sw: rand(0, 6), life: rand(3.6, 5.4), fade: 0.8 };
      add(accent.petals ? { ...base, t: 'petal', r: rand(6, 11) } : { ...base, t: 'conf', r: rand(3, 5), color: pick(colors) });
    }
  }
  function burst(x, y, n, colors) {
    n = Math.round(n * QTY);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(150, 520);
      const base = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 160, drag: 1.6, term: rand(70, 130), rot: rand(0, 6), vr: rand(-4, 4), ph: rand(0, 6), vph: rand(3, 8), sw: rand(0, 6), life: rand(2.6, 4), fade: 0.8 };
      add(accent.petals ? { ...base, t: 'petal', r: rand(6, 11) } : { ...base, t: 'conf', r: rand(3, 5), color: pick(colors) });
    }
  }
  function bokeh(n, colors) {
    n = Math.round(n * QTY);
    for (let i = 0; i < n; i++) {
      add({ t: 'glow', x: rand(0, W), y: rand(H * 0.1, H * 0.9), vx: rand(-8, 8), vy: rand(-26, -6), r: rand(8, 26), color: pick(colors), a: rand(0.25, 0.6), life: rand(2.2, 4), fade: 1 });
    }
  }
  function pull(x, y, n, colors, radius = 170) {
    n = Math.round(n * QTY);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), r = radius * rand(0.7, 1.2);
      add({ t: 'pull', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.sin(a) * 120, vy: Math.cos(a) * 120, tx: x, ty: y, drag: 1.2, life: 0.9, color: pick(colors), w: rand(1.2, 2.4) });
    }
  }
  /** Монета по дуге в точку: на баланс или в счётчик серии. */
  function flyCoin(x0, y0, x1, y1, delay, done) {
    setTimeout(() => add({ t: 'fly', x0, y0, x1, y1, cx: (x0 + x1) / 2 + rand(-120, 120), cy: Math.min(y0, y1) - rand(60, 180), x: x0, y: y0, r: rand(8, 12), ph: rand(0, 6), vph: 14, life: rand(0.6, 0.85), done }), delay);
  }

  /* ---------- Экранные эффекты ---------- */

  function flash(color, strength = 0.8, dur = 520) {
    mount();
    const f = el('div', 'mo-flash', top);
    f.style.background = `radial-gradient(circle at 50% 40%, ${color}, transparent 75%)`;
    anim(f, [{ opacity: strength }, { opacity: 0 }], { duration: dur, easing: E.out }).onfinish = () => f.remove();
  }
  function ring(x, y, color, scale = 4, dur = 700, delay = 0) {
    mount();
    const r = el('div', 'mo-ring', top);
    r.style.left = `${x}px`; r.style.top = `${y}px`; r.style.setProperty('--c', color);
    anim(r, [{ transform: 'scale(.1)', opacity: 1, borderWidth: '8px' }, { transform: `scale(${scale})`, opacity: 0, borderWidth: '1px' }], { duration: dur, delay, easing: E.out }).onfinish = () => r.remove();
  }
  function slash(y, color = '#ffd34d', angle = -22) {
    if (!accent.slash) return;
    mount();
    const s = el('div', 'mo-slash', top);
    s.style.top = `${y}px`; s.style.setProperty('--c', color); s.style.rotate = `${angle}deg`;
    play('sndSlash');
    anim(s, [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.35 }, { transform: 'scaleX(1) scaleY(.2)', opacity: 0 }], { duration: 420, easing: E.out }).onfinish = () => s.remove();
  }
  /* Тряска затухает по экспоненте: ровная тряска читается как сбой экрана,
     а не как удар. Через свойство translate - transform у экрана свой. */
  function shake(power = 10, dur = 520) {
    if (REDUCED) return;
    const target = document.getElementById('opener');
    if (!target || target.hidden) return;
    const frames = [];
    for (let i = 0; i <= 12; i++) {
      const k = Math.pow(1 - i / 12, 2) * power;
      frames.push({ translate: i === 12 ? '0 0' : `${rand(-k, k).toFixed(1)}px ${rand(-k, k).toFixed(1)}px` });
    }
    target.animate(frames, { duration: dur, easing: 'linear' });
  }
  function impact(x, y, color, power = 1) {
    flash(color, 0.75 * power);
    ring(x, y, color, 4.5);
    ring(x, y, '#ffffff', 3, 600, 90);
    sparks(x, y, 90 * power, ['#ffffff', color, '#ffd34d'], 760);
    shake(12 * power, 560);
    play('sndBoom');
    haptic('heavy');
  }
  function floatText(text, x, y, { muted = false, color = '#9dffcf', to = null, dur = 900, size = 0 } = {}) {
    mount();
    const f = el('div', `mo-float${muted ? ' is-muted' : ''}`, top);
    f.textContent = text;
    f.style.left = `${x}px`; f.style.top = `${y}px`; f.style.setProperty('--c', color);
    if (size) f.style.fontSize = `${size}px`;
    const kf = to
      ? [{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: 'translate(0,-26px) scale(1.15)', opacity: 1, offset: 0.25 }, { transform: `translate(${to.x - x}px, ${to.y - y}px) scale(.6)`, opacity: 0.9 }]
      : [{ transform: 'translate(0,6px) scale(.6)', opacity: 0 }, { transform: 'translate(0,-20px) scale(1.1)', opacity: 1, offset: 0.3 }, { transform: 'translate(0,-40px) scale(1)', opacity: 0 }];
    anim(f, kf, { duration: dur, easing: to ? E.inout : E.out }).onfinish = () => f.remove();
    return f;
  }

  /* ---------- Карточка выигрыша ---------- */

  function heroCard(item) {
    const d = document.createElement('div');
    d.className = 'mo-hero';
    const skin = item.skin || {};
    d.dataset.family = skin.family || 'slate';
    d.dataset.material = skin.material || 'matte';
    d.style.setProperty('--tc', tierColor(item.tier));
    // Форма режет грани, а не саму карточку: clip-path на элементе с
    // preserve-3d схлопывает его в плоскость, и оборот в воздухе пропадает.
    const shape = skin.shape || 'card';
    d.innerHTML = `
      <div class="mo-hero-glow"></div>
      <div class="mo-face mo-front" data-shape="${shape}">
        <div class="mo-hero-spot"></div>
        <div class="mo-hero-foil"></div>
        <div class="mo-hero-art">${artFor(item)}</div>
        <div class="mo-hero-name"></div>
        <div class="mo-hero-sheen"></div>
      </div>
      <div class="mo-face mo-back" data-shape="${shape}"><b class="mo-metal">LB</b></div>`;
    d.querySelector('.mo-hero-name').textContent = item.name;
    return d;
  }

  /** Надпись ступени влетает по буквам. */
  function stampLabel(label, word) {
    const w = document.createElement('div');
    w.className = 'mo-word';
    w.innerHTML = [...word].map((ch) => `<span class="mo-metal">${ch === ' ' ? NB : ch}</span>`).join('');
    label.append(w);
    [...w.children].forEach((sp, i) => {
      // fill: backwards - после входа фильтр возвращается к теням металла из
      // CSS. С forwards на буквах навсегда остался бы blur(0), и объём надписи
      // пропадал бы ровно в момент, когда её читают.
      anim(sp, [
        { transform: 'translateY(30px) scale(2.2) rotateX(-80deg)', opacity: 0, filter: 'blur(6px)' },
        { transform: 'none', opacity: 1, filter: 'blur(0)' },
      ], { duration: 560, delay: i * 38, easing: E.back, fill: 'backwards' });
    });
  }

  const levelOf = (m) => {
    let lv = -1;
    MOTION_LEVELS.forEach((L, i) => { if (m >= L.at) lv = i; });
    return lv;
  };

  /* ---------- Выигрыш ---------- */

  /**
   * Показ выигрыша по множителю.
   *
   * @param {object} item    предмет из ответа сервера (value, tier, skin, art)
   * @param {object} o
   * @param {Element} [o.tile]   плитка ленты, с которой срывается карточка
   * @param {number} o.price      цена кейса
   * @param {string} [o.theme]    тема кейса - акцент удара
   * @param {boolean} [o.inSeries] внутри серии фриспинов: всё короче
   * @param {boolean} [o.auto]     автооткрытие: без захвата экрана надолго
   * @param {Element} [o.collectTo] куда летят монеты при сборе
   */
  async function win(item, o) {
    mount();
    accent = ACCENTS[o.theme] || {};
    const value = item.value || 0;
    if (!value || !o.price) return;
    const m = value / o.price;
    const tb = o.tile ? box(o.tile) : { cx: W / 2, cy: H * 0.45, x: W / 2 - 52, y: H * 0.45 - 66, w: 104, h: 132 };

    if (m < 1) {
      // Возврат меньше ставки: подсветка и сумма, без единой искры.
      if (!o.inSeries) { floatText(money(value), tb.cx, tb.y - 4, { muted: true, dur: 1200 }); play('sndSoft'); }
      return;
    }
    if (m < MOTION_NICE_AT) {
      if (!o.inSeries) floatText(`+${money(value)}`, tb.cx, tb.y - 4, { dur: 1100 });
      sparks(tb.cx, tb.y + 10, 18, ['#9dffcf', '#ffffff'], 300, { angle: -Math.PI / 2, spread: 1.1 });
      play('sndChime');
      return;
    }
    if (levelOf(m) < 0 || (o.auto && levelOf(m) < 1)) {
      await lift(item, o.tile, tb, o);
      return;
    }
    await bigWin(item, o.tile, tb, m, o);
  }

  /* ×4…×12: карточка приподнимается прямо в ленте. Это хороший прокрут, но
     ещё не событие, и экран у игрока не забирается. */
  async function lift(item, tile, tb, o) {
    const color = tierColor(item.tier);
    const wrap = el('div', 'mo-lift');
    wrap.style.left = `${tb.cx}px`; wrap.style.top = `${tb.cy}px`;
    const card = heroCard(item);
    card.style.setProperty('--cut', '10px');
    wrap.append(card);
    const s = tb.w / 196;
    if (tile) tile.classList.add('mo-lifted');
    anim(card, [
      { transform: `scale(${s})` },
      { transform: `translateY(-34px) scale(${s * 1.32}) rotateX(8deg)`, offset: 0.45 },
      { transform: `translateY(-26px) scale(${s * 1.26})` },
    ], { duration: 700, easing: E.back });
    ring(tb.cx, tb.cy - 26, color, 2.4, 600);
    sparks(tb.cx, tb.cy - 26, 40, ['#ffffff', color, '#ffd34d'], 420);
    play('sndChime');
    play('sndWhoosh');
    haptic('medium');
    await sleep(260);
    floatText(`+${money(item.value)}`, tb.cx, tb.y - 54, { dur: 1700, color, size: 20 });
    coins(tb.cx, tb.cy - 30, 14, { speed: 520 });
    for (let i = 0; i < 6; i++) setTimeout(() => play('sndCoin'), i * 70);
    await sleep(o.inSeries || o.auto ? 1000 : 1500);
    anim(card, [{ transform: `translateY(-26px) scale(${s * 1.26})` }, { transform: `scale(${s})`, opacity: 0.6 }], { duration: 380, easing: E.inout });
    await sleep(380);
    wrap.remove();
    if (tile) tile.classList.remove('mo-lifted');
  }

  /* ×12 и выше: захват экрана со ступенями BIG, MEGA, EPIC. */
  async function bigWin(item, tile, tb, m, o) {
    const finalLv = levelOf(m);
    const color = tierColor(item.tier);

    const wl = el('div', 'mo-wl');
    wl.dataset.tier = 'big';
    wl.innerHTML = `
      <div class="mo-wl-dim"></div>
      <div class="mo-tunnel">${Array.from({ length: 7 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <div class="mo-sky"><div class="mo-bloom"></div><div class="mo-rays"></div><div class="mo-rays b"></div></div>
      <div class="mo-card-slot"></div>
      <div class="mo-label"></div>
      <div class="mo-amount"></div>
      <div class="mo-sub">${xFmt(m)} к цене кейса</div>
      <button class="mo-take" type="button">${o.inSeries ? 'Дальше' : 'Забрать'}</button>
      <div class="mo-bar t"></div><div class="mo-bar b"></div>
      <div class="mo-skip">нажмите, чтобы пропустить</div>`;
    const sky = wl.querySelector('.mo-sky');
    const slot = wl.querySelector('.mo-card-slot');
    const label = wl.querySelector('.mo-label');
    const amount = wl.querySelector('.mo-amount');

    // 0. Сцена уходит назад: карточке есть куда выйти.
    if (tile) tile.classList.add('mo-lifted');
    recede(true);
    anim(wl.querySelector('.mo-wl-dim'), [{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: E.out });
    sky.style.opacity = '0';
    amount.style.opacity = '0';
    play('sndWhoosh');

    // 1. Карточка срывается с ленты и делает оборот в воздухе.
    const card = heroCard(item);
    slot.append(card);
    const fb = box(slot);
    const s = tb.w / 196;
    const dx = tb.cx - fb.cx, dy = tb.cy - fb.cy;
    anim(card, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotateY(0deg)` },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 50}px) scale(${s + (1 - s) * 0.75}) rotateY(230deg) rotateZ(-6deg)`, offset: 0.6 },
      { transform: 'translate(0, 0) scale(1) rotateY(360deg) rotateZ(0deg)' },
    ], { duration: 980, easing: E.out });
    emit(820, 18, () => { const b = box(card); sparks(b.cx, b.cy, 3, ['#ffffff', color], 160, { g: 0 }); });
    await sleep(900);

    // 2. Удар.
    impact(fb.cx, fb.cy, MOTION_LEVELS[0].color, 1);
    slash(fb.cy + 20, MOTION_LEVELS[0].color);
    coins(fb.cx, fb.cy, 26, { speed: 760, spread: Math.PI * 0.6 });
    burst(fb.cx, fb.cy, 26, ['#ffd34d', '#ff9a1f', '#fff6cf', color]);
    anim(slot, [{ translate: '0 0' }, { translate: '0 -6px' }], { duration: 1600, easing: E.inout, iterations: Infinity, direction: 'alternate', delay: 300 });
    anim(sky, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 800, easing: E.out });
    const rays = [...wl.querySelectorAll('.mo-rays')].map((r, i) =>
      r.animate([{ rotate: '0deg' }, { rotate: `${i ? -360 : 360}deg` }], { duration: i ? 46000 : 30000, iterations: Infinity }));
    bokeh(14, ['#ffd34d', '#ff9a1f', '#fff6cf']);
    stampLabel(label, MOTION_LEVELS[0].word);
    anim(amount, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: E.out });
    play('sndHit', 1);
    await sleep(250);

    // 3. Счёт. Множитель растёт по логарифму, а не линейно: иначе ступени
    // проскакивали бы в первые доли секунды, а дальше тянулся один хвост.
    const dur = o.auto ? 1600 : MOTION_LEVELS[finalLv].countMs;
    let skip = false;
    const onSkip = () => { skip = true; };
    wl.addEventListener('pointerdown', onSkip);
    play('sndRiser', dur / 1000);
    const fountain = emit(dur, 60, () => coins(colX() + rand(-40, 40), H + 10, 1, { speed: 1250, spread: 0.32, r: [9, 14], g: 1500 }));
    let lv = 0;
    await new Promise((resolve) => {
      const t0 = performance.now();
      let lastCoin = 0;
      const lnM = Math.log(m);
      const fr = (now) => {
        if (!wl.isConnected) return resolve();
        const p = skip ? 1 : Math.min(1, (now - t0) / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const cm = Math.exp(lnM * e);
        // Округление обязательно: формат суммы приложения дробь не режет, и
        // посреди счёта на экране стояли бы копейки.
        amount.textContent = money(Math.round(o.price * cm - o.price * (1 - e)));
        while (lv < finalLv && cm >= MOTION_LEVELS[lv + 1].at) { lv++; levelUp(wl, label, lv, rays, fb); }
        if (now - lastCoin > 75 && !skip) { play('sndCoin'); lastCoin = now; }
        if (p >= 1) resolve(); else requestAnimationFrame(fr);
      };
      requestAnimationFrame(fr);
    });
    wl.removeEventListener('pointerdown', onSkip);
    stopEmit(fountain);
    if (!wl.isConnected) return;

    // 4. Итог: сумма встаёт на место с отдачей.
    const L = MOTION_LEVELS[finalLv];
    amount.textContent = money(item.value);
    anim(amount, [{ transform: 'scale(1.35)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 600, easing: E.back });
    const ab = box(amount);
    ring(ab.cx, ab.cy, L.color, 3, 700);
    sparks(ab.cx, ab.cy, 70, ['#ffffff', L.color], 620);
    shower(40 + finalLv * 30, ['#ffd34d', L.color, '#ffffff', color]);
    play('sndFanfare', L.pitch);
    haptic('success');
    anim(wl.querySelector('.mo-sub'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 200, easing: E.out });
    anim(wl.querySelector('.mo-skip'), [{ opacity: 1 }, { opacity: 0 }], 300);
    const take = wl.querySelector('.mo-take');
    anim(take, [{ opacity: 0, transform: 'translateY(30px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 550, easing: E.back });
    take.style.pointerEvents = 'auto';

    // Окно не ждёт нажатия вечно: отвернувшийся игрок не должен найти
    // приложение запертым, а автооткрытие - встать.
    await new Promise((resolve) => {
      take.addEventListener('click', resolve, { once: true });
      setTimeout(resolve, o.inSeries || o.auto ? 2400 : 4200);
    });
    if (!wl.isConnected) return;

    // 5. Сбор: монеты летят на баланс или в счётчик серии.
    const target = o.collectTo ? box(o.collectTo) : { cx: W - 60, cy: 30 };
    for (let i = 0; i < 20; i++) flyCoin(ab.cx + rand(-60, 60), ab.cy + rand(-8, 8), target.cx, target.cy, i * 30, () => play('sndCoin'));
    play('sndWhoosh', false);
    anim(wl, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 250, easing: E.inout });
    recede(false);
    await sleep(760);
    wl.remove();
    if (tile) tile.classList.remove('mo-lifted');
  }

  /** Переход на следующую ступень посреди счёта. */
  function levelUp(wl, label, lv, rays, fb) {
    const L = MOTION_LEVELS[lv];
    const old = label.querySelector('.mo-word:not(.out)');
    if (old) {
      old.classList.add('out');
      anim(old, [{ transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(1.6)', opacity: 0, filter: 'blur(10px)' }], { duration: 420, easing: E.out }).onfinish = () => old.remove();
    }
    wl.dataset.tier = L.key;
    stampLabel(label, L.word);
    flash(L.color, 0.9, 650);
    ring(fb.cx, fb.cy, L.color, 5, 800);
    slash(fb.cy - 30 + lv * 40, L.color, lv % 2 ? 24 : -22);
    shake(12 + lv * 5, 620);
    sparks(fb.cx, fb.cy, 110, ['#ffffff', L.color], 900);
    coins(fb.cx, fb.cy, 30, { speed: 900, spread: Math.PI });
    play('sndBoom');
    play('sndHit', L.pitch);
    haptic('heavy');
    rays.forEach((a) => a.updatePlaybackRate(1 + lv * 1.6));
    bokeh(10, [L.color, '#ffffff']);
    if (L.key === 'epic') {
      // Третья ступень меняет кадр целиком: кинорамка и световой тоннель.
      wl.querySelectorAll('.mo-bar').forEach((b) => anim(b, [{ height: '0px' }, { height: '9%' }], { duration: 700, easing: E.out }));
      anim(wl.querySelector('.mo-tunnel'), [{ opacity: 0 }, { opacity: 1 }], { duration: 600 });
      emit(5200, 70, () => coins(rand(0, W), -20, 1, { speed: 120, angle: Math.PI / 2, spread: 0.3, g: 900 }));
      shower(60, [L.color, '#ffffff', '#ffd34d']);
    }
  }

  /* ---------- Фриспины ---------- */

  const FS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#6e3c06" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3"/><path d="M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/></svg>';

  /**
   * Пролог серии: сгусток энергии, взрыв, эмблема, FREE SPINS, жетоны.
   *
   * @param {object} o
   * @param {number} o.count       сколько прокрутов в серии на старте
   * @param {Element} [o.origin]   откуда летит сгусток: кнопка покупки или плитка
   * @param {string} o.emblem      рисунок эмблемы (svg)
   * @param {string} [o.theme]
   * @param {() => {pips: Element[], emblem: Element, onToken: (i:number)=>void}} o.prepare
   *        открывает бонусный режим и отдаёт, куда садятся жетоны
   */
  async function purchase(o) {
    mount();
    accent = ACCENTS[o.theme] || {};
    const count = o.count;
    const cx = colX(), cy = H * 0.34;
    // Откуда летит сгусток: элемент или заранее снятые координаты. Кнопку
    // покупки прячут вместе с панелью кейса раньше, чем начнётся пролог, и
    // у спрятанной прямоугольник нулевой - сгусток вылетел бы из угла.
    let ob = null;
    if (o.origin?.getBoundingClientRect) { const b = box(o.origin); if (b.w) ob = b; }
    else if (o.origin && o.origin.cx != null) ob = o.origin;
    ob ||= { cx, cy: H * 0.8 };

    // 1. Сгусток летит в центр по дуге.
    const orb = el('div', 'mo-orb', top);
    orb.style.left = `${ob.cx}px`; orb.style.top = `${ob.cy}px`;
    const dim = el('div', 'mo-dim');
    anim(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: E.out });
    recede(true);
    const to = (k) => `translate(${(cx - ob.cx) * k}px, ${(cy - ob.cy) * k}px)`;
    anim(orb, [
      { transform: 'translate(0,0) scale(.6)' },
      { transform: `translate(${(cx - ob.cx) * 0.4 + 60}px, ${(cy - ob.cy) * 0.55}px) scale(1.4)`, offset: 0.5 },
      { transform: `${to(1)} scale(2.2)` },
    ], { duration: 560, easing: E.inout });
    play('sndWhoosh');
    emit(540, 16, () => { const b = box(orb); sparks(b.cx, b.cy, 3, ['#fff6cf', '#ffd34d', '#ff8a1f'], 140, { g: 60 }); });
    await sleep(560);

    // 2. Заряд: искры стягиваются к сгустку.
    play('sndRiser', 0.7);
    emit(620, 40, () => pull(cx, cy, 6, ['#fff6cf', '#ffd34d', '#c79cff']));
    anim(orb, [
      { transform: `${to(1)} scale(2.2)` },
      { transform: `${to(1)} scale(3.6)`, offset: 0.4 },
      { transform: `${to(1)} scale(2.8)`, offset: 0.6 },
      { transform: `${to(1)} scale(5)` },
    ], { duration: 700, easing: E.in });
    haptic('medium');
    await sleep(700);

    // 3. Взрыв.
    orb.remove();
    impact(cx, cy, '#ffd34d', 1.2);
    slash(cy + 10, '#ffd34d');
    ring(cx, cy, '#c79cff', 6, 900, 120);
    coins(cx, cy, 34, { speed: 900, spread: Math.PI });
    burst(cx, cy, 30, ['#ffd34d', '#c79cff', '#7df9ff']);
    bokeh(16, ['#ffd34d', '#c79cff', '#7df9ff']);

    // 4. Эмблема, надпись, число.
    const show = el('div', 'mo-fs-show');
    show.innerHTML = `
      <div class="mo-sky" style="top:29%"><div class="mo-bloom" style="background:radial-gradient(circle, rgba(255,190,70,.5), transparent 64%)"></div><div class="mo-rays" style="--c2:#ffd34d"></div><div class="mo-rays b" style="--c1:#fff6cf"></div></div>
      <div class="mo-fs-emblem">${o.emblem || ''}</div>
      <div class="mo-fs-title"><div></div><div></div></div>
      <div class="mo-fs-count" style="opacity:0"><span class="mo-metal">${count}</span></div>
      <div class="mo-fs-sub">бесплатных прокрутов</div>`;
    const sky = show.querySelector('.mo-sky');
    anim(sky, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 900, easing: E.out });
    [...show.querySelectorAll('.mo-rays')].forEach((r, i) => r.animate([{ rotate: '0deg' }, { rotate: `${i ? -360 : 360}deg` }], { duration: i ? 40000 : 24000, iterations: Infinity }));
    const emb = show.querySelector('.mo-fs-emblem');
    anim(emb, [
      { transform: 'perspective(600px) rotateY(90deg) scale(.4)', opacity: 0 },
      { transform: 'perspective(600px) rotateY(-12deg) scale(1.08)', opacity: 1, offset: 0.6 },
      { transform: 'perspective(600px) rotateY(0deg) scale(1)', opacity: 1 },
    ], { duration: 800, easing: E.out });

    const title = show.querySelector('.mo-fs-title');
    [['FREE', -1], ['SPINS', 1]].forEach(([word, dir], wi) => {
      const holder = title.children[wi];
      holder.innerHTML = [...word].map((ch) => `<span class="mo-metal">${ch}</span>`).join('');
      [...holder.children].forEach((sp, i) => {
        const order = dir < 0 ? word.length - 1 - i : i;
        anim(sp, [
          { transform: `translateX(${dir * 160}px) skewX(${-dir * 24}deg) scale(1.3)`, opacity: 0, filter: 'blur(8px)' },
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
        ], { duration: 620, delay: 120 + order * 45, easing: E.out, fill: 'backwards' });
        // Блик пробегает по буквам волной, а не одним пятном.
        anim(sp, [{ backgroundPosition: '0 0%' }, { backgroundPosition: '0 100%' }], { duration: 1400, delay: 900 + i * 60, easing: E.inout, iterations: 2, direction: 'alternate' });
      });
    });
    play('sndWhoosh');
    await sleep(420);

    const num = show.querySelector('.mo-fs-count');
    anim(num, [
      { transform: 'translateY(-40px) scale(3)', opacity: 0, filter: 'blur(14px)' },
      { transform: 'translateY(4px) scale(.94)', opacity: 1, filter: 'blur(0)', offset: 0.7 },
      { transform: 'none', opacity: 1, filter: 'blur(0)' },
      // Анимируется обёртка, а металл - на числе внутри: blur(0) с
      // заполнением на самом числе стёр бы его тени объёма.
    ], { duration: 520, easing: E.out });
    await sleep(360);
    const nb = box(num);
    ring(nb.cx, nb.cy, '#ffd34d', 3.2, 600);
    sparks(nb.cx, nb.cy + 30, 50, ['#ffffff', '#ffd34d'], 520, { angle: -Math.PI / 2, spread: 1.4 });
    shake(9, 420);
    play('sndBoom');
    play('sndHit', count >= 20 ? 1.26 : 1);
    anim(show.querySelector('.mo-fs-sub'), [{ opacity: 0, transform: 'translateY(10px)', letterSpacing: '.5em' }, { opacity: 1, transform: 'none', letterSpacing: '.16em' }], { duration: 700, easing: E.out });
    await sleep(420);

    // 5. Жетоны раздаются веером: по одному на прокрут. Видно поштучно, а не
    // только цифрой.
    const many = count > 20;
    const perRow = Math.min(10, count);
    const size = many ? 22 : 26;
    const gap = many ? 4 : 6;
    const rowsTop = H * 0.76;
    const toks = [];
    const step = many ? 28 : 46;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, count - row * perRow);
      const x = cx + (col - (inRow - 1) / 2) * (size + gap);
      const y = rowsTop + row * (size + gap) + Math.abs(col - (inRow - 1) / 2) * 1.6;
      const t = el('div', 'mo-tok', top);
      t.style.setProperty('--s', `${size}px`);
      t.style.left = `${x}px`; t.style.top = `${y}px`;
      t.innerHTML = FS_ICON;
      anim(t, [
        { transform: `translate(${cx - x}px, ${nb.cy - y}px) scale(.2) rotate(-180deg)`, opacity: 0 },
        { transform: 'translate(0, -8px) scale(1.15) rotate(0deg)', opacity: 1, offset: 0.75 },
        { transform: 'none', opacity: 1 },
      ], { duration: 520, delay: i * step, easing: E.out });
      setTimeout(() => play('sndDeal', i), i * step + 300);
      toks.push(t);
    }
    await sleep(count * step + 900);

    // 6. Бонусный режим: показ уезжает вверх, эмблема перелетает в шапку
    // серии, жетоны садятся в свои ячейки.
    const target = o.prepare();
    const eb = box(emb);
    const tb = target.emblem ? box(target.emblem) : null;
    if (target.emblem) target.emblem.style.visibility = 'hidden';
    if (tb && tb.w) {
      anim(emb, [{ transform: 'none' }, { transform: `translate(${tb.cx - eb.cx}px, ${tb.cy - eb.cy}px) scale(${tb.w / eb.w})` }], { duration: 700, easing: E.inout });
    } else {
      anim(emb, [{ opacity: 1 }, { opacity: 0 }], 400);
    }
    [...show.children].filter((c) => c !== emb).forEach((c) => anim(c, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-50px) scale(.85)' }], { duration: 520, easing: E.in }));
    anim(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 900, delay: 200, easing: E.inout });
    recede(false);
    play('sndWhoosh', false);
    await sleep(350);
    const tstep = many ? 22 : 38;
    toks.forEach((t, i) => {
      const pip = target.pips[i];
      const b = box(t);
      const hb = pip ? box(pip) : (tb || { cx, cy: 80 });
      anim(t, [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${(hb.cx - b.cx) * 0.4 + rand(-40, 40)}px, ${(hb.cy - b.cy) * 0.5 - 40}px) scale(1.1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${hb.cx - b.cx}px, ${hb.cy - b.cy}px) scale(.3)`, opacity: 0.2 },
      ], { duration: 560, delay: i * tstep, easing: E.inout });
      setTimeout(() => { target.onToken?.(i); t.remove(); }, i * tstep + 540);
    });
    await sleep(count * tstep + 700);
    if (target.emblem) target.emblem.style.visibility = '';
    show.remove();
    dim.remove();
  }

  /** Ретриггер: новые жетоны вылетают из плитки в новые ячейки серии. */
  function retrigger(tile, pips, onToken) {
    mount();
    const b = box(tile);
    flash('#ff7a3a', 0.6);
    ring(b.cx, b.cy, '#ff7a3a', 3.4, 700);
    sparks(b.cx, b.cy, 70, ['#ffffff', '#ffb36a', '#ff7a3a'], 620);
    play('sndFanfare', 1.12);
    haptic('success');
    floatText(`+${pips.length} FS`, b.cx, b.y - 10, { color: '#ff7a3a', dur: 1200 });
    pips.forEach((pip, k) => {
      const t = el('div', 'mo-tok', top);
      t.innerHTML = FS_ICON;
      t.style.left = `${b.cx}px`; t.style.top = `${b.cy}px`;
      const hb = box(pip);
      anim(t, [
        { transform: 'scale(.3)', opacity: 0 },
        { transform: `translate(${rand(-90, 90)}px, ${rand(-80, -30)}px) scale(1.2)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${hb.cx - b.cx}px, ${hb.cy - b.cy}px) scale(.3)`, opacity: 0.3 },
      ], { duration: 900, delay: k * 60, easing: E.inout }).onfinish = () => t.remove();
      setTimeout(() => { onToken?.(k); play('sndDeal', k + 6); }, k * 60 + 880);
    });
    return sleep(pips.length * 60 + 1000);
  }

  /** Сумма прокрута вылетает из плитки и по дуге падает в счётчик серии. */
  function payout(text, tile, target, color) {
    mount();
    const b = box(tile), t = box(target);
    floatText(text, b.cx, b.y, { to: { x: t.cx, y: t.cy }, dur: 750, color });
  }

  /**
   * Итог серии. Празднуется только окупившаяся серия: салют за минус учит
   * игрока, что минус это успех, и это уже не оформление, а обман.
   */
  function seriesEnd(totalEl, ratio) {
    mount();
    if (!(ratio >= 1)) { play('sndSoft'); return; }
    const tb = box(totalEl);
    const big = ratio >= 2.5;
    impact(tb.cx, tb.cy, '#ffd34d', big ? 1.1 : 0.7);
    coins(tb.cx, tb.cy, big ? 40 : 18, { speed: 820, spread: Math.PI * 0.7 });
    shower(big ? 80 : 36, ['#ffd34d', '#ff9a1f', '#ffffff']);
    play('sndFanfare', big ? 1.26 : 1);
  }

  /* ---------- Просмотр предмета из состава ---------- */

  /*
   * Карточку из состава кейса можно рассмотреть: она вылетает из сетки тем
   * же оборотом, что крупный выигрыш, и встаёт в центр. Но это витрина, а не
   * выигрыш, и это должно быть видно сразу: ни надписи WIN, ни монет, ни
   * счёта суммы, ни тряски. Цена стоит готовым числом с подписью «стоимость».
   * Показ «как будто выиграл» на каждом нажатии обесценил бы настоящий
   * выигрыш и путал бы игрока, что ему что-то начислено.
   */
  let inspecting = null;

  async function inspect(item, o) {
    mount();
    if (inspecting) return;
    accent = ACCENTS[o.theme] || {};
    const color = tierColor(item.tier);
    const tb = o.tile ? box(o.tile) : { cx: W / 2, cy: H * 0.6, w: 160 };
    const value = item.value || 0;
    const mult = value && o.price ? value / o.price : 0;

    const wl = el('div', 'mo-wl mo-inspect');
    wl.style.setProperty('--c2', color);
    wl.style.setProperty('--glow', `color-mix(in srgb, ${color} 45%, transparent)`);
    wl.innerHTML = `
      <div class="mo-wl-dim"></div>
      <div class="mo-sky"><div class="mo-bloom"></div><div class="mo-rays"></div><div class="mo-rays b"></div></div>
      <div class="mo-card-slot"><div class="mo-spinner"></div></div>
      <div class="mo-insp">
        <div class="mo-insp-tier"></div>
        <div class="mo-insp-value"></div>
        <div class="mo-insp-sub"></div>
      </div>
      <button class="mo-insp-close" type="button">Закрыть</button>
      <div class="mo-skip">потяните карточку, чтобы повернуть</div>`;
    wl.querySelector('.mo-insp-tier').textContent = o.tierLabel || '';
    wl.querySelector('.mo-insp-value').textContent = value ? money(value) : (item.perkLabel || '');
    wl.querySelector('.mo-insp-sub').textContent = value
      ? (mult ? `стоимость предмета · ${xFmt(mult)} к цене кейса` : 'стоимость предмета')
      : 'бонус из этого кейса';
    const slot = wl.querySelector('.mo-card-slot');
    const spinner = wl.querySelector('.mo-spinner');
    const info = wl.querySelector('.mo-insp');
    const sky = wl.querySelector('.mo-sky');

    if (o.tile) o.tile.classList.add('mo-lifted');
    recede(true);
    anim(wl.querySelector('.mo-wl-dim'), [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: E.out });
    play('sndWhoosh');

    const card = heroCard(item);
    spinner.append(card);
    const fb = box(slot);
    const s = tb.w / 196;
    const dx = tb.cx - fb.cx, dy = tb.cy - fb.cy;
    const fly = anim(card, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotateY(0deg)` },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 40}px) scale(${s + (1 - s) * 0.75}) rotateY(230deg)`, offset: 0.6 },
      { transform: 'translate(0, 0) scale(1) rotateY(360deg)' },
    ], { duration: 900, easing: E.out });
    anim(sky, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 900, easing: E.out });
    [...wl.querySelectorAll('.mo-rays')].forEach((r, i) =>
      r.animate([{ rotate: '0deg' }, { rotate: `${i ? -360 : 360}deg` }], { duration: i ? 70000 : 50000, iterations: Infinity }));
    anim(info, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 650, easing: E.out });
    anim(wl.querySelector('.mo-insp-close'), [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 800, easing: E.out });

    // Посадка - тихая: волна в цвет редкости и пара искр, без удара и звона
    // монет. Это остаётся языком настоящего выигрыша.
    setTimeout(() => {
      if (!wl.isConnected) return;
      ring(fb.cx, fb.cy, color, 3, 800);
      sparks(fb.cx, fb.cy, 26, ['#ffffff', color], 380, { g: 60 });
      bokeh(8, [color, '#ffffff']);
      play('sndChime');
    }, 820);

    /*
     * Карточку можно крутить пальцем. Отпустили - она докручивается по
     * инерции и встаёт лицом к игроку. В покое чуть покачивается, чтобы было
     * видно, что она объёмная и живая.
     */
    let angle = 0, vel = 0, dragging = false, lastX = 0, raf = 0;
    const t0 = performance.now();
    const loop = (now) => {
      if (!wl.isConnected) return;
      if (!dragging) {
        vel *= 0.94;
        angle += vel;
        if (Math.abs(vel) < 0.6) {
          const face = Math.round(angle / 360) * 360;
          angle += (face - angle) * 0.08;
        }
      }
      const t = (now - t0) / 1000;
      const sway = REDUCED ? 0 : Math.sin(t * 1.1) * 14;
      const tilt = REDUCED ? 0 : Math.sin(t * 0.8) * 5;
      spinner.style.transform = `rotateY(${angle + sway}deg) rotateX(${tilt}deg)`;
      raf = requestAnimationFrame(loop);
    };
    setTimeout(() => { if (wl.isConnected) raf = requestAnimationFrame(loop); }, 900);

    const onDown = (e) => {
      if (e.target.closest('.mo-insp-close')) return;
      dragging = true; lastX = e.clientX; vel = 0;
      wl.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const d = e.clientX - lastX;
      lastX = e.clientX;
      angle += d * 0.6;
      vel = d * 0.6;
    };
    const onUp = () => { dragging = false; };
    wl.addEventListener('pointerdown', onDown);
    wl.addEventListener('pointermove', onMove);
    wl.addEventListener('pointerup', onUp);
    wl.addEventListener('pointercancel', onUp);

    await new Promise((resolve) => {
      inspecting = resolve;
      wl.querySelector('.mo-insp-close').addEventListener('click', resolve, { once: true });
      // Нажатие мимо карточки тоже закрывает: окно просмотра не должно
      // запирать экран кейса.
      wl.querySelector('.mo-wl-dim').addEventListener('click', resolve, { once: true });
    });
    inspecting = null;
    if (!wl.isConnected) return;

    // Обратно - в своё место в сетке, тем же путём.
    cancelAnimationFrame(raf);
    fly.cancel();
    const back = o.tile && o.tile.isConnected ? box(o.tile) : tb;
    const fb2 = box(slot);
    const bs = back.w / 196;
    play('sndWhoosh', false);
    anim(card, [
      { transform: 'translate(0, 0) scale(1) rotateY(0deg)' },
      { transform: `translate(${back.cx - fb2.cx}px, ${back.cy - fb2.cy}px) scale(${bs}) rotateY(-180deg)`, opacity: 0.6 },
    ], { duration: 520, easing: E.inout });
    anim(wl, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 160, easing: E.inout });
    recede(false);
    await sleep(560);
    wl.remove();
    if (o.tile) o.tile.classList.remove('mo-lifted');
  }

  /** Закрыть просмотр снаружи: Esc или уход из кейса. */
  function closeInspect() { inspecting?.(); }

  /** Снять всё: игрок закрыл окно кейса посреди показа. */
  function reset() {
    inspecting?.();
    inspecting = null;
    recede(false);
    if (!root) return;
    layer.innerHTML = '';
    top.innerHTML = '';
    P.length = 0;
    EM.length = 0;
    g.clearRect(0, 0, W, H);
    document.querySelectorAll('.mo-lifted').forEach((t) => t.classList.remove('mo-lifted'));
  }

  return { win, purchase, retrigger, payout, seriesEnd, reset, recede, levelOf, inspect, closeInspect };
}
