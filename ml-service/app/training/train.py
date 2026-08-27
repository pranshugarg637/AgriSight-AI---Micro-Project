"""
Training entrypoint for the plant disease classifier.

Usage:
    python -m app.training.train
    python -m app.training.train --dataset-path /custom/path --epochs 20

This script:
  1. Validates the dataset structure.
  2. Loads train/val/test splits with augmentation on train only.
  3. Builds a transfer-learning model (frozen backbone + new head).
  4. Trains the head, then unfreezes top layers for fine-tuning.
  5. Applies early stopping on validation loss.
  6. Saves the best checkpoint, class names, config, and metrics to disk.
  7. Runs full evaluation (accuracy/precision/recall/F1/confusion matrix)
     on the held-out test split and saves the report.

No accuracy numbers are fabricated: whatever the run produces is what gets
written to models/training_metrics.json and models/evaluation_report.json.
"""
from __future__ import annotations

import argparse
import copy
import json
import logging
import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from app.config import get_settings
from app.training.dataset import load_datasets, save_class_names, validate_dataset_structure
from app.training.model_factory import build_model, unfreeze_last_n_layers
from app.training.evaluate import evaluate_model, save_evaluation_report

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():  # Apple Silicon
        return torch.device("mps")
    return torch.device("cpu")


def run_epoch(model, loader, criterion, optimizer, device, train: bool) -> tuple[float, float]:
    model.train() if train else model.eval()
    total_loss, correct, total = 0.0, 0, 0

    context = torch.enable_grad() if train else torch.no_grad()
    with context:
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            if train:
                optimizer.zero_grad()

            outputs = model(images)
            loss = criterion(outputs, labels)

            if train:
                loss.backward()
                optimizer.step()

            total_loss += loss.item() * images.size(0)
            preds = outputs.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += images.size(0)

    return total_loss / max(total, 1), correct / max(total, 1)


def train_phase(model, train_loader, val_loader, device, epochs, lr, patience, phase_name: str):
    """Runs a training phase (head-only or fine-tuning) with early stopping."""
    criterion = nn.CrossEntropyLoss()
    trainable_params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.Adam(trainable_params, lr=lr)

    best_val_loss = float("inf")
    best_state = copy.deepcopy(model.state_dict())
    epochs_without_improvement = 0
    history = []

    for epoch in range(1, epochs + 1):
        t0 = time.time()
        train_loss, train_acc = run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        val_loss, val_acc = run_epoch(model, val_loader, criterion, optimizer, device, train=False)
        elapsed = time.time() - t0

        logger.info(
            "[%s] epoch %d/%d - train_loss=%.4f train_acc=%.4f val_loss=%.4f val_acc=%.4f (%.1fs)",
            phase_name, epoch, epochs, train_loss, train_acc, val_loss, val_acc, elapsed,
        )
        history.append(
            {"epoch": epoch, "train_loss": train_loss, "train_acc": train_acc,
             "val_loss": val_loss, "val_acc": val_acc}
        )

        if val_loss < best_val_loss - 1e-4:
            best_val_loss = val_loss
            best_state = copy.deepcopy(model.state_dict())
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= patience:
                logger.info("[%s] Early stopping triggered after %d epochs without improvement.",
                            phase_name, patience)
                break

    model.load_state_dict(best_state)
    return model, history, best_val_loss


def main():
    settings = get_settings()

    parser = argparse.ArgumentParser(description="Train the plant disease classifier.")
    parser.add_argument("--dataset-path", type=str, default=str(settings.DATASET_PATH))
    parser.add_argument("--epochs", type=int, default=settings.NUM_EPOCHS)
    parser.add_argument("--fine-tune-epochs", type=int, default=max(5, settings.NUM_EPOCHS // 2))
    parser.add_argument("--batch-size", type=int, default=settings.BATCH_SIZE)
    parser.add_argument("--lr", type=float, default=settings.LEARNING_RATE)
    parser.add_argument("--backbone", type=str, default=settings.BACKBONE)
    parser.add_argument("--image-size", type=int, default=settings.IMAGE_SIZE)
    parser.add_argument("--patience", type=int, default=settings.EARLY_STOPPING_PATIENCE)
    parser.add_argument("--num-workers", type=int, default=2)
    args = parser.parse_args()

    dataset_path = Path(args.dataset_path)
    logger.info("Validating dataset at %s ...", dataset_path)
    report = validate_dataset_structure(dataset_path)
    logger.info("Dataset OK: %s", report)

    device = get_device()
    logger.info("Using device: %s", device)

    train_set, val_set, test_set, class_names = load_datasets(
        dataset_path, args.image_size, settings.VAL_SPLIT, settings.TEST_SPLIT
    )
    logger.info("Split sizes -> train=%d val=%d test=%d classes=%d",
                len(train_set), len(val_set), len(test_set), len(class_names))

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=args.num_workers)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers)
    test_loader = DataLoader(test_set, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers)

    model = build_model(args.backbone, num_classes=len(class_names), freeze_backbone=True).to(device)

    # Phase 1: train the new classifier head only
    model, head_history, _ = train_phase(
        model, train_loader, val_loader, device,
        epochs=args.epochs, lr=args.lr, patience=args.patience, phase_name="head-training",
    )

    # Phase 2: fine-tune top layers of the backbone at a lower LR
    unfreeze_last_n_layers(model, args.backbone, n=20)
    model, finetune_history, _ = train_phase(
        model, train_loader, val_loader, device,
        epochs=args.fine_tune_epochs, lr=args.lr / 10, patience=args.patience, phase_name="fine-tuning",
    )

    # Save model artifacts
    settings.MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), settings.MODEL_PATH)
    save_class_names(class_names, settings.CLASS_NAMES_PATH)

    model_config = {
        "backbone": args.backbone,
        "num_classes": len(class_names),
        "image_size": args.image_size,
        "model_version": settings.MODEL_VERSION,
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(settings.MODEL_CONFIG_PATH, "w") as f:
        json.dump(model_config, f, indent=2)

    training_metrics = {
        "dataset_report": report,
        "head_training_history": head_history,
        "fine_tuning_history": finetune_history,
    }
    metrics_path = settings.MODEL_PATH.parent / "training_metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(training_metrics, f, indent=2)

    # Final evaluation on held-out test set (real numbers, not fabricated)
    logger.info("Running final evaluation on test set...")
    eval_report = evaluate_model(model, test_loader, class_names, device)
    save_evaluation_report(eval_report, settings.MODEL_PATH.parent / "evaluation_report.json")

    logger.info("Training complete. Test accuracy: %.4f", eval_report["accuracy"])
    logger.info("Artifacts saved to: %s", settings.MODEL_PATH.parent)


if __name__ == "__main__":
    main()
