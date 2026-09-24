# HUMAN_TODO — things only a person can supply

Everything below has a working *mechanism* in the code; what is missing is
real-world content, review or credentials. Items are grouped by step. Each
one says exactly what to do. Nothing here was invented to fill the gap.

## Step 1 — Auth / deployment

- [ ] **Set real secrets** in `.env` for anything beyond local dev:
  `JWT_SECRET` (≥ 32 random chars) and `ML_INTERNAL_TOKEN` (≥ 24 chars), and
  `ENV=production`. Both services refuse to start in production without them.
- [ ] Decide whether demo accounts should exist anywhere shared; `npm run seed`
  refuses to run in production unless `--force` is passed.

## Step 2 — Languages

- [ ] **Native-speaker review of `frontend/src/i18n/locales/hi.json`.** All
  Hindi UI strings were machine-drafted during the build. After review, set
  `"_meta": {"reviewed_by_native_speaker": true}`.
- [ ] Choose the translation backend for explanations: install IndicTrans2
  (`pip install transformers sentencepiece IndicTransToolkit`, first request
  downloads the model) **or** obtain Bhashini keys (`BHASHINI_USER_ID`,
  `BHASHINI_API_KEY`). Neither was reachable from the build environment, so
  real translation quality is **unverified**.
- [ ] Run `python -m app.translation.drift_check --lang hi` once a backend
  works and have a native speaker look at the lowest-scoring sentences.
- [ ] To add a third language (e.g. Marathi `mr`): add
  `frontend/src/i18n/locales/mr.json` (copy `en.json`, translate, set
  `_meta.nativeName` to "मराठी"), add `audio_scripts/mr/` (copy `audio_scripts/en/`
  and translate the `clips` values), add `mr` to `SUPPORTED_LANGUAGES`, and run
  `python scripts/generate_audio.py --lang mr`.

## Step 3 — Farmer Mode audio

- [ ] **Native-speaker review of every file in `audio_scripts/hi/`** (and of
  the English wording in `audio_scripts/en/` for plain, farmer-friendly
  language). Set `"reviewed_by_native_speaker": true` per file after review.
- [ ] **Replace the robotic espeak-ng clips** in `audio_clips/` with human
  recordings (`python scripts/generate_audio.py --backend prerecorded --source-dir <folder>`)
  or a proper Indic TTS voice (`--backend coqui --coqui-model <model>`).
- [ ] **Safe-step scripts for 34 of 38 classes are intentionally empty**
  (`"what_it_is": null, "safe_steps": null`, see `todo_human` in each file).
  For each class, add text taken *only* from a real document you have added
  to `knowledge_base/documents/`, and list that document in the file's
  `sources`. The two tomato-blight scripts that do have steps come from the
  **placeholder** PDFs (`source_is_placeholder: true`) and are removed
  automatically when `ENV=production` — rewrite them from a real source.
