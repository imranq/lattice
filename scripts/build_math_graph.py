#!/usr/bin/env python3
"""Unify every extracted book into one math concept graph.

Ingests both extraction schemas - LaTeX-source books (sections with \index terms
and \ref cross-references) and PDF books (chapter/section/page pointers with topic
groups) - and emits a single graph spanning domains.

    python3 scripts/build_math_graph.py --books data/processed/books/*.json

Node kinds
    domain      a subject area (probability, abstract algebra, analysis)
    book        a source
    concept     a textbook section or chapter-end topic group
    term        fine-grained, from \index{} where available

Edges
    contains, prerequisite, assessed_by, introduces, uses, aligns_with

`aligns_with` is the cross-book edge: two concepts from different books whose
labels agree. It is what makes this one graph rather than three, and it is the
only place a prerequisite can be corroborated by an independent author.
"""
import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

# Which domain each book teaches. Set here rather than guessed from titles.
DOMAINS = {
    "grinstead_snell": "probability",
    "blitzstein": "probability",
    "herstein": "abstract algebra",
    "pugh": "real analysis",
    "tao": "real analysis",
    "axler": "linear algebra",
    "andrews": "number theory",
}

STOP = set("the a an of and or to for in on with by is are as from that this it its "
           "some more less into problems problem exercises exercise section chapter "
           "further other first second".split())

CONF = {"textbook_order": 0.40, "cross_reference": 0.85, "term_reuse": 0.55,
        "cross_book_consensus": 0.75}

TIER_FROM_PRIOR = lambda s: "W1" if s < 0.35 else ("W2" if s < 0.62 else "core")


def tokens(s):
    ts = {w for w in re.findall(r"[a-z]+", (s or "").lower()) if w not in STOP and len(w) > 2}
    return {t[:-1] if t.endswith("s") and len(t) > 4 else t for t in ts}


def difficulty_prior(e, n_in_group):
    """Position within its own problem set, plus whatever the book tells us."""
    if e.get("tier_hint"):                      # Herstein grades its own sets
        return {"W1": 0.25, "W2": 0.5, "core": 0.75}[e["tier_hint"]]
    frac = e.get("ordinal_frac")
    if frac is None:
        frac = (e.get("number", 1) / max(n_in_group, 1))
    s = 0.30 * frac
    if e.get("starred"):
        s += 0.35
    if e.get("has_multipart"):
        s += 0.10
    s += min(e.get("n_chars", 300) / 1200.0, 1.0) * 0.15
    # A published solution signals a canonical, often harder, problem.
    if e.get("has_published_solution"):
        s += 0.05
    return round(min(s, 1.0), 3)


def load_latex_book(book, nodes, edges, exercises, add_node, add_edge):
    """Books extracted from LaTeX source: richest signal (index terms, \ref)."""
    bid = book["book_id"]
    domain = DOMAINS.get(bid, "unknown")
    order, section_ids = 0, {}

    for ch in book["chapters"]:
        cid = f"domain:{domain}:{bid}:ch{ch['chapter']}"
        add_node(cid, kind="domain_part", label=ch["title"], domain=domain, book_id=bid,
                 chapter=ch["chapter"])
        for sec in ch["sections"]:
            order += 1
            sid = f"concept:{bid}:{sec['label'].replace(' ', '_')}"
            section_ids[sec["label"]] = (order, sid)
            add_node(sid, kind="concept", label=sec["title"], domain=domain, book_id=bid,
                     chapter=ch["chapter"], order=order, source={"section": sec["label"]})
            add_edge(cid, sid, "contains", "textbook_structure", 1.0)

    ordered = sorted(section_ids.values())
    for (o1, s1), (o2, s2) in zip(ordered, ordered[1:]):
        add_edge(s1, s2, "prerequisite", "textbook_order", CONF["textbook_order"], cognitive=True)

    for e in book["exercises"]:
        o_sid = section_ids.get(e["section_label"])
        if not o_sid:
            continue
        _, sid = o_sid
        score = difficulty_prior(e, len(book["exercises"]))
        exercises.append({"id": e["id"], "concept_id": sid, "book_id": bid, "domain": domain,
                          "label": e["label"], "chapter": e["chapter"],
                          "section_title": e["section_title"], "page": None,
                          "difficulty_prior": score, "tier": TIER_FROM_PRIOR(score),
                          "starred": e.get("starred", False), "has_text": True,
                          "text": e["text"]})
        add_edge(sid, e["id"], "assessed_by", "textbook_structure", 1.0)
        for ref in e.get("refs", []):
            m = re.match(r"^\s*(sec|exer)[\s:]*(\d+)\.(\d+)", ref.replace("_", " "))
            if not m:
                continue
            target = section_ids.get(f"sec {m.group(2)}.{m.group(3)}")
            if target and target[1] != sid and target[0] < o_sid[0]:
                add_edge(target[1], sid, "prerequisite", "cross_reference",
                         CONF["cross_reference"], via=ref, cognitive=True)


