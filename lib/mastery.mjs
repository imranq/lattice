// Turning an attempt log into a claim about what you know.
//
// Two things the topic-bucket version of this product could not do:
//   1. estimate mastery per *concept node*, not per topic label
//   2. name the weak *edge* - when you fail a concept whose prerequisite is also
//      weak, the prerequisite is the thing to fix, not the concept you failed
import { allStates } from './db.mjs';

const OUTCOME_SCORE = { solved: 1, partial: 0.5, failed: 0, skipped: null };

// Recency weighting: each attempt older than the last counts ~0.85x. A concept you
// drilled six months ago should not read as mastered today.
const DECAY = 0.85;
// Shrinkage toward 0.5 (unknown). With one attempt a concept is barely evidenced;
// by ~5 attempts the estimate mostly stands on its own.
const PRIOR_STRENGTH = 3;

export function conceptMastery(db) {
  const rows = db.prepare(
    `SELECT concept_id, outcome, hints_used, ts FROM attempt
     WHERE concept_id IS NOT NULL ORDER BY concept_id, ts DESC`
  ).all();

  const byConcept = new Map();
  for (const r of rows) {
    if (!byConcept.has(r.concept_id)) byConcept.set(r.concept_id, []);
    byConcept.get(r.concept_id).push(r);
  }

  const out = new Map();
  for (const [concept_id, attempts] of byConcept) {
    let num = 0, den = 0, n = 0, lastTs = 0;
    attempts.forEach((a, i) => {
      const base = OUTCOME_SCORE[a.outcome];
      if (base === null || base === undefined) return;
      // Hints are partial credit at best: each one shaves the score.
      const score = Math.max(0, base - 0.15 * Math.min(a.hints_used ?? 0, 3));
      const w = DECAY ** i;
      num += w * score;
      den += w;
      n += 1;
      lastTs = Math.max(lastTs, a.ts);
    });
    if (!den) continue;
    const raw = num / den;
    const mastery = (num + 0.5 * PRIOR_STRENGTH) / (den + PRIOR_STRENGTH);
    out.set(concept_id, {
      concept_id,
      mastery: +mastery.toFixed(3),
      raw: +raw.toFixed(3),
      confidence: +(n / (n + PRIOR_STRENGTH)).toFixed(3),
      attempts: n,
      last_ts: lastTs,
    });
  }
  return out;
}

/** Prerequisite edges where the downstream concept is weak AND its prerequisite is
 *  also weak - the edge, not the node, is the diagnosis. */
export function weakEdges(db, graph, { threshold = 0.6 } = {}) {
  const m = conceptMastery(db);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = [];
  for (const e of graph.edges) {
    if (e.type !== 'prerequisite' || !e.cognitive) continue;
    const dst = m.get(e.dst);
    const src = m.get(e.src);
    if (!dst || dst.mastery >= threshold) continue;
    // An untested prerequisite is a *suspected* gap; a tested-and-weak one is confirmed.
    const srcMastery = src ? src.mastery : null;
    if (srcMastery !== null && srcMastery >= threshold) continue;
    out.push({
      src: e.src,
      dst: e.dst,
      src_label: nodes.get(e.src)?.label ?? e.src,
      dst_label: nodes.get(e.dst)?.label ?? e.dst,
      edge_confidence: e.confidence,
      evidence_types: e.evidence_types,
      dst_mastery: dst.mastery,
      src_mastery: srcMastery,
      status: srcMastery === null ? 'suspected' : 'confirmed',
      // Rank confirmed gaps on strong edges first.
      priority: +(((1 - dst.mastery) * e.confidence *
        (srcMastery === null ? 0.6 : 1 - srcMastery)) .toFixed(3)),
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** What to work on next: weak-but-evidenced concepts first, then unseen concepts
 *  whose prerequisites you already hold. */
export function recommend(db, graph, exercises, { limit = 8 } = {}) {
  const m = conceptMastery(db);
  const states = new Map(allStates(db).map((s) => [s.item_id, s]));
  const prereqsOf = new Map();
  for (const e of graph.edges) {
    if (e.type !== 'prerequisite' || !e.cognitive) continue;
    if (!prereqsOf.has(e.dst)) prereqsOf.set(e.dst, []);
    prereqsOf.get(e.dst).push(e);
  }

  const byConcept = new Map();
  for (const ex of exercises) {
    if (!byConcept.has(ex.concept_id)) byConcept.set(ex.concept_id, []);
    byConcept.get(ex.concept_id).push(ex);
  }

  const concepts = graph.nodes.filter((n) => n.kind === 'concept');
  const scored = [];
  for (const c of concepts) {
    const mm = m.get(c.id);
    const pool = (byConcept.get(c.id) ?? [])
      .filter((ex) => states.get(ex.id)?.status !== 'solved')
      .sort((a, b) => a.difficulty_prior - b.difficulty_prior);
    if (!pool.length) continue;

    // Readiness: how well you hold this concept's prerequisites. An unseen concept
    // with solid prerequisites is a better target than one resting on gaps.
    const ps = (prereqsOf.get(c.id) ?? []).map((e) => m.get(e.src)?.mastery).filter((x) => x != null);
    const readiness = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5;

    const mastery = mm?.mastery ?? null;
    const gap = mastery === null ? 0.45 : 1 - mastery;   // unseen is a moderate gap
    scored.push({
      concept_id: c.id,
      label: c.label,
      chapter: c.chapter,
      mastery,
      confidence: mm?.confidence ?? 0,
      readiness: +readiness.toFixed(2),
      reason: mastery === null ? 'not yet assessed'
        : mastery < 0.6 ? 'weak concept'
        : 'review',
      score: +(gap * (0.5 + 0.5 * readiness)).toFixed(3),
      // Exercises from copyrighted books carry no text — only a pointer — so the
      // citation is what we can always show.
      next_items: pool.slice(0, 3).map((ex) => ({
        id: ex.id, tier: ex.tier, label: ex.label,
        difficulty_prior: ex.difficulty_prior,
        book_id: ex.book_id, page: ex.page ?? null,
        cite: ex.page ? `${ex.book_id} p.${ex.page}` : ex.book_id,
        text: ex.text ? ex.text.slice(0, 220) : null,
      })),
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
