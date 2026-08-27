import "./DifferentialList.css";

export default function DifferentialList({ primary, alternatives }) {
  if (!alternatives || alternatives.length === 0) return null;

  const rows = [
    { crop: primary.crop, disease: primary.disease, confidence: primary.confidence, isPrimary: true },
    ...alternatives.map((a) => ({ ...a, isPrimary: false })),
  ];

  return (
    <div className="differential">
      <h3 className="differential__title">Differential diagnosis</h3>
      <p className="differential__note">Other conditions the model weighed before settling on its top prediction.</p>
      <ul className="differential__list">
        {rows.map((row, i) => (
          <li key={i} className="differential__row">
            <span className="differential__label">
              {row.disease}
              {row.isPrimary && <span className="differential__badge">Primary</span>}
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
