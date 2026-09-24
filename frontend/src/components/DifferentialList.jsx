import { useTranslation } from "react-i18next";
import "./DifferentialList.css";

export default function DifferentialList({ primary, alternatives }) {
  const { t } = useTranslation();
  if (!alternatives || alternatives.length === 0) return null;

  const rows = [
    { crop: primary.crop, disease: primary.disease, confidence: primary.confidence, isPrimary: true },
    ...alternatives.map((a) => ({ ...a, isPrimary: false })),
  ];

  return (
    <div className="differential">
      <h3 className="differential__title">{t("differential.title")}</h3>
      <p className="differential__note">{t("differential.note")}</p>
      <ul className="differential__list">
        {rows.map((row, i) => (
          <li key={i} className="differential__row">
            <span className="differential__label">
              {row.disease}
              {row.isPrimary && <span className="differential__badge">{t("differential.primary")}</span>}
            </span>
            <div className="differential__bar-track">
              <div
                className={`differential__bar-fill ${row.isPrimary ? "differential__bar-fill--primary" : ""}`}
                style={{ width: `${Math.round(row.confidence * 100)}%` }}
              />
            </div>
            <span className="differential__percent mono">{Math.round(row.confidence * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
