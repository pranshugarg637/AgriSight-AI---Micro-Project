"""
Out-of-distribution ("I don't know") checks, applied after the CNN.

1. Leaf-likeness (`not_a_leaf`): share of plant-coloured pixels (greens,
   yellows, browns) in the central 60% of the image. Cheap colour heuristic;
   catches blank walls, skin-free objects, documents, sky -- not a
   classifier.
2. Energy score (`unsupported_crop`): E(x) = -T * logsumexp(logits / T)
   (Liu et al., 2020). In-distribution images tend to have lower energy.
   The threshold is fitted on the validation split so that a chosen share
   (default 95%) of in-distribution images is accepted.

Both thresholds live in model_config.json ("ood" block) and are only used
if present -- nothing is guessed at runtime.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image


def energy_score(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = np.atleast_2d(np.asarray(logits, dtype=np.float64)) / temperature
    m = z.max(axis=1, keepdims=True)
    lse = (m + np.log(np.exp(z - m).sum(axis=1, keepdims=True)))[:, 0]
    return -temperature * lse


def leaf_pixel_ratio(image: Image.Image, size: int = 128, centre: float = 0.6) -> float:
    arr = np.asarray(image.convert("RGB").resize((size, size)), dtype=np.float32) / 255.0
    m = int(size * (1 - centre) / 2)
    arr = arr[m:size - m, m:size - m]
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    delta = mx - mn
    s = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0)
    hue = np.zeros_like(mx)
    safe = np.maximum(delta, 1e-6)
    hue = np.where(mx == r, 60 * (((g - b) / safe) % 6), hue)
    hue = np.where(mx == g, 60 * ((b - r) / safe + 2), hue)
    hue = np.where(mx == b, 60 * ((r - g) / safe + 4), hue)
    plant = (mx >= 0.12) & (s >= 0.18) & (hue >= 10) & (hue <= 170)
    return float(plant.mean())


def threshold_for_tpr(scores_in_distribution: np.ndarray, tpr: float = 0.95) -> float:
    """Energy threshold accepting `tpr` of in-distribution samples (accept if energy <= thr)."""
    return float(np.quantile(np.asarray(scores_in_distribution, dtype=np.float64), tpr))


@dataclass
class OODConfig:
    energy_threshold: float | None = None
    leaf_ratio_threshold: float | None = None
    temperature: float = 1.0

    @classmethod
    def from_model_config(cls, cfg: dict) -> "OODConfig":
        block = cfg.get("ood") or {}
        return cls(
            energy_threshold=block.get("energy_threshold"),
            leaf_ratio_threshold=block.get("leaf_ratio_threshold"),
            temperature=float(cfg.get("temperature", 1.0)),
        )

    @property
    def enabled(self) -> bool:
        return self.energy_threshold is not None or self.leaf_ratio_threshold is not None


def ood_reason(logits: np.ndarray, image: Image.Image, cfg: OODConfig) -> tuple[str | None, dict]:
    """Returns (reason | None, details). reason in {"not_a_leaf", "unsupported_crop"}."""
    details: dict = {}
    if cfg.leaf_ratio_threshold is not None:
        ratio = leaf_pixel_ratio(image)
        details["leaf_ratio"] = ratio
        if ratio < cfg.leaf_ratio_threshold:
            return "not_a_leaf", details
    if cfg.energy_threshold is not None:
        e = float(energy_score(logits, cfg.temperature)[0])
        details["energy"] = e
        if e > cfg.energy_threshold:
            return "unsupported_crop", details
    return None, details
