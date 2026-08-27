# Model

## Backbone

Default: **MobileNetV2** (via `torchvision.models.mobilenet_v2`), chosen over
EfficientNet-B0 as the default because it's lighter, trains faster on modest
hardware, and is a reliable, well-understood baseline for a project on this
timeline. EfficientNet-B0 is available as a drop-in alternative:

```bash
python -m app.training.train --backbone efficientnet_b0
```

Both are loaded via `app/training/model_factory.py::build_model()`.

## Transfer learning approach

Training happens in two phases, matching standard transfer-learning
practice:

1. **Head training**: the backbone's convolutional feature extractor is
   frozen (`freeze_backbone=True`); only a new linear classification head is
   trained. This adapts the model to the new class set quickly without
   disturbing the pretrained ImageNet features.
2. **Fine-tuning**: the last 20 layers of the feature extractor are
   unfrozen (`unfreeze_last_n_layers`) and trained at a 10x lower learning
   rate, letting the model adapt higher-level visual features specifically
   to plant disease imagery.

Both phases use early stopping on validation loss
(`EARLY_STOPPING_PATIENCE`, default 4 epochs without improvement) and keep
the best checkpoint (lowest validation loss), not simply the last epoch.

## Data pipeline

- **Resizing**: all images resized to `IMAGE_SIZE` (default 224x224).
- **Normalization**: standard ImageNet mean/std, matching the pretrained
  backbone's expected input distribution.
- **Augmentation** (train split only): random horizontal flip, random
  rotation (±15°), color jitter (brightness/contrast/saturation).
- **Split**: train/validation/test via `VAL_SPLIT` / `TEST_SPLIT` (defaults
  0.15 / 0.15, remainder for training), using a fixed random seed for
  reproducibility.

See `app/training/dataset.py`.

## Metrics

After training, `app/training/evaluate.py` computes on the **held-out test
split** (never seen during training or early-stopping decisions):

- Accuracy
- Precision, recall, F1 (weighted average across classes)
- Per-class precision/recall/F1/support
- Full confusion matrix

These are written to `models/evaluation_report.json` and served via
`GET /api/evaluation-report`. **Numbers are never fabricated or adjusted** --
whatever a given training run produces is what gets reported. If you rerun
training on a different machine, a different dataset split, or a different
epoch budget, the report will reflect that run's actual results.

To re-evaluate an existing checkpoint without retraining (e.g. after
collecting a small manually-labeled real-world test set):

```bash
python -m app.training.run_evaluation
```

## Model artifacts

| File | Contents |
|---|---|
| `plant_disease_model.pt` | PyTorch `state_dict` of the trained model |
| `model_config.json` | `backbone`, `num_classes`, `image_size`, `model_version`, `trained_at` |
| `class_names.json` | Ordered class names (index-aligned with model output) |
| `training_metrics.json` | Per-epoch loss/accuracy for both training phases |
| `evaluation_report.json` | Test-set accuracy/precision/recall/F1/confusion matrix/per-class metrics |

The inference service (`app/inference/service.py`) loads these at startup
and **never retrains or fabricates a prediction** if they're missing --
`GET /api/model-status` and `POST /api/predict` both return a clear,
actionable error explaining that training needs to be run first.

## Confidence-aware diagnosis

See `app/inference/confidence.py`. The top-1 softmax probability is compared
against two configurable thresholds (`HIGH_CONFIDENCE_THRESHOLD`,
`LOW_CONFIDENCE_THRESHOLD`):

- **≥ HIGH_CONFIDENCE_THRESHOLD** → "high confidence"
- **between the two thresholds** → "low confidence"; if a second class is
  within `DIFFERENTIAL_MIN_SHARE` of the top prediction, the message names
  the specific ambiguity (e.g. "cannot reliably distinguish between Late
  Blight and Early Blight")
- **< LOW_CONFIDENCE_THRESHOLD** → "unreliable"; the pipeline stops before
  RAG/LLM and asks for a clearer photo

## Differential diagnosis

Up to `MAX_DIFFERENTIAL_ALTERNATIVES` (default 2) alternative classes are
shown, filtered to only those with probability ≥ `DIFFERENTIAL_MIN_SHARE`
(default 0.10) -- so a long tail of near-zero classes never floods the UI.

## Grad-CAM

`app/inference/gradcam.py` implements standard Grad-CAM: it hooks the last
convolutional block (`get_target_layer`), backpropagates the target class's
score, global-average-pools the gradients into per-channel weights, and
produces a weighted combination of activation maps, ReLU'd and normalized to
[0, 1]. This is resized to the input resolution and overlaid on the original
image with a red-hot colormap.

**Grad-CAM shows correlation between image regions and the model's output,
not proof that the prediction is correct.** The UI and LLM prompt both state
this explicitly.

## Known limitation: PlantVillage is lab-style data

PlantVillage images are captured under controlled conditions (uniform
background, consistent lighting, single leaf per image). **Real-world field
photos differ substantially**: cluttered backgrounds, variable lighting,
multiple leaves/overlapping foliage, dust, motion blur, and phone-camera
artifacts. The model's real-world accuracy on field photos is very likely
lower than its PlantVillage test-set accuracy.

This is disclosed to the user directly in every response
(`dataset_disclaimer` field in the API response, shown in the UI footer of
every diagnosis card) rather than only in this document.

A natural next step (listed as future work, not required for the MVP) is
collecting a small, manually-labeled real-world field test set and
re-evaluating with `run_evaluation.py` against it.
