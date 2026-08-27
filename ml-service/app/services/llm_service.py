"""
LLM integration via Ollama (local inference server, model: llama3.2 by default).

The LLM's role is strictly limited to (Section 14):
  - explaining the diagnosis
  - summarizing retrieved evidence
  - explaining symptoms/causes FROM the evidence
  - communicating uncertainty
  - citing sources
It never independently diagnoses the image, and it is explicitly instructed
never to invent facts, citations, or unsupported treatment advice.
"""
from __future__ import annotations

import json
import logging

import httpx

from app.config import get_settings
from app.rag.retrieval import RetrievedChunk

logger = logging.getLogger(__name__)


class LLMServiceError(Exception):
    """Raised when the LLM backend is unreachable or returns an error."""


SYSTEM_PROMPT = """You are an agricultural assistant helping explain a plant disease diagnosis to a farmer.

STRICT RULES YOU MUST FOLLOW:
1. Use ONLY the retrieved evidence provided below for any factual agricultural claim (symptoms, causes, spread, treatment). Do not invent facts.
2. Do not invent citations. Only reference the sources given to you.
3. Do not claim certainty when the classifier confidence is low or moderate -- reflect the stated confidence level honestly.
4. Do not prescribe specific pesticide/fungicide products or dosages unless that exact information appears in the retrieved evidence.
5. If the evidence is insufficient or absent, clearly state that reliable information could not be found, and recommend the farmer consult a qualified agricultural expert. Do not fill the gap with general knowledge.
6. You do NOT diagnose the image yourself -- a specialized computer vision model already produced the diagnosis and confidence score. Your job is only to explain and ground it in evidence.
7. Write in simple, farmer-friendly language. Avoid jargon where possible, and briefly explain any technical term you must use.

Structure your answer with these sections, in order, using the exact headings shown:
## What is happening?
## Why does the system think this?
## What can cause or spread it?
## What should you consider doing?
## Important caution
"""


def _build_user_prompt(crop: str, disease: str, confidence: float, confidence_level: str,
                        alternatives: list[str], gradcam_note: str,
                        evidence_chunks: list[RetrievedChunk], retrieval_status: str) -> str:
    lines = [
        f"Crop: {crop}",
        f"Diagnosed condition: {disease}",
        f"Model confidence: {confidence:.0%} ({confidence_level} confidence)",
    ]
    if alternatives:
        lines.append(f"Other possible conditions considered: {', '.join(alternatives)}")
    lines.append(f"Visual explanation note: {gradcam_note}")
    lines.append("")

    if retrieval_status == "success" and evidence_chunks:
        lines.append("RETRIEVED EVIDENCE (use only this for factual claims):")
        for i, chunk in enumerate(evidence_chunks, start=1):
            page_str = f", page {chunk.page_number}" if chunk.page_number else ""
            lines.append(
                f"[Evidence {i}] Source: \"{chunk.title}\" ({chunk.organization}{page_str})\n{chunk.text}"
            )
    else:
        lines.append(
            "RETRIEVED EVIDENCE: none available with sufficient relevance. "
            "You MUST state that reliable information could not be found in the "
            "agricultural knowledge base for this diagnosis, and recommend consulting "
            "a qualified agricultural expert. Do not provide any treatment/cause/spread "
            "details from your own general knowledge in this case."
        )

    lines.append("")
    lines.append("Now write the farmer-friendly explanation following the required section structure.")
    return "\n".join(lines)


def generate_grounded_explanation(
    crop: str, disease: str, confidence: float, confidence_level: str,
    alternatives: list[str], gradcam_note: str,
    evidence_chunks: list[RetrievedChunk], retrieval_status: str,
) -> str:
    settings = get_settings()

    user_prompt = _build_user_prompt(
        crop, disease, confidence, confidence_level, alternatives, gradcam_note, evidence_chunks, retrieval_status
    )

    payload = {
        "model": settings.LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "options": {"temperature": settings.LLM_TEMPERATURE},
    }

    url = f"{settings.OLLAMA_BASE_URL}/api/chat"

    try:
        with httpx.Client(timeout=settings.LLM_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload)
            response.raise_for_status()
    except httpx.ConnectError as e:
        raise LLMServiceError(
            f"Could not connect to Ollama at {settings.OLLAMA_BASE_URL}. "
            "Make sure Ollama is running locally (`ollama serve`) and the model is pulled "
            f"(`ollama pull {settings.LLM_MODEL}`)."
        ) from e
    except httpx.TimeoutException as e:
        raise LLMServiceError(f"Ollama request timed out after {settings.LLM_TIMEOUT_SECONDS}s.") from e
    except httpx.HTTPStatusError as e:
        raise LLMServiceError(f"Ollama returned an error: {e.response.status_code} {e.response.text}") from e

    try:
        data = response.json()
        content = data["message"]["content"]
    except (json.JSONDecodeError, KeyError) as e:
        raise LLMServiceError(f"Unexpected response format from Ollama: {e}") from e

    return content


def check_ollama_health() -> dict:
    """Used by the /health and /model-status endpoints."""
    settings = get_settings()
    try:
        with httpx.Client(timeout=5) as client:
            response = client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            response.raise_for_status()
            data = response.json()
            models = [m["name"] for m in data.get("models", [])]
            model_available = any(settings.LLM_MODEL in m for m in models)
            return {
                "ollama_reachable": True,
                "configured_model": settings.LLM_MODEL,
                "model_available": model_available,
                "available_models": models,
            }
    except Exception as e:
        return {
            "ollama_reachable": False,
            "configured_model": settings.LLM_MODEL,
            "model_available": False,
            "error": str(e),
        }
