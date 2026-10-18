/**
 * Сквозной тест серверного API.
 *
 * Проверяет не «отвечает ли эндпоинт», а арифметику: сходится ли баланс,
 * тратится ли ваучер, нельзя ли рискнуть одним выигрышем дважды, закрыт ли
 * админский доступ для обычного игрока.
 *
 * Запуск: node test/api.mjs [http://localhost:3000]
 */

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3000';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; return true; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  return false;
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/*
 * Деньги тестового игрока появились правкой баланса из панели, а не
 * пополнением, и проверка заявки честно ставит красную плашку. Такую заявку
 * к выплате не пускают, пока сотрудник не подтвердит её с комментарием:
 * это и проверяем (strict), а дальше подтверждаем, чтобы пройти состояния.
 */
async function clearRisk(id, strict = false) {
  const { check: c } = (await post('/api/admin/payout/check', { id })).data;
  if (!c || c.verdict !== 'red' || c.override) return;
  if (strict) {
    const blocked = await post('/api/admin/payout/resolve', { id, status: 'processing' });
    check('красную заявку нельзя взять в работу без подтверждения',
          blocked.status === 409 && blocked.data.code === 'RISK', blocked.status);
    check('подтверждение без внятного комментария не принимается',
          (await post('/api/admin/payout/override', { id, comment: 'ок' })).status === 400);
  }
  const ok = await post('/api/admin/payout/override',
    { id, comment: 'Проверено вручную в тесте: деньги выданы сотрудником' });
  if (strict) check('подтверждение с комментарием снимает барьер', ok.status === 200, ok.status);
}

const get = async (path) => (await fetch(BASE + path)).json();

const config = await get('/api/config');

/* ---------- Живость для сторожа ---------- */
{
  const res = await fetch(BASE + '/api/health');
  const data = await res.json().catch(() => ({}));
  check('health: сервер и база отвечают', res.status === 200 && data.ok === true, JSON.stringify(data));
}
const me = (await post('/api/me')).data.user;

console.log(`Базовый адрес: ${BASE}`);
console.log(`Кейсов: ${config.cases.length}, игрок #${me.id}, админ: ${me.isAdmin}\n`);

/* ---------- Пополняем баланс для тестов ---------- */

await post('/api/admin/balance', { userId: me.id, amount: 50_000_000, note: 'тестовый прогон', asDeposit: false });

/* ---------- 1. Кейсы: арифметика баланса ---------- */

{
  const cheap = config.cases.find((c) => c.id === 'warmup_100');
  let mismatches = 0;
  let notInTable = 0;

  for (let i = 0; i < 40; i++) {
    const before = (await post('/api/me')).data.user;
    const { data } = await post('/api/open', { caseId: cheap.id });

    // Фриспины есть теперь у каждого кейса, и серия зачисляется тем же
    // ответом - без её учёта ожидание расходится каждый раз, когда она выпала.
    const fs = (data.granted || []).find((g) => g.type === 'freespins');
    const expected = before.balance - cheap.price + data.item.value + (fs ? fs.total : 0);
    if (data.balance !== expected) {
      mismatches++;
      if (mismatches === 1) {
        failures.push(`баланс после кейса: ожидалось ${expected}, получено ${data.balance}`);
      }
    }

    // Выпавший предмет обязан быть из таблицы этого кейса.
    const known = cheap.items.some((it) =>
      it.name === data.item.name || data.item.name.startsWith(it.name));
    if (!known) notInTable++;
  }

  check('кейсы: баланс сходится на 40 открытиях', mismatches === 0, `расхождений ${mismatches}`);
  check('кейсы: предметы только из таблицы кейса', notInTable === 0, `чужих ${notInTable}`);
}

/* ---------- 2. Недостаток средств ---------- */

{
  const before = (await post('/api/me')).data.user;
  await post('/api/admin/balance', { userId: me.id, amount: -before.balance, note: 'обнуление' });

  const r = await post('/api/open', { caseId: 'apex_100000' });
  check('нехватка средств: отказ 400', r.status === 400 && r.data.error === 'INSUFFICIENT_FUNDS',
        `статус ${r.status}`);

  const after = (await post('/api/me')).data.user;
  check('нехватка средств: баланс не ушёл в минус', after.balance >= 0, `баланс ${after.balance}`);

  await post('/api/admin/balance', { userId: me.id, amount: 50_000_000, note: 'возврат', asDeposit: false });
}

/* ---------- 3. Несуществующий кейс ---------- */

{
  const r = await post('/api/open', { caseId: 'нет-такого' });
  check('несуществующий кейс: 404', r.status === 404, `статус ${r.status}`);
}

/* ---------- 4. Риск-игра ---------- */

{
  // Крутим, пока не будет выигрыша, - рисковать можно только выигранным.
  let opened;
  for (let i = 0; i < 60; i++) {
    opened = (await post('/api/open', { caseId: 'vault_1000' })).data;
    if (opened.user.gambleStake > 0) break;
  }
  check('риск: ставка появляется после выигрышного прокрута', opened.user.gambleStake > 0);

  const stake = opened.user.gambleStake;
  const before = opened.balance;
  const g = (await post('/api/gamble/pick', { index: 0 })).data;

  const expected = before + (g.won ? stake * config.gamble.payout - stake : -stake);
  check('риск: баланс сходится', g.balance === expected,
        `ожидалось ${expected}, получено ${g.balance}`);
  check('риск: выплата соответствует исходу',
        g.won ? g.payout === stake * config.gamble.payout : g.payout === 0);
  check('риск: позиция туза в допустимых границах',
        g.acePosition >= 0 && g.acePosition < config.gamble.cards);

  // Повторная попытка тем же выигрышем должна быть отклонена.
  const again = await post('/api/gamble/pick', { index: 1 });
  check('риск: нельзя рискнуть дважды одним выигрышем', again.status === 400,
        `статус ${again.status}`);

  const bad = await post('/api/gamble/pick', { index: 99 });
  check('риск: некорректный индекс карты отклонён', bad.status === 400);
}

/* ---------- 4б. Апгрейд ---------- */

{
  check('апгрейд: конфигурация отдаётся клиенту',
        Array.isArray(config.upgrade?.multipliers) && config.upgrade.multipliers.length > 0);

  // Отдача обязана держаться на всех множителях, поэтому проверяем каждый.
  let balanceMismatch = 0;
  let targetMismatch = 0;
  let chanceMismatch = 0;
  let sectorMismatch = 0;

  for (const m of config.upgrade.multipliers) {
    const stake = 1000;
    const before = (await post('/api/me')).data.user.balance;
    const r = (await post('/api/upgrade', { stake, multiplier: m })).data;

    if (r.target !== Math.round(stake * m)) targetMismatch++;

    // Шанс выводится из округлённой цели: p * target === rtp * stake ровно.
    if (Math.abs(r.chance * r.target - 0.7 * stake) > 1e-6) chanceMismatch++;

    // Картинка и расчёт обязаны совпадать: исход определяется тем же роллом,
    // по которому клиент ставит указатель.
    if (r.won !== (r.fair.roll < r.chance)) sectorMismatch++;

    const expected = before - stake + (r.won ? r.target : 0);
    if (r.balance !== expected) balanceMismatch++;
  }

  check('апгрейд: цель = ставка × множитель', targetMismatch === 0, `расхождений ${targetMismatch}`);
  check('апгрейд: шанс даёт ровно 70% отдачи', chanceMismatch === 0, `расхождений ${chanceMismatch}`);
  check('апгрейд: исход совпадает с сектором указателя', sectorMismatch === 0,
        `расхождений ${sectorMismatch}`);
  check('апгрейд: баланс сходится', balanceMismatch === 0, `расхождений ${balanceMismatch}`);

  const badMult = await post('/api/upgrade', { stake: 1000, multiplier: 3.7 });
  check('апгрейд: множитель вне списка отклонён', badMult.status === 400, `статус ${badMult.status}`);

  const tiny = await post('/api/upgrade', { stake: 1, multiplier: 2 });
  check('апгрейд: ставка ниже минимальной отклонена', tiny.status === 400, `статус ${tiny.status}`);
}

/* ---------- 4в. Витрина выпадений ---------- */

{
  const feed = await get('/api/feed?limit=60');
  check('витрина: лента не пустая', Array.isArray(feed.drops) && feed.drops.length > 0,
        `записей ${feed.drops?.length}`);

  /*
   * Лента показывает и обычные выпадения, и крупные. Проверяем пропорцию, а
   * не отсечку: лента из сплошных джекпотов - та самая беда, от которой
   * уходили, но и совсем без крупных витрина теряет смысл.
   */
  const big = feed.drops.filter(
    (d) => d.multiplier >= feed.minMultiplier && d.value >= feed.minValue).length;
  const share = big / feed.drops.length;
  check('витрина: крупные есть', big > 0, `крупных ${big} из ${feed.drops.length}`);
  check('витрина: крупных меньшинство', share <= 0.55,
        `${(share * 100).toFixed(0)}% при цели ${(feed.bigShare * 100).toFixed(0)}%`);
  check('витрина: обычные есть', big < feed.drops.length,
        `обычных ${feed.drops.length - big}`);

  // Совсем мелочь в ленте выглядит поломкой, а не скромным выигрышем.
  const tooSmall = feed.drops.filter((d) => d.value < 40).length;
  check('витрина: мелочи нет', tooSmall === 0, `нарушений ${tooSmall}`);

  /*
   * Своё выпадение игрок обязан видеть в ленте наравне с выдуманными. Крутим
   * дорогой кейс, пока не выпадет что-нибудь выше порога, и ищем его в ленте.
   */
  const feedCase = config.cases.find((c) => c.id === 'vault_1000');
  let ownDrop = null;
  for (let i = 0; i < 20 && !ownDrop; i++) {
    const { data } = await post('/api/open', { caseId: feedCase.id });
    if (data.item.value >= 40) ownDrop = data.item;
  }

  if (check('витрина: удалось получить своё выпадение', !!ownDrop)) {
    const after = await get('/api/feed?limit=60');
    const mine = after.drops.filter((d) => d.real);
    check('витрина: свои выпадения попадают в ленту', mine.length > 0,
          `настоящих записей ${mine.length}`);
    check('витрина: у своей записи есть кейс',
          mine.every((d) => !!d.caseId), mine.map((d) => d.caseId).join(','));
  }

  const ids = new Set(feed.drops.map((d) => d.id));
  check('витрина: ключи записей уникальны', ids.size === feed.drops.length,
        `${ids.size} из ${feed.drops.length}`);

  // Наружу уходит только витринное - ни идентификаторов, ни балансов.
  const leaked = feed.drops.filter((d) => 'userId' in d || 'balance' in d || 'tgId' in d).length;
  check('витрина: приватные поля не утекают', leaked === 0, `утечек ${leaked}`);

  const sorted = feed.drops.every((d, i) => i === 0 || feed.drops[i - 1].at >= d.at);
  check('витрина: свежие записи первыми', sorted);
}

