#!/usr/bin/env python3
"""Extract exercises from a born-digital PDF textbook, with page references.

Built for Blitzstein & Hwang, *Introduction to Probability*, whose chapter-end
exercise sections are grouped under topic subheadings ("Counting", "Story proofs")
that give an explicit exercise -> concept mapping the LaTeX books do not.

The book is copyrighted, so this records a POINTER to each exercise - chapter,
section, printed page, item number - alongside derived metadata. Verbatim text is
kept for local use only and is written to a separate file that .gitignore excludes.

    python3 scripts/extract_book_pdf.py --pdf ~/papers/blitzstein.pdf \
        --book-id blitzstein --title "Introduction to Probability"
"""
import argparse
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

# "1.9 Exercises . . . . . . . 40"  /  "3 Random variables ... 103"
# The dot leaders are space-separated, and a long title can push the page number
# onto the following line - so the number is optional here and filled in after.
RE_TOC = re.compile(r"^\s*(\d+(?:\.\d+)?)\s+(.+?)\s*(?:\.\s*){3,}(\d+)?\s*$")
# Back matter: "A Math", "C Table of distributions", "References", "Index".
RE_TOC_BACK = re.compile(r"^\s*(?:[A-Z]|References|Bibliography|Index|Appendix)\b.*?\s{2,}(\d+)\s*$")
RE_TOC_CHAPTER = re.compile(r"^\s*(\d{1,2})\s+([A-Z][A-Za-z][^.]{3,60}?)\s{2,}(\d+)\s*$")
RE_ITEM = re.compile(r"^\s*(\d+)\.\s*$")
RE_PAGENO = re.compile(r"^\s*(\d+)\s*$")


def pdf_pages(pdf: Path, layout=False):
    """Plain text for the body (paragraphs flow properly); -layout for the table of
    contents, where the page-number column is otherwise dropped or split apart."""
    cmd = ["pdftotext"] + (["-layout"] if layout else []) + [str(pdf), "-"]
    out = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if out.returncode != 0:
        raise SystemExit(f"pdftotext failed: {out.stderr[:200]}")
    return out.stdout.split("\f")


def parse_toc(pages, scan=14):
    """Chapters and sections with their printed page numbers."""
    chapters, sections = {}, []
    for pg in pages[:scan]:
        lines = pg.split("\n")
        for i, line in enumerate(lines):
            m = RE_TOC.match(line)
            if not m:
                continue
            page = m.group(3)
            if page is None:
                # Number wrapped: it is alone on one of the next lines.
                for nxt in lines[i + 1:i + 3]:
                    if RE_PAGENO.match(nxt or ""):
                        page = nxt.strip()
                        break
            if page is None:
                continue
            num, title, page = m.group(1), m.group(2).strip(), int(page)
            title = re.sub(r"\s+", " ", title)
            if "." in num:
                sections.append({"number": num, "title": title, "page": page,
                                 "chapter": int(num.split(".")[0])})

        # Chapter lines carry no dot leaders, just a wide gap before the page.
        for line in lines:
            m = RE_TOC_CHAPTER.match(line)
            if m:
                chapters.setdefault(int(m.group(1)),
                                    {"chapter": int(m.group(1)),
                                     "title": re.sub(r"\s+", " ", m.group(2).strip()),
                                     "page": int(m.group(3))})
    return chapters, sorted(sections, key=lambda s: s["page"])


