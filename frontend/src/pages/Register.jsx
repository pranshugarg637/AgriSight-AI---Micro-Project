import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import LanguagePicker from "../components/LanguagePicker";
import "./AuthForms.css";

const MIN_PASSWORD = 10;

export default function Register() {
  const { t, i18n } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(t("auth.passwordTooShort", { min: MIN_PASSWORD }));
      return;
    }
    setBusy(true);
    try {
      await register({ email, password, preferredLanguage: i18n.language });
      setDone(true);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      setError(err.status === 429 ? t("auth.rateLimited") : t("auth.registerFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <form className="authform" onSubmit={onSubmit} noValidate>
        <LanguagePicker />
        <h1 className="authform__title">{t("auth.registerTitle")}</h1>
        <label>
          {t("auth.email")}
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t("auth.password")}
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="authform__alt">{t("auth.passwordHint", { min: MIN_PASSWORD })}</p>
        {error && (
          <p className="authform__error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="authform__ok" role="status">
            {t("auth.registered")}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? t("common.pleaseWait") : t("auth.register")}
        </button>
        <p className="authform__alt">
          {t("auth.haveAccount")} <Link to="/login">{t("auth.signIn")}</Link> · <Link to="/">{t("common.home")}</Link>
        </p>
      </form>
    </main>
  );
}
