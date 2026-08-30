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
               choices: ["yes", "no"], steps: [`${how}`, `${n} mod ${d} = ${n % d}`],
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

  function check(problem, input) {
    const given = normalize(input);
    const want = normalize(problem.answer);
    if (!given) return false;
    if (given === want) return true;
    const gn = Number(given), wn = Number(want);
    if (Number.isFinite(gn) && Number.isFinite(wn)) {
      // Estimation problems accept a band; everything else is exact.
      const tol = problem.tolerance ?? 0;
      return tol ? Math.abs(gn - wn) <= Math.abs(wn) * tol : gn === wn;
    }
    // a/b entered as a decimal, or unreduced
    const f = /^(-?\d+)\/(\d+)$/.exec(given);
    if (f) return normalize(fmtFrac(Number(f[1]), Number(f[2]))) === want;
    return false;
  }

  const SKILLS = Object.values(G).map((g) => ({
    id: g.id, name: g.name, domain: g.domain, blurb: g.blurb, levels: 5,
  }));

  function generate(skillId, level = 1, seed = Math.floor(Math.random() * 2 ** 31)) {
    const g = G[skillId];
    if (!g) throw new Error(`unknown skill: ${skillId}`);
    const lvl = Math.max(1, Math.min(5, level | 0));
    const p = g.gen(lvl, rngFrom(seed));
    return { ...p, skill: g.id, skillName: g.name, domain: g.domain,
             level: lvl, seed, tolerance: g.tolerance };
  }

  return { SKILLS, generate, check, rngFrom, _generators: G };
});
