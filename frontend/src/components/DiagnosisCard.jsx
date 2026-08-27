import ConfidenceGauge from "./ConfidenceGauge";
import DifferentialList from "./DifferentialList";
import GradCamView from "./GradCamView";
import ExplanationSections from "./ExplanationSections";
import SourcesList from "./SourcesList";
import "./DiagnosisCard.css";

export default function DiagnosisCard({ result, originalPreviewUrl }) {
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
  } = result;

  const isUnreliable = confidenceLevel === "unreliable";

  return (
    <div className="diagnosis-card">
      <div className="diagnosis-card__top">
        <div className="diagnosis-card__identity">
          <span className="diagnosis-card__tag">Diagnostic record</span>
          <h2 className="diagnosis-card__name">{isUnreliable ? "Diagnosis unavailable" : diagnosis}</h2>
          {!isUnreliable && <p className="diagnosis-card__crop">{crop}</p>}
        </div>
        <ConfidenceGauge confidence={confidence} confidenceLevel={confidenceLevel} />
      </div>

      <div
        className={`diagnosis-card__banner diagnosis-card__banner--${confidenceLevel}`}
        role={isUnreliable || confidenceLevel === "low" ? "alert" : undefined}
      >
        {confidenceMessage}
      </div>

      {isUnreliable ? (
        <p className="diagnosis-card__retry-hint">
          Try again with a photo taken in good light, with the affected leaf filling most of the frame and in sharp focus.
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
            <ExplanationSections explanation={explanation} retrievalStatus={retrievalStatus} />
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
