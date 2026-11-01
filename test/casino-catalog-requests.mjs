import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const elements=new Map();const element=()=>({innerHTML:'',hidden:true,dataset:{},style:{},querySelector:()=>null,querySelectorAll:()=>[]});
globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}};
let inspect,handler;const calls=[];
const source=readFileSync(new URL('../public/casino.js',import.meta.url),'utf8').replace(/^import .*;$/m,'const PROVIDER_LOGOS={};').replace('export function createCasino','function createCasino').replace('  return {\n    open()', '  deps.inspect({ui,loadHome,loadFast,catalogRequest,catalogRequests});\n  return {\n    open()');
const create=new Function(source+';return createCasino;')();create({state:{config:{}},esc:String,money:String,plural:String,api:(path,body)=>{calls.push([path,body]);return handler(path,body)},inspect:i=>inspect=i});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
try{
 const {ui,loadHome,loadFast,catalogRequest,catalogRequests}=inspect;
 let pending=deferred();handler=()=>pending.promise;
 const jobs=Array.from({length:20},()=>loadHome('slots'));assert.equal(calls.length,1);pending.resolve({blocks:[{type:'popular',games:[{id:'x'}]}]});await Promise.all(jobs);assert.equal(catalogRequests.size,0);await loadHome('slots');assert.equal(calls.length,1);
 pending=deferred();handler=()=>pending.promise;const fast=Array.from({length:20},()=>loadFast());assert.equal(calls.length,2);pending.resolve({games:[{id:'fast'}]});await Promise.all(fast);assert.equal(ui.fast[0].id,'fast');assert.equal(catalogRequests.size,0);
 pending=deferred();handler=()=>pending.promise;const failed=Array.from({length:3},()=>loadHome('live'));assert.equal(calls.length,3);pending.reject(new Error('offline'));assert.ok((await Promise.allSettled(failed)).every(r=>r.status==='rejected'));assert.equal(catalogRequests.size,0);
 handler=async()=>({blocks:[]});await loadHome('live');assert.equal(calls.length,4);assert.deepEqual(ui.home.live,[]);
 const a=deferred(),b=deferred();handler=(path,body)=>body.kind==='one'?a.promise:b.promise;const one=loadHome('one'),two=loadHome('two');assert.equal(calls.length,6);a.resolve({blocks:[]});b.resolve({blocks:[]});await Promise.all([one,two]);assert.equal(catalogRequests.size,0);
 console.log('Casino catalog reads: concurrent home/fast calls share one request; independent keys, failures/retry and promise cleanup passed');
}finally{delete globalThis.document}
