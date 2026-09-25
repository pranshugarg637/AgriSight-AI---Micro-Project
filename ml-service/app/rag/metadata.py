"""
Strict metadata validation at ingestion (Step 5).

Citations are only as good as the metadata behind them. For every PDF:
  - a sidecar <file>.pdf.meta.json should exist
  - organization and source_url must be real (not empty / "Unknown")
  - anything marked as a placeholder ("placeholder" in title/organization,
    or "placeholder": true) is REFUSED when ENV=production

In development these are loud warnings (so the demo keeps working); in
production they are errors and the document is not ingested. `--strict`
turns warnings into errors in any environment.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class MetadataCheck:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    is_placeholder: bool = False

    @property
    def ok(self) -> bool:
        return not self.errors


def is_placeholder_metadata(raw: dict) -> bool:
    if raw.get("placeholder") is True:
        return True
    text = f"{raw.get('title', '')} {raw.get('organization', '')}".lower()
    return "placeholder" in text or "sample" in raw.get("organization", "").lower()


def check_document_metadata(pdf_path: Path, production: bool, strict: bool = False) -> MetadataCheck:
    check = MetadataCheck()
    meta_path = pdf_path.with_suffix(pdf_path.suffix + ".meta.json")
    problems: list[str] = []
    raw: dict = {}
    if not meta_path.exists():
        problems.append("no .meta.json sidecar (title/organization/source_url unknown)")
    else:
        try:
            raw = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            check.errors.append(f"sidecar is not valid JSON: {e}")
            return check
        org = str(raw.get("organization", "")).strip()
        if not org or org.lower() == "unknown":
            problems.append("organization missing")
        if not str(raw.get("source_url", "")).strip():
            problems.append("source_url missing")
        if not str(raw.get("title", "")).strip():
            problems.append("title missing")
    check.is_placeholder = is_placeholder_metadata(raw)
    if check.is_placeholder:
        msg = "marked as PLACEHOLDER content"
        (check.errors if production else check.warnings).append(msg)
    for p in problems:
        (check.errors if (production or strict) else check.warnings).append(p)
    if strict and check.warnings:
        check.errors.extend(check.warnings)
        check.warnings = []
    return check
