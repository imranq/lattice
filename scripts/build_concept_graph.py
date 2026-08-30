#!/usr/bin/env python3
"""Build a concept graph from extracted textbook structure.

Nodes
  domain   - one per chapter
  concept  - one per section (textbook section granularity)
  term     - fine-grained, harvested from \index{} entries

Edges (each carries evidence + confidence; multiple evidences combine noisy-OR)
  contains            domain -> concept, domain -> term
  prerequisite        concept -> concept
  assessed_by         concept -> exercise
  introduces          concept -> term
  uses                concept -> term

Prerequisite evidence
  textbook_order   adjacent sections / chapter ordering        (weak prior, 0.40)
  cross_reference  a \ref{} pointing back to an earlier section (strong,     0.85)
  term_reuse       a term introduced earlier, used here         (medium,     0.55)
"""
import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

CONF = {"textbook_order": 0.40, "cross_reference": 0.85, "term_reuse": 0.55}

# Label kinds whose numbering is chapter.section.* and can be resolved to a section.
SECTION_KINDS = {"sec", "exer"}
# Theorem-like counters reset per chapter, so they resolve only to a chapter.
CHAPTER_KINDS = {"thm", "defn", "lem", "cor", "prop", "chp", "examp", "eq"}

RE_LABEL_PARTS = re.compile(r"^\s*([a-zA-Z]+)[\s:]*([\d.]+)")

STOP_TERMS = {"probability", "problem", "problems", "theorem", "example", "exercise"}

# Non-mathematical subsection headings that carry no concept.
STOP_SUBSECTIONS = {"historical remarks", "examples", "example", "exercises", "notes",
                    "references", "summary", "introduction", "properties", "problems"}

# The index contains many person entries ("de moivre, a.", "vos savant, m.").
RE_PERSON = re.compile(r"^[^,]+,\s*[a-z]\.?$")


def is_person(term: str) -> bool:
    return bool(RE_PERSON.match(term))


def parse_ref(ref: str):
    """'exer 1.2.16' -> ('sec 1.2', 1); 'thm 11.1' -> (None, 11). Returns (section_label, chapter)."""
    m = RE_LABEL_PARTS.match(ref.replace("_", " "))
    if not m:
        return None, None
    kind, nums = m.group(1).lower(), [p for p in m.group(2).split(".") if p != ""]
    if not nums or not nums[0].isdigit():
        return None, None
    chapter = int(nums[0])
    if kind in SECTION_KINDS and len(nums) >= 2:
        return f"sec {nums[0]}.{nums[1]}", chapter
    if kind in CHAPTER_KINDS or kind in SECTION_KINDS:
        return None, chapter
    return None, None


def norm_term(parts):
    """['distribution', 'binomial'] -> 'distribution: binomial' (canonical, lowercased)."""
    parts = [re.sub(r"\s+", " ", p.strip().lower()) for p in parts]
    parts = [p for p in parts if p and len(p) > 2]
    return ": ".join(parts[:2]) if parts else None


def difficulty_prior(e):
    """0..1 within-section difficulty prior from position, starring, and shape."""
    s = 0.30 * e["ordinal_frac"]
    if e["starred"]:
        s += 0.35
    if e["has_multipart"]:
        s += 0.10
    s += min(e["n_chars"] / 1200.0, 1.0) * 0.15
    if e["refs"]:
        s += 0.10
    return round(min(s, 1.0), 3)


