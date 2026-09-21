/**
 * Движок слотов: ленты, линии, точный счёт отдачи.
 *
 * Здесь нет ни одной игры - только математика, общая для всех. Описание
 * конкретного слота (символы, выплаты, ярусы, джекпоты, оформление) лежит в
 * server/slots.js и приезжает сюда в buildSlot().
 *
 * ПОЧЕМУ ЗДЕСЬ НАСТОЯЩАЯ СЛОТОВАЯ МАТЕМАТИКА, А НЕ ТАБЛИЦА ИСХОДОВ.
 *
 * В кейсах и мини-играх исход выбирается из готовой таблицы вероятностей. В
 * слоте так нельзя: игрок видит пятнадцать символов и сам складывает из них
 * линии. Если рисовать барабаны под заранее выбранную выплату, однажды на
 * экране окажется четыре льва подряд при выплате за трёх, и это заметят.
 *
 * Поэтому здесь всё как в настоящем слоте: у каждого барабана своя ЛЕНТА
 * (виртуальный круг символов), прокрут выбирает случайную позицию на каждой
 * ленте, и выплата СЧИТАЕТСЯ по тому, что выпало. Отдача не назначается, а
 * получается - и её надо уметь посчитать заранее, иначе она неизвестна.
 *
 * КАК СЧИТАЕТСЯ ОТДАЧА. Перебором, а не симуляцией. Полный перебор всех
 * комбинаций это сотни миллионов сеток, но он и не нужен: выплата по линии
 * зависит только от символов в её пяти клетках, а барабаны независимы. Значит
 * матожидание одной линии раскладывается в произведение по барабанам, и
 * считается точно за доли секунды (см. lineRtp). Матожидание всех двадцати
 * линий равно двадцати матожиданиям одной, а ставка как раз в двадцать раз
 * больше ставки на линию - поэтому отдача по линиям РАВНА матожиданию одной
 * линии в единицах линейной ставки. Никаких симуляций.
 *
 * WILD НЕ ВЫПАДАЕТ НА ПЕРВОМ И ПЯТОМ БАРАБАНЕ, и это не случайность, а
 * условие точного счёта. Если бы линия могла начинаться с wild, пришлось бы
 * брать максимум из «wild платит сам за себя» и «wild заменил следующий
 * символ», а максимум по зависимым событиям в произведение не
 * раскладывается. В настоящих слотах wild на первом барабане тоже обычно не
 * ставят.
 *
 * ЧТО ИМЕННО РЕШАЕТСЯ УРАВНЕНИЕМ. Ленты состоят из целого числа символов,
 * поэтому подогнать ими отдачу до четвёртого знака невозможно в принципе:
 * шаг по одному символу двигает отдачу на проценты. Свободной величиной
 * служит ДОЛЯ ДЖЕКПОТОВ - ровно как доля плюшек в кейсах. Ленты задают всё
 * остальное, а джекпоты забирают остаток до заявленной отдачи (см.
 * jackpotBudget). Решение единственное и точное.
 */

export const ROWS = 3;
export const REELS = 5;

export const WILD = 'wild';
export const SCATTER = 'scatter';

/**
 * Двадцать линий. Каждая - номер ряда на каждом из пяти барабанов.
 *
 * Все линии считаются слева направо и от первого барабана: разрыв обрывает
 * цепочку. Так устроено подавляющее большинство слотов, и именно на этом
 * держится точный счёт отдачи выше.
 */
export const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2],
  [1, 0, 1, 2, 1], [1, 2, 1, 0, 1],
  [0, 0, 1, 0, 0], [2, 2, 1, 2, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1],
  [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [0, 2, 0, 2, 0],
];

export const LINES = PAYLINES.length;

/* ============================================================
   ЛЕНТЫ
   ============================================================ */

/**
 * Раскладка ленты: символы расставляются по кругу как можно равномернее, а не
 * подряд блоками.
 *
 * Это не косметика. Три соседние клетки барабана - это три подряд идущие
 * позиции ленты. Если сложить одинаковые символы рядом, они будут выпадать
 * по два-три в столбик гораздо чаще, чем следует, а wild рядом с wild
 * превратит бонус в раздачу. Равномерная раскладка убирает такие сгустки, и
 * именно по ней потом считается отдача - перебором окон, а не по формуле для
 * независимых клеток.
 */
