"""
Pixel-level metrics for lesion segmentation.

All functions take two binary masks of the same shape (numpy arrays, any
dtype; non-zero = lesion):
    pred -- the model's predicted lesion mask (A)
    true -- the expert's ground-truth lesion mask (B)

    Dice = 2|A∩B| / (|A| + |B|)  =  2·TP / (2·TP + FP + FN)
    IoU  =  |A∩B| / |A∪B|        =    TP / (TP + FP + FN)

Empty-mask convention (documented in docs/segmentation.md):
    * both masks empty          -> 1.0  (the model correctly found "no lesion")
    * exactly one mask empty    -> 0.0  (complete miss / complete false alarm)
The same convention applies to precision, recall and boundary F1 when their
denominator is zero.

Two ways of summarising a test set are reported, because they answer
different questions and can differ a lot:
    * mean (per-image) Dice -- average of each image's Dice. Every image
      counts equally, so small-lesion images pull the score down.
    * micro (dataset-level) Dice -- TP/FP/FN summed over all pixels of all
      images, then one Dice. Large lesions dominate.

No number here is ever invented: these functions only compute from masks.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Lesion-size buckets by share of the image covered by the *ground-truth* lesion.
SMALL_MAX = 0.05
MEDIUM_MAX = 0.20


def _as_bool(mask) -> np.ndarray:
    arr = np.asarray(mask)
    return arr.astype(bool) if arr.dtype != bool else arr


def _check(pred, true) -> tuple[np.ndarray, np.ndarray]:
    p, t = _as_bool(pred), _as_bool(true)
    if p.shape != t.shape:
        raise ValueError(f"Mask shapes differ: pred {p.shape} vs true {t.shape}")
    return p, t


def confusion_counts(pred, true) -> tuple[int, int, int, int]:
    """Returns (TP, FP, FN, TN) pixel counts for the lesion class."""
    p, t = _check(pred, true)
    tp = int(np.logical_and(p, t).sum())
    fp = int(np.logical_and(p, ~t).sum())
    fn = int(np.logical_and(~p, t).sum())
    tn = int(p.size - tp - fp - fn)
    return tp, fp, fn, tn


def _ratio(num: float, den: float, both_empty: bool) -> float:
    if den == 0:
        return 1.0 if both_empty else 0.0
    return float(num) / float(den)


def dice_from_counts(tp: int, fp: int, fn: int) -> float:
    return _ratio(2 * tp, 2 * tp + fp + fn, both_empty=(tp + fp + fn) == 0)


def iou_from_counts(tp: int, fp: int, fn: int) -> float:
    return _ratio(tp, tp + fp + fn, both_empty=(tp + fp + fn) == 0)


def dice_score(pred, true, eps: float = 0.0) -> float:
    """Dice = 2·TP / (2·TP + FP + FN). `eps` (optional) is added to numerator
    and denominator for smoothing; the default 0 gives the exact value."""
    tp, fp, fn, _ = confusion_counts(pred, true)
    if eps:
        return float((2 * tp + eps) / (2 * tp + fp + fn + eps))
    return dice_from_counts(tp, fp, fn)


def iou_score(pred, true, eps: float = 0.0) -> float:
    """IoU (Jaccard) = TP / (TP + FP + FN). Always <= Dice for the same masks."""
    tp, fp, fn, _ = confusion_counts(pred, true)
    if eps:
        return float((tp + eps) / (tp + fp + fn + eps))
    return iou_from_counts(tp, fp, fn)


def precision_score(pred, true) -> float:
    """Of the pixels the model painted as lesion, the share that really are lesion."""
    tp, fp, fn, _ = confusion_counts(pred, true)
    return _ratio(tp, tp + fp, both_empty=(tp + fp + fn) == 0)


def recall_score(pred, true) -> float:
    """Of the real lesion pixels, the share the model found."""
    tp, fp, fn, _ = confusion_counts(pred, true)
    return _ratio(tp, tp + fn, both_empty=(tp + fp + fn) == 0)


# --- Boundary F1 -------------------------------------------------------------

def _shift_or(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary dilation with a (2r+1)x(2r+1) square, numpy only."""
    if radius <= 0:
        return mask.copy()
    h, w = mask.shape
    padded = np.pad(mask, radius, mode="constant", constant_values=False)
    out = np.zeros_like(mask)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            out |= padded[radius + dy: radius + dy + h, radius + dx: radius + dx + w]
    return out


def _erode(mask: np.ndarray) -> np.ndarray:
    """Binary erosion with a 3x3 square (pixels outside the image count as background)."""
    h, w = mask.shape
    padded = np.pad(mask, 1, mode="constant", constant_values=False)
    out = np.ones_like(mask)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out &= padded[1 + dy: 1 + dy + h, 1 + dx: 1 + dx + w]
    return out


def boundary(mask) -> np.ndarray:
    """1-pixel-wide inner boundary of a binary mask."""
    m = _as_bool(mask)
    return m & ~_erode(m)


