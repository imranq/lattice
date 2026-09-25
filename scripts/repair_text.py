#!/usr/bin/env python3
"""Re-read badly extracted exercises from the page image, as LaTeX.

`pdftotext` loses mathematics. A displayed formula comes back as "4+orgge+.. tn2—
eters", and OCR'd scans are worse. The pipeline already measures this per
exercise (`garble`), and until now measured it and did nothing.

This closes that loop: take the worst exercises, render the page they sit on,
and ask a vision model to transcribe *that exercise* as LaTeX. Results are
written back into the local text store, so the app picks them up with no rebuild.

Work is grouped by page — a page holding eight bad exercises costs one call, not
eight — and every repair is recorded, so a re-run only does what is left.

    python3 scripts/repair_text_gemini.py --dry-run
    python3 scripts/repair_text_gemini.py --book andrews --limit 20
    python3 scripts/repair_text_gemini.py --threshold 0.25

Needs GOOGLE_API_KEY, and PyMuPDF for page rendering.
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

GEMINI_URL = ("https://generativelanguage.googleapis.com/v1beta/models/"
              "{model}:generateContent?key={key}")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

# Either vision model does this well; which one is available is an account
# question, not a technical one, so both are supported and the default follows
# whichever key is actually set.
PROVIDERS = {
    "gemini": {"env": "GOOGLE_API_KEY", "model": "gemini-2.5-flash"},
    "openai": {"env": "OPENAI_API_KEY", "model": "gpt-4.1-mini"},
}

GRAPH = Path("data/processed/graph/math.json")
BOOKS = Path("data/processed/books")
LOCAL = Path("data/local")

# 150 dpi: enough for a vision model to read set subscripts, small enough that a
# page stays well under the inline-image limit.
RENDER_DPI = 150

PROMPT = """You are transcribing exercises from a mathematics textbook page.

Below is an image of one page. Transcribe ONLY the exercises listed under
"WANTED" — ignore all body text, proofs, examples and other exercises.

Rules:
- Reproduce the exercise statement verbatim, as LaTeX.
- Inline mathematics in $...$, displayed mathematics in $$...$$.
- Keep multi-part items as (a), (b), (c) on separate lines.
- Do NOT include the exercise number itself, the answer, or any commentary.
- If an exercise is not visible on this page, or is cut off, use null.

WANTED (exercise numbers as printed): {labels}

