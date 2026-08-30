// Lattice server: serves the static site and a small JSON API over the concept
// graph plus persistent practice memory.
//
//   npm start            PORT=4115 by default (Switchboard passes PORT)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, recordAttempt, setStar, recordView, recentViews,
  dueItems, allStates, attemptsFor, stats,
} from './lib/db.mjs';
import { conceptMastery, weakEdges, recommend } from './lib/mastery.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SITE = join(ROOT, 'site');
const PORT = Number(process.env.PORT ?? 4115);
const DB_PATH = process.env.LATTICE_DB ?? join(ROOT, 'data', 'lattice.db');

const db = openDb(DB_PATH);

// The graph is pipeline output: load once, reload only if the file changes.
let graph = null, ladders = null, graphMtime = 0;
const GRAPH_PATH = join(ROOT, 'data', 'processed', 'graph', 'probability.json');
const LINKED_PATH = join(ROOT, 'data', 'processed', 'graph', 'probability.linked.json');

async function loadGraph() {
  try {
    const m = (await stat(GRAPH_PATH)).mtimeMs;
    if (graph && m === graphMtime) return;
    graph = JSON.parse(await readFile(GRAPH_PATH, 'utf8'));
    graphMtime = m;
    try {
      ladders = JSON.parse(await readFile(LINKED_PATH, 'utf8'));
    } catch { ladders = { ladders: [], links: [], review_queue: [] }; }
    console.log(`graph loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
                `${graph.exercises.length} exercises, ${ladders.ladders.length} ladders`);
  } catch (err) {
    // The site must still serve if the pipeline has not been run yet.
    console.warn(`graph unavailable (${err.code ?? err.message}); API will report empty`);
    graph ??= { nodes: [], edges: [], exercises: [] };
    ladders ??= { ladders: [], links: [], review_queue: [] };
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

const OUTCOMES = new Set(['solved', 'partial', 'failed', 'skipped']);
// 'drill' is a generated problem: it has no bank id, so its concept_id is the
// skill it exercises. That keeps generated practice in the same mastery model.
const ITEM_TYPES = new Set(['putnam', 'exercise', 'drill']);

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '');
  await loadGraph();

  if (req.method === 'GET') {
    switch (true) {
      case p === '/health':
        return json(res, { ok: true, db: DB_PATH, nodes: graph.nodes.length });

      case p === '/graph': {
        // Edge lists get large; `assessed_by` is only needed per-concept.
        const kinds = url.searchParams.get('kinds')?.split(',');
        const nodes = kinds ? graph.nodes.filter((n) => kinds.includes(n.kind)) : graph.nodes;
        const edges = graph.edges.filter((e) => e.type !== 'assessed_by');
        return json(res, { nodes, edges });
      }

      case p === '/stats':
        return json(res, stats(db));

      case p === '/mastery': {
        const m = conceptMastery(db);
        const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
        return json(res, [...m.values()]
          .map((x) => ({ ...x, label: labels.get(x.concept_id) ?? x.concept_id }))
          .sort((a, b) => a.mastery - b.mastery));
      }

      case p === '/weak-edges':
        return json(res, weakEdges(db, graph).slice(0, 25));

      case p === '/recommend':
        return json(res, recommend(db, graph, graph.exercises,
          { limit: Number(url.searchParams.get('limit') ?? 8) }));

      case p === '/due':
        return json(res, dueItems(db, Number(url.searchParams.get('n') ?? 20)));

      case p === '/state':
        return json(res, { states: allStates(db), recent: recentViews(db, 12) });

      case p.startsWith('/ladder/'): {
        const id = decodeURIComponent(p.slice('/ladder/'.length));
        const l = ladders.ladders.find((x) => x.target_problem_id === id);
        return l ? json(res, l) : json(res, { error: 'no ladder for problem' }, 404);
      }

      case p.startsWith('/attempts/'):
        return json(res, attemptsFor(db, decodeURIComponent(p.slice('/attempts/'.length))));

      case p === '/exercises': {
        const concept = url.searchParams.get('concept');
        const list = graph.exercises.filter((e) => !concept || e.concept_id === concept);
        return json(res, list.slice(0, Number(url.searchParams.get('limit') ?? 50)));
      }
    }
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    switch (p) {
      case '/attempt': {
        if (!body.item_id || !OUTCOMES.has(body.outcome) || !ITEM_TYPES.has(body.item_type)) {
          return json(res, { error: 'item_id, item_type and a valid outcome are required' }, 400);
        }
        return json(res, recordAttempt(db, body));
      }
      case '/star':
        if (!body.item_id) return json(res, { error: 'item_id required' }, 400);
        setStar(db, body.item_id, body.item_type ?? 'putnam', !!body.starred);
        return json(res, { ok: true });
      case '/view':
        if (!body.item_id) return json(res, { error: 'item_id required' }, 400);
        recordView(db, body.item_id);
        return json(res, { ok: true });
    }
  }

  return json(res, { error: 'not found' }, 404);
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
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} failed:`, err.message);
    if (!res.headersSent) json(res, { error: err.message }, 500);
    else res.end();
  }
});

await loadGraph();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lattice on http://127.0.0.1:${PORT}  (db: ${DB_PATH})`);
});
