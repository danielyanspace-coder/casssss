import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const target = process.argv[2] || 'http://localhost:3000';
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let fontRequest;
  // Имитируем зависший сервер шрифтов. Сайт должен запуститься до его ответа.
  await page.route('https://fonts.googleapis.com/**', (route) => { fontRequest = route; });
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  let loggedIn = false;
  let siciliaCalls = 0;
  let failSicilia = false;
  let cryptoCalls = 0;
  const user = (await (await fetch(`${target}/api/me`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).user;
  user.stats.rounds = 1;
  user.bonusBalance = 150;
  user.wagerRequired = 15;
  await page.route('**/api/me', (r) => r.fulfill({ status: loggedIn ? 200 : 401, json: loggedIn ? { user } : { code: 'AUTH' } }));
  await page.route('**/api/auth/login', (r) => { loggedIn = true; return r.fulfill({ json: { user } }); });
  await page.route('**/api/sicilia/options', (r) => {
    siciliaCalls++;
    if (failSicilia) { failSicilia = false; return r.fulfill({ status: 503, json: { message: 'Temporary SBP error' } }); }
    return r.fulfill({ json: { enabled: true, mode: 'h2h', min: 100, max: 300000 } });
  });
  await page.route('**/api/crypto/options', (r) => {
    cryptoCalls++;
    if (cryptoCalls === 1) return r.fulfill({ status: 503, json: { message: 'Temporary gateway error' } });
    return r.fulfill({ json: { enabled: true, coins: [{ currency: 'USDT', name: 'Tether', networks: [{ network: 'TRON', name: 'TRON' }] }], rates: { USDT: 90 }, payoutRates: { USDT: 95 }, min: 100, max: 500000 } });
  });
  await page.goto(target, { waitUntil: 'commit' });
  await page.waitForSelector('.case-card', { timeout: 8000 });
  assert.ok(fontRequest, 'External font request must still be pending');
  assert.equal(await page.locator('#bootStatus').count(), 0);
  await fontRequest.abort();
  console.log('Startup: interactive before external fonts respond');
  await page.click('#menuBtn');
  await page.click('#menuNav [data-view="wallet"]');
  await page.waitForSelector('#authBackdrop:not([hidden])');
  assert.equal(siciliaCalls, 0, 'Guest must not request protected payment settings');
  assert.equal(cryptoCalls, 0);
  if (await page.locator('#authNick').isVisible()) await page.click('#authSwitch button');
  await page.fill('#authEmail', 'tester@example.com');
  await page.fill('#authPassword', 'TestPassword123');
  await page.click('#authSubmit');
  await page.waitForSelector('#view-wallet.active');
  await page.waitForSelector('#siciliaCreate:not([hidden])');
  assert.equal(siciliaCalls, 1);
  assert.equal(await page.locator('#siciliaCreateLabel').textContent(), 'Оплатить');
  await page.fill('#siciliaAmount', '1000');
  assert.match(await page.locator('#siciliaCreateLabel').textContent(), /^Оплатить/);
  assert.equal(await page.locator('#perkBar .is-bonus').count(), 0);
  await page.click('[data-payment-method="crypto"]');
  await page.waitForSelector('#cryptoStatus:not([hidden])');
  assert.equal(await page.locator('#cryptoAmount').count(), 1, 'Failed options must preserve the form');
  // Пользователь повторяет загрузку, без перезагрузки страницы.
  await page.click('#cryptoRetry');
  await page.waitForSelector('#coinGrid [data-coin]');
  assert.equal(await page.locator('#cryptoCreateBtn').isEnabled(), true);
  assert.equal(cryptoCalls, 2);
  console.log('Cashier: guest → login → SBP/card; crypto recovers after a 503 without reload');
  await page.click('#brandHome');
  const card = page.locator('.case-card').first();
  await card.scrollIntoViewIfNeeded();
  const bounds = await card.boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  // pointerdown + pointerup без синтетического click (сценарий Safari).
  // Пересоздаём карточку между ними: старый индивидуальный listener теряется.
  await card.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: x, clientY: y });
  await card.evaluate((el) => el.replaceWith(el.cloneNode(true)));
  await page.locator('.case-card').first().dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: x, clientY: y });
  await page.waitForSelector('#opener:not([hidden])');
  await page.click('#closeOpenerTop');
  // Свайп по горизонтальной полке не должен открывать кейс.
  const next = page.locator('.case-card').first();
  await next.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 8, clientX: x, clientY: y });
  await next.dispatchEvent('pointermove', { pointerType: 'touch', isPrimary: true, pointerId: 8, clientX: x + 80, clientY: y });
  await next.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, pointerId: 8, clientX: x + 80, clientY: y });
  assert.equal(await page.locator('#opener').isVisible(), false);
  await next.tap();
  await page.waitForSelector('#opener:not([hidden])');
  assert.deepEqual(errors, []);
  console.log('Cases: first touch opens despite card replacement; swipe does not open; real tap works');
  // Ошибка СБП не должна кешироваться до перезагрузки страницы.
  failSicilia = true;
  siciliaCalls = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.case-card');
  await page.click('#menuBtn');
  await page.click('#menuNav [data-view="wallet"]');
  await page.waitForSelector('#coinGrid [data-coin]');
  assert.equal(siciliaCalls, 1);
  await page.click('#brandHome');
  await page.click('#menuBtn');
  await page.click('#menuNav [data-view="wallet"]');
  await page.waitForSelector('#siciliaCreate:not([hidden])');
  assert.equal(siciliaCalls, 2);
  assert.deepEqual(errors, []);
  console.log('SBP: transient options failure retries on next cashier visit without reload');
  await page.close();
} finally { await browser.close(); }
