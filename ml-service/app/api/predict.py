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


@router.post("/predict/stream")
async def predict_stream(file: UploadFile = File(...), language: str = Form("en")):
    """
    Same pipeline, streamed as Server-Sent Events:
      event: stage   data: {"stage": "classify", "status": "start"|"done"|"skipped", ...}
      event: result  data: <PredictionResponse JSON>
      event: error   data: {"status_code": 422, "detail": "...", "stage": "validate"}
    Stages are emitted as the work actually happens (no simulated timing).
    """
    import asyncio
    import json
    import threading

    from fastapi.responses import StreamingResponse

    file_bytes = await file.read()
    content_type = file.content_type
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def emit(stage, status, info=None):
        payload = {"stage": stage, "status": status, **(info or {})}
        loop.call_soon_threadsafe(queue.put_nowait, ("stage", payload))

    def work():
        try:
            res = run_prediction(file_bytes, content_type, language, emit=emit)
            loop.call_soon_threadsafe(queue.put_nowait, ("result", res.model_dump()))
        except PipelineError as e:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", {"status_code": e.status_code, "detail": e.detail, "stage": e.stage}))
        except Exception:
            logger.exception("Streaming prediction failed")
            loop.call_soon_threadsafe(queue.put_nowait, ("error", {"status_code": 500, "detail": "Prediction failed due to an internal error."}))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=work, daemon=True).start()

    async def events():
        while True:
            item = await queue.get()
            if item is None:
                break
            kind, data = item
            yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
