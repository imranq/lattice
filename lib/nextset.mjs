// "Just tell me what to do next."
//
// Lattice already knows the answer. `frontier` finds the concepts sitting at the
// edge of what you can do — weak, but resting on prerequisites you actually
// hold. `dueItems` knows what spaced repetition wants back. `suggest` knows how
// hard a problem should be for you right now. What was missing was a single
// place that puts those three together and commits to one set, because a page of
// controls is not a recommendation.
//
// Deliberately no model in here. This is the part of the product that has to be
// explainable — every set comes back with the reason it was chosen, in the terms
// the learner can check, and a recommendation you cannot interrogate is one you
// cannot correct.

import { stats } from './db.mjs';
import { conceptMastery, frontier, recommend } from './mastery.mjs';
import { abilityReport } from './ability.mjs';

// Enough due reviews that clearing them beats opening a new front. Below this,
// reviews ride along inside an ordinary study set anyway.
const REVIEW_FLOOR = 6;
// One set, not a syllabus. Long enough to get a reading on a concept, short
// enough to finish.
const SET_SIZE = 8;
// A concept with two exercises behind it cannot carry a set on its own.
const MIN_POOL = 3;
// Concepts per set. Mixed beats massed, but past three or four it stops being a
// set about anything.
const MAX_CONCEPTS = 4;
// Below this many attempts a domain rating is mostly the prior — `abilityReport`
// says so itself, and a set built to a number that is not yet real should aim
// low and get a reading rather than aim true and guess.
const PROVISIONAL = 8;

const encode = (obj) => Object.entries(obj)
  .filter(([, v]) => v !== null && v !== undefined && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
  .join('&');

/** The one set to run next, with the reason it was chosen.
 *
 *  Returns `{ label, reason, why, spec, kind, count, concepts, minutes }` where
 *  `spec` is the query string the study view already understands: the client
 *  opens `#study|${spec}` and nothing new has to parse anything. */
export function nextSet(db, graph, { minutes = 25 } = {}) {
  const due = stats(db).due;

  // 1. A backlog of reviews outranks anything new. Spaced repetition only works
  //    if the schedule is kept, and a review you postpone is a concept you are
  //    quietly letting go.
  if (due >= REVIEW_FLOOR) {
    const count = Math.min(due, SET_SIZE + 4);
    return {
      kind: 'review',
      label: 'Clear the review backlog',
      reason: `${due} item${due === 1 ? '' : 's'} ${due === 1 ? 'is' : 'are'} due for review. `
            + 'Spaced repetition only pays if the schedule is kept, so these come first.',
      why: [`${due} due`, 'oldest first'],
      count,
      concepts: [],
      minutes,
      spec: encode({ kind: 'review', count, label: 'Review backlog' }),
    };
  }

  // 2. Otherwise, the frontier: concepts you are weak on whose prerequisites you
  //    already hold. Grouped by domain, because a set that jumps between complex
  //    analysis and group theory is four sets wearing a trenchcoat.
  const front = frontier(db, graph, { limit: 24 }).filter((c) => c.exercises >= MIN_POOL);

  if (front.length) {
    const domain = front[0].domain;
    const picked = front.filter((c) => c.domain === domain).slice(0, MAX_CONCEPTS);
    const pool = picked.reduce((a, c) => a + c.exercises, 0);
    const count = Math.min(SET_SIZE, pool);

    const ability = abilityReport(db, graph).find((a) => a.domain === domain);
    const attempts = ability?.attempts ?? 0;
    // Everything on the frontier is unseen: there is no rating to aim at yet, so
    // aim low, get a reading, and let the adaptive staircase take over from there.
    const allUnseen = picked.every((c) => c.mastery === null);
    const difficulty = attempts < PROVISIONAL || allUnseen ? 'easier' : 'target';

    const named = picked.map((c) => c.label);
    const held = picked.filter((c) => c.prereqs_met > 0).length;

    return {
      kind: 'study',
      label: picked.length === 1 ? named[0] : `${domain}: ${named.length} concepts`,
      reason: `${named.slice(0, 3).join(', ')}${named.length > 3 ? ', …' : ''} `
            + `${named.length === 1 ? 'is' : 'are'} the weakest ${domain} `
            + `${named.length === 1 ? 'concept' : 'concepts'} whose prerequisites you already `
            + `hold — so ${named.length === 1 ? 'it is' : 'they are'} learnable now rather than `
            + `blocked on something underneath.`
            + (difficulty === 'easier'
              ? ' Starting below your rating, because there is not enough history here to aim at.'
              : ''),
      why: [
        `${pool} exercise${pool === 1 ? '' : 's'} available`,
        held ? `${held}/${picked.length} resting on assessed prerequisites` : 'no blocked prerequisites',
        difficulty === 'easier' ? 'pitched easy — getting a reading' : 'pitched at your level',
        ...(due ? [`${due} review${due === 1 ? '' : 's'} will ride along`] : []),
      ],
      count,
      concepts: picked.map((c) => c.concept_id),
      minutes,
      spec: encode({
        kind: 'study',
        concepts: picked.map((c) => c.concept_id).join(','),
        domains: domain,
        difficulty,
        count,
        label: picked.length === 1 ? named[0] : `${domain} frontier`,
      }),
    };
  }

  // 3. Nothing on the frontier means every reachable concept is either held or
  //    blocked. Fall back to the plain recommender, which does not require an
  //    unblocked prerequisite path and will happily hand back the blocker itself.
  const recs = recommend(db, graph, graph.exercises, { limit: SET_SIZE });
  if (recs.length) {
    const concepts = [...new Set(recs.map((r) => r.concept_id).filter(Boolean))]
      .slice(0, MAX_CONCEPTS);
    const mastery = conceptMastery(db);
    const weakest = concepts.filter((c) => (mastery.get(c)?.mastery ?? 1) < 0.6).length;
    return {
      kind: 'study',
      label: 'Unblock what is in the way',
      reason: 'Nothing is sitting on prerequisites you already hold, so this set goes after '
            + 'the blockers themselves — the concepts everything else is waiting on.',
      why: [
        `${recs.length} problem${recs.length === 1 ? '' : 's'} selected`,
        weakest ? `${weakest} weak concept${weakest === 1 ? '' : 's'} in the way` : 'spread across concepts',
      ],
      count: Math.min(SET_SIZE, recs.length),
      concepts,
      minutes,
      spec: encode({
        kind: 'study',
        concepts: concepts.join(','),
        difficulty: 'easier',
        count: Math.min(SET_SIZE, recs.length),
        label: 'Unblock',
      }),
    };
  }

  // 4. A genuinely empty graph, or a corpus with no servable text. Say so
  //    plainly rather than handing back an empty set that looks like a bug.
  return {
    kind: 'none',
    label: 'Nothing to recommend yet',
    reason: 'There is no attempt history and no servable exercise pool to build a set from. '
          + 'Run a few problems from any book first.',
    why: [],
    count: 0,
    concepts: [],
    minutes,
    spec: null,
  };
}
