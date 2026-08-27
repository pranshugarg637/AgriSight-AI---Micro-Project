import "./ConfidenceGauge.css";

const ZONES = [
  { key: "unreliable", label: "Unreliable", color: "var(--confidence-unreliable)", start: 0, end: 60 },
  { key: "low", label: "Low", color: "var(--confidence-low)", start: 60, end: 80 },
  { key: "high", label: "High", color: "var(--confidence-high)", start: 80, end: 100 },
];

// Maps a confidence percentage (0-100) to an angle in degrees along a
// semicircle, where 0% = -90deg (left) and 100% = 90deg (right).
function percentToAngle(percent) {
  return -90 + (percent / 100) * 180;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export default function ConfidenceGauge({ confidence, confidenceLevel }) {
  const percent = Math.round(confidence * 100);
  const needleAngle = percentToAngle(percent);
  const cx = 100;
  const cy = 100;
  const r = 78;

  const activeColorVar =
    confidenceLevel === "high"
      ? "var(--confidence-high)"
      : confidenceLevel === "low"
      ? "var(--confidence-low)"
      : "var(--confidence-unreliable)";

  const needleTip = polarToCartesian(cx, cy, r - 14, needleAngle);

  return (
    <div className="gauge" role="img" aria-label={`Confidence gauge showing ${percent} percent, ${confidenceLevel} confidence`}>
      <svg viewBox="0 0 200 118" className="gauge__svg">
        {ZONES.map((zone) => {
          const startAngle = -90 + (zone.start / 100) * 180;
          const endAngle = -90 + (zone.end / 100) * 180;
          return (
            <path
              key={zone.key}
              d={describeArc(cx, cy, r, startAngle, endAngle)}
              stroke={zone.color}
              strokeWidth="10"
              fill="none"
              strokeLinecap="butt"
              opacity="0.85"
            />
          );
        })}

        {/* Tick marks at 0 / 60 / 80 / 100 to mark threshold boundaries */}
        {[0, 60, 80, 100].map((tick) => {
          const angle = -90 + (tick / 100) * 180;
          const inner = polarToCartesian(cx, cy, r - 12, angle);
          const outer = polarToCartesian(cx, cy, r + 4, angle);
          return (
            <line
              key={tick}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--paper-dim)"
              strokeWidth="1.5"
            />
          );
        })}

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke={activeColorVar}
          strokeWidth="3"
          strokeLinecap="round"
          className="gauge__needle"
        />
        <circle cx={cx} cy={cy} r="5" fill={activeColorVar} />
      </svg>

      <div className="gauge__readout">
        <span className="gauge__percent mono">{percent}%</span>
        <span className="gauge__level" style={{ color: activeColorVar }}>
          {confidenceLevel === "high" && "High confidence"}
          {confidenceLevel === "low" && "Low confidence — verify diagnosis"}
          {confidenceLevel === "unreliable" && "Unable to diagnose reliably"}
        </span>
      </div>
    </div>
  );
}
