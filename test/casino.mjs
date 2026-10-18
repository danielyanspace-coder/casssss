/**
 * Казино: кошелёк, копейки, отыгрыш и сборка каталога.
 *
 *   npm run test:casino
 *
 * Кошелёк проверяется по сценариям, которые гоняет сам агрегатор из своего
 * кабинета (callback-test/scenarios): получить баланс, ставка в пределах и
 * сверх баланса, ставка и выигрыш одним пакетом, выигрыш без ставки, отмена,
 * досрочное закрытие, повтор с тем же originalTransId. Здесь они идут
 * напрямую в casino-db.js, без сети: сеть и подпись проверяет test:api.
 */
import { rmSync, readFileSync } from 'node:fs';

process.env.DB_PATH = './data/casino-test.db';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const { db, getOrCreateUser, getUserById } = await import('../server/db.js');
const cdb = await import('../server/casino-db.js');
const { buildCatalog } = await import('../server/casino.js');
const cats = await import('../server/casino-categories.js');
const { casinoWallet, CASINO_STATUS: S, userBalanceRub, casinoPlayerId, toKop } = cdb;

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

/* Игрок с балансом ровно в рублях. Прямой UPDATE здесь - подготовка
   тестовой базы, а не правка денег игрока. */
let tg = 7_000_000;
function player(rub) {
  const u = getOrCreateUser({ id: ++tg, username: `t${tg}`, first_name: 'T' });
  db.prepare('UPDATE users SET balance = ?, balance_kop = 0, deposit_debt = 0, wager_required = 0 WHERE id = ?')
    .run(rub, u.id);
  return getUserById(u.id);
}

let seq = 0;
const tx = (method, user, extra = {}) => ({
  method,
  userId: casinoPlayerId(user.id),
  transactionId: `t-${++seq}`,
  originalTransId: `o-${seq}`,
  roundId: extra.roundId || `r-${seq}`,
  gameId: 'g1',
  providerId: 'Sloter-slot-pragmatic',
  currency: 'RUB',
  ...extra,
});
const bal = (u) => userBalanceRub(getUserById(u.id));
const call = (list) => casinoWallet(list, { currency: 'RUB' });

/* ---------- Баланс ---------- */

{
  const u = player(1000);
  const r = call([tx('get_balance', u)]);
  check('get_balance: успех', r.statusCode === S.OK);
  check('get_balance: баланс в рублях', r.balance === 1000, String(r.balance));
  check('неизвестный игрок: код 1', call([{ method: 'get_balance', userId: 'lb999999' }]).statusCode === S.USER_NOT_FOUND);
  check('чужой формат id: код 1', call([{ method: 'get_balance', userId: '12345' }]).statusCode === S.USER_NOT_FOUND);
  check('пустой пакет: код 3', call([]).statusCode === S.INVALID_REQUEST);
}

/* ---------- Ставка, выигрыш, копейки ---------- */

{
  const u = player(1000);
  const r = call([tx('bet', u, { amount: 0.2, roundId: 'A' })]);
  check('ставка 0.20: успех', r.statusCode === S.OK);
  check('ставка 0.20: баланс 999.80', r.balance === 999.8, String(r.balance));
  const row = getUserById(u.id);
  check('копейки лежат отдельно от рублей', row.balance === 999 && row.balance_kop === 80,
        `${row.balance} и ${row.balance_kop}`);

  const w = call([tx('win', u, { amount: 3.75, roundId: 'A' })]);
  check('выигрыш 3.75 по ставке раунда', w.statusCode === S.OK && w.balance === 1003.55, String(w.balance));

  const big = call([tx('bet', u, { amount: 5000, roundId: 'B' })]);
  check('ставка больше баланса: код 8', big.statusCode === S.LOW_BALANCE);
  check('ставка больше баланса: баланс прежний и в ответе', big.balance === 1003.55 && bal(u) === 1003.55);

  check('выигрыш без ставки: код 5', call([tx('win', u, { amount: 10, roundId: 'nope' })]).statusCode === S.BET_NOT_EXIST);
  check('выигрыш без ставки: баланс не тронут', bal(u) === 1003.55);
  check('чужая валюта: код 3', call([tx('bet', u, { amount: 1, currency: 'USD' })]).statusCode === S.INVALID_REQUEST);
  check('отрицательная сумма: код 3', call([tx('bet', u, { amount: -1 })]).statusCode === S.INVALID_REQUEST);
}

