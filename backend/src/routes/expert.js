import express from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { nowIso } from "../db/knex.js";
import { scanFromRow } from "../repositories/scans.js";
import { getImageStore } from "../services/imageStore.js";

const reviewSchema = z
  .object({
    decision: z.enum(["confirm", "correct"]),
    corrected_class_key: z.string().trim().min(3).max(160).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.decision === "confirm" || Boolean(v.corrected_class_key), {
    message: "corrected_class_key is required when decision is 'correct'",
  });

/**
 * Expert review queue: low-confidence, unreliable or user-disputed account
 * scans without a review yet. Decisions go to expert_reviews and the final
 * label to reviewed_labels -- used for evaluation and possible future
 * retraining only; nothing retrains automatically.
 */
export default function expertRoutes(db) {
  const router = express.Router();
  router.use(requireAuth, requireRole("expert", "admin"));

  router.get("/queue", async (req, res, next) => {
    try {
      const rows = await db("scans as s")
        .leftJoin("reviewed_labels as r", "r.scan_id", "s.id")
        .whereNull("r.id")
        .where("s.mode", "account")
        .where((q) => q.whereIn("s.confidence_level", ["low", "unreliable"]).orWhere("s.disputed", true))
        .orderBy("s.id", "desc")
        .limit(100)
        .select("s.*");
      res.json({
        queue: rows.map((r) => {
          const s = scanFromRow(r);
          // experts see the evidence, not who the farmer is
          return { ...s, user_id: undefined, plot_id: undefined, image_ref: undefined, gradcam_ref: undefined, has_image: Boolean(r.image_ref), has_gradcam: Boolean(r.gradcam_ref) };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/scans/:id/image", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const row = await db("scans").where({ id }).first();
      const ref = req.query.kind === "gradcam" ? row?.gradcam_ref : row?.image_ref;
      if (!ref) return res.status(404).json({ error: "not_found", detail: "No stored image." });
      res.set("Cache-Control", "private, no-store");
      res.type(ref.split(".").pop());
      res.send(await getImageStore().read(ref));
    } catch (err) {
      next(err);
    }
  });

  router.post("/scans/:id/review", validate(reviewSchema), async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const scan = await db("scans").where({ id }).first();
      if (!scan) return res.status(404).json({ error: "not_found", detail: "Scan not found." });
      const { decision, corrected_class_key, note } = req.validated.body;
      const label = decision === "confirm" ? scan.class_key : corrected_class_key;
      if (!label) return res.status(422).json({ error: "no_label", detail: "The model gave no class to confirm; use 'correct'." });
      await db.transaction(async (trx) => {
        await trx("expert_reviews").insert({
          scan_id: id,
          expert_id: req.user.id,
          decision,
          corrected_class_key: decision === "correct" ? corrected_class_key : null,
          note: note || null,
          created_at: nowIso(),
        });
        await trx("reviewed_labels").where({ scan_id: id }).del();
        await trx("reviewed_labels").insert({
          scan_id: id,
          class_key: label,
          model_class_key: scan.class_key,
          expert_id: req.user.id,
          source: "expert",
          created_at: nowIso(),
        });
      });
      res.status(201).json({ scan_id: id, label, decision });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
