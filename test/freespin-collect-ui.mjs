import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base=process.argv[2]||'http://127.0.0.1:3117';
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({env:{...process.env,LIBGL_ALWAYS_SOFTWARE:'1'}});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('.case-card');
  if(await page.locator('#onbSkip').isVisible())await page.click('#onbSkip');
  await page.locator('.case-card[data-case="warmup_100"]').first().click();
  await page.click('#fsBuyRow [data-fs="10"]');await page.click('#buyConfirm');
  await page.waitForFunction(()=>!document.querySelector('#freespins').hidden&&!document.querySelector('#fsCollect').hidden,null,{timeout:180000});
  let claims=0;page.on('request',r=>{if(r.url().includes('/api/gamble/skip'))claims++;});
  await page.click('#fsCollect');
  await page.locator('#doOpenBtn').waitFor({state:'visible',timeout:10000});
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#batchSummary').isVisible(),false,'no second summary');
  assert.equal(await page.locator('#result').isVisible(),false,'no second claim');
  assert.equal(await page.locator('#freespins').isVisible(),false,'series closed');
  assert.equal(claims,1,'one claim request');
  const account=await page.evaluate(()=>fetch('/api/me',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()));
  assert.equal(account.user.pendingReward.real+account.user.pendingReward.bonus,0,'all winnings claimed');
  assert.deepEqual(errors,[]);
  console.log(`${name}: one freespin Collect returns to idle case, no second claim or summary, pending winnings zero`);
 }finally{await browser.close();}
}
