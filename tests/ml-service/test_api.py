"""
API-level tests using FastAPI's TestClient. These exercise the /api/predict
endpoint's HTTP contract, error handling, and schema -- without requiring a
real trained model (that scenario is tested explicitly as the
"missing model" 503 case, which is the honest behavior when artifacts
haven't been generated yet).
"""
import io
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.main import app
from app.inference.service import InferenceService, reset_inference_service_for_tests

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_inference_singleton():
    reset_inference_service_for_tests()
    yield
    reset_inference_service_for_tests()


def _make_image_bytes(size=(300, 300), flat=False):
    if flat:
        arr = np.full((*size, 3), 128, dtype="uint8")
    else:
        arr = (np.random.rand(*size, 3) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def test_health_endpoint_returns_200():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "model_loaded" in data
    assert "knowledge_base_ready" in data
    assert "llm_reachable" in data


def test_model_status_reflects_missing_model():
    response = client.get("/api/model-status")
    assert response.status_code == 200
    data = response.json()
    # In this test environment, no trained model artifacts exist by default.
    assert data["model_loaded"] is False
    assert data["error"] is not None


def test_predict_with_missing_model_returns_503(monkeypatch):
    files = {"file": ("leaf.jpg", _make_image_bytes(), "image/jpeg")}
    response = client.post("/api/predict", files=files)
    assert response.status_code == 503
    assert "model" in response.json()["detail"].lower()


def test_predict_rejects_invalid_file():
    files = {"file": ("not_an_image.txt", io.BytesIO(b"hello world"), "text/plain")}
    response = client.post("/api/predict", files=files)
    assert response.status_code == 422


def test_predict_rejects_blurry_flat_image():
    files = {"file": ("leaf.jpg", _make_image_bytes(flat=True), "image/jpeg")}
    response = client.post("/api/predict", files=files)
    assert response.status_code == 422
    assert "unclear" in response.json()["detail"].lower()


def test_knowledge_base_status_endpoint():
    response = client.get("/api/knowledge-base-status")
    assert response.status_code == 200
    data = response.json()
    assert "ready" in data
    assert "num_chunks" in data


def test_analytics_history_empty_by_default(tmp_path, monkeypatch):
    import app.services.prediction_log as log_module
    from app.config import Settings

    class TmpSettings(Settings):
        PREDICTIONS_LOG_PATH = tmp_path / "predictions_log.jsonl"

    monkeypatch.setattr(log_module, "get_settings", lambda: TmpSettings())

    response = client.get("/api/analytics/history")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 0
    assert data["predictions"] == []


def test_evaluation_report_404_when_not_trained():
    response = client.get("/api/evaluation-report")
    assert response.status_code == 404
