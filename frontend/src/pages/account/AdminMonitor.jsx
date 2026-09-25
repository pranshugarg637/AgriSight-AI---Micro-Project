import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/account";

const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/** Monitoring for admins: volume, confidence mix, OOD, retrieval, per-class confidence, expert accuracy. */
export default function AdminMonitor() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getAdminMetrics(days)
      .then(setM)
      .catch(() => setError(t("account.loadFailed")));
  }, [days, t]);

  if (error) return <main className="acct-page" role="alert">{error}</main>;
  if (!m) return <main className="acct-page">{t("common.loading")}</main>;
  const maxDay = Math.max(1, ...m.scans_per_day.map((d) => d.farmer + d.account));

  return (
    <main className="acct-page">
      <h1>{t("nav.admin")}</h1>
      <label className="muted">
        {t("monitor.window")}{" "}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {t("monitor.days", { count: d })}
            </option>
          ))}
        </select>
      </label>

      <div className="stat-row">
        <div className="stat">
          <span className="stat__value">{m.total_scans}</span>
          <span className="stat__label">{t("monitor.scans")}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{pct(m.share_low_or_unreliable)}</span>
          <span className="stat__label">{t("monitor.lowOrUnreliable")}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{m.ood_rejections}</span>
          <span className="stat__label">{t("monitor.ood")}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{pct(m.expert_labels.accuracy)}</span>
          <span className="stat__label">
            {t("monitor.expertAccuracy")} (n={m.expert_labels.n_reviewed})
          </span>
        </div>
      </div>

      <section className="acct-card">
        <h2>{t("monitor.perDay")}</h2>
        <div className="daybars" role="img" aria-label={t("monitor.perDay")}>
          {m.scans_per_day.map((d) => (
            <div key={d.date} className="daybars__col" title={`${d.date}: ${d.farmer} farmer, ${d.account} account`}>
              <div className="daybars__bar" style={{ height: `${((d.farmer + d.account) / maxDay) * 100}%` }} />
            </div>
          ))}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t("risk.day")}</th>
              <th>{t("monitor.farmer")}</th>
              <th>{t("monitor.account")}</th>
            </tr>
          </thead>
          <tbody>
            {m.scans_per_day.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.farmer}</td>
                <td>{d.account}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="acct-card">
        <h2>{t("monitor.mix")}</h2>
        <table className="table">
          <tbody>
            {Object.entries(m.confidence_levels).map(([k, v]) => (
              <tr key={k}>
                <td>
                  <span className={`badge badge--${k}`}>{t(`confidence.${k}`, k)}</span>
                </td>
                <td>
                  {v.n} ({pct(v.share)})
                </td>
              </tr>
            ))}
            {Object.entries(m.unreliable_reasons).map(([k, n]) => (
              <tr key={k}>
                <td>unreliable_reason = {k}</td>
                <td>{n}</td>
              </tr>
            ))}
            {Object.entries(m.retrieval_status).map(([k, n]) => (
              <tr key={k}>
                <td>retrieval_status = {k}</td>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="acct-card">
        <h2>{t("monitor.perClass")}</h2>
        <table className="table">
          <thead>
            <tr>
              <th>{t("monitor.class")}</th>
              <th>n</th>
              <th>{t("monitor.meanConfidence")}</th>
              <th>{t("monitor.lowOrUnreliable")}</th>
              <th>{t("monitor.weekly")}</th>
            </tr>
          </thead>
          <tbody>
            {m.per_class.map((c) => (
              <tr key={c.class_key}>
                <td>{c.class_key}</td>
                <td>{c.n}</td>
                <td>{pct(c.mean_confidence)}</td>
                <td>{pct(c.share_low_or_unreliable)}</td>
                <td className="muted">{c.weekly.map((w) => `${w.week}: ${pct(w.mean_confidence)} (n=${w.n})`).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">{m.expert_labels.note}</p>
      </section>
    </main>
  );
}
