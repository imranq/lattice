// Build site/putnam-steps.json from data/processed/putnam_steps.authored.json.
//
// Authoring marks each step by where it starts and ends in the published
// solution ({ a: "first words", b: "last words" }); this script cuts that exact
// span out of solution_tex, so every step is verbatim by construction. Steps may
// also be given whole as { ex }. Problems whose statement is truncated in the
// dataset, or whose anchors don't match, are reported and left out.
//
//   node scripts/build_putnam_steps.mjs          build, report problems
//   node scripts/build_putnam_steps.mjs --check  build without writing
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(`${ROOT}/${p}`, 'utf8'));
const labeled = new Map(read('data/processed/problems.labeled.json').problems.map((p) => [p.id, p]));
const authored = read('data/processed/putnam_steps.authored.json');

const squash = (t) => t.replace(/\s+/g, ' ').trim();

/** Text-mode LaTeX that MathJax won't render outside math, made readable. */
function readable(t) {
  return t
    .replace(/(^|[^\\])%[^\n]*/g, '$1')                       // comments
    .replace(/\\(?:emph|textit|textbf|textsc|underline)\{([^{}]*)\}/g, '$1')
    .replace(/\\noindent\s*|\\smallskip\s*|\\medskip\s*|\\bigskip\s*/g, '')
    .replace(/``/g, '“').replace(/''/g, '”')
    .replace(/\\begin\{(?:enumerate|itemize)\}(?:\[[^\]]*\])?/g, '')
    .replace(/\\end\{(?:enumerate|itemize)\}/g, '')
    .replace(/\\item(?:\[([^\]]*)\])?\s*/g, (_, lab) => `\n\n${lab ? `${lab} ` : '• '}`)
    .replace(/~/g, ' ');
}

const truncated = (p) => /\\begin\{(?:enumerate|itemize)\}\s*$/.test(p.problem_tex.trim())
  || (p.problem_tex.match(/\\begin\{(?:enumerate|itemize)\}/g)?.length ?? 0)
     > (p.problem_tex.match(/\\end\{(?:enumerate|itemize)\}/g)?.length ?? 0);

const out = [];
const problems = [];
for (const q of authored) {
  const src = labeled.get(q.id);
  if (!src?.solution_tex) { problems.push(`${q.id}: no published solution`); continue; }
  if (!q.statement && truncated(src)) { problems.push(`${q.id}: statement truncated in the dataset`); continue; }
  const sol = squash(src.solution_tex);
  const steps = [];
  let ok = true;
  for (const [i, st] of q.steps.entries()) {
    let ex = st.ex ? squash(st.ex) : null;
    if (!ex) {
      const a = squash(st.a), b = squash(st.b);
      const start = sol.indexOf(a, 0);
      const end = start < 0 ? -1 : sol.indexOf(b, start);
      if (start < 0 || end < 0) { problems.push(`${q.id} step ${i + 1}: anchor not found (${start < 0 ? `"${a}"` : `"${b}"`})`); ok = false; break; }
      ex = sol.slice(start, end + b.length);
      if (ex.length > 900) { problems.push(`${q.id} step ${i + 1}: span too long (${ex.length} chars)`); ok = false; break; }
    }
    if (!sol.includes(ex)) { problems.push(`${q.id} step ${i + 1}: not a verbatim excerpt`); ok = false; break; }
    steps.push({ id: `s${i + 1}`, ex, show: squash(readable(ex)), ...(st.after ? { after: st.after } : {}) });
  }
  if (!ok) continue;
  for (const w of q.wrong) {
    if (sol.includes(squash(w.text))) { problems.push(`${q.id}: a wrong option appears in the solution`); ok = false; }
  }
  if (!ok) continue;
  out.push({
    id: q.id, crucial: q.crucial,
    statement: q.statement ?? squash(readable(src.problem_tex)),
    steps, wrong: q.wrong,
  });
}

console.log(`${out.length} of ${authored.length} authored problems built`);
if (problems.length) console.log(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
if (!process.argv.includes('--check')) {
  writeFileSync(`${ROOT}/site/putnam-steps.json`, JSON.stringify(out));
  console.log('→ site/putnam-steps.json');
}