/* ---------- 4г. Бесплатный кейс за подписку ---------- */

{
  // Раздел выключен, пока не заданы канал, токен и кейс. Ручка обязана
  // говорить об этом внятно, а не падать.
  const state = await post('/api/free-case/state');
  check('бесплатный кейс: состояние отдаётся', state.status === 200,
        `статус ${state.status}`);
  check('бесплатный кейс: выключен без настроек',
        state.data.enabled === config.freeCase.enabled);

  if (!config.freeCase.enabled) {
    const claim = await post('/api/free-case/claim');
    check('бесплатный кейс: попытка получить отклонена с 503', claim.status === 503,
          `статус ${claim.status}`);
  }
}

/* ---------- 5. Рулетка ---------- */

{
  let mismatches = 0;
  for (let i = 0; i < 20; i++) {
    const before = (await post('/api/me')).data.user;
    const { data } = await post('/api/roulette', { bet: 100, color: 'red' });
    const expected = before.balance - 100 + data.payout;
    if (data.balance !== expected) mismatches++;

    // Цвет обязан соответствовать сектору колеса.
    if (config.roulette.wheel[data.slot] !== data.landed) mismatches += 100;
  }
  check('рулетка: баланс и цвет сектора сходятся', mismatches === 0, `расхождений ${mismatches}`);

  const bad = await post('/api/roulette', { bet: 100, color: 'фиолетовое' });
  check('рулетка: неизвестный цвет отклонён', bad.status === 400);

  const zero = await post('/api/roulette', { bet: 0, color: 'red' });
  check('рулетка: нулевая ставка отклонена', zero.status === 400);
}

/* ---------- 6. Краш ---------- */

{
  const before = (await post('/api/me')).data.user;
  const start = (await post('/api/crash/start', { bet: 500 })).data;
  check('краш: ставка списана при старте', start.balance === before.balance - 500,
        `${start.balance} vs ${before.balance - 500}`);
  check('краш: точка взрыва не уходит на клиент', start.crashPoint === undefined);

  await new Promise((r) => setTimeout(r, 700));
  const state = (await post('/api/crash/state', { roundId: start.roundId })).data;
  check('краш: состояние раунда отдаётся', ['running', 'busted'].includes(state.status),
        `статус ${state.status}`);

  const out = (await post('/api/crash/cashout', { roundId: start.roundId })).data;
  check('краш: раунд завершается', ['cashed', 'busted'].includes(out.status), `статус ${out.status}`);

  if (out.status === 'cashed') {
    check('краш: выплата = ставка × множитель',
          out.payout === Math.floor(500 * out.cashedAt),
          `${out.payout} vs ${Math.floor(500 * out.cashedAt)}`);
  }

  const twice = await post('/api/crash/cashout', { roundId: start.roundId });
  check('краш: повторный вывод отклонён', twice.status === 400, `статус ${twice.status}`);
}

/* ---------- 7. Provably fair ---------- */

{
  const before = (await post('/api/me')).data.user;
  const rot = (await post('/api/fair/rotate')).data;

  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(rot.revealedSeed).digest('hex');

  check('честность: раскрытый seed совпадает с показанным хешем',
        hash === before.fair.serverSeedHash,
        `${hash.slice(0, 16)} vs ${before.fair.serverSeedHash.slice(0, 16)}`);
  check('честность: nonce сброшен после ротации', rot.user.fair.nonce === 0);
  check('честность: новый хеш отличается от старого',
        rot.user.fair.serverSeedHash !== before.fair.serverSeedHash);

  const badSeed = await post('/api/fair/client-seed', { seed: 'плохой seed!!!' });
  check('честность: некорректный client seed отклонён', badSeed.status === 400);

  const okSeed = await post('/api/fair/client-seed', { seed: 'my-seed_1' });
  check('честность: корректный client seed принят',
        okSeed.data.user?.fair.clientSeed === 'my-seed_1');
}

/* ---------- 8. История ---------- */

{
  await post('/api/open', { caseId: 'vault_1000' });
  const filtered = (await post('/api/history', { caseTitle: 'Сейф', limit: 20 })).data.history;
  const foreign = filtered.filter((h) => h.title !== 'Сейф' || h.game !== 'case');
  check('история: фильтр по кейсу не пропускает чужое', foreign.length === 0,
        `чужих ${foreign.length}`);

  const all = (await post('/api/history', {})).data.history;
  check('история: без фильтра отдаются все игры',
        new Set(all.map((h) => h.game)).size > 1,
        `игр в истории: ${new Set(all.map((h) => h.game)).size}`);
}

/* ---------- 9. Бонус отключён ---------- */

{
  const r = await post('/api/bonus');
  check('бонус: раздача по таймеру отключена', r.status === 410 && r.data.error === 'disabled',
        `статус ${r.status}`);
  check('бонус: конфиг сообщает об отключении', config.bonus?.enabled === false);
}

/* ---------- 9b. Пачка открытий ---------- */

{
  await post('/api/admin/balance', { userId: me.id, amount: 5_000_000, note: 'пачка', asDeposit: false });
  const c = config.cases.find((x) => x.id === 'neon_500');
  const before = (await post('/api/me')).data.user;

  const r = await post('/api/open', { caseId: c.id, count: 2 });
  check('пачка: открыто ровно столько, сколько просили',
        r.data.count === 2 && r.data.opened?.length === 2, `count ${r.data.count}`);

  // Пачка ограничена двумя (решение заказчика). Просьба о большем не
  // отклоняется, а урезается до потолка.
  const over = await post('/api/open', { caseId: c.id, count: 5 });
  check('пачка: больше двух за раз не открывается',
        over.data.count === 2 && over.data.opened?.length === 2, `count ${over.data.count}`);
  check('пачка: конфиг сообщает потолок', config.maxBatch === 2, `maxBatch ${config.maxBatch}`);

  // Любое из двух открытий могло выдать серию фриспинов - она начисляется тем
  // же ответом и должна попадать в totalWon наравне с обычным предметом,
  // иначе выигрыш остальных кейсов пачки на экране выглядел бы пропавшим.
  const fsTotal = r.data.opened.reduce((s, o) =>
    s + (o.granted || []).reduce((a, g) => a + (g.type === 'freespins' ? g.total : 0), 0), 0);
  const won = r.data.opened.reduce((s, o) => s + o.item.value, 0) + fsTotal;
  check('пачка: сумма выигрышей сходится', r.data.totalWon === won);

  const expectedBalance = before.balance - r.data.totalSpent + r.data.totalWon;
  check('пачка: баланс сходится', r.data.balance === expectedBalance,
        `${r.data.balance} vs ${expectedBalance}`);

  const tooMany = await post('/api/open', { caseId: c.id, count: 99 });
  check('пачка: количество ограничено сверху', tooMany.data.count <= 2, `count ${tooMany.data.count}`);
}

/* ---------- 9c. Округление номиналов ---------- */

{
  let ugly = 0;
  for (const c of config.cases) {
    for (const it of c.items) {
      if (it.kind !== 'item') continue;
      // Шкала повторяет niceStep из cases.js: до полусотни шаг единичный,
      // иначе нижние ступени лестницы слипались бы в один номинал.
      const step = it.value < 50 ? 1 : it.value < 100 ? 5 : it.value < 1000 ? 10
                 : it.value < 10000 ? 50 : it.value < 100000 ? 500
                 : it.value < 1000000 ? 1000 : 10000;
      if (it.value % step !== 0) ugly++;
    }
  }
  check('номиналы округлены по шагу', ugly === 0, `не округлено ${ugly}`);

  // Подарочный кейс должен быть сопоставим по цене с выдающим.
  let offBand = 0;
  for (const c of config.cases) {
    for (const it of c.items) {
      if (it.kind !== 'perk' || !/бесплатно/i.test(it.name)) continue;
      const gift = config.cases.find((g) => it.name.includes(g.name));
      if (!gift) continue;
      const ratio = gift.price / c.price;
      if (ratio < 0.25 || ratio > 0.6) offBand++;
    }
  }
  check('подарочные кейсы сопоставимы по цене', offBand === 0, `вне диапазона ${offBand}`);

  // Отдача задана одна на все кейсы и должна совпадать с фактической: если
  // решатель разойдётся с заявленным значением, поймать это больше негде -
  // из интерфейса число убрано.
  const TARGET_RTP = 0.7;
  let offRtp = 0;
  let evMismatch = 0;
  for (const c of config.cases) {
    if (Math.abs(c.rtp - TARGET_RTP) > 1e-9) offRtp++;
    const ev = c.items.reduce((s, it) => s + it.probability * (it.evValue ?? it.value), 0);
    if (Math.abs(ev / c.price - TARGET_RTP) > 1e-6) evMismatch++;
  }
  check(`отдача всех кейсов равна ${TARGET_RTP}`, offRtp === 0, `отклонений ${offRtp}`);
  check('матожидание сходится с заявленной отдачей', evMismatch === 0,
        `расхождений ${evMismatch}`);

  // Потолок ровно 500x есть у обычных кейсов; кейс с джекпотом округляет свой
  // вверх, поэтому проверяем достижение планки, а не точное совпадение.
  const tops = config.cases.map((c) => c.maxMultiplier);
  check('потолок множителя доходит до 500x', Math.max(...tops) >= 500,
        `максимум ${Math.max(...tops)}`);
}

