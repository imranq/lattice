# Generative, checkable problems — strategy and d2l pilot

*2026-09-25. Everything below marked "measured" was run in this repo; see "Reproduce".*

---

## The problem

On the live site only MATH (11,372) has deterministic answers. Every textbook and Putnam problem
(5,137) is free-response, graded by self-report or by Jev, which is off in the cloud. And most
textbook text cannot be hosted at all (copyright), so whole fields — machine learning among
them — have nothing to practise online.

## The approach: generators, not items

Instead of rewriting each exercise once into a fixed question, turn it into a **generator** in
the Khan Academy mould, living next to the mental-math ones in `site/generators*.js`:

- `gen(level, rng)` draws parameters from a seeded stream (so a `(skill, level, seed)` replays
  exactly), computes the answer in code, and returns `steps` and a `trick`.
- **Distractors are generated too.** A generator returns `mistakes: [{ answer, why }]`, each the
  value a *named* error produces ("forgot the bias", "padded one side only", "kept the summed
  axis"). They serve twice: as multiple-choice options, and as diagnoses — a typed answer that
  matches one gets its explanation instead of a bare "wrong".
- A mistake that lands within grading tolerance of the answer for some draw is dropped for that
  draw (picking it would be marked right).
- **Level 1 is multiple choice** (recognise before you produce); higher levels are typed.
  `format: "choice"` makes a conceptual item always multiple choice; `typed: true` makes one
  never multiple choice.
- **Checked by meaning where spelling varies.** Shapes compare as size lists
  (`(2, 8)` = `2x8`). Einsum answers are run: both specs are evaluated on the same fixed random
  integer operands and compared, so any lettering, einops spacing, a full `torch.einsum(...)`
  call or numpy's implicit mode all pass if they compute the same thing.
- **Guessing is priced in.** A multiple-choice attempt is logged as `…:mc<k>`, and the Elo update
  uses expected score `g + (1 − g)·p` with `g = 1/k` (the 3PL guessing term): a correct pick moves
  the rating less, a wrong one costs more.
- **Every generator links back** to the page it came from (`source.url`, e.g. the exact d2l.ai
  section), with honest `fidelity`: `faithful` (asks what the exercise asks), `concept` (the
  exercise was an open experiment; this tests the idea it teaches) or `inspired`.

Because the problem *text* is ours, generators derived from copyrighted books are original
questions about the concepts, not paraphrases — they can ship to the live site.

## Verification — nothing ships on the model's say-so

`node scripts/verify_generators.mjs --refs` (measured, 105 skills):

1. **Structure, 105,000 problems** (every skill × 5 levels × 200 seeds): answer accepted; no
   distractor accepted; exactly one correct choice; no duplicate choices; ≥3 options (2 for
   yes/no); every mistake explained; deterministic per seed; no `NaN`/`undefined` rendered;
   einsum answers still pass with every letter renamed and as a full call.
2. **Independent recomputation, 4,172 answers**: `scripts/generator_refs.py` recomputes each
   answer from `params` a different way — building the real `nn.Module` and counting parameters,
   `torch.autograd` for derivatives and the attention Jacobian, `torch.nn.utils.clip_grad_norm_`,
   `einops.rearrange`, numpy's own einsum FLOP model, executing the generated Python loop nest and
   comparing with `torch.einsum`, exhaustive enumeration or simulation for probabilities. All
   4,172 match.

It caught real bugs on the way: a tolerance override that let `0.05` pass for `0.1`; an absolute
error floor that accepted `0.000001` for a variance of `0.000225`; pooling layers with padding
PyTorch rejects; and an existing Percentages drill whose `%` was eaten as a TeX comment
("12% of 50" rendered as "12").

## The d2l pilot (measured)

50 exercises sampled with a fixed seed from the 324 in d2l's core chapters (preliminaries →
optimization), from the official Markdown source (commit `23d7a5a`, CC BY-SA 4.0):

