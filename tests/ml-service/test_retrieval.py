import shutil
import sys
from pathlib import Path

import chromadb
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.rag.vector_store import VectorStore
from app.rag.pdf_ingestion import extract_pdf_pages
from app.rag.chunking import load_document_metadata, chunk_pages
from app.rag.retrieval import retrieve_evidence, build_structured_query

from fake_embeddings import DeterministicHashEmbeddingFunction


@pytest.fixture
def fake_vector_store(tmp_path, monkeypatch):
    """A VectorStore instance using a deterministic, network-free embedding
    function so retrieval tests don't depend on downloading a model from
    HuggingFace (blocked in some CI/sandbox environments)."""

    def fake_init(self, persist_path=None, embedding_model=None):
        self.persist_path = tmp_path / "vector_db"
        self.persist_path.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(self.persist_path))
        self.embedding_fn = DeterministicHashEmbeddingFunction()
        self.collection = self.client.get_or_create_collection(
            "agricultural_knowledge_base", embedding_function=self.embedding_fn
        )

    monkeypatch.setattr(VectorStore, "__init__", fake_init)
    return VectorStore()


def test_build_structured_query_includes_alternatives():
    query = build_structured_query("Tomato", "Late Blight", 0.9, ["Early Blight"])
    assert "Tomato" in query
    assert "Late Blight" in query
    assert "Early Blight" in query


def test_retrieval_on_empty_knowledge_base(fake_vector_store):
    result = retrieve_evidence("Tomato", "Late Blight", 0.9, [], vector_store=fake_vector_store)
    assert result.status == "knowledge_base_empty"
    assert result.chunks == []


def test_retrieval_success_with_relevant_chunks(fake_vector_store, sample_pdf_dir):
    all_chunks = []
    for fname in ["tomato_late_blight_test.pdf", "tomato_early_blight_test.pdf"]:
        pdf_path = sample_pdf_dir / fname
        pages = extract_pdf_pages(pdf_path)
        meta = load_document_metadata(pdf_path)
        all_chunks.extend(chunk_pages(pages, meta))

    fake_vector_store.add_chunks(all_chunks)
    assert fake_vector_store.count() > 0

    result = retrieve_evidence(
        "Tomato", "Late Blight", 0.9, ["Early Blight"], vector_store=fake_vector_store
    )
    assert result.status == "success"
    assert len(result.chunks) > 0
    # Every chunk must carry full citation metadata
    for chunk in result.chunks:
        assert chunk.title
        assert chunk.organization
        assert 0.0 <= chunk.relevance_score


def test_retrieval_insufficient_evidence_when_threshold_too_high(
    fake_vector_store, sample_pdf_dir, monkeypatch
):
    pdf_path = sample_pdf_dir / "tomato_late_blight_test.pdf"
    pages = extract_pdf_pages(pdf_path)
    meta = load_document_metadata(pdf_path)
    chunks = chunk_pages(pages, meta)
    fake_vector_store.add_chunks(chunks)

    import app.rag.retrieval as retrieval_module
    from app.config import Settings

    class StrictSettings(Settings):
        RAG_MIN_RELEVANCE_SCORE = 0.999

    monkeypatch.setattr(retrieval_module, "get_settings", lambda: StrictSettings())

    result = retrieve_evidence("Tomato", "Late Blight", 0.9, [], vector_store=fake_vector_store)
    assert result.status == "insufficient_evidence"
    assert result.chunks == []
