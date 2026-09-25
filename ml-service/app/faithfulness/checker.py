"""
Citation-faithfulness check (Step 5).

After the LLM writes its explanation, every sentence in the evidence-based
sections is tested against the retrieved chunks with a Natural Language
Inference (NLI) model: a sentence is "supported" if at least one chunk
ENTAILS it with probability >= FAITHFULNESS_MIN_ENTAILMENT.

Checked sections: "What is happening?", "What can cause or spread it?",
"What should you consider doing?". The sections about the model itself
("Why does the system think this?") and the caution section are about the
system, not agricultural facts, so they are not checked.

FAITHFULNESS_ACTION=remove (default) drops unsupported sentences and adds a
visible note; =flag keeps them but reports them. The unsupported-claim rate
is reported per response and aggregated by `python -m app.faithfulness.evaluate`.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)

CHECKED_HEADINGS = {"what is happening?", "what can cause or spread it?", "what should you consider doing?"}
REMOVAL_NOTE = "[{n} statement(s) were removed because the retrieved documents did not support them.]"


class NLIModel(Protocol):
    name: str

    def entailment(self, premises: list[str], hypothesis: str) -> list[float]:
        """P(entailment) of `hypothesis` given each premise."""


class CrossEncoderNLI:
    def __init__(self, model_name: str):
        from sentence_transformers import CrossEncoder

        self.name = f"nli:{model_name}"
        self.model = CrossEncoder(model_name)
        labels = getattr(self.model.config, "id2label", None) or {0: "contradiction", 1: "entailment", 2: "neutral"}
        self.entail_idx = next(int(i) for i, l in labels.items() if str(l).lower().startswith("entail"))

    def entailment(self, premises, hypothesis):
        import numpy as np

        logits = np.asarray(self.model.predict([(p, hypothesis) for p in premises]))
        logits = np.atleast_2d(logits)
        e = np.exp(logits - logits.max(axis=1, keepdims=True))
        probs = e / e.sum(axis=1, keepdims=True)
        return probs[:, self.entail_idx].tolist()


_model: NLIModel | None = None
_model_error: str | None = None


def get_nli_model() -> NLIModel | None:
    global _model, _model_error
    s = get_settings()
    if s.FAITHFULNESS_BACKEND == "none":
        return None
    if _model is None and _model_error is None:
        try:
            _model = CrossEncoderNLI(s.FAITHFULNESS_MODEL)
        except Exception as e:
            _model_error = str(e)
            logger.warning("Faithfulness NLI model unavailable: %s", e)
    return _model


def set_nli_model_for_tests(model: NLIModel | None) -> None:
    global _model, _model_error
    _model, _model_error = model, None


_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text.strip()) if s.strip()]


@dataclass
class FaithfulnessResult:
    checked: bool
    backend: str
    total_sentences: int = 0
    unsupported_sentences: list[str] = field(default_factory=list)
    action: str = "none"
    filtered_explanation: str | None = None

    @property
    def unsupported_rate(self) -> float | None:
        return (len(self.unsupported_sentences) / self.total_sentences) if self.total_sentences else None

    def to_schema(self):
        from app.schemas.prediction import FaithfulnessReport

        return FaithfulnessReport(
            checked=self.checked, backend=self.backend, total_sentences=self.total_sentences,
            unsupported_sentences=self.unsupported_sentences, unsupported_rate=self.unsupported_rate,
            action=self.action,
        )


def check_explanation(explanation: str | None, evidence_chunks: list, retrieval_status: str,
                      model: NLIModel | None = None) -> FaithfulnessResult | None:
    s = get_settings()
    if not explanation:
        return None
    if retrieval_status != "success" or not evidence_chunks:
        return FaithfulnessResult(checked=False, backend="skipped_no_evidence")
    model = model or get_nli_model()
    if model is None:
        return FaithfulnessResult(checked=False, backend=s.FAITHFULNESS_BACKEND if s.FAITHFULNESS_BACKEND == "none" else "unavailable")

    premises = [c.text for c in evidence_chunks]
    out_lines, unsupported, total = [], [], 0
    current = None
    for line in explanation.split("\n"):
        m = re.match(r"^\s*##\s+(.*)$", line)
        if m:
            current = m.group(1).strip().lower()
            out_lines.append(line)
            continue
        if current not in CHECKED_HEADINGS or not line.strip():
            out_lines.append(line)
            continue
        prefix = re.match(r"^\s*(?:[-*•]|\d+[.)])\s+", line)
        prefix = prefix.group(0) if prefix else ""
        kept = []
        for sent in split_sentences(line[len(prefix):]):
            total += 1
            score = max(model.entailment(premises, sent), default=0.0)
            if score >= s.FAITHFULNESS_MIN_ENTAILMENT:
                kept.append(sent)
            else:
                unsupported.append(sent)
                if s.FAITHFULNESS_ACTION != "remove":
                    kept.append(sent)
        if kept:
            out_lines.append(prefix + " ".join(kept))
    action = "none"
    filtered = None
    if unsupported:
        if s.FAITHFULNESS_ACTION == "remove":
            action = "removed_unsupported"
            filtered = "\n".join(out_lines).rstrip() + "\n\n" + REMOVAL_NOTE.format(n=len(unsupported))
        else:
            action = "flagged"
    return FaithfulnessResult(checked=True, backend=model.name, total_sentences=total,
                              unsupported_sentences=unsupported, action=action, filtered_explanation=filtered)
