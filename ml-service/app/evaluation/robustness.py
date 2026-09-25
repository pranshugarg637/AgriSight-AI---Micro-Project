"""
Robustness suite: how accuracy and confidence behave under realistic image
degradations, on YOUR held-out test split.

    cd ml-service
    python -m app.evaluation.robustness --max-samples 1000 --out ../models/robustness_report.json

Perturbations (each applied to the same test images):
  blur (Gaussian radius 1, 2, 4), low light (brightness x0.5, x0.3),
  JPEG compression (quality 30, 10), rotation (15, 45, 90 degrees),
  partial occlusion (25% / 50% of the image covered by a grey block),
  plus synthetic junk images (should NOT be diagnosed).

Reported per perturbation: top-1 accuracy, mean top-1 probability (with the
calibrated temperature if configured), share of each confidence tier, and
the share rejected by the OOD gate (if fitted). Nothing is reported that was
not measured in the run.
"""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

from app.config import get_settings


def _jpeg(img, q):
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=q)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _occlude(img, frac):
    img = img.copy()
    w, h = img.size
    side = int((frac ** 0.5) * min(w, h))
    x0, y0 = (w - side) // 2, (h - side) // 2
    img.paste((128, 128, 128), [x0, y0, x0 + side, y0 + side])
    return img


PERTURBATIONS = {
    "clean": lambda im: im,
    "blur_r1": lambda im: im.filter(ImageFilter.GaussianBlur(1)),
    "blur_r2": lambda im: im.filter(ImageFilter.GaussianBlur(2)),
    "blur_r4": lambda im: im.filter(ImageFilter.GaussianBlur(4)),
    "low_light_x0.5": lambda im: ImageEnhance.Brightness(im).enhance(0.5),
    "low_light_x0.3": lambda im: ImageEnhance.Brightness(im).enhance(0.3),
    "jpeg_q30": lambda im: _jpeg(im, 30),
    "jpeg_q10": lambda im: _jpeg(im, 10),
    "rotate_15": lambda im: im.rotate(15, fillcolor=(0, 0, 0)),
    "rotate_45": lambda im: im.rotate(45, fillcolor=(0, 0, 0)),
    "rotate_90": lambda im: im.rotate(90),
    "occlusion_25": lambda im: _occlude(im, 0.25),
    "occlusion_50": lambda im: _occlude(im, 0.50),
}


def summarise(logits, labels, imgs, cfg, settings):
    from app.calibration.temperature import softmax
    from app.inference.ood import OODConfig, ood_reason

    T = float(cfg.get("temperature", 1.0))
    p = softmax(logits, T)
    conf = p.max(1)
    out = {
        "n": int(len(conf)),
        "mean_top1_probability": float(conf.mean()),
        "tier_share": {
            "high": float((conf >= settings.HIGH_CONFIDENCE_THRESHOLD).mean()),
            "low": float(((conf >= settings.LOW_CONFIDENCE_THRESHOLD) & (conf < settings.HIGH_CONFIDENCE_THRESHOLD)).mean()),
            "unreliable": float((conf < settings.LOW_CONFIDENCE_THRESHOLD).mean()),
        },
    }
    if labels is not None:
        out["accuracy"] = float((p.argmax(1) == labels).mean())
    ood = OODConfig.from_model_config(cfg)
    if ood.enabled:
        rej = [ood_reason(logits[i:i + 1], imgs[i], ood)[0] is not None for i in range(len(imgs))]
        out["ood_rejected_share"] = float(np.mean(rej))
    return out


def run(dataset_path: Path, models_dir: Path, max_samples: int | None = 1000, seed: int = 0, junk: int = 70) -> dict:
    import torch
    from torchvision import transforms

    from app.calibration.fit import compute_logits, load_split_items
    from app.calibration.synthetic_junk import synthetic_junk_images
    from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD
    from app.training.model_factory import build_model

    s = get_settings()
    cfg = json.loads((models_dir / "model_config.json").read_text())
    model = build_model(cfg["backbone"], num_classes=cfg["num_classes"], freeze_backbone=False, pretrained=False)
    model.load_state_dict(torch.load(models_dir / "plant_disease_model.pt", map_location="cpu"))
    model.eval()
    size = cfg["image_size"]
    pre = transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(), transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD)])

    _, test_items, _ = load_split_items(dataset_path, max_samples, seed)
    base = [Image.open(p).convert("RGB") for p, _ in test_items]
    labels = np.array([y for _, y in test_items])
    report = {"model_version": cfg.get("model_version"), "calibrated": "temperature" in cfg, "results": {}}
    for name, fn in PERTURBATIONS.items():
        imgs = [fn(im) for im in base]
        report["results"][name] = summarise(compute_logits(model, imgs, pre, "cpu"), labels, imgs, cfg, s)
    if junk:
        jimgs = [im for _, im in synthetic_junk_images(junk, seed=seed)]
        report["results"]["synthetic_junk (should not be diagnosed)"] = summarise(compute_logits(model, jimgs, pre, "cpu"), None, jimgs, cfg, s)
    return report


def main(argv=None) -> int:
    s = get_settings()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset-path", type=Path, default=s.DATASET_PATH)
    ap.add_argument("--models-dir", type=Path, default=s.MODEL_PATH.parent)
    ap.add_argument("--max-samples", type=int, default=1000)
    ap.add_argument("--out", type=Path, default=s.MODEL_PATH.parent / "robustness_report.json")
    a = ap.parse_args(argv)
    report = run(a.dataset_path, a.models_dir, a.max_samples)
    a.out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
