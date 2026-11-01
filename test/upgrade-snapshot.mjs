// Только на отдельной копии базы: импорт запускает миграцию схемы.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
const path = resolve(process.env.DB_PATH || '');
assert.ok(process.env.DB_PATH && !path.startsWith('/srv/'), 'Проверка принимает только изолированную копию');
const beforeDb = new Database(path,{readonly:true,fileMustExist:true});
const before = beforeDb.prepare('SELECT id,balance,balance_kop,bonus_balance FROM users ORDER BY id').all();
const rowsBefore = beforeDb.prepare('SELECT COUNT(*) AS n FROM rounds').get().n;
beforeDb.close();
const { db } = await import('../server/db.js');
await import('../server/finance.js');
const after = db.prepare('SELECT id,balance,balance_kop,bonus_balance FROM users ORDER BY id').all();
assert.deepEqual(after,before,'Миграция не должна менять существующие деньги');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n,rowsBefore);
assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
const {checkPayout} = await import('../server/payout-check.js');
let checked=0;
for(const p of db.prepare('SELECT id FROM payouts ORDER BY id DESC LIMIT 50').all()) {
  const r=checkPayout(p.id,{save:false});
  const fair=r.checks.find(c=>c.id==='fair');
  assert.ok(fair.ok,`Проверка истории выплаты #${p.id}: ${fair.detail}`);
  checked++;
}
console.log(`Migration: ${before.length} accounts unchanged, ${rowsBefore} rounds retained, integrity OK, historical audits: ${checked}`);
db.close();
