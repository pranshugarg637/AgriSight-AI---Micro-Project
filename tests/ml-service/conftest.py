"""Shared pytest fixtures for ml-service tests."""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.lib.units import inch


@pytest.fixture(scope="session")
def synthetic_dataset_path(tmp_path_factory) -> Path:
    """Builds a tiny synthetic ImageFolder-style dataset for fast CI-friendly tests.
    NOT meant to produce a meaningful classifier -- only to exercise the
    dataset/training/evaluation code paths mechanically."""
    base = tmp_path_factory.mktemp("plantvillage_synthetic")
    classes = {
        "Tomato___Late_blight": (150, 60, 40),
        "Tomato___Early_blight": (170, 140, 40),
        "Potato___healthy": (40, 160, 60),
    }
    rng = np.random.default_rng(0)
    for cls, base_color in classes.items():
        cls_dir = base / cls
        cls_dir.mkdir(parents=True, exist_ok=True)
        for i in range(20):
            arr = np.zeros((256, 256, 3), dtype=np.uint8)
            noise = rng.integers(-30, 30, (256, 256, 3))
            arr[:, :] = base_color
            arr = np.clip(arr.astype(int) + noise, 0, 255).astype(np.uint8)
            Image.fromarray(arr).save(cls_dir / f"img_{i}.jpg", quality=85)

    yield base
    shutil.rmtree(base, ignore_errors=True)


@pytest.fixture
def sample_image_bytes() -> bytes:
    import io
    arr = (np.random.rand(300, 300, 3) * 255).astype("uint8")
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def sample_pdf_dir(tmp_path) -> Path:
    """Creates a couple of small original sample PDFs + metadata sidecars for RAG tests."""
    styles = getSampleStyleSheet()

    def make_pdf(path: Path, title: str, paragraphs: list[str]):
        doc = SimpleDocTemplate(str(path), pagesize=letter)
        story = [Paragraph(title, styles["Title"]), Spacer(1, 0.2 * inch)]
        for p in paragraphs:
            story.append(Paragraph(p, styles["BodyText"]))
            story.append(Spacer(1, 0.15 * inch))
        doc.build(story)

    late_blight_pdf = tmp_path / "tomato_late_blight_test.pdf"
    make_pdf(
        late_blight_pdf,
        "Tomato Late Blight Test Guide",
        [
            "Late blight of tomato is caused by Phytophthora infestans and spreads rapidly in cool, wet weather.",
            "Symptoms include water-soaked lesions on leaves that turn brown to black, with white fungal growth on leaf undersides in humid conditions.",
            "Management includes resistant varieties, proper spacing, avoiding overhead irrigation, and removing infected debris.",
        ],
    )
    (tmp_path / "tomato_late_blight_test.pdf.meta.json").write_text(
        '{"title": "Tomato Late Blight Test Guide", "organization": "Test Extension", '
        '"crop": "Tomato", "disease": "Late Blight", "source_url": "", "document_type": "extension_guide"}'
    )

    early_blight_pdf = tmp_path / "tomato_early_blight_test.pdf"
    make_pdf(
        early_blight_pdf,
        "Tomato Early Blight Test Guide",
        [
            "Early blight is caused by Alternaria solani and typically appears on older, lower leaves first.",
            "Symptoms include dark spots with concentric rings giving a target-like appearance, surrounded by a yellow halo.",
            "Management includes crop rotation, debris removal, staking for airflow, and balanced plant nutrition.",
        ],
    )
    (tmp_path / "tomato_early_blight_test.pdf.meta.json").write_text(
        '{"title": "Tomato Early Blight Test Guide", "organization": "Test Extension", '
        '"crop": "Tomato", "disease": "Early Blight", "source_url": "", "document_type": "extension_guide"}'
    )

    return tmp_path
