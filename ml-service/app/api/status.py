"""
Operational endpoints: health check, model status, knowledge base status,
and prediction history/analytics for Power BI consumption (Section 22).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app.inference.service import InferenceService
from app.rag.vector_store import VectorStore
from app.services.llm_service import check_ollama_health
from app.services.prediction_log import read_predictions
from app.schemas.prediction import (
    HealthResponse, ModelStatusResponse, KnowledgeBaseStatusResponse, AnalyticsHistoryResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    inference_service = InferenceService.get_instance()

    kb_ready = False
    try:
        kb_ready = not VectorStore().is_empty()
    except Exception:
        logger.warning("Could not check knowledge base status for health check.")

    llm_status = check_ollama_health()

    overall = "ok" if inference_service.is_ready() else "degraded"
    return HealthResponse(
        status=overall,
        model_loaded=inference_service.is_ready(),
        knowledge_base_ready=kb_ready,
        llm_reachable=llm_status["ollama_reachable"],
    )


@router.get("/model-status", response_model=ModelStatusResponse)
async def model_status():
    inference_service = InferenceService.get_instance()
    status = inference_service.status()
    return ModelStatusResponse(
        model_loaded=status["model_loaded"],
        error=status["error"],
        backbone=status["backbone"],
        num_classes=status["num_classes"],
        model_version=status["model_version"],
    )


@router.get("/knowledge-base-status", response_model=KnowledgeBaseStatusResponse)
async def knowledge_base_status():
    try:
        store = VectorStore()
        return KnowledgeBaseStatusResponse(ready=not store.is_empty(), num_chunks=store.count())
    except Exception as e:
        logger.exception("Failed to check knowledge base status")
        return KnowledgeBaseStatusResponse(ready=False, num_chunks=0, error=str(e))


@router.get("/analytics/history", response_model=AnalyticsHistoryResponse)
async def analytics_history(limit: int = Query(default=500, ge=1, le=5000)):
    records = read_predictions(limit=limit)
    return AnalyticsHistoryResponse(predictions=records, count=len(records))


@router.get("/analytics/export.csv")
async def analytics_export_csv():
    """Flat CSV export for direct Power BI ingestion (Section 22)."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    records = read_predictions()
    buffer = io.StringIO()
    fieldnames = ["timestamp", "crop", "predicted_disease", "confidence",
                  "confidence_level", "model_version", "retrieval_status"]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for r in records:
        writer.writerow(r)
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=predictions_export.csv"},
    )
