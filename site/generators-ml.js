// Machine-learning generators, derived from the exercises in Dive into Deep
// Learning (Zhang, Lipton, Li, Smola; d2l.ai; CC BY-SA 4.0).
//
// Each one turns a textbook exercise into a family of problems: parameters are
// drawn from the seeded stream, the answer is computed here, and every
// distractor is the value a *named* mistake produces, with the reason attached.
// That makes the answer checkable without a model and makes a wrong answer
// diagnosable rather than just wrong.
//
// `source.fidelity` is honest about what was converted: "faithful" when the
// generator asks what the exercise asks, "concept" when the exercise was an
// open experiment and the generator tests the idea it was meant to teach.
// `params` is returned so scripts/verify_generators.mjs can recompute answers
// with numpy/torch, independently of the arithmetic below.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M) return;
  const { band, fmtFrac } = M.util;
  const ML = "machine learning";

  /** A decimal answer with at most `dp` places and no trailing zeros. */
  const fmt = (x, dp = 3) => String(Number(x.toFixed(dp)));
  const vec = (xs) => `(${xs.join(", ")})`;
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  // Where each section lives on d2l.ai, so a generated problem links back to
  // the page that teaches it. Paths from the d2l-en source (commit 23d7a5a).
  const D2L_PAGES = {
    "11.1 Queries, Keys, and Values": "chapter_attention-mechanisms-and-transformers/queries-keys-values",
    "11.4 The Bahdanau Attention Mechanism": "chapter_attention-mechanisms-and-transformers/bahdanau-attention",
    "11.6 Self-Attention and Positional Encoding": "chapter_attention-mechanisms-and-transformers/self-attention-and-positional-encoding",
    "11.7 The Transformer Architecture": "chapter_attention-mechanisms-and-transformers/transformer",
    "12.1 Optimization and Deep Learning": "chapter_optimization/optimization-intro",
    "12.2 Convexity": "chapter_optimization/convexity",
    "12.3 Gradient Descent": "chapter_optimization/gd",
    "12.5 Minibatch Stochastic Gradient Descent": "chapter_optimization/minibatch-sgd",
    "2.4 Calculus": "chapter_preliminaries/calculus",
    "2.5 Automatic Differentiation": "chapter_preliminaries/autograd",
    "2.6 Probability and Statistics": "chapter_preliminaries/probability",
    "3.1 Linear Regression": "chapter_linear-regression/linear-regression",
    "3.5 Concise Implementation of Linear Regression": "chapter_linear-regression/linear-regression-concise",
    "3.6 Generalization": "chapter_linear-regression/generalization",
    "4.1 Softmax Regression": "chapter_linear-classification/softmax-regression",
    "4.6 Generalization in Classification": "chapter_linear-classification/generalization-classification",
    "5.1 Multilayer Perceptrons": "chapter_multilayer-perceptrons/mlp",
    "5.3 Forward Propagation, Backward Propagation, and Computational Graphs": "chapter_multilayer-perceptrons/backprop",
    "5.5 Generalization in Deep Learning": "chapter_multilayer-perceptrons/generalization-deep",
    "5.6 Dropout": "chapter_multilayer-perceptrons/dropout",
    "5.7 Predicting House Prices on Kaggle": "chapter_multilayer-perceptrons/kaggle-house-price",
    "6.2 Parameter Management": "chapter_builders-guide/parameters",
    "7.1 From Fully Connected Layers to Convolutions": "chapter_convolutional-neural-networks/why-conv",
    "7.5 Pooling": "chapter_convolutional-neural-networks/pooling",
    "9.1 Working with Sequences": "chapter_recurrent-neural-networks/sequence",
    "9.3 Language Models": "chapter_recurrent-neural-networks/language-model",
    "9.5 Recurrent Neural Network Implementation from Scratch": "chapter_recurrent-neural-networks/rnn-scratch",
  };
  const d2l = (section, exercise, fidelity = "faithful") => ({
    book: "d2l", title: "Dive into Deep Learning", section, exercise, fidelity,
    url: `https://d2l.ai/${D2L_PAGES[section]}.html`,
    license: "CC BY-SA 4.0",
  });
  /** Mistakes whose value coincides with the answer are not distractors. */
  const wrong = (answer, list) => list.filter((m) => m.answer !== answer);

  // Tie each generator to the d2l chapter it cites ("7.5 Pooling" → concept:d2l:ch7), so the
  // book's course page offers it and the audit counts the chapter as practised.
  const d2lChapter = (g) => {
    const ch = g.source?.book === "d2l" && /^(\d+)\./.exec(g.source.section ?? "")?.[1];
    return ch ? [`concept:d2l:ch${ch}`] : [];
  };
  const def = (g) => M.define({ domain: ML, ...g, concepts: [...(g.concepts ?? []), ...d2lChapter(g)] });

  // ---- layers and parameters ------------------------------------------------

  def({
    id: "ml-mlp-params", name: "Counting MLP parameters",
    blurb: "Weights between each pair of layers, plus one bias per output unit.",
    source: d2l("6.2 Parameter Management", 1),
    gen(level, r) {
      const depth = band(level, [1, 2, 2, 3, 4]);
      const pool = band(level, [[2, 3, 4, 5], [4, 8, 10, 16], [8, 16, 20, 32],
                                [16, 20, 32, 64], [20, 32, 64, 128]]);
      const widths = Array.from({ length: depth + 2 }, () => r.pick(pool));
      let weights = 0, biases = 0;
      for (let i = 0; i + 1 < widths.length; i++) {
        weights += widths[i] * widths[i + 1];
        biases += widths[i + 1];
      }
      const total = weights + biases;
      const last = widths.at(-2) * widths.at(-1) + widths.at(-1);
      const layers = widths.slice(1).map((w, i) => `nn.Linear(${widths[i]}, ${w})`);
      const prompt = level >= 3
        ? `How many learnable parameters does this PyTorch model have?\n\n`
          + `\`nn.Sequential(${layers.join(", nn.ReLU(), ")})\``
        : `A fully connected network takes ${widths[0]}-dimensional inputs, has hidden `
          + `layers of width ${widths.slice(1, -1).join(" and ")}, and ${widths.at(-1)} outputs. `
          + `Every layer has a bias. How many learnable parameters does it have?`;
      return {
        prompt, answer: String(total),
        params: { widths },
        steps: widths.slice(1).map((w, i) =>
          `${widths[i]}×${w} weights + ${w} biases = ${widths[i] * w + w}`)
          .concat(`total = ${total}`),
        trick: "Each layer contributes (inputs × outputs) + outputs.",
        mistakes: wrong(String(total), [
          { answer: String(weights), why: "That counts the weights but leaves out every bias vector." },
          { answer: String(total - last), why: "That leaves out the output layer." },
          { answer: String(weights + sum(widths)),
            why: "That gives the input layer a bias too; biases belong to each layer's outputs only." },
        ]),
      };
    },
  });

  def({
    id: "ml-conv1x1", name: "1×1 convolutions",
    blurb: "A 1×1 convolution is one fully connected layer applied at every pixel.",
    source: d2l("7.1 From Fully Connected Layers to Convolutions", 1),
    gen(level, r) {
      const cin = r.pick(band(level, [[2, 3, 4], [3, 8, 16], [16, 32, 64], [32, 64, 128], [64, 128, 256]]));
      const cout = r.pick(band(level, [[2, 3, 4], [4, 8, 16], [16, 32, 64], [32, 64, 128], [64, 128, 256]]));
      const hw = r.pick([4, 7, 8, 14]);
      const total = cin * cout + cout;
      return {
        prompt: `With kernel size $\\Delta = 0$ a convolution sees one pixel at a time: it is a `
          + `$1\\times 1$ convolution. A $1\\times 1$ convolution maps ${cin} input channels to `
          + `${cout} output channels on a ${hw}×${hw} image, with a bias per output channel. `
          + `How many learnable parameters does it have?`,
        answer: String(total),
        params: { cin, cout, hw },
        steps: [`the same ${cin}→${cout} linear map is applied at every pixel`,
                `${cin}×${cout} weights + ${cout} biases = ${total}`],
        trick: "The image size never enters: the weights are shared across positions.",
        mistakes: wrong(String(total), [
          { answer: String(cin * cout), why: "That forgets the bias for each output channel." },
          { answer: String(hw * hw * (cin * cout + cout)),
            why: "That gives every pixel its own weights. A convolution shares one set across positions." },
          { answer: String(cin + cout), why: "Each output channel needs a weight for every input channel, so the counts multiply." },
        ]),
      };
    },
  });

  def({
    id: "ml-conv-sharing", name: "Why weight sharing pays",
    blurb: "A convolution reuses one small kernel everywhere; a dense layer cannot.",
    source: d2l("6.2 Parameter Management", 3, "concept"),
    gen(level, r) {
      const k = r.pick(band(level, [[3], [3, 5], [3, 5], [3, 5, 7], [3, 5, 7]]));
      const cin = r.pick(band(level, [[1], [1, 3], [3, 8], [8, 16], [16, 32]]));
      const cout = r.pick(band(level, [[1, 2], [2, 4], [8, 16], [16, 32], [32, 64]]));
      const hw = r.pick(band(level, [[6, 8], [8, 10], [8, 16], [16, 28], [28, 32]]));
      const conv = k * k * cin * cout + cout;
      const dense = (hw * hw * cin) * (hw * hw * cout) + hw * hw * cout;
      return {
        prompt: `A ${k}×${k} convolution with padding keeps a ${hw}×${hw} image the same size, `
          + `mapping ${cin} channel${cin === 1 ? "" : "s"} to ${cout}, with a bias per output channel. `
          + `How many learnable parameters does it have?`,
        answer: String(conv),
        params: { k, cin, cout, hw },
        steps: [`${k}×${k}×${cin}×${cout} = ${k * k * cin * cout} shared weights`,
                `+ ${cout} biases = ${conv}`,
                `a dense layer between the same shapes would need ${dense.toLocaleString()}`],
        trick: "Sharing makes the count independent of the image size.",
        mistakes: wrong(String(conv), [
          { answer: String(dense), why: "That is a fully connected layer between the same shapes, the thing sharing avoids." },
          { answer: String(k * k * cin * cout), why: "That forgets the per-channel biases." },
          { answer: String(k * k * cout + cout), why: "Each kernel spans every input channel, so multiply by the input channels too." },
        ]),
      };
    },
  });

  def({
    id: "ml-pooling", name: "Pooling output size and cost",
    blurb: "Pad both sides, slide by the stride, count what each window compares.",
    source: d2l("7.5 Pooling", 4),
    gen(level, r) {
      for (;;) {
        const h = r.pick(band(level, [[6, 8], [8, 10, 12], [14, 16, 28], [28, 32], [28, 32, 56]]));
        const p = r.pick([2, 3]);
        const pad = r.pick(band(level, [[0], [0, 1], [1], [1, 2], [1, 2]]));
        const s = r.pick(band(level, [[1, 2], [2], [2, 3], [2, 3], [2, 3]]));
        const c = r.pick(band(level, [[1], [1, 3], [3, 16], [16, 64], [64, 128]]));
        // PyTorch (rightly) rejects padding over half the window: such windows
        // can sit entirely in padding. Only ask about layers that can exist.
        if (h + 2 * pad < p || pad > Math.floor(p / 2)) continue;
        const out = Math.floor((h + 2 * pad - p) / s) + 1;
        const noPad = Math.floor((h - p) / s) + 1;
        const oneSide = Math.floor((h + pad - p) / s) + 1;
        const noStride = h + 2 * pad - p + 1;
        const setup = `A max-pooling layer has a ${p}×${p} window, padding ${pad} on every side and `
          + `stride ${s}. Its input has ${c} channel${c === 1 ? "" : "s"} of size ${h}×${h}.`;
        if (level <= 2) {
          return {
            prompt: `${setup} What is the height of its output?`,
            answer: String(out), params: { h, p, pad, s, c, ask: "height" },
            steps: [`(${h} + 2·${pad} − ${p}) / ${s} = ${(h + 2 * pad - p) / s}`,
                    `floor, then + 1 → ${out}`],
            trick: "Output = ⌊(n + 2·pad − window) / stride⌋ + 1.",
            mistakes: wrong(String(out), [
              { answer: String(noPad), why: "That ignores the padding." },
              { answer: String(oneSide), why: "Padding goes on both sides: add 2·pad, not pad." },
              { answer: String(noStride), why: "That is the stride-1 size; divide by the stride." },
            ]),
          };
        }
        const cmp = c * out * out * (p * p - 1);
        return {
          prompt: `${setup} How many comparisons does it make in total? (Finding the maximum of `
            + `$m$ numbers takes $m-1$ comparisons.)`,
          answer: String(cmp), params: { h, p, pad, s, c, ask: "comparisons" },
          steps: [`output is ${out}×${out} per channel`,
                  `${p * p} values per window → ${p * p - 1} comparisons`,
                  `${c}·${out}·${out}·${p * p - 1} = ${cmp}`],
          trick: "Cost = channels × output positions × work per window.",
          mistakes: wrong(String(cmp), [
            { answer: String(c * out * out * p * p), why: "The maximum of m numbers needs m − 1 comparisons, not m." },
            { answer: String(out * out * (p * p - 1)), why: "Pooling runs on every channel separately: multiply by the channels." },
            { answer: String(c * noPad * noPad * (p * p - 1)), why: "That output size ignores the padding." },
          ]),
        };
      }
    },
  });

  // ---- generalization ----------------------------------------------------------

  def({
    id: "ml-vc-poly", name: "VC dimension of polynomial classifiers",
    blurb: "A polynomial classifier is linear in its monomials; count them.",
    source: d2l("4.6 Generalization in Classification", 3),
    gen(level, r) {
      const n = level >= 4 ? 2 : 1;
      const k = r.int(band(level, [1, 2, 3, 2, 2]), band(level, [3, 5, 9, 3, 4]));
      const choose = (a, b) => { let x = 1; for (let i = 1; i <= b; i++) x = x * (a - b + i) / i; return Math.round(x); };
      const vc = choose(n + k, k);
      return {
        prompt: n === 1
          ? `Classify points $x \\in \\mathbb{R}$ by the sign of a polynomial $p(x)$ of degree at most ${k}. `
            + `What is the VC dimension of this class?`
          : `Classify points $(x, y) \\in \\mathbb{R}^2$ by the sign of a polynomial $p(x, y)$ of total `
            + `degree at most ${k}. What is the VC dimension of this class?`,
        answer: String(vc), params: { n, k },
        steps: [`the classifier is linear in the monomials of degree ≤ ${k}`,
                n === 1 ? `there are ${k} + 1 of them (including the constant)` : `there are C(${k}+2, 2) = ${vc} of them`,
                `a linear classifier on D features (with the constant among them) has VC dimension D = ${vc}`],
        trick: "VC dimension of a linear class = number of free coefficients.",
        mistakes: wrong(String(vc), [
          { answer: String(vc - 1), why: "That leaves out the constant term, which is one of the coefficients." },
          { answer: String(vc + 1), why: "The constant term is already one of the monomials; don't add a bias on top." },
          { answer: String(k), why: "The degree is not the count of coefficients." },
        ]),
      };
    },
  });

  def({
    id: "ml-interpolation", name: "Fitting points exactly",
    blurb: "n distinct points need n free coefficients.",
    source: d2l("3.6 Generalization", 1),
    gen(level, r) {
      const npts = r.int(band(level, [2, 3, 5, 8, 10]), band(level, [4, 6, 10, 15, 30]));
      return {
        prompt: `You have ${npts} training points $(x_i, y_i)$ with distinct $x_i$ and arbitrary $y_i$. `
          + `What is the smallest polynomial degree that is guaranteed to fit all of them exactly?`,
        answer: String(npts - 1), params: { npts },
        steps: [`a degree-d polynomial has d + 1 coefficients`,
                `${npts} equations need ${npts} unknowns → d = ${npts - 1}`,
                `the Vandermonde system is invertible because the x_i are distinct`],
        trick: "Two points fix a line, three a parabola.",
        mistakes: wrong(String(npts - 1), [
          { answer: String(npts), why: "Degree d already has d + 1 coefficients, one more than the degree." },
          { answer: String(npts - 2), why: "That leaves one equation more than unknowns; it fits only lucky data." },
        ]),
      };
    },
  });

  def({
    id: "ml-sqrt-n", name: "How error shrinks with data",
    blurb: "Estimation error falls like 1/√n: halving it costs four times the data.",
    source: d2l("3.5 Concise Implementation of Linear Regression", 5, "concept"),
    gen(level, r) {
      if (level <= 2) {
        const k = r.pick([2, 3, 4, 5, 10]);
        return {
          prompt: `The estimation error of $\\hat{\\mathbf{w}}$ falls like $1/\\sqrt{n}$. By what factor must `
            + `you multiply the amount of data to divide the error by ${k}?`,
          answer: String(k * k), params: { k },
          steps: [`error ∝ n^(−1/2)`, `error ÷ ${k} needs n × ${k}² = ${k * k}`],
          trick: "Why the d2l hint spaces data sizes logarithmically: each gain costs a multiple.",
          mistakes: wrong(String(k * k), [
            { answer: String(k), why: "That assumes error ∝ 1/n. It falls like 1/√n, so square the factor." },
            { answer: fmt(Math.sqrt(k)), why: "The square root goes the other way: n must grow by k², not √k." },
            { answer: String(2 * k), why: "Squaring, not doubling, undoes a square root." },
          ]),
        };
      }
      const n1 = r.pick([100, 200, 400, 500]);
      const mult = r.pick([4, 9, 16, 25, 100]);
      const e1 = r.pick([0.2, 0.3, 0.5, 0.8]);
      const e2 = e1 / Math.sqrt(mult);
      return {
        prompt: `With ${n1} examples the error of $\\hat{b}$ is about ${e1}. Assuming it falls like `
          + `$1/\\sqrt{n}$, what is it with ${n1 * mult} examples?`,
        answer: fmt(e2, 4), params: { n1, mult, e1 }, tolerance: 0.01,
        steps: [`${n1 * mult}/${n1} = ${mult} times the data`, `√${mult} = ${Math.sqrt(mult)}`,
                `${e1}/${Math.sqrt(mult)} = ${fmt(e2, 4)}`],
        trick: "Take the square root of the data ratio.",
        mistakes: wrong(fmt(e2, 4), [
          { answer: fmt(e1 / mult, 4), why: "That divides by the data ratio itself; the error falls like its square root." },
          { answer: fmt(e1 * Math.sqrt(mult), 4), why: "More data shrinks the error; this grows it." },
        ]),
      };
    },
  });

  // ---- losses and estimators -------------------------------------------------

  def({
    id: "ml-best-constant", name: "The best constant predictor",
    blurb: "Squared loss picks the mean; absolute loss picks the median.",
    source: d2l("3.1 Linear Regression", 1),
    gen(level, r) {
      for (;;) {
        const n = r.pick(band(level, [[3, 5], [5, 7], [5, 7, 9], [7, 9], [9, 11]]));
        const xs = Array.from({ length: n }, () => r.int(0, band(level, [10, 20, 30, 60, 100])));
        const sorted = [...xs].sort((a, b) => a - b);
        const mean = sum(xs) / n, median = sorted[(n - 1) / 2];
        const mid = (sorted[0] + sorted.at(-1)) / 2;
        if (new Set([mean, median, mid]).size < 3) continue;
        const absLoss = r() < 0.5;
        const want = absLoss ? median : mean;
        const show = (x) => (Number.isInteger(x) ? String(x) : fmtFrac(Math.round(x * 2 * n), 2 * n));
        return {
          prompt: `Data: ${xs.join(", ")}. Find the constant $b$ that minimizes `
            + (absLoss ? `$\\sum_i |x_i - b|$.` : `$\\sum_i (x_i - b)^2$.`),
          answer: show(want), params: { xs, loss: absLoss ? "abs" : "sq" },
          steps: absLoss
            ? [`sorted: ${sorted.join(", ")}`, `moving b past a point changes the slope by 2, so the minimum sits at the middle one`, `b = ${median}`]
            : [`derivative: −2Σ(x_i − b) = 0`, `b = Σx_i/n = ${sum(xs)}/${n} = ${show(mean)}`],
          trick: absLoss ? "Absolute loss ignores how far the outliers are." : "Squared loss is minimized by the mean.",
          mistakes: wrong(show(want), [
            { answer: show(absLoss ? mean : median),
              why: absLoss ? "The mean minimizes squared loss; absolute loss is minimized by the median."
                           : "The median minimizes absolute loss; squared loss is minimized by the mean." },
            { answer: show(mid), why: "The midpoint of the range minimizes the worst-case error, not a sum of errors." },
          ]),
        };
      }
    },
  });

  def({
    id: "ml-noisy-gram", name: "Noise regularizes the design matrix",
    blurb: "Gaussian noise on X adds nσ² to every diagonal entry of XᵀX in expectation.",
    source: d2l("3.1 Linear Regression", 4),
    gen(level, r) {
      const n = r.int(band(level, [2, 3, 3, 4, 5]), band(level, [3, 4, 5, 6, 8]));
      const col = Array.from({ length: n }, () => r.int(-3, 4));
      const sigma = r.pick(band(level, [[1], [1, 2], [0.5, 1, 2], [0.1, 0.5, 2], [0.1, 0.3, 0.5]]));
      const base = sum(col.map((x) => x * x));
      const want = base + n * sigma * sigma;
      return {
        prompt: `$\\mathbf{X}$ has ${n} rows, and its first column is ${vec(col)}. Add independent `
          + `$\\mathcal{N}(0, ${sigma}^2)$ noise to every entry of $\\mathbf{X}$. What is the expected `
          + `value of the $(1,1)$ entry of $\\tilde{\\mathbf{X}}^\\top \\tilde{\\mathbf{X}}$?`,
        answer: fmt(want, 4), params: { col, sigma }, tolerance: 0.001,
        steps: [`(X̃ᵀX̃)₁₁ = Σ_i (x_i + ε_i)²`, `E = Σ x_i² + 2Σ x_i E[ε_i] + Σ E[ε_i²]`,
                `= ${base} + 0 + ${n}·${sigma}² = ${fmt(want, 4)}`],
        trick: "This is ridge regression in disguise: noise adds nσ²I, which makes XᵀX invertible.",
        mistakes: wrong(fmt(want, 4), [
          { answer: fmt(base + sigma * sigma, 4), why: "Each of the n rows contributes σ², so it is nσ², not σ²." },
          { answer: fmt(base, 4), why: "The cross terms vanish in expectation, but E[ε²] = σ² does not." },
          { answer: fmt(base + n * sigma, 4), why: "The variance is σ², not σ." },
        ]),
      };
    },
  });

  def({
    id: "ml-coin-variance", name: "Variance of an estimated probability",
    blurb: "p̂ averages n coin flips: variance p(1−p)/n, and Chebyshev bounds its deviation.",
    source: d2l("2.6 Probability and Statistics", 3),
    gen(level, r) {
      const p = r.pick([0.5, 0.2, 0.3, 0.1, 0.25]);
      const n = r.pick(band(level, [[10, 100], [25, 100, 400], [100, 400, 1000], [100, 1000], [1000, 10000]]));
      const v = p * (1 - p) / n;
      if (level <= 3) {
        return {
          prompt: `A coin lands heads with probability ${p}. You estimate $p$ by the fraction of heads $\\hat{p}$ `
            + `in ${n} independent flips. What is $\\mathrm{Var}(\\hat{p})$?`,
          answer: fmt(v, 6), params: { p, n, ask: "var" }, tolerance: 0.001,
          steps: [`each flip has variance p(1−p) = ${fmt(p * (1 - p), 4)}`,
                  `averaging n independent flips divides the variance by n`, `${fmt(p * (1 - p), 4)}/${n} = ${fmt(v, 6)}`],
          trick: "Variance shrinks like 1/n; the standard deviation like 1/√n.",
          mistakes: wrong(fmt(v, 6), [
            { answer: fmt(p * (1 - p), 6), why: "That is one flip's variance; averaging n flips divides it by n." },
            { answer: fmt(Math.sqrt(v), 6), why: "That is the standard deviation, the square root of the variance." },
            { answer: fmt(v / n, 6), why: "The mean of n variables divides the variance by n, not n²." },
          ]),
        };
      }
      const eps = r.pick([0.05, 0.1]);
      const bound = v / (eps * eps);
      return {
        prompt: `A coin lands heads with probability ${p}; $\\hat{p}$ is the fraction of heads in ${n} flips. `
          + `What upper bound does Chebyshev's inequality give for $P(|\\hat{p} - p| \\ge ${eps})$?`,
        answer: fmt(bound, 5), params: { p, n, eps, ask: "chebyshev" }, tolerance: 0.001,
        steps: [`Var(p̂) = p(1−p)/n = ${fmt(v, 6)}`, `P(|p̂ − p| ≥ ε) ≤ Var/ε²`,
                `${fmt(v, 6)}/${eps}² = ${fmt(bound, 5)}`],
        trick: "Chebyshev: deviation of ε has probability at most σ²/ε².",
        mistakes: wrong(fmt(bound, 5), [
          { answer: fmt(v / eps, 5), why: "Chebyshev divides by ε², not ε." },
          { answer: fmt(p * (1 - p) / (eps * eps), 5), why: "Use the variance of the average, p(1−p)/n, not of one flip." },
        ]),
      };
    },
  });

  def({
    id: "ml-markov-joint", name: "Joint probability of a Markov chain",
    blurb: "When C depends only on B, P(A,B,C) = P(A) P(B|A) P(C|B).",
    source: d2l("2.6 Probability and Statistics", 6),
    gen(level, r) {
      const pr = () => r.pick([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
      const pA = pr(), pB1 = pr(), pB0 = pr(), pC1 = pr(), pC0 = pr();
      const a = r.int(0, 1), b = r.int(0, 1), c = r.int(0, 1);
      const PA = a ? pA : 1 - pA;
      const PB = (b ? 1 : 0) === 1 ? (a ? pB1 : pB0) : 1 - (a ? pB1 : pB0);
      const qC = b ? pC1 : pC0;
      const PC = c ? qC : 1 - qC;
      const want = PA * PB * PC;
      return {
        prompt: `Binary variables form a chain $A \\to B \\to C$: $B$ depends only on $A$, and $C$ only on $B$. `
          + `$P(A{=}1) = ${pA}$; $P(B{=}1 \\mid A{=}1) = ${pB1}$, $P(B{=}1 \\mid A{=}0) = ${pB0}$; `
          + `$P(C{=}1 \\mid B{=}1) = ${pC1}$, $P(C{=}1 \\mid B{=}0) = ${pC0}$. `
          + `What is $P(A{=}${a}, B{=}${b}, C{=}${c})$?`,
        answer: fmt(want, 4), params: { pA, pB1, pB0, pC1, pC0, a, b, c }, tolerance: 0.001,
        steps: [`P(A,B,C) = P(A) P(B|A) P(C|A,B) = P(A) P(B|A) P(C|B)`,
                `${fmt(PA, 2)} × ${fmt(PB, 2)} × ${fmt(PC, 2)} = ${fmt(want, 4)}`],
        trick: "Each factor conditions only on the variable just before it.",
        mistakes: wrong(fmt(want, 4), [
          { answer: fmt(PA * PB, 4), why: "That stops at P(A, B); C's factor P(C|B) is missing." },
          { answer: fmt(PA * PB * (1 - PC), 4), why: `That uses P(C=${1 - c}|B) instead of P(C=${c}|B).` },
          { answer: fmt(PA * (b ? pB1 * pA + pB0 * (1 - pA) : 1 - (pB1 * pA + pB0 * (1 - pA))) * PC, 4),
            why: "That uses the marginal P(B) where the chain needs P(B | A)." },
        ]),
      };
    },
  });

  def({
    id: "ml-logsumexp", name: "Log-sum-exp, stably",
    blurb: "Subtract the maximum first: g(x) = m + log Σ exp(xᵢ − m).",
    source: d2l("4.1 Softmax Regression", 6),
    gen(level, r) {
      const big = level >= 3;
      const m0 = big ? r.pick([500, 1000, 2000]) : 0;
      const xs = Array.from({ length: band(level, [2, 3, 3, 4, 4]) }, () => m0 + r.int(-3, 3));
      const m = Math.max(...xs);
      const g = m + Math.log(sum(xs.map((x) => Math.exp(x - m))));
      const target = big ? g - m0 : g;
      const offset = big ? ` $-\\,${m0}$` : "";
      return {
        prompt: `Let $g(\\mathbf{x}) = \\log \\sum_i \\exp x_i$ with $\\mathbf{x} = ${vec(xs)}$. `
          + (big ? `Computing $\\exp(${m0})$ directly overflows. Compute $g(\\mathbf{x})${offset}$.`
                 : `Compute $g(\\mathbf{x})$.`),
        answer: fmt(target, 3), params: { xs, offset: m0 }, tolerance: 0.001,
        steps: [`m = max xᵢ = ${m}`, `Σ exp(xᵢ − m) = ${fmt(sum(xs.map((x) => Math.exp(x - m))), 4)}`,
                `g = m + log(that) = ${fmt(g, 3)}`],
        trick: "g(x + b) = g(x) + b, so shifting by the maximum changes nothing but the overflow.",
        mistakes: wrong(fmt(target, 3), [
          { answer: fmt(m - m0, 3), why: "The maximum is only the leading term; the other entries add log Σ exp(xᵢ − m)." },
          { answer: fmt(sum(xs) / xs.length - m0, 3), why: "That is the mean. Log-sum-exp is a smooth maximum, never below the max." },
          { answer: fmt(m - m0 + sum(xs.map((x) => Math.exp(x - m))), 3), why: "The log is missing: add log Σ exp(xᵢ − m), not the sum itself." },
        ]),
      };
    },
  });

  // ---- calculus and autograd ---------------------------------------------------

  def({
    id: "ml-norm-gradient", name: "Gradient of the Euclidean norm",
    blurb: "∇‖x‖₂ = x/‖x‖₂, undefined at 0.",
    source: d2l("2.4 Calculus", 8),
    gen(level, r) {
      const triples = level <= 2
        ? [[3, 4, 5], [5, 12, 13], [8, 15, 17], [6, 8, 10], [7, 24, 25]]
        : [[1, 2, 2, 3], [2, 3, 6, 7], [1, 4, 8, 9], [4, 4, 7, 9], [2, 6, 9, 11]];
      const t = r.pick(triples);
      const xs = t.slice(0, -1).map((x) => x * r.sign());
      const norm = t.at(-1);
      const i = r.int(0, xs.length - 1);
      const want = fmtFrac(xs[i], norm);
      return {
        prompt: `Let $f(\\mathbf{x}) = \\|\\mathbf{x}\\|_2$. At $\\mathbf{x} = ${vec(xs)}$, what is `
          + `$\\partial f / \\partial x_${i + 1}$?`,
        answer: want, params: { xs, i },
        steps: [`‖x‖ = √(${xs.map((x) => `${x}²`).join(" + ")}) = ${norm}`,
                `∂‖x‖/∂x_i = x_i/‖x‖`, `${xs[i]}/${norm}`],
        trick: "The gradient of the norm is the unit vector in the direction of x.",
        mistakes: wrong(want, [
          { answer: String(xs[i]), why: "x itself is the gradient of ½‖x‖², not of ‖x‖." },
          { answer: String(2 * xs[i]), why: "2x is the gradient of ‖x‖², the squared norm." },
          { answer: fmtFrac(xs[i], norm * norm), why: "Divide by ‖x‖, not ‖x‖²." },
        ]),
      };
    },
  });

  def({
    id: "ml-chain-rule", name: "Tracing a derivative through a graph",
    blurb: "Differentiate node by node: product rule where paths meet, chain rule along them.",
    source: d2l("2.5 Automatic Differentiation", 5),
    gen(level, r) {
      const a = level <= 2 ? 1 : r.pick([1, 2, 3]);
      const b = level <= 2 ? 1 : r.pick([1, 2, -1]);
      const x = r.pick(band(level, [[1, 2], [1, 2, 3], [0.5, 1.5, 2.5], [0.5, 2, 3], [-2, -1, 1.5, 2.5]]));
      const L = Math.log(x * x), S = Math.sin(x), C = Math.cos(x);
      const d = a * ((2 / x) * S + L * C) - b / (x * x);
      const fx = `${a === 1 ? "" : a}\\log(x^2)\\sin x ${b < 0 ? "-" : "+"} ${Math.abs(b) === 1 ? "" : Math.abs(b)}x^{-1}`;
      return {
        prompt: `Let $f(x) = ${fx}$. Its graph runs $x \\to x^2 \\to \\log$, $x \\to \\sin$, a product node, `
          + `and $x \\to x^{-1}$ into a sum. What is $f'(${x})$?`,
        answer: fmt(d, 3), params: { a, b, x }, tolerance: 0.01,
        steps: [`d/dx log(x²) = 2/x`, `product: (2/x)·sin x + log(x²)·cos x`,
                `d/dx x⁻¹ = −1/x²`, `f'(${x}) = ${fmt(d, 3)}`],
        trick: "One term per path from x to f.",
        mistakes: wrong(fmt(d, 3), [
          { answer: fmt(a * L * C - b / (x * x), 3), why: "The product rule has two terms; the (2/x)·sin x term is missing." },
          { answer: fmt(a * (2 / x) * S - b / (x * x), 3), why: "The product rule has two terms; the log(x²)·cos x term is missing." },
          { answer: fmt(a * ((1 / x) * S + L * C) - b / (x * x), 3), why: "d/dx log(x²) is 2/x: the chain rule multiplies by 2x." },
          { answer: fmt(a * ((2 / x) * S + L * C) + b / (x * x), 3), why: "The derivative of x⁻¹ is −x⁻², negative." },
        ]),
      };
    },
  });

  def({
    id: "ml-vector-backward", name: "Backward through a vector output",
    blurb: "A non-scalar output needs a reduction (or a gradient argument) before backward.",
    source: d2l("2.5 Automatic Differentiation", 3),
    gen(level, r) {
      const n = band(level, [2, 3, 3, 4, 4]);
      const xs = Array.from({ length: n }, () => r.int(-3, 4) || 1);
      const k = r.pick(band(level, [[2], [2, 3], [2, 3], [3], [3]]));
      const i = r.int(0, n - 1);
      const coef = level >= 4 ? r.pick([2, 3]) : 1;
      const grad = coef * k * Math.pow(xs[i], k - 1);
      const fn = `${coef === 1 ? "" : coef}x^${k}`;
      return {
        prompt: `In PyTorch, \`x = torch.tensor(${JSON.stringify(xs.map((v) => v + 0.0))}, requires_grad=True)\` `
          + `and \`y = ${coef === 1 ? "" : `${coef} * `}x ** ${k}\`, a vector. \`y.backward()\` would fail, so you `
          + `run \`y.sum().backward()\`. What is \`x.grad[${i}]\`?`,
        answer: String(grad), params: { xs, k, coef, i },
        steps: [`y.sum() = Σ ${fn} evaluated elementwise`, `∂/∂x_i Σ_j y_j = dy_i/dx_i = ${coef * k}x_i^${k - 1}`,
                `at x_${i} = ${xs[i]}: ${grad}`],
        trick: "Summing first gives each entry its own derivative, the diagonal of the Jacobian.",
        mistakes: wrong(String(grad), [
          { answer: String(coef * Math.pow(xs[i], k)), why: "That is y itself; the gradient is its derivative." },
          { answer: String(sum(xs.map((x) => coef * k * Math.pow(x, k - 1)))),
            why: "Each x_i only affects y_i, so x.grad[i] gets its own derivative, not the sum of all of them." },
          { answer: String(coef * k * xs[i]), why: `The power rule gives ${coef * k}x^${k - 1}, not ${coef * k}x.` },
        ]),
      };
    },
  });

  def({
    id: "ml-tanh-sigmoid", name: "tanh and sigmoid are one function",
    blurb: "tanh(x) + 1 = 2·sigmoid(2x).",
    source: d2l("5.1 Multilayer Perceptrons", 5),
    gen(level, r) {
      const t = r.pick([-0.8, -0.6, -0.4, -0.2, 0.2, 0.4, 0.6, 0.8, 0.5, -0.5]);
      const want = (t + 1) / 2;
      const flip = level >= 3 && r() < 0.5;
      return flip ? {
        prompt: `You know $\\operatorname{sigmoid}(2a) = ${fmt(want, 2)}$. What is $\\tanh(a)$?`,
        answer: fmt(t, 2), params: { t, ask: "tanh" },
        steps: [`tanh(a) + 1 = 2·sigmoid(2a)`, `tanh(a) = 2·${fmt(want, 2)} − 1 = ${fmt(t, 2)}`],
        trick: "Any tanh network is a sigmoid network with rescaled weights and biases.",
        mistakes: wrong(fmt(t, 2), [
          { answer: fmt(want * 2, 2), why: "Subtract 1 after doubling: tanh(a) = 2·sigmoid(2a) − 1." },
          { answer: fmt(want / 2, 2), why: "Invert the identity: multiply by 2 and subtract 1." },
        ]),
      } : {
        prompt: `You know $\\tanh(a) = ${t}$. Without computing $a$, what is $\\operatorname{sigmoid}(2a)$?`,
        answer: fmt(want, 3), params: { t, ask: "sigmoid" },
        steps: [`tanh(x) + 1 = 2·sigmoid(2x)`, `sigmoid(2a) = (${t} + 1)/2 = ${fmt(want, 3)}`],
        trick: "Any tanh network is a sigmoid network with rescaled weights and biases.",
        mistakes: wrong(fmt(want, 3), [
          { answer: fmt(t / 2, 3), why: "Add 1 before halving: sigmoid(2a) = (tanh(a) + 1)/2." },
          { answer: fmt(t + 1, 3), why: "Halve it: tanh(a) + 1 equals twice the sigmoid." },
          { answer: fmt((1 - t) / 2, 3), why: "That is sigmoid(−2a); the sign of tanh flips with a." },
        ]),
      };
    },
  });

  // ---- optimization ------------------------------------------------------------

  def({
    id: "ml-gd-stability", name: "When gradient descent diverges",
    blurb: "On f(x) = a·x²/2, GD converges exactly when η < 2/a.",
    source: d2l("12.3 Gradient Descent", 1, "concept"),
    gen(level, r) {
      const a = r.pick(band(level, [[1, 2, 4], [2, 4, 5], [0.5, 4, 8, 10], [5, 8, 20], [10, 25, 50]]));
      if (level <= 3) {
        return {
          prompt: `Gradient descent with learning rate $\\eta$ minimizes $f(x) = \\tfrac{${a}}{2}x^2$. `
            + `What is the largest $\\eta$ below which it converges from any starting point?`,
          answer: fmtFrac(2 * 1000, a * 1000), params: { a, ask: "max-lr" },
          steps: [`x ← x − η·${a}x = (1 − ${a}η)x`, `converges iff |1 − ${a}η| < 1`,
                  `η < 2/${a} = ${fmt(2 / a, 4)}`],
          trick: "Loss curves that blow up past a learning rate are this factor exceeding 1 in size.",
          mistakes: wrong(fmtFrac(2 * 1000, a * 1000), [
            { answer: fmtFrac(1000, a * 1000), why: "η = 1/a is the fastest (one-step) rate; convergence continues up to 2/a." },
            { answer: fmt(a / 2, 4), why: "The limit is 2/a: larger curvature means a smaller safe step." },
            { answer: fmt(2 * a, 4), why: "Curvature and step size trade off: the limit is 2/a." },
          ]),
        };
      }
      const eta = r.pick([0.05, 0.1, 0.15]);
      const x0 = r.pick([1, 2, 5]);
      const k = r.pick([2, 3, 4]);
      const f = 1 - eta * a;
      const xk = x0 * Math.pow(f, k);
      return {
        prompt: `Gradient descent with $\\eta = ${eta}$ on $f(x) = \\tfrac{${a}}{2}x^2$, starting from $x_0 = ${x0}$. `
          + `What is $x_${k}$?`,
        answer: fmt(xk, 4), params: { a, eta, x0, k, ask: "iterate" }, tolerance: 0.001,
        steps: [`x_{t+1} = (1 − ηa)x_t = ${fmt(f, 4)}·x_t`, `x_${k} = ${x0}·${fmt(f, 4)}^${k} = ${fmt(xk, 4)}`],
        trick: `|1 − ηa| ${Math.abs(f) < 1 ? "< 1: it converges" : "≥ 1: it diverges"}.`,
        mistakes: wrong(fmt(xk, 4), [
          { answer: fmt(x0 * Math.pow(1 - eta, k), 4), why: "The gradient of a·x²/2 is a·x, so the factor is 1 − ηa, not 1 − η." },
          { answer: fmt(x0 * f, 4), why: `That is one step; apply the factor ${k} times.` },
          { answer: fmt(x0 - k * eta * a * x0, 4), why: "Each step uses the current x, so the factor compounds rather than adds." },
        ]),
      };
    },
  });

  def({
    id: "ml-bisection", name: "Line search by bisection",
    blurb: "Each step halves the interval: ⌈log₂((b−a)/ε)⌉ steps.",
    source: d2l("12.3 Gradient Descent", 2),
    gen(level, r) {
      const width = r.pick(band(level, [[1, 2, 4], [1, 8, 10], [10, 16, 100], [100, 1000], [1000, 1e4]]));
      const eps = r.pick(band(level, [[0.5, 0.25], [0.1, 0.01], [0.01, 0.001], [1e-3, 1e-4], [1e-6, 1e-5]]));
      const steps = Math.ceil(Math.log2(width / eps) - 1e-12);
      return {
        prompt: `You minimize a convex function on an interval of width ${width} by bisection on the sign of the `
          + `derivative. How many steps guarantee the minimizer is located to within an interval of width ${eps}?`,
        answer: String(steps), params: { width, eps },
        steps: [`after k steps the width is ${width}/2^k`, `need ${width}/2^k ≤ ${eps}`,
                `k ≥ log₂(${width}/${eps}) = ${fmt(Math.log2(width / eps), 3)} → ${steps}`],
        trick: "Linear convergence: one bit of precision per step.",
        mistakes: wrong(String(steps), [
          { answer: String(Math.ceil(Math.log10(width / eps) - 1e-12)), why: "Bisection halves the interval: use log base 2, not 10." },
          { answer: String(Math.floor(Math.log2(width / eps) + 1e-12)), why: "Round up: a fractional step still has to be taken." },
          { answer: String(Math.round(width / eps)), why: "That is a grid search. Bisection needs only the logarithm of that many steps." },
        ]),
      };
    },
  });

  def({
    id: "ml-softplus-min", name: "Minimizing a log-sum-exp by hand",
    blurb: "Set the derivative to zero: αe^{αx} = βe^{−βx−c}.",
    source: d2l("12.3 Gradient Descent", 2),
    gen(level, r) {
      const al = level <= 1 ? 1 : r.pick([1, 2]);
      const be = level <= 1 ? 2 : r.pick([1, 2, 3]);
      const c = level <= 1 ? 3 : r.pick([-2, -1, 1, 2, 3]);
      const x = (Math.log(be / al) - c) / (al + be);
      const e = (s, k) => (k === 1 ? s : `${k}${s}`);
      return {
        prompt: `Find the minimizer of $f(x) = \\log\\left(e^{${e("x", al)}} + e^{-${e("x", be)} ${c < 0 ? "+" : "-"} ${Math.abs(c)}}\\right)$.`,
        answer: fmt(x, 3), params: { al, be, c }, tolerance: 0.01,
        steps: [`f'(x) = 0 ⇔ ${al}e^{${al}x} = ${be}e^{−${be}x−(${c})}`,
                `${al + be}x = ln(${be}/${al}) − (${c})`, `x = ${fmt(x, 3)}`],
        trick: "Log-sum-exp of affine functions is convex: the stationary point is the minimum.",
        mistakes: wrong(fmt(x, 3), [
          { answer: fmt((Math.log(al / be) - c) / (al + be), 3), why: "The ratio is β/α: the factor comes down from the second exponent." },
          { answer: fmt(-c / (al + be), 3), why: "That drops the ln(β/α) term the two slopes contribute." },
          { answer: fmt((Math.log(be / al) + c) / (al + be), 3), why: "Sign slip on c when moving it across." },
        ]),
      };
    },
  });

  def({
    id: "ml-saddle", name: "Minimum, maximum or saddle",
    blurb: "Read the Hessian: det < 0 is a saddle, however the diagonal looks.",
    source: d2l("12.1 Optimization and Deep Learning", 4, "concept"),
    gen(level, r) {
      for (;;) {
        const A = r.int(-3, 3), B = r.int(-4, 4), C = r.int(-3, 3);
        const det = 4 * A * C - B * B;
        if (!A || !C || det === 0) continue;
        if (level <= 2 && B === 0) continue;
        const kind = det < 0 ? "a saddle point" : A > 0 ? "a minimum" : "a maximum";
        const diag = A > 0 && C > 0 ? "a minimum" : A < 0 && C < 0 ? "a maximum" : "a saddle point";
        const term = (k, s) => (k === 0 ? "" : `${k < 0 ? " - " : " + "}${Math.abs(k) === 1 ? "" : Math.abs(k)}${s}`);
        const f = `${A === 1 ? "" : A === -1 ? "-" : A}x^2${term(B, "xy")}${term(C, "y^2")}`;
        const options = ["a minimum", "a maximum", "a saddle point"].filter((o) => o !== kind);
        return {
          prompt: `What kind of critical point does $f(x, y) = ${f}$ have at the origin?`,
          answer: kind, format: "choice", params: { A, B, C },
          steps: [`Hessian = [[${2 * A}, ${B}], [${B}, ${2 * C}]]`, `det = ${4 * A * C} − ${B * B} = ${det}`,
                  det < 0 ? "det < 0: eigenvalues of opposite sign → saddle"
                          : `det > 0 and f_xx ${A > 0 ? "> 0 → minimum" : "< 0 → maximum"}`],
          trick: "A ball on a saddle rolls off along the negative-curvature direction; so does gradient descent, eventually.",
          mistakes: options.map((o) => ({
            answer: o,
            why: o === diag && diag !== kind
              ? "The diagonal terms alone suggest this, but the xy term changes the Hessian's eigenvalues: check the determinant."
              : det < 0 ? "The Hessian's determinant is negative, so its eigenvalues have opposite signs."
                : `The determinant is positive and f_xx ${A > 0 ? "> 0" : "< 0"}.`,
          })),
        };
      }
    },
  });

  def({
    id: "ml-bootstrap", name: "Sampling with replacement",
    blurb: "n draws with replacement from n examples see about 63% of them.",
    source: d2l("12.5 Minibatch Stochastic Gradient Descent", 3),
    gen(level, r) {
      const n = r.pick(band(level, [[2, 3], [3, 4, 5], [10, 20], [100, 1000], [1e4, 1e6]]));
      const frac = 1 - Math.pow(1 - 1 / n, n);
      const exact = n <= 5;
      const ans = exact ? fmtFrac(n ** n - (n - 1) ** n, n ** n) : fmt(frac, 4);
      return {
        prompt: `An "epoch" draws ${n.toLocaleString()} examples uniformly *with replacement* from a training set of `
          + `${n.toLocaleString()}. What fraction of the training set is seen at least once, in expectation?`,
        answer: ans, params: { n }, tolerance: exact ? 0 : 0.001,
        steps: [`P(an example is never drawn) = (1 − 1/n)^n`, `= ${fmt(Math.pow(1 - 1 / n, n), 4)}`,
                `fraction seen = ${fmt(frac, 4)}${n >= 100 ? ` ≈ 1 − 1/e` : ""}`],
        trick: "Sampling without replacement sees everything once; with replacement wastes about 37% of an epoch on repeats.",
        mistakes: wrong(ans, [
          { answer: "1", why: "Draws with replacement repeat examples, so some are never seen." },
          { answer: fmt(Math.pow(1 - 1 / n, n), 4), why: "That is the fraction never seen; subtract it from 1." },
          { answer: fmt(1 - 1 / n, 4), why: "That is the chance one example is missed on a single draw, not the fraction seen." },
        ]),
      };
    },
  });

  // ---- training practice ---------------------------------------------------------

  def({
    id: "ml-dropout", name: "Inverted dropout",
    blurb: "Keep with probability 1 − p and divide by 1 − p, so the expectation is unchanged.",
    source: d2l("5.6 Dropout", 1, "concept"),
    gen(level, r) {
      const p = r.pick(band(level, [[0.5], [0.5, 0.2], [0.2, 0.25, 0.1], [0.1, 0.3, 0.4], [0.3, 0.4, 0.6]]));
      const h = r.pick([1, 2, 3, 0.6, 1.2, 2.4]);
      const want = h / (1 - p);
      return {
        prompt: `Dropout with probability $p = ${p}$ is applied to a unit with activation $h = ${h}$ during training `
          + `(the "inverted" dropout d2l implements). If the unit is kept, what value does it output?`,
        answer: fmt(want, 4), params: { p, h }, tolerance: 0.001,
        steps: [`kept with probability 1 − p = ${fmt(1 - p, 2)}`, `scaled by 1/(1 − p) so E[h'] = h`,
                `${h}/${fmt(1 - p, 2)} = ${fmt(want, 4)}`],
        trick: "Scaling at training time means nothing changes at test time.",
        mistakes: wrong(fmt(want, 4), [
          { answer: fmt(h * (1 - p), 4), why: "That is test-time scaling in the original formulation; inverted dropout divides during training." },
          { answer: fmt(h / p, 4), why: "Divide by the keep probability 1 − p, not the drop probability p." },
          { answer: fmt(h, 4), why: "Without rescaling, the expected activation would shrink to (1 − p)h." },
        ]),
      };
    },
  });

  def({
    id: "ml-early-stopping", name: "Early stopping with patience",
    blurb: "Stop after `patience` epochs without a new best; keep the best checkpoint.",
    source: d2l("5.5 Generalization in Deep Learning", 3),
    gen(level, r) {
      for (;;) {
        const epochs = band(level, [6, 8, 10, 12, 14]);
        const patience = r.pick(band(level, [[1, 2], [2], [2, 3], [3], [3, 4]]));
        let v = 2 + r.int(0, 10) / 10;
        const losses = [];
        const best = r.int(2, epochs - patience - 1);
        for (let e = 0; e < epochs; e++) {
          if (e <= best) v -= 0.1 + r.int(0, 3) / 10;
          else v += r.int(-1, 3) / 20;
          losses.push(+v.toFixed(2));
        }
        // Simulate the rule, with ties not counting as improvement.
        let bestE = 0, stop = null;
        for (let e = 1; e < epochs; e++) {
          if (losses[e] < losses[bestE]) bestE = e;
          else if (e - bestE >= patience) { stop = e; break; }
        }
        if (stop === null) continue;
        const firstUp = losses.findIndex((x, e) => e > 0 && x > losses[e - 1]);
        const askStop = level >= 3 && r() < 0.5;
        const want = String((askStop ? stop : bestE) + 1);
        return {
          prompt: `Validation loss after each epoch: ${losses.join(", ")}. Early stopping uses patience ${patience}: `
            + `training stops once ${patience} epoch${patience === 1 ? "" : "s"} pass without a new lowest loss. `
            + (askStop ? `After which epoch does training stop? (Count epochs from 1.)`
                       : `Which epoch's weights are kept? (Count epochs from 1.)`),
          answer: want, params: { losses, patience, ask: askStop ? "stop" : "best" },
          steps: [`lowest loss ${losses[bestE]} at epoch ${bestE + 1}`,
                  `no improvement for ${patience} epoch${patience === 1 ? "" : "s"} → stop after epoch ${stop + 1}`,
                  `restore the weights from epoch ${bestE + 1}`],
          trick: "Patience decides when to stop; the checkpoint you keep is the best one.",
          mistakes: wrong(want, [
            { answer: String((askStop ? bestE : stop) + 1),
              why: askStop ? "That is the best epoch; training continues until patience runs out."
                           : "That is when training stops; the kept weights are the best epoch's." },
            { answer: String(epochs), why: "Early stopping ends before the last epoch." },
            ...(firstUp > 0 ? [{ answer: String(firstUp + 1),
              why: "One increase is not enough: patience allows that many epochs without improvement." }] : []),
          ]),
        };
      }
    },
  });

  def({
    id: "ml-kfold", name: "K-fold cross-validation",
    blurb: "K models, each trained on (K−1)/K of the data.",
    source: d2l("5.7 Predicting House Prices on Kaggle", 3, "concept"),
    gen(level, r) {
      const K = r.pick(band(level, [[2, 5], [5, 10], [4, 5, 10], [5, 10], [10, 20]]));
      const n = K * r.int(band(level, [10, 20, 50, 100, 100]), band(level, [20, 100, 300, 1000, 5000]));
      const train = n * (K - 1) / K;
      return {
        prompt: `You tune hyperparameters with ${K}-fold cross-validation on ${n} examples. How many `
          + `examples does each of the ${K} models train on?`,
        answer: String(train), params: { n, K },
        steps: [`each fold holds out n/K = ${n / K}`, `trains on the other ${K - 1} folds: ${train}`],
        trick: "Each example is held out exactly once across the K runs.",
        mistakes: wrong(String(train), [
          { answer: String(n / K), why: "That is the held-out fold; training uses the other K − 1 folds." },
          { answer: String(n), why: "Each model must hold out one fold to be validated on." },
          { answer: String(n * (K - 1)), why: "Divide by K: each of the K − 1 training folds has n/K examples." },
        ]),
      };
    },
  });

  def({
    id: "ml-grad-clip", name: "Gradient clipping by norm",
    blurb: "g ← min(1, θ/‖g‖)·g keeps the direction and caps the length.",
    source: d2l("9.5 Recurrent Neural Network Implementation from Scratch", 10, "concept"),
    gen(level, r) {
      const t = r.pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15]]);
      const g = [t[0] * r.sign(), t[1] * r.sign()], norm = t[2];
      const theta = r.pick(band(level, [[1, 2, 5], [1, 2, 5], [1, 3, 4], [2, 5, 20], [1, 5, 20]]));
      const i = r.int(0, 1);
      const scale = Math.min(1, theta / norm);
      const want = g[i] * scale;
      const exact = fmtFrac(g[i] * Math.min(theta, norm), norm);
      return {
        prompt: `A gradient $\\mathbf{g} = ${vec(g)}$ is clipped to norm $\\theta = ${theta}$ with `
          + `$\\mathbf{g} \\leftarrow \\min(1, \\theta / \\|\\mathbf{g}\\|)\\,\\mathbf{g}$. What is its component $g_${i + 1}$ afterwards?`,
        answer: exact, params: { g, theta, i },
        steps: [`‖g‖ = ${norm}`, `scale = min(1, ${theta}/${norm}) = ${fmt(scale, 4)}`, `g_${i + 1} = ${g[i]}·${fmt(scale, 4)} = ${fmt(want, 4)}`],
        trick: "Clipping by norm shrinks every component by the same factor.",
        mistakes: wrong(exact, [
          { answer: String(Math.max(-theta, Math.min(theta, g[i]))), why: "That clips each component to [−θ, θ], which changes the gradient's direction." },
          { answer: String(g[i]), why: norm > theta ? `‖g‖ = ${norm} exceeds θ = ${theta}, so the gradient is rescaled.` : "Here it is not clipped; check the norm again." },
          { answer: String(g[i] * theta), why: "Multiply by θ/‖g‖, not θ." },
        ]),
      };
    },
  });

  // ---- sequences ----------------------------------------------------------------

  def({
    id: "ml-ngram-table", name: "How big an n-gram table gets",
    blurb: "A dense table of all n-grams over V words has Vⁿ cells.",
    source: d2l("9.3 Language Models", 1),
    gen(level, r) {
      const k = r.pick(band(level, [[2, 3], [3, 4], [4, 5], [5], [5, 6]]));
      const n = r.pick(band(level, [[2], [2, 3], [3, 4], [4], [4, 5]]));
      if (level >= 4 && r() < 0.5) {
        const T = r.pick([1e5, 1e6]);
        return {
          prompt: `A training corpus has ${T.toLocaleString()} tokens. At most how many *distinct* ${n}-grams can it contain?`,
          answer: String(T - n + 1), params: { T, n, ask: "observed" },
          steps: [`${n}-grams start at positions 1 … T − ${n} + 1`, `= ${(T - n + 1).toLocaleString()}`],
          trick: "Observed n-grams are bounded by the corpus, not by Vⁿ: most of the dense table is zeros.",
          mistakes: wrong(String(T - n + 1), [
            { answer: String(T), why: `The last ${n - 1} tokens cannot start a full ${n}-gram.` },
            { answer: String(T / n), why: "n-grams overlap: a new one starts at every token." },
          ]),
        };
      }
      return {
        prompt: `The vocabulary has $10^${k}$ words. A table storing a count for every possible ${n}-gram `
          + `has $10^m$ cells. What is $m$?`,
        answer: String(k * n), params: { k, n, ask: "dense" },
        steps: [`each of the ${n} positions takes any of 10^${k} words`, `(10^${k})^${n} = 10^${k * n}`],
        trick: "This blow-up is why n-gram models need smoothing and why neural models share parameters.",
        mistakes: wrong(String(k * n), [
          { answer: String(k + n), why: "Exponents multiply when a power is raised to a power: (10^k)^n = 10^(kn)." },
          { answer: String(k * (n - 1)), why: `That is the table for ${n - 1}-grams.` },
          { answer: String(k), why: "That is the unigram count; each extra position multiplies it again." },
        ]),
      };
    },
  });

  def({
    id: "ml-padding", name: "Padding cost of whole sentences",
    blurb: "Pad every sentence to the longest in its minibatch; the rest is waste.",
    source: d2l("9.3 Language Models", 5),
    gen(level, r) {
      const B = band(level, [3, 4, 4, 6, 8]);
      const lens = Array.from({ length: B }, () => r.int(3, band(level, [8, 12, 20, 30, 40])));
      const mx = Math.max(...lens), total = B * mx, real = sum(lens);
      const want = fmtFrac(total - real, total);
      return {
        prompt: `A minibatch holds ${B} complete sentences of lengths ${lens.join(", ")} tokens, padded to the `
          + `longest one. What fraction of the batch's token slots is padding?`,
        answer: want, params: { lens },
        steps: [`slots = ${B} × ${mx} = ${total}`, `real tokens = ${real}`, `padding = ${total - real}/${total}`],
        trick: "Bucketing sentences of similar length into the same batch cuts this waste; masking keeps it out of the loss.",
        mistakes: wrong(want, [
          { answer: String(total - real), why: "That is the count of padding slots; the question asks for the fraction." },
          { answer: fmtFrac(total - real, real), why: "Divide by all slots, real and padded, not only the real tokens." },
          { answer: fmtFrac(Math.round(B * (sum(lens) / B)) - real + (total - real), total),
            why: "Pad to the longest sentence, not the average length." },
        ]),
      };
    },
  });

  def({
    id: "ml-onehot-embedding", name: "One-hot times a matrix is a lookup",
    blurb: "e_iᵀW selects row i of W: an embedding table.",
    source: d2l("9.5 Recurrent Neural Network Implementation from Scratch", 3),
    gen(level, r) {
      const V = band(level, [3, 3, 4, 4, 5]), d = band(level, [2, 3, 3, 4, 4]);
      const W = Array.from({ length: V }, () => Array.from({ length: d }, () => r.int(-5, 9)));
      const i = r.int(1, V), j = r.int(1, d);
      const want = W[i - 1][j - 1];
      const tex = `\\begin{pmatrix}${W.map((row) => row.join(" & ")).join(" \\\\ ")}\\end{pmatrix}`;
      const colI = i <= d && j <= V ? W[j - 1][i - 1] : null;
      return {
        prompt: `Token ${i} of a ${V}-word vocabulary is one-hot encoded as $\\mathbf{e}_${i} \\in \\mathbb{R}^${V}$ `
          + `(counting from 1). With $\\mathbf{W} = ${tex}$, what is entry ${j} of $\\mathbf{e}_${i}^\\top \\mathbf{W}$?`,
        answer: String(want), params: { W, i, j },
        steps: [`e_${i}ᵀW picks out row ${i} of W: (${W[i - 1].join(", ")})`, `entry ${j} = ${want}`],
        trick: "An embedding layer is this product, stored as a lookup instead of a matrix multiply.",
        mistakes: wrong(String(want), [
          ...(colI !== null ? [{ answer: String(colI), why: "e_iᵀW is a row vector: it selects row i, not column i." }] : []),
          ...(i > 1 ? [{ answer: String(W[i - 2][j - 1]), why: "Off by one: counting from 1, e_i picks row i." }] : []),
          { answer: String(sum(W.map((row) => row[j - 1]))), why: "A one-hot vector has a single 1, so it selects one row rather than summing them." },
        ]),
      };
    },
  });

  def({
    id: "ml-sinusoid-ar", name: "A sine wave is a two-step recurrence",
    blurb: "sin(ω(t+1)) = 2cos ω · sin(ωt) − sin(ω(t−1)).",
    source: d2l("9.1 Working with Sequences", 1),
    gen(level, r) {
      const w = r.pick([0.1, 0.2, 0.5, 1]);
      const t = r.int(1, 20);
      const x1 = Math.sin(w * (t - 1)), x2 = Math.sin(w * t);
      const want = 2 * Math.cos(w) * x2 - x1;
      return {
        prompt: `A noise-free signal $x_t = \\sin(${w}\\,t)$ has $x_{${t - 1}} = ${fmt(x1, 4)}$ and $x_{${t}} = ${fmt(x2, 4)}$. `
          + `Using only these two past values and $\\omega = ${w}$, predict $x_{${t + 1}}$.`,
        answer: fmt(want, 3), params: { w, t }, tolerance: 0.01,
        steps: [`sin(a + ω) + sin(a − ω) = 2 sin a cos ω`, `x_{t+1} = 2cos(${w})·x_t − x_{t−1}`,
                `= 2·${fmt(Math.cos(w), 4)}·${fmt(x2, 4)} − ${fmt(x1, 4)} = ${fmt(want, 3)}`],
        trick: "So without noise, two past observations suffice: the answer to d2l's “how many do you need?”.",
        mistakes: wrong(fmt(want, 3), [
          { answer: fmt(2 * x2 - x1, 3), why: "That is linear extrapolation; the recurrence has a factor 2cos ω." },
          { answer: fmt(Math.cos(w) * x2 - x1, 3), why: "The coefficient is 2cos ω, from sin(a+ω) + sin(a−ω) = 2 sin a cos ω." },
          { answer: fmt(x2 + (x2 - x1), 3), why: "A constant-slope guess ignores the curvature of the sine." },
        ]),
      };
    },
  });

  // ---- attention ------------------------------------------------------------------

  def({
    id: "ml-additive-params", name: "Parameters of additive attention",
    blurb: "W_q (h×q), W_k (h×k) and w_v (h): dot-product scoring has none.",
    source: d2l("11.4 The Bahdanau Attention Mechanism", 2),
    gen(level, r) {
      const q = r.pick(band(level, [[2, 4], [4, 8], [16, 32], [64, 128], [256, 512]]));
      const k = level <= 2 ? q : r.pick([q, q * 2]);
      const h = r.pick(band(level, [[2, 3], [4, 8], [16, 32], [64, 128], [256]]));
      const total = h * q + h * k + h;
      return {
        prompt: `Additive attention scores a query $\\mathbf{q} \\in \\mathbb{R}^{${q}}$ against a key `
          + `$\\mathbf{k} \\in \\mathbb{R}^{${k}}$ as $\\mathbf{w}_v^\\top \\tanh(\\mathbf{W}_q\\mathbf{q} + \\mathbf{W}_k\\mathbf{k})$ `
          + `with ${h} hidden units and no biases. How many learnable parameters does the scoring function have? `
          + `(Scaled dot-product scoring has none.)`,
        answer: String(total), params: { q, k, h },
        steps: [`W_q: ${h}×${q} = ${h * q}`, `W_k: ${h}×${k} = ${h * k}`, `w_v: ${h}`, `total ${total}`],
        trick: "Swapping in dot-product scoring removes these parameters, but needs q and k to have the same size.",
        mistakes: wrong(String(total), [
          { answer: String(h * q + h * k), why: "w_v, the vector that turns the hidden features into a score, has h parameters too." },
          { answer: String(q * k), why: "That is a bilinear score qᵀWk; additive attention goes through h hidden units." },
          { answer: String(h * (q + k + 1) + 2 * h + 1), why: "The question says no biases." },
        ]),
      };
    },
  });

  def({
    id: "ml-additive-memory", name: "Memory of additive attention",
    blurb: "Additive attention materializes a (batch, queries, keys, hidden) tensor.",
    source: d2l("11.7 The Transformer Architecture", 2),
    gen(level, r) {
      const B = r.pick(band(level, [[1, 2], [2, 4], [8, 16], [16, 32], [32, 64]]));
      const n = r.pick(band(level, [[3, 4], [8, 10], [32, 64], [128, 256], [512, 1024]]));
      const h = r.pick(band(level, [[2, 4], [8, 16], [32, 64], [64, 128], [128, 256]]));
      const add = B * n * n * h;
      return {
        prompt: `Self-attention over ${n} tokens, batch size ${B}. Additive scoring computes `
          + `$\\tanh(\\mathbf{W}_q\\mathbf{q}_i + \\mathbf{W}_k\\mathbf{k}_j)$ with ${h} hidden units for every query–key pair `
          + `before reducing it to a score. How many numbers does that intermediate tensor hold?`,
        answer: String(add), params: { B, n, h },
        steps: [`one ${h}-vector per (batch, query, key)`, `${B}×${n}×${n}×${h} = ${add.toLocaleString()}`,
                `dot-product scoring needs only the ${B}×${n}×${n} = ${(B * n * n).toLocaleString()} scores`],
        trick: "That extra factor of h is why the Transformer uses scaled dot-product attention.",
        mistakes: wrong(String(add), [
          { answer: String(B * n * n), why: "That is the score matrix; additive attention first builds an h-vector per pair." },
          { answer: String(B * n * h), why: "Every query meets every key: that is n², not n." },
          { answer: String(n * n * h), why: "Multiply by the batch size too." },
        ]),
      };
    },
  });

  def({
    id: "ml-attention-cov", name: "Attention's gradient is a covariance",
    blurb: "With k = v and dot-product scores, ∇_q Attention = Cov_p[k].",
    source: d2l("11.1 Queries, Keys, and Values", 2),
    gen(level, r) {
      const keys = Array.from({ length: 3 }, () => [r.int(-2, 2), r.int(-2, 2)]);
      const q = level <= 2 ? [0, 0] : [r.pick([-1, 0, 1]) * 0.5, r.pick([-1, 1]) * 0.5];
      const s = keys.map((k) => k[0] * q[0] + k[1] * q[1]);
      const mx = Math.max(...s);
      const e = s.map((x) => Math.exp(x - mx)), Z = sum(e);
      const p = e.map((x) => x / Z);
      const d = r.int(0, 1);
      const mean = sum(p.map((pi, i) => pi * keys[i][d]));
      const second = sum(p.map((pi, i) => pi * keys[i][d] ** 2));
      const cov = second - mean * mean;
      const uni = level <= 2;
      const show = (x) => (uni ? fmtFrac(Math.round(x * 9), 9) : fmt(x, 4));
      if (keys.every((k) => k[d] === keys[0][d])) return this.gen(level, r);
      return {
        prompt: `Attention with scores $a(\\mathbf{q}, \\mathbf{k}_i) = \\mathbf{q}^\\top\\mathbf{k}_i$, softmax weights, and values `
          + `equal to keys: $\\mathrm{Attention}(\\mathbf{q}) = \\sum_i p_i \\mathbf{k}_i$. The keys are `
          + `${keys.map((k) => vec(k)).join(", ")} and $\\mathbf{q} = ${vec(q)}$. What is the $(${d + 1},${d + 1})$ entry of `
          + `the Jacobian $\\nabla_{\\mathbf{q}} \\mathrm{Attention}(\\mathbf{q})$?`,
        answer: show(cov), params: { keys, q, d }, tolerance: uni ? 0 : 0.002,
        steps: [`weights p = softmax(qᵀk_i) = (${p.map((x) => fmt(x, 3)).join(", ")})`,
                `the Jacobian equals Cov_p[k] = E_p[kkᵀ] − E_p[k]E_p[k]ᵀ`,
                `entry: ${fmt(second, 4)} − ${fmt(mean, 4)}² = ${fmt(cov, 4)}`],
        trick: "Moving q toward a key raises its weight; the covariance measures how much the output moves.",
        mistakes: wrong(show(cov), [
          { answer: show(second), why: "That is E[k²]; the covariance subtracts the squared mean." },
          { answer: show(mean), why: "That is the attention output itself, not its derivative." },
          { answer: show(mean * mean), why: "That is only the term being subtracted." },
        ]),
      };
    },
  });

  def({
    id: "ml-sinusoidal-pe", name: "Sinusoidal positional encoding",
    blurb: "PE(pos, 2i) = sin(pos / 10000^{2i/d}), PE(pos, 2i+1) = cos(same).",
    source: d2l("11.6 Self-Attention and Positional Encoding", 2, "concept"),
    gen(level, r) {
      const d = r.pick(band(level, [[4], [4, 8], [8, 16], [16, 32], [32, 64]]));
      const pos = r.int(1, band(level, [3, 5, 10, 20, 50]));
      const col = level <= 1 ? r.int(0, 1) : r.int(0, Math.min(d - 1, 5));
      const i = Math.floor(col / 2);
      const angle = pos / Math.pow(10000, (2 * i) / d);
      const val = col % 2 ? Math.cos(angle) : Math.sin(angle);
      return {
        prompt: `Transformer positional encodings use $P_{\\text{pos},2i} = \\sin(\\text{pos}/10000^{2i/d})$ and `
          + `$P_{\\text{pos},2i+1} = \\cos(\\text{pos}/10000^{2i/d})$ with $d = ${d}$. What is $P_{${pos},${col}}$ `
          + `(columns counted from 0, angles in radians)?`,
        answer: fmt(val, 3), params: { d, pos, col }, tolerance: 0.01,
        steps: [`column ${col} → i = ${i}, ${col % 2 ? "cos" : "sin"}`, `angle = ${pos}/10000^(${2 * i}/${d}) = ${fmt(angle, 4)}`,
                `${col % 2 ? "cos" : "sin"}(${fmt(angle, 4)}) = ${fmt(val, 3)}`],
        trick: "A learnable alternative is a table of max_len × d parameters; it cannot extrapolate past max_len.",
        mistakes: wrong(fmt(val, 3), [
          { answer: fmt(col % 2 ? Math.sin(angle) : Math.cos(angle), 3), why: "Even columns use sine and odd columns cosine." },
          { answer: fmt((col % 2 ? Math.cos : Math.sin)(pos / Math.pow(10000, col / d)), 3),
            why: "The exponent uses 2i, the even index of the pair, for both of its columns." },
        ]),
      };
    },
  });

  def({
    id: "ml-nullspace-proj", name: "Projecting onto a subspace",
    blurb: "For {x : wᵀx = 0}, Proj = I − wwᵀ/(wᵀw), a matrix.",
    source: d2l("12.2 Convexity", 6),
    gen(level, r) {
      const a = r.int(1, 4) * r.sign(), b = r.int(1, 4) * r.sign();
      const n2 = a * a + b * b;
      const which = level <= 2 ? [0, 0] : r.pick([[0, 0], [0, 1], [1, 1]]);
      const Mij = which[0] === which[1]
        ? (which[0] === 0 ? b * b : a * a)
        : -a * b;
      const want = fmtFrac(Mij, n2);
      return {
        prompt: `$\\mathcal{X} = \\{\\mathbf{x} \\in \\mathbb{R}^2 : ${a}x_1 ${b < 0 ? "-" : "+"} ${Math.abs(b)}x_2 = 0\\}$ `
          + `is a linear subspace, so projection onto it is $\\mathbf{x} \\mapsto \\mathbf{M}\\mathbf{x}$. `
          + `What is $M_{${which[0] + 1}${which[1] + 1}}$?`,
        answer: want, params: { a, b, which },
        steps: [`w = (${a}, ${b}), wᵀw = ${n2}`, `M = I − wwᵀ/${n2}`,
                `M = (1/${n2})·[[${b * b}, ${-a * b}], [${-a * b}, ${a * a}]]`],
        trick: "Remove the component along the normal vector w; what remains lies in the subspace.",
        mistakes: wrong(want, [
          { answer: fmtFrac(which[0] === which[1] ? (which[0] === 0 ? a * a : b * b) : a * b, n2),
            why: "That is wwᵀ/(wᵀw), the projection onto the normal direction; subtract it from I." },
          { answer: fmtFrac(which[0] === which[1] ? n2 - (which[0] === 0 ? b * b : a * a) : a * b, n2),
            why: "The diagonal of I − wwᵀ/‖w‖² pairs x₁ with the *other* coefficient squared." },
          { answer: String(which[0] === which[1] ? 1 : 0), why: "That is the identity: the subspace is a line, so projection changes x." },
        ]),
      };
    },
  });

  def({
    id: "ml-linear-rank", name: "Depth without nonlinearity",
    blurb: "A product of linear layers has rank at most its narrowest width.",
    source: d2l("5.1 Multilayer Perceptrons", 1),
    gen(level, r) {
      const L = band(level, [2, 3, 3, 4, 5]);
      for (;;) {
        const widths = Array.from({ length: L + 1 }, () => r.int(2, band(level, [5, 8, 16, 32, 64])));
        const mn = Math.min(...widths);
        const inner = Math.min(...widths.slice(1, -1));
        if (inner !== mn || widths[0] === mn || widths.at(-1) === mn) continue;
        return {
          prompt: `A ${L}-layer network with *no* nonlinearities maps $\\mathbb{R}^{${widths[0]}}$ to `
            + `$\\mathbb{R}^{${widths.at(-1)}}$ through widths ${widths.join(" → ")}. What is the largest possible `
            + `rank of the map it computes?`,
          answer: String(mn), params: { widths },
          steps: [`the network computes one matrix W_${L}⋯W_1`, `rank of a product ≤ rank of each factor`,
                  `the ${mn}-wide layer caps it at ${mn}`],
          trick: "Depth adds no expressiveness without nonlinearity, and a narrow layer removes some.",
          mistakes: wrong(String(mn), [
            { answer: String(Math.min(widths[0], widths.at(-1))), why: `A ${mn}-wide hidden layer is a bottleneck the product cannot exceed.` },
            { answer: String(widths[0]), why: "The input dimension is only one bound; the narrowest layer is tighter." },
            { answer: String(widths.reduce((a, b) => a * b, 1)), why: "Stacking linear layers composes the maps; ranks don't multiply." },
          ]),
        };
      }
    },
  });

  def({
    id: "ml-backprop-memory", name: "What backprop has to remember",
    blurb: "The backward pass needs every intermediate from the forward pass.",
    source: d2l("5.3 Forward Propagation, Backward Propagation, and Computational Graphs", 3),
    gen(level, r) {
      const d = r.pick(band(level, [[4, 8], [16, 32], [64, 128], [256, 784], [784, 1024]]));
      const h = r.pick(band(level, [[3, 4], [8, 16], [32, 64], [128, 256], [256, 512]]));
      const q = r.pick(band(level, [[2, 3], [3, 10], [10], [10, 100], [10, 1000]]));
      const B = r.pick(band(level, [[1], [1, 2], [8, 16], [32, 64], [128, 256]]));
      const keep = B * (2 * h + q);
      return {
        prompt: `The one-hidden-layer network of d2l §5.3 computes $\\mathbf{z} = \\mathbf{W}^{(1)}\\mathbf{x}$, `
          + `$\\mathbf{h} = \\phi(\\mathbf{z})$ and $\\mathbf{o} = \\mathbf{W}^{(2)}\\mathbf{h}$ with $\\mathbf{x} \\in \\mathbb{R}^{${d}}$, `
          + `${h} hidden units and ${q} outputs. For a minibatch of ${B}, how many intermediate values ($\\mathbf{z}$, `
          + `$\\mathbf{h}$, $\\mathbf{o}$) must be kept for the backward pass?`,
        answer: String(keep), params: { d, h, q, B },
        steps: [`per example: z (${h}) + h (${h}) + o (${q}) = ${2 * h + q}`, `× batch ${B} = ${keep}`,
                `prediction can discard each one as soon as the next layer is computed`],
        trick: "Training memory grows with batch size and depth; inference memory does not.",
        mistakes: wrong(String(keep), [
          { answer: String(B * (h + q)), why: "φ'(z) needs z itself, in addition to h, so both are kept." },
          { answer: String(2 * h + q), why: "Every example in the minibatch has its own activations." },
          { answer: String(h * d + q * h), why: "That is the number of parameters, which is kept either way." },
        ]),
      };
    },
  });

  // ---- concepts with no single number: statement banks -----------------------------
  // Each draw picks one correct statement and three misconceptions from a bank,
  // so repeated practice does not become recognition of one fixed question.

  function statements(id, name, blurb, source, stem, right, wrongs) {
    def({
      id, name, blurb, source,
      gen(level, r) {
        const pick = (xs, n) => [...xs].sort(() => r() - 0.5).slice(0, n);
        const answer = r.pick(right);
        return {
          prompt: stem, answer, format: "choice", params: {},
          steps: [answer], trick: blurb,
          mistakes: pick(wrongs, 3).map(([text, why]) => ({ answer: text, why })),
        };
      },
    });
  }

  statements("ml-rnn-history", "Truncation length in RNN training",
    "num_steps sets how far back the gradient flows.",
    d2l("9.5 Recurrent Neural Network Implementation from Scratch", 2),
    "In d2l's RNN training code, which hyperparameter controls how much history the model is trained to use for a prediction?",
    ["num_steps, the length of each training subsequence, because backpropagation is truncated there.",
     "The subsequence length (num_steps): gradients never flow further back than one subsequence."],
    [["num_hiddens, the size of the hidden state.", "The hidden size limits how much can be remembered, not how far back gradients reach."],
     ["batch_size.", "Batch size sets how many subsequences are processed in parallel, not their length."],
     ["The learning rate.", "The learning rate scales updates; it does not decide which time steps get gradient."],
     ["The vocabulary size.", "Vocabulary size is the width of the input, not a time horizon."]]);

  statements("ml-past-returns", "Why past returns mislead",
    "A sequence model assumes the future looks like the past.",
    d2l("9.1 Working with Sequences", 2),
    "An investor picks the security with the best past returns, expecting it to keep doing well. What is the core statistical problem?",
    ["The data are not stationary: the process generating returns changes, so past performance need not predict future returns.",
     "Markets adapt to known patterns, so the distribution shifts and an extrapolated trend stops holding."],
    [["There are too few data points to fit a model.", "Even with plenty of history, a shifting distribution breaks the prediction."],
     ["Returns are discrete, so regression cannot be used.", "Returns are continuous; the problem is non-stationarity, not the data type."],
     ["The model should use more recent data only.", "Recency helps a little, but it doesn't solve the underlying distribution shift."],
     ["Past returns are the best possible predictor, so nothing goes wrong.", "That assumes the process is stationary, which markets are not."]]);

  statements("ml-model-parallel", "Splitting a network across GPUs",
    "Model parallelism trades memory for communication and idle time.",
    d2l("5.3 Forward Propagation, Backward Propagation, and Computational Graphs", 5),
    "A network's computational graph no longer fits on one GPU, so you split its layers across two. What is the main cost compared with training on one GPU with a smaller minibatch?",
    ["Activations must be sent between GPUs at every split, and each GPU idles while it waits for the other.",
     "Communication between devices and pipeline stalls: one GPU waits on the other's layers."],
    [["It changes the mathematical result of the forward pass.", "Splitting layers computes the same function; only where it runs changes."],
     ["It is impossible to backpropagate across devices.", "Autograd handles cross-device graphs; the cost is transfer time."],
     ["It needs twice as many parameters.", "The parameters are divided between the GPUs, not duplicated."],
     ["A smaller minibatch always gives worse final accuracy.", "Small batches are noisier, but that is not the cost of splitting the model."]]);
})();
