// Generators for Grinstead & Snell, Introduction to Probability (GFDL).
//
// The book's exercises are free-response, and most ask for a number: a
// probability, an expectation, a fixed vector. Each generator here is a family
// of such problems modelled on one section's exercises (the loaded die of 1.2,
// the five-card deck of 4.1, the Land of Oz chain of 11.1), with parameters
// drawn from a seed, the answer computed in code, and every distractor a named
// mistake. Answers are exact fractions wherever the problem allows; a decimal
// typed for a fraction is accepted to within 0.2 percent.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M) return;
  const { band, gcd } = M.util;

  const SOURCE = "https://math.dartmouth.edu/~prob/prob/prob.pdf";
  const ALSO = {
    "gs-arrangements": ["1.4"], "gs-counting": ["1.4", "3.4"], "gs-birthday": ["1.4"],
    "gs-derangements": ["1.6", "group:inclusion_exclusion"], "gs-conditional-draws": ["2.2"], "gs-urns-bayes": ["2.3"],
    "gs-independent-events": ["2.5"], "gs-paradoxes": ["2.8", "group:monty_hall"], "gs-binomial": ["3.3"],
    "gs-min-uniform": ["3.7"], "gs-expected-value": ["4.1", "4.2", "4.5"], "gs-geometric": ["4.3"],
    "gs-variance": ["4.6"], "gs-poisson": ["4.7", "4.8"], "gs-uniform-interval": ["5.2"],
    "gs-density-transform": ["5.1", "5.3"], "gs-normal": ["5.4"], "gs-exponential": ["5.5"],
    "gs-continuous-moments": ["6.1"], "gs-mgf-moments": ["6.4", "6.5"], "gs-generating-functions": ["6.7"],
    "gs-dice-sums": ["8.2"], "gs-continuous-sums": ["8.2", "8.4"], "gs-continuous-conditional": ["8.3"],
    "gs-chebyshev": ["10.1", "10.2"], "gs-clt-bernoulli": ["10.3"], "gs-clt-dice": ["10.3"], "gs-clt-average": ["10.3"],
    "gs-markov-steps": ["11.1"], "gs-fixed-vector": ["11.3"], "gs-first-passage": ["11.3"],
    "gs-absorbing": ["group:first_step_analysis_and_gambler_s_ruin"], "gs-gamblers-ruin": ["group:first_step_analysis_and_gambler_s_ruin"],
  };
  // Answers that are probabilities keep their multiple-choice fillers in [0, 1].
  const isProb = (p) => /probability|fraction of|What is \$P\(|long-run fraction|bound/i.test(p.prompt)
    && Number(val2(p.answer)) >= 0 && Number(val2(p.answer)) <= 1;
  const val2 = (s) => { const f = /^(-?\d+)\/(\d+)$/.exec(String(s)); return f ? f[1] / f[2] : Number(s); };
  const def = (sections, g) => M.define({
    domain: "probability", prose: true, tolerance: 0.002, ...g,
    gen(level, r) { const p = g.gen(level, r); return isProb(p) ? { bounds: [0, 1], ...p } : p; },
    // Blitzstein & Hwang teaches the same topics: offer these on its course page too.
    concepts: [...sections.map((s) => `concept:grinstead_snell:sec_${s}`), ...(ALSO[g.id] ?? []).map((c) => `concept:blitzstein:${c}`)],
    source: {
      book: "grinstead_snell", title: "Grinstead & Snell, Introduction to Probability",
      section: g.section, url: SOURCE, fidelity: g.fidelity ?? "faithful",
    },
  });

  const fmt = (x, dp = 4) => String(Number(x.toFixed(dp)));
  const wrong = (answer, list) => list.filter((m, i) => m.answer !== undefined && m.answer !== answer
    && !/NaN|Infinity|undefined/.test(String(m.answer)) && list.findIndex((x) => x.answer === m.answer) === i);
  const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
  const C = (n, k) => {
    if (k < 0 || k > n) return 0;
    let c = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) c = (c * (n - i + 1)) / i;
    return Math.round(c);
  };
  // Normal CDF by Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7): the book reads Φ
  // from a table to four places, so this is more than enough.
  const erf = (x) => {
    const s = Math.sign(x), t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
      * Math.exp(-x * x);
    return s * y;
  };
  const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

  // ---- exact fractions ------------------------------------------------------
  // Small integers only (denominators here stay far below 2^53).
  const F = (n, d = 1) => {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { n: n / g, d: d / g };
  };
  const add = (a, b) => F(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => F(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => F(a.n * b.n, a.d * b.d);
  const div = (a, b) => F(a.n * b.d, a.d * b.n);
  const pow = (a, k) => F(a.n ** k, a.d ** k);
  const val = (a) => a.n / a.d;
  const str = (a) => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
  const ONE = F(1), ZERO = F(0);
  const tex = (a) => (a.d === 1 ? String(a.n) : `\\tfrac{${a.n}}{${a.d}}`);

  /** Solve A x = b exactly (Gauss–Jordan over fractions). */
  function solve(A, b) {
    const n = A.length;
    const m = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      const p = m.findIndex((row, i) => i >= c && row[c].n !== 0);
      if (p < 0) return null;
      [m[c], m[p]] = [m[p], m[c]];
      const piv = m[c][c];
      m[c] = m[c].map((x) => div(x, piv));
      for (let i = 0; i < n; i++) {
        if (i === c || m[i][c].n === 0) continue;
        const f = m[i][c];
        m[i] = m[i].map((x, j) => sub(x, mul(f, m[c][j])));
      }
    }
    return m.map((row) => row[n]);
  }
  const matmul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, x, k) => add(s, mul(x, B[k][j])), ZERO)));
  const matTex = (P) => `\\begin{pmatrix}${P.map((row) => row.map(tex).join(" & ")).join(" \\\\ ")}\\end{pmatrix}`;

  /** A random row of `k` fractions over denominator `d`, summing to 1, all
   *  positive when `positive`. */
  function row(r, k, d, positive) {
    for (;;) {
      const cuts = Array.from({ length: k - 1 }, () => r.int(0, d)).sort((a, b) => a - b);
      const parts = [...cuts, d].map((c, i) => c - (i ? cuts[i - 1] : 0));
      if (!positive || parts.every((p) => p > 0)) return parts.map((p) => F(p, d));
    }
  }

  // ==== 1. Discrete probability distributions ===================================

  def(["1.1"], {
    id: "gs-roulette", name: "Roulette odds", section: "1.1 Simulation of Discrete Probabilities",
    blurb: "38 slots, two of them green: every bet loses 1/19 of the stake on average.",
    gen(level, r) {
      const bets = [["red", 18, 1], ["a single number", 1, 35], ["a dozen (1–12)", 12, 2], ["odd", 18, 1]];
      const [name, win, pays] = r.pick(bets);
      const ask = band(level, ["p", "p", "ev", "total", "once"]);
      if (ask === "p") {
        const a = F(win, 38);
        return {
          prompt: `A Las Vegas roulette wheel has 38 slots: 0, 00 (green) and 1–36, half red and half black. `
            + `What is the probability that a bet on ${name} wins?`,
          answer: str(a), params: { ask, win, pays },
          steps: [`${win} winning slots out of 38`, `${win}/38 = ${str(a)}`],
          trick: "The two green slots are why the house wins.",
          mistakes: wrong(str(a), [
            { answer: str(F(win, 36)), why: "There are 38 slots, not 36: 0 and 00 count." },
            { answer: str(F(win, 37)), why: "An American wheel has both 0 and 00: 38 slots." },
          ]),
        };
      }
      const ev = sub(mul(F(win, 38), F(pays)), F(38 - win, 38));
      if (ask === "ev") {
        return {
          prompt: `On a 38-slot roulette wheel, a 1-dollar bet on ${name} pays ${pays} to 1. `
            + `What are your expected winnings per bet, in dollars?`,
          answer: str(ev), params: { ask, win, pays },
          steps: [`E = ${pays}·${win}/38 − 1·${38 - win}/38`, `= ${str(ev)}`],
          trick: "Every roulette bet has the same expectation: −1/19.",
          mistakes: wrong(str(ev), [
            { answer: "0", why: "The payout would be fair on a 36-slot wheel; the greens tilt it." },
            { answer: str(F(win * pays, 38)), why: "Subtract the stake you lose on the other slots." },
            { answer: str(F(1, 19)), why: "The sign: the house has the edge, so you lose on average." },
          ]),
        };
      }
      if (ask === "total") {
        const n = r.pick([38, 76, 100, 190, 380]);
        const tot = mul(ev, F(n));
        return {
          prompt: `You bet 1 dollar on ${name} (paying ${pays} to 1) on each of ${n} spins of a 38-slot wheel. `
            + `What are your expected total winnings?`,
          answer: str(tot), params: { ask, win, pays, n },
          steps: [`per bet: ${str(ev)}`, `${n} bets: ${n}·(${str(ev)}) = ${str(tot)}`],
          trick: "Expectations add, bet after bet.",
          mistakes: wrong(str(tot), [
            { answer: str(ev), why: `That is one bet; there are ${n}.` },
            { answer: "0", why: "Each bet loses 1/19 on average; they don't cancel." },
          ]),
        };
      }
      const k = r.pick([10, 20, 38, 50, 100]);
      const p = 1 - (37 / 38) ** k;
      return {
        prompt: `You bet on a single number on each of ${k} spins of a 38-slot wheel. `
          + `What is the probability that you win at least once?`,
        answer: fmt(p), params: { ask, k },
        steps: [`P(lose every time) = (37/38)^${k} = ${fmt((37 / 38) ** k)}`, `1 − that = ${fmt(p)}`],
        trick: "“At least once” is one minus “never”.",
        mistakes: wrong(fmt(p), [
          { answer: fmt(Math.min(1, k / 38)), why: "Adding 1/38 per spin double-counts spins where you'd win more than once." },
          { answer: fmt((37 / 38) ** k), why: "That is the chance of never winning." },
        ]),
      };
    },
  });

  def(["1.2"], {
    id: "gs-loaded-die", name: "A loaded die", section: "1.2 Discrete Probability Distributions",
    blurb: "Probabilities proportional to weights: divide each weight by the total.",
    gen(level, r) {
      const law = r.pick(band(level, [["k"], ["k", "7-k"], ["k", "k2"], ["k2", "7-k"], ["k2", "k3"]]));
      const w = (k) => ({ k, "7-k": 7 - k, k2: k * k, k3: k ** 3 })[law];
      const events = [["an even number", (k) => k % 2 === 0], ["an odd number", (k) => k % 2 === 1],
        ["a prime", (k) => [2, 3, 5].includes(k)], ["at least 4", (k) => k >= 4], ["at most 2", (k) => k <= 2]];
      const [name, test] = r.pick(events);
      const faces = [1, 2, 3, 4, 5, 6];
      const total = faces.reduce((s, k) => s + w(k), 0);
      const hit = faces.filter(test).reduce((s, k) => s + w(k), 0);
      const a = F(hit, total);
      const desc = { k: "proportional to the number of dots on it", "7-k": "proportional to 7 minus the number of dots",
        k2: "proportional to the square of the number of dots", k3: "proportional to the cube of the number of dots" }[law];
      return {
        prompt: `A die is loaded so that the probability of each face is ${desc}. What is the probability of rolling ${name}?`,
        answer: str(a), params: { law, event: name },
        steps: [`weights ${faces.map(w).join(", ")}; total ${total}`, `event weight ${hit}`, `P = ${hit}/${total} = ${str(a)}`],
        trick: "Normalise: divide by the sum of all the weights.",
        mistakes: wrong(str(a), [
          { answer: str(F(faces.filter(test).length, 6)), why: "The die is loaded: the faces are not equally likely." },
          { answer: str(F(hit, 21)), why: law === "k" ? "" : "Divide by the total of these weights, not 1 + … + 6 = 21." },
          { answer: str(F(total - hit, total)), why: "That is the complement of the event." },
        ].filter((m) => m.why)),
      };
    },
  });

  def(["1.2"], {
    id: "gs-odds", name: "Odds and probability", section: "1.2 Discrete Probability Distributions",
    blurb: "Odds r : s in favour means probability r/(r + s).",
    gen(level, r) {
      if (level <= 2) {
        const rr = r.int(1, 9), s = r.int(1, 12);
        const a = F(rr, rr + s);
        return {
          prompt: `The odds in favour of an event are ${rr} to ${s}. What is its probability?`,
          answer: str(a), params: { rr, s },
          steps: [`P = r/(r + s) = ${rr}/${rr + s}`],
          trick: "Odds compare the event with its complement, not with the whole.",
          mistakes: wrong(str(a), [
            { answer: str(F(rr, s)), why: "r/s is the odds ratio; the probability divides by r + s." },
            { answer: str(F(s, rr + s)), why: "That is the probability the event fails." },
          ]),
        };
      }
      const events = [["drawing an ace from a 52-card deck", F(4, 52)], ["two heads in two tosses of a coin", F(1, 4)],
        ["boxcars (two sixes) when two dice are rolled", F(1, 36)], ["a sum of 7 with two dice", F(6, 36)],
        ["drawing a heart from a 52-card deck", F(13, 52)], ["at least one head in three tosses", F(7, 8)]];
      const [name, p] = r.pick(events);
      const against = div(sub(ONE, p), p);
      return {
        prompt: `The odds against ${name} are x to 1. What is x?`,
        answer: str(against), params: { p: str(p) },
        steps: [`P = ${str(p)}`, `odds against = (1 − P)/P = ${str(against)}`],
        trick: "Odds against = failures per success.",
        mistakes: wrong(str(against), [
          { answer: str(div(p, sub(ONE, p))), why: "That is the odds in favour; turn it over." },
          { answer: str(div(ONE, p)), why: "1/P counts all outcomes per success; odds against count only failures." },
        ]),
      };
    },
  });

  def(["1.2"], {
    id: "gs-first-success", name: "Waiting for the first head", section: "1.2 Discrete Probability Distributions",
    blurb: "First success on toss k: qᵏ⁻¹p. Over a range, sum the geometric terms.",
    gen(level, r) {
      const p = r.pick(band(level, [[F(1, 2)], [F(1, 2)], [F(1, 2), F(1, 3)], [F(1, 3), F(1, 6)], [F(1, 6), F(2, 5)]]));
      const q = sub(ONE, p);
      const k = r.int(2, band(level, [4, 6, 8, 10, 12]));
      const span = level === 1 ? 0 : r.int(1, 3);
      const m = k + span;
      let a = ZERO;
      for (let j = k; j <= m; j++) a = add(a, mul(pow(q, j - 1), p));
      const coin = p.n === 1 && p.d === 2 ? "A fair coin" : p.d === 6 ? "A die (success = a six)" : `A coin with P(heads) = ${str(p)}`;
      const when = span === 0 ? `toss ${k}` : `one of tosses ${k} to ${m}`;
      return {
        prompt: `${coin} is tossed until the first success. What is the probability that the first success comes on ${when}?`,
        answer: str(a), params: { p: str(p), k, m },
        steps: [`P(first on j) = (${str(q)})^{j−1}·${str(p)}`, `sum over j = ${k}…${m}: ${str(a)}`],
        trick: "The first success on toss j needs j − 1 failures first.",
        mistakes: wrong(str(a), [
          { answer: str(pow(p, k)), why: "That is k successes in a row; the first success needs failures before it." },
          { answer: str(mul(pow(q, k), p)), why: `Before toss ${k} there are ${k - 1} failures, not ${k}.` },
          { answer: str(pow(q, k - 1)), why: "That is P(no success in the first k − 1): it ignores what happens afterwards." },
        ]),
      };
    },
  });

  // ==== 2. Continuous probability densities ===================================

  def(["2.1", "2.2"], {
    id: "gs-uniform-interval", name: "Uniform on an interval", section: "2.2 Continuous Density Functions",
    blurb: "Uniform on [a, b]: probability is length over length.",
    gen(level, r) {
      const a = r.int(0, band(level, [2, 4, 5, 10, 20])), b = a + r.int(3, band(level, [6, 8, 12, 20, 40]));
      let c = r.int(a - 2, b - 1), d = r.int(c + 1, b + 3);
      if (level <= 2) { c = Math.max(c, a); d = r.int(c + 1, b); }
      const lo = Math.max(a, c), hi = Math.min(b, d);
      const ans = F(Math.max(0, hi - lo), b - a);
      return {
        prompt: `A real number X is chosen uniformly at random from [${a}, ${b}]. What is $P(${c} \\le X \\le ${d})$?`,
        answer: str(ans), params: { a, b, c, d },
        steps: [`density 1/${b - a} on [${a}, ${b}]`, `overlap of [${c}, ${d}] with [${a}, ${b}] is [${lo}, ${hi}]`, `P = ${Math.max(0, hi - lo)}/${b - a}`],
        trick: "Only the part of the interval inside the range counts.",
        mistakes: wrong(str(ans), [
          { answer: str(F(d - c, b - a)), why: "Part of that interval lies outside [a, b], where the density is 0." },
          { answer: str(F(Math.max(0, hi - lo), b)), why: `Divide by the length of the range, ${b - a}, not by ${b}.` },
        ]),
      };
    },
  });

  def(["2.2"], {
    id: "gs-exponential", name: "Exponential lifetimes", section: "2.2 Continuous Density Functions",
    blurb: "P(T > t) = e^(−λt): the reliability of a bulb with failure rate λ.",
    gen(level, r) {
      const lam = r.pick([0.01, 0.02, 0.005, 0.001, 0.05]);
      const ask = band(level, ["surv", "fail", "median", "reliable", "between"]);
      const t0 = r.pick([10, 20, 50, 100, 200, 500].filter((t) => lam * t >= 0.05 && lam * t <= 3));
      if (ask === "median" || ask === "reliable") {
        const rel = ask === "median" ? 0.5 : r.pick([0.9, 0.95, 0.99, 0.8]);
        const T = -Math.log(rel) / lam;
        return {
          prompt: `A bulb's lifetime is exponential with failure rate λ = ${lam} per hour. `
            + (ask === "median" ? "After how many hours has half of all such bulbs burned out (the median)?"
              : `For what T (in hours) is the reliability P(T_bulb > T) equal to ${rel}?`),
          answer: fmt(T, 2), params: { ask, lam, rel },
          steps: [`e^(−λT) = ${rel}`, `T = −ln(${rel})/λ = ${fmt(T, 2)}`],
          trick: "Take logs: T = −ln(reliability)/λ.",
          mistakes: wrong(fmt(T, 2), [
            { answer: fmt(1 / lam, 2), why: "1/λ is the mean lifetime; the median is ln 2/λ, and reliabilities need their own log." },
            { answer: fmt(rel / lam, 2), why: "Solve e^(−λT) = r with a logarithm, not by dividing r by λ." },
          ]),
        };
      }
      if (ask === "between") {
        const t1 = r.pick([10, 50, 100]), t2 = t1 + r.pick([50, 100, 200]);
        const p = Math.exp(-lam * t1) - Math.exp(-lam * t2);
        return {
          prompt: `A lifetime T is exponential with λ = ${lam}. What is P(${t1} < T < ${t2})?`,
          answer: fmt(p), params: { ask, lam, t1, t2 },
          steps: [`e^(−${lam}·${t1}) − e^(−${lam}·${t2})`, `= ${fmt(p)}`],
          trick: "Subtract the survival function at the two ends.",
          mistakes: wrong(fmt(p), [
            { answer: fmt(lam * (t2 - t1)), why: "λ·Δt is only the small-interval approximation." },
            { answer: fmt(Math.exp(-lam * (t2 - t1))), why: "That is P(T > t₂ − t₁), a survival probability, not the interval." },
          ]),
        };
      }
      const s = Math.exp(-lam * t0);
      const a = ask === "surv" ? s : 1 - s;
      return {
        prompt: `A bulb's lifetime is exponential with failure rate λ = ${lam} per hour. `
          + `What is the probability that it ${ask === "surv" ? "is still working" : "has burned out"} after ${t0} hours?`,
        answer: fmt(a), params: { ask, lam, t0 },
        steps: [`P(T > ${t0}) = e^(−${lam}·${t0}) = ${fmt(s)}`, ...(ask === "fail" ? [`1 − ${fmt(s)} = ${fmt(a)}`] : [])],
        trick: "Survival is e^(−λt); failure is one minus it.",
        mistakes: wrong(fmt(a), [
          { answer: fmt(ask === "surv" ? 1 - s : s), why: "That is the complementary event." },
          { answer: fmt(Math.min(1, lam * t0)), why: "λt is the expected number of failures, only close to a probability when small." },
        ]),
      };
    },
  });

  // ==== 3. Combinatorics ========================================================

  def(["3.1"], {
    id: "gs-arrangements", name: "Arrangements", section: "3.1 Permutations",
    blurb: "n! in a row, (n − 1)! round a table; glue together people who must sit together.",
    gen(level, r) {
      const n = r.int(band(level, [3, 4, 5, 6, 6]), band(level, [5, 6, 7, 8, 9]));
      const fam = r.pick(band(level, [["row"], ["row", "circle"], ["circle", "adjacent", "k"], ["adjacent", "apart", "k"], ["apart", "circle-adj"]]));
      const k = r.int(2, n - 1);
      const [q, ans, steps, mist] = {
        row: [`In how many ways can ${n} people stand in a row for a picture?`, fact(n), [`${n}! = ${fact(n)}`],
          [[n ** n, "No one can stand in two places: n·(n − 1)·…·1, not nⁿ."], [fact(n - 1), "(n − 1)! is for a round table, where rotations are the same."]]],
        circle: [`In how many ways can ${n} people sit round a circular table (only their positions relative to each other matter)?`, fact(n - 1),
          [`fix one person; arrange the other ${n - 1}`, `${n - 1}! = ${fact(n - 1)}`],
          [[fact(n), "Rotating everyone one seat gives the same arrangement: divide by n."], [fact(n - 1) / 2, "Reflections are different here: only rotations are identified."]]],
        adjacent: [`${n} people stand in a row. In how many arrangements are two particular people next to each other?`, 2 * fact(n - 1),
          [`glue the pair: ${n - 1} units, ${n - 1}! orders`, `the pair can face either way: ×2 = ${2 * fact(n - 1)}`],
          [[fact(n - 1), "The two people can stand in either order within the pair: ×2."], [fact(n) - 2 * fact(n - 1), "That counts arrangements where they are *not* together."]]],
        apart: [`${n} people stand in a row. In how many arrangements are two particular people *not* next to each other?`, fact(n) - 2 * fact(n - 1),
          [`all: ${n}! = ${fact(n)}`, `together: 2·${n - 1}! = ${2 * fact(n - 1)}`, `apart: ${fact(n) - 2 * fact(n - 1)}`],
          [[2 * fact(n - 1), "That counts the arrangements where they *are* together."], [fact(n) - fact(n - 1), "The glued pair can face either way: subtract 2·(n − 1)!."]]],
        "circle-adj": [`${n} people sit round a circular table. In how many seatings do two particular people sit next to each other?`, 2 * fact(n - 2),
          [`glue the pair: ${n - 1} units round a table, ${n - 2}! ways`, `×2 for the pair's order = ${2 * fact(n - 2)}`],
          [[2 * fact(n - 1), "Round a table, n − 1 units have (n − 2)! arrangements, not (n − 1)!."], [fact(n - 2), "The pair can sit in either order: ×2."]]],
        k: [`From ${n} applicants, a president, a vice-president${k > 2 ? ` and ${k - 2} other distinct officer${k > 3 ? "s" : ""}` : ""} are chosen (${k} different posts). How many ways?`, fact(n) / fact(n - k),
          [`${n}·${n - 1}·…·${n - k + 1} = ${fact(n) / fact(n - k)}`],
          [[C(n, k), "The posts are different, so order matters: n!/(n − k)!, not C(n, k)."], [n ** k, "One person can't hold two posts."]]],
      }[fam];
      return {
        prompt: q, answer: String(ans), params: { fam, n, k },
        steps, trick: "Count choices place by place; identify arrangements that look the same.",
        mistakes: wrong(String(ans), mist.map(([a, why]) => ({ answer: String(a), why }))),
      };
    },
  });

  def(["3.1"], {
    id: "gs-derangements", name: "Nobody gets their own hat", section: "3.1 Permutations",
    blurb: "Dₙ/n! → 1/e: the chance of no fixed point barely depends on n.",
    gen(level, r) {
      const n = r.int(band(level, [3, 3, 4, 5, 6]), band(level, [4, 5, 6, 8, 10]));
      const D = [1, 0];
      for (let i = 2; i <= n; i++) D[i] = (i - 1) * (D[i - 1] + D[i - 2]);
      const ask = band(level, ["count", "none", "none", "exact", "exact"]);
      if (ask === "count") {
        return {
          prompt: `${n} people check their hats; the hats are handed back at random. In how many of the ${fact(n)} orders does nobody get their own hat?`,
          answer: String(D[n]), params: { ask, n },
          steps: [`Dₙ = (n − 1)(Dₙ₋₁ + Dₙ₋₂), D₁ = 0, D₂ = 1`, `D${n} = ${D[n]}`],
          trick: "Inclusion–exclusion: n!(1 − 1/1! + 1/2! − … ).",
          mistakes: wrong(String(D[n]), [
            { answer: String(fact(n - 1)), why: "(n − 1)! counts the cyclic orders, a smaller set than all derangements." },
            { answer: String(fact(n) - n), why: "Orders with a fixed point number far more than n, and they overlap: use inclusion–exclusion." },
          ]),
        };
      }
      const j = ask === "none" ? 0 : r.int(1, Math.min(3, n - 2));
      const a = F(C(n, j) * D[n - j], fact(n));
      return {
        prompt: `${n} letters are put at random into ${n} addressed envelopes. What is the probability that exactly ${j} letter${j === 1 ? "" : "s"} go${j === 1 ? "es" : ""} in the right envelope?`,
        answer: str(a), params: { ask, n, j },
        steps: [`choose the ${j} fixed: C(${n}, ${j}) = ${C(n, j)}`, `derange the rest: D${n - j} = ${D[n - j]}`, `P = ${C(n, j) * D[n - j]}/${fact(n)} = ${str(a)}`],
        trick: "Fix the ones that match, then none of the rest may.",
        mistakes: wrong(str(a), [
          { answer: fmt(Math.exp(-1) / fact(j), 4), why: "e^(−1)/j! is the large-n limit; for small n compute exactly." },
          { answer: str(F(C(n, j) * fact(n - j) - (j ? 0 : 1), fact(n))), why: "The other letters must *all* miss: derange them, don't permute them freely." },
          { answer: str(F(C(n, j), n ** j)), why: "The letters are not placed independently: it's a random permutation." },
        ]),
      };
    },
  });

  def(["3.1"], {
    id: "gs-birthday", name: "The birthday problem", section: "3.1 Permutations",
    blurb: "P(all different) = (d)(d − 1)…(d − n + 1)/dⁿ; the match comes sooner than you think.",
    gen(level, r) {
      const d = r.pick(band(level, [[12, 365], [365], [365], [365, 52], [365, 100, 1000]]));
      if (level === 5) {
        const target = r.pick([0.5, 0.75, 0.9]);
        let n = 1, allDiff = 1;
        while (1 - allDiff < target) { allDiff *= (d - n) / d; n++; }
        return {
          prompt: `Birthdays are uniform over ${d} days. What is the smallest group size for which the chance of a shared birthday is at least ${target}?`,
          answer: String(n), params: { d, target, ask: "n" },
          steps: [`multiply (1 − k/${d}) for k = 1, 2, … until the product falls to ${1 - target}`, `n = ${n}`],
          trick: "Pairs grow like n²/2, so n ≈ √(2d·ln(1/(1 − target))).",
          mistakes: wrong(String(n), [
            { answer: String(Math.ceil(target * d)), why: "Matches can come from any pair, and there are C(n, 2) pairs." },
            { answer: String(Math.ceil(Math.sqrt(d))), why: "√d is the right scale, but the constant matters: solve the product." },
          ]),
        };
      }
      const n = r.int(band(level, [3, 10, 15, 20, 5]), band(level, [6, 25, 40, 60, 30]));
      let allDiff = 1;
      for (let k = 1; k < n; k++) allDiff *= (d - k) / d;
      const p = 1 - allDiff;
      return {
        prompt: `${n} people${d === 12 ? " are asked their birth month (12 equally likely months)" : ` have birthdays uniform over ${d} days`}. `
          + `What is the probability that at least two share one?`,
        answer: fmt(p), params: { d, n, ask: "p" },
        steps: [`P(all different) = ∏_{k<${n}} (1 − k/${d}) = ${fmt(allDiff)}`, `1 − ${fmt(allDiff)} = ${fmt(p)}`],
        trick: "Count the complement: everyone different.",
        mistakes: wrong(fmt(p), [
          { answer: fmt(Math.min(1, n / d)), why: "The match can be between any two people, not with one fixed birthday." },
          { answer: fmt(Math.min(1, (n * (n - 1)) / 2 / d)), why: "Adding 1/d per pair overcounts once matches are likely; use the product." },
          { answer: fmt(1 - (1 - 1 / d) ** (n - 1)), why: "That is the chance someone shares *your* birthday." },
        ]),
      };
    },
  });

  def(["3.2"], {
    id: "gs-binomial", name: "Binomial probabilities", section: "3.2 Combinations",
    blurb: "b(n, p, k) = C(n, k)pᵏqⁿ⁻ᵏ; add them up for “at least”.",
    gen(level, r) {
      const b = (n, p, k) => C(n, k) * p ** k * (1 - p) ** (n - k);
      const fam = band(level, ["exact", "exact", "atleast", "engines", "guess"]);
      if (fam === "engines") {
        const n = r.pick([3, 4, 5, 6]), m = r.int(1, n - 1), p = r.pick([0.9, 0.95, 0.99, 0.8]);
        let s = 0;
        for (let k = m; k <= n; k++) s += b(n, p, k);
        return {
          prompt: `Each of the ${n} engines on a plane works on a flight with probability ${p}, independently. The plane lands safely if at least ${m} work. What is the probability of a safe landing?`,
          answer: fmt(s, 6), params: { fam, n, m, p }, tolerance: 1e-5,
          steps: [`Σ_{k=${m}}^{${n}} C(${n},k)(${p})^k(${fmt(1 - p, 2)})^{${n}−k}`, `= ${fmt(s, 6)}`],
          trick: "Often easier: one minus the chance that fewer than m work.",
          mistakes: wrong(fmt(s, 6), [
            { answer: fmt(p ** m, 6), why: "Any m of the engines will do, and the others may work too: sum the binomial terms." },
            { answer: fmt(b(n, p, m), 6), why: "“At least m” includes m + 1, …, n working as well." },
          ]),
        };
      }
      if (fam === "guess") {
        const n = r.pick([10, 12, 15, 20]), k = Math.ceil(n * r.pick([0.7, 0.75, 0.8]));
        let s = 0;
        for (let j = k; j <= n; j++) s += b(n, 0.5, j);
        return {
          prompt: `Charles claims he can tell beer from ale. He is given ${n} glasses and just guesses each one. What is the probability he gets at least ${k} right?`,
          answer: fmt(s, 5), params: { fam, n, k }, tolerance: 1e-4,
          steps: [`S ~ Binomial(${n}, 1/2)`, `P(S ≥ ${k}) = Σ C(${n}, j)/2^${n} = ${fmt(s, 5)}`],
          trick: "Under guessing, every one of the 2ⁿ answer patterns is equally likely.",
          mistakes: wrong(fmt(s, 5), [
            { answer: fmt(b(n, 0.5, k), 5), why: "At least k: add j = k, …, n." },
            { answer: fmt((n - k + 1) / (n + 1), 5), why: "The counts are not uniform: middle counts are far more likely than extremes." },
          ]),
        };
      }
      const n = r.int(3, band(level, [5, 8, 10, 12, 12])), p = r.pick([0.2, 0.3, 0.5, 0.6]);
      const k = r.int(1, n - 1);
      if (fam === "atleast") {
        let s = 0;
        for (let j = k; j <= n; j++) s += b(n, p, j);
        return {
          prompt: `In ${n} independent trials with success probability ${p}, what is the probability of at least ${k} successes?`,
          answer: fmt(s, 5), params: { fam, n, p, k }, tolerance: 1e-4,
          steps: [`Σ_{j=${k}}^{${n}} b(${n}, ${p}, j) = ${fmt(s, 5)}`],
          trick: "If k is small, 1 − P(fewer than k) is fewer terms.",
          mistakes: wrong(fmt(s, 5), [
            { answer: fmt(b(n, p, k), 5), why: "That is exactly k; “at least” adds the terms above k." },
            { answer: fmt(1 - s + b(n, p, k), 5), why: "That is P(at most k)." },
          ]),
        };
      }
      const a = b(n, p, k);
      return {
        prompt: `Compute $b(${n}, ${p}, ${k})$: the probability of exactly ${k} successes in ${n} trials with success probability ${p}.`,
        answer: fmt(a, 5), params: { fam, n, p, k }, tolerance: 1e-4,
        steps: [`C(${n}, ${k}) = ${C(n, k)}`, `${C(n, k)}·${p}^${k}·${fmt(1 - p, 2)}^${n - k} = ${fmt(a, 5)}`],
        trick: "Count the arrangements, then multiply by one arrangement's probability.",
        mistakes: wrong(fmt(a, 5), [
          { answer: fmt(p ** k * (1 - p) ** (n - k), 5), why: `That is one particular order; there are C(${n}, ${k}) of them.` },
          { answer: fmt(C(n, k) * p ** k, 5), why: "The other n − k trials must fail: multiply by qⁿ⁻ᵏ." },
        ]),
      };
    },
  });

  def(["3.2"], {
    id: "gs-counting", name: "Choosing and dealing", section: "3.2 Combinations",
    blurb: "C(n, k) when order doesn't matter; multinomials for several kinds.",
    gen(level, r) {
      const fam = r.pick(band(level, [["committee"], ["committee", "season"], ["season", "aces"], ["aces", "mixed"], ["mixed", "aces", "season"]]));
      if (fam === "committee") {
        const n = r.int(5, 15), k = r.int(2, Math.min(6, n - 1));
        return {
          prompt: `How many different ${k}-person committees can be chosen from ${n} people?`,
          answer: String(C(n, k)), params: { fam, n, k },
          steps: [`C(${n}, ${k}) = ${n}!/(${k}!·${n - k}!) = ${C(n, k)}`],
          trick: "A committee has no order: divide the ordered count by k!.",
          mistakes: wrong(String(C(n, k)), [
            { answer: String(fact(n) / fact(n - k)), why: "That counts ordered selections; a committee is unordered: divide by k!." },
            { answer: String(n * k), why: "Choose a set, not one person per seat independently." },
          ]),
        };
      }
      if (fam === "season") {
        const w = r.int(1, 5), l = r.int(1, 5), t = r.int(1, 4), n = w + l + t;
        const a = fact(n) / (fact(w) * fact(l) * fact(t));
        return {
          prompt: `A team plays ${n} games, winning ${w}, losing ${l} and tying ${t}. In how many orders can this season happen?`,
          answer: String(a), params: { fam, w, l, t },
          steps: [`${n}!/(${w}!·${l}!·${t}!) = ${a}`],
          trick: "Arrange n letters with repeats: divide by the repeats' orders.",
          mistakes: wrong(String(a), [
            { answer: String(fact(n)), why: "Swapping two wins gives the same season: divide by w!·l!·t!." },
            { answer: String(C(n, w)), why: "After placing the wins, the losses still have C(n − w, l) positions." },
          ]),
        };
      }
      if (fam === "aces") {
        const j = r.int(0, 3);
        const a = F(C(4, j) * C(48, 5 - j), C(52, 5));
        return {
          prompt: `A 5-card poker hand is dealt from a 52-card deck. What is the probability that it contains exactly ${j} ace${j === 1 ? "" : "s"}?`,
          answer: str(a), params: { fam, j },
          steps: [`C(4, ${j})·C(48, ${5 - j}) = ${C(4, j) * C(48, 5 - j)}`, `÷ C(52, 5) = ${C(52, 5)}`, `= ${str(a)}`],
          trick: "Choose the aces and the non-aces separately, then multiply.",
          mistakes: wrong(str(a), [
            { answer: str(F(C(5, j) * 4 ** j * 48 ** (5 - j), 52 ** 5)), why: "Cards are dealt without replacement: use the hypergeometric count, not the binomial." },
            { answer: str(F(C(4, j), C(52, 5))), why: `The other ${5 - j} cards must be chosen too: multiply by C(48, ${5 - j}).` },
          ]),
        };
      }
      const colors = r.int(3, 4), nails = 5, most = 2;
      // "at most two of the colors" on 5 nails (ex. 3.2.21 generalised to c colours)
      const a = colors + C(colors, 2) * (2 ** nails - 2);
      return {
        prompt: `She colours the ${nails} fingernails on one hand, each with one of ${colors} colours, using at most ${most} different colours. How many ways?`,
        answer: String(a), params: { fam, colors, nails },
        steps: [`one colour: ${colors}`, `exactly two: C(${colors}, 2)·(2^${nails} − 2) = ${C(colors, 2) * (2 ** nails - 2)}`, `total ${a}`],
        trick: "Split by the number of colours actually used.",
        mistakes: wrong(String(a), [
          { answer: String(C(colors, 2) * 2 ** nails), why: "Two-colour patterns that use only one colour are counted twice (and are already in the one-colour case)." },
          { answer: String(colors ** nails), why: "That allows all the colours at once." },
        ]),
      };
    },
  });

  def(["3.3"], {
    id: "gs-rising-sequences", name: "Rising sequences", section: "3.3 Card Shuffling",
    blurb: "A rising sequence is a maximal run of consecutive values in increasing position.",
    gen(level, r) {
      const n = r.int(band(level, [5, 6, 7, 8, 9]), band(level, [6, 7, 9, 11, 13]));
      let perm;
      if (level <= 2 || r() < 0.5) {
        // a riffle: cut, then interleave, so there are at most 2 rising sequences
        const cut = r.int(1, n - 1);
        const L = Array.from({ length: cut }, (_, i) => i + 1), R = Array.from({ length: n - cut }, (_, i) => cut + i + 1);
        perm = [];
        while (L.length || R.length) {
          const pl = L.length / (L.length + R.length);
          perm.push(r() < pl ? L.shift() : R.shift());
        }
        if (level >= 4) for (let k = 0; k < level - 3; k++) { const i = r.int(0, n - 2); [perm[i], perm[i + 1]] = [perm[i + 1], perm[i]]; }
      } else {
        perm = Array.from({ length: n }, (_, i) => i + 1);
        for (let i = n - 1; i > 0; i--) { const j = r.int(0, i); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      }
      const pos = [];
      perm.forEach((v, i) => { pos[v] = i; });
      let seqs = 1;
      for (let v = 1; v < n; v++) if (pos[v + 1] < pos[v]) seqs++;
      let runs = 1;
      for (let i = 1; i < n; i++) if (perm[i] < perm[i - 1]) runs++;
      return {
        prompt: `A deck of ${n} cards, originally in order 1–${n}, now reads (top to bottom) ${perm.join(", ")}. How many rising sequences does it have?`,
        answer: String(seqs), params: { perm },
        steps: [`read 1, 2, 3, … and start a new sequence each time the next value lies above the current one`, `${seqs} rising sequence${seqs === 1 ? "" : "s"}`],
        trick: "One riffle shuffle leaves at most 2 rising sequences; k riffles, at most 2ᵏ.",
        mistakes: wrong(String(seqs), [
          { answer: String(runs), why: "That counts increasing runs of adjacent cards; rising sequences follow consecutive *values* wherever they sit." },
          { answer: String(seqs + 1), why: "Start a new sequence only when value v + 1 lies above v." },
        ]),
      };
    },
  });

  // ==== 4. Conditional probability =============================================

  def(["4.1"], {
    id: "gs-conditional-draws", name: "Conditioning on a sum", section: "4.1 Discrete Conditional Probability",
    blurb: "Restrict the sample space to the outcomes with that sum, then count.",
    gen(level, r) {
      const decks = [[1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10], [1, 2, 3], [1, 2, 3, 4]];
      const deck = level <= 2 ? [1, 2, 3, 4, 5, 6] : r.pick(decks);
      const t = level <= 2 ? 2 : r.pick([2, 3]);
      const outcomes = [];
      const rec = (acc) => { if (acc.length === t) { outcomes.push(acc); return; } for (const v of deck) rec([...acc, v]); };
      rec([]);
      const sums = [...new Set(outcomes.map((o) => o.reduce((a, b) => a + b, 0)))].sort((a, b) => a - b);
      for (;;) {
        const s = r.pick(sums);
        const given = outcomes.filter((o) => o.reduce((a, b) => a + b, 0) === s);
        const v = r.pick(deck), j = r.int(1, t);
        const events = [
          [`a ${v} appears exactly ${j} time${j === 1 ? "" : "s"}`, (o) => o.filter((x) => x === v).length === j],
          [`at least one ${v} appears`, (o) => o.includes(v)],
          [`all the draws are equal`, (o) => o.every((x) => x === o[0])],
        ];
        const [name, test] = r.pick(events);
        const hit = given.filter(test).length;
        if (hit === 0 || hit === given.length || given.length < 2) continue;
        const a = F(hit, given.length);
        const uncond = F(outcomes.filter(test).length, outcomes.length);
        const setup = deck.length === 6 && deck[0] === 1
          ? `A fair die is rolled ${t === 2 ? "twice" : "three times"}.`
          : `From a deck of ${deck.length} cards numbered ${deck.join(", ")}, a card is drawn at random and replaced; this is done ${t === 2 ? "twice" : "three times"}.`;
        return {
          prompt: `${setup} Given that the sum is ${s}, what is the probability that ${name}?`,
          answer: str(a), params: { deck, t, s, event: name },
          steps: [`outcomes with sum ${s}: ${given.length}`, `of those, ${hit} have the event`, `P = ${hit}/${given.length} = ${str(a)}`],
          trick: "Conditioning shrinks the sample space; the survivors stay equally likely.",
          mistakes: wrong(str(a), [
            { answer: str(uncond), why: "That ignores the condition: count only outcomes with the given sum." },
            { answer: str(F(hit, outcomes.length)), why: "That is P(event and sum); divide by P(sum) to condition." },
          ]),
        };
      }
    },
  });

  def(["4.1"], {
    id: "gs-urns-bayes", name: "Which urn was it?", section: "4.1 Discrete Conditional Probability",
    blurb: "P(urn | ball) = P(ball | urn)P(urn) / P(ball).",
    gen(level, r) {
      for (;;) {
        const a = r.int(1, 6), b = r.int(1, 6), c = r.int(1, 6), d = r.int(1, 6);
        const prior = level <= 2 ? F(1, 2) : r.pick([F(1, 2), F(1, 3), F(2, 3), F(1, 4)]);
        const pw1 = F(a, a + b), pw2 = F(c, c + d);
        if (pw1.n * pw2.d === pw2.n * pw1.d) continue;
        const joint = mul(prior, pw1);
        const pw = add(joint, mul(sub(ONE, prior), pw2));
        const post = div(joint, pw);
        const how = prior.n === 1 && prior.d === 2 ? "chosen by tossing a fair coin" : `chosen, urn I with probability ${str(prior)}`;
        return {
          prompt: `Urn I holds ${a} white and ${b} black balls; urn II holds ${c} white and ${d} black. An urn is ${how}, and a ball drawn from it is white. What is the probability that it came from urn I?`,
          answer: str(post), params: { a, b, c, d, prior: str(prior) },
          steps: [`P(white) = ${str(prior)}·${str(pw1)} + ${str(sub(ONE, prior))}·${str(pw2)} = ${str(pw)}`, `P(I | white) = ${str(joint)}/${str(pw)} = ${str(post)}`],
          trick: "Weigh each urn by how likely it was to produce what you saw.",
          mistakes: wrong(str(post), [
            { answer: str(pw1), why: "That is P(white | urn I); Bayes turns it around." },
            { answer: str(prior), why: "The draw is evidence: it should move you off the prior." },
            { answer: str(F(a, a + c)), why: "Pooling the white balls only works when the urns are equally likely *and* equally full." },
          ]),
        };
      }
    },
  });

  def(["4.1"], {
    id: "gs-independent-events", name: "Independent events", section: "4.1 Discrete Conditional Probability",
    blurb: "Independent: P(A ∩ B) = P(A)P(B), so P(A ∪ B) = P(A) + P(B) − P(A)P(B).",
    gen(level, r) {
      const pa = F(r.int(1, 5), r.pick([6, 8, 10])), pb = F(r.int(1, 3), r.pick([4, 5, 6]));
      const both = mul(pa, pb);
      const asks = band(level, [["and"], ["and", "or"], ["or", "neither"], ["neither", "onlyA", "exactly"], ["exactly", "givenOr"]]);
      const ask = r.pick(asks);
      const union = sub(add(pa, pb), both);
      const [q, ans, steps, mist] = {
        and: ["both happen", both, [`P(A)P(B) = ${str(both)}`], [[add(pa, pb), "“And” multiplies for independent events; adding is for disjoint ones and “or”."], [pa.n * pb.d < pb.n * pa.d ? pa : pb, "The smaller probability is only an upper bound."]]],
        or: ["at least one happens", union, [`P(A) + P(B) − P(A)P(B) = ${str(union)}`], [[add(pa, pb), "Subtract P(A ∩ B): otherwise it's counted twice."], [both, "That is both, not at least one."]]],
        neither: ["neither happens", sub(ONE, union), [`(1 − P(A))(1 − P(B)) = ${str(sub(ONE, union))}`], [[sub(ONE, both), "That is P(not both), which includes exactly one happening."], [mul(sub(ONE, pa), pb), "That is B without A."]]],
        onlyA: ["A happens but B doesn't", mul(pa, sub(ONE, pb)), [`P(A)(1 − P(B)) = ${str(mul(pa, sub(ONE, pb)))}`], [[sub(pa, pb), "Subtract P(A ∩ B) from P(A), not P(B)."], [pa, "Some of A's probability is shared with B."]]],
        exactly: ["exactly one happens", sub(union, both), [`P(A ∪ B) − P(A ∩ B) = ${str(sub(union, both))}`], [[union, "That includes both happening."], [add(pa, pb), "Remove the overlap twice: P(A) + P(B) − 2P(A ∩ B)."]]],
        givenOr: ["A happens, given that at least one happens", div(pa, union), [`P(A)/P(A ∪ B) = ${str(pa)}/${str(union)} = ${str(div(pa, union))}`], [[pa, "Conditioning on A ∪ B raises A's probability: divide by P(A ∪ B)."], [div(both, union), "A happens whether or not B does: the numerator is P(A)."]]],
      }[ask];
      return {
        prompt: `A and B are independent, with P(A) = ${str(pa)} and P(B) = ${str(pb)}. What is the probability that ${q}?`,
        answer: str(ans), params: { pa: str(pa), pb: str(pb), ask },
        steps, trick: "Draw the Venn diagram: four regions, each a product.",
        mistakes: wrong(str(ans), mist.map(([a, why]) => ({ answer: str(a), why }))),
      };
    },
  });

  def(["4.2", "4.2#3"], {
    id: "gs-continuous-conditional", name: "Conditioning on a continuous event", section: "4.2 Continuous Conditional Probability",
    blurb: "Uniform stays uniform on the smaller set; the exponential forgets its past.",
    gen(level, r) {
      const fam = r.pick(band(level, [["uniform"], ["uniform", "memoryless"], ["laplace", "uniform"], ["laplace", "memoryless"], ["laplace", "uniform"]]));
      if (fam === "uniform") {
        const d = r.pick([4, 5, 6, 8, 10]);
        const lo = r.int(0, d - 3), a = r.int(lo + 1, d - 1);
        const ans = F(d - a, d - lo);
        return {
          prompt: `x is chosen uniformly from [0, 1]. What is the probability that $x > ${tex(F(a, d))}$, given that $x > ${tex(F(lo, d))}$?`,
          answer: str(ans), params: { fam, a: str(F(a, d)), lo: str(F(lo, d)) },
          steps: [`given x > ${str(F(lo, d))}, x is uniform on [${str(F(lo, d))}, 1]`, `P = (1 − ${str(F(a, d))})/(1 − ${str(F(lo, d))}) = ${str(ans)}`],
          trick: "Condition by renormalising the density on the event.",
          mistakes: wrong(str(ans), [
            { answer: str(F(d - a, d)), why: "That ignores the condition: divide by P(x > lower bound)." },
            { answer: str(F(a - lo, d - lo)), why: "That is the chance x lies below the threshold." },
          ]),
        };
      }
      if (fam === "memoryless") {
        const lam = r.pick([0.1, 0.2, 0.5, 0.05]), s = r.int(1, 10), t = r.int(1, 10);
        const p = Math.exp(-lam * t);
        return {
          prompt: `A waiting time T is exponential with λ = ${lam}. You have already waited ${s} minutes. What is the probability you wait more than ${t} further minutes?`,
          answer: fmt(p), params: { fam, lam, s, t },
          steps: [`P(T > ${s + t} | T > ${s}) = e^(−λ(${s + t}))/e^(−λ·${s})`, `= e^(−${lam}·${t}) = ${fmt(p)}`],
          trick: "Memoryless: the time already spent doesn't matter.",
          mistakes: wrong(fmt(p), [
            { answer: fmt(Math.exp(-lam * (s + t))), why: "That is P(T > s + t) from the start; conditioning on T > s divides by e^(−λs)." },
            { answer: fmt(Math.exp(-lam * s)), why: "The time already waited drops out; only the further t matters." },
          ]),
        };
      }
      const j = r.int(0, band(level, [3, 3, 5, 8, 12])), k = r.int(0, band(level, [3, 3, 5, 8, 12]));
      const ans = F(j + 1, j + k + 2);
      return {
        prompt: `A coin's bias p is unknown and taken to be uniform on [0, 1]. In ${j + k} tosses it shows ${j} heads and ${k} tails. What is the probability that the next toss is heads?`,
        answer: str(ans), params: { fam, j, k },
        steps: [`posterior density ∝ p^${j}(1 − p)^${k} (a beta density)`, `P(heads) = E[p | data] = (${j} + 1)/(${j + k} + 2) = ${str(ans)}`],
        trick: "Laplace's rule of succession: add one head and one tail, then take the proportion.",
        mistakes: wrong(str(ans), [
          { answer: str(F(j, Math.max(1, j + k))), why: "The observed proportion ignores the uniform prior, which adds one of each." },
          { answer: "1/2", why: "The tosses are evidence about p: the prediction should move." },
        ]),
      };
    },
  });

  def(["4.3"], {
    id: "gs-paradoxes", name: "Box paradox and Monty Hall", section: "4.3 Paradoxes",
    blurb: "Seeing gold favours the drawers with more gold; the host's choice carries information.",
    gen(level, r) {
      if (level <= 2 || r() < 0.5) {
        const gg = r.int(1, 3), gs = r.int(1, 3), ss = r.int(0, 3);
        const ans = F(2 * gg, 2 * gg + gs);
        return {
          prompt: `A cabinet has ${gg + gs + ss} drawers of two coins each: ${gg} with two gold coins, ${gs} with one gold and one silver, ${ss} with two silver. A drawer is chosen at random and a coin taken from it at random; it is gold. What is the probability the other coin in the drawer is gold?`,
          answer: str(ans), params: { gg, gs, ss, fam: "box" },
          steps: [`gold coins: ${2 * gg} in gold–gold drawers, ${gs} in mixed drawers`, `each gold coin is equally likely to be the one drawn`, `P = ${2 * gg}/${2 * gg + gs} = ${str(ans)}`],
          trick: "Count gold coins, not drawers.",
          mistakes: wrong(str(ans), [
            { answer: str(F(gg, gg + gs)), why: "A gold–gold drawer is twice as likely to produce a gold coin: count coins, not drawers." },
            { answer: "1/2", why: "The gold coin is evidence: it favours the drawers with more gold." },
          ]),
        };
      }
      const n = r.int(3, 10), m = r.int(1, n - 2);
      const ans = F(n - 1, n * (n - m - 1));
      return {
        prompt: `Monty Hall with ${n} doors: you pick one; the host, who knows where the car is, opens ${m} other door${m === 1 ? "" : "s"}, all empty. You switch to one of the remaining closed doors at random. What is your probability of winning?`,
        answer: str(ans), params: { n, m, fam: "monty" },
        steps: [`P(first pick wrong) = ${n - 1}/${n}`, `then the car is among the ${n - m - 1} other closed doors`, `P = ${n - 1}/${n}·1/${n - m - 1} = ${str(ans)}`],
        trick: "Your first pick keeps its 1/n; the rest flows to the doors the host left closed.",
        mistakes: wrong(str(ans), [
          { answer: str(F(1, n - m)), why: "The doors left aren't equally likely: your original door keeps probability 1/n." },
          { answer: str(F(1, n)), why: "That is staying, not switching." },
        ]),
      };
    },
  });

  // ==== 5. Important distributions and densities ================================

  def(["5.1"], {
    id: "gs-poisson", name: "Poisson approximation", section: "5.1 Important Distributions",
    blurb: "Rare events in many trials: λ = np, P(k) = e^(−λ)λᵏ/k!.",
    gen(level, r) {
      const pmf = (lam, k) => Math.exp(-lam) * lam ** k / fact(k);
      const fam = band(level, ["exact", "atmost", "atmost", "bombs", "coins"]);
      if (fam === "bombs") {
        const N = 576, hits = r.pick([537, 500, 600, 450]), k = r.int(0, 3);
        const lam = hits / N, e = N * pmf(lam, k);
        return {
          prompt: `An area is divided into ${N} squares and ${hits} bombs fall on it at random. Using the Poisson approximation, how many squares do you expect to receive exactly ${k} hit${k === 1 ? "" : "s"}?`,
          answer: fmt(e, 2), params: { fam, N, hits, k }, tolerance: 0.005,
          steps: [`λ = ${hits}/${N} = ${fmt(lam)}`, `P(${k}) = e^(−λ)λ^${k}/${k}! = ${fmt(pmf(lam, k))}`, `${N}·P = ${fmt(e, 2)}`],
          trick: "Expected number of squares = squares × P(one square has k).",
          mistakes: wrong(fmt(e, 2), [
            { answer: fmt(pmf(lam, k), 4), why: "That is the probability for one square; multiply by the number of squares." },
            { answer: fmt(N * lam ** k / fact(k), 2), why: "Include the factor e^(−λ)." },
          ]),
        };
      }
      if (fam === "coins") {
        const boxes = r.pick([100, 500, 1000]), per = boxes;
        const p = 1 - (1 - 1 / per) ** boxes;
        return {
          prompt: `Each box holds ${per} coins, one of them counterfeit. One coin is tested from each of ${boxes} boxes. What is the probability of finding at least one fake?`,
          answer: fmt(p), params: { fam, boxes, per },
          steps: [`P(none) = (1 − 1/${per})^${boxes} ≈ e^(−1) ≈ 0.3679`, `P(at least one) = ${fmt(p)}`],
          trick: "(1 − 1/n)ⁿ ≈ 1/e: the Poisson limit with λ = 1.",
          mistakes: wrong(fmt(p), [
            { answer: "1", why: "Testing one coin per box can miss every fake." },
            { answer: fmt((1 - 1 / per) ** boxes), why: "That is the chance of finding none." },
          ]),
        };
      }
      let n, p;
      do { n = r.pick([100, 500, 1000, 3600]); p = r.pick([0.001, 0.002, 0.005, 0.01]); } while (n * p < 0.2 || n * p > 8);
      const lam = n * p, k = r.int(0, Math.max(2, Math.round(lam) + 1));
      if (fam === "atmost") {
        let s = 0;
        for (let j = 0; j <= k; j++) s += pmf(lam, j);
        return {
          prompt: `In ${n} independent trials, each succeeding with probability ${p}, use the Poisson approximation to find P(at most ${k} successes).`,
          answer: fmt(s), params: { fam, n, p, k },
          steps: [`λ = ${n}·${p} = ${fmt(lam)}`, `Σ_{j≤${k}} e^(−λ)λʲ/j! = ${fmt(s)}`],
          trick: "Poisson needs only the mean λ = np.",
          mistakes: wrong(fmt(s), [
            { answer: fmt(pmf(lam, k)), why: "At most k: add j = 0, …, k." },
            { answer: fmt(1 - s), why: "That is P(more than k)." },
          ]),
        };
      }
      const a = pmf(lam, k);
      return {
        prompt: `A switchboard gets a call in any given second with probability ${p}. Over ${n} seconds, use the Poisson approximation to find the probability of exactly ${k} calls.`,
        answer: fmt(a), params: { fam, n, p, k },
        steps: [`λ = ${fmt(lam)}`, `e^(−${fmt(lam)})·${fmt(lam)}^${k}/${k}! = ${fmt(a)}`],
        trick: "λ is the expected count.",
        mistakes: wrong(fmt(a), [
          { answer: fmt(lam ** k / fact(k)), why: "The e^(−λ) factor makes the probabilities sum to 1." },
          { answer: fmt(Math.exp(-lam)), why: "That is P(0), no calls at all." },
        ]),
      };
    },
  });

  def(["5.1"], {
    id: "gs-min-uniform", name: "The smallest of n rolls", section: "5.1 Important Distributions",
    blurb: "P(min ≥ j) = ((k − j + 1)/k)ⁿ; subtract neighbours to get P(min = j).",
    gen(level, r) {
      const k = r.pick(band(level, [[6], [6], [6, 10], [6, 10, 20], [10, 20]]));
      const n = r.int(2, band(level, [2, 3, 4, 5, 6]));
      const ask = r.pick(level <= 2 ? ["min"] : ["min", "max"]);
      const j = r.int(1, k);
      const num = ask === "min" ? (k - j + 1) ** n - (k - j) ** n : j ** n - (j - 1) ** n;
      const a = F(num, k ** n);
      const what = k === 6 ? `${n} dice are rolled` : `${n} numbers are drawn independently and uniformly from 1–${k}`;
      return {
        prompt: `${what[0].toUpperCase()}${what.slice(1)}. What is the probability that the ${ask === "min" ? "smallest" : "largest"} is exactly ${j}?`,
        answer: str(a), params: { k, n, j, ask },
        steps: ask === "min"
          ? [`P(min ≥ ${j}) = (${k - j + 1}/${k})^${n}`, `P(min ≥ ${j + 1}) = (${k - j}/${k})^${n}`, `difference = ${str(a)}`]
          : [`P(max ≤ ${j}) = (${j}/${k})^${n}`, `P(max ≤ ${j - 1}) = (${j - 1}/${k})^${n}`, `difference = ${str(a)}`],
        trick: "Work with P(all at least j), which factorises; then take differences.",
        mistakes: wrong(str(a), [
          { answer: str(F(1, k)), why: "The extreme of several draws isn't uniform." },
          { answer: str(F(ask === "min" ? (k - j + 1) ** n : j ** n, k ** n)), why: `That is P(${ask === "min" ? "min ≥" : "max ≤"} ${j}); subtract the next one.` },
          { answer: str(F(n * (ask === "min" ? (k - j) : (j - 1)) ** (n - 1), k ** n)), why: "Exactly one draw at j undercounts: several draws may equal j." },
        ]),
      };
    },
  });

  def(["5.1"], {
    id: "gs-geometric", name: "Geometric and negative binomial", section: "5.1 Important Distributions",
    blurb: "Waiting for the r-th success: C(k − 1, r − 1)pʳqᵏ⁻ʳ.",
    gen(level, r) {
      const p = r.pick([F(1, 2), F(1, 6), F(1, 3), F(1, 4)]), q = sub(ONE, p);
      const ask = band(level, ["mean", "tail", "tail", "negbin", "negbin"]);
      if (ask === "mean") {
        const rr = r.int(1, 4);
        const e = F(rr * p.d, p.n);
        return {
          prompt: `Trials succeed independently with probability ${str(p)}. What is the expected number of trials until the ${rr === 1 ? "first" : `${rr}${["", "st", "nd", "rd", "th"][Math.min(rr, 4)]}`} success?`,
          answer: str(e), params: { ask, p: str(p), rr },
          steps: [`each success takes 1/p = ${str(div(ONE, p))} trials on average`, `${rr}·${str(div(ONE, p))} = ${str(e)}`],
          trick: "Waiting times add: r successes take r/p trials on average.",
          mistakes: wrong(str(e), [
            { answer: str(mul(F(rr), div(q, p))), why: "q/p counts the failures before each success; include the success itself." },
            { answer: str(mul(F(rr), p)), why: "Rarer successes take longer: 1/p, not p." },
          ]),
        };
      }
      const k = r.int(2, 8);
      if (ask === "tail") {
        const a = pow(q, k);
        return {
          prompt: `Trials succeed with probability ${str(p)}. What is the probability that more than ${k} trials are needed for the first success?`,
          answer: str(a), params: { ask, p: str(p), k },
          steps: [`more than ${k} trials ⇔ the first ${k} all fail`, `(${str(q)})^${k} = ${str(a)}`],
          trick: "“More than k trials” is just k failures in a row.",
          mistakes: wrong(str(a), [
            { answer: str(mul(pow(q, k), p)), why: "That is P(first success on trial k + 1) only; later successes count too." },
            { answer: str(pow(q, k - 1)), why: `More than ${k} trials needs ${k} failures, not ${k - 1}.` },
          ]),
        };
      }
      const rr = r.int(2, 3), kk = r.int(rr, rr + 5);
      const a = mul(F(C(kk - 1, rr - 1)), mul(pow(p, rr), pow(q, kk - rr)));
      return {
        prompt: `Trials succeed with probability ${str(p)}. What is the probability that the ${rr === 2 ? "second" : "third"} success comes on trial ${kk}?`,
        answer: str(a), params: { ask, p: str(p), rr, kk },
        steps: [`trial ${kk} succeeds, and ${rr - 1} of the first ${kk - 1} succeed`, `C(${kk - 1}, ${rr - 1})·(${str(p)})^${rr}·(${str(q)})^${kk - rr} = ${str(a)}`],
        trick: "The last trial is fixed as a success; arrange only the ones before it.",
        mistakes: wrong(str(a), [
          { answer: str(mul(F(C(kk, rr)), mul(pow(p, rr), pow(q, kk - rr)))), why: `The ${kk}th trial must be the success: choose from the first ${kk - 1} only.` },
          { answer: str(mul(pow(p, rr), pow(q, kk - rr))), why: "That is one arrangement; the earlier successes can be anywhere before the last." },
        ]),
      };
    },
  });

  def(["5.2", "5.2#3"], {
    id: "gs-normal", name: "Normal tolerances", section: "5.2 Important Densities",
    blurb: "Standardise: z = (x − μ)/σ, then read Φ(z).",
    gen(level, r) {
      const mu = r.pick([1, 10, 50, 100]), sigma = r.pick([0.5, 1, 2, 5, 0.002]) * (mu === 1 ? 0.001 : 1);
      const s = mu === 1 ? 0.002 : sigma;
      const ask = band(level, ["below", "within", "within", "outside", "above"]);
      const k = r.pick([0.5, 1, 1.5, 2, 2.5, 3]);
      if (ask === "within" || ask === "outside") {
        const inside = 2 * Phi(k) - 1;
        const a = ask === "within" ? inside : 1 - inside;
        const tol = +(k * s).toFixed(4);
        return {
          prompt: `Shaft diameters are normal with mean ${mu} and standard deviation ${s}. Specifications require ${mu} ± ${tol}. What fraction of shafts ${ask === "within" ? "meet" : "fail"} the specification?`,
          answer: fmt(a), params: { ask, k }, tolerance: 0.005,
          steps: [`z = ${tol}/${s} = ${k}`, `P(|Z| < ${k}) = 2Φ(${k}) − 1 = ${fmt(inside)}`, ...(ask === "outside" ? [`1 − ${fmt(inside)} = ${fmt(a)}`] : [])],
          trick: "Only the ratio tolerance/σ matters.",
          mistakes: wrong(fmt(a), [
            { answer: fmt(ask === "within" ? Phi(k) : 1 - Phi(k)), why: "There are two tails: the range is symmetric about the mean." },
            { answer: fmt(ask === "within" ? 1 - 1 / (k * k) : 1 / (k * k)), why: "That is Chebyshev's bound, not the normal probability." },
          ].filter((m) => Number(m.answer) >= 0 && Number(m.answer) <= 1)),
        };
      }
      const z = r.pick([-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2]);
      const x = +(mu + z * s).toFixed(4);
      const a = ask === "below" ? Phi(z) : 1 - Phi(z);
      return {
        prompt: `X is normal with mean ${mu} and standard deviation ${s}. What is $P(X ${ask === "below" ? "<" : ">"} ${x})$?`,
        answer: fmt(a), params: { ask, z }, tolerance: 0.005,
        steps: [`z = (${x} − ${mu})/${s} = ${z}`, `${ask === "below" ? `Φ(${z})` : `1 − Φ(${z})`} = ${fmt(a)}`],
        trick: "Standardise first; then it's one table lookup.",
        mistakes: wrong(fmt(a), [
          { answer: fmt(1 - a), why: "That is the other side of the cut." },
          { answer: fmt(Phi(z * s)), why: "Divide by σ to standardise; don't multiply." },
        ]),
      };
    },
  });

  def(["5.2", "5.2#3"], {
    id: "gs-density-transform", name: "Densities and transformations", section: "5.2 Important Densities",
    blurb: "Find c so the density integrates to 1; transform events, not densities, when you can.",
    gen(level, r) {
      const fam = r.pick(band(level, [["const"], ["const", "power"], ["power", "roots"], ["roots", "const"], ["roots", "power"]]));
      if (fam === "const") {
        const m = r.int(1, 3), n = r.int(1, 3);
        const c = fact(m + n + 1) / (fact(m) * fact(n));
        return {
          prompt: `X has density $f(x) = c\\,x^{${m}}(1 - x)^{${n}}$ on (0, 1). What is c?`,
          answer: String(c), params: { fam, m, n },
          steps: [`∫₀¹ x^${m}(1 − x)^${n} dx = ${m}!·${n}!/${m + n + 1}! = 1/${c}`, `c = ${c}`],
          trick: "The beta integral: ∫ xᵐ(1 − x)ⁿ = m!n!/(m + n + 1)!.",
          mistakes: wrong(String(c), [
            { answer: String((m + 1) * (n + 1)), why: "The integral of a product isn't the product of the integrals." },
            { answer: String(fact(m + n) / (fact(m) * fact(n))), why: "The beta integral has (m + n + 1)! on top: one more factor." },
          ]),
        };
      }
      if (fam === "power") {
        const k = r.int(2, 4), y = F(r.int(1, 4), 5);
        const yk = pow(y, k);
        return {
          prompt: `U is uniform on [0, 1] and $Y = U^{${k}}$. What is $P(Y \\le ${tex(yk)})$?`,
          answer: str(y), params: { fam, k, y: str(y) },
          steps: [`Y ≤ ${str(yk)} ⇔ U ≤ (${str(yk)})^{1/${k}} = ${str(y)}`, `P = ${str(y)}`],
          trick: "Turn the event about Y into an event about U.",
          mistakes: wrong(str(y), [
            { answer: str(yk), why: "Y ≤ y is U ≤ y^{1/k}; powers of U pile up near 0, so the probability is bigger than y." },
            { answer: str(pow(yk, k)), why: "Invert the power: take the k-th root." },
          ]),
        };
      }
      // x² + aUx + b = 0 has two distinct real roots ⇔ a²U² > 4b ⇔ U > 2√b/a
      const s = r.int(1, 3), a = r.int(2 * s + 1, 2 * s + 6);
      const ans = F(a - 2 * s, a);
      return {
        prompt: `U is uniform on [0, 1]. What is the probability that $x^2 + ${a}Ux + ${s * s} = 0$ has two distinct real roots?`,
        answer: str(ans), params: { fam, a, b: s * s },
        steps: [`discriminant ${a * a}U² − ${4 * s * s} > 0`, `U > ${2 * s}/${a}`, `P = 1 − ${2 * s}/${a} = ${str(ans)}`],
        trick: "Solve for the event on U, then read its length.",
        mistakes: wrong(str(ans), [
          { answer: str(F(2 * s, a)), why: "That is the probability of *no* distinct real roots." },
          { answer: str(sub(ONE, F(4 * s * s, a * a))), why: "Solve a²U² > 4b for U itself: U > 2√b/a, not U² > …." },
        ]),
      };
    },
  });

  // ==== 6. Expected value and variance ==========================================

  def(["6.1"], {
    id: "gs-expected-value", name: "Expected winnings", section: "6.1 Expected Value of Discrete Random Variables",
    blurb: "E(X) = Σ x·P(X = x), and expectations add even when variables are dependent.",
    gen(level, r) {
      const fam = r.pick(band(level, [["cards"], ["cards", "die"], ["die", "urn"], ["urn", "pool"], ["pool", "urn"]]));
      if (fam === "cards") {
        const lo = r.int(1, 3), hi = r.int(lo + 5, lo + 12);
        const odd = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((x) => x % 2).length, all = hi - lo + 1;
        const w = r.int(1, 3), l = r.int(1, 3);
        const e = F(w * odd - l * (all - odd), all);
        return {
          prompt: `A card is drawn from cards numbered ${lo} through ${hi}. You win ${w} dollar${w > 1 ? "s" : ""} if it is odd and lose ${l} if it is even. What are your expected winnings?`,
          answer: str(e), params: { fam, lo, hi, w, l },
          steps: [`${odd} odd, ${all - odd} even out of ${all}`, `E = ${w}·${odd}/${all} − ${l}·${all - odd}/${all} = ${str(e)}`],
          trick: "Weight each payoff by its probability.",
          mistakes: wrong(str(e), [
            { answer: str(F(w - l, 2)), why: `Odd and even aren't equally likely among ${lo}–${hi}.` },
            { answer: str(F(w * odd + l * (all - odd), all)), why: "A loss counts negatively." },
          ]),
        };
      }
      if (fam === "die") {
        const f = r.pick([["the number rolled squared", (k) => k * k], ["twice the number if even, nothing otherwise", (k) => (k % 2 ? 0 : 2 * k)],
          ["the number rolled, minus 3.5", (k) => k - 3.5], ["1 dollar per dot above 3", (k) => Math.max(0, k - 3)]]);
        const e = F(Math.round([1, 2, 3, 4, 5, 6].reduce((s, k) => s + f[1](k), 0) * 2), 12);
        return {
          prompt: `You roll a fair die and are paid ${f[0]}. What is your expected payment?`,
          answer: str(e), params: { fam, rule: f[0] },
          steps: [`payments: ${[1, 2, 3, 4, 5, 6].map(f[1]).join(", ")}`, `average = ${str(e)}`],
          trick: "E(g(X)) = Σ g(x)P(x), which is not g(E(X)) in general.",
          mistakes: wrong(str(e), [
            { answer: str(F(Math.round(f[1](3.5) * 100), 100)), why: "E(g(X)) is not g(E(X)): average the payments, not the rolls." },
          ]),
        };
      }
      if (fam === "urn") {
        const c = r.int(2, 10), d = r.int(2, 10), k = r.int(2, Math.min(8, c + d - 1));
        const e = F(k * c, c + d);
        return {
          prompt: `An urn holds ${c} yellow and ${d} green balls. ${k} are drawn without replacement. What is the expected number of yellow balls drawn?`,
          answer: str(e), params: { fam, c, d, k },
          steps: [`each draw is yellow with probability ${c}/${c + d} (by symmetry)`, `E = ${k}·${c}/${c + d} = ${str(e)}`],
          trick: "Indicators: expectation doesn't care that draws are dependent.",
          mistakes: wrong(str(e), [
            { answer: str(F(c, c + d)), why: `That is one draw; there are ${k}.` },
            { answer: str(F(Math.min(k, c), 1)), why: "That is the most you could draw, not the average." },
          ]),
        };
      }
      const p = r.pick([0.01, 0.02, 0.05, 0.1]), k = r.int(2, 20);
      const e = 1 / k + 1 - (1 - p) ** k;
      return {
        prompt: `Blood samples are pooled in groups of ${k}. A pooled test is negative if nobody in the group has the disease (each person has it independently with probability ${p}); if positive, all ${k} are then tested individually. What is the expected number of tests per person?`,
        answer: fmt(e), params: { fam, p, k },
        steps: [`per group: 1 + ${k}·P(positive) = 1 + ${k}(1 − ${fmt(1 - p, 2)}^${k})`, `per person: 1/${k} + 1 − ${fmt(1 - p, 2)}^${k} = ${fmt(e)}`],
        trick: "Pooling wins when the disease is rare: most pools come back clean.",
        mistakes: wrong(fmt(e), [
          { answer: fmt(1 / k, 4), why: "Positive pools need k more tests each." },
          { answer: fmt(1 / k + (1 - p) ** k, 4), why: "Retesting happens when the pool is *positive*: 1 − (1 − p)ᵏ." },
        ]),
      };
    },
  });

  def(["6.2"], {
    id: "gs-variance", name: "Variance", section: "6.2 Variance of Discrete Random Variables",
    blurb: "V(X) = E(X²) − E(X)²; V(aX + b) = a²V(X); variances of independent sums add.",
    gen(level, r) {
      const fam = r.pick(band(level, [["table"], ["table", "uniform"], ["uniform", "affine"], ["affine", "dice"], ["dice", "binom"]]));
      if (fam === "table") {
        for (;;) {
          const xs = [...new Set(Array.from({ length: 3 }, () => r.int(-3, 5)))].sort((a, b) => a - b);
          if (xs.length < 3) continue;
          const ps = row(r, 3, r.pick([4, 6, 8]), true);
          const m = xs.reduce((s, x, i) => add(s, mul(F(x), ps[i])), ZERO);
          const m2 = xs.reduce((s, x, i) => add(s, mul(F(x * x), ps[i])), ZERO);
          const v = sub(m2, mul(m, m));
          return {
            prompt: `X takes the values ${xs.join(", ")} with probabilities ${ps.map(str).join(", ")}. What is V(X)?`,
            answer: str(v), params: { fam, xs, ps: ps.map(str) },
            steps: [`E(X) = ${str(m)}`, `E(X²) = ${str(m2)}`, `V = ${str(m2)} − (${str(m)})² = ${str(v)}`],
            trick: "Mean of the square minus square of the mean.",
            mistakes: wrong(str(v), [
              { answer: str(m2), why: "Subtract E(X)²." },
              { answer: str(sub(m2, m)), why: "Subtract the *square* of the mean." },
            ]),
          };
        }
      }
      if (fam === "uniform") {
        const n = r.int(3, 20);
        const v = F(n * n - 1, 12);
        return {
          prompt: `X is chosen uniformly from 1, 2, …, ${n}. What is V(X)?`,
          answer: str(v), params: { fam, n },
          steps: [`E(X) = ${str(F(n + 1, 2))}, E(X²) = ${str(F((n + 1) * (2 * n + 1), 6))}`, `V = (n² − 1)/12 = ${str(v)}`],
          trick: "(n − 1)(n + 1)/12.",
          mistakes: wrong(str(v), [
            { answer: str(F(n * n, 12)), why: "The discrete uniform has (n² − 1)/12; n²/12 is the continuous one's." },
            { answer: str(F((n + 1) * (2 * n + 1), 6)), why: "That is E(X²); subtract E(X)²." },
          ]),
        };
      }
      if (fam === "affine") {
        const v0 = F(r.int(1, 12), r.pick([1, 2, 4])), a = r.pick([-3, -2, 2, 3, 5]), b = r.pick([-7, -4, -1, 2, 5, 9]);
        const v = mul(F(a * a), v0);
        return {
          prompt: `V(X) = ${str(v0)}. What is V(${a}X ${b < 0 ? "−" : "+"} ${Math.abs(b)})?`,
          answer: str(v), params: { fam, v0: str(v0), a, b },
          steps: [`shifts don't change spread; scaling by ${a} multiplies V by ${a * a}`, `${a * a}·${str(v0)} = ${str(v)}`],
          trick: "V(aX + b) = a²V(X).",
          mistakes: wrong(str(v), [
            { answer: str(mul(F(a), v0)), why: "Variance scales with a², not a." },
            { answer: str(add(mul(F(a * a), v0), F(b))), why: "Adding a constant shifts X without spreading it." },
          ]),
        };
      }
      if (fam === "dice") {
        const n = r.int(2, 30);
        const v = F(35 * n, 12);
        return {
          prompt: `${n} fair dice are rolled. What is the variance of their sum?`,
          answer: str(v), params: { fam, n },
          steps: [`one die: V = 91/6 − (7/2)² = 35/12`, `independent, so ${n}·35/12 = ${str(v)}`],
          trick: "Variances of independent variables add.",
          mistakes: wrong(str(v), [
            { answer: str(F(35 * n * n, 12)), why: "V(nX) = n²V(X) is for one die multiplied by n; independent dice add to n·V." },
            { answer: str(F(35, 12)), why: `That is one die; there are ${n}.` },
          ]),
        };
      }
      const n = r.int(10, 100), p = r.pick([F(1, 2), F(1, 4), F(1, 5), F(3, 10)]);
      const v = mul(F(n), mul(p, sub(ONE, p)));
      return {
        prompt: `$S_n$ counts successes in ${n} Bernoulli trials with p = ${str(p)}. What is $V(S_n)$?`,
        answer: str(v), params: { fam, n, p: str(p) },
        steps: [`V = npq = ${n}·${str(p)}·${str(sub(ONE, p))} = ${str(v)}`],
        trick: "Each trial contributes pq.",
        mistakes: wrong(str(v), [
          { answer: str(mul(F(n), p)), why: "np is the mean; the variance has the extra factor q." },
          { answer: str(mul(F(n * n), mul(p, sub(ONE, p)))), why: "Independent trials add: n·pq, not n²·pq." },
        ]),
      };
    },
  });

  def(["6.3"], {
    id: "gs-continuous-moments", name: "Mean and variance of a density", section: "6.3 Continuous Random Variables",
    blurb: "μ = ∫x f(x) dx, σ² = ∫x² f(x) dx − μ².",
    gen(level, r) {
      const fam = r.pick(band(level, [["uniform"], ["uniform", "power"], ["power", "exp"], ["exp", "sym"], ["sym", "power"]]));
      const ask = r.pick(level <= 1 ? ["mean"] : ["mean", "var"]);
      let q, mean, m2, steps;
      const par = { fam, ask };
      if (fam === "uniform") {
        const a = r.int(-5, 5), b = a + r.int(1, 10);
        Object.assign(par, { a, b });
        q = `X is uniform on [${a}, ${b}]`; mean = F(a + b, 2); m2 = F(a * a + a * b + b * b, 3);
        steps = [`μ = (a + b)/2 = ${str(mean)}`, `σ² = (b − a)²/12 = ${str(sub(m2, mul(mean, mean)))}`];
      } else if (fam === "power") {
        const k = r.int(1, 5);
        par.k = k;
        q = `X has density $f(x) = ${k + 1}x^{${k}}$ on [0, 1]`; mean = F(k + 1, k + 2); m2 = F(k + 1, k + 3);
        steps = [`μ = ∫ ${k + 1}x^${k + 1} dx = ${str(mean)}`, `E(X²) = ${str(m2)}`, `σ² = ${str(sub(m2, mul(mean, mean)))}`];
      } else if (fam === "exp") {
        const lam = r.int(1, 6);
        par.lam = lam;
        q = `T has density $f(t) = ${lam}e^{-${lam}t}$ for t > 0`; mean = F(1, lam); m2 = F(2, lam * lam);
        steps = [`μ = 1/λ = ${str(mean)}`, `σ² = 1/λ² = ${str(F(1, lam * lam))}`];
      } else {
        const which = r.int(0, 3);
        par.which = which;
        const [f, v] = [["1/2", F(1, 3)], ["|x|", F(1, 2)], ["1 - |x|", F(1, 6)], ["\\tfrac{3}{2}x^2", F(3, 5)]][which];
        q = `X has density $f(x) = ${f}$ on [−1, 1]`; mean = ZERO; m2 = v;
        steps = [`symmetric about 0, so μ = 0`, `σ² = ∫x² f(x) dx = ${str(v)}`];
      }
      const variance = sub(m2, mul(mean, mean));
      const ans = ask === "mean" ? mean : variance;
      return {
        prompt: `${q}. What is its ${ask === "mean" ? "mean μ" : "variance σ²"}?`,
        answer: str(ans), params: par,
        steps, trick: "Symmetric densities have mean at the centre; the variance still needs the integral.",
        mistakes: wrong(str(ans), ask === "mean"
          ? [{ answer: str(m2), why: "That is E(X²), the second moment." }, { answer: str(variance), why: "That is the variance." }]
          : [{ answer: str(m2), why: "Subtract μ²: that is E(X²)." }, { answer: str(mean), why: "That is the mean." }]),
      };
    },
  });

  // ==== 7. Sums of random variables =============================================

  def(["7.1"], {
    id: "gs-dice-sums", name: "Sums of dice", section: "7.1 Sums of Discrete Random Variables",
    blurb: "The distribution of a sum is the convolution of the distributions.",
    gen(level, r) {
      const n = band(level, [2, 2, 3, 3, 4]);
      let dist = [1];
      for (let i = 0; i < n; i++) {
        const next = Array(dist.length + 6).fill(0);
        dist.forEach((c, s) => { for (let f = 1; f <= 6; f++) next[s + f] += c; });
        dist = next;
      }
      const total = 6 ** n;
      const ask = r.pick(["eq", "gt", "le", "odd"]);
      const t = r.int(n + 1, 6 * n - 1);
      const count = { eq: dist[t], gt: dist.slice(t + 1).reduce((a, b) => a + b, 0), le: dist.slice(0, t + 1).reduce((a, b) => a + b, 0),
        odd: dist.filter((_, s) => s % 2).reduce((a, b) => a + b, 0) }[ask];
      const a = F(count, total);
      const what = { eq: `exactly ${t}`, gt: `greater than ${t}`, le: `at most ${t}`, odd: "odd" }[ask];
      return {
        prompt: `A die is rolled ${n === 2 ? "twice" : `${n} times`}. What is the probability that the sum is ${what}?`,
        answer: str(a), params: { n, ask, t },
        steps: [`convolve the die's distribution with itself ${n - 1} time${n > 2 ? "s" : ""}`, `${count} of the ${total} outcomes`, `P = ${str(a)}`],
        trick: "Sums near the middle have the most ways to happen.",
        mistakes: wrong(str(a), [
          { answer: str(F(1, 5 * n + 1)), why: "The possible sums are not equally likely." },
          { answer: str(F(ask === "eq" ? dist[t] : total - count, total)), why: ask === "eq" ? "" : "That is the complementary event." },
          ...(ask === "gt" ? [{ answer: str(F(dist.slice(t).reduce((x, y) => x + y, 0), total)), why: `“Greater than ${t}” leaves out ${t} itself.` }] : []),
        ].filter((m) => m.why)),
      };
    },
  });

  def(["7.2"], {
    id: "gs-continuous-sums", name: "Sums and minima of continuous variables", section: "7.2 Sums of Continuous Random Variables",
    blurb: "U₁ + U₂ has a triangular density; the minimum of exponentials is exponential with the rates added.",
    gen(level, r) {
      const fam = r.pick(band(level, [["tri"], ["tri", "min"], ["min", "tri"], ["expsum", "min"], ["expsum", "tri"]]));
      if (fam === "tri") {
        const z = F(r.int(1, 7), 4);
        const ans = val(z) <= 1 ? div(mul(z, z), F(2)) : sub(ONE, div(mul(sub(F(2), z), sub(F(2), z)), F(2)));
        return {
          prompt: `X and Y are independent and uniform on [0, 1]. What is $P(X + Y \\le ${tex(z)})$?`,
          answer: str(ans), params: { fam, z: str(z) },
          steps: [`the region x + y ≤ ${str(z)} in the unit square`, val(z) <= 1 ? `a triangle of area z²/2 = ${str(ans)}` : `1 − (2 − z)²/2 = ${str(ans)}`],
          trick: "Draw the unit square and the line x + y = z.",
          mistakes: wrong(str(ans), [
            { answer: str(div(z, F(2))), why: "X + Y is not uniform on [0, 2]: its density is triangular." },
            { answer: str(val(z) <= 1 ? z : sub(ONE, sub(F(2), z))), why: "Use the area of the region, not its width." },
          ]),
        };
      }
      if (fam === "min") {
        const n = r.pick([2, 5, 10, 100]), mean = r.pick([100, 500, 1000, 2000]);
        const e = F(mean, n);
        return {
          prompt: `${n} light bulbs each have exponential lifetimes with mean ${mean} hours, independently. What is the expected time until the first one burns out?`,
          answer: str(e), params: { fam, n, mean },
          steps: [`min of exponentials: rate adds up to ${n}/${mean}`, `mean = ${mean}/${n} = ${str(e)}`],
          trick: "Rates add, so the first failure comes n times sooner.",
          mistakes: wrong(str(e), [
            { answer: String(mean), why: "The first of many fails sooner than a typical one." },
            { answer: str(F(mean * n)), why: "That is the total lifetime of all bulbs laid end to end." },
          ]),
        };
      }
      const lam = r.pick([0.5, 1, 2]), t = r.pick([1, 2, 3, 4]);
      const p = 1 - Math.exp(-lam * t) * (1 + lam * t);
      return {
        prompt: `X and Y are independent exponentials with rate λ = ${lam}. What is $P(X + Y \\le ${t})$?`,
        answer: fmt(p), params: { fam, lam, t },
        steps: [`X + Y has the gamma density λ²te^(−λt)`, `P = 1 − e^(−λt)(1 + λt) = ${fmt(p)}`],
        trick: "Two exponential waits in a row: a gamma with shape 2.",
        mistakes: wrong(fmt(p), [
          { answer: fmt(1 - Math.exp(-lam * t)), why: "That is one exponential; the sum takes longer." },
          { answer: fmt((1 - Math.exp(-lam * t)) ** 2), why: "That is P(both ≤ t), not P(sum ≤ t)." },
        ]),
      };
    },
  });

  // ==== 8. Law of large numbers ==================================================

  def(["8.1", "8.2"], {
    id: "gs-chebyshev", name: "Chebyshev's inequality", section: "8.1 Law of Large Numbers",
    blurb: "P(|X − μ| ≥ ε) ≤ σ²/ε², whatever the distribution.",
    gen(level, r) {
      const fam = band(level, ["bound", "bound", "coin", "n", "n"]);
      if (fam === "bound") {
        const v = F(r.int(1, 50), r.pick([1, 3])), eps = r.int(2, 12);
        const b = F(Math.min(v.n, eps * eps * v.d), eps * eps * v.d);
        return {
          prompt: `X has mean 10 and variance ${str(v)}. What upper bound does Chebyshev's inequality give for $P(|X - 10| \\ge ${eps})$?`,
          answer: str(b), params: { fam, v: str(v), eps },
          steps: [`σ²/ε² = ${str(v)}/${eps * eps} = ${str(div(v, F(eps * eps)))}`, ...(val(div(v, F(eps * eps))) > 1 ? ["a probability is at most 1"] : [])],
          trick: "Divide the variance by ε², not the standard deviation.",
          mistakes: wrong(str(b), [
            { answer: str(div(v, F(eps))), why: "Chebyshev divides by ε², not ε." },
            { answer: str(sub(ONE, b)), why: "That is the lower bound for being within ε." },
          ]),
        };
      }
      if (fam === "coin") {
        const n = r.pick([100, 400, 900, 1600]), sd = Math.sqrt(n) / 2, k = r.pick([2, 3, 4, 5]), dev = k * sd;
        const b = F(1, k * k);
        return {
          prompt: `A fair coin is tossed ${n} times (mean ${n / 2} heads, standard deviation ${sd}). What does Chebyshev's inequality say about the probability that the number of heads is at least ${dev} away from ${n / 2}? Give the upper bound.`,
          answer: str(b), params: { fam, n, k },
          steps: [`${dev} = ${k} standard deviations`, `bound 1/${k}² = ${str(b)}`],
          trick: "k standard deviations away: at most 1/k².",
          mistakes: wrong(str(b), [
            { answer: str(F(1, k)), why: "The bound is 1/k², not 1/k." },
            { answer: fmt(2 * (1 - Phi(k)), 4), why: "That is the normal approximation; Chebyshev's bound is cruder and holds for any distribution." },
          ]),
        };
      }
      const eps = r.pick([0.01, 0.02, 0.05, 0.1]), delta = r.pick([0.01, 0.05, 0.1]);
      const n = Math.ceil(1 / (4 * delta * eps * eps) - 1e-9);
      return {
        prompt: `How many tosses of a coin (bias unknown) does Chebyshev's inequality guarantee are enough so that the proportion of heads is within ${eps} of p with probability at least ${1 - delta}?`,
        answer: String(n), params: { fam, eps, delta },
        steps: [`P(|Sₙ/n − p| ≥ ε) ≤ pq/(nε²) ≤ 1/(4nε²)`, `need 1/(4n·${eps}²) ≤ ${delta}`, `n ≥ ${n}`],
        trick: "pq ≤ 1/4 for every p: the worst case is a fair coin.",
        mistakes: wrong(String(n), [
          { answer: String(Math.ceil(1 / (delta * eps * eps) - 1e-9)), why: "Use pq ≤ 1/4 rather than pq ≤ 1." },
          { answer: String(Math.ceil(1 / (4 * delta * eps) - 1e-9)), why: "The bound has ε², not ε." },
        ]),
      };
    },
  });

  // ==== 9. Central limit theorem ==================================================

  def(["9.1"], {
    id: "gs-clt-bernoulli", name: "Normal approximation to coin tosses", section: "9.1 Central Limit Theorem for Bernoulli Trials",
    blurb: "Sₙ ≈ Normal(np, npq); widen integer ranges by ½ on each side.",
    gen(level, r) {
      const n = r.pick([100, 400, 1000, 10000]), p = level <= 3 ? 0.5 : r.pick([0.3, 0.6]);
      const mu = n * p, sd = Math.sqrt(n * p * (1 - p));
      const d = Math.round(sd * r.pick([0.5, 1, 1.5, 2]));
      const ask = r.pick(["le", "between"]);
      const a = ask === "le" ? Phi((mu - d + 0.5 - mu) / sd) : Phi((d - 0.5) / sd) - Phi(-(d - 0.5) / sd);
      const noCC = ask === "le" ? Phi(-d / sd) : 2 * Phi(d / sd) - 1;
      return {
        prompt: `A coin with P(heads) = ${p} is tossed ${n} times. Using the normal approximation with the ½ correction, estimate `
          + (ask === "le" ? `$P(S_{${n}} \\le ${mu - d})$.` : `$P(${mu - d} < S_{${n}} < ${mu + d})$.`),
        answer: fmt(a), params: { n, p, d, ask }, tolerance: 0.01,
        steps: [`μ = ${mu}, σ = √(${n}·${p}·${fmt(1 - p, 2)}) = ${fmt(sd)}`,
          ask === "le" ? `P(S ≤ ${mu - d}) ≈ Φ((${mu - d} + ½ − ${mu})/${fmt(sd)}) = ${fmt(a)}` : `P(${mu - d + 1} ≤ S ≤ ${mu + d - 1}) ≈ Φ(${fmt((d - 0.5) / sd)}) − Φ(${fmt(-(d - 0.5) / sd)}) = ${fmt(a)}`],
        trick: "An integer k covers [k − ½, k + ½] on the normal curve.",
        mistakes: wrong(fmt(a), [
          { answer: fmt(noCC), why: "Without the ½ correction the estimate is noticeably off at this size." },
          { answer: fmt(1 - a), why: "That is the complementary event." },
        ]),
      };
    },
  });

  def(["9.3"], {
    id: "gs-clt-dice", name: "Sums of many dice", section: "9.3 Central Limit Theorem for Discrete Independent Trials",
    blurb: "n dice: mean 3.5n, variance 35n/12; standardise and use Φ.",
    gen(level, r) {
      const n = r.pick(band(level, [[24], [24, 36], [24, 50, 100], [100, 200], [300, 1000]]));
      const mu = 3.5 * n, sd = Math.sqrt((35 * n) / 12);
      const t = Math.round(mu + sd * r.pick([-1.5, -1, -0.5, 0.5, 1, 1.5, 2]));
      const a = 1 - Phi((t + 0.5 - mu) / sd);
      return {
        prompt: `A die is rolled ${n} times. Use the central limit theorem (with the ½ correction) to estimate the probability that the sum is greater than ${t}.`,
        answer: fmt(a), params: { n, t }, tolerance: 0.01,
        steps: [`μ = 3.5·${n} = ${mu}, σ² = ${n}·35/12, σ = ${fmt(sd)}`, `P(S > ${t}) = P(S ≥ ${t + 1}) ≈ 1 − Φ((${t} + ½ − ${mu})/${fmt(sd)}) = ${fmt(a)}`],
        trick: "One die has variance 35/12; n dice have n times that.",
        mistakes: wrong(fmt(a), [
          { answer: fmt(1 - Phi((t + 0.5 - mu) / Math.sqrt(35 / 12) / n)), why: "The standard deviation of the sum is σ√n, not σ/n." },
          { answer: fmt(1 - Phi((t + 0.5 - mu) / ((35 * n) / 12))), why: "Divide by the standard deviation, the square root of the variance." },
          { answer: fmt(Phi((t + 0.5 - mu) / sd)), why: "That is P(S ≤ t)." },
        ]),
      };
    },
  });

  def(["9.4"], {
    id: "gs-clt-average", name: "How close is the average?", section: "9.4 Central Limit Theorem for Continuous Independent Trials",
    blurb: "The average of n draws has standard deviation σ/√n.",
    gen(level, r) {
      const sigma = r.pick([1, 2, 5, 10]), eps = r.pick([0.1, 0.2, 0.5, 1]) * sigma;
      if (level >= 4) {
        const conf = r.pick([[0.95, 1.96], [0.99, 2.576], [0.9, 1.645]]);
        const n = Math.ceil((conf[1] * sigma / eps) ** 2 - 1e-9);
        return {
          prompt: `Measurements have standard deviation ${sigma}. How many independent measurements are needed so that their average is within ${eps} of the true mean with probability ${conf[0]} (use z = ${conf[1]})?`,
          answer: String(n), params: { sigma, eps, z: conf[1], ask: "n" }, tolerance: 0.02,
          steps: [`need z·σ/√n ≤ ε`, `n ≥ (${conf[1]}·${sigma}/${eps})² = ${fmt((conf[1] * sigma / eps) ** 2, 2)}`, `n = ${n}`],
          trick: "Halving the error needs four times the data.",
          mistakes: wrong(String(n), [
            { answer: String(Math.ceil(conf[1] * sigma / eps)), why: "Square it: the error shrinks like 1/√n." },
            { answer: String(Math.ceil(sigma * sigma / ((1 - conf[0]) * eps * eps))), why: "That is Chebyshev's (much more cautious) answer." },
          ]),
        };
      }
      const n = r.pick([16, 25, 36, 100]);
      const z = (eps * Math.sqrt(n)) / sigma;
      const a = 2 * Phi(z) - 1;
      return {
        prompt: `n = ${n} independent measurements each have mean μ and standard deviation ${sigma}. Estimate the probability that their average is within ${eps} of μ.`,
        answer: fmt(a), params: { sigma, eps, n, ask: "p" }, tolerance: 0.01,
        steps: [`σ_avg = ${sigma}/√${n} = ${fmt(sigma / Math.sqrt(n))}`, `z = ${eps}/${fmt(sigma / Math.sqrt(n))} = ${fmt(z)}`, `2Φ(z) − 1 = ${fmt(a)}`],
        trick: "Averages concentrate: σ/√n.",
        mistakes: wrong(fmt(a), [
          { answer: fmt(2 * Phi(eps / sigma) - 1), why: "The average is less spread than one measurement: divide σ by √n." },
          { answer: fmt(Phi(z)), why: "“Within” is two-sided: 2Φ(z) − 1." },
        ]),
      };
    },
  });

  // ==== 10. Generating functions ==================================================

  def(["10.1"], {
    id: "gs-generating-functions", name: "Generating functions", section: "10.1 Generating Functions for Discrete Distributions",
    blurb: "h(z) = Σ pₖzᵏ: h′(1) is the mean, and sums multiply generating functions.",
    gen(level, r) {
      const ps = row(r, 3, r.pick([3, 4, 6]), true);
      const mean = add(ps[1], mul(F(2), ps[2]));
      const ask = band(level, ["mean", "mean", "conv", "var", "conv"]);
      if (ask === "conv") {
        const k = r.int(0, 4);
        let a = ZERO;
        for (let i = 0; i <= 2; i++) { const j = k - i; if (j >= 0 && j <= 2) a = add(a, mul(ps[i], ps[j])); }
        return {
          prompt: `X takes the values 0, 1, 2 with probabilities ${ps.map(str).join(", ")}, so $h(z) = ${tex(ps[0])} + ${tex(ps[1])}z + ${tex(ps[2])}z^2$. X₁, X₂ are independent copies. What is $P(X_1 + X_2 = ${k})$?`,
          answer: str(a), params: { ask, ps: ps.map(str), k },
          steps: [`the sum's generating function is h(z)²`, `coefficient of z^${k}: ${str(a)}`],
          trick: "Multiplying generating functions convolves the distributions.",
          mistakes: wrong(str(a), [
            { answer: str(k <= 2 ? mul(ps[k], ps[k]) : ZERO), why: "Several pairs (i, j) with i + j = k contribute." },
            { answer: str(k % 2 === 0 && k / 2 <= 2 ? ps[k / 2] : ZERO), why: "X₁ + X₂ is not 2X₁: the copies are independent." },
          ]),
        };
      }
      const m2 = add(ps[1], mul(F(4), ps[2]));
      const v = sub(m2, mul(mean, mean));
      const ans = ask === "mean" ? mean : v;
      return {
        prompt: `X has generating function $h(z) = ${tex(ps[0])} + ${tex(ps[1])}z + ${tex(ps[2])}z^2$. What is ${ask === "mean" ? "E(X)" : "V(X)"}?`,
        answer: str(ans), params: { ask, ps: ps.map(str) },
        steps: ask === "mean" ? [`h′(z) = ${str(ps[1])} + ${str(mul(F(2), ps[2]))}z`, `h′(1) = ${str(mean)}`]
          : [`h′(1) = ${str(mean)}, h″(1) = ${str(mul(F(2), ps[2]))}`, `V = h″(1) + h′(1) − h′(1)² = ${str(v)}`],
        trick: "Derivatives at z = 1 give the factorial moments.",
        mistakes: wrong(str(ans), ask === "mean"
          ? [{ answer: str(add(ps[1], ps[2])), why: "Weight each value by itself: h′(1) = p₁ + 2p₂." }, { answer: "1", why: "h(1) = 1 for every distribution; the mean is h′(1)." }]
          : [{ answer: str(mul(F(2), ps[2])), why: "h″(1) is E(X(X − 1)); add h′(1) and subtract h′(1)²." }, { answer: str(m2), why: "That is E(X²); subtract the squared mean." }]),
      };
    },
  });

  def(["10.2"], {
    id: "gs-branching", name: "Branching processes", section: "10.2 Branching Processes",
    blurb: "Extinction probability is the smallest root of h(z) = z in [0, 1].",
    gen(level, r) {
      const d = r.pick([4, 5, 6, 8, 10]);
      const ps = row(r, 3, d, true);
      const [p0, p1, p2] = ps;
      const m = add(p1, mul(F(2), p2));
      const ext = val(p0) >= val(p2) ? ONE : div(p0, p2);
      const ask = level <= 1 ? "mean" : "ext";
      const ans = ask === "mean" ? m : ext;
      return {
        prompt: `In a branching process each individual has 0, 1 or 2 offspring with probabilities ${str(p0)}, ${str(p1)}, ${str(p2)}. `
          + (ask === "mean" ? "What is the mean number of offspring?" : "Starting from one individual, what is the probability that the line eventually dies out?"),
        answer: str(ans), params: { ask, ps: ps.map(str) },
        steps: ask === "mean" ? [`m = p₁ + 2p₂ = ${str(m)}`]
          : [`solve h(z) = z: ${str(p2)}z² + (${str(p1)} − 1)z + ${str(p0)} = 0`, `roots 1 and p₀/p₂ = ${str(div(p0, p2))}`, `smallest in [0, 1]: ${str(ext)}`],
        trick: "Mean ≤ 1 means certain extinction; otherwise take the root below 1.",
        mistakes: wrong(str(ans), ask === "mean"
          ? [{ answer: str(add(p1, p2)), why: "Two offspring count twice." }]
          : [{ answer: str(p0), why: "p₀ is dying out in the first generation; later generations can die out too." },
            ...(val(p0) < val(p2) ? [{ answer: "1", why: "With mean above 1 the line survives with positive probability: take the smaller root, p₀/p₂." }] : []),
            { answer: str(mul(p0, p0)), why: "Two independent lines must both die only when there are two children; weigh every offspring count." }]),
      };
    },
  });

  def(["10.3"], {
    id: "gs-mgf-moments", name: "Moments from a density", section: "10.3 Generating Functions for Continuous Densities",
    blurb: "g(t) = E(e^{tX}); its n-th derivative at 0 is E(Xⁿ).",
    gen(level, r) {
      const fam = r.pick(band(level, [["uniform"], ["uniform", "power"], ["power", "exp"], ["exp", "power"], ["exp", "uniform"]]));
      const n = r.int(2, band(level, [2, 3, 3, 4, 5]));
      let q, ans, steps, alt;
      const par = { fam, n };
      if (fam === "uniform") {
        const b = r.int(1, 4);
        par.b = b;
        q = `X is uniform on [0, ${b}]`; ans = F(b ** n, n + 1);
        steps = [`E(Xⁿ) = (1/${b})∫₀^${b} xⁿ dx = ${b}ⁿ/(n + 1)`, `n = ${n}: ${str(ans)}`]; alt = F(b ** n, 2 ** n);
      } else if (fam === "power") {
        const k = r.int(1, 4);
        par.k = k;
        q = `X has density $${k + 1}x^{${k}}$ on [0, 1]`; ans = F(k + 1, k + n + 1);
        steps = [`E(Xⁿ) = ∫₀¹ ${k + 1}x^{${k} + n} dx = ${k + 1}/(${k} + n + 1)`, `= ${str(ans)}`]; alt = pow(F(k + 1, k + 2), n);
      } else {
        const lam = r.int(1, 4);
        par.lam = lam;
        q = `X is exponential with λ = ${lam}, so $g(t) = \\frac{${lam}}{${lam} - t}$`; ans = F(fact(n), lam ** n);
        steps = [`g(t) = Σ (t/λ)ⁿ, so E(Xⁿ) = n!/λⁿ`, `= ${str(ans)}`]; alt = F(1, lam ** n);
      }
      return {
        prompt: `${q}. What is $E(X^{${n}})$?`,
        answer: str(ans), params: par,
        steps, trick: "Expand g(t) as a power series: E(Xⁿ) is n! times the coefficient of tⁿ.",
        mistakes: wrong(str(ans), [{ answer: str(alt), why: "E(Xⁿ) is not E(X)ⁿ." }]),
      };
    },
  });

  // ==== 11. Markov chains =============================================================

  const OZ = [[F(1, 2), F(1, 4), F(1, 4)], [F(1, 2), ZERO, F(1, 2)], [F(1, 4), F(1, 4), F(1, 2)]];
  /** A random regular chain: every entry positive, over a small denominator. */
  const chain = (r, k) => Array.from({ length: k }, () => row(r, k, r.pick([3, 4, 5, 6]), true));
  const names = (k) => (k === 3 ? ["1", "2", "3"] : ["1", "2"]);

  def(["11.1"], {
    id: "gs-markov-steps", name: "Markov chains: n steps ahead", section: "11.1 Introduction",
    blurb: "The (i, j) entry of Pⁿ is the chance of going from i to j in n steps.",
    gen(level, r) {
      const k = level <= 2 ? 2 : 3;
      const oz = k === 3 && r() < 0.4;
      const P = oz ? OZ : chain(r, k);
      const n = band(level, [2, 2, 2, 3, 3]);
      let Pn = P;
      for (let s = 1; s < n; s++) Pn = matmul(Pn, P);
      const i = r.int(0, k - 1), j = r.int(0, k - 1);
      const ans = Pn[i][j];
      const lab = oz ? ["rain", "nice", "snow"] : names(k);
      return {
        prompt: oz
          ? `In the Land of Oz, the weather (rain, nice, snow) follows the chain $P = ${matTex(P)}$. If it is ${lab[i]} today, what is the probability of ${lab[j]} ${n === 2 ? "the day after tomorrow" : `in ${n} days`}?`
          : `A Markov chain on states ${lab.join(", ")} has transition matrix $P = ${matTex(P)}$. Starting in state ${lab[i]}, what is the probability of being in state ${lab[j]} after ${n} steps?`,
        answer: str(ans), params: { P: P.map((rw) => rw.map(str)), n, i, j },
        steps: [`compute Pⁿ for n = ${n}`, `entry (${lab[i]}, ${lab[j]}) = ${str(ans)}`],
        trick: "Sum over the paths: Σ_k p_ik p_kj for two steps.",
        mistakes: wrong(str(ans), [
          { answer: str(P[i][j]), why: `That is one step; the question asks for ${n}.` },
          { answer: str(pow(P[i][j], n)), why: "Paths may pass through other states; raise the matrix to the power, not the entry." },
        ]),
      };
    },
  });

  def(["11.2"], {
    id: "gs-absorbing", name: "Absorbing chains and the drunkard's walk", section: "11.2 Absorbing Markov Chains",
    blurb: "Fundamental matrix N = (I − Q)⁻¹: row sums are expected times to absorption.",
    gen(level, r) {
      const N = band(level, [3, 4, 4, 5, 6]);
      const p = level <= 2 ? F(1, 2) : r.pick([F(1, 2), F(1, 3), F(2, 3), F(1, 4)]);
      const q = sub(ONE, p);
      const x = r.int(1, N - 1);
      const ask = r.pick(["prob", "time"]);
      // Unknowns at 1..N−1; equations u_x = p·u_{x+1} + q·u_{x−1} (+ constants).
      const k = N - 1;
      const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) =>
        (a === b ? ONE : b === a + 1 ? F(-p.n, p.d) : b === a - 1 ? F(-q.n, q.d) : ZERO)));
      const rhs = Array.from({ length: k }, (_, a) => (ask === "prob" ? (a === k - 1 ? p : ZERO) : ONE));
      const sol = solve(A, rhs);
      const ans = sol[x - 1];
      const walk = p.n === 1 && p.d === 2 ? "a fair coin" : `a step right with probability ${str(p)}`;
      return {
        prompt: `A walker on 0, 1, …, ${N} moves one step right or left each minute (${walk}) and stops on reaching 0 or ${N}. Starting at ${x}, `
          + (ask === "prob" ? `what is the probability of ending at ${N}?` : "what is the expected number of steps until stopping?"),
        answer: str(ans), params: { N, p: str(p), x, ask },
        steps: [ask === "prob" ? `uₓ = p·uₓ₊₁ + q·uₓ₋₁, u₀ = 0, u${N} = 1` : `tₓ = 1 + p·tₓ₊₁ + q·tₓ₋₁, t₀ = t${N} = 0`, `solve: ${ask === "prob" ? "u" : "t"}${x} = ${str(ans)}`],
        trick: p.n * 2 === p.d ? (ask === "prob" ? "Fair walk: x/N." : "Fair walk: x(N − x).") : "First-step analysis: condition on the first move.",
        mistakes: wrong(str(ans), ask === "prob"
          ? [{ answer: str(F(x, N)), why: "x/N holds for a fair walk only." }, { answer: str(sub(ONE, ans)), why: "That is the probability of ending at 0." }]
          : [{ answer: String(x * (N - x)), why: "x(N − x) is the fair walk's answer." }, { answer: String(Math.min(x, N - x)), why: "That is the shortest route; the walk wanders." }]),
      };
    },
  });

  def(["11.3", "11.4"], {
    id: "gs-fixed-vector", name: "Fixed vectors of regular chains", section: "11.3 Ergodic Markov Chains",
    blurb: "Solve wP = w with the entries of w summing to 1.",
    gen(level, r) {
      if (level <= 2) {
        const a = F(r.int(1, 5), 6), b = F(r.int(1, 5), 6);
        const w = [div(b, add(a, b)), div(a, add(a, b))];
        const j = r.int(0, 1);
        const P = [[sub(ONE, a), a], [b, sub(ONE, b)]];
        return {
          prompt: `A two-state chain has $P = ${matTex(P)}$. In the long run, what fraction of the time is it in state ${j + 1}?`,
          answer: str(w[j]), params: { P: P.map((rw) => rw.map(str)), j },
          steps: [`w = (b/(a + b), a/(a + b)) with a = ${str(a)}, b = ${str(b)}`, `w${j + 1} = ${str(w[j])}`],
          trick: "Balance: the flow from 1 to 2 equals the flow from 2 to 1.",
          mistakes: wrong(str(w[j]), [
            { answer: str(w[1 - j]), why: "That is the other state's share." },
            { answer: str(P[j][j]), why: "That is the chance of staying one step, not the long-run share." },
          ]),
        };
      }
      const oz = r() < 0.3;
      const P = oz ? OZ : chain(r, 3);
      // w(P − I) = 0 with Σw = 1: replace one equation by the normalisation.
      const A = [0, 1].map((c) => [0, 1, 2].map((i) => sub(P[i][c], i === c ? ONE : ZERO)));
      A.push([ONE, ONE, ONE]);
      const w = solve(A, [ZERO, ZERO, ONE]);
      const j = r.int(0, 2);
      if (level >= 5) {
        const y = [r.int(0, 6), r.int(0, 6), r.int(0, 6)];
        const lim = w.reduce((s, wi, i) => add(s, mul(wi, F(y[i]))), ZERO);
        return {
          prompt: `$P = ${matTex(P)}$ and $y = (${y.join(", ")})^T$. As n grows, every entry of $P^n y$ approaches the same number. What is it?`,
          answer: str(lim), params: { P: P.map((rw) => rw.map(str)), y, ask: "limit" },
          steps: [`Pⁿ → W, whose rows are all w = (${w.map(str).join(", ")})`, `w·y = ${str(lim)}`],
          trick: "The limit forgets the starting state: each entry is w·y.",
          mistakes: wrong(str(lim), [
            { answer: str(F(y[0] + y[1] + y[2], 3)), why: "Weight y by the fixed vector w, not equally." },
            { answer: str(P[0].reduce((s, pi, i) => add(s, mul(pi, F(y[i]))), ZERO)), why: "That is one step, (Py)₁; keep going to the limit." },
          ]),
        };
      }
      return {
        prompt: oz
          ? `For the Land of Oz chain $P = ${matTex(P)}$ (rain, nice, snow), what long-run fraction of days are ${["rainy", "nice", "snowy"][j]}?`
          : `A regular Markov chain has $P = ${matTex(P)}$. What is the ${["first", "second", "third"][j]} entry of its fixed probability vector w?`,
        answer: str(w[j]), params: { P: P.map((rw) => rw.map(str)), j, ask: "w" },
        steps: [`solve wP = w, w₁ + w₂ + w₃ = 1`, `w = (${w.map(str).join(", ")})`],
        trick: "Replace one equation of w(P − I) = 0 with Σw = 1.",
        mistakes: wrong(str(w[j]), [
          { answer: "1/3", why: "The chain doesn't spend equal time in each state unless P is doubly stochastic." },
          { answer: str(F([0, 1, 2].reduce((s, i) => s + val(P[i][j]), 0) * 60, 180)), why: "Averaging a column isn't the fixed vector: solve wP = w." },
        ]),
      };
    },
  });

  def(["11.5"], {
    id: "gs-first-passage", name: "Mean first passage times", section: "11.5 Mean First Passage Time for Ergodic Chains",
    blurb: "mᵢⱼ = 1 + Σ_{k≠j} pᵢₖmₖⱼ; the mean return time to j is 1/wⱼ.",
    gen(level, r) {
      const k = level <= 2 ? 2 : 3;
      const P = k === 3 && r() < 0.3 ? OZ : chain(r, k);
      const j = r.int(0, k - 1);
      const ask = level >= 4 && r() < 0.4 ? "return" : "passage";
      const others = [...Array(k).keys()].filter((s) => s !== j);
      const A = others.map((a) => others.map((b) => sub(a === b ? ONE : ZERO, P[a][b])));
      const m = solve(A, others.map(() => ONE));
      const i = r.pick(others);
      const mij = m[others.indexOf(i)];
      const ret = add(ONE, others.reduce((s, o, t) => add(s, mul(P[j][o], m[t])), ZERO));
      const ans = ask === "return" ? ret : mij;
      return {
        prompt: `A Markov chain has $P = ${matTex(P)}$. `
          + (ask === "return" ? `Starting in state ${j + 1}, what is the expected number of steps until it first returns to ${j + 1}?`
            : `Starting in state ${i + 1}, what is the expected number of steps until it first reaches state ${j + 1}?`),
        answer: str(ans), params: { P: P.map((rw) => rw.map(str)), i, j, ask },
        steps: [`make ${j + 1} absorbing and solve mₓ = 1 + Σ_{y≠${j + 1}} pₓᵧmᵧ`, ask === "return" ? `rⱼ = 1 + Σ p_{j y} m_y = ${str(ret)} ( = 1/wⱼ)` : `m = ${str(mij)}`],
        trick: "First-step analysis again; the mean return time is 1/wⱼ.",
        mistakes: wrong(str(ans), [
          { answer: str(div(ONE, P[ask === "return" ? j : i][j])), why: "1/pᵢⱼ would be right only if every failed step returned you to the start." },
          { answer: str(ask === "return" ? mij : ret), why: ask === "return" ? "That is the passage time from another state; a return starts from j itself." : "That is the mean return time to j, starting from j." },
        ]),
      };
    },
  });

  // ==== 12. Random walks ================================================================

  const u = (m) => F(C(2 * m, m), 4 ** m); // P(S_2m = 0)

  def(["12.1"], {
    id: "gs-random-walk", name: "Returns to the origin", section: "12.1 Random Walks in Euclidean Space",
    blurb: "u₂ₘ = C(2m, m)/2²ᵐ; the first return at 2m has probability u₂ₘ/(2m − 1).",
    gen(level, r) {
      const m = r.int(1, band(level, [3, 4, 5, 6, 6]));
      const ask = band(level, ["at", "at", "first", "first", "plane"]);
      if (ask === "plane") {
        const a = pow(u(m), 2);
        return {
          prompt: `A random walk on the integer lattice in the plane moves to one of its 4 neighbours with equal probability. What is the probability that it is back at the origin after ${2 * m} steps?`,
          answer: str(a), params: { m, ask },
          steps: [`rotate 45°: two independent 1-D walks`, `u₂ₘ² = (C(${2 * m}, ${m})/4^${m})² = ${str(a)}`],
          trick: "The planar walk is two independent line walks in disguise.",
          mistakes: wrong(str(a), [
            { answer: str(u(m)), why: "That is the 1-D walk; in the plane both coordinates must return." },
            { answer: str(F(C(2 * m, m), 4 ** (2 * m))), why: "Count all returning paths: (C(2m, m))² of the 4²ᵐ." },
          ]),
        };
      }
      const a = ask === "at" ? u(m) : div(u(m), F(2 * m - 1));
      return {
        prompt: `A simple random walk on the integers starts at 0 and steps ±1 with equal probability. What is the probability that ${ask === "at" ? `it is at 0 after ${2 * m} steps` : `its first return to 0 is at step ${2 * m}`}?`,
        answer: str(a), params: { m, ask },
        steps: ask === "at" ? [`${m} steps up and ${m} down: C(${2 * m}, ${m}) of 2^${2 * m} paths`, `= ${str(a)}`]
          : [`f₂ₘ = u₂ₘ/(2m − 1)`, `= ${str(u(m))}/${2 * m - 1} = ${str(a)}`],
        trick: "Returning at 2m is not the same as returning for the first time.",
        mistakes: wrong(str(a), ask === "at"
          ? [{ answer: str(F(1, 2 * m + 1)), why: "The positions aren't equally likely: 0 is the most likely." }, { answer: str(F(1, 2 ** m)), why: "Count paths with equal ups and downs: C(2m, m) of 2²ᵐ." }]
          : [{ answer: str(u(m)), why: "That includes walks that already returned earlier." }, { answer: str(F(1, 2 ** (2 * m))), why: "Many paths make their first return at 2m." }]),
      };
    },
  });

  def(["12.2"], {
    id: "gs-gamblers-ruin", name: "Gambler's ruin", section: "12.2 Gambler's Ruin",
    blurb: "With r = q/p ≠ 1: P(reach N from k) = (1 − rᵏ)/(1 − rᴺ).",
    gen(level, r) {
      const fam = band(level, ["fair", "fair", "biased", "roulette", "roulette"]);
      if (fam === "fair") {
        const N = r.int(4, 20), k = r.int(1, N - 1), ask = r.pick(level === 1 ? ["win"] : ["win", "time"]);
        const ans = ask === "win" ? F(k, N) : F(k * (N - k));
        return {
          prompt: `A gambler with ${k} dollar${k === 1 ? "" : "s"} bets 1 dollar at a time on fair coin tosses, stopping at 0 or ${N}. ${ask === "win" ? `What is the probability of reaching ${N}?` : "What is the expected number of bets?"}`,
          answer: str(ans), params: { fam, N, k, ask },
          steps: [ask === "win" ? `fair game: P = k/N = ${str(ans)}` : `fair game: E = k(N − k) = ${k * (N - k)}`],
          trick: "In a fair game your fortune is a martingale: k = N·P(win).",
          mistakes: wrong(str(ans), ask === "win"
            ? [{ answer: "1/2", why: "The starting stake matters: nearer N means more likely to win." }, { answer: str(F(N - k, N)), why: "That is the probability of ruin." }]
            : [{ answer: String(Math.min(k, N - k)), why: "That is the fastest finish; the walk wanders." }, { answer: String(k * N), why: "The expected duration is k(N − k)." }]),
        };
      }
      const p = fam === "roulette" ? 18 / 38 : r.pick([0.4, 0.45, 0.55, 0.6]);
      const rr = (1 - p) / p;
      const N = r.pick(fam === "roulette" ? [10, 20, 50, 100] : [5, 10, 20]), k = r.int(1, N - 1);
      const P = (1 - rr ** k) / (1 - rr ** N);
      return {
        prompt: fam === "roulette"
          ? `A gambler with ${k} dollar${k === 1 ? "" : "s"} bets 1 dollar at a time on red at roulette (win probability 18/38), stopping at 0 or ${N}. What is the probability of reaching ${N}?`
          : `A gambler with ${k} dollar${k === 1 ? "" : "s"} wins each 1-dollar bet with probability ${p}, stopping at 0 or ${N}. What is the probability of reaching ${N}?`,
        answer: fmt(P, 5), params: { fam, p, N, k }, tolerance: 0.005,
        steps: [`r = q/p = ${fmt(rr)}`, `(1 − r^${k})/(1 − r^${N}) = ${fmt(P, 5)}`],
        trick: "A small edge compounds: against the house, long targets are nearly hopeless.",
        mistakes: wrong(fmt(P, 5), [
          { answer: fmt(k / N, 5), why: "k/N is the fair game; the bias changes everything over many bets." },
          { answer: fmt(p ** (N - k), 5), why: "That is winning every bet in a row; losses along the way can be made up." },
        ]),
      };
    },
  });

  def(["12.3"], {
    id: "gs-arcsine", name: "The arc sine law", section: "12.3 Arc Sine Laws",
    blurb: "P(last return at 2k in a walk of length 2m) = u₂ₖ·u₂ₘ₋₂ₖ: most likely near the ends.",
    gen(level, r) {
      const m = r.int(2, band(level, [3, 4, 5, 6, 8]));
      const k = r.int(0, m);
      const ask = r.pick(["last", "lead"]);
      const a = mul(k === 0 ? ONE : u(k), m - k === 0 ? ONE : u(m - k));
      return {
        prompt: ask === "last"
          ? `A fair ±1 random walk runs for ${2 * m} steps. What is the probability that its last visit to 0 is at step ${2 * k}?`
          : `A fair ±1 random walk runs for ${2 * m} steps. What is the probability that it spends exactly ${2 * k} of those steps on the positive side?`,
        answer: str(a), params: { m, k, ask },
        steps: [`u₂ₖ·u₂ₘ₋₂ₖ with u₂ⱼ = C(2j, j)/2²ʲ`, `= ${str(k === 0 ? ONE : u(k))}·${str(m - k === 0 ? ONE : u(m - k))} = ${str(a)}`],
        trick: "The extremes are the most likely: leads rarely change hands.",
        mistakes: wrong(str(a), [
          { answer: str(F(1, m + 1)), why: "The m + 1 possibilities aren't equally likely: the ends are favoured." },
          { answer: str(u(m)), why: "That is the probability of being at 0 at the end." },
        ]),
      };
    },
  });
})();
