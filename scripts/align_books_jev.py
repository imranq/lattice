#!/usr/bin/env python3
"""Align concepts across books, and infer prerequisite direction, with Jev.

`build_math_graph.align_across_books` compares section titles by Jaccard overlap
at a 0.5 threshold. Over 484 concept nodes and nine books that produces **19**
`aligns_with` edges, which is to say it does not work: "Definition of
expectation" and "Expected Value of Discrete Random Variables" share no tokens,
and no threshold on token overlap will ever join them.

The measured alternative (features/jev_investigation.md): ask, per source
concept, one `choice` over the candidate book's sections. 156 requests covered
all 5,460 Blitzstein x Grinstead & Snell pairs in 8 seconds for half a cent, and
proposed 67 alignments whose high-confidence end is correct.

Two passes, and the order matters — this is the one place in Lattice where a
question genuinely depends on an earlier answer:

  1. Candidate selection. One choice per source concept over the target book's
     sections plus "(no match)". Cheap, and it does the 5,460-to-156 reduction.
  2. Confirmation, only for the middle band. Its state contains the *proposed
     pair*, so it cannot be asked until pass 1 has answered. It re-asks sameness
     directly and adds the two prerequisite questions.

Prerequisite direction is asked as two independent nouls, not one "which comes
first" choice. That is deliberate: asking both lets the caller detect the cases a
forced choice would hide — both high means co-requisite (real in mathematics, and
not a DAG edge), both low means merely adjacent. An edge is written only when one
side is confident and the other is not.

Nothing here writes to the graph. It emits a proposal file for review, because a
wrong prerequisite edge is worse than a missing one: it sends a learner to study
the wrong thing and makes `weakEdges` blame the wrong concept.

Usage:
    python3 scripts/align_books_jev.py --out data/processed/graph/alignment.json
    python3 scripts/align_books_jev.py --books blitzstein,grinstead_snell --dry-run
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://api.typesafe.ai/v1/systemone"
USER_AGENT = "lattice/jev-client (https://github.com/imranqureshi/lattice)"
MODEL = "jev-latest"
GRAPH = Path("data/processed/graph/math.json")

# Cardinality ceiling is 255 options; the largest book here has 156 concepts, so
# domain blocking alone keeps every request inside it. Asserted rather than
# assumed, because a book added later could break it silently.
MAX_OPTIONS = 250

# Pass 1 confidence bands. Above HIGH we accept; below LOW we drop; between them
# we pay for a second opinion. The bands are wide because `choice` confidence is
# cardinality-sensitive — with 35 options the mass spreads, and a 0.4 there is not
# the same claim as a 0.4 over three options.
HIGH = 0.75
LOW = 0.30

# Pass 2 thresholds. Asymmetric on purpose: merging two concepts that are not the
# same corrupts every fact about both.
#
# These are *reporting* bands, not filters. Every pair that reaches pass 2 is
# written out with its raw probabilities, so a threshold can be moved without
# spending the money again. The first run showed why that matters: `same` never
# exceeded 0.84 even for pairs as plainly identical as "Continuous Random
# Variables" and "Continuous random variables", so an accept bar at 0.85 was
# unreachable and a cut at 0.70 was quietly discarding true matches.
SAME_AT = 0.60
PREREQ_AT = 0.60
NOT_PREREQ_AT = 0.35

NO_MATCH = "(no match)"


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
            # 429 and 529 are the documented back-pressure codes; everything else
            # is our fault and retrying will not help.
            if e.code in (429, 529, 500, 503) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
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


def concepts_by_book(graph):
    out = defaultdict(list)
    for n in graph["nodes"]:
        if n.get("kind") == "concept" and n.get("book_id"):
            out[n["book_id"]].append(n)
    return out


def book_titles(graph):
    return {n["id"].removeprefix("book:"): n.get("label", n["id"])
            for n in graph["nodes"] if n.get("kind") == "book"}


def pass1(src, src_book, dst_book, dst_nodes, titles):
    """One choice over the target book's sections, plus a sanity noul."""
    options = {n["label"]: None for n in dst_nodes}
    options[NO_MATCH] = None
    state = {
        "book_a": titles.get(src_book, src_book),
        "section_a": {"number": src["id"].split(":")[-1], "title": src["label"],
                      "chapter": src.get("chapter")},
        "book_b": titles.get(dst_book, dst_book),
    }
    questions = {
        "match": {
            "type": "choice",
            "instructions": "Which section of book B teaches the same mathematical concept "
                            "as section_a of book A? Choose '(no match)' if book B has no "
                            "section covering that concept.",
            "criteria": options,
        },
        # Front matter, prefaces and "notes on the exercises" align with anything
        # that mentions the same words. Cheap to ask, and it removes a whole class
        # of plausible-looking rubbish.
        "is_core": {
            "type": "noul",
            "instructions": "Is section_a a substantive mathematical topic rather than front "
                            "matter, motivation, a historical note, a recap, or an exercise "
                            "section?",
        },
    }
    res = call(state, questions)
    if not res or "answers" not in res:
        return None
    a = res["answers"]
    return {"src": src, "choice": a["match"]["choice"], "confidence": a["match"]["confidence"],
            "is_core": a["is_core"]["noul"], "tokens": res.get("usage", {}).get("input_tokens", 0)}


