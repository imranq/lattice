// Open the local practice database. node:sqlite ships with Node (>=22.5), so
// this needs no dependencies. The file lives outside data/processed/ because that
// directory is pipeline output and gets regenerated; user history must survive a
// rebuild.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './db.mjs';

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return migrate(db);
}
