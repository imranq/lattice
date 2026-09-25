# Lattice

**Concepts, partially ordered.**

## Current direction

Lattice is a knowledge map for becoming better at hard mathematics. It turns
books, exercises, generated drills, and personal attempts into one learning
loop:

```text
sources → concepts + prerequisite evidence → problems → attempts
       → mastery, weak prerequisites, and the next useful problem
```

The product should answer five questions: where am I, what can I learn next,
what prerequisite is blocking me, what will this unlock, and what should I do
about it now? Study is the main loop; Graph is the map; Home chooses a useful
session; Stats explains progress.

### Vision

The raw DAG is an implementation detail. The learner should see a semantic map:
domains and topology when zoomed out, prioritized concept labels at mid zoom,
and a selected concept’s local neighborhood at close zoom. Text belongs in the
persistent inspector, which should make prerequisites, next concepts, sources,
mastery, and **Practice this** immediately available. A search for a destination
such as “transformers” should eventually show the shortest actionable path from
the learner’s current mathematics.

### What we are building now

- One graph spanning textbook sources, Putnam, and the MIT-licensed MATH dataset.
- Canonical-source-first extraction: official TeX/Markdown/HTML is preferred over
  PDF text; Mathpix and targeted vision repair are fallbacks for books without a
  reliable machine-readable source.
- Difficulty ladders and semantic tags, so “basic probability” selects genuinely
  accessible material instead of ranking by statement length.
- Adaptive Study, warm-up ladders, spaced repetition, assessments, mastery, and
  weak-edge diagnosis.
- Deterministic search, exact-answer grading, and generated mental-math drills;
  “2x2 multiplication mental math” routes to `multiply-2x2`.
- A graph with semantic zoom, a persistent inspector, selected-neighborhood
  emphasis, frontier/mastery states, and graph-to-Study actions.

### Jev contract

Jev is a typed routing and reasoning service, not the corpus and not the grader
of everything. It parses practice requests into generated skills, tags, domains,
difficulty, length, and intent; it shadow-grades proofs and written solutions;
and it targets extraction repair and semantic tagging. Jev does not rescrape
pages: vision-capable extraction repairs flattened notation, while Jev identifies
what needs attention.

Exact answers bypass Jev. Code normalizes fractions, decimals, percentages, and
boxed answers because that is faster, cheaper, auditable, and more reliable than
asking a model to compare `30%` with `3/10`. Free-form reasoning remains the
place where Jev can add value, with confidence and an audit trail, without
silently overriding the learner’s own mark.

### Roadmap

**Now:** finish MATH ingestion/tagging; broaden deterministic checking; make
mental-math routing and generators excellent; complete the graph inspector and
semantic zoom; visually verify the Study UI.

**Next:** per-technique mastery and focus areas; Jev calibration from shadow-log
evidence; solution-aware feedback; frontier and “show me why” paths; stronger
cross-book alignment and repaired text.

**Later:** computation/ML destinations; aggregated overview edges; mobile graph
bottom-sheet inspection; shareable concept URLs and paths; stronger test-out.

The governing rule is: understand the learner → choose the right rung → ask for
an answer → grade with the least powerful reliable method → update the next step.
When neither code nor Jev is trustworthy, abstain and ask a better question.

Lattice builds a prerequisite graph from mathematics textbooks, attaches problems to the
concepts they exercise, and uses your own attempt history to work out what you actually know
— and, more usefully, which missing prerequisite is blocking you.

```text
textbook sources (LaTeX + PDF)
→ sections, exercises, page references, cross-references
→ concept graph (prerequisite DAG, confidence-scored, cross-book aligned)
→ problems attached to concepts, tiered W1 → W2 → core
→ practice: warm-up ladders, generated drills, spaced repetition
→ mastery per concept, and the weak *edge* that explains it
```

## Why

The Putnam bank this started as held 492 problems, of which 344 are `hard` and exactly one is
`easy`. Every entry point was a cliff. Lattice supplies the rungs from real textbook
exercises, ordered by a prerequisite graph rather than by topic label.

## What's in the graph

**16,509 exercises · 698 nodes · 18,816 edges · 14 domains**

| Book | Domain | Extraction | Exercises |
|---|---|---|---|
| Herstein, *Abstract Algebra* | abstract algebra | pdf, inline | 765 |
| Grinstead & Snell, *Introduction to Probability* | probability | **LaTeX source** | 705 |
| Blitzstein & Hwang, *Introduction to Probability* | probability | pdf, block | 640 |
| Pugh, *Real Mathematical Analysis* | real analysis | pdf, inline | 392 |
| Tao, *Analysis I* | real analysis | pdf, labelled | 320 |
| Axler, *Linear Algebra Done Right* | linear algebra | pdf, inline | 222 |
| Stein & Shakarchi, *Complex Analysis* | complex analysis | pdf, inline | 191 |
| Andrews, *Number Theory* | number theory | **OCR** + pdf, inline | 175 |
| Zhang et al., *Dive into Deep Learning* | machine learning | official Markdown + LaTeX, stable PDF ids | 740 |
| Murphy, *Probabilistic Machine Learning* | machine learning | local PDF, exercise labels | 66 |
| Bishop, *Deep Learning: Foundations and Concepts* | machine learning | local PDF, exercise labels | 227 |
| Putnam archive 1985–2025 | contest | LaTeX source | 492 |

