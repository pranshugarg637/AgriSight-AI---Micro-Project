"""
Chunking + metadata creation.

Each chunk carries source metadata (filename, title, organization, crop,
disease, page number, source URL, document type) so retrieval results
can always be traced back to their origin for citation.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from app.config import get_settings
from app.rag.pdf_ingestion import PageText

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class DocumentMetadata:
    filename: str
    title: str
    organization: str
    crop: str = "General"
    disease: str = "General"
    source_url: str = ""
    document_type: str = "extension_guide"


@dataclass
class Chunk:
    chunk_id: str
    text: str
    page_number: int | None
    metadata: DocumentMetadata = field(default_factory=lambda: DocumentMetadata("", "", ""))


def load_document_metadata(pdf_path: Path) -> DocumentMetadata:
    """
    Looks for a sidecar `<filename>.meta.json` next to the PDF. Falls back to
    sensible defaults derived from the filename if no sidecar is present.
    This is how curators attach title/organization/crop/disease/source_url
    without editing code.
    """
    meta_path = pdf_path.with_suffix(pdf_path.suffix + ".meta.json")
    if meta_path.exists():
        with open(meta_path) as f:
            raw = json.load(f)
        return DocumentMetadata(
            filename=pdf_path.name,
            title=raw.get("title", pdf_path.stem.replace("_", " ")),
            organization=raw.get("organization", "Unknown"),
            crop=raw.get("crop", "General"),
            disease=raw.get("disease", "General"),
            source_url=raw.get("source_url", ""),
            document_type=raw.get("document_type", "extension_guide"),
        )

    logger.warning(
        "No metadata sidecar found for %s. Using filename-derived defaults. "
        "Add a %s file for accurate citations.",
        pdf_path.name, meta_path.name,
    )
    return DocumentMetadata(
        filename=pdf_path.name,
        title=pdf_path.stem.replace("_", " ").title(),
        organization="Unknown",
    )


def chunk_pages(pages: list[PageText], metadata: DocumentMetadata,
                 chunk_size: int | None = None, overlap: int | None = None) -> list[Chunk]:
    """
    Simple sliding-window character-based chunker with overlap. Keeps page
    number association by chunking per-page (a chunk never spans pages, which
    keeps citations accurate at the cost of occasionally shorter chunks).
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE
    overlap = overlap or settings.CHUNK_OVERLAP

    chunks: list[Chunk] = []
    for page in pages:
        text = page.text
        if not text:
            continue

        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunk_id = hashlib.sha256(
                    f"{metadata.filename}-{page.page_number}-{start}".encode()
                ).hexdigest()[:16]
                chunks.append(
                    Chunk(chunk_id=chunk_id, text=chunk_text, page_number=page.page_number, metadata=metadata)
                )
            if end == len(text):
                break
            start = end - overlap

    return chunks
