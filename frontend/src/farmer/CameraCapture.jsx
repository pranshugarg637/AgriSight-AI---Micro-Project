import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assessFrame, ANALYSIS_WIDTH, ANALYSIS_HEIGHT } from "./frameQuality";
import { createCaptureMachine, startAnalysisLoop } from "./captureMachine";

const CUE_ICON = { low_light: "☀️", no_leaf: "🍃", come_closer: "🔍", hold_steady: "✋", steady: "👍", captured: "✅" };

/**
 * Full-screen rear camera. Analyses ~3 small frames per second locally
 * (sharpness, leaf-likeness, light, motion) and auto-captures ONE still
 * photo when the leaf has been good and steady for a few checks. It never
 * streams video to the server.
 */
export default function CameraCapture({ onCapture, onUnavailable, onPrompt, requiredGoodFrames = 4 }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const machineRef = useRef(null);
  const prevGray = useRef(null);
  const [cue, setCue] = useState("no_leaf");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream = null;
    let stopLoop = () => {};
    let cancelled = false;
    machineRef.current = createCaptureMachine({ requiredGoodFrames });

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailable?.("unsupported");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      } catch (err) {
        onUnavailable?.(err?.name === "NotAllowedError" ? "denied" : "unavailable");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setReady(true);
      stopLoop = startAnalysisLoop(tick, 333);
    }

    function grabSmallFrame() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return null;
      canvas.width = ANALYSIS_WIDTH;
      canvas.height = ANALYSIS_HEIGHT;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      return ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    }

    function tick() {
      const frame = grabSmallFrame();
      if (!frame) return;
      const assessment = assessFrame(frame, prevGray.current);
      prevGray.current = assessment.gray;
      const out = machineRef.current.onFrame(assessment);
      setCue(out.cue);
      if (out.prompt) onPrompt?.(out.prompt);
      if (out.capture) {
        stopLoop();
        captureStill();
      }
    }

    start();
    return () => {
      cancelled = true;
      stopLoop();
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function captureStill() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], "leaf.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  }

  function manualCapture() {
    if (machineRef.current?.forceCapture()) {
      onPrompt?.("captured");
      captureStill();
    }
  }

  const band = cue === "captured" || cue === "steady" ? "green" : cue === "hold_steady" ? "amber" : "red";

  return (
    <div className={`fcam fcam--${band}`}>
      <video ref={videoRef} className="fcam__video" playsInline muted aria-label={t("farmer.cameraView")} />
      <canvas ref={canvasRef} hidden />
      <div className="fcam__frame" aria-hidden="true" />
      <div className="fcam__cue" role="status" aria-live="polite">
        <span className="fcam__cue-icon" aria-hidden="true">
          {CUE_ICON[cue] || "🍃"}
        </span>
        <span className="fcam__cue-text">{t(`farmer.cue.${cue}`)}</span>
      </div>
      <button type="button" className="fcam__shutter" onClick={manualCapture} disabled={!ready} aria-label={t("farmer.takePhoto")}>
        <span aria-hidden="true">📸</span>
      </button>
    </div>
  );
}
