import assert from 'node:assert/strict';
import { HD_THEMES, itemArtHd } from '../public/item-art-hd.js';

let draws = 0;
HD_THEMES.cacheaudit = Array.from({ length: 140 }, (_, i) => (k) => {
  draws++;
  return k.clip('M0 0h100v100H0z', k.txt(50, 50, String(i), 12));
});
const first = itemArtHd('cacheaudit/0');
const second = itemArtHd('cacheaudit/0');
assert.equal(draws, 1, 'Repeated artwork should reuse its template');
const normalize = (s) => s.replace(/hd_cached_\d+_/g, 'INSTANCE_');
assert.equal(normalize(first), normalize(second), 'Caching must preserve every SVG element and attribute');
const ids = new Set();
for (const svg of [first, second]) {
  const ownIds = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ownIds) { assert.ok(!ids.has(id), 'Instances must not share gradient/clip ids'); ids.add(id); }
  for (const [, ref] of svg.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ownIds.includes(ref), 'Every SVG reference must resolve within its instance');
}
for (let i = 1; i < 140; i++) itemArtHd(`cacheaudit/${i}`);
const beforeEvicted = draws;
assert.equal(normalize(itemArtHd('cacheaudit/0')), normalize(first));
assert.equal(draws, beforeEvicted + 1, 'Old templates must be evicted instead of growing memory indefinitely');
assert.equal(itemArtHd('missing/0'), null);
console.log('Artwork cache: stable SVG, unique references and bounded eviction passed');
