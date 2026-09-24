"""Service boundary: the ML service rejects requests without X-Internal-Token."""
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_settings


def test_api_rejects_missing_internal_token():
    anon = TestClient(app)
    assert anon.get("/api/health").status_code == 401
    assert anon.post("/api/predict").status_code == 401


def test_api_rejects_wrong_internal_token():
    bad = TestClient(app, headers={"X-Internal-Token": "wrong"})
    assert bad.get("/api/model-status").status_code == 401


def test_api_accepts_correct_internal_token():
    ok = TestClient(app, headers={"X-Internal-Token": "test-internal-token"})
    assert ok.get("/api/health").status_code == 200


def test_liveness_probe_needs_no_token_and_leaks_nothing():
    anon = TestClient(app)
    r = anon.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "alive"}


def test_unconfigured_token_rejects_everything(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ML_INTERNAL_TOKEN", "")
    r = TestClient(app, headers={"X-Internal-Token": ""}).get("/api/health")
    assert r.status_code == 503


def test_production_refuses_to_start_without_token(monkeypatch):
    import pytest
    from app.security import assert_secure_configuration, ConfigurationError

    settings = get_settings()
    monkeypatch.setattr(settings, "ENV", "production")
    monkeypatch.setattr(settings, "ML_INTERNAL_TOKEN", "short")
    with pytest.raises(ConfigurationError):
        assert_secure_configuration()
