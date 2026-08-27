import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  port: parseInt(process.env.BACKEND_PORT || "5000", 10),
  mlServiceUrl: process.env.ML_SERVICE_URL || "http://localhost:8000",
  maxUploadSizeMb: parseFloat(process.env.MAX_IMAGE_SIZE_MB || "8"),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173").split(","),
  requestTimeoutMs: parseInt(process.env.ML_REQUEST_TIMEOUT_MS || "180000", 10),
};
