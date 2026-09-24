import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

export function signAccessToken(user, { ttlSeconds = config.auth.accessTokenTtlSeconds } = {}) {
  return jwt.sign({ role: user.role }, config.auth.jwtSecret, {
    algorithm: "HS256",
    subject: String(user.id),
    issuer: config.auth.jwtIssuer,
    expiresIn: ttlSeconds,
  });
}

/** Returns { userId, role } or throws (expired / invalid signature / wrong issuer). */
export function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.auth.jwtSecret, {
    algorithms: ["HS256"],
    issuer: config.auth.jwtIssuer,
  });
  return { userId: parseInt(payload.sub, 10), role: payload.role };
}

export function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newFamilyId() {
  return crypto.randomBytes(16).toString("hex");
}
