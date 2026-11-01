import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'lb-accounts-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.DEV_MODE = 'false';
process.env.FIRST_DEPOSIT_PCT = '0';
process.env.PAYOUT_DATA_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const m = await import('../server/db.js');
const { getCase, pickItem, START_CASE_ID } = await import('../server/cases.js');
const { computeRoll } = await import('../server/fair.js');
const { GAMBLE_CONFIG, gambleAceFromRoll } = await import('../server/games.js');
const { checkPayout } = await import('../server/payout-check.js');
const { casinoWallet, casinoPlayerId, CASINO_STATUS } = await import('../server/casino-db.js');
const sicilia = await import('../server/sicilia.js');
const { siciliaDeposits } = await import('../server/finance.js');
const { siciliaPayinFeePct } = await import('../server/sicilia-fees.js');
const c = getCase('lucky_200');
const user = m.getOrCreateUser({ id: 'accounts-test' });
const u = () => m.getUserById(user.id);
const deposit = (amount, terminal = null) => {
  const now = Date.now();
  const r = m.db.prepare(`INSERT INTO sicilia_orders (kind,user_id,invid,amount_rub,status,terminal,method,created_at,updated_at)
    VALUES ('payin',?,?,?,'created',?,'sbp',?,?)`).run(user.id, `test-${now}-${amount}-${Math.random()}`, amount, terminal, now, now);
  sicilia.applyPayinStatus(r.lastInsertRowid, { status: 'completed', sum: amount });
  return r.lastInsertRowid;
};
const resolver = (data, free = false) => (s, cs, n) => {
  const roll = computeRoll(s,cs,n); return { item: pickItem(data,roll,free), roll };
};
const open = () => m.playCaseBatch(user.id,c,1,resolver(c),resolver(c,true))[0];
try {
  deposit(20000);
  m.grantBonus(user.id, 1000, { wager: 100, source: 'test' });
  assert.equal(m.spendable(u()),20000);
  m.selectWallet(user.id,'bonus');
  assert.equal(m.spendable(u()),1000);
  const before = u();
  const result = open();
  assert.equal(u().balance,before.balance,'bonus case must not debit real');
  assert.equal(u().bonus_balance,before.bonus_balance-c.price,'unclaimed reward is not spendable');
  assert.equal(m.pendingReward(user.id).bonus,result.totalPayout);
  assert.throws(() => m.refuseBonus(user.id), /получите|завершите/, 'unclaimed bonus cannot bypass wager through refusal');
  const pending = m.pendingReward(user.id);
  m.claimPendingReward(user.id);
  assert.equal(u().bonus_balance,before.bonus_balance-c.price+pending.bonus);
  const collected = u(); m.claimPendingReward(user.id); m.claimPendingReward(user.id);
  assert.equal(u().bonus_balance,collected.bonus_balance,'claim is idempotent');
  assert.equal(u().balance,collected.balance);
  // No mixing even when the other account has plenty of money.
  assert.throws(() => m.playInstantRound(user.id,5000,()=>({})), e=>e.code==='INSUFFICIENT_FUNDS');
  const realBefore = u().balance;
  const bonusId = casinoPlayerId(user.id,'bonus');
  let r = casinoWallet({ userId:bonusId, method:'bet', transactionId:'b1', roundId:'r1', amount:1.23 });
  assert.equal(r.statusCode,CASINO_STATUS.OK);
  assert.equal(u().balance,realBefore);
  const afterBetKop = u().bonus_balance*100+u().bonus_kop;
  m.selectWallet(user.id,'real');
  r = casinoWallet({ userId:bonusId, method:'win', transactionId:'w1', roundId:'r1', amount:2.34 });
  assert.equal(r.statusCode,CASINO_STATUS.OK);
  assert.equal(u().balance,realBefore,'late casino win must stay in original wallet');
  assert.equal(u().bonus_balance*100+u().bonus_kop,afterBetKop+234);
  assert.equal(casinoWallet({userId:bonusId,method:'win',transactionId:'w1',roundId:'r1',amount:2.34}).statusCode,CASINO_STATUS.DUPLICATE);
  r = casinoWallet({userId:bonusId,method:'rollback',transactionId:'rollback1',roundId:'r1'});
  assert.equal(r.statusCode,CASINO_STATUS.OK);
  assert.equal(u().bonus_balance*100+u().bonus_kop,afterBetKop+123);
  // Risk settles the held stake exactly once and holds its new payout too.
  let won;
  for(let i=0;i<20;i++) { won=open(); if(won.totalPayout>0) break; }
  assert.ok(won.totalPayout>0);
  const available = u().balance;
  const g = m.playGamble(user.id,0,GAMBLE_CONFIG,(s,cs,n)=>({acePosition:0,roll:computeRoll(s,cs,n)}));
  assert.equal(u().balance,available,'risk payout waits for Continue');
  assert.equal(m.pendingReward(user.id).real,g.payout);
  assert.throws(()=>m.playGamble(user.id,0,GAMBLE_CONFIG,()=>({})),e=>e.code==='NO_STAKE');
  m.claimPendingReward(user.id);
  assert.equal(u().balance,available+g.payout);
  // Gift payout is real, and can be withdrawn while deposit debt still exists.
  m.adminGrantVoucher(user.id,user.id,START_CASE_ID,1);
  const gift = getCase(START_CASE_ID);
  const gf = m.playCaseBatch(user.id,gift,1,resolver(gift),resolver(gift,true))[0];
  const b = u().balance; m.claimPendingReward(user.id);
  assert.equal(u().balance,b+gf.totalPayout);
  assert.ok(m.withdrawable(u())>=gf.totalPayout);
  // Stored probabilities survive catalog changes, while forged payout is detected.
  m.consumeWager(user.id,1000000);
  const payout = m.createPayout(user.id,1000,{method:'sbp',phone:'79001112233',bank:'Сбербанк'});
  let check = checkPayout(payout.id,{save:false});
  assert.ok(check.checks.find(c=>c.id==='sources').ok,JSON.stringify(check.checks.find(c=>c.id==='sources')));
  // Risk resolver above was scripted: validate a separate genuine case specifically.
  const last = m.db.prepare("SELECT * FROM rounds WHERE user_id=? AND game='case' ORDER BY id DESC LIMIT 1").get(user.id);
  assert.ok(JSON.parse(last.meta).table);
  m.db.prepare('UPDATE rounds SET payout=payout+999 WHERE id=?').run(last.id);
  check=checkPayout(payout.id,{save:false});
  assert.equal(check.checks.find(c=>c.id==='fair').ok,false);
  // Exact boundaries and manual disputes are counted only inside requested window.
  assert.deepEqual([4999,5000,5001,10000,10001,500000].map(a=>siciliaPayinFeePct(a,'sbp')),[20,20,18,18,15,15]);
  assert.equal(siciliaPayinFeePct(100,'mk'),26);
  const from = Date.now();
  m.adminAdjustBalance(user.id,user.id,5000,'спор',{asDeposit:false,dispute:true,disputeMethod:'mk'});
  const report = siciliaDeposits({from,to:Date.now()+1});
  assert.equal(report.gross,5000);assert.equal(report.net,3700);assert.equal(report.disputes,5000);
  assert.equal(siciliaDeposits({from:from-100,to:from}).disputes,0);
  const matched = m.adminUsers({query:`#${user.id}`}); assert.equal(matched.rows[0].id,user.id);
  const stale = m.getOrCreateUser({id:'stale-bonus'});
  m.grantBonus(stale.id,1000,{wager:1});m.selectWallet(stale.id,'bonus');
  const crash = m.startCrashRound(stale.id,100,(s,c,n)=>({crashPoint:2,roll:computeRoll(s,c,n)}));
  m.consumeWager(stale.id,{bonus:900});
  m.db.prepare('UPDATE crash_rounds SET started_at = ? WHERE id = ?').run(Date.now()-20*60*1000,crash.roundId);
  m.settleBonus(stale.id);
  m.selectWallet(stale.id,'real');
  assert.equal(m.getUserById(stale.id).balance,900,'stale bonus round must convert the remainder only once');
  m.settleBonus(stale.id);assert.equal(m.getUserById(stale.id).balance,900);
  console.log('Accounts/rewards: separate wallets, escrow, idempotency, risk, gifts, casino cents and pinned payouts, audit, fee boundaries, disputes and ID search passed');
} finally { m.db.close();rmSync(dir,{recursive:true,force:true}); }
