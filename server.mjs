// Lattice server: serves the static site and a small JSON API over the concept
// graph plus persistent practice memory.
//
//   npm start            PORT=4115 by default (Switchboard passes PORT)
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, recordAttempt, setStar, recordView, recentViews,
  dueItems, allStates, attemptsFor, stats, activity, streak,
} from './lib/db.mjs';
import { conceptMastery, weakEdges, recommend } from './lib/mastery.mjs';
import { abilityReport, suggest, TARGET_P } from './lib/ability.mjs';
import { buildPlan, writeSession } from './lib/cadence.mjs';
import { appendActivity } from './lib/activity.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SITE = join(ROOT, 'site');
const PORT = Number(process.env.PORT ?? 4115);
const DB_PATH = process.env.LATTICE_DB ?? join(ROOT, 'data', 'lattice.db');

const db = openDb(DB_PATH);

// The graph is pipeline output: load once, reload only if the file changes.
let graph = null, ladders = null, graphMtime = 0;
// The unified multi-book graph, falling back to the probability-only one if the
// math pipeline has not been run yet.
const GRAPH_PATH = join(ROOT, 'data', 'processed', 'graph', 'math.json');
const GRAPH_FALLBACK = join(ROOT, 'data', 'processed', 'graph', 'probability.json');
const LINKED_PATH = join(ROOT, 'data', 'processed', 'graph', 'probability.linked.json');

// Verbatim exercise text for copyrighted books lives in data/local/ and is never
// committed. Serving it is fine — this is the machine that owns the books — but it
// stays out of the graph file so the repo carries pointers only.
let localText = new Map();

// Putnam problems carry progressive hints and a solution; they live in the
// labeled dataset rather than the graph, which keeps the graph lean.
let putnamExtras = new Map();

async function loadPutnamExtras() {
  try {
    const raw = JSON.parse(await readFile(
      join(ROOT, 'data', 'processed', 'problems.labeled.json'), 'utf8'));
    putnamExtras = new Map(raw.problems.map((p) => [p.id, {
      hints: p.hints ?? [p.hint_1, p.hint_2, p.hint_3].filter(Boolean),
      solution: p.solution_text ?? p.solution_tex ?? null,
      techniques: p.techniques ?? [],
      topic: p.topic, difficulty: p.difficulty, year: p.year, code: p.code,
    }]));
    console.log(`putnam extras: hints and solutions for ${putnamExtras.size} problems`);
  } catch {
    // Optional: the bank may not have been labeled yet.
  }
}

async function loadLocalText() {
  const dir = join(ROOT, 'data', 'local');
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.text.json'));
    const next = new Map();
    for (const f of files) {
      const obj = JSON.parse(await readFile(join(dir, f), 'utf8'));
      for (const [id, text] of Object.entries(obj)) next.set(id, text);
    }
    localText = next;
    if (localText.size) console.log(`local text: ${localText.size} exercises readable`);
  } catch {
    // No local text is a normal state: the graph still serves pointers.
  }
}

