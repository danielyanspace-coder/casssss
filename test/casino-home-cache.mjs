import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(tmpdir(), 'luckybox-lobby-'));
process.env.DB_PATH = join(dir, 'app.db');
const { db } = await import('../server/db.js');
const cdb = await import('../server/casino-db.js');
try {
  const snap = JSON.parse(readFileSync(new URL('../server/casino-catalog.json', import.meta.url), 'utf8'));
  cdb.saveCatalog(snap.providers, snap.games);
  const first = cdb.casinoHome('slots');
  const expected = JSON.stringify(first);
  const second = cdb.casinoHome('slots');
  assert.equal(JSON.stringify(second), expected);
  assert.notEqual(first, second);
  assert.notEqual(first[0].games[0], second[0].games[0], 'Callers must not mutate shared cache entries');
  first[0].games[0].name = 'changed by caller';
  assert.equal(JSON.stringify(cdb.casinoHome('slots')), expected);
  const hidden = second[0].games[0].id;
  cdb.setCoverState(hidden, 'x');
  assert.ok(cdb.casinoHome('slots').every((b) => b.games.every((g) => g.id !== hidden)), 'Own connection writes must invalidate the cache immediately');
  const next = cdb.casinoHome('slots')[0].games[0].id;
  const external = new Database(process.env.DB_PATH);
  try { external.prepare("UPDATE casino_games SET cover_state = 'x' WHERE id = ?").run(next); }
  finally { external.close(); }
  assert.ok(cdb.casinoHome('slots').every((b) => b.games.every((g) => g.id !== next)), 'External SQLite commits must invalidate the cache immediately');
  const available = cdb.casinoHome('slots')[0].games[0];
  db.prepare('UPDATE casino_games SET name = ? WHERE id = ?').run('Updated immediately', available.id);
  assert.equal(cdb.casinoHome('slots').flatMap((b) => b.games).find((g) => g.id === available.id)?.name, 'Updated immediately');
  console.log('Casino lobby cache: identical content, independent copies, own/external write invalidation passed');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
