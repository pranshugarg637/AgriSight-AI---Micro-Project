# models/

This directory holds trained model artifacts. It is empty in version control
(see `.gitignore`) because these files are generated, not authored, and are
too large to sensibly commit to git.

After running the training pipeline (see `docs/setup.md` and
`docs/model.md`), this directory will contain:

| File | Description |
|---|---|
| `plant_disease_model.pt` | Trained PyTorch model weights (state dict) |
| `model_config.json` | Backbone name, image size, number of classes, model version |
| `class_names.json` | Ordered list of class names matching the model's output indices |
| `training_metrics.json` | Per-epoch training/validation loss and accuracy for both training phases |
| `evaluation_report.json` | Final test-set accuracy, precision, recall, F1, confusion matrix, per-class metrics |

Optional lesion-segmentation add-on (only after `python -m app.segmentation.train`,
see `docs/segmentation.md`):

| File | Description |
|---|---|
| `lesion_seg_model.pt` | Trained U-Net weights (state dict) |
| `lesion_seg_config.json` | Encoder, image size, threshold, version, dataset name, seed, split sizes |
| `seg_training_metrics.json` | Per-epoch train/val loss, val Dice, val IoU |
| `seg_evaluation_report.json` | Test-set Dice and IoU (mean + micro), precision, recall, boundary F1, Dice by lesion size |

Generate them with:

```bash
cd ml-service
python -m app.training.train
```

The ML service (`ml-service/app/inference/service.py`) checks for these
files on startup and returns a clear, actionable error via the
`/api/model-status` endpoint if they are missing -- it does not fall back to
a fake or mock prediction.
