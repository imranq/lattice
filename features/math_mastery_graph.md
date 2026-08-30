# Math Mastery Graph

> Status as of 2026-08-30: seven books are extracted into one graph — 3,235 exercises,
> 441 nodes, 5 domains — with a layered visualization, learning plans, generated drills and
> a progress page. See README for the current numbers. Original status note follows.
>
> Status as of 2026-08-29: the **probability** slice is built. Grinstead & Snell extracted
> from LaTeX source (705 exercises), concept graph built (315 nodes, 1182 edges, acyclic),
> 91 Putnam problems linked with 91/91 monotone ladders. The MVP below was written targeting
> Number Theory; probability was done first because a full LaTeX source was available, which
> removed the extraction risk entirely. See README for the current state and limitations.

## Summary

Build a mastery system that goes beyond static topic buckets by combining:

- textbook structure as a prior concept graph
- LLM-assisted parsing of exercises and solutions
- problem-to-concept tagging
- a **warm-up ladder** that bridges textbook exercises to Putnam problems
- model-relative difficulty estimates from a ladder of small open models
- adaptive exams and generative practice grounded in the graph

The goal is not just to store problems. The goal is to infer which concepts a learner has
actually mastered, where the weak prerequisite edges are, and what the next best problems
should be.

## Motivating Problem: The Bank Has No On-Ramp

The current dataset (`data/processed/problems.labeled.json`, 492 problems, 1985-2025) is
labeled but pedagogically unusable as a practice ladder:

| difficulty | count |
|---|---|
| `easy` | 1 |
| `medium` | 123 |
| `hard` | 344 |
| `very_hard` | 24 |

96% of the bank sits at `hard` or above. Every entry point is a cliff. Topic coverage is
similarly lopsided: Number Theory 98, Combinatorics 79, Algebra 66, Real Analysis 65,
Calculus 45, Geometry 39, Linear Algebra 37, Probability 21, Abstract Algebra 15,
Functional Equations 13, Complex Analysis 6, Inequalities 6.

The labeler already emits `prerequisites` per problem (e.g. `["basic set theory",
"combinatorial counting", "binomial theorem"]` for 1985-A1) — free-text strings pointing at
concepts that have no home in the product. Those strings are the seed of the concept graph,
and the missing rungs below them are what the warm-up layer supplies.

**Thesis:** the strongest version of this feature is a `knowledge graph + warm-up ladder +
assessment engine`, not a larger scraped problem bank.

## The Warm-Up Layer (new, and the highest-value slice)

A warm-up is a short, single-technique problem attached to exactly one concept node, sitting
strictly below a Putnam problem on the same node. Three sources, in priority order:

### Tier W0 — Definition checks (generated, cheap)
One-line recall/apply items derived from the concept node itself: state the definition,
apply it once, produce a counterexample. Machine-checkable answers. 30 seconds each.
Purpose: confirm the vocabulary exists before testing the technique.

### Tier W1 — Textbook exercises (curated, the backbone)
Real exercises from the corpus below, attached to the same concept node as the target Putnam
problem, taken from the section that *introduces* the technique rather than the chapter-end
challenge set. These carry inherited difficulty from their position in the book: exercise 1-5
of a section is a warm-up, exercise 20+ of the same section is usually a bridge problem.

### Tier W2 — Bridge problems (curated)
Two-technique problems: earlier/easier Putnam A1/B1 items, the starred textbook exercises,
and *Proofs from THE BOOK* set-pieces. These are the last rung before the target.

### Ladder construction

For a target problem `P` with concept set `C(P)`:

1. Take the concept nodes in `C(P)` plus their direct prerequisites.
2. For each node, pull the highest-mastery-gap node first (weakest first, not easiest first).
3. Emit `W0 -> W1 -> W2 -> P`, capped at ~5 items so a session stays under an hour.
4. Skip any rung whose node already has recent mastery evidence above threshold.

A ladder is *valid* only if every rung's technique set is a subset of the target's technique
set. This is a deterministic validator, not an LLM judgment, and it is the main defense
against "related-looking" warm-ups that teach nothing about the target.

### Warm-up quality bar

- exactly one new technique per rung
- solvable in under 10 minutes by someone who knows that technique
- has a checkable answer or a 3-line solution sketch
- cites its source (book, section, exercise number) — no anonymous problems

## Corpus: Books Actually Available

These exist in `~/papers` today and define the realistic first-pass graph. Each is listed
with the concept regions it should own and the Putnam topics it feeds.