def pass2(src, dst, src_book, dst_book, titles):
    """Confirm a proposed pair and ask which way the dependency runs."""
    state = {
        "a": {"book": titles.get(src_book, src_book), "title": src["label"],
              "chapter": src.get("chapter")},
        "b": {"book": titles.get(dst_book, dst_book), "title": dst["label"],
              "chapter": dst.get("chapter")},
    }
    questions = {
        "same": {"type": "noul",
                 "instructions": "Do these two sections teach the same mathematical concept?"},
        # Asked apart, so the caller can see co-requisites and mere adjacency.
        "a_prereq_b": {"type": "noul",
                       "instructions": "Must a student understand section A before section B "
                                       "is approachable?"},
        "b_prereq_a": {"type": "noul",
                       "instructions": "Must a student understand section B before section A "
                                       "is approachable?"},
        "relation": {"type": "score",
                     "instructions": "How close are these two sections?",
                     "criteria": ["unrelated",
                                  "same broad area only",
                                  "strongly overlapping",
                                  "the same concept"]},
    }
    res = call(state, questions)
    if not res or "answers" not in res:
        return None
    a = res["answers"]
    return {"same": a["same"]["noul"],
            "a_prereq_b": a["a_prereq_b"]["noul"],
            "b_prereq_a": a["b_prereq_a"]["noul"],
            "relation": a["relation"]["score"],
            "relation_confidence": a["relation"]["confidence"],
            "tokens": res.get("usage", {}).get("input_tokens", 0)}


# Set from the first full run, where `same` on pairs a human would call identical
# landed in 0.74-0.84 and the plainly-wrong tail sat at 0.30 and below. Revisit
# against hand labels before anything here is merged into the graph.
def tier_of(choice_conf, same):
    if same >= 0.78 and choice_conf >= 0.60:
        return "accept"
    if same >= SAME_AT:
        return "review"
    return "rejected"


