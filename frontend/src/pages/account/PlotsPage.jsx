import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as api from "../../api/account";
import { useAuth } from "../../auth/AuthContext";

export default function PlotsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [plots, setPlots] = useState([]);
  const [form, setForm] = useState({ name: "", crop: "", sowing_date: "", location_label: "" });
  const [error, setError] = useState(null);

  const load = () =>
    api
      .listPlots()
      .then((r) => setPlots(r.plots))
      .catch(() => setError(t("account.loadFailed")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      await api.createPlot(body);
      setForm({ name: "", crop: "", sowing_date: "", location_label: "" });
      load();
    } catch {
      setError(t("account.saveFailed"));
    }
  }

  return (
    <main className="acct-page">
      <h1>{t("nav.plots")}</h1>
      <form className="acct-card acct-form" onSubmit={add}>
        <label>
          {t("plots.name")}
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          {t("plots.crop")}
          <input value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })} placeholder="Tomato" />
        </label>
        <label>
          {t("plots.sowingDate")}
          <input type="date" value={form.sowing_date} onChange={(e) => setForm({ ...form, sowing_date: e.target.value })} />
        </label>
        <label>
          {t("plots.location")}
          <input value={form.location_label} onChange={(e) => setForm({ ...form, location_label: e.target.value })} />
        </label>
        <button className="btn" type="submit">
          {t("plots.add")}
        </button>
      </form>
      {!user?.store_location_opt_in && <p className="muted">{t("plots.noCoordsNote")}</p>}
      {error && <p role="alert">{error}</p>}
      <ul className="plot-list">
        {plots.map((p) => (
          <li key={p.id} className="acct-card">
            <Link to={`/account/plots/${p.id}`}>
              <strong>{p.name}</strong>
            </Link>{" "}
            <span className="muted">
              {[p.crop, p.location_label, p.sowing_date].filter(Boolean).join(" · ")} · {t("plots.scans", { count: p.scan_count })}
            </span>
          </li>
        ))}
      </ul>
      {plots.length === 0 && <p className="muted">{t("plots.empty")}</p>}
    </main>
  );
}
