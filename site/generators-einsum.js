// Einsum, einops and resource-accounting drills, in the style of Stanford CS336
// (Language Modeling from Scratch), which writes models as named-axis einsums and
// asks, for every one, what shape comes out and what it costs.
//
// Everything is generated: axis letters are re-drawn per problem so the pattern,
// not the spelling, is what gets learned, and every distractor is what a named
// mistake produces (keeping a summed axis, transposing the output, forgetting the
// factor of 2 in a multiply-add). scripts/generator_refs.py recomputes each
// answer with numpy/torch/einops from `params`.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M) return;
  const { band } = M.util;
  const ML = "machine learning";

  const fmt = (x, dp = 3) => String(Number(x.toFixed(dp)));
  const shape = (xs) => `(${xs.join(", ")})`;
  const prod = (xs) => xs.reduce((a, b) => a * b, 1);
  const wrong = (answer, list) => list.filter((m) => m.answer !== answer);

  const CS336 = {
    book: "cs336", title: "Stanford CS336", section: "PyTorch, einops and resource accounting",
    url: "https://stanford-cs336.github.io/spring2025/", fidelity: "inspired",
  };
  const EINOPS = {
    book: "einops", title: "einops documentation", section: "rearrange",
    url: "https://einops.rocks/", fidelity: "inspired",
  };
  const NUMPY = {
    book: "numpy", title: "numpy.einsum", section: "reference",
    url: "https://numpy.org/doc/stable/reference/generated/numpy.einsum.html", fidelity: "inspired",
  };

  // Einsum is tensor algebra: without a topic of its own, it files under d2l's
  // Preliminaries chapter, where tensors and their operations are introduced.
  const def = (g) => M.define({ domain: ML, concepts: ["concept:d2l:ch2"], ...g });

  /** Contractions worth knowing, as templates over abstract axis letters. */
  const OPS = [
    { name: "matrix product", spec: "ik,kj->ij", level: 1 },
    { name: "matrix–vector product", spec: "ij,j->i", level: 1 },
    { name: "outer product", spec: "i,j->ij", level: 1 },
    { name: "batched matrix product", spec: "bik,bkj->bij", level: 2 },
    { name: "sum over the sequence", spec: "bsd->bd", level: 2 },
    { name: "attention scores", spec: "bhqd,bhkd->bhqk", level: 3 },
    { name: "attention-weighted values", spec: "bhqk,bhkd->bhqd", level: 3 },
    { name: "per-head projection", spec: "bsd,hde->bhse", level: 4 },
    { name: "bilinear form", spec: "bi,ij,bj->b", level: 4 },
  ];

  /** Re-letter a spec so the same contraction is drawn with new names. */
  function reletter(spec, r) {
    const used = [...new Set(spec.replace(/[^a-z]/g, ""))];
    const pool = "abcdefghijklmnopqrstuvwxyz".split("");
    const map = {};
    for (const c of used) {
      const i = r.int(0, pool.length - 1);
      map[c] = pool.splice(i, 1)[0];
    }
    return spec.replace(/[a-z]/g, (c) => map[c]);
  }

  /** Parse "ab,bc->ac" into operands, output and axis sizes. */
  function parse(spec) {
    const [lhs, out] = spec.split("->");
    return { ins: lhs.split(","), out };
  }

  function drawOp(level, r) {
    const ops = OPS.filter((o) => o.level <= level);
    const op = r.pick(ops);
    const spec = level <= 2 ? reletter(op.spec, r) : op.spec;
    const { ins, out } = parse(spec);
    const axes = [...new Set(ins.join(""))];
    const sizes = {};
    for (const a of axes) sizes[a] = r.int(2, band(level, [5, 8, 16, 64, 128]));
    return { op, spec, ins, out, axes, sizes };
  }

  // ---- output shapes ---------------------------------------------------------------

  def({
    id: "es-shape", name: "Einsum output shapes",
    blurb: "Axes named after the arrow survive; every other axis is summed away.",
    source: NUMPY,
    gen(level, r) {
      const { spec, ins, out, axes, sizes } = drawOp(level, r);
      const dims = (s) => [...s].map((a) => sizes[a]);
      const answer = shape(dims(out));
      const summed = axes.filter((a) => !out.includes(a));
      const firstSeen = axes.filter((a) => out.includes(a));
      return {
        prompt: `\`einsum("${spec}", ${ins.map((s, i) => `X${i + 1}`).join(", ")})\` where `
          + ins.map((s, i) => `X${i + 1} has shape ${shape(dims(s))}`).join(" and ")
          + `. What is the shape of the result?`,
        answer, kind: "shape", params: { spec, sizes },
        steps: [`axes: ${axes.map((a) => `${a}=${sizes[a]}`).join(", ")}`,
                summed.length ? `summed away: ${summed.join(", ")}` : "nothing is summed",
                `output axes ${out || "(none)"} → ${answer}`],
        trick: "Read the right-hand side: it is the output shape, axis by axis.",
        mistakes: wrong(answer, [
          ...(summed.length ? [{ answer: shape([...dims(out), ...summed.map((a) => sizes[a])]),
            why: `Axes that don't appear after the arrow (${summed.join(", ")}) are summed over, not kept.` }] : []),
          ...(firstSeen.join("") !== out && out.length > 1 ? [{ answer: shape(dims(firstSeen.join(""))),
            why: "The output order is the order written after the arrow, not the order axes first appear." }] : []),
          ...(out.length > 1 ? [{ answer: shape(dims(out.slice(1))),
            why: `The leading axis ${out[0]} is named in the output, so it is kept.` }] : []),
          { answer: shape(dims([...out].reverse().join(""))),
            why: "That is the transpose; the output axes come in the order written." },
        ]),
      };
    },
  });

  // ---- loops into einsums --------------------------------------------------------------
  //
  // The skill CS336 actually asks for: read a loop nest and write it as one
  // einsum. Checked by meaning (MathGen.check runs both specs on the same
  // operands), so any lettering or a full torch.einsum(...) call is accepted.

  const LOOPS = [
    ["ij,j->i", 1], ["ij->i", 1], ["i,j->ij", 1], ["i,i->", 1], ["ij->ji", 1],
    ["ik,kj->ij", 2], ["ii->", 2], ["ii->i", 2], ["ij,ij->ij", 2], ["ij,ij->", 2],
    ["bik,bkj->bij", 3], ["bqd,bkd->bqk", 3], ["bi,bj->bij", 3], ["ij,kj->ik", 3],
    ["bhqd,bhkd->bhqk", 4], ["bhqk,bhkd->bhqd", 4], ["bi,ij,bj->b", 4],
    ["bsd,hde->bhse", 5], ["bhqk,bhkd->bqhd", 5], ["ijk,jl->ilk", 5],
  ];
  const LETTERS = "ijklmnpqrstuvwxyz".split("");

  function loopCode(spec, names) {
    const [lhs, out] = spec.split("->");
    const ins = lhs.split(",");
    const seen = [...new Set(ins.join(""))];
    const summed = seen.filter((c) => !out.includes(c));
    const order = [...out, ...summed];
    const dim = (c) => c.toUpperCase();
    const idx = (s) => [...s].join(", ");
    const lines = [];
    lines.push(out ? `out = torch.zeros(${[...out].map(dim).join(", ")})` : "out = 0.0");
    order.forEach((c, d) => lines.push(`${"    ".repeat(d)}for ${c} in range(${dim(c)}):`));
    const term = ins.map((s, k) => `${names[k]}[${idx(s)}]`).join(" * ");
    const target = out ? `out[${idx(out)}]` : "out";
    lines.push(`${"    ".repeat(order.length)}${target} ${summed.length ? "+=" : "="} ${term}`);
    return lines.join("\n");
  }

  def({
    id: "es-loop", name: "Loops into einsum",
    blurb: "Loop indices become letters; indices only on the right-hand side are summed.",
    source: CS336,
    gen(level, r) {
      const pool = LOOPS.filter(([, l]) => l <= level && l >= Math.max(1, level - 2));
      const [template] = r.pick(pool);
      // Fresh letters per draw, so the answer can't be recognised from its spelling.
      const letters = [...new Set(template.replace(/[^a-z]/g, ""))];
      const free = [...LETTERS];
      const map = {};
      for (const c of letters) map[c] = free.splice(r.int(0, free.length - 1), 1)[0];
      const spec = template.replace(/[a-z]/g, (c) => map[c]);
      const [lhs, out] = spec.split("->");
      const ins = lhs.split(",");
      const names = ["A", "B", "C"].slice(0, ins.length);
      // Distinct small sizes, so a transposed answer really computes something else.
      const sizes = {};
      const sz = [2, 3, 4, 5].sort(() => r() - 0.5);
      [...new Set(lhs.replace(/,/g, ""))].forEach((c, i) => { sizes[c] = sz[i % sz.length]; });
      const shapes = ins.map((s) => [...s].map((c) => sizes[c]));
      const summed = [...new Set(lhs.replace(/,/g, ""))].filter((c) => !out.includes(c));
      const code = loopCode(spec, names);
      const call = `torch.einsum("${spec}", ${names.join(", ")})`;
      const mistakes = [];
      if (out.length > 1) mistakes.push({ answer: `${lhs}->${[...out].reverse().join("")}`,
        why: "The output indices go in the order the loop writes out[...]; this transposes it." });
      if (summed.length) mistakes.push({ answer: `${lhs}->${out}${summed[0]}`,
        why: `${summed[0]} only appears on the right-hand side (it is accumulated with +=), so it is summed, not kept.` });
      if (out.length) mistakes.push({ answer: `${lhs}->${out.slice(1)}`,
        why: `out is indexed by ${out[0]}, so ${out[0]} stays in the output.` });
      mistakes.push({ answer: lhs,
        why: "Without ->, einsum sums repeated letters and sorts the rest alphabetically, which isn't this loop's output order." });
      return {
        prompt: `Write this loop as a single einsum. Give the spec (like \`ij,j->i\`) or the whole call. `
          + `${names.map((n, k) => `${n} has shape (${[...ins[k]].map((c) => c.toUpperCase()).join(", ")})`).join(", ")}.`
          + `\n\n\`\`\`\n${code}\n\`\`\``,
        answer: spec, kind: "einsum", typed: true, shapes,
        params: { spec, code, shapes, names },
        steps: [`loop indices: ${[...new Set(lhs.replace(/,/g, ""))].join(", ")}`,
                summed.length ? `accumulated (only on the right): ${summed.join(", ")} → summed` : "nothing is accumulated",
                `out[${[...out].join(", ")}] → output "${out}"`, call],
        trick: "Letters on out[...] go after the arrow; everything else is summed.",
        mistakes,
      };
    },
  });

  // ---- which spec -------------------------------------------------------------------

  /** Operations with a right spec and the specs common mistakes produce. */
  const WHICH = [
    { what: "the trace of a square matrix A", shapes: ["A: (n, n)"], right: "ii->",
      wrongs: [["ii->i", "That returns the diagonal; an empty output sums it."],
               ["ij->", "That sums every entry, not just the diagonal."],
               ["ij->ji", "That is the transpose."]] },
    { what: "the row sums of A", shapes: ["A: (m, n)"], right: "ij->i",
      wrongs: [["ij->j", "Keeping j sums over rows: those are column sums."],
               ["ij->", "An empty output sums everything into one number."],
               ["ij->ij", "Keeping both axes sums nothing."]] },
    { what: "the outer product of u and v", shapes: ["u: (m,)", "v: (n,)"], right: "i,j->ij",
      wrongs: [["i,i->i", "A shared axis kept in the output is an elementwise product."],
               ["i,i->", "A shared axis dropped from the output is a dot product."],
               ["i,j->ji", "That is the transpose, v uᵀ."]] },
    { what: "the batched matrix product A[b] @ B[b]", shapes: ["A: (B, m, k)", "B: (B, k, n)"], right: "bik,bkj->bij",
      wrongs: [["bik,bkj->ij", "Dropping b sums the products over the batch."],
               ["bik,bkj->bji", "That transposes each product."],
               ["bik,bjk->bij", "That contracts against B's last axis, which assumes B is stored transposed."]] },
    { what: "attention scores Q Kᵀ for every head", shapes: ["Q: (B, H, S, D)", "K: (B, H, S, D)"], right: "bhqd,bhkd->bhqk",
      wrongs: [["bhqd,bhkd->bhkq", "That is the transpose: rows should index queries."],
               ["bhqd,bhkd->bqk", "Dropping h sums the scores over heads."],
               ["bhqd,bhkd->bhq", "Dropping k sums over keys, before any softmax."]] },
    { what: "the quadratic form xᵀ A x for each row x of X", shapes: ["X: (B, n)", "A: (n, n)"], right: "bi,ij,bj->b",
      wrongs: [["bi,ij,bj->bij", "Keeping i and j leaves every term unsummed."],
               ["bi,ij,bi->b", "That pairs both copies of x with A's row index, so it sums rows of A instead of forming xᵀAx."],
               ["bi,ij,bj->", "Dropping b sums over the whole batch."]] },
  ];

  def({
    id: "es-which", name: "Which einsum?",
    blurb: "Name each axis; keep what the result has, sum what it doesn't.",
    source: CS336,
    gen(level, r) {
      const w = r.pick(WHICH.slice(0, band(level, [3, 4, 5, 6, 6])));
      // Re-letter the right spec and every distractor consistently.
      const letters = [...new Set(w.right.replace(/[^a-z]/g, "")
        + w.wrongs.map(([s]) => s).join("").replace(/[^a-z]/g, ""))];
      const pool = "abcdefghijklmnopqrstuvwxyz".split("");
      const map = {};
      for (const c of letters) map[c] = level <= 3 ? pool.splice(r.int(0, pool.length - 1), 1)[0] : c;
      const rl = (s) => s.replace(/[a-z]/g, (c) => map[c]);
      return {
        prompt: `Which \`einsum\` computes ${w.what}? (${w.shapes.join("; ")})`,
        answer: rl(w.right), format: "choice", choiceStyle: "code", params: { op: w.what, specs: [rl(w.right), ...w.wrongs.map(([s]) => rl(s))], map },
        steps: [`${rl(w.right)}: every axis missing after the arrow is summed`],
        trick: "Repeated letter across inputs and absent from the output: a contraction.",
        mistakes: w.wrongs.map(([s, why]) => ({ answer: rl(s), why })),
      };
    },
  });

  // ---- by hand ------------------------------------------------------------------------

  def({
    id: "es-eval", name: "Evaluate an einsum by hand",
    blurb: "Loop over every axis; multiply; add up the ones not in the output.",
    source: NUMPY,
    gen(level, r) {
      const n = band(level, [2, 2, 3, 3, 3]);
      const cell = () => r.int(-3, 5);
      const A = Array.from({ length: n }, () => Array.from({ length: n }, cell));
      const v = Array.from({ length: n }, cell);
      const i = r.int(0, n - 1);
      const kind = r.pick(band(level, [["mv"], ["mv", "vm"], ["mv", "vm", "frob"], ["frob", "quad"], ["quad"]]));
      const mat = `\\begin{pmatrix}${A.map((row) => row.join(" & ")).join(" \\\\ ")}\\end{pmatrix}`;
      const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
      const col = (k) => A.map((row) => row[k]);
      if (kind === "mv" || kind === "vm") {
        const spec = kind === "mv" ? "ij,j->i" : "ij,i->j";
        const val = kind === "mv" ? dot(A[i], v) : dot(col(i), v);
        const other = kind === "mv" ? dot(col(i), v) : dot(A[i], v);
        return {
          prompt: `With $A = ${mat}$ and $v = (${v.join(", ")})$, what is entry ${i + 1} of \`einsum("${spec}", A, v)\`?`,
          answer: String(val), params: { kind, A, v, i, spec },
          steps: [kind === "mv" ? `row ${i + 1} of A · v` : `column ${i + 1} of A · v`, `= ${val}`],
          trick: kind === "mv" ? "ij,j->i is A v." : "ij,i->j is Aᵀ v: v pairs with rows.",
          mistakes: wrong(String(val), [
            { answer: String(other), why: kind === "mv" ? "That uses column i: ij,j->i sums over j, along a row." : "That uses row j: ij,i->j sums over i, down a column." },
            { answer: String(A[i][i] * v[i]), why: "The summed axis runs over every term, not just the diagonal one." },
            { answer: String(v.reduce((s, x) => s + x, 0)), why: "Each v entry is multiplied by an entry of A before summing." },
          ]),
        };
      }
      if (kind === "frob") {
        const B = Array.from({ length: n }, () => Array.from({ length: n }, cell));
        const matB = `\\begin{pmatrix}${B.map((row) => row.join(" & ")).join(" \\\\ ")}\\end{pmatrix}`;
        const val = A.reduce((s, row, a) => s + dot(row, B[a]), 0);
        return {
          prompt: `With $A = ${mat}$ and $B = ${matB}$, what is \`einsum("ij,ij->", A, B)\`?`,
          answer: String(val), params: { kind, A, B },
          steps: ["multiply entrywise, then sum everything", `= ${val}`],
          trick: "ij,ij-> is the Frobenius inner product, trace(AᵀB).",
          mistakes: wrong(String(val), [
            { answer: String(A.reduce((s, row, a) => s + row.reduce((t, x, b) => t + x * B[b][a], 0), 0)),
              why: "That pairs A[i][j] with B[j][i] (ij,ji->), trace(AB)." },
            { answer: String(A.reduce((s, row, a) => s + row[a] * B[a][a], 0)), why: "Every entry pairs up, not only the diagonal." },
          ]),
        };
      }
      const x = v;
      const val = dot(x, A.map((row) => dot(row, x)));
      return {
        prompt: `With $A = ${mat}$ and $x = (${x.join(", ")})$, what is \`einsum("i,ij,j->", x, A, x)\`?`,
        answer: String(val), params: { kind: "quad", A, v: x },
        steps: [`Ax = (${A.map((row) => dot(row, x)).join(", ")})`, `x · Ax = ${val}`],
        trick: "i,ij,j-> is the quadratic form xᵀAx.",
        mistakes: wrong(String(val), [
          { answer: String(A.reduce((s, row, a) => s + row[a] * x[a] * x[a], 0)), why: "i and j are separate axes: every A[i][j] contributes, not only the diagonal." },
          { answer: String(dot(x, x)), why: "A sits between the two copies of x." },
        ]),
      };
    },
  });

  // ---- einops rearrange ---------------------------------------------------------------

  def({
    id: "es-rearrange", name: "einops rearrange",
    blurb: "Parentheses group axes into one; the arrow reorders them.",
    source: EINOPS,
    gen(level, r) {
      const kind = r.pick(band(level, [["heads"], ["heads", "merge"], ["heads", "merge", "patch"], ["patch", "heads"], ["patch"]]));
      if (kind === "heads") {
        const b = r.int(2, 8), s = r.pick([16, 32, 128, 512]), h = r.pick([4, 8, 12, 16]), d = r.pick([16, 32, 64]);
        const ans = shape([b, h, s, d]);
        return {
          prompt: `\`x\` has shape ${shape([b, s, h * d])}. What is the shape of `
            + `\`rearrange(x, "b s (h d) -> b h s d", h=${h})\`?`,
          answer: ans, kind: "shape", params: { kind, b, s, h, d },
          steps: [`(h d) = ${h * d} splits into h=${h}, d=${h * d}/${h} = ${d}`, `reorder to b h s d → ${ans}`],
          trick: "This is how multi-head attention splits d_model into heads.",
          mistakes: wrong(ans, [
            { answer: shape([b, s, h, d]), why: "The split happens, but the arrow also moves h in front of s." },
            { answer: shape([b, h, s, h * d]), why: "(h d) is one axis of size h·d; after the split, d is the size per head." },
            { answer: shape([b, h, d, s]), why: "The pattern ends in s d, not d s." },
          ]),
        };
      }
      if (kind === "merge") {
        const b = r.int(2, 16), s = r.pick([8, 16, 64]), d = r.pick([32, 64, 128]);
        const ans = shape([b * s, d]);
        return {
          prompt: `\`x\` has shape ${shape([b, s, d])}. What is the shape of \`rearrange(x, "b s d -> (b s) d")\`?`,
          answer: ans, kind: "shape", params: { kind, b, s, d },
          steps: [`(b s) merges into one axis of ${b}·${s} = ${b * s}`, ans],
          trick: "Flattening batch and sequence is how a model applies one linear layer to every token.",
          mistakes: wrong(ans, [
            { answer: shape([b + s, d]), why: "Merged axes multiply their sizes." },
            { answer: shape([b, s * d]), why: "The parentheses group b and s, not s and d." },
          ]),
        };
      }
      const H = r.pick([32, 64, 224]), p = r.pick([4, 8, 16].filter((q) => H % q === 0)), c = r.pick([1, 3]), b = r.int(1, 8);
      const n = (H / p) ** 2;
      const ans = shape([b, n, p * p * c]);
      return {
        prompt: `Images have shape ${shape([b, c, H, H])}. What is the shape of `
          + `\`rearrange(x, "b c (h p1) (w p2) -> b (h w) (p1 p2 c)", p1=${p}, p2=${p})\`?`,
        answer: ans, kind: "shape", params: { kind: "patch", b, c, H, p },
        steps: [`h = w = ${H}/${p} = ${H / p}`, `(h w) = ${n} patches`, `(p1 p2 c) = ${p}·${p}·${c} = ${p * p * c} values each`],
        trick: "That is ViT patchification: a sequence of flattened patches.",
        mistakes: wrong(ans, [
          { answer: shape([b, H * H, p * p * c]), why: "h and w count patches (H/p each), not pixels." },
          { answer: shape([b, n, p * p]), why: "Each patch keeps all its channels: (p1 p2 c)." },
          { answer: shape([b, c, n, p * p]), why: "c moves inside the patch vector; it is not kept as its own axis." },
        ]),
      };
    },
  });

  // ---- resource accounting -------------------------------------------------------------

  def({
    id: "es-flops", name: "FLOPs of a contraction",
    blurb: "2 × the product of every axis size: one multiply and one add per term.",
    source: CS336,
    gen(level, r) {
      let d;
      do { d = drawOp(Math.max(level, 2), r); } while (d.ins.length !== 2 || d.axes.length === d.out.length);
      const { spec, ins, axes, out, sizes } = d;
      const all = prod(axes.map((a) => sizes[a]));
      const flops = 2 * all;
      const dims = (s) => [...s].map((a) => sizes[a]);
      return {
        prompt: `How many FLOPs does \`einsum("${spec}", X1, X2)\` take, counting a multiply and an add as 2? `
          + `X1 has shape ${shape(dims(ins[0]))} and X2 has shape ${shape(dims(ins[1]))}.`,
        answer: String(flops), params: { spec, sizes },
        steps: [`every combination of ${axes.join(", ")} is one multiply-add`,
                `${axes.map((a) => sizes[a]).join("·")} = ${all.toLocaleString()} terms`, `× 2 = ${flops.toLocaleString()}`],
        trick: "An (m×k)·(k×n) matmul is 2mkn FLOPs: the rule behind every FLOP count in CS336.",
        mistakes: wrong(String(flops), [
          { answer: String(all), why: "Each term is a multiply and an add: count 2 FLOPs per term." },
          { answer: String(2 * prod(dims(out))), why: "That counts only output entries; each one sums over the contracted axes." },
          { answer: String(2 * (prod(dims(ins[0])) + prod(dims(ins[1])))), why: "Input sizes add up memory, not work." },
        ]),
      };
    },
  });

  def({
    id: "es-attn-memory", name: "Memory of the attention matrix",
    blurb: "Scores are batch × heads × seq × seq numbers, times bytes per number.",
    source: CS336,
    gen(level, r) {
      const b = r.pick(band(level, [[1, 2], [4, 8], [8, 16], [16, 32], [32, 64]]));
      const h = r.pick([8, 12, 16, 32]);
      const s = r.pick(band(level, [[512, 1024], [1024, 2048], [2048, 4096], [4096, 8192], [8192, 32768]]));
      const [dtype, bytes] = r.pick([["float32", 4], ["bfloat16", 2]]);
      const gib = (b * h * s * s * bytes) / 2 ** 30;
      return {
        prompt: `Attention scores for batch ${b}, ${h} heads and sequence length ${s.toLocaleString()} are stored in ${dtype}. `
          + `How many GiB do they take? ($1\\text{ GiB} = 2^{30}$ bytes.)`,
        answer: fmt(gib, 3), params: { b, h, s, bytes }, tolerance: 0.01,
        steps: [`${b}·${h}·${s}² = ${(b * h * s * s).toLocaleString()} numbers`,
                `× ${bytes} bytes (${dtype}) = ${(b * h * s * s * bytes).toLocaleString()} bytes`, `÷ 2³⁰ = ${fmt(gib, 3)} GiB`],
        trick: "Quadratic in sequence length: doubling the context quadruples this.",
        mistakes: wrong(fmt(gib, 3), [
          { answer: fmt(gib * (bytes === 4 ? 0.5 : 2), 3), why: `${dtype} is ${bytes} bytes per number.` },
          { answer: fmt(gib / h, 3), why: "Every head has its own score matrix." },
          { answer: fmt(gib / s, 3), why: "Each query scores every key: s², not s." },
        ]),
      };
    },
  });

  def({
    id: "es-train-flops", name: "Training compute: 6ND",
    blurb: "Forward 2ND, backward 4ND: training costs about 6 × params × tokens.",
    source: { ...CS336, section: "Resource accounting (6ND)" },
    gen(level, r) {
      const N = r.pick([124e6, 350e6, 1.3e9, 7e9, 70e9]);
      const D = r.pick([1e9, 2.6e9, 20e9, 300e9, 1e12, 2e12]);
      const flops = 6 * N * D;
      if (level <= 3) {
        const unit = Math.floor(Math.log10(flops));
        const mant = flops / 10 ** unit;
        return {
          prompt: `About how many FLOPs does it take to train a ${N >= 1e9 ? `${N / 1e9}B` : `${N / 1e6}M`}-parameter `
            + `transformer on ${D >= 1e12 ? `${D / 1e12}T` : `${D / 1e9}B`} tokens? Give the number in units of $10^{${unit}}$ FLOPs.`,
          answer: fmt(mant, 2), params: { N, D, unit, ask: "flops" }, tolerance: 0.02,
          steps: [`6 × N × D = 6 × ${N.toExponential(2)} × ${D.toExponential(2)}`, `= ${flops.toExponential(2)} FLOPs`],
          trick: "2ND for the forward pass, twice that for the backward pass.",
          mistakes: wrong(fmt(mant, 2), [
            { answer: fmt((2 * N * D) / 10 ** unit, 2), why: "2ND is only the forward pass; the backward pass costs twice as much again." },
            { answer: fmt((N * D) / 10 ** unit, 2), why: "Each parameter does a multiply and an add per token, forward and back: 6, not 1." },
            { answer: fmt((3 * N * D) / 10 ** unit, 2), why: "Count 2 FLOPs per multiply-add: forward 2ND, backward 4ND." },
          ]),
        };
      }
      const gpus = r.pick([8, 64, 256, 1024]);
      const peak = r.pick([312e12, 989e12]);
      const mfu = r.pick([0.3, 0.4, 0.5]);
      const days = flops / (gpus * peak * mfu) / 86400;
      return {
        prompt: `Training a ${N >= 1e9 ? `${N / 1e9}B` : `${N / 1e6}M`}-parameter model on ${D >= 1e12 ? `${D / 1e12}T` : `${D / 1e9}B`} tokens `
          + `on ${gpus} GPUs, each peaking at ${peak / 1e12} TFLOP/s, at ${mfu * 100}% model FLOPs utilization. How many days does it take?`,
        answer: fmt(days, 2), params: { N, D, gpus, peak, mfu, ask: "days" }, tolerance: 0.02,
        steps: [`6ND = ${flops.toExponential(2)} FLOPs`, `throughput = ${gpus} × ${peak / 1e12}e12 × ${mfu} FLOP/s`,
                `time = ${fmt(days, 2)} days`],
        trick: "MFU is the fraction of peak you actually get; 30–50% is typical.",
        mistakes: wrong(fmt(days, 2), [
          { answer: fmt(days * mfu, 2), why: "That assumes 100% utilization; divide by the MFU." },
          { answer: fmt(days / 3, 2), why: "That counts only the forward pass (2ND)." },
          { answer: fmt(days * gpus, 2), why: "The GPUs work in parallel: divide by their number." },
        ]),
      };
    },
  });
})();
