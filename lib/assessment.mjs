// Unit tests and course challenges: the assessments that promote a concept to
// `mastered`, and the only way to test out of material you already know.
//
// Two things make an assessment different from a practice queue, and both matter:
//   1. It covers a *unit*, one question per concept, so it is mixed and you
//      cannot ride one concept's momentum through it.
//   2. It prefers problems you have not just been served. Re-asking this
//      afternoon's exercise measures your short-term memory, not the concept.
//
// Item selection reuses `suggest`, which already knows which exercises have
// readable text, which OCR is too garbled to show, and how hard each one is
// relative to you. Duplicating those filters here would mean two definitions of
// "a problem we can actually ask".
import { suggest } from './ability.mjs';
import { levelOf, assessmentPasses } from './levels.mjs';

// One question per concept, and a ceiling on the whole thing. A course challenge
// that runs 60 questions is not an assessment anyone finishes.
export const UNIT_TEST_MAX = 10;
export const CHALLENGE_MAX = 20;

/** How much asking about this concept is worth right now.
 *  A concept one rung from the top is the point of the exercise; an untouched
 *  one is worth asking because a right answer places you out of it. */
function value(level) {
  switch (level) {
    case 'proficient': return 4;   // one clean answer from mastered
    case 'familiar':   return 3;
    case 'attempted':  return 2;
    case 'none':       return 1.5; // placement: prove you never needed it
    default:           return 0.4; // already mastered - included only as filler
  }
}

/**
 * @param {'unit_test'|'challenge'} kind
 * @param {number|null} chapter  a unit test's chapter; null for a whole course
 */
export function buildAssessment(db, graph, mastery, {
  book, chapter = null, kind = 'unit_test', limit = null, hasText = null, isRepaired = null,
} = {}) {
  const cap = limit ?? (kind === 'challenge' ? CHALLENGE_MAX : UNIT_TEST_MAX);
  const passed = assessmentPasses(db);

  const inScope = graph.nodes.filter((n) =>
    n.kind === 'concept' && n.book_id === book &&
    (chapter === null || n.chapter === chapter));

  const ranked = inScope.map((n) => {
    const mm = mastery.get(n.id) ?? null;
    const level = levelOf(mm, passed.has(n.id));
    return { node: n, level, value: value(level) };
  })
    // Ties broken at random so two runs of the same unit test are not the same
    // test, and book order does not decide what gets asked.
    .sort((a, b) => b.value - a.value || Math.random() - 0.5);

  const concepts = ranked.slice(0, cap * 2).map((r) => r.node.id);
  if (!concepts.length) return { items: [], concepts: [] };

  // Ask for more than we need: not every concept has a servable problem behind
  // it, and we want a real choice per concept rather than the only survivor.
  const picks = suggest(db, graph, {
    concepts, sources: [book], limit: cap * 6,
    includeSolved: true, sample: true, hasText, isRepaired,
  });

  const order = new Map(ranked.map((r, i) => [r.node.id, i]));
  const taken = new Map();
  for (const pick of picks.sort((a, b) =>
    (order.get(a.concept_id) ?? 1e9) - (order.get(b.concept_id) ?? 1e9))) {
    if (taken.size >= cap) break;
    if (taken.has(pick.concept_id)) continue;      // one question per concept
    taken.set(pick.concept_id, pick);
  }

  const levelAt = new Map(ranked.map((r) => [r.node.id, r.level]));
  // The level each concept sat at *before* the test, carried along so the
  // results screen can show what actually moved rather than just a score.
  const items = [...taken.values()].map((i) => ({ ...i, level_before: levelAt.get(i.concept_id) }));
  return {
    kind, book, chapter,
    items,
    concepts: items.map((i) => i.concept_id),
    // What is actually at stake, so the intro screen can say it plainly.
    promotable: items.filter((i) => ['familiar', 'proficient'].includes(i.level_before)).length,
    placement: items.filter((i) => i.level_before === 'none').length,
  };
}

// ---- Mastery challenges ----------------------------------------------------
// The interleaved review. A unit test asks about one unit because you chose that
// unit; a mastery challenge asks about whatever is ripe, across every book, and
// you do not get to know what is coming. That is the point — mixed, spaced
// retrieval is what the evidence supports, and it is also the only honest way to
// ask "do you still know this".
//
// It bridges the two schedulers Lattice already runs. SM-2 schedules *items*, so
// a review is the same exercise again; this schedules *concepts* and then picks
// fresh questions for them. Gating follows KA: enough familiar material to be
// worth mixing, at least one concept near the top, and a cooling-off period so
// it cannot be farmed.
//   https://support.khanacademy.org/hc/en-us/articles/360037494231

