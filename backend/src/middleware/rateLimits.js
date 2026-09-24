import rateLimit from "express-rate-limit";
import { config } from "../config/index.js";

const make = (windowMs, max, detail) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited", detail },
  });

export const predictLimiter = () =>
  make(60 * 1000, config.rateLimits.predictPerMinute, "Too many prediction requests. Please wait a moment and try again.");

export const authLimiter = () =>
  make(config.auth.rateLimitWindowMs, config.auth.rateLimitMax, "Too many attempts. Please wait and try again later.");

export const farmerPredictLimiter = () =>
  make(60 * 1000, config.rateLimits.farmerPredictPerMinute, "Too many photos in a short time. Please wait a minute.");

export const farmerGeneralLimiter = () =>
  make(60 * 1000, config.rateLimits.farmerGeneralPerMinute, "Too many requests. Please wait a minute.");
