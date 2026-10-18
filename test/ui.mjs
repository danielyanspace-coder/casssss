/**
 * Сквозной тест интерфейса в браузере.
 *
 * Главная проверка - совпадение ленты с результатом: плитка, оказавшаяся под
 * маркером, обязана быть той же, что показана в результате. Именно здесь
 * ломалось, когда размер плитки в CSS разошёлся с константой в коде.
 *
 * Нужен playwright: npm i -D playwright
 * Запуск: node test/ui.mjs [url] [путь-к-chromium]
 */

import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LICENSE } from '../public/legal.js';

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
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  return false;
};

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
/*
 * Отказ сервера, который проверка вызывает намеренно (запуск игры казино без
 * ключа агрегатора), браузер сам пишет в консоль как ошибку загрузки. Он
 * разрешён только на время такой проверки: любой другой 503 - ошибка.
 */
let expectRefusal = false;
page.on('console', (m) => {
  const t = m.text();
  if (expectRefusal && /status of 503/.test(t)) return;
  // Внешние ресурсы (скрипт Telegram, favicon, шрифты Google, обложки с CDN
  // агрегатора) в тесте могут быть недоступны - не считаем. CERT_AUTHORITY -
  // это песочница, которая перехватывает TLS чужим сертификатом: к коду
  // приложения отношения не имеет.
  if (m.type() === 'error' && !/ERR_(FILE_NOT_FOUND|CONNECTION_RESET|NAME_NOT_RESOLVED|CERT_AUTHORITY_INVALID)|404/.test(t)) {
    consoleErrors.push(t);
  }
});
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.case-card', { timeout: 15000 });
await page.waitForTimeout(600);

/* ---------- Первый заход ---------- */

/*
 * Онбординг показывают только новичку: у кого уже есть сыгранные раунды или
 * пополнения, экран не появляется намеренно. Демо всегда открывается чистым
 * игроком, а сервер, по которому уже прогнали тесты API, - нет, поэтому
 * сначала спрашиваем, кто перед нами, и проверяем ровно то поведение, которое
 * для него правильное.
 *
 * Пройти онбординг надо до всего остального: он перекрывает весь экран, и
 * любая следующая проверка кликала бы в затемнение.
 */
const me = await page.evaluate(async () => {
  const r = await fetch('/api/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': '' },
    body: '{}',
  });
  return (await r.json()).user;
});
const newcomer = !me.stats.rounds && !me.depositsCount;

check('первый заход: экран показан новичку и только ему',
  (await page.isVisible('#onbBackdrop')) === newcomer,
  `раундов ${me.stats.rounds}, пополнений ${me.depositsCount}`);

if (newcomer) {
  const first = await page.textContent('#onbTitle');
  await page.click('#onbNext');
  await page.waitForTimeout(150);
  check('первый заход: «Дальше» листает',
    (await page.textContent('#onbTitle')) !== first);
  check('первый заход: точка отмечает шаг',
    await page.evaluate(() => [...document.querySelectorAll('#onbDots i')][1]?.classList.contains('on')));

  check('первый заход: на экране честности назван регулятор',
    (await page.textContent('#onbText')).includes(`лицензии ${LICENSE.authority}`));
  check('первый заход: сказано, что лицензия регулирует выплаты',
    /регулирует выплаты/i.test(await page.textContent('#onbText')));
  // Номер показывается ровно тот, что записан в legal.js по документу
  // заказчика, и никакой другой: пустой - строка без номера.
  {
    const shown = /№\s*(\S+?)\./.exec(await page.textContent('#onbText'))?.[1] || '';
    check('первый заход: номер лицензии из legal.js', shown === LICENSE.number, shown);
  }

  await page.click('#onbNext');
  await page.waitForTimeout(150);
  check('первый заход: последний экран про первое пополнение',
    /первое пополнение/i.test(await page.textContent('#onbTitle')));

  await page.click('#onbSkip');
  await page.waitForTimeout(250);
  check('первый заход: закрывается кнопкой', !(await page.isVisible('#onbBackdrop')));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.case-card', { timeout: 15000 });
  await page.waitForTimeout(600);
  check('первый заход: второй раз не показывается', !(await page.isVisible('#onbBackdrop')));
}

/* ---------- Баннеры первого экрана ---------- */

/*
 * Блока «первое пополнение +N%» на первом экране больше нет: он спорил с
 * присланными баннерами и был снят по просьбе заказчика. Условия бонуса
 * никуда не делись - они остались в кассе, там же и проверяются.
 *
 * Вместо него на первом экране два баннера-кнопки: широкий ведёт на страницу
 * Lucky Fortune, квадратный - в «Казино».
 */
{
  check('блока первого пополнения на первом экране нет',
    await page.evaluate(() => !document.querySelector('.welcome-offer')));

  check('широкий баннер - кнопка', await page.isVisible('#promoFortune'));
  check('квадратный баннер - кнопка «Казино»', await page.isVisible('#promoCasino'));
  check('баннера «Бонусы» на первом экране нет',
    await page.evaluate(() => !document.getElementById('promoBonuses')));
  const casinoArt = await page.evaluate(() => {
    const img = document.querySelector('#promoCasino img');
    return { loaded: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight };
  });
  // Пропорция обязана остаться прежней: от неё зависит высота пары баннеров.
  check('баннер «Казино» загружен и той же пропорции 900x782',
    casinoArt.loaded && casinoArt.w === 900 && casinoArt.h === 782, JSON.stringify(casinoArt));

  // Слайд-шоу: джекпот-баннер первым и дольше всех (10 с против 3 с), он
  // заменил старый четвёртый баннер с поездкой.
  const slides = await page.evaluate(() => [...document.querySelectorAll('#hero .hero-img')]
    .map((i) => ({ alt: i.alt, ms: Number(i.dataset.ms) })));
  // По подписи, а не по адресу: в автономной сборке адрес - сам файл.
  check('слайд-шоу: джекпот первым, 10 секунд', /джекпоты/i.test(slides[0]?.alt) && slides[0]?.ms === 10000,
        JSON.stringify(slides[0]));
  check('слайд-шоу: остальные три по 3 секунды',
        slides.length === 4 && slides.slice(1).every((x) => x.ms === 3000),
        slides.map((x) => `${x.alt}:${x.ms}`).join(' / '));

  await page.click('#promoCasino');
  await page.waitForTimeout(400);
  check('баннер «Казино» ведёт в раздел казино',
    await page.evaluate(() => document.getElementById('view-casino').classList.contains('active')));

  await page.click('#brandHome');
  await page.waitForTimeout(400);
  check('логотип возвращает на главную',
    await page.evaluate(() => document.getElementById('view-cases').classList.contains('active')));
}

/* ---------- Free Money ---------- */

/*
 * Раздел за широким баннером - витрина розыгрышей, а не одна игра. Колесо
 * фортуны на ней только один из ивентов, поэтому заход в раздел ВСЕГДА
 * возвращает к списку: игрок, ушедший с середины колеса, иначе перестаёт
 * видеть остальные розыгрыши.
 */
{
  await page.click('#promoFortune');
  await page.waitForTimeout(500);
  check('баннер открывает Free Money',
    await page.evaluate(() => document.getElementById('view-freemoney').classList.contains('active')));
  check('у раздела есть заголовок',
    /free\s*money/i.test(await page.textContent('#view-freemoney .game-title')));
  check('раздел открывается с обложки', await page.isVisible('#fortuneIntro'));
  check('колесо пока скрыто', !(await page.isVisible('#fortuneStage')));

  /*
   * Обложка вписана во всю ширину раздела, а не превращена в значок. Это уже
   * ломалось: карточка ужималась до квадратика в списке, и присланный арт
   * переставало быть видно.
   */
  const cardW = await page.evaluate(() => {
    const img = document.querySelector('.fortune-card-img');
    const page = document.querySelector('.fortune-page');
    return { img: img.getBoundingClientRect().width, page: page.getBoundingClientRect().width };
  });
  check('обложка занимает всю ширину раздела',
    cardW.img >= cardW.page - 2, `${Math.round(cardW.img)} из ${Math.round(cardW.page)}`);

  await page.click('#fortuneGo');
  await page.waitForTimeout(400);
  check('«Продолжить» открывает колесо', await page.isVisible('#fortuneStage'));
  check('витрина спрятана', !(await page.isVisible('#fortuneIntro')));
  check('шапка на странице колеса на месте', await page.isVisible('#balanceChip'));
  check('подвал на странице колеса на месте', await page.isVisible('#siteFooter'));
  check('знаки партнёров в подвале',
    await page.evaluate(() => document.querySelectorAll('.footer-mark svg').length) === 4,
    String(await page.evaluate(() => document.querySelectorAll('.footer-mark svg').length)));

  const angleBefore = await page.evaluate(() =>
    document.getElementById('fortuneWheel').style.transform);
  await page.click('#fortuneSpin');
  await page.waitForTimeout(6200);

  check('колесо провернулось', await page.evaluate(() =>
    document.getElementById('fortuneWheel').style.transform) !== angleBefore);
  check('окно выигрыша показано', await page.isVisible('#fortuneWinBackdrop'));
  check('в окне названа суть приза',
    (await page.textContent('#fortuneWinKind')).trim().length > 0);
  check('в окне сказано, что с призом делать',
    (await page.textContent('#fortuneWinNote')).trim().length > 0);

  /*
   * САМАЯ ВАЖНАЯ ПРОВЕРКА НА ЭТОЙ СТРАНИЦЕ.
   *
   * Колесо обязано остановиться ровно на том секторе, который соответствует
   * показанному призу. Разъехаться тут легко: сектор решает сервер, а угол
   * считает клиент, и одна ошибка в знаке превращает честное колесо в
   * обман - игрок видит, что стрелка стоит на деньгах, а получает процент.
   *
   * Считается арифметикой, а не глазами: по повороту находим, что оказалось
   * под указателем на нуле градусов, и сверяем тип этого сектора с тем, что
   * написано в окне выигрыша. Порядок секторов снят с присланной картинки и
   * продублирован в server/fortune.js.
   */
  const SEG_TYPES = ['case', 'case', 'case', 'case', 'x2', 'percent', 'cash', 'voucher', 'voucher'];
  const KIND_TITLES = {
    case: 'Кейс в подарок', x2: 'Удвоитель', percent: 'Процент к пополнению',
    cash: 'Деньги на счёт', voucher: 'Ваучер',
  };
  const deg = await page.evaluate(() => parseFloat(
    (document.getElementById('fortuneWheel').style.transform.match(/-?[\d.]+/) || [0])[0]) || 0);

  const START = -7, SIZE = 40;
  // Сектор, чья середина приехала к указателю: угол сектора плюс поворот
  // должен дать ноль по кругу.
  const under = ((-deg % 360) + 360) % 360;
  const landed = Math.floor((((under - START) % 360) + 360) % 360 / SIZE);
  const shownKind = (await page.textContent('#fortuneWinKind')).trim();

  check('колесо встало на сектор показанного приза',
    KIND_TITLES[SEG_TYPES[landed]] === shownKind,
    `под указателем сектор ${landed} (${SEG_TYPES[landed]}), а показано «${shownKind}»`);

  await page.click('#fortuneWinClose');
  await page.waitForTimeout(300);
  check('окно выигрыша закрывается', !(await page.isVisible('#fortuneWinBackdrop')));

  /*
   * Сутки между прокрутами. Проверяется тем, что второе нажатие не открывает
   * окно выигрыша: без этой проверки все пять прокрутов уходили подряд за
   * минуту, и правило «раз в сутки» существовало только на словах.
   */
  await page.click('#fortuneSpin');
  await page.waitForTimeout(900);
  check('второй прокрут подряд не проходит',
    !(await page.isVisible('#fortuneWinBackdrop')));
  check('сказано, когда будет следующий',
    /через/i.test(await page.textContent('#fortuneStatus')));

  // Выход и повторный заход возвращают к списку, а не к открытому колесу.
  await page.click('#brandHome');
  await page.waitForTimeout(400);
  await page.click('#promoFortune');
  await page.waitForTimeout(500);
  check('повторный заход возвращает к обложке', await page.isVisible('#fortuneIntro'));
  check('прокрученное в прошлый раз колесо не показывается',
    !(await page.isVisible('#fortuneStage')));

  await page.click('#brandHome');
  await page.waitForTimeout(400);
}

/* ---------- Меню ---------- */

/**
 * Переход в раздел через меню.
 *
 * Меню собрано поверх присланной картинки: подписи и иконки нарисованы прямо
 * на ней, а кликабельные области лежат сверху прозрачными кнопками.
 */
