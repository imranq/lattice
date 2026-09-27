// Complex analysis generators on the topics of Stein & Shakarchi, Complex Analysis:
// the complex plane, holomorphic and harmonic functions, power series, Fourier
// transforms, real integrals by residues, zeros and poles, the argument
// principle, entire functions and their order, Γ and ζ, and conformal maps.
// Original problems, cited to the book (whose text Lattice doesn't host). The
// extraction groups Stein's exercises by page ("4 Exercises"), so each generator
// is tied to the groups whose exercises it practises.
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M || !M.bookSource) return;
  const { band, gcd } = M.util;
  const from = M.bookSource;

  const def = (groups, g) => M.define({
    domain: "complex analysis", prose: true, ...g, concepts: groups.map((x) => `concept:stein:group:${x}`),
  });
  const fmt = (x, dp = 4) => String(Number(x.toFixed(dp)));
  const wrong = (answer, list) => list.filter((m, i) => m.answer !== undefined && m.answer !== answer
    && !/NaN|Infinity|undefined/.test(String(m.answer)) && list.findIndex((x) => x.answer === m.answer) === i);
  const F = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
  const str = (a) => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
  const C = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - i + 1)) / i; return Math.round(c); };
  const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
  const cx = (re, im) => `${re}${im < 0 ? " - " : " + "}${Math.abs(im) === 1 ? "" : Math.abs(im)}i`;

  def(["4_exercises"], {
    id: "ca-complex-arithmetic", name: "Moduli, arguments and roots",
    blurb: "|zw| = |z||w|, arg(zw) = arg z + arg w; zⁿ = w has n roots spaced 2π/n apart.",
    source: from("stein", "1.1 Complex numbers and the complex plane"),
    gen(level, r) {
      const ask = r.pick(band(level, [["mod"], ["mod", "arg"], ["arg", "pow"], ["pow", "roots"], ["roots", "pow"]]));
      const trip = r.pick([[3, 4], [5, 12], [1, 1], [8, 15], [1, 2], [6, 8]]);
      const a = trip[0] * r.pick([1, -1]), b = trip[1] * r.pick([1, -1]);
      const mod = Math.hypot(a, b);
      if (ask === "mod") {
        const n = r.int(1, band(level, [2, 3, 4, 5, 6]));
        const ans = mod ** n;
        return {
          prompt: `What is $|(${cx(a, b)})^{${n}}|$?`, answer: fmt(ans), params: { ask, a, b, n },
          steps: [`|${cx(a, b)}| = √(${a * a} + ${b * b}) = ${fmt(mod)}`, `|zⁿ| = |z|ⁿ = ${fmt(ans)}`], trick: "Moduli multiply: no need to expand.",
          mistakes: wrong(fmt(ans), [{ answer: fmt((a * a + b * b) ** n), why: "|z| is the square root of a² + b²." }, { answer: fmt((Math.abs(a) + Math.abs(b)) ** n), why: "|a + bi| = √(a² + b²), not |a| + |b|." }]),
        };
      }
      if (ask === "arg") {
        const deg = ((Math.atan2(b, a) * 180) / Math.PI);
        return {
          prompt: `What is the principal argument of $${cx(a, b)}$, in degrees (in (−180, 180])?`, answer: fmt(deg, 2), params: { ask, a, b }, tolerance: 0.001,
          steps: [`atan2(${b}, ${a}) = ${fmt(deg, 2)}°`], trick: "Check the quadrant: arctan(b/a) alone loses it.",
          mistakes: wrong(fmt(deg, 2), [{ answer: fmt((Math.atan(b / a) * 180) / Math.PI, 2), why: a < 0 ? "arctan(b/a) is off by 180° in the left half-plane." : "" }, { answer: fmt(-deg, 2), why: "That's the conjugate's argument." }].filter((m) => m.why)),
        };
      }
      if (ask === "pow") {
        const n = r.int(2, 8), k = r.pick([1, 2, 3, 4, 6]);
        // (cos(π/k) + i sin(π/k))^n = cos(nπ/k) + i sin(nπ/k)
        const re = Math.cos((n * Math.PI) / k);
        return {
          prompt: `What is the real part of $\\left(\\cos\\tfrac{\\pi}{${k}} + i\\sin\\tfrac{\\pi}{${k}}\\right)^{${n}}$?`,
          answer: fmt(re), params: { ask, n, k }, tolerance: 0.001,
          steps: [`de Moivre: cos(${n}π/${k}) + i sin(${n}π/${k})`, `real part ${fmt(re)}`], trick: "Powers of unit complex numbers rotate.",
          mistakes: wrong(fmt(re), [{ answer: fmt(Math.cos(Math.PI / k) ** n), why: "Raise the whole number to the power (rotate n times), not just its real part." }, { answer: fmt(Math.sin((n * Math.PI) / k)), why: "That's the imaginary part." }]),
        };
      }
      const n = r.int(2, 8), R = r.pick([1, 8, 16, 27, 32]);
      const ask2 = r.pick(["count", "mod"]);
      const ans = ask2 === "count" ? String(n) : fmt(R ** (1 / n));
      return {
        prompt: ask2 === "count" ? `How many distinct complex solutions does $z^{${n}} = ${R}i$ have?` : `What is the modulus of each solution of $z^{${n}} = ${R}i$?`,
        answer: ans, params: { ask, n, R, ask2 }, tolerance: 0.001,
        steps: [`${R}i = ${R}e^{iπ/2}`, ask2 === "count" ? `n distinct roots e^{i(π/2 + 2πk)/n}·${R}^{1/n}, k = 0…${n - 1}` : `|z| = ${R}^{1/${n}} = ${ans}`],
        trick: "n-th roots sit evenly on a circle of radius |w|^{1/n}.",
        mistakes: wrong(ans, ask2 === "count" ? [{ answer: "1", why: "Over ℂ there are always n n-th roots of a non-zero number." }, { answer: "2", why: `z^${n} has ${n} roots.` }] : [{ answer: String(R), why: "Take the n-th root of the modulus." }, { answer: fmt(R / n), why: "Root, don't divide." }]),
      };
    },
  });

  def(["4_exercises"], {
    id: "ca-harmonic", name: "Holomorphic and harmonic functions",
    blurb: "u + iv is holomorphic iff uₓ = v_y and u_y = −vₓ; then u and v are harmonic.",
    source: from("stein", "1.2 Functions on the complex plane"),
    gen(level, r) {
      if (level <= 2 || r() < 0.4) {
        const a = r.int(-4, 4) || 1, b = r.pick([-a, a, 2 * a, -2 * a]);
        const ans = a + b === 0 ? "Yes" : "No";
        return {
          prompt: `Is $u(x, y) = ${a === 1 ? "" : a === -1 ? "-" : a}x^2 ${b < 0 ? "-" : "+"} ${Math.abs(b) === 1 ? "" : Math.abs(b)}y^2$ harmonic?`,
          answer: ans, format: "choice", params: { fam: "harm", a, b },
          steps: [`Δu = ${2 * a} + ${2 * b} = ${2 * (a + b)}`], trick: "Harmonic: u_xx + u_yy = 0.",
          mistakes: [{ answer: ans === "Yes" ? "No" : "Yes", why: `Δu = u_xx + u_yy = ${2 * (a + b)}.` }],
        };
      }
      // u = x² − y² + a x + b y ⇒ v = 2xy + a y − b x (with v(0) = 0)
      const a = r.int(-4, 4), b = r.int(-4, 4), x = r.int(-3, 3), y = r.int(-3, 3) || 1;
      const v = 2 * x * y + a * y - b * x;
      return {
        prompt: `$u(x, y) = x^2 - y^2 ${a < 0 ? "-" : "+"} ${Math.abs(a)}x ${b < 0 ? "-" : "+"} ${Math.abs(b)}y$ is the real part of a holomorphic f. Its harmonic conjugate v has v(0, 0) = 0. What is v(${x}, ${y})?`,
        answer: String(v), params: { fam: "conj", a, b, x, y },
        steps: [`v_y = uₓ = 2x + ${a} ⇒ v = 2xy + ${a}y + g(x)`, `vₓ = −u_y = 2y − ${b} ⇒ g′(x) = −${b}`, `v = 2xy + ${a}y − ${b}x = ${v}`],
        trick: "f(z) = z² + (a − ib)z: read v off the imaginary part.",
        mistakes: wrong(String(v), [{ answer: String(2 * x * y + a * y + b * x), why: "vₓ = −u_y: the sign flips." }, { answer: String(x * x - y * y + a * x + b * y), why: "That's u itself." }]),
      };
    },
  });

  def(["4_exercises", "5_problems"], {
    id: "ca-power-series", name: "Power series coefficients",
    blurb: "(1 − z)^{−m} = Σ C(n + m − 1, m − 1) zⁿ; products of series convolve coefficients.",
    source: from("stein", "1.4 Power series"),
    gen(level, r) {
      const m = r.int(2, band(level, [2, 3, 4, 5, 6])), n = r.int(1, band(level, [4, 6, 8, 10, 12]));
      const fam = level >= 4 && r() < 0.4 ? "exp" : "binom";
      if (fam === "exp") {
        const a = r.int(1, 4);
        // e^{az}/(1 − z): coefficient of zⁿ is Σ_{k≤n} a^k/k!
        let s = 0;
        for (let k = 0; k <= n; k++) s += a ** k / fact(k);
        return {
          prompt: `What is the coefficient of $z^{${n}}$ in the power series of $\\dfrac{e^{${a}z}}{1 - z}$ about 0 (4 decimal places)?`,
          answer: fmt(s), params: { fam, a, n }, tolerance: 0.001,
          steps: [`dividing by 1 − z takes partial sums`, `Σ_{k≤${n}} ${a}^k/k! = ${fmt(s)}`], trick: "1/(1 − z) turns coefficients into partial sums.",
          mistakes: wrong(fmt(s), [{ answer: fmt(a ** n / fact(n)), why: "That's e^{az}'s coefficient alone; 1/(1 − z) sums them." }, { answer: fmt(Math.exp(a)), why: "The full sum is the limit as n → ∞, not the n-th coefficient." }]),
        };
      }
      const c = C(n + m - 1, m - 1);
      return {
        prompt: `What is the coefficient of $z^{${n}}$ in the expansion of $(1 - z)^{-${m}}$?`,
        answer: String(c), params: { fam, m, n },
        steps: [`differentiate 1/(1 − z) ${m - 1} time${m > 2 ? "s" : ""}, or count: C(n + m − 1, m − 1)`, `C(${n + m - 1}, ${m - 1}) = ${c}`],
        trick: "Stars and bars: ways to write n as a sum of m non-negative parts.",
        mistakes: wrong(String(c), [{ answer: String(C(n + m, m)), why: `The coefficient is C(n + m − 1, m − 1).` }, { answer: String(m ** n), why: "Count compositions, not sequences." }, { answer: "1", why: m === 1 ? "" : "Only (1 − z)^{−1} has all coefficients 1." }].filter((mm) => mm.why)),
      };
    },
  });

  def(["4_exercises", "5_problems"], {
    id: "ca-fourier", name: "Fourier transforms by contour integration",
    blurb: "e^{−πax²} ↦ a^{−1/2}e^{−πξ²/a}; (1/π)·a/(a² + x²) ↦ e^{−2πa|ξ|}.",
    source: from("stein", "4 The Fourier transform"),
    gen(level, r) {
      const a = r.pick([0.5, 1, 2, 4]), xi = r.pick([0, 0.5, 1, 2].filter((x) => (x * x) / a <= 1));
      const fam = level <= 2 || r() < 0.5 ? "gauss" : "cauchy";
      if (fam === "gauss") {
        const v = Math.exp((-Math.PI * xi * xi) / a) / Math.sqrt(a);
        return {
          prompt: `With $\\hat f(\\xi) = \\int f(x)e^{-2\\pi i x\\xi}dx$, what is $\\hat f(${xi})$ for $f(x) = e^{-${a === 1 ? "" : a}\\pi x^2}$?`,
          answer: fmt(v), params: { fam, a, xi }, tolerance: 0.002,
          steps: [`shift the contour: \\hat f(ξ) = a^{−1/2} e^{−πξ²/a}`, `= ${fmt(v)}`], trick: "e^{−πx²} is its own Fourier transform.",
          mistakes: wrong(fmt(v), [{ answer: fmt(Math.exp(-Math.PI * a * xi * xi)), why: "Scaling x by √a scales ξ by 1/√a and the height by a^{−1/2}." }, { answer: fmt(Math.exp((-Math.PI * xi * xi) / a)), why: "Include the factor a^{−1/2}." }]),
        };
      }
      if (a * Math.abs(xi) > 1) return this.gen(1, r);
      const v = Math.exp(-2 * Math.PI * a * Math.abs(xi));
      return {
        prompt: `With $\\hat f(\\xi) = \\int f(x)e^{-2\\pi i x\\xi}dx$, what is $\\hat f(${xi})$ for $f(x) = \\dfrac{1}{\\pi}\\dfrac{${a}}{${a}^2 + x^2}$?`,
        answer: fmt(v, 5), params: { fam, a, xi }, tolerance: 0.002,
        steps: [`close the contour in the half-plane where e^{−2πizξ} decays; pole at z = ∓${a}i`, `\\hat f(ξ) = e^{−2π·${a}|ξ|} = ${fmt(v, 5)}`], trick: "The Poisson kernel's transform is an exponential.",
        mistakes: wrong(fmt(v, 5), [{ answer: fmt(Math.exp(-a * Math.abs(xi)), 5), why: "With this normalisation the exponent carries 2π." }, { answer: fmt(Math.exp(-2 * Math.PI * Math.abs(xi) / a), 5), why: "The width a multiplies ξ in the exponent." }]),
      };
    },
  });

  def(["8_exercises", "6_exercises"], {
    id: "ca-real-integrals", name: "Real integrals by residues",
    blurb: "Close in the upper half-plane: ∫ = 2πi Σ residues there.",
    source: from("stein", "3.2 The residue formula"),
    gen(level, r) {
      const fam = r.pick(band(level, [["a2"], ["a2", "cos"], ["sq", "cos"], ["x4", "sq", "cos"], ["x4", "sq", "cos"]]));
      const a = r.pick([1, 2, 3, 0.5]), b = r.pick([1, 2, 0.5]);
      const [tex, val, steps, mist] = {
        a2: [`\\frac{dx}{x^2 + ${a}^2}`, Math.PI / a, [`pole at ${a}i, residue 1/(2·${a}i)`, `2πi·1/(2${a}i) = π/${a}`], [[Math.PI / (a * a), "The residue at ai is 1/(2ai): one power of a."], [2 * Math.PI / a, "2πi times 1/(2ai) is π/a."]]],
        sq: [`\\frac{dx}{(x^2 + ${a}^2)^2}`, Math.PI / (2 * a ** 3), [`double pole at ${a}i: residue d/dz (z + ai)^{−2} = −2/(2ai)³`, `π/(2a³) = ${fmt(Math.PI / (2 * a ** 3))}`], [[Math.PI / (a ** 2), "At a double pole differentiate once; the result has a³."], [Math.PI / a, "That's ∫ 1/(x² + a²)."]]],
        cos: [`\\frac{\\cos(${b}x)}{x^2 + ${a}^2}`, (Math.PI / a) * Math.exp(-a * b), [`integrate e^{i${b}z}/(z² + ${a}²) over the upper half-plane`, `residue at ${a}i: e^{−${a * b}}/(2${a}i)`, `real part: (π/${a})e^{−${a * b}}`], [[Math.PI / a, "The oscillation cos(bx) damps the integral by e^{−ab}."], [(Math.PI / a) * Math.exp(-b / a), "Evaluate e^{ibz} at z = ai: e^{−ab}."]]],
        x4: [`\\frac{dx}{1 + x^4}`, Math.PI / Math.SQRT2, [`poles at e^{iπ/4}, e^{3iπ/4} in the upper half-plane`, `sum of residues gives π/√2`], [[Math.PI / 2, "Two poles lie in the upper half-plane, both contribute."], [Math.PI, "π is ∫ dx/(1 + x²); here sum the residues at e^{iπ/4} and e^{3iπ/4}."]]],
      }[fam];
      return {
        prompt: `Evaluate $\\int_{-\\infty}^{\\infty} ${tex}$ (4 decimal places).`,
        answer: fmt(val), params: { fam, a, b }, tolerance: 0.001,
        steps, trick: "The big semicircle contributes nothing when the integrand decays like 1/x².",
        mistakes: wrong(fmt(val), mist.map(([v, why]) => ({ answer: fmt(v), why }))),
      };
    },
  });

  def(["8_exercises"], {
    id: "ca-zeros-poles", name: "Orders of zeros and poles",
    blurb: "Order of a zero: the first non-vanishing Taylor coefficient. A pole of f is a zero of 1/f.",
    source: from("stein", "3.1 Zeros and poles"),
    gen(level, r) {
      const S = [
        () => { const k = r.int(1, 4); return ["zksin", k, `z^{${k}}\\sin z`, "order of the zero at 0", k + 1, [[k, "sin z has a simple zero at 0 too: orders add."]]]; },
        () => { const k = r.int(2, 5); return ["cos", k, `1 - \\cos(z^{${k}})`, "order of the zero at 0", 2 * k, [[k, "1 − cos w ~ w²/2, and w = z^k: order 2k."], [2, "Substitute z^k into 1 − cos w ≈ w²/2."]]]; },
        () => { const k = r.int(1, 3); return ["exp", k, `\\dfrac{1}{z^{${k}}(e^{z} - 1)}`, "order of the pole at 0", k + 1, [[k, "e^z − 1 also vanishes at 0 (simply)."]]]; },
        () => ["sin2", 0, `\\dfrac{1}{\\sin^2(\\pi z)}`, "order of the pole at z = 3", 2, [[1, "sin(πz) has simple zeros at the integers; squared gives order 2."]]],
        () => { const k = r.int(2, 4); return ["sinz", k, `\\dfrac{\\sin z}{z^{${k}}}`, "order of the pole at 0", k - 1, [[k, "sin z cancels one power of z."]]]; },
        () => ["exp2", 0, `e^{z} - 1 - z`, "order of the zero at 0", 2, [[1, "The constant and linear terms cancel: the first surviving term is z²/2."]]],
      ];
      const [key, k, f, what, ans, mist] = r.pick(S.slice(0, band(level, [2, 3, 4, 6, 6])))();
      return {
        prompt: `What is the ${what} of $f(z) = ${f}$?`, answer: String(ans), params: { key, k },
        steps: [`expand in a Laurent/Taylor series about the point`, `leading power gives order ${ans}`], trick: "Orders add under multiplication and subtract under division.",
        mistakes: wrong(String(ans), [...mist.map(([v, why]) => ({ answer: String(v), why })), { answer: "0", why: "The function does vanish (or blow up) there." }]),
      };
    },
  });

  def(["8_exercises"], {
    id: "ca-argument-principle", name: "Counting zeros inside a circle",
    blurb: "Zeros inside |z| = R = (1/2πi)∮ f′/f; Rouché: a dominant term decides the count.",
    source: from("stein", "3.4 The argument principle and applications"),
    gen(level, r) {
      const k = band(level, [2, 3, 3, 4, 4]);
      for (;;) {
        const roots = Array.from({ length: k }, () => [r.int(-3, 3), level >= 3 ? r.int(-2, 2) : 0]);
        const R = r.pick([1.5, 2.5, 3.2]);
        const mods = roots.map(([a, b]) => Math.hypot(a, b));
        if (mods.some((m) => Math.abs(m - R) < 0.2)) continue;
        const inside = mods.filter((m) => m < R).length;
        if (inside === 0 || inside === k) continue;
        // expand ∏ (z − r) with complex integer roots
        let c = [[1, 0]];
        for (const [a, b] of roots) {
          const n = c.map(() => [0, 0]).concat([[0, 0]]);
          c.forEach(([re, im], i) => { n[i + 1][0] += re; n[i + 1][1] += im; n[i][0] -= re * a - im * b; n[i][1] -= re * b + im * a; });
          c = n;
        }
        // c[i] multiplies z^i (after the loop: lowest power first)
        const terms = c.map(([re, im], i) => [re, im, i]).reverse().filter(([re, im]) => re || im).map(([re, im, i], j) => {
          const coef = im === 0 ? `${re}` : re === 0 ? (im === 1 ? "i" : im === -1 ? "-i" : `${im}i`) : `(${cx(re, im)})`;
          const body = i === 0 ? coef : `${coef === "1" ? "" : coef === "-1" ? "-" : coef}z${i > 1 ? `^{${i}}` : ""}`;
          return !j ? body : body.startsWith("-") ? `- ${body.slice(1)}` : `+ ${body}`;
        }).join(" ");
        const ans = mods.filter((m) => m < R).length;
        return {
          prompt: `How many zeros (with multiplicity) does $p(z) = ${terms}$ have inside $|z| < ${R}$?`,
          answer: String(ans), params: { roots, R },
          steps: [`p factors as ∏ (z − r) with roots ${roots.map(([a, b]) => cx(a, b).replace(" + 0i", "").replace(" - 0i", "")).join(", ")}`, `${ans} of them have modulus < ${R}`],
          trick: "The argument principle counts zeros without finding them; here factoring confirms the count.",
          mistakes: wrong(String(ans), [{ answer: String(k), why: "Not every root lies inside the circle." }, { answer: String(k - ans), why: "That counts the zeros outside." }]),
        };
      }
    },
  });

  def(["5_problems", "6_exercises"], {
    id: "ca-entire-order", name: "Order of growth of entire functions",
    blurb: "|f(z)| ≤ A e^{B|z|^ρ}: e^{z^k} has order k, sin z order 1, cos √z order 1/2, polynomials order 0.",
    source: from("stein", "5.2 Functions of finite order"),
    gen(level, r) {
      const k = r.int(2, 5);
      const S = [
        [`e^{z^{${k}}}`, String(k), `|e^{z^k}| ≤ e^{|z|^k}`], ["\\sin z", "1", "|sin z| ≤ e^{|z|}"], ["\\cos\\sqrt{z}", "1/2", "cos √z is entire (even series in √z) and ≤ e^{|z|^{1/2}}"],
        [`z^{${k}} + 1`, "0", "polynomials grow slower than any e^{|z|^ε}"], [`e^{${k}z}\\cos z`, "1", "e^{k|z|}·e^{|z|}: still exponential in |z|"], [`\\sin(z^{${k}})`, String(k), "sin w has order 1 and w = z^k"],
      ];
      const [f, ans, why] = r.pick(S.slice(0, band(level, [3, 4, 5, 6, 6])));
      const opts = ["0", "1/2", "1", String(k), String(2 * k)];
      return {
        prompt: `What is the order of growth of the entire function $${f}$?`, answer: ans, format: "choice", params: { f },
        steps: [why], trick: "Order ρ: the smallest exponent with |f(z)| ≤ A e^{B|z|^ρ}.",
        mistakes: opts.filter((o, i) => o !== ans && opts.indexOf(o) === i).slice(0, 3).map((o) => ({ answer: o, why: `Estimate |f(z)| on large circles: ${why}.` })),
      };
    },
  });

  def(["3_exercises", "5_problems"], {
    id: "ca-gamma-zeta", name: "Values of Γ and ζ",
    blurb: "Γ(n) = (n − 1)!, Γ(½) = √π, Γ(s + 1) = sΓ(s); ζ(2) = π²/6, ζ(0) = −½, ζ(−1) = −1/12.",
    source: from("stein", "6 The Gamma and Zeta Functions"),
    gen(level, r) {
      const fam = r.pick(band(level, [["gint"], ["gint", "ghalf"], ["ghalf", "zeta"], ["zeta", "ghalf", "ref"], ["ref", "zeta"]]));
      if (fam === "gint") {
        const n = r.int(2, 9);
        return {
          prompt: `What is Γ(${n})?`, answer: String(fact(n - 1)), params: { fam, n },
          steps: [`Γ(n) = (n − 1)! = ${fact(n - 1)}`], trick: "Γ is shifted by one from the factorial.",
          mistakes: wrong(String(fact(n - 1)), [{ answer: String(fact(n)), why: "Γ(n) = (n − 1)!, not n!." }, { answer: String(fact(n - 2)), why: "Γ(n) = (n − 1)!." }]),
        };
      }
      if (fam === "ghalf") {
        const n = r.int(1, 4);
        const v = (fact(2 * n) / (4 ** n * fact(n))) * Math.sqrt(Math.PI);
        return {
          prompt: `What is Γ(${n} + ½) (4 decimal places)?`, answer: fmt(v), params: { fam, n }, tolerance: 0.001,
          steps: [`Γ(½) = √π, and Γ(s + 1) = sΓ(s)`, `Γ(${n} + ½) = ${Array.from({ length: n }, (_, i) => `${2 * i + 1}/2`).join("·")}·√π = ${fmt(v)}`],
          trick: "Climb from Γ(½) = √π with the functional equation.",
          mistakes: wrong(fmt(v), [{ answer: fmt(fact(n) * Math.sqrt(Math.PI)), why: "The factors are ½, 3/2, 5/2, …, not 1, 2, 3, …." }, { answer: fmt(fact(n)), why: "Γ at half-integers carries √π." }]),
        };
      }
      if (fam === "zeta") {
        const [s, v, tex] = r.pick([[2, Math.PI ** 2 / 6, "π²/6"], [4, Math.PI ** 4 / 90, "π⁴/90"], [6, Math.PI ** 6 / 945, "π⁶/945"]]);
        return {
          prompt: `What is ζ(${s}) = Σ 1/n^${s} (4 decimal places)?`, answer: fmt(v), params: { fam, s }, tolerance: 0.001,
          steps: [`ζ(${s}) = ${tex}`, `= ${fmt(v)}`], trick: "Even zeta values are rational multiples of powers of π.",
          mistakes: wrong(fmt(v), [{ answer: fmt(1 + 2 ** -s), why: "The series keeps going past the first two terms." }, { answer: "1", why: "Every term after the first adds a little more." }]),
        };
      }
      const [s, v] = r.pick([[0, "-1/2"], [-1, "-1/12"], [-2, "0"], [-3, "1/120"]]);
      return {
        prompt: `By analytic continuation, what is ζ(${s})?`, answer: v, params: { fam, s },
        steps: [`the functional equation relates ζ(${s}) to ζ(${1 - s})`, `ζ(${s}) = ${v}`], trick: "ζ vanishes at the negative even integers (the trivial zeros).",
        mistakes: wrong(v, [{ answer: "undefined", why: "The series diverges there, but the continuation is finite." }, { answer: "-1/12", why: s === -1 ? "" : "−1/12 is ζ(−1)." }, { answer: "0", why: s === -2 ? "" : "ζ vanishes only at the negative even integers (and the non-trivial zeros)." }].filter((m) => m.why)),
      };
    },
  });

  def(["5_exercises", "6_problems"], {
    id: "ca-conformal", name: "Möbius maps and the disc",
    blurb: "ψ_α(z) = (α − z)/(1 − ᾱz) swaps α and 0; ρ(z, w) = |z − w|/|1 − w̄z| is invariant.",
    source: from("stein", "8.2 The Riemann mapping theorem"),
    gen(level, r) {
      const fam = r.pick(band(level, [["cayley"], ["cayley", "rho"], ["rho", "psi"], ["psi", "rho"], ["rho", "psi"]]));
      if (fam === "cayley") {
        const y = r.pick([1, 2, 3, 0.5, 4]);
        // F(z) = (i − z)/(i + z) at z = iy: (1 − y)/(1 + y)
        const v = (1 - y) / (1 + y);
        return {
          prompt: `The Cayley transform $F(z) = \\dfrac{i - z}{i + z}$ maps the upper half-plane to the unit disc. What is F(${y}i)? (It is real.)`,
          answer: fmt(v), params: { fam, y },
          steps: [`F(iy) = (i − iy)/(i + iy) = (1 − y)/(1 + y)`, `= ${fmt(v)}`], trick: "F(i) = 0: the point i goes to the centre.",
          mistakes: wrong(fmt(v), [{ answer: fmt((1 + y) / (1 - y)), why: "Numerator is i − z." }, { answer: fmt(-v), why: "Check the sign: F(iy) = (1 − y)/(1 + y)." }]),
        };
      }
      const a = r.pick([0, 0.5, -0.5, 0.25, 0.8]), b = r.pick([0.2, -0.3, 0.6, 0.9, -0.75]);
      if (fam === "rho") {
        const v = Math.abs(a - b) / Math.abs(1 - a * b);
        return {
          prompt: `The pseudo-hyperbolic distance in the unit disc is $\\rho(z, w) = \\left|\\dfrac{z - w}{1 - \\bar w z}\\right|$. What is ρ(${a}, ${b})?`,
          answer: fmt(v), params: { fam, a, b }, tolerance: 0.002,
          steps: [`|${a} − (${b})|/|1 − (${b})(${a})| = ${fmt(Math.abs(a - b))}/${fmt(Math.abs(1 - a * b))}`, `= ${fmt(v)}`], trick: "Points near the boundary are far apart even when close in the plane.",
          mistakes: wrong(fmt(v), [{ answer: fmt(Math.abs(a - b)), why: "Divide by |1 − w̄z|." }, { answer: fmt(Math.abs(a - b) / (1 + a * b)), why: "It's 1 − w̄z, not 1 + w̄z." }]),
        };
      }
      const v = (a - b) / (1 - a * b);
      return {
        prompt: `$\\psi_\\alpha(z) = \\dfrac{\\alpha - z}{1 - \\bar\\alpha z}$ with α = ${a}. What is ψ_α(${b})?`,
        answer: fmt(v), params: { fam, a, b }, tolerance: 0.002,
        steps: [`(${a} − ${b})/(1 − ${a}·${b}) = ${fmt(v)}`], trick: "ψ_α is its own inverse and swaps α with 0.",
        mistakes: wrong(fmt(v), [{ answer: fmt((b - a) / (1 - a * b)), why: "The numerator is α − z." }, { answer: fmt(a - b), why: "Divide by 1 − ᾱz." }]),
      };
    },
  });
})();
