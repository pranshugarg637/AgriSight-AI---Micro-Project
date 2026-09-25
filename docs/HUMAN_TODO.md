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

## Step 4 — Help finder

- [ ] **Fill `data/help_centers/`** (currently no real entries, by design).
  Follow `data/help_centers/README.md`: one file per state, entries copied
  from official directories (ICAR/ATARI KVK list, state agriculture
  department district offices), each with `source_url` and `verified_on`.
  Add `lat`/`lng` where the directory provides them so "nearest office" works.
- [ ] Optionally add a verified national helpline as a `type: "helpline"`
  entry (with its official source page) — not hard-coded because it could
  not be verified during the build.
- [ ] Set `PROVIDER_USER_AGENT` to include a real contact e-mail (OSM usage
  policy) before any public deployment; for heavy use, run your own
  Overpass/Nominatim instance or switch to `SHOP_PROVIDER=google` with a key.
- [ ] Live Overpass/Nominatim calls were **not** verified from the build
  environment (no network); test once on a connected machine:
  `curl "http://localhost:5000/api/farmer/shops?lat=26.85&lng=80.95"`.

## Step 5 — Diagnosis quality

- [ ] **Run calibration + OOD fitting on your machine** (the dataset never left
  it): `cd ml-service && python -m app.calibration.fit`. Then copy the printed
  numbers into `docs/evaluation.md` §4 and commit `docs/figures/reliability_test.png`.
- [ ] **Collect a real junk set** (≈100–300 photos: hands, soil, walls, sky,
  documents, other crops/weeds, *field* photos of unsupported plants) into
  `data/ood_junk/` and re-run with `--junk-dir ../data/ood_junk`.
- [ ] **Add real knowledge-base documents** (see `docs/knowledge-base-guide.md`),
  delete the two placeholder PDFs, re-ingest, and run `python -m app.rag.coverage`.
- [ ] **Symptom questions**: the only set
  (`knowledge_base/questions/tomato_early_blight__vs__tomato_late_blight.json`)
  is derived from the placeholder PDFs and refused in production. Re-write it
  from real documents and add sets for other confusable pairs (look at the
  confusion matrix in `models/evaluation_report.json` for the most-confused
  pairs), each question citing a document quote. Have an agronomist check the
  `p_yes` constants.
- [ ] **Faithfulness**: with Ollama and the NLI model available, collect ~50
  real responses (`FAITHFULNESS_ACTION=flag`) and run
  `python -m app.faithfulness.evaluate`; report the unsupported-claim rate.
