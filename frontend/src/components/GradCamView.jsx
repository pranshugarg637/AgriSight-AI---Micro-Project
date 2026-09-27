import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./GradCamView.css";

/**
 * Original / Grad-CAM toggle. When the optional lesion-segmentation add-on
 * produced a mask (`lesion` prop), a third "Affected area" view and the
 * estimated severity are shown too; without it this renders exactly as before.
 */
export default function GradCamView({ originalUrl, gradcamBase64, note, lesion = null }) {
  const { t } = useTranslation();
  const [view, setView] = useState(lesion ? "lesion" : "gradcam");

  const views = [
    { key: "original", label: t("gradcam.original") },
    ...(gradcamBase64 ? [{ key: "gradcam", label: t("gradcam.gradcam") }] : []),
    ...(lesion ? [{ key: "lesion", label: t("segmentation.view") }] : []),
  ];

  const src =
    view === "gradcam" && gradcamBase64
      ? `data:image/png;base64,${gradcamBase64}`
      : view === "lesion" && lesion
      ? `data:image/png;base64,${lesion.maskBase64}`
      : originalUrl;
  const alt =
    view === "gradcam" ? t("gradcam.overlayAlt") : view === "lesion" ? t("segmentation.overlayAlt") : t("gradcam.originalAlt");

  return (
    <div className="gradcam">
      <div className="gradcam__header">
        <h3 className="gradcam__title">{t("gradcam.title")}</h3>
        <div className="gradcam__toggle" role="group" aria-label={t("gradcam.toggle")}>
          {views.map((v) => (
            <button
              key={v.key}
              className={view === v.key ? "gradcam__toggle-btn gradcam__toggle-btn--active" : "gradcam__toggle-btn"}
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gradcam__frame">
        <img src={src} alt={alt} className="gradcam__image" />
      </div>

      {view !== "lesion" && <p className="gradcam__caption">{note}</p>}

      {lesion && (
        <div className="gradcam__severity" data-testid="affected-area">
          <h4 className="gradcam__severity-title">{t("segmentation.title")}</h4>
          <p className="gradcam__severity-value">
            {lesion.severityPercent == null
              ? t("segmentation.noPercent")
              : t("segmentation.percent", {
                  percent: lesion.severityPercent,
                  band: t(`segmentation.band.${lesion.severityBand}`),
                })}
          </p>
          <p className="gradcam__caption">{lesion.note}</p>
        </div>
      )}
    </div>
  );
}
