import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const api=source.slice(source.indexOf('const CASE_REWARD_PATHS'),source.indexOf('\nconst fmt ='));
const close=source.slice(source.indexOf('function closeOpener()'),source.indexOf('/**\n * «Забрать» после результата'));
const collection=source.slice(source.indexOf('let rewardCollection ='),source.indexOf("document.getElementById('gambleSkipBtn').addEventListener('click', async (e) => {"));
for (const path of ['/api/open','/api/freespins/buy','/api/gamble/pick']) {
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let balance=1000,pending=0,claims=0,acks=0;
  const errors=[];
  const elements={opener:{hidden:false},gamble:{hidden:false}};
  const state={user:{id:1,balance:1000},autoStop:false};
  const ctx=vm.createContext({state,Set,
    document:{getElementById:id=>elements[id],body:{classList:{remove(){}}}},
    cancelCaseLoad(){},motion:()=>({reset(){}}),endBonusMode(){},restorePagePosition(){},
    toast:msg=>errors.push(msg),applyUser:user=>{state.user=user;},
    spendableMoney:()=>state.user.balance,updateOpenerBalance(){},
    fetch:async requested=>{
      if(requested===path){await gate;pending=75;}
      if(requested==='/api/gamble/skip'){balance+=pending;pending=0;claims++;}
      if(requested==='/api/freespins/ack')acks++;
      const user={id:1,balance,pendingReward:{real:pending,bonus:0}};
      return {ok:true,json:async()=>({user,balance})};
    },
  });
  vm.runInContext(`let freeSpinPresentation=0,fsCollectPending=null,caseReturnPosition=null;\n${api}\n${collection}\n${close}`,ctx);
  const request=ctx.api(path);
  ctx.closeOpener();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.opener.hidden,true,'exit closes immediately');
  assert.equal(state.autoStop,true,'exit stops autoplay');
  assert.equal(claims,1,'exit first collects whatever is already committed');
  release();
  const result=await request;
  assert.equal(result.user.balance,1075,'late reward is collected after exit');
  assert.equal(state.user.balance,1075);
  assert.equal(pending,0);
  ctx.closeOpener();ctx.closeOpener();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(balance,1075,'repeated exits cannot credit twice');
  assert.ok(acks>0,'exit acknowledges the dismissed free-spin presentation');
  assert.deepEqual(errors,[]);
}
// Closing while a series is waiting for Collect must also release its waiter.
{
  const ctx=vm.createContext({state:{},document:{getElementById:()=>({}),body:{classList:{remove(){}}}},
    cancelCaseLoad(){},motion:()=>({reset(){}}),endBonusMode(){},restorePagePosition(){},toast(){},
    collectExitedCase:async()=>{},
  });
  vm.runInContext(`let caseExitVersion=0,caseExitCollection=null,freeSpinPresentation=0,caseReturnPosition=null;
    const fsCollectPending=async options=>{ if(options.quick===true) settled=true; };\n${close}`,ctx);
  // Use an exposed callback so the check observes the actual close handler.
  ctx.settled=false;
  vm.runInContext('closeOpener()',ctx);
  assert.equal(vm.runInContext('settled',ctx),true);
}
console.log('Case exit: immediate collect, delayed open/free-spins/risk replies, autoplay stop, series dismissal and repeat protection passed');

// DOM clears currentTarget after dispatch, before an awaited claim completes.
{
  let handler,release,returned=false;
  const button={dataset:{done:'1'},textContent:'Продолжить',addEventListener:(_,fn)=>{handler=fn;}};
  const gate=new Promise(resolve=>{release=resolve;});
  const ctx=vm.createContext({state:{busy:false},
    document:{getElementById:()=>button,querySelector:()=>null},
    collectReward:()=>gate,toast:message=>{throw new Error(message);},
    returnToCaseIdle:async()=>{returned=true;},
  });
  const start=source.indexOf("document.getElementById('gambleSkipBtn').addEventListener('click', async (e) => {");
  const end=source.indexOf("document.getElementById('againBtn')",start);
  vm.runInContext(source.slice(start,end),ctx);
  const event={currentTarget:button};
  const pending=handler(event);event.currentTarget=null;release();await pending;
  assert.equal(returned,true,'Continue returns to the case after the async claim');
  assert.equal(button.dataset.done,undefined);
  assert.equal(button.textContent,'Забрать без риска');
}
console.log('Risk Continue: asynchronous claim survives DOM event cleanup');

// Browsing and closing a case as a guest must not send authenticated requests.
{
  let calls=0;
  const ctx=vm.createContext({state:{guest:true,user:null},api:async()=>{calls++;throw new Error('unexpected authenticated request');}});
  vm.runInContext(collection,ctx);
  await ctx.collectExitedCase();
  assert.equal(calls,0,'guest case exit does not prompt for authentication');
}
console.log('Guest case exit: no reward claim or acknowledgement request');
// Safari may suspend animation frames or reject an optional visual effect.
// The confirmed claim must still close the table and finish exactly once.
for (const mode of ['paused-frames', 'effect-error', 'canceled-effect', 'fast-second-tap']) {
  let balance=100,claims=0,closed=false,removed=0;
  const value={innerHTML:'',animate(){if(mode==='effect-error')throw new Error('effect unavailable');}};
  const sum={textContent:'10 ₽',getBoundingClientRect:()=>({left:0,top:0,width:20})};
  value.getBoundingClientRect=()=>({left:100,top:100});
  const ctx=vm.createContext({performance,setTimeout,clearTimeout,
    state:{user:{}},spendableMoney:()=>balance,
    api:async()=>{claims++;return {user:{balance:110}};},applyUser:u=>{balance=u.balance;},
    matchMedia:()=>({matches:false}),money:n=>String(n),moneyRich:n=>String(n),paintMoneyRich:(el,n)=>{el.innerHTML=String(n);},
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},updateOpenerBalance(){},
    document:{getElementById:id=>id==='opener'?{hidden:false}:id==='resultValue'?sum:value,
      createElement:()=>({style:{},remove(){removed++;},animate:()=>({finished:mode==='canceled-effect'?Promise.reject(new Error('canceled')):Promise.resolve()})}),
      body:{append(){}}},
  });
  vm.runInContext(collection,ctx);
  const pending=ctx.collectReward({onCollected:()=>{closed=true;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,true,'confirmed claim closes the risk table before decorative effects');
  if(mode==='fast-second-tap')await ctx.collectReward();
  await pending;
  assert.equal(balance,110);assert.equal(claims,1);
  assert.equal(sum.textContent,'0');
  assert.ok(mode==='effect-error'||removed>0,'coin is cleaned even if frames are paused');
}
console.log('Risk collection: paused frames, unavailable/canceled effects, fast repeat and immediate table close passed');
