import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const base = process.argv[2] || 'http://127.0.0.1:3117';
for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`${name}: starting account checks`);
  // На сервере без GPU WebKit использует программный рендеринг.
  const browser=await engine.launch({headless:true, timeout:60_000,
    ...(name==='webkit' ? {env:{...process.env,LIBGL_ALWAYS_SOFTWARE:'1'}} : {})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const artifacts=path.resolve('test-artifacts',`accounts-${name}`);
  fs.mkdirSync(artifacts,{recursive:true});
  try {
    await context.tracing.start({screenshots:true,snapshots:true,sources:true});
    const page=await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('crash',()=>console.error(`${name}: PAGE CRASH`));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.case-card');
    if(await page.locator('#onbSkip').isVisible())await page.click('#onbSkip');
    console.log(`${name}: opening balance sheet`);
    await page.click('#balanceChip');
    await page.locator('#walletSheet').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-wallet="real"]').evaluate(e=>e.classList.contains('active')),true);
    await page.click('[data-wallet="bonus"]');
    await page.waitForFunction(()=>document.querySelector('#balanceChip').classList.contains('is-bonus'));
    await page.click('#balanceChip');
    await page.click('[data-wallet="real"]');
    await page.waitForFunction(()=>!document.querySelector('#balanceChip').classList.contains('is-bonus'));
    await page.click('#balanceChip');await page.click('#walletSheetCashier');
    await page.waitForSelector('#view-wallet.active');
    await page.click('#walletWithdraw');
    await page.waitForSelector('.bank-search',{state:'attached'});
    await page.locator('.bank-search').fill('сбер');
    const options=await page.locator('#withdrawBank option').allTextContents();
    assert.ok(options.length>=2&&options.length<10,options.join(','));
    assert.ok(options.some(s=>/сбер/i.test(s)));
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).paddingBottom),'0px');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).touchAction),'pan-x pan-y');
    // Pinch gestures are canceled and do not reload the document.
    assert.equal(await page.evaluate(()=>!document.dispatchEvent(new Event('gesturestart',{bubbles:true,cancelable:true}))),true);
    await page.click('#menuBtn');await page.click('#menuNav [data-view="cases"]');
    await page.click('#promoCasino');await page.waitForSelector('#view-casino.active');
    await page.waitForTimeout(250);
    assert.deepEqual(errors,[],`${name}: ${errors.join('; ')}`);
    await page.screenshot({path:`/tmp/luckybox-accounts-${name}.png`});
    await context.tracing.stop();
    console.log(`${name}: account sheet, selection, cashier, bank search, touch policy, footer and single casino tap passed`);
  } catch(error) {
    console.error(`${name}: failed: ${error.stack || error}`);
    await context.tracing.stop({path:path.join(artifacts,'trace.zip')}).catch(e=>console.error(`${name}: trace unavailable: ${e.message}`));
    throw error;
  } finally {await browser.close();}
}