/* ---------- 10. Админка ---------- */

{
  const ov = await post('/api/admin/overview');
  check('админка: сводка доступна администратору', ov.status === 200, `статус ${ov.status}`);

  if (ov.status === 200) {
    const d = ov.data;
    check('админка: прибыль = ставки минус выплаты',
          d.rounds.profit === d.rounds.wagered - d.rounds.paid);
    check('админка: RTP согласован с оборотом',
          !d.rounds.wagered || Math.abs(d.rounds.rtp - d.rounds.paid / d.rounds.wagered) < 1e-9);
  }

  const users = await post('/api/admin/users', { query: '' });
  check('админка: список игроков отдаётся', users.status === 200 && Array.isArray(users.data.rows));

  const before = (await post('/api/me')).data.user.balance;
  await post('/api/admin/balance', { userId: me.id, amount: 1234, note: 'проверка', asDeposit: false });
  const after = (await post('/api/me')).data.user.balance;
  check('админка: начисление меняет баланс ровно на сумму', after === before + 1234,
        `${after} vs ${before + 1234}`);

  await post('/api/admin/balance', { userId: me.id, amount: -(after + 999999), note: 'проверка' });
  const floor = (await post('/api/me')).data.user.balance;
  check('админка: списание не уводит баланс ниже нуля', floor === 0, `баланс ${floor}`);
  await post('/api/admin/balance', { userId: me.id, amount: 100000, note: 'возврат', asDeposit: false });

  const zero = await post('/api/admin/balance', { userId: me.id, amount: 0 });
  check('админка: нулевая сумма отклонена', zero.status === 400);

  const self = await post('/api/admin/block', { userId: me.id, blocked: true });
  check('админка: нельзя заблокировать самого себя', self.status === 400, `статус ${self.status}`);
}

/* ---------- 11. Касса ---------- */

{
  await post('/api/admin/balance', { userId: me.id, amount: 200_000, note: 'касса' });

  /*
   * Начисление администратора - это пополнение, и по правилу вывода его надо
   * прокрутить через ставки. Проверяем само правило, а потом отыгрываем долг,
   * чтобы дальше можно было проверять заявки.
   */
  const owing = (await post('/api/wallet')).data;
  check('пополнение закрывает вывод, пока не прокручено',
        owing.depositDebt > 0 && owing.available === 0,
        `долг ${owing.depositDebt}, доступно ${owing.available}`);
  check('заявка при непрокрученном пополнении отклонена',
        (await post('/api/payout/create',
          { amount: 5000, method: 'sbp', phone: '79001234567', bank: 'Сбербанк' })).status === 400);

  // Гасим долг ставками: крутим рулетку, пока не отыграем внесённое.
  for (let i = 0; i < 80; i++) {
    const w = (await post('/api/wallet')).data;
    if (!w.depositDebt) break;
    const bet = Math.max(1, Math.min(w.depositDebt, w.balance, 10_000_000));
    await post('/api/roulette', { bet, color: 'red' });
  }

  const start = (await post('/api/wallet')).data;
  check('после отыгрыша долга вывод открыт полностью',
        start.depositDebt === 0 && start.available === start.balance,
        `долг ${start.depositDebt}, доступно ${start.available} при ${start.balance}`);

  check('касса отдаёт баланс и истории',
        start.balance > 0 && Array.isArray(start.deposits) && Array.isArray(start.payouts));
  check('начисление администратора видно в пополнениях',
        start.deposits.some((d) => d.source === 'admin'));

  /*
   * Заявке нужны реквизиты: способ вывода и телефон с банком либо номер
   * карты. Держим их в одном месте - платёжный модуль проверяет их строго, и
   * при правке контракта чинить придётся одну строку, а не десяток вызовов.
   */
  const sbp = { method: 'sbp', phone: '79001234567', bank: 'Сбербанк' };
  const makePayout = (amount) => post('/api/payout/create', { amount, ...sbp });

  check('минимальная сумма вывода проверяется',
        (await makePayout(1)).status === 400);
  check('нельзя вывести больше баланса',
        (await makePayout(start.balance + 1)).status === 400);
  check('без способа вывода заявка не создаётся',
        (await post('/api/payout/create', { amount: 5000 })).status === 400);
  check('кривой телефон не проходит',
        (await post('/api/payout/create',
          { amount: 5000, method: 'sbp', phone: '123', bank: 'Сбербанк' })).status === 400);
  check('номер карты проверяется по Луну',
        (await post('/api/payout/create',
          { amount: 5000, method: 'card', cardNumber: '1234567812345678' })).status === 400);

  const amount = 5000;
  const before = start.balance;

  // Создание и отмена.
  // Как и со статистикой ниже, «ожидающее» проверяем приростом: в базе могут
  // лежать заявки прошлых прогонов, и абсолютное значение тогда не сойдётся.
  const pendingBefore = (await post('/api/wallet')).data.pending;
  const made = (await makePayout(amount)).data;
  check('заявка списывает сумму сразу', made.balance === before - amount,
        `${made.balance} vs ${before - amount}`);
  check('сумма учтена как ожидающая',
        (await post('/api/wallet')).data.pending === pendingBefore + amount);

  const cancelled = (await post('/api/payout/cancel', { id: made.id })).data;
  check('отмена возвращает средства', cancelled.balance === before);
  check('повторная отмена отклонена',
        (await post('/api/payout/cancel', { id: made.id })).status === 400);

  // Отклонение администратором возвращает деньги.
  const p2 = (await makePayout(amount)).data;
  await post('/api/admin/payout/resolve', { id: p2.id, status: 'rejected', comment: 'Проверка' });
  const afterReject = (await post('/api/wallet')).data;
  check('отклонение возвращает средства', afterReject.balance === before,
        `${afterReject.balance} vs ${before}`);
  check('комментарий администратора виден игроку',
        afterReject.payouts[0].comment === 'Проверка');

  /*
   * Выплата идёт через «в работе»: сразу из новой в выплаченную заявку
   * перевести нельзя. Это и есть защита от возврата денег по уже отправленному
   * переводу - её и проверяем.
   */
  const paidBefore = (await post('/api/admin/payouts', { status: 'all' })).data.stats.paidSum;
  const p3 = (await makePayout(amount)).data;
  await clearRisk(p3.id, true);
  check('выплатить заявку в обход «в работе» нельзя',
        (await post('/api/admin/payout/resolve', { id: p3.id, status: 'paid' })).status === 400);

  await post('/api/admin/payout/resolve', { id: p3.id, status: 'processing', comment: 'Взяли' });
  check('заявка в работе не отменяется игроком',
        (await post('/api/payout/cancel', { id: p3.id })).status === 400);
  check('заявку в работе нельзя отклонить с возвратом',
        (await post('/api/admin/payout/resolve', { id: p3.id, status: 'rejected' })).status === 400);

  await post('/api/admin/payout/resolve', { id: p3.id, status: 'paid', comment: 'Отправлено' });
  const afterPaid = (await post('/api/wallet')).data;
  check('выплата не возвращает средства', afterPaid.balance === before - amount,
        `${afterPaid.balance} vs ${before - amount}`);
  check('заявка со статусом paid не отменяется',
        (await post('/api/payout/cancel', { id: p3.id })).status === 400);
  check('повторное решение по заявке отклонено',
        (await post('/api/admin/payout/resolve', { id: p3.id, status: 'rejected' })).status === 400);

  const adm = await post('/api/admin/payouts', { status: 'all' });
  check('админка видит заявки', adm.status === 200 && adm.data.rows.length >= 3);
  check('статистика выплат растёт ровно на выплаченное',
        adm.data.stats.paidSum === paidBefore + amount,
        `${adm.data.stats.paidSum} vs ${paidBefore + amount}`);
  check('номер телефона сохранён в заявке',
        adm.data.rows.some((r) => r.method === 'sbp' && r.phone === '+79001234567'));
}

/* ---------- Криптокасса ---------- */

