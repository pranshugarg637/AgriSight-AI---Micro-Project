import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { config } from "./config/index.js";
import { getDb } from "./db/knex.js";
import predictRoutes from "./routes/predict.js";
import statusRoutes from "./routes/status.js";
import authRoutes from "./routes/auth.js";
import farmerRoutes from "./routes/farmer.js";
import accountRoutes from "./routes/account.js";
import expertRoutes from "./routes/expert.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";

/**
 * @param {object} [options]
 * @param {import("knex").Knex} [options.db]  database (defaults to the configured one)
 */
export function createApp(options = {}) {
  const db = options.db || getDb();
  const app = express();

  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(options.requestLogger || requestLogger());
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      credentials: true,
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use("/api/auth", authRoutes(db));
  app.use("/api/farmer", farmerRoutes(db, options.farmer));
  app.use("/api/v2/expert", expertRoutes(db));
  app.use("/api/v2", accountRoutes(db, options.account));
  app.use("/api", predictRoutes(db));
  app.use("/api", statusRoutes);

  app.get("/", (req, res) => {
    res.json({ service: "plant-disease-backend", status: "running" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
