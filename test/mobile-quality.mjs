import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createMotion } from '../public/motion.js';

// Run the actual navigation functions with a scrolled page, then replace the
// shelf nodes as Casino.open() does. Returning must restore both axes.
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const positions = app.slice(app.indexOf('function capturePagePosition()'), app.indexOf('function cancelCaseLoad()'));
let rows = [{ scrollLeft: 150 }, { scrollLeft: 390 }];
const page = { scrollY: 1240, scrollTo({ top }) { this.scrollY = top; } };
const ctx = vm.createContext({ state: { view: 'cases' }, window: page,
  document: { querySelectorAll: () => rows } });
vm.runInContext(positions, ctx);
const position = ctx.capturePagePosition();
rows = [{ scrollLeft: 0 }, { scrollLeft: 0 }]; page.scrollY = 0;
ctx.restorePagePosition(position);
assert.equal(page.scrollY, 1240);
assert.deepEqual(rows.map(r => r.scrollLeft), [150, 390]);
ctx.state.view = 'wallet'; page.scrollY = 0;
ctx.restorePagePosition(position);
assert.equal(page.scrollY, 0, 'A stale return must not scroll a different section');

// A closed case must not resume a purchased series after a delayed network
// response or start its next reel after a delayed introduction.
let finishIntro;
const fsContext = vm.createContext({
  document: { getElementById: () => ({}) },
  fsEmblem: () => '',
  motion: () => ({ purchase: () => new Promise(r => { finishIntro = r; }) }),
});
const fsFunction = app.slice(app.indexOf('async function runFreeSpins('), app.indexOf("/*\n * Серия, ждущая «Забрать»."));
vm.runInContext('let freeSpinPresentation = 0;\n' + fsFunction, fsContext);
const showing = fsContext.runFreeSpins({ count: 10, spins: [{ value: 0 }], total: 0 }, {});
vm.runInContext('freeSpinPresentation++', fsContext);
finishIntro();
await showing;
let respond;
let applied;
const buyContext = vm.createContext({ state: { busy: false, config: { cases: [{ id: 'test' }] } },
  api: () => new Promise(r => { respond = r; }), applyUser: u => { applied = u; } });
const buyFunction = app.slice(app.indexOf('async function buyFreeSpins('), app.indexOf('/**\n * Цена под надписью'));
vm.runInContext('let freeSpinPresentation = 0;\n' + buyFunction, buyContext);
const buying = buyContext.buyFreeSpins('test', 10);
vm.runInContext('freeSpinPresentation++', buyContext);
respond({ user: { balance: 123 } }); await buying;
assert.equal(applied.balance, 123, 'The actual server balance must still be applied');
assert.equal(buyContext.state.busy, false, 'Leaving during purchase must not lock subsequent actions');

// Exercise fifty consecutive mobile purchases. No SVG tokens, canvas particles,
// animation handles or detached presentation nodes should accumulate.
let animations = new Set(), rafs = new Set(), clears = 0;
const listeners = new Map();
class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.style = {}; this.classList = { remove() {} }; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  appendChild(n) { this.append(n); }
  setAttribute() {}
  set innerHTML(value) { this.children.forEach(n => n.parent = null); this.children = []; if (value) {
    for (const tag of ['div', 'canvas', 'div']) this.append(new Node(tag));
  } }
  querySelector(selector) { return this.children[selector === '.mo-layer' ? 0 : selector === '.mo-top' ? 2 : 1]; }
  getContext() { return { setTransform() {}, clearRect() { clears++; } }; }
  getAnimations() { return [...animations]; }
  animate() {
    let resolve, reject;
    const a = { finished: new Promise((r,j) => { resolve = r; reject = j; }), cancel() { animations.delete(a); reject(new Error('cancelled')); } };
    animations.add(a); queueMicrotask(resolve); return a;
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
const body = new Node('body'); body.classList.toggle = () => {};
globalThis.document = { body, hidden: false, createElement: t => new Node(t),
  querySelectorAll: () => [], addEventListener: (n,f) => listeners.set(n,f) };
globalThis.matchMedia = () => ({ matches: true });
globalThis.innerWidth = 390; globalThis.innerHeight = 844; globalThis.devicePixelRatio = 3;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = f => { rafs.add(f); return f; };
globalThis.cancelAnimationFrame = f => rafs.delete(f);
const motion = createMotion({ money: String, artFor: () => '', tierColor: () => '#fff', snd: {} });
let tokens = 0, preparations = 0;
for (let i = 0; i < 50; i++) {
  await motion.purchase({ count: 30, prepare() { preparations++; return { pips: Array(30).fill({}), onToken() { tokens++; } }; } });
  await motion.seriesTotal({}, { total: 400, text: '400 ₽' });
  const root = body.children[0];
  assert.equal(root.children[0].children.length, 0);
  assert.equal(root.children[2].children.length, 0);
  assert.equal(animations.size, 0);
  assert.equal(rafs.size, 0);
  assert.equal(root.children[1].width, 390, 'Mobile canvas must not allocate DPR 3 backing pixels');
}
assert.equal(tokens, 1500); assert.equal(preparations, 50);
const pending = motion.purchase({ count: 10, prepare: () => ({ pips: [] }) });
motion.reset(); await pending;
assert.equal(animations.size, 0);
listeners.get('visibilitychange')();
assert.ok(clears > 0);
console.log('Mobile: 50 purchases and totals release all presentation nodes and animations; scroll restoration survives rerenders.');
