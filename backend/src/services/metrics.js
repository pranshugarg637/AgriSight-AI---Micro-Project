/**
 * Monitoring aggregates computed from the scans table (anonymous farmer
 * scans + account scans) and expert-reviewed labels. No personal data.
 */
const day = (iso) => String(iso).slice(0, 10);
function isoWeek(iso) {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const inc = (obj, k, by = 1) => {
  obj[k] = (obj[k] || 0) + by;
};

export function computeMetrics(scans, reviewed = []) {
  const perDay = {};
  const levels = {};
  const reasons = {};
  const retrieval = {};
  const classes = {};
  for (const s of scans) {
    const d = day(s.created_at);
    perDay[d] = perDay[d] || { date: d, farmer: 0, account: 0 };
    perDay[d][s.mode === "farmer" ? "farmer" : "account"] += 1;
    inc(levels, s.confidence_level || "unknown");
    if (s.unreliable_reason) inc(reasons, s.unreliable_reason);
    inc(retrieval, s.retrieval_status || "unknown");
    if (!s.class_key || typeof s.confidence !== "number") continue;
    const c = (classes[s.class_key] = classes[s.class_key] || { class_key: s.class_key, n: 0, sum: 0, lowOrUnreliable: 0, weekly: {}, histogram: Array(10).fill(0) });
    c.n += 1;
    c.sum += s.confidence;
    if (s.confidence_level !== "high") c.lowOrUnreliable += 1;
    c.histogram[Math.min(9, Math.floor(s.confidence * 10))] += 1;
    const w = isoWeek(s.created_at);
    c.weekly[w] = c.weekly[w] || { week: w, n: 0, sum: 0 };
    c.weekly[w].n += 1;
    c.weekly[w].sum += s.confidence;
  }
  const total = scans.length;
  const share = (n) => (total ? n / total : null);

  const perClassReviewed = {};
  let correct = 0;
  for (const r of reviewed) {
    const pc = (perClassReviewed[r.class_key] = perClassReviewed[r.class_key] || { class_key: r.class_key, n: 0, correct: 0 });
    pc.n += 1;
    if (r.model_class_key === r.class_key) {
      pc.correct += 1;
      correct += 1;
    }
  }

  return {
    total_scans: total,
    scans_per_day: Object.values(perDay).sort((a, b) => a.date.localeCompare(b.date)),
    confidence_levels: Object.fromEntries(Object.entries(levels).map(([k, n]) => [k, { n, share: share(n) }])),
    share_low_or_unreliable: share((levels.low || 0) + (levels.unreliable || 0)),
    unreliable_reasons: reasons,
    ood_rejections: (reasons.not_a_leaf || 0) + (reasons.unsupported_crop || 0),
    retrieval_status: retrieval,
    per_class: Object.values(classes)
      .map((c) => ({
        class_key: c.class_key,
        n: c.n,
        mean_confidence: c.sum / c.n,
        share_low_or_unreliable: c.lowOrUnreliable / c.n,
        histogram: c.histogram,
        weekly: Object.values(c.weekly)
          .sort((a, b) => a.week.localeCompare(b.week))
          .map((w) => ({ week: w.week, n: w.n, mean_confidence: w.sum / w.n })),
      }))
      .sort((a, b) => b.n - a.n),
    expert_labels: {
      n_reviewed: reviewed.length,
      accuracy: reviewed.length ? correct / reviewed.length : null,
      per_class: Object.values(perClassReviewed).map((p) => ({ ...p, accuracy: p.correct / p.n })),
      note: "Accuracy against expert-reviewed labels only (a biased sample: mostly low-confidence or disputed scans).",
    },
  };
}
