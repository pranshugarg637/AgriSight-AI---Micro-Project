"""
Temperature scaling (Guo et al., 2017) + calibration metrics.

A single scalar T > 0 divides the logits before the softmax. It is fitted
on the VALIDATION split by minimising negative log-likelihood; it does not
change which class is predicted (argmax), only how confident the
probabilities are. The confidence tiers then operate on calibrated
probabilities.
"""
from __future__ import annotations

import numpy as np


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = np.asarray(logits, dtype=np.float64) / float(temperature)
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def nll(logits: np.ndarray, labels: np.ndarray, temperature: float = 1.0) -> float:
    p = softmax(logits, temperature)
    return float(-np.mean(np.log(np.clip(p[np.arange(len(labels)), labels], 1e-12, 1.0))))


def fit_temperature(logits: np.ndarray, labels: np.ndarray, t_min: float = 0.05, t_max: float = 20.0) -> float:
    """1-D minimisation of NLL over log(T): coarse grid then golden-section refinement.
    Deterministic, dependency-free, and robust (NLL is unimodal in T in practice)."""
    logits = np.asarray(logits, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    grid = np.exp(np.linspace(np.log(t_min), np.log(t_max), 81))
    losses = [nll(logits, labels, t) for t in grid]
    i = int(np.argmin(losses))
    lo = np.log(grid[max(i - 1, 0)])
    hi = np.log(grid[min(i + 1, len(grid) - 1)])
    phi = (np.sqrt(5) - 1) / 2
    a, b = lo, hi
    c, d = b - phi * (b - a), a + phi * (b - a)
    for _ in range(60):
        if nll(logits, labels, np.exp(c)) < nll(logits, labels, np.exp(d)):
            b = d
        else:
            a = c
        c, d = b - phi * (b - a), a + phi * (b - a)
    return float(np.exp((a + b) / 2))


def reliability_bins(probs: np.ndarray, labels: np.ndarray, n_bins: int = 15) -> list[dict]:
    """Per confidence bin: mean confidence, accuracy, count (top-1)."""
    conf = probs.max(axis=1)
    pred = probs.argmax(axis=1)
    correct = (pred == labels).astype(np.float64)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (conf > lo) & (conf <= hi) if lo > 0 else (conf >= lo) & (conf <= hi)
        n = int(mask.sum())
        out.append({
            "lower": round(float(lo), 4), "upper": round(float(hi), 4), "count": n,
            "mean_confidence": float(conf[mask].mean()) if n else None,
            "accuracy": float(correct[mask].mean()) if n else None,
        })
    return out


def expected_calibration_error(probs: np.ndarray, labels: np.ndarray, n_bins: int = 15) -> float:
    total = len(labels)
    ece = 0.0
    for b in reliability_bins(probs, labels, n_bins):
        if b["count"]:
            ece += b["count"] / total * abs(b["accuracy"] - b["mean_confidence"])
    return float(ece)


def draw_reliability_diagram(bins_before: list[dict], bins_after: list[dict], path, title: str = "Reliability diagram") -> None:
    """Small PNG without matplotlib: bars = accuracy per bin, diagonal = perfect calibration."""
    from PIL import Image, ImageDraw

    W, H, M = 720, 380, 50
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    panels = [("before (T=1)", bins_before, (60, 110, 200)), ("after temperature scaling", bins_after, (40, 150, 70))]
    pw = (W - 3 * M) // 2
    for k, (label, bins, color) in enumerate(panels):
        x0 = M + k * (pw + M)
        y0, y1 = M, H - M
        d.rectangle([x0, y0, x0 + pw, y1], outline="black")
        d.line([x0, y1, x0 + pw, y0], fill=(160, 160, 160))
        n = len(bins)
        for i, b in enumerate(bins):
            if not b["count"]:
                continue
            bx0 = x0 + i * pw / n
            bx1 = x0 + (i + 1) * pw / n - 1
            d.rectangle([bx0, y1 - b["accuracy"] * (y1 - y0), bx1, y1], fill=color)
        d.text((x0, y1 + 8), f"{label}: confidence ->", fill="black")
        d.text((x0, y0 - 16), "accuracy", fill="black")
    d.text((M, 8), title, fill="black")
    img.save(path)
