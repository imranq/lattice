// Persistent memory for Lattice: what you attempted, how it went, and what that
// implies about each concept node.
//
// Everything here takes a `db` with node:sqlite's prepare/get/all/run shape.
// Locally that is node:sqlite itself (lib/db-node.mjs); in the cloud it is a thin
// adapter over a Durable Object's SQLite storage (cloud/api/).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempt (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  item_id    TEXT    NOT NULL,
  item_type  TEXT    NOT NULL,           -- 'putnam' | 'exercise'
  concept_id TEXT,
  outcome    TEXT    NOT NULL,           -- 'solved' | 'partial' | 'failed' | 'skipped'
  seconds    INTEGER,
  hints_used INTEGER DEFAULT 0,
  note       TEXT,
  -- Where the attempt happened. The top of the level ladder is only reachable
  -- from an assessment, so the ladder needs to know practice from a test.
  context    TEXT    DEFAULT 'practice'   -- practice | unit_test | challenge | mastery_challenge
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

/** Create the tables, then add any columns an older database is missing. */
export function migrate(db) {
  db.exec(SCHEMA);
  // Columns that arrived after the first attempts were logged, added in place
  // rather than asking anyone to rebuild a history that cannot be regenerated.
  //
  // The `machine_*` block is the shadow grader (lib/jev.mjs). It is written
  // beside the learner's own mark and read by nothing — the point of a shadow is
  // that you can compare it later, not that it does anything now.
  const cols = new Set(db.prepare('PRAGMA table_info(attempt)').all().map((c) => c.name));
  const LATER = [
    ['context', `TEXT DEFAULT 'practice'`],
    ['answer', 'TEXT'],                 // what the learner actually wrote
    ['machine_outcome', 'TEXT'],        // solved | partial | failed, as the grader saw it
    ['machine_confident', 'INTEGER'],   // did it abstain?
    ['machine_correct', 'REAL'],        // P(the attempt is a correct, complete solution)
    ['machine_right_idea', 'REAL'],     // P(the method would work if executed properly)
    ['machine_score', 'REAL'],          // how much of the problem was solved, 0..1
    ['machine_grade_conf', 'REAL'],
    ['machine_gap', 'TEXT'],            // the named defect
    ['machine_gap_conf', 'REAL'],
    ['machine_prereq_gap', 'REAL'],     // is the gap beneath this concept, not in it?
    ['machine_stuck', 'REAL'],          // stopped from not-knowing, not from patience
    ['machine_model', 'TEXT'],          // pin the answers to the model that gave them
    ['machine_has_reference', 'INTEGER'],  // was a published solution in the state?
  ];
  for (const [name, decl] of LATER) {
    if (!cols.has(name)) db.exec(`ALTER TABLE attempt ADD COLUMN ${name} ${decl}`);
  }
  return db;
}

const now = () => Date.now();
const DAY = 86_400_000;

// SM-2, trimmed. `outcome` maps to the quality grades that matter here: a solve
// with no hints is a clean recall, hints or a partial solve is a weak one, and a
// failure resets the interval without destroying the ease entirely.
const GRADE = { solved: 5, partial: 3, failed: 1, skipped: 2 };

// Anything not in this set is ordinary practice, which cannot promote a concept
// to `mastered` no matter how well it goes.
export const CONTEXTS = new Set(['practice', 'unit_test', 'challenge', 'mastery_challenge']);