async function goto(view) {
  await page.click('#menuBtn');
  const sel = `#menuPhoto .menu-hit[data-view="${view}"], #menuExtra .menu-tile[data-view="${view}"]`;
  await page.waitForSelector(sel, { state: 'visible' });
  await page.click(sel);
  await page.waitForTimeout(400);
}

{
  await page.click('#menuBtn');
  await page.waitForSelector('#menuPhoto .menu-hit', { state: 'visible' });

  const menu = await page.evaluate(() => {
    const img = document.getElementById('menuPhotoImg');
    const box = img.getBoundingClientRect();
    const hits = [...document.querySelectorAll('#menuPhoto .menu-hit[data-view]')];
    const rect = (el) => el.getBoundingClientRect();

    return {
      imgLoaded: img.complete && img.naturalWidth > 0,
      views: hits.map((b) => b.dataset.view),
      // Область обязана лежать внутри картинки, иначе нажатие уедет мимо
      // нарисованной плитки.
      inside: hits.every((b) => {
        const r = rect(b);
        return r.left >= box.left - 1 && r.right <= box.right + 1
            && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      }),
      // Перекрытие областей означало бы, что нажатие попадёт не в тот раздел.
      overlap: hits.some((a, i) => hits.slice(i + 1).some((b) => {
        const ra = rect(a); const rb = rect(b);
        return ra.left < rb.right && rb.left < ra.right
            && ra.top < rb.bottom && rb.top < ra.bottom;
      })),
      // Плитки должны быть крупными: по картинке в них и целятся пальцем.
      minSide: Math.min(...hits.map((b) => Math.min(rect(b).width, rect(b).height))),
      hasBack: !!document.querySelector('#menuPhoto .menu-hit-back'),
      bottomNav: document.querySelectorAll('.bottom-nav, .nav-btn').length,
      // Поддержка ведёт наружу, поэтому data-view у неё нет и в hits она не
      // попадает - проверяем отдельно, что область есть и лежит на картинке.
      support: (() => {
        const el = document.getElementById('menuSupport');
        if (!el) return null;
        const r = rect(el);
        return {
          inside: r.left >= box.left - 1 && r.right <= box.right + 1
               && r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
          height: r.height,
        };
      })(),
    };
  });

  check('меню: картинка загрузилась', menu.imgLoaded);
  check('меню: шесть кликабельных разделов', menu.views.length === 6, menu.views.join(', '));
  check('меню: порядок разделов совпадает с картинкой',
        menu.views.join(',') === 'cases,upgrade,crash,roulette,wallet,bonuses',
        menu.views.join(','));
  check('меню: «Честности» в меню нет', !menu.views.includes('fair'));
  check('меню: «Истории» в меню нет', !menu.views.includes('history'));
  check('меню: области лежат внутри картинки', menu.inside);
  check('меню: области не перекрываются', !menu.overlap);
  check('меню: области крупные', menu.minSide >= 44, `минимальная сторона ${Math.round(menu.minSide)}px`);
  check('меню: кнопка возврата на месте', menu.hasBack);
  check('меню: нижняя панель убрана', menu.bottomNav === 0);
  check('меню: полоса «Поддержка» на месте', !!menu.support);
  check('меню: «Поддержка» лежит внутри картинки', menu.support?.inside);
  check('меню: «Поддержка» крупная', (menu.support?.height || 0) >= 44,
        `высота ${Math.round(menu.support?.height || 0)}px`);

  // Поддержка уводит в телеграм. В браузере моста нет, остаётся window.open -
  // его и перехватываем, чтобы проверить адрес и не открывать вкладку.
  await page.evaluate(() => {
    window.__supportUrl = null;
    window.open = (url) => { window.__supportUrl = url; return null; };
  });
  await page.click('#menuSupport');
  await page.waitForTimeout(300);
  check('меню: «Поддержка» ведёт в чат @luckyboxsupport',
        await page.evaluate(() => window.__supportUrl) === 'https://t.me/luckyboxsupport',
        String(await page.evaluate(() => window.__supportUrl)));
  check('меню: «Поддержка» закрывает меню',
        await page.evaluate(() => document.getElementById('menuBackdrop').hidden));

  await page.click('#menuBtn');
  await page.waitForSelector('#menuPhoto .menu-hit', { state: 'visible' });

  await page.click('#menuPhoto .menu-hit-back');
  await page.waitForTimeout(300);
  check('меню: кнопка на картинке закрывает меню',
        await page.evaluate(() => document.getElementById('menuBackdrop').hidden));
}

/* ---------- Лента выигрышей ---------- */

{
  await page.waitForTimeout(1500);
  const snapshot = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('#feedTrack .feed-card')];
    return {
      visible: !document.getElementById('feed').hidden,
      title: document.querySelector('.feed-title')?.textContent.trim() || '',
      height: Math.round(document.getElementById('feed').getBoundingClientRect().height),
      count: cards.length,
      first: cards[0]?.textContent || '',
      drawn: cards.filter((c) => c.querySelector('.feed-art svg')).length,
      withValue: cards.filter((c) => /\d/.test(c.querySelector('.feed-value')?.textContent || '')).length,
      withNick: cards.filter((c) => c.querySelector('.feed-nick')).length,
      clickable: cards.filter((c) => c.dataset.drop).length,
      // Плашки ленты прямоугольные: силуэты карточек здесь не используются.
      shaped: cards.filter((c) => getComputedStyle(c).clipPath !== 'none').length,
      // Лента не должна выдавать шансы - как и остальной интерфейс.
      percents: cards.filter((c) => c.textContent.includes('%')).length,
    };
  });

  const feed = await snapshot();

  check('лента: показана', feed.visible);
  check('лента: заголовок «Выигрывают сейчас»',
        feed.title === 'Выигрывают сейчас', feed.title);
  check('лента: карточки заполнены', feed.count > 0, `карточек ${feed.count}`);
  check('лента: у каждой карточки есть рисунок', feed.drawn === feed.count,
        `${feed.drawn} из ${feed.count}`);
  check('лента: у каждой карточки есть сумма', feed.withValue === feed.count,
        `${feed.withValue} из ${feed.count}`);
  // Ников в витрине нет: она про выигрыш, а не про того, кто его снял.
  check('лента: ников нет', feed.withNick === 0, `нашлось ${feed.withNick}`);
  check('лента: карточки нажимаются', feed.clickable === feed.count,
        `${feed.clickable} из ${feed.count}`);
  check('лента: плашки прямоугольные, без силуэтов', feed.shaped === 0,
        `с силуэтом ${feed.shaped} из ${feed.count}`);
  check('лента: проценты не показаны', feed.percents === 0, `нарушений ${feed.percents}`);
  // Полоса не должна разрастаться вниз - она под шапкой, над самими кейсами.
  // Порог поднят вместе с карточками: они стали крупнее по присланному
  // эталону, но лента по-прежнему обязана оставаться полосой, а не экраном.
  check('лента: занимает узкую полосу', feed.height <= 200, `высота ${feed.height}px`);

  // Новые выигрыши въезжают по одному, а не перерисовывают ленту целиком:
  // счётчик карточек держится на потолке, а первая карточка меняется.
  await page.waitForTimeout(7000);
  const later = await snapshot();
  check('лента: пополняется новыми выигрышами', later.first !== feed.first,
        `первая карточка не изменилась за 7 с`);
  check('лента: длина не растёт бесконечно', later.count === feed.count && later.count <= 20,
        `было ${feed.count}, стало ${later.count}`);
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

  // Прокрут: указатель обязан встать на угол ролла, а исход - совпасть
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

  // Кнопка запуска обязана быть видна без прокрутки: тянуться вниз перед
  // каждым запуском - лишнее движение на самом частом действии раздела.
  const fit = await page.evaluate(() => {
    window.scrollTo(0, 0);
    const btn = document.getElementById('upgradeBtn').getBoundingClientRect();
    const ring = document.querySelector('.upg-stage').getBoundingClientRect();
    return {
      overflow: Math.round(btn.bottom - window.innerHeight),
      ringVisible: ring.top >= 0 && ring.bottom <= window.innerHeight,
    };
  });
  check('апгрейд: кнопка видна без прокрутки', fit.overflow <= 0,
        `не помещается на ${fit.overflow}px`);
  check('апгрейд: кольцо целиком на экране', fit.ringVisible);
}

/* ---------- Тексты: проект подан как действующий сервис ---------- */

{
  const FORBIDDEN = [
    'симулятор', 'условны', 'виртуальн', 'реальных денег',
    'ничего не стоят', 'вывода не существует', 'демонстрационн',
  ];

  const texts = await page.evaluate(() => {
    const out = { shell: document.body.innerText, docs: {} };
    for (const btn of document.querySelectorAll('.footer-link[data-doc]')) {
      btn.click();
      out.docs[btn.textContent.trim()] = document.getElementById('docBody').innerText;
    }
    document.getElementById('docBackdrop').hidden = true;
    return out;
  });

  const hits = [];
  for (const [where, text] of [['интерфейс', texts.shell], ...Object.entries(texts.docs)]) {
    for (const word of FORBIDDEN) {
      if (text.toLowerCase().includes(word)) hits.push(`${where}: «${word}»`);
    }
  }
  check('тексты: нет оговорок про симулятор и условные единицы',
        hits.length === 0, hits.join('; '));

  const docs = Object.keys(texts.docs);
  check('документы: соглашение и политика открываются',
        docs.some((d) => /соглашение/i.test(d)) && docs.some((d) => /конфиденциальн/i.test(d)),
        docs.join(', '));

  // Полноценные документы, а не пара абзацев для вёрстки.
  const terms = Object.entries(texts.docs).find(([k]) => /соглашение/i.test(k))?.[1] || '';
  const privacy = Object.entries(texts.docs).find(([k]) => /конфиденциальн/i.test(k))?.[1] || '';
  check('соглашение: разделы про вывод, верификацию и ответственную игру',
        /вывод/i.test(terms) && /верификац/i.test(terms) && /ответственн/i.test(terms));
  check('политика: разделы про права, хранение и передачу данных',
        /ваши права/i.test(privacy) && /срок/i.test(privacy) && /переда/i.test(privacy));
  check('документы: объём как у настоящих', terms.length > 6000 && privacy.length > 3000,
        `соглашение ${terms.length}, политика ${privacy.length}`);
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
  // не станет никогда - ждём именно состояние.
  await page.waitForFunction(() => document.getElementById('opener').hidden, { timeout: 5000 });
  await page.waitForTimeout(200);
}

async function openCaseAndVerify(caseId) {
  await ensureOpenerClosed();
  // Незавершённая серия фриспинов доигрывается при входе в кейс и прячет
  // панель открытия. Для теста состояние должно быть чистым.
  await page.evaluate(() => fetch('/api/freespins/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': '' },
    body: '{}',
  }).catch(() => {}));
  await page.evaluate((id) => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === id);
    card.scrollIntoView({ block: 'center' });
    card.click();
  }, caseId);

  await page.waitForSelector('#doOpenBtn', { state: 'visible' });
  await page.click('#doOpenBtn');

  /*
   * Если выпали фриспины, серия играется до результата и может идти минуту:
   * прокрутов бывает под два десятка. Дожидаемся её конца и забираем выигрыш -
   * иначе проверка упирается в таймаут на ровном месте, а не на ошибке.
   */
  const seriesWaiting = () => page.evaluate(() => {
    const fs = document.getElementById('freespins');
    const btn = document.getElementById('fsCollect');
    return !!fs && !fs.hidden && !!btn && !btn.hidden;
  });

  /*
   * Ждём одного из двух: экрана результата или кнопки «Забрать» под серией.
   * Настройки идут третьим аргументом - вторым waitForFunction принимает
   * данные для функции, и таймаут, переданный туда, молча теряется.
   */
  const waitForEnd = () => page.waitForFunction(() => {
    const res = document.getElementById('result');
    const fs = document.getElementById('freespins');
    const btn = document.getElementById('fsCollect');
    return (!!res && !res.hidden) || (!!fs && !fs.hidden && !!btn && !btn.hidden);
  }, null, { timeout: 180000 });

  /*
   * Забирать серию приходится в цикле: фриспин может выдать новые фриспины, и
   * после «Забрать» начинается следующая серия. Одного нажатия хватает не
   * всегда, а ждать после него сразу результата - значит упереться в таймаут
   * на ровном месте.
   */
  await waitForEnd();
  let collected = 0;
  while (await seriesWaiting() && collected++ < 10) {
    await page.click('#fsCollect');
    await waitForEnd();
  }

  // Ждём окончания прокрутки: результат появляется после неё.
  await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(500);

  return page.evaluate(() => {
    // Именно родитель нужной ленты: класс .reel-wrap есть и у рулетки,
    // а querySelector вернул бы её - скрытую, с нулевыми координатами.
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
      // Показ выигрыша (public/motion.js) обязан за собой убрать: размытая
      // сцена, бонусный фон или окно выигрыша поверх результата - это
      // запертое приложение, а не оформление.
      stuck: [
        document.body.classList.contains('mo-receded') && 'сцена размыта',
        document.getElementById('opener').classList.contains('is-bonus') && 'бонусный фон',
        document.querySelector('.mo-wl') && 'окно выигрыша',
        document.querySelector('.reel-tile.mo-lifted') && 'плитка спрятана',
      ].filter(Boolean),
      motionMounted: !!document.querySelector('.mo-root'),
    };
  });
}