/* ---------- Пакеты: проходят целиком или никак ---------- */

{
  const u = player(100);
  const ok = call([tx('bet', u, { amount: 10, roundId: 'P' }), tx('win', u, { amount: 25, roundId: 'P' })]);
  check('ставка и выигрыш пакетом: успех', ok.statusCode === S.OK && ok.balance === 115, String(ok.balance));

  const bad = call([tx('bet', u, { amount: 500, roundId: 'Q' }), tx('win', u, { amount: 900, roundId: 'Q' })]);
  check('пакет со ставкой сверх баланса: код 8', bad.statusCode === S.LOW_BALANCE);
  check('пакет со ставкой сверх баланса: выигрыш не начислен', bal(u) === 115, String(bal(u)));

  const co = call([tx('bet', u, { amount: 15, roundId: 'C' }), tx('cashout', u, { amount: 12.5, roundId: 'C' })]);
  check('ставка и досрочное закрытие пакетом', co.statusCode === S.OK && co.balance === 112.5, String(co.balance));
  const coBad = call([tx('bet', u, { amount: 1000, roundId: 'D' }), tx('cashout', u, { amount: 5, roundId: 'D' })]);
  check('досрочное закрытие пакетом сверх баланса: код 8', coBad.statusCode === S.LOW_BALANCE && bal(u) === 112.5);
  check('досрочное закрытие без ставки: код 5', call([tx('cashout', u, { amount: 5, roundId: 'none' })]).statusCode === S.BET_NOT_EXIST);

  const rb = call([tx('bet', u, { amount: 20, roundId: 'R' }), tx('rollback', u, { roundId: 'R' })]);
  check('ставка и отмена пакетом: баланс вернулся', rb.statusCode === S.OK && rb.balance === 112.5, String(rb.balance));
  const rbBad = call([tx('bet', u, { amount: 999, roundId: 'R2' }), tx('rollback', u, { roundId: 'R2' })]);
  check('ставка сверх баланса и отмена пакетом: код 8', rbBad.statusCode === S.LOW_BALANCE && bal(u) === 112.5);
}

/* ---------- Отмена ---------- */

{
  const u = player(50);
  call([tx('bet', u, { amount: 7.3, roundId: 'X' })]);
  check('после ставки 42.70', bal(u) === 42.7, String(bal(u)));
  const r = call([tx('rollback', u, { roundId: 'X' })]);
  check('отмена ставки: баланс вернулся к 50', r.statusCode === S.OK && bal(u) === 50, String(bal(u)));
  check('отмена без ставки: код 5', call([tx('rollback', u, { roundId: 'nothing' })]).statusCode === S.BET_NOT_EXIST);
  check('повторная отмена того же раунда: отменять нечего', call([tx('rollback', u, { roundId: 'X' })]).statusCode === S.BET_NOT_EXIST);

  // Отмена раунда с выигрышем возвращает ставку и забирает выигрыш.
  call([tx('bet', u, { amount: 10, roundId: 'Y' })]);
  call([tx('win', u, { amount: 30, roundId: 'Y' })]);
  check('после ставки 10 и выигрыша 30: 70', bal(u) === 70, String(bal(u)));
  call([tx('rollback', u, { roundId: 'Y' })]);
  check('отмена раунда с выигрышем: снова 50', bal(u) === 50, String(bal(u)));

  // Отмена конкретной операции по списку transactions.
  const b1 = tx('bet', u, { amount: 4, roundId: 'Z' });
  const b2 = tx('bet', u, { amount: 6, roundId: 'Z' });
  call([b1]); call([b2]);
  call([tx('rollback', u, { roundId: 'Z', transactions: [{ transactionId: b2.transactionId }] })]);
  check('отмена одной ставки из двух по transactions', bal(u) === 46, String(bal(u)));

  // Потраченный выигрыш: отмена не уводит баланс в минус.
  const v = player(10);
  call([tx('bet', v, { amount: 10, roundId: 'W' })]);
  call([tx('win', v, { amount: 500, roundId: 'W' })]);
  db.prepare('UPDATE users SET balance = 5, balance_kop = 0 WHERE id = ?').run(v.id);
  const neg = call([tx('rollback', v, { roundId: 'W' })]);
  check('отмена потраченного выигрыша: баланс не ниже нуля', neg.statusCode === S.OK && bal(v) === 0, String(bal(v)));
}

