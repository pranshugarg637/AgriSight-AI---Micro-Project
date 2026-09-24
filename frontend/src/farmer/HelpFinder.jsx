import { useTranslation } from "react-i18next";

// Placeholder: the nearby help finder is implemented in Step 4.
export default function HelpFinder({ onBack }) {
  const { t } = useTranslation();
  return (
    <main className="fhelp">
      <button type="button" className="fbtn fbtn--big" onClick={onBack}>
        ⬅ {t("common.back")}
      </button>
    </main>
  );
}
