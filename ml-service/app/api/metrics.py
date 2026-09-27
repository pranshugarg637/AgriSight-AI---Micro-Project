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


# --- Lesion segmentation add-on (see docs/segmentation.md) -------------------

@router.get("/segmentation-report")
async def get_segmentation_report():
    """Test-set Dice / IoU / precision / recall written by app.segmentation.train/evaluate."""
    from app.segmentation.evaluate import seg_report_path

    path = seg_report_path()
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No segmentation report found. Train it first: python -m app.segmentation.train",
        )
    with open(path) as f:
        return json.load(f)


@router.get("/segmentation-training-metrics")
async def get_segmentation_training_metrics():
    from app.segmentation.evaluate import seg_training_metrics_path

    path = seg_training_metrics_path()
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No segmentation training metrics found. Train it first: python -m app.segmentation.train",
        )
    with open(path) as f:
        return json.load(f)
