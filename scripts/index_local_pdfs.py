#!/usr/bin/env python3
"""Record where each book's PDF lives, and how its printed pages map to PDF pages.

Lattice cites a printed page ("Exercise 6.7, p. 298") because that is what the
book itself says. A PDF viewer counts physical pages, and front matter means the
two never agree. This computes the shift once per book and stores it, so the app
can open the actual page instead of a catalogue search.

    pdf_page (1-based) = printed_page + pdf_page_offset

Run after adding a book, or whenever a source PDF moves:

    python3 scripts/index_local_pdfs.py
    python3 scripts/index_local_pdfs.py --pdf ~/papers/foo.pdf --book-id foo
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_book_pdf import page_offset  # noqa: E402

BOOKS = Path("data/processed/books")


def offset_for(pdf: Path) -> int | None:
    """The shift from printed page number to 1-based PDF page.

    page_offset() votes over 0-based indices into pdftotext's page list; PDF
    viewers and `pdftotext -f` are both 1-based, hence the +1.
    """
    out = subprocess.run(["pdftotext", str(pdf), "-"],
                         capture_output=True, text=True, errors="replace")
    if out.returncode != 0:
        return None
    return page_offset(out.stdout.split("\f")) + 1


def update(path: Path, pdf_override: str | None = None) -> None:
    book = json.loads(path.read_text())
    src = pdf_override or book.get("source_pdf")
    if not src:
        print(f"{book['book_id']:<17} no source PDF (LaTeX source) — skipped")
        return

    pdf = Path(src).expanduser()
    if not pdf.exists():
        # Do not silently keep a stale pointer: a missing file means the app
        # should fall back to the web link, not offer a broken one.
        book.pop("pdf_page_offset", None)
        book["source_pdf_missing"] = True
        path.write_text(json.dumps(book, indent=1, ensure_ascii=False))
        print(f"{book['book_id']:<17} MISSING {pdf}")
        return

    off = offset_for(pdf)
    if off is None:
        print(f"{book['book_id']:<17} pdftotext failed on {pdf}")
        return

    book["source_pdf"] = str(pdf)
    book["pdf_page_offset"] = off
    book.pop("source_pdf_missing", None)
    path.write_text(json.dumps(book, indent=1, ensure_ascii=False))

    sample = next((e for e in book.get("exercises", []) if e.get("page")), None)
    where = (f"  (p.{sample['page']} -> PDF page {sample['page'] + off})"
             if sample else "")
    print(f"{book['book_id']:<17} offset {off:<4}{where}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book-id", help="update one book (default: all)")
    ap.add_argument("--pdf", help="set/replace the source PDF for --book-id")
    args = ap.parse_args()

    if args.pdf and not args.book_id:
        raise SystemExit("--pdf requires --book-id")

    targets = ([BOOKS / f"{args.book_id}.json"] if args.book_id
               else sorted(BOOKS.glob("*.json")))
    for path in targets:
        if not path.exists():
            raise SystemExit(f"no such book profile: {path}")
        update(path, args.pdf)


if __name__ == "__main__":
    main()
