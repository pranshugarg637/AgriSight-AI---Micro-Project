import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.inference.confidence import ClassProbability, build_diagnosis, parse_class_name


def test_high_confidence_case():
    probs = [
        ClassProbability("Tomato___Late_blight", 0.94),
        ClassProbability("Tomato___Early_blight", 0.04),
        ClassProbability("Potato___healthy", 0.02),
    ]
    result = build_diagnosis(probs)
    assert result.confidence_level == "high"
    assert result.is_reliable is True


def test_low_confidence_case_with_ambiguity_note():
    probs = [
        ClassProbability("Tomato___Late_blight", 0.70),
        ClassProbability("Tomato___Early_blight", 0.25),
        ClassProbability("Potato___healthy", 0.05),
    ]
    result = build_diagnosis(probs)
    assert result.confidence_level == "low"
    assert result.is_reliable is False
    assert "Early blight" in result.message


def test_unreliable_confidence_case():
    probs = [
        ClassProbability("Tomato___Late_blight", 0.45),
        ClassProbability("Tomato___Early_blight", 0.35),
        ClassProbability("Potato___healthy", 0.20),
    ]
    result = build_diagnosis(probs)
    assert result.confidence_level == "unreliable"
    assert result.is_reliable is False
    assert "clearer" in result.message.lower()


def test_confidence_values_between_zero_and_one():
    probs = [ClassProbability("A", 0.6), ClassProbability("B", 0.4)]
    result = build_diagnosis(probs)
    assert 0.0 <= result.top_confidence <= 1.0


def test_differential_alternatives_respects_max_count():
    probs = [
        ClassProbability("A", 0.5),
        ClassProbability("B", 0.2),
        ClassProbability("C", 0.15),
        ClassProbability("D", 0.15),
    ]
    result = build_diagnosis(probs)
    # MAX_DIFFERENTIAL_ALTERNATIVES defaults to 2
    assert len(result.alternatives) <= 2


def test_parse_class_name_with_separator():
    crop, disease = parse_class_name("Tomato___Late_blight")
    assert crop == "Tomato"
    assert disease == "Late blight"


def test_parse_class_name_without_separator():
    crop, disease = parse_class_name("healthy")
    assert crop == "Unknown"
    assert disease == "healthy"
