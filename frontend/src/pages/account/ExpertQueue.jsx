import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/account";
import ProtectedImage from "../../components/ProtectedImage";

export default function ExpertQueue() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState(null);
  const [labels, setLabels] = useState({});
  const [error, setError] = useState(null);

  const load = () =>
    api
      .getExpertQueue()
      .then((r) => setQueue(r.queue))
      .catch(() => setError(t("account.loadFailed")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function review(scan, decision) {
    const body = decision === "confirm" ? { decision } : { decision, corrected_class_key: labels[scan.id] };
    try {
      await api.reviewScan(scan.id, body);
      load();
    } catch {
      setError(t("account.saveFailed"));
    }
  }

  return (
    <main className="acct-page">
      <h1>{t("nav.expert")}</h1>
      <p className="muted">{t("expert.explain")}</p>
      {error && <p role="alert">{error}</p>}
      {queue && queue.length === 0 && <p>{t("expert.empty")}</p>}
      {queue?.map((s) => (
        <article key={s.id} className="acct-card expert-item">
          <div className="expert-item__images">
            {s.has_image && <ProtectedImage path={`/api/v2/expert/scans/${s.id}/image`} alt={t("farmer.yourPhoto")} className="timeline__thumb" />}
            {s.has_gradcam && <ProtectedImage path={`/api/v2/expert/scans/${s.id}/image?kind=gradcam`} alt="Grad-CAM" className="timeline__thumb" />}
          </div>
          <div>
            <strong>
              #{s.id} {s.crop}: {s.diagnosis}
            </strong>{" "}
            <span className={`badge badge--${s.confidence_level}`}>{Math.round((s.confidence || 0) * 100)}%</span>
            {s.disputed && <span className="badge badge--unreliable">{t("plots.disputed")}</span>}
            <div className="muted">
              {t("differential.title")}: {s.alternatives.map((a) => `${a.disease} ${Math.round(a.confidence * 100)}%`).join(", ") || "—"}
            </div>
            <div className="muted">
              {t("sources.title")}: {s.sources.map((x) => `${x.title} (${x.organization}${x.page ? `, p.${x.page}` : ""})`).join("; ") || "—"} ·{" "}
              {s.retrieval_status}
            </div>
            <div className="expert-item__actions">
              <button className="btn" onClick={() => review(s, "confirm")} disabled={!s.class_key}>
                {t("expert.confirm")}
              </button>
              <input
                aria-label={t("expert.correctLabel")}
                placeholder="Tomato___Early_blight"
                value={labels[s.id] || ""}
                onChange={(e) => setLabels({ ...labels, [s.id]: e.target.value })}
              />
              <button className="btn btn--ghost" onClick={() => review(s, "correct")} disabled={!labels[s.id]}>
                {t("expert.correct")}
              </button>
            </div>
          </div>
        </article>
      ))}
    </main>
  );
}
