#!/usr/bin/env python3
"""Attach labeled Putnam problems to concept-graph nodes, then build warm-up ladders.

Matching is lexical and deliberately conservative: a Putnam problem's existing
`concepts` / `prerequisites` / `techniques` / `keywords` strings are scored against
node labels (concept, subconcept, term). Everything below --min-score goes to a
review queue rather than being force-matched.

A ladder for problem P = the easiest exercises (by difficulty_prior) drawn from P's
matched concept node and that node's prerequisites, ordered W1 -> W2 -> P.
"""
import argparse
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

STOP = set("the a an of in on for and or to with by is are be as from that this it "
           "basic simple general one two problem problems theory".split())


def tokens(s: str):
    return {w for w in re.findall(r"[a-z]+", s.lower()) if w not in STOP and len(w) > 2}


def singular(ts):
    return {t[:-1] if t.endswith("s") and len(t) > 4 else t for t in ts}


def build_idf(all_node_tokens):
    """Tokens like 'probability' or 'discrete' appear in most labels and must not carry
    the match. Rare tokens ('convolution', 'bayes') are what actually identify a node."""
    df = Counter()
    for ts in all_node_tokens:
        df.update(ts)
    n = max(len(all_node_tokens), 1)
    return {t: math.log(n / (1 + c)) + 0.1 for t, c in df.items()}


def score(problem_tokens, node_tokens, idf, min_matched=2, min_idf=0.9):
    """IDF-weighted coverage of the node label.

    Guardrails against the degenerate matches a plain Jaccard produces:
      - a single shared token only counts if it is genuinely informative
      - one-token generic labels ("Probability") can never match on that token alone
    """
    if not node_tokens:
        return 0.0
    inter = problem_tokens & node_tokens
    if not inter:
        return 0.0
    informative = [t for t in inter if idf.get(t, 0) >= min_idf]
    if len(inter) < min_matched and not informative:
        return 0.0
    num = sum(idf.get(t, 0.1) for t in inter)
    den = sum(idf.get(t, 0.1) for t in node_tokens)
    return num / den if den else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", default="data/processed/graph/probability.json")
    ap.add_argument("--putnam", default="data/processed/problems.labeled.json")
    ap.add_argument("--topics", nargs="+", default=["Probability"])
    ap.add_argument("--min-score", type=float, default=0.45)
    ap.add_argument("--primary-topic-only", action="store_true")
    ap.add_argument("--ladder-size", type=int, default=4)
    ap.add_argument("--out", default="data/processed/graph/probability.linked.json")
    args = ap.parse_args()

    g = json.loads(Path(args.graph).read_text())
    nodes = {n["id"]: n for n in g["nodes"]}
    exercises = g["exercises"]
    by_concept = defaultdict(list)
    for e in exercises:
        by_concept[e["concept_id"]].append(e)
    for v in by_concept.values():
        v.sort(key=lambda e: e["difficulty_prior"])

    # prerequisite adjacency (reverse: node -> its prerequisites)
    prereqs = defaultdict(list)
    for e in g["edges"]:
        if e["type"] == "prerequisite":
            prereqs[e["dst"]].append((e["confidence"], e["src"]))
    for v in prereqs.values():
        v.sort(reverse=True)

    # candidate match targets: concept + subconcept + term nodes
    # `term` nodes are harvested from the book index and include example flavor
    # ("wheaties", "new york yankees"), so they are not safe match targets.
    targets = []
    for n in nodes.values():
        if n["kind"] in ("concept", "subconcept"):
            concept_id = n["id"] if n["kind"] == "concept" else n.get("parent") or n.get("introduced_in")
            if concept_id:
                targets.append((n, singular(tokens(n["label"])), concept_id))

    idf = build_idf([nt for _, nt, _ in targets])

    pb = json.loads(Path(args.putnam).read_text())
    if args.primary_topic_only:
        problems = [p for p in pb["problems"] if p.get("topic") in args.topics]
    else:
        problems = [p for p in pb["problems"] if p.get("topic") in args.topics
                    or any(t in args.topics for t in (p.get("secondary_topics") or []))]

    links, ladders, review = [], [], []
    for p in problems:
        tags = " ".join(
            (p.get("concepts") or []) + (p.get("prerequisites") or [])
            + (p.get("techniques") or []) + (p.get("keywords") or []))
        pt = singular(tokens(tags))
        scored = sorted(((score(pt, nt, idf), n, cid) for n, nt, cid in targets),
                        key=lambda x: -x[0])[:5]
        best = [(s, n, cid) for s, n, cid in scored if s >= args.min_score]
        if not best:
            review.append({"problem_id": p["id"], "topic": p.get("topic"),
                           "best_score": round(scored[0][0], 3) if scored else 0.0,
                           "best_node": scored[0][1]["label"] if scored else None,
                           "tags": tags[:200]})
            continue

        matched = [{"node_id": n["id"], "node_label": n["label"], "kind": n["kind"],
                    "concept_id": cid, "score": round(s, 3)} for s, n, cid in best]
        links.append({"problem_id": p["id"], "topic": p.get("topic"),
                      "difficulty": p.get("difficulty"), "matches": matched})

        # ---- ladder ----
        primary = best[0][2]
        pool = list(by_concept.get(primary, []))
        for _, src in prereqs.get(primary, [])[:2]:
            pool += by_concept.get(src, [])[:2]
        # Prerequisite exercises are merged in, so re-sort: a ladder must ascend.
        pool.sort(key=lambda e: e["difficulty_prior"])
        rungs, seen = [], set()
        for e in pool:
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            rungs.append({"exercise_id": e["id"], "tier": e["tier"],
                          "concept_id": e["concept_id"],
                          "section": e["section_title"], "label": e["label"],
                          "difficulty_prior": e["difficulty_prior"],
                          "starred": e["starred"], "text": e["text"][:400]})
            if len(rungs) >= args.ladder_size:
                break
        if rungs:
            ladders.append({
                "target_problem_id": p["id"],
                "target_concept_id": primary,
                "target_concept": nodes[primary]["label"],
                "match_score": round(best[0][0], 3),
                "rungs": rungs,
                # monotone difficulty is the validator we can actually check now
                "validator_monotone": all(
                    rungs[i]["difficulty_prior"] <= rungs[i + 1]["difficulty_prior"]
                    for i in range(len(rungs) - 1)),
            })

    out = Path(args.out)
    out.write_text(json.dumps({"links": links, "ladders": ladders,
                               "review_queue": review}, indent=1, ensure_ascii=False))
    print(f"putnam problems considered: {len(problems)}")
    print(f"  linked:        {len(links)}  ({len(links)/max(len(problems),1):.0%})")
    print(f"  review queue:  {len(review)}")
    print(f"  ladders built: {len(ladders)}  monotone: "
          f"{sum(l['validator_monotone'] for l in ladders)}")
    print(f"  concepts hit:  {len(Counter(l['target_concept'] for l in ladders))}")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
