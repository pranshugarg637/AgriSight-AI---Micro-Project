# data/

This directory holds generated/downloaded data artifacts, all excluded from
version control (see `.gitignore`):

| Path | Description | How it's created |
|---|---|---|
| `plantvillage/` | The PlantVillage dataset (class-labeled leaf images) | Downloaded manually from Kaggle -- see `docs/setup.md` |
| `vector_db/` | Chroma's persisted vector database for the RAG knowledge base | Created by `python -m app.rag.ingest` |
| `predictions_log.jsonl` | Append-only log of past predictions (for analytics/Power BI) | Written automatically by the ML service on each prediction |
| `gradcam_outputs/` | Optional saved Grad-CAM images (if you extend the service to persist them) | Not used by default -- Grad-CAM images are currently returned inline as base64 |

None of these are meant to be committed to git; they are either large binary
downloads, generated indexes, or runtime logs.
