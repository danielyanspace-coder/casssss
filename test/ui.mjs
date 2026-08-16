/**
 * Сквозной тест интерфейса в браузере.
 *
 * Главная проверка — совпадение ленты с результатом: плитка, оказавшаяся под
 * маркером, обязана быть той же, что показана в результате. Именно здесь
 * ломалось, когда размер плитки в CSS разошёлся с константой в коде.
 *
 * Нужен playwright: npm i -D playwright
 * Запуск: node test/ui.mjs [url] [путь-к-chromium]
 */

import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL_TARGET = process.argv[2] || 'http://localhost:3000';

/**
 * Playwright ищет ровно ту сборку браузера, под которую собран пакет. Если в
 * системе стоит другая ревизия (частый случай в готовых образах), запуск падает
 * с советом «npx playwright install», хотя рабочий chromium рядом уже лежит.
 * Поэтому при несовпадении подбираем любой установленный.
 */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;

  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    const bin = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

const EXECUTABLE = process.argv[3] || process.env.CHROMIUM_PATH || findChromium();

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  return false;
};

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
page.on('console', (m) => {
  const t = m.text();
  // Внешние ресурсы (скрипт Telegram, favicon) в тесте недоступны — не считаем.
  if (m.type() === 'error' && !/ERR_(FILE_NOT_FOUND|CONNECTION_RESET|NAME_NOT_RESOLVED)|404/.test(t)) {
    consoleErrors.push(t);
  }
});
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.case-card', { timeout: 15000 });
await page.waitForTimeout(600);

/* ---------- Полки ---------- */

const shelves = await page.evaluate(() => [...document.querySelectorAll('.shelf')].map((s) => ({
  title: s.querySelector('.shelf-title').textContent,
  count: s.querySelectorAll('.case-card').length,
})));
const totalCards = shelves.reduce((a, s) => a + s.count, 0);
check('полки: все кейсы разложены', totalCards >= 50, `карточек ${totalCards}`);
check('полки: в каждой есть кейсы', shelves.every((s) => s.count > 0));

/* ---------- Меню ---------- */

const nav = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-btn')].filter((b) => !b.hidden).map((b) => b.textContent.trim()));
check('меню: «История» убрана', !nav.some((n) => n.includes('История')), nav.join(', '));

/**
 * Определяет, какая плитка стоит под маркером, и сверяет с результатом.
 */
/** Закрывает экран прокрута, если он открыт: иначе клики по полкам
 *  перехватывает оверлей. */
async function ensureOpenerClosed() {
  const open = await page.evaluate(() => !document.getElementById('opener').hidden);
  if (!open) return;
  await page.click('#closeOpenerTop');
  // waitForSelector по умолчанию ждёт видимости, а скрытый элемент видимым
  // не станет никогда — ждём именно состояние.
  await page.waitForFunction(() => document.getElementById('opener').hidden, { timeout: 5000 });
  await page.waitForTimeout(200);
}

async function openCaseAndVerify(caseId) {
  await ensureOpenerClosed();
  await page.evaluate((id) => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === id);
    card.scrollIntoView({ block: 'center' });
    card.click();
  }, caseId);

  await page.waitForSelector('#doOpenBtn', { state: 'visible' });
  await page.click('#doOpenBtn');

  // Ждём окончания прокрутки: результат появляется после неё.
  await page.waitForSelector('#result:not([hidden])', { timeout: 25000 });
  await page.waitForTimeout(500);

  return page.evaluate(() => {
    // Именно родитель нужной ленты: класс .reel-wrap есть и у рулетки,
    // а querySelector вернул бы её — скрытую, с нулевыми координатами.
    // Первая лента пачки: при мультиоткрытии их несколько.
    const reel = document.querySelector('#reels .reel');
    const box = reel.parentElement.getBoundingClientRect();
    const marker = box.left + box.width / 2;

    let under = null;
    for (const tile of reel.children) {
      const r = tile.getBoundingClientRect();
      if (marker >= r.left && marker <= r.right) {
        under = {
          name: tile.querySelector('.tile-name').textContent.trim(),
          value: tile.querySelector('.tile-value').textContent.trim(),
          margin: Math.min(marker - r.left, r.right - marker),
        };
        break;
      }
    }
    return {
      under,
      resultName: document.getElementById('resultName').textContent.trim(),
      resultValue: document.getElementById('resultValue').textContent.trim(),
    };
  });
}

/* ---------- Совпадение ленты и результата ---------- */

const cases = ['warmup_100', 'vault_1000', 'neon_500', 'allin_500', 'deck_400', 'frost_300'];
let mismatch = 0;
let noTile = 0;
let tooClose = 0;

for (const id of cases) {
  const r = await openCaseAndVerify(id);
  if (!r.under) { noTile++; continue; }
  if (r.under.name !== r.resultName || r.under.value !== r.resultValue) {
    mismatch++;
    failures.push(`лента ≠ результат (${id}): под маркером «${r.under.name} ${r.under.value}», ` +
                  `в результате «${r.resultName} ${r.resultValue}»`);
  }
  // Маркер не должен вставать вплотную к краю плитки.
  if (r.under.margin < 6) tooClose++;

  await ensureOpenerClosed();
}

