"""
POST /api/predict -- the full pipeline endpoint.

Image -> validation -> CNN inference -> confidence-aware diagnosis ->
Grad-CAM -> RAG retrieval -> grounded LLM generation -> logging -> response.

Errors from any stage are caught and translated into clean HTTP responses;
no raw stack traces are ever returned to the client.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import get_settings
from app.inference.image_validation import validate_image
from app.inference.service import InferenceService, ModelNotLoadedError
from app.rag.retrieval import retrieve_evidence
from app.rag.vector_store import VectorStore
from app.services.llm_service import generate_grounded_explanation, LLMServiceError
from app.services.prediction_log import log_prediction
from app.schemas.prediction import PredictionResponse, AlternativeDiagnosis, SourceCitation

logger = logging.getLogger(__name__)
router = APIRouter()

CONFIDENCE_LEVEL_DISPLAY = {
    "high": "High confidence",
    "low": "Low confidence — verify diagnosis",
    "unreliable": "Unable to diagnose reliably",
}


@router.post("/predict", response_model=PredictionResponse)
async def predict(file: UploadFile = File(...)):
    settings = get_settings()

    # 1. Read + validate image (Section 17)
    file_bytes = await file.read()
    validation = validate_image(file_bytes, file.content_type)
    if not validation.is_valid:
        raise HTTPException(status_code=422, detail=validation.reason)

    # 2. CNN inference + confidence-aware diagnosis + Grad-CAM
    inference_service = InferenceService.get_instance()
    try:
        result = inference_service.predict(validation.image)
    except ModelNotLoadedError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Inference failed")
        raise HTTPException(status_code=500, detail="Prediction failed due to an internal error.")

    diagnosis = result["diagnosis"]
    crop = result["crop"]
    disease = result["disease"]

    alternatives_out = []
    alternative_disease_names = []
    for alt in diagnosis.alternatives:
        alt_crop, alt_disease = crop, alt.class_name.split("___", 1)[-1].replace("_", " ")
        if "___" in alt.class_name:
            alt_crop = alt.class_name.split("___", 1)[0].replace("_", " ")
        alternatives_out.append(AlternativeDiagnosis(crop=alt_crop, disease=alt_disease, confidence=alt.probability))
        alternative_disease_names.append(alt_disease)

    # If diagnosis is unreliable, skip RAG/LLM entirely -- nothing useful to ground.
    if not diagnosis.is_reliable and diagnosis.confidence_level == "unreliable":
        log_prediction(
            crop, disease, diagnosis.top_confidence, diagnosis.confidence_level,
            [{"disease": a.disease, "confidence": a.confidence} for a in alternatives_out],
            result.get("model_version"), retrieval_status="skipped_low_confidence",
        )
        return PredictionResponse(
            diagnosis=disease,
            crop=crop,
            confidence=diagnosis.top_confidence,
            confidence_level=diagnosis.confidence_level,
            is_reliable=False,
            confidence_message=diagnosis.message,
            alternatives=alternatives_out,
            gradcam_image_base64=result["gradcam_base64"],
            explanation=None,
            sources=[],
            retrieval_status="skipped_low_confidence",
            model_version=result.get("model_version"),
        )

    # 3. RAG retrieval (Section 9-13)
    try:
        vector_store = VectorStore()
        retrieval = retrieve_evidence(
            crop=crop, disease=disease, confidence=diagnosis.top_confidence,
            alternatives=alternative_disease_names, vector_store=vector_store,
        )
    except Exception:
        logger.exception("Retrieval failed")
        retrieval = None

    if retrieval is None:
        retrieval_status = "insufficient_evidence"
        evidence_chunks = []
    else:
        retrieval_status = retrieval.status
        evidence_chunks = retrieval.chunks

    # 4. Grounded LLM generation (Section 14-16)
    gradcam_note = (
        "Highlighted (warmer-colored) regions of the leaf influenced the model's prediction most. "
        "This shows correlation with the model's decision, not proof that the diagnosis is correct."
    )
    try:
        explanation = generate_grounded_explanation(
            crop=crop, disease=disease, confidence=diagnosis.top_confidence,
            confidence_level=diagnosis.confidence_level, alternatives=alternative_disease_names,
            gradcam_note=gradcam_note, evidence_chunks=evidence_chunks, retrieval_status=retrieval_status,
        )
    except LLMServiceError as e:
        logger.warning("LLM generation unavailable: %s", e)
        explanation = None

    sources = [
        SourceCitation(
            title=c.title, organization=c.organization, page=c.page_number,
            source_url=c.source_url or None, relevance_score=c.relevance_score,
            excerpt=(c.text[:280] + "...") if len(c.text) > 280 else c.text,
        )
        for c in evidence_chunks
    ]

    log_prediction(
        crop, disease, diagnosis.top_confidence, diagnosis.confidence_level,
        [{"disease": a.disease, "confidence": a.confidence} for a in alternatives_out],
        result.get("model_version"), retrieval_status,
    )

    return PredictionResponse(
        diagnosis=disease,
        crop=crop,
        confidence=diagnosis.top_confidence,
        confidence_level=diagnosis.confidence_level,
        is_reliable=diagnosis.is_reliable,
        confidence_message=diagnosis.message,
        alternatives=alternatives_out,
        gradcam_image_base64=result["gradcam_base64"],
        gradcam_note=gradcam_note,
        explanation=explanation,
        sources=sources,
        retrieval_status=retrieval_status,
        model_version=result.get("model_version"),
    )
