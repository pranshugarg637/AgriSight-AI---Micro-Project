"""
PDF ingestion: extracts and cleans text from agricultural PDF documents in
the knowledge base, preserving page numbers for citation purposes.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

logger = logging.getLogger(__name__)


@dataclass
class PageText:
    page_number: int  # 1-indexed
    text: str


def extract_pdf_pages(pdf_path: Path) -> list[PageText]:
    """Extracts raw text per page. Raises on unreadable/corrupt PDFs
    rather than silently returning empty content."""
    try:
        reader = PdfReader(str(pdf_path))
    except Exception as e:
        raise ValueError(f"Failed to open PDF '{pdf_path.name}': {e}") from e

    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ValueError(f"PDF '{pdf_path.name}' is encrypted and could not be opened.")

    pages = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            raw_text = page.extract_text() or ""
        except Exception as e:
            logger.warning("Failed to extract text from page %d of %s: %s", i, pdf_path.name, e)
            raw_text = ""
        pages.append(PageText(page_number=i, text=clean_text(raw_text)))

    if all(p.text.strip() == "" for p in pages):
        raise ValueError(
            f"No extractable text found in '{pdf_path.name}'. "
            "It may be a scanned/image-only PDF that requires OCR (not yet supported)."
        )

    return pages


def clean_text(text: str) -> str:
    """Basic cleanup: collapse whitespace, remove stray control chars/hyphenation artifacts."""
    text = text.replace("\x00", "")
    text = re.sub(r"-\n(?=[a-z])", "", text)  # de-hyphenate words broken across lines
    text = re.sub(r"\s+", " ", text)
    return text.strip()
