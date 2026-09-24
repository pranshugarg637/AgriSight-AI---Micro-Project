import { useTranslation } from "react-i18next";
import ConfidenceGauge from "./ConfidenceGauge";
import DifferentialList from "./DifferentialList";
import GradCamView from "./GradCamView";
import ExplanationSections from "./ExplanationSections";
import SourcesList from "./SourcesList";
import "./DiagnosisCard.css";

export default function DiagnosisCard({ result, originalPreviewUrl }) {
  const { t, i18n } = useTranslation();
  const {
    diagnosis,
    crop,
    confidence,
    confidence_level: confidenceLevel,
    confidence_message: confidenceMessage,
    alternatives,
    gradcam_image_base64: gradcamBase64,
    gradcam_note: gradcamNote,
    explanation,
    sources,
    retrieval_status: retrievalStatus,
    dataset_disclaimer: datasetDisclaimer,
    explanation_translated: explanationTranslated,
    translation_backend: translationBackend,
    translation_status: translationStatus,
    unreliable_reason: unreliableReason,
  } = result;

  const isUnreliable = confidenceLevel === "unreliable";

  return (
    <div className="diagnosis-card">
      <div className="diagnosis-card__top">
        <div className="diagnosis-card__identity">
          <span className="diagnosis-card__tag">{t("diagnosis.tag")}</span>
          <h2 className="diagnosis-card__name">{isUnreliable ? t("diagnosis.unavailable") : diagnosis}</h2>
          {!isUnreliable && <p className="diagnosis-card__crop">{crop}</p>}
        </div>
        <ConfidenceGauge confidence={confidence} confidenceLevel={confidenceLevel} />
      </div>

      <div
        className={`diagnosis-card__banner diagnosis-card__banner--${confidenceLevel}`}
        role={isUnreliable || confidenceLevel === "low" ? "alert" : undefined}
      >
        {i18n.language !== "en" && <p className="diagnosis-card__localized">{t(`confidence.message.${confidenceLevel}`)}</p>}
        {confidenceMessage}
      </div>

      {isUnreliable ? (
        <p className="diagnosis-card__retry-hint">
          {unreliableReason === "not_a_leaf"
            ? t("diagnosis.notALeaf")
            : unreliableReason === "unsupported_crop"
            ? t("diagnosis.unsupportedCrop")
            : t("diagnosis.retryHint")}
        </p>
      ) : (
        <>
          {alternatives && alternatives.length > 0 && (
            <section className="diagnosis-card__section">
              <DifferentialList primary={{ crop, disease: diagnosis, confidence }} alternatives={alternatives} />
            </section>
          )}

          {gradcamBase64 && (
            <section className="diagnosis-card__section">
              <GradCamView originalUrl={originalPreviewUrl} gradcamBase64={gradcamBase64} note={gradcamNote} />
            </section>
          )}

          <section className="diagnosis-card__section">
            <ExplanationSections
              explanation={explanation}
              retrievalStatus={retrievalStatus}
              translated={explanationTranslated}
              translationBackend={translationBackend}
              translationStatus={translationStatus}
            />
          </section>

          <section className="diagnosis-card__section">
            <SourcesList sources={sources} retrievalStatus={retrievalStatus} />
          </section>
        </>
      )}

      <p className="diagnosis-card__disclaimer">{datasetDisclaimer}</p>
    </div>
  );
}
