"""Shared fakes for pipeline-level tests (no trained model, no Ollama, no Chroma)."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from app.inference.confidence import ClassProbability, build_diagnosis
from app.rag.retrieval import RetrievalResult, RetrievedChunk


def leaf_jpeg_bytes(size=(256, 256), seed=0) -> bytes:
    rng = np.random.default_rng(seed)
    arr = np.zeros((*size, 3), dtype=np.uint8)
    arr[..., 1] = 140
    arr = np.clip(arr.astype(int) + rng.integers(-60, 60, arr.shape), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG")
    return buf.getvalue()


class FakeInference:
    def __init__(self, probs: dict[str, float], unreliable_reason: str | None = None):
        self.probs = probs
        self.unreliable_reason = unreliable_reason
        self.calls = 0

    def predict(self, image):
        self.calls += 1
        cps = sorted((ClassProbability(k, v) for k, v in self.probs.items()), key=lambda c: -c.probability)
        diag = build_diagnosis(cps)
        if self.unreliable_reason:
            diag.confidence_level = "unreliable"
            diag.is_reliable = False
            diag.unreliable_reason = self.unreliable_reason
        top = diag.top_class
        crop, disease = top.split("___")
        return {
            "diagnosis": diag, "crop": crop.replace("_", " "), "disease": disease.replace("_", " "),
            "class_probabilities": cps, "gradcam_base64": "ZmFrZQ==", "model_version": "test", "calibrated": True,
        }


def chunk(text="Late blight spreads in cool wet weather.", title="Guide", score=0.8):
    return RetrievedChunk(text=text, relevance_score=score, filename="g.pdf", title=title, organization="Org",
                          crop="Tomato", disease="Late blight", page_number=1, source_url="", document_type="guide")


def install(monkeypatch, *, probs, retrieval=None, explanation="## What is happening?\nLate blight.\n## Important caution\nAsk an expert.",
            llm_error=False, unreliable_reason=None):
    import app.pipeline as pipeline
    from app.services.llm_service import LLMServiceError

    fake = FakeInference(probs, unreliable_reason)
    monkeypatch.setattr(pipeline.InferenceService, "get_instance", classmethod(lambda cls: fake))
    calls = {"retrieve": 0, "llm": 0, "llm_kwargs": None}

    def fake_retrieve(**kwargs):
        calls["retrieve"] += 1
        return retrieval if retrieval is not None else RetrievalResult(status="success", chunks=[chunk()])

    def fake_llm(**kwargs):
        calls["llm"] += 1
        calls["llm_kwargs"] = kwargs
        if llm_error:
            raise LLMServiceError("down")
        return explanation

    monkeypatch.setattr(pipeline, "retrieve_evidence", fake_retrieve)
    monkeypatch.setattr(pipeline, "VectorStore", lambda: None)
    monkeypatch.setattr(pipeline, "generate_grounded_explanation", fake_llm)
    monkeypatch.setattr(pipeline, "log_prediction", lambda *a, **k: None)
    return fake, calls
