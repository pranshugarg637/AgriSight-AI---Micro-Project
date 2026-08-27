# RAG (Retrieval-Augmented Generation)

## Pipeline

```
PDFs (knowledge_base/documents/)
   │  app/rag/pdf_ingestion.py
   ▼
Per-page text extraction + cleaning
   │  app/rag/chunking.py
   ▼
Metadata attachment (from <file>.pdf.meta.json sidecar, or filename fallback)
   │
Chunking (sliding window, page-bounded, with overlap)
   │  app/rag/vector_store.py
   ▼
Embeddings (Sentence Transformers: all-MiniLM-L6-v2)
   │
Chroma vector database (persisted to disk)
   │  app/rag/retrieval.py
   ▼
Similarity search (top-k, cosine/L2-based relevance score)
   │
Relevance filtering (RAG_MIN_RELEVANCE_SCORE)
   │  app/services/llm_service.py
   ▼
LLM (Ollama / llama3.2), constrained to only the retrieved text
```

Run ingestion with:

```bash
cd ml-service
python -m app.rag.ingest          # incremental (upserts new/changed files)
python -m app.rag.ingest --rebuild  # clears and rebuilds from scratch
```

## Why Chroma (not a hosted vector DB)?

Chroma persists to a local directory (`VECTOR_DB_PATH`), needs no separate
server process, and is more than sufficient for a knowledge base of the size
this project targets (a curated set of extension guides and plant pathology
references -- not millions of documents). This keeps local setup to
`pip install` with no external service dependency.

## Why Sentence Transformers (`all-MiniLM-L6-v2`)?

Small (~80MB), fast on CPU, and a well-established general-purpose
embedding model that performs well on short technical/agricultural text
without requiring a GPU or an external embeddings API.

## Why not LangChain?

A direct implementation (PDF extraction → chunking → embedding → Chroma
query, each as a small, independently-testable module) is simpler to reason
about, easier to unit test in isolation, and avoids pulling in a large
framework's abstractions for a pipeline that's fundamentally about five
straightforward steps. LangChain would add indirection without simplifying
anything here.

## Document metadata

Every chunk carries:

| Field | Source |
|---|---|
| `filename` | The PDF's filename |
| `title` | From `.meta.json` sidecar, or the filename (title-cased) as fallback |
| `organization` | From `.meta.json` sidecar, or `"Unknown"` as fallback |
| `crop` | From `.meta.json` sidecar, or `"General"` |
| `disease` | From `.meta.json` sidecar, or `"General"` |
| `page_number` | Always tracked (chunks never span pages) |
| `source_url` | From `.meta.json` sidecar, if provided |
| `document_type` | From `.meta.json` sidecar, defaults to `"extension_guide"` |

This metadata is returned with every retrieval result and is what powers the
"Sources" section in the UI -- every claim can be traced to a specific
document, organization, and page.

**Add a metadata sidecar for every real document you add** --
`knowledge_base/documents/<filename>.pdf.meta.json` -- so citations are
accurate. Without one, the system still works, but falls back to
filename-derived defaults and logs a warning.

## Structured retrieval query

When the CNN produces a diagnosis, `app/rag/retrieval.py::build_structured_query()`
builds a query like:

```
Tomato Late Blight symptoms causes management treatment
possible differential: Early Blight
```

incorporating crop, disease, and (if present) the differential-diagnosis
alternatives, so retrieval is grounded in the actual structured diagnosis
rather than a raw free-text question.

## The RAG safety rule

This is the most important behavior in the whole RAG pipeline. Retrieval
returns one of three explicit statuses:

- **`success`** -- at least one chunk cleared `RAG_MIN_RELEVANCE_SCORE`
  (default 0.35). These chunks are passed to the LLM, which is instructed to
  use *only* this text for factual claims.
- **`insufficient_evidence`** -- chunks exist in the knowledge base, but none
  were relevant enough to the diagnosed disease. The LLM is explicitly told
  evidence is insufficient and must say so to the user, recommending they
  consult a qualified expert -- **it must not fall back to its own general
  knowledge.**
- **`knowledge_base_empty`** -- no documents have been ingested at all. Same
  explicit-insufficiency behavior applies.

This is enforced at the prompt level (see `SYSTEM_PROMPT` and
`_build_user_prompt` in `app/services/llm_service.py`) and reflected in the
API response's `retrieval_status` field, which the frontend uses to render a
distinct "reliable information could not be found" message instead of
silently showing nothing or, worse, an ungrounded answer.

## Citations

Every source shown to the user includes: document title, organization, page
number (when available), a short excerpt, a relevance score, and a source
URL if one was provided in the metadata sidecar. The LLM is instructed never
to invent citations -- it only refers to sources it was actually given in
its prompt.

## Evaluating retrieval quality

See `docs/evaluation.md` for the manual RAG evaluation set (retrieved
source, relevance, citation correctness, groundedness) used to demonstrate
retrieval quality academically.
