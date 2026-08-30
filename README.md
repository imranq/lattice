# Lattice

**Concepts, partially ordered.**

Lattice turns a bank of hard problems into something a person can climb. It builds a
prerequisite graph from textbook sources, attaches contest problems to concept nodes, and
generates warm-up ladders that ascend to a target problem instead of dropping you at it.

```text
textbook LaTeX source
→ sections, exercises, index terms, cross-references
→ concept graph (prerequisite DAG, confidence-scored)
→ Putnam problems attached to concept nodes
→ warm-up ladders: W1 → W2 → core
```

## Why this exists

The Putnam bank is 492 problems, of which **344 are `hard` and 24 `very_hard` — and exactly
one is `easy`**. Every entry point is a cliff. Lattice supplies the missing rungs from real
textbook exercises, ordered by a prerequisite graph rather than by topic label.

See `features/math_mastery_graph.md` for the full design.

## Current state

| Domain | Source | Nodes | Exercises | Status |
|---|---|---|---|---|
| Probability | Grinstead & Snell (LaTeX, GFDL) | 315 | 705 | graph built, ladders validated |
| Abstract Algebra | Herstein (scan) | — | — | needs vision extraction |
| everything else | — | — | — | unbacked |

Probability graph: 315 nodes (12 domain, 35 concept, 184 subconcept, 84 term), 1182 edges,
**acyclic**. 91 Putnam problems linked, 91/91 ladders monotone in difficulty.

## Pipelines

### Putnam archive

```bash
bash scripts/download_putnam_tex.sh          # data/raw/{problems,solutions}
python3 scripts/build_dataset.py             # data/processed/problems.json + site/problems.js
```

Uses `pandoc` when present for `problem_html`/`solution_html`; disable with `--no-pandoc`.

### Textbook → concept graph

```bash
bash scripts/fetch_books.sh                  # data/raw/books/ (gitignored, re-fetchable)

python3 scripts/extract_book_tex.py \
  --src data/raw/books/grinstead_snell --book-id grinstead_snell \
  --title "Introduction to Probability" \
  --authors "Charles M. Grinstead; J. Laurie Snell" \
  --license GFDL --source-url "https://math.dartmouth.edu/~prob/prob/"

python3 scripts/build_concept_graph.py --books data/processed/books/grinstead_snell.json

python3 scripts/link_putnam_to_graph.py --topics Probability Combinatorics --primary-topic-only
```

Prerequisite edges combine three evidence types by noisy-OR:

| Evidence | Confidence | Signal |
|---|---|---|
| `cross_reference` | 0.85 | an exercise `\ref{}`s an earlier section |
| `term_reuse` | 0.55 | an index term introduced earlier is used here |
| `textbook_order` | 0.40 | adjacent sections (weak prior) |

### Labeling

```bash
export GEMINI_API_KEY='YOUR_KEY_HERE'
python3 scripts/label_topics_gemini.py \
  --input data/processed/problems.json \
  --output data/processed/problems.labeled.json \
  --model gemini-3.1-flash-lite-preview --mode batch

python3 scripts/publish_site_data.py \
  --input data/processed/problems.labeled.json --site-data site/problems.js
```

Per problem: `topic`, `secondary_topics`, `difficulty`, `problem_type`, `answer_format`,
`techniques`, `concepts`, `prerequisites`, `theorems`, `keywords`,
`estimated_solve_time_minutes`, casework/construction/symmetry flags, `difficulty_reason`,
and progressive `hints`. Run logs land in `logs/label_runs/<RUN_ID>/`.

## Run

```bash
npm start            # http://127.0.0.1:4115 (PORT respected; Switchboard sets it)
npm run dev          # same, with --watch
```

Or via Switchboard at http://lattice.localhost.

The site still opens as plain static files (`cd site && python3 -m http.server 8080`) — the
memory layer detects an unreachable API and hides itself rather than breaking the browser.

## Practice memory

State lives in SQLite at `data/lattice.db` (gitignored — it is personal history). Uses
`node:sqlite`, built into Node ≥22.5, so the server has **zero dependencies**.

- **Attempt log** — every solved/partial/failed, with time spent and hints used.
- **Spaced repetition** — SM-2 per item; hints reduce the effective grade, so a solve you
  needed three hints for does not schedule like a clean one.
- **Concept mastery** — recency-weighted (0.85 decay) success rate per concept node, shrunk
  toward 0.5 by attempt count so one lucky solve is not mastery.
- **Weak-edge diagnosis** — the payoff of having a graph. When you fail a concept *and* its
  prerequisite is also weak, Lattice names the **edge**, not the node: fail Permutations
  twice and struggle with Combinations, and it reports `Permutations → Combinations` as a
  confirmed gap and tells you to fix the prerequisite first.
- **Recommendations** — weak-but-evidenced concepts first, then unseen concepts whose
  prerequisites you already hold (readiness-weighted).

### API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + node count |
| GET | `/api/graph?kinds=concept` | nodes and edges (`assessed_by` omitted) |
| GET | `/api/stats` | attempts, solved, due, minutes |
| GET | `/api/mastery` | per-concept mastery, weakest first |
| GET | `/api/weak-edges` | edge-level gap diagnosis |
| GET | `/api/recommend?limit=8` | what to work on next |
| GET | `/api/due?n=20` | items due for review |
| GET | `/api/ladder/:problemId` | warm-up ladder for a problem |
| GET | `/api/exercises?concept=…` | exercises for a concept |
| GET | `/api/attempts/:itemId` | attempt history |
| POST | `/api/attempt` | `{item_id, item_type, concept_id, outcome, seconds, hints_used}` |
| POST | `/api/star`, `/api/view` | flags and view tracking |

## Known limitations

- **Putnam↔graph matching is lexical and imprecise.** Label-length bias lets generic nodes
  ("Counting Problems") absorb too many problems. This wants an LLM tagging pass against the
  fixed ontology; see the design doc.
- **`term` nodes are polluted** by index entries for example flavor ("wheaties", "roulette").
  They are excluded as match targets for that reason.
- **Only probability is backed.** Other domains have no textbook source attached and are
  marked unbacked rather than given fabricated warm-ups.
- Some early Putnam years have no official solution TeX; those stay problem-only.

## Sources

Textbook sources are fetched, not vendored — `data/raw/books/` is gitignored. Only extracted
structure and derived metadata are committed. Grinstead & Snell's *Introduction to
Probability* is redistributable under the GNU Free Documentation License.
