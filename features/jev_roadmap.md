# Lattice × Jev — build plan

*2026-09-22. Follows `jev_investigation.md`. All costs and latencies here are measured against
`jev-1.13.0` on Lattice's own corpus unless marked as an estimate.*

---

## The ordering insight

These ideas are not independent, and the dependency runs one way:

```
        (1) corpus tagging  ──┬──> (2) NL practice sets      "master matrix multiplication"
         tags + difficulty    ├──> (3) next-best-set button
         + kind, per exercise ├──> (5) generator attachment
                              └──> (4) contest ingestion reuses the same pass

        (6) grading ──────────────> feeds mastery, independent of the above
```

**Nothing built on top of tags works until the tagging pass exists**, and once it does, the
things above it are mostly ordinary SQL. That is the single most important structural point:
natural-language practice sets are not a Jev-scans-the-corpus feature. Jev parses *the request*
once (measured: 366 ms, $0.000043) and your existing query layer does the filtering against
pre-computed tags. Scanning 4,104 exercises per query would be ~$0.12 and minutes of wall time
per button press — that design does not work and it is not necessary.

Grading (6) is orthogonal and can proceed in parallel.

---

## 1. Corpus tagging — the foundation

**Measured, on 40 real Blitzstein exercises.**

| vocabulary | tok/ex | corpus (4,104) | p50 | zero-tag rate |
|---|---|---|---|---|
| 79 tags, flat | 1,753 | **$0.302** | 391 ms | — |
| 23 tags, domain-gated | 716 | **$0.123** | 377 ms | 6/40 |

81 questions in one request ran at the same latency as one. This is the shape Jev is for.

### But the flat vocabulary is noisy, and the fix matters

On a team-splitting counting problem, the 79-tag battery fired `subgroups (0.74)` and
`groups (0.66)`. The words "split into teams" are doing that, not the mathematics. Gating the
vocabulary to the book's domain makes those tags **structurally unaskable** — and halves the
cost. So:

- **One tag vocabulary per domain**, not one global list. `DOMAINS` in `build_math_graph.py:30`
  already assigns every book a domain; reuse it.
- Ask a tag only where it could plausibly apply. This is free accuracy.

### The remaining gap is vocabulary coverage, not model error

6 of 40 exercises got zero tags. Two examples:

```
blitzstein:1.2  "How many 7-digit phone numbers are possible…"      -> no tags
blitzstein:1.5  "A knock-out tournament with 2n tennis players…"    -> no tags
```

Both are multiplication-principle problems, and "multiplication principle" was not in my
vocabulary. **Do not invent the tag list.** Derive it:

1. Run a cheap open pass first — for a 300-exercise sample, ask a `choice` over a starter
   vocabulary plus an explicit `"none of these"` option.
2. Read the exercises where `"none of these"` wins, by hand, and extend the vocabulary.
3. Repeat until the zero-tag rate is under ~5%, then run the full corpus.

Budget the whole thing at **under $1 including iterations**. The expensive part is your
attention on step 2, not the API.

### What to store

Store **probabilities, not booleans**. `tags` as `{tag: p}`, `difficulty_score` as the raw 0–3
float with its `confidence`. Thresholds then become tunable in SQL without re-running anything,
and a 0.55 tag can be surfaced as "possibly" in the UI rather than silently dropped.

Cache by SHA of the exercise text, so re-extraction and `repair_text.py` fixes only re-tag what
actually changed.

**Effort:** ~1 day plus vocabulary iteration. **Ship it first.**

---

## 2. Natural-language practice sets

**Measured on 5 real phrasings, ~1,018 tokens each, 366 ms, $0.000043 per query:**

```
"I want to master matrix multiplication"
   topics=[matrix multiplication]  difficulty=1.46  length=1.73  kind=computations  weakness=0.07

"get me ready for a probability qualifying exam, focus on the stuff I keep getting wrong
 with conditioning"
   topics=[conditional probability]  difficulty=1.62  length=1.70  kind=computations  weakness=0.58

"something short and easy, I only have 15 minutes"
   topics=(none)  difficulty=0.08  length=0.46  kind=either  weakness=0.11

"I want to practise proofs by induction, not computation"
   topics=[induction]  difficulty=1.02  length=1.10  kind=proofs  weakness=0.21

"harder counting problems where the trick is a bijection"
   topics=[bijection]  difficulty=2.00  length=1.10  kind=computations  weakness=0.16
```