/* ---------- Карточка выигрыша из ленты ---------- */

{
  await ensureOpenerClosed();
  // К этому месту тест успевает уйти в другие разделы, а лента живёт в кейсах.
  await goto('cases');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForSelector('#feedTrack .feed-card', { state: 'visible', timeout: 10000 });
  await page.click('#feedTrack .feed-card');
  await page.waitForSelector('#feedBackdrop:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(350);

  const sheet = await page.evaluate(() => {
    const cover = document.getElementById('feedSheetCover');
    const img = cover.querySelector('img');
    return {
      name: document.getElementById('feedSheetName').textContent.trim(),
      value: document.getElementById('feedSheetValue').textContent.trim(),
      caseText: document.getElementById('feedSheetCase').textContent.trim(),
      hasArt: !!cover.firstElementChild,
      // Обложка бывает картинкой и бывает нарисованной: годится любая, лишь
      // бы не пустое место. У картинки дополнительно проверяем, что загрузилась.
      imgOk: img ? (img.complete && img.naturalWidth > 0) : true,
      canOpen: !document.getElementById('feedSheetOpen').hidden,
    };
  });

  check('карточка выигрыша: показан предмет', !!sheet.name, sheet.name);
  check('карточка выигрыша: показана сумма', /\d/.test(sheet.value), sheet.value);
  check('карточка выигрыша: назван кейс', !!sheet.caseText, sheet.caseText);
  check('карточка выигрыша: обложка кейса на месте', sheet.hasArt && sheet.imgOk);
  check('карточка выигрыша: можно провалиться в кейс', sheet.canOpen);

  await page.click('#feedSheetClose');
  await page.waitForTimeout(250);
  check('карточка выигрыша: закрывается',
        await page.evaluate(() => document.getElementById('feedBackdrop').hidden));
}

/* ---------- Покупка фриспинов ---------- */

{
  await ensureOpenerClosed();
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.case-card')]
      .find((c) => c.dataset.case === 'warmup_100');
    card.scrollIntoView({ block: 'center' });
    card.click();
  });
  await page.waitForSelector('#fsBuy .fsbuy-btn', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);

  const fs = await page.evaluate(async () => {
    const cfg = await (await fetch('/api/config', {
      headers: { 'X-Telegram-Init-Data': '' },
    })).json();
    const kase = cfg.cases.find((c) => c.id === 'warmup_100');
    const box = document.getElementById('fsBuy');
    const panel = box.getBoundingClientRect();
    const stage = document.getElementById('caseStage');

    return {
      packs: cfg.freeSpinPacks.map((p) => {
        // Та же формула, что на сервере: лесенка скидок, потом округление вниз
        // до круглого числа с потолком в 2.5% (см. roundPackPrice).
        const raw = Math.round(kase.price * p.count * (1 - p.discount));
        let expected = raw;
        for (let step = 10; step <= raw; step *= 10) {
          const down = Math.floor(raw / step) * step;
          if (down <= 0 || raw - down > raw * 0.025) break;
          expected = down;
        }
        return { count: p.count, popular: !!p.popular, expected };
      }),
      height: panel.height,
      stageHeight: stage && !stage.hidden ? stage.getBoundingClientRect().height : 0,
      buttons: [...box.querySelectorAll('.fsbuy-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          count: Number(b.dataset.fs),
          price: b.querySelector('.fsbuy-price').textContent.replace(/\s/g, ' ').trim(),
          popular: b.classList.contains('is-popular'),
          flag: b.querySelector('.fsbuy-flag')?.textContent.trim() || '',
          countText: b.querySelector('.fsbuy-count')?.textContent.trim() || '',
          fits: r.left >= panel.left - 1 && r.right <= panel.right + 1,
        };
      }),
    };
  });

  const money = (n) => `${n.toLocaleString('ru-RU')} ₽`.replace(/\s/g, ' ');

  /*
   * Блок покупки - дополнительная кнопка, а не главное на экране кейса.
   * Прежний, собранный вокруг картинки-макета, был ростом с обложку кейса, и
   * заказчик попросил его ужать. Сравниваем с обложкой, а не с числом точек:
   * на компьютере и на телефоне высоты разные. Обложка на экране кейса есть
   * всегда - ленты до открытия ещё нет.
   */
  check('фриспины: блок покупки не больше половины обложки кейса',
        fs.height > 0 && fs.stageHeight > 0 && fs.height < fs.stageHeight / 2,
        `блок ${Math.round(fs.height)}, обложка ${Math.round(fs.stageHeight)}`);
  check('фриспины: ступеней столько же, сколько в конфиге',
        fs.buttons.length === fs.packs.length,
        `кнопок ${fs.buttons.length}, ступеней ${fs.packs.length}`);
  check('фриспины: на каждой ступени видно её число прокрутов',
        fs.buttons.every((b) => b.countText === String(b.count)),
        fs.buttons.map((b) => `${b.count}: «${b.countText}»`).join(', '));
  check('фриспины: карточки не вылезают за панель', fs.buttons.every((b) => b.fits));

  // Цена считается по тем же числам, что у сервера. Расходится - значит на
  // экране одна сумма, а списывается другая.
  const wrongPrice = fs.packs.filter((p, i) => fs.buttons[i]?.price !== money(p.expected));
  check('фриспины: цены совпадают со ступенями конфига', wrongPrice.length === 0,
        wrongPrice.map((p, i) => `${p.count}: ${fs.buttons[i]?.price} вместо ${money(p.expected)}`)
          .join('; '));

  // Пометку задаёт сервер: она про лесенку скидок, а не про вёрстку.
  const popularPack = fs.packs.find((p) => p.popular);
  const popularBtns = fs.buttons.filter((b) => b.popular);
  check('фриспины: выделена ровно одна ступень', popularBtns.length === 1,
        `выделено ${popularBtns.length}`);
  check('фриспины: выделена та, что помечена в конфиге',
        popularBtns[0]?.count === popularPack?.count,
        `в вёрстке ${popularBtns[0]?.count}, в конфиге ${popularPack?.count}`);
  check('фриспины: у выделенной ступени есть пометка',
        /хит/i.test(popularBtns[0]?.flag || ''), popularBtns[0]?.flag);

  // Покупка идёт через сцену: жетон, число, цена. Отмена ничего не списывает.
  const before = await page.evaluate(() => document.getElementById('balanceValue')?.textContent || '');
  const pick = fs.buttons[0];
  await page.evaluate((n) => document.querySelector(`#fsBuyRow .fsbuy-btn[data-fs="${n}"]`).scrollIntoView({ block: 'center' }), pick.count);
  await page.click(`#fsBuyRow .fsbuy-btn[data-fs="${pick.count}"]`);
  await page.waitForTimeout(1500);
  const scene = await page.evaluate(() => ({
    open: !document.getElementById('buyBackdrop').hidden,
    token: !!document.querySelector('#buyArt svg, #buyArt img'),
    title: document.getElementById('buyTitle').textContent.replace(/\s+/g, ' ').trim(),
    price: document.getElementById('buyPrice').textContent.replace(/\s/g, ' ').trim(),
    orbit: document.querySelectorAll('#buyOrbit i').length,
  }));
  check('фриспины: покупка открывает сцену с жетоном', scene.open && scene.token, JSON.stringify(scene));
  check('фриспины: в сцене число прокрутов', scene.title.startsWith(String(pick.count)), scene.title);
  check('фриспины: цена в сцене та же, что на плитке', scene.price === pick.price, `${scene.price} / ${pick.price}`);
  check('фриспины: кольцо жетонов по числу прокрутов', scene.orbit === Math.min(pick.count, 30), `жетонов ${scene.orbit}`);
  await page.click('#buyCancel');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    hidden: document.getElementById('buyBackdrop').hidden,
    balance: document.getElementById('balanceValue')?.textContent || '',
  }));
  check('фриспины: «Отмена» закрывает сцену и ничего не списывает',
        after.hidden && after.balance === before, JSON.stringify({ before, ...after }));

  await ensureOpenerClosed();
}

/* ---------- Тема кейса ---------- */

{
  await ensureOpenerClosed();

  /*
   * Экран кейса красится тонами его же обложки. Проверяем не «есть класс», а
   * что у двух разных кейсов тона действительно разные: иначе тема сведётся к
   * одинаковому фиолетовому у всех, ровно от чего и уходили.
   */
  const themeOf = async (id) => {
    await ensureOpenerClosed();
    await page.evaluate((caseId) => {
      // Сезонный кейс стоит витриной и карточку полки не имеет.
      const card = [...document.querySelectorAll('.case-card, .featured-card')]
        .find((c) => c.dataset.case === caseId);
      card.scrollIntoView({ block: 'center' });
      card.click();
    }, id);
    await page.waitForSelector('#doOpenBtn', { state: 'visible' });
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const op = document.getElementById('opener');
      const wash = document.querySelector('.opener-theme-wash');
      return {
        themed: op.classList.contains('is-themed'),
        h1: op.style.getPropertyValue('--case-h1'),
        h2: op.style.getPropertyValue('--case-h2'),
        washLoaded: !!wash && wash.complete && wash.naturalWidth > 0,
      };
    });
  };

  const frost = await themeOf('frost_300');
  const lucky = await themeOf('lucky_200');

  check('тема кейса: включается на кейсе с присланным артом', frost.themed && lucky.themed);
  check('тема кейса: обложка ушла в фон', frost.washLoaded && lucky.washLoaded);
  check('тема кейса: тона взяты с обложки', !!frost.h1 && !!frost.h2, `${frost.h1} / ${frost.h2}`);
  check('тема кейса: у разных кейсов разные тона', frost.h1 !== lucky.h1,
        `«Мерзлота» ${frost.h1}, «Счастливый» ${lucky.h1}`);

  /*
   * У кейса без разобранного арта тонов нет, и экран должен остаться прежним.
   * Такой в проекте один - сезонный «Porsche»: его обложка нарисована готовым
   * баннером под свою пропорцию и через подготовку обложек не проходит.
   */
  const plain = await themeOf('porsche_999');
  check('тема кейса: без разобранного арта остаётся обычный экран', !plain.themed);

  await ensureOpenerClosed();
}

/* ---------- Обряд открытия ---------- */

