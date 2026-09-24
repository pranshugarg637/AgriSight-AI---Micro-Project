import express from "express";
import { uploadFarmerImage, requireImageMagicBytes } from "../middleware/upload.js";
import { farmerPredictLimiter, farmerGeneralLimiter } from "../middleware/rateLimits.js";
import { mlPostImage } from "../services/mlClient.js";
import { recordScan } from "../repositories/scans.js";
import { pickLanguage } from "./predict.js";
import { loadScriptBundle, resolveClip } from "../services/audioScripts.js";
import { config } from "../config/index.js";

/**
 * Guest / Farmer Mode endpoints -- no login, no personal data, no history.
 * Tighter per-IP limits and a smaller upload cap than Account Mode. The
 * photo is forwarded to the ML service and never written to disk; only an
 * anonymous scan row (no image, no IP, no location) is kept for monitoring.
 */
export default function farmerRoutes(db, deps = {}) {
  const router = express.Router();
  router.use(farmerGeneralLimiter());

  router.post(
    "/predict",
    farmerPredictLimiter(),
    uploadFarmerImage.single("file"),
    requireImageMagicBytes,
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "no_file", detail: "No image file was provided. Attach it under the 'file' field." });
        }
        const language = pickLanguage(req.body?.language);
        const { status, ok, data } = await mlPostImage("/api/predict", req.file, { language });
        if (!ok) {
          return res.status(status).json({
            error: "prediction_failed",
            detail: data?.detail || "The ML service could not process this image.",
          });
        }
        await recordScan(db, { result: data, mode: "farmer", language });
        return res.status(200).json(data);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Audio (Step 3) -------------------------------------------------
  // Pre-generated clips, cacheable (and cached offline by the service worker).
  router.get("/audio/:key", (req, res) => {
    const found = resolveClip(req.params.key);
    if (found.error) return res.status(400).json({ error: "invalid_key", detail: "Invalid audio clip key." });
    if (found.missing) {
      // Logged so missing clips (-> browser speech fallback) are visible to maintainers.
      console.warn(`[audio] clip missing: ${req.params.key} (client will fall back to Web Speech)`);
      return res.status(404).json({ error: "clip_missing", detail: "Audio clip not generated yet." });
    }
    res.set("Cache-Control", "public, max-age=604800");
    res.type(found.contentType);
    return res.sendFile(found.file);
  });

  // Script text for one language (used for the speech fallback, the
  // unreviewed-content warning and offline caching).
  router.get("/audio-scripts/:lang", (req, res) => {
    const lang = req.params.lang;
    if (!config.languages.includes(lang)) return res.status(404).json({ error: "unsupported_language" });
    const bundle = loadScriptBundle(lang);
    if (!bundle) return res.status(404).json({ error: "no_scripts", detail: "No audio scripts for this language." });
    res.set("Cache-Control", "public, max-age=3600");
    return res.json(bundle);
  });

  // Client reports a fallback to browser speech so it shows up in server logs.
  router.post("/audio-fallback", (req, res) => {
    const key = String(req.body?.key || "").slice(0, 140);
    if (/^[a-z0-9_.]+$/.test(key)) console.warn(`[audio] web-speech fallback used for ${key}`);
    return res.status(204).end();
  });

  if (deps.extend) deps.extend(router);
  return router;
}
