#!/usr/bin/env python3
"""Ingest the MATH dataset (Hendrycks et al., NeurIPS 2021) as Lattice exercises.

Lattice's corpus starts hard. The README says it plainly — the Putnam bank it
grew from held 344 `hard` problems and exactly one `easy` — and the textbook
exercises that were supposed to supply the rungs are undergraduate too. Asking
for "basic probability" returned the distribution of the minimum of n iid
uniforms, because there was nothing easier to return.

MATH fills the bottom of the ladder: 12,500 competition problems from AMC 10/12,
AIME and similar, already carrying two things the textbook pipeline has to infer:

  * `level`   — Level 1..5, the dataset's own difficulty, which maps onto the
                four-level rubric the tag pass uses
  * `type`    — Algebra, Counting & Probability, Geometry, Intermediate Algebra,
                Number Theory, Prealgebra, Precalculus

and one thing almost nothing else in the corpus has: **a worked solution for
every problem**. That matters more than it looks. The shadow grader measurably
under-marks correct work when it has no reference (mean P(correct) 0.547 against
0.710 with one), so a problem that ships with its solution is a problem the
grader can be trusted on.

Licensing: MIT, so unlike the textbooks this text can live in the repo rather
than in the gitignored data/local/. https://github.com/hendrycks/math

Usage:
    python3 scripts/fetch_math_dataset.py --dry-run
    python3 scripts/fetch_math_dataset.py --max-level 3       # the easy rungs only
    python3 scripts/fetch_math_dataset.py
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

try:
    import pyarrow.parquet as pq
except ImportError:
    sys.exit("pyarrow is required: pip install pyarrow")

# The EleutherAI mirror splits by subject, which is what we want: the subject is
# the thing that maps onto a Lattice domain, and fetching per subject keeps each
# download small enough to retry.
BASE = "https://huggingface.co/api/datasets/EleutherAI/hendrycks_math/parquet"
SUBJECTS = [
    "algebra", "counting_and_probability", "geometry", "intermediate_algebra",
    "number_theory", "prealgebra", "precalculus",
]
SPLITS = ["train", "test"]

RAW = Path("data/raw/math_dataset")
OUT = Path("data/processed/books/math_dataset.json")

# MATH's subjects onto the domains Lattice already uses, so these problems land
# in the same fields as the textbooks rather than forming an island. Prealgebra
# and Algebra have no textbook equivalent here — that is precisely the gap they
# are filling — so they get their own.
DOMAIN = {
    "algebra": "algebra",
    "prealgebra": "algebra",
    "intermediate_algebra": "algebra",
    "counting_and_probability": "probability",
    "geometry": "geometry",
    "number_theory": "number theory",
    "precalculus": "precalculus",
}

# Level 1..5 onto the 0..3 rubric `tag_exercises_jev.py` scores everything else
# on, so one difficulty scale runs across the whole corpus. Levels 4 and 5 are
# both "needs a non-obvious construction"; only the hardest reaches the top rung,
# which is reserved for olympiad and qualifying-exam work.
LEVEL_TO_RUBRIC = {1: 0.0, 2: 0.8, 3: 1.5, 4: 2.2, 5: 2.8}
# The 0..1 prior the graph speaks, derived from the same mapping.
PRIOR = {1: 0.28, 2: 0.42, 3: 0.58, 4: 0.74, 5: 0.88}
TIER = {1: "W1", 2: "W1", 3: "W2", 4: "core", 5: "core"}

LEVEL_RE = re.compile(r"Level\s*(\d)")
# The answer MATH boxes at the end of every solution. Having it separately makes
# these problems auto-gradable by string comparison, with no model in the loop —
# which is worth more than it sounds, because it is the only ground truth the
# grading eval can be built on.
BOXED_RE = re.compile(r"\\boxed\{")


def extract_boxed(solution):
    """The contents of the last \\boxed{...}, brace-matched.

    A regex cannot do this: answers contain nested braces (\\frac{1}{2}), so the
    closing brace has to be found by counting."""
    start = None
    for m in BOXED_RE.finditer(solution):
        start = m.end()
    if start is None:
        return None
    depth = 1
    for i in range(start, len(solution)):
        c = solution[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return solution[start:i].strip()
    return None


def fetch(subject, split, force=False):
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{subject}-{split}.parquet"
    if path.exists() and not force:
        return path
    url = f"{BASE}/{subject}/{split}/0.parquet"
    print(f"  fetching {subject}/{split} …", end="", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            path.write_bytes(r.read())
        print(f" {path.stat().st_size // 1024} KB")
        return path
    except Exception as e:                                      # noqa: BLE001
        print(f" failed ({e})")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--max-level", type=int, default=5,
                    help="keep only problems at or below this MATH level")
    ap.add_argument("--subjects", help="comma-separated subset of subjects")
    ap.add_argument("--force", action="store_true", help="re-download parquet files")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wanted = args.subjects.split(",") if args.subjects else SUBJECTS
    rows, skipped = [], Counter()

    for subject in wanted:
        for split in SPLITS:
            path = fetch(subject, split, args.force)
            if not path:
                continue
            for i, r in enumerate(pq.read_table(path).to_pylist()):
                m = LEVEL_RE.search(r.get("level") or "")
                if not m:
                    skipped["no level"] += 1          # a handful are "Level ?"
                    continue
                level = int(m.group(1))
                if level > args.max_level:
                    skipped["above max level"] += 1
                    continue
                problem = (r.get("problem") or "").strip()
                solution = (r.get("solution") or "").strip()
                if not problem or not solution:
                    skipped["empty"] += 1
                    continue
                # Asymptote figures are a vector-graphics language the site
                # cannot render, and a geometry problem whose diagram is a block
                # of code is unanswerable. The tag pass would catch these as
                # `needs_figure`; dropping them here is cheaper.
                if "[asy]" in problem:
                    skipped["asymptote figure"] += 1
                    continue
                answer = extract_boxed(solution)
                rows.append({
                    "id": f"math:{subject}:{split}:{i}",
                    "book_id": "math_dataset",
                    "domain": DOMAIN[subject],
                    "subject": subject,
                    "level": level,
                    "label": f"{subject.replace('_', ' ')} L{level} #{i}",
                    "section_title": subject.replace("_", " ").title(),
                    "difficulty_prior": PRIOR[level],
                    "semantic_difficulty": LEVEL_TO_RUBRIC[level],
                    "tier": TIER[level],
                    # Auto-gradable where MATH boxed an answer, which is almost
                    # everywhere. No model needed to mark these.
                    "answer": answer,
                    "auto_gradable": answer is not None,
                    "has_published_solution": True,
                    "text": problem,
                    "solution": solution,
                    "n_chars": len(problem),
                })

    by_level = Counter(r["level"] for r in rows)
    by_domain = Counter(r["domain"] for r in rows)
    gradable = sum(1 for r in rows if r["auto_gradable"])

    print(f"\n{len(rows):,} problems kept")
    print("  by level : " + ", ".join(f"L{k}={v:,}" for k, v in sorted(by_level.items())))
    print("  by domain: " + ", ".join(f"{k}={v:,}" for k, v in by_domain.most_common()))
    print(f"  auto-gradable (boxed answer): {gradable:,} "
          f"({100 * gradable / max(1, len(rows)):.0f}%)")
    if skipped:
        print("  skipped  : " + ", ".join(f"{k}={v:,}" for k, v in skipped.most_common()))
    if args.dry_run:
        return

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "book_id": "math_dataset",
        "title": "MATH (competition problems)",
        "authors": "Hendrycks, Burns, Kadavath, Arora, Basart, Tang, Song, Steinhardt",
        "url": "https://github.com/hendrycks/math",
        "license": "MIT",
        "extraction": "dataset",
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        # These are the levels the rest of the corpus does not have. Recorded so
        # a later reader knows why this source is here.
        "note": "AMC/AIME-level problems with worked solutions. Ingested to supply the "
                "easy rungs the textbook corpus lacks.",
        "exercises": rows,
    }, indent=1))
    size = args.out.stat().st_size / 1e6
    print(f"\nwritten to {args.out} ({size:.1f} MB)")
    print("MIT licensed, so this is committable — unlike the textbook text in data/local/.")
    print("Next: wire it into scripts/build_math_graph.py so the concepts join the graph.")


if __name__ == "__main__":
    main()
