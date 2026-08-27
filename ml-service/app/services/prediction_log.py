"""
Prediction logging: appends a structured record per prediction to a JSONL
file. No personal information is stored -- only prediction/model metadata,
per Section 22.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)


def log_prediction(
    crop: str,
    disease: str,
    confidence: float,
    confidence_level: str,
    alternatives: list[dict],
    model_version: str | None,
    retrieval_status: str,
) -> None:
    settings = get_settings()
    settings.PREDICTIONS_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "crop": crop,
        "predicted_disease": disease,
        "confidence": confidence,
        "confidence_level": confidence_level,
        "top_alternatives": alternatives,
        "model_version": model_version,
        "retrieval_status": retrieval_status,
    }

    try:
        with open(settings.PREDICTIONS_LOG_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")
    except OSError as e:
        # Logging failures must never break the user-facing prediction response.
        logger.error("Failed to write prediction log: %s", e)


def read_predictions(limit: int | None = None) -> list[dict]:
    settings = get_settings()
    if not settings.PREDICTIONS_LOG_PATH.exists():
        return []

    records = []
    with open(settings.PREDICTIONS_LOG_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    if limit:
        return records[-limit:]
    return records