Andrews had no text layer at all — it is a scan. `ocrmypdf` recovered it cleanly enough
(noise 3.9/1000 chars) to extract 175 exercises; the OCR'd PDF lives in `data/local/ocr/`.

Not yet in: Bertsekas, Lay and Steele parse as text but need their own extraction profiles.

## Licensing

Only sources whose terms permit redistribution are copied into the repository. For every
other book Lattice commits **pointers and derived metadata only** — chapter, section, page, topic
group, difficulty tier:

```json
{"id":"blitzstein:1.8","chapter":1,"page":34,"group":"Counting",
 "has_published_solution":true,"has_multipart":true,"n_chars":234}
```

Verbatim exercise text is written to `data/local/`, which `.gitignore` excludes. It is for
personal use on the machine that owns the book.

## Pages

One page, a topbar, three views (`site/index.html` + `app-shell.js`). Only Study carries a
sidebar; Home and Graph take the full width.

| View | What it does |
|---|---|
| **Home** | where you are and what to do today: streak and counts, the recommended schedule, a simplified subject map, weak-edge diagnosis |
| **Subject** | one field: its books, their chapters, and every topic with mastery, page reference and problem count |
| **Study** | one problem at a time, chosen at the edge of your ability — due reviews first, then textbooks, Putnam and generated drills in one queue. Practice runs endlessly; Test fixes a length and scores it. A hard problem offers its warm-up ladder underneath. |
| **Graph** | the concept graph as a partial order, one card per source, with learning plans |
| **Stats** | activity, level by field, coverage against its denominator, weakest concepts, review queue, sources |

## Cadence

Lattice is a **connected app** in Cadence. Two halves, and they are independent:

1. **Registration.** Cadence reads Switchboard's `apps.json` and treats an app as a producer
   when it declares an `activity` block. Lattice declares `{"kinds": ["attempt"], "unit":
   "problem"}` plus a launch URL, which is what makes it appear in Cadence's connected apps.
2. **Measurement.** Every graded attempt appends one line to the machine-wide activity log at
   `~/.local/share/activity/events.jsonl` (`$ACTIVITY_LOG` to move it):

   ```json
   {"at":"…","app":"lattice","kind":"attempt","ok":true,"domain":"probability","id":"grinstead_snell:exer_3.2.5","seconds":180}
   ```

   A Cadence card timing a Lattice block is then measured by what Lattice actually recorded in
   that window — no self-reporting, no API between the two apps, just a file and a clock. The
   nine-line writer is reimplemented in `lib/activity.mjs` rather than imported across
   checkouts, as Switchboard's own README suggests.

Lattice knows what to study and for how long; [Cadence](../cadence) runs timed sequences.
**Send to Cadence** on Home writes today's plan into `content/sessions/lattice-today.json` as
a playable session — a warm-up block, a review block when items are due, and a block on your
weakest field, each a `render: "site"` card that opens Lattice already filtered. Cadence's own
validator accepts it. Point `CADENCE_DIR` elsewhere if your checkout is not at
`~/projects/cadence`.

## Adaptive difficulty

Study does not shuffle. Every attempt is scored as an **Elo match between you and the
problem**, which estimates your skill and the problem's difficulty at the same time — the
approach [Pelánek surveys for educational systems](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf),
robust at the sample sizes one learner produces where IRT needs hundreds of students.
Ratings are kept **per field**, so being strong in probability does not inflate what you are
handed in algebra.

