# knowledge_base/questions/

One file per confusable pair: `<slug_a>__vs__<slug_b>.json` (slugs sorted
alphabetically, e.g. `tomato_early_blight__vs__tomato_late_blight.json`).

Rules enforced by the loader (`ml-service/app/symptoms/questions.py`):

- exactly two `classes` (raw class keys from `models/class_names.json`);
- every question has `text.en`, `p_yes` for both classes in [0.01, 0.99],
  and at least one citation `{file, page, quote}` pointing to a document in
  `knowledge_base/documents/`;
- a `likelihood_basis` saying how `p_yes` was chosen;
- `source_is_placeholder: true` files are refused when `ENV=production`.

Only write questions a cited document supports. The only file shipped is
derived from the placeholder PDFs (demo only). After adding/editing a file,
regenerate its audio: `python scripts/generate_audio.py --lang en hi --only-changed`.
