"""Symptom-question endpoints (Step 5)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.inference.confidence import ClassProbability, build_diagnosis
from app.pipeline import normalise_language
from app.symptoms.questions import QuestionSetError, bayes_update, find_question_set, should_ask

router = APIRouter()


class Candidate(BaseModel):
    class_key: str
    probability: float = Field(ge=0, le=1)


class RefineRequest(BaseModel):
    candidates: list[Candidate] = Field(min_length=2, max_length=10)
    answers: dict[str, str]
    language: str = "en"


@router.get("/questions")
async def get_questions(class_a: str = Query(..., max_length=160), class_b: str = Query(..., max_length=160),
                        language: str = "en"):
    qset = find_question_set(class_a, class_b)
    if not qset:
        raise HTTPException(status_code=404, detail="No cited question set exists for this pair.")
    return qset.public(normalise_language(language))


@router.post("/refine")
async def refine(req: RefineRequest):
    cands = [c.model_dump() for c in req.candidates]
    top2 = sorted(cands, key=lambda c: -c["probability"])[:2]
    qset = find_question_set(top2[0]["class_key"], top2[1]["class_key"])
    if not qset:
        raise HTTPException(status_code=404, detail="No cited question set exists for this pair.")
    try:
        updated = bayes_update(cands, qset, req.answers)
    except QuestionSetError as e:
        raise HTTPException(status_code=422, detail=str(e))
    # Same confidence tiers as the CNN (thresholds from config).
    diag = build_diagnosis([ClassProbability(c["class_key"], c["probability"]) for c in updated])
    crop, _, disease = diag.top_class.partition("___")
    return {
        "pair": qset.pair,
        "candidates": updated,
        "class_key": diag.top_class,
        "crop": crop.replace("_", " "),
        "diagnosis": disease.replace("_", " "),
        "confidence": diag.top_confidence,
        "confidence_level": diag.confidence_level,
        "is_reliable": diag.is_reliable,
        "confidence_message": diag.message,
        "still_close": should_ask(updated),
        "source_is_placeholder": qset.source_is_placeholder,
        "note": "Probabilities updated from your answers using documented question likelihoods. "
                "This is indicative, not a laboratory diagnosis.",
    }