def tier(score):
    return "W1" if score < 0.35 else ("W2" if score < 0.62 else "core")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--books", nargs="+", required=True)
    ap.add_argument("--domain", default="probability")
    ap.add_argument("--min-term-count", type=int, default=2)
    ap.add_argument("--out", default="data/processed/graph/probability.json")
    args = ap.parse_args()

    nodes, edges = {}, []
    exercises_out = []

    def add_node(nid, **kw):
        nodes.setdefault(nid, {"id": nid, **kw})
        return nodes[nid]

    def add_edge(src, dst, etype, evidence, conf, **extra):
        edges.append({"src": src, "dst": dst, "type": etype,
                      "evidence": evidence, "confidence": conf, **extra})

    for book_path in args.books:
        book = json.loads(Path(book_path).read_text())
        bid = book["book_id"]
        section_order = {}   # section_label -> global order
        sec_of_chapter = defaultdict(list)
        order = 0

        for ch in book["chapters"]:
            cid = f"domain:{bid}:ch{ch['chapter']}"
            add_node(cid, kind="domain", label=ch["title"], book_id=bid,
                     chapter=ch["chapter"], domain=args.domain)
            for sec in ch["sections"]:
                order += 1
                sid = f"concept:{bid}:{sec['label'].replace(' ', '_')}"
                section_order[sec["label"]] = (order, sid)
                sec_of_chapter[ch["chapter"]].append((order, sid))
                add_node(sid, kind="concept", label=sec["title"], book_id=bid,
                         chapter=ch["chapter"], section_label=sec["label"],
                         subsections=sec["subsections"], order=order,
                         n_exercises=sec["n_exercises"], domain=args.domain,
                         source={"book": bid, "section": sec["label"]})
                add_edge(cid, sid, "contains", "textbook_structure", 1.0)
                for k, sub in enumerate(sec["subsections"], start=1):
                    if sub.strip().lower() in STOP_SUBSECTIONS:
                        continue
                    subid = (f"subconcept:{bid}:{sec['label'].replace(' ', '_')}:"
                             f"{re.sub(r'[^a-z0-9]+', '_', sub.lower()).strip('_')}")
                    add_node(subid, kind="subconcept", label=sub.strip(), book_id=bid,
                             chapter=ch["chapter"], parent=sid, order_in_section=k,
                             domain=args.domain)
                    add_edge(sid, subid, "contains", "textbook_structure", 1.0)

        # ---- prerequisite: textbook order (weak prior) ----
        ordered = sorted((o, s) for o, s in section_order.values())
        for (o1, s1), (o2, s2) in zip(ordered, ordered[1:]):
            add_edge(s1, s2, "prerequisite", "textbook_order", CONF["textbook_order"],
                     cognitive=True)

        # ---- terms ----
        term_first = {}          # term -> (order, section_id)
        term_count = Counter()
        term_sections = defaultdict(set)
        exercise_terms = defaultdict(list)
        for e in book["exercises"]:
            exercise_terms[e["section_label"]].extend(e["index_terms"])
        for ch in book["chapters"]:
            for sec in ch["sections"]:
                o, sid = section_order[sec["label"]]
                for parts in sec["index_terms"] + exercise_terms[sec["label"]]:
                    t = norm_term(parts)
                    if not t or t in STOP_TERMS or is_person(t):
                        continue
                    term_count[t] += 1
                    term_sections[t].add(sid)
                    if t not in term_first or o < term_first[t][0]:
                        term_first[t] = (o, sid)

        for t, c in term_count.items():
            if c < args.min_term_count:
                continue
            tid = f"term:{args.domain}:{re.sub(r'[^a-z0-9]+', '_', t).strip('_')}"
            o_first, sid_first = term_first[t]
            add_node(tid, kind="term", label=t, count=c, domain=args.domain,
                     introduced_in=sid_first)
            add_edge(sid_first, tid, "introduces", "textbook_structure", 0.9)
            for sid in term_sections[t]:
                if sid == sid_first:
                    continue
                add_edge(sid, tid, "uses", "textbook_structure", 0.7)
                add_edge(sid_first, sid, "prerequisite", "term_reuse",
                         CONF["term_reuse"], via=t, cognitive=True)

        # ---- exercises + cross-reference prerequisites ----
        for e in book["exercises"]:
            o, sid = section_order.get(e["section_label"], (None, None))
            if sid is None:
                continue
            score = difficulty_prior(e)
            exercises_out.append({
                "id": e["id"], "concept_id": sid, "book_id": bid,
                "label": e["label"], "section_label": e["section_label"],
                "section_title": e["section_title"], "chapter": e["chapter"],
                "ordinal": e["ordinal"], "starred": e["starred"],
                "difficulty_prior": score, "tier": tier(score),
                "has_multipart": e["has_multipart"], "n_chars": e["n_chars"],
                "text": e["text"], "tex": e["tex"], "refs": e["refs"],
            })
            add_edge(sid, e["id"], "assessed_by", "textbook_structure", 1.0)
            for ref in e["refs"]:
                rsec, rchap = parse_ref(ref)
                target = section_order.get(rsec, (None, None))[1] if rsec else None
                if target and target != sid and section_order[rsec][0] < o:
                    add_edge(target, sid, "prerequisite", "cross_reference",
                             CONF["cross_reference"], via=ref, cognitive=True)

        # prose cross-references
        for ch in book["chapters"]:
            for sec in ch["sections"]:
                o, sid = section_order[sec["label"]]
                for ref in sec["refs"]:
                    rsec, _ = parse_ref(ref)
                    if rsec and rsec in section_order and section_order[rsec][0] < o:
                        add_edge(section_order[rsec][1], sid, "prerequisite",
                                 "cross_reference", CONF["cross_reference"],
                                 via=ref, cognitive=True)

    # ---- merge duplicate edges with noisy-OR over distinct evidence ----
    merged = {}
    for e in edges:
        key = (e["src"], e["dst"], e["type"])
        m = merged.setdefault(key, {"src": e["src"], "dst": e["dst"], "type": e["type"],
                                    "evidence": {}, "cognitive": e.get("cognitive", False)})
        ev = m["evidence"].setdefault(e["evidence"], {"confidence": e["confidence"], "count": 0, "via": []})
        ev["count"] += 1
        if e.get("via") and len(ev["via"]) < 8:
            ev["via"].append(e["via"])
    final_edges = []
    for m in merged.values():
        p = 1.0
        for ev in m["evidence"].values():
            p *= (1 - ev["confidence"])
        m["confidence"] = round(1 - p, 3)
        m["evidence_types"] = sorted(m["evidence"])
        final_edges.append(m)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"domain": args.domain, "nodes": list(nodes.values()),
               "edges": final_edges, "exercises": exercises_out}
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False))

    kinds = Counter(n["kind"] for n in nodes.values())
    etypes = Counter(e["type"] for e in final_edges)
    prereq = [e for e in final_edges if e["type"] == "prerequisite"]
    print(f"nodes: {dict(kinds)}  total {len(nodes)}")
    print(f"edges: {dict(etypes)}  total {len(final_edges)}")
    print(f"prerequisite edges by evidence mix: "
          f"{Counter('+'.join(e['evidence_types']) for e in prereq).most_common()}")
    print(f"exercises: {len(exercises_out)}  tiers {dict(Counter(e['tier'] for e in exercises_out))}")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
