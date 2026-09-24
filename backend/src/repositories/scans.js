import { json, nowIso } from "../db/knex.js";

/** Persist a scan from an ML prediction response. Never stores coordinates or IP. */
export async function recordScan(db, { result, mode, userId = null, plotId = null, imageRef = null, language = "en" }) {
  const [row] = await db("scans")
    .insert({
      user_id: userId,
      plot_id: plotId,
      mode,
      image_ref: imageRef,
      diagnosis: result.diagnosis ?? null,
      crop: result.crop ?? null,
      class_key: result.class_key ?? null,
      confidence: typeof result.confidence === "number" ? result.confidence : null,
      confidence_level: result.confidence_level ?? null,
      unreliable_reason: result.unreliable_reason ?? null,
      alternatives: json.dump(result.alternatives ?? []),
      retrieval_status: result.retrieval_status ?? null,
      sources: json.dump(
        (result.sources ?? []).map((s) => ({ title: s.title, organization: s.organization, page: s.page, source_url: s.source_url }))
      ),
      model_version: result.model_version ?? null,
      language,
      created_at: nowIso(),
    })
    .returning("id");
  return typeof row === "object" ? row.id : row;
}

export function scanFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    disputed: Boolean(row.disputed),
    alternatives: json.load(row.alternatives, []),
    sources: json.load(row.sources, []),
  };
}

export async function getScanForUser(db, scanId, userId) {
  const row = await db("scans").where({ id: scanId, user_id: userId }).first();
  return scanFromRow(row);
}
