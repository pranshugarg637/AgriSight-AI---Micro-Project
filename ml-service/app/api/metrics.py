"""
Exposes saved training/evaluation artifacts (accuracy, precision, recall, F1,
confusion matrix, per-class metrics) so the analytics dashboard / Power BI
can consume real, previously-computed model metrics -- never live-computed
or fabricated on request.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from app.config import get_settings

router = APIRouter()


@router.get("/evaluation-report")
async def get_evaluation_report():
    settings = get_settings()
    path = settings.MODEL_PATH.parent / "evaluation_report.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No evaluation report found. Train the model first: python -m app.training.train",
        )
    with open(path) as f:
        return json.load(f)


@router.get("/training-metrics")
async def get_training_metrics():
    settings = get_settings()
    path = settings.MODEL_PATH.parent / "training_metrics.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No training metrics found. Train the model first: python -m app.training.train",
        )
    with open(path) as f:
        return json.load(f)
