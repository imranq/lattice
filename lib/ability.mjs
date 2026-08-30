// Where you are, per field, and what to hand you next.
//
// An Elo rating treats each attempt as a match between you and the problem, which
// estimates your skill and the problem's difficulty at the same time. Pelánek's
// survey of Elo in educational systems is the reference: it is robust at the
// sample sizes a single learner produces, where IRT needs hundreds of students.
//   https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf
//
// The target is the Eighty Five Percent Rule (Wilson et al., Nature Comms 2019):
// learning is fastest at roughly 85% accuracy — hard enough to be informative,
// easy enough to keep the signal. On the logistic scale that is a problem rated
// about 301 points below you, which is what `suggest` aims at.
//   https://www.nature.com/articles/s41467-019-12552-4
import { allStates } from './db.mjs';

const START = 1200;          // an unrated learner
const SCALE = 400;           // standard logistic width
export const TARGET_P = 0.85;
// P(correct) = 1 / (1 + 10^((d - θ)/400)); solving for d at P = 0.85.
export const TARGET_OFFSET = -SCALE * Math.log10(TARGET_P / (1 - TARGET_P));

const OUTCOME_SCORE = { solved: 1, partial: 0.5, failed: 0 };

/** Seed a problem's rating from the difficulty the pipeline inferred. */
export const seedRating = (e) => 800 + (e.difficulty_prior ?? 0.5) * 1600;

export const expected = (theta, d) => 1 / (1 + Math.pow(10, (d - theta) / SCALE));

export function ratings(db, graph) {
  const items = new Map();
  const byId = new Map();
  for (const e of graph.exercises) {
    byId.set(e.id, e);
    items.set(e.id, { rating: seedRating(e), n: 0 });
  }

  const domains = new Map();   // domain -> { rating, n }
  const getDomain = (d) => {
    if (!domains.has(d)) domains.set(d, { rating: START, n: 0 });
    return domains.get(d);
  };

  const attempts = db.prepare(
    `SELECT item_id, concept_id, outcome, hints_used, ts FROM attempt ORDER BY ts ASC`
  ).all();

  for (const a of attempts) {
    const base = OUTCOME_SCORE[a.outcome];
    if (base === undefined) continue;            // skipped carries no information
    const score = Math.max(0, base - 0.15 * Math.min(a.hints_used ?? 0, 3));

    const item = byId.get(a.item_id);
    // Generated drills are not in the graph; rate them by their level instead.
    const drill = /^drill:([^:]+):L(\d)/.exec(a.item_id);
    const domain = item?.domain
      ?? (drill ? 'mental math' : (a.concept_id ?? '').startsWith('skill:') ? 'mental math' : null);
    if (!domain) continue;

    const rec = items.get(a.item_id) ?? {
      rating: drill ? 900 + Number(drill[2]) * 220 : START, n: 0,
    };
    items.set(a.item_id, rec);

    const user = getDomain(domain);
    const p = expected(user.rating, rec.rating);

    // Uncertainty-decaying step size: early attempts move the estimate a lot,
    // later ones refine it. Without this the rating oscillates forever.
    const kUser = 44 / (1 + 0.06 * user.n);
    const kItem = 28 / (1 + 0.10 * rec.n);

    user.rating += kUser * (score - p);
    rec.rating -= kItem * (score - p);
    user.n += 1;
    rec.n += 1;
  }

  return { domains, items };
}

export function abilityReport(db, graph) {
  const { domains } = ratings(db, graph);
  const counts = new Map();
  for (const e of graph.exercises) {
    counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
  }
  const out = [];
  for (const [domain, r] of domains) {
    out.push({
      domain,
      rating: Math.round(r.rating),
      attempts: r.n,
      // Below ~8 attempts the number is mostly the prior; say so rather than
      // presenting a confident figure drawn from three answers.
      confident: r.n >= 8,
      target_rating: Math.round(r.rating + TARGET_OFFSET),
      pool: counts.get(domain) ?? 0,
    });
  }
  // Domains never attempted still matter — they are where to start.
  for (const [domain, pool] of counts) {
    if (!domains.has(domain) && domain) {
      out.push({ domain, rating: START, attempts: 0, confident: false,
                 target_rating: Math.round(START + TARGET_OFFSET), pool });
    }
  }
  return out.sort((a, b) => b.attempts - a.attempts || b.pool - a.pool);
}

/**
 * The next problems to try: closest to the 85% point for that field, unsolved,
 * with a nudge toward concepts whose prerequisites you already hold.
 */
export function suggest(db, graph, {
  domain = null, limit = 10, sources = null, includeSolved = false,
} = {}) {
  const { domains, items } = ratings(db, graph);
  const states = new Map(allStates(db).map((s) => [s.item_id, s]));

  const mastery = new Map();
  for (const row of db.prepare(
    `SELECT concept_id, AVG(CASE outcome WHEN 'solved' THEN 1.0
                                         WHEN 'partial' THEN 0.5 ELSE 0 END) AS m,
            COUNT(*) AS n
     FROM attempt WHERE concept_id IS NOT NULL GROUP BY concept_id`).all()) {
    mastery.set(row.concept_id, row);
  }

  const prereqMastery = new Map();
  for (const e of graph.edges) {
    if (e.type !== 'prerequisite' || !e.cognitive) continue;
    const m = mastery.get(e.src);
    if (!prereqMastery.has(e.dst)) prereqMastery.set(e.dst, []);
    prereqMastery.get(e.dst).push(m ? m.m : null);
  }

  const scored = [];
  for (const e of graph.exercises) {
    if (domain && e.domain !== domain) continue;
    if (sources && !sources.includes(e.book_id)) continue;
    if (!includeSolved && states.get(e.id)?.status === 'solved') continue;
    if (e.ocr && (e.garble ?? 0) > 0.3) continue;
    if (!e.text && !e.has_text) continue;   // unreadable is not suggestible

    const user = domains.get(e.domain) ?? { rating: START, n: 0 };
    const target = user.rating + TARGET_OFFSET;
    const rating = items.get(e.id)?.rating ?? seedRating(e);
    const p = expected(user.rating, rating);

    const ps = (prereqMastery.get(e.concept_id) ?? []).filter((x) => x != null);
    const readiness = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5;

    scored.push({
      id: e.id,
      concept_id: e.concept_id,
      domain: e.domain,
      book_id: e.book_id,
      label: e.label,
      section_title: e.section_title,
      page: e.page ?? null,
      tier: e.tier,
      contest: Boolean(e.contest),
      rating: Math.round(rating),
      target: Math.round(target),
      predicted_success: +p.toFixed(2),
      readiness: +readiness.toFixed(2),
      // Distance from the 85% point, softened by how ready the prerequisites are.
      fit: +(Math.abs(rating - target) * (1.3 - 0.3 * readiness)).toFixed(1),
    });
  }

  scored.sort((a, b) => a.fit - b.fit);
  return scored.slice(0, limit);
}