def parse_toc_indent(pages, scan=14):
    """A table of contents that uses indentation instead of dot leaders, and
    numbers sections within each chapter (Herstein): a chapter sits at column 0,
    its sections are indented under it and restart at 1."""
    RE_CH = re.compile(r"^(\d{1,2})\s{2,}(\S.*?)\s{2,}(\d+)\s*$")
    RE_SEC = re.compile(r"^\s{3,}(\d{1,2})\s{2,}(\S.*?)\s{2,}(\d+)\s*$")
    chapters, sections, cur = {}, [], None
    for pg in pages[:scan]:
        for line in pg.split("\n"):
            m = RE_CH.match(line)
            if m:
                cur = int(m.group(1))
                chapters[cur] = {"chapter": cur,
                                 "title": re.sub(r"\s+", " ", m.group(2)).strip(),
                                 "page": int(m.group(3))}
                continue
            m = RE_SEC.match(line)
            if m and cur is not None:
                sections.append({"number": f"{cur}.{m.group(1)}",
                                 "title": re.sub(r"\s+", " ", m.group(2)).strip(),
                                 "page": int(m.group(3)), "chapter": cur})
    return chapters, sorted(sections, key=lambda s: s["page"])


def back_matter_page(pages, last_chapter_page, scan=14):
    """First page of the appendices, so the final chapter's exercises stop there
    instead of running on through the whole back of the book."""
    candidates = []
    for pg in pages[:scan]:
        for line in pg.split("\n"):
            m = RE_TOC_BACK.match(line)
            if m and int(m.group(1)) > last_chapter_page:
                candidates.append(int(m.group(1)))
    return min(candidates) if candidates else None


def page_offset(pages):
    """Physical index -> printed page number. The printed number is the first line
    of each body page; find the shift that makes them agree."""
    votes = {}
    for i, pg in enumerate(pages):
        first = pg.split("\n")[0] if pg else ""
        m = RE_PAGENO.match(first)
        if m:
            votes[i - int(m.group(1))] = votes.get(i - int(m.group(1)), 0) + 1
    return max(votes, key=votes.get) if votes else 0


def clean(text):
    text = text.replace("\x01", "").replace("\x00", "")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# "Exercises" is the section header itself, not a topic group.
HEADING_STOP = {"exercises"}


def is_heading(line, prev_blank):
    """Topic subheadings sit alone between exercises: short, no terminal punctuation."""
    s = line.strip()
    if not s or not prev_blank or len(s) > 52 or s.lower() in HEADING_STOP:
        return False
    if s[0].isdigit() or s[-1] in ".,:;?!)":
        return False
    return bool(re.match(r"^[A-Z][A-Za-z’'()\- /,&]+$", s))


def extract(pdf, book_id):
    pages = pdf_pages(pdf)
    layout = pdf_pages(pdf, layout=True)
    chapters, sections = parse_toc(layout)
    offset = page_offset(pages)
    if not chapters:
        raise SystemExit("could not parse a table of contents")

    # Exercises are the last section of each chapter: they run from that section's
    # page up to the page the next chapter starts on.
    ex_sections = [s for s in sections if s["title"].lower().startswith("exercise")]
    regions = []
    for s in ex_sections:
        nxt = chapters.get(s["chapter"] + 1)
        if nxt:
            end = nxt["page"] - 1
        else:
            back = back_matter_page(layout, s["page"])
            end = (back - 1) if back else (len(pages) - offset - 1)
        regions.append((s["chapter"], s["page"], end))

    exercises = []
    for chapter, first, last in regions:
        group = None
        cur = None
        expected = 1
        for printed in range(first, last + 1):
            idx = printed + offset
            if idx >= len(pages):
                break
            lines = pages[idx].split("\n")
            # Drop the page number and the running head.
            body = lines[1:] if RE_PAGENO.match(lines[0] or "") else lines
            body = [l for l in body if l.strip() not in
                    (chapters[chapter]["title"], "Introduction to Probability")]

            prev_blank = True
            for i, line in enumerate(body):
                m = RE_ITEM.match(line)
                # Exercise numbers run 1..N in order. Anything out of sequence is a
                # year or a list marker inside a problem ("2012."), not a new item.
                if m and not (expected <= int(m.group(1)) <= expected + 3):
                    m = None
                if m:
                    # Allow a small forward jump: a number split across a page break
                    # should not desynchronise the rest of the chapter.
                    expected = int(m.group(1)) + 1
                    if cur:
                        exercises.append(cur)
                    cur = {"number": int(m.group(1)), "chapter": chapter,
                           "group": group, "page": printed, "lines": []}
                elif cur is not None:
                    if is_heading(line, prev_blank) and _looks_like_next_heading(body, i):
                        group = line.strip()
                        exercises.append(cur)
                        cur = None
                    else:
                        cur["lines"].append(line)
                elif is_heading(line, prev_blank):
                    group = line.strip()
                prev_blank = not line.strip()
        if cur:
            exercises.append(cur)

    out = []
    for e in exercises:
        text = clean("\n".join(e["lines"]))
        if not text:
            continue
        # A superscript 's' marks exercises with published solutions; pdftotext
        # renders it as a leading "s " on the first body line.
        has_solution = bool(re.match(r"^s\s", text))
        if has_solution:
            text = re.sub(r"^s\s+", "", text)
        out.append({
            "id": f"{book_id}:{e['chapter']}.{e['number']}",
            "book_id": book_id,
            "chapter": e["chapter"],
            "number": e["number"],
            "group": e["group"],
            "page": e["page"],
            "has_published_solution": has_solution,
            "has_multipart": bool(re.search(r"\(a\)", text)),
            "n_chars": len(text),
            "text": text,
        })
    return chapters, sections, out


