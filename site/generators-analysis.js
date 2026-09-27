// Real analysis generators for the chapters of Tao (Analysis I) and Pugh (Real
// Mathematical Analysis) that generators-books.js does not reach: sets and
// functions, series, standard limits, continuity, derivatives, the Riemann and
// Riemann–Stieltjes integrals, function spaces, multivariable calculus and
// measure. As there, no text of either book is used: the problems and the
// proofs are ours, tied to the book's section so its course page offers them.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M || !M.proofProblem) return;
  const { band, gcd } = M.util;
  const proof = M.proofProblem, from = M.bookSource;

  const def = (concepts, g) => M.define({
    domain: "real analysis", prose: true, ...g, concepts: concepts.map((c) => `concept:${c}`),
  });
  const fmt = (x, dp = 4) => String(Number(x.toFixed(dp)));
  const wrong = (answer, list) => list.filter((m, i) => m.answer !== undefined && m.answer !== answer
    && !/NaN|Infinity|undefined/.test(String(m.answer)) && list.findIndex((x) => x.answer === m.answer) === i);
  const F = (n, d = 1) => {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { n: n / g, d: d / g };
  };
  const add = (a, b) => F(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => F(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => F(a.n * b.n, a.d * b.d);
  const div = (a, b) => F(a.n * b.d, a.d * b.n);
  const str = (a) => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
  const tex = (a) => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\tfrac{${Math.abs(a.n)}}{${a.d}}`);
  const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
  const poly = (cs, v = "x") => {
    // cs[i] is the coefficient of vⁱ; printed highest power first
    const terms = [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      if (!c) continue;
      const mag = Math.abs(c), sign = c < 0 ? "-" : "+";
      const body = i === 0 ? `${mag}` : `${mag === 1 ? "" : mag}${v}${i > 1 ? `^{${i}}` : ""}`;
      terms.push(terms.length ? ` ${sign} ${body}` : `${c < 0 ? "-" : ""}${body}`);
    }
    return terms.join("") || "0";
  };

  // ==== sets and functions (Tao 3) ==============================================

  def(["tao:3.3", "tao:3.4"], {
    id: "an-image-preimage", name: "Images and inverse images",
    blurb: "f(A) collects outputs; f⁻¹(B) collects every input that lands in B, even for non-invertible f.",
    source: from("tao", "3.4 Images and inverse images"),
    gen(level, r) {
      const n = r.int(2, band(level, [3, 4, 5, 6, 8]));
      const fam = r.pick(band(level, [["sq"], ["sq", "mod"], ["mod", "abs"], ["sq", "abs", "mod"], ["mod", "sq"]]));
      const k = r.int(3, 6);
      const f = { sq: (x) => x * x, abs: (x) => Math.abs(x) + 1, mod: (x) => ((x % k) + k) % k }[fam];
      const ftex = { sq: "x^2", abs: "|x| + 1", mod: `x \\bmod ${k}` }[fam];
      const A = Array.from({ length: 2 * n + 1 }, (_, i) => i - n);
      const ask = r.pick(level <= 1 ? ["image"] : ["image", "pre"]);
      if (ask === "image") {
        const img = new Set(A.map(f));
        return {
          prompt: `Let $f(x) = ${ftex}$ on the integers and $A = \\{-${n}, \\dots, ${n}\\}$. How many elements does $f(A)$ have?`,
          answer: String(img.size), params: { fam, n, k, ask },
          steps: [`f(A) = {${[...img].sort((a, b) => a - b).join(", ")}}`, `${img.size} elements`],
          trick: "Different inputs can share an output, so |f(A)| ≤ |A|.",
          mistakes: wrong(String(img.size), [
            { answer: String(A.length), why: "f isn't injective: x and −x (or x and x + k) give the same output." },
            { answer: String(n + 1), why: fam === "sq" || fam === "abs" ? "" : "Count the distinct outputs directly." },
          ].filter((m) => m.why)),
        };
      }
      const outs = [...new Set(A.map(f))].sort((a, b) => a - b);
      const B = outs.filter(() => r() < 0.5).slice(0, 3);
      if (!B.length) B.push(outs[0]);
      B.push(-1);
      const pre = A.filter((x) => B.includes(f(x)));
      return {
        prompt: `Let $f(x) = ${ftex}$ on $A = \\{-${n}, \\dots, ${n}\\}$, and $B = \\{${B.join(", ")}\\}$. How many elements does $f^{-1}(B)$ have?`,
        answer: String(pre.length), params: { fam, n, k, ask, B },
        steps: [`f⁻¹(B) = {x ∈ A : f(x) ∈ B} = {${pre.join(", ")}}`, `${pre.length} elements`],
        trick: "The inverse image exists for every f; it just may have many (or no) elements per point of B.",
        mistakes: wrong(String(pre.length), [
          { answer: String(B.length), why: "Each point of B can have several preimages, or none (like −1)." },
          { answer: String(B.filter((b) => outs.includes(b)).length), why: "Count inputs, not the outputs that are hit." },
        ]),
      };
    },
  });

  def(["tao:3.5", "tao:3.6", "tao:8.1"], {
    id: "an-count-functions", name: "Counting functions and subsets",
    blurb: "|Bᴬ| = |B|^|A|; injections n!/(n − m)!; the power set has 2ⁿ elements.",
    source: from("tao", "3.6 Cardinality of sets"),
    gen(level, r) {
      const m = r.int(2, band(level, [3, 4, 5, 5, 6])), n = r.int(m, band(level, [4, 5, 6, 7, 8]));
      const fam = r.pick(band(level, [["all", "power"], ["all", "inj"], ["inj", "bij", "prod"], ["inj", "surj2", "prod"], ["surj2", "inj"]]));
      const cases = {
        all: [`How many functions are there from a set with ${m} elements to a set with ${n} elements?`, n ** m, [`each of the ${m} inputs picks one of ${n} outputs: ${n}^${m}`],
          [[m ** n, "Each input chooses an output: |B|^|A|, not |A|^|B|."], [m * n, "Choices multiply across inputs rather than add."]]],
        power: [`How many subsets does a set with ${n} elements have?`, 2 ** n, [`each element is in or out: 2^${n}`],
          [[n * n, "Each element independently is in or out: 2ⁿ."], [2 ** n - 1, "The empty set is a subset too."]]],
        inj: [`How many injective functions are there from a ${m}-element set to an ${n}-element set?`, fact(n) / fact(n - m), [`${n}·${n - 1}·…·${n - m + 1} = ${fact(n) / fact(n - m)}`],
          [[n ** m, "That counts every function; an injection can't reuse an output."], [fact(n) / (fact(m) * fact(n - m)), "Which input goes where matters: don't divide by m!."]]],
        bij: [`How many bijections are there from a ${n}-element set to itself?`, fact(n), [`${n}! = ${fact(n)}`],
          [[n ** n, "A bijection can't repeat an output."], [2 ** n, "That is the number of subsets."]]],
        prod: [`$|A| = ${m}$ and $|B| = ${n}$. How many elements does the power set of $A \\times B$ have?`, 2 ** (m * n), [`|A × B| = ${m * n}`, `2^${m * n} = ${2 ** (m * n)}`],
          [[2 ** m * 2 ** n === 2 ** (m * n) ? -1 : 2 ** m * 2 ** n, "That multiplies the power sets; A × B has m·n elements, so 2^{mn} subsets."], [m * n, "That is |A × B| itself."]]],
        surj2: [`How many functions from a ${n}-element set onto a 2-element set (surjections) are there?`, 2 ** n - 2, [`all functions: 2^${n}`, `minus the 2 constant ones: ${2 ** n - 2}`],
          [[2 ** n, "The two constant functions miss an output."], [2 ** n - 1, "There are two constant functions, one for each output."]]],
      };
      const [q, ans, steps, mist] = cases[fam];
      return {
        prompt: q, answer: String(ans), params: { fam, m, n },
        steps, trick: "Build the object one choice at a time and multiply.",
        mistakes: wrong(String(ans), mist.filter(([a]) => a >= 0).map(([a, why]) => ({ answer: String(a), why }))),
      };
    },
  });

  // ==== sequences and series (Tao 5–7) ===========================================

  def(["tao:5.1", "tao:5.2"], {
    id: "an-cauchy-steady", name: "Cauchy sequences: finding N",
    blurb: "aₙ = c/n is eventually ε-steady: |aⱼ − aₖ| ≤ ε for j, k ≥ N once c/N ≤ ε.",
    source: from("tao", "5.1 Cauchy sequences"),
    gen(level, r) {
      const c = r.int(1, band(level, [2, 5, 10, 20, 50])), k = r.pick(band(level, [[10], [10, 20], [100, 50], [100, 1000], [1000, 250]]));
      // sup_{j,l ≥ N} |c/j − c/l| = c/N (approached as l → ∞, never reached), so ≤ ε ⇔ N ≥ c·k
      const N = c * k;
      return {
        prompt: `Let $a_n = ${c}/n$. What is the smallest N such that $|a_j - a_k| \\le \\tfrac{1}{${k}}$ for all $j, k \\ge N$?`,
        answer: String(N), params: { c, k },
        steps: [`for j, l ≥ N: |c/j − c/l| < c/min(j, l) ≤ c/N, and it gets arbitrarily close to c/N`, `need ${c}/N ≤ 1/${k}`, `N = ${N}`],
        trick: "The worst pair is j = N against a very large l.",
        mistakes: wrong(String(N), [
          { answer: String(Math.ceil(N / 2)), why: "|aⱼ − aₗ| is at most c/N, not c/(2N): take l very large." },
          { answer: String(N + 1), why: "The gap never reaches c/N, it only approaches it, so N = c·k already works." },
          { answer: String(k), why: `The numerator ${c} scales N too.` },
        ]),
      };
    },
  });

  def(["tao:6.1", "tao:6.5", "tao:6.7"], {
    id: "an-standard-limits", name: "Standard limits",
    blurb: "(1 + a/n)ⁿ → eᵃ; ratios of polynomials → ratio of leading terms; √(n² + an) − n → a/2.",
    source: from("tao", "6.5 Some standard limits"),
    gen(level, r) {
      const fam = r.pick(band(level, [["rational"], ["rational", "sqrt"], ["sqrt", "exp"], ["exp", "root"], ["exp", "sqrt", "root"]]));
      if (fam === "rational") {
        const deg = r.int(1, 3), a = r.int(1, 9), c = r.int(1, 9), b = r.int(-9, 9), d = r.int(1, 9);
        const lower = level >= 2 && r() < 0.3;
        const ans = lower ? F(0) : F(a, c);
        return {
          prompt: `Find $\\lim_{n\\to\\infty} \\dfrac{${a}n^{${deg}} ${b < 0 ? "-" : "+"} ${Math.abs(b)}}{${c}n^{${deg + (lower ? 1 : 0)}} + ${d}}$.`,
          answer: str(ans), params: { fam, a, b, c, d, deg, lower },
          steps: lower ? ["the denominator has higher degree", "limit 0"] : [`divide top and bottom by n^${deg}`, `→ ${a}/${c} = ${str(ans)}`],
          trick: "Only the leading terms survive.",
          mistakes: wrong(str(ans), [
            { answer: str(F(b, d)), why: "The constant terms vanish relative to the powers of n." },
            { answer: lower ? str(F(a, c)) : "0", why: lower ? "The degrees differ: the higher power wins, so the limit is 0." : "The degrees match: the limit is the ratio of leading coefficients." },
          ]),
        };
      }
      if (fam === "sqrt") {
        const a = r.int(1, 12) * r.pick([1, -1]);
        const ans = F(a, 2);
        return {
          prompt: `Find $\\lim_{n\\to\\infty} \\left(\\sqrt{n^2 ${a < 0 ? "-" : "+"} ${Math.abs(a)}n} - n\\right)$.`,
          answer: str(ans), params: { fam, a },
          steps: [`multiply by the conjugate: ${a}n/(√(n² + ${a}n) + n)`, `→ ${a}/2`],
          trick: "Conjugates turn ∞ − ∞ into a ratio.",
          mistakes: wrong(str(ans), [
            { answer: "0", why: "√(n² + an) and n both grow, but their difference tends to a/2." },
            { answer: String(a), why: "The denominator √(n² + an) + n is about 2n." },
          ]),
        };
      }
      if (fam === "exp") {
        let a, b;
        // e^{ab} below e^{-3} would round to 0 at four places
        do { a = r.int(1, 4) * r.pick([1, -1]); b = r.int(1, 3); } while (a * b < -3);
        const v = Math.exp(a * b);
        return {
          prompt: `Find $\\lim_{n\\to\\infty} \\left(1 ${a < 0 ? "-" : "+"} \\tfrac{${Math.abs(a)}}{n}\\right)^{${b === 1 ? "" : b}n}$ (to 4 decimal places).`,
          answer: fmt(v), params: { fam, a, b }, tolerance: 0.001,
          steps: [`(1 + a/n)ⁿ → eᵃ`, `raise to the ${b}: e^{${a * b}} = ${fmt(v)}`],
          trick: "1^∞ is not 1: it depends on how fast the base approaches 1.",
          mistakes: wrong(fmt(v), [
            { answer: "1", why: "1 + a/n → 1, but the exponent grows at the same rate: the limit is e^{ab}." },
            { answer: fmt(Math.exp(a)), why: `The exponent is ${b}n, so the limit is e^{${a}·${b}}.` },
          ]),
        };
      }
      const c = r.int(2, 50), k = r.int(1, 4);
      return {
        prompt: `Find $\\lim_{n\\to\\infty} \\left(${c} n^{${k}}\\right)^{1/n}$.`,
        answer: "1", params: { fam, c, k },
        steps: [`c^{1/n} → 1 and (n^{1/n})^k → 1`, `limit 1`],
        trick: "n-th roots flatten every polynomial factor to 1.",
        mistakes: [{ answer: String(c), why: `c^{1/n} → 1: the ${c} disappears under the n-th root.` }, { answer: "0", why: "Numbers ≥ 1 have n-th roots ≥ 1." }],
      };
    },
  });

  def(["tao:6.4", "tao:6.6"], {
    id: "an-limit-points", name: "Limit points of a sequence",
    blurb: "A limit point is the limit of some subsequence.",
    source: from("tao", "6.6 Subsequences"),
    gen(level, r) {
      const k = r.int(2, band(level, [4, 6, 8, 10, 12]));
      const fam = r.pick(band(level, [["mod"], ["mod", "cos"], ["cos", "mod"], ["cos", "sin"], ["sin", "cos"]]));
      let vals;
      if (fam === "mod") vals = new Set(Array.from({ length: k }, (_, i) => i));
      else {
        const trig = fam === "cos" ? Math.cos : Math.sin;
        vals = new Set(Array.from({ length: k }, (_, i) => Math.round(trig((2 * Math.PI * i) / k) * 1e9) / 1e9 + 0));
      }
      const ans = vals.size;
      const expr = { mod: `(n \\bmod ${k}) + \\tfrac{1}{n}`, cos: `\\left(1 + \\tfrac{1}{n}\\right)\\cos\\!\\left(\\tfrac{2\\pi n}{${k}}\\right)`,
        sin: `\\left(1 + \\tfrac{1}{n}\\right)\\sin\\!\\left(\\tfrac{2\\pi n}{${k}}\\right)` }[fam];
      return {
        prompt: `How many limit points does the sequence $a_n = ${expr}$ have?`,
        answer: String(ans), params: { fam, k },
        steps: [`split n by its residue mod ${k}: each residue class is a convergent subsequence`, `the distinct limits: ${ans}`],
        trick: "The 1/n factor only moves points; the residues decide the limits.",
        mistakes: wrong(String(ans), [
          { answer: String(k), why: fam === "mod" ? "" : "Different residues can give the same value (cos is even, sin is odd around π/2)." },
          { answer: "0", why: "The sequence has convergent subsequences: one per residue class." },
          { answer: "2", why: "Count the distinct values over a full period." },
        ].filter((m) => m.why)),
      };
    },
  });

  def(["tao:7.1", "tao:7.2"], {
    id: "an-series-sum", name: "Summing geometric and telescoping series",
    blurb: "Σₙ≥ₖ arⁿ = arᵏ/(1 − r) for |r| < 1; telescoping sums collapse to first minus last.",
    source: from("tao", "7.2 Infinite series"),
    gen(level, r) {
      const fam = r.pick(band(level, [["geo"], ["geo", "tele"], ["tele", "geo"], ["tele2", "geo"], ["tele2", "geo", "tele"]]));
      if (fam === "geo") {
        const rn = r.int(1, 4) * r.pick(level >= 3 ? [1, -1] : [1]), rd = r.int(Math.abs(rn) + 1, 6);
        const a = r.int(1, 6), k = r.int(0, band(level, [0, 1, 2, 3, 3]));
        const rr = F(rn, rd);
        let rk = F(1);
        for (let i = 0; i < k; i++) rk = mul(rk, rr);
        const ans = div(mul(F(a), rk), sub(F(1), rr));
        return {
          prompt: `Find $\\sum_{n=${k}}^{\\infty} ${a === 1 ? "" : a}\\left(${tex(rr)}\\right)^n$.`,
          answer: str(ans), params: { fam, a, rn, rd, k },
          steps: [`first term ${a}·(${str(rr)})^${k} = ${str(mul(F(a), rk))}`, `divide by 1 − r = ${str(sub(F(1), rr))}`, `= ${str(ans)}`],
          trick: "First term over one minus the ratio.",
          mistakes: wrong(str(ans), [
            { answer: str(div(F(a), sub(F(1), rr))), why: k ? `The sum starts at n = ${k}, not 0: the first term is a·r^${k}.` : "" },
            { answer: str(div(mul(F(a), rk), add(F(1), rr))), why: "Divide by 1 − r, not 1 + r." },
            { answer: str(div(mul(F(a), mul(rk, rr)), sub(F(1), rr))), why: `The first term is n = ${k}, not n = ${k + 1}.` },
          ].filter((m) => m.why)),
        };
      }
      const kk = fam === "tele2" ? r.int(2, 3) : 1;
      const N = level >= 4 && r() < 0.5 ? r.int(3, 20) : null;
      // Σ_{n≥1} 1/(n(n+k)) = (1/k)(1 + 1/2 + … + 1/k); partial sums to N drop the tail
      let ans = F(0);
      for (let i = 1; i <= kk; i++) ans = add(ans, F(1, i));
      if (N) for (let i = N + 1; i <= N + kk; i++) ans = sub(ans, F(1, i));
      ans = mul(ans, F(1, kk));
      return {
        prompt: `Find $\\sum_{n=1}^{${N ?? "\\infty"}} \\dfrac{1}{n(n+${kk})}$.`,
        answer: str(ans), params: { fam, k: kk, N },
        steps: [`1/(n(n + ${kk})) = (1/${kk})(1/n − 1/(n + ${kk}))`, `the sum telescopes, leaving the first ${kk} term${kk > 1 ? "s" : ""}${N ? " minus the last" : ""}`, `= ${str(ans)}`],
        trick: "Partial fractions, then watch the terms cancel.",
        mistakes: wrong(str(ans), [
          { answer: kk === 1 ? "1/2" : str(F(1, kk)), why: "Write out the first few terms: more than one term survives the cancellation." },
          { answer: str(mul(ans, F(kk))), why: `Don't drop the factor 1/${kk} from the partial fractions.` },
          ...(N ? [{ answer: str(mul(Array.from({ length: kk }, (_, i) => F(1, i + 1)).reduce(add, F(0)), F(1, kk))), why: "That is the infinite sum; the partial sum to N loses the tail." }] : []),
        ]),
      };
    },
  });

  def(["tao:7.2", "tao:7.3", "tao:7.4", "tao:7.5"], {
    id: "an-series-test", name: "Does the series converge?",
    blurb: "p-series, comparison, ratio and root tests, and the alternating series test.",
    source: from("tao", "7.3 Sums of non-negative numbers"),
    gen(level, r) {
      const S = [
        [(p) => `\\sum \\frac{1}{n^{${p}}}`, () => r.pick([0.5, 1, 1.5, 2, 3]), (p) => (p > 1 ? "abs" : "div"), "p-series: converges iff p > 1."],
        [(p) => `\\sum \\frac{(-1)^n}{n^{${p}}}`, () => r.pick([0.5, 1, 2]), (p) => (p > 1 ? "abs" : "cond"), "Alternating with terms decreasing to 0: converges; absolutely only if p > 1."],
        [(c) => `\\sum \\frac{n^{2}}{${c}^n}`, () => r.pick([2, 3, 1.5]), () => "abs", "Ratio test: the ratio tends to 1/c < 1."],
        [() => `\\sum \\frac{n!}{n^n}`, () => 0, () => "abs", "Ratio test: the ratio tends to 1/e < 1."],
        [() => `\\sum \\frac{1}{n \\ln n}`, () => 0, () => "div", "Cauchy condensation turns it into Σ 1/(k ln 2), a harmonic series."],
        [() => `\\sum \\frac{n}{n^2 + 1}`, () => 0, () => "div", "Compare with Σ 1/(2n)."],
        [() => `\\sum \\frac{(-1)^n n}{n + 1}`, () => 0, () => "div", "The terms don't tend to 0."],
        [(c) => `\\sum \\frac{${c}^n}{n!}`, () => r.int(2, 9), () => "abs", "Ratio c/(n + 1) → 0."],
        [() => `\\sum \\frac{(-1)^n}{\\ln n}`, () => 0, () => "cond", "Alternating, terms decrease to 0; but 1/ln n ≥ 1/n diverges."],
      ];
      const pool = band(level, [[0, 5, 6], [0, 2, 5, 7], [0, 1, 2, 3, 6], [1, 3, 4, 8], [1, 4, 8, 3]]);
      const i = r.pick(pool);
      const [t, par, kind, why] = S[i];
      const p = par();
      const label = { abs: "Converges absolutely", cond: "Converges, but not absolutely", div: "Diverges" };
      const ans = label[kind(p)];
      return {
        prompt: `Starting from n = 2, what does $${t(p)}$ do?`,
        answer: ans, format: "choice", params: { i, p },
        steps: [why], trick: "Terms → 0 is necessary, never sufficient.",
        mistakes: Object.entries(label).filter(([k]) => k !== kind(p)).map(([k, text]) => ({
          answer: text,
          why: { abs: "Check the absolute values: that series fails to converge.", cond: kind(p) === "abs" ? "It converges even with absolute values." : "It doesn't converge at all.",
            div: kind(p) === "abs" ? "The absolute values already converge." : "The alternating series test applies: terms decrease to 0." }[k],
        })),
      };
    },
  });

  // ==== continuity (Tao 9) ========================================================

  def(["tao:9.6", "tao:9.7"], {
    id: "an-extreme-values", name: "Maximum principle",
    blurb: "A continuous function on [a, b] attains its max and min: check endpoints and critical points.",
    source: from("tao", "9.6 The maximum principle"),
    gen(level, r) {
      const k = r.int(1, band(level, [1, 2, 3, 4, 4])) ** 2 * (level >= 3 ? r.pick([1, 3]) : 1);
      // f(x) = x³ − 3kx, critical points ±√k
      const s = Math.sqrt(k);
      const f = (x) => x ** 3 - 3 * k * x;
      const a = -Math.ceil(s) - r.int(0, 2), b = Math.ceil(s) + r.int(-1, 2);
      const ask = r.pick(["max", "min"]);
      const cands = [a, b, ...[-s, s].filter((x) => x > a && x < b)];
      const vals = cands.map(f);
      const ans = ask === "max" ? Math.max(...vals) : Math.min(...vals);
      const endOnly = ask === "max" ? Math.max(f(a), f(b)) : Math.min(f(a), f(b));
      return {
        prompt: `Find the ${ask}imum of $f(x) = x^3 - ${3 * k}x$ on $[${a}, ${b}]$.`,
        answer: fmt(ans), params: { k, a, b, ask },
        steps: [`f′(x) = 3x² − ${3 * k} = 0 at x = ±${Number.isInteger(s) ? s : `√${k}`}`, `compare f at ${cands.map((x) => fmt(x, 3)).join(", ")}: ${vals.map((v) => fmt(v)).join(", ")}`, `${ask} = ${fmt(ans)}`],
        trick: "Endpoints and critical points are the only candidates.",
        mistakes: wrong(fmt(ans), [
          { answer: fmt(endOnly), why: "Check the critical points inside the interval too." },
          { answer: fmt(ask === "max" ? f(-s) : f(s)), why: "The local extremum isn't always the global one: compare with the endpoints." },
          { answer: fmt(ask === "max" ? -s : s), why: "That is where f′ = 0; the question asks for the value f takes there (or at an endpoint)." },
        ]),
      };
    },
  });

  def(["tao:9.7", "tao:9.4"], {
    id: "an-ivt", name: "Intermediate value theorem",
    blurb: "f continuous with f(a) < y < f(b): some c in (a, b) has f(c) = y. Bisection finds it.",
    source: from("tao", "9.7 The intermediate value theorem"),
    gen(level, r) {
      if (level <= 2) {
        const fa = r.int(-9, 0), fb = r.int(1, 9), extra = r.int(fb + 1, fb + 9);
        const y = r.int(fa + 1, fb - 1) + 0.5;
        return {
          prompt: `$f$ is continuous on [0, 1] with $f(0) = ${fa}$ and $f(1) = ${fb}$. Which value must $f$ take somewhere in (0, 1)?`,
          answer: String(y), format: "choice", params: { fa, fb, y },
          steps: [`${fa} < ${y} < ${fb}`, `by the IVT some c has f(c) = ${y}`],
          trick: "The IVT guarantees only values between f(a) and f(b).",
          mistakes: [
            { answer: String(extra), why: `${extra} lies outside [${fa}, ${fb}]; f might never reach it.` },
            { answer: String(fa - 1), why: "Values below f(0) and f(1) aren't guaranteed." },
            { answer: String(fb + 0.5), why: "Just beyond f(1): not guaranteed by the IVT." },
          ],
        };
      }
      const w = r.pick([1, 2, 4]), eps = r.pick([0.1, 0.01, 0.001, 1e-4]);
      const n = Math.ceil(Math.log2(w / eps) - 1e-12);
      return {
        prompt: `Bisection starts on an interval of length ${w} where f changes sign, halving it each step. How many steps guarantee an interval of length at most ${eps}?`,
        answer: String(n), params: { w, eps },
        steps: [`after n steps the length is ${w}/2ⁿ`, `need 2ⁿ ≥ ${w}/${eps}`, `n = ${n}`],
        trick: "Each step buys one binary digit: about 3.3 steps per decimal digit.",
        mistakes: wrong(String(n), [
          { answer: String(Math.ceil(w / eps)), why: "The length halves each step: it's logarithmic, not linear." },
          { answer: String(n + 1), why: `${n} steps already give ${w}/2^${n} ≤ ${eps}.` },
        ]),
      };
    },
  });

  // ==== derivatives (Tao 10) =======================================================

  def(["tao:10.1"], {
    id: "an-difference-quotient", name: "Derivative from the definition",
    blurb: "f′(x₀) = lim (f(x₀ + h) − f(x₀))/h; for xⁿ the quotient expands binomially.",
    source: from("tao", "10.1 Basic definitions"),
    gen(level, r) {
      const n = r.int(2, band(level, [2, 3, 3, 4, 5])), x0 = r.int(-3, 3) || 1;
      const ask = level >= 3 && r() < 0.5 ? "quot" : "limit";
      if (ask === "quot") {
        const h = r.pick([1, 0.5, 0.1, 2]);
        const q = ((x0 + h) ** n - x0 ** n) / h;
        return {
          prompt: `For $f(x) = x^{${n}}$, compute the difference quotient $\\frac{f(${x0} + h) - f(${x0})}{h}$ at $h = ${h}$.`,
          answer: fmt(q), params: { n, x0, h, ask },
          steps: [`f(${x0 + h}) = ${fmt((x0 + h) ** n)}, f(${x0}) = ${x0 ** n}`, `(${fmt((x0 + h) ** n)} − ${x0 ** n})/${h} = ${fmt(q)}`],
          trick: "As h shrinks, this approaches f′(x₀).",
          mistakes: wrong(fmt(q), [
            { answer: String(n * x0 ** (n - 1)), why: "That is the limit h → 0; at this h the quotient differs." },
            { answer: fmt((x0 + h) ** n - x0 ** n), why: "Divide by h." },
          ]),
        };
      }
      const d = n * x0 ** (n - 1);
      return {
        prompt: `Using the definition, find $\\lim_{h\\to 0} \\frac{(${x0} + h)^{${n}} - (${x0})^{${n}}}{h}$.`,
        answer: String(d), params: { n, x0, ask },
        steps: [`expand: (x₀ + h)ⁿ = x₀ⁿ + n x₀ⁿ⁻¹ h + O(h²)`, `quotient → n x₀ⁿ⁻¹ = ${d}`],
        trick: "This limit is f′(x₀) for f(x) = xⁿ.",
        mistakes: wrong(String(d), [
          { answer: String(x0 ** n), why: "That is f(x₀), not the derivative." },
          { answer: String(n * x0 ** n), why: "The power drops by one: n·x₀ⁿ⁻¹." },
          { answer: "0", why: "Numerator and denominator both → 0; the ratio tends to f′(x₀)." },
        ]),
      };
    },
  });

  def(["tao:10.5"], {
    id: "an-lhopital", name: "L'Hôpital's rule",
    blurb: "0/0: differentiate top and bottom, as many times as it takes.",
    source: from("tao", "10.5 L'Hôpital's rule"),
    gen(level, r) {
      const a = r.int(1, 6), b = r.int(1, 6);
      const fam = r.pick(band(level, [["sin", "exp"], ["sin", "exp", "log"], ["cos", "log", "pow"], ["cos", "pow", "sin"], ["cos", "pow", "log"]]));
      const cases = {
        sin: [`\\frac{\\sin(${a}x)}{\\sin(${b}x)}`, "0", F(a, b), [`derivatives: ${a}cos(${a}x)/(${b}cos(${b}x))`, `at 0: ${a}/${b}`], [[F(1), "The coefficients survive: a/b, not 1."], [F(b, a), "Top over bottom: a/b."]]],
        exp: [`\\frac{e^{${a}x} - 1}{${b}x}`, "0", F(a, b), [`derivatives: ${a}e^{${a}x}/${b}`, `at 0: ${a}/${b}`], [[F(1, b), "Differentiate e^{ax}: the chain rule gives a factor a."], [F(a), "The denominator's derivative is b."]]],
        log: [`\\frac{\\ln(1 + ${a}x)}{${b}x}`, "0", F(a, b), [`derivatives: (${a}/(1 + ${a}x))/${b}`, `at 0: ${a}/${b}`], [[F(1, b), "d/dx ln(1 + ax) = a/(1 + ax): keep the a."], [F(0), "It's 0/0: apply the rule rather than plugging in."]]],
        cos: [`\\frac{1 - \\cos(${a}x)}{x^2}`, "0", F(a * a, 2), [`once: ${a}sin(${a}x)/(2x), still 0/0`, `twice: ${a * a}cos(${a}x)/2 → ${a * a}/2`], [[F(a, 2), "The second derivative of cos(ax) brings out a², not a."], [F(0), "After one application it's still 0/0: apply again."]]],
        pow: [`\\frac{x^{${a + 1}} - ${b}^{${a + 1}}}{x - ${b}}`, String(b), F((a + 1) * b ** a), [`derivatives: ${a + 1}x^${a}/1`, `at x = ${b}: ${(a + 1) * b ** a}`], [[F(b ** (a + 1)), "Differentiate the numerator: (a + 1)x^a."], [F(a * b ** (a - 1)), "The exponent in the numerator is a + 1."]]],
      };
      const [expr, at, ans, steps, mist] = cases[fam];
      return {
        prompt: `Find $\\lim_{x\\to ${at}} ${expr}$.`,
        answer: str(ans), params: { fam, a, b },
        steps, trick: "Check it's really 0/0 (or ∞/∞) before each application.",
        mistakes: wrong(str(ans), mist.map(([v, why]) => ({ answer: str(v), why }))),
      };
    },
  });

  def(["tao:10.4", "tao:10.3"], {
    id: "an-inverse-derivative", name: "Derivative of an inverse function",
    blurb: "(f⁻¹)′(y₀) = 1/f′(x₀) where f(x₀) = y₀.",
    source: from("tao", "10.4 Inverse functions and derivatives"),
    gen(level, r) {
      const a = r.int(1, band(level, [3, 5, 6, 8, 9])), b = r.pick([-5, -3, -2, -1, 1, 2, 4]), x0 = r.int(-2, 3);
      const deg = level >= 3 ? 5 : 3;
      const y0 = x0 ** deg + a * x0 + b;
      const d = deg * x0 ** (deg - 1) + a;
      const ans = F(1, d);
      return {
        prompt: `$f(x) = x^{${deg}} + ${a}x ${b < 0 ? "-" : "+"} ${Math.abs(b)}$ is strictly increasing, so it has an inverse. Find $(f^{-1})'(${y0})$.`,
        answer: str(ans), params: { deg, a, b, x0 },
        steps: [`f(${x0}) = ${y0}, so f⁻¹(${y0}) = ${x0}`, `f′(${x0}) = ${d}`, `(f⁻¹)′(${y0}) = 1/${d}`],
        trick: "Find the x that maps to y₀ first; differentiate there.",
        mistakes: wrong(str(ans), [
          { answer: str(F(1, deg * y0 ** (deg - 1) + a)), why: `Evaluate f′ at x₀ = f⁻¹(${y0}) = ${x0}, not at ${y0}.` },
          { answer: String(d), why: "The inverse's slope is the reciprocal." },
        ]),
      };
    },
  });

  def(["tao:10.2", "tao:10.3"], {
    id: "an-mean-value", name: "Mean value theorem",
    blurb: "Some c in (a, b) has f′(c) = (f(b) − f(a))/(b − a).",
    source: from("tao", "10.2 Local maxima, local minima, and derivatives"),
    gen(level, r) {
      const fam = r.pick(band(level, [["quad"], ["quad"], ["quad", "cube"], ["cube"], ["cube", "quad"]]));
      if (fam === "quad") {
        const p = r.int(1, 5), q = r.int(-5, 5), a = r.int(-4, 2), b = a + r.int(1, 6);
        const c = F(a + b, 2);
        return {
          prompt: `For $f(x) = ${poly([0, q, p])}$ on $[${a}, ${b}]$, find the c in the mean value theorem.`,
          answer: str(c), params: { fam, p, q, a, b },
          steps: [`slope of the chord: ${p}(${a} + ${b}) + ${q} = ${p * (a + b) + q}`, `f′(c) = ${2 * p}c + ${q} = ${p * (a + b) + q}`, `c = ${str(c)}`],
          trick: "For a parabola the MVT point is always the midpoint.",
          mistakes: wrong(str(c), [
            { answer: str(F(p * (a + b) + q)), why: "That is the chord's slope, f′(c); solve for c." },
            { answer: String(b), why: "c lies strictly inside (a, b)." },
          ]),
        };
      }
      const bb = r.int(1, 6);
      const c = bb / Math.sqrt(3);
      return {
        prompt: `For $f(x) = x^3$ on $[0, ${bb}]$, find the c in the mean value theorem (to 4 decimal places).`,
        answer: fmt(c), params: { fam, b: bb }, tolerance: 0.001,
        steps: [`chord slope ${bb ** 3}/${bb} = ${bb * bb}`, `3c² = ${bb * bb}`, `c = ${bb}/√3 = ${fmt(c)}`],
        trick: "Set f′(c) equal to the chord's slope and solve.",
        mistakes: wrong(fmt(c), [
          { answer: fmt(bb / 2), why: "The midpoint works for parabolas only." },
          { answer: fmt(bb / 3), why: "3c² = b² gives c = b/√3, not b/3." },
        ]),
      };
    },
  });

  // ==== integration (Tao 11) =========================================================

  def(["tao:11.2", "tao:11.1"], {
    id: "an-piecewise-constant", name: "Integrals of piecewise constant functions",
    blurb: "p.c.∫ f = Σ (value on each interval) × (its length); single points don't count.",
    source: from("tao", "11.2 Piecewise constant functions"),
    gen(level, r) {
      const k = r.int(2, band(level, [2, 3, 4, 5, 6]));
      const pts = [0];
      for (let i = 0; i < k; i++) pts.push(pts[i] + r.int(1, 4));
      const vals = Array.from({ length: k }, () => r.int(-5, 8));
      const spike = level >= 3 ? { at: pts[r.int(1, k - 1)], v: r.int(20, 99) } : null;
      const ans = vals.reduce((s, v, i) => s + v * (pts[i + 1] - pts[i]), 0);
      const pieces = vals.map((v, i) => `${v} \\text{ on } (${pts[i]}, ${pts[i + 1]})`).join(",\\ ");
      return {
        prompt: `$f$ equals $${pieces}$${spike ? `, and $f(${spike.at}) = ${spike.v}$` : ""}. What is $\\int_{${pts[0]}}^{${pts[k]}} f$?`,
        answer: String(ans), params: { pts, vals },
        steps: [vals.map((v, i) => `${v}·${pts[i + 1] - pts[i]}`).join(" + ") + ` = ${ans}`, ...(spike ? ["a single point has length 0"] : [])],
        trick: "Value times length, summed.",
        mistakes: wrong(String(ans), [
          { answer: String(vals.reduce((s, v) => s + v, 0)), why: "Weight each value by the length of its interval." },
          ...(spike ? [{ answer: String(ans + spike.v), why: "The value at one point doesn't change the integral." }] : []),
        ]),
      };
    },
  });

  def(["tao:11.9", "tao:11.10"], {
    id: "an-ftc", name: "Fundamental theorems of calculus",
    blurb: "∫ₐᵇ f = F(b) − F(a); d/dx ∫ₐ^{g(x)} f = f(g(x))·g′(x).",
    source: from("tao", "11.9 The two fundamental theorems of calculus"),
    gen(level, r) {
      const fam = r.pick(band(level, [["eval"], ["eval", "deriv"], ["deriv", "eval"], ["chain", "eval"], ["chain", "deriv"]]));
      const cs = Array.from({ length: r.int(2, 3) }, () => r.int(-4, 5));
      if (fam === "eval") {
        const a = r.int(-2, 1), b = a + r.int(1, 3);
        let ans = F(0);
        cs.forEach((c, i) => { ans = add(ans, F(c * (b ** (i + 1) - a ** (i + 1)), i + 1)); });
        return {
          prompt: `Evaluate $\\int_{${a}}^{${b}} \\left(${poly(cs)}\\right) dx$.`,
          answer: str(ans), params: { fam, cs, a, b },
          steps: [`antiderivative: ${cs.map((c, i) => (c ? `${c}x^${i + 1}/${i + 1}` : "")).filter(Boolean).join(" + ")}`, `F(${b}) − F(${a}) = ${str(ans)}`],
          trick: "Antidifferentiate, then subtract.",
          mistakes: wrong(str(ans), [
            { answer: str(F(cs.reduce((s, c, i) => s + c * (b ** i - a ** i), 0))), why: "That subtracts the integrand's values; subtract the antiderivative's." },
            { answer: str(F(cs.reduce((s, c, i) => s + c * (b ** (i + 1) - a ** (i + 1)), 0))), why: "Divide each term by its new power." },
          ]),
        };
      }
      const x0 = r.int(-2, 3);
      const f = (t) => cs.reduce((s, c, i) => s + c * t ** i, 0);
      if (fam === "deriv") {
        return {
          prompt: `Let $G(x) = \\int_{0}^{x} \\left(${poly(cs, "t")}\\right) dt$. What is $G'(${x0})$?`,
          answer: String(f(x0)), params: { fam, cs, x0 },
          steps: [`G′(x) = f(x) by the second fundamental theorem`, `f(${x0}) = ${f(x0)}`],
          trick: "Differentiating the integral gives back the integrand.",
          mistakes: wrong(String(f(x0)), [
            { answer: String(cs.reduce((s, c, i) => s + i * c * x0 ** Math.max(0, i - 1), 0)), why: "That is f′(x₀); G′ = f, not f′." },
            { answer: String(f(x0) - f(0)), why: "G′(x) = f(x): nothing is subtracted." },
          ]),
        };
      }
      const k = r.int(2, 3);
      const ans = f(x0 ** k) * k * x0 ** (k - 1);
      return {
        prompt: `Let $G(x) = \\int_{0}^{x^{${k}}} \\left(${poly(cs, "t")}\\right) dt$. What is $G'(${x0})$?`,
        answer: String(ans), params: { fam, cs, x0, k },
        steps: [`G′(x) = f(x^${k})·${k}x^${k - 1}`, `= ${f(x0 ** k)}·${k * x0 ** (k - 1)} = ${ans}`],
        trick: "Chain rule on the upper limit.",
        mistakes: wrong(String(ans), [
          { answer: String(f(x0 ** k)), why: `Multiply by the derivative of the upper limit, ${k}x^${k - 1}.` },
          { answer: String(f(x0) * k * x0 ** (k - 1)), why: `Evaluate f at the upper limit x^${k}, not at x.` },
        ]),
      };
    },
  });

  def(["tao:11.8"], {
    id: "an-stieltjes", name: "Riemann–Stieltjes integrals",
    blurb: "∫ f dα: for smooth α it is ∫ f α′; each jump of α contributes f × jump.",
    source: from("tao", "11.8 The Riemann-Stieltjes integral"),
    gen(level, r) {
      if (level <= 2 || r() < 0.5) {
        const m = r.int(0, 3), k = r.int(1, 3), b = r.int(1, 3);
        // ∫₀ᵇ x^m d(x^k) = ∫ k x^{m+k−1} = k b^{m+k}/(m+k)
        const ans = F(k * b ** (m + k), m + k);
        return {
          prompt: `Compute $\\int_0^{${b}} x^{${m}}\\, d\\alpha(x)$ where $\\alpha(x) = x^{${k}}$.`,
          answer: str(ans), params: { fam: "smooth", m, k, b },
          steps: [`dα = ${k}x^${k - 1} dx`, `∫₀^${b} ${k}x^${m + k - 1} dx = ${str(ans)}`],
          trick: "A differentiable α turns dα into α′(x) dx.",
          mistakes: wrong(str(ans), [
            { answer: str(F(b ** (m + 1), m + 1)), why: "That is the ordinary integral ∫ f dx; weight by α′." },
            { answer: str(F(b ** (m + k), m + k)), why: `Don't forget the factor ${k} from α′(x) = ${k}x^${k - 1}.` },
          ]),
        };
      }
      const jumps = Array.from({ length: r.int(2, 3) }, (_, i) => ({ at: i + 1, h: r.int(1, 5) }));
      const cs = [r.int(-3, 3), r.int(1, 4)];
      const f = (x) => cs[0] + cs[1] * x;
      const ans = jumps.reduce((s, j) => s + f(j.at) * j.h, 0);
      return {
        prompt: `α is a step function on [0, 4] that jumps by ${jumps.map((j) => `${j.h} at x = ${j.at}`).join(", ")} and is constant otherwise. Compute $\\int_0^4 (${poly(cs)})\\, d\\alpha$.`,
        answer: String(ans), params: { fam: "step", jumps, cs },
        steps: [jumps.map((j) => `${f(j.at)}·${j.h}`).join(" + ") + ` = ${ans}`],
        trick: "Only the jumps contribute: f at the jump times the jump.",
        mistakes: wrong(String(ans), [
          { answer: String(cs[0] * 4 + cs[1] * 8), why: "That is ∫ f dx; with a step α only the jump points matter." },
          { answer: String(jumps.reduce((s, j) => s + j.h, 0)), why: "Weight each jump by f's value there." },
        ]),
      };
    },
  });

  // ==== Pugh: function spaces, multivariable calculus, Lebesgue theory ==============

  def(["pugh:ch4"], {
    id: "an-uniform-convergence", name: "Uniform convergence",
    blurb: "fₙ → f uniformly iff sup |fₙ − f| → 0.",
    source: from("pugh", "4 Function Spaces"),
    gen(level, r) {
      const fam = r.pick(band(level, [["pow"], ["pow", "bump"], ["bump", "pow"], ["bump", "which"], ["which", "pow"]]));
      if (fam === "pow") {
        const a = r.pick([0.5, 0.9, 0.8, 0.99]), eps = r.pick([0.1, 0.01, 0.001]);
        const n = Math.ceil(Math.log(eps) / Math.log(a) - 1e-12);
        return {
          prompt: `$f_n(x) = x^n$ converges uniformly to 0 on $[0, ${a}]$. What is the smallest n with $\\sup_{[0, ${a}]} |f_n| \\le ${eps}$?`,
          answer: String(n), params: { fam, a, eps },
          steps: [`sup is at x = ${a}: ${a}ⁿ`, `${a}ⁿ ≤ ${eps} ⇔ n ≥ ln ${eps}/ln ${a} = ${fmt(Math.log(eps) / Math.log(a), 3)}`, `n = ${n}`],
          trick: "On [0, a] with a < 1 the worst point is x = a; on [0, 1) convergence is not uniform.",
          mistakes: wrong(String(n), [
            { answer: String(Math.ceil(1 / eps)), why: "The sup is aⁿ, which decays geometrically: take logs." },
            { answer: String(Math.ceil(Math.log(eps) / Math.log(a) - 1e-12) + 1), why: `n = ${n} already gives ${a}^${n} ≤ ${eps}.` },
          ]),
        };
      }
      if (fam === "bump") {
        const n = r.pick([4, 9, 16, 25, 100]);
        const s = 1 / (2 * Math.sqrt(n));
        return {
          prompt: `$f_n(x) = \\dfrac{x}{1 + n x^2}$ on ℝ. What is $\\sup_x |f_n(x)|$ for n = ${n}?`,
          answer: fmt(s), params: { fam, n },
          steps: [`f′ = 0 at x = 1/√n`, `f(1/√n) = (1/√n)/2 = ${fmt(s)}`],
          trick: "sup → 0 like 1/(2√n): so fₙ → 0 uniformly.",
          mistakes: wrong(fmt(s), [
            { answer: fmt(1 / n), why: "The maximum is at x = 1/√n, where f = 1/(2√n)." },
            { answer: fmt(1 / Math.sqrt(n)), why: "At x = 1/√n the denominator is 1 + 1 = 2." },
          ]),
        };
      }
      const S = [
        ["$x^n$ on $[0, 1)$", "Not uniformly", "sup over [0, 1) of xⁿ is 1 for every n."],
        ["$x^n$ on $[0, \\tfrac{1}{2}]$", "Uniformly", "sup = (1/2)ⁿ → 0."],
        ["$\\frac{\\sin(nx)}{n}$ on ℝ", "Uniformly", "|sin(nx)/n| ≤ 1/n → 0 everywhere at once."],
        ["$n x e^{-nx}$ on $[0, \\infty)$", "Not uniformly", "The maximum, at x = 1/n, is 1/e for every n."],
        ["$\\frac{nx}{1 + n^2x^2}$ on $[0, 1]$", "Not uniformly", "At x = 1/n it equals 1/2 for every n."],
        ["$\\frac{x}{n}$ on $[0, 1]$", "Uniformly", "sup = 1/n → 0."],
      ];
      const [f, ans, why] = r.pick(S);
      return {
        prompt: `Each of these converges pointwise to 0. Does ${f} converge to 0 uniformly?`,
        answer: ans, format: "choice", params: { fam, f },
        steps: [why], trick: "Find where |fₙ| is largest; uniform means that maximum → 0.",
        mistakes: [{ answer: ans === "Uniformly" ? "Not uniformly" : "Uniformly", why: ans === "Uniformly" ? "The sup bound tends to 0 independently of x." : "The bump just moves; its height doesn't shrink." }],
      };
    },
  });

  def(["pugh:ch5"], {
    id: "an-jacobian", name: "Derivatives of maps ℝ² → ℝ²",
    blurb: "The Jacobian matrix collects partial derivatives; its determinant scales area.",
    source: from("pugh", "5 Multivariable Calculus"),
    gen(level, r) {
      const fam = r.pick(band(level, [["grad"], ["grad", "square"], ["square", "polar"], ["polar", "custom"], ["custom", "square"]]));
      const x = r.int(-3, 3), y = r.int(-3, 3) || 1;
      if (fam === "grad") {
        const a = r.int(1, 4), b = r.int(-3, 3), c = r.int(1, 3);
        const u = [[3, 4], [1, 0], [0, 1], [-4, 3]][r.int(0, 3)];
        const gx = 2 * a * x + b * y, gy = b * x + 2 * c * y;
        const len = Math.hypot(u[0], u[1]);
        const d = F(gx * u[0] + gy * u[1], len);
        return {
          prompt: `$f(x, y) = ${a}x^2 ${b < 0 ? "-" : "+"} ${Math.abs(b)}xy + ${c}y^2$. What is the directional derivative of f at (${x}, ${y}) in the direction of (${u.join(", ")})?`,
          answer: str(d), params: { fam, a, b, c, x, y, u },
          steps: [`∇f = (${2 * a}x + ${b}y, ${b}x + ${2 * c}y) = (${gx}, ${gy})`, `unit vector (${u.map((t) => `${t}/${len}`).join(", ")})`, `dot product = ${str(d)}`],
          trick: "Normalise the direction before dotting with the gradient.",
          mistakes: wrong(str(d), [
            { answer: String(gx * u[0] + gy * u[1]), why: `Normalise the direction: divide by its length ${len}.` },
            { answer: fmt(Math.hypot(gx, gy)), why: "|∇f| is the largest directional derivative, not the one in this direction." },
          ]),
        };
      }
      if (fam === "square") {
        const J = 4 * (x * x + y * y);
        return {
          prompt: `$F(x, y) = (x^2 - y^2,\\ 2xy)$ (the map z ↦ z²). What is the Jacobian determinant of F at (${x}, ${y})?`,
          answer: String(J), params: { fam, x, y },
          steps: [`DF = [[2x, −2y], [2y, 2x]]`, `det = 4x² + 4y² = ${J}`],
          trick: "Holomorphic maps have Jacobian |f′(z)|² = |2z|².",
          mistakes: wrong(String(J), [
            { answer: String(4 * (x * x - y * y)), why: "det [[2x, −2y], [2y, 2x]] = 4x² − (−2y)(2y) = 4x² + 4y²." },
            { answer: String(2 * (x * x + y * y)), why: "Each entry has a factor 2: det picks up 2·2 = 4." },
          ]),
        };
      }
      if (fam === "polar") {
        const rr = r.int(1, 6);
        return {
          prompt: `Polar coordinates: $F(r, \\theta) = (r\\cos\\theta,\\ r\\sin\\theta)$. What is its Jacobian determinant at r = ${rr}?`,
          answer: String(rr), params: { fam, r: rr },
          steps: [`DF = [[cos θ, −r sin θ], [sin θ, r cos θ]]`, `det = r(cos²θ + sin²θ) = ${rr}`],
          trick: "That is why dA = r dr dθ.",
          mistakes: [{ answer: "1", why: "The θ-column has a factor r." }, { answer: String(rr * rr), why: "Only one column carries the factor r." }],
        };
      }
      const a = r.int(1, 3), b = r.int(1, 3);
      // F = (x^a y, x + y^b)
      const J = [[a * x ** (a - 1) * y, x ** a], [1, b * y ** (b - 1)]];
      const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      return {
        prompt: `$F(x, y) = (x^{${a}} y,\\ x + y^{${b}})$. What is the Jacobian determinant of F at (${x}, ${y})?`,
        answer: String(det), params: { fam: "custom", a, b, x, y },
        steps: [`DF = [[${a}x^${a - 1}y, x^${a}], [1, ${b}y^${b - 1}]] = [[${J[0][0]}, ${J[0][1]}], [${J[1][0]}, ${J[1][1]}]]`, `det = ${det}`],
        trick: "Row i holds the partials of the i-th component.",
        mistakes: wrong(String(det), [
          { answer: String(J[0][0] * J[1][1] + J[0][1] * J[1][0]), why: "The determinant subtracts the off-diagonal product." },
          { answer: String(J[0][0] + J[1][1]), why: "That is the trace." },
        ]),
      };
    },
  });

  def(["pugh:ch6", "pugh:ch1"], {
    id: "an-measure", name: "Lebesgue measure of simple sets",
    blurb: "Countable sets have measure zero; Cantor-type sets can be uncountable yet small.",
    source: from("pugh", "6 Lebesgue Theory"),
    gen(level, r) {
      const fam = r.pick(band(level, [["cantor"], ["cantor", "choice"], ["fat", "cantor"], ["fat", "choice"], ["fat", "cantor"]]));
      if (fam === "cantor") {
        const n = r.int(1, band(level, [3, 4, 6, 8, 10]));
        const ans = F(2 ** n, 3 ** n);
        return {
          prompt: `Start with [0, 1] and, ${n} time${n > 1 ? "s" : ""}, remove the open middle third of every remaining interval. What is the total length left?`,
          answer: str(ans), params: { fam, n },
          steps: [`each stage keeps 2/3 of the length`, `(2/3)^${n} = ${str(ans)}`],
          trick: "The length tends to 0, yet the Cantor set is uncountable.",
          mistakes: wrong(str(ans), [
            { answer: str(F(1, 3 ** n)), why: `There are 2^${n} pieces of length 1/3^${n}.` },
            { answer: str(F(Math.max(0, 3 - n), 3)), why: "Later stages remove thirds of smaller intervals: the kept length multiplies by 2/3." },
          ]),
        };
      }
      if (fam === "fat") {
        const q = r.pick([4, 5, 8]);
        const n = r.int(1, 4);
        // stage k removes 2^{k-1} intervals of length q^{-k}: total removed Σ 2^{k−1}/q^k
        let rem = F(0);
        for (let k = 1; k <= n; k++) rem = add(rem, F(2 ** (k - 1), q ** k));
        const ans = sub(F(1), rem);
        return {
          prompt: `From [0, 1], at stage k = 1, …, ${n} remove an open interval of length $1/${q}^k$ from the middle of each of the $2^{k-1}$ remaining intervals. What length is left?`,
          answer: str(ans), params: { fam, q, n },
          steps: [`removed Σ_{k≤${n}} 2^{k−1}/${q}^k = ${str(rem)}`, `left 1 − ${str(rem)} = ${str(ans)}`],
          trick: "Shrinking the holes fast enough leaves positive measure: a “fat” Cantor set.",
          mistakes: wrong(str(ans), [
            { answer: str(sub(F(1), Array.from({ length: n }, (_, k) => F(1, q ** (k + 1))).reduce(add, F(0)))), why: "Stage k removes 2^{k−1} intervals, not one." },
            { answer: str(F(2 ** n, 3 ** n)), why: "That is the middle-thirds Cantor set; these holes are smaller." },
          ]),
        };
      }
      const S = [
        ["ℚ ∩ [0, 1]", "0", "It is countable: cover the k-th rational by an interval of length ε/2ᵏ."],
        ["[0, 1] with every rational removed", "1", "Removing a measure-zero set changes nothing."],
        ["The middle-thirds Cantor set", "0", "It sits inside 2ⁿ intervals of total length (2/3)ⁿ for every n."],
        ["$\\{1/n : n \\ge 1\\} \\cup [2, 5]$", "3", "The sequence is countable; [2, 5] has length 3."],
        ["The set of algebraic numbers in [0, 1]", "0", "There are countably many polynomials with integer coefficients, each with finitely many roots."],
      ];
      const [set, ans, why] = r.pick(S);
      return {
        prompt: `What is the Lebesgue measure of ${set}?`,
        answer: ans, format: "choice", params: { fam, set },
        steps: [why], trick: "Countable ⇒ measure 0. The converse fails (Cantor).",
        mistakes: [["0", "The set contains an interval of positive length."], ["1", "Countable pieces contribute nothing."], ["3", "Measure the intervals, ignore countable pieces."], ["Undefined", "Every set here is Borel, so measurable."]]
          .filter(([a]) => a !== ans).slice(0, 3).map(([a, w]) => ({ answer: a, why: w })),
      };
    },
  });

  // ==== proofs ======================================================================

  def(["tao:6.1"], {
    id: "an-proof-sum-limits", name: "Proof: the limit of a sum",
    blurb: "Split ε in half: N = max(N₁, N₂).",
    source: from("tao", "6.1 Convergence and limit laws"),
    gen(level, r) {
      const [a, b] = r.pick([["a_n", "b_n"], ["x_n", "y_n"], ["s_n", "t_n"]]);
      return proof(level, r, {
        statement: `Suppose $${a} \\to L$ and $${b} \\to K$. Prove that $${a} + ${b} \\to L + K$.`,
        steps: [
          { id: "s1", text: "Let $\\varepsilon > 0$." },
          { id: "s2", text: `Choose $N_1$ with $|${a} - L| < \\varepsilon/2$ for all $n \\ge N_1$, and $N_2$ with $|${b} - K| < \\varepsilon/2$ for all $n \\ge N_2$.` },
          { id: "s3", text: "Let $N = \\max(N_1, N_2)$ and take $n \\ge N$." },
          { id: "s4", text: `Then $|(${a} + ${b}) - (L + K)| \\le |${a} - L| + |${b} - K|$ by the triangle inequality.`, after: ["s3"] },
          { id: "s5", text: "So $|(" + a + " + " + b + ") - (L + K)| < \\varepsilon/2 + \\varepsilon/2 = \\varepsilon$.", after: ["s2", "s4"] },
        ],
        extras: [
          { id: "x1", text: "Let $N = \\min(N_1, N_2)$ and take $n \\ge N$.", why: "The min only guarantees one of the two bounds; the max guarantees both." },
          { id: "x2", text: `Choose $N_1$ with $|${a} - L| < \\varepsilon$ and $N_2$ with $|${b} - K| < \\varepsilon$.`, why: "Then the sum is only below 2ε: split ε in half first." },
          { id: "x3", text: `Then $|(${a} + ${b}) - (L + K)| = |${a} - L| + |${b} - K|$.`, why: "The triangle inequality gives ≤, not =." },
        ],
      });
    },
  });

  def(["tao:6.1", "tao:6.3"], {
    id: "an-proof-bounded", name: "Proof: convergent sequences are bounded",
    blurb: "Past N the terms are within 1 of the limit; before N there are only finitely many.",
    source: from("tao", "6.1 Convergence and limit laws"),
    gen(level, r) {
      const e = r.pick([1, 2, "\\tfrac12"]);
      return proof(level, r, {
        statement: "Prove that every convergent sequence $(a_n)$ of real numbers is bounded.",
        steps: [
          { id: "s1", text: "Let $a_n \\to L$." },
          { id: "s2", text: `Taking $\\varepsilon = ${e}$, there is an $N$ with $|a_n - L| < ${e}$ for all $n \\ge N$.` },
          { id: "s3", text: `So $|a_n| < |L| + ${e}$ for all $n \\ge N$.` },
          { id: "s4", text: `Let $M = \\max(|a_1|, \\dots, |a_{N-1}|, |L| + ${e})$, a maximum of finitely many numbers.`, after: ["s3"] },
          { id: "s5", text: "Then $|a_n| \\le M$ for every $n$.", after: ["s4"] },
        ],
        extras: [
          { id: "x1", text: `Let $M = \\max_{n \\ge 1} |a_n|$.`, why: "A maximum over infinitely many terms needn't exist: that's what we're proving." },
          { id: "x2", text: `So $|a_n| < ${e}$ for all $n \\ge N$.`, why: "The terms are near L, not near 0." },
          { id: "x3", text: "Since the sequence converges, it is monotone.", why: "Convergent sequences needn't be monotone ((−1)ⁿ/n)." },
        ],
      });
    },
  });

  def(["tao:6.3", "tao:5.5"], {
    id: "an-proof-monotone", name: "Proof: bounded monotone sequences converge",
    blurb: "The limit is the supremum; the least-upper-bound property does the work.",
    source: from("tao", "6.3 Suprema and Infima of sequences"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let $(a_n)$ be increasing and bounded above. Prove that $a_n$ converges to $L = \\sup_n a_n$.",
        steps: [
          { id: "s1", text: "The set $\\{a_n\\}$ is non-empty and bounded above, so $L = \\sup_n a_n$ exists." },
          { id: "s2", text: "Let $\\varepsilon > 0$." },
          { id: "s3", text: "Since $L - \\varepsilon$ is not an upper bound, some $a_N > L - \\varepsilon$.", after: ["s1", "s2"] },
          { id: "s4", text: "For $n \\ge N$, monotonicity gives $a_n \\ge a_N > L - \\varepsilon$.", after: ["s3"] },
          { id: "s5", text: "Also $a_n \\le L$ since L is an upper bound, so $|a_n - L| < \\varepsilon$ for all $n \\ge N$.", after: ["s4"] },
        ],
        extras: [
          { id: "x1", text: "Since $L - \\varepsilon$ is an upper bound, every $a_n \\le L - \\varepsilon$.", why: "L is the *least* upper bound, so L − ε is not an upper bound." },
          { id: "x2", text: "The set $\\{a_n\\}$ is finite, so its maximum is L.", why: "The sequence has infinitely many terms and may never attain its sup." },
          { id: "x3", text: "For $n \\ge N$, $a_n \\le a_N$.", why: "An increasing sequence has a_n ≥ a_N for n ≥ N." },
        ],
      });
    },
  });

  def(["tao:10.1", "tao:9.4"], {
    id: "an-proof-differentiable", name: "Proof: differentiable implies continuous",
    blurb: "f(x) − f(x₀) = [(f(x) − f(x₀))/(x − x₀)]·(x − x₀) → f′(x₀)·0.",
    source: from("tao", "10.1 Basic definitions"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let f be differentiable at $x_0$. Prove that f is continuous at $x_0$.",
        steps: [
          { id: "s1", text: "For $x \\ne x_0$, write $f(x) - f(x_0) = \\frac{f(x) - f(x_0)}{x - x_0}\\,(x - x_0)$." },
          { id: "s2", text: "As $x \\to x_0$, the quotient tends to $f'(x_0)$ and $(x - x_0) \\to 0$.", after: ["s1"] },
          { id: "s3", text: "By the limit law for products, $f(x) - f(x_0) \\to f'(x_0)\\cdot 0 = 0$.", after: ["s2"] },
          { id: "s4", text: "So $\\lim_{x \\to x_0} f(x) = f(x_0)$: f is continuous at $x_0$.", after: ["s3"] },
        ],
        extras: [
          { id: "x1", text: "Since f is continuous, the difference quotient has a limit.", why: "Circular: continuity is what we're proving (and it doesn't imply differentiability)." },
          { id: "x2", text: "As $x \\to x_0$ the quotient tends to 0.", why: "The quotient tends to f′(x₀), which need not be 0; it's the factor x − x₀ that → 0." },
          { id: "x3", text: "Continuous functions are differentiable, so the claim follows.", why: "False (|x| at 0), and it's the converse anyway." },
        ],
      });
    },
  });

  def(["tao:9.7"], {
    id: "an-proof-ivt-root", name: "Proof: a polynomial has a root in an interval",
    blurb: "Continuity plus a sign change: the IVT supplies the root.",
    source: from("tao", "9.7 The intermediate value theorem"),
    gen(level, r) {
      for (;;) {
        const a = r.int(1, 4), c = r.int(1, 6), k = r.int(1, 3);
        const f = (x) => x ** (2 * k + 1) + a * x - c;
        if (!(f(0) < 0 && f(1) > 0) && !(f(0) < 0 && f(2) > 0)) continue;
        const b = f(1) > 0 ? 1 : 2;
        const expr = `x^{${2 * k + 1}} + ${a === 1 ? "" : a}x - ${c}`;
        return proof(level, r, {
          statement: `Prove that $p(x) = ${expr}$ has a root in $(0, ${b})$.`,
          steps: [
            { id: "s1", text: "p is a polynomial, so it is continuous on $[0, " + b + "]$." },
            { id: "s2", text: `$p(0) = ${f(0)} < 0$ and $p(${b}) = ${f(b)} > 0$.` },
            { id: "s3", text: `So 0 lies strictly between $p(0)$ and $p(${b})$.`, after: ["s2"] },
            { id: "s4", text: `By the intermediate value theorem there is $c \\in (0, ${b})$ with $p(c) = 0$.`, after: ["s1", "s3"] },
          ],
          extras: [
            { id: "x1", text: `$p(0) = ${f(0)}$ and $p(${b}) = ${f(b)}$ have the same sign.`, why: "They have opposite signs; that's what makes the IVT apply." },
            { id: "x2", text: "p is differentiable, so it has a root.", why: "Differentiability alone gives no root (x² + 1)." },
            { id: "x3", text: "By the mean value theorem there is c with p(c) = 0.", why: "The MVT is about p′; the IVT is the theorem about values." },
          ],
        });
      }
    },
  });

  def(["tao:8.3", "tao:3.6"], {
    id: "an-proof-cantor", name: "Proof: no set maps onto its power set",
    blurb: "The diagonal set D = {x : x ∉ f(x)} can't be anyone's image.",
    source: from("tao", "8.3 Uncountable sets"),
    gen(level, r) {
      const X = r.pick(["X", "A", "S"]);
      return proof(level, r, {
        statement: `Prove that there is no surjection $f : ${X} \\to \\mathcal{P}(${X})$.`,
        steps: [
          { id: "s1", text: `Suppose $f : ${X} \\to \\mathcal{P}(${X})$ is a surjection.` },
          { id: "s2", text: `Let $D = \\{x \\in ${X} : x \\notin f(x)\\}$, a subset of ${X}.` },
          { id: "s3", text: "Since f is onto, $D = f(d)$ for some $d \\in " + X + "$.", after: ["s1", "s2"] },
          { id: "s4", text: "If $d \\in D$ then $d \\notin f(d) = D$; if $d \\notin D$ then $d \\in f(d) = D$.", after: ["s3"] },
          { id: "s5", text: "Either way we have a contradiction, so no surjection exists.", after: ["s4"] },
        ],
        extras: [
          { id: "x1", text: `Let $D = \\{x \\in ${X} : x \\in f(x)\\}$.`, why: "Nothing stops that set from being f(d); the diagonal set must disagree with every f(x)." },
          { id: "x2", text: `Since ${X} is infinite, $\\mathcal{P}(${X})$ is larger.`, why: "That's the claim itself (and it holds for finite sets too)." },
          { id: "x3", text: "Since f is one-to-one, D = f(d) for some d.", why: "Being hit by f is surjectivity, not injectivity." },
        ],
      });
    },
  });

  def(["pugh:ch4"], {
    id: "an-proof-uniform-limit", name: "Proof: uniform limits of continuous functions are continuous",
    blurb: "The ε/3 argument: go to fₙ, use its continuity, come back.",
    source: from("pugh", "4 Function Spaces"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Suppose each $f_n$ is continuous at $x_0$ and $f_n \\to f$ uniformly. Prove that f is continuous at $x_0$.",
        steps: [
          { id: "s1", text: "Let $\\varepsilon > 0$." },
          { id: "s2", text: "By uniform convergence, pick n with $|f_n(x) - f(x)| < \\varepsilon/3$ for every x at once.", after: ["s1"] },
          { id: "s3", text: "By continuity of $f_n$, pick $\\delta > 0$ with $|f_n(x) - f_n(x_0)| < \\varepsilon/3$ whenever $|x - x_0| < \\delta$.", after: ["s2"] },
          { id: "s4", text: "For such x, $|f(x) - f(x_0)| \\le |f(x) - f_n(x)| + |f_n(x) - f_n(x_0)| + |f_n(x_0) - f(x_0)|$.", after: ["s3"] },
          { id: "s5", text: "Each term is below $\\varepsilon/3$, so $|f(x) - f(x_0)| < \\varepsilon$.", after: ["s4"] },
        ],
        extras: [
          { id: "x1", text: "By pointwise convergence, pick n with $|f_n(x_0) - f(x_0)| < \\varepsilon/3$.", why: "One point isn't enough: the first term needs the bound at every x near x₀, which is what uniformity gives." },
          { id: "x2", text: "Pick δ first, then choose n depending on x.", why: "n must be fixed before δ, and independent of x." },
          { id: "x3", text: "Then $|f(x) - f(x_0)| = |f_n(x) - f_n(x_0)|$.", why: "f and fₙ differ; the triangle inequality bridges them." },
        ],
      });
    },
  });

  def(["tao:10.2", "tao:9.6"], {
    id: "an-proof-rolle", name: "Proof: Rolle's theorem",
    blurb: "An extremum in the interior has zero derivative.",
    source: from("tao", "10.2 Local maxima, local minima, and derivatives"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let f be continuous on $[a, b]$, differentiable on $(a, b)$, with $f(a) = f(b)$. Prove there is $c \\in (a, b)$ with $f'(c) = 0$.",
        steps: [
          { id: "s1", text: "By the maximum principle f attains a maximum M and a minimum m on $[a, b]$." },
          { id: "s2", text: "If $M = m$, f is constant and $f'(c) = 0$ for every $c \\in (a, b)$.", after: ["s1"] },
          { id: "s3", text: "Otherwise one of M, m differs from $f(a) = f(b)$, so it is attained at some interior point c.", after: ["s1"] },
          { id: "s4", text: "An interior local extremum of a differentiable function has $f'(c) = 0$.", after: ["s3"] },
        ],
        extras: [
          { id: "x1", text: "f attains its maximum at a or b.", why: "Not necessarily; the useful case is when an extremum lies inside." },
          { id: "x2", text: "Since f(a) = f(b), f is constant.", why: "Equal endpoint values don't make f constant." },
          { id: "x3", text: "By the intermediate value theorem, f′ takes the value 0.", why: "The IVT needs f′ continuous, which isn't given; the extremum argument avoids it." },
        ],
      });
    },
  });

  def(["tao:7.2", "tao:6.5"], {
    id: "an-proof-geometric", name: "Proof: the geometric series",
    blurb: "Partial sums (1 − rᴺ⁺¹)/(1 − r), and rᴺ → 0 when |r| < 1.",
    source: from("tao", "7.2 Infinite series"),
    gen(level, r) {
      const rr = r.pick(["\\tfrac12", "\\tfrac13", "-\\tfrac12", "\\tfrac23", "-\\tfrac34"]);
      return proof(level, r, {
        statement: `Prove that $\\sum_{n=0}^\\infty r^n = \\frac{1}{1 - r}$ for $|r| < 1$ (for instance $r = ${rr}$).`,
        steps: [
          { id: "s1", text: "Let $S_N = \\sum_{n=0}^{N} r^n$." },
          { id: "s2", text: "Then $S_N - rS_N = 1 - r^{N+1}$.", after: ["s1"] },
          { id: "s3", text: "Since $r \\ne 1$, $S_N = \\frac{1 - r^{N+1}}{1 - r}$.", after: ["s2"] },
          { id: "s4", text: "Since $|r| < 1$, $r^{N+1} \\to 0$ as $N \\to \\infty$." },
          { id: "s5", text: "So $S_N \\to \\frac{1}{1 - r}$, which is the sum of the series.", after: ["s3", "s4"] },
        ],
        extras: [
          { id: "x1", text: "Since $r^n \\to 0$, the series converges.", why: "Terms → 0 is necessary but not sufficient (harmonic series)." },
          { id: "x2", text: "Then $S_N - rS_N = 1 - r^{N}$.", why: "The last term of rS_N is r^{N+1}, not r^N." },
          { id: "x3", text: "So $S_N = \\frac{1}{1 - r}$ for every N.", why: "That's the limit; each partial sum still carries −r^{N+1}/(1 − r)." },
        ],
      });
    },
  });
})();
