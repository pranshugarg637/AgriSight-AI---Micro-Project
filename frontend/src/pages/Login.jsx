import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { changeLanguage } from "../i18n";
import LanguagePicker from "../components/LanguagePicker";
import "./AuthForms.css";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login({ email, password });
      if (user?.preferred_language) await changeLanguage(user.preferred_language);
      navigate(location.state?.from || "/account", { replace: true });
    } catch (err) {
      setError(err.status === 429 ? t("auth.rateLimited") : t("auth.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <form className="authform" onSubmit={onSubmit} noValidate>
        <LanguagePicker />
        <h1 className="authform__title">{t("auth.signInTitle")}</h1>
        <label>
          {t("auth.email")}
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t("auth.password")}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="authform__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? t("common.pleaseWait") : t("auth.signIn")}
        </button>
        <p className="authform__alt">
          {t("auth.noAccount")} <Link to="/register">{t("auth.register")}</Link> · <Link to="/">{t("common.home")}</Link>
        </p>
      </form>
    </main>
  );
}
