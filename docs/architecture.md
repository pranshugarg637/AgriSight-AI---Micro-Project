# Architecture

## v2 overview

See `docs/v2-plan.md` for the full v2 design. In short:

```
React PWA ── Farmer Mode (/api/farmer/*, no login) ─┐
          └─ Account Mode (JWT, /api/predict, /api/v2/*) ─┤
                                                         ▼
Node/Express gateway: auth (JWT + rotating refresh cookie), roles
  (user/expert/admin), zod validation, per-tier rate limits, DB (Knex:
  SQLite dev / Postgres), EXIF-stripping image store, help finder,
  weather risk rules, audio clip serving
                                                         │ X-Internal-Token
                                                         ▼
FastAPI ML service (internal network only): all ML / RAG / LLM /
  translation / calibration / OOD / symptom-question logic
```

The layering rule is unchanged: React renders; Node handles HTTP, auth,
rate limiting, validation and the database; Python owns every ML, RAG and
LLM decision. The ML service rejects any request without the shared
internal token (`app/security.py`), so it cannot be used to bypass the
backend's auth and rate limits.

## Farmer Mode (Step 3)

Camera-first, voice-first, low-literacy flow (`frontend/src/farmer/`):

1. **Guided capture** (`CameraCapture.jsx`, `frameQuality.js`,
   `captureMachine.js`): rear camera via `getUserMedia`; ~3 frames/s are
   downscaled to 160×120 and checked *on the phone* for brightness,
   sharpness (variance of the Laplacian), leaf-likeness (share of
   plant-coloured pixels in the centre) and motion. After
   `requiredGoodFrames` (4) consecutive good frames one still photo is taken
   and sent once to `POST /api/farmer/predict`. There is always a big manual
   shutter button, and a gallery/upload fallback when the camera is denied
   or unsupported. No video is ever streamed. These thresholds are
   heuristics for *when to take a photo*, not diagnostic logic
   (`DEFAULT_THRESHOLDS`).
2. **Safety gating** (`safetyGating.js`) turns the server result into a list
   of clip keys: `high` → name + only KB-cited "what it is / safe steps";
   `low` → "not sure", top + alternative, caution, questions or office;
   `unreliable` → never a disease name; no evidence → name only, "reliable
   advice was not found", office.
3. **Audio** (`audioPlayer.js`): plays pre-generated clips from
   `audio_clips/`; if a clip is missing, the browser's speech synthesis
   reads the *same pre-authored script text* and the fallback is logged
   (console + backend). Live LLM or translation output is never spoken.
4. **Shopkeeper card**: crop/disease in English and the farmer's language,
   the confidence band and the photo — no product recommendation.

Scripts live in `audio_scripts/<lang>/` (`_prompts.json` + one file per
class). Every file carries `reviewed_by_native_speaker`; unreviewed files
trigger a dev-only banner. `scripts/generate_audio.py` builds the clips
(espeak-ng / Coqui-compatible model / pre-recorded human audio).

## System overview (v1 core pipeline)

```
React (frontend)
      │  HTTP (multipart image upload)
      ▼
Node/Express (backend)
      │  proxies to ML service; no ML logic here
      ▼
FastAPI (ml-service)
      ├── image validation
      ├── CNN inference (MobileNetV2 / EfficientNet-B0, transfer learning)
      ├── confidence-aware diagnosis logic
      ├── Grad-CAM explainability
      ├── RAG retrieval (Chroma vector DB + Sentence Transformers)
      └── grounded LLM generation (Ollama, llama3.2)
```

Each layer has one job, and none of them silently take over another layer's
responsibility:

- **React** only renders what the backend gives it. It contains no
  diagnosis logic, no confidence-threshold logic, and no RAG logic.
- **Node/Express** only proxies, validates uploads, rate-limits, and handles
  errors cleanly. It does not call the CNN, the vector DB, or the LLM
  directly -- **all ML/RAG logic lives in the Python service.**
- **FastAPI (ml-service)** owns the entire ML/RAG/LLM pipeline and exposes a
  clean HTTP contract.

## Why a specialized CNN instead of asking a general-purpose LLM to classify the image?

A large multimodal LLM can often guess a plant disease from a photo, but:

1. **It can't be evaluated rigorously.** A specialized CNN trained on
   PlantVillage produces measurable accuracy, precision, recall, F1, and a
   confusion matrix on a held-out test set. A general LLM's image
   classification accuracy on this exact task is not something you can
   cleanly benchmark or reproduce.
