import { randomInt } from 'node:crypto';

// Call inside a write transaction so simultaneous registrations cannot reuse an ID.
export function allocateUserId(db) {
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?');
  for (let attempt = 0; attempt < 16; attempt++) {
    const candidate = randomInt(10000000, 100000000);
    if (!exists.get(candidate)) return candidate;
  }
  const rows = db.prepare('SELECT id FROM users WHERE id BETWEEN 10000000 AND 99999999 ORDER BY id').all();
  if (rows.length === 90000000) {
    throw Object.assign(new Error('Свободные восьмизначные ID закончились'), { code: 'USER_IDS_EXHAUSTED' });
  }
  // Choose a random free position, skipping occupied IDs without scanning the range.
  let candidate = 10000000 + randomInt(90000000 - rows.length);
  for (const { id } of rows) {
    if (id > candidate) break;
    candidate++;
  }
  return candidate;
}

export function migrateUserIds(db) {
  return db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const quote = name => '"' + name.replaceAll('"', '""') + '"';
    const refs = [];
    for (const { name } of tables) {
      for (const col of db.pragma(`table_info(${quote(name)})`)) {
        if (col.name === 'user_id' || col.name === 'admin_id' ||
            (name === 'admin_log' && col.name === 'target_id') ||
            (name === 'sicilia_settlements' && col.name === 'created_by')) {
          refs.push(db.prepare(`UPDATE ${quote(name)} SET ${quote(col.name)} = ? WHERE ${quote(col.name)} = ?`));
        }
      }
    }
    const users = db.prepare('SELECT id FROM users WHERE id < 10000000 OR id > 99999999').all();
    for (const { id } of users) {
      const next = allocateUserId(db);
      db.prepare('UPDATE users SET id = ? WHERE id = ?').run(next, id);
      for (const update of refs) update.run(next, id);
    }
    if (db.pragma('foreign_key_check').length) throw new Error('User ID migration failed foreign key check');
    return users.length;
  }).immediate();
}
