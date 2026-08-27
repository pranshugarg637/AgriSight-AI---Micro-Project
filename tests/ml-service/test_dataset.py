import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml-service"))

from app.training.dataset import validate_dataset_structure, load_datasets, DatasetValidationError


def test_validate_dataset_structure_success(synthetic_dataset_path):
    report = validate_dataset_structure(synthetic_dataset_path)
    assert report["num_classes"] == 3
    assert report["total_images"] == 60


def test_validate_dataset_missing_path(tmp_path):
    with pytest.raises(DatasetValidationError):
        validate_dataset_structure(tmp_path / "does_not_exist")


def test_validate_dataset_too_few_classes(tmp_path):
    (tmp_path / "only_one_class").mkdir(parents=True)
    with pytest.raises(DatasetValidationError):
        validate_dataset_structure(tmp_path)


def test_load_datasets_splits_correctly(synthetic_dataset_path):
    train, val, test, class_names = load_datasets(synthetic_dataset_path, 224, 0.15, 0.15)
    assert len(class_names) == 3
    assert len(train) + len(val) + len(test) == 60
    image, label = train[0]
    assert image.shape == (3, 224, 224)
    assert 0 <= label < 3
