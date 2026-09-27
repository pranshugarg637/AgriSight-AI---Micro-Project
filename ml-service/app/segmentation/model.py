"""
Lightweight U-Net for lesion segmentation, built from torchvision only.

Encoder: MobileNetV2 feature extractor (ImageNet-pretrained when training).
Decoder: 4 up-sampling blocks with skip connections from the encoder at
strides /16, /8, /4 and /2, then a final up-sample to full resolution and a
1x1 conv that outputs ONE logit channel (lesion vs not-lesion).

Output shape: (B, 1, H, W) -- same H, W as the input. Apply sigmoid for
per-pixel lesion probability.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models

ENCODER_NAME = "mobilenet_v2"

# MobileNetV2 `features` indices whose OUTPUT we tap, with channel counts.
#   idx 1  -> stride 2,  16 ch
#   idx 3  -> stride 4,  24 ch
#   idx 6  -> stride 8,  32 ch
#   idx 13 -> stride 16, 96 ch
#   idx 17 -> stride 32, 320 ch  (bottleneck; the 1280-ch idx 18 is skipped to stay light)
_TAPS = (1, 3, 6, 13, 17)
_TAP_CHANNELS = (16, 24, 32, 96, 320)


class _ConvBlock(nn.Sequential):
    def __init__(self, in_ch: int, out_ch: int):
        super().__init__(
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )


class _UpBlock(nn.Module):
    def __init__(self, in_ch: int, skip_ch: int, out_ch: int):
        super().__init__()
        self.conv = _ConvBlock(in_ch + skip_ch, out_ch)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        return self.conv(torch.cat([x, skip], dim=1))


class LesionUNet(nn.Module):
    def __init__(self, pretrained_encoder: bool = True, decoder_channels=(128, 64, 32, 24, 16)):
        super().__init__()
        weights = models.MobileNet_V2_Weights.IMAGENET1K_V1 if pretrained_encoder else None
        backbone = models.mobilenet_v2(weights=weights).features
        # Keep only the layers up to the last tap.
        self.encoder = nn.ModuleList(list(backbone.children())[: _TAPS[-1] + 1])

        c16, c24, c32, c96, c320 = _TAP_CHANNELS
        d1, d2, d3, d4, d5 = decoder_channels
        self.center = _ConvBlock(c320, d1)
        self.up1 = _UpBlock(d1, c96, d2)   # /32 -> /16
        self.up2 = _UpBlock(d2, c32, d3)   # /16 -> /8
        self.up3 = _UpBlock(d3, c24, d4)   # /8  -> /4
        self.up4 = _UpBlock(d4, c16, d5)   # /4  -> /2
        self.head = nn.Conv2d(d5, 1, kernel_size=1)

    def encoder_parameters(self):
        return self.encoder.parameters()

    def set_encoder_trainable(self, trainable: bool) -> None:
        for p in self.encoder.parameters():
            p.requires_grad = trainable

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        in_size = x.shape[-2:]
        skips = []
        for idx, layer in enumerate(self.encoder):
            x = layer(x)
            if idx in _TAPS:
                skips.append(x)
        s2, s4, s8, s16, s32 = skips
        x = self.center(s32)
        x = self.up1(x, s16)
        x = self.up2(x, s8)
        x = self.up3(x, s4)
        x = self.up4(x, s2)
        x = F.interpolate(x, size=in_size, mode="bilinear", align_corners=False)
        return self.head(x)


def build_seg_model(pretrained_encoder: bool = True, freeze_encoder: bool = False) -> LesionUNet:
    model = LesionUNet(pretrained_encoder=pretrained_encoder)
    if freeze_encoder:
        model.set_encoder_trainable(False)
    return model
