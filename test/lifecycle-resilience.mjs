import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'lb-resilience-'));
const db = join(dir, 'test.db');
// Deliberately pass no provider/Telegram credentials to the test process.
const env = { PATH: process.env.PATH, DEV_MODE: 'true', ADMIN_TG_IDS: '999000001', PORT: '3094', HOST: '127.0.0.1', DB_PATH: db };
for (const key of ['PLAY', 'READ', 'CASHIER', 'GUESS', 'AUTH']) env[`RATE_LIMIT_${key}`] = '100000';
const child = spawn(process.execPath, ['server/app.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const output = createWriteStream(join(dir, 'server.log'));
child.stdout.pipe(output); child.stderr.pipe(output);
const exited = once(child, 'exit');
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { ready = (await fetch('http://127.0.0.1:3094/api/health')).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready);
  const load = spawn(process.execPath, ['test/load-resilience.mjs', 'http://127.0.0.1:3094', db], { stdio: 'inherit' });
  assert.equal((await once(load, 'exit'))[0], 0);
  const result = new Promise((resolve, reject) => {
    const req = request('http://127.0.0.1:3094/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.flushHeaders();
    // Let the body parser accept the request, then signal while it is pending.
    setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => req.end('{}'), 200); }, 200);
  });
  assert.equal(await result, 200, 'in-flight request completes during shutdown');
  assert.equal((await exited)[0], 0, 'clean shutdown');
  console.log('PASS: actual SIGTERM drains an in-flight HTTP request');
} finally {
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  output.end(); rmSync(dir, { recursive: true, force: true });
}
