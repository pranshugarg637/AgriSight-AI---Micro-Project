# Evidence-Grounded Plant Disease Decision Support System

A confidence-aware plant disease diagnosis system that pairs a specialized
computer-vision model with Grad-CAM explainability and retrieval-augmented,
evidence-grounded recommendations -- built as a college decision-support
project.

## This is not "ChatGPT for plants"

A general-purpose multimodal LLM can often guess a plant disease from a
photo. This project is deliberately **not** that. It's a controlled,
measurable, explainable, evidence-grounded agricultural decision-support
system, built by combining:

**Specialized Computer Vision** + **Confidence Estimation** + **Explainability**
(Grad-CAM) + **Curated Agricultural Knowledge** + **RAG** + **Grounded LLM
Generation** + **Measurable Evaluation**

See `docs/architecture.md` for the reasoning behind every one of these
design choices.

## How it works

```
Leaf photo
   → image quality validation
   → specialized CNN (MobileNetV2, transfer learning)
   → confidence-aware diagnosis (high / low / unreliable)
   → differential diagnosis (top alternatives)
   → Grad-CAM visual explanation
   → structured query → RAG retrieval over curated agricultural PDFs
   → grounded LLM generation (Ollama / llama3.2), constrained to retrieved evidence only
   → farmer-friendly explanation + citations
```

If the CNN is unreliable, or retrieval finds no relevant evidence, the
system says so explicitly rather than guessing or inventing an answer.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Node.js + Express |
| ML/RAG service | Python + FastAPI |
| Computer vision | PyTorch, MobileNetV2 / EfficientNet-B0 (transfer learning) |
| Explainability | Grad-CAM |
| Vector database | Chroma |
| Embeddings | Sentence Transformers (`all-MiniLM-L6-v2`) |
| LLM | Ollama, running `llama3.2` locally |
| Analytics | JSONL prediction log → CSV export → Power BI |

## Project structure

```
frontend/           React app
backend/             Node/Express API gateway (proxies to ml-service; no ML logic)
ml-service/         Python FastAPI service: CNN, Grad-CAM, RAG, LLM
  app/
    training/       Dataset loading, model factory, train/evaluate scripts
    inference/      Inference service, confidence logic, Grad-CAM, image validation
    rag/            PDF ingestion, chunking, vector store, retrieval
    services/       LLM client (Ollama), prediction logging
    api/            FastAPI routers
    schemas/        Pydantic response models
knowledge_base/
  documents/        Curated agricultural PDFs (+ optional .meta.json sidecars)
data/               Generated: dataset, vector DB, prediction logs (gitignored)
models/             Generated: trained model + metrics (gitignored)
tests/
  ml-service/       pytest suite
docs/               architecture.md, model.md, rag.md, api.md, evaluation.md, setup.md
scripts/            Utility scripts
.env.example        All configuration in one place
```

## Quick start

Full walkthrough (including Kaggle dataset download) is in
**[docs/setup.md](docs/setup.md)**. Short version:

```bash
# 1. Configure
cp .env.example .env

# 2. Download PlantVillage from Kaggle into data/plantvillage/ (see docs/setup.md)

# 3. ML service
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m app.training.train              # trains the model
python -m app.rag.ingest                   # ingests knowledge_base/documents/*.pdf
ollama pull llama3.2 && ollama serve       # local LLM (separate terminal/service)
uvicorn app.main:app --reload --port 8000

# 4. Backend (new terminal)
cd backend
npm install
npm run dev

# 5. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Then open the frontend URL Vite prints (typically http://localhost:5173).

## Configuration

Every threshold and path is an environment variable -- see `.env.example`.
Notably:

- `HIGH_CONFIDENCE_THRESHOLD` / `LOW_CONFIDENCE_THRESHOLD` -- confidence
  tiering boundaries (defaults 0.80 / 0.60)
- `RAG_TOP_K` / `RAG_MIN_RELEVANCE_SCORE` -- retrieval breadth and relevance
  cutoff
- `LLM_MODEL` / `OLLAMA_BASE_URL` -- which local model to call and where

## Testing

```bash
# ML service (42+ tests: dataset, model factory, Grad-CAM, confidence logic,
# image validation, PDF ingestion, RAG retrieval, API contract)
cd tests/ml-service && pytest -v

# Backend (proxying, upload validation, error handling)
cd backend && npm test

# Frontend (upload flow, loading state, result rendering, low-confidence
# state, source rendering)
cd frontend && npm test
```

## API documentation

See [docs/api.md](docs/api.md) for the full endpoint reference, or run the
ML service and visit `http://localhost:8000/docs` for interactive Swagger
docs.

## Evaluation

See [docs/evaluation.md](docs/evaluation.md) for the CV metrics
(accuracy/precision/recall/F1/confusion matrix), the manual RAG evaluation
methodology, and the Power BI data export.

## Limitations

- **PlantVillage is lab-style data.** The model is trained and evaluated
  primarily on PlantVillage, which uses controlled backgrounds and
  lighting. Real-world field photos (cluttered backgrounds, variable
  lighting, phone-camera artifacts) will likely see lower accuracy. This is
  surfaced to the user in every response, not just in this document.
- **The knowledge base ships with two illustrative placeholder PDFs**, not a
  production-ready agricultural knowledge base. Replace
  `knowledge_base/documents/` with real ICAR/FAO/university extension
  documents before treating this as more than a demo (see
  `docs/setup.md` and `docs/rag.md`).
- **Grad-CAM shows correlation, not proof of correctness.** It highlights
  which pixels influenced the prediction; it does not verify the model's
  reasoning is medically/agriculturally sound.
- **Ollama must be running locally** for the LLM generation step; if it's
  unreachable, the API still returns the diagnosis, confidence, Grad-CAM,
  and sources -- only the natural-language `explanation` field is omitted.

## Future work (explicitly out of scope for this MVP)

- Multi-agent orchestration frameworks (e.g. LangGraph)
- Live weather API integration
- Real-time streaming infrastructure
- A production RAG-evaluation platform (RAGAS or similar)
- Mobile application
- Additional crop/disease coverage beyond PlantVillage's classes
- A larger, field-collected (non-lab) test set for real-world accuracy
  measurement

## Team structure

| Role | Responsibilities |
|---|---|
| Knowledge Engineer + QA + Documentation | Curating `knowledge_base/documents/`, metadata sidecars, RAG evaluation set, docs |
| ML + Model Evaluation + Power BI | Training pipeline, evaluation metrics, Power BI dashboard |
| GenAI + Backend + Frontend + Integration | LLM prompting, Node backend, React frontend, end-to-end integration |

Each module (ml-service, backend, frontend) is independently runnable and
testable, so team members aren't blocked on each other during development.