def _looks_like_next_heading(body, i):
    """A heading is followed by an item number, not by more prose."""
    for line in body[i + 1:i + 4]:
        if RE_ITEM.match(line):
            return True
        if line.strip():
            return False
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--book-id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--authors", default="")
    ap.add_argument("--out", default=None)
    ap.add_argument("--item-style", choices=["block", "inline"], default="block",
                    help="block: item number alone on a line (Blitzstein). "
                         "inline: '12. text' after a Problems/Exercises heading.")
    ap.add_argument("--heads",
                    default=r"^(Easier Problems|Middle-Level Problems|Harder Problems|"
                            r"Very Hard Problems|Supplementary Problems|Problems|Exercises)$")
    ap.add_argument("--toc-style", choices=["leaders", "indent"], default="leaders")
    ap.add_argument("--text-out", default=None,
                    help="verbatim exercise text (kept local; gitignored)")
    args = ap.parse_args()

    pdf = Path(args.pdf).expanduser()
    if args.item_style == "inline":
        chapters, sections, exercises = extract_inline(
            pdf, args.book_id, args.heads, toc_style=args.toc_style)
    else:
        chapters, sections, exercises = extract(pdf, args.book_id)

    meta_path = Path(args.out or f"data/processed/books/{args.book_id}.json")
    text_path = Path(args.text_out or f"data/local/{args.book_id}.text.json")
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    text_path.parent.mkdir(parents=True, exist_ok=True)

    # Pointers + derived metadata: safe to commit.
    meta = [{k: v for k, v in e.items() if k != "text"} for e in exercises]
    meta_path.write_text(json.dumps({
        "book_id": args.book_id, "title": args.title, "authors": args.authors,
        "source_pdf": str(pdf), "extraction": "pdf_text",
        "license": "copyrighted - pointers and metadata only, personal use",
        "n_chapters": len(chapters), "n_exercises": len(exercises),
        "chapters": list(chapters.values()),
        "sections": sections,
        "exercises": meta,
    }, indent=1, ensure_ascii=False))

    # Verbatim text: local only.
    text_path.write_text(json.dumps(
        {e["id"]: e["text"] for e in exercises}, indent=1, ensure_ascii=False))

    per_ch = Counter(e["chapter"] for e in exercises)
    for ch in sorted(per_ch, key=lambda c: (c is None, c)):
        title = chapters.get(ch, {}).get("title", "(unattributed)")
        print(f"  ch{str(ch):>3} {title[:40]:<40} {per_ch[ch]:>3} exercises")
    solved = sum(e.get("has_published_solution", False) for e in exercises)
    tiers = Counter(e.get("tier_hint") for e in exercises if e.get("tier_hint"))
    print(f"\n{len(exercises)} exercises"
          + (f", {solved} with published solutions" if solved else "")
          + (f", tiers {dict(tiers)}" if tiers else ""))
    print(f"  pointers -> {meta_path}")
    print(f"  text     -> {text_path}  (local only)")




