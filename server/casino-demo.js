/** Virtual money only. Never writes users, casino_tx, wager or money ledger.
 * A new UTC day restores 30,000 RUB. Day-scoped provider IDs reject old rounds.
 */
import { db, getUserById } from './db.js';

export const DEMO_RUB = 30_000;
const DAY_MS = 86_400_000;
const dayNow = () => Math.floor(Date.now() / DAY_MS);
const S = { OK: 0, USER: 1, INVALID: 3, NO_BET: 5, LOW: 8, DUPLICATE: 9 };
export const demoPlayerId = (userId) => `ld${userId}x${dayNow().toString(36)}`;
// Reserve the entire prefix so malformed demo IDs cannot reach a real wallet.
export const isDemoPlayerId = (value) => String(value || '').startsWith('ld');

db.exec(`
  CREATE TABLE IF NOT EXISTS casino_demo_wallets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    day INTEGER NOT NULL,
    balance_kop INTEGER NOT NULL CHECK(balance_kop >= 0)
  );
  CREATE TABLE IF NOT EXISTS casino_demo_tx (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    day INTEGER NOT NULL,
    method TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    tx_id TEXT,
    original_id TEXT,
    round_id TEXT,
    game_id TEXT,
    delta_kop INTEGER NOT NULL,
    rolled_back INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, day, method, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS casino_demo_round ON casino_demo_tx(user_id, day, game_id, round_id);
`);

function ensureWallet(userId) {
  const day = dayNow();
  db.prepare(`INSERT INTO casino_demo_wallets(user_id, day, balance_kop) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET day=excluded.day, balance_kop=excluded.balance_kop
    WHERE casino_demo_wallets.day != excluded.day`).run(userId, day, DEMO_RUB * 100);
  return db.prepare('SELECT * FROM casino_demo_wallets WHERE user_id=?').get(userId);
}
export function demoBalance(userId) {
  return ensureWallet(userId).balance_kop / 100;
}
const fail = code => { throw Object.assign(new Error('Invalid demo operation'), { demoStatus: code }); };
const apply = db.transaction((userId, day, list, currency) => {
  let kop = ensureWallet(userId).balance_kop;
  for (const r of list) {
    if (r.currency && String(r.currency).toUpperCase() !== currency) fail(S.INVALID);
    if (r.method === 'get_balance') continue;
    if (!['bet', 'win', 'cashout', 'rollback'].includes(r.method)) fail(S.INVALID);
    if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount < 0) {
      if (r.method !== 'rollback' || r.amount != null) fail(S.INVALID);
    }
    const amount = Math.round(Number((Number(r.amount || 0) * 100).toFixed(6)));
    if (!Number.isSafeInteger(amount)) fail(S.INVALID);
    const key = String(r.originalTransId || r.transactionId || '');
    if (!key || !r.roundId || !r.gameId) fail(S.INVALID);
    if (db.prepare('SELECT 1 FROM casino_demo_tx WHERE user_id=? AND day=? AND method=? AND dedupe_key=?')
      .get(userId, day, r.method, key)) fail(S.DUPLICATE);
    const bets = db.prepare(`SELECT * FROM casino_demo_tx WHERE user_id=? AND day=? AND game_id=? AND round_id=?
      AND rolled_back=0`).all(userId, day, String(r.gameId), String(r.roundId));
    let delta = 0;
    if (r.method === 'bet') {
      delta = r.isFreeRound === true || r.additionalData?.freeRoundPlay === true ? 0 : -amount;
      if (kop + delta < 0) fail(S.LOW);
    } else if (r.method === 'win' || r.method === 'cashout') {
      if (!bets.some(t => t.method === 'bet')) fail(S.NO_BET);
      delta = amount;
    } else {
      const ids = (Array.isArray(r.transactions) ? r.transactions : []).map(t => String(t?.transactionId || '')).filter(Boolean);
      const targets = bets.filter(t => ['bet', 'win', 'cashout'].includes(t.method)
        && (!ids.length || ids.includes(t.tx_id) || ids.includes(t.original_id)));
      if (!targets.length) fail(S.NO_BET);
      delta = Math.max(-kop, -targets.reduce((sum, t) => sum + t.delta_kop, 0));
      const mark = db.prepare('UPDATE casino_demo_tx SET rolled_back=1 WHERE id=?');
      for (const t of targets) mark.run(t.id);
    }
    kop += delta;
    if (!Number.isSafeInteger(kop)) fail(S.INVALID);
    db.prepare(`INSERT INTO casino_demo_tx(user_id,day,method,dedupe_key,tx_id,original_id,round_id,game_id,delta_kop)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(userId, day, r.method, key, r.transactionId == null ? null : String(r.transactionId),
        r.originalTransId == null ? null : String(r.originalTransId), String(r.roundId), String(r.gameId), delta);
  }
  db.prepare('UPDATE casino_demo_wallets SET balance_kop=? WHERE user_id=? AND day=?').run(kop, userId, day);
  return kop / 100;
});

export function demoWallet(list, { currency = 'RUB' } = {}) {
  const id = String(list[0]?.userId || '');
  const match = /^ld([1-9]\d{0,16})x([0-9a-z]+)$/.exec(id);
  if (!match || !getUserById(Number(match[1]))) return { statusCode: S.USER };
  if (list.some(r => String(r.userId) !== id)) return { statusCode: S.INVALID };
  const userId = Number(match[1]);
  const balance = demoBalance(userId);
  const day = parseInt(match[2], 36);
  if (day !== dayNow()) return { statusCode: S.INVALID, balance };
  try { return { statusCode: S.OK, balance: apply(userId, day, list, currency) }; }
  catch (e) {
    if (e.demoStatus === undefined) throw e;
    return { statusCode: e.demoStatus, balance: demoBalance(userId) };
  }
}
