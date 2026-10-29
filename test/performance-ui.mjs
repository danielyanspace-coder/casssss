import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const target = process.argv[2] || 'http://localhost:3000';
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let requested;
let disconnected;
const requestSeen = new Promise((r) => { requested = r; });
const requestClosed = new Promise((r) => { disconnected = r; });
const openedPaths = new Set();
const closedPaths = new Set();
const slow = createServer((req) => { openedPaths.add(req.url); requested(); req.on('close', () => { closedPaths.add(req.url); disconnected(); }); });
await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve));
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://**/*', (r) => r.abort());
  await page.route('**/casino/cover/**', (r) => r.abort());
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Только тестовый ответ: рабочий app.js не экспортирует состояние игрока.
  await page.route('**/app.js', (r) => r.fulfill({ contentType: 'application/javascript',
    body: source + '\nwindow.__audit = { state, applyUser, switchView, renderWalletBonus, loadCryptoOptions, loadSiciliaOptions, cryptoState, siciliaState };' }));
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.case-card');
  await page.waitForFunction(() => window.__audit?.state.user);
  if (await page.locator('#onbSkip').isVisible()) await page.click('#onbSkip');
  const unchanged = await page.evaluate(() => {
    const a = window.__audit;
    const shelves = document.getElementById('caseShelves');
    const card = shelves.firstElementChild;
    const side = document.getElementById('sideNav').firstElementChild;
    const menu = document.getElementById('menuNav').firstElementChild;
    const balanceNode = document.getElementById('balanceValue').firstChild;
    a.applyUser({ ...a.state.user });
    if (balanceNode !== document.getElementById('balanceValue').firstChild) throw new Error('Unchanged balance was rebuilt');
    a.applyUser({ ...a.state.user, balance: a.state.user.balance + 1 });
    return [card === shelves.firstElementChild, side === document.getElementById('sideNav').firstElementChild,
      menu === document.getElementById('menuNav').firstElementChild];
  });
  assert.deepEqual(unchanged, [true, true, true]);
  const updated = await page.evaluate(() => {
    const a = window.__audit;
    a.applyUser({ ...a.state.user, vouchers: [], balance: 0 });
    const off = document.querySelector('[data-case="warmup_100"]').classList.contains('can-afford');
    a.applyUser({ ...a.state.user, balance: 100000 });
    const on = document.querySelector('[data-case="warmup_100"]').classList.contains('can-afford');
    a.applyUser({ ...a.state.user, vouchers: [{ case_id: 'warmup_100', count: 3 }] });
    const gift = document.querySelector('[data-case="warmup_100"]').classList.contains('free-ready');
    return { off, on, gift };
  });
  assert.deepEqual(updated, { off: false, on: true, gift: true });
  console.log('Balance updates preserve shelves/menus; affordability and gifts still update');
  await page.evaluate(() => window.__audit.switchView('freemoney'));
  await page.waitForSelector('#pwCode');
  await page.fill('#pwCode', 'UNSUBMITTED');
  await page.evaluate(() => {
    const a = window.__audit;
    a.applyUser({ ...a.state.user, balance: a.state.user.balance + 1 });
  });
  assert.equal(await page.inputValue('#pwCode'), 'UNSUBMITTED');
  console.log('Free Money preserves a typed promo code during background balance updates');
  const walletLoaded = page.waitForResponse((r) => r.url().endsWith('/api/wallet'));
  await page.evaluate(() => window.__audit.switchView('wallet'));
  await walletLoaded;
  await page.waitForSelector('#walletBalance');
  await page.evaluate(() => window.__audit.renderWalletBonus({ balance: 150, wagerLeft: 15, cashoutLeft: 0, rules: { cashoutPct: 25 } }));
  assert.equal(await page.$eval('#walletBonus details', (d) => d.open), false);
  assert.equal(await page.locator('#walletBonus li').count(), 3);
  await page.click('#walletBonus summary');
  assert.match(await page.textContent('#walletBonus'), /15/);
  await page.evaluate(() => window.__audit.renderWalletBonus({ balance: 250, wagerLeft: 0, cashoutLeft: 50, rules: { cashoutPct: 25 } }));
  assert.equal(await page.$eval('#walletBonus details', (d) => d.open), true);
  assert.equal(await page.locator('#walletBonus .is-done').count(), 1);
  assert.match(await page.textContent('.cash-bonus-limit'), /50/);
  await page.locator('#walletBonus').screenshot({ path: '/tmp/luckybox-bonus-steps.png' });
  console.log('Bonus steps stay collapsible, preserve expanded state and show live wagering/limit status');
  await page.evaluate(() => window.__audit.switchView('casino'));
  await page.waitForSelector('#casinoRoot .cz-tile');
  await page.evaluate((port) => {
    const img = document.createElement('img');
    img.id = 'slowAuditCover'; img.src = `http://127.0.0.1:${port}/slow.webp`;
    document.getElementById('casinoRoot').append(img);
  }, slow.address().port);
  await requestSeen;
  await page.evaluate(() => window.__audit.switchView('cases'));
  await Promise.race([requestClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('Hidden cover connection did not close')), 3000))]);
  assert.equal(await page.$eval('#slowAuditCover', (img) => img.hasAttribute('src')), false);
  assert.deepEqual(errors, []);
  console.log('Leaving casino cancels a real pending image connection');
  await page.evaluate(() => window.__audit.switchView('casino'));
  await page.waitForSelector('#czChips [data-chip="megaways"]');
  await page.click('#czChips [data-chip="megaways"]');
  await page.waitForSelector('#czGrid .cz-tile');
  await page.waitForSelector('#czMoreBtn:not([hidden])');
  await page.evaluate((port) => {
    const img = document.createElement('img'); img.id = 'slowMoreAudit'; img.src = `http://127.0.0.1:${port}/more.webp`;
    document.querySelector('#czGrid .cz-art').append(img);
  }, slow.address().port);
  const waitUntil = async (predicate) => {
    for (let i = 0; i < 60; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 50)); }
    assert.fail('Expected image connection state did not arrive');
  };
  await waitUntil(() => openedPaths.has('/more.webp'));
  const countBefore = await page.locator('#czGrid .cz-tile').count();
  await page.click('#czMoreBtn');
  await page.waitForFunction((n) => document.querySelectorAll('#czGrid .cz-tile').length > n, countBefore);
  await waitUntil(() => closedPaths.has('/more.webp'));
  assert.ok(await page.$eval('#slowMoreAudit', (img) => img.hasAttribute('src') && !img.dataset.pausedSrc), 'Retained covers must resume after pagination');
  await page.evaluate(() => window.__audit.switchView('cases'));
  console.log('Load more cancels pending covers and appends the next page');
  let launchCalls = 0;
  await page.route('**/api/casino/launch', (r) => { launchCalls++; return r.fulfill({ status: 401, json: { code: 'AUTH' } }); });
  await page.evaluate(() => { window.__audit.state.guest = true; window.__audit.switchView('casino'); });
  await page.click('#czChips [data-chip="home"]');
  await page.waitForSelector('.cz-block[data-block="popular"] .cz-tile');
  await page.locator('.cz-block[data-block="popular"] .cz-tile').first().click();
  await page.click('#czPlay');
  await page.waitForSelector('#authBackdrop:not([hidden])');
  assert.equal(await page.locator('#czSheet').isVisible(), false);
  assert.equal(launchCalls, 0, 'A guest must not wait for a protected game-launch request');
  await page.click('#authClose');
  await page.evaluate(() => { window.__audit.state.guest = false; window.__audit.switchView('cases'); });
  console.log('Guest game launch opens registration immediately and closes the preview');
  let cryptoOptionsCalls = 0;
  let sbpOptionsCalls = 0;
  await page.route('**/api/crypto/options', async (r) => {
    cryptoOptionsCalls++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await r.fulfill({ json: { enabled: false, coins: [] } });
  });
  await page.route('**/api/sicilia/options', async (r) => {
    sbpOptionsCalls++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await r.fulfill({ json: { enabled: true, mode: 'h2h' } });
  });
  await page.evaluate(async () => {
    const a = window.__audit;
    a.cryptoState.loaded = false; a.siciliaState.loaded = false;
    await Promise.all([a.loadCryptoOptions(), a.loadCryptoOptions(), a.loadCryptoOptions(),
      a.loadSiciliaOptions(), a.loadSiciliaOptions(), a.loadSiciliaOptions()]);
  });
  assert.equal(cryptoOptionsCalls, 1);
  assert.equal(sbpOptionsCalls, 1);
  console.log('Concurrent cashier opens share one options request per gateway');
  await page.close();
} finally {
  await browser.close();
  slow.closeAllConnections();
  await new Promise((r) => slow.close(r));
}