{
  /*
   * Правило отыгрыша проверяется целиком в test/wager.mjs, здесь только его
   * видимая часть: касса не должна обещать больше, чем можно вывести.
   */
  const w = (await post('/api/wallet')).data;
  check('касса: доступное не больше баланса', w.available <= w.balance,
        `${w.available} из ${w.balance}`);
  // Правило вывода: пока пополнение не прокручено ставками - ноль, после -
  // весь баланс. Промежуточных значений быть не должно.
  check('касса: вывод открыт только полностью или никак',
        w.depositDebt > 0 ? w.available === 0 : w.available === w.balance,
        `доступно ${w.available} при балансе ${w.balance} и долге ${w.depositDebt}`);

  const opts = await post('/api/crypto/options');
  check('криптокасса: настройки отдаются', opts.status === 200, `HTTP ${opts.status}`);

  if (opts.data.enabled) {
    const coins = opts.data.coins || [];
    check('криптокасса: список монет не пустой', coins.length > 0, `монет ${coins.length}`);
    check('криптокасса: у каждой монеты есть хотя бы одна сеть',
          coins.every((c) => Array.isArray(c.networks) && c.networks.length > 0));
    check('криптокасса: коды монет и сетей заглавными',
          coins.every((c) => c.currency === c.currency.toUpperCase()
            && c.networks.every((n) => n.network === n.network.toUpperCase())));

    /*
     * Курс нужен, чтобы показать игроку сумму. Он может отсутствовать у
     * экзотической монеты, но у стейблкоина обязан быть - иначе оценка не
     * покажется там, где ей место.
     */
    const rates = opts.data.rates || {};
    check('криптокасса: курс USDT известен и правдоподобен',
          rates.USDT > 10 && rates.USDT < 1000, String(rates.USDT));

    check('криптокасса: чужая монета отвергается',
          (await post('/api/crypto/create',
            { amount: 1000, currency: 'НЕТТАКОЙ', network: 'TRON' })).status === 400);
    check('криптокасса: чужая сеть отвергается',
          (await post('/api/crypto/create',
            { amount: 1000, currency: coins[0].currency, network: 'НЕТСЕТИ' })).status === 400);
    check('криптокасса: сумма ниже минимума отвергается',
          (await post('/api/crypto/create',
            { amount: 1, currency: coins[0].currency, network: coins[0].networks[0].network })).status === 400);
  } else {
    check('криптокасса: без ключей отдаёт выключенное состояние',
          opts.data.coins?.length === 0);
  }

  // Вебхук без подписи не должен зачислять ничего и никогда.
  const forged = await post('/api/webhooks/heleket',
    { order_id: 'нет-такого', status: 'paid', sign: 'f'.repeat(32) });
  check('криптокасса: вебхук с чужой подписью отвергается', forged.status === 401,
        `HTTP ${forged.status}`);
}

/* ---------- Вывод криптовалютой ---------- */

{
  const crypto = (extra = {}) => post('/api/payout/create', {
    amount: 5000, method: 'crypto', cryptoCurrency: 'USDT', cryptoNetwork: 'TRON',
    cryptoAddress: 'TLmZD36o3hZ4Bk5EaLAvMbF7TFpgLwyRzP',
    cryptoAmount: '58.03', cryptoRate: 86.16, ...extra,
  });

  const made = await crypto();
  check('вывод криптой: заявка создаётся', made.status === 200, `HTTP ${made.status}`);

  const rows = (await post('/api/admin/payouts', { status: 'pending' })).data.rows;
  const row = rows.find((r) => r.id === made.data.id);
  check('вывод криптой: админка видит монету, сеть и адрес',
        row?.crypto_currency === 'USDT' && row?.crypto_network === 'TRON'
        && row?.crypto_address === 'TLmZD36o3hZ4Bk5EaLAvMbF7TFpgLwyRzP');
  check('вывод криптой: сумма в монете и курс сохранены',
        row?.crypto_amount === '58.03' && Number(row?.crypto_rate) === 86.16);

  check('вывод криптой: кривой адрес отвергается понятной ошибкой',
        (await crypto({ cryptoAddress: 'нет' })).data.error === 'BAD_ADDRESS');
  check('вывод криптой: без курса отвергается',
        (await crypto({ cryptoRate: 0 })).data.error === 'BAD_RATE');

  // Тот же порядок состояний, что и у рублёвого вывода.
  await clearRisk(made.data.id);
  await post('/api/admin/payout/resolve', { id: made.data.id, status: 'processing' });
  check('вывод криптой: заявку в работе игрок не отменяет',
        (await post('/api/payout/cancel', { id: made.data.id })).status === 400);
  check('вывод криптой: заявка доводится до выплаченной',
        (await post('/api/admin/payout/resolve',
          { id: made.data.id, status: 'paid' })).status === 200);
}

/* ---------- Фриспины и джекпот ---------- */
{
  const withFs = config.cases.filter((c) =>
    c.items.some((it) => it.kind === 'perk' && /фриспин/i.test(it.name)));
  check('фриспины есть во всех кейсах', withFs.length === config.cases.length,
        `${withFs.length} из ${config.cases.length}`);

  // Ряд сходится, только если ожидаемое продление меньше единицы: p·N = share.
  let diverging = 0;
  for (const c of config.cases) {
    const fs = c.items.find((it) => /фриспин/i.test(it.name));
    const count = Number(String(fs.name).match(/\d+/)[0]);
    if (fs.probability * count >= 1) diverging++;
  }
  check('серия фриспинов сходится у всех кейсов', diverging === 0, `расходится ${diverging}`);

  const fsCase = config.cases.find((c) => c.id === 'dubai_5000');
  /*
   * Серия ловится редко, поэтому открытий много и баланса на них нужно больше.
   * Баланс именно ВЫСТАВЛЯЕТСЯ, а не доначисляется: база между прогонами не
   * чистится, и накопительное пополнение раздувало её так, что проверки из
   * более ранних разделов переставали иметь смысл.
   */
  const setBalance = async (target) => {
    const now = (await post('/api/me')).data.user.balance;
    if (now !== target) {
      await post('/api/admin/balance', { userId: me.id, amount: target - now, note: 'фриспины', asDeposit: false });
    }
  };
  await setBalance(20_000_000);

  let hit = null;
  let balanceOk = true;
  for (let i = 0; i < 900 && !hit; i++) {
    const before = (await post('/api/me')).data.user;
    if (before.balance < fsCase.price * 50) { await setBalance(20_000_000); continue; }

    const r = await post('/api/open', { caseId: fsCase.id });
    if (r.status !== 200) { failures.push(`открытие вернуло ${r.status}`); break; }

    const data = r.data;
    const fs = (data.granted || []).find((g) => g.type === 'freespins');
    const expected = before.balance - fsCase.price + data.item.value + (fs ? fs.total : 0);
    if (data.balance !== expected) balanceOk = false;
    if (fs) hit = fs;
  }

  check('баланс сходится с учётом серии', balanceOk);

  if (check('фриспины выпали за 900 открытий', !!hit)) {
    check('сумма серии равна сумме прокрутов',
          hit.spins.reduce((a, s) => a + s.value, 0) === hit.total);
    check('у каждого прокрута свой nonce',
          new Set(hit.spins.map((s) => s.nonce)).size === hit.spins.length);
    // Серия крутит полную таблицу, поэтому длина равна обещанной плюс всё,
    // что добавили перезапуски.
    const added = hit.spins.reduce((a, s) => a + (s.added || 0), 0);
    check('длина серии = обещано + перезапуски',
          hit.spins.length === hit.count || hit.capped,
          `${hit.spins.length} против ${hit.count}`);
    check('счётчик серии учитывает перезапуски', hit.count >= 10 && hit.count === 10 + added,
          `${hit.count} при добавке ${added}`);
    const names = new Set(fsCase.items.map((it) => it.name));
    check('предметы серии из таблицы кейса', hit.spins.every((s) => names.has(s.name)));
    check('серия не упёрлась в предохранитель', !hit.capped);
  }

  const jackpotCase = config.cases.find((c) => c.id === 'rolex_6000');
  if (check('кейс с джекпотом есть в конфиге', !!jackpotCase)) {
    check('кейс называется «Самородок»', jackpotCase.name === 'Самородок', jackpotCase.name);
    // Джекпот - самый дорогой предмет таблицы: по имени его искать нельзя,
    // название кейса и его тема могут поменяться, а роль предмета - нет.
    const top = jackpotCase.items.reduce((a, b) => (b.value > a.value ? b : a));
    check('джекпот есть в таблице розыгрыша', top.value > jackpotCase.price * 100);
    check('шанс джекпота крайне мал', top.probability < 0.0001,
          `${(top.probability * 100).toFixed(4)}%`);
    check('джекпот укладывается в заявленный потолок',
          top.value <= jackpotCase.price * jackpotCase.maxMultiplier);
  }

  const country = config.cases.filter((c) => c.category === 'country');
  check('блок направлений собран', country.length >= 5, `кейсов ${country.length}`);
  check('«Самородок» не в направлениях', !country.some((c) => c.id === 'rolex_6000'));
}

/* ---------- Сезонный кейс ---------- */
{
  const seasonal = config.cases.filter((c) => c.availableFrom);
  check('сезонный кейс есть в конфиге', seasonal.length >= 1);

  for (const c of seasonal) {
    const future = c.availableFrom > Date.now();
    const r = await post('/api/open', { caseId: c.id, count: 1 });

    // До даты старта сервер обязан отказать, после - открыть как обычно.
    // Проверка привязана к дате, а не к «сегодня»: тест не протухнет 1 октября.
    check(`«${c.name}»: ${future ? 'до старта закрыт' : 'после старта открывается'}`,
          future ? r.status === 403 : r.status === 200,
          `HTTP ${r.status}`);

    if (c.showcase) {
      check(`«${c.name}»: витринный предмет вне таблицы розыгрыша`,
            !c.items.some((it) => it.name === c.showcase.name));
      check(`«${c.name}»: сумма шансов без витрины равна единице`,
            Math.abs(c.items.reduce((s, it) => s + it.probability, 0) - 1) < 1e-9);
    }
  }
}

/* ---------- Покупка фриспинов ---------- */

