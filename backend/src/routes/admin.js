import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { computeMetrics } from "../services/metrics.js";

export default function adminRoutes(db) {
  const router = express.Router();
  router.use(requireAuth, requireRole("admin"));

  router.get("/metrics", async (req, res, next) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days || "30", 10) || 30));
      const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
      const scans = await db("scans")
        .where("created_at", ">=", since)
        .select("mode", "class_key", "confidence", "confidence_level", "unreliable_reason", "retrieval_status", "created_at");
      const reviewed = await db("reviewed_labels").where("created_at", ">=", since).select("class_key", "model_class_key");
      res.set("Cache-Control", "no-store");
      res.json({ window_days: days, since, ...computeMetrics(scans, reviewed) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
