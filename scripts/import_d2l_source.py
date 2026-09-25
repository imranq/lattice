#!/usr/bin/env python3
"""Replace D2L PDF text with the book's official Markdown/LaTeX source.

The graph already uses stable PDF-derived ids such as ``d2l:p3@p420``.  This
importer deliberately keeps those ids so attempts, tags, and graph edges do
not move when the source improves.  It matches exercises within their D2L
chapter using normalized prose plus a conservative similarity threshold.

The repository checkout is local and gitignored.  Only the importer and the
source metadata are committed; the verbatim source text remains in
``data/local/d2l.text.json``.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path


# D2L's first book volume has a stable chapter mapping.  The source repo
# also contains appendices and newer chapters; those are intentionally not
# candidates for matching the existing PDF corpus.
CHAPTER_DIRS = {
    1: "chapter_introduction",
    2: "chapter_preliminaries",
    3: "chapter_linear-regression",
    4: "chapter_linear-classification",
    5: "chapter_multilayer-perceptrons",
    6: "chapter_builders-guide",
    7: "chapter_convolutional-neural-networks",
    8: "chapter_convolutional-modern",
    9: "chapter_recurrent-neural-networks",
    10: "chapter_recurrent-modern",
    11: "chapter_attention-mechanisms-and-transformers",
    12: "chapter_optimization",
    13: "chapter_computational-performance",
    14: "chapter_computer-vision",
    15: "chapter_natural-language-processing-pretraining",
    16: "chapter_natural-language-processing-applications",
    17: "chapter_reinforcement-learning",
    18: "chapter_gaussian-processes",
    19: "chapter_hyperparameter-optimization",
    20: "chapter_generative-adversarial-networks",
    21: "chapter_recommender-systems",
}

RE_EXERCISE = re.compile(
    r"(?ms)^\s*\d+\.\s+(.*?)(?=^\s*\d+\.\s+|\Z)"
)
RE_HEADING = re.compile(r"(?m)^#{1,2}\s+|^:begin_tab:")
RE_MARKUP = re.compile(r"```.*?```|!\[[^\]]*\]\([^)]*\)|<[^>]+>", re.S)
RE_TEX_COMMAND = re.compile(r"\\[A-Za-z]+(?:\s*\{([^{}]*)\})?")
RE_TOKEN = re.compile(r"[a-z0-9]+")


def clean_block(text: str) -> str:
    """Normalize Markdown/TeX enough for matching, without changing output."""
    text = RE_MARKUP.sub(" ", text)
    text = re.sub(r"\{[^{}]*\}", " ", text)
    text = RE_TEX_COMMAND.sub(lambda m: " " + (m.group(1) or " "), text)
    text = text.replace("\\", " ")
    text = re.sub(r"[^A-Za-z0-9]+", " ", text).lower()
    return " ".join(RE_TOKEN.findall(text))


def chapter_from_dir(path: Path) -> int | None:
    for number, dirname in CHAPTER_DIRS.items():
        if path.parent.name == dirname:
            return number
    return None


def parse_source(root: Path) -> list[dict]:
    """Extract numbered exercise blocks from the official Markdown files."""
    out = []
    for path in sorted(root.glob("chapter_*/*.md")):
        chapter = chapter_from_dir(path)
        if chapter is None or path.name == "index.md":
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        for section_index, heading in enumerate(
                re.finditer(r"(?m)^##\s+Exercises\s*$", raw, re.I), start=1):
            tail = raw[heading.end():]
            stop = RE_HEADING.search(tail)
            block = tail[:stop.start()] if stop else tail
            for ordinal, match in enumerate(RE_EXERCISE.finditer(block), start=1):
                text = re.sub(r"\n{3,}", "\n\n", match.group(1)).strip()
                if not text:
                    continue
                out.append({
                    "chapter": chapter,
                    "ordinal": ordinal,
                    "text": text,
                    "norm": clean_block(text),
                    "path": str(path.relative_to(root)),
                    "key": f"{path.relative_to(root)}#{section_index}:{ordinal}",
                    "url": "https://github.com/d2l-ai/d2l-en/blob/master/" +
                           str(path.relative_to(root)),
                })
    return out


def old_chapter(exercise: dict) -> int | None:
    group = exercise.get("group") or ""
    m = re.match(r"\s*(\d+)(?:\.\d+)*\s+Exercises", group, re.I)
    return int(m.group(1)) if m else exercise.get("chapter")


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    # Long exercise blocks can contain large code/prose sections.  The first
    # few thousand normalized characters are enough for identity matching and
    # keep the offline import comfortably fast.
    seq = SequenceMatcher(None, a[:6000], b[:6000]).ratio()
    aset, bset = set(a.split()), set(b.split())
    overlap = len(aset & bset) / max(len(aset | bset), 1)
    # Character sequence catches ordering; token overlap tolerates OCR damage.
    return 0.65 * seq + 0.35 * overlap


def best_matches(old: dict, candidates: list[dict]):
    chapter = old_chapter(old)
    pool = [c for c in candidates if c["chapter"] == chapter]
    if not pool:
        return None, 0.0, 0.0
    old_norm = clean_block(old.get("text", ""))
    old_tokens = set(old_norm.split())
    # Token overlap is a cheap index for the candidate set; run the more
    # expensive order-sensitive comparison only on plausible matches.
    shortlist = sorted(
        pool,
        key=lambda c: len(old_tokens & set(c["norm"].split())),
        reverse=True,
    )[:8]
    scored = sorted(((similarity(old_norm, c["norm"]), c)
                     for c in shortlist), reverse=True, key=lambda x: x[0])
    best_score, best = scored[0]
    second = scored[1][0] if len(scored) > 1 else 0.0
    # Short prompts are more collision-prone. Require both a decent score and
    # a margin over the next candidate so we never silently swap questions.
    return best, best_score, second


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path,
                    help="checkout of github.com/d2l-ai/d2l-en")
    ap.add_argument("--book", default=Path("data/processed/books/d2l.json"), type=Path)
    ap.add_argument("--text", default=Path("data/local/d2l.text.json"), type=Path)
    ap.add_argument("--report", default=Path("data/local/d2l.source-report.json"), type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-partial", action="store_true",
                    help="write safe matches even when the source edition differs")
    args = ap.parse_args()

    book = json.loads(args.book.read_text())
    local = json.loads(args.text.read_text())
    source = parse_source(args.source)
    if not source:
        raise SystemExit("No official D2L exercises found")

    old_by_id = {e["id"]: e for e in book["exercises"]}
    # Assign strongest pairs first. Input-order matching lets a vague short
    # prompt steal the exact source block needed by a longer OCR-damaged one.
    proposals = []
    for eid, old in old_by_id.items():
        candidate, score, second = best_matches({**old, "text": local.get(eid, "")}, source)
        proposals.append((score, second, eid, old, candidate))

    used = set()
    replacements, unmatched = {}, []
    scores = []
    for score, second, eid, old, candidate in sorted(
            proposals, reverse=True, key=lambda item: item[0]):
        if candidate is not None and candidate["key"] in used:
            candidate = None
        threshold = 0.43 if candidate and len(candidate["norm"].split()) >= 18 else 0.58
        # Exact normalized matches are safe even when the source intentionally
        # repeats an exercise wording in two sections. For damaged/OCR text,
        # retain the margin guard.
        exact = bool(candidate and score >= 0.97)
        if candidate is None or score < threshold or (not exact and score - second < 0.025):
            unmatched.append({"id": eid, "score": round(score, 3),
                              "next_score": round(second, 3),
                              "chapter": old_chapter(old)})
            continue
        used.add(candidate["key"])
        replacements[eid] = candidate
        scores.append(score)

    report = {
        "source": "github.com/d2l-ai/d2l-en",
        "source_commit": "working checkout; record with git rev-parse HEAD",
        "source_exercises": len(source),
        "existing_exercises": len(old_by_id),
        "matched": len(replacements),
        "unmatched": len(unmatched),
        "median_match": round(sorted(scores)[len(scores) // 2], 3) if scores else 0,
        "min_match": round(min(scores), 3) if scores else 0,
        "unmatched_items": unmatched,
    }
    print(json.dumps(report, indent=2))
    if args.dry_run:
        return
    if len(replacements) < len(old_by_id) * 0.90 and not args.allow_partial:
        raise SystemExit("Refusing to replace text: fewer than 90% matched; inspect --dry-run")

    new_text = dict(local)
    for eid, candidate in replacements.items():
        new_text[eid] = candidate["text"]

    new_book = copy.deepcopy(book)
    new_book["extraction"] = "official_markdown_latex"
    new_book["source_repo"] = "https://github.com/d2l-ai/d2l-en"
    new_book["source_license"] = "CC BY-SA 4.0"
    new_book["source_note"] = (
        "Exercise text replaced from official Markdown source; stable PDF ids retained."
    )
    by_id = {e["id"]: e for e in new_book["exercises"]}
    for eid, candidate in replacements.items():
        by_id[eid]["canonical_source"] = candidate["path"]
        by_id[eid]["canonical_source_ref"] = candidate["key"]
        by_id[eid]["canonical_source_url"] = candidate["url"]
        by_id[eid]["text_format"] = "markdown_latex"

    args.text.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.text.write_text(json.dumps(new_text, indent=1, ensure_ascii=False) + "\n")
    args.book.write_text(json.dumps(new_book, indent=1, ensure_ascii=False) + "\n")
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(replacements)} canonical exercise texts to {args.text}")
    print(f"updated source metadata in {args.book}")


if __name__ == "__main__":
    main()
