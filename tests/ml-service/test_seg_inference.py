"""
Serving-side segmentation: optional behaviour, gating, severity maths, API
endpoints, and a tiny end-to-end train -> evaluate -> serve run.
"""
import base64
import io
import json

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient
from PIL import Image

import app.segmentation.inference as seg_inf
from app.config import get_settings
from app.inference.confidence import ClassProbability, build_diagnosis
from app.segmentation.inference import (
    compute_severity, estimate_leaf_mask, otsu_threshold, overlay_lesion_mask, reset_segmentation_service_for_tests,
    run_segmentation, severity_band,
)
from app.segmentation.model import build_seg_model
from seg_fakes import make_pair, write_dataset

HIGH_DISEASE = {"Tomato___Late_blight": 0.93, "Tomato___Early_blight": 0.05, "Tomato___healthy": 0.02}
HIGH_HEALTHY = {"Tomato___healthy": 0.95, "Tomato___Late_blight": 0.03, "Tomato___Early_blight": 0.02}
LOW = {"Tomato___Late_blight": 0.66, "Tomato___Early_blight": 0.30, "Tomato___healthy": 0.04}


def _diag(probs):
    cps = sorted((ClassProbability(k, v) for k, v in probs.items()), key=lambda c: -c.probability)
    return build_diagnosis(cps)


def _leaf_image():
    return Image.fromarray(make_pair(96, box=(30, 30, 50, 60))[0])


@pytest.fixture(autouse=True)
def _fresh_service():
    reset_segmentation_service_for_tests()
    yield
    s = get_settings()
    for p in (s.SEG_MODEL_PATH, s.SEG_CONFIG_PATH):
        p.unlink(missing_ok=True)
    reset_segmentation_service_for_tests()


@pytest.fixture
def tiny_seg_model():
    """Writes an UNTRAINED model + config to the (temp) SEG paths -- exercises loading/serving only."""
    s = get_settings()
    s.SEG_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save(build_seg_model(pretrained_encoder=False).state_dict(), s.SEG_MODEL_PATH)
    s.SEG_CONFIG_PATH.write_text(json.dumps({"image_size": 64, "threshold": 0.5, "model_version": "test"}))
    reset_segmentation_service_for_tests()
    yield
    reset_segmentation_service_for_tests()


# --- gating -------------------------------------------------------------------

def test_missing_model_gives_model_not_available():
    out = run_segmentation(_leaf_image(), _diag(HIGH_DISEASE))
    assert out.status == "model_not_available"
    assert out.lesion_mask_base64 is None and out.severity_percent is None and out.severity_band is None


def test_healthy_and_unreliable_are_skipped(tiny_seg_model):
    assert run_segmentation(_leaf_image(), _diag(HIGH_HEALTHY)).status == "skipped_healthy"
    assert run_segmentation(_leaf_image(), _diag(LOW)).status == "skipped_unreliable"
    ood = _diag(HIGH_DISEASE)
    ood.is_reliable, ood.confidence_level = False, "unreliable"
    assert run_segmentation(_leaf_image(), ood).status == "skipped_unreliable"


def test_disabled_flag(monkeypatch, tiny_seg_model):
    monkeypatch.setattr(get_settings(), "SEGMENTATION_ENABLED", False)
    reset_segmentation_service_for_tests()
    assert run_segmentation(_leaf_image(), _diag(HIGH_DISEASE)).status == "disabled"


def test_errors_never_escape(monkeypatch, tiny_seg_model):
    def boom(self, image):
        raise RuntimeError("kaboom")
    monkeypatch.setattr(seg_inf.SegmentationService, "analyse", boom)
    assert run_segmentation(_leaf_image(), _diag(HIGH_DISEASE)).status == "error"


def test_success_with_loaded_model(tiny_seg_model):
    out = run_segmentation(_leaf_image(), _diag(HIGH_DISEASE))
    assert out.status == "success"
    png = Image.open(io.BytesIO(base64.b64decode(out.lesion_mask_base64)))
    assert png.size == (64, 64)
    if out.severity_percent is None:
        assert out.severity_band is None
    else:
        assert 0.0 <= out.severity_percent <= 100.0
        assert out.severity_band in ("mild", "moderate", "severe")


def test_corrupt_checkpoint_stays_optional():
    s = get_settings()
    s.SEG_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    s.SEG_MODEL_PATH.write_bytes(b"not a checkpoint")
    s.SEG_CONFIG_PATH.write_text("{}")
    reset_segmentation_service_for_tests()
    assert run_segmentation(_leaf_image(), _diag(HIGH_DISEASE)).status == "model_not_available"


# --- severity maths -------------------------------------------------------------

def test_severity_percent_and_bands():
    leaf = np.zeros((20, 20), dtype=bool)
    leaf[:10, :10] = True                       # 100 leaf pixels
    lesion = np.zeros_like(leaf)
    lesion[:2, :5] = True                       # 10 lesion pixels, inside the leaf
    assert compute_severity(lesion, leaf, 0.05) == 10.0
    # lesion pixels outside the leaf estimate still count as leaf
    lesion2 = lesion.copy()
    lesion2[15, :10] = True                     # +10 lesion px outside leaf -> 20 / 110
    assert compute_severity(lesion2, leaf, 0.05) == pytest.approx(18.2)
    # leaf estimate too small -> no number rather than a misleading one
    tiny = np.zeros_like(leaf)
    tiny[0, 0] = True
    assert compute_severity(np.zeros_like(leaf), tiny, 0.05) is None
    assert severity_band(None, 10, 25) is None
    assert severity_band(9.9, 10, 25) == "mild"
    assert severity_band(10.0, 10, 25) == "moderate"
    assert severity_band(25.0, 10, 25) == "moderate"
    assert severity_band(25.1, 10, 25) == "severe"


