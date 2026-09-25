// The Lattice JSON API, independent of where it runs. The local Node server
// (server.mjs) and the Cloudflare Durable Object (cloud/api/) both load the
// corpus into this module with `setData`, supply a `db` with the node:sqlite
// prepare/get/all/run shape, and pass anything host-specific through `setHooks`.
import {
  recordAttempt, recordGrade, gradingLog, setStar, recordView, recentViews,
  dueItems, allStates, attemptsFor, stats, activity, streak, recentAttempts,
} from './db.mjs';
import { conceptMastery, weakEdges, recommend, frontier } from './mastery.mjs';
import { abilityReport, suggest, TARGET_P } from './ability.mjs';
import { conceptLevels, levelOf, assessmentPasses, rollup, POINTS,
         LEVEL_LABEL, nextStep, PROFICIENT_AT, FAMILIAR_AT } from './levels.mjs';
import { buildAssessment, buildMasteryChallenge, challengeStatus } from './assessment.mjs';
import { buildPlan } from './plan.mjs';
import { nextSet } from './nextset.mjs';
import { guidedPath } from './path.mjs';
import { gradeAttempt, parsePracticeRequest, jevEnabled } from './jev.mjs';
import { checkAnswer, outcomeFor } from './answercheck.mjs';

// The corpus. Loaded once per process by the host; see setData.
let graph = { nodes: [], edges: [], exercises: [] };
let ladders = { ladders: [], links: [], review_queue: [] };
let localText = new Map();
let repairedIds = new Set();
let putnamExtras = new Map();
let exerciseTags = {};
let tagVocabulary = [];
let exerciseConcept = new Map();
let bookFiles = new Map();

export function setData(d) {
  if (d.graph) {
    graph = d.graph;
    exerciseConcept = new Map(
      graph.exercises.filter((e) => e.concept_id).map((e) => [e.id, e.concept_id]));
  }
  if (d.ladders) ladders = d.ladders;
  if (d.localText) localText = d.localText;
  if (d.repairedIds) repairedIds = d.repairedIds;
  if (d.putnamExtras) putnamExtras = d.putnamExtras;
  if (d.exerciseTags) exerciseTags = d.exerciseTags;
  if (d.tagVocabulary) tagVocabulary = d.tagVocabulary;
  if (d.bookFiles) bookFiles = d.bookFiles;
  applyTagDifficulty();
}

export const getGraph = () => graph;

// Host capabilities. Defaults are the safe no-ops a host without them gets.
const hooks = {
  dbLabel: 'sqlite',
  cadenceLabel: 'this host',
  appendActivity: () => {},
  writeSession: async () => { throw new Error('Cadence export is only available locally'); },
  background: (promise) => promise,
};

export function setHooks(h) { Object.assign(hooks, h); }

const json = (body, status = 200) => ({ status, body });

const GENERATED_SKILLS = [
  { id: 'add-chain', name: 'Addition', domain: 'arithmetic',
    aliases: ['addition', 'adding', 'add', 'sums', 'sum'] },
  { id: 'subtract', name: 'Subtraction', domain: 'arithmetic',
    aliases: ['subtraction', 'subtracting', 'subtract', 'minus'] },
  { id: 'divide-friendly', name: 'Division', domain: 'arithmetic',
    aliases: ['division', 'dividing', 'divide', 'quotients'] },
  { id: 'multiply-2x2', name: 'Two-digit multiplication', domain: 'arithmetic',
    aliases: ['2x2', '2 x 2', 'two digit multiplication', 'two-digit multiplication'] },
  { id: 'multiply', name: 'Multiplication', domain: 'arithmetic', aliases: ['multiplication', 'multiply'] },
  { id: 'mult-tricks', name: 'Multiplication tricks', domain: 'arithmetic', aliases: ['multiplication tricks', 'mental multiplication'] },
  { id: 'powers', name: 'Exponents', domain: 'arithmetic',
    aliases: ['exponents', 'exponent', 'powers', 'power', 'squares', 'squaring'] },
  { id: 'order-of-operations', name: 'Parentheses and order of operations', domain: 'arithmetic',
    aliases: ['parentheses', 'parenthesis', 'order of operations', 'arithmetic expressions', 'pemdas'] },
  { id: 'percent', name: 'Percentages', domain: 'arithmetic', aliases: ['percent', 'percentage', 'percentages'] },
  { id: 'fractions', name: 'Fractions', domain: 'arithmetic', aliases: ['fractions', 'fraction'] },
  { id: 'softmax-2', name: 'Softmax', domain: 'machine learning',
    aliases: ['softmax', 'logits'] },
  { id: 'cross-entropy', name: 'Cross-entropy', domain: 'machine learning',
    aliases: ['cross entropy', 'cross-entropy', 'negative log likelihood'] },
  { id: 'gradient-step', name: 'Gradient descent', domain: 'machine learning',
    aliases: ['gradient descent', 'gradient step', 'learning rate'] },
];

// `difficulty_prior` is built in build_math_graph.py from tier hints and
// character counts, and a character count is not a difficulty: it is why asking
// for "basic probability" could return the distribution of the minimum of n iid
// uniforms. The tag pass scores every exercise on a four-level rubric read from
// the statement itself, so where that exists it replaces the guess — and because
// it replaces the *prior*, every consumer (seedRating, the Elo, `suggest`) picks
// it up without knowing anything changed.
//
// 0..3 over the rubric maps onto the 0..1 prior the graph already speaks.
function applyTagDifficulty() {
  if (!graph || !Object.keys(exerciseTags).length) return;
  let n = 0;
  for (const e of graph.exercises) {
    const d = exerciseTags[e.id]?.difficulty;
    if (d === undefined) continue;
    e.difficulty_prior = +(0.30 + (d / 3) * 0.60).toFixed(3);
    e.semantic_difficulty = d;
    n += 1;
  }
  if (n) console.log(`difficulty: ${n} exercises re-priced from the semantic pass`);
}

// The veto `suggest` applies per exercise. Two jobs, both of which need the
// semantic pass and neither of which belongs inside the ranker.
//
// Quality: stop serving text the pass judged unreadable. The heuristics it
// replaces disagree with a direct reading 42% of the time on OCR'd books, and
// 27% of the corpus has had its notation flattened by the extractor — "x1" where
// the book printed a subscript. Those are still *rankable*; they are just not
// worth showing anyone.
//
// Ceiling: "basic probability" has to mean something. Relative difficulty (an
// Elo offset) cannot express it when the learner has barely any history, so an
// absolute ceiling on the rubric does the work instead.
function exerciseFilter({ maxDifficulty = null, quality = true } = {}) {
  if (!Object.keys(exerciseTags).length && maxDifficulty === null) return null;
  return (e) => {
    const t = exerciseTags[e.id];
    // Two sources of difficulty on the same 0..3 rubric: the tag pass for the
    // textbooks, and the dataset's own level for MATH. A ceiling that only knew
    // about the first would silently stop filtering exactly the problems that
    // were ingested to make "basic" mean something.
    const difficulty = t?.difficulty ?? e.semantic_difficulty ?? null;
    if (maxDifficulty !== null && difficulty !== null && difficulty > maxDifficulty) {
      return false;
    }
    if (!t) return true;                    // untagged: no evidence against it
    if (quality) {
      if ((t.servable ?? 1) < 0.5) return false;
      if ((t.self_contained ?? 1) < 0.5) return false;
      if ((t.notation_lost ?? 0) > 0.8) return false;
      if ((t.needs_figure ?? 0) > 0.7) return false;
    }
    return true;
  };
}

