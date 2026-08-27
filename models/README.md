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

Generate them with:

```bash
cd ml-service
python -m app.training.train
```

The ML service (`ml-service/app/inference/service.py`) checks for these
files on startup and returns a clear, actionable error via the
`/api/model-status` endpoint if they are missing -- it does not fall back to
a fake or mock prediction.
