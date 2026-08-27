"""
Embeddings + vector store (Chroma) for the RAG pipeline.

Uses Sentence Transformers for embeddings (small, fast, good enough for a
college-project scale knowledge base) and Chroma as the vector database
(simple local persistence, no external service required).
"""
from __future__ import annotations

import logging
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions

from app.config import get_settings
from app.rag.chunking import Chunk

logger = logging.getLogger(__name__)

COLLECTION_NAME = "agricultural_knowledge_base"


class VectorStore:
    def __init__(self, persist_path: Path | None = None, embedding_model: str | None = None):
        settings = get_settings()
        self.persist_path = persist_path or settings.VECTOR_DB_PATH
        self.persist_path.mkdir(parents=True, exist_ok=True)
        self.embedding_model_name = embedding_model or settings.EMBEDDING_MODEL

        self.client = chromadb.PersistentClient(path=str(self.persist_path))
        self.embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=self.embedding_model_name
        )
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME, embedding_function=self.embedding_fn
        )

    def is_empty(self) -> bool:
        return self.collection.count() == 0

    def count(self) -> int:
        return self.collection.count()

    def clear(self) -> None:
        self.client.delete_collection(COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME, embedding_function=self.embedding_fn
        )

    def add_chunks(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return

        ids = [c.chunk_id for c in chunks]
        documents = [c.text for c in chunks]
        metadatas = [
            {
                "filename": c.metadata.filename,
                "title": c.metadata.title,
                "organization": c.metadata.organization,
                "crop": c.metadata.crop,
                "disease": c.metadata.disease,
                "page_number": c.page_number if c.page_number is not None else -1,
                "source_url": c.metadata.source_url,
                "document_type": c.metadata.document_type,
            }
            for c in chunks
        ]

        # Chroma upsert avoids duplicate errors on re-ingestion
        self.collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
        logger.info("Upserted %d chunks into vector store.", len(chunks))

    def query(self, query_text: str, top_k: int) -> dict:
        if self.is_empty():
            return {"documents": [[]], "metadatas": [[]], "distances": [[]]}

        n_results = min(top_k, self.collection.count())
        return self.collection.query(query_texts=[query_text], n_results=n_results)
