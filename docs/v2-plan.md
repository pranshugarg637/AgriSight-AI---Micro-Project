# AgriSight AI v2 — Build Plan

Status: executed in one continuous run (Steps 0–8). This file is the plan that
was written *before* implementation; the final state of each step is recorded
in the step's commit and in `docs/HUMAN_TODO.md`.

## 1. Current architecture (v1, audited)

```
React 19 + Vite (single page: upload → DiagnosisCard)
   │  POST /api/predict (multipart "file")
   ▼
Node/Express gateway  (backend/src)
   - multer memory upload, MIME allow-list, 20 req/min rate limit on /api/predict
   - proxies status/analytics routes to the ML service, no DB, no auth
   ▼  (plain HTTP, no auth — any client that can reach :8000 can call it)
FastAPI ML service  (ml-service/app)
   - image_validation → CNN (MobileNetV2, 38 PlantVillage classes)
   - confidence tiers high / low / unreliable (thresholds from env)
   - Grad-CAM overlay (base64 PNG)
   - RAG: Chroma + all-MiniLM-L6-v2, RAG_MIN_RELEVANCE_SCORE gate →
     success / insufficient_evidence / knowledge_base_empty
   - Ollama llama3.2 grounded explanation (never falls back to own knowledge)
   - JSONL prediction log (no personal data)
```

Audit findings that shape v2:

| Finding | Consequence |
|---|---|
| `.env.example` referenced by README/setup but **missing** from the repo | Recreate it (Step 1) with every old + new variable. |
| ML-service tests assumed `models/` is empty; they fail on any machine that has trained the model | Make the test suite hermetic (point `MODEL_PATH`, `VECTOR_DB_PATH`, `PREDICTIONS_LOG_PATH` at temp paths in `conftest.py`). |
| Knowledge base = 2 PDFs explicitly labelled "Sample Agricultural Extension (Placeholder Source)" | Everything that needs agricultural facts (audio safe steps, symptom questions, risk rules) can only be *demo* content derived from these placeholders, flagged `source_is_placeholder: true` and refused when `ENV=production`. Real content is `TODO_HUMAN`. |
| Fake 600 ms stage timer in `App.jsx` | Replaced by Server-Sent Events in Step 7. |
| No DB, no auth, ML service reachable by anyone | Step 1. |

## 2. Target architecture (v2)

```
                    ┌──────────── Farmer Mode (no login) ───────────┐
Browser (PWA) ──────┤ camera → auto-capture → spoken result (audio  │
                    │ clips) → help finder → shopkeeper card         │
                    └──────────── Account Mode (JWT) ───────────────┘
        │  /api/farmer/*  (guest, strict per-IP limits, image not stored)
        │  /api/auth/*    (register/login/refresh/logout/me)
        │  /api/predict, /api/v2/*  (Bearer access token)
        ▼
Node/Express gateway: auth, roles, validation (zod), rate limits, helmet,
   DB (Knex; SQLite dev / Postgres compose), image store (EXIF stripped),
   shop provider (Overpass), help-centre loader, weather (Open-Meteo),
   risk engine (cited JSON rules), audio clip serving, SSE relay
        │  X-Internal-Token (shared secret), internal network only
        ▼
FastAPI ML service: validation → calibrated CNN (temperature scaling) → OOD
   gate → Grad-CAM → hybrid retrieval (BM25 + embeddings, optional re-rank) →
   grounded LLM → NLI faithfulness check → translation (IndicTrans2/Bhashini,
   swappable) ; symptom-question Bayesian refine ; SSE stage events
```

## 3. Files per step

| Step | Add | Modify |
|---|---|---|
| 1 | `backend/src/db/*` (knex, migrations, seed), `backend/src/auth/*`, `backend/src/middleware/{auth,validate,rateLimits}.js`, `backend/src/routes/{auth,farmer}.js`, `backend/src/services/mlClient.js`, `ml-service/app/security.py`, `.env.example`, `frontend/src/auth/*`, `frontend/src/pages/{Landing,Login,Register}.jsx`, router | `backend/src/app.js`, `config`, `routes/predict.js`, `ml-service/app/main.py`, `tests/ml-service/conftest.py`, `test_api.py` (internal header) |
| 2 | `frontend/src/i18n/*`, `locales/{en,hi}.json`, `ml-service/app/translation/*`, `scripts/translation_drift_check.py` | all components (strings → `t()`), `schemas/prediction.py`, `api/predict.py` |
| 3 | `frontend/src/farmer/*` (camera, frame quality, capture machine, speech player, safety gating, shopkeeper card), `audio_scripts/{en,hi}/*.json`, `scripts/generate_audio.py`, `backend/src/routes/farmer.js` (audio) | predict response gets `class_key`, `top_candidates` |
| 4 | `backend/src/services/shops/*`, `backend/src/services/helpCenters.js`, `data/help_centers/_schema.json`, farmer help UI | `routes/farmer.js` |
| 5 | `ml-service/app/calibration/*`, `app/inference/ood.py`, `app/symptoms/*`, `app/rag/{hybrid,metadata,coverage}.py`, `app/faithfulness/*`, `knowledge_base/questions/*.json` | `inference/service.py`, `rag/retrieval.py`, `rag/ingest.py` |
| 6 | migrations (plots/actions/followups/expert/reviewed_labels/image store), `routes/{plots,scans,expert}.js`, `services/{imageStore,exif,followup,riskEngine,weather}.js`, `knowledge_base/risk_rules/*.json`, account pages | `routes/predict.js` (attach to plot) |
| 7 | `/predict/stream` (SSE) on both services, `routes/admin.js`, `scripts/robustness_suite.py`, `docs/{privacy,model-card}.md` | `App.jsx` fake timer removed, helmet/CORS/magic bytes |
| 8 | `frontend/public/{sw.js,manifest.webmanifest}`, `ml-service/app/export/onnx_export.py`, `frontend/src/offline/*` | farmer flow offline branch |

