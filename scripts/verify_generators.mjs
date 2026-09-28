// Check every generator the site serves, across levels and seeds.
//
//   node scripts/verify_generators.mjs            structure, all skills
//   node scripts/verify_generators.mjs --refs     also recompute ML answers in
//                                                 Python (torch/numpy) and compare
//   node scripts/verify_generators.mjs --refs --only=gs-,an-
//                                                 references for these skill prefixes only
//
// Structure: the answer is accepted by `check`; no distractor is; a choice set
// has exactly one correct option and no two options that `check` treats as the
// same; nothing renders "NaN" or "undefined"; a (skill, level, seed) always
// produces the same problem. Refs: scripts/generator_refs.py recomputes the
// answer from `params` by a different route and `check` must accept it.
import { spawn } from 'node:child_process';
import { loadGenerators } from './load_generators.mjs';

const SEEDS = 200;
const REF_SEEDS = 12;
const M = loadGenerators();
const failures = new Map();
const fail = (skill, msg) => {
  if (!failures.has(skill)) failures.set(skill, []);
  const list = failures.get(skill);
  if (list.length < 4) list.push(msg);
};

const bad = /NaN|undefined|Infinity|\[object/;
const refJobs = [];

for (const { id } of M.SKILLS) {
  for (let level = 1; level <= 5; level++) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const where = `L${level} seed ${seed}`;
      let p;
      try { p = M.generate(id, level, seed); } catch (err) { fail(id, `${where}: threw ${err.message}`); continue; }
      const again = M.generate(id, level, seed);
      if (JSON.stringify(p) !== JSON.stringify(again)) fail(id, `${where}: not deterministic`);
      if (!p.prompt || p.answer === undefined || p.answer === '') fail(id, `${where}: empty prompt or answer`);
      if (bad.test(p.prompt) || bad.test(String(p.answer))) fail(id, `${where}: ${bad.exec(p.prompt + p.answer)[0]} in output`);
      if (p.format !== 'choice' && !M.check(p, p.answer)) fail(id, `${where}: answer ${p.answer} not accepted`);
      for (const m of p.mistakes ?? []) {
        if (bad.test(String(m.answer))) fail(id, `${where}: distractor renders ${m.answer}`);
        if (p.format !== 'choice' && M.check(p, m.answer)) {
          fail(id, `${where}: distractor ${m.answer} accepted as correct (answer ${p.answer})`);
        }
        if (!m.why) fail(id, `${where}: distractor ${m.answer} has no explanation`);
      }
      if (p.choices) {
        const right = p.choices.filter((c) => c.correct);
        if (right.length !== 1) fail(id, `${where}: ${right.length} correct choices`);
        // Yes/no questions have two options by nature; everything else needs three.
        const binary = p.format === 'choice' && (p.mistakes?.length ?? 0) === 1;
        if (p.choices.length < (binary ? 2 : 3)) fail(id, `${where}: only ${p.choices.length} choices`);
        const texts = p.choices.map((c) => c.text);
        if (new Set(texts).size !== texts.length) fail(id, `${where}: duplicate choices`);
      }
      if (p.format === 'choice' && !p.choices) fail(id, `${where}: choice item without choices`);
      if (p.kind === 'order') {
        const ids = p.steps.map((st) => st.id);
        for (const x of p.extras) {
          if (M.check(p, [...ids.slice(0, 2), x.id, ...ids.slice(2)].join(','))) fail(id, `${where}: planted line ${x.id} accepted`);
          if (!M.diagnose(p, [x.id, ...ids].join(','))?.why) fail(id, `${where}: planted line ${x.id} not explained`);
        }
        if (M.check(p, ids.slice(1).join(','))) fail(id, `${where}: proof missing a step accepted`);
        if (M.check(p, [...ids].reverse().join(','))) fail(id, `${where}: reversed proof accepted`);
        if (!p.lines || p.lines.length !== ids.length + p.extras.length) fail(id, `${where}: lines don't match steps + extras`);
      }
      if (p.kind === 'pair') {
        const { a, b } = p.pair;
        const [x, y] = p.answer.split(',').map(Number);
        const g = [a, b].reduce((u, v) => { while (v) [u, v] = [v, u % v]; return u; });
        if (!M.check(p, `${x + b / g}, ${y - a / g}`)) fail(id, `${where}: another valid solution rejected`);
        if (M.check(p, `${x + 1}, ${y}`)) fail(id, `${where}: wrong pair accepted`);
      }
      if (p.kind === 'einsum') {
        // Checked by meaning: the same spec with every letter renamed must pass.
        const rename = p.answer.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 7) % 26) + 97));
        if (!M.check(p, rename)) fail(id, `${where}: renamed answer ${rename} rejected`);
        if (!M.check(p, `torch.einsum("${p.answer}", A, B)`)) fail(id, `${where}: full call rejected`);
      }
      if (p.params && seed < REF_SEEDS) refJobs.push({ skill: id, level, seed, params: p.params, problem: p });
    }
  }
}

