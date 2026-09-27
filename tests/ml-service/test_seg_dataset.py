"""Segmentation dataset: pairing/validation, deterministic split, image+mask stay aligned under augmentation."""
import random

import numpy as np
import pytest
import torch
from PIL import Image

from app.segmentation.dataset import (
    SegmentationDataset, SegmentationDatasetError, split_pairs, validate_segmentation_dataset,
)
from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD
from seg_fakes import make_pair, write_dataset


def test_missing_folders_raise_clear_error(tmp_path):
    with pytest.raises(SegmentationDatasetError, match="images"):
        validate_segmentation_dataset(tmp_path)


def test_pairs_by_stem_and_reports_problems(tmp_path):
    base = write_dataset(tmp_path / "seg", n=12)
    # image without a mask
    Image.fromarray(make_pair()[0]).save(base / "images" / "orphan_image.jpg")
    # mask without an image
    Image.fromarray(np.zeros((64, 64), np.uint8)).save(base / "masks" / "orphan_mask.png")
    # size mismatch
    Image.fromarray(make_pair(64)[0]).save(base / "images" / "wrong_size.jpg")
    Image.fromarray(np.zeros((32, 32), np.uint8)).save(base / "masks" / "wrong_size.png")

    report = validate_segmentation_dataset(base, min_pairs=5)
    assert report["num_pairs"] == 12
    assert report["images_without_mask"] == ["orphan_image"]
    assert report["masks_without_image"] == ["orphan_mask"]
    assert len(report["size_mismatches"]) == 1 and report["size_mismatches"][0].startswith("wrong_size")
    assert all(p.image_path.stem == p.mask_path.stem for p in report["pairs"])


def test_too_few_pairs_raises(tmp_path):
    base = write_dataset(tmp_path / "seg", n=3)
    with pytest.raises(SegmentationDatasetError, match="Only 3 usable"):
        validate_segmentation_dataset(base, min_pairs=10)


def test_split_is_deterministic_and_disjoint(tmp_path):
    pairs = validate_segmentation_dataset(write_dataset(tmp_path / "seg", n=20), min_pairs=5)["pairs"]
    a = split_pairs(pairs, 0.15, 0.15, seed=7)
    b = split_pairs(list(reversed(pairs)), 0.15, 0.15, seed=7)
    assert [[p.name for p in s] for s in a] == [[p.name for p in s] for s in b]
    names = [p.name for s in a for p in s]
    assert len(names) == len(set(names)) == 20
    assert len(a[1]) >= 1 and len(a[2]) >= 1


def _unnormalise(t: torch.Tensor) -> np.ndarray:
    mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
    return ((t * std + mean).clamp(0, 1) * 255).permute(1, 2, 0).numpy()


def test_eval_transform_shapes_and_binary_mask(tmp_path):
    pairs = validate_segmentation_dataset(write_dataset(tmp_path / "seg", n=10), min_pairs=5)["pairs"]
    img, mask = SegmentationDataset(pairs, image_size=48, train=False)[0]
    assert img.shape == (3, 48, 48) and mask.shape == (1, 48, 48)
    assert set(torch.unique(mask).tolist()) <= {0.0, 1.0}


def test_augmentation_keeps_image_and_mask_aligned(tmp_path):
    base = tmp_path / "seg"
    (base / "images").mkdir(parents=True)
    (base / "masks").mkdir(parents=True)
    img, mask = make_pair(96, box=(30, 20, 60, 70))
    Image.fromarray(img).save(base / "images" / "a.png")
    Image.fromarray((mask * 255).astype(np.uint8)).save(base / "masks" / "a.png")
    pairs = validate_segmentation_dataset(base, min_pairs=1)["pairs"]
    ds = SegmentationDataset(pairs, image_size=64, train=True)

    for seed in range(15):
        random.seed(seed)
        torch.manual_seed(seed)
        x, m = ds[0]
        rgb = _unnormalise(x)
        m = m[0].numpy() > 0.5
        if m.sum() < 20:
            continue  # crop may have cut the lesion out entirely
        redness = rgb[..., 0] - rgb[..., 1]
        # Interior of the mask should be red, pixels well outside should not be.
        inner = m & np.roll(m, 2, 0) & np.roll(m, -2, 0) & np.roll(m, 2, 1) & np.roll(m, -2, 1)
        assert np.median(redness[inner]) > 80, f"seed {seed}: mask interior is not on the red lesion"
        outer = ~(m | np.roll(m, 3, 0) | np.roll(m, -3, 0) | np.roll(m, 3, 1) | np.roll(m, -3, 1))
        assert np.mean(redness[outer] > 80) < 0.05, f"seed {seed}: red lesion pixels found outside the mask"


def test_mask_formats_class_index_and_rgb(tmp_path):
    from app.segmentation.dataset import load_mask

    idx = np.zeros((8, 8), np.uint8)
    idx[2:4, 2:4] = 3                                   # class-index mask (e.g. disease id 3)
    Image.fromarray(idx).save(tmp_path / "idx.png")
    assert load_mask(tmp_path / "idx.png").sum() == 4

    rgb = np.zeros((8, 8, 3), np.uint8)
    rgb[0:2, 0:3] = (128, 0, 0)                          # red-on-black colour mask
    rgb[5, 5] = (6, 4, 7)                                # JPEG-style noise near black
    Image.fromarray(rgb).save(tmp_path / "rgb.png")
    assert load_mask(tmp_path / "rgb.png").sum() == 6


def test_prepare_copies_pairs_from_nested_folders(tmp_path):
    from app.segmentation.prepare import prepare

    src = tmp_path / "download"
    for split in ("train", "val"):
        (src / "images" / split).mkdir(parents=True)
        (src / "annotations" / split).mkdir(parents=True)
    for i, split in enumerate(("train", "train", "val")):
        img, mask = make_pair(32, seed=i)
        Image.fromarray(img).save(src / "images" / split / f"p{i}.jpg")
        Image.fromarray((mask * 255).astype(np.uint8)).save(src / "annotations" / split / f"p{i}.png")
    Image.fromarray(make_pair(32)[0]).save(src / "images" / "val" / "lonely.jpg")

    out = tmp_path / "segmentation"
    summary = prepare([src / "images"], [src / "annotations"], out)
    assert summary["copied_pairs"] == 3 and summary["images_without_mask"] == 1
    assert (src / "images" / "val" / "lonely.jpg").exists()          # source untouched
    assert validate_segmentation_dataset(out, min_pairs=3)["num_pairs"] == 3
