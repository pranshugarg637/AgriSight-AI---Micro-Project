import express from "express";
import { z } from "zod";
import { uploadImage, requireImageMagicBytes } from "../middleware/upload.js";
import { requireAuth } from "../middleware/auth.js";
import { predictLimiter } from "../middleware/rateLimits.js";
import { mlPostImage } from "../services/mlClient.js";
import { recordScan } from "../repositories/scans.js";
import { resolvePlotForScan } from "../repositories/plots.js";
import { getImageStore } from "../services/imageStore.js";
import { config } from "../config/index.js";
import { recordFollowupIfLinked } from "./account.js";

const fieldsSchema = z.object({
  language: z.string().min(2).max(8).optional(),
  plot_id: z.coerce.number().int().positive().optional(),
  followup_of: z.coerce.number().int().positive().optional(),
});

export function pickLanguage(requested, fallback = "en") {
  return config.languages.includes(requested) ? requested : fallback;
}

/**
 * Authenticated diagnosis (Account Mode). Request/response contract is the
 * v1 one (multipart field "file" -> PredictionResponse); v2 only adds fields
 * (scan_id, plot_id, language/translation fields from the ML service).
 */
export default function predictRoutes(db) {
  const router = express.Router();

  router.post(
    "/predict",
    requireAuth,
    predictLimiter(),
    uploadImage.single("file"),
    requireImageMagicBytes,
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "no_file", detail: "No image file was provided. Attach it under the 'file' field." });
        }
        const parsed = fieldsSchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).json({ error: "validation_error", detail: "Invalid form fields." });
        const language = pickLanguage(parsed.data.language);

        const plot = await resolvePlotForScan(db, req.user.id, parsed.data.plot_id);
        if (!plot) return res.status(404).json({ error: "plot_not_found", detail: "Plot not found." });

        const { status, ok, data } = await mlPostImage("/api/predict", req.file, { language });
        if (!ok) {
          return res.status(status).json({
            error: "prediction_failed",
            detail: data?.detail || "The ML service could not process this image.",
          });
        }

        let imageRef = null;
        try {
          imageRef = await getImageStore().save(req.file.buffer, req.file.mimetype);
        } catch (err) {
          // Never store an image whose metadata could not be stripped.
          console.warn(`[predict] image not stored (metadata strip failed): ${err.message}`);
        }
        let gradcamRef = null;
        if (data?.gradcam_image_base64) {
          try {
            gradcamRef = await getImageStore().save(Buffer.from(data.gradcam_image_base64, "base64"), "image/png");
          } catch {
            gradcamRef = null;
          }
        }
        let followupOf = null;
        if (parsed.data.followup_of) {
          const prev = await db("scans").where({ id: parsed.data.followup_of, user_id: req.user.id }).first();
          followupOf = prev ? prev.id : null;
        }
        const scanId = await recordScan(db, {
          result: data,
          mode: "account",
          userId: req.user.id,
          plotId: plot.id,
          imageRef,
          language,
        });
        await db("scans").where({ id: scanId }).update({ gradcam_ref: gradcamRef, followup_of: followupOf });
        const followup = await recordFollowupIfLinked(db, req.user.id, scanId);
        return res.status(200).json({ ...data, scan_id: scanId, plot_id: plot.id, followup });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