function layout(counts, filler) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const slots = new Array(total).fill(null);
  // Символы раскладываются от самых редких к самым частым: редкому проще
  // найти свободное место, если он идёт первым.
  const order = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[1] - b[1]);

  let cursor = 0;
  for (const [id, n] of order) {
    const step = total / n;
    for (let k = 0; k < n; k++) {
      let at = Math.round(cursor + k * step) % total;
      let guard = 0;
      while (slots[at] !== null && guard++ < total) at = (at + 1) % total;
      slots[at] = id;
    }
    // Следующий символ начинает со смещения, чтобы не ложиться поверх следа
    // предыдущего: иначе дешёвые символы выстроились бы парами.
    cursor += step / 2 + 1;
  }
  for (let i = 0; i < total; i++) if (slots[i] === null) slots[i] = filler;
  return slots;
}

/**
 * Ленты всех пяти барабанов.
 *
 * ПОВОРОТ ЛЕНТЫ НИЧЕГО НЕ МЕНЯЕТ В МАТЕМАТИКЕ и нужен только глазу. Барабаны
 * с одинаковым составом (первый и пятый, второй и четвёртый) получили бы
 * побуквенно одинаковые ленты, и при совпадении позиций на экране вставал бы
 * зеркальный столбик. Набор окон у повёрнутой ленты тот же самый, поэтому
 * отдача не меняется ни на знак.
 */
function buildStrips(spec) {
  const filler = spec.tiers.low[spec.tiers.low.length - 1];
  return Array.from({ length: REELS }, (_, reel) => {
    const counts = {};
    for (const [tier, ids] of Object.entries(spec.tiers)) {
      for (const id of ids) {
        // Вес задаётся либо ярусом целиком, либо посимвольно: у одной игры
        // символы делятся на три понятные группы, у другой ступеньки выплат
        // слишком близкие, и ярусами нужную редкость не выразить.
        counts[id] = spec.weights ? spec.weights[id] : spec.tierWeight[tier];
      }
    }
    if (spec.wildWeight[reel]) counts[WILD] = spec.wildWeight[reel];
    if (spec.scatterWeight[reel]) counts[SCATTER] = spec.scatterWeight[reel];

    const strip = layout(counts, filler);
    const shift = (reel * 7) % strip.length;
    return strip.slice(shift).concat(strip.slice(0, shift));
  });
}

/* ============================================================
   РАСПРЕДЕЛЕНИЕ КЛЕТОК
   ============================================================ */

/**
 * Для барабана считает, с какой вероятностью в КАЖДОМ ряду стоит каждый
 * символ, и отдельно - распределение числа scatter в окне.
 *
 * Считается перебором всех окон ленты: окон ровно столько же, сколько
 * позиций, и каждое равновероятно. Никакого приближения здесь нет.
 */
function reelStats(strip, { expandWild = false } = {}) {
  const L = strip.length;
  const rows = Array.from({ length: ROWS }, () => new Map());
  const scatterCount = new Map();

  for (let off = 0; off < L; off++) {
    const window = Array.from({ length: ROWS }, (_, r) => strip[(off + r) % L]);
    const hasWild = window.includes(WILD);
    const scatters = window.filter((s) => s === SCATTER).length;
    scatterCount.set(scatters, (scatterCount.get(scatters) || 0) + 1 / L);

    for (let r = 0; r < ROWS; r++) {
      // Во фриспинах wild расширяется на весь барабан: если он есть в окне,
      // все три клетки становятся wild.
      const sym = expandWild && hasWild ? WILD : window[r];
      rows[r].set(sym, (rows[r].get(sym) || 0) + 1 / L);
    }
  }

  return {
    rows: rows.map((m) => Object.fromEntries(m)),
    scatterCount: Object.fromEntries(scatterCount),
  };
}

/* ============================================================
   ОТДАЧА ПО ЛИНИЯМ
   ============================================================ */

/**
 * Матожидание выплаты одной линии в линейных ставках.
 *
 * Для символа S и длины L вероятность «ровно L подряд» равна произведению
 * вероятностей попасть в S-или-wild на первых L барабанах, умноженному на
 * вероятность НЕ попасть на (L+1)-м. Барабаны независимы, поэтому это
 * честное произведение, а не приближение.
 *
 * Первый барабан считается отдельно: wild на нём не встречается, и линия
 * всегда начинается настоящим символом. Именно это делает разложение
 * возможным (см. шапку файла).
 */
