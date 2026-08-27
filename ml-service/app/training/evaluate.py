"""
Evaluation utilities shared by the training script and standalone evaluation runs.
Produces real, unmodified metrics -- nothing here inflates or fakes results.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)

logger = logging.getLogger(__name__)


def evaluate_model(model, data_loader, class_names: list[str], device) -> dict:
    model.eval()
    all_preds, all_labels = [], []

    with torch.no_grad():
        for images, labels in data_loader:
            images = images.to(device)
            outputs = model(images)
            preds = outputs.argmax(dim=1).cpu().numpy()
            all_preds.extend(preds.tolist())
            all_labels.extend(labels.numpy().tolist())

    if len(all_labels) == 0:
        raise ValueError("Evaluation dataset is empty; cannot compute metrics.")

    accuracy = accuracy_score(all_labels, all_preds)
    precision, recall, f1, support = precision_recall_fscore_support(
        all_labels, all_preds, average="weighted", zero_division=0
    )

    per_class_precision, per_class_recall, per_class_f1, per_class_support = precision_recall_fscore_support(
        all_labels, all_preds, average=None, zero_division=0, labels=list(range(len(class_names)))
    )

    cm = confusion_matrix(all_labels, all_preds, labels=list(range(len(class_names))))

    per_class_metrics = {}
    for idx, name in enumerate(class_names):
        per_class_metrics[name] = {
            "precision": float(per_class_precision[idx]),
            "recall": float(per_class_recall[idx]),
            "f1": float(per_class_f1[idx]),
            "support": int(per_class_support[idx]),
        }

    return {
        "accuracy": float(accuracy),
        "precision_weighted": float(precision),
        "recall_weighted": float(recall),
        "f1_weighted": float(f1),
        "confusion_matrix": cm.tolist(),
        "class_names": class_names,
        "per_class_metrics": per_class_metrics,
        "num_test_samples": len(all_labels),
    }


def save_evaluation_report(report: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(report, f, indent=2)
    logger.info("Evaluation report saved to %s", path)
