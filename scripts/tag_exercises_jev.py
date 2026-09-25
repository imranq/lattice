#!/usr/bin/env python3
"""Tag every exercise with technique, difficulty, kind and servability, via Jev.

Today the corpus carries almost no semantic metadata. 492 Putnam problems were
labelled by a Gemini batch job; the other 3,612 textbook exercises have a
character-count difficulty prior and nothing else. Everything in next.md's
"Advanced" section — strategy fingerprint, technique heatmap, similarity
explorer, mistake classifier — is waiting on labels that were never affordable.

Measured cost for the whole corpus (features/jev_roadmap.md): **$0.12**, about
nine minutes at eight workers. 81 questions in one request ran at the same
latency as one, because Jev answers them in parallel; question count is very
nearly free in time and linear in tokens.

Two design decisions, both measured rather than guessed:

  1. **The tag vocabulary is gated by domain.** A flat 79-tag battery fired
     `subgroups (0.74)` and `groups (0.66)` on a counting problem about splitting
     people into teams — the words were doing the work, not the mathematics.
     Restricting the vocabulary to the book's own domain makes those tags
     structurally unaskable, and halves the cost ($0.302 -> $0.123).

  2. **Probabilities are stored, not booleans.** A tag at 0.55 is a "possibly"
     that the UI may want to show, and a threshold that lives in the data file
     cannot be changed without re-running the pass.

The vocabularies below are a starting point, not a finished list. On a 40-exercise
probability sample, 6 got no tag at all — all multiplication-principle problems,
and "multiplication principle" was simply not in the list. Run `--derive` first:
it asks a choice with an explicit "none of these" option and prints the exercises
that fall through, which is the only honest way to find what is missing.

Usage:
    python3 scripts/tag_exercises_jev.py --derive --book blitzstein --limit 200
    python3 scripts/tag_exercises_jev.py --book blitzstein --limit 50 --dry-run
    python3 scripts/tag_exercises_jev.py --out data/local/tags.json
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
USER_AGENT = "lattice/jev-client (https://github.com/imranqureshi/lattice)"
BATCH_SIZE = 3
# Jev's context window is 32k. Keep a comfortable margin for the structured
# state, question instructions, and typed answer metadata. A page-sized local
# extraction is not a problem statement and should not be sent at all.
BATCH_CHAR_LIMIT = 45_000
OVERSIZED_TEXT_CHARS = 60_000
GRAPH = Path("data/processed/graph/math.json")
LOCAL = Path("data/local")

# Tags live where the text lives. Verbatim exercise text from the copyrighted
# books is gitignored under data/local/, and a tag set is derived from that text,
# so it belongs on the same side of the line.
OUT = LOCAL / "tags.json"

# Per-domain vocabularies. Asking a probability exercise about quadratic residues
# is spending money to be told no, and — worse — it is an opportunity for a
# word-level false positive.
VOCAB = {
    "probability": [
        # Added after --derive: the four uncovered exercises in a 120-sample were
        # all axiom or set-algebra problems about events, which no technique tag
        # in the original list described.
        "probability axioms and set operations on events",
        "counting with the multiplication principle", "permutations", "combinations",
        "binomial coefficients", "inclusion-exclusion", "complementary counting",
        "bijection", "double counting", "pigeonhole", "conditional probability",
        "Bayes rule", "independence", "law of total probability", "expectation",
        "linearity of expectation", "indicator random variables", "variance",
        "moment generating functions", "generating functions", "named discrete distributions",
        "named continuous distributions", "joint distributions", "covariance and correlation",
        "order statistics", "transformations of random variables", "law of large numbers",
        "central limit theorem", "Markov chains", "random walks", "simulation",
        "casework", "symmetry argument", "recursion or first-step analysis",
    ],
    "number theory": [
        "induction", "divisibility", "prime factorization", "gcd and lcm",
        "modular arithmetic", "Chinese remainder theorem", "Fermat's little theorem",
        "Euler's totient", "primitive roots", "quadratic residues",
        "diophantine equations", "continued fractions", "arithmetic functions",
        "partitions", "generating functions", "sums of squares", "lattice points",
        "proof by contradiction", "casework", "construction", "telescoping",
    ],
    "real analysis": [
        "epsilon-delta", "convergence of sequences", "series convergence", "power series",
        "continuity", "uniform continuity", "differentiation", "mean value theorem",
        "Riemann integration", "uniform convergence", "compactness", "connectedness",
        "completeness", "metric spaces", "open and closed sets", "supremum and infimum",
        "construction of the reals", "countability", "inequalities", "counterexample",
    ],
    "linear algebra": [
        "vector spaces", "linear independence", "basis and dimension", "linear maps",
        "matrix multiplication", "rank and nullity", "determinants",
        "eigenvalues and eigenvectors", "diagonalization", "inner product spaces",
        "orthogonality", "adjoints", "spectral theorem", "Jordan form",
        "quotient spaces", "dual spaces", "polynomials of operators", "induction",
    ],
    "abstract algebra": [
        "groups", "subgroups", "cyclic groups", "cosets and Lagrange", "homomorphisms",
        "quotient groups", "group actions", "Sylow theorems", "permutation groups",
        "rings", "ideals", "quotient rings", "integral domains", "fields",
        "polynomial rings", "field extensions", "unique factorization",
        "proof by contradiction", "construction", "counterexample",
    ],
    "complex analysis": [
        "complex arithmetic", "Cauchy-Riemann equations", "holomorphic functions",
        "power series", "contour integration", "Cauchy's theorem", "Cauchy's integral formula",
        "residue theorem", "Laurent series", "singularities", "conformal maps",
        "maximum modulus", "analytic continuation", "harmonic functions",
    ],
    "machine learning": [
        "linear algebra for machine learning", "vectors and matrices",
        "matrix multiplication", "eigenvalues and eigenvectors", "derivatives",
        "gradients and partial derivatives", "gradient descent", "optimization",
        "probability", "Bayes rule", "likelihood and maximum likelihood",
        "loss functions", "linear regression", "logistic regression",
        "classification", "K-nearest neighbors", "decision trees",
        "support vector machines", "neural networks", "backpropagation",
        "regularization", "principal component analysis", "embeddings",
        "attention and transformers", "data preprocessing", "model evaluation",
        "cross-validation", "overfitting and underfitting", "generative models",
        "clustering", "dimensionality reduction", "reinforcement learning",
    ],
    "contest": [
        "induction", "pigeonhole", "inclusion-exclusion", "bijection", "double counting",
        "generating functions", "recurrence relations", "modular arithmetic",
        "inequalities (AM-GM, Cauchy-Schwarz)", "extremal principle", "invariants",
        "symmetry argument", "casework", "construction", "proof by contradiction",
        "telescoping", "substitution", "polynomial roots", "functional equations",
        "geometry with coordinates", "combinatorial geometry", "limits and estimation",
    ],
}
# Books whose domain has no vocabulary of its own fall back to the contest list,
# which is technique-shaped rather than topic-shaped and so applies broadly.
FALLBACK = "contest"

DIFFICULTY = [
    "routine drill applying a stated definition directly",
    "standard exercise needing one idea",
    "needs a non-obvious construction or several chained steps",
    "olympiad or qualifying-exam hard",
]

KIND = {
    "prove a statement": None,
    "compute a value": None,
    "find all solutions": None,
    "construct an example": None,
    "give a counterexample": None,
    "explain or interpret": None,
}


def call(state, questions, retries=3):
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        sys.exit("TYPESAFE_API_KEY is not set (it lives in .env)")
    body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
    for attempt in range(retries):
        req = urllib.request.Request(
            API, data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {key}",
                     "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # TypeSafe is fronted by an edge rate/policy layer that can answer
            # a short burst with 403/1010 rather than 429. A 403 after a quiet
            # request is a real auth problem, but a burst 403 is transient; the
            # low-concurrency default plus backoff handles both safely.
            if e.code in (403, 429, 529, 500, 503) and attempt < retries - 1:
                time.sleep(3.0 * (attempt + 1))
                continue
            print(f"  ! {e.code} {e.read().decode()[:200]}", file=sys.stderr)
            return None
        except Exception as e:                                  # noqa: BLE001
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            print(f"  ! {e}", file=sys.stderr)
            return None
    return None


def load_text(graph):
    """Every exercise whose statement we can actually read.

    Two sources, and missing the second one was a real bug: redistributable
    sources (Grinstead & Snell, the Putnam archive, the MATH dataset) carry their
    text *inline in the graph*, because their licences allow it. Only the
    copyrighted books keep theirs in gitignored data/local/. Reading just the
    latter left 12,500-odd exercises untagged — and an untagged exercise has no
    difficulty, so it slipped straight past the ceiling that "basic" sets.
    """
    text = {e["id"]: e["text"] for e in graph["exercises"] if e.get("text")}
    for f in sorted(LOCAL.glob("*.text.json")):
        text.update(json.loads(f.read_text()))
    for f in sorted(LOCAL.glob("*.repaired.json")):
        text.update(json.loads(f.read_text()))       # a repair supersedes the extraction
    return text


def vocab_for(domain):
    return VOCAB.get(domain, VOCAB[FALLBACK])


def questions_for(domain):
    """One noul per tag, plus difficulty, kind, and the servability questions that
    replace `garble_score` and `math_loss`.

    Servability is here rather than in its own pass because it is free to ask
    alongside everything else, and because the two heuristics it replaces
    disagree with a direct reading on 42% of OCR'd exercises — with 32% of what
    they currently let through being unusable."""
    q = {f"tag:{t}": {"type": "noul", "instructions": f"Does solving this exercise require {t}?"}
         for t in vocab_for(domain)}
    q["difficulty"] = {
        "type": "score",
        "instructions": "How demanding is this exercise for a student who has just read the "
                        "section it belongs to?",
        "criteria": DIFFICULTY,
    }
    q["kind"] = {"type": "choice", "instructions": "What does the exercise ask for?",
                 "criteria": KIND}
    q["servable"] = {
        "type": "noul",
        "instructions": "Is this a complete, readable mathematics exercise statement that a "
                        "student could attempt as-is?",
        "criteria": {"true": "A coherent, self-contained problem statement.",
                     "false": "Garbled, truncated, or mathematically unreadable."},
    }
    q["self_contained"] = {
        "type": "noul",
        "instructions": "Can a student solve this exercise using only the text shown, standard "
                        "mathematical conventions, and facts explicitly supplied in the "
                        "statement?",
        "criteria": {
            "true": "All definitions, data, constraints, and referenced objects needed to solve "
                    "the exercise are present or standard.",
            "false": "The exercise depends on missing context, a prior definition or theorem, "
                     "an absent dataset, or information not included in the text.",
        },
    }
    q["math_intact"] = {
        "type": "noul",
        "instructions": "Are the mathematical expressions in this text intact, rather than "
                        "flattened, mangled, or missing?",
    }
    # `math_intact` turned out to answer the wrong question. On Axler 3.10 —
    # "a linear map from F5 to F2 whose null space equals {(x1 , x2 , x3 , x4 ,
    # x5 )}" — it returned 0.83, because the maths *is* readable: a human infers
    # the subscripts. But the book printed superscripts and subscripts, the
    # extractor flattened them, and what the learner sees is wrong.
    #
    # Asking directly about typography separates it cleanly: 0.96 on that
    # exercise, 0.03 on clean LaTeX, 0.05 on prose with no notation at all.
    q["notation_lost"] = {
        "type": "noul",
        "instructions": "Has this text lost its mathematical typography? True if subscripts, "
                        "superscripts, exponents or symbols that the source printed as proper "
                        "notation now appear as flat inline characters (for example 'x1' where "
                        "the book printed x-subscript-1, 'F5' where it printed F-superscript-5, "
                        "or '3x2' for 3x-subscript-2).",
        "criteria": {
            "true": "Notation has been flattened into plain characters by the extractor.",
            "false": "Either the notation is correctly marked up, or the text contains no "
                     "mathematical notation at all.",
        },
    }
    q["truncated"] = {
        "type": "noul",
        "instructions": "Does the text stop mid-sentence, or run on into unrelated body text "
                        "from the page?",
    }
    # Nothing in Lattice detects this today, and an exercise whose figure was
    # never extracted is unanswerable however clean its characters are.
    q["needs_figure"] = {
        "type": "noul",
        "instructions": "Does the exercise refer to a figure, diagram or table that is not "
                        "present in the text?",
    }
    q["multipart"] = {"type": "noul",
                      "instructions": "Does this exercise have multiple labelled parts?"}
    return q


# Just the extraction-quality questions, for re-scoring a corpus that is already
# tagged without paying for the whole battery again.
def quality_questions(domain):
    full = questions_for(domain)
    keep = ("servable", "self_contained", "math_intact", "notation_lost", "truncated", "needs_figure")
    return {k: full[k] for k in keep}


def derive_questions(domain):
    """Vocabulary-gap mode: force a single choice and give it a way out.

    The exercises where "none of these" wins are the ones the vocabulary does not
    cover. Reading those is how the list gets extended — inventing tags and
    hoping is what produced a 15% zero-tag rate on the first sample."""
    options = {t: None for t in vocab_for(domain)}
    options["none of these"] = None
    return {
        "main": {"type": "choice",
                 "instructions": "Which single technique is most central to solving this "
                                 "exercise? Choose 'none of these' if the list does not "
                                 "contain it.",
                 "criteria": options},
    }


def one(ex, text, qbuilder):
    body = text.get(ex["id"])
    if not body:
        return None
    res = call({"exercise_text": body,
                "book": ex.get("book_id"),
                "section": ex.get("section_title"),
                "course": ex.get("domain")},
               qbuilder(ex.get("domain")))
    if not res or "answers" not in res:
        return None
    return {"id": ex["id"], "answers": res["answers"],
            "tokens": res.get("usage", {}).get("input_tokens", 0)}


def batch(exercises, text, qbuilder):
    """Judge a small batch of exercises in one System One request.

    TypeSafe batches independent questions against one structured state. The
    explicit array paths are important: each question is about one exercise,
    while the request pays for the shared state only once. We keep batches
    small because the full tag battery is already dozens of questions.
    """
    state = {"exercises": [
        {"id": e["id"], "text": text[e["id"]], "book": e.get("book_id"),
         "section": e.get("section_title"), "domain": e.get("domain")}
        for e in exercises
    ]}
    questions = {}
    keys = []
    for i, e in enumerate(exercises):
        for key, q in qbuilder(e.get("domain") or FALLBACK).items():
            qid = f"e{i}__{key}"
            q2 = dict(q)
            instruction = q2["instructions"]
            if isinstance(instruction, str):
                q2["instructions"] = f"For `exercises[{i}].text`, {instruction[0].lower() + instruction[1:]}"
            questions[qid] = q2
            keys.append((i, key, qid))
    res = call(state, questions)
    if not res or "answers" not in res:
        return []
    by_ex = [{"id": e["id"], "answers": {}, "tokens": 0}
             for e in exercises]
    answers = res["answers"]
    for i, key, qid in keys:
        if qid in answers:
            by_ex[i]["answers"][key] = answers[qid]
    # Count the request once, rather than multiplying its usage by batch size.
    if by_ex:
        by_ex[0]["tokens"] = res.get("usage", {}).get("input_tokens", 0)
    return [r for r in by_ex if len(r["answers"]) == len(qbuilder(exercises[0].get("domain") or FALLBACK))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", type=Path, default=GRAPH)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--book", help="restrict to one book id")
    ap.add_argument("--domain", help="restrict to one domain")
    ap.add_argument("--limit", type=int, default=0, help="first N exercises only")
    ap.add_argument("--workers", type=int, default=2,
                    help="concurrent Jev requests (default 2; higher values can trigger edge throttling)")
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE,
                    help="exercises per Jev request (default 3)")
    ap.add_argument("--derive", action="store_true",
                    help="vocabulary-gap mode: print exercises no tag covers")
    ap.add_argument("--quality-only", action="store_true",
                    help="re-score only the extraction-quality questions and merge them "
                         "into an existing tag file, leaving the tags alone")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--untagged-only", action="store_true",
                    help="skip exercises already present in the output file")
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text())
    text = load_text(graph)
    exercises = [e for e in graph["exercises"]
                 if e["id"] in text
                 and (not args.book or e.get("book_id") == args.book)
                 and (not args.domain or e.get("domain") == args.domain)]
    if args.untagged_only and args.out.exists():
        done = set(json.loads(args.out.read_text()).get("exercises", {}))
        before = len(exercises)
        exercises = [e for e in exercises if e["id"] not in done]
        print(f"skipping {before - len(exercises):,} already tagged")
    if args.limit:
        exercises = exercises[:args.limit]

    by_domain = Counter(e.get("domain") for e in exercises)
    print(f"{len(exercises)} exercises with local text")
    for d, n in by_domain.most_common():
        known = "own vocabulary" if d in VOCAB else f"falls back to '{FALLBACK}'"
        print(f"  {str(d):18s} {n:5d}  {len(vocab_for(d))} tags, {known}")
    if args.dry_run:
        # ~700 tokens per exercise for a 23-tag domain, measured.
        est = len(exercises) * 750
        print(f"\nestimate: ~{est:,} input tokens ≈ ${est / 1e6 * 0.042:.3f}")
        return

    builder = (derive_questions if args.derive
               else quality_questions if args.quality_only else questions_for)
    t0 = time.time()
    # Keep one domain per request so the question vocabulary is stable. This
    # also makes partial retries and the output format deterministic.
    batches = []
    oversized = []
    for domain in sorted({e.get("domain") for e in exercises}):
        same = [e for e in exercises if e.get("domain") == domain]
        current = []
        chars = 0
        for e in same:
            size = len(text[e["id"]])
            if size > OVERSIZED_TEXT_CHARS:
                oversized.append(e)
                continue
            if (current and (len(current) >= max(1, args.batch_size)
                             or chars + size > BATCH_CHAR_LIMIT)):
                batches.append(current)
                current, chars = [], 0
            current.append(e)
            chars += size
        if current:
            batches.append(current)
    with ThreadPoolExecutor(max_workers=args.workers) as ex_:
        result_batches = ex_.map(lambda b: batch(b, text, builder), batches)
        results = [r for group in result_batches for r in group]
    # These are almost certainly page-contaminated extractions (often 100k+
    # characters), not unusually long exercises. Record them so the serving
    # filter can exclude them, without pretending Jev successfully read them.
    for e in oversized:
        results.append({"id": e["id"], "tokens": 0, "size_guard": True})
    wall = time.time() - t0
    tokens = sum(r["tokens"] for r in results)
    print(f"\n{len(results)}/{len(exercises)} tagged in {wall:.0f}s · {tokens:,} tokens "
          f"· ${tokens / 1e6 * 0.042:.3f}")

    # A provider failure can return zero results after every request has been
    # rejected (for example by an edge proxy). Never replace a healthy tag file
    # with an empty one in that case.
    if not results:
        print("no successful Jev results; leaving the existing output untouched")
        return

    if args.derive:
        by_id = {e["id"]: e for e in exercises}
        missed = [r for r in results if r["answers"]["main"]["choice"] == "none of these"]
        print(f"\n{len(missed)} of {len(results)} ({100 * len(missed) / max(1, len(results)):.0f}%) "
              "matched no tag. Read these and extend VOCAB:\n")
        for r in missed[:40]:
            print(f"  [{by_id[r['id']].get('domain')}] {r['id']}")
            print(f"    {text[r['id']][:150]!r}\n")
        hit = Counter(r["answers"]["main"]["choice"] for r in results
                      if r["answers"]["main"]["choice"] != "none of these")
        print("tags that did fire:", hit.most_common(15))
        return

    if args.quality_only:
        existing = json.loads(args.out.read_text()) if args.out.exists() else {"exercises": {}}
        merged = existing.get("exercises", {})
        changed = 0
        for r in results:
            if r.get("size_guard"):
                continue
            a = r["answers"]
            row = merged.setdefault(r["id"], {})
            for k in ("servable", "self_contained", "math_intact", "notation_lost", "truncated", "needs_figure"):
                row[k] = round(a[k]["noul"], 3)
            if row["notation_lost"] > 0.6:
                changed += 1
        existing["exercises"] = merged
        existing["quality_rescored"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        args.out.write_text(json.dumps(existing, indent=1))
        n = len(results)
        bad = sum(1 for r in results if r["answers"]["servable"]["noul"] < 0.5)
        print(f"  notation flattened : {changed} ({100 * changed / max(1, n):.0f}%)")
        print(f"  unservable         : {bad} ({100 * bad / max(1, n):.0f}%)")
        print(f"\nmerged into {args.out}")
        return

    out, stats = {}, defaultdict(int)
    for r in results:
        if r.get("size_guard"):
            out[r["id"]] = {
                "tags": {}, "difficulty": 0.0, "difficulty_confidence": 0.0,
                "kind": "unknown", "kind_confidence": 0.0,
                "servable": 0.0, "self_contained": 0.0,
                "math_intact": 0.0, "notation_lost": 0.0, "truncated": 1.0,
                "needs_figure": 0.0, "multipart": 0.0,
                "quality_source": "input_size_guard",
            }
            stats["oversized"] += 1
            stats["unservable"] += 1
            continue
        a = r["answers"]
        # Raw probabilities, deliberately. A threshold in this file could not be
        # changed without paying for the pass again.
        tags = {k[4:]: round(v["noul"], 3) for k, v in a.items() if k.startswith("tag:")}
        out[r["id"]] = {
            "tags": tags,
            "difficulty": round(a["difficulty"]["score"], 3),
            "difficulty_confidence": round(a["difficulty"]["confidence"], 3),
            "kind": a["kind"]["choice"],
            "kind_confidence": round(a["kind"]["confidence"], 3),
            "servable": round(a["servable"]["noul"], 3),
            "self_contained": round(a["self_contained"]["noul"], 3),
            "math_intact": round(a["math_intact"]["noul"], 3),
            "notation_lost": round(a["notation_lost"]["noul"], 3),
            "truncated": round(a["truncated"]["noul"], 3),
            "needs_figure": round(a["needs_figure"]["noul"], 3),
            "multipart": round(a["multipart"]["noul"], 3),
            "quality_source": "jev",
        }
        if not any(p > 0.6 for p in tags.values()):
            stats["zero_tag"] += 1
        if a["servable"]["noul"] < 0.5:
            stats["unservable"] += 1
        if a["needs_figure"]["noul"] > 0.6:
            stats["needs_figure"] += 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
         "model": MODEL, "vocab": {d: vocab_for(d) for d in by_domain},
         "exercises": out}, indent=1))

    n = len(out)
    print(f"  zero tags above 0.6 : {stats['zero_tag']} ({100 * stats['zero_tag'] / max(1, n):.0f}%)"
          "   <- if this is over ~5%, run --derive and extend VOCAB")
    print(f"  judged unservable   : {stats['unservable']} ({100 * stats['unservable'] / max(1, n):.0f}%)")
    print(f"  input-size guarded  : {stats['oversized']}")
    print(f"  need a missing figure: {stats['needs_figure']}")
    fired = Counter()
    for v in out.values():
        fired.update(t for t, p in v["tags"].items() if p > 0.6)
    print("\nmost common tags:", fired.most_common(12))
    print(f"\nwritten to {args.out}")


if __name__ == "__main__":
    main()
