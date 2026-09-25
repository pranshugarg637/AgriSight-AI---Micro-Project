import express from "express";
import { uploadFarmerImage, requireImageMagicBytes } from "../middleware/upload.js";
import { farmerPredictLimiter, farmerGeneralLimiter } from "../middleware/rateLimits.js";
import { mlPostImage, mlJson } from "../services/mlClient.js";
import { z } from "zod";
import { recordScan } from "../repositories/scans.js";
import { pickLanguage } from "./predict.js";
import { relayPredictionStream } from "../services/sseRelay.js";
import { loadScriptBundle, resolveClip } from "../services/audioScripts.js";
import { config } from "../config/index.js";
import { createShopProvider, ShopFinder } from "../services/shops/index.js";
import { HelpCenterDirectory } from "../services/helpCenters.js";
import { NominatimGeocoder } from "../services/geocoder.js";
import { isValidLatLng } from "../services/geo.js";

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

  router.post(
    "/predict/stream",
    farmerPredictLimiter(),
    uploadFarmerImage.single("file"),
    requireImageMagicBytes,
    async (req, res, next) => {
      try {
        if (!req.file) return res.status(400).json({ error: "no_file", detail: "No image file was provided." });
        const language = pickLanguage(req.body?.language);
        await relayPredictionStream(req, res, {
          file: req.file,
          fields: { language },
          onResult: async (data) => {
            await recordScan(db, { result: data, mode: "farmer", language });
            return data;
          },
        });
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

  // --- Symptom questions (Step 5) -------------------------------------
  const classKey = z.string().min(3).max(160).regex(/^[A-Za-z0-9_(),. -]+$/);
  router.get("/questions", async (req, res, next) => {
    try {
      const parsed = z.object({ a: classKey, b: classKey }).safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "validation_error", detail: "a and b class keys required." });
      const qs = new URLSearchParams({ class_a: parsed.data.a, class_b: parsed.data.b, language: pickLanguage(req.query.lang) });
      const { status, data } = await mlJson(`/api/questions?${qs}`);
      return res.status(status).json(data);
    } catch (err) {
      next(err);
    }
  });

  const refineSchema = z.object({
    candidates: z.array(z.object({ class_key: classKey, probability: z.number().min(0).max(1) })).min(2).max(10),
    answers: z.record(z.string().max(20), z.enum(["yes", "no", "unsure"])),
  });
  router.post("/refine", async (req, res, next) => {
    try {
      const parsed = refineSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "validation_error", detail: "Invalid refine request." });
      const { status, data } = await mlJson("/api/refine", { method: "POST", body: parsed.data });
      return res.status(status).json(data);
    } catch (err) {
      next(err);
    }
  });

  // --- Nearby help (Step 4) -------------------------------------------
  // Coordinates are used for this request only: never stored, never logged
  // (request logs omit query strings), rounded to ~110 m before being sent
  // to the single configured provider.
  const shopFinder = deps.shopFinder || new ShopFinder(createShopProvider());
  const helpDirectory = deps.helpDirectory || new HelpCenterDirectory(config.help.helpCentersDir);
  const geocoder = deps.geocoder || new NominatimGeocoder();

  const readLatLng = (req) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  };

  router.get("/shops", async (req, res, next) => {
    try {
      const point = readLatLng(req);
      if (!point) return res.status(400).json({ error: "validation_error", detail: "lat and lng are required." });
      const result = await shopFinder.find(point.lat, point.lng);
      const offices = helpDirectory.nearest(point.lat, point.lng, 3);
      res.set("Cache-Control", "no-store");
      return res.json({
        ...result,
        offices,
        stock_disclaimer: "A listing does not guarantee that a product is in stock.",
        office_fallback: result.shops.length === 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/help-centers/index", (req, res) => {
    res.json({ states: helpDirectory.index() });
  });

  router.get("/help-centers", (req, res) => {
    const point = readLatLng(req);
    if (point) {
      res.set("Cache-Control", "no-store");
      return res.json({ centers: helpDirectory.nearest(point.lat, point.lng, 5) });
    }
    const state = String(req.query.state || "");
    if (!/^[a-z0-9_-]{1,60}$/.test(state)) return res.status(400).json({ error: "validation_error", detail: "state or lat/lng required." });
    return res.json({ centers: helpDirectory.byDistrict(state, req.query.district) });
  });

  router.get("/geocode", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2 || q.length > 120) return res.status(400).json({ error: "validation_error", detail: "q (2-120 chars) required." });
    try {
      const places = await geocoder.search(q);
      return res.json({ places, attribution: geocoder.attribution });
    } catch (err) {
      console.warn(`[geocode] provider failed: ${err.code || err.name || "error"}`);
      return res.status(502).json({ error: "provider_unavailable", detail: "Place search is unavailable right now." });
    }
  });

  if (deps.extend) deps.extend(router);
  return router;
}