{
  await ensureOpenerClosed();
  await page.evaluate(() => fetch('/api/freespins/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': '' },
    body: '{}',
  }).catch(() => {}));

  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === 'dust_25');
    card.scrollIntoView({ block: 'center' });
    card.click();
  });
  await page.waitForSelector('#doOpenBtn', { state: 'visible' });
  await page.waitForTimeout(300);

  const stageState = () => page.evaluate(() => {
    const stage = document.getElementById('caseStage');
    const arts = [...document.querySelectorAll('#caseStageRow .case-stage-art')];
    return {
      stageShown: !stage.hidden,
      reelsHidden: document.getElementById('reels').hidden,
      кейсов: arts.length,
      загрузились: arts.every((a) => a.complete && a.naturalWidth > 0),
      // Кейсы не должны вылезать за ряд: при ×2 они обязаны сжаться.
      влезли: arts.every((a) => {
        const row = document.getElementById('caseStageRow').getBoundingClientRect();
        const r = a.getBoundingClientRect();
        return r.left >= row.left - 1 && r.right <= row.right + 1;
      }),
      подпись: document.getElementById('caseStageHint').textContent.trim(),
      высотаСцены: Math.round(stage.getBoundingClientRect().height),
    };
  });

  const idle = await stageState();
  check('обряд: до нажатия на экране кейс, а не лента',
        idle.stageShown && idle.reelsHidden && idle.кейсов === 1);
  check('обряд: обложка на сцене загрузилась', idle.загрузились);
  const высотаОдного = idle.высотаСцены;

  /*
   * Иксы должны быть видны до списания: раньше их смысл выяснялся уже после
   * оплаты. У кейса с обрядом это не барабаны, а сами кейсы на сцене.
   */
  /*
   * Икс выбирается кнопками «−» и «+» (панель «Пульт»): плашек ×1…×5 больше
   * нет. Доводим счётчик до нужного числа и сверяем его с подписью.
   */
  const setCount = async (n) => {
    for (let guard = 0; guard < 10; guard++) {
      const cur = await page.evaluate(() => Number(document.getElementById('countVal').textContent.replace(/\D/g, '')));
      if (cur === n) return cur;
      await page.click(`#countRow [data-step="${cur < n ? 1 : -1}"]`);
      await page.waitForTimeout(120);
    }
    return null;
  };

  // Потолок пачки - два: «+» на ×2 дальше не ведёт.
  for (const n of [2]) {
    const got = await setCount(n);
    check(`икс: кнопки «−» и «+» доводят до ×${n}`, got === n, `стоит ×${got}`);
    await page.waitForTimeout(200);
    const st = await stageState();
    check(`обряд: ×${n} ставит на сцену ${n} кейсов`, st.кейсов === n, `их ${st.кейсов}`);
    check(`обряд: при ×${n} кейсы влезают в ряд`, st.влезли);
    check(`обряд: подпись показывает количество`, st.подпись.includes(`×${n}`), st.подпись);
    /*
     * Высота сцены не должна зависеть от числа кейсов: иначе при переборе
     * иксов экран прыгает, и кнопка «Открыть» уезжает из-под пальца.
     */
    check(`обряд: при ×${n} высота сцены не изменилась`,
          Math.abs(st.высотаСцены - высотаОдного) <= 2,
          `${st.высотаСцены} против ${высотаОдного}`);
  }

  await setCount(1);
  await page.waitForTimeout(200);
  await page.click('#doOpenBtn');

  // Тряска идёт около секунды: ловим её в середине, пока лента ещё не пришла.
  await page.waitForTimeout(450);
  const shaking = await page.evaluate(() => {
    const stage = document.getElementById('caseStage');
    return {
      shaking: stage.classList.contains('is-shaking'),
      puffs: document.getElementById('caseStageDust').children.length,
      reelsHidden: document.getElementById('reels').hidden,
    };
  });

  check('обряд: кейс трясётся до появления ленты',
        shaking.shaking && shaking.reelsHidden);
  check('обряд: из-под кейса идёт пыль', shaking.puffs > 0, `клубов ${shaking.puffs}`);

  /*
   * Ждём именно появления барабана, а не снятия hidden: показывается блок
   * сразу после тряски, а плитки в него кладёт уже прокрут, и между этим есть
   * кадр, где барабана ещё нет.
   */
  await page.waitForSelector('#reels .reel-wrap', { state: 'attached', timeout: 15000 });
  const after = await page.evaluate(() => ({
    stageHidden: document.getElementById('caseStage').hidden,
    reelsShown: !document.getElementById('reels').hidden,
  }));
  check('обряд: после тряски кейс уходит, остаётся лента',
        after.reelsShown && after.stageHidden);

  await page.waitForFunction(() => {
    const res = document.getElementById('result');
    const fs = document.getElementById('freespins');
    const btn = document.getElementById('fsCollect');
    return (!!res && !res.hidden) || (!!fs && !fs.hidden && !!btn && !btn.hidden);
  }, null, { timeout: 120000 });

  /*
   * Обряд положен всем кейсам с вырезанной обложкой, а не одному выбранному.
   * Проверяем на кейсах из разных полок и с разной формой обложки - и на
   * единственном исключении, сезонном «Porsche»: его обложка нарисована
   * широким баннером, трясти там нечего, и лента должна остаться прежней.
   */
  const обрядУ = async (id) => {
    await ensureOpenerClosed();
    await page.evaluate((caseId) => {
      const card = [...document.querySelectorAll('.case-card, .featured-card')]
        .find((c) => c.dataset.case === caseId);
      card.scrollIntoView({ block: 'center' });
      card.click();
    }, id);
    await page.waitForSelector('#doOpenBtn', { state: 'visible' });
    await page.waitForTimeout(250);
    return page.evaluate(() => ({
      сцена: !document.getElementById('caseStage').hidden,
      лента: !document.getElementById('reels').hidden,
    }));
  };

  for (const id of ['warmup_100', 'rio_1500', 'depo_20000', 'westeros_1699']) {
    const r = await обрядУ(id);
    check(`обряд: включён у кейса ${id}`, r.сцена && !r.лента, JSON.stringify(r));
  }

  const porsche = await обрядУ('porsche_999');
  check('обряд: у кейса без вырезанной обложки остаётся лента',
        !porsche.сцена && porsche.лента, JSON.stringify(porsche));

  await ensureOpenerClosed();
}

/* ---------- Совпадение ленты и результата ---------- */

const cases = ['warmup_100', 'vault_1000', 'neon_500', 'allin_500', 'deck_400', 'frost_300'];
let mismatch = 0;
let noTile = 0;
let tooClose = 0;
const stuckAfter = [];
let motionSeen = false;

for (const id of cases) {
  const r = await openCaseAndVerify(id);
  if (r.stuck.length) stuckAfter.push(`${id}: ${r.stuck.join(', ')}`);
  motionSeen ||= r.motionMounted;
  if (!r.under) { noTile++; continue; }
  // Фриспины денежной ценности не имеют: на плитке в этом месте пусто, а в
  // карточке результата стоит прочерк. Это одно и то же «денег нет», и
  // расхождением считать его нельзя - иначе проверка падает раз в несколько
  // прогонов, когда под маркер попадают именно фриспины.
  const noMoney = (v) => (v === '-' || v === '' ? '' : v);
  if (r.under.name !== r.resultName || noMoney(r.under.value) !== noMoney(r.resultValue)) {
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
check('показ выигрыша подключён', motionSeen);
check('показ выигрыша убирает за собой', stuckAfter.length === 0, stuckAfter.join('; '));

/* ---------- Просмотр предмета из состава ---------- */

/*
 * Нажатие на карточку состава показывает её крупно (inspect в motion.js).
 * Это витрина, а не выигрыш: надписи WIN быть не должно, а стоимость обязана
 * совпадать с карточкой в сетке. После закрытия ничего не висит поверх.
 */
{
  await ensureOpenerClosed();
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === 'warmup_100');
    card.scrollIntoView({ block: 'center' });
    card.click();
  });
  await page.waitForSelector('#dropsGrid .drop-card:not(.is-showcase)', { state: 'visible', timeout: 10000 });
  const gridValue = await page.evaluate(() => {
    const card = document.querySelector('#dropsGrid .drop-card:not(.is-showcase)');
    card.scrollIntoView({ block: 'center' });
    return card.querySelector('.drop-value')?.textContent.trim() || '';
  });
  await page.waitForTimeout(300);
  await page.click('#dropsGrid .drop-card:not(.is-showcase)');
  await page.waitForTimeout(1400);
  const shown = await page.evaluate(() => {
    const box = document.querySelector('.mo-inspect');
    return {
      open: !!box,
      text: box ? box.textContent : '',
      value: box?.querySelector('.mo-insp-value')?.textContent.trim() || '',
      card: !!box?.querySelector('.mo-hero'),
    };
  });
  check('просмотр предмета: открывается по нажатию на карточку состава', shown.open && shown.card);
  check('просмотр предмета: это не выигрыш, надписи WIN нет', !/WIN/.test(shown.text), shown.text.slice(0, 80));
  check('просмотр предмета: стоимость совпадает с карточкой в составе',
        shown.value.replace(/\s/g, '') === gridValue.replace(/\s/g, ''), `${shown.value} / ${gridValue}`);
  await page.click('.mo-insp-close');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    left: document.querySelectorAll('.mo-wl').length,
    receded: document.body.classList.contains('mo-receded'),
    lifted: document.querySelectorAll('.mo-lifted').length,
  }));
  check('просмотр предмета: после закрытия ничего не висит',
        !after.left && !after.receded && !after.lifted, JSON.stringify(after));
  await ensureOpenerClosed();
}

/* ---------- «Ещё раз», выпадения карточками, потолок пачки ---------- */

/*
 * «Ещё раз» крутит ту же ленту сразу: обряд с тряской положен только первому
 * открытию. Выпадения игрока на экране кейса - карточками по три в ряд,
 * нажатие показывает предмет крупно. Пачка - не больше двух кейсов.
 */
{
  await openCaseAndVerify('warmup_100');
  await page.click('#againBtn');
  await page.waitForTimeout(350);
  const again = await page.evaluate(() => ({
    shaking: document.getElementById('caseStage').classList.contains('is-shaking'),
    stage: !document.getElementById('caseStage').hidden,
    reels: !document.getElementById('reels').hidden,
  }));
  check('«Ещё раз»: без тряски кейса, сразу лента',
        !again.shaking && !again.stage && again.reels, JSON.stringify(again));
  await page.waitForFunction(() => {
    const res = document.getElementById('result');
    const btn = document.getElementById('fsCollect');
    return !res.hidden || !btn.hidden;
  }, null, { timeout: 180000 });
  while (await page.evaluate(() => !document.getElementById('fsCollect').hidden)) {
    await page.click('#fsCollect');
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(600);
  check('«Ещё раз»: кнопка той же золотой разметки, что «Открыть»',
        await page.evaluate(() => document.getElementById('againBtn').classList.contains('open-cta')));

  await page.click('#closeOpener');
  await page.waitForSelector('#histGrid .hist-card', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(700);
  // Карточки въезжают анимацией histIn (сдвиг и масштаб): мерить ряды
  // посреди неё - значит получить случайную раскладку.
  await page.evaluate(() => Promise.all([...document.querySelectorAll('#histGrid .hist-card')]
    .flatMap((c) => c.getAnimations()).map((a) => a.finished.catch(() => {}))));
  const hist = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#histGrid .hist-card')];
    const grid = document.getElementById('histGrid').getBoundingClientRect();
    const rows = new Map();
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const key = Math.round(r.top);
      (rows.get(key) || rows.set(key, []).get(key)).push(r);
    }
    const list = [...rows.values()];
    const last = list[list.length - 1];
    const left = last[0].left - grid.left;
    const right = grid.right - last[last.length - 1].right;
    const card = document.querySelector('#dropsGrid .drop-card:not(.is-showcase)').getBoundingClientRect();
    return {
      count: cards.length,
      firstRow: list[0].length,
      centered: Math.abs(left - right) <= 2,
      smaller: cards[0].getBoundingClientRect().width < card.width,
    };
  });
  check('выпадения: карточками на экране кейса', hist.count > 0, `карточек ${hist.count}`);
  check('выпадения: по три в ряд на телефоне', hist.firstRow === Math.min(3, hist.count), `в ряду ${hist.firstRow}`);
  check('выпадения: неполный ряд по центру', hist.centered);
  check('выпадения: мельче карточек состава', hist.smaller);

  await page.evaluate(() => document.querySelector('#histGrid .hist-card').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.click('#histGrid .hist-card');
  await page.waitForTimeout(1300);
  const shownHist = await page.evaluate(() => ({
    open: !!document.querySelector('.mo-inspect'),
    text: document.querySelector('.mo-inspect')?.textContent || '',
  }));
  check('выпадения: карточка открывается крупно', shownHist.open);
  check('выпадения: показ не выдаёт себя за выигрыш', !/\bWIN\b/.test(shownHist.text));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);

  // Потолок пачки: «+» дальше ×2 не ведёт.
  await page.evaluate(() => document.getElementById('countRow').scrollIntoView({ block: 'center' }));
  for (let i = 0; i < 5; i++) {
    await page.click('#countRow [data-step="1"]');
    await page.waitForTimeout(80);
  }
  const top = await page.evaluate(() => document.getElementById('countVal').textContent.replace(/\D/g, ''));
  check('пачка: не больше двух кейсов за раз', top === '2', `стоит ×${top}`);
  for (let i = 0; i < 3; i++) {
    await page.click('#countRow [data-step="-1"]');
    await page.waitForTimeout(80);
  }
  await ensureOpenerClosed();
}

/* ---------- Авто: выключается своим же числом ---------- */