| Outcome | Count | Examples |
|---|---|---|
| Faithful generator | 27 | attention gradient = covariance (§11.1), best constant = mean/median (§3.1), pooling cost (§7.5), VC dimension (§4.6), ‖x‖ gradient (§2.4), 4-gram table (§9.3) |
| Concept generator (open experiment) | 13 | "adjust the learning rate…" → GD stability η < 2/a; dropout experiment → inverted-dropout scaling |
| Not convertible | 8 | GPU timing, I/O benchmarks, framework error messages, "implement…", open discussion |
| Not yet | 2 | a convexity proof (→ proof formats, below); Hessian memory |

**80% of exercises became checkable generators (54% faithfully).** The 8 misses are all
experiments or implementation tasks — they need a code runner, not a better question.

Plus, outside the book: 8 einsum/einops/resource-accounting generators in the style of Stanford
CS336 (loop → einsum, output shapes, which spec, by-hand evaluation, rearrange, FLOPs, attention
memory, 6ND and training time).

## Copyrighted books: their topics, our problems

Pugh, Tao, Herstein, Axler (2e), Stein & Shakarchi, Blitzstein & Hwang and Andrews stay
reference-only: their text is never served. Instead `site/generators-books.js` holds 29 original
generators on their topics, each tied to the book's section by concept id (so the book's course
page offers "Practice" on that topic, and a "Practice these topics" set for the whole book) and
citing it as a place to learn more:

- **Real analysis (Tao, Pugh):** ε–δ for ax + b and x², N for a sequence limit, sup/inf/lim sup/lim
  inf, ratio test, Darboux sums, uniform continuity, countability, open/closed sets.
- **Abstract algebra (Herstein):** orders in ℤₙ, permutation order and sign, subgroups and
  generators of ℤₙ.
- **Number theory (Andrews):** linear Diophantine equations (any (x, y) accepted, checked by
  substitution), Fermat and Wilson, φ(n) and inverses.
- **Linear algebra (Axler):** 2×2 eigenvalues, rank–nullity (with matrices of known rank), trace
  and determinant, projection onto a line.
- **Complex analysis (Stein):** residues and contour integrals, radius of convergence.
- **Probability (Blitzstein):** Bayes with base rates, expectation by indicators.
- **Proofs:** √p irrational, induction for a sum formula (including random geometric sums), ε–δ
  continuity of ax + b, Fermat's little theorem from Lagrange, uniqueness of limits. Levels 1–2:
  pick the missing line. Level 3+: assemble the proof from shuffled lines, some planted and wrong;
  steps declare what they depend on, so steps that commute may come in either order. A planted
  line is named with the reason it fails; an order slip names the line used before it's proved.

All numeric answers are recomputed independently (sympy residues and limits, brute force over the
group, `Permutation.order()`, exact `Fraction` loops, least squares, simulation): **3,812/3,812
match** across 99 skills.

**Estimation (Mahajan, *Street-Fighting Mathematics*, CC BY-NC-SA 3.0):** one generator per chapter —
dimensional analysis (exponents solved exactly), easy cases (a wrong frustum formula is told which
easy case it fails, found by testing it in code), lumping (accepted within a factor of 2 of the
exact integral), the best rectangle (AM–GM), taking out the big part (within 0.2%), and cake cutting
by analogy. Estimates are still deterministic: a computed truth and a stated tolerance.

## Putnam solutions as step problems (pilot, measured)

20 Putnam problems with a published solution (350–1,600 characters, one solution), fixed-seed
sample: **17 converted**, 2 unusable because their problem statements are truncated in the dataset
(2017-A1, 2020-A1: cut off at `\begin{enumerate}`, a data bug to fix), 1 left out as too
computational (1996-A5: the argument lives in two long calculations). `site/generators-putnam.js`:

- **Correct steps are verbatim excerpts** of the published TeX solution, with declared
  dependencies; the verifier checks every excerpt against the solution text, so the answer key is
  the source's own order.
