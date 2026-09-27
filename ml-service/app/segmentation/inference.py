"""
Serving-time lesion segmentation + severity estimate.

Optional add-on: if the segmentation model files are missing (or
SEGMENTATION_ENABLED=false) every call returns status "model_not_available"
/ "disabled" and the rest of the pipeline behaves exactly as before. It
never returns a made-up mask.

Severity % = lesion pixels / estimated leaf pixels x 100.
The leaf area comes from a simple colour heuristic (Otsu threshold on HSV
saturation, see `estimate_leaf_mask`), so the percentage is an ESTIMATE.
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torchvision.transforms import functional as TF

from app.config import get_settings
from app.inference.gradcam import image_to_bytes
from app.segmentation.metrics import boundary
from app.segmentation.model import build_seg_model
from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD

logger = logging.getLogger(__name__)

SEGMENTATION_NOTE = (
    "Affected area is an estimate from a separate lesion-segmentation model; the leaf outline "
    "comes from a simple colour rule. It is a rough guide to how widespread the damage is, not a "
    "measurement. The model's Dice/IoU scores on its test set are shown on the metrics page."
)

# Status values used in PredictionResponse.segmentation_status
STATUS_SUCCESS = "success"
STATUS_MODEL_NOT_AVAILABLE = "model_not_available"
STATUS_DISABLED = "disabled"
STATUS_SKIPPED_HEALTHY = "skipped_healthy"
STATUS_SKIPPED_UNRELIABLE = "skipped_unreliable"
STATUS_ERROR = "error"
STATUS_NOT_RUN = "not_run"


@dataclass
class SegmentationOutcome:
    status: str
    lesion_mask_base64: str | None = None
    severity_percent: float | None = None
    severity_band: str | None = None

    def as_response_fields(self) -> dict:
        return {
            "segmentation_status": self.status,
            "lesion_mask_base64": self.lesion_mask_base64,
            "severity_percent": self.severity_percent,
            "severity_band": self.severity_band,
        }


# --- Pure helpers (unit-tested) ------------------------------------------------

def otsu_threshold(values: np.ndarray) -> float:
    """Otsu's threshold for uint8-range values (numpy only)."""
    v = np.clip(np.asarray(values).ravel(), 0, 255).astype(np.uint8)
    hist = np.bincount(v, minlength=256).astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 0.0
    bins = np.arange(256, dtype=np.float64)
    w0 = np.cumsum(hist)
    w1 = total - w0
    m0 = np.cumsum(hist * bins)
    mu_t = m0[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (mu_t * w0 / total - m0) ** 2 / (w0 * w1 / total)
    between = np.nan_to_num(between, nan=0.0, posinf=0.0, neginf=0.0)
    return float(np.argmax(between))


def estimate_leaf_mask(rgb: np.ndarray) -> np.ndarray:
    """
    Rough leaf-vs-background mask. Leaves (green AND brown/yellow diseased
    tissue) are more colourful than the grey/white/dark backgrounds typical of
    leaf photos, so we threshold HSV saturation with Otsu's method.
    Limitation: fails on busy backgrounds (soil, other leaves) -- hence
    "estimate" everywhere this is shown.
    """
    hsv = np.array(Image.fromarray(rgb.astype(np.uint8)).convert("HSV"))
    sat, val = hsv[..., 1], hsv[..., 2]
    thr = max(otsu_threshold(sat), 20.0)
    return (sat > thr) & (val > 20)


def severity_band(percent: float | None, mild_max: float, moderate_max: float) -> str | None:
    if percent is None:
        return None
    if percent < mild_max:
        return "mild"
    if percent <= moderate_max:
        return "moderate"
    return "severe"


def compute_severity(lesion_mask: np.ndarray, leaf_mask: np.ndarray, min_leaf_fraction: float = 0.05):
    """
    Returns severity % (0-100) or None when the leaf estimate is too small to trust.
    Lesion pixels always count as leaf (diseased tissue is part of the leaf).
    """
    lesion = np.asarray(lesion_mask, dtype=bool)
    leaf = np.asarray(leaf_mask, dtype=bool) | lesion
    if lesion.shape != leaf.shape:
        raise ValueError("lesion and leaf masks must have the same shape")
    leaf_px = int(leaf.sum())
    if leaf_px == 0 or leaf_px < min_leaf_fraction * leaf.size:
        return None
    return round(100.0 * float(lesion.sum()) / leaf_px, 1)


def overlay_lesion_mask(image: Image.Image, lesion_mask: np.ndarray, alpha: float = 0.55) -> Image.Image:
    """Semi-transparent red fill over lesions, with a solid red outline."""
    h, w = lesion_mask.shape
    base = np.array(image.convert("RGB").resize((w, h))).astype(np.float32)
    red = np.array([220.0, 30.0, 30.0])
    out = base.copy()
    m = lesion_mask.astype(bool)
    out[m] = (1 - alpha) * base[m] + alpha * red
    out[boundary(m)] = red
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# --- Service -----------------------------------------------------------------

class SegmentationService:
    _instance: "SegmentationService | None" = None

    def __init__(self):
        self.settings = get_settings()
        self.model = None
        self.config: dict = {}
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._load_error: str | None = None
        self._try_load()

    @classmethod
    def get_instance(cls) -> "SegmentationService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _try_load(self) -> None:
        if not self.settings.SEGMENTATION_ENABLED:
            self._load_error = "Segmentation is disabled (SEGMENTATION_ENABLED=false)."
            return
        missing = [str(p) for p in (self.settings.SEG_MODEL_PATH, self.settings.SEG_CONFIG_PATH) if not Path(p).exists()]
        if missing:
            self._load_error = (
                f"Segmentation model not found: {missing}. It is optional -- to enable it, add a masked "
                "dataset and run `python -m app.segmentation.train` (see docs/segmentation.md)."
            )
            logger.info(self._load_error)
            return
        try:
            with open(self.settings.SEG_CONFIG_PATH) as f:
                self.config = json.load(f)
            model = build_seg_model(pretrained_encoder=False)
            model.load_state_dict(torch.load(self.settings.SEG_MODEL_PATH, map_location=self.device))
            model.to(self.device).eval()
            self.model = model
            logger.info("Segmentation model loaded (version %s).", self.config.get("model_version"))
        except Exception as e:  # corrupt / incompatible checkpoint -> stay optional
            self.model = None
            self._load_error = f"Segmentation model could not be loaded: {e}"
            logger.warning(self._load_error)

    @property
    def enabled(self) -> bool:
        return self.settings.SEGMENTATION_ENABLED

    def is_ready(self) -> bool:
        return self.model is not None

    def status(self) -> dict:
        return {
            "seg_model_loaded": self.is_ready(),
            "seg_model_error": None if self.is_ready() else self._load_error,
            "seg_model_version": self.config.get("model_version") if self.config else None,
        }

    @torch.no_grad()
    def predict_mask(self, image: Image.Image) -> np.ndarray:
        """Boolean lesion mask at the model's working resolution (image_size x image_size)."""
        if not self.is_ready():
            raise RuntimeError(self._load_error or "Segmentation model not loaded.")
        size = int(self.config.get("image_size", self.settings.SEG_IMAGE_SIZE))
        threshold = float(self.config.get("threshold", self.settings.SEG_THRESHOLD))
        rgb = image.convert("RGB").resize((size, size), Image.BILINEAR)
        x = TF.normalize(TF.to_tensor(rgb), IMAGENET_MEAN, IMAGENET_STD).unsqueeze(0).to(self.device)
        probs = torch.sigmoid(self.model(x))[0, 0].cpu().numpy()
        return probs >= threshold

    def analyse(self, image: Image.Image) -> SegmentationOutcome:
        s = self.settings
        lesion = self.predict_mask(image)
        size = lesion.shape[0]
        rgb = np.array(image.convert("RGB").resize((size, size), Image.BILINEAR))
        leaf = estimate_leaf_mask(rgb)
        pct = compute_severity(lesion, leaf, s.SEG_MIN_LEAF_FRACTION)
        overlay = overlay_lesion_mask(image, lesion)
        return SegmentationOutcome(
            status=STATUS_SUCCESS,
            lesion_mask_base64=base64.b64encode(image_to_bytes(overlay)).decode("utf-8"),
            severity_percent=pct,
            severity_band=severity_band(pct, s.SEG_SEVERITY_MILD_MAX, s.SEG_SEVERITY_MODERATE_MAX),
        )


def is_healthy_class(class_key: str | None) -> bool:
    return bool(class_key) and "healthy" in class_key.lower()


def run_segmentation(image: Image.Image, diagnosis) -> SegmentationOutcome:
    """
    Pipeline hook. Decides whether segmentation should run for this diagnosis
    and never raises -- failures become status "error".
    """
    try:
        if not diagnosis.is_reliable or diagnosis.confidence_level != "high":
            return SegmentationOutcome(STATUS_SKIPPED_UNRELIABLE)
        if is_healthy_class(diagnosis.top_class):
            return SegmentationOutcome(STATUS_SKIPPED_HEALTHY)
        service = SegmentationService.get_instance()
        if not service.enabled:
            return SegmentationOutcome(STATUS_DISABLED)
        if not service.is_ready():
            return SegmentationOutcome(STATUS_MODEL_NOT_AVAILABLE)
        return service.analyse(image)
    except Exception:
        logger.exception("Lesion segmentation failed")
        return SegmentationOutcome(STATUS_ERROR)


def reset_segmentation_service_for_tests():
    SegmentationService._instance = None
