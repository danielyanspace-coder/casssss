/** Запуск без браузера: рисунки неизменны, отказы и отмена загрузки безопасны. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { itemArtHd, itemArtReady, preloadItemArt } from '../public/item-art-lazy.js';
import { HD_THEMES } from '../public/item-art-hd.js';
import { HD_SPECIAL_SAMPLES } from '../public/hd/special.js';
import { CASES } from '../server/cases.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
assert.equal(itemArtReady([{ art: 'samurai/0' }]), false);
await Promise.all([
  preloadItemArt([{ art: 'samurai/0' }]),
  preloadItemArt([{ art: 'samurai/1' }, { art: 'perk/fs/10' }]),
]);
assert.equal(itemArtReady([{ art: 'samurai/0' }]), true);
assert.equal(itemArtReady([{ art: 'arctic/0' }]), false);
assert.equal(itemArtHd('unknown/0'), null);
assert.equal(itemArtHd(null), null);
await preloadItemArt(CASES.flatMap((c) => [...c.items, c.showcase].filter(Boolean)));
const keys = [
  ...Object.entries(HD_THEMES).flatMap(([theme, draws]) => draws.map((_, i) => `${theme}/${i}`)),
  ...HD_SPECIAL_SAMPLES,
];
// Рисунки с частицами используют счётчик внутри темы. Изолированные графы
// модулей дают двум загрузчикам одинаковую последовательность отрисовок.
async function renderHashes(file) {
  const isolated = vm.createContext({});
  const graph = new Map();
  const get = (url) => {
    if (!graph.has(url)) {
      const module = new vm.SourceTextModule(readFileSync(new URL(url), 'utf8'), {
        identifier: url,
        context: isolated,
        importModuleDynamically: async (specifier, parent) => {
          const child = get(new URL(specifier, parent.identifier).href);
          if (child.status === 'unlinked') await child.link(link);
          if (child.status === 'linked') await child.evaluate();
          return child;
        },
      });
      graph.set(url, module);
    }
    return graph.get(url);
  };
  const link = (specifier, parent) => get(new URL(specifier, parent.identifier).href);
  const module = get(new URL(`../public/${file}`, import.meta.url).href);
  await module.link(link);
  await module.evaluate();
  const art = module.namespace;
  if (art.preloadItemArt) await art.preloadItemArt(keys.map((art) => ({ art })));
  return keys.map((key) => {
    const svg = art.itemArtHd(key);
    assert.ok(svg, key);
    const normalized = svg.replace(/id="[^"]*"|url\(#[^)]*\)/g, '');
    return createHash('sha256').update(normalized).digest('hex');
  });
}
assert.deepEqual(await renderHashes('item-art-lazy.js'), await renderHashes('item-art-hd.js'));
console.log(`Рисунки: ${keys.length} SVG совпадают с исходными (кроме уникальных id градиентов)`);

const lazySource = read('../public/item-art-lazy.js');
const warmTimers = [];
const warmState = { hidden: true, caseOpen: false, loading: false, saveData: false };
const context = vm.createContext({
  navigator: { connection: { get saveData() { return warmState.saveData; } } },
  document: {
    get hidden() { return warmState.hidden; },
    body: { classList: { contains: () => warmState.caseOpen } },
    getElementById: () => ({ hidden: !warmState.loading }),
  },
  setTimeout: (callback, ms) => warmTimers.push({ callback, ms }),
});
const modules = new Map();
async function stubModule(name, exports) {
  const module = new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: name });
  await module.link(() => {});
  await module.evaluate();
  return module;
}
modules.set('./hd/kit.js', await stubModule('kit', { hdKit: () => ({ svg: (s) => s }) }));
modules.set('./hd/special.js', await stubModule('special', { hdSpecial: () => null }));
const imported = [];
let cachedDraws = 0;
const lazy = new vm.SourceTextModule(lazySource, {
  context,
  importModuleDynamically: async (name) => {
    imported.push(name);
    if (imported.length === 1) throw new Error('network lost');
    const theme = name.match(/\/([a-z]+)\.js/)[1];
    return stubModule(name, { [`HD_${theme.toUpperCase()}`]: Array.from({ length: 140 }, () => () => { cachedDraws++; return 'original svg'; }) });
  },
});
await lazy.link((name) => modules.get(name));
await lazy.evaluate();
const api = lazy.namespace;
assert.equal(imported.length, 0, 'Импорт загрузчика не загружает темы');
await assert.rejects(api.preloadItemArt([{ art: 'samurai/0' }]), /network lost/);
assert.equal(api.itemArtReady([{ art: 'samurai/0' }]), false);
await Promise.all([
  api.preloadItemArt([{ art: 'samurai/0' }]),
  api.preloadItemArt([{ art: 'samurai/1' }]),
]);
assert.deepEqual(imported, ['./hd/samurai.js', './hd/samurai.js?retry=1']);
assert.equal(api.itemArtHd('samurai/0'), 'original svg');
assert.equal(api.itemArtHd('samurai/0'), 'original svg');
assert.equal(cachedDraws, 1, 'Repeated reel artwork uses the existing template');
for (let i = 1; i < 140; i++) api.itemArtHd(`samurai/${i}`);
api.itemArtHd('samurai/0');
assert.equal(cachedDraws, 141, 'Template memory is bounded and old templates are evicted');
console.log('Загрузчик: темы не входят в старт, запросы объединяются, отказ допускает повтор с новым URL');

await api.preloadItemArt([{ art: '__proto__/0' }, { art: '../private' }]);
assert.equal(imported.length, 2, 'Неизвестные ключи не становятся путями импорта');
warmState.saveData = true;
api.warmItemArt([{ items: [{ art: 'arctic/0' }] }]);
assert.equal(warmTimers.length, 0, 'Экономия трафика отключает фоновую загрузку');
warmState.saveData = false;
api.warmItemArt([{ items: [{ art: 'arctic/0' }] }]);
assert.equal(warmTimers[0].ms, 2500);
await warmTimers.shift().callback();
assert.equal(imported.length, 2, 'Скрытая вкладка не загружает темы');
warmState.hidden = false; warmState.caseOpen = true;
await warmTimers.shift().callback();
assert.equal(imported.length, 2, 'Открытый кейс останавливает фон');
warmState.caseOpen = false; warmState.loading = true;
await warmTimers.shift().callback();
assert.equal(imported.length, 2, 'Сеть уступается выбранному кейсу');
warmState.loading = false;
await warmTimers.shift().callback();
assert.equal(imported[2], './hd/arctic.js');
assert.equal(warmTimers[0].ms, 350, 'Между темами есть пауза');
console.log('Фон: задержка после старта, одна тема за раз, пауза для кейса, скрытой вкладки и экономии трафика');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const bootSource = read('../public/boot.js');
async function bootFixture(config, me) {
  const calls = [];
  const boot = new vm.SourceTextModule(bootSource, {
    context: vm.createContext({ fetch: (url, options) => {
      calls.push({ url, options });
      return (url === '/api/config' ? config : me).promise;
    } }),
  });
  await boot.link(() => {});
  await boot.evaluate();
  assert.equal(calls.length, 2, 'Оба запроса начались до обращения основного приложения');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, '{}');
  return { boot, calls };
}
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
{
  const c = deferred(), m = deferred();
  const { boot, calls } = await bootFixture(c, m);
  c.resolve(response({ cases: [] }));
  m.resolve(response({ user: { id: 123, balance: 456 } }));
  const data = await boot.namespace.loadStartupData();
  assert.equal(data[1].balance, 456);
  await boot.namespace.loadStartupData();
  assert.equal(calls.length, 2, 'Нет повторных стартовых запросов');
}
{
  const c = deferred(), m = deferred();
  const { boot } = await bootFixture(c, m);
  c.resolve(response({ cases: [] }));
  m.resolve(response({ code: 'AUTH' }, 401));
  assert.equal((await boot.namespace.loadStartupData())[1], null);
}
{
  const c = deferred(), m = deferred();
  const { boot } = await bootFixture(c, m);
  c.resolve(response({ cases: [] }));
  m.resolve(response({ message: 'maintenance' }, 503));
  await assert.rejects(boot.namespace.loadStartupData(), (e) => e.status === 503 && e.message === 'maintenance');
}
{
  const c = deferred(), m = deferred();
  const { boot } = await bootFixture(c, m);
  c.reject(new Error('network lost'));
  m.resolve(response({ code: 'AUTH' }, 401));
  // Отказ произошёл ещё до загрузки основного кода и уже обработан.
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(boot.namespace.loadStartupData(), /network lost/);
}
console.log('Старт: параллельные запросы, гость, ошибки сервера и сети, без повторов и кеширования баланса');

// Исполняем настоящий контроллер из app.js с управляемыми сетью и кадрами.
const appSource = read('../public/app.js');
const controller = appSource.slice(appSource.indexOf('let caseLoadRequest = 0;'), appSource.indexOf('function renderOpenCase(caseId)'));
function caseFixture() {
  const loader = { hidden: true }, opener = { hidden: true }, name = {};
  const frames = [], renders = [], notices = [], downloads = [];
  let ready = false;
  const caseData = { id: 'test', name: 'Тест', items: [{ art: 'samurai/0' }], showcase: { art: 'jackpot/test' } };
  const ctx = vm.createContext({
    state: { config: { cases: [caseData] } },
    window: { scrollY: 720 },
    document: { querySelectorAll: () => [], getElementById: (id) => ({ caseLoader: loader, opener, caseLoaderName: name })[id] },
    requestAnimationFrame: (cb) => frames.push(cb),
    preloadItemArt: (items) => {
      const job = deferred(); downloads.push({ ...job, items }); return job.promise;
    },
    itemArtReady: () => ready,
    renderOpenCase: (id) => renders.push(id),
    toast: (s) => notices.push(s),
  });
  vm.runInContext(controller, ctx);
  return { ctx, loader, opener, frames, renders, notices, downloads, setReady: () => { ready = true; } };
}
{
  const f = caseFixture();
  await f.ctx.openCase('missing');
  assert.equal(f.loader.hidden, true);
  const opening = f.ctx.openCase('test');
  assert.equal(f.loader.hidden, false);
  assert.equal(f.downloads.length, 1, 'Сеть стартует до первого кадра');
  assert.equal(f.downloads[0].items.length, 2, 'Загружается и витринный предмет');
  await f.ctx.openCase('test');
  assert.equal(f.downloads.length, 1, 'Двойной клик не дублирует открытие');
  f.frames.shift()(); f.frames.shift()();
  await Promise.resolve();
  assert.equal(f.renders.length, 0, 'Кейс не строится с незагруженными рисунками');
  f.downloads[0].resolve();
  await opening;
  assert.deepEqual(f.renders, ['test']);
  assert.equal(f.loader.hidden, true);
}
{
  const f = caseFixture();
  const first = f.ctx.openCase('test');
  f.frames.shift()(); f.frames.shift()();
  f.ctx.cancelCaseLoad();
  const second = f.ctx.openCase('test');
  f.downloads[0].resolve(); await first;
  assert.equal(f.renders.length, 0, 'Отменённое открытие не возвращает пользователя в кейс');
  assert.equal(f.loader.hidden, false, 'Старое открытие не прячет новую загрузку');
  f.frames.shift()(); f.frames.shift()(); f.downloads[1].resolve();
  await second;
  assert.deepEqual(f.renders, ['test']);
}
{
  const f = caseFixture();
  const opening = f.ctx.openCase('test');
  f.downloads[0].reject(new Error('network lost'));
  await opening;
  assert.equal(f.loader.hidden, true);
  assert.equal(f.renders.length, 0);
  assert.equal(f.notices.length, 1);
  const retry = f.ctx.openCase('test');
  while (f.frames.length) f.frames.shift()();
  f.downloads[1].resolve(); await retry;
  assert.deepEqual(f.renders, ['test']);
}
{
  const f = caseFixture();
  f.opener.hidden = false; f.setReady();
  await f.ctx.openCase('test');
  assert.deepEqual(f.renders, ['test']);
  assert.equal(f.downloads.length, 0, 'Готовый кейс перестраивается без загрузки');
}
console.log('Открытие кейса: полные рисунки до отрисовки, два кадра загрузчика, отмена, повтор после ошибки');

// Склейка клиентского скрипта демо проверяется без запуска Chromium и сжатия картинок.
// Берём именно шаблон и strip из сборщика, чтобы новые импорты не ломали файл.
const builder = read('../build-standalone.mjs');
const stripDefinition = builder.slice(builder.indexOf('const strip ='), builder.indexOf('/* ---------- Заглушка сервера'));
const strip = vm.runInNewContext(`${stripDefinition}\nstrip;`);
const sources = {
  adminUi: 'admin-ui.js', icons: 'icons.js', covers: 'covers.js', sounds: 'sounds.js', motionFx: 'motion.js',
  itemArt: 'item-art.js', itemArt64: 'item-art64.js', itemArtHd: 'item-art-hd.js',
  coinArt: 'coin-art.js', legal: 'legal.js', slots: 'slots.js',
  providerLogos: 'provider-logos.js', casinoUi: 'casino.js', startupClient: 'boot.js', app: 'app.js',
};
const templateContext = { strip };
const removeAppScript = builder.match(/\.replace\((\/<script\[\^>\]\*src=.*?), ''\);/);
assert.ok(removeAppScript);
const removal = vm.runInNewContext(removeAppScript[1]);
assert.equal(read('../public/app-shell.html').replace(removal, '').includes('src="/app.js'), false);
for (const [name, file] of Object.entries(sources)) templateContext[name] = read(`../public/${file}`);
const { readdirSync } = await import('node:fs');
templateContext.hdArt = ['kit.js', ...readdirSync(new URL('../public/hd', import.meta.url))
  .filter((f) => f.endsWith('.js') && f !== 'kit.js').sort()].map((f) => read(`../public/hd/${f}`));
const templateStart = builder.indexOf("<script>\n(function () {\n'use strict';\n\n${strip(icons)}");
assert.ok(templateStart > 0);
const fragment = builder.slice(templateStart + '<script>'.length, builder.indexOf('</script>', templateStart));
const demoScript = vm.runInNewContext('`' + fragment + '`', templateContext);
new vm.Script(demoScript, { filename: 'standalone-client.js' });
assert.equal(demoScript.includes("import('./hd/"), false, 'Демо не требует сетевой загрузки тем');
console.log('Автономная сборка: настоящий шаблон клиентского скрипта разбирается, темы остаются встроенными');
