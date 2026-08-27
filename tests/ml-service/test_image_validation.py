import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.inference.image_validation import validate_image


def test_valid_sharp_image_passes(sample_image_bytes):
    result = validate_image(sample_image_bytes, "image/jpeg")
    assert result.is_valid is True
    assert result.image is not None


def test_flat_blurry_image_rejected():
    flat = np.full((300, 300, 3), 128, dtype="uint8")
    buf = io.BytesIO()
    Image.fromarray(flat).save(buf, format="JPEG")
    result = validate_image(buf.getvalue(), "image/jpeg")
    assert result.is_valid is False
    assert "unclear" in result.reason.lower()


def test_invalid_file_rejected():
    result = validate_image(b"not an image", "image/jpeg")
    assert result.is_valid is False


def test_too_small_image_rejected():
    tiny = Image.fromarray((np.random.rand(10, 10, 3) * 255).astype("uint8"))
    buf = io.BytesIO()
    tiny.save(buf, format="PNG")
    result = validate_image(buf.getvalue(), "image/png")
    assert result.is_valid is False
    assert "resolution" in result.reason.lower()


def test_unsupported_content_type_rejected(sample_image_bytes):
    result = validate_image(sample_image_bytes, "application/pdf")
    assert result.is_valid is False
