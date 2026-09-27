# Lesion segmentation + Dice / IoU (optional add-on)

AgriSight's main model is a **classifier**: it looks at the whole photo and
names one disease. This add-on is a second, separate model that does
**segmentation**: it paints every pixel it thinks is diseased. From that
painting we get:

- a red overlay of the diseased spots (shown next to Grad-CAM in the UI)
- an **estimated severity**, the share of the leaf that looks affected
  (mild < 10 %, moderate 10–25 %, severe > 25 %; the cut-offs are set in `.env`)
- a proper **Dice / IoU** evaluation of how well the painting matches an
  expert's painting

The add-on is **off until you train it**. If `models/lesion_seg_model.pt` does
not exist, every response simply says `segmentation_status:
"model_not_available"` and the rest of the app works exactly as before. The
classifier's training, weights, calibration and behaviour are not touched.

## Classification vs. segmentation

| | Classifier (existing) | Segmentation (this add-on) |
|---|---|---|
| Question it answers | *Which* disease is this? | *Where* on the leaf is the disease? |
| Output | one label + confidence | one yes/no per pixel (a mask) |
| Training labels | folder name per image | a hand-drawn mask per image |
| Metrics | accuracy, precision, recall, F1 | **Dice, IoU**, pixel precision/recall, boundary F1 |
| Grad-CAM? | shows where the classifier *looked*; this is not a mask | n/a, it outputs the mask directly |

## Dice and IoU in simple words

An expert paints the diseased spots red (ground truth **B**), and the model
paints what it thinks is diseased (prediction **A**).

```
Dice = 2·|A ∩ B| / (|A| + |B|)  =  2·TP / (2·TP + FP + FN)
IoU  =   |A ∩ B| / |A ∪ B|      =    TP / (TP + FP + FN)
```

- **TP** (true positive): pixels both painted.
- **FP** (false positive): pixels the model painted but the expert didn't (too much paint).
- **FN** (false negative): pixels the expert painted but the model missed (too little paint).

1.0 means a perfect match and 0.0 means no overlap. IoU is stricter and is
always ≤ Dice (Dice = 2·IoU / (1 + IoU)).

**Why not accuracy?** If a lesion covers 3 % of the photo, a model that paints
nothing is still "97 % accurate". Dice ignores the easy background pixels and
only scores the diseased area.

**Empty masks** (a rule we chose, implemented in `app/segmentation/metrics.py`):
if both masks are empty the score is 1.0 (the model correctly found no
lesion); if exactly one is empty the score is 0.0.

**Two ways to average** (both are reported):
- *mean* Dice: the average of each image's Dice. Every photo counts equally,
  so photos with tiny lesions pull it down.
- *micro* Dice: pixels summed over the whole test set, then one Dice. Big
  lesions dominate it.

The report also gives Dice **by lesion size** (small < 5 % of the image, medium
5–20 %, large > 20 %), because small lesions are the hard case, plus pixel
precision/recall and **boundary F1**, which scores how well the lesion edges
line up, allowing 2 px of slack.

## 1. Get a dataset that has masks

