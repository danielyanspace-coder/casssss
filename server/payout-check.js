/**
 * Проверка заявки на вывод: можно ли верить, что деньги игрока настоящие.
 *
 * Запускается при создании заявки и по кнопке в панели. Итог - зелёный
 * («проверено системой») или красный («есть подозрения») с перечнем причин и
 * доказательствами. Красный не отклоняет заявку сам: решает сотрудник, и
 * подтвердить красную заявку можно только вторым действием с комментарием.
 *
 * Что проверяется, по слоям:
 *
 *  1. Журнал денег (таблица ledger, пишет её триггер базы). Баланс равен
 *     сумме журнала, цепочка остатков без разрывов, нет операций без вида
 *     (изменение баланса мимо кода, например запросом руками), нет минуса.
 *  2. Источник каждой операции. Ставка и выигрыш - строка раунда с теми же
 *     суммами, пополнение - оплаченный ордер шлюза, заявка - строка заявки,
 *     начисление сотрудником - запись в журнале действий, бонус - событие
 *     бонусного счёта.
 *  3. Честность раундов. Каждый раунд пересчитывается заново из server seed,
 *     client seed и nonce: тот же ролл, тот же предмет, та же выплата. Это
 *     самая сильная проверка: выигрыш, которого не выпадало, не сойдётся.
 *  4. Правила бонусов. Приветственный бонус один, в деньги бонусы перешли не
 *     больше положенной доли пополнений.
 *  5. Один человек - один аккаунт. Тот же браузер, те же реквизиты вывода,
 *     почта-клон. Общий адрес IP только к сведению: за одним мобильным
 *     адресом сидит пол-оператора.
 *  6. Начисления сотрудниками: заявка на деньги, которые положил человек
 *     руками, всегда идёт на второе подтверждение.
 *
 * Крупный выигрыш сам по себе красным НЕ считается. Если раунд пересчитан и
 * сошёлся, это законная удача, и по правилам проекта выигрыш выводится
 * целиком.
 */
import {
  db, getUserById, seedByHash, MAX_FREE_SPINS, ensureCardHashes, bonusRules,
} from './db.js';
import { computeRoll } from './fair.js';
import { getCase, pickItem } from './cases.js';
import {
  crashPointFromRoll, rouletteSlotFromRoll, rouletteColorOf, ROULETTE_CONFIG,
  gambleAceFromRoll, GAMBLE_CONFIG, upgradeChance, upgradeWinFromRoll,
} from './games.js';

/** Версия набора проверок: сохранённый итог старой версии пересчитывается. */
export const CHECK_VERSION = 1;

db.exec(`
  CREATE TABLE IF NOT EXISTS payout_checks (
    payout_id        INTEGER PRIMARY KEY REFERENCES payouts(id),
    verdict          TEXT    NOT NULL,
    version          INTEGER NOT NULL,
    result           TEXT    NOT NULL,
    created_at       INTEGER NOT NULL,
    override_by      INTEGER,
    override_comment TEXT,
    override_at      INTEGER
  );
`);

/* ---------- Мелочи ---------- */

const rub = (kop) => kop / 100;
const fmt = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** Виды операций журнала, которые обязаны ссылаться на раунд. */
const ROUND_KINDS = new Set(['case', 'roulette', 'upgrade', 'slot', 'crash', 'gamble',
  'freespins', 'slot_jackpot']);

/** Виды, которые денег сами не двигают: все их деньги во вложенных операциях. */
const SILENT_KINDS = new Set(['fortune', 'promo']);

/**
 * Почта без того, чем один ящик притворяется несколькими: регистр, «+метка»,
 * а у Gmail ещё и точки в имени. ivan.p+1@gmail.com и ivanp@gmail.com - один
 * человек и один приветственный бонус.
 */
export function canonicalEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

const nickOf = (u) => u?.username || u?.first_name || u?.email || `#${u?.id}`;

/* ---------- 1. Журнал денег ---------- */

