"""Hybrid retrieval, ingestion metadata validation, coverage report, faithfulness (mocked NLI)."""
import json
from types import SimpleNamespace

import pytest

from app.rag.metadata import check_document_metadata
from app.faithfulness.checker import check_explanation, split_sentences
from fake_embeddings import DeterministicHashEmbeddingFunction


def _make(tmp_path):
    import chromadb
    from app.rag.vector_store import VectorStore

    store = VectorStore.__new__(VectorStore)
    store.persist_path = tmp_path / "vdb"
    store.client = chromadb.PersistentClient(path=str(store.persist_path))
    store.embedding_fn = DeterministicHashEmbeddingFunction()
    store.collection = store.client.get_or_create_collection("kb_test", embedding_function=store.embedding_fn)
    return store


def test_hybrid_bm25_finds_rare_keyword_chunk(tmp_path):
    from app.rag.hybrid import hybrid_search

    store = _make(tmp_path)
    store.collection.upsert(
        ids=["a", "b", "c"],
        documents=["general tomato care watering sunlight", "Phytophthora infestans causes late blight lesions",
                   "potato storage and harvest timing"],
        metadatas=[{"title": "a"}, {"title": "b"}, {"title": "c"}],
    )
    hits = hybrid_search(store, "phytophthora", top_k=3, alpha=0.5)
    assert hits[0]["metadata"]["title"] == "b"
    assert hits[0]["bm25"] > 0
    assert all(0 < h["relevance"] <= 1 for h in hits)


def test_gate_still_uses_embedding_relevance(tmp_path, monkeypatch):
    """BM25 cannot push a chunk through RAG_MIN_RELEVANCE_SCORE."""
    from app.rag import retrieval
    from app.config import get_settings

    store = _make(tmp_path)
    store.collection.upsert(ids=["b"], documents=["Phytophthora infestans late blight"], metadatas=[{"title": "b"}])
    s = get_settings()
    monkeypatch.setattr(s, "RAG_RETRIEVAL_MODE", "hybrid")
    monkeypatch.setattr(s, "RAG_MIN_RELEVANCE_SCORE", 0.999)
    res = retrieval.retrieve_evidence("Tomato", "Late blight", 0.9, vector_store=store)
    assert res.status == "insufficient_evidence"


def _pdf(tmp_path, name, meta):
    p = tmp_path / name
    p.write_bytes(b"%PDF-1.4")
    if meta is not None:
        (tmp_path / f"{name}.meta.json").write_text(json.dumps(meta))
    return p


def test_metadata_placeholder_refused_in_production_warned_in_dev(tmp_path):
    p = _pdf(tmp_path, "x.pdf", {"title": "T", "organization": "Sample Agricultural Extension (Placeholder Source)", "source_url": ""})
    dev = check_document_metadata(p, production=False)
    assert dev.ok and dev.is_placeholder and any("PLACEHOLDER" in w for w in dev.warnings)
    prod = check_document_metadata(p, production=True)
    assert not prod.ok and any("PLACEHOLDER" in e for e in prod.errors)


def test_metadata_missing_org_or_url(tmp_path):
    p = _pdf(tmp_path, "y.pdf", {"title": "T", "organization": "Unknown", "source_url": ""})
    assert set(check_document_metadata(p, production=False).warnings) >= {"organization missing", "source_url missing"}
    assert not check_document_metadata(p, production=False, strict=True).ok
    no_sidecar = _pdf(tmp_path, "z.pdf", None)
    assert not check_document_metadata(no_sidecar, production=True).ok


def test_good_metadata_passes(tmp_path):
    p = _pdf(tmp_path, "g.pdf", {"title": "Guide", "organization": "State Agricultural University", "source_url": "https://x.edu/guide.pdf"})
    c = check_document_metadata(p, production=True)
    assert c.ok and not c.warnings


def test_ingest_refuses_placeholders_in_production(sample_pdf_dir, tmp_path, monkeypatch):
    from app.rag.ingest import ingest_knowledge_base
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "ENV", "production")
    store = _make(tmp_path)
    store.add_chunks = lambda chunks: None
    store.count = lambda: 0
    res = ingest_knowledge_base(sample_pdf_dir, store=store)  # fixtures lack organization/source_url
    assert len(res["rejected_files"]) == 2
    assert res["processed_files"] == []


def test_coverage_report_marks_placeholder_and_missing(tmp_path):
    from pathlib import Path
    from app.rag.coverage import build_report, to_markdown

    root = Path(__file__).resolve().parents[2]
    rows = build_report(["Tomato___Late_blight", "Apple___Black_rot", "Tomato___healthy"], root / "knowledge_base" / "documents", root,
                        probe_retrieval=lambda c, d: "stub")
    by = {r["class_key"]: r for r in rows}
    assert by["Tomato___Late_blight"]["status"] == "PLACEHOLDER ONLY"
    assert by["Tomato___Late_blight"]["question_set"] is True
    assert by["Apple___Black_rot"]["status"] == "MISSING"
    assert by["Tomato___healthy"]["status"] == "n/a (healthy)"
    assert "0 of 2 disease classes" in to_markdown(rows)


class FakeNLI:
    name = "fake-nli"

    def entailment(self, premises, hypothesis):
        # "entailed" iff every content word of the hypothesis appears in a premise
        words = [w.strip(".,").lower() for w in hypothesis.split() if len(w) > 3]
        return [1.0 if all(w in p.lower() for w in words) else 0.0 for p in premises]


EXPL = """## What is happening?
Late blight spreads in cool wet weather. It is caused by aliens from space.
## Why does the system think this?
The model is 90% confident.
## What should you consider doing?
- Remove infected debris. Spray product X at 5 ml per litre.
## Important caution
Consult an expert."""
CHUNKS = [SimpleNamespace(text="Late blight spreads rapidly in cool wet weather. Remove infected debris promptly.")]


def test_faithfulness_removes_unsupported_sentences(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "FAITHFULNESS_ACTION", "remove")
    res = check_explanation(EXPL, CHUNKS, "success", model=FakeNLI())
    assert res.checked and res.total_sentences == 4
    assert res.unsupported_sentences == ["It is caused by aliens from space.", "Spray product X at 5 ml per litre."]
    assert res.unsupported_rate == pytest.approx(0.5)
    assert "aliens" not in res.filtered_explanation
    assert "- Remove infected debris." in res.filtered_explanation
    assert "The model is 90% confident." in res.filtered_explanation  # meta section not checked
    assert "2 statement(s) were removed" in res.filtered_explanation


def test_faithfulness_flag_mode_keeps_text(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "FAITHFULNESS_ACTION", "flag")
    res = check_explanation(EXPL, CHUNKS, "success", model=FakeNLI())
    assert res.action == "flagged" and res.filtered_explanation is None


def test_faithfulness_skipped_without_evidence_or_backend():
    assert check_explanation(EXPL, [], "insufficient_evidence", model=FakeNLI()).checked is False
    assert check_explanation(EXPL, CHUNKS, "success").checked is False  # FAITHFULNESS_BACKEND=none in tests
    assert check_explanation(None, CHUNKS, "success") is None


def test_sentence_split():
    assert split_sentences("One. Two! Three?") == ["One.", "Two!", "Three?"]


def test_faithfulness_evaluate_aggregates():
    from app.faithfulness.evaluate import evaluate

    rows = [{"explanation": EXPL, "evidence": [CHUNKS[0].text]}]
    out = evaluate(rows, model=FakeNLI())
    assert out["sentences"] == 4 and out["unsupported_claim_rate"] == pytest.approx(0.5)