/* ---------- Повторы: код 9 и деньги один раз ---------- */

{
  const u = player(100);
  const first = tx('bet', u, { amount: 10, roundId: 'D1' });
  call([first]);
  const again = call([{ ...first, transactionId: 'другой' }]);
  check('повтор ставки с тем же originalTransId: код 9', again.statusCode === S.DUPLICATE);
  check('повтор ставки: списано один раз', bal(u) === 90, String(bal(u)));

  const win = tx('win', u, { amount: 40, roundId: 'D1' });
  call([win]);
  check('повтор выигрыша: код 9', call([{ ...win, transactionId: 'другой' }]).statusCode === S.DUPLICATE);
  check('повтор выигрыша: начислено один раз', bal(u) === 130, String(bal(u)));

  const b = tx('bet', u, { amount: 30, roundId: 'D2' });
  call([b]);
  const rb = tx('rollback', u, { roundId: 'D2' });
  call([rb]);
  check('повтор отмены: код 9', call([{ ...rb, transactionId: 'другой' }]).statusCode === S.DUPLICATE);
  check('повтор отмены: баланс восстановлен один раз', bal(u) === 130, String(bal(u)));

  // Ставка и её отмена с одинаковым номером провайдера - разные операции.
  const same = tx('bet', u, { amount: 5, roundId: 'D3', originalTransId: 'общий' });
  call([same]);
  const r = call([tx('rollback', u, { roundId: 'D3', originalTransId: 'общий' })]);
  check('ставка и отмена с общим номером провайдера не считаются повтором', r.statusCode === S.OK && bal(u) === 130);
}

/* ---------- Фриспины, самоисключение ---------- */

{
  const u = player(20);
  const fr = call([tx('bet', u, { amount: 2, roundId: 'F', isFreeRound: true, additionalData: { freeRoundPlay: true, freeRoundId: 'pkg' } })]);
  check('ставка фриспина: деньги не списаны', fr.statusCode === S.OK && bal(u) === 20, String(bal(u)));
  call([tx('win', u, { amount: 8.4, roundId: 'F', isFreeRound: true })]);
  check('выигрыш фриспина начислен', bal(u) === 28.4, String(bal(u)));
  call([tx('rollback', u, { roundId: 'F' })]);
  check('отмена раунда фриспина забирает только выигрыш', bal(u) === 20, String(bal(u)));

  call([tx('bet', u, { amount: 5, roundId: 'E' })]);
  db.prepare(`INSERT INTO player_limits (user_id, excluded_until, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET excluded_until = excluded.excluded_until`)
    .run(u.id, Date.now() + 86_400_000, Date.now());
  check('самоисключение: новая ставка отклонена', call([tx('bet', u, { amount: 1, roundId: 'E2' })]).statusCode === S.GENERIC);
  const late = call([tx('win', u, { amount: 9, roundId: 'E' })]);
  check('самоисключение: выигрыш по прежней ставке начислен', late.statusCode === S.OK && bal(u) === 24, String(bal(u)));
}

/* ---------- Отыгрыш: копейки копятся до рубля ---------- */

{
  const u = player(1000);
  db.prepare('UPDATE users SET deposit_debt = 15, wager_required = 100 WHERE id = ?').run(u.id);
  for (let i = 0; i < 37; i++) call([tx('bet', u, { amount: 0.2 })]);
  const row = getUserById(u.id);
  // 37 ставок по 0.20 = 7.40: в отыгрыш ушло 7 рублей, 40 копеек ждут.
  check('отыгрыш депозита гасится целыми рублями оборота', row.deposit_debt === 8, String(row.deposit_debt));
  // Бонусом в казино не играют (агрегатор видит только свои деньги), и
  // ставки казино отыгрыш бонуса не гасят: его гасят ставки бонусом.
  check('отыгрыш бонуса казино не трогает', row.wager_required === 100, String(row.wager_required));
  check('остаток копеек оборота сохранён', row.casino_wager_kop === 40, String(row.casino_wager_kop));
  check('оборот казино посчитан в копейках', row.casino_bet_kop === 740, String(row.casino_bet_kop));
}

