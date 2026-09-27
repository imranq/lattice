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
// Worked solutions too large to keep in the graph (MATH ships one per problem).
// The host supplies a lookup; it may load lazily, so it may be async.
let solutionFor = () => null;

let rawGraph = graph;
let chapterTitles = {};

export function setData(d) {
  if (d.chapterTitles) chapterTitles = d.chapterTitles;
  if (d.graph) rawGraph = d.graph;
  if (d.graph || d.chapterTitles) {
    graph = tidyGraph(rawGraph, chapterTitles);
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
  if (d.solutionFor) solutionFor = d.solutionFor;
  applyTagDifficulty();
  dataVersion += 1;
}

// ---- presentation fixes -----------------------------------------------------
// The graph is pipeline output, and the pipeline keeps the books' own markup:
// `~` ties, `\newline`, a chapter titled "✽" where the PDF had an ornament.
// None of that is for a reader. Clean it once, on load, so every view gets the
// same labels instead of each one learning to scrub them.

const cleanLabel = (s) => (typeof s === 'string'
  ? s.replace(/\\newline\b|\\\\/g, ' ').replace(/\\(bf|em|it|rm)\s+/g, '').replace(/~/g, ' ')
    .replace(/^\*\s*/, '')          // Blitzstein stars optional sections
    .replace(/\s+/g, ' ').trim()
  : s);

// Chapters the extraction could not title, or titled with an ornament. The
// profiles in data/processed/books/ supply most (passed in as chapterTitles);
// these are the ones no profile has.
const CHAPTER_TITLES = {
  axler: { 1: 'Vector Spaces' },
  d2l: {
    13: 'Computational Performance', 14: 'Computer Vision', 15: 'Natural Language Processing: Pretraining',
    16: 'Natural Language Processing: Applications', 17: 'Reinforcement Learning', 18: 'Gaussian Processes',
    19: 'Hyperparameter Optimization', 20: 'Generative Adversarial Networks', 21: 'Recommender Systems',
  },
  deep_learning_bishop: {
    8: 'Backpropagation', 9: 'Regularization', 10: 'Convolutional Networks',
    11: 'Structured Distributions', 12: 'Transformers', 13: 'Graph Neural Networks',
    14: 'Sampling', 15: 'Discrete Latent Variables', 16: 'Continuous Latent Variables',
    17: 'Generative Adversarial Networks', 18: 'Normalizing Flows', 19: 'Autoencoders',
    20: 'Diffusion Models',
  },
};

// Items the topic labeller could not place. "unknown" is not a field anyone
// studies, so give each a real one.
const DOMAIN_FIXES = {
  '1988-A4': 'combinatorics', '2011-A6': 'probability', 'concept:putnam:other': 'combinatorics',
  // Book-level shelf labels: "mixed" and "contest" read as internal buckets.
  'book:math_dataset': 'competition math', 'book:putnam': 'competition math',
};

// Answers missing from the source data, recovered by reading the solution.
// `lattice audit` lists anything still missing as "broken".
const ANSWER_FIXES = {
  'math:number_theory:train:661': '0',
  'math:number_theory:train:663': '0',
};

// Short author tags, for telling apart books that share a title.
const AUTHOR_TAG = {
  grinstead_snell: 'Grinstead & Snell', blitzstein: 'Blitzstein & Hwang',
};

function tidyGraph(g, extraTitles) {
  const usable = (t) => t && /[A-Za-z]/.test(t);
  const titles = new Map();
  for (const [book, chapters] of Object.entries(extraTitles)) {
    for (const [ch, t] of Object.entries(chapters)) {
      if (usable(t)) titles.set(`${book}:${ch}`, cleanLabel(t));
    }
  }
  for (const [book, chapters] of Object.entries(CHAPTER_TITLES)) {
    for (const [ch, t] of Object.entries(chapters)) titles.set(`${book}:${ch}`, t);
  }

  // MATH's topics arrive as "Counting And Probability - Level 3" (a Python
  // .title()); say it the way the rest of the app does.
  const mathLabel = (l) => l.replace(/^(.*) - Level (\d)$/, (_, t, n) =>
    `${t.replace(/ And /g, ' and ').replace(/ ([A-Z])(?=[a-z])/g, (m, c) => ` ${c.toLowerCase()}`)}, level ${n}`);
  const nodes = g.nodes.map((n) => {
    const out = { ...n, label: cleanLabel(n.label) };
    if (n.book_id === 'math_dataset' && n.kind === 'concept') out.label = mathLabel(out.label);
    if (DOMAIN_FIXES[n.id]) out.domain = DOMAIN_FIXES[n.id];
    // Chapter-level concepts inherit the placeholder too ("Chapter None").
    if (n.kind === 'concept' && /^Chapter (None|\d+)$/.test(out.label) && titles.has(`${n.book_id}:${n.chapter}`)) {
      out.label = titles.get(`${n.book_id}:${n.chapter}`);
    }
    if (n.kind === 'domain_part' && (!usable(out.label) || titles.has(`${n.book_id}:${n.chapter}`))) {
      out.label = titles.get(`${n.book_id}:${n.chapter}`) ?? `Chapter ${n.chapter}`;
    }
    return out;
  });
  // A chapter with topics but no title node: add one, so the course and
  // subject views show its name rather than "Chapter 12".
  const have = new Set(nodes.filter((n) => n.kind === 'domain_part')
    .map((n) => `${n.book_id}:${n.chapter}`));
  for (const n of g.nodes) {
    const key = `${n.book_id}:${n.chapter}`;
    if (n.kind !== 'concept' || n.chapter == null || have.has(key) || !titles.has(key)) continue;
    have.add(key);
    nodes.push({ id: `part:${key}`, kind: 'domain_part', label: titles.get(key),
                 domain: n.domain, book_id: n.book_id, chapter: n.chapter });
  }
  const chapterLabel = new Map(nodes.filter((n) => n.kind === 'domain_part')
    .map((n) => [`${n.book_id}:${n.chapter}`, n.label]));
  for (const n of nodes) {
    // Axler calls a section "Exercises"; a topic of that name, out of context, says nothing.
    const bare = (n.label ?? '').match(/^(?:\d+\s+)?(exercises|problems)$/i);
    if (n.kind === 'concept' && bare) {
      const ch = chapterLabel.get(`${n.book_id}:${n.chapter}`);
      const kind = bare[1].toLowerCase();
      n.label = ch ? `${ch}: ${kind}` : `Chapter ${n.chapter} ${kind}`;
    }
    // Blitzstein closes each chapter with a section on doing it in R.
    if (n.kind === 'concept' && n.label === 'R') {
      const ch = chapterLabel.get(`${n.book_id}:${n.chapter}`);
      n.label = ch ? `${ch} in R` : 'Working in R';
    }
  }
  // Two books called "Introduction to Probability": say whose.
  const byTitle = new Map();
  for (const n of nodes) if (n.kind === 'book') byTitle.set(n.label, (byTitle.get(n.label) ?? 0) + 1);
  for (const n of nodes) {
    if (n.kind !== 'book' || byTitle.get(n.label) < 2) continue;
    const id = n.id.replace(/^book:/, '');
    const tag = AUTHOR_TAG[id] ?? (n.authors ?? '').split(/[;,]/)[0].trim().split(/\s+/).at(-1);
    if (tag) n.label = `${n.label} (${tag})`;
  }

  const exercises = g.exercises.map((e) => {
    // Answers MATH lost to an empty \boxed{}, read off each worked solution
    // ("there are no primes in that range", "P + n is not prime for any n").
    if (ANSWER_FIXES[e.id] !== undefined && !String(e.answer ?? '').trim()) {
      e = { ...e, answer: ANSWER_FIXES[e.id], auto_gradable: true };
    }
    // Claimed auto-gradable with no answer (MATH ships two with an empty
    // \boxed{}): it can never be marked, so don't claim it. `lattice audit`
    // reports these via `answer_missing`.
    if (e.auto_gradable && !String(e.answer ?? '').trim()) {
      e = { ...e, auto_gradable: false, answer_missing: true };
    }
    // Grinstead & Snell's LaTeX cross-references leak their labels into the
    // text: "Exercise~exer 6.3.2" reads as "Exercise 6.3.2".
    if (typeof e.text === 'string' && /~[a-z]+[ :]/.test(e.text)) {
      e = { ...e, text: e.text.replace(/\b(Exercises?|Examples?|Sections?|Theorems?|Chapters?|Figures?|Tables?|Equations?|Corollary|Lemma|Definition)~(?:exer|exam|ex|sec|thm|th|ch|chp|fig|table|tab|eq|cor|lem|def)[ :]/g, '$1 ') };
    }
    const fix = DOMAIN_FIXES[e.id] ?? (e.concept_id && DOMAIN_FIXES[e.concept_id]);
    const title = e.book_id === 'math_dataset' && e.section_title
      ? mathLabel(e.section_title) : cleanLabel(e.section_title);
    return fix || title !== e.section_title
      ? { ...e, ...(fix ? { domain: fix } : {}), section_title: title }
      : e;
  });
  return { ...g, nodes, exercises };
}

// ---- what can actually be practised here ------------------------------------
// The corpus lists every exercise it knows about, but a copyrighted book's text
// only exists on a machine that owns the book. Every count a learner sees is a
// count of problems this host can serve, by the same rules the study queue uses
// — otherwise a shelf promises 765 problems and the set that opens is empty.

let dataVersion = 0;
let countsMemo = null;

function practisable(e) {
  if (!(e.text || e.has_text || localText.has(e.id))) return false;
  if (e.ocr && (e.garble ?? 0) > 0.3 && !repairedIds.has(e.id)) return false;
  const q = exerciseTags[e.id];
  if (q && ((q.servable ?? 1) < 0.5
      || (q.self_contained ?? 1) < 0.5
      || (q.notation_lost ?? 0) > 0.8
      || (q.needs_figure ?? 0) > 0.7
      || (q.truncated ?? 0) > 0.8)) return false;
  return true;
}

/** Practisable problems per book, concept (incl. topic links) and domain. */
function counts() {
  if (countsMemo?.v === dataVersion) return countsMemo;
  const book = new Map(), concept = new Map(), domain = new Map(), all = new Map();
  const bump = (m, k) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
  for (const e of graph.exercises) {
    bump(all, e.book_id);
    if (!practisable(e)) continue;
    bump(book, e.book_id);
    bump(domain, e.domain);
    bump(concept, e.concept_id);
    for (const id of e.topic_concepts ?? []) if (id !== e.concept_id) bump(concept, id);
  }
  countsMemo = { v: dataVersion, book, concept, domain, all };
  return countsMemo;
}

/** Books a learner should see: a real book node with problems in the corpus. */
const listedBook = (id) => graph.nodes.some((n) => n.id === `book:${id}`)
  && (counts().all.get(id) ?? 0) > 0;

let titlesMemo = null;
/** book_id → display title, so no view has to show a slug like grinstead_snell. */
function bookTitles() {
  if (titlesMemo?.v === dataVersion) return titlesMemo.map;
  const map = new Map(graph.nodes.filter((n) => n.kind === 'book')
    .map((n) => [n.id.replace(/^book:/, ''), n.label]));
  titlesMemo = { v: dataVersion, map };
  return map;
}

export const getGraph = () => graph;

// Host capabilities. Defaults are the safe no-ops a host without them gets.
const hooks = {
  dbLabel: 'sqlite',
  // Where a learner's history lives, in words: 'browser' when a cookie is the
  // only identity (the cloud), 'machine' for a local install.
  savedIn: 'machine',
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
    aliases: ['gradient step'] },
  // Generated from Dive into Deep Learning (site/generators-ml.js) and CS336-style
  // einsum drills (site/generators-einsum.js). Aliases route the Home box to
  // them with no model call, which is all the cloud has.
  { id: 'es-loop', name: 'Loops into einsum', domain: 'machine learning', aliases: ['loop to einsum', 'loops into einsum', 'convert loop', 'write an einsum', 'einsum practice'] },
  { id: 'es-shape', name: 'Einsum output shapes', domain: 'machine learning', aliases: ['einsum shape', 'einsum shapes', 'einsum'] },
  { id: 'es-which', name: 'Which einsum?', domain: 'machine learning', aliases: ['which einsum', 'einsum spec'] },
  { id: 'es-eval', name: 'Evaluate an einsum by hand', domain: 'machine learning', aliases: ['einsum by hand'] },
  { id: 'es-rearrange', name: 'einops rearrange', domain: 'machine learning', aliases: ['einops', 'rearrange', 'patchify'] },
  { id: 'es-flops', name: 'FLOPs of a contraction', domain: 'machine learning', aliases: ['flops', 'flop count', 'matmul flops'] },
  { id: 'es-attn-memory', name: 'Memory of the attention matrix', domain: 'machine learning', aliases: ['attention memory', 'bf16', 'bfloat16', 'gib'] },
  { id: 'es-train-flops', name: 'Training compute: 6ND', domain: 'machine learning', aliases: ['6nd', 'training compute', 'train a 7b', 'scaling law', 'mfu'] },
  { id: 'ml-mlp-params', name: 'Counting MLP parameters', domain: 'machine learning', aliases: ['parameter count', 'count parameters', 'mlp parameters'] },
  { id: 'ml-pooling', name: 'Pooling output size and cost', domain: 'machine learning', aliases: ['pooling', 'max pooling', 'output size'] },
  { id: 'ml-conv1x1', name: '1×1 convolutions', domain: 'machine learning', aliases: ['1x1 conv', '1×1 conv', 'network in network'] },
  { id: 'ml-conv-sharing', name: 'Why weight sharing pays', domain: 'machine learning', aliases: ['weight sharing', 'convolution parameters'] },
  { id: 'ml-attention-cov', name: "Attention's gradient is a covariance", domain: 'machine learning', aliases: ['attention gradient'] },
  { id: 'ml-additive-params', name: 'Parameters of additive attention', domain: 'machine learning', aliases: ['additive attention', 'bahdanau'] },
  { id: 'ml-sinusoidal-pe', name: 'Sinusoidal positional encoding', domain: 'machine learning', aliases: ['positional encoding', 'positional embedding'] },
  { id: 'ml-logsumexp', name: 'Log-sum-exp, stably', domain: 'machine learning', aliases: ['log-sum-exp', 'logsumexp', 'numerical stability'] },
  { id: 'ml-grad-clip', name: 'Gradient clipping by norm', domain: 'machine learning', aliases: ['gradient clipping', 'clip gradients'] },
  { id: 'ml-dropout', name: 'Inverted dropout', domain: 'machine learning', aliases: ['dropout'] },
  { id: 'ml-early-stopping', name: 'Early stopping with patience', domain: 'machine learning', aliases: ['early stopping', 'patience'] },
  { id: 'ml-kfold', name: 'K-fold cross-validation', domain: 'machine learning', aliases: ['cross-validation', 'cross validation', 'k-fold'] },
  { id: 'ml-vc-poly', name: 'VC dimension of polynomial classifiers', domain: 'machine learning', aliases: ['vc dimension'] },
  { id: 'ml-gd-stability', name: 'When gradient descent diverges', domain: 'machine learning', aliases: ['learning rate', 'gradient descent', 'diverge'] },
  { id: 'ml-norm-gradient', name: 'Gradient of the Euclidean norm', domain: 'machine learning', aliases: ['gradient of the norm', 'norm gradient'] },
  { id: 'ml-chain-rule', name: 'Tracing a derivative through a graph', domain: 'machine learning', aliases: ['chain rule', 'computational graph', 'autograd'] },
  { id: 'ml-backprop-memory', name: 'What backprop has to remember', domain: 'machine learning', aliases: ['backprop memory', 'activation memory', 'backpropagation'] },
  { id: 'ml-best-constant', name: 'The best constant predictor', domain: 'machine learning', aliases: ['mean vs median', 'squared loss', 'absolute loss'] },
  { id: 'ml-coin-variance', name: 'Variance of an estimated probability', domain: 'machine learning', aliases: ['chebyshev', 'variance of the mean'] },
  { id: 'ml-saddle', name: 'Minimum, maximum or saddle', domain: 'machine learning', aliases: ['saddle point', 'hessian'] },
  { id: 'ml-bootstrap', name: 'Sampling with replacement', domain: 'machine learning', aliases: ['with replacement', 'bootstrap'] },
  { id: 'ml-ngram-table', name: 'How big an n-gram table gets', domain: 'machine learning', aliases: ['n-gram', 'ngram', 'language model'] },
  { id: 'ml-sinusoid-ar', name: 'A sine wave is a two-step recurrence', domain: 'machine learning', aliases: ['autoregressive', 'time series'] },
  // Original problems on the topics of the copyrighted books (site/generators-books.js).
  { id: 'ra-delta-linear', name: 'ε–δ for a linear function', domain: 'real analysis', aliases: ['epsilon delta', 'epsilon-delta', 'ε-δ', 'continuity'] },
  { id: 'ra-delta-square', name: 'ε–δ for x²', domain: 'real analysis', aliases: ['epsilon delta', 'epsilon-delta'] },
  { id: 'ra-sequence-N', name: 'Finding N for a limit', domain: 'real analysis', aliases: ['limit of a sequence', 'sequence limit', 'convergence of sequences'] },
  { id: 'ra-sup-limsup', name: 'sup, inf, lim sup, lim inf', domain: 'real analysis', aliases: ['limsup', 'lim sup', 'supremum', 'infimum'] },
  { id: 'ra-ratio-test', name: 'Ratio test', domain: 'real analysis', aliases: ['ratio test', 'series convergence', 'convergence tests'] },
  { id: 'ra-darboux', name: 'Upper and lower sums', domain: 'real analysis', aliases: ['riemann sum', 'darboux', 'riemann integral'] },
  { id: 'ra-uniform', name: 'Uniform continuity', domain: 'real analysis', aliases: ['uniform continuity', 'uniformly continuous'] },
  { id: 'ra-countable', name: 'Countable or not', domain: 'real analysis', aliases: ['countable', 'uncountable', 'cardinality'] },
  { id: 'ra-open-closed', name: 'Open, closed, both, neither', domain: 'real analysis', aliases: ['open set', 'closed set', 'topology'] },
  { id: 'ra-proof-sqrt', name: 'Proof: √p is irrational', domain: 'real analysis', aliases: ['irrational', 'proofs', 'proof practice'] },
  { id: 'ra-proof-induction', name: 'Proof by induction: a sum formula', domain: 'real analysis', aliases: ['induction', 'proofs', 'proof practice'] },
  { id: 'ra-proof-continuity', name: 'Proof: a linear function is continuous', domain: 'real analysis', aliases: ['proofs', 'proof practice'] },
  { id: 'ra-proof-unique-limit', name: 'Proof: limits are unique', domain: 'real analysis', aliases: ['proofs', 'proof practice', 'uniqueness of limits'] },
  { id: 'aa-proof-fermat', name: "Proof: Fermat's little theorem from Lagrange", domain: 'abstract algebra', aliases: ['proofs', 'proof practice', "fermat's little theorem"] },
  { id: 'aa-order-zn', name: 'Orders in ℤₙ', domain: 'abstract algebra', aliases: ['order of an element', 'cyclic group', 'lagrange'] },
  { id: 'aa-perm-order', name: 'Order of a permutation', domain: 'abstract algebra', aliases: ['permutation', 'permutations', 'cycle decomposition'] },
  { id: 'aa-perm-sign', name: 'Even or odd permutation', domain: 'abstract algebra', aliases: ['even permutation', 'odd permutation', 'sign of a permutation'] },
  { id: 'aa-cyclic-count', name: 'Subgroups and generators of ℤₙ', domain: 'abstract algebra', aliases: ['subgroups', 'generators of a cyclic group'] },
  { id: 'nt-diophantine', name: 'Linear Diophantine equations', domain: 'number theory', aliases: ['diophantine', 'bezout', 'extended euclidean'] },
  { id: 'nt-fermat-wilson', name: 'Fermat and Wilson', domain: 'number theory', aliases: ['wilson', "wilson's theorem", 'fermat'] },
  { id: 'nt-units', name: 'Units mod n', domain: 'number theory', aliases: ['totient', 'euler phi', 'modular inverse'] },
  { id: 'la-eigen2', name: 'Eigenvalues of a 2×2 matrix', domain: 'linear algebra', aliases: ['eigenvalue', 'eigenvalues'] },
  { id: 'la-rank-nullity', name: 'Rank–nullity', domain: 'linear algebra', aliases: ['rank nullity', 'rank-nullity', 'null space', 'nullity'] },
  { id: 'la-trace-det', name: 'Trace and determinant from eigenvalues', domain: 'linear algebra', aliases: ['trace', 'determinant'] },
  { id: 'la-projection', name: 'Orthogonal projection onto a line', domain: 'linear algebra', aliases: ['projection', 'orthogonal projection'] },
  { id: 'ca-residue', name: 'Residues and contour integrals', domain: 'complex analysis', aliases: ['residue', 'residues', 'contour integral'] },
  { id: 'ca-radius', name: 'Radius of convergence', domain: 'complex analysis', aliases: ['radius of convergence', 'power series'] },
  { id: 'pr-bayes-test', name: 'Bayes and the base rate', domain: 'probability', aliases: ["bayes' rule", 'bayes rule', 'base rate', 'false positive'] },
  { id: 'pr-indicators', name: 'Expectation by indicators', domain: 'probability', aliases: ['indicator', 'linearity of expectation', 'birthday'] },  // Later d2l chapters, Bishop and Murphy (site/generators-mlbooks.js), and Stein (-complex.js).
  { id: "dl-conv-cost", name: "Size, parameters and cost of a conv layer", domain: "machine learning", aliases: ["alexnet","conv layer cost","convolution flops","conv parameters"] },
  { id: "dl-receptive-field", name: "Receptive field of stacked layers", domain: "machine learning", aliases: ["receptive field","vgg"] },
  { id: "dl-batchnorm", name: "Batch normalization", domain: "machine learning", aliases: ["batch norm","batch normalization","batchnorm"] },
  { id: "dl-densenet", name: "Channels in a DenseNet", domain: "machine learning", aliases: ["densenet","growth rate"] },
  { id: "dl-rnn-params", name: "Parameters of RNN, GRU and LSTM layers", domain: "machine learning", aliases: ["lstm","gru","lstm parameters","gru parameters","rnn parameters"] },
  { id: "dl-birnn-shape", name: "Shapes in bidirectional RNNs", domain: "machine learning", aliases: ["bidirectional rnn","birnn"] },
  { id: "dl-beam-search", name: "The cost of beam search", domain: "machine learning", aliases: ["beam search","greedy decoding"] },
  { id: "dl-bleu", name: "BLEU by hand", domain: "machine learning", aliases: ["bleu","bleu score"] },
  { id: "dl-roofline", name: "Compute-bound or memory-bound?", domain: "machine learning", aliases: ["roofline","arithmetic intensity","memory-bound","compute-bound"] },
  { id: "dl-allreduce", name: "Data parallelism and all-reduce", domain: "machine learning", aliases: ["all-reduce","allreduce","data parallel","data parallelism"] },
  { id: "dl-iou", name: "Intersection over union", domain: "machine learning", aliases: ["iou","intersection over union","bounding box"] },
  { id: "dl-anchors", name: "Counting anchor boxes", domain: "machine learning", aliases: ["anchor boxes","anchor box"] },
  { id: "dl-transposed-conv", name: "Transposed convolution output size", domain: "machine learning", aliases: ["transposed convolution","deconvolution","upsampling"] },
  { id: "dl-bpe", name: "Byte pair encoding", domain: "machine learning", aliases: ["bpe","byte pair encoding","subword"] },
  { id: "dl-word2vec-cost", name: "Subsampling and negative sampling", domain: "machine learning", aliases: ["word2vec","negative sampling","skip-gram","subsampling"] },
  { id: "dl-transformer-params", name: "Parameters of BERT-style models", domain: "machine learning", aliases: ["bert","transformer parameters","bert parameters"] },
  { id: "dl-textcnn", name: "TextCNN shapes", domain: "machine learning", aliases: ["textcnn","text cnn","max-over-time pooling"] },
  { id: "dl-value-iteration", name: "Value iteration and returns", domain: "machine learning", aliases: ["value iteration","discounted return","mdp"] },
  { id: "dl-q-learning", name: "One Q-learning update", domain: "machine learning", aliases: ["q-learning","q learning","reinforcement learning"] },
  { id: "dl-gp-posterior", name: "Gaussian process predictions", domain: "machine learning", aliases: ["gaussian process","gaussian processes","gp regression"] },
  { id: "dl-rbf-kernel", name: "The RBF kernel", domain: "machine learning", aliases: ["rbf kernel","kernel function","squared exponential kernel"] },
  { id: "dl-hpo", name: "Grid, random search and successive halving", domain: "machine learning", aliases: ["hyperparameter optimization","grid search","random search","successive halving"] },
  { id: "dl-gan", name: "The optimal discriminator", domain: "machine learning", aliases: ["gan","gans","discriminator","generative adversarial"] },
  { id: "dl-matrix-factorization", name: "Matrix factorization for recommenders", domain: "machine learning", aliases: ["matrix factorization","recommender","recommender systems","collaborative filtering"] },
  { id: "bs-gaussian-mle", name: "Maximum likelihood for a Gaussian", domain: "machine learning", aliases: ["maximum likelihood","mle","sample variance"] },
  { id: "bs-information", name: "Entropy, cross-entropy and KL divergence", domain: "machine learning", aliases: ["entropy","kl divergence","mutual information","information theory"] },
  { id: "bs-beta-binomial", name: "Beta–binomial updating", domain: "machine learning", aliases: ["beta binomial","beta prior","conjugate prior","map estimate"] },
  { id: "bs-conditional-gaussian", name: "Conditioning a bivariate Gaussian", domain: "machine learning", aliases: ["multivariate gaussian","conditional gaussian","bivariate normal"] },
  { id: "bs-density-estimation", name: "Histograms and nearest-neighbour densities", domain: "machine learning", aliases: ["histogram","kernel density","nearest neighbour density","nonparametric"] },
  { id: "bs-least-squares", name: "Least squares and ridge regression", domain: "machine learning", aliases: ["least squares","linear regression","ridge regression"] },
  { id: "bs-bias-variance", name: "Bias and variance of a shrunk estimator", domain: "machine learning", aliases: ["bias variance","bias-variance","mean squared error"] },
  { id: "bs-classification-metrics", name: "Precision, recall and decision thresholds", domain: "machine learning", aliases: ["precision","recall","f1","f1 score","confusion matrix"] },
  { id: "bs-gaussian-classifier", name: "Generative classifiers with Gaussian classes", domain: "machine learning", aliases: ["lda","linear discriminant analysis","generative classifier","decision boundary"] },
  { id: "bs-logistic", name: "Logistic regression by hand", domain: "machine learning", aliases: ["logistic regression","sigmoid"] },
  { id: "bs-momentum-adam", name: "Momentum and Adam", domain: "machine learning", aliases: ["momentum","adam","optimizers"] },
  { id: "bs-weight-decay", name: "Weight decay", domain: "machine learning", aliases: ["weight decay","l2 regularization","regularization"] },
  { id: "bs-bayes-net-params", name: "Parameters of a Bayesian network", domain: "machine learning", aliases: ["bayesian network","graphical model","graphical models"] },
  { id: "bs-gnn", name: "One round of message passing", domain: "machine learning", aliases: ["gnn","graph neural network","message passing","gcn"] },
  { id: "bs-sampling", name: "Rejection sampling and Metropolis", domain: "machine learning", aliases: ["rejection sampling","metropolis","mcmc","importance sampling"] },
  { id: "bs-kmeans-gmm", name: "K-means and mixture responsibilities", domain: "machine learning", aliases: ["k-means","kmeans","gaussian mixture","gmm","em algorithm"] },
  { id: "bs-pca", name: "Principal components and explained variance", domain: "machine learning", aliases: ["pca","principal component analysis","explained variance","dimensionality reduction"] },
  { id: "bs-flows", name: "Change of variables in normalizing flows", domain: "machine learning", aliases: ["normalizing flow","normalizing flows","change of variables"] },
  { id: "bs-vae-kl", name: "The KL term of a VAE", domain: "machine learning", aliases: ["vae","variational autoencoder","elbo"] },
  { id: "bs-diffusion", name: "The forward process of a diffusion model", domain: "machine learning", aliases: ["diffusion","diffusion model","ddpm"] },
  { id: "ca-complex-arithmetic", name: "Moduli, arguments and roots", domain: "complex analysis", aliases: ["complex numbers","roots of unity","de moivre","modulus"] },
  { id: "ca-harmonic", name: "Holomorphic and harmonic functions", domain: "complex analysis", aliases: ["harmonic function","cauchy-riemann","harmonic conjugate"] },
  { id: "ca-power-series", name: "Power series coefficients", domain: "complex analysis", aliases: ["power series coefficients","taylor series"] },
  { id: "ca-fourier", name: "Fourier transforms by contour integration", domain: "complex analysis", aliases: ["fourier transform"] },
  { id: "ca-real-integrals", name: "Real integrals by residues", domain: "complex analysis", aliases: ["residue theorem","real integrals","improper integrals"] },
  { id: "ca-zeros-poles", name: "Orders of zeros and poles", domain: "complex analysis", aliases: ["zeros and poles","order of a pole","laurent series"] },
  { id: "ca-argument-principle", name: "Counting zeros inside a circle", domain: "complex analysis", aliases: ["argument principle","rouche","rouché"] },
  { id: "ca-entire-order", name: "Order of growth of entire functions", domain: "complex analysis", aliases: ["entire functions","order of growth"] },
  { id: "ca-gamma-zeta", name: "Values of Γ and ζ", domain: "complex analysis", aliases: ["gamma function","zeta function","riemann zeta"] },
  { id: "ca-conformal", name: "Möbius maps and the disc", domain: "complex analysis", aliases: ["conformal map","mobius","möbius","cayley transform","blaschke"] },
  // Skills that had no entry, so the Home box could never reach them (the Street-Fighting set
  // among them: "real world mental math" fell through to arithmetic drills).
  { id: "squares", name: "Squares", domain: "arithmetic", aliases: ["squares", "squaring numbers", "perfect squares"] },
  { id: "divisibility", name: "Divisibility", domain: "arithmetic", aliases: ["divisibility", "divisibility rules", "divisible"] },
  { id: "gcd-lcm", name: "GCD and LCM", domain: "arithmetic", aliases: ["gcd", "lcm", "greatest common divisor", "least common multiple"] },
  { id: "mod-power", name: "Modular powers", domain: "arithmetic", aliases: ["modular powers", "modular exponentiation", "last digit"] },
  { id: "series", name: "Series and sums", domain: "arithmetic", aliases: ["series", "arithmetic series", "sum of a sequence"] },
  { id: "counting", name: "Counting", domain: "arithmetic", aliases: ["counting", "permutations and combinations"] },
  { id: "estimate", name: "Estimation", domain: "arithmetic", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "estimate", "rough calculation"] },
  { id: "bases", name: "Number bases", domain: "arithmetic", aliases: ["number bases", "binary", "hexadecimal", "base conversion"] },
  { id: "linear", name: "Linear equations", domain: "arithmetic", aliases: ["linear equations", "solve for x", "equations"] },
  { id: "logs", name: "Logs and exponents", domain: "arithmetic", aliases: ["logs", "logarithms", "logarithm"] },
  { id: "ml-interpolation", name: "Fitting points exactly", domain: "machine learning", aliases: ["interpolation", "polynomial fit"] },
  { id: "ml-sqrt-n", name: "How error shrinks with data", domain: "machine learning", aliases: ["sqrt n", "error scaling", "more data"] },
  { id: "ml-noisy-gram", name: "Noise regularizes the design matrix", domain: "machine learning", aliases: ["noise injection", "gram matrix"] },
  { id: "ml-markov-joint", name: "Joint probability of a Markov chain", domain: "machine learning", aliases: ["markov joint", "joint probability of a sequence"] },
  { id: "ml-vector-backward", name: "Backward through a vector output", domain: "machine learning", aliases: ["vector backward", "jacobian vector product", "vjp"] },
  { id: "ml-tanh-sigmoid", name: "tanh and sigmoid are one function", domain: "machine learning", aliases: ["tanh", "tanh and sigmoid"] },
  { id: "ml-bisection", name: "Line search by bisection", domain: "machine learning", aliases: ["line search"] },
  { id: "ml-softplus-min", name: "Minimizing a log-sum-exp by hand", domain: "machine learning", aliases: ["softplus"] },
  { id: "ml-padding", name: "Padding cost of whole sentences", domain: "machine learning", aliases: ["padding", "sequence padding"] },
  { id: "ml-onehot-embedding", name: "One-hot times a matrix is a lookup", domain: "machine learning", aliases: ["one-hot", "one hot", "embedding lookup", "embeddings"] },
  { id: "ml-additive-memory", name: "Memory of additive attention", domain: "machine learning", aliases: ["additive attention memory"] },
  { id: "ml-nullspace-proj", name: "Projecting onto a subspace", domain: "machine learning", aliases: ["null space projection", "project onto a subspace"] },
  { id: "ml-linear-rank", name: "Depth without nonlinearity", domain: "machine learning", aliases: ["linear layers", "why nonlinearity", "deep linear network"] },
  { id: "ml-rnn-history", name: "Truncation length in RNN training", domain: "machine learning", aliases: ["truncated bptt", "backpropagation through time", "bptt"] },
  { id: "ml-past-returns", name: "Why past returns mislead", domain: "machine learning", aliases: ["past returns", "overfitting to history"] },
  { id: "ml-model-parallel", name: "Splitting a network across GPUs", domain: "machine learning", aliases: ["model parallel", "model parallelism", "pipeline parallelism"] },
  { id: "sf-dimensions", name: "Dimensional analysis", domain: "estimation", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "dimensional analysis", "units", "dimensions"] },
  { id: "sf-easy-cases", name: "Easy cases", domain: "estimation", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "easy cases", "special cases", "sanity check"] },
  { id: "sf-lumping", name: "Lumping a Gaussian", domain: "estimation", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "lumping"] },
  { id: "sf-pictorial", name: "Pictorial proofs: the best rectangle", domain: "estimation", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "pictorial proofs", "am-gm", "best rectangle"] },
  { id: "sf-big-part", name: "Taking out the big part", domain: "estimation", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "taking out the big part", "big part", "quick approximation"] },
  { id: "sf-analogy", name: "Analogy: cutting a cake", domain: "estimation", aliases: ["real world math", "real-world math", "real world mental math", "real-world mental math", "real world", "real-world", "estimation", "estimating", "fermi", "fermi problems", "back of the envelope", "back-of-the-envelope", "street-fighting", "street fighting", "street-fighting math", "street fighting math", "order of magnitude", "approximation", "analogy", "cake cutting", "cutting a cake"] },
  { id: "pt-steps", name: "Putnam proofs, step by step", domain: "competition math", aliases: ["putnam steps", "putnam proofs", "competition proofs", "putnam solutions"] },
  // Grinstead & Snell (site/generators-gs.js), and the analysis and algebra chapters
  // of Tao, Pugh, Herstein and Axler (site/generators-analysis.js, -algebra.js).
  { id: "gs-roulette", name: "Roulette odds", domain: "probability", aliases: ["roulette","house edge"] },
  { id: "gs-loaded-die", name: "A loaded die", domain: "probability", aliases: ["loaded die","probability distribution"] },
  { id: "gs-odds", name: "Odds and probability", domain: "probability", aliases: ["odds","odds against","odds in favour"] },
  { id: "gs-first-success", name: "Waiting for the first head", domain: "probability", aliases: ["first success","waiting for a head"] },
  { id: "gs-uniform-interval", name: "Uniform on an interval", domain: "probability", aliases: ["uniform distribution","continuous uniform"] },
  { id: "gs-exponential", name: "Exponential lifetimes", domain: "probability", aliases: ["exponential distribution","failure rate","reliability"] },
  { id: "gs-arrangements", name: "Arrangements", domain: "probability", aliases: ["arrangements","circular arrangements","seating arrangements"] },
  { id: "gs-derangements", name: "Nobody gets their own hat", domain: "probability", aliases: ["derangement","derangements","hat check","fixed points"] },
  { id: "gs-birthday", name: "The birthday problem", domain: "probability", aliases: ["birthday problem","birthday paradox"] },
  { id: "gs-binomial", name: "Binomial probabilities", domain: "probability", aliases: ["binomial","binomial distribution","bernoulli trials"] },
  { id: "gs-counting", name: "Choosing and dealing", domain: "probability", aliases: ["combinations","binomial coefficient","poker hands","multinomial"] },
  { id: "gs-rising-sequences", name: "Rising sequences", domain: "probability", aliases: ["card shuffling","rising sequences","riffle shuffle"] },
  { id: "gs-conditional-draws", name: "Conditioning on a sum", domain: "probability", aliases: ["conditional probability"] },
  { id: "gs-urns-bayes", name: "Which urn was it?", domain: "probability", aliases: ["urn","urns","bayes theorem"] },
  { id: "gs-independent-events", name: "Independent events", domain: "probability", aliases: ["independent events","independence"] },
  { id: "gs-continuous-conditional", name: "Conditioning on a continuous event", domain: "probability", aliases: ["memoryless","rule of succession","conditional density"] },
  { id: "gs-paradoxes", name: "Box paradox and Monty Hall", domain: "probability", aliases: ["monty hall","box paradox","bertrand"] },
  { id: "gs-poisson", name: "Poisson approximation", domain: "probability", aliases: ["poisson","poisson approximation","poisson distribution"] },
  { id: "gs-min-uniform", name: "The smallest of n rolls", domain: "probability", aliases: ["minimum of dice","order statistics","maximum of dice"] },
  { id: "gs-geometric", name: "Geometric and negative binomial", domain: "probability", aliases: ["geometric distribution","negative binomial"] },
  { id: "gs-normal", name: "Normal tolerances", domain: "probability", aliases: ["normal distribution","gaussian","standard normal","z-score"] },
  { id: "gs-density-transform", name: "Densities and transformations", domain: "probability", aliases: ["density function","transformation of random variables","beta integral"] },
  { id: "gs-expected-value", name: "Expected winnings", domain: "probability", aliases: ["expected value","expectation","expected winnings"] },
  { id: "gs-variance", name: "Variance", domain: "probability", aliases: ["variance","standard deviation"] },
  { id: "gs-continuous-moments", name: "Mean and variance of a density", domain: "probability", aliases: ["mean of a density","moments of a density"] },
  { id: "gs-dice-sums", name: "Sums of dice", domain: "probability", aliases: ["sum of dice","dice sums","convolution"] },
  { id: "gs-continuous-sums", name: "Sums and minima of continuous variables", domain: "probability", aliases: ["sum of uniforms","minimum of exponentials","gamma distribution"] },
  { id: "gs-chebyshev", name: "Chebyshev's inequality", domain: "probability", aliases: ["chebyshev inequality","chebyshev's inequality","law of large numbers"] },
  { id: "gs-clt-bernoulli", name: "Normal approximation to coin tosses", domain: "probability", aliases: ["central limit theorem","normal approximation","continuity correction"] },
  { id: "gs-clt-dice", name: "Sums of many dice", domain: "probability", aliases: ["clt for dice"] },
  { id: "gs-clt-average", name: "How close is the average?", domain: "probability", aliases: ["sample mean","sample size","confidence interval"] },
  { id: "gs-generating-functions", name: "Generating functions", domain: "probability", aliases: ["generating function","generating functions","probability generating function"] },
  { id: "gs-branching", name: "Branching processes", domain: "probability", aliases: ["branching process","extinction probability"] },
  { id: "gs-mgf-moments", name: "Moments from a density", domain: "probability", aliases: ["moment generating function","mgf"] },
  { id: "gs-markov-steps", name: "Markov chains: n steps ahead", domain: "probability", aliases: ["markov chain","markov chains","transition matrix","land of oz"] },
  { id: "gs-absorbing", name: "Absorbing chains and the drunkard's walk", domain: "probability", aliases: ["absorbing markov chain","absorbing chain","drunkard's walk","fundamental matrix"] },
  { id: "gs-fixed-vector", name: "Fixed vectors of regular chains", domain: "probability", aliases: ["stationary distribution","fixed vector","ergodic chain","regular chain"] },
  { id: "gs-first-passage", name: "Mean first passage times", domain: "probability", aliases: ["mean first passage","first passage time","mean recurrence time"] },
  { id: "gs-random-walk", name: "Returns to the origin", domain: "probability", aliases: ["random walk","return to the origin"] },
  { id: "gs-gamblers-ruin", name: "Gambler's ruin", domain: "probability", aliases: ["gambler's ruin","gamblers ruin"] },
  { id: "gs-arcsine", name: "The arc sine law", domain: "probability", aliases: ["arc sine law","arcsine law"] },
  { id: "an-image-preimage", name: "Images and inverse images", domain: "real analysis", aliases: ["inverse image","preimage","image of a set"] },
  { id: "an-count-functions", name: "Counting functions and subsets", domain: "real analysis", aliases: ["counting functions","injections","power set"] },
  { id: "an-cauchy-steady", name: "Cauchy sequences: finding N", domain: "real analysis", aliases: ["cauchy sequence","cauchy sequences"] },
  { id: "an-standard-limits", name: "Standard limits", domain: "real analysis", aliases: ["standard limits","limits of sequences"] },
  { id: "an-limit-points", name: "Limit points of a sequence", domain: "real analysis", aliases: ["limit points","subsequences","subsequence"] },
  { id: "an-series-sum", name: "Summing geometric and telescoping series", domain: "real analysis", aliases: ["geometric series","telescoping series","sum of a series"] },
  { id: "an-series-test", name: "Does the series converge?", domain: "real analysis", aliases: ["series tests","absolute convergence","conditional convergence","comparison test"] },
  { id: "an-extreme-values", name: "Maximum principle", domain: "real analysis", aliases: ["extreme value theorem","maximum principle","maxima and minima"] },
  { id: "an-ivt", name: "Intermediate value theorem", domain: "real analysis", aliases: ["intermediate value theorem","ivt","bisection"] },
  { id: "an-difference-quotient", name: "Derivative from the definition", domain: "real analysis", aliases: ["derivative definition","difference quotient"] },
  { id: "an-lhopital", name: "L'Hôpital's rule", domain: "real analysis", aliases: ["l'hôpital","l'hopital","lhopital"] },
  { id: "an-inverse-derivative", name: "Derivative of an inverse function", domain: "real analysis", aliases: ["inverse function derivative","derivative of an inverse"] },
  { id: "an-mean-value", name: "Mean value theorem", domain: "real analysis", aliases: ["mean value theorem","mvt"] },
  { id: "an-piecewise-constant", name: "Integrals of piecewise constant functions", domain: "real analysis", aliases: ["piecewise constant","step function integral"] },
  { id: "an-ftc", name: "Fundamental theorems of calculus", domain: "real analysis", aliases: ["fundamental theorem of calculus","ftc","definite integral"] },
  { id: "an-stieltjes", name: "Riemann–Stieltjes integrals", domain: "real analysis", aliases: ["riemann-stieltjes","stieltjes"] },
  { id: "an-uniform-convergence", name: "Uniform convergence", domain: "real analysis", aliases: ["uniform convergence","sup norm","pointwise convergence"] },
  { id: "an-jacobian", name: "Derivatives of maps ℝ² → ℝ²", domain: "real analysis", aliases: ["jacobian","directional derivative","multivariable calculus"] },
  { id: "an-measure", name: "Lebesgue measure of simple sets", domain: "real analysis", aliases: ["lebesgue measure","measure zero","cantor set"] },
  { id: "an-proof-sum-limits", name: "Proof: the limit of a sum", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-bounded", name: "Proof: convergent sequences are bounded", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-monotone", name: "Proof: bounded monotone sequences converge", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-differentiable", name: "Proof: differentiable implies continuous", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-ivt-root", name: "Proof: a polynomial has a root in an interval", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-cantor", name: "Proof: no set maps onto its power set", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-uniform-limit", name: "Proof: uniform limits of continuous functions are continuous", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-rolle", name: "Proof: Rolle's theorem", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "an-proof-geometric", name: "Proof: the geometric series", domain: "real analysis", aliases: ["proofs","proof practice"] },
  { id: "al-lagrange", name: "Lagrange's theorem", domain: "abstract algebra", aliases: ["lagrange's theorem","lagrange theorem","cosets","index of a subgroup"] },
  { id: "al-direct-product", name: "Orders in direct products", domain: "abstract algebra", aliases: ["direct product","direct products"] },
  { id: "al-homomorphisms", name: "Homomorphisms of cyclic groups", domain: "abstract algebra", aliases: ["homomorphism","homomorphisms","kernel of a homomorphism"] },
  { id: "al-conjugacy", name: "Conjugacy classes in Sₙ", domain: "abstract algebra", aliases: ["conjugacy class","conjugacy classes","cycle type"] },
  { id: "al-sylow", name: "Counting Sylow subgroups", domain: "abstract algebra", aliases: ["sylow","sylow theorems","sylow subgroups"] },
  { id: "al-ring-elements", name: "Units, zero divisors and idempotents in ℤₙ", domain: "abstract algebra", aliases: ["zero divisors","nilpotent","idempotent"] },
  { id: "al-ideals-zn", name: "Ideals and quotients of ℤ and ℤₙ", domain: "abstract algebra", aliases: ["ideals","maximal ideal","quotient ring"] },
  { id: "al-polynomial-roots", name: "Roots of polynomials mod p and over ℚ", domain: "abstract algebra", aliases: ["polynomial rings","rational root theorem","remainder theorem"] },
  { id: "al-field-degree", name: "Degrees of field extensions", domain: "abstract algebra", aliases: ["field extension","degree of an extension","field extensions"] },
  { id: "al-finite-fields", name: "Finite fields", domain: "abstract algebra", aliases: ["finite field","finite fields","galois field","irreducible polynomials"] },
  { id: "al-cyclotomic", name: "Cyclotomic polynomials and constructible polygons", domain: "abstract algebra", aliases: ["cyclotomic","cyclotomic polynomial","constructible polygon"] },
  { id: "la-span-dimension", name: "Dimension of a span", domain: "linear algebra", aliases: ["span","linear independence","dimension of a span"] },
  { id: "la-subspace-dim", name: "Dimensions of subspaces", domain: "linear algebra", aliases: ["subspace dimension","dimension of a subspace","direct sum"] },
  { id: "la-differentiation-map", name: "The differentiation map on polynomials", domain: "linear algebra", aliases: ["differentiation operator","linear map on polynomials"] },
  { id: "la-inner-product", name: "Inner products on polynomials", domain: "linear algebra", aliases: ["inner product","inner products"] },
  { id: "la-gram-schmidt", name: "Gram–Schmidt and distance to a subspace", domain: "linear algebra", aliases: ["gram-schmidt","gram schmidt","distance to a subspace"] },
  { id: "la-spectral", name: "Self-adjoint, positive and singular values", domain: "linear algebra", aliases: ["spectral theorem","singular values","positive definite","normal operator"] },
  { id: "la-jordan", name: "Reading a Jordan form", domain: "linear algebra", aliases: ["jordan form","jordan canonical form","generalized eigenvectors","minimal polynomial"] },
  { id: "la-determinant-volume", name: "Determinants and volume", domain: "linear algebra", aliases: ["determinants","volume of a parallelepiped"] },
  { id: "la-change-basis", name: "Coordinates in a new basis", domain: "linear algebra", aliases: ["change of basis","coordinates in a basis"] },
  { id: "al-proof-lagrange", name: "Proof: Lagrange's theorem", domain: "abstract algebra", aliases: ["proofs","proof practice"] },
  { id: "al-proof-kernel-normal", name: "Proof: the kernel is a normal subgroup", domain: "abstract algebra", aliases: ["proofs","proof practice"] },
  { id: "al-proof-cyclic-subgroup", name: "Proof: subgroups of cyclic groups are cyclic", domain: "abstract algebra", aliases: ["proofs","proof practice"] },
  { id: "al-proof-pid", name: "Proof: every ideal of ℤ is principal", domain: "abstract algebra", aliases: ["proofs","proof practice"] },
  { id: "al-proof-zp-field", name: "Proof: ℤₚ is a field", domain: "abstract algebra", aliases: ["proofs","proof practice"] },
  { id: "la-proof-eigen-independent", name: "Proof: eigenvectors for distinct eigenvalues are independent", domain: "linear algebra", aliases: ["proofs","proof practice"] },
  { id: "la-proof-real-eigenvalues", name: "Proof: self-adjoint operators have real eigenvalues", domain: "linear algebra", aliases: ["proofs","proof practice"] },
  { id: "la-proof-injective-null", name: "Proof: T is injective iff null T = {0}", domain: "linear algebra", aliases: ["proofs","proof practice"] },
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

/** Where a problem comes from, in words a reader would write. */
function citeFor(e) {
  const title = bookTitles().get(e.book_id) ?? e.book_id;
  if (e.book_id === 'putnam') return e.section_title || `Putnam ${e.label ?? ''}`.trim();
  if (e.book_id === 'math_dataset') return `MATH · ${e.section_title ?? ''}`.trim();
  const label = (e.label ?? '').replace(/^exer\s+/i, 'Exercise ');
  return e.page ? `${title}, p. ${e.page}` : `${title} · ${label}`.replace(/ · $/, '');
}

function withText(e) {
  const text = e.text ?? localText.get(e.id) ?? null;
  const extras = putnamExtras.get(e.id);
  return {
    ...e,
    text,
    // Whether Hint and Show solution have anything behind them, so the card
    // can leave out a button that would do nothing.
    has_hints: (extras?.hints?.length ?? 0) > 0,
    has_solution: Boolean(extras?.solution || e.solution_text || e.solution_tex
      || e.worked_solution || e.solution
      || (e.book_id === 'math_dataset' && e.has_published_solution)),
    book_title: bookTitles().get(e.book_id) ?? null,
    cite: citeFor(e),
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

// "5 minute mental math challenge", "einsum blitz", "10 questions in 2 min".
// A request with a clock in it is still a topic request: the duration comes
// out here, the rest of the sentence is routed exactly as if it had been typed
// alone, and the clock goes back on whatever set that produced.
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, sixty: 60 };
const TIMER_WORDS = /\b(timed|time[ -]?trial|against the clock|countdown|speed[ -]?(round|run|drill)?|blitz|sprint|race|rapid[ -]?fire|lightning(?: round)?|quick[ -]?fire)\b/;

export function parseTimedRequest(text) {
  let rest = ` ${String(text ?? '').toLowerCase()} `;
  let seconds = 0;
  const num = '(\\d+(?:\\.\\d+)?|half an?|' + Object.keys(NUMBER_WORDS).join('|') + ')';
  const dur = new RegExp(`${num}[\\s-]*(minutes?|mins?|m|seconds?|secs?|s)\\b`);
  const m = rest.match(dur);
  if (m) {
    const n = /^half/.test(m[1]) ? 0.5 : NUMBER_WORDS[m[1]] ?? Number(m[1]);
    seconds = Math.round(/^m/.test(m[2]) ? n * 60 : n);
    rest = rest.replace(m[0], ' ');
  }
  const keyword = rest.match(TIMER_WORDS);
  if (!seconds && !keyword) return null;
  if (!seconds) seconds = /blitz|lightning|rapid|quick/.test(keyword[0]) ? 60 : 180;
  seconds = Math.max(15, Math.min(3600, seconds));
  // "10 questions in 2 minutes" is a race to a finish line, not an open round.
  const c = rest.match(/\b(\d+)\s*(questions?|problems?|qs?)\b/);
  const count = c ? Math.min(100, Number(c[1])) : 0;
  if (c) rest = rest.replace(c[0], ' ');
  rest = rest.replace(TIMER_WORDS, ' ')
    // "challenge me" is its own request (a harder set); a bare "challenge" is
    // just what the learner called the timed round.
    .replace(/\b(timer|clock|round|challenge(?!\s+me\b)|give me|i want|let'?s do|start|quick)\b/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s:,.;!?-]+|[\s:,.;!?-]+$/g, '')
    .replace(/^(?:(?:a|an|of|in|on|for|with|under|within|the|some)\s+)+/, '')
    .replace(/(?:\s+(?:a|an|of|in|on|for|with|under|within|the))+$/, '')
    .trim();
  return { seconds, count, rest: /[a-z]{2}/.test(rest) ? rest : '' };
}

/** "90s", "2-min", "1½-min". */
export function timedLabel(seconds) {
  if (seconds < 60 || seconds % 30) return `${seconds}s`;
  const min = seconds / 60;
  return `${Number.isInteger(min) ? min : `${Math.floor(min)}½`}-min`;
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
        // The map promises actions, not merely bibliographic pointers: a
        // concept counts only the problems this host can actually serve.
        const exerciseCounts = counts().concept;
        const nodes = (kinds ? graph.nodes.filter((n) => kinds.includes(n.kind)) : graph.nodes)
          .map((n) => ({ ...n, exercise_count: exerciseCounts.get(n.id) ?? 0 }));
        const edges = graph.edges.filter((e) => e.type !== 'assessed_by');
        return json({ nodes, edges });
      }

      case p === '/stats':
        return json({ ...stats(db), streak: streak(db), saved_in: hooks.savedIn });

      case p === '/activity':
        return json(activity(db, Number(url.searchParams.get('days') ?? 120)));

      case p === '/coverage': {
        // How much of each domain has any evidence at all - the honest denominator
        // behind every mastery number on the progress page.
        const m = conceptMastery(db);
        const byDomain = new Map();
        const avail = counts().concept;
        for (const n of graph.nodes) {
          // Same denominator as the graph's "active concepts": topics with
          // problems here, plus any you have evidence on from elsewhere.
          if (n.kind !== 'concept' || !(avail.get(n.id) || m.has(n.id))) continue;
          const d = byDomain.get(n.domain) ?? { domain: n.domain, concepts: 0,
                                                assessed: 0, mastery_sum: 0, exercises: 0 };
          d.concepts += 1;
          const mm = m.get(n.id);
          if (mm) { d.assessed += 1; d.mastery_sum += mm.mastery; }
          byDomain.set(n.domain, d);
        }
        for (const d of byDomain.values()) d.exercises = counts().domain.get(d.domain) ?? 0;
        return json([...byDomain.values()].map((d) => ({
          domain: d.domain, concepts: d.concepts, assessed: d.assessed,
          exercises: d.exercises,
          mastery: d.assessed ? +(d.mastery_sum / d.assessed).toFixed(3) : null,
          coverage: +(d.assessed / d.concepts).toFixed(3),
        })).sort((a, b) => b.exercises - a.exercises));
      }

      case p === '/books': {
        const books = graph.nodes.filter((n) => n.kind === 'book'
          && listedBook(n.id.replace(/^book:/, '')));
        const c = counts();
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
            exercises: c.book.get(id) ?? 0,
            // In the corpus but not servable here (copyrighted text lives only on
            // a machine that owns the book): shown as a reference, not a course.
            reference_only: !c.book.get(id),
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
        // Fields you can practise here, or have history in.
        return json({ target_success: TARGET_P, domains: abilityReport(db, graph, counts().domain)
          .filter((a) => a.pool || a.attempts) });

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
        const ability = abilityReport(db, graph, counts().domain);
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
        const ability = new Map(abilityReport(db, graph, counts().domain).map((a) => [a.domain, a]));
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
        for (const r of rows.values()) r.exercises = counts().domain.get(r.domain) ?? 0;
        return json([...rows.values()].filter((r) => r.exercises || r.assessed).map((r) => ({
          domain: r.domain, concepts: r.concepts, assessed: r.assessed,
          exercises: r.exercises, books: [...r.books].filter(listedBook),
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
        const conceptCounts = counts().concept;
        const bookMeta = new Map(graph.nodes.filter((n) => n.kind === 'book')
          .map((n) => [n.id.replace(/^book:/, ''), n]));
        const chapters = new Map(graph.nodes.filter((n) => n.kind === 'domain_part' && n.chapter != null)
          .map((n) => [`${n.book_id}:${n.chapter}`, n.label]));

        const byBook = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept' || n.domain !== domain) continue;
          const book = n.book_id ?? 'other';
          if (!listedBook(book)) continue;
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
            // No chapter means no heading: MATH's topics have none, and a
            // lookup on "math_dataset:undefined" found the last part's title.
            chapter_title: n.chapter == null ? null : chapters.get(`${book}:${n.chapter}`) ?? null,
            page: n.page ?? null,
            exercises: conceptCounts.get(n.id) ?? 0,
            mastery: mm ? mm.mastery : null,
            attempts: mm ? mm.attempts : 0,
          });
          byBook.set(book, b);
        }
        for (const b of byBook.values()) {
          b.exercises = b.topics.reduce((a, t) => a + t.exercises, 0);
          b.reference_only = !counts().book.get(b.book_id);
          b.topics.sort((x, y) => (x.chapter ?? 0) - (y.chapter ?? 0)
            || y.exercises - x.exercises);
        }
        const ability = abilityReport(db, graph, counts().domain).find((a) => a.domain === domain) ?? null;
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
        const bookCounts = counts().book;
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
          if (n.kind !== 'concept' || !n.book_id || !listedBook(n.book_id)) continue;
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
            // The book's own field: its first topic's would file the Putnam
            // archive under abstract algebra.
            domain: meta?.domain ?? r.domain,
            title: meta?.label ?? r.id,
            authors: bookAuthors(r.id, meta?.authors),
            url: bookLink(r.id, meta?.label, meta?.authors).url,
            exercises: bookCounts.get(r.id) ?? 0,
            reference_only: !bookCounts.get(r.id),
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
        const conceptCounts = counts().concept;
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
              exercises: conceptCounts.get(n.id) ?? 0,
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
            reference_only: !counts().book.get(book),
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
        const ability = abilityReport(db, graph, counts().domain).filter((a) => a.pool > 0);
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

      case p === '/due': {
        // Named, not just ids: "d2l:p1@p247#3" means nothing to a reader.
        const byId = new Map(graph.exercises.map((e) => [e.id, e]));
        return json(dueItems(db, Number(url.searchParams.get('n') ?? 20)).map((d) => {
          const e = byId.get(d.item_id);
          const where = e?.section_title || conceptLabel(e?.concept_id) || null;
          return { ...d, label: where, book_title: e ? bookTitles().get(e.book_id) ?? null : null };
        }));
      }

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
          ?? extraItem?.worked_solution ?? extraItem?.solution
          ?? await solutionFor(id) ?? null;
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
        for (const d of counts().domain.keys()) domainSet.add(d);
        for (const d of domainSet) {
          const r = rank(d);
          if (r) out.push({ kind: 'field', label: d, sub: 'field',
                            href: `#subject|${encodeURIComponent(d)}`, rank: r + 1.5 });
        }
        for (const n of graph.nodes) {
          if (!n.label) continue;
          if (n.kind === 'book') {
            if (!listedBook(n.id.replace(/^book:/, ''))) continue;
            const r = rank(n.label);
            if (r) out.push({ kind: 'book', label: n.label, sub: n.domain ?? 'book',
                              href: `#course|${encodeURIComponent(n.id.replace(/^book:/, ''))}`,
                              rank: r + 1 });
            continue;
          }
          if (n.kind !== 'concept') continue;
          const r = rank(n.label);
          const bookTitle = bookTitles().get(n.book_id);
          // The graph draws only concepts with problems here; anything else
          // opens its book's table of contents, or is not offered at all.
          const href = counts().concept.get(n.id) ? `#explore|${encodeURIComponent(n.id)}`
            : listedBook(n.book_id) ? `#course|${encodeURIComponent(n.book_id)}` : null;
          if (r && href) out.push({ kind: 'concept', label: n.label,
                            sub: `${n.domain ?? ''}${bookTitle ? ` · ${bookTitle}` : ''}`,
                            href, rank: r });
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
            sub: `${n} problem${n === 1 ? '' : 's'} · practice this`,
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
          for (const e of graph.exercises) {
            if (practisable(e)) m.set(e[key], (m.get(e[key]) ?? 0) + 1);
          }
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
        const said_ = String(body.text ?? '').trim();
        if (!said_) return json({ error: 'text required' }, 400);
        const timed = parseTimedRequest(said_);
        // A clock with no topic ("2 minute blitz") gets mixed mental math: fast,
        // auto-graded, and exactly what a timed round is for.
        const text = timed ? (timed.rest || 'mental math') : said_;
        const lower = text.toLowerCase();
        // Every answer below goes out through here, so a timed request keeps its
        // clock whichever branch recognised the topic.
        const reply = (out, status = 200) => {
          if (!timed || !out?.spec) return json(out, status);
          const q = new URLSearchParams(out.spec);
          q.set('time', String(timed.seconds));
          if (timed.count) q.set('count', String(timed.count)); else q.delete('count');
          const topic = timed.rest ? (q.get('label') || timed.rest) : 'Mental math';
          q.set('label', `${timedLabel(timed.seconds)} challenge · ${topic[0].toUpperCase()}${topic.slice(1)}`);
          return json({ ...out, spec: q.toString(), timed: { seconds: timed.seconds, count: timed.count } }, status);
        };

        // Requests about *you* rather than a topic. Deterministic, so they work
        // with no model key: the evidence to answer them is already in the log.
        const set = (params, message = null) => reply({
          understood: true, spec: new URLSearchParams(params).toString(), message,
        });
        if (/\bweak(est)?\b|worst at|struggl|mistakes?\b/.test(lower)) {
          const avail = counts().concept;
          const weakest = [...conceptMastery(db).values()]
            .filter((m) => avail.get(m.concept_id) && m.mastery < 0.8)
            .sort((a, b) => a.mastery - b.mastery).slice(0, 3);
          if (weakest.length) {
            return set({ kind: 'study', concepts: weakest.map((m) => m.concept_id).join(','),
              count: '8', label: `Weakest: ${weakest.map((m) => conceptLabel(m.concept_id)).join(', ')}` });
          }
          return set({ kind: 'study', count: '5', difficulty: 'easier', label: 'Starter set' },
            'No weak spots yet: answer a few problems first. Here is an easy set to start.');
        }
        if (/\b(due|review|revise)\b/.test(lower)) {
          return set({ kind: 'review', count: '12', label: 'Reviews due' });
        }
        if (/surprise|something new|anything|random|haven.t seen/.test(lower)) {
          return set({ kind: 'study', count: '5', difficulty: 'target', label: 'Something new' });
        }
        if (/challenge me|harder|hard ones|stretch|push me/.test(lower)) {
          return set({ kind: 'study', count: '5', difficulty: 'harder', label: 'Challenge set' });
        }
        // The practice box is already an action surface. If the learner names
        // a known generated skill, route directly even when Jev is unavailable;
        // this also prevents simple arithmetic requests from paying for a model
        // call just to identify "division" or "parentheses".
        // Whole words only: "einsum" contains "sum", which is Addition's alias.
        const said = (a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(lower);
        const hits = GENERATED_SKILLS.map((s) => ({ s, as: s.aliases.filter(said) }))
          .filter((h) => h.as.length);
        // The longest name wins: "log-sum-exp" is not also a request for "sum".
        const directSkills = hits.filter((h) => !h.as.every((a) => hits.some((o) => o !== h
          && o.as.some((b) => b.length > a.length && b.includes(a))))).map((h) => h.s);
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
              s.domain === 'machine learning') : []);
        if (!jevEnabled() && fallbackSkills.length) {
          const fallback = new URLSearchParams({ kind: 'drill',
            skills: fallbackSkills.map((s) => s.id).join(','),
            count: '5', label: text });
          return reply({ understood: true,
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
        return reply({
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
        const ability = abilityReport(db, graph, counts().domain);
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
