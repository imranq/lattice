// Generators on the topics of the books Lattice cannot host: Tao, Pugh, Herstein,
// Axler, Stein & Shakarchi, Blitzstein & Hwang, Andrews.
//
// None of their text is used. Each generator is an original family of problems
// on a topic the book teaches, tied to the book's section (`concepts`, so the
// course page for that book can offer it) and citing it (`source`), so a reader
// can go and learn it properly. Proofs are ours too: standard arguments, written
// here, shuffled with plausible wrong lines.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M) return;
  const { band, fmtFrac, gcd } = M.util;

  const fmt = (x, dp = 4) => String(Number(x.toFixed(dp)));
  const wrong = (answer, list) => list.filter((m) => m.answer !== undefined && m.answer !== answer);
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  const search = (q) => `https://openlibrary.org/search?q=${encodeURIComponent(q)}`;

  const BOOKS = {
    tao: ["Tao, Analysis I", "https://terrytao.wordpress.com/books/analysis-i/"],
    pugh: ["Pugh, Real Mathematical Analysis", search("Real Mathematical Analysis Pugh")],
    herstein: ["Herstein, Abstract Algebra", search("Abstract Algebra Herstein")],
    axler: ["Axler, Linear Algebra Done Right", "https://linear.axler.net/"],
    stein: ["Stein & Shakarchi, Complex Analysis", search("Complex Analysis Stein Shakarchi")],
    blitzstein: ["Blitzstein & Hwang, Introduction to Probability", "http://probabilitybook.net/"],
    andrews: ["Andrews, Number Theory", search("Number Theory George Andrews")],
    mahajan: ["Mahajan, Street-Fighting Mathematics", "https://mitpress.mit.edu/9780262514293/street-fighting-mathematics/"],
  };
  /** A citation to the book section this generator practises. */
  const from = (book, section) => ({
    book, title: BOOKS[book][0], section, url: BOOKS[book][1], fidelity: "inspired",
  });

  /** Register a generator for these concept ids ("tao:9.9" → concept:tao:9.9). */
  const def = (domain, concepts, g) => M.define({
    domain, prose: true, ...g, concepts: concepts.map((c) => `concept:${c}`),
  });

  const shuffle = (xs, r) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  /** A proof as a problem. Levels 1–2: fill the one missing line (multiple
   *  choice among the right line and plausible wrong ones). Level 3+: put the
   *  shuffled lines in order, leaving out the ones that don't belong. */
  function proof(level, r, { statement, steps, extras }) {
    const planted = shuffle(extras, r);
    if (level <= 2) {
      const k = r.int(1, steps.length - 2);
      const lines = steps.map((st, i) => `${i + 1}. ${i === k ? "[ ? ]" : st.text}`);
      return {
        prompt: `${statement}\n\nWhich line completes this proof?\n\n${lines.join("\n\n")}`,
        answer: steps[k].text, format: "choice",
        mistakes: planted.slice(0, 3).map((x) => ({ answer: x.text, why: x.why })),
        steps: steps.map((st) => st.text), trick: "Each line must follow from the ones above it.",
        params: { k },
      };
    }
    const use = planted.slice(0, band(level, [1, 1, 2, 2, 3]));
    const lines = shuffle([...steps, ...use].map(({ id, text }) => ({ id, text })), r);
    return {
      prompt: `${statement}\n\nBuild the proof: put the lines in order, and leave out any that don't belong.`,
      answer: steps.map((st) => st.id).join(","), kind: "order", typed: true,
      steps, extras: use, lines,
      trick: "Each line must follow from the ones above it.",
      params: { order: steps.map((st) => st.id) },
    };
  }

  // ==== real analysis (Tao, Pugh) =================================================

  def("real analysis", ["tao:9.4", "pugh:ch3"], {
    id: "ra-delta-linear", name: "ε–δ for a linear function",
    blurb: "For f(x) = ax + b, |f(x) − f(c)| = |a|·|x − c|, so δ = ε/|a|.",
    source: from("tao", "9.4 Continuous functions"),
    gen(level, r) {
      const a = r.pick(band(level, [[2, 3, 4], [2, 5, -3], [-4, 6, 0.5], [0.5, -8, 12], [0.25, -20, 0.2]]));
      const b = r.int(-5, 5), c = r.int(-3, 3);
      const eps = r.pick(band(level, [[0.1, 0.5], [0.1, 0.01], [0.03, 0.06], [0.001, 0.02], [1e-3, 5e-4]]));
      const d = eps / Math.abs(a);
      return {
        prompt: `$f(x) = ${a}x ${b < 0 ? "-" : "+"} ${Math.abs(b)}$. For $\\varepsilon = ${eps}$, what is the largest $\\delta$ `
          + `such that $|x - ${c}| < \\delta$ guarantees $|f(x) - f(${c})| < \\varepsilon$?`,
        answer: fmt(d, 6), tolerance: 0.001, params: { a, eps },
        steps: [`|f(x) − f(c)| = |${a}|·|x − c|`, `need |${a}|·δ ≤ ε`, `δ = ${eps}/${Math.abs(a)} = ${fmt(d, 6)}`],
        trick: "Steeper functions need a smaller δ.",
        mistakes: wrong(fmt(d, 6), [
          { answer: fmt(eps * Math.abs(a), 6), why: "That multiplies by the slope; the δ-window must shrink as the slope grows, so divide." },
          { answer: fmt(eps, 6), why: `The slope is ${a}, not 1: |f(x) − f(c)| = |${a}|·|x − c|.` },
        ]),
      };
    },
  });

  def("real analysis", ["tao:9.4", "tao:9.9"], {
    id: "ra-delta-square", name: "ε–δ for x²",
    blurb: "Bound |x + c| by first insisting δ ≤ 1: then δ = min(1, ε/(2|c| + 1)).",
    source: from("tao", "9.4 Continuous functions"),
    gen(level, r) {
      const c = r.pick(band(level, [[1, 2], [2, 3], [3, 4, -2], [5, -4, 7], [10, -6, 9]]));
      const eps = r.pick(band(level, [[0.1, 0.5], [1, 0.1], [0.01, 2], [0.05, 3, 0.001], [0.001, 10]]));
      const k = 2 * Math.abs(c) + 1;
      const d = Math.min(1, eps / k);
      return {
        prompt: `To show $f(x) = x^2$ is continuous at $c = ${c}$, the standard proof first takes $\\delta \\le 1$, so `
          + `$|x + c| \\le 2|c| + 1$, and then needs $|x - c|\\cdot(2|c| + 1) < \\varepsilon$. `
          + `For $\\varepsilon = ${eps}$, what $\\delta$ does it choose?`,
        answer: fmt(d, 6), tolerance: 0.001, params: { c, eps },
        steps: [`2|c| + 1 = ${k}`, `ε/${k} = ${fmt(eps / k, 6)}`, `δ = min(1, ${fmt(eps / k, 6)}) = ${fmt(d, 6)}`],
        trick: "The min with 1 is what made the bound on |x + c| legal.",
        mistakes: wrong(fmt(d, 6), [
          { answer: fmt(eps / (2 * Math.abs(c)), 6), why: "|x + c| can be as large as 2|c| + 1 when |x − c| < 1, not 2|c|." },
          { answer: fmt(eps / k, 6), why: "Without the min with 1 the bound |x + c| ≤ 2|c| + 1 isn't guaranteed." },
          { answer: fmt(Math.sqrt(eps), 6), why: "√ε works near 0 only; at c ≠ 0 the slope 2c matters." },
        ]),
      };
    },
  });

  def("real analysis", ["tao:6.1", "tao:5.1"], {
    id: "ra-sequence-N", name: "Finding N for a limit",
    blurb: "Solve |aₙ − L| < ε for n; the first n that works is N.",
    source: from("tao", "6.1 Convergence and limit laws"),
    gen(level, r) {
      for (;;) {
        const p = r.int(1, 4), q = r.int(-3, 5), rr = r.int(1, 3), s = r.int(1, 4);
        const num = Math.abs(q * rr - p * s);
        if (!num) continue;
        const k = r.pick(band(level, [[10], [10, 20], [100], [100, 1000], [1000, 10000]]));
        // |aₙ − p/r| = num / (r(rn + s)) < 1/k  ⇔  num·k < r(rn + s)
        let N = 1;
        while (!(num * k < rr * (rr * N + s))) N++;
        const noS = Math.floor((num * k) / (rr * rr)) + 1;
        return {
          prompt: `$a_n = \\dfrac{${p}n ${q < 0 ? "-" : "+"} ${Math.abs(q)}}{${rr === 1 ? "" : rr}n + ${s}}$ converges to $${fmtFrac(p, rr)}$. `
            + `What is the smallest $N$ such that $|a_n - ${fmtFrac(p, rr)}| < \\tfrac{1}{${k}}$ for every $n \\ge N$?`,
          answer: String(N), params: { p, q, r: rr, s, k },
          steps: [`aₙ − ${fmtFrac(p, rr)} = ${q * rr - p * s}/(${rr}(${rr}n + ${s}))`,
                  `need ${num}·${k} < ${rr}(${rr}n + ${s})`, `first n that works: ${N}`],
          trick: "The error is exactly computable here; solve for n, then round up.",
          mistakes: wrong(String(N), [
            { answer: String(N - 1), why: `At n = ${N - 1} the error is still at least 1/${k}: the inequality is strict.` },
            { answer: String(noS), why: `That drops the + ${s} in the denominator, which helps: the true N is smaller.` },
            { answer: String(N + 1), why: `n = ${N} already satisfies it.` },
          ]),
        };
      }
    },
  });

  def("real analysis", ["tao:6.3", "tao:6.4"], {
    id: "ra-sup-limsup", name: "sup, inf, lim sup, lim inf",
    blurb: "sup and inf look at every term; lim sup and lim inf only at the tail.",
    source: from("tao", "6.4 Limsup, liminf, and limit points"),
    gen(level, r) {
      const c = r.int(-2, 3);
      const fam = r.pick(band(level, [["shift"], ["shift", "alt"], ["alt", "osc"], ["osc", "alt"], ["osc"]]));
      let desc, vals;
      if (fam === "shift") {        // c − 1/n
        desc = `a_n = ${c} - \\tfrac{1}{n}`;
        vals = { sup: [c, 1], inf: [c - 1, 1], limsup: [c, 1], liminf: [c, 1] };
      } else if (fam === "alt") {   // c + (−1)^n / n
        desc = `a_n = ${c} + \\tfrac{(-1)^n}{n}`;
        vals = { sup: [2 * c + 1, 2], inf: [c - 1, 1], limsup: [c, 1], liminf: [c, 1] };
      } else {                      // (−1)^n (1 + 1/n) + c
        desc = `a_n = (-1)^n\\left(1 + \\tfrac{1}{n}\\right) ${c < 0 ? "-" : "+"} ${Math.abs(c)}`;
        vals = { sup: [2 * c + 3, 2], inf: [c - 2, 1], limsup: [c + 1, 1], liminf: [c - 1, 1] };
      }
      const ask = r.pick(["sup", "inf", "limsup", "liminf"]);
      const show = (k) => fmtFrac(...vals[k]);
      const tex = { sup: "\\sup_n a_n", inf: "\\inf_n a_n", limsup: "\\limsup_{n\\to\\infty} a_n", liminf: "\\liminf_{n\\to\\infty} a_n" };
      const why = {
        sup: "sup looks at every term, including early ones; lim sup only at the tail.",
        inf: "inf looks at every term, including early ones; lim inf only at the tail.",
        limsup: "lim sup is the largest limit point of the tail, not the largest term.",
        liminf: "lim inf is the smallest limit point of the tail, not the smallest term.",
      };
      return {
        prompt: `For $${desc}$, $n \\ge 1$, what is $${tex[ask]}$?`,
        answer: show(ask), params: { fam, c, ask },
        steps: [`first terms: ${[1, 2, 3, 4].map((n) => fmt(fam === "shift" ? c - 1 / n : fam === "alt" ? c + (-1) ** n / n : (-1) ** n * (1 + 1 / n) + c, 3)).join(", ")}, …`,
                `${ask} = ${show(ask)}`],
        trick: "Write out the first few terms and the tail separately.",
        mistakes: wrong(show(ask), ["sup", "inf", "limsup", "liminf"].filter((k) => k !== ask)
          .map((k) => ({ answer: show(k), why: `That is the ${k}. ${why[ask]}` }))),
      };
    },
  });

  def("real analysis", ["tao:7.5", "tao:7.2"], {
    id: "ra-ratio-test", name: "Ratio test",
    blurb: "L = lim |aₙ₊₁/aₙ|: L < 1 converges, L > 1 diverges, L = 1 says nothing.",
    source: from("tao", "7.5 The root and ratio tests"),
    gen(level, r) {
      const fam = r.pick(band(level, [["poly-geo"], ["poly-geo", "fact"], ["fact", "central", "poly-geo"], ["central", "power"], ["central", "power", "fact"]]));
      let tex, L, Ltex, verdict;
      if (fam === "poly-geo") {
        const k = r.int(1, 4), c = r.pick([2, 3, 5, 10]);
        tex = `\\sum_{n\\ge1} \\frac{n^{${k}}}{${c}^n}`; L = [1, c]; verdict = "converges";
      } else if (fam === "fact") {
        const c = r.pick([2, 3, 10]);
        tex = `\\sum_{n\\ge1} \\frac{n!}{${c}^n}`; L = null; Ltex = "∞"; verdict = "diverges";
      } else if (fam === "central") {
        tex = `\\sum_{n\\ge1} \\frac{(n!)^2}{(2n)!}`; L = [1, 4]; verdict = "converges";
      } else {
        const p = r.pick([1, 2, 3]);
        tex = `\\sum_{n\\ge1} \\frac{1}{n^{${p}}}`; L = [1, 1]; verdict = p > 1 ? "converges" : "diverges";
      }
      if (level >= 3 && L) {
        const ans = fmtFrac(...L);
        return {
          prompt: `For $${tex}$, what is $L = \\lim_{n\\to\\infty} |a_{n+1}/a_n|$?`,
          answer: ans, params: { fam, tex, ask: "L" },
          steps: [`form the ratio aₙ₊₁/aₙ and simplify`, `limit L = ${ans}`,
                  L[0] === L[1] ? "L = 1: the test is inconclusive" : `L ${L[0] < L[1] ? "<" : ">"} 1`],
          trick: "Factorials and powers cancel in the ratio; polynomials tend to 1.",
          mistakes: wrong(ans, [
            { answer: fmtFrac(L[1], L[0]), why: "That is aₙ/aₙ₊₁, the reciprocal." },
            { answer: "0", why: "Only a faster-than-exponential denominator sends the ratio to 0." },
            { answer: "1", why: "A polynomial factor's ratio tends to 1, but the other factors don't cancel." },
          ]),
        };
      }
      return {
        prompt: `Does $${tex}$ converge or diverge?`,
        answer: verdict, format: "choice", params: { fam, tex, ask: "verdict" },
        steps: [`ratio test: L = ${L ? fmtFrac(...L) : Ltex}`,
                L && L[0] === L[1] ? "L = 1 is inconclusive; compare with ∫ dx/x^p" : `so it ${verdict}`],
        trick: "Try the ratio test first; if L = 1, compare with a p-series or an integral.",
        mistakes: [{ answer: verdict === "converges" ? "diverges" : "converges",
          why: L && L[0] === L[1] ? "The ratio test gives L = 1 here, which decides nothing: the p-series test does."
            : `L = ${L ? fmtFrac(...L) : Ltex}, which is ${verdict === "converges" ? "below" : "above"} 1.` }],
      };
    },
  });

  def("real analysis", ["tao:11.3", "tao:11.6"], {
    id: "ra-darboux", name: "Upper and lower sums",
    blurb: "For increasing f on n equal pieces: lower sum uses left ends, upper uses right ends.",
    source: from("tao", "11.3 Upper and lower Riemann integrals"),
    gen(level, r) {
      const k = r.pick(band(level, [[1], [1, 2], [2], [2, 3], [3]]));
      const n = r.pick(band(level, [[2, 4], [4, 5], [3, 5, 10], [4, 10], [10, 20]]));
      const S = (a, b) => { let t = 0; for (let i = a; i <= b; i++) t += i ** k; return t; };
      const den = n ** (k + 1);
      const L = fmtFrac(S(0, n - 1), den), U = fmtFrac(S(1, n), den);
      const ask = r.pick(["lower", "upper", "gap"]);
      const ans = ask === "lower" ? L : ask === "upper" ? U : fmtFrac(1, n);
      return {
        prompt: `$f(x) = x^{${k}}$ on $[0, 1]$, split into ${n} equal pieces. What is the ${
          ask === "gap" ? "difference between the upper and lower Darboux sums" : `${ask} Darboux sum`}?`,
        answer: ans, params: { k, n, ask },
        steps: [`f is increasing: inf on a piece is at its left end, sup at its right end`,
                `L = Σ_{i=0}^{${n - 1}} (i/${n})^${k}·(1/${n}) = ${L}`, `U = ${U}`, `U − L = (f(1) − f(0))/${n} = 1/${n}`],
        trick: "For monotone f, U − L telescopes to (f(b) − f(a))(b − a)/n: that is why monotone functions are integrable.",
        mistakes: wrong(ans, [
          { answer: ask === "lower" ? U : L, why: ask === "lower" ? "The lower sum takes each piece's infimum, at its left end." : "The upper sum takes each piece's supremum, at its right end." },
          { answer: fmtFrac(1, k + 1), why: "That is the integral itself, which the sums only approach." },
          ...(ask !== "gap" ? [{ answer: fmtFrac(1, n), why: "That is U − L, not the sum itself." }] : []),
        ]),
      };
    },
  });

  const UNIFORM = [
    ["$f(x) = x^2$ on $[0, 1]$", "yes", "Continuous on a closed bounded interval, so uniformly continuous."],
    ["$f(x) = x^2$ on $\\mathbb{R}$", "no", "The slope 2x is unbounded: a fixed δ can't work for large x."],
    ["$f(x) = 1/x$ on $(0, 1]$", "no", "Near 0 the function blows up; points close together have far-apart values."],
    ["$f(x) = 1/x$ on $[1, \\infty)$", "yes", "|f'(x)| ≤ 1 there, so f is Lipschitz, hence uniformly continuous."],
    ["$f(x) = \\sin x$ on $\\mathbb{R}$", "yes", "|sin x − sin y| ≤ |x − y|: Lipschitz."],
    ["$f(x) = \\sqrt{x}$ on $[0, \\infty)$", "yes", "|√x − √y| ≤ √|x − y|, so δ = ε² works everywhere."],
    ["$f(x) = \\sin(1/x)$ on $(0, 1]$", "no", "It oscillates between −1 and 1 arbitrarily close to 0."],
    ["$f(x) = x\\sin(1/x)$ on $(0, 1]$", "yes", "It extends continuously to [0, 1] (value 0 at 0), a compact interval."],
    ["$f(x) = e^x$ on $\\mathbb{R}$", "no", "Its slope eˣ is unbounded."],
    ["$f(x) = \\ln x$ on $[1, \\infty)$", "yes", "|f'(x)| = 1/x ≤ 1 there: Lipschitz."],
  ];

  def("real analysis", ["tao:9.9", "pugh:ch3"], {
    id: "ra-uniform", name: "Uniform continuity",
    blurb: "One δ for every point: compact domains and bounded slopes give it; blow-ups break it.",
    source: from("tao", "9.9 Uniform continuity"),
    gen(level, r) {
      const [f, ans, why] = r.pick(UNIFORM);
      return {
        prompt: `Is ${f} uniformly continuous?`, answer: ans, format: "choice", params: { f },
        steps: [why], trick: "Bounded derivative ⇒ Lipschitz ⇒ uniformly continuous; continuous on compact ⇒ uniformly continuous.",
        mistakes: [{ answer: ans === "yes" ? "no" : "yes", why }],
      };
    },
  });

  const CARD = [
    ["$\\mathbb{Q}$", "countable", "List fractions p/q by |p| + q: each appears at a finite position."],
    ["$\\mathbb{Z} \\times \\mathbb{Z}$", "countable", "Walk the lattice in expanding squares: a countable union of finite sets."],
    ["the set of finite binary strings", "countable", "Finitely many strings of each length, and countably many lengths."],
    ["the algebraic numbers", "countable", "Countably many integer polynomials, each with finitely many roots."],
    ["the interval $(0, 1)$", "uncountable", "Cantor's diagonal argument: any list of decimals misses one."],
    ["the power set of $\\mathbb{N}$", "uncountable", "No map ℕ → P(ℕ) is onto (Cantor): the diagonal set is missed."],
    ["the set of infinite binary sequences", "uncountable", "It is in bijection with P(ℕ)."],
    ["the set of polynomials with rational coefficients", "countable", "A countable union over degrees of countable sets ℚⁿ⁺¹."],
    ["the irrational numbers", "uncountable", "ℝ is uncountable and ℚ countable, so ℝ \\ ℚ must be uncountable."],
    ["the set of sequences of 0s and 1s that are eventually 0", "countable", "Each is a finite binary string followed by zeros."],
  ];

  def("real analysis", ["tao:8.1", "tao:8.3"], {
    id: "ra-countable", name: "Countable or not",
    blurb: "Countable: you can list it. Uncountable: a diagonal argument beats every list.",
    source: from("tao", "8.3 Uncountable sets"),
    gen(level, r) {
      const [set, ans, why] = r.pick(CARD);
      return {
        prompt: `Is ${set} countable or uncountable?`, answer: ans, format: "choice", params: { set },
        steps: [why], trick: "Countable unions of countable sets are countable; power sets never are.",
        mistakes: [{ answer: ans === "countable" ? "uncountable" : "countable", why }],
      };
    },
  });

  def("real analysis", ["pugh:ch2"], {
    id: "ra-open-closed", name: "Open, closed, both, neither",
    blurb: "Open: every point has room around it. Closed: it contains its limit points.",
    source: from("pugh", "Ch. 2, A Taste of Topology"),
    gen(level, r) {
      const a = r.int(-3, 2), b = a + r.int(1, 4);
      const sets = [
        [`[${a}, ${b})`, false, false, `${a} has no room around it, and ${b} is a limit point left out.`],
        [`(${a}, ${b})`, true, false, `Every point has room; the endpoints ${a} and ${b} are limit points left out.`],
        [`[${a}, ${b}]`, false, true, `It contains its limit points; the endpoints have no room around them.`],
        [`\\{${a} + 1/n : n \\ge 1\\}`, false, false, `${a} is a limit point not in the set, and no point has room around it.`],
        [`\\{${a} + 1/n : n \\ge 1\\} \\cup \\{${a}\\}`, false, true, `Adding the limit point ${a} closes it; isolated points still have no room.`],
        [`\\mathbb{Z}`, false, true, `Its points are isolated, so it has no limit points to miss; no interval around an integer stays inside.`],
        [`\\mathbb{Q}`, false, false, `Every interval contains irrationals, and every real is a limit of rationals.`],
        [`\\mathbb{R}`, true, true, `The whole line is open, and its complement ∅ is open too.`],
        [`(${a}, \\infty)`, true, false, `Every point has room; ${a} is a limit point left out.`],
      ];
      const [set, open, closed, why] = r.pick(sets);
      const label = (o, c) => (o && c ? "both" : o ? "open" : c ? "closed" : "neither");
      const ans = label(open, closed);
      return {
        prompt: `In $\\mathbb{R}$, is $${set}$ open, closed, both, or neither?`,
        answer: ans, format: "choice", params: { set },
        steps: [why], trick: "Check the two questions separately: room around every point? all limit points included?",
        mistakes: ["open", "closed", "both", "neither"].filter((x) => x !== ans).map((x) => ({ answer: x, why })),
      };
    },
  });

  // ==== abstract algebra (Herstein) =================================================

  def("abstract algebra", ["herstein:2.3", "herstein:2.4"], {
    id: "aa-order-zn", name: "Orders in ℤₙ",
    blurb: "The order of k in ℤₙ is n / gcd(n, k).",
    source: from("herstein", "2.4 Lagrange's Theorem"),
    gen(level, r) {
      const n = r.int(band(level, [6, 10, 20, 30, 50]), band(level, [12, 30, 60, 120, 360]));
      let k = r.int(1, n - 1);
      if (level >= 2 && gcd(n, k) === 1 && r() < 0.7) k = r.int(1, n - 1);
      const g = gcd(n, k), ans = n / g;
      return {
        prompt: `What is the order of ${k} in the additive group $\\mathbb{Z}_{${n}}$?`,
        answer: String(ans), params: { n, k },
        steps: [`smallest m with m·${k} ≡ 0 (mod ${n})`, `gcd(${n}, ${k}) = ${g}`, `order = ${n}/${g} = ${ans}`],
        trick: "The order always divides n, as Lagrange's theorem promises.",
        mistakes: wrong(String(ans), [
          { answer: String(g), why: "gcd(n, k) is the size of the step that repeats, not how many steps it takes." },
          { answer: String(n), why: `Only generators (gcd = 1) have order n; gcd(${n}, ${k}) = ${g}.` },
          { answer: String(k), why: "The order counts how many copies of k add to 0 mod n." },
        ]),
      };
    },
  });

  function randomPerm(n, r) {
    const p = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    return p;
  }
  function cyclesOf(p) {
    const seen = new Set(), cycles = [];
    for (let i = 1; i <= p.length; i++) {
      if (seen.has(i)) continue;
      const c = [];
      for (let j = i; !seen.has(j); j = p[j - 1]) { seen.add(j); c.push(j); }
      cycles.push(c);
    }
    return cycles;
  }
  const twoLine = (p) => `\\begin{pmatrix}${p.map((_, i) => i + 1).join(" & ")} \\\\ ${p.join(" & ")}\\end{pmatrix}`;

  def("abstract algebra", ["herstein:3.2"], {
    id: "aa-perm-order", name: "Order of a permutation",
    blurb: "Write it in disjoint cycles; the order is the lcm of the cycle lengths.",
    source: from("herstein", "3.2 Cycle Decomposition"),
    gen(level, r) {
      const n = r.int(band(level, [4, 5, 6, 7, 8]), band(level, [5, 6, 8, 9, 10]));
      let p, cyc;
      do { p = randomPerm(n, r); cyc = cyclesOf(p); } while (cyc.filter((c) => c.length > 1).length < (level >= 3 ? 2 : 1));
      const lens = cyc.map((c) => c.length);
      const ord = lens.reduce(lcm, 1);
      const nontriv = cyc.filter((c) => c.length > 1);
      return {
        prompt: `What is the order of $\\sigma = ${twoLine(p)}$ in $S_{${n}}$?`,
        answer: String(ord), params: { p },
        steps: [`cycles: ${nontriv.map((c) => `(${c.join(" ")})`).join("")}`, `lengths ${lens.filter((l) => l > 1).join(", ")}`, `lcm = ${ord}`],
        trick: "Disjoint cycles commute, so σᵐ = id exactly when every cycle length divides m.",
        mistakes: wrong(String(ord), [
          { answer: String(lens.filter((l) => l > 1).reduce((a, b) => a + b, 0)), why: "Cycle lengths combine by lcm, not by adding." },
          { answer: String(lens.reduce((a, b) => a * b, 1)), why: "The product overshoots when lengths share a factor: use the lcm." },
          { answer: String(Math.max(...lens)), why: "Every cycle must return to the start at the same time: the lcm of all lengths." },
        ]),
      };
    },
  });

  def("abstract algebra", ["herstein:3.3"], {
    id: "aa-perm-sign", name: "Even or odd permutation",
    blurb: "A k-cycle is k − 1 transpositions; add them up.",
    source: from("herstein", "3.3 Odd and Even Permutations"),
    gen(level, r) {
      const n = r.int(4, band(level, [5, 6, 7, 8, 9]));
      const p = randomPerm(n, r);
      const cyc = cyclesOf(p);
      const t = cyc.reduce((s, c) => s + c.length - 1, 0);
      const ans = t % 2 ? "odd" : "even";
      return {
        prompt: `Is $\\sigma = ${twoLine(p)}$ an even or an odd permutation?`,
        answer: ans, format: "choice", params: { p },
        steps: [`cycles: ${cyc.filter((c) => c.length > 1).map((c) => `(${c.join(" ")})`).join("") || "identity"}`,
                `transpositions: ${cyc.map((c) => c.length - 1).join(" + ")} = ${t}`],
        trick: "A cycle of even length is odd, and vice versa.",
        mistakes: [{ answer: ans === "even" ? "odd" : "even", why: `It is a product of ${t} transpositions, an ${ans} number: each k-cycle contributes k − 1.` }],
      };
    },
  });

  def("abstract algebra", ["herstein:2.4", "herstein:2.3"], {
    id: "aa-cyclic-count", name: "Subgroups and generators of ℤₙ",
    blurb: "ℤₙ has one subgroup per divisor of n, and φ(n) generators.",
    source: from("herstein", "2.3 Subgroups"),
    gen(level, r) {
      const n = r.int(band(level, [6, 10, 12, 20, 30]), band(level, [12, 30, 60, 100, 200]));
      const divs = []; for (let d = 1; d <= n; d++) if (n % d === 0) divs.push(d);
      let phi = 0; for (let k = 1; k <= n; k++) if (gcd(n, k) === 1) phi++;
      const askSub = r() < 0.5;
      const ans = String(askSub ? divs.length : phi);
      return {
        prompt: askSub ? `How many subgroups does the cyclic group $\\mathbb{Z}_{${n}}$ have?`
                       : `How many elements generate $\\mathbb{Z}_{${n}}$?`,
        answer: ans, params: { n, ask: askSub ? "subgroups" : "generators" },
        steps: askSub ? [`one subgroup ⟨n/d⟩ of order d for each divisor d`, `divisors of ${n}: ${divs.join(", ")}`]
                      : [`k generates iff gcd(k, ${n}) = 1`, `φ(${n}) = ${phi}`],
        trick: "Cyclic groups are the easy case: subgroups ↔ divisors, generators ↔ units.",
        mistakes: wrong(ans, [
          { answer: String(askSub ? phi : divs.length), why: askSub ? "That counts generators (φ(n)); subgroups correspond to divisors." : "That counts subgroups (divisors); generators are the k coprime to n." },
          { answer: String(n - 1), why: askSub ? "Subgroups correspond to divisors of n, not to elements." : `Only k coprime to ${n} generate.` },
        ]),
      };
    },
  });

  // ==== number theory (Andrews) ======================================================

  function egcd(a, b) {
    if (b === 0) return [a, 1, 0];
    const [g, x, y] = egcd(b, a % b);
    return [g, y, x - Math.floor(a / b) * y];
  }

  def("number theory", ["andrews:2.1"], {
    id: "nt-diophantine", name: "Linear Diophantine equations",
    blurb: "ax + by = c has integer solutions exactly when gcd(a, b) divides c.",
    source: from("andrews", "2-3 The Linear Diophantine Equation"),
    gen(level, r) {
      for (;;) {
        const a = r.int(2, band(level, [9, 15, 30, 60, 120])), b = r.int(2, band(level, [9, 15, 30, 60, 120]));
        const g = gcd(a, b);
        if (level <= 1 || r() < 0.3) {
          const c = r.int(1, 40);
          const ok = c % g === 0;
          return {
            prompt: `Does $${a}x + ${b}y = ${c}$ have a solution in integers?`, answer: ok ? "yes" : "no",
            format: "choice", params: { a, b, c },
            steps: [`gcd(${a}, ${b}) = ${g}`, ok ? `${g} divides ${c}` : `${g} does not divide ${c}`],
            trick: "Anything ax + by is a multiple of gcd(a, b), and every such multiple is reachable.",
            mistakes: [{ answer: ok ? "no" : "yes", why: ok ? `gcd(${a}, ${b}) = ${g} divides ${c}, so Bézout gives a solution.` : `Every ${a}x + ${b}y is a multiple of ${g}, and ${c} isn't.` }],
          };
        }
        if (g === Math.max(a, b)) continue;
        const c = g * r.int(1, 12) * r.sign();
        const [, x0, y0] = egcd(a, b);
        const x = x0 * (c / g), y = y0 * (c / g);
        return {
          prompt: `Find integers $x, y$ with $${a}x + ${b}y = ${c}$. (Any solution works; write it as “x, y”.)`,
          // No `params`: any solution is right, so the verifier checks this one
          // by substitution (and a second solution) instead of a reference value.
          answer: `${x}, ${y}`, kind: "pair", pair: { a, b, c }, typed: true,
          steps: [`gcd(${a}, ${b}) = ${g} = ${a}·(${x0}) + ${b}·(${y0}) by the extended Euclidean algorithm`,
                  `scale by ${c}/${g} = ${c / g}: x = ${x}, y = ${y}`,
                  `every solution: x = ${x} + ${b / g}t, y = ${y} − ${a / g}t`],
          trick: "Run Euclid backwards to write the gcd as a combination, then scale.",
        };
      }
    },
  });

  def("number theory", ["andrews:5.1"], {
    id: "nt-fermat-wilson", name: "Fermat and Wilson",
    blurb: "aᵖ⁻¹ ≡ 1 and (p − 1)! ≡ −1 (mod p) for a prime p.",
    source: from("andrews", "5-2 The Theorems of Fermat and Wilson Revisited"),
    gen(level, r) {
      const p = r.pick(band(level, [[5, 7], [7, 11, 13], [11, 13, 17], [17, 19, 23], [23, 29, 31, 37]]));
      const kind = r.pick(level <= 1 ? ["wilson", "fermat"] : ["wilson", "wilson2", "fermat", "power"]);
      const powmod = (a, e, m) => { let x = 1, b = a % m; for (; e; e >>= 1, b = (b * b) % m) if (e & 1) x = (x * b) % m; return x; };
      if (kind === "wilson" || kind === "wilson2") {
        const k = kind === "wilson" ? p - 1 : p - 2;
        const ans = String(kind === "wilson" ? p - 1 : 1);
        return {
          prompt: `What is $${k}! \\bmod ${p}$?`, answer: ans, params: { p, k },
          steps: kind === "wilson" ? [`Wilson: (p − 1)! ≡ −1 (mod p)`, `−1 ≡ ${p - 1}`]
                                   : [`(p − 1)! = (p − 1)·(p − 2)! ≡ −1`, `and p − 1 ≡ −1, so (p − 2)! ≡ 1`],
          trick: "Pair each number with its inverse mod p; only 1 and p − 1 are their own inverses.",
          mistakes: wrong(ans, [
            { answer: "0", why: `${p} is prime and larger than every factor, so it divides none of them.` },
            { answer: String(kind === "wilson" ? 1 : p - 1), why: kind === "wilson" ? "Wilson's theorem gives −1, which is p − 1, not 1." : "(p − 1)! ≡ −1, and dividing out p − 1 ≡ −1 leaves +1." },
          ]),
        };
      }
      const a = r.int(2, p - 1);
      const e = kind === "fermat" ? p - 1 : r.int(p + 1, 20 * p);
      const ans = String(powmod(a, e, p));
      return {
        prompt: `What is $${a}^{${e}} \\bmod ${p}$?`, answer: ans, params: { a, e, p },
        steps: [`Fermat: ${a}^${p - 1} ≡ 1 (mod ${p})`, `${e} = ${p - 1}·${Math.floor(e / (p - 1))} + ${e % (p - 1)}`,
                `${a}^${e % (p - 1)} mod ${p} = ${ans}`],
        trick: "Reduce the exponent mod p − 1, never mod p.",
        mistakes: wrong(ans, [
          { answer: String(powmod(a, e % p, p)), why: "Exponents reduce mod p − 1 (Fermat), not mod p." },
          { answer: "1", why: kind === "fermat" ? undefined : `Only exponents divisible by ${p - 1} are guaranteed to give 1.` },
          { answer: "0", why: `${p} doesn't divide ${a}, so no power of ${a} is 0 mod ${p}.` },
        ].filter((m) => m.why)),
      };
    },
  });

  def("number theory", ["andrews:7.1"], {
    id: "nt-units", name: "Units mod n",
    blurb: "φ(n) residues are invertible; find an inverse with the extended Euclidean algorithm.",
    source: from("andrews", "7-1 Properties of Reduced Residue Systems"),
    gen(level, r) {
      const n = r.int(band(level, [8, 12, 20, 30, 50]), band(level, [20, 40, 100, 200, 500]));
      if (level <= 2 || r() < 0.4) {
        let phi = 0; for (let k = 1; k <= n; k++) if (gcd(n, k) === 1) phi++;
        return {
          prompt: `How many residues mod ${n} are invertible (that is, what is $\\varphi(${n})$)?`,
          answer: String(phi), params: { n, ask: "phi" },
          steps: [`φ(n) = n ∏(1 − 1/p) over primes p | n`, `= ${phi}`],
          trick: "Invertible mod n ⇔ coprime to n.",
          mistakes: wrong(String(phi), [
            { answer: String(n - 1), why: "Only the residues coprime to n are invertible; that is n − 1 only when n is prime." },
            { answer: String(Math.floor(n / 2)), why: "Removing even numbers isn't enough: every prime factor of n removes a share." },
          ]),
        };
      }
      let a; do { a = r.int(2, n - 1); } while (gcd(a, n) !== 1);
      const [, x] = egcd(a, n);
      const inv = ((x % n) + n) % n;
      return {
        prompt: `Find the inverse of ${a} modulo ${n}: the $x$ in $\\{0, \\dots, ${n - 1}\\}$ with ${a}x ≡ 1 (mod ${n}).`,
        answer: String(inv), params: { n, a, ask: "inverse" },
        steps: [`extended Euclid: ${a}·(${x}) + ${n}·(…) = 1`, `x ≡ ${x} ≡ ${inv} (mod ${n})`],
        trick: "Check it: multiply back and reduce.",
        mistakes: wrong(String(inv), [
          { answer: String(n - inv), why: `That is −x mod ${n}: ${a}·${n - inv} ≡ −1, not 1.` },
          { answer: String(n - a), why: `n − a is the additive inverse (−a), not the multiplicative one.` },
        ]),
      };
    },
  });

  // ==== linear algebra (Axler) =========================================================

  def("linear algebra", ["axler:5.1", "axler:9.1"], {
    id: "la-eigen2", name: "Eigenvalues of a 2×2 matrix",
    blurb: "They solve λ² − (trace)λ + det = 0.",
    source: from("axler", "5.1 Invariant Subspaces"),
    gen(level, r) {
      for (;;) {
        const l1 = r.int(-4, 6), l2 = r.int(-4, 6);
        if (l1 === l2) continue;
        const a = r.int(-3, 5), d = l1 + l2 - a;
        const bc = a * d - l1 * l2;
        if (bc === 0 && level >= 2) continue;
        const bs = []; for (let b = -6; b <= 6; b++) if (b && bc % b === 0) bs.push(b);
        if (!bs.length) continue;
        const b = r.pick(bs), c = bc / b;
        if (Math.abs(c) > 12) continue;
        const hi = Math.max(l1, l2);
        return {
          prompt: `What is the larger eigenvalue of $\\begin{pmatrix}${a} & ${b} \\\\ ${c} & ${d}\\end{pmatrix}$?`,
          answer: String(hi), params: { M: [[a, b], [c, d]] },
          steps: [`trace = ${a + d}, det = ${a * d - b * c}`, `λ² − ${a + d}λ + ${a * d - b * c} = 0`, `λ = ${l1}, ${l2}`],
          trick: "Sum of eigenvalues = trace, product = determinant: check your pair against both.",
          mistakes: wrong(String(hi), [
            { answer: String(Math.max(a, d)), why: "Diagonal entries are the eigenvalues only for triangular matrices." },
            { answer: String(a + d), why: "The trace is the sum of the eigenvalues." },
            { answer: String(a * d - b * c), why: "The determinant is their product." },
          ]),
        };
      }
    },
  });

  function rank(rows) {
    const A = rows.map((r) => [...r]);
    let rk = 0;
    for (let c = 0; c < A[0].length && rk < A.length; c++) {
      let piv = rk; while (piv < A.length && Math.abs(A[piv][c]) < 1e-9) piv++;
      if (piv === A.length) continue;
      [A[rk], A[piv]] = [A[piv], A[rk]];
      for (let i = 0; i < A.length; i++) if (i !== rk) {
        const f = A[i][c] / A[rk][c];
        for (let j = c; j < A[0].length; j++) A[i][j] -= f * A[rk][j];
      }
      rk++;
    }
    return rk;
  }

  def("linear algebra", ["axler:3.2"], {
    id: "la-rank-nullity", name: "Rank–nullity",
    blurb: "dim V = dim null T + dim range T.",
    source: from("axler", "3.2 Null Spaces and Ranges"),
    gen(level, r) {
      const n = r.int(2, band(level, [4, 5, 5, 6, 6])), m = r.int(2, band(level, [4, 4, 5, 5, 6]));
      if (level <= 2) {
        const rk = r.int(1, Math.min(n, m));
        return {
          prompt: `$T: \\mathbb{R}^{${n}} \\to \\mathbb{R}^{${m}}$ is linear and its range has dimension ${rk}. What is the dimension of its null space?`,
          answer: String(n - rk), params: { n, m, rk },
          steps: [`dim ℝ^${n} = dim null T + dim range T`, `${n} = null + ${rk} → ${n - rk}`],
          trick: "The domain's dimension splits between what T kills and what it hits.",
          mistakes: wrong(String(n - rk), [
            { answer: String(m - rk), why: "Rank–nullity is about the domain ℝⁿ, not the codomain." },
            { answer: String(rk), why: "That is the rank; the nullity is what's left of the domain." },
          ]),
        };
      }
      const k = r.int(1, Math.min(n, m) - 1);
      const B = Array.from({ length: m }, () => Array.from({ length: k }, () => r.int(-2, 3)));
      const C = Array.from({ length: k }, () => Array.from({ length: n }, () => r.int(-2, 3)));
      const A = B.map((row) => C[0].map((_, j) => row.reduce((s, x, t) => s + x * C[t][j], 0)));
      const rk = rank(A);
      const tex = `\\begin{pmatrix}${A.map((row) => row.join(" & ")).join(" \\\\ ")}\\end{pmatrix}`;
      return {
        prompt: `What is the dimension of the null space of $${tex}$ (as a map $\\mathbb{R}^{${n}} \\to \\mathbb{R}^{${m}}$)?`,
        answer: String(n - rk), params: { A },
        steps: [`row-reduce: rank = ${rk}`, `nullity = ${n} − ${rk} = ${n - rk}`],
        trick: "Count pivots; every non-pivot column is a free variable.",
        mistakes: wrong(String(n - rk), [
          { answer: String(m - rk), why: "Subtract from the number of columns (the domain), not rows." },
          { answer: String(rk), why: "That is the rank." },
          { answer: String(n - Math.min(n, m)), why: "The rank is the number of pivots, which can be less than min(m, n)." },
        ]),
      };
    },
  });

  def("linear algebra", ["axler:10.2", "axler:10.3"], {
    id: "la-trace-det", name: "Trace and determinant from eigenvalues",
    blurb: "Over ℂ, trace = sum and det = product of eigenvalues, with multiplicity.",
    source: from("axler", "10.2 Trace"),
    gen(level, r) {
      const n = band(level, [2, 3, 3, 4, 5]);
      const ev = Array.from({ length: n }, () => r.int(-3, 4));
      const tr = ev.reduce((a, b) => a + b, 0), det = ev.reduce((a, b) => a * b, 1);
      const askTr = r() < 0.5;
      const ans = String(askTr ? tr : det);
      const shown = ev.map((x) => `${x}`).join(", ");
      return {
        prompt: `An operator on $\\mathbb{C}^{${n}}$ has eigenvalues ${shown} (listed with multiplicity). What is its ${askTr ? "trace" : "determinant"}?`,
        answer: ans, params: { ev, ask: askTr ? "trace" : "det" },
        steps: [askTr ? `trace = ${ev.join(" + ")} = ${tr}` : `det = ${ev.map((x) => `(${x})`).join("·")} = ${det}`],
        trick: "Both are read off the characteristic polynomial's coefficients.",
        mistakes: wrong(ans, [
          { answer: String(askTr ? det : tr), why: askTr ? "That is the product (the determinant); trace is the sum." : "That is the sum (the trace); determinant is the product." },
          { answer: String(askTr ? [...new Set(ev)].reduce((a, b) => a + b, 0) : [...new Set(ev)].reduce((a, b) => a * b, 1)),
            why: "Repeated eigenvalues count once per multiplicity." },
        ]),
      };
    },
  });

  def("linear algebra", ["axler:6.4"], {
    id: "la-projection", name: "Orthogonal projection onto a line",
    blurb: "proj_u v = (⟨v, u⟩ / ⟨u, u⟩) u.",
    source: from("axler", "6.4 Orthogonal Projections and Minimization Problems"),
    gen(level, r) {
      const d = band(level, [2, 2, 3, 3, 4]);
      let u; do { u = Array.from({ length: d }, () => r.int(-3, 3)); } while (u.every((x) => !x));
      const v = Array.from({ length: d }, () => r.int(-4, 5));
      const vu = v.reduce((s, x, i) => s + x * u[i], 0), uu = u.reduce((s, x) => s + x * x, 0);
      const i = r.int(0, d - 1);
      const ans = fmtFrac(vu * u[i], uu);
      return {
        prompt: `Project $v = (${v.join(", ")})$ orthogonally onto the line spanned by $u = (${u.join(", ")})$. What is coordinate ${i + 1} of the projection?`,
        answer: ans, params: { u, v, i },
        steps: [`⟨v, u⟩ = ${vu}, ⟨u, u⟩ = ${uu}`, `proj = (${vu}/${uu})·u`, `coordinate ${i + 1}: ${ans}`],
        trick: "The projection is the closest point on the line: v − proj is orthogonal to u.",
        mistakes: wrong(ans, [
          { answer: String(vu * u[i]), why: "Divide by ⟨u, u⟩ = ‖u‖²: u isn't a unit vector." },
          { answer: fmt((vu * u[i]) / Math.sqrt(uu), 4), why: "Divide by ‖u‖², not ‖u‖." },
          { answer: fmtFrac(vu * v[i], v.reduce((s, x) => s + x * x, 0) || 1), why: "That projects u onto v; the roles are reversed." },
        ]),
      };
    },
  });

  // ==== complex analysis (Stein & Shakarchi) ===============================================

  def("complex analysis", ["stein:group:3_exercises"], {
    id: "ca-residue", name: "Residues and contour integrals",
    blurb: "At a simple pole p, Res = lim (z − p) f(z); ∮ f = 2πi Σ residues inside.",
    source: from("stein", "Ch. 3, Meromorphic Functions and the Logarithm"),
    gen(level, r) {
      for (;;) {
        const p = r.int(-3, 3), q = r.int(-3, 3), a = r.int(-4, 4);
        if (p === q || p + a === 0) continue;
        const res = (x, y) => fmtFrac(x + a, x - y);
        const f = `\\dfrac{z ${a < 0 ? "-" : "+"} ${Math.abs(a)}}{(z ${p < 0 ? "+" : "-"} ${Math.abs(p)})(z ${q < 0 ? "+" : "-"} ${Math.abs(q)})}`;
        if (level <= 2) {
          const ans = res(p, q);
          return {
            prompt: `What is the residue of $f(z) = ${f}$ at $z = ${p}$?`, answer: ans, params: { p, q, a, ask: "res" },
            steps: [`simple pole: Res = lim_{z→${p}} (z − ${p}) f(z)`, `= (${p} + ${a})/(${p} − ${q}) = ${ans}`],
            trick: "Cover up the vanishing factor and evaluate the rest.",
            mistakes: wrong(ans, [
              { answer: fmtFrac(-(p + a), p - q), why: "Sign slip: the remaining factor is (p − q), not (q − p)." },
              { answer: res(q, p), why: `That is the residue at the other pole, z = ${q}.` },
              { answer: fmtFrac(1, p - q), why: `The numerator z + ${a} must be evaluated at the pole too.` },
            ]),
          };
        }
        const R = r.pick([0.5, 1.5, 2.5, 3.5]);
        const inside = [p, q].filter((x) => Math.abs(x) < R);
        if (!inside.length) continue;
        // ∮ = 2πi Σ Res = kπi. Res(p) = (p+a)/(p−q), Res(q) = (q+a)/(q−p), and they sum to 1.
        const other = (x) => (x === p ? q : p);
        const k2 = inside.length === 2 ? "2" : fmtFrac(2 * (inside[0] + a), inside[0] - other(inside[0]));
        const k1 = inside.length === 2 ? "1" : fmtFrac(inside[0] + a, inside[0] - other(inside[0]));
        return {
          prompt: `$\\oint_{|z| = ${R}} ${f}\\,dz = k\\pi i$. What is $k$?`, answer: k2, params: { p, q, a, R, ask: "contour" },
          steps: [`poles at ${p} and ${q}; inside |z| = ${R}: ${inside.join(", ")}`, `∮ = 2πi × (sum of residues inside)`, `k = ${k2}`],
          trick: "Only the poles inside the contour count.",
          mistakes: wrong(k2, [
            { answer: k1, why: "The integral is 2πi times the residue sum: don't drop the 2." },
            ...(inside.length === 1 ? [{ answer: "2", why: `Only poles inside |z| = ${R} count; ${other(inside[0])} is outside.` }] : []),
            ...(inside.length === 2 ? [{ answer: fmtFrac(2 * (p + a), p - q), why: "Both poles are inside the contour; add both residues." }] : []),
          ]),
        };
      }
    },
  });

  def("complex analysis", ["stein:group:3_exercises"], {
    id: "ca-radius", name: "Radius of convergence",
    blurb: "1/R = lim sup |cₙ|^{1/n}.",
    source: from("stein", "Ch. 1, Preliminaries to Complex Analysis"),
    gen(level, r) {
      const c = r.pick([2, 3, 4, 5]);
      const k = r.int(0, 3);
      const fam = r.pick(band(level, [["geo"], ["geo", "inv"], ["geo", "inv", "even"], ["inv", "even"], ["even", "inv"]]));
      const cases = {
        geo: [`\\sum_{n\\ge0} \\frac{${k ? `n^{${k}}` : "1"}}{${c}^n} z^n`, String(c)],
        inv: [`\\sum_{n\\ge0} ${c}^n ${k ? `n^{${k}}` : ""} z^n`, fmtFrac(1, c)],
        even: [`\\sum_{n\\ge0} \\frac{z^{2n}}{${c * c}^n}`, String(c)],
      };
      const [tex, ans] = cases[fam];
      return {
        prompt: `What is the radius of convergence of $${tex}$?`, answer: ans, params: { fam, c, k },
        steps: [`Hadamard: 1/R = lim sup |cₙ|^{1/n}`, `polynomial factors nᵏ have nᵏ^{1/n} → 1`, `R = ${ans}`],
        trick: "Polynomial factors never change the radius.",
        mistakes: wrong(ans, [
          { answer: ans === String(c) ? fmtFrac(1, c) : String(c), why: "R is the reciprocal of lim sup |cₙ|^{1/n}." },
          { answer: String(c * c), why: fam === "even" ? "The series is in z², so |z|² < c² gives |z| < c." : "Take the n-th root of the coefficient, not the coefficient." },
        ]),
      };
    },
  });

  // ==== probability (Blitzstein & Hwang) ====================================================

  def("probability", ["blitzstein:2.3"], {
    id: "pr-bayes-test", name: "Bayes and the base rate",
    blurb: "P(D | +) = P(+ | D)P(D) / P(+), and P(+) includes false positives.",
    source: from("blitzstein", "2.3 Bayes' rule and the law of total probability"),
    gen(level, r) {
      const prev = r.pick(band(level, [[0.1, 0.2], [0.05, 0.1], [0.01, 0.02, 0.05], [0.005, 0.01], [0.001, 0.002]]));
      const sens = r.pick([0.9, 0.95, 0.99]), spec = r.pick([0.9, 0.95, 0.99]);
      const post = (sens * prev) / (sens * prev + (1 - spec) * (1 - prev));
      return {
        prompt: `A condition affects ${prev * 100}% of people. A test catches it ${sens * 100}% of the time and gives a false positive `
          + `${fmt((1 - spec) * 100, 2)}% of the time. Given a positive test, what is the probability of having the condition?`,
        answer: fmt(post, 4), tolerance: 0.005, params: { prev, sens, spec },
        steps: [`P(+) = ${sens}·${prev} + ${fmt(1 - spec, 2)}·${fmt(1 - prev, 3)} = ${fmt(sens * prev + (1 - spec) * (1 - prev), 5)}`,
                `P(D | +) = ${fmt(sens * prev, 5)}/${fmt(sens * prev + (1 - spec) * (1 - prev), 5)} = ${fmt(post, 4)}`],
        trick: "When the condition is rare, most positives are false positives.",
        mistakes: wrong(fmt(post, 4), [
          { answer: fmt(sens, 4), why: "That is P(+ | D). Bayes turns it around, and the base rate matters." },
          { answer: fmt(sens * prev, 4), why: "Divide by P(+), which includes the false positives from the healthy majority." },
          { answer: fmt(1 - (1 - spec), 4), why: "That is the specificity, P(− | no condition)." },
        ]),
      };
    },
  });

  def("probability", ["blitzstein:4.4", "blitzstein:4.2"], {
    id: "pr-indicators", name: "Expectation by indicators",
    blurb: "Write the count as a sum of indicators; add their probabilities.",
    source: from("blitzstein", "4.4 Indicator r.v.s and the fundamental bridge"),
    gen(level, r) {
      const fam = r.pick(band(level, [["empty"], ["empty", "pairs"], ["distinct", "pairs"], ["distinct", "empty"], ["distinct", "pairs", "empty"]]));
      if (fam === "empty") {
        const n = r.int(2, band(level, [4, 6, 10, 20, 30])), k = r.int(2, band(level, [4, 6, 8, 10, 12]));
        const e = k * (1 - 1 / k) ** n;
        return {
          prompt: `${n} balls are dropped independently and uniformly into ${k} boxes. What is the expected number of empty boxes?`,
          answer: fmt(e, 4), tolerance: 0.002, params: { fam, n, k },
          steps: [`Iᵢ = 1 if box i is empty: P = (1 − 1/${k})^${n}`, `E = ${k}·(1 − 1/${k})^${n} = ${fmt(e, 4)}`],
          trick: "Indicators don't need independence: linearity of expectation always holds.",
          mistakes: wrong(fmt(e, 4), [
            { answer: fmt((1 - 1 / k) ** n, 4), why: "That is one box's chance of being empty; there are k boxes." },
            { answer: fmt(Math.max(0, k - n), 4), why: "Balls can share boxes, so even n ≥ k leaves some boxes empty on average." },
            { answer: fmt(k * (1 / k) ** n, 4), why: "A box is empty when every ball misses it: (1 − 1/k)ⁿ, not (1/k)ⁿ." },
          ]),
        };
      }
      if (fam === "pairs") {
        const n = r.int(5, 40), d = 365;
        const e = (n * (n - 1)) / 2 / d;
        return {
          prompt: `Among ${n} people with independent uniform birthdays over 365 days, what is the expected number of pairs sharing a birthday?`,
          answer: fmt(e, 4), tolerance: 0.002, params: { fam, n, d },
          steps: [`C(${n}, 2) = ${(n * (n - 1)) / 2} pairs`, `each matches with probability 1/365`, `E = ${fmt(e, 4)}`],
          trick: "Pairs grow like n²: that's why birthday matches come early.",
          mistakes: wrong(fmt(e, 4), [
            { answer: fmt(n / d, 4), why: "Count pairs of people, C(n, 2), not people." },
            { answer: fmt((n * n) / d, 4), why: "Ordered pairs count each pair twice and include self-pairs." },
          ]),
        };
      }
      const n = r.int(3, 30), d = r.pick([12, 20, 52, 365]);
      const e = d * (1 - (1 - 1 / d) ** n);
      return {
        prompt: `${n} values are drawn independently and uniformly from ${d} possibilities. What is the expected number of distinct values seen?`,
        answer: fmt(e, 4), tolerance: 0.002, params: { fam, n, d },
        steps: [`Iⱼ = 1 if value j appears: P = 1 − (1 − 1/${d})^${n}`, `E = ${d}·(1 − (1 − 1/${d})^${n}) = ${fmt(e, 4)}`],
        trick: "Count the values, not the draws.",
        mistakes: wrong(fmt(e, 4), [
          { answer: String(Math.min(n, d)), why: "Draws can repeat, so fewer distinct values appear on average." },
          { answer: fmt(d * (1 - 1 / d) ** n, 4), why: "That is the expected number of values *not* seen." },
        ]),
      };
    },
  });

  // ==== proofs =================================================================================

  def("real analysis", ["tao:4.4", "herstein:1.5"], {
    id: "ra-proof-sqrt", name: "Proof: √p is irrational",
    blurb: "Assume a fraction in lowest terms; show the prime divides both parts.",
    source: from("tao", "4.4 Gaps in the rational numbers"),
    gen(level, r) {
      const p = r.pick(band(level, [[2, 3], [3, 5], [5, 7, 11], [7, 11, 13], [11, 13, 17]]));
      return proof(level, r, {
        statement: `Prove that $\\sqrt{${p}}$ is irrational.`,
        steps: [
          { id: "s1", text: `Suppose $\\sqrt{${p}} = a/b$ with positive integers $a, b$ and $\\gcd(a, b) = 1$.` },
          { id: "s2", text: `Then $a^2 = ${p}b^2$.` },
          { id: "s3", text: `So ${p} divides $a^2$, and since ${p} is prime, ${p} divides $a$.` },
          { id: "s4", text: `Write $a = ${p}k$. Then $${p * p}k^2 = ${p}b^2$, so $b^2 = ${p}k^2$.` },
          { id: "s5", text: `So ${p} divides $b^2$, and hence ${p} divides $b$.` },
          { id: "s6", text: `Then ${p} divides both $a$ and $b$, contradicting $\\gcd(a, b) = 1$.` },
        ],
        extras: [
          { id: "x1", text: `So $a^2$ divides ${p}.`, why: "Divisibility runs the other way: a² = p·b² means p divides a²." },
          { id: "x2", text: `Since $a^2 = ${p}b^2$, we get $a = ${p}b$.`, why: `Taking square roots gives a = √${p}·b, which is what we're testing.` },
          { id: "x3", text: `Suppose $\\sqrt{${p}} = a/b$ for some integers $a, b$.`, why: "Without lowest terms (gcd(a, b) = 1) there is nothing to contradict." },
          ...(p !== 2 ? [{ id: "x4", text: `So $a$ is even.`, why: `Evenness is the p = 2 case; here the prime is ${p}.` }] : []),
        ],
      });
    },
  });

  const SUMS = [
    { f: "i", F: "n(n+1)/2", Ft: "\\tfrac{n(n+1)}{2}", at: (n) => (n * (n + 1)) / 2, fi: (k) => `${k}` },
    { f: "(2i-1)", F: "n^2", Ft: "n^2", at: (n) => n * n, fi: (k) => `${2 * k - 1}` },
    { f: "i^2", F: "n(n+1)(2n+1)/6", Ft: "\\tfrac{n(n+1)(2n+1)}{6}", at: (n) => (n * (n + 1) * (2 * n + 1)) / 6 },
    { f: "i^3", F: "(n(n+1)/2)^2", Ft: "\\left(\\tfrac{n(n+1)}{2}\\right)^2", at: (n) => ((n * (n + 1)) / 2) ** 2 },
  ];

  def("real analysis", ["tao:2.2", "herstein:1.6", "andrews:1.1"], {
    id: "ra-proof-induction", name: "Proof by induction: a sum formula",
    blurb: "Base case; assume for k; add the (k+1)-th term; simplify to the formula at k + 1.",
    source: from("andrews", "1-1 Principle of Mathematical Induction"),
    gen(level, r) {
      let s;
      if (level >= 3 && r() < 0.5) {
        const q = r.int(2, 5);
        s = { f: `${q}^{i}`, Ft: `\\tfrac{${q}^{n+1} - ${q}}{${q - 1}}`, at: (n) => (q ** (n + 1) - q) / (q - 1) };
      } else s = r.pick(SUMS);
      const f = s.f;
      return proof(level, r, {
        statement: `Prove that $\\sum_{i=1}^{n} ${f} = ${s.Ft}$ for every $n \\ge 1$.`,
        steps: [
          { id: "s1", text: `Base case $n = 1$: both sides equal ${s.at(1)}.` },
          { id: "s2", text: `Assume the formula holds for some $n = k \\ge 1$.`, after: [] },
          { id: "s3", text: `Then $\\sum_{i=1}^{k+1} ${f} = \\sum_{i=1}^{k} ${f} + (\\text{the } (k{+}1)\\text{-th term})$.`, after: ["s2"] },
          { id: "s4", text: `By the assumption, that is $${s.Ft.replace(/n/g, "k")}$ plus the $(k{+}1)$-th term, which simplifies to $${s.Ft.replace(/n/g, "(k+1)")}$.`, after: ["s3"] },
          { id: "s5", text: `So the formula holds for $k + 1$, and by induction for every $n \\ge 1$.`, after: ["s1", "s4"] },
        ],
        extras: [
          { id: "x1", text: `Assume the formula holds for every $n$.`, why: "That assumes what we're proving. Assume it for one k, then derive k + 1." },
          { id: "x2", text: `Check $n = 2$ and $n = 3$ as well; the pattern continues.`, why: "Checking cases shows a pattern; it doesn't prove it for all n." },
          { id: "x3", text: `Then $\\sum_{i=1}^{k+1} ${f} = ${s.Ft.replace(/n/g, "(k+1)")}$ by the assumption.`, why: "The assumption is about k terms, not k + 1: that's the thing to prove." },
        ],
      });
    },
  });

  def("real analysis", ["tao:9.4"], {
    id: "ra-proof-continuity", name: "Proof: a linear function is continuous",
    blurb: "Fix ε; choose δ from ε; show |x − c| < δ forces |f(x) − f(c)| < ε.",
    source: from("tao", "9.4 Continuous functions"),
    gen(level, r) {
      const a = r.pick([2, 3, 5, -4, 7]), b = r.int(-5, 5);
      const A = Math.abs(a);
      return proof(level, r, {
        statement: `Prove that $f(x) = ${a}x ${b < 0 ? "-" : "+"} ${Math.abs(b)}$ is continuous at every $c \\in \\mathbb{R}$.`,
        steps: [
          { id: "s1", text: `Let $c \\in \\mathbb{R}$ and $\\varepsilon > 0$.` },
          { id: "s2", text: `Choose $\\delta = \\varepsilon / ${A}$.` },
          { id: "s3", text: `Suppose $|x - c| < \\delta$.` },
          { id: "s4", text: `Then $|f(x) - f(c)| = ${A}\\,|x - c|$.` },
          { id: "s5", text: `$< ${A}\\,\\delta = \\varepsilon$, so $f$ is continuous at $c$.` },
        ],
        extras: [
          { id: "x1", text: `Choose $\\delta = ${A}\\varepsilon$.`, why: `Then ${A}·|x − c| < ${A * A}ε, which is too big.` },
          { id: "x2", text: `Suppose $|f(x) - f(c)| < \\varepsilon$.`, why: "That's the conclusion; the hypothesis is |x − c| < δ." },
          { id: "x3", text: `Let $\\delta > 0$.`, why: "δ isn't given: it has to be chosen, from ε." },
        ],
      });
    },
  });

  def("abstract algebra", ["herstein:2.4", "andrews:5.1"], {
    id: "aa-proof-fermat", name: "Proof: Fermat's little theorem from Lagrange",
    blurb: "The units mod p form a group of order p − 1; orders divide it.",
    source: from("herstein", "2.4 Lagrange's Theorem"),
    gen(level, r) {
      const p = r.pick([5, 7, 11, 13, 17]);
      return proof(level, r, {
        statement: `Let $p = ${p}$ and let $a$ be an integer not divisible by ${p}. Prove $a^{${p - 1}} \\equiv 1 \\pmod{${p}}$.`,
        steps: [
          { id: "s1", text: `The nonzero residues mod ${p} form a group under multiplication, of order ${p - 1}.` },
          { id: "s2", text: `Since ${p} does not divide $a$, the residue of $a$ is in this group.` },
          { id: "s3", text: `By Lagrange's theorem, the order $d$ of $a$ divides ${p - 1}.` },
          { id: "s4", text: `So $a^{${p - 1}} = (a^{d})^{${p - 1}/d} \\equiv 1^{${p - 1}/d} = 1 \\pmod{${p}}$.` },
        ],
        extras: [
          { id: "x1", text: `The order of $a$ is ${p - 1}.`, why: "Not necessarily: Lagrange only says it divides p − 1." },
          { id: "x2", text: `Since ${p} is prime, $a^{${p}} \\equiv 0 \\pmod{${p}}$.`, why: `${p} doesn't divide a, so it divides no power of a.` },
          { id: "x3", text: `The residues mod ${p} form a group under multiplication, of order ${p}.`, why: "0 has no inverse; only the p − 1 nonzero residues form a group." },
        ],
      });
    },
  });

  def("real analysis", ["tao:6.1"], {
    id: "ra-proof-unique-limit", name: "Proof: limits are unique",
    blurb: "Take ε = |L − M|/2 and let the triangle inequality collide.",
    source: from("tao", "6.1 Convergence and limit laws"),
    gen(level, r) {
      const s = r.pick(["a", "x", "b"]);
      return proof(level, r, {
        statement: `Prove that a sequence $(${s}_n)$ has at most one limit.`,
        steps: [
          { id: "s1", text: `Suppose $${s}_n \\to L$ and $${s}_n \\to M$ with $L \\ne M$.` },
          { id: "s2", text: `Let $\\varepsilon = |L - M|/2 > 0$.` },
          { id: "s3", text: `For all large $n$, $|${s}_n - L| < \\varepsilon$ and $|${s}_n - M| < \\varepsilon$.` },
          { id: "s4", text: `Then $|L - M| \\le |L - ${s}_n| + |${s}_n - M| < 2\\varepsilon = |L - M|$.` },
          { id: "s5", text: `This is a contradiction, so $L = M$.` },
        ],
        extras: [
          { id: "x1", text: `Let $\\varepsilon = |L - M|$.`, why: "Then you only get |L − M| < 2|L − M|, which is no contradiction." },
          { id: "x2", text: `For every $n$, $|${s}_n - L| < \\varepsilon$.`, why: "Convergence only controls the tail: for n beyond some N." },
          { id: "x3", text: `So $L - M = 0$ because both are limits.`, why: "That restates the claim instead of proving it." },
        ],
      });
    },
  });

  // ==== estimation (Mahajan, Street-Fighting Mathematics; CC BY-NC-SA 3.0) =============
  // Estimates are checked deterministically too: a computed exact value, and a
  // tolerance (`factor`, or a relative `tolerance`) that says what "close" means.

  // Dimensions as exponents of (M, L, T).
  const DIMS = [
    { what: "the period $T$ of a pendulum of length $L$ in gravity $g$", out: "T", ins: ["L", "g"], sol: [[1, 2], [-1, 2]] },
    { what: "the speed $v$ of deep-water waves of wavelength $\\lambda$ in gravity $g$", out: "v", ins: ["g", "\\lambda"], sol: [[1, 2], [1, 2]] },
    { what: "the drag force $F$ on an object of area $A$ moving at speed $v$ through fluid of density $\\rho$", out: "F", ins: ["\\rho", "v", "A"], sol: [[1, 1], [2, 1], [1, 1]] },
    { what: "the escape speed $v$ from a planet of mass $M$ and radius $R$, with gravitational constant $G$", out: "v", ins: ["G", "M", "R"], sol: [[1, 2], [1, 2], [-1, 2]] },
    { what: "the speed $v$ of capillary waves with surface tension $\\sigma$, density $\\rho$ and wavelength $\\lambda$", out: "v", ins: ["\\sigma", "\\rho", "\\lambda"], sol: [[1, 2], [-1, 2], [-1, 2]] },
    { what: "the time $t$ to fall a height $h$ in gravity $g$", out: "t", ins: ["h", "g"], sol: [[1, 2], [-1, 2]] },
  ];

  def("estimation", ["mahajan:ch1"], {
    id: "sf-dimensions", name: "Dimensional analysis",
    blurb: "Match the powers of mass, length and time on both sides.",
    source: from("mahajan", "Ch. 1, Dimensions"),
    gen(level, r) {
      const d = r.pick(DIMS.slice(0, band(level, [2, 3, 4, 6, 6])));
      const i = r.int(0, d.ins.length - 1);
      const [n, den] = d.sol[i];
      const ans = fmtFrac(n, den);
      const others = d.sol.filter((_, j) => j !== i).map(([a, b]) => fmtFrac(a, b));
      return {
        prompt: `Dimensional analysis says ${d.what} is $C \\cdot ${d.ins.map((x, j) => `${x}^{e_${j + 1}}`).join(" ")}$ for a `
          + `dimensionless constant $C$. What is the exponent $e_${i + 1}$ of $${d.ins[i]}$?`,
        answer: ans, params: { which: DIMS.indexOf(d), i },
        steps: [`write each quantity in powers of mass, length and time`,
                `match the powers on both sides: one equation per dimension`,
                `solution: ${d.ins.map((x, j) => `${x.replace(/\\/g, "")}^(${fmtFrac(...d.sol[j])})`).join(" · ")}`],
        trick: "Dimensions can't tell you C, but they pin down every exponent here.",
        mistakes: wrong(ans, [
          { answer: fmtFrac(-n, den), why: "Sign slip: recheck which side each power of time (or length) sits on." },
          ...others.filter((o) => o !== ans).slice(0, 1).map((o) => ({ answer: o, why: "That is another quantity's exponent." })),
          { answer: String(Math.round(n / den) || (n > 0 ? 1 : -1)), why: "Square roots are common: the exponents needn't be integers." },
        ]),
      };
    },
  });

  // Frustum of a cone: which formula survives the easy cases?
  const FRUSTUM = [
    { tex: "\\tfrac{\\pi h}{3}(r_1^2 + r_1 r_2 + r_2^2)", f: (a, b, h) => (Math.PI * h * (a * a + a * b + b * b)) / 3 },
    { tex: "\\tfrac{\\pi h}{2}(r_1^2 + r_2^2)", f: (a, b, h) => (Math.PI * h * (a * a + b * b)) / 2 },
    { tex: "\\pi h\\, r_1 r_2", f: (a, b, h) => Math.PI * h * a * b },
    { tex: "\\tfrac{\\pi h}{4}(r_1 + r_2)^2", f: (a, b, h) => (Math.PI * h * (a + b) ** 2) / 4 },
    { tex: "\\tfrac{\\pi h}{3}(r_1^2 + r_2^2)", f: (a, b, h) => (Math.PI * h * (a * a + b * b)) / 3 },
    { tex: "\\tfrac{\\pi h}{3}(r_1 + r_2)^2", f: (a, b, h) => (Math.PI * h * (a + b) ** 2) / 3 },
  ];
  /** Which easy case a candidate fails, found by trying it. */
  function easyCaseFailure(c) {
    const cone = c.f(3, 0, 2), wantCone = (Math.PI * 9 * 2) / 3;
    if (Math.abs(cone - wantCone) > 1e-9) return `Try the easy case $r_2 = 0$, a cone: it gives $${fmt(cone / Math.PI, 3)}\\pi$ for $r_1 = 3, h = 2$, but a cone has volume $\\tfrac{1}{3}\\pi r_1^2 h = 6\\pi$.`;
    const cyl = c.f(3, 3, 2), wantCyl = Math.PI * 9 * 2;
    if (Math.abs(cyl - wantCyl) > 1e-9) return `Try the easy case $r_1 = r_2$, a cylinder: it gives $${fmt(cyl / Math.PI, 3)}\\pi$ for $r = 3, h = 2$, but a cylinder has volume $\\pi r^2 h = 18\\pi$.`;
    return null;
  }

  def("estimation", ["mahajan:ch2"], {
    id: "sf-easy-cases", name: "Easy cases",
    blurb: "A formula must survive its special cases: check them before trusting it.",
    source: from("mahajan", "Ch. 2, Easy cases"),
    gen(level, r) {
      const [right, ...rest] = FRUSTUM;
      const wrongs = shuffle(rest, r).slice(0, 3);
      if (level <= 3) {
        return {
          prompt: `A frustum (a cone with its tip cut off) has height $h$ and end radii $r_1$ and $r_2$. `
            + `Which formula for its volume survives the easy cases?`,
          answer: `$V = ${right.tex}$`, format: "choice", params: { ask: "formula" },
          steps: ["r₂ = 0 must give a cone, ⅓πr₁²h", "r₁ = r₂ must give a cylinder, πr²h", "only one candidate passes both"],
          trick: "Easy cases can't prove a formula right, but they prove most wrong ones wrong, fast.",
          mistakes: wrongs.map((c) => ({ answer: `$V = ${c.tex}$`, why: easyCaseFailure(c) })),
        };
      }
      const a = r.int(2, 6), b = r.int(1, a - 1), h = r.int(2, 9);
      const v = right.f(a, b, h);
      return {
        prompt: `A frustum has height ${h} and end radii ${a} and ${b}. What is its volume? (Find the formula with easy cases first.)`,
        answer: fmt(v, 3), tolerance: 0.002, params: { ask: "volume", a, b, h },
        steps: [`V = πh(r₁² + r₁r₂ + r₂²)/3`, `= π·${h}·(${a * a} + ${a * b} + ${b * b})/3 = ${fmt(v, 3)}`],
        trick: "The formula that passes the cone and cylinder cases is the right one here.",
        mistakes: wrongs.map((c) => ({ answer: fmt(c.f(a, b, h), 3), why: easyCaseFailure(c) })),
      };
    },
  });

  def("estimation", ["mahajan:ch3"], {
    id: "sf-lumping", name: "Lumping a Gaussian",
    blurb: "Replace the curve by a rectangle: peak height × width where it drops to 1/e.",
    source: from("mahajan", "Ch. 3, Lumping"),
    gen(level, r) {
      const a = r.pick(band(level, [[1, 4], [1, 4, 9], [2, 3, 0.25], [5, 0.5, 16], [0.01, 100, 7]]));
      const exact = Math.sqrt(Math.PI / a);
      const lump = 2 / Math.sqrt(a);
      return {
        prompt: `Estimate $\\int_{-\\infty}^{\\infty} e^{-${a}x^2}\\,dx$ by lumping: a rectangle as tall as the peak and as wide `
          + `as the region where the curve is above $1/e$. Any answer within a factor of 2 of the true value counts.`,
        answer: fmt(lump, 4), factor: 2, params: { a },
        steps: [`peak height 1 (at x = 0)`, `e^{−${a}x²} = 1/e at x = ±1/√${a}: width 2/√${a}`,
                `estimate ${fmt(lump, 4)}; exact √(π/${a}) = ${fmt(exact, 4)}`],
        trick: "Lumping gets within about 15% here, and needs no calculus.",
        mistakes: wrong(fmt(lump, 4), [
          { answer: fmt(2 / a, 4), why: "The width comes from x² = 1/a, so it scales like 1/√a, not 1/a." },
          { answer: fmt(2 * Math.sqrt(a), 4), why: "A larger a makes the curve narrower: the width is 2/√a." },
          { answer: fmt(1 / Math.sqrt(a) / 10, 4), why: "Take the width where the curve falls to 1/e, not where it is nearly 0." },
        ]),
      };
    },
  });

  def("estimation", ["mahajan:ch4"], {
    id: "sf-pictorial", name: "Pictorial proofs: the best rectangle",
    blurb: "Among rectangles with a fixed perimeter, the square has the most area (AM ≥ GM).",
    source: from("mahajan", "Ch. 4, Pictorial proofs"),
    gen(level, r) {
      const river = level >= 3 && r() < 0.5;
      const P = 4 * r.int(3, band(level, [10, 25, 50, 100, 250]));
      const area = river ? fmtFrac(P * P, 8) : fmtFrac(P * P, 16);
      return {
        prompt: river
          ? `You have ${P} m of fence to enclose a rectangle along a straight river (no fence on the river side). What is the largest area you can enclose, in m²?`
          : `A rectangle has perimeter ${P}. What is the largest area it can have?`,
        answer: area, params: { P, river },
        steps: river
          ? [`sides x, x and y with 2x + y = ${P}`, `reflect across the river: a ${2 * P}-perimeter rectangle, best as a square`,
             `x = ${P / 4}, y = ${P / 2}: area ${area}`]
          : [`sides x and ${P / 2} − x`, `the picture of (x + y)² ≥ 4xy: area is largest when x = y`, `square of side ${P / 4}: area ${area}`],
        trick: "AM–GM in one picture: a square fits inside the square of the sum.",
        mistakes: wrong(area, [
          { answer: fmtFrac(P * P, river ? 16 : 4), why: river ? "That fences all four sides; the river side is free." : "That squares half the perimeter; each side is a quarter of it." },
          { answer: fmtFrac(P * P, river ? 9 : 8), why: river ? "Three equal sides isn't optimal: the side along the river should be twice the others." : "The best rectangle is a square, not a 2:1 one." },
        ]),
      };
    },
  });

  def("estimation", ["mahajan:ch5"], {
    id: "sf-big-part", name: "Taking out the big part",
    blurb: "√(n² + d) ≈ n + d/(2n); (1 + x)ᵐ ≈ 1 + mx for small x.",
    source: from("mahajan", "Ch. 5, Taking out the big part"),
    gen(level, r) {
      if (level <= 2 || r() < 0.5) {
        const n = r.int(band(level, [5, 10, 20, 30, 50]), band(level, [15, 30, 60, 100, 300]));
        const d = r.int(1, Math.max(2, Math.floor(n / 3))) * r.sign();
        const est = n + d / (2 * n);
        return {
          prompt: `Without a calculator, estimate $\\sqrt{${n * n + d}}$ to within 0.2%.`,
          answer: fmt(est, 4), tolerance: 0.002, params: { n, d, ask: "sqrt" },
          steps: [`${n * n + d} = ${n}² ${d < 0 ? "−" : "+"} ${Math.abs(d)}`, `√(n² + d) = n√(1 + d/n²) ≈ n(1 + d/(2n²))`,
                  `≈ ${n} ${d < 0 ? "−" : "+"} ${Math.abs(d)}/${2 * n} = ${fmt(est, 4)}`],
          trick: "Take out the big part (n²), then approximate the small correction.",
          mistakes: wrong(fmt(est, 4), [
            { answer: fmt(n + d / n, 4), why: "√(1 + ε) ≈ 1 + ε/2: the correction is halved." },
            { answer: String(n), why: "Dropping the correction misses by more than 0.2% here." },
          ].filter((m) => Math.abs(Number(m.answer) - Math.sqrt(n * n + d)) / Math.sqrt(n * n + d) > 0.002)),
        };
      }
      const x = r.pick([0.01, 0.02, 0.03]), m = r.int(2, 6);
      const est = 1 + m * x;
      return {
        prompt: `Estimate $${fmt(1 + x, 2)}^{${m}}$ to within 1%.`,
        answer: fmt(est, 4), tolerance: 0.01, params: { x, m, ask: "power" },
        steps: [`(1 + x)^m ≈ 1 + mx for small x`, `1 + ${m}·${x} = ${fmt(est, 4)}`, `exact: ${fmt((1 + x) ** m, 5)}`],
        trick: "The next term, C(m,2)x², is what the 1% allows for.",
        mistakes: wrong(fmt(est, 4), [
          { answer: fmt(1 + x, 4), why: "The small change is multiplied by the exponent: 1 + mx." },
          { answer: fmt(1 + x ** m, 4), why: "Raise (1 + x), not x, to the power: to first order that's 1 + mx." },
        ]),
      };
    },
  });

  def("estimation", ["mahajan:ch6"], {
    id: "sf-analogy", name: "Analogy: cutting a cake",
    blurb: "n cuts give at most C(n,0) + C(n,1) + … + C(n,d) pieces in d dimensions.",
    source: from("mahajan", "Ch. 6, Analogy"),
    gen(level, r) {
      const d = r.pick(band(level, [[1, 2], [2], [2, 3], [3], [3]]));
      const n = r.int(2, band(level, [5, 6, 8, 10, 15]));
      const C = (a, b) => { let x = 1; for (let i = 1; i <= b; i++) x = (x * (a - b + i)) / i; return Math.round(x); };
      const pieces = Array.from({ length: d + 1 }, (_, i) => C(n, i)).reduce((a, b) => a + b, 0);
      const what = { 1: `a line cut at ${n} points`, 2: `a pancake cut by ${n} straight lines`, 3: `a cake cut by ${n} flat planes` }[d];
      return {
        prompt: `What is the largest number of pieces you can get from ${what}?`,
        answer: String(pieces), params: { n, d },
        steps: [`build the answer by analogy from lower dimensions`,
                `pieces(n, d) = pieces(n−1, d) + pieces(n−1, d−1)`, `= ${Array.from({ length: d + 1 }, (_, i) => `C(${n},${i})`).join(" + ")} = ${pieces}`],
        trick: "Each new cut is itself a (d−1)-dimensional cutting problem.",
        mistakes: wrong(String(pieces), [
          { answer: String(2 ** n), why: "Doubling each time only works while every cut crosses every piece, which stops at n = d." },
          ...(d >= 2 ? [{ answer: String(Array.from({ length: d }, (_, i) => C(n, i)).reduce((a, b) => a + b, 0)),
            why: `That is the answer one dimension lower (d = ${d - 1}).` }] : []),
          { answer: String(n + 1), why: "That is the one-dimensional answer, a line cut at n points." },
        ]),
      };
    },
  });
})();
