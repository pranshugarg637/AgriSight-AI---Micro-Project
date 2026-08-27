"""
Pydantic models defining the API's response schemas (Section 19).
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AlternativeDiagnosis(BaseModel):
    crop: str
    disease: str
    confidence: float


class SourceCitation(BaseModel):
    title: str
    organization: str
    page: int | None = None
    source_url: str | None = None
    relevance_score: float
    excerpt: str


class PredictionResponse(BaseModel):
    diagnosis: str
    crop: str
    confidence: float
    confidence_level: str = Field(description="'high' | 'moderate'->'low' | 'unreliable'")
    is_reliable: bool
    confidence_message: str
    alternatives: list[AlternativeDiagnosis] = []
    gradcam_image_base64: str | None = None
    gradcam_note: str = "Highlighted regions indicate areas that influenced the model's prediction."
    explanation: str | None = None
    sources: list[SourceCitation] = []
    retrieval_status: str  # "success" | "insufficient_evidence" | "knowledge_base_empty" | "skipped_low_confidence"
    model_version: str | None = None
    dataset_disclaimer: str = (
        "This model is trained and evaluated primarily on the PlantVillage dataset "
        "(controlled, lab-style images). Real-world field performance may differ due to "
        "lighting, background, camera quality, disease severity, and other environmental conditions."
    )


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    knowledge_base_ready: bool
    llm_reachable: bool


class ModelStatusResponse(BaseModel):
    model_loaded: bool
    error: str | None = None
    backbone: str | None = None
    num_classes: int
    model_version: str | None = None


class KnowledgeBaseStatusResponse(BaseModel):
    ready: bool
    num_chunks: int
    error: str | None = None


class PredictionLogEntry(BaseModel):
    timestamp: str
    crop: str
    predicted_disease: str
    confidence: float
    confidence_level: str
    top_alternatives: list[dict]
    model_version: str | None = None
    retrieval_status: str


class AnalyticsHistoryResponse(BaseModel):
    predictions: list[PredictionLogEntry]
    count: int
