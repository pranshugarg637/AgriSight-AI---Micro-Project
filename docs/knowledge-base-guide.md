# Knowledge-base guide — adding real agricultural documents

The shipped PDFs are **placeholders** ("Sample Agricultural Extension
(Placeholder Source)"). They make the demo work in development and are
refused automatically when `ENV=production`. Replace them.

## 1. Choose sources

Use documents from organisations farmers and experts trust, for the crops
and diseases the model predicts (`models/class_names.json`), for example:

- ICAR institutes and ICAR-ATARI / Krishi Vigyan Kendra publications
- State Agricultural Universities' package-of-practices / extension leaflets
- State agriculture department advisories
- FAO plant-protection publications

Check the licence allows you to store the file and quote short excerpts.
Prefer documents with page numbers and text (scanned image-only PDFs are not
supported — OCR them first).

## 2. Add the file + a metadata sidecar

```
knowledge_base/documents/tomato_late_blight_tnau.pdf
knowledge_base/documents/tomato_late_blight_tnau.pdf.meta.json
```

```json
{
  "title": "Late blight of tomato — management",
  "organization": "Tamil Nadu Agricultural University",
  "crop": "Tomato",
  "disease": "Late blight",
  "source_url": "https://<exact page or PDF link>",
  "document_type": "extension_guide",
  "retrieved_on": "2026-10-01"
}
```

`crop` and `disease` should match the model's class names (e.g. crop
`Tomato`, disease `Late blight` for `Tomato___Late_blight`) so the coverage
report can match them. Validation at ingestion:

| Problem | Development | `ENV=production` or `--strict` |
|---|---|---|
| No sidecar | loud warning | **refused** |
| `organization` empty/"Unknown" | loud warning | **refused** |
| `source_url` empty | loud warning | **refused** |
| "placeholder" in title/organization, or `"placeholder": true` | loud warning | **refused** |

## 3. Ingest

```bash
cd ml-service
python -m app.rag.ingest --rebuild          # add --strict to fail on any warning
```

The result lists `processed_files`, `rejected_files` and `metadata_warnings`.
Remove the placeholder PDFs (and their `.meta.json`) once real documents cover
tomato early/late blight.

## 4. Check coverage

```bash
python -m app.rag.coverage            # markdown table
python -m app.rag.coverage --json
```

For every class: matching documents, whether they are placeholder-only, the
live retrieval status through the real safety gate, and whether safe-step
audio, symptom questions and risk rules exist. Aim to turn every `MISSING` /
`PLACEHOLDER ONLY` disease row into `covered`.

## 5. Things that must be re-derived from your documents

After adding documents, update — citing the new files — :

1. `audio_scripts/<lang>/<class>.json` → `what_it_is`, `safe_steps`, `sources`
   (plain language, no product names/doses unless the document gives them),
   then `python scripts/generate_audio.py --only-changed`.
2. `knowledge_base/questions/*.json` → questions + quotes for confusable pairs.
3. `knowledge_base/risk_rules/*.json` → weather conditions with the exact
   numbers the document states.

Set `source_is_placeholder` to `false` only when every source is real.

## 6. Retrieval settings

| Variable | Default | Meaning |
|---|---|---|
| `RAG_RETRIEVAL_MODE` | `hybrid` | `hybrid` (BM25 + embeddings) or `embedding` (v1) |
| `RAG_HYBRID_ALPHA` | `0.6` | weight of the embedding score in the ranking |
| `RAG_MIN_RELEVANCE_SCORE` | `0.35` | **safety gate** on embedding relevance — unchanged from v1; BM25 cannot bypass it |
| `RAG_RERANKER` | `none` | `cross-encoder` re-orders chunks that already passed the gate |
| `FAITHFULNESS_BACKEND` | `nli` | NLI check of each generated sentence (`none` to disable) |
| `FAITHFULNESS_ACTION` | `remove` | `remove` unsupported sentences or only `flag` them |
