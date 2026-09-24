import { useTranslation } from "react-i18next";
import "./PipelineTrail.css";

const STAGES = ["upload", "classify", "explain", "verify"];

export default function PipelineTrail({ activeIndex = -1 }) {
  const { t } = useTranslation();
  return (
    <ol className="trail" aria-label={t("pipeline.label")}>
      {STAGES.map((stage, i) => (
        <li
          key={stage}
          className={`trail__tag ${i === activeIndex ? "trail__tag--active" : ""} ${i < activeIndex ? "trail__tag--done" : ""}`}
        >
          <span className="trail__index mono">{String(i + 1).padStart(2, "0")}</span>
          <span>{t(`pipeline.${stage}`)}</span>
        </li>
      ))}
    </ol>
  );
}
