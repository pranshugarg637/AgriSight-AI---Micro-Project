"""
Knowledge-base coverage report: which model classes have evidence and which
do not.

    python -m app.rag.coverage            # markdown table
    python -m app.rag.coverage --json     # machine-readable

For each class in models/class_names.json it lists: documents whose
metadata (crop + disease) match, whether any of them is a placeholder, the
live retrieval status for the class's query (the same RAG safety gate the
app uses), plus whether audio safe steps, symptom-question sets and weather
risk rules exist. Healthy classes need no disease document.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from app.config import get_settings
from app.rag.chunking import load_document_metadata
from app.rag.metadata import is_placeholder_metadata


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def slug(k: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", k.lower())).strip("_")


def document_index(kb_path: Path) -> list[dict]:
    docs = []
    for pdf in sorted(kb_path.glob("*.pdf")):
        m = load_document_metadata(pdf)
        meta_path = pdf.with_suffix(pdf.suffix + ".meta.json")
        raw = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        docs.append({"file": pdf.name, "crop": norm(m.crop), "disease": norm(m.disease),
                     "placeholder": is_placeholder_metadata(raw)})
    return docs


def build_report(class_names: list[str], kb_path: Path, root: Path, probe_retrieval=None) -> list[dict]:
    docs = document_index(kb_path)
    rows = []
    risk_dir = root / "knowledge_base" / "risk_rules"
    q_dir = root / "knowledge_base" / "questions"
    for ck in class_names:
        crop, _, disease = ck.partition("___")
        healthy = disease.lower() == "healthy"
        c, d = norm(crop.replace("(", " ")), norm(disease)
        matched = [x for x in docs if x["crop"] and (x["crop"] in c or c.startswith(x["crop"])) and x["disease"] and x["disease"] == d]
        script = root / "audio_scripts" / "en" / f"{slug(ck)}.json"
        safe_steps = False
        if script.exists():
            safe_steps = bool(json.loads(script.read_text(encoding="utf-8")).get("clips", {}).get("safe_steps"))
        rules = [p.name for p in risk_dir.glob("*.json")] if risk_dir.exists() else []
        has_rule = any(json.loads((risk_dir / r).read_text()).get("class_key") == ck for r in rules)
        has_q = any(slug(ck) in p.name for p in q_dir.glob("*.json")) if q_dir.exists() else False
        row = {
            "class_key": ck, "healthy": healthy,
            "documents": [m["file"] for m in matched],
            "placeholder_only": bool(matched) and all(m["placeholder"] for m in matched),
            "audio_safe_steps": safe_steps, "question_set": has_q, "risk_rule": has_rule,
        }
        if probe_retrieval and not healthy:
            row["retrieval_status"] = probe_retrieval(crop.replace("_", " "), disease.replace("_", " "))
        row["status"] = ("n/a (healthy)" if healthy else
                         "MISSING" if not matched else
                         "PLACEHOLDER ONLY" if row["placeholder_only"] else "covered")
        rows.append(row)
    return rows


def to_markdown(rows: list[dict]) -> str:
    head = "| Class | Status | Documents | Retrieval | Safe-step audio | Questions | Risk rule |\n|---|---|---|---|---|---|---|"
    lines = [head]
    for r in rows:
        lines.append(f"| {r['class_key']} | {r['status']} | {', '.join(r['documents']) or '-'} | "
                     f"{r.get('retrieval_status', '-')} | {'yes' if r['audio_safe_steps'] else '-'} | "
                     f"{'yes' if r['question_set'] else '-'} | {'yes' if r['risk_rule'] else '-'} |")
    disease_rows = [r for r in rows if not r["healthy"]]
    covered = sum(r["status"] == "covered" for r in disease_rows)
    lines.append(f"\n**{covered} of {len(disease_rows)} disease classes have non-placeholder evidence.**")
    return "\n".join(lines)


def main(argv=None) -> int:
    s = get_settings()
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-retrieval", action="store_true", help="skip live retrieval probes")
    a = ap.parse_args(argv)
    class_names = json.loads(s.CLASS_NAMES_PATH.read_text())
    probe = None
    if not a.no_retrieval:
        from app.rag.retrieval import retrieve_evidence

        def probe(crop, disease):
            try:
                return retrieve_evidence(crop=crop, disease=disease, confidence=1.0).status
            except Exception as e:  # vector DB / embedding model unavailable
                return f"error: {type(e).__name__}"
    rows = build_report(class_names, s.KNOWLEDGE_BASE_PATH, s.PROJECT_ROOT, probe)
    print(json.dumps(rows, indent=2) if a.json else to_markdown(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
