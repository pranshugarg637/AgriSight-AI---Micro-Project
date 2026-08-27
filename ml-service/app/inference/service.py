"""
Inference service: owns the loaded model (singleton) and exposes a single
`predict()` entrypoint used by the API layer.

Clearly detects a missing trained model and raises a descriptive error
rather than silently falling back to a fake/mock prediction.
"""
from __future__ import annotations

import json
import base64
import logging
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms

from app.config import get_settings
from app.training.model_factory import build_model, get_target_layer
from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD
from app.inference.gradcam import GradCAM, overlay_heatmap_on_image, image_to_bytes
from app.inference.confidence import ClassProbability, build_diagnosis, parse_class_name, DiagnosisResult

logger = logging.getLogger(__name__)


class ModelNotLoadedError(Exception):
    """Raised when the trained model artifacts are missing."""


class InferenceService:
    _instance: "InferenceService | None" = None

    def __init__(self):
        self.settings = get_settings()
        self.model = None
        self.class_names: list[str] = []
        self.model_config: dict = {}
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.target_layer = None
        self._load_error: str | None = None
        self._try_load()

    @classmethod
    def get_instance(cls) -> "InferenceService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _try_load(self) -> None:
        model_path = self.settings.MODEL_PATH
        config_path = self.settings.MODEL_CONFIG_PATH
        class_names_path = self.settings.CLASS_NAMES_PATH

        missing = [p for p in [model_path, config_path, class_names_path] if not Path(p).exists()]
        if missing:
            self._load_error = (
                "Trained model artifacts not found: "
                f"{[str(p) for p in missing]}. "
                "Run `python -m app.training.train` after preparing the dataset "
                "(see docs/setup.md) to generate these files."
            )
            logger.warning(self._load_error)
            return

        with open(config_path) as f:
            self.model_config = json.load(f)
        with open(class_names_path) as f:
            self.class_names = json.load(f)

        self.model = build_model(
            self.model_config["backbone"], num_classes=self.model_config["num_classes"],
            freeze_backbone=False, pretrained=False,
        )
        self.model.load_state_dict(torch.load(model_path, map_location=self.device))
        self.model.to(self.device)
        self.model.eval()
        self.target_layer = get_target_layer(self.model, self.model_config["backbone"])
        logger.info("Model loaded successfully: backbone=%s classes=%d",
                    self.model_config["backbone"], len(self.class_names))

    def is_ready(self) -> bool:
        return self.model is not None

    def status(self) -> dict:
        return {
            "model_loaded": self.is_ready(),
            "error": self._load_error,
            "backbone": self.model_config.get("backbone") if self.model_config else None,
            "num_classes": len(self.class_names) if self.class_names else 0,
            "model_version": self.model_config.get("model_version") if self.model_config else None,
        }

    def _preprocess(self, image: Image.Image) -> torch.Tensor:
        size = self.model_config["image_size"]
        tf = transforms.Compose(
            [
                transforms.Resize((size, size)),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
        tensor = tf(image).unsqueeze(0).to(self.device)
        return tensor

    def predict(self, image: Image.Image) -> dict:
        if not self.is_ready():
            raise ModelNotLoadedError(self._load_error or "Model is not loaded.")

        input_tensor = self._preprocess(image)

        with torch.no_grad():
            logits = self.model(input_tensor)
            probs = torch.softmax(logits, dim=1)[0].cpu().numpy()

        class_probs = [
            ClassProbability(class_name=name, probability=float(p))
            for name, p in zip(self.class_names, probs)
        ]
        class_probs.sort(key=lambda cp: cp.probability, reverse=True)

        diagnosis: DiagnosisResult = build_diagnosis(class_probs)

        # Grad-CAM for the predicted (top) class
        gradcam = GradCAM(self.model, self.target_layer)
        top_class_idx = self.class_names.index(diagnosis.top_class)
        try:
            heatmap = gradcam.generate(input_tensor, target_class=top_class_idx)
        finally:
            gradcam.remove_hooks()

        overlay = overlay_heatmap_on_image(image, heatmap)
        gradcam_bytes = image_to_bytes(overlay)
        gradcam_base64 = base64.b64encode(gradcam_bytes).decode("utf-8")

        crop, disease = parse_class_name(diagnosis.top_class)

        return {
            "diagnosis": diagnosis,
            "crop": crop,
            "disease": disease,
            "class_probabilities": class_probs,
            "gradcam_base64": gradcam_base64,
            "model_version": self.model_config.get("model_version"),
        }


def reset_inference_service_for_tests():
    """Test helper: forces the singleton to reload (e.g. after training a new model)."""
    InferenceService._instance = None
