import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const elements=new Map();
const el=()=>({innerHTML:'',textContent:'',hidden:false,dataset:{},style:{},setAttribute(){},append(){}});
globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id);},createElement:el,body:{classList:{add(){},remove(){}}}};
let inspect;
const src=readFileSync(new URL('../public/casino.js',import.meta.url),'utf8')
 .replace(/^import .*;$/m,'const PROVIDER_LOGOS={};')
 .replace('export function createCasino','function createCasino')
 .replace('  return {\n    open()', '  deps.inspect({ui,openFrame,refreshUser,renderFrameBalance,clearLaunchTimers});\n  return {\n    open()');
const create=new Function(`${src}; return createCasino;`)();
const state={user:{balance:1234},config:{}};
const calls=[];let updates=0;
create({state,money:n=>`${n} RUB`,esc:String,api:async path=>{calls.push(path);return {balance:29900,user:{balance:1234}};},onUser(){updates++;},inspect:i=>{inspect=i;}});
const {ui,openFrame,refreshUser,renderFrameBalance,clearLaunchTimers}=inspect;
try{
 openFrame({name:'Game'},{url:'about:blank',demoBalance:30000},true);
 assert.equal(elements.get('czFrameBalance').textContent,'30000 RUB · демо');
 assert.equal(elements.get('czFrameName').textContent,'Game · демо');
 await refreshUser();
 assert.deepEqual(calls,['/api/casino/demo-balance']);
 assert.equal(elements.get('czFrameBalance').textContent,'29900 RUB · демо');
 assert.equal(state.user.balance,1234);assert.equal(updates,0);
 ui.demo=false;renderFrameBalance();
 assert.equal(elements.get('czFrameBalance').textContent,'1234 RUB');
 console.log('PASS: demo screen hides real balance, polls demo wallet only, leaves user wallet unchanged');
}finally{clearInterval(ui.poll);inspect.clearLaunchTimers();delete globalThis.document;}
