#!/usr/bin/env python3
"""Recompute generated answers independently, with torch and numpy.

scripts/verify_generators.mjs sends one JSON record per line on stdin:
{"skill": ..., "params": {...}} and reads back {"value": ...} per line. Each
reference below computes the answer the way a practitioner would check it:
build the layer and count its parameters, run autograd, simulate the loop.
None of them reuse the closed forms in site/generators-ml.js, which is the
point: two derivations that agree are much stronger evidence than one.
"""
import json
import math
import re
import sys

import numpy as np
import torch
from torch import nn

torch.set_default_dtype(torch.float64)


def count(module):
    return sum(p.numel() for p in module.parameters())


def mlp_params(p):
    w = p["widths"]
    layers = []
    for a, b in zip(w, w[1:]):
        layers += [nn.Linear(a, b), nn.ReLU()]
    return count(nn.Sequential(*layers))


def conv1x1(p):
    return count(nn.Conv2d(p["cin"], p["cout"], 1))


def conv_sharing(p):
    return count(nn.Conv2d(p["cin"], p["cout"], p["k"], padding=p["k"] // 2))


def pooling(p):
    x = torch.zeros(1, p["c"], p["h"], p["h"])
    y = nn.MaxPool2d(p["p"], stride=p["s"], padding=p["pad"])(x)
    if p["ask"] == "height":
        return y.shape[2]
    return y.numel() * (p["p"] ** 2 - 1)


def vc_poly(p):
    return math.comb(p["n"] + p["k"], p["k"])


def interpolation(p):
    # Smallest degree whose Vandermonde system on distinct points is square.
    n = p["npts"]
    for d in range(0, n + 1):
        if d + 1 >= n:
            return d


def sqrt_n(p):
    if "k" in p:
        return p["k"] ** 2
    return p["e1"] * math.sqrt(p["n1"] / (p["n1"] * p["mult"]))


def best_constant(p):
    xs = np.array(p["xs"], dtype=float)
    loss = ((lambda b: np.abs(xs - b).sum()) if p["loss"] == "abs"
            else (lambda b: ((xs - b) ** 2).sum()))
    lo, hi = xs.min(), xs.max()
    for _ in range(300):  # ternary search: both losses are convex in b
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        lo, hi = (lo, m2) if loss(m1) < loss(m2) else (m1, hi)
    return (lo + hi) / 2


def noisy_gram(p):
    col = np.array(p["col"], dtype=float)
    rng = np.random.default_rng(0)
    noise = rng.normal(0, p["sigma"], size=(400000, len(col)))
    return float(((col + noise) ** 2).sum(1).mean())


def coin_variance(p):
    var = p["p"] * (1 - p["p"]) / p["n"]  # Var of a Binomial(n, p) / n, by definition
    if p["ask"] == "var":
        return var
    return var / p["eps"] ** 2


def markov_joint(p):
    pa = {1: p["pA"], 0: 1 - p["pA"]}
    pb = {(a, 1): (p["pB1"] if a else p["pB0"]) for a in (0, 1)}
    pb.update({(a, 0): 1 - pb[(a, 1)] for a in (0, 1)})
    pc = {(b, 1): (p["pC1"] if b else p["pC0"]) for b in (0, 1)}
    pc.update({(b, 0): 1 - pc[(b, 1)] for b in (0, 1)})
    table = {(a, b, c): pa[a] * pb[(a, b)] * pc[(b, c)]
             for a in (0, 1) for b in (0, 1) for c in (0, 1)}
    assert abs(sum(table.values()) - 1) < 1e-12
    return table[(p["a"], p["b"], p["c"])]


def logsumexp(p):
    return float(torch.logsumexp(torch.tensor(p["xs"], dtype=torch.float64), 0)) - p["offset"]


def norm_gradient(p):
    x = torch.tensor(p["xs"], dtype=torch.float64, requires_grad=True)
    torch.linalg.vector_norm(x).backward()
    return float(x.grad[p["i"]])


def chain_rule(p):
    x = torch.tensor(float(p["x"]), requires_grad=True)
    f = p["a"] * torch.log(x ** 2) * torch.sin(x) + p["b"] * x ** -1
    f.backward()
    return float(x.grad)


def vector_backward(p):
    x = torch.tensor([float(v) for v in p["xs"]], requires_grad=True)
    (p["coef"] * x ** p["k"]).sum().backward()
    return float(x.grad[p["i"]])


def tanh_sigmoid(p):
    a = math.atanh(p["t"])
    return math.tanh(a) if p["ask"] == "tanh" else 1 / (1 + math.exp(-2 * a))


def gd_stability(p):
    a = p["a"]
    if p["ask"] == "max-lr":
        # Bisect on "does GD from x0 = 1 shrink over many steps".
        lo, hi = 0.0, 10.0 / a
        for _ in range(200):
            mid = (lo + hi) / 2
            x = 1.0
            for _ in range(2000):
                x -= mid * a * x
            lo, hi = (mid, hi) if abs(x) < 1 else (lo, mid)
        return lo
    x = float(p["x0"])
    for _ in range(p["k"]):
        x -= p["eta"] * a * x
    return x


def bisection(p):
    lo, hi, steps = 0.0, float(p["width"]), 0
    while hi - lo > p["eps"] * (1 + 1e-12):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid)  # which half is kept does not change the count
        steps += 1
    return steps


def softplus_min(p):
    al, be, c = p["al"], p["be"], p["c"]
    f = lambda x: np.logaddexp(al * x, -be * x - c)
    lo, hi = -50.0, 50.0
    for _ in range(300):  # ternary search on a convex function
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        lo, hi = (lo, m2) if f(m1) < f(m2) else (m1, hi)
    return (lo + hi) / 2


def saddle(p):
    h = np.array([[2 * p["A"], p["B"]], [p["B"], 2 * p["C"]]], dtype=float)
    ev = np.linalg.eigvalsh(h)
    if ev.min() < 0 < ev.max():
        return "a saddle point"
    return "a minimum" if ev.min() > 0 else "a maximum"


def bootstrap(p):
    n = int(p["n"])
    if n <= 6:  # exact, by enumerating every sequence of draws
        from itertools import product
        seen = [len(set(s)) / n for s in product(range(n), repeat=n)]
        return sum(seen) / len(seen)
    rng = np.random.default_rng(0)
    trials = 2000 if n <= 1000 else 20
    return float(np.mean([len(np.unique(rng.integers(0, n, n))) / n for _ in range(trials)]))


def dropout(p):
    torch.manual_seed(0)
    x = torch.full((100000,), float(p["h"]))
    y = nn.functional.dropout(x, p=p["p"], training=True)
    return float(y[y != 0][0])


def early_stopping(p):
    losses, patience = p["losses"], p["patience"]
    best, best_e, wait = math.inf, None, 0
    for e, v in enumerate(losses):
        if v < best:
            best, best_e, wait = v, e, 0
        else:
            wait += 1
            if wait >= patience:
                return (e if p["ask"] == "stop" else best_e) + 1
    raise ValueError("never stopped")


def kfold(p):
    idx = np.arange(p["n"])
    folds = np.array_split(idx, p["K"])
    sizes = {len(np.setdiff1d(idx, f)) for f in folds}
    assert len(sizes) == 1
    return sizes.pop()


def grad_clip(p):
    w = torch.zeros(2, requires_grad=True)
    w.grad = torch.tensor([float(v) for v in p["g"]])
    torch.nn.utils.clip_grad_norm_([w], max_norm=p["theta"])
    return float(w.grad[p["i"]])


def ngram(p):
    if p["ask"] == "observed":
        return int(p["T"]) - p["n"] + 1
    return round(math.log10((10 ** p["k"]) ** p["n"]))


def padding(p):
    lens = p["lens"]
    mask = np.zeros((len(lens), max(lens)))
    for i, n in enumerate(lens):
        mask[i, :n] = 1
    return float((mask == 0).mean())


def onehot(p):
    W = torch.tensor(p["W"], dtype=torch.float64)
    e = nn.functional.one_hot(torch.tensor(p["i"] - 1), W.shape[0]).double()
    return float((e @ W)[p["j"] - 1])


def sinusoid_ar(p):
    return math.sin(p["w"] * (p["t"] + 1))


def additive_params(p):
    h = p["h"]
    m = nn.ModuleDict({"W_q": nn.Linear(p["q"], h, bias=False),
                       "W_k": nn.Linear(p["k"], h, bias=False),
                       "w_v": nn.Linear(h, 1, bias=False)})
    return count(m)


def additive_memory(p):
    B, n, h = p["B"], p["n"], p["h"]
    # The shape the broadcast q + k produces, without allocating it (at level 5
    # it is billions of floats, which is the point of the question).
    shape = torch.broadcast_shapes((B, n, 1, h), (B, 1, n, h))
    return math.prod(shape)


def attention_cov(p):
    K = torch.tensor(p["keys"], dtype=torch.float64)
    q = torch.tensor(p["q"], dtype=torch.float64)
    attn = lambda q: torch.softmax(K @ q, 0) @ K
    J = torch.autograd.functional.jacobian(attn, q)
    d = p["d"]
    return float(J[d, d])


def sinusoidal_pe(p):
    d, pos, col = p["d"], p["pos"], p["col"]
    P = np.zeros((pos + 1, d))
    X = np.arange(pos + 1)[:, None] / np.power(10000, np.arange(0, d, 2) / d)
    P[:, 0::2], P[:, 1::2] = np.sin(X), np.cos(X)
    return float(P[pos, col])


def nullspace_proj(p):
    W = np.array([[p["a"], p["b"]]], dtype=float)
    M = np.eye(2) - np.linalg.pinv(W) @ W
    i, j = p["which"]
    return float(M[i, j])


def linear_rank(p):
    w = p["widths"]
    rng = np.random.default_rng(0)
    M = np.eye(w[0])
    for a, b in zip(w, w[1:]):
        M = rng.normal(size=(b, a)) @ M
    return int(np.linalg.matrix_rank(M))


def backprop_memory(p):
    B, d, h, q = p["B"], p["d"], p["h"], p["q"]
    x = torch.zeros(B, d)
    z = nn.Linear(d, h, bias=False)(x)
    hid = torch.relu(z)
    o = nn.Linear(h, q, bias=False)(hid)
    return z.numel() + hid.numel() + o.numel()


# ---- einsum / einops / resource accounting ----------------------------------

def _operands(spec, sizes, rng=None):
    ins = spec.split("->")[0].split(",")
    mk = (lambda shp: rng.integers(-3, 4, size=shp).astype(float)) if rng else np.zeros
    return [mk(tuple(sizes[a] for a in s)) for s in ins]


def es_shape(p):
    out = np.einsum(p["spec"], *_operands(p["spec"], p["sizes"]))
    return "(" + ", ".join(str(d) for d in np.shape(out)) + ")"


def es_flops(p):
    # numpy's own naive-cost model (the number einsum_path reports, which it
    # prints to only four significant figures).
    try:
        from numpy._core import einsumfunc as ef
    except ImportError:  # numpy < 2
        from numpy.core import einsumfunc as ef
    lhs, out = p["spec"].split("->")
    ins = lhs.split(",")
    idx = set("".join(ins))
    inner = len(idx) > len(out)
    return float(ef._flop_count(idx, inner, len(ins), p["sizes"]))


def es_which(p):
    """Compute the named operation directly, then find which spec reproduces it."""
    rng = np.random.default_rng(1)
    m = {v: k for k, v in p["map"].items()}  # drawn letter -> template letter
    op = p["op"]
    n, mm, kk, B, H, S, D = 4, 3, 5, 2, 3, 4, 5
    if "trace" in op:
        A = rng.normal(size=(n, n)); args, want = [A], np.trace(A)
    elif "row sums" in op:
        A = rng.normal(size=(mm, n)); args, want = [A], A.sum(1)
    elif "outer" in op:
        u, v = rng.normal(size=mm), rng.normal(size=n); args, want = [u, v], np.outer(u, v)
    elif "batched matrix" in op:
        A, Bm = rng.normal(size=(B, mm, kk)), rng.normal(size=(B, kk, n)); args, want = [A, Bm], A @ Bm
    elif "attention" in op:
        Q, K = rng.normal(size=(B, H, S, D)), rng.normal(size=(B, H, S, D)); args, want = [Q, K], Q @ K.swapaxes(-1, -2)
    elif "quadratic" in op:
        X, A = rng.normal(size=(B, n)), rng.normal(size=(n, n)); args, want = [X, A, X], np.einsum("bi,ij,bj->b", X, A, X) * 0 + (X @ A * X).sum(1)
    else:
        raise ValueError(op)
    if "quadratic" in op:
        args = [X, A, X]
    matches = []
    for spec in p["specs"]:
        try:
            got = np.einsum(spec, *args)
        except ValueError:
            continue
        if np.shape(got) == np.shape(want) and np.allclose(got, want):
            matches.append(spec)
    if len(matches) != 1:
        raise ValueError(f"{len(matches)} specs compute {op}: {matches}")
    return matches[0]


def es_eval(p):
    A = np.array(p["A"], dtype=float)
    if p["kind"] == "frob":
        return float(np.einsum("ij,ij->", A, np.array(p["B"], dtype=float)))
    v = np.array(p["v"], dtype=float)
    if p["kind"] == "quad":
        return float(np.einsum("i,ij,j->", v, A, v))
    return float(np.einsum(p["spec"], A, v)[p["i"]])


def es_rearrange(p):
    from einops import rearrange
    if p["kind"] == "heads":
        x = np.zeros((p["b"], p["s"], p["h"] * p["d"]))
        y = rearrange(x, "b s (h d) -> b h s d", h=p["h"])
    elif p["kind"] == "merge":
        y = rearrange(np.zeros((p["b"], p["s"], p["d"])), "b s d -> (b s) d")
    else:
        x = np.zeros((p["b"], p["c"], p["H"], p["H"]))
        y = rearrange(x, "b c (h p1) (w p2) -> b (h w) (p1 p2 c)", p1=p["p"], p2=p["p"])
    return "(" + ", ".join(str(d) for d in y.shape) + ")"


def es_attn_memory(p):
    t = torch.empty(p["b"], p["h"], p["s"], p["s"], device="meta",
                    dtype=torch.float32 if p["bytes"] == 4 else torch.bfloat16)
    return t.numel() * t.element_size() / 2 ** 30


def es_loop(p):
    """Run the loop exactly as the learner sees it; it must equal einsum(answer)."""
    rng = np.random.default_rng(3)
    env = {"torch": torch}
    for name, shape in zip(p["names"], p["shapes"]):
        env[name] = torch.tensor(rng.integers(-4, 5, size=shape), dtype=torch.float64)
    for ch in set(p["spec"].replace(",", "").replace("->", "")):
        env[ch.upper()] = dict(zip(
            [c for s in p["spec"].split("->")[0].split(",") for c in s],
            [n for shape in p["shapes"] for n in shape]))[ch]
    exec(p["code"], env)
    want = torch.einsum(p["spec"], *[env[n] for n in p["names"]])
    got = torch.as_tensor(env["out"], dtype=torch.float64)
    return p["spec"] if got.shape == want.shape and torch.allclose(got, want) else "loop != einsum"


# ---- the book-topic generators (site/generators-books.js) ----------------------

from fractions import Fraction as Fr
import sympy as sp


def ra_delta_linear(p):
    # Largest δ with |f(x) − f(c)| ≤ ε on |x − c| < δ: bisect on the worst case,
    # evaluated at the window's edge.
    a, eps = p["a"], p["eps"]
    lo, hi = 0.0, 10.0
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if abs(a * mid) <= eps else (lo, mid)
    return lo


def ra_delta_square(p):
    c, eps = p["c"], p["eps"]
    d = min(1.0, eps / (2 * abs(c) + 1))
    # And check the δ really works: sup of |x² − c²| on the window is below ε.
    xs = np.linspace(c - d, c + d, 20001)[1:-1]
    assert np.max(np.abs(xs ** 2 - c ** 2)) < eps + 1e-12
    return d


def ra_sequence_N(p):
    P, Q, R, S, k = p["p"], p["q"], p["r"], p["s"], p["k"]
    L = Fr(P, R)
    err = lambda n: abs(Fr(P * n + Q, R * n + S) - L)
    # The error is decreasing in n, so the first n that works is N; confirm a tail too.
    n = 1
    while not err(n) < Fr(1, k):
        n += 1
    assert all(err(m) < Fr(1, k) for m in range(n, n + 200))
    return n


def ra_sup_limsup(p):
    n = sp.symbols("n", integer=True, positive=True)
    c = p["c"]
    a = {"shift": c - 1 / n, "alt": c + (-1) ** n / n,
         "osc": (-1) ** n * (1 + sp.Integer(1) / n) + c}[p["fam"]]
    terms = [a.subs(n, k) for k in range(1, 400)]
    m = sp.symbols("m", integer=True, positive=True)
    tails = [sp.limit(a.subs(n, 2 * m), m, sp.oo), sp.limit(a.subs(n, 2 * m + 1), m, sp.oo)]
    val = {"sup": max(terms + tails), "inf": min(terms + tails),
           "limsup": max(tails), "liminf": min(tails)}[p["ask"]]
    return float(val)


def ra_ratio_test(p):
    n = sp.symbols("n", integer=True, positive=True)
    tex = p["tex"]
    if "n!}{" in tex and "(n!)^2" not in tex:
        c = int(re.search(r"\\frac\{n!\}\{(\d+)\^n\}", tex).group(1)); a = sp.factorial(n) / c ** n
    elif "(n!)^2" in tex:
        a = sp.factorial(n) ** 2 / sp.factorial(2 * n)
    elif "\\frac{1}{n^" in tex:
        k = int(re.search(r"n\^\{(\d+)\}", tex).group(1)); a = 1 / n ** k
    else:
        k, c = map(int, re.search(r"n\^\{(\d+)\}\}\{(\d+)\^n\}", tex).groups()); a = n ** k / c ** n
    if p["ask"] == "L":
        return float(sp.limit(sp.simplify(sp.combsimp(a.subs(n, n + 1) / a)), n, sp.oo))
    return "converges" if sp.Sum(a, (n, 1, sp.oo)).is_convergent() else "diverges"


def ra_darboux(p):
    k, n = p["k"], p["n"]
    f = lambda x: x ** k
    lower = sum(min(f(Fr(i, n)), f(Fr(i + 1, n))) for i in range(n)) * Fr(1, n)
    upper = sum(max(f(Fr(i, n)), f(Fr(i + 1, n))) for i in range(n)) * Fr(1, n)
    return float({"lower": lower, "upper": upper, "gap": upper - lower}[p["ask"]])


def aa_order_zn(p):
    n, k = p["n"], p["k"]
    return next(m for m in range(1, n + 1) if (m * k) % n == 0)


def aa_perm_order(p):
    from sympy.combinatorics import Permutation
    return Permutation([x - 1 for x in p["p"]]).order()


def aa_perm_sign(p):
    from sympy.combinatorics import Permutation
    return "even" if Permutation([x - 1 for x in p["p"]]).is_even else "odd"


def aa_cyclic_count(p):
    n = p["n"]
    subgroups = {frozenset((k * j) % n for j in range(n)) for k in range(n)}
    gens = sum(1 for k in range(n) if len({(k * j) % n for j in range(n)}) == n)
    return len(subgroups) if p["ask"] == "subgroups" else gens


def nt_diophantine(p):
    a, b, c = p["a"], p["b"], p["c"]
    found = any((c - a * x) % b == 0 for x in range(-abs(b) * 5, abs(b) * 5 + 1))
    return "yes" if found else "no"


def nt_fermat_wilson(p):
    if "k" in p:
        return math.factorial(p["k"]) % p["p"]
    return pow(p["a"], p["e"], p["p"])


def nt_units(p):
    n = p["n"]
    if p["ask"] == "phi":
        return sum(1 for k in range(1, n + 1) if math.gcd(k, n) == 1)
    return next(x for x in range(n) if (p["a"] * x) % n == 1)


def la_eigen2(p):
    return float(max(np.linalg.eigvals(np.array(p["M"], dtype=float)).real))


def la_rank_nullity(p):
    if "A" in p:
        A = sp.Matrix(p["A"])
        return A.cols - A.rank()
    return p["n"] - p["rk"]


def la_trace_det(p):
    ev = p["ev"]
    rng = np.random.default_rng(len(ev))
    S = rng.normal(size=(len(ev), len(ev)))
    T = S @ np.diag(ev) @ np.linalg.inv(S)  # an operator with these eigenvalues
    return float(np.trace(T) if p["ask"] == "trace" else np.linalg.det(T))


def la_projection(p):
    u, v = np.array(p["u"], float), np.array(p["v"], float)
    # Least squares: the multiple of u closest to v.
    t, *_ = np.linalg.lstsq(u[:, None], v, rcond=None)
    return float((t[0] * u)[p["i"]])


def ca_residue(p):
    z = sp.symbols("z")
    f = (z + p["a"]) / ((z - p["p"]) * (z - p["q"]))
    if p["ask"] == "res":
        return float(sp.residue(f, z, p["p"]))
    inside = [x for x in (p["p"], p["q"]) if abs(x) < p["R"]]
    integral = 2 * sp.pi * sp.I * sum(sp.residue(f, z, x) for x in inside)
    return float(sp.simplify(integral / (sp.pi * sp.I)))


def ca_radius(p):
    n = sp.symbols("n", positive=True, integer=True)
    c, k = p["c"], p["k"]
    if p["fam"] == "geo":
        root = sp.limit((n ** k / sp.Integer(c) ** n) ** (1 / n), n, sp.oo)
    elif p["fam"] == "inv":
        root = sp.limit((sp.Integer(c) ** n * n ** k) ** (1 / n), n, sp.oo)
    else:  # z^{2n}/c^{2n}: coefficient of z^m is c^{-m} for even m
        root = sp.limit((sp.Integer(c) ** (-2 * n)) ** (1 / (2 * n)), n, sp.oo)
    return float(1 / root)


def pr_bayes_test(p):
    prev, sens, spec = Fr(str(p["prev"])), Fr(str(p["sens"])), Fr(str(p["spec"]))
    joint = {("D", "+"): prev * sens, ("D", "-"): prev * (1 - sens),
             ("H", "+"): (1 - prev) * (1 - spec), ("H", "-"): (1 - prev) * spec}
    pos = joint[("D", "+")] + joint[("H", "+")]
    return float(joint[("D", "+")] / pos)


def pr_indicators(p):
    rng = np.random.default_rng(7)
    trials = 200000
    if p["fam"] == "empty":
        draws = rng.integers(0, p["k"], size=(trials, p["n"]))
        seen = np.zeros((trials, p["k"]), bool)
        np.put_along_axis(seen, draws, True, axis=1)
        return float((~seen).sum(1).mean())
    if p["fam"] == "pairs":
        # Simulate and count matching pairs directly, over enough trials that the
        # small expectations (≈ 0.03) are pinned down to about 1%.
        t = 600000
        b = rng.integers(0, p["d"], size=(t, p["n"]), dtype=np.int16)
        total = 0
        for i in range(p["n"]):
            total += (b[:, i:i + 1] == b[:, i + 1:]).sum()
        return float(total / t)
    draws = rng.integers(0, p["d"], size=(trials // 4, p["n"]))
    return float(np.mean([len(np.unique(row)) for row in draws[:20000]]))


# ---- Street-Fighting Mathematics ---------------------------------------------

_DIM = {"T": (0, 0, 1), "t": (0, 0, 1), "v": (0, 1, -1), "F": (1, 1, -2), "L": (0, 1, 0), "g": (0, 1, -2),
        "\\lambda": (0, 1, 0), "\\rho": (1, -3, 0), "A": (0, 2, 0), "G": (-1, 3, -2), "M": (1, 0, 0),
        "R": (0, 1, 0), "\\sigma": (1, 0, -2), "h": (0, 1, 0)}
_DIMS = [("T", ["L", "g"]), ("v", ["g", "\\lambda"]), ("F", ["\\rho", "v", "A"]),
         ("v", ["G", "M", "R"]), ("v", ["\\sigma", "\\rho", "\\lambda"]), ("t", ["h", "g"])]


def sf_dimensions(p):
    out, ins = _DIMS[p["which"]]
    es = sp.symbols(f"e0:{len(ins)}")
    eqs = [sum(e * _DIM[q][k] for e, q in zip(es, ins)) - _DIM[out][k] for k in range(3)]
    sol = sp.solve(eqs, es, dict=True)[0]
    return float(sol[es[p["i"]]])


def sf_easy_cases(p):
    x, h, r1, r2 = sp.symbols("x h r1 r2", positive=True)
    radius = r1 + (r2 - r1) * x / h  # the frustum as a solid of revolution
    V = sp.integrate(sp.pi * radius ** 2, (x, 0, h))
    if p["ask"] == "formula":
        target = sp.pi * h * (r1 ** 2 + r1 * r2 + r2 ** 2) / 3
        assert sp.simplify(V - target) == 0
        return "$V = \\tfrac{\\pi h}{3}(r_1^2 + r_1 r_2 + r_2^2)$"
    return float(V.subs({r1: p["a"], r2: p["b"], h: p["h"]}))


def sf_lumping(p):
    x = sp.symbols("x", real=True)
    return float(sp.integrate(sp.exp(-sp.Rational(str(p["a"])) * x ** 2), (x, -sp.oo, sp.oo)))


def sf_pictorial(p):
    P = p["P"]
    x = np.linspace(0, P / 2, 400001)
    area = x * (P - 2 * x) if p["river"] else x * (P / 2 - x)
    return float(area.max())


def sf_big_part(p):
    if p["ask"] == "sqrt":
        return math.sqrt(p["n"] ** 2 + p["d"])
    return (1 + p["x"]) ** p["m"]


def sf_analogy(p):
    from functools import lru_cache

    @lru_cache(None)
    def pieces(n, d):
        if n == 0 or d == 0:
            return 1
        return pieces(n - 1, d) + pieces(n - 1, d - 1)
    return pieces(p["n"], p["d"])


# ---- Grinstead & Snell ---------------------------------------------------------
# Each reference takes a different route from site/generators-gs.js: enumerate
# the sample space, brute-force the permutations, integrate with sympy, or take
# matrix limits, instead of reusing the closed form.
import itertools


def _fr(s):
    return Fr(str(s))


def _Phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def gs_roulette(p):
    slots = range(38)
    if p["ask"] == "once":
        return 1 - Fr(37, 38) ** p["k"]
    win = set(range(p["win"]))  # which slots win doesn't matter, only how many
    if p["ask"] == "p":
        return Fr(len(win), 38)
    ev = sum(Fr(p["pays"] if s in win else -1, 38) for s in slots)
    return ev * (p.get("n", 1) if p["ask"] == "total" else 1)


_EVENTS = {"an even number": lambda k: k % 2 == 0, "an odd number": lambda k: k % 2 == 1,
           "a prime": lambda k: sp.isprime(k), "at least 4": lambda k: k >= 4, "at most 2": lambda k: k <= 2}


def gs_loaded_die(p):
    w = {"k": lambda k: k, "7-k": lambda k: 7 - k, "k2": lambda k: k * k, "k3": lambda k: k ** 3}[p["law"]]
    probs = {k: Fr(w(k)) for k in range(1, 7)}
    tot = sum(probs.values())
    return sum(v / tot for k, v in probs.items() if _EVENTS[p["event"]](k))


def gs_odds(p):
    if "rr" in p:
        return Fr(p["rr"], p["rr"] + p["s"])
    P = _fr(p["p"])
    return (1 - P) / P


def gs_first_success(p):
    q = 1 - _fr(p["p"])
    return q ** (p["k"] - 1) - q ** p["m"]  # no success before k, minus none by m


def gs_uniform_interval(p):
    x = sp.symbols("x")
    f = sp.Piecewise((sp.Rational(1, p["b"] - p["a"]), (x >= p["a"]) & (x <= p["b"])), (0, True))
    return float(sp.integrate(f, (x, p["c"], p["d"])))


def gs_exponential(p):
    t = sp.symbols("t", positive=True)
    lam = sp.Rational(str(p["lam"]))
    f = lam * sp.exp(-lam * t)
    if p["ask"] in ("median", "reliable"):
        T = sp.symbols("T", positive=True)
        return float(sp.solve(sp.integrate(f, (t, T, sp.oo)) - sp.Rational(str(p["rel"])), T)[0])
    if p["ask"] == "between":
        return float(sp.integrate(f, (t, p["t1"], p["t2"])))
    surv = float(sp.integrate(f, (t, p["t0"], sp.oo)))
    return surv if p["ask"] == "surv" else 1 - surv


def gs_arrangements(p):
    n, fam = p["n"], p["fam"]
    if fam == "k":
        return sum(1 for _ in itertools.permutations(range(n), p["k"]))
    perms = itertools.permutations(range(n))
    if fam in ("circle", "circle-adj"):  # seatings up to rotation: person 0 in seat 0
        rows = [q for q in perms if q[0] == 0]
        if fam == "circle":
            return len(rows)
        return sum(1 for q in rows if (q.index(1) - q.index(2)) % n in (1, n - 1))
    adj = lambda q: abs(q.index(0) - q.index(1)) == 1
    if fam == "row":
        return sum(1 for _ in perms)
    return sum(1 for q in perms if adj(q) == (fam == "adjacent"))


def gs_derangements(p):
    n, j = p["n"], (0 if p["ask"] == "count" else p.get("j", 0))
    if n <= 8:
        cnt = sum(1 for q in itertools.permutations(range(n)) if sum(q[i] == i for i in range(n)) == j)
    else:  # inclusion–exclusion
        m = n - j
        cnt = math.comb(n, j) * sum((-1) ** i * math.factorial(m) // math.factorial(i) for i in range(m + 1))
    return cnt if p["ask"] == "count" else Fr(cnt, math.factorial(n))


def gs_birthday(p):
    d = p["d"]
    if p["ask"] == "n":
        n = 1
        while 1 - Fr(math.perm(d, n), d ** n) < _fr(p["target"]):
            n += 1
        return n
    return float(1 - Fr(math.perm(d, p["n"]), d ** p["n"]))


def gs_binomial(p):
    fam, n = p["fam"], p["n"]
    prob = _fr(p.get("p", "0.5"))
    # enumerate every success pattern
    def P(test):
        return sum(prob ** sum(w) * (1 - prob) ** (n - sum(w)) for w in itertools.product((0, 1), repeat=n) if test(sum(w)))
    if fam == "engines":
        return float(P(lambda s: s >= p["m"]))
    if fam in ("guess", "atleast"):
        return float(P(lambda s: s >= p["k"]))
    return float(P(lambda s: s == p["k"]))


def gs_counting(p):
    fam = p["fam"]
    if fam == "committee":
        return sum(1 for _ in itertools.combinations(range(p["n"]), p["k"]))
    if fam == "season":
        return len(set(itertools.permutations("W" * p["w"] + "L" * p["l"] + "T" * p["t"])))
    if fam == "aces":
        # count hands by number of aces with a generating polynomial
        x = sp.symbols("x")
        poly = sp.expand((1 + x) ** 48 * 1)
        ways = sum(math.comb(4, a) * sp.Poly(poly, x).coeff_monomial(x ** (5 - a)) for a in [p["j"]])
        return Fr(int(ways), math.comb(52, 5))
    return sum(1 for w in itertools.product(range(p["colors"]), repeat=p["nails"]) if len(set(w)) <= 2)


def gs_rising_sequences(p):
    deck, passes, want = list(p["perm"]), 0, 1
    while want <= len(deck):  # each left-to-right pass collects one rising sequence
        passes += 1
        for c in deck:
            if c == want:
                want += 1
    return passes


def gs_conditional_draws(p):
    ev = p["event"]
    m = re.match(r"a (\d+) appears exactly (\d+) time", ev)
    if m:
        v, j = int(m[1]), int(m[2])
        test = lambda o: o.count(v) == j
    elif ev.startswith("at least one"):
        v = int(re.search(r"\d+", ev)[0])
        test = lambda o: v in o
    else:
        test = lambda o: len(set(o)) == 1
    given = [o for o in itertools.product(p["deck"], repeat=p["t"]) if sum(o) == p["s"]]
    return Fr(sum(map(test, given)), len(given))


def gs_urns_bayes(p):
    prior = _fr(p["prior"])
    balls = [("I", "w", prior / (p["a"] + p["b"]))] * p["a"] + [("I", "b", prior / (p["a"] + p["b"]))] * p["b"] \
        + [("II", "w", (1 - prior) / (p["c"] + p["d"]))] * p["c"] + [("II", "b", (1 - prior) / (p["c"] + p["d"]))] * p["d"]
    white = [x for x in balls if x[1] == "w"]
    return sum(x[2] for x in white if x[0] == "I") / sum(x[2] for x in white)


def gs_independent_events(p):
    a, b = _fr(p["pa"]), _fr(p["pb"])
    cells = {(A, B): (a if A else 1 - a) * (b if B else 1 - b) for A in (0, 1) for B in (0, 1)}
    P = lambda f: sum(v for k, v in cells.items() if f(*k))
    return {"and": P(lambda A, B: A and B), "or": P(lambda A, B: A or B), "neither": P(lambda A, B: not (A or B)),
            "onlyA": P(lambda A, B: A and not B), "exactly": P(lambda A, B: A != B),
            "givenOr": P(lambda A, B: A) / P(lambda A, B: A or B)}[p["ask"]]


def gs_continuous_conditional(p):
    x = sp.symbols("x")
    if p["fam"] == "uniform":
        a, lo = sp.Rational(p["a"]), sp.Rational(p["lo"])
        return float(sp.integrate(1, (x, a, 1)) / sp.integrate(1, (x, lo, 1)))
    if p["fam"] == "memoryless":
        lam = sp.Rational(str(p["lam"]))
        S = lambda t: sp.integrate(lam * sp.exp(-lam * x), (x, t, sp.oo))
        return float(S(p["s"] + p["t"]) / S(p["s"]))
    j, k = p["j"], p["k"]
    post = x ** j * (1 - x) ** k
    return float(sp.integrate(x * post, (x, 0, 1)) / sp.integrate(post, (x, 0, 1)))


def gs_paradoxes(p):
    if p["fam"] == "box":
        drawers = [("G", "G")] * p["gg"] + [("G", "S")] * p["gs"] + [("S", "S")] * p["ss"]
        draws = [(d[i], d[1 - i]) for d in drawers for i in (0, 1)]  # equally likely (drawer, coin)
        gold = [o for c, o in draws if c == "G"]
        return Fr(gold.count("G"), len(gold))
    n, m = p["n"], p["m"]
    win = Fr(0)
    for car in range(n):  # you pick door 0; the host opens m empty doors at random among the others
        can_open = [d for d in range(1, n) if d != car]
        opens = list(itertools.combinations(can_open, m))
        for o in opens:
            closed = [d for d in range(1, n) if d not in o]
            win += Fr(1, n) * Fr(1, len(opens)) * Fr(sum(d == car for d in closed), len(closed))
    return win


def gs_poisson(p):
    pmf = lambda lam, k: math.exp(-lam) * lam ** k / math.factorial(k)
    if p["fam"] == "bombs":
        return p["N"] * pmf(p["hits"] / p["N"], p["k"])
    if p["fam"] == "coins":
        return float(1 - (1 - Fr(1, p["per"])) ** p["boxes"])
    lam = p["n"] * p["p"]
    if p["fam"] == "atmost":
        return sum(pmf(lam, j) for j in range(p["k"] + 1))
    return pmf(lam, p["k"])


def gs_min_uniform(p):
    k, n, j = p["k"], p["n"], p["j"]
    # choose how many of the n draws equal j; the rest are strictly beyond it
    beyond = (k - j) if p["ask"] == "min" else (j - 1)
    return sum(math.comb(n, i) * Fr(1, k) ** i * Fr(beyond, k) ** (n - i) for i in range(1, n + 1))


def gs_geometric(p):
    P = _fr(p["p"])
    if p["ask"] == "mean":
        return p["rr"] * sum(k * (1 - P) ** (k - 1) * P for k in range(1, 3000))
    if p["ask"] == "tail":
        return 1 - sum((1 - P) ** (j - 1) * P for j in range(1, p["k"] + 1))
    rr, kk = p["rr"], p["kk"]
    tot = Fr(0)
    for w in itertools.product((0, 1), repeat=kk):
        if w[-1] == 1 and sum(w) == rr:
            tot += P ** rr * (1 - P) ** (kk - rr)
    return tot


def gs_normal(p):
    if p["ask"] in ("within", "outside"):
        inside = math.erf(p["k"] / math.sqrt(2))
        return inside if p["ask"] == "within" else 1 - inside
    return _Phi(p["z"]) if p["ask"] == "below" else 1 - _Phi(p["z"])


def gs_density_transform(p):
    x = sp.symbols("x")
    if p["fam"] == "const":
        return float(1 / sp.integrate(x ** p["m"] * (1 - x) ** p["n"], (x, 0, 1)))
    if p["fam"] == "power":
        y = sp.Rational(p["y"]) ** p["k"]
        return float(sp.integrate(sp.Piecewise((1, x ** p["k"] <= y), (0, True)), (x, 0, 1)))
    a, b = p["a"], p["b"]
    return float(sp.integrate(sp.Piecewise((1, (a * x) ** 2 - 4 * b > 0), (0, True)), (x, 0, 1)))


_RULES = {"the number rolled squared": lambda k: k * k, "twice the number if even, nothing otherwise": lambda k: 0 if k % 2 else 2 * k,
          "the number rolled, minus 3.5": lambda k: Fr(k) - Fr(7, 2), "1 dollar per dot above 3": lambda k: max(0, k - 3)}


def gs_expected_value(p):
    fam = p["fam"]
    if fam == "cards":
        cards = range(p["lo"], p["hi"] + 1)
        return sum(Fr(p["w"] if c % 2 else -p["l"], len(cards)) for c in cards)
    if fam == "die":
        return sum(Fr(_RULES[p["rule"]](k)) / 6 for k in range(1, 7))
    if fam == "urn":
        balls = "Y" * p["c"] + "G" * p["d"]
        hands = list(itertools.combinations(range(len(balls)), p["k"]))
        return Fr(sum(sum(balls[i] == "Y" for i in h) for h in hands), len(hands))
    k, q = p["k"], 1 - p["p"]
    # by the number infected in a pool
    tests = sum(math.comb(k, j) * p["p"] ** j * q ** (k - j) * (1 if j == 0 else 1 + k) for j in range(k + 1))
    return tests / k


def gs_variance(p):
    fam = p["fam"]
    if fam == "table":
        X = list(zip(p["xs"], map(_fr, p["ps"])))
    elif fam == "uniform":
        X = [(k, Fr(1, p["n"])) for k in range(1, p["n"] + 1)]
    elif fam == "dice":
        dist = {0: Fr(1)}
        for _ in range(p["n"]):
            nxt = {}
            for s, pr in dist.items():
                for f in range(1, 7):
                    nxt[s + f] = nxt.get(s + f, 0) + pr / 6
            dist = nxt
        X = list(dist.items())
    elif fam == "binom":
        P, n = _fr(p["p"]), p["n"]
        X = [(k, math.comb(n, k) * P ** k * (1 - P) ** (n - k)) for k in range(n + 1)]
    else:  # affine: build any X with that variance (±σ each with prob 1/2) and transform
        s2 = _fr(p["v0"])
        s = sp.sqrt(sp.Rational(s2.numerator, s2.denominator))
        vals = [p["a"] * v + p["b"] for v in (s, -s)]
        m = sum(vals) / 2
        return float(sum((v - m) ** 2 for v in vals) / 2)
    m = sum(x * q for x, q in X)
    return sum((x - m) ** 2 * q for x, q in X)


def gs_continuous_moments(p):
    x = sp.symbols("x")
    fam = p["fam"]
    if fam == "uniform":
        f, lo, hi = sp.Rational(1, p["b"] - p["a"]), p["a"], p["b"]
    elif fam == "power":
        f, lo, hi = (p["k"] + 1) * x ** p["k"], 0, 1
    elif fam == "exp":
        f, lo, hi = p["lam"] * sp.exp(-p["lam"] * x), 0, sp.oo
    else:
        f = [sp.Rational(1, 2), sp.Abs(x), 1 - sp.Abs(x), sp.Rational(3, 2) * x ** 2][p["which"]]
        lo, hi = -1, 1
    mu = sp.integrate(x * f, (x, lo, hi))
    if p["ask"] == "mean":
        return float(mu)
    return float(sp.integrate((x - mu) ** 2 * f, (x, lo, hi)))


def gs_dice_sums(p):
    rolls = list(itertools.product(range(1, 7), repeat=p["n"]))
    t = p["t"]
    test = {"eq": lambda s: s == t, "gt": lambda s: s > t, "le": lambda s: s <= t, "odd": lambda s: s % 2 == 1}[p["ask"]]
    return Fr(sum(test(sum(o)) for o in rolls), len(rolls))


def gs_continuous_sums(p):
    x, y = sp.symbols("x y", positive=True)
    if p["fam"] == "tri":
        z = sp.Rational(p["z"])
        return float(sp.integrate(sp.Min(1, sp.Max(0, z - x)), (x, 0, 1)))
    if p["fam"] == "min":
        n, mu = p["n"], p["mean"]
        t = sp.symbols("t", positive=True)
        return float(sp.integrate(sp.exp(-t / mu) ** n, (t, 0, sp.oo)))  # E(min) = ∫ P(min > t)
    lam = sp.Rational(str(p["lam"]))
    f = lam ** 2 * sp.exp(-lam * (x + y))
    return float(sp.integrate(sp.integrate(f, (y, 0, p["t"] - x)), (x, 0, p["t"])))


def gs_chebyshev(p):
    if p["fam"] == "bound":
        return min(Fr(1), _fr(p["v"]) / p["eps"] ** 2)
    if p["fam"] == "coin":
        sd = Fr(int(math.isqrt(p["n"])), 2)
        return (sd ** 2) / (p["k"] * sd) ** 2
    eps, delta = _fr(p["eps"]), _fr(p["delta"])
    lo, hi = 1, 10 ** 9
    while lo < hi:  # smallest n with 1/(4nε²) ≤ δ
        mid = (lo + hi) // 2
        if Fr(1, 4 * mid) / eps ** 2 <= delta:
            hi = mid
        else:
            lo = mid + 1
    return lo


def gs_clt_bernoulli(p):
    n, pr, d = p["n"], p["p"], p["d"]
    mu, sd = n * pr, math.sqrt(n * pr * (1 - pr))
    if p["ask"] == "le":
        return _Phi((mu - d + 0.5 - mu) / sd)
    lo, hi = mu - d + 1, mu + d - 1  # integers strictly inside
    return _Phi((hi + 0.5 - mu) / sd) - _Phi((lo - 0.5 - mu) / sd)


def gs_clt_dice(p):
    faces = np.arange(1, 7)
    mu, var = p["n"] * faces.mean(), p["n"] * faces.var()
    return 1 - _Phi((p["t"] + 0.5 - mu) / math.sqrt(var))


def gs_clt_average(p):
    if p["ask"] == "n":
        n = 1
        while p["z"] * p["sigma"] / math.sqrt(n) > p["eps"] + 1e-12:
            n += 1
        return n
    z = p["eps"] / (p["sigma"] / math.sqrt(p["n"]))
    return math.erf(z / math.sqrt(2))


def gs_generating_functions(p):
    z = sp.symbols("z")
    ps = [sp.Rational(s) for s in p["ps"]]
    h = ps[0] + ps[1] * z + ps[2] * z ** 2
    if p["ask"] == "conv":
        return float(sp.Poly(sp.expand(h * h), z).coeff_monomial(z ** p["k"]))
    X = [(k, ps[k]) for k in range(3)]
    m = sum(k * q for k, q in X)
    return float(m if p["ask"] == "mean" else sum((k - m) ** 2 * q for k, q in X))


def gs_branching(p):
    z = sp.symbols("z")
    ps = [sp.Rational(s) for s in p["ps"]]
    if p["ask"] == "mean":
        return float(sp.diff(ps[0] + ps[1] * z + ps[2] * z ** 2, z).subs(z, 1))
    roots = sp.solve(sp.Eq(ps[0] + ps[1] * z + ps[2] * z ** 2, z), z)
    return float(min(r for r in roots if 0 <= r <= 1))


def gs_mgf_moments(p):
    t, x = sp.symbols("t x")
    if p["fam"] == "uniform":
        g = sp.integrate(sp.exp(t * x) / p["b"], (x, 0, p["b"]), conds="none")
    elif p["fam"] == "power":
        g = sp.integrate(sp.exp(t * x) * (p["k"] + 1) * x ** p["k"], (x, 0, 1), conds="none")
    else:
        g = p["lam"] / (p["lam"] - t)
    # n! times the t^n coefficient of the power series of g at 0
    return float(sp.series(g, t, 0, p["n"] + 1).removeO().coeff(t, p["n"]) * sp.factorial(p["n"]))


def _mat(P):
    return sp.Matrix([[sp.Rational(e) for e in row] for row in P])


def gs_markov_steps(p):
    return float((_mat(p["P"]) ** p["n"])[p["i"], p["j"]])


def gs_absorbing(p):
    N, pr, x = p["N"], sp.Rational(p["p"]), p["x"]
    # canonical form: transient 1..N-1, absorbing 0 and N
    Q = sp.zeros(N - 1)
    R = sp.zeros(N - 1, 2)
    for i in range(1, N):
        for j, w in ((i + 1, pr), (i - 1, 1 - pr)):
            if j in (0, N):
                R[i - 1, 0 if j == 0 else 1] += w
            else:
                Q[i - 1, j - 1] += w
    Nf = (sp.eye(N - 1) - Q).inv()
    if p["ask"] == "prob":
        return float((Nf * R)[x - 1, 1])
    return float(sum(Nf.row(x - 1)))


def gs_fixed_vector(p):
    P = np.array([[float(Fr(e)) for e in row] for row in p["P"]])
    W = np.linalg.matrix_power(P, 400)
    if p.get("ask") == "limit":
        return float((W @ np.array(p["y"], float))[0])
    return float(W[0, p["j"]])


def gs_first_passage(p):
    P = _mat(p["P"])
    k = P.shape[0]
    W1 = (P ** 1)
    # fixed vector from the null space of (P^T − I)
    v = (P.T - sp.eye(k)).nullspace()[0]
    w = v / sum(v)
    W = sp.Matrix([list(w)] * k)
    Z = (sp.eye(k) - P + W).inv()
    i, j = p["i"], p["j"]
    if p["ask"] == "return":
        return float(1 / w[j])
    return float((Z[j, j] - Z[i, j]) / w[j])


def gs_random_walk(p):
    m = p["m"]
    if p["ask"] == "plane":
        return float(sum(Fr(math.factorial(2 * m), (math.factorial(a) ** 2) * (math.factorial(m - a) ** 2)) for a in range(m + 1))
                     / 4 ** (2 * m))
    hits = 0
    for w in itertools.product((1, -1), repeat=2 * m):
        s = np.cumsum(w)
        if p["ask"] == "at":
            hits += s[-1] == 0
        else:
            hits += s[-1] == 0 and not (s[:-1] == 0).any()
    return Fr(int(hits), 2 ** (2 * m))


def gs_gamblers_ruin(p):
    N, k = p["N"], p["k"]
    pr = Fr(1, 2) if p["fam"] == "fair" else (Fr(18, 38) if p["fam"] == "roulette" else _fr(p["p"]))
    ask = p.get("ask", "win")
    A = np.zeros((N + 1, N + 1))
    b = np.zeros(N + 1)
    A[0, 0] = A[N, N] = 1
    b[N] = 1 if ask == "win" else 0
    for i in range(1, N):
        A[i, i], A[i, i + 1], A[i, i - 1] = 1, -float(pr), -float(1 - pr)
        b[i] = 0 if ask == "win" else 1
    return float(np.linalg.solve(A, b)[k])


def gs_arcsine(p):
    m, k = p["m"], p["k"]
    hits = 0
    for w in itertools.product((1, -1), repeat=2 * m):
        s = [0, *np.cumsum(w)]
        if p["ask"] == "last":
            hits += max(t for t in range(2 * m + 1) if s[t] == 0) == 2 * k
        else:
            pos = sum(1 for t in range(1, 2 * m + 1) if s[t] > 0 or (s[t - 1] > 0 and s[t] == 0))
            hits += pos == 2 * k
    return Fr(hits, 2 ** (2 * m))


GS_REFS = {name.replace("_", "-"): fn for name, fn in list(globals().items()) if name.startswith("gs_") and callable(fn)}


# ---- real analysis (Tao, Pugh): site/generators-analysis.js ---------------------------


def an_image_preimage(p):
    k = p["k"]
    f = {"sq": lambda x: x * x, "abs": lambda x: abs(x) + 1, "mod": lambda x: x % k}[p["fam"]]
    A = range(-p["n"], p["n"] + 1)
    if p["ask"] == "image":
        return len({f(x) for x in A})
    return sum(1 for x in A if f(x) in p["B"])


def an_count_functions(p):
    m, n, fam = p["m"], p["n"], p["fam"]
    if fam == "all":
        return sum(1 for _ in itertools.product(range(n), repeat=m))
    if fam == "power":
        return sum(1 for k in range(n + 1) for _ in itertools.combinations(range(n), k))
    if fam == "inj":
        return sum(1 for f in itertools.product(range(n), repeat=m) if len(set(f)) == m)
    if fam == "bij":
        return sum(1 for f in itertools.product(range(n), repeat=n) if len(set(f)) == n)
    if fam == "prod":
        return 2 ** len(list(itertools.product(range(m), range(n))))
    return sum(1 for f in itertools.product(range(2), repeat=n) if len(set(f)) == 2)


def an_cauchy_steady(p):
    c, k = Fr(p["c"]), Fr(1, p["k"])
    # sup_{j,l ≥ N} |c/j − c/l| = c/N; smallest N with c/N ≤ 1/k
    N = 1
    while c / N > k:
        N += 1
    return N


def an_standard_limits(p):
    n = sp.symbols("n", positive=True)
    fam = p["fam"]
    if fam == "rational":
        e = (p["a"] * n ** p["deg"] + p["b"]) / (p["c"] * n ** (p["deg"] + (1 if p["lower"] else 0)) + p["d"])
    elif fam == "sqrt":
        e = sp.sqrt(n ** 2 + p["a"] * n) - n
    elif fam == "exp":
        e = (1 + sp.Integer(p["a"]) / n) ** (p["b"] * n)
    else:
        e = (p["c"] * n ** p["k"]) ** (1 / n)
    return float(sp.limit(e, n, sp.oo))


def an_limit_points(p):
    k = p["k"]
    # evaluate far out along each residue class and cluster the values
    far = [10 ** 6 * k + i for i in range(k)]
    if p["fam"] == "mod":
        vals = [(m % k) + 1 / m for m in far]
    else:
        trig = math.cos if p["fam"] == "cos" else math.sin
        vals = [(1 + 1 / m) * trig(2 * math.pi * m / k) for m in far]
    return len({round(v, 4) for v in vals})


def an_series_sum(p):
    n = sp.symbols("n", integer=True, positive=True)
    if p["fam"] == "geo":
        r = sp.Rational(p["rn"], p["rd"])
        return float(sp.summation(p["a"] * r ** n, (n, p["k"], sp.oo)))
    top = sp.oo if p["N"] is None else p["N"]
    if top == sp.oo:
        return float(sp.summation(1 / (n * (n + p["k"])), (n, 1, sp.oo)))
    return float(sum(Fr(1, m * (m + p["k"])) for m in range(1, top + 1)))


def an_extreme_values(p):
    k, a, b = p["k"], p["a"], p["b"]
    xs = np.linspace(a, b, 2_000_001)
    ys = xs ** 3 - 3 * k * xs
    return float(ys.max() if p["ask"] == "max" else ys.min())


def an_ivt(p):
    if "fa" in p:
        return str(p["y"])
    n, w = 0, Fr(p["w"])
    while w > Fr(str(p["eps"])):
        w /= 2
        n += 1
    return n


def an_difference_quotient(p):
    x, h = sp.symbols("x h")
    f = x ** p["n"]
    q = (f.subs(x, p["x0"] + h) - f.subs(x, p["x0"])) / h
    return float(q.subs(h, sp.nsimplify(p["h"])) if p["ask"] == "quot" else sp.limit(q, h, 0))


def an_lhopital(p):
    x = sp.symbols("x")
    a, b = p["a"], p["b"]
    e, at = {"sin": (sp.sin(a * x) / sp.sin(b * x), 0), "exp": ((sp.exp(a * x) - 1) / (b * x), 0),
             "log": (sp.log(1 + a * x) / (b * x), 0), "cos": ((1 - sp.cos(a * x)) / x ** 2, 0),
             "pow": ((x ** (a + 1) - b ** (a + 1)) / (x - b), b)}[p["fam"]]
    return float(sp.limit(e, x, at))


def an_inverse_derivative(p):
    x = sp.symbols("x", real=True)
    f = x ** p["deg"] + p["a"] * x + p["b"]
    y0 = f.subs(x, p["x0"])
    root = [r for r in sp.solve(sp.Eq(f, y0), x) if r.is_real][0]
    return float(1 / sp.diff(f, x).subs(x, root))


def an_mean_value(p):
    x = sp.symbols("x", real=True)
    if p["fam"] == "quad":
        f, a, b = p["p"] * x ** 2 + p["q"] * x, p["a"], p["b"]
    else:
        f, a, b = x ** 3, 0, p["b"]
    slope = (f.subs(x, b) - f.subs(x, a)) / (b - a)
    cs = [c for c in sp.solve(sp.Eq(sp.diff(f, x), slope), x) if a < c < b]
    return float(cs[0])


def an_piecewise_constant(p):
    x = sp.symbols("x")
    pts, vals = p["pts"], p["vals"]
    return float(sum(sp.integrate(v, (x, pts[i], pts[i + 1])) for i, v in enumerate(vals)))


def an_ftc(p):
    t, x = sp.symbols("t x")
    f = sum(c * t ** i for i, c in enumerate(p["cs"]))
    if p["fam"] == "eval":
        return float(sp.integrate(f, (t, p["a"], p["b"])))
    upper = x ** p.get("k", 1) if p["fam"] == "chain" else x
    G = sp.integrate(f, (t, 0, upper))
    return float(sp.diff(G, x).subs(x, p["x0"]))


def an_stieltjes(p):
    if p["fam"] == "smooth":
        # Riemann–Stieltjes sums on a fine partition: Σ f(ξᵢ)(α(xᵢ) − α(xᵢ₋₁))
        xs = np.linspace(0, p["b"], 200001)
        mid = (xs[1:] + xs[:-1]) / 2
        return float(np.sum(mid ** p["m"] * np.diff(xs ** p["k"])))
    f = lambda x: p["cs"][0] + p["cs"][1] * x
    xs = np.linspace(0, 4, 400001)
    alpha = sum(j["h"] * (xs >= j["at"]) for j in p["jumps"])
    return float(np.sum(f(xs[1:]) * np.diff(alpha)))  # right-endpoint tags


def an_uniform_convergence(p):
    if p["fam"] == "pow":
        n = 1
        while p["a"] ** n > p["eps"]:
            n += 1
        return n
    if p["fam"] == "bump":
        xs = np.linspace(0, 5, 2_000_001)
        return float((xs / (1 + p["n"] * xs ** 2)).max())
    return None


def an_jacobian(p):
    x, y, r, th = sp.symbols("x y r theta")
    fam = p["fam"]
    if fam == "grad":
        f = p["a"] * x ** 2 + p["b"] * x * y + p["c"] * y ** 2
        u = sp.Matrix(p["u"]) / sp.sqrt(sum(t * t for t in p["u"]))
        g = sp.Matrix([sp.diff(f, x), sp.diff(f, y)]).subs({x: p["x"], y: p["y"]})
        return float(g.dot(u))
    if fam == "polar":
        return float(sp.Matrix([r * sp.cos(th), r * sp.sin(th)]).jacobian([r, th]).det().simplify().subs(r, p["r"]))
    F = sp.Matrix([x ** 2 - y ** 2, 2 * x * y]) if fam == "square" else sp.Matrix([x ** p["a"] * y, x + y ** p["b"]])
    return float(F.jacobian([x, y]).det().subs({x: p["x"], y: p["y"]}))


def an_measure(p):
    if p["fam"] == "cantor":
        ivs = [(Fr(0), Fr(1))]
        for _ in range(p["n"]):
            ivs = [iv for a, b in ivs for iv in ((a, a + (b - a) / 3), (b - (b - a) / 3, b))]
        return sum(b - a for a, b in ivs)
    if p["fam"] == "fat":
        ivs = [(Fr(0), Fr(1))]
        for k in range(1, p["n"] + 1):
            hole = Fr(1, p["q"] ** k)
            ivs = [iv for a, b in ivs for iv in ((a, (a + b) / 2 - hole / 2), ((a + b) / 2 + hole / 2, b))]
        return sum(b - a for a, b in ivs)
    return None


AN_REFS = {name.replace("_", "-"): fn for name, fn in list(globals().items())
           if name.startswith("an_") and callable(fn) and name not in ("an_ivt",)}
AN_REFS["an-ivt"] = an_ivt


# ---- abstract and linear algebra (Herstein, Axler): site/generators-algebra.js --------


def _divs(n):
    return [d for d in range(1, n + 1) if n % d == 0]


def al_lagrange(p):
    if p["ask"] == "index":
        # count cosets directly in Z_n, which has a subgroup of every order dividing n
        n, h = p["n"], p["h"]
        H = frozenset(range(0, n, n // h))
        return len({frozenset((a + x) % n for x in H) for a in range(n)})
    if p["ask"] == "orders":
        return len(sp.divisors(p["n"]))
    return str(p["good"])


def al_direct_product(p):
    m, n = p["m"], p["n"]
    if p["ask"] == "cyclic":
        big = max(_order_pair(a, b, m, n) for a in range(m) for b in range(n))
        return "Yes" if big == m * n else "No"
    return _order_pair(p["a"], p["b"], m, n)


def _order_pair(a, b, m, n):
    k, x, y = 1, a % m, b % n
    while (x, y) != (0, 0):
        x, y, k = (x + a) % m, (y + b) % n, k + 1
    return k


def al_homomorphisms(p):
    m, n = p["m"], p["n"]
    if p["ask"] == "count":  # images of 1 that respect m·1 = 0
        return sum(1 for a in range(n) if (m * a) % n == 0)
    return sum(1 for x in range(m) if (p["a"] * x) % n == 0)


def al_conjugacy(p):
    n = p["n"]
    from sympy.combinatorics import Permutation
    if p["ask"] == "classes":  # distinct cycle types among all of S_n
        return len({tuple(sorted(len(c) for c in Permutation(list(q)).full_cyclic_form))
                    for q in itertools.permutations(range(n))})
    want = sorted(p["type"], reverse=True)
    cnt = 0
    for q in itertools.permutations(range(n)):
        cyc = sorted((len(c) for c in Permutation(list(q)).full_cyclic_form), reverse=True)
        cnt += cyc == want
    return cnt


def al_sylow(p):
    n, q = p["n"], p["p"]
    m = n
    while m % q == 0:
        m //= q
    return sum(1 for d in sp.divisors(m) if d % q == 1)


def al_ring_elements(p):
    n = p["n"]
    R = range(n)
    if p["ask"] == "zd":
        return sum(1 for a in R if a and any((a * b) % n == 0 for b in range(1, n)))
    if p["ask"] == "nil":
        return sum(1 for a in R if pow(a, n, n) == 0)
    return sum(1 for a in R if (a * a) % n == a)


def al_ideals_zn(p):
    n, a, b = p["n"], p["a"], p["b"]
    ask = p["ask"]
    if ask in ("count", "max"):
        # ideals of Z_n are its additive subgroups closed under multiplication: generated sets
        ideals = {frozenset((g * k) % n for k in range(n)) for g in range(n)}
        if ask == "count":
            return len(ideals)
        full = frozenset(range(n))
        proper = [I for I in ideals if I != full]
        return sum(1 for I in proper if not any(I < J for J in proper))
    if ask == "sum":
        return min(x for x in (a * s + b * t for s in range(-50, 51) for t in range(-50, 51)) if x > 0)
    if ask == "cap":
        return next(k for k in range(1, a * b + 1) if k % a == 0 and k % b == 0)
    ideal = {(a * k) % n for k in range(n)}
    return n // len(ideal)


def al_polynomial_roots(p):
    x = sp.symbols("x")
    if p["fam"] == "rem":
        P = sp.Poly(x ** p["k"] + p["c"], x, modulus=p["p"])
        return int(P.rem(sp.Poly(x - p["a"], x, modulus=p["p"])).as_expr()) % p["p"]
    if p["fam"] == "modp":
        return len(sp.Poly(x ** 2 + p["b"] * x + p["c"], x, modulus=p["p"]).ground_roots())
    f = sum(c * x ** i for i, c in enumerate(p["cs"]))
    return len(set(r for r in sp.roots(sp.Poly(f, x), filter="Q")))


def al_field_degree(p):
    x = sp.symbols("x")
    if p["fam"] == "root":
        return sp.degree(sp.minimal_polynomial(sp.Integer(p["p"]) ** sp.Rational(1, p["n"]), x))
    if p["fam"] == "two":
        a = sp.sqrt(p["a"]) + sp.sqrt(p["b"])  # a primitive element
        return sp.degree(sp.minimal_polynomial(a, x))
    a = sp.Integer(p["pa"]) ** sp.Rational(1, p["m"]) + sp.Integer(p["pb"]) ** sp.Rational(1, p["n"])
    return sp.degree(sp.minimal_polynomial(a, x))


def al_finite_fields(p):
    q, n = p["p"], p["n"]
    if p["ask"] == "gens":
        return sp.totient(q ** n - 1)
    if p["ask"] == "subfields":
        return len(sp.divisors(n))
    # brute force: count monic irreducibles of degree n over GF(q) (small cases)
    x = sp.symbols("x")
    if q ** n > 3200:
        return sum(sp.mobius(d) * q ** (n // d) for d in sp.divisors(n)) // n
    cnt = 0
    for cs in itertools.product(range(q), repeat=n):
        f = sp.Poly([1, *cs], x, modulus=q)
        cnt += f.is_irreducible
    return cnt


def al_cyclotomic(p):
    x = sp.symbols("x")
    n = p["n"]
    if p["ask"] == "gon":
        return "Yes" if sp.totient(n) & (sp.totient(n) - 1) == 0 else "No"
    P = sp.cyclotomic_poly(n, x)
    return sp.degree(P, x) if p["ask"] == "deg" else P.subs(x, 1)


def la_span_dimension(p):
    return int(np.linalg.matrix_rank(np.array(p["A"], dtype=float)))


def la_subspace_dim(p):
    fam = p["fam"]
    if fam == "sum":
        return p["u"] + p["w"] - p["i"]
    if fam == "poly":
        m, k = p["m"], p["k"]
        pts = [i * 2 - 1 for i in range(k)]
        V = sp.Matrix([[a ** j for j in range(m + 1)] for a in pts])  # evaluation conditions
        return m + 1 - V.rank()
    n, name = p["n"], p["name"]
    # build the constraint matrix on n² entries and take its null space
    idx = lambda i, j: i * n + j
    rows = []
    for i in range(n):
        for j in range(n):
            if name == "symmetric" and i < j:
                r = [0] * n * n; r[idx(i, j)] = 1; r[idx(j, i)] = -1; rows.append(r)
            if name == "skew-symmetric" and i <= j:
                r = [0] * n * n; r[idx(i, j)] = 1; r[idx(j, i)] += 1; rows.append(r)
            if name in ("upper-triangular",) and i > j:
                r = [0] * n * n; r[idx(i, j)] = 1; rows.append(r)
            if name == "diagonal" and i != j:
                r = [0] * n * n; r[idx(i, j)] = 1; rows.append(r)
    if name == "trace-zero":
        rows = [[1 if k % (n + 1) == 0 else 0 for k in range(n * n)]]
    return n * n - (sp.Matrix(rows).rank() if rows else 0)


def la_differentiation_map(p):
    x = sp.symbols("x")
    m, k = p["m"], p["k"]
    # matrix of D^k on the basis 1, x, …, x^m
    cols = [[sp.Poly(sp.diff(x ** j, x, k), x).coeff_monomial(x ** i) if sp.diff(x ** j, x, k) != 0 else 0
             for i in range(m + 1)] for j in range(m + 1)]
    Mx = sp.Matrix(cols).T
    rk = Mx.rank()
    return m + 1 - rk if p["ask"] == "null" else rk


def la_inner_product(p):
    x = sp.symbols("x")
    P = lambda c: c[0] + c[1] * x
    a, b = P(p["a"]), P(p["b"])
    if p["ask"] == "ip":
        return float(sp.integrate(a * b, (x, 0, 1)))
    if p["ask"] == "norm2":
        return float(sp.integrate(a * a, (x, 0, 1)))
    c = sp.symbols("c")  # minimise ‖b − c‖²
    return float(sp.solve(sp.diff(sp.integrate((b - c) ** 2, (x, 0, 1)), c), c)[0])


def la_gram_schmidt(p):
    u, v = np.array(p["u"], float), np.array(p["v"], float)
    t, *_ = np.linalg.lstsq(u.reshape(3, 1), v, rcond=None)  # least squares along u
    if p["ask"] == "coef":
        return float(t[0])
    return float(np.sum((v - t[0] * u) ** 2))


def la_spectral(p):
    if p["fam"] == "sv":
        return float(np.linalg.svd(np.array(p["A"], float), compute_uv=False).max())
    if p["fam"] == "posdef":
        ev = np.linalg.eigvalsh(np.array([[p["a"], p["b"]], [p["b"], p["d"]]], float))
        if ev.min() > 1e-12:
            return "Positive definite"
        return "Positive semidefinite, not definite" if ev.min() > -1e-12 else "Not positive"
    A = np.array(p["A"], float)
    if np.allclose(A, A.T):
        return "Self-adjoint (hence normal)"
    return "Normal but not self-adjoint" if np.allclose(A @ A.T, A.T @ A) else "Not normal"


def la_jordan(p):
    blocks = p["blocks"]
    n = sum(k for _, k in blocks)
    J = sp.zeros(n)
    o = 0
    for l, k in blocks:
        for i in range(k):
            J[o + i, o + i] = l
            if i < k - 1:
                J[o + i, o + i + 1] = 1
        o += k
    lam = blocks[0][0]
    I = sp.eye(n)
    if p["ask"] == "geo":
        return n - (J - lam * I).rank()
    if p["ask"] == "alg":
        return n - ((J - lam * I) ** n).rank()
    # minimal polynomial: smallest-degree product ∏ (J − λ)^{e_λ} that vanishes
    lams = sorted({l for l, _ in blocks})
    best = None
    for es in itertools.product(range(1, n + 1), repeat=len(lams)):
        P = I
        for l, e in zip(lams, es):
            P = P * (J - l * I) ** e
        if P.is_zero_matrix and (best is None or sum(es) < best):
            best = sum(es)
    return best


def la_determinant_volume(p):
    if p["fam"] in ("det3", "volume"):
        d = sp.Matrix(p["A"]).det()
        return abs(d) if p["fam"] == "volume" else d
    n, dA, dB, c = p["n"], p["dA"], p["dB"], p["c"]
    # realise A and B as diagonal matrices with those determinants
    A = sp.diag(dA, *[1] * (n - 1))
    B = sp.diag(dB, *[1] * (n - 1))
    return float({"cA": (c * A).det(), "AB": (A * B).det(), "inv": A.inv().det(), "AtB": (A.T * B.inv()).det()}[p["which"]])


def la_change_basis(p):
    B = np.array([p["b1"], p["b2"]], float).T
    a, c = np.linalg.solve(B, np.array(p["v"], float))
    return float(a if p["ask"] == "first" else c)


AL_REFS = {name.replace("_", "-"): fn for name, fn in list(globals().items())
           if (name.startswith("al_") or name.startswith("la_")) and callable(fn)
           and name.split("_", 1)[1] not in ("eigen2", "rank_nullity", "trace_det", "projection")}


# ---- ML books (d2l 8–21, Bishop, Murphy): site/generators-mlbooks.js ----------------------


def dl_conv_cost(p):
    conv = nn.Conv2d(p["cin"], p["cout"], p["k"], stride=p["s"], padding=p["p"])
    y = conv(torch.zeros(1, p["cin"], p["n"], p["n"]))
    if p["ask"] == "out":
        return y.shape[2]
    if p["ask"] == "params":
        return count(conv)
    return y[0].numel() * p["cin"] * p["k"] ** 2 / 1e6


def dl_receptive_field(p):
    # push a single impulse backwards: which input pixels influence output (0, 0)?
    layers = [nn.Conv2d(1, 1, k, stride=s, bias=False) for k, s in p["ls"]]
    for l in layers:
        nn.init.ones_(l.weight)
    size = 200
    x = torch.zeros(1, 1, size, size, requires_grad=True)
    y = x
    for l in layers:
        y = l(y)
    y[0, 0, 0, 0].backward()
    nz = (x.grad[0, 0, 0] != 0).nonzero()
    return int(nz.max() - nz.min() + 1)


def dl_batchnorm(p):
    if p["ask"] == "params":
        return count(nn.BatchNorm2d(p["c"]))
    bn = nn.BatchNorm1d(1, eps=0.0, affine=True)
    with torch.no_grad():
        bn.weight.fill_(p["g"]); bn.bias.fill_(p["b"])
    bn.train()
    return float(bn(torch.tensor(p["xs"], dtype=torch.float64).reshape(-1, 1))[0, 0])


def dl_densenet(p):
    c = p["c0"]
    for b in range(p["blocks"]):
        for _ in range(p["L"]):
            c = c + p["g"]  # concatenate g new channels
        if b < p["blocks"] - 1:
            c //= 2
    return c


def dl_rnn_params(p):
    cls = {"RNN": nn.RNN, "GRU": nn.GRU, "LSTM": nn.LSTM}[p["cell"]]
    m = cls(p["d"], p["h"], bidirectional=p["bi"])
    # torch keeps two bias vectors per gate (b_ih and b_hh); the problem counts one
    extra = sum(v.numel() for k, v in m.named_parameters() if "bias_hh" in k)
    return count(m) - extra


def dl_birnn_shape(p):
    f = nn.RNN(3, p["hf"]); b = nn.RNN(3, p["hb"])
    x = torch.zeros(p["T"], p["n"], 3)
    H = torch.cat([f(x)[0][0], b(x.flip(0))[0][0]], dim=-1)
    return f"({H.shape[0]}, {H.shape[1]})"


def dl_beam_search(p):
    Y, k, T = p["Y"], p["k"], p["T"]
    if p["ask"] == "exh":
        return T * math.log10(Y)
    per_step = [min(k, 1) * Y] + [k * Y] * (T - 1)  # beams after step 1 hold k sequences
    return per_step[1] if p["ask"] == "step" else sum(per_step)


def dl_bleu(p):
    from collections import Counter
    lab, pred = p["lab"], p["pred"]

    def prec(n):
        P = Counter(tuple(pred[i:i + n]) for i in range(len(pred) - n + 1))
        L = Counter(tuple(lab[i:i + n]) for i in range(len(lab) - n + 1))
        return sum(min(c, L[g]) for g, c in P.items()), max(1, sum(P.values()))
    h1, t1 = prec(1)
    h2, t2 = prec(2)
    if p["ask"] == "p1":
        return h1 / t1
    if p["ask"] == "p2":
        return h2 / t2
    return math.exp(min(0, 1 - len(lab) / len(pred))) * (h1 / t1) ** 0.5 * (h2 / t2) ** 0.25


def dl_roofline(p):
    n, b = p["n"], p["b"]
    A = np.zeros((2, 2))
    flops = n * n * (2 * n)          # n² outputs, each n multiplies and n adds
    moved = (n * n) * 3 * b
    if p["ask"] == "ai":
        return flops / moved
    tc, tm = flops / p["peak"], moved / p["bw"]
    if p["ask"] == "bound":
        return "Compute-bound" if tc >= tm else "Memory-bound"
    return max(tc, tm) * 1e6


def dl_allreduce(p):
    if p["ask"] == "batch":
        return p["B"] / p["k"]
    k, P, b = p["k"], p["P"], p["b"]
    # simulate a ring: reduce-scatter then all-gather, each k − 1 rounds of one chunk
    chunk = P * b / k
    sent = 2 * (k - 1) * chunk
    return sent / 1e9 if p["ask"] == "bytes" else sent / (p["bw"] * 1e9) * 1000


def dl_iou(p):
    import torchvision.ops as ops
    A = torch.tensor([p["A"]], dtype=torch.float64); B = torch.tensor([p["B"]], dtype=torch.float64)
    return float(ops.box_iou(A, B)[0, 0])


def dl_anchors(p):
    n, m = p["n"], p["m"]
    pairs = {(s, 0) for s in range(n)} | {(0, r) for r in range(m)}
    return len(pairs) if p["ask"] == "per" else len(pairs) * p["h"] * p["w"]


def dl_transposed_conv(p):
    t = nn.ConvTranspose2d(1, 1, p["k"], stride=p["s"], padding=p["p"])
    return t(torch.zeros(1, 1, p["n"], p["n"])).shape[2]


def dl_bpe(p):
    return p["m"] - p["n"] if p["ask"] == "merges" else p["n"] + p["j"]


def dl_word2vec_cost(p):
    if p["ask"] == "drop":
        return max(0.0, 1 - math.sqrt(1e-4 / p["f"]))
    return p["V"] / (p["K"] + 1)


def dl_transformer_params(p):
    d = p["d"]
    emb = lambda: count(nn.Embedding(p["V"], d)) + count(nn.Embedding(p["L"], d)) + count(nn.Embedding(2, d))
    if p["ask"] == "attn":
        return count(nn.MultiheadAttention(d, 8))
    layer = count(nn.TransformerEncoderLayer(d, 8, dim_feedforward=4 * d))
    return {"embed": lambda: emb(), "layer": lambda: layer, "total": lambda: emb() + 12 * layer}[p["ask"]]()


def dl_textcnn(p):
    x = torch.zeros(1, 7, p["n"])
    outs = [nn.Conv1d(7, c, k)(x) for k, c in zip(p["ks"], p["cs"])]
    if p["ask"] == "len":
        return outs[0].shape[2]
    return torch.cat([o.max(dim=2).values for o in outs], dim=1).shape[1]


def dl_value_iteration(p):
    g = p["gamma"]
    if p["fam"] == "return":
        G = 0.0
        for rwd in reversed(p["rs"]):
            G = rwd + g * G
        return G
    N = p["N"]
    V = [0.0] * (N + 1)
    for _ in range(p["k"]):
        nv = V[:]
        for s in range(N):
            right = (p["R"] if s + 1 == N else 0) + (0 if s + 1 == N else g * V[s + 1])
            left = g * V[max(s - 1, 0)]
            nv[s] = max(left, right)
        V = nv
    return V[p["s"]]


def dl_q_learning(p):
    Q = {("s", "a"): p["q"]}
    nxt = 0 if p["terminal"] else max(p["next"])
    Q[("s", "a")] = (1 - p["alpha"]) * Q[("s", "a")] + p["alpha"] * (p["rew"] + p["gamma"] * nxt)
    return Q[("s", "a")]


def dl_gp_posterior(p):
    if p["n"] == 1:
        K = np.array([[1.0]]); ks = np.array([p["k1"]]); y = np.array([p["y1"]])
    else:
        K = np.array([[1.0, p["k12"]], [p["k12"], 1.0]]); ks = np.array([p["k1"], p["k2"]]); y = np.array([p["y1"], p["y2"]])
    # condition the joint Gaussian of (f(x), f(x₁), …) directly
    S = np.block([[np.ones((1, 1)), ks[None]], [ks[:, None], K]])
    mean = S[0, 1:] @ np.linalg.solve(S[1:, 1:], y)
    var = S[0, 0] - S[0, 1:] @ np.linalg.solve(S[1:, 1:], S[1:, 0])
    return float(mean if p["ask"] == "mean" else var)


def dl_rbf_kernel(p):
    from sklearn.gaussian_process.kernels import RBF, ConstantKernel
    k = ConstantKernel(p["a"] ** 2) * RBF(length_scale=p["l"])
    return float(k(np.array([[0.0]]), np.array([[p["d"]]]))[0, 0])


def dl_hpo(p):
    fam = p["fam"]
    if fam == "grid":
        return len(list(itertools.product(*[range(n) for n in p["ns"]])))
    if fam == "random":
        n = 1
        while 1 - (1 - p["q"]) ** n < p["p"]:
            n += 1
        return n
    if fam == "memory":
        return p["B"] * sum(p["ws"][1:])
    n, eta, r = p["n"], p["eta"], p["rmin"]
    total, alive, budget = 0, n, r
    while alive >= 1:
        total += alive * budget
        alive //= eta
        budget *= eta
    return total


def dl_gan(p):
    if p["fam"] == "leaky":
        return float(nn.LeakyReLU(p["a"])(torch.tensor(float(p["x"]))))
    D = sp.symbols("D", positive=True)
    obj = p["pd"] * sp.log(D) + p["pg"] * sp.log(1 - D)  # pointwise GAN objective
    return float(sp.solve(sp.diff(obj, D), D)[0])


def dl_matrix_factorization(p):
    if p["ask"] == "params":
        m, n, k = p["m"], p["n"], p["k"]
        return count(nn.Embedding(m, k)) + count(nn.Embedding(n, k)) + count(nn.Embedding(m, 1)) + count(nn.Embedding(n, 1))
    if p["ask"] == "predict":
        return float(np.dot(p["p"], p["q"]) + p["bu"] + p["bi"])
    a = np.array(p["pairs"], float)
    return float(np.sqrt(np.mean((a[:, 0] - a[:, 1]) ** 2)))


def bs_gaussian_mle(p):
    x = np.array(p["xs"], float)
    return {"mean": x.mean(), "var": x.var(ddof=0), "unbiased": x.var(ddof=1)}[p["ask"]]


def bs_information(p):
    from scipy.stats import entropy
    if p["ask"] == "MI":
        J = np.array(p["J"], float)
        return float(entropy(J.sum(1), base=2) + entropy(J.sum(0), base=2) - entropy(J.ravel(), base=2))
    P, Q = np.array(p["p"]), np.array(p["q"])
    if p["ask"] == "H":
        return float(entropy(P, base=2))
    if p["ask"] == "KL":
        return float(entropy(P, Q, base=2))
    return float(entropy(P, base=2) + entropy(P, Q, base=2))


def bs_beta_binomial(p):
    from scipy.stats import beta
    a, b = p["a"] + p["h"], p["b"] + p["n"] - p["h"]
    if p["ask"] == "post":
        return beta(a, b).mean()
    if p["ask"] == "mle":
        return p["h"] / p["n"]
    xs = np.linspace(0, 1, 2_000_001)
    return float(xs[np.argmax(beta(a, b).logpdf(np.clip(xs, 1e-12, 1 - 1e-12)))])


def bs_conditional_gaussian(p):
    s1, s2, r = p["s1"], p["s2"], p["rho"]
    S = np.array([[s1 * s1, r * s1 * s2], [r * s1 * s2, s2 * s2]])
    if p["ask"] == "mean":
        return p["m1"] + S[0, 1] / S[1, 1] * (p["x2"] - p["m2"])
    return S[0, 0] - S[0, 1] ** 2 / S[1, 1]


def bs_density_estimation(p):
    if p["fam"] == "hist":
        return p["n"] / p["N"] / p["D"]
    return p["K"] / p["N"] / (2 * p["rad"])


def bs_least_squares(p):
    x, y = np.array(p["xs"], float), np.array(p["ys"], float)
    if p["ask"] == "ridge":
        from sklearn.linear_model import Ridge
        return float(Ridge(alpha=p["lam"], fit_intercept=False).fit(x[:, None], y).coef_[0])
    b, a = np.polyfit(x, y, 1)
    return float(b if p["ask"] == "slope" else a)


def bs_bias_variance(p):
    rng = np.random.default_rng(3)
    mu, s2, n, c = p["mu"], p["s2"], p["n"], p["c"]
    # exact, by the definitions, rather than the formula: E and Var of c·x̄
    Ex, Vx = mu, s2 / n
    bias, var = c * Ex - mu, c * c * Vx
    return {"bias": bias, "var": var, "mse": bias ** 2 + var}[p["ask"]]


def bs_classification_metrics(p):
    if p["ask"] == "thresh":
        pp = sp.symbols("p")
        return float(sp.solve(sp.Eq(pp * p["lfn"], (1 - pp) * p["lfp"]), pp)[0])
    from sklearn.metrics import precision_score, recall_score, accuracy_score, f1_score
    y = [1] * p["TP"] + [0] * p["FP"] + [1] * p["FN"] + [0] * p["TN"]
    yh = [1] * p["TP"] + [1] * p["FP"] + [0] * p["FN"] + [0] * p["TN"]
    return {"prec": precision_score, "rec": recall_score, "acc": accuracy_score, "f1": f1_score}[p["ask"]](y, yh)


def bs_gaussian_classifier(p):
    from scipy.stats import norm
    m1, m2, s, p1 = p["m1"], p["m2"], p["s"], p["p1"]
    post = lambda x: p1 * norm.pdf(x, m1, s) / (p1 * norm.pdf(x, m1, s) + (1 - p1) * norm.pdf(x, m2, s))
    if p["ask"] == "post":
        return float(post(p["x0"]))
    from scipy.optimize import brentq
    logodds = lambda x: math.log(p1 / (1 - p1)) + norm.logpdf(x, m1, s) - norm.logpdf(x, m2, s)
    return brentq(logodds, m1 - 50, m2 + 50)


def bs_logistic(p):
    w = torch.tensor(p["w"], dtype=torch.float64, requires_grad=True)
    b = torch.tensor(float(p["b"]))
    x = torch.tensor(p["x"], dtype=torch.float64)
    z = w @ x + b
    if p["ask"] == "p":
        return float(torch.sigmoid(z))
    loss = nn.functional.binary_cross_entropy_with_logits(z, torch.tensor(float(p["y"])))
    if p["ask"] == "loss":
        return float(loss)
    loss.backward()
    return float(w.grad[p["i"]])


def bs_momentum_adam(p):
    g = p["g"]
    if p["ask"] == "limit":
        v = 0.0
        for _ in range(5000):
            v = p["beta"] * v + g
        return v
    if p["ask"] == "mom":
        w = torch.zeros(1, requires_grad=True)
        opt = torch.optim.SGD([w], lr=1.0, momentum=p["beta"], dampening=0)
        for _ in range(p["t"]):
            opt.zero_grad(); w.grad = torch.full((1,), float(g)); opt.step()
        return float(opt.state[w]["momentum_buffer"][0])
    w = torch.zeros(1, requires_grad=True)
    opt = torch.optim.Adam([w], lr=p["lr"], betas=(p["beta"], 0.999), eps=1e-12)
    prev = 0.0
    for _ in range(p["t"]):
        prev = float(w.detach()[0])
        opt.zero_grad(); w.grad = torch.full((1,), float(g)); opt.step()
    return -(float(w.detach()[0]) - prev)  # the step taken is −lr·m̂/√v̂


def bs_weight_decay(p):
    w = torch.tensor([float(p["w0"])], requires_grad=True)
    opt = torch.optim.SGD([w], lr=p["eta"], weight_decay=p["lam"])
    for _ in range(p["k"]):
        opt.zero_grad(); w.grad = torch.zeros(1); opt.step()
    return float(w.detach()[0])


def bs_bayes_net_params(p):
    n = len(p["parents"])
    free = sum(2 ** k for k in p["parents"])  # one Bernoulli per parent configuration
    return free if p["ask"] == "params" else (2 ** n - 1) - free


def bs_gnn(p):
    n, v = p["n"], p["v"]
    A = np.zeros((n, n))
    for a, b in p["E"]:
        A[a, b] = A[b, a] = 1
    h = np.array(p["h"], float)
    if p["agg"] == "sum":
        return float(((A + np.eye(n)) @ h)[v])
    if p["agg"] == "mean":
        return float((A @ h)[v] / A[v].sum())
    At = A + np.eye(n)
    D = np.diag(1 / np.sqrt(At.sum(1)))
    return float((D @ At @ D @ h)[v])


def bs_sampling(p):
    fam = p["fam"]
    if fam == "reject":
        return p["N"] * p["M"]
    if fam == "mh":
        from scipy.stats import norm
        return min(1.0, norm.pdf(p["xp"], 0, p["s"]) / norm.pdf(p["x"], 0, p["s"]))
    rng = np.random.default_rng(5)
    q, pp, f = np.array(p["q"]), np.array(p["p"]), np.array(p["f"], float)
    return float(np.sum(pp * f))  # E_q[f p/q] computed as the sum it reduces to


def bs_kmeans_gmm(p):
    if p["ask"] == "kmeans":
        from sklearn.cluster import KMeans
        X = np.array(p["xs"], float)[:, None]
        km = KMeans(n_clusters=2, init=np.array(p["c"], float)[:, None], n_init=1, max_iter=1).fit(X)
        return float(km.cluster_centers_[p["k"], 0])
    from scipy.stats import norm
    a = p["pi"] * norm.pdf(p["x"], p["m"][0], 1); b = (1 - p["pi"]) * norm.pdf(p["x"], p["m"][1], 1)
    return float(a / (a + b))


def bs_pca(p):
    if p["ask"] == "eig2":
        C = np.array([[p["a"], p["b"]], [p["b"], p["c"]]], float)
        ev = np.linalg.eigvalsh(C)
        return float(ev.max() / ev.sum())
    ls = np.array(p["ls"], float)
    cum = np.cumsum(np.sort(ls)[::-1]) / ls.sum()
    if p["ask"] == "ratio":
        return float(cum[p["k"] - 1])
    return int(np.argmax(cum >= p["th"] - 1e-12) + 1)


def bs_flows(p):
    from scipy.stats import norm
    x, mu, s = np.array(p["x"], float), np.array(p["mu"], float), np.array(p["s"], float)
    # density of x = μ + s·z by the pushforward: product of N(μ, s²) densities
    return float(np.sum(norm.logpdf(x, mu, s)))


def bs_vae_kl(p):
    q = torch.distributions.Normal(torch.tensor(p["mu"], dtype=torch.float64), torch.tensor(p["s"], dtype=torch.float64))
    prior = torch.distributions.Normal(torch.zeros(len(p["mu"]), dtype=torch.float64), torch.ones(len(p["mu"]), dtype=torch.float64))
    return float(torch.distributions.kl_divergence(q, prior).sum())


def bs_diffusion(p):
    # run the chain on x₀ = 1 exactly: mean and variance propagate step by step
    mean, var = 1.0, 0.0
    for _ in range(p["t"]):
        mean, var = math.sqrt(1 - p["beta"]) * mean, (1 - p["beta"]) * var + p["beta"]
    return {"mean": mean, "var": var, "snr": mean ** 2 / var}[p["ask"]]


# ---- complex analysis (Stein): site/generators-complex.js --------------------------------


def ca_complex_arithmetic(p):
    z = complex(p.get("a", 0), p.get("b", 0))
    if p["ask"] == "mod":
        return abs(z ** p["n"])
    if p["ask"] == "arg":
        import cmath
        return math.degrees(cmath.phase(z))
    if p["ask"] == "pow":
        import cmath
        return (cmath.exp(1j * math.pi / p["k"]) ** p["n"]).real
    roots = np.roots([1] + [0] * (p["n"] - 1) + [-1j * p["R"]])
    return len(roots) if p["ask2"] == "count" else float(abs(roots[0]))


def ca_harmonic(p):
    x, y = sp.symbols("x y", real=True)
    if p["fam"] == "harm":
        u = p["a"] * x ** 2 + p["b"] * y ** 2
        return "Yes" if sp.simplify(sp.diff(u, x, 2) + sp.diff(u, y, 2)) == 0 else "No"
    z = x + sp.I * y
    f = z ** 2 + (p["a"] - sp.I * p["b"]) * z  # holomorphic with Re f = u
    v = sp.im(sp.expand(f))
    u = sp.re(sp.expand(f))
    assert sp.simplify(u - (x ** 2 - y ** 2 + p["a"] * x + p["b"] * y)) == 0
    return float(v.subs({x: p["x"], y: p["y"]}))


def ca_power_series(p):
    z = sp.symbols("z")
    f = sp.exp(p["a"] * z) / (1 - z) if p["fam"] == "exp" else (1 - z) ** (-p["m"])
    return float(sp.series(f, z, 0, p["n"] + 1).removeO().coeff(z, p["n"]))


def ca_fourier(p):
    from scipy.integrate import quad
    a, xi = p["a"], p["xi"]
    f = (lambda x: math.exp(-math.pi * a * x * x)) if p["fam"] == "gauss" else (lambda x: a / (math.pi * (a * a + x * x)))
    if xi == 0:
        return quad(f, -np.inf, np.inf)[0]
    # f is even, so the transform is 2∫₀^∞ f(x) cos(2πxξ) dx (QAWF for the oscillatory tail)
    return 2 * quad(f, 0, np.inf, weight="cos", wvar=2 * math.pi * xi)[0]


def ca_real_integrals(p):
    from scipy.integrate import quad
    a, b = p["a"], p["b"]
    if p["fam"] == "cos":
        return 2 * quad(lambda x: 1 / (x * x + a * a), 0, np.inf, weight="cos", wvar=b)[0]
    f = {"a2": lambda x: 1 / (x * x + a * a), "sq": lambda x: 1 / (x * x + a * a) ** 2, "x4": lambda x: 1 / (1 + x ** 4)}[p["fam"]]
    return quad(f, -np.inf, np.inf)[0]


def ca_zeros_poles(p):
    z = sp.symbols("z")
    k = p["k"]
    f, at = {"zksin": (z ** k * sp.sin(z), 0), "cos": (1 - sp.cos(z ** k), 0), "exp": (1 / (z ** k * (sp.exp(z) - 1)), 0),
             "sin2": (1 / sp.sin(sp.pi * z) ** 2, 3), "sinz": (sp.sin(z) / z ** k, 0), "exp2": (sp.exp(z) - 1 - z, 0)}[p["key"]]
    w = sp.symbols("w")
    s = sp.series(f.subs(z, w + at), w, 0, 2 * k + 6 if k else 8).removeO()
    return abs(min(term.as_coeff_exponent(w)[1] for term in sp.Add.make_args(sp.expand(s)) if term != 0))


def ca_argument_principle(p):
    coeffs = np.poly([complex(a, b) for a, b in p["roots"]])
    return int(np.sum(np.abs(np.roots(coeffs)) < p["R"]))


def ca_gamma_zeta(p):
    fam = p["fam"]
    if fam == "gint":
        return math.gamma(p["n"])
    if fam == "ghalf":
        return math.gamma(p["n"] + 0.5)
    if fam == "zeta":
        return float(sp.zeta(p["s"]).evalf())
    return str(sp.nsimplify(sp.zeta(p["s"]))).replace(" ", "")


def ca_conformal(p):
    if p["fam"] == "cayley":
        z = 1j * p["y"]
        return ((1j - z) / (1j + z)).real
    a, b = complex(p["a"]), complex(p["b"])
    if p["fam"] == "rho":
        return abs((a - b) / (1 - b.conjugate() * a))
    return ((a - b) / (1 - a.conjugate() * b)).real


ML_REFS = {name.replace("_", "-"): fn for name, fn in list(globals().items())
           if name.startswith(("dl_", "bs_", "ca_complex", "ca_harmonic", "ca_power", "ca_fourier", "ca_real", "ca_zeros",
                               "ca_argument", "ca_gamma", "ca_conformal")) and callable(fn)}


REFS = {
    "sf-dimensions": sf_dimensions, "sf-easy-cases": sf_easy_cases, "sf-lumping": sf_lumping,
    "sf-pictorial": sf_pictorial, "sf-big-part": sf_big_part, "sf-analogy": sf_analogy,
    "ra-delta-linear": ra_delta_linear, "ra-delta-square": ra_delta_square,
    "ra-sequence-N": ra_sequence_N, "ra-sup-limsup": ra_sup_limsup, "ra-ratio-test": ra_ratio_test,
    "ra-darboux": ra_darboux, "aa-order-zn": aa_order_zn, "aa-perm-order": aa_perm_order,
    "aa-perm-sign": aa_perm_sign, "aa-cyclic-count": aa_cyclic_count,
    "nt-diophantine": nt_diophantine,
    "nt-fermat-wilson": nt_fermat_wilson, "nt-units": nt_units, "la-eigen2": la_eigen2,
    "la-rank-nullity": la_rank_nullity, "la-trace-det": la_trace_det, "la-projection": la_projection,
    "ca-residue": ca_residue, "ca-radius": ca_radius, "pr-bayes-test": pr_bayes_test,
    "pr-indicators": pr_indicators,
    "es-loop": es_loop,
    "es-shape": es_shape, "es-flops": es_flops, "es-which": es_which, "es-eval": es_eval,
    "es-rearrange": es_rearrange, "es-attn-memory": es_attn_memory,
    "ml-mlp-params": mlp_params, "ml-conv1x1": conv1x1, "ml-conv-sharing": conv_sharing,
    "ml-pooling": pooling, "ml-vc-poly": vc_poly, "ml-interpolation": interpolation,
    "ml-sqrt-n": sqrt_n, "ml-best-constant": best_constant, "ml-noisy-gram": noisy_gram,
    "ml-coin-variance": coin_variance, "ml-markov-joint": markov_joint,
    "ml-logsumexp": logsumexp, "ml-norm-gradient": norm_gradient,
    "ml-chain-rule": chain_rule, "ml-vector-backward": vector_backward,
    "ml-tanh-sigmoid": tanh_sigmoid, "ml-gd-stability": gd_stability,
    "ml-bisection": bisection, "ml-softplus-min": softplus_min, "ml-saddle": saddle,
    "ml-bootstrap": bootstrap, "ml-dropout": dropout, "ml-early-stopping": early_stopping,
    "ml-kfold": kfold, "ml-grad-clip": grad_clip, "ml-ngram-table": ngram,
    "ml-padding": padding, "ml-onehot-embedding": onehot, "ml-sinusoid-ar": sinusoid_ar,
    "ml-additive-params": additive_params, "ml-additive-memory": additive_memory,
    "ml-attention-cov": attention_cov, "ml-sinusoidal-pe": sinusoidal_pe,
    "ml-nullspace-proj": nullspace_proj, "ml-linear-rank": linear_rank,
    "ml-backprop-memory": backprop_memory,
    **GS_REFS,
    **AN_REFS,
    **AL_REFS,
    **ML_REFS,
}

if __name__ == "__main__":
    if sys.argv[1:] == ["--list"]:
        print(json.dumps(sorted(REFS)))
        sys.exit(0)
    for line in sys.stdin:
        rec = json.loads(line)
        try:
            value = REFS[rec["skill"]](rec["params"])
            # None: this variant (a multiple-choice statement) has nothing to recompute
            out = {"skip": True} if value is None else {"value": value if isinstance(value, str) else float(value)}
        except Exception as err:  # reported per record, never fatal
            out = {"error": f"{type(err).__name__}: {err}"}
        print(json.dumps(out), flush=True)
