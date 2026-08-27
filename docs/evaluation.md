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