| Book | Owns | Feeds Putnam topic |
|---|---|---|
| `real_mathematical_analysis_pugh.pdf` | metric spaces, compactness, continuity, differentiation, Riemann integration, function spaces | Real Analysis (65), Calculus (45) |
| `analysis_i_tao.pdf` / `terencetao_analysis_i_third_edition.pdf` | construction of R, limits, series, convergence — foundational rungs below Pugh | Real Analysis, Calculus |
| `linear_algebra_done_right_axler.pdf` | vector spaces, operators, eigenvalues, spectral theorem, determinants-last treatment | Linear Algebra (37), Algebra |
| `linearalgebra/Linear Algebra and its Applications 5th Edition.pdf` (Lay) | computational linear algebra, row reduction, matrix algebra — warm-up tier for Axler | Linear Algebra |
| `Andrews-NumberTheory.pdf` | divisibility, congruences, quadratic residues, arithmetic functions, partitions | Number Theory (98) |
| `an_introduction_to_the_art_of_mathematical_inequalities_steele_j_michael_2004_maa.pdf` | AM-GM, Cauchy-Schwarz, rearrangement, convexity, Jensen | Inequalities (6), Real Analysis |
| `complex_analysis_stein_shakarchi.pdf` | holomorphy, Cauchy theory, residues, conformal maps | Complex Analysis (6) |
| `visual_complex_analysis_needham.pdf` | geometric intuition for the same — good W0/W1 tier above Stein | Complex Analysis, Geometry |
| `stein_shakarchi_1_fourier_analysis_transform.pdf` | Fourier series, convergence, applications | Real Analysis |
| **Grinstead & Snell, _Introduction to Probability_** (fetched, GFDL, **full LaTeX source**) | discrete/continuous distributions, combinatorics, conditioning, expectation, variance, sums, LLN, CLT, generating functions, Markov chains, random walks | Probability (21), Combinatorics (79) |
| `Introduction to Probability` (Blitzstein & Hwang) | conditioning, expectation, LLN, generating functions | Probability (21), Combinatorics |
| `math_bertsekas_tsitsiklis_introduction_to_probability.pdf` | second probability source for consensus edges | Probability |
| `proofs_from_the_book.pdf` | pigeonhole, double counting, extremal arguments, elegant set-pieces | Combinatorics (79), W2 bridge tier broadly |
| `the_princeton_companion_to_mathematics.pdf` | **ontology source, not exercises** — concept names, definitions, cross-field vocabulary | all |
| `street_fighting_math.pdf` | estimation, dimensional analysis, bounding heuristics | W0 tier, Calculus |
| `john_hubbard_..._vector_calculus_linear_algebra_and_differential_forms.pdf` | multivariable calculus, forms | Calculus, Linear Algebra |
| `putnam1985_2000.pdf`, `putnam/2008.pdf` | official commentary/alternate solutions | all — solution enrichment |

### Corpus gaps to close

The following would materially strengthen the graph and are **not** currently in `~/papers`:

- ~~**Herstein, _Topics in Algebra_**~~ — **acquired** (`Algebra - Herstein.pdf` plus the
  student solutions manual). It is a scan with noisy OCR (`f: S ~ S` for `f: S \to S`,
  `=1=` for `\neq`), so it cannot use the LaTeX path and needs a vision extraction pass. Its
  exercise structure is clean and numbered, and its explicit "Harder Problems" headings map
  directly onto the W2 tier.
- **Dummit & Foote** or Artin — second algebra source for consensus prerequisite edges.
- **Engel, _Problem-Solving Strategies_** / Zeitz, _The Art and Craft of Problem Solving_ —
  purpose-built W2 bridge problems, technique-indexed.
- **Coxeter/Greitzer or Kiselev** — Geometry (39) is currently unbacked.
- **Concrete Mathematics** (Graham/Knuth/Patashnik) — generating functions is the #2
  technique in the bank (49 occurrences) with no source text.
- **Munkres** — only if topology-flavored analysis problems justify it. Low priority.

Until a gap is closed, mark those concept nodes `unbacked: true` and suppress warm-up
generation for them rather than faking rungs from an unrelated book.

## Graph Sources

### 0. Prefer LaTeX source over PDF

Where a book has public LaTeX source, extraction stops being a research problem and becomes a
parsing problem. Grinstead & Snell gave us, for free: `\label{exer 1.2.16}` on every exercise
(canonical stable ids), `\istar` marking harder exercises, `\index{}` as a concept
vocabulary, and `\ref{}` cross-references that are *direct evidence of dependency* — the
single strongest prerequisite signal in the graph. Search for source before committing to OCR.

