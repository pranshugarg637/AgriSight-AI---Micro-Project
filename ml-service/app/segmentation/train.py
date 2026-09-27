"""
Training entrypoint for the lesion-segmentation add-on.

Usage:
    python -m app.segmentation.train
    python -m app.segmentation.train --dataset-path D:/data/segmentation --epochs 10 --batch-size 4

Steps:
  1. Validate data/segmentation/{images,masks} and pair files by name.
  2. Deterministic train/val/test split (seed saved in the config).
  3. Phase 1: frozen MobileNetV2 encoder, train the U-Net decoder.
  4. Phase 2: unfreeze the encoder, fine-tune everything at a lower LR.
     Both phases use early stopping on VALIDATION Dice (higher = better).
  5. Save models/lesion_seg_model.pt, lesion_seg_config.json,
     seg_training_metrics.json.
  6. Evaluate on the held-out test split -> models/seg_evaluation_report.json.

Runs on CPU. Defaults (256px, batch 8) fit in ~8 GB RAM; lower --batch-size
or --image-size if your laptop runs out of memory.
"""
from __future__ import annotations

import argparse
import copy
import json
import logging
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from app.config import get_settings
from app.segmentation.dataset import SegmentationDataset, split_pairs, validate_segmentation_dataset
from app.segmentation.evaluate import (
    build_test_report, evaluate_segmentation, save_seg_report, seg_report_path, seg_training_metrics_path,
)
from app.segmentation.losses import BCEDiceLoss
from app.segmentation.model import ENCODER_NAME, build_seg_model

logger = logging.getLogger(__name__)


def get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _train_one_epoch(model, loader, criterion, optimizer, device) -> float:
    model.train()
    total, n = 0.0, 0
    for images, masks in loader:
        images, masks = images.to(device), masks.to(device)
        optimizer.zero_grad()
        loss = criterion(model(images), masks)
        loss.backward()
        optimizer.step()
        total += float(loss.item()) * images.size(0)
        n += images.size(0)
    return total / max(n, 1)


def _train_phase(model, train_loader, val_loader, device, epochs, lr, patience, threshold, phase_name):
    criterion = BCEDiceLoss()
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.Adam(params, lr=lr)

    best_dice, best_state, stale, history = -1.0, copy.deepcopy(model.state_dict()), 0, []
    for epoch in range(1, epochs + 1):
        t0 = time.time()
        train_loss = _train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_summary, val_loss = evaluate_segmentation(
            model, val_loader, device, threshold, compute_boundary=False, criterion=criterion)
        row = {
            "epoch": epoch, "train_loss": train_loss, "val_loss": val_loss,
            "val_mean_dice": val_summary["mean_dice"], "val_micro_dice": val_summary["micro_dice"],
            "val_mean_iou": val_summary["mean_iou"], "val_micro_iou": val_summary["micro_iou"],
        }
        history.append(row)
        logger.info("[%s] epoch %d/%d train_loss=%.4f val_loss=%.4f val_dice=%.4f val_iou=%.4f (%.1fs)",
                    phase_name, epoch, epochs, train_loss, val_loss, row["val_mean_dice"],
                    row["val_mean_iou"], time.time() - t0)

        if row["val_mean_dice"] > best_dice + 1e-4:
            best_dice, best_state, stale = row["val_mean_dice"], copy.deepcopy(model.state_dict()), 0
        else:
            stale += 1
            if stale >= patience:
                logger.info("[%s] Early stopping: no val Dice improvement for %d epochs.", phase_name, patience)
                break
    model.load_state_dict(best_state)
    return model, history, best_dice


