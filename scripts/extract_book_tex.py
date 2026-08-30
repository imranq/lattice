#!/usr/bin/env python3
"""Extract structure + exercises from LaTeX-source textbooks.

First target: Grinstead & Snell, *Introduction to Probability* (GFDL), whose
source uses \chapter/\section/\subsection*, an \exercises marker, and \i / \istar
items inside an LJSItem environment. Every exercise carries a \label, which we
use as its canonical id.

Output: data/processed/books/<book_id>.json
"""
import argparse
import json
import os
import re
from pathlib import Path

BRACED = r"\{((?:[^{}]|\{[^{}]*\})*)\}"
# \chapter and \section both take an optional [short title] argument in this source.
RE_CHAPTER = re.compile(r"\\chapter\*?\s*(?:\[[^\]]*\])?\s*" + BRACED + r"\s*(?:\\label\{(.+?)\})?", re.S)
RE_SECTION = re.compile(r"\\section\*?\s*(?:\[[^\]]*\])?\s*" + BRACED + r"\s*(?:\\label\{(.+?)\})?")
RE_SUBSECTION = re.compile(r"\\subsection\*?\s*(?:\[[^\]]*\])?\s*" + BRACED)
RE_INDEX = re.compile(r"\\index\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}")
RE_REF = re.compile(r"\\ref\{(.+?)\}")
RE_LABEL = re.compile(r"\\label\{(.+?)\}")
# \i or \istar at the start of an item, not \it / \item / \index
RE_ITEM_SPLIT = re.compile(r"\\(istar|i)(?![a-zA-Z])")


GREEK = {"alpha": "\u03b1", "beta": "\u03b2", "gamma": "\u03b3", "delta": "\u03b4",
         "epsilon": "\u03b5", "theta": "\u03b8", "lambda": "\u03bb", "mu": "\u03bc",
         "sigma": "\u03c3", "pi": "\u03c0", "rho": "\u03c1", "tau": "\u03c4",
         "phi": "\u03c6", "omega": "\u03c9", "Omega": "\u03a9", "Sigma": "\u03a3",
         "Delta": "\u0394", "Gamma": "\u0393", "Lambda": "\u039b", "Phi": "\u03a6",
         "infty": "\u221e", "cdot": "\u00b7", "times": "\u00d7", "leq": "\u2264",
         "geq": "\u2265", "neq": "\u2260", "cup": "\u222a", "cap": "\u2229",
         "in": "\u2208", "subset": "\u2282", "sum": "\u03a3", "int": "\u222b",
         "to": "\u2192", "ldots": "...", "dots": "...", "cdots": "..."}