def load_pdf_book(book, nodes, edges, exercises, add_node, add_edge):
    """Books extracted from PDF: chapter/section pointers plus topic groups.

    Verbatim text is deliberately absent here - it lives in data/local/ and is not
    committed - so the graph carries pointers and metadata only.
    """
    bid = book["book_id"]
    domain = DOMAINS.get(bid, "unknown")
    chapters = {c["chapter"]: c for c in book.get("chapters", [])}
    sections = book.get("sections", [])

    for ch in chapters.values():
        add_node(f"domain:{domain}:{bid}:ch{ch['chapter']}", kind="domain_part",
                 label=ch["title"], domain=domain, book_id=bid, chapter=ch["chapter"],
                 page=ch.get("page"))

    sec_ids = {}
    for order, sec in enumerate(sections, start=1):
        sid = f"concept:{bid}:{sec['number']}"
        sec_ids[sec["number"]] = (order, sid)
        add_node(sid, kind="concept", label=sec["title"], domain=domain, book_id=bid,
                 chapter=sec["chapter"], order=order, page=sec["page"],
                 source={"section": sec["number"], "page": sec["page"]})
        cid = f"domain:{domain}:{bid}:ch{sec['chapter']}"
        if cid in nodes:
            add_edge(cid, sid, "contains", "textbook_structure", 1.0)

    ordered = sorted(sec_ids.values())
    for (o1, s1), (o2, s2) in zip(ordered, ordered[1:]):
        add_edge(s1, s2, "prerequisite", "textbook_order", CONF["textbook_order"], cognitive=True)

    # Topic groups ("Counting", "Harder Problems") are concepts in their own right.
    group_sizes = Counter(e.get("group") for e in book["exercises"])
    for e in book["exercises"]:
        concept_id = None
        if e.get("section") and e["section"] in sec_ids:
            concept_id = sec_ids[e["section"]][1]
        group = e.get("group")
        if group and group.lower() not in ("problems", "exercises", "easier problems",
                                           "middle-level problems", "harder problems"):
            gid = f"concept:{bid}:group:{re.sub(r'[^a-z0-9]+', '_', group.lower()).strip('_')}"
            if gid not in nodes:
                add_node(gid, kind="concept", label=group, domain=domain, book_id=bid,
                         chapter=e.get("chapter"), from_group=True)
                parent = f"domain:{domain}:{bid}:ch{e.get('chapter')}"
                if parent in nodes:
                    add_edge(parent, gid, "contains", "textbook_structure", 0.9)
            concept_id = gid
        if not concept_id:
            continue
        score = difficulty_prior(e, group_sizes.get(group, 20))
        exercises.append({
            "id": e["id"], "concept_id": concept_id, "book_id": bid, "domain": domain,
            "label": f"{e.get('chapter')}.{e['number']}", "chapter": e.get("chapter"),
            "section_title": e.get("section_title") or group, "page": e.get("page"),
            "difficulty_prior": score,
            "tier": e.get("tier_hint") or TIER_FROM_PRIOR(score),
            "has_published_solution": e.get("has_published_solution", False),
            "has_text": False,
        })
        add_edge(concept_id, e["id"], "assessed_by", "textbook_structure", 1.0)


