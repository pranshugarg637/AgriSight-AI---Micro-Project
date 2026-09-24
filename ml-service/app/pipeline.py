"""
The diagnosis pipeline as one function with named stages, so the same code
serves both the plain JSON endpoint and the Server-Sent-Events endpoint.

Stages (emitted as events, in order):
  validate -> classify -> explain -> retrieve -> generate -> verify -> translate

Safety behaviour preserved from v1:
  * "unreliable" confidence stops before RAG/LLM (retrieval_status
    "skipped_low_confidence").
  * RAG safety rule: success / insufficient_evidence / knowledge_base_empty;
    the LLM never falls back to its own knowledge.
  * dataset disclaimer on every response.
"""
from __future__ import annotations

import logging
from typing import Callable

from app.config import get_settings
from app.inference.image_validation import validate_image
from app.inference.service import InferenceService, ModelNotLoadedError
from app.rag.retrieval import retrieve_evidence
from app.rag.vector_store import VectorStore
from app.services.llm_service import generate_grounded_explanation, LLMServiceError
from app.services.prediction_log import log_prediction
from app.schemas.prediction import PredictionResponse, AlternativeDiagnosis, SourceCitation, CandidateProbability
from app.translation import get_translation_service

logger = logging.getLogger(__name__)

STAGES = ("validate", "classify", "explain", "retrieve", "generate", "verify", "translate")

GRADCAM_NOTE = (
    "Highlighted (warmer-colored) regions of the leaf influenced the model's prediction most. "
    "This shows correlation with the model's decision, not proof that the diagnosis is correct."
)

Emit = Callable[[str, str, dict | None], None]


class PipelineError(Exception):
    def __init__(self, status_code: int, detail: str, stage: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.stage = stage


def _noop(stage: str, status: str, info: dict | None = None) -> None:
    return None


def normalise_language(language: str | None) -> str:
    settings = get_settings()
    lang = (language or "en").strip().lower()
    return lang if lang in settings.SUPPORTED_LANGUAGES else "en"


def _split_class(class_name: str, default_crop: str) -> tuple[str, str]:
    crop, disease = default_crop, class_name.split("___", 1)[-1].replace("_", " ")
    if "___" in class_name:
        crop = class_name.split("___", 1)[0].replace("_", " ")
    return crop.strip(), disease.strip()


def run_prediction(file_bytes: bytes, content_type: str | None, language: str | None = "en",
                   emit: Emit | None = None) -> PredictionResponse:
    emit = emit or _noop
    language = normalise_language(language)

    # 1. validate
    emit("validate", "start", None)
    validation = validate_image(file_bytes, content_type)
    if not validation.is_valid:
        raise PipelineError(422, validation.reason, "validate")
    emit("validate", "done", None)

    # 2. classify (+ calibration / OOD inside the inference service)
    emit("classify", "start", None)
    inference_service = InferenceService.get_instance()
    try:
        result = inference_service.predict(validation.image)
    except ModelNotLoadedError as e:
        raise PipelineError(503, str(e), "classify")
    except Exception:
        logger.exception("Inference failed")
        raise PipelineError(500, "Prediction failed due to an internal error.", "classify")

    diagnosis = result["diagnosis"]
    crop, disease = result["crop"], result["disease"]
    emit("classify", "done", {"confidence_level": diagnosis.confidence_level})

    alternatives_out, alternative_disease_names = [], []
    for alt in diagnosis.alternatives:
        alt_crop, alt_disease = _split_class(alt.class_name, crop)
        alternatives_out.append(AlternativeDiagnosis(crop=alt_crop, disease=alt_disease, confidence=alt.probability,
                                                     class_key=alt.class_name))
        alternative_disease_names.append(alt_disease)

    top_candidates = []
    for cp in result["class_probabilities"][:5]:
        c_crop, c_disease = _split_class(cp.class_name, crop)
        top_candidates.append(CandidateProbability(class_key=cp.class_name, crop=c_crop, disease=c_disease,
                                                   probability=cp.probability))

    common = dict(
        diagnosis=disease,
        crop=crop,
        class_key=diagnosis.top_class,
        confidence=diagnosis.top_confidence,
        confidence_level=diagnosis.confidence_level,
        unreliable_reason=getattr(diagnosis, "unreliable_reason", None),
        confidence_message=diagnosis.message,
        alternatives=alternatives_out,
        top_candidates=top_candidates,
        gradcam_image_base64=result["gradcam_base64"],
        model_version=result.get("model_version"),
        calibrated=result.get("calibrated", False),
        language=language,
    )
    emit("explain", "done", None)  # Grad-CAM is produced together with the prediction

    # Unreliable -> stop before RAG/LLM.
    if not diagnosis.is_reliable and diagnosis.confidence_level == "unreliable":
        log_prediction(
            crop, disease, diagnosis.top_confidence, diagnosis.confidence_level,
            [{"disease": a.disease, "confidence": a.confidence} for a in alternatives_out],
            result.get("model_version"), retrieval_status="skipped_low_confidence",
        )
        for stage in ("retrieve", "generate", "verify", "translate"):
            emit(stage, "skipped", {"reason": "unreliable"})
        return PredictionResponse(
            **common, is_reliable=False, explanation=None, sources=[],
            retrieval_status="skipped_low_confidence",
        )

    # 3. retrieve
    emit("retrieve", "start", None)
    try:
        retrieval = retrieve_evidence(
            crop=crop, disease=disease, confidence=diagnosis.top_confidence,
            alternatives=alternative_disease_names, vector_store=VectorStore(),
        )
    except Exception:
        logger.exception("Retrieval failed")
        retrieval = None
    if retrieval is None:
        retrieval_status, evidence_chunks = "insufficient_evidence", []
    else:
        retrieval_status, evidence_chunks = retrieval.status, retrieval.chunks
    emit("retrieve", "done", {"retrieval_status": retrieval_status})

    # 4. generate (grounded LLM)
    emit("generate", "start", None)
    try:
        explanation = generate_grounded_explanation(
            crop=crop, disease=disease, confidence=diagnosis.top_confidence,
            confidence_level=diagnosis.confidence_level, alternatives=alternative_disease_names,
            gradcam_note=GRADCAM_NOTE, evidence_chunks=evidence_chunks, retrieval_status=retrieval_status,
        )
    except LLMServiceError as e:
        logger.warning("LLM generation unavailable: %s", e)
        explanation = None
    emit("generate", "done", {"has_explanation": explanation is not None})

    # 5. verify (citation faithfulness -- Step 5)
    emit("verify", "start", None)
    faithfulness = None
    try:
        from app.faithfulness import check_explanation

        faithfulness = check_explanation(explanation, evidence_chunks, retrieval_status)
        if faithfulness is not None and faithfulness.filtered_explanation is not None:
            explanation = faithfulness.filtered_explanation
    except ImportError:
        pass
    emit("verify", "done", None)

    # 6. translate (English stays the source of truth)
    translation = None
    if language != "en" and explanation:
        emit("translate", "start", None)
        translation = get_translation_service().translate_markdown(explanation, target=language)
        emit("translate", "done", {"status": translation.status})
    else:
        emit("translate", "skipped", None)

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
        **common,
        is_reliable=diagnosis.is_reliable,
        gradcam_note=GRADCAM_NOTE,
        explanation=explanation,
        explanation_translated=translation.text if translation else None,
        translation_backend=translation.backend if translation else None,
        translation_status=translation.status if translation else "not_requested",
        faithfulness=faithfulness.to_schema() if faithfulness is not None else None,
        sources=sources,
        retrieval_status=retrieval_status,
    )
