"""
Synthetic "junk" images for the OOD evaluation when no real junk set is
available: random noise, flat colours, gradients, stripes and simple shapes.
They are clearly labelled as synthetic in every report -- they are a weak
stand-in for real junk photos (hands, soil, sky, walls, other crops), which
must be collected by a person (docs/HUMAN_TODO.md).
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw


def synthetic_junk_images(n: int = 60, size: int = 256, seed: int = 0) -> list[tuple[str, Image.Image]]:
    rng = np.random.default_rng(seed)
    out: list[tuple[str, Image.Image]] = []
    kinds = ["noise", "flat", "gradient", "stripes", "shapes", "skin_tone", "soil_like"]
    for i in range(n):
        kind = kinds[i % len(kinds)]
        if kind == "noise":
            arr = rng.integers(0, 256, (size, size, 3), dtype=np.uint8)
        elif kind == "flat":
            arr = np.full((size, size, 3), rng.integers(0, 256, 3), dtype=np.uint8)
        elif kind == "gradient":
            a, b = rng.integers(0, 256, 3), rng.integers(0, 256, 3)
            t = np.linspace(0, 1, size)[None, :, None]
            arr = np.broadcast_to(a * (1 - t) + b * t, (size, size, 3)).astype(np.uint8)
        elif kind == "stripes":
            arr = np.zeros((size, size, 3), dtype=np.uint8)
            arr[:, ::16] = rng.integers(0, 256, 3)
            arr[::16] = rng.integers(0, 256, 3)
        elif kind == "shapes":
            img = Image.new("RGB", (size, size), tuple(int(x) for x in rng.integers(0, 256, 3)))
            d = ImageDraw.Draw(img)
            for _ in range(6):
                x0, y0 = rng.integers(0, size - 40, 2)
                d.ellipse([x0, y0, x0 + rng.integers(20, 120), y0 + rng.integers(20, 120)],
                          fill=tuple(int(x) for x in rng.integers(0, 256, 3)))
            out.append((f"synthetic_{kind}_{i}", img))
            continue
        elif kind == "skin_tone":
            base = np.array([205, 150, 120]) + rng.integers(-30, 30, 3)
            arr = np.clip(base + rng.normal(0, 8, (size, size, 3)), 0, 255).astype(np.uint8)
        else:  # soil_like: brown texture (note: brown hues overlap lesion colours)
            base = np.array([110, 80, 50]) + rng.integers(-20, 20, 3)
            arr = np.clip(base + rng.normal(0, 25, (size, size, 3)), 0, 255).astype(np.uint8)
        out.append((f"synthetic_{kind}_{i}", Image.fromarray(arr)))
    return out
