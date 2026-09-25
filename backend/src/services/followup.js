/**
 * Follow-up comparison between a scan and a later re-scan of the same plot.
 * INDICATIVE ONLY: a photo-level model output, not a field assessment.
 *
 *  - either scan unreliable                 -> inconclusive
 *  - diseased -> healthy                    -> improved
 *  - healthy  -> diseased                   -> worse
 *  - same disease, confidence down >= delta -> improved
 *  - same disease, confidence up   >= delta -> worse
 *  - same class otherwise                   -> same
 *  - different disease                      -> inconclusive
 */
export const CONFIDENCE_DELTA = 0.15;

const isHealthy = (k) => /___healthy$/i.test(String(k || ""));

export function compareScans(prev, next, delta = CONFIDENCE_DELTA) {
  const basis = {
    previous: { class_key: prev.class_key, confidence: prev.confidence, confidence_level: prev.confidence_level },
    current: { class_key: next.class_key, confidence: next.confidence, confidence_level: next.confidence_level },
    note: "Indicative comparison of two photos; not proof of treatment effect.",
  };
  if (prev.confidence_level === "unreliable" || next.confidence_level === "unreliable") {
    return { outcome: "inconclusive", basis: { ...basis, reason: "one of the scans is unreliable" } };
  }
  const ph = isHealthy(prev.class_key);
  const nh = isHealthy(next.class_key);
  if (!ph && nh) return { outcome: "improved", basis: { ...basis, reason: "now classified healthy" } };
  if (ph && !nh) return { outcome: "worse", basis: { ...basis, reason: "now classified diseased" } };
  if (prev.class_key !== next.class_key) {
    return { outcome: "inconclusive", basis: { ...basis, reason: "different disease predicted" } };
  }
  if (ph && nh) return { outcome: "same", basis: { ...basis, reason: "healthy both times" } };
  const d = (next.confidence ?? 0) - (prev.confidence ?? 0);
  if (d <= -delta) return { outcome: "improved", basis: { ...basis, reason: `disease confidence fell by ${Math.abs(d).toFixed(2)}` } };
  if (d >= delta) return { outcome: "worse", basis: { ...basis, reason: `disease confidence rose by ${d.toFixed(2)}` } };
  return { outcome: "same", basis: { ...basis, reason: "same disease, similar confidence" } };
}
