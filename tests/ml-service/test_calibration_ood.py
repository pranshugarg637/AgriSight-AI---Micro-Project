"""Temperature scaling, ECE and OOD gates on synthetic data (no real metrics claimed)."""
import json

import numpy as np
import pytest
from PIL import Image

from app.calibration.temperature import (
    expected_calibration_error, fit_temperature, nll, reliability_bins, softmax,
)
from app.calibration.synthetic_junk import synthetic_junk_images
from app.inference.ood import OODConfig, energy_score, leaf_pixel_ratio, ood_reason, threshold_for_tpr
from app.inference.confidence import ClassProbability, build_diagnosis, mark_out_of_distribution


def overconfident_logits(n=4000, k=5, seed=0, scale=6.0, acc=0.7):
    """True class is argmax with prob `acc`; logits are scaled up -> overconfident."""
    rng = np.random.default_rng(seed)
    labels = rng.integers(0, k, n)
    logits = rng.normal(0, 1, (n, k))
    correct = rng.random(n) < acc
    pred = np.where(correct, labels, (labels + rng.integers(1, k, n)) % k)
    logits[np.arange(n), pred] += 2.0
    return logits * scale, labels


def test_fit_temperature_recovers_overconfidence_and_lowers_ece():
    logits, labels = overconfident_logits()
    T = fit_temperature(logits, labels)
    assert T > 1.5  # overconfident model -> soften
    assert nll(logits, labels, T) < nll(logits, labels, 1.0)
    ece_before = expected_calibration_error(softmax(logits), labels)
    ece_after = expected_calibration_error(softmax(logits, T), labels)
    assert ece_after < ece_before
    assert ece_after < ece_before / 2


def test_temperature_never_changes_the_predicted_class():
    logits, _ = overconfident_logits(n=200)
    assert (softmax(logits, 3.7).argmax(1) == logits.argmax(1)).all()


def test_underconfident_model_gets_T_below_one():
    logits, labels = overconfident_logits(scale=0.3, acc=0.95)
    assert fit_temperature(logits, labels) < 1.0


def test_reliability_bins_count_everything():
    logits, labels = overconfident_logits(n=500)
    bins = reliability_bins(softmax(logits), labels, n_bins=10)
    assert sum(b["count"] for b in bins) == 500
    assert len(bins) == 10


def test_energy_and_threshold_for_tpr():
    confident = np.array([[10.0, 0, 0]])
    flat = np.array([[0.1, 0.0, 0.05]])
    assert energy_score(confident)[0] < energy_score(flat)[0]
    scores = np.linspace(-10, 0, 101)
    thr = threshold_for_tpr(scores, 0.95)
    assert np.mean(scores <= thr) == pytest.approx(0.95, abs=0.011)


def leaf_image():
    arr = np.zeros((200, 200, 3), np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 60, 150, 40
    return Image.fromarray(arr)


def test_leaf_ratio_fixtures():
    assert leaf_pixel_ratio(leaf_image()) > 0.9
    grey = Image.fromarray(np.full((200, 200, 3), 128, np.uint8))
    assert leaf_pixel_ratio(grey) < 0.05


def test_ood_reason_codes():
    cfg = OODConfig(energy_threshold=-5.0, leaf_ratio_threshold=0.3, temperature=1.0)
    grey = Image.fromarray(np.full((200, 200, 3), 128, np.uint8))
    assert ood_reason(np.array([[20.0, 0, 0]]), grey, cfg)[0] == "not_a_leaf"
    assert ood_reason(np.array([[0.1, 0, 0]]), leaf_image(), cfg)[0] == "unsupported_crop"
    assert ood_reason(np.array([[20.0, 0, 0]]), leaf_image(), cfg)[0] is None


def test_ood_disabled_without_fitted_thresholds():
    assert OODConfig.from_model_config({"backbone": "x"}).enabled is False
    cfg = OODConfig.from_model_config({"temperature": 1.3, "ood": {"energy_threshold": -4}})
    assert cfg.enabled and cfg.temperature == 1.3


def test_mark_out_of_distribution_downgrades_high_confidence():
    d = build_diagnosis([ClassProbability("Tomato___Late_blight", 0.97), ClassProbability("Tomato___healthy", 0.03)])
    assert d.confidence_level == "high"
    mark_out_of_distribution(d, "not_a_leaf")
    assert d.confidence_level == "unreliable" and not d.is_reliable and d.unreliable_reason == "not_a_leaf"


def test_low_confidence_unreliable_has_reason_code():
    d = build_diagnosis([ClassProbability("A___x", 0.4), ClassProbability("A___y", 0.35)])
    assert d.unreliable_reason == "low_confidence"


def test_synthetic_junk_is_labelled_synthetic():
    junk = synthetic_junk_images(14)
    assert len(junk) == 14 and all(name.startswith("synthetic_") for name, _ in junk)


@pytest.mark.slow
def test_fit_script_end_to_end_on_synthetic_dataset(synthetic_dataset_path, tmp_path, monkeypatch):
    """Mechanism test only: tiny random dataset + untrained model. Numbers are meaningless."""
    import torch
    from app.training.model_factory import build_model
    from app.calibration.fit import run
    from app.config import get_settings

    models = tmp_path / "models"
    models.mkdir()
    classes = sorted(p.name for p in synthetic_dataset_path.iterdir())
    torch.save(build_model("mobilenet_v2", len(classes), pretrained=False).state_dict(), models / "plant_disease_model.pt")
    (models / "class_names.json").write_text(json.dumps(classes))
    (models / "model_config.json").write_text(json.dumps({"backbone": "mobilenet_v2", "num_classes": len(classes), "image_size": 64, "model_version": "t"}))
    monkeypatch.setattr(get_settings(), "IMAGE_SIZE", 64)
    report = run(synthetic_dataset_path, models, tmp_path / "fig", synthetic_junk=7)
    cfg = json.loads((models / "model_config.json").read_text())
    assert cfg["temperature"] == pytest.approx(report["calibration"]["temperature"])
    assert "energy_threshold" in cfg["ood"] and "leaf_ratio_threshold" in cfg["ood"]
    assert (models / "model_config.pre_calibration.json").exists()
    assert (models / "calibration_report.json").exists()
    assert (tmp_path / "fig" / "reliability_test.png").exists()
    assert "synthetic (weak proxy)" in report["ood"]["junk_sets"]
