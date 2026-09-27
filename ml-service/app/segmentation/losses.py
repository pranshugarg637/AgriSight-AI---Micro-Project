"""
Training loss for lesion segmentation: weighted BCE + soft Dice.

Why both: lesions are often a small share of the image. Plain BCE is
dominated by the many easy background pixels, so a model can score a low
BCE while missing small lesions. The soft-Dice term only looks at the
overlap of the lesion class, which pushes the model to actually find them.
BCE keeps training stable early on, when Dice gradients are noisy.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


def soft_dice_loss(logits: torch.Tensor, targets: torch.Tensor, smooth: float = 1.0) -> torch.Tensor:
    """1 - soft Dice, computed per image and averaged over the batch."""
    probs = torch.sigmoid(logits)
    dims = tuple(range(1, probs.ndim))
    intersection = (probs * targets).sum(dim=dims)
    denom = probs.sum(dim=dims) + targets.sum(dim=dims)
    dice = (2 * intersection + smooth) / (denom + smooth)
    return 1.0 - dice.mean()


class BCEDiceLoss(nn.Module):
    def __init__(self, bce_weight: float = 0.5, dice_weight: float = 0.5, smooth: float = 1.0):
        super().__init__()
        self.bce_weight = bce_weight
        self.dice_weight = dice_weight
        self.smooth = smooth

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        bce = F.binary_cross_entropy_with_logits(logits, targets)
        dice = soft_dice_loss(logits, targets, self.smooth)
        return self.bce_weight * bce + self.dice_weight * dice