/** Attach text where we have it, and a citation always. */
// Where to actually find each book. Lattice stores pointers, never the text, so
// a citation is only useful if it leads somewhere. Official or author-hosted
// pages where one exists; a catalogue search otherwise, which is honest about
// the fact that we do not host the book.
const BOOK_LINKS = {
  grinstead_snell: 'https://math.dartmouth.edu/~prob/prob/prob.pdf',
  axler: 'https://linear.axler.net/',
  blitzstein: 'http://probabilitybook.net/',
  tao: 'https://terrytao.wordpress.com/books/analysis-i/',
  putnam: 'https://kskedlaya.org/putnam-archive/',
  d2l: 'https://d2l.ai/',
  pml_book1: 'https://probml.github.io/pml-book/book1.html',
  pml_book2: 'https://probml.github.io/pml-book/book2.html',
  deep_learning_bishop: 'https://www.deeplearningbook.org/',
};

// Several extractions carry no author line, and "Abstract Algebra" alone is a
// useless catalogue search. The edition each book_id refers to is not in doubt.
const BOOK_AUTHORS = {
  herstein: 'I. N. Herstein',
  pugh: 'Charles C. Pugh',
  stein: 'Elias M. Stein; Rami Shakarchi',
  axler: 'Sheldon Axler',
  blitzstein: 'Joseph K. Blitzstein; Jessica Hwang',
  tao: 'Terence Tao',
  grinstead_snell: 'Charles M. Grinstead; J. Laurie Snell',
};
const bookAuthors = (id, authors) => authors || BOOK_AUTHORS[id] || '';

/** A catalogue search is the honest fallback: we know the book, not a copy of it. */
function bookLink(id, title, authors) {
  if (BOOK_LINKS[id]) return { url: BOOK_LINKS[id], kind: 'official' };
  const q = encodeURIComponent(`${title ?? id} ${bookAuthors(id, authors)}`.trim());
  return { url: `https://openlibrary.org/search?q=${q}`, kind: 'search' };
}

/** Book id → its chapters, in order. Used for the citation breadcrumb. */
function chaptersFor(bookId) {
  return graph.nodes
    .filter((n) => n.kind === 'domain_part' && n.book_id === bookId)
    .map((n) => ({ chapter: n.chapter, title: n.label }))
    .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
}

function withText(e) {
  const text = e.text ?? localText.get(e.id) ?? null;
  return {
    ...e,
    text,
    cite: e.page ? `${e.book_id} p.${e.page}` : `${e.book_id} ${e.label ?? ''}`.trim(),
    text_available: Boolean(text),
  };
}

// Keep the model's typed judgements separate from learner-facing prose. This
// makes feedback predictable, localizable, and safe to render, while still
// letting Jev identify the useful part and the next repair.
function feedbackForGrade(grade) {
  const gap = grade?.gap;
  const next = grade?.next_step;
  const strength = grade?.strength;
  const summary = {
    'nothing — it is correct': 'Your reasoning is correct and complete.',
    'circular, or assumes what is to be proved': 'The argument assumes the result it needs to establish.',
    'verified examples instead of proving the general case': 'The examples may support the idea, but they do not establish the general claim.',
    'an arithmetic or algebraic slip': 'The approach is close, but an arithmetic or algebraic step changes the result.',
    'a wrong theorem or wrong formula was applied': 'The main issue is the theorem or formula used, not just the final calculation.',
    'the argument stops before the conclusion': 'The work is on the right track but stops before answering the question.',
    'a case or a condition is missing': 'The solution needs to account for a missing case or condition.',
    'the answer is asserted with no working shown': 'There is not enough working to verify how the answer was obtained.',
  }[gap] ?? 'Your attempt gives useful information, but it needs another step before it is complete.';
  const nextText = next && next !== 'nothing — the solution is complete'
    ? `Next step: ${next}.`
    : '';
  const strengthText = strength && strength !== 'no usable work shown'
    ? `What is working: ${strength}.`
    : '';
  return {
    summary,
    strength: strengthText,
    next: nextText,
    // A short label for the UI; the underlying typed values remain in the log.
    action: next && next !== 'nothing — the solution is complete' ? next : null,
  };
}

const OUTCOMES = new Set(['solved', 'partial', 'failed', 'skipped']);
// 'drill' is a generated problem: it has no bank id, so its concept_id is the
// skill it exercises. That keeps generated practice in the same mastery model.
const ITEM_TYPES = new Set(['putnam', 'exercise', 'drill']);

/** A concept's name, which says far more than a section number like "2.24". */
function conceptLabel(id) {
  if (!id) return null;
  if (conceptLabels?.graph !== graph) {
    conceptLabels = { graph, map: new Map(graph.nodes.map((n) => [n.id, n.label])) };
  }
  return conceptLabels.map.get(id) ?? null;
}
let conceptLabels = null;

/** Ranked picks from `suggest`, with their text, tags and grading mode. */
function problemPayload(picks) {
  const byId = new Map(graph.exercises.map((e) => [e.id, e]));
  return picks.map((s) => {
    const full = byId.get(s.id);
    const t = exerciseTags[s.id];
    return {
      ...s, ...withText(full), ...s,
      concept_label: conceptLabel(s.concept_id),
      // What this problem actually exercises, for the "focus areas" panel.
      // Only the tags the pass was confident about — a 0.4 is a maybe, and
      // a maybe presented as a fact is worse than saying nothing.
      tags: t ? Object.entries(t.tags ?? {})
        .filter(([, p2]) => p2 > 0.6)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, p2]) => ({ name, p: p2 })) : [],
      semantic_difficulty: t?.difficulty ?? full?.semantic_difficulty ?? null,
      auto_gradable: full?.auto_gradable ?? false,
      grading_mode: full?.auto_gradable ? 'deterministic' : 'jev_free_response',
    };
  });
}

