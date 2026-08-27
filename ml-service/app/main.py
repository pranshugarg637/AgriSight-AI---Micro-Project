"""
FastAPI application entrypoint for the ML service.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import predict, status, metrics

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

# CORS: allow the Node backend (and, in dev, the React dev server) to call this service.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(predict.router, prefix="/api", tags=["prediction"])
app.include_router(status.router, prefix="/api", tags=["status"])
app.include_router(metrics.router, prefix="/api", tags=["metrics"])


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
