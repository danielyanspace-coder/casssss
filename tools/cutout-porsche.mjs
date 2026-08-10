/**
 * Вырезание фона из снимка машины для сезонной обложки.
 *
 * Скрипт разовый и лежит здесь как история происхождения ассета: он показывает,
 * из чего и как получен public/assets/porsche.webp. Исходный снимок в репозиторий
 * не кладётся — это стороннее фото, присланное владельцем проекта. Чтобы
 * перегенерировать ассет, укажите в SRC путь к своему исходнику.
 *
 * Запуск: node tools/cutout-porsche.mjs
 *
 * Альфа-канала в файле нет: «прозрачность» нарисована шахматкой прямо в
 * пикселях, в том числе сквозь стёкла. Сравнивать пиксели с цветом клетки
 * напрямую нельзя — светлые блики на серебристом кузове попадают в тот же
 * допуск, и кузов получается дырявым. Поэтому фон ищется по регулярности:
 * клетка считается фоном, если она равномерно залита, совпадает с соседями
 * своей чётности и отличается от соседей противоположной. Тонированное
 * стекло приглушает шахматку, но чередование сохраняет — из-за локальных
 * опорных цветов оно тоже распознаётся.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = '/root/.claude/uploads/708eddad-25c5-52ad-8bcc-6d723198683c/637bb775-IMG_9183.WEBP';
const OUT = '/home/user/casssss/public/assets/porsche.png';

const dataUri = 'data:image/webp;base64,' + readFileSync(SRC).toString('base64');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const result = await page.evaluate(async (uri) => {
  const img = new Image();
  img.src = uri;
  await img.decode();

  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, W, H);
  const d = im.data;

  const lum = (i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);

  // Шаг клетки — по первой смене цвета в верхней строке.
  let step = 0;
  const l0 = lum(0);
  for (let x = 1; x < 200; x++) {
    if (Math.abs(lum((x) * 4) - l0) > 6) { step = x; break; }
  }
  if (!step) return { error: 'шаг клетки не определён' };

  const CW = Math.ceil(W / step);
  const CH = Math.ceil(H / step);
  const mean = new Float32Array(CW * CH);
  const std = new Float32Array(CW * CH);

  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      let s = 0, s2 = 0, n = 0;
      const x1 = Math.min(W, (ci + 1) * step);
      const y1 = Math.min(H, (cj + 1) * step);
      for (let y = cj * step; y < y1; y++) {
        for (let x = ci * step; x < x1; x++) {
          const v = lum((y * W + x) * 4);
          s += v; s2 += v * v; n++;
        }
      }
      const m = s / n;
      mean[cj * CW + ci] = m;
      std[cj * CW + ci] = Math.sqrt(Math.max(0, s2 / n - m * m));
    }
  }

  const cellAt = (ci, cj) => (ci < 0 || cj < 0 || ci >= CW || cj >= CH) ? -1 : cj * CW + ci;

  // Клетка фона: ровная заливка, совпадает с диагональными соседями (та же
  // чётность) и заметно отличается от ортогональных (другая чётность).
  const isBg = new Uint8Array(CW * CH);
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      const p = cj * CW + ci;
      if (std[p] > 6) continue;

      const same = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cellAt(ci + a, cj + b));
      const opp = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([a, b]) => cellAt(ci + a, cj + b));
      const okSame = same.filter((q) => q >= 0 && std[q] <= 6);
      const okOpp = opp.filter((q) => q >= 0 && std[q] <= 6);
      if (okSame.length < 2 || okOpp.length < 2) continue;

      const mSame = okSame.reduce((a, q) => a + mean[q], 0) / okSame.length;
      const mOpp = okOpp.reduce((a, q) => a + mean[q], 0) / okOpp.length;
      if (Math.abs(mean[p] - mSame) < 4 && Math.abs(mean[p] - mOpp) > 7) isBg[p] = 1;
    }
  }

  // Шахматка сквозь тонировку: цвета приглушены (200/185 вместо 255/231), а
  // сама полоска — всего в две клетки, поэтому соседей своей чётности не
  // хватает и проверка выше её пропускает. Здесь опираемся не на цвет, а на
  // локальный контраст: ровная клетка, у которой ортогональные соседи тоже
  // ровные и отличаются на одну и ту же величину, — это клетка шахматки.
  let tinted = 0;
  const isTinted = new Uint8Array(CW * CH);
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      const p = cj * CW + ci;
      if (isBg[p] || std[p] > 3 || mean[p] < 120) continue;

      const flat = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        .map(([a, b]) => cellAt(ci + a, cj + b))
        .filter((q) => q >= 0 && std[q] <= 3);
      if (flat.length < 2) continue;

      const deltas = flat.map((q) => mean[q] - mean[p]);
      const sameSign = deltas.every((v) => v > 0) || deltas.every((v) => v < 0);
      const mag = deltas.map(Math.abs);
      const spread = Math.max(...mag) - Math.min(...mag);
      if (sameSign && Math.min(...mag) >= 8 && Math.max(...mag) <= 45 && spread <= 4) {
        isBg[p] = 1; isTinted[p] = 1; tinted++;
      }
    }
  }

  // Опорные цвета шахматки — усреднённые по уже распознанным клеткам, отдельно
  // для каждой чётности.
  let sumEven = 0, nEven = 0, sumOdd = 0, nOdd = 0;
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      const p = cj * CW + ci;
      // Тонированные клетки в эталон не берём — они бы утянули его вниз.
      if (!isBg[p] || isTinted[p]) continue;
      if ((ci + cj) % 2 === 0) { sumEven += mean[p]; nEven++; } else { sumOdd += mean[p]; nOdd++; }
    }
  }
  const refEven = sumEven / nEven;
  const refOdd = sumOdd / nOdd;

  // Замкнутые области — шахматка внутри стёкол — соседей нужной чётности не
  // имеют, тест выше их пропускает. Зато они идеально ровные и точно совпадают
  // с эталоном: у панелей кузова всегда есть градиент, поэтому допуск жёсткий.
  let enclosed = 0;
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      const p = cj * CW + ci;
      if (isBg[p] || std[p] > 3) continue;
      const want = (ci + cj) % 2 === 0 ? refEven : refOdd;
      if (Math.abs(mean[p] - want) < 4) { isBg[p] = 1; enclosed++; }
    }
  }

  // Гасим фоновые клетки целиком.
  let cleared = 0;
  const clearCell = (ci, cj) => {
    const x1 = Math.min(W, (ci + 1) * step);
    const y1 = Math.min(H, (cj + 1) * step);
    for (let y = cj * step; y < y1; y++) {
      for (let x = ci * step; x < x1; x++) { d[(y * W + x) * 4 + 3] = 0; cleared++; }
    }
  };
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) if (isBg[cj * CW + ci]) clearCell(ci, cj);
  }

  // Пограничные клетки: сам силуэт делает их неровными, но фоновая часть в них
  // осталась. Опорный цвет берём у соседней фоновой клетки нужной чётности.
  let edged = 0;
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CW; ci++) {
      const p = cj * CW + ci;
      if (isBg[p]) continue;

      // Соседи-фон той же чётности задают ожидаемый цвет этой клетки.
      const same = [[-1, -1], [1, -1], [-1, 1], [1, 1], [-2, 0], [2, 0], [0, -2], [0, 2]]
        .map(([a, b]) => cellAt(ci + a, cj + b)).filter((q) => q >= 0 && isBg[q]);
      if (same.length < 2) continue;

      const want = same.reduce((a, q) => a + mean[q], 0) / same.length;
      const x1 = Math.min(W, (ci + 1) * step);
      const y1 = Math.min(H, (cj + 1) * step);
      for (let y = cj * step; y < y1; y++) {
        for (let x = ci * step; x < x1; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] && Math.abs(lum(i) - want) < 11) { d[i + 3] = 0; edged++; }
        }
      }
    }
  }

  // Ложные дырки внутри кузова возвращаем. Один проход с порогом 7 из 8
  // соседей убирает только одиночные пиксели, а по кромке крыши они идут
  // скоплениями — поэтому проходов несколько и порог мягче.
  let healed = 0;
  for (let pass = 0; pass < 4; pass++) {
    const alpha = new Uint8Array(W * H);
    for (let q = 0; q < W * H; q++) alpha[q] = d[q * 4 + 3] ? 1 : 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const q = y * W + x;
        if (alpha[q]) continue;
        let solid = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (dx || dy) solid += alpha[q + dy * W + dx];
        }
        if (solid >= 5) { d[q * 4 + 3] = 255; healed++; }
      }
    }
  }

  // Финальная зачистка стекла.
  //
  // Вдоль кромки окна остаются светлые半-клетки: они задевают стойку, из-за
  // чего неровные, и ни один из проходов выше их не берёт. Чистить их по
  // яркости во всём кадре нельзя — выжгло бы блики на кузове. Поэтому сперва
  // находим замкнутые прозрачные области (это и есть стёкла: снаружи фон
  // связан с краем кадра, внутри — нет) и только там гасим светлое.
  const a2 = new Uint8Array(W * H);
  for (let q = 0; q < W * H; q++) a2[q] = d[q * 4 + 3] ? 1 : 0;

  const outside = new Uint8Array(W * H);
  const queue = [];
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) {
      const q = y * W + x;
      if (!a2[q] && !outside[q]) { outside[q] = 1; queue.push(q); }
    }
  }
  for (let y = 0; y < H; y++) {
    for (const x of [0, W - 1]) {
      const q = y * W + x;
      if (!a2[q] && !outside[q]) { outside[q] = 1; queue.push(q); }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const q = queue[head];
    const x = q % W, y = (q / W) | 0;
    if (x > 0 && !a2[q - 1] && !outside[q - 1]) { outside[q - 1] = 1; queue.push(q - 1); }
    if (x < W - 1 && !a2[q + 1] && !outside[q + 1]) { outside[q + 1] = 1; queue.push(q + 1); }
    if (y > 0 && !a2[q - W] && !outside[q - W]) { outside[q - W] = 1; queue.push(q - W); }
    if (y < H - 1 && !a2[q + W] && !outside[q + W]) { outside[q + W] = 1; queue.push(q + W); }
  }

  // Стёкла: сквозные дыры заливаем тёмным тонировочным цветом, а не оставляем
  // прозрачными — так окно выглядит окном на любом фоне. Оставшиеся светлые
  //半-клетки вдоль кромки ищем по периодичности узора (яркости у остатка и у
  // кузова пересекаются, поэтому порог по яркости их не различает) и внутри
  // габарита стекла, чтобы заведомо не задеть крышу.
  const GLASS = [21, 29, 47];
  let hx0 = W, hy0 = H, hx1 = -1, hy1 = -1, holes = 0;
  for (let q = 0; q < W * H; q++) {
    if (a2[q] || outside[q]) continue;
    const x = q % W, y = (q / W) | 0;
    if (x < hx0) hx0 = x; if (x > hx1) hx1 = x;
    if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
    d[q * 4] = GLASS[0]; d[q * 4 + 1] = GLASS[1]; d[q * 4 + 2] = GLASS[2];
    d[q * 4 + 3] = 245;
    holes++;
  }


  ctx.putImageData(im, 0, 0);

  // Остеклённая часть закрашивается заданным полигоном.
  //
  // Автоматика внутри салона выдыхается: там шахматка то приглушена
  // тонировкой, то разбита стойками на куски в пару клеток, а по яркости она
  // совпадает с серебристым кузовом — любой общий порог либо оставляет
  // квадраты, либо выедает крышу. Снимок один и не меняется, поэтому контур
  // стекла снят с него вручную; заодно окна становятся ровно тонированными.
  // Координаты — от левого верхнего угла обрезки.
  const GLASS_POLY = [
    [258, 46], [285, 30], [320, 22], [370, 19], [420, 19], [462, 25],
    [492, 41], [505, 62], [470, 74], [400, 76], [330, 74], [285, 68], [262, 58],
  ];


  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const octx = out.getContext('2d');
  octx.drawImage(cv, minX, minY, cw, ch, 0, 0, cw, ch);

  // Полигон закрашивается уже по обрезанному кадру — его координаты сняты
  // именно с него. Заливка идёт поверх всего: и остатков шахматки, и дыр.
  octx.beginPath();
  GLASS_POLY.forEach(([x, y], k) => (k ? octx.lineTo(x, y) : octx.moveTo(x, y)));
  octx.closePath();
  octx.fillStyle = 'rgba(20, 27, 44, 0.97)';
  octx.fill();

  return {
    src: [W, H], step, cells: [CW, CH],
    bgCells: isBg.reduce((a, v) => a + v, 0),
    refs: [Math.round(refEven), Math.round(refOdd)],
    tinted, enclosed, cleared, edged, healed, holes,
    crop: [minX, minY, cw, ch],
    png: out.toDataURL('image/png'),
  };
}, dataUri);

if (result.error) { console.error(result.error); process.exit(1); }

writeFileSync(OUT, Buffer.from(result.png.split(',')[1], 'base64'));

console.log('исходник:', result.src.join('x'), '| клетка:', result.step, 'px');
console.log('клеток:', result.cells.join('x'), '| распознано фоном:', result.bgCells);
console.log('эталоны:', result.refs.join(' / '), '| тонированных:', result.tinted, '| замкнутых:', result.enclosed);
console.log('погашено:', result.cleared, '| по границе:', result.edged, '| восстановлено:', result.healed);
console.log('стекло: залито дыр', result.holes, );
console.log('обрезка:', result.crop.join(' '));
await browser.close();