export async function api(db, { method, url, body: requestBody = {} }) {
  const p = url.pathname.replace(/^\/api/, '');

  if (method === 'GET') {
    switch (true) {
      case p === '/health':
        return json({ ok: true, db: hooks.dbLabel, nodes: graph.nodes.length });

      case p === '/graph': {
        // Edge lists get large; `assessed_by` is only needed per-concept.
        const kinds = url.searchParams.get('kinds')?.split(',');
        const exerciseCounts = new Map();
        for (const e of graph.exercises) {
          // The map promises actions, not merely bibliographic pointers. A
          // textbook exercise counts only when its statement is readable on
          // this machine; otherwise its concept should not look practice-ready.
          if (!(e.text || e.has_text || localText.has(e.id))) continue;
          // Jev's extraction-quality verdict is the stronger signal when it
          // exists. Keep the graph consistent with the study queue: missing
          // figures and destroyed notation are not counted as usable practice.
          const q = exerciseTags[e.id];
          if (q && ((q.servable ?? 1) < 0.5
              || (q.notation_lost ?? 0) > 0.8
              || (q.needs_figure ?? 0) > 0.7
              || (q.truncated ?? 0) > 0.8)) continue;
          if (e.concept_id) exerciseCounts.set(e.concept_id,
            (exerciseCounts.get(e.concept_id) ?? 0) + 1);
          for (const id of e.topic_concepts ?? []) {
            exerciseCounts.set(id, (exerciseCounts.get(id) ?? 0) + 1);
          }
        }
        const nodes = (kinds ? graph.nodes.filter((n) => kinds.includes(n.kind)) : graph.nodes)
          .map((n) => ({ ...n, exercise_count: exerciseCounts.get(n.id) ?? 0 }));
        const edges = graph.edges.filter((e) => e.type !== 'assessed_by');
        return json({ nodes, edges });
      }

      case p === '/stats':
        return json({ ...stats(db), streak: streak(db) });

      case p === '/activity':
        return json(activity(db, Number(url.searchParams.get('days') ?? 120)));

      case p === '/coverage': {
        // How much of each domain has any evidence at all - the honest denominator
        // behind every mastery number on the progress page.
        const m = conceptMastery(db);
        const byDomain = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept') continue;
          const d = byDomain.get(n.domain) ?? { domain: n.domain, concepts: 0,
                                                assessed: 0, mastery_sum: 0, exercises: 0 };
          d.concepts += 1;
          const mm = m.get(n.id);
          if (mm) { d.assessed += 1; d.mastery_sum += mm.mastery; }
          byDomain.set(n.domain, d);
        }
        for (const e of graph.exercises) {
          const d = byDomain.get(e.domain);
          if (d) d.exercises += 1;
        }
        return json([...byDomain.values()].map((d) => ({
          domain: d.domain, concepts: d.concepts, assessed: d.assessed,
          exercises: d.exercises,
          mastery: d.assessed ? +(d.mastery_sum / d.assessed).toFixed(3) : null,
          coverage: +(d.assessed / d.concepts).toFixed(3),
        })).sort((a, b) => b.exercises - a.exercises));
      }

      case p === '/books': {
        const books = graph.nodes.filter((n) => n.kind === 'book');
        const counts = new Map();
        for (const e of graph.exercises) counts.set(e.book_id, (counts.get(e.book_id) ?? 0) + 1);
        return json(books.map((b) => {
          const id = b.id.replace(/^book:/, '');
          const link = bookLink(id, b.label, b.authors);
          const local = bookFiles.get(id);
          return {
            id, title: b.label, authors: bookAuthors(id, b.authors),
            domain: b.domain, extraction: b.extraction,
            url: link.url, link_kind: link.kind,
            // The copy on this machine, and the shift that turns a printed page
            // into the page a viewer will actually open.
            local_url: local ? `/book/${encodeURIComponent(id)}.pdf` : null,
            page_offset: local?.pageOffset ?? 0,
            chapters: chaptersFor(id),
            exercises: counts.get(id) ?? 0,
          };
        }).sort((a, b) => b.exercises - a.exercises));
      }

      case p === '/mastery': {
        const m = conceptMastery(db);
        const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
        return json([...m.values()]
          .map((x) => ({ ...x, label: labels.get(x.concept_id) ?? x.concept_id }))
          .sort((a, b) => a.mastery - b.mastery));
      }

      case p === '/ability':
        return json({ target_success: TARGET_P, domains: abilityReport(db, graph) });

      case p === '/next': {
        // The study queue: problems sitting at the edge of what you can do.
        const picks = suggest(db, graph, {
          domains: url.searchParams.get('domains')?.split(',').filter(Boolean) || null,
          sources: url.searchParams.get('sources')?.split(',').filter(Boolean) || null,
          limit: Number(url.searchParams.get('limit') ?? 10),
          // The client passes back what it is already holding, so a refill in
          // the middle of a session cannot hand you the same problem twice.
          exclude: url.searchParams.get('exclude')?.split(',').filter(Boolean) || null,
          concepts: url.searchParams.get('concepts')?.split(',').filter(Boolean) || null,
          sample: url.searchParams.get('sample') !== '0',
          difficulty: url.searchParams.get('difficulty') ?? 'target',
          shift: url.searchParams.has('shift')
            ? Number(url.searchParams.get('shift')) : null,
          hasText: (id) => localText.has(id),
          isRepaired: (id) => repairedIds.has(id),
          allow: exerciseFilter({
            maxDifficulty: url.searchParams.has('max_difficulty')
              ? Number(url.searchParams.get('max_difficulty')) : null,
            quality: url.searchParams.get('quality') !== '0',
          }),
        });
        return json(problemPayload(picks));
      }

      case p === '/items': {
        // Named problems, in the order asked for: a suggestion or a history row
        // the learner clicked. Scored by the same ranker as /next, so the card
        // shows the same fit and rating it would have shown in a queue.
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50);
        const want = new Set(ids);
        const picks = suggest(db, graph, {
          includeSolved: true, sample: false, limit: ids.length,
          hasText: (id) => localText.has(id),
          isRepaired: (id) => repairedIds.has(id),
          allow: (e) => want.has(e.id),
        });
        const order = new Map(ids.map((id, i) => [id, i]));
        return json(problemPayload(picks).sort((a, b) => order.get(a.id) - order.get(b.id)));
      }

      case p === '/path':
        // The guided path: an ordered curriculum, and where on it you stand.
        return json(guidedPath(db, graph));

      case p === '/history': {
        // Home's "recent" list. The whole statement goes out: cutting TeX at an
        // arbitrary character breaks the typesetting, so the page clips it instead.
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 12), 50);
        const byId = new Map(graph.exercises.map((e) => [e.id, e]));
        return json(recentAttempts(db, limit).map((r) => {
          const e = byId.get(r.item_id);
          const full = e ? withText(e) : null;
          return {
            item_id: r.item_id, item_type: r.item_type, concept_id: r.concept_id,
            ts: r.ts, tries: r.tries, outcome: r.outcome, solved_ever: Boolean(r.solved_ever),
            label: e?.label ?? null, section_title: e?.section_title ?? null,
            concept_label: conceptLabel(r.concept_id ?? e?.concept_id),
            domain: e?.domain ?? null, book_id: e?.book_id ?? null, cite: full?.cite ?? null,
            text: full?.text ?? null,
            openable: Boolean(full?.text_available),
          };
        }));
      }

      case p === '/next-set':
        // One set, chosen and justified. No model call: everything this needs is
        // already in the graph and the attempt log.
        return json(nextSet(db, graph, {
          minutes: Number(url.searchParams.get('minutes') ?? 25),
        }));

      case p === '/grading':
        // The shadow grader's log, and the two numbers the go/no-go decision
        // turns on: how often it agrees, and how often it would have called a
        // solved problem failed.
        return json({
          enabled: jevEnabled(),
          ...gradingLog(db, Number(url.searchParams.get('limit') ?? 500)),
        });

      case p === '/plan': {
        // The recommended schedule, shown on Home and exported to Cadence.
        const ability = abilityReport(db, graph);
        const rated = ability.filter((a) => a.pool > 0);
        const weakest = rated.find((a) => a.attempts > 0) ?? rated[0] ?? null;
        return json(buildPlan({
          due: stats(db).due,
          weakest,
          ability: rated.slice(0, 5),
          minutes: Number(url.searchParams.get('minutes') ?? 45),
        }));
      }

      case p === '/subjects': {
        // One row per field: the books that teach it, how much of it is assessed,
        // and where you sit. This is what Home draws instead of the full graph.
        const m = conceptMastery(db);
        const ability = new Map(abilityReport(db, graph).map((a) => [a.domain, a]));
        const rows = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept' || !n.domain) continue;
          const r = rows.get(n.domain) ?? {
            domain: n.domain, concepts: 0, assessed: 0, mastery_sum: 0,
            books: new Set(), exercises: 0,
          };
          r.concepts += 1;
          if (n.book_id) r.books.add(n.book_id);
          const mm = m.get(n.id);
          if (mm) { r.assessed += 1; r.mastery_sum += mm.mastery; }
          rows.set(n.domain, r);
        }
        for (const e of graph.exercises) {
          const r = rows.get(e.domain);
          if (r) r.exercises += 1;
        }
        return json([...rows.values()].map((r) => ({
          domain: r.domain, concepts: r.concepts, assessed: r.assessed,
          exercises: r.exercises, books: [...r.books],
          mastery: r.assessed ? +(r.mastery_sum / r.assessed).toFixed(3) : null,
          coverage: +(r.assessed / r.concepts).toFixed(3),
          rating: ability.get(r.domain)?.rating ?? null,
          attempts: ability.get(r.domain)?.attempts ?? 0,
        })).sort((a, b) => b.exercises - a.exercises));
      }

      case p === '/subject': {
        // One field in full: its books, their chapters, and every topic under
        // them with mastery and how many problems sit there.
        const domain = url.searchParams.get('domain');
        if (!domain) return json({ error: 'domain required' }, 400);
        const m = conceptMastery(db);
        const counts = new Map();
        for (const e of graph.exercises) {
          counts.set(e.concept_id, (counts.get(e.concept_id) ?? 0) + 1);
        }
        const bookMeta = new Map(graph.nodes.filter((n) => n.kind === 'book')
          .map((n) => [n.id.replace(/^book:/, ''), n]));
        const chapters = new Map(graph.nodes.filter((n) => n.kind === 'domain_part')
          .map((n) => [`${n.book_id}:${n.chapter}`, n.label]));

        const byBook = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept' || n.domain !== domain) continue;
          const book = n.book_id ?? 'other';
          const meta = bookMeta.get(book);
          const b = byBook.get(book) ?? {
            book_id: book, title: meta?.label ?? book, authors: bookAuthors(book, meta?.authors),
            url: bookLink(book, meta?.label, meta?.authors).url,
            local_url: bookFiles.has(book) ? `/book/${encodeURIComponent(book)}.pdf` : null,
            topics: [],
          };
          const mm = m.get(n.id);
          b.topics.push({
            id: n.id, label: n.label, chapter: n.chapter ?? null,
            chapter_title: chapters.get(`${book}:${n.chapter}`) ?? null,
            page: n.page ?? null,
            exercises: counts.get(n.id) ?? 0,
            mastery: mm ? mm.mastery : null,
            attempts: mm ? mm.attempts : 0,
          });
          byBook.set(book, b);
        }
        for (const b of byBook.values()) {
          b.exercises = b.topics.reduce((a, t) => a + t.exercises, 0);
          b.topics.sort((x, y) => (x.chapter ?? 0) - (y.chapter ?? 0)
            || y.exercises - x.exercises);
        }
        const ability = abilityReport(db, graph).find((a) => a.domain === domain) ?? null;
        return json({
          domain, ability,
          books: [...byBook.values()].sort((a, b) => b.exercises - a.exercises),
        });
      }

      case p === '/challenge': {
        // The interleaved review: a few ripe concepts from different books, a
        // couple of fresh questions each. GET with ?peek=1 to ask only whether
        // it is available - Home draws a card from that without building a paper.
        const m = conceptMastery(db);
        if (url.searchParams.get('peek') === '1') {
          const st = challengeStatus(db, graph, m);
          return json({ ...st, pool: undefined, pool_size: st.pool.length });
        }
        const built = buildMasteryChallenge(db, graph, m, {
          hasText: (id) => localText.has(id),
          isRepaired: (id) => repairedIds.has(id),
        });
        const byId = new Map(graph.exercises.map((e) => [e.id, e]));
        return json({
          ...built, pool: undefined,
          items: built.items.map((s) => ({ ...s, ...withText(byId.get(s.id)), ...s })),
        });
      }

      case p === '/levels': {
        // The rung each named concept sits on. The assessment results screen
        // reads this afterwards and diffs it against what it recorded before.
        const want = url.searchParams.get('concepts')?.split(',').filter(Boolean);
        const m = conceptMastery(db);
        const passed = assessmentPasses(db);
        const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
        const ids = want?.length ? want : [...m.keys()];
        return json(ids.map((id) => {
          const level = levelOf(m.get(id), passed.has(id));
          return {
            concept_id: id, label: labels.get(id) ?? id, level,
            level_label: LEVEL_LABEL[level], points: POINTS[level],
            next: nextStep(level),
            mastery: m.get(id)?.mastery ?? null, attempts: m.get(id)?.attempts ?? 0,
          };
        }));
      }

      case p === '/assessment': {
        // A unit test or a course challenge: one question per concept over a
        // whole unit, in a context that can promote a concept to `mastered` and
        // can place you out of material you already know.
        const book = url.searchParams.get('book');
        if (!book) return json({ error: 'book required' }, 400);
        const kind = url.searchParams.get('kind') === 'challenge' ? 'challenge' : 'unit_test';
        const chapterRaw = url.searchParams.get('chapter');
        const chapter = kind === 'challenge' || chapterRaw === null ? null : Number(chapterRaw);
        const m = conceptMastery(db);
        const built = buildAssessment(db, graph, m, {
          book, chapter, kind,
          limit: Number(url.searchParams.get('limit')) || null,
          hasText: (id) => localText.has(id),
          isRepaired: (id) => repairedIds.has(id),
        });
        const byId = new Map(graph.exercises.map((e) => [e.id, e]));
        const meta = graph.nodes.find((n) => n.id === `book:${book}`);
        const chapterTitle = chapter === null ? null
          : graph.nodes.find((n) => n.kind === 'domain_part'
              && n.book_id === book && n.chapter === chapter)?.label ?? `Chapter ${chapter}`;
        return json({
          ...built,
          book_title: meta?.label ?? book,
          chapter_title: chapterTitle,
          items: built.items.map((s) => ({ ...s, ...withText(byId.get(s.id)), ...s })),
        });
      }

      case p === '/courses': {
        // The course shelf: one row per book, with the same learned/ready counts
        // the course view uses, so the two never disagree.
        const m = conceptMastery(db);
        const counts = new Map();
        for (const e of graph.exercises) {
          counts.set(e.book_id, (counts.get(e.book_id) ?? 0) + 1);
        }
        const passed = assessmentPasses(db);
        const levelFor = (id) => levelOf(m.get(id), passed.has(id));
        const learnedIds = new Set();
        for (const id of m.keys()) {
          const l = levelFor(id);
          if (l === 'proficient' || l === 'mastered') learnedIds.add(id);
        }
        // Same rule as /course: only a prerequisite with evidence beyond mere
        // textbook order can lock a topic.
        const blocked = new Map();
        for (const e of graph.edges) {
          if (e.type !== 'prerequisite' || learnedIds.has(e.src)) continue;
          if (!(e.evidence_types ?? []).some((t) => t !== 'textbook_order')) continue;
          blocked.set(e.dst, (blocked.get(e.dst) ?? 0) + 1);
        }
        // The reading frontier per book, so "ready" here means the same thing it
        // means inside the course.
        const openThrough = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept' || !n.book_id || !m.has(n.id)) continue;
          openThrough.set(n.book_id, Math.max(openThrough.get(n.book_id) ?? 0, (n.chapter ?? 0) + 1));
        }
        const rows = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept' || !n.book_id) continue;
          const r = rows.get(n.book_id) ?? { id: n.book_id, domain: n.domain,
            topics: 0, learned: 0, started: 0, ready: 0, locked: 0, upcoming: 0, levels: [] };
          r.topics += 1;
          const level = levelFor(n.id);
          r.levels.push(level);
          if (learnedIds.has(n.id)) r.learned += 1;
          else if (m.has(n.id)) r.started += 1;
          else if (blocked.has(n.id)) r.locked += 1;
          else if ((n.chapter ?? 0) <= (openThrough.get(n.book_id) ?? 2)) r.ready += 1;
          else r.upcoming += 1;
          rows.set(n.book_id, r);
        }
        return json([...rows.values()].map((r) => {
          const meta = graph.nodes.find((n) => n.id === `book:${r.id}`);
          const roll = rollup(r.levels, r.topics);
          return {
            ...r, levels: undefined, ...roll,
            title: meta?.label ?? r.id,
            authors: bookAuthors(r.id, meta?.authors),
            exercises: counts.get(r.id) ?? 0,
            progress: roll.points_pct,
          };
        }).sort((a, b) => b.exercises - a.exercises));
      }

      case p === '/course': {
        // One book as a course: chapters in order, each topic carrying a state
        // (learned / ready / locked) derived from the prerequisite edges rather
        // than from position in the book. That is the difference between a table
        // of contents and a syllabus you can actually follow.
        const book = url.searchParams.get('book');
        if (!book) return json({ error: 'book required' }, 400);
        const m = conceptMastery(db);
        const counts = new Map();
        for (const e of graph.exercises) {
          counts.set(e.concept_id, (counts.get(e.concept_id) ?? 0) + 1);
        }
        const byId = new Map(graph.nodes.map((n) => [n.id, n]));
        const meta = byId.get(`book:${book}`);
        if (!meta) return json({ error: 'no such book' }, 404);

        const prereqs = new Map();
        for (const e of graph.edges) {
          if (e.type !== 'prerequisite') continue;
          if (!prereqs.has(e.dst)) prereqs.set(e.dst, []);
          prereqs.get(e.dst).push(e);
        }
        // `learned` is the gate a *prerequisite* has to clear before it stops
        // blocking: proficient or better, which is the same line the course
        // header counts. One shared definition, not two.
        const passed = assessmentPasses(db);
        const learned = (id) => {
          const l = levelOf(m.get(id), passed.has(id));
          return l === 'proficient' || l === 'mastered';
        };

        // Two kinds of prerequisite live in this graph and they must not be
        // treated alike. `textbook_order` says only "this section came before
        // that one" - 306 of the 336 edges say that, so locking on them would
        // put the whole book in one chain with exactly one topic open. An edge
        // with any other evidence (a cross reference, a Putnam link) is a claim
        // about what you *need*, and that one locks.
        const ordered = graph.nodes
          .filter((n) => n.kind === 'concept' && n.book_id === book)
          .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0) || (a.order ?? 0) - (b.order ?? 0));
        // How far into the book you have actually worked. Everything up to the
        // chapter after that is on the table; the rest is "upcoming" - not
        // forbidden, just not what this course would hand you today.
        const touched = ordered.filter((n) => m.has(n.id)).map((n) => n.chapter ?? 0);
        const openThrough = (touched.length ? Math.max(...touched) : (ordered[0]?.chapter ?? 1)) + 1;

        const topics = ordered.map((n) => {
            const mm = m.get(n.id) ?? null;
            const pre = (prereqs.get(n.id) ?? []).map((e) => {
              const s = byId.get(e.src);
              return {
                id: e.src, label: s?.label ?? e.src, book_id: s?.book_id ?? null,
                confidence: e.confidence,
                hard: (e.evidence_types ?? []).some((t) => t !== 'textbook_order'),
                learned: learned(e.src),
                mastery: m.get(e.src)?.mastery ?? null,
              };
            });
            const blocking = pre.filter((x) => x.hard && !x.learned);
            // Two orthogonal facts about a topic, and conflating them was the
            // mistake: `level` is how well you know it, `state` is whether the
            // course is offering it to you today.
            const level = levelOf(mm, passed.has(n.id));
            const state = level === 'mastered' || level === 'proficient' ? 'learned'
              : mm ? 'started'
              : blocking.length ? 'locked'
              : (n.chapter ?? 0) <= openThrough ? 'ready' : 'upcoming';
            return {
              id: n.id, label: n.label, chapter: n.chapter ?? null,
              order: n.order ?? null, page: n.page ?? null, domain: n.domain,
              exercises: counts.get(n.id) ?? 0,
              mastery: mm ? mm.mastery : null, attempts: mm ? mm.attempts : 0,
              level, points: POINTS[level], level_label: LEVEL_LABEL[level],
              next_step: nextStep(level),
              assessment_passes: passed.get(n.id)?.n ?? 0,
              state, prereqs: pre, blocking: blocking.map((x) => x.label),
              after: pre.filter((x) => !x.hard).map((x) => x.label),
            };
          });

        const chapterTitles = new Map(graph.nodes
          .filter((n) => n.kind === 'domain_part' && n.book_id === book)
          .map((n) => [n.chapter, n.label]));
        const chapters = [];
        for (const t of topics) {
          let c = chapters.at(-1);
          if (!c || c.chapter !== t.chapter) {
            c = { chapter: t.chapter,
                  title: chapterTitles.get(t.chapter) ?? (t.chapter ? `Chapter ${t.chapter}` : 'Topics'),
                  topics: [] };
            chapters.push(c);
          }
          c.topics.push(t);
        }
        // A unit test only opens once there is something in the unit it could
        // promote: KA gates their mastery challenges the same way, and a test
        // over material you have never touched is a placement quiz, not a test.
        const unitTestReady = (c) => c.topics.some((t) =>
          t.level === 'familiar' || t.level === 'proficient');

        for (const c of chapters) {
          c.exercises = c.topics.reduce((a, t) => a + t.exercises, 0);
          c.learned = c.topics.filter((t) => t.state === 'learned').length;
          c.started = c.topics.filter((t) => t.state === 'started').length;
          c.ready = c.topics.filter((t) => t.state === 'ready').length;
          c.upcoming = c.topics.filter((t) => t.state === 'upcoming').length;
          Object.assign(c, rollup(c.topics.map((t) => t.level), c.topics.length));
          // The bar shows points, not the strict percentage: it has to move on a
          // day when nothing crossed a line, or it stops being worth watching.
          c.progress = c.points_pct;
          c.unit_test = unitTestReady(c);
        }
        const local = bookFiles.get(book);
        return json({
          book: {
            id: book, title: meta.label, authors: bookAuthors(book, meta.authors),
            domain: meta.domain, url: bookLink(book, meta.label, meta.authors).url,
            local_url: local ? `/book/${encodeURIComponent(book)}.pdf` : null,
          },
          learned_at: PROFICIENT_AT,
          thresholds: { familiar: FAMILIAR_AT, proficient: PROFICIENT_AT },
          totals: {
            topics: topics.length,
            exercises: topics.reduce((a, t) => a + t.exercises, 0),
            learned: topics.filter((t) => t.state === 'learned').length,
            started: topics.filter((t) => t.state === 'started').length,
            ready: topics.filter((t) => t.state === 'ready').length,
            locked: topics.filter((t) => t.state === 'locked').length,
            upcoming: topics.filter((t) => t.state === 'upcoming').length,
            ...rollup(topics.map((t) => t.level), topics.length),
          },
          // What to do next: started work first, then whatever is unlocked.
          next: topics.filter((t) => t.state === 'started' || t.state === 'ready')
            .sort((a, b) => (a.state === b.state ? 0 : a.state === 'started' ? -1 : 1))
            .slice(0, 6),
          chapters,
        });
      }

      case p === '/progress': {
        // Where you are, and where the graph says you can go next. Home and the
        // study card both read this: one number moving is the whole point.
        const ability = abilityReport(db, graph).filter((a) => a.pool > 0);
        const front = frontier(db, graph, {
          limit: Number(url.searchParams.get('limit') ?? 12),
        });
        const domain = url.searchParams.get('domain');
        return json({
          target_success: TARGET_P,
          domains: ability,
          frontier: domain ? front.filter((f) => f.domain === domain) : front,
        });
      }

      case p.startsWith('/concept/'): {
        // One concept in its neighbourhood: what it needs, what it opens up, and
        // how much of each you hold. This is "you are here" on the study card.
        const id = decodeURIComponent(p.slice('/concept/'.length));
        const node = graph.nodes.find((n) => n.id === id);
        if (!node) return json({ error: 'no such concept' }, 404);
        const m = conceptMastery(db);
        const brief = (cid) => {
          const n = graph.nodes.find((x) => x.id === cid);
          if (!n) return null;
          return { concept_id: cid, label: n.label, domain: n.domain ?? null,
                   mastery: m.get(cid)?.mastery ?? null };
        };
        const inferred = (e) => (e.evidence_types ?? []).some((t) => t !== 'textbook_order');
        const needs = [], unlocks = [];
        for (const e of graph.edges) {
          if (e.type !== 'prerequisite' || !inferred(e)) continue;
          if (e.dst === id) { const b = brief(e.src); if (b) needs.push(b); }
          else if (e.src === id) { const b = brief(e.dst); if (b) unlocks.push(b); }
        }
        // Inferred prerequisites are rare (13 of 387 concepts have one), so a
        // concept with none still needs locating. The book's own running order
        // is real positional information — it is just not a prerequisite, and
        // is labelled as sequence rather than dependency.
        // Chapter-level concepts carry no `order` (only sections do), so sort on
        // chapter first and order within it — that places both kinds on one line.
        const seqKey = (n) => [n.chapter ?? 99, n.order ?? 0];
        const sameBook = graph.nodes
          .filter((n) => n.kind === 'concept' && n.book_id === node.book_id)
          .sort((a, b) => {
            const [ac, ao] = seqKey(a), [bc, bo] = seqKey(b);
            return ac - bc || ao - bo;
          });
        const at = sameBook.findIndex((n) => n.id === id);
        const seq = at < 0 ? { prev: [], next: [] } : {
          prev: sameBook.slice(Math.max(0, at - 2), at).map((n) => brief(n.id)).filter(Boolean),
          next: sameBook.slice(at + 1, at + 3).map((n) => brief(n.id)).filter(Boolean),
        };

        const self = m.get(id);
        return json({
          concept_id: id, label: node.label, domain: node.domain ?? null,
          book_id: node.book_id ?? null, chapter: node.chapter ?? null,
          position: at < 0 ? null : { index: at + 1, of: sameBook.length },
          mastery: self?.mastery ?? null, attempts: self?.attempts ?? 0,
          needs: needs.slice(0, 6), unlocks: unlocks.slice(0, 6),
          sequence: seq,
        });
      }

      case p === '/weak-edges':
        return json(weakEdges(db, graph).slice(0, 25));

      case p === '/recommend':
        return json(recommend(db, graph, graph.exercises,
          { limit: Number(url.searchParams.get('limit') ?? 8) }));

      case p === '/due':
        return json(dueItems(db, Number(url.searchParams.get('n') ?? 20)));

      case p === '/state':
        return json({ states: allStates(db), recent: recentViews(db, 12) });

      case p.startsWith('/ladder/'): {
        const id = decodeURIComponent(p.slice('/ladder/'.length));
        const l = ladders.ladders.find((x) => x.target_problem_id === id);
        return l ? json(l) : json({ error: 'no ladder for problem' }, 404);
      }

      case p.startsWith('/extras/'): {
        const id = decodeURIComponent(p.slice('/extras/'.length));
        if (putnamExtras.has(id)) {
          return json({ ...putnamExtras.get(id), solution_source: 'published' });
        }
        // Some imported/generated sources carry a worked solution inline. A
        // bare exact answer is intentionally not shown as a fake proof.
        const extraItem = graph.exercises.find((e) => e.id === id);
        const inlineSolution = extraItem?.solution_text ?? extraItem?.solution_tex
          ?? extraItem?.worked_solution ?? extraItem?.solution ?? null;
        return json(inlineSolution
          ? { hints: [], solution: inlineSolution, solution_source: 'source' }
          : { hints: [], solution: null, solution_source: null,
              message: 'No published worked solution is available for this problem yet.' });
      }

      case p.startsWith('/attempts/'):
        return json(attemptsFor(db, decodeURIComponent(p.slice('/attempts/'.length))));

      case p === '/exercises': {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const concept = url.searchParams.get('concept');
        const domain = url.searchParams.get('domain');
        const book = url.searchParams.get('book');
        const tier = url.searchParams.get('tier');
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 40), 200);
        const states = new Map(allStates(db).map((s) => [s.item_id, s]));

        let list = graph.exercises.filter((e) =>
          (!concept || e.concept_id === concept || (e.topic_concepts ?? []).includes(concept))
          && (!domain || e.domain === domain)
          && (!book || e.book_id === book)
          && (!tier || e.tier === tier));
        // Text that came out of OCR as noise is hidden unless asked for: showing
        // "4+orgge+.. tn2— eters" as a problem statement is worse than showing none.
        // Only OCR sources produce true garbage. Digital text is often symbol-dense
        // and scores similarly, so filtering on the score alone would hide correct
        // mathematics from Tao and Herstein.
        if (url.searchParams.get('garbled') !== '1') {
          list = list.filter((e) => !(e.ocr && (e.garble ?? 0) > 0.3));
        }
        // Book order otherwise leads with whichever book sorted first; put the
        // cleanest text in front instead.
        if (!url.searchParams.get('sort')) {
          list = [...list].sort((a, b) => (a.ocr ? 1 : 0) - (b.ocr ? 1 : 0)
            || (a.garble ?? 0) - (b.garble ?? 0));
        }
        if (url.searchParams.get('unsolved') === '1') {
          list = list.filter((e) => states.get(e.id)?.status !== 'solved');
        }
        if (q) {
          list = list.filter((e) => {
            const text = e.text ?? localText.get(e.id) ?? '';
            return text.toLowerCase().includes(q)
              || (e.section_title ?? '').toLowerCase().includes(q);
          });
        }
        const sort = url.searchParams.get('sort');
        if (sort === 'hard') list = [...list].sort((a, b) => b.difficulty_prior - a.difficulty_prior);
        else if (sort === 'easy') list = [...list].sort((a, b) => a.difficulty_prior - b.difficulty_prior);

        return json({
          total: list.length,
          offset,
          items: list.slice(offset, offset + limit).map((e) => ({
            ...withText(e),
            status: states.get(e.id)?.status ?? 'unseen',
            starred: Boolean(states.get(e.id)?.starred),
          })),
        });
      }

      case p === '/search': {
        // Jump-to-anything. Deliberately deterministic: a palette has to answer
        // before the next keystroke, and substring matching over 484 nodes is
        // free. The one thing it borrows from the semantic work is the tag
        // vocabulary — "bijection" is not a section title anywhere, but it is a
        // tag on 40-odd exercises, so it can still take you somewhere.
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        if (q.length < 2) return json({ q, results: [] });
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);

        // Rank: a prefix match beats a word-boundary match beats a substring.
        // Crude, and right for names people are half-remembering.
        const rank = (text) => {
          const t = text.toLowerCase();
          const i = t.indexOf(q);
          if (i < 0) return 0;
          if (i === 0) return 3;
          return /\s|[:.-]/.test(t[i - 1]) ? 2 : 1;
        };

        const out = [];
        const domainSet = new Set();
        for (const e of graph.exercises) if (e.domain) domainSet.add(e.domain);
        for (const d of domainSet) {
          const r = rank(d);
          if (r) out.push({ kind: 'field', label: d, sub: 'field',
                            href: `#subject|${encodeURIComponent(d)}`, rank: r + 1.5 });
        }
        for (const n of graph.nodes) {
          if (!n.label) continue;
          if (n.kind === 'book') {
            const r = rank(n.label);
            if (r) out.push({ kind: 'book', label: n.label, sub: n.domain ?? 'book',
                              href: `#subject|${encodeURIComponent(n.domain ?? '')}`,
                              rank: r + 1 });
            continue;
          }
          if (n.kind !== 'concept') continue;
          const r = rank(n.label);
          if (r) out.push({ kind: 'concept', label: n.label,
                            sub: `${n.domain ?? ''}${n.book_id ? ` · ${n.book_id}` : ''}`,
                            href: `#explore|${encodeURIComponent(n.id)}`, rank: r });
        }
        // Tags route to a practice set rather than to a page: "bijection" is a
        // thing you want to do, not a thing you want to read.
        for (const tag of tagVocabulary) {
          const r = rank(tag);
          if (!r) continue;
          const hits = new Map();
          for (const [id, t] of Object.entries(exerciseTags)) {
            if ((t.tags?.[tag] ?? 0) > 0.6) {
              const c = exerciseConcept.get(id);
              if (c) hits.set(c, (hits.get(c) ?? 0) + 1);
            }
          }
          if (!hits.size) continue;
          const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
          const n = [...hits.values()].reduce((a, b) => a + b, 0);
          out.push({
            kind: 'technique', label: tag,
            sub: `${n} problem${n === 1 ? '' : 's'} · practise this`,
            href: `#study|kind=study&concepts=${encodeURIComponent(top.map(([c]) => c).join(','))}`
                + `&count=8&label=${encodeURIComponent(tag)}`,
            rank: r + 0.5,
          });
        }
        out.sort((a, b) => b.rank - a.rank || a.label.length - b.label.length);
        return json({ q, results: out.slice(0, limit), tagged: Boolean(tagVocabulary.length) });
      }

      case p === '/facets': {
        const by = (key) => {
          const m = new Map();
          for (const e of graph.exercises) m.set(e[key], (m.get(e[key]) ?? 0) + 1);
          return [...m.entries()].filter(([k]) => k).map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count);
        };
        const garbled = graph.exercises.filter((e) => e.ocr && (e.garble ?? 0) > 0.3).length;
        return json({ domains: by('domain'), books: by('book_id'), tiers: by('tier'),
                           total: graph.exercises.length, garbled });
      }
    }
  }

  if (method === 'POST') {
    const body = requestBody ?? {};
    switch (p) {
      case '/attempt': {
        if (!body.item_id || !OUTCOMES.has(body.outcome) || !ITEM_TYPES.has(body.item_type)) {
          return json({ error: 'item_id, item_type and a valid outcome are required' }, 400);
        }
        // `context` decides whether this attempt can promote a concept to
        // mastered. It is validated in recordAttempt: anything unrecognised
        // falls back to practice, so a client cannot award itself mastery.
        const item = graph.exercises.find((e) => e.id === body.item_id);
        const exact = item?.auto_gradable && body.answer
          ? checkAnswer(body.answer, item.answer) : null;
        const effectiveOutcome = outcomeFor(exact) ?? body.outcome;
        const state = recordAttempt(db, { ...body, outcome: effectiveOutcome });
        // Tell the machine-wide log, so Cadence can measure a Lattice block
        // without either app knowing about the other.

        // Shadow grading. Deliberately *after* the row is written and not awaited:
        // the learner is already looking at their next problem, and a grader that
        // could delay or fail an attempt would be worse than no grader at all.
        // Drills are skipped — they carry an exact answer and are checked in the
        // client, so there is nothing here a model could add.
        // A synchronous `/grade-answer` call may already have assessed this
        // free response. It came from this server, but the client carries it
        // only to avoid paying for the same Jev grade twice.
        if (body.machine_grade && typeof body.machine_grade === 'object') {
          recordGrade(db, state.attempt_id, body.machine_grade);
        } else if (jevEnabled() && body.answer && body.item_type !== 'drill' && item && !exact) {
          const problem = withText(item).text;
          const concept = graph.nodes.find((n) => n.id === body.concept_id)?.label ?? null;
          // The published solution where we hold one — 372 Putnam problems, and
          // no textbook exercise. Measured worth passing: grading blind
          // under-marks correct work on hard problems badly enough to be the
          // dominant error (features/jev_investigation.md).
          const reference = putnamExtras.get(body.item_id)?.solution ?? null;
          hooks.background(gradeAttempt({
            problem, concept, reference, answer: body.answer,
            seconds: body.seconds, hints: body.hints_used,
          })
            .then((g) => { if (g) recordGrade(db, state.attempt_id, g); })
            .catch((err) => console.warn(`shadow grade failed: ${err.message}`)));
        }
        hooks.appendActivity({
          app: 'lattice',
          kind: 'attempt',
          ok: effectiveOutcome === 'solved',
          outcome: effectiveOutcome,
          id: body.item_id,
          item_type: body.item_type,
          context: body.context ?? 'practice',
          domain: item?.domain
            ?? (body.concept_id?.startsWith('skill:') ? 'mental math' : null),
          concept: body.concept_id ?? null,
          seconds: body.seconds ?? null,
        });
        return json({ ...state, outcome: effectiveOutcome,
          exact: exact ? { ...exact, outcome: effectiveOutcome } : null });
      }
      case '/check-answer': {
        const item = graph.exercises.find((e) => e.id === body.item_id);
        if (!item?.auto_gradable) return json({ decided: false });
        const result = checkAnswer(body.answer, item.answer);
        return json(result
          ? { decided: true, ...result, outcome: outcomeFor(result) }
          : { decided: false });
      }
      case '/grade-answer': {
        const item = graph.exercises.find((e) => e.id === body.item_id);
        if (!item || item.auto_gradable || !body.answer?.trim()) {
          return json({ decided: false });
        }
        if (!jevEnabled()) return json({ decided: false, reason: 'jev_unavailable' });
        const concept = graph.nodes.find((n) => n.id === item.concept_id)?.label ?? null;
        const reference = putnamExtras.get(item.id)?.solution ?? null;
        const grade = await gradeAttempt({
          problem: withText(item).text, concept, reference,
          answer: body.answer, seconds: body.seconds, hints: body.hints,
        });
        if (!grade?.confident) return json({
          decided: false,
          grade: grade ? { ...grade, feedback: feedbackForGrade(grade) } : null,
        });
        return json({ decided: true, ...grade, feedback: feedbackForGrade(grade) });
      }
      case '/practice-request': {
        // A sentence in, a runnable set out. One Jev call reads the request;
        // every filter after that is ordinary code over the tags computed once
        // by scripts/tag_exercises_jev.py.
        const text = String(body.text ?? '').trim();
        if (!text) return json({ error: 'text required' }, 400);
        const lower = text.toLowerCase();
        // The practice box is already an action surface. If the learner names
        // a known generated skill, route directly even when Jev is unavailable;
        // this also prevents simple arithmetic requests from paying for a model
        // call just to identify "division" or "parentheses".
        const directSkills = GENERATED_SKILLS.filter((s) =>
          s.aliases.some((a) => lower.includes(a)));
        const wantsMixedMental = /mental\s+math|mixed\s+(?:mental\s+)?math|arithmetic\s+drill|calculation\s+drill/.test(lower);
        const wantsMixedMl = /machine\s+learning|\bml\b|machine-learning/.test(lower);
        // Canonical ML foundation topics are graph concepts, not generated
        // drills. Keep these explicit combinations deterministic so Jev cannot
        // route "linear algebra for ML" to a generic Number Theory chapter.
        const mlTopic = wantsMixedMl
          ? (lower.includes('linear algebra') ? 'concept:machine_learning:linear_algebra'
            : lower.includes('calculus') ? 'concept:machine_learning:calculus'
            : lower.includes('probability') ? 'concept:machine_learning:probability'
            : lower.includes('neural network') || lower.includes('deep learning')
              ? 'concept:machine_learning:neural_networks'
            : lower.includes('optimization') || lower.includes('gradient')
              ? 'concept:machine_learning:optimization' : null)
          : null;
        const explicitMlDrill = directSkills.some((s) => s.domain === 'machine learning');
        const fallbackSkills = directSkills.length ? directSkills : (wantsMixedMental
          ? GENERATED_SKILLS.filter((s) => ['add-chain', 'subtract', 'divide-friendly',
              'multiply', 'powers', 'order-of-operations'].includes(s.id))
          : wantsMixedMl && explicitMlDrill ? GENERATED_SKILLS.filter((s) =>
              ['softmax-2', 'cross-entropy', 'gradient-step'].includes(s.id)) : []);
        if (!jevEnabled() && fallbackSkills.length) {
          const fallback = new URLSearchParams({ kind: 'drill',
            skills: fallbackSkills.map((s) => s.id).join(','),
            count: '5', label: text });
          return json({ understood: true,
            generated_skill: fallbackSkills.length === 1 ? fallbackSkills[0].id : 'mental-math',
            parsed: { skills: fallbackSkills.map((s) => ({ id: s.id, p: 1 })), count: 5,
              difficulty_level: 1, kind: 'computations' }, spec: fallback.toString(),
            fallback: true });
        }
        if (!jevEnabled()) {
          return json({ error: 'no TYPESAFE_API_KEY — the box needs it' }, 503);
        }

        // Domains with a handful of exercises behind them are extraction
        // residue, not fields anyone means to practise. Offering them as options
        // only gives the model somewhere wrong to put its probability mass.
        const domainCounts = new Map();
        for (const e of graph.exercises) {
          if (e.domain) domainCounts.set(e.domain, (domainCounts.get(e.domain) ?? 0) + 1);
        }
        const domains = [...domainCounts].filter(([d, n]) => n >= 20 && d !== 'unknown')
          .map(([d]) => d);
        const parsed = await parsePracticeRequest(text, {
          vocabulary: tagVocabulary, domains, skills: GENERATED_SKILLS,
        });
        if (!parsed) return json({ error: 'could not reach the model' }, 502);
        // Jev is useful for nuanced topic routing, but explicit generated-drill
        // language is a product contract. Never let a broad fallback such as
        // "Number Theory" override "mental math" or a named arithmetic skill.
        // This is deterministic and keeps a model miss from serving the wrong
        // kind of work.
        if (fallbackSkills.length && (directSkills.length || wantsMixedMental || wantsMixedMl)) {
          parsed.understood = true;
          parsed.skills = fallbackSkills.map((s) => ({ id: s.id, p: 1 }));
          parsed.kind = 'computations';
          parsed.wants_review = 0;
          parsed.tags = [];
          parsed.domains = [];
        }
        // A broad ML topic belongs to the exercise graph, not to one of the
        // small generated calculation drills. Jev may recognize a related
        // tag such as cross-entropy, but an explicit foundation request should
        // remain on the requested concept path.
        if (wantsMixedMl && !explicitMlDrill) {
          parsed.skills = [];
          parsed.kind = 'study';
          parsed.wants_review = 0;
        }
        // Say so rather than handing back the generic queue dressed as an answer.
        if (!parsed.understood) {
          return json({ understood: false, parsed,
                             message: 'That did not read as a practice request.' }, 200);
        }

        // Weakness beats a named topic: "the stuff I keep getting wrong" is a
        // request for the frontier, not for a filter.
        const wantsWeak = parsed.needs_weakness > 0.5;
        const spec = new URLSearchParams();
        const wantsSkill = !wantsWeak && parsed.skills?.length;
        // Review means "show me things I have already seen", which is a
        // different request from "find my weak spots" — the latter wants new
        // problems on weak concepts, not the same items back.
        spec.set('kind', wantsSkill ? 'drill'
          : parsed.wants_review > 0.6 && !wantsWeak && !parsed.tags.length
            ? 'review' : 'study');
        if (wantsSkill) {
          spec.set('skills', parsed.skills.map((s) => s.id).join(','));
        }
        if (mlTopic && !wantsWeak && !wantsSkill) {
          spec.set('concepts', mlTopic);
          spec.delete('domains');
        }
        if (!wantsWeak && !wantsSkill && parsed.domains.length) {
          spec.set('domains', parsed.domains.map((d) => d.name).join(','));
        }
        if (wantsWeak) {
          const front = frontier(db, graph, { limit: 4 });
          if (front.length) spec.set('concepts', front.map((f) => f.concept_id).join(','));
        } else if (!wantsSkill && parsed.tags.length) {
          // Tags select concepts through the exercises that carry them; the
          // study queue speaks concepts, so translate here rather than teaching
          // it a second filter.
          const wanted = new Set(parsed.tags.map((t) => t.name));
          const hits = new Map();
          for (const [id, t] of Object.entries(exerciseTags)) {
            for (const [tag, p] of Object.entries(t.tags ?? {})) {
              if (p > 0.6 && wanted.has(tag)) {
                const c = exerciseConcept.get(id);
                if (c) hits.set(c, (hits.get(c) ?? 0) + 1);
              }
            }
          }
          const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
          if (top.length) spec.set('concepts', top.map(([c]) => c).join(','));
        }
        spec.set('count', String(parsed.count));
        spec.set('shift', String(parsed.offset));
        // "Basic", "easy", "I'm new to this" are absolute claims about the
        // material, not relative ones about the learner. An Elo offset cannot
        // carry them when there is barely any history to be relative to — which
        // is exactly the state a beginner is in — so ask for a ceiling on the
        // rubric as well. Level 0 is "routine drill applying a stated
        // definition", 1 is "standard exercise needing one idea".
        if (parsed.difficulty_level <= 1) {
          spec.set('max_difficulty', parsed.difficulty_level === 0 ? '1.2' : '2.0');
        }
        spec.set('label', text.length > 48 ? `${text.slice(0, 47)}…` : text);

        // An empty set is a real outcome and the caller must be able to say so.
        const matched = spec.has('concepts') ? spec.get('concepts').split(',').length : null;
        return json({
          understood: true,
          parsed,
          spec: spec.toString(),
          concepts_matched: matched,
          empty: matched === 0,
          tagged_corpus: Object.keys(exerciseTags).length,
        });
      }

      case '/star':
        if (!body.item_id) return json({ error: 'item_id required' }, 400);
        setStar(db, body.item_id, body.item_type ?? 'putnam', !!body.starred);
        return json({ ok: true });
      case '/view':
        if (!body.item_id) return json({ error: 'item_id required' }, 400);
        recordView(db, body.item_id);
        return json({ ok: true });

      case '/cadence': {
        // Write today's plan into Cadence as a playable session.
        const ability = abilityReport(db, graph);
        const rated = ability.filter((a) => a.pool > 0);
        const plan = buildPlan({
          due: stats(db).due,
          weakest: rated.find((a) => a.attempts > 0) ?? rated[0] ?? null,
          ability: rated.slice(0, 5),
          minutes: Number(body.minutes ?? 45),
          blocks: Array.isArray(body.blocks) ? body.blocks : null,
        });
        try {
          return json({ ok: true, plan, ...(await hooks.writeSession(plan)) });
        } catch (err) {
          return json({
            error: `Cadence not reachable at ${hooks.cadenceLabel}`
              + ` (${err.code ?? err.message})`,
          }, 502);
        }
      }
    }
  }

  return json({ error: 'not found' }, 404);
}
