# API Documentation

Two HTTP layers exist:

- **Node/Express backend** (default `http://localhost:5000`) -- the public
  API the frontend talks to. Proxies to the ML service, adds upload
  validation and rate limiting.
- **Python FastAPI ML service** (default `http://localhost:8000`) -- owns
  all ML/RAG/LLM logic. Interactive docs available at
  `http://localhost:8000/docs` (FastAPI's built-in Swagger UI) when running.

All endpoints below are described at the **backend** path (`/api/...`).

> **v2 service boundary.** The ML service is internal-only: every `/api/*`
> request to it must carry `X-Internal-Token: <ML_INTERNAL_TOKEN>`, which only
> the backend sends. Browsers and other clients get `401`. `GET /healthz` (no
> data) is the only unauthenticated ML route, for container liveness probes.

## v2 access tiers

| Tier | Prefix | Auth | Limits |
|---|---|---|---|
| Guest / Farmer Mode | `/api/farmer/*` | none | `FARMER_PREDICT_RATE_LIMIT_PER_MIN` (6) photos/min/IP, `FARMER_RATE_LIMIT_PER_MIN` (60) req/min/IP, `FARMER_MAX_IMAGE_SIZE_MB` (4 MB); photo never stored; no personal data |
| Auth | `/api/auth/*` | – / cookie / Bearer | `AUTH_RATE_LIMIT_MAX` (20) per 15 min per IP |
| Account Mode | `/api/predict`, `/api/v2/*` | `Authorization: Bearer <access token>` | `PREDICT_RATE_LIMIT_PER_MIN` (20) |

## Authentication (JWT)

Access tokens are HS256 JWTs (`ACCESS_TOKEN_TTL_SECONDS`, default 15 min),
sent as `Authorization: Bearer ...`. Refresh tokens are random 48-byte values
stored **hashed** in `refresh_tokens`, delivered only as an `httpOnly`,
`Secure`, `SameSite=Strict` cookie (`agrisight_rt`, path `/api/auth`), and
rotated on every use. Presenting an already-rotated refresh token is treated
as theft: the whole token family is revoked.

| Route | Body | Success | Notes |
|---|---|---|---|
| `POST /api/auth/register` | `{email, password (10–72 chars), preferred_language?}` | `202 {status:"accepted", detail}` | Identical response whether or not the email exists; role is always `user`. |
| `POST /api/auth/login` | `{email, password}` | `200 {access_token, token_type, expires_in, user}` + refresh cookie | Any failure → `401 {"error":"invalid_credentials"}`. After `AUTH_MAX_FAILED_LOGINS` failures the account is locked for `AUTH_LOCKOUT_MINUTES` (same generic 401). |
| `POST /api/auth/refresh` | – (cookie) | `200` same shape as login + new cookie | `401 invalid_refresh` for unknown/expired/reused tokens. |
| `POST /api/auth/logout` | – (cookie) | `204` | Revokes the token family and clears the cookie. |
| `GET /api/auth/me` | – | `200 {user}` | `401 token_expired` tells the client to refresh. |
| `PATCH /api/auth/me` | `{preferred_language?, store_location_opt_in?}` | `200 {user}` | Opting out of location storage also erases stored plot coordinates. |
| `DELETE /api/auth/me` | – | `204` | Real deletion: user, tokens, plots, scans, follow-ups and stored images. |

Roles: `user` (default), `expert`, `admin`. Demo accounts for each role:
`cd backend && npm run seed` (dev only).

## POST /api/farmer/predict (guest)

Same request and response as `POST /api/predict` below, but no login.
Optional form field `language` (`en`, `hi`, ...). The image is forwarded to
the ML service and never written to disk; an anonymous scan row (no image,
no IP, no location, `user_id = NULL`, `mode = "farmer"`) is recorded for
monitoring only. The file's magic bytes must match its declared type.

## POST /api/predict

Diagnose a plant disease from a leaf image.

**v2: requires `Authorization: Bearer <access token>`** (Account Mode). The
request/response contract is otherwise unchanged; v2 only *adds* fields
(`scan_id`, `plot_id`, and the fields documented in later sections).
Unauthenticated callers get `401` and should use `POST /api/farmer/predict`.
The scan is saved to the user's plot (`plot_id` form field, or the default
plot "My field"), and the image is stored with all EXIF/GPS metadata removed.

**Request**: `multipart/form-data` with field `file` (JPEG, PNG, or
WebP, max size per `MAX_IMAGE_SIZE_MB`, default 8MB), optional `language`,
optional `plot_id`.

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
| `401` | Missing/expired access token (v2) |
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
