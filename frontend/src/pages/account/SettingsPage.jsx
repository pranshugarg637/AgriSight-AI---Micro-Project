import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateProfile, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [msg, setMsg] = useState(null);

  return (
    <main className="acct-page">
      <h1>{t("nav.settings")}</h1>
      <section className="acct-card">
        <h2>{t("settings.locationTitle")}</h2>
        <p className="muted">{t("settings.locationExplain")}</p>
        <label>
          <input
            type="checkbox"
            checked={Boolean(user?.store_location_opt_in)}
            onChange={async (e) => {
              await updateProfile({ store_location_opt_in: e.target.checked });
              setMsg(t("settings.saved"));
            }}
          />{" "}
          {t("settings.locationOptIn")}
        </label>
      </section>
      <section className="acct-card">
        <h2>{t("settings.deleteTitle")}</h2>
        <p className="muted">{t("settings.deleteExplain")}</p>
        <button
          className="btn btn--danger"
          onClick={async () => {
            if (!window.confirm(t("settings.deleteConfirm"))) return;
            await deleteAccount();
            navigate("/");
          }}
        >
          {t("settings.deleteButton")}
        </button>
      </section>
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
