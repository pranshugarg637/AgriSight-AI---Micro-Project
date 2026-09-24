import { useState } from "react";
import { useTranslation } from "react-i18next";
import UploadPanel from "../../components/UploadPanel";
import DiagnosisCard from "../../components/DiagnosisCard";
import PipelineTrail from "../../components/PipelineTrail";
import { predictDisease, ApiError } from "../../api/client";
import "./DiagnosePage.css";

const STAGE = { IDLE: -1, UPLOAD: 0, CLASSIFY: 1, EXPLAIN: 2, VERIFY: 3 };

export default function DiagnosePage() {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [activeStage, setActiveStage] = useState(STAGE.IDLE);

  async function handleAnalyze(file) {
    setError(null);
    setResult(null);
    setIsAnalyzing(true);
    setActiveStage(STAGE.CLASSIFY);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    try {
      // Stage progression is illustrative of the pipeline; the actual work
      // happens server-side across classify -> explain -> verify.
      const stageTimer = setTimeout(() => setActiveStage(STAGE.EXPLAIN), 600);
      const data = await predictDisease(file, { language: i18n.language });
      clearTimeout(stageTimer);
      setActiveStage(STAGE.VERIFY);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t("diagnose.networkError"));
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__brand">
            <span className="app__brand-mark" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                <path
                  d="M20 32C12 29 8 21 9.5 12c8-2.5 16 1 18.5 9 1.8 5.6-1.3 10-5 10-1.8 0-3.5-1.2-3.5-3.6 0-5 3.5-8.7 7.5-10"
                  stroke="var(--confidence-high)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </span>
            <div>
              <h1 className="app__title">{t("diagnose.title")}</h1>
              <p className="app__subtitle">{t("diagnose.subtitle")}</p>
            </div>
          </div>
          <PipelineTrail activeIndex={activeStage} />
        </div>
      </header>

      <main className="app__main">
        <div className="app__grid">
          <UploadPanel onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />

          <div className="app__result-slot">
            {isAnalyzing && (
              <div className="app__loading" role="status">
                <div className="app__loading-spinner" aria-hidden="true" />
                <p>{t("diagnose.running")}</p>
              </div>
            )}

            {error && !isAnalyzing && (
              <div className="app__error" role="alert">
                <strong>{t("diagnose.failed")}</strong>
                <p>{error}</p>
              </div>
            )}

            {result && !isAnalyzing && <DiagnosisCard result={result} originalPreviewUrl={previewUrl} />}

            {!result && !isAnalyzing && !error && (
              <div className="app__empty">
                <p>{t("diagnose.empty")}</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="app__footer">
        <p>{t("app.disclaimer")}</p>
      </footer>
    </div>
  );
}
