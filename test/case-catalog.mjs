import assert from 'node:assert/strict';
import{caseSummary}from'../server/case-catalog.js';
import{CASES,publicCase}from'../server/cases.js';
const cases=CASES.map(publicCase);
for(const c of cases){const s=caseSummary(c);assert.deepEqual({...s,items:c.items,detailsLoaded:undefined},{...c,detailsLoaded:undefined});assert.equal(Math.max(...s.items.map(i=>i.value)),Math.max(...c.items.map(i=>i.value)));const top=a=>a.filter(i=>i.kind==='item').reduce((x,y)=>y.value>x.value?y:x,{value:0});assert.deepEqual(top(s.items),top(c.items));assert.ok(s.items.length<=2)}
const base=process.argv[2]||'http://127.0.0.1:3101';
const full=await(await fetch(base+'/api/config')).json();const compactResponse=await fetch(base+'/api/config',{headers:{'X-Case-Catalog':'summary'}});const compact=await compactResponse.json();assert.match(compactResponse.headers.get('vary'),/X-Case-Catalog/i);assert.deepEqual({...compact,cases:full.cases},full);
for(const id of['warmup_100',cases.find(c=>c.free).id,cases.at(-1).id]){const detail=await(await fetch(base+'/api/cases/'+id)).json();assert.deepEqual(detail.case,full.cases.find(c=>c.id===id))}
assert.equal((await fetch(base+'/api/cases/not-a-case')).status,404);
console.log(`Catalog: ${cases.length} metadata entries and maxima unchanged; full details match exactly; invalid ID 404; full API preserved`);
