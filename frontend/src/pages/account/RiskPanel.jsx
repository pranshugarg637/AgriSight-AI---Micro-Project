import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/account";

/** Weather "risk indicator" (rules from cited documents -- not a prediction). */
export default function RiskPanel({ plot }) {
  const { t } = useTranslation();
  const [risk, setRisk] = useState(null);
  const [error, setError] = useState(null);

  async function check(useLocation) {
    setError(null);
    try {
      let coords = null;
      if (useLocation) {
        coords = await new Promise((resolve, reject) =>
          navigator.geolocation
            ? navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), reject, { timeout: 15000 })
            : reject(new Error("unsupported"))
        );
      }
      setRisk(await api.getRisk(plot.id, coords));
    } catch (err) {
      setError(err?.status === 422 ? t("risk.needLocation") : t("risk.failed"));
    }
  }

  return (
    <section className="acct-card" aria-label={t("risk.title")}>
      <h2>{t("risk.title")}</h2>
      <p className="muted">{t("risk.explain")}</p>
      <button className="btn" onClick={() => check(plot.lat == null)}>
        {plot.lat == null ? t("risk.checkWithLocation") : t("risk.check")}
      </button>
      {error && <p role="alert">{error}</p>}
      {risk && (
        <div>
          <p className="muted">{risk.disclaimer}</p>
          {!risk.weather_available && <p role="alert">{t("risk.weatherDown")}</p>}
          {risk.rules_available === 0 && <p>{t("risk.noRules")}</p>}
          {risk.results.map((r) => (
            <div key={r.rule_id} className="risk-rule">
              <h3>
                {r.class_key.replace("___", ": ").replace(/_/g, " ")}{" "}
                {r.source_is_placeholder && <span className="badge badge--low">{t("risk.placeholder")}</span>}
              </h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("risk.day")}</th>
                    <th>{t("risk.matchingHours")}</th>
                    <th>{t("risk.indicator")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>
                        {d.matching_hours} / {d.hours}
                      </td>
                      <td>
                        <span className={`badge ${d.level === "favourable_conditions_forecast" ? "badge--low" : "badge--high"}`}>
                          {t(`risk.level.${d.level}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                {t("risk.rule")}: {r.description} — “{r.citation.quote}” ({r.citation.file}, p. {r.citation.page})
              </p>
              {r.interpretation_notes && <p className="muted">{r.interpretation_notes}</p>}
            </div>
          ))}
          {risk.weather_source && <p className="muted">{risk.weather_source}</p>}
        </div>
      )}
    </section>
  );
}