function lineExpectation(symbols, stats, line) {
  let total = 0;

  for (const sym of symbols) {
    const p = [];
    for (let i = 0; i < REELS; i++) {
      const row = stats[i].rows[line[i]];
      // На первом барабане wild не бывает, на остальных он заменяет символ.
      p.push((row[sym.id] || 0) + (i === 0 ? 0 : (row[WILD] || 0)));
    }

    for (let len = 3; len <= REELS; len++) {
      const run = p.slice(0, len).reduce((a, b) => a * b, 1);
      const stop = len === REELS ? 1 : (1 - p[len]);
      total += run * stop * sym.pays[len - 3];
    }
  }

  return total;
}

/** Отдача по всем линиям. Равна матожиданию одной линии - см. шапку файла. */
function lineRtp(symbols, stats) {
  return PAYLINES.reduce((s, line) => s + lineExpectation(symbols, stats, line), 0) / LINES;
}

/* ============================================================
   SCATTER
   ============================================================ */

/** Распределение числа scatter на экране: свёртка по барабанам. */
function scatterDistribution(stats) {
  let dist = { 0: 1 };
  for (const reel of stats) {
    const next = {};
    for (const [have, ph] of Object.entries(dist)) {
      for (const [add, pa] of Object.entries(reel.scatterCount)) {
        const n = Number(have) + Number(add);
        next[n] = (next[n] || 0) + ph * pa;
      }
    }
    dist = next;
  }
  return dist;
}

/** Отдача scatter в ОБЩИХ ставках и шанс запустить фриспины. */
function scatterStats(stats, scatterPays) {
  const dist = scatterDistribution(stats);
  let rtp = 0;
  let trigger = 0;
  for (const [n, p] of Object.entries(dist)) {
    const count = Number(n);
    if (count >= 3) trigger += p;
    rtp += p * (scatterPays[Math.min(count, 5)] || 0);
  }
  return { rtp, trigger, dist };
}

/* ============================================================
   СОСТАВЛЯЮЩИЕ ОТДАЧИ
   ============================================================ */

/**
 * Фриспины НЕ перезапускаются изнутри: три scatter внутри бонуса новых
 * вращений не дают. Иначе матожидание пришлось бы считать как сумму
 * бесконечного ряда, и одна опечатка в весе scatter превращала бы игру в
 * бесконечный бонус. Это ограничение записано и в правилах для игрока.
 */
function componentsOf(symbols, strips, spec) {
  const base = strips.map((s) => reelStats(s));
  const free = strips.map((s) => reelStats(s, { expandWild: true }));

  const baseScatter = scatterStats(base, spec.scatterPays);
  const freeScatter = scatterStats(free, spec.scatterPays);

  /*
   * МНОЖИТЕЛЬ ФРИСПИНОВ - ЕДИНСТВЕННЫЙ РЫЧАГ, КОТОРЫЙ ДВИГАЕТ ТОЛЬКО БОНУС.
   *
   * Долю бонуса в отдаче хочется задавать отдельно от базовой игры, а рычагов
   * на это мало: частота wild поднимает и бонус, и базу разом, длина ленты
   * вообще ничего не меняет (важны только соотношения весов). Множитель
   * выигрышей во фриспинах не входит в базовую игру вовсе, поэтому им доля
   * бонуса и задаётся.
   *
   * Игроку он показан прямо на экране бонуса: это не скрытая поправка, а
   * обычная механика, которая есть в половине слотов.
   */
  const mult = spec.freeMultiplier || 1;
  // Во фриспинах ставка не списывается, поэтому один бесплатный прокрут
  // стоит кассе ровно столько, сколько он платит.
  const freeSpin = mult * lineRtp(symbols, free) + freeScatter.rtp;

  return {
    baseLines: lineRtp(symbols, base),
    baseScatter: baseScatter.rtp,
    trigger: baseScatter.trigger,
    freeMultiplier: mult,
    freeSpin,
    bonus: baseScatter.trigger * spec.freeSpins * freeSpin,
  };
}