def test_leaf_estimate_separates_leaf_from_grey_background():
    rgb, _ = make_pair(80)
    yy, xx = np.mgrid[:80, :80]
    true_leaf = (yy - 40) ** 2 + (xx - 40) ** 2 < 36 ** 2
    est = estimate_leaf_mask(rgb)
    agreement = (est == true_leaf).mean()
    assert agreement > 0.95


def test_otsu_on_bimodal_values():
    vals = np.concatenate([np.full(500, 30), np.full(500, 200)])
    assert 30 <= otsu_threshold(vals) < 200


def test_overlay_marks_lesion_red():
    img = Image.new("RGB", (32, 32), (0, 200, 0))
    m = np.zeros((32, 32), dtype=bool)
    m[8:24, 8:24] = True
    arr = np.array(overlay_lesion_mask(img, m))
    assert arr[16, 16, 0] > 100 and arr[16, 16, 1] < 120   # inside: tinted red (was 0, 200, 0)
    assert tuple(arr[8, 8]) == (220, 30, 30)                 # lesion edge: solid red outline
    assert tuple(arr[2, 2]) == (0, 200, 0)          # outside: unchanged


# --- pipeline + API -----------------------------------------------------------------

def test_pipeline_adds_segmentation_fields_without_changing_the_rest(monkeypatch):
    from app.pipeline import run_prediction
    from pipeline_fakes import install, leaf_jpeg_bytes

    install(monkeypatch, probs=HIGH_DISEASE)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en")
    assert res.segmentation_status == "model_not_available"
    assert res.lesion_mask_base64 is None and res.severity_percent is None
    assert res.segmentation_note
    assert res.class_key == "Tomato___Late_blight" and res.retrieval_status == "success"
    assert res.gradcam_image_base64 == "ZmFrZQ=="


def test_pipeline_with_model_returns_mask(monkeypatch, tiny_seg_model):
    from app.pipeline import run_prediction
    from pipeline_fakes import install, leaf_jpeg_bytes

    install(monkeypatch, probs=HIGH_DISEASE)
    res = run_prediction(leaf_jpeg_bytes(), "image/jpeg", "en")
    assert res.segmentation_status == "success"
    assert res.lesion_mask_base64


def _client():
    from app.main import app
    return TestClient(app, headers={"X-Internal-Token": "test-internal-token"})


def test_segmentation_report_endpoints_404_then_serve_file():
    client = _client()
    for path in ("/api/segmentation-report", "/api/segmentation-training-metrics"):
        r = client.get(path)
        assert r.status_code == 404
        assert "python -m app.segmentation.train" in r.json()["detail"]
    s = get_settings()
    report_path = s.SEG_MODEL_PATH.parent / "seg_evaluation_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({"metrics": {"mean_dice": 0.123}}))
    try:
        assert client.get("/api/segmentation-report").json() == {"metrics": {"mean_dice": 0.123}}
    finally:
        report_path.unlink()


def test_model_status_reports_seg_model():
    data = _client().get("/api/model-status").json()
    assert data["seg_model_loaded"] is False
    assert "app.segmentation.train" in data["seg_model_error"]


# --- end to end ---------------------------------------------------------------------

@pytest.mark.slow
def test_train_evaluate_and_serve_tiny_dataset(tmp_path):
    from app.segmentation.train import train_segmentation

    base = write_dataset(tmp_path / "seg", n=14, size=48)
    result = train_segmentation(
        base, epochs=1, fine_tune_epochs=1, lr=1e-3, batch_size=4, image_size=32, patience=1,
        threshold=0.5, pretrained=False, dataset_name="synthetic-test", min_pairs=5,
    )
    s = get_settings()
    for p in (s.SEG_MODEL_PATH, s.SEG_CONFIG_PATH, s.SEG_MODEL_PATH.parent / "seg_training_metrics.json",
              s.SEG_MODEL_PATH.parent / "seg_evaluation_report.json"):
        assert p.exists(), p
    report = json.loads((s.SEG_MODEL_PATH.parent / "seg_evaluation_report.json").read_text())
    m = report["metrics"]
    assert report["dataset_name"] == "synthetic-test"
    assert report["n_test_images"] == result["config"]["split_sizes"]["test"] == m["n_images"]
    for key in ("mean_dice", "micro_dice", "mean_iou", "micro_iou", "micro_precision", "micro_recall",
                "mean_boundary_f1"):
        assert 0.0 <= m[key] <= 1.0
    assert set(m["by_lesion_size"]) == {"small", "medium", "large", "no_lesion"}
    history = json.loads((s.SEG_MODEL_PATH.parent / "seg_training_metrics.json").read_text())
    assert "val_mean_dice" in history["decoder_training_history"][0]

    reset_segmentation_service_for_tests()
    assert run_segmentation(_leaf_image(), _diag(HIGH_DISEASE)).status == "success"
    for p in (s.SEG_MODEL_PATH.parent / "seg_training_metrics.json",
              s.SEG_MODEL_PATH.parent / "seg_evaluation_report.json"):
        p.unlink()
