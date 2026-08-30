#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
import importlib.util

API_TMPL = "https://generativelanguage.googleapis.com/v1beta/{name}"


def load_label_module():
    spec = importlib.util.spec_from_file_location("label_topics_gemini", "scripts/label_topics_gemini.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fetch_batch_status(api_key: str, batch_name: str):
    url = API_TMPL.format(name=batch_name)
    req = urllib.request.Request(url, headers={"x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Recover and merge Gemini Batch API outputs by batch IDs.")
    parser.add_argument("--batch-id", action="append", required=True, help="Batch ID, e.g. batches/abc123 (repeat flag for multiple)")
    parser.add_argument("--input", default="data/processed/problems.json")
    parser.add_argument("--output", default="data/processed/problems.labeled.json")
    parser.add_argument("--site-data", default="site/putnam-data.js")
    parser.add_argument("--publish", action="store_true", help="Also write site/putnam-data.js from recovered output")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if any batch is not succeeded")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY is not set.", file=sys.stderr)
        sys.exit(2)

    label = load_label_module()

    in_path = Path(args.input)
    out_path = Path(args.output)
    site_path = Path(args.site_data)

    data = json.loads(in_path.read_text(encoding="utf-8"))
    rec_by_id = {r.get("id"): r for r in data.get("problems", [])}

    total_items = 0
    ok = 0
    fail = 0
    missing = 0
    non_succeeded_batches = []

    for bid in args.batch_id:
        status = fetch_batch_status(api_key, bid)
        state = label._extract_batch_state(status)
        print(f"{bid}: state={state}")

        if str(state).upper() not in {"SUCCEEDED", "BATCH_STATE_SUCCEEDED", "DONE", "JOB_STATE_SUCCEEDED"}:
            non_succeeded_batches.append((bid, state))

        batch_obj = label._extract_batch_obj(status)
        items = label._extract_inlined_responses(batch_obj)
        # Hard fallback for observed Gemini payload shape:
        # metadata.output.inlinedResponses.inlinedResponses
        if not items:
            items = (
                status.get("metadata", {})
                .get("output", {})
                .get("inlinedResponses", {})
                .get("inlinedResponses", [])
            )
        file_ref = label._extract_responses_file_ref(batch_obj)
        if file_ref:
            print(f"  output_ref={file_ref}")
        if not items and file_ref:
            try:
                raw = label.download_batch_output(api_key, file_ref)
                txt = raw.decode("utf-8", errors="ignore").strip()
                if txt:
                    parsed = []
                    # JSONL path
                    for ln in txt.splitlines():
                        ln = ln.strip()
                        if not ln:
                            continue
                        try:
                            parsed.append(json.loads(ln))
                        except Exception:
                            parsed = []
                            break
                    if parsed:
                        items = parsed
                    else:
                        # Single JSON object path
                        obj = json.loads(txt)
                        if isinstance(obj, dict) and isinstance(obj.get("responses"), list):
                            items = obj["responses"]
                        elif isinstance(obj, list):
                            items = obj
            except Exception as exc:
                print(f"  warning: failed to download/parse output_ref: {exc}")

        print(f"  responses={len(items)}")
        if not items:
            md = status.get("metadata", {})
            out = md.get("output", {}) if isinstance(md, dict) else {}
            print(f"  debug: metadata keys={list(md.keys())[:10] if isinstance(md, dict) else []}")
            print(f"  debug: output keys={list(out.keys())[:10] if isinstance(out, dict) else []}")

        for idx, item in enumerate(items):
            total_items += 1
            rid = label._extract_item_key(item, idx)
            rec = rec_by_id.get(rid)
            if rec is None:
                missing += 1
                continue

            err = item.get("error")
            raw_obj = label._extract_item_response(item)
            raw_text = label._response_text_from_generate_content_response(raw_obj)
            try:
                if err:
                    raise ValueError(f"batch item error: {err}")
                parsed = label.extract_json(raw_text)
                normalized = label.normalize_label(parsed)
                rec.update(normalized)
                ok += 1
            except Exception:
                fail += 1

    labeled_count = sum(1 for r in data.get("problems", []) if r.get("topic"))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote recovered labels: {out_path}")

    if args.publish:
        site_path.parent.mkdir(parents=True, exist_ok=True)
        site_path.write_text("window.PUTNAM_DATA = " + json.dumps(data) + ";\n", encoding="utf-8")
        print(f"Published site data: {site_path}")

    print("Summary:")
    print(f"  processed batch items: {total_items}")
    print(f"  merged ok: {ok}")
    print(f"  parse/item failures: {fail}")
    print(f"  unknown ids: {missing}")
    print(f"  labeled problems now: {labeled_count}/{len(data.get('problems', []))}")

    if non_succeeded_batches:
        print("Non-succeeded batches:")
        for bid, state in non_succeeded_batches:
            print(f"  {bid}: {state}")
        if args.strict:
            sys.exit(1)


if __name__ == "__main__":
    main()