{
  await post('/api/admin/balance', { userId: me.id, amount: 5_000_000, note: 'фриспины', asDeposit: false });
  const c = config.cases.find((x) => x.id === 'warmup_100');

  check('конфиг отдаёт пачки фриспинов',
        Array.isArray(config.freeSpinPacks) && config.freeSpinPacks.length === 3);

  for (const pack of config.freeSpinPacks) {
    // Та же формула, что на сервере: лесенка скидок, потом округление вниз до
    // круглого числа с потолком в 2.5% (см. roundPackPrice в server/cases.js).
    const raw = Math.round(c.price * pack.count * (1 - pack.discount));
    let expected = raw;
    for (let step = 10; step <= raw; step *= 10) {
      const down = Math.floor(raw / step) * step;
      if (down <= 0 || raw - down > raw * 0.025) break;
      expected = down;
    }
    const before = (await post('/api/me')).data.user.balance;
    const r = await post('/api/freespins/buy', { caseId: c.id, count: pack.count });

    check(`пачка ${pack.count}: цена считается сервером`, r.data.cost === expected,
          `${r.data.cost} vs ${expected}`);
    check(`пачка ${pack.count}: пачка дешевле поштучных прокрутов`,
          r.data.cost < c.price * pack.count);
    check(`пачка ${pack.count}: прокрутов не меньше купленного`,
          r.data.grant.spins.length >= pack.count);

    const after = (await post('/api/me')).data.user.balance;
    check(`пачка ${pack.count}: баланс сходится`,
          after === before - r.data.cost + r.data.grant.total,
          `${before} - ${r.data.cost} + ${r.data.grant.total} != ${after}`);
  }

  const bad = await post('/api/freespins/buy', { caseId: c.id, count: 17 });
  check('несуществующая пачка отклонена', bad.status === 400, `HTTP ${bad.status}`);

  // Купленная серия остаётся незавершённой, пока её не досмотрят. Убираем за
  // собой, иначе следующий заход в кейс начнётся с её доигрывания.
  await post('/api/freespins/ack');
}

/* ---------- Незавершённая серия фриспинов ---------- */

{
  await post('/api/freespins/ack');
  check('изначально незавершённой серии нет',
        (await post('/api/freespins/pending')).data.pending === null);

  const before = (await post('/api/me')).data.user.balance;
  const bought = (await post('/api/freespins/buy', { caseId: 'warmup_100', count: 10 })).data;
  const after = (await post('/api/me')).data.user.balance;

  const pending = (await post('/api/freespins/pending')).data.pending;
  check('купленная серия запомнена', pending && pending.caseId === 'warmup_100');
  check('в запомненной серии те же прокруты',
        pending.grant.spins.length === bought.grant.spins.length
        && pending.grant.total === bought.grant.total);

  // Главное: деньги уже начислены, повторный заход их не меняет.
  check('баланс учтён сразу при покупке',
        after === before - bought.cost + bought.grant.total,
        `${before} - ${bought.cost} + ${bought.grant.total} != ${after}`);
  check('пока серия не досмотрена, баланс не двигается',
        (await post('/api/me')).data.user.balance === after);

  await post('/api/freespins/ack');
  check('после досмотра серия забыта',
        (await post('/api/freespins/pending')).data.pending === null);
  check('досмотр не меняет баланс',
        (await post('/api/me')).data.user.balance === after);
}

/* ---------- Удвоение внутри серии ---------- */

{
  // Ищем серию, внутри которой выпал ×2, и проверяем, что следующий прокрут
  // действительно удвоен, а сумма серии сходится с суммой прокрутов.
  let checked = 0;
  for (let i = 0; i < 500 && checked < 5; i++) {
    const r = await post('/api/open', { caseId: 'double_500', count: 1 });
    const g = (r.data.granted || []).find((x) => x.type === 'freespins');
    if (!g) continue;

    check('сумма серии равна сумме прокрутов',
          g.total === g.spins.reduce((s, x) => s + x.value, 0));

    for (let k = 1; k < g.spins.length; k++) {
      if (!g.spins[k].x2) continue;
      checked++;
      check('удвоенный прокрут идёт сразу за плюшкой ×2',
            g.spins[k - 1].perkType === 'x2',
            `перед ним был ${g.spins[k - 1].perkType}`);
      check('удвоенный прокрут не нулевой', g.spins[k].value > 0);
    }
    await post('/api/freespins/ack');
  }
}

/* ---------- Промокоды ---------- */

{
  const uniq = (p) => `${p}${Date.now().toString(36).toUpperCase()}`;

  // Начисление на баланс с отыгрышем.
  const codeBalance = uniq('BAL');
  await post('/api/admin/promo/save', {
    code: codeBalance, type: 'balance', amount: 1000,
    wager_multiplier: 2, per_user_limit: 1,
  });

  const before = (await post('/api/me')).data.user;
  const r = await post('/api/promo/redeem', { code: codeBalance.toLowerCase() });
  check('промокод принят без учёта регистра', r.status === 200, `HTTP ${r.status}`);
  // Бонус ложится на отдельный бонусный счёт, свои деньги не трогает.
  check('промокод зачислен на бонусный счёт',
        r.data.user.bonusBalance === (before.bonusBalance || 0) + 1000
        && r.data.user.balance === before.balance,
        JSON.stringify({ b: r.data.user.bonusBalance, r: r.data.user.balance }));
  check('отыгрыш начислен множителем',
        r.data.user.wagerRequired === (before.bonusBalance > 0 ? before.wagerRequired : 0) + 2000,
        `${r.data.user.wagerRequired}`);

  const again = await post('/api/promo/redeem', { code: codeBalance });
  check('повторная активация отклонена', again.status === 400);

  // Неотыгранный бонус вывод своих денег не запирает: счёт отдельный.
  const allowed = await post('/api/payout/create',
    { amount: config.minPayout, method: 'sbp', phone: '79001234567', bank: 'Сбербанк' });
  check('неотыгранный бонус вывод не запирает', allowed.status === 200, `HTTP ${allowed.status} ${allowed.data.error || ''}`);
  if (allowed.data.id) await post('/api/payout/cancel', { id: allowed.data.id });

  // Ставки своими деньгами бонус не отыгрывают: свои тратятся первыми.
  await post('/api/open', { caseId: 'warmup_100', count: 1 });
  check('ставка своими деньгами отыгрыш бонуса не трогает',
        (await post('/api/me')).data.user.wagerRequired === r.data.user.wagerRequired);

  const wallet = (await post('/api/wallet')).data;
  check('касса показывает бонусный счёт и правила',
        wallet.bonus && wallet.bonus.balance >= 1000 && wallet.bonus.rules.wager > 0
        && wallet.bonus.rules.cashoutPct > 0 && wallet.bonus.rules.cashoutPct < 30,
        JSON.stringify(wallet.bonus?.rules));

  // Отказ от бонуса обнуляет бонусный счёт и его отыгрыш, свои не трогает.
  const keep = (await post('/api/me')).data.user.balance;
  const refused = await post('/api/bonus/refuse');
  check('отказ от бонуса обнуляет бонусный счёт',
        refused.status === 200 && refused.data.user.bonusBalance === 0
        && refused.data.user.wagerRequired === 0 && refused.data.user.balance === keep,
        JSON.stringify(refused.data.user ? { b: refused.data.user.bonusBalance, w: refused.data.user.wagerRequired } : refused.data));

  // Бесплатный кейс.
  const codeCase = uniq('BOX');
  await post('/api/admin/promo/save', {
    code: codeCase, type: 'free_case', case_id: 'dust_25', case_count: 2,
  });
  const box = await post('/api/promo/redeem', { code: codeCase });
  const voucher = (box.data.user?.vouchers || []).find((v) => v.case_id === 'dust_25');
  check('промокод выдал подарочные открытия', voucher && voucher.count >= 2);

  // Просроченный код не принимается.
  const codeOld = uniq('OLD');
  await post('/api/admin/promo/save', {
    code: codeOld, type: 'balance', amount: 100, expires_at: Date.now() - 1000,
  });
  const expired = await post('/api/promo/redeem', { code: codeOld });
  check('просроченный промокод отклонён', expired.status === 400);

  // Лимит активаций на всех.
  const codeOnce = uniq('ONE');
  await post('/api/admin/promo/save', {
    code: codeOnce, type: 'balance', amount: 50, max_uses: 1, per_user_limit: 5,
  });
  const first = await post('/api/promo/redeem', { code: codeOnce });
  const second = await post('/api/promo/redeem', { code: codeOnce });
  check('лимит активаций соблюдается',
        first.status === 200 && second.status === 400);

  const nonsense = await post('/api/promo/redeem', { code: 'НЕТТАКОГО' });
  check('несуществующий промокод отклонён', nonsense.status === 400);
}

/* ---------- Партнёры ---------- */

{
  const tg = String(700000000 + (Date.now() % 1000000));
  const saved = await post('/api/admin/partner/save', {
    tg_id: tg, name: 'Тестовый партнёр', share_pct: 30,
  });
  check('партнёр создан', saved.status === 200 && saved.data.created === true);

  const bad = await post('/api/admin/partner/save', { tg_id: 'не-число' });
  check('нечисловой Telegram ID отклонён', bad.status === 400);

  const list = await post('/api/admin/partners');
  const row = list.data.rows.find((r) => r.partner.tg_id === tg);
  check('партнёр виден в списке со статистикой', !!row);
  check('прибыль считается как ставки минус выигрыши минус бонусы',
        row.profit === row.wagered - row.paid - row.bonuses);
  check('в минусе доля не начисляется',
        row.profit > 0 ? row.accrued === Math.floor(row.profit * 0.3) : row.accrued === 0);

  const over = await post('/api/admin/partner/pay',
                          { partnerId: row.partner.id, amount: row.pending + 1000 });
  check('выплата сверх начисленного отклонена', over.status === 400);

  // Чужой аккаунт не должен видеть партнёрскую статистику.
  const mine = await post('/api/partner/stats');
  check('не партнёр не видит чужую статистику', mine.status === 403, `HTTP ${mine.status}`);
}

/* ---------- Аналитика и воронка ---------- */

