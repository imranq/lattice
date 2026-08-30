# Lattice

**Concepts, partially ordered.**

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

**3,235 exercises · 441 nodes · 3,604 edges · 5 domains**

| Book | Domain | Extraction | Exercises |
|---|---|---|---|
| Herstein, *Abstract Algebra* | abstract algebra | pdf, inline | 765 |
| Grinstead & Snell, *Introduction to Probability* | probability | **LaTeX source** | 705 |
| Blitzstein & Hwang, *Introduction to Probability* | probability | pdf, block | 640 |
| Pugh, *Real Mathematical Analysis* | real analysis | pdf, inline | 392 |
| Tao, *Analysis I* | real analysis | pdf, labelled | 320 |
| Axler, *Linear Algebra Done Right* | linear algebra | pdf, inline | 222 |
| Stein & Shakarchi, *Complex Analysis* | complex analysis | pdf, inline | 191 |
| Putnam archive 1985–2025 | contest | LaTeX source | 492 |

Not yet in: **Andrews, *Number Theory*** is image-only (no text layer) and needs OCR;
Bertsekas, Lay and Steele parse as text but need their own extraction profiles.

## Licensing

Only Grinstead & Snell (GFDL) and the Putnam archive are redistributable. For every other
book Lattice commits **pointers and derived metadata only** — chapter, section, page, topic
group, difficulty tier:

```json
{"id":"blitzstein:1.8","chapter":1,"page":34,"group":"Counting",
 "has_published_solution":true,"has_multipart":true,"n_chars":234}
```

Verbatim exercise text is written to `data/local/`, which `.gitignore` excludes. It is for
personal use on the machine that owns the book.

## Pages

| Page | What it does |
|---|---|
| `index.html` | the Putnam bank: search, filter, hints, warm-up ladder per problem |
| `graph.html` | the concept graph as a partial order, with learning plans |
| `practice.html` | 16 generated drill skills, 5 levels each |
| `progress.html` | coverage, mastery, gaps, activity, sources |

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
```

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
- Number theory has no textbook backing until Andrews is OCR'd.
