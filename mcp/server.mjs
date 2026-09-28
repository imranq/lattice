#!/usr/bin/env node
// Lattice's problem generators as an MCP server, so an agent can hand out
// practice and grade it without writing an answer key of its own.
//
//   claude mcp add lattice -- node /path/to/lattice/mcp/server.mjs
//
// Four tools: list_skills, generate, check, path_for. A problem is named by
// (skill, level, seed) and regenerated wherever it is needed, so `check` grades
// against the generator's own answer — never against one the caller supplies —
// and `generate` hands back nothing an agent could leak: no answer, steps,
// distractor explanations, or line ids that give the order away.
//
// Speaks MCP over stdio (newline-delimited JSON-RPC) with no dependencies, like
// the rest of the repo. stdout is the protocol; anything else goes to stderr.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadGenerators } from '../scripts/load_generators.mjs';

const M = loadGenerators();
const skillById = new Map(M.SKILLS.map((s) => [s.id, s]));

const graph = JSON.parse(readFileSync(new URL('../data/processed/graph/math.json', import.meta.url), 'utf8'));
const concepts = new Map(graph.nodes.filter((n) => n.kind === 'concept').map((n) => [n.id, n]));
const prereqsOf = new Map();
for (const e of graph.edges) {
  if (e.type !== 'prerequisite') continue;
  if (!prereqsOf.has(e.dst)) prereqsOf.set(e.dst, []);
  prereqsOf.get(e.dst).push({ id: e.src, confidence: e.confidence });
}
const skillsFor = (conceptId) => M.SKILLS.filter((s) => s.concepts.includes(conceptId)).map((s) => s.id);

const LETTERS = 'ABCDEFGH';

/** The problem, as a learner may see it. `order` lines are relabelled L1, L2…
 *  because their own ids (s1… correct, x… planted) would give the answer away. */
function present(p) {
  const out = {
    problem: { skill: p.skill, level: p.level, seed: p.seed },
    skill_name: p.skillName, domain: p.domain, prompt: p.prompt,
    math: p.prose ? 'prose with $TeX$' : 'plain',
  };
  if (p.kind === 'order') {
    out.lines = p.lines.map((l, i) => ({ label: `L${i + 1}`, text: l.text }));
    out.answer_format = 'The labels of the lines that belong, in order, comma-separated (e.g. "L3, L1, L5"). Leave out lines that do not belong.';
  } else if (p.choices) {
    out.choices = p.choices.map((c, i) => ({ label: LETTERS[i], text: c.text }));
    out.answer_format = 'The letter of one choice, or its text.';
  } else if (p.kind === 'pair') {
    out.answer_format = 'Two integers "x, y"; any solution is accepted.';
  } else if (p.kind === 'einsum') {
    out.answer_format = 'An einsum spec such as "ij,jk->ik"; any spec that computes the same thing is accepted.';
  } else {
    out.answer_format = 'A single value.';
  }
  return out;
}

/** Translate what an agent sends back into what `check` expects. */
function normalise(p, answer) {
  const a = String(answer).trim();
  if (p.kind === 'order') {
    const labels = a.split(/[\s,]+/).filter(Boolean);
    return labels.map((l) => p.lines[Number(/^L?(\d+)$/i.exec(l)?.[1]) - 1]?.id ?? l).join(',');
  }
  if (p.choices && /^[A-H]$/i.test(a)) return p.choices[LETTERS.indexOf(a.toUpperCase())]?.text ?? a;
  return a;
}

function regenerate({ skill, level, seed }) {
  if (!skillById.has(skill)) throw new Error(`unknown skill "${skill}"; call list_skills`);
  if (!Number.isInteger(seed)) throw new Error('seed must be the integer generate returned');
  return M.generate(skill, level ?? 1, seed);
}

