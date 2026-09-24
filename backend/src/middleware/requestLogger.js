import morgan from "morgan";

morgan.token("path-only", (req) => String(req.originalUrl || "").split("?")[0]);

/**
 * Access log WITHOUT query strings (Farmer-Mode coordinates travel as
 * ?lat=&lng= and must never be written to logs) and without IPs for guest
 * routes (no personal data in Farmer Mode).
 */
morgan.token("client", (req) => (String(req.originalUrl || "").startsWith("/api/farmer") ? "-" : req.ip));

export const LOG_FORMAT = ":client - :method :path-only :status :res[content-length] - :response-time ms";

export function requestLogger({ stream, skip } = {}) {
  return morgan(LOG_FORMAT, {
    stream,
    skip: skip || (() => process.env.NODE_ENV === "test"),
  });
}