/** Attach text where we have it, and a citation always. */
function withText(e) {
  const text = e.text ?? localText.get(e.id) ?? null;
  return {
    ...e,
    text,
    cite: e.page ? `${e.book_id} p.${e.page}` : `${e.book_id} ${e.label ?? ''}`.trim(),
    text_available: Boolean(text),
  };
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
        return json(res, { ...stats(db), streak: streak(db) });

      case p === '/activity':
        return json(res, activity(db, Number(url.searchParams.get('days') ?? 120)));

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
        return json(res, [...byDomain.values()].map((d) => ({
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
        return json(res, books.map((b) => ({
          id: b.id.replace(/^book:/, ''), title: b.label, authors: b.authors,
          domain: b.domain, extraction: b.extraction,
          exercises: counts.get(b.id.replace(/^book:/, '')) ?? 0,
        })).sort((a, b) => b.exercises - a.exercises));
      }

      case p === '/mastery': {
        const m = conceptMastery(db);
        const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
        return json(res, [...m.values()]
          .map((x) => ({ ...x, label: labels.get(x.concept_id) ?? x.concept_id }))
          .sort((a, b) => a.mastery - b.mastery));
      }

      case p === '/ability':
        return json(res, { target_success: TARGET_P, domains: abilityReport(db, graph) });

      case p === '/next': {
        // The study queue: problems sitting at the edge of what you can do.
        const picks = suggest(db, graph, {
          domains: url.searchParams.get('domains')?.split(',').filter(Boolean) || null,
          sources: url.searchParams.get('sources')?.split(',').filter(Boolean) || null,
          limit: Number(url.searchParams.get('limit') ?? 10),
          hasText: (id) => localText.has(id),
        });
        const byId = new Map(graph.exercises.map((e) => [e.id, e]));
        return json(res, picks.map((s) => {
          const full = byId.get(s.id);
          return { ...s, ...withText(full), ...s };
        }));
      }

      case p === '/plan': {
        // The recommended schedule, shown on Home and exported to Cadence.
        const ability = abilityReport(db, graph);
        const rated = ability.filter((a) => a.pool > 0);
        const weakest = rated.find((a) => a.attempts > 0) ?? rated[0] ?? null;
        return json(res, buildPlan({
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
        return json(res, [...rows.values()].map((r) => ({
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
        if (!domain) return json(res, { error: 'domain required' }, 400);
        const m = conceptMastery(db);
        const counts = new Map();
        for (const e of graph.exercises) {
          counts.set(e.concept_id, (counts.get(e.concept_id) ?? 0) + 1);
        }
        const bookTitles = new Map(graph.nodes.filter((n) => n.kind === 'book')
          .map((n) => [n.id.replace(/^book:/, ''), n.label]));
        const chapters = new Map(graph.nodes.filter((n) => n.kind === 'domain_part')
          .map((n) => [`${n.book_id}:${n.chapter}`, n.label]));

        const byBook = new Map();
        for (const n of graph.nodes) {
          if (n.kind !== 'concept' || n.domain !== domain) continue;
          const book = n.book_id ?? 'other';
          const b = byBook.get(book) ?? {
            book_id: book, title: bookTitles.get(book) ?? book, topics: [],
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
        return json(res, {
          domain, ability,
          books: [...byBook.values()].sort((a, b) => b.exercises - a.exercises),
        });
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

      case p.startsWith('/extras/'): {
        const id = decodeURIComponent(p.slice('/extras/'.length));
        return json(res, putnamExtras.get(id) ?? { hints: [], solution: null });
      }

      case p.startsWith('/attempts/'):
        return json(res, attemptsFor(db, decodeURIComponent(p.slice('/attempts/'.length))));

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
          (!concept || e.concept_id === concept)
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

        return json(res, {
          total: list.length,
          offset,
          items: list.slice(offset, offset + limit).map((e) => ({
            ...withText(e),
            status: states.get(e.id)?.status ?? 'unseen',
            starred: Boolean(states.get(e.id)?.starred),
          })),
        });
      }

      case p === '/facets': {
        const by = (key) => {
          const m = new Map();
          for (const e of graph.exercises) m.set(e[key], (m.get(e[key]) ?? 0) + 1);
          return [...m.entries()].filter(([k]) => k).map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count);
        };
        const garbled = graph.exercises.filter((e) => e.ocr && (e.garble ?? 0) > 0.3).length;
        return json(res, { domains: by('domain'), books: by('book_id'), tiers: by('tier'),
                           total: graph.exercises.length, garbled });
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
        const state = recordAttempt(db, body);
        // Tell the machine-wide log, so Cadence can measure a Lattice block
        // without either app knowing about the other.
        const item = graph.exercises.find((e) => e.id === body.item_id);
        appendActivity({
          app: 'lattice',
          kind: 'attempt',
          ok: body.outcome === 'solved',
          outcome: body.outcome,
          id: body.item_id,
          item_type: body.item_type,
          domain: item?.domain
            ?? (body.concept_id?.startsWith('skill:') ? 'mental math' : null),
          concept: body.concept_id ?? null,
          seconds: body.seconds ?? null,
        });
        return json(res, state);
      }
      case '/star':
        if (!body.item_id) return json(res, { error: 'item_id required' }, 400);
        setStar(db, body.item_id, body.item_type ?? 'putnam', !!body.starred);
        return json(res, { ok: true });
      case '/view':
        if (!body.item_id) return json(res, { error: 'item_id required' }, 400);
        recordView(db, body.item_id);
        return json(res, { ok: true });

      case '/cadence': {
        // Write today's plan into Cadence as a playable session.
        const ability = abilityReport(db, graph);
        const rated = ability.filter((a) => a.pool > 0);
        const plan = buildPlan({
          due: stats(db).due,
          weakest: rated.find((a) => a.attempts > 0) ?? rated[0] ?? null,
          ability: rated.slice(0, 5),
          minutes: Number(body.minutes ?? 45),
        });
        try {
          return json(res, { ok: true, plan, ...(await writeSession(plan)) });
        } catch (err) {
          return json(res, {
            error: `Cadence not reachable at ${process.env.CADENCE_DIR ?? '~/projects/cadence'}`
              + ` (${err.code ?? err.message})`,
          }, 502);
        }
      }
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
await loadLocalText();
await loadPutnamExtras();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lattice on http://127.0.0.1:${PORT}  (db: ${DB_PATH})`);
});
