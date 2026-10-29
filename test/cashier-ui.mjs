import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Только данные отображения. Платёжные запросы не отправляются.
    await page.route('**/api/sicilia/options', (r) => r.fulfill({ json: { enabled: true, mode: 'h2h', min: 100, max: 300000 } }));
    await page.route('**/api/wallet', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.bonus = { balance: 150, wagerLeft: 15, cashoutLeft: 0, rules: { cashoutPct: 25 } };
      await route.fulfill({ response, json: body });
    });
    await page.goto(process.argv[2] || 'http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.case-card');
    if (await page.locator('#onbSkip').isVisible()) await page.click('#onbSkip');
    const goto = async (view) => {
      if (width < 1000) {
        await page.click('#menuBtn');
        await page.click(`#menuNav [data-view="${view}"]`);
      } else await page.click(`#sideNav [data-view="${view}"]`);
      await page.waitForTimeout(350);
    };
    // Снимаем состояние в кадре после клика, до тяжёлого построения кейса.
    const loading = await page.evaluate(() => new Promise((resolve) => {
      document.querySelector('.case-card').click();
      requestAnimationFrame(() => {
        const loader = document.getElementById('caseLoader');
        resolve({ visible: !loader.hidden, opacity: getComputedStyle(loader).opacity,
          text: loader.textContent, name: document.getElementById('caseLoaderName').textContent });
      });
    }));
    assert.equal(loading.visible, true);
    assert.equal(loading.opacity, '1');
    assert.match(loading.text, /Загружаем кейс/);
    assert.ok(loading.name);
    await page.waitForFunction(() => document.getElementById('caseLoader').hidden);
    await page.click('#closeOpenerTop');
    await goto('wallet');
    await page.waitForSelector('#walletBonus details');
    assert.equal(await page.$eval('#walletBonus details', (d) => d.open), false);
    assert.equal(await page.locator('#walletBonus p').first().isVisible(), false);
    await page.click('#walletBonus summary');
    assert.equal(await page.locator('#walletBonus p').first().isVisible(), true);
    assert.equal(await page.locator('#walletBonus .cash-bonus-steps > li').count(), 3);
    const colors = await page.evaluate(() => [...document.querySelectorAll('.cash-bonus-head > *')].map((e) => getComputedStyle(e).color));
    assert.notEqual(colors[0], colors[1]);
    assert.equal(await page.locator('#siciliaMethod svg').count(), 2);
    const banks = await page.$$eval('#siciliaBank .quick-btn', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    assert.equal(new Set(banks).size, 5);
    assert.equal(await page.$eval('#siciliaCreateBtn', (e) => getComputedStyle(e).backgroundImage), await page.$eval('.open-cta', (e) => getComputedStyle(e).backgroundImage));
    await page.screenshot({ path: `/tmp/luckybox-cashier-${width}.png`, fullPage: true });
    await page.click('#walletWithdraw');
    assert.equal(await page.locator('[data-withdraw-method] svg').count(), 3);
    assert.match(await page.locator('[data-withdraw-method="crypto"]').textContent(), /USDT/);
    await goto('freemoney');
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(350);
    const sticky = await page.evaluate(() => ({
      tabs: document.getElementById('fmTabs').getBoundingClientRect().top,
      bar: document.querySelector('.topbar').getBoundingClientRect().bottom,
    }));
    assert.ok(Math.abs(sticky.tabs - sticky.bar) < 3, JSON.stringify(sticky));
    assert.equal(await page.locator('.footer-promo').nth(0).getAttribute('href'), 'https://t.me/luckybox_support');
    assert.equal(await page.locator('.footer-promo').nth(1).getAttribute('href'), 'https://t.me/Luckyboxbonus_bot');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Cashier, loader, sticky tabs: passed at ${width}px`);
  }
} finally { await browser.close(); }
