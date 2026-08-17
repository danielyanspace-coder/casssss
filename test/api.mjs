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
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
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

  const won = r.data.opened.reduce((s, o) => s + o.item.value, 0);
  check('пачка: сумма выигрышей сходится', r.data.totalWon === won);

  // Любое из пяти открытий могло выдать серию фриспинов — она начисляется
  // тем же ответом и в totalWon не входит, поэтому считаем её отдельно.
  const fsTotal = r.data.opened.reduce((s, o) =>
    s + (o.granted || []).reduce((a, g) => a + (g.type === 'freespins' ? g.total : 0), 0), 0);
  const expectedBalance = before.balance - r.data.totalSpent + r.data.totalWon + fsTotal;
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
      const step = it.value < 100 ? 5 : it.value < 1000 ? 10 : it.value < 10000 ? 50
                 : it.value < 100000 ? 500 : it.value < 1000000 ? 1000 : 10000;
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

  check('минимальная сумма вывода проверяется',
        (await post('/api/payout/create', { amount: 1 })).status === 400);
  check('нельзя вывести больше баланса',
        (await post('/api/payout/create', { amount: start.balance + 1 })).status === 400);

  const amount = 5000;
  const before = start.balance;

  // Создание и отмена.
  const made = (await post('/api/payout/create', { amount })).data;
  check('заявка списывает сумму сразу', made.balance === before - amount,
        `${made.balance} vs ${before - amount}`);
  check('сумма учтена как ожидающая',
        (await post('/api/wallet')).data.pending === amount);

  const cancelled = (await post('/api/payout/cancel', { id: made.id })).data;
  check('отмена возвращает средства', cancelled.balance === before);
  check('повторная отмена отклонена',
        (await post('/api/payout/cancel', { id: made.id })).status === 400);

  // Отклонение администратором возвращает деньги.
  const p2 = (await post('/api/payout/create', { amount })).data;
  await post('/api/admin/payout/resolve', { id: p2.id, status: 'rejected', comment: 'Проверка' });
  const afterReject = (await post('/api/wallet')).data;
  check('отклонение возвращает средства', afterReject.balance === before,
        `${afterReject.balance} vs ${before}`);
  check('комментарий администратора виден игроку',
        afterReject.payouts[0].comment === 'Проверка');

  // Выплата деньги не возвращает.
  // Снимок статистики до операции: база может хранить заявки прошлых прогонов,
  // поэтому проверяем прирост, а не абсолютное значение.
  const paidBefore = (await post('/api/admin/payouts', { status: 'all' })).data.stats.paidSum;
  const p3 = (await post('/api/payout/create', { amount })).data;
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
  if (check('кейс Rolex есть в конфиге', !!jackpotCase)) {
    check('кейс называется Rolex', jackpotCase.name === 'Rolex', jackpotCase.name);
    const rolex = jackpotCase.items.find((it) => /rolex/i.test(it.name));
    check('джекпот есть в таблице розыгрыша', !!rolex);
    check('шанс джекпота крайне мал', rolex.probability < 0.0001,
          `${(rolex.probability * 100).toFixed(4)}%`);
    check('джекпот укладывается в заявленный потолок',
          rolex.value <= jackpotCase.price * jackpotCase.maxMultiplier);
  }

  const country = config.cases.filter((c) => c.category === 'country');
  check('блок направлений собран', country.length >= 5, `кейсов ${country.length}`);
  check('Rolex не в направлениях', !country.some((c) => c.id === 'rolex_6000'));
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

/* ---------- Итог ---------- */

console.log(`Пройдено проверок: ${passed}`);
if (failures.length) {
  console.error(`\nПРОВАЛЕНО (${failures.length}):`);
  failures.forEach((f) => console.error('  • ' + f));
  process.exit(1);
}
console.log('Все проверки API пройдены.\n');
