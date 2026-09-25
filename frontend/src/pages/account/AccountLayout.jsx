import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { getReminders } from "../../api/account";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import LanguagePicker from "../../components/LanguagePicker";
import "./AccountLayout.css";

export default function AccountLayout() {
  const { t } = useTranslation();
  const { user, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const isExpert = user && (user.role === "expert" || user.role === "admin");
  const isAdmin = user && user.role === "admin";
  const [reminders, setReminders] = useState([]);
  useEffect(() => {
    getReminders()
      .then((r) => setReminders(r?.reminders || []))
      .catch(() => setReminders([]));
  }, []);

  return (
    <div className="acct">
      <nav className="acct__nav" aria-label={t("nav.account")}>
        <NavLink to="/" className="acct__brand">
          {t("app.name")}
        </NavLink>
        <NavLink to="/account" end>
          {t("nav.diagnose")}
        </NavLink>
        <NavLink to="/account/plots">{t("nav.plots")}</NavLink>
        {isExpert && <NavLink to="/account/expert">{t("nav.expert")}</NavLink>}
        {isAdmin && <NavLink to="/account/admin">{t("nav.admin")}</NavLink>}
        <NavLink to="/account/settings">{t("nav.settings")}</NavLink>
        <span className="acct__spacer" />
        <LanguagePicker onChange={(code) => updateProfile({ preferred_language: code }).catch(() => {})} />
        <span className="acct__who" title={user?.email}>
          {user?.email}
        </span>
        <button
          type="button"
          className="acct__logout"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
        >
          {t("auth.logout")}
        </button>
      </nav>
      {reminders.length > 0 && (
        <div className="reminder-bar" role="status">
          🔔 {t("reminders.due", { count: reminders.length })}{" "}
          {reminders.slice(0, 3).map((r) => (
            <Link key={r.action_id} to={`/account?plot=${r.plot_id}&followup=${r.scan_id}`}>
              {r.plot_name}: {r.diagnosis}
            </Link>
          ))}
        </div>
      )}
      <Outlet />
    </div>
  );
}
