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

Visit http://localhost:8000/api/health -- you should see
`model_loaded: true`, `knowledge_base_ready: true`, `llm_reachable: true`
once all three setup steps above are complete.

## 4. Set up the Node/Express backend

```bash
cd backend
npm install
npm run dev
```

The backend listens on port 5000 by default and proxies to the ML service
at `ML_SERVICE_URL` (default `http://localhost:8000`).

## 5. Set up the React frontend

```bash
cd frontend
npm install
npm run dev
```

Visit the URL Vite prints (typically http://localhost:5173).

## 6. Run the tests

```bash
# ML service tests
cd tests/ml-service
pip install -r ../../ml-service/requirements.txt
pytest -v

# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/model-status` shows `model_loaded: false` | Model not trained yet | Run `python -m app.training.train` |
| `/api/knowledge-base-status` shows `ready: false` | No PDFs ingested | Add PDFs to `knowledge_base/documents/` and run `python -m app.rag.ingest` |
| `/api/health` shows `llm_reachable: false` | Ollama not running, or model not pulled | `ollama serve` and `ollama pull llama3.2` |
| Frontend can't reach backend | Wrong `VITE_BACKEND_URL` | Check `frontend/.env` |
| Backend can't reach ML service | Wrong `ML_SERVICE_URL`, or ML service not running | Check `.env` and confirm `uvicorn` is running |
| Dataset validation error | Folder structure doesn't match expected layout | See step 2.4 above |
