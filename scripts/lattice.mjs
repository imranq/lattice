#!/usr/bin/env node
// lattice — command-line tools for the corpus.
//
//   lattice audit                       how many hardcoded problems can be checked, by book
//   lattice audit --by chapter          … by chapter (or: book, domain, concept)
//   lattice audit --book herstein       one book only
//   lattice audit --cloud               only what the live site can serve (no data/local text)
//   lattice audit --tier free --list    list the problems in one tier, with where they live
//   lattice audit --json                machine-readable
//   lattice verify [--refs]             check every generator (scripts/verify_generators.mjs)
//
// Tiers, from best to worst:
//   exact     auto-gradable with a stored answer: marked instantly, no model
//   broken    claims to be auto-gradable but has no answer: silently ungradable
//   solution  a worked solution to compare against, but no exact answer
//   free      nothing to check against: self-report or a model grader only
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setData, getGraph } from '../lib/api.mjs';
import { loadGenerators } from './load_generators.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIERS = ['exact', 'broken', 'solution', 'free'];
const TIER_LABEL = {
  exact: 'exact answer', broken: 'broken claim', solution: 'solution only', free: 'free response',
};

// ---- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'help';
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

// ---- load the corpus the way the server does -------------------------------------

function loadCorpus({ cloud }) {
  const readJson = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));
  const chapterTitles = {};
  const booksDir = join(ROOT, 'data', 'processed', 'books');
  for (const f of readdirSync(booksDir).filter((x) => x.endsWith('.json'))) {
    const b = readJson('data', 'processed', 'books', f);
    if (b.chapters?.length) {
      chapterTitles[b.book_id] = Object.fromEntries(b.chapters.map((c) => [c.chapter, c.title]));
    }
  }
  setData({ graph: readJson('data', 'processed', 'graph', 'math.json'), chapterTitles });
  const graph = getGraph();

  // Readable text: in the graph for open sources; in data/local/ for the rest
  // (never on the live site, which is what --cloud models).
  const localText = new Set();
  const localDir = join(ROOT, 'data', 'local');
  if (!cloud && existsSync(localDir)) {
    for (const f of readdirSync(localDir).filter((x) => x.endsWith('.text.json'))) {
      for (const id of Object.keys(JSON.parse(readFileSync(join(localDir, f), 'utf8')))) localText.add(id);
    }
  }
  // Putnam worked solutions live in the labeled dataset, not the graph.
  const putnamSolutions = new Set();
  const labeled = join(ROOT, 'data', 'processed', 'problems.labeled.json');
  if (existsSync(labeled)) {
    for (const p of JSON.parse(readFileSync(labeled, 'utf8')).problems) {
      if (p.solution_text || p.solution_tex) putnamSolutions.add(p.id);
    }
  }
  return { graph, localText, putnamSolutions };
}

function tierOf(e, { putnamSolutions }) {
  const hasAnswer = e.answer !== undefined && e.answer !== null && String(e.answer).trim() !== '';
  if (e.auto_gradable && hasAnswer) return 'exact';
  if (e.auto_gradable || e.answer_missing) return 'broken';
  if (e.solution || e.solution_text || e.solution_tex || e.worked_solution
      || putnamSolutions.has(e.id) || (e.book_id === 'math_dataset' && e.has_published_solution)) {
    return 'solution';
  }
  return 'free';
}

// ---- audit ----------------------------------------------------------------------

