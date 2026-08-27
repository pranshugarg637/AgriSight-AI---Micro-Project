"""
Builds the transfer-learning classifier.

Default backbone: MobileNetV2 (lighter, faster to train/fine-tune, reliable
baseline for a college-project timeline and CPU-only environments).
EfficientNet-B0 is offered as a swap-in alternative via config.BACKBONE.
"""
from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import models


def build_model(backbone: str, num_classes: int, freeze_backbone: bool = True, pretrained: bool = True) -> nn.Module:
    """
    pretrained=True downloads ImageNet weights (needed the first time we train
    from scratch). pretrained=False skips the download entirely -- this is the
    correct mode for inference/evaluation, where we're about to overwrite the
    weights with our own trained checkpoint anyway, and it also avoids a
    needless network dependency at serving time.
    """
    backbone = backbone.lower()

    if backbone == "mobilenet_v2":
        weights = models.MobileNet_V2_Weights.IMAGENET1K_V1 if pretrained else None
        net = models.mobilenet_v2(weights=weights)
        in_features = net.classifier[-1].in_features
        net.classifier[-1] = nn.Linear(in_features, num_classes)
        feature_module = net.features

    elif backbone == "efficientnet_b0":
        weights = models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        net = models.efficientnet_b0(weights=weights)
        in_features = net.classifier[-1].in_features
        net.classifier[-1] = nn.Linear(in_features, num_classes)
        feature_module = net.features

    else:
        raise ValueError(f"Unsupported backbone '{backbone}'. Use 'mobilenet_v2' or 'efficientnet_b0'.")

    if freeze_backbone:
        for param in feature_module.parameters():
            param.requires_grad = False

    return net


def unfreeze_last_n_layers(model: nn.Module, backbone: str, n: int = 20) -> None:
    """
    Used for the fine-tuning phase: unfreeze the last N layers of the feature
    extractor so the model can adapt higher-level features to plant disease
    imagery, while keeping early (generic edge/texture) layers frozen.
    """
    backbone = backbone.lower()
    if backbone in ("mobilenet_v2", "efficientnet_b0"):
        feature_module = model.features
    else:
        raise ValueError(f"Unsupported backbone '{backbone}'.")

    children = list(feature_module.children())
    for layer in children[-n:]:
        for param in layer.parameters():
            param.requires_grad = True


def get_target_layer(model: nn.Module, backbone: str) -> nn.Module:
    """Returns the conv layer Grad-CAM should hook into (last conv block)."""
    backbone = backbone.lower()
    if backbone in ("mobilenet_v2", "efficientnet_b0"):
        return model.features[-1]
    raise ValueError(f"Unsupported backbone '{backbone}'.")
