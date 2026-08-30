#!/usr/bin/env bash
# Fetch textbook sources into data/raw/books/ (gitignored — large, and each book is
# redistributable only under its own license). Only extracted structure is committed.
#
#   bash scripts/fetch_books.sh
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/data/raw/books"
mkdir -p "$DEST"

# Grinstead & Snell, "Introduction to Probability" (GNU Free Documentation License).
# Full LaTeX source: every exercise carries a \label, \istar marks harder exercises,
# and \index{}/\ref{} give concept vocabulary and dependency edges.
gs="$DEST/grinstead_snell"
if [ -f "$gs/ch1.tex" ]; then
  echo "grinstead_snell: already present, skipping"
else
  echo "grinstead_snell: fetching..."
  mkdir -p "$gs"
  curl -fSL --retry 3 -o "$gs/prob.tar.gz" "https://math.dartmouth.edu/~prob/prob/prob.tar.gz"
  tar xzf "$gs/prob.tar.gz" -C "$gs"
  echo "grinstead_snell: $(ls "$gs"/ch*.tex | wc -l | tr -d ' ') chapters"
fi

echo
echo "Fetched into $DEST"
echo "Next: python3 scripts/extract_book_tex.py --src data/raw/books/grinstead_snell \\"
echo "        --book-id grinstead_snell --title 'Introduction to Probability' \\"
echo "        --authors 'Charles M. Grinstead; J. Laurie Snell' --license GFDL"