/* ---------- Точность: тысяча дробных операций ---------- */

{
  const u = player(5000);
  let expect = 5000 * 100;
  let rng = 12345;
  const rand = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1000; i++) {
    const bet = Math.round(rand() * 300) / 100 + 0.01;
    const win = rand() < 0.4 ? Math.round(rand() * 900) / 100 : 0;
    const round = `prec-${i}`;
    call([tx('bet', u, { amount: bet, roundId: round })]);
    expect -= toKop(bet);
    if (win) { call([tx('win', u, { amount: win, roundId: round })]); expect += toKop(win); }
  }
  const row = getUserById(u.id);
  check('тысяча дробных ставок: баланс до копейки', row.balance * 100 + row.balance_kop === expect,
        `${row.balance * 100 + row.balance_kop} против ${expect}`);
  check('копейки всегда от 0 до 99', row.balance_kop >= 0 && row.balance_kop <= 99);
  check('toKop снимает хвост двоичной записи', toKop(0.1 + 0.2) === 30 && toKop(1.005) === 101 && toKop(19.99) === 1999);
}

/* ---------- Каталог ---------- */

{
  const g = (id, name, providerId, extra = {}) => ({
    id, name, providerId, gameSource: providerId.split('-')[0], gameType: 0, isActive: true,
    img: `https://cdn/${id}.avif`, imgVertical: `https://cdn/${id}-v.webp`, demo: true, ...extra,
  });
  const providers = [
    { id: 'Sloter-slot-pragmatic', name: 'Pragmatic Play' },
    { id: 'NovaPlay-pragmatic-play-sp', name: 'Pragmatic Play' },
    { id: 'Sloter-slot-redrake', name: 'RedRake' },
    { id: 'Sloter-sports-betby', name: 'Betby' },
    { id: 'Sloter-mini-spribe', name: 'Spribe Gaming' },
    { id: 'Sloter-slot-Relax', name: 'Relax' },
    { id: 'NovaPlay-evolution-sp', name: 'Evolution' },
  ];
  const raw = [
    g('1', 'Zeta Slot', 'Sloter-slot-pragmatic'),
    g('2', 'Gates of Olympus', 'Sloter-slot-pragmatic'),
    g('3', 'Gates of Olympus', 'NovaPlay-pragmatic-play-sp'),
    g('4', 'Only Nova', 'NovaPlay-pragmatic-play-sp'),
    g('5', 'Red Game', 'Sloter-slot-redrake'),
    g('6', 'Betby', 'Sloter-sports-betby'),
    g('7', 'Aviator', 'Sloter-mini-spribe'),
    g('8', 'Money Train 2', 'Sloter-slot-relax', { imgVertical: null }),
    g('9', 'No Picture', 'Sloter-slot-pragmatic', { img: null, imgVertical: null }),
    g('10', 'Crazy Time', 'NovaPlay-evolution-sp', { gameType: 1, imgVertical: null }),
  ];
  const allowed = new Set(['sloter-slot-pragmatic', 'sloter-mini-spribe', 'sloter-slot-relax', 'sloter-sports-betby',
    'novaplay-evolution-sp']);
  const c = buildCatalog(raw, providers, allowed);
  const ids = new Set(c.games.map((x) => x.id));
  check('каталог: провайдер вне списка партнёра не попадает', !ids.has('5'));
  check('каталог: спорт не попадает, даже если разрешён', !ids.has('6'));
  check('каталог: слоты без настраиваемой отдачи (NovaPlay) не попадают', !ids.has('3') && !ids.has('4'));
  check('каталог: игра без картинки не попадает', !ids.has('9'));
  check('каталог: регистр в списке провайдеров не важен', ids.has('8'));
  check('каталог: у всех слотов отдача наша', c.games.filter((x) => x.kind !== 'live').every((x) => x.rtp_mode === 'operator'));
  const live = c.games.find((x) => x.id === '10');
  check('каталог: живой стол NovaPlay проходит, хотя источник другой', live?.kind === 'live');
  check('каталог: у живого стола отдача провайдера, не наша', live?.rtp_mode === 'provider');
  check('каталог: живые столы - своя вкладка у провайдера', c.providers.some((p) => p.id === 'evolution-live' && p.kind === 'live'));
  check('каталог: Spribe - быстрые игры', c.games.find((x) => x.id === '7')?.kind === 'fast');
  const order = c.games.slice().sort((a, b) => a.seed_rank - b.seed_rank).map((x) => x.name);
  check('каталог: хиты впереди', order[0] === 'Gates of Olympus' && order.indexOf('Zeta Slot') > order.indexOf('Money Train 2'),
        order.join(', '));
  check('каталог: провайдер - бренд, а не источник', c.providers.filter((p) => p.name === 'Pragmatic Play').length === 1);

  // Снимок в репозитории собран тем же правилом.
  const snap = JSON.parse(readFileSync(new URL('../server/casino-catalog.json', import.meta.url), 'utf8'));
  check('снимок: у слотов и быстрых игр наша отдача, у живых столов - провайдера',
        snap.games.every((x) => (x.kind === 'live' ? x.rtp_mode === 'provider' : x.rtp_mode === 'operator')));
  check('снимок: игр больше пяти тысяч', snap.games.length > 5000, String(snap.games.length));
  // По провайдеру, а не по названию: «Sports...» бывает и у обычного слота.
  check('снимок: без спорта', !snap.games.some((x) => /sport/i.test(x.provider_id)));

  // Популярность: ставки недели обгоняют стартовый порядок - сразу за
  // витриной заказчика, которая стоит первой по его решению.
  cdb.saveCatalog(snap.providers, snap.games);
  const lead = cats.FEATURED_GAMES.length;
  const before = cdb.casinoGames({ kind: 'slots', limit: lead + 1 }).rows.map((r) => r.id);
  const tail = cdb.casinoGames({ kind: 'slots', offset: 900, limit: 1 }).rows[0];
  const u = player(1000);
  for (let i = 0; i < 3; i++) call([tx('bet', u, { amount: 1, gameId: tail.id })]);
  const after = cdb.casinoGames({ kind: 'slots', limit: lead + 1 }).rows.map((r) => r.id);
  check('популярность: игра со ставками недели встаёт сразу за витриной',
    tail.cover_state === 'v' && after[lead] === tail.id && before[lead] !== tail.id
    && after.slice(0, lead).join() === before.slice(0, lead).join());
  check('поиск по названию', cdb.casinoGames({ q: 'olympus' }).rows.every((r) => /olympus/i.test(r.name)));
  check('поиск экранирует % и _', cdb.casinoGames({ q: '%' }).total === 0);

  // Витрина агрегатора: топ и новинки находятся по originalId.
  const withFront = buildCatalog(
    [g('20', 'Front Top', 'Sloter-slot-pragmatic', { originalId: 'ft:::pp' }),
      g('21', 'Front New', 'Sloter-slot-pragmatic', { originalId: 'fn:::pp' })],
    providers, allowed, { top: ['x', 'ft:::pp'], new: ['fn:::pp'] });
  const ft = withFront.games.find((x) => x.id === '20');
  const fn = withFront.games.find((x) => x.id === '21');
  check('витрина: место в топе агрегатора сохранено', ft?.partner_top === 1 && fn?.partner_top === null);
  check('витрина: новинка агрегатора помечена', fn?.partner_new === 1 && ft?.partner_new === 0);
}

