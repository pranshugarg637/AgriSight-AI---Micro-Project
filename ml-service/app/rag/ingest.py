"""
End-to-end ingestion pipeline: PDFs -> extraction -> cleaning -> chunking ->
metadata -> embeddings -> vector database.

Usage:
    python -m app.rag.ingest
"""
from __future__ import annotations

import logging
from pathlib import Path

from app.config import get_settings
from app.rag.pdf_ingestion import extract_pdf_pages
from app.rag.chunking import chunk_pages, load_document_metadata
from app.rag.vector_store import VectorStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def ingest_knowledge_base(kb_path: Path | None = None, rebuild: bool = False) -> dict:
    settings = get_settings()
    kb_path = kb_path or settings.KNOWLEDGE_BASE_PATH

    if not kb_path.exists():
        raise FileNotFoundError(
            f"Knowledge base path '{kb_path}' does not exist. "
            "Create it and add agricultural PDF documents (see docs/rag.md)."
        )

    pdf_files = sorted(kb_path.glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError(
            f"No PDF files found in '{kb_path}'. Add at least one agricultural PDF document "
            "(and optionally a matching <filename>.pdf.meta.json metadata file)."
        )

    store = VectorStore()
    if rebuild:
        logger.info("Rebuild requested: clearing existing vector store collection.")
        store.clear()

    total_chunks = 0
    processed_files = []
    failed_files = []

    for pdf_path in pdf_files:
        try:
            pages = extract_pdf_pages(pdf_path)
            metadata = load_document_metadata(pdf_path)
            chunks = chunk_pages(pages, metadata)
            store.add_chunks(chunks)
            total_chunks += len(chunks)
            processed_files.append({"filename": pdf_path.name, "chunks": len(chunks), "pages": len(pages)})
            logger.info("Ingested %s: %d pages -> %d chunks", pdf_path.name, len(pages), len(chunks))
        except Exception as e:
            logger.error("Failed to ingest %s: %s", pdf_path.name, e)
            failed_files.append({"filename": pdf_path.name, "error": str(e)})

    result = {
        "processed_files": processed_files,
        "failed_files": failed_files,
        "total_chunks_added": total_chunks,
        "vector_store_count": store.count(),
    }
    logger.info("Ingestion complete: %s", result)
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true", help="Clear the vector store before ingesting.")
    args = parser.parse_args()
    ingest_knowledge_base(rebuild=args.rebuild)