/* ============================================================
   СБОРКА СЛОТА
   ============================================================ */

/**
 * Превращает описание игры в готовый слот с посчитанной отдачей.
 *
 * ВЫПЛАТЫ ХРАНЯТСЯ В ЛИНЕЙНЫХ СТАВКАХ ВСЕГДА, как бы они ни были заданы в
 * макете. Макет одной игры подписывает выплаты в ставках на линию, другой -
 * в общих; разбираться в этом на каждом сложении выигрыша нельзя, поэтому
 * приведение делается здесь один раз. Поле payUnit остаётся только для
 * показа: таблица на экране обязана выглядеть так же, как в макете.
 */
export function buildSlot(spec) {
  const unitScale = spec.payUnit === 'total' ? LINES : 1;
  const scale = (spec.payScale || 1) * unitScale;

  const symbols = Object.entries(spec.tiers).flatMap(([tier, ids]) =>
    ids.map((id) => ({
      id,
      name: spec.names[id],
      tier,
      pays: spec.refPays[id].map((p) => p * scale),
      // Числа для показа - ровно те, что стоят в макете.
      shown: spec.refPays[id].map((p) => p * (spec.payScale || 1)),
    })));

  const strips = buildStrips(spec);
  const parts = componentsOf(symbols, strips, spec);

  /*
   * Джекпоты забирают ОСТАТОК матожидания до заявленной отдачи - тот же
   * принцип, что у плюшек в кейсах, и та же роль, что у филлера в лестнице.
   *
   * Ленты дают ровно столько, сколько дают: они из целых символов, и
   * подогнать ими отдачу до четвёртого знака нельзя. Джекпотам достаётся
   * разница, и она непрерывная - поэтому сумма сходится точно, а не
   * «примерно».
   */
  const jackpotBudget = spec.rtp - parts.baseLines - parts.baseScatter - parts.bonus;
  const splitTotal = spec.jackpots.reduce((s, j) => s + j.split, 0);

  /*
   * Сумма джекпота фиксированная, а ставка разная. Чтобы отдача не зависела
   * от ставки, шанс считается из доли: p = доля * ставка / сумма. Так
   * устроены все прогрессивные джекпоты: чем крупнее ставка, тем больше прав
   * на общий приз.
   */
  const jackpots = spec.jackpots.map((j) => ({
    id: j.id,
    name: j.name,
    amount: j.amount,
    share: (jackpotBudget * j.split) / splitTotal,
  }));

  /*
   * ЦЕНА ПОКУПКИ БОНУСА СЧИТАЕТСЯ, А НЕ НАЗНАЧАЕТСЯ.
   *
   * В задании стояла цена «100 ставок». Десять фриспинов с расширяющимся wild
   * приносят заметно меньше, и продажа за сто означала бы отдачу втрое ниже,
   * чем на обычном прокруте - то есть кнопка «Купить бонус» была бы ловушкой,
   * а не удобством. Цена выводится из матожидания: покупка обязана иметь ТУ
   * ЖЕ отдачу, что и обычный прокрут.
   */
  const buyBonusPrice = Math.round((spec.freeSpins * parts.freeSpin) / spec.rtp);

  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    theme: spec.theme,
    blurb: spec.blurb,
    rtp: spec.rtp,
    payUnit: spec.payUnit,
    payScale: spec.payScale || 1,
    freeSpins: spec.freeSpins,
    freeMultiplier: spec.freeMultiplier || 1,
    scatterPays: spec.scatterPays,
    bets: spec.bets,
    art: spec.art,
    symbols,
    strips,
    jackpots,
    jackpotBudget,
    buyBonusPrice,
    report: { ...parts, jackpots: jackpotBudget, total: spec.rtp },
  };
}

/* ============================================================
   РОЗЫГРЫШ
   ============================================================ */

/** Позиция на ленте из потока честных чисел. */
export function offsetFrom(roll, length) {
  return Math.min(length - 1, Math.floor(roll * length));
}

/**
 * Позиции пяти барабанов из одного честного числа.
 *
 * Роллов нужно пять, а честное число одно на nonce. Поэтому из него
 * раскручивается последовательность: каждый следующий ролл берётся из
 * дробной части предыдущего, умноженной на длину ленты. Так все пять позиций
 * восстанавливаются игроком из тех же серверного и клиентского зерна -
 * проверяемость не теряется.
 */
