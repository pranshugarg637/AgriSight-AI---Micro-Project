"""
Copy a downloaded masked dataset into the layout the trainer expects.

Downloaded datasets use their own folder names (train/val/test sub-folders,
"train_images" vs "train_masks", ...). This helper walks the folders you give
it, pairs images with masks by file name (stem), and COPIES each pair into:

    data/segmentation/images/<stem>.<ext>
    data/segmentation/masks/<stem>.<ext>

Nothing is modified or deleted in the source folders. Only files that have
a partner are copied; the rest are counted and reported.

Examples (Windows, run inside the ml-service folder):
    python -m app.segmentation.prepare --images D:/downloads/plantseg/images --masks D:/downloads/plantseg/annotations
    python -m app.segmentation.prepare ^
        --images D:/downloads/leafseg/orig_data/train_images D:/downloads/leafseg/orig_data/valid_images ^
        --masks  D:/downloads/leafseg/orig_data/train_masks  D:/downloads/leafseg/orig_data/valid_masks
"""
from __future__ import annotations

import argparse
import logging
import shutil
from pathlib import Path

from app.config import get_settings
from app.segmentation.dataset import IMAGE_EXTENSIONS, MASK_EXTENSIONS

logger = logging.getLogger(__name__)


def _collect(folders: list[Path], extensions: set[str]) -> tuple[dict[str, Path], list[str]]:
    found: dict[str, Path] = {}
    duplicates: list[str] = []
    for folder in folders:
        if not folder.is_dir():
            raise SystemExit(f"Folder not found: {folder}")
        for p in sorted(folder.rglob("*")):
            if p.is_file() and p.suffix.lower() in extensions:
                if p.stem in found:
                    duplicates.append(p.stem)
                    continue
                found[p.stem] = p
    return found, duplicates


def prepare(image_dirs: list[Path], mask_dirs: list[Path], out_dir: Path, limit: int | None = None) -> dict:
    images, dup_i = _collect(image_dirs, IMAGE_EXTENSIONS)
    masks, dup_m = _collect(mask_dirs, MASK_EXTENSIONS)
    stems = sorted(set(images) & set(masks))
    if limit:
        stems = stems[:limit]
    (out_dir / "images").mkdir(parents=True, exist_ok=True)
    (out_dir / "masks").mkdir(parents=True, exist_ok=True)
    for stem in stems:
        shutil.copy2(images[stem], out_dir / "images" / f"{stem}{images[stem].suffix.lower()}")
        shutil.copy2(masks[stem], out_dir / "masks" / f"{stem}{masks[stem].suffix.lower()}")
    summary = {
        "copied_pairs": len(stems),
        "images_without_mask": len(set(images) - set(masks)),
        "masks_without_image": len(set(masks) - set(images)),
        "duplicate_names_skipped": len(dup_i) + len(dup_m),
        "output": str(out_dir),
    }
    logger.info("Prepared segmentation dataset: %s", summary)
    return summary


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Copy image/mask pairs into data/segmentation/{images,masks}.")
    parser.add_argument("--images", nargs="+", required=True, help="one or more folders with the photos")
    parser.add_argument("--masks", nargs="+", required=True, help="one or more folders with the masks")
    parser.add_argument("--out", default=str(settings.SEG_DATASET_PATH))
    parser.add_argument("--limit", type=int, default=None,
                        help="copy at most N pairs (useful for a quick first run on a laptop)")
    args = parser.parse_args()
    s = prepare([Path(p) for p in args.images], [Path(p) for p in args.masks], Path(args.out), args.limit)
    print(f"Copied {s['copied_pairs']} image/mask pairs into {s['output']}")
    if s["images_without_mask"] or s["masks_without_image"]:
        print(f"Skipped {s['images_without_mask']} images without a mask and "
              f"{s['masks_without_image']} masks without an image.")


if __name__ == "__main__":
    main()
