"""
Paired image / lesion-mask dataset for the segmentation add-on.

Expected layout (see docs/segmentation.md):

    data/segmentation/
      images/   <name>.jpg | .jpeg | .png
      masks/    <name>.png        0 = not lesion, anything else = lesion
                                (single-channel class-index masks such as PlantSeg's,
                                 or colour masks such as red-on-black, both work)

An image and its mask are paired by file stem ("leaf_001.jpg" <-> "leaf_001.png").

IMPORTANT: masks must be real, hand-annotated ground truth. This module never
creates masks (not from Grad-CAM, not from colour thresholds).
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms
from torchvision.transforms import InterpolationMode
from torchvision.transforms import functional as TF

from app.training.dataset import IMAGENET_MEAN, IMAGENET_STD

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MASK_EXTENSIONS = {".png", ".bmp", ".jpg", ".jpeg"}  # PNG strongly preferred (lossless)
# For colour (RGB) masks: a pixel counts as lesion if any channel is above this.
# Tolerates JPEG noise around black backgrounds; e.g. red (128, 0, 0) -> lesion.
RGB_MASK_THRESHOLD = 20


@dataclass(frozen=True)
class SegPair:
    name: str
    image_path: Path
    mask_path: Path


class SegmentationDatasetError(ValueError):
    """Raised when the segmentation dataset folder is missing or unusable."""


def _files_by_stem(folder: Path, extensions: set[str]) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in extensions:
            out.setdefault(p.stem, p)
    return out


def validate_segmentation_dataset(dataset_path: Path, min_pairs: int = 10, check_sizes: bool = True) -> dict:
    """
    Checks the folder layout and pairs images with masks by file stem.

    Raises SegmentationDatasetError if the folders are missing or there are
    fewer than `min_pairs` usable pairs. Unpaired or size-mismatched files are
    reported (and skipped) rather than silently ignored.
    """
    dataset_path = Path(dataset_path)
    images_dir, masks_dir = dataset_path / "images", dataset_path / "masks"
    missing_dirs = [str(d) for d in (images_dir, masks_dir) if not d.is_dir()]
    if missing_dirs:
        raise SegmentationDatasetError(
            f"Segmentation dataset folders not found: {missing_dirs}. Expected "
            f"'{dataset_path}/images/' and '{dataset_path}/masks/'. See docs/segmentation.md."
        )

    images = _files_by_stem(images_dir, IMAGE_EXTENSIONS)
    masks = _files_by_stem(masks_dir, MASK_EXTENSIONS)

    images_without_mask = sorted(set(images) - set(masks))
    masks_without_image = sorted(set(masks) - set(images))

    pairs: list[SegPair] = []
    size_mismatches: list[str] = []
    unreadable: list[str] = []
    for stem in sorted(set(images) & set(masks)):
        if check_sizes:
            try:
                with Image.open(images[stem]) as im, Image.open(masks[stem]) as mk:
                    if im.size != mk.size:
                        size_mismatches.append(f"{stem}: image {im.size} vs mask {mk.size}")
                        continue
            except Exception as e:  # corrupt file
                unreadable.append(f"{stem}: {e}")
                continue
        pairs.append(SegPair(stem, images[stem], masks[stem]))

    report = {
        "dataset_path": str(dataset_path),
        "num_pairs": len(pairs),
        "images_without_mask": images_without_mask,
        "masks_without_image": masks_without_image,
        "size_mismatches": size_mismatches,
        "unreadable": unreadable,
    }
    for key in ("images_without_mask", "masks_without_image", "size_mismatches", "unreadable"):
        if report[key]:
            logger.warning("Segmentation dataset: %d %s (skipped), e.g. %s",
                           len(report[key]), key.replace("_", " "), report[key][:3])

    if len(pairs) < min_pairs:
        raise SegmentationDatasetError(
            f"Only {len(pairs)} usable image/mask pairs found in {dataset_path} "
            f"(need at least {min_pairs}). Problems: "
            f"{len(images_without_mask)} images without a mask, "
            f"{len(masks_without_image)} masks without an image, "
            f"{len(size_mismatches)} size mismatches, {len(unreadable)} unreadable files."
        )
    report["pairs"] = pairs
    return report


def split_pairs(pairs: list[SegPair], val_split: float, test_split: float, seed: int = 42):
    """Deterministic train/val/test split (same seed -> same split, so evaluate.py can rebuild it)."""
    ordered = sorted(pairs, key=lambda p: p.name)
    rng = random.Random(seed)
    rng.shuffle(ordered)
    n = len(ordered)
    n_val = int(n * val_split)
    n_test = int(n * test_split)
    if n >= 3:
        n_val, n_test = max(1, n_val), max(1, n_test)
    n_train = n - n_val - n_test
    if n_train < 1:
        raise SegmentationDatasetError(f"Not enough pairs ({n}) for a train/val/test split.")
    return ordered[:n_train], ordered[n_train:n_train + n_val], ordered[n_train + n_val:]


def load_mask(path: Path) -> np.ndarray:
    """
    Loads a mask file as a boolean array.
      * single-channel / palette masks (class indices, 0/255): any non-zero pixel = lesion
      * RGB masks (coloured lesions on black): any channel > RGB_MASK_THRESHOLD = lesion
    Multi-class masks (one value per disease) are merged into lesion vs. background.
    """
    with Image.open(path) as m:
        if m.mode in ("RGB", "RGBA"):
            arr = np.array(m.convert("RGB"))
            return arr.max(axis=2) > RGB_MASK_THRESHOLD
        if m.mode in ("1", "L", "P", "I", "I;16", "F"):
            return np.array(m) > 0
        return np.array(m.convert("L")) > 0


class SegmentationDataset(Dataset):
    """
    Returns (image_tensor[3,H,W] normalised, mask_tensor[1,H,W] float 0/1).

    Training augmentation applies the SAME geometric transform (resized crop,
    flips, rotation) to the image and the mask; colour jitter touches the image
    only. Masks are always resized with nearest-neighbour so they stay binary.
    """

    def __init__(self, pairs: list[SegPair], image_size: int, train: bool = False):
        self.pairs = list(pairs)
        self.image_size = int(image_size)
        self.train = train
        self.color_jitter = transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.02)

    def __len__(self) -> int:
        return len(self.pairs)

    def _joint_transform(self, image: Image.Image, mask: Image.Image):
        size = [self.image_size, self.image_size]
        if self.train:
            i, j, h, w = transforms.RandomResizedCrop.get_params(image, scale=(0.6, 1.0), ratio=(3 / 4, 4 / 3))
            image = TF.resized_crop(image, i, j, h, w, size, interpolation=InterpolationMode.BILINEAR)
            mask = TF.resized_crop(mask, i, j, h, w, size, interpolation=InterpolationMode.NEAREST)
            if random.random() < 0.5:
                image, mask = TF.hflip(image), TF.hflip(mask)
            if random.random() < 0.5:
                image, mask = TF.vflip(image), TF.vflip(mask)
            angle = random.uniform(-20.0, 20.0)
            image = TF.rotate(image, angle, interpolation=InterpolationMode.BILINEAR, fill=0)
            mask = TF.rotate(mask, angle, interpolation=InterpolationMode.NEAREST, fill=0)
            image = self.color_jitter(image)
        else:
            image = TF.resize(image, size, interpolation=InterpolationMode.BILINEAR)
            mask = TF.resize(mask, size, interpolation=InterpolationMode.NEAREST)
        return image, mask

    def __getitem__(self, idx: int):
        pair = self.pairs[idx]
        with Image.open(pair.image_path) as im:
            image = im.convert("RGB")
        mask = Image.fromarray((load_mask(pair.mask_path) * 255).astype(np.uint8))
        image, mask = self._joint_transform(image, mask)
        image_t = TF.normalize(TF.to_tensor(image), IMAGENET_MEAN, IMAGENET_STD)
        mask_t = torch.from_numpy((np.array(mask) > 127).astype(np.float32)).unsqueeze(0)
        return image_t, mask_t
