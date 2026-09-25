"""
Adaptive symptom questions for close differentials.

When the top-2 candidates are close, the farmer answers 2-3 yes/no
questions defined in knowledge_base/questions/<a>__vs__<b>.json. Each
question cites the document it came from. Answers update the CNN
probabilities with Bayes' rule:

    posterior(c) ∝ prior(c) · Π_q P(answer_q | c)

with P(yes|c) from the question file, P(no|c) = 1 - P(yes|c), and
"unsure" leaving the prior unchanged. Only the two classes in the pair are
re-weighted; their combined probability mass is preserved, so every other
class keeps its CNN probability.

The likelihoods are MODELLING CONSTANTS derived from qualitative statements
("characteristic of A", "not described for B") -- each file states its
`likelihood_basis`. They are not measured frequencies.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings

ANSWERS = {"yes", "no", "unsure"}


def slug(class_key: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", class_key.lower())).strip("_")


def pair_id(a: str, b: str) -> str:
    x, y = sorted([slug(a), slug(b)])
    return f"{x}__vs__{y}"


class QuestionSetError(ValueError):
    pass


@dataclass
class QuestionSet:
    pair: str
    classes: list[str]
    questions: list[dict]
    source_is_placeholder: bool
    likelihood_basis: str
    path: Path

    def public(self, lang: str) -> dict:
        return {
            "pair": self.pair,
            "classes": self.classes,
            "source_is_placeholder": self.source_is_placeholder,
            "likelihood_basis": self.likelihood_basis,
            "audio_slug": "q_" + self.pair.replace("__vs__", "_vs_"),
            "questions": [
                {"id": q["id"], "text": q["text"].get(lang) or q["text"]["en"],
                 "text_en": q["text"]["en"], "citations": q["citations"]}
                for q in self.questions
            ],
        }


def validate_question_set(doc: dict) -> list[str]:
    errors = []
    classes = doc.get("classes") or []
    if len(classes) != 2:
        errors.append("classes must list exactly two class keys")
    qs = doc.get("questions") or []
    if not qs:
        errors.append("no questions")
    for q in qs:
        qid = q.get("id", "?")
        if not q.get("citations"):
            errors.append(f"{qid}: every question needs at least one citation")
        for c in q.get("citations", []):
            if not c.get("file") or not c.get("quote"):
                errors.append(f"{qid}: citation needs file and quote")
        like = q.get("p_yes") or {}
        for cls in classes:
            v = like.get(cls)
            if not isinstance(v, (int, float)) or not 0.01 <= v <= 0.99:
                errors.append(f"{qid}: p_yes for {cls} must be in [0.01, 0.99]")
        if "en" not in (q.get("text") or {}):
            errors.append(f"{qid}: English text required")
    if not doc.get("likelihood_basis"):
        errors.append("likelihood_basis must explain where the likelihoods come from")
    return errors


def load_question_set(path: Path, production: bool | None = None) -> QuestionSet:
    s = get_settings()
    production = (s.ENV == "production") if production is None else production
    doc = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_question_set(doc)
    if errors:
        raise QuestionSetError(f"{path.name}: " + "; ".join(errors))
    if doc.get("source_is_placeholder") and production:
        raise QuestionSetError(f"{path.name}: based on placeholder documents -- refused in production")
    return QuestionSet(
        pair=pair_id(*doc["classes"]), classes=list(doc["classes"]), questions=doc["questions"],
        source_is_placeholder=bool(doc.get("source_is_placeholder")),
        likelihood_basis=doc["likelihood_basis"], path=path,
    )


def questions_dir() -> Path:
    s = get_settings()
    return Path(getattr(s, "QUESTIONS_PATH", s.PROJECT_ROOT / "knowledge_base" / "questions"))


def find_question_set(class_a: str, class_b: str, directory: Path | None = None, production: bool | None = None) -> QuestionSet | None:
    path = (directory or questions_dir()) / f"{pair_id(class_a, class_b)}.json"
    if not path.exists():
        return None
    try:
        return load_question_set(path, production)
    except QuestionSetError:
        return None


def should_ask(candidates: list[dict], margin: float | None = None) -> bool:
    """Top-2 are 'close' when their calibrated probabilities differ by less than the margin."""
    if len(candidates) < 2:
        return False
    s = get_settings()
    margin = s.REFINE_MARGIN if margin is None else margin
    top = sorted(candidates, key=lambda c: -c["probability"])
    return (top[0]["probability"] - top[1]["probability"]) < margin


def bayes_update(candidates: list[dict], qset: QuestionSet, answers: dict[str, str]) -> list[dict]:
    """Returns candidates (same shape) with updated probabilities, sorted desc."""
    probs = {c["class_key"]: float(c["probability"]) for c in candidates}
    for cls in qset.classes:
        if cls not in probs:
            raise QuestionSetError(f"candidate list does not contain {cls}")
    mass = sum(probs[c] for c in qset.classes)
    if mass <= 0:
        return sorted(candidates, key=lambda c: -c["probability"])
    weights = {c: probs[c] / mass for c in qset.classes}
    for q in qset.questions:
        ans = answers.get(q["id"], "unsure")
        if ans not in ANSWERS:
            raise QuestionSetError(f"invalid answer '{ans}' for {q['id']}")
        if ans == "unsure":
            continue
        for c in qset.classes:
            p = float(q["p_yes"][c])
            weights[c] *= p if ans == "yes" else (1 - p)
    z = sum(weights.values())
    out = []
    for cand in candidates:
        new = dict(cand)
        if cand["class_key"] in qset.classes:
            new["probability"] = mass * weights[cand["class_key"]] / z
        out.append(new)
    return sorted(out, key=lambda c: -c["probability"])
