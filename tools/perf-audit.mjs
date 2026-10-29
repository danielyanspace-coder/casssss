/** Local UI benchmark: npm run perf:audit -- [url] [output.json]. CPU slowed 4×; three samples. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const executablePath=process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser=await chromium.launch(executablePath ? {executablePath} : {});
const results=[];
try {
 for(let sample=0;sample<3;sample++) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/app.js',r=>r.fulfill({body:readFileSync(new URL('../public/app.js', import.meta.url),'utf8')+'\nwindow.__audit={state,applyUser,openCase,switchView,renderWalletBonus};',contentType:'application/javascript'}));
  await page.addInitScript(()=>{window.__long=[];new PerformanceObserver(l=>window.__long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
  const cdp=await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const t=Date.now();await page.goto(process.argv[2] || 'http://localhost:3000',{waitUntil:'domcontentloaded'});await page.waitForSelector('.case-card');
  const startup=Date.now()-t;
  await page.waitForFunction(()=>window.__audit?.state.user);
  if(await page.locator('#onbSkip').isVisible()) await page.click('#onbSkip');
  const metrics=await page.evaluate(async()=>{
   const a=window.__audit;
   const times=[];const shelves=document.getElementById('caseShelves');
   const node=shelves.firstElementChild;
   for(let i=0;i<5;i++){let t=performance.now();a.applyUser({...a.state.user,balance:a.state.user.balance+1});times.push(performance.now()-t);}
   const shelfKept=node===shelves.firstElementChild;
   const id=a.state.config.cases.find(c=>c.id==='warmup_100').id;
   const start=performance.now();a.openCase(id);
   await new Promise((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(new Error('Case did not open within 15 seconds')),15000);
     const tick=()=>{if(document.getElementById('opener').hidden)requestAnimationFrame(tick);else{clearTimeout(timeout);resolve();}};
     requestAnimationFrame(tick);
   });
   const openMs=performance.now()-start;
   return {applyUserMs:times,shelfKept,openMs,domNodes:document.querySelectorAll('*').length,longTasks:window.__long.filter(e=>e.duration>50),resources:performance.getEntriesByType('resource').length};
  });
  results.push({sample,startup,...metrics,errors});await page.close();
 }
}finally{await browser.close()}
writeFileSync(process.argv[3]||'/tmp/luckybox-perf.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
