import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.rag.pdf_ingestion import extract_pdf_pages, clean_text
from app.rag.chunking import load_document_metadata, chunk_pages


def test_extract_pdf_pages(sample_pdf_dir):
    pdf_path = sample_pdf_dir / "tomato_late_blight_test.pdf"
    pages = extract_pdf_pages(pdf_path)
    assert len(pages) >= 1
    assert "late blight" in pages[0].text.lower()


def test_extract_nonexistent_pdf_raises(tmp_path):
    with pytest.raises(ValueError):
        extract_pdf_pages(tmp_path / "does_not_exist.pdf")


def test_clean_text_collapses_whitespace():
    dirty = "hello    \n\n  world"
    assert clean_text(dirty) == "hello world"


def test_load_metadata_from_sidecar(sample_pdf_dir):
    pdf_path = sample_pdf_dir / "tomato_late_blight_test.pdf"
    meta = load_document_metadata(pdf_path)
    assert meta.title == "Tomato Late Blight Test Guide"
    assert meta.crop == "Tomato"
    assert meta.disease == "Late Blight"


def test_load_metadata_fallback_without_sidecar(tmp_path):
    fake_pdf = tmp_path / "some_random_document.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 fake")
    meta = load_document_metadata(fake_pdf)
    assert meta.organization == "Unknown"
    assert meta.filename == "some_random_document.pdf"


def test_chunking_produces_chunks_with_metadata(sample_pdf_dir):
    pdf_path = sample_pdf_dir / "tomato_late_blight_test.pdf"
    pages = extract_pdf_pages(pdf_path)
    meta = load_document_metadata(pdf_path)
    chunks = chunk_pages(pages, meta, chunk_size=200, overlap=30)

    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.metadata.title == "Tomato Late Blight Test Guide"
        assert chunk.page_number is not None
        assert len(chunk.text) > 0
