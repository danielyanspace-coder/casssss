import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {itemArt64} from '../public/item-art64.js';

// Locale formatting must remain compatible with the original display rules.
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const formatters=new Function(source.slice(source.indexOf('const numberFormat = '),source.indexOf('const CATEGORY_COLORS'))+';return {fmtMoney};')();
for(const n of [null,undefined,NaN,Infinity,-Infinity,-0,0,.004,.005,.01,.1,1.005,-1.005,9999999.99,...Array.from({length:1000},(_,i)=>(i-500)*123.4567)]){
 const v=Math.round(Number(n)*100)/100;
 const expected=Number.isInteger(v)?v.toLocaleString('ru-RU'):v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
 assert.equal(formatters.fmtMoney(n),expected);
}

// Cached SVG templates still need independent, locally resolving gradient IDs.
const seen=new Set();
for(let i=0;i<20;i++){
 const svg=itemArt64('Золотая корона');assert.ok(svg);
 const ids=[...svg.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 for(const id of ids){assert.ok(!seen.has(id));seen.add(id)}
 for(const [,id] of svg.matchAll(/url\(#([^)]*)\)/g))assert.ok(ids.includes(id));
}

const stats={buffers:0,active:new Set(),sources:[],sounds:[]};
class Audio {
 constructor(){this.sampleRate=48000;this.currentTime=0;this.state='running';this.destination={}}
 createGain(){return {gain:{value:0},connect(){return this},disconnect(){}}}
 createBiquadFilter(){return {frequency:{value:0},Q:{value:0},connect(){return this},disconnect(){}}}
 createBuffer(channels,length,sampleRate){stats.buffers++;const data=new Float32Array(length);return {length,sampleRate,getChannelData:()=>data}}
 createBufferSource(){const src={connect(){return this},disconnect(){},start(){assert.ok(!stats.active.has(this.buffer),'A playing buffer cannot be reused');stats.active.add(this.buffer);stats.sounds.push(Buffer.from(this.buffer.getChannelData(0).buffer).toString('base64'))}};stats.sources.push(src);return src}
}
const originalRandom=Math.random;
globalThis.window={AudioContext:Audio};
try{
 let seed=1;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const audioSource=readFileSync(new URL('../public/sounds.js',import.meta.url),'utf8');
 const mod=await import('data:text/javascript;base64,'+Buffer.from(audioSource+'\nexport {noise as __noise};export const __pool=()=>({frames:pooledNoiseFrames,sizes:[...noiseBufferPool.values()].map(p=>p.length)});').toString('base64'));
 const ended=src=>{stats.active.delete(src.buffer);src.onended()};
 for(let i=0;i<100;i++){mod.sndTick(1+i/100);ended(stats.sources.at(-1))}
 assert.equal(stats.buffers,1,'Sequential ticks should reuse one buffer');
 for(let i=0;i<12;i++)mod.sndTick();assert.equal(stats.active.size,12);
 for(const src of stats.sources.slice(-12))ended(src);
 for(let i=0;i<20;i++){mod.sndTick();ended(stats.sources.at(-1))}
 for(let i=1;i<=40;i++){mod.__noise(i/100);ended(stats.sources.at(-1))}
 const pool=mod.__pool();assert.ok(pool.frames<=262144);assert.ok(pool.sizes.every(n=>n<=4));
 // Captured from the original, non-pooled generator with the same seeded inputs.
 assert.equal(createHash('sha256').update(stats.sounds.join('')).digest('hex'),'9d57f05f1564c930b94ae5c17f1658810c5dc8e005eaededf712d07ffac379f5');
 const count=stats.sources.length;mod.toggleSound(false);mod.sndTick();assert.equal(stats.sources.length,count);
}finally{Math.random=originalRandom;delete globalThis.window}
console.log('Client technical checks: locale output, independent SVG IDs, unchanged PCM, safe concurrent buffers, bounded pool and mute passed');