Known parser hazards, all of them real in this source: `\chapter[short]{Long Title}` optional
bracket arguments, `\label` nested inside a section title, whole chapters on a single line,
and genuinely duplicated sections from `\choice{}{}` variants.

### 1. Textbook structure (primary scaffold)

Textbook structure is the first graph signal. It provides chapter-level concepts,
section-level sub-concepts, local ordering that approximates prerequisites, and exercise
clusters sharing a skill focus.

Initial inference:

- each section becomes a concept candidate
- exercises inherit their nearest section as a primary concept
- nearby earlier sections become candidate prerequisites
- cumulative review sections add cross-topic edges
- **exercise ordinal within a section becomes a within-node difficulty prior**

Treat this as a prior graph, not final truth.

### 2. Cross-book consensus

With two sources per domain (Axler/Lay, Blitzstein/Bertsekas, Pugh/Tao) an edge asserted by
both books gets high confidence; an edge in only one gets flagged for review. This is the
cheapest real validator available and the reason to prefer paired sources over breadth.

### 3. Syllabi and course sequences

Course catalogs give coarse prerequisite ordering across subjects and agreement signals
across institutions. Record explicitly whether an edge is a **cognitive** prerequisite or an
**institutional** one — they behave differently in ladder construction (only cognitive edges
may gate a warm-up).

### 4. Problem text and solutions

Problem statements and solutions refine the graph by exposing techniques actually used,
hidden prerequisite concepts, proof vs computation style, and concept mixtures inside one
exercise. The existing `techniques`/`prerequisites`/`theorems` fields already carry this for
all 492 Putnam problems.

### 5. Model solve behavior

Running a family of small models on the same set gives a model-relative difficulty ladder:

- solved by 0.6B -> likely easy/template-heavy
- solved by 1.5B or 3B only -> intermediate
- solved only by 7B/8B -> harder
- solved by none -> frontier

This is not the concept graph, but it is a useful empirical difficulty signal — and it is the
main check that a "warm-up" is actually easier than its target rather than merely shorter.

## Ontology

Fix the ontology before tagging anything. Seed it from the 13 existing topics plus the
technique distribution already observed in the bank (`induction` 91, `generating functions`
49, `modular arithmetic` 49, `substitution` 36, `algebraic manipulation` 31,
`coordinate geometry` 30, `parity` 27, `recurrence relations` 27, ...).

Two immediate cleanups the current labels demand:

1. **Case normalization.** `induction`/`Induction` (91/16), `generating functions`/
   `Generating functions` (49/9), `proof by contradiction`/`Contradiction` (12/10) are the
   same node split by casing. Normalize on ingest and add a canonical-alias table.
2. **Free-text prerequisites -> node ids.** Map strings like `"binomial theorem"` onto
   ontology nodes with a confidence score; anything unmapped goes to a review queue and
   becomes a candidate new node once it recurs.

Three levels: `domain` (13 topics) -> `concept` (textbook section granularity, ~400-600
nodes) -> `technique` (the verbs, ~150 nodes). Problems attach to concepts; techniques are
edges between problems and concepts, not nodes in the prerequisite DAG.

## LLM Role

LLMs are constrained extraction and labeling tools, not an unverified source of truth.

Good uses: extract exercise text from OCR or raw source, identify chapter/section/numbering
structure, tag concepts against a *predefined* ontology, estimate difficulty and techniques,
generate hints and W0 warm-ups, map problems to nodes with confidence scores.

Bad use: asking an LLM to invent the concept graph from scratch without structure or
validation.

Pipeline: parse raw source -> LLM extracts normalized fields -> deterministic validators ->
re-run uncertain cases with another prompt or model -> human review queue for the rest.
This mirrors the existing batch/recover flow in `scripts/label_topics_gemini.py` and
`scripts/recover_batch_outputs.py`.

## Data Model

Core entities: `Book`, `Course`, `Section`, `Concept`, `Problem`, `Solution`, `Edge`,
`Evidence`, plus two new ones:

- `WarmUp` — `{id, tier: W0|W1|W2, concept_id, source: {book, section, exercise}, statement,
  answer, sketch, techniques[], est_minutes}`
- `Ladder` — `{target_problem_id, rungs: [warmup_id|problem_id], generated_at, validator_pass}`