check(`лента совпадает с результатом на ${cases.length} кейсах`, mismatch === 0);
check('лента: под маркером всегда есть плитка', noTile === 0, `пропусков ${noTile}`);
check('лента: маркер не встаёт на границу плиток', tooClose === 0, `случаев ${tooClose}`);

/* ---------- Рулетка ---------- */

await ensureOpenerClosed();
await page.click('.nav-btn[data-view="roulette"]');
await page.waitForSelector('#rouletteSpinBtn', { state: 'visible' });

let roulMismatch = 0;
for (let i = 0; i < 3; i++) {
  await page.click('#rouletteSpinBtn');
  await page.waitForFunction(() => !document.getElementById('rouletteSpinBtn').disabled,
    { timeout: 25000 });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const wrap = document.querySelector('.roulette-wrap');
    const box = wrap.getBoundingClientRect();
    const marker = box.left + box.width / 2;
    let color = null;
    for (const tile of document.querySelectorAll('#rouletteReel .roulette-tile')) {
      const t = tile.getBoundingClientRect();
      if (marker >= t.left && marker <= t.right) {
        color = [...tile.classList].find((c) => c !== 'roulette-tile');
        break;
      }
    }
    return { color, text: document.getElementById('rouletteResult').textContent.trim() };
  });

  const expected = { red: 'Красное', black: 'Чёрное', green: 'Зелёное' }[r.color];
  if (!r.text.startsWith(expected)) {
    roulMismatch++;
    failures.push(`рулетка: под маркером ${expected}, в результате «${r.text}»`);
  }
}
check('рулетка: сектор под маркером совпадает с результатом', roulMismatch === 0);

/* ---------- Риск-игра ---------- */

await page.click('.nav-btn[data-view="cases"]');
await page.waitForTimeout(400);

let gambleTested = false;
for (let attempt = 0; attempt < 6 && !gambleTested; attempt++) {
  const r = await openCaseAndVerify('vault_1000');
  const hasGamble = await page.evaluate(() => !document.getElementById('gambleStartBtn').hidden);

  if (hasGamble) {
    await page.click('#gambleStartBtn');
    await page.waitForSelector('.gcard', { state: 'visible' });

    const rules = await page.textContent('#gambleRules');
    check('риск: правила показаны над картами', /туза среди/.test(rules), rules.trim());
    // Числовые шансы из интерфейса убраны намеренно — проверяем, что они
    // не вернулись ни здесь, ни в составе кейса.
    check('риск: процент шанса не показан', !/%/.test(rules), rules.trim());

    const cards = await page.evaluate(() => document.querySelectorAll('.gcard').length);
    check('риск: количество карт из конфига', cards === 6, `карт ${cards}`);

    await page.click('.gcard[data-idx="0"]');
    await page.waitForFunction(
      () => document.getElementById('gambleOutcome').textContent.trim().length > 0,
      { timeout: 15000 });
    await page.waitForTimeout(1200);

    const st = await page.evaluate(() => ({
      flipped: document.querySelectorAll('.gcard.flipped').length,
      aces: document.querySelectorAll('.gcard-front.ace').length,
      outcome: document.getElementById('gambleOutcome').textContent.trim(),
      btn: document.getElementById('gambleSkipBtn').textContent.trim(),
    }));

    check('риск: вскрываются все карты', st.flipped === 6, `перевёрнуто ${st.flipped}`);
    check('риск: туз ровно один', st.aces === 1, `тузов ${st.aces}`);
    check('риск: исход показан', st.outcome.length > 0);
    check('риск: кнопка меняется на «Продолжить»', st.btn === 'Продолжить', st.btn);

    await page.click('#gambleSkipBtn');
    await page.waitForTimeout(300);
    gambleTested = true;
  }
  await ensureOpenerClosed();
}
check('риск: сценарий проигран', gambleTested);

/* ---------- Сезонный кейс ---------- */

await ensureOpenerClosed();
await page.click('.nav-btn[data-view="cases"]');
await page.waitForSelector('.case-card', { timeout: 10000 });

const seasonal = await page.evaluate(async () => {
  const cfg = await fetch('/api/config').then((r) => r.json());
  const c = cfg.cases.find((x) => x.availableFrom);
  if (!c) return null;
  const card = document.querySelector(`.featured-card[data-case="${c.id}"]`);
  const shelves = document.querySelectorAll(`.shelf-row [data-case="${c.id}"]`).length;
  const featured = document.querySelectorAll('.featured-card');
  return {
    id: c.id,
    future: c.availableFrom > Date.now(),
    onFeatured: card !== null,
    // Витрина должна стоять первой в списке и не дублироваться в полках.
    first: document.getElementById('caseShelves')?.firstElementChild?.classList
      .contains('featured') ?? false,
    onlyOne: featured.length === 1,
    inShelves: shelves,
    locked: card?.classList.contains('is-locked') ?? false,
    badge: card?.querySelector('.featured-date')?.textContent.trim() || '',
    // Готовый баннер несёт свой заголовок и плашку «сезонный кейс», поэтому
    // карточка обязана свои такие же подписи убрать.
    ownArt: Boolean(c.art),
    photo: card?.querySelector('img.cover-photo')?.naturalWidth || 0,
    ownTag: card?.querySelector('.featured-tag') !== null && card !== null,
    ownTop: card?.querySelector('.featured-top') !== null && card !== null,
  };
});

