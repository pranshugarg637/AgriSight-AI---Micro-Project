import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { config } from "./config/index.js";
import predictRoutes from "./routes/predict.js";
import statusRoutes from "./routes/status.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(morgan("combined", { skip: () => process.env.NODE_ENV === "test" }));
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST"],
    })
  );

  const predictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited", detail: "Too many prediction requests. Please wait a moment and try again." },
  });

  app.use("/api/predict", predictLimiter);
  app.use("/api", predictRoutes);
  app.use("/api", statusRoutes);

  app.get("/", (req, res) => {
    res.json({ service: "plant-disease-backend", status: "running" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