{
  check('клиентское событие принимается',
        (await post('/api/track', { name: 'cashier_view' })).status === 200);
  check('серверное событие клиенту слать нельзя',
        (await post('/api/track', { name: 'deposit_paid' })).status === 400);
  check('выдуманное событие отклонено',
        (await post('/api/track', { name: 'что-угодно' })).status === 400);
  check('событие без имени отклонено',
        (await post('/api/track', {})).status === 400);

  const f = (await post('/api/admin/funnel', { days: 7 })).data;
  check('воронка отдаёт шаги в порядке',
        f.funnel.steps[0].name === 'signup'
        && f.funnel.steps.at(-1).name === 'payout_created');
  check('в воронке есть открытие кейса',
        f.funnel.steps.some((x) => x.name === 'case_open'));
  check('сводка событий приходит вместе с воронкой', Array.isArray(f.events));

  const wide = (await post('/api/admin/funnel', { days: 9999 })).data;
  check('период ограничен сверху', wide.funnel.days === 90, `${wide.funnel.days}`);
  const narrow = (await post('/api/admin/funnel', { days: 0 })).data;
  check('нулевой период превращается в сутки', narrow.funnel.days === 7 || narrow.funnel.days === 1,
        `${narrow.funnel.days}`);
}

/* ---------- Приветственный бонус в конфиге ---------- */

{
  check('условия первого пополнения приходят клиенту',
        typeof config.firstDeposit?.pct === 'number');
  check('у игрока виден счётчик пополнений',
        typeof me.depositsCount === 'number');
}

/* ---------- Панель: права, сотрудники, настройки, лимиты, журнал ---------- */

{
  const meRes = await post('/api/admin/me');
  check('панель: /me отдаёт роль и права', meRes.status === 200 && Array.isArray(meRes.data.permissions));
  const perms = new Set(meRes.data.permissions || []);
  check('панель: владелец получил право на сотрудников', perms.has('staff.manage'));
  check('панель: у владельца нет потолка правки баланса', meRes.data.balanceCap === 0);

  const staff = await post('/api/admin/staff');
  check('панель: состав команды доступен', staff.status === 200 && Array.isArray(staff.data.rows));
  check('панель: каталог прав приходит целиком',
        (staff.data.permissions || []).length === perms.size,
        `${staff.data.permissions?.length} против ${perms.size}`);
  check('панель: владелец есть в составе',
        (staff.data.rows || []).some((r) => r.user_id === me.id && r.role === 'owner'));

  const badRole = await post('/api/admin/staff/save', { userKey: String(me.tgId || '999000001'), role: 'wizard' });
  check('панель: выдуманная роль отклонена', badRole.status === 400, `статус ${badRole.status}`);

  const selfOff = await post('/api/admin/staff/save',
    { userKey: '999000001', role: 'support', active: false });
  check('панель: нельзя выключить самого себя', selfOff.status === 400, `статус ${selfOff.status}`);

  const selfDel = await post('/api/admin/staff/remove', { userId: me.id });
  check('панель: нельзя удалить самого себя', selfDel.status === 400, `статус ${selfDel.status}`);

  const ghost = await post('/api/admin/staff/save', { userKey: 'кого-то-нет', role: 'support' });
  check('панель: незнакомого игрока в команду не взять', ghost.status === 404, `статус ${ghost.status}`);

  /* Настройки: сохранили и прочитали обратно. */
  const settings = await post('/api/admin/settings');
  check('панель: настройки отдаются списком',
        settings.status === 200 && settings.data.rows.some((r) => r.key === 'maintenance'));
  await post('/api/admin/settings/save', { patch: { min_payout: 7777 } });
  const back = await post('/api/admin/settings');
  check('панель: настройка сохраняется и читается обратно',
        back.data.rows.find((r) => r.key === 'min_payout')?.value === '7777');

  /*
   * Главное в настройках не то, что число сохранилось, а то, что оно
   * действует. Выключатель, который ничего не выключает, хуже отсутствующего:
   * им пользуются, считая, что приём закрыт.
   */
  const cfgTight = await get('/api/config');
  check('настройки: минимум вывода доходит до клиента', cfgTight.minPayout === 7777,
        `${cfgTight.minPayout}`);
  const tooSmall = await post('/api/payout/create', { amount: 1500, method: 'sbp',
                                                      phone: '+79000000000', bank: 'sber' });
  check('настройки: заявка ниже минимума отклонена', tooSmall.status === 400,
        `статус ${tooSmall.status}`);
  await post('/api/admin/settings/save', { patch: { min_payout: 0 } });

  await post('/api/admin/settings/save', { patch: { payouts_open: false } });
  const closed = await post('/api/payout/create', { amount: 100000, method: 'sbp',
                                                    phone: '+79000000000', bank: 'sber' });
  check('настройки: закрытый приём выводов отказывает', closed.status === 503,
        `статус ${closed.status}`);
  await post('/api/admin/settings/save', { patch: { payouts_open: true } });

  await post('/api/admin/settings/save', { patch: { games_roulette: false } });
  const offGame = await post('/api/roulette', { bet: 100, color: 'red' });
  check('настройки: выключенная игра отказывает', offGame.status === 503,
        `статус ${offGame.status}`);
  const cfgOff = await get('/api/config');
  check('настройки: клиент узнаёт о выключенной игре', cfgOff.open?.roulette === false);
  await post('/api/admin/settings/save', { patch: { games_roulette: true } });

  /* Работы: сотрудника они не касаются, иначе включивший сам себя запрёт. */
  await post('/api/admin/settings/save', { patch: { maintenance: true } });
  const staffPass = await post('/api/me');
  check('настройки: работы не запирают сотрудника', staffPass.status === 200,
        `статус ${staffPass.status}`);
  await post('/api/admin/settings/save', { patch: { maintenance: false } });

  /* Заметки. */
  const note = await post('/api/admin/player/note', { userId: me.id, text: 'проверка заметки' });
  check('панель: заметка добавляется',
        note.status === 200 && note.data.notes.some((n) => n.text === 'проверка заметки'));
  const noteId = note.data.notes.find((n) => n.text === 'проверка заметки')?.id;
  const empty = await post('/api/admin/player/note', { userId: me.id, text: '   ' });
  check('панель: пустая заметка отклонена', empty.status === 400, `статус ${empty.status}`);
  await post('/api/admin/player/note/delete', { noteId });

  /*
   * Лимиты. Главная проверка здесь не в том, что число сохранилось, а в том,
   * что ослабление откладывается: лимит, снимаемый сразу, не лимит.
   */
  await post('/api/admin/player/limits', { userId: me.id, patch: { loss_day: 5000 } });
  const tight = await post('/api/admin/player/limits', { userId: me.id, patch: { loss_day: 1000 } });
  check('панель: ужесточение лимита действует сразу',
        tight.data.limits.loss_day === 1000, `${tight.data.limits.loss_day}`);
  const loose = await post('/api/admin/player/limits', { userId: me.id, patch: { loss_day: 90000 } });
  check('панель: ослабление лимита откладывается',
        loose.data.limits.loss_day === 1000 && loose.data.limits.pending_loss === 90000,
        `текущий ${loose.data.limits.loss_day}, отложенный ${loose.data.limits.pending_loss}`);
  check('панель: у отложенного ослабления есть срок',
        loose.data.limits.pending_at > Date.now());
  const drop = await post('/api/admin/player/limits', { userId: me.id, patch: { loss_day: 0 } });
  check('панель: снятие лимита это тоже ослабление',
        drop.data.limits.loss_day === 1000, `${drop.data.limits.loss_day}`);

  /* Риск и отчёты. */
  const risk = await post('/api/admin/risk');
  check('панель: сигналы риска считаются',
        risk.status === 200 && Array.isArray(risk.data.sharedPhone) && Array.isArray(risk.data.hotPlayers));

  const reports = await post('/api/admin/reports', { days: 7 });
  check('панель: отчёт по дням считается',
        reports.status === 200 && Array.isArray(reports.data.daily));
  if (reports.data.daily?.length) {
    const row = reports.data.daily[reports.data.daily.length - 1];
    check('панель: доход в отчёте это ставки минус выплаты',
          row.ggr === row.wagered - row.paid);
    check('панель: чистый приход это пополнения минус выводы',
          row.net === row.deposits - row.payouts);
  }

  /* Выгрузка. */
  const csv = await fetch(BASE + '/api/admin/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'daily', days: 7 }),
  });
  // Смотрим байты, а не строку: fetch().text() снимает BOM по спецификации,
  // и проверка по первому символу строки всегда проходила бы мимо.
  const bytes = new Uint8Array(await csv.arrayBuffer());
  const text = new TextDecoder('utf-8').decode(bytes);
  check('панель: выгрузка отдаёт CSV', csv.ok && text.includes(';'));
  check('панель: у выгрузки есть BOM для Excel',
        bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF,
        `первые байты ${bytes[0]} ${bytes[1]} ${bytes[2]}`);

  /* Касса в панели: пополнения с номерами, споры, выгрузки сделок. */
  const deps = await post('/api/admin/deposits', { filter: 'all' });
  check('панель: список пополнений отдаётся', deps.status === 200 && Array.isArray(deps.data.rows)
    && typeof deps.data.summary?.disputesNew === 'number', deps.status);
  check('панель: поиск пополнений по номеру', (await post('/api/admin/deposits', { q: 'lb-нет-такого' })).data.rows?.length === 0);
  for (const kind of ['deposits', 'payouts']) {
    const r = await fetch(BASE + '/api/admin/export/finance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, days: 30 }),
    });
    const t = new TextDecoder('utf-8').decode(new Uint8Array(await r.arrayBuffer()));
    check(`панель: выгрузка сделок (${kind}) с номерами шлюза`, r.ok && t.includes('номер') && t.includes(';'), t.slice(0, 80));
  }
  const meDisputes = (await post('/api/admin/me')).data.sections?.disputes;
  check('панель: число споров для вкладки', typeof meDisputes === 'number', String(meDisputes));
  check('чек: чужое имя файла не отдаётся', (await fetch(BASE + '/receipts/..%2Fapp.db')).status === 404);
  check('чек: несуществующий не отдаётся', (await fetch(BASE + '/receipts/' + 'a'.repeat(32) + '.png')).status === 404);
  check('спор по чужой оплате не заводится', (await post('/api/sicilia/report', { id: 999999, image: 'x' })).status === 404);
  check('апелляция без права на выводы закрыта для игрока без шлюза',
    [400, 404, 503].includes((await post('/api/admin/dispute/open', { orderId: 999999, reason: 'проверка' })).status));

  /* Журнал: всё, что мы только что сделали, должно в нём быть. */
  const journal = await post('/api/admin/journal', { limit: 200 });
  check('панель: журнал отдаётся', journal.status === 200 && Array.isArray(journal.data.rows));
  const actions = new Set((journal.data.rows || []).map((r) => r.action));
  for (const action of ['settings', 'note_add', 'limits', 'export', 'credit']) {
    check(`панель: журнал записал «${action}»`, actions.has(action));
  }
}

