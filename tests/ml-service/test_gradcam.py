import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.training.model_factory import build_model, get_target_layer
from app.inference.gradcam import GradCAM, overlay_heatmap_on_image, image_to_bytes


def test_gradcam_generates_valid_heatmap():
    model = build_model("mobilenet_v2", num_classes=5, freeze_backbone=False, pretrained=False)
    model.eval()
    target_layer = get_target_layer(model, "mobilenet_v2")
    gradcam = GradCAM(model, target_layer)

    x = torch.randn(1, 3, 224, 224)
    heatmap = gradcam.generate(x, target_class=2)
    gradcam.remove_hooks()

    assert heatmap.shape == (224, 224)
    assert heatmap.min() >= 0.0
    assert heatmap.max() <= 1.0


def test_overlay_heatmap_produces_valid_image():
    heatmap = np.random.rand(224, 224)
    original = Image.fromarray((np.random.rand(224, 224, 3) * 255).astype("uint8"))
    overlay = overlay_heatmap_on_image(original, heatmap)
    assert overlay.size == (224, 224)
    assert overlay.mode == "RGB"


def test_image_to_bytes_roundtrip():
    img = Image.fromarray((np.random.rand(50, 50, 3) * 255).astype("uint8"))
    data = image_to_bytes(img)
    assert len(data) > 0
    # Should be re-openable as a valid PNG
    from io import BytesIO
    reopened = Image.open(BytesIO(data))
    reopened.load()
    assert reopened.size == (50, 50)
