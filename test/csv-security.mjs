import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'luckybox-csv-'));
process.env.DB_PATH = join(dir, 'app.db');
const { toCsv } = await import('../server/cashdesk.js');
const { db } = await import('../server/db.js');
try {
  for (const text of ['=1+1', '+1+1', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1', '\rtest', '\ntest']) {
    const csv = toCsv(['value'], [[text]]);
    const value = csv.split('\r\n')[1];
    assert.ok(value.startsWith("'") || value.startsWith('"\''), 'Unsafe cell must start with a text marker');
  }
  assert.equal(toCsv(['amount'], [[-123], [0], [12.5]]), '\ufeffamount\r\n-123\r\n0\r\n12.5');
  assert.equal(toCsv(['text'], [['normal'], ['a;b'], ['a"b'], ['a\rb']]), '\ufefftext\r\nnormal\r\n"a;b"\r\n"a""b"\r\n"a\rb"');
  assert.equal(toCsv(['text'], [[null], ['']]), '\ufefftext\r\n\r\n');
  console.log('CSV security: formula cells become text, numeric amounts preserved, quotes/separators/CR escaped');
} finally {
  db.close();
  rmSync(dir, {recursive:true, force:true});
}
