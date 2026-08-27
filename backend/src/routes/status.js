import express from "express";
import fetch from "node-fetch";
import { config } from "../config/index.js";

const router = express.Router();

async function proxyGet(mlPath, res, next) {
  try {
    const response = await fetch(`${config.mlServiceUrl}${mlPath}`, { method: "GET" });
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/csv")) {
      const text = await response.text();
      res.status(response.status).set("Content-Type", "text/csv");
      res.set("Content-Disposition", response.headers.get("content-disposition") || "attachment");
      return res.send(text);
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    next(err);
  }
}

router.get("/health", async (req, res, next) => {
  try {
    const mlHealth = await fetch(`${config.mlServiceUrl}/api/health`).then((r) => r.json());
    return res.status(200).json({ backend: "ok", ml_service: mlHealth });
  } catch (err) {
    return res.status(200).json({
      backend: "ok",
      ml_service: { status: "unreachable", detail: "Could not reach the ML service." },
    });
  }
});

router.get("/model-status", (req, res, next) => proxyGet("/api/model-status", res, next));
router.get("/knowledge-base-status", (req, res, next) => proxyGet("/api/knowledge-base-status", res, next));
router.get("/analytics/history", (req, res, next) => {
  const limit = req.query.limit ? `?limit=${encodeURIComponent(req.query.limit)}` : "";
  return proxyGet(`/api/analytics/history${limit}`, res, next);
});
router.get("/analytics/export.csv", (req, res, next) => proxyGet("/api/analytics/export.csv", res, next));
router.get("/evaluation-report", (req, res, next) => proxyGet("/api/evaluation-report", res, next));
router.get("/training-metrics", (req, res, next) => proxyGet("/api/training-metrics", res, next));

export default router;