/* ---------- Обложки и порядок ---------- */

{
  // Витрина заказчика открывает «Популярные», ровно в его порядке.
  const top = cdb.casinoGames({ kind: 'slots', limit: cats.FEATURED_GAMES.length }).rows.map((r) => r.name);
  check('популярные: первые - витрина заказчика', top.join('|') === cats.FEATURED_GAMES.join('|'), top.join(' | '));

  // Balloon в конце любого списка быстрых игр.
  const fast = cdb.casinoGames({ kind: 'fast', limit: 50 }).rows.map((r) => r.name);
  check('быстрые игры: Balloon последним', fast[fast.length - 1] === 'Balloon', fast.slice(-3).join(' | '));
  const crash = cdb.casinoGames({ kind: 'fast', category: 'crash', limit: 50 }).rows.map((r) => r.name);
  check('блок краш-игр: Balloon последним', crash[crash.length - 1] === 'Balloon', crash.join(' | '));

  // Обложка решает порядок: вертикальные, горизонтальные, без обложки.
  const rank = (r) => cats.coverRank(r.cover_state, Boolean(r.img_vertical));
  const all = cdb.casinoGames({ kind: 'slots', limit: 120, offset: 0 }).rows;
  check('популярные: сначала игры с вертикальной обложкой', all.slice(0, 60).every((r) => rank(r) === 0));
  const holiday = cdb.casinoGames({ kind: 'slots', category: 'holiday', limit: 120 }).rows.map(rank);
  check('в блоке обложки не хуже следующей: без обложки - в конце',
    holiday.every((v, i) => i === 0 || v >= holiday[i - 1]), holiday.join(''));
  // Игры без обложки не показываются нигде: ни в списке, ни в поиске, ни в
  // счётчиках провайдеров.
  const hidden = db.prepare("SELECT * FROM casino_games WHERE active = 1 AND cover_state = 'x'").all();
  const visible = db.prepare("SELECT COUNT(*) AS n FROM casino_games WHERE active = 1 AND kind = 'slots' AND COALESCE(cover_state, '') <> 'x'").get().n;
  check('игры без обложки есть в снимке', hidden.length > 100, String(hidden.length));
  check('игры без обложки не попадают в лобби', cdb.casinoGames({ kind: 'slots', limit: 1 }).total === visible);
  check('игры без обложки не находятся поиском',
    cdb.casinoGames({ q: hidden[0].name }).rows.every((r) => r.cover_state !== 'x'), hidden[0].name);
  check('игры без обложки не попадают в блоки',
    cdb.casinoHome('slots').every((b) => b.games.every((x) => x.cover_state !== 'x')));
  const provs = new Map(cdb.casinoProviders().map((p) => [p.id, p.game_count]));
  check('провайдер без единой обложки пропадает из списка', !provs.has('zitro'));
  check('счётчик провайдера - только видимые игры', provs.get('merkur') === 3, String(provs.get('merkur')));
  check('скрытая игра по-прежнему открывается по id (история)', !!cdb.casinoGame(hidden[0].id));
  check('скрытые игры отдаются на перепроверку', cdb.gamesWithoutCover().length === hidden.length);

  // Признак обложки переживает синхронизацию, пока адреса картинок те же.
  const g = cdb.casinoGames({ kind: 'slots', limit: 1 }).rows[0];
  cdb.setCoverState(g.id, 'w');
  const snapAgain = JSON.parse(readFileSync(new URL('../server/casino-catalog.json', import.meta.url), 'utf8'));
  cdb.saveCatalog(snapAgain.providers, snapAgain.games.map((x) => ({ ...x, cover_state: null })));
  check('признак обложки сохраняется при синхронизации', cdb.casinoGame(g.id).cover_state === 'w');
  cdb.saveCatalog(snapAgain.providers, snapAgain.games.map((x) => (x.id === g.id
    ? { ...x, cover_state: null, img_vertical: `${x.img_vertical}?new` } : { ...x, cover_state: null })));
  check('новая картинка - признак сбрасывается до проверки', cdb.casinoGame(g.id).cover_state === null);
  cdb.setCoverState(g.id, 'nonsense');
  check('чужой признак не записывается', cdb.casinoGame(g.id).cover_state === null);
  check('непроверенные игры отдаются на проверку', cdb.gamesWithoutCoverState(5).some((x) => x.id === g.id));
  cdb.saveCatalog(snapAgain.providers, snapAgain.games);
}