function checkLedger(user, rows) {
  const problems = [];
  let real = 0;
  let bonus = 0;
  let prev = null;
  let negative = null;
  for (const r of rows) {
    real += r.real_kop;
    bonus += r.bonus;
    if (prev && (prev.real_after_kop + r.real_kop !== r.real_after_kop
              || prev.bonus_after + r.bonus !== r.bonus_after)) {
      problems.push(`разрыв цепочки на записи #${r.id}`);
    }
    if (!negative && (r.real_after_kop < 0 || r.bonus_after < 0)) negative = r;
    prev = r;
  }
  const nowReal = user.balance * 100 + (user.balance_kop || 0);
  const nowBonus = user.bonus_balance || 0;
  const sumOk = real === nowReal && bonus === nowBonus;
  const lastOk = !prev || (prev.real_after_kop === nowReal && prev.bonus_after === nowBonus);

  const out = [];
  out.push({
    id: 'ledger_sum',
    title: 'Баланс сходится с журналом денег',
    ok: sumOk && lastOk,
    detail: sumOk && lastOk
      ? `${rows.length} операций, сумма ${fmt(rub(real))} ₽ и ${fmt(bonus)} ₽ бонуса равна балансу`
      : `по журналу ${fmt(rub(real))} ₽ и ${fmt(bonus)} ₽ бонуса, на счету ${fmt(rub(nowReal))} ₽ и ${fmt(nowBonus)} ₽: баланс меняли мимо журнала`,
  });
  out.push({
    id: 'ledger_chain',
    title: 'Журнал без разрывов',
    ok: problems.length === 0,
    detail: problems.length ? problems.slice(0, 5).join('; ') : 'каждый остаток равен прошлому плюс операция',
  });
  out.push({
    id: 'ledger_negative',
    title: 'Баланс ни разу не уходил в минус',
    ok: !negative,
    detail: negative ? `минус после операции #${negative.id} (${negative.kind})` : 'минусов нет',
  });

  const strange = rows.filter((r) => r.kind === 'unattributed'
    || ((r.kind === 'opening' || r.kind === 'signup') && (r.real_kop || r.bonus)));
  const labels = {
    unattributed: 'изменение баланса мимо кода (запрос руками или неучтённый путь)',
    opening: 'остаток до появления журнала, происхождение неизвестно',
    signup: 'стартовый баланс режима разработки',
  };
  out.push({
    id: 'ledger_origin',
    title: 'У каждого рубля известно происхождение',
    ok: strange.length === 0,
    detail: strange.length
      ? strange.slice(0, 5).map((r) => `#${r.id}: ${labels[r.kind]}, ${fmt(rub(r.real_kop))} ₽`).join('; ')
      : 'операций без источника нет',
  });
  return out;
}

/* ---------- 2. Источники операций ---------- */