- **Wrong options come from four sources, mixed per level:** a *written* misconception with its
  reason (two per problem; the verifier checks none appears in the solution); a *misplaced* step —
  a later step that depends on the blank, provably out of place; a *mutated* step (≤/≥,
  increasing/decreasing, singular/invertible, sign swaps — listed by `--review`; all 4 current
  mutations reviewed and false); a *foreign* step from another problem (level 1 only).
- Levels 1–2: fill in the crucial step. Level 3+: build the solution from shuffled steps plus
  planted lines.

The two MATH problems whose answers were lost to an empty `\boxed{}` are both 0 (choice A, read
off the solutions); they're restored in `ANSWER_FIXES`, so the live site's broken count is 0.

## Auditing: `lattice audit`

`npm run audit` (or `node scripts/lattice.mjs audit`) counts every hardcoded problem by tier —
**exact** (stored answer), **broken** (claims gradable, has no answer), **solution** (worked
solution, no exact answer), **free** (nothing to check against) — by book, chapter, domain or
concept, with `--cloud` for what the live site serves, `--tier free --list` to see where each one
lives, a "Gen. chapter" column for problems in a chapter that already has generated practice, and
`--json`. It found the two MATH problems whose solutions end in an empty `\boxed{}` (now downgraded
on load, and fixed in `fetch_math_dataset.py`).

## Next

1. **More proofs.** The format exists (above); extend it to Grinstead & Snell and Putnam, whose
   worked solutions can seed the steps, and add "which theorem justifies this line" blanks.
2. **Scale authoring.** The pilot generators were hand-written; at ~5,000 exercises a model should
   draft generators, and the verifier above is the gate: a draft ships only if it passes structure
   *and* an independently written reference. Blind-solve (a second model answers without the key)
   is the remaining check to add.
3. **More open books** — shortlist below. Licences verified 2026-09-25.

## Open books worth adding

| Book | Field | Licence | Why |
|---|---|---|---|
| Hefferon, *Linear Algebra* | linear algebra | GFDL or CC BY-SA 3.0 | every exercise has a worked answer; LaTeX on GitLab |
| Beezer, *A First Course in Linear Algebra* | linear algebra | GFDL 1.2+ | exercise manual with solutions; PreTeXt source |
| Lebl, *Basic Analysis I & II* | real analysis | CC BY-SA 4.0 (dual with BY-NC-SA) | 815 exercises; no solutions by design (proof practice) |
| Trench, *Introduction to Real Analysis* | real analysis | CC BY-NC-SA 3.0 (solutions manual excluded) | LaTeX source on GitHub |
| Axler, *Linear Algebra Done Right* 4e | linear algebra | CC BY-NC (open access) | replaces the 2nd-edition extraction; can go live |
| Judson, *Abstract Algebra: Theory and Applications* | abstract algebra | GFDL 1.2+ | PreTeXt source on GitHub, Sage exercises |
| Beck et al., *A First Course in Complex Analysis* | complex analysis | CC BY 4.0 | the most permissive of the set |
| Levin, *Discrete Mathematics: An Open Introduction* | discrete / combinatorics | CC BY-NC-SA 4.0 | 750+ exercises, many with hints/solutions; PreTeXt |
| Keller & Trotter, *Applied Combinatorics* | combinatorics | CC BY-SA 4.0 | open source |
| Active Calculus (Boelkins et al.) 2e | calculus | CC BY-SA 4.0 | fills the calculus gap under analysis |
| OpenStax *Calculus* 1–3 | calculus | CC BY-NC-SA 4.0 | answer keys for odd exercises |

Not usable for derived problems: *Understanding Deep Learning* (Prince; CC BY-NC-ND — no
derivatives) and *Mathematics for Machine Learning* (free PDF, personal use only, no derivative
works). Both are fine to *link to* from a generator's `source`.

## Reproduce

```
node scripts/verify_generators.mjs --refs   # needs python3 with numpy, torch, einops
```
