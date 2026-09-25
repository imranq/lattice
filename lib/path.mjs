// The guided path: one road from mental arithmetic to contest problems.
//
// The graph can say what is *ready*, but a beginner with no history gets no
// signal from it: everything is equally untested. So this is an ordered
// curriculum over the parts of the corpus anyone can open (generated drills,
// the MATH dataset's five levels per subject, then Grinstead–Snell and Putnam),
// and the attempt log decides where on it you stand.
//
// Where you stand is the earliest weakness, or failing that the first step past
// the furthest one you have passed. Passing a later step places you past the
// untested ones before it, so someone who already knows arithmetic is not
// marched through times tables; a step you have actually struggled with is
// always offered before anything new.

const math = (subject, levels) => levels.map((l) => `concept:math_dataset:${subject}:L${l}`);

const STEPS = [
  // Mental math. Short generated drills, graded exactly.
  { id: 'add-sub', stage: 'Mental math', title: 'Adding and subtracting',
    skills: ['add-chain', 'subtract'] },
  { id: 'times', stage: 'Mental math', title: 'Times tables and division',
    skills: ['multiply', 'divide-friendly'] },
  { id: 'fractions', stage: 'Mental math', title: 'Fractions and percentages',
    skills: ['fractions', 'percent'] },
  { id: 'powers', stage: 'Mental math', title: 'Powers and order of operations',
    skills: ['powers', 'squares', 'order-of-operations'] },
  { id: 'big-mult', stage: 'Mental math', title: 'Bigger multiplication',
    skills: ['multiply-2x2', 'mult-tricks'] },
  { id: 'estimate', stage: 'Mental math', title: 'Estimation', skills: ['estimate'] },

  // Foundations: the MATH dataset, easier levels first, with drills between
  // them where a skill is about to be leaned on.
  { id: 'prealgebra-1', stage: 'Foundations', title: 'Prealgebra',
    concepts: math('prealgebra', [1, 2]) },
  { id: 'linear', stage: 'Foundations', title: 'Linear equations', skills: ['linear'] },
  { id: 'algebra-1', stage: 'Foundations', title: 'Algebra', concepts: math('algebra', [1, 2]) },
  { id: 'prealgebra-2', stage: 'Foundations', title: 'Prealgebra, harder',
    concepts: math('prealgebra', [3, 4, 5]) },
  { id: 'divisibility', stage: 'Foundations', title: 'Divisibility and GCD',
    skills: ['divisibility', 'gcd-lcm', 'bases'] },
  { id: 'nt-1', stage: 'Foundations', title: 'Number theory',
    concepts: math('number_theory', [1, 2]) },
  { id: 'counting', stage: 'Foundations', title: 'Counting', skills: ['counting'] },
  { id: 'cp-1', stage: 'Foundations', title: 'Counting and probability',
    concepts: math('counting_and_probability', [1, 2]) },
  { id: 'geometry-1', stage: 'Foundations', title: 'Geometry', concepts: math('geometry', [1, 2]) },

  // Competition level: the harder half of every MATH subject.
  { id: 'algebra-2', stage: 'Competition', title: 'Algebra, harder',
    concepts: math('algebra', [3, 4, 5]) },
  { id: 'logs', stage: 'Competition', title: 'Logs, exponents and series',
    skills: ['logs', 'series'] },
  { id: 'int-algebra-1', stage: 'Competition', title: 'Intermediate algebra',
    concepts: math('intermediate_algebra', [1, 2, 3]) },
  { id: 'precalc-1', stage: 'Competition', title: 'Precalculus',
    concepts: math('precalculus', [1, 2, 3]) },
  { id: 'nt-2', stage: 'Competition', title: 'Number theory, harder',
    concepts: math('number_theory', [3, 4, 5]) },
  { id: 'cp-2', stage: 'Competition', title: 'Counting and probability, harder',
    concepts: math('counting_and_probability', [3, 4, 5]) },
  { id: 'geometry-2', stage: 'Competition', title: 'Geometry, harder',
    concepts: math('geometry', [3, 4, 5]) },
  { id: 'int-algebra-2', stage: 'Competition', title: 'Intermediate algebra, harder',
    concepts: math('intermediate_algebra', [4, 5]) },
  { id: 'precalc-2', stage: 'Competition', title: 'Precalculus, harder',
    concepts: math('precalculus', [4, 5]) },

  // Beyond: a real textbook, then the Putnam.
  { id: 'probability', stage: 'Beyond', title: 'Probability, from the textbook',
    books: ['grinstead_snell'] },
  { id: 'putnam', stage: 'Beyond', title: 'Putnam problems', books: ['putnam'] },
];

