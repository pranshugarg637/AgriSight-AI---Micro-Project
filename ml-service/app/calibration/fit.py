"""
Fit temperature scaling + OOD thresholds on YOUR trained model and dataset,
then evaluate them on the held-out test split. Run it where the dataset lives:

    cd ml-service
    python -m app.calibration.fit                      # full val + test splits
    python -m app.calibration.fit --max-samples 3000   # faster, subsampled
    python -m app.calibration.fit --junk-dir ../data/ood_junk   # real junk photos (recommended)

It reproduces the exact train/val/test split used by training (same
VAL_SPLIT / TEST_SPLIT / seed 42) and writes:
  models/model_config.json          + "temperature", "ood", "calibration" blocks
                                      (original saved as model_config.pre_calibration.json)
  models/calibration_report.json    ECE / NLL before & after, OOD false-accept /
                                      false-reject rates, reliability bins
  docs/figures/reliability_test.png reliability diagram (test split)

Nothing is estimated or invented: every number comes from this run.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import time
from pathlib import Path

import numpy as np

from app.calibration.temperature import (
    draw_reliability_diagram, expected_calibration_error, fit_temperature, nll, reliability_bins, softmax,
)
from app.calibration.synthetic_junk import synthetic_junk_images
from app.config import get_settings
from app.inference.ood import energy_score, leaf_pixel_ratio, threshold_for_tpr

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("calibration")


def _subset(indices: list[int], max_samples: int | None, seed: int) -> list[int]:
    if not max_samples or len(indices) <= max_samples:
        return list(indices)
    rng = np.random.default_rng(seed)
    return sorted(rng.choice(indices, size=max_samples, replace=False).tolist())


def compute_logits(model, images, preprocess, device, batch_size: int = 64) -> np.ndarray:
    import torch

    out = []
    for i in range(0, len(images), batch_size):
        batch = torch.stack([preprocess(img) for img in images[i:i + batch_size]]).to(device)
        with torch.no_grad():
            out.append(model(batch).cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, 0))


def load_split_items(dataset_path: Path, max_samples: int | None, seed: int):
    """(val_items, test_items, class_names); items = list[(path, label)]."""
    from app.training.dataset import load_datasets

    s = get_settings()
    _, val, test, class_names = load_datasets(dataset_path, s.IMAGE_SIZE, s.VAL_SPLIT, s.TEST_SPLIT, seed=42)
    samples = val.dataset.samples  # same underlying ImageFolder ordering
    val_items = [samples[i] for i in _subset(val.indices, max_samples, seed)]
    test_items = [samples[i] for i in _subset(test.indices, max_samples, seed + 1)]
    return val_items, test_items, class_names


def run(dataset_path: Path, models_dir: Path, figures_dir: Path, max_samples: int | None = None,
        tpr: float = 0.95, leaf_keep: float = 0.99, junk_dir: Path | None = None,
        synthetic_junk: int = 70, seed: int = 0, write: bool = True) -> dict:
    import torch
    from PIL import Image
    from torchvision import transforms

    from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD
    from app.training.model_factory import build_model

    t0 = time.time()
    cfg_path = models_dir / "model_config.json"
    cfg = json.loads(cfg_path.read_text())
    class_names = json.loads((models_dir / "class_names.json").read_text())
    device = torch.device("cpu")
    model = build_model(cfg["backbone"], num_classes=cfg["num_classes"], freeze_backbone=False, pretrained=False)
    model.load_state_dict(torch.load(models_dir / "plant_disease_model.pt", map_location=device))
    model.eval()
    size = cfg["image_size"]
    preprocess = transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(),
                                     transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD)])

    val_items, test_items, ds_classes = load_split_items(dataset_path, max_samples, seed)
    if list(ds_classes) != list(class_names):
        raise SystemExit("Dataset class folders do not match models/class_names.json -- wrong dataset?")

    def load(items):
        imgs = [Image.open(p).convert("RGB") for p, _ in items]
        return imgs, np.array([y for _, y in items])

    log.info("Computing logits: %d val, %d test images", len(val_items), len(test_items))
    val_imgs, y_val = load(val_items)
    val_logits = compute_logits(model, val_imgs, preprocess, device)
    test_imgs, y_test = load(test_items)
    test_logits = compute_logits(model, test_imgs, preprocess, device)

    # --- temperature scaling (fit on val only) ---
    T = fit_temperature(val_logits, y_val)
    p_test_before, p_test_after = softmax(test_logits, 1.0), softmax(test_logits, T)
    calib = {
        "temperature": T,
        "fitted_on": "validation split",
        "n_val": int(len(y_val)), "n_test": int(len(y_test)),
        "val_nll_before": nll(val_logits, y_val, 1.0), "val_nll_after": nll(val_logits, y_val, T),
        "test_nll_before": nll(test_logits, y_test, 1.0), "test_nll_after": nll(test_logits, y_test, T),
        "test_ece_before": expected_calibration_error(p_test_before, y_test),
        "test_ece_after": expected_calibration_error(p_test_after, y_test),
        "test_accuracy": float((test_logits.argmax(1) == y_test).mean()),
        "reliability_bins_test_before": reliability_bins(p_test_before, y_test),
        "reliability_bins_test_after": reliability_bins(p_test_after, y_test),
    }
    # tier distribution with the configured thresholds (calibrated)
    s = get_settings()
    conf_after = p_test_after.max(1)
    correct = test_logits.argmax(1) == y_test
    tiers = {}
    for name, mask in {
        "high": conf_after >= s.HIGH_CONFIDENCE_THRESHOLD,
        "low": (conf_after >= s.LOW_CONFIDENCE_THRESHOLD) & (conf_after < s.HIGH_CONFIDENCE_THRESHOLD),
        "unreliable": conf_after < s.LOW_CONFIDENCE_THRESHOLD,
    }.items():
        tiers[name] = {"share": float(mask.mean()), "accuracy": float(correct[mask].mean()) if mask.any() else None}
    calib["test_tiers_calibrated"] = tiers

    # --- OOD thresholds (fit on val in-distribution only) ---
    val_energy = energy_score(val_logits, T)
    energy_thr = threshold_for_tpr(val_energy, tpr)
    val_leaf = np.array([leaf_pixel_ratio(im) for im in val_imgs])
    leaf_thr = float(np.quantile(val_leaf, 1 - leaf_keep))

    def reasons(logits, imgs):
        e = energy_score(logits, T)
        leaf = np.array([leaf_pixel_ratio(im) for im in imgs])
        r = np.where(leaf < leaf_thr, "not_a_leaf", np.where(e > energy_thr, "unsupported_crop", "accepted"))
        return r

    test_reasons = reasons(test_logits, test_imgs)
    ood = {
        "method": "leaf colour ratio + energy score",
        "energy_threshold": energy_thr, "leaf_ratio_threshold": leaf_thr,
        "target_val_acceptance_energy": tpr, "target_val_acceptance_leaf": leaf_keep,
        "test_false_reject_rate": float((test_reasons != "accepted").mean()),
        "test_false_reject_by_reason": {k: float((test_reasons == k).mean()) for k in ("not_a_leaf", "unsupported_crop")},
        "test_accuracy_on_accepted": float(correct[test_reasons == "accepted"].mean()) if (test_reasons == "accepted").any() else None,
        "junk_sets": {},
    }
    junk_sets = {}
    if junk_dir and junk_dir.exists():
        files = sorted(p for p in junk_dir.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        junk_sets["real_junk_dir"] = [Image.open(p).convert("RGB") for p in files]
    if synthetic_junk:
        junk_sets["synthetic (weak proxy)"] = [im for _, im in synthetic_junk_images(synthetic_junk, seed=seed)]
    for name, imgs in junk_sets.items():
        if not imgs:
            continue
        r = reasons(compute_logits(model, imgs, preprocess, device), imgs)
        ood["junk_sets"][name] = {
            "n": len(imgs),
            "false_accept_rate": float((r == "accepted").mean()),
            "rejected_as_not_a_leaf": float((r == "not_a_leaf").mean()),
            "rejected_as_unsupported_crop": float((r == "unsupported_crop").mean()),
        }

    report = {"calibration": calib, "ood": ood, "runtime_seconds": round(time.time() - t0, 1),
              "max_samples": max_samples, "dataset_path": str(dataset_path)}

    if write:
        backup = models_dir / "model_config.pre_calibration.json"
        if not backup.exists():
            shutil.copyfile(cfg_path, backup)
        cfg["temperature"] = T
        cfg["ood"] = {"energy_threshold": energy_thr, "leaf_ratio_threshold": leaf_thr,
                      "fitted_on": "validation split", "target_val_acceptance": tpr}
        cfg["calibration"] = {"fitted_on": "validation split", "n_val": int(len(y_val)),
                              "fitted_at": time.strftime("%Y-%m-%d %H:%M:%S")}
        cfg_path.write_text(json.dumps(cfg, indent=2))
        (models_dir / "calibration_report.json").write_text(json.dumps(report, indent=2))
        figures_dir.mkdir(parents=True, exist_ok=True)
        draw_reliability_diagram(calib["reliability_bins_test_before"], calib["reliability_bins_test_after"],
                                 figures_dir / "reliability_test.png",
                                 title=f"Test split reliability (T={T:.3f}, n={len(y_test)})")
    return report


def main(argv=None) -> int:
    s = get_settings()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset-path", type=Path, default=s.DATASET_PATH)
    ap.add_argument("--models-dir", type=Path, default=s.MODEL_PATH.parent)
    ap.add_argument("--figures-dir", type=Path, default=s.PROJECT_ROOT / "docs" / "figures")
    ap.add_argument("--max-samples", type=int, default=None, help="subsample each split (report states n)")
    ap.add_argument("--tpr", type=float, default=0.95, help="share of val images the energy gate must accept")
    ap.add_argument("--leaf-keep", type=float, default=0.99, help="share of val images the leaf gate must accept")
    ap.add_argument("--junk-dir", type=Path, default=None, help="folder of real non-leaf / other-crop photos")
    ap.add_argument("--synthetic-junk", type=int, default=70)
    ap.add_argument("--dry-run", action="store_true", help="report only, do not modify model_config.json")
    a = ap.parse_args(argv)
    report = run(a.dataset_path, a.models_dir, a.figures_dir, a.max_samples, a.tpr, a.leaf_keep,
                 a.junk_dir, a.synthetic_junk, write=not a.dry_run)
    c, o = report["calibration"], report["ood"]
    print(json.dumps({k: v for k, v in c.items() if not k.startswith("reliability")}, indent=2))
    print(json.dumps(o, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