/*
 * Число авто выбирается и снимается повторным нажатием, а идущая серия
 * останавливается нажатием на то же число в ряду серии: отдельная «СТОП»
 * осталась, но искать её игрок не обязан.
 */
{
  await ensureOpenerClosed();
  await page.evaluate(() => fetch('/api/freespins/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': '' },
    body: '{}',
  }).catch(() => {}));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.case-card')].find((c) => c.dataset.case === 'warmup_100');
    card.scrollIntoView({ block: 'center' });
    card.click();
  });
  await page.waitForSelector('#doOpenBtn', { state: 'visible' });
  await page.evaluate(() => document.getElementById('autoRow').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);

  const label = () => page.evaluate(() => document.getElementById('doOpenBtn').textContent.replace(/\s+/g, ' '));
  await page.click('#autoRow .auto-btn[data-auto="10"]');
  await page.waitForTimeout(150);
  const on = await label();
  await page.click('#autoRow .auto-btn[data-auto="10"]');
  await page.waitForTimeout(150);
  const off = await label();
  check('авто: число включает серию', /10 раз/.test(on), on);
  check('авто: повторное нажатие на число выключает её', !/10 раз/.test(off), off);

  await page.click('#autoRow .auto-btn[data-auto="10"]');
  await page.waitForTimeout(150);
  await page.click('#doOpenBtn');
  await page.waitForSelector('#autoRunRow .auto-btn.is-running', { state: 'visible', timeout: 10000 });
  const run = await page.evaluate(() => ({
    running: document.querySelector('#autoRunRow .is-running')?.dataset.auto,
    others: [...document.querySelectorAll('#autoRunRow .auto-btn:not(.is-running)')].every((b) => b.disabled),
  }));
  check('авто: в ряду серии подсвечено её число', run.running === '10', JSON.stringify(run));
  check('авто: другие числа во время серии не нажимаются', run.others);

  await page.waitForTimeout(600);
  await page.click('#autoRunRow .auto-btn.is-running');
  await page.waitForFunction(() => {
    const box = document.getElementById('batchSummary');
    return !box.hidden || !document.getElementById('fsCollect').hidden;
  }, null, { timeout: 180000 });
  while (await page.evaluate(() => !document.getElementById('fsCollect').hidden)) {
    await page.click('#fsCollect');
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('#batchSummary:not([hidden])', { timeout: 60000 });
  const sub = await page.evaluate(() => document.querySelector('#batchSummary .batch-sub')?.textContent.replace(/\s+/g, ' ').trim() || '');
  check('авто: нажатие на своё число останавливает серию',
        /остановлено/.test(sub) && /из 10/.test(sub), sub);
  await page.click('#autoClose');
  await page.waitForTimeout(400);
  await ensureOpenerClosed();
}

/* ---------- Маркер: стрелки, а не полоска ---------- */

{
  /*
   * Меряем на остановившейся ленте, а не во время прокрута: закрытый на ходу
   * барабан оставляет открытие недоигранным, и следующий вход в кейс приходит
   * в пустой #reels. Геометрия маркера от движения ленты всё равно не зависит.
   */
  const m = await (async () => {
    await openCaseAndVerify('warmup_100');
    return page.evaluate(() => {
      const marker = document.querySelector('#reels .reel-marker');
      if (!marker) return null;
      const r = marker.getBoundingClientRect();
      const wrap = marker.parentElement.getBoundingClientRect();
      const px = (v) => parseFloat(v) || 0;
      const top = getComputedStyle(marker, '::before');
      const bottom = getComputedStyle(marker, '::after');
      return {
        ownBg: getComputedStyle(marker).backgroundImage,
        offCenter: Math.abs(r.left + r.width / 2 - (wrap.left + wrap.width / 2)),
        topClip: top.clipPath,
        bottomClip: bottom.clipPath,
        topH: px(top.height),
        bottomH: px(bottom.height),
        topW: px(top.width),
        wrapH: wrap.height,
      };
    });
  })();

  check('маркер: на месте', !!m);
  /*
   * Полоска во всю высоту шла прямо по рисунку предмета. Её больше нет, и
   * собственный фон у маркера означал бы, что она вернулась: ширина маркера
   * теперь равна ширине стрелки, и фон залил бы прямоугольник во всю ленту.
   */
  check('маркер: полоски во всю высоту нет', m && m.ownBg === 'none', m && m.ownBg);
  check('маркер: стрелка сверху', !!m && /polygon/.test(m.topClip), m && m.topClip);
  check('маркер: стрелка снизу', !!m && /polygon/.test(m.bottomClip), m && m.bottomClip);
  check('маркер: стрелки не нулевого размера',
        !!m && m.topH > 6 && m.bottomH > 6 && m.topW > 10,
        m && `${m.topW}x${m.topH}`);
  /*
   * Стрелки указывают ровно в ту точку, по которой считается остановка
   * (центр ленты). Разъехались - игрок читает выигрыш не с той плитки.
   */
  check('маркер: стрелки по центру ленты', !!m && m.offCenter < 0.6,
        m && `смещение ${m.offCenter.toFixed(2)}`);
  // Обе стрелки вместе не должны перекрывать середину плитки с рисунком.
  check('маркер: середина плитки свободна',
        !!m && (m.topH + m.bottomH) < m.wrapH * 0.45,
        m && `${m.topH + m.bottomH} из ${m.wrapH}`);

  await ensureOpenerClosed();
}

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

  /*
   * Колесо: под самоцветом сверху обязана стоять метка того цвета, что в
   * итоге, и шар обязан лежать в той же лунке. Сверяем по ближайшей к
   * самоцвету метке и по ближайшей к шару - геометрией, а не по состоянию
   * кода: проверяется то, что видит игрок.
   */
  const r = await page.evaluate(() => {
    const center = (el) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const marks = [...document.querySelectorAll('#rouletteWheel .rw-mark')];
    const nearest = (x, y) => marks.reduce((best, m) => {
      const [mx, my] = center(m);
      const d = Math.hypot(mx - x, my - y);
      return !best || d < best.d ? { d, m } : best;
    }, null).m;
    const p = document.getElementById('roulettePointer').getBoundingClientRect();
    const underPointer = nearest(p.left + p.width / 2, p.bottom);
    const [bx, by] = center(document.getElementById('rouletteBall'));
    const underBall = nearest(bx, by);
    return {
      color: underPointer.dataset.color,
      sameSlot: underPointer.dataset.sector === underBall.dataset.sector,
      text: document.getElementById('rouletteResult').textContent.trim(),
    };
  });
  if (!r.sameSlot) {
    roulMismatch++;
    failures.push('рулетка: шар лежит не в той лунке, что под самоцветом');
  }

  const expected = { red: 'Красное', black: 'Чёрное', green: 'Зелёное' }[r.color];
  if (!r.text.startsWith(expected)) {
    roulMismatch++;
    failures.push(`рулетка: под маркером ${expected}, в результате «${r.text}»`);
  }
}
check('рулетка: сектор под самоцветом и шар совпадают с результатом', roulMismatch === 0);

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
    check('риск: правила показаны над картами', /туз среди 6 карт/.test(rules), rules.trim());
    // Числовые шансы из интерфейса убраны намеренно - проверяем, что они
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
    /*
     * Витрина живёт в своём слоте на первом экране, а не первой полкой:
     * на компьютере она встаёт справа от слайд-шоу, и переносить блок между
     * контейнерами стилями нельзя.
     *
     * На телефоне порядок обязан остаться прежним - баннер, лента, пара,
     * сезонный кейс, - поэтому проверяется не только слот, но и то, что
     * карточка идёт ниже ленты и пары.
     */
    inSlot: document.getElementById('featuredSlot')?.contains(card) ?? false,
    belowFeed: (() => {
      const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? 0;
      return card ? card.getBoundingClientRect().top > y('.promo-pair') : false;
    })(),
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
  check('сезонный: витрина лежит в своём слоте', seasonal.inSlot);
  check('сезонный: на телефоне витрина ниже ленты и пары баннеров',
    seasonal.belowFeed);
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
    // Только сетка состава: выпадения игрока ниже нарисованы теми же
    // карточками, но идут по времени, а не по цене.
    showcase: document.querySelectorAll('#dropsGrid .drop-card.is-showcase').length,
    // Витринный предмет не должен встречаться в таблице розыгрыша.
    inTable: [...document.querySelectorAll('#dropsGrid .drop-card:not(.is-showcase) .drop-name')]
      .map((n) => n.textContent.trim()),
    showcaseName: document.querySelector('#dropsGrid .drop-card.is-showcase .drop-name')?.textContent.trim() || '',
    // Числовых шансов в составе быть не должно.
    chances: document.querySelectorAll('.item-chance').length,
    badges: [...document.querySelectorAll('#dropsGrid .drop-card')].map((b) => b.textContent),
    // Состав отсортирован от дорогого к дешёвому.
    values: [...document.querySelectorAll('#dropsGrid .drop-card:not(.is-showcase) .drop-value')]
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
// Шлюз Sicilia в тестовом сервере не настроен: вкладки «СБП и карта» нет.
// display:flex у .payment-method однажды перебивал hidden - тест держит это.
check('касса: без ключей Sicilia вкладки «СБП и карта» нет',
  await page.evaluate(() => {
    const t = document.querySelector('[data-payment-method="sicilia"]');
    return !!t && getComputedStyle(t).display === 'none';
  }));
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
  partners: document.getElementById('fairPartners').hidden ? 0
    : document.querySelectorAll('#fairPartners .fair-mark svg').length,
  steps: document.querySelectorAll('#view-fair .fair-step').length,
}));
// Партнёры берутся из legal.js -> PARTNERS: сколько записей, столько знаков.
check('честность: партнёры показаны знаками', fair.partners === 2, `знаков ${fair.partners}`);
check('честность: три шага проверки', fair.steps === 3, `шагов ${fair.steps}`);
check('честность: открывается ссылкой из подвала', fair.visible);
check('честность: хеш серверного seed показан', fair.hash === 64, `длина ${fair.hash}`);
check('честность: личная статистика убрана', fair.stats === 0, `блоков ${fair.stats}`);

/* ---------- Компьютер ---------- */

