// Problem generators: deterministic, seeded, and graded into levels.
//
// Every generator takes (level, rng) and returns a problem with its answer, the
// steps to get there, and the trick worth internalising. Seeded so a given
// (skill, level, seed) always produces the same problem — a drill can be shared,
// replayed, or regression-tested.
//
// Works as a browser global (window.MathGen) and as a CommonJS module for the CLI.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MathGen = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- seeded RNG (mulberry32) -------------------------------------------
  function rngFrom(seed) {
    let a = seed >>> 0;
    const next = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.pick = (arr) => arr[next.int(0, arr.length - 1)];
    next.sign = () => (next() < 0.5 ? -1 : 1);
    return next;
  }

  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const digits = (n) => String(Math.abs(n)).split("").map(Number);
  const digitSum = (n) => digits(n).reduce((a, b) => a + b, 0);
  const fmtFrac = (n, d) => {
    const g = gcd(n, d) || 1;
    n /= g; d /= g;
    if (d < 0) { n = -n; d = -d; }
    return d === 1 ? String(n) : `${n}/${d}`;
  };
  const range = (lo, hi) => [lo, hi];

  // Level -> operand size. Each generator reads what it needs from here.
  const band = (level, bands) => bands[Math.min(level, bands.length) - 1];

  const G = {};
  const def = (g) => { G[g.id] = g; return g; };

  // ---- arithmetic ---------------------------------------------------------

  def({
    id: "add-chain", name: "Adding a chain", domain: "arithmetic",
    blurb: "Left to right, rounding to friendly numbers as you go.",
    gen(level, r) {
      const [lo, hi] = band(level, [range(2, 20), range(10, 99), range(10, 99),
                                    range(100, 999), range(100, 9999)]);
      const n = band(level, [2, 2, 3, 3, 4]);
      const xs = Array.from({ length: n }, () => r.int(lo, hi));
      const total = xs.reduce((a, b) => a + b, 0);
      let acc = xs[0];
      const steps = xs.slice(1).map((x) => `${acc} + ${x} = ${(acc += x)}`);
      return {
        prompt: xs.join(" + "), answer: String(total), steps,
        trick: "Add the big parts first, then the leftovers.",
      };
    },
  });

  def({
    id: "subtract", name: "Subtraction", domain: "arithmetic",
    blurb: "Count up from the smaller number instead of borrowing.",
    gen(level, r) {
      const [lo, hi] = band(level, [range(10, 50), range(20, 99), range(100, 999),
                                    range(1000, 9999), range(10000, 99999)]);
      const b = r.int(lo, hi), a = r.int(b + 1, hi + lo);
      return {
        prompt: `${a} − ${b}`, answer: String(a - b),
        steps: [`${b} + ${a - b} = ${a}`],
        trick: "Counting up avoids borrowing entirely.",
      };
    },
  });

  def({
    id: "multiply", name: "Multiplication", domain: "arithmetic",
    blurb: "Split one factor into parts you can handle.",
    gen(level, r) {
      const specs = [[2, 9, 2, 9], [10, 99, 2, 9], [10, 99, 11, 19],
                     [10, 99, 10, 99], [100, 999, 10, 99]];
      const [alo, ahi, blo, bhi] = band(level, specs);
      const a = r.int(alo, ahi), b = r.int(blo, bhi);
      const tens = Math.floor(b / 10) * 10, ones = b % 10;
      const steps = tens
        ? [`${a}×${tens} = ${a * tens}`, `${a}×${ones} = ${a * ones}`,
           `${a * tens} + ${a * ones} = ${a * b}`]
        : [`${a}×${b} = ${a * b}`];
      return { prompt: `${a} × ${b}`, answer: String(a * b), steps,
               trick: "Break the second factor into tens and ones." };
    },
  });

  def({
    id: "multiply-2x2", name: "Two-digit multiplication", domain: "arithmetic",
    blurb: "Multiply two two-digit numbers using friendly decomposition.",
    gen(level, r) {
      const ranges = [[10, 19], [10, 29], [20, 49], [25, 75], [50, 99]];
      const [lo, hi] = band(level, ranges);
      const a = r.int(lo, hi), b = r.int(lo, hi);
      const bt = Math.floor(b / 10) * 10, bo = b % 10;
      const product = a * b;
      return {
        prompt: `${a} × ${b}`, answer: String(product),
        steps: [`${a} × ${bt} = ${a * bt}`, `${a} × ${bo} = ${a * bo}`,
                `${a * bt} + ${a * bo} = ${product}`],
        trick: "Split one factor into tens and ones; keep the partial products visible.",
      };
    },
  });

  def({
    id: "divide-friendly", name: "Division", domain: "arithmetic",
    blurb: "Build the dividend from a clean quotient and divisor.",
    gen(level, r) {
      const divisors = band(level, [[2, 5], [2, 9], [3, 12], [4, 20], [5, 30]]);
      const quotients = band(level, [[2, 12], [3, 25], [4, 50], [5, 100], [10, 250]]);
      const divisor = r.int(divisors[0], divisors[1]);
      const quotient = r.int(quotients[0], quotients[1]);
      const dividend = divisor * quotient;
      return {
        prompt: `${dividend} ÷ ${divisor}`, answer: String(quotient),
        steps: [`${divisor} × ${quotient} = ${dividend}`, `so ${dividend} ÷ ${divisor} = ${quotient}`],
        trick: "Think of division as the inverse of multiplication.",
      };
    },
  });

  def({
    id: "order-of-operations", name: "Parentheses and order", domain: "arithmetic",
    blurb: "Evaluate compact expressions without losing the grouping.",
    gen(level, r) {
      const a = r.int(2, band(level, [9, 15, 30, 60, 100]));
      const b = r.int(2, band(level, [6, 10, 15, 25, 50]));
      const c = r.int(2, band(level, [5, 8, 12, 20, 30]));
      if (r() < 0.5) {
        const answer = a + b * c;
        return { prompt: `${a} + (${b} × ${c})`, answer: String(answer),
          steps: [`${b} × ${c} = ${b * c}`, `${a} + ${b * c} = ${answer}`],
          trick: "Parentheses first, then multiplication, then addition." };
      }
      const answer = (a + b) * c;
      return { prompt: `(${a} + ${b}) × ${c}`, answer: String(answer),
        steps: [`${a} + ${b} = ${a + b}`, `${a + b} × ${c} = ${answer}`],
        trick: "Do the grouped sum before multiplying." };
    },
  });

  def({
    id: "powers", name: "Powers", domain: "arithmetic",
    blurb: "Build small powers by repeated multiplication and useful anchors.",
    gen(level, r) {
      const base = r.int(2, band(level, [3, 4, 5, 8, 12]));
      const exponent = r.int(2, band(level, [3, 4, 5, 6, 7]));
      const answer = base ** exponent;
      return { prompt: `${base}^${exponent}`, answer: String(answer),
        steps: [`${base} × `.repeat(Math.max(0, exponent - 1)) + `${base} = ${answer}`],
        trick: "Use a known square or cube, then multiply by the remaining factor." };
    },
  });

  // ---- machine learning ---------------------------------------------------

  def({
    id: "softmax-2", name: "Softmax", domain: "machine learning",
    blurb: "Build intuition for logits, normalization, and probabilities.",
    gen(level, r) {
      const cases = [
        { logits: "[0, 0]", answer: "1/2", step: "e^0/(e^0+e^0) = 1/2" },
        { logits: "[1, 1]", answer: "1/2", step: "equal logits receive equal probability" },
        { logits: "[2, 2]", answer: "1/2", step: "subtracting the shared offset leaves [0, 0]" },
      ];
      const c = r.pick(cases);
      return {
        prompt: `For logits ${c.logits}, what is the softmax probability of class 1?`,
        answer: c.answer,
        steps: [c.step, `p(class 1) = ${c.answer}`],
        trick: "Softmax is unchanged when the same constant is added to every logit.",
      };
    },
  });

  def({
    id: "cross-entropy", name: "Cross-entropy", domain: "machine learning",
    blurb: "Compute the negative log-likelihood of the correct class.",
    tolerance: 0.001,
    gen(level, r) {
      const p = r.pick([0.5, 0.25, 0.8, 0.9]);
      const loss = -Math.log(p);
      return {
        prompt: `The correct class has predicted probability ${p}. What is its cross-entropy loss? (natural log)`,
        answer: loss.toFixed(4),
        tolerance: 0.001,
        steps: [`−ln(${p}) = ${loss.toFixed(4)}`],
        trick: "Cross-entropy for a one-hot target is −ln of the probability assigned to the correct class.",
      };
    },
  });

  def({
    id: "gradient-step", name: "Gradient descent", domain: "machine learning",
    blurb: "Update a parameter with a gradient and learning rate.",
    tolerance: 0.001,
    gen(level, r) {
      const w = r.int(-5, 9), gradient = r.int(-8, 8) || 3;
      const eta = r.pick([0.1, 0.2, 0.5]);
      const next = w - eta * gradient;
      return {
        prompt: `Update w = ${w} with gradient ${gradient} and learning rate ${eta}. What is w′?`,
        answer: next.toFixed(2),
        tolerance: 0.001,
        steps: [`w′ = w − ηg = ${w} − (${eta})(${gradient})`, `w′ = ${next.toFixed(2)}`],
        trick: "Gradient descent moves opposite the gradient.",
      };
    },
  });

  def({
    id: "mult-tricks", name: "Multiplication tricks", domain: "arithmetic",
    blurb: "×11, ×5, ×9, near-100, and difference of squares.",
    gen(level, r) {
      const kinds = band(level, [["x11"], ["x11", "x5"], ["x11", "x5", "x9"],
                                 ["x5", "x9", "near100"], ["near100", "diffsq", "sq5"]]);
      const kind = r.pick(kinds);
      if (kind === "x11") {
        const a = r.int(12, 98);
        const [t, o] = [Math.floor(a / 10), a % 10];
        return { prompt: `${a} × 11`, answer: String(a * 11),
                 steps: [`outer digits ${t} and ${o}`, `middle = ${t}+${o} = ${t + o}`,
                         `= ${a * 11}`],
                 trick: "Split the digits and drop their sum in the middle." };
      }
      if (kind === "x5") {
        const a = r.int(24, 998);
        return { prompt: `${a} × 5`, answer: String(a * 5),
                 steps: [`${a}/2 = ${a / 2}`, `×10 = ${a * 5}`],
                 trick: "×5 is ÷2 then ×10." };
      }
      if (kind === "x9") {
        const a = r.int(12, 99);
        return { prompt: `${a} × 9`, answer: String(a * 9),
                 steps: [`${a}×10 = ${a * 10}`, `− ${a} = ${a * 9}`],
                 trick: "×9 is ×10 minus one copy." };
      }
      if (kind === "near100") {
        const a = r.int(89, 99), b = r.int(89, 99);
        const [da, db] = [100 - a, 100 - b];
        return { prompt: `${a} × ${b}`, answer: String(a * b),
                 steps: [`deficits ${da} and ${db}`, `${a}−${db} = ${a - db} (hundreds)`,
                         `${da}×${db} = ${da * db}`, `= ${a * b}`],
                 trick: "Cross-subtract the deficits, then multiply them." };
      }
      if (kind === "sq5") {
        const t = r.int(2, 9), a = t * 10 + 5;
        return { prompt: `${a}²`, answer: String(a * a),
                 steps: [`${t}×${t + 1} = ${t * (t + 1)}`, `append 25 → ${a * a}`],
                 trick: "Numbers ending in 5: n(n+1) then 25." };
      }
      const mid = r.int(12, 60), d = r.pick([2, 3, 4, 5]);
      const a = mid - d, b = mid + d;
      return { prompt: `${a} × ${b}`, answer: String(a * b),
               steps: [`midpoint ${mid}, gap ${d}`, `${mid}² − ${d}² = ${mid * mid} − ${d * d}`,
                       `= ${a * b}`],
               trick: "Symmetric pairs are a difference of squares." };
    },
  });

  def({
    id: "squares", name: "Squares", domain: "arithmetic",
    blurb: "Anchor on a nearby round number.",
    gen(level, r) {
      const [lo, hi] = band(level, [range(2, 15), range(10, 30), range(20, 60),
                                    range(40, 99), range(100, 199)]);
      const a = r.int(lo, hi);
      const base = Math.round(a / 10) * 10, d = a - base;
      return { prompt: `${a}²`, answer: String(a * a),
               steps: [`${base}² = ${base * base}`,
                       `+ 2×${base}×${d} = ${2 * base * d}`, `+ ${d}² = ${d * d}`,
                       `= ${a * a}`],
               trick: "(b+d)² = b² + 2bd + d²." };
    },
  });

  def({
    id: "percent", name: "Percentages", domain: "arithmetic",
    blurb: "Build any percent out of 10% and 1%.",
    gen(level, r) {
      const specs = [[10, 50, [10, 20, 50]], [5, 100, [5, 15, 25]],
                     [12, 400, [12, 15, 35]], [8, 900, [8, 17, 45, 65]],
                     [3, 2000, [3, 7, 23, 87]]];
      const [, maxN, ps] = band(level, specs);
      const p = r.pick(ps), n = r.int(20, maxN) * (level > 3 ? 4 : 1);
      const val = (p * n) / 100;
      return { prompt: `${p}% of ${n}`, answer: String(+val.toFixed(4)),
               steps: [`10% = ${n / 10}`, `1% = ${n / 100}`,
                       `${p}% = ${p} × ${n / 100} = ${+val.toFixed(4)}`],
               trick: "x% of y equals y% of x — flip if that is easier." };
    },
  });

  def({
    id: "fractions", name: "Fraction arithmetic", domain: "arithmetic",
    blurb: "Common denominators, then simplify.",
    gen(level, r) {
      const maxD = band(level, [6, 9, 12, 16, 24]);
      const op = band(level, [["+"], ["+", "−"], ["+", "−", "×"],
                              ["+", "−", "×", "÷"], ["+", "−", "×", "÷"]]);
      const o = r.pick(op);
      const [a, b] = [r.int(1, maxD - 1), r.int(2, maxD)];
      const [c, d] = [r.int(1, maxD - 1), r.int(2, maxD)];
      let n, den, steps;
      if (o === "+" || o === "−") {
        const s = o === "+" ? 1 : -1;
        n = a * d + s * c * b; den = b * d;
        steps = [`common denominator ${b * d}`,
                 `${a * d} ${o} ${c * b} = ${n}`, `= ${fmtFrac(n, den)}`];
      } else if (o === "×") {
        n = a * c; den = b * d;
        steps = [`${a}×${c} = ${n}`, `${b}×${d} = ${den}`, `= ${fmtFrac(n, den)}`];
      } else {
        n = a * d; den = b * c;
        steps = [`flip the divisor: ${d}/${c}`, `= ${fmtFrac(n, den)}`];
      }
      return { prompt: `${a}/${b} ${o} ${c}/${d}`, answer: fmtFrac(n, den), steps,
               trick: "Simplify before multiplying to keep the numbers small." };
    },
  });

  def({
    id: "divisibility", name: "Divisibility", domain: "number theory",
    blurb: "Digit tests for 3, 4, 7, 8, 9, 11.",
    gen(level, r) {
      const ds = band(level, [[2, 3, 5], [3, 4, 9], [4, 8, 11], [7, 11, 13], [7, 11, 13]]);
      const d = r.pick(ds);
      const n = r.int(band(level, [20, 100, 1000, 1000, 10000]),
                      band(level, [99, 999, 9999, 99999, 999999]));
      const yes = n % d === 0;
      const how = {
        2: "last digit even", 3: `digit sum ${digitSum(n)}`, 4: "last two digits",
        5: "last digit 0 or 5", 8: "last three digits", 9: `digit sum ${digitSum(n)}`,
        11: "alternating digit sum",
        7: "double the last digit and subtract from the rest",
        13: "add 4× the last digit to the rest",
      }[d];
      return { prompt: `Is ${n} divisible by ${d}?`, answer: yes ? "yes" : "no",
               format: "choice",
               mistakes: [{ answer: yes ? "no" : "yes",
                            why: `${n} = ${d} × ${Math.floor(n / d)} + ${n % d}: the remainder is ${n % d}.` }],
               steps: [`${how}`, `${n} mod ${d} = ${n % d}`],
               trick: `Test for ${d}: ${how}.` };
    },
  });

  def({
    id: "gcd-lcm", name: "GCD and LCM", domain: "number theory",
    blurb: "Euclid's algorithm, then use gcd·lcm = ab.",
    gen(level, r) {
      const hi = band(level, [20, 40, 80, 200, 600]);
      const a = r.int(4, hi), b = r.int(4, hi);
      const which = level >= 3 && r() < 0.5 ? "lcm" : "gcd";
      const g = gcd(a, b), l = (a * b) / g;
      return { prompt: `${which.toUpperCase()}(${a}, ${b})`,
               answer: String(which === "gcd" ? g : l),
               steps: [`gcd by Euclid = ${g}`, `lcm = ${a}×${b}/${g} = ${l}`],
               trick: "gcd(a,b) × lcm(a,b) = ab." };
    },
  });

  def({
    id: "mod-power", name: "Modular powers", domain: "number theory",
    blurb: "Cycle the exponent; Fermat when the modulus is prime.",
    gen(level, r) {
      const mods = band(level, [[5, 7], [7, 9], [11, 13], [13, 17], [17, 19, 23]]);
      const m = r.pick(mods);
      const a = r.int(2, m - 1);
      const e = r.int(band(level, [3, 5, 12, 40, 200]), band(level, [8, 20, 60, 200, 1000]));
      let v = 1, base = a % m, k = e;
      while (k > 0) { if (k & 1) v = (v * base) % m; base = (base * base) % m; k >>= 1; }
      return { prompt: `${a}^${e} mod ${m}`, answer: String(v),
               steps: [`${m} is prime, so a^${m - 1} ≡ 1`,
                       `${e} mod ${m - 1} = ${e % (m - 1)}`,
                       `${a}^${e % (m - 1)} mod ${m} = ${v}`],
               trick: "Reduce the exponent mod (p−1) first." };
    },
  });

  def({
    id: "series", name: "Series and sums", domain: "algebra",
    blurb: "Closed forms beat adding term by term.",
    gen(level, r) {
      const kind = band(level, ["1n", "1n", "arith", "squares", "geom"]);
      if (kind === "1n") {
        const n = r.int(10, 100);
        return { prompt: `1 + 2 + … + ${n}`, answer: String((n * (n + 1)) / 2),
                 steps: [`n(n+1)/2 = ${n}×${n + 1}/2 = ${(n * (n + 1)) / 2}`],
                 trick: "Pair the ends: each pair sums to n+1." };
      }
      if (kind === "arith") {
        const a = r.int(2, 12), d = r.int(2, 9), n = r.int(8, 30);
        const last = a + (n - 1) * d, sum = (n * (a + last)) / 2;
        return { prompt: `${a} + ${a + d} + … (${n} terms, step ${d})`, answer: String(sum),
                 steps: [`last = ${last}`, `n(first+last)/2 = ${sum}`],
                 trick: "Average the ends, multiply by the count." };
      }
      if (kind === "squares") {
        const n = r.int(5, 20);
        return { prompt: `1² + 2² + … + ${n}²`,
                 answer: String((n * (n + 1) * (2 * n + 1)) / 6),
                 steps: [`n(n+1)(2n+1)/6 = ${(n * (n + 1) * (2 * n + 1)) / 6}`],
                 trick: "n(n+1)(2n+1)/6." };
      }
      const rr = r.pick([2, 3]), n = r.int(4, 9);
      const sum = (Math.pow(rr, n) - 1) / (rr - 1);
      return { prompt: `1 + ${rr} + ${rr}² + … + ${rr}^${n - 1}`, answer: String(sum),
               steps: [`(r^n − 1)/(r − 1) = (${Math.pow(rr, n)} − 1)/${rr - 1} = ${sum}`],
               trick: "Geometric sum: (rⁿ−1)/(r−1)." };
    },
  });

  def({
    id: "counting", name: "Counting", domain: "combinatorics",
    blurb: "Permutations, combinations, and when order matters.",
    gen(level, r) {
      const n = r.int(band(level, [4, 5, 6, 8, 10]), band(level, [6, 8, 10, 12, 15]));
      const k = r.int(2, Math.max(2, Math.min(n - 1, band(level, [2, 3, 4, 5, 6]))));
      const perm = level >= 3 && r() < 0.4;
      let v = 1;
      for (let i = 0; i < k; i++) v = (v * (n - i)) / (perm ? 1 : i + 1);
      v = Math.round(v);
      return {
        prompt: perm ? `P(${n}, ${k}) — ordered choices` : `C(${n}, ${k}) — unordered choices`,
        answer: String(v),
        steps: perm ? [`${n}×${n - 1}… (${k} factors) = ${v}`]
                    : [`P(${n},${k})/${k}! = ${v}`],
        trick: perm ? "Order matters: no division by k!."
                    : "Order does not matter: divide by k!.",
      };
    },
  });

  def({
    id: "estimate", name: "Estimation", domain: "arithmetic",
    blurb: "Get within 10% without exact arithmetic.",
    tolerance: 0.1,
    gen(level, r) {
      const kind = band(level, ["sqrt", "sqrt", "product", "product", "power"]);
      if (kind === "sqrt") {
        const n = r.int(band(level, [20, 50, 200, 900, 2000]),
                        band(level, [99, 400, 1500, 5000, 20000]));
        return { prompt: `√${n} (within 10%)`, answer: Math.sqrt(n).toFixed(2),
                 steps: [`nearest square below: ${Math.floor(Math.sqrt(n)) ** 2}`,
                         `√${n} ≈ ${Math.sqrt(n).toFixed(2)}`],
                 trick: "Bracket by the two nearest perfect squares." };
      }
      if (kind === "product") {
        const a = r.int(180, 9800), b = r.int(12, 95);
        return { prompt: `${a} × ${b} (within 10%)`, answer: String(a * b),
                 steps: [`≈ ${Math.round(a / 100) * 100} × ${Math.round(b / 10) * 10}`,
                         `= ${a * b} exactly`],
                 trick: "Round both to one significant figure, then correct." };
      }
      const b = r.pick([2, 3]), e = r.int(6, 14);
      return { prompt: `${b}^${e} (within 10%)`, answer: String(Math.pow(b, e)),
               steps: [`2^10 ≈ 1000`, `= ${Math.pow(b, e)}`],
               trick: "2^10 ≈ 1000 anchors every power of two." };
    },
  });

  def({
    id: "bases", name: "Number bases", domain: "number theory",
    blurb: "Binary and hex by repeated division.",
    gen(level, r) {
      const base = band(level, [2, 2, 2, 16, 16]);
      const n = r.int(band(level, [4, 16, 64, 64, 500]), band(level, [15, 63, 255, 255, 4095]));
      const toBase = n.toString(base).toUpperCase();
      const back = r() < 0.4 && level >= 3;
      return back
        ? { prompt: `${toBase}${base === 16 ? "₁₆" : "₂"} in decimal`, answer: String(n),
            steps: [`place values in base ${base}`, `= ${n}`],
            trick: "Horner: multiply-and-add left to right." }
        : { prompt: `${n} in base ${base}`, answer: toBase,
            steps: [`divide by ${base} repeatedly, read remainders upward`, `= ${toBase}`],
            trick: base === 16 ? "Hex digit = 4 bits." : "Powers of two sum to n." };
    },
  });

  def({
    id: "linear", name: "Linear equations", domain: "algebra",
    blurb: "Isolate the unknown in one pass.",
    gen(level, r) {
      const a = r.int(2, band(level, [5, 9, 12, 15, 20]));
      const x = r.int(-band(level, [5, 9, 12, 20, 40]), band(level, [9, 12, 20, 30, 60]));
      const b = r.int(-30, 30);
      if (level <= 2) {
        return { prompt: `${a}x + ${b} = ${a * x + b}`, answer: String(x),
                 steps: [`subtract ${b}`, `divide by ${a}`, `x = ${x}`],
                 trick: "Undo the operations in reverse order." };
      }
      const c = r.int(2, 9), d = r.int(-20, 20);
      const rhs = (a - c) * x + b;   // a x + b = c x + (rhs - ... ) keeps x integral
      return { prompt: `${a}x + ${b} = ${c}x + ${rhs}`, answer: String(x),
               steps: [`move x terms: ${a - c}x = ${rhs - b}`, `x = ${x}`],
               trick: "Collect unknowns on the side that keeps the coefficient positive." };
    },
  });

  def({
    id: "logs", name: "Logs and exponents", domain: "algebra",
    blurb: "Read exponents off powers you already know.",
    gen(level, r) {
      const b = r.pick(band(level, [[2], [2, 3], [2, 3, 5], [2, 3, 5, 10], [2, 3, 5, 7, 10]]));
      const e = r.int(2, band(level, [5, 6, 7, 8, 9]));
      const v = Math.pow(b, e);
      return r() < 0.5
        ? { prompt: `log_${b}(${v})`, answer: String(e),
            steps: [`${b}^${e} = ${v}`], trick: "Ask: what power gives this?" }
        : { prompt: `${b}^${e}`, answer: String(v),
            steps: [`repeated doubling/tripling → ${v}`], trick: "Square and square again." };
    },
  });

  // ---- answer checking ----------------------------------------------------

  const normalize = (s) =>
    String(s ?? "").trim().toLowerCase().replace(/\s+/g, "")
      .replace(/^\+/, "").replace(/,/g, "");

  // ---- einsum by meaning ----------------------------------------------------
  //
  // An einsum answer is right if it computes the right thing, however it is
  // spelled: "ij,jk->ik" and "ab,bc->ac" are the same answer. So instead of
  // comparing strings, run both specs on the same fixed random integer operands
  // and compare the results. Small sizes keep this to a few thousand multiplies.

  /** Pull "ij,jk->ik" out of whatever was typed: a bare spec, einops-style
   *  "i j, j k -> i k", or a whole `torch.einsum("…", A, B)` call. */
  function einsumSpec(raw) {
    let s = String(raw ?? "").trim();
    const quoted = /["']([^"']+)["']/.exec(s);
    if (quoted) s = quoted[1];
    s = s.replace(/\s+/g, "").replace(/→/g, "->");
    return /^[a-zA-Z]*(,[a-zA-Z]*)*(->[a-zA-Z]*)?$/.test(s) ? s : null;
  }

  /** Evaluate `spec` on operands [{ shape, data }]; null if it does not apply. */
  function einsumEval(spec, ops) {
    let [lhs, out] = spec.split("->");
    const ins = lhs.split(",");
    if (ins.length !== ops.length) return null;
    const size = {};
    for (let k = 0; k < ins.length; k++) {
      if (ins[k].length !== ops[k].shape.length) return null;
      for (let a = 0; a < ins[k].length; a++) {
        const c = ins[k][a], n = ops[k].shape[a];
        if (size[c] !== undefined && size[c] !== n) return null;
        size[c] = n;
      }
    }
    if (out === undefined) {                      // numpy's implicit mode
      const once = Object.keys(size).filter((c) => lhs.split(c).length === 2);
      out = once.sort().join("");
    }
    if (new Set(out).size !== out.length || [...out].some((c) => size[c] === undefined)) return null;
    const axes = Object.keys(size);
    const outShape = [...out].map((c) => size[c]);
    const result = new Array(outShape.reduce((a, b) => a * b, 1)).fill(0);
    const at = {};
    const flat = (letters, shape) => {
      let i = 0;
      for (let a = 0; a < letters.length; a++) i = i * shape[a] + at[letters[a]];
      return i;
    };
    (function loop(d) {
      if (d === axes.length) {
        let prod = 1;
        for (let k = 0; k < ops.length; k++) prod *= ops[k].data[flat(ins[k], ops[k].shape)];
        result[flat(out, outShape)] += prod;
        return;
      }
      for (let v = 0; v < size[axes[d]]; v++) { at[axes[d]] = v; loop(d + 1); }
    })(0);
    return { shape: outShape, data: result };
  }

  /** Fixed pseudo-random integer operands for the shapes a problem declares. */
  function einsumOperands(shapes) {
    const r = rngFrom(0x5eed);
    return shapes.map((shape) => ({
      shape, data: Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => r.int(-4, 5) || 1),
    }));
  }

  // ---- proofs as ordered lines ----------------------------------------------
  //
  // An "order" problem gives a proof's lines shuffled together with plausible
  // wrong ones. The answer is a sequence of line ids. Each step may say which
  // steps it needs (`after`, default: the one before it), so steps that commute
  // can come in either order and still be right.

  const orderIds = (input) => (Array.isArray(input) ? input : String(input ?? "").split(","))
    .map((x) => String(x).trim()).filter(Boolean);

  function orderProblemOK(problem, input) {
    const ids = orderIds(input);
    const want = problem.steps.map((st) => st.id);
    if (ids.length !== want.length || new Set(ids).size !== ids.length) return false;
    if (!ids.every((id) => want.includes(id))) return false;
    const pos = new Map(ids.map((id, i) => [id, i]));
    return problem.steps.every((st, i) => (st.after ?? (i ? [want[i - 1]] : []))
      .every((dep) => pos.get(dep) < pos.get(st.id)));
  }

  /** Why an ordering is wrong, in words: a planted line, a gap, or an order slip. */
  function orderDiagnosis(problem, input) {
    const ids = orderIds(input);
    const extra = problem.extras.find((x) => ids.includes(x.id));
    if (extra) return { answer: null, why: `“${extra.text}” doesn't belong: ${extra.why}` };
    const missing = problem.steps.find((st) => !ids.includes(st.id));
    if (missing) return { answer: null, why: `A step is missing. The proof needs every link; one of the unused lines is essential.` };
    const pos = new Map(ids.map((id, i) => [id, i]));
    const text = new Map(problem.steps.map((st) => [st.id, st.text]));
    for (const [i, st] of problem.steps.entries()) {
      const deps = st.after ?? (i ? [problem.steps[i - 1].id] : []);
      const late = deps.find((d) => pos.get(d) > pos.get(st.id));
      if (late) return { answer: null, why: `“${st.text}” relies on “${text.get(late)}”, which comes after it.` };
    }
    return null;
  }

  /** Two integers from "3, -2", "(3,-2)", "x=3 y=-2". */
  function pairOf(input) {
    const m = String(input ?? "").match(/-?\d+/g);
    return m && m.length === 2 ? m.map(Number) : null;
  }

  function check(problem, input) {
    if (problem.kind === "order") return orderProblemOK(problem, input);
    if (problem.kind === "pair") {
      // Any solution is right: check it by substitution, not against one answer.
      const xy = pairOf(input);
      return Boolean(xy) && problem.pair.a * xy[0] + problem.pair.b * xy[1] === problem.pair.c;
    }
    if (problem.kind === "einsum") {
      const mine = einsumSpec(input), want = einsumSpec(problem.answer);
      if (!mine || !want) return false;
      const ops = einsumOperands(problem.shapes);
      const a = einsumEval(mine, ops), b = einsumEval(want, ops);
      return Boolean(a && b) && a.shape.join() === b.shape.join()
        && a.data.every((x, i) => x === b.data[i]);
    }
    // Shapes are compared as lists of sizes, however they are written:
    // "(2, 8, 10)", "2x8x10" and "[2,8,10]" are the same answer.
    if (problem.kind === "shape") {
      const dims = (s) => (String(s ?? "").match(/\d+/g) ?? []).join(",");
      return dims(input) !== "" && dims(input) === dims(problem.answer);
    }
    const given = normalize(input);
    const want = normalize(problem.answer);
    if (!given) return false;
    if (given === want) return true;
    const numericValue = (s) => {
      if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
      const f = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
      if (f && Number(f[2]) !== 0) return Number(f[1]) / Number(f[2]);
      return Number.NaN;
    };
    const gn = numericValue(given), wn = numericValue(want);
    if (Number.isFinite(gn) && Number.isFinite(wn)) {
      // Estimation problems accept a band; everything else is exact.
      const tol = problem.tolerance ?? 0;
      // Estimates: right if within a factor of `factor` either way.
      if (problem.factor && wn > 0) return gn > 0 && gn / wn <= problem.factor && wn / gn <= problem.factor;
      // Relative, with a floor only for answers at zero: an absolute floor of
      // 1e-3 accepted 0.000001 for a variance of 0.000225.
      if (tol) return Math.abs(gn - wn) <= Math.max(1e-9, Math.abs(wn) * tol);
      // Generated decimal answers encode the intended precision. Accept a
      // normally rounded entry, but keep integer drills exact.
      const decimals = (want.split('.')[1] ?? '').length;
      const rounding = decimals ? Math.max(5e-4, 0.5 * 10 ** -decimals) : 0;
      return Math.abs(gn - wn) <= rounding;
    }
    return false;
  }

  // ---- misconceptions and multiple choice ----------------------------------
  //
  // A generator may return `mistakes`: [{ answer, why }], each the value a
  // specific error produces ("forgot the bias", "padded one side only"). They
  // do two jobs. Typed answers that match one get its explanation instead of a
  // bare "wrong". And they are the distractors of the multiple-choice form, so a
  // wrong pick is always a real error with a reason, never a random number.
  //
  // Conceptual generators return `format: "choice"` with `answer` as the correct
  // statement and `mistakes` as wrong statements: they are only ever multiple choice.

  /** The misconception a typed answer matches, if any. */
  function diagnose(problem, input) {
    if (problem.kind === "order") return orderProblemOK(problem, input) ? null : orderDiagnosis(problem, input);
    if (problem.kind === "pair") {
      const xy = pairOf(input);
      if (!xy) return { answer: null, why: "Give two integers, x and y, like “3, -2”." };
      const { a, b, c } = problem.pair;
      const got = a * xy[0] + b * xy[1];
      return got === c ? null : { answer: null,
        why: `With x = ${xy[0]}, y = ${xy[1]}: ${a}·(${xy[0]}) + ${b}·(${xy[1]}) = ${got}, not ${c}.` };
    }
    if (!problem.mistakes?.length) return null;
    const probe = { ...problem, tolerance: problem.tolerance };
    for (const m of problem.mistakes) {
      if (check({ ...probe, answer: m.answer }, input)) return m;
    }
    return null;
  }

  /** Near-miss numbers for when a generator names fewer than three mistakes. */
  function fillerValues(answer, r) {
    const frac = /^(-?\d+)\/(\d+)$/.exec(String(answer));
    if (frac) {
      const a = Number(frac[1]), b = Number(frac[2]);
      return [fmtFrac(-a, b), fmtFrac(b, a || 1), fmtFrac(a + b, b), fmtFrac(a, 2 * b), fmtFrac(2 * a, b)]
        .filter((x) => x !== answer && !x.includes("NaN")).sort(() => r() - 0.5);
    }
    const n = Number(answer);
    if (!Number.isFinite(n)) return [];
    const isInt = Number.isInteger(n);
    const out = isInt
      ? [n + 1, n - 1, n * 2, Math.round(n / 2), n + 10, n * 10]
      : [n * 2, n / 2, n + 0.1, n - 0.1, 1 - n].map((x) => +x.toFixed(4));
    return out.filter((x) => x !== n && Number.isFinite(x) && !(n > 0 && x < 0))
      .sort(() => r() - 0.5);
  }

  /** Answer plus up to three distinct distractors, in a seeded order. */
  function buildChoices(p, r) {
    const seen = [];
    const same = (a, b) => check({ ...p, answer: String(a) }, String(b));
    const take = (text, why, correct) => {
      if (seen.length >= 4 || seen.some((c) => same(c.text, text) || same(text, c.text))) return;
      seen.push({ text: String(text), why: why ?? null, correct });
    };
    take(p.answer, null, true);
    for (const m of p.mistakes ?? []) take(m.answer, m.why, false);
    if (p.kind === "shape") {
      // Near-miss shapes: two axes swapped, the last axis dropped, a stray axis of 1.
      const dims = (String(p.answer).match(/\d+/g) ?? []).map(Number);
      const alt = [];
      if (dims.length > 1) alt.push([dims[1], dims[0], ...dims.slice(2)], dims.slice(0, -1));
      alt.push([...dims, 1], [1, ...dims]);
      for (const d of alt.sort(() => r() - 0.5)) {
        if (seen.length >= 4) break;
        take(`(${d.join(", ")})`, "That shape doesn't follow from the pattern: track each axis from input to output.", false);
      }
    } else if (p.format !== "choice") {
      for (const x of fillerValues(p.answer, r)) {
        if (seen.length >= 4) break;
        take(x, "Not a value any step of the method produces: recheck the working.", false);
      }
    }
    if (seen.length < 2) return null;
    // Fisher–Yates on the seeded stream, so a (skill, level, seed) replays exactly.
    for (let i = seen.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [seen[i], seen[j]] = [seen[j], seen[i]];
    }
    return seen;
  }

  const skillInfo = (g) => ({
    id: g.id, name: g.name, domain: g.domain, blurb: g.blurb, levels: 5,
    source: g.source ?? null, concepts: g.concepts ?? [],
  });
  const SKILLS = Object.values(G).map(skillInfo);

  /** Register a generator from another file (generators-ml.js). */
  function define(g) {
    if (G[g.id]) throw new Error(`duplicate skill: ${g.id}`);
    def(g);
    SKILLS.push(skillInfo(g));
  }

  function generate(skillId, level = 1, seed = Math.floor(Math.random() * 2 ** 31)) {
    const g = G[skillId];
    if (!g) throw new Error(`unknown skill: ${skillId}`);
    const lvl = Math.max(1, Math.min(5, level | 0));
    const r = rngFrom(seed);
    const made = g.gen(lvl, r);
    const p = { ...made, factor: made.factor ?? g.factor, skill: g.id, skillName: g.name, domain: g.domain,
                level: lvl, seed, tolerance: made.tolerance ?? g.tolerance,
                source: g.source ?? null, prose: made.prose ?? g.prose ?? false };
    // A mistake that lands within grading tolerance of the answer is not a
    // distractor, whatever it was meant to show: picking it would be marked
    // right. Some parameter draws make that happen (log-sum-exp of (3, −3, 1)
    // is 3.002, next to the "max only" mistake), so drop them per draw.
    if (p.mistakes && p.format !== "choice") p.mistakes = p.mistakes.filter((m) => !check(p, m.answer));
    // Multiple choice: always for conceptual items; as the first rung (level 1)
    // for computed ones, where recognising the answer comes before producing it.
    const choices = p.mistakes?.length || p.format === "choice" ? buildChoices(p, r) : null;
    // `typed` problems (writing an einsum) are never turned into a pick-one.
    if (choices && !p.typed && (p.format === "choice" || lvl === 1)) p.choices = choices;
    return p;
  }

  // Shared helpers for generator files, so each one formats numbers the same way.
  const util = { gcd, fmtFrac, band, einsumEval, einsumSpec, einsumOperands };

  return { SKILLS, generate, check, diagnose, define, util, rngFrom, _generators: G };
});
