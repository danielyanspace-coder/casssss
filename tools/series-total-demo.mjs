/**
 * Демо итога серии фриспинов крупно (motion.seriesTotal).
 *
 *   node tools/series-total-demo.mjs   ->  dist/series-total-demo.html
 *
 * Показ заказчику до включения в приложение: настоящие стили и настоящий
 * motion.js, вокруг - панель серии в том виде, в каком она стоит после
 * последнего прокрута. Три кнопки - три исхода: крупно окупилась, окупилась,
 * не окупилась.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemArtHd } from '../public/item-art-hd.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'public/styles.css'), 'utf8')
  // Пути к картинкам в стилях не нужны демо: фон панели собран градиентами.
  .replace(/url\((['"]?)\/assets\/[^)]*\)/g, 'none');
const motion = readFileSync(join(ROOT, 'public/motion.js'), 'utf8').replace(/^export /gm, '');
const emblem = itemArtHd('perk/fs/10') || '';

const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Итог фриспинов</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800;900&family=Manrope:wght@500;700;800&display=swap">
<style>${css}
body { margin: 0; background: #0a0215; }
.demo-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 200; display: flex; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: rgba(6, 2, 14, .92); }
.demo-bar button { flex: 1; padding: 12px 6px; border: 0; border-radius: 12px; font: 800 12px/1.2 Manrope, system-ui, sans-serif; color: #fff; background: #2b1650; }
.demo-bar button em { display: block; font-style: normal; color: #ffd34d; margin-top: 3px; }
.opener { padding-bottom: 90px; }
</style></head>
<body>
<div class="opener is-bonus" id="opener">
  <div class="opener-bonus" aria-hidden="true"></div>
  <div class="opener-scroll"><div class="opener-inner">
    <div class="opener-case">Путь меча · <span>10 фриспинов за 14 900 ₽</span></div>
    <div class="freespins" id="freespins">
      <div class="fs-emblem">${emblem}</div>
      <div class="fs-head"><div class="fs-title">ФРИСПИНЫ</div><div class="fs-left">0 из 10</div></div>
      <div class="fs-total" id="fsTotal">0 ₽</div>
      <div class="fs-sub">выигрыш с фриспинов</div>
      <div class="fs-pips">${'<i class="fs-pip spent"></i>'.repeat(10)}</div>
      <div class="fs-verdict" id="fsVerdict"></div>
      <button class="open-cta fs-collect" id="fsCollect" hidden>ЗАБРАТЬ</button>
    </div>
  </div></div>
</div>
<div class="demo-bar">
  <button data-total="186400" data-cost="14900">Крупно<em>×13</em></button>
  <button data-total="38250" data-cost="14900">Окупилась<em>×2,6</em></button>
  <button data-total="21800" data-cost="14900">Окупилась<em>×1,5</em></button>
  <button data-total="9600" data-cost="14900">Не окупилась<em>64%</em></button>
</div>
<script>
${motion}
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const mo = createMotion({ money, artFor: () => '', tierColor: () => '#ffd34d', snd: {} });
const totalEl = document.getElementById('fsTotal');
const btn = document.getElementById('fsCollect');
const verdict = document.getElementById('fsVerdict');
let busy = false;
document.querySelectorAll('[data-total]').forEach((b) => b.onclick = async () => {
  if (busy) return;
  busy = true;
  const total = Number(b.dataset.total), cost = Number(b.dataset.cost);
  totalEl.textContent = money(total);
  const ratio = total / cost;
  const x = ratio >= 10 ? String(Math.round(ratio)) : ratio.toFixed(1).replace('.', ',');
  verdict.innerHTML = ratio >= 1 ? '<em>×' + x + '</em> к цене ' + money(cost) : '';
  btn.hidden = false;
  btn.textContent = 'ЗАБРАТЬ ' + money(total);
  await mo.seriesTotal(totalEl, { total, cost, text: money(total), button: btn });
  busy = false;
});
</script>
</body></html>`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/series-total-demo.html'), html);
console.log(`dist/series-total-demo.html: ${(html.length / 1024).toFixed(0)} КБ`);