/*
 * Отдельная вкладка в широком окне: телефонная вёрстка проверена выше, а
 * десктопная - это другой набор правил, и сломать её можно, ничего не задев
 * на телефоне. Ошибки консоли этой вкладки складываются в тот же список.
 */
{
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desk.on('pageerror', (e) => consoleErrors.push('DESKTOP PAGEERROR: ' + e.message));

  await desk.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('.case-card', { timeout: 15000 });
  await desk.waitForTimeout(700);
  if (await desk.isVisible('#onbBackdrop')) {
    await desk.click('#onbSkip');
    await desk.waitForTimeout(300);
  }

  check('компьютер: боковое меню показано', await desk.isVisible('#sideNav'));
  check('компьютер: меню-картинка убрана', !(await desk.isVisible('#menuBtn')));
  check('компьютер: кнопка пополнения в шапке', await desk.isVisible('#topDeposit'));

  // Считаем по разметке, а не по CSS-свойству: полка выкладывается flex-ом,
  // и число колонок из стилей уже не прочитать.
  const perRow = await desk.evaluate(() => {
    const cards = [...document.querySelector('.shelf-row').children];
    const top = Math.round(cards[0].getBoundingClientRect().top / 10);
    return cards.filter((c) => Math.round(c.getBoundingClientRect().top / 10) === top).length;
  });
  check('компьютер: в полке три кейса в ряд', perRow === 3, String(perRow));

  check('компьютер: полка выровнена по центру', await desk.evaluate(() =>
    getComputedStyle(document.querySelector('.shelf-row')).justifyContent === 'center'));
  check('компьютер: заголовок полки по центру', await desk.evaluate(() =>
    getComputedStyle(document.querySelector('.shelf-head')).textAlign === 'center'));

  // Обложка вдвое крупнее прежней - ради этого и уменьшено число колонок.
  const coverH = await desk.evaluate(() =>
    document.querySelector('.shelf-row .case-cover').getBoundingClientRect().height);
  check('компьютер: обложка крупная', coverH >= 280, `${Math.round(coverH)}px`);

  // Неполный последний ряд обязан стоять по центру, а не липнуть влево.
  check('компьютер: остаток полки выровнен по центру', await desk.evaluate(() => {
    for (const shelf of document.querySelectorAll('.shelf')) {
      const cards = [...shelf.querySelectorAll('.case-card')];
      const rows = new Map();
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const key = Math.round(r.top / 10);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(r);
      }
      const list = [...rows.values()];
      if (list.length < 2) continue;
      const last = list.at(-1);
      if (last.length === list[0].length) continue;
      const centre = (row) => (row[0].left + row.at(-1).right) / 2;
      if (Math.abs(centre(last) - centre(list[0])) > 2) return false;
    }
    return true;
  }));

  // Раздел «Честность» живёт в подвале, второго входа в меню быть не должно.
  check('компьютер: «Честности» в меню нет', await desk.evaluate(
    () => !document.querySelector('#sideNav [data-view="fair"]')));

  // Экран кейса - часть страницы, а не слой поверх неё: шапка, меню и подвал
  // обязаны остаться на месте.
  await desk.evaluate(() => document.querySelector('.case-card').click());
  await desk.waitForTimeout(1200);
  check('компьютер: на экране кейса видно боковое меню', await desk.isVisible('#sideNav'));
  check('компьютер: на экране кейса видна шапка с балансом', await desk.isVisible('#balanceChip'));
  check('компьютер: на экране кейса есть подвал', await desk.isVisible('#siteFooter'));
  check('компьютер: остальные разделы на экране кейса скрыты', await desk.evaluate(
    () => [...document.querySelectorAll('main > .view')].every((v) => !v.offsetParent)));
  // Закрываем через сам обработчик: тут проверяется вёрстка страницы, а не
  // попадание указателя, а браузерная прокрутка «к кнопке» заводит её под
  // липкую шапку и ломает клик на ровном месте.
  await desk.evaluate(() => document.getElementById('closeOpenerTop').click());
  await desk.waitForTimeout(500);

  // Боковое меню собрано по мотивам мобильного: у разделов с картинки стоят
  // вырезанные из неё же рисунки.
  check('компьютер: в боковом меню рисунки из макета',
    await desk.evaluate(() => document.querySelectorAll('#sideNav .side-art').length >= 6));
  check('компьютер: у разделов есть подписи как в макете',
    await desk.evaluate(() => document.querySelectorAll('#sideNav .side-sub').length >= 6));

  /*
   * ПЕРЕСТАНОВКА ПЕРВОГО ЭКРАНА. Слайд-шоу слева, постер сезонного кейса
   * справа, их низы сходятся; лента под ними тянется шире слайд-шоу - во всю
   * колонку содержимого.
   *
   * Низы проверяются числом, а не глазами: карточка вынута из потока именно
   * ради этого, и стоит её вернуть в поток - разъедется молча.
   */
  const row = await desk.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: b.x, w: b.width, bottom: b.bottom }; };
    return { hero: r('.hero'), card: r('.featured-card'), feed: r('.feed') };
  });
  if (row.card) {
    check('компьютер: постер кейса справа от слайд-шоу',
      row.card.x > row.hero.x + row.hero.w - 2,
      `постер на ${Math.round(row.card.x)}, баннер кончается на ${Math.round(row.hero.x + row.hero.w)}`);
    check('компьютер: низ постера сходится с низом слайд-шоу',
      Math.abs(row.card.bottom - row.hero.bottom) <= 2,
      `разбег ${Math.abs(row.card.bottom - row.hero.bottom).toFixed(1)}px`);
    check('компьютер: лента шире слайд-шоу',
      row.feed.w > row.hero.w + 40,
      `лента ${Math.round(row.feed.w)}, баннер ${Math.round(row.hero.w)}`);
    check('компьютер: лента начинается там же, где слайд-шоу',
      Math.abs(row.feed.x - row.hero.x) <= 2);
  }

  /*
   * Казино на компьютере: справа от слайд-шоу столбик Free Money над
   * «Кейсами», низы сходятся - доли ширины считаны из пропорций картинок.
   */
  await desk.click('#sideNav .side-item[data-view="casino"]');
  await desk.waitForSelector('.cz-block[data-block="popular"] .cz-tile[data-game]', { timeout: 15000 });
  await desk.waitForTimeout(600);
  const czRow = await desk.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { hero: r('#czHero'), cases: r('#czPromoCases'), fortune: r('#czPromoFortune'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check('компьютер: казино - Free Money над «Кейсами» справа от слайд-шоу',
    czRow.fortune.x > czRow.hero.right - 2 && czRow.cases.top >= czRow.fortune.bottom - 1
    && Math.abs(czRow.cases.x - czRow.fortune.x) <= 2, JSON.stringify({ h: czRow.hero.right, f: czRow.fortune.x }));
  check('компьютер: казино - низы баннеров сходятся', Math.abs(czRow.cases.bottom - czRow.hero.bottom) <= 3,
    `разбег ${Math.abs(czRow.cases.bottom - czRow.hero.bottom).toFixed(1)}px`);
  check('компьютер: казино не разъезжается вбок', czRow.overflow <= 1, `лишних ${czRow.overflow}px`);

  // В боковом меню админки быть не должно: заказчик просил убрать её оттуда.
  check('компьютер: админки в боковом меню нет',
    await desk.evaluate(() => !document.querySelector('#sideNav [data-view="admin"]')));
  check('компьютер: у плиток меню есть стрелка',
    await desk.evaluate(() => document.querySelectorAll('#sideNav .side-go').length >= 6));

  // Баланс и разделы бок о бок - главная причина, по которой десктоп ломается
  // незаметно: правило с идентификатором перебивает .view{display:none}.
  await desk.click('#sideNav .side-item[data-view="crash"]');
  await desk.waitForTimeout(400);
  check('компьютер: касса не показывается поверх других разделов',
    !(await desk.isVisible('#view-wallet')));
  check('компьютер: раздел подсвечен в боковом меню', await desk.evaluate(
    () => document.querySelector('#sideNav .side-item.active')?.dataset.view === 'crash'));

  await desk.click('#sideNav .side-item[data-view="wallet"]');
  await desk.waitForTimeout(500);
  check('компьютер: касса открывается сразу на пополнении',
    await desk.evaluate(() => !document.getElementById('walletDepositPane').hidden));
  check('компьютер: касса в две колонки', await desk.evaluate(
    () => getComputedStyle(document.getElementById('view-wallet'))
      .gridTemplateColumns.split(' ').length === 2));

  // Ширина контента ограничена: без предела строка растягивается на весь
  // монитор и читать её невозможно.
  const mainWidth = await desk.evaluate(() => document.querySelector('main').getBoundingClientRect().width);
  check('компьютер: ширина контента ограничена', mainWidth <= 1400, String(Math.round(mainWidth)));

  // Горизонтальной прокрутки быть не должно ни на одном разделе.
  const overflow = await desk.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('компьютер: страница не разъезжается вбок', overflow <= 1, `лишних ${overflow}px`);

  await desk.close();
}

/* ---------- Казино ---------- */

/*
 * Лобби по образцу 1Win: меню вкладок, баннеры, поиск и «Провайдеры», чипы,
 * блоки-ленты с «Популярными» первыми. Главное, что здесь проверяется, -
 * обратный путь: со страницы провайдера «Назад» ведёт к выбору провайдеров,
 * а не в лобби (на этом заказчик и споткнулся).
 */
{
  await ensureOpenerClosed();
  await page.click('#brandHome');
  await page.waitForTimeout(300);

  /*
   * Обложка, которой нет на CDN: сервер отвечает 404, и плитка обязана
   * показать горизонтальную обложку, а без неё - исчезнуть, но не стоять
   * со знаком вопроса. Подменяем ответ для игры витрины (с сервером; в
   * файле сборки обложки идут с CDN, и подменять там нечего).
   */
  const onServer = await page.evaluate(() => location.protocol.startsWith('http'));
  let brokenId = null;
  // Только вертикальная, и с повтором тоже: запасная горизонтальная (?w=1)
  // пусть грузится.
  const brokenCover = (url) => brokenId && url.pathname === `/casino/cover/${encodeURIComponent(brokenId)}`
    && url.searchParams.get('w') !== '1';
  if (onServer) {
    brokenId = await page.evaluate(() => fetch('/api/casino/games', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': '' },
      body: JSON.stringify({ kind: 'slots', limit: 3 }) })
      .then((r) => r.json()).then((d) => d.games[2].id));
    await page.route(brokenCover, (route) => route.fulfill({ status: 404, body: '' }));
  }

  await page.evaluate(() => document.getElementById('promoCasino').scrollIntoView({ block: 'center' }));
  await page.click('#promoCasino');
  await page.waitForSelector('.cz-block[data-block="popular"] .cz-tile[data-game]', { timeout: 15000 });
  await page.waitForTimeout(500);

  // Сверяем то, что видно глазами: две строки ленты, как на скриншоте заказчика.
  const featured = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.cz-block[data-block="popular"] .cz-tile[data-game]')].slice(0, 6);
    const rows = new Map();
    for (const t of tiles) {
      const top = Math.round(t.getBoundingClientRect().top);
      if (!rows.has(top)) rows.set(top, []);
      rows.get(top).push([t.getBoundingClientRect().left, t.querySelector('.cz-name').textContent]);
    }
    return [...rows.entries()].sort((a, b) => a[0] - b[0])
      .map(([, r]) => r.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('|'));
  });
  check('казино: «Популярные» открывает витрина заказчика, как на его скриншоте',
    featured[0] === 'Gates of Olympus|Sugar Rush|The Dog House'
    && featured[1] === 'Sweet Bonanza|Starlight Princess|Big Bass Bonanza', featured.join(' / '));
  if (brokenId) {
    // Либо горизонтальная запасная, либо плитки нет вовсе - но не знак вопроса.
    await page.waitForFunction((id) => {
      const t = document.querySelector(`.cz-block[data-block="popular"] .cz-tile[data-game="${CSS.escape(id)}"]`);
      return !t || t.dataset.fallback;
    }, brokenId, { timeout: 15000 }).catch(() => {});
    const fb = await page.evaluate((id) => {
      const t = document.querySelector(`.cz-block[data-block="popular"] .cz-tile[data-game="${CSS.escape(id)}"]`);
      if (!t) return { removed: true };
      const imgs = [...t.querySelectorAll('img')];
      return { fallback: t.dataset.fallback || '', wide: t.querySelector('.cz-art').classList.contains('is-wide'),
        src: imgs[0]?.getAttribute('src') || '', loaded: imgs.every((i) => i.complete && i.naturalWidth > 0) };
    }, brokenId);
    check('казино: пропавшая обложка заменяется горизонтальной, иначе плитка убирается',
      fb.removed || (fb.fallback === 'alt' && fb.wide && /\?w=1$/.test(fb.src)), JSON.stringify(fb));
    await page.unroute(brokenCover);
  }

  const lobby = await page.evaluate(() => {
    const pop = document.querySelector('.cz-block[data-block="popular"]');
    const tiles = [...pop.querySelectorAll('.cz-tile[data-game]')];
    const art = tiles[0].querySelector('.cz-art').getBoundingClientRect();
    return {
      seg: [...document.querySelectorAll('#czSeg .cz-seg-btn')].map((t) => t.textContent.trim()),
      selected: document.querySelector('#czSeg [aria-selected="true"]')?.textContent.trim(),
      firstBlock: document.querySelector('#czBody .cz-block')?.dataset.block,
      blocks: document.querySelectorAll('#czBody .cz-block').length,
      popular: tiles.length,
      rows: new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size,
      ratio: art.height / art.width,
      chips: [...document.querySelectorAll('#czChips .cz-chip')].map((c) => c.textContent.trim()),
      az: /А[-\u2013]Я|A-Z/.test(document.getElementById('view-casino').textContent),
      banners: !document.getElementById('czBanners').hidden,
      slides: document.querySelectorAll('#czHero .hero-img').length,
      jackpot: document.querySelector('#czHero .hero-img')?.alt || '',
      pair: !!document.querySelector('#czPromoFortune') && !!document.querySelector('#czPromoCases'),
      provBlocks: document.querySelectorAll('#czBody .cz-block[data-block^="provider:"]').length,
      note: document.querySelector('.cz-note')?.textContent || '',
    };
  });
  check('казино: меню Слоты / Live казино / Быстрые игры', lobby.seg.join('|') === 'Слоты|Live казино|Быстрые игры',
        lobby.seg.join(' / '));
  check('казино: открывается на слотах', lobby.selected === 'Слоты', lobby.selected);
  check('казино: первым блоком «Популярные»', lobby.firstBlock === 'popular', lobby.firstBlock);
  check('казино: в «Популярных» 10-20 игр в две строки', lobby.popular >= 10 && lobby.popular <= 20 && lobby.rows === 2,
        `${lobby.popular} игр, строк ${lobby.rows}`);
  check('казино: плитка 3:4, а не во всю строку', Math.abs(lobby.ratio - 4 / 3) < 0.03, lobby.ratio.toFixed(3));
  check('казино: несколько тематических блоков', lobby.blocks >= 5, String(lobby.blocks));
  check('казино: блоки провайдеров в лобби', lobby.provBlocks > 0, String(lobby.provBlocks));
  check('казино: чипы начинаются с «Лобби» и «Популярных»', lobby.chips[0] === 'Лобби' && lobby.chips[1] === 'Популярные',
        lobby.chips.slice(0, 3).join(' / '));
  check('казино: сортировки «А-Я» нет', !lobby.az);
  check('казино: баннеры главной в лобби', lobby.banners && lobby.slides === 4 && /джекпоты/i.test(lobby.jackpot) && lobby.pair,
        `${lobby.slides} слайдов, первый ${lobby.jackpot}`);
  check('казино: отдача под лобби из настройки', /70%/.test(lobby.note), lobby.note);

  // Лента блока листается и не раздвигает страницу.
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('казино: ленты не раздвигают страницу вбок', overflowX <= 1, `лишних ${overflowX}px`);

  // Вкладки: Live честно пустая, пока агрегатор не отдаёт столы.
  const liveCount = await page.evaluate(() => fetch('/api/casino/lobby', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': '' }, body: '{}' })
    .then((r) => r.json()).then((d) => d.counts?.live || 0).catch(() => 0));
  await page.click('#czSeg [data-kind="live"]');
  // [data-block]: у силуэтов загрузки тот же класс блока, но без имени.
  await page.waitForFunction(() => document.querySelector('#czBody .cz-block[data-block], #czBody .cz-soon'), null, { timeout: 15000 });
  const live = await page.evaluate(() => ({ soon: !!document.querySelector('#czBody .cz-soon'),
    blocks: document.querySelectorAll('#czBody .cz-block[data-block]').length }));
  check('казино: Live - столы или честная строка «готовится»', liveCount > 0 ? live.blocks > 0 : live.soon,
        `столов ${liveCount}, ${JSON.stringify(live)}`);

  await page.click('#czSeg [data-kind="fast"]');
  await page.waitForSelector('.cz-block[data-block="popular-fast"] .cz-tile[data-game]', { timeout: 15000 });
  const fastNames = await page.evaluate(() => [...document.querySelectorAll('#czBody .cz-name')].map((n) => n.textContent));
  check('казино: быстрые игры своей вкладкой', fastNames.some((n) => /aviator/i.test(n)), fastNames.slice(0, 4).join(' | '));
  const fastPopular = await page.evaluate(() => [...document.querySelectorAll(
    '.cz-block[data-block="popular-fast"] .cz-tile[data-game] .cz-name')].map((n) => n.textContent));
  check('казино: Balloon в конце быстрых игр', fastPopular[fastPopular.length - 1] === 'Balloon', fastPopular.join(' | '));
  check('казино: чипы новой вкладки видны с начала',
    await page.evaluate(() => document.getElementById('czChips').scrollLeft === 0));

  await page.click('#czSeg [data-kind="slots"]');
  await page.waitForSelector('.cz-block[data-block="popular"] .cz-tile[data-game]', { timeout: 15000 });

  // Категория: «Все» блока - полный список, баннеры уходят, «Назад» - в лобби.
  await page.click('#czChips [data-chip="megaways"]');
  await page.waitForFunction(() => document.querySelectorAll('#czGrid .cz-tile[data-game]').length > 0, null, { timeout: 15000 });
  const cat = await page.evaluate(() => ({
    names: [...document.querySelectorAll('#czGrid .cz-name')].map((n) => n.textContent),
    banners: document.getElementById('czBanners').hidden,
    title: document.querySelector('.cz-listtitle')?.textContent.trim(),
    pressed: document.querySelector('#czChips [aria-pressed="true"]')?.dataset.chip,
  }));
  check('казино: категория из своих игр', cat.names.length > 0 && cat.names.every((n) => /megaways/i.test(n)),
        cat.names.slice(0, 3).join(' | '));
  check('казино: в категории баннеры спрятаны, чип выбран', cat.banners && cat.pressed === 'megaways' && cat.title === 'Megaways',
        JSON.stringify({ b: cat.banners, p: cat.pressed, t: cat.title }));
  const shown = cat.names.length;
  if (!(await page.isHidden('#czMoreBtn'))) {
    await page.click('#czMoreBtn');
    await page.waitForFunction((n) => document.querySelectorAll('#czGrid .cz-tile[data-game]').length > n, shown, { timeout: 15000 });
    check('казино: «Показать ещё» догружает категорию',
      await page.evaluate((n) => document.querySelectorAll('#czGrid .cz-tile[data-game]').length > n, shown));
  }
  await page.click('.cz-listhead [data-back]');
  await page.waitForSelector('.cz-block[data-block="popular"]', { timeout: 10000 });
  check('казино: из категории «Назад» в лобби', await page.evaluate(() => !document.getElementById('czBanners').hidden));

  // Провайдеры: сетка знаков, провайдер, и обратно К ВЫБОРУ провайдеров.
  await page.click('#czProvBtn');
  await page.waitForSelector('.cz-pgrid .cz-pcard', { timeout: 10000 });
  // Знаки грузятся параллельно с обложками лобби: ждём загрузку, а не время.
  await page.waitForFunction(() => [...document.querySelectorAll('.cz-pgrid img.cz-plogo')].every((i) => i.complete),
    null, { timeout: 15000 }).catch(() => {});
  const provs = await page.evaluate(() => ({
    cards: document.querySelectorAll('.cz-pgrid .cz-pcard').length,
    logos: [...document.querySelectorAll('.cz-pgrid img.cz-plogo')].filter((i) => i.complete && i.naturalWidth > 0).length,
    words: document.querySelectorAll('.cz-pgrid .cz-pword').length,
  }));
  check('казино: выбор провайдера - сетка', provs.cards > 20, String(provs.cards));
  check('казино: у провайдеров знаки, у остальных название', provs.logos >= 15 && provs.logos + provs.words === provs.cards,
        JSON.stringify(provs));

  await page.click('.cz-pcard[data-provider="hacksaw"]');
  await page.waitForFunction(() => document.querySelectorAll('#czGrid .cz-tile[data-game]').length > 0, null, { timeout: 20000 });
  const prov = await page.evaluate(() => ({
    title: document.querySelector('.cz-listtitle img')?.alt || document.querySelector('.cz-listtitle')?.textContent.trim(),
    provs: [...new Set([...document.querySelectorAll('#czGrid .cz-prov')].map((n) => n.textContent))],
  }));
  check('казино: страница провайдера только его игры', prov.title === 'Hacksaw' && prov.provs.join() === 'Hacksaw',
        JSON.stringify(prov));

  await page.click('#czGrid .cz-tile[data-game] >> nth=0');
  await page.waitForTimeout(500);
  const sheet = await page.evaluate(() => ({
    open: !document.getElementById('czSheet').hidden,
    rtp: document.getElementById('czSheetRtp').textContent,
    name: document.getElementById('czSheetName').textContent,
  }));
  check('казино: плитка открывает окно запуска', sheet.open && sheet.name.length > 0, JSON.stringify(sheet));
  check('казино: в окне запуска отдача игры', sheet.rtp === '70%', sheet.rtp);

  expectRefusal = true;
  await page.click('#czPlay');
  await page.waitForTimeout(1200);
  expectRefusal = false;
  const launched = await page.evaluate(() => ({
    frame: !document.getElementById('czFrame').hidden,
    toast: document.querySelector('.toast')?.textContent || '',
  }));
  check('казино: без ключа агрегатора экран игры не открывается', !launched.frame);
  check('казино: отказ запуска виден игроку', launched.toast.length > 0, launched.toast);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('казино: окно запуска закрывается Esc', await page.evaluate(() => document.getElementById('czSheet').hidden));

  await page.click('.cz-listhead [data-back]');
  await page.waitForTimeout(400);
  check('казино: с провайдера «Назад» - к выбору провайдеров',
    await page.evaluate(() => document.querySelectorAll('.cz-pgrid .cz-pcard').length > 20));
  // Выбор другого провайдера после возврата - тот самый путь, что ломался.
  await page.click('.cz-pcard[data-provider="nolimitcity"]');
  await page.waitForFunction(() => document.querySelectorAll('#czGrid .cz-tile[data-game]').length > 0, null, { timeout: 20000 });
  check('казино: после возврата выбирается другой провайдер',
    await page.evaluate(() => [...document.querySelectorAll('#czGrid .cz-prov')].every((n) => n.textContent === 'NolimitCity')));
  await page.click('.cz-listhead [data-back]');
  await page.waitForSelector('.cz-pgrid', { timeout: 5000 });
  await page.click('.cz-listhead [data-back]');
  await page.waitForSelector('.cz-block[data-block="popular"]', { timeout: 10000 });
  check('казино: от выбора провайдеров «Назад» - в лобби',
    await page.evaluate(() => !document.getElementById('czBanners').hidden && !document.querySelector('.cz-pgrid')));

  // Поиск открывает свой экран, пустое поле возвращает в лобби.
  await page.fill('#czQ', 'sweet bonanza');
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll('#czGrid .cz-tile[data-game] .cz-name')];
    return names.length > 0 && names.length < 48;
  }, null, { timeout: 20000 }).catch(() => {});
  const found = await page.evaluate(() => [...document.querySelectorAll('#czGrid .cz-name')].map((n) => n.textContent));
  check('казино: поиск оставляет только найденное', found.length > 0 && found.every((n) => /sweet bonanza/i.test(n)),
        found.slice(0, 4).join(' | '));
  await page.fill('#czQ', '');
  await page.waitForSelector('.cz-block[data-block="popular"]', { timeout: 10000 });
  check('казино: пустой поиск возвращает в лобби', await page.evaluate(() => !document.getElementById('czBanners').hidden));

  // «Кейсы» на месте «Казино»: из казино ведём в кейсы.
  await page.click('#czPromoCases');
  await page.waitForTimeout(400);
  check('казино: баннер «Кейсы» ведёт к кейсам',
    await page.evaluate(() => document.getElementById('view-cases').classList.contains('active')));

  // «Честность»: отдача казино из той же настройки.
  await page.evaluate(() => document.querySelector('[data-view="fair"]')?.click());
  await page.waitForTimeout(500);
  const fair = await page.evaluate(() => ({
    shown: !document.getElementById('fairCasino').hidden,
    rtp: document.getElementById('fairCasinoRtp').textContent,
  }));
  check('честность: карточка казино с отдачей', fair.shown && fair.rtp === '70%', JSON.stringify(fair));
  await page.click('#brandHome');
  await page.waitForTimeout(300);
}