/* ---------- Казино ---------- */

/*
 * Без ключа агрегатора сервер работает на снимке каталога: лобби, поиск и
 * порядок проверяются по-настоящему, запуск честно отказывает. Деньги
 * кошелька проверяет test:casino напрямую, здесь - только его дверь: чужой
 * адрес не проходит.
 */
{
  check('казино: раздел открыт в конфиге', config.open?.casino === true);
  check('казино: отдача в конфиге из пределов 70-80', config.casino?.rtp >= 70 && config.casino?.rtp <= 80,
        String(config.casino?.rtp));

  const lobby = await post('/api/casino/lobby');
  check('казино: лобби отдаётся', lobby.status === 200, `статус ${lobby.status}`);
  // Игры без обложки не считаются: их не показывают (см. ниже).
  check('казино: слотов больше четырёх с половиной тысяч', lobby.data.counts?.slots > 4500, String(lobby.data.counts?.slots));
  // Живые столы показываются, только когда агрегатор их отдаёт агенту:
  // в списке разрешённых они есть, а открывает их партнёр.
  const liveProviders = (lobby.data.providers || []).filter((p) => p.kind === 'live');
  check('казино: живые столы и их провайдеры сходятся',
        (lobby.data.counts?.live || 0) === liveProviders.reduce((a, p) => a + p.count, 0));
  check('казино: Pragmatic Play в провайдерах', (lobby.data.providers || []).some((p) => p.id === 'pragmatic-play'));
  check('казино: спорта среди провайдеров нет', !(lobby.data.providers || []).some((p) => /sport|betby/i.test(p.id)));

  const page = await post('/api/casino/games', { kind: 'slots', limit: 48 });
  const games = page.data.games || [];
  check('казино: страница из 48 игр', games.length === 48, String(games.length));
  // «Популярные» открывает витрина, выбранная заказчиком, в его порядке.
  // Список по колонкам двухстрочной ленты, см. FEATURED_GAMES.
  const featured = ['Gates of Olympus', 'Sweet Bonanza', 'Sugar Rush', 'Starlight Princess', 'The Dog House',
    'Big Bass Bonanza'];
  check('казино: первыми идут игры витрины заказчика',
    games.slice(0, featured.length).map((g) => g.name).join('|') === featured.join('|'),
    games.slice(0, featured.length).map((g) => g.name).join(' | '));
  check('казино: у первых игр вертикальная обложка и запасная горизонтальная',
    games.slice(0, 12).every((g) => g.vertical && g.cover && (g.alt === null || g.alt.endsWith('?w=1'))));

  // Игры без обложки на CDN не показываются (решение заказчика).
  const snapGames = JSON.parse(readFileSync(new URL('../server/casino-catalog.json', import.meta.url), 'utf8')).games;
  const bareGame = snapGames.find((g) => g.kind === 'slots' && g.cover_state === 'x');
  const visibleSlots = snapGames.filter((g) => g.kind === 'slots' && g.cover_state !== 'x').length;
  check('казино: игр без обложки нет в лобби', page.data.total === visibleSlots, `${page.data.total} / ${visibleSlots}`);
  check('казино: у каждой игры в списке есть обложка', games.every((g) => typeof g.cover === 'string' && g.cover));
  if (bareGame) {
    const found = await post('/api/casino/games', { q: bareGame.name, kind: 'slots' });
    check('казино: игру без обложки не найти поиском',
      !(found.data.games || []).some((g) => g.id === bareGame.id), bareGame.name);
  }
  check('казино: провайдер без единой обложки скрыт, счётчики без скрытых игр',
    !(lobby.data.providers || []).some((p) => p.id === 'zitro')
    && (lobby.data.providers || []).find((p) => p.id === 'merkur')?.count === 3);
  const fastAll = await post('/api/casino/games', { kind: 'fast', limit: 48 });
  const fastNames = (fastAll.data.games || []).map((g) => g.name);
  check('казино: Balloon последним в быстрых играх', fastNames[fastNames.length - 1] === 'Balloon', fastNames.join(' | '));
  check('казино: обложки наши, а не CDN агрегатора', games.every((g) => g.cover.startsWith('/casino/cover/')));
  check('казино: у слотов показана наша отдача', games.every((g) => g.rtp === config.casino.rtp));

  const next = await post('/api/casino/games', { kind: 'slots', limit: 48, offset: 48 });
  check('казино: вторая страница не повторяет первую',
        !(next.data.games || []).some((g) => games.some((x) => x.id === g.id)));

  const prov = await post('/api/casino/games', { provider: 'hacksaw', limit: 96 });
  check('казино: страница провайдера только его игры',
        prov.data.total > 0 && prov.data.games.every((g) => g.providerId === 'hacksaw'), String(prov.data.total));

  const found = await post('/api/casino/games', { q: 'sweet bonanza' });
  check('казино: поиск находит по названию',
        found.data.total > 0 && found.data.games.every((g) => /sweet bonanza/i.test(g.name)), String(found.data.total));

  // Меню и блоки лобби по образцу 1Win.
  check('казино: меню вкладок', (lobby.data.tabs || []).map((t) => t.label).join('|') === 'Слоты|Live казино|Быстрые игры',
        JSON.stringify(lobby.data.tabs));
  const home = await post('/api/casino/home', { kind: 'slots' });
  const blocks = home.data.blocks || [];
  check('казино: лобби из блоков, «Популярные» первые', blocks[0]?.id === 'popular' && blocks.length >= 5,
        blocks.map((b) => b.id).join(','));
  check('казино: в «Популярных» 10-20 игр', blocks[0]?.games.length >= 10 && blocks[0]?.games.length <= 20,
        String(blocks[0]?.games.length));
  check('казино: у плиток блоков наши обложки',
        blocks.every((b) => b.games.every((g) => g.cover.startsWith('/casino/cover/'))));
  check('казино: блоки провайдеров в лобби', blocks.some((b) => b.type === 'provider'));
  const mw = await post('/api/casino/games', { kind: 'slots', category: 'megaways', limit: 48 });
  check('казино: «Все» блока - игры только этой категории',
        mw.data.total > 10 && mw.data.games.every((g) => /megaways/i.test(g.name)), String(mw.data.total));
  const fakeCat = await post('/api/casino/games', { kind: 'slots', category: 'нет-такой', limit: 5 });
  check('казино: неизвестная категория не ломает список',
        fakeCat.status === 200 && fakeCat.data.total === lobby.data.counts?.slots, String(fakeCat.data.total));
  const liveHome = await post('/api/casino/home', { kind: 'live' });
  check('казино: вкладка Live отвечает и без столов', liveHome.status === 200 && Array.isArray(liveHome.data.blocks));

  // Шлюз Sicilia без ключей: способ оплаты скрыт, создать нельзя, а колбэк
  // с чужой подписью отвергается, даже когда шлюз выключен.
  const sicOpt = await post('/api/sicilia/options');
  check('sicilia: без ключей способ оплаты выключен', sicOpt.status === 200 && sicOpt.data.enabled === false);
  const sicCreate = await post('/api/sicilia/create', { amount: 1000 });
  check('sicilia: без ключей пополнение отвечает 503', sicCreate.status === 503, `статус ${sicCreate.status}`);
  const sicHook = await fetch(BASE + '/api/webhooks/sicilia', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ InvId: 'lb-1-x', OutSum: '1000.0000', Status: 'completed', SignatureValue: 'подделка' }) });
  check('sicilia: колбэк с чужой подписью отвергнут', sicHook.status === 401, `статус ${sicHook.status}`);
  const sicList = await post('/api/sicilia/list');
  check('sicilia: список оплат игрока отдаётся', sicList.status === 200 && Array.isArray(sicList.data.rows));
  const payoutsAdm = await post('/api/admin/payouts', { status: 'all' });
  check('sicilia: в заявках на вывод есть признак шлюза', payoutsAdm.status === 200 && payoutsAdm.data.siciliaReady === false
    && typeof payoutsAdm.data.gateway === 'object');

  const noKeys = await post('/api/casino/launch', { gameId: games[0]?.id });
  check('казино: без ключа агрегатора запуск отказывает 503', noKeys.status === 503, `статус ${noKeys.status}`);
  const unknown = await post('/api/casino/launch', { gameId: 'нет-такой' });
  check('казино: неизвестная игра 404', unknown.status === 404, `статус ${unknown.status}`);
  const noCover = await fetch(BASE + '/casino/cover/нет-такой');
  check('казино: обложка неизвестной игры 404', noCover.status === 404, `статус ${noCover.status}`);

  const wallet = await post('/api/casino/wallet', [{ method: 'get_balance', userId: `lb${me.id}` }],
    { 'x-agent-name': 'x', 'x-agent-token': 'y' });
  check('казино: кошелёк не принимает чужой адрес', wallet.status === 403 && wallet.data.statusCode !== 0,
        `статус ${wallet.status}`);

  // Отдача из панели доходит до конфига и зажимается в пределы агрегатора.
  await post('/api/admin/settings/save', { patch: { casino_rtp: 75 } });
  check('казино: отдача из панели доходит до конфига', (await get('/api/config')).casino.rtp === 75);
  await post('/api/admin/settings/save', { patch: { casino_rtp: 95 } });
  check('казино: отдача выше предела агрегатора зажимается', (await get('/api/config')).casino.rtp === 80);
  await post('/api/admin/settings/save', { patch: { casino_rtp: 70 } });

  await post('/api/admin/settings/save', { patch: { games_casino: false } });
  const off = await post('/api/casino/lobby');
  check('казино: выключенный раздел отвечает 503', off.status === 503, `статус ${off.status}`);
  await post('/api/admin/settings/save', { patch: { games_casino: true } });

  const adm = await post('/api/admin/casino');
  check('казино: сводка в панели', adm.status === 200 && adm.data.sync?.games > 5000, `статус ${adm.status}`);
}

