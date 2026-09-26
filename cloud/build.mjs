// Build both halves of the cloud deploy from the repo:
//   pages/dist/  the static site, served by the lattice-app Pages project
//   api/assets/  the corpus the lattice-api Worker loads into lib/api.mjs
//
// Only committed pipeline output goes in. data/local/ (verbatim textbook text
// and the tags derived from it) stays on this machine, so the cloud serves the
// openly licensed problems and pointers to everything else.
//
//   node cloud/build.mjs
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

// Chapter titles from the book profiles: the graph has none for some books.
// MATH's worked solutions, sharded by subject so the Worker loads one shard
// when a solution is asked for rather than all of them at startup.
const chapterTitles = {};
let solutions = 0;
await mkdir(join(ASSETS, 'solutions'), { recursive: true });
for (const name of await readdir(join(ROOT, 'data', 'processed', 'books'))) {
  if (!name.endsWith('.json')) continue;
  const b = await readJson('data', 'processed', 'books', name);
  if (b.chapters?.length) {
    chapterTitles[b.book_id] = Object.fromEntries(b.chapters.map((c) => [c.chapter, c.title]));
  }
  if (b.book_id !== 'math_dataset') continue;
  const shards = {};
  for (const e of b.exercises) {
    if (!e.solution) continue;
    const subject = e.id.split(':')[1];
    (shards[subject] ??= {})[e.id] = e.solution;
    solutions += 1;
  }
  for (const [subject, rows] of Object.entries(shards)) {
    await writeFile(join(ASSETS, 'solutions', `${subject}.json`), JSON.stringify(rows));
  }
}
await writeFile(join(ASSETS, 'chapter-titles.json'), JSON.stringify(chapterTitles));

console.log(`site → ${DIST}`);
console.log(`corpus → ${ASSETS}: ${graph.nodes.length} nodes, ${graph.exercises.length} exercises, `
  + `${Object.keys(extras).length} Putnam extras, ${solutions} MATH solutions`);
