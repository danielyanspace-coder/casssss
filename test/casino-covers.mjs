import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = mkdtempSync(join(tmpdir(), 'luckybox-covers-'));
process.env.DB_PATH = join(dir, 'app.db');
const { coverFile } = await import('../server/casino.js');
const { db } = await import('../server/db.js');
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const timeouts = [];
AbortSignal.timeout = (ms) => { timeouts.push(ms); return originalTimeout(ms); };
try {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
  const transient = await coverFile({ id: 'throttled', img: 'https://covers.invalid/throttled.png' });
  assert.equal(transient, null, '429 must not classify a game as permanently missing');
  assert.equal(calls, 2, 'Decorative images must not inherit the four-attempt game API retry budget');
  assert.ok(timeouts.every((ms) => ms <= 8000), 'A cover request must not hold a connection for 40 seconds');
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 404 }); };
  const missing = await coverFile({ id: 'missing', img: 'https://covers.invalid/missing.png' });
  assert.equal(missing.missing, true);
  assert.equal(calls, 1);
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#a744ff' } }).png().toBuffer();
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(png, { status: 200 }); };
  const game = { id: 'present', img: 'https://covers.invalid/present.png' };
  const [first, duplicate] = await Promise.all([coverFile(game), coverFile(game)]);
  assert.equal(calls, 1, 'Concurrent requests for one cover must share a download');
  assert.equal(first.file, duplicate.file);
  assert.ok(existsSync(first.file));
  const cached = await coverFile(game);
  assert.equal(cached.file, first.file);
  assert.equal(calls, 1, 'A disk cache hit must not download again');
  assert.equal((await sharp(first.file).metadata()).format, 'webp');
  console.log('Casino covers: transient/missing errors, timeout budget, shared downloads and disk cache passed');
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
