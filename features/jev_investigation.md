# Jev in Lattice — investigation

*2026-09-22. Everything under "Measured" was run against `api.typesafe.ai/v1/systemone`
(`jev-1.13.0`) on Lattice's own corpus. Scripts are in the session scratchpad, not the repo.
Total API spend for this investigation: **under $0.02**.*

---

## 0. Verdict first

This is consequential for Lattice, but not for the reason a cost-reduction pitch would suggest.
Lattice barely spends anything on models today — one Gemini batch job labelling 492 Putnam
problems, and an on-demand OCR repair script. There is almost no LLM bill to cut.

The leverage is that **Lattice is a semantic product built almost entirely out of
non-semantic proxies**, because semantic judgement was too slow and too expensive to put in
the hot path. Three of its load-bearing mechanisms are string heuristics standing in for
meaning:

| Mechanism | What it should be | What it is | Measured consequence |
|---|---|---|---|
| Cross-book alignment | "these two sections teach the same thing" | Jaccard ≥ 0.5 over title tokens (`build_math_graph.py:273`) | **19 `aligns_with` edges** across 484 nodes and 9 books |
| Servable exercise | "a student can actually attempt this" | `garble_score` char-class ratio (`extract_book_pdf.py:167`), hard filter at 0.3 (`ability.mjs:183`) | **32% of what it serves is unusable**; it rejects clean LaTeX |
| Attempt outcome | "did they get it right" | a button the learner presses (`study.js:811`) | the entire Elo / mastery / level ladder rests on self-report |

Jev makes all three affordable to do properly, and the third one — grading — is not a cost
saving at all. It is a capability Lattice does not currently have and cannot get any other way.

---

## 1. What Lattice is and where the money and the compromises are

**Goal.** Build a prerequisite DAG over mathematics from real textbooks, attach 4,104
exercises to concepts, and use an attempt log to name *the weak prerequisite edge* that
explains a failure. The differentiator over topic-bucket practice apps is the graph and the
edge diagnosis (`lib/mastery.mjs:61`).

**Current model spend.**

- `scripts/label_topics_gemini.py` (880 lines) — Gemini batch, generate-JSON-then-`extract_json`,
  17 fields per problem. Delayed batch, with a `recover_batch_outputs.py` companion for when
  it half-fails. Covers **Putnam only (492 problems)**. The 3,410 textbook exercises are
  unlabelled — a coverage limit set by effort and budget, not by lack of value.
  (Aside: `build_prompt` has an unreachable tail — it `return`s before the
  `include_solution_context` block at line ~110, so solution context is never appended.)
- `scripts/repair_text.py` — renders a PDF page and asks Gemini/OpenAI for a transcription.
  Run manually. **10 exercises repaired in Andrews, out of 175.**

Everything else in the product — recommendation, frontier, assessment construction, difficulty
priors, the graph itself — is deterministic code over those two thin semantic inputs.

**Where information is discarded.**

- `ability.mjs:49` — `skipped` attempts "carry no information" and are dropped from the Elo.
  A skip after 4 minutes on a stretch problem is not the same event as a skip after 3 seconds,
  and both are thrown away.
- `ability.mjs:183` — 613 of 2,907 scored exercises are excluded from ever being served.
- `attempt.note` is a free-text column that nothing ever reads.
- `difficulty_prior` (`build_math_graph.py:61`) is derived from tier hints and character counts.
- `CONF` (`build_math_graph.py:50`) assigns `term_reuse` a flat 0.55 — token overlap standing in
  for "is a prerequisite of".

---

## 2. Measured results

### 2.1 The interface, confirmed

