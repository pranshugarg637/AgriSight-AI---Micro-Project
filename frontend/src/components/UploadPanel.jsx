import { useCallback, useRef, useState } from "react";
import "./UploadPanel.css";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function UploadPanel({ onAnalyze, isAnalyzing }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localError, setLocalError] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback((selectedFile) => {
    setLocalError(null);
    if (!selectedFile) return;

    if (!ACCEPTED_TYPES.includes(selectedFile.type)) {
      setLocalError("Please choose a JPEG, PNG, or WebP photo of the leaf.");
      return;
    }

    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      handleFile(dropped);
    },
    [handleFile]
  );

  return (
    <div className="intake">
      <div className="intake__tag">Specimen intake</div>

      <div
        className={`intake__slot ${isDragOver ? "intake__slot--drag" : ""} ${previewUrl ? "intake__slot--filled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="visually-hidden"
          aria-label="Upload a leaf photo"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {previewUrl ? (
          <img src={previewUrl} alt="Uploaded leaf preview" className="intake__preview" />
        ) : (
          <div className="intake__placeholder">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path
                d="M20 32C12 29 8 21 9.5 12c8-2.5 16 1 18.5 9 1.8 5.6-1.3 10-5 10-1.8 0-3.5-1.2-3.5-3.6 0-5 3.5-8.7 7.5-10"
                stroke="var(--evidence)"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <p className="intake__placeholder-text">
              Drag a leaf photo here, or <span>browse files</span>
            </p>
            <p className="intake__hint">JPEG, PNG, or WebP · well-lit, in focus, leaf fills the frame</p>
          </div>
        )}
      </div>

      {localError && <p className="intake__error" role="alert">{localError}</p>}

      <button
        className="intake__submit"
        disabled={!file || isAnalyzing}
        onClick={() => onAnalyze(file)}
      >
        {isAnalyzing ? "Diagnosing…" : "Diagnose specimen"}
      </button>
    </div>
  );
}
