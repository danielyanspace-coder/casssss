import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const elements=new Map(),events=new Map(),timers=new Map();let id=0;
const el=()=>({innerHTML:'',textContent:'',hidden:false,dataset:{},style:{},setAttribute(){},append(){},replaceChildren(){},querySelectorAll:()=>[],addEventListener(){}});
globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},createElement:el,addEventListener(n,fn){events.set(n,fn)},body:{classList:{add(){},remove(){}}}};
const nativeSet=globalThis.setTimeout,nativeClear=globalThis.clearTimeout;
globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key};globalThis.clearTimeout=key=>timers.delete(key);
let inspect,handler;const activity=[],updates=[];const state={guest:false,user:{balance:1000},config:{}};
const src=readFileSync(new URL('../public/casino.js',import.meta.url),'utf8').replace(/^import .*;$/m,'const PROVIDER_LOGOS={};').replace('export function createCasino','function createCasino').replace('  return {\n    open()', '  deps.inspect({ui,openFrame,closeFrame,refreshUser,launch,bindOverlays,clearLaunchTimers});\n  return {\n    open()');
const create=new Function(`${src};return createCasino;`)();
const api=create({state,money:String,esc:String,haptic(){},toast(){},api:(...args)=>handler(...args),onUser:u=>{state.user=u;updates.push(u)},onActivity:active=>activity.push(active),inspect:i=>inspect=i});
const {ui,openFrame,closeFrame,refreshUser,launch,bindOverlays,clearLaunchTimers}=inspect;ui.active=true;elements.get('czFrame')??document.getElementById('czFrame');elements.get('czFrame').hidden=true;
const pending=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const game={id:'one',name:'Game'};const tick=async()=>{await Promise.resolve();await Promise.resolve()};
try{
 bindOverlays();assert.ok(events.has('visibilitychange'));
 openFrame(game,{url:'about:blank',demoBalance:30000},true);inspect.clearLaunchTimers();
 const oldDemo=pending();handler=()=>oldDemo.promise;const stale=refreshUser();
 // Close with an old request pending; the forced real-wallet refresh must still run.
 let realCalls=0;handler=async()=>{realCalls++;return {user:{balance:1200}}};closeFrame();await tick();assert.equal(realCalls,1);assert.equal(state.user.balance,1200);
 openFrame(game,{url:'about:blank',demoBalance:25000},true);inspect.clearLaunchTimers();oldDemo.resolve({balance:1});await stale;assert.equal(ui.demoBalance,25000);assert.equal(elements.get('czFrameBalance').textContent,'25000 · демо');
 const oldReal=pending();handler=()=>oldReal.promise;ui.demo=false;const staleReal=refreshUser();
 openFrame(game,{url:'about:blank',demoBalance:20000},true);inspect.clearLaunchTimers();oldReal.resolve({user:{balance:1}});await staleReal;assert.equal(state.user.balance,1200);
 // One timer per visible session; no overlapping request when the response is slow.
 const slow=pending();handler=()=>slow.promise;const currentTimer=timers.get(ui.poll);timers.delete(ui.poll);const running=currentTimer.fn();assert.equal(ui.poll,0);assert.equal(timers.size,0);slow.resolve({balance:19000});await running;assert.equal(timers.size,1);
 document.hidden=true;events.get('visibilitychange')();assert.equal(timers.size,0);
 document.hidden=false;handler=async()=>({balance:18000});events.get('visibilitychange')();await tick();await tick();assert.equal(timers.size,1);
 handler=async()=>({user:{balance:1200}});closeFrame();await tick();
 // Navigating away while /launch is pending cannot reopen a game.
 ui.active=true;const lateLaunch=pending();handler=()=>lateLaunch.promise;const launching=launch(game,true);assert.equal(activity.at(-1),true);api.close();lateLaunch.resolve({url:'about:blank',demoBalance:30000});await launching;assert.equal(elements.get('czFrame').hidden,true);assert.equal(activity.at(-1),false);assert.equal(timers.size,0);
 // A failed launch restores the shell and leaves no polling timer.
 ui.active=true;handler=async()=>{throw new Error('offline')};await launch(game,true);assert.equal(elements.get('czFrame').hidden,false);assert.match(elements.get('czLaunchText').textContent,/Не удалось/);assert.equal(ui.launching,false);assert.equal(timers.size,0);handler=async()=>({user:{balance:1200}});closeFrame();await tick();
 console.log('PASS: stale demo/real balances discarded, close refresh preserved, one sequential poll, hidden-tab pause/resume, late launch discarded, failed launch shows recovery actions');
}finally{globalThis.setTimeout=nativeSet;globalThis.clearTimeout=nativeClear;delete globalThis.document;}
