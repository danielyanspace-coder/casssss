/**
 * Сквозной тест серверного API.
 *
 * Проверяет не «отвечает ли эндпоинт», а арифметику: сходится ли баланс,
 * тратится ли ваучер, нельзя ли рискнуть одним выигрышем дважды, закрыт ли
 * админский доступ для обычного игрока.
 *
 * Запуск: node test/api.mjs [http://localhost:3000]
 */

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

const get = async (path) => (await fetch(BASE + path)).json();

const config = await get('/api/config');
const me = (await post('/api/me')).data.user;

console.log(`Базовый адрес: ${BASE}`);
console.log(`Кейсов: ${config.cases.length}, игрок #${me.id}, админ: ${me.isAdmin}\n`);

/* ---------- Пополняем баланс для тестов ---------- */

await post('/api/admin/balance', { userId: me.id, amount: 50_000_000, note: 'тестовый прогон' });

/* ---------- 1. Кейсы: арифметика баланса ---------- */

{
  const cheap = config.cases.find((c) => c.id === 'warmup_100');
  let mismatches = 0;
  let notInTable = 0;

  for (let i = 0; i < 40; i++) {
    const before = (await post('/api/me')).data.user;
    const { data } = await post('/api/open', { caseId: cheap.id });

    // Фриспины есть теперь у каждого кейса, и серия зачисляется тем же
    // ответом — без её учёта ожидание расходится каждый раз, когда она выпала.
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

  await post('/api/admin/balance', { userId: me.id, amount: 50_000_000, note: 'возврат' });
}

/* ---------- 3. Несуществующий кейс ---------- */

{
  const r = await post('/api/open', { caseId: 'нет-такого' });
  check('несуществующий кейс: 404', r.status === 404, `статус ${r.status}`);
}

/* ---------- 4. Риск-игра ---------- */

{
  // Крутим, пока не будет выигрыша, — рисковать можно только выигранным.
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

  // Наружу уходит только витринное — ни идентификаторов, ни балансов.
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
  await post('/api/admin/balance', { userId: me.id, amount: 5_000_000, note: 'пачка' });
  const c = config.cases.find((x) => x.id === 'neon_500');
  const before = (await post('/api/me')).data.user;

  const r = await post('/api/open', { caseId: c.id, count: 5 });
  check('пачка: открыто ровно столько, сколько просили',
        r.data.count === 5 && r.data.opened?.length === 5, `count ${r.data.count}`);

  // Любое из пяти открытий могло выдать серию фриспинов — она начисляется тем
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
  check('пачка: количество ограничено сверху', tooMany.data.count <= 5, `count ${tooMany.data.count}`);
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
  // решатель разойдётся с заявленным значением, поймать это больше негде —
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
  await post('/api/admin/balance', { userId: me.id, amount: 1234, note: 'проверка' });
  const after = (await post('/api/me')).data.user.balance;
  check('админка: начисление меняет баланс ровно на сумму', after === before + 1234,
        `${after} vs ${before + 1234}`);

  await post('/api/admin/balance', { userId: me.id, amount: -(after + 999999), note: 'проверка' });
  const floor = (await post('/api/me')).data.user.balance;
  check('админка: списание не уводит баланс ниже нуля', floor === 0, `баланс ${floor}`);
  await post('/api/admin/balance', { userId: me.id, amount: 100000, note: 'возврат' });

  const zero = await post('/api/admin/balance', { userId: me.id, amount: 0 });
  check('админка: нулевая сумма отклонена', zero.status === 400);

  const self = await post('/api/admin/block', { userId: me.id, blocked: true });
  check('админка: нельзя заблокировать самого себя', self.status === 400, `статус ${self.status}`);
}

/* ---------- 11. Касса ---------- */

{
  await post('/api/admin/balance', { userId: me.id, amount: 200_000, note: 'касса' });
  const start = (await post('/api/wallet')).data;

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
      await post('/api/admin/balance', { userId: me.id, amount: target - now, note: 'фриспины' });
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

    // До даты старта сервер обязан отказать, после — открыть как обычно.
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
  await post('/api/admin/balance', { userId: me.id, amount: 5_000_000, note: 'фриспины' });
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
  check('баланс вырос на сумму промокода',
        r.data.user.balance === before.balance + 1000);
  check('отыгрыш начислен множителем',
        r.data.user.wagerRequired === before.wagerRequired + 2000,
        `${r.data.user.wagerRequired}`);

  const again = await post('/api/promo/redeem', { code: codeBalance });
  check('повторная активация отклонена', again.status === 400);

  // Пока отыгрыш не закрыт, вывод недоступен.
  const blocked = await post('/api/payout/create', { amount: config.minPayout });
  check('вывод закрыт до отыгрыша', blocked.data.error === 'WAGER', blocked.data.error);

  // Отыгрываем ставками и проверяем, что вывод открылся.
  let guard = 0;
  while ((await post('/api/me')).data.user.wagerRequired > 0 && guard++ < 200) {
    await post('/api/open', { caseId: 'warmup_100', count: 5 });
  }
  check('ставки гасят отыгрыш',
        (await post('/api/me')).data.user.wagerRequired === 0);

  const allowed = await post('/api/payout/create',
    { amount: config.minPayout, method: 'sbp', phone: '79001234567', bank: 'Сбербанк' });
  check('после отыгрыша вывод открылся', allowed.status === 200, `HTTP ${allowed.status}`);
  if (allowed.data.id) await post('/api/payout/cancel', { id: allowed.data.id });

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

/* ---------- Итог ---------- */

console.log(`Пройдено проверок: ${passed}`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.forEach((f) => console.error('  • ' + f));
  process.exit(1);
}
console.log('Все проверки API пройдены.\n');
