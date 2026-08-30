// Persistent memory for Lattice: what you attempted, how it went, and what that
// implies about each concept node.
//
// node:sqlite ships with Node (>=22.5), so this needs no dependencies. The file
// lives outside data/processed/ because that directory is pipeline output and gets
// regenerated; user history must survive a rebuild.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempt (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  item_id    TEXT    NOT NULL,
  item_type  TEXT    NOT NULL,           -- 'putnam' | 'exercise'
  concept_id TEXT,
  outcome    TEXT    NOT NULL,           -- 'solved' | 'partial' | 'failed' | 'skipped'
  seconds    INTEGER,
  hints_used INTEGER DEFAULT 0,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS attempt_item ON attempt(item_id, ts);
CREATE INDEX IF NOT EXISTS attempt_concept ON attempt(concept_id, ts);

-- One row per item ever touched: SM-2 scheduling state plus flags the UI reads.
CREATE TABLE IF NOT EXISTS item_state (
  item_id       TEXT PRIMARY KEY,
  item_type     TEXT NOT NULL,
  concept_id    TEXT,
  status        TEXT DEFAULT 'unseen',   -- unseen | in_progress | solved
  starred       INTEGER DEFAULT 0,
  reps          INTEGER DEFAULT 0,
  lapses        INTEGER DEFAULT 0,
  ease          REAL    DEFAULT 2.5,
  interval_days REAL    DEFAULT 0,
  due_ts        INTEGER,
  last_ts       INTEGER
);
CREATE INDEX IF NOT EXISTS item_due ON item_state(due_ts);

CREATE TABLE IF NOT EXISTS view_event (
  item_id TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  views   INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const now = () => Date.now();
const DAY = 86_400_000;

// SM-2, trimmed. `outcome` maps to the quality grades that matter here: a solve
// with no hints is a clean recall, hints or a partial solve is a weak one, and a
// failure resets the interval without destroying the ease entirely.
const GRADE = { solved: 5, partial: 3, failed: 1, skipped: 2 };

export function recordAttempt(db, a) {
  const ts = a.ts ?? now();
  const grade = Math.max(0, (GRADE[a.outcome] ?? 3) - Math.min(a.hints_used ?? 0, 2));

  db.prepare(
    `INSERT INTO attempt (ts, item_id, item_type, concept_id, outcome, seconds, hints_used, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ts, a.item_id, a.item_type, a.concept_id ?? null, a.outcome,
        a.seconds ?? null, a.hints_used ?? 0, a.note ?? null);

  const prev = db.prepare('SELECT * FROM item_state WHERE item_id = ?').get(a.item_id);
  let { reps = 0, lapses = 0, ease = 2.5, interval_days = 0 } = prev ?? {};

  if (grade >= 3) {
    reps += 1;
    interval_days = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval_days * ease);
  } else {
    reps = 0;
    lapses += 1;
    interval_days = 1;
  }
  // Standard SM-2 ease update, floored so a run of failures cannot make an item
  // permanently due every day.
  ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

  const status = a.outcome === 'solved' ? 'solved'
    : prev?.status === 'solved' ? 'solved' : 'in_progress';

  db.prepare(
    `INSERT INTO item_state (item_id, item_type, concept_id, status, starred,
                             reps, lapses, ease, interval_days, due_ts, last_ts)
     VALUES (?, ?, ?, ?, COALESCE((SELECT starred FROM item_state WHERE item_id = ?), 0),
             ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       status = excluded.status, reps = excluded.reps, lapses = excluded.lapses,
       ease = excluded.ease, interval_days = excluded.interval_days,
       due_ts = excluded.due_ts, last_ts = excluded.last_ts,
       concept_id = COALESCE(excluded.concept_id, item_state.concept_id)`
  ).run(a.item_id, a.item_type, a.concept_id ?? null, status, a.item_id,
        reps, lapses, ease, interval_days, ts + interval_days * DAY, ts);

  return db.prepare('SELECT * FROM item_state WHERE item_id = ?').get(a.item_id);
}

export function setStar(db, item_id, item_type, starred) {
  db.prepare(
    `INSERT INTO item_state (item_id, item_type, starred) VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET starred = excluded.starred`
  ).run(item_id, item_type, starred ? 1 : 0);
}

export function recordView(db, item_id) {
  db.prepare(
    `INSERT INTO view_event (item_id, ts, views) VALUES (?, ?, 1)
     ON CONFLICT(item_id) DO UPDATE SET ts = excluded.ts, views = view_event.views + 1`
  ).run(item_id, now());
}

export const recentViews = (db, n = 12) =>
  db.prepare('SELECT item_id, ts, views FROM view_event ORDER BY ts DESC LIMIT ?').all(n);

export const dueItems = (db, n = 20) =>
  db.prepare(
    `SELECT * FROM item_state WHERE due_ts IS NOT NULL AND due_ts <= ?
     ORDER BY due_ts ASC LIMIT ?`
  ).all(now(), n);

export const allStates = (db) => db.prepare('SELECT * FROM item_state').all();

export const attemptsFor = (db, item_id) =>
  db.prepare('SELECT * FROM attempt WHERE item_id = ? ORDER BY ts DESC').all(item_id);

export function stats(db) {
  const row = (sql, ...p) => db.prepare(sql).get(...p);
  return {
    attempts: row('SELECT COUNT(*) c FROM attempt').c,
    solved: row("SELECT COUNT(*) c FROM item_state WHERE status = 'solved'").c,
    in_progress: row("SELECT COUNT(*) c FROM item_state WHERE status = 'in_progress'").c,
    starred: row('SELECT COUNT(*) c FROM item_state WHERE starred = 1').c,
    due: row('SELECT COUNT(*) c FROM item_state WHERE due_ts IS NOT NULL AND due_ts <= ?',
             now()).c,
    minutes: Math.round((row('SELECT COALESCE(SUM(seconds),0) s FROM attempt').s) / 60),
  };
}
