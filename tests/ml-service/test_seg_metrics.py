"""Hand-computed checks for the segmentation metrics (Dice, IoU, precision, recall, boundary F1)."""
import numpy as np
import pytest

from app.segmentation.metrics import (
    SegmentationMetricAccumulator, boundary_f1, confusion_counts, dice_score, iou_score,
    precision_score, recall_score, size_bucket,
)


def _row(bits):
    return np.array([bits], dtype=np.uint8)


def test_partial_overlap_known_numbers():
    # pred: 1 1 1 1 0 0 0 0
    # true: 0 0 1 1 1 1 0 0   -> TP=2, FP=2, FN=2, TN=2
    pred, true = _row([1, 1, 1, 1, 0, 0, 0, 0]), _row([0, 0, 1, 1, 1, 1, 0, 0])
    assert confusion_counts(pred, true) == (2, 2, 2, 2)
    assert dice_score(pred, true) == pytest.approx(0.5)          # 2*2 / (2*2 + 2 + 2)
    assert iou_score(pred, true) == pytest.approx(1 / 3)         # 2 / (2 + 2 + 2)
    assert precision_score(pred, true) == pytest.approx(0.5)     # 2 / (2 + 2)
    assert recall_score(pred, true) == pytest.approx(0.5)        # 2 / (2 + 2)


def test_asymmetric_overlap_precision_vs_recall():
    # Model paints too little: TP=1, FP=0, FN=3
    pred, true = _row([1, 0, 0, 0]), _row([1, 1, 1, 1])
    assert precision_score(pred, true) == pytest.approx(1.0)
    assert recall_score(pred, true) == pytest.approx(0.25)
    assert dice_score(pred, true) == pytest.approx(2 / 5)       # 2*1 / (2 + 0 + 3)
    assert iou_score(pred, true) == pytest.approx(1 / 4)


def test_perfect_overlap():
    m = np.zeros((10, 10), dtype=bool)
    m[2:5, 3:8] = True
    assert dice_score(m, m) == 1.0
    assert iou_score(m, m) == 1.0
    assert boundary_f1(m, m) == 1.0


def test_no_overlap_is_zero():
    a = np.zeros((6, 6), dtype=bool)
    b = np.zeros((6, 6), dtype=bool)
    a[0:2, 0:2] = True
    b[4:6, 4:6] = True
    assert dice_score(a, b) == 0.0
    assert iou_score(a, b) == 0.0
    assert precision_score(a, b) == 0.0
    assert recall_score(a, b) == 0.0


def test_both_empty_counts_as_perfect():
    z = np.zeros((5, 5), dtype=bool)
    assert dice_score(z, z) == 1.0
    assert iou_score(z, z) == 1.0
    assert precision_score(z, z) == 1.0
    assert recall_score(z, z) == 1.0
    assert boundary_f1(z, z) == 1.0


def test_exactly_one_empty_is_zero():
    z = np.zeros((5, 5), dtype=bool)
    m = z.copy()
    m[1:3, 1:3] = True
    for pred, true in ((z, m), (m, z)):
        assert dice_score(pred, true) == 0.0
        assert iou_score(pred, true) == 0.0
        assert boundary_f1(pred, true) == 0.0
    assert precision_score(z, m) == 0.0   # nothing predicted, lesion missed
    assert recall_score(m, z) == 0.0      # lesion painted where there is none


def test_iou_never_exceeds_dice_and_relation_holds():
    rng = np.random.default_rng(0)
    for _ in range(20):
        a, b = rng.random((16, 16)) > 0.6, rng.random((16, 16)) > 0.6
        d, j = dice_score(a, b), iou_score(a, b)
        assert j <= d + 1e-12
        assert d == pytest.approx(2 * j / (1 + j))


def test_shape_mismatch_raises():
    with pytest.raises(ValueError):
        dice_score(np.zeros((3, 3)), np.zeros((3, 4)))


def test_eps_smoothing_is_opt_in():
    z = np.zeros((2, 2))
    assert dice_score(z, z, eps=1.0) == 1.0
    pred, true = _row([1, 1, 0, 0]), _row([0, 1, 1, 0])
    assert dice_score(pred, true, eps=1.0) == pytest.approx((2 + 1) / (2 + 1 + 1 + 1))


def test_boundary_f1_tolerance():
    a = np.zeros((20, 20), dtype=bool)
    a[5:15, 5:15] = True
    shifted = np.roll(a, 1, axis=1)          # edges move by 1 px
    assert boundary_f1(a, shifted, tolerance=2) == pytest.approx(1.0)
    assert boundary_f1(a, shifted, tolerance=0) < 1.0
    far = np.roll(a, 6, axis=1)
    assert boundary_f1(a, far, tolerance=1) < 0.7


def test_mean_vs_micro_dice_differ():
    big_true = np.zeros((10, 10), dtype=bool)
    big_true[:, :] = True                     # 100 lesion pixels, predicted perfectly
    small_true = np.zeros((10, 10), dtype=bool)
    small_true[0, 0] = True                   # 1 lesion pixel, missed completely
    acc = SegmentationMetricAccumulator(compute_boundary=False)
    acc.add(big_true, big_true, "big")
    acc.add(np.zeros_like(small_true), small_true, "small")
    s = acc.summary()
    assert s["mean_dice"] == pytest.approx(0.5)             # (1.0 + 0.0) / 2
    assert s["micro_dice"] == pytest.approx(200 / 201)      # 2*100 / (2*100 + 0 + 1)
    assert s["micro_iou"] == pytest.approx(100 / 101)
    assert s["micro_precision"] == pytest.approx(1.0)
    assert s["micro_recall"] == pytest.approx(100 / 101)
    assert s["pixel_counts"] == {"tp": 100, "fp": 0, "fn": 1}
    assert s["worst_images"][0] == {"name": "small", "dice": 0.0}


def test_summary_size_buckets_and_distribution():
    acc = SegmentationMetricAccumulator()
    size = 100
    for frac, name in ((0.01, "tiny"), (0.10, "mid"), (0.50, "large"), (0.0, "clean")):
        true = np.zeros((size, size), dtype=bool)
        true.flat[: int(frac * size * size)] = True
        acc.add(true, true, name)
    s = acc.summary()
    assert s["n_images"] == 4
    assert {k: v["n_images"] for k, v in s["by_lesion_size"].items()} == {
        "small": 1, "medium": 1, "large": 1, "no_lesion": 1}
    assert s["dice_distribution"]["min"] == 1.0 and s["dice_distribution"]["max"] == 1.0
    assert s["mean_boundary_f1"] == pytest.approx(1.0)


def test_size_bucket_edges():
    assert size_bucket(0.0) == "no_lesion"
    assert size_bucket(0.049) == "small"
    assert size_bucket(0.05) == "medium"
    assert size_bucket(0.20) == "medium"
    assert size_bucket(0.21) == "large"


def test_empty_accumulator_raises():
    with pytest.raises(ValueError):
        SegmentationMetricAccumulator().summary()
