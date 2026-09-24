import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguagePicker from "../components/LanguagePicker";
import { useAuth } from "../auth/AuthContext";
import "./Landing.css";

export default function Landing() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  return (
    <main className="landing">
      <div className="landing__top">
        <LanguagePicker size="large" />
      </div>
      <h1 className="landing__title">{t("app.name")}</h1>
      <p className="landing__tagline">{t("landing.tagline")}</p>
      <div className="landing__choices">
        <Link to="/farmer" className="landing__choice landing__choice--farmer">
          <span className="landing__icon" aria-hidden="true">🌱</span>
          <span className="landing__choice-title">{t("landing.farmer")}</span>
          <span className="landing__choice-sub">{t("landing.farmerSub")}</span>
        </Link>
        <Link to={isAuthenticated ? "/account" : "/login"} className="landing__choice landing__choice--account">
          <span className="landing__icon" aria-hidden="true">🔑</span>
          <span className="landing__choice-title">{isAuthenticated ? t("landing.openAccount") : t("landing.signIn")}</span>
          <span className="landing__choice-sub">{t("landing.accountSub")}</span>
        </Link>
      </div>
      <p className="landing__disclaimer">{t("app.disclaimer")}</p>
    </main>
  );
}