if (check('сезонный кейс есть в конфиге', seasonal !== null)) {
  check('сезонный: вынесен на витрину', seasonal.onFeatured);
  check('сезонный: витрина стоит первой под шапкой', seasonal.first);
  check('сезонный: витрина одна', seasonal.onlyOne);
  check('сезонный: не продублирован в полках', seasonal.inShelves === 0,
        `найдено ${seasonal.inShelves}`);
  check('сезонный: карточка помечена как закрытая', seasonal.locked === seasonal.future);
  check('сезонный: на обложке дата старта', !seasonal.future || seasonal.badge.length > 0);

  if (seasonal.ownArt) {
    check('сезонный: баннер загрузился', seasonal.photo > 0, `ширина ${seasonal.photo}`);
    check('сезонный: карточка не дублирует заголовок баннера', !seasonal.ownTag);
    check('сезонный: карточка не кладёт потолок поверх баннера', !seasonal.ownTop);
  }

  await page.evaluate((id) => {
    document.querySelector(`.featured-card[data-case="${id}"]`).click();
  }, seasonal.id);
  await page.waitForSelector('#doOpenBtn', { state: 'visible' });

  const sheet = await page.evaluate(() => ({
    disabled: document.getElementById('doOpenBtn').disabled,
    showcase: document.querySelectorAll('.showcase-row').length,
    // Витринный предмет не должен встречаться в таблице розыгрыша.
    inTable: [...document.querySelectorAll('.item-row:not(.showcase-row) .item-name')]
      .map((n) => n.textContent.trim()),
    showcaseName: document.querySelector('.showcase-row .item-name')?.textContent.trim() || '',
    // Числовые шансы и RTP из карточки кейса убраны.
    chances: document.querySelectorAll('.item-row:not(.showcase-row) .item-chance').length,
    badges: [...document.querySelectorAll('.sheet-badges .badge')].map((b) => b.textContent),
  }));

  check('сезонный: кнопка открытия заблокирована до старта',
        sheet.disabled === seasonal.future);
  check('карточка кейса: шансы предметов не показаны', sheet.chances === 0,
        `найдено ${sheet.chances}`);
  check('карточка кейса: RTP не показан',
        !sheet.badges.some((b) => /RTP/i.test(b)), sheet.badges.join(' | '));
  check('сезонный: витринная строка показана', sheet.showcase === 1);
  check('сезонный: витрина вне таблицы розыгрыша',
        !sheet.inTable.includes(sheet.showcaseName), sheet.showcaseName);

  await ensureOpenerClosed();
  await page.evaluate(() => document.getElementById('sheetBackdrop')?.click());
  await page.waitForTimeout(200);
}

/* ---------- Экраны ---------- */

await ensureOpenerClosed();
await page.click('.nav-btn[data-view="crash"]');
await page.waitForTimeout(400);
check('краш: экран открывается',
      await page.isVisible('#crashActionBtn'));

/* ---------- Касса и честность ---------- */

const menu = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-btn')].filter((b) => !b.hidden)
    .map((b) => b.textContent.trim()));
check('меню: «Честность» убрана', !menu.some((m) => /Честность/.test(m)), menu.join(', '));
check('меню: появилась «Касса»', menu.some((m) => /Касса/.test(m)), menu.join(', '));

await page.click('.nav-btn[data-view="wallet"]');
await page.waitForTimeout(500);
check('касса: экран открывается по кнопке меню',
      await page.isVisible('#walletBalance'));

// Экран честности остался, но попасть на него теперь можно только из подвала.
await page.evaluate(() => {
  const link = document.querySelector('#siteFooter [data-view="fair"]');
  link.scrollIntoView({ block: 'center' });
  link.click();
});
await page.waitForTimeout(500);
const fair = await page.evaluate(() => ({
  hash: document.getElementById('serverHash').textContent.trim().length,
  stats: document.querySelectorAll('#statsGrid .stat-card').length,
  visible: document.getElementById('view-fair').classList.contains('active'),
}));
check('честность: открывается ссылкой из подвала', fair.visible);
check('честность: хеш серверного seed показан', fair.hash === 64, `длина ${fair.hash}`);
check('честность: статистика на месте', fair.stats > 0, `карточек ${fair.stats}`);

/* ---------- Итог ---------- */

check('нет ошибок в консоли', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

console.log(`Пройдено проверок: ${passed}`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.forEach((f) => console.error('  • ' + f));
  process.exit(1);
}
console.log('Все проверки интерфейса пройдены.\n');
