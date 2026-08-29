/**
 * Аналитика, воронка и поводы для напоминаний бота.
 *
 * Проверяется на функциях базы, а не через HTTP: воронка - это арифметика по
 * когорте, и врать она может только в цифрах.
 *
 * Запуск: node test/analytics.mjs
 */
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/analytics-test.db';
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

const {
  db, getOrCreateUser, trackEvent, funnelStats, eventTotals,
  FUNNEL_STEPS, CLIENT_EVENTS,
  pendingSpinReminders, freeCaseReminders, markNoticeSent,
  savePendingSpins,
} = await import('../server/db.js');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail ? ' - ' + detail : ''}`);
};

/* ---------- запись событий ---------- */

const a = getOrCreateUser({ id: 'an-a', username: 'a' });
const b = getOrCreateUser({ id: 'an-b', username: 'b' });
const c = getOrCreateUser({ id: 'an-c', username: 'c' });

check('регистрация записывает событие сама',
  db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE name='signup'").get().n === 3);

check('известное событие пишется', trackEvent(a.id, 'case_open', { caseId: 'dust' }) === true);
check('неизвестное событие отвергается', trackEvent(a.id, 'нет-такого') === false);
check('неизвестное событие не попало в таблицу',
  db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE name='нет-такого'").get().n === 0);
check('свойства сохраняются строкой JSON',
  JSON.parse(db.prepare("SELECT props p FROM analytics_events WHERE name='case_open'").get().p).caseId === 'dust');
check('клиентские события входят в разрешённые', CLIENT_EVENTS.has('cashier_view'));
check('открытие кейса клиенту слать нельзя', !CLIENT_EVENTS.has('case_open'));

/* ---------- воронка ---------- */

trackEvent(b.id, 'case_open');
trackEvent(a.id, 'cashier_view');
trackEvent(b.id, 'cashier_view');
trackEvent(a.id, 'deposit_created');
trackEvent(a.id, 'deposit_paid', { amount: 1000 });
db.prepare("INSERT INTO deposits (user_id, amount, source, comment, created_at) VALUES (?,?,'beeline','',?)")
  .run(a.id, 1000, Date.now());

const f = funnelStats(7);
const step = (name) => f.steps.find((s) => s.name === name);

check('когорта - все зарегистрированные за период', f.cohort === 3);
check('шаги идут в объявленном порядке',
  f.steps.map((s) => s.name).join() === FUNNEL_STEPS.map((s) => s.name).join());
check('первый шаг равен когорте', step('signup').users === 3);
check('кейс открыли двое', step('case_open').users === 2);
check('в кассу зашли двое', step('cashier_view').users === 2);
check('пополнил один', step('deposit_paid').users === 1);
check('до вывода не дошёл никто', step('payout_created').users === 0);
check('повторное событие того же игрока шаг не удваивает', (() => {
  trackEvent(b.id, 'cashier_view');
  return funnelStats(7).steps.find((s) => s.name === 'cashier_view').users === 2;
})());
check('доля от когорты считается', Math.abs(step('case_open').ofCohort - 2 / 3) < 1e-9);
check('доля от предыдущего шага считается', Math.abs(step('deposit_paid').ofPrev - 1 / 1) < 1e-9);
check('сумма пополнений когорты попала в отчёт', f.deposited === 1000);
check('средний доход на игрока считается по когорте', Math.abs(f.arpu - 1000 / 3) < 1e-9);

// Событие вчерашнего игрока не должно попадать в сегодняшнюю когорту.
const old = getOrCreateUser({ id: 'an-old', username: 'old' });
db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - 40 * 86400000, old.id);
trackEvent(old.id, 'deposit_paid', { amount: 5000 });
check('игрок вне периода в когорту не входит', funnelStats(7).cohort === 3);
check('его пополнение в отчёт периода не попало', funnelStats(7).steps.find((s) => s.name === 'deposit_paid').users === 1);

check('сводка по событиям считает и события, и игроков', (() => {
  const row = eventTotals(7).find((r) => r.name === 'cashier_view');
  return row.total === 3 && row.users === 2;
})());

/* ---------- поводы для напоминаний ---------- */

const HOUR = 3600000;
savePendingSpins(a.id, 'dust', { type: 'freespins', count: 10 });
db.prepare('UPDATE pending_spins SET created_at = ? WHERE user_id = ?')
  .run(Date.now() - 3 * HOUR, a.id);
savePendingSpins(b.id, 'dust', { type: 'freespins', count: 5 });

const spins = pendingSpinReminders(HOUR);
check('давняя недокрученная серия попадает в напоминания',
  spins.length === 1 && spins[0].id === a.id, `${spins.length}`);
check('свежая серия не тревожит игрока сразу',
  !spins.some((r) => r.id === b.id));

markNoticeSent(a.id, 'freespins', spins[0].created_at);
check('о той же серии второй раз не напоминаем',
  pendingSpinReminders(HOUR).length === 0);
check('отправленное напоминание видно в аналитике',
  db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE name='bot_reminder'").get().n === 1);

const DAY = 24 * HOUR;
check('никогда не забиравшим бесплатный кейс пишем',
  freeCaseReminders(DAY).some((r) => r.id === c.id));
markNoticeSent(c.id, 'free_case', 0);
check('приглашение в бесплатный кейс уходит один раз',
  !freeCaseReminders(DAY).some((r) => r.id === c.id));

db.prepare('UPDATE users SET free_case_at = ? WHERE id = ?').run(Date.now() - 2 * HOUR, c.id);
check('пока кулдаун не вышел, не напоминаем',
  !freeCaseReminders(DAY).some((r) => r.id === c.id));
db.prepare('UPDATE users SET free_case_at = ? WHERE id = ?').run(Date.now() - 2 * DAY, c.id);
check('после кулдауна напоминаем снова',
  freeCaseReminders(DAY).some((r) => r.id === c.id));

db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(c.id);
check('заблокированному игроку не пишем',
  !freeCaseReminders(DAY).some((r) => r.id === c.id));
db.prepare('UPDATE users SET is_blocked = 0 WHERE id = ?').run(c.id);

check('давно молчащему игроку не пишем',
  !freeCaseReminders(DAY).some((r) => r.id === old.id));

/* ---------- итог ---------- */

db.close();
for (const t of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + t, { force: true });

if (failures.length) {
  console.error(`Аналитика: ${failures.length} провалов из ${passed + failures.length}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Аналитика: ${passed} проверок пройдено`);
