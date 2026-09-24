import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./GradCamView.css";

export default function GradCamView({ originalUrl, gradcamBase64, note }) {
  const { t } = useTranslation();
  const [showOverlay, setShowOverlay] = useState(true);

  return (
    <div className="gradcam">
      <div className="gradcam__header">
        <h3 className="gradcam__title">{t("gradcam.title")}</h3>
        <div className="gradcam__toggle" role="group" aria-label={t("gradcam.toggle")}>
          <button
            className={!showOverlay ? "gradcam__toggle-btn gradcam__toggle-btn--active" : "gradcam__toggle-btn"}
            onClick={() => setShowOverlay(false)}
          >
            {t("gradcam.original")}
          </button>
          <button
            className={showOverlay ? "gradcam__toggle-btn gradcam__toggle-btn--active" : "gradcam__toggle-btn"}
            onClick={() => setShowOverlay(true)}
          >
            {t("gradcam.gradcam")}
          </button>
        </div>
      </div>

      <div className="gradcam__frame">
        <img
          src={showOverlay ? `data:image/png;base64,${gradcamBase64}` : originalUrl}
          alt={showOverlay ? t("gradcam.overlayAlt") : t("gradcam.originalAlt")}
          className="gradcam__image"
        />
      </div>

      <p className="gradcam__caption">{note}</p>
    </div>
  );
}
