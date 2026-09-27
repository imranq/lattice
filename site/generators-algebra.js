// Abstract and linear algebra generators for the chapters of Herstein (Abstract
// Algebra) and Axler (Linear Algebra Done Right) that generators-books.js does
// not reach: cosets and products, homomorphisms, conjugacy and Sylow, rings and
// ideals, polynomials, field extensions and finite fields; span and dimension,
// inner products, the spectral theorem, Jordan form, determinants and volume.
// Original problems and proofs, cited to the book's section.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M || !M.proofProblem) return;
  const { band, gcd } = M.util;
  const proof = M.proofProblem, from = M.bookSource;

  const def = (domain, concepts, g) => M.define({
    domain, prose: true, ...g, concepts: concepts.map((c) => `concept:${c}`),
  });
  const AA = "abstract algebra", LA = "linear algebra";
  const fmt = (x, dp = 4) => String(Number(x.toFixed(dp)));
  const wrong = (answer, list) => list.filter((m, i) => m.answer !== undefined && m.answer !== answer
    && !/NaN|Infinity|undefined/.test(String(m.answer)) && list.findIndex((x) => x.answer === m.answer) === i);
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
  const divisors = (n) => Array.from({ length: n }, (_, i) => i + 1).filter((d) => n % d === 0);
  const primeFactors = (n) => { const ps = []; for (let p = 2; p * p <= n; p++) { if (n % p === 0) { ps.push(p); while (n % p === 0) n /= p; } } if (n > 1) ps.push(n); return ps; };
  const isPrime = (n) => n > 1 && primeFactors(n).length === 1 && primeFactors(n)[0] === n;
  const phi = (n) => primeFactors(n).reduce((a, p) => (a / p) * (p - 1), n);
  const mu = (n) => { let m = 1; for (const p of primeFactors(n)) { if (n % (p * p) === 0) return 0; m = -m; } return m; };
  const F = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
  const sub = (a, b) => F(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => F(a.n * b.n, a.d * b.d);
  const div = (a, b) => F(a.n * b.d, a.d * b.n);
  const str = (a) => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
  const mtex = (A) => `\\begin{pmatrix}${A.map((row) => row.join(" & ")).join(" \\\\ ")}\\end{pmatrix}`;

  /** Rank over ℚ by exact elimination. */
  function rank(A) {
    const m = A.map((row) => row.map((x) => F(x)));
    let rk = 0;
    for (let c = 0; c < (m[0]?.length ?? 0) && rk < m.length; c++) {
      const p = m.findIndex((row, i) => i >= rk && row[c].n !== 0);
      if (p < 0) continue;
      [m[rk], m[p]] = [m[p], m[rk]];
      for (let i = 0; i < m.length; i++) {
        if (i === rk || m[i][c].n === 0) continue;
        const f = div(m[i][c], m[rk][c]);
        m[i] = m[i].map((x, j) => sub(x, mul(f, m[rk][j])));
      }
      rk++;
    }
    return rk;
  }
  const det = (A) => (A.length === 1 ? A[0][0]
    : A[0].reduce((s, a, j) => s + (j % 2 ? -1 : 1) * a * det(A.slice(1).map((row) => row.filter((_, k) => k !== j))), 0));

  // ==== groups (Herstein 2, 3) =======================================================

  def(AA, ["herstein:2.4", "herstein:2.3"], {
    id: "al-lagrange", name: "Lagrange's theorem",
    blurb: "|G| = [G : H]·|H|, so the order of every subgroup and element divides |G|.",
    source: from("herstein", "2.4 Lagrange's Theorem"),
    gen(level, r) {
      const n = r.pick(band(level, [[12, 20, 30], [24, 36, 60], [48, 72, 100], [120, 168, 210], [360, 720, 1000]]));
      const ask = r.pick(level <= 1 ? ["index"] : ["index", "orders", "which"]);
      const ds = divisors(n);
      if (ask === "index") {
        const h = r.pick(ds.filter((d) => d > 1 && d < n));
        return {
          prompt: `A group G of order ${n} has a subgroup H of order ${h}. How many left cosets of H are there in G?`,
          answer: String(n / h), params: { ask, n, h },
          steps: [`the cosets partition G into pieces of size |H|`, `[G : H] = ${n}/${h} = ${n / h}`],
          trick: "Cosets are disjoint and all the same size.",
          mistakes: wrong(String(n / h), [
            { answer: String(h), why: "That is the size of each coset, not how many there are." },
            { answer: String(n - h), why: "Cosets divide G; they don't subtract from it." },
          ]),
        };
      }
      if (ask === "orders") {
        return {
          prompt: `By Lagrange's theorem, how many different orders could a subgroup of a group of order ${n} possibly have?`,
          answer: String(ds.length), params: { ask, n },
          steps: [`subgroup orders divide ${n}`, `divisors: ${ds.join(", ")}`, `${ds.length} of them`],
          trick: "Count the divisors, including 1 and |G|.",
          mistakes: wrong(String(ds.length), [
            { answer: String(ds.length - 2), why: "The trivial subgroup and G itself count too." },
            { answer: String(primeFactors(n).length), why: "Any divisor can be an order, not only the primes." },
          ]),
        };
      }
      const non = r.pick(Array.from({ length: n }, (_, i) => i + 2).filter((k) => n % k !== 0 && k < n));
      const good = r.pick(ds.filter((d) => d > 1 && d < n));
      return {
        prompt: `G has order ${n}. Which of these could be the order of an element of G?`,
        answer: String(good), format: "choice", params: { ask, n, good },
        steps: [`element orders divide ${n}`, `${good} divides ${n}`],
        trick: "The order of g is the order of the subgroup ⟨g⟩.",
        mistakes: wrong(String(good), [
          { answer: String(non), why: `${non} doesn't divide ${n}.` },
          { answer: String(n + good), why: "An element's order can't exceed |G|." },
          { answer: String(2 * n), why: "An element's order can't exceed |G|." },
        ]),
      };
    },
  });

  def(AA, ["herstein:2.9", "herstein:2.10"], {
    id: "al-direct-product", name: "Orders in direct products",
    blurb: "The order of (a, b) is lcm(|a|, |b|); ℤₘ × ℤₙ is cyclic iff gcd(m, n) = 1.",
    source: from("herstein", "2.9 Direct Products"),
    gen(level, r) {
      const m = r.int(2, band(level, [6, 8, 12, 15, 20])), n = r.int(2, band(level, [6, 8, 12, 15, 24]));
      if (level >= 3 && r() < 0.4) {
        const cyc = gcd(m, n) === 1;
        return {
          prompt: `Is $\\mathbb{Z}_{${m}} \\times \\mathbb{Z}_{${n}}$ cyclic?`,
          answer: cyc ? "Yes" : "No", format: "choice", params: { m, n, ask: "cyclic" },
          steps: [`gcd(${m}, ${n}) = ${gcd(m, n)}`, cyc ? `(1, 1) has order ${m * n}` : `every element has order dividing lcm = ${lcm(m, n)} < ${m * n}`],
          trick: "Cyclic iff the largest element order, lcm(m, n), equals mn.",
          mistakes: [{ answer: cyc ? "No" : "Yes", why: cyc ? `(1, 1) has order lcm(${m}, ${n}) = ${m * n}, so it generates.` : `lcm(${m}, ${n}) = ${lcm(m, n)} < ${m * n}: no element generates.` }],
        };
      }
      const a = r.int(0, m - 1), b = r.int(0, n - 1);
      const oa = m / gcd(a, m), ob = n / gcd(b, n);
      const o = lcm(oa, ob);
      return {
        prompt: `What is the order of $(${a}, ${b})$ in $\\mathbb{Z}_{${m}} \\times \\mathbb{Z}_{${n}}$?`,
        answer: String(o), params: { m, n, a, b, ask: "order" },
        steps: [`|${a}| in ℤ${m} = ${m}/gcd(${a}, ${m}) = ${oa}`, `|${b}| in ℤ${n} = ${ob}`, `lcm = ${o}`],
        trick: "Both coordinates must return to 0 at the same time.",
        mistakes: wrong(String(o), [
          { answer: String(oa * ob), why: "The coordinates cycle together: take the lcm, not the product." },
          { answer: String(Math.max(oa, ob)), why: "Both coordinates must be 0 simultaneously: lcm." },
          { answer: String(m * n), why: "That is the size of the group." },
        ]),
      };
    },
  });

  def(AA, ["herstein:2.5", "herstein:2.7", "herstein:2.6"], {
    id: "al-homomorphisms", name: "Homomorphisms of cyclic groups",
    blurb: "φ: ℤₘ → ℤₙ is fixed by φ(1), which needs order dividing m; |G| = |ker φ|·|im φ|.",
    source: from("herstein", "2.7 The Homomorphism Theorems"),
    gen(level, r) {
      const g0 = r.pick([1, 2, 2, 3, 4, 6]);
      const m = g0 * r.int(1, band(level, [4, 6, 6, 8, 9])) + (g0 === 1 ? 1 : 0), n = g0 * r.int(1, band(level, [4, 6, 6, 8, 9])) + (g0 === 1 ? 1 : 0);
      const ask = level <= 2 ? "count" : r.pick(["count", "kernel"]);
      if (ask === "count") {
        return {
          prompt: `How many group homomorphisms are there from $\\mathbb{Z}_{${m}}$ to $\\mathbb{Z}_{${n}}$?`,
          answer: String(gcd(m, n)), params: { m, n, ask },
          steps: [`φ is determined by a = φ(1), which needs ${m}a ≡ 0 (mod ${n})`, `that allows gcd(${m}, ${n}) = ${gcd(m, n)} values of a`],
          trick: "The image of the generator must have order dividing m.",
          mistakes: wrong(String(gcd(m, n)), [
            { answer: String(n), why: `Not every a works: φ(${m}·1) = ${m}a must be 0 in ℤ${n}.` },
            { answer: String(lcm(m, n)), why: "The count is gcd(m, n), the number of a with ma ≡ 0 (mod n)." },
            { answer: "1", why: "The zero map is one of them, but there are more when gcd(m, n) > 1." },
          ]),
        };
      }
      const valid = Array.from({ length: n }, (_, a) => a).filter((a) => a && (m * a) % n === 0);
      if (!valid.length) return this.gen(1, r);
      const a = r.pick(valid);
      const img = n / gcd(a, n), ker = m / img;
      return {
        prompt: `$\\varphi : \\mathbb{Z}_{${m}} \\to \\mathbb{Z}_{${n}}$ is the homomorphism with $\\varphi(1) = ${a}$. How many elements does $\\ker\\varphi$ have?`,
        answer: String(ker), params: { m, n, a, ask },
        steps: [`im φ = ⟨${a}⟩ has order ${n}/gcd(${a}, ${n}) = ${img}`, `|ker φ| = ${m}/${img} = ${ker}`],
        trick: "First isomorphism theorem: G/ker φ ≅ im φ.",
        mistakes: wrong(String(ker), [
          { answer: String(img), why: "That is the image's size; the kernel is |G|/|im φ|." },
          { answer: String(gcd(a, n)), why: `Count x in ℤ${m} with ${a}x ≡ 0 (mod ${n}).` },
        ]),
      };
    },
  });

  const partitions = (n, max = n) => (n === 0 ? [[]] : Array.from({ length: Math.min(n, max) }, (_, i) => i + 1).reverse()
    .flatMap((k) => partitions(n - k, k).map((p) => [k, ...p])));

  def(AA, ["herstein:2.11", "herstein:3.2"], {
    id: "al-conjugacy", name: "Conjugacy classes in Sₙ",
    blurb: "Conjugate permutations have the same cycle type; a class has n!/∏ kᵐᵏ mₖ! elements.",
    source: from("herstein", "2.11 Conjugacy and Sylow's Theorem"),
    gen(level, r) {
      const n = r.int(band(level, [3, 4, 4, 5, 6]), band(level, [4, 5, 6, 7, 8]));
      if (level <= 1 || r() < 0.3) {
        const k = partitions(n).length;
        return {
          prompt: `How many conjugacy classes does the symmetric group $S_{${n}}$ have?`,
          answer: String(k), params: { n, ask: "classes" },
          steps: [`classes ↔ cycle types ↔ partitions of ${n}`, `p(${n}) = ${k}`],
          trick: "Two permutations are conjugate iff they have the same cycle type.",
          mistakes: wrong(String(k), [
            { answer: String(fact(n)), why: "That is |Sₙ|; many permutations share a class." },
            { answer: String(n), why: "Classes match partitions of n, and there are more than n of those." },
          ]),
        };
      }
      const types = partitions(n).filter((p) => p.length < n);
      const p = r.pick(types);
      const counts = {};
      p.forEach((k) => { counts[k] = (counts[k] ?? 0) + 1; });
      const size = fact(n) / Object.entries(counts).reduce((s, [k, m]) => s * Number(k) ** m * fact(m), 1);
      const noM = fact(n) / p.reduce((s, k) => s * k, 1);
      const shown = p.filter((k) => k > 1).join(", ") || "1";
      return {
        prompt: `How many permutations in $S_{${n}}$ have cycle type (${p.join(", ")}) (cycle lengths ${shown}${p.includes(1) ? ", plus fixed points" : ""})?`,
        answer: String(size), params: { n, type: p, ask: "size" },
        steps: [`n!/∏ k^{m_k} m_k! with ${Object.entries(counts).map(([k, m]) => `${m} cycle${m > 1 ? "s" : ""} of length ${k}`).join(", ")}`, `= ${size}`],
        trick: "Divide by the rotations of each cycle and the orderings of equal cycles.",
        mistakes: wrong(String(size), [
          { answer: String(noM), why: "Equal-length cycles can be listed in any order: divide by m_k! too." },
          { answer: String(fact(n)), why: "Divide by the symmetries of the cycle notation." },
        ]),
      };
    },
  });

  def(AA, ["herstein:2.11", "herstein:2.8"], {
    id: "al-sylow", name: "Counting Sylow subgroups",
    blurb: "nₚ divides m and nₚ ≡ 1 (mod p), where |G| = pᵃm with p ∤ m.",
    source: from("herstein", "2.11 Conjugacy and Sylow's Theorem"),
    gen(level, r) {
      const orders = band(level, [[15, 35, 33], [21, 20, 12], [30, 56, 42], [60, 72, 100], [105, 132, 200, 120]]);
      const n = r.pick(orders);
      const p = r.pick(primeFactors(n));
      let m = n, a = 0;
      while (m % p === 0) { m /= p; a++; }
      const poss = divisors(m).filter((d) => d % p === 1);
      return {
        prompt: `A group has order ${n}. How many values does Sylow's theorem allow for the number $n_{${p}}$ of Sylow ${p}-subgroups?`,
        answer: String(poss.length), params: { n, p },
        steps: [`${n} = ${p}^${a}·${m}`, `n_${p} divides ${m} and ≡ 1 (mod ${p})`, `possible: ${poss.join(", ")}`],
        trick: "If the only value is 1, the Sylow subgroup is normal.",
        mistakes: wrong(String(poss.length), [
          { answer: String(divisors(m).length), why: `n_p must also be ≡ 1 (mod ${p}).` },
          { answer: String(divisors(n).filter((d) => d % p === 1).length), why: `n_p divides the part of |G| prime to ${p}, which is ${m}.` },
        ]),
      };
    },
  });

  // ==== rings, ideals, polynomials (Herstein 4) ======================================

  def(AA, ["herstein:4.1", "herstein:4.2"], {
    id: "al-ring-elements", name: "Units, zero divisors and idempotents in ℤₙ",
    blurb: "Units: gcd(a, n) = 1. Zero divisors: the other non-zero elements. Idempotents: 2^(number of primes).",
    source: from("herstein", "4.2 Some Simple Results"),
    gen(level, r) {
      const n = r.int(band(level, [6, 8, 10, 12, 20]), band(level, [12, 20, 36, 60, 120]));
      const ask = r.pick(band(level, [["zd"], ["zd", "nil"], ["nil", "idem"], ["idem", "zd", "nil"], ["idem", "nil"]]));
      const xs = Array.from({ length: n }, (_, i) => i);
      const zd = xs.filter((a) => a && gcd(a, n) > 1).length;
      const nil = xs.filter((a) => { let x = a; for (let k = 0; k < 8; k++) x = (x * a) % n; return x === 0; }).length;
      const idem = xs.filter((a) => (a * a) % n === a).length;
      const [q, ans, mist] = {
        zd: [`How many non-zero zero divisors does $\\mathbb{Z}_{${n}}$ have?`, zd, [[n - phi(n), "Exclude 0 itself."], [phi(n), "That counts the units, which are never zero divisors."]]],
        nil: [`How many nilpotent elements does $\\mathbb{Z}_{${n}}$ have (including 0)?`, nil, [[zd + 1, "Zero divisors needn't be nilpotent: a is nilpotent iff every prime of n divides a."], [1, `n = ${n} isn't square-free${nil > 1 ? ", so there are non-zero nilpotents" : ""}.`]]],
        idem: [`How many idempotents ($e^2 = e$) does $\\mathbb{Z}_{${n}}$ have?`, idem, [[2, "Besides 0 and 1, each way of splitting n's prime powers gives an idempotent (CRT)."], [primeFactors(n).length, "It's 2^(number of distinct primes), by the Chinese remainder theorem."]]],
      }[ask];
      return {
        prompt: q, answer: String(ans), params: { n, ask },
        steps: [`n = ${n}, primes ${primeFactors(n).join(", ")}`, `count = ${ans}`],
        trick: "Split ℤₙ by the CRT into ℤ_{pᵏ} factors and count in each.",
        mistakes: wrong(String(ans), mist.filter(([a, why]) => why && a !== ans).map(([a, why]) => ({ answer: String(a), why }))),
      };
    },
  });

  def(AA, ["herstein:4.3", "herstein:4.4"], {
    id: "al-ideals-zn", name: "Ideals and quotients of ℤ and ℤₙ",
    blurb: "Ideals of ℤₙ ↔ divisors of n; maximal ideals ↔ primes; (a) + (b) = (gcd), (a) ∩ (b) = (lcm).",
    source: from("herstein", "4.4 Maximal Ideals"),
    gen(level, r) {
      const ask = r.pick(band(level, [["count"], ["count", "max"], ["sum", "cap", "max"], ["sum", "cap", "quot"], ["quot", "cap", "count"]]));
      const n = r.int(6, band(level, [30, 60, 100, 200, 360]));
      const a = r.int(4, 40), b = r.int(4, 40);
      const [q, ans, steps, mist] = {
        count: [`How many ideals does $\\mathbb{Z}_{${n}}$ have?`, divisors(n).length, [`ideals are (d) for d | ${n}`, `${divisors(n).length} divisors`], [[primeFactors(n).length, "Every divisor gives an ideal, not only primes."], [2, `ℤ${n} is not a field unless ${n} is prime.`]]],
        max: [`How many maximal ideals does $\\mathbb{Z}_{${n}}$ have?`, primeFactors(n).length, [`maximal ideals are (p) for primes p | ${n}`, `${primeFactors(n).join(", ")}`], [[divisors(n).length - 1, "Only the prime divisors give maximal ideals."], [1, "There is one for each prime dividing n."]]],
        sum: [`In ℤ, the ideal $(${a}) + (${b})$ equals $(d)$ with $d > 0$. What is d?`, gcd(a, b), [`(a) + (b) = (gcd(a, b))`, `gcd(${a}, ${b}) = ${gcd(a, b)}`], [[a + b, "The sum of ideals isn't generated by a + b; it's all xa + yb."], [lcm(a, b), "lcm generates the intersection."]]],
        cap: [`In ℤ, the ideal $(${a}) \\cap (${b})$ equals $(d)$ with $d > 0$. What is d?`, lcm(a, b), [`(a) ∩ (b) = (lcm(a, b))`, `lcm = ${lcm(a, b)}`], [[a * b, "Common multiples start at the lcm, which can be smaller than ab."], [gcd(a, b), "gcd generates the sum (a) + (b)."]]],
        quot: [`How many elements does $\\mathbb{Z}_{${n}}/(\\bar{${a}})$ have?`, gcd(a, n), [`(ā) = (gcd(${a}, ${n})) in ℤ${n}`, `quotient has ${gcd(a, n)} elements`], [[n / gcd(a, n), "That is the size of the ideal; the quotient has n/|ideal| elements."], [a, `In ℤ${n}, (ā) = (gcd(a, n)).`]]],
      }[ask];
      return {
        prompt: q, answer: String(ans), params: { ask, n, a, b },
        steps, trick: "ℤ is a PID: every ideal is (d) for one d.",
        mistakes: wrong(String(ans), mist.map(([v, why]) => ({ answer: String(v), why }))),
      };
    },
  });

  def(AA, ["herstein:4.5", "herstein:4.6"], {
    id: "al-polynomial-roots", name: "Roots of polynomials mod p and over ℚ",
    blurb: "Remainder theorem; count roots mod p by trying every residue; rational roots divide a₀ over aₙ.",
    source: from("herstein", "4.5 Polynomial Rings"),
    gen(level, r) {
      const fam = r.pick(band(level, [["rem"], ["rem", "modp"], ["modp", "rational"], ["rational", "modp"], ["rational", "rem"]]));
      if (fam === "rem") {
        const p = r.pick([5, 7, 11, 13]), k = r.int(3, band(level, [6, 10, 20, 50, 100])), a = r.int(2, p - 1), c = r.int(1, p - 1);
        let v = 1;
        for (let i = 0; i < k; i++) v = (v * a) % p;
        const ans = (v + c) % p;
        return {
          prompt: `In $\\mathbb{Z}_{${p}}[x]$, what is the remainder when $x^{${k}} + ${c}$ is divided by $x - ${a}$?`,
          answer: String(ans), params: { fam, p, k, a, c },
          steps: [`remainder = f(${a}) = ${a}^${k} + ${c} mod ${p}`, `${a}^${k} ≡ ${v}`, `= ${ans}`],
          trick: "The remainder on dividing by x − a is f(a). Fermat shortens the power.",
          mistakes: wrong(String(ans), [
            { answer: String(v), why: `Add the constant ${c}.` },
            { answer: String((((a * k) % p) + c) % p), why: `${a}^${k} is a power, not ${a}·${k}.` },
          ]),
        };
      }
      if (fam === "modp") {
        const p = r.pick([5, 7, 11, 13, 17]), b = r.int(0, p - 1), c = r.int(0, p - 1);
        const roots = Array.from({ length: p }, (_, x) => x).filter((x) => (x * x + b * x + c) % p === 0);
        return {
          prompt: `How many roots does $x^2 + ${b}x + ${c}$ have in $\\mathbb{Z}_{${p}}$?`,
          answer: String(roots.length), params: { fam, p, b, c },
          steps: [`try x = 0, …, ${p - 1}`, roots.length ? `roots: ${roots.join(", ")}` : "none"],
          trick: "A degree-2 polynomial over a field has at most 2 roots.",
          mistakes: wrong(String(roots.length), [
            { answer: "2", why: "Over ℤₚ a quadratic can have 0, 1 or 2 roots: the discriminant may not be a square." },
            { answer: String(p), why: "At most 2: ℤₚ is a field." },
            { answer: "0", why: "Check each residue: some are roots." },
          ]),
        };
      }
      const rs = [r.int(-4, 4), r.int(-4, 4)];
      const lead = r.pick([1, 2, 3]);
      const q = r.pick([1, 2, 3, 5]);
      // f = lead·(x − r1)(x − r2)(x² + q): x² + q has no rational root
      const cs = [lead * rs[0] * rs[1] * q, -lead * (rs[0] + rs[1]) * q, lead * (rs[0] * rs[1] + q), -lead * (rs[0] + rs[1]), lead];
      const distinct = new Set(rs).size;
      const P = cs.map((c, i) => [c, i]).reverse().filter(([c]) => c).map(([c, i], j) => {
        const s = c < 0 ? "-" : j ? "+" : "";
        const m = Math.abs(c);
        return `${j ? ` ${s} ` : s}${i === 0 ? m : `${m === 1 ? "" : m}x${i > 1 ? `^{${i}}` : ""}`}`;
      }).join("");
      return {
        prompt: `How many distinct rational roots does $${P}$ have?`,
        answer: String(distinct), params: { fam, cs },
        steps: [`candidates ±(divisors of ${Math.abs(cs[0]) || "the lowest non-zero coefficient"})/(divisors of ${lead})`, `test them: ${[...new Set(rs)].join(", ")} are roots; x² + ${q} has none`],
        trick: "Rational root theorem, then divide out what you find.",
        mistakes: wrong(String(distinct), [
          { answer: "4", why: `A degree-4 polynomial has at most 4 roots, but x² + ${q} contributes no real ones.` },
          { answer: String(rs.length), why: distinct < 2 ? "A repeated root counts once as a distinct root." : "" },
        ].filter((m) => m.why)),
      };
    },
  });

  // ==== fields (Herstein 5, 6) ===========================================================

  const squarefree = (n) => { let s = 1; for (const p of primeFactors(n)) { let k = 0; while (n % p === 0) { n /= p; k++; } if (k % 2) s *= p; } return s; };

  def(AA, ["herstein:5.3", "herstein:5.4"], {
    id: "al-field-degree", name: "Degrees of field extensions",
    blurb: "[K : ℚ] multiplies up towers: [ℚ(α, β) : ℚ] = [ℚ(α, β) : ℚ(α)]·[ℚ(α) : ℚ].",
    source: from("herstein", "5.4 Finite Extensions"),
    gen(level, r) {
      const fam = r.pick(band(level, [["root"], ["root", "two"], ["two", "mixed"], ["mixed", "two"], ["mixed", "root", "two"]]));
      if (fam === "root") {
        const p = r.pick([2, 3, 5, 7]), n = r.int(2, 6);
        return {
          prompt: `What is $[\\mathbb{Q}(\\sqrt[${n}]{${p}}) : \\mathbb{Q}]$?`,
          answer: String(n), params: { fam, p, n },
          steps: [`x^${n} − ${p} is irreducible by Eisenstein at ${p}`, `so the degree is ${n}`],
          trick: "Eisenstein at p makes xⁿ − p irreducible.",
          mistakes: wrong(String(n), [{ answer: "2", why: "Only square roots have degree 2." }, { answer: String(n - 1), why: "The minimal polynomial xⁿ − p has degree n." }, { answer: String(n * p), why: "The degree depends on the root taken, not on the number under it." }]),
        };
      }
      if (fam === "two") {
        for (;;) {
          const a = r.pick([2, 3, 5, 6, 7, 10, 12, 15, 18, 8]), b = r.pick([2, 3, 5, 6, 7, 10, 12, 15, 8, 27]);
          if (squarefree(a) === 1 || squarefree(b) === 1) continue;
          const d = squarefree(a) === squarefree(b) ? 2 : 4;
          return {
            prompt: `What is $[\\mathbb{Q}(\\sqrt{${a}}, \\sqrt{${b}}) : \\mathbb{Q}]$?`,
            answer: String(d), params: { fam, a, b },
            steps: [`√${a} = ${squarefree(a) === a ? `√${a}` : `(…)√${squarefree(a)}`}, √${b} likewise with √${squarefree(b)}`, d === 2 ? "same square class: one square root suffices" : `√${b} ∉ ℚ(√${a}), so the degree is 2·2 = 4`],
            trick: "√b ∈ ℚ(√a) exactly when ab is a square in ℚ.",
            mistakes: [{ answer: d === 2 ? "4" : "2", why: d === 2 ? `√${a} and √${b} differ by a rational factor.` : `√${b} is not in ℚ(√${a}): ${a}·${b} isn't a square.` }, { answer: "3", why: "Degrees of towers of square roots are powers of 2." }],
          };
        }
      }
      const m = r.pick([2, 3]), n = r.pick([3, 4, 5]);
      const pa = r.pick([2, 3]), pb = pa === 2 ? 3 : 2;
      const d = lcm(m, n) === m * n ? m * n : null;
      if (!d) return this.gen(2, r);
      return {
        prompt: `What is $[\\mathbb{Q}(\\sqrt[${m}]{${pa}}, \\sqrt[${n}]{${pb}}) : \\mathbb{Q}]$?`,
        answer: String(d), params: { fam, m, n, pa, pb },
        steps: [`the degree is divisible by ${m} and by ${n}`, `and at most ${m}·${n}`, `gcd = 1, so it is ${d}`],
        trick: "Coprime degrees multiply.",
        mistakes: [{ answer: String(m + n), why: "Degrees multiply in towers; they don't add." }, { answer: String(Math.max(m, n)), why: `Both ${m} and ${n} divide the degree.` }],
      };
    },
  });

  def(AA, ["herstein:6.2", "herstein:6.3", "herstein:6.4"], {
    id: "al-finite-fields", name: "Finite fields",
    blurb: "GF(pⁿ): pⁿ − 1 non-zero elements, a cyclic multiplicative group, one subfield per divisor of n.",
    source: from("herstein", "6.2 Finite Fields I"),
    gen(level, r) {
      const p = r.pick(band(level, [[2, 3], [2, 3, 5], [2, 3, 5], [2, 3, 5, 7], [2, 3]]));
      const n = r.int(2, band(level, [3, 3, 4, 5, 6]));
      const q = p ** n;
      const ask = r.pick(band(level, [["gens"], ["gens", "subfields"], ["subfields", "irred"], ["irred", "gens"], ["irred", "subfields"]]));
      if (ask === "gens") {
        return {
          prompt: `How many generators does the multiplicative group of $GF(${q})$ have?`,
          answer: String(phi(q - 1)), params: { p, n, ask },
          steps: [`GF(${q})* is cyclic of order ${q - 1}`, `generators: φ(${q - 1}) = ${phi(q - 1)}`],
          trick: "A cyclic group of order m has φ(m) generators.",
          mistakes: wrong(String(phi(q - 1)), [
            { answer: String(q - 1), why: "Not every non-zero element generates: only those of order q − 1." },
            { answer: String(phi(q)), why: `The group has order ${q} − 1 = ${q - 1}.` },
          ]),
        };
      }
      if (ask === "subfields") {
        return {
          prompt: `How many subfields does $GF(${p}^{${n}})$ have (including itself and $GF(${p})$)?`,
          answer: String(divisors(n).length), params: { p, n, ask },
          steps: [`subfields are GF(${p}^d) for d | ${n}`, `divisors: ${divisors(n).join(", ")}`],
          trick: "GF(pᵈ) ⊆ GF(pⁿ) iff d divides n.",
          mistakes: wrong(String(divisors(n).length), [
            { answer: String(n), why: `Only d dividing ${n} give subfields.` },
            { answer: "2", why: n === 1 ? "" : "Every divisor d of n gives one." },
          ].filter((m) => m.why)),
        };
      }
      const cnt = divisors(n).reduce((s, d) => s + mu(d) * p ** (n / d), 0) / n;
      return {
        prompt: `How many monic irreducible polynomials of degree ${n} are there over $GF(${p})$?`,
        answer: String(cnt), params: { p, n, ask },
        steps: [`(1/n)·Σ_{d|n} μ(d)·${p}^{n/d}`, `= ${cnt}`],
        trick: "Every element of GF(pⁿ) is a root of exactly one monic irreducible of degree dividing n.",
        mistakes: wrong(String(cnt), [
          { answer: String((q - p) / n), why: n === 2 || isPrime(n) ? "" : "Subtract elements of every proper subfield, via Möbius inversion." },
          { answer: String(q), why: "That counts all monic polynomials of degree n." },
          { answer: String(p ** (n - 1)), why: "Irreducibles are much rarer: about pⁿ/n." },
        ].filter((m) => m.why)),
      };
    },
  });

  def(AA, ["herstein:6.5", "herstein:5.5"], {
    id: "al-cyclotomic", name: "Cyclotomic polynomials and constructible polygons",
    blurb: "deg Φₙ = φ(n); a regular n-gon is constructible iff φ(n) is a power of 2.",
    source: from("herstein", "6.5 Cyclotomic Polynomials"),
    gen(level, r) {
      const n = r.int(3, band(level, [12, 20, 30, 60, 100]));
      if (level >= 3 && r() < 0.5) {
        const ok = (phi(n) & (phi(n) - 1)) === 0;
        return {
          prompt: `Is the regular ${n}-gon constructible with straightedge and compass?`,
          answer: ok ? "Yes" : "No", format: "choice", params: { n, ask: "gon" },
          steps: [`φ(${n}) = ${phi(n)}`, ok ? "a power of 2: constructible (Gauss)" : "not a power of 2: not constructible"],
          trick: "n = 2ᵏ times distinct Fermat primes (3, 5, 17, 257, 65537).",
          mistakes: [{ answer: ok ? "No" : "Yes", why: ok ? `φ(${n}) = ${phi(n)} is a power of 2.` : `φ(${n}) = ${phi(n)} is not a power of 2.` }],
        };
      }
      const ask = r.pick(["deg", "at1"]);
      const ps = primeFactors(n);
      const at1 = ps.length === 1 ? ps[0] : 1;
      const ans = ask === "deg" ? phi(n) : at1;
      return {
        prompt: ask === "deg" ? `What is the degree of the cyclotomic polynomial $\\Phi_{${n}}(x)$?` : `What is $\\Phi_{${n}}(1)$?`,
        answer: String(ans), params: { n, ask },
        steps: ask === "deg" ? [`deg Φₙ = φ(n) = ${phi(n)}`] : [`Φₙ(1) = p if n is a power of a prime p, else 1 (n > 1)`, `n = ${n}: ${ans}`],
        trick: "xⁿ − 1 = ∏_{d|n} Φ_d(x).",
        mistakes: wrong(String(ans), ask === "deg"
          ? [{ answer: String(n - 1), why: "n − 1 is right only when n is prime." }, { answer: String(n), why: "xⁿ − 1 has degree n; Φₙ keeps only the primitive roots." }]
          : [{ answer: "0", why: "1 is a root of Φ₁ only." }, { answer: String(n), why: "Evaluate ∏_{d|n, d>1} Φ_d(1) = n and divide out the smaller divisors." }]),
      };
    },
  });

  // ==== linear algebra (Axler) ==========================================================

  /** A random integer matrix of the given size and rank (product of random factors). */
  function matrixOfRank(r, rows, cols, rk) {
    for (;;) {
      const B = Array.from({ length: rows }, () => Array.from({ length: rk }, () => r.int(-2, 2)));
      const C = Array.from({ length: rk }, () => Array.from({ length: cols }, () => r.int(-2, 2)));
      const A = B.map((row) => C[0].map((_, j) => row.reduce((s, b, k) => s + b * C[k][j], 0)));
      if (rank(A) === rk && A.every((row) => row.some((x) => x))) return A;
    }
  }

  def(LA, ["axler:2.1", "axler:2.2", "axler:2.3"], {
    id: "la-span-dimension", name: "Dimension of a span",
    blurb: "dim span(v₁, …, vₖ) is the number of linearly independent vectors among them.",
    source: from("axler", "2.3 Dimension"),
    gen(level, r) {
      const dim = band(level, [3, 3, 4, 4, 5]), k = r.int(2, band(level, [3, 4, 4, 5, 5]));
      const rk = r.int(1, Math.min(k - 1, dim));
      const A = matrixOfRank(r, k, dim, rk);
      return {
        prompt: `What is the dimension of the span of ${A.map((v) => `(${v.join(", ")})`).join(", ")} in $\\mathbb{R}^{${dim}}$?`,
        answer: String(rk), params: { A },
        steps: ["row-reduce the matrix with these vectors as rows", `${rk} non-zero row${rk > 1 ? "s" : ""} remain`],
        trick: "The span's dimension is the rank.",
        mistakes: wrong(String(rk), [
          { answer: String(k), why: "Some of the vectors are combinations of the others." },
          { answer: String(dim), why: "The span needn't be all of ℝⁿ." },
        ]),
      };
    },
  });

  def(LA, ["axler:1.4", "axler:1.5", "axler:2.3"], {
    id: "la-subspace-dim", name: "Dimensions of subspaces",
    blurb: "dim(U + W) = dim U + dim W − dim(U ∩ W); count free parameters.",
    source: from("axler", "2.3 Dimension"),
    gen(level, r) {
      const fam = r.pick(band(level, [["sum"], ["sum", "poly"], ["poly", "matrix"], ["matrix", "sum"], ["matrix", "poly"]]));
      if (fam === "sum") {
        const n = r.int(5, 12), u = r.int(2, n - 1), w = r.int(2, n - 1);
        const i = r.int(Math.max(0, u + w - n), Math.min(u, w));
        const ans = u + w - i;
        return {
          prompt: `U and W are subspaces of $\\mathbb{R}^{${n}}$ with dim U = ${u}, dim W = ${w} and dim(U ∩ W) = ${i}. What is dim(U + W)?`,
          answer: String(ans), params: { fam, n, u, w, i },
          steps: [`${u} + ${w} − ${i} = ${ans}`],
          trick: "Inclusion–exclusion for dimensions.",
          mistakes: wrong(String(ans), [
            { answer: String(u + w), why: "The intersection is counted twice: subtract it." },
            { answer: String(Math.max(u, w)), why: "U + W contains both, and is usually bigger than either." },
          ]),
        };
      }
      if (fam === "poly") {
        const m = r.int(2, 8), k = r.int(1, Math.min(3, m));
        const pts = Array.from({ length: k }, (_, i) => i * 2 - 1);
        const ans = m + 1 - k;
        return {
          prompt: `What is the dimension of $\\{p \\in \\mathcal{P}_{${m}}(\\mathbb{R}) : ${pts.map((a) => `p(${a}) = 0`).join(",\\ ")}\\}$?`,
          answer: String(ans), params: { fam, m, k },
          steps: [`dim 𝒫${m} = ${m + 1}`, `${k} independent linear condition${k > 1 ? "s" : ""} (distinct points)`, `${m + 1} − ${k} = ${ans}`],
          trick: "Each vanishing condition at a new point costs one dimension.",
          mistakes: wrong(String(ans), [
            { answer: String(m - k), why: `𝒫${m} has dimension m + 1 = ${m + 1}.` },
            { answer: String(m + 1), why: "The conditions cut the dimension down." },
          ]),
        };
      }
      const n = r.int(2, 6);
      const [name, d, why] = r.pick([["symmetric", (n * (n + 1)) / 2, "entries on and above the diagonal"], ["skew-symmetric", (n * (n - 1)) / 2, "entries strictly above the diagonal"],
        ["trace-zero", n * n - 1, "one linear condition on n² entries"], ["upper-triangular", (n * (n + 1)) / 2, "entries on and above the diagonal"], ["diagonal", n, "the diagonal entries"]]);
      return {
        prompt: `What is the dimension of the space of ${n}×${n} ${name} real matrices?`,
        answer: String(d), params: { fam, n, name },
        steps: [`free parameters: ${why}`, `= ${d}`],
        trick: "Count the entries you can choose freely.",
        mistakes: wrong(String(d), [
          { answer: String(n * n), why: "That is all n×n matrices; the condition fixes some entries." },
          { answer: String(name === "skew-symmetric" ? (n * (n + 1)) / 2 : (n * (n - 1)) / 2), why: name === "skew-symmetric" ? "The diagonal of a skew-symmetric matrix is 0." : "Count the diagonal too." },
        ]),
      };
    },
  });

  def(LA, ["axler:3.2", "axler:3.3", "axler:3.4"], {
    id: "la-differentiation-map", name: "The differentiation map on polynomials",
    blurb: "D: 𝒫ₘ → 𝒫ₘ has null space the constants; Dᵏ kills degree < k.",
    source: from("axler", "3.2 Null Spaces and Ranges"),
    gen(level, r) {
      const m = r.int(2, 9), k = r.int(1, band(level, [1, 2, 3, 3, 4]));
      const ask = r.pick(["null", "range"]);
      const nul = Math.min(k, m + 1), rg = m + 1 - nul;
      const ans = ask === "null" ? nul : rg;
      return {
        prompt: `$D$ is differentiation on $\\mathcal{P}_{${m}}(\\mathbb{R})$. What is the dimension of the ${ask === "null" ? "null space" : "range"} of $D${k > 1 ? `^{${k}}` : ""}$?`,
        answer: String(ans), params: { m, k, ask },
        steps: [`D${k > 1 ? `^${k}` : ""} kills exactly the polynomials of degree < ${k}: dim ${nul}`, `range: polynomials of degree ≤ ${m - k}, dim ${rg}`, "(and the two add to m + 1)"],
        trick: "Rank–nullity: dim null + dim range = m + 1.",
        mistakes: wrong(String(ans), [
          { answer: String(ask === "null" ? rg : nul), why: `That is the ${ask === "null" ? "range" : "null space"}.` },
          { answer: String(ask === "null" ? 1 : m), why: k > 1 ? `D^${k} kills more than the constants: everything of degree < ${k}.` : "𝒫ₘ has dimension m + 1." },
        ]),
      };
    },
  });

  def(LA, ["axler:6.1", "axler:6.2"], {
    id: "la-inner-product", name: "Inner products on polynomials",
    blurb: "⟨p, q⟩ = ∫₀¹ p q; ⟨xʲ, xᵏ⟩ = 1/(j + k + 1).",
    source: from("axler", "6.1 Inner Products"),
    gen(level, r) {
      const a = [r.int(-3, 3), r.int(-3, 3) || 1], b = [r.int(-3, 3), r.int(-3, 3) || 1];
      const ip = (p, q) => {
        let s = F(0);
        p.forEach((x, j) => q.forEach((y, k) => { s = F(s.n * (j + k + 1) + x * y * s.d, s.d * (j + k + 1)); }));
        return s;
      };
      const ask = level <= 2 ? "ip" : r.pick(["ip", "norm2", "proj"]);
      const P = (c) => `${c[1] === 1 ? "" : c[1] === -1 ? "-" : c[1]}x ${c[0] < 0 ? "-" : "+"} ${Math.abs(c[0])}`;
      if (ask === "ip") {
        const v = ip(a, b);
        return {
          prompt: `On $\\mathcal{P}_1(\\mathbb{R})$ with $\\langle p, q\\rangle = \\int_0^1 p(x)q(x)\\,dx$, compute $\\langle ${P(a)},\\ ${P(b)}\\rangle$.`,
          answer: str(v), params: { a, b, ask },
          steps: [`expand the product and use ∫₀¹ xᵏ dx = 1/(k + 1)`, `= ${str(v)}`],
          trick: "Bilinearity: work monomial by monomial.",
          mistakes: wrong(str(v), [
            { answer: String(a[0] * b[0] + a[1] * b[1]), why: "That is the dot product of coefficient vectors; this inner product integrates." },
            { answer: str(F(a[0] * b[0] * 2 + (a[0] * b[1] + a[1] * b[0]) + a[1] * b[1], 2)), why: "∫₀¹ x² = 1/3 and ∫₀¹ x = 1/2: weight each term." },
          ]),
        };
      }
      if (ask === "norm2") {
        const v = ip(a, a);
        return {
          prompt: `With $\\langle p, q\\rangle = \\int_0^1 pq$, what is $\\|${P(a)}\\|^2$?`,
          answer: str(v), params: { a, b, ask },
          steps: [`∫₀¹ (${P(a)})² dx = ${str(v)}`],
          trick: "‖p‖² = ⟨p, p⟩.",
          mistakes: wrong(str(v), [
            { answer: String(a[0] ** 2 + a[1] ** 2), why: "Integrate the square; don't just add squared coefficients." },
            { answer: str(F(a[0] * 2 + a[1], 2)), why: "Square p before integrating." },
          ]),
        };
      }
      // projection of b onto the constants: ⟨b, 1⟩/⟨1, 1⟩ = mean value of b on [0, 1]
      const c = ip(b, [1]);
      return {
        prompt: `With $\\langle p, q\\rangle = \\int_0^1 pq$, the orthogonal projection of $${P(b)}$ onto the constant polynomials is a constant c. What is c?`,
        answer: str(c), params: { a, b, ask },
        steps: [`c = ⟨p, 1⟩/⟨1, 1⟩ = ∫₀¹ p`, `= ${str(c)}`],
        trick: "Projecting onto constants gives the average value.",
        mistakes: wrong(str(c), [
          { answer: String(b[0]), why: "The constant term isn't the projection: p's slope shifts its average." },
          { answer: String(b[0] + b[1]), why: "That is p(1); the projection is the average ∫₀¹ p." },
        ]),
      };
    },
  });

  def(LA, ["axler:6.3", "axler:6.4"], {
    id: "la-gram-schmidt", name: "Gram–Schmidt and distance to a subspace",
    blurb: "e₂ ∝ v₂ − ⟨v₂, e₁⟩e₁; the distance from v to U is ‖v − P_U v‖.",
    source: from("axler", "6.4 Orthogonal Projections and Minimization Problems"),
    gen(level, r) {
      for (;;) {
        const u = [r.int(-3, 3), r.int(-3, 3), r.int(-3, 3)], v = [r.int(-4, 4), r.int(-4, 4), r.int(-4, 4)];
        const uu = u.reduce((s, x) => s + x * x, 0);
        if (!uu) continue;
        const uv = u.reduce((s, x, i) => s + x * v[i], 0);
        const w = v.map((x, i) => F(x * uu - uv * u[i], uu)); // v − proj_u v
        const d2 = w.reduce((s, x) => F(s.n * x.d * x.d + x.n * x.n * s.d, s.d * x.d * x.d), F(0));
        if (d2.n === 0) continue;
        const ask = level <= 2 ? "coef" : r.pick(["coef", "dist2"]);
        if (ask === "coef") {
          const c = F(uv, uu);
          return {
            prompt: `Project $v = (${v.join(", ")})$ onto the line spanned by $u = (${u.join(", ")})$: $P v = c\\,u$. What is c?`,
            answer: str(c), params: { u, v, ask },
            steps: [`c = ⟨v, u⟩/⟨u, u⟩ = ${uv}/${uu}`],
            trick: "Divide by ‖u‖², not ‖u‖.",
            mistakes: wrong(str(c), [
              { answer: fmt(uv / Math.sqrt(uu)), why: "That is the length of the projection; the coefficient of u divides by ‖u‖²." },
              { answer: String(uv), why: `u isn't a unit vector: divide by ⟨u, u⟩ = ${uu}.` },
            ]),
          };
        }
        return {
          prompt: `What is the squared distance from $v = (${v.join(", ")})$ to the line spanned by $u = (${u.join(", ")})$ in $\\mathbb{R}^3$?`,
          answer: str(d2), params: { u, v, ask },
          steps: [`v − (⟨v, u⟩/⟨u, u⟩)u = (${w.map(str).join(", ")})`, `its squared norm: ${str(d2)}`],
          trick: "Pythagoras: ‖v‖² − ⟨v, u⟩²/‖u‖².",
          mistakes: wrong(str(d2), [
            { answer: String(v.reduce((s, x) => s + x * x, 0)), why: "Subtract the projection first." },
            { answer: str(F(uv * uv, uu)), why: "That is the squared length of the projection, the part along u." },
          ]),
        };
      }
    },
  });

  def(LA, ["axler:7.1", "axler:7.2", "axler:7.4", "axler:7.6"], {
    id: "la-spectral", name: "Self-adjoint, positive and singular values",
    blurb: "Symmetric ⇒ real eigenvalues, orthonormal eigenbasis; singular values are √eig(AᵀA).",
    source: from("axler", "7.2 The Spectral Theorem"),
    gen(level, r) {
      const fam = r.pick(band(level, [["posdef"], ["posdef", "sv"], ["sv", "normal"], ["sv", "posdef", "normal"], ["sv", "normal"]]));
      if (fam === "posdef") {
        const a = r.int(-3, 6), b = r.int(-4, 4), d = r.int(-3, 6);
        const pd = a > 0 && a * d - b * b > 0;
        const psd = a >= 0 && d >= 0 && a * d - b * b >= 0;
        const ans = pd ? "Positive definite" : psd ? "Positive semidefinite, not definite" : "Not positive";
        return {
          prompt: `Is the operator on $\\mathbb{R}^2$ with matrix $${mtex([[a, b], [b, d]])}$ positive?`,
          answer: ans, format: "choice", params: { fam, a, b, d },
          steps: [`symmetric; trace ${a + d}, determinant ${a * d - b * b}`, ans],
          trick: "For a symmetric 2×2: positive definite iff a > 0 and det > 0.",
          mistakes: ["Positive definite", "Positive semidefinite, not definite", "Not positive"].filter((x) => x !== ans)
            .map((x) => ({ answer: x, why: x === "Not positive" ? "Both eigenvalues are ≥ 0 (trace and determinant ≥ 0)." : x === "Positive definite" ? "An eigenvalue is ≤ 0: check a and the determinant." : "Check the determinant: it's either positive (definite) or negative (not positive)." })),
        };
      }
      if (fam === "sv") {
        const s1 = r.int(1, 6), s2 = r.int(1, 6);
        const A = r.pick([[[s1, 0], [0, -s2]], [[0, s1], [s2, 0]], [[s1, 0], [0, s2]]]);
        const big = Math.max(s1, s2);
        return {
          prompt: `What is the largest singular value of $${mtex(A)}$?`,
          answer: String(big), params: { fam, A },
          steps: [`AᵀA = diag(${s1 * s1}, ${s2 * s2}) (in some order)`, `singular values √ of those: ${s1}, ${s2}`, `largest ${big}`],
          trick: "Signs and swaps don't change singular values.",
          mistakes: wrong(String(big), [
            { answer: String(big * big), why: "Take square roots of the eigenvalues of AᵀA." },
            { answer: String(A[0][0] + A[1][1]), why: "That is the trace; singular values come from AᵀA." },
            { answer: String(-Math.max(s1, s2)), why: "Singular values are non-negative." },
          ]),
        };
      }
      const S = [
        [[[1, 2], [2, 1]], "Self-adjoint (hence normal)", "It equals its transpose."],
        [[[0, -1], [1, 0]], "Normal but not self-adjoint", "AAᵀ = AᵀA = I, but Aᵀ = −A ≠ A."],
        [[[1, 1], [0, 1]], "Not normal", "AAᵀ = [[2,1],[1,1]] ≠ AᵀA = [[1,1],[1,2]]."],
        [[[2, -3], [3, 2]], "Normal but not self-adjoint", "It is aI + bJ with J a rotation: commutes with its transpose."],
        [[[3, 0], [0, -2]], "Self-adjoint (hence normal)", "Diagonal real matrices are symmetric."],
        [[[1, 2], [0, 3]], "Not normal", "AAᵀ ≠ AᵀA: compare the (1,1) entries, 5 vs 1."],
      ];
      const [A, ans, why] = r.pick(S);
      return {
        prompt: `Which describes the operator on $\\mathbb{R}^2$ with matrix $${mtex(A)}$?`,
        answer: ans, format: "choice", params: { fam, A },
        steps: [why], trick: "Normal: TT* = T*T. Self-adjoint: T = T*.",
        mistakes: ["Self-adjoint (hence normal)", "Normal but not self-adjoint", "Not normal"].filter((x) => x !== ans).map((x) => ({ answer: x, why: `Compute AAᵀ and AᵀA: ${why}` })),
      };
    },
  });

  def(LA, ["axler:8.1", "axler:8.2", "axler:8.5", "axler:8.6"], {
    id: "la-jordan", name: "Reading a Jordan form",
    blurb: "Blocks for λ: their number is dim E(λ), their total size the multiplicity, the largest the power in the minimal polynomial.",
    source: from("axler", "8.6 Jordan Form"),
    gen(level, r) {
      const eig = [2, -1, 3, 0, 5];
      const nl = level <= 2 ? 1 : r.int(1, 2);
      const blocks = [];
      for (let i = 0; i < nl; i++) {
        const nb = r.int(1, level <= 2 ? 2 : 3);
        for (let j = 0; j < nb; j++) blocks.push([eig[i], r.int(1, band(level, [2, 3, 3, 3, 4]))]);
      }
      const n = blocks.reduce((s, [, k]) => s + k, 0);
      if (n > 7) return this.gen(level > 1 ? level - 1 : 1, r);
      const J = Array.from({ length: n }, () => Array(n).fill(0));
      let o = 0;
      for (const [l, k] of blocks) { for (let i = 0; i < k; i++) { J[o + i][o + i] = l; if (i < k - 1) J[o + i][o + i + 1] = 1; } o += k; }
      const lam = blocks[0][0];
      const mine = blocks.filter(([l]) => l === lam).map(([, k]) => k);
      const ask = r.pick(["geo", "alg", "min"]);
      const minDeg = [...new Set(blocks.map(([l]) => l))].reduce((s, l) => s + Math.max(...blocks.filter(([m]) => m === l).map(([, k]) => k)), 0);
      const [q, ans, why] = {
        geo: [`What is $\\dim E(${lam}, T)$, the dimension of the eigenspace for ${lam}?`, mine.length, `one eigenvector per Jordan block for ${lam}`],
        alg: [`What is the dimension of the generalized eigenspace $G(${lam}, T)$?`, mine.reduce((s, k) => s + k, 0), `the total size of the blocks for ${lam}`],
        min: ["What is the degree of the minimal polynomial of T?", minDeg, "sum over eigenvalues of the largest block size"],
      }[ask];
      return {
        prompt: `T has matrix $${mtex(J)}$ (in Jordan form). ${q}`,
        answer: String(ans), params: { blocks, ask },
        steps: [`blocks: ${blocks.map(([l, k]) => `J${k}(${l})`).join(" ⊕ ")}`, why + ` = ${ans}`],
        trick: "Everything is read off the block sizes.",
        mistakes: wrong(String(ans), [
          { answer: String(mine.reduce((s, k) => s + k, 0)), why: "The eigenspace has one dimension per block, not per diagonal entry." },
          { answer: String(mine.length), why: "The generalized eigenspace includes every vector in the blocks." },
          { answer: String(n), why: "The minimal polynomial only needs the largest block for each eigenvalue." },
        ]),
      };
    },
  });

  def(LA, ["axler:10.3", "axler:10.4", "axler:10.5"], {
    id: "la-determinant-volume", name: "Determinants and volume",
    blurb: "det(AB) = det A det B, det(cA) = cⁿ det A; |det A| scales volume.",
    source: from("axler", "10.5 Volume"),
    gen(level, r) {
      const fam = r.pick(band(level, [["det3"], ["det3", "rules"], ["rules", "volume"], ["volume", "rules"], ["rules", "det3", "volume"]]));
      if (fam === "det3" || fam === "volume") {
        const A = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => r.int(-3, 4)));
        const d = det(A);
        const ans = fam === "volume" ? Math.abs(d) : d;
        const diag = A[0][0] * A[1][1] * A[2][2];
        return {
          prompt: fam === "volume"
            ? `What is the volume of the parallelepiped spanned by ${A.map((v) => `(${v.join(", ")})`).join(", ")}?`
            : `Compute $\\det ${mtex(A)}$.`,
          answer: String(ans), params: { fam, A },
          steps: [`cofactor expansion along the first row: det = ${d}`, ...(fam === "volume" ? [`volume = |det| = ${ans}`] : [])],
          trick: fam === "volume" ? "Volume is |det|: orientation doesn't matter." : "Expand along a row with zeros if there is one.",
          mistakes: wrong(String(ans), [
            { answer: String(diag), why: "The product of the diagonal is the determinant only for triangular matrices." },
            { answer: String(fam === "volume" ? d : -d), why: fam === "volume" ? "Volume is non-negative: take |det|." : "Check the signs of the cofactors: + − +." },
          ]),
        };
      }
      const n = r.int(2, 4), dA = r.pick([-3, -2, 2, 3, 5]), dB = r.pick([-2, 2, 3, 4]), c = r.pick([2, 3, -1, -2]);
      const which = r.pick(["cA", "AB", "inv", "AtB"]);
      const [q, ans, steps, mist] = {
        cA: [`$A$ is ${n}×${n} with $\\det A = ${dA}$. What is $\\det(${c}A)$?`, F(c ** n * dA), [`det(cA) = cⁿ det A = (${c})^${n}·${dA}`], [[F(c * dA), `Each of the ${n} rows is scaled by ${c}: cⁿ.`]]],
        AB: [`$\\det A = ${dA}$ and $\\det B = ${dB}$. What is $\\det(AB)$?`, F(dA * dB), [`det(AB) = det A · det B`], [[F(dA + dB), "Determinants multiply."]]],
        inv: [`$\\det A = ${dA}$. What is $\\det(A^{-1})$?`, F(1, dA), [`det(A⁻¹) = 1/det A`], [[F(-dA), "The inverse has reciprocal determinant, not negated."]]],
        AtB: [`$A$ and $B$ are ${n}×${n} with $\\det A = ${dA}$, $\\det B = ${dB}$. What is $\\det(A^{T} B^{-1})$?`, F(dA, dB), [`det Aᵀ = det A, det B⁻¹ = 1/det B`], [[F(dA * dB), "B⁻¹ contributes 1/det B."]]],
      }[which];
      return {
        prompt: q, answer: str(ans), params: { fam, which, n, dA, dB, c },
        steps: [...steps, `= ${str(ans)}`], trick: "det is multiplicative and unchanged by transpose.",
        mistakes: wrong(str(ans), mist.map(([v, why]) => ({ answer: str(v), why }))),
      };
    },
  });

  def(LA, ["axler:10.1", "axler:3.3"], {
    id: "la-change-basis", name: "Coordinates in a new basis",
    blurb: "Solve v = a b₁ + c b₂: the coordinates are the solution of a linear system.",
    source: from("axler", "10.1 Change of Basis"),
    gen(level, r) {
      for (;;) {
        const b1 = [r.int(-3, 3), r.int(-3, 3)], b2 = [r.int(-3, 3), r.int(-3, 3)];
        const D = b1[0] * b2[1] - b2[0] * b1[1];
        if (!D) continue;
        const v = [r.int(-6, 6), r.int(-6, 6)];
        const a = F(v[0] * b2[1] - b2[0] * v[1], D), c = F(b1[0] * v[1] - v[0] * b1[1], D);
        const ask = r.pick(["first", "second"]);
        const ans = ask === "first" ? a : c;
        return {
          prompt: `Write $v = (${v.join(", ")})$ as $a\\,(${b1.join(", ")}) + c\\,(${b2.join(", ")})$. What is ${ask === "first" ? "a" : "c"}?`,
          answer: str(ans), params: { b1, b2, v, ask },
          steps: [`solve the 2×2 system by Cramer's rule (determinant ${D})`, `a = ${str(a)}, c = ${str(c)}`],
          trick: "The coordinate vector is the inverse of the basis matrix applied to v.",
          mistakes: wrong(str(ans), [
            { answer: String(v[ask === "first" ? 0 : 1]), why: "Those are the standard coordinates; the new basis changes them." },
            { answer: str(ask === "first" ? c : a), why: "That is the other coefficient." },
            { answer: str(F(-ans.n, ans.d)), why: "Check the sign from Cramer's rule." },
          ]),
        };
      }
    },
  });

  // ==== proofs ==========================================================================

  def(AA, ["herstein:2.4"], {
    id: "al-proof-lagrange", name: "Proof: Lagrange's theorem",
    blurb: "The cosets of H partition G into pieces of size |H|.",
    source: from("herstein", "2.4 Lagrange's Theorem"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let G be a finite group and H a subgroup. Prove that |H| divides |G|.",
        steps: [
          { id: "s1", text: "For $a \\in G$, the map $h \\mapsto ah$ is a bijection $H \\to aH$, so every left coset has |H| elements." },
          { id: "s2", text: "Each $a \\in G$ lies in the coset $aH$, since $a = ae$." },
          { id: "s3", text: "If $aH \\cap bH \\neq \\emptyset$, say $ah_1 = bh_2$, then $a = bh_2h_1^{-1}$, so $aH = bH$." },
          { id: "s4", text: "So the distinct left cosets partition G.", after: ["s2", "s3"] },
          { id: "s5", text: "If there are k of them, $|G| = k|H|$.", after: ["s1", "s4"] },
        ],
        extras: [
          { id: "x1", text: "Every coset aH is a subgroup of G.", why: "Only H itself contains e; the other cosets aren't subgroups." },
          { id: "x2", text: "The cosets of H may overlap, so we count each element once.", why: "Distinct cosets are disjoint: that's what makes the count work." },
          { id: "x3", text: "Since H is normal, the cosets partition G.", why: "Cosets partition G for every subgroup, normal or not." },
        ],
      });
    },
  });

  def(AA, ["herstein:2.5"], {
    id: "al-proof-kernel-normal", name: "Proof: the kernel is a normal subgroup",
    blurb: "φ(gkg⁻¹) = φ(g)φ(k)φ(g)⁻¹ = e.",
    source: from("herstein", "2.5 Homomorphisms and Normal Subgroups"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let $\\varphi: G \\to H$ be a homomorphism and $K = \\ker\\varphi$. Prove that K is a normal subgroup of G.",
        steps: [
          { id: "s1", text: "$\\varphi(e) = e$, so $e \\in K$." },
          { id: "s2", text: "If $a, b \\in K$ then $\\varphi(ab^{-1}) = \\varphi(a)\\varphi(b)^{-1} = e$, so $ab^{-1} \\in K$: K is a subgroup.", after: ["s1"] },
          { id: "s3", text: "Let $g \\in G$ and $k \\in K$." },
          { id: "s4", text: "$\\varphi(gkg^{-1}) = \\varphi(g)\\varphi(k)\\varphi(g)^{-1} = \\varphi(g)\\,e\\,\\varphi(g)^{-1} = e$.", after: ["s3"] },
          { id: "s5", text: "So $gKg^{-1} \\subseteq K$ for every g: K is normal.", after: ["s2", "s4"] },
        ],
        extras: [
          { id: "x1", text: "$\\varphi(gkg^{-1}) = \\varphi(k)$ because G is abelian.", why: "G needn't be abelian; the argument uses φ(k) = e instead." },
          { id: "x2", text: "Since $\\varphi$ is injective, K = {e}.", why: "φ isn't assumed injective." },
          { id: "x3", text: "$\\varphi(ab) = \\varphi(a) + \\varphi(b)$.", why: "The groups are written multiplicatively: φ(ab) = φ(a)φ(b)." },
        ],
      });
    },
  });

  def(AA, ["herstein:2.3", "herstein:2.4"], {
    id: "al-proof-cyclic-subgroup", name: "Proof: subgroups of cyclic groups are cyclic",
    blurb: "Take the least positive power in H; division with remainder shows it generates.",
    source: from("herstein", "2.3 Subgroups"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let $G = \\langle g \\rangle$ be cyclic and $H \\neq \\{e\\}$ a subgroup. Prove that H is cyclic.",
        steps: [
          { id: "s1", text: "H contains some $g^k$ with $k \\neq 0$, hence (with its inverse) some positive power of g." },
          { id: "s2", text: "Let m be the least positive integer with $g^m \\in H$.", after: ["s1"] },
          { id: "s3", text: "Take $g^n \\in H$ and write $n = qm + s$ with $0 \\le s < m$." },
          { id: "s4", text: "Then $g^s = g^n (g^m)^{-q} \\in H$, so $s = 0$ by minimality of m.", after: ["s2", "s3"] },
          { id: "s5", text: "So every element of H is a power of $g^m$: $H = \\langle g^m \\rangle$.", after: ["s4"] },
        ],
        extras: [
          { id: "x1", text: "Let m be the largest integer with $g^m \\in H$.", why: "Powers in H are unbounded (g^{2m}, g^{3m}, …): use the least positive one." },
          { id: "x2", text: "Then $g^s \\in H$, so $s = m$.", why: "0 ≤ s < m, so s can't equal m; minimality forces s = 0." },
          { id: "x3", text: "Every subgroup of an abelian group is cyclic.", why: "False: ℤ₂ × ℤ₂ is abelian and not cyclic." },
        ],
      });
    },
  });

  def(AA, ["herstein:4.3", "herstein:1.5"], {
    id: "al-proof-pid", name: "Proof: every ideal of ℤ is principal",
    blurb: "The least positive element generates, by division with remainder.",
    source: from("herstein", "4.3 Ideals, Homomorphisms, and Quotient Rings"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Prove that every ideal I of $\\mathbb{Z}$ is of the form $(d) = d\\mathbb{Z}$.",
        steps: [
          { id: "s1", text: "If $I = \\{0\\}$, take d = 0." },
          { id: "s2", text: "Otherwise I contains a positive integer (if $a \\in I$ then $-a \\in I$); let d be the least one." },
          { id: "s3", text: "Since I is an ideal, $(d) \\subseteq I$.", after: ["s2"] },
          { id: "s4", text: "For $a \\in I$ write $a = qd + r$ with $0 \\le r < d$; then $r = a - qd \\in I$.", after: ["s2"] },
          { id: "s5", text: "By minimality r = 0, so $a \\in (d)$ and $I = (d)$.", after: ["s3", "s4"] },
        ],
        extras: [
          { id: "x1", text: "Let d be the largest element of I.", why: "Non-zero ideals of ℤ are unbounded." },
          { id: "x2", text: "Then $r = a + qd \\in I$.", why: "r = a − qd; the sign matters for staying in I." },
          { id: "x3", text: "Since ℤ is a field, its only ideals are 0 and ℤ.", why: "ℤ is not a field: 2 has no inverse." },
        ],
      });
    },
  });

  def(AA, ["herstein:4.2", "herstein:5.1"], {
    id: "al-proof-zp-field", name: "Proof: ℤₚ is a field",
    blurb: "Bézout: gcd(a, p) = 1 gives ax + py = 1.",
    source: from("herstein", "4.2 Some Simple Results"),
    gen(level, r) {
      const p = r.pick([5, 7, 11, 13]);
      return proof(level, r, {
        statement: `Prove that $\\mathbb{Z}_{${p}}$ is a field (and in general $\\mathbb{Z}_p$ for p prime).`,
        steps: [
          { id: "s1", text: "$\\mathbb{Z}_p$ is a commutative ring with $1 \\ne 0$." },
          { id: "s2", text: "Let $\\bar a \\ne 0$, so p does not divide a." },
          { id: "s3", text: "Since p is prime, $\\gcd(a, p) = 1$.", after: ["s2"] },
          { id: "s4", text: "By Bézout there are integers x, y with $ax + py = 1$.", after: ["s3"] },
          { id: "s5", text: "Reducing mod p, $\\bar a\\,\\bar x = \\bar 1$: every non-zero element has an inverse.", after: ["s1", "s4"] },
        ],
        extras: [
          { id: "x1", text: "Since p is prime, $\\gcd(a, p) = p$.", why: "p doesn't divide a, so the gcd is 1." },
          { id: "x2", text: "Reducing mod p, $\\bar p\\,\\bar y = \\bar 1$.", why: "p̄ = 0 in ℤₚ: it's the ax term that survives." },
          { id: "x3", text: "Every finite ring is a field.", why: "False: ℤ₄ is finite and 2·2 = 0." },
        ],
      });
    },
  });

  def(LA, ["axler:5.1", "axler:5.4"], {
    id: "la-proof-eigen-independent", name: "Proof: eigenvectors for distinct eigenvalues are independent",
    blurb: "Apply T − λ₂I to a dependence relation: one term dies, the other survives.",
    source: from("axler", "5.1 Invariant Subspaces"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let $Tv_1 = \\lambda_1 v_1$ and $Tv_2 = \\lambda_2 v_2$ with $v_1, v_2 \\ne 0$ and $\\lambda_1 \\ne \\lambda_2$. Prove that $v_1, v_2$ are linearly independent.",
        steps: [
          { id: "s1", text: "Suppose $a_1 v_1 + a_2 v_2 = 0$." },
          { id: "s2", text: "Apply $T - \\lambda_2 I$: $a_1(\\lambda_1 - \\lambda_2)v_1 + a_2(\\lambda_2 - \\lambda_2)v_2 = 0$.", after: ["s1"] },
          { id: "s3", text: "So $a_1(\\lambda_1 - \\lambda_2)v_1 = 0$, and since $\\lambda_1 \\ne \\lambda_2$ and $v_1 \\ne 0$, $a_1 = 0$.", after: ["s2"] },
          { id: "s4", text: "Then $a_2 v_2 = 0$ with $v_2 \\ne 0$, so $a_2 = 0$.", after: ["s3"] },
        ],
        extras: [
          { id: "x1", text: "Apply T: $a_1\\lambda_1 v_1 + a_2\\lambda_2 v_2 = 0$, so $a_1 = a_2 = 0$.", why: "Applying T alone gives another relation, not the conclusion; subtract λ₂ times the first to kill a term." },
          { id: "x2", text: "Since $v_1 \\ne v_2$, they are independent.", why: "Distinct vectors can be dependent (v and 2v)." },
          { id: "x3", text: "So $a_1 = 0$ because $\\lambda_1 = 0$.", why: "λ₁ needn't be 0; what matters is λ₁ − λ₂ ≠ 0." },
        ],
      });
    },
  });

  def(LA, ["axler:7.1", "axler:6.1"], {
    id: "la-proof-real-eigenvalues", name: "Proof: self-adjoint operators have real eigenvalues",
    blurb: "λ‖v‖² = ⟨Tv, v⟩ = ⟨v, Tv⟩ = λ̄‖v‖².",
    source: from("axler", "7.1 Self-Adjoint and Normal Operators"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let T be a self-adjoint operator on a complex inner product space, and $Tv = \\lambda v$ with $v \\neq 0$. Prove that λ is real.",
        steps: [
          { id: "s1", text: "$\\lambda\\|v\\|^2 = \\langle \\lambda v, v\\rangle = \\langle Tv, v\\rangle$." },
          { id: "s2", text: "Since $T = T^*$, $\\langle Tv, v\\rangle = \\langle v, Tv\\rangle$." },
          { id: "s3", text: "$\\langle v, Tv\\rangle = \\langle v, \\lambda v\\rangle = \\bar\\lambda\\|v\\|^2$." },
          { id: "s4", text: "So $\\lambda\\|v\\|^2 = \\bar\\lambda\\|v\\|^2$, and since $v \\ne 0$, $\\lambda = \\bar\\lambda$.", after: ["s1", "s2", "s3"] },
        ],
        extras: [
          { id: "x1", text: "$\\langle v, \\lambda v\\rangle = \\lambda\\|v\\|^2$.", why: "The inner product is conjugate-linear in the second slot: λ̄." },
          { id: "x2", text: "Since T is self-adjoint, $Tv = v$.", why: "Self-adjoint means T = T*, not T = I." },
          { id: "x3", text: "Every eigenvalue of a real matrix is real.", why: "False: the rotation [[0, −1], [1, 0]] has eigenvalues ±i." },
        ],
      });
    },
  });

  def(LA, ["axler:3.2", "axler:3.4"], {
    id: "la-proof-injective-null", name: "Proof: T is injective iff null T = {0}",
    blurb: "Tu = Tv ⇔ T(u − v) = 0.",
    source: from("axler", "3.2 Null Spaces and Ranges"),
    gen(level, r) {
      return proof(level, r, {
        statement: "Let $T: V \\to W$ be linear. Prove that if $\\operatorname{null} T = \\{0\\}$ then T is injective.",
        steps: [
          { id: "s1", text: "Suppose $\\operatorname{null} T = \\{0\\}$ and $Tu = Tv$." },
          { id: "s2", text: "By linearity, $T(u - v) = Tu - Tv = 0$.", after: ["s1"] },
          { id: "s3", text: "So $u - v \\in \\operatorname{null} T = \\{0\\}$.", after: ["s2"] },
          { id: "s4", text: "Hence $u = v$: T is injective.", after: ["s3"] },
        ],
        extras: [
          { id: "x1", text: "Since $Tu = Tv$, we get $u = v$ by cancelling T.", why: "Cancelling T is injectivity itself: that's what we're proving." },
          { id: "x2", text: "So $u + v \\in \\operatorname{null} T$.", why: "Tu = Tv gives T(u − v) = 0, not T(u + v) = 0." },
          { id: "x3", text: "Since T is surjective, it is injective.", why: "Surjective doesn't imply injective in general (and isn't given)." },
        ],
      });
    },
  });
})();
