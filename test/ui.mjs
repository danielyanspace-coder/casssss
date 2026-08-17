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

/** Переход в раздел через меню-сетку: нижней панели больше нет. */
async function goto(view) {
  await page.click('#menuBtn');
  await page.waitForSelector(`.menu-tile[data-view="${view}"]`, { state: 'visible' });
  await page.click(`.menu-tile[data-view="${view}"]`);
  await page.waitForTimeout(400);
}

await page.click('#menuBtn');
await page.waitForSelector('.menu-tile', { state: 'visible' });
const nav = await page.evaluate(() =>
  [...document.querySelectorAll('.menu-tile')].map((b) => b.querySelector('.menu-tile-title').textContent.trim()));
await page.click('#menuClose');
await page.waitForTimeout(300);

check('меню: нижняя панель убрана',
      await page.evaluate(() => document.querySelectorAll('.bottom-nav, .nav-btn').length === 0));
check('меню: «История» убрана', !nav.some((n) => n.includes('История')), nav.join(', '));
check('меню: разделы на месте',
      ['Кейсы', 'Апгрейд', 'Краш', 'Рулетка', 'Касса', 'Честность'].every((t) => nav.includes(t)),
      nav.join(', '));

/* ---------- Витрина крупных выпадений ---------- */

{
  await page.waitForTimeout(1200);
  const feed = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#feedTrack .feed-card')];
    return {
      visible: !document.getElementById('feed').hidden,
      count: cards.length,
      drawn: cards.filter((c) => c.querySelector('.feed-art svg')).length,
      withValue: cards.filter((c) => /\d/.test(c.querySelector('.feed-value')?.textContent || '')).length,
      withNick: cards.filter((c) => (c.querySelector('.feed-nick')?.textContent || '').trim()).length,
      // Витрина не должна выдавать шансы — как и остальной интерфейс.
      percents: cards.filter((c) => c.textContent.includes('%')).length,
    };
  });

  check('витрина: лента показана', feed.visible);
  check('витрина: карточки заполнены', feed.count > 0, `карточек ${feed.count}`);
  check('витрина: у каждой карточки есть рисунок', feed.drawn === feed.count,
        `${feed.drawn} из ${feed.count}`);
  check('витрина: у каждой карточки есть сумма', feed.withValue === feed.count,
        `${feed.withValue} из ${feed.count}`);
  check('витрина: у каждой карточки есть ник', feed.withNick === feed.count,
        `${feed.withNick} из ${feed.count}`);
  check('витрина: проценты не показаны', feed.percents === 0, `нарушений ${feed.percents}`);
}

/* ---------- Апгрейд ---------- */

await goto('upgrade');
await page.waitForSelector('#upgradeBtn', { state: 'visible' });