## 4. DB schema (Knex migrations; SQLite dev, Postgres in Compose)

- `users(id, email UNIQUE, password_hash, role CHECK user|expert|admin, preferred_language, failed_login_attempts, locked_until, store_location_opt_in, created_at, updated_at)`
- `refresh_tokens(id, user_id FK, token_hash UNIQUE, family_id, expires_at, revoked_at, replaced_by, created_at)`
- `plots(id, user_id FK, name, crop, sowing_date, location_label, lat, lng [only if opted in], created_at)`
- `scans(id, user_id NULL FK, plot_id NULL FK, mode farmer|account, image_ref NULL, diagnosis, crop, class_key, confidence, confidence_level, unreliable_reason, alternatives JSON, retrieval_status, sources JSON, model_version, language, disputed, created_at)`
- `actions(id, scan_id FK, user_id FK, action_type, note, remind_at, created_at)`
- `followups(id, previous_scan_id FK, new_scan_id FK, user_id FK, outcome improved|same|worse, basis JSON, created_at)`
- `expert_reviews(id, scan_id FK, expert_id FK, decision confirm|correct, corrected_class_key, note, created_at)`
- `reviewed_labels(id, scan_id FK UNIQUE, class_key, source expert, created_at)` — evaluation / future retraining only.

JSON columns are stored as TEXT (portable) and (de)serialised in the repository layer.

## 5. API surface (new)

| Route | Auth | Notes |
|---|---|---|
| `POST /api/auth/register` | – | always `202`, never reveals whether the email exists |
| `POST /api/auth/login` | – | generic 401, lockout after N failures, rate-limited |
| `POST /api/auth/refresh` | cookie | rotates; reuse of a rotated token revokes the whole family |
| `POST /api/auth/logout` | cookie | revokes family, clears cookie |
| `GET /api/auth/me` | Bearer | |
| `PATCH /api/auth/me` | Bearer | preferred language, location opt-in |
| `DELETE /api/auth/me` | Bearer | real deletion of account + scans + images |
| `POST /api/farmer/predict[/stream]` | – | per-IP limit, small cap, image not stored |
| `GET /api/farmer/audio/:key`, `GET /api/farmer/audio-script/:lang/:slug` | – | clips + script text (fallback) |
| `GET /api/farmer/shops`, `GET /api/farmer/help-centers` | – | provider-backed / curated file |
| `GET /api/farmer/questions`, `POST /api/farmer/refine` | – | symptom questions |
| `POST /api/predict[/stream]` | Bearer | **existing contract, now authenticated**; response body unchanged (additive fields only) |
| `/api/v2/plots`, `/api/v2/scans`, `/api/v2/scans/:id/actions`, `/api/v2/followups`, `/api/v2/risk`, `/api/v2/refine` | Bearer | account features |
| `/api/v2/expert/*` | expert/admin | review queue |
| `/api/v2/admin/metrics` | admin | monitoring |

## 6. Risks

| Risk | Mitigation |
|---|---|
| No real agricultural documents | Build tooling + coverage report; placeholder-derived demo content refused in production; `HUMAN_TODO.md`. |
| Hindi text not reviewed by a native speaker | Every script has `reviewed_by_native_speaker: false`; dev-only warning banner; listed in `HUMAN_TODO.md`. |
| No network to Hugging Face / Overpass / Open-Meteo in the build environment | Providers behind interfaces, fully mocked in tests; real calls documented but **not verified** in this run. |
| Calibration/OOD need the real validation data (on the developer's Windows machine) | Fit scripts are runnable locally; numbers only reported from runs actually executed. |
| Native modules on Windows (`better-sqlite3`) | Uses prebuilt binaries; fallback documented in `setup.md`. |
| Making `/api/predict` authenticated breaks unauthenticated callers | Documented breaking change; guests use `/api/farmer/predict`. |
