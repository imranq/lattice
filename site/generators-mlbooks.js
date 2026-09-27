// Machine-learning generators for the parts of the ML books nothing else reaches:
// Dive into Deep Learning chapters 8 and 10–21 (modern CNNs, modern RNNs,
// computational performance, vision, NLP, reinforcement learning, Gaussian
// processes, hyperparameter optimisation, GANs, recommenders), and the topics of
// Bishop & Bishop, Deep Learning: Foundations and Concepts, and Murphy,
// Probabilistic Machine Learning: An Introduction. d2l is CC BY-SA; Bishop and
// Murphy are copyrighted, so as with the other reference books every problem
// here is our own, tied to the chapter by concept id.
//
// It also tags existing generators with the Bishop and Murphy chapters they
// already practise, so those books' course pages offer them.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M) return;
  const { band, gcd } = M.util;
  const ML = "machine learning";

  const BOOK = {
    d2l: ["Dive into Deep Learning", "https://d2l.ai/"],
    bishop: ["Bishop & Bishop, Deep Learning: Foundations and Concepts", "https://www.bishopbook.com/"],
    pml: ["Murphy, Probabilistic Machine Learning: An Introduction", "https://probml.github.io/pml-book/book1.html"],
  };
  const cite = (book, section, fidelity = book === "d2l" ? "concept" : "inspired") => ({
    book: book === "bishop" ? "deep_learning_bishop" : book === "pml" ? "pml_book1" : book,
    title: BOOK[book][0], section, url: BOOK[book][1], fidelity,
  });
  // "d2l:8", "bishop:2.3", "bishop:ch12", "pml:6" → concept ids
  const cid = (c) => {
    const [b, s] = c.split(":");
    if (b === "d2l") return `concept:d2l:ch${s}`;
    if (b === "pml") return `concept:pml_book1:ch${s}`;
    return `concept:deep_learning_bishop:${s}`;
  };
  const def = (concepts, g) => M.define({ domain: ML, prose: true, ...g, concepts: concepts.map(cid) });

  const fmt = (x, dp = 4) => String(Number(x.toFixed(dp)));
  const wrong = (answer, list) => list.filter((m, i) => m.answer !== undefined && m.answer !== answer
    && !/NaN|Infinity|undefined/.test(String(m.answer)) && list.findIndex((x) => x.answer === m.answer) === i);
  const F = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
  const str = (a) => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const val = (a) => a.n / a.d;

  // ==== d2l 8: modern CNNs (and Bishop 10) ===========================================

  def(["d2l:8", "d2l:7", "bishop:ch10"], {
    id: "dl-conv-cost", name: "Size, parameters and cost of a conv layer",
    blurb: "out = ⌊(n − k + 2p)/s⌋ + 1; params = cᵢₙcₒᵤₜk² + cₒᵤₜ; MACs = cᵢₙcₒᵤₜk²·out².",
    source: cite("d2l", "8.1 Deep Convolutional Neural Networks (AlexNet)"),
    gen(level, r) {
      const layers = [[224, 3, 96, 11, 4, 1], [224, 3, 64, 7, 2, 3], [56, 64, 64, 3, 1, 1], [28, 128, 256, 3, 2, 1], [27, 96, 256, 5, 1, 2], [13, 256, 384, 3, 1, 1], [32, 3, 32, 3, 1, 1], [28, 1, 6, 5, 1, 2]];
      const [n, cin, cout, k, s, p] = r.pick(layers);
      const out = Math.floor((n - k + 2 * p) / s) + 1;
      const params = cin * cout * k * k + cout;
      const macs = cin * cout * k * k * out * out;
      const ask = band(level, ["out", "out", "params", "macs", "macs"]);
      const q = `A convolution with ${cout} output channels, kernel ${k}×${k}, stride ${s} and padding ${p} is applied to a ${cin}-channel ${n}×${n} input.`;
      if (ask === "out") {
        return {
          prompt: `${q} What is the output height?`, answer: String(out), params: { n, cin, cout, k, s, p, ask },
          steps: [`⌊(${n} − ${k} + 2·${p})/${s}⌋ + 1 = ${out}`], trick: "Padding adds to both sides; stride divides.",
          mistakes: wrong(String(out), [
            { answer: String(Math.floor((n - k + p) / s) + 1), why: "Padding goes on both sides: add 2p." },
            { answer: String(Math.floor((n - k + 2 * p) / s)), why: "Add 1: the first position counts." },
            { answer: String(Math.floor(n / s)), why: "The kernel size and padding change the output size too." },
          ]),
        };
      }
      if (ask === "params") {
        return {
          prompt: `${q} How many parameters does it have, including biases?`, answer: String(params), params: { n, cin, cout, k, s, p, ask },
          steps: [`${cin}·${cout}·${k}² = ${cin * cout * k * k} weights`, `+ ${cout} biases = ${params}`],
          trick: "Parameters don't depend on the input's height or width.",
          mistakes: wrong(String(params), [
            { answer: String(cin * cout * k * k), why: "Add one bias per output channel." },
            { answer: String(cout * k * k + cout), why: "Each filter spans all input channels: multiply by cᵢₙ." },
            { answer: String(params * out * out), why: "Weights are shared across positions." },
          ]),
        };
      }
      const mm = fmt(macs / 1e6, 2);
      return {
        prompt: `${q} How many multiply–accumulates does one forward pass take, in millions (ignore biases)?`,
        answer: mm, params: { n, cin, cout, k, s, p, ask }, tolerance: 0.01,
        steps: [`output ${out}×${out}×${cout}`, `each output needs ${cin}·${k}² = ${cin * k * k} MACs`, `${out * out * cout}·${cin * k * k} = ${macs} ≈ ${mm} M`],
        trick: "Cost = (number of outputs) × (work per output).",
        mistakes: wrong(mm, [
          { answer: fmt((cin * cout * k * k * n * n) / 1e6, 2), why: `Use the output size ${out}×${out}, not the input size.` },
          { answer: fmt((cout * k * k * out * out) / 1e6, 2), why: "Each output sums over every input channel." },
        ]),
      };
    },
  });

  def(["d2l:8", "d2l:7", "bishop:ch10"], {
    id: "dl-receptive-field", name: "Receptive field of stacked layers",
    blurb: "RF = 1 + Σ (kᵢ − 1)·∏_{j<i} sⱼ: later layers see further because earlier strides multiply.",
    source: cite("d2l", "8.2 Networks Using Blocks (VGG)"),
    gen(level, r) {
      const L = r.int(2, band(level, [2, 3, 4, 5, 6]));
      const ls = Array.from({ length: L }, () => [r.pick([3, 3, 5, 7, 2]), level <= 1 ? 1 : r.pick([1, 1, 2])]);
      let rf = 1, jump = 1;
      for (const [k, s] of ls) { rf += (k - 1) * jump; jump *= s; }
      const naive = 1 + sum(ls.map(([k]) => k - 1));
      return {
        prompt: `Layers applied in order: ${ls.map(([k, s]) => `${k}×${k} (stride ${s})`).join(", ")}. What is the receptive field (in input pixels, along one side) of one output unit?`,
        answer: String(rf), params: { ls },
        steps: ls.map(([k, s], i) => `layer ${i + 1}: +(${k} − 1)·(stride product so far)`).concat([`RF = ${rf}`]),
        trick: "Two 3×3 layers see 5×5; three see 7×7: VGG's argument.",
        mistakes: wrong(String(rf), [
          { answer: String(naive), why: "Strides of earlier layers multiply the growth of later ones." },
          { answer: String(Math.max(...ls.map(([k]) => k))), why: "Stacking layers grows the receptive field." },
          { answer: String(ls.reduce((a, [k]) => a * k, 1)), why: "Receptive fields add (k − 1) per layer, scaled by strides; they don't multiply." },
        ]),
      };
    },
  });

  def(["d2l:8", "bishop:7.4"], {
    id: "dl-batchnorm", name: "Batch normalization",
    blurb: "x̂ = (x − μ_B)/√(σ²_B + ε), then y = γx̂ + β; statistics use the 1/m variance.",
    source: cite("d2l", "8.5 Batch Normalization"),
    gen(level, r) {
      const ask = level <= 1 ? "params" : r.pick(["params", "value", "value"]);
      if (ask === "params") {
        const c = r.pick([16, 32, 64, 128, 256]);
        return {
          prompt: `A batch-norm layer follows a convolution with ${c} output channels. How many *learnable* parameters does it have?`,
          answer: String(2 * c), params: { ask, c },
          steps: [`one scale γ and one shift β per channel: 2·${c}`], trick: "The running mean and variance are buffers, not learned parameters.",
          mistakes: wrong(String(2 * c), [
            { answer: String(4 * c), why: "The running mean and variance are updated by averaging, not by gradients." },
            { answer: String(c), why: "Both γ and β are learned." },
          ]),
        };
      }
      for (;;) {
        const xs = Array.from({ length: 4 }, () => r.int(-4, 8));
        const mu = sum(xs) / 4, v = sum(xs.map((x) => (x - mu) ** 2)) / 4;
        if (v === 0) continue;
        const g = r.pick([1, 2, 0.5]), b = r.pick([0, 1, -1]);
        const x = xs[0];
        const y = g * (x - mu) / Math.sqrt(v) + b;
        const vu = v * 4 / 3;
        return {
          prompt: `A minibatch holds the values ${xs.join(", ")} for one feature. With γ = ${g}, β = ${b} and ε = 0, what does batch norm output for the first value, ${x}?`,
          answer: fmt(y), params: { ask, xs, g, b }, tolerance: 0.002,
          steps: [`μ = ${fmt(mu)}, σ² = ${fmt(v)} (divide by m = 4)`, `x̂ = (${x} − ${fmt(mu)})/${fmt(Math.sqrt(v))} = ${fmt((x - mu) / Math.sqrt(v))}`, `y = ${g}·x̂ + ${b} = ${fmt(y)}`],
          trick: "Normalise with the batch's own mean and (biased) variance.",
          mistakes: wrong(fmt(y), [
            { answer: fmt(g * (x - mu) / Math.sqrt(vu) + b), why: "Batch norm uses the 1/m variance, not the unbiased 1/(m − 1)." },
            { answer: fmt(g * (x - mu) / v + b), why: "Divide by the standard deviation, not the variance." },
            { answer: fmt((x - mu) / Math.sqrt(v)), why: g === 1 && b === 0 ? "" : "Apply the scale γ and shift β afterwards." },
          ].filter((m) => m.why)),
        };
      }
    },
  });

  def(["d2l:8"], {
    id: "dl-densenet", name: "Channels in a DenseNet",
    blurb: "A dense block with L layers of growth rate g adds L·g channels; a transition layer usually halves them.",
    source: cite("d2l", "8.7 Densely Connected Networks (DenseNet)"),
    gen(level, r) {
      const c0 = r.pick([32, 64, 96]), g = r.pick([12, 16, 32]), L = r.int(2, 8);
      const blocks = band(level, [1, 1, 2, 2, 3]);
      let c = c0;
      const steps = [];
      for (let b = 0; b < blocks; b++) {
        c += L * g; steps.push(`after block ${b + 1}: ${c}`);
        if (b < blocks - 1) { c = Math.floor(c / 2); steps.push(`transition: ${c}`); }
      }
      return {
        prompt: `A DenseNet starts with ${c0} channels. It has ${blocks} dense block${blocks > 1 ? "s" : ""} of ${L} convolution layers each, growth rate ${g}${blocks > 1 ? ", with a transition layer halving the channels between blocks" : ""}. How many channels come out of the last block?`,
        answer: String(c), params: { c0, g, L, blocks },
        steps, trick: "Each layer concatenates g new channels onto everything before it.",
        mistakes: wrong(String(c), [
          { answer: String(c0 + blocks * L * g), why: blocks > 1 ? "The transition layers halve the channels between blocks." : "" },
          { answer: String(L * g), why: "Concatenation keeps the input channels too." },
          { answer: String(c0 * 2 ** L), why: "Each layer adds g channels; it doesn't double them." },
        ].filter((m) => m.why)),
      };
    },
  });

  // ==== d2l 9–10: recurrent networks ==================================================

  def(["d2l:10", "d2l:9"], {
    id: "dl-rnn-params", name: "Parameters of RNN, GRU and LSTM layers",
    blurb: "Each gate has W_x (d×h), W_h (h×h) and a bias: RNN 1 set, GRU 3, LSTM 4.",
    source: cite("d2l", "10.1 Long Short-Term Memory (LSTM)"),
    gen(level, r) {
      const cell = r.pick(band(level, [["RNN", "LSTM"], ["GRU", "LSTM"], ["LSTM", "GRU"], ["LSTM", "GRU"], ["LSTM", "GRU"]]));
      const gates = { RNN: 1, GRU: 3, LSTM: 4 }[cell];
      const d = r.pick([8, 28, 32, 64, 100]), h = r.pick([16, 32, 64, 128, 256]);
      const bi = level >= 4 && r() < 0.5;
      const one = gates * (h * (d + h) + h);
      const ans = one * (bi ? 2 : 1);
      return {
        prompt: `How many parameters does a ${bi ? "bidirectional " : ""}single-layer ${cell} with input size ${d} and hidden size ${h} have (one bias vector per gate)?`,
        answer: String(ans), params: { cell, d, h, bi },
        steps: [`per gate: ${d}·${h} + ${h}·${h} + ${h} = ${h * (d + h) + h}`, `${gates} gate${gates > 1 ? "s" : ""}${cell === "LSTM" ? " (input, forget, output, candidate)" : cell === "GRU" ? " (reset, update, candidate)" : ""}: ${one}`, ...(bi ? [`two directions: ${ans}`] : [])],
        trick: "The recurrence W_h is h×h for every gate.",
        mistakes: wrong(String(ans), [
          { answer: String(gates * (d * h + h) * (bi ? 2 : 1)), why: "Each gate also has a hidden-to-hidden matrix, h×h." },
          { answer: String((h * (d + h) + h) * (bi ? 2 : 1)), why: cell === "RNN" ? "" : `A ${cell} has ${gates} gates, each with its own weights.` },
          { answer: String(one), why: bi ? "A bidirectional layer has separate weights for each direction." : "" },
        ].filter((m) => m.why)),
      };
    },
  });

  def(["d2l:10"], {
    id: "dl-birnn-shape", name: "Shapes in bidirectional RNNs",
    blurb: "The forward and backward hidden states are concatenated: the output width is h_f + h_b.",
    source: cite("d2l", "10.4 Bidirectional Recurrent Neural Networks"),
    gen(level, r) {
      const n = r.pick([2, 4, 32]), T = r.int(5, 40), hf = r.pick([16, 32, 64]), hb = level >= 3 ? r.pick([8, 16, 32, 64]) : hf;
      return {
        prompt: `A bidirectional RNN reads a batch of ${n} sequences of length ${T}. The forward direction has ${hf} hidden units and the backward ${hb}. What is the shape of $\\mathbf{H}_t$ (the combined hidden state at one time step)?`,
        answer: `(${n}, ${hf + hb})`, kind: "shape", params: { n, T, hf, hb },
        steps: [`H_t = concat(→H_t, ←H_t) along features`, `(${n}, ${hf} + ${hb})`],
        trick: "Concatenate along the feature axis; batch size stays.",
        mistakes: wrong(`(${n}, ${hf + hb})`, [
          { answer: `(${n}, ${Math.max(hf, hb)})`, why: "The two directions are concatenated, not merged into one." },
          { answer: `(${T}, ${n}, ${hf + hb})`, why: "That's the whole output sequence; H_t is one step." },
          { answer: `(${2 * n}, ${hf})`, why: "Directions stack along features, not the batch." },
        ]),
      };
    },
  });

  def(["d2l:10"], {
    id: "dl-beam-search", name: "The cost of beam search",
    blurb: "Greedy scores |Y| continuations per step, beam search k·|Y|, exhaustive search |Y|^T sequences.",
    source: cite("d2l", "10.8 Beam Search"),
    gen(level, r) {
      const Y = r.pick([5, 10, 100, 1000, 10000]), k = r.int(2, 10), T = r.int(3, 10);
      const ask = r.pick(band(level, [["step"], ["step", "total"], ["total", "exh"], ["exh", "total"], ["total", "exh"]]));
      const [q, ans, steps, mist] = {
        step: [`With vocabulary size ${Y} and beam size ${k}, how many candidate sequences does beam search score at each step (after the first)?`, k * Y, [`each of the ${k} beams extends by every token`], [[Y, "That is greedy search, one beam."], [k, "Each beam is extended by all |Y| tokens before pruning back to k."]]],
        total: [`With vocabulary ${Y}, beam size ${k} and output length ${T}, about how many candidates are scored in total (first step ${Y}, then ${k}·${Y} per step)?`, Y + (T - 1) * k * Y, [`${Y} + (${T} − 1)·${k}·${Y}`], [[T * Y, "That is greedy search."], [Y ** Math.min(T, 4) > 1e12 ? 0 : Y ** T, "That's exhaustive search."]]],
        exh: [`How many output sequences of length ${T} over a vocabulary of ${Y} tokens would exhaustive search have to score? Give log₁₀ of that number.`, T * Math.log10(Y), [`|Y|^T = ${Y}^${T}`, `log₁₀ = ${T}·log₁₀ ${Y}`], [[Math.log10(T * Y), "Exhaustive search scores |Y|^T sequences, not T·|Y|."], [Math.log10(k * Y * T), "That's roughly beam search's cost."]]],
      }[ask];
      const a = ask === "exh" ? fmt(ans, 3) : String(ans);
      return {
        prompt: q, answer: a, params: { Y, k, T, ask }, tolerance: ask === "exh" ? 0.001 : undefined,
        steps, trick: "Beam search trades optimality for linear cost in T.",
        mistakes: wrong(a, mist.filter(([v]) => v > 0 && v < 1e9).map(([v, why]) => ({ answer: ask === "exh" ? fmt(v, 3) : String(v), why }))),
      };
    },
  });

  def(["d2l:10"], {
    id: "dl-bleu", name: "BLEU by hand",
    blurb: "Clipped n-gram precision pₙ, times a brevity penalty exp(min(0, 1 − len_label/len_pred)).",
    source: cite("d2l", "10.7 Sequence-to-Sequence Learning for Machine Translation", "faithful"),
    gen(level, r) {
      const vocab = ["a", "b", "c", "d", "e"];
      for (;;) {
        const lab = Array.from({ length: r.int(4, 6) }, () => r.pick(vocab));
        const pred = Array.from({ length: r.int(3, lab.length) }, () => r.pick(vocab));
        const grams = (xs, n) => xs.slice(0, xs.length - n + 1).map((_, i) => xs.slice(i, i + n).join(" "));
        const pn = (n) => {
          const P = grams(pred, n), Lc = {};
          grams(lab, n).forEach((g) => { Lc[g] = (Lc[g] ?? 0) + 1; });
          let hit = 0;
          for (const g of P) if (Lc[g] > 0) { hit++; Lc[g]--; }
          return P.length ? [hit, P.length] : [0, 1];
        };
        const ask = level <= 2 ? "p1" : r.pick(["p1", "p2", "bleu"]);
        const [h1, t1] = pn(1), [h2, t2] = pn(2);
        if (ask !== "p1" && (h1 === 0 || h2 === 0)) continue;
        const bp = Math.exp(Math.min(0, 1 - lab.length / pred.length));
        const bleu = bp * (h1 / t1) ** 0.5 * (h2 / t2) ** 0.25;
        const unclipped = pred.filter((w) => lab.includes(w)).length;
        const base = `Label: “${lab.join(" ")}”. Prediction: “${pred.join(" ")}”.`;
        if (ask === "p1") {
          if (unclipped === h1 && r() < 0.7) continue; // prefer cases where clipping matters
          return {
            prompt: `${base} What is the clipped unigram precision p₁?`, answer: str(F(h1, t1)), params: { lab, pred, ask }, tolerance: 0.002,
            steps: [`count each predicted token at most as often as it appears in the label`, `${h1} of ${t1}`],
            trick: "Clipping stops “the the the” from scoring perfectly.",
            mistakes: wrong(str(F(h1, t1)), [
              { answer: str(F(unclipped, t1)), why: "Clip each token's count at its count in the label." },
              { answer: str(F(h1, lab.length)), why: "Precision divides by the number of predicted n-grams." },
            ]),
          };
        }
        if (ask === "p2") {
          return {
            prompt: `${base} What is the clipped bigram precision p₂?`, answer: str(F(h2, t2)), params: { lab, pred, ask }, tolerance: 0.002,
            steps: [`predicted bigrams: ${grams(pred, 2).join(", ")}`, `${h2} of ${t2} match (clipped)`],
            trick: "There are len − 1 bigrams.",
            mistakes: wrong(str(F(h2, t2)), [
              { answer: str(F(h2, pred.length)), why: `There are ${t2} bigrams in the prediction, not ${pred.length}.` },
              { answer: str(F(h1, t1)), why: "That's the unigram precision." },
            ]),
          };
        }
        return {
          prompt: `${base} Compute BLEU with k = 2: $\\exp(\\min(0, 1 - \\tfrac{\\text{len}_\\text{label}}{\\text{len}_\\text{pred}}))\\, p_1^{1/2}\\, p_2^{1/4}$.`,
          answer: fmt(bleu), params: { lab, pred, ask }, tolerance: 0.003,
          steps: [`p₁ = ${h1}/${t1}, p₂ = ${h2}/${t2}`, `brevity penalty exp(min(0, 1 − ${lab.length}/${pred.length})) = ${fmt(bp)}`, `BLEU = ${fmt(bleu)}`],
          trick: "Longer n-grams get more weight: pₙ^{1/2ⁿ} with pₙ ≤ 1.",
          mistakes: wrong(fmt(bleu), [
            { answer: fmt((h1 / t1) ** 0.5 * (h2 / t2) ** 0.25), why: "Short predictions are penalised: include the brevity penalty." },
            { answer: fmt(bp * (h1 / t1) * (h2 / t2)), why: "Each pₙ is raised to 1/2ⁿ." },
          ]),
        };
      }
    },
  });

  // ==== d2l 13: computational performance =============================================

  def(["d2l:13"], {
    id: "dl-roofline", name: "Compute-bound or memory-bound?",
    blurb: "Arithmetic intensity = FLOPs/bytes moved; time ≈ max(FLOPs/peak, bytes/bandwidth).",
    source: cite("d2l", "13.4 Hardware"),
    gen(level, r) {
      const n = r.pick([256, 512, 1024, 4096, 8192]), b = r.pick([2, 4]);
      const flops = 2 * n ** 3, bytes = 3 * n * n * b;
      const peak = r.pick([10, 50, 100, 300]) * 1e12, bw = r.pick([0.5, 1, 2, 3]) * 1e12;
      const ask = band(level, ["ai", "ai", "time", "bound", "time"]);
      if (ask === "ai") {
        const ai = flops / bytes;
        return {
          prompt: `Multiplying two ${n}×${n} matrices in ${b === 2 ? "16" : "32"}-bit floats reads A and B and writes C once. What is the arithmetic intensity, in FLOPs per byte?`,
          answer: fmt(ai, 2), params: { n, b, ask }, tolerance: 0.001,
          steps: [`FLOPs = 2n³ = ${flops}`, `bytes = 3n²·${b} = ${bytes}`, `ratio = ${fmt(ai, 2)}`],
          trick: "Intensity grows like n: big matmuls are compute-bound.",
          mistakes: wrong(fmt(ai, 2), [
            { answer: fmt(n ** 3 / bytes, 2), why: "A multiply–add is 2 FLOPs: 2n³." },
            { answer: fmt(flops / (3 * n * n), 2), why: `Count bytes, not elements: ×${b}.` },
          ]),
        };
      }
      const tc = flops / peak, tm = bytes / bw;
      if (ask === "bound") {
        const ans = tc >= tm ? "Compute-bound" : "Memory-bound";
        return {
          prompt: `An accelerator has ${peak / 1e12} TFLOP/s and ${bw / 1e12} TB/s. Is a ${n}×${n} matmul in ${8 * b}-bit floats (2n³ FLOPs, 3n² values moved) compute-bound or memory-bound?`,
          answer: ans, format: "choice", params: { n, b, peak, bw, ask },
          steps: [`compute time ${fmt(tc * 1e6, 3)} μs`, `memory time ${fmt(tm * 1e6, 3)} μs`, ans],
          trick: "Compare the two times; the larger one wins.",
          mistakes: [{ answer: ans === "Compute-bound" ? "Memory-bound" : "Compute-bound", why: `Compute takes ${fmt(tc * 1e6, 3)} μs and memory ${fmt(tm * 1e6, 3)} μs.` }],
        };
      }
      const t = Math.max(tc, tm) * 1e6;
      return {
        prompt: `On an accelerator with ${peak / 1e12} TFLOP/s and ${bw / 1e12} TB/s, roughly how long (in microseconds) does a ${n}×${n} matmul in ${8 * b}-bit floats take, taking the larger of compute time and memory time?`,
        answer: fmt(t, 3), params: { n, b, peak, bw, ask }, tolerance: 0.002,
        steps: [`compute ${fmt(tc * 1e6, 3)} μs`, `memory ${fmt(tm * 1e6, 3)} μs`, `max = ${fmt(t, 3)} μs`],
        trick: "The roofline: whichever resource saturates first sets the time.",
        mistakes: wrong(fmt(t, 3), [
          { answer: fmt((tc + tm) * 1e6, 3), why: "Compute and data movement overlap; take the max." },
          { answer: fmt(Math.min(tc, tm) * 1e6, 3), why: "The slower resource limits you." },
        ]),
      };
    },
  });

  def(["d2l:13"], {
    id: "dl-allreduce", name: "Data parallelism and all-reduce",
    blurb: "Ring all-reduce sends 2(k − 1)/k of the gradient per GPU, almost independent of k.",
    source: cite("d2l", "13.7 Parameter Servers"),
    gen(level, r) {
      const P = r.pick([25, 100, 350, 1300]) * 1e6, b = r.pick([2, 4]), k = r.pick([2, 4, 8, 16]);
      const ask = r.pick(band(level, [["batch"], ["batch", "bytes"], ["bytes", "time"], ["time", "bytes"], ["time"]]));
      if (ask === "batch") {
        const B = r.pick([256, 512, 1024]);
        return {
          prompt: `Data-parallel training on ${k} GPUs with a global batch of ${B}. How many examples does each GPU process per step?`,
          answer: String(B / k), params: { B, k, ask },
          steps: [`${B}/${k}`], trick: "Each GPU gets a slice; gradients are averaged afterwards.",
          mistakes: wrong(String(B / k), [{ answer: String(B), why: "The global batch is split across GPUs." }, { answer: String(B * k), why: "That's k times the global batch." }]),
        };
      }
      const bytes = (2 * (k - 1) / k) * P * b;
      const gb = bytes / 1e9;
      if (ask === "bytes") {
        return {
          prompt: `A model with ${P / 1e6}M parameters keeps gradients in ${8 * b}-bit floats. In a ring all-reduce over ${k} GPUs, how many gigabytes does each GPU send per step?`,
          answer: fmt(gb, 3), params: { P, b, k, ask }, tolerance: 0.002,
          steps: [`gradient size ${fmt(P * b / 1e9, 3)} GB`, `ring all-reduce: 2(k − 1)/k = ${fmt(2 * (k - 1) / k, 3)} of it`, `${fmt(gb, 3)} GB`],
          trick: "Reduce-scatter then all-gather: each sends (k − 1)/k twice.",
          mistakes: wrong(fmt(gb, 3), [
            { answer: fmt(P * b / 1e9 * (k - 1), 3), why: "A ring doesn't send the whole gradient to every other GPU." },
            { answer: fmt(P * b / 1e9, 3), why: "Each GPU sends 2(k − 1)/k of the gradient, not exactly one copy." },
          ]),
        };
      }
      const bw = r.pick([25, 50, 100, 300]);
      const t = (bytes / (bw * 1e9)) * 1000;
      return {
        prompt: `${P / 1e6}M parameters, ${8 * b}-bit gradients, ring all-reduce over ${k} GPUs with ${bw} GB/s links. About how many milliseconds does the all-reduce take (bandwidth only)?`,
        answer: fmt(t, 2), params: { P, b, k, bw, ask }, tolerance: 0.005,
        steps: [`bytes per GPU = 2(k − 1)/k·P·b = ${fmt(gb, 3)} GB`, `÷ ${bw} GB/s = ${fmt(t, 2)} ms`],
        trick: "The ring's cost barely grows with k; that's why it scales.",
        mistakes: wrong(fmt(t, 2), [
          { answer: fmt((P * b / (bw * 1e9)) * 1000, 2), why: "Each GPU sends 2(k − 1)/k of the gradient." },
          { answer: fmt(t * k, 2), why: "The GPUs send in parallel around the ring." },
        ]),
      };
    },
  });

  // ==== d2l 14: computer vision ========================================================

  def(["d2l:14"], {
    id: "dl-iou", name: "Intersection over union",
    blurb: "IoU = area(A ∩ B)/area(A ∪ B), with union = area A + area B − intersection.",
    source: cite("d2l", "14.4 Anchor Boxes", "faithful"),
    gen(level, r) {
      for (;;) {
        const box = () => { const x = r.int(0, 8), y = r.int(0, 8); return [x, y, x + r.int(2, 6), y + r.int(2, 6)]; };
        const A = box(), B = box();
        const iw = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])), ih = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
        const inter = iw * ih;
        if (!inter && level > 1) continue;
        const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
        const uni = area(A) + area(B) - inter;
        const ans = str(F(inter, uni));
        return {
          prompt: `Boxes are given as (x₁, y₁, x₂, y₂). What is the IoU of A = (${A.join(", ")}) and B = (${B.join(", ")})?`,
          answer: ans, params: { A, B }, tolerance: 0.002,
          steps: [`intersection ${iw}×${ih} = ${inter}`, `union ${area(A)} + ${area(B)} − ${inter} = ${uni}`, `IoU = ${ans}`],
          trick: "Subtract the overlap once from the summed areas.",
          mistakes: wrong(ans, [
            { answer: str(F(inter, area(A) + area(B))), why: "The overlap is counted twice in the sum: subtract it." },
            { answer: str(F(inter, Math.min(area(A), area(B)))), why: "Divide by the union, not the smaller box." },
          ]),
        };
      }
    },
  });

  def(["d2l:14"], {
    id: "dl-anchors", name: "Counting anchor boxes",
    blurb: "With n sizes and m ratios, d2l uses n + m − 1 anchors per pixel.",
    source: cite("d2l", "14.4 Anchor Boxes", "faithful"),
    gen(level, r) {
      const n = r.int(2, 5), m = r.int(2, 4), h = r.pick([8, 16, 32, 38, 64]), w = r.pick([8, 16, 32, 38, 64]);
      const per = n + m - 1, ask = level <= 2 ? "per" : "total";
      const ans = ask === "per" ? per : per * h * w;
      return {
        prompt: `Anchor boxes use ${n} sizes and ${m} aspect ratios, keeping only the combinations that contain the first size or the first ratio. ${ask === "per" ? "How many anchors per pixel?" : `How many anchors on a ${h}×${w} feature map?`}`,
        answer: String(ans), params: { n, m, h, w, ask },
        steps: [`per pixel: n + m − 1 = ${per}`, ...(ask === "total" ? [`× ${h}·${w} = ${ans}`] : [])],
        trick: "All n·m pairs would be too many; d2l keeps n + m − 1.",
        mistakes: wrong(String(ans), [
          { answer: String(ask === "per" ? n * m : n * m * h * w), why: "Only pairs with the first size or first ratio are kept: n + m − 1." },
          { answer: String(ask === "per" ? n + m : (n + m) * h * w), why: "The pair (first size, first ratio) is counted in both lists: subtract 1." },
        ]),
      };
    },
  });

  def(["d2l:14", "d2l:20"], {
    id: "dl-transposed-conv", name: "Transposed convolution output size",
    blurb: "out = (n − 1)s − 2p + k: the inverse of the convolution size formula.",
    source: cite("d2l", "14.10 Transposed Convolution"),
    gen(level, r) {
      const n = r.pick([2, 4, 7, 8, 16, 32]), k = r.pick([2, 3, 4, 5]), s = r.pick(band(level, [[1], [1, 2], [2], [2, 4], [2, 4, 8]])), p = r.int(0, Math.floor((k - 1) / 2) + 1);
      const out = (n - 1) * s - 2 * p + k;
      if (out <= 0) return this.gen(1, r);
      return {
        prompt: `A transposed convolution with kernel ${k}, stride ${s} and padding ${p} is applied to an ${n}×${n} input. What is the output height?`,
        answer: String(out), params: { n, k, s, p },
        steps: [`(${n} − 1)·${s} − 2·${p} + ${k} = ${out}`],
        trick: "Padding *removes* rows from a transposed convolution's output.",
        mistakes: wrong(String(out), [
          { answer: String((n - 1) * s + 2 * p + k), why: "In a transposed convolution, padding shrinks the output." },
          { answer: String(n * s), why: "The kernel size and padding matter as well as the stride." },
          { answer: String(Math.floor((n - k + 2 * p) / s) + 1), why: "That's the ordinary convolution's formula." },
        ]),
      };
    },
  });

  // ==== d2l 15–16: NLP ===============================================================

  def(["d2l:15"], {
    id: "dl-bpe", name: "Byte pair encoding",
    blurb: "Each merge adds one symbol: from n initial symbols, m − n merges reach vocabulary m.",
    source: cite("d2l", "15.6 Subword Embedding", "faithful"),
    gen(level, r) {
      const n = r.pick([26, 27, 52, 256, 128]), m = n + r.pick([10, 100, 1000, 32000, 50000 - n]);
      const ask = level <= 2 ? "merges" : r.pick(["merges", "after"]);
      if (ask === "merges") {
        return {
          prompt: `BPE starts with ${n} symbols. How many merge operations give a vocabulary of size ${m}?`,
          answer: String(m - n), params: { n, m, ask },
          steps: [`each merge adds exactly one new symbol`, `${m} − ${n} = ${m - n}`], trick: "Merged symbols are kept alongside their parts.",
          mistakes: wrong(String(m - n), [{ answer: String(m), why: "The initial symbols are already in the vocabulary." }, { answer: String(Math.ceil(Math.log2(m / n))), why: "A merge adds one symbol; it doesn't double the vocabulary." }]),
        };
      }
      const j = r.int(1, 5000);
      return {
        prompt: `BPE starts with ${n} symbols (plus the end-of-word marker, counted among them) and performs ${j} merges. How many symbols are in the vocabulary?`,
        answer: String(n + j), params: { n, j, ask },
        steps: [`${n} + ${j}`], trick: "Nothing is removed when two symbols merge.",
        mistakes: wrong(String(n + j), [{ answer: String(n + j - 2 * j), why: "Merging doesn't remove the parts from the vocabulary." }, { answer: String(j), why: "Keep the initial symbols." }].filter((mm) => Number(mm.answer) > 0)),
      };
    },
  });

  def(["d2l:15"], {
    id: "dl-word2vec-cost", name: "Subsampling and negative sampling",
    blurb: "Drop w with probability max(0, 1 − √(t/f(w))); negative sampling costs K + 1 dot products, not |V|.",
    source: cite("d2l", "15.3 The Dataset for Pretraining Word Embeddings"),
    gen(level, r) {
      const ask = level <= 2 ? "drop" : r.pick(["drop", "cost"]);
      if (ask === "drop") {
        const t = 1e-4, f = r.pick([0.05, 0.01, 0.002, 0.0004, 0.00005]);
        const p = Math.max(0, 1 - Math.sqrt(t / f));
        return {
          prompt: `Subsampling discards a word with relative frequency f(w) with probability $\\max(0, 1 - \\sqrt{t/f(w)})$, t = 10⁻⁴. What is the discard probability for a word with f(w) = ${f}?`,
          answer: fmt(p), params: { f, ask }, tolerance: 0.002,
          steps: [`√(10⁻⁴/${f}) = ${fmt(Math.sqrt(t / f))}`, `1 − that = ${fmt(p)}${p === 0 ? " → 0 (rare words are kept)" : ""}`],
          trick: "Very frequent words (“the”) are mostly dropped; rare ones never.",
          mistakes: wrong(fmt(p), [
            { answer: fmt(Math.max(0, 1 - t / f)), why: "Take the square root of t/f." },
            { answer: fmt(Math.sqrt(t / f)), why: "That is the keep probability (when below 1)." },
          ]),
        };
      }
      const V = r.pick([10000, 50000, 100000]), K = r.pick([5, 10, 20]), d = r.pick([100, 300]);
      return {
        prompt: `Skip-gram with embedding size ${d} and vocabulary ${V}. How many times fewer dot products does one training pair need with negative sampling (K = ${K} noise words) than with the full softmax?`,
        answer: fmt(V / (K + 1), 2), params: { V, K, d, ask }, tolerance: 0.001,
        steps: [`full softmax: ${V} dot products`, `negative sampling: K + 1 = ${K + 1}`, `ratio ${fmt(V / (K + 1), 2)}`],
        trick: "The softmax's normaliser is what negative sampling avoids.",
        mistakes: wrong(fmt(V / (K + 1), 2), [{ answer: fmt(V / K, 2), why: "Count the true context word as well: K + 1." }, { answer: fmt((V * d) / K, 2), why: "Both sides cost d per dot product; the d cancels." }]),
      };
    },
  });

  def(["d2l:15", "d2l:11", "bishop:ch12"], {
    id: "dl-transformer-params", name: "Parameters of BERT-style models",
    blurb: "Embeddings: (V + max_len + 2)·d; each layer ≈ 4d² attention + 8d² feed-forward, plus biases and norms.",
    source: cite("d2l", "15.8 Bidirectional Encoder Representations from Transformers (BERT)"),
    gen(level, r) {
      const d = r.pick([128, 256, 768, 1024]), V = r.pick([10000, 20000, 30522]), L = r.pick([512, 1000]);
      const ask = band(level, ["embed", "attn", "layer", "layer", "total"]);
      const emb = (V + L + 2) * d;
      const attn = 4 * (d * d + d);
      const ffn = d * 4 * d + 4 * d + 4 * d * d + d;
      const ln = 2 * 2 * d;
      const layer = attn + ffn + ln;
      if (ask === "embed") {
        return {
          prompt: `A BERT-style model has vocabulary ${V}, maximum length ${L}, 2 segment types and hidden size ${d}, with learned token, position and segment embeddings. How many embedding parameters?`,
          answer: String(emb), params: { d, V, L, ask },
          steps: [`(${V} + ${L} + 2)·${d} = ${emb}`], trick: "Three lookup tables, all of width d.",
          mistakes: wrong(String(emb), [{ answer: String(V * d), why: "Position and segment embeddings are learned too." }, { answer: String((V + L) * d), why: "Add the 2 segment embeddings." }]),
        };
      }
      if (ask === "attn") {
        return {
          prompt: `Multi-head self-attention with hidden size ${d}: query, key, value and output projections, each d×d with a bias. How many parameters (the number of heads doesn't matter)?`,
          answer: String(attn), params: { d, ask },
          steps: [`4·(${d}² + ${d}) = ${attn}`], trick: "Heads split d; they don't add parameters.",
          mistakes: wrong(String(attn), [{ answer: String(3 * (d * d + d)), why: "Include the output projection W_o." }, { answer: String(4 * d * d), why: "Each projection has a bias." }]),
        };
      }
      const total = emb + (ask === "total" ? 12 : 1) * layer;
      return {
        prompt: ask === "layer"
          ? `One transformer encoder layer, hidden size ${d}: self-attention (4 projections with biases), a feed-forward block d → 4d → d with biases, and two layer norms (scale and shift). How many parameters?`
          : `A 12-layer encoder with hidden size ${d} (each layer: attention 4(d² + d), FFN d→4d→d with biases, two layer norms) plus embeddings for vocabulary ${V}, length ${L} and 2 segments. Total parameters?`,
        answer: String(ask === "layer" ? layer : total), params: { d, V, L, ask },
        steps: [`attention ${attn}`, `FFN ${ffn}`, `layer norms ${ln}`, ask === "layer" ? `layer = ${layer}` : `12·${layer} + embeddings ${emb} = ${total}`],
        trick: "About 12d² per layer: the feed-forward block is two-thirds of it.",
        mistakes: wrong(String(ask === "layer" ? layer : total), [
          { answer: String(ask === "layer" ? attn + ln : emb + 12 * (attn + ln)), why: "The feed-forward block (8d² + 5d) is the bigger part." },
          { answer: String(ask === "layer" ? 12 * d * d : emb + 144 * d * d), why: "12d² is the approximation; count the biases and norms exactly." },
        ]),
      };
    },
  });

  def(["d2l:16"], {
    id: "dl-textcnn", name: "TextCNN shapes",
    blurb: "A width-k 1-D convolution over n tokens gives n − k + 1 outputs; max-over-time keeps one per channel.",
    source: cite("d2l", "16.3 Sentiment Analysis: Using Convolutional Neural Networks"),
    gen(level, r) {
      const n = r.int(20, 500), ks = [3, 4, 5].slice(0, r.int(1, 3)), cs = ks.map(() => r.pick([50, 100, 128]));
      const ask = level <= 2 ? "len" : "vec";
      if (ask === "len") {
        return {
          prompt: `A 1-D convolution with kernel width ${ks[0]} (no padding) runs over a sequence of ${n} tokens. How long is the output?`,
          answer: String(n - ks[0] + 1), params: { n, ks, cs, ask },
          steps: [`${n} − ${ks[0]} + 1`], trick: "One output per window position.",
          mistakes: wrong(String(n - ks[0] + 1), [{ answer: String(n), why: "Without padding the output is shorter." }, { answer: String(n - ks[0]), why: "Add 1: count the first window." }]),
        };
      }
      const tot = sum(cs);
      return {
        prompt: `TextCNN on ${n} tokens uses convolutions of widths ${ks.join(", ")} with ${cs.join(", ")} output channels respectively, then max-over-time pooling on every channel and concatenation. How long is the resulting vector?`,
        answer: String(tot), params: { n, ks, cs, ask },
        steps: [`max-over-time pooling keeps one number per channel`, `${cs.join(" + ")} = ${tot}`],
        trick: "Pooling over time removes the sequence length entirely.",
        mistakes: wrong(String(tot), [
          { answer: String(sum(ks.map((k, i) => (n - k + 1) * cs[i]))), why: "Max-over-time pooling collapses each channel's sequence to one number." },
          { answer: String(cs.length), why: "One value per channel, not per convolution." },
        ]),
      };
    },
  });

  // ==== d2l 17: reinforcement learning ==================================================

  def(["d2l:17"], {
    id: "dl-value-iteration", name: "Value iteration and returns",
    blurb: "V_{k+1}(s) = max_a [r + γV_k(s′)]; the return is Σ γᵗ rₜ.",
    source: cite("d2l", "17.2 Value Iteration"),
    gen(level, r) {
      const gamma = r.pick([0.5, 0.9, 0.8, 0.99]);
      if (level <= 2) {
        const rs = Array.from({ length: r.int(3, 5) }, () => r.int(-1, 5));
        const G = rs.reduce((s, x, t) => s + x * gamma ** t, 0);
        return {
          prompt: `An agent receives rewards ${rs.join(", ")} (at t = 0, 1, …). With discount γ = ${gamma}, what is the return?`,
          answer: fmt(G), params: { fam: "return", rs, gamma }, tolerance: 0.001,
          steps: [rs.map((x, t) => `${x}·${gamma}^${t}`).join(" + ") + ` = ${fmt(G)}`],
          trick: "Rewards now count more than rewards later.",
          mistakes: wrong(fmt(G), [
            { answer: fmt(sum(rs)), why: "Discount each reward by γᵗ." },
            { answer: fmt(rs.reduce((s, x, t) => s + x * gamma ** (t + 1), 0)), why: "The first reward is at t = 0: undiscounted." },
          ]),
        };
      }
      // chain 0 … N; moving right from N − 1 into N (terminal) earns R; all else 0
      const N = r.int(3, 8), R = r.pick([1, 10]), k = r.int(1, N + 1), s = r.int(0, N - 1);
      const dist = N - s;
      const v = dist <= k ? R * gamma ** (dist - 1) : 0;
      return {
        prompt: `States 0, 1, …, ${N} lie on a line; ${N} is terminal. Moving right into ${N} earns ${R}; every other move earns 0. Actions: left or right (deterministic). Starting from V₀ ≡ 0, what is $V_{${k}}(${s})$ after ${k} round${k > 1 ? "s" : ""} of value iteration with γ = ${gamma}?`,
        answer: fmt(v), params: { fam: "chain", N, R, k, s, gamma }, tolerance: 0.001,
        steps: [`the reward is ${dist} step${dist > 1 ? "s" : ""} away`, dist <= k ? `after ${k} rounds it has propagated back: ${R}·γ^${dist - 1} = ${fmt(v)}` : `after only ${k} rounds, value hasn't reached state ${s}: 0`],
        trick: "Each round of value iteration propagates information one step.",
        mistakes: wrong(fmt(v), [
          { answer: fmt(R * gamma ** (dist - 1)), why: dist <= k ? "" : `The reward is ${dist} steps away: ${k} rounds aren't enough to reach state ${s}.` },
          { answer: fmt(R * gamma ** dist), why: "The reward on the last move is discounted by γ^(steps − 1)." },
          { answer: fmt(R), why: "Discount by γ for each step before the reward." },
        ].filter((m) => m.why)),
      };
    },
  });

  def(["d2l:17"], {
    id: "dl-q-learning", name: "One Q-learning update",
    blurb: "Q(s, a) ← Q(s, a) + α[r + γ maxₐ′ Q(s′, a′) − Q(s, a)].",
    source: cite("d2l", "17.3 Q-Learning"),
    gen(level, r) {
      const q = r.int(-2, 5), rew = r.int(-1, 5), gamma = r.pick([0.9, 0.5, 0.99]), alpha = r.pick([0.1, 0.5, 1]);
      const next = [r.int(-3, 6), r.int(-3, 6), r.int(-3, 6)];
      const terminal = level >= 4 && r() < 0.3;
      const target = rew + (terminal ? 0 : gamma * Math.max(...next));
      const nq = q + alpha * (target - q);
      return {
        prompt: `Q(s, a) = ${q}. Taking a gives reward ${rew} and lands in s′${terminal ? ", which is terminal" : ` with Q(s′, ·) = ${next.join(", ")}`}. With α = ${alpha} and γ = ${gamma}, what is the updated Q(s, a)?`,
        answer: fmt(nq), params: { q, rew, gamma, alpha, next, terminal }, tolerance: 0.001,
        steps: [`target = ${rew}${terminal ? " (terminal: no bootstrap)" : ` + ${gamma}·${Math.max(...next)}`} = ${fmt(target)}`, `Q ← ${q} + ${alpha}·(${fmt(target)} − ${q}) = ${fmt(nq)}`],
        trick: "Q-learning bootstraps from the best next action, whatever it actually does next.",
        mistakes: wrong(fmt(nq), [
          { answer: fmt(q + alpha * (rew + gamma * (sum(next) / 3) - q)), why: terminal ? "" : "Use the max over next actions (Q-learning), not their average." },
          { answer: fmt(target), why: alpha === 1 ? "" : "Move only a fraction α toward the target." },
          { answer: fmt(q + alpha * (rew + gamma * Math.max(...next) - q)), why: terminal ? "At a terminal state there is no future value." : "" },
        ].filter((m) => m.why)),
      };
    },
  });

  // ==== d2l 18: Gaussian processes (and PML 17) ==========================================

  def(["d2l:18", "pml:17"], {
    id: "dl-gp-posterior", name: "Gaussian process predictions",
    blurb: "Mean k*ᵀK⁻¹y, variance k(x, x) − k*ᵀK⁻¹k*: nearby observations pin the function down.",
    source: cite("d2l", "18.1 Introduction to Gaussian Processes", "faithful"),
    gen(level, r) {
      const y1 = r.pick([1.2, 0.5, -0.8, 2]), k1 = r.pick([0.9, 0.5, 0.7, 0.3]);
      const ask = r.pick(["mean", "var"]);
      if (level <= 2) {
        const m = k1 * y1, v = 1 - k1 * k1;
        const ans = ask === "mean" ? m : v;
        return {
          prompt: `A zero-mean GP has k(x, x) = 1. We observe f(x₁) = ${y1} exactly, with k(x, x₁) = ${k1}. What is the posterior ${ask === "mean" ? "mean" : "variance"} of f(x)?`,
          answer: fmt(ans), params: { n: 1, y1, k1, ask }, tolerance: 0.002,
          steps: [ask === "mean" ? `k(x, x₁)·y₁/k(x₁, x₁) = ${k1}·${y1}` : `1 − k(x, x₁)²/k(x₁, x₁) = 1 − ${k1}²`, `= ${fmt(ans)}`],
          trick: "Correlation 0.9 carries 90 percent of the observation over, and removes 81 percent of the variance.",
          mistakes: wrong(fmt(ans), ask === "mean"
            ? [{ answer: fmt(y1), why: "The prediction shrinks toward the prior mean 0 by the correlation." }, { answer: "0", why: "The observation is correlated with f(x), so it moves the mean." }]
            : [{ answer: fmt(1 - k1), why: "The variance drops by k², not k." }, { answer: "1", why: "Observing a correlated point reduces the uncertainty." }]),
        };
      }
      const y2 = r.pick([1.4, 0.2, -1]), k2 = r.pick([0.8, 0.6, 0.4]), k12 = r.pick([0.5, 0.7, 0.3]);
      const det = 1 - k12 * k12;
      const Kinv = [[1 / det, -k12 / det], [-k12 / det, 1 / det]];
      const ks = [k1, k2], ys = [y1, y2];
      const w = [Kinv[0][0] * ks[0] + Kinv[0][1] * ks[1], Kinv[1][0] * ks[0] + Kinv[1][1] * ks[1]];
      const m = w[0] * ys[0] + w[1] * ys[1], v = 1 - (w[0] * ks[0] + w[1] * ks[1]);
      if (v <= 0) return this.gen(2, r);
      const ans = ask === "mean" ? m : v;
      return {
        prompt: `A zero-mean GP with k(x, x) = 1 for every x. We observe f(x₁) = ${y1} and f(x₂) = ${y2} exactly, with k(x₁, x₂) = ${k12}, k(x, x₁) = ${k1} and k(x, x₂) = ${k2}. What is the posterior ${ask === "mean" ? "mean" : "variance"} of f(x)?`,
        answer: fmt(ans), params: { n: 2, y1, y2, k1, k2, k12, ask }, tolerance: 0.002,
        steps: [`K = [[1, ${k12}], [${k12}, 1]], k* = (${k1}, ${k2})`, `K⁻¹k* = (${fmt(w[0])}, ${fmt(w[1])})`, ask === "mean" ? `mean = (K⁻¹k*)·y = ${fmt(m)}` : `variance = 1 − k*·K⁻¹k* = ${fmt(v)}`],
        trick: "Correlated observations overlap: you can't just add their effects.",
        mistakes: wrong(fmt(ans), ask === "mean"
          ? [{ answer: fmt(k1 * y1 + k2 * y2), why: "The two observations are correlated with each other: invert K." }, { answer: fmt(k1 * y1), why: "Use both observations." }]
          : [{ answer: fmt(1 - k1 * k1 - k2 * k2), why: "The observations overlap (k₁₂ ≠ 0): the reduction isn't additive." }, { answer: fmt(1 - k1 * k1), why: "The second observation reduces the variance further." }]),
      };
    },
  });

  def(["d2l:18", "pml:17"], {
    id: "dl-rbf-kernel", name: "The RBF kernel",
    blurb: "k(x, x′) = a² exp(−‖x − x′‖²/(2ℓ²)): the length-scale ℓ sets how fast correlation decays.",
    source: cite("d2l", "18.2 Gaussian Process Priors"),
    gen(level, r) {
      const a = r.pick([1, 2, 0.5]), l = r.pick([0.5, 1, 2, 3]);
      const d = r.pick([0.5, 1, 2, 3, 4].filter((x) => x / l <= 2.5));
      const kv = a * a * Math.exp(-(d * d) / (2 * l * l));
      return {
        prompt: `An RBF kernel has amplitude a = ${a} and length-scale ℓ = ${l}. What is k(x, x′) for two points ${d} apart?`,
        answer: fmt(kv), params: { a, l, d }, tolerance: 0.002,
        steps: [`a² exp(−d²/(2ℓ²)) = ${a * a}·exp(−${d * d}/${2 * l * l})`, `= ${fmt(kv)}`],
        trick: "At one length-scale apart the correlation is e^{−1/2} ≈ 0.61.",
        mistakes: wrong(fmt(kv), [
          { answer: fmt(a * Math.exp(-(d * d) / (2 * l * l))), why: "The amplitude enters squared: a²." },
          { answer: fmt(a * a * Math.exp(-d / (2 * l))), why: "The distance is squared in the exponent." },
          { answer: fmt(a * a * Math.exp(-(d * d) / (l * l))), why: "Divide by 2ℓ², not ℓ²." },
        ]),
      };
    },
  });

  // ==== d2l 19: hyperparameter optimisation ==============================================

  def(["d2l:19"], {
    id: "dl-hpo", name: "Grid, random search and successive halving",
    blurb: "A grid multiplies choices; random search finds a top-q config in n tries with 1 − (1 − q)ⁿ; SH spends n·r_min per rung.",
    source: cite("d2l", "19.1 What Is Hyperparameter Optimization?"),
    gen(level, r) {
      const fam = r.pick(band(level, [["grid"], ["grid", "random"], ["random", "halving"], ["halving", "memory"], ["memory", "halving", "random"]]));
      if (fam === "grid") {
        const ns = Array.from({ length: r.int(2, 4) }, () => r.int(2, 8));
        const ans = ns.reduce((a, b) => a * b, 1);
        return {
          prompt: `A grid search tries ${ns.join(", ")} values for ${ns.length} hyperparameters respectively. How many configurations does it train?`,
          answer: String(ans), params: { fam, ns },
          steps: [`the Cartesian product: ${ns.join("·")} = ${ans}`], trick: "Grids blow up exponentially in the number of hyperparameters.",
          mistakes: wrong(String(ans), [{ answer: String(sum(ns)), why: "Every combination is trained: multiply." }, { answer: String(Math.max(...ns) ** ns.length), why: "Each hyperparameter has its own number of values." }]),
        };
      }
      if (fam === "random") {
        const q = r.pick([0.01, 0.05, 0.1]), p = r.pick([0.9, 0.95, 0.99]);
        const n = Math.ceil(Math.log(1 - p) / Math.log(1 - q) - 1e-12);
        return {
          prompt: `Random search samples configurations independently. How many samples are needed to land in the top ${q * 100} percent of configurations with probability at least ${p}?`,
          answer: String(n), params: { fam, q, p },
          steps: [`1 − (1 − ${q})ⁿ ≥ ${p}`, `n ≥ ln(${fmt(1 - p, 2)})/ln(${1 - q}) = ${fmt(Math.log(1 - p) / Math.log(1 - q), 2)}`, `n = ${n}`],
          trick: "Only the fraction q matters, not how many hyperparameters there are.",
          mistakes: wrong(String(n), [{ answer: String(Math.ceil(p / q)), why: "Hits aren't additive: use 1 − (1 − q)ⁿ." }, { answer: String(Math.ceil(1 / q)), why: "1/q samples give only about a 63 percent chance." }]),
        };
      }
      if (fam === "memory") {
        const B = r.pick([64, 128, 256]), ws = [784, ...Array.from({ length: r.int(1, 3) }, () => r.pick([256, 512, 1024])), 10];
        const floats = B * sum(ws.slice(1));
        return {
          prompt: `Estimate the activations stored in a forward pass: an MLP with layer widths ${ws.join(" → ")} processes a batch of ${B}. Counting one float per unit after each layer (not the input), how many floats?`,
          answer: String(floats), params: { fam, B, ws },
          steps: [`${B}·(${ws.slice(1).join(" + ")}) = ${floats}`], trick: "Memory scales with batch × width, which is why batch size is capped by memory.",
          mistakes: wrong(String(floats), [{ answer: String(B * sum(ws)), why: "The input is data, not an activation we counted." }, { answer: String(sum(ws.slice(1))), why: "Every example in the batch has its own activations." }]),
        };
      }
      const n = r.pick([27, 81, 64, 16]), eta = n === 27 || n === 81 ? 3 : 2, rmin = r.pick([1, 2]);
      let K = 0, c = n;
      while (c >= 1) { K++; c = Math.floor(c / eta); }
      const total = n * rmin * K;
      return {
        prompt: `Successive halving starts ${n} configurations at r_min = ${rmin} epoch${rmin > 1 ? "s" : ""}. At each rung it keeps the best 1/${eta} and multiplies the epochs by ${eta}, until one configuration remains. If every rung trains its survivors from scratch, how many epochs are spent in total?`,
        answer: String(total), params: { fam, n, eta, rmin },
        steps: [`${K} rungs: ${Array.from({ length: K }, (_, i) => `${n / eta ** i}×${rmin * eta ** i}`).join(", ")}`, `each rung costs ${n * rmin}`, `total ${total}`],
        trick: "Every rung costs the same: fewer configs, proportionally longer training.",
        mistakes: wrong(String(total), [{ answer: String(n * rmin * eta ** (K - 1)), why: "Only the survivors train at the higher budgets." }, { answer: String(n * rmin), why: "That's one rung; there are several." }]),
      };
    },
  });

  // ==== d2l 20–21: GANs, recommenders (and Bishop 17) ==================================

  def(["d2l:20", "bishop:ch17"], {
    id: "dl-gan", name: "The optimal discriminator",
    blurb: "For fixed G, D*(x) = p_data(x)/(p_data(x) + p_g(x)); at equilibrium D* = 1/2.",
    source: cite("d2l", "20.1 Generative Adversarial Networks"),
    gen(level, r) {
      if (level <= 1 || r() < 0.3) {
        const a = r.pick([0.01, 0.2, 0.02]), x = r.int(-9, 5);
        const y = x >= 0 ? x : a * x;
        return {
          prompt: `DCGAN's discriminator uses leaky ReLU with slope α = ${a}. What does it output for input ${x}?`,
          answer: fmt(y), params: { fam: "leaky", a, x },
          steps: [x >= 0 ? "positive: unchanged" : `negative: ${a}·${x} = ${fmt(y)}`],
          trick: "A small negative slope keeps gradients flowing to the generator.",
          mistakes: wrong(fmt(y), [{ answer: String(Math.max(0, x)), why: x < 0 ? "Leaky ReLU passes α·x for negative inputs, not 0." : "" }, { answer: fmt(a * x), why: x >= 0 ? "Positive inputs pass unchanged." : "" }].filter((m) => m.why)),
        };
      }
      const pd = r.pick([0.1, 0.2, 0.3, 0.05, 0.4]), pg = r.pick([0.1, 0.2, 0.05, 0.3, 0.4]);
      const D = pd / (pd + pg);
      return {
        prompt: `At a point x, the data density is ${pd} and the generator's density is ${pg}. What is the optimal discriminator's output D*(x)?`,
        answer: fmt(D), params: { fam: "opt", pd, pg }, tolerance: 0.002,
        steps: [`D* = p_data/(p_data + p_g) = ${pd}/${fmt(pd + pg, 3)}`, `= ${fmt(D)}`],
        trick: "D* is the posterior probability that x came from the data.",
        mistakes: wrong(fmt(D), [{ answer: fmt(pd), why: "Normalise by p_data + p_g." }, { answer: "0.5", why: "D* = 1/2 only where the densities are equal." }, { answer: fmt(pg / (pd + pg)), why: "That is the probability x came from the generator." }]),
      };
    },
  });

  def(["d2l:21"], {
    id: "dl-matrix-factorization", name: "Matrix factorization for recommenders",
    blurb: "r̂ᵤᵢ = pᵤ·qᵢ + bᵤ + bᵢ; parameters (m + n)(k + 1).",
    source: cite("d2l", "21.3 Matrix Factorization"),
    gen(level, r) {
      const ask = level <= 2 ? "params" : r.pick(["params", "predict", "rmse"]);
      if (ask === "params") {
        const m = r.pick([943, 1000, 5000]), n = r.pick([1682, 2000, 10000]), k = r.pick([10, 30, 50]);
        const ans = (m + n) * (k + 1);
        return {
          prompt: `Matrix factorization for ${m} users and ${n} items with ${k} latent factors, plus one bias per user and per item. How many parameters?`,
          answer: String(ans), params: { ask, m, n, k },
          steps: [`(${m} + ${n})·${k} factors + (${m} + ${n}) biases = ${ans}`], trick: "It's linear in users + items, not their product.",
          mistakes: wrong(String(ans), [{ answer: String(m * n), why: "That's the full rating matrix; the point is to avoid storing it." }, { answer: String((m + n) * k), why: "Add the user and item biases." }]),
        };
      }
      if (ask === "predict") {
        const p = [r.int(-2, 2), r.int(-2, 2), r.int(-1, 2)], q = [r.int(-1, 2), r.int(-2, 2), r.int(-1, 2)], bu = r.pick([0.5, -0.5, 0.2]), bi = r.pick([0.3, -0.2, 1]);
        const pred = sum(p.map((x, i) => x * q[i])) + bu + bi;
        return {
          prompt: `User vector p = (${p.join(", ")}), item vector q = (${q.join(", ")}), user bias ${bu}, item bias ${bi}. What rating does matrix factorization predict?`,
          answer: fmt(pred), params: { ask, p, q, bu, bi },
          steps: [`p·q = ${sum(p.map((x, i) => x * q[i]))}`, `+ ${bu} + ${bi} = ${fmt(pred)}`], trick: "Dot product plus biases.",
          mistakes: wrong(fmt(pred), [{ answer: String(sum(p.map((x, i) => x * q[i]))), why: "Add the user and item biases." }]),
        };
      }
      const pairs = Array.from({ length: r.int(3, 5) }, () => [r.int(1, 5), r.int(1, 5)]);
      const mse = sum(pairs.map(([a, b]) => (a - b) ** 2)) / pairs.length;
      return {
        prompt: `Predicted vs true ratings: ${pairs.map(([a, b]) => `(${a}, ${b})`).join(", ")}. What is the RMSE?`,
        answer: fmt(Math.sqrt(mse)), params: { ask, pairs }, tolerance: 0.002,
        steps: [`squared errors ${pairs.map(([a, b]) => (a - b) ** 2).join(", ")}`, `mean ${fmt(mse)}`, `√ = ${fmt(Math.sqrt(mse))}`],
        trick: "Root of the mean of the squares.",
        mistakes: wrong(fmt(Math.sqrt(mse)), [{ answer: fmt(mse), why: "Take the square root." }, { answer: fmt(sum(pairs.map(([a, b]) => Math.abs(a - b))) / pairs.length), why: "That's the mean absolute error." }]),
      };
    },
  });

  // ==== Bishop and Murphy: probability and statistics ===================================

  def(["bishop:2.3", "bishop:3.2", "pml:4"], {
    id: "bs-gaussian-mle", name: "Maximum likelihood for a Gaussian",
    blurb: "μ̂ is the sample mean; σ̂² divides by N and is biased by (N − 1)/N.",
    source: cite("bishop", "2.3 The Gaussian Distribution"),
    gen(level, r) {
      const xs = Array.from({ length: r.int(3, band(level, [4, 5, 6, 8, 8])) }, () => r.int(-3, 9));
      const N = xs.length, mu = sum(xs) / N, ss = sum(xs.map((x) => (x - mu) ** 2));
      const ask = r.pick(level <= 1 ? ["mean"] : ["var", "unbiased", "mean"]);
      const ans = { mean: F(sum(xs), N), var: F(Math.round(ss * N), N * N), unbiased: F(Math.round(ss * N), N * (N - 1)) }[ask];
      return {
        prompt: `Data ${xs.join(", ")} are modelled as i.i.d. Gaussian. What is the ${{ mean: "maximum-likelihood mean", var: "maximum-likelihood variance", unbiased: "unbiased variance estimate" }[ask]}?`,
        answer: str(ans), params: { xs, ask }, tolerance: 0.002,
        steps: [`μ̂ = ${fmt(mu)}`, `Σ(x − μ̂)² = ${fmt(ss)}`, ask === "var" ? `σ̂² = that/N = ${str(ans)}` : ask === "unbiased" ? `that/(N − 1) = ${str(ans)}` : `μ̂ = ${str(ans)}`],
        trick: "ML underestimates the variance because μ̂ is fitted to the same data.",
        mistakes: wrong(str(ans), [
          { answer: str(F(Math.round(ss * N), N * (N - 1))), why: "The maximum-likelihood estimate divides by N." },
          { answer: str(F(Math.round(ss * N), N * N)), why: "The unbiased estimate divides by N − 1." },
          { answer: str(F(Math.round(sum(xs.map((x) => x * x)) * N), N * N)), why: "That is E[x²]; subtract μ̂²." },
        ].filter((m) => ask !== "mean" || !m.why.includes("divides"))),
      };
    },
  });

  def(["bishop:2.5", "pml:6"], {
    id: "bs-information", name: "Entropy, cross-entropy and KL divergence",
    blurb: "H(p) = −Σ p log p; KL(p‖q) = Σ p log(p/q) ≥ 0, and not symmetric.",
    source: cite("pml", "6 Information Theory"),
    gen(level, r) {
      const dists = [[0.5, 0.5], [0.25, 0.75], [0.5, 0.25, 0.25], [0.125, 0.125, 0.25, 0.5], [0.25, 0.25, 0.25, 0.25], [0.1, 0.9], [0.2, 0.3, 0.5]];
      const p = r.pick(dists);
      const qs = dists.filter((d) => d.length === p.length && d.join() !== p.join());
      const q = qs.length ? r.pick(qs) : p.map(() => 1 / p.length);
      const ask = r.pick(band(level, [["H"], ["H", "CE"], ["CE", "KL"], ["KL", "MI"], ["KL", "MI"]]));
      const H = -sum(p.map((x) => x * Math.log2(x)));
      const CE = -sum(p.map((x, i) => x * Math.log2(q[i])));
      if (ask === "MI") {
        const a = r.pick([0.4, 0.3, 0.1]), b = r.pick([0.1, 0.2]), c = r.pick([0.1, 0.2]), d = +(1 - a - b - c).toFixed(2);
        const J = [[a, b], [c, d]], px = [a + b, c + d], py = [a + c, b + d];
        const I = sum(J.flatMap((rw, i) => rw.map((v, j) => (v ? v * Math.log2(v / (px[i] * py[j])) : 0))));
        return {
          prompt: `X and Y are binary with joint probabilities P(0,0) = ${a}, P(0,1) = ${b}, P(1,0) = ${c}, P(1,1) = ${d}. What is the mutual information I(X; Y) in bits?`,
          answer: fmt(I), params: { ask, J }, tolerance: 0.005,
          steps: [`marginals p(x) = (${px.map((v) => fmt(v, 2)).join(", ")}), p(y) = (${py.map((v) => fmt(v, 2)).join(", ")})`, `I = Σ p(x, y) log₂ p(x, y)/(p(x)p(y)) = ${fmt(I)}`],
          trick: "I(X; Y) = KL(joint ‖ product of marginals).",
          mistakes: wrong(fmt(I), [{ answer: "0", why: "X and Y aren't independent here: the joint isn't the product of the marginals." }, { answer: fmt(-sum(J.flat().map((v) => v * Math.log2(v)))), why: "That is the joint entropy H(X, Y)." }]),
        };
      }
      const ans = { H, CE, KL: CE - H }[ask];
      return {
        prompt: ask === "H" ? `What is the entropy, in bits, of the distribution (${p.join(", ")})?`
          : `p = (${p.join(", ")}) and q = (${q.map((x) => fmt(x, 4)).join(", ")}). What is ${ask === "CE" ? "the cross-entropy H(p, q)" : "KL(p ‖ q)"} in bits?`,
        answer: fmt(ans), params: { ask, p, q }, tolerance: 0.003,
        steps: [`H(p) = ${fmt(H)}`, ...(ask !== "H" ? [`H(p, q) = −Σ p log₂ q = ${fmt(CE)}`] : []), ...(ask === "KL" ? [`KL = H(p, q) − H(p) = ${fmt(ans)}`] : [])],
        trick: "Cross-entropy = entropy + KL: the extra bits for coding p with q's code.",
        mistakes: wrong(fmt(ans), [
          { answer: fmt(-sum(p.map((x) => x * Math.log(x)))), why: "Use log base 2 for bits." },
          ...(ask === "KL" ? [{ answer: fmt(sum(q.map((x, i) => x * Math.log2(x / p[i])))), why: "KL isn't symmetric: that is KL(q ‖ p)." }, { answer: fmt(CE), why: "Subtract H(p): that's the cross-entropy." }] : []),
          ...(ask === "CE" ? [{ answer: fmt(H), why: "That is H(p); the cross-entropy uses log q." }] : []),
        ]),
      };
    },
  });

  def(["bishop:2.6", "bishop:3.1", "pml:4"], {
    id: "bs-beta-binomial", name: "Beta–binomial updating",
    blurb: "Beta(a, b) prior + h heads in n tosses → Beta(a + h, b + n − h).",
    source: cite("bishop", "3.1 Discrete Variables"),
    gen(level, r) {
      const a = r.int(1, 5), b = r.int(1, 5), n = r.int(3, 20), h = r.int(0, n);
      const ask = r.pick(band(level, [["post"], ["post", "mle"], ["post", "map"], ["map", "post"], ["map", "post"]]));
      const ans = { post: F(a + h, a + b + n), mle: F(h, n), map: F(a + h - 1, a + b + n - 2) }[ask];
      return {
        prompt: `A coin's bias μ has a Beta(${a}, ${b}) prior. We see ${h} heads in ${n} tosses. What is the ${{ post: "posterior mean of μ", mle: "maximum-likelihood estimate of μ", map: "MAP estimate of μ" }[ask]}?`,
        answer: str(ans), params: { a, b, n, h, ask }, tolerance: 0.002,
        steps: [`posterior Beta(${a + h}, ${b + n - h})`, ask === "post" ? `mean (a + h)/(a + b + n) = ${str(ans)}` : ask === "map" ? `mode (a + h − 1)/(a + b + n − 2) = ${str(ans)}` : `h/n = ${str(ans)}`],
        trick: "The prior acts like a − 1 extra heads and b − 1 extra tails (for the mode).",
        mistakes: wrong(str(ans), [
          { answer: str(F(h, n)), why: "Include the prior's pseudo-counts." },
          { answer: str(F(a + h, a + b + n)), why: "That is the posterior mean, not the mode." },
          { answer: str(F(a + h - 1, a + b + n - 2)), why: "That is the mode (MAP), not the mean." },
        ]),
      };
    },
  });

  def(["bishop:3.2", "pml:3"], {
    id: "bs-conditional-gaussian", name: "Conditioning a bivariate Gaussian",
    blurb: "E[x₁ | x₂] = μ₁ + ρ(σ₁/σ₂)(x₂ − μ₂); Var = σ₁²(1 − ρ²).",
    source: cite("pml", "3 Probability: Multivariate Models"),
    gen(level, r) {
      const m1 = r.int(-3, 5), m2 = r.int(-3, 5), s1 = r.pick([1, 2, 3]), s2 = r.pick([1, 2, 4]), rho = r.pick([0.5, -0.5, 0.8, 0.25, -0.6]);
      const x2 = m2 + r.pick([-3, -2, -1, 1, 2, 3]);
      const ask = level <= 2 ? "mean" : r.pick(["mean", "var"]);
      const mean = m1 + rho * (s1 / s2) * (x2 - m2), v = s1 * s1 * (1 - rho * rho);
      const ans = ask === "mean" ? mean : v;
      return {
        prompt: `(x₁, x₂) is bivariate Gaussian with means ${m1}, ${m2}, standard deviations ${s1}, ${s2} and correlation ${rho}. Given x₂ = ${x2}, what is the conditional ${ask === "mean" ? "mean" : "variance"} of x₁?`,
        answer: fmt(ans), params: { m1, m2, s1, s2, rho, x2, ask }, tolerance: 0.002,
        steps: [ask === "mean" ? `${m1} + ${rho}·(${s1}/${s2})·(${x2} − ${m2}) = ${fmt(mean)}` : `${s1}²·(1 − ${rho}²) = ${fmt(v)}`],
        trick: "The conditional variance doesn't depend on the observed value.",
        mistakes: wrong(fmt(ans), ask === "mean"
          ? [{ answer: fmt(m1 + rho * (s2 / s1) * (x2 - m2)), why: "The slope is ρσ₁/σ₂ (regressing x₁ on x₂)." }, { answer: String(m1), why: "Correlated observations shift the mean." }]
          : [{ answer: fmt(s1 * s1 * (1 - Math.abs(rho))), why: "Variance shrinks by 1 − ρ², not 1 − |ρ|." }, { answer: String(s1 * s1), why: "Conditioning on a correlated variable reduces the variance." }]),
      };
    },
  });

  def(["bishop:3.5"], {
    id: "bs-density-estimation", name: "Histograms and nearest-neighbour densities",
    blurb: "Histogram: p ≈ nᵢ/(NΔ). k-nearest-neighbour: p ≈ K/(NV).",
    source: cite("bishop", "3.5 Nonparametric Methods"),
    gen(level, r) {
      const N = r.pick([50, 100, 200, 1000]);
      if (level <= 2 || r() < 0.5) {
        const n = r.int(1, N / 5), D = r.pick([0.1, 0.25, 0.5, 1]);
        const p = n / (N * D);
        return {
          prompt: `A histogram of ${N} points uses bins of width ${D}. One bin holds ${n} points. What density does the histogram assign inside that bin?`,
          answer: fmt(p), params: { fam: "hist", N, n, D }, tolerance: 0.002,
          steps: [`nᵢ/(NΔ) = ${n}/(${N}·${D}) = ${fmt(p)}`], trick: "Divide by the width so the histogram integrates to 1.",
          mistakes: wrong(fmt(p), [{ answer: fmt(n / N), why: "That's the probability mass of the bin; divide by its width." }, { answer: fmt(n / D), why: "Normalise by N as well." }]),
        };
      }
      const K = r.int(3, 20), rad = r.pick([0.05, 0.1, 0.2, 0.5]);
      const p = K / (N * 2 * rad);
      return {
        prompt: `In one dimension, the ${K} nearest of ${N} data points to x all lie within distance ${rad} of x (the ${K}th exactly at ${rad}). What is the K-nearest-neighbour density estimate at x?`,
        answer: fmt(p), params: { fam: "knn", N, K, rad }, tolerance: 0.002,
        steps: [`V = 2r = ${2 * rad}`, `K/(NV) = ${K}/(${N}·${2 * rad}) = ${fmt(p)}`], trick: "In 1-D the “volume” of a ball of radius r is 2r.",
        mistakes: wrong(fmt(p), [{ answer: fmt(K / (N * rad)), why: "The interval [x − r, x + r] has length 2r." }, { answer: fmt(K / N), why: "Divide by the volume V." }]),
      };
    },
  });

  // ==== Bishop and Murphy: regression and classification =================================

  def(["bishop:4.1", "pml:11"], {
    id: "bs-least-squares", name: "Least squares and ridge regression",
    blurb: "Slope = cov(x, y)/var(x); ridge through the origin: w = Σxy/(Σx² + λ).",
    source: cite("pml", "11 Linear Regression"),
    gen(level, r) {
      for (;;) {
        const n = r.int(3, 5);
        const xs = Array.from({ length: n }, () => r.int(-3, 5)), ys = xs.map((x) => 2 * x + r.int(-3, 3));
        const mx = sum(xs) / n, my = sum(ys) / n;
        const sxx = sum(xs.map((x) => (x - mx) ** 2)), sxy = sum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
        if (!sxx) continue;
        const ask = r.pick(band(level, [["slope"], ["slope", "icpt"], ["icpt", "ridge"], ["ridge", "slope"], ["ridge", "icpt"]]));
        const pts = xs.map((x, i) => `(${x}, ${ys[i]})`).join(", ");
        if (ask === "ridge") {
          const lam = r.pick([1, 2, 5, 10]);
          const Sxy = sum(xs.map((x, i) => x * ys[i])), Sxx = sum(xs.map((x) => x * x));
          const w = F(Sxy, Sxx + lam);
          return {
            prompt: `Fit y ≈ wx (no intercept) to ${pts} by ridge regression with penalty λ = ${lam} (minimise Σ(y − wx)² + λw²). What is w?`,
            answer: str(w), params: { xs, ys, ask, lam }, tolerance: 0.002,
            steps: [`Σxy = ${Sxy}, Σx² = ${Sxx}`, `w = Σxy/(Σx² + λ) = ${str(w)}`], trick: "The penalty adds λ to the denominator and shrinks w toward 0.",
            mistakes: wrong(str(w), [{ answer: str(F(Sxy, Sxx)), why: "That's ordinary least squares; the penalty adds λ." }, { answer: str(F(Sxy, Sxx + 2 * lam)), why: "Differentiating λw² gives 2λw, and Σ(y − wx)² gives −2Σx(y − wx): the 2s cancel." }]),
          };
        }
        const slope = F(Math.round(sxy * n), Math.round(sxx * n));
        const icpt = F(Math.round((my - (sxy / sxx) * mx) * sxx * n), Math.round(sxx * n));
        const ans = ask === "slope" ? slope : icpt;
        return {
          prompt: `Fit y = a + bx by least squares to ${pts}. What is ${ask === "slope" ? "the slope b" : "the intercept a"}?`,
          answer: str(ans), params: { xs, ys, ask }, tolerance: 0.002,
          steps: [`x̄ = ${fmt(mx)}, ȳ = ${fmt(my)}`, `b = Σ(x − x̄)(y − ȳ)/Σ(x − x̄)² = ${fmt(sxy)}/${fmt(sxx)}`, ...(ask === "icpt" ? [`a = ȳ − b x̄ = ${str(icpt)}`] : [])],
          trick: "The fitted line passes through (x̄, ȳ).",
          mistakes: wrong(str(ans), [{ answer: str(F(sum(xs.map((x, i) => x * ys[i])), sum(xs.map((x) => x * x)) || 1)), why: "Centre the data first (or fit the intercept)." }, { answer: str(ask === "slope" ? F(Math.round(my * 1000), Math.round(mx * 1000) || 1) : F(Math.round(my * n), n)), why: ask === "slope" ? "ȳ/x̄ is a line through the origin." : "The intercept is ȳ − b x̄, not ȳ." }]),
        };
      }
    },
  });

  def(["bishop:4.3", "pml:4"], {
    id: "bs-bias-variance", name: "Bias and variance of a shrunk estimator",
    blurb: "Estimate μ by c·x̄: bias (c − 1)μ, variance c²σ²/n, MSE = bias² + variance.",
    source: cite("bishop", "4.3 The Bias–Variance Trade-off"),
    gen(level, r) {
      const mu = r.int(1, 5), s2 = r.pick([4, 9, 16]), n = r.pick([4, 9, 16, 25]), c = r.pick([0.5, 0.8, 0.9, 1]);
      const bias = (c - 1) * mu, v = (c * c * s2) / n, mse = bias * bias + v;
      const ask = r.pick(band(level, [["bias", "var"], ["var", "mse"], ["mse"], ["mse", "var"], ["mse"]]));
      const ans = { bias, var: v, mse }[ask];
      return {
        prompt: `Observations are i.i.d. with mean μ = ${mu} and variance ${s2}. We estimate μ by ${c}·x̄ from n = ${n} samples. What is its ${{ bias: "bias", var: "variance", mse: "mean squared error" }[ask]}?`,
        answer: fmt(ans), params: { mu, s2, n, c, ask }, tolerance: 0.002,
        steps: [`bias = (${c} − 1)·${mu} = ${fmt(bias)}`, `variance = ${c}²·${s2}/${n} = ${fmt(v)}`, `MSE = bias² + variance = ${fmt(mse)}`],
        trick: "Shrinking adds bias but cuts variance: sometimes a net win.",
        mistakes: wrong(fmt(ans), [
          { answer: fmt(ask === "mse" ? bias + v : (c * s2) / n), why: ask === "mse" ? "Square the bias." : "Scaling by c scales the variance by c²." },
          { answer: fmt(ask === "mse" ? v : s2 / n), why: ask === "mse" ? "Add the squared bias." : "Include the factor c²." },
        ]),
      };
    },
  });

  def(["bishop:5.2", "pml:5"], {
    id: "bs-classification-metrics", name: "Precision, recall and decision thresholds",
    blurb: "Precision TP/(TP + FP), recall TP/(TP + FN); with losses, predict positive when p > L_FP/(L_FP + L_FN).",
    source: cite("pml", "5 Decision Theory"),
    gen(level, r) {
      const ask = r.pick(band(level, [["prec", "rec"], ["rec", "f1", "acc"], ["f1", "thresh"], ["thresh", "f1"], ["thresh", "f1"]]));
      if (ask === "thresh") {
        const lfp = r.int(1, 10), lfn = r.int(1, 20);
        const t = F(lfp, lfp + lfn);
        return {
          prompt: `A false positive costs ${lfp} and a false negative costs ${lfn} (correct decisions cost 0). Above what posterior probability p(positive | x) should we predict positive?`,
          answer: str(t), params: { ask, lfp, lfn }, tolerance: 0.002,
          steps: [`predict positive when p·L_FN > (1 − p)·L_FP`, `p > ${lfp}/(${lfp} + ${lfn}) = ${str(t)}`], trick: "Costly misses lower the bar for saying yes.",
          mistakes: wrong(str(t), [{ answer: "1/2", why: "With unequal losses the threshold moves from 1/2." }, { answer: str(F(lfn, lfp + lfn)), why: "Swapped: a costly false negative should *lower* the threshold." }]),
        };
      }
      const TP = r.int(5, 60), FP = r.int(1, 30), FN = r.int(1, 30), TN = r.int(10, 100);
      const prec = F(TP, TP + FP), rec = F(TP, TP + FN), acc = F(TP + TN, TP + FP + FN + TN), f1 = F(2 * TP, 2 * TP + FP + FN);
      const ans = { prec, rec, acc, f1 }[ask];
      return {
        prompt: `A classifier has TP = ${TP}, FP = ${FP}, FN = ${FN}, TN = ${TN}. What is its ${{ prec: "precision", rec: "recall", acc: "accuracy", f1: "F1 score" }[ask]}?`,
        answer: str(ans), params: { ask, TP, FP, FN, TN }, tolerance: 0.002,
        steps: [{ prec: `TP/(TP + FP) = ${TP}/${TP + FP}`, rec: `TP/(TP + FN) = ${TP}/${TP + FN}`, acc: `(TP + TN)/total = ${TP + TN}/${TP + FP + FN + TN}`, f1: `2TP/(2TP + FP + FN) = ${2 * TP}/${2 * TP + FP + FN}` }[ask]],
        trick: "Precision: of those flagged, how many are right. Recall: of the real ones, how many were found.",
        mistakes: wrong(str(ans), [
          { answer: str(ask === "prec" ? rec : prec), why: ask === "prec" ? "That's recall (divides by TP + FN)." : "That's precision." },
          { answer: str(acc), why: ask === "acc" || ask === "f1" ? "" : "That's accuracy." },
          ...(ask === "f1" ? [{ answer: fmt((val(prec) + val(rec)) / 2), why: "F1 is the harmonic mean, not the arithmetic mean." }] : []),
        ].filter((m) => m.why)),
      };
    },
  });

  def(["bishop:5.3", "pml:9"], {
    id: "bs-gaussian-classifier", name: "Generative classifiers with Gaussian classes",
    blurb: "Shared variance ⇒ linear boundary at (μ₁ + μ₂)/2 + σ² ln(π₂/π₁)/(μ₁ − μ₂).",
    source: cite("pml", "9 Linear Discriminant Analysis"),
    gen(level, r) {
      const m1 = r.int(-3, 2), m2 = m1 + r.int(2, 6), s = r.pick([1, 2]), p1 = level <= 2 ? 0.5 : r.pick([0.5, 0.25, 0.75, 0.2]);
      const x = +(m1 + ((m2 - m1) / 2) + (s * s * Math.log((1 - p1) / p1)) / (m1 - m2)).toFixed(6);
      const ask = level >= 4 && r() < 0.5 ? "post" : "bound";
      if (ask === "post") {
        const x0 = r.int(m1 - 1, m2 + 1);
        const a = p1 * Math.exp(-((x0 - m1) ** 2) / (2 * s * s)), b = (1 - p1) * Math.exp(-((x0 - m2) ** 2) / (2 * s * s));
        const post = a / (a + b);
        return {
          prompt: `Class 1 is N(${m1}, ${s * s}) with prior ${p1}; class 2 is N(${m2}, ${s * s}) with prior ${fmt(1 - p1, 2)}. What is p(class 1 | x = ${x0})?`,
          answer: fmt(post), params: { m1, m2, s, p1, x0, ask }, tolerance: 0.003,
          steps: [`log-odds = ln(π₁/π₂) + [(x − μ₂)² − (x − μ₁)²]/(2σ²)`, `σ(log-odds) = ${fmt(post)}`], trick: "Shared variance makes the log-odds linear in x: logistic regression's form.",
          mistakes: wrong(fmt(post), [{ answer: fmt(p1), why: "The observation shifts the prior." }, { answer: fmt(Math.exp(-((x0 - m1) ** 2) / (2 * s * s)) / (Math.exp(-((x0 - m1) ** 2) / (2 * s * s)) + Math.exp(-((x0 - m2) ** 2) / (2 * s * s)))), why: p1 === 0.5 ? "" : "Weight each likelihood by its prior." }].filter((m) => m.why)),
        };
      }
      return {
        prompt: `Class 1 is N(${m1}, ${s * s}) with prior ${p1}; class 2 is N(${m2}, ${s * s}) with prior ${fmt(1 - p1, 2)}. At what x is the Bayes decision boundary?`,
        answer: fmt(x), params: { m1, m2, s, p1, ask }, tolerance: 0.002,
        steps: [`equal posteriors: π₁N(x; μ₁) = π₂N(x; μ₂)`, `x = (μ₁ + μ₂)/2 + σ² ln(π₂/π₁)/(μ₁ − μ₂) = ${fmt(x)}`],
        trick: "Equal priors put the boundary at the midpoint; a rarer class pushes it toward its own mean.",
        mistakes: wrong(fmt(x), [{ answer: fmt(m1 + m2), why: "The boundary is at the midpoint (μ₁ + μ₂)/2 when priors are equal, before any shift." }, { answer: fmt((m1 + m2) / 2), why: p1 === 0.5 ? "" : "Unequal priors shift the boundary away from the midpoint." }, { answer: fmt((m1 + m2) / 2 - (s * s * Math.log((1 - p1) / p1)) / (m1 - m2)), why: "The shift goes toward the less likely class's mean." }].filter((m) => m.why)),
      };
    },
  });

  def(["bishop:5.4", "pml:10"], {
    id: "bs-logistic", name: "Logistic regression by hand",
    blurb: "p = σ(wᵀx + b); the cross-entropy gradient is (p − y)x.",
    source: cite("pml", "10 Logistic Regression"),
    gen(level, r) {
      let w, b, x, z;
      do { w = [r.int(-2, 2), r.int(-2, 2)]; b = r.int(-2, 2); x = [r.int(-2, 3), r.int(-2, 3)]; z = w[0] * x[0] + w[1] * x[1] + b; } while (Math.abs(z) > 3);
      const y = r.int(0, 1), p = sigmoid(z);
      const ask = r.pick(band(level, [["p"], ["p", "loss"], ["grad", "loss"], ["grad"], ["grad", "loss"]]));
      if (ask === "p") {
        return {
          prompt: `Logistic regression with w = (${w.join(", ")}), b = ${b}. What probability does it assign to class 1 at x = (${x.join(", ")})?`,
          answer: fmt(p), params: { w, b, x, y, ask }, tolerance: 0.002,
          steps: [`z = ${z}`, `σ(${z}) = ${fmt(p)}`], trick: "z = 0 means probability 1/2.",
          mistakes: wrong(fmt(p), [{ answer: fmt(1 - p), why: "That's class 0." }, { answer: String(z), why: "Pass z through the sigmoid." }]),
        };
      }
      if (ask === "loss") {
        const L = -(y ? Math.log(p) : Math.log(1 - p));
        return {
          prompt: `w = (${w.join(", ")}), b = ${b}, x = (${x.join(", ")}), true label y = ${y}. What is the cross-entropy loss (natural log)?`,
          answer: fmt(L), params: { w, b, x, y, ask }, tolerance: 0.002,
          steps: [`p = σ(${z}) = ${fmt(p)}`, `loss = −ln ${y ? "p" : "(1 − p)"} = ${fmt(L)}`], trick: "Confident mistakes cost a lot.",
          mistakes: wrong(fmt(L), [{ answer: fmt(-(y ? Math.log(1 - p) : Math.log(p))), why: "Use the probability of the true class." }, { answer: fmt((y - p) ** 2), why: "That's squared error." }]),
        };
      }
      const i = r.int(0, 1);
      const g = (p - y) * x[i];
      return {
        prompt: `w = (${w.join(", ")}), b = ${b}, x = (${x.join(", ")}), y = ${y}. What is ∂loss/∂w${i === 0 ? "₁" : "₂"} for the cross-entropy loss?`,
        answer: fmt(g), params: { w, b, x, y, ask, i }, tolerance: 0.002,
        steps: [`p = ${fmt(p)}`, `(p − y)·x${i === 0 ? "₁" : "₂"} = (${fmt(p)} − ${y})·${x[i]} = ${fmt(g)}`], trick: "Prediction error times input: the sigmoid's derivative cancels.",
        mistakes: wrong(fmt(g), [{ answer: fmt((y - p) * x[i]), why: "Sign: the gradient of the loss is (p − y)x." }, { answer: fmt((p - y) * p * (1 - p) * x[i]), why: "With cross-entropy the σ′ factor cancels." }]),
      };
    },
  });

  // ==== Bishop and Murphy: optimisation and regularisation ==============================

  def(["bishop:7.2", "bishop:7.3", "pml:8"], {
    id: "bs-momentum-adam", name: "Momentum and Adam",
    blurb: "Momentum on a constant gradient approaches g/(1 − β); Adam's bias correction makes its first steps ≈ lr.",
    source: cite("bishop", "7.3 Convergence"),
    gen(level, r) {
      const g = r.pick([0.5, 1, 2, -1, 0.1]), beta = r.pick([0.9, 0.5, 0.8]), t = r.int(1, 10), lr = r.pick([0.1, 0.01, 0.001]);
      const ask = r.pick(band(level, [["mom"], ["mom", "limit"], ["adam", "mom"], ["adam", "limit"], ["adam"]]));
      if (ask === "limit") {
        const v = g / (1 - beta);
        return {
          prompt: `Momentum v ← βv + g with β = ${beta} is fed a constant gradient g = ${g}. What does v approach?`,
          answer: fmt(v), params: { g, beta, ask },
          steps: [`fixed point v = βv + g ⇒ v = g/(1 − β) = ${fmt(v)}`], trick: "β = 0.9 multiplies the effective step by 10.",
          mistakes: wrong(fmt(v), [{ answer: fmt(g), why: "Momentum accumulates: v grows past g." }, { answer: fmt(g / beta), why: "Solve v = βv + g: v = g/(1 − β)." }]),
        };
      }
      if (ask === "mom") {
        const v = g * (1 - beta ** t) / (1 - beta);
        return {
          prompt: `Momentum v ← βv + g with β = ${beta}, starting from v = 0, sees the constant gradient g = ${g} for ${t} steps. What is v?`,
          answer: fmt(v), params: { g, beta, t, ask }, tolerance: 0.001,
          steps: [`v_t = g(1 + β + … + β^{t−1}) = g(1 − βᵗ)/(1 − β)`, `= ${fmt(v)}`], trick: "A geometric series.",
          mistakes: wrong(fmt(v), [{ answer: fmt(g * t), why: "Past gradients are discounted by β." }, { answer: fmt(g / (1 - beta)), why: t > 30 ? "" : "That's the limit; after finitely many steps it's smaller." }].filter((m) => m.why)),
        };
      }
      const b2 = 0.999, eps = 1e-8;
      const m = (1 - beta ** t) * g, vv = (1 - b2 ** t) * g * g;
      const step = lr * (m / (1 - beta ** t)) / (Math.sqrt(vv / (1 - b2 ** t)) + eps);
      const raw = lr * m / (Math.sqrt(vv) + eps);
      return {
        prompt: `Adam (β₁ = ${beta}, β₂ = 0.999, ε ≈ 0, lr = ${lr}) sees the constant gradient g = ${g} for ${t} step${t > 1 ? "s" : ""}. How large is the bias-corrected update at step ${t} (lr·m̂/√v̂)?`,
        answer: fmt(step, 6), params: { g, beta, t, lr, ask }, tolerance: 0.001,
        steps: [`m̂ = g, v̂ = g² (bias correction removes the (1 − βᵗ) factors)`, `update = lr·g/|g| = ${fmt(step, 6)}`],
        trick: "Adam's step size is roughly lr, whatever the gradient's scale.",
        mistakes: wrong(fmt(step, 6), [{ answer: fmt(lr * g, 6), why: g === 1 ? "" : "Adam divides by √v̂ ≈ |g|: the scale of g cancels." }, { answer: fmt(raw, 6), why: "Apply the bias correction to m and v." }].filter((m2) => m2.why)),
      };
    },
  });

  def(["bishop:ch9", "d2l:3"], {
    id: "bs-weight-decay", name: "Weight decay",
    blurb: "With penalty (λ/2)‖w‖², each SGD step multiplies w by (1 − ηλ) before the gradient step.",
    source: cite("bishop", "9 Regularization"),
    gen(level, r) {
      const eta = r.pick([0.1, 0.01, 0.05]), lam = r.pick([0.1, 0.01, 0.5, 1]), k = r.int(1, band(level, [1, 5, 10, 50, 100]));
      const w0 = r.pick([1, 2, 5, 10]);
      const w = w0 * (1 - eta * lam) ** k;
      return {
        prompt: `Only the penalty (λ/2)w² acts (no data gradient). Starting at w = ${w0}, what is w after ${k} SGD step${k > 1 ? "s" : ""} with η = ${eta}, λ = ${lam}?`,
        answer: fmt(w, 5), params: { eta, lam, k, w0 }, tolerance: 0.001,
        steps: [`each step: w ← w − ηλw = (1 − ${fmt(eta * lam, 4)})w`, `${w0}·(${fmt(1 - eta * lam, 4)})^${k} = ${fmt(w, 5)}`],
        trick: "That's why it's called weight *decay*: geometric shrinkage.",
        mistakes: wrong(fmt(w, 5), [{ answer: fmt(w0 - k * eta * lam, 5), why: "The shrinkage is proportional to w: multiply, don't subtract a constant." }, { answer: fmt(w0 * (1 - 2 * eta * lam) ** k, 5), why: "The ½ in (λ/2)w² cancels the 2 from differentiating." }]),
      };
    },
  });

  // ==== Bishop: structured models, transformers, GNNs, sampling, latent variables =========

  def(["bishop:ch11"], {
    id: "bs-bayes-net-params", name: "Parameters of a Bayesian network",
    blurb: "A binary node with k parents needs 2ᵏ numbers; the full joint needs 2ⁿ − 1.",
    source: cite("bishop", "11 Structured Distributions"),
    gen(level, r) {
      const n = r.int(3, band(level, [4, 5, 6, 7, 8]));
      const parents = Array.from({ length: n }, (_, i) => (i === 0 ? 0 : r.int(0, Math.min(i, 3))));
      const params = sum(parents.map((k) => 2 ** k));
      const ask = level >= 3 && r() < 0.4 ? "saving" : "params";
      const ans = ask === "params" ? params : 2 ** n - 1 - params;
      return {
        prompt: `A Bayesian network over ${n} binary variables, in topological order, where the nodes have ${parents.join(", ")} parents respectively. ${ask === "params" ? "How many independent parameters does it need?" : "How many fewer parameters does it need than a full joint table?"}`,
        answer: String(ans), params: { parents, ask },
        steps: [`Σ 2^{#parents} = ${parents.map((k) => 2 ** k).join(" + ")} = ${params}`, ...(ask === "saving" ? [`full joint 2^${n} − 1 = ${2 ** n - 1}; saving ${ans}`] : [])],
        trick: "Each row of a binary CPT needs one number, and there is a row per parent configuration.",
        mistakes: wrong(String(ans), [{ answer: String(ask === "params" ? sum(parents.map((k) => 2 ** (k + 1))) : 2 ** n - params), why: ask === "params" ? "A binary variable's two probabilities sum to 1: one free number per row." : "The full joint has 2ⁿ − 1 free numbers." }, { answer: String(ask === "params" ? 2 ** n - 1 : 0), why: "The graph's conditional independences cut the count." }]),
      };
    },
  });

  def(["bishop:ch13"], {
    id: "bs-gnn", name: "One round of message passing",
    blurb: "hᵥ′ = aggregate over neighbours (and self): sums, means, or the symmetric GCN normalisation.",
    source: cite("bishop", "13 Graph Neural Networks"),
    gen(level, r) {
      for (;;) {
        const n = r.int(4, 6);
        const E = [];
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < 0.45) E.push([i, j]);
        const nb = Array.from({ length: n }, (_, v) => E.filter((e) => e.includes(v)).map((e) => (e[0] === v ? e[1] : e[0])));
        const h = Array.from({ length: n }, () => r.int(-2, 5));
        const v = r.int(0, n - 1);
        if (!nb[v].length) continue;
        const agg = r.pick(band(level, [["sum"], ["sum", "mean"], ["mean", "gcn"], ["gcn", "mean"], ["gcn"]]));
        let ans, steps;
        if (agg === "sum") { ans = F(h[v] + sum(nb[v].map((u) => h[u]))); steps = [`self ${h[v]} + neighbours ${nb[v].map((u) => h[u]).join(" + ")}`]; }
        else if (agg === "mean") { ans = F(sum(nb[v].map((u) => h[u])), nb[v].length); steps = [`mean of neighbours ${nb[v].map((u) => h[u]).join(", ")}`]; }
        else {
          const d = (u) => nb[u].length + 1;
          const val2 = [v, ...nb[v]].reduce((s, u) => s + h[u] / Math.sqrt(d(u) * d(v)), 0);
          ans = null; steps = [`Σ_{u ∈ N(v) ∪ {v}} h_u/√(d̃_u d̃_v), with d̃ = degree + 1`, `= ${fmt(val2)}`];
          return {
            prompt: `Graph on nodes 0–${n - 1} with edges ${E.map((e) => `${e[0]}–${e[1]}`).join(", ")}; scalar features h = (${h.join(", ")}). With self-loops added, a GCN layer (no weights or activation) computes $\\sum_{u} h_u/\\sqrt{\\tilde d_u \\tilde d_v}$ over u ∈ N(${v}) ∪ {${v}}. What is the new feature of node ${v}?`,
            answer: fmt(val2), params: { n, E, h, v, agg }, tolerance: 0.002,
            steps, trick: "The symmetric normalisation D̃^{−1/2}ÃD̃^{−1/2} keeps high-degree nodes from dominating.",
            mistakes: wrong(fmt(val2), [{ answer: String(h[v] + sum(nb[v].map((u) => h[u]))), why: "Normalise each term by √(d̃_u d̃_v)." }, { answer: fmt((h[v] + sum(nb[v].map((u) => h[u]))) / d(v)), why: "The GCN normalisation is symmetric: use both endpoints' degrees." }]),
          };
        }
        return {
          prompt: `Graph on nodes 0–${n - 1} with edges ${E.map((e) => `${e[0]}–${e[1]}`).join(", ")}; scalar features h = (${h.join(", ")}). One round of ${agg === "sum" ? "sum aggregation including the node itself" : "mean aggregation over neighbours (excluding the node)"}: what is node ${v}'s new feature?`,
          answer: str(ans), params: { n, E, h, v, agg },
          steps, trick: "Only direct neighbours contribute in one round.",
          mistakes: wrong(str(ans), [{ answer: String(sum(nb[v].map((u) => h[u])) + (agg === "sum" ? 0 : h[v])), why: agg === "sum" ? "Include the node's own feature." : "Mean aggregation divides by the number of neighbours and excludes the node." }, { answer: String(sum(h)), why: "Only neighbours of the node contribute." }]),
        };
      }
    },
  });

  def(["bishop:ch14"], {
    id: "bs-sampling", name: "Rejection sampling and Metropolis",
    blurb: "Rejection sampling accepts with rate 1/M; Metropolis accepts with min(1, p(x′)/p(x)).",
    source: cite("bishop", "14 Sampling"),
    gen(level, r) {
      const fam = r.pick(band(level, [["reject"], ["reject", "mh"], ["mh", "importance"], ["importance", "mh"], ["mh", "importance"]]));
      if (fam === "reject") {
        const M = r.pick([1.5, 2, 4, 10]), N = r.pick([100, 1000, 10000]);
        return {
          prompt: `Rejection sampling with a normalised proposal q and target p ≤ Mq, M = ${M}. On average, how many proposals are needed to get ${N} accepted samples?`,
          answer: fmt(N * M, 2), params: { fam, M, N },
          steps: [`acceptance rate 1/M = ${fmt(1 / M)}`, `${N}·${M} = ${fmt(N * M, 2)}`], trick: "A loose envelope (large M) wastes proposals.",
          mistakes: wrong(fmt(N * M, 2), [{ answer: fmt(N / M, 2), why: "Only 1/M are accepted, so you need M times as many." }, { answer: String(N), why: "Some proposals are rejected." }]),
        };
      }
      if (fam === "mh") {
        const mu = 0, s = r.pick([1, 2]), x = r.pick([0, 0.5, 1, -1]), xp = r.pick([1.5, 2, -2, 0.5, 3]);
        const a = Math.min(1, Math.exp(-((xp - mu) ** 2 - (x - mu) ** 2) / (2 * s * s)));
        return {
          prompt: `Metropolis sampling from N(0, ${s * s}) with a symmetric proposal. The chain is at x = ${x} and proposes x′ = ${xp}. What is the acceptance probability?`,
          answer: fmt(a), params: { fam, s, x, xp }, tolerance: 0.002,
          steps: [`p(x′)/p(x) = exp(−(x′² − x²)/(2σ²)) = ${fmt(Math.exp(-((xp) ** 2 - x ** 2) / (2 * s * s)))}`, `min(1, ·) = ${fmt(a)}`], trick: "Uphill moves are always accepted.",
          mistakes: wrong(fmt(a), [{ answer: fmt(Math.exp(-(xp ** 2 - x ** 2) / (2 * s * s))), why: a < 1 ? "" : "Cap at 1." }, { answer: fmt(Math.exp(-(xp ** 2) / (2 * s * s))), why: "Use the ratio p(x′)/p(x); normalising constants cancel." }].filter((m) => m.why)),
        };
      }
      const p = [0.2, 0.3, 0.5], q = [r.pick([0.2, 0.4, 0.5]), r.pick([0.3, 0.25]), 0];
      q[2] = +(1 - q[0] - q[1]).toFixed(2);
      const f = [r.int(0, 5), r.int(0, 5), r.int(0, 5)];
      const est = sum(q.map((qi, i) => qi * (p[i] / qi) * f[i]));
      return {
        prompt: `Importance sampling: target p = (${p.join(", ")}), proposal q = (${q.join(", ")}) over three states, f = (${f.join(", ")}). What is the expected value, under q, of the importance-weighted estimate f(x)·p(x)/q(x)?`,
        answer: fmt(est), params: { fam, p, q, f }, tolerance: 0.002,
        steps: [`weights p/q = (${p.map((pi, i) => fmt(pi / q[i], 3)).join(", ")})`, `E_q[f·p/q] = Σ p f = ${fmt(est)}`], trick: "Importance sampling is unbiased: it returns E_p[f].",
        mistakes: wrong(fmt(est), [{ answer: fmt(sum(q.map((qi, i) => qi * f[i]))), why: "Without weights you estimate E_q[f], not E_p[f]." }]),
      };
    },
  });

  def(["bishop:ch15"], {
    id: "bs-kmeans-gmm", name: "K-means and mixture responsibilities",
    blurb: "K-means: assign to the nearest centre, then average. GMM: responsibilities ∝ πₖ N(x; μₖ, σ²).",
    source: cite("bishop", "15 Discrete Latent Variables"),
    gen(level, r) {
      const ask = level <= 2 ? "kmeans" : r.pick(["kmeans", "resp"]);
      if (ask === "kmeans") {
        const xs = Array.from({ length: r.int(5, 8) }, () => r.int(0, 20));
        const c = [r.int(0, 8), r.int(12, 20)];
        const k = r.int(0, 1);
        const mine = xs.filter((x) => Math.abs(x - c[k]) < Math.abs(x - c[1 - k]) || (Math.abs(x - c[k]) === Math.abs(x - c[1 - k]) && k === 0));
        if (!mine.length) return this.gen(level, r);
        const ans = F(sum(mine), mine.length);
        return {
          prompt: `1-D k-means with centres ${c[0]} and ${c[1]} (ties go to the first). Points: ${xs.join(", ")}. After one assignment and update step, where is the centre that started at ${c[k]}?`,
          answer: str(ans), params: { ask, xs, c, k }, tolerance: 0.002,
          steps: [`assigned to ${c[k]}: ${mine.join(", ")}`, `mean = ${str(ans)}`], trick: "Each step can only lower the total squared distance.",
          mistakes: wrong(str(ans), [{ answer: str(F(sum(xs), xs.length)), why: "Average only the points assigned to this centre." }, { answer: String(c[k]), why: "The update moves the centre to its cluster's mean." }]),
        };
      }
      let m, pi, x, a, b, g;
      // keep the point between the components, where the responsibility is informative
      do {
        m = [r.int(-2, 1), r.int(2, 5)]; pi = r.pick([0.5, 0.3, 0.7]); x = r.int(m[0], m[1]);
        a = pi * Math.exp(-((x - m[0]) ** 2) / 2); b = (1 - pi) * Math.exp(-((x - m[1]) ** 2) / 2); g = a / (a + b);
      } while (g < 0.01 || g > 0.99);
      return {
        prompt: `A two-component 1-D Gaussian mixture has means ${m[0]}, ${m[1]}, unit variances and weights ${pi}, ${fmt(1 - pi, 2)}. What is the responsibility of component 1 for x = ${x}?`,
        answer: fmt(g), params: { ask, m, pi, x }, tolerance: 0.002,
        steps: [`π₁N(x; μ₁) ∝ ${fmt(a)}`, `π₂N(x; μ₂) ∝ ${fmt(b)}`, `γ = ${fmt(g)}`], trick: "Responsibilities are posterior probabilities of the latent label.",
        mistakes: wrong(fmt(g), [{ answer: fmt(pi), why: "The point's position updates the prior weight." }, { answer: Math.abs(x - m[0]) <= Math.abs(x - m[1]) ? "1" : "0", why: "That's k-means' hard assignment; the mixture gives a soft one." }]),
      };
    },
  });

  def(["bishop:ch16", "pml:20"], {
    id: "bs-pca", name: "Principal components and explained variance",
    blurb: "The fraction of variance kept by the top k components is Σᵢ≤ₖ λᵢ / Σ λᵢ.",
    source: cite("pml", "20 Dimensionality Reduction"),
    gen(level, r) {
      const ask = r.pick(band(level, [["ratio"], ["ratio", "k"], ["k", "eig2"], ["eig2", "k"], ["eig2", "ratio"]]));
      if (ask === "eig2") {
        const a = r.int(1, 9), c = r.int(1, 9), b = r.int(-4, 4);
        const tr = a + c, dt = a * c - b * b;
        const l = (tr + Math.sqrt(tr * tr - 4 * dt)) / 2;
        return {
          prompt: `The covariance matrix of 2-D data is [[${a}, ${b}], [${b}, ${c}]]. What fraction of the variance does the first principal component explain?`,
          answer: fmt(l / tr), params: { ask, a, b, c }, tolerance: 0.002,
          steps: [`largest eigenvalue λ₁ = ${fmt(l)}`, `λ₁/trace = ${fmt(l)}/${tr} = ${fmt(l / tr)}`], trick: "Total variance is the trace.",
          mistakes: wrong(fmt(l / tr), [{ answer: fmt(Math.max(a, c) / tr), why: b === 0 ? "" : "With correlation the top component isn't an axis: use the eigenvalue." }, { answer: fmt(l / Math.sqrt(a * a + c * c)), why: "Divide by the total variance, the trace." }].filter((m) => m.why)),
        };
      }
      const ls = Array.from({ length: r.int(4, 7) }, () => r.int(1, 30)).sort((x, y) => y - x);
      const tot = sum(ls);
      if (ask === "ratio") {
        const k = r.int(1, ls.length - 1);
        const ans = F(sum(ls.slice(0, k)), tot);
        return {
          prompt: `The covariance eigenvalues are ${ls.join(", ")}. What fraction of the variance do the top ${k} components keep?`,
          answer: str(ans), params: { ask, ls, k }, tolerance: 0.002,
          steps: [`${ls.slice(0, k).join(" + ")} = ${sum(ls.slice(0, k))} of ${tot}`], trick: "Eigenvalues are variances along the principal axes.",
          mistakes: wrong(str(ans), [{ answer: str(F(k, ls.length)), why: "Weight the components by their eigenvalues." }, { answer: str(F(ls[k - 1], tot)), why: "Sum the top k eigenvalues, not just the k-th." }]),
        };
      }
      const th = r.pick([0.8, 0.9, 0.95]);
      let k = 0, acc = 0;
      while (acc < th * tot - 1e-9) acc += ls[k++];
      return {
        prompt: `The covariance eigenvalues are ${ls.join(", ")}. What is the smallest number of principal components that keeps at least ${th * 100} percent of the variance?`,
        answer: String(k), params: { ask, ls, th },
        steps: [`cumulative: ${ls.map((_, i) => fmt(sum(ls.slice(0, i + 1)) / tot, 3)).join(", ")}`, `first ≥ ${th}: k = ${k}`], trick: "Add eigenvalues largest first until you pass the threshold.",
        mistakes: wrong(String(k), [{ answer: String(Math.ceil(th * ls.length)), why: "Components carry unequal variance." }, { answer: String(k + 1), why: `${k} already reaches ${th * 100} percent.` }]),
      };
    },
  });

  def(["bishop:ch18"], {
    id: "bs-flows", name: "Change of variables in normalizing flows",
    blurb: "log p_x(x) = log p_z(f(x)) + log |det ∂f/∂x|.",
    source: cite("bishop", "18 Normalizing Flows"),
    gen(level, r) {
      const d = band(level, [1, 1, 2, 2, 3]);
      const s = Array.from({ length: d }, () => r.pick([0.5, 2, 4, 0.25])), mu = Array.from({ length: d }, () => r.int(-2, 2)), x = Array.from({ length: d }, () => r.int(-2, 3));
      const z = x.map((xi, i) => (xi - mu[i]) / s[i]);
      const logpz = sum(z.map((zi) => -0.5 * zi * zi - 0.5 * Math.log(2 * Math.PI)));
      const logdet = -sum(s.map((si) => Math.log(si)));
      const ans = logpz + logdet;
      return {
        prompt: `A flow maps x to z = (x − μ)/s elementwise, with z standard normal; μ = (${mu.join(", ")}), s = (${s.join(", ")}). What is log p_x(x) at x = (${x.join(", ")})?`,
        answer: fmt(ans), params: { s, mu, x }, tolerance: 0.002,
        steps: [`z = (${z.map((v) => fmt(v, 3)).join(", ")})`, `log p_z(z) = ${fmt(logpz)}`, `log|det ∂z/∂x| = −Σ log s = ${fmt(logdet)}`, `sum = ${fmt(ans)}`],
        trick: "Stretching space (s > 1) spreads probability thinner.",
        mistakes: wrong(fmt(ans), [{ answer: fmt(logpz), why: "Add the log-determinant of the Jacobian." }, { answer: fmt(logpz - logdet), why: "The Jacobian of z = (x − μ)/s is 1/s: log det = −Σ log s." }]),
      };
    },
  });

  def(["bishop:ch19"], {
    id: "bs-vae-kl", name: "The KL term of a VAE",
    blurb: "KL(N(μ, σ²) ‖ N(0, 1)) = ½(μ² + σ² − 1 − ln σ²), summed over latent dimensions.",
    source: cite("bishop", "19 Autoencoders"),
    gen(level, r) {
      const d = band(level, [1, 1, 2, 2, 3]);
      const mu = Array.from({ length: d }, () => r.pick([0, 0.5, 1, -1, 2])), s = Array.from({ length: d }, () => r.pick([1, 0.5, 2, 0.1]));
      const kl = sum(mu.map((m, i) => 0.5 * (m * m + s[i] * s[i] - 1 - Math.log(s[i] * s[i]))));
      return {
        prompt: `An encoder outputs mean (${mu.join(", ")}) and standard deviation (${s.join(", ")}) for a diagonal Gaussian q(z | x). What is KL(q ‖ N(0, I))?`,
        answer: fmt(kl), params: { mu, s }, tolerance: 0.002,
        steps: [`per dimension ½(μ² + σ² − 1 − ln σ²)`, `total ${fmt(kl)}`], trick: "It's 0 exactly when μ = 0 and σ = 1.",
        mistakes: wrong(fmt(kl), [{ answer: fmt(sum(mu.map((m, i) => 0.5 * (m * m + s[i] - 1 - Math.log(s[i]))))), why: "Use the variance σ², not σ." }, { answer: fmt(sum(mu.map((m) => 0.5 * m * m))), why: "The variance term matters too." }]),
      };
    },
  });

  def(["bishop:ch20"], {
    id: "bs-diffusion", name: "The forward process of a diffusion model",
    blurb: "ᾱₜ = ∏ₛ≤ₜ (1 − βₛ); q(xₜ | x₀) = N(√ᾱₜ x₀, (1 − ᾱₜ)I).",
    source: cite("bishop", "20 Diffusion Models"),
    gen(level, r) {
      const t = r.int(2, band(level, [3, 5, 10, 50, 200]));
      const beta = r.pick([0.01, 0.02, 0.05, 0.1]);
      const abar = (1 - beta) ** t;
      const ask = r.pick(["mean", "var", "snr"].slice(0, level <= 2 ? 2 : 3));
      const ans = { mean: Math.sqrt(abar), var: 1 - abar, snr: abar / (1 - abar) }[ask];
      return {
        prompt: `A diffusion model's forward process adds noise with constant βₜ = ${beta}. After t = ${t} steps, what is ${{ mean: "the coefficient multiplying x₀ in the mean of q(xₜ | x₀)", var: "the variance of q(xₜ | x₀)", snr: "the signal-to-noise ratio ᾱₜ/(1 − ᾱₜ)" }[ask]}?`,
        answer: fmt(ans, 5), params: { t, beta, ask }, tolerance: 0.002,
        steps: [`ᾱ = (1 − ${beta})^${t} = ${fmt(abar, 5)}`, `${{ mean: "√ᾱ", var: "1 − ᾱ", snr: "ᾱ/(1 − ᾱ)" }[ask]} = ${fmt(ans, 5)}`],
        trick: "Noise compounds multiplicatively, so you can jump straight to any t.",
        mistakes: wrong(fmt(ans, 5), [
          { answer: fmt(ask === "mean" ? abar : ask === "var" ? t * beta : abar / (t * beta), 5), why: ask === "mean" ? "The mean scales by √ᾱ, not ᾱ." : "The noise doesn't simply add up: ᾱ is a product." },
          { answer: fmt(ask === "mean" ? Math.sqrt(1 - beta) : ask === "var" ? beta : (1 - beta) / beta, 5), why: "That's one step; compound over all t." },
        ]),
      };
    },
  });

  // ==== tags: existing generators that already practise these books' chapters =========

  const TAGS = {
    "softmax-2": ["bishop:5.4", "pml:10"], "cross-entropy": ["bishop:6.4", "pml:10", "bishop:2.5"], "gradient-step": ["bishop:7.2", "pml:8"],
    "ml-mlp-params": ["bishop:6.2", "pml:13"], "ml-conv1x1": ["bishop:ch10"], "ml-conv-sharing": ["bishop:ch10"], "ml-pooling": ["bishop:ch10"],
    "ml-tanh-sigmoid": ["bishop:6.2"], "ml-chain-rule": ["bishop:ch8"], "ml-vector-backward": ["bishop:ch8"], "ml-backprop-memory": ["bishop:ch8"],
    "ml-gd-stability": ["bishop:7.1", "bishop:7.2", "pml:8"], "ml-saddle": ["bishop:7.1", "pml:8"], "ml-bisection": ["pml:8"],
    "ml-dropout": ["bishop:ch9"], "ml-early-stopping": ["bishop:ch9"], "ml-noisy-gram": ["bishop:ch9", "pml:11"],
    "ml-attention-cov": ["bishop:ch12"], "ml-sinusoidal-pe": ["bishop:ch12"], "es-attn-memory": ["bishop:ch12"], "ml-additive-params": ["bishop:ch12"],
    "ml-best-constant": ["pml:5", "bishop:4.2"], "ml-coin-variance": ["pml:4"], "ml-bootstrap": ["pml:4"], "ml-kfold": ["pml:4"], "ml-sqrt-n": ["pml:4"],
    "ml-nullspace-proj": ["pml:7"], "ml-linear-rank": ["pml:7", "bishop:6.1"], "la-eigen2": ["pml:7"], "la-projection": ["pml:7"], "la-gram-schmidt": ["pml:7"],
    "ml-logsumexp": ["pml:2"], "ml-markov-joint": ["bishop:ch11"], "ml-vc-poly": ["bishop:6.1"],
    "gs-normal": ["bishop:2.3", "pml:2"], "gs-density-transform": ["bishop:2.4", "pml:2"], "gs-expected-value": ["pml:2"], "gs-variance": ["pml:2"],
    "pr-bayes-test": ["bishop:2.1", "pml:2"], "gs-urns-bayes": ["bishop:2.1"], "gs-binomial": ["pml:2", "bishop:3.1"], "gs-mgf-moments": ["pml:2"],
    "es-train-flops": ["d2l:13"], "es-flops": ["d2l:13"], "ml-model-parallel": ["d2l:13"],
  };
  for (const [id, cs] of Object.entries(TAGS)) {
    const g = M._generators[id], info = M.SKILLS.find((s) => s.id === id);
    if (!g || !info) continue;
    const add = cs.map(cid).filter((c) => !info.concepts.includes(c));
    info.concepts = [...info.concepts, ...add];
    g.concepts = info.concepts;
  }
})();
