"""Pipeline-level behaviour with fakes: safety gating, translation fields, stage events."""
import pytest

import app.pipeline as pipeline
from app.pipeline import run_prediction, PipelineError
from app.rag.retrieval import RetrievalResult
from app.translation.service import TranslationService
from pipeline_fakes import install, leaf_jpeg_bytes

HIGH = {"Tomato___Late_blight": 0.93, "Tomato___Early_blight": 0.05, "Tomato___healthy": 0.02}
LOW = {"Tomato___Late_blight": 0.66, "Tomato___Early_blight": 0.30, "Tomato___healthy": 0.04}
UNRELIABLE = {"Tomato___Late_blight": 0.40, "Tomato___Early_blight": 0.35, "Tomato___healthy": 0.25}


class FakeHindi:
    name = "fake-hi"

    def translate(self, texts, source, target):
        return [f"HI:{t}" for t in texts]


@pytest.fixture
def hindi(monkeypatch):
    monkeypatch.setattr(pipeline, "get_translation_service", lambda: TranslationService(FakeHindi()))


def test_high_confidence_full_pipeline_english(monkeypatch):
    _, calls = install(monkeypatch, probs=HIGH)
    events = []
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en", emit=lambda s, st, i: events.append((s, st)))
    assert res.confidence_level == "high"
    assert res.class_key == "Tomato___Late_blight"
    assert res.retrieval_status == "success"
    assert res.explanation.startswith("## What is happening?")
    assert res.translation_status == "not_requested"
    assert res.explanation_translated is None
    assert res.dataset_disclaimer
    assert [c.class_key for c in res.top_candidates][:2] == ["Tomato___Late_blight", "Tomato___Early_blight"]
    stages = [s for s, st in events if st in ("start", "done", "skipped")]
    assert stages.index("validate") < stages.index("classify") < stages.index("retrieve") < stages.index("generate") < stages.index("verify")


def test_hindi_request_returns_translation_plus_original_english_and_same_citations(monkeypatch, hindi):
    install(monkeypatch, probs=HIGH)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "hi")
    assert res.language == "hi"
    assert res.translation_status == "translated"
    assert res.translation_backend == "fake-hi"
    assert res.explanation.startswith("## What is happening?")  # English kept
    assert res.explanation_translated.startswith("## HI:What is happening?")
    assert len(res.sources) == 1


def test_unsupported_language_falls_back_to_english(monkeypatch, hindi):
    install(monkeypatch, probs=HIGH)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "xx")
    assert res.language == "en" and res.explanation_translated is None


def test_unreliable_stops_before_rag_and_llm(monkeypatch):
    _, calls = install(monkeypatch, probs=UNRELIABLE)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "hi")
    assert res.confidence_level == "unreliable"
    assert res.retrieval_status == "skipped_low_confidence"
    assert calls["retrieve"] == 0 and calls["llm"] == 0
    assert res.explanation is None and res.sources == []


def test_low_confidence_still_grounded(monkeypatch):
    _, calls = install(monkeypatch, probs=LOW)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en")
    assert res.confidence_level == "low" and res.is_reliable is False
    assert calls["llm_kwargs"]["confidence_level"] == "low"


def test_insufficient_evidence_passes_status_to_llm_and_returns_no_sources(monkeypatch):
    _, calls = install(monkeypatch, probs=HIGH, retrieval=RetrievalResult(status="insufficient_evidence", chunks=[]))
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en")
    assert res.retrieval_status == "insufficient_evidence"
    assert calls["llm_kwargs"]["evidence_chunks"] == []
    assert calls["llm_kwargs"]["retrieval_status"] == "insufficient_evidence"
    assert res.sources == []


def test_llm_down_still_returns_diagnosis(monkeypatch, hindi):
    install(monkeypatch, probs=HIGH, llm_error=True)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "hi")
    assert res.explanation is None and res.explanation_translated is None
    assert res.confidence_level == "high"


def test_invalid_image_is_a_422_pipeline_error(monkeypatch):
    install(monkeypatch, probs=HIGH)
    with pytest.raises(PipelineError) as e:
        run_prediction(b"not an image", "image/jpeg", "en")
    assert e.value.status_code == 422 and e.value.stage == "validate"
