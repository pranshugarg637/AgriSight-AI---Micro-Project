# knowledge_base/risk_rules/

One JSON rule per disease. The backend risk engine
(`backend/src/services/riskEngine.js`) refuses any rule without a
`citation` ({file, page, quote}) and refuses `source_is_placeholder: true`
rules when `ENV=production`.

Only use numbers that literally appear in the cited quote (convert units if
needed and say so in `interpretation_notes`). Conditions: `temperature_c`,
`relative_humidity`, `precipitation_mm` with bounds `min`, `max`, `gt`,
`gte`, `lt`. `min_matching_hours` = hours per day that must match before the
day is shown as "favourable conditions forecast" — only set it above 1 if the
source gives a duration.

The two shipped rules come from the placeholder PDFs (demo only).
A spray-window advisor is intentionally absent: no cited source for
rain/wind thresholds exists yet.
