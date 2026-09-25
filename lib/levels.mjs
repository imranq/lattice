// The level ladder: a discrete claim about a concept, on top of the continuous
// mastery estimate.
//
// `conceptMastery` gives a number between 0 and 1. A number is right for ranking
// and wrong for telling someone where they stand — 0.62 means nothing to a
// learner, and one line drawn at 0.8 makes every concept either done or not.
// Khan Academy's five rungs are the shape that works, and the load-bearing part
// of their design is the *top* one: you cannot reach it by practising. Mastered
// requires getting the concept right in an assessment — a unit test or a course
// challenge — which is a different, later, mixed context. Without that rule,
// grinding one easy exercise until the average rises reads as mastery.
//
//   https://support.khanacademy.org/hc/en-us/articles/5548760867853

export const LEVELS = ['none', 'attempted', 'familiar', 'proficient', 'mastered'];

// Mastery points per rung, following KA's economy: the jump into familiar is
// half the points, and the last rung is worth as much as the two before it.
export const POINTS = { none: 0, attempted: 10, familiar: 50, proficient: 80, mastered: 100 };

export const LEVEL_LABEL = {
  none: 'not started', attempted: 'attempted', familiar: 'familiar',
  proficient: 'proficient', mastered: 'mastered',
};

// Where the rungs sit.
//
// These read the *raw* decayed score, not the shrunk `mastery` estimate, and
// that is deliberate. Shrinkage pulls everything toward the 0.5 prior, and with
// PRIOR_STRENGTH = 3 a run of perfect answers asymptotes at 0.845 — a rung at
// 0.85 on that scale is not strict, it is unreachable. Shrinkage is the right
// tool for *ranking* concepts against each other, which is what the bars and the
// recommender use it for. A rung is a claim about one concept on its own terms,
// so it reads the score and requires enough attempts behind it separately.
//
// The numbers follow KA: familiar is their 70%, proficient is their "get them
// all right", allowing for one slip in four.
export const FAMILIAR_AT = 0.70;
export const FAMILIAR_ATTEMPTS = 2;
export const PROFICIENT_AT = 0.90;
export const PROFICIENT_ATTEMPTS = 4;

// Every context that can promote a concept to `mastered`. A mastery challenge
// counts for the same reason a unit test does: it is mixed, it is later, and you
// did not choose which topic it would ask about.
export const ASSESSMENTS = ['unit_test', 'challenge', 'mastery_challenge'];

/** Concepts with a clean assessment solve behind them: solved, unaided, in a
 *  test. This is the only key that opens the top rung. */
export function assessmentPasses(db) {
  const rows = db.prepare(
    `SELECT concept_id, COUNT(*) n, MAX(ts) last_ts FROM attempt
      WHERE concept_id IS NOT NULL
        AND context IN ('unit_test', 'challenge', 'mastery_challenge')
        AND outcome = 'solved'
        AND COALESCE(hints_used, 0) = 0
      GROUP BY concept_id`
  ).all();
  return new Map(rows.map((r) => [r.concept_id, r]));
}

/** The rung a concept sits on, given its mastery row and its assessment record. */
export function levelOf(mm, passed) {
  if (!mm || !mm.attempts) return 'none';
  const score = mm.raw ?? mm.mastery;
  const proficient = score >= PROFICIENT_AT && mm.attempts >= PROFICIENT_ATTEMPTS;
  if (proficient && passed) return 'mastered';
  if (proficient) return 'proficient';
  if (score >= FAMILIAR_AT && mm.attempts >= FAMILIAR_ATTEMPTS) return 'familiar';
  return 'attempted';
}

/** What the learner has to do to climb one rung — shown verbatim in the UI, so
 *  the ladder never asks anyone to guess at the rule. */
export function nextStep(level) {
  switch (level) {
    case 'none': return 'answer one problem to start';
    case 'attempted':
      return `${Math.round(FAMILIAR_AT * 100)}% over ${FAMILIAR_ATTEMPTS}+ problems for familiar`;
    case 'familiar':
      return `${Math.round(PROFICIENT_AT * 100)}% over ${PROFICIENT_ATTEMPTS}+ problems for proficient`;
    case 'proficient': return 'answer it cleanly in a test or challenge';
    default: return null;
  }
}

/** Level for every concept that has any evidence, keyed by concept id. */
export function conceptLevels(db, mastery) {
  const passed = assessmentPasses(db);
  const out = new Map();
  for (const [id, mm] of mastery) {
    const level = levelOf(mm, passed.has(id));
    out.set(id, {
      level, points: POINTS[level], next: nextStep(level),
      assessment_passes: passed.get(id)?.n ?? 0,
    });
  }
  return out;
}

/** Roll a set of levels into the two numbers a course header shows.
 *
 *  `mastery_pct` counts only proficient and above — KA's strict denominator, and
 *  the honest one. `points_pct` gives partial credit, so the bar still moves on
 *  a day when nothing crosses a line. Two numbers, two different jobs. */
export function rollup(levels, total) {
  const n = total || 1;
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let points = 0;
  for (const l of levels) { counts[l] += 1; points += POINTS[l]; }
  // A caller may pass a level for every topic, or only for the ones with
  // evidence; either way the untouched remainder counts as `none`.
  counts.none += Math.max(0, total - levels.length);
  return {
    counts,
    mastery_pct: +((counts.proficient + counts.mastered) / n).toFixed(3),
    points, points_max: total * POINTS.mastered,
    points_pct: +(points / (total * POINTS.mastered || 1)).toFixed(3),
  };
}