Return ONLY a JSON object mapping each wanted number to its LaTeX statement or
null, like: {{"6.7": "Let $a,b>0$...", "6.8": null}}
"""


# ---- model call ------------------------------------------------------------

def _post(req, retries, label):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read())
        except (urllib.error.HTTPError, urllib.error.URLError) as err:
            code = getattr(err, "code", None)
            detail = ""
            if isinstance(err, urllib.error.HTTPError):
                try: detail = err.read()[:200].decode()
                except Exception: pass
            # Rate limits and transient 5xx are worth waiting out; a rejected
            # request will be rejected again however long we wait.
            if attempt == retries - 1 or (code and code not in (429, 500, 502, 503)):
                print(f"    ! {label}: {code or type(err).__name__} {detail[:140]}")
                return None
            time.sleep(2 ** attempt)
    return None


def _parse(raw_text):
    if not raw_text:
        return None
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw_text, re.S)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None


def call_model(provider, key, model, prompt, png_bytes, retries=4):
    b64 = base64.b64encode(png_bytes).decode()
    if provider == "gemini":
        body = {
            "contents": [{"role": "user", "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/png", "data": b64}},
            ]}],
            "generationConfig": {"temperature": 0,
                                 "responseMimeType": "application/json"},
        }
        req = urllib.request.Request(
            GEMINI_URL.format(model=model, key=key), data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"})
        data = _post(req, retries, "gemini")
        if not data:
            return None
        try:
            parts = data["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError):
            return None
        return _parse("".join(p.get("text", "") for p in parts))

    body = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url",
             "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"}},
        ]}],
    }
    req = urllib.request.Request(
        OPENAI_URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {key}"})
    data = _post(req, retries, "openai")
    if not data:
        return None
    try:
        return _parse(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError):
        return None


# ---- what needs repair -----------------------------------------------------

# Text that already carries maths as TeX needs nothing from us.
HAS_TEX = re.compile(r"\\\(|\\\[|\$|\\frac|\\sum|\\int|\\sqrt|\\begin\{")

# Signals that a formula was flattened into prose by the text extractor.
#
# This exists because `garble` — which scores how much of the text reads as
# gibberish — cannot see this class of damage at all. "PDF proportional to
# xa−1 (1 − x)b−1" is fluent English with a garble near zero, and the maths in it
# is simply wrong: the exponents were dropped on the floor. Selecting repairs by
# garble alone therefore skipped exactly the exercises whose *statement* had
# changed meaning, while re-reading pages that merely looked ugly.
MATH_LOSS = (
    re.compile(r"[a-zA-Z]\)?[a-z]?[−-]\d"),      # xa−1, )b−1  - a lost exponent
    re.compile(r"[a-zA-Z]\d(?![.)\d])"),          # x2, an     - a lost sub/superscript
    re.compile(r"[−×·≤≥≠∈∑∏∫√]"),                 # maths that survived only as glyphs
    re.compile(r"\b\d+/\d+\b"),                  # a fraction flattened to a slash
)


def math_loss(text):
    """0..1: how much this text looks like maths that lost its notation."""
    if not text or HAS_TEX.search(text):
        return 0.0
    hits = sum(1 for r in MATH_LOSS if r.search(text))
    # One signal is noise — dates and ordinary prose trip a single pattern. Two
    # or more together is a formula that did not survive extraction.
    return 0.0 if hits < 2 else min(1.0, hits / len(MATH_LOSS))


# The tag pass (scripts/tag_exercises_jev.py) reads every exercise and says
# directly whether it is servable, whether its maths survived, and whether it was
# truncated. That is the judgement `garble` and `math_loss` were approximating.
TAGS = LOCAL / "tags.json"


def read_tags():
    try:
        return json.loads(TAGS.read_text())["exercises"]
    except (FileNotFoundError, KeyError):
        return {}


def load_targets(graph, threshold, books_wanted, include_missing, math_threshold=0.5,
                 tags=None, servable_at=0.5):
    """Exercises whose text is garbled, mathematically flattened, or absent.

    With `tags` present this selects on the semantic judgement instead of the two
    regex heuristics. On the 175 OCR'd Andrews exercises the two disagree 42% of
    the time, and the heuristics are wrong in both directions: they pass
    "Prove that\n)\n4+orgge+.. tn2- eters" at garble 0.24 and reject clean
    repaired LaTeX at 0.51, because backslashes and dollar signs read as noise to
    a character-class scorer.

    One class is deliberately *excluded*: an exercise whose figure was never
    extracted (`needs_figure`) cannot be fixed by re-reading the text, so sending
    it for repair spends a vision call to get the same unanswerable problem back.
    """
    groups = defaultdict(list)
    for e in graph["exercises"]:
        book = e.get("book_id")
        if books_wanted and book not in books_wanted:
            continue
        if not e.get("page"):
            continue                       # nothing to render without a page
        text = LOCAL_TEXT.get(book, {}).get(e["id"]) or e.get("text")
        missing = include_missing and not text

        t = (tags or {}).get(e["id"])
        if t is not None:
            # A missing figure is not a text problem. Skip it here and let it be
            # reported separately: it is a reason to drop the exercise, not to
            # re-read the page.
            if t.get("needs_figure", 0) > 0.6:
                continue
            broken = (t.get("servable", 1) < servable_at
                      or t.get("math_intact", 1) < 0.5
                      or t.get("truncated", 0) > 0.6)
            if broken or missing:
                e = dict(e, servable=t.get("servable"), math_intact=t.get("math_intact"),
                         truncated=t.get("truncated"),
                         math_loss=round(math_loss(text), 2))
                groups[(book, e["page"])].append(e)
            continue

        garbled = (e.get("garble") or 0) >= threshold
        flattened = math_loss(text) >= math_threshold
        if garbled or flattened or missing:
            e = dict(e, math_loss=round(math_loss(text), 2))
            groups[(book, e["page"])].append(e)
    return groups


LOCAL_TEXT = {}


def read_local(book):
    path = LOCAL / f"{book}.text.json"
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}


def write_local(book, mapping):
    (LOCAL / f"{book}.text.json").write_text(
        json.dumps(mapping, indent=1, ensure_ascii=False))


def read_log(book):
    try:
        return json.loads((LOCAL / f"{book}.repaired.json").read_text())
    except FileNotFoundError:
        return {}


def write_log(book, log):
    (LOCAL / f"{book}.repaired.json").write_text(
        json.dumps(log, indent=1, ensure_ascii=False))


# ---- page rendering --------------------------------------------------------

def open_pdf(book_id):
    """The book's PDF and the shift from printed page to PDF page index."""
    profile = json.loads((BOOKS / f"{book_id}.json").read_text())
    src = profile.get("source_pdf")
    if not src:
        return None, 0
    path = Path(src).expanduser()
    if not path.exists():
        return None, 0
    import fitz  # PyMuPDF, imported late so --dry-run works without it
    return fitz.open(path), profile.get("pdf_page_offset", 0)


def render(doc, offset, printed_page):
    idx = printed_page + offset - 1          # fitz is 0-based
    if idx < 0 or idx >= doc.page_count:
        return None
    import fitz
    page = doc.load_page(idx)
    return page.get_pixmap(matrix=fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)).tobytes("png")


