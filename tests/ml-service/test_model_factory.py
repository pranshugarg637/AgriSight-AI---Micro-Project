import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.training.model_factory import build_model, unfreeze_last_n_layers, get_target_layer


def test_build_model_output_shape():
    model = build_model("mobilenet_v2", num_classes=5, freeze_backbone=True, pretrained=False)
    x = torch.randn(2, 3, 224, 224)
    out = model(x)
    assert out.shape == (2, 5)


def test_build_model_freezes_backbone():
    model = build_model("mobilenet_v2", num_classes=3, freeze_backbone=True, pretrained=False)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    assert trainable < total  # head params only should be trainable


def test_unfreeze_last_n_layers_increases_trainable_params():
    model = build_model("mobilenet_v2", num_classes=3, freeze_backbone=True, pretrained=False)
    before = sum(p.numel() for p in model.parameters() if p.requires_grad)
    unfreeze_last_n_layers(model, "mobilenet_v2", n=20)
    after = sum(p.numel() for p in model.parameters() if p.requires_grad)
    assert after > before


def test_get_target_layer_returns_module():
    model = build_model("mobilenet_v2", num_classes=3, freeze_backbone=True, pretrained=False)
    layer = get_target_layer(model, "mobilenet_v2")
    assert isinstance(layer, torch.nn.Module)


def test_unsupported_backbone_raises():
    with pytest.raises(ValueError):
        build_model("resnet50", num_classes=3, pretrained=False)
