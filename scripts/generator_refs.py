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
}

if __name__ == "__main__":
    if sys.argv[1:] == ["--list"]:
        print(json.dumps(sorted(REFS)))
        sys.exit(0)
    for line in sys.stdin:
        rec = json.loads(line)
        try:
            value = REFS[rec["skill"]](rec["params"])
            out = {"value": value if isinstance(value, str) else float(value)}
        except Exception as err:  # reported per record, never fatal
            out = {"error": f"{type(err).__name__}: {err}"}
        print(json.dumps(out), flush=True)
