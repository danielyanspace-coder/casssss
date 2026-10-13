/**
 * Контактный лист объёмных рисунков: все предметы темы на одном снимке.
 *
 *   node tools/art-sheet.mjs samurai [out.png]
 *
 * Запускается на своей машине при рисовании, не на сервере. Каждая карточка
 * показана дважды: крупно, как на экране результата, и мелко, как в ленте
 * пачки - рисунок, который читается только крупно, в ленте превращается в
 * пятно.
 */
import { chromium } from 'playwright';
import { THEMES } from '../server/themes.js';
import { hdKit } from '../public/hd/kit.js';

const theme = process.argv[2] || 'samurai';
const out = process.argv[3] || `/tmp/art-${theme}.png`;
/*
 * Модуль темы берётся напрямую, а не через реестр: так тему можно смотреть,
 * пока она ещё не подключена к проекту.
 */
const mod = await import(`../public/hd/${theme}.js`);
// Плюшки рисуются по ключу, а не по номеру: для них берём образцы ключей.
const draws = theme === 'special'
  ? mod.HD_SPECIAL_SAMPLES.map((key) => mod.hdSpecial(key))
  : Object.values(mod).find(Array.isArray);
const items = theme === 'special' ? mod.HD_SPECIAL_SAMPLES : THEMES[theme]?.items || draws.map((_, i) => `#${i}`);
const art = (i) => { const k = hdKit(); return draws[i] ? k.svg(draws[i](k)) : null; };

const cell = (svg, name, i) => `<figure><div class="big">${svg}</div>
  <div class="small">${svg.replace(/id="(hd[^"]*)"/g, 'id="s$1"').replace(/url\(#(hd[^)]*)\)/g, 'url(#s$1)')}</div>
  <figcaption>${i}. ${name}</figcaption></figure>`;

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0b0614;font:12px system-ui;color:#e8ddff;padding:14px}
main{display:grid;grid-template-columns:repeat(5,200px);gap:12px}
figure{margin:0;background:linear-gradient(160deg,#241838,#120a1e);border:1px solid #3a2a55;border-radius:16px;padding:10px;position:relative}
.big{width:180px;height:180px}.big svg,.small svg{width:100%;height:100%}
.small{position:absolute;right:10px;top:10px;width:46px;height:46px;background:#1a1028;border-radius:10px;border:1px solid #3a2a55}
figcaption{margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style><main>${items.map((n, i) => cell(art(i) || '<b>НЕТ</b>', n, i)).join('')}</main>`;

const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out, errors.length ? `ошибки: ${errors.join(' | ')}` : 'без ошибок');