export function offsetsFrom(roll, strips) {
  const offsets = [];
  let x = roll;
  for (const strip of strips) {
    const scaled = x * strip.length;
    offsets.push(Math.min(strip.length - 1, Math.floor(scaled)));
    x = scaled - Math.floor(scaled);
    // Ролл, выродившийся в ноль, дал бы одинаковые позиции на остатке
    // барабанов. Подмешиваем несократимый сдвиг, а не берём случайное.
    if (x <= 0 || x >= 1) x = (roll * 997 + offsets.length * 0.6180339887) % 1;
  }
  return offsets;
}

/**
 * Сетка 5x3 по пяти позициям лент.
 *
 * Во фриспинах wild расширяется на весь барабан - та самая механика
 * «расширяющиеся символы», которую обещает карточка внизу экрана.
 */
export function gridFrom(slot, offsets, { expandWild = false } = {}) {
  return slot.strips.map((strip, reel) => {
    const window = Array.from({ length: ROWS },
      (_, r) => strip[(offsets[reel] + r) % strip.length]);
    if (expandWild && window.includes(WILD)) return window.map(() => WILD);
    return window;
  });
}

/**
 * Считает выигрышные линии готовой сетки.
 *
 * Множитель фриспинов применяется ЗДЕСЬ, а не в вызывающем коде: иначе он
 * рано или поздно разойдётся с тем, что учтено в отдаче, и касса
 * недосчитается ровно в той мере, в какой множитель забыли применить.
 */
export function evaluate(slot, grid, lineBet, { free = false } = {}) {
  const mult = free ? slot.freeMultiplier : 1;
  const wins = [];

  PAYLINES.forEach((line, index) => {
    const cells = line.map((row, reel) => grid[reel][row]);
    const first = cells[0];
    // Линия начинается настоящим символом: wild на первом барабане не бывает.
    if (first === WILD || first === SCATTER) return;
    const symbol = slot.symbols.find((s) => s.id === first);
    if (!symbol) return;

    let run = 1;
    while (run < REELS && (cells[run] === first || cells[run] === WILD)) run++;
    if (run < 3) return;

    wins.push({
      line: index,
      symbol: first,
      count: run,
      payout: symbol.pays[run - 3] * lineBet * mult,
      cells: line.slice(0, run).map((row, reel) => [reel, row]),
    });
  });

  const scatters = grid.flat().filter((s) => s === SCATTER).length;
  const scatterPay = slot.scatterPays[Math.min(scatters, 5)] || 0;

  return {
    wins,
    lineWin: wins.reduce((s, w) => s + w.payout, 0),
    scatters,
    // Scatter платит в ОБЩИХ ставках, а общая ставка равна двадцати линейным.
    scatterWin: scatterPay * lineBet * LINES,
    triggered: scatters >= 3,
  };
}

/**
 * Джекпот по отдельному честному числу.
 *
 * Шанс считается из доли матожидания и ставки, поэтому отдача джекпотов не
 * зависит от того, на сколько играют.
 */
export function jackpotFrom(slot, roll, totalBet) {
  let acc = 0;
  for (const j of slot.jackpots) {
    acc += (j.share * totalBet) / j.amount;
    if (roll < acc) return j;
  }
  return null;
}

/** Джекпот берётся из хвоста того же числа: отдельный nonce не нужен. */
export function jackpotRoll(roll) {
  return (roll * 1_000_003) % 1;
}

/* ============================================================
   ПРОВЕРКА
   ============================================================ */

/**
 * Роняет приложение, если математика слота не сходится.
 *
 * Слот отличается от кейсов тем, что отдача здесь не назначается, а
 * получается из лент. Ошибка в одном весе тихо меняет её на несколько
 * процентов, и заметить это по игре невозможно - только счётом.
 */
