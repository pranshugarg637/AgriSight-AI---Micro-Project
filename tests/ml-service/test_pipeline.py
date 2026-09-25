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


def test_close_top_two_with_cited_question_set_offers_questions(monkeypatch):
    install(monkeypatch, probs={"Tomato___Late_blight": 0.62, "Tomato___Early_blight": 0.35, "Tomato___healthy": 0.03})
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en")
    assert res.confidence_level == "low"
    assert res.question_pair == "tomato_early_blight__vs__tomato_late_blight"


def test_no_questions_when_not_close_or_no_cited_set(monkeypatch):
    install(monkeypatch, probs=HIGH)
    assert run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en").question_pair is None
    install(monkeypatch, probs={"Apple___Black_rot": 0.5, "Apple___Apple_scab": 0.45, "Apple___healthy": 0.05})
    assert run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en").question_pair is None


def test_ood_reason_is_propagated_and_stops_rag(monkeypatch):
    _, calls = install(monkeypatch, probs=HIGH, unreliable_reason="not_a_leaf")
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en")
    assert res.unreliable_reason == "not_a_leaf" and res.confidence_level == "unreliable"
    assert calls["retrieve"] == 0


def _parse_sse(text):
    import json as _json

    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(l.split(": ", 1) for l in block.split("\n") if ": " in l)
        events.append((lines["event"], _json.loads(lines["data"])))
    return events


def test_stream_endpoint_emits_real_stage_events_then_result(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    install(monkeypatch, probs=HIGH)
    client = TestClient(app, headers={"X-Internal-Token": "test-internal-token"})
    r = client.post("/api/predict/stream", files={"file": ("l.jpg", leaf_jpeg_bytes(), "image/jpeg")}, data={"language": "en"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(r.text)
    kinds = [k for k, _ in events]
    assert kinds[-1] == "result"
    stages = [d["stage"] for k, d in events if k == "stage" and d["status"] in ("start", "done")]
    assert stages[:2] == ["validate", "validate"] and "retrieve" in stages and "generate" in stages
    assert events[-1][1]["confidence_level"] == "high"


def test_stream_endpoint_reports_errors_as_events(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    install(monkeypatch, probs=HIGH)
    client = TestClient(app, headers={"X-Internal-Token": "test-internal-token"})
    r = client.post("/api/predict/stream", files={"file": ("x.txt", b"nope", "text/plain")})
    events = _parse_sse(r.text)
    assert events[-1][0] == "error" and events[-1][1]["status_code"] == 422
