"""
Aggregate unsupported-claim rate over logged explanations.

    python -m app.faithfulness.evaluate --input ../data/faithfulness_samples.jsonl

Input JSONL rows: {"explanation": "...", "evidence": ["chunk text", ...]}.
Collect them by running real predictions with Ollama up and
FAITHFULNESS_ACTION=flag, or export from your own runs. Prints the
per-sentence unsupported-claim rate. No sample data ships with the repo, so
no rate is claimed until you run this.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from types import SimpleNamespace

from app.faithfulness.checker import check_explanation


def evaluate(rows: list[dict], model=None) -> dict:
    total = unsupported = checked = 0
    for r in rows:
        chunks = [SimpleNamespace(text=t) for t in r.get("evidence", [])]
        res = check_explanation(r.get("explanation"), chunks, "success" if chunks else "insufficient_evidence", model=model)
        if res and res.checked:
            checked += 1
            total += res.total_sentences
            unsupported += len(res.unsupported_sentences)
    return {"responses_checked": checked, "sentences": total, "unsupported": unsupported,
            "unsupported_claim_rate": (unsupported / total) if total else None}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    a = ap.parse_args(argv)
    rows = [json.loads(l) for l in a.input.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(json.dumps(evaluate(rows), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
