import "./ExplanationSections.css";

// Splits the LLM's response on "## Heading" markers into { heading, body } pairs.
function parseSections(text) {
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

export default function ExplanationSections({ explanation, retrievalStatus }) {
  if (retrievalStatus === "insufficient_evidence" || retrievalStatus === "knowledge_base_empty") {
    return (
      <div className="explanation explanation--empty">
        <h3 className="explanation__title">Evidence-grounded explanation</h3>
        <p>
          Reliable information could not be found in the agricultural knowledge base for this diagnosis.
          Please consult a qualified agricultural expert before taking action.
        </p>
      </div>
    );
  }

  if (!explanation) {
    return (
      <div className="explanation explanation--empty">
        <h3 className="explanation__title">Evidence-grounded explanation</h3>
        <p>The explanation could not be generated right now. The diagnosis and evidence above are still valid.</p>
      </div>
    );
  }

  const sections = parseSections(explanation);

  if (sections.length === 0) {
    return (
      <div className="explanation">
        <h3 className="explanation__title">Evidence-grounded explanation</h3>
        <p>{explanation}</p>
      </div>
    );
  }

  return (
    <div className="explanation">
      <h3 className="explanation__title">Evidence-grounded explanation</h3>
      {sections.map((section, i) => (
        <div
          key={i}
          className={`explanation__section ${section.heading === CAUTION_HEADING ? "explanation__section--caution" : ""}`}
        >
          <h4 className="explanation__heading">{section.heading}</h4>
          <p className="explanation__body">{section.body}</p>
        </div>
      ))}
    </div>
  );
}
