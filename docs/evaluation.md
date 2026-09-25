# Evaluation

Three layers are evaluated separately, matching the system's actual
architecture: the classifier, the retrieval pipeline, and the end-to-end
experience.

## 1. Computer vision evaluation

Produced automatically by `python -m app.training.train` (and re-runnable
without retraining via `python -m app.training.run_evaluation`), saved to
`models/evaluation_report.json`:

- Accuracy
- Precision, recall, F1 (weighted)
- Per-class precision/recall/F1/support
- Full confusion matrix

These are computed on a **held-out test split** never used for training or
early-stopping decisions (`app/training/evaluate.py`). View them via
`GET /api/evaluation-report`, or feed them directly into Power BI (see
below).

**Report real numbers.** If test accuracy is 78%, report 78%. Do not adjust
thresholds or cherry-pick a checkpoint to inflate the number reported here.

## 2. RAG evaluation

Unlike CV metrics, retrieval quality doesn't have an automatic ground truth
without a labeled set. Build a small **manually-verified evaluation set** of
~20 test diagnoses, e.g.:

| # | Query (crop + disease) | Retrieved source | Relevant? (Y/N) | Citation correct? (Y/N) | Grounded? (Y/N) |
|---|---|---|---|---|---|
| 1 | Tomato / Late Blight | Tomato Late Blight Guide, p.1 | Y | Y | Y |
| 2 | Tomato / Early Blight | Tomato Early Blight Guide, p.1 | Y | Y | Y |
| 3 | Potato / healthy | *(no evidence found)* | N/A | N/A | N/A -- correctly reports insufficient evidence |
| ... | | | | | |

Definitions:
- **Relevant**: does the retrieved chunk actually discuss the diagnosed
  crop/disease?
- **Citation correct**: does the title/organization/page shown to the user
  match the actual source document?
- **Grounded**: does the LLM's generated explanation only state things that
  appear in the retrieved evidence (no invented facts, no invented
  treatments)?

A template for this table is a good thing to fill in as you add real
knowledge base documents -- the two sample PDFs shipped in
`knowledge_base/documents/` are illustrative placeholders, not a real
knowledge base, and should be replaced with real extension/FAO/ICAR sources
before drawing conclusions from this evaluation.

### Suggested process

1. Pick ~20 (crop, disease) pairs the trained model can predict.
2. For each, call `POST /api/predict` with a representative image (or call
   `retrieve_evidence()` directly with the crop/disease/confidence to
   isolate retrieval from classification).
3. Manually inspect the returned `sources` and `explanation` fields against
   the three criteria above.
4. Compute simple aggregate rates: % relevant, % citation-correct,
   % grounded, and the rate at which `insufficient_evidence` was correctly
   triggered (versus incorrectly triggered when evidence did exist, or
   incorrectly *not* triggered when it should have been).

## 3. End-to-end evaluation

Beyond the two component-level evaluations above, assess the full pipeline
holistically:

- **Diagnosis correctness**: does the top prediction match the actual
  disease for a set of known-label test images?
- **Confidence calibration/behavior**: for genuinely ambiguous images (e.g.
  two visually similar diseases), does the system correctly drop into the
  "low confidence" tier rather than confidently picking one? For clearly
  wrong/unusable images, does it correctly reach "unreliable"?
- **Recommendation grounding**: cross-check with the RAG evaluation table
  above -- do explanations only state retrieved facts?
- **Unsupported-claim rate**: manually flag any generated explanation that
  makes a claim not traceable to a retrieved source (this should be zero,
  or explicitly caught by the `insufficient_evidence` path).

## Power BI / analytics data

`GET /api/analytics/export.csv` (or `/api/analytics/history` for JSON)
exposes logged predictions with: timestamp, crop, predicted disease,
confidence, confidence level, model version, retrieval status -- no personal
data.

Combine this with `models/evaluation_report.json` (imported as a second
table, or flattened manually) to build a Power BI dashboard covering:

- Dataset class distribution (`evaluation_report.json` → `per_class_metrics`
  → `support` per class)
- Disease prediction distribution over time (`predicted_disease` counts from
  the CSV export)
- Model accuracy / precision / recall / F1 (`evaluation_report.json`
  top-level fields)
- Confusion matrix (`evaluation_report.json` → `confusion_matrix`, paired
  with `class_names` for axis labels)
- Per-class performance (`per_class_metrics`)
- Prediction confidence distribution (`confidence` column from the CSV
  export, histogram)
- Prediction counts over time (`timestamp` column, grouped by day/week)

This is intentionally a **data export**, not a hosted real-time dashboard --
per the brief's explicit instruction to keep Power BI scope limited and
avoid building unnecessary real-time infrastructure for a college project.

## Known limitation carried into evaluation

Because the classifier is trained and evaluated on PlantVillage (lab-style
images), the CV evaluation numbers above describe performance **on that
distribution**, not necessarily on real farm photographs. If you collect a
small real-world field test set, re-run
`python -m app.training.run_evaluation --dataset-path <field_test_set_path>`
and report both numbers side by side rather than only the PlantVillage
figure.

## 4. Calibration and "I don't know" (v2, Step 5)

### Status: mechanism built and unit-tested — **no real numbers yet**

