"""
Held-out test evaluation for the lesion-segmentation model.

Usage (after `python -m app.segmentation.train`):
    python -m app.segmentation.evaluate
    python -m app.segmentation.evaluate --dataset-path D:/data/segmentation

Writes models/seg_evaluation_report.json with mean + micro Dice and IoU,
pixel precision/recall, boundary F1, the Dice distribution, Dice by lesion
size and the worst images. Every number comes from running the model on the
test split -- nothing is typed in by hand.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from app.config import get_settings
from app.segmentation.dataset import SegmentationDataset, split_pairs, validate_segmentation_dataset
from app.segmentation.metrics import SegmentationMetricAccumulator
from app.segmentation.model import build_seg_model

logger = logging.getLogger(__name__)


@torch.no_grad()
def evaluate_segmentation(model, loader, device, threshold: float, names: list[str] | None = None,
                          compute_boundary: bool = True, boundary_tolerance: int = 2,
                          criterion=None) -> tuple[dict, float | None]:
    """
    Runs the model over `loader` (must NOT be shuffled if `names` is given)
    and returns (summary_dict, mean_loss_or_None).
    """
    model.eval()
    acc = SegmentationMetricAccumulator(boundary_tolerance=boundary_tolerance, compute_boundary=compute_boundary)
    total_loss, total_n, i = 0.0, 0, 0
    for images, masks in loader:
        images, masks = images.to(device), masks.to(device)
        logits = model(images)
        if criterion is not None:
            total_loss += float(criterion(logits, masks).item()) * images.size(0)
            total_n += images.size(0)
        preds = (torch.sigmoid(logits) >= threshold).cpu().numpy()[:, 0]
        trues = (masks >= 0.5).cpu().numpy()[:, 0]
        for p, t in zip(preds, trues):
            acc.add(p, t, name=names[i] if names else None)
            i += 1
    summary = acc.summary()
    return summary, (total_loss / total_n if total_n else None)


def save_seg_report(report: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(report, f, indent=2)


def seg_report_path(settings=None) -> Path:
    settings = settings or get_settings()
    return settings.SEG_MODEL_PATH.parent / "seg_evaluation_report.json"


def seg_training_metrics_path(settings=None) -> Path:
    settings = settings or get_settings()
    return settings.SEG_MODEL_PATH.parent / "seg_training_metrics.json"


def build_test_report(model, test_pairs, seg_config: dict, device, threshold: float,
                      batch_size: int = 8, num_workers: int = 0) -> dict:
    if not test_pairs:
        raise ValueError("The test split is empty; cannot evaluate. Add more image/mask pairs.")
    loader = DataLoader(SegmentationDataset(test_pairs, seg_config["image_size"], train=False),
                        batch_size=batch_size, shuffle=False, num_workers=num_workers)
    summary, _ = evaluate_segmentation(model, loader, device, threshold, names=[p.name for p in test_pairs])
    return {
        "task": "lesion_segmentation",
        "split": "test",
        "dataset_name": seg_config.get("dataset_name"),
        "n_test_images": len(test_pairs),
        "threshold": threshold,
        "evaluated_at_resolution": f"{seg_config['image_size']}x{seg_config['image_size']}",
        "model_version": seg_config.get("model_version"),
        "evaluated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "metrics": summary,
        "notes": [
            "mean_* = average over images (each image counts equally).",
            "micro_* = pixels summed over the whole test set (large lesions weigh more).",
            "Empty-mask rule: both empty -> 1.0, exactly one empty -> 0.0.",
        ],
    }


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Evaluate the lesion-segmentation model on the test split.")
    parser.add_argument("--dataset-path", type=str, default=str(settings.SEG_DATASET_PATH))
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--batch-size", type=int, default=settings.SEG_BATCH_SIZE)
    args = parser.parse_args()

    for p in (settings.SEG_MODEL_PATH, settings.SEG_CONFIG_PATH):
        if not Path(p).exists():
            raise SystemExit(f"Missing {p}. Train first: python -m app.segmentation.train")
    with open(settings.SEG_CONFIG_PATH) as f:
        seg_config = json.load(f)

    report = validate_segmentation_dataset(Path(args.dataset_path), min_pairs=3)
    _, _, test_pairs = split_pairs(report["pairs"], seg_config["val_split"], seg_config["test_split"],
                                   seg_config.get("seed", 42))

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_seg_model(pretrained_encoder=False)
    model.load_state_dict(torch.load(settings.SEG_MODEL_PATH, map_location=device))
    model.to(device)

    threshold = args.threshold if args.threshold is not None else seg_config.get("threshold", settings.SEG_THRESHOLD)
    test_report = build_test_report(model, test_pairs, seg_config, device, threshold, batch_size=args.batch_size)
    save_seg_report(test_report, seg_report_path(settings))
    m = test_report["metrics"]
    logger.info("Test Dice (mean/micro): %.4f / %.4f   IoU (mean/micro): %.4f / %.4f   n=%d",
                m["mean_dice"], m["micro_dice"], m["mean_iou"], m["micro_iou"], m["n_images"])
    logger.info("Report written to %s", seg_report_path(settings))


if __name__ == "__main__":
    main()