const TOOLS = [
  {
    name: 'list_skills',
    description: 'List the problem generators. Each is a skill with 5 levels (1 is multiple choice where the answer is computed; higher levels are typed). Filter by domain, by graph concept id, or by a word in the name or blurb.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'e.g. "probability", "machine learning", "arithmetic"' },
        concept: { type: 'string', description: 'A graph concept id, e.g. "concept:grinstead_snell:sec_3.1"' },
        query: { type: 'string' },
      },
    },
    run({ domain, concept, query }) {
      const q = query?.toLowerCase();
      const rows = M.SKILLS.filter((s) => (!domain || s.domain === domain)
        && (!concept || s.concepts.includes(concept))
        && (!q || `${s.id} ${s.name} ${s.blurb}`.toLowerCase().includes(q)));
      return {
        count: rows.length,
        domains: domain ? undefined : [...new Set(M.SKILLS.map((s) => s.domain))],
        skills: rows.map((s) => ({
          id: s.id, name: s.name, domain: s.domain, blurb: s.blurb,
          concepts: s.concepts.map((c) => ({ id: c, label: concepts.get(c)?.label ?? null })),
          source: s.source ? { title: s.source.title, section: s.source.section, url: s.source.url, fidelity: s.source.fidelity } : null,
        })),
      };
    },
  },
  {
    name: 'generate',
    description: 'Make one problem. Returns what to show the learner and a `problem` reference {skill, level, seed}; pass that reference to `check` with their answer. The answer is not returned. Omit seed for a fresh problem; reuse one to replay it exactly.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string' },
        level: { type: 'integer', minimum: 1, maximum: 5, default: 1 },
        seed: { type: 'integer', description: 'Optional; random if omitted.' },
      },
      required: ['skill'],
    },
    run({ skill, level = 1, seed = Math.floor(Math.random() * 2 ** 31) }) {
      return present(regenerate({ skill, level, seed }));
    },
  },
  {
    name: 'check',
    description: "Grade a learner's answer to a generated problem. Regenerates the problem from its reference, so the grade comes from the generator, not the caller. When wrong, names the specific mistake where one matches. Returns the answer, worked steps and the trick worth remembering, for use after the attempt.",
    inputSchema: {
      type: 'object',
      properties: {
        problem: {
          type: 'object',
          properties: { skill: { type: 'string' }, level: { type: 'integer' }, seed: { type: 'integer' } },
          required: ['skill', 'level', 'seed'],
        },
        answer: { type: 'string' },
      },
      required: ['problem', 'answer'],
    },
    run({ problem, answer }) {
      const p = regenerate(problem);
      const input = normalise(p, answer);
      const correct = M.check(p, input);
      const mistake = correct ? null : M.diagnose(p, input);
      const labelOf = new Map((p.lines ?? []).map((l, i) => [l.id, `L${i + 1}`]));
      return {
        correct,
        mistake: mistake?.why ?? null,
        answer: p.kind === 'order' ? p.answer.split(',').map((id) => labelOf.get(id)).join(', ') : p.answer,
        steps: p.kind === 'order' ? undefined : p.steps,
        trick: p.trick ?? null,
      };
    },
  },
  {
    name: 'path_for',
    description: 'What to practise before a concept: its prerequisites in the concept graph (walked back a few steps), each with the skills that drill it. Use a concept id from list_skills.',
    inputSchema: {
      type: 'object',
      properties: {
        concept: { type: 'string' },
        depth: { type: 'integer', minimum: 1, maximum: 4, default: 2 },
      },
      required: ['concept'],
    },
    run({ concept, depth = 2 }) {
      if (!concepts.has(concept)) throw new Error(`unknown concept "${concept}"`);
      const seen = new Set([concept]);
      const out = [];
      let frontier = [concept];
      for (let d = 1; d <= depth && frontier.length; d++) {
        const next = [];
        for (const c of frontier) for (const pre of prereqsOf.get(c) ?? []) {
          if (seen.has(pre.id)) continue;
          seen.add(pre.id);
          next.push(pre.id);
          out.push({ id: pre.id, label: concepts.get(pre.id)?.label ?? null, distance: d,
                     confidence: pre.confidence, skills: skillsFor(pre.id) });
        }
        frontier = next;
      }
      return {
        concept: { id: concept, label: concepts.get(concept).label, skills: skillsFor(concept) },
        prerequisites: out,
      };
    },
  },
];
const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'lattice', version: '0.1.0' },
        instructions: 'Practice problems with verified answers. list_skills to find a skill, generate to get a problem (show the learner prompt, and choices or lines if present), check with their answer. Never guess the answer yourself; check it.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ run, ...t }) => t) };
    case 'tools/call': {
      const tool = toolByName.get(msg.params?.name);
      if (!tool) throw Object.assign(new Error(`unknown tool ${msg.params?.name}`), { code: -32602 });
      try {
        const result = tool.run(msg.params.arguments ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  if (msg.id === undefined) return; // a notification: nothing to answer
  try {
    send({ jsonrpc: '2.0', id: msg.id, result: handle(msg) });
  } catch (err) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: err.message } });
  }
});
