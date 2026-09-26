import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-casssss/9df15b15-5d1c-5200-b2d1-a089081fef37/scratchpad/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// телефон: меню-картинка
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto('http://localhost:3111/', { waitUntil: 'load' });
await m.waitForTimeout(1300);
await m.evaluate(() => document.getElementById('onbBackdrop')?.remove());
await m.evaluate(() => document.getElementById('menuBtn')?.click());
await m.waitForTimeout(700);
console.log('телефон, плиток «Слоты»:', await m.evaluate(() => document.querySelectorAll('#menuExtra [data-view="slots"]').length));
console.log('телефон, плитки меню:', await m.evaluate(() => [...document.querySelectorAll('#menuExtra .menu-tile-title')].map(n => n.textContent)));
await m.screenshot({ path: OUT + 'hide-menu.png', fullPage: false });
await m.close();

// компьютер: боковая панель
const d = await b.newPage({ viewport: { width: 1440, height: 900 } });
await d.goto('http://localhost:3111/', { waitUntil: 'load' });
await d.waitForTimeout(1300);
await d.evaluate(() => document.getElementById('onbBackdrop')?.remove());
console.log('компьютер, пунктов «Слоты»:', await d.evaluate(() => document.querySelectorAll('#sideNav [data-view="slots"]').length));
console.log('компьютер, боковое меню:', await d.evaluate(() => [...document.querySelectorAll('#sideNav .nav-title')].map(n => n.textContent.trim())));
await d.screenshot({ path: OUT + 'hide-nav.png', clip: { x: 0, y: 0, width: 330, height: 780 } });
await d.close();
await b.close();
