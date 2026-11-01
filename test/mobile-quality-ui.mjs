import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => r.abort());
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  await page.route('**/app.js*', r => r.fulfill({ contentType: 'application/javascript',
    body: source + '\nwindow.__quality = { state, switchView, openCase, closeOpener, runFreeSpins, motion };' }));
  await page.route('**/api/casino/lobby', r => r.fulfill({ json: { tabs: [{id:'fast',label:'Мини-игры'}], providers: [], counts: { fast: 2 } } }));
  await page.route('**/api/casino/games', r => r.fulfill({ json: { games: [], total: 0 } }));
  await page.route('**/api/casino/home', r => r.fulfill({ json: { blocks: [] } }));
  await page.goto(process.argv[2] || 'http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.case-card');
  if (await page.locator('#onbSkip').isVisible()) await page.click('#onbSkip');
  await page.evaluate(() => window.__quality.switchView('casino'));
  await page.locator('#czSeg [data-kind="fast"]').click();
  for (const view of ['crash', 'upgrade']) {
    await page.locator(`[data-own="${view}"]`).click();
    await page.locator(`#view-${view}.active [data-own-game-back]`).click();
    await page.waitForSelector('#view-casino.active [data-own="crash"]');
  }
  await page.evaluate(() => window.__quality.switchView('cases'));
  const before = await page.evaluate(() => {
    window.scrollTo(0, 1200);
    const row = document.querySelector('.shelf-row'); row.scrollLeft = 160;
    return { y: scrollY, x: row.scrollLeft };
  });
  await page.evaluate(() => window.__quality.openCase('dust_25'));
  await page.waitForSelector('#opener:not([hidden])');
  await page.locator('#closeOpenerTop').click();
  const after = await page.evaluate(() => ({ y: scrollY, x: document.querySelector('.shelf-row').scrollLeft }));
  assert.ok(Math.abs(before.y - after.y) < 3, `Expected scroll ${before.y}, got ${after.y}`);
  assert.equal(after.x, before.x);
  await page.evaluate(() => window.__quality.openCase('dust_25'));
  await page.waitForSelector('#opener:not([hidden])');
  await page.evaluate(() => {
    const a = window.__quality, c = a.state.config.cases.find(c => c.id === 'dust_25');
    const spins = Array.from({ length: 10 }, () => ({ ...c.items[0], value: 0 }));
    window.__seriesDone = false;
    a.runFreeSpins({ count: 10, spins, total: 0 }, c).then(() => { window.__seriesDone = true; });
  });
  await page.waitForSelector('.mo-dim');
  await page.evaluate(() => window.__quality.closeOpener());
  await page.waitForFunction(() => window.__seriesDone, null, { timeout: 6000 });
  assert.equal(await page.locator('.mo-dim').count(), 0);
  assert.equal(await page.locator('#opener').isHidden(), true);
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#fsLog .fs-chip').count(), 0, 'Closed series must not keep spinning');
  assert.deepEqual(errors, []);
  console.log('Mobile UI: Crash/Upgrade return to mini-games, case restores both scroll axes, closing during intro stops the series.');
} finally { await browser.close(); }
