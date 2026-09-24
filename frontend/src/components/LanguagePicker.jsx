import { useTranslation } from "react-i18next";
import { LANGUAGES, changeLanguage } from "../i18n";
import "./LanguagePicker.css";

/** Each language is shown in its own script ("हिन्दी", not "Hindi"). */
export default function LanguagePicker({ onChange, size = "normal" }) {
  const { i18n, t } = useTranslation();
  return (
    <div className={`langpick langpick--${size}`} role="group" aria-label={t("language.choose")}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          dir={l.dir}
          className={`langpick__btn ${i18n.language === l.code ? "langpick__btn--active" : ""}`}
          aria-pressed={i18n.language === l.code}
          onClick={async () => {
            await changeLanguage(l.code);
            onChange?.(l.code);
          }}
        >
          {l.nativeName}
        </button>
      ))}
    </div>
  );
}
