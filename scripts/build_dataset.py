#!/usr/bin/env python3
import argparse
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ITEM_RE = re.compile(r"\\item\s*\[([^\]]+)\]")
CANON_LABEL_RE = re.compile(r"\b([AB])\s*[-–—]*\s*([1-6])\b", flags=re.I)
CMD_RE = re.compile(r"\\[a-zA-Z*]+")
BRACE_CMD_RE = re.compile(r"\\[a-zA-Z*]+\{([^{}]*)\}")
WS_RE = re.compile(r"\s+")
HAS_PANDOC = shutil.which("pandoc") is not None
LABEL_KEYS = [
    "topic",
    "secondary_topics",
    "difficulty",
    "topic_confidence",
    "problem_type",
    "answer_format",
    "techniques",
    "concepts",
    "prerequisites",
    "theorems",
    "keywords",
    "estimated_solve_time_minutes",
    "requires_casework",
    "requires_construction",
    "uses_symmetry",
    "is_multi_part",
    "difficulty_reason",
    "hints",
    "hint_1",
    "hint_2",
    "hint_3",
]


def normalize_tex(text: str) -> str:
    return text.strip().replace("\r\n", "\n").replace("\r", "\n")


def tex_to_text(tex: str) -> str:
    s = tex
    for _ in range(2):
        s = BRACE_CMD_RE.sub(r"\\1", s)
    s = s.replace("$", "")
    s = s.replace("\\[", " ").replace("\\]", " ")
    s = s.replace("\\(", " ").replace("\\)", " ")
    s = CMD_RE.sub(" ", s)
    s = s.replace("{", " ").replace("}", " ")
    s = WS_RE.sub(" ", s).strip()
    return s


def tex_to_html(tex: str, use_pandoc: bool) -> str | None:
    if not use_pandoc or not HAS_PANDOC:
        return None
    try:
        proc = subprocess.run(
            ["pandoc", "--from=latex", "--to=html", "--mathjax", "--wrap=none"],
            input=tex.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        return proc.stdout.decode("utf-8", errors="ignore").strip()
    except Exception:
        return None


def canonicalize_label(label: str):
    m = CANON_LABEL_RE.search(label)
    if not m:
        return None
    return f"{m.group(1).upper()}{m.group(2)}"


def extract_items(tex: str):
    # Restrict extraction to the main list region when possible, while
    # supporting historical format variations.
    start_candidates = [tex.find("\\begin{itemize}"), tex.find("\\item[")]
    start_candidates = [x for x in start_candidates if x != -1]
    if start_candidates:
        tex = tex[min(start_candidates) :]

    # Do not trim on \\end{enumerate}; many problems contain inner enumerate
    # blocks and trimming there would truncate the whole year file.
    outer_itemize_end = tex.rfind("\\end{itemize}")
    doc_end = tex.find("\\end{document}")
    end_candidates = [x for x in [outer_itemize_end, doc_end] if x != -1]
    if end_candidates:
        tex = tex[: min(end_candidates)]

    items = []
    canon_matches = []
    for m in ITEM_RE.finditer(tex):
        code = canonicalize_label(m.group(1))
        if code:
            canon_matches.append((m, code))

    for i, (m, code) in enumerate(canon_matches):
        start = m.end()
        end = canon_matches[i + 1][0].start() if i + 1 < len(canon_matches) else len(tex)
        body = tex[start:end].strip()
        items.append((code, body))
    return items


def load_tex_items(path: Path):
    if not path.exists():
        return {}
    tex = normalize_tex(path.read_text(encoding="utf-8", errors="ignore"))
    return dict(extract_items(tex))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", default="data/raw")
    parser.add_argument("--out", default="data/processed/problems.json")
    parser.add_argument("--site-data", default="site/putnam-data.js")
    parser.add_argument("--labels-from", default="data/processed/problems.labeled.json")
    parser.add_argument("--no-pandoc", action="store_true")
    args = parser.parse_args()
    use_pandoc = not args.no_pandoc

    raw_dir = Path(args.raw_dir)
    problems_dir = raw_dir / "problems"
    solutions_dir = raw_dir / "solutions"

    problem_files = sorted(problems_dir.glob("*.tex"))
    records = []

    for pfile in problem_files:
        year = int(pfile.stem)
        problems = load_tex_items(pfile)
        sfile = solutions_dir / f"{year}s.tex"
        solutions = load_tex_items(sfile)

        for section in ["A", "B"]:
            for n in range(1, 7):
                code = f"{section}{n}"
                ptex = problems.get(code)
                if not ptex:
                    continue
                stex = solutions.get(code)
                phtml = tex_to_html(ptex, use_pandoc)
                shtml = tex_to_html(stex, use_pandoc) if stex else None
                records.append(
                    {
                        "id": f"{year}-{code}",
                        "year": year,
                        "code": code,
                        "session": section,
                        "number": n,
                        "problem_tex": ptex,
                        "problem_text": tex_to_text(ptex),
                        "problem_html": phtml,
                        "solution_tex": stex,
                        "solution_text": tex_to_text(stex) if stex else None,
                        "solution_html": shtml,
                        "topic": None,
                        "secondary_topics": [],
                        "difficulty": None,
                        "topic_confidence": None,
                        "problem_type": None,
                        "answer_format": None,
                        "techniques": [],
                        "concepts": [],
                        "prerequisites": [],
                        "theorems": [],
                        "keywords": [],
                        "estimated_solve_time_minutes": None,
                        "requires_casework": None,
                        "requires_construction": None,
                        "uses_symmetry": None,
                        "is_multi_part": None,
                        "difficulty_reason": None,
                        "hints": [],
                        "hint_1": None,
                        "hint_2": None,
                        "hint_3": None,
                    }
                )

    records.sort(key=lambda r: (r["year"], r["session"], r["number"]))

    labels_path = Path(args.labels_from)
    merged_labels = 0
    if labels_path.exists():
        labeled_payload = json.loads(labels_path.read_text(encoding="utf-8"))
        labels_by_id = {r.get("id"): r for r in labeled_payload.get("problems", [])}
        for rec in records:
            src = labels_by_id.get(rec["id"])
            if not src:
                continue
            touched = False
            for k in LABEL_KEYS:
                if k in src:
                    rec[k] = src[k]
                    touched = True
            if touched:
                merged_labels += 1

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(records),
        "years": sorted({r["year"] for r in records}),
        "problems": records,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    site_data_path = Path(args.site_data)
    site_data_path.parent.mkdir(parents=True, exist_ok=True)
    site_data_path.write_text("window.PUTNAM_DATA = " + json.dumps(payload) + ";\n", encoding="utf-8")

    print(f"Wrote {payload['count']} problems to {out_path}")
    print(f"Wrote site data to {site_data_path}")
    if labels_path.exists():
        print(f"Merged labels for {merged_labels} problems from {labels_path}")


if __name__ == "__main__":
    main()