It picked up every axis: the difficulty adverb ("easy" → 0.08, "harder" → 2.00), the time budget
("15 minutes" → length 0.46), the negation ("not computation" → kind=proofs), and — the one that
matters most — **"the stuff I keep getting wrong" → `target_weakness` 0.58**, which is the
signal that tells your code to ignore the named topic filter and hand control to
`mastery.weakEdges()` instead.

### Architecture

```js
// ONE Jev request parses the request. Zero Jev calls touch the corpus.
const spec = await parseRequest(text);   // ~370ms

const filters = {
  tags:       Object.entries(spec.want).filter(([,p]) => p > 0.6).map(([t]) => t),
  kind:       spec.kind.choice,                       // proofs | computations | either
  offset:     [-200, 0, 200, 400][Math.round(spec.difficulty.score)],  // reuse ability.mjs RUNGS
  limit:      [5, 12, 25][Math.round(spec.length.score)],
};

// Weakness overrides a named topic — this is the branch the noul buys you.
const pool = spec.needs_weakness.noul > 0.5
  ? frontier(db, graph, { limit: filters.limit })     // lib/mastery.mjs:161, already written
  : exercisesMatching(filters);                       // plain SQL over the tag columns

return suggest(db, graph, { offset: filters.offset, pool, limit: filters.limit });
```

Almost all of this is code you already have. `suggest` (`ability.mjs:137`) already takes an
explicit offset — that is exactly the hook the difficulty score plugs into. `frontier` already
computes the weakness-driven queue.

**The "next best set" button is the same endpoint with no text** — skip the parse call entirely
and go straight to `frontier` + `suggest`. It costs nothing and needs no model at all. Build the
button first; it is a day of UI over existing logic.

**Failure mode to design for:** a request that names a topic with no tagged exercises behind it
returns an empty set. Detect it and say so — *"nothing tagged `spectral theorem` yet; Axler
ch. 7 is the closest concept"* — rather than silently returning the generic queue. Empty-result
honesty is what makes a natural-language box trustworthy.

**Effort:** ~1 day, after tagging lands.

---

## 3. Real-time suggestion from mastery goals

Mostly **not a Jev feature**. `recommend`, `frontier` and `weakEdges` already do the work
deterministically, and they should stay deterministic — they are the defensible core of the
product and they need to be explainable.

Jev's genuine contribution is the **goal → concept mapping**: "I want to master matrix
multiplication" has to become a set of `concept:` node ids. A `choice` over the concept labels
in the relevant domain does this (the alignment experiment already proved this shape works at
156-option cardinality, p50 385 ms). Everything downstream stays as it is.

---

## 4. Contest ingestion: AMC / AIME / USAMO / IMO

Worth doing, and it fixes a problem the README already names — *"every entry point was a cliff"*.
Putnam sits at the top with 344 of 492 problems marked hard. AMC and AIME are the missing rungs
between textbook exercises and Putnam.

**The important asymmetry:**

| source | answer form | grading |
|---|---|---|
| AMC 10/12 | multiple choice A–E | **exact match, deterministic — no model** |
| AIME | integer 0–999 | **exact match, deterministic — no model** |
| USAMO / IMO / Putnam | proof | needs §6 grading |

AMC and AIME give you thousands of problems with **machine-checkable answers**, which is worth
more than it first appears: it produces the ground-truth set that the grading eval in §6 needs,
and it makes the Elo signal honest with no judgement in the loop at all.

Licensing is also friendlier here than for the textbooks — these are published competition
papers rather than copyrighted course books, but confirm terms per source before committing text
to the repo, and keep the `data/local` split you already have if in doubt.

**Sequencing:** ingest → run the §1 tagging pass over them with a contest-flavoured vocabulary
(`invariants`, `extremal principle`, `symmetry argument` — these already exist in `next.md`'s
"strategy fingerprint" idea) → let `difficulty_prior` come from the tagging score rather than
from a character count → link into the graph the way `link_putnam_to_graph.py` already links
Putnam.

