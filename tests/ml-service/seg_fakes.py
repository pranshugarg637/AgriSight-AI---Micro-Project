"""Synthetic image/mask pairs for segmentation tests (NOT real ground truth -- test fixtures only)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

LEAF_GREEN = (40, 150, 50)
LESION_RED = (200, 30, 30)
BACKGROUND = (128, 128, 128)


def make_pair(size: int = 64, box=(20, 20, 40, 44), seed: int = 0):
    """Grey background, green leaf disk, red rectangular 'lesion'. Returns (rgb uint8, mask bool)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 3), dtype=np.uint8)
    img[:] = BACKGROUND
    yy, xx = np.mgrid[:size, :size]
    leaf = (yy - size / 2) ** 2 + (xx - size / 2) ** 2 < (size * 0.45) ** 2
    img[leaf] = LEAF_GREEN
    y0, x0, y1, x1 = box
    mask = np.zeros((size, size), dtype=bool)
    mask[y0:y1, x0:x1] = True
    img[mask] = LESION_RED
    img = np.clip(img.astype(int) + rng.integers(-8, 8, img.shape), 0, 255).astype(np.uint8)
    return img, mask


def write_dataset(base: Path, n: int = 12, size: int = 64) -> Path:
    (base / "images").mkdir(parents=True, exist_ok=True)
    (base / "masks").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(1)
    for i in range(n):
        y0, x0 = int(rng.integers(8, size // 2)), int(rng.integers(8, size // 2))
        img, mask = make_pair(size, (y0, x0, y0 + size // 4, x0 + size // 3), seed=i)
        Image.fromarray(img).save(base / "images" / f"leaf_{i:03d}.jpg")
        Image.fromarray((mask * 255).astype(np.uint8)).save(base / "masks" / f"leaf_{i:03d}.png")
    return base