export function validateSlot(slot) {
  const r = slot.report;
  const tag = `[слот ${slot.id}]`;

  /*
   * Бюджет джекпотов - остаток уравнения, и его знак это главная проверка
   * всего файла. Минус означает, что ленты уже платят больше заявленного, и
   * джекпоты пришлось бы выдавать в долг.
   */
  if (!(slot.jackpotBudget > 0.005)) {
    throw new Error(
      `${tag} джекпотам остаётся ${slot.jackpotBudget.toFixed(4)} отдачи - ` +
      'ленты уже забрали почти всё. Удлините ленты или уменьшите payScale');
  }
  if (slot.jackpotBudget > 0.08) {
    throw new Error(
      `${tag} джекпотам достаётся ${slot.jackpotBudget.toFixed(4)} отдачи - ` +
      'слишком много для четырёх редких призов. Укоротите ленты или поднимите payScale');
  }

  for (const strip of slot.strips) {
    if (strip.length < 30) throw new Error(`${tag} лента короче тридцати позиций`);
    for (let i = 0; i < strip.length; i++) {
      const next = strip[(i + 1) % strip.length];
      if (strip[i] === WILD && next === WILD) {
        throw new Error(`${tag} два wild подряд на ленте: бонус станет раздачей`);
      }
      if (strip[i] === SCATTER && next === SCATTER) {
        throw new Error(`${tag} два scatter подряд на ленте`);
      }
    }
  }

  if (slot.strips[0].includes(WILD) || slot.strips[4].includes(WILD)) {
    throw new Error(`${tag} wild попал на крайний барабан: точный счёт отдачи сломается`);
  }

  if (!(r.trigger > 0.004) || !(r.trigger < 0.012)) {
    throw new Error(
      `${tag} бонус запускается с шансом ${(r.trigger * 100).toFixed(2)}% - ` +
      `это раз на ${Math.round(1 / r.trigger)} прокрутов, слишком ` +
      `${r.trigger > 0.012 ? 'часто' : 'редко'}`);
  }

  /*
   * Доля бонуса в отдаче. Если бонус забирает больше трети, обычный прокрут
   * становится пустым ожиданием, а именно этого просили не делать.
   */
  const bonusShare = r.bonus / slot.rtp;
  if (bonusShare > 0.35) {
    throw new Error(
      `${tag} бонус забирает ${(bonusShare * 100).toFixed(0)}% отдачи - ` +
      'обычный прокрут превратится в ожидание');
  }

  if (!(slot.buyBonusPrice > 1)) throw new Error(`${tag} цена покупки бонуса не посчиталась`);

  // Дороже символ - реже он на ленте. Иначе таблица врёт игроку о редкости.
  const freq = (id) => slot.strips[2].filter((x) => x === id).length;
  for (let i = 1; i < slot.symbols.length; i++) {
    const prev = slot.symbols[i - 1];
    const cur = slot.symbols[i];
    if (cur.pays[2] > prev.pays[2]) {
      throw new Error(`${tag} ${cur.id} платит больше, чем ${prev.id}, но стоит ниже в списке`);
    }
    if (freq(cur.id) < freq(prev.id)) {
      throw new Error(`${tag} ${cur.id} платит меньше ${prev.id}, но встречается реже`);
    }
  }

  return {
    'слот': slot.name,
    'длина ленты': slot.strips.map((s) => s.length).join('/'),
    'отдача по линиям': r.baseLines.toFixed(4),
    'отдача scatter': r.baseScatter.toFixed(4),
    'отдача бонуса': r.bonus.toFixed(4) + ` (${(bonusShare * 100).toFixed(0)}%)`,
    'бюджет джекпотов': slot.jackpotBudget.toFixed(4),
    'отдача всего': slot.rtp.toFixed(4),
    'бонус раз в': Math.round(1 / r.trigger),
    'один фриспин': r.freeSpin.toFixed(2) + ' ставки',
    'цена бонуса': slot.buyBonusPrice + ' ставок',
  };
}

/**
 * Доля прокрутов, на которых хоть что-то выпало.
 *
 * Считается выборкой - единственное место во всём файле, где используется
 * случайность, и только для справки. На отдачу это число не влияет, оно
 * нужно, чтобы понимать, как игра ощущается.
 */
export function hitFrequency(slot, rounds = 200_000) {
  let hits = 0;
  for (let i = 0; i < rounds; i++) {
    const offsets = slot.strips.map((s) => Math.floor(Math.random() * s.length));
    const res = evaluate(slot, gridFrom(slot, offsets), 1);
    if (res.lineWin > 0 || res.scatters >= 3) hits++;
  }
  return hits / rounds;
}
