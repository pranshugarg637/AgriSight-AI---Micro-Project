"""
POST /api/predict -- the full pipeline endpoint (see app/pipeline.py).

Image -> validation -> CNN inference -> confidence-aware diagnosis ->
Grad-CAM -> RAG retrieval -> grounded LLM generation -> faithfulness check ->
translation -> logging -> response.

Errors from any stage are translated into clean HTTP responses; no raw
stack traces are ever returned to the client.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.pipeline import PipelineError, run_prediction
from app.schemas.prediction import PredictionResponse

logger = logging.getLogger(__name__)
router = APIRouter()

CONFIDENCE_LEVEL_DISPLAY = {
    "high": "High confidence",
    "low": "Low confidence — verify diagnosis",
    "unreliable": "Unable to diagnose reliably",
}


@router.post("/predict", response_model=PredictionResponse)
async def predict(file: UploadFile = File(...), language: str = Form("en")):
    file_bytes = await file.read()
    try:
        return run_prediction(file_bytes, file.content_type, language)
    except PipelineError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
