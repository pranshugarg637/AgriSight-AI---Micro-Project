# data/help_centers/ — curated agriculture offices & KVKs

**Intentionally empty of real entries.** Nothing here may be invented.

The Farmer-Mode help finder uses these files as the *primary* suggestion for
low-confidence / unreliable results and as the fallback when no shop is
found. Until you add files, the app says it has no office list for the area.

## How to fill it (see also docs/HUMAN_TODO.md)

1. Pick a state, e.g. Uttar Pradesh → create `uttar_pradesh.json` (lower-case,
   underscores) by copying `_template.example.json`.
2. Copy entries **only from official directories**, for example the Krishi
   Vigyan Kendra list on the ICAR / ATARI KVK portal, or the state agriculture
   department's district office list.
3. For each entry fill `name`, `type` (`kvk`, `agriculture_office`,
   `helpline`, `other`), `district`, `address`, `phone`, and — if the
   directory gives them — `lat`/`lng` (needed for "nearest to me").
4. Always fill `source_url` (the exact page) and `verified_on` (today's date,
   `YYYY-MM-DD`). Entries without both are rejected at startup (a warning is
   logged).
5. Restart the backend. Check: `GET /api/farmer/help-centers/index`.

Re-verify phone numbers periodically; update `verified_on` when you do.