/* ---------- Мини-игр нет ---------- */

{
  const left = await page.evaluate(() => ({
    view: !!document.getElementById('view-mini'),
    links: document.querySelectorAll('[data-view="mini"]').length,
  }));
  check('мини-игр нет: раздела нет в разметке', !left.view);
  check('мини-игр нет: ни один пункт меню на них не ведёт', left.links === 0, `ссылок ${left.links}`);
}

/* ---------- Слоты ---------- */

/*
 * Раздел выключен по умолчанию (`games_slots` в server/settings-defs.js), и
 * первая проверка именно об этом: выключенного раздела не должно быть видно
 * НИГДЕ. Раньше фильтр по выключателю стоял только у боковой панели, и на
 * телефоне плитка меню оставалась на месте.
 *
 * Дальше слоты включаются через ту же ручку, что и панель настроек, страница
 * перезагружается, и весь раздел проверяется целиком. Прятать раздел и
 * заодно перестать его проверять было бы худшим из возможных решений: он
 * остаётся в коде и обязан работать в ту минуту, когда галочку вернут.
 */
slotChecks: {
  const hidden = await page.evaluate(() => ({
    menuTile: document.querySelectorAll('#menuExtra [data-view="slots"]').length,
    sideNav: document.querySelectorAll('#sideNav [data-view="slots"]').length,
  }));
  check('слоты: выключенный раздел не показан в меню телефона', hidden.menuTile === 0,
        `плиток ${hidden.menuTile}`);
  check('слоты: выключенный раздел не показан в боковой панели', hidden.sideNav === 0,
        `пунктов ${hidden.sideNav}`);

  // Включаем тем же способом, каким это делает панель настроек.
  await page.evaluate(() => fetch('/api/admin/settings/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch: { games_slots: true } }),
  }).then((r) => r.json()).catch(() => null));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => document.getElementById('onbBackdrop')?.remove());

  const enabled = await page.evaluate(() =>
    document.querySelectorAll('[data-view="slots"]').length > 0);

  /*
   * Не молчаливый пропуск, а понятная ошибка. Включить раздел может только
   * сотрудник с правом settings.manage, и если прогон идёт по серверу, где
   * тестовый игрок не владелец, проверки слотов просто не состоятся - об
   * этом надо сказать вслух, а не отрапортовать зелёным.
   */
  if (!check('слоты: раздел удалось включить для проверки', enabled,
             'нужен сервер с ADMIN_TG_IDS=999000001, иначе настройки закрыты правом')) {
    break slotChecks;
  }

  await page.evaluate(() => document.querySelector('[data-view="slots"]')?.click());
  await page.waitForTimeout(1200);

  const shelf = await page.evaluate(() => ({
    cards: document.querySelectorAll('.sl-card').length,
    covers: [...document.querySelectorAll('.sl-card-cover')].every((i) => i.complete && i.naturalWidth > 0),
    names: [...document.querySelectorAll('.sl-card-name')].map((n) => n.textContent.trim()),
    ids: [...document.querySelectorAll('[data-slot]')].map((n) => n.dataset.slot),
  }));

  check('слоты: на полке больше одной игры', shelf.cards >= 2, `${shelf.cards}`);
  check('слоты: обложки загрузились', shelf.covers);
  check('слоты: названия английские', shelf.names.every((n) => /^[A-Z ]+$/.test(n)),
        shelf.names.join(' | '));
  check('слоты: идентификаторы не повторяются',
        new Set(shelf.ids).size === shelf.ids.length);

  /*
   * Каждая игра проверяется отдельно: они отличаются таблицей, лентами и
   * оформлением, и половина ошибок вылезает именно там, где игры расходятся.
   */
  for (const slotId of shelf.ids) {
    await page.evaluate((id) => {
      document.querySelector('[data-act="shelf"]')?.click();
      setTimeout(() => document.querySelector(`[data-slot="${id}"]`)?.click(), 60);
    }, slotId);
    await page.waitForTimeout(1500);

    const built = await page.evaluate(() => ({
      reels: document.querySelectorAll('.sl-reel').length,
      jackpots: document.querySelectorAll('.sl-jp').length,
      pays: document.querySelectorAll('.sl-card-panel .sl-pay').length,
      symbolsLoaded: [...document.querySelectorAll('.sl-reel .sl-sym')]
        .every((i) => i.complete && i.naturalWidth > 0),
      logo: document.querySelector('.sl-logo')?.naturalWidth > 0,
      theme: document.getElementById('slotStage')?.dataset.theme,
      spin: Boolean(document.getElementById('slotSpin')),
      cells: document.querySelectorAll('.sl-reel:first-child .sl-cell').length,
    }));

    check(`${slotId}: пять барабанов`, built.reels === 5, `${built.reels}`);
    check(`${slotId}: четыре джекпота`, built.jackpots === 4, `${built.jackpots}`);
    check(`${slotId}: таблица выплат собрана`, built.pays >= 10, `${built.pays}`);
    check(`${slotId}: символы загрузились`, built.symbolsLoaded);
    check(`${slotId}: логотип загрузился`, built.logo);
    check(`${slotId}: тема проставлена`, Boolean(built.theme), String(built.theme));
    check(`${slotId}: кнопка прокрута есть`, built.spin);

    /*
     * В разметке живёт окно из нескольких ячеек, а не вся лента. У второй
     * игры лента длиной больше сотни позиций, и выложенная целиком она
     * означала бы шестьсот картинок на экран.
     */
    check(`${slotId}: лента виртуальная, а не выложена целиком`,
          built.cells > 3 && built.cells <= 12, `${built.cells} ячеек`);

    /*
     * ГЛАВНАЯ ПРОВЕРКА РАЗДЕЛА: барабан встал РОВНО на символе, и встал на
     * том, что решил сервер.
     *
     * Ответ снимается перехватом fetch, а не ожиданием сетевого ответа: в
     * автономной сборке сети нет вовсе, там fetch отвечает заглушкой, и
     * waitForResponse не дождался бы ничего.
     */
    await page.evaluate(() => {
      const real = window.fetch;
      window.__slotAnswer = null;
      window.fetch = async (...args) => {
        const res = await real(...args);
        if (String(args[0]).includes('/api/slot/spin')) {
          window.__slotAnswer = await res.clone().json();
        }
        return res;
      };
    });
    await page.evaluate(() => document.getElementById('slotSpin').click());
    await page.waitForTimeout(3600);
    const answer = await page.evaluate(() => window.__slotAnswer);
    // Если ответа нет, говорим, почему кнопка промолчала: открытое окно,
    // выключенная кнопка или подсказка, - иначе остаётся гадать.
    const why = answer ? '' : await page.evaluate(() => JSON.stringify({
      modal: !document.getElementById('slotModal')?.hidden && document.getElementById('slotModal')?.textContent.trim().slice(0, 80),
      disabled: document.getElementById('slotSpin')?.disabled,
      toast: document.getElementById('toast')?.hidden ? '' : document.getElementById('toast')?.textContent.trim(),
      balance: document.getElementById('slotBalance')?.textContent,
    }));
    check(`${slotId}: сервер ответил на прокрут`, Boolean(answer && answer.offsets), why);

    const landed = await page.evaluate(() => [...document.querySelectorAll('.sl-reel')].map((el) => {
      const strip = el.querySelector('.sl-strip');
      const cell = strip.firstElementChild.getBoundingClientRect().height;
      const m = /translate3d\(0px, (-?[\d.]+)px/.exec(strip.style.transform) || [];
      const shift = Math.abs(Number(m[1] || 0));
      return {
        cell: Math.round(cell),
        rest: cell ? shift / cell : 1,
        window: [0, 1, 2].map((r) => strip.children[r].dataset.sym),
      };
    }));

    check(`${slotId}: высота ячейки снята с разметки`,
          landed.every((r) => r.cell > 20), landed.map((r) => r.cell).join('/'));
    check(`${slotId}: лента встала ровно на символе`,
          landed.every((r) => r.rest < 0.02), landed.map((r) => r.rest.toFixed(3)).join('/'));
    check(`${slotId}: на экране ровно та сетка, которую прислал сервер`,
          Boolean(answer) && landed.every((r, i) => r.window.join() === answer.grid[i].join()),
          JSON.stringify(landed.map((r) => r.window)));

    // Окно крупного выигрыша могло открыться поверх: закрываем.
    await page.evaluate(() => {
      const box = document.getElementById('slotModal');
      if (box && !box.hidden) document.querySelector('[data-act="modal-close"]')?.click();
    });
    await page.waitForTimeout(300);
  }

  /* ---------- Панель и окна: один раз, на последней игре ---------- */

  const betNow = () => page.evaluate(() =>
    Number(document.getElementById('slotBet').textContent.replace(/[^\d]/g, '')));
  const bet0 = await betNow();
  await page.evaluate(() => document.querySelector('[data-act="bet-up"]').click());
  const bet1 = await betNow();
  check('слоты: ставка растёт по списку', bet1 > bet0, `${bet0} -> ${bet1}`);

  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) document.querySelector('[data-act="bet-down"]').click();
  });
  const betMin = await betNow();
  check('слоты: минимальная ставка не падает ниже нуля', betMin > 0, `${betMin}`);

  /*
   * Цена покупки бонуса на экране обязана совпадать с ценой, посчитанной из
   * матожидания. Несовпадение значит, что окно показывает одну сумму, а
   * спишется другая.
   */
  await page.evaluate(() => document.querySelector('[data-act="buy"]').click());
  await page.waitForTimeout(350);
  const buy = await page.evaluate(() => ({
    open: !document.getElementById('slotModal').hidden,
    price: Number(document.querySelector('.sl-buy-price')?.textContent.replace(/[^\d]/g, '')),
    hasCancel: /ОТМЕНА/.test(document.getElementById('slotModalBody').textContent),
  }));
  const openId = await page.evaluate(() => document.getElementById('slotStage')?.dataset.slotId);
  const conf = await page.evaluate((id) => fetch('/api/slot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: id }),
  }).then((r) => r.json()).catch(() => null), openId);

  check('слоты: окно покупки бонуса открылось', buy.open);
  check('слоты: в окне покупки есть отмена', buy.hasCancel);
  check('слоты: цена покупки посчитана из матожидания',
        Boolean(conf) && buy.price === conf.slot.buyBonusPrice * betMin,
        `${buy.price} против ${conf ? conf.slot.buyBonusPrice * betMin : '?'}`);
  await page.evaluate(() => document.querySelector('[data-act="modal-close"]').click());

  // Меню, правила, настройки, история, выбор ставки, автоигра.
  for (const [act, needle] of [
    ['menu', 'Правила игры'],
    ['rules', 'SCATTER'],
    ['paytable', 'WILD'],
    ['settings', 'Анимация'],
    ['history', 'ИСТОРИЯ'],
    ['bet-pick', 'ВЫБЕРИТЕ СТАВКУ'],
    ['auto', 'ОСТАНОВИТЬ'],
  ]) {
    await page.evaluate((a) => document.querySelector(`[data-act="${a}"]`)?.click(), act);
    await page.waitForTimeout(280);
    const text = await page.evaluate(() => document.getElementById('slotModalBody')?.textContent || '');
    check(`слоты: окно «${act}» открывается`, text.includes(needle), text.slice(0, 60));
    await page.evaluate(() => document.querySelector('[data-act="modal-close"]')?.click());
    await page.waitForTimeout(150);
  }

  // Настройки переживают перезагрузку окна: они в localStorage.
  await page.evaluate(() => document.querySelector('[data-act="settings"]').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('[data-opt="fast"]').click());
  await page.waitForTimeout(150);
  const stored = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('luckybox.slot.settings') || '{}'); }
    catch { return {}; }
  });
  check('слоты: настройки сохраняются', stored.fast === true, JSON.stringify(stored));
  await page.evaluate(() => document.querySelector('[data-act="settings-reset"]').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="modal-close"]')?.click());

  // История пополняется после прокрута.
  check('слоты: прокрут попал в историю',
        await page.evaluate(() => document.querySelectorAll('.sl-history-row').length) > 0);

  // Раздел не разъезжается вбок на телефоне.
  const wide = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('слоты: страница не разъезжается вбок', wide <= 1, `лишних ${wide}px`);

  /*
   * Возвращаем выключатель как был. Прогон не имеет права оставлять площадку
   * в другом состоянии, чем застал: следующий тест ходит в тот же сервер.
   */
  await page.evaluate(() => fetch('/api/admin/settings/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch: { games_slots: false } }),
  }).then((r) => r.json()).catch(() => null));
}

