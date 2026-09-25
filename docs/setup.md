# Setup Guide

This guide walks through setting up the full system from a clean checkout:
Python ML service, Node backend, React frontend, dataset, knowledge base,
and the local LLM (Ollama).

## Prerequisites

- Python 3.11+ (3.12 recommended)
- Node.js 18+
- Git
- A Kaggle account (for dataset download)
- [Ollama](https://ollama.com) installed locally, with the `llama3.2` model pulled
- ~10 GB free disk space (PlantVillage dataset + model checkpoints + Python packages)
- A GPU is **not required** but speeds up training significantly. CPU training works but is slow.

## 1. Clone and configure environment variables

```bash
git clone <your-repo-url> plant-disease-support
cd plant-disease-support
cp .env.example .env
```

Open `.env` and adjust values if needed. The defaults work for a fully local
setup (Ollama on localhost, services on their default ports).

## 2. Download the PlantVillage dataset from Kaggle

The dataset is **not included in this repository** -- you must download it
yourself.

1. Create a free Kaggle account at https://www.kaggle.com if you don't have one.
2. Go to the PlantVillage dataset page, e.g.
   https://www.kaggle.com/datasets/abdallahalidev/plantvillage-dataset
   (there are a few mirrors of this dataset on Kaggle; any color/segmented
   PlantVillage mirror with class-labeled folders works).
3. Download the dataset (either via the website's "Download" button, or the
   Kaggle CLI):

   ```bash
   pip install kaggle
   # Place your kaggle.json API token in ~/.kaggle/kaggle.json first
   # (Kaggle account settings -> "Create New API Token")
   kaggle datasets download -d abdallahalidev/plantvillage-dataset
   unzip plantvillage-dataset.zip -d data/plantvillage_raw
   ```

4. **Arrange the folders** so that `data/plantvillage/` directly contains one
   subfolder per class, each full of images for that class:

   ```
   data/plantvillage/
     Tomato___Late_blight/
       image1.jpg
       image2.jpg
       ...
     Tomato___Early_blight/
       ...
     Potato___healthy/
       ...
   ```

   Some Kaggle mirrors nest an extra "color"/"grayscale"/"segmented" folder,
   or a top-level `PlantVillage/` folder -- move the class folders up so they
   sit directly under `data/plantvillage/`.

5. **Validate the dataset loaded correctly** before committing to a full
   training run:

   ```bash
   cd ml-service
   python -c "
   from pathlib import Path
   from app.training.dataset import validate_dataset_structure
   report = validate_dataset_structure(Path('../data/plantvillage'))
   print(report)
   "
   ```

   You should see output like:
   ```
   {'num_classes': 15, 'total_images': 20638, 'per_class_counts': {...}}
   ```

   If the dataset structure is wrong, you'll get a clear error explaining
   what's missing (e.g. "Expected at least 2 class subfolders..."). This
   same validation runs automatically as the first step of
   `python -m app.training.train`, so a misconfigured dataset fails fast
   with a clear message rather than partway through training.

## 3. Set up the Python ML service

```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Train the model

```bash
python -m app.training.train
```

This runs head-training, then fine-tuning, with early stopping, and writes
artifacts to `../models/`:
- `plant_disease_model.pt`
- `model_config.json`
- `class_names.json`
- `training_metrics.json`
- `evaluation_report.json` (real accuracy/precision/recall/F1/confusion matrix on the held-out test set)

Training on CPU can take a while depending on dataset size; a GPU
(`torch.cuda.is_available()`) will be used automatically if present.

### Set up the agricultural knowledge base (RAG)

1. Add real agricultural PDF documents (extension guides, plant pathology
   references, FAO/ICAR publications, etc.) to `knowledge_base/documents/`.
2. For each PDF, optionally add a metadata sidecar file named
   `<filename>.pdf.meta.json`:

   ```json
   {
     "title": "Tomato Late Blight: Identification and Management",
     "organization": "State Agricultural Extension",
     "crop": "Tomato",
     "disease": "Late Blight",
     "source_url": "https://example.edu/tomato-late-blight-guide",
     "document_type": "extension_guide"
   }
   ```

   Without a sidecar, the system falls back to filename-derived defaults and
   logs a warning -- citations will still work, just with less precise
   metadata.

3. Ingest the knowledge base into the vector database:

   ```bash
   python -m app.rag.ingest
   ```

   Add `--rebuild` to clear and rebuild the vector store from scratch.

   The first run downloads the embedding model
   (`sentence-transformers/all-MiniLM-L6-v2`) from Hugging Face -- this
   requires normal internet access.

### (Optional) Enable translation of the explanation (Step 2)

The English, evidence-grounded explanation is always produced first; a
translation backend then translates it. Choose one with
`TRANSLATION_BACKEND`:

- `indictrans2` (default, open model, runs locally):

  ```bash
  pip install transformers sentencepiece
  pip install IndicTransToolkit   # recommended pre/post-processing (optional)
  ```

  The first Hindi request downloads `ai4bharat/indictrans2-en-indic-dist-200M`
  (~1 GB RAM on CPU). If the download is impossible, responses say
  `translation_status: "unavailable"` and the English text is shown.
- `bhashini`: set `BHASHINI_USER_ID` and `BHASHINI_API_KEY` (from the Bhashini/ULCA portal).
- `none`: English only.

Check round-trip drift (a warning signal, not proof of quality):

```bash
python -m app.translation.drift_check --lang hi --out ../docs/translation_drift_hi.json
```

### Set up Ollama (LLM)

```bash
ollama serve          # if not already running as a background service
ollama pull llama3.2
```

Verify it's reachable:

```bash
curl http://localhost:11434/api/tags
```

### Run the ML service

```bash
uvicorn app.main:app --reload --port 8000
```

The ML service now only answers requests that carry the internal token, so
check it through the backend instead: http://localhost:5000/api/health -- you should see
`model_loaded: true`, `knowledge_base_ready: true`, `llm_reachable: true`
once all three setup steps above are complete.

## 4. Set up the Node/Express backend

```bash
cd backend
npm install
npm run migrate      # creates backend/data/agrisight.sqlite3 (also runs automatically on start)
npm run seed         # optional, dev only: demo user / expert / admin accounts (password printed once)
npm run dev
```

The backend listens on port 5000 by default and proxies to the ML service
at `ML_SERVICE_URL` (default `http://localhost:8000`).

**v2 required settings** (already in `.env.example`):

- `ML_INTERNAL_TOKEN` -- the *same* value must be visible to the backend and
  the ML service (both read the root `.env`). Without it the ML service
  answers every `/api` call with `503`/`401`.
- `JWT_SECRET` -- if missing in development a random value is used and all
  sessions end when the backend restarts; in `ENV=production` the backend
  refuses to start.

**Windows note:** `better-sqlite3` ships prebuilt binaries for current Node
LTS versions on Windows. If `npm install` tries to compile it, install the
"Desktop development with C++" workload (Visual Studio Build Tools) or use a
Node LTS version, then re-run `npm install`.

## 5. Set up the React frontend

```bash
cd frontend
npm install
npm run dev
```

Visit the URL Vite prints (typically http://localhost:5173).

- **Farmer Mode** (no login): landing → "I'm a farmer". The camera needs
  `localhost` or HTTPS (browsers block `getUserMedia` on plain http from other
  hosts); on a phone in the same Wi-Fi, use the gallery button or serve over HTTPS.
- **Account Mode**: landing → "Sign in / Register", or use the seeded demo accounts.

### Optional v2 extras (run on the machine that has the dataset and model)

```bash
cd ml-service
python -m app.calibration.fit                 # temperature scaling + OOD thresholds (docs/evaluation.md §4)
python -m app.evaluation.robustness           # robustness table (§7)
python -m app.rag.coverage                    # which classes have evidence
pip install onnx onnxruntime
python -m app.export.onnx_export              # browser model for offline Farmer Mode (§8)
cd .. && python scripts/generate_audio.py --only-changed   # re-make audio after editing scripts
```

## 5b. Docker Compose (alternative to steps 3–5)

Requires Docker Desktop, a trained model in `./models/`, and Ollama on the
host. From the repository root:

```bash
# PowerShell: $env:JWT_SECRET="..."; $env:ML_INTERNAL_TOKEN="..."; $env:POSTGRES_PASSWORD="..."
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
export ML_INTERNAL_TOKEN=$(python -c "import secrets;print(secrets.token_urlsafe(32))")
export POSTGRES_PASSWORD=choose-a-password
docker compose up --build
```

Frontend: http://localhost:8080 · Backend: http://localhost:5000 · the ML
service and Postgres are not published. Compose defaults to `ENV=production`,
which **refuses the placeholder knowledge-base content** (safe steps,
questions, risk rules, placeholder PDFs). For a demo with the placeholder
content, run `ENV=development docker compose up --build`.
`docker compose config` was validated during the build, but the images were
**not built or run there** (no Docker daemon / registry access) — see
`docs/HUMAN_TODO.md`.

## 6. Run the tests

```bash
# ML service tests
cd tests/ml-service
pip install -r ../../ml-service/requirements.txt
pytest -v

# Backend tests (in-memory SQLite)
cd backend
npm test
# ...the same suite against Postgres (portability check):
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/agrisight npm test

# Frontend tests + lint
cd frontend
npm test
npm run lint
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/model-status` shows `model_loaded: false` | Model not trained yet | Run `python -m app.training.train` |
| `/api/knowledge-base-status` shows `ready: false` | No PDFs ingested | Add PDFs to `knowledge_base/documents/` and run `python -m app.rag.ingest` |
| `/api/health` shows `llm_reachable: false` | Ollama not running, or model not pulled | `ollama serve` and `ollama pull llama3.2` |
| Frontend can't reach backend | Wrong `VITE_BACKEND_URL` | Check `frontend/.env` |
| Backend can't reach ML service | Wrong `ML_SERVICE_URL`, or ML service not running | Check `.env` and confirm `uvicorn` is running |
| Every diagnosis fails with 401/503 from the ML service | `ML_INTERNAL_TOKEN` missing or different between backend and ML service | Set the same value in the root `.env`, restart both |
| Signed out after every backend restart | `JWT_SECRET` not set (dev uses a random one) | Set `JWT_SECRET` in `.env` |
| Login works but refresh fails on http://localhost | Browser refuses `Secure` cookie on plain http | Use Chrome/Firefox on `localhost`, or set `COOKIE_SECURE=false` for local dev only |
| Dataset validation error | Folder structure doesn't match expected layout | See step 2.4 above |
