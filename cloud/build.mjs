// Build both halves of the cloud deploy from the repo:
//   pages/dist/  the static site, served by the lattice-app Pages project
//   api/assets/  the corpus the lattice-api Worker loads into lib/api.mjs
//
// Only committed pipeline output goes in. data/local/ (verbatim textbook text
// and the tags derived from it) stays on this machine, so the cloud serves the
// openly licensed problems and pointers to everything else.
//
//   node cloud/build.mjs
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'cloud', 'pages', 'dist');
const ASSETS = join(ROOT, 'cloud', 'api', 'assets');
const readJson = async (...p) => JSON.parse(await readFile(join(ROOT, ...p), 'utf8'));

await rm(DIST, { recursive: true, force: true });
await cp(join(ROOT, 'site'), DIST, { recursive: true });

await rm(ASSETS, { recursive: true, force: true });
await mkdir(ASSETS, { recursive: true });

const graph = await readJson('data', 'processed', 'graph', 'math.json');
await writeFile(join(ASSETS, 'graph.json'), JSON.stringify(graph));

const ladders = await readJson('data', 'processed', 'graph', 'probability.linked.json')
  .catch(() => ({ ladders: [], links: [], review_queue: [] }));
await writeFile(join(ASSETS, 'ladders.json'), JSON.stringify(ladders));

// Same shape server.mjs builds in loadPutnamExtras, keyed by problem id.
const labeled = await readJson('data', 'processed', 'problems.labeled.json');
const extras = Object.fromEntries(labeled.problems.map((p) => [p.id, {
  hints: p.hints ?? [p.hint_1, p.hint_2, p.hint_3].filter(Boolean),
  solution: p.solution_text ?? p.solution_tex ?? null,
  techniques: p.techniques ?? [],
  topic: p.topic, difficulty: p.difficulty, year: p.year, code: p.code,
}]));
await writeFile(join(ASSETS, 'extras.json'), JSON.stringify(extras));

console.log(`site → ${DIST}`);
console.log(`corpus → ${ASSETS}: ${graph.nodes.length} nodes, ${graph.exercises.length} exercises, `
  + `${Object.keys(extras).length} Putnam extras`);
