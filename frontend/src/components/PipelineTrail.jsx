import "./PipelineTrail.css";

const STAGES = ["Upload", "Classify", "Explain", "Verify"];

export default function PipelineTrail({ activeIndex = -1 }) {
  return (
    <ol className="trail" aria-label="Diagnostic pipeline stages">
      {STAGES.map((stage, i) => (
        <li
          key={stage}
          className={`trail__tag ${i === activeIndex ? "trail__tag--active" : ""} ${i < activeIndex ? "trail__tag--done" : ""}`}
        >
          <span className="trail__index mono">{String(i + 1).padStart(2, "0")}</span>
          <span>{stage}</span>
        </li>
      ))}
    </ol>
  );
}
