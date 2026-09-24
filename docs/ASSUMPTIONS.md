# Assumptions and defaults (v2)

The build brief asked for no questions to be asked; every decision that was
the owner's to make is recorded here with the default that was used.

## Defaults given in the brief

| # | Decision | Default used |
|---|---|---|
| A1 | Languages | English (`en`) + Hindi (`hi`). Adding a language = one `frontend/src/i18n/locales/<code>.json`, one `audio_scripts/<code>/` folder, and one entry in `SUPPORTED_LANGUAGES`. |
| A2 | Database | SQLite (`backend/data/agrisight.sqlite3`) in dev via Knex + better-sqlite3; the same migrations run on Postgres (used by `docker-compose.yml`). |
| A3 | Knowledge base | No real documents yet. Ingestion, validation and coverage tooling were built; the two shipped PDFs are placeholders and are refused when `ENV=production`. |
| A4 | Deployment | Docker Compose (frontend, backend, ml-service, postgres). Ollama runs separately (documented). |

## Decisions made during the build

| # | Decision | Reason |
|---|---|---|
| B1 | `POST /api/predict` now requires a Bearer token (per brief). Its request/response body is unchanged except for **additive** fields. The two existing backend tests that called it anonymously were updated to authenticate. | The brief says the route "becomes authenticated"; guests use `/api/farmer/predict`. |
| B2 | New account routes live under `/api/v2/...`; auth under `/api/auth/...`; guest under `/api/farmer/...` (paths given in the brief). | "Version new routes clearly." |
| B3 | Registration always answers `202 Accepted` with the same message and does not auto-login. | A `409 email exists` would reveal account existence. |
| B4 | Login failures return one generic 401 message, including while an account is locked. Lockout: `AUTH_MAX_FAILED_LOGINS` (5) failures → locked `AUTH_LOCKOUT_MINUTES` (15). | Brief: generic errors + lockout/backoff. |
| B5 | Passwords: bcrypt via `bcryptjs` (pure JS, no native build on Windows), cost `BCRYPT_COST` (default 12; tests use 4). | argon2/bcrypt allowed; pure JS avoids Windows build tools. |
| B6 | Access token: HS256 JWT, 15 min. Refresh token: 48 random bytes, stored as SHA-256 hash, httpOnly cookie `agrisight_rt`, `SameSite=Strict`, `Secure` (unless `COOKIE_SECURE=false`), path `/api/auth`, 7 days, rotated on every use, reuse → whole family revoked. | Brief. |
| B7 | ML service requires `X-Internal-Token` equal to `ML_INTERNAL_TOKEN` on every `/api/*` route. If the variable is unset the service refuses to start when `ENV=production` and rejects every `/api` call in dev (503) with a message telling you to set it. | Brief: "Reject requests without it." |
| B8 | Farmer-mode scans are recorded **anonymously** (`user_id NULL`, no image, no IP, no coordinates) so monitoring can count them. | Brief: anonymous `mode` field + monitoring. |
| B9 | Every authenticated scan attaches to a plot. If the client does not send `plot_id`, the scan goes to the user's default plot "My field", created on demand. | Brief: "Every authenticated scan attaches to a plot." |
| B10 | Audio scripts in Hindi are **machine drafts written during this build** (not by a native speaker) so that the Hindi demo path works. All have `reviewed_by_native_speaker: false`, the UI shows a dev-only warning, and they are in `HUMAN_TODO.md`. | Brief makes translation review `TODO_HUMAN`; the demo path needs *some* Hindi. |
| B11 | Disease "safe steps" in audio scripts exist **only** for the two tomato blight classes, derived from the placeholder PDFs, and are flagged `source_is_placeholder: true`; they are not spoken when `ENV=production`. All other classes speak "reliable advice was not found — please visit the agriculture office". | Never fabricate; brief allows only KB-sourced steps. |
| B12 | Symptom-question likelihoods are **modelling constants** (`0.8` when the cited document describes the sign as characteristic of that disease, `0.3` otherwise, `unsure` = no update), not numbers from the literature. This is documented on every question file (`likelihood_basis`). | Documents describe signs qualitatively; inventing literature-looking probabilities would be fabrication. |
| B13 | Weather risk rules report whether forecast hours fall inside a *cited* favourable window. Only numeric parameters that appear in the cited text are used. Output levels: `no_matching_conditions` / `favourable_conditions_forecast`, with the count of matching hours — no invented severity scale. The two shipped rules come from the placeholder PDFs and are disabled in production. | Never fabricate thresholds. |
| B14 | "Leaf wetness" in rules is approximated as `precipitation > 0 mm` in that hour, because relative-humidity thresholds are not stated numerically in the source. Documented on the rule. | Only use cited numbers. |
| B15 | Spray-window advisor **not implemented** — no cited source for rain/wind thresholds exists in the KB. | Brief: only when a cited source supports it. |
| B16 | Shop provider default: OpenStreetMap Overpass (`shop=agrarian` = agricultural inputs, plus `shop=garden_centre`), 15 km radius, max 10 results, results cached 24 h in memory keyed on coordinates rounded to 3 decimals (~110 m) — the rounded point is also what is sent to the provider. Attribution "© OpenStreetMap contributors (ODbL)" shown in the UI. Village search uses Nominatim (≤ 1 req/s, cached). Google Places is a drop-in alternative (`SHOP_PROVIDER=google`). | Brief; OSM usage policies. |
| B16b | No national helpline number is hard-coded (e.g. Kisan Call Centre); it could not be verified from the build environment. Add it as a `type: "helpline"` entry with a source URL (HUMAN_TODO). | Never fabricate office data. |
| B17 | Translation backend default `TRANSLATION_BACKEND=indictrans2` (lazy-loaded). If it cannot load (no model download, no GPU/RAM), responses carry `translation_backend: "unavailable"` and the English explanation is shown — never an LLM-written translation. | Brief: do not ask llama3.2 to write Hindi. |
| B18 | OOD reason codes: `not_a_leaf` = colour/leaf-likeness heuristic fails; `unsupported_crop` = leaf-like but the energy score is outside the fitted in-distribution range (this can also be an unsupported crop *or* an unusual photo of a supported crop — documented). | Brief asks for these two codes. |
| B19 | Frontend routing via `react-router-dom`; the old single-page diagnosis UI became `pages/account/DiagnosePage.jsx`. The existing App tests were pointed at that page (assertions unchanged). | Landing screen is now the root. |
| B20 | Images of account scans are stored on local disk (`backend/data/images/`, EXIF stripped by re-writing JPEG/PNG/WebP containers without metadata segments). Retention `IMAGE_RETENTION_DAYS` (default 180) enforced by `npm run retention`. | Brief. |
| B21 | Offline (Step 8) uses ONNX Runtime Web with a dynamically-quantised model exported from the trained checkpoint; the online server path stays the default. | Brief. |