// What "passed" means. Drills are quick and exact, so they need more of them and
// a higher rate; a problem step is a handful of real problems at ~75%.
const RULES = {
  drill: { need: 8, pass: 0.8, count: 10 },
  study: { need: 5, pass: 0.75, count: 6 },
};
const WEAK_AT = 0.6;     // below this, with some evidence, a step is a weakness
const WINDOW = 12;       // judge on your recent attempts in the step, not all time
const CREDIT = { solved: 1, partial: 0.5, failed: 0, skipped: 0 };

let bookConcepts = null;  // book id -> Set of concept ids, derived from the graph

function conceptsForBooks(graph, books) {
  if (bookConcepts?.graph !== graph) {
    const map = new Map();
    for (const e of graph.exercises) {
      if (!e.concept_id) continue;
      if (!map.has(e.book_id)) map.set(e.book_id, new Set());
      map.get(e.book_id).add(e.concept_id);
    }
    bookConcepts = { graph, map };
  }
  const out = new Set();
  for (const b of books) for (const c of bookConcepts.map.get(b) ?? []) out.add(c);
  return out;
}

function specFor(step, kind, rule) {
  const q = new URLSearchParams({ kind });
  if (step.skills) q.set('skills', step.skills.join(','));
  if (step.concepts) q.set('concepts', step.concepts.join(','));
  if (step.books) q.set('books', step.books.join(','));
  q.set('count', String(rule.count));
  q.set('label', step.title);
  q.set('path', step.id);
  return q.toString();
}

export function guidedPath(db, graph) {
  // Newest first, so the first WINDOW rows per step are the recent ones.
  const rows = db.prepare(
    `SELECT concept_id, outcome FROM attempt
     WHERE concept_id IS NOT NULL ORDER BY ts DESC`).all();

  const steps = STEPS.map((step, index) => {
    const kind = step.skills ? 'drill' : 'study';
    const rule = RULES[kind];
    const scope = step.skills ? new Set(step.skills.map((s) => `skill:${s}`))
      : step.books ? conceptsForBooks(graph, step.books)
      : new Set(step.concepts);
    const recent = [];
    let total = 0;
    for (const r of rows) {
      if (!scope.has(r.concept_id)) continue;
      total += 1;
      if (recent.length < WINDOW) recent.push(CREDIT[r.outcome] ?? 0);
    }
    const accuracy = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const status = total >= rule.need && accuracy >= rule.pass ? 'passed'
      : recent.length >= 3 && accuracy < WEAK_AT ? 'weak'
      : total ? 'started' : 'new';
    return {
      index, id: step.id, stage: step.stage, title: step.title, kind, status,
      attempts: total, accuracy: accuracy === null ? null : +accuracy.toFixed(2),
      need: rule.need, pass: rule.pass,
      spec: specFor(step, kind, rule),
    };
  });

  const furthest = steps.reduce((m, s) => (s.status === 'passed' ? s.index : m), -1);
  // The earliest weakness up to the frontier comes first; otherwise the first
  // step past the furthest pass that is not itself already passed.
  const weak = steps.find((s) => s.status === 'weak' && s.index <= furthest + 1);
  const next = steps.find((s) => s.index > furthest && s.status !== 'passed');
  const current = weak ?? next ?? steps.at(-1);

  const prev = steps[furthest];
  const reason = !rows.length || furthest < 0 && !weak && current.index === 0
    ? 'Starting at the beginning. Pass a step and the next one opens.'
    : weak
      ? `${Math.round((1 - weak.accuracy) * 100)}% missed lately. Worth fixing before moving on.`
      : prev
        ? `You've got ${prev.title.toLowerCase()}, so this is next.`
        : 'Next on the path.';

  return {
    current: current.index,
    total: steps.length,
    passed: steps.filter((s) => s.status === 'passed').length,
    reason,
    steps,
  };
}
