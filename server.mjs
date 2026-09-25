// Lattice server: serves the static site and a small JSON API over the concept
// graph plus persistent practice memory.
//
//   npm start            PORT=4115 by default (Switchboard passes PORT)
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db-node.mjs';
import { api, setData, setHooks } from './lib/api.mjs';
import { writeSession } from './lib/cadence.mjs';
import { appendActivity } from './lib/activity.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SITE = join(ROOT, 'site');
const PORT = Number(process.env.PORT ?? 4115);
const DB_PATH = process.env.LATTICE_DB ?? join(ROOT, 'data', 'lattice.db');

const db = openDb(DB_PATH);
setHooks({
  dbLabel: DB_PATH,
  cadenceLabel: process.env.CADENCE_DIR ?? '~/projects/cadence',
  appendActivity,
  writeSession,
});

// The graph is pipeline output: load once, reload only if the file changes.
let graph = null, ladders = null, graphMtime = 0;
// The unified multi-book graph, falling back to the probability-only one if the
// math pipeline has not been run yet.
const GRAPH_PATH = join(ROOT, 'data', 'processed', 'graph', 'math.json');
const GRAPH_FALLBACK = join(ROOT, 'data', 'processed', 'graph', 'probability.json');
const LINKED_PATH = join(ROOT, 'data', 'processed', 'graph', 'probability.linked.json');

// Verbatim exercise text for copyrighted books lives in data/local/ and is never
// committed. Serving it is fine — this is the machine that owns the books — but it
// stays out of the graph file so the repo carries pointers only. Exercises
// re-read from the page image by scripts/repair_text.py are tracked separately:
// their stored `garble` score describes text that has since been replaced.
//
// Putnam problems carry progressive hints and a solution; they live in the
// labeled dataset rather than the graph, which keeps the graph lean.

async function loadPutnamExtras() {
  try {
    const raw = JSON.parse(await readFile(
      join(ROOT, 'data', 'processed', 'problems.labeled.json'), 'utf8'));
    const putnamExtras = new Map(raw.problems.map((p) => [p.id, {
      hints: p.hints ?? [p.hint_1, p.hint_2, p.hint_3].filter(Boolean),
      solution: p.solution_text ?? p.solution_tex ?? null,
      techniques: p.techniques ?? [],
      topic: p.topic, difficulty: p.difficulty, year: p.year, code: p.code,
    }]));
    setData({ putnamExtras });
    console.log(`putnam extras: hints and solutions for ${putnamExtras.size} problems`);
  } catch {
    // Optional: the bank may not have been labeled yet.
  }
}

// Semantic labels for the corpus, written by scripts/tag_exercises_jev.py. They
// live under data/local/ with the verbatim text they were derived from, so a
// machine without the books has no tags either — and the natural-language box
// degrades to domain and difficulty rather than breaking.

async function loadTags() {
  try {
    const raw = JSON.parse(await readFile(join(ROOT, 'data', 'local', 'tags.json'), 'utf8'));
    const exerciseTags = raw.exercises ?? {};
    const tagVocabulary = [...new Set(Object.values(raw.vocab ?? {}).flat())].sort();
    setData({ exerciseTags, tagVocabulary });
    console.log(`tags: ${Object.keys(exerciseTags).length} exercises, `
      + `${tagVocabulary.length} distinct tags`);
  } catch {
    // Optional: the tagging pass may not have been run on this machine.
  }
}

async function loadLocalText() {
  const dir = join(ROOT, 'data', 'local');
  try {
    const files = await readdir(dir);
    const next = new Map();
    for (const f of files.filter((x) => x.endsWith('.text.json'))) {
      const obj = JSON.parse(await readFile(join(dir, f), 'utf8'));
      for (const [id, text] of Object.entries(obj)) next.set(id, text);
    }
    const localText = next;
    const repaired = new Set();
    for (const f of files.filter((x) => x.endsWith('.repaired.json'))) {
      for (const id of Object.keys(JSON.parse(await readFile(join(dir, f), 'utf8')))) {
        repaired.add(id);
      }
    }
    setData({ localText, repairedIds: repaired });
    if (localText.size) console.log(`local text: ${localText.size} exercises readable`
      + (repaired.size ? `, ${repaired.size} re-read from the page` : ''));
  } catch {
    // No local text is a normal state: the graph still serves pointers.
  }
}

