import { useState } from "react";
import "./GradCamView.css";

export default function GradCamView({ originalUrl, gradcamBase64, note }) {
  const [showOverlay, setShowOverlay] = useState(true);

  return (
    <div className="gradcam">
      <div className="gradcam__header">
        <h3 className="gradcam__title">Visual explanation</h3>
        <div className="gradcam__toggle" role="group" aria-label="Toggle between original and Grad-CAM image">
          <button
            className={!showOverlay ? "gradcam__toggle-btn gradcam__toggle-btn--active" : "gradcam__toggle-btn"}
            onClick={() => setShowOverlay(false)}
          >
            Original
          </button>
          <button
            className={showOverlay ? "gradcam__toggle-btn gradcam__toggle-btn--active" : "gradcam__toggle-btn"}
            onClick={() => setShowOverlay(true)}
          >
            Grad-CAM
          </button>
        </div>
      </div>

      <div className="gradcam__frame">
        <img
          src={showOverlay ? `data:image/png;base64,${gradcamBase64}` : originalUrl}
          alt={showOverlay ? "Grad-CAM heatmap overlay on the leaf" : "Original uploaded leaf photo"}
          className="gradcam__image"
        />
      </div>

      <p className="gradcam__caption">{note}</p>
    </div>
  );
}
