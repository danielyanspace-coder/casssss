import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Выполняем настоящий модуль с управляемыми ответами сети и минимальным DOM.
let inspect;
const elements = new Map();
const element = () => ({ innerHTML: '', dataset: {}, style: {}, hidden: false, isConnected: false,
  querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
} };
const source = readFileSync(new URL('../public/casino.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/m, 'const PROVIDER_LOGOS = {};')
  .replace('export function createCasino', 'function createCasino')
  .replace('  return {\n    open()', '  deps.inspect({ ui, refs, render, reload, loadMore, ownTileHtml, setKind });\n  return {\n    open()');
const createCasino = new Function(`${source}; return createCasino;`)();
let resolveRequest;
let rejectRequest;
const messages = [];
const state = { config: { feed: { synthetic: true } } };
createCasino({ state, esc: String, money: String, plural: () => 'играют',
  toast: m => messages.push(m), inspect: value => { inspect = value; },
  api: () => new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; }),
});
const { ui, refs, render, reload, loadMore, ownTileHtml, setKind } = inspect;
ui.active = true;
ui.kind = 'fast';
ui.fast = [];
ui.lobby = { tabs: [], providers: [] };
assert.match(ownTileHtml({view:'crash', name:'Краш', cover:'/cover.webp'}), /cz-live/);
state.config.feed.synthetic = false;
assert.doesNotMatch(ownTileHtml({view:'crash', name:'Краш', cover:'/cover.webp'}), /cz-live|cz-prov/);
state.config.feed.synthetic = true;

// Поздний ответ поиска после ухода в лобби не должен менять состояние.
ui.view = { type: 'search' };
const pending = reload();
ui.view = { type: 'home' };
refs.set('old', {});
render();
assert.equal(refs.size, 0);
resolveRequest({games:[{id:'stale'}], total:1});
await pending;
assert.deepEqual(ui.games, []);

// finally старой пагинации не сбрасывает loading нового поиска.
ui.games = [{id:'first'}]; ui.total = 10;
const more = loadMore();
render();
ui.loading = true;
resolveRequest({games:[{id:'stale-page'}], total:10});
await more;
assert.equal(ui.loading, true);
assert.equal(ui.games.length, 1);
ui.loading = false;
const failed = loadMore();
render();
rejectRequest(new Error('old network error'));
await failed;
assert.deepEqual(messages, []);

let searched = false;
ui.searchTimer = setTimeout(() => { searched = true; }, 0);
await setKind('fast');
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(searched, false);

// Отказ нового запроса предлагает повтор, повторная загрузка снимает заглушку.
ui.view = { type: 'search' };
const broken = reload();
rejectRequest(new Error('temporary failure'));
await broken;
assert.match(elements.get('czBody').innerHTML, /data-retry/);
render();
assert.doesNotMatch(elements.get('czBody').innerHTML, /data-retry/);
resolveRequest({games:[], total:0});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(ui.loading, false);
assert.equal(elements.get('czEmpty').hidden, false);
delete globalThis.document;
console.log('Casino navigation: stale replies ignored, loading preserved, refs released, search canceled, counters respect configuration, failed search can retry');
