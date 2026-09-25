import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "./api";

/**
 * 2-3 yes/no questions (voice + big icon buttons) that separate two close
 * candidates. Each question comes from a cited document; answers update the
 * probabilities on the server (Bayes). "Not sure" changes nothing.
 */
export default function SymptomQuestions({ result, player, onDone, onCancel }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [qset, setQset] = useState(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState(null);
  const [a, b] = (result.top_candidates || []).map((c) => c.class_key);

  useEffect(() => {
    let alive = true;
    api
      .getQuestions(a, b, lang)
      .then((q) => alive && setQset(q))
      .catch(() => alive && setError(t("farmer.questions.unavailable")));
    return () => {
      alive = false;
    };
  }, [a, b, lang, t]);

  const question = qset?.questions?.[idx];
  useEffect(() => {
    if (question && player) player.play([`${lang}.${qset.audio_slug}.${question.id}`]);
  }, [question, qset, lang, player]);

  async function answer(value) {
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    if (idx + 1 < qset.questions.length) {
      setIdx(idx + 1);
      return;
    }
    try {
      const candidates = (result.top_candidates || []).map((c) => ({ class_key: c.class_key, probability: c.probability }));
      const refined = await api.refineDiagnosis(candidates, next);
      onDone(api.applyRefinement(result, refined));
    } catch {
      setError(t("farmer.questions.unavailable"));
    }
  }

  return (
    <main className="fq">
      {error && (
        <p className="farmer__error" role="alert">
          {error}
        </p>
      )}
      {question && (
        <>
          <p className="muted" aria-live="polite">
            {idx + 1} / {qset.questions.length}
          </p>
          <p className="fq__text">{question.text}</p>
          <div className="fq__buttons">
            <button type="button" className="fbtn fq__yes" onClick={() => answer("yes")} aria-label={t("common.yes")}>
              ✔
            </button>
            <button type="button" className="fbtn fq__no" onClick={() => answer("no")} aria-label={t("common.no")}>
              ✖
            </button>
            <button type="button" className="fbtn fq__unsure" onClick={() => answer("unsure")} aria-label={t("common.notSure")}>
              ❔
            </button>
          </div>
        </>
      )}
      <button type="button" className="fbtn fbtn--big" onClick={onCancel}>
        ⬅ {t("common.back")}
      </button>
    </main>
  );
}