The target is the [Eighty Five Percent Rule](https://www.nature.com/articles/s41467-019-12552-4)
(Wilson et al., *Nature Communications* 2019): learning is fastest at roughly 85% accuracy.
On the logistic scale that is a problem rated ~301 points below you, which is what the queue
aims at — `fit` ranks candidates by distance from that point, softened by how well you hold
the concept's prerequisites.

Every question takes an answer. Generated drills are checked automatically. Textbook and
contest problems get a free-text box and a **Copy for review** button that puts the problem,
your answer and the official solution (where the archive has one) on the clipboard, so an AI
can mark it — then you record the verdict. No string comparison can mark a proof, and
pretending otherwise would feed the ability estimate noise it would never shake off.

## Run

```bash
npm start            # http://127.0.0.1:4115 (PORT respected; Switchboard sets it)
npm run dev          # same, with --watch
```

Zero dependencies — `node:sqlite` is built into Node ≥22.5. The site also opens as plain
static files; the memory layer detects an unreachable API and hides itself.

## Pipelines

```bash
bash scripts/fetch_books.sh          # LaTeX sources into data/raw/books/ (gitignored)
python3 scripts/probe_books.py <pdf>…  # which books can be extracted, and how

# LaTeX-source books
python3 scripts/extract_book_tex.py --src data/raw/books/grinstead_snell \
  --book-id grinstead_snell --title "Introduction to Probability" --license GFDL

# PDF books — three item profiles and three TOC profiles, see --help
python3 scripts/extract_book_pdf.py --pdf ~/papers/blitzstein.pdf --book-id blitzstein \
  --title "Introduction to Probability" --item-style block
python3 scripts/extract_book_pdf.py --pdf "~/papers/Algebra - Herstein.pdf" \
  --book-id herstein --title "Abstract Algebra" --item-style inline --toc-style indent
python3 scripts/extract_book_pdf.py --pdf ~/papers/tao.pdf --book-id tao \
  --title "Analysis I" --item-style labelled

python3 scripts/build_math_graph.py --books data/processed/books/*.json
python3 scripts/link_putnam_to_graph.py --topics Probability Combinatorics --primary-topic-only

# Canonical D2L Markdown/LaTeX source; existing exercise ids and attempts stay stable
git clone --depth 1 --filter blob:none https://github.com/d2l-ai/d2l-en.git /tmp/d2l-en
python3 scripts/import_d2l_source.py --source /tmp/d2l-en --allow-partial
python3 scripts/build_math_graph.py --books data/processed/books/*.json
```

`import_d2l_source.py` matches official exercises within their legacy chapter,
replaces only confidently matched local text, and records the canonical source
path and URL. Unmatched exercises retain their prior text when the upstream
book edition has changed. This is the preferred path for mathematical notation:
the source preserves LaTeX instead of flattening it into PDF glyphs.

### Extraction profiles

Books agree on nothing, so the extractor carries profiles rather than heuristics.

| Item style | Shape | Books |
|---|---|---|
| `block` | number alone on a line, TOC-driven regions | Blitzstein |
| `inline` | numbered items after a Problems/Exercises heading | Herstein, Pugh, Axler, Stein |
| `labelled` | `Exercise 2.2.1.` carrying its own numbering | Tao |

| TOC style | Shape |
|---|---|
| `leaders` | `1.9 Exercises . . . . 33` |
| `indent` | indentation, sections renumbered per chapter |
| `chapter-line` | `Chapter 1` with the title on the next line |

When all three fail, chapters are recovered from the running head printed on each page.

### Prerequisite evidence

| Evidence | Confidence | Signal |
|---|---|---|
| `cross_reference` | 0.85 | an exercise `\ref{}`s an earlier section |
| `cross_book_consensus` | 0.75 | two authors give a concept the same name |
| `term_reuse` | 0.55 | an index term introduced earlier is used here |
| `textbook_order` | 0.40 | adjacent sections (weak prior) |

Combined by noisy-OR, so independent evidence compounds and a lone weak prior stays weak.

## Practice memory

State lives in SQLite at `data/lattice.db` (gitignored — personal history).

- **Attempt log** — outcome, seconds, hints used, per problem/exercise/drill
- **Spaced repetition** — SM-2; hints lower the effective grade
- **Concept mastery** — recency-weighted (0.85 decay), shrunk toward 0.5 by attempt count
- **Weak-edge diagnosis** — when a concept *and* its prerequisite are both weak, Lattice
  names the edge: "fix Permutations before Combinations"
- **Learning plans** — topological path to any concept, pruning what you have mastered

### API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/graph` | nodes and edges |
| GET | `/api/mastery`, `/api/coverage` | per-concept and per-domain |
| GET | `/api/weak-edges`, `/api/recommend` | diagnosis and next steps |
| GET | `/api/stats`, `/api/activity`, `/api/books` | progress page data |
| GET | `/api/due`, `/api/ladder/:id`, `/api/exercises?concept=` | queues and pointers |
| POST | `/api/attempt`, `/api/star`, `/api/view` | record |

## Known limitations

- **Putnam↔graph matching is lexical** and imprecise; generic labels absorb too many
  problems. Wants an embedding or LLM pass — the same ceiling applies to cross-book
  alignment, where "Sums of Discrete Random Variables" still aligns to "Random variables".
- **Coverage is thin.** Most concepts have no attempts, so most mastery numbers are absent
  rather than low. The progress page states this rather than hiding it.
- **OCR'd sources are noisier.** Andrews' chapter titles arrive with dot-leader debris, and
  85 of its exercises came out as unreadable glyph soup. Each exercise carries a `garble`
  score; the filter applies it only to OCR sources, because digital text from Tao or Herstein
  is legitimately symbol-dense and would otherwise be hidden too. Chapters 4, 6 and 8 yielded
  no exercises.