def align_across_books(nodes, add_edge, min_overlap=0.5):
    """Same concept, different author. Two books agreeing is the strongest
    evidence available that a concept boundary is real and not one author's
    idiosyncratic chapter split."""
    concepts = [n for n in nodes.values() if n["kind"] == "concept"]
    by_domain = defaultdict(list)
    for c in concepts:
        by_domain[c["domain"]].append((c, tokens(c["label"])))

    aligned = 0
    for domain, items in by_domain.items():
        for i, (a, ta) in enumerate(items):
            if not ta:
                continue
            for b, tb in items[i + 1:]:
                if a["book_id"] == b["book_id"] or not tb:
                    continue
                # Jaccard over the union, not min(): dividing by the shorter label
                # lets a generic two-word title ("Random variables") align with every
                # section that mentions it.
                overlap = len(ta & tb) / len(ta | tb)
                if overlap >= min_overlap:
                    add_edge(a["id"], b["id"], "aligns_with", "cross_book_consensus",
                             round(CONF["cross_book_consensus"] * overlap, 3),
                             via=f"{a['label']} ~ {b['label']}")
                    aligned += 1
    return aligned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--books", nargs="+", required=True)
    ap.add_argument("--out", default="data/processed/graph/math.json")
    args = ap.parse_args()

    nodes, raw_edges, exercises = {}, [], []

    def add_node(nid, **kw):
        nodes.setdefault(nid, {"id": nid, **kw})

    def add_edge(src, dst, etype, evidence, conf, **extra):
        raw_edges.append({"src": src, "dst": dst, "type": etype, "evidence": evidence,
                          "confidence": conf, **extra})

    for path in args.books:
        book = json.loads(Path(path).read_text())
        bid = book["book_id"]
        add_node(f"book:{bid}", kind="book", label=book["title"],
                 authors=book.get("authors", ""), license=book.get("license", ""),
                 domain=DOMAINS.get(bid, "unknown"), extraction=book.get("extraction"))
        before = len(exercises)
        if book.get("extraction") == "latex_source":
            load_latex_book(book, nodes, raw_edges, exercises, add_node, add_edge)
        else:
            load_pdf_book(book, nodes, raw_edges, exercises, add_node, add_edge)
        print(f"  {bid:<18} {book.get('extraction','?'):<14} "
              f"{len(exercises) - before:>4} exercises  ({DOMAINS.get(bid,'unknown')})")

    aligned = align_across_books(nodes, add_edge)

    merged = {}
    for e in raw_edges:
        key = (e["src"], e["dst"], e["type"])
        m = merged.setdefault(key, {"src": e["src"], "dst": e["dst"], "type": e["type"],
                                    "evidence": {}, "cognitive": e.get("cognitive", False)})
        ev = m["evidence"].setdefault(e["evidence"], {"confidence": e["confidence"],
                                                      "count": 0, "via": []})
        ev["count"] += 1
        if e.get("via") and len(ev["via"]) < 6:
            ev["via"].append(e["via"])
    edges = []
    for m in merged.values():
        p = 1.0
        for ev in m["evidence"].values():
            p *= (1 - ev["confidence"])
        m["confidence"] = round(1 - p, 3)
        m["evidence_types"] = sorted(m["evidence"])
        edges.append(m)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"nodes": list(nodes.values()), "edges": edges,
                               "exercises": exercises}, ensure_ascii=False, indent=1))

    print(f"\nnodes {dict(Counter(n['kind'] for n in nodes.values()))}  total {len(nodes)}")
    print(f"edges {dict(Counter(e['type'] for e in edges))}  total {len(edges)}")
    print(f"domains {dict(Counter(n.get('domain') for n in nodes.values() if n['kind']=='concept'))}")
    print(f"exercises {len(exercises)}  tiers {dict(Counter(e['tier'] for e in exercises))}")
    print(f"cross-book alignments: {aligned}")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
