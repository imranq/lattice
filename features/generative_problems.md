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

## Grinstead & Snell, and the rest of the analysis and algebra books (2026-09-26, measured)

Three more generator files take the count from 106 to 203 skills:

- **`site/generators-gs.js`: 41 generators, one or more per section of Grinstead & Snell**
  (GFDL), modelled on that section's exercises: roulette and the loaded die (1.x), exponential
  lifetimes (2.2), derangements, the birthday problem, binomial and poker counts, rising sequences
  (3.x), conditioning on a sum, urns and Bayes, the box paradox and n-door Monty Hall (4.x),
  Poisson, the minimum of n rolls, normal tolerances, density transforms (5.x), expectation,
  pooled blood tests, variance (6.x), dice convolutions, sums and minima of continuous variables
  (7.x), Chebyshev and the CLT (8–9), generating functions and branching processes (10.x), Markov
  chains: n-step, absorbing, fixed vectors, mean first passage (11.x), and random walks, gambler's
  ruin and the arc sine law (12.x). Answers are exact fractions where the problem allows (a
  decimal within 0.2 percent is accepted). The same generators are also tagged with the matching
  Blitzstein & Hwang sections, so that book's course page offers them.
- **`site/generators-analysis.js`: 28 for Tao and Pugh.** Images and inverse images, counting
  functions, Cauchy sequences, standard limits, limit points, series sums and convergence tests,
  extreme values, the IVT, derivatives from the definition, L'Hôpital, inverse functions, the
  MVT, piecewise-constant and Riemann–Stieltjes integrals, the FTC, uniform convergence,
  Jacobians and Lebesgue measure; and 10 proofs (limit laws, bounded and monotone sequences,
  differentiable ⇒ continuous, an IVT root, Cantor's theorem, uniform limits, Rolle, the geometric
  series).
- **`site/generators-algebra.js`: 28 for Herstein and Axler.** Lagrange, direct products,
  homomorphisms of cyclic groups, conjugacy classes, Sylow counts, units, zero divisors and
  idempotents, ideals of ℤ and ℤₙ, roots mod p and rational roots, field degrees, finite fields,
  cyclotomic polynomials and constructible polygons; span and subspace dimensions, the
  differentiation map, inner products on polynomials, Gram–Schmidt and distances, positivity,
  normality and singular values, Jordan forms, determinants and volume, change of basis; and 8
  proofs (Lagrange, kernels are normal, subgroups of cyclic groups, ℤ is a PID, ℤₚ is a field,
  eigenvectors for distinct eigenvalues, self-adjoint ⇒ real spectrum, injective ⇔ null T = 0).

Every one of these computed answers has an independent reference in `generator_refs.py` that
enumerates the sample space, brute-forces permutations or groups, integrates or takes limits with
sympy, or raises the matrix to a high power. **Over 5,000 recomputed answers match, with none left failing.** Two real
generator bugs were caught along the way (e^{−12} rounding to "0" at four places; the answer to
an exponential tail rounding to 0 for large λt) and one weak reference (midpoint tags sitting next
to a Stieltjes jump). `--only=gs-,an-` restricts the reference run to some prefixes, since the
torch references make a full run slow. Filler choices for a probability now stay inside [0, 1]
(`bounds`).

`lattice audit` now counts all 705 Grinstead & Snell problems, all of Pugh and Tao, and 217 of
222 Axler problems as sitting in a chapter with generated practice (up from 0, 2 and 1 chapters).

## The machine-learning books and Stein (2026-09-26, measured)

- **A wiring bug hid most of d2l.** The d2l generators cited their section ("7.5 Pooling") but
  carried no concept id, so neither the course page nor the audit connected them to the book:
  d2l showed 0 of 740 exercises in a practised chapter. `generators-ml.js` now derives
  `concept:d2l:chN` from the cited section; that alone reached 453.
- **`site/generators-mlbooks.js`: 44 generators.** The d2l chapters with nothing yet: conv
  layer size, parameters and MACs (AlexNet), receptive fields (VGG), batch norm, DenseNet
  channels (8); RNN/GRU/LSTM parameters, bidirectional shapes, beam-search cost, BLEU by hand
  (10); roofline and ring all-reduce (13); IoU, anchor counts, transposed convolution (14); BPE
  merges, subsampling and negative sampling, BERT parameters (15); TextCNN (16); value iteration
  and a Q-learning update (17); the GP posterior of 18.1's own exercise, RBF kernels (18); grid,
  random search and successive halving (19); the optimal discriminator (20); matrix factorization
  (21). For Bishop and Murphy: Gaussian MLE, entropy/KL/mutual information, beta–binomial
  updating, conditional Gaussians, histogram and k-NN densities, least squares and ridge,
  bias–variance, precision/recall and loss thresholds, Gaussian generative classifiers, logistic
  regression, momentum and Adam, weight decay, Bayesian-network parameter counts, message passing
  and GCN normalisation, rejection/Metropolis/importance sampling, k-means and GMM
  responsibilities, PCA, flow log-densities, the VAE KL term and the diffusion forward process.
  It also tags 45 existing generators with the Bishop and Murphy chapters they already practise.
- **`site/generators-complex.js`: 10 for Stein & Shakarchi.** Moduli, arguments and roots;
  harmonic functions and conjugates; power-series coefficients (including 1.4's (1 − z)^{−m});
  Fourier transforms of Gaussians and the Poisson kernel; real integrals by residues; orders of
  zeros and poles; zeros inside a circle; order of growth; Γ and ζ values; Möbius maps and the
  pseudo-hyperbolic distance.

The references build the real modules where they can (`nn.Conv2d`, `nn.LSTM`,
`nn.TransformerEncoderLayer`, `torch.optim.Adam`, `nn.BatchNorm1d`, torchvision's `box_iou`,
sklearn's `KMeans`, `Ridge` and RBF kernel), trace a receptive field by backpropagating an
impulse, run value iteration, and integrate the complex-analysis answers numerically with QUADPACK.
**3,300 answers checked; the 50 disagreements were two generator bugs (a GMM responsibility and
a Fourier transform small enough to round to "0") and two reference bugs, all fixed and
re-checked.**

`lattice audit`: d2l 736 of 740 exercises now sit in a practised chapter (was 0), Bishop 227 of
227 (was 0), Murphy 65 of 66 (was 0), Stein 183 of 191 (was 37). d2l chapters 13–21 and their
concepts now show titles instead of "Chapter None".

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