function groupByRef(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.ref_table && r.ref_id != null ? `${r.ref_table}:${r.ref_id}` : `ctx:${r.ctx}:${r.id}`;
    const g = groups.get(key) || { table: r.ref_table, id: r.ref_id, kinds: new Set(), real: 0, bonus: 0, rows: [] };
    g.kinds.add(r.kind);
    g.real += r.real_kop;
    g.bonus += r.bonus;
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function checkSources(user, rows) {
  const bad = [];
  const staff = [];
  const groups = groupByRef(rows);
  const metaOf = (row) => { try { return JSON.parse(row.meta || '{}'); } catch { return {}; } };
  const sumRub = (g) => rub(g.real) + g.bonus;
  const returns = new Map();
  let slotFree = 0;

  for (const g of groups) {
    const kind = [...g.kinds][0];
    if (['opening', 'signup', 'unattributed'].includes(kind)) continue;
    if (kind === 'slot_free') { slotFree += sumRub(g); continue; }
    if (SILENT_KINDS.has(kind) && (g.real || g.bonus)) {
      bad.push(`${kind}: деньги без источника, ${fmt(sumRub(g))} ₽`);
      continue;
    }

    if (kind === 'migration') {
      if (g.real + g.bonus * 100 !== 0) bad.push(`перенос бонусов создал деньги: ${fmt(sumRub(g))} ₽`);
      continue;
    }

    if (!g.table) {
      bad.push(`операция «${kind}» без ссылки на источник: ${fmt(sumRub(g))} ₽`);
      continue;
    }

    if (g.table === 'rounds') {
      const round = db.prepare('SELECT * FROM rounds WHERE id = ? AND user_id = ?').get(g.id, user.id);
      if (!round) { bad.push(`раунд #${g.id} не найден`); continue; }
      const meta = metaOf(round);
      // Краш: ставка списана при старте отдельной операцией, здесь выплата.
      const expected = round.game === 'crash' ? round.payout : round.payout - round.bet - (meta.granted || 0);
      if (Math.abs(sumRub(g) - expected) > 0.001) {
        bad.push(`раунд #${round.id} (${round.game}): по журналу ${fmt(sumRub(g))} ₽, по раунду ${fmt(expected)} ₽`);
      }
      continue;
    }
    if (g.table === 'crash_rounds') {
      const cr = db.prepare('SELECT * FROM crash_rounds WHERE id = ? AND user_id = ?').get(g.id, user.id);
      if (!cr || Math.abs(sumRub(g) + cr.bet) > 0.001) bad.push(`ставка краша #${g.id} не сходится`);
      continue;
    }
    if (g.table === 'payouts') {
      const p = db.prepare('SELECT * FROM payouts WHERE id = ? AND user_id = ?').get(g.id, user.id);
      if (!p) { bad.push(`заявка #${g.id} не найдена`); continue; }
      const created = g.rows.filter((r) => r.kind === 'payout').reduce((n, r) => n + r.real_kop, 0);
      const back = g.rows.filter((r) => r.kind === 'payout_return').reduce((n, r) => n + r.real_kop, 0);
      // Неполная выплата: шлюз перевёл меньше заявки, заявка закрыта
      // выплаченной суммой (amount), остаток вернулся. Списано тогда
      // requested_amount, а возвращено ровно requested_amount - amount.
      const ordered = p.requested_amount || p.amount;
      const partial = p.status === 'paid' && p.requested_amount > p.amount;
      if (created && created !== -ordered * 100) bad.push(`заявка #${p.id}: списано ${fmt(rub(-created))} ₽ вместо ${fmt(ordered)} ₽`);
      if (back) {
        returns.set(p.id, (returns.get(p.id) || 0) + back);
        const due = partial ? ordered - p.amount : p.amount;
        if (!partial && !['cancelled', 'rejected'].includes(p.status)) bad.push(`заявка #${p.id}: деньги вернулись, а статус «${p.status}»`);
        if (back !== due * 100) bad.push(`заявка #${p.id}: возвращено ${fmt(rub(back))} ₽ вместо ${fmt(due)} ₽`);
      }
      continue;
    }
    if (g.table === 'sicilia_orders' || g.table === 'crypto_payments') {
      const o = db.prepare(`SELECT * FROM ${g.table} WHERE id = ? AND user_id = ?`).get(g.id, user.id);
      if (!o || !o.paid_at || Math.abs(sumRub(g) - (o.credited_rub || 0)) > 0.001) {
        bad.push(`пополнение по ордеру ${g.table === 'sicilia_orders' ? 'СБП' : 'крипто'} #${g.id} не подтверждено шлюзом или сумма другая`);
      }
      continue;
    }
    if (g.table === 'admin_log') {
      const log = db.prepare(`SELECT l.*, a.username, a.first_name, a.email
                                FROM admin_log l LEFT JOIN users a ON a.id = l.admin_id
                               WHERE l.id = ? AND l.target_id = ?`).get(g.id, user.id);
      if (!log || Math.abs(sumRub(g) - log.amount) > 0.001) {
        bad.push(`правка сотрудником #${g.id} не сходится с журналом действий`);
      } else if (log.amount > 0) {
        staff.push(`${fmt(log.amount)} ₽ от ${nickOf({ username: log.username, first_name: log.first_name, email: log.email, id: log.admin_id })}`
          + `, ${new Date(log.created_at).toLocaleDateString('ru-RU')}${log.note ? ` («${log.note}»)` : ''}`);
      }
      continue;
    }
    if (g.table === 'bonus_events') {
      const ev = db.prepare('SELECT * FROM bonus_events WHERE id = ? AND user_id = ?').get(g.id, user.id);
      if (!ev) { bad.push(`событие бонуса #${g.id} не найдено`); continue; }
      const ok = ev.kind === 'grant' ? g.real === 0 && g.bonus === ev.amount
        : ev.kind === 'convert' ? g.real === ev.amount * 100 && g.bonus === -ev.amount
        : ev.kind === 'refuse' ? g.real === 0 && g.bonus === -ev.amount
        : false;
      if (!ok) bad.push(`бонус #${ev.id} (${ev.kind}): журнал не сходится с событием`);
      continue;
    }
    if (g.table === 'casino_tx') {
      const tx = db.prepare('SELECT * FROM casino_tx WHERE id = ? AND user_id = ?').get(g.id, user.id);
      if (!tx) { bad.push(`операция казино #${g.id} не найдена`); continue; }
      const expected = tx.method === 'bet' ? (tx.free_round ? 0 : -tx.amount_kop)
        : tx.method === 'rollback' ? tx.amount_kop : tx.amount_kop;
      if (g.real !== expected) {
        bad.push(tx.method === 'rollback'
          ? `откат казино #${tx.id}: списать удалось ${fmt(rub(-g.real))} ₽ из ${fmt(rub(-expected))} ₽, выигрыш уже потрачен`
          : `операция казино #${tx.id}: по журналу ${fmt(rub(g.real))} ₽, у агрегатора ${fmt(rub(expected))} ₽`);
      }
      continue;
    }
    bad.push(`операция «${kind}» ссылается на неизвестный источник ${g.table}`);
  }

  // Фриспины слотов зачисляются по прокруту, а в историю серия попадает одной
  // строкой в конце: сверяется сумма за всё время плюс идущая серия.
  if (slotFree) {
    const done = db.prepare(`SELECT COALESCE(SUM(payout), 0) AS n FROM rounds
                              WHERE user_id = ? AND game = 'slot' AND subtitle = 'Серия фриспинов'`).get(user.id).n;
    const live = db.prepare('SELECT COALESCE(total_win, 0) AS n FROM slot_sessions WHERE user_id = ?').get(user.id)?.n || 0;
    if (Math.abs(slotFree - done - live) > 0.001) bad.push(`фриспины слотов: зачислено ${fmt(slotFree)} ₽, по сериям ${fmt(done + live)} ₽`);
  }

  return [
    {
      id: 'sources',
      title: 'У каждой операции есть настоящий источник',
      ok: bad.length === 0,
      detail: bad.length ? bad.slice(0, 8).join('; ') + (bad.length > 8 ? `; и ещё ${bad.length - 8}` : '')
        : 'раунды, ордера шлюзов, заявки и бонусы сходятся с журналом',
    },
    {
      id: 'staff',
      title: 'Нет денег, начисленных сотрудниками',
      ok: staff.length === 0,
      detail: staff.length ? `начисления руками: ${staff.slice(0, 5).join('; ')}` : 'начислений руками нет',
    },
  ];
}

/* ---------- 3. Честность раундов ---------- */

function seriesTotal(caseData, seed, clientSeed, startNonce, count) {
  let remaining = count;
  let nonce = startNonce;
  let total = 0;
  let spins = 0;
  while (remaining > 0 && spins < MAX_FREE_SPINS) {
    remaining--;
    const it = pickItem(caseData, computeRoll(seed, clientSeed, nonce), true);
    if (it.perk?.type === 'freespins') remaining += it.perk.count;
    total += it.value;
    nonce++;
    spins++;
  }
  return total;
}

function checkRound(round, seed, crashRows) {
  // Слоты раскладывают барабаны своим способом из seed, и их ролл в строке
  // раунда - не computeRoll. Раскладку и выплаты слотов держит свой тест
  // (test/slots.mjs), а суммы - журнал.
  if (round.game === 'slot') return null;
  const roll = computeRoll(seed, round.client_seed, round.nonce);
  if (roll !== round.roll) return 'ролл не совпадает с seed';
  let meta = {};
  try { meta = JSON.parse(round.meta || '{}'); } catch { /* старая строка */ }

  if (round.game === 'case') {
    const caseData = round.case_id ? getCase(round.case_id) : null;
    if (!caseData) return null;
    if (meta.bought) {
      const total = seriesTotal(caseData, seed, round.client_seed, round.nonce, meta.bought);
      return total === round.payout ? null : `купленная серия: пересчёт ${total} ₽, выплачено ${round.payout} ₽`;
    }
    const item = pickItem(caseData, roll);
    if (!String(round.subtitle).startsWith(item.name)) return `выпал «${item.name}», записан «${round.subtitle}»`;
    if (meta.item === undefined) return null;
    const extra = meta.extra || 0;
    if (meta.x2 && extra > item.value) return 'доплата удвоителя больше предмета';
    if (meta.x10 && extra > item.value * 9) return 'доплата ×10 больше положенной';
    if (!meta.x2 && !meta.x10 && extra) return 'доплата без удвоителя';
    const series = item.perk?.type === 'freespins'
      ? seriesTotal(caseData, seed, round.client_seed, round.nonce + 1, item.perk.count) : 0;
    const expected = item.value + extra + series;
    return expected === round.payout ? null : `пересчёт ${expected} ₽, выплачено ${round.payout} ₽`;
  }

  if (round.game === 'roulette') {
    const landed = rouletteColorOf(rouletteSlotFromRoll(roll));
    // Выплата целыми рублями вниз. Раунды до этого правила записаны дробью
    // (ставка × множитель), их тоже принимаем: игрок тут ни при чём.
    const exact = round.bet * ROULETTE_CONFIG.payouts[landed];
    const pays = Math.floor(exact);
    const same = (v) => v === pays || v === exact;
    if (meta.color) {
      const ok = meta.color === landed ? same(round.payout) : round.payout === 0;
      return ok ? null : `выпал ${landed}, выплачено ${round.payout} ₽ вместо ${meta.color === landed ? pays : 0} ₽`;
    }
    return round.payout === 0 || same(round.payout) ? null : `выплата не соответствует сектору ${landed}`;
  }

  if (round.game === 'upgrade') {
    if (!meta.target) return round.payout === 0 || round.payout > round.bet ? null : 'странная выплата апгрейда';
    const won = upgradeWinFromRoll(roll, upgradeChance(round.bet, meta.target));
    const expected = won ? meta.target : 0;
    return expected === round.payout ? null : `пересчёт ${expected} ₽, выплачено ${round.payout} ₽`;
  }

  if (round.game === 'gamble') {
    const ace = gambleAceFromRoll(roll);
    const win = Math.floor(round.bet * GAMBLE_CONFIG.payout);
    if (meta.pick !== undefined) {
      const expected = meta.pick === ace ? win : 0;
      return expected === round.payout ? null : `пересчёт ${expected} ₽, выплачено ${round.payout} ₽`;
    }
    const legacy = round.bet * GAMBLE_CONFIG.payout;
    return [0, win, legacy].includes(round.payout) ? null : 'выплата риск-игры не по правилам';
  }

  if (round.game === 'crash') {
    const cr = meta.crashRound ? crashRows.get(meta.crashRound) : null;
    const point = crashPointFromRoll(roll);
    if (cr && Math.abs(cr.crash_point - point) > 1e-9) return 'точка краша не совпадает с seed';
    if (round.payout > 0) {
      const at = meta.cashedAt ?? cr?.cashed_at;
      if (at == null) return null;
      if (at >= point) return `забрал на ${at}x, а взрыв был на ${point}x`;
      if (round.payout !== Math.floor(round.bet * at)) return 'выплата краша не равна ставке на множитель';
    }
    return null;
  }
  // Слоты: ролл сверен выше, раскладка барабанов пересчитывается своим тестом.
  return null;
}

function checkFairness(user) {
  const rounds = db.prepare(`SELECT * FROM rounds WHERE user_id = ? AND roll IS NOT NULL ORDER BY id`).all(user.id);
  const crashRows = new Map(db.prepare('SELECT * FROM crash_rounds WHERE user_id = ?').all(user.id).map((r) => [r.id, r]));
  const seeds = new Map();
  const seedFor = (hash) => {
    if (!seeds.has(hash)) seeds.set(hash, seedByHash(hash));
    return seeds.get(hash);
  };

  const wrong = [];
  let unknown = 0;
  let checked = 0;
  const seen = new Set();
  const dup = [];

  for (const r of rounds) {
    if (r.game === 'slot') continue;
    // Один nonce одного seed - один исход. Повтор значит, что исход
    // переиграли: тот же ролл использован дважды.
    const key = `${r.server_hash}:${r.nonce}`;
    if (seen.has(key)) dup.push(r.id);
    seen.add(key);
    const seed = seedFor(r.server_hash);
    if (!seed) { unknown++; continue; }
    const err = checkRound(r, seed, crashRows);
    checked++;
    if (err) wrong.push(`раунд #${r.id} (${r.game}): ${err}`);
  }

  const out = [{
    id: 'fair',
    title: 'Все раунды пересчитаны и совпали',
    ok: wrong.length === 0 && dup.length === 0,
    detail: wrong.length || dup.length
      ? [...wrong.slice(0, 6), dup.length ? `повтор nonce в раундах ${dup.slice(0, 5).join(', ')}` : '']
        .filter(Boolean).join('; ')
      : `пересчитано раундов: ${checked}`,
  }];
  if (unknown) {
    out.push({
      id: 'fair_unknown',
      title: 'Seed всех раундов сохранён',
      ok: false,
      detail: `${unknown} раундов нельзя пересчитать: seed сменён до появления истории seed`,
    });
  }
  return out;
}

/* ---------- 4. Правила бонусов ---------- */

function checkBonuses(user) {
  const bad = [];
  const welcome = db.prepare(`SELECT COUNT(*) AS n FROM bonus_events
                               WHERE user_id = ? AND kind = 'grant' AND source = 'welcome'`).get(user.id).n;
  if (welcome > 1) bad.push(`приветственный бонус выдан ${welcome} раза`);

  const conv = db.prepare(`SELECT * FROM bonus_events WHERE user_id = ? AND kind = 'convert' ORDER BY id`).all(user.id);
  let moved = 0;
  for (const ev of conv) {
    const realDeposits = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM deposits
                                      WHERE user_id = ? AND created_at <= ?
                                        AND source IN ('beeline', 'crypto', 'sicilia', 'admin')`)
      .get(user.id, ev.created_at).n;
    moved += ev.amount;
    if ((ev.deposits_total || 0) > realDeposits) bad.push(`перевод #${ev.id} посчитан от пополнений больше настоящих`);
    if (moved > Math.floor(((ev.deposits_total || 0) * (ev.cashout_pct || 0)) / 100)) {
      bad.push(`перевод #${ev.id}: в деньги ушло больше ${ev.cashout_pct}% пополнений`);
    }
  }
  const granted = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM bonus_events
                               WHERE user_id = ? AND kind = 'grant'`).get(user.id).n;
  return [{
    id: 'bonus',
    title: 'Бонусы по правилам',
    ok: bad.length === 0,
    detail: bad.length ? bad.join('; ')
      : `выдано бонусов ${fmt(granted)} ₽, перешло в деньги ${fmt(moved)} ₽ (потолок ${bonusRules().cashoutPct}% пополнений)`,
  }];
}

/* ---------- 5. Связанные аккаунты ---------- */

function checkLinked(user, payout) {
  ensureCardHashes();
  const red = [];
  const info = [];
  const names = new Map();
  const nameOf = (id) => {
    if (!names.has(id)) names.set(id, nickOf(getUserById(id)));
    return names.get(id);
  };

  // Тот же браузер.
  const devices = db.prepare('SELECT DISTINCT device FROM user_access WHERE user_id = ?').all(user.id).map((r) => r.device);
  const byDevice = new Set();
  for (const d of devices) {
    for (const r of db.prepare('SELECT DISTINCT user_id FROM user_access WHERE device = ? AND user_id <> ?').all(d, user.id)) {
      byDevice.add(r.user_id);
    }
  }
  if (byDevice.size) red.push(`тот же браузер: ${[...byDevice].slice(0, 6).map(nameOf).join(', ')}`);

  // Те же реквизиты вывода в заявках других аккаунтов.
  const mine = db.prepare('SELECT * FROM payouts WHERE user_id = ?').all(user.id);
  const phones = new Set(mine.map((p) => p.phone).filter(Boolean));
  const cards = new Set(mine.map((p) => p.card_hash).filter(Boolean));
  const wallets = new Set(mine.map((p) => p.crypto_address).filter(Boolean));
  if (payout) {
    if (payout.phone) phones.add(payout.phone);
    if (payout.card_hash) cards.add(payout.card_hash);
    if (payout.crypto_address) wallets.add(payout.crypto_address);
  }
  const sameReq = new Set();
  const look = (col, values) => {
    for (const v of values) {
      for (const r of db.prepare(`SELECT DISTINCT user_id FROM payouts WHERE ${col} = ? AND user_id <> ?`).all(v, user.id)) {
        sameReq.add(r.user_id);
      }
    }
  };
  look('phone', phones);
  look('card_hash', cards);
  look('crypto_address', wallets);
  if (sameReq.size) red.push(`те же реквизиты вывода: ${[...sameReq].slice(0, 6).map(nameOf).join(', ')}`);

  // Почта-клон.
  if (user.email) {
    const canon = canonicalEmail(user.email);
    const clones = db.prepare('SELECT id, email FROM users WHERE email IS NOT NULL AND id <> ?').all(user.id)
      .filter((u) => canonicalEmail(u.email) === canon);
    if (clones.length) red.push(`та же почта в другом написании: ${clones.slice(0, 4).map((u) => u.email).join(', ')}`);
  }

  // Общий адрес - только к сведению.
  const ips = db.prepare('SELECT DISTINCT ip FROM user_access WHERE user_id = ?').all(user.id).map((r) => r.ip);
  const byIp = new Set();
  for (const ip of ips) {
    for (const r of db.prepare('SELECT DISTINCT user_id FROM user_access WHERE ip = ? AND user_id <> ?').all(ip, user.id)) {
      if (!byDevice.has(r.user_id)) byIp.add(r.user_id);
    }
  }
  if (byIp.size) info.push(`общий адрес IP с ${byIp.size} аккаунтами: ${[...byIp].slice(0, 5).map(nameOf).join(', ')}`);

  const out = [{
    id: 'linked',
    title: 'Нет связанных аккаунтов',
    ok: red.length === 0,
    detail: red.length ? red.join('; ') : 'браузер, реквизиты и почта ни с кем не пересекаются',
  }];
  if (info.length) out.push({ id: 'linked_ip', title: 'К сведению', ok: true, level: 'info', detail: info.join('; ') });
  return out;
}

/* ---------- Итог ---------- */

function summary(user, ledgerRows) {
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;
  const deposited = one(`SELECT COALESCE(SUM(amount), 0) AS n FROM deposits
                          WHERE user_id = ? AND source IN ('beeline', 'crypto', 'sicilia', 'admin')`, user.id);
  const paidOut = one(`SELECT COALESCE(SUM(amount), 0) AS n FROM payouts WHERE user_id = ? AND status = 'paid'`, user.id);
  const games = ledgerRows.filter((r) => ROUND_KINDS.has(r.kind) || r.kind === 'crash_bet' || r.kind === 'casino'
    || r.kind === 'slot_free').reduce((n, r) => n + r.real_kop, 0);
  return {
    deposited,
    paidOut,
    gamesNet: rub(games),
    rounds: one('SELECT COUNT(*) AS n FROM rounds WHERE user_id = ?', user.id),
    bestWin: db.prepare('SELECT MAX(payout) AS n FROM rounds WHERE user_id = ?').get(user.id).n || 0,
    accountAgeDays: Math.floor((Date.now() - user.created_at) / 86_400_000),
  };
}

/**
 * Проверяет игрока по заявке. Ничего не меняет, кроме сохранённого итога.
 */
export function checkPayout(payoutId, { save = true } = {}) {
  const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(Number(payoutId));
  if (!payout) return null;
  const user = getUserById(payout.user_id);
  const ledgerRows = db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id').all(user.id);

  const checks = [
    ...checkLedger(user, ledgerRows),
    ...checkSources(user, ledgerRows),
    ...checkFairness(user),
    ...checkBonuses(user),
    ...checkLinked(user, payout),
  ];
  const failed = checks.filter((c) => !c.ok && c.level !== 'info');
  const result = {
    verdict: failed.length ? 'red' : 'green',
    version: CHECK_VERSION,
    checkedAt: Date.now(),
    reasons: failed.map((c) => c.title),
    checks,
    summary: summary(user, ledgerRows),
  };

  if (save) {
    db.prepare(`
      INSERT INTO payout_checks (payout_id, verdict, version, result, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(payout_id) DO UPDATE SET verdict = excluded.verdict, version = excluded.version,
        result = excluded.result, created_at = excluded.created_at
    `).run(payout.id, result.verdict, CHECK_VERSION, JSON.stringify(result), result.checkedAt);
  }
  return result;
}

/** Сохранённый итог проверки или null. Старую версию проверок пересчитывает. */
export function payoutCheck(payoutId) {
  const row = db.prepare('SELECT * FROM payout_checks WHERE payout_id = ?').get(Number(payoutId));
  if (!row || row.version !== CHECK_VERSION) return checkPayout(payoutId);
  const result = JSON.parse(row.result);
  if (row.override_by) {
    result.override = { by: row.override_by, comment: row.override_comment, at: row.override_at };
  }
  return result;
}

/**
 * Подтверждение красной заявки сотрудником. Без него красную заявку нельзя ни
 * взять в работу, ни отправить в шлюз: подозрение не должно уйти деньгами по
 * инерции, одним нажатием «выплатить».
 */
export function overridePayoutCheck(payoutId, adminId, comment) {
  const text = String(comment || '').trim();
  if (text.length < 10) {
    throw Object.assign(new Error('Опишите, почему заявку можно выплатить (от 10 символов)'), { code: 'COMMENT' });
  }
  payoutCheck(payoutId);
  db.prepare(`UPDATE payout_checks SET override_by = ?, override_comment = ?, override_at = ?
               WHERE payout_id = ?`).run(adminId, text.slice(0, 500), Date.now(), Number(payoutId));
  db.prepare(`INSERT INTO admin_log (admin_id, target_id, action, amount, note, created_at)
              SELECT ?, user_id, 'payout_risk_override', amount, ?, ? FROM payouts WHERE id = ?`)
    .run(adminId, text.slice(0, 500), Date.now(), Number(payoutId));
}

/** Можно ли двигать заявку дальше: зелёная или подтверждённая сотрудником. */
export function payoutCleared(payoutId) {
  const res = payoutCheck(payoutId);
  return !res || res.verdict === 'green' || !!res.override;
}
