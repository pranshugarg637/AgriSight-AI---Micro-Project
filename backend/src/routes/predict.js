import express from "express";
import FormData from "form-data";
import fetch from "node-fetch";
import { uploadImage } from "../middleware/upload.js";
import { config } from "../config/index.js";

const router = express.Router();

router.post("/predict", uploadImage.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "no_file", detail: "No image file was provided. Attach it under the 'file' field." });
    }

    const formData = new FormData();
    formData.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    let mlResponse;
    try {
      mlResponse = await fetch(`${config.mlServiceUrl}/api/predict`, {
        method: "POST",
        body: formData,
        headers: formData.getHeaders(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await mlResponse.json();

    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: "prediction_failed",
        detail: data.detail || "The ML service could not process this image.",
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
