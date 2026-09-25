import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as api from "../../api/account";
import ProtectedImage from "../../components/ProtectedImage";
import RiskPanel from "./RiskPanel";

const ACTIONS = ["sprayed", "removed_leaves", "did_nothing", "other"];

export default function PlotDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    () =>
      api
        .getTimeline(id)
        .then(setData)
        .catch(() => setError(t("account.loadFailed"))),
    [id, t]
  );
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <main className="acct-page" role="alert">{error}</main>;
  if (!data) return <main className="acct-page">{t("common.loading")}</main>;
  const { plot, timeline } = data;

  return (
    <main className="acct-page">
      <p>
        <Link to="/account/plots">← {t("nav.plots")}</Link>
      </p>
      <h1>{plot.name}</h1>
      <p className="muted">{[plot.crop, plot.location_label, plot.sowing_date].filter(Boolean).join(" · ")}</p>
      <button className="btn" onClick={() => navigate(`/account?plot=${plot.id}`)}>
        {t("plots.newScan")}
      </button>

      <RiskPanel plot={plot} />

      <h2>{t("plots.timeline")}</h2>
      {timeline.length === 0 && <p className="muted">{t("plots.noScans")}</p>}
      <ol className="timeline">
        {timeline.map((s) => (
          <li key={s.id} className="acct-card">
            <div className="timeline__head">
              {s.has_image && <ProtectedImage path={`/api/v2/scans/${s.id}/image`} alt="" className="timeline__thumb" />}
              <div>
                <strong>{s.confidence_level === "unreliable" ? t("diagnosis.unavailable") : `${s.crop}: ${s.diagnosis}`}</strong>{" "}
                <span className={`badge badge--${s.confidence_level}`}>{t(`confidence.${s.confidence_level}`)}</span>
                <div className="muted">
                  {new Date(s.created_at).toLocaleString()} · {Math.round((s.confidence || 0) * 100)}%
                </div>
                {s.followup && (
                  <div>
                    {t("plots.followup")}: <strong>{t(`plots.outcome.${s.followup.outcome}`)}</strong>{" "}
                    <span className="muted">({t("plots.indicative")})</span>
                  </div>
                )}
                {s.expert_label && (
                  <div>
                    {t("plots.expertLabel")}: <strong>{s.expert_label.replace("___", ": ").replace(/_/g, " ")}</strong>
                  </div>
                )}
                {s.actions.map((a) => (
                  <div key={a.id} className="muted">
                    ✔ {t(`plots.action.${a.action_type}`)} {a.note ? `— ${a.note}` : ""} · {t("plots.rescanOn")}{" "}
                    {new Date(a.remind_at).toLocaleDateString()}
                  </div>
                ))}
              </div>
            </div>
            <div className="timeline__actions">
              <select
                aria-label={t("plots.logAction")}
                defaultValue=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  await api.logAction(s.id, { action_type: e.target.value, remind_in_days: 7 });
                  e.target.value = "";
                  load();
                }}
              >
                <option value="">{t("plots.logAction")}…</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t(`plots.action.${a}`)}
                  </option>
                ))}
              </select>
              <button className="btn btn--ghost" onClick={() => navigate(`/account?plot=${plot.id}&followup=${s.id}`)}>
                {t("plots.rescan")}
              </button>
              <button
                className="btn btn--ghost"
                onClick={async () => {
                  await api.disputeScan(s.id);
                  load();
                }}
                disabled={s.disputed}
              >
                {s.disputed ? t("plots.disputed") : t("plots.dispute")}
              </button>
              <button
                className="btn btn--danger"
                onClick={async () => {
                  if (!window.confirm(t("plots.confirmDelete"))) return;
                  await api.deleteScan(s.id);
                  load();
                }}
              >
                {t("common.delete")}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
