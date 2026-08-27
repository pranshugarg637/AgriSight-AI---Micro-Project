"""
Standalone evaluation entrypoint: loads a trained checkpoint and the dataset,
re-runs evaluation on the test split, and writes an evaluation_report.json.

Useful for re-evaluating a model without retraining, e.g. after collecting a
small manually-labeled real-world test set (see docs/evaluation.md).

Usage:
    python -m app.training.run_evaluation
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from app.config import get_settings
from app.training.dataset import load_datasets, validate_dataset_structure
from app.training.model_factory import build_model
from app.training.evaluate import evaluate_model, save_evaluation_report
from app.training.train import get_device

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def main():
    settings = get_settings()
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-path", type=str, default=str(settings.DATASET_PATH))
    args = parser.parse_args()

    if not settings.MODEL_PATH.exists():
        raise FileNotFoundError(
            f"No trained model found at {settings.MODEL_PATH}. Run `python -m app.training.train` first."
        )
    if not settings.MODEL_CONFIG_PATH.exists():
        raise FileNotFoundError(f"Missing model config at {settings.MODEL_CONFIG_PATH}.")
    if not settings.CLASS_NAMES_PATH.exists():
        raise FileNotFoundError(f"Missing class names file at {settings.CLASS_NAMES_PATH}.")

    with open(settings.MODEL_CONFIG_PATH) as f:
        model_config = json.load(f)
    with open(settings.CLASS_NAMES_PATH) as f:
        class_names = json.load(f)

    dataset_path = Path(args.dataset_path)
    validate_dataset_structure(dataset_path)

    _, _, test_set, loaded_class_names = load_datasets(
        dataset_path, model_config["image_size"], settings.VAL_SPLIT, settings.TEST_SPLIT
    )
    if loaded_class_names != class_names:
        logger.warning(
            "Class names in dataset differ from saved class_names.json. "
            "Using the saved class_names.json ordering to match model output indices."
        )

    device = get_device()
    model = build_model(
        model_config["backbone"], num_classes=model_config["num_classes"],
        freeze_backbone=False, pretrained=False,
    )
    model.load_state_dict(torch.load(settings.MODEL_PATH, map_location=device))
    model.to(device)

    test_loader = DataLoader(test_set, batch_size=32, shuffle=False)
    report = evaluate_model(model, test_loader, class_names, device)
    save_evaluation_report(report, settings.MODEL_PATH.parent / "evaluation_report.json")

    logger.info("Accuracy=%.4f Precision=%.4f Recall=%.4f F1=%.4f",
                report["accuracy"], report["precision_weighted"], report["recall_weighted"], report["f1_weighted"])


if __name__ == "__main__":
    main()