def train_segmentation(dataset_path: Path, *, epochs: int, fine_tune_epochs: int, lr: float, batch_size: int,
                       image_size: int, patience: int, threshold: float, num_workers: int = 0,
                       pretrained: bool = True, dataset_name: str | None = None, seed: int = 42,
                       val_split: float | None = None, test_split: float | None = None,
                       min_pairs: int = 10) -> dict:
    settings = get_settings()
    val_split = settings.VAL_SPLIT if val_split is None else val_split
    test_split = settings.TEST_SPLIT if test_split is None else test_split

    report = validate_segmentation_dataset(Path(dataset_path), min_pairs=min_pairs)
    pairs = report.pop("pairs")
    train_pairs, val_pairs, test_pairs = split_pairs(pairs, val_split, test_split, seed)
    logger.info("Split sizes -> train=%d val=%d test=%d", len(train_pairs), len(val_pairs), len(test_pairs))

    device = get_device()
    logger.info("Using device: %s", device)
    train_loader = DataLoader(SegmentationDataset(train_pairs, image_size, train=True),
                              batch_size=batch_size, shuffle=True, num_workers=num_workers, drop_last=len(train_pairs) > batch_size)
    val_loader = DataLoader(SegmentationDataset(val_pairs, image_size, train=False),
                            batch_size=batch_size, shuffle=False, num_workers=num_workers)

    model = build_seg_model(pretrained_encoder=pretrained, freeze_encoder=True).to(device)
    model, phase1, _ = _train_phase(model, train_loader, val_loader, device, epochs, lr, patience,
                                    threshold, "decoder-training")
    model.set_encoder_trainable(True)
    model, phase2, best_val_dice = _train_phase(model, train_loader, val_loader, device, fine_tune_epochs,
                                                lr / 10, patience, threshold, "fine-tuning")

    settings.SEG_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), settings.SEG_MODEL_PATH)
    seg_config = {
        "task": "lesion_segmentation",
        "architecture": "unet",
        "encoder": ENCODER_NAME,
        "image_size": image_size,
        "threshold": threshold,
        "model_version": settings.SEG_MODEL_VERSION,
        "dataset_name": dataset_name or Path(dataset_path).name,
        "seed": seed,
        "val_split": val_split,
        "test_split": test_split,
        "split_sizes": {"train": len(train_pairs), "val": len(val_pairs), "test": len(test_pairs)},
        "pretrained_encoder": pretrained,
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(settings.SEG_CONFIG_PATH, "w") as f:
        json.dump(seg_config, f, indent=2)

    training_metrics = {
        "dataset_report": report,
        "decoder_training_history": phase1,
        "fine_tuning_history": phase2,
        "best_val_mean_dice": best_val_dice,
    }
    with open(seg_training_metrics_path(settings), "w") as f:
        json.dump(training_metrics, f, indent=2)

    logger.info("Evaluating on the held-out test split ...")
    test_report = build_test_report(model, test_pairs, seg_config, device, threshold,
                                    batch_size=batch_size, num_workers=num_workers)
    save_seg_report(test_report, seg_report_path(settings))
    m = test_report["metrics"]
    logger.info("Test Dice (mean/micro): %.4f / %.4f   IoU (mean/micro): %.4f / %.4f",
                m["mean_dice"], m["micro_dice"], m["mean_iou"], m["micro_iou"])
    logger.info("Artifacts saved to %s", settings.SEG_MODEL_PATH.parent)
    return {"config": seg_config, "training_metrics": training_metrics, "test_report": test_report}


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Train the lesion-segmentation (U-Net) model.")
    parser.add_argument("--dataset-path", type=str, default=str(settings.SEG_DATASET_PATH))
    parser.add_argument("--dataset-name", type=str, default=None,
                        help="Name recorded in reports, e.g. 'PlantSeg' (default: folder name)")
    parser.add_argument("--epochs", type=int, default=settings.SEG_NUM_EPOCHS, help="phase 1 (frozen encoder) epochs")
    parser.add_argument("--fine-tune-epochs", type=int, default=max(5, settings.SEG_NUM_EPOCHS // 2))
    parser.add_argument("--lr", type=float, default=settings.SEG_LEARNING_RATE)
    parser.add_argument("--batch-size", type=int, default=settings.SEG_BATCH_SIZE)
    parser.add_argument("--image-size", type=int, default=settings.SEG_IMAGE_SIZE)
    parser.add_argument("--patience", type=int, default=settings.SEG_EARLY_STOPPING_PATIENCE)
    parser.add_argument("--threshold", type=float, default=settings.SEG_THRESHOLD)
    parser.add_argument("--num-workers", type=int, default=0, help="0 is safest on Windows")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-pretrained", action="store_true",
                        help="Start the encoder from random weights (no download). Expect worse results.")
    args = parser.parse_args()

    train_segmentation(
        Path(args.dataset_path), epochs=args.epochs, fine_tune_epochs=args.fine_tune_epochs, lr=args.lr,
        batch_size=args.batch_size, image_size=args.image_size, patience=args.patience,
        threshold=args.threshold, num_workers=args.num_workers, pretrained=not args.no_pretrained,
        dataset_name=args.dataset_name, seed=args.seed,
    )


if __name__ == "__main__":
    main()
