// 500 authenticated users + SSE, 100 playing every 8 seconds, 20 polling at 2 Hz.
// Creates its own disposable DB and passes no provider credentials to its server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'lb-500-users-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.DEV_MODE = 'false';
const { db, getOrCreateUser, createSession, adminAdjustBalance } = await import('../server/db.js');
const players = Array.from({ length: 500 }, (_, i) => {
  const user = getOrCreateUser({ id: 800000000 + i, username: `load_${i}` });
  adminAdjustBalance(0, user.id, 100000, 'disposable load test', { asDeposit: false });
  const token = randomBytes(32).toString('base64url');
  createSession({ tokenHash: createHash('sha256').update(token).digest('hex'), userId: user.id, ttlMs: 300000 });
  return { id: user.id, cookie: `lb_session=${token}; lb_dev=${randomBytes(16).toString('hex')}` };
});
const server = spawn(process.execPath, ['server/app.js'], { env: { PATH: process.env.PATH, DEV_MODE: 'false', PORT: '3092', HOST: '127.0.0.1', DB_PATH: process.env.DB_PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
const log = createWriteStream(join(dir, 'server.log'));
server.stdout.pipe(log); server.stderr.pipe(log);
const exited = once(server, 'exit');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const streams = new AbortController();
let proxy;
let proxyExited;
if (process.env.TARGET_LOAD_PROXY === '1') {
  let site = readFileSync('deploy/nginx.conf','utf8');
  site = site.split('\n').filter(line => !/ssl_certificate|ssl_dhparam|options-ssl-nginx/.test(line)).join('\n');
  site = site.replace(/listen (?:\[::\]:)?443 ssl http2;/g, 'listen 127.0.0.1:3091;')
    .replace(/listen (?:\[::\]:)?80;/g, 'listen 127.0.0.1:3081;')
    .replaceAll('http://127.0.0.1:3000','http://127.0.0.1:3092');
  // Collapse duplicate IPv4/IPv6 listen entries after mapping to loopback.
  site = site.replace(/(    listen 127.0.0.1:\d+;\n)\1/g, '$1');
  writeFileSync(join(dir,'nginx.conf'), `pid ${dir}/nginx.pid;\nerror_log ${dir}/nginx-error.log;\nworker_processes 2;\nevents { worker_connections 4096; }\nhttp { access_log off; ${site} }`);
  proxy = spawn('nginx',['-p','/etc/nginx','-c',join(dir,'nginx.conf'),'-g','daemon off;'],{stdio:['ignore','ignore','pipe']});
  proxy.stderr.pipe(log); proxyExited = once(proxy,'exit');
}
const base = proxy ? 'http://127.0.0.1:3091' : 'http://127.0.0.1:3092';
let streamCount = 0;
const statuses = {}, latency = [], opens = [], errors = [];
async function post(p, path, body = {}) {
  const started = performance.now();
  try {
    const r = await fetch(base + path, { method: 'POST', headers: { cookie: p.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({ error: 'Non-JSON proxy response' }));
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    latency.push(performance.now() - started);
    if (path === '/api/open') opens.push(performance.now() - started);
    if (r.status !== 200) errors.push({ status: r.status, path, body: data });
  } catch (err) { errors.push({ path, error: err.message }); }
}
try {
  let ready = false;
  for (let n = 0; n < 100; n++) { try { ready = (await fetch(base + '/api/health')).ok; } catch {} if (ready) break; await sleep(100); }
  assert.ok(ready);
  // Keep an independent authenticated payment event stream for every user.
  for (let offset = 0; offset < players.length; offset += 50) {
    await Promise.all(players.slice(offset, offset + 50).map(async p => {
      const r = await fetch(base + '/api/payments/events', { headers: { cookie: p.cookie }, signal: streams.signal });
      assert.equal(r.status, 200); streamCount++;
      r.body.pipeTo(new WritableStream({ write() {} }), { signal: streams.signal }).catch(() => {});
    }));
  }
  const durationMs = Number(process.argv[2] || 60000);
  const end = Date.now() + durationMs;
  const periodic = async (p, interval, delay, path, body) => {
    await sleep(delay);
    while (Date.now() < end) {
      const t = Date.now(); await post(p, path, body);
      await sleep(Math.max(0, interval - (Date.now() - t)));
    }
  };
  const jobs = players.map((p,i) => periodic(p, 15000, i * 10, '/api/me'));
  jobs.push(...players.slice(0,100).map((p,i) => periodic(p,8000,i*20,'/api/open',{caseId:'warmup_100'})));
  jobs.push(...players.slice(0,20).map((p,i) => periodic(p,500,i*5,'/api/me')));
  await Promise.all(jobs);
  assert.deepEqual(errors, [], JSON.stringify(errors.slice(0,3)));
  assert.equal(db.pragma('integrity_check', {simple:true}), 'ok');
  const mismatches = db.prepare(`SELECT u.id FROM users u LEFT JOIN
    (SELECT user_id, SUM(real_kop) AS real, SUM(bonus) AS bonus FROM ledger GROUP BY user_id) l ON l.user_id=u.id
    WHERE u.balance*100+u.balance_kop != COALESCE(l.real,0)
       OR ABS(u.bonus_balance+u.bonus_kop/100.0-COALESCE(l.bonus,0)) > 0.00001`).all();
  assert.equal(mismatches.length,0);
  latency.sort((a,b)=>a-b); opens.sort((a,b)=>a-b);
  console.log(JSON.stringify({proxy:Boolean(proxy),users:500,active:100,sse:streamCount,durationSeconds:durationMs/1000,requests:latency.length,opens:opens.length,statuses,p95Ms:Math.round(latency[Math.floor(latency.length*.95)]),openP95Ms:Math.round(opens[Math.floor(opens.length*.95)]),maxMs:Math.round(latency.at(-1)),integrity:'ok',ledger:'all 500 balances match'},null,2));
} finally {
  streams.abort();
  if (proxy) { proxy.kill('SIGTERM'); await proxyExited; }
  server.kill('SIGTERM'); await exited;
  db.close(); log.end(); rmSync(dir,{recursive:true,force:true});
}
