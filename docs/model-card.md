# Model card — AgriSight plant disease classifier

## Model

| | |
|---|---|
| Architecture | MobileNetV2 (ImageNet-pretrained), new 38-way linear head; head training then fine-tuning of the last feature blocks |
| Input | RGB 224×224, ImageNet normalisation |
| Output | 38 PlantVillage classes (14 crops, 26 diseases + healthy classes) |
| Version | `1.0.0` (`models/model_config.json`, trained 2026-08-27 on CPU) |
| Training history (from `models/training_metrics.json`) | 1 head epoch + 1 fine-tuning epoch recorded (early stopping) |
| Calibration | Temperature scaling — **mechanism ready, not yet fitted** (`python -m app.calibration.fit`) |
| OOD gate | leaf-colour ratio + energy score — **thresholds not yet fitted** |

## Data

PlantVillage (Kaggle mirror), 54,305 images, 38 class folders, split
70/15/15 (train/val/test) with seed 42. Lab-style photos: single detached
leaves, plain backgrounds, controlled light. Class sizes range from 152
(`Potato___healthy`) to 5,507 (`Orange___Haunglongbing_(Citrus_greening)`); see
`models/training_metrics.json → dataset_report.per_class_counts`.

## Metrics (real run, `models/evaluation_report.json`, test split n = 8,145)

| Metric | Value |
|---|---|
| Accuracy | 0.9849 |
| Weighted precision | 0.9851 |
| Weighted recall | 0.9849 |
| Weighted F1 | 0.9849 |

Per-class precision/recall/F1 and the confusion matrix are in the same file.
The v2 build verified that the test split can be reconstructed exactly
(per-class supports match the report for all 38 classes).

**Not measured yet:** calibration error (ECE), OOD false-accept /
false-reject rates, robustness under blur/low light/compression/rotation/
occlusion (`python -m app.evaluation.robustness`), accuracy on real field
photos, accuracy against expert labels. None of these are claimed.

## Intended use

Decision *support* for identifying likely leaf diseases of the 14 PlantVillage
crops, with the confidence tiers, OOD gate and evidence-grounded explanation.
Always paired with "confirm at the agriculture office".

## Not intended for

- Crops or diseases outside the 38 classes (the model will still output one of
  them — the OOD gate is the mitigation once fitted).
- Whole-plant, fruit, stem, root or field-scale photos.
- Deciding pesticide purchases or doses.

## Known failure modes and risks

1. **Lab-to-field gap.** PlantVillage accuracy (98.5%) should not be expected on
   cluttered field photos (different backgrounds, light, several leaves,
   camera quality). Field accuracy is unmeasured; expect it to be lower.
2. **Spurious features.** A Grad-CAM audit found at least one heat map on a
   background artifact (shadow/mesh) rather than leaf tissue. Grad-CAM shows
   correlation, not correctness.
3. **Overconfidence.** Un-calibrated softmax probabilities of fine-tuned CNNs
   are typically overconfident; fit temperature scaling before relying on the
   tiers.
4. **Similar-looking diseases** (e.g. early vs late blight) — symptom questions
   help only where cited question sets exist.
5. **Healthy classes** are only "healthy relative to the diseases in the
   dataset", not a general plant-health certificate.

## Ethical considerations

Wrong advice can cost a harvest or lead to unnecessary chemical use. The
system therefore refuses to name a disease when unreliable, never recommends
products or doses that are not in cited documents, points to agriculture
offices, and keeps a dataset disclaimer on every response.
