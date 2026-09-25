"""
FastAPI application entrypoint for the ML service.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import predict, status, metrics, refine
from app.security import InternalTokenMiddleware, assert_secure_configuration

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Evidence-Grounded Plant Disease Decision Support System - ML Service",
    description=(
        "Confidence-aware plant disease diagnosis using a specialized CNN, Grad-CAM "
        "explainability, and evidence-grounded RAG generation."
    ),
    version="1.0.0",
)

# v2: internal-only service. No CORS (browsers never call it directly) and
# every /api/* request must carry X-Internal-Token (see app/security.py).
assert_secure_configuration()
app.add_middleware(InternalTokenMiddleware)

app.include_router(predict.router, prefix="/api", tags=["prediction"])
app.include_router(status.router, prefix="/api", tags=["status"])
app.include_router(metrics.router, prefix="/api", tags=["metrics"])
app.include_router(refine.router, prefix="/api", tags=["symptom-questions"])


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Never leak raw stack traces to the client; log full detail server-side.
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "detail": "An unexpected error occurred."},
    )


@app.get("/")
async def root():
    return {"service": "plant-disease-ml-service", "status": "running"}


@app.get("/healthz")
async def healthz():
    """Unauthenticated liveness probe for container orchestration (no data)."""
    return {"status": "alive"}