PlantVillage (the classifier's dataset) has **no masks**, so it cannot be used
here. Download a dataset with hand-drawn lesion masks. The two below were
checked on 2026-09-27; confirm the licence yourself before using either in
anything public.

| Dataset | What it is | Masks | Licence | Checked from |
|---|---|---|---|---|
| **PlantSeg** (Wei et al.) | Real field ("in-the-wild") photos, 115 diseases across many crops. The *Scientific Data* paper says 7,774 diseased images (70/10/20 split); the GitHub README says "11,400+ images", so the count depends on the version. | Paper: grayscale PNG in an `annotations` folder, one class number per disease (0 = background). Zenodo v3 page: COCO-format JSON. **Check which version you download.** | **Unclear:** Zenodo v3 page says CC BY 4.0, the paper says CC BY-NC 4.0 (non-commercial). Treat it as non-commercial to be safe. | [paper](https://www.nature.com/articles/s41597-025-06513-4), [GitHub](https://github.com/tqwei05/PlantSeg), [Zenodo (paper's DOI)](https://doi.org/10.5281/zenodo.17719108), [Zenodo v3](https://zenodo.org/records/14935094) |
| **Leaf disease segmentation dataset** (Kaggle, `fakhrealam9537`) | Small set of diseased-leaf photos, with original and augmented copies. A re-split copy (`sovitrath`) has 498 train + 90 valid images. | Colour masks: diseased pixels are red `(128, 0, 0)` on black. Folders `orig_data/` and `aug_data/`, each with `train_images`, `train_masks`, `valid_images`, `valid_masks`. | **Not stated** on the pages we could read; check the Kaggle page. | [Kaggle](https://www.kaggle.com/datasets/fakhrealam9537/leaf-disease-segmentation-dataset), [description](https://debuggercafe.com/leaf-disease-segmentation-using-pytorch-deeplabv3/) |

We could not verify the exact current file counts inside each download, or
whether Kaggle mask filenames match their image filenames exactly. The
`prepare` step below tells you how many pairs it matched.

**Both mask styles work.** A single-channel class-number mask becomes
"any disease vs. background", and an RGB mask counts any non-black pixel as
lesion. **Never make masks from Grad-CAM or colour thresholds**; they would
not be ground truth, and the Dice score would be meaningless.

For the Kaggle set, use only `orig_data` for the **test** split. The
augmented copies are variations of the same leaves, so if they land in both
train and test, the test score becomes too optimistic.

## 2. Put the files in place

The trainer expects:

```
data/segmentation/
  images/   leaf_001.jpg, leaf_002.jpg, ...
  masks/    leaf_001.png, leaf_002.png, ...     (same names, mask as PNG)
```

A helper copies (never moves) pairs from the downloaded folders into that
layout, matching image and mask by file name:

```bash
cd ml-service
# PlantSeg (grayscale PNG masks), first 800 pairs for a quick laptop run:
python -m app.segmentation.prepare --images D:/downloads/plantseg/images --masks D:/downloads/plantseg/annotations --limit 800
# Kaggle set, original (non-augmented) images only:
python -m app.segmentation.prepare --images D:/downloads/leafseg/orig_data/train_images D:/downloads/leafseg/orig_data/valid_images --masks D:/downloads/leafseg/orig_data/train_masks D:/downloads/leafseg/orig_data/valid_masks
```

It prints how many pairs it copied and how many files had no partner.

## 3. Train and evaluate

```bash
cd ml-service
python -m app.segmentation.train --dataset-name "PlantSeg (800-image subset)"
```

- Phase 1 trains the U-Net decoder with the MobileNetV2 encoder frozen;
  phase 2 fine-tunes everything at LR/10. Both use early stopping on
  **validation Dice**.
- Split: 70/15/15 with seed 42, from `VAL_SPLIT` / `TEST_SPLIT`.
- CPU is fine: defaults are 256 px and batch 8 (about 8 GB RAM). If you run
  out of memory, add `--batch-size 4` or `--image-size 192`.
- The first run downloads the ImageNet MobileNetV2 weights (about 14 MB).
  `--no-pretrained` skips the download but gives much worse results.
- `--num-workers 0` is the default because it is the safe choice on Windows.

It writes:

| File | Contents |
|---|---|
| `models/lesion_seg_model.pt` | trained weights |
| `models/lesion_seg_config.json` | encoder, image size, threshold, version, dataset name, seed, split sizes |
| `models/seg_training_metrics.json` | per-epoch train loss, val loss, val Dice, val IoU |
| `models/seg_evaluation_report.json` | **test-set** Dice/IoU (mean + micro), precision, recall, boundary F1, Dice distribution, Dice by lesion size, worst 5 images |

Re-run only the evaluation, for example with a different threshold:

```bash
python -m app.segmentation.evaluate --threshold 0.4
```

Then restart the ML service. `GET /api/model-status` should show
`"seg_model_loaded": true`.

## 4. Results

*Fill this in after training, and copy the numbers from
`models/seg_evaluation_report.json`. Do not round up or pick the best of
several runs without saying so.*

| Metric | Value |
|---|---|
| Dataset / subset | |
| Test images | |
| Dice (mean per image) | |
| Dice (micro, all pixels) | |
| IoU (mean per image) | |
| Pixel precision / recall | |
| Boundary F1 (2 px) | |
| Dice: small / medium / large lesions | |

## How severity is computed, and its limits

```
severity % = lesion pixels ÷ estimated leaf pixels × 100
```

- **Lesion pixels** come from the segmentation model (threshold `SEG_THRESHOLD`).
- **Leaf pixels** come from a simple colour rule, not a model: an Otsu
  threshold on HSV saturation. Leaves, including brown and yellow diseased
  parts, are more colourful than grey, white or dark backgrounds. Lesion
  pixels always count as leaf.
- If the leaf estimate covers less than `SEG_MIN_LEAF_FRACTION` (5 %) of the
  photo, no percentage is shown; only the red mask is.

Limits, which the UI also states:
- It is an **estimate**. On busy backgrounds (soil, other leaves, hands) the
  leaf outline can be wrong, which changes the percentage.
- The segmentation model only knows "diseased vs. not". It does not check
  which disease it is; the classifier does that.
- It only runs when the classifier is **highly confident** and the disease
  is **not** a "healthy" class. Otherwise the status is `skipped_unreliable`
  or `skipped_healthy`.
- The model inherits the biases of its training set. A model trained on one
  crop or one camera will do worse on others. Report the dataset name next
  to any number.
- The mild/moderate/severe cut-offs are not agronomic standards. Agree them
  with an expert before advising farmers on them.

## Where it shows up

- API: new optional fields on the predict response (`segmentation_status`,
  `lesion_mask_base64`, `severity_percent`, `severity_band`,
  `segmentation_note`), plus `GET /api/segmentation-report` and
  `GET /api/segmentation-training-metrics`. See `docs/api.md`.
- Account Mode result card: an "Affected area" button next to
  Original / Grad-CAM, with the severity line and note.
- Farmer Mode: one line, "About 18% of the leaf looks affected (moderate)",
  and a "Show affected area" button. It is **not spoken**, because Farmer
  Mode audio uses pre-recorded clips and cannot say arbitrary numbers.
- Admin monitoring page: a "Lesion segmentation (test set)" card, or
  "Not trained yet".
