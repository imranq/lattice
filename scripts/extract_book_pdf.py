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
            title = norm_title(title)
            if "." in num:
                sections.append({"number": num, "title": title, "page": page,
                                 "chapter": int(num.split(".")[0])})

        # Chapter lines carry no dot leaders, just a wide gap before the page.
        for line in lines:
            m = RE_TOC_CHAPTER.match(line)
            if m:
                chapters.setdefault(int(m.group(1)),
                                    {"chapter": int(m.group(1)),
                                     "title": norm_title(m.group(2)),
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
        for raw in pg.split("\n"):
            # This layout mixes indentation with dot leaders; collapse the leaders
            # so the same "wide gap" rule works for both halves of the line.
            line = re.sub(r"(?:\.\s*){3,}", "   ", raw)
            m = RE_CH.match(line)
            if m:
                cur = int(m.group(1))
                chapters[cur] = {"chapter": cur,
                                 "title": norm_title(m.group(2)),
                                 "page": int(m.group(3))}
                continue
            m = RE_SEC.match(line)
            if m and cur is not None:
                sections.append({"number": f"{cur}.{m.group(1)}",
                                 "title": norm_title(m.group(2)),
                                 "page": int(m.group(3)), "chapter": cur})
    return chapters, sorted(sections, key=lambda s: s["page"])


def parse_toc_chapter_line(pages, scan=16):
    """A table of contents that puts "Chapter 3" on its own line with the title
    beneath it, and lists unnumbered sections under that (Axler)."""
    RE_CH = re.compile(r"^\s*Chapter\s+(\d{1,2})\s*$")
    RE_TITLE = re.compile(r"^\s*(\S.*?)\s{2,}(\d+)\s*$")
    RE_SEC = re.compile(r"^\s+(\S.*?)\s*(?:\.\s*){3,}(\d+)\s*$")
    chapters, sections, pending, cur = {}, [], None, None
    for pg in pages[:scan]:
        for line in pg.split("\n"):
            m = RE_CH.match(line)
            if m:
                pending = int(m.group(1))
                continue
            if pending is not None:
                t = RE_TITLE.match(line)
                if t:
                    cur = pending
                    chapters[cur] = {"chapter": cur, "title": norm_title(t.group(1)),
                                     "page": int(t.group(2))}
                    pending = None
                continue
            m = RE_SEC.match(line)
            if m and cur is not None:
                sections.append({"number": f"{cur}.{len([s for s in sections if s['chapter'] == cur]) + 1}",
                                 "title": norm_title(m.group(1)),
                                 "page": int(m.group(2)), "chapter": cur})
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


# pdftotext preserves typographic ligatures, so "Inﬁnite" and "Diﬀerentiation"
# arrive with single glyphs that break search and look wrong everywhere.
LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi",
             "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st"}


def norm_title(t):
    t = re.sub(r"\s+", " ", (t or "")).strip()
    for lig, plain in LIGATURES.items():
        t = t.replace(lig, plain)
    return t


def clean(text):
    text = text.replace("\x01", "").replace("\x00", "")
    for lig, plain in LIGATURES.items():
        text = text.replace(lig, plain)
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
    ap.add_argument("--item-style", choices=["block", "inline", "labelled"], default="block",
                    help="block: item number alone on a line (Blitzstein). "
                         "inline: '12. text' after a Problems/Exercises heading.")
    ap.add_argument("--heads",
                    # A leading number covers books that head sections "4 Exercises".
                    default=r"^\d{0,2}\s*(Easier Problems|Middle-Level Problems|"
                            r"Harder Problems|Very Hard Problems|Supplementary Problems|"
                            r"Problems|Exercises)$")
    ap.add_argument("--toc-style", choices=["leaders", "indent", "chapter-line"],
                    default="leaders")
    ap.add_argument("--text-out", default=None,
                    help="verbatim exercise text (kept local; gitignored)")
    args = ap.parse_args()

    pdf = Path(args.pdf).expanduser()
    if args.item_style == "labelled":
        chapters, sections, exercises = extract_labelled(pdf, args.book_id,
                                                         toc_style=args.toc_style)
    elif args.item_style == "inline":
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

# Some books put the item text on the same line as its number ("12. Prove that…"),
# others put the number alone and start the text after a blank line. Accept both.
RE_ITEM_INLINE = re.compile(r"^\s*(\d{1,3})[.)](?:\s+(\S.*))?\s*$")

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
                          else parse_toc_chapter_line(layout) if toc_style == "chapter-line"
                          else parse_toc(layout))
    offset = page_offset(pages)
    heads = re.compile(head_re, re.I)

    # Fallback when the table of contents yields no chapters: many books print
    # "Chapter 2" and the chapter title as a running head on every page, which is
    # a more reliable source than reverse-engineering another TOC layout.
    running = {}
    if not chapters:
        RE_RUN = re.compile(r"^\s*Chapter\s+(\d{1,2})\s*$")
        for idx, pg in enumerate(pages):
            lines = [l.strip() for l in pg.split("\n")]
            for i, l in enumerate(lines):
                m = RE_RUN.match(l)
                if not m:
                    continue
                ch = int(m.group(1))
                title = next((t for t in lines[max(0, i - 3):i]
                              if t and not t.isdigit() and len(t) > 3), None)
                running[idx - offset] = ch
                if ch not in chapters and title:
                    chapters[ch] = {"chapter": ch, "title": norm_title(title),
                                    "page": idx - offset}
                break
        if running:
            # Carry the last seen chapter forward across pages with no running head.
            last = None
            for printed in range(min(running), max(running) + 1):
                if printed in running:
                    last = running[printed]
                elif last is not None:
                    running[printed] = last

    def chapter_for(printed):
        return running.get(printed)

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
    # Skip the front matter: a table of contents is full of "Exercises" lines that
    # would otherwise register as problem blocks.
    first_page = min((c["page"] for c in chapters.values()), default=1)

    for idx, pg in enumerate(pages):
        printed = idx - offset
        if printed < first_page:
            continue
        lines = pg.split("\n")
        body = lines[1:] if RE_PAGENO.match(lines[0] or "") else lines
        saw = False

        for line in body:
            h = heads.match(line.strip())
            if h:
                group = line.strip()
                # Deliberately does NOT reset the counter. Several books repeat the
                # section title as a running head on every continuation page, and
                # resetting there rejects every item after the first page break
                # (Pugh silently lost 70% of its exercises this way). A genuine new
                # block is recognised instead by its item numbering restarting at 1.
                saw = True
                continue

            m = RE_ITEM_INLINE.match(line)
            n_item = int(m.group(1)) if m else None
            if m and group and (expected <= n_item <= expected + 3 or n_item == 1):
                if cur:
                    exercises.append(cur)
                n = n_item
                expected = n + 1
                sec = section_for(printed)
                cur = {"number": n, "group": group, "page": printed,
                       "section": sec["number"] if sec else None,
                       "section_title": sec["title"] if sec else None,
                       "chapter": sec["chapter"] if sec else chapter_for(printed),
                       "lines": [m.group(2) or ""]}
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