2. **It can't be explained at the pixel level.** Grad-CAM requires access to
   a convolutional network's internal activations. That's not available for
   most externally-hosted general-purpose models.
3. **Confidence calibration matters more than raw accuracy for a
   decision-support tool.** A dedicated softmax output over a fixed, known
   class set gives us a well-defined confidence score to build the
   confidence-aware tiering (high/low/unreliable) on top of. An LLM's
   free-text "I think this might be X" doesn't give you that.
4. **It's the actual point of the project.** The brief is explicitly to
   build a controlled, measurable, explainable system -- not another
   "upload an image and ask an LLM" wrapper.

## Why RAG instead of asking the LLM to explain from its own knowledge?

Two reasons, one about **correctness** and one about **trust**:

1. **General LLM knowledge about agricultural treatment is not reliably
   current, regionally accurate, or verifiable.** Treatment guidance in
   particular is high-stakes: a wrong or outdated recommendation can cost a
   farmer a season's crop.
2. **RAG makes every claim traceable.** By restricting the LLM to only the
   text retrieved from a curated set of documents, every recommendation in
   the response can be pointed back to a specific document, organization,
   and page number. A farmer (or an evaluator) can check the source
   directly. A model's "general knowledge" has no such paper trail.

The RAG safety rule (see `docs/rag.md`) is the actual enforcement mechanism:
retrieval returning nothing sufficiently relevant is a distinct, explicit
outcome (`insufficient_evidence` / `knowledge_base_empty`), not a silent
fallback to the LLM's own knowledge.

## Why curated agricultural sources instead of general web content?

Random web content on plant disease is inconsistent in quality, sometimes
outdated, and often written for a different climate/region than the one a
given user is in. Curated sources (extension guides, FAO/ICAR publications,
university plant pathology references) are:
- attributable to a real, checkable organization,
- reviewed by domain experts before publication,
- more likely to include the caveats (region, season, application timing)
  that matter for correct usage.

## Why Grad-CAM?

Grad-CAM answers "what part of the image influenced this prediction?" It's
the standard, well-studied technique for CNN visual explainability, requires
no architecture changes (works on the last convolutional layer of any CNN),
and produces an intuitive heatmap a non-technical farmer can look at
alongside the original photo. It is explicitly **not** presented as proof of
correctness -- see the caveat in `docs/model.md` and the UI copy in
`frontend/src/components/GradCamView.jsx`.

## Why confidence thresholds, and why configurable?

Different crops, cameras, and deployment contexts will have different
tolerance for false confidence. Hardcoding thresholds would force every
deployment to accept the same risk profile. Making
`HIGH_CONFIDENCE_THRESHOLD` / `LOW_CONFIDENCE_THRESHOLD` environment
variables lets an evaluator or a future deployment tune the system's
risk/usefulness tradeoff without touching code (see `ml-service/app/config.py`
and `ml-service/app/inference/confidence.py`).

## Why Python ML service + Node/React, instead of doing everything in one language?

- **Python** has the mature ML/RAG ecosystem (PyTorch, torchvision, Sentence
  Transformers, Chroma) this project depends on.
- **Node/Express** is a thin, fast layer for HTTP concerns (CORS, rate
  limiting, multipart upload validation, proxying) that doesn't need Python's
  ML stack.
- **React** is the standard choice for a responsive, component-based UI and
  pairs naturally with a Node backend for a unified JavaScript frontend
  toolchain.

Splitting them keeps each service's dependencies and responsibilities small
and independently testable (see Section 36/37 of the original project
brief: modules should be independently testable across team members).

## Data flow for a single prediction

1. User uploads an image via the React upload panel.
2. Node backend validates file type/size (defense in depth; the ML service
   validates again) and proxies the multipart request to FastAPI.
3. FastAPI validates image quality (blur/size/type), runs the CNN, builds a
   confidence-aware diagnosis, and generates a Grad-CAM overlay.
4. If confidence is "unreliable", the pipeline stops here -- no RAG or LLM
   call is made, and the response tells the user to retry with a clearer photo.
5. Otherwise, a structured query (crop + disease + confidence + alternatives)
   is built and used to retrieve top-k relevant chunks from the vector
   database.
6. If retrieval finds nothing sufficiently relevant, the LLM is told
   explicitly to say so rather than invent an answer.
7. The LLM (Ollama/llama3.2) generates a farmer-friendly explanation
   constrained to the retrieved evidence.
8. The full structured response (diagnosis, confidence, alternatives,
   Grad-CAM image, explanation, sources, retrieval status) is logged
   (for analytics) and returned to the frontend.
