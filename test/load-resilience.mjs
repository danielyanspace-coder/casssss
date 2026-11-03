// Only run against a disposable DEV_MODE database with provider keys absent.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
const base = process.argv[2];
assert.ok(base && new URL(base).hostname === '127.0.0.1');
const post = async (path, body = {}) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const initial = (await post('/api/me')).body.user;
assert.equal(initial.isAdmin, true, 'Use test admin');
await post('/api/admin/balance', { userId: initial.id, amount: 1000000, note: 'isolated load test' });
const statuses = {}, latencies = [];
let issued = 0;
const start = performance.now();
await Promise.all(Array.from({ length: 64 }, async () => {
  while (issued < 2000) {
    const i = issued++;
    const t = performance.now();
    const result = await post(i % 5 === 0 ? '/api/open' : '/api/me', i % 5 === 0 ? { caseId: 'warmup_100' } : {});
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    latencies.push(performance.now() - t);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
}));
const elapsed = performance.now() - start;
latencies.sort((a,b) => a-b);
const sql = new Database(process.argv[3], { readonly: true, fileMustExist: true });
assert.equal(sql.pragma('integrity_check', { simple: true }), 'ok');
const user = sql.prepare('SELECT * FROM users WHERE id=?').get(initial.id);
const sums = sql.prepare('SELECT SUM(real_kop) AS real, SUM(bonus) AS bonus FROM ledger WHERE user_id=?').get(initial.id);
assert.equal(user.balance * 100 + user.balance_kop, sums.real);
assert.equal(user.bonus_balance, sums.bonus);
assert.ok(user.balance >= 0);
sql.close();
console.log(JSON.stringify({ requests: issued, concurrency: 64, statuses, seconds: +(elapsed/1000).toFixed(2), rps: Math.round(issued*1000/elapsed), p95Ms: Math.round(latencies[Math.floor(latencies.length*.95)]), integrity: 'ok', ledger: 'matches balances' }, null, 2));