The fitting script needs the trained model *and* the PlantVillage
validation/test images, which live only on the developer's machine. It was
**not run during the v2 build**, so this section deliberately contains no
ECE, no reliability diagram and no OOD rates. Run it and paste the printed
results here:

```bash
cd ml-service
python -m app.calibration.fit                       # full val (8,145) + test (8,145) splits
python -m app.calibration.fit --max-samples 3000    # quicker; the report states n
python -m app.calibration.fit --junk-dir ../data/ood_junk   # add real junk photos (recommended)
```

What it does (all from real runs, nothing estimated):

1. Re-creates the exact train/val/test split used by training
   (`VAL_SPLIT`, `TEST_SPLIT`, seed 42). The build verified that this
   reconstruction reproduces the per-class test supports recorded in
   `models/evaluation_report.json` exactly (38/38 classes match, 8,145 test
   images) — only the file list was used for that check, no images.
2. **Temperature scaling**: fits one scalar `T` on the validation logits by
   minimising NLL (grid + golden-section search), then reports NLL and
   **Expected Calibration Error (15 bins)** on the *test* split before and
   after, the share and accuracy of each confidence tier (`high/low/unreliable`
   with the configured thresholds, on calibrated probabilities), and draws
   `docs/figures/reliability_test.png`.
3. **OOD thresholds** (fitted on validation, in-distribution only):
   - leaf-colour ratio threshold accepting 99% of validation leaves → `not_a_leaf`;
   - energy-score threshold accepting 95% of validation leaves → `unsupported_crop`.
   Reports the test **false-reject rate** (real leaves wrongly rejected, by
   reason) and the **false-accept rate** on each junk set.
4. Writes `temperature`, `ood` and `calibration` into `models/model_config.json`
   (original kept as `model_config.pre_calibration.json`) and the full report to
   `models/calibration_report.json`. The ML service applies them on the next start.

Known limits, to state in any report:

- The junk set shipped with the script is **synthetic** (noise, flat colours,
  gradients, shapes, skin-like and soil-like textures) and is labelled
  "weak proxy" in the output. Real false-accept rates need real photos of hands,
  soil, walls, other crops and other plants (`HUMAN_TODO.md`).
- `unsupported_crop` means "outside the fitted in-distribution range" — it can
  also fire for a supported crop photographed very differently from PlantVillage.
- Because PlantVillage validation/test images are lab-style, thresholds fitted on
  them may reject many real field photos. Measure on field photos before relying on it.

| Metric (test split) | Before | After | Source |
|---|---|---|---|
| NLL | _not run_ | _not run_ | `models/calibration_report.json` |
| ECE (15 bins) | _not run_ | _not run_ | 〃 |
| False-reject rate (OOD gates, real leaves) | – | _not run_ | 〃 |
| False-accept rate, synthetic junk | – | _not run_ | 〃 |
| False-accept rate, real junk | – | _not collected_ | needs `--junk-dir` |

## 5. Citation faithfulness (v2, Step 5)

Each sentence in the evidence sections of the LLM explanation is checked
against the retrieved chunks with an NLI cross-encoder
(`FAITHFULNESS_MODEL`, default `cross-encoder/nli-deberta-v3-small`).
Unsupported sentences are removed (default) or flagged, and each response
reports `faithfulness.unsupported_rate`. Aggregate over a set of real
responses with:

```bash
python -m app.faithfulness.evaluate --input ../data/faithfulness_samples.jsonl
```

**Unsupported-claim rate: not measured yet** (needs Ollama + the NLI model +
real knowledge-base documents; none were available in the build environment).
NLI models make mistakes too — treat the rate as an indicator, and keep the
manual RAG evaluation in section 2.

## 6. Symptom questions

The Bayesian update is unit-tested for correctness of the arithmetic only.
Whether the questions actually improve accuracy is **not measured**: that
needs expert-labelled field cases where farmers answered the questions
(see `reviewed_labels`, Step 6).

## 7. Robustness suite (v2, Step 7)

```bash
cd ml-service
python -m app.evaluation.robustness --max-samples 1000
```

Reports, for blur (r = 1/2/4), low light (×0.5/×0.3), JPEG (q30/q10),
rotation (15°/45°/90°), central occlusion (25%/50%) and synthetic junk:
accuracy, mean top-1 probability, confidence-tier shares and (if fitted) the
OOD rejection share. **Not run during the build** (needs the local dataset);
no robustness numbers are claimed.

## 8. Offline model (v2, Step 8)

Measured during the build with the real trained checkpoint (`models/plant_disease_model.pt`):

| Check | Result |
|---|---|
| PyTorch vs ONNX fp32, max abs logit difference (4 random inputs) | 7.6 × 10⁻⁶ (numerical parity) |
| File size fp32 / int8 (dynamic quantisation) | 9.06 MB / 2.46 MB |
| Both files load and run in onnxruntime-web 1.30 (WASM, Node) | yes |
| **Accuracy fp32 vs int8 on the test split** | **not measured** — run `python -m app.export.onnx_export --compare-on-test 2000` |

Until the int8 accuracy is measured and shown to be close to fp32, the app
uses the fp32 model offline and keeps online (server) analysis as the default.
