# Lattice: Next Features

## Completed
- Server + SQLite practice memory (`server.mjs`, `lib/db.mjs`, `lib/mastery.mjs`)
- Attempt logging, SM-2 spaced repetition, concept mastery, weak-edge diagnosis
- Warm-up ladder panel on the problem view
- Textbook extraction → concept graph pipeline (probability)
- Full keyboard navigation:
  - `j`: next problem
  - `k`: previous problem
  - `/`: focus search
  - `s`: toggle solution collapse
- Recently viewed top row (persistent)
- Copy controls for problem/solution/both
- Solutions collapsed by default

## Now (High Impact, Low Complexity)
- Progressive hint reveal:
  Show hint 1, then 2, then 3 on demand.

- Favorites:
  Star problems and filter by favorites.

- Solved tracking:
  Mark solved/unsolved/in-progress and filter by state.

- Practice set quick actions:
  One-click sets (e.g., 5 random hard geometry, random A-session).

- Search query operators:
  Support syntax like `year:2018 topic:combinatorics has:solution`.

- Sticky current problem URL:
  Encode selected problem/filter state in query params for sharing.

## Next (High Value)
- Topic drill mode:
  Generate random streams from selected topic + difficulty.

- Try-first timer:
  20/40/60-minute timer before enabling hints/solution.

- Similar problems panel:
  Show nearest neighbors via embeddings + metadata similarity.

- Export tools:
  Export current problem/set to Markdown, PDF, and Anki-ready cards.

- Difficulty calibration:
  User votes + confidence updates over time.

- Mobile study mode:
  Focused single-column mode with larger math typography.

## Advanced / Unique
- Proof-path mode:
  Reveal structured checkpoints instead of full solutions.

- Strategy fingerprint:
  Show problem “shape” (invariant, extremal, symmetry, recursion, etc.).

- Technique heatmap:
  Year-by-year matrix of techniques and topic frequencies.

- Similarity graph explorer:
  Interactive graph of semantically related problems.

- Personal weakness tracker:
  Recommend weekly drills from missed/slow topics.

- Mistake classifier:
  Log failed attempts and infer likely failure mode.

- Solution diff view:
  Compare alternate solutions side-by-side when available.

- Anti-spoiler challenge mode:
  Time-lock solutions and ration hints.

## Data/Infra
- Precompute and cache embeddings for all problems.
- ~~Add lightweight local DB (SQLite) for user state/history.~~ done — `data/lattice.db`
- Add versioned metadata schema migrations.
- Add nightly refresh pipeline for newly published years.

## Quality
- Add integration tests for search, filters, and keyboard shortcuts.
- Add parser regression tests across representative years.
- Add a “fallback rendering” test suite (Pandoc vs raw TeX).