/* ---------- Мини-игры сняты ---------- */

/*
 * Раздел удалён по решению заказчика. Проверяем, что от него не осталось
 * входа: ручка не принимает ставку, конфиг игр не отдаёт, выключателя в
 * настройках нет. Иначе забытая ручка списывала бы деньги в игре, которой
 * на экране уже нет.
 */
{
  const gone = await post('/api/mini/play', { gameId: 'smallwheel', option: 0, bet: 100 });
  check('мини-игр нет: ручка ставки не отвечает', gone.status === 404, `статус ${gone.status}`);
  check('мини-игр нет: конфиг их не отдаёт', !('minigames' in config));
  check('мини-игр нет: выключателя в настройках нет',
        !Object.prototype.hasOwnProperty.call(config.open || {}, 'mini'));
}

/* ---------- Уборка за собой ---------- */

/*
 * Прогон обязан оставить игрока в состоянии, из которого можно играть
 * дальше. Иначе следующий тест (интерфейсный, он ходит в тот же сервер)
 * падает на ровном месте: открытие кейса показывает не ленту, а
 * недоигранную риск-игру, начатую здесь.
 *
 * Ловилось это тяжело: сам прогон API проходил целиком и зелёным.
 */
{
  const me2 = (await post('/api/me')).data.user;
  if (me2.gambleStake > 0) {
    await post('/api/gamble/skip');
  }
  const clean = (await post('/api/me')).data.user;
  check('прогон не оставил недоигранную риск-игру', !clean.gambleStake,
        `ставка ${clean.gambleStake}`);

  /*
   * Фриспины могли выпасть плюшкой в любом из открытых здесь кейсов: деньги
   * за них уже на балансе, но серия ждёт докрутки. Интерфейсный тест после
   * этого показывал бы не ленту кейса, а экран фриспинов.
   */
  if ((await post('/api/freespins/pending')).data.pending) {
    await post('/api/freespins/ack');
  }
  const spins = (await post('/api/freespins/pending')).data;
  check('прогон не оставил недокрученных фриспинов', !spins.pending,
        JSON.stringify(spins.pending));

  check('прогон оставил игроку деньги на следующие тесты', clean.balance > 100000,
        `${clean.balance}`);
}

/* ---------- Вход на сайт ---------- */

/*
 * Всё остальное в этом файле идёт от тестового игрока DEV_MODE. Здесь
 * заголовок X-Dev-Anon выключает подмену, и сервер ведёт себя как на сайте:
 * без сессии - гость, с cookie - тот, кто вошёл.
 */
{
  const ANON = { 'X-Dev-Anon': '1' };
  async function req(path, body, { cookie = '', headers = {} } = {}) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ANON, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: JSON.stringify(body || {}),
    });
    const set = res.headers.get('set-cookie') || '';
    const m = /lb_session=([^;]*)/.exec(set);
    return { status: res.status, data: await res.json().catch(() => ({})), cookie: m ? `lb_session=${m[1]}` : '', set };
  }
  const email = `site${Date.now()}@mail.ru`;

  const guest = await req('/api/me');
  check('сайт: гость получает 401 с кодом AUTH', guest.status === 401 && guest.data.code === 'AUTH',
    `${guest.status} ${JSON.stringify(guest.data)}`);
  const guestOpen = await req('/api/open', { caseId: 'warmup_100' });
  check('сайт: гость не открывает кейс', guestOpen.status === 401);
  const guestLobby = await req('/api/casino/home', { kind: 'slots' });
  check('сайт: гость видит лобби казино', guestLobby.status !== 401, `${guestLobby.status}`);
  check('сайт: гость не запускает игру казино', (await req('/api/casino/launch', { gameId: 1 })).status === 401);

  const reg = await req('/api/auth/register', { email: email.toUpperCase(), password: 'secret123', nick: 'Сайт' });
  check('регистрация: успешна и ставит cookie', reg.status === 200 && !!reg.cookie, `${reg.status} ${JSON.stringify(reg.data)}`);
  check('регистрация: cookie httpOnly и SameSite', /HttpOnly/i.test(reg.set) && /SameSite=Lax/i.test(reg.set));
  check('регистрация: почта в нижнем регистре', reg.data.user?.email === email);
  check('регистрация: ответ не отдаёт хеш пароля', !JSON.stringify(reg.data).includes('scrypt$'));

  const me = await req('/api/me', null, { cookie: reg.cookie });
  check('сессия: по cookie сервер узнаёт игрока', me.status === 200 && me.data.user?.email === email);
  check('сессия: игрок без Telegram', me.data.user?.telegram === null && me.data.user?.hasPassword === true);
  check('сессия: игрок не тестовый из DEV_MODE', me.data.user?.id !== (await post('/api/me')).data.user.id);

  const dup = await req('/api/auth/register', { email, password: 'secret123', nick: 'Клон' });
  check('регистрация: повтор почты - 409', dup.status === 409 && dup.data.code === 'EMAIL_TAKEN');
  const badMail = await req('/api/auth/register', { email: 'нет', password: 'secret123', nick: 'Сайт' });
  check('регистрация: кривая почта - 400', badMail.status === 400);
  const shortPass = await req('/api/auth/register', { email: `x${email}`, password: '123', nick: 'Сайт' });
  check('регистрация: короткий пароль - 400', shortPass.status === 400);

  const wrong = await req('/api/auth/login', { email, password: 'wrong-pass' });
  const nobody = await req('/api/auth/login', { email: `nobody${email}`, password: 'wrong-pass' });
  check('вход: неверный пароль - 401', wrong.status === 401 && !wrong.cookie);
  check('вход: ответы для чужой и несуществующей почты одинаковые',
    wrong.data.error === nobody.data.error && nobody.status === 401);
  const login = await req('/api/auth/login', { email, password: 'secret123' });
  check('вход: верный пароль - новая сессия', login.status === 200 && !!login.cookie && login.cookie !== reg.cookie);

  const evil = await req('/api/me', null, { cookie: login.cookie, headers: { Origin: 'https://evil.example' } });
  check('чужая страница с cookie игрока - 403', evil.status === 403);
  const evilLogin = await req('/api/auth/login', { email, password: 'secret123' }, { headers: { Origin: 'https://evil.example' } });
  check('вход с чужой страницы - 403', evilLogin.status === 403);

  const badCurrent = await req('/api/auth/password', { current: 'nope-nope', password: 'newsecret1' }, { cookie: login.cookie });
  check('смена пароля: без верного текущего - 401', badCurrent.status === 401);
  const changed = await req('/api/auth/password', { current: 'secret123', password: 'newsecret1' }, { cookie: login.cookie });
  check('смена пароля: проходит', changed.status === 200);
  check('смена пароля: другое устройство вышло', (await req('/api/me', null, { cookie: reg.cookie })).status === 401);
  check('смена пароля: текущее устройство осталось', (await req('/api/me', null, { cookie: login.cookie })).status === 200);
  check('смена пароля: старый пароль больше не подходит',
    (await req('/api/auth/login', { email, password: 'secret123' })).status === 401);

  const fakeTg = await req('/api/auth/telegram', { data: { id: 1, auth_date: Math.floor(Date.now() / 1000), hash: '00' } });
  check('Telegram: поддельная подпись - 401', fakeTg.status === 401);
  const fakeLink = await req('/api/auth/link-telegram', { data: { id: 1, hash: '00' } }, { cookie: login.cookie });
  check('Telegram: поддельная привязка - 401', fakeLink.status === 401);

  if (!config.auth?.mail) {
    const forgot = await req('/api/auth/forgot', { email });
    check('сброс: без почтового сервера честно 503', forgot.status === 503);
  }
  check('сброс: чужой токен не подходит',
    (await req('/api/auth/reset', { token: 'nope', password: 'newsecret2' })).status === 400);

  const out = await req('/api/auth/logout', null, { cookie: login.cookie });
  check('выход: cookie стирается', out.status === 200 && /Max-Age=0/i.test(out.set));
  check('выход: сессия больше не действует', (await req('/api/me', null, { cookie: login.cookie })).status === 401);

  // Закрытая регистрация не пускает новых, но не трогает тех, кто уже есть.
  await post('/api/admin/settings/save', { patch: { registration_open: false } });
  const closed = await req('/api/auth/register', { email: `closed${email}`, password: 'secret123', nick: 'Поздний' });
  const stillIn = await req('/api/auth/login', { email, password: 'newsecret1' });
  await post('/api/admin/settings/save', { patch: { registration_open: true } });
  check('закрытая регистрация: новый не заводится', closed.status === 403);
  check('закрытая регистрация: прежний входит', stillIn.status === 200);
}

/* ---------- Итог ---------- */

console.log(`Пройдено проверок: ${passed}`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.forEach((f) => console.error('  • ' + f));
  process.exit(1);
}
console.log('Все проверки API пройдены.\n');
