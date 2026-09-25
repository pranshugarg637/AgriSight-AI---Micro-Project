import express from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { json, nowIso } from "../db/knex.js";
import { listPlots, getPlot, createPlot } from "../repositories/plots.js";
import { scanFromRow } from "../repositories/scans.js";
import { findUserById } from "../repositories/users.js";
import { getImageStore } from "../services/imageStore.js";
import { compareScans } from "../services/followup.js";
import { WeatherService } from "../services/weather.js";
import { loadRules, rulesForCrop, assessRisk } from "../services/riskEngine.js";
import { isValidLatLng } from "../services/geo.js";
import { mlJson } from "../services/mlClient.js";

const ACTION_TYPES = ["sprayed", "removed_leaves", "did_nothing", "other"];

const plotSchema = z.object({
  name: z.string().trim().min(1).max(120),
  crop: z.string().trim().max(80).optional().nullable(),
  sowing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  location_label: z.string().trim().max(160).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
});
const actionSchema = z.object({
  action_type: z.enum(ACTION_TYPES),
  note: z.string().trim().max(500).optional().nullable(),
  remind_in_days: z.number().int().min(1).max(60).optional(),
});
const idParam = z.coerce.number().int().positive();

async function removeScanFiles(scan) {
  await getImageStore().remove(scan.image_ref);
  await getImageStore().remove(scan.gradcam_ref);
}

/** Records a follow-up if `scan.followup_of` points to an earlier scan of the same user. */
export async function recordFollowupIfLinked(db, userId, newScanId) {
  const next = await db("scans").where({ id: newScanId, user_id: userId }).first();
  if (!next?.followup_of) return null;
  const prev = await db("scans").where({ id: next.followup_of, user_id: userId }).first();
  if (!prev) return null;
  const { outcome, basis } = compareScans(prev, next);
  const [row] = await db("followups")
    .insert({ previous_scan_id: prev.id, new_scan_id: next.id, user_id: userId, outcome, basis: json.dump(basis), created_at: nowIso() })
    .returning("id");
  return { id: typeof row === "object" ? row.id : row, outcome, basis };
}