def strip_tex(s: str) -> str:
    """Lossy conversion to searchable plain text. The verbatim TeX is kept separately."""
    # Escaped braces are set notation, not grouping - protect them before brace removal.
    s = s.replace("\\{", "\u0001").replace("\\}", "\u0002")
    for name, ch in GREEK.items():
        s = re.sub(r"\\" + name + r"(?![a-zA-Z])", ch, s)
    s = re.sub(r"\\index\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", "", s)
    s = re.sub(r"\\label\{.*?\}", "", s)
    s = re.sub(r"\\(ref|exref)\{(.*?)\}", r"\2", s)
    s = re.sub(r"\\(emx|em|bf|it|mat|mbox|text|textbf|emph)\b\s*", "", s)
    s = re.sub(r"\\begin\{(enumerate|itemize)\}", "", s)
    s = re.sub(r"\\end\{(enumerate|itemize)\}", "", s)
    s = re.sub(r"\\item\b", "\n- ", s)
    s = re.sub(r"---", "\u2014", s)
    s = re.sub(r"\\[a-zA-Z]+\*?", " ", s)
    s = s.replace("{", "").replace("}", "").replace("\\/", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    s = s.replace("\u0001", "{").replace("\u0002", "}")
    return s.strip()


def index_terms(tex: str):
    out = []
    for raw in RE_INDEX.findall(tex):
        # \index{distribution!binomial} -> ["distribution", "binomial"]
        parts = [p.strip() for p in raw.split("!") if p.strip()]
        parts = [re.sub(r"\\[a-zA-Z]+\*?|[{}]", "", p).strip() for p in parts]
        parts = [p for p in parts if p and not p.isupper()]  # drop NAME, X. person index
        if parts:
            out.append(parts)
    return out


def split_sections(chapter_body: str):
    """Yield (title, label, body) per \section."""
    marks = [(m.start(), m.group(1), m.group(2)) for m in RE_SECTION.finditer(chapter_body)]
    for i, (pos, title, label) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(chapter_body)
        body = chapter_body[pos:end]
        yield title.strip(), (label or "").strip(), body


def parse_exercises(section_body: str):
    """Return list of raw exercise TeX blocks from the \exercises region."""
    idx = section_body.find("\\exercises")
    if idx == -1:
        return []
    region = section_body[idx:]
    start = region.find("\\begin{LJSItem}")
    if start == -1:
        return []
    end = region.find("\\end{LJSItem}", start)
    region = region[start + len("\\begin{LJSItem}"):end if end != -1 else len(region)]

    parts = RE_ITEM_SPLIT.split(region)
    # parts = [preamble, kind, body, kind, body, ...]
    items = []
    for i in range(1, len(parts) - 1, 2):
        kind, body = parts[i], parts[i + 1]
        body = body.strip()
        if body:
            items.append((kind == "istar", body))
    return items


def parse_chapter(path: Path, book_id: str):
    tex = path.read_text(encoding="utf-8", errors="replace")
    m = RE_CHAPTER.search(tex)
    if not m:
        return None
    chap_title = m.group(1).strip()
    chap_label = (m.group(2) or "").strip()
    chap_num = None
    n = re.search(r"(\d+)", chap_label or path.stem)
    if n:
        chap_num = int(n.group(1))

    sections = []
    seen_labels = set()
    for order, (title, label, body) in enumerate(split_sections(tex[m.end():]), start=1):
        # Some titles carry their own \label inside the braces:
        #   \section{Gambler's Ruin\label{sec 12.2}}
        inner = RE_LABEL.search(title)
        if inner and not label:
            label = inner.group(1).strip()
        title = RE_LABEL.sub("", title)
        if not label:
            label = f"sec {chap_num}.{order}"
        # ch4/ch5 repeat a section verbatim (discrete/continuous \choice variants).
        if label in seen_labels:
            label = f"{label}#{order}"
        seen_labels.add(label)
        raw_items = parse_exercises(body)
        exercises = []
        for ordinal, (starred, item_tex) in enumerate(raw_items, start=1):
            lab = RE_LABEL.search(item_tex)
            ex_label = lab.group(1).strip() if lab else f"{label}.ex{ordinal}"
            exercises.append({
                "id": f"{book_id}:{ex_label.replace(' ', '_')}",
                "label": ex_label,
                "book_id": book_id,
                "chapter": chap_num,
                "chapter_title": chap_title,
                "section_label": label,
                "section_title": title.strip(),
                "ordinal": ordinal,
                "ordinal_frac": round(ordinal / max(len(raw_items), 1), 3),
                "starred": starred,
                "tex": item_tex.strip(),
                "text": strip_tex(item_tex),
                "index_terms": index_terms(item_tex),
                "refs": sorted(set(RE_REF.findall(item_tex))),
                "has_multipart": "\\item" in item_tex,
                "n_chars": len(strip_tex(item_tex)),
            })
        # Section prose = everything before the \exercises marker
        prose = body.split("\\exercises")[0]
        sections.append({
            "label": label,
            "title": title.strip(),
            "chapter": chap_num,
            "chapter_title": chap_title,
            "order": order,
            "subsections": [s.strip() for s in RE_SUBSECTION.findall(prose)],
            "index_terms": index_terms(prose),
            "refs": sorted(set(RE_REF.findall(prose))),
            "n_exercises": len(exercises),
            "prose_chars": len(prose),
        })
        for e in exercises:
            e["_section_order"] = order
        sections[-1]["exercises"] = exercises
    return {"chapter": chap_num, "title": chap_title, "label": chap_label, "sections": sections}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="directory of .tex chapter files")
    ap.add_argument("--book-id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--authors", default="")
    ap.add_argument("--license", default="")
    ap.add_argument("--source-url", default="")
    ap.add_argument("--glob", default="ch*.tex")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    src = Path(os.path.expanduser(args.src))
    files = sorted(src.glob(args.glob), key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)))

    chapters, exercises = [], []
    for f in files:
        ch = parse_chapter(f, args.book_id)
        if not ch:
            print(f"  skip (no \\chapter): {f.name}")
            continue
        for sec in ch["sections"]:
            exercises.extend(sec.pop("exercises"))
        chapters.append(ch)
        n = sum(s["n_exercises"] for s in ch["sections"])
        print(f"  ch{ch['chapter']:>2} {ch['title'][:44]:<44} {len(ch['sections'])} sections, {n} exercises")

    out = Path(args.out or f"data/processed/books/{args.book_id}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "book_id": args.book_id,
        "title": args.title,
        "authors": args.authors,
        "license": args.license,
        "source_url": args.source_url,
        "extraction": "latex_source",
        "n_chapters": len(chapters),
        "n_sections": sum(len(c["sections"]) for c in chapters),
        "n_exercises": len(exercises),
        "chapters": chapters,
        "exercises": exercises,
    }
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False))
    print(f"\n{len(chapters)} chapters, {payload['n_sections']} sections, {len(exercises)} exercises -> {out}")


if __name__ == "__main__":
    main()