export function recordAttempt(db, a) {
  const ts = a.ts ?? now();
  const grade = Math.max(0, (GRADE[a.outcome] ?? 3) - Math.min(a.hints_used ?? 0, 2));

  const ins = db.prepare(
    `INSERT INTO attempt (ts, item_id, item_type, concept_id, outcome, seconds,
                          hints_used, note, context, answer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ts, a.item_id, a.item_type, a.concept_id ?? null, a.outcome,
        a.seconds ?? null, a.hints_used ?? 0, a.note ?? null,
        CONTEXTS.has(a.context) ? a.context : 'practice',
        a.answer?.trim() || null);

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

  const state = db.prepare('SELECT * FROM item_state WHERE item_id = ?').get(a.item_id);
  // The row id travels back so the shadow grader can fill in its columns after
  // the response has already gone out.
  return { ...state, attempt_id: Number(ins.lastInsertRowid) };
}

/** Write the shadow grader's opinion onto an attempt that is already recorded.
 *  Nothing reads these columns yet — that is the design, not an oversight. */
export function recordGrade(db, attempt_id, g) {
  db.prepare(
    `UPDATE attempt SET machine_outcome = ?, machine_confident = ?, machine_correct = ?,
                        machine_right_idea = ?, machine_score = ?, machine_grade_conf = ?,
                        machine_gap = ?, machine_gap_conf = ?, machine_prereq_gap = ?,
                        machine_stuck = ?, machine_model = ?, machine_has_reference = ?
     WHERE id = ?`
  ).run(g.outcome, g.confident ? 1 : 0, g.correct, g.right_idea, g.score,
        g.grade_confidence, g.gap, g.gap_confidence, g.prereq_gap, g.stuck,
        g.model, g.has_reference ? 1 : 0, attempt_id);
}

/** The shadow-grading comparison: every attempt where the learner wrote something
 *  and the grader had an opinion. This is the dataset the go/no-go decision in
 *  features/jev_investigation.md gets made on. */
export function gradingLog(db, limit = 500) {
  const rows = db.prepare(
    `SELECT id, ts, item_id, concept_id, outcome, seconds, hints_used, answer,
            machine_outcome, machine_confident, machine_correct, machine_right_idea,
            machine_score, machine_gap, machine_gap_conf, machine_prereq_gap,
            machine_stuck, machine_has_reference
     FROM attempt WHERE machine_outcome IS NOT NULL ORDER BY ts DESC LIMIT ?`
  ).all(limit);

  // A skip is not a grade. The grader has no `skipped` category — it is asked
  // how much of the problem was solved, and "they gave up" is not an answer to
  // that — so counting skips as disagreements would depress the number the
  // go/no-go decision reads, for a comparison that was never meaningful. They
  // are still graded and still stored: `machine_stuck` is the reason why.
  const comparable = rows.filter((r) => r.outcome !== 'skipped');
  const scored = comparable.filter((r) => r.machine_confident);
  const agree = scored.filter((r) => r.outcome === r.machine_outcome).length;
  // The asymmetric error, called out on its own: the learner says they solved it
  // and the grader says they did not. That is the mistake that would cost trust
  // if this were ever allowed to overrule them, so it is the number to watch.
  const false_failed = scored.filter(
    (r) => r.outcome === 'solved' && r.machine_outcome === 'failed').length;

  // Split the headline numbers by whether a published solution was in the state.
  // Measured on 36 Putnam cases: grading blind under-marks correct work badly
  // (mean P(correct) 0.547 against 0.710 with the reference), so a pooled
  // accuracy figure would average two genuinely different tasks.
  const split = (rs) => {
    const c = rs.filter((r) => r.machine_confident);
    const ag = c.filter((r) => r.outcome === r.machine_outcome).length;
    return { n: rs.length, n_confident: c.length,
             agreement: c.length ? +(ag / c.length).toFixed(3) : null };
  };

  return {
    n: rows.length,
    n_comparable: comparable.length,
    with_reference: split(comparable.filter((r) => r.machine_has_reference)),
    without_reference: split(comparable.filter((r) => !r.machine_has_reference)),
    n_skipped: rows.length - comparable.length,
    n_confident: scored.length,
    coverage: comparable.length ? +(scored.length / comparable.length).toFixed(3) : null,
    agreement: scored.length ? +(agree / scored.length).toFixed(3) : null,
    false_failed,
    false_failed_rate: scored.length ? +(false_failed / scored.length).toFixed(3) : null,
    rows,
  };
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

// Ordered by *how overdue*, to the day, and shuffled inside each day.
//
// Strict `ORDER BY due_ts` looks right and behaves badly: everything scheduled
// for today is equally due, so the same item led every session forever — and
// since the study queue puts reviews at the front, it was the first thing you
// saw every time you opened the app. Ranking by day keeps genuine urgency and
// stops the tie from being broken by insertion order.
export const dueItems = (db, n = 20) =>
  db.prepare(
    `SELECT * FROM item_state WHERE due_ts IS NOT NULL AND due_ts <= ?
     ORDER BY CAST(due_ts / 86400000 AS INTEGER) ASC, RANDOM() LIMIT ?`
  ).all(now(), n);

export const allStates = (db) => db.prepare('SELECT * FROM item_state').all();

export const attemptsFor = (db, item_id) =>
  db.prepare('SELECT * FROM attempt WHERE item_id = ? ORDER BY ts DESC').all(item_id);

/** Daily attempt counts for the activity heatmap. */
export const activity = (db, days = 120) =>
  db.prepare(
    `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day,
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'solved' THEN 1 ELSE 0 END) AS solved,
            COALESCE(SUM(seconds), 0) AS seconds
     FROM attempt
     WHERE ts >= ?
     GROUP BY day ORDER BY day`
  ).all(Date.now() - days * 86_400_000);

/** Consecutive days ending today (or yesterday) with at least one attempt. */
export function streak(db) {
  const days = activity(db, 400).map((r) => r.day).reverse();
  if (!days.length) return 0;
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  let cursor = new Date();
  if (days[0] !== iso(cursor)) {
    cursor.setDate(cursor.getDate() - 1);
    if (days[0] !== iso(cursor)) return 0;
  }
  let n = 0;
  for (const day of days) {
    if (day !== iso(cursor)) break;
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

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
