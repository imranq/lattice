#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="putnam_archive/data/processed/problems.json")
    parser.add_argument("--site-data", default="putnam_archive/site/putnam-data.js")
    args = parser.parse_args()

    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    out = Path(args.site_data)
    out.write_text("window.PUTNAM_DATA = " + json.dumps(data) + ";\n", encoding="utf-8")
    print(f"Published {len(data.get('problems', []))} records to {out}")


if __name__ == "__main__":
    main()