---

## 5. Generators

`site/generators.js` is a clean registry — `G[id] = {id, name, domain, gen(level, rng)}` with
deterministic exact answers. **Do not put Jev inside a generator.** They are correct and free;
there is nothing semantic to add and a working guarantee to lose.

Two places Jev genuinely helps:

**(a) Attaching generators to problems — "drill into this".** After tagging, for each exercise
ask a `choice` over generator ids plus `"no generator drills this"`:

```js
choice("Which drill generator practises the underlying skill this exercise needs?", {
  "mod-power": null, "gcd-lcm": null, "counting": null, /* … */ "none of these": null,
})
```

Closed vocabulary, one request per exercise, foldable into the same tagging pass for a few extra
tokens. The payoff is the button you described: fail a Putnam number-theory problem, get offered
a `mod-power` drill ladder underneath it.

**(b) Finding which generators to write.** Run that same choice across the corpus and count how
often `"none of these"` wins, grouped by tag. The tags with the most unmatched exercises are
exactly the generators worth writing next — a measured backlog instead of a guess.

That is a much better use of the capability than generating problems, because generator
*coverage* is the real gap and nothing currently measures it.

---

## 6. Grading and the editor

Grading is validated at pilot scale and the plan is in `jev_investigation.md` §4A and §5.
Shadow mode first: log `machine_outcome` / `machine_gap` / `machine_conf` on every attempt,
change nothing the learner sees, compare after ~150 real attempts.

**On the editor — it is not a blocker, and I would not build a WYSIWYG one yet.**

- `study.js:687` already has `#freeAnswer`, a textarea with the placeholder *"Write your answer,
  or the key steps of your argument…"*. The input surface exists.
- MathJax is already loaded and configured (`index.html:24`, `app-shell.js:87`).
- The grading pilot was run on **plain-text answers with ASCII maths** (`n^2`, `C(10,3)/2^10`,
  `p^3 (1-p)^7`) and it graded them correctly, including catching circular induction. So
  rendering is not what makes grading work.

The cheap 90% is a **live MathJax preview pane under the existing textarea** — retypeset on a
debounce, ~20 lines, no new dependency. Ship that, use it for the shadow-mode period, and let
the collected attempts tell you whether a real editor (MathLive) is worth the weight. Deciding
that on evidence costs you nothing and defers a large dependency.

---

## Order of work

| # | Item | Depends on | Effort | Cost |
|---|---|---|---|---|
| 1 | "Next best set" button | nothing — existing `frontier`+`suggest` | ~1 day | $0 |
| 2 | Shadow-mode grading + live MathJax preview | nothing | ~2 days | ~$0.50 |
| 3 | Tag vocabulary derivation (sampled, iterative) | — | ~1 day + review | <$1 |
| 4 | Full corpus tagging pass, domain-gated | 3 | ~1 day | **$0.12** |
| 5 | Servability + difficulty from the same pass | 4 | folded in | $0 extra |
| 6 | NL practice-set box | 4 | ~1 day | $0.000043/query |
| 7 | Generator attachment + coverage report | 4 | ~1 day | folded in |
| 8 | AMC/AIME ingestion | extraction work | ~1 week | tagging only |
| 9 | Grading go/no-go from shadow data | 2 | — | — |
| 10 | USAMO/IMO ingestion | 8, 9 | ~3 days | tagging only |

Items 1 and 2 need no tagging and no decisions — start there.

---

## Measured vs assumed

**Measured today:** 81 questions in one request at 391 ms; domain gating cutting corpus tagging
from $0.302 to $0.123; spurious group-theory tags on counting problems under a flat vocabulary;
a 6/40 zero-tag rate traced to vocabulary coverage; NL request parsing across 5 phrasings at
366 ms / $0.000043 including difficulty, length, negation and weakness-targeting.

**Still assumed:** tag precision against hand labels (nothing is hand-labelled yet — the tag
pass needs its own small eval before its output is trusted by the recommender); behaviour of
the tag battery outside probability; contest-source licensing; whether `target_weakness` stays
reliable on phrasings less explicit than "the stuff I keep getting wrong"; everything in
`jev_investigation.md` §9.