# ---------------------------------------------------------------------------
# Labelled profile: books that number every exercise in the running text, e.g.
# Tao's "Exercise 2.2.1. Prove Proposition 2.2.5." The label carries chapter,
# section and number, so this needs neither a heading anchor nor a sequence
# guard - the most reliable of the three profiles when a book supports it.
# ---------------------------------------------------------------------------

RE_LABELLED = re.compile(r"^\s*Exercise\s+(\d+)\.(\d+)(?:\.(\d+))?\.?\s*(.*)$")


def extract_labelled(pdf, book_id, toc_style="leaders"):
    pages = pdf_pages(pdf)
    layout = pdf_pages(pdf, layout=True)
    chapters, sections = (parse_toc_indent(layout) if toc_style == "indent"
                          else parse_toc(layout))
    offset = page_offset(pages)
    sec_titles = {s["number"]: s["title"] for s in sections}

    found, cur = [], None
    for idx, pg in enumerate(pages):
        printed = idx - offset
        lines = pg.split("\n")
        body = lines[1:] if RE_PAGENO.match(lines[0] or "") else lines
        for line in body:
            m = RE_LABELLED.match(line)
            # A cross-reference ("see Exercise 6.2.4 for an answer") appears
            # mid-sentence; a real exercise starts the line.
            if m and m.group(3):
                if cur:
                    found.append(cur)
                ch, sec, num = int(m.group(1)), int(m.group(2)), int(m.group(3))
                cur = {"chapter": ch, "section": f"{ch}.{sec}", "number": num,
                       "page": printed, "lines": [m.group(4)]}
            elif cur is not None:
                cur["lines"].append(line)
    if cur:
        found.append(cur)

    out = []
    for e in found:
        text = clean("\n".join(e["lines"]))
        if len(text) < 12:
            continue
        out.append({
            "id": f"{book_id}:{e['section']}.{e['number']}",
            "book_id": book_id, "chapter": e["chapter"], "number": e["number"],
            "section": e["section"], "section_title": sec_titles.get(e["section"]),
            "group": None, "page": e["page"], "tier_hint": None,
            "has_multipart": bool(re.search(r"\(a\)", text)),
            "n_chars": len(text), "text": text,
        })
    return chapters, sections, out


if __name__ == "__main__":
    main()
