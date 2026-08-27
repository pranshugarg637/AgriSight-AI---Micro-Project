"""
RAG retrieval: builds a structured query from the CNN diagnosis, searches the
vector database, and enforces the RAG safety rule -- if retrieval doesn't
produce sufficiently relevant evidence, the caller must be told explicitly
("insufficient_evidence") so the LLM is never allowed to invent agricultural
advice from its own general knowledge.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.config import get_settings
from app.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunk:
    text: str
    relevance_score: float  # 0-1, higher = more relevant
    filename: str
    title: str
    organization: str
    crop: str
    disease: str
    page_number: int | None
    source_url: str
    document_type: str


@dataclass
class RetrievalResult:
    status: str  # "success" | "insufficient_evidence" | "knowledge_base_empty"
    chunks: list[RetrievedChunk] = field(default_factory=list)
    query_used: str = ""


def build_structured_query(crop: str, disease: str, confidence: float, alternatives: list[str]) -> str:
    """
    Builds a natural-language query for embedding-based similarity search
    from the structured diagnosis output (Section 12).
    """
    parts = [f"{crop} {disease} symptoms causes management treatment"]
    if alternatives:
        parts.append("possible differential: " + ", ".join(alternatives))
    return " ".join(parts)


def retrieve_evidence(crop: str, disease: str, confidence: float, alternatives: list[str] | None = None,
                       vector_store: VectorStore | None = None) -> RetrievalResult:
    settings = get_settings()
    store = vector_store or VectorStore()

    if store.is_empty():
        return RetrievalResult(status="knowledge_base_empty", chunks=[], query_used="")

    query = build_structured_query(crop, disease, confidence, alternatives or [])
    raw = store.query(query, top_k=settings.RAG_TOP_K)

    documents = raw.get("documents", [[]])[0]
    metadatas = raw.get("metadatas", [[]])[0]
    distances = raw.get("distances", [[]])[0]

    chunks = []
    for doc, meta, dist in zip(documents, metadatas, distances):
        # Chroma returns L2 distance by default; convert to a bounded
        # relevance score in [0,1] where higher = more relevant.
        relevance = 1.0 / (1.0 + dist)
        chunks.append(
            RetrievedChunk(
                text=doc,
                relevance_score=float(relevance),
                filename=meta.get("filename", ""),
                title=meta.get("title", ""),
                organization=meta.get("organization", ""),
                crop=meta.get("crop", ""),
                disease=meta.get("disease", ""),
                page_number=meta.get("page_number") if meta.get("page_number", -1) != -1 else None,
                source_url=meta.get("source_url", ""),
                document_type=meta.get("document_type", ""),
            )
        )

    relevant_chunks = [c for c in chunks if c.relevance_score >= settings.RAG_MIN_RELEVANCE_SCORE]

    if not relevant_chunks:
        logger.info(
            "Retrieval produced no sufficiently relevant chunks for query '%s' "
            "(best score: %.3f, threshold: %.3f).",
            query, chunks[0].relevance_score if chunks else 0.0, settings.RAG_MIN_RELEVANCE_SCORE,
        )
        return RetrievalResult(status="insufficient_evidence", chunks=[], query_used=query)

    return RetrievalResult(status="success", chunks=relevant_chunks, query_used=query)