// The book profiles written by the extraction scripts. They carry the one thing
// the graph does not: where the PDF actually sits on this machine, and how its
// printed page numbers map onto physical PDF pages.
let bookFiles = new Map();   // book_id -> { path, pageOffset }

async function loadBookProfiles() {
  const dir = join(ROOT, 'data', 'processed', 'books');
  const next = new Map();
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      const b = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (!b.source_pdf || b.source_pdf_missing) continue;
      // Confirm at boot rather than trusting the profile: a book that has been
      // moved should fall back to its web link, not offer a dead button.
      const path = b.source_pdf.replace(/^~(?=\/)/, homedir());
      if (!(await stat(path).catch(() => null))?.isFile()) continue;
      next.set(b.book_id, { path, pageOffset: b.pdf_page_offset ?? 0 });
    }
  } catch { /* no profiles yet: the app runs without local copies */ }
  bookFiles = next;
  setData({ bookFiles });
  if (next.size) console.log(`local PDFs: ${[...next.keys()].join(', ')}`);
}

async function loadGraph() {
  try {
    const path = await stat(GRAPH_PATH).then(() => GRAPH_PATH).catch(() => GRAPH_FALLBACK);
    const m = (await stat(path)).mtimeMs;
    if (graph && m === graphMtime) return;
    graph = JSON.parse(await readFile(path, 'utf8'));
    graphMtime = m;
    try {
      ladders = JSON.parse(await readFile(LINKED_PATH, 'utf8'));
    } catch { ladders = { ladders: [], links: [], review_queue: [] }; }
    setData({ graph, ladders });
    console.log(`graph loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
                `${graph.exercises.length} exercises, ${ladders.ladders.length} ladders`);
  } catch (err) {
    // The site must still serve if the pipeline has not been run yet.
    console.warn(`graph unavailable (${err.code ?? err.message}); API will report empty`);
    graph ??= { nodes: [], edges: [], exercises: [] };
    ladders ??= { ladders: [], links: [], review_queue: [] };
    setData({ graph, ladders });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

const json = (res, body, code = 200) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
                        'content-length': Buffer.byteLength(s) });
  res.end(s);
};

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/** Serve a book's own PDF, ranged so a viewer can jump to #page=N without
 *  pulling the whole file. Only the paths the pipeline registered are servable —
 *  the id is looked up in the map, never joined into a path. */
async function serveBook(req, res, url) {
  const id = decodeURIComponent(url.pathname.slice('/book/'.length)).replace(/\.pdf$/, '');
  const book = bookFiles.get(id);
  if (!book) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('no local copy of that book');
    return;
  }
  const { size } = await stat(book.path);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const head = {
    'content-type': 'application/pdf',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  };
  if (!range) {
    res.writeHead(200, { ...head, 'content-length': size });
    return createReadStream(book.path).pipe(res);
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    return;
  }
  res.writeHead(206, {
    ...head,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': end - start + 1,
  });
  createReadStream(book.path, { start, end }).pipe(res);
}

async function serveStatic(req, res, url) {
  // normalize() then a prefix check: never let ../ escape the site directory.
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(SITE, rel));
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await loadGraph();
      const body = req.method === 'POST' ? await readBody(req) : {};
      const r = await api(db, { method: req.method, url, body });
      return json(res, r.body, r.status);
    }
    if (url.pathname.startsWith('/book/')) return await serveBook(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} failed:`, err.message);
    if (!res.headersSent) json(res, { error: err.message }, 500);
    else res.end();
  }
});

await loadGraph();
await loadBookProfiles();
await loadLocalText();
await loadPutnamExtras();
await loadTags();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lattice on http://127.0.0.1:${PORT}  (db: ${DB_PATH})`);
});
