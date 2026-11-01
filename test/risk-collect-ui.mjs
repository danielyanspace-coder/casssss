import assert from 'node:assert/strict';
import {webkit,chromium} from 'playwright';
const base=process.argv[2] || 'http://127.0.0.1:3117';
for(const [name,engine] of [['webkit',webkit],['chromium',chromium]]){
 const b=await engine.launch({env:{...process.env,LIBGL_ALWAYS_SOFTWARE:'1'}});
 try{const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.waitForSelector('.case-card');if(await p.locator('#onbSkip').isVisible())await p.click('#onbSkip');
 await p.locator('.case-card[data-case="vault_1000"]').first().click();
 for(const scenario of ['skip-before-card','continue-after-card','skip-effect-fails']){
  await p.click('#doOpenBtn');await p.locator('#result').waitFor({state:'visible',timeout:60000});await p.locator('#gambleStartBtn').waitFor({state:'visible'});
  await p.click('#gambleStartBtn');await p.waitForTimeout(1500);
  if(scenario==='continue-after-card'){
   await p.locator('.gcard').first().click();await p.waitForFunction(()=>document.querySelector('#gambleSkipBtn').dataset.done==='1');
  }
  if(scenario==='skip-effect-fails')await p.evaluate(()=>{const old=Element.prototype.animate;Element.prototype.animate=function(...args){if(this.classList.contains('reward-coin'))throw new Error('effect unavailable');return old.apply(this,args);};});
  let claims=0;const count=r=>{if(r.url().includes('/api/gamble/skip'))claims++;};p.on('request',count);
  await p.click('#gambleSkipBtn');await p.locator('#gamble').waitFor({state:'hidden',timeout:5000});await p.locator('#doOpenBtn').waitFor({state:'visible',timeout:10000});
  await p.waitForTimeout(800);p.off('request',count);
  assert.equal(await p.locator('.opener-scroll').evaluate(e=>e.scrollTop),0,scenario);
  assert.equal(await p.locator('#gamble .gcard').first().isVisible(),false,scenario);
  assert.equal(claims,1,`${name}: ${scenario}: one claim request`);
  assert.deepEqual(errors,[]);console.log(`${name}: ${scenario} passed: cards hidden, opener visible, scroll=0, one claim, no errors`);
 }
 }finally{await b.close();}
}
