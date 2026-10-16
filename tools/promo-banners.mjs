/**
 * Два баннера раздела «Казино».
 *
 *   NODE_USE_ENV_PROXY=1 node tools/promo-banners.mjs <папка со шрифтами>
 *     ->  public/assets/ui/hero-jackpot.webp   (1600x800, слайд-шоу)
 *     ->  public/assets/ui/promo-cases.webp    (900x782, пара под слайд-шоу)
 *
 * В папке шрифтов: inter-cyr.woff2, inter-lat.woff2 (Inter 800) и
 * mont-cyr.woff2, mont-lat.woff2 (Montserrat 800). Шрифты передаются файлами:
 * рисует безголовый браузер, и не доехавший шрифт навсегда впечатался бы
 * запасным. По два файла на начертание, потому что Google режет шрифт по
 * алфавитам, и в кириллическом наборе нет цифр.
 *
 * «Большие джекпоты каждый день» - по образцу баннера 1Win «подборка
 * оригинальных игр», который прислал заказчик: тёмная плита, крупный белый
 * текст слева, справа три карточки игр веером, средняя крупнее и спереди.
 * Карточки - настоящие обложки самых популярных слотов лобби. Квадратные
 * 1004x1004 обрезаются под 3:4: вертикальные у этих игр всего 330x420 и на
 * баннере в 1600 точек расплылись бы.
 *
 * «Кейсы» - пара к Free Money на экране казино, тем же языком, что
 * квадратные «Казино» и «Бонусы»: плита со скруглением, белый заголовок,
 * под ним предмет. Предмет - три настоящие обложки кейсов, вырезанные по
 * контуру, с крупной сцены (public/assets/covers/stage).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = process.argv[2];
if (!FONTS) throw new Error('укажите папку со шрифтами');
const b64 = (p) => readFileSync(p).toString('base64');
const font = (name) => b64(join(FONTS, name));

const fontFaces = `
  @font-face { font-family: I; font-weight: 800; unicode-range: U+0400-045F; src: url(data:font/woff2;base64,${font('inter-cyr.woff2')}) format('woff2'); }
  @font-face { font-family: I; font-weight: 800; unicode-range: U+0000-00FF, U+2000-206F; src: url(data:font/woff2;base64,${font('inter-lat.woff2')}) format('woff2'); }
  @font-face { font-family: M; font-weight: 800; unicode-range: U+0400-045F; src: url(data:font/woff2;base64,${font('mont-cyr.woff2')}) format('woff2'); }
  @font-face { font-family: M; font-weight: 800; unicode-range: U+0000-00FF; src: url(data:font/woff2;base64,${font('mont-lat.woff2')}) format('woff2'); }
`;

/* Обложки игр для джекпот-баннера: самые популярные слоты лобби. */
const GAMES = [
  { key: 'Sweet-bonanza', crop: 0.75 },
  { key: 'Gates-of-olympus', crop: 0.8 },
  { key: 'Sugar-rush', crop: 0.75 },
];

async function fetchCover(key, crop) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`https://cdn.betinovio.com/adaa/${key}/square.webp`, { signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      const m = await sharp(buf).metadata();
      const w = Math.round(m.width * crop);
      const out = await sharp(buf)
        .extract({ left: Math.round((m.width - w) / 2), top: 0, width: w, height: m.height })
        .resize({ width: 600 })
        .webp({ quality: 92 }).toBuffer();
      return `data:image/webp;base64,${out.toString('base64')}`;
    } catch (err) { last = err; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

/* Монетка: золотой диск с ободком и бликом, рисуется на месте. */
const coin = (x, y, r, rot = 0, o = 1) => `
  <div class="coin" style="left:${x}px;top:${y}px;width:${r * 2}px;height:${r * 2}px;transform:rotate(${rot}deg);opacity:${o}"></div>`;

async function render(html, w, h, out, transparent) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const png = await page.screenshot({ omitBackground: transparent });
  await browser.close();
  const webp = await sharp(png).webp({ quality: 88, alphaQuality: 100 }).toBuffer();
  writeFileSync(join(ROOT, 'public/assets/ui', out), webp);
  console.log(`${out}: ${(webp.length / 1024).toFixed(0)} КБ`);
}

/* ---------- Большие джекпоты каждый день ---------- */

const covers = [];
for (const g of GAMES) covers.push(await fetchCover(g.key, g.crop));