# ---- main ------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", action="append", dest="books",
                    help="limit to one book id (repeatable)")
    ap.add_argument("--threshold", type=float, default=0.30,
                    help="repair exercises with garble >= this (default 0.30)")
    ap.add_argument("--math-threshold", type=float, default=0.5,
                    help="also repair text that looks like maths stripped of its "
                         "notation, at or above this score (default 0.5; 1.1 disables)")
    ap.add_argument("--include-missing", action="store_true",
                    help="also re-read exercises that have no local text at all")
    ap.add_argument("--limit", type=int, default=0, help="stop after N pages")
    ap.add_argument("--provider", choices=sorted(PROVIDERS), default=None,
                    help="default: whichever provider has a key set")
    ap.add_argument("--model", default=None)
    ap.add_argument("--force", action="store_true",
                    help="redo exercises already repaired")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be repaired, call nothing")
    ap.add_argument("--no-tags", action="store_true",
                    help="ignore data/local/tags.json and select by the garble and "
                         "math_loss heuristics, as before")
    ap.add_argument("--servable-at", type=float, default=0.5,
                    help="repair exercises Jev scores below this for servability "
                         "(default 0.5)")
    args = ap.parse_args()

    graph = json.loads(GRAPH.read_text())
    books_wanted = set(args.books) if args.books else None
    for b in {e["book_id"] for e in graph["exercises"] if e.get("book_id")}:
        LOCAL_TEXT[b] = read_local(b)

    tags = {} if args.no_tags else read_tags()
    if tags:
        print(f"targeting from {TAGS} ({len(tags):,} exercises judged)")
    else:
        print("no tag file — falling back to the garble/math_loss heuristics. "
              "Run scripts/tag_exercises_jev.py for better targeting.")
    groups = load_targets(graph, args.threshold, books_wanted, args.include_missing,
                          args.math_threshold, tags=tags or None,
                          servable_at=args.servable_at)
    logs = {b: read_log(b) for b in {k[0] for k in groups}}
    if not args.force:
        for key in list(groups):
            book = key[0]
            groups[key] = [e for e in groups[key] if e["id"] not in logs.get(book, {})]
            if not groups[key]:
                del groups[key]

    n_ex = sum(len(v) for v in groups.values())
    by_book = defaultdict(int)
    for (book, _), items in groups.items():
        by_book[book] += len(items)
    n_math = sum(1 for items in groups.values() for e in items
                 if e.get("math_loss", 0) >= args.math_threshold
                 and (e.get("garble") or 0) < args.threshold)
    print(f"{n_ex} exercises on {len(groups)} pages need re-reading "
          f"(garble >= {args.threshold}, math loss >= {args.math_threshold}); "
          f"{n_math} of them read cleanly but lost their notation")
    for book, n in sorted(by_book.items(), key=lambda kv: -kv[1]):
        print(f"  {book:<17} {n:>4}")
    if args.dry_run or not n_ex:
        return

    provider = args.provider
    if not provider:
        provider = next((p for p, c in PROVIDERS.items() if os.environ.get(c["env"])), None)
    if not provider:
        raise SystemExit("set GOOGLE_API_KEY or OPENAI_API_KEY")
    key = os.environ.get(PROVIDERS[provider]["env"])
    if not key:
        raise SystemExit(f"{PROVIDERS[provider]['env']} is not set")
    model = args.model or PROVIDERS[provider]["model"]
    print(f"using {provider}/{model}")

    pages = sorted(groups)[: args.limit or None]
    docs, fixed, failed = {}, 0, 0
    for i, (book, printed) in enumerate(pages, 1):
        items = groups[(book, printed)]
        if book not in docs:
            docs[book] = open_pdf(book)
        doc, offset = docs[book]
        if doc is None:
            print(f"[{i}/{len(pages)}] {book} p.{printed} — no local PDF, skipped")
            continue

        png = render(doc, offset, printed)
        if png is None:
            print(f"[{i}/{len(pages)}] {book} p.{printed} — page out of range")
            continue

        labels = [str(e.get("label") or e["id"]) for e in items]
        out = call_model(provider, key, model,
                         PROMPT.format(labels=", ".join(labels)), png)
        if out is None:
            failed += len(items)
            continue

        text_map, log = LOCAL_TEXT[book], logs.setdefault(book, {})
        got = 0
        for e in items:
            label = str(e.get("label") or e["id"])
            latex = out.get(label)
            if not isinstance(latex, str) or not latex.strip():
                continue
            text_map[e["id"]] = latex.strip()
            log[e["id"]] = {
                "model": f"{provider}/{model}",
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "garble_before": e.get("garble"),
                "page": printed,
            }
            got += 1
        fixed += got
        write_local(book, text_map)
        write_log(book, log)
        print(f"[{i}/{len(pages)}] {book} p.{printed} — {got}/{len(items)} re-read")

    print(f"\n{fixed} exercises repaired, {failed} failed.")
    print("The app reads data/local/*.text.json directly — just reload.")


if __name__ == "__main__":
    main()