`POST /v1/systemone` with `{model, state, questions}`. `score` criteria is a **list**, not a map
(the docs' map form returns 422); levels come back 0-indexed with a `legend`. `noul` returns a
bare probability, `choice` and `score` add `confidence` plus a full distribution. Output tokens
are billed at zero; input is $0.042/MTok.

### 2.2 Batching really is close to free in latency — cost is linear in question text

Same state, questions added:

| questions | p50 latency | input tokens | cost/req |
|---|---|---|---|
| 1 | 352 ms | 388 | $0.000016 |
| 6 | 417 ms | 573 | $0.000024 |
| 16 | 360 ms | 948 | $0.000040 |
| 31 | 390 ms | 1,518 | $0.000064 |
| 61 | 356 ms | 2,658 | $0.000112 |
| 121 | 513 ms | 4,958 | $0.000208 |

Flat to ~60 questions, then it starts to bend. **Questions are not free — they are free in
*time*, and linear in *money*.** The right mental model is: one network round trip buys you an
unlimited number of judgements about one state, and you pay per word of question text.

Independently: on the 175-exercise Andrews run, 1 question p50 = 367 ms and 7 questions
p50 = 366 ms, for +32% tokens.

### 2.3 Determinism and wording robustness

Same request five times: `0.96, 0.96, 0.96, 0.96, 0.96` — bit-identical. Rephrasing held:
plain `0.96`, terse `0.96`, with explicit `criteria` `0.97`, and the **negated** form returned
`0.04` — a proper complement, not a coin flip. This matters: it means the scores are stable
enough to threshold on and to cache by content hash.

### 2.4 Cross-book alignment — the biggest single measured win

Blitzstein (156 concept nodes) against Grinstead & Snell (35), as **one `choice` over 36
options per Blitzstein node** rather than 5,460 pairwise comparisons.

```
5,460 conceptual pairs covered by 156 requests
wall 8.0 s at 8 workers | p50 385 ms, p90 475 ms, max 761 ms
121,181 input tokens -> $0.0051
67 alignments proposed, 0 errors
```

Against a baseline of **19 `aligns_with` edges in the entire shipped graph.**

High-confidence output is correct:

```
0.98  Definition of expectation             -> Expected Value of Discrete Random Variables
0.96  Conditioning on evidence              -> Discrete Conditional Probability
0.96  First-step analysis and gambler's ruin-> Gambler's Ruin
0.93  Variance                              -> Variance of Discrete Random Variables
```

The low-confidence tail is the interesting part — it is not wrong, it is *genuinely ambiguous*:

```
0.25  Markov property and transition matrix -> Ergodic Markov Chains
0.29  Markov property                       -> Absorbing Markov Chains
```

Blitzstein's single "Markov property" section really does span both of Grinstead & Snell's.
Confidence is tracking real ambiguity rather than error. Caveat: with 36 options, probability
mass spreads, so absolute confidence numbers are not comparable across questions with different
cardinality — threshold per question shape, not globally.

### 2.5 Servability — the heuristic is not merely coarse, it is anti-correlated

All 175 Andrews exercises (OCR'd scan), one noul each, vs the shipped `garble > 0.3` filter:

```
excluding the 10 already-repaired items (n=165):
  garble rejects, Jev says fine    (rescued): 11
  garble passes,  Jev says unusable (caught): 58
  disagreement: 42%

of the 90 exercises the heuristic currently lets through,
Jev calls 29 (32%) near-certainly unusable (noul < 0.2)
```

The failure mode is visible in the examples. This **passes** the filter at garble 0.24:

```
"Prove that\n\n)\n4+orgge+.. tn2— eters\n6"
```

and this is **rejected** at garble 0.51:

```
"Prove that\n\n$$1^3 + 2^3 + 3^3 + \\ldots + n^3 = (1 + 2 + 3 + \\ldots + n)^2.$$"
```

A character-class scorer reads `\`, `$` and `{` as noise, so it penalises exactly the text that
`repair_text.py` just fixed, and it cannot see that `orgge` is not mathematics. `repair_text.py`
already knows this (its comment at line 163 says so) and works around it with `math_loss`, a
second regex heuristic. Both can be replaced by one question.

### 2.6 Grading free-text attempts — the capability Lattice does not have

14 hand-authored (problem, student attempt) pairs, labelled correct / partial / wrong by me,
covering induction, divisibility, binomial probability, linearity of expectation, and
irrationality. Four questions per attempt: a `correct` noul, a `right_idea` noul, a 4-level
`grade` score, and a 7-option `gap` choice.

```
p50 395 ms | 630 input tokens per grade | $0.0265 per 1,000 grades
3-way agreement with hand labels: 12/14
noul "correct" on truly-correct: 0.96 0.95 0.95 0.98 0.94 0.92
noul "correct" on truly-wrong:   0.04 0.24 0.02 0.08 0.09
```

Both misses were my "wrong" scored as its "partial" (1.21 and 1.83 on a 0–3 scale) — and in
both cases the `gap` choice named the actual defect ("an arithmetic or algebraic slip",
"a wrong theorem or wrong formula was applied"). These are label-boundary disagreements, not
comprehension failures. The binary `correct` noul separated cleanly at every threshold in
[0.3, 0.9].

It also caught the two traps that separate a grader from a string matcher:

- a correct *answer* reached by circular induction → `grade` 2.34, `gap` = "circular or assumes
  what is to be proved"
- checking n = 1,2,3 and declaring the general case → `grade` 0.92, `gap` = "verified examples
  instead of proving the general case"

**n = 14, authored by me, elementary problems.** This is a pilot, not a benchmark. It is enough
to justify building the eval in §5, and not enough to ship on.

---

## 3. What was expensive, and what changes

| Assumption baked into the architecture | Why it is there | What replaces it | User-visible result |
|---|---|---|---|
| A concept is a section heading; sameness is token overlap | pairwise semantic comparison was O(n²) model calls | one `choice` per node over the other book's sections, 255-option ceiling | the graph becomes one graph instead of nine parallel ones; "you already know this from Blitzstein" |
| Readability is a character statistic | judging 4,104 exercise texts was a batch job | one `noul` at extraction time, cached by text hash | the 32% junk rate in served problems goes to near zero; ~613 excluded exercises get re-adjudicated |
| Outcome is what the learner says it is | grading maths needs a frontier model in the loop | `noul` + `score` + `gap` `choice` on a typed answer | honest mastery, and *why* you missed it |
| Difficulty is a character count | no per-exercise semantic pass | a 4-level `score`, corpus-wide | the Elo starts from a real prior instead of 0.65 |
| Only Putnam is labelled | Gemini batch, 17 fields, delayed, fragile | 4,104 exercises × ~700 tok ≈ **$0.12 for the whole corpus** | search, similar-problems, technique heatmap — the whole "Advanced" section of `next.md` — become possible |
| `skipped` carries no information | no way to interpret a note | grade whatever was written before the skip | a 4-minute skip becomes a signal, not a hole |

The last one is the general shape of it: **Lattice throws away everything it cannot parse.**

---

## 4. The three strongest opportunities

### A. Semantic grading in the study loop — *new capability*

**Problem.** Every number in Lattice's mastery model descends from a button the learner presses
about their own work. Self-grading is optimistic under exactly the conditions where the signal
matters most, and it cannot distinguish "right answer, broken proof" from "right".

**Integration point.** `site/study.js:811 record(outcome, given)`. There is already a `given`
field and a free-answer textarea; today `expected` is non-null only for generated drills.
Server side: a new `POST /grade` in `server.mjs` beside `/attempt`.

**Input state.** Problem text (from `data/local`, on the machine that owns the book), the
learner's typed attempt, `seconds`, `hints_used`, and the concept label.

**Request shape** (one request, all questions independent):

```js
const r = await client.systemOne({
  state: {
    problem: problemText,
    concept: "Expected value of discrete random variables",
    student_attempt: given,
    time_spent_seconds: seconds,
    hints_revealed: hintsShown,
  },
  questions: {
    correct:    noul("Is the student's attempt a correct and complete solution?", {
      true:  "Valid reasoning reaching the required conclusion with no gap that changes the result.",
      false: "A logical error, an unjustified step that carries the argument, or no conclusion.",
    }),
    right_idea: noul("Does the attempt use a method that would work if carried out properly?"),
    grade: score("How much of this problem has the student actually solved?", [
      "nothing usable, or the method is fundamentally wrong",
      "right method identified but the argument does not get there",
      "essentially right with a gap or an unjustified step",
      "a complete and correct solution",
    ]),
    gap: choice("What is the main thing wrong with the attempt?", {
      "nothing — it is correct": null,
      "circular or assumes what is to be proved": null,
      "verified examples instead of proving the general case": null,
      "an arithmetic or algebraic slip": null,
      "a wrong theorem or wrong formula was applied": null,
      "the argument stops before the conclusion": null,
      "missing a case or a condition": null,
    }),
    // free riders: same round trip, ~200 extra tokens
    prereq_gap: noul("Does the error indicate a missing prerequisite rather than a slip in this concept?"),
    gave_up:    noul("Did the student stop because they did not know how to proceed, rather than running out of patience?"),
  },
});
```

**Consumer.**

```js
const a = r.answers;
const outcome =
  a.correct.noul > 0.85 ? "solved"
  : a.grade.score >= 1.2 ? "partial"
  : a.right_idea.noul > 0.6 ? "partial"
  : "failed";
const confident = a.grade.confidence > 0.6 && Math.abs(a.correct.noul - 0.5) > 0.35;
// Abstain rather than overrule: the learner's own mark stays authoritative
// until the calibration study in §5 says otherwise.
const graded = confident ? outcome : null;
db.logAttempt({ ...base, outcome: graded ?? learnerMark, machine_outcome: outcome,
                gap: a.gap.choice, gap_conf: a.gap.confidence });
// `prereq_gap` feeds weakEdges() directly — today it infers prerequisite weakness
// from *which* concepts fail; now it can read it off the failure itself.
```

**Stays outside Jev.** Writing the explanation of the mistake is generation — a Claude call,
made only when `gap.confidence` is high and the learner asks. Jev decides *whether* to offer it
and *what it would be about*, which turns an always-on expensive call into a rare targeted one.

**Effort.** ~1 day for the endpoint and shadow logging; the UI already has the textarea.
**Benefit.** The mastery model becomes evidence-based, and `weakEdges` gets a direct signal
instead of an inference.
**Worst failure.** Marking a correct-but-unusual proof wrong. That is a demoralising,
trust-destroying error and it is *asymmetric* — a false "failed" is much worse than a false
"solved". Hence: shadow mode first, abstain on low confidence, and never let the machine
overrule an explicit learner mark without showing the `gap` and offering an appeal.

---

### B. Cross-book alignment and prerequisite edges — *better outcomes, measured*

**Problem.** The README promises "cross-book aligned". The graph has 19 alignment edges.
Nine books are effectively nine disconnected graphs, so Lattice cannot tell you that the
Blitzstein section you are stuck on is the Grinstead & Snell section you finished last week.
Prerequisite edges are hardly better: 310 of 336 come from `textbook_order`, i.e. "the next
section in the book", which is sequence, not dependency.

**Integration point.** `scripts/build_math_graph.py` — `align_across_books` (line 273) and the
`CONF` priors (line 50). Offline, so no latency budget at all.

**Two passes, genuinely dependent — this is the one place ordering matters.**

Pass 1, alignment. Per source node, one request:

```js
{ state: { book_a, section_a: {number, title, chapter}, book_b },
  questions: {
    match: choice("Which section of book B teaches the same concept as section_a?", candidates),
    is_core: noul("Is section_a a substantive mathematical topic rather than front matter or a recap?"),
  } }
```

Candidates are pre-blocked by domain, which keeps cardinality well inside the 255 ceiling
(largest book here has 156 concept nodes).

Pass 2, confirmation — only for `match.confidence` in [0.35, 0.9], where pass 1 is unsure.
This pass *needs* pass 1's output, because its state contains the proposed pair:

```js
{ state: { a: {book, title, chapter}, b: {book, title, chapter} },
  questions: {
    same: noul("Do these two sections teach the same mathematical concept?"),
    a_prereq_b: noul("Must a student understand section A before section B is approachable?"),
    b_prereq_a: noul("Must a student understand section B before section A is approachable?"),
    relation: score("How close are these two sections?", [
      "unrelated", "same broad area only", "strongly overlapping", "the same concept"]),
  } }
```

`a_prereq_b` and `b_prereq_a` asked *independently* is the right decomposition, not a single
"which comes first" choice: asking both lets the code detect the mutually-high case
(co-requisites, which exist in maths and should not become a DAG edge) and the mutually-low
case (merely adjacent), instead of forcing a direction that may not exist. Write an edge only
when one is > 0.7 and the other < 0.3. That is the entity-alignment cookbook's three-tier
shape: merge / review / leave, no arbitrary single threshold.

**Cost, extrapolated from the measured run.** 484 concept nodes, ~780 tok/request, domain
blocking means roughly 3–4 candidate books each: ≈ 1,800 requests ≈ 1.4 M tokens ≈ **$0.06**,
~4 minutes wall at 8 workers. Pass 2 on maybe 500 borderline pairs adds ~$0.02.

**Effort.** ~1 day inside the existing build script. It runs offline, it is deterministic, and
its output is reviewable as a diff on `math.json`.
**Worst failure.** A wrong prerequisite edge is worse than a missing one — it sends a learner
to study something irrelevant and, through `weakEdges`, blames the wrong concept for a failure.
Hence the two-sided prerequisite test and the mandatory human pass over the middle tier before
any of it lands in the committed graph.

---

### C. One semantic pass over the whole corpus, at extraction time — *direct saving and coverage*

**Problem.** Two unrelated brittle scorers (`garble_score`, `math_loss`) decide what a learner
ever sees, and they are wrong 42% of the time on OCR'd text. Separately, 3,410 textbook
exercises carry no labels at all because the Gemini pipeline was too much work to extend past
Putnam.

**Integration point.** `scripts/extract_book_pdf.py:317` / `:546`, where `garble` is computed.
One request per exercise, at extraction, cached by SHA of the text.

```js
{ state: { exercise_text: text, source: "scanned number theory textbook, OCR'd" },
  questions: {
    servable:  noul("Complete, readable exercise a student could attempt as-is?", {...}),
    math_intact: noul("Are the mathematical expressions intact rather than flattened or missing?"),
    truncated: noul("Does the text stop mid-sentence or run into unrelated body text?"),
    needs_figure: noul("Does the exercise refer to a figure or diagram that is not in the text?"),
    proof:     noul("Does this ask for a proof rather than a computed value?"),
    multipart: noul("Does this have multiple labelled parts?"),
    difficulty: score("How demanding for a student who just read the section?", [...4 levels...]),
    topic:      choice("Which area does this mainly exercise?", {...}),
    technique:  choice("What is the main technique?", {...}),
  } }
```

Nine questions, one round trip, ~900 tokens. **4,104 exercises ≈ 3.7 M tokens ≈ $0.16 for the
entire corpus**, ~9 minutes wall at 8 workers.

**Consumer.**

```js
// replaces ability.mjs:183 and the whole garble/math_loss apparatus
const servable = e.servable > 0.6 && e.math_intact > 0.5 && e.truncated < 0.4;
// replaces difficulty_prior()'s character-count guess
const prior = 0.35 + 0.2 * e.difficulty_score;   // score is 0..3
// repair_text.py's target list becomes: servable low, math_intact low, and a PDF page exists
const worthRepairing = e.servable < 0.5 && e.needs_figure < 0.3;
```

`needs_figure` is worth calling out: nothing in Lattice currently detects it, and an exercise
whose figure was never extracted is unanswerable no matter how clean its characters are.

**Effort.** Half a day. It *deletes* `garble_score`, `math_loss`, and most of
`repair_text.py:load_targets`.
**Worst failure.** Over-strict servability quietly shrinks an already-thin corpus for the small
books (Pugh has 6 concept nodes). Mitigation: keep the raw probabilities in the graph rather
than a boolean, so the threshold is tunable without a re-run, and report per-book retention
before adopting.

---

## 5. The evaluation that could prove this wrong

**Grading (A) — the one that actually needs proving.**

- *Inputs.* 150 real attempts, collected in shadow mode over ~3 weeks of the owner's own
  practice, stratified across the six domains and across correct/partial/failed as the learner
  marked them. Hold out 50.
- *Labels.* The owner re-grades all 150 blind, weeks later, without seeing either mark. That
  is the ground truth; the in-the-moment button press is a *baseline*, not truth.
- *Baselines.* (1) the learner's own button, (2) exact-match on drills where an `expected`
  answer exists, (3) a single Claude Haiku call asked to return `{correct, gap}` — this is the
  credible alternative and the comparison that matters, since it costs maybe 30× more and
  ~2 s instead of 400 ms, and may well be more accurate on hard proofs.
- *Metrics.* Cohen's κ against blind re-grade. Separately and more importantly: **false-failed
  rate on genuinely-correct attempts**, which should be under 2%, because that is the error
  that makes someone stop using the product. False-solved is cheap by comparison — spaced
  repetition will surface the concept again.
- *Calibration.* Reliability diagram for the `correct` noul in 10 bins. The pilot's clean
  separation (0.92–0.98 vs 0.02–0.24) is suspicious in a good way — it suggests the model is
  confident, not that it is calibrated. If there is no populated middle, thresholding is
  trivial but abstention is impossible, and abstention is the whole safety story.
- *Adversarial.* Empty answers; "I don't know"; a correct answer in a different valid style
  (combinatorial vs generating-function proofs of the same identity); a confident wrong proof;
  a proof that cites a theorem by name without proving it; a genuinely novel correct approach.
- *Abstention.* Sweep the confidence gate and report the accuracy/coverage curve. Ship the
  point where false-failed ≤ 2%, whatever coverage that buys.
- *Go / no-go.* Ship auto-grading only if κ ≥ 0.7 against blind re-grade **and** false-failed
  ≤ 2% at ≥ 60% coverage. Otherwise ship it as an advisory second opinion next to the buttons —
  which is still worth having, and is how it should launch regardless.

**Alignment (B).** Owner hand-labels 200 sampled Blitzstein × Grinstead pairs (both are
probability books, both are known to him). Metrics: precision at confidence ≥ 0.7 must be
≥ 0.9, since a wrong merge corrupts `weakEdges`; recall is secondary. Baseline: the current
Jaccard rule, which on this pair produces a handful of edges. Sensitivity test: shuffle the
candidate list order and re-run — the answer must not move.

**Servability (C).** Owner labels 100 Andrews exercises servable / not, blind to both scores.
Report the ROC for `garble` and for the noul on the same 100. Go if the noul's AUC beats
`garble` by more than 0.15 — on the pilot evidence that margin looks conservative.

**Load.** All three are offline or single-user; there is no throughput question here. The one
real latency risk is (A) in the interactive path, where 400 ms lands inside the gap between
submitting an answer and seeing a result, and 8 s of retry on a 529 does not. Fail open to the
manual buttons on any error, immediately, with no retry in the UI path.

---

## 6. How I would design this today, with Jev assumed

Lattice's central claim is *"the weak edge, not the weak topic."* Everything it does is an
attempt to recover semantic structure from an attempt log that contains three bits per problem.
With cheap judgement, you would not build it that way.

You would treat **the attempt itself as the primary datum.** The learner writes what they
think; a grading pass turns that into a structured record — correct/partial/failed, the class
of gap, whether the gap is in this concept or beneath it, whether they stopped from
not-knowing or from fatigue. Then the Elo, the mastery estimate and `weakEdges` all read real
evidence instead of triangulating from which buttons got pressed. `weakEdges` currently infers
"your prerequisite is weak" from a pattern across many attempts; with a `prereq_gap` noul it can
read it off a single failure, which is both faster and more honest.

You would build **one graph, not nine.** Alignment stops being a post-hoc Jaccard sweep and
becomes part of ingestion: every new book is aligned against everything already in the graph as
it is extracted. Adding Bertsekas or Lay stops being "write an extraction profile and hope";
the concept identities come out of the alignment pass.

And you would **stop discarding.** The `note` column gets read. `skipped` gets graded on
whatever was written before the skip. Every exercise gets nine dimensions at extraction for
one-sixteenth of a cent, which is what makes `next.md`'s entire Advanced section — strategy
fingerprint, technique heatmap, mistake classifier, similarity explorer — go from "needs an
embedding pipeline and a labelling budget" to "read a column."

The honest architectural statement: Jev is not a cheaper LLM for Lattice. It is a way to make
the *input* side of language understanding a normal operation in the build script and in the
request handler — which is exactly the layer where Lattice was forced to substitute regexes.

---

## 7. Smallest experiment that resolves the most

**Shadow-mode grading, two days of work, ~$0.50 of API spend.**

Add `machine_outcome`, `machine_gap` and `machine_conf` columns to `attempt`. On every
`POST /attempt` that carries a typed answer, fire the §4A request, store the result, and
**change nothing the learner sees.** Practise normally for three weeks, then compare.

This is the right first experiment because it is the only one whose uncertainty is genuinely
unresolved. (B) and (C) are offline, reviewable as a diff, and the pilot evidence already
points hard in one direction — they are engineering, not questions. Whether Jev can grade
*this owner's* mathematics well enough to be trusted with the mastery model is the question,
and it can only be answered on real attempts.

---

## 8. Rejected

- **Real-time grading of every keystroke.** 400 ms is affordable but the judgement is
  meaningless — a half-written proof is not wrong, it is unfinished. Grade on submit.
- **Jev for search / similar-problems ranking.** The re-ranking cookbook fits, but 4,104
  exercises means a full pass per query. Embeddings computed once are the correct tool; Jev's
  place is re-ranking the top ~30 after a vector recall, if at all. `next.md` already plans the
  embedding index; keep it.
- **Replacing the Gemini Putnam labeller wholesale.** It emits `hints`, `difficulty_reason`,
  `techniques` and `concepts` — free text and open-vocabulary arrays. Jev cannot generate those
  and should not be asked to. Replace only the closed-vocabulary fields (`primary_topic`,
  `difficulty`, `problem_type`, `answer_format`, the four booleans), which is most of the
  parse-failure surface and all of the `extract_json` / `recover_batch_outputs.py` fragility.
  Keep the generative call for hints — and note that with the structured fields split out, the
  generative prompt gets much shorter and cheaper.
- **Jev as the OCR repair.** It reads text; it does not read the rendered page. Repair needs a
  vision model. What changes is *targeting*: Jev decides which 300 of 4,104 exercises are worth
  a repair call, which is where the actual cost is.
- **Confidence as a universal quality gate.** The alignment run showed confidence is
  cardinality-sensitive — a 36-option choice spreads mass and reads as "unconfident" even when
  the top pick is right. Thresholds have to be set per question shape, on our data. Do not
  build a shared `if (conf > 0.8)` helper.
- **Generating drills with Jev.** `site/generators.js` produces exact answers deterministically.
  There is nothing semantic to add and a correct generator to lose.

---

## 9. What is measured, what is not

**Measured here:** the API shape and its 422 behaviour; latency at 1/6/16/31/61/121 questions;
determinism across repeats; wording and negation robustness; 156 real alignment requests over
5,460 real pairs; 175 real servability judgements against the shipped heuristic; 14 grading
cases.

**Not measured:** calibration on any populated middle band; behaviour on Axler, Tao, Pugh,
Stein, Herstein (only Andrews and Blitzstein text was used); rate limits under sustained load;
grading on genuinely hard proofs — the pilot problems are elementary; any comparison against
Haiku or a fine-tuned classifier; long-run cost at real practice volume.

**One non-technical constraint that gates all of this.** Lattice commits pointers only, because
verbatim exercise text from Herstein, Axler, Tao, Pugh, Stein and Blitzstein is not
redistributable — that is the whole reason `data/local` is gitignored. Every proposal above
sends that text to a third-party API. Grinstead & Snell (GFDL) and Putnam are fine. For the
rest, check TypeSafe's retention and training terms at https://docs.typesafe.ai/legal before
running anything beyond a bounded experiment, and consider whether the extraction-time pass
(§4C) can run against text that never leaves the machine that owns the book. This is a
licensing question, not a technical one, and it should be answered before (C) runs at corpus
scale.
