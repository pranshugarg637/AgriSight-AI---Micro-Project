import { useTranslation } from "react-i18next";
import "./PipelineTrail.css";

import { STAGES } from "./pipelineStages";

export default function PipelineTrail({ activeIndex = -1, skipped = [] }) {
  const { t } = useTranslation();
  return (
    <ol className="trail" aria-label={t("pipeline.label")}>
      {STAGES.map((stage, i) => (
        <li
          key={stage}
          className={`trail__tag ${i === activeIndex ? "trail__tag--active" : ""} ${i < activeIndex ? "trail__tag--done" : ""} ${
            skipped.includes(stage) ? "trail__tag--skipped" : ""
          }`}
        >
          <span className="trail__index mono">{String(i + 1).padStart(2, "0")}</span>
          <span>{t(`pipeline.${stage}`)}</span>
        </li>
      ))}
    </ol>
  );
}