/* ---------- Вход на сайт: гость, регистрация, выход ---------- */

/*
 * Отдельное окно браузера, чтобы не трогать игрока основного прогона. На
 * сервере гостя делает заголовок X-Dev-Anon (без него DEV_MODE пускает любого
 * тестовым игроком), в автономном файле - выход: заглушка помнит его в
 * localStorage, а у нового окна хранилище своё.
 */
{
  const isFile = URL_TARGET.startsWith('file:');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: isFile ? {} : { 'X-Dev-Anon': '1' },
  });
  const g = await ctx.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
  await g.waitForSelector('.case-card', { timeout: 15000 });
  if (isFile) {
    await g.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
    await g.reload({ waitUntil: 'domcontentloaded' });
    await g.waitForSelector('.case-card', { timeout: 15000 });
  }
  await g.waitForTimeout(400);

  check('гость: в шапке «Войти» и «Регистрация»', await g.isVisible('#topAuth'));
  check('гость: баланса в шапке нет', !(await g.isVisible('#balanceChip')));
  check('гость: окно входа само не открывается', !(await g.isVisible('#authBackdrop')));

  // Открыть кейс без аккаунта нельзя: вместо кассы и тоста - окно входа.
  await g.evaluate(() => document.querySelector('.case-card').click());
  await g.waitForTimeout(500);
  await g.evaluate(() => document.getElementById('openBtn')?.click());
  await g.waitForTimeout(500);
  check('гость: попытка открыть кейс зовёт ко входу', await g.isVisible('#authBackdrop'));
  check('гость: первым предлагается регистрация',
    (await g.textContent('#authTitle')) === 'Регистрация');

  // Без галочки 18+ форма не уходит.
  await g.fill('#authNick', 'Гость');
  await g.fill('#authEmail', `ui${Date.now()}@mail.ru`);
  await g.fill('#authPassword', 'secret123');
  await g.click('#authSubmit');
  await g.waitForTimeout(300);
  check('регистрация: без 18+ не проходит',
    /18/.test(await g.textContent('#authError')) && await g.isVisible('#authBackdrop'));

  await g.check('#authAdult');
  await g.click('#authSubmit');
  await g.waitForTimeout(900);
  check('регистрация: окно закрылось', !(await g.isVisible('#authBackdrop')),
    await g.textContent('#authError'));

  // Шапка игрока видна на главной: экран кейса её перекрывает намеренно.
  await g.reload({ waitUntil: 'domcontentloaded' });
  await g.waitForSelector('.case-card', { timeout: 15000 });
  await g.waitForTimeout(500);
  if (await g.isVisible('#onbSkip')) await g.click('#onbSkip');
  check('после входа: баланс вместо кнопок входа',
    await g.isVisible('#balanceChip') && !(await g.isVisible('#topAuth')));

  await g.click('#accountBtn');
  await g.waitForTimeout(300);
  check('профиль: открывается и показывает почту',
    await g.isVisible('#authAccount') && /@mail\.ru/.test(await g.textContent('#accEmail')));
  // Выход перезагружает страницу: ждём именно новую загрузку, а не старые плитки.
  await Promise.all([g.waitForEvent('load'), g.click('#accLogout')]);
  await g.waitForSelector('.case-card', { timeout: 15000 });
  await g.waitForTimeout(500);
  check('выход: снова гость', await g.isVisible('#topAuth') && !(await g.isVisible('#balanceChip')));

  check('вход: нет ошибок скрипта', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

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
