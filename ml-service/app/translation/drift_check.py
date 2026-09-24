"""
Back-translation drift check (a *limitation report*, not proof of accuracy).

    python -m app.translation.drift_check --lang hi [--samples-file my_sentences.txt] [--out report.json]

For each English sample: translate en -> <lang> -> en with the configured
backend and compare the round trip with the original using character
n-gram F-score (chrF-style, 0..1). Low scores flag sentences worth a human
look; high scores do NOT prove the translation is correct (a backend can be
consistently wrong in both directions). Native-speaker review is still
required -- see docs/HUMAN_TODO.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from app.config import get_settings
from app.translation.service import get_translation_service

DEFAULT_SAMPLES = [
    "The system is not sure about this result.",
    "Please visit the nearest agriculture office.",
    "Take a new photo in good light with the leaf filling the frame.",
    "Reliable advice for this disease was not found in the knowledge base.",
    "A shop listing does not guarantee that a product is in stock.",
]


def char_ngrams(text: str, n: int) -> Counter:
    t = " ".join(text.lower().split())
    return Counter(t[i:i + n] for i in range(max(len(t) - n + 1, 0)))


def chrf(reference: str, hypothesis: str, max_n: int = 6, beta: float = 2.0) -> float:
    """Character n-gram F-beta averaged over n=1..max_n (simplified chrF)."""
    scores = []
    for n in range(1, max_n + 1):
        ref, hyp = char_ngrams(reference, n), char_ngrams(hypothesis, n)
        if not ref or not hyp:
            continue
        overlap = sum((ref & hyp).values())
        p, r = overlap / sum(hyp.values()), overlap / sum(ref.values())
        if p + r == 0:
            scores.append(0.0)
            continue
        scores.append((1 + beta**2) * p * r / (beta**2 * p + r))
    return sum(scores) / len(scores) if scores else 0.0


def load_samples(samples_file: Path | None) -> list[str]:
    if samples_file:
        return [ln.strip() for ln in samples_file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    samples = list(DEFAULT_SAMPLES)
    scripts_dir = get_settings().PROJECT_ROOT / "audio_scripts" / "en"
    if scripts_dir.exists():
        for f in sorted(scripts_dir.glob("*.json")):
            data = json.loads(f.read_text(encoding="utf-8"))
            for v in (data.get("clips") or {}).values():
                if isinstance(v, str) and len(v.split()) >= 4:
                    samples.append(v)
    return samples


def run(lang: str, samples: list[str], service=None) -> dict:
    service = service or get_translation_service()
    forward = service.translate_texts(samples, "en", lang)
    back = service.translate_texts(forward, lang, "en")
    rows = []
    for src, fwd, bk in zip(samples, forward, back):
        rows.append({"source": src, "translated": fwd, "back_translated": bk, "chrf": round(chrf(src, bk), 3)})
    scores = [r["chrf"] for r in rows]
    return {
        "language": lang,
        "backend": service.backend.name,
        "n": len(rows),
        "mean_chrf": round(sum(scores) / len(scores), 3) if scores else None,
        "lowest": sorted(rows, key=lambda r: r["chrf"])[:5],
        "rows": rows,
        "note": "Round-trip similarity is a drift signal only; it is not evidence that translations are correct.",
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="hi")
    ap.add_argument("--samples-file", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    try:
        report = run(args.lang, load_samples(args.samples_file))
    except Exception as e:  # backend not installed / no network
        print(f"Drift check could not run: {e}", file=sys.stderr)
        return 2
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