/* ---------- Блоки лобби ---------- */

{
  const ids = cats.CASINO_CATEGORIES.map((c) => c.id);
  check('категории: id не повторяются', new Set(ids).size === ids.length);
  check('категории: у каждой вкладка из меню',
    cats.CASINO_CATEGORIES.every((c) => cats.CASINO_TABS.some((t) => t.id === c.kind)));
  check('категории: «Популярные» первые в каждой вкладке',
    cats.CASINO_TABS.every((t) => cats.categoriesFor(t.id)[0]?.type === 'popular'));
  check('категории: шаблоны разбираются',
    cats.CASINO_CATEGORIES.filter((c) => c.type === 'match').every((c) => { try { new RegExp(c.pattern); return true; } catch { return false; } }));
  check('меню: Слоты, Live казино, Быстрые игры',
    cats.CASINO_TABS.map((t) => t.label).join('|') === 'Слоты|Live казино|Быстрые игры');

  // Тот же шаблон в SQL и в JS: блок Megaways состоит только из Megaways.
  const mw = cdb.casinoGames({ kind: 'slots', category: 'megaways', limit: 120 });
  check('блок по шаблону: только подходящие игры', mw.total > 10 && mw.rows.every((r) => /megaways/i.test(r.name)),
        String(mw.total));
  const mwAll = db.prepare("SELECT COUNT(*) AS n FROM casino_games WHERE active = 1 AND kind = 'slots'").all()[0].n;
  check('блок по шаблону: не весь каталог', mw.total < mwAll);

  const home = cdb.casinoHome('slots');
  check('лобби: первым блоком «Популярные»', home[0]?.id === 'popular' && home[0].rows === 2, home[0]?.id);
  check('лобби: в «Популярных» не больше заданного', home[0].games.length <= cats.POPULAR_SIZE && home[0].games.length >= 10,
        String(home[0].games.length));
  check('лобби: в блоке нет двух игр с одним названием',
    home.every((b) => new Set(b.games.map((x) => x.name.toLowerCase())).size === b.games.length));
  check('лобби: тематический блок не короче порога',
    home.filter((b) => b.type === 'match').every((b) => b.games.length >= cats.MIN_BLOCK_GAMES));
  const provBlocks = home.filter((b) => b.type === 'provider');
  check('лобби: блоки провайдеров после тематических',
    provBlocks.length > 0 && provBlocks.length <= cats.PROVIDER_BLOCKS
    && home.findIndex((b) => b.type === 'provider') > home.findLastIndex((b) => b.type !== 'provider'));
  check('лобби: блок провайдера только из его игр',
    provBlocks.every((b) => b.games.every((x) => x.provider_id === b.provider)));
  check('лобби: «Все N» знает полный размер блока', home.every((b) => b.total >= b.games.length));
  const fast = cdb.casinoHome('fast');
  check('быстрые игры: свои блоки, без слотов', fast.length > 0 && fast.every((b) => b.games.every((x) => x.kind === 'fast')));

  // Лучшие выигрыши: настоящий раунд с множителем, фриспин не в счёт.
  const slot = cdb.casinoGames({ kind: 'slots', category: 'megaways', limit: 1 }).rows[0];
  const other = cdb.casinoGames({ kind: 'slots', category: 'books', limit: 1 }).rows[0];
  const w = player(1000);
  call([tx('bet', w, { amount: 2, gameId: slot.id, roundId: 'BW1' })]);
  call([tx('win', w, { amount: 50, gameId: slot.id, roundId: 'BW1' })]);
  call([tx('bet', w, { amount: 0, gameId: other.id, roundId: 'BW2', isFreeRound: true })]);
  call([tx('win', w, { amount: 500, gameId: other.id, roundId: 'BW2', isFreeRound: true })]);
  const bw = cdb.casinoGames({ category: 'bigwins', limit: 20 }).rows;
  check('лучшие выигрыши: раунд с множителем ×25', bw[0]?.id === slot.id && bw[0].win_mult === 25,
        JSON.stringify(bw[0] && { id: bw[0].id, m: bw[0].win_mult }));
  check('лучшие выигрыши: фриспин без ставки не в счёт', !bw.some((r) => r.id === other.id));
  const after = cdb.casinoHome('slots');
  check('лучшие выигрыши: блок появляется только с раундами',
    !home.some((b) => b.id === 'bigwins') && (bw.length >= cats.MIN_BLOCK_GAMES) === after.some((b) => b.id === 'bigwins'));
}

/* ---------- итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

if (failures.length) {
  console.error(`Казино: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Казино: ${passed} проверок пройдено`);
