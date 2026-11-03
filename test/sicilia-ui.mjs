import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    let accepted = 0, cancelled = 0, created = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    const payment = { id: 700, amount: 700, paySum: 700, method: 'sbp', status: 'processing',
      expiresAt: Date.now() + 600000, requisite: { phone: '79991234567', bank: 'Тестовый банк', holder: 'Получатель' } };
    await page.route('**/api/sicilia/options', (r) => r.fulfill({ json: { enabled: true, mode: 'h2h', min: 100, max: 300000 } }));
    await page.route('**/api/sicilia/list', (r) => r.fulfill({ json: { rows: [] } }));
    await page.route('**/api/sicilia/create', (r) => {
      created++;
      assert.equal(r.request().postDataJSON().amount, 500);
      return r.fulfill({ json: { ...payment, requisite: null, proposal: true, proposalUntil: Date.now() + 60000, requestedAmount: 500 } });
    });
    await page.route('**/api/sicilia/accept', (r) => { accepted++; return r.fulfill({ json: payment }); });
    await page.route('**/api/sicilia/cancel', (r) => { cancelled++; return r.fulfill({ json: { payment: { ...payment, status: 'unclaimed', requisite: null } } }); });
    await page.goto(process.argv[2] || 'http://127.0.0.1:3119', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.case-card');
    if (await page.locator('#onbSkip').isVisible()) await page.click('#onbSkip');
    if (width < 1000) { await page.click('#menuBtn'); await page.click('#menuNav [data-view="wallet"]'); }
    else await page.click('#sideNav [data-view="wallet"]');
    const offer = async () => {
      await page.click('[data-payment-method="sicilia"]');
      await page.fill('#siciliaAmount', '500');
      await page.click('#siciliaCreateBtn');
      await page.locator('#siciliaOfferYes').waitFor({ state: 'visible' });
      assert.match(await page.locator('#siciliaCheckout').innerText(), /700/);
      assert.ok(!(await page.locator('#siciliaCheckout').innerText()).includes('79991234567'));
    };
    await offer();
    await page.screenshot({ path: `/tmp/sicilia-offer-${width}.png`, fullPage: true });
    await page.click('#siciliaOfferYes');
    await page.waitForSelector('#siciliaOfferYes', { state: 'detached' });
    assert.equal(accepted, 1);
    assert.equal(created, 1);
    await page.locator('.sic-card-holder').waitFor({ state: 'visible' });
    assert.match(await page.locator('.sic-card-holder').innerText(), /получатель/i);
    await offer();
    await page.click('#siciliaOfferNo');
    await page.waitForFunction(() => !document.getElementById('siciliaCreate').hidden);
    await page.waitForTimeout(100);
    assert.equal(cancelled, 1);
    await offer();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);
    assert.equal(cancelled, 2);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Sicilia proposal: confirmation, decline, hidden requisites and tab exit passed at ${width}px`);
  }
} finally { await browser.close(); }