def boundary_f1(pred, true, tolerance: int = 2) -> float:
    """
    Boundary F1: how well the predicted lesion *edges* line up with the
    expert's edges, allowing `tolerance` pixels of slack.
    """
    p, t = _check(pred, true)
    pb, tb = boundary(p), boundary(t)
    n_pb, n_tb = int(pb.sum()), int(tb.sum())
    if n_pb == 0 and n_tb == 0:
        return 1.0
    if n_pb == 0 or n_tb == 0:
        return 0.0
    precision = float((pb & _shift_or(tb, tolerance)).sum()) / n_pb
    recall = float((tb & _shift_or(pb, tolerance)).sum()) / n_tb
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


# --- Aggregation over a dataset ---------------------------------------------

def size_bucket(true_fraction: float) -> str:
    if true_fraction <= 0:
        return "no_lesion"
    if true_fraction < SMALL_MAX:
        return "small"
    if true_fraction <= MEDIUM_MAX:
        return "medium"
    return "large"


def _describe(values: list[float]) -> dict:
    if not values:
        return {"min": None, "p25": None, "median": None, "p75": None, "max": None}
    arr = np.asarray(values, dtype=np.float64)
    return {
        "min": float(arr.min()),
        "p25": float(np.percentile(arr, 25)),
        "median": float(np.median(arr)),
        "p75": float(np.percentile(arr, 75)),
        "max": float(arr.max()),
    }


@dataclass
class SegmentationMetricAccumulator:
    """Collects per-image results and summed pixel counts for a test/val set."""
    boundary_tolerance: int = 2
    compute_boundary: bool = True
    tp: int = 0
    fp: int = 0
    fn: int = 0
    per_image: list[dict] = field(default_factory=list)

    def add(self, pred, true, name: str | None = None) -> dict:
        p, t = _check(pred, true)
        tp, fp, fn, _ = confusion_counts(p, t)
        self.tp += tp
        self.fp += fp
        self.fn += fn
        true_fraction = float(t.sum()) / float(t.size) if t.size else 0.0
        row = {
            "name": name,
            "dice": dice_from_counts(tp, fp, fn),
            "iou": iou_from_counts(tp, fp, fn),
            "true_lesion_fraction": true_fraction,
            "size_bucket": size_bucket(true_fraction),
        }
        if self.compute_boundary:
            row["boundary_f1"] = boundary_f1(p, t, self.boundary_tolerance)
        self.per_image.append(row)
        return row

    @property
    def n_images(self) -> int:
        return len(self.per_image)

    def mean_dice(self) -> float | None:
        return float(np.mean([r["dice"] for r in self.per_image])) if self.per_image else None

    def summary(self, worst_k: int = 5) -> dict:
        if not self.per_image:
            raise ValueError("No images were evaluated; cannot compute segmentation metrics.")
        dices = [r["dice"] for r in self.per_image]
        ious = [r["iou"] for r in self.per_image]
        both_empty = (self.tp + self.fp + self.fn) == 0

        by_size = {}
        for bucket in ("small", "medium", "large", "no_lesion"):
            rows = [r for r in self.per_image if r["size_bucket"] == bucket]
            by_size[bucket] = {
                "n_images": len(rows),
                "mean_dice": float(np.mean([r["dice"] for r in rows])) if rows else None,
                "mean_iou": float(np.mean([r["iou"] for r in rows])) if rows else None,
            }

        out = {
            "n_images": self.n_images,
            "mean_dice": float(np.mean(dices)),
            "micro_dice": dice_from_counts(self.tp, self.fp, self.fn),
            "mean_iou": float(np.mean(ious)),
            "micro_iou": iou_from_counts(self.tp, self.fp, self.fn),
            "micro_precision": _ratio(self.tp, self.tp + self.fp, both_empty),
            "micro_recall": _ratio(self.tp, self.tp + self.fn, both_empty),
            "pixel_counts": {"tp": self.tp, "fp": self.fp, "fn": self.fn},
            "dice_distribution": _describe(dices),
            "by_lesion_size": by_size,
            "lesion_size_buckets": {
                "small": f"ground-truth lesion < {SMALL_MAX:.0%} of image",
                "medium": f"{SMALL_MAX:.0%} - {MEDIUM_MAX:.0%}",
                "large": f"> {MEDIUM_MAX:.0%}",
                "no_lesion": "ground-truth mask is empty",
            },
        }
        if self.compute_boundary:
            out["mean_boundary_f1"] = float(np.mean([r["boundary_f1"] for r in self.per_image]))
            out["boundary_tolerance_px"] = self.boundary_tolerance
        named = [r for r in self.per_image if r.get("name")]
        if named and worst_k > 0:
            worst = sorted(named, key=lambda r: r["dice"])[:worst_k]
            out["worst_images"] = [{"name": r["name"], "dice": r["dice"]} for r in worst]
        return out