# ---------------------------------------------------------------------------
# Inline profile: books where exercises follow a heading ("Problems",
# "Exercises", "Harder Problems") and each item starts inline on its own line
# as "12. text...". Theorems and worked examples are numbered the same way in
# these books, so the heading - not the numbering - is what anchors a block.
# ---------------------------------------------------------------------------

RE_ITEM_INLINE = re.compile(r"^\s*(\d{1,3})[.)]\s+(\S.*)$")

# Herstein grades its own problem sets; that is a difficulty signal no
# heuristic could reconstruct as reliably.
TIER_BY_HEAD = {
    "easier problems": "W1",
    "problems": "W1",
    "exercises": "W1",
    "middle-level problems": "W2",
    "harder problems": "core",
    "very hard problems": "core",
    "supplementary problems": "W2",
}


def extract_inline(pdf, book_id, head_re, max_gap_pages=2, toc_style="leaders"):
    pages = pdf_pages(pdf)
    layout = pdf_pages(pdf, layout=True)
    chapters, sections = (parse_toc_indent(layout) if toc_style == "indent"
                          else parse_toc(layout))
    offset = page_offset(pages)
    heads = re.compile(head_re, re.I)

    def section_for(printed):
        best = None
        for s in sections:
            if s["page"] <= printed and (best is None or s["page"] >= best["page"]):
                best = s
        return best

    exercises = []
    group = None
    expected = 1
    cur = None
    gap = 0

    for idx, pg in enumerate(pages):
        printed = idx - offset
        if printed < 1:
            continue
        lines = pg.split("\n")
        body = lines[1:] if RE_PAGENO.match(lines[0] or "") else lines
        saw = False

        for line in body:
            h = heads.match(line.strip())
            if h:
                if cur:
                    exercises.append(cur); cur = None
                group = line.strip()
                # A fresh block usually restarts at 1, but some books continue
                # numbering across the tiers of one problem set.
                expected = 1
                saw = True
                continue

            m = RE_ITEM_INLINE.match(line)
            if m and group and expected <= int(m.group(1)) <= expected + 3:
                if cur:
                    exercises.append(cur)
                n = int(m.group(1))
                expected = n + 1
                sec = section_for(printed)
                cur = {"number": n, "group": group, "page": printed,
                       "section": sec["number"] if sec else None,
                       "section_title": sec["title"] if sec else None,
                       "chapter": sec["chapter"] if sec else None,
                       "lines": [m.group(2)]}
                saw = True
            elif cur is not None:
                cur["lines"].append(line)

        # A run of pages with no items means the problem block has ended and we
        # are back in prose; stop attaching paragraphs to the last exercise.
        gap = 0 if saw else gap + 1
        if gap > max_gap_pages and cur:
            exercises.append(cur); cur = None; group = None
    if cur:
        exercises.append(cur)

    out = []
    for e in exercises:
        text = clean("\n".join(e["lines"]))
        if len(text) < 15:
            continue
        head = (e["group"] or "").strip().lower()
        out.append({
            "id": f"{book_id}:{e['chapter'] or 0}.{e['section'] or '0'}.{e['number']}",
            "book_id": book_id, "chapter": e["chapter"], "number": e["number"],
            "section": e["section"], "section_title": e["section_title"],
            "group": e["group"], "page": e["page"],
            "tier_hint": TIER_BY_HEAD.get(head),
            "has_multipart": bool(re.search(r"\(a\)", text)),
            "n_chars": len(text), "text": text,
        })
    return chapters, sections, out


if __name__ == "__main__":
    main()
