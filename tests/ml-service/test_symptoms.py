"""Symptom-question sets and the Bayesian update."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.symptoms.questions import (
    QuestionSet, QuestionSetError, bayes_update, find_question_set, load_question_set, pair_id, should_ask,
    validate_question_set,
)

A, B = "Tomato___Early_blight", "Tomato___Late_blight"


def qset(p_yes_a=0.8, p_yes_b=0.3, n=1):
    return QuestionSet(pair=pair_id(A, B), classes=[A, B], source_is_placeholder=False, likelihood_basis="test", path=Path("x"),
                       questions=[{"id": f"q{i}", "text": {"en": "?"}, "citations": [{"file": "f", "quote": "q"}],
                                   "p_yes": {A: p_yes_a, B: p_yes_b}} for i in range(1, n + 1)])


CANDS = [{"class_key": B, "probability": 0.5}, {"class_key": A, "probability": 0.4}, {"class_key": "Tomato___healthy", "probability": 0.1}]


def test_bayes_yes_answer_math():
    out = {c["class_key"]: c["probability"] for c in bayes_update(CANDS, qset(), {"q1": "yes"})}
    # prior within pair: A=0.4/0.9, B=0.5/0.9 ; likelihood A 0.8, B 0.3
    wa, wb = (0.4 / 0.9) * 0.8, (0.5 / 0.9) * 0.3
    assert out[A] == pytest.approx(0.9 * wa / (wa + wb))
    assert out[B] == pytest.approx(0.9 * wb / (wa + wb))
    assert out["Tomato___healthy"] == pytest.approx(0.1)  # untouched
    assert sum(out.values()) == pytest.approx(1.0)


def test_bayes_no_answer_uses_complement():
    out = {c["class_key"]: c["probability"] for c in bayes_update(CANDS, qset(), {"q1": "no"})}
    wa, wb = (0.4 / 0.9) * 0.2, (0.5 / 0.9) * 0.7
    assert out[A] == pytest.approx(0.9 * wa / (wa + wb))


def test_unsure_changes_nothing_and_order_is_sorted():
    out = bayes_update(CANDS, qset(), {"q1": "unsure"})
    assert [c["class_key"] for c in out] == [B, A, "Tomato___healthy"]
    assert out[0]["probability"] == pytest.approx(0.5)


def test_several_answers_multiply():
    out = bayes_update(CANDS, qset(n=3), {"q1": "yes", "q2": "yes", "q3": "yes"})
    assert out[0]["class_key"] == A


def test_invalid_answer_rejected():
    with pytest.raises(QuestionSetError):
        bayes_update(CANDS, qset(), {"q1": "maybe"})


def test_should_ask_margin():
    assert should_ask([{"class_key": "a", "probability": 0.55}, {"class_key": "b", "probability": 0.40}], margin=0.3)
    assert not should_ask([{"class_key": "a", "probability": 0.95}, {"class_key": "b", "probability": 0.03}], margin=0.3)


def test_validation_requires_citations_and_likelihoods():
    doc = {"classes": [A, B], "likelihood_basis": "x",
           "questions": [{"id": "q1", "text": {"en": "?"}, "citations": [], "p_yes": {A: 1.5}}]}
    errors = validate_question_set(doc)
    assert any("citation" in e for e in errors)
    assert any("p_yes" in e for e in errors)


def test_shipped_question_set_is_valid_cited_and_refused_in_production():
    path = Path(__file__).resolve().parents[2] / "knowledge_base" / "questions" / f"{pair_id(A, B)}.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert validate_question_set(doc) == []
    for q in doc["questions"]:
        pdf = Path(__file__).resolve().parents[2] / "knowledge_base" / "documents" / q["citations"][0]["file"]
        assert pdf.exists()
    assert load_question_set(path, production=False).source_is_placeholder
    with pytest.raises(QuestionSetError):
        load_question_set(path, production=True)
    assert find_question_set(B, A, directory=path.parent, production=False) is not None
    assert find_question_set(A, "Apple___Black_rot", directory=path.parent, production=False) is None


def test_refine_and_questions_endpoints():
    from app.main import app

    client = TestClient(app, headers={"X-Internal-Token": "test-internal-token"})
    q = client.get("/api/questions", params={"class_a": A, "class_b": B, "language": "hi"})
    assert q.status_code == 200
    body = q.json()
    assert len(body["questions"]) == 3 and body["questions"][0]["citations"]
    assert body["questions"][0]["text"] != body["questions"][0]["text_en"]  # Hindi text returned
    r = client.post("/api/refine", json={"candidates": [{"class_key": B, "probability": 0.55}, {"class_key": A, "probability": 0.41}],
                                         "answers": {"q1": "yes", "q2": "no", "q3": "yes"}})
    assert r.status_code == 200
    data = r.json()
    assert data["class_key"] == A
    assert data["confidence_level"] in {"high", "low", "unreliable"}
    assert "indicative" in data["note"]
    assert client.get("/api/questions", params={"class_a": A, "class_b": "Apple___Black_rot"}).status_code == 404
