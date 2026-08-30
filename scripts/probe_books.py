#!/usr/bin/env python3
"""Feasibility probe: which textbooks can be extracted, and by what route.

Reports per book: whether a table of contents parses, whether exercise sections are
findable, whether numbered items are detectable, and an OCR-noise estimate. Run this
before writing a per-book extraction profile - it turns "will this work?" into a
measurement instead of a guess.
"""
import re
import subprocess
import sys
from pathlib import Path

RE_TOC = re.compile(r"^\s*(\d+(?:\.\d+)?)\s+(.+?)(?:\.\s*){3,}(\d+)?\s*$")
RE_TOC_CH = re.compile(r"^\s*(\d{1,2})\s+([A-Z][A-Za-z][^.]{3,60}?)\s{2,}(\d+)\s*$")
RE_EX_HEAD = re.compile(r"^\s*(?:\d+(?:\.\d+)?\s+)?(Exercises|Problems|EXERCISES|PROBLEMS)\s*$")
RE_ITEM = re.compile(r"^\s*(\d{1,3})[.)]\s*$")
RE_ITEM_INLINE = re.compile(r"^\s*(\d{1,3})[.)]\s+\S")
# OCR damage: standalone tildes/pipes for arrows, "=1=" for not-equal, stray symbols.
RE_NOISE = re.compile(r"[~|¦]|=1=|\bl\b(?=\s*[A-Z])|[^\x00-\x7F -⏿Ͱ-Ͽ]")


def dump(pdf, layout=False, first=None, last=None):
    cmd = ["pdftotext"] + (["-layout"] if layout else [])
    if first: cmd += ["-f", str(first)]
    if last: cmd += ["-l", str(last)]
    cmd += [str(pdf), "-"]
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    return r.stdout


def probe(pdf: Path):
    n_pages = int(subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True)
                  .stdout.split("Pages:")[1].split()[0])
    toc_txt = dump(pdf, layout=True, first=1, last=min(30, n_pages))
    toc = len([l for l in toc_txt.split("\n") if RE_TOC.match(l) or RE_TOC_CH.match(l)])

    # Sample the middle of the book for body structure.
    lo = max(1, n_pages // 4)
    body = dump(pdf, first=lo, last=min(lo + 60, n_pages))
    lines = body.split("\n")
    heads = sum(1 for l in lines if RE_EX_HEAD.match(l))
    items = sum(1 for l in lines if RE_ITEM.match(l))
    inline = sum(1 for l in lines if RE_ITEM_INLINE.match(l))
    chars = len(body) or 1
    noise = len(RE_NOISE.findall(body)) / chars * 1000
    empty = chars < 2000

    if empty:
        route = "IMAGE-ONLY — needs OCR or a vision pass"
    elif noise > 12:
        route = "OCR-NOISY — vision pass recommended"
    elif toc >= 8 and (items >= 5 or inline >= 10):
        route = "READY — pdf profile should work"
    elif toc >= 8:
        route = "TOC ok, items unclear — needs a profile"
    else:
        route = "TOC unparsed — needs a profile"

    return {"pages": n_pages, "toc": toc, "ex_heads": heads,
            "items": items, "inline": inline, "noise": round(noise, 1), "route": route}


if __name__ == "__main__":
    print(f"{'book':<44}{'pg':>5}{'toc':>5}{'exH':>5}{'item':>6}{'inln':>6}{'noise':>7}  route")
    print("-" * 118)
    for arg in sys.argv[1:]:
        p = Path(arg).expanduser()
        if not p.exists():
            print(f"{p.name[:43]:<44}  MISSING"); continue
        try:
            r = probe(p)
            print(f"{p.name[:43]:<44}{r['pages']:>5}{r['toc']:>5}{r['ex_heads']:>5}"
                  f"{r['items']:>6}{r['inline']:>6}{r['noise']:>7}  {r['route']}")
        except Exception as e:
            print(f"{p.name[:43]:<44}  FAILED: {type(e).__name__} {e}")