function audit() {
  const cloud = flag('cloud');
  const by = opt('by', 'book');
  const onlyBook = opt('book');
  const onlyTier = opt('tier');
  const list = flag('list');
  const { graph, localText, putnamSolutions } = loadCorpus({ cloud });

  const titles = new Map(graph.nodes.filter((n) => n.kind === 'book')
    .map((n) => [n.id.replace(/^book:/, ''), n.label]));
  const chapters = new Map(graph.nodes.filter((n) => n.kind === 'domain_part' && n.chapter != null)
    .map((n) => [`${n.book_id}:${n.chapter}`, n.label]));
  const concepts = new Map(graph.nodes.filter((n) => n.kind === 'concept').map((n) => [n.id, n.label]));

  // Chapters that already have generated practice, so a free-response problem
  // there is not a dead end. Chapter level, because books file their exercises
  // under an "Exercises" section while generators target the teaching sections.
  const M = loadGenerators();
  const chapterOf = new Map(graph.nodes.filter((n) => n.kind === 'concept')
    .map((n) => [n.id, n.chapter != null ? `${n.book_id}:${n.chapter}` : n.id]));
  const generated = new Map();
  for (const sk of M.SKILLS) for (const c of sk.concepts ?? []) {
    const ch = chapterOf.get(c) ?? c;
    if (!generated.has(ch)) generated.set(ch, []);
    generated.get(ch).push(sk.id);
  }
  // Problems turned into step practice directly (Putnam solutions).
  const stepped = new Set((M.putnamSteps ?? []).map((q) => q.id));
  const gensFor = (e) => [...new Set([
    ...(generated.get(e.chapter != null ? `${e.book_id}:${e.chapter}` : e.concept_id) ?? []),
    ...(stepped.has(e.id) ? ['pt-steps'] : []),
  ])];

  const keyOf = (e) => {
    if (by === 'domain') return e.domain ?? 'unknown';
    if (by === 'concept') return `${titles.get(e.book_id) ?? e.book_id} › ${concepts.get(e.concept_id) ?? e.concept_id ?? '—'}`;
    if (by === 'chapter') {
      const ch = e.chapter != null ? chapters.get(`${e.book_id}:${e.chapter}`) ?? `Chapter ${e.chapter}` : e.section_title ?? '—';
      return `${titles.get(e.book_id) ?? e.book_id} › ${ch}`;
    }
    return titles.get(e.book_id) ?? e.book_id;
  };

  const rows = new Map();
  const listed = [];
  let skippedUnreadable = 0;
  for (const e of graph.exercises) {
    if (onlyBook && e.book_id !== onlyBook) continue;
    const readable = Boolean(e.text || e.has_text || localText.has(e.id));
    if (cloud && !readable) { skippedUnreadable++; continue; }
    const t = tierOf(e, { putnamSolutions });
    const k = keyOf(e);
    const r = rows.get(k) ?? { key: k, total: 0, exact: 0, broken: 0, solution: 0, free: 0, unreadable: 0, covered: 0 };
    r.total++; r[t]++;
    if (!readable) r.unreadable++;
    if (t !== 'exact' && gensFor(e).length) r.covered++;
    rows.set(k, r);
    if (list && (!onlyTier || t === onlyTier)) {
      listed.push({
        id: e.id, tier: t, book: titles.get(e.book_id) ?? e.book_id,
        chapter: e.chapter != null ? chapters.get(`${e.book_id}:${e.chapter}`) ?? `Chapter ${e.chapter}` : null,
        section: e.section_title ?? null, page: e.page ?? null,
        concept: concepts.get(e.concept_id) ?? null, readable,
        generators: gensFor(e),
      });
    }
  }

  const all = [...rows.values()].sort((a, b) => b.total - a.total);
  const sum = (f) => all.reduce((s, r) => s + r[f], 0);
  const total = { key: 'Total', total: sum('total'), exact: sum('exact'), broken: sum('broken'),
                  solution: sum('solution'), free: sum('free'), unreadable: sum('unreadable'), covered: sum('covered') };
  const gen = { skills: M.SKILLS.length, chaptersCovered: generated.size };

  if (flag('json')) {
    console.log(JSON.stringify({ scope: cloud ? 'cloud' : 'local', by, rows: all, total, generated: gen,
      ...(list ? { problems: listed } : {}) }, null, 2));
    return;
  }

  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
  const nonDet = (r) => r.total - r.exact;
  console.log(`\nLattice problem audit — ${cloud ? 'what the live site serves' : 'everything on this machine'}${
    onlyBook ? `, ${titles.get(onlyBook) ?? onlyBook}` : ''}\n`);
  console.log(`  ${total.total.toLocaleString()} hardcoded problems · ${total.exact.toLocaleString()} with an exact answer (${pct(total.exact, total.total)}) · `
    + `${nonDet(total).toLocaleString()} without (${pct(nonDet(total), total.total)})`);
  if (total.broken) console.log(`  ⚠ ${total.broken} marked auto-gradable but missing an answer: they can never be marked`);
  if (cloud && skippedUnreadable) console.log(`  (${skippedUnreadable.toLocaleString()} more exist but have no text the live site can show)`);
  console.log(`  ${gen.skills} generators are fully deterministic; ${total.covered.toLocaleString()} of the non-deterministic problems `
    + `sit in a chapter that has generated practice\n`);

  const cols = [['key', by === 'book' ? 'Book' : by[0].toUpperCase() + by.slice(1), 0],
    ['total', 'Problems', 9], ['exact', 'Exact', 8], ['broken', 'Broken', 7], ['solution', 'Solution', 9],
    ['free', 'Free', 8], ['nondet', 'No exact %', 11], ['covered', 'Gen. chapter', 13]];
  if (!cloud) cols.push(['unreadable', 'No text', 8]);
  const width = Math.min(60, Math.max(10, ...all.map((r) => r.key.length)));
  const cell = (r, [f, , w]) => {
    const v = f === 'nondet' ? pct(nonDet(r), r.total) : f === 'key' ? r.key : r[f].toLocaleString();
    return f === 'key' ? v.slice(0, width).padEnd(width) : String(v).padStart(w);
  };
  const line = (r) => `  ${cols.map((c) => cell(r, c)).join(' ')}`;
  console.log(`  ${cols.map(([f, h, w]) => (f === 'key' ? h.padEnd(width) : h.padStart(w))).join(' ')}`);
  console.log(`  ${'─'.repeat(width + cols.slice(1).reduce((s, c) => s + c[2] + 1, 0))}`);
  const limit = Number(opt('limit', by === 'book' ? 100 : 40));
  for (const r of all.slice(0, limit)) console.log(line(r));
  if (all.length > limit) console.log(`  … ${all.length - limit} more (use --limit)`);
  console.log(`  ${'─'.repeat(width + cols.slice(1).reduce((s, c) => s + c[2] + 1, 0))}`);
  console.log(line(total));

  if (list) {
    console.log(`\n${listed.length.toLocaleString()} problem(s)${onlyTier ? ` in tier “${TIER_LABEL[onlyTier] ?? onlyTier}”` : ''}:\n`);
    const max = Number(opt('limit', 200));
    for (const p of listed.slice(0, max)) {
      const where = [p.book, p.chapter, p.section, p.page ? `p. ${p.page}` : null].filter(Boolean).join(' › ');
      console.log(`  ${p.id.padEnd(34)} ${TIER_LABEL[p.tier].padEnd(14)} ${where}${
        p.generators.length ? `  [generated: ${p.generators.join(', ')}]` : ''}`);
    }
    if (listed.length > max) console.log(`  … ${listed.length - max} more (use --limit)`);
  }
  console.log(`\nTiers: exact = checked instantly · broken = claims gradable, has no answer · `
    + `solution = worked solution, no exact answer · free = nothing to check against.`);
}

// ---- dispatch -------------------------------------------------------------------

if (cmd === 'audit') audit();
else if (cmd === 'verify') {
  const r = spawnSync('node', [join(ROOT, 'scripts', 'verify_generators.mjs'), ...argv], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  const help = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    .slice(1, 18).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  console.log(help);
  if (cmd !== 'help') process.exit(1);
}
