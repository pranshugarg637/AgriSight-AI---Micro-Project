"""
Confidence-aware diagnosis logic (USP 1) + differential diagnosis (Section 4).

This module intentionally contains NO disease-to-treatment hardcoded mappings.
It only makes decisions about confidence levels, using thresholds sourced
from configuration.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.config import get_settings

settings = get_settings()


@dataclass
class ClassProbability:
    class_name: str
    probability: float


@dataclass
class DiagnosisResult:
    top_class: str
    top_confidence: float
    confidence_level: str  # "high" | "moderate" | "low" | "unreliable"
    is_reliable: bool
    message: str
    alternatives: list[ClassProbability] = field(default_factory=list)


def parse_class_name(raw_class_name: str) -> tuple[str, str]:
    """
    PlantVillage-style folder names look like 'Tomato___Late_blight' or
    'Potato___healthy'. Splits into (crop, disease) for display purposes.
    """
    if "___" in raw_class_name:
        crop, disease = raw_class_name.split("___", 1)
    else:
        crop, disease = "Unknown", raw_class_name
    return crop.replace("_", " ").strip(), disease.replace("_", " ").strip()


def build_diagnosis(sorted_probs: list[ClassProbability]) -> DiagnosisResult:
    """
    sorted_probs must already be sorted descending by probability.
    Implements the exact tiered logic described in the spec:
      - below LOW_CONFIDENCE_THRESHOLD -> unreliable, ask for clearer image
      - between LOW and HIGH -> low-confidence, name the ambiguity
      - above HIGH -> high-confidence
    """
    if not sorted_probs:
        raise ValueError("sorted_probs must not be empty.")

    top = sorted_probs[0]
    second = sorted_probs[1] if len(sorted_probs) > 1 else None

    if top.probability < settings.LOW_CONFIDENCE_THRESHOLD:
        return DiagnosisResult(
            top_class=top.class_name,
            top_confidence=top.probability,
            confidence_level="unreliable",
            is_reliable=False,
            message=(
                "Unable to provide a reliable diagnosis from this image. "
                "Please upload a clearer, well-lit photo of the affected leaf."
            ),
            alternatives=_select_alternatives(sorted_probs),
        )

    if top.probability < settings.HIGH_CONFIDENCE_THRESHOLD:
        ambiguity_note = ""
        if second is not None and second.probability >= settings.DIFFERENTIAL_MIN_SHARE:
            crop1, disease1 = parse_class_name(top.class_name)
            crop2, disease2 = parse_class_name(second.class_name)
            ambiguity_note = (
                f" The system cannot reliably distinguish between {disease1} and {disease2}."
            )
        return DiagnosisResult(
            top_class=top.class_name,
            top_confidence=top.probability,
            confidence_level="low",
            is_reliable=False,
            message=(
                f"Low-confidence prediction.{ambiguity_note} "
                "Treat this result as a preliminary suggestion, not a confirmed diagnosis."
            ),
            alternatives=_select_alternatives(sorted_probs),
        )

    return DiagnosisResult(
        top_class=top.class_name,
        top_confidence=top.probability,
        confidence_level="high",
        is_reliable=True,
        message="High-confidence prediction.",
        alternatives=_select_alternatives(sorted_probs),
    )


def _select_alternatives(sorted_probs: list[ClassProbability]) -> list[ClassProbability]:
    """
    Returns up to MAX_DIFFERENTIAL_ALTERNATIVES classes (excluding the top
    prediction) that clear the minimum share threshold, so the UI isn't
    flooded with dozens of near-zero classes.
    """
    alternatives = []
    for cp in sorted_probs[1:]:
        if cp.probability >= settings.DIFFERENTIAL_MIN_SHARE:
            alternatives.append(cp)
        if len(alternatives) >= settings.MAX_DIFFERENTIAL_ALTERNATIVES:
            break
    return alternatives