def classify(same, a_pre, b_pre):
    """What the pair is, in the three-tier shape the entity-alignment cookbook
    uses: accept, send to review, or leave alone. No single threshold decides."""
    if same >= SAME_AT:
        return "aligns_with", None
    if a_pre >= PREREQ_AT and b_pre <= NOT_PREREQ_AT:
        return "prerequisite", "a->b"
    if b_pre >= PREREQ_AT and a_pre <= NOT_PREREQ_AT:
        return "prerequisite", "b->a"
    if a_pre >= PREREQ_AT and b_pre >= PREREQ_AT:
        # Both directions required is not a DAG edge. Say so rather than picking.
        return "corequisite", None
    return "unrelated", None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", type=Path, default=GRAPH)
    ap.add_argument("--out", type=Path, default=Path("data/processed/graph/alignment.json"))
    ap.add_argument("--books", help="comma-separated book ids; default is every pair "
                                    "sharing a domain")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true", help="count requests and stop")
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text())
    titles = book_titles(graph)
    by_book = concepts_by_book(graph)
    domains = {b: (nodes[0].get("domain") or "?") for b, nodes in by_book.items() if nodes}

    wanted = args.books.split(",") if args.books else sorted(by_book)
    # Blocking by domain is what keeps cardinality sane and accuracy up: asking
    # whether a complex-analysis section matches a group-theory one is spending
    # money to be told no.
    pairs = [(a, b) for a in wanted for b in wanted
             if a != b and domains.get(a) == domains.get(b) and by_book[a] and by_book[b]]

    total = sum(len(by_book[a]) for a, _ in pairs)
    print(f"{len(pairs)} ordered book pairs sharing a domain; {total} pass-1 requests "
          f"({sum(len(by_book[a]) * len(by_book[b]) for a, b in pairs):,} concept pairs covered)")
    for a, b in pairs:
        print(f"  {a:18s} -> {b:18s} [{domains[a]}]  "
              f"{len(by_book[a])} x {len(by_book[b])}")
        if len(by_book[b]) + 1 > MAX_OPTIONS:
            sys.exit(f"{b} has {len(by_book[b])} concepts, over the {MAX_OPTIONS} option ceiling "
                     "— block it further before running")
    if args.dry_run:
        return

    proposals, tokens = [], 0
    t0 = time.time()
    for src_book, dst_book in pairs:
        dst_nodes = by_book[dst_book]
        by_label = {n["label"]: n for n in dst_nodes}
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            first = list(ex.map(
                lambda s: pass1(s, src_book, dst_book, dst_nodes, titles), by_book[src_book]))

        middle = []
        for r in first:
            if not r:
                continue
            tokens += r["tokens"]
            if r["choice"] == NO_MATCH or r["is_core"] < 0.5:
                continue
            dst = by_label.get(r["choice"])
            if not dst:
                continue
            if r["confidence"] < LOW:
                continue                      # too unsure to be worth confirming
            middle.append((r, dst))

        # Pass 2 needs pass 1's answer in its state, which is why it cannot be
        # folded into the same request.
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            second = list(ex.map(
                lambda rd: pass2(rd[0]["src"], rd[1], src_book, dst_book, titles), middle))

        for (r, dst), conf in zip(middle, second):
            if not conf:
                continue
            tokens += conf["tokens"]
            kind, direction = classify(conf["same"], conf["a_prereq_b"], conf["b_prereq_a"])
            # Nothing is dropped here. A pair that pass 1 proposed and pass 2
            # rated is evidence either way, and discarding the negatives would
            # make it impossible to move a threshold later without paying again.
            proposals.append({
                "type": kind,
                "direction": direction,
                "src": r["src"]["id"], "src_label": r["src"]["label"], "src_book": src_book,
                "dst": dst["id"], "dst_label": dst["label"], "dst_book": dst_book,
                "domain": domains[src_book],
                "choice_confidence": round(r["confidence"], 3),
                "same": round(conf["same"], 3),
                "a_prereq_b": round(conf["a_prereq_b"], 3),
                "b_prereq_a": round(conf["b_prereq_a"], 3),
                "relation": round(conf["relation"], 3),
                # Everything at or above HIGH on both passes can land without a
                # human; the rest is a review queue, and saying which is which is
                # the whole point of keeping this out of the graph.
                "tier": tier_of(r["confidence"], conf["same"]),
            })

    wall = time.time() - t0
    counts = defaultdict(int)
    for p in proposals:
        counts[(p["type"], p["tier"])] += 1
    # The distribution is the point: it is what a threshold should be read off,
    # and it is cheap to print.
    sames = sorted(p["same"] for p in proposals)
    if sames:
        q = lambda f: sames[min(len(sames) - 1, int(f * len(sames)))]   # noqa: E731
        print(f"\n`same` distribution over {len(sames)} evaluated pairs: "
              f"min {sames[0]:.2f} p25 {q(.25):.2f} p50 {q(.5):.2f} "
              f"p75 {q(.75):.2f} max {sames[-1]:.2f}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": MODEL,
        "thresholds": {"high": HIGH, "low": LOW, "same_at": SAME_AT,
                       "prereq_at": PREREQ_AT, "not_prereq_at": NOT_PREREQ_AT},
        "input_tokens": tokens,
        "proposals": proposals,
    }, indent=1))

    print(f"\n{len(proposals)} proposals in {wall:.0f}s · {tokens:,} input tokens "
          f"· ${tokens / 1e6 * 0.042:.3f}")
    for (kind, tier), n in sorted(counts.items()):
        print(f"  {kind:14s} {tier:8s} {n}")
    print(f"\nwritten to {args.out}")
    print("Nothing is in the graph yet. Review the `review` tier, then merge the "
          "`accept` tier into build_math_graph.py.")


if __name__ == "__main__":
    main()
