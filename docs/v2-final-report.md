# AgriSight AI v2 — final build report

Built 2026-09-25 in one run, one commit per step (`git log --oneline`).

## 1. What was built

| Step | Status | Highlights |
|---|---|---|
| 0 Plan | done | `docs/v2-plan.md`, `docs/ASSUMPTIONS.md` |
| 1 Auth/DB/boundary | done | Knex migrations (SQLite dev, **suite also passes on Postgres 16**), JWT + rotating hashed refresh cookie with reuse detection, lockout, roles, guest `/api/farmer/*`, ML service requires `X-Internal-Token`, landing/login/register UI |
| 2 Multilingual | done | react-i18next (en + hi, auto-discovered locale files), IndicTrans2 / Bhashini / none translation backends, English kept as source of truth and shown beside the translation, drift-check script |
| 3 Farmer Mode | done | guided rear camera with on-device frame checks + auto-capture, gallery fallback, safety-gated spoken results from pre-authored scripts, espeak-ng demo clips, shopkeeper card |
| 4 Help finder | done | Overpass/Google providers, curated office loader (ships empty by design), consent, privacy-safe logs |
| 5 Quality | **mechanism done, not fitted** | temperature scaling + OOD gate + fit script, symptom questions with Bayes update, hybrid retrieval, strict ingestion, coverage report, NLI faithfulness check |
| 6 Account Mode | done | plots/timeline, EXIF-free image store, actions → reminders → follow-ups, cited weather risk indicator, expert review |
| 7 Observability | done | real SSE stage events end to end (fake timer removed), admin monitoring, robustness suite, privacy doc, model card, security tests, dependency audit |
| 8 Offline | done (time-boxed) | PWA + service worker, ONNX export (parity 7.6e-6), onnxruntime-web on-device check with the same gating, IndexedDB queue |

Deliverables: `docker-compose.yml` + 3 Dockerfiles (config validated, **not built**), `.env.example` (recreated — it was missing), all docs listed in the README.

## 2. Tests (final run)

| Suite | Result |
|---|---|
| ml-service (pytest) | 106 passed (was 42) |
| backend (node --test) | 69 passed (was 10); same 69 pass against Postgres |
| frontend (vitest) | 84 passed (was 6); `oxlint` clean; `vite build` OK |

Changed pre-existing tests (and why): ML tests made hermetic (they failed on any machine with a trained model); ML API test client sends the internal token; two backend predict tests authenticate (route is now authenticated by design); the App tests render the Diagnose page (root is now the landing page). Assertions unchanged.

End-to-end smoke with the real model (ML + backend running): farmer JSON + SSE predict, audio, register → login → refresh → plot → predict → action → follow-up via SSE → timeline → image/Grad-CAM → risk (weather offline) → expert queue → metrics → delete scan → delete account — all succeeded. Browser screenshots of landing and Hindi farmer result/shopkeeper card checked.

## 3. Assumptions

See `docs/ASSUMPTIONS.md` (A1–A4 from the brief, B1–B21 decided during the build).

## 4. TODO_HUMAN

See `docs/HUMAN_TODO.md`. Most important: run calibration/OOD fitting (blocking — a random green-noise image currently gets a high-confidence label), add real knowledge-base documents, native-speaker review of all Hindi text, replace espeak clips, fill `data/help_centers/`, real risk rules/question sets, verify Docker Compose and live providers.

## 5. Known limitations / not verified

- No calibration, OOD, robustness, faithfulness or quantisation-accuracy numbers — the dataset stayed on the owner's machine; scripts are ready.
- Knowledge base, safe-step scripts, symptom questions and risk rules are all placeholder-derived and switched off in production.
- Translation (IndicTrans2/Bhashini), Overpass, Nominatim, Open-Meteo and Hugging Face models were unreachable from the build environment: code paths are unit-tested with mocks only.
- Docker images not built. `chromadb` has open advisories without a fixed release.
- Hindi strings and audio are machine drafts; espeak voice is not farmer-grade.
