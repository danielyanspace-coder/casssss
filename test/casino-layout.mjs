import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch();
try {
 for (const width of [320, 390, 599, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  const games = ['Sweet Bonanza CandyLand', 'Crazy Time', 'Mega Wheel', 'Monopoly Live'].map((name,i) => ({ id: 'live-'+i, name, provider: 'Test Live', vertical: false, cover: '/assets/ui/prov-evolution-live.webp' }));
  await page.route('**/api/casino/lobby', r => r.fulfill({ json: { tabs: [{id:'slots',label:'Слоты'},{id:'live',label:'Live казино'},{id:'fast',label:'Быстрые игры'}], providers: [], counts: { slots: 4, live: 4, fast: 4 }, rtp:70 } }));
  await page.route('**/api/casino/home', r => r.fulfill({ json: { blocks: ['popular-live','shows','provider:test'].map((id,i)=>({ id, type:i===2?'provider':i===0?'popular':'match',provider:'test',title:'Live '+i,icon:'wheel',total:4,rows:1,games })) } }));
  await page.route('**/api/casino/games', r => r.fulfill({ json: { games, total:games.length } }));
  await page.goto(process.argv[2] || 'http://127.0.0.1:3000', {waitUntil:'domcontentloaded'});
  await page.waitForSelector('.case-card');
  if(await page.locator('#onbSkip').isVisible()) await page.click('#onbSkip');
  await page.locator('#promoCasino').click();
  await page.locator('#czSeg [data-kind="live"]').click();
  // Заглушки тоже имеют .cz-block: измеряем только ответ с настоящими играми.
  await page.waitForSelector('.cz[data-cz-kind="live"] .cz-block .cz-tile[data-game]');
  const leaders = await page.locator('.cz-block').evaluateAll(bs=>bs.map(b=>b.querySelector('.cz-name').textContent));
  assert.equal(new Set(leaders).size,3, 'Different live shelves must open with different games');
  const geometry = await page.locator('.cz-block .cz-art').first().evaluate(e=>{const r=e.getBoundingClientRect(); return { ratio:r.width/r.height, fit:getComputedStyle(e.querySelector('img:not(.cz-blur)')).objectFit };});
  assert.ok(Math.abs(geometry.ratio-.75)<.01);
  assert.equal(geometry.fit,'contain');
  const titleBox = await page.locator('.cz-block .cz-name').first().boundingBox();
  assert.ok(titleBox.width > 20 && titleBox.height > 10, 'Live game title must be readable');
  await page.locator('#czSeg [data-kind="fast"]').click();
  await page.waitForSelector('.cz-fast');
  const tops = await page.locator('.cz-fast').evaluate(grid => {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    return [...grid.querySelectorAll('.cz-art')].slice(0, columns).map(e => e.getBoundingClientRect().top);
  });
  assert.ok(Math.max(...tops) - Math.min(...tops) < 1, 'First three covers must align');
  if (width < 600) {
    const space = await page.locator('.cz-fast').evaluate(e => e.getBoundingClientRect().top - document.querySelector('.cz-tools').getBoundingClientRect().bottom);
    assert.ok(space >= 24, 'Spacing below search');
  }
  assert.equal(await page.locator('.cz-own .cz-prov').count(), 0);
  assert.equal(await page.locator('.cz-own .cz-name').first().evaluate(e => getComputedStyle(e).position), 'absolute');
  const gap = await page.locator('.cz-fast').evaluate(e=>({row:parseFloat(getComputedStyle(e).rowGap),col:parseFloat(getComputedStyle(e).columnGap)}));
  assert.ok(gap.row>gap.col, JSON.stringify(gap));
  assert.ok(!/Отдача игр провайдеров/.test(await page.locator('#czBody').innerText()));
  assert.deepEqual(errors,[]);
  await page.screenshot({ path: `artifacts/casino-${width}.png`, fullPage: true, animations: 'disabled' });
  console.log(`Live and fast layout ${width}px: portrait, complete image, distinct leaders, visible title, row spacing, no RTP notice`);
  await page.close();
 }
} finally { await browser.close(); }
