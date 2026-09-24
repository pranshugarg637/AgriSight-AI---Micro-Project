import { useState } from "react";
import { useTranslation } from "react-i18next";
import { classSlug } from "./safetyGating";

const BAND_ICON = { green: "✅", amber: "⚠️", red: "❌" };

export default function ResultScreen({ result, gating, bundle, photoUrl, onHelp, onShopkeeper, onQuestions, onRestart }) {
  const { t } = useTranslation();
  const [showHeat, setShowHeat] = useState(false);
  const slug = classSlug(result?.class_key);
  const name = gating.showDisease ? bundle?.classes?.[slug]?.clips?.name || `${result.crop}: ${result.diagnosis}` : null;

  return (
    <div className="fres">
      <div className={`fres__band fres__band--${gating.band}`} role="status">
        <span className="fres__band-icon" aria-hidden="true">
          {BAND_ICON[gating.band]}
        </span>
        <span className="fres__band-text">{t(`farmer.level.${gating.level}`)}</span>
      </div>

      {name && (
        <p className="fres__name">
          {gating.level === "low" && <span className="fres__maybe">{t("farmer.maybe")} </span>}
          {name}
        </p>
      )}
      {!name && <p className="fres__name">{t("farmer.cannotTell")}</p>}

      <div className="fres__photo">
        {photoUrl && !showHeat && <img src={photoUrl} alt={t("farmer.yourPhoto")} />}
        {showHeat && result.gradcam_image_base64 && (
          <img src={`data:image/png;base64,${result.gradcam_image_base64}`} alt={t("gradcam.overlayAlt")} />
        )}
        {result.gradcam_image_base64 && gating.showDisease && (
          <button type="button" className="fbtn fbtn--small" onClick={() => setShowHeat((v) => !v)}>
            {showHeat ? t("farmer.showPhoto") : t("farmer.showHeat")}
          </button>
        )}
      </div>

      <div className="fres__actions">
        {gating.askQuestions && onQuestions && (
          <button type="button" className="fbtn fbtn--big fbtn--primary" onClick={onQuestions}>
            <span aria-hidden="true">❓</span> {t("farmer.answerQuestions")}
          </button>
        )}
        {gating.primaryHelp !== "none" && (
          <button type="button" className="fbtn fbtn--big fbtn--primary" onClick={onHelp}>
            <span aria-hidden="true">🗺️</span> {gating.primaryHelp === "office" ? t("farmer.findOffice") : t("farmer.findHelp")}
          </button>
        )}
        <button type="button" className="fbtn fbtn--big" onClick={onShopkeeper}>
          <span aria-hidden="true">🪪</span> {t("farmer.showShopkeeper")}
        </button>
        <button type="button" className="fbtn fbtn--big" onClick={onRestart}>
          <span aria-hidden="true">🔄</span> {t("farmer.startOver")}
        </button>
      </div>
    </div>
  );
}
