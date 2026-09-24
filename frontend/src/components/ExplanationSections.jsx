import { useTranslation } from "react-i18next";
import "./ExplanationSections.css";

// Splits the LLM's response on "## Heading" markers into { heading, body } pairs.
// eslint-disable-next-line react-refresh/only-export-components
export function parseSections(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(.*)/);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() }));
}

const CAUTION_HEADING = "Important caution";

function SectionList({ text, cautionIndex }) {
  const sections = parseSections(text);
  if (sections.length === 0) return <p>{text}</p>;
  return sections.map((section, i) => (
    <div
      key={i}
      className={`explanation__section ${
        section.heading === CAUTION_HEADING || i === cautionIndex ? "explanation__section--caution" : ""
      }`}
    >
      <h4 className="explanation__heading">{section.heading}</h4>
      <p className="explanation__body">{section.body}</p>
    </div>
  ));
}

/**
 * Shows the English, evidence-grounded explanation. When a translation is
 * present it is shown side by side with the English source of truth so a
 * reviewer can compare them (translations are machine-generated).
 */
export default function ExplanationSections({ explanation, retrievalStatus, translated, translationBackend, translationStatus }) {
  const { t } = useTranslation();
  const title = <h3 className="explanation__title">{t("explanation.title")}</h3>;

  if (retrievalStatus === "insufficient_evidence" || retrievalStatus === "knowledge_base_empty") {
    return (
      <div className="explanation explanation--empty">
        {title}
        <p>{t("explanation.noEvidence")}</p>
      </div>
    );
  }

  if (!explanation) {
    return (
      <div className="explanation explanation--empty">
        {title}
        <p>{t("explanation.unavailable")}</p>
      </div>
    );
  }

  const englishSections = parseSections(explanation);
  const cautionIndex = englishSections.findIndex((s) => s.heading === CAUTION_HEADING);

  if (!translated) {
    return (
      <div className="explanation">
        {title}
        {(translationStatus === "unavailable" || translationStatus === "failed") && (
          <p className="explanation__note" role="note">
            {t("explanation.translationUnavailable")}
          </p>
        )}
        <SectionList text={explanation} cautionIndex={cautionIndex} />
      </div>
    );
  }

  return (
    <div className="explanation">
      {title}
      <p className="explanation__note" role="note">
        {t("explanation.machineTranslated", { backend: translationBackend || "?" })}
      </p>
      <div className="explanation__compare">
        <div lang="en" className="explanation__col">
          <h4 className="explanation__lang">{t("explanation.englishOriginal")}</h4>
          <SectionList text={explanation} cautionIndex={cautionIndex} />
        </div>
        <div className="explanation__col">
          <h4 className="explanation__lang">{t("explanation.translation")}</h4>
          <SectionList text={translated} cautionIndex={cautionIndex} />
        </div>
      </div>
    </div>
  );
}
