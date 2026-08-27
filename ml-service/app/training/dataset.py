"""
Dataset loading utilities.

Expected on-disk structure (standard PlantVillage / ImageFolder layout):

    data/plantvillage/
        Tomato___Late_blight/
            img1.jpg
            img2.jpg
        Tomato___Early_blight/
            img1.jpg
        Potato___healthy/
            img1.jpg
        ...

Class names are derived from folder names. Underscores in the folder name
are treated as separators for crop / disease when we build display labels.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Tuple

from torch.utils.data import DataLoader, random_split
from torchvision import datasets, transforms

logger = logging.getLogger(__name__)

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


class DatasetValidationError(Exception):
    """Raised when the dataset directory does not look like a valid ImageFolder dataset."""


def validate_dataset_structure(dataset_path: Path) -> dict:
    """
    Sanity-checks the dataset directory before we attempt to train.
    Returns a small report dict. Raises DatasetValidationError with a clear,
    actionable message if the structure is invalid.
    """
    if not dataset_path.exists():
        raise DatasetValidationError(
            f"Dataset path '{dataset_path}' does not exist.\n"
            "Download the PlantVillage dataset from Kaggle and place the class "
            "folders under this path. See docs/setup.md for exact steps."
        )

    class_dirs = [d for d in dataset_path.iterdir() if d.is_dir()]
    if len(class_dirs) < 2:
        raise DatasetValidationError(
            f"Expected at least 2 class subfolders under '{dataset_path}', found {len(class_dirs)}.\n"
            "Each subfolder should be named after a class, e.g. 'Tomato___Late_blight', "
            "and contain the images for that class."
        )

    valid_ext = {".jpg", ".jpeg", ".png"}
    report = {}
    total_images = 0
    empty_classes = []
    for d in class_dirs:
        images = [f for f in d.iterdir() if f.suffix.lower() in valid_ext]
        report[d.name] = len(images)
        total_images += len(images)
        if len(images) == 0:
            empty_classes.append(d.name)

    if empty_classes:
        raise DatasetValidationError(
            f"The following class folders contain no valid images: {empty_classes}. "
            "Remove empty folders or add images to them."
        )

    if total_images < 50:
        raise DatasetValidationError(
            f"Only {total_images} images found across all classes. This is too few to train "
            "a meaningful model. Verify the dataset downloaded correctly."
        )

    logger.info("Dataset validated: %d classes, %d images total.", len(class_dirs), total_images)
    return {"num_classes": len(class_dirs), "total_images": total_images, "per_class_counts": report}


def build_transforms(image_size: int) -> Tuple[transforms.Compose, transforms.Compose]:
    """Returns (train_transform_with_augmentation, eval_transform)."""
    train_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.RandomRotation(degrees=15),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )
    eval_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )
    return train_tf, eval_tf


def load_datasets(dataset_path: Path, image_size: int, val_split: float, test_split: float, seed: int = 42):
    """
    Loads the ImageFolder dataset and splits into train/val/test.
    Train split uses augmentation; val/test use the plain eval transform.
    """
    train_tf, eval_tf = build_transforms(image_size)

    # Load once with eval transform to get consistent split indices, then
    # wrap the train subset with augmentation via a thin dataset proxy.
    full_dataset = datasets.ImageFolder(root=str(dataset_path), transform=eval_tf)
    class_names = full_dataset.classes

    n_total = len(full_dataset)
    n_val = int(n_total * val_split)
    n_test = int(n_total * test_split)
    n_train = n_total - n_val - n_test

    import torch

    generator = torch.Generator().manual_seed(seed)
    train_subset, val_subset, test_subset = random_split(
        full_dataset, [n_train, n_val, n_test], generator=generator
    )

    # Apply augmentation only to the training subset by cloning dataset with train transform
    train_dataset_aug = datasets.ImageFolder(root=str(dataset_path), transform=train_tf)
    train_subset_aug = torch.utils.data.Subset(train_dataset_aug, train_subset.indices)

    return train_subset_aug, val_subset, test_subset, class_names


def save_class_names(class_names: list[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(class_names, f, indent=2)
