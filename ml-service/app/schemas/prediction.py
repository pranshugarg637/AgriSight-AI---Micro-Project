"""
Pydantic models defining the API's response schemas (Section 19).
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AlternativeDiagnosis(BaseModel):
    crop: str
    disease: str
    confidence: float
    class_key: str | None = None


class CandidateProbability(BaseModel):
    """Top-k calibrated class probabilities (used by symptom-question refinement)."""
    class_key: str
    crop: str
    disease: str
    probability: float


class FaithfulnessReport(BaseModel):
    checked: bool
    backend: str
    total_sentences: int = 0
    unsupported_sentences: list[str] = []
    unsupported_rate: float | None = None
    action: str = "none"  # "none" | "removed_unsupported" | "flagged"


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
    # --- v2 additive fields ---
    class_key: str | None = Field(default=None, description="Raw class id, e.g. 'Tomato___Late_blight'")
    unreliable_reason: str | None = Field(
        default=None, description="null | 'low_confidence' | 'not_a_leaf' | 'unsupported_crop'")
    top_candidates: list[CandidateProbability] = []
    calibrated: bool = False
    language: str = "en"
    explanation_translated: str | None = None
    translation_backend: str | None = None
    translation_status: str = "not_requested"
    faithfulness: FaithfulnessReport | None = None
    question_pair: str | None = Field(default=None, description="Cited symptom-question set id when top-2 are close")
    gradcam_image_base64: str | None = None
    gradcam_note: str = "Highlighted regions indicate areas that influenced the model's prediction."
    # --- lesion segmentation add-on (additive, optional; see docs/segmentation.md) ---
    segmentation_status: str = Field(
        default="not_run",
        description="'success' | 'model_not_available' | 'disabled' | 'skipped_healthy' | "
                    "'skipped_unreliable' | 'error' | 'not_run'")
    lesion_mask_base64: str | None = Field(default=None, description="PNG: leaf with predicted lesions in red")
    severity_percent: float | None = Field(
        default=None, description="Estimated % of the leaf covered by lesions (null if it could not be estimated)")
    severity_band: str | None = Field(default=None, description="null | 'mild' | 'moderate' | 'severe'")
    segmentation_note: str = (
        "Affected area is an estimate from a separate lesion-segmentation model; the leaf outline "
        "comes from a simple colour rule. It is a rough guide to how widespread the damage is, not a "
        "measurement. The model's Dice/IoU scores on its test set are shown on the metrics page."
    )
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
    # lesion segmentation add-on
    seg_model_loaded: bool = False
    seg_model_error: str | None = None
    seg_model_version: str | None = None


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
