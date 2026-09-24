import express from "express";
import { uploadFarmerImage, requireImageMagicBytes } from "../middleware/upload.js";
import { farmerPredictLimiter, farmerGeneralLimiter } from "../middleware/rateLimits.js";
import { mlPostImage } from "../services/mlClient.js";
import { recordScan } from "../repositories/scans.js";
import { pickLanguage } from "./predict.js";

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

  if (deps.extend) deps.extend(router);
  return router;
}
