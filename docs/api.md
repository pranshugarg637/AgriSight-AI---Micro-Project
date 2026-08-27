# API Documentation

Two HTTP layers exist:

- **Node/Express backend** (default `http://localhost:5000`) -- the public
  API the frontend talks to. Proxies to the ML service, adds upload
  validation and rate limiting.
- **Python FastAPI ML service** (default `http://localhost:8000`) -- owns
  all ML/RAG/LLM logic. Interactive docs available at
  `http://localhost:8000/docs` (FastAPI's built-in Swagger UI) when running.

All endpoints below are described at the **backend** path (`/api/...`); the
ML service exposes the same paths directly, which the backend proxies
transparently.

## POST /api/predict

Diagnose a plant disease from a leaf image.

**Request**: `multipart/form-data` with a single field `file` (JPEG, PNG, or
WebP, max size per `MAX_IMAGE_SIZE_MB`, default 8MB).

**Response** (`200 OK`):

```json
{
  "diagnosis": "Late Blight",
  "crop": "Tomato",
  "confidence": 0.91,
  "confidence_level": "high",
  "is_reliable": true,
  "confidence_message": "High-confidence prediction.",
  "alternatives": [
    { "crop": "Tomato", "disease": "Early Blight", "confidence": 0.06 }
  ],
  "gradcam_image_base64": "<base64 PNG>",
  "gradcam_note": "Highlighted regions indicate areas that influenced the model's prediction.",
  "explanation": "## What is happening?\n...",
  "sources": [
    {
      "title": "Tomato Late Blight Guide",
      "organization": "Sample Extension",
      "page": 1,
      "source_url": null,
      "relevance_score": 0.83,
      "excerpt": "Late blight spreads rapidly in cool, wet weather..."
    }
  ],
  "retrieval_status": "success",
  "model_version": "1.0.0",
  "dataset_disclaimer": "This model is trained and evaluated primarily on the PlantVillage dataset..."
}
```

`retrieval_status` is one of: `success`, `insufficient_evidence`,
`knowledge_base_empty`, `skipped_low_confidence` (set when
`confidence_level` is `unreliable` and RAG/LLM are skipped entirely).

**Error responses:**

| Status | Meaning |
|---|---|
| `400` | No file provided |
| `422` | Invalid/unusable image (wrong type, too small, too blurry, corrupt) |
| `422` | Unsupported file type (caught by backend before reaching the ML service) |
| `503` | Model not trained/loaded yet |
| `503` | ML service unreachable from the backend |
| `500` | Unexpected internal error (never includes a raw stack trace) |

## GET /api/health

Aggregated health check.

```json
{
  "backend": "ok",
  "ml_service": {
    "status": "ok",
    "model_loaded": true,
    "knowledge_base_ready": true,
    "llm_reachable": true
  }
}
```

## GET /api/model-status

```json
{
  "model_loaded": true,
  "error": null,
  "backbone": "mobilenet_v2",
  "num_classes": 15,
  "model_version": "1.0.0"
}
```

## GET /api/knowledge-base-status

```json
{ "ready": true, "num_chunks": 214 }
```

## GET /api/analytics/history?limit=500

Returns logged predictions (no personal data -- see `docs/evaluation.md` /
Section 22 of the brief) for the analytics dashboard.

```json
{
  "predictions": [
    {
      "timestamp": "2026-08-26T10:15:00",
      "crop": "Tomato",
      "predicted_disease": "Late Blight",
      "confidence": 0.91,
      "confidence_level": "high",
      "top_alternatives": [{ "disease": "Early Blight", "confidence": 0.06 }],
      "model_version": "1.0.0",
      "retrieval_status": "success"
    }
  ],
  "count": 1
}
```

## GET /api/analytics/export.csv

Same data as above, flattened to CSV for direct Power BI ingestion (see
`docs/evaluation.md`).

## GET /api/evaluation-report

Returns the saved `models/evaluation_report.json` (accuracy, precision,
recall, F1, confusion matrix, per-class metrics). `404` if the model hasn't
been trained yet.

## GET /api/training-metrics

Returns the saved `models/training_metrics.json` (per-epoch history for both
training phases). `404` if the model hasn't been trained yet.

## Error format

All errors follow the same shape:

```json
{ "error": "short_machine_readable_code", "detail": "Human-readable explanation." }
```

Raw stack traces are never returned to the client; full details are logged
server-side only (Node: `console.error`; Python: `logger.exception`).