/** Does a reference float agree with the generator's answer string? Exact
 *  answers (integers, fractions) to 1e-6; rounded decimals to their last place;
 *  anything with a stated tolerance, to that tolerance. */
function agrees(p, ref) {
  // An estimate is judged the way the learner is: within its factor of the truth.
  if (p.factor) return ref > 0 && M.check(p, String(ref));
  const s = String(p.answer);
  const f = /^(-?\d+)\/(\d+)$/.exec(s);
  const want = f ? Number(f[1]) / Number(f[2]) : Number(s);
  if (!Number.isFinite(want)) return false;
  const places = (s.split('.')[1] ?? '').length;
  const slack = Math.max(
    Math.abs(ref) * Math.max(p.tolerance ?? 0, 1e-6),
    places ? 0.5 * 10 ** -places + 1e-12 : 0,
    1e-9,
  );
  return Math.abs(want - ref) <= slack;
}

async function runRefs() {
  const py = spawn('python3', [new URL('./generator_refs.py', import.meta.url).pathname]);
  const known = new Set(JSON.parse(await new Promise((res) => {
    const l = spawn('python3', [new URL('./generator_refs.py', import.meta.url).pathname, '--list']);
    let out = ''; l.stdout.on('data', (d) => { out += d; }); l.on('close', () => res(out));
  })));
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const jobs = refJobs.filter((j) => known.has(j.skill) && (!only || only.some((o) => j.skill.startsWith(o))));
  const missing = [...new Set(refJobs.map((j) => j.skill))].filter((s) => !known.has(s));
  let buf = '';
  const answers = [];
  py.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { answers.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  py.stderr.on('data', (d) => process.stderr.write(d));
  for (const j of jobs) py.stdin.write(`${JSON.stringify({ skill: j.skill, params: j.params })}\n`);
  py.stdin.end();
  await new Promise((res) => py.on('close', res));
  let agree = 0, skipped = 0;
  jobs.forEach((j, k) => {
    const a = answers[k];
    if (a?.skip) { skipped += 1; return; }
    const where = `L${j.level} seed ${j.seed} (ref)`;
    if (!a || a.error) return fail(j.skill, `${where}: reference failed: ${a?.error}`);
    // Monte-Carlo references are checked at 2%; exact ones at the generator's own tolerance.
    const mc = ['ml-noisy-gram', 'ml-bootstrap', 'pr-indicators'].includes(j.skill) && !(j.skill === 'ml-bootstrap' && j.params.n <= 6);
    const probe = mc ? { ...j.problem, tolerance: 0.02 } : j.problem;
    const ok = typeof a.value === 'string'
      ? a.value === j.problem.answer
      : agrees(probe, a.value);
    if (ok) agree += 1;
    else fail(j.skill, `${where}: generator says ${j.problem.answer}, reference computes ${a.value}`);
  });
  return { checked: jobs.length - skipped, agree, missing };
}

// Putnam step problems: every correct step must be a verbatim excerpt of the
// published solution, and no wrong option may appear anywhere in it.
{
  const { readFileSync } = await import('node:fs');
  const labeled = JSON.parse(readFileSync(new URL('../data/processed/problems.labeled.json', import.meta.url), 'utf8'));
  const sol = new Map(labeled.problems.map((q) => [q.id, q.solution_tex ?? '']));
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const review = [];
  for (const q of M.putnamSteps ?? []) {
    const S = norm(sol.get(q.id) ?? '');
    if (!S) { fail('pt-steps', `${q.id}: no published solution`); continue; }
    const ids = new Set(q.steps.map((st) => st.id));
    for (const st of q.steps) {
      if (!S.includes(norm(st.ex))) fail('pt-steps', `${q.id} ${st.id}: not a verbatim excerpt of the solution`);
      for (const d of st.after ?? []) if (!ids.has(d)) fail('pt-steps', `${q.id} ${st.id}: depends on unknown step ${d}`);
    }
    if (!ids.has(q.crucial)) fail('pt-steps', `${q.id}: crucial step ${q.crucial} missing`);
    for (const w of q.wrong) if (S.includes(norm(w.text))) fail('pt-steps', `${q.id}: a wrong option appears in the solution`);
    const m = M.putnamMutate(q.steps.find((st) => st.id === q.crucial)?.ex ?? '');
    if (m) {
      if (S.includes(norm(m.text))) fail('pt-steps', `${q.id}: the mutated step appears in the solution`);
      review.push(`  ${q.id}: ${m.text}`);
    }
  }
  if (process.argv.includes('--review')) console.log(`mutations to review (${review.length}):\n${review.join('\n')}`);
}

// Concepts: every generator names at least one topic in the graph. That is what
// puts it on a course page, lets the audit count the topic as practised, and
// gives it the graph's prerequisite edges. A typo'd id would do none of that silently.
{
  const { readFileSync } = await import('node:fs');
  const graph = JSON.parse(readFileSync(new URL('../data/processed/graph/math.json', import.meta.url), 'utf8'));
  const known = new Set(graph.nodes.filter((n) => n.kind === 'concept').map((n) => n.id));
  for (const { id, concepts } of M.SKILLS) {
    if (!concepts?.length) fail(id, 'no concepts: tag the graph topic it practises');
    for (const c of concepts ?? []) if (!known.has(c)) fail(id, `unknown concept ${c}`);
  }
  // pt-steps draws from a bank that grows; its tags must cover every problem's topic.
  const topicOf = new Map(graph.exercises.map((e) => [e.id, e.concept_id]));
  const tagged = new Set(M.SKILLS.find((s) => s.id === 'pt-steps')?.concepts ?? []);
  for (const q of M.putnamSteps ?? []) {
    const c = topicOf.get(q.id);
    if (c && !tagged.has(c)) fail('pt-steps', `${q.id}: its topic ${c} is not in pt-steps' concepts`);
  }
}

const refs = process.argv.includes('--refs') ? await runRefs() : null;
const skills = M.SKILLS.length;
console.log(`${skills} skills × 5 levels × ${SEEDS} seeds = ${skills * 5 * SEEDS} problems checked`);
if (refs) {
  console.log(`references: ${refs.agree}/${refs.checked} answers recomputed independently and matched`);
  const ml = refs.missing.filter((s) => s.startsWith('ml-'));
  if (ml.length) console.log(`  no reference yet for: ${ml.join(', ')}`);
}
if (failures.size) {
  console.log(`\n${failures.size} skill(s) failed:`);
  for (const [s, list] of failures) console.log(`  ${s}\n    ${list.join('\n    ')}`);
  process.exit(1);
}
console.log('all generators pass');
