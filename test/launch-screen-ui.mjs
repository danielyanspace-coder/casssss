import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base=process.argv[2]||'http://127.0.0.1:3117';
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({env:{...process.env,LIBGL_ALWAYS_SOFTWARE:'1'}});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/app-shell.html',async route=>{await gate;await route.continue();});
  await page.goto(base,{waitUntil:'commit'});
  await page.locator('#launchScreen').waitFor();
  await page.waitForFunction(()=>document.querySelector('.launch-logo').naturalWidth>0);
  await page.waitForFunction(()=>performance.getEntriesByName('lb:splash-painted').length>0);
  assert.equal(await page.locator('#app').count(),0,'main markup not loaded yet');
  assert.equal(await page.locator('link[rel="stylesheet"]').count(),0,'splash has no external stylesheet');
  await page.screenshot({path:`/tmp/luckybox-launch-${name}.png`});
  release();await page.locator('#launchScreen').waitFor({state:'detached',timeout:20000});
  await page.locator('.case-card').first().waitFor({state:'visible'});
  const timing=await page.evaluate(()=>({paint:performance.getEntriesByName('lb:splash-painted')[0].startTime,
   ready:performance.getEntriesByName('lb:site-ready')[0].startTime,
   contentful:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
   app:performance.getEntriesByType('resource').filter(r=>/\/(app-shell\.html|app\.js|styles\.css|boot\.js)(\?|$)/.test(r.name)).map(r=>({name:r.name,start:r.startTime}))}));
  if(timing.contentful!=null)assert.ok(timing.paint>=timing.contentful,'main startup follows actual first contentful paint');
  for(const r of timing.app)assert.ok(r.start>=timing.paint,`${name}: ${r.name} starts after splash paint`);
  assert.deepEqual(errors,[]);console.log(`${name}: inline splash before main requests, ready transition passed`,JSON.stringify(timing));
  await page.close();
  for(const failing of ['app-shell.html','api/config']){
   const p=await browser.newPage();let broken=true;
   await p.route(`**/${failing}`,r=>broken?r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'}):r.continue());
   await p.goto(base,{waitUntil:'domcontentloaded'});await p.locator('#launchRetry').waitFor({state:'visible',timeout:15000});
   assert.equal(await p.locator('#launchScreen').isVisible(),true);
   broken=false;await p.click('#launchRetry');await p.locator('#launchScreen').waitFor({state:'detached',timeout:20000});
   console.log(`${name}: ${failing} failure offers working retry`);await p.close();
  }
 }finally{await browser.close();}
}