await render(`<!doctype html><html><head><style>
  ${fontFaces}
  * { box-sizing: border-box; margin: 0; }
  body { width: 1600px; height: 800px; overflow: hidden; position: relative;
    background:
      radial-gradient(60% 90% at 74% 50%, rgba(168, 85, 247, 0.55), transparent 62%),
      radial-gradient(40% 60% at 74% 62%, rgba(255, 196, 64, 0.28), transparent 70%),
      radial-gradient(90% 120% at 100% 0%, #3b2a6e 0%, transparent 55%),
      linear-gradient(115deg, #0b0718 0%, #170d2e 45%, #26164a 100%);
    font-family: I, sans-serif; }
  /* Лучи за веером: тот же приём, что у сцен выигрыша в приложении. */
  .rays { position: absolute; left: 1180px; top: 400px; width: 1500px; height: 1500px; margin: -750px 0 0 -750px;
    background: repeating-conic-gradient(rgba(255, 220, 140, 0.10) 0deg 6deg, transparent 6deg 18deg);
    -webkit-mask: radial-gradient(circle, #000 10%, transparent 58%); mask: radial-gradient(circle, #000 10%, transparent 58%); }
  h1 { position: absolute; left: 100px; top: 205px; width: 660px;
    font-weight: 800; font-size: 92px; line-height: 1.02; letter-spacing: -2px; color: #fff; }
  h1 span { background: linear-gradient(180deg, #fff6cf 5%, #ffd34d 50%, #e09a1c 95%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 4px 14px rgba(255, 190, 60, 0.35)); }
  .card { position: absolute; width: 300px; height: 400px; border-radius: 28px; overflow: hidden;
    border: 5px solid rgba(255, 255, 255, 0.55);
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.15) inset; }
  .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card::after { content: ''; position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent 30%); }
  .side { filter: brightness(0.8) saturate(1.05); }
  .left { left: 830px; top: 230px; transform: rotate(-10deg); }
  .right { left: 1285px; top: 230px; transform: rotate(10deg); }
  .mid { left: 1030px; top: 140px; width: 390px; height: 520px; border-radius: 34px;
    border: 6px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 40px 80px rgba(0, 0, 0, 0.65), 0 0 60px rgba(255, 200, 80, 0.35); }
  .coin { position: absolute; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fffbe6 0 12%, #ffd34d 38%, #c8781a 78%, #8a4f08 100%);
    box-shadow: inset 0 0 0 6px rgba(138, 79, 8, 0.45), 0 10px 24px rgba(0, 0, 0, 0.5); }
  .coin::after { content: ''; position: absolute; inset: 22%; border-radius: 50%;
    border: 3px solid rgba(138, 79, 8, 0.45); }
</style></head><body>
  <div class="rays"></div>
  <h1>Большие <span>джекпоты</span> каждый день</h1>
  <div class="card side left"><img src="${covers[0]}"></div>
  <div class="card side right"><img src="${covers[2]}"></div>
  <div class="card mid"><img src="${covers[1]}"></div>
  ${coin(1430, 120, 34, 20)}${coin(1500, 560, 26, -15, 0.95)}${coin(935, 600, 30, 10)}
  ${coin(840, 150, 18, 0, 0.8)}${coin(1395, 690, 20, 0, 0.85)}
</body></html>`, 1600, 800, 'hero-jackpot.webp', false);

/* ---------- Кейсы ---------- */

const caseArt = (name) => `data:image/webp;base64,${b64(join(ROOT, 'public/assets/covers/stage', `${name}.webp`))}`;

await render(`<!doctype html><html><head><style>
  ${fontFaces}
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 900px; height: 782px; background: transparent; overflow: hidden; }
  /* Плита как у квадратных «Казино» и «Бонусы»: те же размеры и скругление. */
  .plate { position: absolute; left: 6px; top: 6px; right: 6px; bottom: 6px; border-radius: 44px; overflow: hidden;
    background:
      radial-gradient(75% 55% at 50% 82%, rgba(255, 196, 64, 0.30), transparent 70%),
      radial-gradient(85% 70% at 50% 78%, #4a1d6e 0%, #241034 52%, #120a1c 100%);
    border: 4px solid #6b3fa0; }
  h1 { position: absolute; left: 0; right: 0; top: 64px; text-align: center;
    font-family: M, sans-serif; font-weight: 800; font-size: 142px; letter-spacing: -2px; color: #fff; }
  img { position: absolute; filter: drop-shadow(0 26px 30px rgba(0, 0, 0, 0.6)); }
  .l { width: 330px; left: 50px; top: 315px; transform: rotate(-8deg); }
  .r { width: 330px; right: 50px; top: 315px; transform: rotate(8deg); }
  .m { width: 470px; left: 215px; top: 255px; filter: drop-shadow(0 30px 40px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 40px rgba(255, 196, 64, 0.35)); }
  .shadow { position: absolute; left: 150px; right: 150px; bottom: 34px; height: 70px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(0, 0, 0, 0.55), transparent); }
</style></head><body>
  <div class="plate">
    <div class="shadow"></div>
    <h1>Кейсы</h1>
  </div>
  <img class="l" src="${caseArt('neon')}">
  <img class="r" src="${caseArt('treasure')}">
  <img class="m" src="${caseArt('megabox')}">
</body></html>`, 900, 782, 'promo-cases.webp', true);