{
  const stage = await page.evaluate(() => {
    const el = document.getElementById('upgStake');
    el.value = '1000';
    el.dispatchEvent(new Event('input'));
    return {
      options: document.querySelectorAll('.upg-opt').length,
      active: document.querySelectorAll('.upg-opt.active').length,
      ticks: document.querySelectorAll('#upgTicks line').length,
      percents: document.getElementById('view-upgrade').textContent.includes('%'),
    };
  });

  check('апгрейд: множители на выбор', stage.options >= 4, `вариантов ${stage.options}`);
  check('апгрейд: выбран ровно один множитель', stage.active === 1, `активных ${stage.active}`);
  check('апгрейд: кольцо размечено насечками', stage.ticks > 0, `насечек ${stage.ticks}`);
  check('апгрейд: процент шанса не показан', !stage.percents);

  // Сектор обязан меняться вместе с множителем: на x100 он заметно уже,
  // чем на x1.5, иначе картинка врёт о том, за что играет игрок.
  const arcFor = async (mult) => page.evaluate((m) => {
    document.querySelector(`.upg-opt[data-mult="${m}"]`).click();
    const el = document.getElementById('upgStake');
    el.value = '1000';
    el.dispatchEvent(new Event('input'));
    const [len] = document.getElementById('upgArc').style.strokeDasharray.split(' ');
    return { arc: parseFloat(len), target: document.getElementById('upgTarget').textContent };
  }, mult);

  const low = await arcFor('1.5');
  const high = await arcFor('100');
  check('апгрейд: у крупного множителя сектор уже', high.arc < low.arc,
        `x1.5 → ${low.arc}, x100 → ${high.arc}`);
  check('апгрейд: цель растёт вместе с множителем',
        parseInt(high.target.replace(/\D/g, ''), 10) > parseInt(low.target.replace(/\D/g, ''), 10),
        `${low.target} → ${high.target}`);

  // Прокрут: указатель обязан встать на угол ролла, а исход — совпасть
  // с тем, попал ли этот угол в нарисованный сектор.
  await page.evaluate(() => {
    document.querySelector('.upg-opt[data-mult="1.5"]').click();
    const el = document.getElementById('upgStake');
    el.value = '1000';
    el.dispatchEvent(new Event('input'));
  });
  await page.click('#upgradeBtn');
  await page.waitForFunction(() => !document.getElementById('upgradeBtn').disabled,
    { timeout: 25000 });
  await page.waitForTimeout(300);

  const spun = await page.evaluate(() => {
    const style = document.getElementById('upgNeedle').style.transform;
    const deg = parseFloat(/rotate\(([-\d.]+)deg\)/.exec(style)?.[1] ?? 'NaN');
    const [len, circ] = document.getElementById('upgArc').style.strokeDasharray
      .split(' ').map(parseFloat);
    return {
      angle: ((deg % 360) + 360) % 360,
      sector: (len / circ) * 360,
      outcome: document.getElementById('upgOutcome').textContent.trim(),
      won: document.getElementById('upgOutcome').classList.contains('win'),
    };
  });

  check('апгрейд: указатель довёрнут до результата', Number.isFinite(spun.angle));
  check('апгрейд: исход показан', spun.outcome.length > 0, spun.outcome);
  check('апгрейд: указатель внутри сектора ⇔ выигрыш',
        spun.won === (spun.angle < spun.sector),
        `угол ${spun.angle.toFixed(1)}°, сектор ${spun.sector.toFixed(1)}°, выигрыш ${spun.won}`);
}

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
await goto('roulette');
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

await goto('cases');
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
await goto('cases');
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
    showcase: document.querySelectorAll('.drop-card.is-showcase').length,
    // Витринный предмет не должен встречаться в таблице розыгрыша.
    inTable: [...document.querySelectorAll('.drop-card:not(.is-showcase) .drop-name')]
      .map((n) => n.textContent.trim()),
    showcaseName: document.querySelector('.drop-card.is-showcase .drop-name')?.textContent.trim() || '',
    // Числовых шансов в составе быть не должно.
    chances: document.querySelectorAll('.item-chance').length,
    badges: [...document.querySelectorAll('.drop-card')].map((b) => b.textContent),
    // Состав отсортирован от дорогого к дешёвому.
    values: [...document.querySelectorAll('.drop-card:not(.is-showcase) .drop-value')]
      .map((v) => Number(v.textContent.replace(/[^\d]/g, ''))).filter((x) => x > 0),
  }));

  check('сезонный: кнопка открытия заблокирована до старта',
        sheet.disabled === seasonal.future);
  check('карточка кейса: шансы предметов не показаны', sheet.chances === 0,
        `найдено ${sheet.chances}`);
  check('карточка кейса: RTP не показан',
        !sheet.badges.some((b) => /RTP/i.test(b)));
  // Состав идёт от дорогого к дешёвому.
  const sorted = [...sheet.values].sort((a, b) => b - a);
  check('состав отсортирован по убыванию цены',
        JSON.stringify(sheet.values) === JSON.stringify(sorted),
        sheet.values.join(', '));
  check('сезонный: витринная карточка показана', sheet.showcase === 1);
  check('сезонный: витрина вне таблицы розыгрыша',
        !sheet.inTable.includes(sheet.showcaseName), sheet.showcaseName);

  await ensureOpenerClosed();
  await page.evaluate(() => document.getElementById('sheetBackdrop')?.click());
  await page.waitForTimeout(200);
}

/* ---------- Экраны ---------- */

await ensureOpenerClosed();
await goto('crash');
await page.waitForTimeout(400);
check('краш: экран открывается',
      await page.isVisible('#crashActionBtn'));

/* ---------- Касса и честность ---------- */

await goto('wallet');
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
  stats: document.querySelectorAll('#statsGrid').length,
  visible: document.getElementById('view-fair').classList.contains('active'),
}));
check('честность: открывается ссылкой из подвала', fair.visible);
check('честность: хеш серверного seed показан', fair.hash === 64, `длина ${fair.hash}`);
check('честность: личная статистика убрана', fair.stats === 0, `блоков ${fair.stats}`);

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