Edge types: `prerequisite`, `strengthens`, `commonly_co_taught`, `institutional_prerequisite`,
`assessed_by`, and `warms_up` (WarmUp -> Problem).

Evidence types: `textbook_structure`, `syllabus_structure`, `problem_solution_analysis`,
`model_solve_rate`, `cross_book_consensus`, `human_review`.

Every inferred mapping or edge carries confidence, source evidence, and provenance.

## MVP

Start narrow. **Domain: Number Theory** — 98 problems (the largest slice), a single strong
backing text (Andrews), a technique set that is compact and machine-checkable
(`modular arithmetic`, `prime factorization`, `induction`), and answers that are usually
explicit values rather than proofs.

Slice:

1. Normalize technique/concept aliases across the existing 492 labeled problems.
2. Extract the Andrews TOC and section structure; attach its exercises to sections.
3. Build the Number Theory ontology subgraph (~60 concept nodes) from Andrews sections plus
   the Princeton Companion for naming.
4. Map the 98 Putnam NT problems' `prerequisites` strings onto those nodes.
5. Build warm-up ladders for 20 target problems; validate technique-subset containment.
6. Run the Qwen 0.6B-8B ladder over both the warm-ups and the targets — verify empirically
   that each rung is easier than the next.
7. Ship it in the existing site as a "Warm up first" panel on the problem view
   (`site/app.js`), alongside the existing progressive hints.

Deliverables: first-pass NT concept graph, problem-to-concept mapping, difficulty tiers,
20 validated ladders, and a diagnostic exam generated from graph coverage.

Success criteria for the slice — decide before building:

- >=80% of NT problems map to >=1 concept node with confidence >=0.7
- >=90% of generated ladders pass the technique-subset validator
- model ladder confirms monotone difficulty on >=70% of rungs
- a human solving a ladder rates the warm-ups "useful for the target" on >=70%

## New Scripts Implied

- `scripts/extract_book_toc.py` — PDF -> `{book, sections[], page_ranges}`
- `scripts/extract_exercises.py` — section page ranges -> exercise statements with ordinals
- `scripts/build_ontology.py` — seed nodes from TOCs + Princeton Companion; alias table
- `scripts/normalize_labels.py` — casing/alias cleanup over `problems.labeled.json`
- `scripts/map_prereqs_to_nodes.py` — free-text prerequisites -> node ids + confidence
- `scripts/build_ladders.py` — ladder construction + technique-subset validator
- `scripts/model_ladder_bench.py` — Qwen 0.6B-8B solve-rate harness
- `scripts/publish_graph_data.py` — mirror of `publish_site_data.py` for graph + ladders

## Risks

| Risk | Mitigation |
|---|---|
| Noisy concept tags | fixed ontology first; confidence scores; review queue |
| False prerequisite edges | require cross-book consensus for high-confidence edges |
| Difficulty reflects formatting, not reasoning | model ladder over multiple phrasings of the same item |
| Warm-ups that don't warm up | deterministic technique-subset validator + human spot-check |
| PDF extraction garbage | the existing B6 formatting bugs are precedent — regression-test extraction per book |
| Graph drift across books | canonical node per concept, book sections map *onto* it rather than defining it |
| Unbacked domains faking rungs | `unbacked: true` flag suppresses generation until a source is acquired |
| Copyright | store section/exercise *pointers* and derived metadata; keep verbatim textbook text local, ship only what is licensed |

## Roadmap

1. Normalize the existing labels and extract the alias table.
2. Build the Number Theory ontology from Andrews + Princeton Companion.
3. Extract TOCs and exercises for the paired sources (Axler/Lay, Pugh/Tao, Blitzstein/Bertsekas).
4. Attach problems to sections; derive prior graph edges; apply cross-book consensus.
5. Build and validate warm-up ladders; ship the "Warm up first" panel.
6. Run the small-model benchmark ladder for empirical difficulty.
7. Merge signals into a weighted concept graph; generate diagnostic exams from coverage.
8. Acquire the gap texts (Herstein first) and extend to Abstract Algebra and Geometry.
9. Add grounded problem generation and variant creation last, inside trusted concept regions.

## Bottom Line

Layered system: textbook and syllabus structure provide the scaffold, LLMs provide extraction
and tagging, cross-book consensus and small-model benchmarking provide validation, and the
warm-up ladder turns a bank of 344 hard problems into something a person can actually climb.
Generation is the last layer, not the foundation.
