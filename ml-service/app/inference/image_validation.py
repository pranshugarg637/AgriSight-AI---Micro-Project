"""
Basic image quality and validity checks, run before the image is sent
through the CNN. Prevents obviously invalid or unusable files from
propagating through the full pipeline.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, UnidentifiedImageError

from app.config import get_settings

settings = get_settings()


@dataclass
class ImageValidationResult:
    is_valid: bool
    reason: str | None = None
    image: Image.Image | None = None
    blur_score: float | None = None


def validate_image(file_bytes: bytes, content_type: str | None) -> ImageValidationResult:
    # 1. Content-type / file size checks
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > settings.MAX_IMAGE_SIZE_MB:
        return ImageValidationResult(
            is_valid=False,
            reason=f"File is too large ({size_mb:.1f}MB). Maximum allowed is {settings.MAX_IMAGE_SIZE_MB}MB.",
        )

    if content_type is not None and content_type not in settings.ALLOWED_IMAGE_TYPES:
        return ImageValidationResult(
            is_valid=False,
            reason=f"Unsupported file type '{content_type}'. Please upload a JPEG, PNG, or WebP image.",
        )

    # 2. Actually parseable as an image?
    try:
        image = Image.open(io.BytesIO(file_bytes))
        image.load()
    except (UnidentifiedImageError, OSError):
        return ImageValidationResult(
            is_valid=False,
            reason="The uploaded file is not a valid image. Please upload a JPEG, PNG, or WebP photo of the leaf.",
        )

    # 3. Minimum dimensions
    width, height = image.size
    if width < settings.MIN_IMAGE_DIMENSION or height < settings.MIN_IMAGE_DIMENSION:
        return ImageValidationResult(
            is_valid=False,
            reason=(
                f"Image resolution is too low ({width}x{height}). "
                "Please upload a clearer, higher-resolution image."
            ),
        )

    # 4. Basic blur detection using a Laplacian-variance-style estimate (no OpenCV dependency).
    blur_score = _estimate_sharpness(image)
    if blur_score < settings.BLUR_VARIANCE_THRESHOLD:
        return ImageValidationResult(
            is_valid=False,
            reason=(
                "The uploaded image is unclear. Please upload a well-lit image "
                "where the affected leaf is clearly visible."
            ),
            blur_score=blur_score,
        )

    return ImageValidationResult(is_valid=True, image=image.convert("RGB"), blur_score=blur_score)


def _estimate_sharpness(image: Image.Image) -> float:
    """
    Approximates a Laplacian-variance sharpness score without OpenCV.
    Higher values = sharper image. This is a heuristic, not a guaranteed
    blur classifier -- flagged as "optional/best-effort" per spec.
    """
    gray = np.array(image.convert("L"), dtype=np.float32)

    # Simple discrete Laplacian kernel convolution
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    padded = np.pad(gray, 1, mode="edge")
    laplacian = np.zeros_like(gray)

    # Vectorized convolution via shifted slices (fast, no scipy dependency)
    laplacian = (
        padded[0:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, 0:-2] + padded[1:-1, 2:] - 4 * gray
    )

    return float(laplacian.var())
