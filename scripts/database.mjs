import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
export function database(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  if (!sqlite.prepare('SELECT name FROM _local_migrations WHERE name = ?').get('0000_team')) {
    sqlite.exec(readFileSync(new URL('../drizzle/0000_team.sql', import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO _local_migrations (name) VALUES (?)').run('0000_team');
  }
  function prepare(sql, values = []) {
    return {
      bind(...args) { return prepare(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
      async run() { const r = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; }
    };
  }
  return { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.all()); sqlite.exec('COMMIT'); return results; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  }, close() { sqlite.close(); } };
}