export default function accountRoutes(db, deps = {}) {
  const router = express.Router();
  const weather = deps.weather || new WeatherService();
  const loadRiskRules = deps.loadRules || (() => loadRules().rules);
  router.use(requireAuth);

  // ---- plots --------------------------------------------------------
  router.get("/plots", async (req, res, next) => {
    try {
      const plots = await listPlots(db, req.user.id);
      const counts = await db("scans").where({ user_id: req.user.id }).groupBy("plot_id").select("plot_id").count({ n: "id" });
      const byPlot = Object.fromEntries(counts.map((c) => [c.plot_id, Number(c.n)]));
      res.json({ plots: plots.map((p) => ({ ...p, scan_count: byPlot[p.id] || 0 })) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/plots", validate(plotSchema), async (req, res, next) => {
    try {
      const data = { ...req.validated.body };
      const user = await findUserById(db, req.user.id);
      if (!user.store_location_opt_in) {
        // coordinates are only stored after an explicit opt-in (Settings)
        data.lat = null;
        data.lng = null;
      }
      const plot = await createPlot(db, req.user.id, data);
      res.status(201).json({ plot });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/plots/:id", validate(plotSchema.partial()), async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const plot = await getPlot(db, req.user.id, id);
      if (!plot) return res.status(404).json({ error: "not_found", detail: "Plot not found." });
      const patch = { ...req.validated.body };
      const user = await findUserById(db, req.user.id);
      if (!user.store_location_opt_in) {
        delete patch.lat;
        delete patch.lng;
      }
      await db("plots").where({ id }).update(patch);
      res.json({ plot: await getPlot(db, req.user.id, id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/plots/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const plot = await getPlot(db, req.user.id, id);
      if (!plot) return res.status(404).json({ error: "not_found", detail: "Plot not found." });
      const scans = await db("scans").where({ plot_id: id, user_id: req.user.id });
      for (const s of scans) await removeScanFiles(s);
      await db("plots").where({ id }).del();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  /** Timeline: scans (newest first) with their actions and follow-up outcomes. */
  router.get("/plots/:id/timeline", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const plot = await getPlot(db, req.user.id, id);
      if (!plot) return res.status(404).json({ error: "not_found", detail: "Plot not found." });
      const scans = (await db("scans").where({ plot_id: id, user_id: req.user.id }).orderBy("id", "desc")).map(scanFromRow);
      const ids = scans.map((s) => s.id);
      const actions = ids.length ? await db("actions").whereIn("scan_id", ids).orderBy("id") : [];
      const followups = ids.length ? await db("followups").whereIn("new_scan_id", ids) : [];
      const reviews = ids.length ? await db("reviewed_labels").whereIn("scan_id", ids) : [];
      const items = scans.map((s) => ({
        ...s,
        has_image: Boolean(s.image_ref),
        image_ref: undefined,
        gradcam_ref: undefined,
        actions: actions.filter((a) => a.scan_id === s.id),
        followup: (() => {
          const f = followups.find((x) => x.new_scan_id === s.id);
          return f ? { ...f, basis: json.load(f.basis, {}) } : null;
        })(),
        expert_label: reviews.find((r) => r.scan_id === s.id)?.class_key || null,
      }));
      res.json({ plot, timeline: items });
    } catch (err) {
      next(err);
    }
  });

  // ---- scans --------------------------------------------------------
  async function ownScan(req, res) {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "validation_error", detail: "Invalid id." });
      return null;
    }
    const row = await db("scans").where({ id: id.data, user_id: req.user.id }).first();
    if (!row) {
      // same answer whether it does not exist or belongs to someone else
      res.status(404).json({ error: "not_found", detail: "Scan not found." });
      return null;
    }
    return row;
  }

  router.get("/scans/:id", async (req, res, next) => {
    try {
      const row = await ownScan(req, res);
      if (!row) return;
      const s = scanFromRow(row);
      res.json({ scan: { ...s, has_image: Boolean(s.image_ref), image_ref: undefined, gradcam_ref: undefined } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/scans/:id/image", async (req, res, next) => {
    try {
      const row = await ownScan(req, res);
      if (!row) return;
      const which = req.query.kind === "gradcam" ? row.gradcam_ref : row.image_ref;
      if (!which) return res.status(404).json({ error: "not_found", detail: "No stored image." });
      res.set("Cache-Control", "private, max-age=3600");
      res.type(which.split(".").pop());
      res.send(await getImageStore().read(which));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/scans/:id", async (req, res, next) => {
    try {
      const row = await ownScan(req, res);
      if (!row) return;
      await removeScanFiles(row);
      await db("scans").where({ id: row.id }).del();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/scans/:id/dispute", async (req, res, next) => {
    try {
      const row = await ownScan(req, res);
      if (!row) return;
      await db("scans").where({ id: row.id }).update({ disputed: true });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/scans/:id/actions", validate(actionSchema), async (req, res, next) => {
    try {
      const row = await ownScan(req, res);
      if (!row) return;
      const { action_type, note, remind_in_days = 7 } = req.validated.body;
      const remindAt = new Date(Date.now() + remind_in_days * 86400 * 1000).toISOString();
      const [r] = await db("actions")
        .insert({ scan_id: row.id, user_id: req.user.id, action_type, note: note || null, remind_at: remindAt, created_at: nowIso() })
        .returning("id");
      res.status(201).json({ action: await db("actions").where({ id: typeof r === "object" ? r.id : r }).first() });
    } catch (err) {
      next(err);
    }
  });

  /** In-app reminders: actions whose re-scan date has come and that have no follow-up scan yet. */
  router.get("/reminders", async (req, res, next) => {
    try {
      const due = await db("actions as a")
        .join("scans as s", "s.id", "a.scan_id")
        .leftJoin("plots as p", "p.id", "s.plot_id")
        .where("a.user_id", req.user.id)
        .whereNotNull("a.remind_at")
        .where("a.remind_at", "<=", new Date().toISOString())
        .whereNotExists(db("scans as n").whereRaw("n.followup_of = s.id"))
        .select("a.id as action_id", "a.action_type", "a.remind_at", "s.id as scan_id", "s.diagnosis", "s.crop", "p.id as plot_id", "p.name as plot_name")
        .orderBy("a.remind_at");
      res.json({ reminders: due });
    } catch (err) {
      next(err);
    }
  });

  // ---- weather risk indicator --------------------------------------
  router.get("/risk", async (req, res, next) => {
    try {
      const plotId = idParam.safeParse(req.query.plot_id);
      if (!plotId.success) return res.status(400).json({ error: "validation_error", detail: "plot_id required." });
      const plot = await getPlot(db, req.user.id, plotId.data);
      if (!plot) return res.status(404).json({ error: "not_found", detail: "Plot not found." });
      let lat = plot.lat;
      let lng = plot.lng;
      const qlat = parseFloat(req.query.lat);
      const qlng = parseFloat(req.query.lng);
      if ((lat == null || lng == null) && isValidLatLng(qlat, qlng)) {
        lat = qlat; // used for this request only, not stored
        lng = qlng;
      }
      if (lat == null || lng == null) {
        return res.status(422).json({ error: "location_required", detail: "Add coordinates to the plot (opt-in) or allow location for this request." });
      }
      const rules = rulesForCrop(loadRiskRules(), plot.crop);
      const days = Math.min(7, Math.max(3, parseInt(req.query.days || "7", 10) || 7));
      const forecast = await weather.forecast(lat, lng, days);
      res.set("Cache-Control", "no-store");
      res.json({ plot_id: plot.id, crop: plot.crop, rules_available: rules.length, ...assessRisk(rules, forecast) });
    } catch (err) {
      next(err);
    }
  });

  // ---- symptom-question refinement (Account Mode) ------------------
  router.post("/refine", async (req, res, next) => {
    try {
      const schema = z.object({
        candidates: z.array(z.object({ class_key: z.string().max(160), probability: z.number().min(0).max(1) })).min(2).max(10),
        answers: z.record(z.string().max(20), z.enum(["yes", "no", "unsure"])),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "validation_error", detail: "Invalid refine request." });
      const { status, data } = await mlJson("/api/refine", { method: "POST", body: parsed.data });
      res.status(status).json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