export const CHALLENGE_CONCEPTS = 3;
export const CHALLENGE_PER_CONCEPT = 2;
// KA waits 12 hours between challenges. The same idea: a review you can retake
// immediately is a practice set wearing an assessment's name.
export const CHALLENGE_COOLDOWN_MS = 12 * 3600 * 1000;
const MIN_FAMILIAR = 3;
const MIN_PROFICIENT = 1;

/** When the last mastery challenge was taken, from the log rather than a flag. */
export function lastChallengeTs(db) {
  const row = db.prepare(
    `SELECT MAX(ts) ts FROM attempt WHERE context = 'mastery_challenge'`).get();
  return row?.ts ?? null;
}

/** Whether a challenge is available, and if not, exactly why. */
export function challengeStatus(db, graph, mastery) {
  const passed = assessmentPasses(db);
  const levels = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'concept') continue;
    const mm = mastery.get(n.id);
    if (!mm) continue;
    levels.push({ id: n.id, label: n.label, book_id: n.book_id, domain: n.domain,
                  level: levelOf(mm, passed.has(n.id)), mastery: mm.mastery,
                  last_ts: mm.last_ts });
  }
  const familiar = levels.filter((l) =>
    ['familiar', 'proficient', 'mastered'].includes(l.level)).length;
  const proficient = levels.filter((l) =>
    ['proficient', 'mastered'].includes(l.level)).length;
  const last = lastChallengeTs(db);
  const waitUntil = last ? last + CHALLENGE_COOLDOWN_MS : 0;
  const cooling = Date.now() < waitUntil;

  let reason = null;
  if (familiar < MIN_FAMILIAR) {
    reason = `reach familiar on ${MIN_FAMILIAR - familiar} more topic${
      MIN_FAMILIAR - familiar === 1 ? '' : 's'}`;
  } else if (proficient < MIN_PROFICIENT) {
    reason = 'reach proficient on one topic';
  } else if (cooling) {
    reason = 'a challenge was taken in the last 12 hours';
  }
  return {
    available: !reason, reason,
    familiar, proficient,
    need_familiar: MIN_FAMILIAR, need_proficient: MIN_PROFICIENT,
    last_ts: last, next_ts: cooling ? waitUntil : null,
    pool: levels,
  };
}

/**
 * Build the paper: a few concepts, a couple of questions each, deliberately
 * spread across different books so it cannot turn into one more unit test.
 */
export function buildMasteryChallenge(db, graph, mastery, {
  concepts: nConcepts = CHALLENGE_CONCEPTS, per = CHALLENGE_PER_CONCEPT,
  hasText = null, isRepaired = null,
} = {}) {
  const status = challengeStatus(db, graph, mastery);
  if (!status.available) return { ...status, items: [], concepts: [] };

  // Ripeness: near the top rung, and not asked about recently. A concept
  // reviewed this morning tells you nothing new tonight.
  const DAY = 86_400_000;
  const ripe = status.pool
    .filter((l) => ['familiar', 'proficient'].includes(l.level))
    .map((l) => {
      const ageDays = l.last_ts ? (Date.now() - l.last_ts) / DAY : 30;
      return { ...l, weight: (l.level === 'proficient' ? 2 : 1) * Math.min(4, 0.5 + ageDays / 3) };
    })
    .sort((a, b) => b.weight - a.weight);

  // One concept per book before any book gets a second, so a challenge is mixed
  // even when one book dominates the evidence.
  const chosen = [];
  const booksUsed = new Set();
  for (const pass of [1, 2]) {
    for (const c of ripe) {
      if (chosen.length >= nConcepts) break;
      if (chosen.includes(c)) continue;
      if (pass === 1 && booksUsed.has(c.book_id)) continue;
      chosen.push(c);
      booksUsed.add(c.book_id);
    }
  }
  if (!chosen.length) return { ...status, items: [], concepts: [] };

  const picks = suggest(db, graph, {
    concepts: chosen.map((c) => c.id), limit: nConcepts * per * 6,
    includeSolved: true, sample: true, hasText, isRepaired,
  });

  const taken = [];
  for (const c of chosen) {
    const forConcept = picks.filter((p) => p.concept_id === c.id).slice(0, per);
    for (const p of forConcept) taken.push({ ...p, level_before: c.level });
  }
  // Interleaved, not blocked: two questions on one concept back to back is
  // massed practice, which is the thing this is meant to replace.
  const items = [];
  for (let i = 0; i < per; i++) {
    for (const c of chosen) {
      const hit = taken.filter((t) => t.concept_id === c.id)[i];
      if (hit) items.push(hit);
    }
  }

  return {
    ...status,
    kind: 'mastery_challenge',
    items,
    concepts: chosen.map((c) => ({ id: c.id, label: c.label, level: c.level,
                                   book_id: c.book_id, domain: c.domain })),
    promotable: chosen.filter((c) => c.level === 'proficient').length,
  };
}
