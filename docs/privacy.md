# Privacy & security (v2)

AgriSight AI is used by farmers who may not read privacy notices, so the
defaults collect as little as possible.

## What is collected

| Mode | Photo | Account data | Location | Scan record |
|---|---|---|---|---|
| **Farmer Mode** (no login) | Sent once to the ML service for analysis, **never written to disk** (`STORE_FARMER_IMAGES=false`) | none | Only if the farmer taps "yes" on the spoken + visual consent screen; used for one shop/office search, **never stored**, rounded to ~110 m before being sent to the single configured map provider | Anonymous row for monitoring: diagnosis, confidence, tier, reason, retrieval status, language, time. No image, no IP, no location, no user id |
| **Account Mode** | Stored (local disk by default) **after EXIF/XMP/IPTC/GPS removal**; retention `IMAGE_RETENTION_DAYS` (180) via `npm run retention` | email, bcrypt password hash, role, language, location opt-in flag | Plot coordinates only if the user opts in (Settings); turning it off erases them. One-off coordinates for a weather check are not stored | Scan, actions, follow-ups, expert label |

The Grad-CAM overlay is stored with account scans (it is derived from the photo).

## What is never done

- No third-party analytics, trackers or ad scripts (checked: none in the code).
- No coordinates or query strings in logs: access logs record path only, and
  no client IP for `/api/farmer/*`. Error logs record path only.
- Passwords, tokens and secrets are never logged (tested).
- Experts reviewing scans do not see who uploaded them (no user or plot id).
- No automatic retraining on user data. `reviewed_labels` exist for evaluation.

## User rights

- **Delete a scan**: removes the row and the stored photo/Grad-CAM files.
- **Delete a plot**: removes its scans and files.
- **Delete account** (Settings → Delete my account / `DELETE /api/auth/me`):
  removes the user, refresh tokens, plots, scans, actions, follow-ups and files
  (real deletion, not a flag).

## Third parties contacted (and what they receive)

| Service | When | Receives |
|---|---|---|
| OpenStreetMap Overpass (default shop provider) | farmer allows location and opens the help finder | rounded coordinates, search radius |
| OpenStreetMap Nominatim | farmer types a village name | the typed name |
| Google Places (only if `SHOP_PROVIDER=google`) | same as Overpass | rounded coordinates |
| Open-Meteo | account user checks weather risk | coordinates rounded to 2 decimals (~1 km) |
| Hugging Face (model download, first use) | ML service start / first translation | nothing about users |
| Bhashini (only if `TRANSLATION_BACKEND=bhashini`) | a translated explanation is requested | the English explanation text (no user data) |
| Google Fonts | page load | the viewer's IP (standard web font request); system fonts are used if it is blocked. Self-host the fonts to avoid this. |

## Consent screens

- Location: spoken and visual question with big ✔ / ✖ buttons before any
  location access; "no" leads to a district picker.
- Farmer home screen states that the photo is discarded after checking.
- Account: location storage is opt-in in Settings with an explanation.

## Security controls

| Control | Where |
|---|---|
| bcrypt (cost 12), 15-min access JWT, rotating hashed refresh token in httpOnly/Secure/SameSite=Strict cookie, reuse → family revoked | `backend/src/auth`, `routes/auth.js` |
| Generic auth errors, lockout after 5 failures, per-IP rate limits (auth, predict, farmer) | `routes/auth.js`, `middleware/rateLimits.js` |
| zod validation on every body/query | routes |
| Roles `user` / `expert` / `admin`, ownership checks that answer 404 | `middleware/auth.js`, `routes/account.js` |
| helmet headers, `x-powered-by` off, CORS allow-list (`CORS_ORIGINS`) with credentials | `app.js` |
| Upload MIME allow-list **and** magic-byte check, size caps (8 MB account, 4 MB farmer) | `middleware/upload.js` |
| ML service internal-only (`X-Internal-Token`, not published in Compose) | `ml-service/app/security.py`, `docker-compose.yml` |
| Fail fast without secrets in production | `backend/src/config`, `app/security.py` |

### Dependency audit (run during the v2 build, 2026-09-25)

- `backend`: `npm audit --omit=dev` → 5 findings (express → qs); fixed with
  `npm audit fix` → **0 vulnerabilities**.
- `frontend`: `npm audit` → **0 vulnerabilities**.
- `ml-service`: `pip-audit -r requirements.txt` → findings in old pins of
  starlette/fastapi, pillow, pypdf, python-multipart, python-dotenv, pytest;
  requirements moved to fixed minimum versions and the test suite re-run.
  **Remaining: `chromadb 1.5.9` (4 advisories, no fixed version published at
  audit time).** Mitigation: Chroma runs embedded (`PersistentClient`), no
  Chroma server port is exposed, and only curated PDFs are ingested. Re-audit
  regularly (`npm audit`, `pip-audit`).
